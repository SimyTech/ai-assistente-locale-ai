import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito" });
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

    const conversation = [
      ...history,
      {
        role: "user",
        content: message
      }
    ];

    const response = await client.responses.create({
      model: "gpt-5.4-mini",

      instructions: `Sei l'assistente virtuale di ${business || "un'attività locale italiana"}.

Parla con i clienti in modo naturale, professionale e disponibile.

Il tuo compito è aiutare il cliente e raccogliere richieste di appuntamento.

Quando hai TUTTI questi dati:
- nome cliente
- servizio
- giorno
- ora

devi restituire una risposta JSON valida con questa struttura:

{
  "reply": "testo naturale per il cliente",
  "appointment": {
    "name": "nome",
    "service": "servizio",
    "date": "giorno",
    "time": "ora"
  }
}

Se manca anche un solo dato, restituisci:

{
  "reply": "testo naturale per il cliente",
  "appointment": null
}

Non dichiarare mai che l'appuntamento è stato realmente prenotato.
Dichiara solo che la richiesta è stata raccolta.

Non inventare prezzi, orari o disponibilità.
Rispondi sempre in italiano.`,

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

