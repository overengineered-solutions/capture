/**
 * `@overengineered-solutions/capture/theme` — the CSS-variable theming contract.
 *
 * v0.2.0 made the CaptureBubble **self-styling**: it injects its own scoped CSS
 * at runtime (see the `./styles` module, re-exported below), so it renders
 * pixel-correct with ZERO host Tailwind / design tokens. Every visual knob is a
 * `--oescap-*` CSS custom property with a baked-in OES default. The defaults ARE
 * the OES look (light-blue accent + chat-bubble FAB) — the single source of
 * truth. To retheme one app, override a var in that app's CSS; to change the
 * portfolio default look, edit the defaults here → version bump → propagates.
 */

export {
  CAPTURE_STYLES_CSS,
  CAPTURE_THEME_DEFAULTS_CSS,
  CAPTURE_STYLE_ELEMENT_ID,
  ensureCaptureStyles,
} from './styles';

/**
 * The CSS custom properties the bubble reads, each with its baked-in OES
 * default. Override any of these on `:root` (or any ancestor of the bubble) in
 * your own stylesheet to retheme — you do NOT need to import any CSS to get the
 * default look; the package injects it for you.
 *
 * @example
 * ```css
 * :root {
 *   --oescap-accent: #ec4899;          // retheme to pink
 *   --oescap-accent-contrast: #ffffff;
 *   --oescap-radius: 1rem;
 * }
 * ```
 */
export const CAPTURE_THEME_VARS = {
  /** FAB / accent fill (DEFAULT: #38bdf8, sky-400 light blue). */
  '--oescap-accent': '#38bdf8',
  /** Hover/active accent. */
  '--oescap-accent-strong': '#0ea5e9',
  /** Readable ink ON the accent fill. */
  '--oescap-accent-contrast': '#082f49',
  /** Page-level surface. */
  '--oescap-surface': '#ffffff',
  /** Panel / sheet body. */
  '--oescap-surface-raised': '#ffffff',
  /** Inset blocks (context box, input fills). */
  '--oescap-surface-sunken': '#f8fafc',
  /** Primary text. */
  '--oescap-ink': '#0f172a',
  /** Secondary text (meets contrast — avoid lighter grays). */
  '--oescap-ink-muted': '#475569',
  /** Hairline borders. */
  '--oescap-line': '#e2e8f0',
  /** Panel/control corner radius. */
  '--oescap-radius': '0.625rem',
  /** Inner-control corner radius. */
  '--oescap-radius-sm': '0.375rem',
  /** Stacking context (above app chrome). */
  '--oescap-z': '2147483000',
  /** Panel/FAB drop shadow. */
  '--oescap-shadow':
    '0 10px 30px -5px rgba(2, 6, 23, 0.25), 0 2px 8px -2px rgba(2, 6, 23, 0.15)',
} as const;

export type CaptureThemeVar = keyof typeof CAPTURE_THEME_VARS;

/**
 * The portfolio invariants the defaults encode (documented for design review):
 * light-blue (`--oescap-accent` #38bdf8) accent, inline chat-bubble FAB,
 * 3rem (h-12) FAB pinned bottom-right with safe-area insets, grow-from-bottom-right
 * open animation (`oescap-bubble-grow`).
 */
export const CAPTURE_DESIGN_INVARIANTS = [
  'light-blue-accent', // --oescap-accent default #38bdf8
  'chat-bubble-fab', // inline SVG, currentColor/accent-tinted
  'fab-bottom-right-safe-area',
  'grow-from-bottom-right',
] as const;

// ---------------------------------------------------------------------------
// Back-compat exports (deprecated). v0.1.x hosts imported these; they remain so
// a bump doesn't break a build. New hosts need NONE of this — the bubble
// self-styles. These are no longer the styling mechanism.
// ---------------------------------------------------------------------------

/**
 * @deprecated v0.2.0 self-styles; you no longer need to inject any CSS. The
 * keyframe now ships in the injected scoped stylesheet as `oescap-bubble-grow`.
 * Retained as the legacy global keyframe for hosts that referenced it directly.
 */
export const captureBubbleKeyframesCss = `
@keyframes bubble-grow {
  from { opacity: 0; transform: scale(0.85); }
  to   { opacity: 1; transform: scale(1); }
}
`.trim();

/**
 * @deprecated v0.2.0 self-styles via `--oescap-*` CSS variables; the host no
 * longer needs to define Tailwind design tokens for the bubble. Retained for
 * back-compat; it now also seeds the `--oescap-*` defaults for convenience.
 */
export const captureThemeCss = `
:root {
${Object.entries(CAPTURE_THEME_VARS)
  .map(([k, v]) => `  ${k}: ${v};`)
  .join('\n')}
}

${captureBubbleKeyframesCss}
`.trim();

/**
 * @deprecated v0.1.x relied on host Tailwind utility classes; v0.2.0 does not.
 * Retained so old tests/imports resolve. The bubble no longer reads these.
 */
export const CAPTURE_DESIGN_TOKENS = [
  'bg-surface',
  'bg-surface-raised',
  'text-ink',
  'text-ink-muted',
  'border-line',
] as const;
