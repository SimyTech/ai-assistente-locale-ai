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
    const { message, business, history = [] } = req.body || {};

    if (!message) {
      return res.status(400).json({ error: "Messaggio mancante" });
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

Parla con i clienti come una persona reale che lavora nell'attività.

REGOLE:
- Rispondi sempre in italiano.
- Usa un tono naturale, professionale e disponibile.
- Non presentarti nuovamente a ogni messaggio.
- Mantieni il contesto della conversazione.
- Non chiedere al cliente di ripetere informazioni che ha già fornito.
- Rispondi direttamente alla domanda.
- Mantieni le risposte brevi, generalmente 2-5 frasi.
- Se una richiesta è poco chiara, fai una domanda semplice.
- Per gli appuntamenti raccogli progressivamente servizio, giorno e orario.
- Non dichiarare mai un appuntamento come prenotato se non hai accesso a un sistema di prenotazione.
- Non inventare prezzi, orari, disponibilità, servizi o promozioni.
- Se non conosci un'informazione, dichiaralo chiaramente.
- Non usare risposte robotiche o ripetitive.
- Usa emoji solo quando sono realmente appropriate.`,

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
