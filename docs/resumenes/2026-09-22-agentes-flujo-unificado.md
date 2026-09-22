# Resumen post-implementación: un solo motor de ejecución y cero información perdida

Plan: `~/.claude/plans/aqu-est-fondo-esta-fizzy-tome.md` · Rama: `feat/cristian/agentes-flujo` · 2026-09-22

## 1. Problema

Cuando una tarea quedaba en para-revisión, Cris seguía dándole trabajo por el
chat en "modo ejecución". Ese trabajo corría fuera del tracker: sin corrida,
sin pasos, con el plan congelado al 100 % de la corrida anterior y un tope de
15 min (1 timeout y 1 turno perdido en 5 turnos reales). Además, el hook Stop
pisó una pregunta real del agente 17 s después de hacerla, `redirectQueue`
devolvía filas vacías que tumbaban la entrega de redirecciones, y el heartbeat
se rechazaba durante las corridas (campo `agent` sin declarar).

## 2. Qué se implementó

- **Matriz de transiciones en `agentReport`** (`reportAllowed`): una pregunta
  no la pisa un watchdog; los `--step` en pregunta solo se agregan a la
  checklist; tareas cerradas ignoran reportes tardíos; una corrida ya cerrada
  no se reabre. `force` para operación manual.
- **`claimTask` cierra corridas previas abiertas** (la de la pregunta seguía
  sin `endedAt` y aceptaba reportes tardíos — encontrado por la prueba E2E).
- **`agent:continueTask`** (+ `agentFollowUpKind`/`followUpKind`): seguir con
  una instrucción desde para-revisión/hecho/error/cancelada/pregunta, como
  `trabajo` (corrida nueva con plan propio) o `consulta` (solo responde).
  `answerQuestion`, `askHistory` y `reviewResult` comparten el núcleo.
- **Redirección que llega al cierre → continuación** (no se pierde).
- **Chat v5**: sin modo ejecución. Enter = preguntar (solo lectura); Ctrl+Enter
  = encargar trabajo (o responder la pregunta del agente); con corrida activa,
  escribir = redirección en vivo. Candado anti-carrera, cola de consultas,
  observador por estado real (cola/plan/corrida), sigue sesiones nuevas,
  roadmap del seguimiento (no el viejo al 100 %), prompts del puente
  colapsados, avisos en el hilo, motivo honesto de cancelación, Origin/Host
  en los POST, modelo/esfuerzo de la tarea en consultas de Claude.
- **Puente**: post-exit por estado de la tarea (el hook Stop es no-op en sus
  corridas), `killTree`, backoff de claims fallidos (5 min), redirecciones
  robustas, heartbeat con `blocked`/`limits` y compatible con backend viejo,
  stdin cerrado para Claude, `MAX_PARALLEL_CLAUDE=2`, prompt de seguimiento
  por tipo y "retomas tu sesión" solo si la sesión existe.
- **App**: panel con "Continuar con esta instrucción" / "Solo preguntar"
  (textarea + contexto) y Aprobar; pregunta `[sin-carpeta]` con Editar +
  Reintentar; la cola explica por qué espera; conteo por agente; relojes que
  avanzan solos; validación de carpeta para todo agente; voseo → tú.

## 3. Verificado

- 17/17 chequeos E2E de la matriz y las mutaciones contra Convex **dev**.
- Chat en `ZCHAT_DEMO=1` contra dev: preguntar, cola, encargar → en cola →
  corrida con plan nuevo → redirección → vuelta a para-revisión; candado
  (consulta cancelada antes del encargo); redirección tardía → continuación;
  Origin/Host externos → 403.
- `killTree` mata el nieto. Con un padre Node, `child.kill()` también lo hace
  (libuv): el riesgo de huérfanos aplica a binarios nativos como `claude.exe`.
- `tsc` + `vite build` limpios.

## 4. No verificado / pendiente

- Corrida real de ZCode/Claude con el despachador nuevo (el puente de
  producción tiene el lockfile; no se levantó un segundo despachador).
- Backoff del pump y ausencia del aviso "no stdin" de Claude en runtime.
- Panel React en el navegador (requiere iniciar sesión con la clave RSA).

## 5. Despliegue (en este orden)

1. `npx convex deploy` (producción) — primero el backend: el puente nuevo
   manda `force` en dos casos y el chat usa `continueTask`.
2. Reiniciar el puente (tarea programada "Agent Bridge") para cargar el
   despachador nuevo.
3. Cerrar chats abiertos (se relanzan con la versión 5 al volver a abrirlos).
