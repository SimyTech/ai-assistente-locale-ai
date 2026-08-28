// ============================================================
// api/chat.js
// AI Assistente Locale
// Versione definitiva
// ============================================================

export default async function handler(req, res) {

  // ----------------------------------------------------------
  // METODO
  // ----------------------------------------------------------

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo non consentito."
    });
  }

  // ----------------------------------------------------------
  // API KEY
  // ----------------------------------------------------------

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
    // FUNZIONI DI SUPPORTO
    // ========================================================

    const safeArray = value =>
      Array.isArray(value) ? value : [];


    const safeString = value =>
      String(value ?? "").trim();


    const cleanServices =
      safeArray(services)
        .map(service => ({
          id: service.id || null,
          name: safeString(service.name),
          category: safeString(service.category),
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
            safeString(service.description)
        }))
        .filter(service => service.name);


    const cleanPromotions =
      safeArray(promotions)
        .map(promotion => ({
          id: promotion.id || null,

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


    const dayNames = {
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

      const names = [
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday"
      ];

      return names[d.getDay()];
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


    function getService(name) {

      if (!name) {
        return null;
      }

      return cleanServices.find(
        service =>
          service.name.toLowerCase() ===
          String(name)
            .trim()
            .toLowerCase()
      ) || null;
    }


    // ========================================================
    // CONTROLLO PAUSA
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
        breakEnd === null
      ) {
        return false;
      }

      return (
        start < breakEnd &&
        end > breakStart
      );
    }


    // ========================================================
    // CONTROLLO DISPONIBILITÀ
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


      // --------------------------------------------
      // APPUNTAMENTI ESISTENTI
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
    // GENERAZIONE ORARI DISPONIBILI
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
        closing === null
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

      // --------------------------------------------
      // Se è stato richiesto un orario specifico,
      // mettiamolo in cima se disponibile.
      // --------------------------------------------

      if (
        requestedTime &&
        slots.includes(
          requestedTime
        )
      ) {

        return [
          requestedTime,
          ...slots.filter(
            time =>
              time !== requestedTime
          )
        ];
      }

      return slots;
    }


    // ========================================================
    // DATA ITALIANA
    // ========================================================

    function formatItalianDate(
      date
    ) {

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
    // RIEPILOGO SERVIZI
    // ========================================================

    const servicesText =
      cleanServices.length

        ? cleanServices
            .map(service => {

              let text =
                `${service.name}`;

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
    // RIEPILOGO PROMOZIONI
    // ========================================================

    const promotionsText =
      cleanPromotions.length

        ? cleanPromotions
            .map(promotion => {

              let text =
                `${promotion.title}`;

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

Crea un post per Facebook/Instagram.

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
- tono professionale ma naturale;
- niente informazioni inventate;
- usa solo prezzi, servizi e promozioni presenti nei dati;
- non inventare indirizzi, telefoni o offerte;
- evita testi troppo lunghi;
- rendi il post adatto ai social;
- usa una call to action semplice;
- puoi utilizzare pochi emoji se appropriato.

Restituisci solamente il testo del post.
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
    // DOMANDA SEMPLICE SUI DATI
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
      !normalizedMessage.includes(
        "prenot"
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
              `${service.name}`;

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


    if (
      asksPromotions &&
      !normalizedMessage.includes(
        "prenot"
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
    // CHIAMATA OPENAI
    // ========================================================

    const systemPrompt = `
Sei l'assistente virtuale di una piccola attività locale italiana.

Il tuo compito è aiutare i clienti con:

- informazioni sull'attività;
- servizi;
- trattamenti;
- prezzi;
- durata;
- promozioni;
- orari;
- disponibilità;
- prenotazioni.

DATI ATTIVITÀ:

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

SERVIZI:

${servicesText}

PROMOZIONI:

${promotionsText}

ORARI:

${JSON.stringify(
  hours,
  null,
  2
)}

APPUNTAMENTI GIÀ PRESENTI:

${JSON.stringify(
  cleanAppointments,
  null,
  2
)}


REGOLE IMPORTANTI:

1. Non inventare servizi.

2. Non inventare prezzi.

3. Non inventare promozioni.

4. Non inventare orari.

5. Usa esclusivamente i dati ricevuti.

6. Se il cliente chiede un servizio inesistente,
   comunica che non risulta disponibile.

7. Per le prenotazioni devi raccogliere:
   - nome cliente;
   - servizio;
   - data;
   - orario.

8. Prima della conferma non considerare
   l'appuntamento definitivamente prenotato.

9. Se il cliente sceglie un orario disponibile,
   prepara una proposta di appuntamento.

10. La prenotazione definitiva deve avvenire
    solamente dopo una conferma esplicita del cliente.

11. Se il cliente dice "confermo",
    "conferma",
    "va bene",
    "sì confermo",
    o equivalente e c'è una prenotazione
    in attesa, considera la prenotazione confermata.

12. Se l'orario richiesto non è disponibile,
    proponi altri orari realmente disponibili.

13. Non dire mai che un appuntamento è stato
    salvato definitivamente prima della conferma.

14. Rispondi sempre in italiano.

15. Sii breve e naturale.
`;


    // ========================================================
    // PROMPT OPERATIVO
    // ========================================================

    const userPrompt = `
MESSAGGIO DEL CLIENTE:

${safeString(message)}

NOME CLIENTE:
${safeString(clientName)}

PRENOTAZIONE IN ATTESA:

${pendingAppointment
  ? JSON.stringify(
      pendingAppointment,
      null,
      2
    )
  : "Nessuna prenotazione in attesa."}

RICHIESTA DI CONFERMA ATTIVA:

${requiresConfirmation
  ? "SÌ"
  : "NO"}

STORICO CONVERSAZIONE:

${JSON.stringify(
  safeArray(history)
    .slice(-10),
  null,
  2
)}

Rispondi al cliente.
`;


    const aiResult =
      await callOpenAI(
        systemPrompt +
        "\n\n" +
        userPrompt
      );


    // ========================================================
    // ANALISI RISPOSTA AI
    // ========================================================

    const result =
      parseBookingIntent(
        aiResult,
        message,
        clientName,
        pendingAppointment,
        requiresConfirmation
      );


    // ========================================================
    // CONFERMA APPUNTAMENTO
    // ========================================================

    if (
      result.confirmed &&
      result.appointment
    ) {

      const appointment =
        result.appointment;


      // --------------------------------------------
      // Controllo servizio
      // --------------------------------------------

      const service =
        getService(
          appointment.service
        );

      if (!service) {

        return res.status(200).json({

          reply:
            "Non posso confermare la prenotazione perché il servizio indicato non risulta disponibile.",

          confirmed: false,

          requiresConfirmation:
            true,

          pendingAppointment:
            pendingAppointment

        });

      }


      // --------------------------------------------
      // Controllo disponibilità
      // --------------------------------------------

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

          requiresConfirmation:
            true,

          pendingAppointment:
            appointment,

          availableSlots:
            alternatives,

          availableDate:
            appointment.date,

          availableService:
            service.name

        });

      }


      // --------------------------------------------
      // Prenotazione confermata
      // --------------------------------------------

      return res.status(200).json({

        reply:
          `Appuntamento confermato per ${appointment.name} il ${formatItalianDate(appointment.date)} alle ${appointment.time} per ${service.name}.`,

        confirmed: true,

        requiresConfirmation:
          false,

        pendingAppointment:
          null,

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
    // NUOVA PROPOSTA DI PRENOTAZIONE
    // ========================================================

    if (
      result.appointment &&
      result.hasAppointmentData
    ) {

      const appointment =
        result.appointment;

      const service =
        getService(
          appointment.service
        );


      if (!service) {

        return res.status(200).json({

          reply:
            "Il servizio richiesto non risulta configurato. Posso mostrarti i servizi disponibili.",

          confirmed: false,

          requiresConfirmation:
            false

        });

      }


      // --------------------------------------------
      // Se manca la data
      // --------------------------------------------

      if (
        !appointment.date
      ) {

        return res.status(200).json({

          reply:
            "Per procedere con la prenotazione ho bisogno della data.",

          confirmed: false,

          requiresConfirmation:
            false

        });

      }


      // --------------------------------------------
      // Se manca l'orario
      // --------------------------------------------

      if (
        !appointment.time
      ) {

        const slots =
          getAvailableSlots(
            appointment.date,
            service.name
          );

        return res.status(200).json({

          reply:
            `Per ${service.name} il ${formatItalianDate(appointment.date)} posso proporti questi orari disponibili:`,

          confirmed: false,

          requiresConfirmation:
            false,

          availableSlots:
            slots,

          availableDate:
            appointment.date,

          availableService:
            service.name

        });

      }


      // --------------------------------------------
      // Controllo disponibilità
      // --------------------------------------------

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
            `L'orario ${appointment.time} non è disponibile per ${service.name}.`,

          confirmed: false,

          requiresConfirmation:
            false,

          availableSlots:
            alternatives,

          availableDate:
            appointment.date,

          availableService:
            service.name

        });

      }


      // --------------------------------------------
      // Proposta con conferma
      // --------------------------------------------

      const proposed = {

        name:
          appointment.name ||
          clientName ||
          "",

        date:
          appointment.date,

        time:
          appointment.time,

        service:
          service.name

      };


      return res.status(200).json({

        reply:
          `Ho verificato la disponibilità. Posso prenotare ${service.name} per ${proposed.name || "il cliente"} il ${formatItalianDate(proposed.date)} alle ${proposed.time}. Vuoi confermare?`,

        confirmed: false,

        requiresConfirmation:
          true,

        pendingAppointment:
          proposed

      });

    }


    // ========================================================
    // RISPOSTA NORMALE
    // ========================================================

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
// OPENAI
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

        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "Authorization":
            `Bearer ${apiKey}`

        },

        body:
          JSON.stringify({

            model,

            input: prompt,

            // IMPORTANTE:
            // NON usare max_tokens.
            // Per questo modello utilizziamo
            // max_output_tokens.

            max_output_tokens: 1200

          })

      }
    );


  const data =
    await response.json();


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


  // ----------------------------------------------------------
  // Responses API
  // ----------------------------------------------------------

  if (
    typeof data.output_text ===
    "string"
  ) {

    return data.output_text.trim();

  }


  // ----------------------------------------------------------
  // Fallback
  // ----------------------------------------------------------

  try {

    const output =
      data.output || [];

    for (
      const item
      of output
    ) {

      if (
        item.type ===
        "message"
      ) {

        const content =
          item.content || [];

        for (
          const part
          of content
        ) {

          if (
            part.type ===
            "output_text"
          ) {

            return String(
              part.text || ""
            ).trim();

          }

        }

      }

    }

  } catch {}

  throw new Error(
    "OpenAI non ha restituito testo."
  );
}


// ============================================================
// ANALIZZATORE PRENOTAZIONE
// ============================================================

function parseBookingIntent(
  aiText,
  userMessage,
  clientName,
  pendingAppointment,
  requiresConfirmation
) {

  const text =
    String(
      userMessage || ""
    ).trim();


  const lower =
    text.toLowerCase();


  // ----------------------------------------------------------
  // CONFERMA
  // ----------------------------------------------------------

  const confirmationWords = [
    "confermo",
    "conferma",
    "confermare",
    "sì confermo",
    "si confermo",
    "va bene",
    "ok confermo",
    "ok",
    "perfetto confermo",
    "procedi",
    "procediamo"
  ];


  const isConfirmation =
    confirmationWords.some(
      word =>
        lower === word ||
        lower.includes(
          word
        )
    );


  if (
    isConfirmation &&
    pendingAppointment &&
    requiresConfirmation
  ) {

    return {

      confirmed:
        true,

      hasAppointmentData:
        true,

      appointment:
        normalizeAppointment(
          pendingAppointment,
          clientName
        )

    };

  }


  // ----------------------------------------------------------
  // ANNULLAMENTO
  // ----------------------------------------------------------

  const cancellationWords = [
    "annulla",
    "annullare",
    "annullo",
    "non confermo",
    "lascia perdere",
    "no"
  ];


  const isCancellation =
    cancellationWords.some(
      word =>
        lower === word ||
        lower.includes(
          word
        )
    );


  if (
    isCancellation &&
    pendingAppointment &&
    requiresConfirmation
  ) {

    return {

      confirmed:
        false,

      hasAppointmentData:
        false,

      appointment:
        null

    };

  }


  // ----------------------------------------------------------
  // ESTRAZIONE DATI SEMPLICE
  // ----------------------------------------------------------

  const dateMatch =
    text.match(
      /\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/
    );


  let date =
    null;


  if(dateMatch){

    date =
      `${dateMatch[1]}-` +
      `${String(
        dateMatch[2]
      ).padStart(2,"0")}-` +
      `${String(
        dateMatch[3]
      ).padStart(2,"0")}`;

  }


  // ----------------------------------------------------------
  // ORARIO
  // ----------------------------------------------------------

  const timeMatch =
    text.match(
      /\b([01]?\d|2[0-3])(?:[:\.](\d{2}))?\b/
    );


  let time =
    null;


  if(timeMatch){

    const hour =
      Number(
        timeMatch[1]
      );

    const minute =
      timeMatch[2]
        ? Number(
            timeMatch[2]
          )
        : 0;

    if(
      hour >= 0 &&
      hour <= 23 &&
      minute >= 0 &&
      minute <= 59
    ){

      time =
        `${String(
          hour
        ).padStart(2,"0")}:` +
        `${String(
          minute
        ).padStart(2,"0")}`;

    }

  }


  // ----------------------------------------------------------
  // SERVIZIO
  // ----------------------------------------------------------

  const availableServices =
    Array.isArray(
      globalThis.__servicesForParser
    )
      ? globalThis.__servicesForParser
      : [];


  let service =
    null;


  // Il servizio viene cercato
  // direttamente nel testo dell'utente.
  //
  // Nota:
  // il chiamante principale usa i dati ricevuti
  // tramite il prompt, quindi qui utilizziamo
  // anche il testo AI come supporto.

  const servicePatterns = [
    /taglio uomo/i,
    /taglio donna/i,
    /taglio bimbo/i
  ];


  for (
    const pattern
    of servicePatterns
  ){

    const match =
      text.match(
        pattern
      );

    if(match){

      service =
        match[0];

      break;

    }

  }


  // ----------------------------------------------------------
  // GIORNI DELLA SETTIMANA
  // ----------------------------------------------------------

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


  let weekday =
    null;


  for (
    const name
    of Object.keys(
      weekdayMap
    )
  ){

    if(
      lower.includes(name)
    ){

      weekday =
        weekdayMap[name];

      break;

    }

  }


  if (
    weekday !== null
  ) {

    const now =
      new Date();

    const target =
      new Date(
        now
      );

    let difference =
      (
        weekday -
        target.getDay() +
        7
      ) % 7;


    if(
      difference === 0
    ){

      difference = 7;

    }


    target.setDate(
      target.getDate() +
      difference
    );


    date =
      `${target.getFullYear()}-` +
      `${String(
        target.getMonth()+1
      ).padStart(2,"0")}-` +
      `${String(
        target.getDate()
      ).padStart(2,"0")}`;

  }


  // ----------------------------------------------------------
  // PRENDI EVENTUALE SERVIZIO DAL TESTO AI
  // ----------------------------------------------------------

  if (
    !service &&
    aiText
  ) {

    const aiLower =
      aiText.toLowerCase();


    const possible =
      [
        "taglio uomo",
        "taglio donna",
        "taglio bimbo"
      ];


    for (
      const item
      of possible
    ){

      if(
        aiLower.includes(
          item
        ) &&
        lower.includes(
          "prenot"
        )
      ){

        service =
          item;

        break;

      }

    }

  }


  const hasBookingLanguage =
    lower.includes(
      "prenot"
    ) ||
    lower.includes(
      "appuntamento"
    ) ||
    lower.includes(
      "scegli"
    );


  if (
    !hasBookingLanguage &&
    !pendingAppointment
  ) {

    return {

      confirmed:
        false,

      hasAppointmentData:
        false,

      appointment:
        null

    };

  }


  const appointment = {

    name:
      clientName || "",

    date:
      date || "",

    time:
      time || "",

    service:
      service || ""

  };


  return {

    confirmed:
      false,

    hasAppointmentData:
      Boolean(
        appointment.date ||
        appointment.time ||
        appointment.service
      ),

    appointment

  };

}


// ============================================================
// NORMALIZZAZIONE APPUNTAMENTO
// ============================================================

function normalizeAppointment(
  appointment,
  clientName
) {

  return {

    name:
      String(
        appointment?.name ||
        clientName ||
        ""
      ).trim(),

    date:
      String(
        appointment?.date ||
        ""
      ).trim(),

    time:
      String(
        appointment?.time ||
        ""
      ).trim(),

    service:
      String(
        appointment?.service ||
        ""
      ).trim()

  };

}
