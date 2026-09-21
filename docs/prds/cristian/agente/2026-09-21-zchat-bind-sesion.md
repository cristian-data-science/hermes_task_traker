# PRD: Bind temprano de sesión — el chat no debe quedarse "esperando sesión"

| Campo | Valor |
|---|---|
| Fecha | 2026-09-21 |
| Dueño | Cristian |
| Módulo | agente (puente) |
| Estado | hecho (validado contra db.sqlite real) |
| Relacionados | `2026-09-21-ancho-convex.md` |

## 1. Problema

Con tareas en fase de planificación, "ver chat" abre el chat y se queda
minutos en "⏳ esperando a que el agente arranque su sesión": sin razonamiento
ni planificación en vivo.

**Causa raíz** (verificada en `~/.zcode/cli/db/db.sqlite`): el CLI trunca los
títulos de sesión a 60 caracteres con "…" final, pero `watchSessionDb`
buscaba con `LIKE 'agente- <título completo>%'` — en títulos largos (la
mayoría de los reales, ej. 73 chars) el patrón NO matchea jamás. La sesión
solo se bindeaba al TERMINAR la corrida (stdout), así que el chat pasaba
toda la fase de planificación esperando.

## 2. Para quién

> **Cris**, que abre el chat durante la planificación para seguir el
> razonamiento del agente en vivo.

## 3. Solución

`agent-bridge/agents/zcode.mjs` (`watchSessionDb`) y `dispatcher.mjs`
(`run.folder`):

1. El dispatcher expone la carpeta final de la corrida (`run.folder`).
2. El bind temprano matchea por **carpeta** (`session.directory` = `--cwd`
   exacto) + **prefijo corto de título** (40 chars, muy por debajo del
   truncado del CLI) dentro de la ventana de tiempo (spawn − 60 s).
3. Respaldo: misma carpeta y ventana aunque el título no matchee.
4. Camino viejo por título (schema sin `time_created`) conserva el prefijo
   corto.

Sin cambios en Convex ni frontend: `bindSession` ya existed y actualiza
tarea + corrida; el chat adopta la sesión por suscripción reactiva.

## 4. Casos de prueba (validados contra db.sqlite real)

1. ✅ Título largo 73 chars (tarea de hoy, airflow) → bindea `sess_43dab7d4…`.
2. ✅ Título largo viejo (voiceflow) → bindea `sess_c689f3be…`.
3. ✅ Fallback: título irreconocible + carpeta/ventana correctas → bindea.
4. ✅ Carpeta ajena → NO bindea (sin falsos positivos).

## 5. Criterios de aceptación

- Durante una planificación, "ver chat" muestra razonamiento en segundos
  (poll cada 3 s) en vez de quedarse esperando.
- El daemon local debe reiniciarse para tomar el cambio.
