import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import {
  LayoutGrid,
  List as ListIcon,
  CalendarDays,
  Plus,
  Search,
  X,
  LogOut,
  Settings,
  RefreshCw,
} from "lucide-react";
import {
  AREAS,
  STATUSES,
  AREA_META,
  STATUS_META,
  type Area,
  type Status,
} from "../lib/constants";
import { THEMES, THEME_META, type ThemeId } from "../hooks/useTheme";
import { cn } from "../lib/utils";

export type ViewMode = "kanban" | "list" | "calendar";

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
  theme: ThemeId;
  onThemeChange: (t: ThemeId) => void;
  onLogout: () => void;
  totalCount: number;
  pendingCount: number;
  onOpenSettings: () => void;
  onOpenInboundSync: () => void;
}

/** Logo de Cris Agent Task: prompt de terminal + cursor. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "grid shrink-0 place-items-center rounded-el border-el border-line bg-accent text-acfg shadow-el",
        className ?? "h-8 w-8",
      )}
    >
      <svg viewBox="0 0 24 24" className="h-[62%] w-[62%]" fill="none">
        <path
          d="M5 6l6 6-6 6"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="13" y="16" width="7" height="3" rx="0.5" fill="currentColor" />
      </svg>
    </div>
  );
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
  theme,
  onThemeChange,
  onLogout,
  totalCount,
  pendingCount,
  onOpenSettings,
  onOpenInboundSync,
}: ToolbarProps) {
  return (
    <header
      className="sticky top-0 z-30 border-b border-line backdrop-blur-lg"
      style={{ background: "color-mix(in srgb, var(--surface) 86%, transparent)" }}
    >
      <div className="mx-auto max-w-[1600px] px-3 py-2.5 sm:px-6 sm:py-3 lg:px-8">
        {/* Fila 1: branding + acciones */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <BrandMark />
            <div className="hidden md:block">
              <h1 className="font-display text-sm font-bold uppercase leading-tight tracking-wide text-ink">
                Cris Agent <span className="text-accent">Task</span>
              </h1>
              <p className="text-[11px] leading-tight text-mute">
                {pendingCount} activas · {totalCount} total
              </p>
            </div>
          </div>

          {/* Buscador (desktop) */}
          <div className="relative hidden max-w-md flex-1 sm:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <input
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Buscar tareas…"
              className="input pl-9 pr-8"
            />
            {search && (
              <button
                type="button"
                onClick={() => onSearchChange("")}
                aria-label="Limpiar búsqueda"
                className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:bg-panel2 hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            {/* Conmutador vista */}
            <div className="flex rounded-el border-el border-line bg-panel2 p-0.5">
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
              <ViewButton
                active={view === "calendar"}
                onClick={() => onViewChange("calendar")}
                icon={<CalendarDays className="h-4 w-4" />}
                label="Calendario"
              />
            </div>

            {/* Selector de tema (4 temas) */}
            <ThemeSwitcher theme={theme} onThemeChange={onThemeChange} />

            {/* Sync reversa desde ClickUp */}
            <button
              onClick={onOpenInboundSync}
              className="btn-ghost p-2 hover:text-accent"
              title="Sincronizar desde ClickUp"
              aria-label="Sincronizar desde ClickUp"
            >
              <RefreshCw className="h-4 w-4" />
            </button>

            <button
              onClick={onOpenSettings}
              className="btn-ghost p-2 hover:text-accent"
              title="Configuración ClickUp"
              aria-label="Configuración ClickUp"
            >
              <Settings className="h-4 w-4" />
            </button>

            <button onClick={onNewTask} className="btn-primary px-2.5 sm:px-3.5">
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nueva</span>
            </button>

            <button
              onClick={onLogout}
              className="btn-ghost hidden p-2 hover:text-danger sm:inline-flex"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Fila 2 (solo móvil): buscador full-width */}
        <div className="relative mt-2 sm:hidden">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar tareas…"
            className="input pl-9 pr-8"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-faint transition-colors hover:bg-panel2 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Fila 3: filtros con scroll horizontal en móvil */}
        <div className="no-scrollbar -mx-3 mt-2.5 flex items-center gap-1.5 overflow-x-auto px-3 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
          <FilterChip
            active={areaFilter === "all"}
            onClick={() => onAreaFilterChange("all")}
          >
            Todas las áreas
          </FilterChip>
          {AREAS.map((a) => {
            const meta = AREA_META[a];
            return (
              <FilterChip
                key={a}
                active={areaFilter === a}
                onClick={() => onAreaFilterChange(a)}
                tone={meta.tone}
              >
                <meta.Icon className="h-3.5 w-3.5" />
                {meta.label}
              </FilterChip>
            );
          })}

          <span className="mx-1 h-4 w-px shrink-0 bg-line" />

          <FilterChip
            active={statusFilter === "all"}
            onClick={() => onStatusFilterChange("all")}
          >
            Todos los estados
          </FilterChip>
          {STATUSES.map((s) => {
            const meta = STATUS_META[s];
            return (
              <FilterChip
                key={s}
                active={statusFilter === s}
                onClick={() => onStatusFilterChange(s)}
                tone={meta.tone}
              >
                <meta.Icon className="h-3.5 w-3.5" />
                {meta.label}
              </FilterChip>
            );
          })}

          {/* Accesos rápidos en móvil al final de los chips */}
          <button
            onClick={onLogout}
            className="chip shrink-0 sm:hidden"
            title="Cerrar sesión"
          >
            <LogOut className="h-3.5 w-3.5" />
            Salir
          </button>
        </div>
      </div>
    </header>
  );
}

/** Selector segmentado de los 4 temas. */
function ThemeSwitcher({
  theme,
  onThemeChange,
}: {
  theme: ThemeId;
  onThemeChange: (t: ThemeId) => void;
}) {
  return (
    <div className="flex rounded-el border-el border-line bg-panel2 p-0.5">
      {THEMES.map((t) => {
        const meta = THEME_META[t];
        const active = theme === t;
        return (
          <button
            key={t}
            onClick={() => onThemeChange(t)}
            title={`Tema ${meta.label}`}
            aria-pressed={active}
            className={cn(
              "relative rounded-el p-1.5 transition-colors",
              active ? "text-acfg" : "text-mute hover:text-ink",
            )}
          >
            {active && (
              <motion.span
                layoutId="theme-pill"
                className="absolute inset-0 rounded-el bg-accent"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <meta.Icon className="relative h-4 w-4" />
          </button>
        );
      })}
    </div>
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
        "relative flex items-center gap-1.5 rounded-el px-2.5 py-1.5 text-xs font-semibold transition-colors",
        active ? "text-ink" : "text-mute hover:text-ink",
      )}
    >
      {active && (
        <motion.span
          layoutId="view-pill"
          className="absolute inset-0 rounded-el bg-panel shadow-el ring-1 ring-line"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
        />
      )}
      <span className="relative flex items-center gap-1.5">
        {icon}
        <span className="hidden lg:inline">{label}</span>
      </span>
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  tone,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      onClick={onClick}
      style={tone ? ({ "--tone": tone } as CSSProperties) : undefined}
      className={cn(
        "chip shrink-0",
        active && (tone ? "tone-chip px-2.5 py-[0.28rem] text-xs" : "chip-active"),
      )}
    >
      {children}
    </motion.button>
  );
}
