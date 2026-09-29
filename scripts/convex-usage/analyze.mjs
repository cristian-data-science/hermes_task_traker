// Análisis de los datos de uso extraídos de la API de Convex.
import { readFileSync } from "node:fs";

const d = JSON.parse(readFileSync(new URL("./usage-raw.json", import.meta.url), "utf8"));
const fmtGB = (b) => (Number(b) / 1e9).toFixed(3) + " GB";
const fmtMB = (b) => (Number(b) / 1e6).toFixed(1) + " MB";
const fmtN = (n) => Number(n).toLocaleString("es");

console.log("########## SERIE DIARIA: llamadas a funciones (proyecto) ##########");
// [team, project, class, ds, cached, uncached, mutation, action, http]
const calls = d.functionCallsPerDay.map((r) => ({
  ds: r[3], cached: +r[4], uncached: +r[5], mutation: +r[6], action: +r[7], http: +r[8],
})).map((r) => ({ ...r, total: r.cached + r.uncached + r.mutation + r.action + r.http }));
for (const r of calls) {
  console.log(`${r.ds}  total=${String(r.total).padStart(6)}  (query sin cache=${r.uncached}, cacheada=${r.cached}, mutation=${r.mutation}, action=${r.action}, http=${r.http})`);
}
const sep = calls.filter((r) => r.ds >= "2026-09-01");
console.log(`\nTOTAL sep (hasta hoy): ${fmtN(sep.reduce((a, r) => a + r.total, 0))} llamadas`);
console.log(`Promedio diario sep: ${fmtN(Math.round(sep.reduce((a, r) => a + r.total, 0) / sep.length))}`);

console.log("\n########## SERIE DIARIA: database IO (ingress/egress) ##########");
// [team, project, class, ds, ingress, egress]
for (const r of d.databaseIOPerDay) {
  const pct = ((+r[4] + +r[5]) / 1e9 * 100 / (1 / 1)).toFixed(1);
  console.log(`${r[3]}  ingress=${fmtMB(r[4]).padStart(10)}  egress=${fmtMB(r[5]).padStart(10)}  dia=${((+r[4] + +r[5]) / 1e6).toFixed(1)} MB  (${((+r[4] + +r[5]) / 1e7).toFixed(1)}% del límite mensual de 1GB)`);
}
const sepIO = d.databaseIOPerDay.filter((r) => r.ds >= "2026-09-01");
console.log(`\nTOTAL IO sep: ${fmtGB(sepIO.reduce((a, r) => a + +r[4] + +r[5], 0))}`);
console.log(`IO egress sep: ${fmtGB(sepIO.reduce((a, r) => a + +r[5], 0))}, IO ingress sep: ${fmtGB(sepIO.reduce((a, r) => a + +r[4], 0))}`);

console.log("\n########## TOP FUNCIONES (ventana 2026-08-28 a 2026-09-28) ##########");
// [team, fn, project, callCount, dbIngress, dbEgress, textGB, vectorGB, qmCompute_s, actConvex_s, actNode_s, dataEgress, type, comp, aiCost]
const fns = d.metricsByFunction.map((r) => ({
  fn: r[1], calls: +r[3], dbIngress: +r[4], dbEgress: +r[5], qm_s: +r[8], actConvex_s: +r[9], actNode_s: +r[10], dataEgress: +r[11], type: r[12],
}));
const totCalls = fns.reduce((a, f) => a + f.calls, 0);
const totEgress = fns.reduce((a, f) => a + f.dbEgress, 0);
const totIngress = fns.reduce((a, f) => a + f.dbIngress, 0);
console.log(`Total llamadas ventana: ${fmtN(totCalls)} | DB egress ventana: ${fmtGB(totEgress)} | DB ingress ventana: ${fmtGB(totIngress)}\n`);
console.log("== Por DB egress (lecturas de BD) ==");
for (const f of [...fns].sort((a, b) => b.dbEgress - a.dbEgress).slice(0, 15)) {
  console.log(`${f.fn.padEnd(48)} egress=${fmtMB(f.dbEgress).padStart(10)} (${(f.dbEgress / totEgress * 100).toFixed(1)}%)  llamadas=${fmtN(f.calls)}  ${fmtMB(f.dbEgress / Math.max(f.calls, 1))}/llamada`);
}
console.log("\n== Por número de llamadas ==");
for (const f of [...fns].sort((a, b) => b.calls - a.calls).slice(0, 15)) {
  console.log(`${f.fn.padEnd(48)} llamadas=${fmtN(f.calls).padStart(9)} (${(f.calls / totCalls * 100).toFixed(1)}%)  egress=${fmtMB(f.dbEgress)}  ingress=${fmtMB(f.dbIngress)}`);
}
console.log("\n== Por DB ingress (escrituras) ==");
for (const f of [...fns].sort((a, b) => b.dbIngress - a.dbIngress).slice(0, 10)) {
  console.log(`${f.fn.padEnd(48)} ingress=${fmtMB(f.dbIngress).padStart(10)} (${f.dbIngress / totIngress * 100 || 0 .toFixed ? (f.dbIngress / totIngress * 100).toFixed(1) : 0}%)  llamadas=${fmtN(f.calls)}`);
}
console.log("\n== Compute (segundos) ==");
for (const f of [...fns].sort((a, b) => (b.actNode_s + b.actConvex_s + b.qm_s) - (a.actNode_s + a.actConvex_s + a.qm_s)).slice(0, 8)) {
  console.log(`${f.fn.padEnd(48)} qm=${f.qm_s.toFixed(1)}s actConvex=${f.actConvex_s.toFixed(1)}s actNode=${f.actNode_s.toFixed(1)}s`);
}

console.log("\n########## DOCUMENTOS POR TABLA (último día) ##########");
const lastDay = [...new Set(d.documentCountByTable.map((r) => r[3]))].sort().pop();
for (const r of d.documentCountByTable.filter((r) => r[3] === lastDay).sort((a, b) => +b[4] - +a[4]).slice(0, 15)) {
  console.log(`${r[2].padEnd(32)} ${fmtN(r[4]).padStart(9)} documentos`);
}

console.log("\n########## ALMACENAMIENTO POR TABLA (último día, bytes doc+índice) ##########");
for (const r of d.databaseStorageByTable.filter((r) => r[3] === lastDay).sort((a, b) => (+b[4] + +b[5]) - (+a[4] + +a[5])).slice(0, 15)) {
  console.log(`${r[2].padEnd(32)} ${fmtMB(+r[4] + +r[5]).padStart(10)}`);
}

console.log("\n########## DATA EGRESS POR DÍA (últimos 7) ##########");
for (const r of d.dataEgressPerDay.slice(-7)) {
  console.log(`${r[2]}  serving=${fmtMB(r[3])} userFn=${fmtMB(r[4])} total=${fmtMB(+r[3] + +r[4] + +r[5] + +r[6] + +r[7] + +r[8] + +r[9] + +r[10] + +r[11])}`);
}
