// ============================================================
// api/chat.js
// AI ASSISTENTE LOCALE
// VERSIONE DEFINITIVA
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
  // CONFIGURAZIONE
  // ----------------------------------------------------------

  const OPENAI_API_KEY =
    process.env.OPENAI_API_KEY;

  if (!OPENAI_API_KEY) {

    return res.status(500).json({
      error:
        "OPENAI_API_KEY non configurata sul server."
    });

  }

  const MODEL =
    process.env.OPENAI_MODEL ||
    "gpt-5.6-luna";

  // ----------------------------------------------------------
  // INPUT
  // ----------------------------------------------------------

  let body;

  try {

    body = req.body || {};

  } catch {

    return res.status(400).json({
      error: "Richiesta non valida."
    });

  }

  const action =
    String(body.action || "chat")
      .trim()
      .toLowerCase();

  const message =
    String(body.message || "")
      .trim();

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
    body.settings &&
    typeof body.settings === "object"
      ? body.settings
      : {};

  const services =
    Array.isArray(body.services)
      ? body.services
      : [];

  const appointments =
    Array.isArray(body.appointments)
      ? body.appointments
      : [];

  const promotions =
    Array.isArray(body.promotions)
      ? body.promotions
      : [];

  const history =
    Array.isArray(body.history)
      ? body.history.slice(-20)
      : [];

  let pendingAppointment =
    body.pendingAppointment &&
    typeof body.pendingAppointment === "object"
      ? body.pendingAppointment
      : null;

  let requiresConfirmation =
    body.requiresConfirmation === true;

  // ----------------------------------------------------------
  // POST AI
  // ----------------------------------------------------------

  if (action === "post") {

    return await generatePost({
      req,
      res,
      apiKey: OPENAI_API_KEY,
      model: MODEL,
      body
    });

  }

  // ----------------------------------------------------------
  // CHAT VUOTA
  // ----------------------------------------------------------

  if (!message) {

    return res.status(400).json({
      error: "Inserisci un messaggio."
    });

  }

  // ----------------------------------------------------------
  // NORMALIZZAZIONE DATI
  // ----------------------------------------------------------

  const normalizedServices =
    normalizeServices(services);

  const normalizedAppointments =
    normalizeAppointments(appointments);

  const normalizedPromotions =
    normalizePromotions(promotions);

  const normalizedSettings =
    normalizeSettings(settings);

  // ----------------------------------------------------------
  // COMANDO ANNULLA
  // ----------------------------------------------------------

  if (
    isCancelMessage(message) &&
    pendingAppointment &&
    requiresConfirmation
  ) {

    return res.status(200).json({

      reply:
        "Va bene, ho annullato la richiesta di appuntamento.",

      pendingAppointment: null,

      requiresConfirmation: false,

      confirmed: false,

      cancelled: true

    });

  }

  // ----------------------------------------------------------
  // COMANDO CONFERMA
  // ----------------------------------------------------------

  if (
    isConfirmMessage(message) &&
    pendingAppointment &&
    requiresConfirmation
  ) {

    const validation =
      validatePendingAppointment(
        pendingAppointment,
        normalizedServices,
        normalizedSettings,
        normalizedAppointments
      );

    if (!validation.valid) {

      return res.status(200).json({

        reply:
          validation.message,

        pendingAppointment:
          pendingAppointment,

        requiresConfirmation:
          true,

        confirmed:
          false

      });

    }

    /*
     * CONTROLLO FINALE.
     *
     * L'app invia gli appuntamenti già presenti.
     * Prima di confermare controlliamo nuovamente
     * che lo slot non risulti occupato.
     */

    const duplicate =
      normalizedAppointments.some(
        appointment =>
          appointment.date ===
            validation.appointment.date &&

          appointment.time ===
            validation.appointment.time &&

          normalizeText(
            appointment.service
          ) ===
          normalizeText(
            validation.appointment.service
          )
      );

    if (duplicate) {

      return res.status(200).json({

        reply:
          "Mi dispiace, nel frattempo questo orario è stato occupato. Scegli un altro orario.",

        pendingAppointment: null,

        requiresConfirmation: false,

        confirmed: false,

        availableSlots:
          findAvailableSlots(
            validation.appointment.date,
            validation.appointment.service,
            normalizedSettings,
            normalizedServices,
            normalizedAppointments
          ),

        availableDate:
          validation.appointment.date,

        availableService:
          validation.appointment.service

      });

    }

    /*
     * CONFERMA.
     *
     * L'API non salva direttamente nel database:
     * restituisce all'index un appuntamento confermato.
     *
     * L'index lo salva localmente.
     */

    const appointment =
      validation.appointment;

    return res.status(200).json({

      reply:
        `Appuntamento confermato per ${appointment.name}, ` +
        `${formatItalianDate(appointment.date)} ` +
        `alle ${appointment.time}, ` +
        `servizio: ${appointment.service}.`,

      confirmed: true,

      appointment: {

        id:
          createBookingId(
            appointment
          ),

        bookingKey:
          createBookingId(
            appointment
          ),

        name:
          appointment.name,

        service:
          appointment.service,

        date:
          appointment.date,

        time:
          appointment.time

      },

      pendingAppointment: null,

      requiresConfirmation: false

    });

  }

  // ----------------------------------------------------------
  // ESTRAZIONE RICHIESTA APPUNTAMENTO
  // ----------------------------------------------------------

  const appointmentRequest =
    detectAppointmentRequest(
      message,
      normalizedServices,
      clientName
    );

  /*
   * Se il messaggio sembra una richiesta
   * di appuntamento, proviamo a estrarre
   * data/orario/servizio.
   */

  if (appointmentRequest.isAppointmentRequest) {

    const date =
      extractDate(
        message
      );

    const time =
      extractTime(
        message
      );

    const service =
      findServiceFromMessage(
        message,
        normalizedServices
      );

    const requestedService =
      service ||
      appointmentRequest.service ||
      null;

    // --------------------------------------------------------
    // SERVIZIO MANCANTE
    // --------------------------------------------------------

    if (!requestedService) {

      return res.status(200).json({

        reply:
          buildServiceQuestion(
            normalizedServices
          ),

        confirmed: false,

        requiresConfirmation: false

      });

    }

    // --------------------------------------------------------
    // DATA MANCANTE
    // --------------------------------------------------------

    if (!date) {

      return res.status(200).json({

        reply:
          `Per quale giorno vuoi prenotare ${requestedService}?`,

        confirmed: false,

        requiresConfirmation: false

      });

    }

    // --------------------------------------------------------
    // ORARIO MANCANTE
    // --------------------------------------------------------

    if (!time) {

      const slots =
        findAvailableSlots(
          date,
          requestedService,
          normalizedSettings,
          normalizedServices,
          normalizedAppointments
        );

      if (!slots.length) {

        return res.status(200).json({

          reply:
            `Non trovo disponibilità per ${requestedService} ` +
            `il ${formatItalianDate(date)}. ` +
            `Vuoi provare un altro giorno?`,

          confirmed: false,

          requiresConfirmation: false

        });

      }

      return res.status(200).json({

        reply:
          `Per ${requestedService} il ${formatItalianDate(date)} ` +
          `questi sono gli orari disponibili:`,

        availableSlots:
          slots,

        availableDate:
          date,

        availableService:
          requestedService,

        confirmed: false,

        requiresConfirmation: false

      });

    }

    // --------------------------------------------------------
    // SERVIZIO VALIDO
    // --------------------------------------------------------

    const serviceData =
      findService(
        requestedService,
        normalizedServices
      );

    if (!serviceData) {

      return res.status(200).json({

        reply:
          buildServiceQuestion(
            normalizedServices
          ),

        confirmed: false,

        requiresConfirmation: false

      });

    }

    // --------------------------------------------------------
    // CONTROLLO SLOT
    // --------------------------------------------------------

    const available =
      isSlotAvailable(
        date,
        time,
        serviceData.duration,
        normalizedSettings,
        normalizedAppointments
      );

    if (!available) {

      const slots =
        findAvailableSlots(
          date,
          requestedService,
          normalizedSettings,
          normalizedServices,
          normalizedAppointments
        );

      if (!slots.length) {

        return res.status(200).json({

          reply:
            `L'orario ${time} non è disponibile ` +
            `il ${formatItalianDate(date)} e non risultano ` +
            `altri orari liberi per ${requestedService}.`,

          availableSlots: [],

          availableDate: date,

          availableService:
            requestedService,

          confirmed: false,

          requiresConfirmation: false

        });

      }

      return res.status(200).json({

        reply:
          `L'orario ${time} non è disponibile. ` +
          `Questi sono gli orari liberi per ${requestedService}:`,

        availableSlots:
          slots,

        availableDate:
          date,

        availableService:
          requestedService,

        confirmed: false,

        requiresConfirmation: false

      });

    }

    // --------------------------------------------------------
    // NOME CLIENTE
    // --------------------------------------------------------

    const finalClientName =
      clientName ||
      extractClientName(
        message
      );

    if (!finalClientName) {

      return res.status(200).json({

        reply:
          "Perfetto. Prima della prenotazione mi serve il nome del cliente.",

        confirmed: false,

        requiresConfirmation: false

      });

    }

    // --------------------------------------------------------
    // CREAZIONE PRENOTAZIONE PENDING
    // --------------------------------------------------------

    pendingAppointment = {

      name:
        finalClientName,

      service:
        serviceData.name,

      date,

      time,

      duration:
        serviceData.duration,

      price:
        serviceData.price,

      bookingKey:
        createBookingId({
          name: finalClientName,
          service: serviceData.name,
          date,
          time
        })

    };

    requiresConfirmation = true;

    return res.status(200).json({

      reply:
        `Ho preparato la prenotazione:\n\n` +
        `Cliente: ${finalClientName}\n` +
        `Servizio: ${serviceData.name}\n` +
        `Data: ${formatItalianDate(date)}\n` +
        `Ora: ${time}` +
        (
          serviceData.price !== null
            ? `\nPrezzo: €${serviceData.price.toFixed(2)}`
            : ""
        ) +
        `\n\nVuoi confermare?`,

      pendingAppointment,

      requiresConfirmation: true,

      confirmed: false

    });

  }

  // ----------------------------------------------------------
  // RISPOSTA AI GENERALE
  // ----------------------------------------------------------

  try {

    const systemPrompt =
      buildSystemPrompt({
        business,
        settings: normalizedSettings,
        services: normalizedServices,
        appointments: normalizedAppointments,
        promotions: normalizedPromotions
      });

    const input = [

      {
        role: "system",
        content: systemPrompt
      },

      ...history
        .filter(item =>
          item &&
          (
            item.role === "user" ||
            item.role === "assistant"
          ) &&
          typeof item.content === "string"
        )
        .slice(-20)
        .map(item => ({
          role: item.role,
          content: item.content.slice(0, 4000)
        })),

      {
        role: "user",
        content: message
      }

    ];

    const aiResponse =
      await callOpenAI({
        apiKey: OPENAI_API_KEY,
        model: MODEL,
        input
      });

    return res.status(200).json({

      reply:
        aiResponse,

      confirmed: false,

      requiresConfirmation: false

    });

  } catch (error) {

    console.error(
      "OPENAI ERROR:",
      error
    );

    return res.status(500).json({

      error:
        "Non riesco a collegarmi all'assistente AI in questo momento."

    });

  }

}


// ============================================================
// OPENAI
// ============================================================

async function callOpenAI({
  apiKey,
  model,
  input
}) {

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

            input,

            max_output_tokens:
              800

          })

      }
    );

  const data =
    await response.json();

  if (!response.ok) {

    console.error(
      "OpenAI response:",
      data
    );

    throw new Error(
      data?.error?.message ||
      "Errore OpenAI."
    );

  }

  return extractOutputText(
    data
  );

}


// ============================================================
// ESTRAZIONE TESTO OPENAI
// ============================================================

function extractOutputText(data) {

  if (
    typeof data?.output_text ===
    "string"
  ) {

    return data.output_text.trim();

  }

  if (
    Array.isArray(data?.output)
  ) {

    const texts = [];

    for (
      const item of data.output
    ) {

      if (
        Array.isArray(item.content)
      ) {

        for (
          const content
          of item.content
        ) {

          if (
            typeof content.text ===
            "string"
          ) {

            texts.push(
              content.text
            );

          }

        }

      }

    }

    if(texts.length){

      return texts
        .join("\n")
        .trim();

    }

  }

  return "Non ho ricevuto una risposta.";

}


// ============================================================
// SYSTEM PROMPT
// ============================================================

function buildSystemPrompt({
  business,
  settings,
  services,
  appointments,
  promotions
}) {

  const serviceText =
    services.length
      ? services.map(service =>
          `- ${service.name}` +
          (
            service.category
              ? ` | categoria: ${service.category}`
              : ""
          ) +
          ` | durata: ${service.duration} minuti` +
          (
            service.price !== null
              ? ` | prezzo: €${service.price.toFixed(2)}`
              : ""
          ) +
          (
            service.description
              ? ` | descrizione: ${service.description}`
              : ""
          )
        ).join("\n")
      : "Nessun servizio configurato.";

  const promotionText =
    promotions.length
      ? promotions.map(promotion =>
          `- ${promotion.title}` +
          (
            promotion.category
              ? ` | categoria: ${promotion.category}`
              : ""
          ) +
          (
            promotion.description
              ? ` | ${promotion.description}`
              : ""
          ) +
          (
            promotion.price !== null
              ? ` | prezzo: €${promotion.price.toFixed(2)}`
              : ""
          ) +
          (
            promotion.expiry
              ? ` | valida fino al ${promotion.expiry}`
              : ""
          )
        ).join("\n")
      : "Nessuna promozione attiva.";

  const hoursText =
    formatHours(
      settings.hours
    );

  return `
Sei l'assistente virtuale di "${business}".

Il tuo compito è aiutare i clienti in modo professionale,
semplice, breve e naturale.

DATI DELL'ATTIVITÀ

Nome:
${business}

Tipo:
${settings.type || "Attività locale"}

Descrizione:
${settings.description || "Non disponibile"}

Indirizzo:
${settings.address || "Non disponibile"}

Telefono:
${settings.phone || "Non disponibile"}

WhatsApp:
${settings.whatsapp || "Non disponibile"}

ORARI

${hoursText}

SERVIZI

${serviceText}

PROMOZIONI

${promotionText}

APPUNTAMENTI GIÀ PRESENTI

${appointments.length
  ? appointments.map(a =>
      `- ${a.date} ${a.time} | ${a.name} | ${a.service}`
    ).join("\n")
  : "Nessun appuntamento registrato."
}

REGOLE IMPORTANTI

1. Usa esclusivamente i dati forniti sopra.

2. Non inventare servizi, prezzi, promozioni,
   orari, indirizzi o informazioni dell'attività.

3. Se un'informazione non è presente,
   dichiaralo chiaramente.

4. Non confermare autonomamente appuntamenti.
   Le prenotazioni vengono gestite dal sistema.

5. Se l'utente chiede un appuntamento,
   il sistema deve verificare disponibilità,
   durata del servizio, orari e pause.

6. Non dire mai che un appuntamento è confermato
   se il sistema non ha restituito confirmed=true.

7. Non inventare disponibilità.

8. Mantieni le risposte concise.

9. Rispondi sempre in italiano.

10. Se l'utente chiede informazioni su una promozione,
    utilizza esclusivamente le promozioni presenti nei dati.

11. Se l'utente chiede informazioni su un servizio,
    utilizza nome, categoria, descrizione, durata e prezzo
    presenti nei dati.

12. Se l'utente chiede informazioni di contatto,
    utilizza esclusivamente i dati dell'attività.

13. Non modificare autonomamente prezzi,
    durate o orari.

14. Non creare appuntamenti attraverso il testo libero.
    La creazione passa sempre dal flusso di conferma.
`;

}


// ============================================================
// NORMALIZZAZIONE SERVIZI
// ============================================================

function normalizeServices(services) {

  return services
    .filter(
      service =>
        service &&
        typeof service === "object" &&
        String(service.name || "").trim()
    )
    .map(service => ({

      id:
        String(
          service.id || ""
        ),

      name:
        String(
          service.name || ""
        ).trim(),

      category:
        String(
          service.category || ""
        ).trim(),

      description:
        String(
          service.description || ""
        ).trim(),

      price:
        service.price === null ||
        service.price === undefined ||
        service.price === ""
          ? null
          : Number(service.price),

      duration:
        Number(service.duration) > 0
          ? Number(service.duration)
          : 30

    }));

}


// ============================================================
// NORMALIZZAZIONE PROMOZIONI
// ============================================================

function normalizePromotions(
  promotions
) {

  return promotions
    .filter(
      promotion =>
        promotion &&
        typeof promotion === "object" &&
        String(
          promotion.title || ""
        ).trim()
    )
    .map(promotion => ({

      id:
        String(
          promotion.id || ""
        ),

      title:
        String(
          promotion.title || ""
        ).trim(),

      category:
        String(
          promotion.category || ""
        ).trim(),

      description:
        String(
          promotion.description || ""
        ).trim(),

      price:
        promotion.price === null ||
        promotion.price === undefined ||
        promotion.price === ""
          ? null
          : Number(promotion.price),

      expiry:
        String(
          promotion.expiry || ""
        ).trim()

    }));

}


// ============================================================
// NORMALIZZAZIONE APPUNTAMENTI
// ============================================================

function normalizeAppointments(
  appointments
) {

  return appointments
    .filter(
      appointment =>
        appointment &&
        typeof appointment === "object"
    )
    .map(appointment => ({

      id:
        String(
          appointment.id || ""
        ),

      name:
        String(
          appointment.name ||
          appointment.n ||
          ""
        ).trim(),

      date:
        String(
          appointment.date ||
          appointment.d ||
          ""
        ).trim(),

      time:
        String(
          appointment.time ||
          appointment.t ||
          ""
        ).trim(),

      service:
        String(
          appointment.service ||
          appointment.s ||
          ""
        ).trim()

    }))
    .filter(
      appointment =>
        appointment.date &&
        appointment.time &&
        appointment.service
    );

}


// ============================================================
// NORMALIZZAZIONE SETTINGS
// ============================================================

function normalizeSettings(
  settings
) {

  return {

    name:
      String(
        settings.name || ""
      ).trim(),

    type:
      String(
        settings.type || ""
      ).trim(),

    description:
      String(
        settings.description || ""
      ).trim(),

    address:
      String(
        settings.address || ""
      ).trim(),

    phone:
      String(
        settings.phone || ""
      ).trim(),

    whatsapp:
      String(
        settings.whatsapp || ""
      ).trim(),

    hours:
      settings.hours &&
      typeof settings.hours === "object"
        ? settings.hours
        : {}

  };

}


// ============================================================
// SERVIZI
// ============================================================

function findService(
  name,
  services
) {

  const target =
    normalizeText(name);

  return services.find(
    service =>
      normalizeText(
        service.name
      ) === target
  ) || null;

}


function findServiceFromMessage(
  message,
  services
) {

  const text =
    normalizeText(message);

  /*
   * Prima cerchiamo corrispondenza
   * esatta/parziale con il nome.
   */

  const sorted =
    [...services]
      .sort(
        (a,b) =>
          b.name.length -
          a.name.length
      );

  return (
    sorted.find(
      service =>
        text.includes(
          normalizeText(
            service.name
          )
        )
    )?.name ||
    null
  );

}


function buildServiceQuestion(
  services
) {

  if(!services.length){

    return:
      "Al momento non risultano servizi configurati.";

  }

  return (
    "Quale servizio vuoi prenotare? " +
    "Questi sono quelli disponibili: " +
    services
      .map(service => service.name)
      .join(", ") +
    "."
  );

}


// ============================================================
// RICHIESTA APPUNTAMENTO
// ============================================================

function detectAppointmentRequest(
  message,
  services,
  clientName
) {

  const text =
    normalizeText(message);

  const keywords = [

    "prenota",
    "prenotare",
    "appuntamento",
    "appuntamento per",
    "vorrei",
    "posso venire",
    "posso prendere",
    "fissare",
    "fissiamo",
    "disponibilita",
    "disponibile",
    "posto",
    "orario"

  ];

  const isAppointmentRequest =
    keywords.some(
      keyword =>
        text.includes(keyword)
    );

  const service =
    findServiceFromMessage(
      message,
      services
    );

  return {

    isAppointmentRequest:
      isAppointmentRequest ||
      !!service,

    service,

    hasClientName:
      !!clientName

  };

}


// ============================================================
// ESTRAZIONE DATA
// ============================================================

function extractDate(
  message
) {

  const text =
    normalizeText(message);

  const now =
    new Date();

  // YYYY-MM-DD

  let match =
    text.match(
      /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/
    );

  if(match){

    return normalizeDate(
      Number(match[1]),
      Number(match[2]),
      Number(match[3])
    );

  }

  // DD/MM/YYYY

  match =
    text.match(
      /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/
    );

  if(match){

    return normalizeDate(
      Number(match[3]),
      Number(match[2]),
      Number(match[1])
    );

  }

  // DD-MM-YYYY

  match =
    text.match(
      /\b(\d{1,2})-(\d{1,2})-(20\d{2})\b/
    );

  if(match){

    return normalizeDate(
      Number(match[3]),
      Number(match[2]),
      Number(match[1])
    );

  }

  // oggi

  if(text.includes("oggi")){

    return formatDate(
      now
    );

  }

  // domani

  if(text.includes("domani")){

    const date =
      new Date(now);

    date.setDate(
      date.getDate()+1
    );

    return formatDate(
      date
    );

  }

  // dopodomani

  if(text.includes("dopodomani")){

    const date =
      new Date(now);

    date.setDate(
      date.getDate()+2
    );

    return formatDate(
      date
    );

  }

  const weekdays = {

    lunedi:1,
    martedi:2,
    mercoledi:3,
    giovedi:4,
    venerdi:5,
    sabato:6,
    domenica:0

  };

  for(
    const [name,day]
    of Object.entries(
      weekdays
    )
  ){

    if(
      text.includes(name)
    ){

      const date =
        nextWeekday(
          now,
          day
        );

      return formatDate(
        date
      );

    }

  }

  return null;

}


// ============================================================
// ESTRAZIONE ORARIO
// ============================================================

function extractTime(
  message
) {

  const text =
    normalizeText(message);

  let match =
    text.match(
      /\b([01]?\d|2[0-3])[:.](\d{2})\b/
    );

  if(match){

    return (
      String(
        Number(match[1])
      ).padStart(2,"0") +
      ":" +
      String(
        Number(match[2])
      ).padStart(2,"0")
    );

  }

  match =
    text.match(
      /\b([01]?\d|2[0-3])\s*(?:ore|h)\b/
    );

  if(match){

    return (
      String(
        Number(match[1])
      ).padStart(2,"0") +
      ":00"
    );

  }

  return null;

}


// ============================================================
// NOME CLIENTE
// ============================================================

function extractClientName(
  message
) {

  const match =
    message.match(
      /(?:sono|mi chiamo|nome è|nome:)\s+([a-zA-ZÀ-ÿ' -]{2,60})/i
    );

  if(!match){
    return null;
  }

  return match[1]
    .trim()
    .replace(
      /\s+/g,
      " "
    );

}


// ============================================================
// DISPONIBILITÀ
// ============================================================

function isSlotAvailable(
  date,
  time,
  duration,
  settings,
  appointments
) {

  const day =
    getDaySettings(
      settings,
      date
    );

  if(!day){
    return false;
  }

  if(
    String(day.status)
      .toLowerCase() ===
    "closed"
  ){
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

  if(
    opening === null ||
    closing === null ||
    start === null
  ){
    return false;
  }

  const end =
    start +
    Number(duration || 30);

  if(
    start < opening ||
    end > closing
  ){
    return false;
  }

  if(
    overlapsBreak(
      day,
      start,
      end
    )
  ){
    return false;
  }

  return !appointments.some(
    appointment => {

      if(
        appointment.date !== date
      ){
        return false;
      }

      const existingStart =
        toMinutes(
          appointment.time
        );

      if(
        existingStart === null
      ){
        return false;
      }

      const existingDuration =
        getAppointmentDuration(
          appointment,
          settings
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

}


// ============================================================
// SLOT DISPONIBILI
// ============================================================

function findAvailableSlots(
  date,
  serviceName,
  settings,
  services,
  appointments
) {

  const service =
    findService(
      serviceName,
      services
    );

  if(!service){
    return [];
  }

  const day =
    getDaySettings(
      settings,
      date
    );

  if(!day){
    return [];
  }

  if(
    String(day.status)
      .toLowerCase() ===
    "closed"
  ){
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

  if(
    opening === null ||
    closing === null
  ){
    return [];
  }

  const duration =
    Number(
      service.duration
    ) || 30;

  const slots = [];

  for(
    let minute = opening;
    minute + duration <= closing;
    minute += 30
  ){

    const time =
      formatTime(
        minute
      );

    if(
      isSlotAvailable(
        date,
        time,
        duration,
        settings,
        appointments
      )
    ){

      slots.push(
        time
      );

    }

  }

  return slots;

}


// ============================================================
// VALIDAZIONE PRENOTAZIONE
// ============================================================

function validatePendingAppointment(
  pending,
  services,
  settings,
  appointments
) {

  if(!pending){

    return {

      valid:false,

      message:
        "Non c'è nessun appuntamento da confermare."

    };

  }

  const name =
    String(
      pending.name || ""
    ).trim();

  const date =
    String(
      pending.date || ""
    ).trim();

  const time =
    String(
      pending.time || ""
    ).trim();

  const serviceName =
    String(
      pending.service || ""
    ).trim();

  if(
    !name ||
    !date ||
    !time ||
    !serviceName
  ){

    return {

      valid:false,

      message:
        "I dati della prenotazione non sono completi."

    };

  }

  const service =
    findService(
      serviceName,
      services
    );

  if(!service){

    return {

      valid:false,

      message:
        "Il servizio selezionato non risulta più disponibile."

    };

  }

  if(
    !isSlotAvailable(
      date,
      time,
      service.duration,
      settings,
      appointments
    )
  ){

    return {

      valid:false,

      message:
        "Mi dispiace, l'orario selezionato non è più disponibile."

    };

  }

  return {

    valid:true,

    appointment: {

      name,

      service:
        service.name,

      date,

      time,

      duration:
        service.duration,

      price:
        service.price

    }

  };

}


// ============================================================
// DURATA APPUNTAMENTO ESISTENTE
// ============================================================

function getAppointmentDuration(
  appointment,
  settings
) {

  /*
   * La durata viene recuperata dal servizio.
   * Se il servizio non è più presente,
   * usiamo 30 minuti come fallback sicuro.
   */

  const services =
    settings.__services || [];

  const service =
    services.find(
      item =>
        normalizeText(
          item.name
        ) ===
        normalizeText(
          appointment.service
        )
    );

  return service
    ? Number(service.duration) || 30
    : 30;

}


// ============================================================
// GIORNO
// ============================================================

function getDaySettings(
  settings,
  date
) {

  const dayName =
    getDayName(
      date
    );

  return settings.hours?.[
    dayName
  ] || null;

}


function getDayName(
  date
) {

  const day =
    new Date(
      `${date}T12:00:00`
    ).getDay();

  return [

    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"

  ][day];

}


// ============================================================
// PAUSA
// ============================================================

function overlapsBreak(
  day,
  start,
  end
) {

  const breakStart =
    toMinutes(
      day.breakStart
    );

  const breakEnd =
    toMinutes(
      day.breakEnd
    );

  if(
    breakStart === null ||
    breakEnd === null ||
    breakStart >= breakEnd
  ){
    return false;
  }

  return (
    start < breakEnd &&
    end > breakStart
  );

}


// ============================================================
// ORARI
// ============================================================

function toMinutes(
  time
) {

  if(
    typeof time !== "string" ||
    !/^\d{2}:\d{2}$/.test(time)
  ){

    return null;

  }

  const [
    hours,
    minutes
  ] =
    time.split(":")
      .map(Number);

  if(
    hours > 23 ||
    minutes > 59
  ){

    return null;

  }

  return (
    hours * 60 +
    minutes
  );

}


function formatTime(
  minutes
) {

  return (
    String(
      Math.floor(
        minutes / 60
      )
    ).padStart(2,"0") +
    ":" +
    String(
      minutes % 60
    ).padStart(2,"0")
  );

}


// ============================================================
// DATE
// ============================================================

function normalizeDate(
  year,
  month,
  day
) {

  const date =
    new Date(
      year,
      month - 1,
      day,
      12
    );

  if(
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ){

    return null;

  }

  return (
    String(year) +
    "-" +
    String(month).padStart(2,"0") +
    "-" +
    String(day).padStart(2,"0")
  );

}


function formatDate(
  date
) {

  return (
    date.getFullYear() +
    "-" +
    String(
      date.getMonth()+1
    ).padStart(2,"0") +
    "-" +
    String(
      date.getDate()
    ).padStart(2,"0")
  );

}


function nextWeekday(
  from,
  targetDay
) {

  const date =
    new Date(from);

  const current =
    date.getDay();

  let difference =
    targetDay -
    current;

  if(
    difference <= 0
  ){

    difference += 7;

  }

  date.setDate(
    date.getDate() +
    difference
  );

  return date;

}


// ============================================================
// DATA ITALIANA
// ============================================================

function formatItalianDate(
  date
) {

  if(
    !/^\d{4}-\d{2}-\d{2}$/.test(
      date
    )
  ){

    return date;

  }

  const object =
    new Date(
      `${date}T12:00:00`
    );

  return object.toLocaleDateString(
    "it-IT",
    {
      weekday:"long",
      day:"numeric",
      month:"long",
      year:"numeric"
    }
  );

}


// ============================================================
// CONFERMA / ANNULLAMENTO
// ============================================================

function isConfirmMessage(
  message
) {

  const text =
    normalizeText(message);

  return [

    "confermo",
    "conferma",
    "si confermo",
    "sì confermo",
    "conferma appuntamento",
    "confermo appuntamento",
    "va bene confermo",
    "ok confermo",
    "procedi",
    "prenota"

  ].includes(text);

}


function isCancelMessage(
  message
) {

  const text =
    normalizeText(message);

  return [

    "annulla",
    "annullo",
    "annulla appuntamento",
    "non confermo",
    "lascia perdere",
    "cancella",
    "cancella appuntamento"

  ].includes(text);

}


// ============================================================
// NOME / TESTO
// ============================================================

function normalizeText(
  value
) {

  return String(
    value || ""
  )
    .toLowerCase()
    .normalize(
      "NFD"
    )
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();

}


// ============================================================
// ID PRENOTAZIONE
// ============================================================

function createBookingId(
  appointment
) {

  const raw =
    [
      appointment.name,
      appointment.service,
      appointment.date,
      appointment.time
    ]
      .map(value =>
        normalizeText(value)
      )
      .join("|");

  /*
   * ID deterministico.
   *
   * Questo è importante per impedire
   * che la stessa conferma generi
   * identificativi diversi.
   */

  let hash = 0;

  for(
    let i = 0;
    i < raw.length;
    i++
  ){

    hash =
      (
        (
          hash << 5
        ) -
        hash
      ) +
      raw.charCodeAt(i);

    hash |= 0;

  }

  return (
    "booking_" +
    Math.abs(hash)
  );

}


// ============================================================
// ORARI TESTUALI
// ============================================================

function formatHours(
  hours
) {

  const labels = {

    monday:"Lunedì",
    tuesday:"Martedì",
    wednesday:"Mercoledì",
    thursday:"Giovedì",
    friday:"Venerdì",
    saturday:"Sabato",
    sunday:"Domenica"

  };

  const keys =
    Object.keys(
      labels
    );

  if(!keys.length){
    return "Non configurati.";
  }

  return keys
    .map(key => {

      const day =
        hours?.[key];

      if(!day){

        return (
          `${labels[key]}: non configurato`
        );

      }

      if(
        String(day.status)
          .toLowerCase() ===
        "closed"
      ){

        return (
          `${labels[key]}: chiuso`
        );

      }

      let text =
        `${labels[key]}: ` +
        `${day.open || "?"} - ` +
        `${day.close || "?"}`;

      if(
        day.breakStart &&
        day.breakEnd
      ){

        text +=
          `, pausa ${day.breakStart} - ${day.breakEnd}`;

      }

      return text;

    })
    .join("\n");

}


// ============================================================
// GENERAZIONE POST
// ============================================================

async function generatePost({
  req,
  res,
  apiKey,
  model,
  body
}) {

  const business =
    String(
      body.business ||
      "Attività locale"
    ).trim();

  const topic =
    String(
      body.topic ||
      "una nuova promozione"
    ).trim();

  const settings =
    body.settings &&
    typeof body.settings === "object"
      ? body.settings
      : {};

  const services =
    normalizeServices(
      Array.isArray(body.services)
        ? body.services
        : []
    );

  const promotions =
    normalizePromotions(
      Array.isArray(body.promotions)
        ? body.promotions
        : []
    );

  const servicesText =
    services.length
      ? services.map(
          service =>
            `${service.name}` +
            (
              service.category
                ? ` (${service.category})`
                : ""
            ) +
            (
              service.price !== null
                ? ` — €${service.price.toFixed(2)}`
                : ""
            ) +
            (
              service.description
                ? ` — ${service.description}`
                : ""
            )
        ).join("\n")
      : "Nessun servizio.";

  const promotionsText =
    promotions.length
      ? promotions.map(
          promotion =>
            `${promotion.title}` +
            (
              promotion.category
                ? ` (${promotion.category})`
                : ""
            ) +
            (
              promotion.description
                ? ` — ${promotion.description}`
                : ""
            ) +
            (
              promotion.price !== null
                ? ` — €${promotion.price.toFixed(2)}`
                : ""
            ) +
            (
              promotion.expiry
                ? ` — valida fino al ${promotion.expiry}`
                : ""
            )
        ).join("\n")
      : "Nessuna promozione.";

  const systemPrompt = `

Sei un copywriter professionale
per piccole attività locali italiane.

Devi creare un post social naturale,
chiaro e credibile.

ATTIVITÀ:
${business}

TIPO:
${settings.type || "Attività locale"}

DESCRIZIONE:
${settings.description || "Non disponibile"}

ARGOMENTO:
${topic}

SERVIZI:
${servicesText}

PROMOZIONI:
${promotionsText}

REGOLE:

- Non inventare prezzi.
- Non inventare promozioni.
- Non inventare servizi.
- Non inventare indirizzi.
- Non inventare numeri di telefono.
- Usa solo i dati forniti.
- Scrivi in italiano.
- Evita frasi artificiali.
- Non usare linguaggio eccessivamente pubblicitario.
- Il testo deve essere adatto a Facebook e Instagram.
- Usa una call to action naturale.
- Usa pochi hashtag pertinenti.
- Non aggiungere spiegazioni prima o dopo il post.
`;

  try {

    const reply =
      await callOpenAI({
        apiKey,
        model,
        input: [

          {
            role:"system",
            content:systemPrompt
          },

          {
            role:"user",
            content:
              `Crea il post per questo argomento: ${topic}`
          }

        ]

      });

    return res.status(200).json({

      reply

    });

  } catch(error) {

    console.error(
      "POST AI ERROR:",
      error
    );

    return res.status(500).json({

      error:
        "Errore durante la generazione del post."

    });

  }

}
