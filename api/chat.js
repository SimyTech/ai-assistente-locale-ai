/* MAVIRI — BUSINESS ENGINE
 * Copyright © 2026 Maviri / SimyTech.
 * Proprietary software. All rights reserved.
 */

const LOCK_TTL = 15000;

const locks = globalThis.__maviriLocks || new Map();
globalThis.__maviriLocks = locks;

const clean = v =>
  String(v ?? '')
    .replace(/\u0000/g, '')
    .trim();

const norm = v =>
  clean(v)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');

const obj = v =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const arr = v =>
  Array.isArray(v) ? v.filter(obj) : [];

const mins = v => {
  let s = clean(v).replace(/[.,]/g, ':');

  if (/^\d{1,2}$/.test(s)) {
    s += ':00';
  }

  const m = s.match(/^(\d{1,2}):(\d{2})$/);

  if (!m) return null;

  const h = +m[1];
  const n = +m[2];

  return h >= 0 && h < 24 && n >= 0 && n < 60
    ? h * 60 + n
    : null;
};

const fmt = n =>
  String(Math.floor(n / 60)).padStart(2, '0') +
  ':' +
  String(n % 60).padStart(2, '0');

const validDate = d =>
  /^\d{4}-\d{2}-\d{2}$/.test(clean(d));

const todayRome = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());

const dayKey = d =>
  [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday'
  ][new Date(`${d}T12:00:00`).getDay()];

const active = a =>
  ![
    'cancelled',
    'canceled',
    'annullato',
    'cancellato',
    'deleted'
  ].includes(norm(a.status || 'confirmed'));

const apDate = a =>
  clean(a.date || a.d);

const apTime = a =>
  clean(a.time || a.t);

const apService = a =>
  clean(a.service || a.s);


/* ============================================================
   ORARI
   ============================================================ */

function getHours(settings, date) {

  const hours =
    obj(settings?.hours)
      ? settings.hours
      : {};

  const k = dayKey(date);

  const raw =
    obj(hours[k])
      ? hours[k]
      : null;

  if (!raw) return null;

  const pauses =
    Array.isArray(raw.pauses)
      ? raw.pauses
          .map(p => ({
            from: clean(
              p.from ||
              p.start ||
              p.pauseStart
            ),
            to: clean(
              p.to ||
              p.end ||
              p.pauseEnd
            )
          }))
          .filter(
            p =>
              mins(p.from) !== null &&
              mins(p.to) !== null
          )
      : [];

  /*
   * Compatibilità con il vecchio formato
   * breakStart / breakEnd
   */

  if (
    clean(raw.breakStart) &&
    clean(raw.breakEnd)
  ) {
    pauses.push({
      from: clean(raw.breakStart),
      to: clean(raw.breakEnd)
    });
  }

  return {
    closed:
      raw.closed === true ||
      raw.open === false ||
      raw.status === 'closed' ||
      raw.status === 'chiuso',

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

function findService(services, name) {

  const t = norm(name);

  if (!t) return null;

  return (
    services.find(
      s => norm(s.name) === t
    ) ||

    services.find(s => {
      const n = norm(s.name);

      return (
        n &&
        (
          t.includes(n) ||
          n.includes(t)
        )
      );
    }) ||

    null
  );
}

function duration(service) {

  const n =
    Number(service?.duration);

  return Number.isFinite(n) && n > 0
    ? Math.round(n)
    : 30;
}


/* ============================================================
   CONTROLLO DISPONIBILITÀ
   ============================================================ */

function freeSlot({
  date,
  time,
  service,
  appointments,
  settings,
  services,
  ignoreId = ''
}) {

  if (!validDate(date)) {
    return false;
  }

  const day =
    getHours(settings, date);

  if (!day || day.closed) {
    return false;
  }

  const start = mins(time);
  const open = mins(day.open);
  const close = mins(day.close);
  const dur = duration(service);

  if (
    start === null ||
    open === null ||
    close === null
  ) {
    return false;
  }

  const end = start + dur;

  /*
   * Fuori dall'orario di apertura
   */

  if (
    start < open ||
    end > close
  ) {
    return false;
  }

  /*
   * Controllo pause
   */

  if (
    day.pauses.some(p => {

      const pauseStart =
        mins(p.from);

      const pauseEnd =
        mins(p.to);

      if (
        pauseStart === null ||
        pauseEnd === null
      ) {
        return false;
      }

      return (
        start < pauseEnd &&
        end > pauseStart
      );
    })
  ) {
    return false;
  }

  /*
   * Controllo sovrapposizione appuntamenti
   */

  return !appointments.some(a => {

    if (!active(a)) {
      return false;
    }

    /*
     * Quando modifichiamo un appuntamento,
     * ignoriamo il suo stesso ID.
     */

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
      mins(apTime(a));

    if (existingStart === null) {
      return false;
    }

    const existingService =
      findService(
        services,
        apService(a)
      );

    const existingEnd =
      existingStart +
      duration(existingService);

    /*
     * Due intervalli si sovrappongono
     * se:
     *
     * start < existingEnd
     * &&
     * end > existingStart
     */

    return (
      start < existingEnd &&
      end > existingStart
    );
  });
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
    getHours(settings, date);

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

  /*
   * Slot ogni 30 minuti.
   */

  const step = 30;

  if (
    open === null ||
    close === null
  ) {
    return [];
  }

  const out = [];

  for (
    let t =
      Math.ceil(open / step) * step;

    t + duration(service) <= close;

    t += step
  ) {

    if (
      freeSlot({
        date,
        time: fmt(t),
        service,
        appointments,
        settings,
        services
      })
    ) {
      out.push(
        fmt(t)
      );
    }
  }

  return out;
}


/* ============================================================
   BOOKING LOCK
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
  ].join('|');
}

function acquire(key) {

  const now =
    Date.now();

  /*
   * Pulizia automatica dei lock
   * scaduti.
   */

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

  /*
   * Se esiste già un lock,
   * rifiutiamo la richiesta.
   */

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

function release(key) {
  locks.delete(key);
}


/* ============================================================
   API
   ============================================================ */

export default async function handler(
  req,
  res
) {

  res.setHeader(
    'Cache-Control',
    'no-store'
  );

  res.setHeader(
    'X-Content-Type-Options',
    'nosniff'
  );

  res.setHeader(
    'X-Frame-Options',
    'DENY'
  );

  /*
   * Accettiamo solamente POST.
   */

  if (
    req.method !== 'POST'
  ) {

    return res.status(405).json({
      ok: false,
      error: 'Metodo non consentito.'
    });
  }

  try {

    const body =
      obj(req.body)
        ? req.body
        : {};

    const action =
      clean(body.action);

    const settings =
      obj(body.settings)
        ? body.settings
        : {};

    const services =
      arr(body.services);

    const appointments =
      arr(body.appointments);

    const clients =
      arr(body.clients);

    const promotions =
      arr(body.promotions);


    /* ========================================================
       CONTEXT
       ======================================================== */

    if (
      action === 'context'
    ) {

      return res.status(200).json({

        ok: true,

        local: true,

        engine:
          'maviri-business-engine-v2',

        today:
          todayRome(),

        business:
          settings.name ||
          body.business ||
          '',

        services,

        clients,

        promotions,

        appointments:
          appointments.filter(active)
      });
    }


    /* ========================================================
       AVAILABILITY
       ======================================================== */

    if (
      action === 'availability'
    ) {

      const date =
        clean(body.date);

      const service =
        findService(
          services,
          body.service ||
          body.serviceName
        );

      if (
        !validDate(date)
      ) {

        return res.status(400).json({
          ok: false,
          error: 'Data non valida.'
        });
      }

      if (!service) {

        return res.status(400).json({
          ok: false,
          error: 'Servizio non trovato.'
        });
      }

      const slots =
        availableSlots({
          date,
          service,
          appointments,
          settings,
          services
        });

      return res.status(200).json({

        ok: true,

        available:
          slots.length > 0,

        date,

        service:
          service.name,

        slots,

        availableSlots:
          slots
      });
    }


    /* ========================================================
       BOOK
       ======================================================== */

    if (
      action === 'book'
    ) {

      const date =
        clean(body.date);

      const time =
        clean(body.time);

      const name =
        clean(
          body.name ||
          body.clientName
        );

      const service =
        findService(
          services,
          body.service ||
          body.serviceName
        );

      const ignoreId =
        clean(
          body.ignoreId
        );


      /*
       * Validazione dati
       */

      if (
        !validDate(date) ||
        mins(time) === null ||
        !name ||
        !service
      ) {

        return res.status(400).json({

          ok: false,

          bookingConfirmed:
            false,

          error:
            'Dati della prenotazione incompleti.'
        });
      }


      /*
       * Lock per impedire
       * richieste simultanee.
       */

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

        return res.status(409).json({

          ok: false,

          bookingConfirmed:
            false,

          error:
            'Prenotazione in elaborazione. Riprova tra qualche secondo.'
        });
      }


      try {

        /*
         * Ricontrollo server-side
         * della disponibilità.
         */

        if (
          !freeSlot({
            date,
            time,
            service,
            appointments,
            settings,
            services,
            ignoreId
          })
        ) {

          return res.status(409).json({

            ok: false,

            bookingConfirmed:
              false,

            error:
              'Orario non disponibile.',

            availableSlots:
              availableSlots({
                date,
                service,
                appointments,
                settings,
                services
              })
          });
        }


        /*
         * ID appuntamento.
         *
         * In modifica manteniamo l'ID.
         * In nuova prenotazione generiamo
         * un UUID.
         */

        const id =
          ignoreId ||
          `${date}|${time}|${crypto.randomUUID()}`;


        const appointment = {

          id,

          name,

          phone:
            clean(body.phone),

          date,

          time,

          service:
            service.name,

          status:
            'confirmed',

          notes:
            clean(body.notes),

          clientId:
            clean(body.clientId),

          duration:
            duration(service)
        };


        return res.status(200).json({

          ok: true,

          bookingConfirmed:
            true,

          appointment
        });


      } finally {

        release(key);
      }
    }


    /* ========================================================
       CHECK
       ======================================================== */

    if (
      action === 'check'
    ) {

      const date =
        clean(body.date);

      const time =
        clean(body.time);

      const service =
        findService(
          services,
          body.service ||
          body.serviceName
        );

      const ignoreId =
        clean(
          body.ignoreId
        );


      if (
        !validDate(date) ||
        !service ||
        mins(time) === null
      ) {

        return res.status(400).json({

          ok: false,

          error:
            'Dati non validi.'
        });
      }


      return res.status(200).json({

        ok: true,

        available:
          freeSlot({
            date,
            time,
            service,
            appointments,
            settings,
            services,
            ignoreId
          })
      });
    }


    /* ========================================================
       AZIONE NON RICONOSCIUTA
       ======================================================== */

    return res.status(400).json({

      ok: false,

      error:
        'Azione non riconosciuta.'
    });


  } catch (e) {

    console.error(
      'Maviri business engine error',
      e
    );

    return res.status(500).json({

      ok: false,

      error:
        'Errore interno del motore Maviri.'
    });
  }
}
