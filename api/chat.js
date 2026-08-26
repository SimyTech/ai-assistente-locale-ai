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
      history = []
    } = req.body || {};

    if (!message) {
      return res.status(400).json({
        error: "Messaggio mancante"
      });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const hours = settings.hours || {};
    const interval = 30;

    function toMinutes(time) {
      if (!time || !/^\d{2}:\d{2}$/.test(time)) {
        return null;
      }

      const [h, m] = time.split(":").map(Number);

      return h * 60 + m;
    }

    function formatTime(minutes) {
      const h = String(Math.floor(minutes / 60)).padStart(2, "0");
      const m = String(minutes % 60).padStart(2, "0");

      return `${h}:${m}`;
    }

    function getDayName(date) {
      const d = new Date(`${date}T12:00:00`);

      const days = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday"
      ];

      return days[d.getDay()];
    }

    function getService(name) {
      return services.find(
        s =>
          String(s.name).trim().toLowerCase() ===
          String(name).trim().toLowerCase()
      );
    }

    function overlapsBreak(start, end, day) {
      const breakStart = toMinutes(day.breakStart);
      const breakEnd = toMinutes(day.breakEnd);

      if (
        breakStart === null ||
        breakEnd === null ||
        breakStart >= breakEnd
      ) {
        return false;
      }

      return start < breakEnd && end > breakStart;
    }

    function isSlotFree(date, startTime, duration) {
      const dayName = getDayName(date);
      const day = hours[dayName];

      if (!day || day.status === "closed") {
        return false;
      }

      const opening = toMinutes(day.open);
      const closing = toMinutes(day.close);
      const start = toMinutes(startTime);

      if (
        opening === null ||
        closing === null ||
        start === null
      ) {
        return false;
      }

      const end = start + duration;

      // Fuori dagli orari di apertura
      if (start < opening || end > closing) {
        return false;
      }

      // Dentro la pausa
      if (overlapsBreak(start, end, day)) {
        return false;
      }

      // Controllo appuntamenti esistenti
      return !appointments.some(a => {
        if (a.d !== date || !a.t) {
          return false;
        }

        const existingStart = toMinutes(a.t);

        if (existingStart === null) {
          return false;
        }

        const existingService = getService(a.s);

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
      const dayName = getDayName(date);
      const day = hours[dayName];

      if (!day || day.status === "closed") {
        return [];
      }

      const opening = toMinutes(day.open);
      const closing = toMinutes(day.close);

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
        start += interval
      ) {
        const time = formatTime(start);

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

    const openingHours = Object.entries({
      monday: "Lunedì",
      tuesday: "Martedì",
      wednesday: "Mercoledì",
      thursday: "Giovedì",
      friday: "Venerdì",
      saturday: "Sabato",
      sunday: "Domenica"
    })
      .map(([key, label]) => {
        const d = hours[key];

        if (!d || d.status === "closed") {
          return `${label}: Chiuso`;
        }

        let text =
          `${label}: ${d.open} - ${d.close}`;

        if (
          d.breakStart &&
          d.breakEnd
        ) {
          text +=
            ` (pausa ${d.breakStart}-${d.breakEnd})`;
        }

        return text;
      })
      .join("\n");

    const serviceList = services.length
      ? services
          .map(
            s =>
              `- ${s.name}: €${s.price} (${s.duration} minuti)`
          )
          .join("\n")
      : "Nessun servizio inserito.";

    const response =
      await client.responses.create({

        model: "gpt-5.4-mini",

        instructions: `
Sei l'assistente virtuale di ${
          business || "un'attività locale italiana"
        }.

Rispondi sempre in italiano.

INFORMAZIONI ATTIVITÀ

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

REGOLE:

- Usa esclusivamente i servizi presenti nel listino.
- Non inventare prezzi.
- Non inventare servizi.
- Non decidere autonomamente se un orario è disponibile.
- La disponibilità viene controllata dal sistema.
- Se il cliente vuole un appuntamento, raccogli nome, servizio, data e ora.
- Se manca un dato, chiedilo.
- Non dichiarare mai che un appuntamento è realmente prenotato.
- La richiesta viene soltanto raccolta dopo il controllo del sistema.

Restituisci sempre JSON valido.

Se hai tutti i dati:

{
  "reply": "Richiesta di appuntamento raccolta.",
  "appointment": {
    "name": "nome",
    "service": "servizio",
    "date": "YYYY-MM-DD",
    "time": "HH:MM"
  }
}

Se manca un dato:

{
  "reply": "domanda per ottenere il dato mancante",
  "appointment": null
}

Non scrivere testo fuori dal JSON.
`,

        input: [
          ...history,
          {
            role: "user",
            content: message
          }
        ]
      });

    let result;

    try {
      result =
        JSON.parse(response.output_text);
    } catch {
      result = {
        reply: response.output_text,
        appointment: null
      };
    }

    /*
     * CONTROLLO REALE APPUNTAMENTO
     */

    if (result.appointment) {

      const requested =
        result.appointment;

      const service =
        getService(requested.service);

      if (!service) {
        return res.status(200).json({
          reply:
            "Non trovo questo servizio nel listino dell'attività.",
          appointment: null
        });
      }

      const duration =
        Number(service.duration);

      if (!duration || duration <= 0) {
        return res.status(200).json({
          reply:
            "La durata del servizio non è configurata correttamente.",
          appointment: null
        });
      }

      const date =
        requested.date;

      const time =
        requested.time;

      const dayName =
        getDayName(date);

      const day =
        hours[dayName];

      if (!day || day.status === "closed") {

        return res.status(200).json({
          reply:
            "L'attività è chiusa nel giorno richiesto. Scegli un altro giorno.",
          appointment: null
        });
      }

      /*
       * CONTROLLO ORARIO
       */

      const free =
        isSlotFree(
          date,
          time,
          duration
        );

      if (!free) {

        const availableSlots =
          findAvailableSlots(
            date,
            duration
          );

        const requestedMinutes =
          toMinutes(time);

        const sortedSlots =
          availableSlots
            .map(slot => ({
              slot,
              distance:
                Math.abs(
                  toMinutes(slot) -
                  requestedMinutes
                )
            }))
            .sort(
              (a, b) =>
                a.distance -
                b.distance
            )
            .slice(0, 3)
            .map(x => x.slot);

        if (sortedSlots.length > 0) {

          return res.status(200).json({
            reply:
              `L'orario ${time} non è disponibile. ` +
              `Posso proporti questi orari: ` +
              `${sortedSlots.join(", ")}.`,
            appointment: null
          });

        }

        return res.status(200).json({
          reply:
            "Non ci sono altri slot disponibili quel giorno.",
          appointment: null
        });
      }

      /*
       * SLOT LIBERO
       */

      return res.status(200).json({
        reply:
          `Perfetto. Ho raccolto la richiesta per ` +
          `${service.name} alle ${time}.`,
        appointment: {
          name:
            requested.name ||
            clientName ||
            "",
          service: service.name,
          date: date,
          time: time
        }
      });
    }

    return res.status(200).json(result);

  } catch (error) {

    console.error(
      "OPENAI ERROR:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Errore durante la richiesta AI"
    });
  }
}
