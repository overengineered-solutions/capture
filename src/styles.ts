/**
 * `@overengineered-solutions/capture` self-styling.
 *
 * v0.1.x painted the bubble with Tailwind utility classes baked into the dist
 * JS. But no consuming app scans `node_modules` in its Tailwind `content` /
 * `@source`, so those classes were never generated — the bubble lost all
 * positioning (fell to the top-left, unstyled) and looked different per app
 * (each app coincidentally generated a different subset of the utilities).
 *
 * The fix: the package paints ITSELF. Every visual is expressed as scoped CSS
 * under the `.oescap-*` namespace, injected once at runtime via a single
 * `<style id="oescap-styles">` block. Drop the bubble into a bare page with NO
 * Tailwind and NO design tokens and it still renders pixel-correct.
 *
 * Theming is driven entirely by CSS custom properties with baked-in OES
 * defaults (see `./theme`). An app retheme = override a var in its own CSS; the
 * global default look = edit the defaults here → version bump → propagates.
 */

/** The id of the injected <style> element (idempotency key). */
export const CAPTURE_STYLE_ELEMENT_ID = 'oescap-styles';

/**
 * The default CSS-variable block (the OES look). Declared on `:host`-less
 * `.oescap-root` so the bubble carries its own tokens even on a tokenless page,
 * while still letting a host override any var at `:root` / a parent scope.
 *
 * Light-blue accent + chat-bubble FAB is the default OES identity.
 */
export const CAPTURE_THEME_DEFAULTS_CSS = `
.oescap-root {
  --oescap-accent: #38bdf8;            /* sky-400 — the light-blue OES marker */
  --oescap-accent-strong: #0ea5e9;     /* hover/active accent */
  --oescap-accent-contrast: #082f49;   /* readable ink on the light-blue accent */
  --oescap-surface: #ffffff;           /* page-level surface */
  --oescap-surface-raised: #ffffff;    /* panel / sheet body */
  --oescap-surface-sunken: #f8fafc;    /* inset blocks (context box, inputs) */
  --oescap-ink: #0f172a;               /* primary text (slate-900) */
  --oescap-ink-muted: #475569;         /* secondary text (slate-600; meets contrast) */
  --oescap-line: #e2e8f0;              /* hairline borders (slate-200) */
  --oescap-radius: 0.625rem;           /* 10px — panel/control corner radius */
  --oescap-radius-sm: 0.375rem;        /* 6px — inner controls */
  --oescap-z: 2147483000;              /* above app chrome; below devtools max */
  --oescap-shadow: 0 10px 30px -5px rgba(2, 6, 23, 0.25), 0 2px 8px -2px rgba(2, 6, 23, 0.15);
  --oescap-success-bg: #ecfdf5;        /* emerald-50 */
  --oescap-success-border: #6ee7b7;    /* emerald-300 */
  --oescap-success-ink: #064e3b;       /* emerald-900 */
  --oescap-danger-bg: #fef2f2;         /* red-50 */
  --oescap-danger-ink: #991b1b;        /* red-800 */
  --oescap-tint-bug: #ef4444;          /* red-500 */
  --oescap-tint-feature: #6366f1;      /* indigo-500 */
  --oescap-tint-todo: #f97316;         /* orange-500 */
}
`.trim();

/**
 * The full scoped stylesheet. Self-contained: resets that matter for our own
 * elements are scoped to `.oescap-*` so we never touch host elements, and we
 * never rely on a single host-provided utility class.
 */
export const CAPTURE_STYLES_CSS = `
${CAPTURE_THEME_DEFAULTS_CSS}

/* ---- keyframes -------------------------------------------------------- */
@keyframes oescap-bubble-grow {
  from { opacity: 0; transform: scale(0.85); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes oescap-toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ---- box model reset (scoped to our subtree only) --------------------- */
.oescap-root,
.oescap-root *,
.oescap-root *::before,
.oescap-root *::after {
  box-sizing: border-box;
}

/* ---- FAB -------------------------------------------------------------- */
.oescap-fab {
  position: fixed;
  z-index: var(--oescap-z);
  display: flex;
  align-items: center;
  justify-content: center;
  height: 3rem;
  width: 3rem;
  padding: 0;
  border: none;
  border-radius: 9999px;
  background: var(--oescap-accent);
  color: var(--oescap-accent-contrast);
  cursor: pointer;
  box-shadow: var(--oescap-shadow);
  transition: background-color 180ms ease-out, box-shadow 180ms ease-out, transform 180ms ease-out;
  bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  right: calc(1rem + env(safe-area-inset-right, 0px));
  -webkit-tap-highlight-color: transparent;
}
.oescap-fab:hover {
  background: var(--oescap-accent-strong);
  box-shadow: 0 14px 36px -6px rgba(2, 6, 23, 0.3), 0 3px 10px -2px rgba(2, 6, 23, 0.18);
}
.oescap-fab:focus-visible {
  outline: none;
  box-shadow: var(--oescap-shadow), 0 0 0 2px var(--oescap-surface), 0 0 0 4px var(--oescap-accent);
}
.oescap-fab--mobile {
  bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
}
.oescap-fab__icon {
  width: 1.5rem;
  height: 1.5rem;
  display: block;
  pointer-events: none;
}

/* ---- modal backdrop + dialog ------------------------------------------ */
.oescap-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--oescap-z);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(2, 6, 23, 0.5);
}
@media (min-width: 640px) {
  .oescap-backdrop {
    align-items: center;
  }
}

.oescap-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: 90vh;
  overflow: hidden;
  background: var(--oescap-surface-raised);
  color: var(--oescap-ink);
  border-radius: var(--oescap-radius) var(--oescap-radius) 0 0;
  box-shadow: var(--oescap-shadow);
  outline: none;
  transform-origin: bottom right;
  animation: oescap-bubble-grow 180ms ease-out;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  text-align: left;
}
.oescap-panel--mobile {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
@media (min-width: 640px) {
  .oescap-panel {
    max-width: 36rem;
    border-radius: var(--oescap-radius);
  }
  .oescap-panel--mobile {
    padding-bottom: 0;
  }
}

/* ---- popover surface -------------------------------------------------- */
.oescap-popover {
  position: fixed;
  z-index: var(--oescap-z);
  bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  right: calc(1rem + env(safe-area-inset-right, 0px));
  display: flex;
  flex-direction: column;
  width: 28rem;
  max-width: calc(100vw - 2rem);
  max-height: calc(100vh - 4rem);
  overflow: hidden;
  background: var(--oescap-surface-raised);
  color: var(--oescap-ink);
  border: 1px solid var(--oescap-line);
  border-radius: var(--oescap-radius);
  box-shadow: var(--oescap-shadow);
  transform-origin: bottom right;
  animation: oescap-bubble-grow 180ms ease-out;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 14px;
  line-height: 1.45;
  text-align: left;
}

/* ---- header ----------------------------------------------------------- */
.oescap-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--oescap-line);
}
.oescap-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--oescap-ink-muted);
}
.oescap-close {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--oescap-ink-muted);
  font-size: 1rem;
  line-height: 1;
  padding: 0.25rem;
  cursor: pointer;
  border-radius: var(--oescap-radius-sm);
}
.oescap-close:hover { color: var(--oescap-ink); }
.oescap-close:focus-visible {
  outline: 2px solid var(--oescap-accent);
  outline-offset: 1px;
}

.oescap-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 1rem;
}

/* ---- tab strip -------------------------------------------------------- */
.oescap-tabs {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  overflow-x: auto;
  border-bottom: 1px solid var(--oescap-line);
}
.oescap-tab {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--oescap-ink-muted);
  font-size: 0.6875rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
  white-space: nowrap;
}
.oescap-tab:hover { color: var(--oescap-ink); }
.oescap-tab:focus-visible {
  outline: 2px solid var(--oescap-accent);
  outline-offset: -2px;
}
.oescap-tab--active { color: var(--oescap-ink); border-bottom-color: var(--oescap-accent); }
.oescap-tab--active.oescap-tab--bug { color: var(--oescap-tint-bug); border-bottom-color: var(--oescap-tint-bug); }
.oescap-tab--active.oescap-tab--feature { color: var(--oescap-tint-feature); border-bottom-color: var(--oescap-tint-feature); }
.oescap-tab--active.oescap-tab--todo { color: var(--oescap-tint-todo); border-bottom-color: var(--oescap-tint-todo); }
.oescap-tab--active.oescap-tab--ai { color: var(--oescap-accent-strong); border-bottom-color: var(--oescap-accent); }
.oescap-tab__icon { width: 1rem; height: 1rem; display: block; }

.oescap-panel-body { margin-top: 0.75rem; }

/* ---- form primitives -------------------------------------------------- */
.oescap-stack { display: flex; flex-direction: column; gap: 0.75rem; }
.oescap-field { display: flex; flex-direction: column; gap: 0.25rem; }
.oescap-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--oescap-ink-muted);
}
.oescap-input,
.oescap-textarea {
  width: 100%;
  margin: 0;
  padding: 0.375rem 0.5rem;
  border: 1px solid var(--oescap-line);
  border-radius: var(--oescap-radius-sm);
  background: var(--oescap-surface);
  color: var(--oescap-ink);
  font-size: 0.875rem;
  font-family: inherit;
}
.oescap-textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; resize: vertical; }
.oescap-input:focus,
.oescap-textarea:focus {
  outline: none;
  border-color: var(--oescap-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--oescap-accent) 35%, transparent);
}
.oescap-input::placeholder,
.oescap-textarea::placeholder { color: var(--oescap-ink-muted); opacity: 0.7; }

/* ---- context block ---------------------------------------------------- */
.oescap-context {
  border: 1px solid var(--oescap-line);
  background: var(--oescap-surface-sunken);
  border-radius: var(--oescap-radius-sm);
  padding: 0.5rem 0.625rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  color: var(--oescap-ink-muted);
}
.oescap-context code {
  font-family: inherit;
  background: color-mix(in srgb, var(--oescap-ink) 8%, transparent);
  padding: 0 0.25rem;
  border-radius: 3px;
}

/* ---- buttons ---------------------------------------------------------- */
.oescap-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.5rem;
  border-top: 1px solid var(--oescap-line);
  padding-top: 0.75rem;
}
.oescap-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  border: 1px solid transparent;
  border-radius: var(--oescap-radius-sm);
  padding: 0.375rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: background-color 120ms ease, opacity 120ms ease;
}
.oescap-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.oescap-btn:focus-visible { outline: 2px solid var(--oescap-accent); outline-offset: 1px; }
.oescap-btn--ghost { background: transparent; color: var(--oescap-ink-muted); }
.oescap-btn--ghost:hover:not(:disabled) { color: var(--oescap-ink); }
.oescap-btn--accent { background: var(--oescap-accent); color: var(--oescap-accent-contrast); }
.oescap-btn--accent:hover:not(:disabled) { background: var(--oescap-accent-strong); }
.oescap-btn--bug { background: var(--oescap-tint-bug); color: #ffffff; }
.oescap-btn--bug:hover:not(:disabled) { background: color-mix(in srgb, var(--oescap-tint-bug) 85%, #000); }
.oescap-btn--feature { background: var(--oescap-tint-feature); color: #ffffff; }
.oescap-btn--feature:hover:not(:disabled) { background: color-mix(in srgb, var(--oescap-tint-feature) 85%, #000); }
.oescap-btn--todo { background: var(--oescap-tint-todo); color: #ffffff; }
.oescap-btn--todo:hover:not(:disabled) { background: color-mix(in srgb, var(--oescap-tint-todo) 85%, #000); }

/* ---- screenshot attach ------------------------------------------------ */
.oescap-shot { display: flex; flex-direction: column; gap: 0.5rem; }
.oescap-shot__btn {
  align-self: flex-start;
  background: var(--oescap-surface-sunken);
  border: 1px solid var(--oescap-line);
  color: var(--oescap-ink-muted);
}
.oescap-shot__btn:hover:not(:disabled) { color: var(--oescap-ink); border-color: var(--oescap-accent); }
.oescap-shot__preview {
  position: relative;
  display: inline-block;
  width: 8rem;
}
.oescap-shot__thumb {
  display: block;
  width: 8rem;
  height: auto;
  border: 1px solid var(--oescap-line);
  border-radius: var(--oescap-radius-sm);
}
.oescap-shot__remove {
  position: absolute;
  top: -0.5rem;
  right: -0.5rem;
  width: 1.25rem;
  height: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 9999px;
  background: var(--oescap-ink);
  color: var(--oescap-surface);
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: var(--oescap-shadow);
}
.oescap-shot__hint { font-size: 0.6875rem; color: var(--oescap-ink-muted); }
.oescap-shot__err { font-size: 0.75rem; color: var(--oescap-danger-ink); }

/* ---- error + hint text ------------------------------------------------ */
.oescap-error {
  margin: 0;
  border-radius: var(--oescap-radius-sm);
  background: var(--oescap-danger-bg);
  color: var(--oescap-danger-ink);
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}

/* ---- existing-todo hint list ------------------------------------------ */
.oescap-hint { margin-top: 0.5rem; border-top: 1px solid var(--oescap-line); padding-top: 0.75rem; }
.oescap-hint__head {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--oescap-ink-muted);
}
.oescap-hint__list { margin: 0.5rem 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.25rem; }
.oescap-hint__item { font-size: 0.75rem; color: var(--oescap-ink-muted); }
.oescap-hint__pri { font-family: ui-monospace, monospace; font-size: 0.625rem; text-transform: uppercase; }
.oescap-hint__title { margin-left: 0.5rem; }
.oescap-link {
  display: inline-block;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--oescap-ink-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.oescap-link:hover { color: var(--oescap-ink); }

/* ---- toast ------------------------------------------------------------ */
.oescap-toast {
  position: fixed;
  z-index: calc(var(--oescap-z) + 1);
  bottom: calc(5rem + env(safe-area-inset-bottom, 0px));
  right: calc(1rem + env(safe-area-inset-right, 0px));
  max-width: 24rem;
  border: 1px solid var(--oescap-success-border);
  border-radius: var(--oescap-radius-sm);
  background: var(--oescap-success-bg);
  color: var(--oescap-success-ink);
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  box-shadow: var(--oescap-shadow);
  animation: oescap-toast-in 160ms ease-out;
}

/* ---- screenshot redaction (toggled on <html> during capture only) ----- */
.oescap-redacting [data-capture-redact],
.oescap-redacting input,
.oescap-redacting textarea,
.oescap-redacting select,
.oescap-redacting [contenteditable="true"] {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  background: var(--oescap-ink, #0f172a) !important;
  background-image: none !important;
  border-color: var(--oescap-ink, #0f172a) !important;
  caret-color: transparent !important;
}
/* Our own controls inside the open bubble must never be redacted. */
.oescap-redacting .oescap-root input,
.oescap-redacting .oescap-root textarea,
.oescap-redacting .oescap-root select {
  color: var(--oescap-ink) !important;
  -webkit-text-fill-color: var(--oescap-ink) !important;
  background: var(--oescap-surface) !important;
}

/* During capture, hide the bubble's own chrome so the screenshot shows the
   page being reported, not the open report dialog. (Toggled with redaction.) */
.oescap-capturing .oescap-root {
  visibility: hidden !important;
}

/* ---- reduced motion --------------------------------------------------- */
@media (prefers-reduced-motion: reduce) {
  .oescap-panel,
  .oescap-popover,
  .oescap-toast,
  .oescap-fab { animation: none; transition: none; }
}
`.trim();

/**
 * Inject the scoped stylesheet ONCE per document. Idempotent (keyed by
 * `CAPTURE_STYLE_ELEMENT_ID`) and SSR-safe (no-ops when `document` is absent).
 * Never throws — safe to call from an error boundary where the DOM may be in
 * an unusual state.
 */
export function ensureCaptureStyles(): void {
  if (typeof document === 'undefined') return;
  try {
    if (document.getElementById(CAPTURE_STYLE_ELEMENT_ID)) return;
    const style = document.createElement('style');
    style.id = CAPTURE_STYLE_ELEMENT_ID;
    style.textContent = CAPTURE_STYLES_CSS;
    (document.head ?? document.documentElement).appendChild(style);
  } catch {
    /* a locked-down document (CSP, detached): stay inert rather than throw */
  }
}
