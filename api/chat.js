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

      const match = s.match(/^(\d{1,2}):(\d{2})$/);

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


    const dayName = date => {

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
      ][
        new Date(date + "T12:00:00").getDay()
      ];
    };


    const addDays = (date, amount) => {

      const d = new Date(date + "T12:00:00");

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


    const italianDate = date => {

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
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
        dateMap[part.type] = part.value;
      }

    });

    const today =
      `${dateMap.year}-${dateMap.month}-${dateMap.day}`;


    /* ============================================================
       SERVIZI
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


    const getService = name => {

      const target = norm(name);

      return safeServices.find(
        service =>
          norm(service.name) === target
      ) || null;
    };


    const findService = text => {

      const n = norm(text);

      return safeServices.find(service => {

        const serviceName =
          norm(service.name);

        if (!serviceName) {
          return false;
        }

        if (n.includes(serviceName)) {
          return true;
        }

        const words =
          serviceName
            .split(/\s+/)
            .filter(Boolean);

        return (
          words.length > 0 &&
          words.every(
            word => n.includes(word)
          )
        );

      }) || null;
    };


    /* ============================================================
       PROMOZIONI
    ============================================================ */

    const safePromotions =
      Array.isArray(promotions)
        ? promotions.filter(
            p =>
              p &&
              typeof p === "object" &&
              (
                String(p.title || "").trim() ||
                String(p.description || "").trim()
              )
          )
        : [];


    const validPromotions =
      safePromotions.filter(p => {

        if (!p.expiry) {
          return true;
        }

        return (
          String(p.expiry) >= today
        );

      });


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
                title ? `- ${title}` : "",
                category ? `categoria: ${category}` : "",
                description ? `descrizione: ${description}` : "",
                price ? `prezzo: ${price}` : "",
                expiry
              ]
                .filter(Boolean)
                .join(" | ");

            })
            .join("\n")
        : "Nessuna promozione attiva.";


    /* ============================================================
       ORARI
    ============================================================ */

    const daySettings =
      date =>
        settings?.hours?.[
          dayName(date)
        ] || null;


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

        const open =
          day.open || "";

        const close =
          day.close || "";

        const pause =
          day.breakStart &&
          day.breakEnd
            ? ` (pausa ${day.breakStart}-${day.breakEnd})`
            : "";

        return `${label}: ${open} - ${close}${pause}`;

      })
      .join("\n");


    /* ============================================================
       CONTROLLO PAUSA
    ============================================================ */

    const breakOverlap =
      (start, end, day) => {

        const breakStart =
          toMinutes(day?.breakStart);

        const breakEnd =
          toMinutes(day?.breakEnd);

        return (
          breakStart !== null &&
          breakEnd !== null &&
          breakStart < breakEnd &&
          start < breakEnd &&
          end > breakStart
        );

      };


    /* ============================================================
       CONTROLLO DISPONIBILITÀ
    ============================================================ */

    const free =
      (date, time, duration) => {

        const day =
          daySettings(date);

        const opening =
          toMinutes(day?.open);

        const closing =
          toMinutes(day?.close);

        const start =
          toMinutes(time);

        const dur =
          Number(duration) || 30;

        if (
          !day ||
          day.status === "closed" ||
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

        return !(
          Array.isArray(appointments)
            ? appointments
            : []
        ).some(a => {

          if (!a) {
            return false;
          }

          /*
           * Supporto sia al formato nuovo
           * sia al vecchio formato:
           * {name,service,date,time}
           * {n,s,d,t}
           */

          const appointmentDate =
            a.date || a.d || "";

          if (
            appointmentDate !== date
          ) {
            return false;
          }

          const existingTime =
            toMinutes(
              a.time || a.t
            );

          if (existingTime === null) {
            return false;
          }

          const existingService =
            getService(
              a.service || a.s
            );

          const existingDuration =
            existingService
              ? Number(
                  existingService.duration
                ) || 30
              : 30;

          const existingEnd =
            existingTime +
            existingDuration;

          return (
            start < existingEnd &&
            end > existingTime
          );

        });

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
          daySettings(date);

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


    /* ============================================================
       RICONOSCIMENTO DATA
    ============================================================ */

    const detectDate = text => {

      const n = norm(text);

      if (n.includes("oggi")) {
        return today;
      }

      if (n.includes("domani")) {
        return addDays(today, 1);
      }

      if (n.includes("dopodomani")) {
        return addDays(today, 2);
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

        return (
          numeric[3] ||
          today.slice(0, 4)
        ) +
        "-" +
        String(numeric[2]).padStart(2, "0") +
        "-" +
        String(numeric[1]).padStart(2, "0");

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

        if (n.includes(name)) {

          const current =
            new Date(
              today + "T12:00:00"
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
       RICONOSCIMENTO ORARIO
    ============================================================ */

    const detectTime = text => {

      const n = norm(text);

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

      if (/^\d{1,2}$/.test(n)) {

        const hour =
          Number(n);

        if (hour <= 23) {
          return fmt(hour * 60);
        }

      }

      return null;
    };


    /* ============================================================
       PERIODI DELLA GIORNATA
    ============================================================ */

    const period = text => {

      const n = norm(text);

      if (
        n.includes("pomeriggio")
      ) {
        return [840, 1140];
      }

      if (
        n.includes("mattina")
      ) {
        return [480, 780];
      }

      if (
        n.includes("sera")
      ) {
        return [1020, 1320];
      }

      return null;
    };


    /* ============================================================
       GESTIONE POST AI
       action:"post"
    ============================================================ */

    if (action === "post") {

      const cleanTopic =
        String(topic || "").trim();

      if (!cleanTopic) {

        return res.status(400).json({
          error: "Argomento del post mancante"
        });

      }

      const serviceList =
        safeServices.length
          ? safeServices
              .map(s =>
                `- ${s.name}: €${s.price || ""} (${s.duration || 30} minuti)${s.description ? ` — ${s.description}` : ""}`
              )
              .join("\n")
          : "Nessun servizio inserito.";


      const postPrompt = `
Sei il responsabile della comunicazione
social di ${business || "un'attività locale italiana"}.

Scrivi un post promozionale in italiano.

ARGOMENTO:
${cleanTopic}

ATTIVITÀ:
Tipo: ${settings.type || "Non specificato"}
Descrizione: ${settings.description || "Non specificata"}
Indirizzo: ${settings.address || "Non specificato"}
Telefono: ${settings.phone || "Non specificato"}
WhatsApp: ${settings.whatsapp || "Non specificato"}

SERVIZI:
${serviceList}

PROMOZIONI ATTIVE:
${promotionList}

REGOLE:
- Non inventare prezzi.
- Non inventare servizi.
- Non inventare promozioni.
- Usa esclusivamente i dati forniti.
- Scrivi un testo naturale e professionale.
- Il testo deve essere pronto per essere pubblicato.
- Puoi usare emoji con moderazione.
- Non inserire spiegazioni sul processo.
- Non usare formule come "ecco il post".
- Se l'argomento riguarda una promozione, usa i dati della promozione se pertinenti.
`;

      const client =
        new OpenAI({
          apiKey:
            process.env.OPENAI_API_KEY
        });

      const result =
        await client.responses.create({

          model: "gpt-5.4-mini",

          instructions:
            postPrompt,

          input:
            cleanTopic

        });

      return res.status(200).json({
        reply:
          result.output_text ||
          "Non è stato possibile generare il post."
      });

    }


    /* ============================================================
       CHAT AI
    ============================================================ */

    if (
      !message ||
      !String(message).trim()
    ) {

      return res.status(400).json({
        error: "Messaggio mancante"
      });

    }


    const nmsg =
      norm(message);

    const service =
      findService(message);

    const date =
      detectDate(message);

    const time =
      detectTime(message);

    const per =
      period(message);


    /* ============================================================
       RICONOSCIMENTO RICHIESTA ORARI
    ============================================================ */

    const asksAvailability =
      nmsg.includes("orari disponibili") ||
      nmsg.includes("orari liberi") ||
      nmsg.includes("quando sei libero") ||
      nmsg.includes("quando siete liberi") ||
      nmsg.includes("che ore hai") ||
      nmsg.includes("che orari hai") ||
      nmsg.includes("disponibilita") ||
      nmsg.includes("disponibilità");


    /* ============================================================
       RICONOSCIMENTO PRENOTAZIONE
    ============================================================ */

    const booking =
      nmsg.includes("prenot") ||
      nmsg.includes("appuntament") ||
      nmsg.includes("vorrei") ||
      nmsg.includes("voglio") ||
      nmsg.includes("fissare") ||
      nmsg.includes("prenotare") ||
      !!service;


    /* ============================================================
       CONFERMA / ANNULLAMENTO
    ============================================================ */

    const confirmations =
      new Set([
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


    const cancellations =
      new Set([
        "no",
        "annulla",
        "cancella",
        "non confermo",
        "lascia perdere"
      ]);


    const isConfirm =
      confirmations.has(nmsg) ||
      nmsg.includes("si confermo") ||
      nmsg.includes("sì confermo");


    const isCancel =
      cancellations.has(nmsg);


    /* ============================================================
       CONFERMA APPUNTAMENTO
       RICONTROLLO DISPONIBILITÀ PRIMA DELLA CONFERMA
    ============================================================ */

    if (
      pendingAppointment &&
      requiresConfirmation &&
      isConfirm
    ) {

      const p =
        pendingAppointment;

      const s =
        getService(p.service);

      if (!s) {

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
        String(
          p.name ||
          clientName ||
          ""
        ).trim();


      const d =
        String(
          p.date || ""
        ).trim();


      const minutes =
        toMinutes(p.time);


      const t =
        minutes === null
          ? String(
              p.time || ""
            ).trim()
          : fmt(minutes);


      if (
        !name ||
        !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        !t
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


      if (
        !free(
          d,
          t,
          Number(s.duration) || 30
        )
      ) {

        const alternatives =
          available(
            d,
            Number(s.duration) || 30
          );

        return res.status(200).json({

          reply:
            alternatives.length
              ? `Nel frattempo l'orario ${t} non è più disponibile. Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
              : "Nel frattempo l'orario richiesto non è più disponibile e non ci sono altri slot quel giorno.",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false,

          availableSlots:
            alternatives,

          availableDate:
            d,

          availableService:
            s.name

        });

      }


      return res.status(200).json({

        reply:
          `Appuntamento confermato per ${s.name} il ${italianDate(d)} alle ${t}.`,

        appointment: {
          name,
          service: s.name,
          date: d,
          time: t
        },

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: true

      });

    }


    /* ============================================================
       ANNULLAMENTO APPUNTAMENTO IN ATTESA
    ============================================================ */

    if (
      pendingAppointment &&
      requiresConfirmation &&
      isCancel
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
       RICHIESTA ORARI
    ============================================================ */

    if (asksAvailability) {

      const selectedDate =
        date ||
        addDays(today, 1);

      const duration =
        service
          ? Number(
              service.duration
            ) || 30
          : 30;

      let slots =
        available(
          selectedDate,
          duration
        );


      if (per) {

        slots =
          slots.filter(slot => {

            const m =
              toMinutes(slot);

            return (
              m >= per[0] &&
              m <= per[1]
            );

          });

      }


      return res.status(200).json({

        reply:
          slots.length
            ? `Gli orari disponibili per ${italianDate(selectedDate)} sono: ${slots.join(", ")}.`
            : `Non risultano orari disponibili per ${italianDate(selectedDate)}.`,

        appointment: null,

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false,

        availableSlots:
          slots,

        availableDate:
          selectedDate,

        availableService:
          service?.name || null

      });

    }


    /* ============================================================
       FLUSSO PRENOTAZIONE
       L'AI NON VIENE UTILIZZATA PER DECIDERE LA DISPONIBILITÀ
    ============================================================ */

    if (
      booking &&
      (
        service ||
        pendingAppointment
      )
    ) {

      const selectedService =
        service ||
        getService(
          pendingAppointment?.service
        );


      const selectedDate =
        date ||
        pendingAppointment?.date ||
        null;


      const selectedTime =
        time ||
        pendingAppointment?.time ||
        null;


      const name =
        String(
          clientName ||
          pendingAppointment?.name ||
          ""
        ).trim();


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

            service:
              selectedService.name,

            date:
              selectedDate || "",

            time:
              selectedTime || "",

            name: ""

          },

          requiresConfirmation: false,

          confirmed: false

        });

      }


      if (!selectedDate) {

        return res.status(200).json({

          reply:
            "Per quale giorno vuoi prenotare?",

          appointment: null,

          pendingAppointment: {

            name,

            service:
              selectedService.name,

            date: "",

            time:
              selectedTime || ""

          },

          requiresConfirmation: false,

          confirmed: false

        });

      }


      if (!selectedTime) {

        const slots =
          available(
            selectedDate,
            Number(
              selectedService.duration
            ) || 30
          );


        return res.status(200).json({

          reply:
            slots.length
              ? `Perfetto. Scegli un orario per ${italianDate(selectedDate)}.`
              : `Non risultano orari disponibili per ${italianDate(selectedDate)}.`,

          appointment: null,

          pendingAppointment: {

            name,

            service:
              selectedService.name,

            date:
              selectedDate,

            time: ""

          },

          requiresConfirmation: false,

          confirmed: false,

          availableSlots:
            slots,

          availableDate:
            selectedDate,

          availableService:
            selectedService.name

        });

      }


      const day =
        daySettings(
          selectedDate
        );


      if (
        !day ||
        day.status === "closed"
      ) {

        return res.status(200).json({

          reply:
            `L'attività è chiusa ${italianDate(selectedDate)}. Scegli un altro giorno.`,

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false

        });

      }


      if (
        !free(
          selectedDate,
          selectedTime,
          Number(
            selectedService.duration
          ) || 30
        )
      ) {

        const alternatives =
          available(
            selectedDate,
            Number(
              selectedService.duration
            ) || 30
          );


        return res.status(200).json({

          reply:
            alternatives.length
              ? `L'orario ${selectedTime} non è disponibile. Posso proporti: ${alternatives.slice(0, 8).join(", ")}.`
              : "Non ci sono altri slot disponibili quel giorno.",

          appointment: null,

          pendingAppointment: null,

          requiresConfirmation: false,

          confirmed: false,

          availableSlots:
            alternatives,

          availableDate:
            selectedDate,

          availableService:
            selectedService.name

        });

      }


      return res.status(200).json({

        reply:
          `Perfetto. Ho verificato la disponibilità per ${selectedService.name} il ${italianDate(selectedDate)} alle ${selectedTime}. Vuoi confermare l'appuntamento?`,

        appointment: null,

        pendingAppointment: {

          name,

          service:
            selectedService.name,

          date:
            selectedDate,

          time:
            selectedTime

        },

        requiresConfirmation: true,

        confirmed: false

      });

    }


    /* ============================================================
       AI GENERALE
       VIENE UTILIZZATA SOLO QUANDO LA RICHIESTA NON È
       GESTIBILE DALLA LOGICA LOCALE
    ============================================================ */

    const serviceList =
      safeServices.length
        ? safeServices
            .map(s => {

              const description =
                s.description
                  ? ` — ${s.description}`
                  : "";

              return (
                `- ${s.name}: €${s.price || ""} ` +
                `(${s.duration || 30} minuti)` +
                description
              );

            })
            .join("\n")
        : "Nessun servizio inserito.";


    const safeHistory =
      Array.isArray(history)
        ? history
            .filter(
              item =>
                item &&
                (
                  item.role === "user" ||
                  item.role === "assistant"
                ) &&
                typeof item.content === "string"
            )
            .slice(-12)
        : [];


    const client =
      new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY
      });


    const ai =
      await client.responses.create({

        model:
          "gpt-5.4-mini",

        instructions: `

Sei l'assistente virtuale di ${
          business ||
          "un'attività locale italiana"
        }.

Rispondi sempre in italiano.

Non inventare informazioni.

Usa esclusivamente i dati forniti
in questa richiesta.

INFORMAZIONI ATTIVITÀ

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

ORARI

${openingHours}

SERVIZI

${serviceList}

PROMOZIONI ATTIVE

${promotionList}

CLIENTE

Nome cliente:
${clientName || "Non fornito"}

DATA ODIERNA

${today}

REGOLE

- Non inventare prezzi.
- Non inventare servizi.
- Non inventare promozioni.
- Non inventare orari.
- Non inventare disponibilità.
- Se una promozione è scaduta non comunicarla.
- Se il cliente chiede informazioni su una promozione, usa esclusivamente le promozioni attive sopra indicate.
- Le prenotazioni con servizio, data e ora sono gestite direttamente dal server.
- Non dichiarare mai di aver effettuato una prenotazione se il server non ha restituito confirmed:true.
- Rispondi in modo semplice, naturale e utile.
- Se la domanda è complessa e non può essere risolta dai dati forniti, rispondi indicando chiaramente ciò che manca.

Restituisci esclusivamente JSON valido nel formato:

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
            content:
              String(message)
          }
        ]

      });


    /* ============================================================
       PARSING RISPOSTA AI
    ============================================================ */

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


    /* ============================================================
       RISPOSTA FINALE
    ============================================================ */

    return res.status(200).json({

      reply:
        result.reply ||
        "Non ho ricevuto una risposta.",

      appointment:
        result.confirmed
          ? result.appointment || null
          : null,

      pendingAppointment:
        result.pendingAppointment ||
        null,

      requiresConfirmation:
        Boolean(
          result.requiresConfirmation
        ),

      confirmed:
        Boolean(
          result.confirmed
        )

    });


  } catch (error) {

    console.error(
      "OPENAI ERROR:",
      error
    );


    if (
      error?.status === 429 ||
      String(
        error?.message || ""
      ).includes("429") ||
      String(
        error?.message || ""
      )
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
        "Errore durante la richiesta AI"

    });

  }

}
