// Extracción de datos de uso de Convex (misma API que usa el dashboard).
// QueryIds extraídos del bundle público de dashboard.convex.dev.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const token = JSON.parse(readFileSync(join(homedir(), ".convex", "config.json"), "utf8")).accessToken;
const BASE = "https://api.convex.dev/api/";
const TEAM = 397658;
const PROJECT = 2665409;
const DEPLOYMENT = "effervescent-crab-895";
const FROM = "2026-08-28";
const TO = "2026-09-28";

const Q = {
  teamSummary: "b63fe48d-320c-401a-8682-0a0b36b50e2b",
  functionCallsPerDay: "77a4e5bd-aa82-43e7-85a4-89897cecaa05",
  functionCallsPerDayStorageApi: "90c9d3b3-d93e-4583-a054-dbb2f9dad5a3",
  metricsByFunction: "76c86baa-418e-4d7f-ac21-46f397030595",
  dataEgressPerDay: "67ce838f-b2d0-4cda-9a2e-580c6d134466",
  databaseIOPerDay: "9f606f77-521d-44bb-83ef-b1057b0fb1c9",
  databaseStoragePerDay: "489b0f87-6b3a-4dfe-a327-f2965b5c2977",
  databaseStoragePerDayByTable: "017c5977-3002-40ca-96af-31868e70e611",
  documentCountPerDayByTable: "28646a64-f234-44c2-b763-ecb63d43ad24",
  computePerDay: "038e5492-6de5-4ddb-86b4-761e19b4d2ab",
  documentsPerDayByProject: "2a5120a1-b334-4d99-b378-1028487c2202",
};

async function usageQuery(queryId, extra = {}) {
  const params = new URLSearchParams({
    queryId,
    from: FROM,
    to: TO,
    ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])),
  });
  const res = await fetch(
    new URL(`dashboard/teams/${TEAM}/usage/query?${params.toString()}`, BASE),
    { headers: { Authorization: `Bearer ${token}`, Origin: "https://api.convex.dev" } }
  );
  if (!res.ok) throw new Error(`${queryId} -> HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const out = {};
const jobs = [
  ["teamSummary_month", Q.teamSummary, {}],
  ["functionCallsPerDay", Q.functionCallsPerDay, { projectId: PROJECT }],
  ["functionCallsPerDay_dep", Q.functionCallsPerDay, { deploymentName: DEPLOYMENT }],
  ["metricsByFunction", Q.metricsByFunction, { projectId: PROJECT }],
  ["dataEgressPerDay", Q.dataEgressPerDay, { projectId: PROJECT }],
  ["databaseIOPerDay", Q.databaseIOPerDay, { projectId: PROJECT }],
  ["databaseStoragePerDay", Q.databaseStoragePerDay, { projectId: PROJECT }],
  ["databaseStorageByTable", Q.databaseStoragePerDayByTable, { projectId: PROJECT }],
  ["documentCountByTable", Q.documentCountPerDayByTable, { projectId: PROJECT }],
  ["computePerDay", Q.computePerDay, { projectId: PROJECT }],
];

for (const [name, id, extra] of jobs) {
  try {
    out[name] = await usageQuery(id, extra);
    console.error(`OK ${name}: ${JSON.stringify(out[name]).length} bytes`);
  } catch (e) {
    out[name] = { error: String(e) };
    console.error(`FAIL ${name}: ${e}`);
  }
}
process.stdout.write(JSON.stringify(out, null, 1));
