import OpenAI from "openai";

/* ============================================================
   CONFIGURAZIONE
============================================================ */

const LOCK_TTL = 15000;

/*
 * Lock in memoria.
 *
 * Serve a proteggere contro richieste contemporanee
 * sullo stesso slot all'interno della stessa istanza.
 *
 * Il controllo definitivo viene comunque ripetuto
 * prima della conferma.
 */
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


    /* ==========================================================
       OPENAI
    ========================================================== */

    const openai =
      new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY
      });


    /* ==========================================================
       FUNZIONI BASE
    ========================================================== */

    const norm = value =>
      String(value ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");


    const clean = value =>
      String(value ?? "").trim();


    const toMinutes = value => {

      if (
        value === null ||
        value === undefined ||
        value === ""
      ) {
        return null;
      }

      let s =
        String(value)
          .trim()
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
        !Number.isFinite(minutes)
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


    /* ==========================================================
       DATE
    ========================================================== */

    const isValidDate = date => {

      const value =
        clean(date);

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
          value
        )
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

      const test =
        new Date(
          year,
          month - 1,
          day,
          12,
          0,
          0
        );

      return (
        test.getFullYear() === year &&
        test.getMonth() === month - 1 &&
        test.getDate() === day
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


    const dayName = date => {

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


    const italianDate = date => {

      if (
        !isValidDate(date)
      ) {
        return date || "";
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


    /* ==========================================================
       DATA ODIERNA EUROPE/ROME
    ========================================================== */

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

    const dateMap = {};

    parts.forEach(
      part => {

        if (
          part.type !== "literal"
        ) {
          dateMap[
            part.type
          ] = part.value;
        }

      }
    );

    const today =
      `${dateMap.year}-${dateMap.month}-${dateMap.day}`;


    /* ==========================================================
       RILEVAMENTO DATA
       DEVE ESSERE DEFINITO PRIMA DELLE ACTION
    ========================================================== */

    const detectDate = text => {

      const n =
        norm(text);

      if (!n) {
        return null;
      }


      /* DOPODOMANI PRIMA DI DOMANI */

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


      /* DATA ISO */

      const iso =
        n.match(
          /\b(20\d{2}-\d{2}-\d{2})\b/
        );

      if (iso) {

        if (
          isValidDate(
            iso[1]
          )
        ) {
          return iso[1];
        }

      }


      /* DATA ITALIANA */

      const numeric =
        n.match(
          /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b/
        );

      if (numeric) {

        const year =
          numeric[3] ||
          today.slice(0, 4);

        const day =
          Number(
            numeric[1]
          );

        const month =
          Number(
            numeric[2]
          );

        const result =
          `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

        if (
          isValidDate(result)
        ) {
          return result;
        }

      }


      /* GIORNI DELLA SETTIMANA */

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
          today +
          "T12:00:00"
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
            target -
            current;

          /*
           * Se oggi è il giorno indicato,
           * interpretiamo la richiesta come
           * prossimo giorno della settimana.
           */

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


    /* ==========================================================
       RILEVAMENTO ORARIO
    ========================================================== */

    const detectTime = text => {

      const n =
        norm(text);

      if (!n) {
        return null;
      }


      /* 15:30 / 15.30 / 15,30 */

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


      /* alle 15 / ore 15 / verso 15 / per le 15 */

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
       * Utilizzato per permettere:
       * "alle 15"
       * "15"
       * "ore 15"
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
    };


    /* ==========================================================
       DATI SICURI
    ========================================================== */

    const safeServices =
      Array.isArray(services)
        ? services.filter(
            service =>
              service &&
              typeof service === "object" &&
              clean(
                service.name
              )
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


    /* ==========================================================
       SERVIZI
    ========================================================== */

    const getService = name => {

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
        ) || null
      );
    };


    const findService = text => {

      const n =
        norm(text);

      if (!n) {
        return null;
      }

      return (
        safeServices.find(
          service => {

            const serviceName =
              norm(
                service.name
              );

            if (!serviceName) {
              return false;
            }

            if (
              n.includes(
                serviceName
              )
            ) {
              return true;
            }

            const words =
              serviceName
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


    const serviceDuration =
      service => {

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
          ? duration
          : 30;
      };


    /* ==========================================================
       PROMOZIONI
    ========================================================== */

    const validPromotions =
      safePromotions.filter(
        promotion => {

          if (
            !promotion.expiry
          ) {
            return true;
          }

          return (
            String(
              promotion.expiry
            ) >= today
          );

        }
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

                const expiry =
                  promotion.expiry
                    ? `valida fino al ${promotion.expiry}`
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
                  expiry
                ]
                  .filter(Boolean)
                  .join(" | ");

              }
            )
            .join("\n")
        : "Nessuna promozione attiva.";


    /* ==========================================================
       ORARI
       COMPATIBILE CON:
       NUOVO:
       {closed,start,end}

       VECCHIO:
       {status,open,close}
    ========================================================== */

    const getDaySettings = date => {

      const day =
        settings?.hours?.[
          dayName(date)
        ];

      if (!day) {
        return null;
      }

      const closed =
        day.closed === true ||
        day.status === "closed";

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
            settings?.hours?.[
              key
            ];

          if (!day) {
            return (
              `${label}: non configurato`
            );
          }

          const closed =
            day.closed === true ||
            day.status === "closed";

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


    /* ==========================================================
       PAUSE
    ========================================================== */

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


    /* ==========================================================
       APPUNTAMENTI
       COMPATIBILITÀ NUOVO/VECCHIO FORMATO
    ========================================================== */

    const appointmentDate =
      appointment =>
        appointment?.date ||
        appointment?.d ||
        "";


    const appointmentTime =
      appointment =>
        appointment?.time ||
        appointment?.t ||
        "";


    const appointmentService =
      appointment =>
        appointment?.service ||
        appointment?.s ||
        "";


    const appointmentName =
      appointment =>
        appointment?.name ||
        appointment?.n ||
        "";


    const appointmentStatus =
      appointment =>
        norm(
          appointment?.status ||
          appointment?.state ||
          ""
        );


    const isCancelled =
      appointment =>
        [
          "cancelled",
          "canceled",
          "annullato",
          "annullata"
        ].includes(
          appointmentStatus(
            appointment
          )
        );


    /* ==========================================================
       CLIENTI
    ========================================================== */

    const clientField =
      (
        client,
        fields
      ) => {

        for (
          const field of fields
        ) {

          if (
            client?.[field] !==
              undefined &&
            client?.[field] !==
              null &&
            clean(
              client[field]
            )
          ) {
            return clean(
              client[field]
            );
          }

        }

        return "";
      };


    const findClient =
      name => {

        const target =
          norm(name);

        if (!target) {
          return null;
        }

        return (
          safeClients.find(
            client => {

              const clientName =
                clientField(
                  client,
                  [
                    "name",
                    "fullName",
                    "nome"
                  ]
                );

              return (
                norm(
                  clientName
                ) === target
              );

            }
          ) || null
        );
      };


    /* ==========================================================
       DISPONIBILITÀ
    ========================================================== */

    const free =
      (
        date,
        time,
        duration
      ) => {

        if (
          !isValidDate(date)
        ) {
          return false;
        }

        const day =
          getDaySettings(
            date
          );

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
              isCancelled(
                appointment
              )
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

            const existingTime =
              toMinutes(
                appointmentTime(
                  appointment
                )
              );

            if (
              existingTime === null
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
              existingTime +
              existingDuration;

            return (
              start < existingEnd &&
              end > existingTime
            );
          }
        );
      };


    /* ==========================================================
       SLOT DISPONIBILI
    ========================================================== */

    const available =
      (
        date,
        duration,
        startAfter = null,
        endBefore = null
      ) => {

        const day =
          getDaySettings(
            date
          );

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
      };


    /* ==========================================================
       LOCK PRENOTAZIONE
    ========================================================== */

    const cleanupLocks = () => {

      const now =
        Date.now();

      for (
        const [
          key,
          value
        ]
        of bookingLocks.entries()
      ) {

        if (
          now - value >=
          LOCK_TTL
        ) {
          bookingLocks.delete(
            key
          );
        }
      }
    };


    /*
     * Il lock è sullo SLOT.
     *
     * Non viene usato il nome cliente,
     * perché due clienti diversi non possono
     * occupare contemporaneamente lo stesso slot.
     */

    const bookingKey =
      appointment =>
        [
          clean(
            appointment?.date
          ),
          clean(
            appointment?.time
          )
        ].join("|");


    const acquireLock =
      key => {

        cleanupLocks();

        if (
          bookingLocks.has(key)
        ) {
          return false;
        }

        bookingLocks.set(
          key,
          Date.now()
        );

        return true;
      };


    const releaseLock =
      key => {

        bookingLocks.delete(
          key
        );
      };


    /* ==========================================================
       CONTROLLO APPUNTAMENTO
    ========================================================== */

    const checkAppointment =
      appointment => {

        if (
          !appointment ||
          typeof appointment !==
            "object"
        ) {
          return {
            ok: false,
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


        if (!date) {
          return {
            ok: false,
            error:
              "Data dell'appuntamento mancante."
          };
        }


        if (
          !isValidDate(date)
        ) {
          return {
            ok: false,
            error:
              "La data dell'appuntamento non è valida."
          };
        }


        if (!time) {
          return {
            ok: false,
            error:
              "Orario dell'appuntamento mancante."
          };
        }


        if (
          toMinutes(time) === null
        ) {
          return {
            ok: false,
            error:
              "L'orario dell'appuntamento non è valido."
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


    /* ==========================================================
       NORMALIZZAZIONE PENDING
    ========================================================== */

    const normalizePending =
      pending => {

        if (
          !pending ||
          typeof pending !==
            "object"
        ) {
          return null;
        }

        const date =
          clean(
            pending.date ||
            pending.d
          );

        const time =
          clean(
            pending.time ||
            pending.t
          );

        const service =
          clean(
            pending.service ||
            pending.s
          );

        const name =
          clean(
            pending.name ||
            pending.n ||
            clientName
          );

        return {
          ...pending,
          date,
          time,
          service,
          name
        };
      };


    const pending =
      normalizePending(
        pendingAppointment
      );


    /* ==========================================================
       RICERCA SLOT
    ========================================================== */

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
          serviceDuration(
            service
          )
        );
      };


    /* ==========================================================
       ACTION: POST AI
    ========================================================== */

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


      const systemPrompt = `
Sei un esperto di social media marketing
per attività locali italiane.

Devi creare un post pronto per essere pubblicato.

ATTIVITÀ:
${business || settings?.name || "Attività locale"}

PIATTAFORMA:
${platformLabel}

TIPO CONTENUTO:
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

SERVIZI DISPONIBILI:
${JSON.stringify(
  safeServices,
  null,
  2
)}

PROMOZIONI ATTIVE:
${promotionList}

REGOLE:
- Scrivi in italiano.
- Non inventare prezzi.
- Non inventare servizi.
- Non inventare promozioni.
- Usa solo le informazioni fornite.
- Adatta lunghezza e stile alla piattaforma.
- Il testo deve essere concreto e utilizzabile.
- Evita introduzioni come "Ecco il post".
- Usa una call to action quando appropriato.
- Usa hashtag pertinenti quando appropriato.
- Non usare informazioni non presenti nei dati.
`;

      const completion =
        await openai.chat.completions.create({

          model:
            "gpt-5.4-mini",

          messages: [
            {
              role:
                "system",
              content:
                systemPrompt
            },
            {
              role:
                "user",
              content:
                topic ||
                "Crea un post promozionale per l'attività."
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
          ok: false,
          error:
            "L'AI non ha restituito alcun contenuto."
        });
      }


      return res.status(200).json({
        ok: true,
        reply,
        post: reply,
        meta: {
          platform,
          contentType,
          advanced
        }
      });
    }


    /* ==========================================================
       ACTION: AVAILABILITY
    ========================================================== */

    if (
      action === "availability"
    ) {

      const date =
        body.date ||
        detectDate(message);

      const serviceName =
        body.service ||
        body.serviceName ||
        findService(
          message
        )?.name ||
        "";


      if (!date) {

        return res.status(200).json({
          ok: true,
          available: false,
          reply:
            "Per verificare la disponibilità indicami il giorno."
        });
      }


      if (
        !isValidDate(date)
      ) {

        return res.status(200).json({
          ok: true,
          available: false,
          reply:
            "La data indicata non è valida."
        });
      }


      if (!serviceName) {

        return res.status(200).json({
          ok: true,
          available: false,
          reply:
            "Per verificare gli orari indicami anche il servizio."
        });
      }


      const service =
        getService(
          serviceName
        );


      if (!service) {

        return res.status(200).json({
          ok: true,
          available: false,
          reply:
            "Il servizio indicato non risulta configurato."
        });
      }


      const slots =
        findSlots(
          date,
          service.name
        );


      if (!slots.length) {

        return res.status(200).json({
          ok: true,
          available: false,
          date,
          service:
            service.name,
          slots: [],
          reply:
            `Non risultano orari disponibili per ${service.name} ${italianDate(date)}.`
        });
      }


      return res.status(200).json({
        ok: true,
        available: true,
        date,
        service:
          service.name,
        slots,
        reply:
          `Per ${service.name}, ${italianDate(date)}, sono disponibili: ${slots.join(", ")}.`
      });
    }


    /* ==========================================================
       CONFERMA PRENOTAZIONE
    ========================================================== */

    if (
      requiresConfirmation === true &&
      pending
    ) {

      const check =
        checkAppointment(
          pending
        );


      if (!check.ok) {

        return res.status(200).json({
          ok: false,
          bookingConfirmed: false,
          requiresConfirmation: false,
          reply:
            check.error,
          error:
            check.error
        });
      }


      const normalizedBooking = {

        name:
          clean(
            pending.name ||
            clientName
          ),

        service:
          check.service.name,

        date:
          check.date,

        time:
          check.time,

        duration:
          check.duration
      };


      const key =
        bookingKey(
          normalizedBooking
        );


      if (
        !acquireLock(key)
      ) {

        return res.status(200).json({

          ok: false,

          bookingConfirmed:
            false,

          requiresConfirmation:
            false,

          available:
            false,

          reply:
            "Questa prenotazione è già in fase di conferma. Riprova tra qualche secondo."

        });
      }


      try {

        /*
         * SECONDO CONTROLLO DOPO IL LOCK.
         */

        const finalCheck =
          checkAppointment(
            normalizedBooking
          );


        if (!finalCheck.ok) {

          return res.status(200).json({

            ok: false,

            bookingConfirmed:
              false,

            requiresConfirmation:
              false,

            available:
              false,

            reply:
              finalCheck.error,

            error:
              finalCheck.error

          });
        }


        /*
         * CONTROLLO ESPLICITO FINALE.
         */

        const stillFree =
          free(
            finalCheck.date,
            finalCheck.time,
            finalCheck.duration
          );


        if (!stillFree) {

          return res.status(200).json({

            ok: false,

            bookingConfirmed:
              false,

            requiresConfirmation:
              false,

            available:
              false,

            date:
              finalCheck.date,

            time:
              finalCheck.time,

            service:
              finalCheck.service.name,

            reply:
              `L'orario ${finalCheck.time} non è più disponibile.`

          });
        }


        /*
         * ID DETERMINISTICO.
         */

        const id =
          [
            finalCheck.date,
            finalCheck.time,
            norm(
              finalCheck.service.name
            ),
            norm(
              normalizedBooking.name
            )
          ].join("|");


        const confirmedAppointment = {

          id,

          name:
            normalizedBooking.name,

          service:
            finalCheck.service.name,

          date:
            finalCheck.date,

          time:
            finalCheck.time,

          duration:
            finalCheck.duration,

          status:
            "confirmed"

        };


        return res.status(200).json({

          ok: true,

          bookingConfirmed:
            true,

          confirmed:
            true,

          requiresConfirmation:
            false,

          available:
            true,

          pendingAppointment:
            confirmedAppointment,

          appointment:
            confirmedAppointment,

          client: {

            name:
              normalizedBooking.name

          },

          reply:
            `Appuntamento confermato per ${normalizedBooking.name || "il cliente"} il ${italianDate(finalCheck.date)} alle ${finalCheck.time} per ${finalCheck.service.name}.`

        });

      } finally {

        releaseLock(
          key
        );
      }
    }


    /* ==========================================================
       DATI CLIENTE
    ========================================================== */

    const clientNameFromMessage =
      clean(
        clientName
      );


    const existingClient =
      findClient(
        clientNameFromMessage
      );


    /* ==========================================================
       INTENTO PRENOTAZIONE
    ========================================================== */

    const bookingIntent =
      /prenot|appunt|fissare|fissa|riserv|disponibil/i
        .test(
          message
        );


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


    /* ==========================================================
       PRENOTAZIONE COMPLETA
    ========================================================== */

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

        const slots =
          available(
            detectedDate,
            duration
          );


        const alternatives =
          slots.slice(
            0,
            6
          );


        return res.status(200).json({

          ok: true,

          bookingConfirmed:
            false,

          available:
            false,

          date:
            detectedDate,

          service:
            detectedService.name,

          requestedTime:
            detectedTime,

          alternatives,

          slots:
            alternatives,

          reply:
            alternatives.length
              ? `L'orario ${detectedTime} non è disponibile. Per ${detectedService.name} ${italianDate(detectedDate)} posso proporti: ${alternatives.join(", ")}.`
              : `L'orario ${detectedTime} non è disponibile e non risultano altri orari liberi per ${detectedService.name} ${italianDate(detectedDate)}.`

        });
      }


      const pendingBooking = {

        name:
          clientNameFromMessage,

        service:
          detectedService.name,

        date:
          detectedDate,

        time:
          detectedTime,

        duration

      };


      return res.status(200).json({

        ok: true,

        bookingConfirmed:
          false,

        requiresConfirmation:
          true,

        pendingAppointment:
          pendingBooking,

        appointment:
          pendingBooking,

        client:
          existingClient
            ? {
                ...existingClient
              }
            : {
                name:
                  clientNameFromMessage
              },

        reply:
          `Ho verificato la disponibilità. ${detectedService.name} è disponibile ${italianDate(detectedDate)} alle ${detectedTime}. Confermi la prenotazione?`

      });
    }


    /* ==========================================================
       SERVIZIO + DATA SENZA ORARIO
    ========================================================== */

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


      if (!slots.length) {

        return res.status(200).json({

          ok: true,

          bookingConfirmed:
            false,

          available:
            false,

          date:
            detectedDate,

          service:
            detectedService.name,

          slots: [],

          reply:
            `Non risultano disponibilità per ${detectedService.name} ${italianDate(detectedDate)}.`

        });
      }


      return res.status(200).json({

        ok: true,

        bookingConfirmed:
          false,

        available:
          true,

        date:
          detectedDate,

        service:
          detectedService.name,

        slots,

        reply:
          `Per ${detectedService.name} ${italianDate(detectedDate)} sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`

      });
    }


    /* ==========================================================
       DATA + ORARIO MA SERVIZIO MANCANTE
    ========================================================== */

    if (
      bookingIntent &&
      detectedDate &&
      detectedTime &&
      !detectedService
    ) {

      return res.status(200).json({

        ok: true,

        bookingConfirmed:
          false,

        requiresConfirmation:
          false,

        date:
          detectedDate,

        time:
          detectedTime,

        reply:
          "Ho giorno e orario. Indicami quale servizio vuoi prenotare."

      });
    }


    /* ==========================================================
       SERVIZIO MA DATA MANCANTE
    ========================================================== */

    if (
      bookingIntent &&
      detectedService &&
      !detectedDate
    ) {

      return res.status(200).json({

        ok: true,

        bookingConfirmed:
          false,

        requiresConfirmation:
          false,

        service:
          detectedService.name,

        reply:
          `Per ${detectedService.name} indicami il giorno in cui vuoi venire.`

      });
    }


    /* ==========================================================
       ORARIO MA DATA/SERVIZIO MANCANTI
    ========================================================== */

    if (
      bookingIntent &&
      detectedTime &&
      !detectedDate
    ) {

      return res.status(200).json({

        ok: true,

        bookingConfirmed:
          false,

        requiresConfirmation:
          false,

        time:
          detectedTime,

        reply:
          `Hai indicato le ${detectedTime}. Per verificare la disponibilità mi servono anche il giorno e il servizio.`

      });
    }


    /* ==========================================================
       CONTROLLO SPECIFICO DISPONIBILITÀ
    ========================================================== */

    if (
      detectedDate &&
      detectedTime &&
      detectedService &&
      !bookingIntent
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


      if (isFree) {

        return res.status(200).json({

          ok: true,

          available:
            true,

          bookingConfirmed:
            false,

          date:
            detectedDate,

          time:
            detectedTime,

          service:
            detectedService.name,

          reply:
            `Sì, ${detectedService.name} è disponibile ${italianDate(detectedDate)} alle ${detectedTime}.`

        });
      }


      const alternatives =
        available(
          detectedDate,
          duration
        ).slice(
          0,
          6
        );


      return res.status(200).json({

        ok: true,

        available:
          false,

        bookingConfirmed:
          false,

        date:
          detectedDate,

        time:
          detectedTime,

        service:
          detectedService.name,

        alternatives,

        reply:
          alternatives.length
            ? `No, le ${detectedTime} non è disponibile. Per ${detectedService.name} posso proporti: ${alternatives.join(", ")}.`
            : `No, le ${detectedTime} non è disponibile e non risultano altri orari liberi quel giorno.`

      });
    }


    /* ==========================================================
       DATI PER AI GENERALE
    ========================================================== */

    const serviceText =
      safeServices.length
        ? safeServices
            .map(
              service => {

                const price =
                  service.price !==
                    undefined &&
                  service.price !==
                    null &&
                  clean(
                    service.price
                  ) !== ""
                    ? `, €${service.price}`
                    : "";

                return (
                  `- ${service.name} ` +
                  `(${serviceDuration(service)} minuti${price})`
                );
              }
            )
            .join("\n")
        : "Nessun servizio configurato.";


    const appointmentText =
      safeAppointments.length
        ? safeAppointments
            .filter(
              appointment =>
                !isCancelled(
                  appointment
                )
            )
            .map(
              appointment =>
                `- ${appointmentDate(appointment)} ${appointmentTime(appointment)} ${appointmentName(appointment)} ${appointmentService(appointment)}`
            )
            .join("\n")
        : "Nessun appuntamento.";


    const clientText =
      existingClient
        ? JSON.stringify(
            {
              name:
                clientField(
                  existingClient,
                  [
                    "name",
                    "fullName",
                    "nome"
                  ]
                ),

              phone:
                clientField(
                  existingClient,
                  [
                    "phone",
                    "telefono"
                  ]
                ),

              whatsapp:
                clientField(
                  existingClient,
                  [
                    "whatsapp",
                    "whatsApp"
                  ]
                ),

              email:
                clientField(
                  existingClient,
                  [
                    "email",
                    "mail"
                  ]
                ),

              notes:
                clientField(
                  existingClient,
                  [
                    "notes",
                    "note",
                    "internalNotes"
                  ]
                )
            },
            null,
            2
          )
        : "Nessuna scheda cliente identificata.";


    /* ==========================================================
       STORICO CHAT
    ========================================================== */

    const historyMessages =
      Array.isArray(history)
        ? history
            .slice(-12)
            .filter(
              item =>
                item &&
                (
                  item.role ===
                    "user" ||
                  item.role ===
                    "assistant"
                )
            )
            .map(
              item => ({
                role:
                  item.role,

                content:
                  String(
                    item.content ||
                    item.message ||
                    ""
                  )
              })
            )
            .filter(
              item =>
                item.content.trim()
            )
        : [];


    /* ==========================================================
       SYSTEM PROMPT
    ========================================================== */

    const systemPrompt = `
Sei Mavi, l'assistente AI di Maviri
per un'attività locale italiana.

NOME ATTIVITÀ:
${business ||
  settings?.name ||
  "Attività locale"}

DATA ODIERNA:
${today}

ORARI:
${openingHours}

SERVIZI:
${serviceText}

PROMOZIONI ATTIVE:
${promotionList}

APPUNTAMENTI:
${appointmentText}

DATI CLIENTE IDENTIFICATO:
${clientText}

REGOLE IMPORTANTI:

1. Rispondi sempre in italiano.

2. Usa esclusivamente i dati forniti
   dall'applicazione.

3. Non inventare:
   - servizi
   - prezzi
   - promozioni
   - orari
   - disponibilità
   - appuntamenti
   - dati del cliente.

4. Se l'utente chiede un appuntamento,
   devono essere verificati:
   - servizio
   - data
   - orario
   - durata
   - apertura
   - pausa
   - sovrapposizioni.

5. Non dichiarare mai un appuntamento
   confermato se non è stata ricevuta
   una conferma esplicita dell'utente
   e se il backend non ha restituito
   bookingConfirmed=true.

6. Se mancano informazioni necessarie,
   chiedile in modo semplice.

7. Per le date relative usa come riferimento:
   ${today}

8. "domani" significa:
   ${addDays(today, 1)}

9. "dopodomani" significa:
   ${addDays(today, 2)}

10. Se l'utente chiede disponibilità,
    utilizza i dati reali ricevuti
    dall'applicazione.

11. Non dire mai di aver salvato,
    modificato, cancellato o spostato
    un appuntamento se l'azione non è
    stata realmente eseguita.

12. Mantieni le risposte brevi,
    chiare e naturali.

13. Se una promozione è scaduta,
    non proporla.

14. Se un cliente è presente nei dati,
    puoi usare esclusivamente le informazioni
    contenute nella sua scheda.

15. Non esporre dati interni non necessari
    alla richiesta.

16. Non inventare disponibilità:
    quando la disponibilità non è stata
    verificata dai controlli applicativi,
    non dichiararla come certa.

17. In caso di dubbio sui dati,
    chiedi all'utente invece di inventare.
`;


    /* ==========================================================
       AI GENERALE
    ========================================================== */

    const completion =
      await openai.chat.completions.create({

        model:
          "gpt-5.4-mini",

        messages: [

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
      "Non ho ricevuto una risposta dall'AI.";


    /* ==========================================================
       RISPOSTA GENERALE
    ========================================================== */

    return res.status(200).json({

      ok: true,

      reply,

      bookingConfirmed:
        false,

      requiresConfirmation:
        false

    });


  } catch (error) {

    console.error(
      "API /api/chat error:",
      error
    );


    return res.status(500).json({

      ok: false,

      error:
        error?.message ||
        "Errore interno del server."

    });

  }

}
