import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Modelo de datos de Hermes Task Tracker
 *
 * Auth: challenge-response RSA. El login no usa contraseña.
 *  - El backend guarda la CLAVE PÚBLICA en HERMES_RSA_PUBLIC_KEY (secreto Convex).
 *  - El cliente firma un challenge con su CLAVE PRIVADA (rsa_key.p8), que nunca
 *    se envía al servidor.
 *  - La sesión es un token opaco en la tabla `sessions`.
 *
 * Hardening:
 *  - `tasks.deletedAt` / `subtasks.deletedAt`: borrado lógico (soft-delete).
 *    Las queries filtran `deletedAt === undefined`.
 *  - `challenges`: nonce de un solo uso y caducable (anti-replay).
 */

export const areas = ["patagonia", "datacef", "personal"] as const;
export type Area = (typeof areas)[number];

export const statuses = [
  "urgente",
  "pendiente",
  "en-curso",
  "standby",
  "programado",
  "completado",
] as const;
export type Status = (typeof statuses)[number];

/**
 * ===== Capa agente (delegación Cris ⇄ ZCode) =====
 * Ver CONTRATO_AGENTE.md (raíz del repo): ciclo de vida, autonomía y la
 * separación dura Git (desarrollo → git_provisorio) vs archivos
 * (reporte → C:\mcp_servers, jamás git).
 */

/** Tipos de tarea delegable; determinan el mundo de trabajo (Git vs archivos). */
export const taskTypes = [
  "reporte",
  "desarrollo",
  "analisis",
  "ops",
  "otro",
] as const;
export type TaskType = (typeof taskTypes)[number];

/** Niveles de autonomía del agente (ver matriz en CONTRATO_AGENTE.md §3). */
export const autonomies = ["escenario", "supervisado", "autonomo"] as const;
export type Autonomy = (typeof autonomies)[number];

/**
 * Ciclo de vida de la delegación. Es la fuente de verdad mientras la tarea
 * tenga executor=zcode; el estado del tablero (status) se deriva de acá
 * (mapeo en CONTRATO_AGENTE.md §2).
 */
export const agentStates = [
  "encolada",
  "despachada",
  "trabajando",
  "pregunta",
  "para-revision",
  "hecho",
  "error",
  "cancelada",
] as const;
export type AgentState = (typeof agentStates)[number];

/** Notificaciones WhatsApp vía Hermes (`hermes send`): off | final | periódica. */
export const notifyModes = ["off", "final", "periodica"] as const;
export type NotifyMode = (typeof notifyModes)[number];

/**
 * Estados del pipeline de correos (ingesta Outlook → Power Automate):
 * `nuevo` espera transformación en tarea; `procesado` ya generó su tarea
 * (queda `tareaId`); `descartado` se decide que no era tarea.
 */
export const correosEstados = ["nuevo", "procesado", "descartado"] as const;
export type CorreoEstado = (typeof correosEstados)[number];

export default defineSchema({
  tasks: defineTable({
    title: v.string(),
    area: v.union(
      v.literal("patagonia"),
      v.literal("datacef"),
      v.literal("personal"),
    ),
    status: v.union(
      v.literal("urgente"),
      v.literal("pendiente"),
      v.literal("en-curso"),
      v.literal("standby"),
      v.literal("programado"),
      v.literal("completado"),
    ),
    notes: v.optional(v.string()),
    /**
     * Ejecutor responsable: Cris (tú), Claw (agente Hermes) o ZCode
     * (agente de código despachado por el puente agent-bridge).
     */
    executor: v.optional(
      v.union(v.literal("cris"), v.literal("claw"), v.literal("zcode")),
    ),
    /**
     * Responsable original en ClickUp (primer nombre del assignee). Se preserva
     * al importar para saber quién es el dueño real de la tarea, aunque en
     * Hermes el executor sea cris/claw.
     */
    clickupAssignee: v.optional(v.string()),
    estimate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    progress: v.optional(v.number()),
    standbyFrom: v.optional(v.string()),
    standbyUntil: v.optional(v.string()),
    scheduledDates: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
    order: v.number(),
    completedAt: v.optional(v.number()),
    /**
     * Súper urgente: capa de visualización por encima de todo lo demás.
     * Una tarea con este check ignora los filtros del tablero (búsqueda,
     * área, estado y áreas ocultas) y se ancla SIEMPRE primera en su
     * columna/grupo, con borde holográfico RGB. No toca ClickUp: es solo
     * una marca local de Hermes.
     */
    superUrgent: v.optional(v.boolean()),
    /** Borrado lógico: timestamp cuando se eliminó, o undefined si está activa. */
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    // ===== Integración ClickUp (solo área `patagonia`) =====
    /** id de la tarea en ClickUp. Vacío = no sincronizada. */
    clickupId: v.optional(v.string()),
    /**
     * Nodo padre en ClickUp. Vacío → la tarea cae en la List "Mesa Técnica"
     * (tarea suelta). Seteado → la tarea se anida bajo ese nodo (rama de un
     * proyecto, ej. "alcance" dentro de Ley de Datos).
     */
    clickupParentId: v.optional(v.string()),
    /**
     * List de ClickUp donde vive el destino de esta tarea. Se persiste junto a
     * clickupParentId para que el selector de destino pueda reconstruir su
     * estado al editar (saber en qué list está el nodo elegido).
     */
    clickupListId: v.optional(v.string()),
    /** URL directa a la tarea en ClickUp (para el badge/link en la UI). */
    clickupUrl: v.optional(v.string()),
    /** Timestamp del último sync exitoso con ClickUp. */
    clickupSyncedAt: v.optional(v.number()),
    /**
     * Cuándo se le mandó a ClickUp la nota con el resumen de lo hecho (solo
     * tareas delegadas al agente, al quedar completadas). Compara contra
     * completedAt para no duplicar el comentario en re-syncs.
     */
    clickupCommentedAt: v.optional(v.number()),
    /** Último error de sync (vacío = ok). Se muestra en la UI como aviso. */
    clickupSyncError: v.optional(v.string()),
    /**
     * Tarea SOLO LOCAL (área Patagonia): no se crea ni se sincroniza con
     * ClickUp. Vive únicamente en Convex. El check del TaskModal la activa.
     */
    clickupLocal: v.optional(v.boolean()),
    /**
     * Si el usuario descartó esta tarea del modal de sync reversa (inbound).
     * Evita que reaparezca como "nueva" en futuros escaneos.
     */
    clickupInboundIgnored: v.optional(v.boolean()),
    /**
     * La tarea se desvinculó de ClickUp a mano: sigue en el tablero pero deja
     * de sincronizarse en ambos sentidos, y borrarla en Hermes NO la borra en
     * ClickUp.
     *
     * Se conserva el `clickupId` a propósito, por dos motivos: si se limpiara,
     * cualquier edición posterior haría que el sync la tomara por nueva y
     * CREARA una tarea duplicada en ClickUp; y además el escaneo inbound la
     * volvería a ofrecer como "nueva" para reimportar.
     */
    clickupDetached: v.optional(v.boolean()),
    /**
     * Ubicación de la tarea en ClickUp, ya resuelta y desnormalizada, para
     * poder agrupar el tablero por proyecto SIN pegarle a ClickUp en cada
     * render.
     *
     * `listName` es el grupo (la list es la unidad que ClickUp y la config
     * llaman "proyecto"); `ancestors` son las tareas contenedoras que cuelgan
     * debajo (raíz, fases, tarea padre) y alimentan el subtítulo de la
     * tarjeta. La profundidad varía por proyecto: puede estar vacío.
     *
     * Es una copia: si en ClickUp renombran una fase, queda vieja hasta el
     * próximo sync o backfill. `resolvedAt` permite saber qué tan añeja es.
     */
    clickupPath: v.optional(
      v.object({
        folderName: v.optional(v.string()),
        listName: v.optional(v.string()),
        listId: v.optional(v.string()),
        folderId: v.optional(v.string()),
        ancestors: v.optional(v.array(v.string())),
        resolvedAt: v.optional(v.number()),
      }),
    ),
    // ===== Catch-up semanal =====
    /**
     * Pin "llevar al catch-up": la tarea aparece en el bloque "Temas para
     * conversar" de la vista Catch-up. Se marca durante la semana, con el
     * tema fresco, y se limpia al cerrar la semana.
     */
    catchupFlag: v.optional(v.boolean()),
    /** Nota corta del porqué se marcó (qué quieres conversar de esta tarea). */
    catchupNote: v.optional(v.string()),
    /** Cuándo se marcó, para ubicarla en la semana correcta. */
    catchupFlaggedAt: v.optional(v.number()),
    // ===== Capa agente (executor=zcode, despachado por agent-bridge) =====
    /**
     * Tipo de tarea delegada. Determina el mundo de trabajo:
     * `desarrollo` → solo carpetas con vcs=git (git_provisorio);
     * `reporte` → solo carpetas vcs=ninguno (C:\mcp_servers), jamás git.
     */
    taskType: v.optional(
      v.union(
        v.literal("reporte"),
        v.literal("desarrollo"),
        v.literal("analisis"),
        v.literal("ops"),
        v.literal("otro"),
      ),
    ),
    /**
     * Carpeta destino (registro agentWorkspaces). Se guarda el id para el
     * picker y un snapshot de la ruta igual que clickupPath: si la carpeta se
     * renombra/borra del registro, la corrida sigue mostrando dónde corrió.
     */
    workspaceId: v.optional(v.id("agentWorkspaces")),
    workspacePath: v.optional(v.string()),
    /** Nivel de autonomía de la corrida (CONTRATO_AGENTE.md §3). */
    autonomy: v.optional(
      v.union(
        v.literal("escenario"),
        v.literal("supervisado"),
        v.literal("autonomo"),
      ),
    ),
    /** Estado del ciclo de delegación (fuente de verdad del lado agente). */
    agentState: v.optional(
      v.union(
        v.literal("encolada"),
        v.literal("despachada"),
        v.literal("trabajando"),
        v.literal("pregunta"),
        v.literal("para-revision"),
        v.literal("hecho"),
        v.literal("error"),
        v.literal("cancelada"),
      ),
    ),
    /**
     * Sesión de ZCode de la última corrida (sess_...). Los seguimientos
     * (respuesta a pregunta, re-despacho) retoman esta sesión con --resume
     * para no perder contexto. Compartida con el desktop de ZCode.
     */
    agentSessionId: v.optional(v.string()),
    /** Pregunta abierta del agente a Cris (estado pregunta). */
    agentQuestion: v.optional(v.string()),
    /**
     * Contexto pendiente para el PRÓXIMO despacho: la respuesta de Cris a una
     * pregunta, o el feedback al rechazar una revisión. El puente lo empaqueta
     * en el prompt de seguimiento (run.followUp) y lo limpia al despachar.
     */
    agentFollowUp: v.optional(v.string()),
    /**
     * Último paso reportado por el agente (protocolo --step): texto corto de
     * lo que acaba de hacer. Espejo de la corrida para que la tarjeta lo
     * muestre sin query extra.
     */
    agentLastStep: v.optional(v.string()),
    agentLastStepAt: v.optional(v.number()),
    /** Progreso dentro del plan declarado (protocolo --plan): paso N de M. */
    agentStepIndex: v.optional(v.number()),
    agentPlanTotal: v.optional(v.number()),
    /**
     * Redirección EN VIVO de Cris (cuadro "Redirigir al agente"): instrucciones
     * para una corrida ACTIVA. Se entrega en el próximo reporte del agente
     * (report.mjs se la devuelve en la salida del comando) y se limpia al
     * entregarla. El agente adapta plan/rumbo con esa instrucción.
     */
    agentRedirect: v.optional(v.string()),
    agentRedirectAt: v.optional(v.number()),
    /** Modelo ZCode elegido para la corrida (id, p.ej. builtin:zai-coding-plan/GLM-5.3). */
    model: v.optional(v.string()),
    /** Notificaciones WhatsApp vía Hermes para esta tarea. */
    notifyWhatsapp: v.optional(
      v.union(v.literal("off"), v.literal("final"), v.literal("periodica")),
    ),
  })
    .index("by_status", ["status", "order"])
    .index("by_area", ["area", "order"])
    .index("by_area_status", ["area", "status", "order"])
    .index("by_clickup_id", ["clickupId"])
    .index("by_agent_state", ["agentState", "createdAt"]),

  subtasks: defineTable({
    taskId: v.id("tasks"),
    title: v.string(),
    done: v.boolean(),
    completedAt: v.optional(v.number()),
    /** Borrado lógico: timestamp cuando se eliminó, o undefined si está activa. */
    deletedAt: v.optional(v.number()),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_task", ["taskId", "order"]),

  // ===== Bitácora de actividad (alimenta la vista Catch-up) =====
  /**
   * Log append-only de lo que va pasando en el tablero. Existe porque los
   * timestamps de `tasks` solo cuentan el estado FINAL (createdAt, completedAt,
   * updatedAt): no sabrían decir "el jueves la moviste a en-curso y el viernes
   * quedó en standby". El catch-up necesita justamente eso.
   *
   * Es append-only a propósito: nunca se edita ni se borra un evento. Si una
   * tarea se elimina, su historial sobrevive — lo que hiciste esa semana
   * sigue siendo cierto aunque la tarea ya no exista.
   *
   * Los campos `title`/`area` son SNAPSHOTS al momento del evento, no joins.
   * Si la tarea se renombra después, el evento conserva cómo se llamaba
   * entonces, que es lo que vas a reconocer al leer la semana.
   */
  events: defineTable({
    taskId: v.id("tasks"),
    kind: v.union(
      v.literal("created"),
      v.literal("status"),
      v.literal("completed"),
      v.literal("reopened"),
      v.literal("progress"),
      v.literal("subtask_done"),
      v.literal("subtask_undone"),
      v.literal("deleted"),
      v.literal("flagged"),
      // Capa agente (CONTRATO_AGENTE.md §1)
      v.literal("agent_dispatched"),
      v.literal("agent_update"),
      v.literal("agent_question"),
      v.literal("agent_answer"),
      v.literal("agent_review"),
    ),
    /** Timestamp del evento (ms). Índice principal de consulta por rango. */
    at: v.number(),
    /** Snapshot del área al momento del evento. */
    area: v.string(),
    /** Snapshot del título al momento del evento. */
    title: v.string(),
    fromStatus: v.optional(v.string()),
    toStatus: v.optional(v.string()),
    fromProgress: v.optional(v.number()),
    toProgress: v.optional(v.number()),
    /** Texto libre: título de la sub-tarea, nota del pin, etc. */
    detail: v.optional(v.string()),
    /** true si el evento lo originó el sync inbound de ClickUp, no vos. */
    viaClickup: v.optional(v.boolean()),
  })
    .index("by_at", ["at"])
    .index("by_task", ["taskId", "at"]),

  // ===== Catch-ups cerrados (el ciclo semana a semana) =====
  /**
   * Una fila por semana cerrada. Guarda un SNAPSHOT congelado de lo que se
   * presentó (no se recalcula después: lo que dijiste el martes pasado no
   * cambia porque hoy hayas completado algo) más tus notas y los compromisos
   * que asumiste para la semana siguiente.
   *
   * Los compromisos enlazados a una tarea (`taskId`) se resuelven solos
   * leyendo el tablero; los sueltos se marcan a mano (`manualDone`).
   */
  catchups: defineTable({
    /** Inicio del período (ms). Lo calcula el cliente en hora local. */
    weekStart: v.number(),
    /** Fin del período (ms, exclusivo). */
    weekEnd: v.number(),
    closedAt: v.number(),
    /** Notas libres tuyas sobre la semana (markdown plano). */
    notes: v.optional(v.string()),
    /** JSON congelado de las métricas y listados al momento del cierre. */
    snapshot: v.string(),
    commitments: v.array(
      v.object({
        id: v.string(),
        text: v.string(),
        /** Tarea enlazada: permite resolver el cumplimiento automáticamente. */
        taskId: v.optional(v.id("tasks")),
        /** Marca manual para compromisos sin tarea enlazada. */
        manualDone: v.optional(v.boolean()),
        /**
         * Cuántas semanas viene arrastrándose este compromiso. 0 = nuevo.
         * Se muestra como "arrastrado ×N" — incómodo a propósito.
         */
        carryCount: v.optional(v.number()),
        /**
         * Identidad estable a través de los arrastres: todas las apariciones
         * del MISMO compromiso, semana tras semana, comparten `rootId`.
         *
         * Es lo que permite reconstruir el linaje ("esto lo vienes prometiendo
         * hace 5 semanas") sin lo cual la bitácora es una pila de semanas
         * sueltas. Opcional porque los cierres anteriores a este campo no lo
         * tienen: para esos se deduce del sufijo del `id`.
         */
        rootId: v.optional(v.string()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_weekStart", ["weekStart"]),

  // ===== Exclusiones del catch-up =====
  /**
   * Tareas quitadas a mano del resumen de UNA semana (la X de la vista).
   * Solo afectan la vista y sus contadores: la tarea sigue en el tablero y
   * en ClickUp. Como viven por `weekStart`, el cierre congela el snapshot
   * sin la tarea y la semana siguiente vuelve a mostrarla (si sigue viva).
   */
  catchupExclusions: defineTable({
    /** Semana a la que aplica la exclusión (= `from` de la ventana). */
    weekStart: v.number(),
    taskId: v.id("tasks"),
    createdAt: v.number(),
  }).index("by_weekStart", ["weekStart"]),

  // ===== Panel Hoy: imprevistos (trabajo no trackeado) =====
  /**
   * Un imprevisto es una tarea que surgió en el día y NO está registrada en
   * el tablero: vive en esta tabla propia, no en `tasks`. El objetivo es
   * medir cuánto trabajo no trackeado aparece por día y cuánto le quita a
   * lo planificado — si fueran filas de `tasks` habría que filtrarlas de
   * Kanban, List, Calendario, catch-up, inbound y métricas.
   *
   * Cada imprevisto se refleja en ClickUp como SUBTAREA de la tarea
   * "Imprevistos Cris" (Mesa Técnica), con sync best-effort igual que las
   * tasks: el error queda en la fila y se reintenta en el próximo sweep.
   *
   * `day` es el inicio del día en hora LOCAL, calculado por el cliente
   * (patrón de catchups: el backend nunca decide qué día es hoy).
   * `open` está desnormalizado (true = sin resolver ni promover) porque
   * Convex no indexa bien los opcionales undefined.
   */
  imprevistos: defineTable({
    title: v.string(),
    /** Día de surgimiento (ms, medianoche local). La métrica cuenta por acá. */
    day: v.number(),
    order: v.number(),
    /** true mientras no esté resuelto ni promovido (alimenta la sección "abiertos"). */
    open: v.boolean(),
    /** Cuándo se tachó (resolve). Undefined = abierto. */
    resolvedAt: v.optional(v.number()),
    /** Cuándo se promovió a tarea real del tablero. */
    promotedAt: v.optional(v.number()),
    /** Tarea creada al promover (para saltar del imprevisto a su tarea). */
    promotedTaskId: v.optional(v.id("tasks")),
    // ===== Sync ClickUp (subtask del padre "Imprevistos Cris") =====
    /** id de la subtask en ClickUp. Vacío = pendiente de sync. */
    clickupSubtaskId: v.optional(v.string()),
    clickupUrl: v.optional(v.string()),
    /** Último error de sync (vacío = ok). Se muestra en la UI del panel. */
    clickupSyncError: v.optional(v.string()),
    clickupSyncedAt: v.optional(v.number()),
    /**
     * Lock optimista del sync: timestamp de cuando una corrida tomó esta fila
     * (create o promote). Con alta rápida seguida, dos sweeps solapados podían
     * crear la subtask DOS veces en ClickUp. Con TTL: si la corrida murió a
     * mitad, el claim caduca solo.
     */
    clickupSyncClaim: v.optional(v.number()),
    /** Borrado lógico: timestamp cuando se eliminó, o undefined si está activo. */
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_day", ["day", "order"])
    .index("by_open", ["open", "day"]),

  // ===== Panel Hoy: tareas planeadas del día =====
  /**
   * Un dayItem es un PUNTERO "esta tarea está en la lista del día X". No
   * cambia nada de la tarea: ni estado, ni order del tablero, ni ClickUp.
   * El check del panel completa la tarea con el flujo estándar; este registro
   * existe para el orden dentro del día y para la métrica plan-vs-real.
   *
   * Borrado lógico a propósito: quitar una tarea del día NO borra el dato
   * histórico de que fue planeada ese día (los insights lo necesitan).
   * `carriedFrom` marca los ítems traídos de otro día ("traer pendientes de
   * ayer"): la métrica de imprevistos cuenta cada surgimiento una sola vez.
   */
  dayItems: defineTable({
    /** Día de la lista (ms, medianoche local, igual que imprevistos.day). */
    day: v.number(),
    taskId: v.id("tasks"),
    order: v.number(),
    /** dayItem original si este ítem fue traído de otro día. */
    carriedFrom: v.optional(v.id("dayItems")),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_day", ["day", "order"])
    .index("by_task", ["taskId", "day"]),

  // ===== Repertorio de piano =====
  /**
   * Canciones del repertorio de piano de Cris. Independiente de `tasks`:
   * una canción no es una tarea (sin área, estimate ni dueDate). Tiene su
   * propio ciclo de vida con estados de aprendizaje.
   */
  songs: defineTable({
    title: v.string(),
    /** Intérprete original (si difiere del compositor). */
    artist: v.optional(v.string()),
    /** Autor/compositor de la obra. */
    composer: v.optional(v.string()),
    /** Género musical (texto libre: "neoclásica", "alternative rock", ...). */
    genre: v.optional(v.string()),
    /** Clasificación temática del repertorio. */
    category: v.union(
      v.literal("clasica"),
      v.literal("cine"),
      v.literal("rock"),
      v.literal("pop"),
      v.literal("indie"),
    ),
    /** Estado de aprendizaje. */
    status: v.union(
      v.literal("por-empezar"),
      v.literal("aprendiendo"),
      v.literal("en-pausa"),
      v.literal("dominada"),
    ),
    /** Tempo en pulsos por minuto. */
    bpm: v.optional(v.number()),
    /** Tonalidad (ej. "C minor", "Am"). */
    keySignature: v.optional(v.string()),
    /** Dificultad subjetiva 1-5. */
    difficulty: v.optional(v.number()),
    /** URL de referencia (tutorial, partitura, video). */
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
    order: v.number(),
    /** Borrado lógico: timestamp cuando se eliminó, o undefined si está activa. */
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_category", ["category", "order"])
    .index("by_status", ["status", "order"]),

  // ===== Sesiones (token opaco, 30 días) =====
  sessions: defineTable({
    token: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index("by_token", ["token"]),

  // ===== Capa agente: corridas de ZCode =====
  /**
   * Una fila por corrida del agente sobre una tarea (incluye re-despachos y
   * seguimientos con --resume). Es la evidencia cronológica: qué modelo, en
   * qué carpeta, con qué autonomía, qué resumen dejó y cómo terminó.
   */
  agentRuns: defineTable({
    taskId: v.id("tasks"),
    /** Sesión ZCode de esta corrida (sess_...); vacía si el spawn falló. */
    sessionId: v.optional(v.string()),
    /** true si esta corrida retomó la sesión anterior (--resume). */
    resumed: v.optional(v.boolean()),
    state: v.union(
      v.literal("despachada"),
      v.literal("trabajando"),
      v.literal("pregunta"),
      v.literal("para-revision"),
      v.literal("hecho"),
      v.literal("error"),
      v.literal("cancelada"),
    ),
    autonomy: v.optional(v.string()),
    workspacePath: v.optional(v.string()),
    model: v.optional(v.string()),
    /** Resumen de lo hecho que el agente reporta (o el watchdog extrae). */
    summary: v.optional(v.string()),
    /**
     * Pasos reportados por el agente (protocolo --step): se van AGREGANDO
     * mientras la corrida avanza y se muestran como checklist en la app.
     * Tope 20 entradas (las viejas se descartan).
     */
    progressLog: v.optional(
      v.array(v.object({ at: v.number(), text: v.string() })),
    ),
    /**
     * Plan declarado por el agente al arrancar (protocolo --plan): los pasos
     * que INTENTA hacer. La UI lo muestra como roadmap con la posición actual
     * derivada de progressLog (paso N de M). ≤10 pasos × 120 chars.
     */
    plan: v.optional(v.array(v.string())),
    /**
     * Actividad en vivo detectada por el puente leyendo el transcript de la
     * sesión (última acción del agente entre pasos explícitos).
     */
    lastActivity: v.optional(v.string()),
    lastActivityAt: v.optional(v.number()),
    activityCount: v.optional(v.number()),
    /** Marcada por el watchdog: la corrida lleva demasiado sin actividad. */
    stalled: v.optional(v.boolean()),
    /** Digest corto del prompt despachado (para auditar qué se le pidió). */
    promptDigest: v.optional(v.string()),
    /** Contexto extra del seguimiento (respuesta de Cris, feedback). */
    followUp: v.optional(v.string()),
    exitCode: v.optional(v.number()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_task", ["taskId", "startedAt"])
    .index("by_state", ["state", "startedAt"]),

  // ===== Capa agente: registro de carpetas de trabajo =====
  /**
   * Carpetas donde el agente puede trabajar, con la clase explícita:
   * `vcs: git` → repos de git_provisorio (flujo Git completo);
   * `vcs: ninguno` → carpetas locales de reportes Power BI (C:\mcp_servers;
   *   prohibido git: ni .md ni .pbix se versionan).
   * La UI solo ofrece carpetas compatibles con el taskType, y el backend
   * valida la combinación (CONTRATO_AGENTE.md §4).
   */
  agentWorkspaces: defineTable({
    label: v.string(),
    /** Ruta absoluta en el PC de Cris (donde corre el puente). */
    path: v.string(),
    area: v.union(
      v.literal("patagonia"),
      v.literal("datacef"),
      v.literal("personal"),
    ),
    vcs: v.union(v.literal("git"), v.literal("ninguno")),
    /** Tipos de tarea que pueden despacharse acá (vacío = cualquier tipo sin carpeta exigida). */
    types: v.optional(
      v.array(
        v.union(
          v.literal("reporte"),
          v.literal("desarrollo"),
          v.literal("analisis"),
          v.literal("ops"),
          v.literal("otro"),
        ),
      ),
    ),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_area", ["area", "label"]),

  // ===== Settings (clave-valor) =====
  // No guarda contraseñas. Reservado para configuración futura.
  settings: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // ===== Challenges de login (challenge-response RSA) =====
  // El backend emite un nonce aleatorio por intento de login. El cliente lo
  // firma con la CLAVE PRIVADA (rsa_key.p8) y el servidor verifica la firma
  // contra la CLAVE PÚBLICA (HERMES_RSA_PUBLIC_KEY).
  // ⚅ De un solo uso: se consume al verificar, caduca a los 60 s.
  challenges: defineTable({
    challenge: v.string(),
    expiresAt: v.number(),
    used: v.boolean(),
    createdAt: v.number(),
  }).index("by_challenge", ["challenge"]),

  // ===== Correos (ingesta Outlook → Power Automate) =====
  /**
   * Bandeja de entrada selectiva: Power Automate reenvía por webhook los
   * correos que Cris marca como importantes. `messageId` (internetMessageId
   * de Outlook) es la clave de idempotencia: el webhook se redispara al
   * editar el correo y NO debe duplicar la fila ni resetear su avance
   * (estado/tareaId/procesadoEn son intocables en el update).
   * Única puerta de escritura: HTTP action `/correos/ingesta` con token
   * (la mutation es interna, ningún cliente puede escribir directo).
   */
  correos: defineTable({
    /** internetMessageId de Outlook: clave de idempotencia del webhook. */
    messageId: v.string(),
    /** Id del mensaje en Graph, para volver a consultarlo. */
    graphId: v.string(),
    conversationId: v.optional(v.string()),
    /** Timestamp de recepción del correo (epoch ms; filtrable por rango). */
    recibidoEn: v.number(),
    remitenteEmail: v.optional(v.string()),
    remitenteNombre: v.optional(v.string()),
    asunto: v.optional(v.string()),
    /** Texto plano (ya convertido desde HTML), truncado a 100k chars. */
    cuerpo: v.string(),
    tieneAdjuntos: v.boolean(),
    adjuntos: v.optional(
      v.array(
        v.object({
          nombre: v.string(),
          tipo: v.optional(v.string()),
          tamano: v.optional(v.number()),
        }),
      ),
    ),
    webLink: v.optional(v.string()),
    categorias: v.optional(v.array(v.string())),
    estado: v.union(
      v.literal("nuevo"),
      v.literal("procesado"),
      v.literal("descartado"),
    ),
    /** Tarea generada a partir de este correo (al pasar a "procesado"). */
    tareaId: v.optional(v.id("tasks")),
    procesadoEn: v.optional(v.number()),
    actualizadoEn: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_estado", ["estado", "recibidoEn"]),
});
