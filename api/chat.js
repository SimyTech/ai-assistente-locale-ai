import OpenAI from "openai";

/* ============================================================
   MAVIRI / API CHAT
   VERSIONE COMPLETA E CORRETTA
   Compatibile con l'attuale struttura index.html

   Funzioni:
   - Assistente AI
   - Gestione servizi
   - Promozioni
   - Orari e pause
   - Verifica disponibilità
   - Pending appointment
   - Conferma appuntamento
   - Protezione doppia prenotazione
   - Ricerca disponibilità
   - Gestione clienti forniti dall'index
   - Generazione Post AI
   - Compatibilità campi vecchi/nuovi
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
        "OPENAI_API_KEY non disponibile nel deployment Vercel."
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
          .replace(",", ":")
          .replace(".", ":");


      if (
        /^\d{1,2}$/.test(s)
      ) {
        s += ":00";
      }


      const match =
        s.match(
          /^(\d{1,2}):([0-5]\d)$/
        );


      if (!match) {
        return null;
      }


      const hour =
        Number(match[1]);

      const minute =
        Number(match[2]);


      if (
        !Number.isInteger(hour) ||
        !Number.isInteger(minute) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59
      ) {
        return null;
      }


      return (
        hour * 60 +
        minute
      );
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


    const addDays =
      (
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


      parts.forEach(
        part => {

          if (
            part.type !== "literal"
          ) {
            map[part.type] =
              part.value;
          }

        }
      );


      return (
        `${map.year}-${map.month}-${map.day}`
      );
    };


    const today =
      getTodayRome();


    const italianDate =
      date => {

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
            weekday:
              "long",
            day:
              "numeric",
            month:
              "long"
          }
        );
      };


    /* ========================================================
       DATI SICURI
    ======================================================== */

    const safeServices =
      Array.isArray(services)
        ? services.filter(
            item =>
              item &&
              typeof item === "object" &&
              clean(item.name)
          )
        : [];


    const safePromotions =
      Array.isArray(promotions)
        ? promotions.filter(
            item =>
              item &&
              typeof item === "object"
          )
        : [];


    const safeAppointments =
      Array.isArray(appointments)
        ? appointments.filter(
            item =>
              item &&
              typeof item === "object"
          )
        : [];


    const safeClients =
      Array.isArray(clients)
        ? clients.filter(
            item =>
              item &&
              typeof item === "object"
          )
        : [];


    /* ========================================================
       SERVIZI
    ======================================================== */

    const getService =
      name => {

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


    const findService =
      text => {

        const n =
          norm(text);


        if (!n) {
          return null;
        }


        const exact =
          safeServices.find(
            service => {

              const serviceName =
                norm(service.name);

              return (
                serviceName &&
                (
                  n === serviceName ||
                  n.includes(serviceName)
                )
              );
            }
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


              if (!words.length) {
                return false;
              }


              return words.every(
                word =>
                  n.includes(word)
              );
            }
          ) || null
        );
      };


    const serviceDuration =
      service => {

        const value =
          Number(
            service?.duration
          );


        return (
          Number.isFinite(value) &&
          value > 0 &&
          value <= 1440
        )
          ? value
          : 30;
      };


    const servicePrice =
      service => {

        if (
          service?.price === null ||
          service?.price === undefined
        ) {
          return "";
        }


        return clean(
          service.price
        );
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


    const appointmentId =
      appointment =>
        clean(
          appointment?.id ||
          appointment?.bookingKey ||
          ""
        );


    const isCancelledStatus =
      appointment => {

        const status =
          appointmentStatus(
            appointment
          );


        return (
          status === "cancellato" ||
          status === "cancelled" ||
          status === "canceled" ||
          status === "annullato" ||
          status === "annullata"
        );
      };


    const isActiveAppointment =
      appointment =>
        !isCancelledStatus(
          appointment
        );


    /* ========================================================
       ORARI
    ======================================================== */

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
          date + "T12:00:00"
        ).getDay()
      ];
    }


    const getDaySettings =
      date => {

        const dayName =
          getDayName(date);


        if (!dayName) {
          return null;
        }


        const day =
          settings?.hours?.[dayName];


        if (
          !day ||
          typeof day !== "object"
        ) {
          return null;
        }


        const closed =
          day.closed === true ||
          day.status === "closed" ||
          day.open === false;


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


          if (
            !day ||
            typeof day !== "object"
          ) {
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
            `${label}: ${open || "?"} - ${close || "?"}${pause}`
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


        if (
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
       DISPONIBILITÀ
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
          end <= start
        ) {
          return false;
        }


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


            const existingId =
              appointmentId(
                appointment
              );


            if (
              ignoreId &&
              existingId &&
              String(existingId) ===
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

        if (
          !isValidDate(date)
        ) {
          return [];
        }


        const day =
          getDaySettings(date);


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
          closing <= opening
        ) {
          return [];
        }


        const dur =
          Number(duration);


        if (
          !Number.isFinite(dur) ||
          dur <= 0
        ) {
          return [];
        }


        let first =
          startAfter === null
            ? opening
            : Math.max(
                opening,
                Number(startAfter)
              );


        let last =
          endBefore === null
            ? closing
            : Math.min(
                closing,
                Number(endBefore)
              );


        if (
          !Number.isFinite(first) ||
          !Number.isFinite(last) ||
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
          start + dur <= last;
          start += 30
        ) {

          if (
            free(
              date,
              fmt(start),
              dur
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

    const detectDate =
      text => {

        const n =
          norm(text);


        if (!n) {
          return null;
        }


        if (
          /\bdopodomani\b/.test(n)
        ) {
          return addDays(
            today,
            2
          );
        }


        if (
          /\bdomani\b/.test(n)
        ) {
          return addDays(
            today,
            1
          );
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
          isValidDate(
            iso[1]
          )
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
            Number(
              numeric[1]
            );


          const month =
            Number(
              numeric[2]
            );


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

          const wordRegex =
            new RegExp(
              `\\b${name}\\b`,
              "i"
            );


          if (
            wordRegex.test(n)
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

    const detectTime =
      text => {

        const n =
          norm(text);


        if (!n) {
          return null;
        }


        /*
         * Prima cerchiamo un orario esplicito:
         * 15:30
         * 15.30
         * 15,30
         */

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


        /*
         * Orario esplicito con "alle",
         * "ore", "per le", "verso".
         *
         * NON consideriamo più qualsiasi
         * numero isolato come orario.
         */

        match =
          n.match(
            /\b(?:alle|ore|verso|per le)\s+([01]?\d|2[0-3])(?:\s*e\s*(?:mezza|30))?\b/
          );


        if (match) {

          const hour =
            Number(
              match[1]
            );


          const half =
            /\b(?:alle|ore|verso|per le)\s+[01]?\d\s+e\s+mezza\b/
              .test(n);


          return fmt(
            hour * 60 +
            (half ? 30 : 0)
          );
        }


        /*
         * Risposte brevi dell'utente:
         *
         * "15"
         * "15:30"
         *
         * Il numero isolato viene accettato
         * solamente se l'intero messaggio
         * è sostanzialmente un orario.
         */

        const standalone =
          n.match(
            /^\s*(?:alle\s+)?([01]?\d|2[0-3])\s*(?:ore)?\s*$/i
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
                  servicePrice(
                    promotion
                  );


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
                    ? `prezzo: €${price}`
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
       PENDING
    ======================================================== */

    const normalizePending =
      value => {

        if (
          !value ||
          typeof value !== "object"
        ) {
          return null;
        }


        const normalized = {

          ...value,

          name:
            clean(
              value.name ||
              value.n ||
              clientName ||
              ""
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
          normalized.date &&
          !isValidDate(
            normalized.date
          )
        ) {
          normalized.date = "";
        }


        if (
          normalized.time &&
          toMinutes(
            normalized.time
          ) === null
        ) {
          normalized.time = "";
        }


        return normalized;
      };


    let pending =
      normalizePending(
        pendingAppointment
      );


    /* ========================================================
       LOCK
    ======================================================== */

    const cleanupLocks =
      () => {

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
            now - lock.createdAt >
            LOCK_TTL
          ) {
            bookingLocks.delete(
              key
            );
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


    const acquireLock =
      key => {

        cleanupLocks();


        const existing =
          bookingLocks.get(key);


        if (existing) {
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


    const releaseLock =
      key => {

        bookingLocks.delete(
          key
        );
      };


    /* ========================================================
       CHECK APPUNTAMENTO
    ======================================================== */

    const checkAppointment =
      appointment => {

        if (
          !appointment ||
          typeof appointment !== "object"
        ) {

          return {
            ok:false,
            error:
              "Dati appuntamento mancanti."
          };
        }


        const date =
          clean(
            appointment.date ||
            appointment.d
          );


        const time =
          clean(
            appointment.time ||
            appointment.t
          );


        const serviceName =
          clean(
            appointment.service ||
            appointment.s
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


        const service =
          getService(
            serviceName
          );


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
            duration,
            appointment.id ||
            ""
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
        serviceName,
        startAfter = null
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
          serviceDuration(
            service
          ),
          startAfter
        );
      };


    /* ========================================================
       ACTION POST AI
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
Sei Mavi, l'assistente AI di marketing di un'attività locale italiana.

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
                "Crea un post per l'attività."
            }
          ],

          temperature:
            0.8
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
       ACTION AVAILABILITY
    ======================================================== */

    if (
      action === "availability"
    ) {

      const date =
        (
          body.date &&
          isValidDate(
            body.date
          )
        )
          ? body.date
          : detectDate(
              message
            );


      const serviceName =
        clean(
          body.service ||
          body.serviceName ||
          findService(
            message
          )?.name ||
          ""
        );


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


      const service =
        getService(
          serviceName
        );


      if (!service) {

        return res.status(200).json({

          ok:true,

          available:false,

          availableSlots:[],

          reply:
            "Il servizio indicato non è presente tra quelli configurati."

        });
      }


      const slots =
        findSlots(
          date,
          service.name
        );


      return res.status(200).json({

        ok:true,

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
      /prenot|appunt|fissare|fissa|riserv|disponibil|orario/i
        .test(
          message
        );


    const normalizedMessage =
      norm(
        message
      );


    const cancelIntent =
      /^(annulla|annullare|cancella|cancellare|non prenotare|lascia perdere|lascia stare)\b/
        .test(
          normalizedMessage
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
       PENDING:
       DATA + SERVIZIO,
       UTENTE SCEGLIE ORARIO
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

          pendingAppointment:null,

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
       PENDING:
       MODIFICA DATA
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

          return res.status(200).json({

            ok:false,

            bookingConfirmed:false,

            requiresConfirmation:false,

            pendingAppointment:null,

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
        /^(si|sì|ok|okay|va bene|confermo|conferma|procedi|prenota|prenotiamo|esatto|corretto|corretta|certo|certamente)\b/i
          .test(
            normalizedMessage
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

            pendingAppointment:null,

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
         * CONTROLLO PREVENTIVO.
         */

        if (
          !isValidDate(
            pending.date
          ) ||
          toMinutes(
            pending.time
          ) === null
        ) {

          return res.status(200).json({

            ok:false,

            confirmed:false,

            bookingConfirmed:false,

            requiresConfirmation:false,

            pendingAppointment:null,

            reply:
              "La data o l'orario della prenotazione non sono validi."

          });
        }


        /*
         * LOCK IMMEDIATO.
         */

        if (
          !acquireLock(key)
        ) {

          return res.status(200).json({

            ok:false,

            confirmed:false,

            bookingConfirmed:false,

            requiresConfirmation:false,

            pendingAppointment:null,

            reply:
              "La prenotazione è già in fase di elaborazione. Verifica nuovamente la disponibilità."

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
           * CONTROLLO DUPLICATO:
           *
           * Un appuntamento attivo nello stesso
           * giorno e nello stesso orario blocca
           * la prenotazione indipendentemente
           * dal servizio.
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
                  ) === pending.time
                );
              }
            );


          if (duplicate) {

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
                  ? `L'orario ${pending.time} è già occupato. Per ${service.name} posso proporti: ${alternatives.join(", ")}.`
                  : `L'orario ${pending.time} è già occupato e non risultano altri orari disponibili.`

            });
          }


          /*
           * RECORD APPUNTAMENTO.
           *
           * L'API non salva nel localStorage.
           * Restituisce il record all'index.
           */

          const appointment = {

            id:
              key,

            bookingKey:
              key,

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

            duration,

            status:
              "confermato",

            createdAt:
              new Date().toISOString()

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

          releaseLock(
            key
          );
        }
      }


      /*
       * Pending presente ma nessuna
       * conferma valida.
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

        availableSlots:[],

        availableService:
          detectedService.name,

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


      return res.status(200).json({

        ok:true,

        bookingConfirmed:false,

        requiresConfirmation:false,

        availableSlots:[],

        availableDate:
          detectedDate,

        reply:
          serviceNames.length
            ? `Per quale servizio? Puoi scegliere tra: ${serviceNames.join(", ")}.`
            : "Non ci sono ancora servizi configurati."

      });
    }


    /* ========================================================
       CLIENTI
    ======================================================== */

    const clientText =
      safeClients.length
        ? safeClients
            .map(
              client => {

                const name =
                  clean(
                    client.name
                  );


                const phone =
                  clean(
                    client.phone ||
                    client.whatsapp ||
                    ""
                  );


                const email =
                  clean(
                    client.email ||
                    ""
                  );


                return [
                  name
                    ? `- ${name}`
                    : "- Cliente",

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


    /* ========================================================
       SERVIZI PER AI
    ======================================================== */

    const serviceText =
      safeServices.length
        ? safeServices
            .map(
              service => {

                const price =
                  servicePrice(
                    service
                  );


                const description =
                  clean(
                    service.description
                  );


                return [
                  `- ${clean(service.name)}`,

                  `(${serviceDuration(service)} minuti`,

                  price
                    ? `, €${price}`
                    : "",

                  `)`,

                  description
                    ? ` — ${description}`
                    : ""
                ]
                .join("");
              }
            )
            .join("\n")
        : "Nessun servizio configurato.";


    /* ========================================================
       APPUNTAMENTI PER AI
    ======================================================== */

    const appointmentText =
      safeAppointments
        .filter(
          isActiveAppointment
        )
        .map(
          appointment => {

            return [
              `- ${appointmentDate(appointment)}`,
              appointmentTime(appointment),
              `| ${appointmentName(appointment)}`,
              `| ${appointmentService(appointment)}`
            ]
            .join(" ");
          }
        )
        .join("\n") ||
      "Nessun appuntamento.";


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

                role:
                  item.role,

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

7. Se l'applicazione fornisce
   availableSlots, considera quelli
   come gli slot disponibili.

8. "oggi" significa:
   ${today}

9. "domani" significa:
   ${addDays(today,1)}

10. "dopodomani" significa:
    ${addDays(today,2)}

11. Per i giorni della settimana
    considera il prossimo giorno futuro
    corrispondente.

12. Non dire di aver salvato,
    cancellato o modificato dati
    se l'operazione non è stata
    realmente eseguita dall'applicazione.

13. Mantieni le risposte brevi,
    chiare e naturali.

14. Le promozioni scadute non devono
    essere presentate come attive.

15. Se una richiesta è ambigua,
    chiedi soltanto il dato necessario.

16. Non comunicare dati personali
    di clienti se non sono necessari
    alla richiesta dell'utente.

17. Quando parli di disponibilità,
    non inventare mai uno slot.
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
              clean(
                message ||
                topic ||
                "Ciao"
              )
          }
        ],

        temperature:
          0.4

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
      "MAVIRI /api/chat error:",
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
