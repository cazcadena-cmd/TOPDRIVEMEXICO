'use strict';

const APP_NAME = 'TOPDRIVE';
const FALLBACK_ICON = new URL('icon-192.png', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function readPushPayload(event) {
  if (!event.data) return {};
  try {
    return event.data.json();
  } catch (error) {
    const text = event.data.text();
    try {
      return JSON.parse(text);
    } catch (parseError) {
      return { body: text };
    }
  }
}

function normalizarEvento(tipo) {
  if (tipo === 'nuevo_viaje' || tipo === 'push-viaje') return 'push-viaje';
  if (tipo === 'estado_viaje' || tipo === 'push-estado') return 'push-estado';
  return tipo || '';
}

self.addEventListener('push', (event) => {
  const payload = readPushPayload(event);
  const notification = payload.notification && typeof payload.notification === 'object'
    ? payload.notification
    : payload;
  const data = Object.assign({}, payload.data || {}, notification.data || {});
  const tipo = normalizarEvento(data.tipo || payload.tipo || notification.tipo);
  const viajeId = data.viaje_id || payload.viaje_id || notification.viaje_id || null;
  const estado = data.estado || payload.estado || notification.estado || null;
  const url = data.url || payload.url || notification.url || self.registration.scope;
  const options = {
    body: notification.body || payload.body || payload.mensaje || '',
    icon: notification.icon || payload.icon || FALLBACK_ICON,
    badge: notification.badge || payload.badge || FALLBACK_ICON,
    tag: notification.tag || payload.tag || (viajeId ? 'topdrive-viaje-' + viajeId : 'topdrive-aviso'),
    renotify: !!(notification.renotify || payload.renotify),
    requireInteraction: !!(notification.requireInteraction || payload.requireInteraction),
    vibrate: notification.vibrate || payload.vibrate || [250, 100, 250],
    data: { url, tipo, viaje_id: viajeId, estado }
  };
  const title = notification.title || payload.title || APP_NAME;

  event.waitUntil((async () => {
    await self.registration.showNotification(title, options);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windows.forEach((client) => {
      client.postMessage({ tipo, viaje_id: viajeId, estado });
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let destination;
  try {
    destination = new URL(data.url || self.registration.scope, self.registration.scope);
    if (destination.origin !== self.location.origin) destination = new URL(self.registration.scope);
  } catch (error) {
    destination = new URL(self.registration.scope);
  }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (!client.url.startsWith(self.registration.scope)) continue;
      const focused = client.url === destination.href || !client.navigate
        ? client
        : await client.navigate(destination.href);
      if (focused) {
        await focused.focus();
        focused.postMessage({ tipo: 'abrir-viaje', viaje_id: data.viaje_id || null });
        return;
      }
    }
    await self.clients.openWindow(destination.href);
  })());
});

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    windows.forEach((client) => client.postMessage({ tipo: 'renovar-push' }));
  }));
});
