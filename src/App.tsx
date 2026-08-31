import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { AnimatePresence, motion } from "framer-motion";
import { WifiOff } from "lucide-react";
import { useAuth, AuthProvider } from "./hooks/useAuth";
import { useTheme, type ThemeId } from "./hooks/useTheme";
import { useOnlineStatus, useIsMobileLike } from "./hooks/useOnlineStatus";
import { api } from "~/convex/_generated/api";
import type { Doc } from "~/convex/_generated/dataModel";
import type { Area, Status } from "./lib/constants";
import { LoginScreen } from "./components/LoginScreen";
import { Toolbar, type ViewMode } from "./components/Toolbar";
import { KanbanView } from "./components/KanbanView";
import { ListView } from "./components/ListView";
import { CalendarView } from "./components/CalendarView";
import { CatchupView } from "./components/CatchupView";
import { TaskModal } from "./components/TaskModal";
import { AssignedInboxModal } from "./components/AssignedInboxModal";
import { ClickUpSettings } from "./components/ClickUpSettings";
import { ClickUpSyncPage } from "./components/ClickUpSyncPage";
import { ThemedBackground } from "./components/ThemedBackground";
import { Loader2, ClipboardList } from "lucide-react";
import { isSuperUrgent } from "./lib/utils";

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}

/** Capa interna: consume el contexto de auth para decidir login vs dashboard. */
function AppShell() {
  const { isLoading, isAuthenticated, signIn, signOut } = useAuth();
  const { theme, setTheme } = useTheme();

  return (
    <>
      {/* Fondo animado sutil, cambia con el tema */}
      <ThemedBackground theme={theme} />

      {isLoading ? (
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
        </div>
      ) : !isAuthenticated ? (
        <LoginScreen signIn={signIn} />
      ) : (
        <Dashboard
          theme={theme}
          onThemeChange={setTheme}
          onLogout={() => void signOut()}
        />
      )}
    </>
  );
}

/** Dashboard principal (cuando hay sesión). */
function Dashboard({
  theme,
  onThemeChange,
  onLogout,
}: {
  theme: ThemeId;
  onThemeChange: (t: ThemeId) => void;
  onLogout: () => void;
}) {
  const { token } = useAuth();
  const tasks = useQuery(api.tasks.list, token ? { sessionToken: token } : "skip") ?? [];
  const clickupState = useQuery(
    api.settings.getClickupState,
    token ? { sessionToken: token } : "skip",
  );
  const hiddenAreas = clickupState?.hiddenAreas ?? [];

  // Estado UI
  const [view, setView] = useState<ViewMode>("kanban");
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState<Area | "all">("all");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assignedInboxOpen, setAssignedInboxOpen] = useState(false);
  /** Página activa: tablero de tareas o página de sync ClickUp. */
  const [page, setPage] = useState<"board" | "clickup-sync">("board");
  const [editingTask, setEditingTask] = useState<Doc<"tasks"> | null>(null);
  const [newDefaults, setNewDefaults] = useState<{
    status?: Status;
    area?: Area;
  }>({});

  // Filtrado (incluye ocultar áreas marcadas como ocultas — solo visualización)
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hiddenSet = new Set(hiddenAreas);
    return tasks.filter((t) => {
      // Capa "súper urgente": no conversa con los filtros. Da lo mismo la
      // búsqueda, el área, el estado o que su área esté oculta: siempre se
      // muestra (y cada vista la ancla primera — ver KanbanView/ListView).
      if (isSuperUrgent(t)) return true;
      if (hiddenSet.has(t.area)) return false;
      if (areaFilter !== "all" && t.area !== areaFilter) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (q) {
        const hay = `${t.title} ${t.notes ?? ""} ${t.requestedBy ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, search, areaFilter, statusFilter, hiddenAreas]);

  const pendingCount = tasks.filter(
    (t) => t.status !== "completado" && !hiddenAreas.includes(t.area),
  ).length;

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

  // Banner offline: gate móvil — en desktop no se muestra nunca.
  const online = useOnlineStatus();
  const isMobileLike = useIsMobileLike();

  return (
    <div className={page === "clickup-sync" ? "flex h-screen flex-col overflow-hidden" : "min-h-screen"}>
      {/* Banner offline — SOLO teléfono (la web de escritorio no cambia). */}
      {!online && isMobileLike && (
        <div
          role="status"
          className="sticky top-0 z-[45] flex items-center justify-center gap-2 bg-panel2 px-3 py-1.5 text-xs font-medium text-mute"
        >
          <WifiOff className="h-3.5 w-3.5" />
          Sin conexión — reconectando…
        </div>
      )}
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
        theme={theme}
        onThemeChange={onThemeChange}
        onLogout={onLogout}
        totalCount={filteredTasks.length}
        pendingCount={pendingCount}
        hiddenAreas={hiddenAreas}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenAssignedInbox={() => setAssignedInboxOpen(true)}
      />

      <AssignedInboxModal
        open={assignedInboxOpen}
        onClose={() => setAssignedInboxOpen(false)}
      />

      {page === "clickup-sync" ? (
        <ClickUpSyncPage onBack={() => setPage("board")} />
      ) : (
      <main className="mx-auto max-w-[1600px] px-2.5 py-3 sm:px-6 sm:py-4 lg:px-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {view === "kanban" ? (
              <KanbanView
                tasks={filteredTasks}
                onEditTask={openEdit}
                onNewTask={(status) => openNew(status)}
              />
            ) : view === "list" ? (
              <ListView
                tasks={filteredTasks}
                onEditTask={openEdit}
                onNewTask={(area) => openNew(undefined, area)}
              />
            ) : view === "calendar" ? (
              <CalendarView tasks={filteredTasks} onEditTask={openEdit} />
            ) : (
              // El catch-up NO recibe `filteredTasks`: su ventana temporal y su
              // alcance de área los define él mismo. Filtrar el tablero por
              // "urgente" no debería mutilar el resumen que le presentás a tu
              // jefatura. Recibe la lista completa solo para poder abrir el
              // modal de edición desde sus filas.
              <CatchupView tasks={tasks} onEditTask={openEdit} />
            )}
          </motion.div>
        </AnimatePresence>

        {/* Estado vacío (no aplica al catch-up: tiene sus propios vacíos) */}
        {filteredTasks.length === 0 && view !== "catchup" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-20 text-center"
          >
            <ClipboardList className="mx-auto mb-3 h-10 w-10 text-faint" />
            <p className="text-lg font-medium text-mute">
              {tasks.length === 0
                ? "Aún no hay tareas"
                : "Sin resultados para los filtros"}
            </p>
            <button onClick={() => openNew()} className="btn-primary mt-4">
              Crear tu primera tarea
            </button>
          </motion.div>
        )}
      </main>
      )}

      <TaskModal
        task={editingTask}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        defaultStatus={newDefaults.status}
        defaultArea={newDefaults.area}
        hiddenAreas={hiddenAreas}
      />

      <ClickUpSettings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onGoToSync={() => setPage("clickup-sync")}
      />
    </div>
  );
}
