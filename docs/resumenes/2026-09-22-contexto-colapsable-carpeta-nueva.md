# Resumen post-implementación: contexto adicional colapsable + carpeta propia que se crea al despachar

PRD: `docs/prds/cristian/agente/2026-09-22-contexto-colapsable-carpeta-nueva.md` · 2026-09-22

## 1. Qué se implementó

- El ContextPicker del modal de delegación (modo carpeta registrada, tarea
  no-correo) quedó colapsado detrás del botón "＋ Contexto adicional", justo
  debajo del bloque de carpeta: una carpeta DISTINTA de la destino o archivos
  de otro lado, solo lectura. Un solo selector de carpeta visible por defecto.
- La carpeta propia escrita a mano se crea al despachar si no existe (mismo
  paso, con o sin adjuntos): antes el despacho rebotaba con `[sin-carpeta]`.

## 2. Cómo se implementó

- `src/components/AgentDelegationSection.tsx`: componente `ContextoAdicional`
  (botón toggle con `aria-expanded`; cerrado por defecto; cuenta ítems en el
  label cuando hay contexto y está colapsado). Prop nueva `contextCount`.
  Rama no-correo registrada lo usa; correo y modo propio intactos. Texto del
  modo propio ahora anuncia "si no existe, se crea al despachar".
- `src/components/TaskModal.tsx`: pasa
  `contextCount={delegCtx.carpetas.length + delegCtx.archivos.length}` y
  simplifica el slot no-correo (el encabezado "Material de contexto" sobra:
  el botón ES el encabezado).
- `agent-bridge/dispatcher.mjs`: en el bloque 0 (solo-local), `mkdirSync
  recursive` de la carpeta propia si no existe y no hay workspaceId, antes de
  `copiarMaterial`. Ruta inválida → mkdir falla → guard `[sin-carpeta]`
  existente la captura igual.

## 3. Por qué es la mejor forma

- El colapsable respeta la semántica (contexto ≠ carpeta de trabajo: se
  referencia, no se copia) mientras elimina el ruido visual: progressive
  disclosure con conteo para no esconder contenido existente al editar.
- La creación vive en el dispatcher (no en el guard del paso 1): el guard
  sigue siendo la red de seguridad para rutas inválidas y carpetas
  registradas faltantes; el mkdir es idempotente y solo aplica al modo propio
  (`!task.workspaceId`).
- Alternativa descartada: crear la carpeta en el guard del paso 1 para toda
  tarea — crearía silenciosamente carpetas de workspaces registrados con
  error de tipeo en la base.

## 4. Qué probar

1. App → Nueva tarea → ejecutor ZCode/Claude → tipo Reporte: bajo el selector
   de carpeta aparece "＋ Contexto adicional" cerrado; ábrelo y agrega una
   carpeta cualquiera: el botón muestra "1 ítem listo" al colapsarlo.
2. Edita una tarea que ya tenga contexto: el bloque arranca expandido.
3. Tarea correo: respuesta + contexto siempre visibles (sin colapsable).
4. Carpeta propia con ruta nueva (ej. `C:\tmp\prueba-hermes`) sin adjuntos →
   guardar → el puente crea la carpeta y despacha (log: "📁 carpeta propia
   creada"). Antes: pregunta `[sin-carpeta]`.
5. Ruta inválila (ej. `C::\x`) → sigue la pregunta `[sin-carpeta]`.

## 5. Efectos secundarios y deudas

- El botón necesita un reinicio del puente para el punto 4 (el dispatcher
  corriendo cargó el código viejo); el daemon lo relanza solo.
- Tareas de smoke antiguas en estado "pregunta" con rutas inexistentes de
  modo propio, si se re-despachan tras el reinicio, crearán esas carpetas
  (comportamiento nuevo esperado).
