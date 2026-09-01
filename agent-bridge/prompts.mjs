/**
 * Composición del prompt de despacho. Todo el contexto de la tarea viaja
 * empaquetado: datos, reglas del contrato (resumen ejecutivo de
 * CONTRATO_AGENTE.md), la receta por tipo y la instrucción de reporte.
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
- Termina con --state para-revision y en el resumen indica exactamente "qué queda listo" y "cómo continuar".`,
  supervisado: `NIVEL: SUPERVISADO — implementa y verifica, pero NADA se publica.
- Implementa la tarea y verifícala (build/tests/lectura de resultados).
- NO hagas push de nada. NO toques producción, ERP ni envíes correos.
- Termina con --state para-revision y resume lo hecho + evidencia (números, archivos, tests).`,
  autonomo: `NIVEL: AUTÓNOMO — ejecuta completo, con límites duros.
- Puedes commitear y pushear RAMAS (jamás master/main, jamás merge).
- Producción, ERP y correos SIEMPRE requieren OK de Cris (correos: solo borrador).
- Termina con --state para-revision con evidencia (rama, commits, números).`,
};

const TYPE_RECIPES = {
  reporte: `TIPO: REPORTE POWER BI — trabajas en una carpeta LOCAL sin git.
- PROHIBIDO cualquier comando git (init/add/commit/push): ni .md ni .pbix se versionan.
- Antes de un cambio riesgoso: copia el .pbix a backups\\ con fecha en el nombre (formato AAAA-MM-DD).
- Conéctate al modelo con el MCP powerbi-modeling-mcp si necesitas editar el semántico.
- Al terminar: actualiza CAMBIOS.md del reporte con la entrada completa (cambio, problema, pasos, validación con números antes/después, rollback).
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
 * Arma el prompt completo de despacho (o seguimiento, si hay followUp).
 */
export function buildPrompt(input) {
  const {
    task,
    workspacePath,
    runId,
    followUp,
    resumed,
  } = input;

  const lines = [];
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

  lines.push("\n=== REGLAS DEL CONTRATO (CONTRATO_AGENTE.md — resumen) ===");
  lines.push(
    "- Toda acción deja rastro: reporta SIEMPRE al terminar (estado + resumen con evidencia).",
  );
  lines.push("- Nunca silencio: si te bloqueas o falta contexto → estado pregunta con la pregunta concreta.");
  lines.push("- Nada a producción ni al ERP sin OK explícito. Correos: solo borradores, nunca se envían.");
  lines.push(`- Producción de la tarea en: ${workspacePath} (respeta la receta de abajo).`);

  lines.push(`\n${AUTONOMY_RULES[task.autonomy] ?? AUTONOMY_RULES.supervisado}`);
  lines.push(`\n${TYPE_RECIPES[task.taskType] ?? TYPE_RECIPES.otro}`);

  if (resumed && followUp) {
    lines.push("\n=== SEGUIMIENTO (retomas tu sesión anterior) ===");
    lines.push(
      "Cris respondió a tu pregunta o te dio feedback. Aplícalo y continúa la tarea:",
    );
    lines.push(`>>> ${followUp}`);
  } else if (followUp) {
    lines.push(`\nFeedback de Cris para esta corrida:\n>>> ${followUp}`);
  }

  lines.push("\n=== AL TERMINAR (OBLIGATORIO — tu ÚLTIMA acción) ===");
  lines.push(
    'Ejecuta este comando exacto (reemplaza <estado> y el resumen; usa comillas):',
  );
  lines.push(
    `node "${REPORT_CLI}" --task ${task._id} --run ${runId} --state <para-revision|pregunta|hecho> --summary "<qué hiciste, evidencia, números, archivos/rama>"`,
  );
  lines.push(
    'Si necesitas contexto o una decisión de Cris: --state pregunta --question "<pregunta concreta y breve>".',
  );
  lines.push(
    "Puedes reportar progreso intermedio con --progress <0-100> y volver a reportar al final.",
  );

  return lines.join("\n");
}

/** Digest corto del prompt para auditoría (se guarda en la corrida). */
export function promptDigest(prompt) {
  return prompt.replace(/\s+/g, " ").slice(0, 300);
}
