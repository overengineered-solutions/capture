'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type {
  CaptureBubbleProps,
  CaptureTabKey,
  CaptureTodoResult,
  CapturedContext,
  ExistingTodo,
  ReportKind,
} from './types';

/**
 * `@overengineered-solutions/capture` — the canonical CaptureBubble shell.
 *
 * One floating bottom-right bubble that opens a tabbed surface for the four
 * capture modes (💬 AI helper / 📝 Todo / 🛠 Bug / 💡 Feature). The shell is
 * adapter-injected and app-agnostic: the report/todo sinks are passed in as
 * `onFileReport` / `onCaptureTodo`, the AI tab is an injected `ReactNode`, and
 * role/flag gating is precomputed into `enabledTabs`. It imports NOTHING
 * relative or app-specific and has zero runtime deps beyond react — the page
 * context is derived from browser primitives (no `next/navigation`).
 *
 * One component, two surfaces:
 *   - `surface="modal"` (default) — bottom-sheet → centered dialog with a
 *     darkened backdrop and a WCAG-compliant focus trap.
 *   - `surface="popover"` — anchored bottom-right, no backdrop, click-outside
 *     dismiss; the popover replaces the FAB in the corner while open.
 *
 * Both surfaces render the SAME inner tabbed body — no panel duplication.
 *
 * Design tokens (documented in `@overengineered-solutions/capture/theme`):
 * `bg-surface-raised`, `text-ink`, `text-ink-muted`, `border-line`, the
 * `sky-500` friend-blue accent, and the `bubble-grow` keyframe.
 */

// ---------------------------------------------------------------------------
// Tint tables (lowest-common-denominator base — identical across every fork).
// ---------------------------------------------------------------------------

type Tint = 'indigo' | 'orange' | 'red' | 'sky';

const TAB_META: Record<CaptureTabKey, { emoji: string; label: string; tint: Tint }> = {
  ai: { emoji: '💬', label: 'Chat', tint: 'sky' },
  todo: { emoji: '📝', label: 'Todo', tint: 'orange' },
  bug: { emoji: '🛠', label: 'Bug', tint: 'red' },
  feature: { emoji: '💡', label: 'Feature', tint: 'indigo' },
};

const TINT_CLASSES: Record<Tint, { active: string; accent: string }> = {
  sky: {
    active: 'border-sky-500 text-sky-700 dark:text-sky-300',
    accent: 'bg-sky-500 hover:bg-sky-600 text-white',
  },
  orange: {
    active: 'border-orange-500 text-orange-700 dark:text-orange-300',
    accent: 'bg-orange-500 hover:bg-orange-600 text-white',
  },
  red: {
    active: 'border-red-500 text-red-700 dark:text-red-300',
    accent: 'bg-red-600 hover:bg-red-700 text-white',
  },
  indigo: {
    active: 'border-indigo-500 text-indigo-700 dark:text-indigo-300',
    accent: 'bg-indigo-600 hover:bg-indigo-700 text-white',
  },
};

// ---------------------------------------------------------------------------
// Internalized pending-aware submit button (replaces oesolutions's <SubmitButton>
// import — the package must not depend on @overengineered-solutions/ui).
// ---------------------------------------------------------------------------

function PendingSubmitButton({
  pending,
  disabled,
  className,
  idleLabel,
  pendingLabel,
}: {
  pending: boolean;
  disabled?: boolean;
  className?: string;
  idleLabel: string;
  pendingLabel: string;
}) {
  return (
    <button type="submit" disabled={pending || disabled} className={className}>
      {pending ? pendingLabel : idleLabel}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Captured-context derivation (next/navigation-free).
//
// The forks read usePathname/useSearchParams/useParams from next/navigation,
// but this package has no `next` dependency, so we derive the identical shape
// from window.location. Read lazily on mount (effect) so SSR stays inert and
// the first client render matches the server's empty snapshot.
// ---------------------------------------------------------------------------

function useCapturedContext(deployedCommitSha: string | null, kind: ReportKind): CapturedContext {
  const [loc, setLoc] = useState<{ pathname: string; href: string; search: string }>({
    pathname: '',
    href: '',
    search: '',
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setLoc({
      pathname: window.location.pathname,
      href: window.location.href,
      search: window.location.search,
    });
  }, []);

  return useMemo<CapturedContext>(() => {
    const search: Record<string, string> = {};
    if (loc.search) {
      const params = new URLSearchParams(loc.search);
      params.forEach((v, k) => {
        search[k] = v;
      });
    }
    return {
      capturedRoute: loc.pathname,
      capturedUrl: loc.href || loc.pathname || '/',
      capturedParams: { route: {}, search, kind },
      capturedCommitSha: deployedCommitSha ?? '',
    };
  }, [loc, kind, deployedCommitSha]);
}

// ---------------------------------------------------------------------------
// CaptureBubble — the shell.
// ---------------------------------------------------------------------------

export function CaptureBubble({
  existingOpen,
  deployedCommitSha,
  onCaptureTodo,
  onFileReport,
  aiTab,
  enabledTabs,
  workspaceId,
  routeParams,
  surface,
  mobile,
  title,
  todoListHref,
  reportListHref,
  reportSuccessCopy,
}: CaptureBubbleProps) {
  // Defaults.
  const openTodos = existingOpen ?? [];
  const commitSha = deployedCommitSha ?? null;
  const heading = title ?? 'Capture';
  const surfaceMode = surface ?? 'modal';
  const isMobile = mobile ?? false;
  const wsId = workspaceId ?? null;

  // Visible-tab build from enabledTabs.
  const tabs: CaptureTabKey[] = [];
  if (aiTab && enabledTabs?.ai !== false) tabs.push('ai');
  if (enabledTabs?.todo !== false) tabs.push('todo');
  if (enabledTabs?.bug !== false) tabs.push('bug');
  if (enabledTabs?.feature !== false) tabs.push('feature');

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<CaptureTabKey>(tabs[0] ?? 'todo');
  const [toast, setToast] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Reconcile `active` whenever the visible tab set changes (host toggles
  // `enabledTabs`, or `aiTab` arrives/leaves after an async role/flag resolve).
  // Without this, `active` keeps pointing at a tab that is no longer rendered,
  // so the strip shows no active highlight and the body renders a panel for a
  // now-hidden tab (or, for the AI tab, nothing at all). Snap back to tabs[0].
  const tabsKey = tabs.join(',');
  useEffect(() => {
    if (tabs.length > 0 && !tabs.includes(active)) {
      setActive(tabs[0]!);
    }
    // `tabsKey` captures the enabled-tab set; `active` so a manual switch to a
    // still-valid tab doesn't get clobbered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsKey, active]);

  // Toast / ack auto-dismiss.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Popover surface: click-outside (pointerdown covers mouse + touch).
  useEffect(() => {
    if (surfaceMode !== 'popover' || !open) return;
    function onPointerDown(e: PointerEvent) {
      const node = popoverRef.current;
      if (!node) return;
      if (!node.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [surfaceMode, open]);

  // Popover surface: ESC dismiss (the modal shell owns its own ESC handler).
  useEffect(() => {
    if (surfaceMode !== 'popover' || !open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [surfaceMode, open]);

  if (tabs.length === 0) return null;

  const floatEmoji = tabs[0] === 'ai' ? '💬' : '📝';
  const floatTint: Tint = tabs[0] === 'ai' ? 'sky' : 'orange';

  // FAB position: always-on safe-area inset math; mobile lifts above a bottom
  // nav into the thumb-zone and drops back to bottom-4 at sm.
  const fabPosition = isMobile
    ? 'fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:bottom-4'
    : 'fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))]';

  const fab = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Capture / chat"
      aria-label={tabs[0] === 'ai' ? 'Open chat' : 'Open capture and chat menu'}
      aria-haspopup="dialog"
      className={`${fabPosition} z-40 flex h-12 w-12 items-center justify-center rounded-full text-xl shadow-md transition-all duration-200 ease-out hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 ${
        floatTint === 'sky'
          ? 'bg-sky-500 ring-sky-500 hover:bg-sky-600'
          : 'bg-orange-500 ring-orange-500 hover:bg-orange-600'
      }`}
    >
      <span aria-hidden>{floatEmoji}</span>
    </button>
  );

  // The inner tabbed body — shared verbatim by both surfaces (no duplication).
  const body = (
    <>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-line dark:border-zinc-700">
        {tabs.map((key) => {
          const meta = TAB_META[key];
          // The AI tab can override its label via aiTab.label (OES renders
          // "Hand off" instead of the generic "Chat").
          const label = key === 'ai' && aiTab?.label ? aiTab.label : meta.label;
          const isActive = key === active;
          const cls = isActive
            ? `border-b-2 ${TINT_CLASSES[meta.tint].active}`
            : 'border-b-2 border-transparent text-ink-muted hover:text-ink dark:hover:text-zinc-200';
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={`flex shrink-0 items-center gap-1 px-3 py-2 text-xs font-semibold uppercase tracking-wide transition-colors ${cls}`}
            >
              <span aria-hidden>{meta.emoji}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        {active === 'ai' && aiTab ? aiTab.panel : null}
        {active === 'todo' ? (
          <AddTodoPanel
            existingOpen={openTodos}
            workspaceId={wsId}
            todoListHref={todoListHref}
            onCaptureTodo={onCaptureTodo}
            onClose={() => setOpen(false)}
            onSuccess={(msg) => setToast(msg)}
          />
        ) : null}
        {active === 'bug' ? (
          <BugOrFeaturePanel
            kind="bug"
            deployedCommitSha={commitSha}
            workspaceId={wsId}
            routeParams={routeParams}
            reportListHref={reportListHref}
            reportSuccessCopy={reportSuccessCopy}
            onFileReport={onFileReport}
            onClose={() => setOpen(false)}
            onSuccess={(msg) => setToast(msg)}
          />
        ) : null}
        {active === 'feature' ? (
          <BugOrFeaturePanel
            kind="feature"
            deployedCommitSha={commitSha}
            workspaceId={wsId}
            routeParams={routeParams}
            reportListHref={reportListHref}
            reportSuccessCopy={reportSuccessCopy}
            onFileReport={onFileReport}
            onClose={() => setOpen(false)}
            onSuccess={(msg) => setToast(msg)}
          />
        ) : null}
      </div>
    </>
  );

  return (
    <>
      {toast ? (
        <div className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] z-50 max-w-sm rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 shadow">
          {toast}
        </div>
      ) : null}

      {surfaceMode === 'popover' ? (
        // Popover: no backdrop, anchored bottom-right, FAB hidden while open
        // (the popover replaces it in the corner). aria-modal is false.
        open ? (
          <div
            ref={popoverRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="capture-title"
            className="fixed bottom-4 right-4 z-50 flex max-h-[calc(100vh-4rem)] w-[28rem] max-w-[calc(100vw-2rem)] origin-bottom-right animate-[bubble-grow_180ms_ease-out] flex-col overflow-hidden rounded-lg border border-line bg-surface-raised shadow-xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-3 dark:border-zinc-700">
              <h2
                id="capture-title"
                className="text-sm font-semibold uppercase tracking-wider text-ink-muted"
              >
                {heading}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-ink-muted hover:text-ink dark:text-zinc-400 dark:hover:text-zinc-100"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">{body}</div>
          </div>
        ) : (
          fab
        )
      ) : (
        // Modal: FAB always rendered; backdrop + focus-trapped dialog on open.
        <>
          {fab}
          {open ? (
            <ModalShell heading={heading} mobile={isMobile} onClose={() => setOpen(false)}>
              {body}
            </ModalShell>
          ) : null}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Modal shell — backdrop + bottom-sheet→centered dialog + WCAG focus trap.
// ---------------------------------------------------------------------------

function ModalShell({
  heading,
  mobile,
  onClose,
  children,
}: {
  heading: string;
  mobile: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Accessible-dialog plumbing (WCAG 2.1.2 No Keyboard Trap / 2.4.3 Focus
  // Order / 4.1.2): capture the previously-focused element, move focus into the
  // panel on open, trap Tab inside it, close on Escape, and restore focus to
  // the trigger on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      // Exclude non-focusable inputs explicitly: `input[type=hidden]` and any
      // `[disabled]` control still match a bare `input`/`textarea`/`select`
      // selector, and the bug/feature panel emits 5+ hidden inputs. If one
      // landed as `first`/`last`, the Tab-wrap `.focus()` would be a silent
      // no-op and the trap would leak. Then drop anything with no layout box
      // (display:none / detached) so the wrap target is always truly focusable.
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || activeEl === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-black/50 sm:items-center sm:justify-center"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="capture-title"
        tabIndex={-1}
        className={`flex max-h-[90vh] w-full origin-bottom-right animate-[bubble-grow_180ms_ease-out] flex-col overflow-hidden rounded-t-lg bg-surface-raised shadow-xl outline-none sm:max-w-xl sm:rounded-lg dark:bg-zinc-900 dark:text-zinc-100 ${
          mobile ? 'pb-[env(safe-area-inset-bottom)] sm:pb-0' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3 dark:border-zinc-700">
          <h2
            id="capture-title"
            className="text-sm font-semibold uppercase tracking-wider text-ink-muted"
          >
            {heading}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-muted hover:text-ink dark:text-zinc-400 dark:hover:text-zinc-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Todo panel (AI distill).
// ---------------------------------------------------------------------------

function AddTodoPanel({
  existingOpen,
  workspaceId,
  todoListHref,
  onCaptureTodo,
  onClose,
  onSuccess,
}: {
  existingOpen: ExistingTodo[];
  workspaceId: string | null;
  todoListHref?: string;
  onCaptureTodo?: (fd: FormData) => Promise<CaptureTodoResult>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Explicit `pending` boolean rather than `useTransition`: the package pins
  // `@types/react@18`, whose `TransitionFunction` rejects a Promise-returning
  // callback (`startTransition(async () => …)`), so the forks' transition form
  // doesn't typecheck here. A plain pending flag is the type-safe equivalent.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    if (!onCaptureTodo) {
      setError('todo capture is not wired');
      return;
    }
    const fd = new FormData();
    fd.set('message', trimmed);
    if (workspaceId) fd.set('workspace_id', workspaceId);
    setError(null);
    setPending(true);
    void (async () => {
      try {
        const res = await onCaptureTodo(fd);
        const count = res.captured;
        const msg =
          count === 0
            ? res.ack ?? 'No todos created — try more detail.'
            : `Captured ${count} ${count === 1 ? 'todo' : 'todos'}${res.ack ? ` · ${res.ack}` : ''}`;
        setMessage('');
        onSuccess(msg);
        setTimeout(onClose, 400);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'capture failed');
        setPending(false);
      }
    })();
  };

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSubmit} className="space-y-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          required
          placeholder="Describe what you want changed. The AI distills your prose into one or more discrete todos; OES can then dispatch a Claude job to fix them."
          className="w-full rounded border border-line bg-transparent px-2 py-1.5 font-mono text-sm dark:border-zinc-700"
        />
        {error ? (
          <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-end gap-2 border-t border-line pt-3 dark:border-zinc-700">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted hover:text-ink dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            Cancel
          </button>
          <PendingSubmitButton
            pending={pending}
            disabled={!message.trim()}
            className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${TINT_CLASSES.orange.accent}`}
            idleLabel="Distill into todo(s)"
            pendingLabel="Distilling…"
          />
        </div>
      </form>
      {existingOpen.length > 0 ? (
        <div className="mt-2 border-t border-line pt-3 dark:border-zinc-700">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Already open ({existingOpen.length}) — avoid duplicates
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {existingOpen.map((t) => (
              <li key={t.id} className="text-xs text-ink-muted dark:text-zinc-300">
                <span className="font-mono text-[10px] uppercase text-ink-muted">{t.priority}</span>
                <span className="ml-2">{t.title}</span>
              </li>
            ))}
          </ul>
          {todoListHref ? (
            <a
              href={todoListHref}
              className="mt-2 inline-block text-xs text-ink-muted underline underline-offset-2 hover:text-ink dark:hover:text-zinc-100"
            >
              Full list →
            </a>
          ) : null}
        </div>
      ) : (
        <div className="mt-2 border-t border-line pt-3 text-xs text-ink-muted dark:border-zinc-700">
          No open todos yet — this will be the first.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bug / Feature panel (shared).
// ---------------------------------------------------------------------------

function BugOrFeaturePanel({
  kind,
  deployedCommitSha,
  workspaceId,
  routeParams,
  reportListHref,
  reportSuccessCopy,
  onFileReport,
  onClose,
  onSuccess,
}: {
  kind: ReportKind;
  deployedCommitSha: string | null;
  workspaceId: string | null;
  routeParams?: Record<string, unknown>;
  reportListHref?: string;
  reportSuccessCopy?: (kind: ReportKind) => string;
  onFileReport?: (fd: FormData) => Promise<void>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const ctx = useCapturedContext(deployedCommitSha, kind);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Route params (host-injected, since the shell is next-free) populate
  // captured_params.route; workspaceId, when set, is threaded into both the
  // serialized params blob and a hidden input so the host action can scope it.
  const capturedParams = {
    ...ctx.capturedParams,
    route: routeParams ?? ctx.capturedParams.route,
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!onFileReport) {
      setError('report filing is not wired');
      return;
    }
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    setPending(true);
    try {
      await onFileReport(fd);
      const defaultCopy =
        kind === 'feature'
          ? 'Feature suggestion filed.'
          : 'Bug report filed.';
      onSuccess(reportSuccessCopy ? reportSuccessCopy(kind) : defaultCopy);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'submit failed');
      setPending(false);
    }
  };

  const submitLabel = kind === 'feature' ? 'File suggestion' : 'File report';
  const placeholder =
    kind === 'feature'
      ? 'What feature would you like? Describe the user-facing behavior, not the implementation.'
      : "What's wrong or what should change? Steps to reproduce, acceptance criteria.";
  const tint: Tint = kind === 'feature' ? 'indigo' : 'red';

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="rounded border border-line bg-surface-raised p-2 font-mono text-xs text-ink-muted dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">
        <div>Route: {ctx.capturedRoute}</div>
        {deployedCommitSha ? <div>Deploy: {deployedCommitSha.slice(0, 7)}</div> : null}
        {reportListHref ? (
          <div className="text-ink-muted">
            Filed as a raw report. Distill into todos at <code>{reportListHref}</code>.
          </div>
        ) : null}
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-muted dark:text-zinc-300">Title</label>
        <input
          name="title"
          required
          maxLength={200}
          placeholder="Short summary"
          autoFocus
          className="mt-1 w-full rounded border border-line bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-ink-muted dark:text-zinc-300">
          Description
        </label>
        <textarea
          name="description"
          required
          rows={5}
          maxLength={10_000}
          placeholder={placeholder}
          className="mt-1 w-full rounded border border-line bg-transparent px-2 py-1.5 font-mono text-sm dark:border-zinc-700"
        />
      </div>

      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="captured_route" value={ctx.capturedRoute} />
      <input type="hidden" name="captured_url" value={ctx.capturedUrl} />
      <input type="hidden" name="captured_params" value={JSON.stringify(capturedParams)} />
      <input type="hidden" name="captured_commit_sha" value={ctx.capturedCommitSha} />
      {workspaceId ? <input type="hidden" name="workspace_id" value={workspaceId} /> : null}

      {error ? (
        <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 border-t border-line pt-3 dark:border-zinc-700">
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-ink-muted hover:text-ink dark:text-zinc-300 dark:hover:text-zinc-100"
        >
          Cancel
        </button>
        <PendingSubmitButton
          pending={pending}
          className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${TINT_CLASSES[tint].accent}`}
          idleLabel={submitLabel}
          pendingLabel="Filing…"
        />
      </div>
    </form>
  );
}
