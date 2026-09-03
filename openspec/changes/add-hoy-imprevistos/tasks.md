# Tasks: Hoy + Imprevistos

## 1. Modelo de datos

- [ ] 1.1 Agregar tablas `imprevistos` y `dayItems` a `convex/schema.ts`
      (índices by_day/by_open y by_day/by_task, soft-delete deletedAt).
- [ ] 1.2 Settings key `clickup.imprevistosParentId` (constante en
      `clickupConfig.ts` junto a las demás claves).

## 2. Backend local (sin ClickUp)

- [ ] 2.1 `convex/hoy.ts`: add (valida duplicado), remove, reorder,
      listByDay, carryOverFrom (copia pendientes con carriedFrom).
- [ ] 2.2 `convex/imprevistos.ts`: create, resolve, reopen, reorder,
      remove, promote (marca local; la parte ClickUp en 3), queries
      byDay, openBefore, stats(from,to). requireAuth + sanitización.
- [ ] 2.3 Verificar con `npx tsc -b`.

## 3. Sync ClickUp

- [ ] 3.1 `convex/imprevistosSync.ts` (use node): internalAction syncOne
      con ops create/resolve/reopen/promote; guards enabled/prod/token;
      ensureParent find-or-create; internal mutations _markSynced/
      _markSyncError; sweep de pendientes.
- [ ] 3.2 Promote: update quitando parent → verificar con get_task →
      fallback delete+create top-level; crear task Hermes enlazada
      (patagonia, pendiente, order 0, evento created).
- [ ] 3.3 Excluir subtasks del padre "Imprevistos Cris" del escaneo
      inbound (`getInboundDiff` en clickup.ts).
- [ ] 3.4 Verificar con `npx tsc -b`.

## 4. UI Panel Hoy

- [ ] 4.1 `src/components/HoyPanel.tsx`: secciones Planeadas / Imprevistos
      / Abiertos anteriores; quick-add; buscador; traer pendientes de ayer;
      check planeada → toggleComplete; check imprevisto → resolve/reopen;
      promover; quitar/borrar; colapso persistente.
- [ ] 4.2 Integración en `KanbanView.tsx`: droppable del panel + branch en
      handleDragEnd (hoy.add sin tocar status); SortableContext propio con
      ids prefijados.
- [ ] 4.3 Verificar con `npx tsc -b`.

## 5. Insights

- [ ] 5.1 `src/components/InsightsDrawer.tsx`: rango 7/30 días, por día
      surgidos/mismo-día/abiertos/promovidos + plan-vs-real; agregados.
      Query de stats desde el backend.

## 6. Catch-up

- [ ] 6.1 `buildSummary` (catchups.ts): sección `unplanned` +
      metrics.unplanned desde la tabla imprevistos por día en ventana.
- [ ] 6.2 `src/lib/catchupSummary.ts`: WeekBody + accessor defensivo
      unplannedOf.
- [ ] 6.3 `CatchupView.tsx`: sección retráctil "Imprevistos (N)" con el
      patrón de "En espera".

## 7. Verificación final

- [ ] 7.1 `npm run build` completo (tsc -b + vite).
- [ ] 7.2 Smoke manual en dev: crear imprevisto, resolver, promover,
      arrastrar tarea al panel, ver métricas y sección de catch-up.
