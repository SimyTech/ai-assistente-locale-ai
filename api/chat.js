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
      pendingAppointment = null
    } = req.body || {};

    if (!message) {
      return res.status(400).json({
        error: "Messaggio mancante"
      });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    /* =========================
       UTILITÀ
    ========================= */

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
      const h = String(
        Math.floor(minutes / 60)
      ).padStart(2, "0");

      const m = String(
        minutes % 60
      ).padStart(2, "0");

      return `${h}:${m}`;
    }

    /*
     * Calcolo deterministico del giorno.
     * Evita problemi di fuso orario su Vercel.
     */

    function getDayName(date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return null;
      }

      const [year, month, day] =
        date.split("-").map(Number);

      const d = new Date(
        Date.UTC(
          year,
          month - 1,
          day
        )
      );

      const days = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday"
      ];

      return days[d.getUTCDay()];
    }

    function getService(name) {
      if (!name) {
        return null;
      }

      return services.find(
        s =>
          String(s.name)
            .trim()
            .toLowerCase() ===
          String(name)
            .trim()
            .toLowerCase()
      );
    }

    function overlapsBreak(
      start,
      end,
      day
    ) {
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

    /* =========================
       CONTROLLO DISPONIBILITÀ
    ========================= */

    function isSlotFree(
      date,
      startTime,
      duration
    ) {
      const dayName =
        getDayName(date);

      const day =
        hours[dayName];

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
        toMinutes(startTime);

      if (
        opening === null ||
        closing === null ||
        start === null
      ) {
        return false;
      }

      const end =
        start + duration;

      /*
       * Fuori dagli orari
       */

      if (
        start < opening ||
        end > closing
      ) {
        return false;
      }

      /*
       * Dentro la pausa
       */

      if (
        overlapsBreak(
          start,
          end,
          day
        )
      ) {
        return false;
      }

      /*
       * Controllo appuntamenti
       */

      return !appointments.some(a => {

        if (
          a.d !== date ||
          !a.t
        ) {
          return false;
        }

        const existingStart =
          toMinutes(a.t);

        if (
          existingStart === null
        ) {
          return false;
        }

        const existingService =
          getService(a.s);

        const existingDuration =
          existingService
            ? Number(
                existingService.duration
              ) || 30
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
      duration
    ) {
      const dayName =
        getDayName(date);

      const day =
        hours[dayName];

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
        start += interval
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

    /* =========================
       ORARI
    ========================= */

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

          const d =
            hours[key];

          if (
            !d ||
            d.status === "closed"
          ) {
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

    /* =========================
       DATA ODIERNA
    ========================= */

    const today =
      new Intl.DateTimeFormat(
        "it-IT",
        {
          timeZone: "Europe/Rome",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }
      ).format(new Date());

    /* =========================
       CLIENTE
    ========================= */

    const clientInfo =
      clientName
        ? `Nome cliente già fornito: ${clientName}`
        : "Nome cliente non ancora fornito.";

    /* =========================
       SERVIZI
    ========================= */

    const serviceList =
      services.length
        ? services
            .map(
              s =>
                `- ${s.name}: €${s.price} (${s.duration} minuti)`
            )
            .join("\n")
        : "Nessun servizio inserito.";

    /* =========================
       CRONOLOGIA
    ========================= */

    const conversationHistory =
      Array.isArray(history)
        ? history
        : [];

    const fullConversation = [
      ...conversationHistory,
      {
        role: "user",
        content: message
      }
    ];

    /* =========================
       CONFERMA
    ========================= */

    const confirmationWords = [
      "si",
      "sì",
      "confermo",
      "conferma",
      "ok",
      "va bene",
      "procedi",
      "prenota",
      "prenotalo",
      "confermo l'appuntamento",
      "confermo appuntamento"
    ];

    const normalizedMessage =
      String(message || "")
        .trim()
        .toLowerCase()
        .replace(/[!?.,]/g, "");

    const isConfirmation =
      confirmationWords.includes(
        normalizedMessage
      );

    /*
     * Se esiste un appuntamento
     * in attesa e il cliente conferma,
     * ricontrolliamo la disponibilità.
     */

    if (
      pendingAppointment &&
      isConfirmation
    ) {

      const requested =
        pendingAppointment;

      const service =
        getService(
          requested.service
        );

      if (!service) {
        return res.status(200).json({
          reply:
            "Il servizio non è più presente nel listino.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });
      }

      const duration =
        Number(service.duration);

      if (
        !duration ||
        duration <= 0
      ) {
        return res.status(200).json({
          reply:
            "La durata del servizio non è configurata correttamente.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });
      }

      const free =
        isSlotFree(
          requested.date,
          requested.time,
          duration
        );

      if (!free) {

        return res.status(200).json({
          reply:
            "Mi dispiace, l'orario non è più disponibile. La disponibilità è cambiata.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });

      }

      return res.status(200).json({

        reply:
          `Appuntamento confermato per ` +
          `${service.name} il ` +
          `${requested.date} ` +
          `alle ${requested.time}.`,

        appointment: {

          name:
            requested.name ||
            clientName ||
            "",

          service:
            service.name,

          date:
            requested.date,

          time:
            requested.time

        },

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: true

      });
    }

    /* =========================
       AI
    ========================= */

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

Il tuo compito è assistere i clienti e raccogliere richieste di appuntamento.

========================
INFORMAZIONI ATTIVITÀ
========================

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

DATA ODIERNA IN ITALIA:
${today}

${clientInfo}

========================
REGOLE GENERALI
========================

- Rispondi sempre in italiano.
- Usa esclusivamente i servizi presenti nel listino.
- Non inventare servizi.
- Non inventare prezzi.
- Non inventare durate.
- Non inventare disponibilità.
- La disponibilità viene controllata dal server.
- Devi utilizzare l'intera cronologia della conversazione.
- Un'informazione già fornita dal cliente deve essere conservata.
- Non cancellare un dato già raccolto quando il messaggio successivo contiene un altro dato.
- Se il cliente ha già indicato un dato, non chiederlo nuovamente.
- Se manca davvero un dato, chiedi esclusivamente quel dato.

========================
DATI APPUNTAMENTO
========================

I quattro dati principali sono:

name
service
date
time

Questi dati possono essere forniti in messaggi diversi.

Devi ricostruire l'appuntamento utilizzando l'intera conversazione.

========================
SERVIZIO
========================

Un servizio è valido solamente se corrisponde a un servizio presente nel listino.

Se il cliente scrive:

"taglio uomo lunedì 31"

e nel listino esiste:

"Taglio uomo"

devi riconoscere:

service = "Taglio uomo"

e conservarlo nei messaggi successivi.

Se successivamente il cliente scrive:

"lunedì 31 agosto"

NON devi dimenticare:

service = "Taglio uomo"

Non chiedere nuovamente il servizio.

========================
ORARIO
========================

Le seguenti espressioni indicano un ORARIO:

"15"
"ore 15"
"alle 15"
"15.00"
"15:00"

Devono essere interpretate come:

time = "15:00"

MAI come nome di un servizio.

Se il cliente scrive solamente:

"ore 15"

devi conservare tutti gli altri dati già raccolti e aggiornare solamente l'ora.

========================
DATE
========================

La data deve essere restituita nel formato:

YYYY-MM-DD

Esempio:

31 agosto 2026

deve diventare:

2026-08-31

Se il cliente scrive:

"lunedì 31 agosto 2026"

devi usare:

2026-08-31

Se il cliente ha già fornito servizio e ora e successivamente fornisce la data, devi mantenere servizio e ora.

========================
NOME
========================

Se il nome è già stato fornito:

NON chiederlo nuovamente.

Se il nome non è disponibile, chiedilo solamente quando è necessario per completare la prenotazione.

========================
CONFERMA
========================

Quando sono presenti:

nome
servizio
data
ora

NON confermare automaticamente la prenotazione.

Prima devi restituire una richiesta di conferma.

Esempio:

{
  "reply": "Taglio uomo è disponibile il 31 agosto 2026 alle 15:00. Vuoi confermare l'appuntamento?",
  "appointment": null,
  "pendingAppointment": {
    "name": "Simone",
    "service": "Taglio uomo",
    "date": "2026-08-31",
    "time": "15:00"
  },
  "requiresConfirmation": true,
  "confirmed": false
}

Il server controllerà nuovamente la disponibilità quando il cliente risponderà sì.

========================
DATI MANCANTI
========================

Se manca il servizio:

{
  "reply": "Quale servizio vuoi prenotare?",
  "appointment": null,
  "pendingAppointment": null,
  "requiresConfirmation": false,
  "confirmed": false
}

Se manca la data:

{
  "reply": "Per quale data vuoi prenotare?",
  "appointment": null,
  "pendingAppointment": null,
  "requiresConfirmation": false,
  "confirmed": false
}

Se manca l'ora:

{
  "reply": "A che ora preferisci?",
  "appointment": null,
  "pendingAppointment": null,
  "requiresConfirmation": false,
  "confirmed": false
}

Se manca il nome:

{
  "reply": "Come ti chiami?",
  "appointment": null,
  "pendingAppointment": null,
  "requiresConfirmation": false,
  "confirmed": false
}

Chiedi SOLO il dato realmente mancante.

========================
ESEMPIO COMPLETO
========================

Cliente:

"taglio uomo lunedì 31"

Dati:

service = "Taglio uomo"

data parziale = lunedì 31

Cliente:

"lunedì 31 agosto 2026"

Devi mantenere:

service = "Taglio uomo"

e ottenere:

date = "2026-08-31"

Cliente:

"ore 15"

Devi mantenere:

service = "Taglio uomo"
date = "2026-08-31"

e ottenere:

time = "15:00"

Se il nome è disponibile, devi conservarlo.

Quando tutti i dati sono disponibili, NON salvare direttamente l'appuntamento.

Richiedi prima conferma.

========================
FORMATO
========================

Restituisci SEMPRE e SOLTANTO JSON valido.

Non scrivere testo fuori dal JSON.

`,

        input:
          fullConversation

      });

    /* =========================
       LETTURA RISPOSTA AI
    ========================= */

    let result;

    try {

      result =
        JSON.parse(
          response.output_text
        );

    } catch {

      result = {

        reply:
          response.output_text,

        appointment:
          null,

        pendingAppointment:
          null,

        requiresConfirmation:
          false,

        confirmed:
          false

      };

    }

    /* =========================
       CONTROLLO APPUNTAMENTO
       PROPOSTO DALL'AI
    ========================= */

    /*
     * Se l'AI ha raccolto
     * un appuntamento completo,
     * verifichiamo il servizio.
     */

    if (
      result.pendingAppointment
    ) {

      const requested =
        result.pendingAppointment;

      const service =
        getService(
          requested.service
        );

      if (!service) {

        return res.status(200).json({

          reply:
            "Non trovo questo servizio nel listino dell'attività.",

          appointment:
            null,

          pendingAppointment:
            null,

          requiresConfirmation:
            false,

          confirmed:
            false

        });

      }

      const duration =
        Number(
          service.duration
        );

      if (
        !duration ||
        duration <= 0
      ) {

        return res.status(200).json({

          reply:
            "La durata del servizio non è configurata correttamente.",

          appointment:
            null,

          pendingAppointment:
            null,

          requiresConfirmation:
            false,

          confirmed:
            false

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

      /* =========================
         CONTROLLO GIORNO
      ========================= */

      if (
        !day ||
        day.status === "closed"
      ) {

        return res.status(200).json({

          reply:
            "L'attività è chiusa nel giorno richiesto. Scegli un altro giorno.",

          appointment:
            null,

          pendingAppointment:
            null,

          requiresConfirmation:
            false,

          confirmed:
            false

        });

      }

      /* =========================
         CONTROLLO ORARIO
      ========================= */

      const requestedMinutes =
        toMinutes(time);

      if (
        requestedMinutes === null
      ) {

        return res.status(200).json({

          reply:
            "L'orario indicato non è valido. Inserisci un orario, ad esempio 15:00.",

          appointment:
            null,

          pendingAppointment:
            null,

          requiresConfirmation:
            false,

          confirmed:
            false

        });

      }

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
            .map(
              x => x.slot
            );

        if (
          sortedSlots.length > 0
        ) {

          return res.status(200).json({

            reply:
              `L'orario ${time} non è disponibile. ` +
              `Posso proporti questi orari: ` +
              `${sortedSlots.join(", ")}.`,

            appointment:
              null,

            pendingAppointment:
              null,

            requiresConfirmation:
              false,

            confirmed:
              false

          });

        }

        return res.status(200).json({

          reply:
            "Non ci sono altri slot disponibili quel giorno.",

          appointment:
            null,

          pendingAppointment:
            null,

          requiresConfirmation:
            false,

          confirmed:
            false

        });

      }

      /* =========================
         DISPONIBILE:
         RICHIEDI CONFERMA
      ========================= */

      return res.status(200).json({

        reply:
          `${service.name} è disponibile il ` +
          `${date} alle ${time}. ` +
          `Vuoi confermare l'appuntamento?`,

        appointment:
          null,

        pendingAppointment: {

          name:
            requested.name ||
            clientName ||
            "",

          service:
            service.name,

          date:
            date,

          time:
            time

        },

        requiresConfirmation:
          true,

        confirmed:
          false

      });

    }

    /* =========================
       RISPOSTA NORMALE
    ========================= */

    return res.status(200).json({

      reply:
        result.reply ||
        "Come posso aiutarti?",

      appointment:
        null,

      pendingAppointment:
        result.pendingAppointment ||
        null,

      requiresConfirmation:
        result.requiresConfirmation ||
        false,

      confirmed:
        false

    });

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
