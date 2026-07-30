/**
 * Snapshot inicial de tareas, parseadas del archivo
 * C:\Users\patag\hermes\tareas-pendientes.md (última actualización 22-jul-2026).
 *
 * Este archivo alimenta al script `scripts/seed.ts`.
 * Ejecutar con:  npm run seed
 */

export type SeedTask = {
  title: string;
  area: "patagonia" | "datacef" | "personal";
  status:
    | "urgente"
    | "pendiente"
    | "en-curso"
    | "standby"
    | "programado"
    | "completado";
  notes?: string;
  /** Ejecutor: "cris" (tú, por defecto) o "claw" (agente Hermes). */
  executor?: "cris" | "claw";
  estimate?: string;
  dueDate?: string;
  progress?: number;
  standbyFrom?: string;
  standbyUntil?: string;
  scheduledDates?: string;
  requestedBy?: string;
  completedAt?: number;
  subtasks?: { title: string; done: boolean }[];
};

// Helper para fechas de completado del .md (formato YYYY-MM-DD → timestamp)
function d(s: string): number {
  return new Date(s + "T12:00:00").getTime();
}

export const SEED_TASKS: SeedTask[] = [
  // ============================================================
  // 💼 TRABAJO PATAGONIA
  // ============================================================
  {
    title: "Ley de Datos",
    area: "patagonia",
    status: "pendiente",
    subtasks: [
      { title: "Terminar despliegue de app", done: false },
      { title: "Módulo de usuarios", done: false },
      { title: "Crear todas las áreas", done: false },
      { title: "Agregar proyecto y desglose a ClickUp", done: false },
      { title: "Entender la ley a fondo", done: false },
    ],
  },
  {
    title: "Subir todos mis proyectos a ClickUp",
    area: "patagonia",
    status: "pendiente",
    progress: 50,
    notes:
      "Criterio: registrar cada tarea con estimación de tiempo y fecha de entrega.",
    estimate: "por definir",
    dueDate: "por definir",
    subtasks: [
      {
        title:
          "Subir todos mis proyectos a ClickUp (incluye tareas de Patagonia)",
        done: true,
      },
    ],
  },
  {
    title: "Levantantar OSC Inventory en Render",
    area: "patagonia",
    status: "pendiente",
    notes:
      "Definir en qué parte de ClickUp va este proyecto (reunión mesa técnica jueves 24 de julio).",
    estimate: "por definir",
    dueDate: "por definir",
    subtasks: [
      { title: "Levantantar OSC Inventory en Render", done: false },
    ],
  },
  {
    title: 'Cambiar a desplegable campo "tipo" de hoja Infraestructura & Cloud',
    area: "patagonia",
    status: "completado",
    completedAt: d("2026-07-23"),
    subtasks: [
      {
        title:
          'Cambiar a desplegable campo "tipo" de hoja Infraestructura & Cloud',
        done: true,
      },
    ],
  },
  {
    title: "Proyección de Demanda",
    area: "patagonia",
    status: "standby",
    standbyFrom: "08-jul-2026",
    standbyUntil: "29-jul-2026",
  },
  {
    title: "Migración Snowflake + PowerBI → nueva autenticación",
    area: "patagonia",
    status: "programado",
    scheduledDates: "29 y 30 de julio 2026",
  },
  {
    title: "El Sale",
    area: "patagonia",
    status: "programado",
    scheduledDates: "30 de julio al 16 de agosto de 2026",
    notes: "⭐ Fecha importante",
  },
  {
    title: "Formulario Infraestructura Actual (Patagonia Chile → USA)",
    area: "patagonia",
    status: "completado",
    completedAt: d("2026-07-15"),
    subtasks: [
      { title: "Llenar formulario de infraestructura actual", done: true },
    ],
  },
  {
    title: "Reporte unidades vendidas por canal retail (2023 a la fecha)",
    area: "patagonia",
    status: "completado",
    completedAt: d("2026-07-13"),
    subtasks: [
      {
        title:
          "Unidades vendidas por canal retail (suma de todas las tiendas) a nivel año, 2023 a la fecha",
        done: true,
      },
      {
        title: "Mismo dato agrupado por año-mes (retail general), 2023 a la fecha",
        done: true,
      },
    ],
  },
  {
    title: "Enviar resultado de queries a J y Z",
    area: "patagonia",
    status: "completado",
    completedAt: d("2026-07-14"),
    notes: "Mandar correo a Jota y Z con el resultado de las queries.",
    subtasks: [
      {
        title:
          "Mandar correo a Jota y Z con el resultado de las queries de unidades vendidas retail",
        done: true,
      },
    ],
  },
  {
    title: "Inventario por bodega mensual (2023 a la fecha)",
    area: "patagonia",
    status: "completado",
    completedAt: d("2026-07-14"),
    requestedBy: "equipo (vía Teams)",
    notes:
      "Formato: filas = todas las bodegas, columnas = mes-año, valores = suma de inventario (promedio mensual o foto al cierre de mes).",
    subtasks: [
      { title: "Generar reporte de inventario por bodega mensual", done: true },
    ],
  },
  {
    title: "Conversatorio Documentales Patagonia (KPI de área)",
    area: "patagonia",
    status: "programado",
    scheduledDates: "jueves 30 de julio 2026, 14:00 a 15:00 hrs",
    notes: "Primer documental: Papsura: Peak of Evil",
    subtasks: [
      {
        title: "Tomar iniciativa para setear el primer conversatorio",
        done: true,
      },
      { title: "Enviar mensaje de anuncio al equipo en Teams", done: true },
    ],
  },
  {
    title: "Onboarding de datos a la Chopa",
    area: "patagonia",
    status: "completado",
    completedAt: d("2026-07-15"),
    subtasks: [{ title: "Hacer onboarding de datos a la Chopa", done: true }],
  },
  {
    title: "Revisión de diferencias followup",
    area: "patagonia",
    status: "completado",
    completedAt: d("2026-07-22"),
    subtasks: [{ title: "Revisión de diferencias followup", done: true }],
  },
  {
    title:
      "Revisión de diferencias scorecard vs KPIs comerciales + reporte solución de diferencias",
    area: "patagonia",
    status: "completado",
    completedAt: d("2026-07-22"),
    subtasks: [
      { title: "Revisión de diferencias scorecard vs KPIs comerciales", done: true },
      { title: "Generar reporte de solución de diferencias", done: true },
    ],
  },
  {
    title: "Responder correo a Paula Vial",
    area: "patagonia",
    status: "urgente",
    estimate: "30 min",
    dueDate: "mañana (urgente)",
    subtasks: [
      { title: "Responder correo a Paula Vial sobre contacto y difusión", done: false },
    ],
  },
  {
    title: "Responder a Victoria Rosas",
    area: "patagonia",
    status: "pendiente",
    estimate: "por definir",
    dueDate: "por definir",
    subtasks: [{ title: "Responderle a Victoria Rosas", done: false }],
  },
  {
    title: "Homologar vistas Scorecard v1 al Scorecard v2",
    area: "patagonia",
    status: "pendiente",
    notes: "⚠️ Conversar con Germán al momento de priorizar esta tarea.",
    estimate: "por definir",
    dueDate: "por definir",
    subtasks: [
      { title: "Homologar las vistas del Scorecard v1 al Scorecard v2", done: false },
    ],
  },

  // ============================================================
  // 🏢 TRABAJO DATACEF
  // ============================================================
  {
    title: "Reunión Jaime Galleguillos — Entrega módulo mantención",
    area: "datacef",
    status: "completado",
    completedAt: d("2026-07-17"),
    notes:
      "Entregar módulo de mantención correctiva y preventiva. Unificar con el tablet que ya compraron.",
    subtasks: [{ title: "Entrega realizada", done: true }],
  },
  {
    title: "Test de vulnerabilidades TransApp (con créditos GLM 5.2)",
    area: "datacef",
    status: "programado",
    scheduledDates: "jueves 24 de julio 2026, en la noche",
    notes: "Aprovechar créditos restantes de GLM 5.2 antes del corte semanal.",
    estimate: "por definir",
    subtasks: [
      { title: "Correr análisis exhaustivo de vulnerabilidades en TransApp", done: false },
    ],
  },
  {
    title: "Conversar con Germán sobre reunión Zero Trust",
    area: "datacef",
    status: "urgente",
    estimate: "10 min",
    dueDate: "mañana (urgente)",
    subtasks: [
      { title: "Preguntarle a Germán si puede no estar en la reunión de Zero Trust", done: false },
    ],
  },
  {
    title: "Migración de correos de Allmarket",
    area: "datacef",
    status: "urgente",
    estimate: "~4-6 h",
    dueDate: "por confirmar con Jaime",
    notes:
      "🔔 Recordatorio: hablarle a Jaime en la mañana para agendar la hora.",
    subtasks: [
      { title: "Testeo final: mandar correos de prueba y revisar casillas", done: false },
      { title: "Crear los 2 filtros que faltan", done: false },
      { title: "Terminar el ciclo completo de la migración", done: false },
      { title: "Hablar con Jaime para agendar pruebas de validación", done: false },
      { title: "Junta de entrega con Jaime", done: false },
    ],
  },
  {
    title: "Skill de cotizaciones para Hermes",
    area: "datacef",
    status: "pendiente",
    notes:
      "Inputs: descripción del proyecto, alcance, tareas, rates/costos. Output: cotización estructurada (items, horas, precios, total).",
    subtasks: [
      { title: "Crear skill que genere cotizaciones en base a proyecto, alcance y tareas", done: false },
    ],
  },

  // ============================================================
  // 🏠 PERSONAL
  // ============================================================
  {
    title: "Arreglar app Catálogo USB (no reproduce contenido multimedia)",
    area: "personal",
    status: "pendiente",
    estimate: "por definir",
    dueDate: "por definir",
    subtasks: [
      {
        title: "Arreglar la aplicación Catálogo USB — no está reproduciendo el contenido multimedia",
        done: false,
      },
    ],
  },
  {
    title: "Comprar costillar a la señora Sonia",
    area: "personal",
    status: "completado",
    completedAt: d("2026-07-15"),
    subtasks: [{ title: "Comprar costillar a la señora Sonia", done: true }],
  },
  {
    title: 'Comprar case para SSD 2.5"',
    area: "personal",
    status: "completado",
    completedAt: d("2026-07-22"),
    subtasks: [{ title: 'Comprar case para SSD de 2.5"', done: true }],
  },
  {
    title: "Pagar parcela",
    area: "personal",
    status: "pendiente",
    notes: "Culiprán",
    estimate: "por definir",
    dueDate: "por definir",
    subtasks: [{ title: "Pagar parcela (Culiprán)", done: false }],
  },
  {
    title: "Pagar tarjeta",
    area: "personal",
    status: "pendiente",
    estimate: "por definir",
    dueDate: "por definir",
    subtasks: [{ title: "Pagar tarjeta", done: false }],
  },
  {
    title: "Pagar Banco Estado",
    area: "personal",
    status: "pendiente",
    estimate: "por definir",
    dueDate: "por definir",
    subtasks: [{ title: "Pagar Banco Estado", done: false }],
  },
  {
    title: "Pagar YouTube",
    area: "personal",
    status: "pendiente",
    notes: "Suscripción",
    estimate: "por definir",
    dueDate: "por definir",
    subtasks: [{ title: "Pagar YouTube (suscripción)", done: false }],
  },
  {
    title: "Análisis de expansión sistema solar (batería 5 kWh + 2 paneles)",
    area: "personal",
    status: "pendiente",
    notes:
      "Configuración actual: BlueEti Elite 300 + 2 paneles directo. Objetivo: determinar el mejor circuito para integrar batería de 5 kWh + 2 paneles adicionales.",
    estimate: "por definir",
    dueDate: "por definir",
    subtasks: [
      {
        title:
          "Hacer análisis/investigación sobre el mejor circuito para añadir una batería de 5 kWh y dos paneles más",
        done: false,
      },
    ],
  },
  {
    title: "Crear app dashboard personal de tareas pendientes",
    area: "personal",
    status: "completado",
    notes: "Alcance: dashboard personal que consolide el seguimiento de tareas. ✅ ¡Esta app!",
    completedAt: d("2026-07-27"),
    subtasks: [
      {
        title: "Crear una aplicación para visualizar las tareas pendientes en todas las dimensiones",
        done: true,
      },
    ],
  },
];

/** Estadísticas para mostrar en consola al ejecutar el seed. */
export function summarize(tasks: SeedTask[]) {
  const byStatus: Record<string, number> = {};
  const byArea: Record<string, number> = {};
  let subs = 0;
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    byArea[t.area] = (byArea[t.area] ?? 0) + 1;
    subs += t.subtasks?.length ?? 0;
  }
  return { total: tasks.length, subs, byStatus, byArea };
}
