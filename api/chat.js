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

    const formatDay = (name, day) => {
      if (!day || day.status === "closed") {
        return `${name}: Chiuso`;
      }

      return `${name}: ${day.open || "--:--"} - ${day.close || "--:--"}`;
    };

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

LISTINO DELL'ATTIVITÀ:
${serviceList}

REGOLE IMPORTANTI:

1. Rispondi sempre in italiano.
2. Usa le informazioni dell'attività fornite sopra.
3. Non inventare servizi, prezzi, orari, indirizzi o contatti.
4. Quando il cliente chiede il prezzo di un servizio, usa esclusivamente il listino.
5. Quando il cliente chiede gli orari, usa esclusivamente gli orari sopra.
6. Se un giorno è indicato come "Chiuso", informa il cliente che l'attività è chiusa quel giorno.
7. Se non conosci un'informazione, dillo chiaramente invece di inventarla.
8. Non dichiarare mai che un appuntamento è realmente prenotato.
9. Puoi raccogliere una richiesta di appuntamento.
10. Per raccogliere una richiesta servono:
   - nome cliente
   - servizio
   - giorno
   - ora

Quando hai TUTTI questi dati, restituisci JSON valido:

{
  "reply": "testo naturale per il cliente",
  "appointment": {
    "name": "nome",
    "service": "servizio",
    "date": "giorno",
    "time": "ora"
  }
}

Se manca anche un solo dato:

{
  "reply": "testo naturale per il cliente",
  "appointment": null
}

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
