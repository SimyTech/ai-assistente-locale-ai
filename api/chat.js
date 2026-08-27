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
          existingStart + existingDuration;

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
       DATA ODIERNA ITALIA
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

    const conversation =
      safeHistory
        .map(item => {
          const role =
            item.role === "user"
              ? "CLIENTE"
              : "ASSISTENTE";

          return `${role}: ${item.content}`;
        })
        .join("\n");

    /* ============================================================
       CONTROLLO CONFERMA
    ============================================================ */

    const normalizedMessage =
      normalizeText(message);

    const confirmationWords = [
      "si",
      "sì",
      "confermo",
      "conferma",
      "va bene",
      "ok",
      "okay",
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
      confirmationWords.some(word =>
        normalizedMessage ===
          normalizeText(word)
      ) ||
      (
        normalizedMessage.includes("si confermo") ||
        normalizedMessage.includes("sì confermo")
      );

    const isCancellation =
      cancellationWords.some(word =>
        normalizedMessage ===
          normalizeText(word)
      );

    /*
     * Se esiste una prenotazione in attesa e il cliente
     * conferma, NON chiediamo nuovamente i dati all'AI.
     * Controlliamo direttamente i dati salvati.
     */

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

      let time =
        String(
          requested.time || ""
        )
          .trim()
          .replace(".", ":");

      time =
        toMinutes(time) !== null
          ? formatTime(toMinutes(time))
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
        Number(service.duration);

      /*
       * Ricontrollo disponibilità al momento della conferma.
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

        if (alternatives.length) {
          return res.status(200).json({
            reply:
              `Nel frattempo l'orario ${time} non è più disponibile. ` +
              `Posso proporti: ${alternatives.slice(0, 3).join(", ")}.`,
            appointment: null,
            pendingAppointment: null,
            requiresConfirmation: false,
            confirmed: false
          });
        }

        return res.status(200).json({
          reply:
            "Nel frattempo l'orario richiesto non è più disponibile e non ci sono altri slot quel giorno.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });
      }

      /*
       * Conferma effettiva.
       *
       * Il frontend riceverà appointment e lo salverà.
       */

      return res.status(200).json({
        reply:
          `Appuntamento confermato per ${service.name} ` +
          `il ${date} alle ${time}.`,
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

    /*
     * Se il cliente annulla una richiesta pendente.
     */

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
       MOTORE LOCALE
       Risponde alle richieste semplici senza usare OpenAI
    ============================================================ */

    const localText = normalizeText(message);

    function localReply(reply) {
      return res.status(200).json({
        reply,
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false,
        local: true
      });
    }

    /*
     * ------------------------------------------------------------
     * LISTINO SERVIZI
     * ------------------------------------------------------------
     */

    const asksServices =
      localText.includes("servizi") ||
      localText.includes("cosa fate") ||
      localText.includes("cosa offrite") ||
      localText.includes("che servizi") ||
      localText.includes("quali servizi") ||
      localText.includes("listino");

    if (asksServices && services.length) {

      const text =
        services
          .map(service =>
            `• ${service.name}: €${Number(service.price).toFixed(2)} ` +
            `(${Number(service.duration)} minuti)`
          )
          .join("\n");

      return localReply(
        `Questi sono i nostri servizi:\n\n${text}`
      );
    }

    /*
     * ------------------------------------------------------------
     * PREZZO DI UN SERVIZIO
     * ------------------------------------------------------------
     */

    const mentionedService =
      findServiceInText(message);

    const asksPrice =
      localText.includes("quanto costa") ||
      localText.includes("prezzo") ||
      localText.includes("costo") ||
      localText.includes("quanto viene") ||
      localText.includes("quanto pago");

    if (
      asksPrice &&
      mentionedService
    ) {

      return localReply(
        `${mentionedService.name} costa ` +
        `€${Number(mentionedService.price).toFixed(2)} ` +
        `e dura circa ${Number(mentionedService.duration)} minuti.`
      );
    }

    /*
     * ------------------------------------------------------------
     * DURATA DI UN SERVIZIO
     * ------------------------------------------------------------
     */

    const asksDuration =
      localText.includes("quanto dura") ||
      localText.includes("durata") ||
      localText.includes("quanto tempo");

    if (
      asksDuration &&
      mentionedService
    ) {

      return localReply(
        `${mentionedService.name} dura circa ` +
        `${Number(mentionedService.duration)} minuti.`
      );
    }

    /*
     * ------------------------------------------------------------
     * ORARI DI APERTURA
     * ------------------------------------------------------------
     */

    const asksHours =
      localText.includes("orari") ||
      localText.includes("orario") ||
      localText.includes("quando siete aperti") ||
      localText.includes("quando siete aperte") ||
      localText.includes("siete aperti") ||
      localText.includes("siete aperte") ||
      localText.includes("apertura");

    if (asksHours) {

      return localReply(
        `I nostri orari sono:\n\n${openingHours}`
      );
    }

    /*
     * ------------------------------------------------------------
     * INDIRIZZO
     * ------------------------------------------------------------
     */

    const asksAddress =
      localText.includes("indirizzo") ||
      localText.includes("dove siete") ||
      localText.includes("dove vi trovate") ||
      localText.includes("dove siete situati");

    if (
      asksAddress &&
      settings.address
    ) {

      return localReply(
        `Ci troviamo in ${settings.address}.`
      );
    }

    /*
     * ------------------------------------------------------------
     * TELEFONO
     * ------------------------------------------------------------
     */

    const asksPhone =
      localText.includes("telefono") ||
      localText.includes("numero di telefono") ||
      localText.includes("numero");

    if (
      asksPhone &&
      settings.phone
    ) {

      return localReply(
        `Il nostro numero di telefono è ${settings.phone}.`
      );
    }

    /*
     * ------------------------------------------------------------
     * WHATSAPP
     * ------------------------------------------------------------
     */

    const asksWhatsapp =
      localText.includes("whatsapp") ||
      localText.includes("numero whatsapp");

    if (
      asksWhatsapp &&
      settings.whatsapp
    ) {

      return localReply(
        `Puoi contattarci su WhatsApp al numero ${settings.whatsapp}.`
      );
    }

    /*
     * ------------------------------------------------------------
     * PROMOZIONI
     * ------------------------------------------------------------
     */

    const asksPromotion =
      localText.includes("promozioni") ||
      localText.includes("promozione") ||
      localText.includes("offerte") ||
      localText.includes("offerta") ||
      localText.includes("sconti") ||
      localText.includes("sconto");

    if (
      asksPromotion &&
      settings.promotion
    ) {

      return localReply(
        `Le promozioni attive sono:\n\n${settings.promotion}`
      );
    }

    /*
     * ------------------------------------------------------------
     * VERIFICA ORARIO SPECIFICO
     *
     * Esempi:
     *
     * "domani alle 15 è libero?"
     * "venerdì alle 10 posso venire?"
     *
     * Per ora gestiamo la verifica locale quando
     * la data arriva già nel formato YYYY-MM-DD.
     * Le richieste naturali più complesse continueranno
     * a essere gestite dall'AI.
     * ------------------------------------------------------------
     */

    const dateMatch =
      localText.match(
        /\b(20\d{2})-(\d{2})-(\d{2})\b/
      );

    const timeMatch =
      localText.match(
        /\b([01]?\d|2[0-3])(?::|\.)([0-5]\d)\b/
      );

    const asksAvailability =
      localText.includes("disponibile") ||
      localText.includes("disponibilita") ||
      localText.includes("libero") ||
      localText.includes("libera") ||
      localText.includes("posso venire") ||
      localText.includes("posso prenotare");

    if (
      asksAvailability &&
      dateMatch &&
      timeMatch
    ) {

      const requestedDate =
        `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;

      const requestedTime =
        `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;

      const serviceForAvailability =
        mentionedService;

      if (serviceForAvailability) {

        const duration =
          Number(
            serviceForAvailability.duration
          ) || 30;

        const available =
          isSlotFree(
            requestedDate,
            requestedTime,
            duration
          );

        if (available) {

          return localReply(
            `Sì, ${requestedTime} è disponibile ` +
            `per ${serviceForAvailability.name} ` +
            `il ${requestedDate}.`
          );

        }

        const alternatives =
          findAvailableSlots(
            requestedDate,
            duration
          );

        if (alternatives.length) {

          return localReply(
            `L'orario ${requestedTime} non è disponibile. ` +
            `Per ${serviceForAvailability.name} posso proporti: ` +
            `${alternatives.slice(0, 5).join(", ")}.`
          );

        }

        return localReply(
          `L'orario ${requestedTime} non è disponibile ` +
          `e non risultano altri orari liberi quel giorno.`
        );
      }
    }

    /*
     * ------------------------------------------------------------
     * SE LA RICHIESTA NON È SEMPLICE,
     * CONTINUA NORMALMENTE VERSO OPENAI.
     * ------------------------------------------------------------
     */
        /* ============================================================
       PRENOTAZIONI SEMPLICI - MOTORE LOCALE
       Gestisce richieste comuni senza chiamare OpenAI
    ============================================================ */

    const bookingWords = [
      "prenota",
      "prenotare",
      "prenotazione",
      "appuntamento",
      "vorrei",
      "posso venire",
      "posso fissare",
      "posso prendere",
      "fissare un appuntamento"
    ];

    const hasBookingIntent =
      bookingWords.some(word =>
        localText.includes(normalizeText(word))
      );

    /*
     * Cerca il servizio direttamente nel messaggio.
     */

    const bookingService =
      findServiceInText(message);

    /*
     * ------------------------------------------------------------
     * DATA
     * ------------------------------------------------------------
     */

    function getItalyToday() {
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

    function addDays(dateString, days) {
      const date =
        new Date(
          `${dateString}T12:00:00`
        );

      date.setDate(
        date.getDate() + days
      );

      const y =
        date.getFullYear();

      const m =
        String(
          date.getMonth() + 1
        ).padStart(2, "0");

      const d =
        String(
          date.getDate()
        ).padStart(2, "0");

      return `${y}-${m}-${d}`;
    }

    function getDateFromItalianText(text) {

      const normalized =
        normalizeText(text);

      const today =
        getItalyToday();

      if (
        normalized.includes("dopodomani")
      ) {
        return addDays(today, 2);
      }

      if (
        normalized.includes("domani")
      ) {
        return addDays(today, 1);
      }

      if (
        normalized.includes("oggi")
      ) {
        return today;
      }

      /*
       * Giorni della settimana.
       */

      const days = [
        "domenica",
        "lunedi",
        "martedi",
        "mercoledi",
        "giovedi",
        "venerdi",
        "sabato"
      ];

      const wantedIndex =
        days.findIndex(day =>
          normalized.includes(day)
        );

      if (wantedIndex !== -1) {

        const now =
          new Date(
            `${today}T12:00:00`
          );

        const currentDay =
          now.getDay();

        const targetDay =
          wantedIndex;

        let difference =
          targetDay - currentDay;

        /*
         * Se il giorno è oggi o è già passato,
         * intendiamo il prossimo giorno della settimana.
         */

        if (difference <= 0) {
          difference += 7;
        }

        return addDays(
          today,
          difference
        );
      }

      /*
       * Data già scritta YYYY-MM-DD.
       */

      const dateMatch =
        normalized.match(
          /\b(20\d{2})-(\d{2})-(\d{2})\b/
        );

      if (dateMatch) {
        return (
          `${dateMatch[1]}-` +
          `${dateMatch[2]}-` +
          `${dateMatch[3]}`
        );
      }

      return null;
    }

    /*
     * ------------------------------------------------------------
     * ORARIO
     * ------------------------------------------------------------
     */

    function getTimeFromItalianText(text) {

      const normalized =
        normalizeText(text);

      /*
       * 10:00
       * 10.00
       * ore 10:00
       * alle 10:00
       */

      let match =
        normalized.match(
          /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/
        );

      if (match) {
        return (
          `${String(match[1]).padStart(2, "0")}:` +
          `${match[2]}`
        );
      }

      /*
       * "alle 10"
       * "ore 10"
       * "alle 15"
       */

      match =
        normalized.match(
          /\b(?:alle|ore)\s+([01]?\d|2[0-3])\b/
        );

      if (match) {
        return (
          `${String(match[1]).padStart(2, "0")}:00`
        );
      }

      /*
       * Se la frase contiene esplicitamente
       * "mattina/pomeriggio/sera", ma non un'ora,
       * lasciamo che venga gestita dall'AI.
       */

      return null;
    }

    /*
     * ------------------------------------------------------------
     * GESTIONE PRENOTAZIONE LOCALE
     * ------------------------------------------------------------
     */

    if (
      hasBookingIntent &&
      bookingService
    ) {

      const bookingDate =
        getDateFromItalianText(message);

      const bookingTime =
        getTimeFromItalianText(message);

      const bookingName =
        String(
          clientName || ""
        ).trim();

      /*
       * Se manca il nome, chiediamo soltanto il nome.
       */

      if (!bookingName) {

        return res.status(200).json({
          reply:
            "Perfetto. Mi confermi il nome per la prenotazione?",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          local: true
        });
      }

      /*
       * Se manca la data, chiediamo soltanto la data.
       */

      if (!bookingDate) {

        return res.status(200).json({
          reply:
            `Perfetto. Mi manca solo il giorno per ` +
            `${bookingService.name}.`,
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          local: true
        });
      }

      /*
       * Se manca l'orario, chiediamo soltanto l'orario.
       */

      if (!bookingTime) {

        return res.status(200).json({
          reply:
            `Perfetto. Mi manca solo l'orario preciso ` +
            `per ${formatItalianDateLocal(bookingDate)}.`,
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          local: true
        });
      }

      /*
       * Controllo disponibilità.
       */

      const duration =
        Number(
          bookingService.duration
        ) || 30;

      const available =
        isSlotFree(
          bookingDate,
          bookingTime,
          duration
        );

      /*
       * Se occupato, proponiamo automaticamente
       * altri orari disponibili.
       */

      if (!available) {

        const alternatives =
          findAvailableSlots(
            bookingDate,
            duration
          );

        if (alternatives.length) {

          return res.status(200).json({
            reply:
              `L'orario ${bookingTime} non è disponibile. ` +
              `Posso proporti: ` +
              `${alternatives.slice(0, 5).join(", ")}.`,
            appointment: null,
            pendingAppointment: null,
            requiresConfirmation: false,
            confirmed: false,
            local: true
          });
        }

        return res.status(200).json({
          reply:
            `L'orario ${bookingTime} non è disponibile ` +
            `e non risultano altri orari liberi quel giorno.`,
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          local: true
        });
      }

      /*
       * Orario disponibile.
       *
       * NON salviamo ancora l'appuntamento.
       * Creiamo la richiesta pendente.
       */

      return res.status(200).json({
        reply:
          `Perfetto. Ho verificato la disponibilità per ` +
          `${bookingService.name} il ${bookingDate} alle ` +
          `${bookingTime}. Vuoi confermare l'appuntamento?`,

        appointment: null,

        pendingAppointment: {
          name: bookingName,
          service: bookingService.name,
          date: bookingDate,
          time: bookingTime
        },

        requiresConfirmation: true,

        confirmed: false,

        local: true
      });
    }

    /*
     * ------------------------------------------------------------
     * FINE MOTORE LOCALE
     *
     * Tutte le richieste che non possono essere gestite
     * localmente continuano verso OpenAI.
     * ------------------------------------------------------------
     */
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

Il tuo compito è assistere il cliente e raccogliere
richieste di appuntamento.

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
REGOLE APPUNTAMENTI
==================================================

- Usa esclusivamente i servizi presenti nel listino.
- Non inventare servizi.
- Non inventare prezzi.
- Non inventare disponibilità.
- La disponibilità viene verificata dal server.
- Usa sempre l'intera conversazione.
- Non perdere informazioni già fornite.
- Non chiedere nuovamente dati già presenti.
- Nome, servizio, data e ora possono essere forniti
  in messaggi differenti.
- Devi combinarli.
- "15" significa "15:00".
- "15.00" significa "15:00".
- "13.30" significa "13:30".
- La data deve essere YYYY-MM-DD.
- L'ora deve essere HH:MM.
- Se manca un solo dato, chiedi esclusivamente quel dato.
- Non chiedere conferme inutili prima di avere tutti
  i dati necessari.

==================================================
CONFERMA APPUNTAMENTO
==================================================

IMPORTANTE:

Quando hai raccolto TUTTI questi dati:

- nome
- servizio
- data
- ora

NON devi ancora creare una prenotazione definitiva.

Devi invece restituire:

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

L'appuntamento viene salvato SOLO dopo una successiva
conferma esplicita del cliente.

Non dire mai "appuntamento confermato" prima della
conferma esplicita.

Se il cliente risponde sì, confermo, va bene, ok,
prenota, procedi o equivalente, il sistema gestirà
la conferma.

Se il cliente annulla, il sistema annullerà la richiesta.

==================================================
FORMATO RISPOSTA
==================================================

Restituisci SEMPRE e SOLO JSON valido.

Se manca un dato:

{
  "reply": "domanda breve per ottenere esclusivamente il dato mancante",
  "appointment": null,
  "pendingAppointment": null,
  "requiresConfirmation": false,
  "confirmed": false
}

Se hai raccolto tutti i dati ma manca la conferma:

{
  "reply": "richiesta di conferma",
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
       PARSING RISPOSTA
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

    /*
     * ============================================================
     * NORMALIZZAZIONE PENDING APPOINTMENT
     * ============================================================
     */

    if (result.pendingAppointment) {
      const pending =
        result.pendingAppointment;

      /*
       * Servizio reale dal listino.
       */

      let service =
        getService(
          pending.service
        );

      /*
       * Se non trova il servizio nella risposta AI,
       * prova il messaggio attuale.
       */

      if (
        !service
      ) {
        service =
          findServiceInText(message);
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

      /*
       * Normalizza ora.
       */

      let time =
        String(
          pending.time || ""
        )
          .trim()
          .replace(".", ":");

      const minutes =
        toMinutes(time);

      if (minutes !== null) {
        time =
          formatTime(minutes);
      }

      /*
       * Normalizza nome.
       */

      const name =
        String(
          pending.name ||
          clientName ||
          ""
        ).trim();

      const normalizedPending = {
        name,
        service: service.name,
        date: String(
          pending.date || ""
        ).trim(),
        time
      };

      /*
       * Controlliamo se tutti i dati sono presenti.
       */

      const complete =
        !!(
          normalizedPending.name &&
          normalizedPending.service &&
          /^\d{4}-\d{2}-\d{2}$/.test(
            normalizedPending.date
          ) &&
          toMinutes(
            normalizedPending.time
          ) !== null
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

      /*
       * Controllo giorno.
       */

      const day =
        getDaySettings(
          normalizedPending.date
        );

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

      /*
       * Controllo disponibilità.
       */

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
          normalizedPending.date,
          normalizedPending.time,
          duration
        );

      if (!free) {
        const alternatives =
          findAvailableSlots(
            normalizedPending.date,
            duration
          );

        if (alternatives.length) {
          return res.status(200).json({
            reply:
              `L'orario ${normalizedPending.time} non è disponibile. ` +
              `Posso proporti: ${alternatives.slice(0, 3).join(", ")}.`,
            appointment: null,
            pendingAppointment: null,
            requiresConfirmation: false,
            confirmed: false
          });
        }

        return res.status(200).json({
          reply:
            "Non ci sono altri slot disponibili quel giorno.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });
      }

      /*
       * Slot disponibile:
       * NON salvare.
       * Creare richiesta pendente.
       */

      return res.status(200).json({
        reply:
          `Perfetto. Ho verificato la disponibilità ` +
          `per ${service.name} il ` +
          `${normalizedPending.date} alle ` +
          `${normalizedPending.time}. ` +
          `Vuoi confermare l'appuntamento?`,

        appointment: null,

        pendingAppointment:
          normalizedPending,

        requiresConfirmation: true,

        confirmed: false
      });
    }

    /*
     * ============================================================
     * RISPOSTA NORMALE
     * ============================================================
     */

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

    /*
     * ============================================================
     * GESTIONE ERRORI OPENAI
     * ============================================================
     */

    const status =
      Number(error?.status) ||
      Number(error?.statusCode) ||
      500;

    const errorCode =
      String(
        error?.code ||
        ""
      ).toLowerCase();

    const errorMessage =
      String(
        error?.message ||
        ""
      ).toLowerCase();

    /*
     * ------------------------------------------------------------
     * RATE LIMIT / 429
     * ------------------------------------------------------------
     *
     * Evitiamo di mostrare al cliente:
     *
     * - dettagli tecnici
     * - ID organizzazione
     * - messaggi interni OpenAI
     * - informazioni sui rate limit
     */

    if (
      status === 429 ||
      errorCode === "rate_limit_exceeded" ||
      errorMessage.includes("rate limit") ||
      errorMessage.includes("too many requests")
    ) {
      return res.status(429).json({
        error:
          "L'assistente è temporaneamente occupato. " +
          "Riprova tra qualche minuto."
      });
    }

    /*
     * ------------------------------------------------------------
     * AUTENTICAZIONE / API KEY
     * ------------------------------------------------------------
     */

    if (
      status === 401 ||
      errorCode === "invalid_api_key" ||
      errorMessage.includes("invalid api key") ||
      errorMessage.includes("incorrect api key")
    ) {
      return res.status(500).json({
        error:
          "L'assistente AI non è temporaneamente disponibile."
      });
    }

    /*
     * ------------------------------------------------------------
     * ERRORE GENERICO
     * ------------------------------------------------------------
     *
     * Non mostriamo mai al cliente il messaggio tecnico
     * completo restituito dal server.
     */

    return res.status(500).json({
      error:
        "Si è verificato un problema con l'assistente. " +
        "Riprova tra poco."
    });
  }
}
