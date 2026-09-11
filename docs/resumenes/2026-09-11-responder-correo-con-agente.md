# Resumen post-implementación: Responder correos con el agente

PRD: `docs/prds/cristian/correos/2026-09-11-responder-correo-con-agente.md`
Fecha: 2026-09-11 · Módulo: correos + capa agente · Deploy: master directo.

## 1. Qué se implementó

- **Picker nativo de Windows desde la web**: botones "Elegir carpeta…"/
  "Elegir archivos…" que abren el diálogo nativo (`hermesagent://pick` →
  `agent-bridge/picker.mjs` con `FolderBrowserDialog`/`OpenFileDialog`),
  round-trip por Convex (`pickResults`, suscripción reactiva en la web — sin
  polling manual) con cancelación reportada y limpieza de filas > 1 h.
- **Botón "Responder con el agente"** en tareas de origen correo: indicación
  + contexto (picker) → mutation `correos:responderCorreo` que delega con
  `executor=zcode`, `taskType="correo"` y el contexto guardado.
- **Prompt de correo** (`buildCorreoPrompt` en el puente): cuerpo COMPLETO
  del correo (de `correos`, truncado a 30 000) + remitente/adjuntos por
  nombre + indicación de Cris + carpetas/archivos de consulta (solo lectura)
  + reglas (no ejecutar, preguntar si falta) + entregable en texto plano
  listo para pegar, SIN firma.
- **"Copiar respuesta"** en el panel de corridas de tareas de correo: copia
  la propuesta (el `summary` del run) al portapapeles.
- **Respuesta a pregunta con contexto acumulable**: `answerQuestion` acepta
  carpetas/archivos que se SUMAN a los existentes (sin duplicar) y se listan
  en el followUp; el panel muestra el picker al responder una pregunta.
- **Origen correo en la tarea**: `tasks.correoId` estampado por la ingesta +
  `backfillCorreoId` para tareas previas (vía `correos.tareaId`).
- **taskType "correo"**: sin carpeta registrada obligatoria — el agente
  corre con `--cwd` = primera carpeta de contexto o
  `agent-bridge/workspace-correo` (autocreada). El registro de carpetas
  (`agentWorkspaces`) NO acepta "correo" (union separado
  `workspaceTypesUnion`): el contexto de correo va por el picker, no por el
  registro.

## 2. Cómo se implementó (archivos y decisiones)

- `convex/schema.ts`: tabla `pickResults` (índice `by_key`), `tasks.correoId`,
  `tasks.contextPaths`, `correos.by_tarea`, literal `correo` en taskType.
- `convex/correos.ts`: `correoDeTarea` (query, cuerpo completo para el
  puente), `backfillCorreoId`, `pickReportar`/`pickResultado` (round-trip;
  sanea rutas absolutas, key `[a-z0-9-]{8,64}`), `responderCorreo`
  (delegación encapsulada: valida origen correo, no ya delegada, no
  completada).
- `convex/agent.ts`: `answerQuestion` con contexto acumulable (merge sin
  duplicar + lista en followUp); `workspaceTypesUnion` separado.
- `agent-bridge/`: `picker.mjs` (PowerShell -STA + credenciales del puente
  vía `auth.mjs`), `prompts.mjs` (`buildCorreoPrompt`), `dispatcher.mjs`
  (cwd de contexto + fetch del correo completo), `protocol-handler.vbs`
  (modo `pick`).
- `src/`: `hooks/useNativePicker.ts` (suscripción reactiva al resultado),
  `components/ContextPicker.tsx` (chips quitables, reutilizable),
  `TaskModal.tsx` (bloque Responder con el agente), `AgentRunsPanel.tsx`
  (Copiar respuesta + picker en respuesta a pregunta), `lib/constants.ts`
  (tipo Correo).

## 3. Por qué esta forma + alternativas descartadas

- **Round-trip por Convex** en vez de portapapeles: la web puede leer el
  portapapeles solo con permiso frágil por gesto; Convex ya tenía el
  andamiaje (mismo trust que zchat-server: `auth.mjs` + suscripción
  reactiva). Descartado también "input webkitdirectory" (no expone rutas
  reales del disco, solo contenidos con rutas falsas).
- **Rutas, no archivos subidos**: el agente LEE del disco local — cero
  límites de tamaño, cero copias en la nube; calza con "descargo el adjunto
  y le paso la carpeta".
- **followUp como canal de la indicación**: reusa el mecanismo existente de
  seguimiento (claim → prompt) en vez de un campo paralelo.
- **Borrador en `summary`**: el ciclo para-revisión existente ES la
  aprobación del borrador; receta con tope de 3 líneas solo relajado para
  correo.

## 4. Qué probar para confiar

1. Abrir una tarea de correo → "Responder con el agente" → "Elegir
   carpeta…" → diálogo de Windows → aceptar → chip con la ruta.
2. Escribir indicación → "Delegar respuesta" → la tarea aparece en la vista
   Agente; el log del puente muestra el prompt con el correo completo.
3. Al terminar: panel → "Propuesta de respuesta" → "Copiar respuesta" →
   pegar en Outlook.
4. Rechazar con feedback → re-redacta; y si pregunta → responder con
   "Elegir archivos…" → el contexto se suma (ver chips persistidos al
   reabrir).
5. Cancelar el diálogo del picker → la web vuelve sola, sin "eligiendo…"
   colgado.

## 5. Efectos secundarios y deudas

- El picker requiere el puente corriendo (credenciales) — misma condición
  que "Abrir carpeta" y el chat; si no está, la web queda "eligiendo…" (la
  fila nunca llega). Deuda: aviso explícito de puente caído en el picker.
- PowerShell tarda 1-2 s en abrir el diálogo la primera vez (JIT de .NET).
- El smoke automatizado del round-trip se hizo contra prod tras el deploy
  (el puente apunta a prod); el diálogo en sí se valida con uso real.
- Fase 2 pendiente (PRD): descarga automática de adjuntos, firma/asunto
  sugerido.
