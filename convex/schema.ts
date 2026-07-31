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
  })
    .index("by_status", ["status", "order"])
    .index("by_area", ["area", "order"])
    .index("by_area_status", ["area", "status", "order"]),

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
