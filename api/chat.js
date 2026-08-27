import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo non consentito"
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY non disponibile nel deployment Vercel"
    });
  }

  try {
    const {
      message,
      business,
      clientName,
      settings = {},
      services = [],
      appointments = [],
      history = [],
      pendingAppointment = null,
      requiresConfirmation = false
    } = req.body || {};

    if (!message || !String(message).trim()) {
      return res.status(400).json({
        error: "Messaggio mancante"
      });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    /* ============================================================
       UTILITÀ
    ============================================================ */

    function normalizeText(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    }

    function toMinutes(time) {
      if (!time) return null;

      const value = String(time)
        .trim()
        .replace(".", ":");

      const match =
        value.match(/^(\d{1,2}):(\d{2})$/);

      if (!match) return null;

      const hours = Number(match[1]);
      const minutes = Number(match[2]);

      if (
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
      ) {
        return null;
      }

      return hours * 60 + minutes;
    }

    function formatTime(minutes) {
      const h =
        String(Math.floor(minutes / 60))
          .padStart(2, "0");

      const m =
        String(minutes % 60)
          .padStart(2, "0");

      return `${h}:${m}`;
    }

    function getDayName(date) {
      if (
        !date ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ) {
        return null;
      }

      const d =
        new Date(`${date}T12:00:00`);

      if (Number.isNaN(d.getTime())) {
        return null;
      }

      return [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday"
      ][d.getDay()];
    }

    function getService(name) {
      if (!name) return null;

      const wanted =
        normalizeText(name);

      return services.find(service =>
        normalizeText(service.name) === wanted
      ) || null;
    }

    function findServiceInText(text) {
      const normalized =
        normalizeText(text);

      for (const service of services) {
        const serviceName =
          normalizeText(service.name);

        if (
          serviceName &&
          normalized.includes(serviceName)
        ) {
          return service;
        }
      }

      return null;
    }

    function getDaySettings(date) {
      const dayName =
        getDayName(date);

      if (!dayName) return null;

      return settings.hours?.[dayName] || null;
    }

    function overlapsBreak(start, end, day) {
      if (!day) return false;

      const breakStart =
        toMinutes(day.breakStart);

      const breakEnd =
        toMinutes(day.breakEnd);

      if (
        breakStart === null ||
        breakEnd === null ||
        breakStart >= breakEnd
      ) {
        return false;
      }

      return (
        start < breakEnd &&
        end > breakStart
      );
    }

    function isSlotFree(date, time, duration) {
      const day =
        getDaySettings(date);

      if (
        !day ||
        day.status === "closed"
      ) {
        return false;
      }

      const opening =
        toMinutes(day.open);

      const closing =
        toMinutes(day.close);

      const start =
        toMinutes(time);

      if (
        opening === null ||
        closing === null ||
        start === null
      ) {
        return false;
      }

      const end =
        start + Number(duration);

      if (
        start < opening ||
        end > closing
      ) {
        return false;
      }

      if (
        overlapsBreak(
          start,
          end,
          day
        )
      ) {
        return false;
      }

      return !appointments.some(appointment => {
        if (
          appointment.d !== date ||
          !appointment.t
        ) {
          return false;
        }

        const existingStart =
          toMinutes(appointment.t);

        if (existingStart === null) {
          return false;
        }

        const existingService =
          getService(appointment.s);

        const existingDuration =
          existingService
            ? Number(existingService.duration) || 30
            : 30;

        const existingEnd =
          existingStart + existingDuration;

        return (
          start < existingEnd &&
          end > existingStart
        );
      });
    }

    function findAvailableSlots(date, duration) {
      const day =
        getDaySettings(date);

      if (
        !day ||
        day.status === "closed"
      ) {
        return [];
      }

      const opening =
        toMinutes(day.open);

      const closing =
        toMinutes(day.close);

      if (
        opening === null ||
        closing === null
      ) {
        return [];
      }

      const slots = [];

      for (
        let start = opening;
        start + duration <= closing;
        start += 30
      ) {
        const time =
          formatTime(start);

        if (
          isSlotFree(
            date,
            time,
            duration
          )
        ) {
          slots.push(time);
        }
      }

      return slots;
    }

    /* ============================================================
       DATA ODIERNA - EUROPE/ROME
    ============================================================ */

    const dateParts =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: "Europe/Rome",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }
      ).formatToParts(new Date());

    const dateMap = {};

    dateParts.forEach(part => {
      if (part.type !== "literal") {
        dateMap[part.type] = part.value;
      }
    });

    const today =
      `${dateMap.year}-${dateMap.month}-${dateMap.day}`;

    /* ============================================================
       ORARI
    ============================================================ */

    const openingHours =
      Object.entries({
        monday: "Lunedì",
        tuesday: "Martedì",
        wednesday: "Mercoledì",
        thursday: "Giovedì",
        friday: "Venerdì",
        saturday: "Sabato",
        sunday: "Domenica"
      })
        .map(([key, label]) => {
          const day =
            settings.hours?.[key];

          if (
            !day ||
            day.status === "closed"
          ) {
            return `${label}: Chiuso`;
          }

          let text =
            `${label}: ${day.open} - ${day.close}`;

          if (
            day.breakStart &&
            day.breakEnd
          ) {
            text +=
              ` (pausa ${day.breakStart}-${day.breakEnd})`;
          }

          return text;
        })
        .join("\n");

    /* ============================================================
       LISTINO
    ============================================================ */

    const serviceList =
      services.length
        ? services
            .map(service =>
              `- ${service.name}: €${service.price} (${service.duration} minuti)`
            )
            .join("\n")
        : "Nessun servizio inserito.";

    /* ============================================================
       CRONOLOGIA
    ============================================================ */

    const safeHistory =
      Array.isArray(history)
        ? history
            .filter(item =>
              item &&
              (
                item.role === "user" ||
                item.role === "assistant"
              ) &&
              typeof item.content === "string"
            )
            .slice(-30)
        : [];

    /* ============================================================
       CONFERMA / ANNULLAMENTO
    ============================================================ */

    const normalizedMessage =
      normalizeText(message);

    const confirmationWords = [
      "si",
      "sì",
      "confermo",
      "va bene",
      "ok",
      "okay",
      "prenota",
      "prenotalo",
      "procedi",
      "conferma"
    ];

    const cancellationWords = [
      "no",
      "annulla",
      "cancella",
      "non confermo",
      "lascia perdere"
    ];

    const isConfirmation =
      confirmationWords.some(word =>
        normalizedMessage ===
          normalizeText(word)
      ) ||
      normalizedMessage.includes("si confermo") ||
      normalizedMessage.includes("sì confermo");

    const isCancellation =
      cancellationWords.some(word =>
        normalizedMessage ===
          normalizeText(word)
      );

    /* ============================================================
       CONFERMA APPUNTAMENTO
    ============================================================ */

    if (
      pendingAppointment &&
      requiresConfirmation &&
      isConfirmation
    ) {
      const requested =
        pendingAppointment;

      const service =
        getService(requested.service);

      if (!service) {
        return res.status(200).json({
          reply:
            "Il servizio richiesto non è più presente nel listino.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          availableSlots: []
        });
      }

      const date =
        String(requested.date || "").trim();

      let time =
        String(requested.time || "")
          .trim()
          .replace(".", ":");

      const timeMinutes =
        toMinutes(time);

      if (timeMinutes !== null) {
        time =
          formatTime(timeMinutes);
      }

      const name =
        String(
          requested.name ||
          clientName ||
          ""
        ).trim();

      if (
        !name ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !time
      ) {
        return res.status(200).json({
          reply:
            "Mancano alcuni dati dell'appuntamento. Ripetimi la richiesta.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          availableSlots: []
        });
      }

      const duration =
        Number(service.duration);

      if (
        !isSlotFree(
          date,
          time,
          duration
        )
      ) {
        const alternatives =
          findAvailableSlots(
            date,
            duration
          );

        return res.status(200).json({
          reply:
            alternatives.length
              ? `Nel frattempo l'orario ${time} non è più disponibile.`
              : "Nel frattempo l'orario richiesto non è più disponibile.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          availableSlots:
            alternatives.slice(0, 20),
          availableDate: date
        });
      }

      return res.status(200).json({
        reply:
          `Appuntamento confermato per ${service.name} il ${date} alle ${time}.`,
        appointment: {
          name,
          service: service.name,
          date,
          time
        },
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: true,
        availableSlots: []
      });
    }

    /* ============================================================
       ANNULLAMENTO
    ============================================================ */

    if (
      pendingAppointment &&
      requiresConfirmation &&
      isCancellation
    ) {
      return res.status(200).json({
        reply:
          "Va bene. L'appuntamento non è stato prenotato.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false,
        availableSlots: []
      });
    }

    /* ============================================================
       OPENAI
    ============================================================ */

    const response =
      await client.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Sei l'assistente virtuale di ${
          business || "un'attività locale italiana"
        }.

Rispondi sempre in italiano.

Il tuo compito è assistere il cliente e gestire
richieste relative a informazioni e appuntamenti.

==================================================
INFORMAZIONI ATTIVITÀ
==================================================

Tipo:
${settings.type || "Non specificato"}

Descrizione:
${settings.description || "Non specificata"}

Indirizzo:
${settings.address || "Non specificato"}

Telefono:
${settings.phone || "Non specificato"}

WhatsApp:
${settings.whatsapp || "Non specificato"}

ORARI:
${openingHours}

SERVIZI:
${serviceList}

Nome cliente:
${clientName || "Non fornito"}

Data odierna:
${today}

==================================================
RICHIESTA IN ATTESA
==================================================

${
  pendingAppointment
    ? JSON.stringify(
        pendingAppointment,
        null,
        2
      )
    : "Nessuna richiesta in attesa."
}

==================================================
REGOLE
==================================================

- Rispondi esclusivamente in italiano.
- Usa esclusivamente i servizi presenti nel listino.
- Non inventare servizi.
- Non inventare prezzi.
- Non inventare disponibilità.
- Usa sempre la cronologia.
- Combina informazioni date in messaggi differenti.
- Non chiedere nuovamente dati già forniti.
- Se manca un solo dato, chiedi esclusivamente quel dato.
- "15" significa 15:00.
- "15.00" significa 15:00.
- "13.30" significa 13:30.
- Le date devono essere YYYY-MM-DD.
- Gli orari devono essere HH:MM.

==================================================
RICHIESTA ORARI DISPONIBILI
==================================================

Se il cliente chiede:

- quali orari sono disponibili
- che orari avete
- quando posso venire
- mostrami gli orari
- quali appuntamenti ci sono
- disponibilità
- orari liberi
- quando siete disponibili

devi identificare, se possibile:

1. servizio
2. data

Se manca il servizio
