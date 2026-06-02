import type { ReactNode } from 'react';

/** The four tabs the bubble can surface. The AI tab is host-injected. */
export type CaptureTabKey = 'ai' | 'todo' | 'bug' | 'feature';

/** A filed report is either a defect or a feature suggestion. */
export type ReportKind = 'bug' | 'feature';

export type TodoPriority = 'high' | 'medium' | 'low';

/** A duplicate-hint row shown under the Todo panel. Host-fetched. */
export type ExistingTodo = {
  id: string;
  title: string;
  priority: TodoPriority;
};

/**
 * The page context the bubble auto-captures and serializes into the report
 * form. Derivation is identical in every host (pathname / href / params / sha).
 */
export type CapturedContext = {
  /** pathname, or '' when unavailable. */
  capturedRoute: string;
  /** window.location.href, falling back to the route. */
  capturedUrl: string;
  capturedParams: {
    route: Record<string, unknown>;
    search: Record<string, string>;
    kind: ReportKind;
  };
  /** The deployed commit SHA, or '' when unknown. */
  capturedCommitSha: string;
};

/** What the todo-distill adapter returns (matches every fork's `res.captured` + `res.ack`). */
export type CaptureTodoResult = { captured: number; ack?: string | null };

/**
 * Everything app-specific the `CaptureBubble` shell needs, passed in by the
 * host. The shell imports NOTHING app-specific — sinks are adapters, the AI
 * tab is an injected node, role gating is precomputed into `enabledTabs`.
 */
export type CaptureBubbleProps = {
  /** Open-todo duplicate hints for the Todo panel. Defaults to []. */
  existingOpen?: ExistingTodo[];
  /** VERCEL_GIT_COMMIT_SHA ?? null — shown + stamped into bug/feature reports. */
  deployedCommitSha?: string | null;

  // --- the two welds, now adapters (replace the relative server-action imports) ---
  /**
   * Todo distill adapter. Receives FormData (`message`[, `workspace_id`]).
   * Host binds its own server action. Required when the todo tab is enabled.
   */
  onCaptureTodo?: (fd: FormData) => Promise<CaptureTodoResult>;
  /**
   * Bug/feature file adapter. Receives FormData (title / description / kind +
   * the captured_* context fields). Host binds its own server action — for the
   * central-OES sink, wrap `createFileReportAction` from
   * `@overengineered-solutions/capture/core`. Required when bug/feature enabled.
   */
  onFileReport?: (fd: FormData) => Promise<void>;

  // --- injected AI slot (the package is chat-agnostic) ---
  /**
   * Optional AI tab. When present it becomes the default tab and the FAB flips
   * to the chat emoji. `label` overrides the generic "Chat" (OES renders
   * "Hand off"); `panel` is a pre-rendered node — the package knows nothing
   * about chat internals.
   */
  aiTab?: { label?: string; panel: ReactNode };

  // --- role/flag-driven tab visibility (host computes; package stays role-agnostic) ---
  /** Per-tab hiding. Omitted ⇒ render every wired tab. A tab is shown when its value !== false. */
  enabledTabs?: Partial<Record<CaptureTabKey, boolean>>;

  // --- multi-tenant scoping (makeros today; harmless elsewhere) ---
  /** When set, captures are stamped/scoped to this workspace (added to FormData). */
  workspaceId?: string | null;

  /**
   * Matched dynamic route params (e.g. `{ id: 'abc' }`). The shell is
   * `next`-free so it can't read `useParams()` itself; a Next host can pass
   * them from a tiny client wrapper (`const p = useParams()`). Captured into
   * `captured_params.route` for triage. Optional — the full URL is captured
   * regardless.
   */
  routeParams?: Record<string, unknown>;

  // --- presentation: one component, two surfaces ---
  /**
   * `modal` — centered/bottom-sheet dialog with backdrop + focus trap (default).
   * `popover` — anchored bottom-right, no backdrop, click-outside dismiss (OES).
   */
  surface?: 'modal' | 'popover';
  /**
   * Mobile treatment: lifts the FAB above a bottom nav (safe-area thumb-zone)
   * and pads the sheet for the home bar. Defaults to false.
   */
  mobile?: boolean;

  // --- host-overridable copy (so the package ships zero app-specific strings) ---
  /** Heading. Defaults to "Capture". */
  title?: string;
  /** Deep-link the Todo "Full list →" affordance points at. */
  todoListHref?: string;
  /** Deep-link the report distill-hint points at. */
  reportListHref?: string;
  /** Override the success message a filed report shows. */
  reportSuccessCopy?: (kind: ReportKind) => string;
};
