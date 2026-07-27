import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "./hooks/useAuth";
import { useTheme } from "./hooks/useTheme";
import { api } from "~/convex/_generated/api";
import type { Doc } from "~/convex/_generated/dataModel";
import type { Area, Status } from "./lib/constants";
import { LoginScreen } from "./components/LoginScreen";
import { Toolbar, type ViewMode } from "./components/Toolbar";
import { KanbanView } from "./components/KanbanView";
import { ListView } from "./components/ListView";
import { TaskModal } from "./components/TaskModal";
import { Loader2 } from "lucide-react";

export default function App() {
  const { isLoading, isAuthenticated, signIn, signOut } = useAuth();
  const { isDark, toggle } = useTheme();

  // Pantalla de carga inicial
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  // Si no está autenticado, mostrar login
  if (!isAuthenticated) {
    return <LoginScreen signIn={signIn} />;
  }

  return (
    <Dashboard
      isDark={isDark}
      onToggleTheme={toggle}
      onLogout={() => void signOut()}
    />
  );
}

/** Dashboard principal (cuando hay sesión). */
function Dashboard({
  isDark,
  onToggleTheme,
  onLogout,
}: {
  isDark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
}) {
  const tasks = useQuery(api.tasks.list, {}) ?? [];

  // Estado UI
  const [view, setView] = useState<ViewMode>("kanban");
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState<Area | "all">("all");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Doc<"tasks"> | null>(null);
  const [newDefaults, setNewDefaults] = useState<{
    status?: Status;
    area?: Area;
  }>({});

  // Filtrado
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (areaFilter !== "all" && t.area !== areaFilter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (q) {
        const hay = `${t.title} ${t.notes ?? ""} ${t.requestedBy ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, search, areaFilter, statusFilter]);

  const pendingCount = tasks.filter((t) => t.status !== "completado").length;

  function openNew(status?: Status, area?: Area) {
    setEditingTask(null);
    setNewDefaults({ status, area });
    setModalOpen(true);
  }
  function openEdit(task: Doc<"tasks">) {
    setEditingTask(task);
    setNewDefaults({});
    setModalOpen(true);
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Toolbar
        view={view}
        onViewChange={setView}
        search={search}
        onSearchChange={setSearch}
        areaFilter={areaFilter}
        onAreaFilterChange={setAreaFilter}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        onNewTask={() => openNew()}
        isDark={isDark}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
        totalCount={tasks.length}
        pendingCount={pendingCount}
      />

      <main className="mx-auto max-w-7xl px-4 py-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {view === "kanban" ? (
              <KanbanView
                tasks={filteredTasks}
                onEditTask={openEdit}
                onNewTask={(status) => openNew(status)}
              />
            ) : (
              <ListView
                tasks={filteredTasks}
                onEditTask={openEdit}
                onNewTask={(area) => openNew(undefined, area)}
              />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Estado vacío */}
        {filteredTasks.length === 0 && (
          <div className="mt-20 text-center">
            <p className="text-lg font-medium text-slate-400">
              {tasks.length === 0
                ? "Aún no hay tareas 🎉"
                : "Sin resultados para los filtros"}
            </p>
            <button onClick={() => openNew()} className="btn-primary mt-4">
              Crear tu primera tarea
            </button>
          </div>
        )}
      </main>

      <TaskModal
        task={editingTask}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultStatus={newDefaults.status}
        defaultArea={newDefaults.area}
      />
    </div>
  );
}
