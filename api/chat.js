import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Metodo non consentito"
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      error: "OPENAI_API_KEY non disponibile nel deployment Vercel"
    });
  }

  try {
    const {
      message,
      business,
      clientName,
      settings = {},
      services = [],
      appointments = [],
      history = []
    } = req.body || {};

    if (!message) {
      return res.status(400).json({
        error: "Messaggio mancante"
      });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    const hours = settings.hours || {};

    function formatDay(name, day) {
      if (!day || day.status === "closed") {
        return `${name}: Chiuso`;
      }

      return `${name}: ${day.open || "--:--"} - ${day.close || "--:--"}`;
    }

    const openingHours = [
      formatDay("Lunedì", hours.monday),
      formatDay("Martedì", hours.tuesday),
      formatDay("Mercoledì", hours.wednesday),
      formatDay("Giovedì", hours.thursday),
      formatDay("Venerdì", hours.friday),
      formatDay("Sabato", hours.saturday),
      formatDay("Domenica", hours.sunday)
    ].join("\n");

    const serviceList = services.length
      ? services
          .map(
            s =>
              `- ${s.name}: €${s.price} (${s.duration} minuti)`
          )
          .join("\n")
      : "Nessun servizio inserito nel listino.";

    const appointmentList = appointments.length
      ? appointments
          .map(
            a =>
              `- ${a.n || "Cliente"} | ${a.s || "Servizio"} | ${a.d || "Data"} | ${a.t || "Ora"}`
          )
          .join("\n")
      : "Nessun appuntamento presente.";

    const conversation = [
      ...history,
      {
        role: "user",
        content: message
      }
    ];

    const response = await client.responses.create({
      model: "gpt-5.4-mini",

      instructions: `Sei l'assistente virtuale di ${
        business || "un'attività locale italiana"
      }.

TIPO DI ATTIVITÀ:
${settings.type || "Non specificato"}

DESCRIZIONE:
${settings.description || "Non specificata"}

INDIRIZZO:
${settings.address || "Non specificato"}

TELEFONO:
${settings.phone || "Non specificato"}

WHATSAPP:
${settings.whatsapp || "Non specificato"}

ORARI DI APERTURA:
${openingHours}

LISTINO:
${serviceList}

APPUNTAMENTI GIÀ PRESENTI:
${appointmentList}

REGOLE:

1. Rispondi sempre in italiano.
2. Usa esclusivamente le informazioni fornite.
3. Non inventare prezzi, servizi, orari o disponibilità.
4. Quando il cliente chiede il prezzo, usa il listino.
5. Quando il cliente chiede gli orari, usa gli orari dell'attività.
6. Non proporre appuntamenti quando l'attività è chiusa.
7. Non accettare un appuntamento se esiste già un appuntamento nello stesso giorno e orario.
8. Considera la durata del servizio quando valuti la compatibilità dell'orario.
9. Se l'orario richiesto non è disponibile, chiedi al cliente di scegliere un altro orario.
10. Non dichiarare mai che una prenotazione è realmente confermata.
11. Puoi soltanto raccogliere una richiesta di appuntamento.

Per raccogliere una richiesta servono:
- nome cliente
- servizio
- giorno
- ora

Se manca uno di questi dati, restituisci:

{
  "reply": "testo naturale per il cliente",
  "appointment": null
}

Se il giorno è chiuso, l'orario è fuori apertura oppure c'è un conflitto con un appuntamento esistente:

{
  "reply": "testo naturale che spiega il problema e chiede un altro orario",
  "appointment": null
}

Se tutti i dati sono presenti e l'orario è compatibile:

{
  "reply": "testo naturale che comunica che la richiesta è stata raccolta",
  "appointment": {
    "name": "nome",
    "service": "servizio",
    "date": "giorno",
    "time": "ora"
  }
}

Restituisci SEMPRE JSON valido.
Non aggiungere testo fuori dal JSON.`,

      input: conversation
    });

    let result;

    try {
      result = JSON.parse(response.output_text);
    } catch {
      result = {
        reply: response.output_text,
        appointment: null
      };
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error("OPENAI ERROR:", error);

    return res.status(500).json({
      error: error?.message || "Errore durante la richiesta AI"
    });
  }
}
