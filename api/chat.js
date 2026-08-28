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

    const body = req.body || {};

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
      history = [],
      pendingAppointment = null,
      requiresConfirmation = false
    } = body;


    /* ============================================================
       OPENAI
    ============================================================ */

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });


    /* ============================================================
       FUNZIONI BASE
    ============================================================ */

    const norm = value =>
      String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");


    const toMinutes = value => {

      if (!value) return null;

      let s = String(value)
        .trim()
        .toLowerCase()
        .replace(/[.,]/g, ":");

      if (/^\d{1,2}$/.test(s)) {
        s += ":00";
      }

      const match =
        s.match(/^(\d{1,2}):(\d{2})$/);

      if (!match) return null;

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
    };


    const fmt = minutes =>
      String(Math.floor(minutes / 60)).padStart(2, "0") +
      ":" +
      String(minutes % 60).padStart(2, "0");


    const addDays = (date, amount) => {

      const d =
        new Date(date + "T12:00:00");

      d.setDate(
        d.getDate() + amount
      );

      return (
        d.getFullYear() +
        "-" +
        String(d.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(d.getDate()).padStart(2, "0")
      );
    };


    const dayName = date => {

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date || "")
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
        !/^\d{4}-\d{2}-\d{2}$/.test(date || "")
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


    /* ============================================================
       DATA ODIERNA EUROPE/ROME
    ============================================================ */

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

    const dateMap = {};

    parts.forEach(part => {

      if (part.type !== "literal") {
        dateMap[part.type] =
          part.value;
      }

    });

    const today =
      `${dateMap.year}-${dateMap.month}-${dateMap.day}`;


    /* ============================================================
       DATI SICURI
    ============================================================ */

    const safeServices =
      Array.isArray(services)
        ? services.filter(
            s =>
              s &&
              typeof s === "object" &&
              String(s.name || "").trim()
          )
        : [];


    const safePromotions =
      Array.isArray(promotions)
        ? promotions.filter(
            p =>
              p &&
              typeof p === "object"
          )
        : [];


    const safeAppointments =
      Array.isArray(appointments)
        ? appointments.filter(
            a =>
              a &&
              typeof a === "object"
          )
        : [];


    /* ============================================================
       SERVIZI
    ============================================================ */

    const getService = name => {

      const target =
        norm(name);

      if (!target) {
        return null;
      }

      return safeServices.find(
        service =>
          norm(service.name) === target
      ) || null;
    };


    const findService = text => {

      const n =
        norm(text);

      if (!n) {
        return null;
      }

      return safeServices.find(
        service => {

          const serviceName =
            norm(service.name);

          if (!serviceName) {
            return false;
          }

          if (
            n.includes(serviceName)
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
      ) || null;
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


    /* ============================================================
       PROMOZIONI
    ============================================================ */

    const validPromotions =
      safePromotions.filter(
        p => {

          if (!p.expiry) {
            return true;
          }

          return (
            String(p.expiry) >= today
          );

        }
      );


    const promotionList =
      validPromotions.length
        ? validPromotions
            .map(p => {

              const title =
                String(
                  p.title || ""
                ).trim();

              const category =
                String(
                  p.category || ""
                ).trim();

              const description =
                String(
                  p.description || ""
                ).trim();

              const price =
                p.price !== undefined &&
                p.price !== null &&
                String(p.price).trim() !== ""
                  ? `€${p.price}`
                  : "";

              const expiry =
                p.expiry
                  ? `valida fino al ${p.expiry}`
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

            })
            .join("\n")
        : "Nessuna promozione attiva.";


    /* ============================================================
       ORARI
       COMPATIBILE CON:
       NUOVO INDEX:
       {closed,start,end}
       
       FORMATO PRECEDENTE:
       {status,open,close}
    ============================================================ */

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
      .map(([key, label]) => {

        const day =
          settings?.hours?.[key];

        if (!day) {
          return `${label}: non configurato`;
        }

        const closed =
          day.closed === true ||
          day.status === "closed";

        if (closed) {
          return `${label}: Chiuso`;
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
          `${label}: ` +
          `${open} - ${close}` +
          pause
        );

      })
      .join("\n");


    /* ============================================================
       PAUSE
    ============================================================ */

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


    /* ============================================================
       APPUNTAMENTO
       SUPPORTA:
       NUOVO:
       {name,service,date,time}
       
       VECCHIO:
       {n,s,d,t}
    ============================================================ */

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


    /* ============================================================
       DISPONIBILITÀ
    ============================================================ */

    const free =
      (
        date,
        time,
        duration
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


    /* ============================================================
       SLOT DISPONIBILI
    ============================================================ */

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


    /* ============================================================
       DATA
    ============================================================ */

    const detectDate = text => {

      const n =
        norm(text);

      /*
       * IMPORTANTE:
       * dopodomani DEVE essere controllato
       * prima di domani.
       */

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

      if (iso) {
        return iso[1];
      }

      const numeric =
        n.match(
          /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](20\d{2}))?\b/
        );

      if (numeric) {

        const year =
          numeric[3] ||
          today.slice(0, 4);

        const month =
          Number(numeric[2]);

        const day =
          Number(numeric[1]);

        if (
          month >= 1 &&
          month <= 12 &&
          day >= 1 &&
          day <= 31
        ) {
          return (
            year +
            "-" +
            String(month).padStart(2, "0") +
            "-" +
            String(day).padStart(2, "0")
          );
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

      for (
        const [name, target]
        of Object.entries(weekdays)
      ) {

        if (
          n.includes(name)
        ) {

          const current =
            new Date(
              today +
              "T12:00:00"
            ).getDay();

          let diff =
            target - current;

          if (diff <= 0) {
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


    /* ============================================================
       ORARIO
    ============================================================ */

    const detectTime = text => {

      const n =
        norm(text);

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
       * Supporto per:
       * "15"
       * "alle 15"
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


    /* ============================================================
       DATI PRENOTAZIONE
    ============================================================ */

    const normalizePending =
      pending => {

        if (
          !pending ||
          typeof pending !== "object"
        ) {
          return null;
        }

        const date =
          pending.date ||
          pending.d ||
          "";

        const time =
          pending.time ||
          pending.t ||
          "";

        const service =
          pending.service ||
          pending.s ||
          "";

        const name =
          pending.name ||
          pending.n ||
          clientName ||
          "";

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


    /* ============================================================
       CONTROLLO PRENOTAZIONE
    ============================================================ */

    const checkAppointment =
      appointment => {

        if (!appointment) {
          return {
            ok: false,
            error:
              "Dati appuntamento mancanti."
          };
        }

        const date =
          appointment.date;

        const time =
          appointment.time;

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

        if (!time) {
          return {
            ok: false,
            error:
              "Orario dell'appuntamento mancante."
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


    /* ============================================================
       RICHIESTA SLOT
    ============================================================ */

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

        const duration =
          serviceDuration(
            service
          );

        return available(
          date,
          duration
        );
      };


    /* ============================================================
       AZIONE POST AI
    ============================================================ */

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
Sei un esperto di social media marketing per attività locali italiane.

Devi creare un post pronto per essere pubblicato.

ATTIVITÀ:
${business || "Attività locale"}

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
${JSON.stringify(selectedContent || {}, null, 2)}

SERVIZI DISPONIBILI:
${JSON.stringify(safeServices, null, 2)}

PROMOZIONI:
${promotionList}

REGOLE:
- Scrivi in italiano.
- Non inventare prezzi, promozioni o servizi.
- Usa solo informazioni fornite.
- Adatta lunghezza e stile alla piattaforma.
- Il testo deve essere concreto e utilizzabile.
- Evita introduzioni del tipo "Ecco il post".
- Se opportuno usa una call to action.
- Gli hashtag devono essere pertinenti.
- Non usare informazioni non presenti nei dati.
`;

      const completion =
        await openai.chat.completions.create({
          model: "gpt-5.4-mini",
          messages: [
            {
              role: "system",
              content:
                systemPrompt
            },
            {
              role: "user",
              content:
                topic ||
                "Crea un post promozionale per l'attività."
            }
          ],
          temperature: 0.8
        });

      const reply =
        completion
          ?.choices?.[0]
          ?.message
          ?.content
          ?.trim() || "";

      if (!reply) {
        return res.status(500).json({
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


    /* ============================================================
       RICHIESTA DISPONIBILITÀ DIRETTA
    ============================================================ */

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
          ok: true,
          reply:
            "Per verificare la disponibilità indicami il giorno."
        });
      }

      if (!serviceName) {

        return res.status(200).json({
          ok: true,
          reply:
            "Per verificare gli orari indicami anche il servizio."
        });
      }

      const slots =
        findSlots(
          date,
          serviceName
        );

      if (!slots.length) {

        return res.status(200).json({
          ok: true,
          available: false,
          date,
          slots: [],
          reply:
            `Non risultano orari disponibili per ${serviceName} ${italianDate(date)}.`
        });
      }

      return res.status(200).json({
        ok: true,
        available: true,
        date,
        service: serviceName,
        slots,
        reply:
          `Per ${serviceName}, ${italianDate(date)}, sono disponibili: ${slots.join(", ")}.`
      });
    }


    /* ============================================================
       CONFERMA PRENOTAZIONE
    ============================================================ */

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
          reply: check.error,
          error: check.error
        });
      }

      /*
       * RICONTROLLO FINALE.
       *
       * Il controllo viene eseguito nuovamente
       * prima di confermare.
       */

      const finalCheck =
        checkAppointment({
          date: check.date,
          time: check.time,
          service:
            check.service.name
        });

      if (!finalCheck.ok) {

        return res.status(200).json({
          ok: false,
          bookingConfirmed: false,
          reply:
            finalCheck.error,
          error:
            finalCheck.error
        });
      }

      return res.status(200).json({
        ok: true,
        bookingConfirmed: true,
        confirmed: true,
        pendingAppointment: {
          name:
            pending.name ||
            clientName ||
            "",
          service:
            check.service.name,
          date:
            check.date,
          time:
            check.time,
          duration:
            check.duration
        },
        reply:
          `Appuntamento confermato per ${pending.name || clientName || "il cliente"} il ${italianDate(check.date)} alle ${check.time} per ${check.service.name}.`
      });
    }


    /* ============================================================
       ASSISTENTE AI
    ============================================================ */

    const detectedDate =
      detectDate(message);

    const detectedTime =
      detectTime(message);

    const detectedService =
      findService(message);


    /* ============================================================
       PRENOTAZIONE RILEVATA
    ============================================================ */

    const bookingIntent =
      /prenot|appunt|fissare|fissa|riserv|disponibil/i
        .test(message);


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
          slots.slice(0, 6);

        return res.status(200).json({
          ok: true,
          bookingConfirmed: false,
          available: false,
          date: detectedDate,
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

      const pendingBooking = {
        name:
          clientName || "",
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
        bookingConfirmed: false,
        requiresConfirmation: true,
        pendingAppointment:
          pendingBooking,
        reply:
          `Ho verificato la disponibilità. ${detectedService.name} è disponibile ${italianDate(detectedDate)} alle ${detectedTime}. Confermi la prenotazione?`
      });
    }


    /* ============================================================
       SELEZIONE SERVIZIO + DATA
    ============================================================ */

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
          bookingConfirmed: false,
          available: false,
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
        bookingConfirmed: false,
        available: true,
        date:
          detectedDate,
        service:
          detectedService.name,
        slots,
        reply:
          `Per ${detectedService.name} ${italianDate(detectedDate)} sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`
      });
    }


    /* ============================================================
       AI GENERALE
    ============================================================ */

    const serviceText =
      safeServices.length
        ? safeServices
            .map(
              service =>
                `- ${service.name} (${serviceDuration(service)} minuti${service.price !== undefined ? `, €${service.price}` : ""})`
            )
            .join("\n")
        : "Nessun servizio configurato.";


    const appointmentText =
      safeAppointments.length
        ? safeAppointments
            .map(
              appointment =>
                `- ${appointmentDate(appointment)} ${appointmentTime(appointment)} ${appointmentName(appointment)} ${appointmentService(appointment)}`
            )
            .join("\n")
        : "Nessun appuntamento.";


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


    const systemPrompt = `
Sei l'assistente AI di un'attività locale italiana.

NOME ATTIVITÀ:
${business || settings?.name || "Attività locale"}

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

REGOLE IMPORTANTI:

1. Rispondi sempre in italiano.

2. Usa esclusivamente i dati forniti.

3. Non inventare servizi, prezzi,
   promozioni, orari o disponibilità.

4. Se l'utente chiede un appuntamento,
   verifica sempre:
   - servizio
   - data
   - orario
   - durata
   - apertura
   - pausa
   - sovrapposizioni.

5. Non dichiarare mai un appuntamento
   confermato senza una richiesta esplicita
   di conferma da parte dell'utente.

6. Se mancano dati necessari,
   chiedili in modo semplice.

7. Per date relative usa come riferimento
   la data odierna ${today}.

8. "domani" significa:
   ${addDays(today, 1)}

9. "dopodomani" significa:
   ${addDays(today, 2)}

10. Se l'utente chiede disponibilità,
    usa i dati reali ricevuti dall'app.

11. Non dire di aver effettuato azioni
    che non sono state realmente eseguite.

12. Mantieni risposte brevi e chiare,
    adatte a una chat.

13. Se una promozione è scaduta,
    non proporla.
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


    /* ============================================================
       RISPOSTA
    ============================================================ */

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
