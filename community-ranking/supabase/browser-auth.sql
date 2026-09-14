-- Roblox profile verification for GitHub Pages. Only the Edge Function's
-- service role can access these records; browsers receive opaque tokens.
create table public.ranking_browser_challenges (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  roblox_id text not null check (roblox_id ~ '^[0-9]+$'),
  username text not null,
  code text not null,
  expires_at timestamptz not null default now() + interval '10 minutes',
  created_at timestamptz not null default now()
);
create table public.ranking_browser_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  actor_id text not null references public.ranking_accounts(site_user_id),
  expires_at timestamptz not null default now() + interval '8 hours',
  created_at timestamptz not null default now()
);
create index ranking_browser_sessions_actor on public.ranking_browser_sessions(actor_id);
create table public.ranking_rate_limits (
  key text primary key,
  count integer not null,
  resets_at timestamptz not null
);
alter table public.ranking_browser_challenges enable row level security;
alter table public.ranking_browser_sessions enable row level security;
alter table public.ranking_rate_limits enable row level security;
revoke all on public.ranking_browser_challenges, public.ranking_browser_sessions,
  public.ranking_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.ranking_browser_challenges,
  public.ranking_browser_sessions, public.ranking_rate_limits to service_role;

create function public.ranking_rate_limit(p_key text, p_limit integer, p_seconds integer)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare n integer;
begin
  if length(p_key)>200 or p_limit<1 or p_seconds<1 then raise exception 'Invalid limit'; end if;
  insert into public.ranking_rate_limits(key,count,resets_at)
  values(p_key,1,now()+make_interval(secs=>p_seconds))
  on conflict(key) do update set
    count=case when public.ranking_rate_limits.resets_at<=now() then 1 else public.ranking_rate_limits.count+1 end,
    resets_at=case when public.ranking_rate_limits.resets_at<=now() then now()+make_interval(secs=>p_seconds) else public.ranking_rate_limits.resets_at end
  returning count into n;
  return n<=p_limit;
end $$;

create function public.ranking_finish_browser_proof(p_hash text, p_code text, p_session_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare c public.ranking_browser_challenges; a public.ranking_accounts; expires timestamptz;
begin
  if p_session_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid session'; end if;
  select * into c from public.ranking_browser_challenges where token_hash=p_hash for update;
  if c.token_hash is null or c.expires_at<=now() or c.code<>p_code then
    raise exception 'Verification expired or already used. Request a new code.';
  end if;
  -- A verified Roblox account keeps its existing command history when moving
  -- from Sites. The caller never chooses the staff identity or history owner.
  insert into public.ranking_accounts(site_user_id,roblox_id,username)
  values('roblox:'||c.roblox_id,c.roblox_id,c.username)
  on conflict(roblox_id) do update set username=excluded.username, verified_at=now()
  returning * into a;
  delete from public.ranking_browser_challenges where token_hash=p_hash;
  delete from public.ranking_browser_sessions where expires_at<=now();
  delete from public.ranking_browser_challenges where expires_at<=now();
  delete from public.ranking_rate_limits where resets_at<now()-interval '1 day';
  insert into public.ranking_browser_sessions(token_hash,actor_id)
  values(p_session_hash,a.site_user_id) returning expires_at into expires;
  return jsonb_build_object('expiresAt',expires);
end $$;

-- Vault stores the existing Roblox and storage-bridge keys encrypted at rest.
-- The service role already has Vault read access in this dedicated project.
create function public.ranking_runtime_settings()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(name,decrypted_secret),'{}'::jsonb)
  from vault.decrypted_secrets
  where name in ('AUTHORITY_ROBLOX_API_KEY','AUTHORITY_RANKING_BRIDGE_TOKEN');
$$;
revoke execute on function public.ranking_rate_limit(text,integer,integer) from public, anon, authenticated;
revoke execute on function public.ranking_finish_browser_proof(text,text,text) from public, anon, authenticated;
revoke execute on function public.ranking_runtime_settings() from public, anon, authenticated;
grant execute on function public.ranking_rate_limit(text,integer,integer) to service_role;
grant execute on function public.ranking_finish_browser_proof(text,text,text) to service_role;
grant execute on function public.ranking_runtime_settings() to service_role;
