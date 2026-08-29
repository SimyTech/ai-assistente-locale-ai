/* ============================================================
   MAVIRI — BUSINESS ENGINE
   /api/chat.js

   IMPORTANTISSIMO:
   Questo file NON contiene alcuna AI esterna.

   Nessun:
   - OpenAI
   - API key
   - modello cloud
   - generazione AI

   Mavi AI Engine gira localmente nel browser.

   Questo endpoint gestisce:
   - disponibilità
   - appuntamenti
   - controllo conflitti
   - servizi
   - clienti
   - promozioni
   ============================================================ */

const LOCK_TTL = 15000;

const locks =
  globalThis.__maviriLocks ||
  new Map();

globalThis.__maviriLocks =
  locks;


/* ============================================================
   HELPERS
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
    .replace(/\s+/g, " ")
    .trim();


const isObject = value =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value);


const arr = (
  value,
  max
) =>
  Array.isArray(value)
    ? value
        .filter(isObject)
        .slice(0, max)
    : [];


const toMinutes = value => {

  let text =
    clean(value)
      .replace(/[.,]/g, ":");


  if (
    /^\d{1,2}$/.test(text)
  ) {

    text += ":00";

  }


  const match =
    text.match(
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

};


const fmt = minutes => {

  if (
    !Number.isFinite(minutes)
  ) {

    return "";

  }


  return (
    String(
      Math.floor(minutes / 60)
    ).padStart(2, "0") +
    ":" +
    String(
      minutes % 60
    ).padStart(2, "0")
  );

};


/* ============================================================
   DATE
   ============================================================ */

const validDate = date =>
  /^\d{4}-\d{2}-\d{2}$/.test(
    clean(date)
  );


const todayRome = () => {

  const parts =
    new Intl.DateTimeFormat(
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
    ).formatToParts(
      new Date()
    );


  const result = {};


  for (
    const part
    of parts
  ) {

    if (
      part.type !== "literal"
    ) {

      result[
        part.type
      ] =
        part.value;

    }

  }


  return (
    `${result.year}-${result.month}-${result.day}`
  );

};


const addDays = (
  date,
  amount
) => {

  if (
    !validDate(date)
  ) {

    return "";

  }


  const d =
    new Date(
      `${date}T12:00:00`
    );


  d.setDate(
    d.getDate() + amount
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

};


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

    return res.status(405).json({

      ok: false,

      error:
        "Metodo non consentito."

    });

  }


  try {

    const body =
      isObject(req.body)
        ? req.body
        : {};


    const action =
      clean(
        body.action
      );


    const settings =
      isObject(body.settings)
        ? body.settings
        : {};


    const services =
      arr(
        body.services,
        200
      );


    const appointments =
      arr(
        body.appointments,
        3000
      );


    const clients =
      arr(
        body.clients,
        5000
      );


    const promotions =
      arr(
        body.promotions,
        200
      );


    /* ========================================================
       SERVICE
       ======================================================== */

    const findService =
      name => {

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

              const n =
                norm(
                  service.name
                );

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

      };


    const duration =
      service => {

        const value =
          Number(
            service?.duration
          );


        return (
          Number.isFinite(value) &&
          value > 0
            ? Math.round(value)
            : 30
        );

      };


    /* ========================================================
       APPOINTMENT
       ======================================================== */

    const appointmentDate =
      appointment =>
        clean(
          appointment.date ||
          appointment.d ||
          ""
        );


    const appointmentTime =
      appointment =>
        clean(
          appointment.time ||
          appointment.t ||
          ""
        );


    const appointmentService =
      appointment =>
        clean(
          appointment.service ||
          appointment.s ||
          ""
        );


    const appointmentName =
      appointment =>
        clean(
          appointment.name ||
          appointment.n ||
          ""
        );


    const active =
      appointment => {

        const status =
          norm(
            appointment.status ||
            "confermato"
          );


        return ![
          "cancellato",
          "cancelled",
          "canceled",
          "annullato",
          "deleted"
        ].includes(
          status
        );

      };


    /* ========================================================
       DAY SETTINGS
       ======================================================== */

    const dayName =
      date => {

        const index =
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
        ][index];

      };


    const daySettings =
      date => {

        const key =
          dayName(date);


        const hours =
          isObject(settings.hours)
            ? settings.hours
            : {};


        const day =
          isObject(hours[key])
            ? hours[key]
            : null;


        if (!day) {

          return null;

        }


        return {

          closed:
            day.closed === true ||
            day.status === "closed" ||
            day.status === "chiuso" ||
            day.open === false,

          open:
            clean(
              day.start ||
              day.open ||
              day.from ||
              ""
            ),

          close:
            clean(
              day.end ||
              day.close ||
              day.to ||
              ""
            ),

          breakStart:
            clean(
              day.breakStart ||
              day.pauseStart ||
              ""
            ),

          breakEnd:
            clean(
              day.breakEnd ||
              day.pauseEnd ||
              ""
            )

        };

      };


    /* ========================================================
       FREE SLOT
       ======================================================== */

    const free =
      (
        date,
        time,
        service,
        ignoreId = ""
      ) => {

        if (
          !validDate(date)
        ) {

          return false;

        }


        const day =
          daySettings(date);


        if (
          !day ||
          day.closed
        ) {

          return false;

        }


        const start =
          toMinutes(time);

        const open =
          toMinutes(day.open);

        const close =
          toMinutes(day.close);

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


        const breakStart =
          toMinutes(
            day.breakStart
          );

        const breakEnd =
          toMinutes(
            day.breakEnd
          );


        if (
          breakStart !== null &&
          breakEnd !== null &&
          start < breakEnd &&
          end > breakStart
        ) {

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
              ignoreId &&
              String(
                appointment.id
              ) ===
              String(ignoreId)
            ) {

              return false;

            }


            if (
              appointmentDate(
                appointment
              ) !== date
            ) {

              return false;

            }


            const existing =
              toMinutes(
                appointmentTime(
                  appointment
                )
              );


            if (
              existing === null
            ) {

              return false;

            }


            const existingService =
              findService(
                appointmentService(
                  appointment
                )
              );


            const existingEnd =
              existing +
              duration(
                existingService
              );


            return (
              start < existingEnd &&
              end > existing
            );

          }
        );

      };


    /* ========================================================
       AVAILABLE
       ======================================================== */

    const available =
      (
        date,
        service
      ) => {

        const result = [];

        const day =
          daySettings(date);


        if (
          !day ||
          day.closed
        ) {

          return result;

        }


        const open =
          toMinutes(day.open);

        const close =
          toMinutes(day.close);


        if (
          open === null ||
          close === null
        ) {

          return result;

        }


        const step =
          30;


        for (
          let start =
            Math.ceil(
              open / step
            ) * step;

          start +
            duration(service)
            <= close;

          start += step
        ) {

          if (
            free(
              date,
              fmt(start),
              service
            )
          ) {

            result.push(
              fmt(start)
            );

          }

        }


        return result;

      };


    /* ========================================================
       ACTION: CONTEXT
       ======================================================== */

    if (
      action === "context"
    ) {

      return res.status(200).json({

        ok: true,

        local: true,

        engine:
          "maviri-business-engine",

        today:
          todayRome(),

        business:
          settings.name ||
          body.business ||
          "",

        services,

        clients,

        promotions,

        appointments:
          appointments.filter(
            active
          )

      });

    }


    /* ========================================================
       ACTION: AVAILABILITY
       ======================================================== */

    if (
      action === "availability"
    ) {

      const date =
        clean(
          body.date
        );


      const service =
        findService(
          body.service ||
          body.serviceName
        );


      if (
        !validDate(date)
      ) {

        return res.status(400).json({

          ok: false,

          error:
            "Data non valida."

        });

      }


      if (!service) {

        return res.status(400).json({

          ok: false,

          error:
            "Servizio non trovato."

        });

      }


      const slots =
        available(
          date,
          service
        );


      return res.status(200).json({

        ok: true,

        local: true,

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
       ACTION: BOOK
       ======================================================== */

    if (
      action === "book"
    ) {

      const date =
        clean(
          body.date
        );

      const time =
        clean(
          body.time
        );

      const service =
        findService(
          body.service
        );

      const name =
        clean(
          body.name ||
          body.clientName
        );


      if (
        !validDate(date) ||
        toMinutes(time) === null ||
        !service
      ) {

        return res.status(400).json({

          ok: false,

          bookingConfirmed:
            false,

          error:
            "Dati della prenotazione incompleti."

        });

      }


      const key =
        `${date}|${time}|${norm(service.name)}`;


      const now =
        Date.now();


      for (
        const [
          lockKey,
          lock
        ]
        of locks
      ) {

        if (
          now -
          lock.createdAt >
          LOCK_TTL
        ) {

          locks.delete(
            lockKey
          );

        }

      }


      if (
        locks.has(key)
      ) {

        return res.status(409).json({

          ok: false,

          bookingConfirmed:
            false,

          error:
            "Prenotazione già in elaborazione."

        });

      }


      locks.set(
        key,
        {
          createdAt:
            now
        }
      );


      try {

        if (
          !free(
            date,
            time,
            service
          )
        ) {

          return res.status(409).json({

            ok: true,

            bookingConfirmed:
              false,

            available:
              false,

            availableSlots:
              available(
                date,
                service
              ),

            error:
              "L'orario non è più disponibile."

          });

        }


        /*
         * L'API NON salva direttamente su database:
         * restituisce il record definitivo al client,
         * che lo integra nel proprio storage Maviri.
         */

        const appointment = {

          id:
            key,

          bookingKey:
            key,

          name,

          date,

          time,

          service:
            service.name,

          duration:
            duration(service),

          status:
            "confermato",

          createdAt:
            new Date()
              .toISOString()

        };


        return res.status(200).json({

          ok: true,

          local: true,

          bookingConfirmed:
            true,

          confirmed:
            true,

          appointment

        });

      } finally {

        locks.delete(
          key
        );

      }

    }


    /* ========================================================
       UNKNOWN ACTION
       ======================================================== */

    return res.status(400).json({

      ok: false,

      error:
        "Azione non riconosciuta."

    });


  } catch (error) {

    console.error(
      "MAVIRI BUSINESS ENGINE:",
      error
    );


    return res.status(500).json({

      ok: false,

      error:
        "Errore interno del Business Engine."

    });

  }

}
