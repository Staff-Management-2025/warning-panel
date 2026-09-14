# Authority Community Ranking

Staff console for Roblox community **526651322**. The public interface is hosted
at `https://staff-management-2025.github.io/warning-panel/community-ranking/`.
It lives in `community-ranking/`; the existing warning panel remains separate.

## Commands

- `Check Roles ExactUsername` — show every assigned community role, its name, rank, and ID.
- `Change ExactUsername 7` — set one member to a rank or full role ID, higher or lower.
- `Change all 1` — review eligible members, then set them to the chosen role.
- **Save Rank Datastore** / `SaveRank` — Owner only; save every current member's complete role set.
- `RestoreRank` — Owner only; review and restore the latest completed save.

All commands require a verified Admin (rank 9+) account. Operators cannot change
themselves, peers, higher-ranked members, or assign roles at/above their own rank.
Rank changes replace previous non-base roles with the selected role; the base
Member role is retained. Multiple roles are displayed by Check Roles.

## Authentication and secrets

No ChatGPT or Supabase user account is required. A random, expiring code in the
Roblox profile About description proves account ownership. A separate private
challenge token binds verification to the browser that requested it; the public
profile code alone cannot sign someone in. Supabase atomically consumes each
challenge and issues an eight-hour opaque session, stored only in this browser
tab. Only token hashes are stored in the database. Sign-out revokes the session.
Every command rechecks the operator's live community rank. Existing account links
and command history are retained when staff first verify on GitHub Pages.

The `community-console` Edge Function implements authentication, per-session and
verification rate limits, origin checks, and command authorization. Its gateway
JWT check is disabled because it validates its own opaque sessions, rather than
using Supabase Auth. Database tables and privileged RPC functions are closed to
both anonymous and authenticated browser roles. The service key never enters the
browser. The original `ranking-store` function remains a private server bridge.

The Edge Function reads `AUTHORITY_ROBLOX_API_KEY` and
`AUTHORITY_RANKING_BRIDGE_TOKEN` from encrypted Supabase Vault via a service-only
RPC. Local checks use ignored `.env`; use `.env.example` as a template. Never put
credentials into Git, browser bundles, or public variables. The legacy Sites
deployment uses its own server secret manager.

The Supabase Edge Function uses custom constant-time token verification; its
committed SHA-256 fingerprint is not the token. Database tables have RLS enabled,
browser privileges revoked, and no public policies. The Supabase advisor's
[RLS-without-policies notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
is intentional: only the authenticated server bridge accesses these tables.

## Running and checking

Requires Node 22.13 or newer.

```sh
npm run install:ci
npm run dev
npm test
npm run build
npm run build:pages
```

With server credentials configured, the optional read-only integration check is:

```sh
node --env-file=.env tests/live-readonly.mjs
```

It reads real roles and verifies access controls; it never promotes, demotes,
kicks or bans anyone. Unit tests simulate Roblox changes and incomplete results.
The development sign-in is a Sites preview fixture and is not a staff account.

## Maintainer map

- `app/ranking-console.tsx`, `app/console.css`: shared responsive interface.
- `github-pages/`: GitHub Pages entry point and opaque-session client.
- `app/api/console/route.ts`: identity checks, role inspection, command review and execution.
- `lib/command-rules.ts`: command parsing and hierarchy rules.
- `lib/roblox-server.ts`: Roblox requests and multi-role replacement.
- `supabase/schema.sql`: database schema snapshot.
- `supabase/functions/ranking-store/`: server-only database bridge.
- `supabase/browser-auth.sql`: profile challenges, sessions, rate limits and grants.
- `supabase/functions/community-console/`: public Edge Function with server-enforced authentication.
- `scripts/prepare-pages-backend.mjs`: synchronizes the shared rules and command handler into the Edge Function.
- `tests/`: permission, parsing, multi-role, and read-only integration checks.

Bulk jobs process three members per request, use an exclusive expiring lease,
save intent before each external mutation, and reconcile interrupted operations.
Partial or uncertain changes are reported for manual inspection with Check Roles.
Previews expire after ten minutes. Bulk operations are capped at 5,000 members.
The owner's requested promotion of me77nu to Contributor (5) was verified live
after the connection permissions were repaired. No community members were kicked
or banned in testing.

## Troubleshooting a denied command

The Staff access panel identifies the Roblox account behind the server API key.
That account is separate from the person signed into the website. Roblox requires
both the `group:write` key scope and sufficient community role-assignment
permissions on the key's account. A custom role called Owner does not confer
actual group ownership. Check the account's **Assign or remove roles from members**
permission and its hierarchy above the intended role in Creator Hub.

The initial `Promote me77nu 5` retry returned HTTP 403 `PERMISSION_DENIED`.
After the owner granted the permissions, the same requested promotion succeeded.
The active API key's account was PeterGriffin123898. The website identifies the
rejected account, pauses batches on authentication/permission failures, and
separates failures from successful progress.

## Delayed role confirmation

The later `Demote me77nu 4` request reported a verification failure, although a
fresh Roblox membership read confirmed Tester (4). Role writes now use uncached
reads and allow up to 6.75 seconds of backoff for membership data to catch up.
Only verification reads are retried; role writes are not repeated. Success
requires the selected role and no other non-base role, including unknown role
paths missing from the current catalog. An unconfirmed result explicitly says
the change may already have applied. Check Roles before issuing another change;
previous command-history entries retain their original results.

`Change all 1` and named changes to Member remove all extra roles directly.
The base Member role is implicit; it must never be sent to `assignRole` or
`unassignRole`. Verification still requires the member to exist and all extra
roles to be gone. Tests simulate Roblox rejecting base-role assignment with HTTP
400, then verify multi-role demotions and unchanged ordinary Members. Failed
members from an earlier command need a fresh preview; old failures are not
silently retried.

Run `supabase/change-command.sql` when deploying the unified Change command.
Previously recorded Promote/Demote commands retain their original spelling and
direction checks for compatibility. New controls and examples use Change. Exact
matches are skipped, but members with additional roles still have those extras
removed to match the selected destination.

## GitHub Pages deployment

Run `npm run build:pages`, then deploy `supabase/functions/community-console/`
with its custom session authentication (`verify_jwt=false`). Publish the contents
of `.pages-dist/` into the repository's `community-ranking/` directory, keeping
the existing root warning panel intact. The files use relative asset paths.
The frontend origin is restricted to `https://staff-management-2025.github.io`.
Never copy `.env`, local runtime files, or database secrets into the public site.

Roblox can return `roles: []` alongside a valid singular `role` for ordinary
Members. All role inspection, command previews, permission checks, and change
verification use `membershipRolePaths()` to normalize this response. Empty extra
roles do not mean the user is a Guest. This case was reproduced with the read-only
lookup of AdrianAspher; no rank change is needed to verify membership eligibility.

## Owner rank datastore

Run `supabase/rank-backups.sql` once when deploying this feature. Saves are
immutable rows in `ranking_rank_snapshots`; an incomplete read never replaces
the previous save. Every save contains member IDs, every assigned role path,
the role catalog, and timestamps. Captures abort rather than silently truncate
above the existing 5,000-member limit. The Member role is treated as implicit
when Roblox omits it alongside other roles.

Both commands require verified Roblox user ID `7468655528` and a fresh rank of
255. A role merely named Owner does not qualify. The UI receives an `isOwner`
flag; the server independently enforces the permission during save, preview,
execution, and before each restored member. Supabase also restricts snapshot
access to the linked owner identity behind the private server bridge.

Restore previews pin one immutable snapshot and show all affected member IDs
and before/after role names. Execution uses the existing saved-job leases and
intent logging, preserves multiple saved roles, and confirms Roblox's returned
role set. New members are untouched. Departed members, deleted roles, ownership
and members whose roles changed after review are excluded or reported. Restore
does not rejoin members, unban accounts, recreate roles, or change ownership.
Roblox still enforces the connected API account's role-assignment permissions.

Saving takes a paginated read, not an atomic Roblox transaction. The database
refuses a save if another website command ran during capture. Changes made
directly on Roblox during that read cannot be locked by this website.

Kick and Ban have been removed at the owner's request. The website uses only
the Roblox Open Cloud API key; no Roblox login cookie is needed. Historical
command records are retained, but pending removal commands cannot be resumed.
