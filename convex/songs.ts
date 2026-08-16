import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireAuth } from "./authGuard";

/**
 * Repertorio de piano de Cris.
 *
 * Tabla independiente de `tasks`: las canciones no son tareas (no tienen área,
 * estimate, dueDate). Maneja su propio ciclo de vida con estados de
 * aprendizaje y metadatos musicales (género, BPM, tonalidad, autor).
 */

const sessionArg = { sessionToken: v.string() };

/** Límites de longitud para textos libres. */
const TITLE_MAX = 200;
const NOTES_MAX = 5000;

/** Estados de aprendizaje de una canción. */
const statusUnion = v.union(
  v.literal("por-empezar"),
  v.literal("aprendiendo"),
  v.literal("en-pausa"),
  v.literal("dominada"),
);

/** Categorías del repertorio (clasificación temática, no género musical). */
const categoryUnion = v.union(
  v.literal("clasica"),
  v.literal("cine"),
  v.literal("rock"),
  v.literal("pop"),
  v.literal("indie"),
);

/** Campos editables (compartidos por create y update). */
const editableFields = {
  title: v.optional(v.string()),
  artist: v.optional(v.string()),
  composer: v.optional(v.string()),
  genre: v.optional(v.string()),
  category: v.optional(categoryUnion),
  status: v.optional(statusUnion),
  bpm: v.optional(v.number()),
  keySignature: v.optional(v.string()),
  difficulty: v.optional(v.number()),
  source: v.optional(v.string()),
  notes: v.optional(v.string()),
};

/**
 * =====================
 *  QUERIES (lectura)
 * =====================
 */

/** Lista todas las canciones activas (no borradas), ordenadas por orden. */
export const list = query({
  args: sessionArg,
  handler: async (ctx, { sessionToken }): Promise<Doc<"songs">[]> => {
    await requireAuth(ctx, sessionToken);
    const all = await ctx.db.query("songs").order("asc").collect();
    return all.filter((s) => s.deletedAt === undefined);
  },
});

/** Lista canciones por categoría. */
export const listByCategory = query({
  args: { ...sessionArg, category: categoryUnion },
  handler: async (ctx, { sessionToken, category }): Promise<Doc<"songs">[]> => {
    await requireAuth(ctx, sessionToken);
    const all = await ctx.db
      .query("songs")
      .withIndex("by_category", (q) => q.eq("category", category))
      .order("asc")
      .collect();
    return all.filter((s) => s.deletedAt === undefined);
  },
});

/** Lista canciones por estado de aprendizaje. */
export const listByStatus = query({
  args: { ...sessionArg, status: statusUnion },
  handler: async (ctx, { sessionToken, status }): Promise<Doc<"songs">[]> => {
    await requireAuth(ctx, sessionToken);
    const all = await ctx.db
      .query("songs")
      .withIndex("by_status", (q) => q.eq("status", status))
      .order("asc")
      .collect();
    return all.filter((s) => s.deletedAt === undefined);
  },
});

/** Obtiene una canción por ID. */
export const get = query({
  args: { ...sessionArg, id: v.id("songs") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    return await ctx.db.get(id);
  },
});

/** Busca canciones por título, artista o compositor (insensible a mayúsculas). */
export const search = query({
  args: { ...sessionArg, term: v.string() },
  handler: async (ctx, { sessionToken, term }): Promise<Doc<"songs">[]> => {
    await requireAuth(ctx, sessionToken);
    const needle = term.toLowerCase().trim();
    const all = await ctx.db.query("songs").order("asc").collect();
    return all.filter(
      (s) =>
        s.deletedAt === undefined &&
        (s.title.toLowerCase().includes(needle) ||
          (s.artist ?? "").toLowerCase().includes(needle) ||
          (s.composer ?? "").toLowerCase().includes(needle)),
    );
  },
});

/**
 * ========================
 *  MUTATIONS (escritura)
 * ========================
 */

/** Crea una canción. `title`, `category` y `status` son obligatorios. */
export const create = mutation({
  args: {
    ...sessionArg,
    title: v.string(),
    artist: v.optional(v.string()),
    composer: v.optional(v.string()),
    genre: v.optional(v.string()),
    category: categoryUnion,
    status: statusUnion,
    bpm: v.optional(v.number()),
    keySignature: v.optional(v.string()),
    difficulty: v.optional(v.number()),
    source: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAuth(ctx, args.sessionToken);
    const now = Date.now();
    // Orden al final de la lista (cuenta activos + borrados para unicidad).
    const all = await ctx.db.query("songs").collect();
    const order = all.length;
    const id = await ctx.db.insert("songs", {
      title: args.title.slice(0, TITLE_MAX),
      artist: args.artist?.slice(0, TITLE_MAX),
      composer: args.composer?.slice(0, TITLE_MAX),
      genre: args.genre?.slice(0, TITLE_MAX),
      category: args.category,
      status: args.status,
      bpm: args.bpm,
      keySignature: args.keySignature?.slice(0, TITLE_MAX),
      difficulty: args.difficulty,
      source: args.source?.slice(0, TITLE_MAX),
      notes: args.notes?.slice(0, NOTES_MAX),
      order,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  },
});

/** Actualiza campos de una canción (cualquier subset). */
export const update = mutation({
  args: { ...sessionArg, id: v.id("songs"), patch: v.object(editableFields) },
  handler: async (ctx, { sessionToken, id, patch }) => {
    await requireAuth(ctx, sessionToken);
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    for (const [k, val] of Object.entries(patch)) {
      if (val === undefined) continue;
      updates[k] =
        typeof val === "string"
          ? val.slice(0, k === "notes" ? NOTES_MAX : TITLE_MAX)
          : val;
    }
    await ctx.db.patch(id, updates as never);
    return null;
  },
});

/** Elimina una canción (borrado lógico). */
export const remove = mutation({
  args: { ...sessionArg, id: v.id("songs") },
  handler: async (ctx, { sessionToken, id }) => {
    await requireAuth(ctx, sessionToken);
    await ctx.db.patch(id, {
      deletedAt: Date.now(),
      updatedAt: Date.now(),
    } as never);
    return null;
  },
});

/** Actualiza solo el BPM de una canción (para backfill masivo). */
export const setBpm = mutation({
  args: { ...sessionArg, id: v.id("songs"), bpm: v.number() },
  handler: async (ctx, { sessionToken, id, bpm }) => {
    await requireAuth(ctx, sessionToken);
    const bpmClamped = Math.max(0, Math.min(400, Math.round(bpm)));
    await ctx.db.patch(id, {
      bpm: bpmClamped,
      updatedAt: Date.now(),
    } as never);
    return null;
  },
});
