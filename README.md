# 📋 Hermes Task Tracker

Dashboard personal para trackear tareas en tiempo real, con base de datos en la nube (Convex).

Permite crear, editar, cambiar estado y eliminar tareas agrupadas por área (Patagonia 💼 / Datacef 🏢 / Personal 🏠), con vistas **Kanban** y **Lista**.

## ✨ Características

- 🗄️ **Base de datos en la nube** con Convex (datos reactivos en tiempo real)
- 🔐 **Autenticación** con email + contraseña (Convex Auth / Password provider)
- 📊 **Vista Kanban** con drag & drop para cambiar estado entre 6 columnas
  (🔴 Urgente, 🟡 Pendiente, ⏸️ Standby, 📅 Programado, 🟢 Baja, ✅ Completado)
- 📝 **Vista Lista** agrupada por área, estilo Notion, plegable
- ✅ **Sub-tareas** con checkbox y fecha de completado
- 🔍 **Búsqueda** y **filtros** por área y estado
- 🎨 **Diseño moderno** con Tailwind, Framer Motion y Lucide
- 🌗 **Modo claro/oscuro** (persistente)
- 📱 **100% responsivo**

## 🛠️ Stack

- **Frontend:** React 18 + Vite + TypeScript
- **Backend:** Convex (base de datos reactiva + auth)
- **Auth:** @convex-dev/auth (Password provider)
- **Estilos:** Tailwind CSS
- **Animaciones:** Framer Motion
- **Drag & Drop:** @dnd-kit
- **Iconos:** Lucide React

## 🚀 Puesta en marcha (desarrollo)

### Requisitos previos
- Node.js 20+
- Una cuenta en [Convex](https://convex.dev) (plan gratuito)

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Inicializar Convex (solo la primera vez)
npx convex dev
#   → te pedirá elegir team y proyecto (o crear uno nuevo)

# 3. Configurar las variables de Convex Auth (genera claves JWT):
#    Se generan automáticamente con:
npx @convex-dev/auth
#    O manualmente: ver sección "Auth" más abajo.

# 4. (Opcional) Importar las tareas del snapshot inicial
npm run seed

# 5. Levantar el frontend en una terminal
npm run dev
#    → http://localhost:5173

# 6. En otra terminal, mantener Convex dev corriendo
npx convex dev
```

Abre **http://localhost:5173** → verás la pantalla de login. Crea una cuenta con
tu email + contraseña y entra al dashboard.

> ⚠️ **Importante sobre el login:** el cliente de Convex Auth usa `localStorage`
> para persistir la sesión. Si pruebas la app dentro de un navegador restringido
> (webview embebido, modo incógnito con storage bloqueado), el login puede no
> persistir. **Úsala en Chrome/Firefox/Edge normal** y funcionará correctamente.

## 🔐 Auth (Convex Auth)

El proyecto usa el provider **Password** de Convex Auth (email + contraseña).

Variables de entorno necesarias en Convex (se setean con `npx @convex-dev/auth`):
- `JWT_PRIVATE_KEY` — clave privada RSA para firmar JWT
- `JWKS` — JSON Web Key Set pública

Para activar **Google OAuth** más adelante:
1. Crea credenciales OAuth en [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Edita `convex/auth.ts` y descomenta el provider `Google`
3. Añade `GOOGLE_CLIENT_SECRET` en las variables de Convex

## 🌍 Deploy a producción

El backend se deploya con:
```bash
npx convex deploy --cmd "npm run build"
```

Para el **hosting del frontend** (static), puedes usar:
- **Vercel** (recomendado, gratis): conecta el repo de GitHub, build `npm run build`, output `dist/`
- **Netlify**, **Cloudflare Pages**: configuración equivalente
- **Convex Hosting**: `npx convex hosting`

En el hosting, setea la variable `VITE_CONVEX_URL` con la URL del deployment de
producción de Convex (ej: `https://<deployment>.convex.cloud`).

## 📂 Estructura del proyecto

```
hermes_task_traker/
├── convex/                  # Backend (funciones Convex)
│   ├── auth.ts              # Configuración de Convex Auth
│   ├── schema.ts            # Esquema de la DB (tasks, subtasks, authTables)
│   ├── tasks.ts             # CRUD + reorder + changeStatus de tareas
│   ├── subtasks.ts          # CRUD + reorder + allCounts de sub-tareas
│   ├── seed.ts              # Mutation para importar datos iniciales
│   └── _generated/          # Tipos generados por Convex (auto)
├── src/
│   ├── components/
│   │   ├── LoginScreen.tsx    # Pantalla de login
│   │   ├── Toolbar.tsx        # Header + filtros + conmutador de vistas
│   │   ├── KanbanView.tsx     # Vista Kanban con drag & drop
│   │   ├── ListView.tsx       # Vista lista agrupada por área
│   │   ├── TaskCard.tsx       # Tarjeta de tarea
│   │   ├── TaskModal.tsx      # Modal crear/editar con sub-tareas
│   │   └── Badges.tsx         # Badges de estado y área
│   ├── hooks/                 # useAuth, useTheme, useSubtaskCounts
│   ├── lib/                   # constants (estados, áreas) y utils
│   ├── App.tsx                # Componente raíz (login gating + dashboard)
│   └── main.tsx               # Entry point + providers
├── scripts/
│   ├── seed.ts                # Script de importación
│   └── seed-data.ts           # Snapshot de tareas del .md original
└── package.json
```

## 🗃️ Modelo de datos

**`tasks`**: title, area (patagonia/datacef/personal), status (6 estados),
notes, estimate, dueDate, progress, standbyFrom/Until, scheduledDates,
requestedBy, order, completedAt, timestamps.

**`subtasks`**: taskId, title, done, completedAt, order, timestamps.

---

Hecho con ❤️ para gestionar las tareas de Hermes.
