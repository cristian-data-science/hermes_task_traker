# Revisión del contrato de agentes — análisis y propuestas

**Fecha:** 2026-09-08 · **Tipo:** análisis (nada se modificó fuera de este documento) · **Autor:** agente (Claude Code, supervisado)

**Veredicto en una línea:** el contrato es sólido como *documento*, pero su aplicación es 100 % textual — no hay un solo límite duro en el proceso — y tiene tres huecos reproducibles que lo dejan sin efecto sin que nadie se entere.

---

## 1. Qué es hoy el "contrato" (superficie real)

No es un archivo: son **cinco bloques** que se concatenan en el prompt de despacho (`agent-bridge/prompts.mjs:70`), más un documento formal que ya no manda.

| Bloque | Dónde vive | ¿Editable en la app? | ¿Viaja al agente? |
|---|---|---|---|
| Reglas de oro (6) | Convex `settings["agent.contract"]`, default en `convex/agent.ts:526` | **Sí** (textarea) | Sí |
| Recetas por tipo (5) | Convex, default en `convex/agent.ts:534` | **Sí** (textarea) | Sí (solo la del tipo) |
| Reglas de autonomía (3) | `agent-bridge/prompts.mjs:14` (`AUTONOMY_RULES`) | **No** — hardcodeado | Sí |
| Excepción "directo a main" | `agent-bridge/prompts.mjs:120` | **No** — hardcodeado | Solo si `gitStrategy = main-directo` |
| Protocolo de reporte | `agent-bridge/prompts.mjs:152` | **No** — hardcodeado | Sí |
| `CONTRATO_AGENTE.md` | Repo, Git | **No** (solo lectura en la app) | **No viaja nunca** |

Tamaño real del prompt de despacho (medido con `buildPrompt`, autonomía supervisado):
`reporte` 3.553 car. · `desarrollo` 2.872 · `analisis` 2.764 · `ops` 2.737 · `otro` 2.625.

**Lectura:** de los 5 bloques que sí llegan al agente, **2 son editables y 3 no**. Cris puede reescribir las reglas de oro desde la app pero no puede tocar lo que dice "NIVEL: AUTÓNOMO — puedes pushear ramas", que es la línea que más autoriza. La asimetría está al revés de lo que pide el riesgo.

---

## 2. Hallazgos, ordenados por lo que cuesta cuando fallan

### H1 — La autonomía no restringe nada: los tres niveles corren con permisos totales
**Verificado en código.** `agent-bridge/config.mjs:152`:
```js
export const AUTONOMY_MODE = { escenario: "yolo", supervisado: "yolo", autonomo: "yolo" };
```
Y el adaptador de Claude (`agent-bridge/agents/claude.mjs:118`) pasa `--permission-mode bypassPermissions` **sin mirar la autonomía** (ni siquiera recibe el parámetro en `buildSpawn`).

Consecuencia: un agente en `escenario` tiene exactamente las mismas capacidades que uno `autonomo`. Lo único que lo detiene es que el prompt se lo pida. El `CONTRATO_AGENTE.md` §3 documenta honestamente por qué (bug del matcher de `--disallowed-tools` en zcode 0.16.5), pero §6.4 del **mismo documento** todavía afirma lo contrario: *"`--mode plan|build|edit` según autonomía (NUNCA yolo por defecto)"*. Un lector del contrato formal cree que hay un cinturón que no existe.

Esto no es necesariamente un error de diseño — es una decisión forzada por la herramienta —, pero **cambia qué tipo de objeto es el contrato**: es una instrucción, no una barrera. Todo lo demás en este análisis se sigue de ahí.

### H2 — Guardar una receta vacía borra silenciosamente todas las reglas del tipo
**Reproducido.** Si Cris vacía el textarea de una receta y guarda:
- `saveContract` (`convex/agent.ts:667`) acepta `""` sin validar;
- `getContract` (`:636`) hace `{...DEFAULT, ...current}` → `""` **pisa** el default;
- `prompts.mjs:86` usa `??`, que no atrapa string vacío → la receta queda `""`.

Resultado medido: el bloque `TIPO:` desaparece del prompt (quedan tres saltos de línea). Una tarea de `reporte` sale a despacho **sin** "PROHIBIDO cualquier comando git", **sin** "backup antes de cambio riesgoso" y **sin** "nada se borra". La app no avisa: el toast dice "Contrato guardado".

Mismo patrón, versión suave: las reglas de oro se truncan a 300 caracteres cada una y a 20 reglas (`:663`) sin aviso — una regla larga se corta a mitad de frase y viaja así.

### H3 — `gitStrategy` queda pegada al cambiar el tipo de tarea y contradice la receta
**Reproducido.** `buildPrompt` aplica el bloque "DIRECTO A MAIN" **solo mirando `task.gitStrategy`**, sin mirar `taskType` (`prompts.mjs:120`). Y el campo no se limpia al cambiar de tipo: `TaskModal.tsx:300` manda `gitStrategy: undefined` cuando el tipo deja de ser desarrollo/ops, pero **Convex descarta los `undefined` al serializar** — el propio `convex/tasks.ts:453` documenta esa trampa para otros campos y aplica la normalización `"" → undefined` a `dueDate`, `estimate`, `notes`… pero no a `gitStrategy`.

Camino real: crear tarea `desarrollo` + `main-directo` → editarla a `analisis` (o `reporte`). El prompt resultante contiene, uno debajo del otro:
> `TIPO: ANÁLISIS — no modifiques nada permanente sin permiso explícito.`
> `Commitea DIRECTO en master/main` … `Push a master/main al verificar: la producción se despliega por el pipeline del repo.`

Verificado ejecutando `buildPrompt` con `taskType:"reporte"` + `gitStrategy:"main-directo"` → el bloque git aparece igual (`true`). Es la excepción más peligrosa del contrato activándose en el tipo de tarea donde menos corresponde, y con la receta contradiciéndola dentro del mismo texto. Un agente que resuelve el conflicto "a favor de la instrucción más específica y más reciente" hace push a producción en una tarea de análisis.

### H4 — El contrato manda que todo deje rastro; el contrato no deja rastro
Regla de oro 3: *"Toda acción deja rastro en la tarea (estado + evidencia)"*. Sin embargo:
- `saveContract` (`convex/agent.ts:658`) **no llama a `logEvent`**: sobrescribe la clave `agent.contract` y la versión anterior se pierde. No hay historial ni diff.
- `agentRuns` (`convex/schema.ts:606`) guarda `autonomy`, `workspacePath`, `model` — pero **no** guarda el contrato vigente ni un hash de él, ni `gitStrategy`. Lo único que queda es `promptDigest`: los primeros 300 caracteres (`prompts.mjs:188`), que son el encabezado, no las reglas.

Consecuencia: ante "¿por qué el agente hizo X?" no se puede reconstruir bajo qué reglas corrió. Y si una edición del contrato rompió algo, no se puede volver atrás salvo a los defaults.

### H5 — La edición del contrato no tiene piso
`saveContract` exige **una** regla de oro. Nada distingue "Nada a producción ni al ERP sin OK" de una regla de estilo: las seis son texto libre borrable. Sumado a H1 (no hay límite duro), el modelo de seguridad completo depende de que un textarea siga teniendo el contenido correcto.

### H6 — `analisis`, `ops` y `otro` no heredan reglas de su mundo
`CONTRATO_AGENTE.md` §4 dice que estos tipos *"siguen las reglas de su contexto (si caen en un repo, reglas Git; si en un reporte, reglas de archivo)"*. Eso **no está implementado**: `buildPrompt` inyecta una sola receta, la del tipo, y `validateDelegation` (`convex/agent.ts:262`) solo valida `desarrollo` y `reporte`.

Evidencia de primera mano: esta misma tarea (`analisis` sobre este repo Git) recibió un prompt **sin ninguna regla de rama, commit o verificación** más allá de la regla de oro 5. Una tarea `otro` apuntada a una carpeta de Power BI llega sin la regla de backup.

### H7 — Deriva entre `CONTRATO_AGENTE.md` y el contrato vivo
El documento formal, que es el que la app muestra como "el contrato", está desactualizado en al menos cuatro puntos:
1. §5 lista **5** reglas de oro; el contrato vivo tiene **6** (falta la de español neutro).
2. §6.4 dice modos `plan|build|edit` "NUNCA yolo" — contradicho por §3 y por el código (H1).
3. No menciona `gitStrategy` / "directo a main", que hoy es una excepción operativa que pisa la regla de oro 5.
4. Habla solo de ZCode; el ejecutor `claude` (Claude Code) ya está en producción (`agent-bridge/agents/claude.mjs`, `executor: v.literal("claude")`).

### H8 — Voseo en mensajes del propio sistema de agentes
La regla de oro 6 prohíbe el voseo, y el sistema lo usa en sus propios textos:
- `convex/agent.ts:666` → `"Necesitás al menos una regla de oro"` (error del editor **del contrato**).
- `agent-bridge/dispatcher.mjs` (watchdog de corrida huérfana) → `"Respondé acá para que reintente."` — este texto queda guardado como error de la tarea.
- `src/lib/constants.ts:126` → `"Seguís pilotando vos."`, `src/components/AgentRunsPanel.tsx:261` → `"Podés cancelar"`.

Menor en impacto, pero es la regla más fácil de cumplir y el sistema la incumple en la pantalla donde se edita esa misma regla.

---

## 3. Propuestas, ordenadas por relación arreglo/riesgo

### P1 (5 min) — Cerrar el hueco de la receta vacía
En `agent-bridge/prompts.mjs:85`, cambiar `??` por un chequeo de contenido:
```js
const savedRecipe = contract?.typeRecipes?.[task.taskType];
const recipe =
  (typeof savedRecipe === "string" && savedRecipe.trim()) ||
  TYPE_RECIPES[task.taskType] ||
  TYPE_RECIPES.otro;
```
Y en `convex/agent.ts:667`, no dejar que un `""` pise el default:
```js
const cleanRecipes = Object.fromEntries(
  Object.entries(typeRecipes).map(([k, v]) => [
    k,
    v.trim() ? v.slice(0, 3000) : DEFAULT_CONTRACT.typeRecipes[k],
  ]),
);
```
Además, avisar en el toast cuando el guardado truncó o restauró algo, en vez de decir solo "Contrato guardado".

### P2 (10 min) — `gitStrategy` solo donde corresponde, y limpiable
Dos cambios independientes; conviene hacer los dos:
1. **En el prompt** (`prompts.mjs:120`), condicionar por tipo — el bloque nunca debe aparecer fuera de su mundo:
   ```js
   const gitTypes = task.taskType === "desarrollo" || task.taskType === "ops";
   if (gitTypes && task.gitStrategy === "main-directo") { … }
   ```
2. **En el backend** (`convex/tasks.ts`), limpiar el campo cuando el tipo deja de ser desarrollo/ops, dentro del bloque `if (delegating)`:
   ```js
   if (nextType !== "desarrollo" && nextType !== "ops") asPatch.gitStrategy = undefined;
   ```
   (`ctx.db.patch` con `undefined` explícito **sí** borra el campo; lo que se pierde es el `undefined` que viaja por el cable desde el cliente.)

### P3 (15 min) — Reglas de oro con núcleo inmutable
Separar `DEFAULT_CONTRACT.goldenRules` en dos listas: `CORE_RULES` (prod/ERP, correos, rastro) y `goldenRules` editables. `buildPrompt` emite siempre `CORE_RULES` + las editables; la app muestra el núcleo en gris, no editable, con la leyenda "se cambia en `CONTRATO_AGENTE.md` + commit". Así la edición rápida sigue siendo rápida y las tres reglas que definen el riesgo requieren pasar por Git.

### P4 (15 min) — Trazabilidad del contrato
1. `logEvent` en `saveContract`, con las reglas anteriores y nuevas (o al menos cuántas cambiaron y cuáles).
2. Guardar en `agentRuns` un `contractHash` (sha1 de las reglas + receta usadas) y `gitStrategy`. Con eso, "¿bajo qué contrato corrió esta tarea?" se responde con un campo, no con arqueología.
3. Guardar las últimas 5 versiones del contrato en `settings` (`agent.contract.history`) → botón "volver a la anterior".

### P5 (10 min) — Reglas de contexto para `analisis` / `ops` / `otro`
En `buildPrompt`, además de la receta del tipo, inyectar un bloque corto derivado del `vcs` de la carpeta (dato que ya está en `agentWorkspaces`):
- `vcs: git` → *"Estás en un repo Git: nunca commitees a master/main; si necesitas tocar archivos, hazlo en rama `agent/<slug>`."*
- `vcs: ninguno` → *"Estás en una carpeta sin control de versiones: nada de git; backup antes de tocar, nada se borra (va a `backups/`)."*

Requiere pasar el `workspace` a `buildPrompt` (el dispatcher ya lo tiene: `dispatchTaskInner({ task, workspace })`).

### P6 (20 min) — Sincronizar `CONTRATO_AGENTE.md` con la realidad
- Corregir §6.4: el despacho corre en `yolo`/`bypassPermissions` en los tres niveles; los límites son el prompt, el timeout y la revisión final. (§3 ya lo dice bien; §6 lo contradice.)
- Añadir la 6.ª regla de oro (español neutro) a §5.
- Nueva sección "Excepciones por tarea": `gitStrategy: main-directo`, qué pisa y en qué tipos aplica.
- Reemplazar "ZCode" por "el agente (ZCode o Claude Code)" y documentar el adaptador.
- Añadir una línea al encabezado: *"Las reglas de oro y las recetas por tipo vigentes se editan en la app; este documento describe el marco, no el texto exacto que viaja."*

### P7 (5 min) — Voseo en los textos del sistema
Corregir los cuatro casos de H8. El de `convex/agent.ts:666` primero, por lo obvio del contexto.

### P8 (a discutir) — Recuperar un límite duro
Si el matcher de `--disallowed-tools` sigue roto en zcode, hay una alternativa que no depende del CLI: un **hook `PreToolUse`** que rechace `git push` cuando `ZCODE_TASK_ID` está presente y la autonomía no es `autonomo` (o cuando la estrategia no es `main-directo`). El puente ya inyecta las variables de entorno necesarias y ya registra hooks (`agent-bridge/register-hooks.mjs`). Sería el primer límite del contrato que no depende de que el modelo obedezca. Vale la pena medir si el hook de Claude Code lo permite antes de invertir.

---

## 4. Lo que NO cambiaría

- **El protocolo de reporte por pasos.** Es la mejor parte del sistema: da observabilidad en vivo sin depender de la buena fe del agente, y el watchdog cubre la salida sin reporte.
- **La separación tipo ↔ vcs con doble validación** (UI + backend, `validateDelegation`). Es exactamente el patrón correcto; el problema es que solo cubre 2 de los 5 tipos (ver P5).
- **Que las reglas de oro sean editables sin deploy.** Acelera de verdad; lo que falta es el piso (P3), no quitar la edición.

---

## 5. Si solo hay tiempo para una cosa

**P2** (gitStrategy pegada). Es el único hallazgo donde el contrato, sin que nadie edite nada ni cometa un error visible, le dice al agente que pushee a producción en una tarea de análisis. Los demás degradan la protección; este la invierte.
