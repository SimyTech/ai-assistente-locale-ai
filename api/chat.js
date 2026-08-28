import OpenAI from "openai";

/*
 * AI ASSISTENTE LOCALE
 *
 * PRINCIPI:
 * - servizi, prezzi, categorie, descrizioni, promozioni, orari e dati attività
 *   arrivano dall'app e vengono considerati fonte primaria;
 * - richieste semplici -> risposta locale, senza OpenAI;
 * - OpenAI -> solo per richieste realmente complesse;
 * - prenotazione -> mai salvata prima della conferma;
 * - alla conferma viene effettuato un secondo controllo;
 * - protezione contro doppie richieste sullo stesso processo/server;
 *
 * NOTA:
 * Per una protezione assoluta anche tra più istanze/serverless contemporanei
 * è necessario un archivio condiviso (database/KV). Questo file protegge
 * anche richieste quasi simultanee sulla stessa istanza e impedisce
 * duplicazioni logiche tramite bookingKey.
 */

const activeBookings = new Map();
const LOCK_TTL = 15000;

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
      business = "Attività locale",
      clientName = "",
      settings = {},
      services = [],
      appointments = [],
      history = [],
      pendingAppointment = null,
      requiresConfirmation = false,
      action = "chat"
    } = body;

    const text = String(message || "").trim();

    if (!text && action !== "post") {
      return res.status(400).json({
        error: "Messaggio mancante"
      });
    }

    const norm = value =>
      String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    const clean = value => String(value || "").trim();

    const toMinutes = value => {
      if (value === null || value === undefined) return null;

      let s = String(value)
        .trim()
        .toLowerCase()
        .replace(/[.,]/g, ":");

      if (/^\d{1,2}$/.test(s)) {
        s += ":00";
      }

      const match = s.match(/^(\d{1,2}):(\d{2})$/);

      if (!match) return null;

      const h = Number(match[1]);
      const m = Number(match[2]);

      if (h < 0 || h > 23 || m < 0 || m > 59) {
        return null;
      }

      return h * 60 + m;
    };

    const formatTime = minutes =>
      String(Math.floor(minutes / 60)).padStart(2, "0") +
      ":" +
      String(minutes % 60).padStart(2, "0");

    const getDayName = date => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
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
      ][new Date(date + "T12:00:00").getDay()];
    };

    const getService = name => {
      const target = norm(name);

      return services.find(service =>
        norm(service?.name) === target
      ) || null;
    };

    const findService = input => {
      const n = norm(input);

      if (!n) return null;

      return services.find(service => {
        const serviceName = norm(service?.name);

        if (!serviceName) return false;

        if (n.includes(serviceName)) {
          return true;
        }

        const words = serviceName
          .split(/\s+/)
          .filter(Boolean);

        return words.length > 0 &&
          words.every(word => n.includes(word));
      }) || null;
    };

    const getServiceDuration = service => {
      const duration = Number(service?.duration);

      return Number.isFinite(duration) && duration > 0
        ? duration
        : 30;
    };

    const getDaySettings = date =>
      settings?.hours?.[getDayName(date)] || null;

    const breakOverlap = (start, end, day) => {
      const breakStart = toMinutes(day?.breakStart);
      const breakEnd = toMinutes(day?.breakEnd);

      return (
        breakStart !== null &&
        breakEnd !== null &&
        breakStart < breakEnd &&
        start < breakEnd &&
        end > breakStart
      );
    };

    /*
     * Controllo sovrapposizione appuntamenti.
     *
     * Supporta sia il vecchio formato:
     *   { n, d, t, s }
     *
     * sia il formato esteso:
     *   { name, date, time, service }
     */
    const appointmentDate = appointment =>
      clean(appointment?.date || appointment?.d);

    const appointmentTime = appointment =>
      clean(appointment?.time || appointment?.t);

    const appointmentService = appointment =>
      clean(appointment?.service || appointment?.s);

    const appointmentName = appointment =>
      clean(appointment?.name || appointment?.n);

    const isSameBooking = (a, b) => {
      return (
        appointmentDate(a) === appointmentDate(b) &&
        appointmentTime(a) === appointmentTime(b) &&
        norm(appointmentService(a)) === norm(appointmentService(b)) &&
        norm(appointmentName(a)) === norm(appointmentName(b))
      );
    };

    const isTimeFree = (date, time, duration) => {
      const day = getDaySettings(date);

      if (!day || day.status === "closed") {
        return false;
      }

      const opening = toMinutes(day.open);
      const closing = toMinutes(day.close);
      const start = toMinutes(time);

      if (
        opening === null ||
        closing === null ||
        start === null
      ) {
        return false;
      }

      const end = start + Number(duration || 30);

      if (start < opening || end > closing) {
        return false;
      }

      if (breakOverlap(start, end, day)) {
        return false;
      }

      return !appointments.some(appointment => {
        const aDate = appointmentDate(appointment);

        if (aDate !== date) {
          return false;
        }

        const existingStart =
          toMinutes(appointmentTime(appointment));

        if (existingStart === null) {
          return false;
        }

        const existingService =
          getService(appointmentService(appointment));

        const existingDuration =
          getServiceDuration(existingService);

        const existingEnd =
          existingStart + existingDuration;

        return (
          start < existingEnd &&
          end > existingStart
        );
      });
    };

    const getAvailableSlots = (
      date,
      duration,
      startAfter = null,
      endBefore = null
    ) => {
      const day = getDaySettings(date);

      if (!day || day.status === "closed") {
        return [];
      }

      const opening = toMinutes(day.open);
      const closing = toMinutes(day.close);

      if (
        opening === null ||
        closing === null ||
        opening >= closing
      ) {
        return [];
      }

      let first =
        startAfter === null
          ? opening
          : Math.max(opening, startAfter);

      let last =
        endBefore === null
          ? closing
          : Math.min(closing, endBefore);

      first = Math.ceil(first / 30) * 30;

      const result = [];

      for (
        let start = first;
        start + duration <= last;
        start += 30
      ) {
        if (
          isTimeFree(
            date,
            formatTime(start),
            duration
          )
        ) {
          result.push(formatTime(start));
        }
      }

      return result;
    };

    /*
     * Data odierna Europe/Rome.
     */
    const parts = new Intl.DateTimeFormat(
      "en-CA",
      {
        timeZone: "Europe/Rome",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }
    ).formatToParts(new Date());

    const dateParts = {};

    parts.forEach(part => {
      if (part.type !== "literal") {
        dateParts[part.type] = part.value;
      }
    });

    const today =
      `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

    const addDays = (date, amount) => {
      const d = new Date(date + "T12:00:00");

      d.setDate(d.getDate() + amount);

      return (
        `${d.getFullYear()}-` +
        `${String(d.getMonth() + 1).padStart(2, "0")}-` +
        `${String(d.getDate()).padStart(2, "0")}`
      );
    };

    const italianDate = date =>
      new Date(date + "T12:00:00")
        .toLocaleDateString(
          "it-IT",
          {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
          }
        );

    const detectDate = input => {
      const n = norm(input);

      if (n.includes("oggi")) {
        return today;
      }

      if (n.includes("dopodomani")) {
        return addDays(today, 2);
      }

      if (n.includes("domani")) {
        return addDays(today, 1);
      }

      const iso =
        n.match(/\b(20\d{2}-\d{2}-\d{2})\b/);

      if (iso) {
        return iso[1];
      }

      const numeric =
        n.match(
          /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b/
        );

      if (numeric) {
        return (
          `${numeric[3] || today.slice(0, 4)}-` +
          `${String(numeric[2]).padStart(2, "0")}-` +
          `${String(numeric[1]).padStart(2, "0")}`
        );
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

      for (const [name, target] of Object.entries(
        weekdays
      )) {
        if (n.includes(name)) {
          const current =
            new Date(today + "T12:00:00").getDay();

          let diff = target - current;

          if (diff <= 0) {
            diff += 7;
          }

          return addDays(today, diff);
        }
      }

      return null;
    };

    const detectTime = input => {
      const n = norm(input);

      let match =
        n.match(
          /\b([01]?\d|2[0-3])[\.:,]([0-5]\d)\b/
        );

      if (match) {
        return formatTime(
          Number(match[1]) * 60 +
          Number(match[2])
        );
      }

      match =
        n.match(
          /\b(?:alle|ore|verso|per le)\s+([01]?\d|2[0-3])\b/
        );

      if (match) {
        return formatTime(
          Number(match[1]) * 60
        );
      }

      if (/^\d{1,2}$/.test(n)) {
        const hour = Number(n);

        if (hour <= 23) {
          return formatTime(hour * 60);
        }
      }

      return null;
    };

    const detectPeriod = input => {
      const n = norm(input);

      if (n.includes("mattina")) {
        return [480, 780];
      }

      if (n.includes("pomeriggio")) {
        return [840, 1140];
      }

      if (n.includes("sera")) {
        return [1020, 1320];
      }

      return null;
    };

    const confirmations = new Set([
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
    ]);

    const cancellations = new Set([
      "no",
      "annulla",
      "cancella",
      "non confermo",
      "lascia perdere"
    ]);

    const normalizedMessage = norm(text);

    const isConfirmation =
      confirmations.has(normalizedMessage) ||
      normalizedMessage.includes("si confermo") ||
      normalizedMessage.includes("sì confermo");

    const isCancellation =
      cancellations.has(normalizedMessage);

    const service = findService(text);
    const detectedDate = detectDate(text);
    const detectedTime = detectTime(text);
    const period = detectPeriod(text);

    const asksAvailability =
      normalizedMessage.includes("orari disponibili") ||
      normalizedMessage.includes("orari liberi") ||
      normalizedMessage.includes("quando sei libero") ||
      normalizedMessage.includes("quando siete liberi") ||
      normalizedMessage.includes("che ore hai") ||
      normalizedMessage.includes("che orari hai");

    const bookingRequest =
      normalizedMessage.includes("prenot") ||
      normalizedMessage.includes("appuntament") ||
      normalizedMessage.includes("vorrei") ||
      normalizedMessage.includes("voglio") ||
      normalizedMessage.includes("fissare") ||
      normalizedMessage.includes("prenotare") ||
      !!service;

    /*
     * ============================================================
     * CONFERMA APPUNTAMENTO
     * ============================================================
     */

    if (
      pendingAppointment &&
      requiresConfirmation &&
      isConfirmation
    ) {
      const p = pendingAppointment;

      const selectedService =
        getService(p.service);

      if (!selectedService) {
        return res.status(200).json({
          reply:
            "Il servizio richiesto non è più presente nel listino.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });
      }

      const name =
        clean(p.name || clientName);

      const date =
        clean(p.date);

      const parsedTime =
        toMinutes(p.time);

      const time =
        parsedTime === null
          ? clean(p.time)
          : formatTime(parsedTime);

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

      /*
       * bookingKey identifica univocamente la prenotazione.
       */
      const bookingKey = [
        date,
        time,
        norm(selectedService.name),
        norm(name)
      ].join("|");

      /*
       * Protezione contro due conferme contemporanee
       * sulla stessa istanza.
       */
      const now = Date.now();

      for (const [key, timestamp] of activeBookings.entries()) {
        if (now - timestamp > LOCK_TTL) {
          activeBookings.delete(key);
        }
      }

      if (activeBookings.has(bookingKey)) {
        return res.status(409).json({
          reply:
            "La richiesta di conferma è già in elaborazione. Attendi il risultato prima di riprovare.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          duplicate: true
        });
      }

      activeBookings.set(
        bookingKey,
        now
      );

      try {
        /*
         * SECONDO CONTROLLO DI DISPONIBILITÀ.
         *
         * Questo controllo avviene nuovamente al momento
         * della conferma e non si fida del precedente risultato.
         */
        const availableNow =
          isTimeFree(
            date,
            time,
            getServiceDuration(selectedService)
          );

        if (!availableNow) {
          const alternativeSlots =
            getAvailableSlots(
              date,
              getServiceDuration(selectedService)
            );

          return res.status(200).json({
            reply:
              alternativeSlots.length
                ? `Nel frattempo l'orario ${time} non è più disponibile. Posso proporti: ${alternativeSlots.slice(0, 5).join(", ")}.`
                : "Nel frattempo l'orario richiesto non è più disponibile e non ci sono altri slot quel giorno.",
            appointment: null,
            pendingAppointment: null,
            requiresConfirmation: false,
            confirmed: false,
            availableSlots: alternativeSlots,
            availableDate: date,
            availableService: selectedService.name
          });
        }

        /*
         * Controllo ulteriore contro eventuale duplicato
         * già presente nei dati ricevuti.
         */
        const duplicate =
          appointments.some(existing =>
            isSameBooking(
              existing,
              {
                name,
                date,
                time,
                service: selectedService.name
              }
            )
          );

        if (duplicate) {
          return res.status(200).json({
            reply:
              "Questo appuntamento risulta già presente. Non ne creo un secondo duplicato.",
            appointment: null,
            pendingAppointment: null,
            requiresConfirmation: false,
            confirmed: false,
            duplicate: true
          });
        }

        /*
         * L'API conferma.
         *
         * Il salvataggio effettivo nel calendario locale viene
         * effettuato dall'HTML dopo questa risposta.
         */
        return res.status(200).json({
          reply:
            `Appuntamento confermato per ${selectedService.name} il ${italianDate(date)} alle ${time}.`,
          appointment: {
            id: bookingKey,
            name,
            service: selectedService.name,
            date,
            time,
            bookingKey
          },
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: true
        });
      } finally {
        /*
         * Manteniamo il lock ancora per poco per evitare
         * una seconda conferma immediata.
         */
        setTimeout(() => {
          activeBookings.delete(bookingKey);
        }, LOCK_TTL);
      }
    }

    /*
     * ============================================================
     * ANNULLAMENTO
     * ============================================================
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

    /*
     * ============================================================
     * DISPONIBILITÀ
     * ============================================================
     */

    if (asksAvailability) {
      const date =
        detectedDate ||
        addDays(today, 1);

      const selectedService =
        service || null;

      const duration =
        getServiceDuration(selectedService);

      let slots =
        getAvailableSlots(
          date,
          duration
        );

      if (period) {
        slots = slots.filter(slot => {
          const minutes =
            toMinutes(slot);

          return (
            minutes >= period[0] &&
            minutes <= period[1]
          );
        });
      }

      return res.status(200).json({
        reply:
          slots.length
            ? `Gli orari disponibili per ${italianDate(date)} sono: ${slots.join(", ")}.`
            : `Non risultano orari disponibili per ${italianDate(date)}.`,
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false,
        availableSlots: slots,
        availableDate: date,
        availableService:
          selectedService?.name || null
      });
    }

    /*
     * ============================================================
     * NUOVA PRENOTAZIONE
     * ============================================================
     */

    if (
      bookingRequest &&
      (service || pendingAppointment)
    ) {
      const selectedService =
        service ||
        getService(pendingAppointment?.service);

      const date =
        detectedDate ||
        pendingAppointment?.date ||
        null;

      const time =
        detectedTime ||
        pendingAppointment?.time ||
        null;

      const name =
        clean(
          clientName ||
          pendingAppointment?.name
        );

      if (!selectedService) {
        return res.status(200).json({
          reply:
            "Quale servizio vuoi prenotare?",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });
      }

      if (!name) {
        return res.status(200).json({
          reply:
            "Perfetto. Mi confermi il nome per la prenotazione?",
          appointment: null,
          pendingAppointment: {
            name: "",
            service: selectedService.name,
            date: date || "",
            time: time || ""
          },
          requiresConfirmation: false,
          confirmed: false
        });
      }

      if (!date) {
        return res.status(200).json({
          reply:
            "Per quale giorno vuoi prenotare?",
          appointment: null,
          pendingAppointment: {
            name,
            service: selectedService.name,
            date: "",
            time: ""
          },
          requiresConfirmation: false,
          confirmed: false
        });
      }

      if (!time) {
        const slots =
          getAvailableSlots(
            date,
            getServiceDuration(selectedService)
          );

        return res.status(200).json({
          reply:
            slots.length
              ? `Perfetto. Scegli un orario per ${italianDate(date)}.`
              : `Non risultano orari disponibili per ${italianDate(date)}.`,
          appointment: null,
          pendingAppointment: {
            name,
            service: selectedService.name,
            date,
            time: ""
          },
          requiresConfirmation: false,
          confirmed: false,
          availableSlots: slots,
          availableDate: date,
          availableService: selectedService.name
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
            `L'attività è chiusa ${italianDate(date)}. Scegli un altro giorno.`,
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });
      }

      /*
       * Prima verifica disponibilità.
       */
      if (
        !isTimeFree(
          date,
          time,
          getServiceDuration(selectedService)
        )
      ) {
        const alternativeSlots =
          getAvailableSlots(
            date,
            getServiceDuration(selectedService)
          );

        return res.status(200).json({
          reply:
            alternativeSlots.length
              ? `L'orario ${time} non è disponibile. Posso proporti: ${alternativeSlots.slice(0, 8).join(", ")}.`
              : "Non ci sono altri slot disponibili quel giorno.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          availableSlots: alternativeSlots,
          availableDate: date,
          availableService: selectedService.name
        });
      }

      /*
       * CONTROLLO DUPLICATO GIÀ PRESENTE.
       */
      const alreadyExists =
        appointments.some(existing =>
          isSameBooking(
            existing,
            {
              name,
              date,
              time,
              service: selectedService.name
            }
          )
        );

      if (alreadyExists) {
        return res.status(200).json({
          reply:
            "Questo appuntamento risulta già presente. Non è necessario crearne un altro.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          duplicate: true
        });
      }

      /*
       * NON SALVIAMO.
       *
       * Prepariamo soltanto la richiesta in attesa
       * della conferma esplicita.
       */
      return res.status(200).json({
        reply:
          `Perfetto. Ho verificato la disponibilità per ${selectedService.name} il ${italianDate(date)} alle ${time}. Vuoi confermare l'appuntamento?`,
        appointment: null,
        pendingAppointment: {
          id: [
            date,
            time,
            norm(selectedService.name),
            norm(name)
          ].join("|"),
          name,
          service: selectedService.name,
          date,
          time
        },
        requiresConfirmation: true,
        confirmed: false
      });
    }

    /*
     * ============================================================
     * POST AI
     * ============================================================
     */

    if (action === "post") {
      const topic =
        clean(body.topic) ||
        "una nuova promozione";

      const promotion =
        clean(
          settings.promotion ||
          body.promotion
        );

      const serviceList =
        services.length
          ? services
              .map(service => {
                const category =
                  service.category
                    ? ` [${service.category}]`
                    : "";

                const description =
                  service.description
                    ? ` — ${service.description}`
                    : "";

                return (
                  `${service.name}${category}: ` +
                  `€${service.price}, ` +
                  `${service.duration} min` +
                  description
                );
              })
              .join("\n")
          : "Nessun servizio inserito.";

      /*
       * Se non c'è OpenAI, restituiamo comunque un post
       * funzionante utilizzando esclusivamente i dati locali.
       */
      if (!process.env.OPENAI_API_KEY) {
        return res.status(200).json({
          reply:
            `✨ ${topic}!\n\n` +
            `${business}\n\n` +
            `${promotion || "Scopri i nostri servizi e contattaci per informazioni."}\n\n` +
            `Professionalità, attenzione e servizi personalizzati.\n\n` +
            `📅 Prenota il tuo appuntamento.\n` +
            `📩 Contattaci per informazioni.`,
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });
      }

      const client =
        new OpenAI({
          apiKey: process.env.OPENAI_API_KEY
        });

      const result =
        await client.responses.create({
          model: "gpt-5.4-mini",

          instructions: `
Sei un copywriter professionale per attività locali italiane.

Scrivi un post social naturale, professionale e semplice.

NON inventare:
- servizi
- prezzi
- promozioni
- indirizzi
- telefoni
- orari
- caratteristiche dell'attività.

Usa esclusivamente le informazioni fornite.

Attività:
${business}

Tipo:
${settings.type || "Non specificato"}

Descrizione:
${settings.description || "Non specificata"}

Promozione:
${promotion || "Nessuna promozione specificata"}

Servizi:
${serviceList}

Argomento del post:
${topic}

Restituisci esclusivamente il testo del post.
          `,

          input: topic
        });

      return res.status(200).json({
        reply:
          result.output_text ||
          "Non sono riuscito a generare il post.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      });
    }

    /*
     * ============================================================
     * RISPOSTE LOCALI SEMPLICI
     * ============================================================
     */

    const lower =
      normalizedMessage;

    const settingsName =
      settings.name ||
      business ||
      "Attività locale";

    if (
      lower.includes("prezzo") ||
      lower.includes("prezzi") ||
      lower.includes("costo") ||
      lower.includes("quanto costa") ||
      lower.includes("listino")
    ) {
      if (!services.length) {
        return res.status(200).json({
          reply:
            "Al momento non è presente un listino nell'app.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });
      }

      const lines =
        services.map(service => {
          const category =
            service.category
              ? ` (${service.category})`
              : "";

          const description =
            service.description
              ? ` — ${service.description}`
              : "";

          return (
            `• ${service.name}${category}: ` +
            `€${Number(service.price || 0).toFixed(2)}` +
            `${description}`
          );
        });

      return res.status(200).json({
        reply:
          `Ecco i servizi disponibili presso ${settingsName}:\n\n` +
          lines.join("\n"),
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      });
    }

    if (
      lower.includes("servizi") ||
      lower.includes("trattamenti") ||
      lower.includes("cosa fate") ||
      lower.includes("cosa offrite")
    ) {
      if (!services.length) {
        return res.status(200).json({
          reply:
            "Al momento non sono presenti servizi configurati nell'app.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false
        });
      }

      const lines =
        services.map(service => {
          const category =
            service.category
              ? ` — ${service.category}`
              : "";

          const description =
            service.description
              ? `: ${service.description}`
              : "";

          return (
            `• ${service.name}${category}${description}`
          );
        });

      return res.status(200).json({
        reply:
          `Presso ${settingsName} trovi:\n\n` +
          lines.join("\n"),
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      });
    }

    if (
      lower.includes("promozion") ||
      lower.includes("offerte") ||
      lower.includes("offerta")
    ) {
      const promotion =
        clean(settings.promotion);

      return res.status(200).json({
        reply:
          promotion
            ? `Le promozioni attive sono:\n\n${promotion}`
            : "Al momento non risultano promozioni attive.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      });
    }

    if (
      lower.includes("indirizzo") ||
      lower.includes("dove siete") ||
      lower.includes("dove siete")
    ) {
      return res.status(200).json({
        reply:
          settings.address
            ? `Ci troviamo a: ${settings.address}`
            : "L'indirizzo non è ancora configurato nell'app.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      });
    }

    if (
      lower.includes("telefono") ||
      lower.includes("numero") ||
      lower.includes("contatto")
    ) {
      return res.status(200).json({
        reply:
          settings.phone
            ? `Il numero di telefono è ${settings.phone}.`
            : "Il numero di telefono non è ancora configurato nell'app.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      });
    }

    /*
     * ============================================================
     * FALLBACK OPENAI
     * ============================================================
     */

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        reply:
          "Posso aiutarti con servizi, prezzi, promozioni, orari e appuntamenti. Per questa richiesta è necessaria l'elaborazione AI, ma OpenAI non è configurato.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      });
    }

    const client =
      new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
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

          return (
            `${label}: ${day.open} - ${day.close}` +
            (
              day.breakStart &&
              day.breakEnd
                ? ` (pausa ${day.breakStart}-${day.breakEnd})`
                : ""
            )
          );
        })
        .join("\n");

    const serviceList =
      services.length
        ? services.map(service => {
            const category =
              service.category
                ? ` [Categoria: ${service.category}]`
                : "";

            const description =
              service.description
                ? ` — ${service.description}`
                : "";

            return (
              `- ${service.name}${category}: ` +
              `€${service.price}, ` +
              `${service.duration} minuti` +
              `${description}`
            );
          }).join("\n")
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
            .slice(-12)
        : [];

    const ai =
      await client.responses.create({
        model: "gpt-5.4-mini",

        instructions: `
Sei l'assistente virtuale di ${settingsName}.

Rispondi sempre in italiano.

NON inventare informazioni.

I dati locali dell'attività sono la fonte primaria.

Informazioni attività:
Nome: ${settingsName}
Tipo: ${settings.type || "Non specificato"}
Descrizione: ${settings.description || "Non specificata"}
Indirizzo: ${settings.address || "Non specificato"}
Telefono: ${settings.phone || "Non specificato"}
WhatsApp: ${settings.whatsapp || "Non specificato"}

Promozioni:
${settings.promotion || "Nessuna promozione configurata."}

Orari:
${openingHours}

Servizi:
${serviceList}

Nome cliente:
${clientName || "Non fornito"}

Data odierna:
${today}

Le prenotazioni devono essere gestite dal flusso server
di disponibilità e conferma.

Non dichiarare mai una prenotazione confermata
se il server non ha restituito confirmed=true.

Rispondi esclusivamente con JSON valido:

{
  "reply": "risposta",
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
            content: text
          }
        ]
      });

    let result;

    try {
      result =
        JSON.parse(
          ai.output_text
        );
    } catch {
      result = {
        reply:
          ai.output_text ||
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

    if (
      error?.status === 429 ||
      String(error?.message || "")
        .includes("429") ||
      String(error?.message || "")
        .toLowerCase()
        .includes("rate limit")
    ) {
      return res.status(200).json({
        reply:
          "L'assistente AI è temporaneamente occupato. Puoi riprovare tra qualche minuto.",
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
