import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo non consentito"
    });
  }

  try {
    const body = req.body || {};

    const message =
      String(body.message || "").trim();

    const business =
      String(
        body.business ||
        "Attività locale"
      ).trim();

    const clientName =
      String(
        body.clientName || ""
      ).trim();

    const settings =
      body.settings || {};

    const services =
      Array.isArray(body.services)
        ? body.services
        : [];

    const appointments =
      Array.isArray(body.appointments)
        ? body.appointments
        : [];

    const history =
      Array.isArray(body.history)
        ? body.history
        : [];

    let pendingAppointment =
      body.pendingAppointment || null;

    let requiresConfirmation =
      body.requiresConfirmation === true;

    if (!message) {
      return res.status(400).json({
        error: "Messaggio mancante"
      });
    }

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

    function toMinutes(value) {
      if (!value) return null;

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
        text.match(
          /^(\d{1,2}):(\d{2})$/
        );

      if (!match) return null;

      const hours =
        Number(match[1]);

      const minutes =
        Number(match[2]);

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
      return (
        String(
          Math.floor(minutes / 60)
        ).padStart(2, "0") +
        ":" +
        String(
          minutes % 60
        ).padStart(2, "0")
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

    function getService(name) {
      if (!name) return null;

      const wanted =
        normalizeText(name);

      return (
        services.find(service =>
          normalizeText(service.name) === wanted
        ) || null
      );
    }

    function findServiceInText(text) {
      const normalized =
        normalizeText(text);

      /* Prima il nome completo */

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

      /* Poi tutte le parole */

      for (const service of services) {
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

      /* Sinonimi comuni */

      const synonyms = [
        {
          words: [
            "taglio",
            "capelli"
          ]
        },
        {
          words: [
            "taglio",
            "uomo"
          ]
        },
        {
          words: [
            "taglio",
            "donna"
          ]
        },
        {
          words: [
            "barba"
          ]
        },
        {
          words: [
            "colore"
          ]
        },
        {
          words: [
            "piega"
          ]
        }
      ];

      for (const synonym of synonyms) {
        if (
          synonym.words.every(word =>
            normalized.includes(word)
          )
        ) {
          const found =
            services.find(service => {

              const serviceText =
                normalizeText(
                  service.name
                );

              return synonym.words.every(
                word =>
                  serviceText.includes(word)
              );

            });

          if (found) {
            return found;
          }
        }
      }

      return null;
    }

    function getDaySettings(date) {
      const dayName =
        getDayName(date);

      if (!dayName) return null;

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

      const dur =
        Number(duration);

      if (
        opening === null ||
        closing === null ||
        start === null ||
        !dur ||
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

          if (
            appointment.d !== date ||
            !appointment.t
          ) {
            return false;
          }

          const existingStart =
            toMinutes(
              appointment.t
            );

          if (
            existingStart === null
          ) {
            return false;
          }

          const existingService =
            getService(
              appointment.s
            );

          const existingDuration =
            existingService
              ? Number(
                  existingService.duration
                ) || 30
              : 30;

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

      if (startAfter !== null) {
        first =
          Math.max(
            first,
            startAfter
          );
      }

      if (endBefore !== null) {
        last =
          Math.min(
            last,
            endBefore
          );
      }

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

    /* ============================================================
       DATA ITALIANA
    ============================================================ */

    const now =
      new Date();

    const parts =
      new Intl.DateTimeFormat(
        "en-CA",
        {
          timeZone: "Europe/Rome",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }
      ).formatToParts(now);

    const dateMap = {};

    parts.forEach(part => {
      if (
        part.type !== "literal"
      ) {
        dateMap[part.type] =
          part.value;
      }
    });

    const today =
      `${dateMap.year}-${dateMap.month}-${dateMap.day}`;

    function addDays(
      dateString,
      amount
    ) {
      const date =
        new Date(
          `${dateString}T12:00:00`
        );

      date.setDate(
        date.getDate() + amount
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

    /* ============================================================
       RICONOSCIMENTO DATA
    ============================================================ */

    function detectDate(text) {
      const normalized =
        normalizeText(text);

      if (
        normalized.includes("oggi")
      ) {
        return today;
      }

      if (
        normalized.includes("domani")
      ) {
        return addDays(
          today,
          1
        );
      }

      if (
        normalized.includes("dopodomani")
      ) {
        return addDays(
          today,
          2
        );
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
          String(
            numeric[1]
          ).padStart(2, "0");

        const month =
          String(
            numeric[2]
          ).padStart(2, "0");

        const year =
          numeric[3] ||
          String(
            new Date(
              `${today}T12:00:00`
            ).getFullYear()
          );

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
        const [
          name,
          target
        ] of Object.entries(
          weekdays
        )
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
            target -
            currentDay;

          if (
            difference <= 0
          ) {
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

    /* ============================================================
       RICONOSCIMENTO ORA
    ============================================================ */

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

    /* ============================================================
       FASCIA ORARIA
    ============================================================ */

    function detectPeriod(text) {
      const normalized =
        normalizeText(text);

      if (
        normalized.includes(
          "pomeriggio"
        )
      ) {
        return {
          start: 14 * 60,
          end: 19 * 60
        };
      }

      if (
        normalized.includes(
          "mattina"
        )
      ) {
        return {
          start: 8 * 60,
          end: 13 * 60
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

    /* ============================================================
       NOME CLIENTE
    ============================================================ */

    function detectName(text) {
      const clean =
        String(text || "")
          .trim();

      if (!clean) {
        return "";
      }

      /*
       * Non tentiamo di estrarre nomi da frasi generiche.
       * Il nome inserito nel campo clientName resta prioritario.
       */

      return "";
    }

    /* ============================================================
       INTENTI
    ============================================================ */

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

    const confirmationMessages = [
      "si",
      "sì",
      "confermo",
      "va bene",
      "ok",
      "okay",
      "prenota",
      "prenotalo",
      "procedi",
      "conferma",
      "confermo l appuntamento",
      "confermo l'appuntamento"
    ];

    const cancellationMessages = [
      "no",
      "annulla",
      "cancella",
      "non confermo",
      "lascia perdere"
    ];

    const isConfirmation =
      confirmationMessages.includes(
        normalizedMessage
      ) ||
      normalizedMessage.includes(
        "si confermo"
      ) ||
      normalizedMessage.includes(
        "sì confermo"
      );

    const isCancellation =
      cancellationMessages.includes(
        normalizedMessage
      );

    const asksAvailability =
      (
        normalizedMessage.includes(
          "orari"
        ) &&
        (
          normalizedMessage.includes(
            "disponibili"
          ) ||
          normalizedMessage.includes(
            "liberi"
          ) ||
          normalizedMessage.includes(
            "libero"
          )
        )
      ) ||
      normalizedMessage.includes(
        "quando sei libero"
      ) ||
      normalizedMessage.includes(
        "quando siete liberi"
      ) ||
      normalizedMessage.includes(
        "che ore hai"
      ) ||
      normalizedMessage.includes(
        "che orari hai"
      );

    const bookingKeywords = [
      "prenot",
      "appuntament",
      "fissare",
      "taglio",
      "servizio",
      "barba",
      "piega",
      "colore"
    ];

    const looksLikeBooking =
      bookingKeywords.some(
        word =>
          normalizedMessage.includes(word)
      ) ||
      (
        normalizedMessage.includes(
          "vorrei"
        ) &&
        (
          detectedService ||
          detectedDate ||
          detectedTime
        )
      ) ||
      (
        normalizedMessage.includes(
          "voglio"
        ) &&
        (
          detectedService ||
          detectedDate ||
          detectedTime
        )
      );

    /* ============================================================
       CANCELLAZIONE CONFERMA
    ============================================================ */

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
       CONFERMA APPUNTAMENTO
    ============================================================ */

    if (
      pendingAppointment &&
      requiresConfirmation &&
      isConfirmation
    ) {
      const requested =
        pendingAppointment;

      const service =
        getService(
          requested.service
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
          .replace(".", ":");

      const timeMinutes =
        toMinutes(time);

      if (
        timeMinutes !== null
      ) {
        time =
          formatTime(
            timeMinutes
          );
      }

      const name =
        String(
          requested.name ||
          clientName ||
          ""
        ).trim();

      if (
        !name ||
        !/^\d{4}-\d{2}-\d{2}$/.test(
          date
        ) ||
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
        Number(
          service.duration
        ) || 30;

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
              ? `Nel frattempo le ${time} non sono più disponibili. Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
              : "Nel frattempo l'orario richiesto non è più disponibile e non ci sono altri slot quel giorno.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          availableSlots:
            alternatives,
          availableDate:
            date,
          availableService:
            service.name
        });
      }

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

    /* ============================================================
       RICHIESTA DISPONIBILITÀ
    ============================================================ */

    if (
      asksAvailability ||
      (
        looksLikeBooking &&
        detectedDate &&
        !detectedTime
      )
    ) {
      const date =
        detectedDate ||
        addDays(today, 1);

      const service =
        detectedService ||
        (
          pendingAppointment
            ? getService(
                pendingAppointment.service
              )
            : null
        );

      const duration =
        service
          ? Number(
              service.duration
            ) || 30
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
          availableSlots: [],
          availableDate: date,
          availableService:
            service?.name || null
        });
      }

      return res.status(200).json({
        reply:
          `Gli orari disponibili per ${italianDate(date)} sono: ${slots.join(", ")}.`,
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false,
        availableSlots: slots,
        availableDate: date,
        availableService:
          service?.name || null
      });
    }

    /* ============================================================
       PRENOTAZIONE
    ============================================================ */

    /*
     * Se abbiamo già un appuntamento in sospeso,
     * recuperiamo i dati mancanti dal nuovo messaggio.
     */

    if (
      pendingAppointment &&
      !requiresConfirmation
    ) {
      const mergedService =
        detectedService ||
        getService(
          pendingAppointment.service
        );

      const mergedDate =
        detectedDate ||
        pendingAppointment.date ||
        null;

      const mergedTime =
        detectedTime ||
        pendingAppointment.time ||
        null;

      const mergedName =
        clientName ||
        pendingAppointment.name ||
        "";

      if (
        mergedService &&
        mergedDate &&
        mergedTime &&
        mergedName
      ) {
        pendingAppointment = {
          name:
            mergedName,
          service:
            mergedService.name,
          date:
            mergedDate,
          time:
            mergedTime
        };
      }
    }

    /*
     * Gestione principale della prenotazione.
     */

    if (
      looksLikeBooking ||
      pendingAppointment
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
          detectName(message) ||
          ""
        ).trim();

      /*
       * SERVIZIO MANCANTE
       */

      if (!service) {

        if (
          services.length === 1
        ) {
          const onlyService =
            services[0];

          return res.status(200).json({
            reply:
              `Certo. Vuoi prenotare ${onlyService.name}?`,
            appointment: null,
            pendingAppointment: {
              name,
              service:
                onlyService.name,
              date,
              time
            },
            requiresConfirmation: false,
            confirmed: false
          });
        }

        return res.status(200).json({
          reply:
            "Quale servizio vuoi prenotare?",
          appointment: null,
          pendingAppointment: {
            name,
            service: "",
            date: date || "",
            time: time || ""
          },
          requiresConfirmation: false,
          confirmed: false
        });
      }

      /*
       * NOME MANCANTE
       */

      if (!name) {
        return res.status(200).json({
          reply:
            "Perfetto. Mi confermi il nome per la prenotazione?",
          appointment: null,
          pendingAppointment: {
            service:
              service.name,
            date:
              date || "",
            time:
              time || "",
            name: ""
          },
          requiresConfirmation: false,
          confirmed: false
        });
      }

      /*
       * DATA MANCANTE
       */

      if (!date) {
        return res.status(200).json({
          reply:
            "Per quale giorno vuoi prenotare?",
          appointment: null,
          pendingAppointment: {
            name,
            service:
              service.name,
            date: "",
            time:
              time || ""
          },
          requiresConfirmation: false,
          confirmed: false
        });
      }

      /*
       * ORA MANCANTE
       *
       * Questo è il caso:
       * "Simone vorrei un taglio domani"
       */

      if (!time) {

        const slots =
          findAvailableSlots(
            date,
            Number(
              service.duration
            ) || 30
          );

        if (!slots.length) {
          return res.status(200).json({
            reply:
              `Non risultano orari disponibili per ${italianDate(date)}.`,
            appointment: null,
            pendingAppointment: null,
            requiresConfirmation: false,
            confirmed: false,
            availableSlots: [],
            availableDate: date,
            availableService:
              service.name
          });
        }

        return res.status(200).json({
          reply:
            `Certo. Per ${service.name} ${italianDate(date)}. Quale orario preferisci?`,
          appointment: null,
          pendingAppointment: {
            name,
            service:
              service.name,
            date,
            time: ""
          },
          requiresConfirmation: false,
          confirmed: false,
          availableSlots:
            slots,
          availableDate:
            date,
          availableService:
            service.name
        });
      }

      const duration =
        Number(
          service.duration
        ) || 30;

      const day =
        getDaySettings(date);

      /*
       * GIORNO CHIUSO
       */

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
       * ORARIO NON DISPONIBILE
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
              ? `Le ${time} non sono disponibili. Posso proporti: ${alternatives.slice(0, 5).join(", ")}.`
              : "Non ci sono altri slot disponibili quel giorno.",
          appointment: null,
          pendingAppointment: null,
          requiresConfirmation: false,
          confirmed: false,
          availableSlots:
            alternatives,
          availableDate:
            date,
          availableService:
            service.name
        });
      }

      /*
       * ORARIO DISPONIBILE
       *
       * NON prenotiamo ancora.
       */

      return res.status(200).json({
        reply:
          `Perfetto. Ho verificato la disponibilità per ${service.name} il ${italianDate(date)} alle ${time}. Vuoi confermare l'appuntamento?`,
        appointment: null,
        pendingAppointment: {
          name,
          service:
            service.name,
          date,
          time
        },
        requiresConfirmation: true,
        confirmed: false
      });
    }

    /* ============================================================
       DOMANDE GENERALI
       ============================================================ */

    /*
     * OpenAI viene utilizzato solamente per domande generali.
     * Se non esiste la chiave API, rispondiamo senza generare
     * un errore 429 artificiale.
     */

    if (
      !process.env.OPENAI_API_KEY
    ) {
      return res.status(200).json({
        reply:
          "Posso aiutarti con servizi, prezzi, orari e appuntamenti. Per questa richiesta è necessaria la configurazione dell'assistente AI.",
        appointment: null,
        pendingAppointment: null,
        requiresConfirmation: false,
        confirmed: false
      });
    }

    const client =
      new OpenAI({
        apiKey:
          process.env.OPENAI_API_KEY
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
        .map(
          ([key, label]) => {

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
          }
        )
        .join("\n");

    const serviceList =
      services.length
        ? services
            .map(
              service =>
                `- ${service.name}: €${service.price} (${service.duration} minuti)`
            )
            .join("\n")
        : "Nessun servizio inserito.";

    const safeHistory =
      history
        .filter(
          item =>
            item &&
            (
              item.role === "user" ||
              item.role === "assistant"
            ) &&
            typeof item.content ===
              "string"
        )
        .slice(-12);

    const response =
      await client.responses.create({
        model:
          "gpt-5.4-mini",

        instructions: `
Sei l'assistente virtuale di ${business}.

Rispondi sempre in italiano.

Aiuta i clienti con:
- informazioni sull'attività
- servizi
- prezzi
- orari
- promozioni
- informazioni generali

Non inventare informazioni.

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

Promozioni:
${settings.promotion || "Nessuna promozione specificata."}

Nome cliente:
${clientName || "Non fornito"}

Data odierna:
${today}

Non confermare né creare appuntamenti.
Le prenotazioni vengono gestite dal server.

Restituisci esclusivamente JSON valido:

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

    return res.status(200).json({
      reply:
        result.reply ||
        "Non ho ricevuto una risposta.",

      appointment: null,

      pendingAppointment:
        null,

      requiresConfirmation:
        false,

      confirmed:
        false
    });

  } catch (error) {

    console.error(
      "CHAT API ERROR:",
      error
    );

    /*
     * NON trasformiamo automaticamente qualsiasi errore
     * in "AI temporaneamente occupata".
     */

    if (
      error?.status === 429
    ) {
      return res.status(200).json({
        reply:
          "L'assistente AI ha raggiunto temporaneamente il limite di richieste. Le prenotazioni possono comunque essere gestite quando il servizio di prenotazione è disponibile.",
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
