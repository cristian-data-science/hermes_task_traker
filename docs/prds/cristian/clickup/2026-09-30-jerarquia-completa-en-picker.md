# PRD: Jerarquía completa de ClickUp en el picker de destino

| Campo | Valor |
|---|---|
| Fecha | 2026-09-30 |
| Dueño | Cristian |
| Módulo | ClickUp (convex/clickup.ts) |
| Estado | hecho (verificado en prod: carpetas anidadas visibles) |

## 1. Problema

El selector de destino ClickUp (modal de tarea) y la página de
sincronización solo ofrecían 3 folders — Soporte, Administrativo y Mesa
Técnica Interna. Faltaban **Proyectos** (donde viven los proyectos
internos) y **ATX**, y dentro de Administrativo no aparecía CatchUp.
Mismo recorte en el buscador de destino (`getSearchIndex`) y en las
suscripciones inbound, que beben de la misma fuente (`mcpSpaceFolders`).

## 2. Causa raíz (reproducida 2026-09-30 contra prod)

El space "LATAM Portfolio" tiene folders ANIDADOS a dos niveles:

```
Proyectos (folder contenedor, sin lists directas)
  ├─ Internos  → 11 lists (los proyectos internos)
  ├─ Externos  → 5 lists
  └─ Cartelera → 4 lists
ATX (folder contenedor)
  ├─ Tickets y Soporte → Tareas ATX
  └─ Pasos de Versión   → 10.0.48/47/49
Administrativo
  ├─ Tareas Administrativas (list directa)
  └─ CatchUp → Cris, Cesar, German
```

`mcpSpaceFolders` solo miraba UN nivel (folder → lists directas) y
descartaba los folders sin lists con "contenedor sin lists: no es
destino" → Proyectos y ATX enteros afuera; CatchUp invisible dentro de
Administrativo. El MCP de ClickUp sí devuelve el árbol completo y bien
anidado (verificado en `structuredContent` y en `content[].text`).
Hipótesis inicial descartada: no era un recorte de `structuredContent`
— el árbol llega completo en ambas representaciones.

## 3. Solución

`mcpSpaceFolders` ahora recorre la jerarquía con RECURSIÓN y aplana:
cada folder CON lists directas es una entrada, etiquetada con su ruta
("Proyectos › Internos") para el dropdown; los contenedores puros solo
se atraviesan. Compatibilidad con los consumers (todos buscan por id o
iteran; ninguno asume un solo nivel):

- `discoverProjects`: aparecen las rutas aplanadas; ✓ de integrado ahora
  marca si ALGUNA list del folder está integrada (con folders de varias
  lists, antes solo miraba la primera).
- `listFolderLists`: encuentra sub-folders por id (antes no existían en
  la lista).
- Suscripciones inbound (`subscriptions`): un sub-folder suscripto ahora
  resuelve sus lists.
- `getSearchIndex`: los contenedores del buscador incluyen las rutas.

## 4. Casos de prueba

1. `discoverProjects` en prod devuelve, entre otros, "Proyectos ›
   Internos" con sus 11 lists y "ATX › Tickets y Soporte" con Tareas
   ATX. ✓
2. El dropdown del picker muestra las rutas aplanadas; al elegir
   "Proyectos › Internos" se puede elegir el proyecto (list) exacto. ✓
   (vía 1: el frontend renderiza lo que devuelve la action, sin cambios
   de frontend)
3. "Administrativo › CatchUp" aparece con lists Cris, Cesar, German. ✓
4. Folders de un nivel (Soporte, Mesa Técnica Interna) siguen igual,
   sin prefijo. ✓
5. Contenedor puro ("Proyectos" sin lists) NO aparece como destino —
   solo sus sub-folders. ✓
6. Orden preservado (sort estable; los nodos del MCP no traen
   orderindex, se mantiene el orden de la jerarquía). ✓
7. Suscripción a un sub-folder del workspace resuelve sus lists al
   sincronizar inbound. ✓
8. Sin regresión de tipos: `tsc --noEmit` en convex OK. ✓

## 5. Criterios de aceptación

- [x] Typecheck de convex OK.
- [x] `discoverProjects` verificado en prod con sesión real del puente.
- [x] Ningún consumer de `mcpSpaceFolders` roto (revisados los 6).
