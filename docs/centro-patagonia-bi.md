> **Nota (31-ago-2026):** copia de referencia congelada de C:mcp_serversREADME.md. El plan de delegación que vivía en su sección 3 ahora tiene como fuente de verdad a [CONTRATO_AGENTE.md](../CONTRATO_AGENTE.md) en este repo (versionado en Git).

# C:\mcp_servers — Centro Patagonia BI + Plan de delegación al agente

**Fecha de fundación:** 31 de agosto de 2026
**Dueño:** Cris (cristian-data-science) · **Agente:** ZCode (GLM) vía MCP `powerbi-modeling`

Esta carpeta es la casa de dos cosas:

1. **Los reportes Power BI de Patagonia** que se trabajan con el MCP server de Power BI — ahora con estructura por reporte (antes estaba todo suelto en la raíz).
2. **El plan de registro de la delegación agente–Cris** para todo el trabajo Patagonia (sección 3). Este archivo es la fuente de verdad: cualquier cambio de rumbo se estampa aquí.

---

## 1. Reglas de la casa (estructura de carpetas)

```
C:\mcp_servers\
├── README.md                  ← este archivo (reglas + plan de delegación)
├── <Nombre Reporte>\
│   ├── <Nombre Reporte>.pbix  ← el reporte
│   ├── CAMBIOS.md             ← bitácora viva del reporte (control de cambios)
│   ├── backups\               ← snapshots con fecha ANTES de cambios riesgosos
│   └── *.md                   ← documentación adicional del reporte (análisis, migraciones, guías)
└── .vscode\, .zcode\          ← configuración (no tocar)
```

**Reglas operativas:**

- **Un directorio por reporte.** Todo lo que pertenece a un reporte vive dentro de su carpeta: pbix, backups y MDs.
- **`CAMBIOS.md` es la bitácora obligatoria.** Cada intervención del agente (o de Cris) estampa una entrada: qué se cambió, qué problema resolvió, pasos seguidos, cómo se validó, y a qué backup volver si algo salió mal. Es el historial de control de cambios y la memoria que me permite retomar cualquier reporte meses después sin redescubrir nada.
- **Backup antes de cambio riesgoso.** Copia del .pbix a `backups/` con fecha en el nombre antes de tocar estructura del modelo, medidas críticas o hacer refresh masivo.
- **Nada se borra.** Las versiones viejas van a `backups/`, nunca a la papelera.
- **Reporte nuevo = carpeta nueva desde el día 1**, con su `CAMBIOS.md` aunque la primera entrada sea "creado".

## 2. Flujo de trabajo para reportes (Cris pide, agente ejecuta)

1. Cris pide crear o modificar un reporte (por chat, o más adelante vía tracker).
2. El agente trabaja **siempre dentro de `C:\mcp_servers\<Reporte>\`**, conectándose al modelo con el MCP `powerbi-modeling`.
3. Antes de un cambio con riesgo: copia del .pbix a `backups/` con fecha.
4. Al terminar: actualiza `CAMBIOS.md` con la entrada completa (cambio, problema, pasos, validación con números antes/después, rollback).
5. Cris revisa el resultado. La carpeta queda como documentación permanente de cómo se llegó a la solución.

## 3. Plan de delegación Patagonia (lo conversado — plan de registro)

### 3.1 El diagnóstico (barrido real de datos, 31-ago-2026)

Fuente: base Convex del Hermes Task Tracker (`effervescent-crab-895.convex.cloud`, 76 tareas, 44 de Patagonia, jul–ago 2026). Hallazgo clave: **las 44 tareas Patagonia tienen executor=cris** — cero delegación al agente en el trabajo de pago, mientras en "personal" Claw ya ejecuta mandados.

Las 5 familias de trabajo Patagonia y su peso:

| # | Familia | % de tareas | Ejemplos reales |
|---|---------|------------|-----------------|
| F1 | Mantención y corrección de reportes Power BI | ~34% (15/44) | Scorecard v1→v2 (urgente 2 meses), matriz NC, ppto diario tiendas nuevas, agregar Valdivia a reportes |
| F2 | Correos y respuestas con datos detrás | ~18% (8/44) | Mail Cami/Clemo NC (1 mes vencido), Paula Vial, Victoria Rosas, correos HOT Outlook |
| F3 | Proyectos de desarrollo (apps Patagonia) | ~22% (9/44) | Ley de Datos, patagonia_core, API Followup, SyncData, OSC Inventory |
| F4 | Infraestructura de datos (Airflow/Snowflake) | ~14% (6/44) | Sales providers snowflake (**13,8 días abierta**, el mayor dolor individual), migración auth, alerta Vico |
| F5 | Gestión y personas | ~11% (5/44) | Agendar reuniones, pauta entrevistas 1:1, conversatorio documentales |

### 3.2 El modelo acordado

```
Cris bota contexto en el Hermes Task Tracker (una línea, desde el celular)
        │  executor marcado para el agente
        ▼
Claw (Hermes, cron Inbox Checker cada 30 min) DESPACHA
        │  lanza al ejecutor con contexto Patagonia
        ▼
ZCode EJECUTA con recetas por familia (skill patagonia-agente)
        │  repos, MCP Power BI, Snowflake, Airflow API, D365
        ▼
Resultado vive EN LA TAREA (estado + evidencia: números antes/después, PR, CSV)
        │
        ▼
Cris REVISA en el panel (y aprueba lo que esté en "Requiere tu ok")
```

Ciclo de vida de una tarea delegada: `encolada → trabajando → pregunta → para-revisión → hecho`. La tarea cambia de estado en vivo; los bloqueos generan estado `pregunta` (y ping a WhatsApp), no silencio.

### 3.3 Decisiones tomadas (31-ago-2026)

1. **Todas las familias** interesan; se activan en orden: F4 → F1 → F3 → F5. F2 (correo) **aparte**: las políticas de Patagonia no permiten conectar apps externas al buzón; Cris montará una export desde su cuenta cloud y se retoma después.
2. **Despachador: Hermes Claw** (reutiliza el patrón del Inbox Checker que ya corre cada 30 min).
3. **Límites de autonomía: por familia.** Cris definirá qué pasos son libres y cuáles requieren su ok, familia a familia. Defaults conservadores mientras tanto (reglas de oro abajo).
4. **Duda CLI vs escritorio — resuelta con evidencia:** escritorio y CLI comparten la **misma base de sesiones** (`C:\Users\patag\.zcode\cli\db\db.sqlite`; la sesión de escritorio de este mismo día vive allí). No hay dos mundos: una tarea despachada por CLI se abre desde la app de escritorio. Verificación en vivo pendiente al armar el despacho (Fase A), para confirmar la lista de sesiones del escritorio.

### 3.4 Fases de construcción

- **Fase A — Contrato y despacho:** spike de despacho (cómo Claw lanza a ZCode: CLI / Bot Telegram / spawn), `CONTRATO_AGENTE.md` en el repo del tracker (ciclo de vida + matriz de permisos por familia), skill `patagonia-agente`, cron despachador en Hermes sin tocar el esquema de la app.
- **Fase B — Activar familias:** F4 Airflow/Snowflake (AGENTS.md en `airflow_master`, receta fallo→diagnóstico→fix en rama→PR) → F1 Power BI (recetas de los 4 arreglos recurrentes, con backups/rollback — este directorio es su infraestructura) → F3 (PRD-first) y F5 (borradores).
- **Fase C — Panel:** estados de ciclo agente en el tracker + vistas "Cola del agente", "Hecho hoy por el agente", "Requiere tu ok" + digest WhatsApp de aprobaciones.
- **Fase D — Proactividad:** barridos que auto-generan tareas con diagnóstico adjunto (salud Airflow/Snowflake diaria, salud Power BI semanal). Cris deja de ser el sensor.

### 3.5 Reglas de oro (contractuales)

1. Nada a producción ni al ERP sin ok explícito de Cris, hasta que la matriz por familia diga otra cosa.
2. El agente nunca envía correos: deja borradores.
3. Una familia se activa solo con su receta probada contra los sistemas reales.
4. Toda acción deja rastro en la tarea (estado + evidencia).
5. En esta carpeta: backup antes de cambio riesgoso, `CAMBIOS.md` siempre al día.

## 4. Índice de reportes (26 carpetas)

Beneficios cruzados · Compras Internas PAT · Cumplimiento PPTO · Cumplimiento PPTO V2 · Día contra día · followup_snowflake · Home · Monitor Comunidad Pro · OMS · Patagonia_Pro_V3 · Peso&Volumen · Real VS Forecast · Reporte eventos · Resumen Kpis comerciales · revision_pagos · Sales weekly USA · Scorecard V1 · Scorecard V1 - Tiendas · Scorecard V2 · Stock Patagonia V3 · Stock365-EIT-StockPlanner-VNC · tareas_clickup · Top 100 ganadores · Venta Extranjeros · Venta Extranjeros - Retail · Volumen Productos

Documentos históricos reubicados: `MIGRACION_SCORECARD_V1_A_V2.md` → Scorecard V2 · `docu_nc.md` y `homologacion-yoY-scorecard-vs-resumen-kpis.md` → Resumen Kpis comerciales · `rollback-ppto-mes-calc.md` → Cumplimiento PPTO V2 · `ComunidadPro_*.md` → Monitor Comunidad Pro · análisis de Reporte eventos → Reporte eventos.

## 5. Estado

| Qué | Estado |
|-----|--------|
| Carpeta ordenada (45 movimientos, 0 pérdidas) | ✅ 31-ago-2026 |
| Bitácoras `CAMBIOS.md` creadas (26) | ✅ 31-ago-2026 |
| Fase A del plan de delegación (spike + contrato + skill) | ⬜ pendiente |
| Matriz de permisos por familia | ⬜ la define Cris |
