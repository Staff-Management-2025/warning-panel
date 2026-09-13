// This endpoint accepts only the private Sites server's high-entropy bridge token.
// Its SHA-256 fingerprint is safe to commit. No Roblox or database secret belongs here.
const BRIDGE_SHA256 =
  "6bceaaa8e1e936d597898bda281adcc98064135b01f21297fcdb4f8f6ba1b2d3";
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
async function storage(path: string, method = "GET", body?: unknown) {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const response = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/rest/v1/${path}`,
    {
      method,
      headers: {
        apikey: secret,
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message || "Database request failed.");
  return result;
}

Deno.serve(async (request) => {
  if (request.method !== "POST")
    return json({ error: "Method not allowed." }, 405);
  const token =
    request.headers.get("authorization")?.replace(/^Bearer /, "") || "";
  if (token.length < 40 || token.length > 150)
    return json({ error: "Unauthorized." }, 401);
  const digest = Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    ),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  let mismatch = digest.length ^ BRIDGE_SHA256.length;
  for (let i = 0; i < digest.length; i++)
    mismatch |= digest.charCodeAt(i) ^ (BRIDGE_SHA256.charCodeAt(i) || 0);
  if (mismatch) return json({ error: "Unauthorized." }, 401);
  try {
    if (Number(request.headers.get("content-length") || 0) > 2_000_000)
      return json({ error: "Request too large." }, 413);
    const p = await request.json();
    if (typeof p.siteUserId !== "string" || p.siteUserId.length > 200)
      return json({ error: "Invalid account." }, 400);
    const actor = encodeURIComponent(p.siteUserId);
    switch (p.action) {
      case "account":
        return json(
          (
            await storage(`ranking_accounts?site_user_id=eq.${actor}&limit=1`)
          )[0] || null,
        );
      case "proof":
        return json(
          (
            await storage(`ranking_challenges?site_user_id=eq.${actor}&limit=1`)
          )[0] || null,
        );
      case "beginProof":
        return json(
          await storage("rpc/ranking_begin_proof", "POST", {
            p_actor: p.siteUserId,
            p_user: p.userId,
            p_username: p.username,
            p_code: p.code,
          }),
        );
      case "finishProof":
        return json(
          await storage("rpc/ranking_finish_proof", "POST", {
            p_actor: p.siteUserId,
            p_code: p.code,
          }),
        );
      case "history":
        return json(
          await storage(
            `ranking_jobs?actor_id=eq.${actor}&order=created_at.desc&limit=10&select=id,command,action,target_role_name,status,total,completed,failed,skipped,created_at,error`,
          ),
        );
      case "job":
        return json(
          (
            await storage(
              `ranking_jobs?id=eq.${encodeURIComponent(p.jobId)}&actor_id=eq.${actor}&limit=1`,
            )
          )[0] || null,
        );
      case "createJob": {
        const recent = await storage(
          `ranking_jobs?actor_id=eq.${actor}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 60000).toISOString())}&select=id&limit=11`,
        );
        if (recent.length >= 10)
          return json(
            { error: "Wait a minute before creating another command." },
            429,
          );
        return json(
          (
            await storage("ranking_jobs", "POST", {
              ...p.job,
              actor_id: p.siteUserId,
            })
          )[0],
        );
      }
      case "claimJob":
        return json(
          await storage("rpc/ranking_claim_job", "POST", {
            p_actor: p.siteUserId,
            p_job: p.jobId,
            p_lease: p.lease,
          }),
        );
      case "saveJob":
        return json(
          await storage("rpc/ranking_save_job", "POST", {
            p_actor: p.siteUserId,
            p_job: p.jobId,
            p_lease: p.lease,
            p_items: p.items,
            p_release: p.release === true,
          }),
        );
      default:
        return json({ error: "Unknown storage operation." }, 400);
    }
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : "Storage unavailable.",
      },
      400,
    );
  }
});
