# Authority Community Ranking

Staff console for Roblox community **526651322**. This independent app lives in
`community-ranking/`; the repository's existing warning panel remains separate.

## Commands

- `Check Roles ExactUsername` — show every assigned community role, its name, rank, and ID.
- `Promote ExactUsername 7` / `Demote ExactUsername 1` — move to a rank or full role ID.
- `Promote all 7` / `Demote all 1` — review eligible members, then apply a saved batch.
- `Kick ExactUsername` / `Ban ExactUsername` — community removal, once moderation is connected.
- `Kick all` / `Ban all` — restricted to Management rank 14 and higher.

All commands require a verified Admin (rank 9+) account. Operators cannot change
themselves, peers, higher-ranked members, or assign roles at/above their own rank.
Rank changes replace previous non-base roles with the selected role; the base
Member role is retained. Multiple roles are displayed by Check Roles.

## Authentication and secrets

Sites authenticates the visitor. A random, expiring code in the Roblox profile
About description proves account ownership. Supabase stores the resulting unique
account link. Every write rechecks the operator's live community rank.

Configure server-only `ROBLOX_API_KEY` and `RANKING_BRIDGE_TOKEN` using the hosting
secret manager. Local development reads ignored `.env`; use `.env.example` as a
template. Do not put credentials into Git, browser bundles, or public variables.

The Supabase Edge Function uses custom constant-time token verification; its
committed SHA-256 fingerprint is not the token. Database tables have RLS enabled,
browser privileges revoked, and no public policies. The Supabase advisor's
[RLS-without-policies notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
is intentional: only the authenticated server bridge accesses these tables.

Community Kick/Ban currently use Roblox cookie-authenticated endpoints, not the
Open Cloud API key. They remain unavailable without `ROBLOX_COMMUNITY_SESSION`,
configured privately by the operator of a dedicated moderation account. Never
ask staff to paste account cookies into the website. See Roblox's
[community ban reference](https://create.roblox.com/docs/cloud/reference/features/bans-and-blocks).

## Running and checking

Requires Node 22.13 or newer.

```sh
npm run install:ci
npm run dev
npm test
npm run build
```

With server credentials configured, the optional read-only integration check is:

```sh
node --env-file=.env tests/live-readonly.mjs
```

It reads real roles and verifies access controls; it never promotes, demotes,
kicks or bans anyone. Unit tests simulate Roblox changes and incomplete results.
The development sign-in is a Sites preview fixture and is not a staff account.

## Maintainer map

- `app/ranking-console.tsx`, `app/console.css`: responsive interface.
- `app/api/console/route.ts`: identity checks, role inspection, command review and execution.
- `lib/command-rules.ts`: command parsing and hierarchy rules.
- `lib/roblox-server.ts`: Roblox requests and multi-role replacement.
- `supabase/schema.sql`: database schema snapshot.
- `supabase/functions/ranking-store/`: server-only database bridge.
- `tests/`: permission, parsing, multi-role, and read-only integration checks.

Bulk jobs process three members per request, use an exclusive expiring lease,
save intent before each external mutation, and reconcile interrupted operations.
Partial or uncertain changes are reported for manual inspection with Check Roles.
Previews expire after ten minutes. Bulk operations are capped at 5,000 members.
No real rank-change or removal test has been performed on community members.
