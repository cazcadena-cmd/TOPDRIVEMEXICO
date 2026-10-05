/* TOPDRIVE Web Push service worker. It must live beside index.html. */
const APP_SCOPE = (self.registration && self.registration.scope) || new URL('./', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function leerDatosPush(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch (e) {
    return { body: event.data.text() };
  }
}

function datosNotificacion(payload) {
  const anidado = payload.notification && typeof payload.notification === 'object'
    ? payload.notification
    : {};
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const viajeId = payload.viaje_id || data.viaje_id || payload.id || data.id || null;
  const estado = payload.estado || data.estado || null;
  const tipo = payload.tipo || data.tipo || (viajeId ? (estado ? 'push-estado' : 'push-viaje') : '');
  const rol = payload.rol || data.rol || 'pasajero';
  let url = payload.url || data.url || '';

  if (!url && viajeId) {
    url = new URL('viaje.html?id=' + encodeURIComponent(viajeId) + '&rol=' + encodeURIComponent(rol), APP_SCOPE).href;
  }
  if (!url) url = new URL('./', APP_SCOPE).href;

  return {
    title: payload.title || anidado.title || 'TOPDRIVE',
    body: payload.body || payload.message || anidado.body || data.body || 'Tienes una actualización en TOPDRIVE.',
    url,
    viajeId,
    tipo,
    options: Object.assign({}, anidado, payload.options || {}, {
      body: payload.body || payload.message || anidado.body || data.body || 'Tienes una actualización en TOPDRIVE.',
      icon: payload.icon || anidado.icon || new URL('icon-192.png', APP_SCOPE).href,
      badge: payload.badge || anidado.badge || new URL('icon-192.png', APP_SCOPE).href,
      tag: payload.tag || anidado.tag || (viajeId ? 'topdrive-viaje-' + viajeId : 'topdrive-aviso'),
      renotify: false,
      data: Object.assign({}, data, { url, viaje_id: viajeId, tipo, estado })
    })
  };
}

self.addEventListener('push', (event) => {
  const payload = leerDatosPush(event);
  const aviso = datosNotificacion(payload);
  const mostrar = self.registration.showNotification(aviso.title, aviso.options);
  const avisarPagina = self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientes) => clientes.forEach((cliente) => cliente.postMessage({
      tipo: aviso.tipo || 'push-estado',
      viaje_id: aviso.viajeId,
      estado: payload.estado || (payload.data && payload.data.estado) || null,
      url: aviso.url
    })));

  event.waitUntil(Promise.all([mostrar, avisarPagina]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const destino = data.url || new URL('./', APP_SCOPE).href;

  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientes) => {
    for (const cliente of clientes) {
      if (cliente.url.startsWith(self.location.origin)) {
        cliente.postMessage({
          tipo: 'abrir-viaje',
          viaje_id: data.viaje_id || null,
          estado: data.estado || null
        });
        return cliente.focus().then(() => cliente.navigate(destino));
      }
    }
    return self.clients.openWindow(destino);
  }));
});
