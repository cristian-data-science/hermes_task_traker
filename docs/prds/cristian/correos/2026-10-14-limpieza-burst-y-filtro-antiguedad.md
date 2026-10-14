# PRD: Limpieza del burst de correos antiguos + filtro de antigüedad en el webhook

| Campo | Valor |
|---|---|
| Fecha | 2026-10-14 |
| Dueño | Cristian |
| Módulo | correos (webhook de ingesta) + limpieza de datos puntual |
| Estado | hecho |
| Rama / PR | fix/cristian/limpieza-burst-correos |
| Relacionados | `docs/prds/cristian/correos/2026-08-31-ingesta-outlook-power-automate.md`, `docs/prds/cristian/correos/2026-09-08-auto-tarea-pendiente.md` |

---

## 1. Problema

El 2026-10-13 entre 00:33 y 04:29 UTC, el flow de Power Automate ("Outlook
importante → Hermes Convex", trigger `OnFlaggedEmailV4`) reinyectó de golpe el
backlog de correos con flag del buzón: **63 correos de entre 90 días y ~7 años
de antigüedad** entraron por el webhook y la auto-tarea los convirtió en 63
tareas "pendiente" (área patagonia), cada una sincronizada a ClickUp (Mesa
Técnica). Nadie marcó esos correos: un reset del cursor del trigger (edición
del flow, re-activación o re-autenticación de la conexión de Outlook) hace que
el polling entregue TODO lo que tenga flag puesto, sin importar cuándo se
marcó.

Dos frentes: (a) la basura ya insertada en Convex + ClickUp, y (b) la puerta
abierta a que un próximo reset vuelva a inyectar historial.

## 2. Para quién (persona concreta)

> **Cris**: su tablero amaneció con 63 tareas basura de correos de años
> atrás y Mesa Técnica de ClickUp tiene las mismas 63 espejadas. Necesita que
> desaparezcan sin perder ninguna tarea legítima, y que esto no vuelva a
> pasar aunque Power Automate se vuelva a reiniciar.

## 3. User journey (paso a paso)

1. (Prevención) Un POST llega al webhook con un correo cuya fecha de
   recepción tiene más de 14 días → el webhook responde 200
   `{creado:false, descartado:"antiguo"}` y NO inserta nada: ni correo ni
   tarea. El run del flow queda exitoso (sin ruido en el historial).
2. (Limpieza) Las 63 tareas del burst se borran con `tasks:remove` — el
   camino oficial de la app: soft-delete de la tarea (desaparece de la web),
   borrado físico de su fila en `correos` y DELETE de su gemela en ClickUp
   (op "delete" de `syncTask`).
3. Cris abre la app: columnas sin las 63 tareas. Mesa Técnica en ClickUp:
   sin las gemelas. Las 4 tareas de correo legítimas (8/09 ×2, 11/09, 3/10)
   siguen intactas.

## 4. Alcance

**Sí incluye:**
- Filtro de antigüedad en `convex/correos.ts` (`ingestaCorreos`): si
  `recibidoEn` (fecha real de recepción) tiene más de **14 días** de
  antigüedad respecto a ahora → 200 con `descartado` y sin efectos. Correos
  sin fecha válida (fallback `Date.now()`) o con fecha futura NO se
  descartan.
- Limpieza puntual de datos en prod (operación de una corrida, no código):
  `tasks:remove` sobre el scope exacto: tareas con `correoId`,
  `createdAt` dentro del 2026-10-13 UTC, y correo recibido >14 días antes
  (verificado contra la nota "Recibido:" de cada tarea antes de borrar).
- Snapshot del scope pre-borrado (evidencia) y verificación post.

**No incluye (qué NO hacemos y por qué):**
- NO tocar el flow de Power Automate (lado Microsoft, manual de Cris): se
  documenta el paso recomendado (condición de fecha en el flow). El filtro
  del webhook es la barrera efectiva y nos pertenece.
- NO tocar las 4 tareas de correo legítimas ni ninguna tarea manual.
- NO borrar las filas de `correos` con mano propia: `remove` ya lo hace
  (con la semántica del repo: un redisparo futuro queda bloqueado por el
  filtro nuevo).
- NO tocar el correo residual "ForeCast Septiembre" (estado "nuevo",
  insertado el 2026-08-31, anterior al incidente y sin tarea visible).

## 5. Diseño técnico

```
Power Automate ──POST /correos/ingesta──▶ httpAction ingestaCorreos
                                            │ recibidoEn válido y
                                            │ now - recibidoEn > 14d
                                            ▼
                                   200 {creado:false, descartado:"antiguo"}
                                            │ ( resto: flujo actual intacto )
                                            ▼
                              internalMutation ingestar → auto-tarea
```

- La ventana vive como constante `ANTIGUEDAD_MAX_MS = 14 días` junto al
  webhook. El chequeo va DESPUÉS de parsear `recibidoEn` y ANTES de
  `runMutation`: correos descartados no consumen escrituras.
- 200 (no 4xx): el run del flow no debe marcar error; la respuesta explícita
  queda registrada en el historial de Power Automate como evidencia.
- Limpieza: para cada taskId del scope, `npx convex run tasks:remove` con
  sesión RSA (mecanismo estándar de `scripts/gen-session.mjs`). El op
  "delete" de `syncTask` borra en ClickUp y desvincula (idempotente si la
  gemela ya no existe).

## 6. Casos de prueba (base)

- [ ] Webhook con `recibidoEn` de hace 30 días → 200 `{descartado}`, sin fila
      en `correos`, sin tarea.
- [ ] `recibidoEn` de ayer → flujo normal (no descartado).
- [ ] `recibidoEn` vacío/inválido → NO se descarta (fallback ahora).
- [ ] `recibidoEn` futuro (reloj torcido) → NO se descarta.
- [ ] Redisparo de un correo ya existente (≤14d) → idempotencia intacta.
- [ ] Limpieza: antes de borrar, las 63 candidatas cumplen correoId + rango
      13/10 UTC + antigüedad >14d; cualquier candidata que no cumpla se
      excluye y se reporta.
- [ ] Post-limpieza: `tasks:list` sin las 63; quedan exactamente las 4 tareas
      de correo legítimas; ClickUp sin las gemelas del burst.

## 7. Criterios de aceptación (definition of done)

- [x] Type-check del deploy a prod sin errores (`npx convex deploy`, 2026-10-14).
- [x] Las 63 tareas del burst fuera de la web app y de ClickUp (verificado).
- [x] Las 4 tareas de correo legítimas intactas (mismos ids).
- [x] Snapshot del scope verificado pre-borrado (63/63 cumplieron los 3
      criterios, 0 excluidas) y evidencia detallada en el resumen.
- [x] Resumen post-implementación en `docs/resumenes/2026-10-14-limpieza-burst-correos.md`.

Nota: los casos de prueba del webhook con token firmado (§6, primeros dos)
no son ejecutables desde el repo — `POWER_AUTOMATE_TOKEN` no es legible de
acá. Cobertura: type-check, revisión de lógica y guard 401 verificado en
prod; ver "efectos secundarios" del resumen.

## 8. Riesgos y preguntas abiertas

- **Borrar de más**: mitigado con scope triple (correoId + ventana 13/10 UTC
  + antigüedad >14d verificada por tarea) y snapshot pre-borrado.
- **ClickUp no se limpia** (si el setting `clickup.enabled` estuviera off):
  las tareas con `clickupId` demuestran que el create-sync corrió; el delete
  usa el mismo canal. Se verifica post-limpieza por id.
- **Reset del cursor antes del deploy del filtro**: por eso el filtro se
  deploya ANTES de borrar (el `remove` borra las filas de `correos` que
  hoy actúan de escudo anti-duplicados).
- **Caso legítimo bloqueado**: Cris marca a propósito un correo de hace 3
  semanas → el webhook lo descarta. Decisiones: ventana de 14 días elegida
  por Cris; si algún día hace falta, se crea la tarea a mano (como antes de
  la automatización).
