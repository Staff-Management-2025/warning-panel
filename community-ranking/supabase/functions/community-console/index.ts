import { ensureSettings } from "./server-config.ts";
import { authenticate, getViewer, limitCommand, PAGE_ORIGIN, validOrigin } from "./browser-auth.ts";
import { GET, POST } from "./console-route.ts";

export async function handle(request: Request): Promise<Response> {
  const headers = {
    "Access-Control-Allow-Origin": PAGE_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "600",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Type": "application/json",
    Vary: "Origin",
  };
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers });
  if (!validOrigin(request)) return reply({ error: "This website origin is not allowed." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (!["GET", "POST"].includes(request.method)) return reply({ error: "Method not allowed." }, 405);
  try {
    if (request.method === "POST") {
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return reply({ error: "JSON required." }, 415);
      if (Number(request.headers.get("content-length") || 0) > 4096)
        return reply({ error: "Request too large." }, 413);
      const text = await request.text();
      if (text.length > 4096) return reply({ error: "Request too large." }, 413);
      const body = JSON.parse(text);
      if (!body || Array.isArray(body) || typeof body !== "object") return reply({ error: "Invalid request." }, 400);
      await ensureSettings();
      if (["beginVerification", "verifyProfile", "logout"].includes(body.action))
        return reply(await authenticate(request, body));
      if (!await getViewer(request)) return reply({ error: "Verify your Roblox profile to sign in." }, 401);
      await limitCommand(request);
      const response = await POST(new Request(request.url, {
        method: "POST", headers: request.headers, body: text,
      }));
      return new Response(response.body, { status: response.status, headers });
    }
    await ensureSettings();
    const response = await GET(request);
    return new Response(response.body, { status: response.status, headers });
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Request unavailable." }, 400);
  }
}
Deno.serve(handle);
