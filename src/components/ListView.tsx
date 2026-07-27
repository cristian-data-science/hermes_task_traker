import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { Doc } from "~/convex/_generated/dataModel";
import { AREAS, AREA_META, type Area } from "../lib/constants";
import { TaskCard } from "./TaskCard";
import { useSubtaskCounts } from "../hooks/useSubtaskCounts";
import { cn } from "../lib/utils";

interface ListViewProps {
  tasks: Doc<"tasks">[];
  onEditTask: (task: Doc<"tasks">) => void;
  onNewTask: (area: Area) => void;
}

export function ListView({ tasks, onEditTask, onNewTask }: ListViewProps) {
  const counts = useSubtaskCounts();

  // Agrupar por área
  const byArea = useMemo(() => {
    const map: Record<string, Doc<"tasks">[]> = {};
    for (const a of AREAS) map[a] = [];
    for (const t of tasks) {
      if (map[t.area]) map[t.area].push(t);
    }
    // Ordenar: no completadas primero, luego por orden
    for (const a of AREAS) {
      map[a].sort((x, y) => {
        if ((x.status === "completado") !== (y.status === "completado")) {
          return x.status === "completado" ? 1 : -1;
        }
        return x.order - y.order;
      });
    }
    return map;
  }, [tasks]);

  return (
    <div className="mx-auto max-w-4xl space-y-3 px-1">
      {AREAS.map((area) => (
        <AreaGroup
          key={area}
          area={area}
          tasks={byArea[area]}
          counts={counts}
          onEditTask={onEditTask}
          onNewTask={() => onNewTask(area)}
        />
      ))}
    </div>
  );
}

/** Grupo de tareas de un área (plegable, estilo Notion). */
function AreaGroup({
  area,
  tasks,
  counts,
  onEditTask,
  onNewTask,
}: {
  area: Area;
  tasks: Doc<"tasks">[];
  counts: Record<string, { done: number; total: number }>;
  onEditTask: (t: Doc<"tasks">) => void;
  onNewTask: () => void;
}) {
  const [open, setOpen] = useState(true);
  const meta = AREA_META[area];
  const pending = tasks.filter((t) => t.status !== "completado").length;

  return (
    <div className="card overflow-hidden">
      {/* Header plegable */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
      >
        <motion.span animate={{ rotate: open ? 0 : -90 }}>
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </motion.span>
        <span className="text-lg">{meta.emoji}</span>
        <h2 className="flex-1 text-base font-semibold text-slate-900 dark:text-slate-100">
          {meta.label}
        </h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {pending} activas · {tasks.length} total
        </span>
      </button>

      {/* Tareas */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="space-y-2 border-t border-slate-100 p-3 dark:border-slate-800">
              {tasks.length === 0 ? (
                <p className="px-2 py-4 text-center text-sm text-slate-400">
                  Sin tareas en esta área
                </p>
              ) : (
                tasks.map((task) => (
                  <TaskCard
                    key={task._id}
                    task={task}
                    subtaskCount={counts[task._id]}
                    onClick={() => onEditTask(task)}
                    variant="list"
                  />
                ))
              )}
              <button
                onClick={onNewTask}
                className={cn(
                  "mt-1 w-full rounded-lg border border-dashed border-slate-200 py-2 text-sm text-slate-400 transition-colors",
                  "hover:border-slate-300 hover:bg-slate-50 hover:text-slate-600",
                  "dark:border-slate-700 dark:hover:border-slate-600 dark:hover:bg-slate-800/50",
                )}
              >
                + Nueva tarea en {meta.label}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
