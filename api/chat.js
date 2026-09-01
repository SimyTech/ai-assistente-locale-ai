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
 * - owner-pull
 * - disponibilità reale
 * - prenotazione con conferma
 * - seconda verifica server-side
 * - lock Redis anti-doppia prenotazione
 * - Upstash Redis per dati condivisi
 * - modifica appuntamenti
 * - cancellazione appuntamenti
 * - gestione clienti
 * - base pronta per collegamento WhatsApp
 */

import {
  explicitTenantId,
  isValidTenantId,
  resolveTenantId,
  tenantDataKey,
  tenantLockPrefix,
  tenantPublicKey
} from "../lib/tenant.js";
import {
  clientOwnsAppointment,
  ownerAuthorized
} from "../lib/auth.js";
import {
  clientAddress,
  rateLimitKey,
  rateLimitPolicy
} from "../lib/rate-limit.js";

const LOCK_TTL = 15000;
const MAX_BODY_BYTES = 1024 * 1024;

const OWNER_PROTECTED_ACTIONS = new Set([
  "book",
  "update",
  "cancel",
  "client",
  "whatsapp-message"
]);

const redisUrl = () =>
  process.env.UPSTASH_REDIS_REST_URL || "";

const redisToken = () =>
  process.env.UPSTASH_REDIS_REST_TOKEN || "";

const redisConfigured = () =>
  Boolean(redisUrl() && redisToken());

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

  if (!m) {
    return null;
  }

  const h = Number(m[1]);
  const n = Number(m[2]);

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

const dayKey = d => {

  if (!validDate(d)) {
    return "";
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
      `${d}T12:00:00`
    ).getDay()
  ];
};

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
    !redisConfigured()
  ) {
    throw new Error(
      "Upstash Redis non configurato."
    );
  }

  const response =
    await fetch(
      redisUrl(),
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${redisToken()}`,
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

async function redisSetNX(
  key,
  value,
  ttl
) {

  return redisCommand(
    "SET",
    key,
    value,
    "NX",
    "PX",
    String(ttl)
  );
}

async function enforceRateLimit({
  req,
  res,
  tenantId,
  action
}) {
  const policy =
    rateLimitPolicy(action);

  if (!policy) {
    return false;
  }

  const key =
    rateLimitKey({
      tenantId,
      action,
      identity: clientAddress(req)
    });

  const count =
    Number(await redisCommand("INCR", key));

  if (count === 1) {
    await redisCommand(
      "EXPIRE",
      key,
      String(policy.windowSeconds)
    );
  }

  res.setHeader(
    "X-RateLimit-Limit",
    String(policy.limit)
  );

  res.setHeader(
    "X-RateLimit-Remaining",
    String(Math.max(0, policy.limit - count))
  );

  if (count <= policy.limit) {
    return false;
  }

  res.setHeader(
    "Retry-After",
    String(policy.windowSeconds)
  );

  res
    .status(429)
    .json({
      ok: false,
      error: "Troppe richieste. Riprova tra poco."
    });

  return true;
}


/* ============================================================
   LOCK DISTRIBUITO
   ============================================================ */

function redisLockKey(
  key,
  tenantId
) {

  return (
    tenantLockPrefix(tenantId) +
    norm(key)
      .replace(/\s+/g, "-")
  );
}

async function acquireDistributedLock(
  key,
  tenantId
) {

  const lockKey =
    redisLockKey(key, tenantId);

  const token =
    `${Date.now()}-${crypto.randomUUID()}`;

  const result =
    await redisSetNX(
      lockKey,
      token,
      LOCK_TTL
    );

  return {
    acquired:
      String(result).toUpperCase() ===
      "OK",
    lockKey,
    token
  };
}

async function releaseDistributedLock(
  lock
) {

  if (
    !lock ||
    !lock.lockKey
  ) {
    return;
  }

  try {
    await redisCommand(
      "EVAL",
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      "1",
      lock.lockKey,
      lock.token
    );
  } catch {
    /* nessun errore bloccante */
  }
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

  const key =
    dayKey(date);

  const raw =
    obj(hours[key])
      ? hours[key]
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
                p?.from ||
                p?.start ||
                p?.pauseStart
              ),
            to:
              clean(
                p?.to ||
                p?.end ||
                p?.pauseEnd
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
    clean(raw.breakEnd) &&
    mins(raw.breakStart) !== null &&
    mins(raw.breakEnd) !== null &&
    mins(raw.breakStart) <
    mins(raw.breakEnd)
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

  const target =
    norm(name);

  if (!target) {
    return null;
  }

  return (

    services.find(
      s =>
        norm(s?.name) ===
        target
    ) ||

    services.find(
      s => {

        const n =
          norm(s?.name);

        return (
          n &&
          (
            target.includes(n) ||
            n.includes(target)
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

  const pauseConflict =
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
    );

  if (
    pauseConflict
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
        apDate(a) !==
        date
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
      ),

    recoveryContactedAt:
      clean(client.recoveryContactedAt)
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
        norm(c?.name) === n
    ) ||

    clients.find(
      c =>
        p &&
        clean(c?.phone) === p
    ) ||

    clients.find(
      c =>
        p &&
        clean(c?.whatsapp) === p
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
      phone ||
      whatsapp
    );

  if (existing) {

    const normalized =
      normalizeClient(
        existing
      );

    return {

      ...normalized,

      name:
        clean(name) ||
        normalized.name,

      phone:
        clean(phone) ||
        normalized.phone,

      whatsapp:
        clean(whatsapp) ||
        normalized.whatsapp,

      email:
        clean(email) ||
        normalized.email,

      notes:
        clean(notes) ||
        normalized.notes
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
    obj(data?.business)
      ? data.business
      : {};

  const settings =
    obj(data?.settings)
      ? data.settings
      : {};

  return {

    ok: true,

    mode: "client",

    local: true,

    engine:
      "maviri-business-engine-v5",

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
      arr(data?.services),

    promotions:
      arr(data?.promotions),

    appointments: []
  };
}


/* ============================================================
   DATASET
   ============================================================ */

function normalizeSettings(
  input
) {
  const settings =
    obj(input)
      ? { ...input }
      : {};

  if (
    Array.isArray(settings.hours)
  ) {
    const keys = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday"
    ];

    settings.hours =
      Object.fromEntries(
        keys.map(
          (key, index) => [
            key,
            obj(settings.hours[index])
              ? settings.hours[index]
              : { closed: true }
          ]
        )
      );
  }

  return settings;
}

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
      normalizeSettings(
        body.settings
      ),

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

async function getServerData(
  dataKey
) {

  const data =
    await redisGet(
      dataKey
    );

  if (
    !obj(data)
  ) {
    return null;
  }

  return data;
}


/* ============================================================
   MERGE SICURO DATI
   ============================================================ */

/*
 * Importantissimo:
 *
 * L'app del titolare invia il proprio dataset.
 * Nel frattempo Mavi cliente/WhatsApp potrebbe aver
 * creato un appuntamento sul server.
 *
 * Non dobbiamo quindi cancellare gli elementi
 * presenti sul server ma non ancora presenti
 * nell'HTML del titolare.
 */

function mergeClients(
  local,
  server
) {

  const result = [];
  const byId = new Map();

  for (
    const c of arr(server)
  ) {

    const normalized =
      normalizeClient(c);

    if (!normalized) {
      continue;
    }

    byId.set(
      String(normalized.id),
      normalized
    );

    result.push(
      normalized
    );
  }

  for (
    const c of arr(local)
  ) {

    const normalized =
      normalizeClient(c);

    if (!normalized) {
      continue;
    }

    const id =
      String(normalized.id);

    if (
      byId.has(id)
    ) {

      const old =
        byId.get(id);

      const merged = {

        ...old,

        ...normalized,

        name:
          normalized.name ||
          old.name,

        phone:
          normalized.phone ||
          old.phone,

        whatsapp:
          normalized.whatsapp ||
          old.whatsapp,

        email:
          normalized.email ||
          old.email,

        notes:
          normalized.notes ||
          old.notes
      };

      const index =
        result.findIndex(
          x =>
            String(x.id) === id
        );

      if (
        index >= 0
      ) {
        result[index] =
          merged;
      }

      byId.set(
        id,
        merged
      );

    } else {

      result.push(
        normalized
      );

      byId.set(
        id,
        normalized
      );
    }
  }

  return result;
}

function mergeAppointments(
  local,
  server
) {

  const result = [];
  const byId = new Map();

  /*
   * Server first.
   */

  for (
    const a of arr(server)
  ) {

    if (!a?.id) {
      continue;
    }

    const id =
      String(a.id);

    byId.set(
      id,
      a
    );

    result.push(
      a
    );
  }

  /*
   * Local dataset:
   * se esiste già sul server viene
   * mantenuto il record locale più
   * recente quando ha updatedAt.
   */

  for (
    const a of arr(local)
  ) {

    if (!a?.id) {
      continue;
    }

    const id =
      String(a.id);

    if (
      !byId.has(id)
    ) {

      result.push(a);
      byId.set(id, a);

      continue;
    }

    const existing =
      byId.get(id);

    const existingTime =
      Date.parse(
        existing.updatedAt ||
        existing.createdAt ||
        ""
      ) || 0;

    const localTime =
      Date.parse(
        a.updatedAt ||
        a.createdAt ||
        ""
      ) || 0;

    if (
      localTime > existingTime
    ) {

      const index =
        result.findIndex(
          x =>
            String(x.id) === id
        );

      if (
        index >= 0
      ) {
        result[index] = a;
      }

      byId.set(
        id,
        a
      );
    }
  }

  return result;
}

function mergeOwnerData(
  local,
  server
) {

  if (
    !server
  ) {
    return sanitizeOwnerData(
      local
    );
  }

  const incoming =
    sanitizeOwnerData(
      local
    );

  return {

    ...server,

    version:
      incoming.version ||
      server.version ||
      1,

    business:
      incoming.business &&
      Object.keys(
        incoming.business
      ).length
        ? incoming.business
        : server.business,

    settings:
      incoming.settings &&
      Object.keys(
        incoming.settings
      ).length
        ? incoming.settings
        : server.settings,

    /* Servizi e promozioni sono liste gestite dal titolare.
     * Anche un array vuoto è una scelta valida (eliminazione
     * dell'ultimo elemento) e deve quindi sostituire il server. */
    services:
      incoming.services,

    promotions:
      incoming.promotions,

    clients:
      mergeClients(
        incoming.clients,
        server.clients
      ),

    appointments:
      mergeAppointments(
        incoming.appointments,
        server.appointments
      ),

    revision:
      Math.max(
        Number(
          incoming.revision || 0
        ),
        Number(
          server.revision || 0
        )
      ),

    updatedAt:
      new Date().toISOString()
  };
}


/* ============================================================
   RISPOSTE MAVIRI
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
    return (
      "Non risultano servizi configurati."
    );
  }

  return services
    .map(
      s =>
        `${clean(s.name)} — ` +
        `${Number(s.price || 0).toFixed(2)} € — ` +
        `${duration(s)} minuti`
    )
    .join("\n");
}

function promotionList(
  promotions
) {

  const activePromos =
    promotions.filter(
      p =>
        p.active !== false &&
        p.enabled !== false
    );

  if (
    !activePromos.length
  ) {
    return (
      "Non risultano promozioni attive."
    );
  }

  return activePromos
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
   RICONOSCIMENTO
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
        norm(s?.name) &&
        n.includes(
          norm(s.name)
        )
    ) ||
    null
  );
}

function addDaysISO(
  isoDate,
  amount
) {

  const d =
    new Date(
      `${isoDate}T12:00:00`
    );

  d.setDate(
    d.getDate() + amount
  );

  return (
    d.toISOString()
      .slice(0, 10)
  );
}

function detectDate(
  text
) {

  const n =
    norm(text);

  const today =
    todayRome();

  if (
    /\boggi\b/.test(n)
  ) {
    return today;
  }

  if (
    /\bdomani\b/.test(n)
  ) {
    return addDaysISO(
      today,
      1
    );
  }

  if (
    /\bdopodomani\b/.test(n)
  ) {
    return addDaysISO(
      today,
      2
    );
  }

  const match =
    n.match(
      /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/
    );

  if (match) {

    let year =
      match[3]
        ? Number(match[3])
        : Number(
            today.slice(0, 4)
          );

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

    const result =
      `${year}-${month}-${day}`;

    return validDate(result)
      ? result
      : null;
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

  const base =
    new Date(
      `${today}T12:00:00`
    );

  for (
    const [name, index]
    of Object.entries(
      weekdays
    )
  ) {

    if (
      n.includes(name)
    ) {

      const current =
        base.getDay();

      let delta =
        index - current;

      if (
        delta <= 0
      ) {
        delta += 7;
      }

      const d =
        new Date(base);

      d.setDate(
        d.getDate() +
        delta
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

function detectExplicitConfirmation(
  text
) {

  return /^(si|sì|yes|confermo|confermata|confermato|va bene|ok|okay|perfetto|procedi|prenota|prenotala|prenotalo)\b/i
    .test(
      clean(text)
    );
}

function detectCancellation(
  text
) {

  return /annulla|cancella|disdici|disdire/i
    .test(
      clean(text)
    );
}


/* ============================================================
   CHAT LOCALE
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
    /^(ciao|salve|buongiorno|buonasera|buon giorno|hey|ehi)\b/
      .test(text)
  ) {

    return {
      answer:
        `Ciao. Sono Mavi, l'assistente di ${name}. Posso aiutarti con servizi, prezzi, promozioni, orari, disponibilità e prenotazioni.`,

      booking: null
    };
  }


  /*
   * SERVIZI
   */

  if (
    /servizi|trattamenti|cosa fate|cosa offrite|prestazioni/
      .test(text)
  ) {

    return {

      answer:
        `Questi sono i servizi disponibili:\n\n` +
        serviceList(services),

      booking: null
    };
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

      return {

        answer:
          `${service.name} costa ` +
          `${Number(service.price || 0).toFixed(2)} €. ` +
          `La durata prevista è di ${duration(service)} minuti.`,

        booking: null
      };
    }

    return {

      answer:
        `Posso indicarti i prezzi dei servizi:\n\n` +
        serviceList(services),

      booking: null
    };
  }


  /*
   * PROMOZIONI
   */

  if (
    /promo|promozione|promozioni|offerta|offerte|sconto|sconti/
      .test(text)
  ) {

    return {

      answer:
        `Le promozioni disponibili sono:\n\n` +
        promotionList(promotions),

      booking: null
    };
  }


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
   * ORARI
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

      return {

        answer:
          `Per il ${dateForHours} ${name} è chiuso.`,

        booking: null
      };
    }

    let answer =
      `${name} è aperto dalle ${h.open} alle ${h.close}.`;

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

    return {
      answer,
      booking: null
    };
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

    return {

      answer:
        parts.length
          ? parts.join("\n")
          : "I dati di contatto non sono ancora configurati.",

      booking: null
    };
  }


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

      return {

        answer:
          `Per ${service.name} il ${date} non risultano orari disponibili. Posso verificare un altro giorno.`,

        booking: null
      };
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

        return {

          answer:
            `Sì, ${time} è disponibile per ${service.name} il ${date}. Se vuoi prenotarlo, indicami il tuo nome.`,

          booking: {

            status:
              "pending",

            date,
            time,

            service:
              service.name
          }
        };
      }

      return {

        answer:
          `Alle ${time} non è disponibile. Gli orari disponibili sono: ${slots.join(", ")}.`,

        booking: null
      };
    }

    return {

      answer:
        `Per ${service.name} il ${date} gli orari disponibili sono: ${slots.join(", ")}.`,

      booking: null
    };
  }


  /*
   * PRENOTAZIONE SENZA DATI
   */

  if (
    /prenot|appuntamento|voglio venire|vorrei venire|posso venire/
      .test(text)
  ) {

    if (!service) {

      return {

        answer:
          "Certo. Quale servizio vuoi prenotare?",

        booking: {
          status:
            "collecting-service"
        }
      };
    }

    if (!date) {

      return {

        answer:
          `Per ${service.name}, quale giorno preferisci?`,

        booking: {
          status:
            "collecting-date",

          service:
            service.name
        }
      };
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

      return {

        answer:
          `Per ${service.name} il ${date} non ci sono orari disponibili.`,

        booking: null
      };
    }

    if (!time) {

      return {

        answer:
          `Per ${service.name} il ${date} sono disponibili: ${slots.join(", ")}. Quale orario preferisci?`,

        booking: {
          status:
            "collecting-time",

          date,

          service:
            service.name
        }
      };
    }

    return {

      answer:
        `L'orario ${time} è disponibile. Per procedere indicami il tuo nome.`,

      booking: {
        status:
          "collecting-name",

        date,
        time,

        service:
          service.name
      }
    };
  }


  /*
   * CONFERMA ESPLICITA
   *
   * La conferma definitiva viene comunque
   * controllata dall'endpoint BOOK.
   */

  if (
    detectExplicitConfirmation(
      text
    )
  ) {

    return {

      answer:
        "Perfetto. Per completare la prenotazione ho bisogno dei dati dell'appuntamento già concordati.",

      booking: {
        status:
          "confirmation-required"
      }
    };
  }


  /*
   * FALLBACK
   */

  return {

    answer:
      "Posso aiutarti con servizi, prezzi, promozioni, orari, disponibilità e prenotazioni. Dimmi cosa ti serve.",

    booking: null
  };
}


/* ============================================================
   CREAZIONE APPUNTAMENTO
   ============================================================ */

function createAppointment({
  id,
  client,
  date,
  time,
  service,
  notes,
  source,
  mode
}) {

  return {

    id,

    clientId:
      client.id,

    name:
      client.name,

    phone:
      client.phone,

    whatsapp:
      client.whatsapp,

    email:
      client.email,

    date,

    time,

    service:
      service.name,

    duration:
      duration(service),

    status:
      "confirmed",

    notes:
      clean(notes),

    createdAt:
      new Date().toISOString(),

    source:
      source ||
      (
        mode === "client"
          ? "mavi-client"
          : "mavi-owner"
      )
  };
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

    const declaredLength =
      Number(req.headers["content-length"] || 0);

    const actualLength =
      Buffer.byteLength(JSON.stringify(body));

    if (
      declaredLength > MAX_BODY_BYTES ||
      actualLength > MAX_BODY_BYTES
    ) {
      return res
        .status(413)
        .json({
          ok: false,
          error: "Richiesta troppo grande."
        });
    }

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

    const requestedTenant =
      explicitTenantId(req, body);

    if (
      requestedTenant &&
      !isValidTenantId(requestedTenant)
    ) {
      return res
        .status(400)
        .json({
          ok: false,
          error: "Identificativo attività non valido."
        });
    }

    const tenantId =
      resolveTenantId(req, body);

    const DATA_KEY =
      tenantDataKey(tenantId);

    const PUBLIC_KEY =
      tenantPublicKey(tenantId);

    if (
      mode === "owner" &&
      OWNER_PROTECTED_ACTIONS.has(action) &&
      !ownerAuthorized(req, tenantId)
    ) {
      return res
        .status(401)
        .json({
          ok: false,
          error: "Autenticazione proprietario richiesta."
        });
    }

    const isPublicRequest =
      mode === "client" ||
      action === "public-context";

    if (
      isPublicRequest &&
      await enforceRateLimit({
        req,
        res,
        tenantId,
        action
      })
    ) {
      return;
    }


    /* ========================================================
       OWNER SYNC
       ======================================================== */

    if (
      action === "owner-sync"
    ) {

      if (
        !ownerAuthorized(req, tenantId)
      ) {

        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Token proprietario non valido."
          });
      }

      if (
        !redisConfigured()
      ) {

        return res
          .status(503)
          .json({
            ok: false,
            error:
              "Upstash Redis non configurato."
          });
      }

      const incoming =
        sanitizeOwnerData(
          body
        );

      const server =
        await getServerData(DATA_KEY);

      /*
       * MERGE:
       * non cancelliamo prenotazioni
       * create da Mavi cliente/WhatsApp.
       */

      const merged =
        mergeOwnerData(
          incoming,
          server
        );

      await redisSet(
        DATA_KEY,
        merged
      );

      await redisSet(
        PUBLIC_KEY,
        makePublicContext(
          merged
        )
      );

      return res
        .status(200)
        .json({

          ok: true,

          synced: true,

          revision:
            merged.revision,

          updatedAt:
            merged.updatedAt,

          /*
           * Restituito anche il dataset
           * aggiornato: il nuovo index potrà
           * utilizzarlo per sincronizzare
           * immediatamente il calendario.
           */

          data:
            merged,

          message:
            "Dati Maviri sincronizzati."
        });
    }


    /* ========================================================
       OWNER PULL
       ======================================================== */

    if (
      action === "owner-pull"
    ) {

      if (
        !ownerAuthorized(req, tenantId)
      ) {

        return res
          .status(401)
          .json({
            ok: false,
            error:
              "Token proprietario non valido."
          });
      }

      if (
        !redisConfigured()
      ) {

        return res
          .status(503)
          .json({
            ok: false,
            error:
              "Upstash Redis non configurato."
          });
      }

      const data =
        await getServerData(DATA_KEY);

      if (
        !data
      ) {

        return res
          .status(404)
          .json({
            ok: false,
            error:
              "Nessun dato Maviri presente sul server."
          });
      }

      return res
        .status(200)
        .json({

          ok: true,

          data,

          revision:
            Number(
              data.revision || 0
            ),

          updatedAt:
            data.updatedAt || null
        });
    }


    /* ========================================================
       PUBLIC CONTEXT
       ======================================================== */

    if (
      action === "public-context"
    ) {

      if (
        !redisConfigured()
      ) {

        return res
          .status(503)
          .json({
            ok: false,
            error:
              "Mavi cliente non è ancora configurata."
          });
      }

      let context =
        await redisGet(
          PUBLIC_KEY
        );

      /*
       * Se il public context manca ma
       * esiste il dataset proprietario,
       * lo ricostruiamo automaticamente.
       */

      if (
        !context
      ) {

        const data =
          await getServerData(DATA_KEY);

        if (
          data
        ) {

          context =
            makePublicContext(
              data
            );

          await redisSet(
            PUBLIC_KEY,
            context
          );
        }
      }

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
          await redisGet(
            PUBLIC_KEY
          );

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
            "maviri-business-engine-v5",

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
          await getServerData(DATA_KEY);

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

      const result =
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
            "maviri-business-engine-v5",

          answer:
            result.answer,

          booking:
            result.booking || null
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
          await getServerData(DATA_KEY);

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

        data =
          sanitizeOwnerData(
            body
          );
      }

      const date =
        clean(body.date);

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

          appointments,

          settings:
            data.settings,

          services
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
          await getServerData(DATA_KEY);

        if (
          !data
        ) {

          return res
            .status(503)
            .json({
              ok: false,
              bookingConfirmed:
                false,
              error:
                "Dati dell'attività non disponibili."
            });
        }

      } else {

        data =
          sanitizeOwnerData(
            body
          );
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

      if (
        !freeSlot({
          date,
          time,
          service,
          appointments,
          settings: data.settings,
          services
        })
      ) {
        return res
          .status(409)
          .json({
            ok: false,
            bookingConfirmed: false,
            error: "Orario non disponibile.",
            availableSlots: availableSlots({
              date,
              service,
              appointments,
              settings: data.settings,
              services
            })
          });
      }


      /*
       * CONFERMA OBBLIGATORIA
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

              name,

              phone,

              whatsapp
            },

            message:
              `Confermi la prenotazione di ${service.name} per ${name} il ${date} alle ${time}?`
          });
      }


      /*
       * LOCK DISTRIBUITO REDIS
       */

      const key =
        [
          date,
          time,
          norm(service.name)
        ].join("|");

      const lock =
        await acquireDistributedLock(
          key,
          tenantId
        );

      if (
        !lock.acquired
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
         * SECONDO CONTROLLO SERVER-SIDE
         *
         * Per modalità cliente ricarichiamo
         * nuovamente il dataset dal server,
         * così il controllo usa l'ultima versione.
         */

        if (
          mode === "client"
        ) {

          const fresh =
            await getServerData(DATA_KEY);

          if (
            fresh
          ) {
            data = fresh;
          }
        }

        const freshServices =
          arr(data.services);

        const freshAppointments =
          arr(data.appointments);

        const freshClients =
          arr(data.clients);

        const freshService =
          findService(
            freshServices,
            body.service ||
            body.serviceName ||
            service.name
          );

        if (
          !freshService
        ) {

          return res
            .status(400)
            .json({

              ok: false,

              bookingConfirmed:
                false,

              error:
                "Servizio non più disponibile."
            });
        }

        if (
          !freeSlot({

            date,

            time,

            service:
              freshService,

            appointments:
              freshAppointments,

            settings:
              data.settings,

            services:
              freshServices
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

                  service:
                    freshService,

                  appointments:
                    freshAppointments,

                  settings:
                    data.settings,

                  services:
                    freshServices
                })
            });
        }


        /*
         * CLIENTE
         */

        const client =
          clientFromBooking({

            clients:
              freshClients,

            name,

            phone,

            whatsapp,

            email,

            notes
          });


        /*
         * ID UNIVOCO
         */

        const id =
          clean(body.id) ||
          `${date}|${time}|${crypto.randomUUID()}`;


        /*
         * APPUNTAMENTO
         */

        const appointment =
          createAppointment({

            id,

            client,

            date,

            time,

            service:
              freshService,

            notes,

            source:
              body.source ||
              (
                mode === "client"
                  ? "mavi-client"
                  : "mavi-owner"
              ),

            mode
          });


        /*
         * CLIENTE
         */

        const nextClients =
          [...freshClients];

        const existingClientIndex =
          nextClients.findIndex(
            c =>
              String(c.id) ===
              String(client.id)
          );

        if (
          existingClientIndex >= 0
        ) {

          nextClients[
            existingClientIndex
          ] = client;

        } else {

          nextClients.push(
            client
          );
        }


        /*
         * APPUNTAMENTI
         */

        const nextAppointments =
          [...freshAppointments];

        /*
         * Evita doppio inserimento
         * dello stesso ID.
         */

        const duplicate =
          nextAppointments.find(
            a =>
              String(a.id) ===
              String(appointment.id)
          );

        if (
          !duplicate
        ) {

          nextAppointments.push(
            appointment
          );
        }


        /*
         * MODALITÀ CLIENTE:
         * scrittura immediata sul database
         */

        if (
          mode === "client" ||
          body.persist === true ||
          body.source === "whatsapp"
        ) {

          const nextData = {

            ...data,

            clients:
              nextClients,

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

            bookingConfirmed:
              true,

            persisted:
              mode === "client" ||
              body.persist === true ||
              body.source === "whatsapp",

            appointment,

            client,

            message:
              "Prenotazione confermata e registrata."
          });

      } finally {

        await releaseDistributedLock(
          lock
        );
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
          await getServerData(DATA_KEY);

      } else {

        data =
          sanitizeOwnerData(
            body
          );
      }

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

      const old =
        appointments.find(
          a =>
            String(a.id) ===
            String(id)
        );

      if (
        !old
      ) {
        return res
          .status(404)
          .json({
            ok: false,
            error: "Appuntamento non trovato."
          });
      }

      if (
        mode === "client" &&
        !clientOwnsAppointment(old, body)
      ) {
        return res
          .status(403)
          .json({
            ok: false,
            error: "Verifica cliente non riuscita."
          });
      }

      const lockKey =
        [
          date,
          time,
          norm(service.name)
        ].join("|");

      const lock =
        await acquireDistributedLock(
          lockKey,
          tenantId
        );

      if (
        !lock.acquired
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

            ignoreId:
              id
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

          ...old,

          id,

          name,

          phone:
            clean(
              body.phone
            ) ||
            old.phone ||
            "",

          whatsapp:
            clean(
              body.whatsapp
            ) ||
            old.whatsapp ||
            "",

          email:
            clean(
              body.email
            ) ||
            old.email ||
            "",

          date,

          time,

          service:
            service.name,

          duration:
            duration(service),

          status:
            clean(body.status) ||
            old.status ||
            "confirmed",

          notes:
            clean(body.notes),

          updatedAt:
            new Date().toISOString()
        };


        const nextAppointments =
          appointments.map(
            a =>
              String(a.id) ===
              String(id)
                ? updated
                : a
          );


        if (
          mode === "client"
        ) {

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

            persisted:
              mode === "client",

            message:
              "Appuntamento modificato."
          });

      } finally {

        await releaseDistributedLock(
          lock
        );
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
          await getServerData(DATA_KEY);

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

        const appointment =
          arr(
            data.appointments
          ).find(
            a =>
              String(a.id) ===
              String(id)
          );

        if (
          !appointment
        ) {

          return res
            .status(404)
            .json({

              ok: false,

              error:
                "Appuntamento non trovato."
            });
        }

        if (
          !clientOwnsAppointment(appointment, body)
        ) {
          return res
            .status(403)
            .json({
              ok: false,
              error: "Verifica cliente non riuscita."
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
                      new Date().toISOString(),

                    updatedAt:
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

          persisted:
            mode === "client",

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
       WHATSAPP MESSAGE
       ========================================================
       Endpoint interno predisposto per il futuro
       webhook WhatsApp.

       Il provider WhatsApp dovrà trasformare
       il messaggio ricevuto in:

       {
         action: "whatsapp-message",
         from: "...",
         message: "..."
       }

       Mavi risponde usando esclusivamente
       il motore locale.
       ======================================================== */

    if (
      action === "whatsapp-message"
    ) {

      const from =
        clean(
          body.from ||
          body.phone ||
          body.whatsapp
        );

      const message =
        clean(
          body.message ||
          body.text
        );

      if (
        !from ||
        !message
      ) {

        return res
          .status(400)
          .json({

            ok: false,

            error:
              "Mittente o messaggio WhatsApp mancanti."
          });
      }


      const data =
        await getServerData(DATA_KEY);

      if (
        !data
      ) {

        return res
          .status(503)
          .json({

            ok: false,

            error:
              "Mavi non è ancora collegata ai dati dell'attività."
          });
      }


      const client =
        findClient(
          arr(data.clients),
          "",
          from
        );


      const result =
        await localChat({

          message,

          history:
            Array.isArray(
              body.history
            )
              ? body.history
              : [],

          mode:
            "client",

          data
        });


      /*
       * Non vengono esposti:
       * - clienti
       * - appuntamenti privati
       * - note interne
       * - dati del titolare
       */

      return res
        .status(200)
        .json({

          ok: true,

          channel:
            "whatsapp",

          from,

          knownClient:
            !!client,

          answer:
            result.answer,

          booking:
            result.booking || null,

          engine:
            "maviri-business-engine-v5"
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
