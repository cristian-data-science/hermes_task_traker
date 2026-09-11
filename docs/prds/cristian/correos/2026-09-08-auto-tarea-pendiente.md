# PRD: Correo nuevo → tarea automática "pendiente" en Patagonia

| Campo | Valor |
|---|---|
| Fecha | 2026-09-08 |
| Dueño | Cristian |
| Módulo | correos (backend Convex) |
| Estado | hecho |
| Rama / PR | master (sobre la ingesta de correos) |
| Relacionados | `2026-08-31-ingesta-outlook-power-automate.md` (PRD base), spec `openspec/specs/clickup-outbound-sync` |

---

## 1. Problema

Los correos que llegan a la tabla `correos` quedan esperando un consumidor
(`pendientes` → crear tarea → `marcarProcesado`) que todavía no existe: nadie
los convierte en tarea. Mientras tanto, la decisión de Cris es simple: cada
correo marcado en Outlook **es** algo que hay que hacer, y basta con que nazca
como tarea para revisarla después.

## 2. Para quién (persona concreta)

> Este feature es para **Cris**, que marca correos importantes en Outlook y
> quiere verlos aparecer solos en la columna "Programado" del tablero (y en
> Mesa Técnica de ClickUp), sin copiar nada a mano ni esperar un triage que
> aún no existe.

## 3. User journey (paso a paso)

1. Cris marca un correo en Outlook → Power Automate → `POST /correos/ingesta`.
2. `ingestar` inserta el correo **y en la misma transacción** crea la tarea:
   área Patagonia, estado `pendiente`, título = asunto, notas con
   remitente/fecha/enlace a Outlook/cuerpo, arriba de la columna.
3. La tarea se agenda al sync de ClickUp → nace publicada en Mesa Técnica.
4. El correo queda `procesado` con su `tareaId` (la cola no acumula).
5. Si el webhook se redispara (correo editado en Outlook): solo se refresca
   el contenido del correo; la tarea NO se duplica.

## 4. Alcance

**Sí incluye:**
- Helper `crearTareaDeCorreo` + enganche en `ingestar` (transacción atómica:
  correo y tarea se crean juntos o no se crea ninguno).
- Tarea: `title`= asunto (≤200, fallback "(correo sin asunto)"),
  `requestedBy` = remitente, `notes` = De/Recibido/Abrir en Outlook + cuerpo
  (≤5000; el cuerpo completo vive en `correos`), `order` 0 arriba de la
  columna "pendiente" (patrón `create`).
- `logEvent kind:"created"` con `toStatus:"pendiente"` → alimenta "Entró
  esta semana" del catch-up.
- ClickUp outbound `op:"create"` (Mesa Técnica) con los guards habituales de
  `syncTask` (prod/enabled/área).
- `internalMutation procesarUltimo`: backfill manual — le crea la tarea al
  correo `nuevo` más reciente (corrida única vía `npx convex run`).

**No incluye:**
- UI de triage de correos (sigue pendiente; `pendientes`/`marcarProcesado`
  quedan para el futuro panel y no se rompen).
- Fechas programadas automáticas: la tarea nace sin `scheduledDates` (no
  aparece en el calendario hasta que Cris le ponga fechas a mano).
- Delegación al agente: la tarea no nace `executor=zcode`.
- Filtros por remitente/categoría (todo correo marcado genera tarea).

## 5. Diseño técnico (diagrama)

```
POST /correos/ingesta ─> internalMutation `ingestar`
  ├─ existe messageId ─> patch de contenido (SIN tocar estado/tareaId)
  └─ no existe ─> insert correo "nuevo"
                    └─ (misma transacción) crearTareaDeCorreo:
                         ├─ shift +1 columna "pendiente" (by_status)
                         ├─ insert task {patagonia, pendiente, order 0,
                         │               notas ≤5000, requestedBy}
                         ├─ logEvent "created" → catch-up
                         ├─ scheduler.runAfter(0, clickup.syncTask op:create)
                         │   └─ Mesa Técnica (guards de syncTask)
                         └─ patch correo {procesado, tareaId, procesadoEn}
```

- Tablas tocadas: `correos` (patch de cierre), `tasks` (insert), `events`
  (bitácora). Sin cambios de schema: `estado` y `tareaId` ya existían.
- El `sessionToken:""` del sync agendado es intencional: `syncTask` no
  re-valida la sesión (la valida quien agenda; la ingesta no tiene sesión).
- En dev el ClickUp sync sigue bloqueado salvo `clickup.forceSyncDev=true`
  (guard existente); la tarea local se crea igual.

## 6. Casos de prueba

- [ ] POST válido nuevo → `{creado:true, id, tareaId}` y la tarea aparece
      arriba de la columna "Programado" con notas del correo.
- [ ] El correo queda `procesado` con `tareaId` y `procesadoEn`.
- [ ] Redisparo del mismo `messageId` → una sola tarea; el correo sigue
      `procesado` (no se resetea).
- [ ] Correo sin asunto → tarea "(correo sin asunto)".
- [ ] Correo con cuerpo enorme → notas ≤5000, cuerpo en `correos` ≤100k.
- [ ] `procesarUltimo` sin correos `nuevo` → `{creado:false}` sin error.
- [ ] `procesarUltimo` con varios `nuevo` → tarea SOLO para el más reciente.
- [ ] Tarea visible en ClickUp Mesa Técnica (prod, o dev con forceSyncDev).

## 7. Criterios de aceptación

- [x] `tsc` + `npm run build` sin errores.
- [x] Prueba curl end-to-end contra dev: correo → tarea + correo procesado.
- [x] Backfill `npx convex run --prod correos:procesarUltimo` ejecutado.
- [x] Resumen post-implementación en `docs/resumenes/`.

## 8. Riesgos y notas

- **Volumen**: cada correo marcado genera tarea + publicación en ClickUp; el
  filtro es humano (Cris marca), así que el volumen es el que Cris decida.
- **ClickUp como dependencia blanda**: si el sync falla, el error queda en
  `clickupSyncError` de la tarea y se reintenta en la próxima edición (el
  correo y la tarea local ya están creados).
- **Correos previos**: los 2 existentes no se reprocesan solos; se decide
  por `procesarUltimo` (este PRD: solo el más reciente, acuerdo con Cris).
