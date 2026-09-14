import { GROUP_ID, setting } from "./server-config.ts";
import type { Role } from "./ranking-types.ts";

export type Membership = {
  path: string;
  user: string;
  role?: string;
  roles?: string[];
};
export type RobloxUser = {
  id: number;
  name: string;
  displayName: string;
  description?: string;
};
type CloudRole = {
  id: string;
  path: string;
  displayName: string;
  rank: number;
};
let roleCache: { roles: Role[]; until: number } | undefined;
let memberCache: { members: RobloxUser[]; until: number } | undefined;

export class RobloxApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "RobloxApiError";
  }
}

export type ConnectionStatus = {
  username?: string;
  userId?: string;
  readScope: boolean;
  writeScope: boolean;
  error?: string;
};
let connectionCache: { value: ConnectionStatus; until: number } | undefined;

export async function connectionStatus(): Promise<ConnectionStatus> {
  if (connectionCache && connectionCache.until > Date.now())
    return connectionCache.value;
  const value: ConnectionStatus = {
    readScope: false,
    writeScope: false,
  };
  try {
    const info = await json<{
      authorizedUserId?: number;
      enabled?: boolean;
      expired?: boolean;
      scopes?: { name: string; operations: string[] }[];
    }>("https://apis.roblox.com/api-keys/v1/introspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: setting("ROBLOX_API_KEY") }),
    });
    if (!info.enabled || info.expired)
      throw new Error(
        "The Roblox API key is disabled or expired. Update the server connection.",
      );
    const scopes = info.scopes?.filter((scope) => scope.name === "group") || [];
    value.readScope = scopes.some((scope) => scope.operations.includes("read"));
    value.writeScope = scopes.some((scope) =>
      scope.operations.includes("write"),
    );
    if (info.authorizedUserId) {
      value.userId = String(info.authorizedUserId);
      value.username = (await profile(value.userId)).name;
    }
    if (!value.writeScope)
      value.error =
        "The Roblox key is missing group write access. The owner must enable group:write in Creator Hub.";
  } catch (error) {
    value.error = (error as Error).message;
  }
  connectionCache = { value, until: Date.now() + 30000 };
  return value;
}

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    // Membership and permission checks must never reuse a cached result.
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    if (response.status === 429)
      throw new Error(
        "Roblox is rate-limiting requests. Wait a moment, then try again.",
      );
    if (response.status === 401)
      throw new RobloxApiError(
        401,
        "Roblox rejected the server credential. It may be invalid or expired; update the connection before retrying.",
      );
    if (response.status === 403)
      throw new RobloxApiError(
        403,
        "Roblox denied this operation: insufficient account permissions.",
      );
    throw new Error(
      `Roblox could not complete the request (${response.status}).`,
    );
  }
  return response.status === 204 ? ({} as T) : ((await response.json()) as T);
}
export async function cloud<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!path.startsWith(`groups/${GROUP_ID}/`))
    throw new Error("Invalid community resource.");
  const key = setting("ROBLOX_API_KEY");
  if (!key)
    throw new Error("The Roblox community connection is not configured.");
  return json<T>(`https://apis.roblox.com/cloud/v2/${path}`, {
    ...init,
    headers: {
      "x-api-key": key,
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      ...init.headers,
    },
  });
}
export async function getRoles(fresh = false): Promise<Role[]> {
  if (!fresh && roleCache && roleCache.until > Date.now())
    return roleCache.roles;
  const roles: Role[] = [];
  let token = "";
  do {
    const page = await cloud<{
      groupRoles: CloudRole[];
      nextPageToken?: string;
    }>(
      `groups/${GROUP_ID}/roles?maxPageSize=20${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`,
    );
    for (const role of page.groupRoles || [])
      roles.push({
        id: String(role.id),
        name: role.displayName,
        rank: role.rank,
        isBase: String(role.id) === "12884901889",
      });
    token = page.nextPageToken || "";
    if (roles.length > 500)
      throw new Error("Too many roles were returned by Roblox.");
  } while (token);
  roles.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  roleCache = { roles, until: Date.now() + 15000 };
  return roles;
}
export async function membership(userId: string): Promise<Membership | null> {
  if (!/^\d+$/.test(userId)) throw new Error("Invalid Roblox user.");
  const filter = encodeURIComponent(`user == 'users/${userId}'`);
  const response = await cloud<{ groupMemberships: Membership[] }>(
    `groups/${GROUP_ID}/memberships?maxPageSize=10&filter=${filter}`,
  );
  return (
    (response.groupMemberships || []).find(
      (member) => member.user === `users/${userId}`,
    ) || null
  );
}
export async function allMemberships(): Promise<Membership[]> {
  const members: Membership[] = [];
  let token = "";
  do {
    const page = await cloud<{
      groupMemberships: Membership[];
      nextPageToken?: string;
    }>(
      `groups/${GROUP_ID}/memberships?maxPageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`,
    );
    members.push(...(page.groupMemberships || []));
    token = page.nextPageToken || "";
    if (members.length > 5000)
      throw new Error(
        "This bulk operation exceeds the current 5,000-member limit. Use named commands.",
      );
  } while (token);
  return members;
}
export function membershipRolePaths(member: Membership | null): string[] {
  // Roblox returns roles: [] for some ordinary Members, while role still holds
  // their base membership. An empty array must not turn a member into a guest.
  if (member?.roles?.length) return member.roles;
  return member?.role ? [member.role] : [];
}

export function assignedRoles(
  member: Membership | null,
  roles: Role[],
): Role[] {
  const paths = membershipRolePaths(member);
  return roles
    .filter((role) => paths.includes(`groups/${GROUP_ID}/roles/${role.id}`))
    .sort((a, b) => b.rank - a.rank);
}
export async function exactUser(username: string): Promise<RobloxUser> {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username))
    throw new Error("Enter an exact Roblox username, not a display name.");
  const result = await json<{ data: RobloxUser[] }>(
    "https://users.roblox.com/v1/usernames/users",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usernames: [username],
        excludeBannedUsers: false,
      }),
    },
  );
  const user = result.data.find(
    (user) => user.name.toLowerCase() === username.toLowerCase(),
  );
  if (!user) throw new Error("That exact Roblox username was not found.");
  return user;
}
export function profile(id: string) {
  return json<RobloxUser>(`https://users.roblox.com/v1/users/${id}`);
}
export async function avatars(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  try {
    const result = await json<{
      data: { targetId: number; imageUrl: string; state: string }[];
    }>(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${ids.join(",")}&size=150x150&format=Png&isCircular=false`,
    );
    return new Map(
      result.data
        .filter((item) => item.state === "Completed")
        .map((item) => [String(item.targetId), item.imageUrl]),
    );
  } catch {
    return new Map<string, string>();
  }
}
export async function searchMembers(query: string) {
  if (!memberCache || memberCache.until < Date.now()) {
    const memberships = await allMemberships();
    const users: RobloxUser[] = [];
    for (let index = 0; index < memberships.length; index += 100) {
      const result = await json<{ data: RobloxUser[] }>(
        "https://users.roblox.com/v1/users",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userIds: memberships
              .slice(index, index + 100)
              .map((item) => Number(item.user.split("/").pop())),
            excludeBannedUsers: true,
          }),
        },
      );
      users.push(...result.data);
    }
    memberCache = { members: users, until: Date.now() + 60000 };
  }
  const users = memberCache.members
    .filter((user) => user.name.toLowerCase().startsWith(query.toLowerCase()))
    .slice(0, 6);
  const pictures = await avatars(users.map((user) => String(user.id)));
  return users.map((user) => ({
    id: String(user.id),
    username: user.name,
    displayName: user.displayName,
    avatar: pictures.get(String(user.id)),
  }));
}

async function writeMembershipRole(
  member: Membership,
  operation: "assignRole" | "unassignRole",
  target: string,
) {
  try {
    await cloud(`${member.path}:${operation}`, {
      method: "POST",
      body: JSON.stringify({ role: target }),
    });
  } catch (error) {
    if (error instanceof RobloxApiError && error.status === 403) {
      const connection = await connectionStatus();
      const account = connection.username ? `@${connection.username}` : "the connected account";
      throw new RobloxApiError(403, connection.writeScope
        ? `Roblox refused ${operation === "assignRole" ? "to assign" : "to remove"} the selected role using API account ${account}. This identifies the operator, not the target member. The operator needs Assign or remove roles from members permission and authority above this role. Check Roles before retrying.`
        : `Roblox refused the role change using API account ${account}. ${connection.error || "Enable group:write for its API key."}`);
    }
    throw error;
  }
}

export function individualRolePlan(
  original: string[],
  role: Role,
  roles: Role[],
  action: "addrole" | "removerole",
) {
  if (role.isBase || role.rank <= 0 || role.rank >= 255)
    throw new Error("Choose an additional member role. The automatic Member role cannot be added or removed.");
  const catalog = new Set(roles.map((entry) => `groups/${GROUP_ID}/roles/${entry.id}`));
  if (!original.length || original.some((path) => !catalog.has(path)))
    throw new Error("A current role is unavailable. Check Roles and review again.");
  const selected = `groups/${GROUP_ID}/roles/${role.id}`;
  const result = new Set(original);
  if (action === "addrole") result.add(selected);
  else result.delete(selected);
  // Removing the final additional role leaves the automatic Member role.
  if (!result.size) {
    const base = roles.find((entry) => entry.isBase);
    if (!base) throw new Error("The automatic Member role is unavailable.");
    result.add(`groups/${GROUP_ID}/roles/${base.id}`);
  }
  return [...result].sort();
}

export async function editIndividualRole(
  member: Membership,
  role: Role,
  roles: Role[],
  action: "addrole" | "removerole",
) {
  const original = membershipRolePaths(member);
  const desired = individualRolePlan(original, role, roles, action);
  const selected = `groups/${GROUP_ID}/roles/${role.id}`;
  const hasRole = original.includes(selected);
  if ((action === "addrole" && hasRole) || (action === "removerole" && !hasRole)) return;

  // Exactly one mutation: never replace or remove another assigned role.
  await writeMembershipRole(member, action === "addrole" ? "assignRole" : "unassignRole", selected);
  const bases = new Set(roles.filter((entry) => entry.isBase).map((entry) => `groups/${GROUP_ID}/roles/${entry.id}`));
  const normalized = (paths: string[]) => [...new Set(paths)].filter((path) => !bases.has(path)).sort().join("|");
  for (const delay of [0, 250, 500, 1000, 2000, 3000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const actual = await membership(member.user.split("/").pop()!);
    if (actual && normalized(membershipRolePaths(actual)) === normalized(desired)) return;
  }
  throw new Error("Roblox did not confirm the complete role list. The selected role may already have changed. Use Check Roles before retrying.");
}

export async function setRole(member: Membership, role: Role, roles: Role[]) {
  const desired = `groups/${GROUP_ID}/roles/${role.id}`;
  // Member is implicit and cannot be assigned like an extra role. Returning to
  // Member means removing all non-base roles, while keeping the membership.
  // Other destinations are assigned before old roles are removed.
  if (!role.isBase && !membershipRolePaths(member).includes(desired))
    await writeMembershipRole(member, "assignRole", desired);
  for (const old of membershipRolePaths(member)) {
    if (
      old === desired ||
      roles.some((item) => item.isBase && old.endsWith(`/${item.id}`))
    )
      continue;
    await writeMembershipRole(member, "unassignRole", old);
  }
  // Roblox's membership reads can lag behind successful role writes. Retry
  // only the confirmation reads, never the assign/unassign operations.
  const allowed = new Set([
    desired,
    ...roles.filter((item) => item.isBase)
      .map((item) => `groups/${GROUP_ID}/roles/${item.id}`),
  ]);
  for (const delay of [0, 250, 500, 1000, 2000, 3000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const actual = await membership(member.user.split("/").pop()!);
    const paths = membershipRolePaths(actual);
    // Compare every returned path, including roles absent from an older catalog.
    if (actual && paths.includes(desired) && paths.every((path) => allowed.has(path)))
      return;
  }
  throw new Error(
    "Roblox did not confirm the final roles within a few seconds. The changes may already have applied. Use Check Roles before retrying.",
  );
}

export async function restoreRoleSet(member: Membership, desired: string[], roles: Role[]) {
  const catalog = new Map(roles.map((role) => [`groups/${GROUP_ID}/roles/${role.id}`, role]));
  const original = membershipRolePaths(member);
  if (!desired.length || [...original, ...desired].some((path) => {
    const role = catalog.get(path);
    return !role || role.rank <= 0 || role.rank >= 255;
  })) throw new Error("The saved or current roles are unavailable or protected. No change was made.");

  const wanted = new Set(desired);
  // Preserve all saved roles, not just the member's highest rank.
  for (const path of wanted) {
    if (catalog.get(path)!.isBase || original.includes(path)) continue;
    await writeMembershipRole(member, "assignRole", path);
  }
  for (const path of original) {
    if (catalog.get(path)!.isBase || wanted.has(path)) continue;
    await writeMembershipRole(member, "unassignRole", path);
  }
  const normalize = (paths: string[]) => [...new Set(paths)]
    .filter((path) => !catalog.get(path)?.isBase).sort().join("|");
  for (const delay of [0, 250, 500, 1000, 2000, 3000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const actual = await membership(member.user.split("/").pop()!);
    if (actual && normalize(membershipRolePaths(actual)) === normalize(desired)) return;
  }
  throw new Error("Roblox did not confirm every restored role. Some changes may have applied; use Check Roles before retrying.");
}
