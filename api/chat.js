/* MAVIRI — BUSINESS ENGINE
 * Copyright © 2026 Maviri / SimyTech.
 * Proprietary software. All rights reserved.
 *
 * ENGINE:
 * - Nessuna dipendenza da OpenAI
 * - Mavi titolare
 * - Mavi cliente
 * - public-context
 * - owner-sync
 * - disponibilità reale
 * - prenotazione con conferma
 * - seconda verifica server-side
 * - lock anti-doppia prenotazione
 * - Upstash Redis per dati condivisi
 * - modifica appuntamenti
 * - cancellazione appuntamenti
 * - gestione clienti
 */

const LOCK_TTL = 15000;

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || "";

const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || "";

const OWNER_TOKEN =
  process.env.MAVIRI_OWNER_SYNC_TOKEN || "";

const PUBLIC_KEY =
  "maviri:public-context";

const DATA_KEY =
  "maviri:owner-data";

const locks =
  globalThis.__maviriLocks ||
  new Map();

globalThis.__maviriLocks =
  locks;


/* ============================================================
   UTILITY
   ============================================================ */

const clean = v =>
  String(v ?? "")
    .replace(/\u0000/g, "")
    .trim();

const norm = v =>
  clean(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const obj = v =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v);

const arr = v =>
  Array.isArray(v)
    ? v.filter(obj)
    : [];

const mins = v => {

  let s =
    clean(v)
      .replace(/[.,]/g, ":");

  if (/^\d{1,2}$/.test(s)) {
    s += ":00";
  }

  const m =
    s.match(/^(\d{1,2}):(\d{2})$/);

  if (!m) return null;

  const h = +m[1];
  const n = +m[2];

  return (
    h >= 0 &&
    h < 24 &&
    n >= 0 &&
    n < 60
  )
    ? h * 60 + n
    : null;
};

const fmt = n =>
  String(Math.floor(n / 60))
    .padStart(2, "0") +
  ":" +
  String(n % 60)
    .padStart(2, "0");

const validDate = d =>
  /^\d{4}-\d{2}-\d{2}$/.test(
    clean(d)
  );

const todayRome = () =>
  new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }
  ).format(new Date());

const dayKey = d =>
  [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
  ][
    new Date(
      `${d}T12:00:00`
    ).getDay()
  ];

const active = a =>
  ![
    "cancelled",
    "canceled",
    "annullato",
    "cancellato",
    "deleted"
  ].includes(
    norm(
      a?.status ||
      "confirmed"
    )
  );

const apDate = a =>
  clean(
    a?.date ||
    a?.d
  );

const apTime = a =>
  clean(
    a?.time ||
    a?.t
  );

const apService = a =>
  clean(
    a?.service ||
    a?.s
  );


/* ============================================================
   REDIS
   ============================================================ */

async function redisCommand(
  command,
  ...args
) {

  if (
    !REDIS_URL ||
    !REDIS_TOKEN
  ) {
    throw new Error(
      "Upstash Redis non configurato."
    );
  }

  const response =
    await fetch(
      REDIS_URL,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${REDIS_TOKEN}`,
          "Content-Type":
            "application/json"
        },
        body:
          JSON.stringify([
            command,
            ...args
          ])
      }
    );

  if (!response.ok) {
    throw new Error(
      `Redis HTTP ${response.status}`
    );
  }

  const result =
    await response.json();

  if (
    result.error
  ) {
    throw new Error(
      String(result.error)
    );
  }

  return result.result;
}

async function redisGet(
  key
) {

  const value =
    await redisCommand(
      "GET",
      key
    );

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function redisSet(
  key,
  value
) {

  return redisCommand(
    "SET",
    key,
    JSON.stringify(value)
  );
}


/* ============================================================
   TOKEN PROPRIETARIO
   ============================================================ */

function ownerAuthorized(req) {

  if (!OWNER_TOKEN) {
    return false;
  }

  const token =
    clean(
      req.headers[
        "x-maviri-owner-token"
      ]
    );

  return (
    token &&
    token === OWNER_TOKEN
  );
}


/* ============================================================
   ORARI
   ============================================================ */

function getHours(
  settings,
  date
) {

  const hours =
    obj(settings?.hours)
      ? settings.hours
      : {};

  const k =
    dayKey(date);

  const raw =
    obj(hours[k])
      ? hours[k]
      : null;

  if (!raw) {
    return null;
  }

  const pauses =
    Array.isArray(
      raw.pauses
    )
      ? raw.pauses
          .map(p => ({
            from:
              clean(
                p.from ||
                p.start ||
                p.pauseStart
              ),
            to:
              clean(
                p.to ||
                p.end ||
                p.pauseEnd
              )
          }))
          .filter(
            p =>
              mins(p.from) !== null &&
              mins(p.to) !== null &&
              mins(p.from) <
              mins(p.to)
          )
      : [];

  if (
    clean(raw.breakStart) &&
    clean(raw.breakEnd)
  ) {

    pauses.push({
      from:
        clean(
          raw.breakStart
        ),
      to:
        clean(
          raw.breakEnd
        )
    });
  }

  return {

    closed:
      raw.closed === true ||
      raw.open === false ||
      raw.status === "closed" ||
      raw.status === "chiuso",

    open:
      clean(
        raw.open ||
        raw.start ||
        raw.from
      ),

    close:
      clean(
        raw.close ||
        raw.end ||
        raw.to
      ),

    pauses
  };
}


/* ============================================================
   SERVIZI
   ============================================================ */

function findService(
  services,
  name
) {

  const t =
    norm(name);

  if (!t) {
    return null;
  }

  return (

    services.find(
      s =>
        norm(s.name) === t
    ) ||

    services.find(
      s => {

        const n =
          norm(s.name);

        return (
          n &&
          (
            t.includes(n) ||
            n.includes(t)
          )
        );
      }
    ) ||

    null
  );
}

function duration(
  service
) {

  const n =
    Number(
      service?.duration
    );

  return (
    Number.isFinite(n) &&
    n > 0
  )
    ? Math.round(n)
    : 30;
}


/* ============================================================
   DISPONIBILITÀ
   ============================================================ */

function freeSlot({
  date,
  time,
  service,
  appointments,
  settings,
  services,
  ignoreId = ""
}) {

  if (
    !validDate(date)
  ) {
    return false;
  }

  const day =
    getHours(
      settings,
      date
    );

  if (
    !day ||
    day.closed
  ) {
    return false;
  }

  const start =
    mins(time);

  const open =
    mins(day.open);

  const close =
    mins(day.close);

  const dur =
    duration(service);

  if (
    start === null ||
    open === null ||
    close === null
  ) {
    return false;
  }

  const end =
    start + dur;

  if (
    start < open ||
    end > close
  ) {
    return false;
  }

  if (
    day.pauses.some(
      p => {

        const ps =
          mins(p.from);

        const pe =
          mins(p.to);

        if (
          ps === null ||
          pe === null
        ) {
          return false;
        }

        return (
          start < pe &&
          end > ps
        );
      }
    )
  ) {
    return false;
  }

  return !appointments.some(
    a => {

      if (
        !active(a)
      ) {
        return false;
      }

      if (
        String(a.id) ===
        String(ignoreId)
      ) {
        return false;
      }

      if (
        apDate(a) !== date
      ) {
        return false;
      }

      const existingStart =
        mins(
          apTime(a)
        );

      if (
        existingStart === null
      ) {
        return false;
      }

      const existingService =
        findService(
          services,
          apService(a)
        );

      const existingEnd =
        existingStart +
        duration(
          existingService
        );

      return (
        start < existingEnd &&
        end > existingStart
      );
    }
  );
}


/* ============================================================
   SLOT DISPONIBILI
   ============================================================ */

function availableSlots({
  date,
  service,
  appointments,
  settings,
  services
}) {

  const day =
    getHours(
      settings,
      date
    );

  if (
    !day ||
    day.closed
  ) {
    return [];
  }

  const open =
    mins(day.open);

  const close =
    mins(day.close);

  const step = 30;

  if (
    open === null ||
    close === null
  ) {
    return [];
  }

  const result = [];

  for (
    let t =
      Math.ceil(
        open / step
      ) * step;

    t +
      duration(service)
      <= close;

    t += step
  ) {

    const time =
      fmt(t);

    if (
      freeSlot({
        date,
        time,
        service,
        appointments,
        settings,
        services
      })
    ) {
      result.push(
        time
      );
    }
  }

  return result;
}


/* ============================================================
   LOCK
   ============================================================ */

function bookingKey(
  date,
  time,
  service,
  name
) {

  return [
    date,
    time,
    norm(
      service?.name ||
      service
    ),
    norm(name)
  ].join("|");
}

function acquire(
  key
) {

  const now =
    Date.now();

  for (
    const [k, t]
    of locks
  ) {

    if (
      now - t >
      LOCK_TTL
    ) {
      locks.delete(k);
    }
  }

  if (
    locks.has(key)
  ) {
    return false;
  }

  locks.set(
    key,
    now
  );

  return true;
}

function release(
  key
) {
  locks.delete(key);
}


/* ============================================================
   CLIENTI
   ============================================================ */

function normalizeClient(
  client
) {

  if (
    !obj(client)
  ) {
    return null;
  }

  return {

    id:
      clean(client.id) ||
      `client-${crypto.randomUUID()}`,

    name:
      clean(client.name),

    phone:
      clean(client.phone),

    whatsapp:
      clean(
        client.whatsapp ||
        client.phone
      ),

    email:
      clean(client.email),

    notes:
      clean(
        client.notes ||
        client.personalNotes
      )
  };
}

function findClient(
  clients,
  name,
  phone
) {

  const n =
    norm(name);

  const p =
    clean(phone);

  return (

    clients.find(
      c =>
        n &&
        norm(c.name) === n
    ) ||

    clients.find(
      c =>
        p &&
        clean(c.phone) === p
    ) ||

    null
  );
}

function clientFromBooking({
  clients,
  name,
  phone,
  whatsapp,
  email,
  notes
}) {

  const existing =
    findClient(
      clients,
      name,
      phone
    );

  if (existing) {

    return {

      ...normalizeClient(
        existing
      ),

      name:
        clean(name) ||
        existing.name,

      phone:
        clean(phone) ||
        existing.phone,

      whatsapp:
        clean(whatsapp) ||
        existing.whatsapp,

      email:
        clean(email) ||
        existing.email,

      notes:
        clean(notes) ||
        existing.notes
    };
  }

  return {

    id:
      `client-${crypto.randomUUID()}`,

    name:
      clean(name),

    phone:
      clean(phone),

    whatsapp:
      clean(whatsapp),

    email:
      clean(email),

    notes:
      clean(notes)
  };
}


/* ============================================================
   DATI PUBBLICI
   ============================================================ */

function makePublicContext(
  data
) {

  const business =
    obj(data.business)
      ? data.business
      : {};

  const settings =
    obj(data.settings)
      ? data.settings
      : {};

  return {

    ok: true,

    mode: "client",

    local: true,

    engine:
      "maviri-business-engine-v4",

    today:
      todayRome(),

    business: {

      name:
        clean(
          business.name ||
          settings.name
        ),

      type:
        clean(
          business.type ||
          settings.type
        ),

      description:
        clean(
          business.description ||
          settings.description
        ),

      address:
        clean(
          business.address ||
          settings.address
        ),

      phone:
        clean(
          business.phone ||
          settings.phone
        ),

      whatsapp:
        clean(
          business.whatsapp ||
          settings.whatsapp
        )
    },

    services:
      arr(data.services),

    promotions:
      arr(data.promotions),

    /*
     * Nessun cliente.
     * Nessun appuntamento privato.
     * Nessuna nota interna.
     */
    appointments: []
  };
}


/* ============================================================
   DATASET PROPRIETARIO
   ============================================================ */

function sanitizeOwnerData(
  body
) {

  return {

    version:
      Number(
        body.version || 1
      ),

    revision:
      Number(
        body.revision || 0
      ),

    updatedAt:
      clean(
        body.updatedAt
      ) ||
      new Date().toISOString(),

    business:
      obj(body.business)
        ? body.business
        : {},

    settings:
      obj(body.settings)
        ? body.settings
        : {},

    services:
      arr(body.services),

    promotions:
      arr(body.promotions),

    clients:
      arr(body.clients),

    appointments:
      arr(body.appointments)
  };
}


/* ============================================================
   DATASET SERVER
   ============================================================ */

async function getServerData() {

  const data =
    await redisGet(
      DATA_KEY
    );

  if (
    !obj(data)
  ) {
    return null;
  }

  return data;
}


/* ============================================================
   RISPOSTA MAVIRI
   ============================================================ */

function businessName(
  data
) {

  return clean(
    data?.business?.name ||
    data?.settings?.name ||
    "l'attività"
  );
}

function serviceList(
  services
) {

  if (
    !services.length
  ) {
    return "Non risultano servizi configurati.";
  }

  return services
    .map(
      s =>
        `${s.name} — ${Number(s.price || 0).toFixed(2)} € — ${duration(s)} minuti`
    )
    .join("\n");
}

function promotionList(
  promotions
) {

  if (
    !promotions.length
  ) {
    return "Non risultano promozioni attive.";
  }

  return promotions
    .map(
      p =>
        clean(
          p.title ||
          p.name ||
          p.description
        )
    )
    .filter(Boolean)
    .join("\n");
}


/* ============================================================
   RICONOSCIMENTO RICHIESTE
   ============================================================ */

function detectService(
  text,
  services
) {

  const n =
    norm(text);

  return (
    services.find(
      s =>
        n.includes(
          norm(s.name)
        )
    ) ||
    null
  );
}

function detectDate(
  text
) {

  const n =
    norm(text);

  const today =
    new Date();

  if (
    n.includes("oggi")
  ) {
    return todayRome();
  }

  if (
    n.includes("domani")
  ) {

    const d =
      new Date(today);

    d.setDate(
      d.getDate() + 1
    );

    return d
      .toISOString()
      .slice(0, 10);
  }

  const match =
    n.match(
      /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/
    );

  if (match) {

    let year =
      match[3]
        ? Number(match[3])
        : today.getFullYear();

    if (
      year < 100
    ) {
      year += 2000;
    }

    const month =
      String(
        Number(match[2])
      ).padStart(2, "0");

    const day =
      String(
        Number(match[1])
      ).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  const weekdays = {
    domenica: 0,
    lunedi: 1,
    martedi: 2,
    mercoledi: 3,
    giovedi: 4,
    venerdi: 5,
    sabato: 6
  };

  for (
    const [name, index]
    of Object.entries(
      weekdays
    )
  ) {

    if (
      n.includes(name)
    ) {

      const d =
        new Date(today);

      const current =
        d.getDay();

      let delta =
        index - current;

      if (
        delta <= 0
      ) {
        delta += 7;
      }

      d.setDate(
        d.getDate() + delta
      );

      return d
        .toISOString()
        .slice(0, 10);
    }
  }

  return null;
}

function detectTime(
  text
) {

  const m =
    clean(text)
      .match(
        /\b([01]?\d|2[0-3])(?:[:.](\d{2}))?\b/
      );

  if (!m) {
    return null;
  }

  return (
    String(
      Number(m[1])
    ).padStart(2, "0") +
    ":" +
    String(
      m[2] || "00"
    ).padStart(2, "0")
  );
}


/* ============================================================
   CHAT LOCALE MAVIRI
   ============================================================ */

async function localChat({
  message,
  history,
  mode,
  data
}) {

  const text =
    norm(message);

  const services =
    arr(data.services);

  const promotions =
    arr(data.promotions);

  const appointments =
    arr(data.appointments);

  const name =
    businessName(data);


  /*
   * SALUTO
   */

  if (
    /^(ciao|salve|buongiorno|buonasera|hey|ehi)\b/
      .test(text)
  ) {

    return `Ciao. Sono Mavi, l'assistente di ${name}. Posso aiutarti con servizi, prezzi, promozioni e disponibilità.`;
  }


  /*
   * SERVIZI
   */

  if (
    /servizi|trattamenti|cosa fate|cosa offrite|prestazioni/
      .test(text)
  ) {

    return (
      `Questi sono i servizi disponibili:\n\n` +
      serviceList(services)
    );
  }


  /*
   * PREZZI
   */

  if (
    /prezzo|prezzi|costa|costano|quanto costa|quanto viene/
      .test(text)
  ) {

    const service =
      detectService(
        text,
        services
      );

    if (service) {

      return (
        `${service.name} costa ` +
        `${Number(service.price || 0).toFixed(2)} €. ` +
        `La durata prevista è di ${duration(service)} minuti.`
      );
    }

    return (
      `Posso indicarti i prezzi dei servizi:\n\n` +
      serviceList(services)
    );
  }


  /*
   * PROMOZIONI
   */

  if (
    /promo|promozione|promozioni|offerta|offerte|sconto|sconti/
      .test(text)
  ) {

    return (
      `Le promozioni disponibili sono:\n\n` +
      promotionList(promotions)
    );
  }


  /*
   * IDENTIFICAZIONE SERVIZIO
   */

  const service =
    detectService(
      text,
      services
    );

  const date =
    detectDate(text);

  const time =
    detectTime(text);


  /*
   * DISPONIBILITÀ
   */

  if (
    /disponibil|libero|libera|posto|orario|appuntamento|prenotare|prenotazione/
      .test(text) &&
    service &&
    date
  ) {

    const slots =
      availableSlots({
        date,
        service,
        appointments,
        settings:
          data.settings,
        services
      });

    if (
      !slots.length
    ) {

      return (
        `Per ${service.name} il ` +
        `${date} non risultano orari disponibili. ` +
        `Posso verificare un altro giorno.`
      );
    }

    if (
      time
    ) {

      if (
        freeSlot({
          date,
          time,
          service,
          appointments,
          settings:
            data.settings,
          services
        })
      ) {

        return (
          `Sì, ${time} è disponibile per ` +
          `${service.name} il ${date}. ` +
          `Se vuoi prenotarlo, indicami il tuo nome.`
        );
      }

      return (
        `Alle ${time} non è disponibile. ` +
        `Gli orari disponibili sono: ` +
        slots.join(", ") +
        "."
      );
    }

    return (
      `Per ${service.name} il ${date} ` +
      `gli orari disponibili sono: ` +
      slots.join(", ") +
      "."
    );
  }


  /*
   * ORARI ATTIVITÀ
   */

  if (
    /orari|aperto|apertura|chiusura|chiude|aprite/
      .test(text)
  ) {

    const dateForHours =
      date ||
      todayRome();

    const h =
      getHours(
        data.settings,
        dateForHours
      );

    if (
      !h ||
      h.closed
    ) {

      return (
        `Per il ${dateForHours} ` +
        `${name} è chiuso.`
      );
    }

    let answer =
      `${name} è aperto ` +
      `dalle ${h.open} alle ${h.close}.`;

    if (
      h.pauses.length
    ) {

      answer +=
        " Pause: " +
        h.pauses
          .map(
            p =>
              `${p.from}-${p.to}`
          )
          .join(", ") +
        ".";
    }

    return answer;
  }


  /*
   * CONTATTI
   */

  if (
    /telefono|numero|contatto|whatsapp|indirizzo|dove siete|dove vi trovate/
      .test(text)
  ) {

    const b =
      data.business || {};

    const parts = [];

    if (
      b.address
    ) {
      parts.push(
        `Indirizzo: ${b.address}`
      );
    }

    if (
      b.phone
    ) {
      parts.push(
        `Telefono: ${b.phone}`
      );
    }

    if (
      b.whatsapp
    ) {
      parts.push(
        `WhatsApp: ${b.whatsapp}`
      );
    }

    return parts.length
      ? parts.join("\n")
      : "I dati di contatto non sono ancora configurati.";
  }


  /*
   * RICHIESTA PRENOTAZIONE SENZA DATI SUFFICIENTI
   */

  if (
    /prenot|appuntamento|voglio venire|vorrei venire|posso venire/
      .test(text)
  ) {

    if (!service) {

      return (
        "Certo. Quale servizio vuoi prenotare?"
      );
    }

    if (!date) {

      return (
        `Per ${service.name}, quale giorno preferisci?`
      );
    }

    const slots =
      availableSlots({
        date,
        service,
        appointments,
        settings:
          data.settings,
        services
      });

    if (!slots.length) {

      return (
        `Per ${service.name} il ${date} ` +
        `non ci sono orari disponibili.`
      );
    }

    return (
      `Per ${service.name} il ${date} ` +
      `sono disponibili: ${slots.join(", ")}. ` +
      `Quale orario preferisci?`
    );
  }


  /*
   * FALLBACK LOCALE
   */

  return (
    "Posso aiutarti con servizi, prezzi, " +
    "promozioni, orari, disponibilità e prenotazioni. " +
    "Dimmi cosa ti serve."
  );
}


/* ============================================================
   HANDLER
   ============================================================ */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  res.setHeader(
    "X-Content-Type-Options",
    "nosniff"
  );

  res.setHeader(
    "X-Frame-Options",
    "DENY"
  );

  if (
    req.method !== "POST"
  ) {

    return res
      .status(405)
      .json({
        ok: false,
        error:
          "Metodo non consentito."
      });
  }

  try {

    const body =
      obj(req.body)
        ? req.body
        : {};

    const action =
      clean(body.action);

    const mode =
      clean(
        body.mode ||
        (
          body.role === "client"
            ? "client"
            : "owner"
        )
      );


    /* ========================================================
       OWNER SYNC
       ======================================================== */

    if (
      action === "owner-sync"
    ) {

      if (
        !ownerAuthorized(req)
      ) {

        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Token proprietario non valido."
          });
      }

      const data =
        sanitizeOwnerData(
          body
        );

      if (
        !REDIS_URL ||
        !REDIS_TOKEN
      ) {

        return res
          .status(503)
          .json({
            ok: false,
            error:
              "Sincronizzazione server non configurata: Upstash Redis mancante."
          });
      }

      await redisSet(
        DATA_KEY,
        data
      );

      const publicContext =
        makePublicContext(
          data
        );

      await redisSet(
        PUBLIC_KEY,
        publicContext
      );

      return res
        .status(200)
        .json({

          ok: true,

          synced: true,

          revision:
            data.revision,

          updatedAt:
            data.updatedAt,

          message:
            "Dati Maviri sincronizzati con Mavi cliente."
        });
    }


    /* ========================================================
       PUBLIC CONTEXT
       ======================================================== */

    if (
      action === "public-context"
    ) {

      if (
        !REDIS_URL ||
        !REDIS_TOKEN
      ) {

        return res
          .status(503)
          .json({
            ok: false,
            error:
              "Mavi cliente non è ancora configurata."
          });
      }

      const context =
        await redisGet(
          PUBLIC_KEY
        );

      if (
        !context
      ) {

        return res
          .status(404)
          .json({
            ok: false,
            error:
              "Dati pubblici dell'attività non ancora sincronizzati."
          });
      }

      return res
        .status(200)
        .json(context);
    }


    /* ========================================================
       CONTEXT
       ======================================================== */

    if (
      action === "context"
    ) {

      if (
        mode === "client"
      ) {

        const context =
          REDIS_URL &&
          REDIS_TOKEN
            ? await redisGet(
                PUBLIC_KEY
              )
            : null;

        if (
          context
        ) {
          return res
            .status(200)
            .json(context);
        }

        return res
          .status(503)
          .json({
            ok: false,
            error:
              "Contesto pubblico non disponibile."
          });
      }

      return res
        .status(200)
        .json({

          ok: true,

          mode: "owner",

          local: true,

          engine:
            "maviri-business-engine-v4",

          today:
            todayRome(),

          business:
            clean(
              body.business?.name ||
              body.settings?.name
            ),

          services:
            arr(body.services),

          clients:
            arr(body.clients),

          promotions:
            arr(body.promotions),

          appointments:
            arr(body.appointments)
              .filter(active)
        });
    }


    /* ========================================================
       CHAT
       ======================================================== */

    if (
      action === "chat"
    ) {

      let data;

      if (
        mode === "client"
      ) {

        data =
          await getServerData();

        if (
          !data
        ) {

          return res
            .status(503)
            .json({
              ok: false,
              error:
                "Mavi cliente non è ancora collegata ai dati dell'attività."
            });
        }

      } else {

        data = {

          business:
            obj(body.business)
              ? body.business
              : {},

          settings:
            obj(body.settings)
              ? body.settings
              : {},

          services:
            arr(body.services),

          promotions:
            arr(body.promotions),

          clients:
            arr(body.clients),

          appointments:
            arr(body.appointments)
        };
      }

      const answer =
        await localChat({

          message:
            clean(body.message),

          history:
            Array.isArray(
              body.history
            )
              ? body.history
              : [],

          mode,

          data
        });

      return res
        .status(200)
        .json({

          ok: true,

          mode,

          local: true,

          engine:
            "maviri-business-engine-v4",

          answer
        });
    }


    /* ========================================================
       AVAILABILITY
       ======================================================== */

    if (
      action === "availability"
    ) {

      let data;

      if (
        mode === "client"
      ) {

        data =
          await getServerData();

        if (
          !data
        ) {

          return res
            .status(503)
            .json({
              ok: false,
              error:
                "Dati attività non disponibili."
            });
        }

      } else {

        data = body;
      }

      const date =
        clean(body.date);

      const service =
        findService(
          arr(data.services),
          body.service ||
          body.serviceName
        );

      if (
        !validDate(date)
      ) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Data non valida."
          });
      }

      if (
        !service
      ) {

        return res
          .status(400)
          .json({
            ok: false,
            error:
              "Servizio non trovato."
          });
      }

      const slots =
        availableSlots({

          date,

          service,

          appointments:
            arr(data.appointments),

          settings:
            data.settings,

          services:
            arr(data.services)
        });

      return res
        .status(200)
        .json({

          ok: true,

          available:
            slots.length > 0,

          date,

          service:
            service.name,

          duration:
            duration(service),

          slots,

          availableSlots:
            slots
        });
    }


    /* ========================================================
       BOOK
       ======================================================== */

    if (
      action === "book"
    ) {

      let data;

      if (
        mode === "client"
      ) {

        data =
          await getServerData();

        if (
          !data
        ) {

          return res
            .status(503)
            .json({
              ok: false,
              bookingConfirmed: false,
              error:
                "Dati dell'attività non disponibili."
            });
        }

      } else {

        data = body;
      }

      const date =
        clean(body.date);

      const time =
        clean(body.time);

      const name =
        clean(
          body.name ||
          body.clientName
        );

      const phone =
        clean(body.phone);

      const whatsapp =
        clean(body.whatsapp);

      const email =
        clean(body.email);

      const notes =
        clean(body.notes);

      const services =
        arr(data.services);

      const appointments =
        arr(data.appointments);

      const clients =
        arr(data.clients);

      const service =
        findService(
          services,
          body.service ||
          body.serviceName
        );

      if (
        !validDate(date) ||
        mins(time) === null ||
        !name ||
        !service
      ) {

        return res
          .status(400)
          .json({

            ok: false,

            bookingConfirmed:
              false,

            error:
              "Dati della prenotazione incompleti."
          });
      }


      /*
       * Il server richiede che la
       * richiesta arrivi dopo una
       * conferma esplicita.
       */

      const confirmed =
        body.confirmed === true ||
        body.confirm === true ||
        body.bookingConfirmed === true;

      if (
        !confirmed
      ) {

        return res
          .status(200)
          .json({

            ok: true,

            bookingConfirmed:
              false,

            requiresConfirmation:
              true,

            appointment: {

              date,

              time,

              service:
                service.name,

              duration:
                duration(service),

              name
            },

            message:
              `Confermi la prenotazione di ${service.name} ` +
              `per ${name} il ${date} alle ${time}?`
          });
      }


      const key =
        bookingKey(
          date,
          time,
          service,
          name
        );

      if (
        !acquire(key)
      ) {

        return res
          .status(409)
          .json({

            ok: false,

            bookingConfirmed:
              false,

            error:
              "Prenotazione già in elaborazione. Riprova tra qualche secondo."
          });
      }

      try {

        /*
         * SECONDO CONTROLLO
         */

        if (
          !freeSlot({

            date,

            time,

            service,

            appointments,

            settings:
              data.settings,

            services
          })
        ) {

          return res
            .status(409)
            .json({

              ok: false,

              bookingConfirmed:
                false,

              error:
                "Orario non disponibile.",

              availableSlots:
                availableSlots({

                  date,

                  service,

                  appointments,

                  settings:
                    data.settings,

                  services
                })
            });
        }


        const client =
          clientFromBooking({

            clients,

            name,

            phone,

            whatsapp,

            email,

            notes
          });


        const id =
          clean(body.ignoreId) ||
          `${date}|${time}|${crypto.randomUUID()}`;


        const appointment = {

          id,

          clientId:
            client.id,

          name,

          phone,

          whatsapp,

          email,

          date,

          time,

          service:
            service.name,

          duration:
            duration(service),

          status:
            "confirmed",

          notes,

          createdAt:
            new Date().toISOString(),

          source:
            mode === "client"
              ? "mavi-client"
              : "mavi-owner"
        };


        /*
         * CLIENTE:
         * ritorniamo il risultato.
         *
         * TITOLARE:
         * l'index lo salva nel localStorage.
         *
         * Per Mavi cliente la sincronizzazione
         * server viene aggiornata qui.
         */

        if (
          mode === "client"
        ) {

          const current =
            data;

          const nextClients =
            arr(
              current.clients
            );

          if (
            !nextClients.some(
              c =>
                String(c.id) ===
                String(client.id)
            )
          ) {

            nextClients.push(
              client
            );
          }

          const nextAppointments =
            arr(
              current.appointments
            );

          nextAppointments.push(
            appointment
          );

          const nextData = {

            ...current,

            clients:
              nextClients,

            appointments:
              nextAppointments,

            revision:
              Number(
                current.revision || 0
              ) + 1,

            updatedAt:
              new Date().toISOString()
          };

          await redisSet(
            DATA_KEY,
            nextData
          );

          await redisSet(
            PUBLIC_KEY,
            makePublicContext(
              nextData
            )
          );
        }

        return res
          .status(200)
          .json({

            ok: true,

            bookingConfirmed:
              true,

            appointment,

            client,

            message:
              "Prenotazione confermata."
          });

      } finally {

        release(key);
      }
    }


    /* ========================================================
       UPDATE
       ======================================================== */

    if (
      action === "update"
    ) {

      let data;

      if (
        mode === "client"
      ) {

        data =
          await getServerData();

        if (
          !data
        ) {

          return res
            .status(503)
            .json({
              ok: false,
              error:
                "Dati attività non disponibili."
            });
        }

      } else {

        data = body;
      }

      const id =
        clean(body.id);

      const date =
        clean(body.date);

      const time =
        clean(body.time);

      const name =
        clean(
          body.name ||
          body.clientName
        );

      const services =
        arr(data.services);

      const appointments =
        arr(data.appointments);

      const service =
        findService(
          services,
          body.service ||
          body.serviceName
        );

      if (
        !id ||
        !validDate(date) ||
        mins(time) === null ||
        !name ||
        !service
      ) {

        return res
          .status(400)
          .json({

            ok: false,

            error:
              "Dati modifica appuntamento incompleti."
          });
      }


      const key =
        bookingKey(
          date,
          time,
          service,
          name
        );

      if (
        !acquire(key)
      ) {

        return res
          .status(409)
          .json({

            ok: false,

            error:
              "Modifica già in elaborazione."
          });
      }

      try {

        if (
          !freeSlot({

            date,

            time,

            service,

            appointments,

            settings:
              data.settings,

            services,

            ignoreId: id
          })
        ) {

          return res
            .status(409)
            .json({

              ok: false,

              error:
                "Il nuovo orario non è disponibile.",

              availableSlots:
                availableSlots({

                  date,

                  service,

                  appointments,

                  settings:
                    data.settings,

                  services
                })
            });
        }


        const updated = {

          id,

          clientId:
            clean(
              body.clientId
            ),

          name,

          phone:
            clean(body.phone),

          whatsapp:
            clean(body.whatsapp),

          email:
            clean(body.email),

          date,

          time,

          service:
            service.name,

          duration:
            duration(service),

          status:
            clean(body.status) ||
            "confirmed",

          notes:
            clean(body.notes),

          updatedAt:
            new Date().toISOString()
        };


        if (
          mode === "client"
        ) {

          const nextAppointments =
            appointments.map(
              a =>
                String(a.id) ===
                String(id)
                  ? {
                      ...a,
                      ...updated
                    }
                  : a
            );

          const nextData = {

            ...data,

            appointments:
              nextAppointments,

            revision:
              Number(
                data.revision || 0
              ) + 1,

            updatedAt:
              new Date().toISOString()
          };

          await redisSet(
            DATA_KEY,
            nextData
          );

          await redisSet(
            PUBLIC_KEY,
            makePublicContext(
              nextData
            )
          );
        }

        return res
          .status(200)
          .json({

            ok: true,

            appointment:
              updated,

            message:
              "Appuntamento modificato."
          });

      } finally {

        release(key);
      }
    }


    /* ========================================================
       CANCEL
       ======================================================== */

    if (
      action === "cancel"
    ) {

      const id =
        clean(body.id);

      if (!id) {

        return res
          .status(400)
          .json({

            ok: false,

            error:
              "ID appuntamento mancante."
          });
      }


      if (
        mode === "client"
      ) {

        const data =
          await getServerData();

        if (
          !data
        ) {

          return res
            .status(503)
            .json({

              ok: false,

              error:
                "Dati attività non disponibili."
            });
        }

        const nextAppointments =
          arr(
            data.appointments
          ).map(
            a =>
              String(a.id) ===
              String(id)
                ? {
                    ...a,
                    status:
                      "cancelled",
                    cancelledAt:
                      new Date().toISOString()
                  }
                : a
          );

        const nextData = {

          ...data,

          appointments:
            nextAppointments,

          revision:
            Number(
              data.revision || 0
            ) + 1,

          updatedAt:
            new Date().toISOString()
        };

        await redisSet(
          DATA_KEY,
          nextData
        );

        await redisSet(
          PUBLIC_KEY,
          makePublicContext(
            nextData
          )
        );
      }

      return res
        .status(200)
        .json({

          ok: true,

          cancelled:
            true,

          id,

          status:
            "cancelled",

          message:
            "Appuntamento annullato."
        });
    }


    /* ========================================================
       CLIENT LOOKUP
       ======================================================== */

    if (
      action === "client"
    ) {

      if (
        mode !== "owner"
      ) {

        return res
          .status(403)
          .json({

            ok: false,

            error:
              "Operazione non disponibile per il cliente."
          });
      }

      const name =
        clean(body.name);

      const phone =
        clean(body.phone);

      const clients =
        arr(body.clients);

      const appointments =
        arr(body.appointments);

      const client =
        findClient(
          clients,
          name,
          phone
        );

      if (
        !client
      ) {

        return res
          .status(404)
          .json({

            ok: false,

            client: null,

            error:
              "Cliente non trovato."
          });
      }

      const history =
        appointments
          .filter(
            a => {

              if (
                !active(a)
              ) {
                return false;
              }

              if (
                client.id &&
                String(a.clientId) ===
                String(client.id)
              ) {
                return true;
              }

              return (
                norm(a.name) ===
                norm(client.name)
              );
            }
          )
          .sort(
            (a, b) =>
              `${a.date} ${a.time}`
                .localeCompare(
                  `${b.date} ${b.time}`
                )
          );

      return res
        .status(200)
        .json({

          ok: true,

          client,

          appointments:
            history
        });
    }


    /* ========================================================
       UNKNOWN
       ======================================================== */

    return res
      .status(400)
      .json({

        ok: false,

        error:
          "Azione API non riconosciuta."
      });

  } catch (error) {

    console.error(
      "MAVIRI API ERROR:",
      error
    );

    return res
      .status(500)
      .json({

        ok: false,

        error:
          "Errore interno del servizio Maviri."
      });
  }
}
