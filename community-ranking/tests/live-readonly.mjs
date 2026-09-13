// Opt-in read-only checks. No community memberships or roles are changed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/roblox-server.ts", import.meta.url), "utf8")
  .replace('import { GROUP_ID, setting } from "./server-config";',
    'const GROUP_ID = "526651322"; const setting = key => process.env[key];');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const roblox = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const roles = await roblox.getRoles(true);
assert.ok(roles.length >= 16);
const user = await roblox.exactUser("Liamthebest10001");
const held = roblox.assignedRoles(await roblox.membership(String(user.id)), roles);
assert.ok(held.some(role => role.rank === 255));
console.log(JSON.stringify({ checkRoles: user.name, roles: held.map(role => ({ name: role.name, rank: role.rank, id: role.id })), directoryRoleCount: roles.length }));

const endpoint = "https://rkulbmxvcplrzsihtjza.supabase.co/functions/v1/ranking-store";
const bad = await fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer invalid" } });
assert.equal(bad.status, 401);
const good = await fetch(endpoint, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.RANKING_BRIDGE_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ action: "account", siteUserId: "__read_only_probe__" }),
});
assert.equal(good.status, 200);
assert.equal(await good.json(), null);
console.log("PASS: storage rejects invalid authentication; private server access works.");

const unauthorized = await fetch("http://localhost:5173/api/console", {
  method: "POST",
  headers: { Origin: "http://localhost:5173", "Content-Type": "application/json" },
  body: JSON.stringify({ action: "preview", command: "Promote nobody 7" }),
});
assert.ok([400, 401, 403].includes(unauthorized.status));
const rejection = await unauthorized.json();
assert.match(rejection.error, /verify|sign in/i);
console.log("PASS: unverified visitors cannot run commands.");
