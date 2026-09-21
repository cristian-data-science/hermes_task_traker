# PRD: Carpeta de trabajo customizada (local, sin git) con material copiado adentro

| Campo | Valor |
|---|---|
| Fecha | 2026-09-21 |
| Dueño | Cristian |
| Módulo | agente (UI + Convex + puente) |
| Estado | hecho (pruebas de copia y prompt + build) |
| Relacionados | `2026-09-21-adjuntos-tareas.md` |

## 1. Problema

Al delegar, la carpeta destino solo podía ser una REGISTRADA (agenteWorkspaces).
Para tareas nuevas sin carpeta ni material — el caso típico: "analiza este
Excel que está en Descargas" — Cris debía registrar una carpeta a mano o
dejar la tarea sin destino. Además quería poder elegir/crear la carpeta y
adjuntar archivos EN EL MISMO modal, con los archivos terminando DENTRO de
la carpeta del proyecto, y sin que el agente toque git.

## 2. Para quién

> **Cris**, que arma tareas sobre material nuevo: crea la carpeta en el
> momento, adjunta el Excel desde donde esté, y el agente trabaja ahí — sin
> repo, sin versión, sin subir nada.

## 3. Solución

**UI** (`AgentDelegationSection` + `TaskModal`): bajo el selector de carpetas
registradas (opción A, default) aparece la opción B "Carpeta customizada —
local, sin git". Al activarla: picker nativo de carpeta (se puede crear en el
diálogo) + "Agregar archivos…" con chips. El selector de estrategia Git se
oculta (queda fija en `solo-local`). El picker de contexto de solo lectura
se oculta en este modo (los archivos ya tienen destino: se copian).

**Datos**: modo custom = `workspaceId: undefined` + `workspacePath: <carpeta>`
+ `gitStrategy: "solo-local"` (literal nuevo) + `contextPaths.archivos`
(rutas ORIGEN; nada de bytes por Convex). Al volver de custom a registrado se
limpian mutuamente (el update suelta el workspaceId al ver solo-local y el
cliente vacía el workspacePath con "").

**Puente**: nuevo `agent-bridge/material.mjs` (`copiarMaterial`, puro e
idempotente — nunca pisa lo existente). El dispatcher, con `solo-local`,
copia los archivos DENTRO de la carpeta (creándola si no existe) antes del
claim, loguea el resultado y apunta el prompt a las COPIAS.

**Prompt**: bloque "ESTRATEGIA GIT: SOLO LOCAL" que pisa cualquier receta
(PROHIBIDO git init/add/commit/push; nada sale de la carpeta) + variante de
contexto "MATERIAL BASE DE LA TAREA" (los archivos son punto de partida para
trabajar, no referencias de solo lectura; resultados en archivos nuevos).

## 4. Casos de prueba (pasados)

1. ✅ `copiarMaterial`: crea carpeta nueva, copia el archivo, marca faltantes,
   idempotente (2ª pasada = skip, no pisa).
2. ✅ Prompt solo-local: bloque de prohibición git + "MATERIAL BASE" con las
   rutas de destino.
3. ✅ Regresión: tarea normal sigue con "MATERIAL DE CONTEXTO (solo lectura)".
4. ✅ `npm run build` limpio.
5. Manual (Cris): modal → activar customizada → crear carpeta → adjuntar
   Excel de Descargas → despachar → el Excel queda en la carpeta y el agente
   trabaja ahí sin git.

## 5. Criterios de aceptación

- Las dos opciones (registrada / customizada) son excluyentes y reversibles
  al editar, con hidratación correcta.
- Ningún byte de archivo pasa por Convex; la copia es local en el despacho.
- En modo custom el agente no ejecuta git ni sube nada (regla en el prompt).
