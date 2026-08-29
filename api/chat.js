import OpenAI from "openai";

/* ============================================================
   MAVIRI / API CHAT
   Compatibile con l'attuale index.html
============================================================ */

const LOCK_TTL = 15000;

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

    const {
      action = "",
      message = "",
      topic = "",
      business = "",
      clientName = "",
      settings = {},
      services = [],
      promotions = [],
      appointments = [],
      clients = [],
      history = [],
      pendingAppointment = null,
      requiresConfirmation = false
    } = body;


    /* ========================================================
       OPENAI
    ======================================================== */

    const openai =
      new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY
      });


    /* ========================================================
       FUNZIONI BASE
    ======================================================== */

    const clean = value =>
      String(value ?? "").trim();


    const norm = value =>
      clean(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");


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

      const h = Number(match[1]);
      const m = Number(match[2]);

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
        minutes < 0
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

      const value = clean(date);

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

      if (!isValidDate(date)) {
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

      parts.forEach(part => {

        if (
          part.type !== "literal"
        ) {
          map[part.type] =
            part.value;
        }

      });

      return (
        `${map.year}-${map.month}-${map.day}`
      );
    };


    const today =
      getTodayRome();


    const italianDate = date => {

      if (!isValidDate(date)) {
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
       DATI SICURI
    ======================================================== */

    const safeServices =
      Array.isArray(services)
        ? services.filter(
            service =>
              service &&
              typeof service === "object" &&
              clean(service.name)
          )
        : [];


    const safePromotions =
      Array.isArray(promotions)
        ? promotions.filter(
            promotion =>
              promotion &&
              typeof promotion === "object"
          )
        : [];


    const safeAppointments =
      Array.isArray(appointments)
        ? appointments.filter(
            appointment =>
              appointment &&
              typeof appointment === "object"
          )
        : [];


    const safeClients =
      Array.isArray(clients)
        ? clients.filter(
            client =>
              client &&
              typeof client === "object"
          )
        : [];


    /* ========================================================
       SERVIZI
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
        ) || null
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
          service =>
            n.includes(
              norm(service.name)
            )
        );

      if (exact) {
        return exact;
      }

      return (
        safeServices.find(
          service => {

            const words =
              norm(service.name)
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
        ) || null
      );
    };


    const serviceDuration = service => {

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
    };


    /* ========================================================
       APPUNTAMENTI
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

        return (
          status !== "cancellato" &&
          status !== "cancelled" &&
          status !== "canceled"
        );
      };


    /* ========================================================
       ORARI
    ======================================================== */

    const getDaySettings = date => {

      const day =
        settings?.hours?.[
          getDayName(date)
        ];

      if (!day) {
        return null;
      }

      const closed =
        day.closed === true ||
        day.status === "closed" ||
        day.open === false;

      const open =
        day.start ||
        day.open ||
        "";

      const close =
        day.end ||
        day.close ||
        "";

      const breakStart =
        day.breakStart ||
        day.pauseStart ||
        day.break_start ||
        "";

      const breakEnd =
        day.breakEnd ||
        day.pauseEnd ||
        day.break_end ||
        "";

      return {
        ...day,
        closed,
        open,
        close,
        breakStart,
        breakEnd
      };
    };


    function getDayName(date) {

      if (!isValidDate(date)) {
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
    }


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
            day.start ||
            day.open ||
            "";

          const close =
            day.end ||
            day.close ||
            "";

          const breakStart =
            day.breakStart ||
            day.pauseStart ||
            "";

          const breakEnd =
            day.breakEnd ||
            day.pauseEnd ||
            "";

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
      .join("\n");


    /* ========================================================
       PAUSE
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
          breakEnd === null
        ) {
          return false;
        }

        return (
          breakStart < breakEnd &&
          start < breakEnd &&
          end > breakStart
        );
      };


    /* ========================================================
       DISPONIBILITÀ
    ======================================================== */

    const free =
      (
        date,
        time,
        duration,
        ignoreId = ""
      ) => {

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
          Number(duration) || 30;

        if (
          opening === null ||
          closing === null ||
          start === null
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
              appointment.id &&
              String(appointment.id) ===
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

            const existingService =
              getService(
                appointmentService(
                  appointment
                )
              );

            const existingDuration =
              serviceDuration(
                existingService
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
      };


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
          Math.ceil(first / 30) * 30;

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
        n.includes("dopodomani")
      ) {
        return addDays(
          today,
          2
        );
      }

      if (
        n.includes("domani")
      ) {
        return addDays(
          today,
          1
        );
      }

      if (
        n.includes("oggi")
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

        const year =
          numeric[3] ||
          today.slice(0,4);

        const day =
          Number(numeric[1]);

        const month =
          Number(numeric[2]);

        const result =
          `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;

        if (
          isValidDate(result)
        ) {
          return result;
        }
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

      const current =
        new Date(
          today + "T12:00:00"
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

        if (
          n.includes(name)
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

      /*
       * Numero isolato.
       *
       * IMPORTANTE:
       * viene usato soprattutto quando
       * l'utente risponde con uno slot,
       * ad esempio "15".
       */

      const standalone =
        n.match(
          /\b([01]?\d|2[0-3])\b/
        );

      if (standalone) {

        const hour =
          Number(
            standalone[1]
          );

        return fmt(
          hour * 60
        );
      }

      return null;
    };


    /* ========================================================
       PROMOZIONI
       Compatibile con:
       start/end
       expiry
    ======================================================== */

    const promotionEnd =
      promotion =>
        clean(
          promotion?.end ||
          promotion?.expiry ||
          ""
        );


    const promotionStart =
      promotion =>
        clean(
          promotion?.start ||
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
                  clean(
                    promotion.title
                  );

                const category =
                  clean(
                    promotion.category
                  );

                const description =
                  clean(
                    promotion.description
                  );

                const price =
                  promotion.price !==
                    undefined &&
                  promotion.price !==
                    null &&
                  clean(
                    promotion.price
                  ) !== ""
                    ? `€${promotion.price}`
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
                    ? `validità: ${start || "immediata"}${end ? " - " + end : ""}`
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
            .join("\n")
        : "Nessuna promozione attiva.";


    /* ========================================================
       PENDING APPOINTMENT
    ======================================================== */

    const normalizePending =
      value => {

        if (
          !value ||
          typeof value !== "object"
        ) {
          return null;
        }

        return {
          ...value,

          name:
            clean(
              value.name ||
              value.n ||
              clientName
            ),

          date:
            clean(
              value.date ||
              value.d
            ),

          time:
            clean(
              value.time ||
              value.t
            ),

          service:
            clean(
              value.service ||
              value.s
            )
        };
      };


    let pending =
      normalizePending(
        pendingAppointment
      );


    /* ========================================================
       LOCK
    ======================================================== */

    const cleanupLocks = () => {

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
          now - lock.createdAt >
          LOCK_TTL
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

      const existing =
        bookingLocks.get(key);

      if (existing) {
        return false;
      }

      bookingLocks.set(
        key,
        {
          createdAt:Date.now()
        }
      );

      return true;
    };


    const releaseLock = key => {
      bookingLocks.delete(key);
    };


    /* ========================================================
       CHECK APPUNTAMENTO
    ======================================================== */

    const checkAppointment =
      appointment => {

        if (!appointment) {

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

        const time =
          clean(
            appointment.time
          );

        const service =
          getService(
            appointment.service
          );

        if (
          !date ||
          !isValidDate(date)
        ) {

          return {
            ok:false,
            error:
              "Data dell'appuntamento mancante o non valida."
          };
        }

        if (
          !time ||
          toMinutes(time) === null
        ) {

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
      };


    /* ========================================================
       SLOT PER SERVIZIO
    ======================================================== */

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
       ACTION: POST AI
    ======================================================== */

    if (
      action === "post"
    ) {

      const selectedContent =
        body.selectedContent ||
        null;

      const contentType =
        body.contentType ||
        "generico";

      const platform =
        body.platform ||
        "generic";

      const platformLabel =
        body.platformLabel ||
        platform;

      const contentTypeLabel =
        body.contentTypeLabel ||
        contentType;

      const style =
        body.style ||
        "professionale";

      const goal =
        body.goal ||
        "";

      const audience =
        body.audience ||
        "";

      const callToAction =
        body.callToAction ||
        "";

      const customMessage =
        body.customMessage ||
        "";

      const advanced =
        body.advanced === true;


      const postPrompt = `
Sei l'assistente AI di marketing di un'attività locale italiana.

Crea un contenuto pronto per essere pubblicato.

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
- Il testo deve essere immediatamente utilizzabile.
- Usa hashtag pertinenti quando appropriato.
`;

      const completion =
        await openai.chat.completions.create({

          model:
            "gpt-5.4-mini",

          messages:[
            {
              role:"system",
              content:postPrompt
            },
            {
              role:"user",
              content:
                topic ||
                "Crea un post per l'attività."
            }
          ],

          temperature:0.8
        });


      const reply =
        completion
          ?.choices?.[0]
          ?.message
          ?.content
          ?.trim() ||
        "";


      if (!reply) {

        return res.status(500).json({
          ok:false,
          error:
            "L'AI non ha restituito alcun contenuto."
        });
      }


      return res.status(200).json({

        ok:true,

        reply,

        post:reply,

        meta:{
          platform,
          contentType,
          advanced
        }

      });
    }


    /* ========================================================
       ACTION: AVAILABILITY
    ======================================================== */

    if (
      action === "availability"
    ) {

      const date =
        body.date ||
        detectDate(message);

      const serviceName =
        body.service ||
        body.serviceName ||
        findService(message)?.name ||
        "";

      if (!date) {

        return res.status(200).json({
          ok:true,
          available:false,
          availableSlots:[],
          reply:
            "Per verificare la disponibilità indicami il giorno."
        });
      }

      if (!serviceName) {

        return res.status(200).json({
          ok:true,
          available:false,
          availableSlots:[],
          reply:
            "Per verificare la disponibilità indicami anche il servizio."
        });
      }

      const slots =
        findSlots(
          date,
          serviceName
        );

      return res.status(200).json({

        ok:true,

        available:
          slots.length > 0,

        date,

        service:
          serviceName,

        slots,

        availableSlots:
          slots,

        availableDate:
          date,

        availableService:
          serviceName,

        reply:
          slots.length
            ? `Per ${serviceName}, ${italianDate(date)}, sono disponibili: ${slots.join(", ")}.`
            : `Non risultano orari disponibili per ${serviceName} ${italianDate(date)}.`

      });
    }


    /* ========================================================
       RILEVAMENTO RICHIESTA
    ======================================================== */

    const detectedDate =
      detectDate(message);

    const detectedTime =
      detectTime(message);

    const detectedService =
      findService(message);


    const bookingIntent =
      /prenot|appunt|fissare|fissa|riserv|disponibil|orario/i
        .test(
          message
        );


    const cancelIntent =
      /^(annulla|annullare|cancella|cancellare|non prenotare)/i
        .test(
          norm(message)
        );


    /* ========================================================
       ANNULLAMENTO PENDING
    ======================================================== */

    if (
      cancelIntent &&
      pending
    ) {

      return res.status(200).json({

        ok:true,

        confirmed:false,

        bookingConfirmed:false,

        requiresConfirmation:false,

        pendingAppointment:null,

        cancelled:true,

        reply:
          "Va bene, ho annullato la prenotazione in corso."

      });
    }


    /* ========================================================
       CONTINUA PENDING:
       servizio/data già scelti,
       utente sceglie ORARIO
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

        return res.status(200).json({

          ok:false,

          bookingConfirmed:false,

          requiresConfirmation:false,

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

        return res.status(200).json({

          ok:true,

          bookingConfirmed:false,

          requiresConfirmation:false,

          available:false,

          availableSlots:slots,

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


      return res.status(200).json({

        ok:true,

        bookingConfirmed:false,

        requiresConfirmation:true,

        pendingAppointment:
          newPending,

        reply:
          `Ho verificato la disponibilità. ${service.name} è disponibile ${italianDate(pending.date)} alle ${selectedTime}. Confermi la prenotazione?`

      });
    }


    /* ========================================================
       CONTINUA PENDING:
       utente modifica/fornisce data
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

        const slots =
          findSlots(
            detectedDate,
            serviceName
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
            serviceName

        };


        return res.status(200).json({

          ok:true,

          bookingConfirmed:false,

          requiresConfirmation:false,

          available:
            slots.length > 0,

          availableSlots:
            slots,

          availableDate:
            detectedDate,

          availableService:
            serviceName,

          pendingAppointment:
            nextPending,

          reply:
            slots.length
              ? `Per ${serviceName}, ${italianDate(detectedDate)}, sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`
              : `Non risultano disponibilità per ${serviceName} ${italianDate(detectedDate)}.`

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
        /conferm|si|sì|ok|va bene|procedi|prenota|confermo/i
          .test(
            norm(message)
          );


      if (confirmIntent) {

        if (
          !pending.date ||
          !pending.time ||
          !pending.service
        ) {

          return res.status(200).json({

            ok:false,

            confirmed:false,

            bookingConfirmed:false,

            requiresConfirmation:true,

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

          return res.status(200).json({

            ok:false,

            confirmed:false,

            bookingConfirmed:false,

            requiresConfirmation:false,

            reply:
              "Il servizio selezionato non è più disponibile."

          });
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


        /*
         * LOCK IMMEDIATO
         */

        if (!acquireLock(key)) {

          return res.status(200).json({

            ok:false,

            confirmed:false,

            bookingConfirmed:false,

            requiresConfirmation:false,

            pendingAppointment:null,

            reply:
              "Questo appuntamento è stato appena richiesto da un'altra operazione. Verifica gli orari disponibili."

          });
        }


        try {

          /*
           * RICONTROLLO FINALE.
           */

          const finalFree =
            free(
              pending.date,
              pending.time,
              duration
            );


          if (!finalFree) {

            const alternatives =
              available(
                pending.date,
                duration
              );


            return res.status(200).json({

              ok:true,

              confirmed:false,

              bookingConfirmed:false,

              requiresConfirmation:false,

              available:false,

              availableSlots:
                alternatives,

              availableDate:
                pending.date,

              availableService:
                service.name,

              pendingAppointment:null,

              reply:
                alternatives.length
                  ? `L'orario ${pending.time} non è più disponibile. Per ${service.name} posso proporti: ${alternatives.join(", ")}.`
                  : `L'orario ${pending.time} non è più disponibile e non risultano altri orari liberi per ${service.name}.`

            });
          }


          /*
           * SECONDO CONTROLLO CONTRO
           * DUPLICATI IDENTICI.
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
                  ) === pending.date &&
                  appointmentTime(
                    appointment
                  ) === pending.time &&
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

            return res.status(200).json({

              ok:false,

              confirmed:false,

              bookingConfirmed:false,

              requiresConfirmation:false,

              reply:
                "Questo appuntamento risulta già occupato. Verifica gli orari disponibili."

            });
          }


          /*
           * L'API NON salva nel localStorage.
           *
           * Restituisce all'INDEX il record
           * che deve essere salvato localmente.
           */

          const appointment = {

            bookingKey:key,

            name:
              pending.name ||
              clientName ||
              "",

            date:
              pending.date,

            time:
              pending.time,

            service:
              service.name,

            duration

          };


          return res.status(200).json({

            ok:true,

            confirmed:true,

            bookingConfirmed:true,

            requiresConfirmation:false,

            appointment,

            pendingAppointment:null,

            reply:
              `Appuntamento confermato per ${appointment.name || "il cliente"} il ${italianDate(appointment.date)} alle ${appointment.time} per ${appointment.service}.`

          });

        } finally {

          releaseLock(key);
        }
      }


      /*
       * Se esiste pending ma l'utente
       * non ha ancora confermato,
       * non eseguiamo la prenotazione.
       */

      return res.status(200).json({

        ok:true,

        confirmed:false,

        bookingConfirmed:false,

        requiresConfirmation:true,

        pendingAppointment:
          pending,

        reply:
          `La prenotazione è pronta: ${pending.service}, ${italianDate(pending.date)} alle ${pending.time}. Confermi?`

      });
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


      const isFree =
        free(
          detectedDate,
          detectedTime,
          duration
        );


      if (!isFree) {

        const alternatives =
          available(
            detectedDate,
            duration
          );


        return res.status(200).json({

          ok:true,

          bookingConfirmed:false,

          requiresConfirmation:false,

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


      return res.status(200).json({

        ok:true,

        bookingConfirmed:false,

        requiresConfirmation:true,

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


      if (!slots.length) {

        return res.status(200).json({

          ok:true,

          bookingConfirmed:false,

          requiresConfirmation:false,

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


      return res.status(200).json({

        ok:true,

        bookingConfirmed:false,

        requiresConfirmation:false,

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

      return res.status(200).json({

        ok:true,

        bookingConfirmed:false,

        requiresConfirmation:false,

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
              clean(service.name)
          )
          .filter(Boolean);


      return res.status(200).json({

        ok:true,

        bookingConfirmed:false,

        requiresConfirmation:false,

        reply:
          serviceNames.length
            ? `Per quale servizio? Puoi scegliere tra: ${serviceNames.join(", ")}.`
            : "Non ci sono ancora servizi configurati."

      });
    }


    /* ========================================================
       DATI CLIENTE
    ======================================================== */

    const clientText =
      safeClients.length
        ? safeClients
            .map(
              client =>
                `- ${clean(client.name)}${client.phone ? ` | telefono: ${clean(client.phone)}` : ""}${client.email ? ` | email: ${clean(client.email)}` : ""}`
            )
            .join("\n")
        : "Nessun cliente configurato.";


    /* ========================================================
       SERVIZI PER AI
    ======================================================== */

    const serviceText =
      safeServices.length
        ? safeServices
            .map(
              service =>
                `- ${clean(service.name)} (${serviceDuration(service)} minuti${service.price !== undefined && clean(service.price) !== "" ? `, €${clean(service.price)}` : ""}${service.description ? ` — ${clean(service.description)}` : ""})`
            )
            .join("\n")
        : "Nessun servizio configurato.";


    /* ========================================================
       APPUNTAMENTI PER AI
    ======================================================== */

    const appointmentText =
      safeAppointments.length
        ? safeAppointments
            .filter(
              isActiveAppointment
            )
            .map(
              appointment =>
                `- ${appointmentDate(appointment)} ${appointmentTime(appointment)} | ${appointmentName(appointment)} | ${appointmentService(appointment)}`
            )
            .join("\n")
        : "Nessun appuntamento.";


    /* ========================================================
       HISTORY
    ======================================================== */

    const historyMessages =
      Array.isArray(history)
        ? history
            .slice(-12)
            .filter(
              item =>
                item &&
                (
                  item.role === "user" ||
                  item.role === "assistant"
                )
            )
            .map(
              item => ({
                role:item.role,
                content:
                  clean(
                    item.content ||
                    item.message ||
                    ""
                  )
              })
            )
            .filter(
              item =>
                item.content
            )
        : [];


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
${openingHours}

SERVIZI:
${serviceText}

PROMOZIONI ATTIVE:
${promotionList}

APPUNTAMENTI ATTIVI:
${appointmentText}

CLIENTI:
${clientText}

REGOLE FONDAMENTALI:

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

4. Quando l'utente vuole prenotare,
   raccogli servizio, data e orario.

5. Prima della conferma devi verificare
   effettivamente la disponibilità.

6. Non dichiarare mai confermato
   un appuntamento se l'utente non lo ha
   esplicitamente confermato.

7. Se l'applicazione ti fornisce
   availableSlots, considera quelli
   come gli unici slot disponibili.

8. "domani" significa:
   ${addDays(today,1)}

9. "dopodomani" significa:
   ${addDays(today,2)}

10. Per i giorni della settimana
    considera il prossimo giorno futuro
    corrispondente.

11. Non dire di aver salvato,
    cancellato o modificato dati
    se l'operazione non è stata
    realmente eseguita dall'applicazione.

12. Mantieni le risposte brevi,
    chiare e naturali.

13. Le promozioni scadute non devono
    essere presentate come attive.

14. Se l'utente chiede informazioni
    sull'attività, utilizza i dati
    disponibili senza inventare.

15. Se una richiesta è ambigua,
    chiedi soltanto il dato necessario
    per procedere.
`;


    /* ========================================================
       CHIAMATA OPENAI
    ======================================================== */

    const completion =
      await openai.chat.completions.create({

        model:
          "gpt-5.4-mini",

        messages:[
          {
            role:"system",
            content:
              systemPrompt
          },

          ...historyMessages,

          {
            role:"user",
            content:
              message ||
              topic ||
              "Ciao"
          }
        ],

        temperature:0.4

      });


    const reply =
      completion
        ?.choices?.[0]
        ?.message
        ?.content
        ?.trim() ||
      "Non ho ricevuto una risposta dall'assistente.";


    /* ========================================================
       RISPOSTA GENERALE
    ======================================================== */

    return res.status(200).json({

      ok:true,

      reply,

      bookingConfirmed:false,

      confirmed:false,

      requiresConfirmation:false

    });


  } catch (error) {

    console.error(
      "API /api/chat error:",
      error
    );

    return res.status(500).json({

      ok:false,

      error:
        error?.message ||
        "Errore interno del server."

    });
  }
}
