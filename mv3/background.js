// Test printer provider. Registers a single virtual printer and logs whatever
// the browser's print manager hands it. Byte-identical in the mv2 and mv3
// builds -- keep it that way, the point is that manifest version is the only
// variable between them.
//
// Instrumented to answer one question: when the printer fails to appear in the
// print destination list, is that because onGetPrintersRequested never fired,
// or because it fired and the result was rejected? Those have different causes,
// and the trace distinguishes them.

trace('background.js executing');

const PRINTER_ID = 'printer';

// Declaring only application/pdf guarantees the print manager sends PDF.
// Adding "image/pwg-raster" here would let it choose raster instead.
const CONTENT_TYPE = 'application/pdf';

// CDD: https://developers.google.com/cloud-print/docs/cdd#cdd
// Only the sections that produce actual print-ticket options are listed.
// Hardware-description sections (marker, input_tray_unit, cover) are omitted
// because they show up nowhere in print preview.
const CAPABILITIES = {
    version: '1.0',
    printer: {
        supported_content_type: [
            { content_type: CONTENT_TYPE }
        ],
        color: {
            option: [
                { type: 'STANDARD_MONOCHROME' },
                { type: 'STANDARD_COLOR', is_default: true },
                {
                    vendor_id: 'ultra-color',
                    type: 'CUSTOM_COLOR',
                    custom_display_name: 'Best Color'
                }
            ]
        },
        copies: {
            default: 1,
            max: 100
        },
        page_orientation: {
            option: [
                { type: 'PORTRAIT', is_default: true },
                { type: 'LANDSCAPE' },
                { type: 'AUTO' }
            ]
        },
        dpi: {
            option: [
                { horizontal_dpi: 300, vertical_dpi: 300, is_default: true },
                { horizontal_dpi: 600, vertical_dpi: 600 }
            ]
        },
        duplex: {
            option: [
                { type: 'NO_DUPLEX', is_default: true },
                { type: 'LONG_EDGE' },
                { type: 'SHORT_EDGE' }
            ]
        },
        collate: {
            default: true
        },
        margins: {
            option: [
                {
                    type: 'STANDARD',
                    top_microns: 5000,
                    right_microns: 5000,
                    bottom_microns: 5000,
                    left_microns: 5000,
                    is_default: true
                },
                {
                    type: 'BORDERLESS',
                    top_microns: 0,
                    right_microns: 0,
                    bottom_microns: 0,
                    left_microns: 0
                }
            ]
        },
        media_size: {
            option: [
                {
                    name: 'ISO_A4',
                    width_microns: 210000,
                    height_microns: 297000,
                    is_default: true
                },
                {
                    name: 'NA_LEGAL',
                    width_microns: 215900,
                    height_microns: 355600
                },
                {
                    name: 'NA_LETTER',
                    width_microns: 215900,
                    height_microns: 279400
                }
            ]
        }
    }
};

// Chunked so a large document doesn't blow the argument limit of
// String.fromCharCode.
function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

traceEnvironment();
tracePermissions();

// Registering only after confirming the API object exists -- otherwise the
// throw from addListener would mask the real cause.
if (traceApiSurface()) {

    traceRegister('onGetPrintersRequested', chrome.printerProvider.onGetPrintersRequested,
        function (resultCallback) {
            trace('onGetPrintersRequested FIRED');

            const printers = [
                {
                    id: PRINTER_ID,
                    name: 'Testprinter',
                    description: 'Logs the received document to the background console'
                }
            ];

            try {
                resultCallback(printers);
                trace('onGetPrintersRequested resolved', printers);
            } catch (error) {
                traceError('onGetPrintersRequested resultCallback threw', String(error));
            }
        });

    traceRegister('onGetCapabilityRequested', chrome.printerProvider.onGetCapabilityRequested,
        function (printerId, resultCallback) {
            trace('onGetCapabilityRequested FIRED', { printerId: printerId });

            if (printerId !== PRINTER_ID) {
                // No error channel on this event, so an empty CDD is the only
                // way to signal "nothing to offer".
                traceError('onGetCapabilityRequested unknown printer', { printerId: printerId });
                resultCallback({});
                return;
            }

            try {
                resultCallback(CAPABILITIES);
                trace('onGetCapabilityRequested resolved');
            } catch (error) {
                traceError('onGetCapabilityRequested resultCallback threw', String(error));
            }
        });

    traceRegister('onPrintRequested', chrome.printerProvider.onPrintRequested,
        async function (job, resultCallback) {
            trace('onPrintRequested FIRED', {
                printerId: job.printerId,
                title: job.title,
                contentType: job.contentType,
                documentSize: job.document ? job.document.size : null,
                ticket: job.ticket
            });

            if (job.printerId !== PRINTER_ID) {
                traceError('onPrintRequested unknown printer', { printerId: job.printerId });
                resultCallback('FAILED');
                return;
            }

            if (job.contentType !== CONTENT_TYPE) {
                traceError('onPrintRequested unsupported content type', { contentType: job.contentType });
                resultCallback('INVALID_TICKET');
                return;
            }

            try {
                const buffer = await job.document.arrayBuffer();
                const base64 = toBase64(buffer);
                // Full base64 to the console only -- persisting it would blow
                // out the trace buffer.
                console.log(TAG, 'base64 doc', base64);
                trace('onPrintRequested document read', {
                    bytes: buffer.byteLength,
                    base64Preview: base64.slice(0, 64) + '...'
                });
                // Resolved only after the read completes -- resolving first lets
                // the service worker be torn down mid-read.
                resultCallback('OK');
                trace('onPrintRequested resolved', 'OK');
            } catch (error) {
                traceError('onPrintRequested document read failed', String(error));
                resultCallback('INVALID_DATA');
            }
        });

    // Registered purely as evidence. Without the "usb" permission this may fail
    // to register, and that outcome is itself informative.
    traceRegister('onGetUsbPrinterInfoRequested', chrome.printerProvider.onGetUsbPrinterInfoRequested,
        function (device, resultCallback) {
            trace('onGetUsbPrinterInfoRequested FIRED', device);
            resultCallback();
        });
}

// Proves whether the extension is being started at all, and separates a fresh
// install from a browser restart from an idle-worker wake-up.
if (chrome.runtime.onInstalled) {
    chrome.runtime.onInstalled.addListener(function (details) {
        trace('runtime.onInstalled', details);
    });
}

if (chrome.runtime.onStartup) {
    chrome.runtime.onStartup.addListener(function () {
        trace('runtime.onStartup');
    });
}

trace('background.js finished registering');
