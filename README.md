# 📋 Hermes Task Tracker

Dashboard personal para trackear tareas en tiempo real, con base de datos en la nube (Convex).

Permite crear, editar, cambiar estado y eliminar tareas agrupadas por área (Patagonia 💼 / Datacef 🏢 / Personal 🏠), con vistas **Kanban** y **Lista**.

## ✨ Características

- 🗄️ **Base de datos en la nube** con Convex (datos reactivos en tiempo real)
- 🔐 **Autenticación** con Google + email mágico (Convex Auth)
- 📊 **Vista Kanban** con drag & drop para cambiar estado entre 6 columnas (🔴 Urgente, 🟡 Pendiente, 🟢 Baja, ⏸️ Standby, 📅 Programado, ✅ Completado)
- 📝 **Vista Lista** agrupada por área, estilo Notion
- ✅ **Sub-tareas** con checkbox y fecha de completado
- 🎨 **Diseño moderno** con Tailwind, Framer Motion y Lucide
- 🌗 **Modo claro/oscuro**
- 📱 **100% responsivo**

## 🛠️ Stack

- **Frontend:** React + Vite + TypeScript
- **Backend:** Convex (base de datos reactiva)
- **Auth:** Convex Auth
- **Estilos:** Tailwind CSS
- **Animaciones:** Framer Motion
- **Drag & Drop:** @dnd-kit

## 🚀 Desarrollo

```bash
npm install
npm run dev       # frontend en localhost:5173
npx convex dev    # backend Convex en otra terminal
```

## 🏗️ Build y deploy

```bash
npm run build
npx convex deploy
```

---

Hecho con ❤️ para gestionar las tareas de Hermes.
