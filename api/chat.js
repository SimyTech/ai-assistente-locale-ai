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

    function formatDay(name, day) {

      if (!day || day.status === "closed") {
        return `${name}: Chiuso`;
      }
function findAvailableSlots(date, duration) {

  const requestedDate = new Date(`${date}T12:00:00`);

  const dayIndex = requestedDate.getDay();

  const dayMap = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
  ];

  const dayName = dayMap[dayIndex];

  const dayHours = hours[dayName];

  if (!dayHours || dayHours.status === "closed") {
    return [];
  }

  function toMinutes(value) {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  }

  function formatTime(minutes) {
    const h = String(Math.floor(minutes / 60)).padStart(2, "0");
    const m = String(minutes % 60).padStart(2, "0");

    return `${h}:${m}`;
  }

  const opening = toMinutes(dayHours.open);
  const closing = toMinutes(dayHours.close);

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
      ? services.map(s =>
          `- ${s.name}: €${s.price} (${s.duration} minuti)`
        ).join("\n")
      : "Nessun servizio inserito.";

    const appointmentList = appointments.length
      ? appointments.map(a =>
          `- ${a.n || "Cliente"} | ${a.s || "Servizio"} | ${a.d || "Data"} | ${a.t || "Ora"}`
        ).join("\n")
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

SERVIZI:
${serviceList}

APPUNTAMENTI ESISTENTI:
${appointmentList}

REGOLE:

1. Rispondi sempre in italiano.
2. Non inventare informazioni.
3. Usa esclusivamente i servizi presenti nel listino.
4. Usa esclusivamente i prezzi presenti nel listino.
5. Usa esclusivamente gli orari presenti negli orari dell'attività.
6. Non proporre appuntamenti quando l'attività è chiusa.
7. Non dichiarare mai che una prenotazione è realmente confermata.
8. Puoi raccogliere una richiesta di appuntamento.
9. Per una richiesta servono:
   - nome
   - servizio
   - giorno
   - ora

IMPORTANTE:

Quando raccogli un appuntamento devi trasformare SEMPRE:

data → formato YYYY-MM-DD
ora → formato HH:MM

Esempio:

{
  "reply": "Ho raccolto la tua richiesta per il taglio di capelli.",
  "appointment": {
    "name": "Mario",
    "service": "Taglio",
    "date": "2026-08-28",
    "time": "15:00"
  }
}

Se manca un dato:

{
  "reply": "testo per chiedere il dato mancante",
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
     * CONTROLLO DISPONIBILITÀ
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
          reply: "Non trovo questo servizio nel listino dell'attività.",
          appointment: null
        });
      }

      const duration = Number(service.duration);

      if (!duration || duration <= 0) {

        return res.status(200).json({
          reply: "La durata del servizio non è configurata correttamente.",
          appointment: null
        });
      }

      const date = requested.date;
      const time = requested.time;

      /*
       * Verifica formato data
       */

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {

        return res.status(200).json({
          reply: "Ho bisogno della data dell'appuntamento.",
          appointment: null
        });
      }

      /*
       * Verifica formato ora
       */

      if (!/^\d{2}:\d{2}$/.test(time)) {

        return res.status(200).json({
          reply: "Ho bisogno dell'orario dell'appuntamento.",
          appointment: null
        });
      }

      /*
       * Giorno della settimana
       */

      const requestedDate = new Date(`${date}T12:00:00`);

      const dayIndex = requestedDate.getDay();

      const dayMap = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday"
      ];

      const dayName = dayMap[dayIndex];

      const dayHours = hours[dayName];

      /*
       * Controllo giorno chiuso
       */

      if (!dayHours || dayHours.status === "closed") {

        return res.status(200).json({
          reply: "L'attività è chiusa nel giorno richiesto. Scegli un altro giorno.",
          appointment: null
        });
      }

      /*
       * Conversione minuti
       */

      function toMinutes(value) {

        const [h, m] = value.split(":").map(Number);

        return h * 60 + m;
      }

      const requestedStart = toMinutes(time);

      const requestedEnd = requestedStart + duration;

      const opening = toMinutes(dayHours.open);
      const closing = toMinutes(dayHours.close);

      /*
       * Controllo orario di apertura
       */

      if (
        requestedStart < opening ||
        requestedEnd > closing
      ) {

        return res.status(200).json({
          reply:
            `Il servizio dura ${duration} minuti e non può essere effettuato in quell'orario. ` +
            `L'attività è aperta dalle ${dayHours.open} alle ${dayHours.close}. Scegli un altro orario.`,
          appointment: null
        });
      }

      /*
       * Controllo sovrapposizione appuntamenti
       */

      const conflict = appointments.find(a => {

        if (a.d !== date) {
          return false;
        }

        if (!a.t) {
          return false;
        }

        const existingStart = toMinutes(a.t);

        let existingDuration = 30;

        const existingService = services.find(
          s =>
            String(s.name).toLowerCase() ===
            String(a.s || "").toLowerCase()
        );

        if (existingService) {
          existingDuration = Number(existingService.duration) || 30;
        }

        const existingEnd =
          existingStart + existingDuration;

        return (
          requestedStart < existingEnd &&
          requestedEnd > existingStart
        );
      });

      if (conflict) {

        return res.status(200).json({
          reply:
            `L'orario ${time} non è disponibile perché è già presente un appuntamento. ` +
            `Scegli un altro orario.`,
          appointment: null
        });
      }

      /*
       * Tutti i controlli superati
       */

      result.appointment = {
        name: requested.name || clientName || "",
        service: service.name,
        date,
        time
      };
    }

    return res.status(200).json(result);

  } catch (error) {

    console.error("OPENAI ERROR:", error);

    return res.status(500).json({
      error: error?.message || "Errore durante la richiesta AI"
    });
  }
}
