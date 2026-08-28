import OpenAI from "openai";

/*
============================================================
 API CHAT - ASSISTENTE ATTIVITÀ LOCALE
============================================================

 PRINCIPIO:

 1. DATI LOCALI = PRIORITÀ ASSOLUTA
    - servizi
    - categorie
    - descrizioni
    - prezzi
    - durate
    - promozioni
    - indirizzo
    - telefono
    - WhatsApp
    - orari
    - calendario
    - disponibilità
    - prenotazioni
    - conferme

 2. OPENAI = SOLO FALLBACK
    OpenAI viene utilizzato soltanto quando la richiesta
    non può essere soddisfatta in modo affidabile dai
    dati locali.

 3. L'API NON crea, modifica o elimina dati dell'app.
    Restituisce semplicemente il risultato al frontend.

============================================================
*/

export default async function handler(req, res) {

  /*
  ============================================================
  METODO
  ============================================================
  */

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo non consentito"
    });
  }

  try {

    /*
    ============================================================
    DATI RICEVUTI
    ============================================================
    */

    const body = req.body || {};

    const message =
      String(body.message || "").trim();

    const business =
      String(body.business || "").trim();

    const clientName =
      String(body.clientName || "").trim();

    const settings =
      body.settings &&
      typeof body.settings === "object"
        ? body.settings
        : {};

    const services =
      Array.isArray(body.services)
        ? body.services
        : [];

    const appointments =
      Array.isArray(body.appointments)
        ? body.appointments
        : [];

    const promotions =
      Array.isArray(body.promotions)
        ? body.promotions
        : [];

    const history =
      Array.isArray(body.history)
        ? body.history
        : [];

    const pendingAppointment =
      body.pendingAppointment &&
      typeof body.pendingAppointment === "object"
        ? body.pendingAppointment
        : null;

    const requiresConfirmation =
      body.requiresConfirmation === true;

    if (!message) {
      return res.status(400).json({
        error: "Messaggio mancante"
      });
    }

    /*
    ============================================================
    UTILITÀ
    ============================================================
    */

    function normalizeText(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
    }

    function escapeRegExp(value) {
      return String(value || "")
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function toMinutes(value) {

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return null;
      }

      let text =
        String(value)
          .trim()
          .toLowerCase()
          .replace(",", ":")
          .replace(".", ":");

      if (/^\d{1,2}$/.test(text)) {
        text = `${text}:00`;
      }

      const match =
        text.match(/^(\d{1,2}):(\d{2})$/);

      if (!match) {
        return null;
      }

      const h =
        Number(match[1]);

      const m =
        Number(match[2]);

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

      if (
        minutes === null ||
        minutes === undefined ||
        Number.isNaN(Number(minutes))
      ) {
        return null;
      }

      const h =
        String(
          Math.floor(Number(minutes) / 60)
        ).padStart(2, "0");

      const m =
        String(
          Number(minutes) % 60
        ).padStart(2, "0");

      return `${h}:${m}`;
    }

    function cleanPrice(value) {

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return "";
      }

      const number =
        Number(
          String(value)
            .replace("€", "")
            .replace(",", ".")
            .trim()
        );

      if (Number.isNaN(number)) {
        return String(value);
      }

      return number.toFixed(2).replace(".", ",");
    }

    function getService(name) {

      if (!name) {
        return null;
      }

      const wanted =
        normalizeText(name);

      return (
        services.find(service => {

          if (!service) {
            return false;
          }

          return (
            normalizeText(service.name) ===
            wanted
          );
        }) ||
        null
      );
    }

    /*
    ============================================================
    SERVIZIO NEL TESTO
    ============================================================
    */

    function findServiceInText(text) {

      const normalized =
        normalizeText(text);

      if (!normalized) {
        return null;
      }

      /*
      Prima il nome completo.
      Servizi più lunghi prima di quelli brevi.
      */

      const sorted =
        [...services]
          .filter(service =>
            service &&
            service.name
          )
          .sort(
            (a, b) =>
              normalizeText(b.name).length -
              normalizeText(a.name).length
          );

      for (const service of sorted) {

        const name =
          normalizeText(service.name);

        if (
          name &&
          normalized.includes(name)
        ) {
          return service;
        }
      }

      /*
      Ricerca per parole.
      */

      for (const service of sorted) {

        const words =
          normalizeText(service.name)
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
      Alcune abbreviazioni comuni.
      */

      const aliases = [
        ["taglio uomo", "taglio"],
        ["taglio donna", "taglio"],
        ["taglio capelli", "taglio"],
        ["piega capelli", "piega"],
        ["colore capelli", "colore"]
      ];

      for (const [phrase, search] of aliases) {

        if (!normalized.includes(phrase)) {
          continue;
        }

        const found =
          services.find(service =>
            normalizeText(service.name)
              .includes(search)
          );

        if (found) {
          return found;
        }
      }

      return null;
    }

    /*
    ============================================================
    CATEGORIA / DESCRIZIONE SERVIZI
    ============================================================
    */

    function serviceText(service) {

      if (!service) {
        return "";
      }

      const parts = [];

      if (service.name) {
        parts.push(String(service.name));
      }

      if (service.category) {
        parts.push(
          `Categoria: ${service.category}`
        );
      }

      if (service.description) {
        parts.push(
          String(service.description)
        );
      }

      if (service.advancedDescription) {
        parts.push(
          String(service.advancedDescription)
        );
      }

      if (service.descriptionAdvanced) {
        parts.push(
          String(service.descriptionAdvanced)
        );
      }

      if (
        service.price !== undefined &&
        service.price !== null &&
        service.price !== ""
      ) {
        parts.push(
          `Prezzo: €${cleanPrice(service.price)}`
        );
      }

      if (
        service.duration !== undefined &&
        service.duration !== null &&
        service.duration !== ""
      ) {
        parts.push(
          `Durata: ${service.duration} minuti`
        );
      }

      return parts.join(" — ");
    }

    /*
    ============================================================
    DATA ITALIANA / EUROPE ROME
    ============================================================
    */

    function getRomeToday() {

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

      return (
        `${map.year}-${map.month}-${map.day}`
      );
    }

    const today =
      getRomeToday();

    function addDays(dateString, amount) {

      const date =
        new Date(
          `${dateString}T12:00:00`
        );

      date.setDate(
        date.getDate() + Number(amount)
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

    function italianDate(date) {

      const d =
        new Date(
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

    function getDayName(date) {

      if (
        !date ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
      ) {
        return null;
      }

      const d =
        new Date(
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

    /*
    ============================================================
    DATA DAL TESTO
    ============================================================
    */

    function detectDate(text) {

      const normalized =
        normalizeText(text);

      if (
        /\boggi\b/.test(normalized)
      ) {
        return today;
      }

      if (
        /\bdomani\b/.test(normalized)
      ) {
        return addDays(today, 1);
      }

      if (
        /\bdopodomani\b/.test(normalized)
      ) {
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
          String(numeric[1])
            .padStart(2, "0");

        const month =
          String(numeric[2])
            .padStart(2, "0");

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
        const [name, target]
        of Object.entries(weekdays)
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

    /*
    ============================================================
    ORA DAL TESTO
    ============================================================
    */

    function detectTime(text) {

      const normalized =
        normalizeText(text);

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
          return formatTime(
            hour * 60
          );
        }
      }

      return null;
    }

    /*
    ============================================================
    FASCIA ORARIA
    ============================================================
    */

    function detectPeriod(text) {

      const normalized =
        normalizeText(text);

      if (
        normalized.includes("mattina")
      ) {
        return {
          start: 8 * 60,
          end: 13 * 60
        };
      }

      if (
        normalized.includes("pranzo")
      ) {
        return {
          start: 12 * 60,
          end: 14 * 60
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

    /*
    ============================================================
    ORARI
    ============================================================
    */

    function getDaySettings(date) {

      const dayName =
        getDayName(date);

      if (!dayName) {
        return null;
      }

      return (
        settings.hours?.[dayName] ||
        null
      );
    }

    function overlapsBreak(
      start,
      end,
      day
    ) {

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

    /*
    ============================================================
    DURATA APPUNTAMENTO
    ============================================================
    */

    function getServiceDuration(service) {

      const duration =
        Number(
          service?.duration
        );

      return (
        Number.isFinite(duration) &&
        duration > 0
      )
        ? duration
        : 30;
    }

    function getAppointmentDuration(
      appointment
    ) {

      if (!appointment) {
        return 30;
      }

      const service =
        getService(
          appointment.s ||
          appointment.service
        );

      if (service) {
        return getServiceDuration(service);
      }

      const direct =
        Number(
          appointment.duration
        );

      return (
        Number.isFinite(direct) &&
        direct > 0
      )
        ? direct
        : 30;
    }

    /*
    ============================================================
    SLOT LIBERO
    ============================================================
    */

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

      return !appointments.some(
        appointment => {

          if (!appointment) {
            return false;
          }

          const appointmentDate =
            appointment.d ||
            appointment.date;

          const appointmentTime =
            appointment.t ||
            appointment.time;

          if (
            appointmentDate !== date ||
            !appointmentTime
          ) {
            return false;
          }

          const existingStart =
            toMinutes(
              appointmentTime
            );

          if (existingStart === null) {
            return false;
          }

          const existingDuration =
            getAppointmentDuration(
              appointment
            );

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

    /*
    ============================================================
    SLOT DISPONIBILI
    ============================================================
    */

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

      if (
        startAfter !== null
      ) {
        first =
          Math.max(
            first,
            startAfter
          );
      }

      if (
        endBefore !== null
      ) {
        last =
          Math.min(
            last,
            endBefore
          );
      }

      /*
      Il calendario lavora a intervalli
      di 30 minuti.
      */

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

    /*
    ============================================================
    PROMOZIONI
    ============================================================
    */

    function getPromotionText(promo) {

      if (!promo) {
        return "";
      }

      const parts = [];

      if (promo.name) {
        parts.push(String(promo.name));
      }

      if (promo.title) {
        parts.push(String(promo.title));
      }

      if (promo.description) {
        parts.push(
          String(promo.description)
        );
      }

      if (promo.text) {
        parts.push(
          String(promo.text)
        );
      }

      if (promo.price) {
        parts.push(
          `Prezzo: €${cleanPrice(promo.price)}`
        );
      }

      if (promo.discount) {
        parts.push(
          `Sconto: ${promo.discount}`
        );
      }

      if (promo.validFrom) {
        parts.push(
          `Dal ${promo.validFrom}`
        );
      }

      if (promo.validTo) {
        parts.push(
          `Al ${promo.validTo}`
        );
      }

      return parts.join(" — ");
    }

    /*
    ============================================================
    RICERCA PROMOZIONI
    ============================================================
    */

    function hasPromotionData() {
      return promotions.length > 0;
    }

    /*
    ============================================================
    INTENTI LOCALI
    ============================================================
    */

    const normalizedMessage =
      normalizeText(message);

    const detectedService =
      findServiceInText(message);

    const detectedDate =
      detectDate(message);

    const detectedTime =
      detectTime(message);

    const detectedPeriod =
      detectPeriod(message);

    const asksPromotion =
      normalizedMessage.includes("promo") ||
      normalizedMessage.includes("promozion") ||
      normalizedMessage.includes("offerta") ||
      normalizedMessage.includes("sconto") ||
      normalizedMessage.includes("occasion");

    const asksPrice =
      normalizedMessage.includes("prezzo") ||
      normalizedMessage.includes("costo") ||
      normalizedMessage.includes("quanto costa") ||
      normalizedMessage.includes("quanto viene") ||
      normalizedMessage.includes("quanto pago");

    const asksServices =
      normalizedMessage.includes("servizi") ||
      normalizedMessage.includes("trattamenti") ||
      normalizedMessage.includes("cosa fate") ||
      normalizedMessage.includes("cosa offrite") ||
      normalizedMessage.includes("listino");

    const asksDescription =
      normalizedMessage.includes("descrizione") ||
      normalizedMessage.includes("come funziona") ||
      normalizedMessage.includes("in cosa consiste") ||
      normalizedMessage.includes("cos'e") ||
      normalizedMessage.includes("cos e");

    const asksAddress =
      normalizedMessage.includes("dove siete") ||
      normalizedMessage.includes("indirizzo") ||
      normalizedMessage.includes("dove vi trovate") ||
      normalizedMessage.includes("posizione");

    const asksPhone =
      normalizedMessage.includes("telefono") ||
      normalizedMessage.includes("numero") ||
      normalizedMessage.includes("contattare");

    const asksWhatsApp =
      normalizedMessage.includes("whatsapp");

    const asksOpeningHours =
      normalizedMessage.includes("orari") ||
      normalizedMessage.includes("aperto") ||
      normalizedMessage.includes("chiuso") ||
      normalizedMessage.includes("quando aprite") ||
      normalizedMessage.includes("quando siete aperti");

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
      normalizedMessage.includes("che ore hai");

    const looksLikeBooking =
      normalizedMessage.includes("prenot") ||
      normalizedMessage.includes("appuntament") ||
      normalizedMessage.includes("fissare") ||
      normalizedMessage.includes("prenota") ||
      normalizedMessage.includes("scelgo le") ||
      normalizedMessage.includes("scelgo");

    /*
    ============================================================
    CONFERMA
    ============================================================
    */

    const confirmationWords = [
      "si",
      "sì",
      "ok",
      "okay",
      "confermo",
      "conferma",
      "prenota",
      "prenotalo",
      "procedi",
      "va bene",
      "d'accordo",
      "daccordo"
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
      ) ||
      normalizedMessage.includes(
        "confermo l'appuntamento"
      ) ||
      normalizedMessage.includes(
        "conferma l'appuntamento"
      );

    const isCancellation =
      cancellationWords.includes(
        normalizedMessage
      );

    /*
    ============================================================
    CANCELLAZIONE CONFERMA
    ============================================================
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
    ============================================================
    CONFERMA APPUNTAMENTO
    ============================================================
    */

    if (
      pendingAppointment &&
      requiresConfirmation &&
      isConfirmation
    ) {

      const requested =
        pendingAppointment;

      const service =
        getService(
          requested.service ||
          requested.s
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
        getServiceDuration(service);

      /*
      Ricontrollo SEMPRE la disponibilità.
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

          availableSlots:
            alternatives
        });
      }

      /*
      IMPORTANTE:

      L'API restituisce la conferma.
      Il salvataggio effettivo dell'appuntamento
      resta responsabilità dell'index/app.
      */

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

    /*
    ============================================================
    PROMOZIONI LOCALI
    ============================================================
    */

    if (asksPromotion) {

      if (!hasPromotionData()) {

        return res.status(200).json({
          reply:
            "Al momento non risultano promozioni disponibili.",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false
        });
      }

      const text =
        promotions
          .map(getPromotionText)
          .filter(Boolean);

      return res.status(200).json({

        reply:
          text.length
            ? `Ecco le promozioni disponibili:\n\n${text.map(item => `• ${item}`).join("\n")}`
            : "Al momento non risultano promozioni disponibili.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /*
    ============================================================
    SERVIZIO SPECIFICO
    ============================================================
    */

    if (
      detectedService &&
      (
        asksPrice ||
        asksDescription ||
        normalizedMessage.includes(
          normalizeText(
            detectedService.name
          )
        )
      )
    ) {

      const text =
        serviceText(
          detectedService
        );

      return res.status(200).json({

        reply:
          text ||
          `Il servizio ${detectedService.name} è disponibile.`,

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /*
    ============================================================
    PREZZO GENERICO
    ============================================================
    */

    if (
      asksPrice &&
      services.length
    ) {

      const list =
        services
          .filter(Boolean)
          .map(service => {

            const price =
              cleanPrice(
                service.price
              );

            return price
              ? `• ${service.name}: €${price}`
              : `• ${service.name}: prezzo non specificato`;
          });

      return res.status(200).json({

        reply:
          `Ecco i prezzi disponibili:\n\n${list.join("\n")}`,

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /*
    ============================================================
    ELENCO SERVIZI
    ============================================================
    */

    if (
      asksServices &&
      services.length
    ) {

      const list =
        services
          .filter(Boolean)
          .map(service => {

            let line =
              `• ${service.name}`;

            if (
              service.category
            ) {
              line +=
                ` — ${service.category}`;
            }

            if (
              service.price !== undefined &&
              service.price !== null &&
              service.price !== ""
            ) {
              line +=
                ` — €${cleanPrice(service.price)}`;
            }

            if (
              service.duration
            ) {
              line +=
                ` — ${service.duration} min`;
            }

            return line;
          });

      return res.status(200).json({

        reply:
          `Questi sono i servizi disponibili:\n\n${list.join("\n")}`,

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /*
    ============================================================
    INDIRIZZO
    ============================================================
    */

    if (asksAddress) {

      const address =
        settings.address;

      return res.status(200).json({

        reply:
          address
            ? `Ci troviamo in ${address}.`
            : "L'indirizzo non è stato ancora inserito.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /*
    ============================================================
    TELEFONO
    ============================================================
    */

    if (asksPhone) {

      const phone =
        settings.phone;

      return res.status(200).json({

        reply:
          phone
            ? `Il numero di telefono è ${phone}.`
            : "Il numero di telefono non è stato ancora inserito.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /*
    ============================================================
    WHATSAPP
    ============================================================
    */

    if (asksWhatsApp) {

      const whatsapp =
        settings.whatsapp;

      return res.status(200).json({

        reply:
          whatsapp
            ? `Il numero WhatsApp è ${whatsapp}.`
            : "Il numero WhatsApp non è stato ancora inserito.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /*
    ============================================================
    ORARI DI APERTURA
    ============================================================
    */

    if (
      asksOpeningHours &&
      !asksAvailability
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

      const list = [];

      for (
        const [key, label]
        of Object.entries(labels)
      ) {

        const day =
          settings.hours?.[key];

        if (
          !day ||
          day.status === "closed"
        ) {
          list.push(
            `• ${label}: Chiuso`
          );

          continue;
        }

        let line =
          `• ${label}: ${day.open || "--"} - ${day.close || "--"}`;

        if (
          day.breakStart &&
          day.breakEnd
        ) {
          line +=
            ` (pausa ${day.breakStart}-${day.breakEnd})`;
        }

        list.push(line);
      }

      return res.status(200).json({

        reply:
          `Gli orari dell'attività sono:\n\n${list.join("\n")}`,

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /*
    ============================================================
    DISPONIBILITÀ
    ============================================================
    */

    if (asksAvailability) {

      const date =
        detectedDate ||
        addDays(today, 1);

      const service =
        detectedService;

      const duration =
        service
          ? getServiceDuration(service)
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

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false,

        availableSlots: slots
      });
    }

    /*
    ============================================================
    PRENOTAZIONE LOCALE
    ============================================================
    */

    if (
      looksLikeBooking &&
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

      /*
      SERVIZIO
      */

      if (!service) {

        return res.status(200).json({

          reply:
            "Quale servizio vuoi prenotare?",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false
        });
      }

      /*
      NOME
      */

      if (!name) {

        return res.status(200).json({

          reply:
            "Perfetto. Mi confermi il nome per la prenotazione?",

          appointment: null,

          pendingAppointment: {
            service: service.name,
            date,
            time,
            name: ""
          },

          requiresConfirmation: false,

          confirmed: false
        });
      }

      /*
      DATA
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
      ORA
      */

      if (!time) {

        return res.status(200).json({

          reply:
            `Perfetto. Mi manca solo l'orario preciso per ${italianDate(date)}.`,

          appointment: null,

          pendingAppointment: {
            name,
            service: service.name,
            date,
            time: ""
          },

          requiresConfirmation: false,

          confirmed: false
        });
      }

      const duration =
        getServiceDuration(service);

      /*
      GIORNO CHIUSO
      */

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
      NORMALIZZA ORA
      */

      const normalizedTimeMinutes =
        toMinutes(time);

      const normalizedTime =
        normalizedTimeMinutes !== null
          ? formatTime(
              normalizedTimeMinutes
            )
          : time;

      /*
      SLOT NON DISPONIBILE
      */

      if (
        !isSlotFree(
          date,
          normalizedTime,
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
              ? `L'orario ${normalizedTime} non è disponibile. Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
              : "Non ci sono altri slot disponibili quel giorno.",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false,

          availableSlots:
            alternatives
        });
      }

      /*
      SLOT DISPONIBILE.

      NON PRENOTIAMO ANCORA.
      */

      return res.status(200).json({

        reply:
          `Perfetto. Ho verificato la disponibilità per ${service.name} il ${italianDate(date)} alle ${normalizedTime}. Vuoi confermare l'appuntamento?`,

        appointment: null,

        pendingAppointment: {
          name,
          service: service.name,
          date,
          time: normalizedTime
        },

        requiresConfirmation: true,

        confirmed: false
      });
    }

    /*
    ============================================================
    RICHIESTA GENERICA SU UN SERVIZIO
    ============================================================
    */

    if (detectedService) {

      return res.status(200).json({

        reply:
          serviceText(
            detectedService
          ),

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /*
    ============================================================
    FALLBACK LOCALE
    ============================================================
    */

    /*
    Se abbiamo dati locali ma la domanda è generica,
    proviamo comunque a dare una risposta utile senza AI.
    */

    if (
      services.length &&
      (
        normalizedMessage.includes("cosa") ||
        normalizedMessage.includes("quali") ||
        normalizedMessage.includes("fate") ||
        normalizedMessage.includes("offrite")
      )
    ) {

      const list =
        services
          .filter(Boolean)
          .map(service =>
            `• ${service.name}`
          );

      return res.status(200).json({

        reply:
          `Posso aiutarti con questi servizi:\n\n${list.join("\n")}`,

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /*
    ============================================================
    OPENAI SOLO ORA
    ============================================================

    Tutto ciò che poteva essere risolto localmente
    è già stato gestito.

    Se arriviamo qui, la richiesta è realmente
    generica/complessa.
    */

    if (!process.env.OPENAI_API_KEY) {

      return res.status(200).json({

        reply:
          "Posso aiutarti con prenotazioni, servizi, prezzi, promozioni, orari e informazioni sull'attività. Dimmi cosa ti interessa.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

    /*
    ============================================================
    DATI ATTIVITÀ PER OPENAI
    ============================================================
    */

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
            `${label}: ${day.open || "--"} - ${day.close || "--"}`;

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
            .filter(Boolean)
            .map(service => {

              let text =
                `- ${service.name || "Servizio"}`;

              if (
                service.category
              ) {
                text +=
                  ` | Categoria: ${service.category}`;
              }

              if (
                service.description
              ) {
                text +=
                  ` | Descrizione: ${service.description}`;
              }

              if (
                service.advancedDescription
              ) {
                text +=
                  ` | Dettagli: ${service.advancedDescription}`;
              }

              if (
                service.descriptionAdvanced
              ) {
                text +=
                  ` | Dettagli: ${service.descriptionAdvanced}`;
              }

              if (
                service.price !== undefined &&
                service.price !== null &&
                service.price !== ""
              ) {
                text +=
                  ` | Prezzo: €${cleanPrice(service.price)}`;
              }

              if (
                service.duration
              ) {
                text +=
                  ` | Durata: ${service.duration} minuti`;
              }

              return text;

            })
            .join("\n")
        : "Nessun servizio inserito.";

    const promotionList =
      promotions.length
        ? promotions
            .map(getPromotionText)
            .filter(Boolean)
            .map(text => `- ${text}`)
            .join("\n")
        : "Nessuna promozione inserita.";

    /*
    ============================================================
    HISTORY SICURA
    ============================================================
    */

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
        .slice(-10);

    /*
    ============================================================
    OPENAI
    ============================================================
    */

    try {

      const client =
        new OpenAI({
          apiKey:
            process.env.OPENAI_API_KEY
        });

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

Questa è una modalità FALLBACK.

La gestione di:
- prenotazioni
- disponibilità
- orari
- servizi
- prezzi
- promozioni
- indirizzo
- telefono
- WhatsApp

è già stata gestita dal server tramite dati locali.

NON devi inventare dati.

NON devi modificare appuntamenti.

NON devi confermare prenotazioni.

NON devi inventare prezzi.

NON devi inventare promozioni.

NON devi inventare servizi.

Se non conosci una risposta, dichiaralo chiaramente.

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

PROMOZIONI:
${promotionList}

Nome cliente:
${clientName || "Non fornito"}

Data odierna:
${today}

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
              content: message
            }
          ]
        });

      /*
      ============================================================
      PARSING RISPOSTA AI
      ============================================================
      */

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
      SICUREZZA:

      OpenAI non può creare una prenotazione.
      */

      return res.status(200).json({

        reply:
          String(
            result.reply ||
            "Non ho ricevuto una risposta."
          ),

        appointment:
          null,

        pendingAppointment:
          null,

        requiresConfirmation:
          false,

        confirmed:
          false
      });

    } catch (aiError) {

      console.error(
        "OPENAI FALLBACK ERROR:",
        aiError
      );

      /*
      ============================================================
      LIMITE OPENAI / 429
      ============================================================
      */

      if (
        aiError?.status === 429 ||
        aiError?.message?.includes("429") ||
        aiError?.message
          ?.toLowerCase()
          ?.includes("rate limit")
      ) {

        return res.status(200).json({

          reply:
            "Posso aiutarti con servizi, prezzi, promozioni, orari e prenotazioni. Per questa richiesta più complessa l'assistente AI è momentaneamente occupato. Riprova tra poco.",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false,

          rateLimited: true
        });
      }

      /*
      Anche in caso di errore OpenAI,
      l'applicazione NON deve considerare
      la richiesta una prenotazione.
      */

      return res.status(200).json({

        reply:
          "Non riesco a elaborare questa richiesta in questo momento. Puoi chiedermi informazioni su servizi, prezzi, promozioni, orari o prenotazioni.",

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false
      });
    }

  } catch (error) {

    console.error(
      "CHAT API ERROR:",
      error
    );

    return res.status(500).json({

      error:
        error?.message ||
        "Errore durante la richiesta."
    });
  }
}
