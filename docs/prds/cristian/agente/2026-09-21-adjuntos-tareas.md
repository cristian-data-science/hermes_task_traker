# PRD: Adjuntar archivos de contexto (ej. Excel) a cualquier tarea delegada

| Campo | Valor |
|---|---|
| Fecha | 2026-09-21 |
| Dueño | Cristian |
| Módulo | agente (UI del tablero + puente) |
| Estado | hecho (build + prueba de prompt) |

## 1. Problema

Al delegar una tarea (ej. análisis sobre un Excel) no había forma de adjuntar
el archivo: el picker de contexto solo se mostraba para tareas de CORREO,
aunque todo el pipeline (schema `contextPaths.archivos`, picker nativo de
archivos, sección "Archivos para leer" del prompt) ya lo soportaba para
cualquier tipo.

Requisito duro de Cris: el archivo NO viaja a Convex — los bytes se quedan
en su disco; solo la ruta local (string saneado ≤300 chars) se guarda en la
tarea, como ya pasa con las carpetas de contexto.

## 2. Para quién

> **Cris**, que delega análisis con datos concretos ("resume este Excel",
> "cotiza con esta lista") y quiere que el agente lea el archivo original
> sin subirlo a la nube.

## 3. Solución

1. **`src/components/TaskModal.tsx`**: el `contextSlot` de
   `AgentDelegationSection` ahora se llena para TODA tarea con executor
   delegado — para `correo` se mantiene el bloque actual (indicación +
   picker + texto); para el resto, el picker con una línea de ayuda
   ("contexto solo lectura, leído de tu disco, no se sube a la nube").
   Hidratación al editar y guardado ya existían (payload L317/333 con
   validación en `tasks.create/update` para executors delegados).
2. **`agent-bridge/prompts.mjs`**: helper `marcarRuta` — si una ruta de
   contexto ya no existe en disco al momento del despacho, la línea del
   prompt dice "(ya no existe en disco — avísale a Cris si lo necesitabas)"
   en vez de mandar al agente a buscar un fantasma. Aplica a carpetas y
   archivos, en el prompt general y en el de correo.

Sin cambios en Convex ni en el dispatcher/spawn.

## 4. Casos de prueba

1. ✅ build limpio (`tsc -b && vite build`).
2. ✅ `buildPrompt` con tarea fake + archivo real → la sección "Archivos
   para leer" contiene la ruta tal cual; con ruta inexistente → contiene la
   marca "(ya no existe en disco…)".
3. Manual (Cris): crear tarea de análisis con un Excel adjunto → despachar
   → el agente lo lee (preguntarle cifras del archivo). Requiere reinicio
   del daemon para el cambio de prompts.mjs.
4. Manual: editar la tarea → los chips de contexto aparecen hidratados.
5. Regresión visual: el bloque de correo queda idéntico al anterior.

## 5. Criterios de aceptación

- Cualquier tarea delegada puede adjuntar carpetas/archivos al crear y
  editar; el agente los recibe como rutas absolutas de solo lectura.
- Ningún byte de archivo pasa por Convex.
- Archivos movidos/borrados se reportan en el prompt, no se ocultan.
