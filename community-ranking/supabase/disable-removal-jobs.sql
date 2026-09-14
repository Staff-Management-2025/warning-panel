-- Keep the audit trail, but prevent removed commands from being resumed.
update public.ranking_jobs
set status = 'cancelled',
    error = 'This command was removed by the Owner.',
    lease_token = null,
    lease_until = null,
    updated_at = now()
where action in ('kick', 'ban') and status in ('preview', 'queued', 'running');
