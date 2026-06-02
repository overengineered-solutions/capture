# @overengineered-solutions/capture

The standardized **CaptureBubble** — the friend-blue helper bubble pinned bottom-right of every OES site. Click it and it expands into a tabbed surface: an **AI helper**, **AI-distilled todo capture**, **bug report**, and **feature request**. Members file bugs and features; operators file todos that flow to OES and become dispatchable AI build-jobs.

This package is the **single source of truth** for that widget. It collapses the portfolio's copy-paste forks — which had already drifted (one fork has the accessible focus-trap, another the popover UX, another role-gated tabs, the template none of it) — into one adapter-injected shell. Apps depend on it and wire ~15 lines of adapters; a version bump fans the fix out to every app via Renovate, instead of a copy-paste that rots. It is a textbook application of the OES canonical-vs-shim doctrine (no copy-paste-with-one-field-changed).

The shell owns **zero app-specific code**: report/todo sinks are adapters, the AI tab is an injected node, and role gating is precomputed by the host into `enabledTabs`.

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

## `@overengineered-solutions/capture/core`

Server-side glue (holds the OES secret — never import into a client file):

- `createFileReportAction(config)` / `createOesFeedbackClient(config)` — POST reports to the central OES inbox (`POST /api/oes/feedback`), authenticated by the app's dashboard secret. Maps the shell's `feature` to OES's `idea`.
- `createDistiller(provider)` / `DistillProvider` — the todo-distiller interface. Inject a Claude-backed provider (resolve it via `@overengineered-solutions/ai-runtime`'s BYO→pool→off resolver); the package never bundles an LLM client.
- `resolveCapturedDefaults({ listOpenTodos })` — the open-todo hints + `VERCEL_GIT_COMMIT_SHA` boilerplate every mount runs.

## `@overengineered-solutions/capture/migrations`

Canonical local-mirror SQL (`BUG_REPORTS_TABLE_SQL`, `TODOS_TABLE_SQL`, `CAPTURE_LOCAL_MIRROR_SQL`). OES is the SSOT for feedback; an app uses these only if it keeps a thin local mirror. RLS is intentionally excluded — add the owner/admin policy that fits your app in the same migration.

## `@overengineered-solutions/capture/theme`

The design-token contract (`CAPTURE_DESIGN_TOKENS`, `captureThemeCss`, `captureBubbleKeyframesCss`). Apps scaffolded from the template already define these tokens; a new host imports `captureThemeCss` to satisfy the contract (friend-blue `sky-500` accent, surface/ink/line tokens, the `bubble-grow` keyframe).

## License

MIT
