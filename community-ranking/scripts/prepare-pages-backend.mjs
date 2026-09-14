// Copy shared rules into the deployable Edge Function. No credentials are embedded.
import { readFile, writeFile } from "node:fs/promises";
const target = "supabase/functions/community-console/";
for (const name of ["roblox-server", "server-service", "command-rules", "ranking-types"]) {
  let source = await readFile(`lib/${name}.ts`, "utf8");
  source = source.replace(/from "\.\/(server-config|roblox-server|ranking-types)"/g, 'from "./$1.ts"');
  await writeFile(`${target}${name}.ts`, source);
}
let route = await readFile("app/api/console/route.ts", "utf8");
route = route.replace('import { getChatGPTUser } from "@/app/chatgpt-auth";',
  'import { getViewer, validOrigin } from "./browser-auth.ts";');
route = route.replaceAll('await getChatGPTUser()', 'await getViewer(request)');
route = route.replace(/from "@\/lib\/([^"/]+)"/g, 'from "./$1.ts"');
route = route.replace('request.headers.get("origin") !== new URL(request.url).origin', '!validOrigin(request)');
const start = route.indexOf('    if (body.action === "beginVerification")');
const end = route.indexOf('    const staff = await staffAccount(siteUserId);', start);
if (start < 0 || end < 0) throw new Error("Could not locate the legacy sign-in handlers.");
route = route.slice(0, start) + route.slice(end);
await writeFile(`${target}console-route.ts`, route);
console.log("Prepared shared command code for Supabase.");
