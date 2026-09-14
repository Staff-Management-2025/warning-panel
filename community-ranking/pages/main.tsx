import { createRoot } from "react-dom/client";
import Console from "../app/ranking-console";
import { client } from "./client";
import "../app/globals.css";
import "../app/console.css";

createRoot(document.getElementById("root")!).render(<Console signedIn client={client} />);
