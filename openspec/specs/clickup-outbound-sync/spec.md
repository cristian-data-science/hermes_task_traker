# ClickUp Outbound Sync Specification

## Purpose

Publicación de tareas de Hermes → ClickUp (team Patagonia). Es OPT-IN: solo
se publica lo que tiene destino explícito; el resto vive solo local. Corre
en background (scheduler) tras cada mutación de una tarea patagonia.

## Requirements

### Requirement: Alcance y guards
El sync outbound SHALL aplicar solo a tareas de área `patagonia`, nunca a
`datacef`/`personal`; nunca a tareas desvinculadas (`clickupDetached`); y
solo en producción (`HERMES_ENV=production`) o con override dev
(`clickup.forceSyncDev`). El toggle global `clickup.enabled` en false lo
silencia.

#### Scenario: Tarea de área personal
- **WHEN** se crea una tarea en área personal
- **THEN** no se agenda ninguna escritura en ClickUp

### Requirement: Publicación opt-in
El sistema SHALL crear una tarea en ClickUp SOLO si tiene destino explícito
(`clickupListId` o `clickupParentId` elegidos en el picker). Una tarea sin
destino queda solo local para siempre, sin importar cuántas veces se edite.

#### Scenario: Crear tarea local sin tocar el picker
- **WHEN** se crea una tarea patagonia sin destino ClickUp
- **THEN** no aparece nada en ClickUp y la tarea no queda en error

#### Scenario: Editar tarea local vieja
- **WHEN** se renombra una tarea local nunca publicada
- **THEN** sigue local (el update NO la publica)

### Requirement: Resolución de destino
El sistema SHALL resolver el destino con `resolveOutboundDestination`:
(1) parentId mapeado en config → list del proyecto/destino; (2) parentId
sin mapeo → list elegida en el picker o Mesa Técnica; (3) sin parent pero
con listId → tarea plana en esa list; (4) sin nada → Mesa Técnica
(caso hoy inalcanzable para CREATE por el opt-in, vigente como respaldo).

#### Scenario: Destino de proyecto configurado
- **WHEN** la tarea tiene parentId de una fase de Ley de Datos
- **THEN** se crea en la list 901412131396 anidada bajo esa fase

### Requirement: Creación con anidación real
El sistema SHALL crear con POST a la list y, si hay parentId, anidar con un
PUT separado (el `parent` del POST se ignora); al anidar, ClickUp mueve la
tarea a la list del parent: se persiste la list REAL devuelta por la
respuesta, no la pedida.

#### Scenario: Anidar bajo una fase
- **WHEN** se crea una tarea con destino anidado
- **THEN** queda colgada del parent y su clickupListId refleja la list
  final real

### Requirement: Ruta resuelta al linkear
El sistema SHALL resolver y persistir `clickupPath` (folderName, listName,
listId, folderId, ancestros) inmediatamente después de crear/anclar una
tarea, para que la agrupación por proyecto la ubique de inmediato; falla
silenciosa (sin ruta → "Sueltas" hasta el recálculo manual).

#### Scenario: Linkear tarea a un proyecto
- **WHEN** el sync crea la tarea en ClickUp bajo un proyecto
- **THEN** su clickupPath queda resuelto en la misma corrida

### Requirement: Update y recreado por 404
El sistema SHALL actualizar vía PUT; si ClickUp responde 404 (tarea borrada
allá), desvincular y recrear SOLO si la tarea tiene destino explícito — si
no, queda desvinculada y local (nunca se republica sola a Mesa Técnica).

#### Scenario: Borrada en ClickUp sin destino explícito
- **WHEN** se edita una tarea importada cuya contraparte se borró en
  ClickUp y no tiene listId/parentId
- **THEN** se desvincula y queda local, sin recreate

### Requirement: Cambio de destino en tarea sincronizada
El sistema SHALL desvincular (limpiar clickupId) una tarea sincronizada
cuando cambia su destino, para que el próximo sync la recree en el destino
nuevo; la tarea vieja en ClickUp queda huérfana salvo borrado explícito.

#### Scenario: Mover de proyecto una tarea sincronizada
- **WHEN** se edita el destino de una tarea con clickupId
- **THEN** se desvincula y el sync la recrea en el nuevo destino

### Requirement: Borrado bidireccional
El sistema SHALL borrar en ClickUp al eliminar desde Hermes una tarea
sincronizada NO desvinculada; las desvinculadas se borran solo localmente.

#### Scenario: Eliminar tarea sincronizada
- **WHEN** se elimina una tarea con clickupId y sin clickupDetached
- **THEN** se hace DELETE en ClickUp y se desvincula localmente

### Requirement: Mantenimiento
El sistema SHALL ofrecer acciones de mantenimiento: re-sincronizar
responsables (`syncAssignees`), relee todas las ubicaciones
(`backfillClickupPaths`, incremental o total) y limpiar duplicados de
importación (`cleanupDuplicateTasks` con dry-run, soft-delete de copias, sin
tocar ClickUp).

#### Scenario: Limpiar duplicados en dry-run
- **WHEN** se corre la limpieza con dryRun
- **THEN** reporta grupos y copias sin modificar nada
