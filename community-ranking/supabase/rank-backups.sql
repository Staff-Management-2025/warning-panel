-- Immutable, complete community rank saves. Browser roles have no access.
begin;

create table if not exists public.ranking_rank_snapshots (
  id uuid primary key default gen_random_uuid(),
  group_id text not null default '526651322' check (group_id = '526651322'),
  created_by text not null references public.ranking_accounts(site_user_id),
  created_at timestamptz not null default now(),
  started_at timestamptz not null,
  member_count integer not null check (member_count > 0 and member_count <= 5000),
  members jsonb not null check (jsonb_typeof(members) = 'array' and jsonb_array_length(members) = member_count),
  roles jsonb not null check (jsonb_typeof(roles) = 'array')
);
create index if not exists ranking_rank_snapshots_latest on public.ranking_rank_snapshots(created_at desc);
alter table public.ranking_rank_snapshots enable row level security;
revoke all on public.ranking_rank_snapshots from public, anon, authenticated;
grant select, insert on public.ranking_rank_snapshots to service_role;

alter table public.ranking_jobs drop constraint if exists ranking_jobs_action_check;
alter table public.ranking_jobs add constraint ranking_jobs_action_check
  check (action in ('promote', 'demote', 'kick', 'ban', 'restore'));
alter table public.ranking_jobs add column if not exists snapshot_id uuid references public.ranking_rank_snapshots(id);
create index if not exists ranking_jobs_snapshot on public.ranking_jobs(snapshot_id) where snapshot_id is not null;

create or replace function public.ranking_save_rank_snapshot(
  p_actor text, p_started_at timestamptz, p_members jsonb, p_roles jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare saved public.ranking_rank_snapshots;
begin
  if not exists (
    select 1 from public.ranking_accounts
    where site_user_id = p_actor and roblox_id = '7468655528'
  ) then raise exception 'Only the Owner can save ranks.'; end if;

  perform pg_advisory_xact_lock(526651322);
  if exists (select 1 from public.ranking_jobs where lease_until > now()
    or (updated_at >= p_started_at and status <> 'preview'))
  then raise exception 'A command ran while ranks were being read. Wait for it to finish, then save again.'; end if;
  if exists (select 1 from public.ranking_rank_snapshots where created_at > now() - interval '30 seconds')
  then raise exception 'Wait 30 seconds before saving ranks again.'; end if;

  insert into public.ranking_rank_snapshots(created_by, started_at, member_count, members, roles)
  values (p_actor, p_started_at, jsonb_array_length(p_members), p_members, p_roles)
  returning * into saved;
  return jsonb_build_object('id', saved.id, 'created_at', saved.created_at, 'member_count', saved.member_count);
end $$;
revoke execute on function public.ranking_save_rank_snapshot(text,timestamptz,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.ranking_save_rank_snapshot(text,timestamptz,jsonb,jsonb) to service_role;

commit;
