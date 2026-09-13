import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(
  new URL("../lib/roblox-server.ts", import.meta.url),
  "utf8",
).replace(
  'import { GROUP_ID, setting } from "./server-config";',
  'const GROUP_ID="526651322"; const setting=key => key === "ROBLOX_COMMUNITY_SESSION" ? "test-session-not-real" : "test-key-not-real";',
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const roblox = await import(
  `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`
);

test("community ban retries the CSRF challenge and verifies the ban", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1)
      return new Response(null, {
        status: 403,
        headers: { "x-csrf-token": "test-csrf" },
      });
    return Response.json({ userId: 200 });
  };
  try {
    await roblox.removeMember("200", "ban");
    assert.equal(calls.length, 3);
    assert.equal(calls[1].init.method, "POST");
    assert.equal(calls[1].init.headers["x-csrf-token"], "test-csrf");
    assert.ok(calls[2].url.endsWith("/bans/200"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("community kick checks the member actually left", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return init.method === "DELETE"
      ? new Response(null, { status: 204 })
      : Response.json({ groupMemberships: [] });
  };
  try {
    await roblox.removeMember("200", "kick");
    assert.equal(calls[0].init.method, "DELETE");
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an expired moderation session is a connection error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 401 });
  try {
    await assert.rejects(
      () => roblox.removeMember("200", "ban"),
      (error) =>
        error instanceof roblox.RobloxApiError &&
        error.status === 401 &&
        /expired/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
