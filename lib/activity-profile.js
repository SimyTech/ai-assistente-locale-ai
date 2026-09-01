const clean = value => String(value ?? "").trim();

export const WORKFLOW_MODES = Object.freeze(["appointment", "walk-in", "mixed", "none"]);

export const ACTIVITY_PRESETS = Object.freeze({
  beauty: {
    sector: "beauty",
    workflowMode: "appointment",
    labels: { service: "Servizio", client: "Cliente", appointment: "Appuntamento" }
  },
  professional: {
    sector: "professional",
    workflowMode: "appointment",
    labels: { service: "Prestazione", client: "Cliente", appointment: "Appuntamento" }
  },
  health: {
    sector: "health",
    workflowMode: "appointment",
    labels: { service: "Prestazione", client: "Paziente", appointment: "Appuntamento" }
  },
  fitness: {
    sector: "fitness",
    workflowMode: "mixed",
    labels: { service: "Lezione/servizio", client: "Cliente", appointment: "Prenotazione" }
  },
  automotive: {
    sector: "automotive",
    workflowMode: "appointment",
    labels: { service: "Intervento", client: "Cliente", appointment: "Appuntamento" }
  },
  retail: {
    sector: "retail",
    workflowMode: "none",
    labels: { service: "Servizio/prodotto", client: "Cliente", appointment: "Prenotazione" }
  },
  hospitality: {
    sector: "hospitality",
    workflowMode: "mixed",
    labels: { service: "Servizio", client: "Ospite", appointment: "Prenotazione" }
  },
  generic: {
    sector: "generic",
    workflowMode: "mixed",
    labels: { service: "Servizio", client: "Cliente", appointment: "Prenotazione" }
  }
});

export function presetForSector(sector) {
  return ACTIVITY_PRESETS[clean(sector).toLowerCase()] || ACTIVITY_PRESETS.generic;
}

export function normalizeActivityProfile(input = {}) {
  const preset = presetForSector(input.sector);
  const workflowMode = WORKFLOW_MODES.includes(clean(input.workflowMode))
    ? clean(input.workflowMode)
    : preset.workflowMode;

  const labels = input.labels && typeof input.labels === "object" && !Array.isArray(input.labels)
    ? input.labels
    : {};

  return {
    version: 1,
    name: clean(input.name),
    sector: clean(input.sector).toLowerCase() || preset.sector,
    sectorLabel: clean(input.sectorLabel),
    description: clean(input.description),
    address: clean(input.address),
    phone: clean(input.phone),
    whatsapp: clean(input.whatsapp),
    email: clean(input.email).toLowerCase(),
    website: clean(input.website),
    workflowMode,
    labels: {
      service: clean(labels.service) || preset.labels.service,
      client: clean(labels.client) || preset.labels.client,
      appointment: clean(labels.appointment) || preset.labels.appointment
    },
    capabilities: {
      appointments: workflowMode !== "none",
      walkIns: workflowMode === "walk-in" || workflowMode === "mixed",
      services: input.capabilities?.services !== false,
      clients: input.capabilities?.clients !== false,
      promotions: input.capabilities?.promotions !== false,
      content: input.capabilities?.content !== false,
      whatsapp: input.capabilities?.whatsapp !== false,
      resources: input.capabilities?.resources === true
    },
    updatedAt: new Date().toISOString()
  };
}

export function activityProfileKey(tenantId) {
  return `maviri:tenant:${clean(tenantId).toLowerCase() || "default"}:activity-profile`;
}
