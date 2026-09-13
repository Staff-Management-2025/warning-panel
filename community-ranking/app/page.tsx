import Console from "./ranking-console";
import { getChatGPTUser } from "./chatgpt-auth";

export const dynamic = "force-dynamic";
export default async function Home() {
  return <Console signedIn={Boolean(await getChatGPTUser())} />;
}
