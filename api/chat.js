import OpenAI from "openai";

/*
 * MAVIRI /api/chat.js
 * API compatibile con l'attuale index.html.
 *
 * Responsabilità:
 * - chat Mavi
 * - disponibilità
 * - flusso prenotazione con conferma esplicita
 * - controllo finale anti-doppia prenotazione
 * - generazione Post AI
 * - normalizzazione dati provenienti dall'index
 *
 * Nota architetturale:
 * l'API NON salva gli appuntamenti nel localStorage.
 * Alla conferma restituisce `appointment`; l'index lo salva
 * tramite il proprio doppio salvataggio.
 */

const LOCK_TTL = 15000;
const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";
const MAX_MESSAGE = 4000;
const MAX_HISTORY = 12;
const MAX_ARRAY_ITEMS = 500;

const bookingLocks =
  globalThis.__maviriBookingLocks ||
  new Map();

globalThis.__maviriBookingLocks = bookingLocks;


/* ============================================================
   HANDLER
============================================================ */

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Metodo non consentito"
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      ok: false,
      error:
        "OPENAI_API_KEY non disponibile nel deployment Vercel"
    });
  }

  try {

    const body =
      req.body &&
      typeof req.body === "object"
        ? req.body
        : {};


    const action =
      clean(body.action);

    const message =
      clean(body.message)
        .slice(0, MAX_MESSAGE);

    const topic =
      clean(body.topic)
        .slice(0, MAX_MESSAGE);

    const business =
      clean(body.business)
        .slice(0, 1000);

    const clientName =
      clean(body.clientName)
        .slice(0, 200);


    const settings =
      body.settings &&
      typeof body.settings === "object"
        ? body.settings
        : {};


    const services =
      limitArray(body.services);

    const promotions =
      limitArray(body.promotions);

    const appointments =
      limitArray(body.appointments);

    const clients =
      limitArray(body.clients);

    const history =
      limitArray(
        body.history,
        MAX_HISTORY
      );


    const pendingAppointment =
      body.pendingAppointment &&
      typeof body.pendingAppointment === "object"
        ? body.pendingAppointment
        : null;


    const requiresConfirmation =
      body.requiresConfirmation === true;


    const openai =
      new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY
      });


    /* ========================================================
       BASE
    ======================================================== */

    function clean(value) {

      return String(
        value ?? ""
      ).trim();

    }


    function norm(value) {

      return clean(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(
          /[\u0300-\u036f]/g,
          ""
        )
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    }


    function limitArray(
      value,
      max = MAX_ARRAY_ITEMS
    ) {

      return Array.isArray(value)
        ? value.slice(0, max)
        : [];

    }


    function safeText(
      value,
      max = 1000
    ) {

      return clean(value)
        .slice(0, max);

    }


    function toMinutes(value) {

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return null;
      }


      let s =
        clean(value)
          .toLowerCase()
          .replace(
            /[.,]/g,
            ":"
          )
          .replace(
            /\s+/g,
            ""
          );


      if (
        /^\d{1,2}$/.test(s)
      ) {
        s += ":00";
      }


      const match =
        s.match(
          /^(\d{1,2}):(\d{2})$/
        );


      if (!match) {
        return null;
      }


      const h =
        Number(match[1]);

      const m =
        Number(match[2]);


      if (
        !Number.isInteger(h) ||
        !Number.isInteger(m) ||
        h < 0 ||
        h > 23 ||
        m < 0 ||
        m > 59
      ) {
        return null;
      }


      return (
        h * 60 +
        m
      );

    }


    function fmt(minutes) {

      if (
        !Number.isFinite(minutes) ||
        minutes < 0 ||
        minutes > 1439
      ) {
        return "";
      }


      return (
        String(
          Math.floor(
            minutes / 60
          )
        ).padStart(2, "0") +
        ":" +
        String(
          minutes % 60
        ).padStart(2, "0")
      );

    }


    function isValidDate(value) {

      const date =
        clean(value);


      if (
        !/^\d{4}-\d{2}-\d{2}$/
          .test(date)
      ) {
        return false;
      }


      const [
        year,
        month,
        day
      ] =
        date
          .split("-")
          .map(Number);


      const d =
        new Date(
          year,
          month - 1,
          day,
          12,
          0,
          0
        );


      return (
        d.getFullYear() === year &&
        d.getMonth() === month - 1 &&
        d.getDate() === day
      );

    }


    function addDays(
      date,
      amount
    ) {

      if (
        !isValidDate(date)
      ) {
        return "";
      }


      const d =
        new Date(
          `${date}T12:00:00`
        );


      d.setDate(
        d.getDate() +
        amount
      );


      return [
        d.getFullYear(),
        String(
          d.getMonth() + 1
        ).padStart(2, "0"),
        String(
          d.getDate()
        ).padStart(2, "0")
      ].join("-");

    }


    function getTodayRome() {

      const parts =
        new Intl.DateTimeFormat(
          "en-CA",
          {
            timeZone:
              "Europe/Rome",
            year:
              "numeric",
            month:
              "2-digit",
            day:
              "2-digit"
          }
        ).formatToParts(
          new Date()
        );


      const map = {};


      for (
        const part of parts
      ) {

        if (
          part.type !==
          "literal"
        ) {

          map[
            part.type
          ] =
            part.value;

        }

      }


      return (
        `${map.year}-${map.month}-${map.day}`
      );

    }


    const today =
      getTodayRome();


    function italianDate(date) {

      if (
        !isValidDate(date)
      ) {
        return clean(date);
      }


      return new Date(
        `${date}T12:00:00`
      ).toLocaleDateString(
        "it-IT",
        {
          weekday:
            "long",
          day:
            "numeric",
          month:
            "long"
        }
      );

    }


    function getDayName(date) {

      if (
        !isValidDate(date)
      ) {
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
      ][
        new Date(
          `${date}T12:00:00`
        ).getDay()
      ];

    }


    function getHourConfig(date) {

      const key =
        getDayName(date);


      if (!key) {
        return null;
      }


      const hours =
        settings?.hours;


      if (
        !hours ||
        typeof hours !==
          "object"
      ) {
        return null;
      }


      const day =
        hours[key];


      if (
        !day ||
        typeof day !==
          "object"
      ) {
        return null;
      }


      const closed =
        day.closed === true ||
        day.status === "closed" ||
        day.open === false;


      const open =
        clean(
          day.open ||
          day.start ||
          ""
        );


      const close =
        clean(
          day.close ||
          day.end ||
          ""
        );


      const breakStart =
        clean(
          day.breakStart ||
          day.pauseStart ||
          day.break_start ||
          ""
        );


      const breakEnd =
        clean(
          day.breakEnd ||
          day.pauseEnd ||
          day.break_end ||
          ""
        );


      return {
        ...day,
        closed,
        open,
        close,
        breakStart,
        breakEnd
      };

    }


    /* ========================================================
       SAFE DATA
    ======================================================== */

    const safeServices =
      services.filter(
        service =>
          service &&
          typeof service ===
            "object" &&
          clean(service.name)
      );


    const safePromotions =
      promotions.filter(
        promotion =>
          promotion &&
          typeof promotion ===
            "object"
      );


    const safeAppointments =
      appointments.filter(
        appointment =>
          appointment &&
          typeof appointment ===
            "object"
      );


    const safeClients =
      clients.filter(
        client =>
          client &&
          typeof client ===
            "object"
      );


    /* ========================================================
       SERVICES
    ======================================================== */

    function serviceDuration(
      service
    ) {

      const duration =
        Number(
          service?.duration
        );


      return (
        Number.isFinite(
          duration
        ) &&
        duration > 0
      )
        ? Math.min(
            Math.round(duration),
            24 * 60
          )
        : 30;

    }


    function getService(
      name
    ) {

      const target =
        norm(name);


      if (!target) {
        return null;
      }


      return (
        safeServices.find(
          service =>
            norm(
              service.name
            ) === target
        ) ||
        null
      );

    }


    function findService(
      text
    ) {

      const n =
        norm(text);


      if (!n) {
        return null;
      }


      const exact =
        safeServices.find(
          service =>
            n.includes(
              norm(
                service.name
              )
            )
        );


      if (exact) {
        return exact;
      }


      return (
        safeServices.find(
          service => {

            const words =
              norm(
                service.name
              )
                .split(/\s+/)
                .filter(Boolean);


            return (
              words.length > 0 &&
              words.every(
                word =>
                  n.includes(word)
              )
            );

          }
        ) ||
        null
      );

    }


    /* ========================================================
       APPOINTMENTS
    ======================================================== */

    function appointmentDate(
      appointment
    ) {

      return clean(
        appointment?.date ||
        appointment?.d ||
        ""
      );

    }


    function appointmentTime(
      appointment
    ) {

      return clean(
        appointment?.time ||
        appointment?.t ||
        ""
      );

    }


    function appointmentService(
      appointment
    ) {

      return clean(
        appointment?.service ||
        appointment?.s ||
        ""
      );

    }


    function appointmentName(
      appointment
    ) {

      return clean(
        appointment?.name ||
        appointment?.n ||
        ""
      );

    }


    function appointmentId(
      appointment
    ) {

      return clean(
        appointment?.id ||
        appointment?.bookingKey ||
        ""
      );

    }


    function appointmentStatus(
      appointment
    ) {

      return norm(
        appointment?.status ||
        appointment?.stato ||
        "confermato"
      );

    }


    function isCancelledAppointment(
      appointment
    ) {

      const status =
        appointmentStatus(
          appointment
        );


      return [
        "cancellato",
        "cancellata",
        "cancelled",
        "canceled",
        "annullato",
        "annullata"
      ].includes(
        status
      );

    }


    function isActiveAppointment(
      appointment
    ) {

      return !isCancelledAppointment(
        appointment
      );

    }


    function appointmentDuration(
      appointment
    ) {

      const explicit =
        Number(
          appointment?.duration
        );


      if (
        Number.isFinite(
          explicit
        ) &&
        explicit > 0
      ) {

        return Math.min(
          Math.round(explicit),
          24 * 60
        );

      }


      const service =
        getService(
          appointmentService(
            appointment
          )
        );


      return serviceDuration(
        service
      );

    }


    /* ========================================================
       HOURS / BREAKS
    ======================================================== */

    function breakOverlap(
      start,
      end,
      day
    ) {

      const breakStart =
        toMinutes(
          day?.breakStart
        );


      const breakEnd =
        toMinutes(
          day?.breakEnd
        );


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


    function free(
      date,
      time,
      duration,
      ignoreId = ""
    ) {

      if (
        !isValidDate(date)
      ) {
        return false;
      }


      const day =
        getHourConfig(date);


      if (
        !day ||
        day.closed
      ) {
        return false;
      }


      const opening =
        toMinutes(
          day.open
        );


      const closing =
        toMinutes(
          day.close
        );


      const start =
        toMinutes(
          time
        );


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
        opening >= closing ||
        start < opening ||
        end > closing
      ) {
        return false;
      }


      if (
        breakOverlap(
          start,
          end,
          day
        )
      ) {
        return false;
      }


      return !safeAppointments.some(
        appointment => {

          if (
            !isActiveAppointment(
              appointment
            )
          ) {
            return false;
          }


          if (
            ignoreId &&
            appointmentId(
              appointment
            ) &&
            String(
              appointmentId(
                appointment
              )
            ) ===
            String(ignoreId)
          ) {
            return false;
          }


          if (
            appointmentDate(
              appointment
            ) !== date
          ) {
            return false;
          }


          const existingStart =
            toMinutes(
              appointmentTime(
                appointment
              )
            );


          if (
            existingStart === null
          ) {
            return false;
          }


          const existingEnd =
            existingStart +
            appointmentDuration(
              appointment
            );


          return (
            start < existingEnd &&
            end > existingStart
          );

        }
      );

    }


    function available(
      date,
      duration,
      startAfter = null,
      endBefore = null
    ) {

      const day =
        getHourConfig(date);


      if (
        !day ||
        day.closed
      ) {
        return [];
      }


      const opening =
        toMinutes(
          day.open
        );


      const closing =
        toMinutes(
          day.close
        );


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
          : Math.max(
              opening,
              startAfter
            );


      let last =
        endBefore === null
          ? closing
          : Math.min(
              closing,
              endBefore
            );


      if (
        first > last
      ) {
        return [];
      }


      first =
        Math.ceil(
          first / 30
        ) * 30;


      const result = [];


      for (
        let start = first;
        start + duration <= last;
        start += 30
      ) {

        if (
          free(
            date,
            fmt(start),
            duration
          )
        ) {

          result.push(
            fmt(start)
          );

        }

      }


      return result;

    }


    /* ========================================================
       DATE DETECTION
    ======================================================== */

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


    function detectDate(
      text
    ) {

      const n =
        norm(text);


      if (!n) {
        return null;
      }


      if (
        /\bdopodomani\b/
          .test(n)
      ) {

        return addDays(
          today,
          2
        );

      }


      if (
        /\bdomani\b/
          .test(n)
      ) {

        return addDays(
          today,
          1
        );

      }


      if (
        /\boggi\b/
          .test(n)
      ) {

        return today;

      }


      const iso =
        n.match(
          /\b(20\d{2}-\d{1,2}-\d{1,2})\b/
        );


      if (iso) {

        const parts =
          iso[1]
            .split("-");


        const result =
          `${parts[0]}-${String(Number(parts[1])).padStart(2,"0")}-${String(Number(parts[2])).padStart(2,"0")}`;


        if (
          isValidDate(result)
        ) {

          return result;

        }

      }


      const numeric =
        n.match(
          /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b/
        );


      if (numeric) {

        const day =
          Number(
            numeric[1]
          );


        const month =
          Number(
            numeric[2]
          );


        let year =
          Number(
            numeric[3] ||
            today.slice(0,4)
          );


        let result =
          `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;


        if (
          !isValidDate(result)
        ) {
          return null;
        }


        /*
         * Data senza anno già trascorsa:
         * considera l'anno successivo.
         */

        if (
          !numeric[3] &&
          result < today
        ) {

          year += 1;


          result =
            `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;

        }


        return isValidDate(
          result
        )
          ? result
          : null;

      }


      const current =
        new Date(
          `${today}T12:00:00`
        ).getDay();


      for (
        const [
          name,
          target
        ]
        of Object.entries(
          weekdays
        )
      ) {

        const pattern =
          new RegExp(
            `\\b${name.replace(
              /[.*+?^${}()|[\]\\]/g,
              "\\$&"
            )}\\b`
          );


        if (
          pattern.test(n)
        ) {

          let diff =
            target -
            current;


          if (
            diff <= 0
          ) {
            diff += 7;
          }


          return addDays(
            today,
            diff
          );

        }

      }


      return null;

    }


    /* ========================================================
       TIME DETECTION
       Correzioni:
       - 9
       - 09
       - 9:30
       - 9.30
       - 9 e 30
       - 9 e mezza
       - alle 9
       - non interpreta 29/08 come 08:00
    ======================================================== */

    function detectTime(
      text
    ) {

      const raw =
        clean(text);


      if (!raw) {
        return null;
      }


      const n =
        norm(raw);


      let withoutDates =
        n
          .replace(
            /\b20\d{2}[-\/]\d{1,2}[-\/]\d{1,2}\b/g,
            " "
          )
          .replace(
            /\b\d{1,2}[-\/]\d{1,2}(?:[-\/]20\d{2})?\b/g,
            " "
          );


      /*
       * 9 e mezza
       */

      let match =
        withoutDates.match(
          /\b(?:alle|ore|verso|per le)?\s*(2[0-3]|[01]?\d)\s*(?:e|ed)\s*mezz(?:a|o)\b/
        );


      if (match) {

        return fmt(
          Number(match[1]) *
            60 +
          30
        );

      }


      /*
       * 9 e 30
       */

      match =
        withoutDates.match(
          /\b(?:alle|ore|verso|per le)?\s*(2[0-3]|[01]?\d)\s*(?:e|ed)\s*([0-5]\d)\b/
        );


      if (match) {

        return fmt(
          Number(match[1]) *
            60 +
          Number(match[2])
        );

      }


      /*
       * 9:30 / 9.30
       */

      match =
        withoutDates.match(
          /\b(?:alle|ore|verso|per le)?\s*(2[0-3]|[01]?\d)\s*[:.,]\s*([0-5]\d)\b/
        );


      if (match) {

        return fmt(
          Number(match[1]) *
            60 +
          Number(match[2])
        );

      }


      /*
       * alle 9 / ore 9
       */

      match =
        withoutDates.match(
          /\b(?:alle|ore|verso|per le)\s*(2[0-3]|[01]?\d)\b/
        );


      if (match) {

        return fmt(
          Number(match[1]) *
            60
        );

      }


      /*
       * Numero isolato.
       *
       * Usato soprattutto quando l'utente risponde
       * ad una lista di slot:
       *
       * "9"
       * "15"
       *
       * Non viene più estratto dalle date.
       */

      const standaloneMatches =
        [
          ...withoutDates.matchAll(
            /\b(2[0-3]|[01]?\d)\b/g
          )
        ];


      if (
        standaloneMatches.length === 1
      ) {

        const hour =
          Number(
            standaloneMatches[0][1]
          );


        if (
          hour >= 0 &&
          hour <= 23
        ) {

          return fmt(
            hour * 60
          );

        }

      }


      return null;

    }


    /* ========================================================
       PROMOTIONS
    ======================================================== */

    function promotionStart(
      promotion
    ) {

      return clean(
        promotion?.start ||
        promotion?.from ||
        ""
      );

    }


    function promotionEnd(
      promotion
    ) {

      return clean(
        promotion?.end ||
        promotion?.expiry ||
        promotion?.to ||
        ""
      );

    }


    function isPromotionActive(
      promotion
    ) {

      const start =
        promotionStart(
          promotion
        );


      const end =
        promotionEnd(
          promotion
        );


      if (
        start &&
        isValidDate(start) &&
        start > today
      ) {
        return false;
      }


      if (
        end &&
        isValidDate(end) &&
        end < today
      ) {
        return false;
      }


      return true;

    }


    const validPromotions =
      safePromotions.filter(
        isPromotionActive
      );


    function promotionText() {

      if (
        !validPromotions.length
      ) {

        return "Nessuna promozione attiva.";

      }


      return validPromotions
        .map(
          promotion => {

            const title =
              safeText(
                promotion.title,
                200
              );


            const category =
              safeText(
                promotion.category,
                200
              );


            const description =
              safeText(
                promotion.description,
                500
              );


            const price =
              promotion.price !==
                undefined &&
              promotion.price !==
                null &&
              clean(
                promotion.price
              ) !== ""
                ? `€${clean(
                    promotion.price
                  )}`
                : "";


            const start =
              promotionStart(
                promotion
              );


            const end =
              promotionEnd(
                promotion
              );


            const validity =
              start || end
                ? `validità: ${start || "immediata"}${end ? ` - ${end}` : ""}`
                : "";


            return [
              title
                ? `- ${title}`
                : "",

              category
                ? `categoria: ${category}`
                : "",

              description
                ? `descrizione: ${description}`
                : "",

              price
                ? `prezzo: ${price}`
                : "",

              validity

            ]
              .filter(Boolean)
              .join(" | ");

          }
        )
        .join("\n");

    }


    const promotionList =
      promotionText();


    /* ========================================================
       PENDING
    ======================================================== */

    function normalizePending(
      value
    ) {

      if (
        !value ||
        typeof value !==
          "object"
      ) {

        return null;

      }


      const date =
        clean(
          value.date ||
          value.d ||
          ""
        );


      const time =
        clean(
          value.time ||
          value.t ||
          ""
        );


      const service =
        clean(
          value.service ||
          value.s ||
          ""
        );


      const name =
        clean(
          value.name ||
          value.n ||
          clientName ||
          ""
        );


      const minutes =
        toMinutes(
          time
        );


      return {

        ...value,

        name,

        date:
          isValidDate(date)
            ? date
            : "",

        time:
          minutes !== null
            ? fmt(minutes)
            : "",

        service

      };

    }


    let pending =
      normalizePending(
        pendingAppointment
      );


    /* ========================================================
       LOCK
    ======================================================== */

    function cleanupLocks() {

      const now =
        Date.now();


      for (
        const [
          key,
          lock
        ]
        of bookingLocks.entries()
      ) {

        if (
          !lock ||
          now -
            Number(
              lock.createdAt ||
              0
            ) >
            LOCK_TTL
        ) {

          bookingLocks.delete(
            key
          );

        }

      }

    }


    function bookingKey(
      date,
      time,
      service
    ) {

      return (
        `${date}|${time}|${norm(service)}`
      );

    }


    function acquireLock(
      key
    ) {

      cleanupLocks();


      if (
        bookingLocks.has(key)
      ) {

        return false;

      }


      bookingLocks.set(
        key,
        {
          createdAt:
            Date.now()
        }
      );


      return true;

    }


    function releaseLock(
      key
    ) {

      bookingLocks.delete(
        key
      );

    }


    /* ========================================================
       APPOINTMENT VALIDATION
    ======================================================== */

    function checkAppointment(
      appointment
    ) {

      if (
        !appointment ||
        typeof appointment !==
          "object"
      ) {

        return {

          ok:false,

          error:
            "Dati appuntamento mancanti."

        };

      }


      const date =
        clean(
          appointment.date
        );


      const rawTime =
        clean(
          appointment.time
        );


      const timeMinutes =
        toMinutes(
          rawTime
        );


      const time =
        timeMinutes === null
          ? ""
          : fmt(
              timeMinutes
            );


      const service =
        getService(
          appointment.service
        );


      if (
        !isValidDate(date)
      ) {

        return {

          ok:false,

          error:
            "Data dell'appuntamento mancante o non valida."

        };

      }


      if (!time) {

        return {

          ok:false,

          error:
            "Orario dell'appuntamento mancante o non valido."

        };

      }


      if (!service) {

        return {

          ok:false,

          error:
            "Servizio non trovato."

        };

      }


      const duration =
        serviceDuration(
          service
        );


      if (
        !free(
          date,
          time,
          duration
        )
      ) {

        return {

          ok:false,

          error:
            `L'orario ${time} del ${italianDate(date)} non è disponibile.`

        };

      }


      return {

        ok:true,

        date,

        time,

        service,

        duration

      };

    }


    function findSlots(
      date,
      serviceName
    ) {

      const service =
        getService(
          serviceName
        );


      if (
        !service ||
        !isValidDate(date)
      ) {

        return [];

      }


      return available(
        date,
        serviceDuration(
          service
        )
      );

    }


    /* ========================================================
       INTENT
    ======================================================== */

    function hasBookingIntent(
      text
    ) {

      const n =
        norm(text);


      return /prenot|appunt|fissare|fissa|riserv|disponibil|orario|slot|posto/
        .test(n);

    }


    function hasConfirmationIntent(
      text
    ) {

      const n =
        norm(text);


      return (
        /^(si|ok|va bene|procedi|prenota|confermo|conferma|esatto|corretto|giusto|andiamo|facciamolo)([.! ]|$)/
          .test(n) ||

        /\b(si|ok|va bene|procedi|prenota|confermo|conferma|esatto|corretto|giusto)\b/
          .test(n)
      );

    }


    function hasCancellationIntent(
      text
    ) {

      const n =
        norm(text);


      return /\b(annulla|annullare|cancella|cancellare|lascia stare|non prenotare|non voglio piu)\b/
        .test(n);

    }


    /* ========================================================
       RESPONSE HELPERS
    ======================================================== */

    function response(
      data = {}
    ) {

      return res.status(200).json({

        ok:true,

        bookingConfirmed:false,

        confirmed:false,

        requiresConfirmation:false,

        ...data

      });

    }


    function errorResponse(
      messageText,
      status = 200,
      extra = {}
    ) {

      return res.status(status).json({

        ok:false,

        bookingConfirmed:false,

        confirmed:false,

        requiresConfirmation:false,

        error:
          messageText,

        ...extra

      });

    }


    /* ========================================================
       POST AI
    ======================================================== */

    if (
      action === "post"
    ) {

      const selectedContent =
        body.selectedContent &&
        typeof body.selectedContent ===
          "object"
          ? body.selectedContent
          : null;


      const contentType =
        safeText(
          body.contentType ||
          "generico",
          100
        );


      const platform =
        safeText(
          body.platform ||
          "generic",
          100
        );


      const platformLabel =
        safeText(
          body.platformLabel ||
          platform,
          100
        );


      const contentTypeLabel =
        safeText(
          body.contentTypeLabel ||
          contentType,
          100
        );


      const style =
        safeText(
          body.style ||
          "professionale",
          200
        );


      const goal =
        safeText(
          body.goal,
          500
        );


      const audience =
        safeText(
          body.audience,
          500
        );


      const callToAction =
        safeText(
          body.callToAction,
          500
        );


      const customMessage =
        safeText(
          body.customMessage,
          1000
        );


      const advanced =
        body.advanced === true;


      const postPrompt = `

Sei Mavi, assistente AI di marketing
di un'attività locale italiana.

ATTIVITÀ:
${business || settings?.name || "Attività locale"}

PIATTAFORMA:
${platformLabel}

TIPO:
${contentTypeLabel}

STILE:
${style}

OBIETTIVO:
${goal}

PUBBLICO:
${audience}

CALL TO ACTION:
${callToAction}

ISTRUZIONI AGGIUNTIVE:
${customMessage}

ARGOMENTO:
${topic}

CONTENUTO SELEZIONATO:
${JSON.stringify(
  selectedContent || {},
  null,
  2
)}

SERVIZI:
${JSON.stringify(
  safeServices,
  null,
  2
)}

PROMOZIONI ATTIVE:
${promotionList}

REGOLE:
- Scrivi esclusivamente in italiano.
- Non inventare prezzi.
- Non inventare servizi.
- Non inventare promozioni.
- Non inventare dati dell'attività.
- Usa soltanto le informazioni disponibili.
- Adatta il contenuto alla piattaforma.
- Non iniziare con "Ecco il post".
- Restituisci testo immediatamente utilizzabile.
- Usa hashtag pertinenti quando appropriato.
`;


      const completion =
        await openai.chat.completions.create({

          model:
            MODEL,

          messages:[
            {
              role:
                "system",

              content:
                postPrompt
            },

            {
              role:
                "user",

              content:
                topic ||
                "Crea un contenuto per l'attività."
            }
          ]

        });


      const reply =
        completion
          ?.choices?.[0]
          ?.message
          ?.content
          ?.trim() ||
        "";


      if (!reply) {

        return errorResponse(
          "L'AI non ha restituito alcun contenuto.",
          500
        );

      }


      return response({

        reply,

        post:
          reply,

        meta:{
          platform,
          contentType,
          advanced
        }

      });

    }


    /* ========================================================
       AVAILABILITY
    ======================================================== */

    if (
      action ===
      "availability"
    ) {

      const dateRaw =
        clean(
          body.date
        ) ||
        detectDate(
          message
        );


      const date =
        isValidDate(
          dateRaw
        )
          ? dateRaw
          : null;


      const serviceName =
        clean(
          body.service ||
          body.serviceName ||
          findService(message)?.name ||
          ""
        );


      if (!date) {

        return response({

          available:false,

          availableSlots:[],

          reply:
            "Per verificare la disponibilità indicami il giorno."

        });

      }


      if (!serviceName) {

        return response({

          available:false,

          availableSlots:[],

          availableDate:
            date,

          reply:
            "Per verificare la disponibilità indicami anche il servizio."

        });

      }


      const service =
        getService(
          serviceName
        );


      if (!service) {

        return response({

          available:false,

          availableSlots:[],

          availableDate:
            date,

          availableService:
            serviceName,

          reply:
            "Non trovo questo servizio tra quelli configurati."

        });

      }


      const slots =
        findSlots(
          date,
          service.name
        );


      return response({

        available:
          slots.length > 0,

        date,

        service:
          service.name,

        slots,

        availableSlots:
          slots,

        availableDate:
          date,

        availableService:
          service.name,

        reply:
          slots.length

            ? `Per ${service.name}, ${italianDate(date)}, sono disponibili: ${slots.join(", ")}.`

            : `Non risultano orari disponibili per ${service.name} ${italianDate(date)}.`

      });

    }


    /* ========================================================
       DETECTION
    ======================================================== */

    const detectedDate =
      detectDate(
        message
      );


    const detectedTime =
      detectTime(
        message
      );


    const detectedService =
      findService(
        message
      );


    const bookingIntent =
      hasBookingIntent(
        message
      );


    const cancelIntent =
      hasCancellationIntent(
        message
      );


    /* ========================================================
       CANCELLA PENDING
    ======================================================== */

    if (
      cancelIntent &&
      pending
    ) {

      return response({

        pendingAppointment:
          null,

        cancelled:
          true,

        requiresConfirmation:
          false,

        reply:
          "Va bene, ho annullato la prenotazione in corso."

      });

    }


    /* ========================================================
       PENDING:
       UTENTE FORNISCE ORARIO
    ======================================================== */

    if (
      pending &&
      pending.date &&
      pending.service &&
      !pending.time &&
      detectedTime
    ) {

      const service =
        getService(
          pending.service
        );


      if (!service) {

        return response({

          requiresConfirmation:
            false,

          pendingAppointment:
            null,

          reply:
            "Il servizio della prenotazione non è più disponibile."

        });

      }


      const selectedTime =
        detectedTime;


      const duration =
        serviceDuration(
          service
        );


      if (
        !free(
          pending.date,
          selectedTime,
          duration
        )
      ) {

        const slots =
          findSlots(
            pending.date,
            service.name
          );


        return response({

          available:false,

          availableSlots:
            slots,

          availableDate:
            pending.date,

          availableService:
            service.name,

          pendingAppointment:{
            name:
              pending.name ||
              clientName ||
              "",

            date:
              pending.date,

            time:"",

            service:
              service.name
          },

          reply:
            slots.length

              ? `L'orario ${selectedTime} non è disponibile. Posso proporti: ${slots.join(", ")}.`

              : `L'orario ${selectedTime} non è disponibile e non ci sono altri slot liberi.`

        });

      }


      const newPending = {

        name:
          pending.name ||
          clientName ||
          "",

        date:
          pending.date,

        time:
          selectedTime,

        service:
          service.name

      };


      return response({

        requiresConfirmation:
          true,

        pendingAppointment:
          newPending,

        reply:
          `Ho verificato la disponibilità. ${service.name} è disponibile ${italianDate(pending.date)} alle ${selectedTime}. Confermi la prenotazione?`

      });

    }


    /* ========================================================
       PENDING:
       UTENTE MODIFICA DATA
    ======================================================== */

    if (
      pending &&
      bookingIntent &&
      detectedDate &&
      !detectedTime
    ) {

      const serviceName =
        pending.service ||
        detectedService?.name ||
        "";


      if (serviceName) {

        const service =
          getService(
            serviceName
          );


        if (!service) {

          return response({

            reply:
              "Il servizio selezionato non è più disponibile."

          });

        }


        const slots =
          findSlots(
            detectedDate,
            service.name
          );


        const nextPending = {

          name:
            pending.name ||
            clientName ||
            "",

          date:
            detectedDate,

          time:"",

          service:
            service.name

        };


        return response({

          available:
            slots.length > 0,

          availableSlots:
            slots,

          availableDate:
            detectedDate,

          availableService:
            service.name,

          pendingAppointment:
            nextPending,

          reply:
            slots.length

              ? `Per ${service.name}, ${italianDate(detectedDate)}, sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`

              : `Non risultano disponibilità per ${service.name} ${italianDate(detectedDate)}.`

        });

      }

    }


    /* ========================================================
       CONFERMA FINALE
    ======================================================== */

    if (
      pending &&
      requiresConfirmation === true
    ) {

      const confirmIntent =
        hasConfirmationIntent(
          message
        );


      if (!confirmIntent) {

        return response({

          requiresConfirmation:
            true,

          pendingAppointment:
            pending,

          reply:
            `La prenotazione è pronta: ${pending.service}, ${italianDate(pending.date)} alle ${pending.time}. Confermi?`

        });

      }


      if (
        !pending.date ||
        !isValidDate(
          pending.date
        ) ||
        !pending.time ||
        toMinutes(
          pending.time
        ) === null ||
        !pending.service
      ) {

        return response({

          requiresConfirmation:
            true,

          pendingAppointment:
            pending,

          reply:
            "Manca ancora qualche dato per completare la prenotazione."

        });

      }


      const service =
        getService(
          pending.service
        );


      if (!service) {

        return response({

          requiresConfirmation:
            false,

          pendingAppointment:
            null,

          reply:
            "Il servizio selezionato non è più disponibile."

        });

      }


      const normalizedTime =
        fmt(
          toMinutes(
            pending.time
          )
        );


      const duration =
        serviceDuration(
          service
        );


      const key =
        bookingKey(
          pending.date,
          normalizedTime,
          service.name
        );


      if (
        !acquireLock(key)
      ) {

        return response({

          requiresConfirmation:
            false,

          pendingAppointment:
            null,

          reply:
            "Questo appuntamento è stato appena richiesto da un'altra operazione. Verifica gli orari disponibili."

        });

      }


      try {

        /*
         * RICONTROLLO FINALE
         */

        if (
          !free(
            pending.date,
            normalizedTime,
            duration
          )
        ) {

          const alternatives =
            available(
              pending.date,
              duration
            );


          return response({

            available:false,

            availableSlots:
              alternatives,

            availableDate:
              pending.date,

            availableService:
              service.name,

            pendingAppointment:
              null,

            reply:
              alternatives.length

                ? `L'orario ${normalizedTime} non è più disponibile. Per ${service.name} posso proporti: ${alternatives.join(", ")}.`

                : `L'orario ${normalizedTime} non è più disponibile e non risultano altri orari liberi per ${service.name}.`

          });

        }


        /*
         * CONTROLLO DUPLICATO
         */

        const duplicate =
          safeAppointments.some(
            appointment => {

              if (
                !isActiveAppointment(
                  appointment
                )
              ) {
                return false;
              }


              return (

                appointmentDate(
                  appointment
                ) ===
                pending.date &&

                toMinutes(
                  appointmentTime(
                    appointment
                  )
                ) ===
                toMinutes(
                  normalizedTime
                ) &&

                norm(
                  appointmentService(
                    appointment
                  )
                ) ===
                norm(
                  service.name
                )

              );

            }
          );


        if (duplicate) {

          return response({

            available:false,

            availableSlots:
              available(
                pending.date,
                duration
              ),

            availableDate:
              pending.date,

            availableService:
              service.name,

            pendingAppointment:
              null,

            reply:
              "Questo appuntamento risulta già occupato. Verifica gli orari disponibili."

          });

        }


        /*
         * RECORD COMPATIBILE CON INDEX
         */

        const appointment = {

          id:
            key,

          bookingKey:
            key,

          name:
            safeText(
              pending.name ||
              clientName ||
              "",
              200
            ),

          n:
            safeText(
              pending.name ||
              clientName ||
              "",
              200
            ),

          date:
            pending.date,

          d:
            pending.date,

          time:
            normalizedTime,

          t:
            normalizedTime,

          service:
            service.name,

          s:
            service.name,

          duration

        };


        return response({

          confirmed:
            true,

          bookingConfirmed:
            true,

          requiresConfirmation:
            false,

          appointment,

          pendingAppointment:
            null,

          reply:
            `Appuntamento confermato per ${appointment.name || "il cliente"} il ${italianDate(appointment.date)} alle ${appointment.time} per ${appointment.service}.`

        });


      } finally {

        releaseLock(
          key
        );

      }

    }


    /* ========================================================
       NUOVA RICHIESTA:
       SERVIZIO + DATA + ORARIO
    ======================================================== */

    if (
      bookingIntent &&
      detectedDate &&
      detectedTime &&
      detectedService
    ) {

      const duration =
        serviceDuration(
          detectedService
        );


      if (
        !free(
          detectedDate,
          detectedTime,
          duration
        )
      ) {

        const alternatives =
          available(
            detectedDate,
            duration
          );


        return response({

          available:false,

          availableSlots:
            alternatives,

          availableDate:
            detectedDate,

          availableService:
            detectedService.name,

          date:
            detectedDate,

          service:
            detectedService.name,

          requestedTime:
            detectedTime,

          alternatives,

          reply:
            alternatives.length

              ? `L'orario ${detectedTime} non è disponibile. Per ${detectedService.name} ${italianDate(detectedDate)} posso proporti: ${alternatives.join(", ")}.`

              : `L'orario ${detectedTime} non è disponibile e non risultano altri orari liberi per ${detectedService.name} ${italianDate(detectedDate)}.`

        });

      }


      const newPending = {

        name:
          clientName ||
          "",

        service:
          detectedService.name,

        date:
          detectedDate,

        time:
          detectedTime

      };


      return response({

        requiresConfirmation:
          true,

        pendingAppointment:
          newPending,

        reply:
          `Ho verificato la disponibilità. ${detectedService.name} è disponibile ${italianDate(detectedDate)} alle ${detectedTime}. Confermi la prenotazione?`

      });

    }


    /* ========================================================
       SERVIZIO + DATA
    ======================================================== */

    if (
      bookingIntent &&
      detectedDate &&
      detectedService &&
      !detectedTime
    ) {

      const slots =
        findSlots(
          detectedDate,
          detectedService.name
        );


      const newPending = {

        name:
          clientName ||
          "",

        service:
          detectedService.name,

        date:
          detectedDate,

        time:""

      };


      if (
        !slots.length
      ) {

        return response({

          available:false,

          availableSlots:[],

          availableDate:
            detectedDate,

          availableService:
            detectedService.name,

          pendingAppointment:
            newPending,

          reply:
            `Non risultano disponibilità per ${detectedService.name} ${italianDate(detectedDate)}.`

        });

      }


      return response({

        available:true,

        availableSlots:
          slots,

        availableDate:
          detectedDate,

        availableService:
          detectedService.name,

        pendingAppointment:
          newPending,

        reply:
          `Per ${detectedService.name} ${italianDate(detectedDate)} sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`

      });

    }


    /* ========================================================
       SERVIZIO SENZA DATA
    ======================================================== */

    if (
      bookingIntent &&
      detectedService &&
      !detectedDate
    ) {

      return response({

        reply:
          `Per ${detectedService.name} indicami il giorno che preferisci.`

      });

    }


    /* ========================================================
       DATA SENZA SERVIZIO
    ======================================================== */

    if (
      bookingIntent &&
      detectedDate &&
      !detectedService
    ) {

      const serviceNames =
        safeServices
          .map(
            service =>
              clean(
                service.name
              )
          )
          .filter(Boolean);


      return response({

        reply:
          serviceNames.length

            ? `Per quale servizio? Puoi scegliere tra: ${serviceNames.join(", ")}.`

            : "Non ci sono ancora servizi configurati."

      });

    }


    /* ========================================================
       GENERAL AI DATA
    ======================================================== */

    const clientText =
      safeClients.length

        ? safeClients
            .map(
              client => {

                const name =
                  safeText(
                    client.name,
                    200
                  );


                const phone =
                  safeText(
                    client.phone,
                    100
                  );


                const email =
                  safeText(
                    client.email,
                    200
                  );


                return [

                  `- ${name}`,

                  phone
                    ? `telefono: ${phone}`
                    : "",

                  email
                    ? `email: ${email}`
                    : ""

                ]
                  .filter(Boolean)
                  .join(" | ");

              }
            )
            .join("\n")

        : "Nessun cliente configurato.";


    const serviceText =
      safeServices.length

        ? safeServices
            .map(
              service => {

                const name =
                  safeText(
                    service.name,
                    200
                  );


                const duration =
                  serviceDuration(
                    service
                  );


                const price =
                  service.price !==
                    undefined &&
                  clean(
                    service.price
                  ) !== ""

                    ? `, €${safeText(
                        service.price,
                        50
                      )}`

                    : "";


                const description =
                  service.description

                    ? ` — ${safeText(
                        service.description,
                        500
                      )}`

                    : "";


                return (
                  `- ${name} (${duration} minuti${price}${description})`
                );

              }
            )
            .join("\n")

        : "Nessun servizio configurato.";


    const appointmentText =
      safeAppointments

        .filter(
          isActiveAppointment
        )

        .map(
          appointment => {

            return [

              appointmentDate(
                appointment
              ),

              appointmentTime(
                appointment
              ),

              appointmentName(
                appointment
              ),

              appointmentService(
                appointment
              )

            ]
              .filter(Boolean)
              .join(" | ");

          }
        )

        .filter(Boolean)

        .map(
          item =>
            `- ${item}`
        )

        .join("\n") ||

      "Nessun appuntamento.";


    const historyMessages =
      history

        .filter(
          item =>
            item &&
            (
              item.role === "user" ||
              item.role === "assistant"
            )
        )

        .slice(
          -MAX_HISTORY
        )

        .map(
          item => ({

            role:
              item.role,

            content:
              safeText(
                item.content ||
                item.message ||
                "",
                2000
              )

          })
        )

        .filter(
          item =>
            item.content
        );


    /* ========================================================
       SYSTEM PROMPT
    ======================================================== */

    const systemPrompt = `

Sei Mavi, l'assistente AI dell'attività locale.

ATTIVITÀ:
${business || settings?.name || "Attività locale"}

DATA ODIERNA:
${today}

ORARI:
${Object.entries({

  monday:
    "Lunedì",

  tuesday:
    "Martedì",

  wednesday:
    "Mercoledì",

  thursday:
    "Giovedì",

  friday:
    "Venerdì",

  saturday:
    "Sabato",

  sunday:
    "Domenica"

})
  .map(
    ([key,label]) => {

      const day =
        settings?.hours?.[key];


      if (!day) {

        return (
          `${label}: non configurato`
        );

      }


      const closed =
        day.closed === true ||
        day.status === "closed" ||
        day.open === false;


      if (closed) {

        return (
          `${label}: Chiuso`
        );

      }


      const open =
        clean(
          day.open ||
          day.start ||
          ""
        );


      const close =
        clean(
          day.close ||
          day.end ||
          ""
        );


      const breakStart =
        clean(
          day.breakStart ||
          day.pauseStart ||
          day.break_start ||
          ""
        );


      const breakEnd =
        clean(
          day.breakEnd ||
          day.pauseEnd ||
          day.break_end ||
          ""
        );


      const pause =
        breakStart &&
        breakEnd

          ? ` (pausa ${breakStart}-${breakEnd})`

          : "";


      return (
        `${label}: ${open} - ${close}${pause}`
      );

    }
  )
  .join("\n")}

SERVIZI:
${serviceText}

PROMOZIONI ATTIVE:
${promotionList}

APPUNTAMENTI ATTIVI:
${appointmentText}

CLIENTI:
${clientText}

REGOLE:

1. Rispondi sempre in italiano.

2. Usa esclusivamente i dati forniti.

3. Non inventare:
   - servizi
   - prezzi
   - promozioni
   - orari
   - disponibilità
   - appuntamenti
   - dati dei clienti.

4. Non dichiarare mai disponibile
   un orario senza verifica
   dell'applicazione.

5. Non dichiarare mai confermato
   un appuntamento senza conferma
   esplicita dell'utente e senza
   il controllo finale dell'applicazione.

6. Non dire di aver salvato,
   cancellato, modificato o spostato
   dati se l'operazione non è stata
   realmente eseguita.

7. Se una richiesta di prenotazione
   è incompleta, chiedi soltanto
   il dato mancante necessario.

8. "domani" =
   ${addDays(today,1)}

9. "dopodomani" =
   ${addDays(today,2)}

10. Un giorno della settimana indica
    il prossimo giorno futuro
    corrispondente.

11. Le promozioni scadute
    non sono attive.

12. Mantieni le risposte brevi,
    chiare e naturali.

`;


    /* ========================================================
       OPENAI
    ======================================================== */

    const completion =
      await openai.chat.completions.create({

        model:
          MODEL,

        messages:[

          {
            role:
              "system",

            content:
              systemPrompt
          },

          ...historyMessages,

          {
            role:
              "user",

            content:
              message ||
              topic ||
              "Ciao"
          }

        ]

      });


    const reply =
      completion
        ?.choices?.[0]
        ?.message
        ?.content
        ?.trim() ||

      "Non ho ricevuto una risposta dall'assistente.";


    /* ========================================================
       GENERAL RESPONSE
    ======================================================== */

    return response({

      reply

    });


  } catch (error) {

    console.error(
      "API /api/chat error:",
      error
    );


    return res.status(500).json({

      ok:false,

      bookingConfirmed:false,

      confirmed:false,

      requiresConfirmation:false,

      error:
        error?.message ||
        "Errore interno del server."

    });

  }

}
