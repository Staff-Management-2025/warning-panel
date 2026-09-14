import { storage } from "./storage.ts";

export const GROUP_ID = "526651322";
let secrets: Record<string, string> = {};
let expires = 0;
export async function ensureSettings() {
  if (expires > Date.now()) return;
  const saved = await storage("rpc/ranking_runtime_settings", "POST", {});
  secrets = {
    ROBLOX_API_KEY: saved.AUTHORITY_ROBLOX_API_KEY || "",
    RANKING_BRIDGE_TOKEN: saved.AUTHORITY_RANKING_BRIDGE_TOKEN || "",
  };
  expires = Date.now() + 60000;
}
export const setting = (key: string): string => secrets[key] || "";
export const configured = () => Boolean(setting("ROBLOX_API_KEY") && setting("RANKING_BRIDGE_TOKEN"));

export async function database<T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ranking-store`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${setting("RANKING_BRIDGE_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action, ...payload }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Command storage is unavailable.");
  return result;
}
