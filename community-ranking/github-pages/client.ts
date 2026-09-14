import type { ConsoleClient } from "../app/ranking-console";
import type { State, Staff } from "../lib/ranking-types";

const ENDPOINT = "https://rkulbmxvcplrzsihtjza.supabase.co/functions/v1/community-console";
const SESSION_KEY = "authority.roblox.session";
const PROOF_KEY = "authority.roblox.proof";

function readToken() { return sessionStorage.getItem(SESSION_KEY) || ""; }
async function call<T>(query = "", body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const token = readToken();
  const res = await fetch(`${ENDPOINT}${query}`, {
    method: body ? "POST" : "GET",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
  const data = await res.json() as T & { error?: string };
  if (res.status === 401) sessionStorage.removeItem(SESSION_KEY);
  if (!res.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

export const client: ConsoleClient = {
  async request<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
    const result = await call<T & { challengeToken?: string; sessionToken?: string }>("", {
      action, ...data,
      ...(action === "verifyProfile" ? { challengeToken: sessionStorage.getItem(PROOF_KEY) || "" } : {}),
    });
    if (result.challengeToken) sessionStorage.setItem(PROOF_KEY, result.challengeToken);
    if (result.sessionToken) {
      sessionStorage.setItem(SESSION_KEY, result.sessionToken);
      sessionStorage.removeItem(PROOF_KEY);
    }
    return result;
  },
  read: () => call<State>(),
  suggest: (query, signal) => call<{ members: Staff[] }>(`?q=${encodeURIComponent(query)}`, undefined, signal),
  async logout() {
    await call("", { action: "logout" });
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(PROOF_KEY);
  },
};
