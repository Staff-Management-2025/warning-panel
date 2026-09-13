import { GROUP_ID, setting } from "./server-config";
import type { Role } from "./ranking-types";

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

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    if (response.status === 429)
      throw new Error(
        "Roblox is rate-limiting requests. Wait a moment, then try again.",
      );
    if (response.status === 401 || response.status === 403)
      throw new Error(
        "Roblox denied this operation. The community connection may need renewed credentials or permission.",
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
export function assignedRoles(
  member: Membership | null,
  roles: Role[],
): Role[] {
  const paths = member?.roles || (member?.role ? [member.role] : []);
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

export async function setRole(member: Membership, role: Role, roles: Role[]) {
  const desired = `groups/${GROUP_ID}/roles/${role.id}`;
  // Modern communities can hold multiple roles. Assign first, then replace old
  // non-base roles, so a demotion does not leave a higher role still attached.
  await cloud(`${member.path}:assignRole`, {
    method: "POST",
    body: JSON.stringify({ role: desired }),
  });
  for (const old of member.roles || (member.role ? [member.role] : [])) {
    if (
      old === desired ||
      roles.some((item) => item.isBase && old.endsWith(`/${item.id}`))
    )
      continue;
    await cloud(`${member.path}:unassignRole`, {
      method: "POST",
      body: JSON.stringify({ role: old }),
    });
  }
  const actual = assignedRoles(
    await membership(member.user.split("/").pop()!),
    roles,
  );
  if (
    !actual.some((item) => item.id === role.id) ||
    actual.some((item) => !item.isBase && item.id !== role.id)
  )
    throw new Error(
      "Roblox did not confirm all role changes. Check Roles before trying again.",
    );
}

export function removalConnected() {
  return Boolean(setting("ROBLOX_COMMUNITY_SESSION"));
}
export async function removeMember(userId: string, action: "kick" | "ban") {
  const session = setting("ROBLOX_COMMUNITY_SESSION");
  if (!session)
    throw new Error(
      "Community Kick and Ban need a connected Roblox moderation session. The Open Cloud API key does not support these endpoints.",
    );
  const url = `https://groups.roblox.com/v1/groups/${GROUP_ID}/${action === "ban" ? "bans" : "users"}/${userId}`;
  const init: RequestInit = {
    method: action === "ban" ? "POST" : "DELETE",
    headers: {
      Cookie: `.ROBLOSECURITY=${session}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(12000),
  };
  let response = await fetch(url, init);
  const csrf = response.headers.get("x-csrf-token");
  if (response.status === 403 && csrf)
    response = await fetch(url, {
      ...init,
      headers: { ...init.headers, "x-csrf-token": csrf },
    });
  if (!response.ok)
    throw new Error(
      `Roblox did not confirm the ${action} (${response.status}).`,
    );
  if (action === "kick") {
    if (await membership(userId))
      throw new Error("Roblox still reports this user as a member.");
  } else {
    const check = await fetch(url, {
      headers: { Cookie: `.ROBLOSECURITY=${session}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!check.ok) throw new Error("The community ban could not be verified.");
  }
  memberCache = undefined;
}
