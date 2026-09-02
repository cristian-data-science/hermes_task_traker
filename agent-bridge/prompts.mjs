/**
 * Composición del prompt de despacho. Todo el contexto de la tarea viaja
 * empaquetado: datos, reglas del contrato (resumen ejecutivo de
 * CONTRATO_AGENTE.md), la receta por tipo y el protocolo de reporte por pasos.
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPORT_CLI = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "report.mjs",
);

const AUTONOMY_RULES = {
  escenario: `NIVEL: ESCENARIO — solo prepara las bases para que Cris pilotee después.
- Produce un plan claro (qué harás, qué necesitas, riesgos) y deja PRINCIPIOS de trabajo: stubs, esqueletos, rama inicial o backup.
- NO implementes funcionalidad completa. NO apliques cambios definitivos sobre datos o modelos.
- Termina con --state para-revision y en el resumen indica "qué queda listo" y "cómo continuar" (máx 3 líneas).`,
  supervisado: `NIVEL: SUPERVISADO — implementa y verifica, pero NADA se publica.
- Implementa la tarea y verifícala (build/tests/lectura de resultados).
- NO hagas push de nada. NO toques producción, ERP ni envíes correos.
- Termina con --state para-revision y resumen de máximo 3 líneas con la evidencia clave.`,
  autonomo: `NIVEL: AUTÓNOMO — ejecuta completo, con límites duros.
- Puedes commitear y pushear RAMAS (jamás master/main, jamás merge).
- Producción, ERP y correos SIEMPRE requieren OK de Cris (correos: solo borrador).
- Termina con --state para-revision con evidencia (rama, commits, números) en máx 3 líneas.`,
};

const TYPE_RECIPES = {
  reporte: `TIPO: REPORTE POWER BI — trabajas en una carpeta LOCAL sin git.
- PROHIBIDO cualquier comando git (init/add/commit/push): ni .md ni .pbix se versionan.
- Antes de un cambio riesgoso: copia el .pbix a backups\\ con fecha en el nombre (formato AAAA-MM-DD).
- Conéctate al modelo con el MCP powerbi-modeling-mcp si necesitas editar el semántico.
- REFRESHES LARGOS (patrón obligatorio): si el refresh tarda más que el timeout del transport (~60s), NUNCA hagas sleeps ciegos largos ni esperes colgado: lanza el refresh, y cada 2-3 min hacé UNA consulta DAX liviana (ej. COUNTROWS o MAX de fecha) para sondear. Si el DAX queda encola >90s, el motor sigue ocupado: esperá y volvé a sondear. Si a los ~15 min no ves progreso, reportá --state pregunta con lo que sabés.
- Al final: guardá el .pbix y actualizá CAMBIOS.md con la entrada completa (cambio, problema, pasos, validación con números antes/después, rollback) — como PASOS reportables, no al final del todo.
- Nada se borra: las versiones viejas van a backups\\.`,
  desarrollo: `TIPO: DESARROLLO — trabajas en un REPO GIT de git_provisorio.
- Trabaja en una rama propia agent/<slug-corto> (crea si no existe; jamás commitees a master).
- Commits chicos y descriptivos; verifica con build/tests antes de reportar.
- Según tu nivel de autonomía puedes push de la rama (nunca master/main, nunca merge).`,
  analisis: `TIPO: ANÁLISIS — no modifiques nada permanente sin permiso explícito.
- Investiga, mide, compara y entrega números/conclusiones en el resumen.
- Si necesitas tocar algo para medir, documenta qué tocaste y reviértelo.`,
  ops: `TIPO: OPS — operaciones sobre infraestructura.
- SOLO lecturas y diagnósticos por defecto; cualquier cambio necesita OK de Cris (estado pregunta).
- Entrega: qué viste, qué está mal, qué recomiendas.`,
  otro: `TIPO: OTRO — sigue las instrucciones de la tarea y las reglas generales del contrato.`,
};

/**
 * Reglas de oro por defecto (fallback): se usan solo si el contrato guardado
 * en Convex no está disponible. El contrato vigente (editable por Cris en la
 * app) llega en buildPrompt(input.contract).
 */
const DEFAULT_GOLDEN_RULES = [
  "Nada a producción ni al ERP sin OK explícito de Cris.",
  "El agente nunca envía correos: deja borradores.",
  "Toda acción deja rastro en la tarea (estado + evidencia).",
  "En reportes: backup antes de cambio riesgoso, CAMBIOS.md siempre al día, nada se borra (a backups/).",
  "En repos: jamás pushear master/main; el agente trabaja en rama agent/<slug>.",
];

/**
 * Arma el prompt completo de despacho (o seguimiento, si hay followUp).
 * `contract` = contrato operativo guardado en Convex (getContract):
 * { goldenRules: string[], typeRecipes: {reporte, desarrollo, analisis, ops, otro} }.
 */
export function buildPrompt(input) {
  const {
    task,
    workspacePath,
    runId,
    followUp,
    resumed,
    contract,
  } = input;

  const goldenRules =
    Array.isArray(contract?.goldenRules) && contract.goldenRules.length
      ? contract.goldenRules
      : DEFAULT_GOLDEN_RULES;
  const recipe =
    contract?.typeRecipes?.[task.taskType] ??
    TYPE_RECIPES[task.taskType] ??
    TYPE_RECIPES.otro;

  const lines = [];
  // La PRIMERA línea se convierte en el título de la sesión en ZCode
  // (desktop incluido): que sea la tarea, no un rótulo interno.
  lines.push(`${task.title} [${task.taskType ?? "otro"}/${task.autonomy ?? "supervisado"}]`);
  lines.push("=== HERMES TASK TRACKER — TAREA DELEGADA A ZCODE ===");
  lines.push(`Tarea: ${task.title} (id: ${task._id})`);
  lines.push(`Área: ${task.area} · Tipo: ${task.taskType ?? "otro"} · Autonomía: ${task.autonomy ?? "supervisado"}`);
  if (task.model) lines.push(`Modelo elegido por Cris: ${task.model}`);
  lines.push(`Carpeta de trabajo (TODO ocurre aquí): ${workspacePath}`);
  if (task.notes) lines.push(`\nContexto de Cris:\n${task.notes}`);
  if (task.estimate || task.dueDate) {
    lines.push(
      `Estimación: ${task.estimate ?? "-"} · Fecha límite: ${task.dueDate ?? "-"}`,
    );
  }

  lines.push("\n=== REGLAS DEL CONTRATO (vigentes — editadas por Cris en la app) ===");
  for (const rule of goldenRules) {
    lines.push(`- ${rule}`);
  }
  lines.push(`- Producción de la tarea en: ${workspacePath} (respeta la receta de abajo).`);

  lines.push(`\n${AUTONOMY_RULES[task.autonomy] ?? AUTONOMY_RULES.supervisado}`);
  lines.push(`\n${recipe}`);

  if (resumed && followUp) {
    lines.push("\n=== SEGUIMIENTO (retomas tu sesión anterior) ===");
    lines.push(
      "Cris respondió a tu pregunta o te dio feedback. Aplícalo y continúa la tarea:",
    );
    lines.push(`>>> ${followUp}`);
  } else if (followUp) {
    lines.push(`\nFeedback de Cris para esta corrida:\n>>> ${followUp}`);
  }

  lines.push("\n=== PROTOCOLO DE REPORTE (OBLIGATORIO — así ve Cris tu progreso en vivo) ===");
  lines.push(
    "Trabajá en PASOS numerados y después de CADA paso ejecutá (texto corto, ≤12 palabras):",
  );
  lines.push(
    `node "${REPORT_CLI}" --task ${task._id} --run ${runId} --step "<paso hecho>"`,
  );
  lines.push(
    'Ejemplos de pasos: "backup creado en backups/", "reporte abierto y conectado", "línea base medida: X", "cambio aplicado", "verificado: antes 12-01 → hoy", "pbix guardado", "CAMBIOS.md actualizado".',
  );
  lines.push(
    'AL TERMINAR — apenas el objetivo esté VERIFICADO, ejecutá INMEDIATAMENTE el reporte final (no lo dejes para después de tareas de embellecimiento):',
  );
  lines.push(
    `node "${REPORT_CLI}" --task ${task._id} --run ${runId} --state <para-revision|pregunta|hecho> --summary "<máx 3 líneas, evidencia; SIN enumerar pasos adentro>"`,
  );
  lines.push(
    'Si necesitas contexto o una decisión de Cris: --state pregunta --question "<pregunta concreta y breve>".',
  );
  lines.push(
    "El --summary NO repite los pasos (ya quedaron en la checklist): solo resultado y evidencia.",
  );

  return lines.join("\n");
}

/** Digest corto del prompt para auditoría (se guarda en la corrida). */
export function promptDigest(prompt) {
  return prompt.replace(/\s+/g, " ").slice(0, 300);
}
