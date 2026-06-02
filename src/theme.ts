/**
 * `@overengineered-solutions/capture/theme` — the design-token contract.
 *
 * The shell renders with the portfolio's standard Tailwind design-token
 * utility classes (the same ones the forks already use). Apps scaffolded from
 * the template already define these tokens; a NEW host (e.g. rescue) imports
 * the CSS below to satisfy the contract, then may override the values.
 *
 * The bubble's documented portfolio invariants (primopicks DESIGN.md):
 *   friend-blue accent (sky-500) · h-12 w-12 FAB · fixed bottom-4 right-4 z-40 ·
 *   grow-from-bottom-right open animation.
 */

/** The host design-token utility classes the shell relies on. */
export const CAPTURE_DESIGN_TOKENS = [
  'bg-surface', // page-level surface
  'bg-surface-raised', // the panel/sheet body
  'text-ink', // primary text
  'text-ink-muted', // secondary text
  'border-line', // hairline borders
] as const;

/**
 * The `bubble-grow` keyframe the FAB→panel open animation references
 * (`animate-[bubble-grow_180ms_ease-out]`, `origin-bottom-right`). Inject this
 * once globally (e.g. in your root CSS) if your host CSS doesn't define it.
 */
export const captureBubbleKeyframesCss = `
@keyframes bubble-grow {
  from { opacity: 0; transform: scale(0.85); }
  to   { opacity: 1; transform: scale(1); }
}
`.trim();

/**
 * Default token values, as a Tailwind v4 `@theme` block. Paste into a host
 * that does not already define the surface/ink/line tokens (light defaults;
 * override for dark mode). The accent stays the portfolio friend-blue.
 */
export const captureThemeCss = `
@theme {
  --color-surface: #ffffff;
  --color-surface-raised: #ffffff;
  --color-ink: #111827;          /* gray-900 */
  --color-ink-muted: #374151;    /* gray-700 — meets contrast; avoid gray-500 */
  --color-line: #e5e7eb;         /* gray-200 */
  --color-accent: #0ea5e9;       /* sky-500 — the friend-blue marker */
}

${captureBubbleKeyframesCss}
`.trim();
