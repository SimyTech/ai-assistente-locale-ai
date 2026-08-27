import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo non consentito"
    });
  }

  try {
    const body = req.body || {};

    const {
      message = "",
      business = "",
      clientName = "",
      settings = {},
      services = [],
      appointments = [],
      history = [],
      pendingAppointment = null,
      requiresConfirmation = false
    } = body;

    const userMessage = String(message).trim();

    if (!userMessage) {
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
      if (value === null || value === undefined) {
        return null;
      }

      let text = String(value)
        .trim()
        .toLowerCase()
        .replace(",", ":")
        .replace(".", ":");

      if (/^\d{1,2}$/.test(text)) {
        text += ":00";
      }

      const match = text.match(/^(\d{1,2}):(\d{2})$/);

      if (!match) {
        return null;
      }

      const h = Number(match[1]);
      const m = Number(match[2]);

      if (
        h < 0 ||
        h > 23 ||
        m < 0 ||
        m > 59
      ) {
        return null;
      }

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

    function validDate(date) {
      return /^\d{4}-\d{2}-\d{2}$/.test(
        String(date || "")
      );
    }

    function addDays(dateString, amount) {
      const d = new Date(
        `${dateString}T12:00:00`
      );

      d.setDate(
        d.getDate() + amount
      );

      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0")
      ].join("-");
    }

    function italianDate(date) {
      const d = new Date(
        `${date}T12:00:00`
      );

      return d.toLocaleDateString(
        "it-IT",
        {
          weekday: "long",
          day: "numeric",
          month: "long"
        }
      );
    }

    /* ============================================================
       DATA ODIERNA EUROPA/ROME
    ============================================================ */

    const parts = new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(new Date());

    const dateMap = {};

    for (const part of parts) {
      if (part.type !== "literal") {
        dateMap[part.type] = part.value;
      }
    }

    const today =
      `${dateMap.year}-${dateMap.month}-${dateMap.day}`;

    /* ============================================================
       GIORNI
    ============================================================ */

    const weekdays = {
      domenica: 0,
      lunedi: 1,
      lunedì: 1,
      martedi: 2,
      martedì: 2,
      mercoledi: 3,
      mercoledì: 3,
      giovedi: 4,
      giovedì: 4,
      venerdi: 5,
      venerdì: 5,
      sabato: 6
    };

    function getDayName(date) {
      if (!validDate(date)) {
        return null;
      }

      const d = new Date(
        `${date}T12:00:00`
      );

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

    function getDaySettings(date) {
      const dayName = getDayName(date);

      if (!dayName) {
        return null;
      }

      return settings.hours?.[dayName] || null;
    }

    /* ============================================================
       SERVIZI
    ============================================================ */

    function getService(name) {
      if (!name) {
        return null;
      }

      const wanted = normalizeText(name);

      return services.find(service =>
        normalizeText(service.name) === wanted
      ) || null;
    }

    function findServiceInText(text) {
      const normalized = normalizeText(text);

      /*
       * Prima il nome completo.
       */

      for (const service of services) {
        const name = normalizeText(service.name);

        if (
          name &&
          normalized.includes(name)
        ) {
          return service;
        }
      }

      /*
       * Poi tutte le parole del servizio.
       */

      for (const service of services) {
        const words = normalizeText(service.name)
          .split(/\s+/)
          .filter(Boolean);

        if (
          words.length &&
          words.every(word =>
            normalized.includes(word)
          )
        ) {
          return service;
        }
      }

      /*
       * Compatibilità aggiuntiva per "taglio".
       */

      if (normalized.includes("taglio")) {
        const uomo = services.find(service =>
          normalizeText(service.name)
            .includes("taglio uomo")
        );

        if (uomo) {
          return uomo;
        }

        const taglio = services.find(service =>
          normalizeText(service.name)
            .startsWith("taglio")
        );

        if (taglio) {
          return taglio;
        }
      }

      return null;
    }

    /* ============================================================
       DATA
    ============================================================ */

    function detectDate(text) {
      const normalized = normalizeText(text);

      if (normalized.includes("oggi")) {
        return today;
      }

      if (normalized.includes("dopodomani")) {
        return addDays(today, 2);
      }

      if (normalized.includes("domani")) {
        return addDays(today, 1);
      }

      const iso = normalized.match(
        /\b(20\d{2}-\d{2}-\d{2})\b/
      );

      if (iso) {
        return iso[1];
      }

      const numeric = normalized.match(
        /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b/
      );

      if (numeric) {
        const day = String(
          numeric[1]
        ).padStart(2, "0");

        const month = String(
          numeric[2]
        ).padStart(2, "0");

        const year =
          numeric[3] ||
          today.substring(0, 4);

        return `${year}-${month}-${day}`;
      }

      for (const [name, target] of Object.entries(weekdays)) {
        if (normalized.includes(name)) {
          const current = new Date(
            `${today}T12:00:00`
          );

          const currentDay =
            current.getDay();

          let difference =
            target - currentDay;

          if (difference <= 0) {
            difference += 7;
          }

          return addDays(
            today,
            difference
          );
        }
      }

      return null;
    }

    /* ============================================================
       ORA
    ============================================================ */

    function detectTime(text) {
      const normalized = normalizeText(text);

      /*
       * 13:30
       * 13.30
       * 13,30
       */

      let match = normalized.match(
        /\b([01]?\d|2[0-3])[\.:,]([0-5]\d)\b/
      );

      if (match) {
        return formatTime(
          Number(match[1]) * 60 +
          Number(match[2])
        );
      }

      /*
       * "alle 13"
       * "ore 13"
       * "per le 13"
       */

      match = normalized.match(
        /\b(?:alle|ore|verso|per le)\s+([01]?\d|2[0-3])\b/
      );

      if (match) {
        return formatTime(
          Number(match[1]) * 60
        );
      }

      /*
       * "13"
       */

      if (/^\d{1,2}$/.test(normalized)) {
        const hour = Number(normalized);

        if (
          hour >= 0 &&
          hour <= 23
        ) {
          return formatTime(
            hour * 60
          );
        }
      }

      return null;
    }

    /* ============================================================
       NUOVA FUNZIONE:
       RICONOSCE "SCELGO LE 13:30"
       ============================================================ */

    function detectChosenTime(text) {
      const normalized = normalizeText(text);

      const match = normalized.match(
        /\b(?:scelgo|scelto|prendo|preferisco|va bene|ok|okey|okay|voglio|faccio)\s+(?:le|alle|ore)?\s*([01]?\d|2[0-3])(?:[\.:,]([0-5]\d))?\b/
      );

      if (match) {
        const hour = Number(match[1]);
        const minute =
          match[2]
            ? Number(match[2])
            : 0;

        return formatTime(
          hour * 60 + minute
        );
      }

      /*
       * Gestisce anche:
       * "scelgo 13:30"
       * "13:30"
       */

      return detectTime(normalized);
    }

    /* ============================================================
       FASCIA ORARIA
    ============================================================ */

    function detectPeriod(text) {
      const normalized = normalizeText(text);

      if (normalized.includes("mattina")) {
        return {
          start: 8 * 60,
          end: 13 * 60
        };
      }

      if (normalized.includes("pomeriggio")) {
        return {
          start: 13 * 60,
          end: 19 * 60
        };
      }

      if (
        normalized.includes("sera") ||
        normalized.includes("serata")
      ) {
        return {
          start: 17 * 60,
          end: 22 * 60
        };
      }

      return null;
    }

    /* ============================================================
       DISPONIBILITÀ
    ============================================================ */

    function overlapsBreak(start, end, day) {
      if (!day) {
        return false;
      }

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

      const dur =
        Number(duration);

      if (
        opening === null ||
        closing === null ||
        start === null ||
        !dur ||
        dur <= 0
      ) {
        return false;
      }

      const end =
        start + dur;

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
      duration,
      startAfter = null,
      endBefore = null
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

      let first =
        opening;

      let last =
        closing;

      if (startAfter !== null) {
        first = Math.max(
          first,
          startAfter
        );
      }

      if (endBefore !== null) {
        last = Math.min(
          last,
          endBefore
        );
      }

      first =
        Math.ceil(first / 30) * 30;

      const slots = [];

      for (
        let start = first;
        start + duration <= last;
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
       RICONOSCIMENTO INTENTO
    ============================================================ */

    const normalizedMessage =
      normalizeText(userMessage);

    const detectedService =
      findServiceInText(userMessage);

    const detectedDate =
      detectDate(userMessage);

    const detectedTime =
      detectTime(userMessage);

    const detectedChosenTime =
      detectChosenTime(userMessage);

    const detectedPeriod =
      detectPeriod(userMessage);

    const asksAvailability =
      (
        normalizedMessage.includes("orari") &&
        (
          normalizedMessage.includes("disponibili") ||
          normalizedMessage.includes("liberi") ||
          normalizedMessage.includes("libero")
        )
      ) ||
      normalizedMessage.includes("quando sei libero") ||
      normalizedMessage.includes("quando siete liberi") ||
      normalizedMessage.includes("che ore hai") ||
      normalizedMessage.includes("che orari hai");

    const looksLikeBooking =
      normalizedMessage.includes("prenot") ||
      normalizedMessage.includes("appuntament") ||
      normalizedMessage.includes("vorrei") ||
      normalizedMessage.includes("voglio") ||
      normalizedMessage.includes("fissare") ||
      normalizedMessage.includes("taglio") ||
      normalizedMessage.includes("servizio");

    /* ============================================================
       CONFERMA
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
      "conferma",
      "confermo l appuntamento",
      "confermo l'appuntamento"
    ];

    const cancellationWords = [
      "no",
      "annulla",
      "cancella",
      "non confermo",
      "lascia perdere"
    ];

    const isConfirmation =
      confirmationWords.includes(
        normalizedMessage
      ) ||
      normalizedMessage.includes(
        "si confermo"
      ) ||
      normalizedMessage.includes(
        "sì confermo"
      );

    const isCancellation =
      cancellationWords.includes(
        normalizedMessage
      );

    /* ============================================================
       1. CONFERMA APPUNTAMENTO
       ============================================================ */

    if (
      pendingAppointment &&
      requiresConfirmation &&
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

      let time =
        String(
          requested.time || ""
        )
          .trim()
          .replace(".", ":")
          .replace(",", ":");

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
        !validDate(date) ||
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
              ? `L'orario ${time} non è più disponibile. Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
              : "L'orario richiesto non è più disponibile e non ci sono altri slot quel giorno.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          availableSlots: alternatives
        });
      }

      return res.status(200).json({
        reply:
          `Appuntamento confermato per ${service.name} il ${italianDate(date)} alle ${time}.`,
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
       2. ANNULLAMENTO
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
       3. SCELTA ORARIO DA LISTA
       
       QUESTO È IL PUNTO IMPORTANTE.

       "Scelgo le 13:30"
       NON deve chiamare OpenAI.
       ============================================================ */

    if (
      pendingAppointment &&
      !requiresConfirmation &&
      detectedChosenTime
    ) {
      const date =
        pendingAppointment.date ||
        detectedDate;

      const service =
        getService(
          pendingAppointment.service
        ) ||
        detectedService;

      const name =
        String(
          pendingAppointment.name ||
          clientName ||
          ""
        ).trim();

      if (
        service &&
        date &&
        name
      ) {
        const duration =
          Number(service.duration) || 30;

        const chosenTime =
          detectedChosenTime;

        if (
          !isSlotFree(
            date,
            chosenTime,
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
                ? `L'orario ${chosenTime} non è più disponibile. Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
                : "L'orario scelto non è più disponibile e non ci sono altri slot quel giorno.",
            appointment: null,
            pendingAppointment: null,
            requiresConfirmation: false,
            confirmed: false,
            availableSlots: alternatives
          });
        }

        return res.status(200).json({
          reply:
            `Perfetto. Ho verificato la disponibilità per ${service.name} il ${italianDate(date)} alle ${chosenTime}. Vuoi confermare l'appuntamento?`,
          appointment: null,
          pendingAppointment: {
            name,
            service: service.name,
            date,
            time: chosenTime
          },
          requiresConfirmation: true,
          confirmed: false
        });
      }
    }

    /* ============================================================
       4. RICHIESTA DISPONIBILITÀ
       ============================================================ */

    if (asksAvailability) {
      const date =
        detectedDate ||
        pendingAppointment?.date ||
        addDays(today, 1);

      const service =
        detectedService ||
        getService(
          pendingAppointment?.service
        );

      const duration =
        service
          ? Number(service.duration) || 30
          : 30;

      let slots =
        findAvailableSlots(
          date,
          duration
        );

      if (detectedPeriod) {
        slots =
          slots.filter(time => {
            const minutes =
              toMinutes(time);

            return (
              minutes >=
                detectedPeriod.start &&
              minutes <=
                detectedPeriod.end
            );
          });
      }

      if (!slots.length) {
        return res.status(200).json({
          reply:
            `Non risultano orari disponibili per ${italianDate(date)}.`,
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          availableSlots: []
        });
      }

      return res.status(200).json({
        reply:
          `Gli orari disponibili per ${italianDate(date)} sono: ${slots.join(", ")}.`,
        appointment: null,
        pendingAppointment: {
          name:
            clientName ||
            pendingAppointment?.name ||
            "",
          service:
            service?.name ||
            "",
          date,
          time: ""
        },
        requiresConfirmation: false,
        confirmed: false,
        availableSlots: slots
      });
    }

    /* ============================================================
       5. PRENOTAZIONE LOCALE
       ============================================================ */

    if (
      looksLikeBooking ||
      pendingAppointment
    ) {
      const service =
        detectedService ||
        getService(
          pendingAppointment?.service
        );

      const date =
        detectedDate ||
        pendingAppointment?.date ||
        null;

      const time =
        detectedTime ||
        pendingAppointment?.time ||
        null;

      const name =
        String(
          clientName ||
          pendingAppointment?.name ||
          ""
        ).trim();

      /*
       * Servizio mancante
       */

      if (!service) {
        return res.status(200).json({
          reply:
            "Quale servizio vuoi prenotare?",
          appointment: null,
          pendingAppointment: {
            name,
            service: "",
            date,
            time
          },
          requiresConfirmation: false,
          confirmed: false
        });
      }

      /*
       * Nome mancante
       */

      if (!name) {
        return res.status(200).json({
          reply:
            "Mi confermi il nome per la prenotazione?",
          appointment: null,
          pendingAppointment: {
            name: "",
            service: service.name,
            date,
            time
          },
          requiresConfirmation: false,
          confirmed: false
        });
      }

      /*
       * Data mancante
       */

      if (!date) {
        return res.status(200).json({
          reply:
            "Per quale giorno vuoi prenotare?",
          appointment: null,
          pendingAppointment: {
            name,
            service: service.name,
            date: "",
            time: ""
          },
          requiresConfirmation: false,
          confirmed: false
        });
      }

      /*
       * Ora mancante:
       * NON usiamo OpenAI.
       */

      if (!time) {
        const slots =
          findAvailableSlots(
            date,
            Number(service.duration) || 30
          );

        if (!slots.length) {
          return res.status(200).json({
            reply:
              `Non risultano orari disponibili per ${italianDate(date)}.`,
            appointment: null,
            pendingAppointment: null,
            requiresConfirmation: false,
            confirmed: false,
            availableSlots: []
          });
        }

        return res.status(200).json({
          reply:
            `Quale orario preferisci per ${italianDate(date)}?`,
          appointment: null,
          pendingAppointment: {
            name,
            service: service.name,
            date,
            time: ""
          },
          requiresConfirmation: false,
          confirmed: false,
          availableSlots: slots
        });
      }

      const duration =
        Number(service.duration) || 30;

      const day =
        getDaySettings(date);

      /*
       * Giorno chiuso
       */

      if (
        !day ||
        day.status === "closed"
      ) {
        return res.status(200).json({
          reply:
            `L'attività è chiusa ${italianDate(date)}. Scegli un altro giorno.`,
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });
      }

      /*
       * Ora non disponibile
       */

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

      /*
       * NON prenotiamo ancora.
       */

      return res.status(200).json({
        reply:
          `Perfetto. Ho verificato la disponibilità per ${service.name} il ${italianDate(date)} alle ${time}. Vuoi confermare l'appuntamento?`,
        appointment: null,
        pendingAppointment: {
          name,
          service: service.name,
          date,
          time
        },
        requiresConfirmation: true,
        confirmed: false
      });
    }

    /* ============================================================
       6. OPENAI SOLO PER DOMANDE GENERALI
       ============================================================ */

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        reply:
          "Posso aiutarti con informazioni sull'attività, servizi, prezzi, orari e prenotazioni.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      });
    }

    const client =
      new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY
      });

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
            .slice(-10)
        : [];

    const response =
      await client.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Sei l'assistente virtuale di ${
          business ||
          "un'attività locale italiana"
        }.

Rispondi sempre in italiano.

Aiuta il cliente con informazioni sull'attività,
servizi, prezzi, orari e richieste generali.

Non inventare informazioni.

DATI ATTIVITÀ

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

IMPORTANTE:

Le prenotazioni, la disponibilità,
la scelta degli orari e le conferme
vengono gestite dal server.

Non devi gestire direttamente
la logica delle prenotazioni.

Restituisci SEMPRE JSON valido:

{
  "reply": "risposta",
  "appointment": null,
  "pendingAppointment": null,
  "requiresConfirmation": false,
  "confirmed": false
}

Non scrivere testo fuori dal JSON.
`,

        input: [
          ...safeHistory,
          {
            role: "user",
            content: userMessage
          }
        ]
      });

    /* ============================================================
       PARSING OPENAI
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

    return res.status(200).json({
      reply:
        result.reply ||
        "Non ho ricevuto una risposta.",

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
      "CHAT API ERROR:",
      error
    );

    /*
     * 429 OpenAI:
     * non deve rompere la gestione locale
     * delle prenotazioni.
     */

    if (
      error?.status === 429 ||
      error?.code === "rate_limit_exceeded" ||
      String(error?.message || "")
        .toLowerCase()
        .includes("rate limit")
    ) {
      return res.status(200).json({
        reply:
          "L'assistente AI è temporaneamente occupato. Le funzioni di prenotazione sono disponibili senza AI.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false,
        rateLimited: true
      });
    }

    return res.status(500).json({
      error:
        error?.message ||
        "Errore durante la richiesta."
    });
  }
}
