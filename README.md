# @overengineered-solutions/capture

The standardized **CaptureBubble** — the friend-blue helper bubble pinned bottom-right of every OES site. Click it and it expands into a tabbed surface: an **AI helper**, **AI-distilled todo capture**, **bug report**, and **feature request**. Members file bugs and features; operators file todos that flow to OES and become dispatchable AI build-jobs.

This package is the **single source of truth** for that widget. It collapses the portfolio's copy-paste forks — which had already drifted (one fork has the accessible focus-trap, another the popover UX, another role-gated tabs, the template none of it) — into one adapter-injected shell. Apps depend on it and wire ~15 lines of adapters; a version bump fans the fix out to every app via Renovate, instead of a copy-paste that rots. It is a textbook application of the OES canonical-vs-shim doctrine (no copy-paste-with-one-field-changed).

The shell owns **zero app-specific code**: report/todo sinks are adapters, the AI tab is an injected node, and role gating is precomputed by the host into `enabledTabs`.

## Self-styling (v0.2.0)

The bubble is **self-styling**: it injects one scoped `<style id="oescap-styles">` block at runtime (idempotent, SSR-safe) and paints itself entirely with `.oescap-*` selectors. It renders **pixel-correct with ZERO host Tailwind / design tokens** — drop it into a bare page and it just works.

> Why: v0.1.x baked Tailwind utility classes into the dist JS, but no consuming app scans `node_modules` in its Tailwind `content`/`@source`, so those classes were never generated — the bubble lost its positioning (fell to the top-left, unstyled) and looked different in every app. v0.2.0 stops relying on host CSS entirely.

The default identity is a **light-blue accent** (`--oescap-accent: #38bdf8`) with an inline **chat-bubble SVG** FAB.

## Install

```bash
pnpm add @overengineered-solutions/capture
```

`react >=18` and `react-dom >=18` are required peers.

## Usage

The shell is a client component. Wire it from a thin server **mount** that resolves the user/role, computes which tabs to show, fetches the duplicate-hint list, and binds the sink adapters.

```tsx
// app/_components/capture-bubble-mount.tsx  (server component)
import { CaptureBubble } from '@overengineered-solutions/capture';
import { createFileReportAction, resolveCapturedDefaults } from '@overengineered-solutions/capture/core';
import { getUser } from '@/lib/auth';
import { listTodos } from '@/lib/todos';
import { captureTodosFromFabAction } from '@/app/admin/todos/actions';

export async function CaptureBubbleMount() {
  const user = await getUser();
  if (!user) return null; // anonymous → no bubble

  const isAdmin = user.role === 'admin';

  // The two identical lines every host runs (open-todo hints + commit sha).
  const { existingOpen, deployedCommitSha } = await resolveCapturedDefaults({
    listOpenTodos: isAdmin ? () => listTodos({ status: 'open', limit: 10 }) : undefined,
  });

  // Reports flow to the central OES inbox (service-level secret, not a user session).
  const onFileReport = createFileReportAction({
    oesBaseUrl: process.env.OES_BASE_URL!,
    dashboardSecret: process.env.OES_DASHBOARD_SECRET!,
    appSlug: 'your-app',
  });

  return (
    <CaptureBubble
      existingOpen={existingOpen}
      deployedCommitSha={deployedCommitSha}
      // members file bugs + features; only admins get the paid AI todo distiller
      enabledTabs={isAdmin ? undefined : { todo: false, bug: true, feature: true }}
      onCaptureTodo={captureTodosFromFabAction}
      onFileReport={onFileReport}
      // aiTab={{ label: 'Hand off', panel: <YourChatPanel /> }}   // optional, injected
    />
  );
}
```

Mount it once in your root layout: `<CaptureBubbleMount />`.

Key props (full contract in `CaptureBubbleProps`):

- `enabledTabs` — per-tab visibility, **precomputed by the host** from role/flags. The package stays role-agnostic.
- `onCaptureTodo` / `onFileReport` — the sink adapters (the two former hard-imports). Bind your server actions.
- `aiTab` — an injected `{ label?, panel }`. The package is chat-agnostic; pass makeros's streaming chat or OES's hand-off panel here, or omit it.
- `surface` — `'modal'` (default) or `'popover'` (no backdrop, click-outside dismiss).
- `mobile` — lift the FAB above a bottom nav and pad the sheet for the home bar.
- `diagnostics` — `{ enabled?: boolean; hookConsoleError?: boolean }`. Auto-diagnostics are **on by default**; pass `{ enabled: false }` to disable, or `{ hookConsoleError: true }` to also mirror `console.error` into the ring buffer. (see below)
- `enableScreenshot` — `boolean` (default `false`). Show the opt-in "Attach screenshot" button in the Bug + Feature panels. (see below)

## Error-boundary usage (`error.tsx` / `global-error.tsx`)

Because the bubble self-styles and guards every DOM/window access, it is **safe to mount in Next's error boundaries**, where the app's CSS / providers / layout may be absent. The sinks stay injected adapters, so server actions still work from an error boundary.

```tsx
// app/global-error.tsx  ('use client' — global-error replaces the root layout)
'use client';
import { CaptureBubble } from '@overengineered-solutions/capture';
import { fileReportFromErrorPage } from '@/app/actions/file-report'; // a 'use server' action

export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <html>
      <body>
        <h1>Something went wrong</h1>
        <button onClick={reset}>Try again</button>
        {/* No design tokens / Tailwind needed — the bubble paints itself. The
            recentErrors ring buffer will already hold the error that tripped
            the boundary. enableScreenshot is handy here. */}
        <CaptureBubble
          enabledTabs={{ todo: false, bug: true, feature: false }}
          onFileReport={fileReportFromErrorPage}
          enableScreenshot
        />
      </body>
    </html>
  );
}
```

`error.tsx` is the same minus the `<html>/<body>` wrapper. Keep `onFileReport` (and `onCaptureTodo`) bound to server actions imported into the client error component — they file from the error boundary fine.

## Auto-diagnostics

Every **bug** and **feature** report auto-stamps `captured_params.diagnostics`:

- `browser` — `{ userAgent, language, viewport {w,h}, screen {w,h}, devicePixelRatio, online, referrer, capturedAt }` (ISO).
- `recentErrors` — a capped ring buffer (last **15**) of recent runtime errors `{ message, source, line, col, stack(truncated), ts }`, captured via `window.onerror` / `'error'` / `'unhandledrejection'` (and, opt-in, `console.error`). Feature reports ship `recentErrors: []`.

Stacks/messages are truncated and the serialized blob is byte-clamped (≤32 KiB) so the captured context stays comfortably under the OES route's 64 KiB ceiling. No dependencies — pure browser primitives. The gatherers are exported from `@overengineered-solutions/capture/diagnostics` for direct use/testing.

## Opt-in masked screenshot

Set `enableScreenshot` to surface an **"Attach screenshot"** button in the Bug and Feature panels. Nothing is captured (and **modern-screenshot** is never loaded — it's a dynamic `import()`) until the user clicks it.

**Redaction.** Before rasterizing, a `.oescap-redacting` class is toggled on `<html>` so the rendered values of form fields (`input`/`textarea`/`select`, and **never** password fields) and any element you mark with `[data-capture-redact]` paint as solid blocks. The class is always removed afterward (even if capture throws).

**Contract — how the Blob reaches your action.** When a screenshot is attached, its PNG Blob is appended to the report **FormData as a `screenshot` File**. Your `onFileReport(fd)` reads it and uploads it — the package is **storage-agnostic** (it adds NO OES/Supabase upload code):

```ts
// inside your 'use server' onFileReport(fd: FormData)
const shot = fd.get('screenshot');
if (shot instanceof File && shot.size > 0) {
  // upload to your storage of choice (e.g. Supabase Storage), then attach the
  // resulting URL to the report context before forwarding to the OES sink.
}
```

Capture failures are **non-fatal**: the panel shows a small inline "screenshot failed" and the report sends without it.

## `@overengineered-solutions/capture/core`

Server-side glue (holds the OES secret — never import into a client file):

- `createFileReportAction(config)` / `createOesFeedbackClient(config)` — POST reports to the central OES inbox (`POST /api/oes/feedback`), authenticated by the app's dashboard secret. Maps the shell's `feature` to OES's `idea`.
- `createDistiller(provider)` / `DistillProvider` — the todo-distiller interface. Inject a Claude-backed provider (resolve it via `@overengineered-solutions/ai-runtime`'s BYO→pool→off resolver); the package never bundles an LLM client.
- `resolveCapturedDefaults({ listOpenTodos })` — the open-todo hints + `VERCEL_GIT_COMMIT_SHA` boilerplate every mount runs.

## `@overengineered-solutions/capture/migrations`

Canonical local-mirror SQL (`BUG_REPORTS_TABLE_SQL`, `TODOS_TABLE_SQL`, `CAPTURE_LOCAL_MIRROR_SQL`). OES is the SSOT for feedback; an app uses these only if it keeps a thin local mirror. RLS is intentionally excluded — add the owner/admin policy that fits your app in the same migration.

## `@overengineered-solutions/capture/theme`

The **CSS-variable theming contract** (`CAPTURE_THEME_VARS`, `CAPTURE_STYLES_CSS`, `CAPTURE_THEME_DEFAULTS_CSS`, `ensureCaptureStyles`). You do **not** need to import any CSS — the bubble injects its scoped stylesheet (with baked-in OES defaults) on mount. Every visual knob is a `--oescap-*` custom property:

`--oescap-accent` (default `#38bdf8`, light blue), `--oescap-accent-contrast`, `--oescap-surface`, `--oescap-surface-raised`, `--oescap-ink`, `--oescap-ink-muted`, `--oescap-line`, `--oescap-radius`, `--oescap-z`, `--oescap-shadow` (full list in `CAPTURE_THEME_VARS`).

**The defaults ARE the OES look — the single source of truth.** Out-of-the-box every app looks identical. To retheme one app, override a var in that app's own CSS:

```css
:root {
  --oescap-accent: #ec4899;          /* retheme this app to pink */
  --oescap-accent-contrast: #ffffff;
  --oescap-radius: 1rem;
}
```

To change the **global default look** for the whole portfolio, edit the defaults in this package's `src/styles.ts` → version-bump → it propagates to every app via Renovate.

> `./theme` also re-exports the deprecated v0.1.x `CAPTURE_DESIGN_TOKENS` / `captureThemeCss` / `captureBubbleKeyframesCss` for back-compat. New hosts need none of them.

## License

MIT
