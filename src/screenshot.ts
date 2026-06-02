/**
 * `@overengineered-solutions/capture` opt-in masked screenshot.
 *
 * OFF by default — nothing here runs (and `modern-screenshot` is never loaded)
 * unless the user clicks "Attach screenshot". The lib is pulled via a dynamic
 * `import()` so it lands in its own chunk; apps that never attach a screenshot
 * pay ~nothing for it.
 *
 * Before rasterizing, we apply REDACTION: a `.oescap-redacting` class is toggled
 * on `<html>` so the rendered values of form fields (input/textarea/select,
 * especially password fields) and any `[data-capture-redact]` element paint as
 * solid blocks (see `styles.ts`). The class is always removed in a `finally`, so
 * a capture failure never leaves the page redacted.
 *
 * The package is storage-agnostic: it produces a Blob and the host's report
 * action uploads it (the Blob is appended to the report FormData as `screenshot`).
 */

/** Class toggled on <html> during capture to mask sensitive content. */
export const REDACTING_CLASS = 'oescap-redacting';

/**
 * Class toggled on <html> during capture to hide the bubble's own chrome, so
 * the screenshot shows the page being reported (not the open report dialog).
 */
export const CAPTURING_CLASS = 'oescap-capturing';

export type CaptureScreenshotResult = {
  blob: Blob;
  /** A `data:` URL suitable for an <img> thumbnail preview. */
  dataUrl: string;
  width: number;
  height: number;
};

/** The slice of `modern-screenshot` we use (kept local so we need no types dep). */
type ModernScreenshot = {
  domToBlob: (node: Node, options?: Record<string, unknown>) => Promise<Blob>;
};

/**
 * Toggle the redaction class on `<html>`. Exported for direct unit testing of
 * the on/off contract (DOM-light). Returns whether the class is now present.
 */
export function setRedaction(on: boolean, root?: { classList: DOMTokenList }): boolean {
  const el =
    root ?? (typeof document !== 'undefined' ? document.documentElement : undefined);
  if (!el) return false;
  if (on) el.classList.add(REDACTING_CLASS);
  else el.classList.remove(REDACTING_CLASS);
  return el.classList.contains(REDACTING_CLASS);
}

/** Convert a Blob to a `data:` URL (for the thumbnail preview). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Rasterize the page to a redacted PNG Blob.
 *
 * Steps: dynamic-import `modern-screenshot` → toggle redaction on `<html>` →
 * `domToBlob(document.documentElement)` → build a preview data URL → remove the
 * redaction class (in `finally`). Throws on any failure; the caller surfaces a
 * non-fatal inline error and lets the report send without the shot.
 */
export async function captureMaskedScreenshot(): Promise<CaptureScreenshotResult> {
  if (typeof document === 'undefined') {
    throw new Error('screenshot capture requires a browser document');
  }

  // Dynamic import keeps modern-screenshot out of the main chunk. The literal
  // is wrapped so bundlers that can't resolve an optional dep at build time
  // (it's a real dependency, so they should) still degrade gracefully.
  const mod = (await import('modern-screenshot')) as unknown as ModernScreenshot;

  const target = document.documentElement ?? document.body;
  if (!target) throw new Error('no document element to capture');

  const html = document.documentElement;
  setRedaction(true);
  // Hide our own chrome so the shot shows the page, not the open dialog.
  html?.classList.add(CAPTURING_CLASS);
  try {
    // modern-screenshot clones the live DOM and inlines each node's COMPUTED
    // style — so the `.oescap-redacting` rules already in effect on the page
    // are baked into the captured image; we don't need to re-pass the CSS.
    const blob = await mod.domToBlob(target, {
      font: false,
      features: { restoreScrollPosition: true },
    });
    if (!blob) throw new Error('rasterizer returned no image');
    const dataUrl = await blobToDataUrl(blob);
    return {
      blob,
      dataUrl,
      width: typeof window !== 'undefined' ? window.innerWidth : 0,
      height: typeof window !== 'undefined' ? window.innerHeight : 0,
    };
  } finally {
    // ALWAYS restore, even if rasterization threw.
    setRedaction(false);
    html?.classList.remove(CAPTURING_CLASS);
  }
}
