// Test de humo del sanitizador de referencias locales (clickup.ts).
// Se ejecuta con: node scripts/test-sanitize.mjs
const FILE_EXT_RE =
  /\.(md|pbix|csv|xlsx|xls|docx|pdf|png|jpe?g|gif|svg|json|txt|log|py|js|mjs|cjs|ts|tsx|sql|zip|parquet|html?|css|ya?ml|toml|ini|env)\b/gi;
const FILE_EXT_TEST = new RegExp(FILE_EXT_RE.source, "i");
const basenameNoExt = (p) => {
  const last = p.split(/[\\/]/).filter(Boolean).pop() ?? p;
  return last.replace(FILE_EXT_RE, "").trim();
};
const sanitizeLocalRefs = (text) =>
  text
    .replace(
      /\b[A-Za-z]:\\[^\s"')\]]+|\/(?:home|Users|mnt|var|tmp|opt|root)\/[^\s"')\]]+/g,
      (m) => basenameNoExt(m),
    )
    .replace(/\b[\w .-]{1,80}\.[A-Za-z]\w{0,8}\b/g, (m) =>
      FILE_EXT_TEST.test(m) ? basenameNoExt(m) : m,
    );

const cases = [
  ["Quedó el informe actualizado en CAMBIOS.md al día", "Quedó el informe actualizado en CAMBIOS al día"],
  ["Edité C:\\Users\\patag\\git_provisorio\\repo\\src\\app.tsx y anduvo", "Edité app y anduvo"],
  ["El reporte está en C:\\mcp_servers\\Ventas\\informe.pbix listo", "El reporte está en informe listo"],
  ["Ruta unix /home/cris/repo/cambios.md actualizada", "Ruta unix cambios actualizada"],
  ["Ver https://app.clickup.com/t/abc123 y app.clickup.com sin cambios", "Ver https://app.clickup.com/t/abc123 y app.clickup.com sin cambios"],
  ["Rama agent/hoy-imprevistos con 3 commits y el readme.md", "Rama agent/hoy-imprevistos con 3 commits y el readme"],
  ["Versión 1.2 y v2.0 quedaron intactas", "Versión 1.2 y v2.0 quedaron intactas"],
];

let ok = 0;
for (const [input, want] of cases) {
  const got = sanitizeLocalRefs(input);
  if (got === want) ok++;
  else console.log("FAIL:", JSON.stringify(input), "→", JSON.stringify(got), "(esperaba", JSON.stringify(want) + ")");
}
console.log(`${ok}/${cases.length} casos OK`);
process.exit(ok === cases.length ? 0 : 1);
