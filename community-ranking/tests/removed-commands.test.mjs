import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const dataUrl = (text) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const rulesUrl = dataUrl(compile("../lib/command-rules.ts"));
const rules = await import(rulesUrl);
const routeCode = compile("../app/api/console/route.ts").replace(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)";/g, (_match, names, source) => {
  if (source === "@/lib/command-rules") return `import {${names}} from ${JSON.stringify(rulesUrl)};`;
  return names.split(",").filter((name) => name.trim()).map((name) => {
    const identifier = name.trim();
    return `const ${identifier}=(...args)=>globalThis.removalFixture.${identifier}(...args);`;
  }).join("\n");
});
const route = await import(dataUrl(routeCode));
const request = (body) => new Request("https://test.invalid/api/console", {
  method: "POST", headers: { Origin: "https://test.invalid", "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("removed named and bulk commands are rejected even for Owner", () => {
  for (const input of ["Kick username", "Ban username", "Kick all", "Ban all", "bAn USERNAME"])
    assert.throws(() => rules.parseCommand(input));
  for (const action of ["kick", "ban"]) {
    assert.throws(() => rules.authorizeCommand({ action, all: true }, 255, undefined, rules.OWNER_USER_ID), /not available/);
    assert.equal(rules.eligibleTarget({ action }, "100", 255, "200", 1), false);
  }
});

test("server rejects new removals and old queued removals before a Roblox request or job claim", async () => {
  let storedCommand = "";
  const calls = [];
  globalThis.removalFixture = {
    getChatGPTUser: async () => ({ userId: "test-actor" }),
    staffAccount: async () => ({ id: rules.OWNER_USER_ID, rank: 255 }),
    database: async (action) => {
      calls.push(action);
      assert.equal(action, "job", "A removed command must never be claimed or executed.");
      return { command: storedCommand, status: "running" };
    },
  };
  for (const command of ["Kick username", "Ban username", "Kick all", "Ban all"]) {
    const preview = await route.POST(request({ action: "preview", command }));
    assert.equal(preview.status, 400);
    storedCommand = command;
    const execute = await route.POST(request({ action: "execute", jobId: crypto.randomUUID() }));
    assert.equal(execute.status, 400);
  }
  assert.deepEqual(calls, ["job", "job", "job", "job"]);
});
