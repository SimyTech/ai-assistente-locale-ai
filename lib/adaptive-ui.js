const clean = value => String(value ?? "").trim();

function title(value, fallback) {
  const text = clean(value) || fallback;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function pluralWord(word) {
  const text = clean(word);
  if (!text) return text;
  if (/io$/i.test(text)) return text.slice(0, -2) + (/[A-ZÀ-Ý]/.test(text.at(-1)) ? "I" : "i");
  if (/a$/i.test(text)) return text.slice(0, -1) + (/[A-ZÀ-Ý]/.test(text.at(-1)) ? "E" : "e");
  if (/o$/i.test(text) || /e$/i.test(text)) return text.slice(0, -1) + (/[A-ZÀ-Ý]/.test(text.at(-1)) ? "I" : "i");
  return text;
}

function pluralLabel(label) {
  return clean(label)
    .split("/")
    .map(part => {
      const words = part.split(/\s+/);
      if (!words.length) return part;
      words[words.length - 1] = pluralWord(words[words.length - 1]);
      return words.join(" ");
    })
    .join("/");
}

export function adaptiveDashboardPlan(profile = {}) {
  const mode = clean(profile.workflowMode) || "mixed";
  const capabilities = profile.capabilities && typeof profile.capabilities === "object"
    ? profile.capabilities
    : {};
  const labels = profile.labels && typeof profile.labels === "object"
    ? profile.labels
    : {};

  const appointmentLabel = title(labels.appointment, "Prenotazione");
  const clientLabel = title(labels.client, "Cliente");
  const serviceLabel = title(labels.service, "Servizio");

  const appointmentsVisible = capabilities.appointments !== false && mode !== "none";
  const clientsVisible = capabilities.clients !== false;
  const servicesVisible = capabilities.services !== false;
  const promotionsVisible = capabilities.promotions !== false;
  const contentVisible = capabilities.content !== false;

  const order = mode === "appointment"
    ? ["home", "calendar", "mavi", "clients", "content", "settings"]
    : mode === "walk-in"
      ? ["home", "mavi", "clients", "content", "settings", "calendar"]
      : mode === "none"
        ? ["home", "mavi", "clients", "content", "settings", "calendar"]
        : ["home", "mavi", "calendar", "clients", "content", "settings"];

  return {
    mode,
    name: clean(profile.name),
    sector: clean(profile.sector) || "generic",
    labels: {
      appointment: appointmentLabel,
      appointments: pluralLabel(appointmentLabel),
      client: clientLabel,
      clients: pluralLabel(clientLabel),
      service: serviceLabel,
      services: pluralLabel(serviceLabel)
    },
    visible: {
      home: true,
      mavi: true,
      calendar: appointmentsVisible,
      clients: clientsVisible,
      content: contentVisible,
      settings: true,
      services: servicesVisible,
      promotions: promotionsVisible
    },
    order,
    primaryAction: appointmentsVisible
      ? `Nuov${appointmentLabel.endsWith("a") ? "a" : "o"} ${appointmentLabel.toLowerCase()}`
      : clientsVisible
        ? `Apri ${pluralLabel(clientLabel).toLowerCase()}`
        : "Chiedi a Mavi",
    summary: mode === "appointment"
      ? `${appointmentLabel} e agenda in primo piano`
      : mode === "walk-in"
        ? "Clienti e operatività rapida in primo piano"
        : mode === "none"
          ? "Gestione attività senza agenda"
          : "Agenda e operatività quotidiana bilanciate"
  };
}
