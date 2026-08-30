/* ============================================================
   MAVIRI — MAVI AI ENGINE 3.0
   ============================================================
   MAVI END-TO-END LOCAL ENGINE

   ZERO OpenAI
   ZERO Qwen
   ZERO HuggingFace
   ZERO Transformers
   ZERO WebGPU
   ZERO WASM
   ZERO API KEY
   ZERO MODEL DOWNLOAD

   Tutto locale.
   Avvio immediato.
   ============================================================ */

const MAVI_ENGINE_VERSION = "3.0.0";
const MAVI_ENGINE_NAME = "mavi-local-e2e";

const MAVI_MAX_HISTORY = 20;
const MAVI_MAX_TEXT = 4000;

let maviReady = true;
let maviLoading = false;
let maviDevice = "local";
let maviConversation = [];


/* ============================================================
   STATUS
   ============================================================ */

function maviStatus(status, detail = "") {

  try {

    window.dispatchEvent(
      new CustomEvent(
        "mavi-engine-status",
        {
          detail: {
            status,
            detail,
            version: MAVI_ENGINE_VERSION,
            model: "Mavi Local E2E",
            device: maviDevice,
            ready: maviReady
          }
        }
      )
    );

  } catch (_) {}

}


/* ============================================================
   NORMALIZZAZIONE TESTO
   ============================================================ */

function normalizeText(value = "") {

  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[.,!?;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

}


function cleanText(value = "") {

  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();

}


/* ============================================================
   TOKEN
   ============================================================ */

function tokens(text) {

  return normalizeText(text)
    .split(" ")
    .filter(Boolean);

}


/* ============================================================
   CONTAINS ANY
   ============================================================ */

function containsAny(text, values) {

  const normalized =
    normalizeText(text);

  return values.some(
    value =>
      normalized.includes(
        normalizeText(value)
      )
  );

}


/* ============================================================
   FAST STATUS
   ============================================================ */

function readyStatus() {

  maviStatus(
    "ready",
    "Mavi è pronta."
  );

}


/* ============================================================
   DATE ENGINE
   ============================================================ */

const MAVI_DAYS = [
  "domenica",
  "lunedi",
  "martedi",
  "mercoledi",
  "giovedi",
  "venerdi",
  "sabato"
];


function localToday() {

  const now = new Date();

  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

}


function formatDate(date) {

  if (!(date instanceof Date)) {
    return "";
  }

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

  if (!(date instanceof Date)) {
    return "";
  }

  return date.toLocaleDateString(
    "it-IT",
    {
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }
  );

}


function parseDate(text) {

  const normalized =
    normalizeText(text);

  const today =
    localToday();


  if (
    normalized.includes("oggi")
  ) {

    return today;

  }


  if (
    normalized.includes("domani")
  ) {

    const d =
      new Date(today);

    d.setDate(
      d.getDate() + 1
    );

    return d;

  }


  if (
    normalized.includes("dopodomani")
  ) {

    const d =
      new Date(today);

    d.setDate(
      d.getDate() + 2
    );

    return d;

  }


  for (
    let i = 0;
    i < MAVI_DAYS.length;
    i++
  ) {

    const day =
      MAVI_DAYS[i];

    if (
      normalized.includes(day)
    ) {

      const current =
        today.getDay();

      let diff =
        i - current;

      if (diff <= 0) {
        diff += 7;
      }

      const d =
        new Date(today);

      d.setDate(
        d.getDate() + diff
      );

      return d;

    }

  }


  const match =
    normalized.match(
      /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/
    );

  if (match) {

    const day =
      Number(match[1]);

    const month =
      Number(match[2]) - 1;

    let year =
      match[3]
        ? Number(match[3])
        : today.getFullYear();

    if (year < 100) {
      year += 2000;
    }

    let result =
      new Date(
        year,
        month,
        day
      );

    if (
      !match[3] &&
      result < today
    ) {

      result =
        new Date(
          year + 1,
          month,
          day
        );

    }

    return result;

  }


  return null;

}


/* ============================================================
   TIME ENGINE
   ============================================================ */

function parseTime(text) {

  const normalized =
    normalizeText(text);


  let match =
    normalized.match(
      /\b(\d{1,2})\s*[:.]\s*(\d{2})\b/
    );

  if (match) {

    const h =
      Number(match[1]);

    const m =
      Number(match[2]);

    if (
      h >= 0 &&
      h <= 23 &&
      m >= 0 &&
      m <= 59
    ) {

      return {
        hour: h,
        minute: m,
        value:
          `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
      };

    }

  }


  match =
    normalized.match(
      /\b(?:alle|ore|ore alle|verso le)?\s*(\d{1,2})\b/
    );

  if (match) {

    const h =
      Number(match[1]);

    if (
      h >= 0 &&
      h <= 23
    ) {

      return {
        hour: h,
        minute: 0,
        value:
          `${String(h).padStart(2, "0")}:00`
      };

    }

  }


  return null;

}


/* ============================================================
   PERIOD ENGINE
   ============================================================ */

function parsePeriod(text) {

  const normalized =
    normalizeText(text);

  if (
    containsAny(
      normalized,
      [
        "mattina",
        "mattino"
      ]
    )
  ) {

    return {
      name: "mattina",
      from: "08:00",
      to: "12:30"
    };

  }

  if (
    containsAny(
      normalized,
      [
        "pranzo"
      ]
    )
  ) {

    return {
      name: "pranzo",
      from: "12:00",
      to: "14:30"
    };

  }

  if (
    containsAny(
      normalized,
      [
        "pomeriggio"
      ]
    )
  ) {

    return {
      name: "pomeriggio",
      from: "14:00",
      to: "18:30"
    };

  }

  if (
    containsAny(
      normalized,
      [
        "sera",
        "serale"
      ]
    )
  ) {

    return {
      name: "sera",
      from: "18:00",
      to: "21:30"
    };

  }

  return null;

}


/* ============================================================
   BUSINESS DATA
   ============================================================ */

function getServices(data = {}) {

  return Array.isArray(data.services)
    ? data.services
    : [];

}


function getAppointments(data = {}) {

  return Array.isArray(
    data.appointments
  )
    ? data.appointments
    : [];

}


function getPromotions(data = {}) {

  return Array.isArray(
    data.promotions
  )
    ? data.promotions
    : [];

}


function getClients(data = {}) {

  return Array.isArray(
    data.clients
  )
    ? data.clients
    : [];

}


/* ============================================================
   SERVICE MATCHER
   ============================================================ */

function findService(
  text,
  data = {}
) {

  const services =
    getServices(data);

  const normalized =
    normalizeText(text);

  if (!services.length) {
    return null;
  }


  /*
   * Match diretto.
   */

  for (
    const service of services
  ) {

    const name =
      normalizeText(
        service?.name || ""
      );

    if (
      name &&
      normalized.includes(name)
    ) {

      return service;

    }

  }


  /*
   * Match per parole.
   */

  let best = null;
  let bestScore = 0;

  for (
    const service of services
  ) {

    const name =
      normalizeText(
        service?.name || ""
      );

    if (!name) {
      continue;
    }

    const words =
      name
        .split(" ")
        .filter(
          word =>
            word.length > 2
        );

    let score = 0;

    for (
      const word of words
    ) {

      if (
        normalized.includes(word)
      ) {

        score++;

      }

    }

    if (
      score > bestScore
    ) {

      bestScore =
        score;

      best =
        service;

    }

  }

  return bestScore > 0
    ? best
    : null;

}


/* ============================================================
   CLIENT MATCHER
   ============================================================ */

function findClient(
  text,
  data = {}
) {

  const clients =
    getClients(data);

  const appointments =
    getAppointments(data);

  const normalized =
    normalizeText(text);


  for (
    const client of clients
  ) {

    const name =
      normalizeText(
        client?.name || ""
      );

    if (
      name &&
      normalized.includes(name)
    ) {

      return client;

    }

  }


  /*
   * Compatibilità con versioni
   * precedenti che non hanno clients[].
   */

  for (
    const appointment of appointments
  ) {

    const name =
      cleanText(
        appointment?.name || ""
      );

    if (
      name &&
      normalized.includes(
        normalizeText(name)
      )
    ) {

      return {
        name
      };

    }

  }


  return null;

}


/* ============================================================
   APPOINTMENT SEARCH
   ============================================================ */

function appointmentMatchesDate(
  appointment,
  date
) {

  if (!appointment || !date) {
    return false;
  }

  const wanted =
    formatDate(date);

  return (
    String(
      appointment.date || ""
    ).slice(0, 10) === wanted
  );

}


function appointmentMatchesTime(
  appointment,
  time
) {

  if (!appointment || !time) {
    return false;
  }

  return (
    String(
      appointment.time || ""
    ).slice(0, 5) ===
    time.value
  );

}


function findAppointments(
  text,
  data = {}
) {

  const appointments =
    getAppointments(data);

  const date =
    parseDate(text);

  const time =
    parseTime(text);

  const client =
    findClient(
      text,
      data
    );

  const service =
    findService(
      text,
      data
    );


  return appointments.filter(
    appointment => {

      if (
        date &&
        !appointmentMatchesDate(
          appointment,
          date
        )
      ) {

        return false;

      }


      if (
        time &&
        !appointmentMatchesTime(
          appointment,
          time
        )
      ) {

        return false;

      }


      if (
        client?.name &&
        normalizeText(
          appointment?.name || ""
        ) !==
        normalizeText(
          client.name
        )
      ) {

        return false;

      }


      if (
        service?.name &&
        normalizeText(
          appointment?.service || ""
        ) !==
        normalizeText(
          service.name
        )
      ) {

        return false;

      }


      return true;

    }
  );

}


/* ============================================================
   AVAILABILITY
   ============================================================ */

function isTimeFree(
  date,
  time,
  service,
  data = {}
) {

  const appointments =
    getAppointments(data);

  const wantedDate =
    formatDate(date);

  const wantedTime =
    time.value;


  const duration =
    Number(
      service?.duration || 30
    );


  const start =
    time.hour * 60 +
    time.minute;

  const end =
    start + duration;


  for (
    const appointment of appointments
  ) {

    if (
      String(
        appointment?.date || ""
      ).slice(0, 10) !==
      wantedDate
    ) {

      continue;

    }


    const existing =
      String(
        appointment?.time || ""
      ).slice(0, 5);

    const parts =
      existing.split(":");

    if (parts.length !== 2) {
      continue;
    }

    const existingStart =
      Number(parts[0]) * 60 +
      Number(parts[1]);


    const existingDuration =
      Number(
        appointment?.duration ||
        service?.duration ||
        30
      );

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


/* ============================================================
   INTENT ENGINE
   ============================================================ */

function detectIntent(
  text
) {

  const normalized =
    normalizeText(text);


  if (
    containsAny(
      normalized,
      [
        "ciao",
        "salve",
        "buongiorno",
        "buonasera",
        "buonanotte",
        "ehi",
        "hey"
      ]
    ) &&
    normalized.length < 40
  ) {

    return "greeting";

  }


  if (
    containsAny(
      normalized,
      [
        "chi sei",
        "come ti chiami",
        "chi ti ha creato",
        "cosa sei"
      ]
    )
  ) {

    return "identity";

  }


  if (
    containsAny(
      normalized,
      [
        "servizi",
        "trattamenti",
        "cosa fate",
        "cosa offrite"
      ]
    )
  ) {

    return "services";

  }


  if (
    containsAny(
      normalized,
      [
        "prezzo",
        "prezzi",
        "quanto costa",
        "quanto costano",
        "costo",
        "tariffa"
      ]
    )
  ) {

    return "price";

  }


  if (
    containsAny(
      normalized,
      [
        "promozione",
        "promozioni",
        "promo",
        "offerta",
        "offerte"
      ]
    )
  ) {

    return "promotions";

  }


  if (
    containsAny(
      normalized,
      [
        "orari",
        "orario",
        "quando siete aperti",
        "quando aprite",
        "a che ora aprite",
        "a che ora chiudete"
      ]
    )
  ) {

    return "hours";

  }


  if (
    containsAny(
      normalized,
      [
        "prenota",
        "prenotare",
        "prenotazione",
        "fissare",
        "fissa",
        "appuntamento"
      ]
    )
  ) {

    return "booking";

  }


  if (
    containsAny(
      normalized,
      [
        "disponibile",
        "disponibilita",
        "posto",
        "posti liberi",
        "libero",
        "libera",
        "ho posto"
      ]
    )
  ) {

    return "availability";

  }


  if (
    containsAny(
      normalized,
      [
        "sposta",
        "rimanda",
        "cambia orario",
        "cambia giorno",
        "modifica appuntamento"
      ]
    )
  ) {

    return "reschedule";

  }


  if (
    containsAny(
      normalized,
      [
        "annulla",
        "cancella",
        "disdici",
        "disdire"
      ]
    )
  ) {

    return "cancel";

  }


  if (
    containsAny(
      normalized,
      [
        "oggi",
        "domani",
        "appuntamenti di",
        "appuntamenti oggi",
        "appuntamenti domani",
        "chi viene",
        "chi ho"
      ]
    )
  ) {

    return "appointments";

  }


  if (
    containsAny(
      normalized,
      [
        "cliente",
        "clienti",
        "scheda cliente",
        "cerca cliente",
        "ultimo appuntamento",
        "storico cliente"
      ]
    )
  ) {

    return "client";

  }


  return "conversation";

}


/* ============================================================
   SERVICES RESPONSE
   ============================================================ */

function answerServices(
  data
) {

  const services =
    getServices(data);

  if (!services.length) {

    return {
      ok: true,
      reply:
        "Non risultano servizi configurati in Maviri.",
      intent: "services"
    };

  }


  const lines =
    services
      .slice(0, 50)
      .map(
        service => {

          const name =
            cleanText(
              service?.name || ""
            );

          if (!name) {
            return "";
          }

          const price =
            service?.price !== undefined &&
            service?.price !== null &&
            String(
              service.price
            ).trim()
              ? `€${service.price}`
              : "";

          const duration =
            service?.duration
              ? `${service.duration} min`
              : "";

          return [
            name,
            price,
            duration
          ]
            .filter(Boolean)
            .join(" — ");

        }
      )
      .filter(Boolean);


  return {
    ok: true,
    reply:
      `I servizi disponibili sono:\n${lines.join("\n")}`,
    intent: "services"
  };

}


/* ============================================================
   PRICE RESPONSE
   ============================================================ */

function answerPrice(
  text,
  data
) {

  const service =
    findService(
      text,
      data
    );

  if (!service) {

    return {
      ok: true,
      reply:
        "Dimmi il nome del servizio e ti verifico il prezzo.",
      intent: "price"
    };

  }


  if (
    service.price === undefined ||
    service.price === null ||
    String(service.price).trim() === ""
  ) {

    return {
      ok: true,
      reply:
        `Per ${service.name} non ho un prezzo configurato.`,
      intent: "price"
    };

  }


  return {
    ok: true,
    reply:
      `${service.name} costa €${service.price}.`,
    intent: "price"
  };

}


/* ============================================================
   PROMOTIONS
   ============================================================ */

function answerPromotions(
  data
) {

  const promotions =
    getPromotions(data);

  if (!promotions.length) {

    return {
      ok: true,
      reply:
        "Al momento non risultano promozioni configurate.",
      intent: "promotions"
    };

  }


  const lines =
    promotions
      .slice(0, 20)
      .map(
        promotion =>
          cleanText(
            promotion?.title ||
            promotion?.name ||
            promotion?.description ||
            ""
          )
      )
      .filter(Boolean);


  return {
    ok: true,
    reply:
      `Le promozioni disponibili sono:\n${lines.join("\n")}`,
    intent: "promotions"
  };

}


/* ============================================================
   HOURS
   ============================================================ */

function answerHours(
  data
) {

  const hours =
    data?.settings?.hours ||
    data?.business?.hours;


  if (!hours) {

    return {
      ok: true,
      reply:
        "Gli orari non sono ancora configurati in Maviri.",
      intent: "hours"
    };

  }


  if (
    typeof hours === "string"
  ) {

    return {
      ok: true,
      reply:
        `Gli orari sono: ${hours}`,
      intent: "hours"
    };

  }


  if (
    typeof hours === "object"
  ) {

    const labels = {
      lunedi: "Lunedì",
      martedi: "Martedì",
      mercoledi: "Mercoledì",
      giovedi: "Giovedì",
      venerdi: "Venerdì",
      sabato: "Sabato",
      domenica: "Domenica"
    };


    const lines =
      Object.keys(labels)
        .map(
          day => {

            const value =
              hours[day];

            if (!value) {
              return "";
            }

            return `${labels[day]}: ${value}`;

          }
        )
        .filter(Boolean);


    if (lines.length) {

      return {
        ok: true,
        reply:
          `Gli orari sono:\n${lines.join("\n")}`,
        intent: "hours"
      };

    }

  }


  return {
    ok: true,
    reply:
      "Non riesco a leggere gli orari configurati.",
    intent: "hours"
  };

}


/* ============================================================
   APPOINTMENTS
   ============================================================ */

function answerAppointments(
  text,
  data
) {

  const appointments =
    findAppointments(
      text,
      data
    );


  const date =
    parseDate(text);


  if (!date) {

    return {
      ok: true,
      reply:
        "Dimmi il giorno che vuoi controllare, per esempio: «appuntamenti di domani».",
      intent: "appointments"
    };

  }


  if (!appointments.length) {

    return {
      ok: true,
      reply:
        `Non risultano appuntamenti per ${italianDate(date)}.`,
      intent: "appointments"
    };

  }


  const lines =
    appointments
      .sort(
        (a, b) =>
          String(a.time || "")
            .localeCompare(
              String(b.time || "")
            )
      )
      .map(
        appointment => {

          const time =
            appointment?.time ||
            "--:--";

          const name =
            appointment?.name ||
            "Cliente";

          const service =
            appointment?.service ||
            "";

          return [
            time,
            name,
            service
          ]
            .filter(Boolean)
            .join(" — ");

        }
      );


  return {
    ok: true,
    reply:
      `Appuntamenti di ${italianDate(date)}:\n${lines.join("\n")}`,
    intent: "appointments",
    data: {
      appointments
    }
  };

}


/* ============================================================
   AVAILABILITY
   ============================================================ */

function answerAvailability(
  text,
  data
) {

  const date =
    parseDate(text);

  const time =
    parseTime(text);

  const service =
    findService(
      text,
      data
    );


  if (!date) {

    return {
      ok: true,
      reply:
        "Per verificare la disponibilità mi serve il giorno.",
      intent: "availability",
      needs: ["date"]
    };

  }


  if (!time) {

    return {
      ok: true,
      reply:
        `Per ${italianDate(date)}, quale orario vuoi verificare?`,
      intent: "availability",
      needs: ["time"],
      date:
        formatDate(date)
    };

  }


  const free =
    isTimeFree(
      date,
      time,
      service,
      data
    );


  if (free) {

    return {
      ok: true,
      reply:
        service
          ? `Sì. ${italianDate(date)} alle ${time.value} risulta libero per ${service.name}.`
          : `Sì. ${italianDate(date)} alle ${time.value} risulta libero.`,
      intent: "availability",
      available: true,
      date:
        formatDate(date),
      time:
        time.value,
      service:
        service?.name || null
    };

  }


  return {
    ok: true,
    reply:
      `No, ${time.value} non risulta disponibile. Posso cercare un altro orario.`,
    intent: "availability",
    available: false,
    date:
      formatDate(date),
    time:
      time.value,
    service:
      service?.name || null
  };

}


/* ============================================================
   BOOKING
   ============================================================ */

function answerBooking(
  text,
  data
) {

  const date =
    parseDate(text);

  const time =
    parseTime(text);

  const service =
    findService(
      text,
      data
    );

  const client =
    findClient(
      text,
      data
    );


  if (!date) {

    return {
      ok: true,
      reply:
        "Certo. Per quale giorno vuoi fissare l'appuntamento?",
      intent: "booking",
      needs: ["date"]
    };

  }


  if (!time) {

    return {
      ok: true,
      reply:
        `Va bene. Per ${italianDate(date)}, che orario preferisci?`,
      intent: "booking",
      needs: ["time"],
      date:
        formatDate(date)
    };

  }


  if (!service) {

    return {
      ok: true,
      reply:
        "Quale servizio vuoi prenotare?",
      intent: "booking",
      needs: ["service"],
      date:
        formatDate(date),
      time:
        time.value
    };

  }


  const free =
    isTimeFree(
      date,
      time,
      service,
      data
    );


  if (!free) {

    return {
      ok: true,
      reply:
        `Alle ${time.value} non risulta disponibilità per ${service.name}. Posso cercare un altro orario.`,
      intent: "booking",
      available: false
    };

  }


  return {
    ok: true,
    reply:
      client?.name
        ? `Ho verificato: ${client.name}, ${service.name}, ${italianDate(date)} alle ${time.value} è disponibile. Vuoi confermare la prenotazione?`
        : `Ho verificato: ${service.name}, ${italianDate(date)} alle ${time.value} è disponibile. Per quale cliente devo inserirla?`,
    intent: "booking",
    available: true,
    requiresConfirmation: true,
    pendingAppointment: {
      name:
        client?.name || "",
      date:
        formatDate(date),
      time:
        time.value,
      service:
        service.name,
      duration:
        Number(
          service.duration || 30
        )
    }
  };

}


/* ============================================================
   CLIENT
   ============================================================ */

function answerClient(
  text,
  data
) {

  const client =
    findClient(
      text,
      data
    );


  if (!client) {

    return {
      ok: true,
      reply:
        "Non ho trovato un cliente corrispondente alla richiesta.",
      intent: "client"
    };

  }


  const appointments =
    getAppointments(data)
      .filter(
        appointment =>
          normalizeText(
            appointment?.name || ""
          ) ===
          normalizeText(
            client.name || ""
          )
      );


  const last =
    appointments
      .slice()
      .sort(
        (a, b) =>
          String(
            b.date || ""
          ).localeCompare(
            String(
              a.date || ""
            )
          )
      )[0];


  const historyCount =
    appointments.length;


  let reply =
    `Scheda di ${client.name}.`;


  if (client.phone) {
    reply +=
      ` Telefono: ${client.phone}.`;
  }


  if (last) {

    reply +=
      ` Ultimo appuntamento: ${last.date || ""} alle ${last.time || ""}`;

    if (last.service) {
      reply +=
        ` per ${last.service}`;
    }

    reply += ".";

  }


  reply +=
    ` Appuntamenti registrati: ${historyCount}.`;


  return {
    ok: true,
    reply,
    intent: "client",
    client
  };

}


/* ============================================================
   CANCEL
   ============================================================ */

function answerCancel(
  text,
  data
) {

  const matches =
    findAppointments(
      text,
      data
    );


  if (!matches.length) {

    return {
      ok: true,
      reply:
        "Non ho trovato un appuntamento preciso da annullare. Indicami cliente, giorno o orario.",
      intent: "cancel"
    };

  }


  if (matches.length > 1) {

    return {
      ok: true,
      reply:
        `Ho trovato ${matches.length} appuntamenti. Indicami quale vuoi annullare.`,
      intent: "cancel",
      appointments:
        matches
    };

  }


  const appointment =
    matches[0];


  return {
    ok: true,
    reply:
      `Ho trovato l'appuntamento di ${appointment.name || "cliente"} del ${appointment.date || ""} alle ${appointment.time || ""}. Vuoi confermare l'annullamento?`,
    intent: "cancel",
    requiresConfirmation: true,
    appointment
  };

}


/* ============================================================
   RESCHEDULE
   ============================================================ */

function answerReschedule(
  text,
  data
) {

  const matches =
    findAppointments(
      text,
      data
    );


  const newDate =
    parseDate(text);

  const newTime =
    parseTime(text);


  if (!matches.length) {

    return {
      ok: true,
      reply:
        "Non ho trovato l'appuntamento da spostare. Indicami il cliente o il giorno attuale.",
      intent: "reschedule"
    };

  }


  const appointment =
    matches[0];


  if (!newDate || !newTime) {

    return {
      ok: true,
      reply:
        `Ho trovato l'appuntamento di ${appointment.name || "cliente"}. A quale giorno e orario vuoi spostarlo?`,
      intent: "reschedule",
      needs:
        [
          "date",
          "time"
        ],
      appointment
    };

  }


  return {
    ok: true,
    reply:
      `Posso spostare l'appuntamento di ${appointment.name || "cliente"} a ${italianDate(newDate)} alle ${newTime.value}. Vuoi confermare?`,
    intent: "reschedule",
    requiresConfirmation: true,
    appointment,
    newDate:
      formatDate(newDate),
    newTime:
      newTime.value
  };

}


/* ============================================================
   CONVERSATION MEMORY
   ============================================================ */

function updateConversation(
  role,
  content
) {

  maviConversation.push({
    role,
    content:
      cleanText(content)
  });

  if (
    maviConversation.length >
    MAVI_MAX_HISTORY
  ) {

    maviConversation =
      maviConversation.slice(
        -MAVI_MAX_HISTORY
      );

  }

}


function getConversation() {

  return [
    ...maviConversation
  ];

}


/* ============================================================
   CONTEXT FOLLOW-UP
   ============================================================ */

function resolveFollowUp(
  text,
  history
) {

  const normalized =
    normalizeText(text);

  if (
    !history?.length
  ) {

    return null;

  }


  const previous =
    history[
      history.length - 1
    ];


  if (
    !previous ||
    previous.role !== "assistant"
  ) {

    return null;

  }


  if (
    /^(si|sì|ok|va bene|certo|confermo|conferma)$/
      .test(normalized)
  ) {

    return {
      type: "confirmation"
    };

  }


  if (
    /^(no|annulla|lascia stare)$/
      .test(normalized)
  ) {

    return {
      type: "rejection"
    };

  }


  return null;

}


/* ============================================================
   CONVERSATION RESPONSE
   ============================================================ */

function answerConversation(
  text,
  data
) {

  const normalized =
    normalizeText(text);


  if (
    containsAny(
      normalized,
      [
        "grazie",
        "grazie mavi"
      ]
    )
  ) {

    return {
      ok: true,
      reply:
        "Di nulla.",
      intent: "conversation"
    };

  }


  if (
    containsAny(
      normalized,
      [
        "perfetto",
        "ottimo",
        "bene"
      ]
    )
  ) {

    return {
      ok: true,
      reply:
        "Perfetto.",
      intent: "conversation"
    };

  }


  if (
    containsAny(
      normalized,
      [
        "aiutami",
        "cosa posso fare",
        "cosa sai fare"
      ]
    )
  ) {

    return {
      ok: true,
      reply:
        "Posso gestire servizi, prezzi, orari, clienti, appuntamenti, disponibilità, prenotazioni, modifiche e cancellazioni. Dimmi semplicemente cosa ti serve.",
      intent: "conversation"
    };

  }


  /*
   * Fallback intelligente locale.
   */

  const service =
    findService(
      text,
      data
    );

  const date =
    parseDate(text);

  const time =
    parseTime(text);


  if (
    service &&
    date &&
    time
  ) {

    return answerAvailability(
      text,
      data
    );

  }


  return {
    ok: true,
    reply:
      "Ho capito la richiesta, ma mi serve qualche dettaglio in più per aiutarti. Puoi indicarmi cliente, servizio, giorno o orario?",
    intent: "conversation"
  };

}


/* ============================================================
   MAIN ENGINE
   ============================================================ */

async function askMavi({

  message = "",

  history = [],

  businessData = {},

  temperature = 0.35

} = {}) {

  const text =
    cleanText(
      message
    )
    .slice(
      0,
      MAVI_MAX_TEXT
    );


  if (!text) {

    return {
      ok: false,
      error:
        "Messaggio vuoto.",
      engine:
        MAVI_ENGINE_NAME,
      version:
        MAVI_ENGINE_VERSION
    };

  }


  maviStatus(
    "thinking",
    "Mavi sta elaborando..."
  );


  /*
   * ----------------------------------------------------------
   * CONTEXT
   * ----------------------------------------------------------
   */

  const mergedHistory =
    Array.isArray(history)
      ? history
      : getConversation();


  const followUp =
    resolveFollowUp(
      text,
      mergedHistory
    );


  /*
   * ----------------------------------------------------------
   * CONFIRMAZIONE
   * ----------------------------------------------------------
   */

  if (
    followUp?.type ===
    "confirmation"
  ) {

    readyStatus();

    updateConversation(
      "user",
      text
    );

    return {
      ok: true,
      reply:
        "Conferma ricevuta. Il Business Engine può procedere con l'operazione.",
      intent:
        "confirmation",
      confirmed:
        true,
      local:
        true,
      aiUsed:
        true,
      engine:
        MAVI_ENGINE_NAME,
      device:
        maviDevice,
      version:
        MAVI_ENGINE_VERSION
    };

  }


  if (
    followUp?.type ===
    "rejection"
  ) {

    readyStatus();

    updateConversation(
      "user",
      text
    );

    return {
      ok: true,
      reply:
        "Va bene, operazione annullata.",
      intent:
        "rejection",
      cancelled:
        true,
      local:
        true,
      aiUsed:
        true,
      engine:
        MAVI_ENGINE_NAME,
      device:
        maviDevice,
      version:
        MAVI_ENGINE_VERSION
    };

  }


  /*
   * ----------------------------------------------------------
   * INTENT
   * ----------------------------------------------------------
   */

  const intent =
    detectIntent(text);


  let result;


  switch (intent) {

    case "greeting":

      result = {
        ok: true,
        reply:
          "Ciao. Sono Mavi, l'intelligenza di Maviri. Come posso aiutarti?",
        intent
      };

      break;


    case "identity":

      result = {
        ok: true,
        reply:
          "Sono Mavi, l'intelligenza artificiale locale di Maviri.",
        intent
      };

      break;


    case "services":

      result =
        answerServices(
          businessData
        );

      break;


    case "price":

      result =
        answerPrice(
          text,
          businessData
        );

      break;


    case "promotions":

      result =
        answerPromotions(
          businessData
        );

      break;


    case "hours":

      result =
        answerHours(
          businessData
        );

      break;


    case "appointments":

      result =
        answerAppointments(
          text,
          businessData
        );

      break;


    case "availability":

      result =
        answerAvailability(
          text,
          businessData
        );

      break;


    case "booking":

      result =
        answerBooking(
          text,
          businessData
        );

      break;


    case "client":

      result =
        answerClient(
          text,
          businessData
        );

      break;


    case "cancel":

      result =
        answerCancel(
          text,
          businessData
        );

      break;


    case "reschedule":

      result =
        answerReschedule(
          text,
          businessData
        );

      break;


    default:

      result =
        answerConversation(
          text,
          businessData
        );

      break;

  }


  /*
   * ----------------------------------------------------------
   * MEMORY
   * ----------------------------------------------------------
   */

  updateConversation(
    "user",
    text
  );

  if (result?.reply) {

    updateConversation(
      "assistant",
      result.reply
    );

  }


  readyStatus();


  return {

    ...result,

    local:
      true,

    aiUsed:
      true,

    engine:
      MAVI_ENGINE_NAME,

    model:
      "Mavi Local E2E",

    device:
      maviDevice,

    version:
      MAVI_ENGINE_VERSION,

    instant:
      true

  };

}


/* ============================================================
   LOAD
   ============================================================ */

async function loadMavi() {

  maviReady = true;
  maviLoading = false;
  maviDevice = "local";

  readyStatus();

  return true;

}


/* ============================================================
   PRELOAD
   ============================================================ */

function preloadMavi() {

  maviReady = true;
  maviLoading = false;

  readyStatus();

  return Promise.resolve(true);

}


/* ============================================================
   RESET CONVERSATION
   ============================================================ */

function resetMaviConversation() {

  maviConversation = [];

  readyStatus();

}


/* ============================================================
   GLOBAL API
   ============================================================ */

window.MaviAI = {

  version:
    MAVI_ENGINE_VERSION,

  model:
    "Mavi Local E2E",

  load:
    loadMavi,

  preload:
    preloadMavi,

  ask:
    askMavi,

  reset:
    resetMaviConversation,

  isReady:
    () => true,

  isLoading:
    () => false,

  getDevice:
    () => "local",

  getVersion:
    () =>
      MAVI_ENGINE_VERSION

};


/* ============================================================
   STARTUP
   ============================================================ */

maviReady = true;
maviLoading = false;
maviDevice = "local";

maviStatus(
  "ready",
  "Mavi locale pronta. Nessun modello esterno richiesto."
);
