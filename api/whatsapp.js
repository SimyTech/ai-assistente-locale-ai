/* MAVIRI — WHATSAPP WEBHOOK
 * Copyright © 2026 Maviri / SimyTech.
 * Proprietary software. All rights reserved.
 *
 * WhatsApp Cloud API bridge
 *
 * FLUSSO:
 * WhatsApp cliente
 *      ↓
 * /api/whatsapp
 *      ↓
 * /api/chat
 *      ↓
 * Mavi
 *      ↓
 * risposta
 *      ↓
 * WhatsApp cliente
 *
 * ENV richieste:
 *
 * WHATSAPP_VERIFY_TOKEN
 * WHATSAPP_ACCESS_TOKEN
 * WHATSAPP_PHONE_NUMBER_ID
 *
 * opzionale:
 * WHATSAPP_APP_SECRET
 *
 * Redis:
 *
 * UPSTASH_REDIS_REST_URL
 * UPSTASH_REDIS_REST_TOKEN
 */

const VERIFY_TOKEN =
  process.env.WHATSAPP_VERIFY_TOKEN || "";

const WHATSAPP_ACCESS_TOKEN =
  process.env.WHATSAPP_ACCESS_TOKEN || "";

const WHATSAPP_PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID || "";

const WHATSAPP_APP_SECRET =
  process.env.WHATSAPP_APP_SECRET || "";

const REDIS_URL =
  process.env.UPSTASH_REDIS_REST_URL || "";

const REDIS_TOKEN =
  process.env.UPSTASH_REDIS_REST_TOKEN || "";

const TENANT_ID =
  process.env.MAVIRI_DEFAULT_TENANT || "default";

const MAX_HISTORY = 20;

const SESSION_TTL =
  1000 * 60 * 60 * 24 * 7;


/* ============================================================
   UTILITY
   ============================================================ */

const clean = value =>
  String(value ?? "")
    .replace(/\u0000/g, "")
    .trim();


const jsonResponse = (
  res,
  status,
  data
) => {

  res.status(status);

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  return res.json(data);
};


const textResponse = (
  res,
  status,
  text
) => {

  res.status(status);

  res.setHeader(
    "Content-Type",
    "text/plain; charset=utf-8"
  );

  return res.send(text);
};


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

  if (result.error) {

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

    return JSON.parse(
      value
    );

  } catch {

    return value;
  }
}


async function redisSet(
  key,
  value,
  ttl = null
) {

  if (ttl) {

    return redisCommand(
      "SET",
      key,
      JSON.stringify(value),
      "PX",
      String(ttl)
    );
  }

  return redisCommand(
    "SET",
    key,
    JSON.stringify(value)
  );
}


/* ============================================================
   SESSIONE WHATSAPP
   ============================================================ */

function sessionKey(
  phone
) {

  return (
    "maviri:whatsapp:session:" +
    clean(phone)
  );
}


async function loadSession(
  phone
) {

  const session =
    await redisGet(
      sessionKey(phone)
    );

  if (
    !session ||
    typeof session !== "object"
  ) {

    return {
      phone:
        clean(phone),

      sessionId:
        `whatsapp-${clean(phone)}`,

      history: []
    };
  }

  return {

    phone:
      clean(phone),

    sessionId:
      clean(
        session.sessionId
      ) ||
      `whatsapp-${clean(phone)}`,

    history:
      Array.isArray(
        session.history
      )
        ? session.history.slice(
            -MAX_HISTORY
          )
        : []
  };
}


async function saveSession(
  phone,
  session
) {

  const history =
    Array.isArray(
      session.history
    )
      ? session.history.slice(
          -MAX_HISTORY
        )
      : [];

  await redisSet(
    sessionKey(phone),
    {
      phone:
        clean(phone),

      sessionId:
        clean(
          session.sessionId
        ) ||
        `whatsapp-${clean(phone)}`,

      history
    },
    SESSION_TTL
  );
}


/* ============================================================
   STORICO CONVERSAZIONE
   ============================================================ */

function addHistory(
  session,
  role,
  content
) {

  if (
    !Array.isArray(
      session.history
    )
  ) {

    session.history = [];
  }

  session.history.push({

    role:
      clean(role),

    content:
      clean(content)
  });

  session.history =
    session.history.slice(
      -MAX_HISTORY
    );
}


/* ============================================================
   WHATSAPP API
   ============================================================ */

async function sendWhatsAppMessage(
  to,
  message
) {

  if (
    !WHATSAPP_ACCESS_TOKEN ||
    !WHATSAPP_PHONE_NUMBER_ID
  ) {

    throw new Error(
      "WhatsApp Cloud API non configurata."
    );
  }

  const url =
    `https://graph.facebook.com/v23.0/` +
    `${WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response =
    await fetch(
      url,
      {
        method: "POST",

        headers: {

          Authorization:
            `Bearer ${WHATSAPP_ACCESS_TOKEN}`,

          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({

            messaging_product:
              "whatsapp",

            recipient_type:
              "individual",

            to:
              clean(to),

            type:
              "text",

            text: {

              preview_url:
                false,

              body:
                clean(message)
            }
          })
      }
    );

  const data =
    await response.json();

  if (!response.ok) {

    throw new Error(
      data?.error?.message ||
      `WhatsApp HTTP ${response.status}`
    );
  }

  return data;
}


/* ============================================================
   ESTRAZIONE MESSAGGIO
   ============================================================ */

function extractIncomingMessage(
  body
) {

  const entries =
    Array.isArray(
      body?.entry
    )
      ? body.entry
      : [];

  for (
    const entry of entries
  ) {

    const changes =
      Array.isArray(
        entry?.changes
      )
        ? entry.changes
        : [];

    for (
      const change of changes
    ) {

      const value =
        change?.value;

      const messages =
        Array.isArray(
          value?.messages
        )
          ? value.messages
          : [];

      for (
        const message of messages
      ) {

        if (
          message?.type !==
          "text"
        ) {

          continue;
        }

        const phone =
          clean(
            message?.from
          );

        const text =
          clean(
            message?.text?.body
          );

        if (
          phone &&
          text
        ) {

          return {

            phone,

            messageId:
              clean(
                message?.id
              ),

            text,

            profileName:
              clean(
                value?.contacts?.[0]
                  ?.profile?.name
              ),

            timestamp:
              clean(
                message?.timestamp
              )
          };
        }
      }
    }
  }

  return null;
}


/* ============================================================
   VERIFICA WEBHOOK META
   ============================================================ */

function verifyWebhook(
  req
) {

  const mode =
    clean(
      req.query?.["hub.mode"]
    );

  const token =
    clean(
      req.query?.["hub.verify_token"]
    );

  const challenge =
    clean(
      req.query?.["hub.challenge"]
    );

  if (
    mode !==
    "subscribe"
  ) {

    return {
      ok: false,
      status: 400
    };
  }

  if (
    !VERIFY_TOKEN ||
    token !==
    VERIFY_TOKEN
  ) {

    return {
      ok: false,
      status: 403
    };
  }

  return {

    ok: true,

    challenge
  };
}


/* ============================================================
   FIRMA META
   ============================================================ */

async function verifySignature(
  req
) {

  /*
   * La verifica della firma viene eseguita
   * solo se WHATSAPP_APP_SECRET è configurato.
   *
   * Vercel normalmente espone req.rawBody
   * quando disponibile.
   */

  if (
    !WHATSAPP_APP_SECRET
  ) {

    return true;
  }

  const signature =
    clean(
      req.headers[
        "x-hub-signature-256"
      ]
    );

  if (
    !signature.startsWith(
      "sha256="
    )
  ) {

    return false;
  }

  const rawBody =
    req.rawBody;

  if (
    !rawBody
  ) {

    /*
     * Se il runtime non rende disponibile
     * rawBody non possiamo verificare
     * crittograficamente la firma.
     *
     * In questo caso rifiutiamo la richiesta
     * anziché considerarla valida.
     */

    return false;
  }

  const expected =
    await crypto.subtle.sign(
      "HMAC",
      await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(
          WHATSAPP_APP_SECRET
        ),
        {
          name:
            "HMAC",

          hash:
            "SHA-256"
        },
        false,
        ["sign"]
      ),
      new TextEncoder().encode(
        rawBody
      )
    );

  const hex =
    Array.from(
      new Uint8Array(
        expected
      )
    )
      .map(
        byte =>
          byte
            .toString(16)
            .padStart(2, "0")
      )
      .join("");

  return (
    signature ===
    `sha256=${hex}`
  );
}


/* ============================================================
   CHIAMATA A MAVI
   ============================================================ */

async function callMavi(
  req,
  {
    phone,
    text,
    profileName,
    session
  }
) {

  /*
   * Usiamo la stessa API interna di Maviri.
   *
   * Non duplichiamo:
   * - servizi
   * - orari
   * - disponibilità
   * - prenotazioni
   * - clienti
   * - conferme
   *
   * Tutto rimane nel motore /api/chat.js.
   */

  const origin =
    `${req.headers["x-forwarded-proto"] || "https"}://` +
    `${req.headers["x-forwarded-host"] || req.headers.host}`;

  const response =
    await fetch(
      `${origin}/api/chat`,
      {
        method: "POST",

        headers: {

          "Content-Type":
            "application/json",

          "x-maviri-tenant":
            TENANT_ID
        },

        body:
          JSON.stringify({

            action:
              "chat",

            tenantId:
              TENANT_ID,

            role:
              "client",

            mode:
              "client",

            sessionId:
              session.sessionId,

            message:
              text,

            history:
              session.history,

            clientPhone:
              phone,

            clientWhatsapp:
              phone,

            clientName:
              profileName
          })
      }
    );

  const data =
    await response.json()
      .catch(
        () => ({})
      );

  if (!response.ok) {

    throw new Error(
      data?.error ||
      `Mavi HTTP ${response.status}`
    );
  }

  /*
   * Compatibilità con le diverse forme
   * di risposta già utilizzate dal motore.
   */

  const reply =
    clean(
      data?.reply ||
      data?.message ||
      data?.response ||
      data?.text ||
      data?.answer
    );

  if (!reply) {

    throw new Error(
      "Mavi non ha restituito una risposta."
    );
  }

  return {

    reply,

    raw:
      data
  };
}


/* ============================================================
   HANDLER
   ============================================================ */

export default async function handler(
  req,
  res
) {

  /*
   * ----------------------------------------------------------
   * GET
   * Verifica webhook Meta
   * ----------------------------------------------------------
   */

  if (
    req.method ===
    "GET"
  ) {

    const verification =
      verifyWebhook(req);

    if (
      !verification.ok
    ) {

      return textResponse(
        res,
        verification.status,
        "Forbidden"
      );
    }

    return textResponse(
      res,
      200,
      verification.challenge
    );
  }


  /*
   * ----------------------------------------------------------
   * Solo POST per i messaggi
   * ----------------------------------------------------------
   */

  if (
    req.method !==
    "POST"
  ) {

    res.setHeader(
      "Allow",
      "GET, POST"
    );

    return jsonResponse(
      res,
      405,
      {
        ok: false,

        error:
          "Method Not Allowed"
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * Verifica firma
   * ----------------------------------------------------------
   */

  const signatureValid =
    await verifySignature(req);

  if (
    !signatureValid
  ) {

    return jsonResponse(
      res,
      401,
      {
        ok: false,

        error:
          "Firma WhatsApp non valida."
      }
    );
  }


  /*
   * ----------------------------------------------------------
   * Estrazione messaggio
   * ----------------------------------------------------------
   */

  const incoming =
    extractIncomingMessage(
      req.body
    );


  /*
   * Meta può inviare notifiche che
   * non contengono messaggi testuali.
   *
   * Rispondiamo comunque 200 per evitare
   * retry inutili.
   */

  if (!incoming) {

    return jsonResponse(
      res,
      200,
      {
        ok: true,

        ignored:
          true
      }
    );
  }


  const {

    phone,

    messageId,

    text,

    profileName

  } = incoming;


  /*
   * ----------------------------------------------------------
   * Carica sessione cliente
   * ----------------------------------------------------------
   */

  try {

    const session =
      await loadSession(
        phone
      );


    /*
     * --------------------------------------------------------
     * Evita elaborazioni duplicate
     * --------------------------------------------------------
     *
     * Meta può ritrasmettere lo stesso webhook.
     */

    const processedKey =
      `maviri:whatsapp:processed:${messageId}`;

    if (
      messageId
    ) {

      const alreadyProcessed =
        await redisGet(
          processedKey
        );

      if (
        alreadyProcessed
      ) {

        return jsonResponse(
          res,
          200,
          {
            ok: true,

            duplicate:
              true
          }
        );
      }

      await redisSet(
        processedKey,
        {
          phone,

          messageId
        },
        1000 * 60 * 60 * 24
      );
    }


    /*
     * --------------------------------------------------------
     * Salva messaggio cliente
     * --------------------------------------------------------
     */

    addHistory(
      session,
      "user",
      text
    );


    /*
     * --------------------------------------------------------
     * Mavi
     * --------------------------------------------------------
     */

    const result =
      await callMavi(
        req,
        {
          phone,

          text,

          profileName,

          session
        }
      );


    /*
     * --------------------------------------------------------
     * Salva risposta Mavi
     * --------------------------------------------------------
     */

    addHistory(
      session,
      "assistant",
      result.reply
    );

    await saveSession(
      phone,
      session
    );


    /*
     * --------------------------------------------------------
     * Invia risposta WhatsApp
     * --------------------------------------------------------
     */

    await sendWhatsAppMessage(
      phone,
      result.reply
    );


    /*
     * --------------------------------------------------------
     * Fine
     * --------------------------------------------------------
     */

    return jsonResponse(
      res,
      200,
      {
        ok: true,

        messageId,

        phone,

        reply:
          result.reply
      }
    );

  } catch (error) {

    console.error(
      "MAVIRI WHATSAPP ERROR:",
      error
    );

    /*
     * Non inviamo dettagli tecnici
     * al cliente.
     */

    try {

      await sendWhatsAppMessage(
        phone,
        "Si è verificato un problema temporaneo. Riprova tra poco."
      );

    } catch (
      sendError
    ) {

      console.error(
        "WHATSAPP SEND ERROR:",
        sendError
      );
    }

    return jsonResponse(
      res,
      500,
      {
        ok: false,

        error:
          "Errore interno WhatsApp."
      }
    );
  }
}
