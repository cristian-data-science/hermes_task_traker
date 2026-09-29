# Diagnóstico de uso de Convex (capa gratuita)

Scripts para consultar el consumo del equipo/proyecto en la API de plataforma
de Convex (`api.convex.dev`), la misma que usa el dashboard. Útiles para
vigilar el límite mensual de **Database I/O (1 GB en el plan gratuito)**,
que fue la métrica excedida en septiembre 2026 (ver análisis del 2026-09-28).

## Uso

```bash
node scripts/convex-usage/fetch-usage.mjs   # estado del equipo + periodo de facturación
node scripts/convex-usage/extract-all.mjs   # vuelca series y desgloses a usage-raw.json
node scripts/convex-usage/analyze.mjs       # imprime el análisis legible
```

Autenticación: leen el token local del CLI (`~/.convex/config.json`).
Ajustar arriba de cada script: `TEAM`, `PROJECT`, `DEPLOYMENT`, ventana
`from`/`to` y los queryIds según lo que se quiera consultar.

## Catálogo de queryIds (extraído del bundle público de dashboard.convex.dev)

La API de uso es genérica: `GET /api/dashboard/teams/{teamId}/usage/query`
con `queryId`, `from`, `to` y opcionales `projectId`/`deploymentName`.
Los identificadores no están documentados; se obtuvieron del JS del
dashboard (chunk de la página de usage). Principales:

| Métrica | queryId |
|---|---|
| Resumen del equipo (mes) | `b63fe48d-320c-401a-8682-0a0b36b50e2b` |
| Llamadas por día por clase | `77a4e5bd-aa82-43e7-85a4-89897cecaa05` |
| Métricas por función | `76c86baa-418e-4d7f-ac21-46f397030595` |
| Data egress por día | `67ce838f-b2d0-4cda-9a2e-580c6d134466` |
| Database I/O por día | `9f606f77-521d-44bb-83ef-b1057b0fb1c9` |
| Storage BD por día | `489b0f87-6b3a-4dfe-a327-f2965b5c2977` |
| Storage BD por tabla | `017c5977-3002-40ca-96af-31868e70e611` |
| Documentos por tabla | `28646a64-f234-44c2-b763-ecb63d43ad24` |
| Compute por día | `038e5492-6de5-4ddb-86b4-761e19b4d2ab` |

Otros endpoints útiles: `dashboard/teams/{id}/usage/team_usage_state`
(estado: Included/Approaching/Exceeded/Disabled) y
`dashboard/teams/{id}/usage/current_billing_period`.

## Hallazgos clave (septiembre 2026)

- Estado del equipo: **Exceeded** por Database I/O: 1,50 GB de 1 GB.
- 73% del egress de BD: `agentOverview` (69,6 KB por ejecución), llamada
  cada 60 s por `recoverStuck` del puente + suscripción reactiva del
  frontend. El I/O se factura por documentos leídos, no por lo devuelto.
- `usage-raw.json` y `summary-sep.json` conservan la evidencia de ese mes.
