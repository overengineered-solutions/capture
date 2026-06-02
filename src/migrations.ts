/**
 * `@overengineered-solutions/capture/migrations` — canonical local-mirror SQL.
 *
 * OES is the single source of truth for feedback (see `./core`'s sink client).
 * But an app MAY keep a thin LOCAL mirror — for in-app "your open items"
 * display, or (the legacy mode) local-first triage before the central sink.
 * These exported strings are the canonical baseline table shapes the portfolio
 * forks converged on. RLS is intentionally NOT included: the owner/admin gate
 * differs per app — add your own policy in the same migration.
 */

/** A `set_updated_at()` trigger function the tables below assume exists. */
export const SET_UPDATED_AT_FN_SQL = `
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
`.trim();

/** Raw bug/feature report staging inbox. Admin distills `new` rows into todos. */
export const BUG_REPORTS_TABLE_SQL = `
create table if not exists public.bug_reports (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  description text not null check (char_length(description) between 1 and 10000),
  context jsonb,
  status text not null default 'new' check (status in ('new','distilled','dismissed')),
  distilled_at timestamptz,
  distilled_into_todo_ids uuid[],
  dismissed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bug_reports_status_created_at_idx
  on public.bug_reports (status, created_at desc);
create trigger bug_reports_set_updated_at before update on public.bug_reports
  for each row execute function public.set_updated_at();
`.trim();

/**
 * Canonical todo baseline — the OES-todo contract shape every app exposes via
 * `/api/oes/todos`. Apps extend it (project_id, tenant_id, assignee, steps…);
 * these are the lowest-common-denominator columns.
 */
export const TODOS_TABLE_SQL = `
create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  description text not null check (char_length(description) between 1 and 10000),
  priority text not null default 'medium' check (priority in ('high','medium','low')),
  status text not null default 'open' check (status in ('open','in_progress','done_claimed','resolved','wont_fix')),
  category text,
  file_hints text[],
  context jsonb,
  build_job_id uuid,
  dispatched_at timestamptz,
  resolved_at timestamptz,
  resolved_by_commit text,
  resolved_notes text,
  source text,
  confidence text check (confidence in ('high','low')),
  last_user_update_at timestamptz,
  last_verify_run_at timestamptz,
  kind text not null default 'todo' check (kind in ('todo','test')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists todos_status_created_at_idx
  on public.todos (status, created_at desc);
create trigger todos_set_updated_at before update on public.todos
  for each row execute function public.set_updated_at();
`.trim();

/** All three statements concatenated, in dependency order (fn → tables). */
export const CAPTURE_LOCAL_MIRROR_SQL = [
  SET_UPDATED_AT_FN_SQL,
  BUG_REPORTS_TABLE_SQL,
  TODOS_TABLE_SQL,
].join('\n\n');
