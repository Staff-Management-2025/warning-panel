-- Dedicated Authority Community Ranking database. All access is server-only.
create table public.ranking_accounts (
  site_user_id text primary key,
  roblox_id text not null unique check (roblox_id ~ '^[0-9]+$'),
  username text not null,
  verified_at timestamptz not null default now()
);
create table public.ranking_challenges (
  site_user_id text primary key,
  roblox_id text not null,
  username text not null,
  code text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.ranking_jobs (
  id uuid primary key default gen_random_uuid(),
  actor_id text not null references public.ranking_accounts(site_user_id),
  actor_roblox_id text not null,
  command text not null,
  action text not null check (action in ('promote','demote','kick','ban')),
  target_role_id text,
  target_role_name text,
  is_bulk boolean not null default false,
  items jsonb not null check (jsonb_typeof(items) = 'array'),
  total integer not null,
  completed integer not null default 0,
  failed integer not null default 0,
  skipped integer not null default 0,
  status text not null default 'preview' check (status in ('preview','queued','running','completed','partial','cancelled')),
  error text,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ranking_jobs_actor_time on public.ranking_jobs(actor_id, created_at desc);
alter table public.ranking_accounts enable row level security;
alter table public.ranking_challenges enable row level security;
alter table public.ranking_jobs enable row level security;
revoke all on public.ranking_accounts, public.ranking_challenges, public.ranking_jobs from anon, authenticated;
grant select, insert, update, delete on public.ranking_accounts, public.ranking_challenges, public.ranking_jobs to service_role;

create function public.ranking_begin_proof(p_actor text, p_user text, p_username text, p_code text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.ranking_challenges;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_actor, 0));
  if exists(select 1 from public.ranking_accounts where site_user_id=p_actor) then raise exception 'This sign-in is already linked to a Roblox account.'; end if;
  if exists(select 1 from public.ranking_challenges where site_user_id=p_actor and created_at > now()-interval '30 seconds') then raise exception 'Wait 30 seconds before requesting another code.'; end if;
  insert into public.ranking_challenges(site_user_id,roblox_id,username,code,expires_at)
  values(p_actor,p_user,p_username,p_code,now()+interval '10 minutes')
  on conflict(site_user_id) do update set roblox_id=excluded.roblox_id, username=excluded.username, code=excluded.code, expires_at=excluded.expires_at,created_at=now()
  returning * into r;
  return to_jsonb(r);
end $$;

create function public.ranking_finish_proof(p_actor text, p_code text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.ranking_challenges; a public.ranking_accounts;
begin
  select * into c from public.ranking_challenges where site_user_id=p_actor for update;
  if c.site_user_id is null or c.expires_at<=now() or c.code<>p_code then raise exception 'Verification expired. Request a new code.'; end if;
  insert into public.ranking_accounts(site_user_id,roblox_id,username) values(p_actor,c.roblox_id,c.username) returning * into a;
  delete from public.ranking_challenges where site_user_id=p_actor;
  return to_jsonb(a);
exception when unique_violation then raise exception 'This Roblox account is already linked to another sign-in.';
end $$;

create function public.ranking_claim_job(p_actor text, p_job uuid, p_lease uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.ranking_jobs;
begin
  -- Only one batch in this community may write to Roblox at a time.
  perform pg_advisory_xact_lock(526651322);
  select * into j from public.ranking_jobs where id=p_job and actor_id=p_actor for update;
  if j.id is null then raise exception 'Command not found.'; end if;
  if j.status in ('completed','partial','cancelled') then return to_jsonb(j); end if;
  if j.status='preview' and j.created_at<now()-interval '10 minutes' then raise exception 'This preview expired. Review the command again.'; end if;
  if exists(select 1 from public.ranking_jobs where lease_until>now()) then raise exception 'Another batch is running. Please wait a moment and resume.'; end if;
  update public.ranking_jobs set status='running',lease_token=p_lease,lease_until=now()+interval '90 seconds',updated_at=now() where id=j.id returning * into j;
  return to_jsonb(j);
end $$;

create function public.ranking_save_job(p_actor text, p_job uuid, p_lease uuid, p_items jsonb, p_release boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.ranking_jobs; done_count integer; failed_count integer; pending_count integer;
begin
  select * into j from public.ranking_jobs where id=p_job and actor_id=p_actor and lease_token=p_lease and lease_until>now() for update;
  if j.id is null then raise exception 'The processing lease expired. Resume to check the saved result.'; end if;
  if jsonb_array_length(p_items)<>j.total then raise exception 'Invalid job item count.'; end if;
  select count(*) filter(where value->>'status'='completed'), count(*) filter(where value->>'status'='failed'), count(*) filter(where value->>'status' in ('pending','processing')) into done_count,failed_count,pending_count from jsonb_array_elements(p_items);
  update public.ranking_jobs set items=p_items,completed=done_count,failed=failed_count,
    status=case when pending_count=0 then case when failed_count=0 then 'completed' else 'partial' end else 'running' end,
    lease_token=case when p_release then null else p_lease end,
    lease_until=case when p_release then null else now()+interval '90 seconds' end,
    updated_at=now() where id=j.id returning * into j;
  return to_jsonb(j);
end $$;

revoke execute on function public.ranking_begin_proof(text,text,text,text) from public, anon, authenticated;
revoke execute on function public.ranking_finish_proof(text,text) from public, anon, authenticated;
revoke execute on function public.ranking_claim_job(text,uuid,uuid) from public, anon, authenticated;
revoke execute on function public.ranking_save_job(text,uuid,uuid,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.ranking_begin_proof(text,text,text,text) to service_role;
grant execute on function public.ranking_finish_proof(text,text) to service_role;
grant execute on function public.ranking_claim_job(text,uuid,uuid) to service_role;
grant execute on function public.ranking_save_job(text,uuid,uuid,jsonb,boolean) to service_role;
