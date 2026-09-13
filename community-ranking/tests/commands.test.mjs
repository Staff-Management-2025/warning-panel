import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

async function loadModule(path, replace = (value) => value) {
  const source = replace(readFileSync(new URL(path, import.meta.url), "utf8"));
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
  );
}

const rules = await loadModule("../lib/command-rules.ts");
const roblox = await loadModule("../lib/roblox-server.ts", (source) =>
  source.replace(
    'import { GROUP_ID, setting } from "./server-config";',
    'const GROUP_ID = "526651322"; const setting = key => key === "ROBLOX_API_KEY" ? "test-only" : undefined;',
  ),
);
const memberRole = { id: "12884901889", rank: 1, name: "Member", isBase: true };
const moderator = { id: "682961014", rank: 7, name: "Moderator" };
const admin = { id: "682597014", rank: 9, name: "Admin" };
const roles = [
  memberRole,
  moderator,
  admin,
  { id: "830777473", rank: 1, name: "Owner" },
];
const rolePath = (role) => `groups/526651322/roles/${role.id}`;

test("Check Roles accepts exact usernames and is read only", () => {
  assert.deepEqual(rules.parseCommand("Check Roles Liamthebest10001"), {
    action: "check",
    target: "Liamthebest10001",
    all: false,
  });
  assert.throws(() => rules.parseCommand("Check Roles all"));
  assert.throws(() => rules.parseCommand("Check Roles Display Name"));
});

test("malformed and chained commands are rejected", () => {
  for (const text of [
    "Ban username; Kick all",
    "Promote name -1",
    "Promote username 7 extra",
    "Kick a",
    "Check Roles",
    "Promote user NaN",
  ]) {
    assert.throws(() => rules.parseCommand(text));
  }
});

test("role IDs retain precision and base rank resolves to Member", () => {
  assert.equal(rules.resolveRole(roles, "12884901889").id, memberRole.id);
  assert.equal(rules.resolveRole(roles, "1").id, memberRole.id);
  assert.equal(rules.resolveRole(roles, "7").id, moderator.id);
  assert.throws(() =>
    rules.resolveRole([moderator, { ...moderator, id: "another" }], "7"),
  );
});

test("Admin is required; Management is required only for bulk removals", () => {
  for (const input of [
    "Check Roles username",
    "Kick username",
    "Ban username",
    "Promote all 7",
    "Demote all 1",
  ]) {
    const command = rules.parseCommand(input);
    assert.throws(() => rules.authorizeCommand(command, 8));
    assert.doesNotThrow(() => rules.authorizeCommand(command, 9));
  }
  for (const input of ["Kick all", "Ban all"]) {
    const command = rules.parseCommand(input);
    assert.throws(() => rules.authorizeCommand(command, 13));
    assert.doesNotThrow(() => rules.authorizeCommand(command, 14));
  }
});

test("self, peers, higher staff and invalid direction are protected", () => {
  const promote = rules.parseCommand("Promote someone 7");
  const demote = rules.parseCommand("Demote someone 1");
  assert.equal(
    rules.eligibleTarget(promote, "100", 9, "100", 1, moderator),
    false,
  );
  assert.equal(
    rules.eligibleTarget(promote, "100", 9, "200", 9, moderator),
    false,
  );
  assert.equal(
    rules.eligibleTarget(promote, "100", 9, "200", 1, moderator),
    true,
  );
  assert.equal(
    rules.eligibleTarget(demote, "100", 9, "200", 7, memberRole),
    true,
  );
  assert.equal(
    rules.eligibleTarget(demote, "100", 9, "200", 1, moderator),
    false,
  );
  for (const rank of [0, 9, 255])
    assert.throws(() =>
      rules.authorizeCommand(promote, 9, { ...moderator, rank }),
    );
});

test("Check Roles returns the complete multi-role set, highest first", () => {
  const member = {
    path: "groups/526651322/memberships/example",
    user: "users/200",
    roles: roles.slice(0, 3).map(rolePath),
    role: rolePath(admin),
  };
  assert.deepEqual(
    roblox.assignedRoles(member, roles).map((role) => role.id),
    [admin.id, moderator.id, memberRole.id],
  );
  assert.deepEqual(roblox.assignedRoles(null, roles), []);
});

test("demotion removes old higher roles and verifies the resulting set", async () => {
  const realFetch = globalThis.fetch;
  const operations = [];
  const member = {
    path: "groups/526651322/memberships/example",
    user: "users/200",
    roles: [rolePath(admin), rolePath(memberRole)],
  };
  globalThis.fetch = async (url, init) => {
    operations.push({ url, method: init.method, body: init.body });
    return Response.json(
      init.method === "POST"
        ? {}
        : {
            groupMemberships: [
              { ...member, roles: [rolePath(moderator), rolePath(memberRole)] },
            ],
          },
    );
  };
  try {
    await roblox.setRole(member, moderator, roles);
    assert.match(operations[0].url, /:assignRole$/);
    assert.match(operations[1].url, /:unassignRole$/);
    assert.equal(JSON.parse(operations[1].body).role, rolePath(admin));
    assert.equal(operations.length, 3);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("incomplete Roblox changes cannot be reported as success", async () => {
  const realFetch = globalThis.fetch;
  const member = {
    path: "groups/526651322/memberships/example",
    user: "users/200",
    roles: [rolePath(admin)],
  };
  globalThis.fetch = async (_url, init) =>
    Response.json(
      init.method === "POST"
        ? {}
        : {
            groupMemberships: [
              { ...member, roles: [rolePath(admin), rolePath(moderator)] },
            ],
          },
    );
  try {
    await assert.rejects(
      () => roblox.setRole(member, moderator, roles),
      /did not confirm/,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("Kick and Ban cannot silently fall back to an API key", async () => {
  assert.equal(roblox.removalConnected(), false);
  await assert.rejects(
    () => roblox.removeMember("200", "ban"),
    /moderation session/,
  );
});
