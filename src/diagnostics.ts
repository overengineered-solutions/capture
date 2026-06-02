/**
 * `@overengineered-solutions/capture/diagnostics` — dependency-free auto-diagnostics.
 *
 * Two halves, both framework- and dependency-free:
 *
 *  1. A module-level, capped **ring buffer** that records recent runtime errors.
 *     `installErrorCapture()` (idempotent) hooks `window.onerror`,
 *     `addEventListener('error')`, `addEventListener('unhandledrejection')` and
 *     (opt-in) `console.error`. The Bug panel reads the buffer at submit time so
 *     a report carries the errors that led up to it — without the user copying a
 *     stack trace by hand.
 *
 *  2. `gatherBrowserContext()` — a snapshot of the environment (UA / language /
 *     viewport / screen / DPR / online / referrer / capturedAt) bundled into the
 *     captured context of every bug AND feature report.
 *
 * The OES `/api/oes/feedback` route rejects a serialized context over 64 KiB, so
 * everything here is sized to stay comfortably under that ceiling: stacks are
 * truncated and the buffer is capped (default 15). `serializeDiagnostics()`
 * applies a final byte-budget clamp before the value is stamped into FormData.
 *
 * Pure functions (the gatherers + the buffer accessors) accept their inputs so
 * they can be unit-tested under a node env with a synthetic globals object.
 */

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type BrowserContext = {
  userAgent: string;
  language: string;
  viewport: { w: number; h: number };
  screen: { w: number; h: number };
  devicePixelRatio: number;
  online: boolean;
  referrer: string;
  /** ISO 8601 timestamp of when the context was gathered. */
  capturedAt: string;
};

export type CapturedError = {
  message: string;
  source?: string;
  line?: number;
  col?: number;
  /** Truncated stack (see `MAX_STACK_CHARS`). */
  stack?: string;
  /** ISO 8601 timestamp of when the error was recorded. */
  ts: string;
};

/** The full auto-diagnostics blob stamped into a report's captured context. */
export type Diagnostics = {
  browser: BrowserContext;
  recentErrors: CapturedError[];
};

// ---------------------------------------------------------------------------
// Tunables (kept conservative so the serialized context stays < 64 KiB).
// ---------------------------------------------------------------------------

/** Max errors retained in the ring buffer. */
export const MAX_RECENT_ERRORS = 15;
/** Max characters of any single stack we keep. */
export const MAX_STACK_CHARS = 1500;
/** Max characters of any single error message we keep. */
export const MAX_MESSAGE_CHARS = 500;
/**
 * Final byte budget for the serialized diagnostics JSON. Well under the OES
 * route's 64 KiB context ceiling, leaving room for the other captured_* fields.
 */
export const MAX_DIAGNOSTICS_BYTES = 32_768;

// ---------------------------------------------------------------------------
// The ring buffer (module-level; shared across every CaptureBubble on the page).
// ---------------------------------------------------------------------------

const ringBuffer: CapturedError[] = [];
let installed = false;

function truncate(value: string | undefined, max: number): string | undefined {
  if (value == null) return undefined;
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value;
}

/**
 * Push an error into the capped ring buffer (oldest dropped past the cap).
 * Exported for direct unit testing and for hosts that want to seed it.
 */
export function recordError(input: {
  message: unknown;
  source?: string;
  line?: number;
  col?: number;
  stack?: string;
  ts?: string;
}): void {
  const message =
    typeof input.message === 'string'
      ? input.message
      : (() => {
          try {
            return String(input.message);
          } catch {
            return '[unstringifiable error]';
          }
        })();

  const entry: CapturedError = {
    message: truncate(message, MAX_MESSAGE_CHARS) ?? '',
    ...(input.source ? { source: input.source } : {}),
    ...(typeof input.line === 'number' ? { line: input.line } : {}),
    ...(typeof input.col === 'number' ? { col: input.col } : {}),
    ...(input.stack ? { stack: truncate(input.stack, MAX_STACK_CHARS) } : {}),
    ts: input.ts ?? new Date().toISOString(),
  };

  ringBuffer.push(entry);
  // Cap: keep only the most recent MAX_RECENT_ERRORS.
  while (ringBuffer.length > MAX_RECENT_ERRORS) ringBuffer.shift();
}

/** A defensive copy of the current ring buffer (most-recent last). */
export function getRecentErrors(): CapturedError[] {
  return ringBuffer.map((e) => ({ ...e }));
}

/** Clear the ring buffer. Primarily for tests. */
export function clearRecentErrors(): void {
  ringBuffer.length = 0;
}

/**
 * Install the global error hooks ONCE. Idempotent and SSR-safe (no-ops when
 * `window` is absent). Captures uncaught errors + unhandled rejections, and —
 * when `hookConsoleError` is true — mirrors `console.error` calls into the
 * buffer (without suppressing the original console output).
 *
 * Never throws: a missing/locked global is swallowed so importing the bubble
 * into an error boundary can't itself error.
 */
export function installErrorCapture(opts: { hookConsoleError?: boolean } = {}): void {
  if (installed) return;
  if (typeof window === 'undefined') return;
  installed = true;

  try {
    window.addEventListener('error', (event: ErrorEvent) => {
      try {
        recordError({
          message: event.message || event.error?.message || 'error',
          source: event.filename,
          line: event.lineno,
          col: event.colno,
          stack: event.error?.stack,
        });
      } catch {
        /* never let instrumentation throw */
      }
    });

    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      try {
        const reason: unknown = event.reason;
        const message =
          reason instanceof Error
            ? reason.message
            : typeof reason === 'string'
              ? reason
              : 'unhandled promise rejection';
        recordError({
          message: `Unhandled rejection: ${message}`,
          stack: reason instanceof Error ? reason.stack : undefined,
        });
      } catch {
        /* never let instrumentation throw */
      }
    });

    if (opts.hookConsoleError && typeof console !== 'undefined' && console.error) {
      const original = console.error.bind(console);
      console.error = (...args: unknown[]) => {
        try {
          const first = args[0];
          recordError({
            message:
              first instanceof Error
                ? first.message
                : args.map((a) => (typeof a === 'string' ? a : safeToString(a))).join(' '),
            stack: first instanceof Error ? first.stack : undefined,
          });
        } catch {
          /* never let instrumentation throw */
        }
        original(...args);
      };
    }
  } catch {
    /* a locked-down / non-DOM global: stay inert */
  }
}

function safeToString(value: unknown): string {
  try {
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  } catch {
    return '[unserializable]';
  }
}

// ---------------------------------------------------------------------------
// Browser-context gatherer (pure; accepts an injectable globals bag for tests).
// ---------------------------------------------------------------------------

/** The subset of browser globals the gatherer reads (so it's testable in node). */
export type GathererGlobals = {
  navigator?: { userAgent?: string; language?: string; onLine?: boolean };
  location?: { href?: string };
  document?: { referrer?: string; documentElement?: { lang?: string } };
  innerWidth?: number;
  innerHeight?: number;
  screen?: { width?: number; height?: number };
  devicePixelRatio?: number;
};

/**
 * Snapshot the browser environment. Pass a synthetic `globals` object to test;
 * defaults to the real `window` in the browser, and to an all-empty snapshot
 * under SSR/node (never throws, never references an undefined `window`).
 */
export function gatherBrowserContext(globals?: GathererGlobals): BrowserContext {
  const g: GathererGlobals =
    globals ??
    (typeof window !== 'undefined' ? (window as unknown as GathererGlobals) : {});

  const nav = g.navigator ?? {};
  const scr = g.screen ?? {};

  return {
    userAgent: typeof nav.userAgent === 'string' ? nav.userAgent : '',
    language:
      typeof nav.language === 'string'
        ? nav.language
        : typeof g.document?.documentElement?.lang === 'string'
          ? g.document.documentElement.lang
          : '',
    viewport: {
      w: typeof g.innerWidth === 'number' ? g.innerWidth : 0,
      h: typeof g.innerHeight === 'number' ? g.innerHeight : 0,
    },
    screen: {
      w: typeof scr.width === 'number' ? scr.width : 0,
      h: typeof scr.height === 'number' ? scr.height : 0,
    },
    devicePixelRatio: typeof g.devicePixelRatio === 'number' ? g.devicePixelRatio : 1,
    online: typeof nav.onLine === 'boolean' ? nav.onLine : true,
    referrer: typeof g.document?.referrer === 'string' ? g.document.referrer : '',
    capturedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Assemble + serialize (with the byte-budget clamp).
// ---------------------------------------------------------------------------

/**
 * Build the diagnostics blob for a report. `includeErrors` defaults to true
 * (bug reports); feature reports may pass false to ship `recentErrors: []`.
 */
export function gatherDiagnostics(
  opts: { includeErrors?: boolean; globals?: GathererGlobals } = {},
): Diagnostics {
  const includeErrors = opts.includeErrors !== false;
  return {
    browser: gatherBrowserContext(opts.globals),
    recentErrors: includeErrors ? getRecentErrors() : [],
  };
}

/**
 * Serialize diagnostics to a JSON string, clamped to `MAX_DIAGNOSTICS_BYTES`.
 * If the blob is too large, errors are dropped oldest-first (then truncated to
 * the empty list) until it fits — the browser context is always preserved.
 * Returns the JSON string (never throws on a circular value — it won't have one).
 */
export function serializeDiagnostics(
  diagnostics: Diagnostics,
  maxBytes: number = MAX_DIAGNOSTICS_BYTES,
): string {
  const encoder = byteLength;
  // Defensive clone so we don't mutate the caller's object.
  const working: Diagnostics = {
    browser: diagnostics.browser,
    recentErrors: [...diagnostics.recentErrors],
  };

  let json = JSON.stringify(working);
  // Drop oldest errors one at a time until under budget.
  while (encoder(json) > maxBytes && working.recentErrors.length > 0) {
    working.recentErrors.shift();
    json = JSON.stringify(working);
  }
  return json;
}

/** UTF-8 byte length (TextEncoder when present, else a conservative estimate). */
function byteLength(s: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
  // Fallback: count code units worst-case as 3 bytes (covers BMP).
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
  }
  return bytes;
}
