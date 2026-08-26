import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Metodo non consentito" });
  }

  try {
    const { message, business } = req.body || {};

    if (!message) {
      return res.status(400).json({ error: "Messaggio mancante" });
    }

    const response = await client.responses.create({
      model: "gpt-5",
      instructions: `Sei l'assistente AI di ${business || "un'attività locale italiana"}.
Rispondi in italiano, in modo professionale, breve e naturale.
Aiuta i clienti con informazioni, servizi e richieste di appuntamento.
Non inventare prezzi, orari o disponibilità.`,
      input: message
    });

    return res.status(200).json({
      reply: response.output_text
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "Errore durante la richiesta AI"
    });
  }
}

