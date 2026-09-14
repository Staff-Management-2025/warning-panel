import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

function moduleUrl(path, replacements = {}) {
  let source = readFileSync(new URL(path, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(from, to);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
}
const rulesUrl = moduleUrl("../lib/command-rules.ts");
const robloxUrl = moduleUrl("../lib/roblox-server.ts", {
  'import { GROUP_ID, setting } from "./server-config";': 'const GROUP_ID="526651322"; const setting=()=>"test-only";',
});
const backupsUrl = moduleUrl("../lib/rank-backups.ts", {
  'import { GROUP_ID } from "./server-config";': 'const GROUP_ID="526651322";',
  '"./roblox-server"': JSON.stringify(robloxUrl),
});
const rules = await import(rulesUrl);
const roblox = await import(robloxUrl);
const backups = await import(backupsUrl);
const owner = rules.OWNER_USER_ID;
const base = { id: "12884901889", name: "Member", rank: 1, isBase: true };
const mod = { id: "7", name: "Moderator", rank: 7 };
const admin = { id: "9", name: "Admin", rank: 9 };
const ownerRole = { id: "255", name: "Owner", rank: 255 };
const roles = [base, mod, admin, ownerRole];
const path = (role) => `groups/526651322/roles/${role.id}`;
const member = (id, held) => ({ user: `users/${id}`, path: `groups/526651322/memberships/${id}`, roles: held.map(path) });
const snapshot = (members) => ({ id: crypto.randomUUID(), member_count: members.length,
  created_at: new Date().toISOString(), members: backups.captureRanks(members, roles), roles });

test("SaveRank and RestoreRank require Liam's identity and actual Owner rank", () => {
  for (const text of ["SaveRank", "Save Rank Datastore", "RestoreRank", "restorerank"]) {
    const command = rules.parseCommand(text);
    assert.doesNotThrow(() => rules.authorizeCommand(command, 255, undefined, owner));
    for (const [id, rank] of [["200", 255], [owner, 254], ["200", 14], ["200", 9]])
      assert.throws(() => rules.authorizeCommand(command, rank, undefined, id), /Only Liam/);
  }
  assert.throws(() => rules.parseCommand("RestoreRank all"));
  assert.throws(() => rules.parseCommand("SaveRank; Ban all"));
});

test("save captures multiple roles and ordinary Members; malformed reads cannot replace a save", () => {
  const people = [member(owner, [ownerRole]), member("201", [mod, admin]),
    { ...member("202", []), role: path(base) }];
  const saved = backups.captureRanks(people, roles);
  assert.equal(saved.length, 3);
  assert.deepEqual(saved[1].roles, [path(mod), path(admin)].sort());
  assert.deepEqual(saved[2].roles, [path(base)]);
  assert.throws(() => backups.captureRanks([], roles), /previous save/);
  assert.throws(() => backups.captureRanks([people[0], people[0]], roles), /previous save/);
  assert.throws(() => backups.captureRanks([member("201", [{ id: "deleted" }])], roles), /deleted/);
});

test("restore plans changed saved members only, protects Owner and rejects deleted roles", () => {
  const saved = snapshot([member(owner, [ownerRole]), member("201", [mod, admin]),
    member("202", [base]), member("203", [admin]), member("204", [mod])]);
  const current = [member(owner, [ownerRole]), member("201", [base]), member("202", [base]),
    member("204", [ownerRole]), member("205", [admin])];
  const plan = backups.planRestore(saved, current, roles, owner);
  assert.deepEqual(plan.items.map((item) => item.userId), ["201"]);
  assert.deepEqual(plan.items[0].desiredRoles, [path(mod), path(admin)].sort());
  assert.equal(plan.unchanged, 1);
  assert.equal(plan.unavailable, 3);
  assert.equal(backups.planRestore(saved, current, roles.filter((r) => r !== mod), owner).items.length, 0);
  assert.ok(backups.sameRoleSet([path(base), path(mod)], [path(mod)], roles));
});

test("restore writes every saved role, removes later roles, and confirms the complete set", async () => {
  const originalFetch = globalThis.fetch;
  let current = member("201", [admin]);
  const writes = [];
  globalThis.fetch = async (url, init) => {
    if (init.method === "POST") {
      const role = JSON.parse(init.body).role;
      writes.push({ url, role });
      current.roles = url.endsWith(":assignRole") ? [...current.roles, role] : current.roles.filter((r) => r !== role);
      return Response.json({});
    }
    return Response.json({ groupMemberships: [{ ...current, ...(current.roles.length ? {} : { role: path(base) }) }] });
  };
  try {
    await roblox.restoreRoleSet(current, [path(mod)], roles);
    assert.equal(writes.length, 2);
    assert.ok(writes[0].url.endsWith(":assignRole"));
    assert.ok(writes[1].url.endsWith(":unassignRole"));
    await roblox.restoreRoleSet(current, [path(mod), path(admin)], roles);
    assert.deepEqual(current.roles.sort(), [path(mod), path(admin)].sort());
    await roblox.restoreRoleSet(current, [path(base)], roles);
    assert.equal(current.roles.length, 0, "Restoring Member removes all extra roles.");
    const count = writes.length;
    await assert.rejects(() => roblox.restoreRoleSet(current, [path(ownerRole)], roles), /protected/);
    assert.equal(writes.length, count);
  } finally { globalThis.fetch = originalFetch; }
});

const routeUrl = moduleUrl("../app/api/console/route.ts", {
  'import { getChatGPTUser } from "@/app/chatgpt-auth";': 'const getChatGPTUser=async()=>({userId:"owner-site"});',
  'import { configured, database } from "@/lib/server-config";': 'const configured=()=>true; const database=(...args)=>globalThis.backupFixture.database(...args);',
  'import { staffAccount, membershipRoles } from "@/lib/server-service";': 'const staffAccount=async()=>globalThis.backupFixture.staff; const membershipRoles=(paths)=>[...paths].sort().join("|");',
  '"@/lib/roblox-server"': JSON.stringify(robloxUrl),
  '"@/lib/command-rules"': JSON.stringify(rulesUrl),
  '"@/lib/rank-backups"': JSON.stringify(backupsUrl),
  '"@/lib/ranking-types"': JSON.stringify(moduleUrl("../lib/ranking-types.ts")),
});
const route = await import(routeUrl);
const request = (body) => new Request("https://test.invalid/api/console", {
  method: "POST", headers: { Origin: "https://test.invalid", "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("HTTP save/restore and resumed restores reject non-owners before touching stored data", async () => {
  let accesses = 0;
  globalThis.backupFixture = { staff: { id: "201", rank: 14 }, database: async (action) => {
    accesses++;
    if (action === "job") return { command: "RestoreRank", status: "running", items: [] };
    throw new Error("Unauthorized storage access");
  } };
  for (const command of ["SaveRank", "RestoreRank"]) {
    const result = await route.POST(request({ action: "preview", command }));
    assert.equal(result.status, 400);
    assert.match((await result.json()).error, /Only Liam/);
  }
  assert.equal(accesses, 0);
  const result = await route.POST(request({ action: "execute", jobId: crypto.randomUUID() }));
  assert.equal(result.status, 400);
  assert.match((await result.json()).error, /Only Liam/);
  assert.equal(accesses, 1, "The job must not be claimed or written.");
});

test("HTTP save commits only after complete reads; restore preview pins that immutable save", async () => {
  const originalFetch = globalThis.fetch;
  let current = [member(owner, [ownerRole]), member("201", [mod, admin])];
  let saved = null;
  let storedJob = null;
  let failRead = false;
  globalThis.backupFixture = { staff: { id: owner, rank: 255 }, database: async (action, payload) => {
    if (action === "saveRankSnapshot") return saved = { id: crypto.randomUUID(), created_at: new Date().toISOString(), member_count: payload.members.length, ...payload };
    if (action === "rankSnapshot") return saved;
    if (action === "createJob") return storedJob = { id: crypto.randomUUID(), status: "preview", ...payload.job };
    throw new Error(action);
  } };
  globalThis.fetch = async (url) => {
    if (url.includes("/roles?")) return Response.json({ groupRoles: roles.map((r) => ({ ...r, displayName: r.name })) });
    if (url.includes("/memberships?")) {
      if (failRead) return new Response(null, { status: 503 });
      return Response.json({ groupMemberships: current });
    }
    if (url.endsWith("/introspect")) return Response.json({ enabled: true, scopes: [{ name: "group", operations: ["read", "write"] }] });
    throw new Error(`Unexpected write: ${url}`);
  };
  try {
    let response = await route.POST(request({ action: "preview", command: "SaveRank" }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).rankSave.member_count, 2);
    const savedId = saved.id;
    failRead = true;
    response = await route.POST(request({ action: "preview", command: "SaveRank" }));
    assert.equal(response.status, 400);
    assert.equal(saved.id, savedId);
    failRead = false;
    current = [member(owner, [ownerRole]), member("201", [base])];
    response = await route.POST(request({ action: "preview", command: "RestoreRank" }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.job.total, 1);
    assert.equal(storedJob.snapshot_id, savedId);
    assert.deepEqual(result.job.changes[0].after, ["Moderator", "Admin"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("restore execution verifies writes, refuses changed previews, and reconciles interrupted jobs without replay", async () => {
  const originalFetch = globalThis.fetch;
  let writes = 0;
  let current = member("201", [base]);
  let job;
  const makeJob = (status = "pending") => ({ id: crypto.randomUUID(), command: "RestoreRank", action: "restore",
    status: "running", total: 1, items: [{ userId: "201", originalRoles: [path(base)],
      desiredRoles: [path(mod), path(admin)], status }] });
  globalThis.backupFixture = { staff: { id: owner, rank: 255 }, database: async (action, payload) => {
    if (action === "job" || action === "claimJob") return structuredClone(job);
    if (action === "saveJob") {
      job.items = structuredClone(payload.items);
      job.completed = job.items.filter((i) => i.status === "completed").length;
      job.failed = job.items.filter((i) => i.status === "failed").length;
      job.status = job.completed + job.failed === 1 ? (job.failed ? "partial" : "completed") : "running";
      return structuredClone(job);
    }
    throw new Error(action);
  } };
  globalThis.fetch = async (url, init) => {
    if (url.includes("/roles?")) return Response.json({ groupRoles: roles.map((r) => ({ ...r, displayName: r.name })) });
    if (init.method === "POST") {
      assert.equal(job.items[0].status, "processing", "Intent must be persisted before each Roblox write.");
      writes++;
      const role = JSON.parse(init.body).role;
      current.roles = url.endsWith(":assignRole") ? [...current.roles, role] : current.roles.filter((p) => p !== role);
      return Response.json({});
    }
    return Response.json({ groupMemberships: [current] });
  };
  const execute = async () => {
    const response = await route.POST(request({ action: "execute", jobId: job.id }));
    assert.equal(response.status, 200);
    return (await response.json()).job;
  };
  try {
    job = makeJob();
    assert.equal((await execute()).status, "completed");
    assert.equal(writes, 2);
    job = makeJob();
    current = member("201", [mod]);
    assert.equal((await execute()).failed, 1, "Changed roles since preview must not be overwritten.");
    assert.equal(writes, 2);
    job = makeJob("processing");
    assert.equal((await execute()).failed, 1, "An uncertain partial write requires a fresh review.");
    assert.equal(writes, 2);
    job = makeJob("processing");
    current = member("201", [mod, admin]);
    assert.equal((await execute()).completed, 1);
    assert.equal(writes, 2, "A completed interrupted request must not be repeated.");
  } finally { globalThis.fetch = originalFetch; }
});

test("Change all reviews upward and downward changes together and excludes exact matches", async () => {
  const originalFetch = globalThis.fetch;
  const current = [member(owner, [ownerRole]), member("201", [base]), member("202", [mod, admin]), member("203", [mod])];
  let stored;
  globalThis.backupFixture = { staff: { id: owner, rank: 255 }, database: async (action, payload) => {
    assert.equal(action, "createJob");
    return stored = { id: crypto.randomUUID(), status: "preview", ...payload.job };
  } };
  globalThis.fetch = async (url, init) => {
    if (url.endsWith("/introspect")) return Response.json({ enabled: true, scopes: [{ name: "group", operations: ["read", "write"] }] });
    assert.notEqual(init.method, "POST", "Review must not write to Roblox.");
    if (url.includes("/roles?")) return Response.json({ groupRoles: roles.map((r) => ({ ...r, displayName: r.name })) });
    return Response.json({ groupMemberships: current });
  };
  try {
    let response = await route.POST(request({ action: "preview", command: "Change all 7" }));
    assert.equal(response.status, 200);
    assert.equal(stored.action, "change");
    assert.deepEqual(stored.items.map((i) => i.userId), ["201", "202"]);
    assert.equal(stored.skipped, 2);
    response = await route.POST(request({ action: "preview", command: "Change all 1" }));
    assert.equal(response.status, 200);
    assert.deepEqual(stored.items.map((i) => i.userId), ["202", "203"]);
  } finally { globalThis.fetch = originalFetch; }
});
