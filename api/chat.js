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

    const appointmentInterval =
      Number(settings.appointmentInterval) || 30;

    function toMinutes(value) {
      if (!value || !value.includes(":")) return null;

      const [h, m] = value.split(":").map(Number);

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

    function findAvailableSlots(date, duration) {

      const dayName = getDayName(date);

      const dayHours = hours[dayName];

      if (!dayHours || dayHours.status === "closed") {
        return [];
      }

      const opening = toMinutes(dayHours.open);
      const closing = toMinutes(dayHours.close);

      if (opening === null || closing === null) {
        return [];
      }

      const slots = [];

      for (
        let start = opening;
        start + duration <= closing;
        start += appointmentInterval
      ) {

        const end = start + duration;

        const conflict = appointments.some(a => {

          if (a.d !== date || !a.t) {
            return false;
          }

          const existingStart = toMinutes(a.t);

          if (existingStart === null) {
            return false;
          }

          let existingDuration = 30;

          const existingService = services.find(
            s =>
              String(s.name).toLowerCase() ===
              String(a.s || "").toLowerCase()
          );

          if (existingService) {
            existingDuration =
              Number(existingService.duration) || 30;
          }

          const existingEnd =
            existingStart + existingDuration;

          return (
            start < existingEnd &&
            end > existingStart
          );
        });

        if (!conflict) {
          slots.push(formatTime(start));
        }
      }

      return slots;
    }

    function formatDay(name, day) {

      if (!day || day.status === "closed") {
        return `${name}: Chiuso`;
      }

      return `${name}: ${day.open || "--:--"} - ${day.close || "--:--"}`;
    }

    const openingHours = [
      formatDay("Lunedì", hours.monday),
      formatDay("Martedì", hours.tuesday),
      formatDay("Mercoledì", hours.wednesday),
      formatDay("Giovedì", hours.thursday),
      formatDay("Venerdì", hours.friday),
      formatDay("Sabato", hours.saturday),
      formatDay("Domenica", hours.sunday)
    ].join("\n");

    const serviceList = services.length
      ? services
          .map(
            s =>
              `- ${s.name}: €${s.price} (${s.duration} minuti)`
          )
          .join("\n")
      : "Nessun servizio inserito.";

    const appointmentList = appointments.length
      ? appointments
          .map(
            a =>
              `- ${a.n || "Cliente"} | ${a.s || "Servizio"} | ${a.d || "Data"} | ${a.t || "Ora"}`
          )
          .join("\n")
      : "Nessun appuntamento presente.";

    const conversation = [
      ...history,
      {
        role: "user",
        content: message
      }
    ];

    const response = await client.responses.create({

      model: "gpt-5.4-mini",

      instructions: `Sei l'assistente virtuale di ${
        business || "un'attività locale italiana"
      }.

TIPO ATTIVITÀ:
${settings.type || "Non specificato"}

DESCRIZIONE:
${settings.description || "Non specificata"}

INDIRIZZO:
${settings.address || "Non specificato"}

TELEFONO:
${settings.phone || "Non specificato"}

WHATSAPP:
${settings.whatsapp || "Non specificato"}

ORARI:
${openingHours}

INTERVALLO APPUNTAMENTI:
${appointmentInterval} minuti

SERVIZI:
${serviceList}

APPUNTAMENTI ESISTENTI:
${appointmentList}

REGOLE:

1. Rispondi sempre in italiano.
2. Non inventare informazioni.
3. Usa esclusivamente i servizi presenti nel listino.
4. Usa esclusivamente i prezzi presenti nel listino.
5. Usa esclusivamente gli orari presenti.
6. Non proporre appuntamenti quando l'attività è chiusa.
7. Non dichiarare mai che una prenotazione è realmente confermata.
8. Puoi raccogliere una richiesta di appuntamento.
9. Per una richiesta servono nome, servizio, giorno e ora.
10. La durata del servizio deve essere rispettata.
11. Non creare sovrapposizioni con appuntamenti esistenti.
12. Se l'orario richiesto non è disponibile, considera gli slot liberi forniti dal sistema.

Quando tutti i dati sono presenti:

{
  "reply": "testo naturale",
  "appointment": {
    "name": "nome",
    "service": "servizio",
    "date": "YYYY-MM-DD",
    "time": "HH:MM"
  }
}

Se manca un dato:

{
  "reply": "testo naturale per chiedere il dato mancante",
  "appointment": null
}

Restituisci SEMPRE JSON valido.
Non scrivere testo fuori dal JSON.`,

      input: conversation
    });

    let result;

    try {
      result = JSON.parse(response.output_text);
    } catch {
      result = {
        reply: response.output_text,
        appointment: null
      };
    }

    /*
     * CONTROLLO APPUNTAMENTO
     */

    if (result.appointment) {

      const requested = result.appointment;

      const service = services.find(
        s =>
          String(s.name).toLowerCase() ===
          String(requested.service).toLowerCase()
      );

      if (!service) {

        return res.status(200).json({
          reply:
            "Non trovo questo servizio nel listino dell'attività.",
          appointment: null
        });
      }

      const duration = Number(service.duration);

      if (!duration || duration <= 0) {

        return res.status(200).json({
          reply:
            "La durata del servizio non è configurata correttamente.",
          appointment: null
        });
      }

      const date = requested.date;
      const time = requested.time;

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {

        return res.status(200).json({
          reply: "La data dell'appuntamento non è valida.",
          appointment: null
        });
      }

      if (!/^\d{2}:\d{2}$/.test(time)) {

        return res.status(200).json({
          reply: "L'orario dell'appuntamento non è valido.",
          appointment: null
        });
      }

      const dayName = getDayName(date);

      const dayHours = hours[dayName];

      if (!dayHours || dayHours.status === "closed") {

        return res.status(200).json({
          reply:
            "L'attività è chiusa nel giorno richiesto. Scegli un altro giorno.",
          appointment: null
        });
      }

      const requestedStart = toMinutes(time);

      if (requestedStart === null) {

        return res.status(200).json({
          reply: "L'orario non è valido.",
          appointment: null
        });
      }

      const requestedEnd =
        requestedStart + duration;

      const opening = toMinutes(dayHours.open);
      const closing = toMinutes(dayHours.close);

      if (
        requestedStart < opening ||
        requestedEnd > closing
      ) {

        return res.status(200).json({
          reply:
            `Il servizio dura ${duration} minuti. ` +
            `L'attività è aperta dalle ${dayHours.open} alle ${dayHours.close}.`,
          appointment: null
        });
      }

      const conflict = appointments.some(a => {

        if (a.d !== date || !a.t) {
          return false;
        }

        const existingStart = toMinutes(a.t);

        if (existingStart === null) {
          return false;
        }

        let existingDuration = 30;

        const existingService = services.find(
          s =>
            String(s.name).toLowerCase() ===
            String(a.s || "").toLowerCase()
        );

        if (existingService) {
          existingDuration =
            Number(existingService.duration) || 30;
        }

        const existingEnd =
          existingStart + existingDuration;

        return (
          requestedStart < existingEnd &&
          requestedEnd > existingStart
        );
      });

      if (conflict) {

        const availableSlots =
          findAvailableSlots(date, duration);

        const suggestions =
          availableSlots
            .filter(slot => slot !== time)
            .slice(0, 3);

        if (suggestions.length) {

          return res.status(200).json({
            reply:
              `L'orario ${time} non è disponibile. ` +
              `Gli orari disponibili sono: ` +
              `${suggestions.join(", ")}.`,
            appointment: null
          });
        }

        return res.status(200).json({
          reply:
            "L'orario richiesto non è disponibile e non ci sono altri slot liberi quel giorno.",
          appointment: null
        });
      }

      result.appointment = {
        name:
          requested.name ||
          clientName ||
          "",
        service: service.name,
        date,
        time
      };
    }

    return res.status(200).json(result);

  } catch (error) {

    console.error("OPENAI ERROR:", error);

    return res.status(500).json({
      error:
        error?.message ||
        "Errore durante la richiesta AI"
    });
  }
}
