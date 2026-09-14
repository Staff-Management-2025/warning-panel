import { GROUP_ID, database } from "./server-config.ts";
import {
  getRoles,
  membership,
  assignedRoles,
  profile,
  avatars,
} from "./roblox-server.ts";
import type { Staff } from "./ranking-types.ts";

export type Account = {
  site_user_id: string;
  roblox_id: string;
  username: string;
};
export async function staffAccount(
  siteUserId: string,
  includeAvatar = false,
): Promise<Staff> {
  const account = await database<Account | null>("account", { siteUserId });
  if (!account)
    throw new Error("Verify your Roblox account before using commands.");
  const [roles, member] = await Promise.all([
    getRoles(true),
    membership(account.roblox_id),
  ]);
  const held = assignedRoles(member, roles);
  const rank = held[0]?.rank || 0;
  if (rank < 9)
    throw new Error(
      "Your current community rank is below Admin (9). Command access is disabled.",
    );
  const user = await profile(account.roblox_id);
  const pictures = includeAvatar
    ? await avatars([account.roblox_id])
    : new Map();
  return {
    id: account.roblox_id,
    username: user.name,
    displayName: user.displayName,
    rank,
    role: held[0].name,
    avatar: pictures.get(account.roblox_id),
  };
}
export function membershipRoles(roles: string[]) {
  return [...roles].sort().join("|");
}
export function validGroupPath(path: string) {
  return (
    path.startsWith(`groups/${GROUP_ID}/memberships/`) &&
    !path.includes("?") &&
    !path.includes("..")
  );
}
