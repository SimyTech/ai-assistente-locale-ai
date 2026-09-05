(function (root) {
  "use strict";

  const RECOVERY_SOURCES = new Set(["smart-rebooking", "operational-recovery"]);
  const INACTIVE_STATUSES = new Set(["cancelled", "no_show", "no-show", "assente"]);
  const OFFICIAL_LOGO = "/maviri-logo.svg";

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

  function applyOfficialBrandToFrame() {
    const frame = document.getElementById("appFrame");
    if (!frame) return;
    try {
      const doc = frame.contentDocument;
      if (!doc) return;
      doc.querySelectorAll("img.logo").forEach(img => {
        img.src = OFFICIAL_LOGO;
        img.alt = "Maviri";
      });
      const brand = doc.querySelector(".brand");
      if (brand && !doc.getElementById("maviri-official-brand-style")) {
        const style = doc.createElement("style");
        style.id = "maviri-official-brand-style";
        style.textContent = ".brand{justify-content:flex-start}.brand .logo{width:88px;height:88px;border-radius:22px;object-fit:cover;box-shadow:0 12px 34px rgba(0,0,0,.28)}.brand .brand-name,.brand .brand-sub{display:none}";
        doc.head.appendChild(style);
      }
    } catch {}
  }

  root.maviriRecoveryMetrics = recoveryConversionMetrics;

  if (typeof document !== "undefined") {
    document.querySelector('.context-actions a[href="/account"][aria-label="Gestisci account"]')?.remove();
    const frame = document.getElementById("appFrame");
    if (frame) {
      frame.addEventListener("load", () => {
        applyOfficialBrandToFrame();
        setTimeout(applyOfficialBrandToFrame, 250);
      });
    }
    import("/mavi-chat-link.js")
      .then(module => module.installMaviChatLink?.(document, root))
      .catch(() => {});
  }
})(globalThis);
