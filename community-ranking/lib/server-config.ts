import { env } from "cloudflare:workers";

export const GROUP_ID = "526651322";
export const SUPABASE_URL = "https://rkulbmxvcplrzsihtjza.supabase.co";
export function setting(name: string): string {
  return String(
    (env as unknown as Record<string, unknown>)[name] ||
      process.env[name] ||
      "",
  );
}
export function configured() {
  return Boolean(setting("ROBLOX_API_KEY") && setting("RANKING_BRIDGE_TOKEN"));
}
export async function database<T = unknown>(
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const token = setting("RANKING_BRIDGE_TOKEN");
  if (!token)
    throw new Error(
      "Staff verification is being connected. Please try again shortly.",
    );
  const response = await fetch(`${SUPABASE_URL}/functions/v1/ranking-store`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(15000),
  });
  const result = (await response.json()) as { error?: string } & T;
  if (!response.ok)
    throw new Error(
      result.error || "Command storage is temporarily unavailable.",
    );
  return result;
}
