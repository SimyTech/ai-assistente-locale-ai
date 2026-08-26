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

Il cliente può chiedere di organizzare un appuntamento.

Quando raccogli informazioni per un appuntamento:
- servizio
- giorno
- ora
- nome cliente

mantieni il contesto della conversazione.

IMPORTANTE:
- Non dire mai che un appuntamento è stato prenotato.
- Non dire mai che una disponibilità è stata verificata.
- Puoi dire che hai raccolto i dati della richiesta.
- Se mancano dati, chiedili naturalmente.
- Non inventare prezzi, orari o disponibilità.
- Rispondi sempre in italiano.
- Mantieni le risposte brevi e naturali.

Nome cliente disponibile: ${clientName || "non fornito"}`,

      input: conversation
    });

    return res.status(200).json({
      reply: response.output_text
    });

  } catch (error) {
    console.error("OPENAI ERROR:", error);

    return res.status(500).json({
      error: error?.message || "Errore durante la richiesta AI"
    });
  }
}
