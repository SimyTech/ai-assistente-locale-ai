const normalize = value => String(value || "")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9\s]/g, " ")
  .replace(/\s+/g, " ")
  .trim();

function businessLabel(data = {}) {
  const name = String(data?.business?.name || "").trim();
  return name ? ` per ${name}` : "";
}

export function answerFastConversation(message, data = {}) {
  const text = normalize(message);
  if (!text) return { handled: false, answer: "" };

  if (/^(ciao|salve|hey|ehi|buongiorno|buonasera)(\s|$)/.test(text)) {
    return {
      handled: true,
      answer: `Ciao. Sono Mavi${businessLabel(data)}. Posso aiutarti a gestire appuntamenti, clienti, servizi, promozioni e attività quotidiane, oppure ragionare con te su testi, idee e decisioni.`
    };
  }

  if (/^(mavi|chi sei|cosa sei|presentati)$/.test(text)) {
    return {
      handled: true,
      answer: `Sono Mavi, l'assistente di Maviri${businessLabel(data)}. Posso leggere i dati dell'attività, aiutarti a organizzare il lavoro e supportarti nelle richieste generiche senza confondere una risposta con un'azione realmente eseguita.`
    };
  }

  if (/(cosa sai fare|cosa puoi fare|come mi puoi aiutare|come puoi aiutarmi|a cosa servi|come funziona mavi)/.test(text)) {
    return {
      handled: true,
      answer: "Posso controllare agenda e disponibilità, aiutarti con prenotazioni e clienti, leggere servizi, prezzi e promozioni, preparare riepiloghi, suggerire priorità, scrivere contenuti e rispondere anche a domande generiche. Per le azioni operative uso sempre i controlli di Maviri prima di considerarle eseguite."
    };
  }

  if (/^(come va|come stai|tutto bene|ci sei|sei pronta|sei pronto)$/.test(text)) {
    return {
      handled: true,
      answer: "Ci sono e sono pronta. Dimmi pure cosa vuoi controllare, organizzare o approfondire."
    };
  }

  if (/^(grazie|grazie mavi|perfetto|ottimo|va bene|ok grazie)$/.test(text)) {
    return { handled: true, answer: "Prego. Puoi continuare da qui senza ripetere tutto da capo." };
  }

  return { handled: false, answer: "" };
}
