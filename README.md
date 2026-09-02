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
- 🤖 **Delegación a ZCode (centro de mando, solo web)**: asignás tareas al
  agente con tipo (reporte → carpetas de `C:\mcp_servers` sin git ·
  desarrollo → repos de `git_provisorio`), carpeta destino, nivel de
  autonomía (escenario/supervisado/autónomo), modelo y avisos por WhatsApp
  vía Hermes. El puente local `agent-bridge` las despacha en segundos a
  ZCode headless y el resultado (estado + resumen + evidencia) vive en la
  tarea. Ver [`CONTRATO_AGENTE.md`](CONTRATO_AGENTE.md) y
  [`agent-bridge/README.md`](agent-bridge/README.md).

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

## 🔗 Integración ClickUp (solo Patagonia)

Las tareas del área **Patagonia** se sincronizan con ClickUp automáticamente.
Las áreas **Datacef** y **Personal** nunca tocan ClickUp.

### Cómo funciona

**Outbound (Hermes → ClickUp), automático:**
Al crear/editar/completar/eliminar una tarea de Patagonia, se refleja en ClickUp.
Al crear, elegís el destino:
- **Mesa Técnica** → la tarea va a la list "Tareas mesa técnica" (tarea suelta).
- **Proyecto** → elegís proyecto + rama (ej. Ley de Datos → alcance / desarrollo /
  puesta en marcha) y la tarea se anida bajo esa rama.

**Inbound (ClickUp → Hermes), manual y selectivo:**
El botón ⟳ **"Sincronizar desde ClickUp"** (en el Toolbar) escanea dos fuentes
y abre un modal con dos secciones:
- **Nuevas**: tareas que existen en ClickUp pero no en Hermes.
- **Cambios de estado**: tareas mapeadas cuyo estado cambió en ClickUp.

Las dos fuentes de escaneo se combinan y deduplican:
1. **Lists/proyectos trackeados** en configuración (Mesa Técnica, Ley de Datos, etc.).
2. **TODAS las tareas asignadas a Cristian Gutiérrez** en el workspace entero,
   sin importar en qué list/folder estén. Si a Cris le asignan una tarea en
   cualquier parte de ClickUp, aparece en el modal — independientemente de la
   configuración trackeada.

Cada ítem tiene un checkbox y un selector de estado. Aprobás lo que quieras
(item por item o en bulk) y lo demás se marca como ignorado para que no
reaparezca. **Nada se aplica sin tu aprobación explícita.**

**Responsable en ClickUp:** toda tarea que Hermes envía a ClickUp queda asignada
a **Cristian Gutiérrez**, sin importar el ejecutor interno (Cris o Claw) de
Hermes.

### Configuración

**1. Secret del token** (una sola vez):
```bash
npx convex env set CLICKUP_API_KEY "pk_tu_token_personal"
```
El token **nunca** llega al navegador: todas las llamadas a ClickUp se hacen
server-side desde actions de Convex (`convex/clickup.ts`).

**2. Mapeo de destinos** (`settings` key `clickup.config`):
La config vive en la DB como JSON, editable desde el panel ⚙️ de ClickUp
(toggle on/off + checkboxes de inbound por proyecto). Estructura:
```json
{
  "mesaTecnica": { "listId": "901418067371", "inbound": true },
  "projects": [{
    "id": "ley-de-datos",
    "label": "Ley de Datos",
    "listId": "901412131396",
    "inbound": true,
    "destinations": [
      { "id": "alcance", "label": "Levantamiento y alcance", "parentId": "86b67yvgr" },
      { "id": "desarrollo", "label": "Desarrollo / App Web", "parentId": "86b67yvhh" },
      { "id": "puesta-en-marcha", "label": "Despliegue y cumplimiento", "parentId": "86bb2xvgr" }
    ]
  }]
}
```
Para añadir otro proyecto, agregás un objeto a `projects` con sus destinos
—sin tocar código.

**3. Toggle global**: el panel ⚙️ permite pausar todo el sync outbound
(`clickup.enabled`). Las eliminaciones en Hermes **desvinculan** (limpian
`clickupId`) sin borrar en ClickUp, para no romper lo que ve el equipo.

### Mapeo de estados

Hermes tiene 6 estados; ClickUp usa 3. El outbound pierde granularidad; el
inbound sugiere un estado sobreescribible en el modal:

| Hermes | ClickUp |
|---|---|
| `completado` | `complete` |
| `en-curso` | `in progress` |
| `urgente`/`pendiente`/`standby`/`programado` | `to do` |

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

## 📱 App Android (PWA)

La app es una **PWA instalable**: en el teléfono, abrí la URL en Chrome →
menú ⋮ → **"Instalar aplicación"** (o el botón 📥 "Instalar app" que aparece
in-app). Se crea un WebAPK con ícono propio que abre pantalla completa, sin
barra URL. Las actualizaciones son automáticas (cada push a master).

- **Login en el teléfono**: pasá tu `rsa_key.p8` al teléfono ( Drive/email a
  ti mismo) y arrastrala o tocá la zona para seleccionarla — la clave se usa
  solo ahí, firmándola localmente.
- **Service worker solo en móvil**: la web de escritorio queda 100% intacta
  (el SW cambia caché/offline, así que solo se registra con `pointer: coarse`
  o standalone). Compuerta: pixel-diff e2e de desktop contra baseline.
- **Offline**: app-shell instantáneo desde precache; los datos siguen siendo
  realtime (Convex no es offline-first — con sesión y sin red verás el
  spinner hasta reconectar).

Fase opcional (APK / Play Store): la misma PWA se empaqueta como TWA con
[PWABuilder](https://www.pwabuilder.com/) (sin tooling) o
[Bubblewrap](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start)
(`npm i -g @bubblewrap/cli` → `bubblewrap init --manifest=<url>` → `build`).
Requiere `public/.well-known/assetlinks.json` con la huella SHA-256 de la
clave de firma. Play Store: US$25 + 12 testers/14 días para cuentas
personales nuevas.

Pruebas: `npx playwright test` (matrix móvil 360/390/412/768 + gate
pixel-diff desktop). Baseline: `BASELINE=1 npx playwright test -g @baseline
--project=desktop-base --project=desktop-xl`. Sesión e2e:
`node scripts/gen-session.mjs`.

## 📐 Especificaciones (OpenSpec)

El contexto del proyecto vive empaquetado en `openspec/` con
[OpenSpec](https://github.com/Fission-AI/OpenSpec) (spec-driven development):

- **`openspec/config.yaml`** — stack, arquitectura, convenciones y guards de
  deploy: el contexto que lee el agente al planificar cualquier cambio.
- **`openspec/specs/<capacidad>/spec.md`** — especificaciones estables de lo
  construido: 11 capacidades, 61 requisitos con escenarios WHEN/THEN
  (tasks, vistas, sub-tareas, fechas, auth, seguridad, sync ClickUp
  outbound/inbound, destino ClickUp, catch-up semanal, theming).
- **`openspec/changes/`** — propuestas de cambio (deltas) para funcionalidades
  futuras: se archivean sobre los specs estables al implementarse.

Flujo para una feature nueva (requiere `npx @fission-ai/openspec init --tools zcode`
la primera vez en cada máquina, para regenerar los comandos `/opsx:*`):

1. **Proponer**: `/opsx:propose "idea"` → genera proposal + delta spec +
   design + tasks (solo planificación, no toca código).
2. **Implementar**: `/opsx:apply <change>` con las tasks como guía.
3. **Archivar**: `/opsx:archive <change>` → fusiona el delta en los specs
   estables.
4. **Validar**: `npx @fission-ai/openspec validate --specs --strict`.

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
│   ├── clickup.ts           # Integración ClickUp: syncTask (outbound) + getInboundDiff/submitInbound
│   ├── clickupMutations.ts  # Mutaciones internas de ClickUp (persistencia V8, no Node)
│   ├── clickupConfig.ts     # Tipos + config default del mapeo ClickUp (IDs verificados)
│   ├── settings.ts          # API pública de settings (config ClickUp + _checkSession)
│   ├── seed.ts              # Mutation de importación (protegida con admin token)
│   └── _generated/          # Tipos generados por Convex (auto)
├── src/
│   ├── components/
│   │   ├── LoginScreen.tsx    # Pantalla de login
│   │   ├── Toolbar.tsx        # Header + filtros + botones ClickUp (sync/settings)
│   │   ├── KanbanView.tsx     # Vista Kanban con drag & drop
│   │   ├── ListView.tsx       # Vista lista agrupada por área
│   │   ├── TaskCard.tsx       # Tarjeta de tarea (con badge ClickUp)
│   │   ├── TaskModal.tsx      # Modal crear/editar con sub-tareas + destino ClickUp
│   │   ├── ClickUpDestinationPicker.tsx  # Selector Mesa Técnica | Proyecto → rama
│   │   ├── ClickUpSettings.tsx           # Panel de config ClickUp (toggle + inbound)
│   │   ├── InboundSyncModal.tsx          # Modal de sync reversa (diff + aprobación)
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
requestedBy, order, completedAt, deletedAt (soft-delete), timestamps,
**+ campos ClickUp** (solo Patagonia): clickupId, clickupParentId, clickupUrl,
clickupSyncedAt, clickupSyncError, clickupInboundIgnored.

**`subtasks`**: taskId, title, done, completedAt, deletedAt (soft-delete),
order, timestamps.

**`sessions`**: token, expiresAt, createdAt (sesiones activas, verificadas en cada llamada).

**`settings`**: key/value. Almacena la config de ClickUp (`clickup.config`,
`clickup.enabled`, timestamps de último sync).

**`challenges`**: challenge, expiresAt, used (nonce de un solo uso para el login RSA).

---

Hecho con ❤️ para gestionar las tareas de Hermes.
