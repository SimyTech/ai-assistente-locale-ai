// api/chat.js

export default async function handler(req, res) {

  /* =========================================================
     CONFIGURAZIONE
  ========================================================= */

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo non consentito."
    });
  }

  try {

    const body = req.body || {};

    const {
      action,
      message,
      business,
      clientName,
      settings,
      services,
      appointments,
      promotions,
      history,
      pendingAppointment,
      requiresConfirmation,
      topic,
      promotion
    } = body;


    /* =======================================================
       NORMALIZZAZIONE DATI
    ======================================================= */

    const safeSettings =
      settings && typeof settings === "object"
        ? settings
        : {};

    const safeServices =
      Array.isArray(services)
        ? services
        : [];

    const safeAppointments =
      Array.isArray(appointments)
        ? appointments
        : [];

    const safePromotions =
      Array.isArray(promotions)
        ? promotions
        : [];

    const safeHistory =
      Array.isArray(history)
        ? history.slice(-20)
        : [];


    /* =======================================================
       UTILITY
    ======================================================= */

    const clean = value =>
      String(value ?? "").trim();

    const normalize = value =>
      clean(value)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");

    const getService = name => {

      const target =
        normalize(name);

      return safeServices.find(service =>
        normalize(service.name) === target
      );

    };

    const getAppointmentDate = appointment =>
      appointment?.date ||
      appointment?.d ||
      "";

    const getAppointmentTime = appointment =>
      appointment?.time ||
      appointment?.t ||
      "";

    const getAppointmentService = appointment =>
      appointment?.service ||
      appointment?.s ||
      "";

    const getAppointmentName = appointment =>
      appointment?.name ||
      appointment?.n ||
      "";


    /* =======================================================
       DATA E ORARI
    ======================================================= */

    const dayConfig = {
      sunday: "Domenica",
      monday: "Lunedì",
      tuesday: "Martedì",
      wednesday: "Mercoledì",
      thursday: "Giovedì",
      friday: "Venerdì",
      saturday: "Sabato"
    };

    function getDayName(date) {

      if (!date) {
        return null;
      }

      const d =
        new Date(date + "T12:00:00");

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


    function toMinutes(time) {

      if (
        !time ||
        !/^\d{2}:\d{2}$/.test(time)
      ) {
        return null;
      }

      const parts =
        time.split(":").map(Number);

      if (
        parts.length !== 2 ||
        parts.some(Number.isNaN)
      ) {
        return null;
      }

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


    function getDaySettings(date) {

      const dayName =
        getDayName(date);

      if (!dayName) {
        return null;
      }

      return safeSettings
        ?.hours
        ?.[dayName] || null;
    }


    function isBreak(day, start, end) {

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


    /* =======================================================
       CONTROLLO DISPONIBILITÀ
    ======================================================= */

    function isAppointmentFree(
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

      const serviceDuration =
        Number(duration) || 30;

      if (
        opening === null ||
        closing === null ||
        start === null
      ) {
        return false;
      }

      const end =
        start + serviceDuration;

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

      return !safeAppointments.some(
        appointment => {

          if (
            getAppointmentDate(
              appointment
            ) !== date
          ) {
            return false;
          }

          const existingStart =
            toMinutes(
              getAppointmentTime(
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
              getAppointmentService(
                appointment
              )
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


    /* =======================================================
       GENERAZIONE SLOT
    ======================================================= */

    function getAvailableSlots(
      date,
      serviceName
    ) {

      const service =
        getService(serviceName);

      const duration =
        service
          ? Number(service.duration) || 30
          : 30;

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
        closing === null ||
        opening >= closing
      ) {
        return [];
      }

      const slots = [];

      /*
       * Gli slot vengono proposti a intervalli
       * di 30 minuti, come il calendario dell'app.
       */
      for (
        let minutes = opening;
        minutes < closing;
        minutes += 30
      ) {

        const time =
          formatTime(minutes);

        if (
          isAppointmentFree(
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


    /* =======================================================
       DATA CORRENTE
    ======================================================= */

    function todayISO() {

      const now =
        new Date();

      return (
        now.getFullYear() +
        "-" +
        String(
          now.getMonth() + 1
        ).padStart(2, "0") +
        "-" +
        String(
          now.getDate()
        ).padStart(2, "0")
      );

    }


    /* =======================================================
       RICONOSCIMENTO DATA
    ======================================================= */

    function extractDate(text) {

      const value =
        clean(text);

      /*
       * YYYY-MM-DD
       */
      const iso =
        value.match(
          /\b(20\d{2}-\d{2}-\d{2})\b/
        );

      if (iso) {
        return iso[1];
      }

      /*
       * DD/MM/YYYY
       */
      const italian =
        value.match(
          /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/
        );

      if (italian) {

        const day =
          String(
            Number(italian[1])
          ).padStart(2, "0");

        const month =
          String(
            Number(italian[2])
          ).padStart(2, "0");

        return (
          italian[3] +
          "-" +
          month +
          "-" +
          day
        );

      }

      const lower =
        normalize(value);

      const now =
        new Date();

      if (
        lower.includes("oggi")
      ) {
        return todayISO();
      }

      if (
        lower.includes("domani")
      ) {

        const d =
          new Date();

        d.setDate(
          d.getDate() + 1
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

      }

      /*
       * Giorni della settimana.
       */

      const weekdayMap = {
        lunedi: 1,
        martedi: 2,
        mercoledi: 3,
        giovedi: 4,
        venerdi: 5,
        sabato: 6,
        domenica: 0
      };

      for (
        const [name, targetDay]
        of Object.entries(weekdayMap)
      ) {

        if (
          lower.includes(name)
        ) {

          const d =
            new Date();

          const current =
            d.getDay();

          let difference =
            targetDay - current;

          if (
            difference <= 0
          ) {
            difference += 7;
          }

          d.setDate(
            d.getDate() +
            difference
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

        }

      }

      return null;

    }


    /* =======================================================
       RICONOSCIMENTO ORARIO
    ======================================================= */

    function extractTime(text) {

      const match =
        clean(text).match(
          /\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/
        );

      if (!match) {
        return null;
      }

      return (
        String(
          Number(match[1])
        ).padStart(2, "0") +
        ":" +
        match[2]
      );

    }


    /* =======================================================
       RICONOSCIMENTO SERVIZIO
    ======================================================= */

    function detectService(text) {

      const normalizedText =
        normalize(text);

      let best = null;

      for (
        const service
        of safeServices
      ) {

        const serviceName =
          normalize(service.name);

        if (
          serviceName &&
          normalizedText.includes(
            serviceName
          )
        ) {

          best = service;
          break;

        }

      }

      return best;

    }


    /* =======================================================
       RICONOSCIMENTO NOME CLIENTE
    ======================================================= */

    function resolveClientName() {

      if (
        clean(clientName)
      ) {
        return clean(clientName);
      }

      if (
        pendingAppointment?.name
      ) {
        return clean(
          pendingAppointment.name
        );
      }

      return "";

    }


    /* =======================================================
       CONTROLLO CONFERMA
    ======================================================= */

    function isConfirmation(text) {

      const value =
        normalize(text);

      const phrases = [
        "confermo",
        "conferma",
        "confermare",
        "si confermo",
        "sì confermo",
        "va bene",
        "ok confermo",
        "prenota",
        "prenotalo",
        "prenotala",
        "fissalo",
        "fissala",
        "procedi"
      ];

      return phrases.some(
        phrase =>
          value === phrase ||
          value.includes(phrase)
      );

    }


    /* =======================================================
       CONTROLLO ANNULLAMENTO
    ======================================================= */

    function isCancellation(text) {

      const value =
        normalize(text);

      const phrases = [
        "annulla",
        "annullare",
        "cancella",
        "cancellare",
        "non confermo",
        "lascia perdere",
        "non prenotare"
      ];

      return phrases.some(
        phrase =>
          value === phrase ||
          value.includes(phrase)
      );

    }


    /* =======================================================
       RISPOSTA LOCALE
    ======================================================= */

    function localBusinessInfo() {

      const name =
        clean(
          safeSettings.name ||
          business ||
          "Attività locale"
        );

      const type =
        clean(
          safeSettings.type
        );

      const description =
        clean(
          safeSettings.description
        );

      const address =
        clean(
          safeSettings.address
        );

      const phone =
        clean(
          safeSettings.phone
        );

      const whatsapp =
        clean(
          safeSettings.whatsapp
        );

      const lines = [
        name,
        type
          ? `Tipo: ${type}`
          : "",
        description
          ? `Descrizione: ${description}`
          : "",
        address
          ? `Indirizzo: ${address}`
          : "",
        phone
          ? `Telefono: ${phone}`
          : "",
        whatsapp
          ? `WhatsApp: ${whatsapp}`
          : ""
      ];

      return lines
        .filter(Boolean)
        .join("\n");

    }


    function servicesInfo() {

      if (
        !safeServices.length
      ) {
        return "Nessun servizio configurato.";
      }

      return safeServices
        .map(service => {

          const parts = [
            service.name
          ];

          if (
            service.category
          ) {
            parts.push(
              `Categoria: ${service.category}`
            );
          }

          if (
            service.price !== undefined &&
            service.price !== null &&
            service.price !== ""
          ) {
            parts.push(
              `Prezzo: €${Number(
                service.price
              ).toFixed(2)}`
            );
          }

          if (
            service.duration !== undefined &&
            service.duration !== null
          ) {
            parts.push(
              `Durata: ${service.duration} minuti`
            );
          }

          if (
            service.description
          ) {
            parts.push(
              `Descrizione: ${service.description}`
            );
          }

          return parts.join(" — ");

        })
        .join("\n");

    }


    function promotionsInfo() {

      if (
        !safePromotions.length
      ) {
        return "Nessuna promozione configurata.";
      }

      return safePromotions
        .map(promotionItem => {

          const parts = [];

          if (
            promotionItem.title
          ) {
            parts.push(
              promotionItem.title
            );
          }

          if (
            promotionItem.category
          ) {
            parts.push(
              `Categoria: ${promotionItem.category}`
            );
          }

          if (
            promotionItem.description
          ) {
            parts.push(
              promotionItem.description
            );
          }

          if (
            promotionItem.price !== undefined &&
            promotionItem.price !== null &&
            promotionItem.price !== ""
          ) {
            parts.push(
              `€${Number(
                promotionItem.price
              ).toFixed(2)}`
            );
          }

          if (
            promotionItem.expiry
          ) {
            parts.push(
              `Valida fino al ${promotionItem.expiry}`
            );
          }

          return parts.join(" — ");

        })
        .join("\n");

    }


    /* =======================================================
       RISPOSTA ORARI
    ======================================================= */

    function hoursInfo() {

      if (
        !safeSettings.hours
      ) {
        return "Gli orari non sono configurati.";
      }

      const result = [];

      for (
        const [day, label]
        of Object.entries(dayConfig)
      ) {

        const data =
          safeSettings.hours[day];

        if (
          !data ||
          data.status === "closed"
        ) {

          result.push(
            `${label}: chiuso`
          );

          continue;

        }

        let text =
          `${label}: ${data.open || "?"} - ${data.close || "?"}`;

        if (
          data.breakStart &&
          data.breakEnd
        ) {

          text +=
            `, pausa ${data.breakStart} - ${data.breakEnd}`;

        }

        result.push(text);

      }

      return result.join("\n");

    }


    /* =======================================================
       RILEVAMENTO RICHIESTE DI PRENOTAZIONE
    ======================================================= */

    function isBookingIntent(text) {

      const value =
        normalize(text);

      const keywords = [
        "appuntamento",
        "prenotazione",
        "prenota",
        "prenotare",
        "fissare",
        "fissa",
        "disponibilita",
        "disponibile",
        "orario",
        "slot",
        "taglio",
        "piega",
        "colore",
        "barba",
        "trattamento"
      ];

      return keywords.some(
        keyword =>
          value.includes(keyword)
      );

    }


    /* =======================================================
       RICHIESTA DISPONIBILITÀ
    ======================================================= */

    async function handleAvailability(
      text
    ) {

      const date =
        extractDate(text);

      const service =
        detectService(text);

      if (
        !date
      ) {
        return null;
      }

      const slots =
        getAvailableSlots(
          date,
          service?.name
        );

      return {
        reply:
          slots.length
            ? `Per ${new Date(
                date + "T12:00:00"
              ).toLocaleDateString(
                "it-IT",
                {
                  weekday: "long",
                  day: "numeric",
                  month: "long"
                }
              )}${
                service
                  ? ` per ${service.name}`
                  : ""
              } ho questi orari disponibili:`
            : `Non risultano orari disponibili per quella giornata${
                service
                  ? ` per ${service.name}`
                  : ""
              }.`,
        availableSlots:
          slots,
        availableDate:
          date,
        availableService:
          service?.name || ""
      };

    }


    /* =======================================================
       CREAZIONE PROPOSTA APPUNTAMENTO
    ======================================================= */

    function createPendingAppointment(
      text
    ) {

      const service =
        detectService(text);

      const date =
        extractDate(text);

      const time =
        extractTime(text);

      const name =
        resolveClientName();

      if (
        !service ||
        !date ||
        !time ||
        !name
      ) {
        return null;
      }

      const duration =
        Number(
          service.duration
        ) || 30;

      if (
        !isAppointmentFree(
          date,
          time,
          duration
        )
      ) {
        return {
          unavailable: true,
          date,
          time,
          service
        };
      }

      return {
        name,
        date,
        time,
        service: service.name,
        duration,
        price:
          service.price ?? null
      };

    }


    /* =======================================================
       CONTROLLO DUPLICATO
    ======================================================= */

    function appointmentAlreadyExists(
      appointment
    ) {

      if (!appointment) {
        return false;
      }

      return safeAppointments.some(
        existing => {

          const sameDate =
            getAppointmentDate(
              existing
            ) === appointment.date;

          const sameTime =
            getAppointmentTime(
              existing
            ) === appointment.time;

          const sameService =
            normalize(
              getAppointmentService(
                existing
              )
            ) ===
            normalize(
              appointment.service
            );

          const sameName =
            normalize(
              getAppointmentName(
                existing
              )
            ) ===
            normalize(
              appointment.name
            );

          return (
            sameDate &&
            sameTime &&
            sameService &&
            sameName
          );

        }
      );

    }


    /* =======================================================
       CONFERMA PRENOTAZIONE
    ======================================================= */

    function confirmPendingAppointment() {

      if (
        !pendingAppointment
      ) {
        return {
          error:
            "Non c'è nessun appuntamento in attesa di conferma."
        };
      }

      const appointment =
        pendingAppointment;

      const service =
        getService(
          appointment.service
        );

      if (!service) {
        return {
          error:
            "Il servizio dell'appuntamento non è più disponibile."
        };
      }

      const duration =
        Number(
          service.duration
        ) || 30;

      /*
       * Ricontrollo disponibilità.
       */
      if (
        !isAppointmentFree(
          appointment.date,
          appointment.time,
          duration
        )
      ) {

        return {
          error:
            `L'orario ${appointment.time} non è più disponibile.`
        };

      }

      /*
       * Ricontrollo duplicato.
       */
      if (
        appointmentAlreadyExists(
          appointment
        )
      ) {

        return {
          error:
            "Questo appuntamento risulta già presente."
        };

      }

      /*
       * L'API non salva direttamente nel localStorage:
       * restituisce al client una prenotazione confermata.
       *
       * Sarà l'index.html a effettuare il salvataggio
       * dopo confirmed:true.
       */

      return {
        confirmed: true,

        appointment: {

          bookingKey:
            appointment.date +
            "_" +
            appointment.time +
            "_" +
            normalize(
              appointment.service
            ),

          name:
            appointment.name,

          date:
            appointment.date,

          time:
            appointment.time,

          service:
            service.name,

          duration,

          price:
            service.price ?? null

        },

        reply:
          `Appuntamento confermato per ${appointment.name}: ${service.name}, ${appointment.date} alle ${appointment.time}.`

      };

    }


    /* =======================================================
       CANCELLAZIONE
    ======================================================= */

    function cancelPendingAppointment() {

      return {
        confirmed: false,
        requiresConfirmation: false,
        pendingAppointment: null,
        reply:
          "Appuntamento annullato. Non è stato effettuato alcun salvataggio."
      };

    }


    /* =======================================================
       POST AI
    ======================================================= */

    if (
      action === "post"
    ) {

      const postTopic =
        clean(
          topic
        ) ||
        "una nuova promozione";

      const businessName =
        clean(
          safeSettings.name ||
          business ||
          "Attività locale"
        );

      /*
       * Per la generazione del post utilizziamo
       * OpenAI perché è effettivamente una richiesta
       * creativa/complessa.
       */

      const apiKey =
        process.env.OPENAI_API_KEY;

      if (!apiKey) {

        return res.status(500).json({
          error:
            "OPENAI_API_KEY non configurata."
        });

      }

      const systemPrompt = `
Sei il social media manager di una piccola attività locale italiana.

Scrivi post Facebook/Instagram naturali, professionali e semplici.

Non inventare:
- prezzi
- servizi
- promozioni
- indirizzi
- numeri di telefono
- date
- condizioni commerciali

Usa esclusivamente i dati forniti.

Il post deve:
- attirare l'attenzione;
- presentare chiaramente l'argomento;
- essere facile da leggere;
- avere una call to action naturale;
- evitare linguaggio artificiale o eccessivamente pubblicitario.

Attività:
${businessName}

Tipo:
${safeSettings.type || ""}

Descrizione:
${safeSettings.description || ""}

Servizi:
${servicesInfo()}

Promozioni:
${promotionsInfo()}

Argomento richiesto:
${postTopic}
`;

      const response =
        await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              "Authorization":
                `Bearer ${apiKey}`
            },

            body:
              JSON.stringify({

                model:
                  "gpt-5.4-mini",

                messages: [
                  {
                    role:
                      "system",
                    content:
                      systemPrompt
                  }
                ],

                temperature:
                  0.7,

                max_tokens:
                  700

              })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {

        return res.status(
          response.status
        ).json({
          error:
            data?.error?.message ||
            "Errore OpenAI."
        });

      }

      const reply =
        data?.choices?.[0]?.message?.content ||
        "";

      return res.status(200).json({
        reply:
          reply.trim()
      });

    }


    /* =======================================================
       CHAT NORMALE
    ======================================================= */

    const text =
      clean(message);

    if (!text) {

      return res.status(400).json({
        error:
          "Messaggio mancante."
      });

    }


    /* =======================================================
       1. GESTIONE CONFERMA PENDENTE
    ======================================================= */

    if (
      pendingAppointment &&
      requiresConfirmation
    ) {

      if (
        isConfirmation(text)
      ) {

        const result =
          confirmPendingAppointment();

        if (
          result.error
        ) {

          return res.status(200).json({
            reply:
              result.error,
            confirmed:
              false,
            requiresConfirmation:
              true,
            pendingAppointment
          });

        }

        return res.status(200).json({
          reply:
            result.reply,

          confirmed:
            true,

          requiresConfirmation:
            false,

          pendingAppointment:
            null,

          appointment:
            result.appointment
        });

      }


      if (
        isCancellation(text)
      ) {

        return res.status(200).json(
          cancelPendingAppointment()
        );

      }

      /*
       * Se esiste già una prenotazione pendente
       * ma il cliente invia un'altra informazione,
       * manteniamo la prenotazione in attesa.
       */

      return res.status(200).json({

        reply:
          `Ho preparato questo appuntamento:\n\n` +
          `Cliente: ${pendingAppointment.name}\n` +
          `Servizio: ${pendingAppointment.service}\n` +
          `Data: ${pendingAppointment.date}\n` +
          `Orario: ${pendingAppointment.time}\n\n` +
          `Confermi la prenotazione?`,

        pendingAppointment,

        requiresConfirmation:
          true

      });

    }


    /* =======================================================
       2. RICHIESTA DISPONIBILITÀ
    ======================================================= */

    if (
      isBookingIntent(text)
    ) {

      const availability =
        await handleAvailability(
          text
        );

      /*
       * Se è una semplice richiesta di
       * disponibilità, rispondiamo direttamente.
       */
      if (
        availability &&
        !extractTime(text)
      ) {

        return res.status(200).json(
          availability
        );

      }

    }


    /* =======================================================
       3. CREAZIONE PRENOTAZIONE PENDENTE
    ======================================================= */

    if (
      isBookingIntent(text)
    ) {

      const candidate =
        createPendingAppointment(
          text
        );

      if (
        candidate?.unavailable
      ) {

        const slots =
          getAvailableSlots(
            candidate.date,
            candidate.service.name
          );

        return res.status(200).json({

          reply:
            slots.length
              ? `L'orario ${candidate.time} non è disponibile. Questi sono gli orari disponibili per ${candidate.service.name}:`
              : `L'orario ${candidate.time} non è disponibile e non risultano altri orari liberi per quella giornata.`,

          availableSlots:
            slots,

          availableDate:
            candidate.date,

          availableService:
            candidate.service.name

        });

      }


      if (
        candidate
      ) {

        return res.status(200).json({

          reply:
            `Ho preparato la prenotazione:\n\n` +
            `Cliente: ${candidate.name}\n` +
            `Servizio: ${candidate.service}\n` +
            `Data: ${candidate.date}\n` +
            `Orario: ${candidate.time}\n` +
            `${
              candidate.price !== null &&
              candidate.price !== undefined
                ? `Prezzo: €${Number(
                    candidate.price
                  ).toFixed(2)}\n`
                : ""
            }\n` +
            `Confermi la prenotazione?`,

          pendingAppointment:
            candidate,

          requiresConfirmation:
            true

        });

      }

    }


    /* =======================================================
       4. RISPOSTE LOCALI SEMPLICI
    ======================================================= */

    const normalizedText =
      normalize(text);


    /*
     * SERVIZI
     */

    if (
      normalizedText.includes("servizi") ||
      normalizedText.includes("trattamenti") ||
      normalizedText.includes("cosa fate") ||
      normalizedText.includes("cosa offrite")
    ) {

      return res.status(200).json({

        reply:
          `Ecco i servizi disponibili:\n\n${servicesInfo()}`

      });

    }


    /*
     * PROMOZIONI
     */

    if (
      normalizedText.includes("promozioni") ||
      normalizedText.includes("offerte") ||
      normalizedText.includes("sconti") ||
      normalizedText.includes("promo")
    ) {

      return res.status(200).json({

        reply:
          `Le promozioni attualmente configurate sono:\n\n${promotionsInfo()}`

      });

    }


    /*
     * ORARI
     */

    if (
      normalizedText.includes("orari") ||
      normalizedText.includes("quando siete aperti") ||
      normalizedText.includes("quando siete aperte") ||
      normalizedText.includes("a che ora")
    ) {

      return res.status(200).json({

        reply:
          `Gli orari dell'attività sono:\n\n${hoursInfo()}`

      });

    }


    /*
     * CONTATTI / INDIRIZZO
     */

    if (
      normalizedText.includes("indirizzo") ||
      normalizedText.includes("dove siete") ||
      normalizedText.includes("dove siete") ||
      normalizedText.includes("telefono") ||
      normalizedText.includes("whatsapp") ||
      normalizedText.includes("contatti")
    ) {

      return res.status(200).json({

        reply:
          localBusinessInfo()

      });

    }


    /*
     * PREZZO DI UN SERVIZIO
     */

    const detectedService =
      detectService(text);

    if (
      detectedService &&
      (
        normalizedText.includes("prezzo") ||
        normalizedText.includes("costa") ||
        normalizedText.includes("quanto")
      )
    ) {

      return res.status(200).json({

        reply:
          `${detectedService.name} costa €${Number(
            detectedService.price || 0
          ).toFixed(2)} e dura circa ${Number(
            detectedService.duration || 30
          )} minuti.${
            detectedService.description
              ? `\n\n${detectedService.description}`
              : ""
          }`

      });

    }


    /* =======================================================
       5. OPENAI SOLO PER RICHIESTE COMPLESSE
    ======================================================= */

    const apiKey =
      process.env.OPENAI_API_KEY;

    if (!apiKey) {

      return res.status(200).json({

        reply:
          "Posso aiutarti con servizi, prezzi, promozioni, orari, contatti e appuntamenti. Per questa richiesta più complessa è necessario configurare l'assistente AI."

      });

    }


    const systemPrompt = `
Sei l'assistente digitale di una piccola attività locale italiana.

Devi rispondere ai clienti in modo:
- professionale;
- naturale;
- breve;
- chiaro;
- utile.

NON inventare informazioni.

Puoi utilizzare esclusivamente i dati forniti qui sotto.

ATTIVITÀ
${localBusinessInfo()}

ORARI
${hoursInfo()}

SERVIZI
${servicesInfo()}

PROMOZIONI
${promotionsInfo()}

APPUNTAMENTI GIÀ PRESENTI
${
  safeAppointments.length
    ? safeAppointments
        .map(a =>
          `${getAppointmentDate(a)} ${getAppointmentTime(a)} — ${getAppointmentName(a)} — ${getAppointmentService(a)}`
        )
        .join("\n")
    : "Nessun appuntamento."
}

REGOLE IMPORTANTI

1. Non inventare prezzi.
2. Non inventare servizi.
3. Non inventare promozioni.
4. Non inventare orari.
5. Non confermare un appuntamento autonomamente.
6. Un appuntamento deve sempre essere proposto e poi confermato esplicitamente dal cliente.
7. Se il cliente chiede qualcosa che non sai, dichiaralo chiaramente.
8. Non dire che hai eseguito un'azione se non è stata realmente eseguita.
9. Per le prenotazioni devi rispettare sempre disponibilità, durata del servizio, orari e pause.
10. Non modificare o cancellare appuntamenti esistenti senza una richiesta esplicita.
`;

    const messages = [
      {
        role:
          "system",
        content:
          systemPrompt
      },

      ...safeHistory
        .filter(item =>
          item &&
          (
            item.role === "user" ||
            item.role === "assistant"
          )
        )
        .map(item => ({
          role:
            item.role,
          content:
            clean(item.content)
        })),

      {
        role:
          "user",
        content:
          text
      }
    ];

    const response =
      await fetch(
        "https://api.openai.com/v1/chat/completions",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "Authorization":
              `Bearer ${apiKey}`
          },

          body:
            JSON.stringify({

              model:
                "gpt-5.4-mini",

              messages,

              temperature:
                0.2,

              max_tokens:
                700

            })
        }
      );

    const data =
      await response.json();

    if (!response.ok) {

      return res.status(
        response.status
      ).json({

        error:
          data?.error?.message ||
          "Errore durante la comunicazione con OpenAI."

      });

    }

    const reply =
      data?.choices?.[0]?.message?.content ||
      "Non ho trovato una risposta.";

    return res.status(200).json({

      reply:
        reply.trim(),

      confirmed:
        false,

      requiresConfirmation:
        false

    });


  } catch (error) {

    console.error(
      "CHAT API ERROR:",
      error
    );

    return res.status(500).json({

      error:
        error?.message ||
        "Errore interno del server."

    });

  }

}
