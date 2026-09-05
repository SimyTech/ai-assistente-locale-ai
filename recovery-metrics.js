(function (root) {
  "use strict";

  const RECOVERY_SOURCES = new Set(["smart-rebooking", "operational-recovery"]);
  const INACTIVE_STATUSES = new Set(["cancelled", "no_show", "no-show", "assente"]);

  function clean(value) {
    return String(value ?? "").trim();
  }

  function key(value) {
    return clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function timestamp(value) {
    const parsed = Date.parse(clean(value));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function contactTime(client) {
    return Math.max(
      timestamp(client?.recoveryContactedAt),
      timestamp(client?.rebookingContactedAt)
    );
  }

  function bookingTime(appointment) {
    return timestamp(
      appointment?.createdAt || appointment?.bookedAt || appointment?.updatedAt
    );
  }

  function sameClient(client, appointment) {
    const clientId = clean(client?.id);
    const appointmentClientId = clean(appointment?.clientId);
    if (clientId && appointmentClientId) return clientId === appointmentClientId;
    return Boolean(key(client?.name) && key(client?.name) === key(appointment?.name));
  }

  function isRecoveryBooking(appointment) {
    return RECOVERY_SOURCES.has(clean(appointment?.source)) &&
      !INACTIVE_STATUSES.has(key(appointment?.status || "confirmed"));
  }

  function recoveryConversionMetrics(clients, appointments, options = {}) {
    const now = timestamp(options.now) || Date.now();
    const windowDays = Math.max(1, Number(options.windowDays) || 30);
    const cutoff = now - windowDays * 86400000;
    const contactedClients = (Array.isArray(clients) ? clients : [])
      .map(client => ({ client, contactedAt: contactTime(client) }))
      .filter(item => item.contactedAt >= cutoff && item.contactedAt <= now);
    const bookings = (Array.isArray(appointments) ? appointments : [])
      .filter(isRecoveryBooking);
    const convertedClients = contactedClients.filter(({ client, contactedAt }) =>
      bookings.some(appointment => {
        const createdAt = bookingTime(appointment);
        return sameClient(client, appointment) && createdAt >= contactedAt && createdAt <= now;
      })
    );

    const contacts = contactedClients.length;
    const conversions = convertedClients.length;
    return {
      contacts,
      conversions,
      conversionRate: contacts ? Math.round(conversions / contacts * 100) : 0
    };
  }

  root.maviriRecoveryMetrics = recoveryConversionMetrics;

  if (typeof document !== "undefined") {
    import("/mavi-chat-link.js")
      .then(module => module.installMaviChatLink?.(document, root))
      .catch(() => {});
  }
})(globalThis);
