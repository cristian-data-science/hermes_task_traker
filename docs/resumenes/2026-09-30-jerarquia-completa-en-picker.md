# Resumen post-implementación: jerarquía completa de ClickUp en el picker

PRD: `docs/prds/cristian/clickup/2026-09-30-jerarquia-completa-en-picker.md` · 2026-09-30
(directo en master a pedido de Cris)

## 1. Qué se implementó

- El selector de destino ClickUp (modal de tarea), el buscador de destino, la
  página de sincronización y las suscripciones inbound ahora muestran la
  jerarquía COMPLETA del space, incluidos los folders anidados.
- Antes solo aparecían 3 folders (Soporte, Administrativo, Mesa Técnica
  Interna); ahora 9 entradas: "Proyectos › Internos" (11 proyectos internos),
  "Proyectos › Externos", "Proyectos › Cartelera", "Administrativo › CatchUp",
  "ATX › Tickets y Soporte", "ATX › Pasos de Versión" y los 3 de siempre.
- El ✓ de "ya integrado" ahora marca si ALGUNA list del folder está integrada
  (antes solo miraba la primera list; con folders aplanados de varias lists
  era casi siempre falso).

## 2. Cómo se implementó

- `convex/clickup.ts` — `mcpSpaceFolders`: recorrido RECURSIVO de la
  jerarquía en vez de un solo nivel. Cada folder con lists directas es una
  entrada etiquetada con su ruta ("Proyectos › Internos"); los contenedores
  puros (folder sin lists, como "Proyectos") solo se atraviesan.
- `convex/clickup.ts` — `discoverProjects`: `alreadyIntegrated` con
  `some()` sobre las lists del folder.
- Sin cambios de frontend ni de schema: todos los consumers ya renderizaban
  lo que devuelve la action.

## 3. Por qué es la mejor forma + alternativas descartadas

- Un solo helper central: los 6 consumers (`discoverProjects`,
  `listFolderLists`, suscripciones ×2, bandeja, `getSearchIndex`) heredan el
  arreglo sin tocarlos, y `listFolderLists`/suscripciones ahora además
  ENCUENTRAN sub-folders por id (antes no existían en la lista).
- Descartado mostrar el árbol anidado en el dropdown: exigiría cambios de
  UI en el picker (que otra sesión estaba editando) para una ganancia
  visual mínima — la etiqueta con ruta "›" es el patrón que ya usa el
  breadcrumb de la app.
- Descartado "limitar el aplanado a 2 niveles": ClickUp no documenta un
  tope de anidación; la recursión es el caso general.
- Nota de diagnóstico: la primera hipótesis (structuredContent del MCP
  recortado) era FALSA — el árbol llega completo en ambas
  representaciones; el dump con tipos por nodo lo desmintió. El bug era
  nuestro recorrido de un nivel.

## 4. Qué probar para confiar

- Modal de tarea → Destino ClickUp → modo "Proyecto": el dropdown lista
  "Proyectos › Internos" y demás rutas; al elegirlo, el selector de list
  muestra los 11 proyectos internos; el árbol de anidación carga bajo la
  list elegida. (Caché de folders: 5 min; botón ↻ para forzar.)
- Buscador del picker: escribir "internos" ofrece el contenedor.
- Página de sync: "Proyectos › Internos" aparece para suscribir inbound.
- Verificado 2026-09-30 en prod (`discoverProjects` con sesión real):
  9 entradas, "Proyectos › Internos" con 11 lists e integrado=✓.

## 5. Efectos secundarios y deudas

- Las entradas aplanadas usan el id del SUB-folder: destinos ya guardados
  contra ids de lists no cambian (los ids de list siguen siendo los de
  siempre); solo el catálogo ganó entradas.
- Deuda menor: el orden del dropdown sigue siendo el de la jerarquía del
  MCP (los nodos no traen orderindex); aceptable para 9 entradas.
- Desplegado a Convex prod (effervescent-crab-895) el 2026-09-30 con
  mensaje de audit trail referenciando el PRD.
