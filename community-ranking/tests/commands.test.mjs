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

test("Change accepts a rank or role ID and can move either way without bypassing hierarchy", () => {
  assert.deepEqual(rules.parseCommand("Change ExampleUser 12884901889"), {
    action: "change", target: "ExampleUser", all: false, roleToken: "12884901889",
  });
  const change = rules.parseCommand("Change all 7");
  assert.equal(change.all, true);
  for (const rank of [1, 7, 9])
    assert.equal(rules.eligibleTarget(change, "100", 255, "200", rank, moderator), true);
  assert.equal(rules.eligibleTarget(change, "100", 9, "200", 9, moderator), false);
  assert.equal(rules.eligibleTarget(change, "100", 255, "100", 1, moderator), false);
  assert.throws(() => rules.authorizeCommand(change, 8, moderator));
  assert.throws(() => rules.authorizeCommand(change, 9, admin));
  assert.throws(() => rules.parseCommand("Change all 1; Ban all"));
});

test("PeterGriffin and Liam are never eligible targets, regardless of actor or current rank", () => {
  for (const target of ["8550354371", rules.OWNER_USER_ID]) {
    assert.ok(rules.protectedTargetName(target));
    for (const input of ["AddRole all 7", "RemoveRole username 7", "RemoveRole all all", "Change all 7", "Promote username 7", "Demote all 1"])
      for (const rank of [1, 7, 14, 254])
        assert.equal(rules.eligibleTarget(rules.parseCommand(input), "999", 255, target, rank, moderator), false);
  }
  assert.equal(rules.eligibleTarget(rules.parseCommand("Change all 7"), "999", 255, "200", 1, moderator), true);
});

test("Admin is required for ranking and inspection", () => {
  for (const input of [
    "Check Roles username",
    "Promote all 7",
    "Demote all 1",
  ]) {
    const command = rules.parseCommand(input);
    assert.throws(() => rules.authorizeCommand(command, 8));
    assert.doesNotThrow(() => rules.authorizeCommand(command, 9));
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

test("Members with an empty extra-role list remain eligible for promotion", () => {
  const member = {
    path: "groups/526651322/memberships/example",
    user: "users/200",
    role: rolePath(memberRole),
    roles: [],
  };
  assert.deepEqual(roblox.membershipRolePaths(member), [rolePath(memberRole)]);
  assert.deepEqual(roblox.assignedRoles(member, roles), [memberRole]);
  assert.equal(rules.eligibleTarget(
    rules.parseCommand("Promote AdrianAspher 7"), "100", 255, "200",
    roblox.assignedRoles(member, roles)[0].rank, moderator,
  ), true);
  assert.deepEqual(roblox.membershipRolePaths(null), []);
  assert.deepEqual(roblox.membershipRolePaths({ ...member, role: undefined }), []);
});

test("demoting to Member never assigns the built-in role and confirms the empty extra-role list", async () => {
  const realFetch = globalThis.fetch;
  const member = {
    path: "groups/526651322/memberships/example",
    user: "users/200",
    role: rolePath(moderator),
    roles: [rolePath(moderator)],
  };
  const writes = [];
  globalThis.fetch = async (url, init) => {
    if (init.method === "POST") {
      writes.push({ url, role: JSON.parse(init.body).role });
      if (url.endsWith(":assignRole") && JSON.parse(init.body).role === rolePath(memberRole))
        return Response.json({ code: "INVALID_ARGUMENT", message: "Cannot assign a base role." }, { status: 400 });
      return Response.json({});
    }
    return Response.json({ groupMemberships: [{
      ...member, role: rolePath(memberRole), roles: [],
    }] });
  };
  try {
    await roblox.setRole(member, memberRole, roles);
    assert.equal(writes.length, 1);
    assert.match(writes[0].url, /:unassignRole$/);
    assert.equal(writes[0].role, rolePath(moderator));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("bulk demotion to Member removes every extra role and leaves existing Members alone", async () => {
  const originalFetch = globalThis.fetch;
  const members = new Map([
    ["201", { path: "groups/526651322/memberships/a", user: "users/201", roles: [rolePath(moderator), rolePath(admin)] }],
    ["202", { path: "groups/526651322/memberships/b", user: "users/202", role: rolePath(memberRole), roles: [] }],
    ["203", { path: "groups/526651322/memberships/c", user: "users/203", roles: [rolePath(memberRole), rolePath(moderator)] }],
  ]);
  const writes = [];
  globalThis.fetch = async (url, init) => {
    if (init.method === "POST") {
      const target = JSON.parse(init.body).role;
      if (url.endsWith(":assignRole"))
        return Response.json({ code: "INVALID_ARGUMENT" }, { status: 400 });
      assert.notEqual(target, rolePath(memberRole), "Never remove the base Member role.");
      const row = [...members.values()].find((entry) => url.endsWith(`${entry.path}:unassignRole`));
      assert.ok(row);
      writes.push(target);
      row.roles = row.roles.filter((path) => path !== target);
      if (!row.roles.length) row.role = rolePath(memberRole);
      return Response.json({});
    }
    const id = /users\/(\d+)/.exec(new URL(url).searchParams.get("filter"))[1];
    return Response.json({ groupMemberships: [members.get(id)] });
  };
  try {
    for (const row of members.values()) await roblox.setRole(structuredClone(row), memberRole, roles);
    assert.equal(writes.length, 3);
    for (const row of members.values()) assert.deepEqual(roblox.assignedRoles(row, roles), [memberRole]);
  } finally { globalThis.fetch = originalFetch; }
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

test("demotion waits for fresh membership data without repeating writes", async () => {
  const realFetch = globalThis.fetch;
  const member = {
    path: "groups/526651322/memberships/example",
    user: "users/200",
    roles: [rolePath(admin)],
  };
  const writes = [];
  let reads = 0;
  globalThis.fetch = async (url, init) => {
    if (init.method === "POST") {
      writes.push({ url, role: JSON.parse(init.body).role });
      return Response.json({});
    }
    reads++;
    // Roblox can still return the old role or both roles just after a change.
    const held = reads === 1 ? member.roles
      : reads === 2 ? [rolePath(admin), rolePath(moderator)]
      : [rolePath(moderator), rolePath(memberRole)];
    return Response.json({ groupMemberships: [{ ...member, roles: held }] });
  };
  try {
    await roblox.setRole(member, moderator, roles);
    assert.equal(reads, 3);
    assert.deepEqual(writes.map(write => write.role), [rolePath(moderator), rolePath(admin)]);
    assert.match(writes[0].url, /:assignRole$/);
    assert.match(writes[1].url, /:unassignRole$/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("verification does not hide an unexpected role missing from the role catalog", async () => {
  const realFetch = globalThis.fetch;
  const member = {
    path: "groups/526651322/memberships/example",
    user: "users/200",
    roles: [rolePath(admin)],
  };
  globalThis.fetch = async (_url, init) => Response.json(
    init.method === "POST" ? {} : {
      groupMemberships: [{
        ...member,
        roles: [rolePath(moderator), "groups/526651322/roles/unknown"],
      }],
    },
  );
  try {
    await assert.rejects(() => roblox.setRole(member, moderator, roles), /confirm/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("membership reads explicitly bypass caches", async () => {
  const realFetch = globalThis.fetch;
  const reads = [];
  globalThis.fetch = async (_url, init) => {
    reads.push(init);
    return Response.json({ groupMemberships: [] });
  };
  try {
    await roblox.membership("200");
    await roblox.membership("200");
    assert.equal(reads.length, 2);
    for (const request of reads) {
      assert.equal(request.cache, "no-store");
      assert.equal(request.headers["Cache-Control"], "no-cache");
      assert.ok(request.signal);
    }
    assert.notEqual(reads[0].signal, reads[1].signal);
  } finally {
    globalThis.fetch = realFetch;
  }
});


test("individual commands accept role IDs and remove-all without bypassing authorization", () => {
  for (const [input, action, target, token] of [
    ["AddRole ExampleUser 682961014", "addrole", "ExampleUser", "682961014"],
    ["add role all 7", "addrole", "all", "7"],
    ["RemoveRole ExampleUser ALL", "removerole", "ExampleUser", "all"],
    ["Remove Role all 7", "removerole", "all", "7"],
    ["RemoveRole all all", "removerole", "all", "all"],
  ]) {
    const command = rules.parseCommand(input);
    assert.equal(command.action, action);
    assert.equal(command.target, target);
    assert.equal(command.roleToken, token);
    assert.equal(command.all, target === "all");
    assert.throws(() => rules.authorizeCommand(command, 8, token === "all" ? undefined : moderator));
    assert.equal(rules.eligibleTarget(command, "100", 9, "100", 1, moderator), false);
    assert.equal(rules.eligibleTarget(command, "100", 9, "200", 9, moderator), false);
  }
  for (const input of ["AddRole all all", "Change username all", "RemoveRole username 7; AddRole all 9", "RemoveRole username", "AddRole Display Name 7"])
    assert.throws(() => rules.parseCommand(input));
  for (const action of ["AddRole", "RemoveRole"]) {
    assert.throws(() => rules.authorizeCommand(rules.parseCommand(`${action} username 1`), 255, memberRole), /automatic/);
    assert.throws(() => rules.authorizeCommand(rules.parseCommand(`${action} username 9`), 9, admin), /below/);
  }
});

test("adding and removing one role preserve all other roles and never mutate Member", async () => {
  const originalFetch = globalThis.fetch;
  let current = { path: "groups/526651322/memberships/200", user: "users/200", roles: [rolePath(admin)] };
  const writes = [];
  globalThis.fetch = async (url, init) => {
    if (init.method === "POST") {
      const selected = JSON.parse(init.body).role;
      assert.notEqual(selected, rolePath(memberRole));
      writes.push({ operation: url.split(":").pop(), selected });
      current.roles = url.endsWith(":assignRole") ? [...current.roles, selected] : current.roles.filter((path) => path !== selected);
      return Response.json({});
    }
    return Response.json({ groupMemberships: [{ ...current, role: rolePath(memberRole) }] });
  };
  try {
    await roblox.editIndividualRole(current, moderator, roles, "addrole");
    assert.deepEqual(current.roles, [rolePath(admin), rolePath(moderator)]);
    await roblox.editIndividualRole(current, moderator, roles, "addrole");
    assert.equal(writes.length, 1, "An existing role is a no-op.");
    await roblox.editIndividualRole(current, moderator, roles, "removerole");
    assert.deepEqual(current.roles, [rolePath(admin)]);
    await roblox.editIndividualRole(current, moderator, roles, "removerole");
    assert.equal(writes.length, 2, "An absent role is a no-op.");
    await roblox.editIndividualRole(current, admin, roles, "removerole");
    assert.deepEqual(current.roles, []);
    assert.equal(writes.length, 3);
    for (const action of ["addrole", "removerole"])
      await assert.rejects(() => roblox.editIndividualRole(current, memberRole, roles, action), /automatic Member/);
    assert.equal(writes.length, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test("role permission failures name the connected account and retain HTTP status", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.endsWith("/introspect"))
      return Response.json({
        enabled: true,
        expired: false,
        authorizedUserId: 123,
        scopes: [{ name: "group", operations: ["read", "write"] }],
      });
    if (url.endsWith("/users/123"))
      return Response.json({
        id: 123,
        name: "TestBot",
        displayName: "Test Bot",
      });
    return Response.json(
      { code: "PERMISSION_DENIED", message: "Insufficient permissions" },
      { status: 403 },
    );
  };
  try {
    await assert.rejects(
      () =>
        roblox.setRole(
          {
            path: "groups/526651322/memberships/example",
            user: "users/200",
            roles: [rolePath(memberRole)],
          },
          moderator,
          roles,
        ),
      (error) => {
        assert.ok(error instanceof roblox.RobloxApiError);
        assert.equal(error.status, 403);
        assert.match(error.message, /@TestBot/);
        assert.match(error.message, /Assign or remove roles/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
