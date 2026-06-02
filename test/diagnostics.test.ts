import { describe, it, expect, beforeEach } from 'vitest';
import {
  gatherBrowserContext,
  gatherDiagnostics,
  recordError,
  getRecentErrors,
  clearRecentErrors,
  serializeDiagnostics,
  MAX_RECENT_ERRORS,
  MAX_STACK_CHARS,
  MAX_MESSAGE_CHARS,
  type GathererGlobals,
} from '../src/diagnostics';
import { setRedaction, REDACTING_CLASS } from '../src/screenshot';

describe('gatherBrowserContext', () => {
  it('produces the documented shape from an injected globals bag', () => {
    const globals: GathererGlobals = {
      navigator: { userAgent: 'TestUA/1.0', language: 'en-GB', onLine: false },
      document: { referrer: 'https://ref.example' },
      innerWidth: 1024,
      innerHeight: 768,
      screen: { width: 1920, height: 1080 },
      devicePixelRatio: 2,
    };
    const ctx = gatherBrowserContext(globals);
    expect(ctx).toMatchObject({
      userAgent: 'TestUA/1.0',
      language: 'en-GB',
      viewport: { w: 1024, h: 768 },
      screen: { w: 1920, h: 1080 },
      devicePixelRatio: 2,
      online: false,
      referrer: 'https://ref.example',
    });
    // capturedAt is an ISO-8601 timestamp.
    expect(() => new Date(ctx.capturedAt).toISOString()).not.toThrow();
    expect(ctx.capturedAt).toBe(new Date(ctx.capturedAt).toISOString());
  });

  it('never throws on an empty/missing globals bag (SSR-safe)', () => {
    const ctx = gatherBrowserContext({});
    expect(ctx.userAgent).toBe('');
    expect(ctx.viewport).toEqual({ w: 0, h: 0 });
    expect(ctx.devicePixelRatio).toBe(1);
    expect(ctx.online).toBe(true); // optimistic default
  });
});

describe('recentErrors ring buffer', () => {
  beforeEach(() => clearRecentErrors());

  it('records errors with a truncated stack + ISO ts', () => {
    recordError({ message: 'boom', source: 'a.js', line: 3, col: 7, stack: 'x'.repeat(5000) });
    const [e] = getRecentErrors();
    expect(e!.message).toBe('boom');
    expect(e!.source).toBe('a.js');
    expect(e!.line).toBe(3);
    expect(e!.col).toBe(7);
    // Stack truncated to MAX_STACK_CHARS + the marker.
    expect(e!.stack!.length).toBeLessThanOrEqual(MAX_STACK_CHARS + '…[truncated]'.length);
    expect(e!.stack!.endsWith('…[truncated]')).toBe(true);
    expect(() => new Date(e!.ts).toISOString()).not.toThrow();
  });

  it('truncates over-long messages', () => {
    recordError({ message: 'm'.repeat(2000) });
    const [e] = getRecentErrors();
    expect(e!.message.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS + '…[truncated]'.length);
  });

  it('caps at MAX_RECENT_ERRORS (oldest dropped)', () => {
    for (let i = 0; i < MAX_RECENT_ERRORS + 10; i++) recordError({ message: `e${i}` });
    const errors = getRecentErrors();
    expect(errors).toHaveLength(MAX_RECENT_ERRORS);
    // Oldest (e0..e9) dropped; the most recent is the last pushed.
    expect(errors[errors.length - 1]!.message).toBe(`e${MAX_RECENT_ERRORS + 9}`);
    expect(errors[0]!.message).toBe('e10');
  });

  it('stringifies a non-string message safely', () => {
    recordError({ message: { toString: () => 'objmsg' } as unknown as string });
    expect(getRecentErrors()[0]!.message).toBe('objmsg');
  });

  it('getRecentErrors returns a defensive copy (mutating it does not affect the buffer)', () => {
    recordError({ message: 'one' });
    const copy = getRecentErrors();
    copy.push({ message: 'injected', ts: new Date().toISOString() });
    expect(getRecentErrors()).toHaveLength(1);
  });
});

describe('gatherDiagnostics + serializeDiagnostics', () => {
  beforeEach(() => clearRecentErrors());

  it('feature reports get an empty recentErrors when includeErrors=false', () => {
    recordError({ message: 'should-not-appear' });
    const diag = gatherDiagnostics({ includeErrors: false, globals: {} });
    expect(diag.recentErrors).toEqual([]);
    expect(diag.browser).toBeTruthy();
  });

  it('bug reports include the buffered errors by default', () => {
    recordError({ message: 'kaboom' });
    const diag = gatherDiagnostics({ globals: {} });
    expect(diag.recentErrors.map((e) => e.message)).toContain('kaboom');
  });

  it('serializes to valid JSON and clamps to the byte budget by dropping oldest errors', () => {
    for (let i = 0; i < MAX_RECENT_ERRORS; i++) {
      recordError({ message: `err-${i}`, stack: 'z'.repeat(MAX_STACK_CHARS) });
    }
    const diag = gatherDiagnostics({ globals: { navigator: { userAgent: 'UA' } } });
    const tinyBudget = 800; // force the clamp
    const json = serializeDiagnostics(diag, tinyBudget);
    const parsed = JSON.parse(json) as { browser: unknown; recentErrors: unknown[] };
    expect(parsed.browser).toBeTruthy(); // browser context always preserved
    expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(tinyBudget);
    // Some errors were dropped to fit the budget.
    expect(parsed.recentErrors.length).toBeLessThan(MAX_RECENT_ERRORS);
  });

  it('keeps all errors when the budget is generous', () => {
    recordError({ message: 'a' });
    recordError({ message: 'b' });
    const diag = gatherDiagnostics({ globals: {} });
    const json = serializeDiagnostics(diag);
    const parsed = JSON.parse(json) as { recentErrors: unknown[] };
    expect(parsed.recentErrors).toHaveLength(2);
  });
});

describe('screenshot redaction toggle', () => {
  it('adds/removes the redaction class on an injected classList stub', () => {
    const tokens = new Set<string>();
    const stub = {
      classList: {
        add: (c: string) => tokens.add(c),
        remove: (c: string) => tokens.delete(c),
        contains: (c: string) => tokens.has(c),
      } as unknown as DOMTokenList,
    };
    expect(setRedaction(true, stub)).toBe(true);
    expect(tokens.has(REDACTING_CLASS)).toBe(true);
    expect(setRedaction(false, stub)).toBe(false);
    expect(tokens.has(REDACTING_CLASS)).toBe(false);
  });

  it('is a no-op (returns false) when no root and no document', () => {
    // node env has no document, so the default path returns false.
    expect(setRedaction(true)).toBe(false);
  });
});
