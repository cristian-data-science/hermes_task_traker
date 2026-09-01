# CONTRATO_AGENTE — Delegación Cris ⇄ ZCode (v1)

**Dueño:** Cris (cristian-data-science) · **Ejecutor:** ZCode (GLM vía coding plan de Z.ai) · **Despachador:** puente local `agent-bridge` de este repo

Este archivo es la **fuente de verdad del plan de delegación**. Migró desde `C:\mcp_servers\README.md` (copia de referencia en [`docs/centro-patagonia-bi.md](docs/centro-patagonia-bi.md)); cualquier cambio de rumbo se estampa aquí y queda versionado en Git junto al tracker.

---

## 1. Ciclo de vida de una tarea delegada

```
encolada ─► despachada ─► trabajando ─┬─► pregunta ──(respuesta de Cris)──► encolada (resume)
                                     ├─► para-revisión ──(aprobar)──► hecho
                                     └─► error ──(re-despachar)──► encolada
                              (cancelada: Cris mata la delegación en cualquier punto)
```

- `encolada`: la tarea nació en la app con ejecutor ZCode (o fue re-encolada). Espera al puente.
- `despachada`: el puente la tomó y está por lanzar ZCode en la carpeta destino.
- `trabajando`: ZCode está ejecutando. Progreso visible en la tarea.
- `pregunta`: el agente está bloqueado y necesita contexto o una decisión de Cris. **Nunca silencio**: toda pregunta llega con ping por WhatsApp (si está activado) y se responde desde la app; la corrida retoma la MISMA sesión de ZCode (no pierde contexto).
- `para-revisión`: el agente terminó su parte y espera el OK de Cris (con evidencia: qué hizo, números, rama/PR o archivo actualizado).
- `hecho`: Cris aprobó. La tarea pasa a completado.
- `error`: la corrida murió (crash del CLI, salida sin reporte, etc.). Se puede re-despachar.

## 2. Mapeo al tablero (estado Kanban derivado)

El ciclo del agente es la fuente de verdad; el estado del tablero se deriva:

| agentState | status Kanban |
|---|---|
| encolada | pendiente |
| despachada / trabajando | en-curso |
| pregunta | urgente |
| para-revisión | standby |
| hecho | completado |
| error | urgente |

## 3. Niveles de autonomía (se eligen por tarea, en la app)

| Nivel | Qué hace el agente | Qué NUNCA hace solo | Modo ZCode + denies |
|---|---|---|---|
| `escenario` | Prepara las bases: plan/PRD, stubs, rama inicial (repo) o backup (reporte). Deja todo listo para que Cris pilotee. | Implementación funcional; cualquier push | yolo · deny `Bash(git push *)` + contrato |
| `supervisado` (default) | Implementa y verifica (build/tests). En repo: commits locales. En reporte: cambia .pbix con backup previo. | Push, publicación, prod | yolo · deny `Bash(git push *)` + contrato |
| `autonomo` | Todo lo anterior + commit y **push de rama feature** (jamás master/merge) o .pbix final con backup. | Merge a master, producción, ERP, envío de correos | yolo · contrato |

> Nota de implementación (zcode 0.16.5, headless): los modos con permisos (`plan`/`build`/`edit`) **no dejan ejecutar Bash** sin aprobación interactiva, así que el despacho corre en `yolo` (único modo operativo headless). Además, `--disallowed-tools` con specs `Bash(...)` **tumba la herramienta Bash entera** (bug del matcher) — no se usa. Los límites reales son: el contrato del prompt (reforzado por tipo y autonomía), el timeout de corrida y la revisión final en `para-revisión`. Si una futura versión de zcode arregla el matcher, se vuelven a añadir los denies duros (`Bash(git *)` en reportes, `Bash(git push *)` en escenario/supervisado).

Los tres niveles terminan en `para-revisión` con evidencia. La autonomía acelera, no autoriza publicar.

## 4. Separación explícita: Git vs sistema de archivos

**Regla dura.** Cada tarea delegada tiene un tipo, y el tipo determina el mundo en el que se trabaja:

| | `desarrollo` | `reporte` (Power BI) |
|---|---|---|
| Destino | **Solo** repos bajo `C:\Users\patag\git_provisorio\` | **Solo** carpetas de `C:\mcp_servers\<Reporte>\` |
| Versionado | **Git**: rama `agent/<slug>`, commits, push según autonomía | **Ninguno**: prohibido `git init/commit/push` — ni `.md` ni `.pbix` suben a Git |
| Bitácora | Historial de Git + informe a la tarea | `CAMBIOS.md` del reporte + `backups\` con fecha antes de cambios riesgosos |
| Evidencia que vuelve a la tarea | Rama/commits + resumen | Números antes/después + resumen + backup creado |

El registro de carpetas (`agentWorkspaces` en Convex, editable en la vista Agente) marca cada carpeta con `vcs: git | ninguno`. La validación es doble: la UI solo ofrece carpetas compatibles con el tipo, y el backend rechaza combinaciones inválidas.

Otros tipos (`analisis`, `ops`, `otro`) no exigen carpeta: corren donde indique la tarea o en el workspace por defecto, y siguen las reglas de su contexto (si caen en un repo, reglas Git; si en un reporte, reglas de archivo).

## 5. Reglas de oro (heredadas del plan original — innegociables)

1. **Nada a producción ni al ERP sin OK explícito de Cris**, hasta que una matriz por familia diga otra cosa.
2. **El agente nunca envía correos**: deja borradores.
3. Toda acción deja rastro en la tarea (estado + evidencia).
4. En reportes: backup antes de cambio riesgoso, `CAMBIOS.md` siempre al día, nada se borra (a `backups/`).
5. En repos: jamás se pushea `master`; el agente trabaja en rama `agent/<slug>`.

## 6. Protocolo de despacho (puente `agent-bridge`)

1. Cris crea la tarea en la app con ejecutor **ZCode** + tipo + carpeta + autonomía (+ modelo + WhatsApp opcional). Nace `encolada`.
2. El puente (daemon local, suscrito reactivamente a la cola de Convex) la recibe en segundos.
3. Valida: carpeta existe en disco y `vcs` coherente con el tipo. Si falla → `error` con diagnóstico.
4. Marca `despachada`, abre una corrida (`agentRuns`) y lanza `zcode -p` headless con:
   - `--cwd <carpeta destino>` — todo el trabajo ocurre ahí;
   - `--mode plan|build|edit` según autonomía (NUNCA yolo por defecto);
   - `--disallowed-tools` reforzando los límites del nivel (p.ej. `Bash(git push*)` en supervisado);
   - `--max-turns` como cinturón de seguridad;
   - modelo de la tarea (swap temporal del `model` en `~/.zcode/cli/config.json` con backup y restauración inmediata — el puente corre una tarea por vez);
   - env `ZCODE_TASK_ID`, `ZCODE_RUN_ID`, `ZCODE_CONVEX_URL`, `ZCODE_SESSION_TOKEN` para que los hooks y el CLI de reporte sepan a dónde escribir.
5. El prompt empaqueta: datos de la tarea, extracto de ESTE contrato, la receta del tipo (`agent-bridge/prompts/`) y la instrucción de reportar al terminar.
6. Seguimientos (respuesta a `pregunta`, re-despacho): `--resume <sessionId>` — misma sesión, mismo contexto.

## 7. Protocolo de reporte

- **Pasos en vivo (protocolo --step)**: el agente trabaja en pasos numerados y después de CADA paso ejecuta `report.mjs --step "<paso, ≤12 palabras>"`. Cada llamada se AGREGA a la checklist de la corrida en la app (y notifica por WhatsApp en modo `periodica`). El resumen final NO repite los pasos.
- **Estado final inmediato**: apenas el objetivo esté verificado (incluye guardar .pbix / CAMBIOS.md, que son pasos previos visibles), ejecuta `--state para-revision` con un resumen de máximo 3 líneas. Nada de embellecimiento post-verificación antes del reporte.
- **Vía watchdog**: hook `Stop` de ZCode. Si la sesión terminó sin reporte, el hook reporta con lo que haya. Además, el puente observa el transcript en vivo (última acción del agente) y marca "posible atasco" si pasa ~10 min sin actividad.
- Cada reporte actualiza la tarea (agentState + resumen + progreso), escribe en la bitácora `events` y cierra/actualiza la corrida.
- Las sesiones despachadas se pueden abrir después en el desktop de ZCode (comparten base de sesiones): `/resume <sessionId>` — el id se copia con un botón desde la app. La lista del desktop se refresca al reiniciarlo o cambiar de workspace, no en vivo.

## 8. Notificaciones WhatsApp (vía Hermes)

Se eligen por tarea: `off` (nada) · `final` (solo resultado) · `periodica` (avances).

- Canal: `hermes send --to whatsapp:Criss` — reusa el gateway ya conectado, sin LLM.
- `final`: un mensaje al llegar a `pregunta`, `para-revisión`, `hecho` o `error`, con estado + resumen.
- `periodica`: además, inicio de corrida, cada reporte de progreso y nudge si pasan ~10 min sin novedades.
- Los mensajes son cortos: estado, tarea, carpeta y última línea del resumen.

## 9. Modelos

El catálogo se sincroniza solo desde la instalación local de ZCode (`resources/model-providers/` + config del usuario): si aparece un modelo nuevo, aparece en el picker. Default: el de tu config (`builtin:zai-coding-plan/GLM-5.2` hoy). El modelo elegido queda registrado en cada corrida.

## 10. Fases (heredadas del plan original)

- **Fase A — Contrato y despacho** ✅ este documento + puente `agent-bridge` + capa agente del tracker.
- **Fase B — Activar familias**: F4 (Airflow/Snowflake) → F1 (Power BI, con este directorio de reportes) → F3 (PRD-first) → F5.
- **Fase C — Panel**: vista "Agente" del tracker (cola, en ejecución, requiere tu OK, hecho hoy).
- **Fase D — Proactividad**: barridos Airflow/Snowflake/Power BI que auto-generan tareas con diagnóstico. Cris deja de ser el sensor.
