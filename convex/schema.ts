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
    /** Ejecutor responsable: Cris (tú) o Claw (agente Hermes). */
    executor: v.optional(
      v.union(v.literal("cris"), v.literal("claw")),
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
    /** Último error de sync (vacío = ok). Se muestra en la UI como aviso. */
    clickupSyncError: v.optional(v.string()),
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
    /** Nota corta del porqué se marcó (qué querés conversar de esta tarea). */
    catchupNote: v.optional(v.string()),
    /** Cuándo se marcó, para ubicarla en la semana correcta. */
    catchupFlaggedAt: v.optional(v.number()),
  })
    .index("by_status", ["status", "order"])
    .index("by_area", ["area", "order"])
    .index("by_area_status", ["area", "status", "order"])
    .index("by_clickup_id", ["clickupId"]),

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
         * Es lo que permite reconstruir el linaje ("esto lo venís prometiendo
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

  // ===== Sesiones (token opaco, 30 días) =====
  sessions: defineTable({
    token: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
  }).index("by_token", ["token"]),

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
});
