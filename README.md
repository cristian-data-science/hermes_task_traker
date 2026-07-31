# 📋 Hermes Task Tracker

Dashboard personal para trackear tareas en tiempo real, con base de datos en la nube (Convex).

Permite crear, editar, cambiar estado y eliminar tareas agrupadas por área (Patagonia 💼 / Datacef 🏢 / Personal 🏠), con vistas **Kanban** y **Lista**.

## ✨ Características

- 🗄️ **Base de datos en la nube** con Convex (datos reactivos en tiempo real)
- 🔐 **Acceso por clave RSA** (sin contraseña): arrastras `rsa_key.p8` para iniciar sesión
- 📊 **Vista Kanban** con drag & drop para cambiar estado entre 6 columnas
  (🔴 Urgente, 🟡 Pendiente, 🟦 En curso, ⏸️ Standby, 📅 Programado, ✅ Completado)
- 📝 **Vista Lista** agrupada por área, estilo Notion, plegable
- ✅ **Sub-tareas** con checkbox y fecha de completado
- 🔍 **Búsqueda** y **filtros** por área y estado
- 🎨 **Diseño moderno** con Tailwind, Framer Motion y Lucide
- 🌗 **Modo claro/oscuro** (persistente)
- 📱 **100% responsivo**

## 🛠️ Stack

- **Frontend:** React 18 + Vite + TypeScript
- **Backend:** Convex (base de datos reactiva + funciones serverless)
- **Auth:** challenge-response RSA (clave privada `rsa_key.p8` + clave pública en servidor) — ver sección de seguridad
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

# 3. Generar el par de claves RSA (una sola vez):
#    - rsa_key.p8 = tu CLAVE PRIVADA (guárdala; es lo que arrastras para login)
#    - rsa_pub.pem = CLAVE PÚBLICA (va al servidor como HERMES_RSA_PUBLIC_KEY)
openssl genpkey -algorithm RSA -out rsa_key.p8 -pkeyopt rsa_keygen_bits:4096
openssl rsa -in rsa_key.p8 -pubout -out rsa_pub.pem

# 4. Subir la CLAVE PÚBLICA y el token admin como secretos de Convex:
npx convex env set HERMES_RSA_PUBLIC_KEY "$(cat rsa_pub.pem)"
npx convex env set HERMES_ADMIN_TOKEN "<token-admin-aleatorio>"

# 5. Crear el archivo .env.local (copia de .env.example) con:
#    VITE_CONVEX_URL=...   (la URL que te dio `npx convex dev`)
#    HERMES_ADMIN_TOKEN=...  (el mismo que seteaste arriba, para el script local)

# 6. (Opcional) Importar las tareas del snapshot inicial
npm run seed

# 7. Levantar el frontend en una terminal
npm run dev
#    → http://localhost:5173

# 8. En otra terminal, mantener Convex dev corriendo
npx convex dev
```

Abre **http://localhost:5173** → verás la pantalla de login. **Arrastra tu
archivo `rsa_key.p8`** a la zona indicada y entrarás al dashboard.

> 🔑 **Si pierdes `rsa_key.p8`**: genera un par nuevo con los comandos de arriba
> y actualiza la clave pública en Convex (`npx convex env set HERMES_RSA_PUBLIC_KEY ...`).
> Las sesiones existentes siguen activas hasta caducar (30 días).

## 🔐 Seguridad

La app usa **acceso por clave RSA** (challenge-response, sin contraseña).
Es de uso personal.

**Cómo funciona el login:**
1. El navegador pide un **challenge** (nonce aleatorio de un solo uso, 60 s) al backend.
2. **Importa tu clave privada** (`rsa_key.p8`) con Web Crypto API **dentro del
   navegador** y **firma** el challenge. La clave privada **nunca se envía al servidor**.
3. El backend **verifica la firma** con la **clave pública** (`HERMES_RSA_PUBLIC_KEY`,
   secreto de Convex) y, si es válida, emite un **token de sesión** (32 bytes, 30 días).
4. El token se guarda en `localStorage`: **persiste en ese navegador**, pero **no**
   en incógnito ni en otros navegadores (te pedirá el `.p8` de nuevo).

**Por qué es seguro:**
- La clave privada **nunca sale de tu PC**. El servidor solo ve una firma.
- El challenge es **de un solo uso** (anti-replay) y caduca en 60 segundos.
- La firma usa **RSASSA-PKCS1-v1_5 + SHA-256** (estándar verificable).

**Protección del backend (hardening):**
- 🔒 **Cada función del backend** (queries y mutations de tasks/subtasks) verifica
  el token de sesión antes de leer o escribir datos (`convex/authGuard.ts`).
  Sin sesión válida, la operación se rechaza — la API no es invocable sin login.
- 🗑️ **Soft-delete**: borrar una tarea/sub-tarea la marca como eliminada
  (`deletedAt`) en vez de borrarla físicamente; las queries la filtran.
- 🛡️ **Seed protegido**: la mutation `resetAndSeed` (que vacía la DB) exige un
  `HERMES_ADMIN_TOKEN`; el script `npm run seed` lo pasa automáticamente.
- ✅ **Validación server-side**: `progress` se acota a 0–100 y los textos libres
  tienen límite de longitud, sin confiar en el HTML del cliente.
- 🧱 **Content-Security-Policy** en `index.html` (mitiga inyección de scripts).
- 🔇 Los **stack traces no se vuelcan a la consola en producción** (solo en DEV).

**Variables de entorno** (ver `.env.example`):
- `VITE_CONVEX_URL` — URL del deployment de Convex (pública, va al bundle del cliente).
- `HERMES_RSA_PUBLIC_KEY` — clave pública RSA (secreto en Convex; verifica el login).
- `HERMES_ADMIN_TOKEN` — token para operaciones administrativas (seed). Secreto en
  Convex **y** en `.env.local` (para uso del script local).

> ⚠️ El token de sesión vive en `localStorage`. Convex no expone un servidor
> propio para cookies `HttpOnly`. Esto cumple tu requisito: la sesión persiste
> en el navegador habitual, pero se pide el `.p8` en incógnito u otro navegador.

## 🌍 Deploy a producción

El backend se deploya con:
```bash
npx convex deploy --cmd "npm run build"
```

Antes, asegúrate de configurar los secretos de producción:
```bash
npx convex env set HERMES_RSA_PUBLIC_KEY "$(cat rsa_pub.pem)"
npx convex env set HERMES_ADMIN_TOKEN "<token-admin-producción>"
```

Para el **hosting del frontend** (static), puedes usar:
- **Vercel** (recomendado, gratis): conecta el repo de GitHub, build `npm run build`, output `dist/`
- **Netlify**, **Cloudflare Pages**: configuración equivalente
- **Convex Hosting**: `npx convex hosting`

En el hosting, setea la variable `VITE_CONVEX_URL` con la URL del deployment de
producción de Convex (ej: `https://<deployment>.convex.cloud`).

> 🔐 **Cabeceras de seguridad recomendadas en el hosting**: HSTS
> (`Strict-Transport-Security`) y `X-Frame-Options: DENY` no se pueden forzar vía
> `<meta>` en el HTML; configúralas en el panel del hosting (Vercel/Netlify/Convex).

## 📂 Estructura del proyecto

```
hermes_task_traker/
├── convex/                  # Backend (funciones Convex)
│   ├── auth.ts              # createChallenge / signInWithRsa / signOut (login RSA)
│   ├── authGuard.ts         # requireAuth / requireAdminToken (guards de autorización)
│   ├── authQuery.ts         # verifySession + helpers internos (sesiones, challenges)
│   ├── schema.ts            # Esquema de la DB (tasks, subtasks, sessions, settings, challenges)
│   ├── tasks.ts             # CRUD + reorder + changeStatus (protegidos con sesión)
│   ├── subtasks.ts          # CRUD + reorder + allCounts (protegidos con sesión)
│   ├── seed.ts              # Mutation de importación (protegida con admin token)
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
│   ├── hooks/                 # useAuth (Provider+Context, login RSA), useTheme, useSubtaskCounts
│   ├── lib/                   # constants, utils, rsa (firma del challenge en el navegador)
│   ├── App.tsx                # Componente raíz (login gating + dashboard)
│   └── main.tsx               # Entry point + providers
├── scripts/
│   ├── seed.ts                # Script de importación (pasa admin token)
│   └── seed-data.ts           # Snapshot de tareas del .md original
└── package.json
```

## 🗃️ Modelo de datos

**`tasks`**: title, area (patagonia/datacef/personal), status (6 estados),
notes, estimate, dueDate, progress, standbyFrom/Until, scheduledDates,
requestedBy, order, completedAt, deletedAt (soft-delete), timestamps.

**`subtasks`**: taskId, title, done, completedAt, deletedAt (soft-delete),
order, timestamps.

**`sessions`**: token, expiresAt, createdAt (sesiones activas, verificadas en cada llamada).

**`settings`**: key/value (reservado para configuración futura).

**`challenges`**: challenge, expiresAt, used (nonce de un solo uso para el login RSA).

---

Hecho con ❤️ para gestionar las tareas de Hermes.
