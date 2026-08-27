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
    if (!message || !String(message).trim()) {
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

      if (h > 23 || m > 59) {
        return null;
      }

      return h * 60 + m;
    }

    function formatTime(minutes) {
      const h = String(Math.floor(minutes / 60)).padStart(2, "0");
      const m = String(minutes % 60).padStart(2, "0");

      return `${h}:${m}`;
    }

    function normalizeTime(time) {
      if (!time) return "";

      const value = String(time)
        .trim()
        .replace(".", ":");

      if (/^\d{1}:\d{2}$/.test(value)) {
        return "0" + value;
      }

      if (/^\d{2}:\d{1}$/.test(value)) {
        return value.replace(/:(\d)$/, ":0$1");
      }

      return value;
    }

    function isValidDate(date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
        return false;
      }

      const d = new Date(`${date}T12:00:00`);

      return !Number.isNaN(d.getTime());
    }

    function getDayName(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const [year, month, day] = date.split("-").map(Number);

  const d = new Date(
    Date.UTC(year, month - 1, day)
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
      if (!name) return null;

      return services.find(
        s =>
          String(s.name || "")
            .trim()
            .toLowerCase() ===
          String(name)
            .trim()
            .toLowerCase()
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

      if (start < opening || end > closing) {
        return false;
      }

      if (overlapsBreak(start, end, day)) {
        return false;
      }

      return !appointments.some(a => {
        if (a.d !== date || !a.t) {
          return false;
        }

        const existingStart = toMinutes(
          normalizeTime(a.t)
        );

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

    function getTodayItaly() {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
    }

    const today = getTodayItaly();

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

    const clientInfo = clientName
      ? `Nome cliente già fornito: ${clientName}`
      : "Nome cliente non ancora fornito.";

    const serviceList = services.length
      ? services
          .map(
            s =>
              `- ${s.name}: €${s.price} (${s.duration} minuti)`
          )
          .join("\n")
      : "Nessun servizio inserito.";

    /*
     * Normalizziamo la cronologia prima di passarla al modello.
     */

    const safeHistory = Array.isArray(history)
      ? history
          .filter(
            item =>
              item &&
              (item.role === "user" ||
                item.role === "assistant") &&
              typeof item.content === "string"
          )
          .slice(-20)
      : [];

    const response =
      await client.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Sei l'assistente virtuale di ${
          business || "un'attività locale italiana"
        }.

Rispondi sempre in italiano.

Il tuo compito è assistere i clienti dell'attività e raccogliere correttamente le richieste di appuntamento.

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

DATA ODIERNA IN ITALIA:
${today}

${clientInfo}

REGOLE GENERALI

- Rispondi sempre in italiano.
- Interpreta ogni messaggio in base al suo significato naturale.
- Un messaggio che contiene solamente un orario, come "15", "ore 15", "alle 15", "15.00" o "15:00", deve essere interpretato esclusivamente come ORA.
- Non interpretare mai un orario come nome di un servizio.
- Un messaggio che contiene un nome di persona deve essere interpretato come NOME, salvo che il contesto dimostri chiaramente il contrario.
- Un servizio può essere inserito nell'appuntamento solo se il cliente lo ha esplicitamente indicato oppure se corrisponde chiaramente a un servizio presente nel listino.
- Non inventare mai il servizio.
- Se il cliente fornisce solamente l'ora e il servizio manca, conserva l'ora e chiedi il servizio.
- Se il cliente fornisce solamente il servizio e manca l'ora, conserva il servizio e chiedi l'ora.
- Se il cliente fornisce solamente la data, conserva la data e chiedi esclusivamente il dato ancora mancante più importante.
- Non sostituire un dato già raccolto con un nuovo dato se il nuovo messaggio non lo modifica esplicitamente.
- Usa esclusivamente i servizi presenti nel listino.
- Non inventare servizi.
- Non inventare prezzi.
- Non inventare durate.
- Non inventare disponibilità.
- Usa le informazioni già fornite dal cliente nella conversazione.
- Non chiedere nuovamente informazioni già fornite.
- Se manca un solo dato, chiedi esclusivamente quel dato.
- Nome, servizio, data e ora possono essere forniti in messaggi diversi.
- Devi ricostruire la richiesta usando tutta la conversazione disponibile.
- Se il cliente scrive un'ora come "13.30", interpretala come "13:30".
- L'ora deve essere restituita nel formato HH:MM.
- La data deve essere restituita nel formato YYYY-MM-DD.
- Non considerare un appuntamento confermato finché il sistema non ha verificato la disponibilità.

GESTIONE DELLE DATE

Se il cliente indica una data completa, usa quella data.

Esempio:
"31 agosto 2026"
=
2026-08-31

Se il cliente indica giorno e mese senza anno, usa l'anno coerente con la data odierna e con il contesto della conversazione.

Se il cliente indica solamente un giorno della settimana, devi chiedere quale data intende se non è possibile determinarla con certezza.

Esempio:
"lunedì"
non significa automaticamente una data arbitraria.

Se il cliente fornisce successivamente la data completa, aggiorna la data precedente senza perdere gli altri dati già raccolti.

GESTIONE DELLA CONVERSAZIONE

Esempio:

Cliente:
"Vorrei un taglio uomo."

Poi:
"Sono Simone."

Poi:
"Lunedì 31 agosto 2026."

Poi:
"Alle 13.30."

Devi ricostruire:

nome = Simone
servizio = Taglio uomo
data = 2026-08-31
ora = 13:30

Non chiedere nuovamente nome, servizio o data.

RISPOSTA

Devi restituire esclusivamente un oggetto JSON valido con questa struttura:

{
  "reply": "testo della risposta",
  "appointment": null
}

Se nome, servizio, data e ora sono tutti presenti e coerenti:

{
  "reply": "Richiesta di appuntamento raccolta.",
  "appointment": {
    "name": "nome",
    "service": "servizio",
    "date": "YYYY-MM-DD",
    "time": "HH:MM"
  }
}

IMPORTANTE:

Non dichiarare mai che l'appuntamento è confermato.
Il sistema verificherà successivamente la disponibilità reale.

Non scrivere testo fuori dal JSON.
`,

        input: [
          ...safeHistory,
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
      return res.status(200).json({
        reply:
          response.output_text ||
          "Non sono riuscito a elaborare la richiesta.",
        appointment: null
      });
    }

    /*
     * Validazione della struttura restituita dall'AI.
     */

    if (
      !result ||
      typeof result !== "object"
    ) {
      return res.status(200).json({
        reply:
          "Non sono riuscito a elaborare la richiesta.",
        appointment: null
      });
    }

    if (!result.appointment) {
      return res.status(200).json({
        reply:
          result.reply ||
          "Come posso aiutarti?",
        appointment: null
      });
    }

    const requested = result.appointment;

    const name =
      String(
        requested.name ||
        clientName ||
        ""
      ).trim();

    const serviceName =
      String(
        requested.service ||
        ""
      ).trim();

    const date =
      String(
        requested.date ||
        ""
      ).trim();

    const time =
      normalizeTime(
        requested.time
      );

    /*
     * Controllo dati obbligatori.
     */

    if (!name) {
      return res.status(200).json({
        reply:
          "Come ti chiami?",
        appointment: null
      });
    }

    if (!serviceName) {
      return res.status(200).json({
        reply:
          "Quale servizio vuoi prenotare?",
        appointment: null
      });
    }

    if (!date) {
      return res.status(200).json({
        reply:
          "Per quale data vuoi prenotare?",
        appointment: null
      });
    }

    if (!time) {
      return res.status(200).json({
        reply:
          "A che ora preferisci?",
        appointment: null
      });
    }

    /*
     * Controllo servizio.
     */

    const service =
      getService(serviceName);

    if (!service) {
      return res.status(200).json({
        reply:
          "Non trovo questo servizio nel listino dell'attività.",
        appointment: null
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
        appointment: null
      });
    }

    /*
     * Controllo data.
     */

    if (!isValidDate(date)) {
      return res.status(200).json({
        reply:
          "La data indicata non è valida.",
        appointment: null
      });
    }

    /*
     * Controllo ora.
     */

    const requestedMinutes =
      toMinutes(time);

    if (requestedMinutes === null) {
      return res.status(200).json({
        reply:
          "L'orario indicato non è valido.",
        appointment: null
      });
    }

    /*
     * Controllo giorno di apertura.
     */

    const dayName =
      getDayName(date);

    const day =
      hours[dayName];

    if (!day || day.status === "closed") {

  console.log("DEBUG CALENDARIO:", {
    date,
    dayName,
    day,
    hours
  });

  return res.status(200).json({
    reply:
      `L'attività risulta chiusa per la data ${date} ` +
      `(giorno rilevato: ${dayName}).`,
    appointment: null
  });
}
    /*
     * Controllo disponibilità reale.
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

      const nearbySlots =
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

      if (nearbySlots.length > 0) {
        return res.status(200).json({
          reply:
            `L'orario ${time} non è disponibile. ` +
            `Posso proporti questi orari: ` +
            `${nearbySlots.join(", ")}.`,
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
     * APPUNTAMENTO VERIFICATO.
     */

    return res.status(200).json({
      reply:
        `Perfetto. Ho verificato la disponibilità per ` +
        `${service.name} alle ${time}.`,
      appointment: {
        name,
        service: service.name,
        date,
        time
      }
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
