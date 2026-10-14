# Resumen post-implementación — Limpieza del burst de correos + filtro de 14 días

**PRD:** `docs/prds/cristian/correos/2026-10-14-limpieza-burst-y-filtro-antiguedad.md`
**Fecha:** 2026-10-14 · **Deploy:** prod `effervescent-crab-895` · **Rama:** `fix/cristian/limpieza-burst-correos`

## 1. Qué se implementó / ejecutó

- **Filtro anti-backlog en el webhook** (`convex/correos.ts`): un POST cuyo
  `recibidoEn` tenga más de **14 días** de antigüedad se descarta ANTES de
  escribir (200 `{creado:false, descartado:"antiguo"}`), sin fila en `correos`
  ni tarea. Fechas inválidas/ausentes o futuras NO se descartan.
- **Limpieza del burst del 2026-10-13** (operación de datos, una corrida): las
  63 tareas basura se borraron con `tasks:remove` — el camino oficial de la
  app, que además borra la fila del correo y dispara el DELETE de la gemela
  en ClickUp (`syncTask` op=`delete`).

## 2. Cómo se hizo (decisiones técnicas)

- **Orden defensivo**: primero el deploy del filtro, después el borrado. El
  `remove` borra las filas de `correos` (semántica del repo); esas filas
  actuaban de escudo anti-duplicados, y el filtro toma ese rol para siempre.
- **Scope triple verificado por tarea antes de borrar** (script de snapshot):
  `correoId` definido + `createdAt` dentro del 2026-10-13 UTC + correo
  recibido >14 días antes (nota "Recibido:" de la tarea). Resultado: 63 de 63
  cumplieron, 0 excluidas, todas "pendiente", todas con `clickupId`.
- **Borrado vía `tasks:remove`** (no SQL directo ni mutation ad-hoc):
  bitácora `deleted` por tarea, borrado físico del correo y sync ClickUp
  incluidos por diseño del sistema.
- La sesión RSA se generó con el mecanismo estándar del repo
  (`scripts/gen-session.mjs`), consultas vía `npx convex run --prod`.

## 3. Verificación (evidencia)

| Chequeo | Resultado |
|---|---|
| Tareas activas en Convex | 180 → **117** (−63) |
| Tareas del burst restantes (`tasks:list`) | **0** |
| Tareas de correo legítimas intactas | **4** (8/09 ×2, 11/09, 3/10 — mismos ids) |
| ClickUp lista "Tareas mesa técnica" | 100 tareas, **0** coincidencias con los 63 títulos |
| ClickUp búsqueda global (3 títulos distintivos) | **0 resultados** |
| Webhook prod tras el deploy | vivo, 401 sin token (guard intacto) |
| Correos en estado "nuevo" | 1 (residual de agosto, fuera del incidente, intacto) |

Los 63 títulos borrados quedaron registrados en los eventos `created`/
`deleted` de la bitácora (los más antiguos: "RE: Acceso al ERP",
"Proveedor Impresoras Térmicas", de ~2019).

## 4. Qué probar para confiar

1. Abrir la app: columnas sin las 63 tareas; siguen las 4 de correo
   legítimas y todo lo demás.
2. ClickUp → Mesa Técnica Interna → Tareas mesa técnica: sin las gemelas.
3. (Cuando Cris marque el próximo correo real) entra como siempre: el filtro
   solo actúa con >14 días de antigüedad.

## 5. Efectos secundarios, deudas y pasos manuales

- **Caso legítimo bloqueado a propósito**: marcar un correo de hace >14 días
  ya no genera tarea automática (decisión de Cris, ventana de 14 días). Si
   algún día hace falta, crear la tarea a mano.
- **Validación E2E del filtro pendiente**: el token del webhook
  (`POWER_AUTOMATE_TOKEN`) no es legible desde el repo, así que el descarte
  no se pudo probar con un POST firmado real. Cobertura actual: type-check
   del deploy + revisión de lógica + guard 401 verificado. La primera
  evidencia real quedará en el historial del flow de Power Automate
  (respuesta `{descartado:"antiguo"}`) la próxima vez que reintente un
  correo viejo.
- **Paso manual recomendado (Cris, ~5 min)**: en make.powerautomate.com,
   agregar al flow "Outlook importante → Hermes Convex" una condición tras
   "Obtener correo (V2)": continuar solo si la fecha de recepción es de los
   últimos 14 días. Ahorra las llamadas de los reinyectados; el filtro del
   webhook es la barrera definitiva.
- **Higiene del buzón (opcional)**: desmarcar los flags viejos de Outlook
   reduce el tamaño del backlog si el cursor vuelve a resetearse.
- Scripts de la operación (`snapshot-burst.mjs`, `limpiar-burst.mjs`,
  `verificar-borradas.mjs`) fueron temporales y se eliminaron del repo.
