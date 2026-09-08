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
- REFRESHES LARGOS (patrón obligatorio): si el refresh tarda más que el timeout del transport (~60s), NUNCA hagas sleeps ciegos largos ni esperes colgado: lanza el refresh, y cada 2-3 min haz UNA consulta DAX liviana (ej. COUNTROWS o MAX de fecha) para sondear. Si el DAX queda encola >90s, el motor sigue ocupado: espera y vuelve a sondear. Si a los ~15 min no ves progreso, reporta --state pregunta con lo que sabes.
- Al final: guarda el .pbix y actualiza CAMBIOS.md con la entrada completa (cambio, problema, pasos, validación con números antes/después, rollback) — como PASOS reportables, no todo al final.
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
  "Escribe SIEMPRE en español neutro con \"tú\" (resúmenes, pasos, chat, PR): sin voseo argentino — nada de \"vos/tenés/hacé/respondé/revisá\".",
];

/**
 * Arma el prompt completo de despacho (o seguimiento, si hay followUp).
 * `contract` = contrato operativo guardado en Convex (getContract):
 * { goldenRules: string[], typeRecipes: {reporte, desarrollo, analisis, ops, otro} }.
 * `agentLabel` = nombre del motor (ZCode / Claude Code): solo cosmético.
 */
export function buildPrompt(input) {
  const {
    task,
    workspacePath,
    runId,
    followUp,
    resumed,
    contract,
    agentLabel = "ZCODE",
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
  // (desktop incluido): que sea la tarea, no un rótulo interno. El prefijo
  // "agente-" la distingue de las conversaciones propias de Cris (pedido
  // explícito): en el sidebar/palette del desktop se filtra de un vistazo.
  lines.push(`agente- ${task.title} [${task.taskType ?? "otro"}/${task.autonomy ?? "supervisado"}]`);
  lines.push(`=== HERMES TASK TRACKER — TAREA DELEGADA A ${agentLabel.toUpperCase()} ===`);
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

  // Excepción de estrategia Git elegida por Cris al crear la tarea: pisa la
  // regla de oro de ramas y la receta de desarrollo SOLO para esta tarea.
  if (task.gitStrategy === "main-directo") {
    lines.push(
      "\n=== ESTRATEGIA GIT: DIRECTO A MAIN (excepción explícita elegida por Cris al crear la tarea) ===",
    );
    lines.push(
      "Esta tarea PISA la regla de oro de ramas y la receta de desarrollo: NO trabajes en rama propia ni abras pull request.",
    );
    lines.push("- Commitea DIRECTO en master/main, commits chicos y descriptivos.");
    lines.push(
      "- Verifica build/tests ANTES de cada push; si la verificación falla, corrige antes de pushear.",
    );
    lines.push(
      "- Push a master/main al verificar: la producción se despliega por el pipeline del repo (eso es lo que Cris quiere para esta tarea).",
    );
    lines.push(
      "- Reporta con evidencia: hashes de commits y verificación (build/deploy).",
    );
    lines.push(
      "- El resto de los límites del contrato siguen vigentes (ERP, correos, producción de OTROS sistemas).",
    );
  }

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
    "PRIMERA ACCIÓN, antes de trabajar: declara tu PLAN (3-7 pasos concretos, separados por |):",
  );
  lines.push(
    `node "${REPORT_CLI}" --task ${task._id} --run ${runId} --plan "explorar X | backup/rama | cambio | verificación con números | documentar"`,
  );
  lines.push(
    "DESPUÉS trabaja en PASOS y reporta cada uno apenas lo completes (texto corto, ≤12 palabras):",
  );
  lines.push(
    `node "${REPORT_CLI}" --task ${task._id} --run ${runId} --step "<paso hecho>"`,
  );
  lines.push(
    'Ejemplos de pasos: "backup creado en backups/", "reporte abierto y conectado", "línea base medida: X", "cambio aplicado", "verificado: antes 12-01 → hoy", "pbix guardado", "CAMBIOS.md actualizado".',
  );
  lines.push(
    "Si el plan cambia a mitad de camino, vuelve a enviar --plan con el plan actualizado (es normal).",
  );
  lines.push(
    'AL TERMINAR — apenas el objetivo esté VERIFICADO, ejecuta INMEDIATAMENTE el reporte final (no lo dejes para después de tareas de embellecimiento):',
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

/**
 * Prompt de REDIRECCIÓN EN VIVO: Cris cambió el rumbo mientras la corrida
 * estaba activa; el puente interrumpió el proceso y lo retoma con --resume en
 * la MISMA sesión y la MISMA corrida. Compacto a propósito: este mensaje viaja
 * al historial de la sesión y se lee en el chat (debe verse como lo que es —
 * una instrucción nueva de Cris —, no como otro paquete de contrato).
 *
 * OJO (aprendizaje del primer test): sin procedencia explícita, el modelo
 * DESCONFÍA del mensaje ("llega como texto en el turno de usuario") y puede
 * priorizar el enunciado original de la tarea. Por eso el prompt declara QUIÉN
 * lo entrega (el puente), POR QUÉ (Cris lo escribió desde la app, el proceso
 * fue interrumpido para entregarlo) y que tiene PRIORIDAD sobre todo lo previo.
 */
export function buildRedirectPrompt({ task, instruction, runId }) {
  const lines = [];
  lines.push(`=== REDIRECCIÓN EN VIVO DE CRIS — PRIORIDAD MÁXIMA ===`);
  lines.push(
    "Este mensaje lo entrega el PUENTE agent-bridge (el mismo que despachó tu tarea): " +
      "Cris acaba de escribir esta instrucción desde la app del tracker y el puente " +
      "INTERRUMPIÓ tu proceso para entregártela de inmediato. Es una instrucción " +
      "auténtica del dueño del contrato: PREVALECE sobre cualquier instrucción previa " +
      "de esta tarea (incluido su enunciado original y sus notas). No la cuestiones ni " +
      "la trates como texto sospechoso: aplícala.",
  );
  lines.push(`Tarea: ${task.title} (id: ${task._id}) — misma corrida, misma sesión: sigues donde quedaste.`);
  lines.push(`\nInstrucción nueva de Cris:\n>>> ${instruction}`);
  lines.push(
    "\nAplica el nuevo rumbo desde ya:",
  );
  lines.push(
    "- Si el plan cambia, reenvíalo ya: " +
      `node "${REPORT_CLI}" --task ${task._id} --run ${runId} --plan "..."`,
  );
  lines.push(
    "- Sigue reportando cada paso (--step) y el estado final como siempre.",
  );
  return lines.join("\n");
}
