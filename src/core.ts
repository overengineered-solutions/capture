/**
 * `@overengineered-solutions/capture/core` — server-side glue.
 *
 * The central-OES report sink client + the todo-distiller interface. These run
 * server-side only (they hold the OES dashboard secret); never import this
 * module into a `'use client'` file. Zero runtime dependencies — the LLM
 * provider and structured logger are INJECTED, never bundled.
 */
import type { ExistingTodo, ReportKind, TodoPriority } from './types';

// ---------------------------------------------------------------------------
// Logging — injected. Wire `@overengineered-solutions/observability`'s
// logSystemEvent here if you want central telemetry; default is a no-op.
// ---------------------------------------------------------------------------
export type CaptureLogger = (entry: {
  level: 'info' | 'error';
  event: string;
  meta?: Record<string, unknown>;
}) => void;

// ---------------------------------------------------------------------------
// Central-OES feedback sink.
// Reports flow to one OES inbox (POST /api/oes/feedback), tagged by app_slug,
// authenticated by the app's dashboard secret (service-level, NOT a user
// session that RLS can silently block).
// ---------------------------------------------------------------------------

/** The feedback classes the OES `/api/oes/feedback` route accepts. */
export type OesFeedbackKind = 'bug' | 'idea' | 'task' | 'question' | 'regression';

export type FiledReport = {
  title: string;
  description: string;
  kind: OesFeedbackKind;
  context?: Record<string, unknown> | null;
};

export type OesFeedbackResult = {
  ok: true;
  feedbackId: string;
  appSlug: string;
  kind: OesFeedbackKind;
  status: string;
};

export type OesFeedbackClientConfig = {
  /** Base URL of the OES umbrella, e.g. `https://oes.example.com`. */
  oesBaseUrl: string;
  /** The shared dashboard secret this app uses to authenticate to OES. */
  dashboardSecret: string;
  /** This app's slug (matches `projects.slug` in OES). */
  appSlug: string;
  /** Injected fetch (defaults to global `fetch`). */
  fetchImpl?: typeof fetch;
  /** Optional structured logger. */
  log?: CaptureLogger;
};

/** The shell files reports as `bug | feature`; OES models `feature` as `idea`. */
export function toOesFeedbackKind(shellKind: string): OesFeedbackKind {
  return shellKind === 'feature' ? 'idea' : 'bug';
}

/**
 * Build a client that POSTs a structured report to the central OES inbox.
 * Returns the bound send function.
 */
export function createOesFeedbackClient(
  config: OesFeedbackClientConfig,
): (report: FiledReport) => Promise<OesFeedbackResult> {
  const { oesBaseUrl, dashboardSecret, appSlug, fetchImpl = fetch, log } = config;
  const endpoint = `${oesBaseUrl.replace(/\/+$/, '')}/api/oes/feedback`;

  return async function fileReportToOes(report: FiledReport): Promise<OesFeedbackResult> {
    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${dashboardSecret}`,
      },
      body: JSON.stringify({
        appSlug,
        title: report.title,
        description: report.description,
        kind: report.kind,
        context: report.context ?? null,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      log?.({
        level: 'error',
        event: 'oes_feedback_post_failed',
        meta: { appSlug, status: res.status, detail: detail.slice(0, 500) },
      });
      throw new Error(`OES feedback POST failed: ${res.status} ${detail.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      feedback_id?: string;
      app_slug?: string;
      kind?: OesFeedbackKind;
      status?: string;
    };
    log?.({
      level: 'info',
      event: 'oes_feedback_captured',
      meta: { appSlug, kind: report.kind, feedbackId: json.feedback_id },
    });
    return {
      ok: true,
      feedbackId: json.feedback_id ?? '',
      appSlug: json.app_slug ?? appSlug,
      kind: json.kind ?? report.kind,
      status: json.status ?? 'new',
    };
  };
}

/** Parse the shell's report FormData (title/description/kind + captured_* fields). */
export function parseReportFormData(fd: FormData): FiledReport {
  const title = String(fd.get('title') ?? '').trim();
  const description = String(fd.get('description') ?? '').trim();
  const kind = toOesFeedbackKind(String(fd.get('kind') ?? 'bug'));

  const rawParams = fd.get('captured_params');
  let capturedParams: unknown = null;
  if (typeof rawParams === 'string' && rawParams.length > 0) {
    try {
      capturedParams = JSON.parse(rawParams);
    } catch {
      capturedParams = rawParams;
    }
  }

  const workspaceId = fd.get('workspace_id');
  const context: Record<string, unknown> = {
    capturedRoute: String(fd.get('captured_route') ?? ''),
    capturedUrl: String(fd.get('captured_url') ?? ''),
    capturedCommitSha: String(fd.get('captured_commit_sha') ?? ''),
    capturedParams,
  };
  if (typeof workspaceId === 'string' && workspaceId.length > 0) {
    context['workspaceId'] = workspaceId;
  }

  return { title, description, kind, context };
}

/**
 * Convenience: bind a central-OES `onFileReport` adapter ready to hand to the
 * `CaptureBubble` shell. Wrap this in your app's server action.
 */
export function createFileReportAction(
  config: OesFeedbackClientConfig,
): (fd: FormData) => Promise<void> {
  const client = createOesFeedbackClient(config);
  return async function onFileReport(fd: FormData): Promise<void> {
    await client(parseReportFormData(fd));
  };
}

// ---------------------------------------------------------------------------
// Todo distiller interface (provider injected).
// The actual Claude call is supplied by the host via @overengineered-solutions/
// ai-runtime's BYO→pool→off resolver; the package never bundles an LLM client.
// ---------------------------------------------------------------------------
export type TodoDraft = {
  title: string;
  description: string;
  priority: TodoPriority;
  category?: string;
  fileHints?: string[];
};

/** Turns a free-form message into structured todo drafts. Inject a Claude-backed impl. */
export type DistillProvider = (
  message: string,
  opts?: { signal?: AbortSignal },
) => Promise<TodoDraft[]>;

export type Distiller = { distill: DistillProvider };

export function createDistiller(provider: DistillProvider): Distiller {
  return { distill: provider };
}

// ---------------------------------------------------------------------------
// Mount helper — the two identical lines every host's CaptureBubbleMount runs.
// ---------------------------------------------------------------------------
export type ResolveCapturedDefaultsInput = {
  /** Host fetch returning open todos for the duplicate-hint list. */
  listOpenTodos?: () => Promise<Array<{ id: string; title: string; priority: TodoPriority }>>;
  /** Commit sha source; defaults to `process.env.VERCEL_GIT_COMMIT_SHA`. */
  commitSha?: string | null;
};

export async function resolveCapturedDefaults(
  input: ResolveCapturedDefaultsInput = {},
): Promise<{ existingOpen: ExistingTodo[]; deployedCommitSha: string | null }> {
  const existingOpen: ExistingTodo[] = input.listOpenTodos
    ? await input
        .listOpenTodos()
        .then((rows) => rows.map((t) => ({ id: t.id, title: t.title, priority: t.priority })))
        .catch(() => [])
    : [];
  const deployedCommitSha =
    input.commitSha !== undefined ? input.commitSha : process.env['VERCEL_GIT_COMMIT_SHA'] ?? null;
  return { existingOpen, deployedCommitSha };
}
