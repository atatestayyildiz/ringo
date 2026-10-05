// Ringo servis çalışanı: yalnız web push. Önbellek ve fetch yok.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Ringo";
  const options = {
    body: typeof data.body === "string" ? data.body : "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/bugun" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/bugun";
  event.waitUntil(
    (async () => {
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of list) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c && !c.url.endsWith(url)) {
            try {
              await c.navigate(url);
            } catch {
              // Farklı kapsamda gezinemezse yalnız odakla.
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// En iyi gayret: tarayıcı aboneliği yenilediyse oturum açık sayfa bir sonraki açılışta yeniden kaydeder.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) c.postMessage({ type: "pushsubscriptionchange" });
    }),
  );
});
