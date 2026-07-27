import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Modelo de datos de Hermes Task Tracker
 *
 * Basado en el archivo tareas-pendientes.md:
 *  - Áreas (Patagonia 💼 / Datacef 🏢 / Personal 🏠)
 *  - Estados (🔴 Urgente, 🟡 Pendiente, 🟢 Baja, ⏸️ Standby, 📅 Programado, ✅ Completado)
 *  - Tareas con notas, estimación, fecha de entrega, progreso
 *  - Sub-tareas con checkbox y fecha de completado
 *
 * Auth: simple, vía PIN (variable de entorno HERMES_PIN). Sin tablas de auth.
 */

export const areas = ["patagonia", "datacef", "personal"] as const;
export type Area = (typeof areas)[number];

export const statuses = [
  "urgente",
  "pendiente",
  "baja",
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
      v.literal("baja"),
      v.literal("standby"),
      v.literal("programado"),
      v.literal("completado"),
    ),
    notes: v.optional(v.string()),
    estimate: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    progress: v.optional(v.number()),
    standbyFrom: v.optional(v.string()),
    standbyUntil: v.optional(v.string()),
    scheduledDates: v.optional(v.string()),
    requestedBy: v.optional(v.string()),
    order: v.number(),
    completedAt: v.optional(v.number()),
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
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_task", ["taskId", "order"]),
});
