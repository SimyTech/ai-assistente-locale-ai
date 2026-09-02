import { clientOwnsAppointment } from "./auth.js";

const clean = value => String(value ?? "").trim();

export function pickNextClientAppointment(appointments = [], identity = {}, today = "") {
  const threshold = clean(today);
  return (Array.isArray(appointments) ? appointments : [])
    .filter(appointment => {
      const status = clean(appointment?.status || "confirmed").toLowerCase();
      if (status !== "confirmed") return false;
      const date = clean(appointment?.date);
      if (!date || (threshold && date < threshold)) return false;
      return clientOwnsAppointment(appointment, identity);
    })
    .sort((a, b) => `${clean(a?.date)} ${clean(a?.time)}`.localeCompare(`${clean(b?.date)} ${clean(b?.time)}`))[0] || null;
}
