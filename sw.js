/* TOPDRIVE Web Push service worker. Debe estar junto a index.html, app.html y viaje.html. */
'use strict';

const APP_SCOPE = (self.registration && self.registration.scope) || new URL('./', self.location.href).href;
const ICONO = new URL('icon-192.png', APP_SCOPE).href;
const INICIO = new URL('./index.html', APP_SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* Evento FETCH: ayuda a que Android/Chrome ofrezca instalar la app.
   Solo atiende peticiones GET de este mismo sitio; Supabase, Google Maps, etc. pasan directo.
   Si no hay red, devuelve un error de red válido (antes devolvía "undefined" y rompía la página). */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).catch((err) => {
      console.warn('[SW] Red no disponible:', err);
      if (req.mode === 'navigate') {
        return new Response(
          '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>TOPDRIVE · Sin conexión</title></head>' +
          '<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#121212;color:#f8f9fa;font-family:sans-serif;text-align:center;padding:24px">' +
          '<div><h1 style="color:#FED700;margin:0 0 8px">TOPDRIVE</h1><p>Sin conexión a internet.<br>Revisa tu red e inténtalo de nuevo.</p></div></body></html>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
      return Response.error();
    })
  );
});

function leerDatosPush(event) {
  if (!event.data) return {};
  try {
    return event.data.json() || {};
  } catch (e) {
    const texto = event.data.text();
    try { return JSON.parse(texto) || {}; } catch (e2) { return { body: texto }; }
  }
}

/* Unifica los nombres de tipo que pueda enviar el servidor con los que entiende app.html */
function normalizarTipo(tipo, viajeId, estado) {
  if (tipo === 'nuevo_viaje' || tipo === 'push-viaje') return 'push-viaje';
  if (tipo === 'estado_viaje' || tipo === 'push-estado') return 'push-estado';
  if (tipo) return tipo;
  return viajeId ? (estado ? 'push-estado' : 'push-viaje') : '';
}

function datosNotificacion(payload) {
  const anidado = payload.notification && typeof payload.notification === 'object' ? payload.notification : {};
  const data = Object.assign({}, payload.data && typeof payload.data === 'object' ? payload.data : {},
    anidado.data && typeof anidado.data === 'object' ? anidado.data : {});
  const viajeId = payload.viaje_id || data.viaje_id || payload.id || data.id || null;
  const estado = payload.estado || data.estado || null;
  const tipo = normalizarTipo(payload.tipo || data.tipo || anidado.tipo, viajeId, estado);
  const rol = payload.rol || data.rol || (tipo === 'push-viaje' ? 'conductor' : 'pasajero');
  let url = payload.url || data.url || anidado.url || '';

  // Solicitud nueva para el conductor → su panel; cambio de estado → seguimiento del viaje
  if (!url && tipo === 'push-viaje') url = new URL('app.html', APP_SCOPE).href;
  if (!url && viajeId) {
    url = new URL('viaje.html?id=' + encodeURIComponent(viajeId) + '&rol=' + encodeURIComponent(rol), APP_SCOPE).href;
  }
  if (!url) url = INICIO;

  const cuerpo = payload.body || payload.message || payload.mensaje || anidado.body || data.body || 'Tienes una actualización en TOPDRIVE.';

  return {
    title: payload.title || anidado.title || 'TOPDRIVE',
    url,
    viajeId,
    tipo,
    estado,
    options: Object.assign({}, anidado, payload.options || {}, {
      body: cuerpo,
      icon: payload.icon || anidado.icon || ICONO,
      badge: payload.badge || anidado.badge || ICONO,
      tag: payload.tag || anidado.tag || (viajeId ? 'topdrive-viaje-' + viajeId : 'topdrive-aviso'),
      renotify: !!(payload.renotify || anidado.renotify),
      requireInteraction: !!(payload.requireInteraction || anidado.requireInteraction || tipo === 'push-viaje'),
      vibrate: payload.vibrate || anidado.vibrate || [250, 100, 250, 100, 400],
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
      estado: aviso.estado,
      url: aviso.url
    })));

  event.waitUntil(Promise.all([mostrar, avisarPagina]));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let destino;
  try {
    destino = new URL(data.url || INICIO, APP_SCOPE);
    if (destino.origin !== self.location.origin) destino = new URL(INICIO);
  } catch (e) {
    destino = new URL(INICIO);
  }

  event.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const cliente of clientes) {
      if (!cliente.url.startsWith(APP_SCOPE)) continue;
      cliente.postMessage({ tipo: 'abrir-viaje', viaje_id: data.viaje_id || null, estado: data.estado || null });
      try {
        await cliente.focus();
        if (cliente.url !== destino.href && cliente.navigate) await cliente.navigate(destino.href);
        return;
      } catch (e) {
        // Si la pestaña no se puede reutilizar, se abre una nueva
        break;
      }
    }
    await self.clients.openWindow(destino.href);
  })());
});

/* Si el navegador renueva la suscripción, se pide a la app que la vuelva a registrar en Supabase */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientes) => {
    clientes.forEach((cliente) => cliente.postMessage({ tipo: 'renovar-push' }));
  }));
});
