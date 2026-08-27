import OpenAI from "openai";

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo non consentito"
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

    function getTodayRome() {

      const parts =
        new Intl.DateTimeFormat(
          "en-CA",
          {
            timeZone: "Europe/Rome",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
          }
        ).formatToParts(new Date());

      const map = {};

      parts.forEach(part => {

        if (part.type !== "literal") {
          map[part.type] = part.value;
        }

      });

      return `${map.year}-${map.month}-${map.day}`;
    }

    function addDays(dateString, amount) {

      const date =
        new Date(
          `${dateString}T12:00:00`
        );

      date.setDate(
        date.getDate() + amount
      );

      const y =
        date.getFullYear();

      const m =
        String(date.getMonth() + 1)
          .padStart(2, "0");

      const d =
        String(date.getDate())
          .padStart(2, "0");

      return `${y}-${m}-${d}`;
    }

    function getDayName(date) {

      if (
        !date ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ) {
        return null;
      }

      const d =
        new Date(
          `${date}T12:00:00`
        );

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

    function formatItalianDate(date) {

      const d =
        new Date(
          `${date}T12:00:00`
        );

      return d.toLocaleDateString(
        "it-IT",
        {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric"
        }
      );
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

      return services.find(service => {

        const serviceName =
          normalizeText(service.name);

        return (
          serviceName &&
          normalized.includes(serviceName)
        );

      }) || null;
    }

    function getDaySettings(date) {

      const dayName =
        getDayName(date);

      if (!dayName) return null;

      return settings.hours?.[dayName] || null;
    }

    function overlapsBreak(
      start,
      end,
      day
    ) {

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

    /* ============================================================
       CONTROLLO DISPONIBILITÀ
    ============================================================ */

    function isSlotFree(
      date,
      time,
      duration
    ) {

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
          existingStart +
          existingDuration;

        return (
          start < existingEnd &&
          end > existingStart
        );

      });
    }

    function findAvailableSlots(
      date,
      duration = 30
    ) {

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
        closing === null ||
        opening >= closing
      ) {
        return [];
      }

      const slots = [];

      for (
        let start = opening;
        start + Number(duration) <= closing;
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
       DATA
    ============================================================ */

    const today =
      getTodayRome();

    const normalizedMessage =
      normalizeText(message);

    /* ============================================================
       RICONOSCIMENTO DATA
    ============================================================ */

    let requestedDate = null;

    if (
      normalizedMessage.includes("dopodomani")
    ) {

      requestedDate =
        addDays(today, 2);

    } else if (
      normalizedMessage.includes("domani")
    ) {

      requestedDate =
        addDays(today, 1);

    } else if (
      normalizedMessage.includes("oggi")
    ) {

      requestedDate =
        today;

    }

    const weekdayMap = {

      lunedi: 1,
      martedi: 2,
      mercoledi: 3,
      giovedi: 4,
      venerdi: 5,
      sabato: 6,
      domenica: 0

    };

    for (
      const [name, targetDay]
      of Object.entries(weekdayMap)
    ) {

      if (
        normalizedMessage.includes(name)
      ) {

        const current =
          new Date(
            `${today}T12:00:00`
          );

        const currentDay =
          current.getDay();

        let difference =
          targetDay - currentDay;

        if (difference <= 0) {
          difference += 7;
        }

        requestedDate =
          addDays(
            today,
            difference
          );

        break;
      }
    }

    /* ============================================================
       RICONOSCIMENTO ORA
    ============================================================ */

    let requestedTime = null;

    const timeMatch =
      normalizedMessage.match(
        /\b(\d{1,2})[:.](\d{2})\b/
      );

    if (timeMatch) {

      requestedTime =
        formatTime(
          Number(timeMatch[1]) * 60 +
          Number(timeMatch[2])
        );

    } else {

      const hourMatch =
        normalizedMessage.match(
          /\b(?:alle|ore)\s*(\d{1,2})(?!\d)/
        );

      if (hourMatch) {

        requestedTime =
          formatTime(
            Number(hourMatch[1]) * 60
          );

      }

    }

    /* ============================================================
       SERVIZIO
    ============================================================ */

    const detectedService =
      findServiceInText(message);

    /* ============================================================
       RICHIESTA DISPONIBILITÀ
       COMPLETAMENTE LOCALE
    ============================================================ */

    const hasAvailabilityWord =
      normalizedMessage.includes("orari") ||
      normalizedMessage.includes("orario") ||
      normalizedMessage.includes("disponibilita") ||
      normalizedMessage.includes("disponibile") ||
      normalizedMessage.includes("disponibili") ||
      normalizedMessage.includes("libero") ||
      normalizedMessage.includes("liberi");

    const hasDateWord =
      normalizedMessage.includes("oggi") ||
      normalizedMessage.includes("domani") ||
      normalizedMessage.includes("dopodomani") ||
      normalizedMessage.includes("lunedi") ||
      normalizedMessage.includes("martedi") ||
      normalizedMessage.includes("mercoledi") ||
      normalizedMessage.includes("giovedi") ||
      normalizedMessage.includes("venerdi") ||
      normalizedMessage.includes("sabato") ||
      normalizedMessage.includes("domenica");

    const asksAvailability =
      hasAvailabilityWord &&
      hasDateWord;

    if (
      asksAvailability &&
      requestedDate
    ) {

      const duration =
        detectedService
          ? Number(detectedService.duration) || 30
          : 30;

      const slots =
        findAvailableSlots(
          requestedDate,
          duration
        );

      if (!slots.length) {

        return res.status(200).json({

          reply:
            `Non risultano orari disponibili ` +
            `per ${formatItalianDate(requestedDate)}.`,

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false

        });

      }

      return res.status(200).json({

        reply:
          `Per ${formatItalianDate(requestedDate)} ` +
          `sono disponibili: ` +
          `${slots.slice(0, 12).join(", ")}.` +
          `\n\nQuale orario preferisci?`,

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false

      });

    }

    /* ============================================================
       CONFERMA / ANNULLAMENTO
    ============================================================ */

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
      );

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

      const service =
        getService(
          pendingAppointment.service
        );

      if (!service) {

        return res.status(200).json({

          reply:
            "Il servizio richiesto non è più presente nel listino.",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false

        });

      }

      const date =
        String(
          pendingAppointment.date || ""
        ).trim();

      const rawTime =
        String(
          pendingAppointment.time || ""
        )
        .trim()
        .replace(".", ":");

      const minutes =
        toMinutes(rawTime);

      const time =
        minutes !== null
          ? formatTime(minutes)
          : "";

      const name =
        String(
          pendingAppointment.name ||
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

          confirmed: false

        });

      }

      const duration =
        Number(service.duration) || 30;

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
              ? `Nel frattempo l'orario ${time} non è più disponibile. ` +
                `Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
              : "Nel frattempo l'orario richiesto non è più disponibile.",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false

        });

      }

      return res.status(200).json({

        reply:
          `Appuntamento confermato per ` +
          `${service.name} il ${date} alle ${time}.`,

        appointment: {

          name,
          service: service.name,
          date,
          time

        },

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: true

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

        confirmed: false

      });

    }

    /* ============================================================
       PRENOTAZIONE COMPLETA:
       NOME + SERVIZIO + DATA + ORA
       → NESSUNA CHIAMATA OPENAI
    ============================================================ */

    if (
      detectedService &&
      requestedDate &&
      requestedTime &&
      clientName
    ) {

      const duration =
        Number(
          detectedService.duration
        ) || 30;

      if (
        isSlotFree(
          requestedDate,
          requestedTime,
          duration
        )
      ) {

        return res.status(200).json({

          reply:
            `Perfetto. Ho verificato la disponibilità ` +
            `per ${detectedService.name} ` +
            `il ${requestedDate} alle ${requestedTime}. ` +
            `Vuoi confermare l'appuntamento?`,

          appointment: null,

          pendingAppointment: {

            name:
              String(clientName).trim(),

            service:
              detectedService.name,

            date:
              requestedDate,

            time:
              requestedTime

          },

          requiresConfirmation: true,

          confirmed: false

        });

      }

      const alternatives =
        findAvailableSlots(
          requestedDate,
          duration
        );

      return res.status(200).json({

        reply:
          alternatives.length
            ? `L'orario ${requestedTime} non è disponibile. ` +
              `Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
            : "Non ci sono altri orari disponibili quel giorno.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false

      });

    }

    /* ============================================================
       DA QUI IN POI SERVE OPENAI
    ============================================================ */

    if (!process.env.OPENAI_API_KEY) {

      return res.status(500).json({

        error:
          "OPENAI_API_KEY non disponibile nel deployment Vercel"

      });

    }

    const client =
      new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY
      });

    /* ============================================================
       INFORMAZIONI PER OPENAI
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

    const serviceList =
      services.length
        ? services
          .map(service =>
            `- ${service.name}: €${service.price} (${service.duration} minuti)`
          )
          .join("\n")
        : "Nessun servizio inserito.";

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
          .slice(-20)
        : [];

    /* ============================================================
       OPENAI
    ============================================================ */

    const response =
      await client.responses.create({

        model:
          "gpt-5.4-mini",

        instructions: `

Sei l'assistente virtuale di ${
          business ||
          "un'attività locale italiana"
        }.

Rispondi sempre in italiano.

Aiuta il cliente con informazioni sull'attività,
servizi e appuntamenti.

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
APPUNTAMENTO PENDENTE
==================================================

${
  pendingAppointment
    ? JSON.stringify(
        pendingAppointment,
        null,
        2
      )
    : "Nessuno"
}

==================================================
REGOLE
==================================================

- Rispondi sempre in italiano.
- Non inventare servizi.
- Non inventare prezzi.
- Non inventare disponibilità.
- Usa esclusivamente i dati forniti.
- Usa l'intera conversazione.
- Non chiedere nuovamente dati già forniti.
- Se manca un dato per una prenotazione,
  chiedi solamente quel dato.
- Quando sono presenti nome, servizio, data e ora,
  prepara una richiesta di conferma.
- Non dire mai che un appuntamento è confermato
  prima della conferma esplicita.

==================================================
FORMATO
==================================================

Restituisci SEMPRE esclusivamente JSON valido:

{
  "reply": "...",
  "appointment": null,
  "pendingAppointment": null,
  "requiresConfirmation": false,
  "confirmed": false
}

`,

        input: [

          ...safeHistory,

          {
            role: "user",
            content: message
          }

        ]

      });

    /* ============================================================
       PARSING RISPOSTA OPENAI
    ============================================================ */

    let result;

    try {

      result =
        JSON.parse(
          response.output_text
        );

    } catch {

      result = {

        reply:
          response.output_text ||
          "Non ho capito la richiesta.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false

      };

    }

    if (
      !result ||
      typeof result !== "object"
    ) {

      result = {

        reply:
          "Non ho capito la richiesta.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false

      };

    }

    /* ============================================================
       NORMALIZZAZIONE PENDING
    ============================================================ */

    if (
      result.pendingAppointment
    ) {

      const pending =
        result.pendingAppointment;

      const service =
        getService(
          pending.service
        ) ||
        findServiceInText(message);

      if (!service) {

        return res.status(200).json({

          reply:
            "Non trovo questo servizio nel listino dell'attività.",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false

        });

      }

      const name =
        String(
          pending.name ||
          clientName ||
          ""
        ).trim();

      const date =
        String(
          pending.date || ""
        ).trim();

      const rawTime =
        String(
          pending.time || ""
        )
        .trim()
        .replace(".", ":");

      const minutes =
        toMinutes(rawTime);

      const time =
        minutes !== null
          ? formatTime(minutes)
          : "";

      const normalizedPending = {

        name,

        service:
          service.name,

        date,

        time

      };

      const complete =
        !!(
          name &&
          service.name &&
          /^\d{4}-\d{2}-\d{2}$/.test(date) &&
          time
        );

      if (!complete) {

        return res.status(200).json({

          reply:
            result.reply,

          appointment: null,

          pendingAppointment:
            normalizedPending,

          requiresConfirmation: false,

          confirmed: false

        });

      }

      const day =
        getDaySettings(date);

      if (
        !day ||
        day.status === "closed"
      ) {

        return res.status(200).json({

          reply:
            "L'attività è chiusa nel giorno richiesto. Scegli un altro giorno.",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false

        });

      }

      const duration =
        Number(service.duration) || 30;

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
              ? `L'orario ${time} non è disponibile. ` +
                `Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
              : "Non ci sono altri orari disponibili quel giorno.",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false

        });

      }

      return res.status(200).json({

        reply:
          `Perfetto. Ho verificato la disponibilità ` +
          `per ${service.name} il ${date} alle ${time}. ` +
          `Vuoi confermare l'appuntamento?`,

        appointment: null,

        pendingAppointment:
          normalizedPending,

        requiresConfirmation: true,

        confirmed: false

      });

    }

    /* ============================================================
       RISPOSTA FINALE
    ============================================================ */

    return res.status(200).json({

      reply:
        result.reply,

      appointment:
        result.confirmed
          ? result.appointment || null
          : null,

      pendingAppointment:
        result.pendingAppointment || null,

      requiresConfirmation:
        !!result.requiresConfirmation,

      confirmed:
        !!result.confirmed

    });

  } catch (error) {

    console.error(
      "OPENAI ERROR:",
      error
    );

    /* ============================================================
       GESTIONE RATE LIMIT
    ============================================================ */

    if (
      error?.status === 429 ||
      error?.code === "rate_limit_exceeded"
    ) {

      return res.status(200).json({

        reply:
          "L'assistente AI è temporaneamente occupato. " +
          "Le funzioni di calendario restano disponibili.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false,

        temporaryError: true

      });

    }

    return res.status(500).json({

      error:
        error?.message ||
        "Errore durante la richiesta AI"

    });

  }

}
