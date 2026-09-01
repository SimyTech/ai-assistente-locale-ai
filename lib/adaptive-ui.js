const clean = value => String(value ?? "").trim();

function title(value, fallback) {
  const text = clean(value) || fallback;
  return text.charAt(0).toUpperCase() + text.slice(1);
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
      appointments: `${appointmentLabel}i`,
      client: clientLabel,
      clients: `${clientLabel}i`,
      service: serviceLabel,
      services: `${serviceLabel}i`
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
        ? `Apri ${clientLabel.toLowerCase()}i`
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
