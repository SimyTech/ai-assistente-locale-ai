import OpenAI from "openai";

/*
============================================================
 AI ASSISTENTE LOCALE
============================================================

PRINCIPIO DI FUNZIONAMENTO:

1. PRENOTAZIONI       -> sempre locali
2. DISPONIBILITÀ      -> sempre locali
3. SERVIZI/PREZZI     -> sempre locali
4. ORARI/CONTATTI     -> sempre locali
5. PROMOZIONI         -> sempre locali, se presenti nei dati
6. CONFERME           -> sempre locali
7. OPENAI              -> SOLO richieste realmente complesse

IMPORTANTE:
Una prenotazione NON viene mai inviata a OpenAI.
Se OpenAI è in errore, le funzioni locali continuano a funzionare.
============================================================
*/

export default async function handler(req, res) {

  /* ==========================================================
     METODO HTTP
  ========================================================== */

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo non consentito"
    });
  }

  try {

    /* ========================================================
       DATI RICEVUTI
    ======================================================== */

    const {
      message,
      business = "",
      clientName = "",
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

    const text = String(message).trim();

    /* ========================================================
       UTILITÀ
    ======================================================== */

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

      const match = text.match(
        /^(\d{1,2}):(\d{2})$/
      );

      if (!match) {
        return null;
      }

      const hour = Number(match[1]);
      const minute = Number(match[2]);

      if (
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
      ) {
        return null;
      }

      return hour * 60 + minute;
    }

    function formatTime(minutes) {

      if (minutes === null || minutes === undefined) {
        return "";
      }

      const h = String(
        Math.floor(minutes / 60)
      ).padStart(2, "0");

      const m = String(
        minutes % 60
      ).padStart(2, "0");

      return `${h}:${m}`;
    }

    function getDayName(date) {

      if (
        !date ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ) {
        return null;
      }

      const d = new Date(
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

    /* ========================================================
       DATA ODIERNA - EUROPE/ROME
    ======================================================== */

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

    for (const part of dateParts) {

      if (part.type !== "literal") {
        dateMap[part.type] = part.value;
      }
    }

    const today =
      `${dateMap.year}-${dateMap.month}-${dateMap.day}`;

    /* ========================================================
       SERVIZI
    ======================================================== */

    function getService(name) {

      if (!name) {
        return null;
      }

      const wanted =
        normalizeText(name);

      return services.find(service =>
        normalizeText(service?.name) === wanted
      ) || null;
    }

    function findServiceInText(value) {

      const normalized =
        normalizeText(value);

      if (!normalized) {
        return null;
      }

      /*
      Prima cerca il nome completo.
      */

      for (const service of services) {

        const name =
          normalizeText(service?.name);

        if (
          name &&
          normalized.includes(name)
        ) {
          return service;
        }
      }

      /*
      Poi cerca tutte le parole del servizio.
      */

      for (const service of services) {

        const name =
          normalizeText(service?.name);

        const words =
          name
            .split(/\s+/)
            .filter(Boolean);

        if (
          words.length > 0 &&
          words.every(word =>
            normalized.includes(word)
          )
        ) {
          return service;
        }
      }

      /*
      Sinonimi comuni.
      */

      const aliases = [
        {
          words: ["taglio", "uomo"],
          search: ["taglio", "uomo"]
        },
        {
          words: ["taglio", "donna"],
          search: ["taglio", "donna"]
        },
        {
          words: ["piega"],
          search: ["piega"]
        },
        {
          words: ["colore"],
          search: ["colore"]
        },
        {
          words: ["barba"],
          search: ["barba"]
        }
      ];

      for (const alias of aliases) {

        if (
          alias.words.every(word =>
            normalized.includes(word)
          )
        ) {

          const found =
            services.find(service => {

              const serviceText =
                normalizeText(service?.name);

              return alias.search.every(word =>
                serviceText.includes(word)
              );
            });

          if (found) {
            return found;
          }
        }
      }

      return null;
    }

    /* ========================================================
       ORARI
    ======================================================== */

    function getDaySettings(date) {

      const dayName =
        getDayName(date);

      if (!dayName) {
        return null;
      }

      return settings?.hours?.[dayName] || null;
    }

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

    /* ========================================================
       APPUNTAMENTI ESISTENTI
    ======================================================== */

    function appointmentOverlaps(
      date,
      start,
      end
    ) {

      return appointments.some(
        appointment => {

          if (
            appointment?.d !== date ||
            !appointment?.t
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
        }
      );
    }

    /* ========================================================
       CONTROLLO SLOT
    ======================================================== */

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
        !Number.isFinite(dur) ||
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

      if (
        appointmentOverlaps(
          date,
          start,
          end
        )
      ) {
        return false;
      }

      return true;
    }

    /* ========================================================
       SLOT DISPONIBILI
    ======================================================== */

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

      let first = opening;
      let last = closing;

      if (startAfter !== null) {
        first =
          Math.max(
            first,
            startAfter
          );
      }

      if (endBefore !== null) {
        last =
          Math.min(
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

    /* ========================================================
       RICONOSCIMENTO DATA
    ======================================================== */

    function detectDate(value) {

      const normalized =
        normalizeText(value);

      if (normalized.includes("oggi")) {
        return today;
      }

      if (normalized.includes("domani")) {
        return addDays(today, 1);
      }

      if (normalized.includes("dopodomani")) {
        return addDays(today, 2);
      }

      const iso =
        normalized.match(
          /\b(20\d{2}-\d{2}-\d{2})\b/
        );

      if (iso) {
        return iso[1];
      }

      const numeric =
        normalized.match(
          /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b/
        );

      if (numeric) {

        const day =
          String(numeric[1]).padStart(2, "0");

        const month =
          String(numeric[2]).padStart(2, "0");

        const year =
          numeric[3] ||
          today.substring(0, 4);

        return `${year}-${month}-${day}`;
      }

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

      for (
        const [name, target] of
        Object.entries(weekdays)
      ) {

        if (
          normalized.includes(name)
        ) {

          const current =
            new Date(
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

    /* ========================================================
       RICONOSCIMENTO ORA
    ======================================================== */

    function detectTime(value) {

      const normalized =
        normalizeText(value);

      let match =
        normalized.match(
          /\b([01]?\d|2[0-3])[\.:,]([0-5]\d)\b/
        );

      if (match) {

        return formatTime(
          Number(match[1]) * 60 +
          Number(match[2])
        );
      }

      match =
        normalized.match(
          /\b(?:alle|ore|verso|per le)\s+([01]?\d|2[0-3])\b/
        );

      if (match) {

        return formatTime(
          Number(match[1]) * 60
        );
      }

      if (
        /^\d{1,2}$/.test(normalized)
      ) {

        const hour =
          Number(normalized);

        if (
          hour >= 0 &&
          hour <= 23
        ) {
          return formatTime(hour * 60);
        }
      }

      return null;
    }

    /* ========================================================
       FASCIA ORARIA
    ======================================================== */

    function detectPeriod(value) {

      const normalized =
        normalizeText(value);

      if (
        normalized.includes("mattina")
      ) {
        return {
          start: 8 * 60,
          end: 13 * 60
        };
      }

      if (
        normalized.includes("pomeriggio")
      ) {
        return {
          start: 14 * 60,
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

    /* ========================================================
       PAROLE CHIAVE
    ======================================================== */

    const normalizedMessage =
      normalizeText(text);

    const detectedService =
      findServiceInText(text);

    const detectedDate =
      detectDate(text);

    const detectedTime =
      detectTime(text);

    const detectedPeriod =
      detectPeriod(text);

    const bookingWords = [
      "prenota",
      "prenotare",
      "prenotazione",
      "appuntamento",
      "appuntamenti",
      "fissare",
      "fisso",
      "vorrei",
      "voglio",
      "posso venire",
      "mi prenoti",
      "prenotami",
      "scelgo"
    ];

    const isBooking =
      bookingWords.some(word =>
        normalizedMessage.includes(word)
      ) ||
      !!detectedService;

    /* ========================================================
       CONFERMA
    ======================================================== */

    const confirmationWords = [
      "si",
      "sì",
      "ok",
      "okay",
      "confermo",
      "conferma",
      "va bene",
      "prenota",
      "prenotalo",
      "procedi"
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
      normalizedMessage.includes("si confermo") ||
      normalizedMessage.includes("sì confermo");

    const isCancellation =
      cancellationWords.includes(
        normalizedMessage
      );

    /* ========================================================
       1. CONFERMA APPUNTAMENTO
       SEMPRE LOCALE
    ======================================================== */

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

      const parsedTime =
        toMinutes(requested.time);

      const time =
        parsedTime !== null
          ? formatTime(parsedTime)
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

      /*
      Ricontrollo obbligatorio:
      evita di confermare uno slot
      diventato occupato nel frattempo.
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

    /* ========================================================
       2. ANNULLAMENTO
       SEMPRE LOCALE
    ======================================================== */

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

    /* ========================================================
       3. SCELTA ORARIO DA PULSANTE
       ESEMPIO:
       "13:30"
       "Scelgo le 13:30"
       ======================================================== */

    if (
      pendingAppointment &&
      !requiresConfirmation &&
      detectedTime
    ) {

      const service =
        getService(
          pendingAppointment.service
        );

      const date =
        pendingAppointment.date ||
        detectedDate;

      const name =
        pendingAppointment.name ||
        clientName;

      if (
        service &&
        date
      ) {

        const duration =
          Number(service.duration) || 30;

        if (
          isSlotFree(
            date,
            detectedTime,
            duration
          )
        ) {

          return res.status(200).json({
            reply:
              `Perfetto. Ho verificato la disponibilità per ${service.name} il ${italianDate(date)} alle ${detectedTime}. Vuoi confermare l'appuntamento?`,

            appointment: null,

            pendingAppointment: {
              name,
              service: service.name,
              date,
              time: detectedTime
            },

            requiresConfirmation: true,

            confirmed: false
          });
        }

        const alternatives =
          findAvailableSlots(
            date,
            duration
          );

        return res.status(200).json({
          reply:
            alternatives.length
              ? `L'orario ${detectedTime} non è più disponibile. Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
              : "L'orario richiesto non è disponibile e non ci sono altri slot quel giorno.",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false,

          availableSlots: alternatives
        });
      }
    }

    /* ========================================================
       4. RICHIESTA ORARI
       SEMPRE LOCALE
    ======================================================== */

    const asksAvailability =
      normalizedMessage.includes("orari disponibili") ||
      normalizedMessage.includes("orari liberi") ||
      normalizedMessage.includes("quando sei libero") ||
      normalizedMessage.includes("quando siete liberi") ||
      normalizedMessage.includes("che ore hai") ||
      normalizedMessage.includes("che orari hai") ||
      normalizedMessage.includes("orari per") ||
      normalizedMessage.includes("disponibilita") ||
      normalizedMessage.includes("disponibilità");

    if (asksAvailability) {

      const date =
        detectedDate ||
        addDays(today, 1);

      const service =
        detectedService;

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
              minutes >= detectedPeriod.start &&
              minutes <= detectedPeriod.end
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

        pendingAppointment:
          service
            ? {
                name: clientName || "",
                service: service.name,
                date,
                time: ""
              }
            : null,

        requiresConfirmation: false,

        confirmed: false,

        availableSlots: slots
      });
    }

    /* ========================================================
       5. PRENOTAZIONE
       SEMPRE LOCALE
    ======================================================== */

    if (
      isBooking &&
      (
        detectedService ||
        pendingAppointment
      )
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

      /* ------------------------------------------------------
         SERVIZIO MANCANTE
      ------------------------------------------------------ */

      if (!service) {

        return res.status(200).json({
          reply:
            "Quale servizio vuoi prenotare?",

          appointment: null,

          pendingAppointment: {
            name,
            service: "",
            date: date || "",
            time: time || ""
          },

          requiresConfirmation: false,

          confirmed: false
        });
      }

      /* ------------------------------------------------------
         NOME MANCANTE
      ------------------------------------------------------ */

      if (!name) {

        return res.status(200).json({
          reply:
            "Mi confermi il nome per la prenotazione?",

          appointment: null,

          pendingAppointment: {
            name: "",
            service: service.name,
            date: date || "",
            time: time || ""
          },

          requiresConfirmation: false,

          confirmed: false
        });
      }

      /* ------------------------------------------------------
         DATA MANCANTE
      ------------------------------------------------------ */

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

      /* ------------------------------------------------------
         ORA MANCANTE
      ------------------------------------------------------ */

      if (!time) {

        const duration =
          Number(service.duration) || 30;

        const slots =
          findAvailableSlots(
            date,
            duration
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
            `Gli orari disponibili per ${italianDate(date)} sono: ${slots.join(", ")}.`,

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

      /* ------------------------------------------------------
         GIORNO CHIUSO
      ------------------------------------------------------ */

      const day =
        getDaySettings(date);

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

      /* ------------------------------------------------------
         CONTROLLO SLOT
      ------------------------------------------------------ */

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

      /* ------------------------------------------------------
         RICHIESTA CONFERMA
      ------------------------------------------------------ */

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

    /* ========================================================
       6. DATI LOCALI DELL'ATTIVITÀ
       CERCA PRIMA QUI.
       NIENTE OPENAI PER LE RICHIESTE SEMPLICI.
    ======================================================== */

    const localAnswers = [];

    /* Tipo attività */

    if (
      normalizedMessage.includes("che attivita") ||
      normalizedMessage.includes("che tipo di attivita") ||
      normalizedMessage.includes("che tipo di negozio")
    ) {

      if (settings.type) {
        localAnswers.push(
          `L'attività è: ${settings.type}.`
        );
      }
    }

    /* Descrizione */

    if (
      normalizedMessage.includes("descrizione") ||
      normalizedMessage.includes("di cosa vi occupate") ||
      normalizedMessage.includes("cosa fate") ||
      normalizedMessage.includes("chi siete")
    ) {

      if (settings.description) {
        localAnswers.push(
          settings.description
        );
      }
    }

    /* Indirizzo */

    if (
      normalizedMessage.includes("indirizzo") ||
      normalizedMessage.includes("dove siete") ||
      normalizedMessage.includes("dove vi trovate") ||
      normalizedMessage.includes("dove si trova")
    ) {

      if (settings.address) {
        localAnswers.push(
          `Ci troviamo in ${settings.address}.`
        );
      }
    }

    /* Telefono */

    if (
      normalizedMessage.includes("telefono") ||
      normalizedMessage.includes("numero di telefono") ||
      normalizedMessage.includes("numero")
    ) {

      if (settings.phone) {
        localAnswers.push(
          `Il numero di telefono è ${settings.phone}.`
        );
      }
    }

    /* WhatsApp */

    if (
      normalizedMessage.includes("whatsapp") ||
      normalizedMessage.includes("whats app")
    ) {

      if (settings.whatsapp) {
        localAnswers.push(
          `Puoi contattarci su WhatsApp al ${settings.whatsapp}.`
        );
      }
    }

    /* Servizi */

    if (
      normalizedMessage.includes("servizi") ||
      normalizedMessage.includes("trattamenti") ||
      normalizedMessage.includes("cosa posso fare")
    ) {

      if (services.length) {

        localAnswers.push(
          "I servizi disponibili sono: " +
          services
            .map(service =>
              `${service.name} (€${service.price})`
            )
            .join(", ") +
          "."
        );
      }
    }

    /* Prezzo */

    if (
      normalizedMessage.includes("quanto costa") ||
      normalizedMessage.includes("quanto viene") ||
      normalizedMessage.includes("prezzo") ||
      normalizedMessage.includes("costo") ||
      normalizedMessage.includes("quanto costa il")
    ) {

      if (detectedService) {

        const price =
          detectedService.price;

        if (
          price !== undefined &&
          price !== null &&
          price !== ""
        ) {

          localAnswers.push(
            `${detectedService.name} costa €${price}.`
          );
        }
      }
    }

    /* Durata */

    if (
      normalizedMessage.includes("quanto dura") ||
      normalizedMessage.includes("durata")
    ) {

      if (detectedService) {

        const duration =
          Number(detectedService.duration);

        if (duration > 0) {

          localAnswers.push(
            `${detectedService.name} dura circa ${duration} minuti.`
          );
        }
      }
    }

    /* Orari */

    if (
      normalizedMessage.includes("orari di apertura") ||
      normalizedMessage.includes("a che ora aprite") ||
      normalizedMessage.includes("a che ora chiudete") ||
      normalizedMessage === "orari"
    ) {

      const labels = {
        monday: "Lunedì",
        tuesday: "Martedì",
        wednesday: "Mercoledì",
        thursday: "Giovedì",
        friday: "Venerdì",
        saturday: "Sabato",
        sunday: "Domenica"
      };

      const lines = [];

      for (
        const [key, label] of
        Object.entries(labels)
      ) {

        const day =
          settings?.hours?.[key];

        if (
          !day ||
          day.status === "closed"
        ) {

          lines.push(
            `${label}: chiuso`
          );

        } else {

          let line =
            `${label}: ${day.open || ""} - ${day.close || ""}`;

          if (
            day.breakStart &&
            day.breakEnd
          ) {

            line +=
              `, pausa ${day.breakStart}-${day.breakEnd}`;
          }

          lines.push(line);
        }
      }

      localAnswers.push(
        "Gli orari sono:\n" +
        lines.join("\n")
      );
    }

    if (localAnswers.length) {

      return res.status(200).json({

        reply:
          localAnswers.join("\n\n"),

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /* ========================================================
       7. OPENAI
       SOLO FALLBACK PER RICHIESTE COMPLESSE
    ======================================================== */

    if (!process.env.OPENAI_API_KEY) {

      return res.status(200).json({

        reply:
          "Non ho trovato questa informazione nei dati dell'attività.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false,

        aiUsed: false
      });
    }

    const client =
      new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY
      });

    /* ========================================================
       ORARI PER OPENAI
    ======================================================== */

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
            settings?.hours?.[key];

          if (
            !day ||
            day.status === "closed"
          ) {
            return `${label}: Chiuso`;
          }

          let value =
            `${label}: ${day.open} - ${day.close}`;

          if (
            day.breakStart &&
            day.breakEnd
          ) {

            value +=
              ` (pausa ${day.breakStart}-${day.breakEnd})`;
          }

          return value;
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

    /* ========================================================
       STORIA SICURA
    ======================================================== */

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

    /* ========================================================
       OPENAI SOLO COME FALLBACK
    ======================================================== */

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

IMPORTANTE:

Questa richiesta è arrivata a te SOLO perché
il sistema locale non ha trovato una risposta
sufficiente.

Non devi gestire prenotazioni.

Non devi creare appuntamenti.

Non devi confermare appuntamenti.

Non devi modificare disponibilità.

Non devi inventare servizi, prezzi, orari,
promozioni, indirizzi o informazioni.

Puoi utilizzare esclusivamente questi dati:

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

DATA ODIERNA:
${today}

Se non puoi rispondere con i dati disponibili,
dillo chiaramente.

Rispondi in modo breve, naturale e utile.

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
            content: text
          }
        ]
      });

    /* ========================================================
       PARSING RISPOSTA OPENAI
    ======================================================== */

    let result = null;

    try {

      result =
        JSON.parse(
          response.output_text
        );

    } catch {

      result = {
        reply:
          response.output_text ||
          "Non ho trovato una risposta.",
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
          "Non ho trovato una risposta.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      };
    }

    return res.status(200).json({

      reply:
        result.reply ||
        "Non ho trovato una risposta.",

      appointment: null,

      pendingAppointment: null,

      requiresConfirmation: false,

      confirmed: false,

      aiUsed: true
    });

  } catch (error) {

    console.error(
      "CHAT API ERROR:",
      error
    );

    /*
    ============================================================
    OPENAI NON DEVE BLOCCARE L'APP
    ============================================================
    */

    if (
      error?.status === 429 ||
      error?.code === "rate_limit_exceeded" ||
      String(error?.message || "")
        .toLowerCase()
        .includes("rate limit") ||
      String(error?.message || "")
        .includes("429")
    ) {

      return res.status(200).json({

        reply:
          "Non ho trovato questa informazione nei dati disponibili.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false,

        aiUsed: false,

        rateLimited: true
      });
    }

    /*
    Errore generico OpenAI:
    nessun blocco della parte locale.
    */

    return res.status(200).json({

      reply:
        "Non ho trovato questa informazione nei dati disponibili.",

      appointment: null,

      pendingAppointment: null,

      requiresConfirmation: false,

      confirmed: false,

      aiUsed: false,

      aiError: true
    });
  }
}
