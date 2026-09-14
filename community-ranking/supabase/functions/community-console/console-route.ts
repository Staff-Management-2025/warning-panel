import { getViewer, validOrigin } from "./browser-auth.ts";
import { configured, database } from "./server-config.ts";
import { staffAccount, membershipRoles } from "./server-service.ts";
import {
  allMemberships,
  assignedRoles,
  connectionStatus,
  RobloxApiError,
  avatars,
  exactUser,
  getRoles,
  membership,
  membershipRolePaths,
  profile,
  removalConnected,
  removeMember,
  searchMembers,
  setRole,
  type Membership,
} from "./roblox-server.ts";
import {
  authorizeCommand,
  eligibleTarget,
  parseCommand,
  resolveRole,
} from "./command-rules.ts";
import { initialRoles, type Job } from "./ranking-types.ts";

export const dynamic = "force-dynamic";
type Item = {
  userId: string;
  originalRoles: string[];
  status: "pending" | "processing" | "completed" | "failed";
  error?: string;
};
type SavedJob = Job & {
  actor_id: string;
  actor_roblox_id: string;
  target_role_id?: string;
  is_bulk: boolean;
  items: Item[];
  lease_token?: string;
};
const reply = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
const safeJob = (job: SavedJob): Job => ({
  id: job.id,
  command: job.command,
  action: job.action,
  target_role_name: job.target_role_name,
  status: job.status,
  total: job.total,
  completed: job.completed,
  failed: job.failed,
  skipped: job.skipped,
  created_at: job.created_at,
  error: job.error || job.items?.find((item) => item.error)?.error,
});

export async function GET(request: Request) {
  try {
    const viewer = await getViewer(request);
    const query = new URL(request.url).searchParams.get("q");
    if (query !== null) {
      if (!viewer) return reply({ error: "Sign in first." }, 401);
      if (!/^[A-Za-z0-9_]{2,20}$/.test(query)) return reply({ members: [] });
      await staffAccount(viewer.userId);
      return reply({ members: await searchMembers(query) });
    }
    if (!viewer || !configured())
      return reply({
        roles: initialRoles,
        staff: null,
        jobs: [],
        ready: configured(),
        notice: configured()
          ? undefined
          : "Community verification is being connected.",
      });
    const account = await database("account", { siteUserId: viewer.userId });
    if (!account)
      return reply({ roles: initialRoles, staff: null, jobs: [], ready: true });
    const staff = await staffAccount(viewer.userId, true);
    const [roles, jobs, connection] = await Promise.all([
      getRoles(),
      database("history", { siteUserId: viewer.userId }),
      connectionStatus(),
    ]);
    return reply({
      roles,
      staff,
      jobs,
      ready: true,
      connection,
      notice: removalConnected()
        ? undefined
        : "Kick and Ban are not connected. Check Roles can read memberships; changing roles also requires permission on the connected Roblox account.",
    });
  } catch (error) {
    return reply({ error: (error as Error).message }, 400);
  }
}

export async function POST(request: Request) {
  try {
    const viewer = await getViewer(request);
    if (!viewer) return reply({ error: "Sign in first." }, 401);
    if (!validOrigin(request))
      return reply({ error: "Invalid request origin." }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return reply({ error: "JSON required." }, 415);
    const text = await request.text();
    if (text.length > 4096) return reply({ error: "Request too large." }, 413);
    const body = JSON.parse(text) as Record<string, unknown>;
    const siteUserId = viewer.userId;

    const staff = await staffAccount(siteUserId);
    if (body.action === "preview") {
      const raw = String(body.command || "").trim();
      const command = parseCommand(raw);
      const roles = await getRoles(true);
      const role = command.roleToken
        ? resolveRole(roles, command.roleToken)
        : undefined;
      authorizeCommand(command, staff.rank, role);
      if (command.action === "check") {
        const user = await exactUser(command.target);
        const held = assignedRoles(await membership(String(user.id)), roles);
        const pictures = await avatars([String(user.id)]);
        return reply({
          inspection: {
            username: user.name,
            displayName: user.displayName,
            avatar: pictures.get(String(user.id)),
            roles: held,
          },
        });
      }
      if (["kick", "ban"].includes(command.action) && !removalConnected())
        throw new Error(
          "Community Kick and Ban need a signed-in Roblox moderation connection. The API key supports role changes, but not these community removal endpoints.",
        );
      if (role) {
        const connection = await connectionStatus();
        if (!connection.writeScope)
          throw new Error(
            connection.error ||
              "The Roblox key is missing group:write permission.",
          );
      }
      let candidates: Membership[];
      if (command.all) candidates = await allMemberships();
      else {
        const user = await exactUser(command.target);
        const member = await membership(String(user.id));
        if (!member)
          throw new Error("That user is not a member of this community.");
        candidates = [member];
      }
      const items: Item[] = [];
      for (const member of candidates) {
        const userId = member.user.split("/").pop()!;
        const rank = assignedRoles(member, roles)[0]?.rank || 0;
        if (eligibleTarget(command, staff.id, staff.rank, userId, rank, role))
          items.push({
            userId,
            originalRoles: membershipRolePaths(member),
            status: "pending",
          });
      }
      if (!items.length)
        throw new Error(
          "No eligible members. You cannot change yourself or members at or above your rank, and Promote/Demote must move in the requested direction.",
        );
      const job = await database<SavedJob>("createJob", {
        siteUserId,
        job: {
          actor_roblox_id: staff.id,
          command: raw,
          action: command.action,
          target_role_id: role?.id,
          target_role_name: role?.name,
          is_bulk: command.all,
          items,
          total: items.length,
          skipped: candidates.length - items.length,
        },
      });
      return reply({ job: safeJob(job) });
    }

    if (body.action === "execute") {
      const jobId = String(body.jobId || "");
      if (!/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error("Invalid command.");
      const stored = await database<SavedJob | null>("job", {
        siteUserId,
        jobId,
      });
      if (!stored) throw new Error("Command not found.");
      if (["completed", "partial", "cancelled"].includes(stored.status))
        return reply({ job: safeJob(stored) });
      const command = parseCommand(stored.command);
      const roles = await getRoles(true);
      const role = stored.target_role_id
        ? resolveRole(roles, stored.target_role_id)
        : undefined;
      authorizeCommand(command, staff.rank, role);
      const lease = crypto.randomUUID();
      let job = await database<SavedJob>("claimJob", {
        siteUserId,
        jobId,
        lease,
      });
      let paused = false;
      if (["completed", "partial", "cancelled"].includes(job.status))
        return reply({ job: safeJob(job) });
      try {
        let count = 0;
        for (const item of job.items) {
          if (!["pending", "processing"].includes(item.status)) continue;
          if (++count > 3) break;
          // Recheck the operator and target immediately before every write.
          const currentStaff = await staffAccount(siteUserId);
          const currentRoles = await getRoles(true);
          const currentRole = role
            ? resolveRole(currentRoles, role.id)
            : undefined;
          authorizeCommand(command, currentStaff.rank, currentRole);
          const member = await membership(item.userId);
          const held = assignedRoles(member, currentRoles);
          const recovered = item.status === "processing";
          if (recovered) {
            if (
              currentRole &&
              held.some((r) => r.id === currentRole.id) &&
              held.every((r) => r.isBase || r.id === currentRole.id)
            )
              item.status = "completed";
            else if (command.action === "kick" && !member)
              item.status = "completed";
            else {
              item.status = "failed";
              item.error =
                "A previous request was interrupted. Check this member in Roblox before issuing another command.";
            }
            await database("saveJob", {
              siteUserId,
              jobId,
              lease,
              items: job.items,
              release: false,
            });
            continue;
          }
          if (
            !member ||
            !eligibleTarget(
              command,
              currentStaff.id,
              currentStaff.rank,
              item.userId,
              held[0]?.rank || 0,
              currentRole,
            ) ||
            membershipRoles(item.originalRoles) !==
              membershipRoles(membershipRolePaths(member))
          ) {
            item.status = "failed";
            item.error =
              "Membership or permissions changed since the preview. No change was made.";
          } else {
            item.status = "processing";
            // Persist intent before the external request; retries must reconcile it.
            await database("saveJob", {
              siteUserId,
              jobId,
              lease,
              items: job.items,
              release: false,
            });
            try {
              if (currentRole) await setRole(member, currentRole, currentRoles);
              else
                await removeMember(
                  item.userId,
                  command.action as "kick" | "ban",
                );
              item.status = "completed";
            } catch (error) {
              item.status = "failed";
              item.error = (error as Error).message;
              // Do not send thousands of doomed requests when the connection
              // itself is rejected. Leave remaining members available to resume.
              if (
                error instanceof RobloxApiError &&
                [401, 403].includes(error.status)
              ) {
                paused = true;
                break;
              }
            }
          }
          await database("saveJob", {
            siteUserId,
            jobId,
            lease,
            items: job.items,
            release: false,
          });
        }
      } finally {
        job = await database<SavedJob>("saveJob", {
          siteUserId,
          jobId,
          lease,
          items: job.items,
          release: true,
        });
      }
      return reply({ job: { ...safeJob(job), paused } });
    }
    return reply({ error: "Unknown command operation." }, 400);
  } catch (error) {
    return reply(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to complete this request.",
      },
      400,
    );
  }
}
