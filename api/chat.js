/* ============================================================
 * MAVIRI — BUSINESS ENGINE
 * Mavi Core indipendente
 *
 * Copyright © 2026 Maviri / SimyTech.
 * Proprietary software. All rights reserved.
 *
 * NESSUNA DIPENDENZA OPENAI
 *
 * API compatibili con:
 *   /api/chat
 *
 * Azioni:
 *   owner-sync
 *   public-context
 *   context
 *   availability
 *   book
 *   update
 *   cancel
 *   client
 *   chat
 *
 * Variabili Vercel:
 *
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 *   MAVIRI_OWNER_SYNC_TOKEN
 *
 * ============================================================ */

"use strict";


/* ============================================================
   CONFIGURAZIONE
   ============================================================ */

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || "";

const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || "";

const OWNER_TOKEN =
  process.env.MAVIRI_OWNER_SYNC_TOKEN || "";

const LOCK_TTL = 15;

const SESSION_TTL = 60 * 60;

const DATA_TTL = 60 * 60 * 24 * 365;

const PUBLIC_CONTEXT_KEY =
  "maviri:public-context";

const OWNER_DATA_KEY =
  "maviri:owner-data";


/* ============================================================
   UTILITÀ
   ============================================================ */

const clean = value =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .trim();


const norm = value =>
  clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");


const obj = value =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value);


const arr = value =>
  Array.isArray(value)
    ? value.filter(obj)
    : [];


const validDate = value =>
  /^\d{4}-\d{2}-\d{2}$/.test(
    clean(value)
  );


function mins(value) {

  let s =
    clean(value)
      .replace(/[.,]/g, ":");

  if (
    /^\d{1,2}$/.test(s)
  ) {
    s += ":00";
  }

  const match =
    s.match(
      /^(\d{1,2}):(\d{2})$/
    );

  if (!match) {
    return null;
  }

  const h =
    Number(match[1]);

  const m =
    Number(match[2]);

  if (
    h < 0 ||
    h > 23 ||
    m < 0 ||
    m > 59
  ) {
    return null;
  }

  return h * 60 + m;
}


function fmt(value) {

  return (
    String(
      Math.floor(value / 60)
    ).padStart(2, "0") +
    ":" +
    String(
      value % 60
    ).padStart(2, "0")
  );
}


function randomId(prefix = "") {

  try {

    return (
      prefix +
      crypto.randomUUID()
    );

  } catch {

    return (
      prefix +
      Date.now() +
      "-" +
      Math.random()
        .toString(36)
        .slice(2)
    );
  }
}


function todayRome() {

  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "Europe/Rome",

      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit"
    }
  ).format(
    new Date()
  );
}


function dayKey(date) {

  const d =
    new Date(
      `${date}T12:00:00`
    );

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


function active(appointment) {

  return ![
    "cancelled",
    "canceled",
    "annullato",
    "cancellato",
    "deleted"
  ].includes(
    norm(
      appointment?.status ||
      "confirmed"
    )
  );
}


function apDate(a) {

  return clean(
    a?.date ||
    a?.d
  );
}


function apTime(a) {

  return clean(
    a?.time ||
    a?.t
  );
}


function apService(a) {

  return clean(
    a?.service ||
    a?.s
  );
}


/* ============================================================
   REDIS
   ============================================================ */

async function redis(command) {

  if (
    !REDIS_URL ||
    !REDIS_TOKEN
  ) {

    throw new Error(
      "Redis Maviri non configurato."
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
          JSON.stringify(command)
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
    result &&
    result.error
  ) {

    throw new Error(
      result.error
    );
  }


  return result.result;
}


async function redisGet(key) {

  return redis([
    "GET",
    key
  ]);
}


async function redisSet(
  key,
  value,
  ttl = DATA_TTL
) {

  return redis([
    "SET",
    key,
    JSON.stringify(value),
    "EX",
    ttl
  ]);
}


async function redisDelete(key) {

  return redis([
    "DEL",
    key
  ]);
}


/* ============================================================
   LOCK DISTRIBUITO
   ============================================================ */

async function acquireDistributedLock(
  key
) {

  const result =
    await redis([
      "SET",

      `maviri:lock:${key}`,

      String(
        Date.now()
      ),

      "NX",

      "EX",

      LOCK_TTL
    ]);


  return result === "OK";
}


async function releaseDistributedLock(
  key
) {

  try {

    await redisDelete(
      `maviri:lock:${key}`
    );

  } catch {

    /*
     * Il lock scade comunque automaticamente.
     */
  }
}


/* ============================================================
   DATI SERVER
   ============================================================ */

async function loadOwnerData() {

  const raw =
    await redisGet(
      OWNER_DATA_KEY
    );


  if (!raw) {
    return null;
  }


  if (
    typeof raw === "string"
  ) {

    try {

      return JSON.parse(raw);

    } catch {

      throw new Error(
        "Dati Maviri server non validi."
      );
    }
  }


  return raw;
}


async function saveOwnerData(
  data
) {

  return redisSet(
    OWNER_DATA_KEY,
    data
  );
}


async function loadPublicContext() {

  const raw =
    await redisGet(
      PUBLIC_CONTEXT_KEY
    );


  if (!raw) {
    return null;
  }


  if (
    typeof raw === "string"
  ) {

    try {

      return JSON.parse(raw);

    } catch {

      throw new Error(
        "Contesto pubblico Maviri non valido."
      );
    }
  }


  return raw;
}


/* ============================================================
   AUTORIZZAZIONE TITOLARE
   ============================================================ */

function ownerTokenFromRequest(
  req,
  body
) {

  return clean(
    req.headers?.["x-maviri-owner-token"] ||
    req.headers?.["X-Maviri-Owner-Token"] ||
    body?.ownerToken ||
    ""
  );
}


function isOwnerAuthorized(
  req,
  body
) {

  if (!OWNER_TOKEN) {
    return false;
  }

  return (
    ownerTokenFromRequest(
      req,
      body
    ) === OWNER_TOKEN
  );
}


function requireOwner(
  req,
  body
) {

  if (!OWNER_TOKEN) {

    throw new Error(
      "MAVIRI_OWNER_SYNC_TOKEN non configurato."
    );
  }


  if (
    !isOwnerAuthorized(
      req,
      body
    )
  ) {

    const error =
      new Error(
        "Accesso proprietario non autorizzato."
      );

    error.status = 401;

    throw error;
  }
}


/* ============================================================
   DATI PUBBLICI
   ============================================================ */

function buildPublicContext(
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

    mode:
      "client",

    local:
      true,

    assistant:
      "Mavi",

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
      arr(
        data?.services
      ).map(
        service => ({

          id:
            clean(service.id),

          name:
            clean(service.name),

          price:
            service.price ??
            null,

          duration:
            Number(
              service.duration
            ) || 30,

          category:
            clean(
              service.category
            ),

          description:
            clean(
              service.description
            )
        })
      ),

    promotions:
      arr(
        data?.promotions
      ).map(
        promotion => ({

          id:
            clean(promotion.id),

          title:
            clean(
              promotion.title ||
              promotion.name
            ),

          description:
            clean(
              promotion.description
            ),

          valid:
            clean(
              promotion.valid
            )
        })
      ),

    hours:
      data?.settings?.hours ||
      data?.business?.hours ||
      [],

    /*
     * NON vengono pubblicati:
     *
     * clients
     * notes interne
     * email private
     * storico clienti
     * dati proprietari
     */

    appointments:
      []
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
      service =>
        norm(
          service.name
        ) === target
    ) ||

    services.find(
      service => {

        const current =
          norm(
            service.name
          );

        return (
          current &&
          (
            target.includes(
              current
            ) ||
            current.includes(
              target
            )
          )
        );
      }
    ) ||

    null
  );
}


function serviceDuration(
  service
) {

  const value =
    Number(
      service?.duration
    );


  return (
    Number.isFinite(value) &&
    value > 0
  )
    ? Math.round(value)
    : 30;
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


  /*
   * Supporta anche il formato array
   * usato dall'attuale index.html.
   */

  if (
    Array.isArray(
      settings?.hours
    )
  ) {

    const wanted =
      dayKey(date);


    const found =
      settings.hours.find(
        item =>
          norm(
            item?.day ||
            item?.key ||
            item?.name
          ) ===
          norm(wanted)
      );


    if (found) {

      return normalizeHourObject(
        found
      );
    }
  }


  const key =
    dayKey(date);


  const raw =
    obj(hours[key])
      ? hours[key]
      : null;


  if (!raw) {
    return null;
  }


  return normalizeHourObject(
    raw
  );
}


function normalizeHourObject(
  raw
) {

  const pauses =
    Array.isArray(
      raw?.pauses
    )

      ? raw.pauses
          .map(
            pause => ({

              from:
                clean(
                  pause.from ||
                  pause.start ||
                  pause.pauseStart
                ),

              to:
                clean(
                  pause.to ||
                  pause.end ||
                  pause.pauseEnd
                )
            })
          )
          .filter(
            pause =>
              mins(
                pause.from
              ) !== null &&
              mins(
                pause.to
              ) !== null
          )

      : [];


  if (
    clean(raw?.breakStart) &&
    clean(raw?.breakEnd)
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
      raw?.closed === true ||
      raw?.open === false ||
      raw?.status === "closed" ||
      raw?.status === "chiuso",


    open:
      clean(
        raw?.open ||
        raw?.start ||
        raw?.from
      ),


    close:
      clean(
        raw?.close ||
        raw?.end ||
        raw?.to
      ),


    pauses
  };
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
    serviceDuration(
      service
    );


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


  const inPause =
    day.pauses.some(
      pause => {

        const ps =
          mins(
            pause.from
          );

        const pe =
          mins(
            pause.to
          );


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


  if (inPause) {
    return false;
  }


  return !appointments.some(
    appointment => {

      if (
        !active(
          appointment
        )
      ) {
        return false;
      }


      if (
        String(
          appointment.id
        ) ===
        String(ignoreId)
      ) {
        return false;
      }


      if (
        apDate(
          appointment
        ) !== date
      ) {
        return false;
      }


      const existingStart =
        mins(
          apTime(
            appointment
          )
        );


      if (
        existingStart === null
      ) {
        return false;
      }


      const existingService =
        findService(
          services,
          apService(
            appointment
          )
        );


      const existingDuration =
        serviceDuration(
          existingService
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


  if (
    open === null ||
    close === null
  ) {
    return [];
  }


  const step = 30;

  const slots = [];


  for (
    let time =
      Math.ceil(
        open / step
      ) * step;

    time +
      serviceDuration(
        service
      ) <=
      close;

    time += step
  ) {

    const value =
      fmt(time);


    if (
      freeSlot({

        date,

        time:
          value,

        service,

        appointments,

        settings,

        services
      })
    ) {

      slots.push(
        value
      );
    }
  }


  return slots;
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
      clean(
        client.id
      ) ||
      randomId(
        "client-"
      ),

    name:
      clean(
        client.name
      ),

    phone:
      clean(
        client.phone
      ),

    whatsapp:
      clean(
        client.whatsapp ||
        client.phone
      ),

    email:
      clean(
        client.email
      ),

    notes:
      clean(
        client.notes
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
      client =>
        n &&
        norm(
          client.name
        ) === n
    ) ||

    clients.find(
      client =>
        p &&
        clean(
          client.phone
        ) === p
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
      randomId(
        "client-"
      ),

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
   SINCRONIZZAZIONE PROPRIETARIO
   ============================================================ */

async function handleOwnerSync(
  req,
  body
) {

  requireOwner(
    req,
    body
  );


  const data = {

    version:
      Number(
        body.version
      ) || 8,

    revision:
      Number(
        body.revision
      ) || 0,

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

    clients:
      arr(body.clients),

    promotions:
      arr(body.promotions),

    appointments:
      arr(body.appointments)
  };


  await saveOwnerData(
    data
  );


  const publicContext =
    buildPublicContext(
      data
    );


  await redisSet(
    PUBLIC_CONTEXT_KEY,
    publicContext
  );


  return {

    ok: true,

    synced:
      true,

    revision:
      data.revision,

    updatedAt:
      data.updatedAt,

    message:
      "Dati Maviri sincronizzati con Mavi cliente."
  };
}


/* ============================================================
   PUBLIC CONTEXT
   ============================================================ */

async function handlePublicContext() {

  const context =
    await loadPublicContext();


  if (!context) {

    const error =
      new Error(
        "Mavi cliente non è ancora configurata."
      );

    error.status = 404;

    throw error;
  }


  return context;
}


/* ============================================================
   CONTEXT TITOLARE
   ============================================================ */

async function handleOwnerContext(
  req,
  body
) {

  requireOwner(
    req,
    body
  );


  const data =
    await loadOwnerData();


  if (!data) {

    const error =
      new Error(
        "Dati Maviri non ancora sincronizzati."
      );

    error.status = 404;

    throw error;
  }


  return {

    ok: true,

    mode:
      "owner",

    local:
      true,

    assistant:
      "Mavi",

    today:
      todayRome(),

    business:
      data.business,

    settings:
      data.settings,

    services:
      data.services,

    clients:
      data.clients,

    promotions:
      data.promotions,

    appointments:
      data.appointments
        .filter(active)
  };
}


/* ============================================================
   AVAILABILITY
   ============================================================ */

async function handleAvailability(
  req,
  body
) {

  const mode =
    clean(
      body.mode ||
      "owner"
    );


  let data;


  if (
    mode === "client"
  ) {

    data =
      await loadOwnerData();

  } else {

    requireOwner(
      req,
      body
    );

    data =
      await loadOwnerData();
  }


  if (!data) {

    const error =
      new Error(
        "Dati Maviri non disponibili."
      );

    error.status = 404;

    throw error;
  }


  const date =
    clean(
      body.date
    );


  const service =
    findService(
      arr(data.services),
      body.service ||
      body.serviceName
    );


  if (
    !validDate(date)
  ) {

    const error =
      new Error(
        "Data non valida."
      );

    error.status = 400;

    throw error;
  }


  if (!service) {

    const error =
      new Error(
        "Servizio non trovato."
      );

    error.status = 400;

    throw error;
  }


  const requestedTime =
    clean(
      body.time
    );


  if (
    requestedTime
  ) {

    const available =
      freeSlot({

        date,

        time:
          requestedTime,

        service,

        appointments:
          arr(
            data.appointments
          ),

        settings:
          data.settings,

        services:
          arr(
            data.services
          )
      });


    return {

      ok: true,

      available,

      date,

      time:
        requestedTime,

      service:
        service.name,

      duration:
        serviceDuration(
          service
        )
    };
  }


  const slots =
    availableSlots({

      date,

      service,

      appointments:
        arr(
          data.appointments
        ),

      settings:
        data.settings,

      services:
        arr(
          data.services
        )
    });


  return {

    ok: true,

    available:
      slots.length > 0,

    date,

    service:
      service.name,

    duration:
      serviceDuration(
        service
      ),

    slots,

    availableSlots:
      slots
  };
}


/* ============================================================
   SESSIONI MAVIRI
   ============================================================ */

function sessionKey(
  sessionId
) {

  return (
    "maviri:session:" +
    clean(
      sessionId
    )
  );
}


async function loadSession(
  sessionId
) {

  if (!sessionId) {
    return {};
  }


  const raw =
    await redisGet(
      sessionKey(
        sessionId
      )
    );


  if (!raw) {
    return {};
  }


  if (
    typeof raw === "string"
  ) {

    try {

      return JSON.parse(
        raw
      );

    } catch {

      return {};
    }
  }


  return raw;
}


async function saveSession(
  sessionId,
  session
) {

  if (!sessionId) {
    return;
  }


  await redisSet(
    sessionKey(
      sessionId
    ),

    session,

    SESSION_TTL
  );
}


/* ============================================================
   PARSING DATE
   ============================================================ */

function isoFromDate(
  date
) {

  return (
    date instanceof Date
      ? date
      : new Date(date)
  );
}


function addDays(
  date,
  days
) {

  const d =
    isoFromDate(
      date
    );


  d.setDate(
    d.getDate() +
    days
  );


  return (
    d.toISOString()
      .slice(0, 10)
  );
}


function dateFromText(
  text
) {

  const q =
    norm(text);


  const today =
    todayRome();


  if (
    q.includes("oggi")
  ) {

    return today;
  }


  if (
    q.includes("domani")
  ) {

    return addDays(
      today,
      1
    );
  }


  if (
    q.includes(
      "dopodomani"
    )
  ) {

    return addDays(
      today,
      2
    );
  }


  const match =
    q.match(
      /(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{4}))?/
    );


  if (match) {

    const day =
      Number(
        match[1]
      );

    const month =
      Number(
        match[2]
      );

    const year =
      Number(
        match[3] ||
        today.slice(0, 4)
      );


    const value =
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;


    if (
      validDate(value)
    ) {

      return value;
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
    const [name, day]
    of Object.entries(
      weekdays
    )
  ) {

    if (
      q.includes(name)
    ) {

      const base =
        new Date(
          `${today}T12:00:00`
        );


      const current =
        base.getDay();


      let delta =
        day - current;


      if (
        delta <= 0
      ) {
        delta += 7;
      }


      return addDays(
        base,
        delta
      );
    }
  }


  return null;
}


/* ============================================================
   PARSING ORARIO
   ============================================================ */

function timeFromText(
  text
) {

  const match =
    clean(text)
      .match(
        /\b([01]?\d|2[0-3])(?:[:.](\d{2}))?\b/
      );


  if (!match) {
    return null;
  }


  const hour =
    Number(
      match[1]
    );


  const minute =
    Number(
      match[2] || "00"
    );


  return fmt(
    hour * 60 +
    minute
  );
}


/* ============================================================
   PARSING CONFERMA
   ============================================================ */

function isConfirmation(
  text
) {

  const q =
    norm(text);


  return [
    "si",
    "sì",
    "ok",
    "va bene",
    "confermo",
    "conferma",
    "procedi",
    "prenota",
    "prenotala",
    "prenotalo",
    "esatto",
    "certo"
  ].some(
    value =>
      q === value ||
      q.startsWith(
        value + " "
      )
  );
}


function isCancellation(
  text
) {

  const q =
    norm(text);


  return [
    "no",
    "annulla",
    "cancella",
    "lascia stare",
    "non prenotare",
    "non confermo"
  ].some(
    value =>
      q === value ||
      q.includes(value)
  );
}


/* ============================================================
   SERVIZIO DA TESTO
   ============================================================ */

function detectService(
  text,
  services
) {

  const q =
    norm(text);


  for (
    const service
    of services
  ) {

    const name =
      norm(
        service.name
      );


    if (
      name &&
      (
        q.includes(name) ||
        name
          .split(" ")
          .some(
            word =>
              word.length >= 4 &&
              q.includes(word)
          )
      )
    ) {

      return service;
    }
  }


  return null;
}


/* ============================================================
   CLIENTE DA TESTO
   ============================================================ */

function detectClientName(
  text
) {

  const patterns = [

    /(?:nome è|nome e|mi chiamo)\s+([a-zà-ÿ' ]{2,80})/i,

    /(?:per|cliente)\s+([a-zà-ÿ' ]{2,80})/i
  ];


  for (
    const pattern
    of patterns
  ) {

    const match =
      clean(text)
        .match(
          pattern
        );


    if (match) {

      return clean(
        match[1]
      );
    }
  }


  return null;
}


/* ============================================================
   FORMATTAZIONE INFORMAZIONI
   ============================================================ */

function formatServices(
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
      service => {

        let text =
          service.name;


        if (
          service.price !==
          undefined &&
          service.price !==
          null &&
          service.price !== ""
        ) {

          text +=
            ` — €${service.price}`;
        }


        if (
          service.duration
        ) {

          text +=
            ` — ${service.duration} min`;
        }


        return text;
      }
    )
    .join("\n");
}


function formatPromotions(
  promotions
) {

  if (
    !promotions.length
  ) {

    return (
      "Al momento non risultano promozioni attive."
    );
  }


  return promotions
    .map(
      promotion => {

        let text =
          promotion.title ||
          promotion.name ||
          "Promozione";


        if (
          promotion.description
        ) {

          text +=
            ` — ${promotion.description}`;
        }


        if (
          promotion.valid
        ) {

          text +=
            ` (${promotion.valid})`;
        }


        return text;
      }
    )
    .join("\n");
}


/* ============================================================
   RISPOSTA ORARI
   ============================================================ */

function formatHours(
  settings
) {

  const hours =
    settings?.hours;


  if (
    !hours
  ) {

    return (
      "Gli orari non sono ancora configurati."
    );
  }


  const days = [

    ["monday", "Lunedì"],
    ["tuesday", "Martedì"],
    ["wednesday", "Mercoledì"],
    ["thursday", "Giovedì"],
    ["friday", "Venerdì"],
    ["saturday", "Sabato"],
    ["sunday", "Domenica"]
  ];


  const result = [];


  for (
    const [key, label]
    of days
  ) {

    let day;


    if (
      Array.isArray(hours)
    ) {

      day =
        hours.find(
          item =>
            norm(
              item.day ||
              item.name
            ) ===
            norm(key)
        );

    } else {

      day =
        hours[key];
    }


    if (!day) {
      continue;
    }


    const normalized =
      normalizeHourObject(
        day
      );


    if (
      normalized.closed
    ) {

      result.push(
        `${label}: chiuso`
      );

      continue;
    }


    let line =
      `${label}: ${normalized.open || "—"}–${normalized.close || "—"}`;


    if (
      normalized.pauses.length
    ) {

      line +=
        " · pause " +
        normalized.pauses
          .map(
            pause =>
              `${pause.from}–${pause.to}`
          )
          .join(", ");
    }


    result.push(
      line
    );
  }


  return result.length
    ? result.join("\n")
    : "Gli orari non sono ancora configurati.";
}


/* ============================================================
   PRENOTAZIONE
   ============================================================ */

function bookingLockKey(
  date,
  time,
  service
) {

  return [
    date,
    time,
    norm(
      service?.name ||
      service
    )
  ].join("|");
}


async function createBooking({
  data,
  body,
  mode,
  sessionId
}) {

  const date =
    clean(
      body.date
    );


  const time =
    clean(
      body.time
    );


  const name =
    clean(
      body.name ||
      body.clientName
    );


  const phone =
    clean(
      body.phone
    );


  const whatsapp =
    clean(
      body.whatsapp ||
      phone
    );


  const email =
    clean(
      body.email
    );


  const notes =
    clean(
      body.notes
    );


  const service =
    findService(
      arr(data.services),
      body.service ||
      body.serviceName
    );


  if (
    !validDate(date) ||
    mins(time) === null ||
    !name ||
    !service
  ) {

    const error =
      new Error(
        "Nome, data, ora e servizio sono obbligatori."
      );

    error.status = 400;

    throw error;
  }


  /*
   * CONFERMA OBBLIGATORIA.
   *
   * Il client HTML non deve poter
   * prenotare senza una conferma esplicita.
   */

  if (
    body.confirmed !== true
  ) {

    const draft = {

      date,

      time,

      name,

      phone,

      whatsapp,

      email,

      service:
        service.name,

      price:
        service.price ??
        null,

      duration:
        serviceDuration(
          service
        ),

      notes
    };


    if (sessionId) {

      const session =
        await loadSession(
          sessionId
        );


      session.pendingBooking =
        draft;


      await saveSession(
        sessionId,
        session
      );
    }


    return {

      ok: true,

      requiresConfirmation:
        true,

      booking: {

        status:
          "pending",

        appointment:
          draft
      },

      appointment:
        draft,

      answer:
        `Ho verificato la disponibilità. Posso prenotare ${service.name} per ${name} il ${date} alle ${time}. Confermi la prenotazione?`
    };
  }


  /*
   * LOCK DISTRIBUITO
   */

  const lock =
    bookingLockKey(
      date,
      time,
      service
    );


  const acquired =
    await acquireDistributedLock(
      lock
    );


  if (!acquired) {

    const error =
      new Error(
        "Questo orario è già in fase di prenotazione. Riprova tra qualche secondo."
      );

    error.status = 409;

    throw error;
  }


  try {

    /*
     * SECONDA LETTURA SERVER.
     */

    const fresh =
      await loadOwnerData();


    if (!fresh) {

      const error =
        new Error(
          "Dati Maviri non disponibili."
        );

      error.status = 404;

      throw error;
    }


    const freshService =
      findService(
        arr(fresh.services),
        service.name
      );


    if (!freshService) {

      const error =
        new Error(
          "Il servizio non è più disponibile."
        );

      error.status = 409;

      throw error;
    }


    const appointments =
      arr(
        fresh.appointments
      );


    /*
     * SECONDO CONTROLLO.
     */

    const available =
      freeSlot({

        date,

        time,

        service:
          freshService,

        appointments,

        settings:
          fresh.settings,

        services:
          arr(
            fresh.services
          )
      });


    if (!available) {

      return {

        ok: false,

        booking: {

          status:
            "unavailable"
        },

        availableSlots:
          availableSlots({

            date,

            service:
              freshService,

            appointments,

            settings:
              fresh.settings,

            services:
              arr(
                fresh.services
              )
          }),

        answer:
          "L'orario non è più disponibile."
      };
    }


    /*
     * CLIENTE
     */

    if (
      !Array.isArray(
        fresh.clients
      )
    ) {

      fresh.clients = [];
    }


    const client =
      clientFromBooking({

        clients:
          fresh.clients,

        name,

        phone,

        whatsapp,

        email,

        notes
      });


    const existingClient =
      fresh.clients.find(
        current =>
          String(
            current.id
          ) ===
          String(
            client.id
          )
      );


    if (!existingClient) {

      fresh.clients.push(
        client
      );

    } else {

      Object.assign(
        existingClient,
        client
      );
    }


    /*
     * APPUNTAMENTO
     */

    const appointment = {

      id:
        randomId(
          "ap-"
        ),

      clientId:
        client.id,

      name,

      phone,

      whatsapp,

      email,

      date,

      time,

      service:
        freshService.name,

      duration:
        serviceDuration(
          freshService
        ),

      price:
        freshService.price ??
        null,

      status:
        "confirmed",

      notes,

      source:
        mode === "client"
          ? "mavi-client"
          : "mavi-owner",

      createdAt:
        new Date().toISOString()
    };


    fresh.appointments.push(
      appointment
    );


    /*
     * SALVATAGGIO CONDIVISO.
     */

    await saveOwnerData(
      fresh
    );


    /*
     * Aggiorniamo anche il contesto pubblico.
     * Gli appuntamenti NON vengono pubblicati.
     */

    await redisSet(
      PUBLIC_CONTEXT_KEY,
      buildPublicContext(
        fresh
      )
    );


    if (sessionId) {

      const session =
        await loadSession(
          sessionId
        );


      delete session.pendingBooking;


      await saveSession(
        sessionId,
        session
      );
    }


    return {

      ok: true,

      booking: {

        status:
          "confirmed",

        appointment
      },

      appointment,

      client,

      answer:
        `Prenotazione confermata per ${name}: ${service.name}, ${date} alle ${time}.`
    };

  } finally {

    await releaseDistributedLock(
      lock
    );
  }
}


/* ============================================================
   MODIFICA APPUNTAMENTO
   ============================================================ */

async function updateBooking(
  req,
  body
) {

  requireOwner(
    req,
    body
  );


  const data =
    await loadOwnerData();


  if (!data) {

    const error =
      new Error(
        "Dati Maviri non disponibili."
      );

    error.status = 404;

    throw error;
  }


  const id =
    clean(
      body.id
    );


  const date =
    clean(
      body.date
    );


  const time =
    clean(
      body.time
    );


  const name =
    clean(
      body.name ||
      body.clientName
    );


  const service =
    findService(
      arr(data.services),
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

    const error =
      new Error(
        "Dati modifica appuntamento incompleti."
      );

    error.status = 400;

    throw error;
  }


  const appointments =
    arr(
      data.appointments
    );


  const index =
    appointments.findIndex(
      appointment =>
        String(
          appointment.id
        ) ===
        String(id)
    );


  if (
    index < 0
  ) {

    const error =
      new Error(
        "Appuntamento non trovato."
      );

    error.status = 404;

    throw error;
  }


  const lock =
    bookingLockKey(
      date,
      time,
      service
    );


  const acquired =
    await acquireDistributedLock(
      lock
    );


  if (!acquired) {

    const error =
      new Error(
        "Modifica già in elaborazione."
      );

    error.status = 409;

    throw error;
  }


  try {

    const available =
      freeSlot({

        date,

        time,

        service,

        appointments,

        settings:
          data.settings,

        services:
          arr(
            data.services
          ),

        ignoreId:
          id
      });


    if (!available) {

      return {

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

            services:
              arr(
                data.services
              )
          })
      };
    }


    const current =
      appointments[index];


    const updated = {

      ...current,

      id,

      name,

      phone:
        clean(
          body.phone ||
          current.phone
        ),

      whatsapp:
        clean(
          body.whatsapp ||
          current.whatsapp
        ),

      email:
        clean(
          body.email ||
          current.email
        ),

      date,

      time,

      service:
        service.name,

      duration:
        serviceDuration(
          service
        ),

      price:
        service.price ??
        null,

      status:
        "confirmed",

      updatedAt:
        new Date().toISOString()
    };


    data.appointments[index] =
      updated;


    await saveOwnerData(
      data
    );


    await redisSet(
      PUBLIC_CONTEXT_KEY,
      buildPublicContext(
        data
      )
    );


    return {

      ok: true,

      appointment:
        updated,

      answer:
        "Appuntamento modificato correttamente."
    };

  } finally {

    await releaseDistributedLock(
      lock
    );
  }
}


/* ============================================================
   CANCELLAZIONE
   ============================================================ */

async function cancelBooking(
  req,
  body,
  mode
) {

  /*
   * Il cliente può chiedere la cancellazione
   * solo se conosce l'id generato dalla sessione.
   *
   * Per sicurezza, la cancellazione dal pannello
   * titolare richiede sempre il token.
   */

  if (
    mode !== "client"
  ) {

    requireOwner(
      req,
      body
    );
  }


  const data =
    await loadOwnerData();


  if (!data) {

    const error =
      new Error(
        "Dati Maviri non disponibili."
      );

    error.status = 404;

    throw error;
  }


  const id =
    clean(
      body.id
    );


  if (!id) {

    const error =
      new Error(
        "ID appuntamento mancante."
      );

    error.status = 400;

    throw error;
  }


  const appointment =
    arr(
      data.appointments
    ).find(
      current =>
        String(
          current.id
        ) ===
        String(id)
    );


  if (!appointment) {

    const error =
      new Error(
        "Appuntamento non trovato."
      );

    error.status = 404;

    throw error;
  }


  appointment.status =
    "cancelled";


  appointment.cancelledAt =
    new Date().toISOString();


  await saveOwnerData(
    data
  );


  await redisSet(
    PUBLIC_CONTEXT_KEY,
    buildPublicContext(
      data
    )
  );


  return {

    ok: true,

    cancelled:
      true,

    appointment,

    status:
      "cancelled",

    answer:
      "Appuntamento annullato."
  };
}


/* ============================================================
   CLIENT LOOKUP
   ============================================================ */

async function handleClient(
  req,
  body
) {

  requireOwner(
    req,
    body
  );


  const data =
    await loadOwnerData();


  if (!data) {

    const error =
      new Error(
        "Dati Maviri non disponibili."
      );

    error.status = 404;

    throw error;
  }


  const client =
    findClient(
      arr(
        data.clients
      ),

      clean(
        body.name
      ),

      clean(
        body.phone
      )
    );


  if (!client) {

    return {

      ok: false,

      client:
        null,

      appointments:
        [],

      error:
        "Cliente non trovato."
    };
  }


  const appointments =
    arr(
      data.appointments
    )
      .filter(
        appointment => {

          if (
            String(
              appointment.clientId
            ) ===
            String(
              client.id
            )
          ) {

            return true;
          }


          return (
            norm(
              appointment.name
            ) ===
            norm(
              client.name
            )
          );
        }
      )
      .sort(
        (a, b) =>
          (
            apDate(a) +
            apTime(a)
          ).localeCompare(
            apDate(b) +
            apTime(b)
          )
      );


  return {

    ok: true,

    client,

    appointments
  };
}


/* ============================================================
   MAVI — MOTORE LOCALE
   ============================================================ */

async function localMavi({
  text,
  mode,
  data,
  sessionId
}) {

  const q =
    norm(text);


  const session =
    await loadSession(
      sessionId
    );


  /*
   * ==========================================================
   * CONFERMA DI UNA PRENOTAZIONE PENDENTE
   * ==========================================================
   */

  if (
    session.pendingBooking &&
    isConfirmation(text)
  ) {

    const pending =
      session.pendingBooking;


    return createBooking({

      data,

      body: {

        ...pending,

        confirmed:
          true
      },

      mode,

      sessionId
    });
  }


  if (
    session.pendingBooking &&
    isCancellation(text)
  ) {

    delete session.pendingBooking;


    await saveSession(
      sessionId,
      session
    );


    return {

      ok: true,

      answer:
        "Va bene, non effettuo la prenotazione."
    };
  }


  /*
   * ==========================================================
   * SERVIZI
   * ==========================================================
   */

  if (
    /servizi|servizio|prezzi|prezzo|costi|costo|quanto costa|quanto viene/
      .test(q)
  ) {

    return {

      ok: true,

      answer:
        formatServices(
          arr(
            data.services
          )
        )
    };
  }


  /*
   * ==========================================================
   * PROMOZIONI
   * ==========================================================
   */

  if (
    /promo|promozion|offert|scont/
      .test(q)
  ) {

    return {

      ok: true,

      answer:
        formatPromotions(
          arr(
            data.promotions
          )
        )
    };
  }


  /*
   * ==========================================================
   * ORARI
   * ==========================================================
   */

  if (
    /orari|apert|chius|pause|pausa/
      .test(q)
  ) {

    return {

      ok: true,

      answer:
        formatHours(
          data.settings
        )
    };
  }


  /*
   * ==========================================================
   * DISPONIBILITÀ
   * ==========================================================
   */

  const detectedDate =
    dateFromText(
      text
    );


  const detectedTime =
    timeFromText(
      text
    );


  const detectedService =
    detectService(
      text,
      arr(
        data.services
      )
    );


  /*
   * Esempio:
   *
   * "Vorrei taglio uomo lunedì"
   *
   * Mavi cerca data + servizio.
   */

  if (
    detectedDate &&
    detectedService &&
    !detectedTime
  ) {

    const slots =
      availableSlots({

        date:
          detectedDate,

        service:
          detectedService,

        appointments:
          arr(
            data.appointments
          ),

        settings:
          data.settings,

        services:
          arr(
            data.services
          )
      });


    if (!slots.length) {

      return {

        ok: true,

        answer:
          `Non trovo disponibilità per ${detectedService.name} il ${detectedDate}.`
      };
    }


    return {

      ok: true,

      answer:
        `Per ${detectedService.name} il ${detectedDate} sono disponibili questi orari: ${slots.join(", ")}.`
    };
  }


  /*
   * ==========================================================
   * RICHIESTA PRENOTAZIONE COMPLETA
   * ==========================================================
   */

  if (
    detectedDate &&
    detectedTime &&
    detectedService
  ) {

    const clientName =
      detectClientName(
        text
      );


    /*
     * Per il cliente pubblico,
     * il nome può essere chiesto.
     */

    if (
      mode === "client" &&
      !clientName
    ) {

      const sessionData =
        await loadSession(
          sessionId
        );


      sessionData.bookingDraft = {

        date:
          detectedDate,

        time:
          detectedTime,

        service:
          detectedService.name
      };


      await saveSession(
        sessionId,
        sessionData
      );


      return {

        ok: true,

        answer:
          `L'orario ${detectedTime} per ${detectedService.name} è stato verificato. Come posso indicare il tuo nome?`
      };
    }


    const name =
      clientName ||
      (
        mode === "owner"
          ? "Cliente"
          : ""
      );


    if (
      mode === "client" &&
      !name
    ) {

      return {

        ok: true,

        answer:
          "Mi serve il tuo nome per preparare la prenotazione."
      };
    }


    return createBooking({

      data,

      body: {

        date:
          detectedDate,

        time:
          detectedTime,

        service:
          detectedService.name,

        name
      },

      mode,

      sessionId
    });
  }


  /*
   * ==========================================================
   * CONTINUAZIONE DI UN BOOKING
   * ==========================================================
   */

  if (
    session.bookingDraft
  ) {

    const draft =
      session.bookingDraft;


    if (
      detectedTime
    ) {

      draft.time =
        detectedTime;
    }


    if (
      detectedDate
    ) {

      draft.date =
        detectedDate;
    }


    if (
      detectedService
    ) {

      draft.service =
        detectedService.name;
    }


    const name =
      detectClientName(
        text
      );


    if (name) {
      draft.name = name;
    }


    if (
      draft.date &&
      draft.time &&
      draft.service &&
      draft.name
    ) {

      delete session.bookingDraft;


      await saveSession(
        sessionId,
        session
      );


      return createBooking({

        data,

        body: draft,

        mode,

        sessionId
      });
    }


    await saveSession(
      sessionId,
      session
    );
  }


  /*
   * ==========================================================
   * APPUNTAMENTI TITOLARE
   * ==========================================================
   */

  if (
    mode === "owner" &&
    /appuntament|prenotazion|agenda|calendario|oggi/
      .test(q)
  ) {

    const date =
      detectedDate ||
      todayRome();


    const list =
      arr(
        data.appointments
      )
        .filter(
          appointment =>
            active(
              appointment
            ) &&
            apDate(
              appointment
            ) === date
        )
        .sort(
          (a, b) =>
            apTime(a)
              .localeCompare(
                apTime(b)
              )
        );


    if (!list.length) {

      return {

        ok: true,

        answer:
          `Non risultano appuntamenti per ${date}.`
      };
    }


    return {

      ok: true,

      answer:
        list
          .map(
            appointment =>
              `${appointment.time} — ${appointment.name} — ${appointment.service}`
          )
          .join("\n")
    };
  }


  /*
   * ==========================================================
   * CLIENTI TITOLARE
   * ==========================================================
   */

  if (
    mode === "owner" &&
    /clienti|cliente|scheda cliente/
      .test(q)
  ) {

    const count =
      arr(
        data.clients
      ).length;


    return {

      ok: true,

      answer:
        `In Maviri risultano ${count} clienti.`
    };
  }


  /*
   * ==========================================================
   * CANCELLAZIONE CONVERSAZIONALE
   * ==========================================================
   */

  if (
    /annulla prenotazion|cancella prenotazion|annullare appuntamento|cancellare appuntamento/
      .test(q)
  ) {

    return {

      ok: true,

      answer:
        "Per annullare un appuntamento ho bisogno dell'identificativo dell'appuntamento."
    };
  }


  /*
   * ==========================================================
   * SALUTO
   * ==========================================================
   */

  if (
    /^(ciao|salve|buongiorno|buonasera|hey|hello)$/
      .test(q)
  ) {

    return {

      ok: true,

      answer:
        mode === "client"
          ? "Ciao, sono Mavi. Posso aiutarti con servizi, prezzi, orari e prenotazioni."
          : "Ciao. Sono Mavi. Posso consultare appuntamenti, clienti, servizi, orari e promozioni."
    };
  }


  /*
   * ==========================================================
   * RISPOSTA GENERALE
   * ==========================================================
   */

  if (
    mode === "client"
  ) {

    return {

      ok: true,

      answer:
        "Sono Mavi. Posso aiutarti con servizi, prezzi, promozioni, orari, disponibilità e prenotazioni."
    };
  }


  return {

    ok: true,

    answer:
      "Sono Mavi, l'assistente interno di Maviri. Posso consultare appuntamenti, clienti, servizi, promozioni, orari e disponibilità."
  };
}


/* ============================================================
   CHAT
   ============================================================ */

async function handleChat(
  req,
  body
) {

  const mode =
    clean(
      body.mode ||
      body.role ||
      "owner"
    ) === "client"
      ? "client"
      : "owner";


  let data;


  /*
   * MAVI CLIENTE
   *
   * Il client pubblico non manda il token.
   * Il server recupera i dati condivisi.
   */

  if (
    mode === "client"
  ) {

    data =
      await loadOwnerData();


    if (!data) {

      const public =
        await loadPublicContext();


      if (!public) {

        const error =
          new Error(
            "Mavi cliente non è ancora configurata."
          );

        error.status = 404;

        throw error;
      }


      /*
       * Se per qualsiasi motivo il dataset
       * proprietario non fosse disponibile,
       * usiamo il contesto pubblico per le
       * informazioni non operative.
       */

      data = {

        business:
          public.business,

        settings: {

          hours:
            public.hours
        },

        services:
          public.services,

        promotions:
          public.promotions,

        clients: [],

        appointments: []
      };
    }

  } else {

    /*
     * MAVI TITOLARE
     *
     * Il token è obbligatorio.
     */

    requireOwner(
      req,
      body
    );


    data =
      await loadOwnerData();


    if (!data) {

      const error =
        new Error(
          "Prima sincronizza i dati di Maviri."
        );

      error.status = 404;

      throw error;
    }
  }


  const sessionId =
    clean(
      body.sessionId ||
      body.conversationId
    );


  const text =
    clean(
      body.message ||
      body.text
    );


  if (!text) {

    const error =
      new Error(
        "Messaggio vuoto."
      );

    error.status = 400;

    throw error;
  }


  const result =
    await localMavi({

      text,

      mode,

      data,

      sessionId
    });


  return {

    ...result,

    ok:
      result.ok !== false,

    assistant:
      "Mavi",

    mode
  };
}


/* ============================================================
   ROUTER
   ============================================================ */

async function route(
  req,
  body
) {

  const action =
    clean(
      body.action
    ).toLowerCase();


  /*
   * OWNER SYNC
   */

  if (
    action ===
    "owner-sync"
  ) {

    return handleOwnerSync(
      req,
      body
    );
  }


  /*
   * PUBLIC CONTEXT
   */

  if (
    action ===
    "public-context"
  ) {

    return handlePublicContext();
  }


  /*
   * PRIVATE CONTEXT
   */

  if (
    action ===
    "context"
  ) {

    if (
      clean(
        body.mode
      ) ===
      "client"
    ) {

      return handlePublicContext();
    }


    return handleOwnerContext(
      req,
      body
    );
  }


  /*
   * AVAILABILITY
   */

  if (
    action ===
    "availability"
  ) {

    return handleAvailability(
      req,
      body
    );
  }


  /*
   * BOOK
   */

  if (
    action ===
    "book"
  ) {

    const mode =
      clean(
        body.mode ||
        "owner"
      ) === "client"
        ? "client"
        : "owner";


    /*
     * Il titolare può prenotare
     * direttamente dal pannello.
     *
     * Il cliente usa invece il dataset
     * server-side senza conoscere il token.
     */

    if (
      mode !== "client"
    ) {

      requireOwner(
        req,
        body
      );
    }


    const data =
      await loadOwnerData();


    if (!data) {

      const error =
        new Error(
          "Dati Maviri non disponibili."
        );

      error.status = 404;

      throw error;
    }


    return createBooking({

      data,

      body,

      mode,

      sessionId:
        clean(
          body.sessionId ||
          body.conversationId
        )
    });
  }


  /*
   * UPDATE
   */

  if (
    action ===
    "update"
  ) {

    return updateBooking(
      req,
      body
    );
  }


  /*
   * CANCEL
   */

  if (
    action ===
    "cancel"
  ) {

    const mode =
      clean(
        body.mode ||
        "owner"
      );


    return cancelBooking(
      req,
      body,
      mode
    );
  }


  /*
   * CLIENT
   */

  if (
    action ===
    "client"
  ) {

    return handleClient(
      req,
      body
    );
  }


  /*
   * CHAT
   */

  if (
    action ===
    "chat"
  ) {

    return handleChat(
      req,
      body
    );
  }


  const error =
    new Error(
      "Azione API non riconosciuta."
    );

  error.status = 400;

  throw error;
}


/* ============================================================
   VERCEL HANDLER
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


  if (
    req.method !==
    "POST"
  ) {

    return res.status(405).json({

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


    const result =
      await route(
        req,
        body
      );


    const status =
      result?.ok === false
        ? 400
        : 200;


    return res.status(
      status
    ).json(
      result
    );

  } catch (error) {

    console.error(
      "MAVIRI API ERROR:",
      error
    );


    const status =
      Number(
        error?.status
      ) || 500;


    return res.status(
      status
    ).json({

      ok: false,

      error:
        status === 500
          ? "Errore interno del servizio Maviri."
          : clean(
              error.message
            )
    });
  }
}
