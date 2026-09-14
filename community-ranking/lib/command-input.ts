const usernameSlot = /^((?:add\s*role|remove\s*role|check\s+roles)\s+)([A-Za-z0-9_]{1,20})((?:\s+(?:\d{1,20}|all)?\s*)?)$/i;

export function commandUsername(command: string): string {
  const username = usernameSlot.exec(command.trimStart())?.[2] || "";
  return username.length >= 2 && !["all", "username"].includes(username.toLowerCase()) ? username : "";
}

export function completeUsername(command: string, username: string): string {
  const match = usernameSlot.exec(command.trimStart());
  if (!match || !/^[A-Za-z0-9_]{3,20}$/.test(username)) return command;
  return match[1] + username + (match[3] || " ");
}
