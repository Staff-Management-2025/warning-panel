import type { Role } from "./ranking-types.ts";

export type Command = {
  action: "promote" | "demote" | "kick" | "ban" | "check";
  target: string;
  all: boolean;
  roleToken?: string;
};
export function parseCommand(input: string): Command {
  const text = input.trim();
  const check = /^check\s+roles\s+([A-Za-z0-9_]{3,20})$/i.exec(text);
  if (check && check[1].toLowerCase() !== "all")
    return { action: "check", target: check[1], all: false };
  const match = /^(promote|demote)\s+([A-Za-z0-9_]{3,20})\s+(\d{1,20})$/i.exec(
    text,
  );
  if (match)
    return {
      action: match[1].toLowerCase() as Command["action"],
      target: match[2],
      all: match[2].toLowerCase() === "all",
      roleToken: match[3],
    };
  const moderation = /^(kick|ban)\s+([A-Za-z0-9_]{3,20})$/i.exec(text);
  if (moderation)
    return {
      action: moderation[1].toLowerCase() as Command["action"],
      target: moderation[2],
      all: moderation[2].toLowerCase() === "all",
    };
  throw new Error(
    "Use Promote username rank, Demote username rank, Kick username, Ban username, or Check Roles username. Use all for bulk changes.",
  );
}

export function resolveRole(roles: Role[], token: string): Role {
  const exact = roles.find((role) => role.id === token);
  if (exact) return exact;
  const matching = roles.filter((role) => role.rank === Number(token));
  const base = matching.find((role) => role.isBase);
  if (base) return base;
  if (matching.length > 1)
    throw new Error(
      "More than one role has that rank. Use the full role ID from the directory.",
    );
  if (!matching.length)
    throw new Error("That role was not found in this community.");
  return matching[0];
}

export function authorizeCommand(
  command: Command,
  actorRank: number,
  role?: Role,
) {
  if (actorRank < 9) throw new Error("Admin rank 9 or higher is required.");
  if (command.all && ["kick", "ban"].includes(command.action) && actorRank < 14)
    throw new Error(
      "Kick all and Ban all require Management rank 14 or higher.",
    );
  if (role && (role.rank <= 0 || role.rank >= 255 || role.rank >= actorRank))
    throw new Error(
      "Choose a member role below your own rank. Guest and Owner are protected.",
    );
}

export function eligibleTarget(
  command: Command,
  actorId: string,
  actorRank: number,
  targetId: string,
  targetRank: number,
  role?: Role,
) {
  if (targetId === actorId || targetRank >= actorRank || targetRank <= 0)
    return false;
  if (command.action === "promote")
    return Boolean(role && targetRank < role.rank);
  if (command.action === "demote")
    return Boolean(role && targetRank > role.rank);
  return command.action === "kick" || command.action === "ban";
}
