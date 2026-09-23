# PRD: Contexto adicional colapsable + carpeta propia que se crea al despachar

| Campo | Valor |
|---|---|
| Fecha | 2026-09-22 |
| Dueño | Cristian |
| Módulo | agente (modal de delegación + puente) |
| Estado | en desarrollo |

## 1. Problema

El modal de tareas muestra de golpe tres controles de carpeta (destino
registrada, propia, y el ContextPicker de contexto siempre visible): excesivo.
Además, una carpeta propia escrita a mano que no existe rebota el despacho con
`[sin-carpeta]`: hay que crearla a mano en el explorador y volver a delegar.

## 2. Para quién

> **Cris**, que delega tareas y quiere elegir contexto extra sin ruido, y
> crear la carpeta de trabajo en el mismo paso.

## 3. Solución

1. El ContextPicker (modo carpeta registrada, tarea no-correo) pasa a un botón
   colapsable "＋ Contexto adicional" justo debajo del bloque de carpeta.
   Cerrado por defecto; si la tarea ya trae contexto, arranca abierto y el
   botón muestra el conteo. Correo y modo propio no cambian.
2. El dispatcher crea la carpeta propia (`mkdir recursive`) si no existe,
   aunque no haya adjuntos que copiar (antes solo la creía `copiarMaterial`).
   Ruta inválida → mkdir falla → el guard `[sin-carpeta]` del paso 1 sigue
   capturando. Texto del modal actualizado para anunciarlo.

## 4. Alcance

- Solo presentación del contexto + creación de carpeta propia al despachar.
- No cambia semántica: contexto sigue siendo solo lectura; adjuntos del modo
  propio se siguen copiando dentro.

## 5. Casos de prueba

1. Modal delegación (registrada, no correo): solo se ve "＋ Contexto
   adicional"; al abrirlo aparecen "Agregar carpeta…" y "Agregar archivos…".
2. Editar tarea con contexto existente → el bloque arranca expandido.
3. Correo: el bloque de respuesta + contexto queda siempre visible (igual).
4. Carpeta propia con ruta nueva inexistente y sin adjuntos → al despachar se
   crea la carpeta y la corrida arranca (antes: pregunta [sin-carpeta]).
5. Carpeta propia con ruta inválida → sigue preguntando [sin-carpeta].

## 6. Criterios de aceptación

- [x] Un solo selector de carpeta visible por defecto en el modal.
- [x] Build + tipos OK; verificado en navegador contra el backend dev.
- [x] `node --check` del dispatcher OK.
