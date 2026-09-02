// Trace buffer shared by the mv2 and mv3 builds -- this file is byte-identical
// in both. Every entry goes to the background console AND to chrome.storage.local,
// so the record survives an MV3 service worker teardown. Read it back with
// dumpTrace() from the background console.
//
// Callback-style storage calls throughout: chrome.* promise support is MV3-only,
// so callbacks are the only form that works in both builds.

const TAG = '[ptest]';
const TRACE_KEY = 'trace';
const TRACE_MAX = 500;

function traceStamp() {
    return new Date().toISOString();
}

function tracePersist(entry) {
    try {
        chrome.storage.local.get(TRACE_KEY, function (stored) {
            if (chrome.runtime.lastError) {
                console.warn(TAG, 'trace read failed', chrome.runtime.lastError.message);
                return;
            }
            const entries = Array.isArray(stored[TRACE_KEY]) ? stored[TRACE_KEY] : [];
            entries.push(entry);
            if (entries.length > TRACE_MAX) {
                entries.splice(0, entries.length - TRACE_MAX);
            }
            chrome.storage.local.set({ [TRACE_KEY]: entries });
        });
    } catch (error) {
        console.warn(TAG, 'chrome.storage unavailable -- trace is console-only', error);
    }
}

function trace(event, detail) {
    const entry = { t: traceStamp(), event: event };
    if (detail !== undefined) entry.detail = detail;
    console.log(TAG, entry.t, event, detail !== undefined ? detail : '');
    tracePersist(entry);
}

function traceError(event, detail) {
    const entry = { t: traceStamp(), event: event, error: true };
    if (detail !== undefined) entry.detail = detail;
    console.error(TAG, entry.t, event, detail !== undefined ? detail : '');
    tracePersist(entry);
}

// Which browser, which build, and what the manifest actually asked for.
function traceEnvironment() {
    const manifest = chrome.runtime.getManifest();
    trace('env', {
        manifestVersion: manifest.manifest_version,
        extensionId: chrome.runtime.id,
        userAgent: navigator.userAgent,
        brands: navigator.userAgentData ? navigator.userAgentData.brands : 'userAgentData unavailable',
        declaredPermissions: manifest.permissions
    });
}

// Does the API object exist in this context, and does each event exist on it?
// If printerProvider is undefined the permission was dropped or the API is not
// exposed -- nothing downstream can possibly fire.
function traceApiSurface() {
    if (chrome.printerProvider === undefined) {
        traceError('api.undefined', 'chrome.printerProvider is not exposed in this context');
        return false;
    }

    trace('api.available', {
        onGetPrintersRequested: typeof chrome.printerProvider.onGetPrintersRequested,
        onGetCapabilityRequested: typeof chrome.printerProvider.onGetCapabilityRequested,
        onPrintRequested: typeof chrome.printerProvider.onPrintRequested,
        onGetUsbPrinterInfoRequested: typeof chrome.printerProvider.onGetUsbPrinterInfoRequested
    });
    return true;
}

// A required permission the browser silently refused would show up here as
// granted:false, which the manifest alone cannot tell us.
function tracePermissions() {
    if (!chrome.permissions || typeof chrome.permissions.contains !== 'function') {
        traceError('permissions.api.unavailable');
        return;
    }

    chrome.permissions.contains({ permissions: ['printerProvider'] }, function (granted) {
        if (chrome.runtime.lastError) {
            traceError('permissions.contains.failed', chrome.runtime.lastError.message);
            return;
        }
        if (granted) {
            trace('permissions.printerProvider', { granted: true });
        } else {
            traceError('permissions.printerProvider', { granted: false });
        }
    });

    chrome.permissions.getAll(function (all) {
        trace('permissions.getAll', all ? all.permissions : all);
    });
}

// addListener returning without throwing does not prove registration took --
// hasListener does.
function traceRegister(name, event, handler) {
    if (!event || typeof event.addListener !== 'function') {
        traceError('register.unavailable', name);
        return;
    }

    trace('register.begin', name);
    try {
        event.addListener(handler);
        trace('register.done', { event: name, hasListener: event.hasListener(handler) });
    } catch (error) {
        traceError('register.failed', { event: name, error: String(error) });
    }
}

// Called from the background console.
function dumpTrace() {
    chrome.storage.local.get(TRACE_KEY, function (stored) {
        const entries = Array.isArray(stored[TRACE_KEY]) ? stored[TRACE_KEY] : [];
        console.log(TAG, 'trace holds', entries.length, 'entries');
        console.table(entries.map(function (e) {
            return {
                t: e.t,
                event: e.event,
                error: e.error === true,
                detail: e.detail === undefined ? '' : JSON.stringify(e.detail)
            };
        }));
        // Copy-pasteable for pasting into a bug report.
        console.log(TAG, 'raw:', JSON.stringify(entries, null, 2));
    });
}

function clearTrace() {
    chrome.storage.local.remove(TRACE_KEY, function () {
        console.log(TAG, 'trace cleared');
    });
}

// Reachable from the console in both builds.
self.dumpTrace = dumpTrace;
self.clearTrace = clearTrace;

// MV3 gets "trace.js OK" / "background.js FAILED" from the worker wrapper's
// try/catch. MV2 loads its scripts from the manifest and cannot wrap them, so
// this line plus background.js's own "executing" line give the same evidence:
// this one without the next means background.js failed to parse.
console.log(TAG, traceStamp(), 'trace.js loaded');
