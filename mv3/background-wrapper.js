// MV3 service worker entry point. Each importScripts is wrapped so a parse
// error or throw in one file is visible rather than silently killing worker
// startup.
//
// The worker-started line is the key lifecycle signal -- if it appears when you
// open print preview but no "onGetPrintersRequested FIRED" line follows, the
// worker was woken and the event still was not dispatched.

const SW_START = Date.now();
console.log('[ptest SW] worker started', new Date(SW_START).toISOString(), navigator.userAgent);

self.addEventListener('install', function (event) {
    event.waitUntil(self.skipWaiting());
    console.log('[ptest SW] install');
});

self.addEventListener('activate', function () {
    console.log('[ptest SW] activate');
});

try {
    importScripts('trace.js');
    console.log('[ptest SW] trace.js OK');
} catch (error) {
    console.error('[ptest SW] trace.js FAILED', error);
}

try {
    importScripts('background.js');
    console.log('[ptest SW] background.js OK');
} catch (error) {
    console.error('[ptest SW] background.js FAILED', error);
}
