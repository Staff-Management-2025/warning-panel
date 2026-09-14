import { GROUP_ID } from "./server-config.ts";
import { membershipRolePaths, type Membership } from "./roblox-server.ts";
import type { RankSaveSummary, Role } from "./ranking-types.ts";

export type SavedMember = { userId: string; roles: string[] };
export type RankSnapshot = RankSaveSummary & { members: SavedMember[]; roles: Role[] };
export type RestoreItem = {
  userId: string;
  originalRoles: string[];
  desiredRoles: string[];
  beforeNames: string[];
  afterNames: string[];
  status: "pending";
};

const rolePath = (role: Role) => `groups/${GROUP_ID}/roles/${role.id}`;

export function validateSavedRoles(paths: string[], roles: Role[]): Role[] {
  if (!paths.length || new Set(paths).size !== paths.length)
    throw new Error("The saved role list is incomplete or duplicated.");
  return paths.map((path) => {
    const role = roles.find((entry) => rolePath(entry) === path);
    if (!role) throw new Error("A saved role was deleted or is no longer available.");
    return role;
  });
}

// Roblox may omit the implicit Member role when it returns extra roles.
export function sameRoleSet(left: string[], right: string[], roles: Role[]) {
  const base = new Set(roles.filter((role) => role.isBase).map(rolePath));
  const canonical = (paths: string[]) => [...new Set(paths)].filter((path) => !base.has(path)).sort().join("|");
  return canonical(left) === canonical(right);
}

export function captureRanks(members: Membership[], roles: Role[]): SavedMember[] {
  const seen = new Set<string>();
  if (!members.length) throw new Error("Roblox returned no members. The previous save was kept.");
  return members.map((member) => {
    const userId = member.user.replace(/^users\//, "");
    if (!/^\d+$/.test(userId) || seen.has(userId))
      throw new Error("Roblox returned an incomplete member list. The previous save was kept.");
    seen.add(userId);
    const paths = membershipRolePaths(member);
    validateSavedRoles(paths, roles);
    return { userId, roles: [...paths].sort() };
  });
}

export function restoreAllowed(userId: string, actorId: string, current: string[], desired: string[], roles: Role[]) {
  if (userId === actorId) return false;
  try {
    const held = validateSavedRoles(current, roles);
    const wanted = validateSavedRoles(desired, roles);
    return [...held, ...wanted].every((role) => role.rank > 0 && role.rank < 255);
  } catch {
    return false;
  }
}

export function planRestore(snapshot: RankSnapshot, current: Membership[], roles: Role[], actorId: string) {
  const members = new Map(current.map((member) => [member.user.replace(/^users\//, ""), member]));
  const items: RestoreItem[] = [];
  let unchanged = 0;
  let unavailable = 0;
  for (const saved of snapshot.members) {
    const member = members.get(saved.userId);
    const original = membershipRolePaths(member || null);
    if (!member || !restoreAllowed(saved.userId, actorId, original, saved.roles, roles)) {
      unavailable++;
      continue;
    }
    if (sameRoleSet(original, saved.roles, roles)) {
      unchanged++;
      continue;
    }
    const names = (paths: string[]) => validateSavedRoles(paths, roles).map((role) => role.name);
    items.push({ userId: saved.userId, originalRoles: original, desiredRoles: saved.roles,
      beforeNames: names(original), afterNames: names(saved.roles), status: "pending" });
  }
  return { items, unchanged, unavailable };
}
