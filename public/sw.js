// Service worker de Bella: muestra los avisos Web Push y abre el lead al tocarlos.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Bella", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || "Bella", {
        body: data.body || "",
        tag: data.tag,
        renotify: Boolean(data.tag),
        data: { url: data.url || "/notifications" },
      }),
      // Avisa a las pestañas abiertas para que actualicen el contador.
      self.clients.matchAll({ type: "window" }).then((tabs) => tabs.forEach((t) => t.postMessage("notification"))),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/notifications", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      const tab = tabs.find((t) => new URL(t.url).origin === self.location.origin);
      if (tab) return tab.focus().then((t) => (t ?? tab).navigate(url)).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});
