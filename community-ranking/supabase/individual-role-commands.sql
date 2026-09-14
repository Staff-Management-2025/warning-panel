-- Permit individual role operations; retain earlier actions for audit history.
begin;
alter table public.ranking_jobs drop constraint if exists ranking_jobs_action_check;
alter table public.ranking_jobs add constraint ranking_jobs_action_check
  check (action in ('addrole', 'removerole', 'change', 'promote', 'demote', 'kick', 'ban', 'restore'));
commit;
