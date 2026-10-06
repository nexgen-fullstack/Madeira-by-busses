import { isNative, platform } from './device.ts';

/**
 * Hands a file the app made (a printable timetable) to the person: save it,
 * print it or send it on. The website uses the browser's download, print and
 * share; the Android app uses its own "Documents" plugin, because a web view
 * can do none of the three.
 */

interface DocumentsPlugin {
  save(options: { data: string; fileName: string; mimeType: string }): Promise<{ saved: boolean }>;
  print(options: { data: string; fileName: string }): Promise<void>;
  share(options: {
    data: string;
    fileName: string;
    mimeType: string;
    title: string;
  }): Promise<void>;
}

let documents: Promise<{ plugin: DocumentsPlugin }> | undefined;
/**
 * The plugin, wrapped: a promise (or async function) resolved with the plugin
 * itself asks it for `then`, as with any value, which a Capacitor plugin takes
 * for a call to a native method "then" that does not exist, and the promise never
 * settles. That left every save, print and share in the app spinning.
 */
const native = () =>
  (documents ??= import('@capacitor/core').then(({ registerPlugin }) => ({
    plugin: registerPlugin<DocumentsPlugin>('Documents'),
  })));

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

const blobOf = (bytes: Uint8Array, mimeType: string) =>
  new Blob([bytes as BlobPart], { type: mimeType });

/** Saves the file: the system's "save as" in the app, a download on the website. */
export async function saveFile(
  bytes: Uint8Array,
  fileName: string,
  mimeType = 'application/pdf',
): Promise<boolean> {
  if (isNative()) {
    const { plugin } = await native();
    return (await plugin.save({ data: base64(bytes), fileName, mimeType })).saved;
  }
  const url = URL.createObjectURL(blobOf(bytes, mimeType));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  // Some browsers read the file after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** Whether printing works here: the Android app, or a desktop browser with a PDF viewer. */
export function canPrint(): boolean {
  if (isNative()) return platform() === 'android';
  return (
    typeof matchMedia !== 'undefined' &&
    matchMedia('(pointer: fine)').matches &&
    (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false
  );
}

/** Opens the print dialog for a PDF (which can also save it as a PDF). */
export async function printPdf(bytes: Uint8Array, fileName: string): Promise<void> {
  if (isNative()) {
    await (await native()).plugin.print({ data: base64(bytes), fileName });
    return;
  }
  const url = URL.createObjectURL(blobOf(bytes, 'application/pdf'));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
  frame.title = fileName;
  frame.src = url;
  const done = () => {
    frame.remove();
    URL.revokeObjectURL(url);
  };
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      // The browser keeps its PDF viewer to itself: open the file instead.
      window.open(url, '_blank', 'noopener');
    }
    // The dialog blocks until closed in most browsers; keep the frame a while for the others.
    window.setTimeout(done, 120_000);
  };
  document.body.append(frame);
}

/** Whether the file can go to the share sheet (messages, mail, drive…). */
export function canShareFiles(): boolean {
  if (isNative()) return platform() === 'android';
  try {
    const probe = new File([new Uint8Array(1)], 'probe.pdf', { type: 'application/pdf' });
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** Opens the share sheet with the file; false when the person closed it. */
export async function shareFile(
  bytes: Uint8Array,
  fileName: string,
  title: string,
  mimeType = 'application/pdf',
): Promise<boolean> {
  if (isNative()) {
    await (await native()).plugin.share({ data: base64(bytes), fileName, mimeType, title });
    return true;
  }
  try {
    await navigator.share({
      files: [new File([bytes as BlobPart], fileName, { type: mimeType })],
      title,
    });
    return true;
  } catch {
    return false;
  }
}
