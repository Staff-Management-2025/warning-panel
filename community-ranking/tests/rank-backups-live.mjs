// Read-only checks against the deployed endpoint; never create a verification
// challenge, impersonate staff, save a snapshot, or change a Roblox membership.
import assert from "node:assert/strict";

const endpoint = "https://rkulbmxvcplrzsihtjza.supabase.co/functions/v1/community-console";
const origin = "https://staff-management-2025.github.io";
const stateResponse = await fetch(endpoint, { headers: { Origin: origin } });
assert.equal(stateResponse.status, 200);
const state = await stateResponse.json();
assert.equal(state.ready, true);
assert.equal(state.staff, null);
assert.deepEqual(state.jobs, []);
assert.equal(state.rankSave, undefined);

for (const command of ["SaveRank", "RestoreRank"]) {
  for (const token of ["", "a".repeat(64)]) {
    const response = await fetch(endpoint, { method: "POST", headers: {
      Origin: origin, "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, body: JSON.stringify({ action: "preview", command }) });
    assert.equal(response.status, 401);
  }
}
console.log("PASS: public site is available; anonymous and forged sessions cannot save or restore ranks. No live ranks changed.");
