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
    const body = req.body || {};

    const message = String(body.message || "").trim();
    const business = body.business || "Attività locale";
    const clientName = String(body.clientName || "").trim();

    const settings = body.settings || {};
    const services = Array.isArray(body.services)
      ? body.services
      : [];

    const appointments = Array.isArray(body.appointments)
      ? body.appointments
      : [];

    const history = Array.isArray(body.history)
      ? body.history
      : [];

    const pendingAppointment =
      body.pendingAppointment || null;

    const requiresConfirmation =
      Boolean(body.requiresConfirmation);

    if (!message) {
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

    function toMinutes(value) {
      if (!value) return null;

      let text = String(value)
        .trim()
        .replace(".", ":");

      if (/^\d{1,2}$/.test(text)) {
        text += ":00";
      }

      const match =
        text.match(/^(\d{1,2}):(\d{2})$/);

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
      const h = String(
        Math.floor(minutes / 60)
      ).padStart(2, "0");

      const m = String(
        minutes % 60
      ).padStart(2, "0");

      return `${h}:${m}`;
    }

    function dateToISO(date) {
      const y = date.getFullYear();
      const m = String(
        date.getMonth() + 1
      ).padStart(2, "0");
      const d = String(
        date.getDate()
      ).padStart(2, "0");

      return `${y}-${m}-${d}`;
    }

    function getTodayItaly() {
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

      const result = {};

      for (const part of parts) {
        if (part.type !== "literal") {
          result[part.type] = part.value;
        }
      }

      return `${result.year}-${result.month}-${result.day}`;
    }

    function addDays(dateString, amount) {
      const date =
        new Date(`${dateString}T12:00:00`);

      date.setDate(
        date.getDate() + amount
      );

      return dateToISO(date);
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

    function italianDate(date) {
      const d =
        new Date(`${date}T12:00:00`);

      return d.toLocaleDateString(
        "it-IT",
        {
          weekday: "long",
          day: "numeric",
          month: "long"
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
        const name =
          normalizeText(service.name);

        return (
          name &&
          normalized.includes(name)
        );
      }) || null;
    }

    function getDaySettings(date) {
      const day =
        getDayName(date);

      if (!day) return null;

      return settings.hours?.[day] || null;
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

    function getServiceDuration(name) {
      const service =
        getService(name);

      return service
        ? Number(service.duration) || 30
        : 30;
    }

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

        const existingDuration =
          getServiceDuration(
            appointment.s
          );

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
       RICONOSCIMENTO DATA
    ============================================================ */

    const today =
      getTodayItaly();

    const normalizedMessage =
      normalizeText(message);

    function detectDate() {
      if (
        normalizedMessage.includes("domani")
      ) {
        return addDays(today, 1);
      }

      if (
        normalizedMessage.includes("dopodomani")
      ) {
        return addDays(today, 2);
      }

      if (
        normalizedMessage.includes("oggi")
      ) {
        return today;
      }

      const days = {
        lunedi: 1,
        martedi: 2,
        mercoledi: 3,
        giovedi: 4,
        venerdi: 5,
        sabato: 6,
        domenica: 0
      };

      for (const [name, target] of Object.entries(days)) {
        if (
          normalizedMessage.includes(name)
        ) {
          const current =
            new Date(`${today}T12:00:00`);

          const currentDay =
            current.getDay();

          let diff =
            target - currentDay;

          if (diff <= 0) {
            diff += 7;
          }

          return addDays(
            today,
            diff
          );
        }
      }

      const explicit =
        normalizedMessage.match(
          /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/
        );

      if (explicit) {
        return `${explicit[1]}-${String(
          explicit[2]
        ).padStart(2, "0")}-${String(
          explicit[3]
        ).padStart(2, "0")}`;
      }

      return null;
    }

    /* ============================================================
       RICONOSCIMENTO FASCIA ORARIA
    ============================================================ */

    function detectTimeRange() {
      if (
        normalizedMessage.includes("mattina")
      ) {
        return {
          min: 9 * 60,
          max: 12 * 60 + 59
        };
      }

      if (
        normalizedMessage.includes("pranzo")
      ) {
        return {
          min: 12 * 60,
          max: 14 * 60 + 30
        };
      }

      if (
        normalizedMessage.includes("pomeriggio")
      ) {
        return {
          min: 14 * 60,
          max: 19 * 60 + 30
        };
      }

      if (
        normalizedMessage.includes("sera")
      ) {
        return {
          min: 18 * 60,
          max: 23 * 60
        };
      }

      return null;
    }

    /* ============================================================
       RICONOSCIMENTO ORARIO
    ============================================================ */

    function detectTime() {
      const match =
        normalizedMessage.match(
          /\b(?:ore\s*)?(\d{1,2})(?::|\.|h)?(\d{2})?\b/
        );

      if (!match) return null;

      let hours =
        Number(match[1]);

      let minutes =
        match[2]
          ? Number(match[2])
          : 0;

      if (
        hours > 23 ||
        minutes > 59
      ) {
        return null;
      }

      return formatTime(
        hours * 60 + minutes
      );
    }

    /* ============================================================
       RICONOSCIMENTO SERVIZIO
    ============================================================ */

    const detectedService =
      findServiceInText(message);

    /* ============================================================
       RICHIESTA DI SOLI ORARI
       NON USA OPENAI
    ============================================================ */

    const asksAvailability =
      (
        normalizedMessage.includes("orari") ||
        normalizedMessage.includes("orario") ||
        normalizedMessage.includes("disponibil")
      ) &&
      (
        normalizedMessage.includes("disponibil") ||
        normalizedMessage.includes("liber") ||
        normalizedMessage.includes("posso") ||
        normalizedMessage.includes("quali") ||
        normalizedMessage.includes("che")
      );

    const detectedDate =
      detectDate();

    const detectedRange =
      detectTimeRange();

    /*
     * Se il cliente chiede semplicemente quali orari
     * sono disponibili, rispondiamo direttamente.
     */

    if (
      asksAvailability &&
      detectedDate
    ) {
      const duration =
        detectedService
          ? Number(detectedService.duration) || 30
          : 30;

      const slots =
        findAvailableSlots(
          detectedDate,
          duration
        );

      const filteredSlots =
        detectedRange
          ? slots.filter(time => {
              const minutes =
                toMinutes(time);

              return (
                minutes >= detectedRange.min &&
                minutes <= detectedRange.max
              );
            })
          : slots;

      if (!filteredSlots.length) {
        return res.status(200).json({
          reply:
            `Non risultano orari disponibili per ${italianDate(
              detectedDate
            )}.`,
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          availableSlots: []
        });
      }

      return res.status(200).json({
        reply:
          `Gli orari disponibili per ${italianDate(
            detectedDate
          )} sono: ${filteredSlots.join(", ")}.`,
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false,
        availableSlots: filteredSlots
      });
    }

    /* ============================================================
       CONFERMA PENDENTE
    ============================================================ */

    const confirmationWords = [
      "si",
      "sì",
      "ok",
      "okay",
      "va bene",
      "confermo",
      "conferma",
      "prenota",
      "prenotalo",
      "procedi",
      "fatto"
    ];

    const cancellationWords = [
      "no",
      "annulla",
      "cancella",
      "non confermo",
      "lascia perdere"
    ];

    const isConfirmation =
      confirmationWords.some(
        word =>
          normalizedMessage ===
          normalizeText(word)
      ) ||
      normalizedMessage.includes(
        "si confermo"
      ) ||
      normalizedMessage.includes(
        "sì confermo"
      );

    const isCancellation =
      cancellationWords.some(
        word =>
          normalizedMessage ===
          normalizeText(word)
      );

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
          confirmed: false
        });
      }

      const date =
        String(
          requested.date || ""
        ).trim();

      const minutes =
        toMinutes(
          requested.time
        );

      const time =
        minutes !== null
          ? formatTime(minutes)
          : "";

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
              ? `Nel frattempo l'orario ${time} non è più disponibile. Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
              : "Nel frattempo l'orario richiesto non è più disponibile e non ci sono altri slot quel giorno.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          availableSlots: alternatives
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
        confirmed: true
      });
    }

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
       COSTRUZIONE CONTEXT
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

          let result =
            `${label}: ${day.open} - ${day.close}`;

          if (
            day.breakStart &&
            day.breakEnd
          ) {
            result +=
              ` (pausa ${day.breakStart}-${day.breakEnd})`;
          }

          return result;
        })
        .join("\n");

    const serviceList =
      services.length
        ? services.map(service =>
            `- ${service.name}: €${service.price}, ${service.duration} minuti`
          ).join("\n")
        : "Nessun servizio inserito.";

    const safeHistory =
      history
        .filter(item =>
          item &&
          (
            item.role === "user" ||
            item.role === "assistant"
          ) &&
          typeof item.content === "string"
        )
        .slice(-12);

    /* ============================================================
       OPENAI
    ============================================================ */

    const client =
      new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY
      });

    const response =
      await client.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Sei l'assistente virtuale di ${business}.

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

CLIENTE:
${clientName || "Non fornito"}

DATA ODIERNA:
${today}

REGOLE

- Usa esclusivamente i servizi presenti nel listino.
- Non inventare servizi.
- Non inventare prezzi.
- Non inventare disponibilità.
- La disponibilità reale viene verificata dal server.
- Usa la cronologia della conversazione.
- Non richiedere nuovamente dati già forniti.
- Se manca un solo dato, chiedi esclusivamente quel dato.
- "15", "15:00", "15.00" e "15h" significano 15:00.
- "domani" deve essere interpretato rispetto alla data odierna.
- "mattina", "pomeriggio" e "sera" indicano una fascia oraria.
- Se il cliente chiede gli orari disponibili, fornisci una risposta breve.
- Non dichiarare mai un appuntamento confermato senza conferma esplicita.

APPUNTAMENTI

Quando hai:
- nome
- servizio
- data
- ora

crea una richiesta pendente e chiedi conferma.

NON salvare direttamente l'appuntamento.

FORMATO JSON OBBLIGATORIO

{
  "reply": "testo",
  "appointment": null,
  "pendingAppointment": null,
  "requiresConfirmation": false,
  "confirmed": false
}

Quando tutti i dati sono presenti:

{
  "reply": "Perfetto. Ho verificato la disponibilità per [SERVIZIO] il [DATA] alle [ORA]. Vuoi confermare l'appuntamento?",
  "appointment": null,
  "pendingAppointment": {
    "name": "nome",
    "service": "servizio",
    "date": "YYYY-MM-DD",
    "time": "HH:MM"
  },
  "requiresConfirmation": true,
  "confirmed": false
}

NON scrivere testo fuori dal JSON.
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
       PARSING
    ============================================================ */

    let result;

    try {
      result =
        JSON.parse(
          response.output_text
        );
    } catch {
      return res.status(200).json({
        reply:
          response.output_text ||
          "Non ho capito la richiesta.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      });
    }

    if (
      result.pendingAppointment
    ) {
      const pending =
        result.pendingAppointment;

      let service =
        getService(
          pending.service
        );

      if (!service) {
        service =
          findServiceInText(
            message
          );
      }

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

      const minutes =
        toMinutes(
          pending.time
        );

      const time =
        minutes !== null
          ? formatTime(minutes)
          : "";

      const normalizedPending = {
        name,
        service: service.name,
        date,
        time
      };

      const complete =
        Boolean(
          name &&
          service &&
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
              ? `L'orario ${time} non è disponibile. Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
              : "Non ci sono altri slot disponibili quel giorno.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          availableSlots: alternatives
        });
      }

      return res.status(200).json({
        reply:
          `Perfetto. Ho verificato la disponibilità per ${service.name} il ${date} alle ${time}. Vuoi confermare l'appuntamento?`,
        appointment: null,
        pendingAppointment:
          normalizedPending,
        requiresConfirmation: true,
        confirmed: false
      });
    }

    return res.status(200).json({
      reply:
        result.reply ||
        "Non ho capito la richiesta.",
      appointment:
        result.confirmed
          ? result.appointment || null
          : null,
      pendingAppointment:
        result.pendingAppointment || null,
      requiresConfirmation:
        Boolean(
          result.requiresConfirmation
        ),
      confirmed:
        Boolean(
          result.confirmed
        )
    });

  } catch (error) {
    console.error(
      "OPENAI ERROR:",
      error
    );

    const message =
      String(
        error?.message || ""
      );

    if (
      message.includes("429") ||
      message.toLowerCase().includes("rate limit")
    ) {
      return res.status(200).json({
        reply:
          "L'assistente AI è temporaneamente occupato. Puoi riprovare tra qualche minuto.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      });
    }

    return res.status(500).json({
      error:
        error?.message ||
        "Errore durante la richiesta AI"
    });
  }
}
