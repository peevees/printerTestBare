# printerTestBare

A minimal `chrome.printerProvider` test extension, built to demonstrate that
Edge never dispatches the `printerProvider` events. It registers one virtual
printer named **Testprinter** and traces every stage of the handshake — API
availability, permission grant, listener registration, and each event firing —
so you can see exactly where the chain stops.

Filed as [microsoft/MicrosoftEdge-Extensions#741](https://github.com/microsoft/MicrosoftEdge-Extensions/issues/741).

**Summary of the finding:** in Edge, all listeners register successfully
(`hasListener: true`) and the permission is granted, but the events are never
dispatched and Testprinter never appears in the print destination list. The
byte-identical extension works in Chrome on the same machine.

## Download

Grab a ZIP from the [latest release](https://github.com/peevees/printerTestBare/releases/latest),
or download the whole repo as a ZIP with the green **Code → Download ZIP**
button and unzip it.

**Important: load the `mv3` (or `mv2`) folder, not the repo root.** The repo root
holds no manifest — each build lives in its own subfolder.

| Folder | Manifest | Background | Use |
| --- | --- | --- | --- |
| `mv3/` | v3 | service worker | The main repro |
| `mv2/` | v2 | persistent page | Control — rules out service worker lifetime |

`trace.js` and `background.js` are byte-identical in the two folders. The
manifests differ only in `manifest_version` and the background entry mechanism,
so manifest version is the only variable between them.

## Loading it

1. Go to `edge://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped **`mv3`** folder.
4. On the extension's card, click **Inspect views: service worker** to open the
   background console. In `mv2` this reads **background page** instead.

Load one folder at a time — both register a printer named "Testprinter".

> **`service worker (Inactive)` on the card is normal.** An MV3 worker is torn
> down when idle. Clicking **service worker** starts it and opens its console.
> The whole point of `printerProvider` is that the event should wake it.

## Reproducing

1. With the background console open, open any web page.
2. Press **`Ctrl+P`**. Use `Ctrl+P`, not `Ctrl+Shift+P` — the latter opens the
   Windows system print dialog, which never enumerates extension printers.
3. Open the printer/destination dropdown. In Chrome, click **See more** to reach
   the full **Select a destination** dialog.
4. Look in the background console for `onGetPrintersRequested FIRED`.

If the console was closed or the worker restarted, run **`dumpTrace()`** in the
background console — the trace is mirrored to `chrome.storage.local`, so it
survives a worker teardown and prints as a table plus copy-pasteable JSON.
`clearTrace()` resets it between attempts.

## What you should see

Both browsers log an identical, healthy startup block:

```text
[ptest SW] worker started 2026-… Mozilla/5.0 …
[ptest SW] trace.js OK
[ptest SW] background.js OK
[ptest] … env {manifestVersion: 3, …}
[ptest] … api.available {onGetPrintersRequested: 'object', onGetCapabilityRequested: 'object',
                         onPrintRequested: 'object', onGetUsbPrinterInfoRequested: 'object'}
[ptest] … register.done {event: 'onGetPrintersRequested',   hasListener: true}
[ptest] … register.done {event: 'onGetCapabilityRequested', hasListener: true}
[ptest] … register.done {event: 'onPrintRequested',         hasListener: true}
[ptest] … permissions.printerProvider {granted: true}
```

**Chrome — expected, and what actually happens there.** Opening print preview
appends:

```text
[ptest] … onGetPrintersRequested FIRED
[ptest] … onGetPrintersRequested resolved [{…}]
[ptest] … onGetCapabilityRequested FIRED {printerId: 'printer'}
[ptest] … onGetCapabilityRequested resolved
```

and **Testprinter** appears in the destination list, with its description and
the owning extension's name beside it.

**Edge — the bug.** Nothing is appended. No `FIRED` line, no error, no warning,
in the background console or on the extensions page. The dropdown lists only
local and PDF destinations, and Testprinter is absent.

That difference — same bytes, same machine, same session — is the whole report.

## What this rules out

- **Extension code.** The identical scripts work in Chrome.
- **Manifest version.** `mv2` and `mv3` behave the same way in Edge.
- **Service worker lifetime.** It reproduces on `mv2`'s persistent background
  page, and the `mv3` worker logs `install`, `activate` and `runtime.onInstalled`
  normally.
- **Permission or API availability.** The trace shows `granted: true` and all
  four events registered with `hasListener: true`. `printerProvider` carries no
  `platforms` or `required_buildflags` restriction in Chromium's
  `_api_features.json`.
- **System print dialog.** Edge's own in-browser print preview is in use, not
  the Windows dialog.
- **Print policy.** `PrinterTypeDenyList` is not set. `edge://policy` shows no
  policy restricting printer discovery.

## Capabilities returned

[CDD](https://developers.google.com/cloud-print/docs/cdd#cdd) declared by
`onGetCapabilityRequested`: `color`, `copies`, `page_orientation`, `dpi`,
`duplex`, `collate`, `margins`, `media_size`.

`supported_content_type` declares `application/pdf` only, so the print manager
always sends PDF rather than choosing `image/pwg-raster`. Printing to Testprinter
logs the ticket, the byte count and the base64 of the received PDF to the
background console. Nothing is uploaded anywhere.
