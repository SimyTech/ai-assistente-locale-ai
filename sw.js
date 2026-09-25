self.addEventListener("push", event => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || "Maviri", { body: "Hai una nuova prenotazione. Apri Maviri per i dettagli.", icon: "/maviri-logo.jpg", badge: "/maviri-logo.jpg", data: { url: data.url || "/app" } }));
});
self.addEventListener("notificationclick", event => { event.notification.close(); event.waitUntil(clients.openWindow(event.notification.data?.url || "/app")); });
