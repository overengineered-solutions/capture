import { describe, it, expect, vi } from 'vitest';
import {
  toOesFeedbackKind,
  parseReportFormData,
  createOesFeedbackClient,
  createFileReportAction,
} from '../src/core';
import {
  CAPTURE_LOCAL_MIRROR_SQL,
  BUG_REPORTS_TABLE_SQL,
  TODOS_TABLE_SQL,
} from '../src/migrations';
import { CAPTURE_DESIGN_TOKENS, captureThemeCss } from '../src/theme';

describe('toOesFeedbackKind', () => {
  it('maps the shell "feature" to OES "idea", everything else to "bug"', () => {
    expect(toOesFeedbackKind('feature')).toBe('idea');
    expect(toOesFeedbackKind('bug')).toBe('bug');
    expect(toOesFeedbackKind('anything')).toBe('bug');
  });
});

describe('parseReportFormData', () => {
  function fd(entries: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(entries)) f.set(k, v);
    return f;
  }

  it('extracts title/description, maps kind, and assembles context', () => {
    const report = parseReportFormData(
      fd({
        title: ' Broken button ',
        description: ' clicking does nothing ',
        kind: 'bug',
        captured_route: '/admin/x',
        captured_url: 'https://app.example.com/admin/x?a=1',
        captured_commit_sha: 'abc123',
        captured_params: JSON.stringify({ route: {}, search: { a: '1' }, kind: 'bug' }),
      }),
    );
    expect(report.title).toBe('Broken button');
    expect(report.description).toBe('clicking does nothing');
    expect(report.kind).toBe('bug');
    expect(report.context).toMatchObject({
      capturedRoute: '/admin/x',
      capturedUrl: 'https://app.example.com/admin/x?a=1',
      capturedCommitSha: 'abc123',
    });
    expect((report.context as { capturedParams: { search: Record<string, string> } }).capturedParams.search.a).toBe('1');
  });

  it('maps feature → idea and includes workspaceId only when present', () => {
    const withWs = parseReportFormData(fd({ title: 't', description: 'd', kind: 'feature', workspace_id: 'ws-1' }));
    expect(withWs.kind).toBe('idea');
    expect(withWs.context).toMatchObject({ workspaceId: 'ws-1' });

    const noWs = parseReportFormData(fd({ title: 't', description: 'd', kind: 'feature' }));
    expect(noWs.context).not.toHaveProperty('workspaceId');
  });

  it('tolerates malformed captured_params (keeps the raw string)', () => {
    const report = parseReportFormData(fd({ title: 't', description: 'd', kind: 'bug', captured_params: 'not-json' }));
    expect((report.context as { capturedParams: unknown }).capturedParams).toBe('not-json');
  });
});

describe('createOesFeedbackClient', () => {
  it('POSTs to /api/oes/feedback with bearer auth and normalizes the response', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, feedback_id: 'fb-9', app_slug: 'makeros', kind: 'bug', status: 'new' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = createOesFeedbackClient({
      oesBaseUrl: 'https://oes.example.com/',
      dashboardSecret: 's3cret',
      appSlug: 'makeros',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const res = await client({ title: 't', description: 'd', kind: 'bug', context: { a: 1 } });
    expect(res).toEqual({ ok: true, feedbackId: 'fb-9', appSlug: 'makeros', kind: 'bug', status: 'new' });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://oes.example.com/api/oes/feedback');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit & { headers: Record<string, string> }).headers.authorization).toBe('Bearer s3cret');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ appSlug: 'makeros', kind: 'bug' });
  });

  it('throws (never silently swallows) on a non-OK response', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }));
    const client = createOesFeedbackClient({
      oesBaseUrl: 'https://oes.example.com',
      dashboardSecret: 'x',
      appSlug: 'rescue',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client({ title: 't', description: 'd', kind: 'bug' })).rejects.toThrow(/401/);
  });

  it('createFileReportAction returns a FormData-shaped adapter', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, feedback_id: 'fb-1', app_slug: 'primopicks', kind: 'idea', status: 'new' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const onFileReport = createFileReportAction({
      oesBaseUrl: 'https://oes.example.com',
      dashboardSecret: 'x',
      appSlug: 'primopicks',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const f = new FormData();
    f.set('title', 'Add dark mode');
    f.set('description', 'please');
    f.set('kind', 'feature');
    await expect(onFileReport(f)).resolves.toBeUndefined();
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string).kind).toBe('idea');
  });
});

describe('migrations + theme exports', () => {
  it('ship non-empty canonical SQL with the expected tables', () => {
    expect(BUG_REPORTS_TABLE_SQL).toContain('create table if not exists public.bug_reports');
    expect(TODOS_TABLE_SQL).toContain('create table if not exists public.todos');
    expect(CAPTURE_LOCAL_MIRROR_SQL).toContain('set_updated_at');
  });

  it('document the design-token contract', () => {
    expect(CAPTURE_DESIGN_TOKENS).toContain('bg-surface-raised');
    expect(captureThemeCss).toContain('--color-accent');
  });
});
