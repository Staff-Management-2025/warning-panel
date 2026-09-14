-- Permit the unified command while retaining historical audit records.
begin;
alter table public.ranking_jobs drop constraint if exists ranking_jobs_action_check;
alter table public.ranking_jobs add constraint ranking_jobs_action_check
  check (action in ('change', 'promote', 'demote', 'kick', 'ban', 'restore'));
commit;
