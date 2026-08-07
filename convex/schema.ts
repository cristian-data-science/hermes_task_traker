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
        ancestors: v.optional(v.array(v.string())),
        resolvedAt: v.optional(v.number()),
      }),
    ),
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
