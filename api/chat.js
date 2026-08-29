/* ============================================================
   MAVIRI — /api/chat.js
   MAVIRI CORE — VERSIONE COMPLETAMENTE INDIPENDENTE
   Nessuna dipendenza da OpenAI
   ============================================================ */

const LOCK_TTL = 15000;

const MAX_BODY_SIZE = 2_000_000;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_ITEM_LENGTH = 1500;

const MAX_SERVICES = 200;
const MAX_PROMOTIONS = 200;
const MAX_APPOINTMENTS = 3000;
const MAX_CLIENTS = 5000;

const DEFAULT_DURATION = 30;
const SLOT_STEP = 30;


/* ============================================================
   PROCESS LOCK
   ============================================================ */

const bookingLocks =
  globalThis.__maviriBookingLocks ||
  new Map();

globalThis.__maviriBookingLocks =
  bookingLocks;


/* ============================================================
   HANDLER
   ============================================================ */

export default async function handler(req, res) {

  if (req.method !== "POST") {

    res.setHeader("Allow", "POST");

    return res.status(405).json({
      ok: false,
      error: "Metodo non consentito."
    });
  }


  /* ==========================================================
     SECURITY HEADERS
     ========================================================== */

  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );

  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");


  /* ==========================================================
     CONTENT TYPE
     ========================================================== */

  const contentType =
    String(
      req.headers?.["content-type"] || ""
    ).toLowerCase();

  if (
    contentType &&
    !contentType.includes("application/json")
  ) {

    return res.status(415).json({
      ok: false,
      error:
        "Content-Type non supportato. È richiesto application/json."
    });
  }


  try {

    /* ========================================================
       HELPERS
       ======================================================== */

    const clean = value =>
      String(value ?? "")
        .replace(/\u0000/g, "")
        .trim();


    const limited = (
      value,
      max
    ) =>
      clean(value).slice(0, max);


    const norm = value =>
      clean(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();


    const isObject = value =>
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value);


    const safeArray = (
      value,
      max
    ) =>
      Array.isArray(value)
        ? value
            .filter(isObject)
            .slice(0, max)
        : [];


    const escapeText = value =>
      clean(value)
        .replace(/[<>]/g, "");


    /* ========================================================
       BODY
       ======================================================== */

    const body =
      isObject(req.body)
        ? req.body
        : {};


    let bodySize = 0;

    try {

      bodySize =
        JSON.stringify(body).length;

    } catch {

      bodySize =
        MAX_BODY_SIZE + 1;

    }


    if (
      bodySize > MAX_BODY_SIZE
    ) {

      return res.status(413).json({
        ok: false,
        error: "Richiesta troppo grande."
      });
    }


    /* ========================================================
       INPUT
       ======================================================== */

    const action =
      limited(
        body.action,
        50
      );

    const message =
      limited(
        body.message,
        MAX_MESSAGE_LENGTH
      );

    const topic =
      limited(
        body.topic,
        2000
      );

    const business =
      limited(
        body.business,
        1000
      );

    const clientName =
      limited(
        body.clientName,
        200
      );

    const settings =
      isObject(body.settings)
        ? body.settings
        : {};


    const services =
      safeArray(
        body.services,
        MAX_SERVICES
      );

    const promotions =
      safeArray(
        body.promotions,
        MAX_PROMOTIONS
      );

    const appointments =
      safeArray(
        body.appointments,
        MAX_APPOINTMENTS
      );

    const clients =
      safeArray(
        body.clients,
        MAX_CLIENTS
      );


    const history =
      Array.isArray(body.history)
        ? body.history
            .slice(-MAX_HISTORY_ITEMS)
        : [];


    const requiresConfirmation =
      body.requiresConfirmation === true;


    const pendingAppointment =
      isObject(
        body.pendingAppointment
      )
        ? body.pendingAppointment
        : null;


    /* ========================================================
       SAFE DATA
       ======================================================== */

    const safeServices =
      services.filter(
        service =>
          clean(service.name)
      );


    const safePromotions =
      promotions;


    const safeAppointments =
      appointments;


    const safeClients =
      clients;


    /* ========================================================
       DATE / TIME
       ======================================================== */

    const toMinutes = value => {

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
          .replace(/[.,]/g, ":");


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


      return h * 60 + m;
    };


    const fmt = minutes => {

      if (
        !Number.isFinite(minutes) ||
        minutes < 0 ||
        minutes > 1439
      ) {
        return "";
      }


      return (
        String(
          Math.floor(minutes / 60)
        ).padStart(2, "0") +
        ":" +
        String(
          minutes % 60
        ).padStart(2, "0")
      );
    };


    const isValidDate = date => {

      const value =
        clean(date);


      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value)
      ) {
        return false;
      }


      const [
        year,
        month,
        day
      ] =
        value
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
    };


    const addDays = (
      date,
      amount
    ) => {

      if (
        !isValidDate(date)
      ) {
        return "";
      }


      const d =
        new Date(
          date + "T12:00:00"
        );


      d.setDate(
        d.getDate() + amount
      );


      return (
        d.getFullYear() +
        "-" +
        String(
          d.getMonth() + 1
        ).padStart(2, "0") +
        "-" +
        String(
          d.getDate()
        ).padStart(2, "0")
      );
    };


    const getTodayRome = () => {

      const parts =
        new Intl.DateTimeFormat(
          "en-CA",
          {
            timeZone: "Europe/Rome",
            year: "numeric",
            month: "2-digit",
            day: "2-digit"
          }
        ).formatToParts(
          new Date()
        );


      const map = {};


      for (
        const part of parts
      ) {

        if (
          part.type !== "literal"
        ) {
          map[part.type] =
            part.value;
        }
      }


      return (
        `${map.year}-${map.month}-${map.day}`
      );
    };


    const today =
      getTodayRome();


    const italianDate = date => {

      if (
        !isValidDate(date)
      ) {
        return clean(date);
      }


      return new Date(
        date + "T12:00:00"
      ).toLocaleDateString(
        "it-IT",
        {
          weekday: "long",
          day: "numeric",
          month: "long"
        }
      );
    };


    /* ========================================================
       SERVICES
       ======================================================== */

    const getService = name => {

      const target =
        norm(name);


      if (!target) {
        return null;
      }


      return (
        safeServices.find(
          service =>
            norm(service.name) === target
        ) ||
        null
      );
    };


    const findService = text => {

      const n =
        norm(text);


      if (!n) {
        return null;
      }


      const exact =
        safeServices.find(
          service => {

            const name =
              norm(service.name);


            return (
              name &&
              (
                n.includes(name) ||
                name.includes(n)
              )
            );
          }
        );


      if (exact) {
        return exact;
      }


      const words =
        n
          .split(/\s+/)
          .filter(Boolean);


      let best = null;
      let bestScore = 0;


      for (
        const service
        of safeServices
      ) {

        const serviceWords =
          norm(service.name)
            .split(/\s+/)
            .filter(Boolean);


        if (
          !serviceWords.length
        ) {
          continue;
        }


        const score =
          serviceWords.filter(
            word =>
              words.includes(word)
          ).length;


        if (
          score > bestScore
        ) {

          bestScore =
            score;

          best =
            service;
        }
      }


      return best;
    };


    const serviceDuration =
      service => {

        const duration =
          Number(
            service?.duration
          );


        if (
          Number.isFinite(duration) &&
          duration > 0 &&
          duration <= 1440
        ) {
          return Math.round(duration);
        }


        return DEFAULT_DURATION;
      };


    /* ========================================================
       APPOINTMENT HELPERS
       ======================================================== */

    const appointmentDate =
      appointment =>
        clean(
          appointment?.date ||
          appointment?.d ||
          ""
        );


    const appointmentTime =
      appointment =>
        clean(
          appointment?.time ||
          appointment?.t ||
          ""
        );


    const appointmentService =
      appointment =>
        clean(
          appointment?.service ||
          appointment?.s ||
          ""
        );


    const appointmentName =
      appointment =>
        clean(
          appointment?.name ||
          appointment?.n ||
          ""
        );


    const appointmentId =
      appointment =>
        clean(
          appointment?.id ||
          appointment?.bookingKey ||
          ""
        );


    const appointmentStatus =
      appointment =>
        norm(
          appointment?.status ||
          "confermato"
        );


    const isActiveAppointment =
      appointment => {

        const status =
          appointmentStatus(
            appointment
          );


        return ![
          "cancellato",
          "cancelled",
          "canceled",
          "annullato",
          "deleted",
          "eliminato"
        ].includes(status);
      };


    const appointmentDuration =
      appointment => {

        const explicit =
          Number(
            appointment?.duration
          );


        if (
          Number.isFinite(explicit) &&
          explicit > 0 &&
          explicit <= 1440
        ) {
          return Math.round(explicit);
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
      };


    /* ========================================================
       DAY SETTINGS
       ======================================================== */

    const getDayName = date => {

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
          date + "T12:00:00"
        ).getDay()
      ];
    };


    const getDaySettings = date => {

      const dayName =
        getDayName(date);


      if (!dayName) {
        return null;
      }


      const hours =
        isObject(settings.hours)
          ? settings.hours
          : {};


      const day =
        isObject(hours[dayName])
          ? hours[dayName]
          : null;


      if (!day) {
        return null;
      }


      const closed =
        day.closed === true ||
        day.status === "closed" ||
        day.status === "chiuso" ||
        day.open === false;


      const open =
        clean(
          day.start ||
          day.open ||
          day.from ||
          ""
        );


      const close =
        clean(
          day.end ||
          day.close ||
          day.to ||
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
    };


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
      .map(
        ([key, label]) => {

          const day =
            isObject(
              settings?.hours?.[key]
            )
              ? settings.hours[key]
              : null;


          if (!day) {
            return `${label}: non configurato`;
          }


          const closed =
            day.closed === true ||
            day.status === "closed" ||
            day.status === "chiuso" ||
            day.open === false;


          if (closed) {
            return `${label}: Chiuso`;
          }


          const open =
            clean(
              day.start ||
              day.open ||
              ""
            );


          const close =
            clean(
              day.end ||
              day.close ||
              ""
            );


          const breakStart =
            clean(
              day.breakStart ||
              day.pauseStart ||
              ""
            );


          const breakEnd =
            clean(
              day.breakEnd ||
              day.pauseEnd ||
              ""
            );


          const pause =
            breakStart &&
            breakEnd
              ? ` (pausa ${breakStart}-${breakEnd})`
              : "";


          return (
            `${label}: ${open || "?"} - ${close || "?"}${pause}`
          );
        }
      )
      .join("\n");


    /* ========================================================
       BREAK
       ======================================================== */

    const breakOverlap =
      (
        start,
        end,
        day
      ) => {

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
          breakEnd <= breakStart
        ) {
          return false;
        }


        return (
          start < breakEnd &&
          end > breakStart
        );
      };


    /* ========================================================
       APPOINTMENT OVERLAP
       ======================================================== */

    const appointmentOverlaps =
      (
        date,
        start,
        end,
        ignoreId = ""
      ) => {

        return safeAppointments.some(
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
              ) === ignoreId
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


            const duration =
              appointmentDuration(
                appointment
              );


            const existingEnd =
              existingStart +
              duration;


            return (
              start < existingEnd &&
              end > existingStart
            );
          }
        );
      };


    /* ========================================================
       FREE SLOT
       ======================================================== */

    const free =
      (
        date,
        time,
        duration,
        ignoreId = ""
      ) => {

        if (
          !isValidDate(date)
        ) {
          return false;
        }


        const day =
          getDaySettings(date);


        if (
          !day ||
          day.closed
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
          dur <= 0 ||
          dur > 1440
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
          breakOverlap(
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
            end,
            ignoreId
          )
        ) {
          return false;
        }


        return true;
      };


    /* ========================================================
       AVAILABLE SLOTS
       ======================================================== */

    const available =
      (
        date,
        duration,
        startAfter = null,
        endBefore = null
      ) => {

        const day =
          getDaySettings(date);


        if (
          !day ||
          day.closed
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


        first =
          Math.ceil(
            first / SLOT_STEP
          ) *
          SLOT_STEP;


        const result = [];


        for (
          let start = first;
          start + duration <= last;
          start += SLOT_STEP
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
      };


    const findSlots =
      (
        date,
        serviceName
      ) => {

        const service =
          getService(
            serviceName
          );


        if (!service) {
          return [];
        }


        return available(
          date,
          serviceDuration(service)
        );
      };


    /* ========================================================
       DATE DETECTION
       ======================================================== */

    const detectDate = text => {

      const n =
        norm(text);


      if (!n) {
        return null;
      }


      if (
        /\bdopodomani\b/.test(n)
      ) {
        return addDays(today, 2);
      }


      if (
        /\bdomani\b/.test(n)
      ) {
        return addDays(today, 1);
      }


      if (
        /\boggi\b/.test(n)
      ) {
        return today;
      }


      const iso =
        n.match(
          /\b(20\d{2}-\d{2}-\d{2})\b/
        );


      if (
        iso &&
        isValidDate(iso[1])
      ) {
        return iso[1];
      }


      const numeric =
        n.match(
          /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b/
        );


      if (numeric) {

        const day =
          Number(numeric[1]);

        const month =
          Number(numeric[2]);

        const year =
          numeric[3]
            ? Number(numeric[3])
            : Number(
                today.slice(0, 4)
              );


        if (
          day >= 1 &&
          day <= 31 &&
          month >= 1 &&
          month <= 12
        ) {

          const result =
            `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;


          if (
            isValidDate(result)
          ) {
            return result;
          }
        }
      }


      const weekdays = {
        domenica: 0,
        lunedi: 1,
        martedi: 2,
        mercoledi: 3,
        giovedi: 4,
        venerdi: 5,
        sabato: 6
      };


      const current =
        new Date(
          today + "T12:00:00"
        ).getDay();


      for (
        const [name, target]
        of Object.entries(weekdays)
      ) {

        if (
          new RegExp(
            `\\b${name}\\b`
          ).test(n)
        ) {

          let diff =
            target - current;


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
    };


    /* ========================================================
       TIME DETECTION
       ======================================================== */

    const detectTime = text => {

      const n =
        norm(text);


      if (!n) {
        return null;
      }


      let match =
        n.match(
          /\b([01]?\d|2[0-3])[\.:,]([0-5]\d)\b/
        );


      if (match) {

        return fmt(
          Number(match[1]) * 60 +
          Number(match[2])
        );
      }


      match =
        n.match(
          /\b(?:alle|ore|verso|per le)\s+([01]?\d|2[0-3])\b/
        );


      if (match) {

        return fmt(
          Number(match[1]) * 60
        );
      }


      const standalone =
        n.match(
          /^\s*(?:alle\s*)?([01]?\d|2[0-3])(?:\s*ore)?\s*$/
        );


      if (
        standalone
      ) {

        return fmt(
          Number(
            standalone[1]
          ) * 60
        );
      }


      return null;
    };


    /* ========================================================
       PROMOTIONS
       ======================================================== */

    const promotionStart =
      promotion =>
        clean(
          promotion?.start ||
          promotion?.validFrom ||
          ""
        );


    const promotionEnd =
      promotion =>
        clean(
          promotion?.end ||
          promotion?.expiry ||
          promotion?.validUntil ||
          ""
        );


    const isPromotionActive =
      promotion => {

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
      };


    const validPromotions =
      safePromotions.filter(
        isPromotionActive
      );


    const promotionList =
      validPromotions.length
        ? validPromotions
            .map(
              promotion => {

                const title =
                  limited(
                    promotion.title ||
                    promotion.name,
                    150
                  );


                const description =
                  limited(
                    promotion.description ||
                    promotion.text,
                    500
                  );


                const price =
                  promotion.price !== undefined &&
                  promotion.price !== null &&
                  clean(promotion.price) !== ""
                    ? `€${limited(promotion.price, 30)}`
                    : "";


                return [
                  title
                    ? `- ${title}`
                    : "",
                  description
                    ? `descrizione: ${description}`
                    : "",
                  price
                    ? `prezzo: ${price}`
                    : ""
                ]
                  .filter(Boolean)
                  .join(" | ");
              }
            )
            .join("\n")
        : "Nessuna promozione attiva.";


    /* ========================================================
       PENDING APPOINTMENT
       ======================================================== */

    const normalizePending =
      value => {

        if (
          !isObject(value)
        ) {
          return null;
        }


        const result = {

          name:
            limited(
              value.name ||
              value.n ||
              clientName,
              200
            ),

          date:
            clean(
              value.date ||
              value.d ||
              ""
            ),

          time:
            clean(
              value.time ||
              value.t ||
              ""
            ),

          service:
            clean(
              value.service ||
              value.s ||
              ""
            )
        };


        if (
          result.date &&
          !isValidDate(result.date)
        ) {
          result.date = "";
        }


        if (
          result.time &&
          toMinutes(result.time) === null
        ) {
          result.time = "";
        }


        if (
          result.service &&
          !getService(result.service)
        ) {
          result.service = "";
        }


        return result;
      };


    let pending =
      normalizePending(
        pendingAppointment
      );


    /* ========================================================
       LOCKS
       ======================================================== */

    const cleanupLocks = () => {

      const now =
        Date.now();


      for (
        const [key, lock]
        of bookingLocks.entries()
      ) {

        if (
          !lock ||
          !Number.isFinite(lock.createdAt) ||
          now - lock.createdAt > LOCK_TTL
        ) {

          bookingLocks.delete(key);
        }
      }
    };


    const bookingKey =
      (
        date,
        time,
        service
      ) =>
        `${date}|${time}|${norm(service)}`;


    const acquireLock = key => {

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
    };


    const releaseLock = key => {

      bookingLocks.delete(key);
    };


    /* ========================================================
       CONFIRMATION
       ======================================================== */

    const isAffirmative = text => {

      const n =
        norm(text)
          .replace(
            /[.!?,;:]+$/g,
            ""
          )
          .trim();


      return [
        "si",
        "ok",
        "va bene",
        "va benissimo",
        "confermo",
        "conferma",
        "confermato",
        "prenota",
        "prenotala",
        "procedi",
        "puoi prenotare",
        "fai pure",
        "d'accordo",
        "daccordo"
      ].includes(n);
    };


    const isNegative = text => {

      const n =
        norm(text)
          .replace(
            /[.!?,;:]+$/g,
            ""
          )
          .trim();


      return [
        "no",
        "annulla",
        "cancella",
        "non confermo",
        "non prenotare",
        "lascia stare",
        "non va bene"
      ].includes(n);
    };


    const isCancelRequest = text => {

      const n =
        norm(text);


      return (
        /^(annulla|annullare|cancella|cancellare|disdici|disdire)\b/
          .test(n) ||
        n.includes("annulla prenotazione") ||
        n.includes("cancella prenotazione")
      );
    };


    /* ========================================================
       APPOINTMENT CHECK
       ======================================================== */

    const checkAppointment =
      appointment => {

        if (
          !isObject(appointment)
        ) {

          return {
            ok: false,
            error:
              "Dati appuntamento mancanti."
          };
        }


        const date =
          clean(appointment.date);

        const time =
          clean(appointment.time);

        const service =
          getService(
            appointment.service
          );


        if (
          !isValidDate(date)
        ) {

          return {
            ok: false,
            error:
              "Data dell'appuntamento mancante o non valida."
          };
        }


        if (
          toMinutes(time) === null
        ) {

          return {
            ok: false,
            error:
              "Orario dell'appuntamento mancante o non valido."
          };
        }


        if (!service) {

          return {
            ok: false,
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
            ok: false,
            error:
              `L'orario ${time} del ${italianDate(date)} non è disponibile.`
          };
        }


        return {
          ok: true,
          date,
          time,
          service,
          duration
        };
      };


    /* ========================================================
       LOCAL RESPONSE
       ======================================================== */

    const localReply = (
      reply,
      extra = {}
    ) => {

      return res.status(200).json({

        ok: true,

        reply:
          clean(reply),

        local: true,

        aiUsed: false,

        bookingConfirmed:
          extra.bookingConfirmed === true,

        confirmed:
          extra.confirmed === true,

        requiresConfirmation:
          extra.requiresConfirmation === true,

        ...extra

      });
    };


    /* ========================================================
       LOCAL TEXT
       ======================================================== */

    const localText =
      norm(
        message ||
        topic ||
        ""
      );


    const hasAny = words =>
      words.some(
        word =>
          localText.includes(
            norm(word)
          )
      );


    /* ========================================================
       ACTION: AVAILABILITY
       ======================================================== */

    if (
      action === "availability"
    ) {

      const requestedDate =
        clean(
          body.date || ""
        );


      const date =
        requestedDate &&
        isValidDate(requestedDate)
          ? requestedDate
          : detectDate(message);


      const requestedService =
        clean(
          body.service ||
          body.serviceName ||
          ""
        );


      const service =
        getService(requestedService) ||
        findService(message);


      if (!date) {

        return localReply(
          "Per verificare la disponibilità indicami il giorno.",
          {
            available: false,
            availableSlots: []
          }
        );
      }


      if (!service) {

        return localReply(
          "Per verificare la disponibilità indicami anche il servizio.",
          {
            available: false,
            availableSlots: []
          }
        );
      }


      const slots =
        findSlots(
          date,
          service.name
        );


      return localReply(
        slots.length
          ? `Per ${service.name}, ${italianDate(date)}, sono disponibili: ${slots.join(", ")}.`
          : `Non risultano orari disponibili per ${service.name} ${italianDate(date)}.`,
        {
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
            service.name
        }
      );
    }


    /* ========================================================
       DETECTION
       ======================================================== */

    const detectedDate =
      detectDate(message);


    const detectedTime =
      detectTime(message);


    const detectedService =
      findService(message);


    const bookingIntent =
      /prenot|appunt|fissare|fissa|riserv|disponibil|orario/i
        .test(message);


    const cancelIntent =
      isCancelRequest(message);


    /* ========================================================
       CANCEL PENDING
       ======================================================== */

    if (
      cancelIntent &&
      pending
    ) {

      return localReply(
        "Va bene, ho annullato la prenotazione in corso.",
        {
          confirmed: false,
          bookingConfirmed: false,
          requiresConfirmation: false,
          pendingAppointment: null,
          cancelled: true
        }
      );
    }


    /* ========================================================
       NEGATIVE CONFIRMATION
       ======================================================== */

    if (
      pending &&
      requiresConfirmation &&
      isNegative(message)
    ) {

      return localReply(
        "Va bene, non effettuo la prenotazione.",
        {
          confirmed: false,
          bookingConfirmed: false,
          requiresConfirmation: false,
          pendingAppointment: null,
          cancelled: true
        }
      );
    }


    /* ========================================================
       PENDING + TIME
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

        return localReply(
          "Il servizio della prenotazione non è più disponibile.",
          {
            bookingConfirmed: false,
            requiresConfirmation: false,
            pendingAppointment: null
          }
        );
      }


      const duration =
        serviceDuration(
          service
        );


      if (
        !free(
          pending.date,
          detectedTime,
          duration
        )
      ) {

        const slots =
          findSlots(
            pending.date,
            service.name
          );


        return localReply(
          slots.length
            ? `L'orario ${detectedTime} non è disponibile. Posso proporti: ${slots.join(", ")}.`
            : `L'orario ${detectedTime} non è disponibile e non ci sono altri slot liberi.`,
          {
            available: false,
            availableSlots: slots,
            availableDate: pending.date,
            availableService: service.name,

            pendingAppointment: {
              name:
                pending.name ||
                clientName ||
                "",

              date:
                pending.date,

              time: "",

              service:
                service.name
            }
          }
        );
      }


      const newPending = {

        name:
          pending.name ||
          clientName ||
          "",

        date:
          pending.date,

        time:
          detectedTime,

        service:
          service.name
      };


      return localReply(
        `Ho verificato la disponibilità. ${service.name} è disponibile ${italianDate(pending.date)} alle ${detectedTime}. Confermi la prenotazione?`,
        {
          bookingConfirmed: false,
          requiresConfirmation: true,
          pendingAppointment: newPending
        }
      );
    }


    /* ========================================================
       PENDING + NEW DATE
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

          return localReply(
            "Il servizio selezionato non è disponibile.",
            {
              bookingConfirmed: false,
              requiresConfirmation: false,
              pendingAppointment: null
            }
          );
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

          time: "",

          service:
            service.name
        };


        return localReply(
          slots.length
            ? `Per ${service.name}, ${italianDate(detectedDate)}, sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`
            : `Non risultano disponibilità per ${service.name} ${italianDate(detectedDate)}.`,
          {
            available:
              slots.length > 0,

            availableSlots:
              slots,

            availableDate:
              detectedDate,

            availableService:
              service.name,

            pendingAppointment:
              nextPending
          }
        );
      }
    }


    /* ========================================================
       FINAL CONFIRMATION
       ======================================================== */

    if (
      pending &&
      requiresConfirmation
    ) {

      if (
        isAffirmative(message)
      ) {

        if (
          !pending.date ||
          !pending.time ||
          !pending.service
        ) {

          return localReply(
            "Manca ancora qualche dato per completare la prenotazione.",
            {
              confirmed: false,
              bookingConfirmed: false,
              requiresConfirmation: true,
              pendingAppointment: pending
            }
          );
        }


        const service =
          getService(
            pending.service
          );


        if (!service) {

          return localReply(
            "Il servizio selezionato non è più disponibile.",
            {
              confirmed: false,
              bookingConfirmed: false,
              requiresConfirmation: false,
              pendingAppointment: null
            }
          );
        }


        const duration =
          serviceDuration(
            service
          );


        const key =
          bookingKey(
            pending.date,
            pending.time,
            service.name
          );


        if (
          !acquireLock(key)
        ) {

          return res.status(409).json({

            ok: false,

            confirmed: false,

            bookingConfirmed: false,

            requiresConfirmation: false,

            pendingAppointment: null,

            error:
              "Richiesta di prenotazione già in elaborazione.",

            reply:
              "Questa prenotazione è già in elaborazione. Verifica il calendario prima di riprovare."
          });
        }


        try {

          const finalCheck =
            checkAppointment({

              date:
                pending.date,

              time:
                pending.time,

              service:
                service.name
            });


          if (
            !finalCheck.ok
          ) {

            const alternatives =
              available(
                pending.date,
                duration
              );


            return res.status(409).json({

              ok: true,

              confirmed: false,

              bookingConfirmed: false,

              requiresConfirmation: false,

              available: false,

              availableSlots:
                alternatives,

              availableDate:
                pending.date,

              availableService:
                service.name,

              pendingAppointment: null,

              reply:
                alternatives.length
                  ? `L'orario ${pending.time} non è più disponibile. Posso proporti: ${alternatives.join(", ")}.`
                  : `L'orario ${pending.time} non è più disponibile e non risultano altri orari liberi per ${service.name}.`
            });
          }


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
                  appointmentDate(appointment) ===
                    pending.date &&

                  appointmentTime(appointment) ===
                    pending.time &&

                  norm(
                    appointmentService(
                      appointment
                    )
                  ) ===
                    norm(service.name)
                );
              }
            );


          if (duplicate) {

            return res.status(409).json({

              ok: false,

              confirmed: false,

              bookingConfirmed: false,

              requiresConfirmation: false,

              pendingAppointment: null,

              reply:
                "Questo appuntamento risulta già occupato. Verifica gli orari disponibili."
            });
          }


          const sameClientDuplicate =
            pending.name &&
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
                  appointmentDate(appointment) ===
                    pending.date &&

                  appointmentTime(appointment) ===
                    pending.time &&

                  norm(
                    appointmentName(
                      appointment
                    )
                  ) ===
                    norm(pending.name)
                );
              }
            );


          if (
            sameClientDuplicate
          ) {

            return res.status(409).json({

              ok: false,

              confirmed: false,

              bookingConfirmed: false,

              requiresConfirmation: false,

              pendingAppointment: null,

              reply:
                "Risulta già un appuntamento per questo cliente nello stesso giorno e orario."
            });
          }


          const appointment = {

            id:
              key,

            bookingKey:
              key,

            name:
              limited(
                pending.name ||
                clientName ||
                "",
                200
              ),

            date:
              pending.date,

            time:
              pending.time,

            service:
              service.name,

            duration,

            status:
              "confermato",

            createdAt:
              new Date().toISOString()
          };


          return res.status(200).json({

            ok: true,

            confirmed: true,

            bookingConfirmed: true,

            requiresConfirmation: false,

            appointment,

            pendingAppointment: null,

            reply:
              `Appuntamento confermato per ${appointment.name || "il cliente"} il ${italianDate(appointment.date)} alle ${appointment.time} per ${appointment.service}.`
          });

        } finally {

          releaseLock(key);

        }
      }


      return localReply(
        `La prenotazione è pronta: ${pending.service}, ${italianDate(pending.date)} alle ${pending.time}. Confermi?`,
        {
          confirmed: false,
          bookingConfirmed: false,
          requiresConfirmation: true,
          pendingAppointment: pending
        }
      );
    }


    /* ========================================================
       NEW BOOKING
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


        return localReply(
          alternatives.length
            ? `L'orario ${detectedTime} non è disponibile. Per ${detectedService.name} ${italianDate(detectedDate)} posso proporti: ${alternatives.join(", ")}.`
            : `L'orario ${detectedTime} non è disponibile e non risultano altri orari liberi per ${detectedService.name} ${italianDate(detectedDate)}.`,
          {
            available: false,
            availableSlots: alternatives,
            availableDate: detectedDate,
            availableService: detectedService.name,
            date: detectedDate,
            service: detectedService.name,
            requestedTime: detectedTime,
            alternatives
          }
        );
      }


      const newPending = {

        name:
          clientName || "",

        service:
          detectedService.name,

        date:
          detectedDate,

        time:
          detectedTime
      };


      return localReply(
        `Ho verificato la disponibilità. ${detectedService.name} è disponibile ${italianDate(detectedDate)} alle ${detectedTime}. Confermi la prenotazione?`,
        {
          bookingConfirmed: false,
          requiresConfirmation: true,
          pendingAppointment: newPending
        }
      );
    }


    /* ========================================================
       SERVICE + DATE
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
          clientName || "",

        service:
          detectedService.name,

        date:
          detectedDate,

        time: ""
      };


      if (!slots.length) {

        return localReply(
          `Non risultano disponibilità per ${detectedService.name} ${italianDate(detectedDate)}.`,
          {
            available: false,
            availableSlots: [],
            availableDate: detectedDate,
            availableService: detectedService.name,
            pendingAppointment: newPending
          }
        );
      }


      return localReply(
        `Per ${detectedService.name} ${italianDate(detectedDate)} sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`,
        {
          available: true,
          availableSlots: slots,
          availableDate: detectedDate,
          availableService: detectedService.name,
          pendingAppointment: newPending
        }
      );
    }


    /* ========================================================
       SERVICE WITHOUT DATE
       ======================================================== */

    if (
      bookingIntent &&
      detectedService &&
      !detectedDate
    ) {

      return localReply(
        `Per ${detectedService.name} indicami il giorno che preferisci.`
      );
    }


    /* ========================================================
       DATE WITHOUT SERVICE
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
              clean(service.name)
          )
          .filter(Boolean);


      return localReply(
        serviceNames.length
          ? `Per quale servizio? Puoi scegliere tra: ${serviceNames.join(", ")}.`
          : "Non ci sono ancora servizi configurati."
      );
    }


    /* ========================================================
       LOCAL INTENT — SALUTO
       ======================================================== */

    if (
      /^(ciao|salve|buongiorno|buonasera|buonanotte|ehi|hey)$/
        .test(localText)
    ) {

      return localReply(
        "Ciao. Sono Mavi. Dimmi pure cosa vuoi controllare o organizzare."
      );
    }


    /* ========================================================
       LOCAL INTENT — SERVIZI
       ======================================================== */

    if (
      hasAny([
        "quali servizi",
        "che servizi",
        "servizi offrite",
        "servizi offre",
        "cosa fate",
        "cosa offrite",
        "elenco servizi",
        "mostrami i servizi"
      ])
    ) {

      if (
        !safeServices.length
      ) {

        return localReply(
          "Non ci sono ancora servizi configurati."
        );
      }


      const lines =
        safeServices.map(
          service => {

            const name =
              clean(service.name);

            const price =
              clean(service.price);

            const duration =
              serviceDuration(service);

            let text =
              name;


            if (price) {
              text +=
                `, ${price} euro`;
            }


            if (duration) {
              text +=
                `, circa ${duration} minuti`;
            }


            return text;
          }
        );


      return localReply(
        `I servizi disponibili sono: ${lines.join("; ")}.`
      );
    }


    /* ========================================================
       LOCAL INTENT — PREZZO
       ======================================================== */

    const priceQuestion =
      hasAny([
        "quanto costa",
        "quanto viene",
        "prezzo",
        "prezzi",
        "costo",
        "costa"
      ]);


    if (
      priceQuestion
    ) {

      const service =
        findService(
          localText
        );


      if (service) {

        const price =
          clean(
            service.price
          );


        if (price) {

          return localReply(
            `${service.name} costa ${price} euro.`
          );
        }


        return localReply(
          `Il prezzo di ${service.name} non è ancora configurato.`
        );
      }


      if (
        safeServices.length
      ) {

        return localReply(
          `Indicami il servizio di cui vuoi conoscere il prezzo. I servizi configurati sono: ${safeServices.map(s => clean(s.name)).join(", ")}.`
        );
      }
    }


    /* ========================================================
       LOCAL INTENT — ORARI
       ======================================================== */

    if (
      hasAny([
        "orari",
        "a che ora aprite",
        "a che ora chiudete",
        "quando siete aperti",
        "giorni di apertura",
        "quando lavorate"
      ])
    ) {

      return localReply(
        openingHours ||
        "Gli orari dell'attività non sono ancora configurati."
      );
    }


    /* ========================================================
       LOCAL INTENT — PROMOZIONI
       ======================================================== */

    if (
      hasAny([
        "promozioni",
        "offerte",
        "offerta",
        "sconti",
        "sconto",
        "promozione"
      ])
    ) {

      if (
        !validPromotions.length
      ) {

        return localReply(
          "Al momento non risultano promozioni attive."
        );
      }


      const promotionsText =
        validPromotions
          .map(
            promotion =>
              clean(
                promotion.name ||
                promotion.title ||
                promotion.description ||
                promotion.text
              )
          )
          .filter(Boolean)
          .join("; ");


      return localReply(
        promotionsText
          ? `Le promozioni disponibili sono: ${promotionsText}.`
          : "Al momento non risultano promozioni attive."
      );
    }


    /* ========================================================
       LOCAL INTENT — APPUNTAMENTI OGGI
       ======================================================== */

    if (
      hasAny([
        "appuntamenti di oggi",
        "appuntamenti oggi",
        "oggi chi viene",
        "chi viene oggi",
        "cosa ho oggi",
        "cosa c'è oggi"
      ])
    ) {

      const list =
        safeAppointments
          .filter(
            appointment =>
              isActiveAppointment(
                appointment
              ) &&
              appointmentDate(
                appointment
              ) === today
          )
          .sort(
            (a, b) =>
              (
                toMinutes(
                  appointmentTime(a)
                ) ?? 9999
              ) -
              (
                toMinutes(
                  appointmentTime(b)
                ) ?? 9999
              )
          );


      if (
        !list.length
      ) {

        return localReply(
          "Oggi non risultano appuntamenti."
        );
      }


      const text =
        list
          .map(
            appointment =>
              `${appointmentTime(appointment)} ${appointmentName(appointment) || "cliente"}${appointmentService(appointment) ? `, ${appointmentService(appointment)}` : ""}`
          )
          .join("; ");


      return localReply(
        `Oggi hai ${list.length} appuntamenti: ${text}.`
      );
    }


    /* ========================================================
       LOCAL INTENT — APPUNTAMENTI DOMANI
       ======================================================== */

    if (
      hasAny([
        "appuntamenti di domani",
        "appuntamenti domani",
        "domani chi viene",
        "chi viene domani",
        "cosa ho domani",
        "cosa c'è domani"
      ])
    ) {

      const tomorrow =
        addDays(
          today,
          1
        );


      const list =
        safeAppointments
          .filter(
            appointment =>
              isActiveAppointment(
                appointment
              ) &&
              appointmentDate(
                appointment
              ) === tomorrow
          )
          .sort(
            (a, b) =>
              (
                toMinutes(
                  appointmentTime(a)
                ) ?? 9999
              ) -
              (
                toMinutes(
                  appointmentTime(b)
                ) ?? 9999
              )
          );


      if (
        !list.length
      ) {

        return localReply(
          "Domani non risultano appuntamenti."
        );
      }


      const text =
        list
          .map(
            appointment =>
              `${appointmentTime(appointment)} ${appointmentName(appointment) || "cliente"}${appointmentService(appointment) ? `, ${appointmentService(appointment)}` : ""}`
          )
          .join("; ");


      return localReply(
        `Domani hai ${list.length} appuntamenti: ${text}.`
      );
    }


    /* ========================================================
       LOCAL INTENT — DISPONIBILITÀ / BUCHI
       ======================================================== */

    if (
      hasAny([
        "ho un buco",
        "buchi",
        "buco",
        "orari liberi",
        "orari disponibili",
        "quando sei libero",
        "quando siete liberi",
        "quando c'è posto",
        "c'è posto"
      ])
    ) {

      if (
        detectedDate &&
        detectedService
      ) {

        const slots =
          findSlots(
            detectedDate,
            detectedService.name
          );


        if (
          slots.length
        ) {

          return localReply(
            `Per ${detectedService.name}, ${italianDate(detectedDate)}, gli orari disponibili sono: ${slots.join(", ")}.`,
            {
              available: true,
              availableSlots: slots,
              availableDate: detectedDate,
              availableService:
                detectedService.name
            }
          );
        }


        return localReply(
          `Non risultano orari liberi per ${detectedService.name} ${italianDate(detectedDate)}.`,
          {
            available: false,
            availableSlots: [],
            availableDate: detectedDate,
            availableService:
              detectedService.name
          }
        );
      }


      if (
        detectedDate
      ) {

        const day =
          getDaySettings(
            detectedDate
          );


        if (
          !day ||
          day.closed
        ) {

          return localReply(
            `${italianDate(detectedDate)} l'attività risulta chiusa.`
          );
        }


        const slots =
          available(
            detectedDate,
            DEFAULT_DURATION
          );


        return localReply(
          slots.length
            ? `Per ${italianDate(detectedDate)} risultano disponibili questi orari indicativi: ${slots.join(", ")}.`
            : `Non risultano buchi disponibili per ${italianDate(detectedDate)}.`
        );
      }


      return localReply(
        "Indicami il giorno e, se necessario, il servizio per cercare gli orari liberi."
      );
    }


    /* ========================================================
       LOCAL INTENT — CLIENTE
       ======================================================== */

    const clientLookupIntent =
      hasAny([
        "cliente",
        "clienti",
        "quando viene",
        "quando torna",
        "appuntamenti di",
        "storico di",
        "scheda di"
      ]);


    if (
      clientLookupIntent &&
      safeClients.length
    ) {

      let matchedClient =
        null;


      for (
        const client
        of safeClients
      ) {

        const name =
          norm(
            client.name
          );


        if (
          name &&
          localText.includes(name)
        ) {

          matchedClient =
            client;

          break;
        }
      }


      if (
        matchedClient
      ) {

        const name =
          clean(
            matchedClient.name
          );


        const clientAppointments =
          safeAppointments
            .filter(
              appointment =>
                isActiveAppointment(
                  appointment
                ) &&
                norm(
                  appointmentName(
                    appointment
                  )
                ) ===
                norm(name)
            )
            .sort(
              (a, b) =>
                (
                  `${appointmentDate(a)} ${appointmentTime(a)}`
                ).localeCompare(
                  `${appointmentDate(b)} ${appointmentTime(b)}`
                )
            );


        if (
          !clientAppointments.length
        ) {

          return localReply(
            `Non risultano appuntamenti associati a ${name}.`
          );
        }


        const future =
          clientAppointments.filter(
            appointment =>
              appointmentDate(
                appointment
              ) >= today
          );


        if (
          future.length
        ) {

          const next =
            future[0];


          return localReply(
            `${name} ha un appuntamento il ${italianDate(next.date)} alle ${next.time}${next.service ? ` per ${next.service}` : ""}.`
          );
        }


        return localReply(
          `Ho trovato ${clientAppointments.length} appuntamenti associati a ${name}, ma nessuno futuro.`
        );
      }
    }


    /* ========================================================
       LOCAL INTENT — CONTEGGI
       ======================================================== */

    if (
      hasAny([
        "quanti appuntamenti",
        "quanti clienti",
        "quanti servizi"
      ])
    ) {

      if (
        localText.includes("client")
      ) {

        return localReply(
          `Nell'app risultano ${safeClients.length} clienti.`
        );
      }


      if (
        localText.includes("serviz")
      ) {

        return localReply(
          `Nell'app risultano ${safeServices.length} servizi configurati.`
        );
      }


      if (
        localText.includes("appuntament")
      ) {

        const count =
          safeAppointments
            .filter(
              isActiveAppointment
            )
            .length;


        return localReply(
          `Risultano ${count} appuntamenti attivi.`
        );
      }
    }


    /* ========================================================
       MAVIRI CORE
       RISPOSTA GENERALE LOCALE
       ======================================================== */

    const businessName =
      clean(
        business ||
        settings?.name ||
        "questa attività"
      );


    const lower =
      localText;


    if (
      lower.includes("chi sei") ||
      lower.includes("come ti chiami")
    ) {

      return localReply(
        `Sono Mavi, l'assistente digitale di ${businessName}. Posso aiutarti a controllare servizi, prezzi, orari, promozioni, clienti, appuntamenti e disponibilità.`
      );
    }


    if (
      lower.includes("cosa puoi fare") ||
      lower.includes("cosa sai fare") ||
      lower.includes("come puoi aiutarmi")
    ) {

      return localReply(
        "Posso controllare i dati dell'attività, cercare disponibilità, gestire il flusso delle prenotazioni, consultare clienti e appuntamenti, leggere servizi, prezzi, orari e promozioni e aiutarti a creare contenuti."
      );
    }


    if (
      lower.includes("oggi")
    ) {

      const todayAppointments =
        safeAppointments
          .filter(
            appointment =>
              isActiveAppointment(
                appointment
              ) &&
              appointmentDate(
                appointment
              ) === today
          );


      if (
        todayAppointments.length
      ) {

        return localReply(
          `Oggi risultano ${todayAppointments.length} appuntamenti. Se vuoi, posso mostrarti l'elenco completo.`
        );
      }


      return localReply(
        "Oggi non risultano appuntamenti."
      );
    }


    if (
      lower.includes("domani")
    ) {

      const tomorrow =
        addDays(
          today,
          1
        );


      const tomorrowAppointments =
        safeAppointments
          .filter(
            appointment =>
              isActiveAppointment(
                appointment
              ) &&
              appointmentDate(
                appointment
              ) === tomorrow
          );


      if (
        tomorrowAppointments.length
      ) {

        return localReply(
          `Domani risultano ${tomorrowAppointments.length} appuntamenti. Se vuoi, posso mostrarti l'elenco completo.`
        );
      }


      return localReply(
        "Domani non risultano appuntamenti."
      );
    }


    /* ========================================================
       ACTION: POST
       GENERAZIONE LOCALE
       ======================================================== */

    if (
      action === "post"
    ) {

      const selectedContent =
        isObject(
          body.selectedContent
        )
          ? body.selectedContent
          : {};


      const platform =
        limited(
          body.platform ||
          "generic",
          100
        );


      const platformLabel =
        limited(
          body.platformLabel ||
          platform,
          100
        );


      const contentType =
        limited(
          body.contentType ||
          "generico",
          100
        );


      const style =
        limited(
          body.style ||
          "professionale",
          200
        );


      const goal =
        limited(
          body.goal ||
          "",
          500
        );


      const audience =
        limited(
          body.audience ||
          "",
          500
        );


      const callToAction =
        limited(
          body.callToAction ||
          "",
          500
        );


      const customMessage =
        limited(
          body.customMessage ||
          "",
          1500
        );


      const subject =
        limited(
          topic ||
          selectedContent.title ||
          "i nostri servizi",
          500
        );


      const serviceNames =
        safeServices
          .slice(0, 10)
          .map(
            service =>
              clean(service.name)
          )
          .filter(Boolean);


      const activePromo =
        validPromotions
          .slice(0, 5)
          .map(
            promotion =>
              clean(
                promotion.title ||
                promotion.name ||
                promotion.description
              )
          )
          .filter(Boolean);


      let post = "";


      if (
        contentType.toLowerCase()
          .includes("offerta") ||
        activePromo.length
      ) {

        post =
          `${businessName} ha una novità per te.\n\n` +
          `${activePromo.length ? activePromo.join(" • ") : subject}.\n\n` +
          `${customMessage || goal || "Contattaci per scoprire tutti i dettagli e prenotare il tuo appuntamento."}`;

      } else {

        post =
          `${subject.charAt(0).toUpperCase()}${subject.slice(1)}.\n\n` +
          `${businessName} è a tua disposizione con ${serviceNames.length ? serviceNames.join(", ") : "i nostri servizi"}.\n\n` +
          `${customMessage || goal || "Prenota il tuo appuntamento e scopri il servizio più adatto a te."}`;
      }


      if (
        callToAction
      ) {

        post +=
          `\n\n${callToAction}`;
      }


      if (
        audience
      ) {

        post +=
          `\n\nPensato per: ${audience}.`;
      }


      if (
        style &&
        norm(style) !== "professionale"
      ) {

        if (
          norm(style).includes("social")
        ) {

          post =
            post
              .replace(
                /\n\n/g,
                "\n\n"
              );
        }
      }


      if (
        platformLabel &&
        norm(platformLabel) !== "generic"
      ) {

        post +=
          `\n\n#${norm(businessName)
            .replace(/[^a-z0-9]+/g, "")}`;

      }


      return res.status(200).json({

        ok: true,

        reply:
          post.trim(),

        post:
          post.trim(),

        local: true,

        aiUsed: false,

        meta: {
          platform,
          contentType,
          engine:
            "Mavi Core Local"
        }

      });
    }


    /* ========================================================
       LOCAL FALLBACK
       ======================================================== */

    if (
      !message &&
      !topic
    ) {

      return localReply(
        "Sono Mavi. Dimmi cosa vuoi controllare o organizzare."
      );
    }


    /*
     * Non inventiamo una risposta.
     * Il motore locale dichiara chiaramente quando
     * non riconosce ancora una richiesta.
     */

    return localReply(
      "Ho capito la richiesta, ma questa funzione non è ancora disponibile nel mio motore locale. Posso però aiutarti con appuntamenti, disponibilità, servizi, prezzi, orari, promozioni e clienti."
    );


  } catch (error) {

    console.error(
      "MAVIRI /api/chat ERROR:",
      error
    );


    return res.status(500).json({

      ok: false,

      aiUsed: false,

      error:
        "Errore interno del server. Riprova tra poco."

    });
  }
}
