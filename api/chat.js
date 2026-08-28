// ============================================================
// api/chat.js
// AI Assistente Locale
// VERSIONE DEFINITIVA
// ============================================================

export default async function handler(req, res) {

  // ==========================================================
  // METODO
  // ==========================================================

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo non consentito."
    });
  }

  // ==========================================================
  // API KEY
  // ==========================================================

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "OPENAI_API_KEY non configurata."
    });
  }

  try {

    const body = req.body || {};

    const {
      message = "",
      action = "chat",

      business = "Attività locale",
      clientName = "",

      settings = {},
      services = [],
      appointments = [],
      promotions = [],

      history = [],

      pendingAppointment = null,
      requiresConfirmation = false,

      topic = ""
    } = body;


    // ========================================================
    // FUNZIONI SICURE
    // ========================================================

    const safeArray = value =>
      Array.isArray(value) ? value : [];


    const safeString = value =>
      String(value ?? "").trim();


    // ========================================================
    // SERVIZI
    // ========================================================

    const cleanServices =
      safeArray(services)
        .map(service => ({

          id:
            service.id || null,

          name:
            safeString(service.name),

          category:
            safeString(service.category),

          price:
            service.price !== undefined &&
            service.price !== null &&
            service.price !== ""
              ? Number(service.price)
              : null,

          duration:
            service.duration !== undefined &&
            service.duration !== null &&
            service.duration !== ""
              ? Number(service.duration)
              : null,

          description:
            safeString(
              service.description
            )

        }))
        .filter(service =>
          service.name
        );


    // ========================================================
    // PROMOZIONI
    // ========================================================

    const cleanPromotions =
      safeArray(promotions)
        .map(promotion => ({

          id:
            promotion.id || null,

          title:
            safeString(
              promotion.title
            ),

          category:
            safeString(
              promotion.category
            ),

          description:
            safeString(
              promotion.description
            ),

          price:
            promotion.price !== undefined &&
            promotion.price !== null &&
            promotion.price !== ""
              ? Number(promotion.price)
              : null,

          expiry:
            safeString(
              promotion.expiry
            )

        }))
        .filter(promotion =>
          promotion.title ||
          promotion.description
        );


    // ========================================================
    // APPUNTAMENTI
    // ========================================================

    const cleanAppointments =
      safeArray(appointments)
        .map(appointment => ({

          id:
            appointment.id || null,

          name:
            safeString(
              appointment.name ||
              appointment.n
            ),

          date:
            safeString(
              appointment.date ||
              appointment.d
            ),

          time:
            safeString(
              appointment.time ||
              appointment.t
            ),

          service:
            safeString(
              appointment.service ||
              appointment.s
            )

        }))
        .filter(appointment =>
          appointment.date &&
          appointment.time
        );


    // ========================================================
    // ORARI
    // ========================================================

    const hours =
      settings.hours || {};


    function getDayName(date) {

      if (!date) {
        return null;
      }

      const d =
        new Date(
          `${date}T12:00:00`
        );

      if (
        Number.isNaN(
          d.getTime()
        )
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
      ][d.getDay()];
    }


    function toMinutes(time) {

      if (
        !time ||
        !/^\d{2}:\d{2}$/.test(time)
      ) {
        return null;
      }

      const parts =
        time
          .split(":")
          .map(Number);

      return (
        parts[0] * 60 +
        parts[1]
      );
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


    // ========================================================
    // TROVA SERVIZIO
    // ========================================================

    function getService(name) {

      if (!name) {
        return null;
      }

      const wanted =
        safeString(name)
          .toLowerCase();

      return (
        cleanServices.find(service =>
          service.name
            .toLowerCase() === wanted
        )
        ||
        cleanServices.find(service =>
          wanted.includes(
            service.name.toLowerCase()
          )
        )
        ||
        cleanServices.find(service =>
          service.name
            .toLowerCase()
            .includes(wanted)
        )
        ||
        null
      );
    }


    // ========================================================
    // TROVA SERVIZIO NEL TESTO
    // ========================================================

    function findServiceInText(text) {

      const lower =
        safeString(text)
          .toLowerCase();

      if (!lower) {
        return null;
      }

      // Prima cerchiamo il nome completo.
      const exact =
        cleanServices.find(service =>
          lower.includes(
            service.name.toLowerCase()
          )
        );

      if (exact) {
        return exact.name;
      }

      // Poi proviamo parole significative.
      const partial =
        cleanServices.find(service => {

          const words =
            service.name
              .toLowerCase()
              .split(/\s+/)
              .filter(word =>
                word.length >= 3
              );

          return words.some(word =>
            lower.includes(word)
          );

        });

      return partial
        ? partial.name
        : null;
    }


    // ========================================================
    // PAUSA
    // ========================================================

    function isBreak(
      day,
      start,
      end
    ) {

      if (!day) {
        return false;
      }

      const breakStart =
        toMinutes(
          day.breakStart
        );

      const breakEnd =
        toMinutes(
          day.breakEnd
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


    // ========================================================
    // DISPONIBILITÀ
    // ========================================================

    function isAvailable(
      date,
      time,
      duration
    ) {

      const dayName =
        getDayName(date);

      const day =
        hours[dayName];

      if (!day) {
        return false;
      }

      if (
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

      const serviceDuration =
        Number(duration || 30);

      if (
        opening === null ||
        closing === null ||
        start === null
      ) {
        return false;
      }

      const end =
        start +
        serviceDuration;

      if (
        start < opening ||
        end > closing
      ) {
        return false;
      }

      if (
        isBreak(
          day,
          start,
          end
        )
      ) {
        return false;
      }


      // --------------------------------------------
      // Controllo appuntamenti esistenti
      // --------------------------------------------

      for (
        const appointment
        of cleanAppointments
      ) {

        if (
          appointment.date !== date
        ) {
          continue;
        }

        const existingStart =
          toMinutes(
            appointment.time
          );

        if (
          existingStart === null
        ) {
          continue;
        }

        const existingService =
          getService(
            appointment.service
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

        if (
          start < existingEnd &&
          end > existingStart
        ) {
          return false;
        }

      }

      return true;
    }


    // ========================================================
    // SLOT DISPONIBILI
    // ========================================================

    function getAvailableSlots(
      date,
      serviceName,
      requestedTime = null
    ) {

      const service =
        getService(
          serviceName
        );

      if (!service) {
        return [];
      }

      const dayName =
        getDayName(date);

      const day =
        hours[dayName];

      if (!day) {
        return [];
      }

      if (
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
        closing === null ||
        opening >= closing
      ) {
        return [];
      }

      const duration =
        Number(
          service.duration
        ) || 30;

      const slots = [];

      for (
        let minutes = opening;
        minutes < closing;
        minutes += 30
      ) {

        const time =
          formatTime(minutes);

        if (
          isAvailable(
            date,
            time,
            duration
          )
        ) {
          slots.push(time);
        }

      }

      if (
        requestedTime &&
        slots.includes(requestedTime)
      ) {

        return [
          requestedTime,
          ...slots.filter(
            item =>
              item !== requestedTime
          )
        ];
      }

      return slots;
    }


    // ========================================================
    // DATA ITALIANA
    // ========================================================

    function formatItalianDate(date) {

      if (!date) {
        return "";
      }

      const d =
        new Date(
          `${date}T12:00:00`
        );

      if (
        Number.isNaN(
          d.getTime()
        )
      ) {
        return date;
      }

      return d.toLocaleDateString(
        "it-IT",
        {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric"
        }
      );
    }


    // ========================================================
    // CONVERSIONE GIORNO SETTIMANA
    // ========================================================

    const weekdayMap = {

      domenica: 0,

      lunedì: 1,
      lunedi: 1,

      martedì: 2,
      martedi: 2,

      mercoledì: 3,
      mercoledi: 3,

      giovedì: 4,
      giovedi: 4,

      venerdì: 5,
      venerdi: 5,

      sabato: 6

    };


    function resolveWeekdayDate(
      weekday
    ) {

      const now =
        new Date();

      const target =
        new Date(now);

      let difference =
        (
          weekday -
          target.getDay() +
          7
        ) % 7;

      // "lunedì" significa il prossimo lunedì
      // se oggi è lunedì.
      if (
        difference === 0
      ) {
        difference = 7;
      }

      target.setDate(
        target.getDate() +
        difference
      );

      return (
        `${target.getFullYear()}-` +
        `${String(
          target.getMonth() + 1
        ).padStart(2, "0")}-` +
        `${String(
          target.getDate()
        ).padStart(2, "0")}`
      );
    }


    // ========================================================
    // ESTRAZIONE DATA
    // ========================================================

    function extractDate(text) {

      const lower =
        safeString(text)
          .toLowerCase();

      // YYYY-MM-DD
      let match =
        lower.match(
          /\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/
        );

      if (match) {

        return (
          `${match[1]}-` +
          `${String(
            match[2]
          ).padStart(2, "0")}-` +
          `${String(
            match[3]
          ).padStart(2, "0")}`
        );
      }

      // Giorno della settimana
      for (
        const name
        of Object.keys(
          weekdayMap
        )
      ) {

        if (
          lower.includes(name)
        ) {

          return resolveWeekdayDate(
            weekdayMap[name]
          );
        }
      }

      return null;
    }


    // ========================================================
    // ESTRAZIONE ORARIO
    // ========================================================

    function extractTime(text) {

      const value =
        safeString(text);

      // 09:00 / 09.00
      let match =
        value.match(
          /\b([01]?\d|2[0-3])[:\.]([0-5]\d)\b/
        );

      if (match) {

        return (
          `${String(
            Number(match[1])
          ).padStart(2, "0")}:` +
          `${String(
            Number(match[2])
          ).padStart(2, "0")}`
        );
      }

      // "alle 09"
      match =
        value.match(
          /\b(?:alle|ore|h)\s*([01]?\d|2[0-3])\b/i
        );

      if (match) {

        return (
          `${String(
            Number(match[1])
          ).padStart(2, "0")}:00`
        );
      }

      // Se il messaggio è sostanzialmente
      // "09" / "9"
      if (
        /^\s*([01]?\d|2[0-3])\s*$/.test(
          value
        )
      ) {

        const hour =
          Number(
            value.trim()
          );

        return (
          `${String(hour)
            .padStart(2, "0")}:00`
        );
      }

      return null;
    }


    // ========================================================
    // RILEVA CONFERMA
    // ========================================================

    function isConfirmation(text) {

      const lower =
        safeString(text)
          .toLowerCase()
          .replace(/[.!?]+$/g, "")
          .trim();

      const phrases = [

        "confermo",

        "conferma",

        "confermare",

        "sì confermo",

        "si confermo",

        "sì, confermo",

        "si, confermo",

        "va bene",

        "ok confermo",

        "ok",

        "perfetto",

        "perfetto confermo",

        "procedi",

        "procediamo",

        "puoi confermare"

      ];

      return phrases.some(
        phrase =>
          lower === phrase ||
          lower.includes(
            phrase
          )
      );
    }


    // ========================================================
    // RILEVA ANNULLAMENTO
    // ========================================================

    function isCancellation(text) {

      const lower =
        safeString(text)
          .toLowerCase()
          .trim();

      const phrases = [

        "annulla",

        "annullare",

        "annullo",

        "non confermo",

        "lascia perdere",

        "no"

      ];

      return phrases.some(
        phrase =>
          lower === phrase
      );
    }


    // ========================================================
    // RILEVA LINGUAGGIO PRENOTAZIONE
    // ========================================================

    function hasBookingLanguage(text) {

      const lower =
        safeString(text)
          .toLowerCase();

      return (
        lower.includes("prenot") ||
        lower.includes("appuntamento") ||
        lower.includes("scegli") ||
        lower.includes("scelgo") ||
        lower.includes("fissare") ||
        lower.includes("prenotare")
      );
    }


    // ========================================================
    // TESTO SERVIZI
    // ========================================================

    const servicesText =
      cleanServices.length

        ? cleanServices
            .map(service => {

              let text =
                service.name;

              if (
                service.category
              ) {
                text +=
                  ` | Categoria: ${service.category}`;
              }

              if (
                service.price !== null
              ) {
                text +=
                  ` | Prezzo: €${service.price.toFixed(2)}`;
              }

              if (
                service.duration !== null
              ) {
                text +=
                  ` | Durata: ${service.duration} minuti`;
              }

              if (
                service.description
              ) {
                text +=
                  ` | Descrizione: ${service.description}`;
              }

              return text;

            })
            .join("\n")

        : "Nessun servizio configurato.";


    // ========================================================
    // TESTO PROMOZIONI
    // ========================================================

    const promotionsText =
      cleanPromotions.length

        ? cleanPromotions
            .map(promotion => {

              let text =
                promotion.title;

              if (
                promotion.category
              ) {
                text +=
                  ` | Categoria: ${promotion.category}`;
              }

              if (
                promotion.description
              ) {
                text +=
                  ` | Descrizione: ${promotion.description}`;
              }

              if (
                promotion.price !== null
              ) {
                text +=
                  ` | Prezzo: €${promotion.price.toFixed(2)}`;
              }

              if (
                promotion.expiry
              ) {
                text +=
                  ` | Scadenza: ${promotion.expiry}`;
              }

              return text;

            })
            .join("\n")

        : "Nessuna promozione configurata.";


    // ========================================================
    // POST AI
    // ========================================================

    if (
      action === "post"
    ) {

      const postTopic =
        safeString(topic) ||
        "una nuova promozione";


      const postPrompt = `
Sei il copywriter di una piccola attività locale italiana.

Crea un post per Facebook e Instagram.

ATTIVITÀ:
${safeString(
  settings.name ||
  business
)}

TIPO:
${safeString(
  settings.type
)}

DESCRIZIONE:
${safeString(
  settings.description
)}

ARGOMENTO:
${postTopic}

SERVIZI:
${servicesText}

PROMOZIONI:
${promotionsText}

REGOLE:

- scrivi in italiano;
- tono professionale, naturale e semplice;
- non inventare informazioni;
- usa esclusivamente dati presenti;
- non inventare prezzi;
- non inventare promozioni;
- non inventare servizi;
- non inventare indirizzi o telefoni;
- evita testi eccessivamente lunghi;
- crea un contenuto adatto a Facebook/Instagram;
- inserisci una call to action semplice;
- usa pochi emoji solo se appropriato.

Restituisci esclusivamente il testo del post.
`;


      const aiResult =
        await callOpenAI(
          postPrompt
        );


      return res.status(200).json({
        reply: aiResult
      });

    }


    // ========================================================
    // DOMANDE DIRETTE SUI SERVIZI
    // ========================================================

    const normalizedMessage =
      safeString(message)
        .toLowerCase();


    const asksServices =
      normalizedMessage.includes(
        "servizi"
      ) ||
      normalizedMessage.includes(
        "trattamenti"
      ) ||
      normalizedMessage.includes(
        "cosa fate"
      ) ||
      normalizedMessage.includes(
        "cosa offrite"
      );


    const asksPromotions =
      normalizedMessage.includes(
        "promozion"
      ) ||
      normalizedMessage.includes(
        "offerte"
      ) ||
      normalizedMessage.includes(
        "sconti"
      );


    if (
      asksServices &&
      !hasBookingLanguage(
        normalizedMessage
      )
    ) {

      if (
        !cleanServices.length
      ) {

        return res.status(200).json({

          reply:
            "Al momento non risultano servizi configurati."

        });

      }

      const lines =
        cleanServices.map(
          service => {

            let line =
              service.name;

            if (
              service.category
            ) {
              line +=
                ` — ${service.category}`;
            }

            if (
              service.price !== null
            ) {
              line +=
                ` — Prezzo: €${service.price.toFixed(2)}`;
            }

            if (
              service.duration !== null
            ) {
              line +=
                ` — Durata: ${service.duration} minuti`;
            }

            return line;

          }
        );


      return res.status(200).json({

        reply:
          "Ecco i servizi disponibili:\n\n" +
          lines.join("\n")

      });

    }


    // ========================================================
    // DOMANDE DIRETTE SULLE PROMOZIONI
    // ========================================================

    if (
      asksPromotions &&
      !hasBookingLanguage(
        normalizedMessage
      )
    ) {

      if (
        !cleanPromotions.length
      ) {

        return res.status(200).json({

          reply:
            "Al momento non risultano promozioni configurate."

        });

      }

      const lines =
        cleanPromotions.map(
          promotion => {

            let line =
              promotion.title;

            if (
              promotion.description
            ) {
              line +=
                ` — ${promotion.description}`;
            }

            if (
              promotion.price !== null
            ) {
              line +=
                ` — €${promotion.price.toFixed(2)}`;
            }

            if (
              promotion.expiry
            ) {
              line +=
                ` — valida fino al ${promotion.expiry}`;
            }

            return line;

          }
        );


      return res.status(200).json({

        reply:
          "Le promozioni attualmente configurate sono:\n\n" +
          lines.join("\n")

      });

    }


    // ========================================================
    // GESTIONE PRENOTAZIONE PRIMA DI OPENAI
    // ========================================================

    const extractedService =
      findServiceInText(
        message
      );


    const extractedDate =
      extractDate(
        message
      );


    const extractedTime =
      extractTime(
        message
      );


    // ========================================================
    // CONFERMA
    // ========================================================

    if (
      isConfirmation(message) &&
      pendingAppointment &&
      requiresConfirmation
    ) {

      const appointment = {

        name:
          safeString(
            pendingAppointment.name ||
            clientName
          ),

        date:
          safeString(
            pendingAppointment.date
          ),

        time:
          safeString(
            pendingAppointment.time
          ),

        service:
          safeString(
            pendingAppointment.service
          )

      };


      const service =
        getService(
          appointment.service
        );


      if (!service) {

        return res.status(200).json({

          reply:
            "Non posso confermare la prenotazione perché il servizio non risulta configurato.",

          confirmed: false,

          requiresConfirmation: true,

          pendingAppointment

        });

      }


      if (
        !appointment.name
      ) {

        return res.status(200).json({

          reply:
            "Prima della conferma ho bisogno del nome del cliente.",

          confirmed: false,

          requiresConfirmation: true,

          pendingAppointment

        });

      }


      if (
        !appointment.date ||
        !appointment.time
      ) {

        return res.status(200).json({

          reply:
            "Mancano data o orario della prenotazione.",

          confirmed: false,

          requiresConfirmation: true,

          pendingAppointment

        });

      }


      const free =
        isAvailable(
          appointment.date,
          appointment.time,
          Number(
            service.duration
          ) || 30
        );


      if (!free) {

        const alternatives =
          getAvailableSlots(
            appointment.date,
            service.name
          );


        return res.status(200).json({

          reply:
            `L'orario ${appointment.time} non è più disponibile.`,

          confirmed: false,

          requiresConfirmation: false,

          pendingAppointment: null,

          availableSlots:
            alternatives,

          availableDate:
            appointment.date,

          availableService:
            service.name

        });

      }


      return res.status(200).json({

        reply:
          `Appuntamento confermato per ${appointment.name} il ${formatItalianDate(appointment.date)} alle ${appointment.time} per ${service.name}.`,

        confirmed: true,

        requiresConfirmation: false,

        pendingAppointment: null,

        appointment: {

          name:
            appointment.name,

          date:
            appointment.date,

          time:
            appointment.time,

          service:
            service.name,

          bookingKey:
            `${appointment.date}_${appointment.time}_${service.name}`

        }

      });

    }


    // ========================================================
    // ANNULLAMENTO
    // ========================================================

    if (
      isCancellation(message) &&
      pendingAppointment &&
      requiresConfirmation
    ) {

      return res.status(200).json({

        reply:
          "Va bene, ho annullato la richiesta di prenotazione.",

        confirmed: false,

        requiresConfirmation: false,

        pendingAppointment: null

      });

    }


    // ========================================================
    // NUOVA RICHIESTA PRENOTAZIONE
    // ========================================================

    const bookingRequest =
      hasBookingLanguage(
        message
      ) ||
      extractedService !== null ||
      extractedDate !== null ||
      extractedTime !== null;


    if (
      bookingRequest
    ) {

      let serviceName =
        extractedService;


      // Se non trovato nel messaggio,
      // proviamo dalla prenotazione precedente.
      if (
        !serviceName &&
        pendingAppointment?.service
      ) {

        serviceName =
          pendingAppointment.service;

      }


      const service =
        getService(
          serviceName
        );


      // --------------------------------------------
      // Servizio mancante
      // --------------------------------------------

      if (!service) {

        if (
          cleanServices.length === 1
        ) {

          serviceName =
            cleanServices[0].name;

        } else {

          return res.status(200).json({

            reply:
              "Quale servizio vuoi prenotare? Posso mostrarti i servizi disponibili.",

            confirmed: false,

            requiresConfirmation: false

          });

        }

      }


      const selectedService =
        getService(
          serviceName
        );


      // --------------------------------------------
      // DATA
      // --------------------------------------------

      const date =
        extractedDate ||
        pendingAppointment?.date ||
        "";


      if (!date) {

        return res.status(200).json({

          reply:
            `Per prenotare ${selectedService.name} ho bisogno della data.`,

          confirmed: false,

          requiresConfirmation: false

        });

      }


      // --------------------------------------------
      // ORARIO
      // --------------------------------------------

      const time =
        extractedTime ||
        pendingAppointment?.time ||
        "";


      if (!time) {

        const slots =
          getAvailableSlots(
            date,
            selectedService.name
          );


        if (!slots.length) {

          return res.status(200).json({

            reply:
              `Non risultano orari disponibili per ${selectedService.name} il ${formatItalianDate(date)}.`,

            confirmed: false,

            requiresConfirmation: false,

            availableSlots: [],

            availableDate:
              date,

            availableService:
              selectedService.name

          });

        }


        return res.status(200).json({

          reply:
            `Per ${selectedService.name} il ${formatItalianDate(date)} posso proporti questi orari disponibili:`,

          confirmed: false,

          requiresConfirmation: false,

          availableSlots:
            slots,

          availableDate:
            date,

          availableService:
            selectedService.name

        });

      }


      // --------------------------------------------
      // CONTROLLO ORARIO
      // --------------------------------------------

      const free =
        isAvailable(
          date,
          time,
          Number(
            selectedService.duration
          ) || 30
        );


      if (!free) {

        const alternatives =
          getAvailableSlots(
            date,
            selectedService.name,
            time
          );


        return res.status(200).json({

          reply:
            `L'orario ${time} non è disponibile per ${selectedService.name}.`,

          confirmed: false,

          requiresConfirmation: false,

          pendingAppointment: null,

          availableSlots:
            alternatives,

          availableDate:
            date,

          availableService:
            selectedService.name

        });

      }


      // --------------------------------------------
      // NOME
      // --------------------------------------------

      const name =
        safeString(
          clientName ||
          pendingAppointment?.name
        );


      // --------------------------------------------
      // PROPOSTA
      // --------------------------------------------

      const proposed = {

        name,

        date,

        time,

        service:
          selectedService.name

      };


      // Se il nome manca,
      // chiediamolo prima della conferma.

      if (!name) {

        return res.status(200).json({

          reply:
            `Ho verificato la disponibilità per ${selectedService.name} il ${formatItalianDate(date)} alle ${time}. Per procedere mi serve il nome del cliente.`,

          confirmed: false,

          requiresConfirmation: false,

          pendingAppointment:
            proposed

        });

      }


      return res.status(200).json({

        reply:
          `Ho verificato la disponibilità. Posso prenotare ${selectedService.name} per ${name} il ${formatItalianDate(date)} alle ${time}. Vuoi confermare?`,

        confirmed: false,

        requiresConfirmation: true,

        pendingAppointment:
          proposed

      });

    }


    // ========================================================
    // OPENAI
    // ========================================================

    const systemPrompt = `
Sei l'assistente virtuale di una piccola attività locale italiana.

Devi rispondere alle domande dei clienti usando esclusivamente
i dati forniti dall'attività.

DATI ATTIVITÀ

Nome:
${safeString(
  settings.name ||
  business
)}

Tipo:
${safeString(
  settings.type
)}

Descrizione:
${safeString(
  settings.description
)}

Indirizzo:
${safeString(
  settings.address
)}

Telefono:
${safeString(
  settings.phone
)}

WhatsApp:
${safeString(
  settings.whatsapp
)}

SERVIZI

${servicesText}

PROMOZIONI

${promotionsText}

ORARI

${JSON.stringify(
  hours,
  null,
  2
)}

APPUNTAMENTI

${JSON.stringify(
  cleanAppointments,
  null,
  2
)}

REGOLE:

- rispondi sempre in italiano;
- non inventare informazioni;
- non inventare servizi;
- non inventare prezzi;
- non inventare promozioni;
- non inventare orari;
- se un dato non è disponibile, dichiaralo;
- mantieni le risposte brevi e naturali;
- per le prenotazioni la conferma definitiva viene gestita dal sistema;
- non dichiarare mai una prenotazione confermata se il sistema non la conferma.
`;


    const userPrompt = `
MESSAGGIO DEL CLIENTE:

${safeString(message)}

NOME CLIENTE:

${safeString(clientName)}

PRENOTAZIONE IN ATTESA:

${
  pendingAppointment
    ? JSON.stringify(
        pendingAppointment,
        null,
        2
      )
    : "Nessuna"
}

CONFERMA ATTIVA:

${
  requiresConfirmation
    ? "SÌ"
    : "NO"
}

STORICO:

${JSON.stringify(
  safeArray(history).slice(-10),
  null,
  2
)}

Rispondi al cliente in modo breve e naturale.
`;


    const aiResult =
      await callOpenAI(
        systemPrompt +
        "\n\n" +
        userPrompt
      );


    return res.status(200).json({

      reply:
        aiResult,

      confirmed:
        false,

      requiresConfirmation:
        false

    });


  } catch (error) {

    console.error(
      "API CHAT ERROR:",
      error
    );

    return res.status(500).json({

      error:
        error?.message ||
        "Errore interno del server."

    });

  }

}


// ============================================================
// OPENAI RESPONSES API
// ============================================================

async function callOpenAI(
  prompt
) {

  const apiKey =
    process.env.OPENAI_API_KEY;


  const model =
    process.env.OPENAI_MODEL ||
    "gpt-5.6-luna";


  const response =
    await fetch(
      "https://api.openai.com/v1/responses",
      {

        method:
          "POST",

        headers: {

          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${apiKey}`

        },

        body:
          JSON.stringify({

            model,

            input:
              prompt,

            // CORRETTO:
            // NON usare max_tokens.
            max_output_tokens:
              1200

          })

      }
    );


  let data;

  try {

    data =
      await response.json();

  } catch {

    throw new Error(
      "Risposta non valida da OpenAI."
    );

  }


  if (!response.ok) {

    console.error(
      "OPENAI ERROR:",
      data
    );

    throw new Error(
      data?.error?.message ||
      "Errore OpenAI."
    );

  }


  // ========================================================
  // RISPOSTA DIRETTA
  // ========================================================

  if (
    typeof data.output_text ===
    "string"
  ) {

    return data.output_text.trim();

  }


  // ========================================================
  // FALLBACK
  // ========================================================

  try {

    const output =
      Array.isArray(data.output)
        ? data.output
        : [];


    for (
      const item
      of output
    ) {

      if (
        item.type !==
        "message"
      ) {
        continue;
      }


      const content =
        Array.isArray(
          item.content
        )
          ? item.content
          : [];


      for (
        const part
        of content
      ) {

        if (
          part.type ===
          "output_text"
        ) {

          const text =
            String(
              part.text || ""
            ).trim();


          if (text) {
            return text;
          }

        }

      }

    }

  } catch {
    // fallback finale
  }


  throw new Error(
    "OpenAI non ha restituito testo."
  );

}
