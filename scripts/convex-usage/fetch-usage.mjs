// Consulta la API de plataforma de Convex (misma que usa el CLI/dashboard)
// para extraer datos de uso. El token se lee de ~/.convex/config.json y no se imprime.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const token = JSON.parse(readFileSync(join(homedir(), ".convex", "config.json"), "utf8")).accessToken;
const BASE = "https://api.convex.dev/api/";
const DEPLOYMENT = process.argv[2] || "effervescent-crab-895";

async function bb(path, opts = {}) {
  const res = await fetch(new URL(path, BASE), {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Convex-Client": "npm-cli-1.42.3",
      Origin: "https://api.convex.dev",
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${path} -> HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

const out = {};
const teamAndProject = await bb(`deployment/${DEPLOYMENT}/team_and_project`);
out.teamAndProject = teamAndProject;
const teamId = teamAndProject.teamId;

out.usageState = await bb(`dashboard/teams/${teamId}/usage/team_usage_state`).catch(e => ({ error: String(e) }));

console.log(JSON.stringify(out, null, 2));
