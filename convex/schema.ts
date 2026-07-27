import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * Modelo de datos de Hermes Task Tracker
 *
 * Basado en el archivo tareas-pendientes.md:
 *  - Áreas (Patagonia 💼 / Datacef 🏢 / Personal 🏠)
 *  - Estados (🔴 Urgente, 🟡 Pendiente, 🟢 Baja, ⏸️ Standby, 📅 Programado, ✅ Completado)
 *  - Tareas con notas, estimación, fecha de entrega, progreso
 *  - Sub-tareas con checkbox y fecha de completado
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
  // Tablas internas de Convex Auth (usuarios, sesiones, cuentas, verificación)
  ...authTables,
  tasks: defineTable({
    /** Título de la tarea */
    title: v.string(),
    /** Área a la que pertenece */
    area: v.union(
      v.literal("patagonia"),
      v.literal("datacef"),
      v.literal("personal"),
    ),
    /** Estado actual de la tarea */
    status: v.union(
      v.literal("urgente"),
      v.literal("pendiente"),
      v.literal("baja"),
      v.literal("standby"),
      v.literal("programado"),
      v.literal("completado"),
    ),
    /** Texto libre (notas, criterios, detalles) */
    notes: v.optional(v.string()),
    /** Estimación de tiempo, ej. "30 min", "~4-6 h", "por definir" */
    estimate: v.optional(v.string()),
    /** Fecha de entrega (texto libre, ej. "2026-07-29", "mañana", "por confirmar") */
    dueDate: v.optional(v.string()),
    /** Progreso 0-100, ej. 50 */
    progress: v.optional(v.number()),
    /** Standby: desde cuándo está en pausa */
    standbyFrom: v.optional(v.string()),
    /** Standby: fecha en que pasa a Pendiente */
    standbyUntil: v.optional(v.string()),
    /** Fechas programadas (texto libre, ej. "29 y 30 de julio 2026") */
    scheduledDates: v.optional(v.string()),
    /** Quién la solicitó / persona involucrada */
    requestedBy: v.optional(v.string()),
    /** Orden dentro de su estado (para el Kanban) */
    order: v.number(),
    /** Fecha de completado (ISO) */
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Índices para consultas frecuentes
    .index("by_status", ["status", "order"])
    .index("by_area", ["area", "order"])
    .index("by_area_status", ["area", "status", "order"]),

  subtasks: defineTable({
    /** Tarea padre */
    taskId: v.id("tasks"),
    /** Título de la sub-tarea */
    title: v.string(),
    /** ¿Está completada? */
    done: v.boolean(),
    /** Fecha de completado (ISO) */
    completedAt: v.optional(v.number()),
    /** Orden dentro de la tarea padre */
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Sub-tareas de una tarea, ordenadas
    .index("by_task", ["taskId", "order"]),
});
