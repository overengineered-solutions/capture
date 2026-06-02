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
import { ensureCaptureStyles } from './styles';
import {
  gatherDiagnostics,
  installErrorCapture,
  serializeDiagnostics,
} from './diagnostics';

/**
 * `@overengineered-solutions/capture` — the canonical CaptureBubble shell.
 *
 * One floating bottom-right bubble that opens a tabbed surface for the four
 * capture modes (AI helper / Todo / Bug / Feature). The shell is
 * adapter-injected and app-agnostic: the report/todo sinks are passed in as
 * `onFileReport` / `onCaptureTodo`, the AI tab is an injected `ReactNode`, and
 * role/flag gating is precomputed into `enabledTabs`. It imports NOTHING
 * relative or app-specific and has zero runtime deps beyond react (the optional
 * screenshot lib is loaded via dynamic `import()` only on demand). The page
 * context is derived from browser primitives (no `next/navigation`).
 *
 * v0.2.0 — SELF-STYLING. The shell injects its own scoped `.oescap-*`
 * stylesheet at runtime (idempotent, SSR-safe) and reads `--oescap-*` CSS
 * variables for theming, so it renders pixel-correct with ZERO host Tailwind /
 * design tokens — safe to mount in `error.tsx` / `global-error.tsx`. The FAB is
 * an inline chat-bubble SVG on the light-blue OES accent. Bug/Feature reports
 * auto-stamp a browser + recent-errors diagnostics blob, and an opt-in masked
 * screenshot can be attached.
 *
 * One component, two surfaces:
 *   - `surface="modal"` (default) — bottom-sheet → centered dialog with a
 *     darkened backdrop and a WCAG-compliant focus trap.
 *   - `surface="popover"` — anchored bottom-right, no backdrop, click-outside
 *     dismiss; the popover replaces the FAB in the corner while open.
 *
 * Both surfaces render the SAME inner tabbed body — no panel duplication.
 */

// ---------------------------------------------------------------------------
// Inline icons (no emoji dependence; currentColor so they tint with the CSS).
// ---------------------------------------------------------------------------

function ChatBubbleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

type TabTint = 'ai' | 'todo' | 'bug' | 'feature';

const TAB_META: Record<CaptureTabKey, { label: string; tint: TabTint; icon: ReactNode }> = {
  ai: { label: 'Chat', tint: 'ai', icon: <ChatBubbleIcon className="oescap-tab__icon" /> },
  todo: { label: 'Todo', tint: 'todo', icon: <span aria-hidden>📝</span> },
  bug: { label: 'Bug', tint: 'bug', icon: <span aria-hidden>🛠</span> },
  feature: { label: 'Feature', tint: 'feature', icon: <span aria-hidden>💡</span> },
};

// ---------------------------------------------------------------------------
// Internalized pending-aware submit button.
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
// Derived from window.location. Read lazily on mount (effect) so SSR stays
// inert and the first client render matches the server's empty snapshot.
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
  diagnostics,
  enableScreenshot,
}: CaptureBubbleProps) {
  // Defaults.
  const openTodos = existingOpen ?? [];
  const commitSha = deployedCommitSha ?? null;
  const heading = title ?? 'Capture';
  const surfaceMode = surface ?? 'modal';
  const isMobile = mobile ?? false;
  const wsId = workspaceId ?? null;
  const diagEnabled = diagnostics?.enabled !== false;
  const screenshotEnabled = enableScreenshot ?? false;

  // SELF-STYLING: inject the scoped stylesheet once (idempotent, SSR-safe).
  // Run in an effect so SSR never touches the DOM; the first paint after
  // hydration carries the styles. Also installs the error ring buffer.
  useEffect(() => {
    ensureCaptureStyles();
    if (diagEnabled) {
      installErrorCapture({ hookConsoleError: diagnostics?.hookConsoleError ?? false });
    }
  }, [diagEnabled, diagnostics?.hookConsoleError]);

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

  const fab = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Capture / chat"
      aria-label={tabs[0] === 'ai' ? 'Open chat' : 'Open capture and chat menu'}
      aria-haspopup="dialog"
      className={`oescap-fab${isMobile ? ' oescap-fab--mobile' : ''}`}
    >
      <ChatBubbleIcon className="oescap-fab__icon" />
    </button>
  );

  // The inner tabbed body — shared verbatim by both surfaces (no duplication).
  const body = (
    <>
      <div className="oescap-tabs">
        {tabs.map((key) => {
          const meta = TAB_META[key];
          // The AI tab can override its label via aiTab.label (OES renders
          // "Hand off" instead of the generic "Chat").
          const label = key === 'ai' && aiTab?.label ? aiTab.label : meta.label;
          const isActive = key === active;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActive(key)}
              className={`oescap-tab oescap-tab--${meta.tint}${
                isActive ? ' oescap-tab--active' : ''
              }`}
            >
              {meta.icon}
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="oescap-panel-body">
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
            diagEnabled={diagEnabled}
            enableScreenshot={screenshotEnabled}
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
            diagEnabled={diagEnabled}
            enableScreenshot={screenshotEnabled}
            onFileReport={onFileReport}
            onClose={() => setOpen(false)}
            onSuccess={(msg) => setToast(msg)}
          />
        ) : null}
      </div>
    </>
  );

  return (
    <div className="oescap-root">
      {toast ? <div className="oescap-toast">{toast}</div> : null}

      {surfaceMode === 'popover' ? (
        // Popover: no backdrop, anchored bottom-right, FAB hidden while open
        // (the popover replaces it in the corner). aria-modal is false.
        open ? (
          <div
            ref={popoverRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="oescap-title"
            className="oescap-popover"
          >
            <div className="oescap-header">
              <h2 id="oescap-title" className="oescap-title">
                {heading}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="oescap-close"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="oescap-body">{body}</div>
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
    </div>
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
    <div className="oescap-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="oescap-title"
        tabIndex={-1}
        className={`oescap-panel${mobile ? ' oescap-panel--mobile' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="oescap-header">
          <h2 id="oescap-title" className="oescap-title">
            {heading}
          </h2>
          <button type="button" onClick={onClose} className="oescap-close" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="oescap-body">{children}</div>
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
    <div className="oescap-stack">
      <form onSubmit={onSubmit} className="oescap-stack">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          required
          placeholder="Describe what you want changed. The AI distills your prose into one or more discrete todos; OES can then dispatch a Claude job to fix them."
          className="oescap-textarea"
        />
        {error ? <p className="oescap-error">{error}</p> : null}
        <div className="oescap-actions">
          <button type="button" onClick={onClose} className="oescap-btn oescap-btn--ghost">
            Cancel
          </button>
          <PendingSubmitButton
            pending={pending}
            disabled={!message.trim()}
            className="oescap-btn oescap-btn--todo"
            idleLabel="Distill into todo(s)"
            pendingLabel="Distilling…"
          />
        </div>
      </form>
      {existingOpen.length > 0 ? (
        <div className="oescap-hint">
          <p className="oescap-hint__head">
            Already open ({existingOpen.length}) — avoid duplicates
          </p>
          <ul className="oescap-hint__list">
            {existingOpen.map((t) => (
              <li key={t.id} className="oescap-hint__item">
                <span className="oescap-hint__pri">{t.priority}</span>
                <span className="oescap-hint__title">{t.title}</span>
              </li>
            ))}
          </ul>
          {todoListHref ? (
            <a href={todoListHref} className="oescap-link">
              Full list →
            </a>
          ) : null}
        </div>
      ) : (
        <div className="oescap-hint oescap-hint__item">
          No open todos yet — this will be the first.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bug / Feature panel (shared).
// ---------------------------------------------------------------------------

type AttachedShot = { dataUrl: string; blob: Blob };

function BugOrFeaturePanel({
  kind,
  deployedCommitSha,
  workspaceId,
  routeParams,
  reportListHref,
  reportSuccessCopy,
  diagEnabled,
  enableScreenshot,
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
  diagEnabled: boolean;
  enableScreenshot: boolean;
  onFileReport?: (fd: FormData) => Promise<void>;
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const ctx = useCapturedContext(deployedCommitSha, kind);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Screenshot state (opt-in; nothing captured until the user clicks).
  const [shot, setShot] = useState<AttachedShot | null>(null);
  const [shotPending, setShotPending] = useState(false);
  const [shotError, setShotError] = useState<string | null>(null);

  const onAttachScreenshot = () => {
    setShotError(null);
    setShotPending(true);
    void (async () => {
      try {
        // Dynamic import: modern-screenshot stays out of the main chunk and is
        // only fetched the first time a user attaches a shot.
        const { captureMaskedScreenshot } = await import('./screenshot');
        const result = await captureMaskedScreenshot();
        setShot({ dataUrl: result.dataUrl, blob: result.blob });
      } catch (err) {
        // Non-fatal: surface inline and let the report send without the shot.
        setShotError(err instanceof Error ? err.message : 'screenshot failed');
      } finally {
        setShotPending(false);
      }
    })();
  };

  // Route params (host-injected, since the shell is next-free) populate
  // captured_params.route; workspaceId, when set, is threaded into both the
  // serialized params blob and a hidden input so the host action can scope it.
  // v0.2.0: stamp the diagnostics blob (browser + recentErrors) here too. We
  // recompute at SUBMIT time (below) so the ring buffer is current, but seed a
  // hidden input from this render-time value as a fallback.
  const baseCapturedParams = {
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

    // Recompute captured_params at submit time so recentErrors is current
    // (errors may have occurred after the panel first rendered). Feature
    // reports get the same page+browser stamp with recentErrors: [].
    if (diagEnabled) {
      try {
        const diag = gatherDiagnostics({ includeErrors: kind === 'bug' });
        const params = {
          ...baseCapturedParams,
          diagnostics: JSON.parse(serializeDiagnostics(diag)) as unknown,
        };
        fd.set('captured_params', JSON.stringify(params));
      } catch {
        // Diagnostics are best-effort; never block a report on them.
      }
    }

    // Attach the screenshot Blob (if any) as a File on the report FormData.
    if (shot) {
      try {
        const file = new File([shot.blob], 'screenshot.png', { type: 'image/png' });
        fd.set('screenshot', file);
      } catch {
        // If File isn't constructible, append the raw Blob instead.
        fd.set('screenshot', shot.blob, 'screenshot.png');
      }
    }

    setError(null);
    setPending(true);
    try {
      await onFileReport(fd);
      const defaultCopy =
        kind === 'feature' ? 'Feature suggestion filed.' : 'Bug report filed.';
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
  const btnTint = kind === 'feature' ? 'oescap-btn--feature' : 'oescap-btn--bug';

  return (
    <form onSubmit={onSubmit} className="oescap-stack">
      <div className="oescap-context">
        <div>Route: {ctx.capturedRoute || '/'}</div>
        {deployedCommitSha ? <div>Deploy: {deployedCommitSha.slice(0, 7)}</div> : null}
        {diagEnabled ? (
          <div>Diagnostics: browser + recent errors auto-attached</div>
        ) : null}
        {reportListHref ? (
          <div>
            Filed as a raw report. Distill into todos at <code>{reportListHref}</code>.
          </div>
        ) : null}
      </div>

      <div className="oescap-field">
        <label className="oescap-label">Title</label>
        <input
          name="title"
          required
          maxLength={200}
          placeholder="Short summary"
          autoFocus
          className="oescap-input"
        />
      </div>

      <div className="oescap-field">
        <label className="oescap-label">Description</label>
        <textarea
          name="description"
          required
          rows={5}
          maxLength={10_000}
          placeholder={placeholder}
          className="oescap-textarea"
        />
      </div>

      {enableScreenshot ? (
        <div className="oescap-shot">
          {shot ? (
            <div className="oescap-shot__preview">
              <img
                src={shot.dataUrl}
                alt="Captured screenshot preview"
                className="oescap-shot__thumb"
              />
              <button
                type="button"
                onClick={() => setShot(null)}
                className="oescap-shot__remove"
                aria-label="Remove screenshot"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={onAttachScreenshot}
              disabled={shotPending}
              className="oescap-btn oescap-shot__btn"
            >
              {shotPending ? 'Capturing…' : '📷 Add a screenshot?'}
            </button>
          )}
          <p className="oescap-shot__hint">
            Form fields are masked before capture. Mark extra elements with{' '}
            <code>data-capture-redact</code>.
          </p>
          {shotError ? <p className="oescap-shot__err">Screenshot failed: {shotError}</p> : null}
        </div>
      ) : null}

      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="captured_route" value={ctx.capturedRoute} />
      <input type="hidden" name="captured_url" value={ctx.capturedUrl} />
      <input type="hidden" name="captured_params" value={JSON.stringify(baseCapturedParams)} />
      <input type="hidden" name="captured_commit_sha" value={ctx.capturedCommitSha} />
      {workspaceId ? <input type="hidden" name="workspace_id" value={workspaceId} /> : null}

      {error ? <p className="oescap-error">{error}</p> : null}

      <div className="oescap-actions">
        <button type="button" onClick={onClose} className="oescap-btn oescap-btn--ghost">
          Cancel
        </button>
        <PendingSubmitButton
          pending={pending}
          className={`oescap-btn ${btnTint}`}
          idleLabel={submitLabel}
          pendingLabel="Filing…"
        />
      </div>
    </form>
  );
}
