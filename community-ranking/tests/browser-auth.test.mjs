import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

let source = readFileSync(new URL("../supabase/functions/community-console/browser-auth.ts", import.meta.url), "utf8");
source = source.replace('import { storage } from "./storage.ts";',
  'const storage = (...args) => globalThis.authFixture.storage(...args);');
source = source.replace('import { exactUser, profile, getRoles, membership, assignedRoles } from "./roblox-server.ts";',
  'const exactUser = (...args) => globalThis.authFixture.exactUser(...args); const profile = () => globalThis.authFixture.profile(); const getRoles = async () => []; const membership = async () => null; const assignedRoles = () => [{rank: globalThis.authFixture.rank}];');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const auth = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const req = (token, origin = auth.PAGE_ORIGIN) => new Request("https://example.supabase.co/functions/v1/community-console", {
  headers: { Origin: origin, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
});
function fixture() {
  const challenges = new Map();
  const sessions = new Map();
  const f = {
    rank: 9, allowed: true, description: "", lookupCount: 0, expired: false,
    async exactUser() { f.lookupCount++; return {id:200, name:"ExampleStaff"}; },
    async profile() { return {id:200, description:f.description}; },
    async storage(path, method, body) {
      if (path === "rpc/ranking_rate_limit") return f.allowed;
      if (path === "ranking_browser_challenges") {
        challenges.set(body.token_hash, body);
        return [{ ...body, expires_at:new Date(Date.now()+600000).toISOString() }];
      }
      if (path.startsWith("ranking_browser_challenges?")) {
        const row = challenges.get(/token_hash=eq\.([a-f0-9]{64})/.exec(path)?.[1]);
        return row && !f.expired ? [row] : [];
      }
      if (path === "rpc/ranking_finish_browser_proof") {
        assert.ok(challenges.delete(body.p_hash), "The challenge must be consumed once.");
        sessions.set(body.p_session_hash, { actor_id:"roblox:200" });
        return { expiresAt:new Date(Date.now()+28800000).toISOString() };
      }
      if (path.startsWith("ranking_browser_sessions?")) {
        const key = /token_hash=eq\.([a-f0-9]{64})/.exec(path)?.[1];
        if (method === "DELETE") { sessions.delete(key); return []; }
        return sessions.has(key) && !f.expired ? [sessions.get(key)] : [];
      }
      throw new Error(`Unexpected storage request: ${path}`);
    },
  };
  globalThis.authFixture = f;
  return { f, challenges, sessions };
}

test("profile code alone cannot sign in; private proof tokens are single-use", async () => {
  const { f, sessions } = fixture();
  const proof = await auth.authenticate(req(), {action:"beginVerification", username:"ExampleStaff"});
  assert.match(proof.code, /^AUTH-[a-f0-9]{32}$/);
  assert.match(proof.challengeToken, /^[a-f0-9]{64}$/);
  f.description = `My profile ${proof.code}`;
  await assert.rejects(() => auth.authenticate(req(), {action:"verifyProfile", challengeToken:proof.code}), /first/);
  await assert.rejects(() => auth.authenticate(req(), {action:"verifyProfile", challengeToken:"f".repeat(64)}), /expired/);
  const result = await auth.authenticate(req(), {action:"verifyProfile", challengeToken:proof.challengeToken});
  assert.match(result.sessionToken, /^[a-f0-9]{64}$/);
  assert.equal(sessions.has(result.sessionToken), false, "Store only session hashes.");
  assert.deepEqual(await auth.getViewer(req(result.sessionToken)), {userId:"roblox:200"});
  await assert.rejects(() => auth.authenticate(req(), {action:"verifyProfile", challengeToken:proof.challengeToken}), /already used/);
  await auth.authenticate(req(result.sessionToken), {action:"logout"});
  assert.equal(await auth.getViewer(req(result.sessionToken)), null);
});

test("staff rank is checked both before issuing a code and before creating a session", async () => {
  const { f, sessions } = fixture();
  f.rank = 1;
  await assert.rejects(() => auth.authenticate(req(), {action:"beginVerification", username:"ExampleStaff"}), /Admin/);
  f.rank = 9;
  const proof = await auth.authenticate(req(), {action:"beginVerification", username:"ExampleStaff"});
  f.description = proof.code;
  f.rank = 1;
  await assert.rejects(() => auth.authenticate(req(), {action:"verifyProfile", challengeToken:proof.challengeToken}), /Admin/);
  assert.equal(sessions.size, 0);
});

test("missing profile codes, expired challenges and expired sessions are rejected", async () => {
  const { f } = fixture();
  const proof = await auth.authenticate(req(), {action:"beginVerification", username:"ExampleStaff"});
  await assert.rejects(() => auth.authenticate(req(), {action:"verifyProfile", challengeToken:proof.challengeToken}), /not in your Roblox About/);
  f.description = proof.code;
  f.expired = true;
  await assert.rejects(() => auth.authenticate(req(), {action:"verifyProfile", challengeToken:proof.challengeToken}), /expired/);
  f.expired = false;
  const result = await auth.authenticate(req(), {action:"verifyProfile", challengeToken:proof.challengeToken});
  f.expired = true;
  assert.equal(await auth.getViewer(req(result.sessionToken)), null);
});

test("verification rate limits stop repeated Roblox lookups", async () => {
  const { f } = fixture();
  f.allowed = false;
  await assert.rejects(() => auth.authenticate(req(), {action:"beginVerification", username:"ExampleStaff"}), /Too many attempts/);
  assert.equal(f.lookupCount, 0);
});

test("forged sessions and unapproved origins cannot establish an identity", async () => {
  fixture();
  assert.equal(await auth.getViewer(req("f".repeat(64))), null);
  assert.equal(await auth.getViewer(req("roblox:200")), null);
  assert.equal(auth.validOrigin(req()), true);
  assert.equal(auth.validOrigin(req(null, "https://staff-management-2025.github.io.attacker.example")), false);
  assert.equal(auth.validOrigin(new Request("https://example.com")), false);
});
