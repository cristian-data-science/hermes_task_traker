# ClickUp Destination Specification

## Purpose

Cómo se elige, se muestra y se corta la asociación de una tarea con su
ubicación en ClickUp: el picker de destino del TaskModal, la desvinculación
manual y los badges de origen.

## Requirements

### Requirement: Picker de destino
El sistema SHALL ofrecer en el TaskModal (solo área patagonia) un selector
con modos "Mesa Técnica" | "Proyecto": dropdown de folders descubiertos
(caché 5 min + refrescar), dropdown de list si el folder tiene varias, y
navegador de árbol para anclar bajo un parentId; muestra el breadcrumb de
la ubicación guardada y chips de destinos recientes (localStorage, 5).

#### Scenario: Anclar bajo una fase
- **WHEN** se elige proyecto, list y nodo padre en el árbol
- **THEN** el picker emite (parentId, listId) y la tarjeta muestra el
      breadcrumb al reabrir

### Requirement: Mesa Técnica explícita
El sistema SHALL emitir el listId de Mesa Técnica explícitamente al pulsar
el botón "Mesa Técnica" — distinguible de "sin destino / solo local"
(onChange con ambos undefined), porque la publicación outbound es opt-in.

#### Scenario: Elegir Mesa Técnica en una tarea nueva
- **WHEN** se pulsa el botón Mesa Técnica y se guarda
- **THEN** la tarea se publica en la list de Mesa Técnica

### Requirement: Invariante de estado del picker
El estado de navegación del picker (modo, folder, list) SOLO SHALL cambiar
por interacción explícita del usuario; nunca derivarse de props ni queries
(el bug histórico: un efecto colapsaba todo a Mesa Técnica al elegir
folder). La única carga automática es la resolución inicial de una tarea
con destino guardado, guardada por refs.

#### Scenario: Elegir folder no resetea el modo
- **WHEN** se elige un folder ( parentId pasa a undefined)
- **THEN** el picker permanece en modo proyecto

### Requirement: La verdad de ubicación es ClickUp
El sistema SHALL resolver la ubicación de una tarea existente preguntándole
primero a la TAREA MISMA (si tiene clickupId) y recién después al parentId
guardado, con caché por nodo; el `clickupListId` persistido puede estar
  sucio (lo pisa el sync con la list donde se INTENTÓ crear) y no manda.

#### Scenario: Tarea movida de list en ClickUp
- **WHEN** se reabre una tarea que ClickUp movió de list
- **THEN** el breadcrumb refleja la list real, no la persistida

### Requirement: Desvinculación manual
El sistema SHALL ofrecer "Desvincular de ClickUp" en tareas sincronizadas:
marca `clickupDetached`, no escribe NADA en ClickUp (la tarea allá queda
intacta) y de ahí en más eliminarla local no la borra allá. El
`clickupId` se conserva a propósito (evita duplicados al recrear y
re-ofertas del inbound).

#### Scenario: Desvincular y borrar local
- **WHEN** se desvincula una tarea y luego se elimina en Hermes
- **THEN** la tarea en ClickUp sobrevive

### Requirement: Badges de origen
El sistema SHALL distinguir visualmente en la tarjeta: "Desvinculada"
(icono unlink), ClickUp con link a la tarea (y aviso de error de sync), o
local sin badge.

#### Scenario: Error de sync visible
- **WHEN** una tarea sincronizada tiene clickupSyncError
- **THEN** la tarjeta lo avisa junto al link
