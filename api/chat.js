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

  if (
    start < open ||
    end > close
  ) {
    return false;
  }

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

  return !appointments.some(a => {

    if (!active(a)) {
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

function release(key) {
  locks.delete(key);
}


/* ============================================================
   CLIENTI
   ============================================================ */

function normalizeClient(client) {

  if (!obj(client)) {
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

function findClient(clients, name, phone) {

  const n =
    norm(name);

  const p =
    clean(phone);

  return (
    clients.find(c =>
      n &&
      norm(c.name) === n
    ) ||

    clients.find(c =>
      p &&
      clean(c.phone) === p
    ) ||

    null
  );
}


/* ============================================================
   CREAZIONE CLIENTE DA PRENOTAZIONE
   ============================================================ */

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
      ...normalizeClient(existing),

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

    const mode =
      clean(body.mode || 'owner');

    const settings =
      obj(body.settings)
        ? body.settings
        : {};

    const business =
      obj(body.business)
        ? body.business
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

      /*
       * CLIENTE:
       * non restituiamo clienti,
       * note interne o appuntamenti
       * completi dell'attività.
       */

      if (mode === 'client') {

        return res.status(200).json({

          ok: true,

          mode: 'client',

          local: true,

          engine:
            'maviri-business-engine-v3',

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

          services,

          promotions,

          appointments: []
        });
      }


      /*
       * TITOLARE:
       * contesto completo.
       */

      return res.status(200).json({

        ok: true,

        mode: 'owner',

        local: true,

        engine:
          'maviri-business-engine-v3',

        today:
          todayRome(),

        business:
          business.name ||
          settings.name ||
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

          error:
            'Data non valida.'
        });
      }

      if (!service) {

        return res.status(400).json({

          ok: false,

          error:
            'Servizio non trovato.'
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

      const phone =
        clean(body.phone);

      const whatsapp =
        clean(body.whatsapp);

      const email =
        clean(body.email);

      const notes =
        clean(body.notes);

      const service =
        findService(
          services,
          body.service ||
          body.serviceName
        );

      const ignoreId =
        clean(body.ignoreId);


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
       * LOCK
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
         * SECONDO CONTROLLO SERVER-SIDE
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
         * CLIENTE
         */

        const client =
          clientFromBooking({

            clients,

            name,

            phone,

            whatsapp,

            email,

            notes
          });


        /*
         * ID
         */

        const id =
          ignoreId ||
          `${date}|${time}|${crypto.randomUUID()}`;


        /*
         * APPUNTAMENTO
         */

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
            'confirmed',

          notes,

          createdAt:
            new Date().toISOString(),

          source:
            mode === 'client'
              ? 'mavi-client'
              : 'mavi-owner'
        };


        /*
         * IMPORTANTE:
         *
         * Questa API non può scrivere
         * direttamente nel localStorage del
         * browser del titolare.
         *
         * Restituiamo quindi l'oggetto
         * all'HTML che deve salvarlo
         * nel proprio storage.
         */

        return res.status(200).json({

          ok: true,

          bookingConfirmed:
            true,

          appointment,

          client,

          message:
            'Prenotazione confermata.'
        });

      } finally {

        release(key);
      }
    }


    /* ========================================================
       UPDATE BOOKING
       ======================================================== */

    if (
      action === 'update'
    ) {

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

        return res.status(400).json({

          ok: false,

          error:
            'Dati modifica appuntamento incompleti.'
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

        return res.status(409).json({

          ok: false,

          error:
            'Modifica già in elaborazione.'
        });
      }


      try {

        if (
          !freeSlot({

            date,

            time,

            service,

            appointments,

            settings,

            services,

            ignoreId: id
          })
        ) {

          return res.status(409).json({

            ok: false,

            error:
              'Il nuovo orario non è disponibile.',

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


        const updated = {

          id,

          clientId:
            clean(body.clientId),

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
            'confirmed',

          notes:
            clean(body.notes),

          updatedAt:
            new Date().toISOString()
        };


        return res.status(200).json({

          ok: true,

          appointment:
            updated,

          message:
            'Appuntamento modificato.'
        });

      } finally {

        release(key);
      }
    }


    /* ========================================================
       CANCEL
       ======================================================== */

    if (
      action === 'cancel'
    ) {

      const id =
        clean(body.id);

      if (!id) {

        return res.status(400).json({

          ok: false,

          error:
            'ID appuntamento mancante.'
        });
      }

      return res.status(200).json({

        ok: true,

        cancelled:
          true,

        id,

        status:
          'cancelled',

        message:
          'Appuntamento annullato.'
      });
    }


    /* ========================================================
       CLIENT LOOKUP
       ======================================================== */

    if (
      action === 'client'
    ) {

      /*
       * Questa funzione è riservata
       * alla modalità titolare.
       */

      if (
        mode !== 'owner'
      ) {

        return res.status(403).json({

          ok: false,

          error:
            'Operazione non disponibile per il cliente.'
        });
      }

      const name =
        clean(body.name);

      const phone =
        clean(body.phone);

      const client =
        findClient(
          clients,
          name,
          phone
        );

      if (!client) {

        return res.status(404).json({

          ok: false,

          client: null,

          error:
            'Cliente non trovato.'
        });
      }

      const history =
        appointments
          .filter(a => {

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
          })
          .sort(
            (a, b) =>
              `${a.date} ${a.time}`.localeCompare(
                `${b.date} ${b.time}`
              )
          );

      return res.status(200).json({

        ok: true,

        client,

        appointments:
          history
      });
    }


    /* ========================================================
       UNKNOWN ACTION
       ======================================================== */

    return res.status(400).json({

      ok: false,

      error:
        'Azione API non riconosciuta.'
    });

  } catch (error) {

    console.error(
      'MAVIRI API ERROR:',
      error
    );

    return res.status(500).json({

      ok: false,

      error:
        'Errore interno del servizio Maviri.'
    });
  }
}
