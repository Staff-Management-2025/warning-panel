import { storage } from "./storage.ts";
import { exactUser, profile, getRoles, membership, assignedRoles } from "./roblox-server.ts";

export const PAGE_ORIGIN = "https://staff-management-2025.github.io";
export function validOrigin(request: Request) {
  return request.headers.get("origin") === PAGE_ORIGIN;
}
export function tokenFrom(request: Request) {
  const value = request.headers.get("authorization") || "";
  return /^Bearer [a-f0-9]{64}$/.test(value) ? value.slice(7) : null;
}
export async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(value),
  )), byte => byte.toString(16).padStart(2, "0")).join("");
}
function randomToken(bytes = 32) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),
    byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function getViewer(request: Request) {
  const token = tokenFrom(request);
  if (!token) return null;
  const rows = await storage(`ranking_browser_sessions?token_hash=eq.${await hash(token)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=actor_id&limit=1`);
  return rows[0] ? { userId: rows[0].actor_id } : null;
}
async function limit(key: string, maximum: number, seconds = 60) {
  if (!await storage("rpc/ranking_rate_limit", "POST", {
    p_key: key, p_limit: maximum, p_seconds: seconds,
  })) throw new Error("Too many attempts. Wait a minute and try again.");
}
async function requireAdmin(userId: string) {
  const roles = await getRoles(true);
  if ((assignedRoles(await membership(userId), roles)[0]?.rank || 0) < 9)
    throw new Error("Only community Admin rank 9 or higher can use this staff website.");
}
export async function authenticate(request: Request, body: Record<string, unknown>) {
  if (body.action === "logout") {
    const token = tokenFrom(request);
    if (token) await storage(`ranking_browser_sessions?token_hash=eq.${await hash(token)}`, "DELETE");
    return { signedOut: true };
  }
  if (body.action === "beginVerification") {
    const username = String(body.username || "").trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) throw new Error("Enter your exact Roblox username.");
    // Rate limits are stored in Postgres so new Edge Function instances do not reset them.
    await limit(`login:user:${username.toLowerCase()}`, 3);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    await limit(`login:network:${await hash(ip)}`, 15);
    const user = await exactUser(username);
    await requireAdmin(String(user.id));
    const challengeToken = randomToken();
    const code = `AUTH-${randomToken(16)}`;
    const rows = await storage("ranking_browser_challenges", "POST", {
      token_hash: await hash(challengeToken),
      roblox_id: String(user.id), username: user.name, code,
    });
    return { code, userId: String(user.id), challengeToken, expiresAt: rows[0].expires_at };
  }
  if (body.action === "verifyProfile") {
    const challengeToken = String(body.challengeToken || "");
    if (!/^[a-f0-9]{64}$/.test(challengeToken)) throw new Error("Request a verification code first.");
    const digest = await hash(challengeToken);
    await limit(`login:proof:${digest}`, 10);
    const rows = await storage(`ranking_browser_challenges?token_hash=eq.${digest}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`);
    const proof = rows[0];
    if (!proof) throw new Error("Verification expired or already used. Request a new code.");
    const user = await profile(proof.roblox_id);
    if (!user.description?.includes(proof.code))
      throw new Error("The code is not in your Roblox About description yet. Save it on Roblox, then verify again.");
    await requireAdmin(proof.roblox_id);
    const sessionToken = randomToken();
    const result = await storage("rpc/ranking_finish_browser_proof", "POST", {
      p_hash: digest, p_code: proof.code, p_session_hash: await hash(sessionToken),
    });
    return { verified: true, sessionToken, expiresAt: result.expiresAt };
  }
  return null;
}

export async function limitCommand(request: Request) {
  const token = tokenFrom(request);
  if (token) await limit(`command:${await hash(token)}`, 90);
}
