import { motion } from "framer-motion";
import {
  LayoutGrid,
  List as ListIcon,
  Plus,
  Moon,
  Sun,
  Search,
  LogOut,
  CheckCircle2,
} from "lucide-react";
import {
  AREAS,
  STATUSES,
  AREA_META,
  STATUS_META,
  type Area,
  type Status,
} from "../lib/constants";
import { cn } from "../lib/utils";

export type ViewMode = "kanban" | "list";

interface ToolbarProps {
  view: ViewMode;
  onViewChange: (v: ViewMode) => void;
  search: string;
  onSearchChange: (s: string) => void;
  areaFilter: Area | "all";
  onAreaFilterChange: (a: Area | "all") => void;
  statusFilter: Status | "all";
  onStatusFilterChange: (s: Status | "all") => void;
  onNewTask: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  onLogout: () => void;
  userEmail?: string;
  totalCount: number;
  pendingCount: number;
}

export function Toolbar({
  view,
  onViewChange,
  search,
  onSearchChange,
  areaFilter,
  onAreaFilterChange,
  statusFilter,
  onStatusFilterChange,
  onNewTask,
  isDark,
  onToggleTheme,
  onLogout,
  totalCount,
  pendingCount,
}: ToolbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur-lg dark:border-slate-800 dark:bg-slate-950/80">
      <div className="mx-auto max-w-7xl px-4 py-3">
        {/* Fila 1: branding + acciones */}
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
              <CheckCircle2 className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-bold leading-tight text-slate-900 dark:text-white">
                Hermes
              </h1>
              <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                {pendingCount} activas · {totalCount} total
              </p>
            </div>
          </div>

          {/* Buscador */}
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar tareas…"
              className="input pl-9"
            />
          </div>

          {/* Acciones derecha */}
          <div className="flex items-center gap-1.5">
            {/* Conmutador vista */}
            <div className="flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
              <ViewButton
                active={view === "kanban"}
                onClick={() => onViewChange("kanban")}
                icon={<LayoutGrid className="h-4 w-4" />}
                label="Tablero"
              />
              <ViewButton
                active={view === "list"}
                onClick={() => onViewChange("list")}
                icon={<ListIcon className="h-4 w-4" />}
                label="Lista"
              />
            </div>

            <button
              onClick={onToggleTheme}
              className="btn-ghost p-2"
              title={isDark ? "Modo claro" : "Modo oscuro"}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button onClick={onNewTask} className="btn-primary">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nueva</span>
            </button>

            <button
              onClick={onLogout}
              className="btn-ghost p-2 text-slate-400 hover:text-red-500"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Fila 2: filtros */}
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <FilterChip
            active={areaFilter === "all"}
            onClick={() => onAreaFilterChange("all")}
          >
            Todas las áreas
          </FilterChip>
          {AREAS.map((a) => (
            <FilterChip
              key={a}
              active={areaFilter === a}
              onClick={() => onAreaFilterChange(a)}
            >
              {AREA_META[a].emoji} {AREA_META[a].label}
            </FilterChip>
          ))}

          <span className="mx-1 h-4 w-px bg-slate-200 dark:bg-slate-700" />

          <FilterChip
            active={statusFilter === "all"}
            onClick={() => onStatusFilterChange("all")}
          >
            Todos los estados
          </FilterChip>
          {STATUSES.map((s) => (
            <FilterChip
              key={s}
              active={statusFilter === s}
              onClick={() => onStatusFilterChange(s)}
            >
              {STATUS_META[s].emoji} {STATUS_META[s].label}
            </FilterChip>
          ))}
        </div>
      </div>
    </header>
  );
}

function ViewButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-all",
        active
          ? "text-slate-900 dark:text-white"
          : "text-slate-500 hover:text-slate-700 dark:text-slate-400",
      )}
    >
      {active && (
        <motion.span
          layoutId="view-pill"
          className="absolute inset-0 rounded-md bg-white shadow-sm dark:bg-slate-700"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
      <span className="relative flex items-center gap-1.5">
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </span>
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
        active
          ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-400 dark:bg-indigo-950/40 dark:text-indigo-300"
          : "border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800",
      )}
    >
      {children}
    </button>
  );
}
