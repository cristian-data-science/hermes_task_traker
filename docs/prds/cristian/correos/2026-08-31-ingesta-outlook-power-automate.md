# PRD: Ingesta de correos Outlook → Convex vía Power Automate

| Campo | Valor |
|---|---|
| Fecha | 2026-08-31 |
| Dueño | Cristian |
| Módulo | correos (backend Convex + webhook) |
| Estado | hecho (falta crear el flujo en Power Automate, del lado de Cris) |
| Rama / PR | feat/agente-zcode |
| Relacionados | `CONTRATO_AGENTE.md` (fase D), `docs/centro-patagonia-bi.md` (familia F2) |

---

## 1. Problema

Los correos importantes de Outlook que deben convertirse en tareas del tracker
dependen de que Cris los copie a mano. No existe camino automático del buzón a
la base Convex.

## 2. Para quién (persona concreta)

> Este feature es para **Cris**, que recibe correos con acciones (clientes,
> Patagonia, DataCEF) y hoy los releí para crear la tarea a mano. Después de
> esto, el correo de importancia alta entra solo a la tabla `correos` y queda
> listo para que el agente lo transforme en tarea.

## 3. User journey (paso a paso)

1. Llega un correo de **importancia alta** a la bandeja de Outlook de Cris.
2. Power Automate lo captura y hace POST al webhook con su token.
3. Convex lo guarda en `correos` con estado `nuevo` (idempotente por
   `messageId`: si el correo se edita y el webhook se redispara, NO se duplica
   ni se resetea el avance).
4. El agente (o Cris desde la app) consulta `pendientes`, crea la tarea y
   llama `marcarProcesado` ligando `tareaId`.

## 4. Alcance

**Sí incluye:**
- Tabla `correos` con índices `by_messageId` (idempotencia) y `by_estado`.
- `internalMutation ingestar` (única escritura) + HTTP action
  `POST /correos/ingesta` con header `x-webhook-token` validado timing-safe
  contra `POWER_AUTOMATE_TOKEN`.
- Query `pendientes` y mutation `marcarProcesado` (con sesión, como todo el repo).
- Flujo de Power Automate (trigger importancia alta) + token seteado en dev y prod.

**No incluye (qué NO hacemos y por qué):**
- UI en la app para ver correos (fase siguiente: panel de triage).
- Descarga de adjuntos (solo metadata: nombre/tipo/tamaño).
- Otras carpetas besides Inbox o filtros por remitente (el filtro es
  importancia alta; ampliable en el trigger sin tocar código).
- Búsqueda de texto completo sobre `cuerpo`.

## 5. Diseño técnico (diagrama)

```
Outlook (importancia alta)
   └─> Power Automate: Get email (V2) ─> Html to text ─> POST /correos/ingesta
                                                      (header x-webhook-token)
                                                        │  timing-safe vs env var
                                                        │  coerciones (fecha, bool, "")
                                                        ▼
                        internalMutation `ingestar` (única puerta de escritura)
                          ├─ existe messageId ─> patch SOLO asunto/cuerpo/categorias/
                          │                       actualizadoEn (estado/tareaId/
                          │                       procesadoEn INTOCABLES)
                          └─ no existe ─> insert estado "nuevo" (cuerpo ≤ 100k chars)
                                                        ▼
                 tabla `correos` ──(agente/app con sesión)──> `pendientes`
                          └─> crea tarea ─> `marcarProcesado(messageId, tareaId)`
```

- Tablas tocadas: `correos` (nueva); referencia opcional a `tasks` vía `tareaId`.
- Índices: `by_messageId ["messageId"]`, `by_estado ["estado", "recibidoEn"]`.
- Impacto en otros módulos: ninguno (`authGuard.ts` solo gana un `export` de
  una función privada existente).
- URL del webhook: `https://<deployment>.convex.site/correos/ingesta`
  (**.site**, no .cloud). Dev: `adept-lyrebird-492`; prod: `effervescent-crab-895`.

## 6. Casos de prueba (base — el agente los expande)

- [ ] Feliz: POST válido → 200 `{creado:true}`, fila con estado `nuevo`.
- [ ] Idempotencia: mismo `messageId` dos veces → UNA fila, `actualizadoEn`
      cambia, `estado`/`tareaId`/`procesadoEn` intactos.
- [ ] Idempotencia tras procesar: correo ya `procesado` + redisparo → sigue
      `procesado` con su `tareaId`.
- [ ] 401 sin header `x-webhook-token`.
- [ ] 401 con token incorrecto.
- [ ] 500 fail-closed si falta `POWER_AUTOMATE_TOKEN` en el servidor.
- [ ] 400 con JSON roto / no objeto.
- [ ] 400 sin `messageId` o sin `graphId`.
- [ ] `recibidoEn` ISO string → número epoch ms.
- [ ] `recibidoEn` vacío/inválido → fallback `Date.now()`.
- [ ] `tieneAdjuntos` llega `"true"` (string) → boolean `true`.
- [ ] `cuerpo` de 150k chars → queda en 100k.
- [ ] Campos vacíos `""` → se guardan como ausentes (undefined), sin romper.
- [ ] `marcarProcesado` de messageId inexistente → error.
- [ ] `marcarProcesado` feliz → `procesado` + `procesadoEn` + `tareaId`.
- [ ] `pendientes` devuelve solo `nuevo`, FIFO (más viejo primero).
- [ ] Sin sesión válida, `pendientes`/`marcarProcesado` lanzan no autorizado.

## 7. Criterios de aceptación (definition of done)

- [ ] `npm run build` sin errores.
- [ ] Pruebas curl de idempotencia/401/truncado pasando contra dev.
- [ ] `npx convex deploy` a prod con `POWER_AUTOMATE_TOKEN` seteado (dev y prod).
- [ ] Flujo de Power Automate probado con correo real (misma fila al reenviar).
- [ ] Resumen post-implementación en `docs/resumenes/`.
- [ ] Nota: este repo aún no tiene `00-INDICE.md`/`brain/` (estructura pendiente
      de adoptar); este PRD es el primero bajo la metodología.

## 8. Riesgos y preguntas abiertas

- **Nombre de propiedad del conector V2** (`dateTimeReceived` vs
  `receivedDateTime` según versión): mitigado con `coalesce` en el flujo y
  fallback `Date.now()` en el backend.
- **Carrera de dos POST simultáneos** con el mismo `messageId`: improbable con
  un solo flujo; el índice + OCC de Convex lo hace despreciable.
- **Tope 1 MB por documento**: truncado de `cuerpo` a 100k chars.
- **Token embebido en el flujo** (visible a quien edite el flujo): flujo
  personal, aceptable; rotar el valor si algún día se comparte.
- **`messageId` ausente en el conector**: devolvería 400 y el flujo marcaría el
  run como fallido (visible en el historial de Power Automate).

---

## 9. Guía: flujo de Power Automate (importancia alta → Convex)

Crear en <https://make.powerautomate.com> → Mis flujos → Nuevo → Automatizado
en blanco. Nombre sugerido: **Outlook importante → Hermes Convex**.

1. **Trigger: "Cuando llega un correo nuevo (V2)"** (Office 365 Outlook)
   - Carpeta: `Bandeja de entrada` (Inbox)
   - Importancia: `Alto`
2. **Acción: "Obtener correo electrónico (V2)"** (Get email (V2))
   - Id: `id` del trigger (contenido dinámico del disparador).
3. **Acción: "Html a texto"** (Html to text)
   - Source: `body` (cuerpo) del paso Get email (V2).
4. **Acción: HTTP**
   - Method: `POST`
   - URI: `https://effervescent-crab-895.convex.site/correos/ingesta`
   - Headers: `x-webhook-token` = valor de `POWER_AUTOMATE_TOKEN`;
     `Content-Type` = `application/json`.
   - Body (objeto JSON, nunca string concatenado):

```json
{
  "messageId": "@{outputs('Get_email_(V2)')?['body/internetMessageId']}",
  "graphId": "@{outputs('Get_email_(V2)')?['body/id']}",
  "conversationId": "@{outputs('Get_email_(V2)')?['body/conversationId']}",
  "recibidoEn": "@{coalesce(outputs('Get_email_(V2)')?['body/dateTimeReceived'], outputs('Get_email_(V2)')?['body/receivedDateTime'])}",
  "remitenteEmail": "@{outputs('Get_email_(V2)')?['body/from/emailAddress/address']}",
  "remitenteNombre": "@{outputs('Get_email_(V2)')?['body/from/emailAddress/name']}",
  "asunto": "@{outputs('Get_email_(V2)')?['body/subject']}",
  "cuerpo": "@{body('Html_to_text')}",
  "tieneAdjuntos": "@{outputs('Get_email_(V2)')?['body/hasAttachment']}",
  "webLink": "@{outputs('Get_email_(V2)')?['body/webLink']}"
}
```

Notas de la integración:
- `body/from` en el conector V2 es un **objeto**: se usa
  `from/emailAddress/address` y `from/emailAddress/name` (mandar `body/from`
  directo serializa el objeto entero).
- El HTTP action depende de `Html_to_text` (runAfter: Succeeded).
- No se necesita variable de entorno en Power Automate (eso requiere
  Solutions/premium): el token va embebido en el header y el mismo valor vive
  como `POWER_AUTOMATE_TOKEN` en Convex.

Prueba final: enviarse un correo de importancia alta y volver a disparar el
flujo → una sola fila en
<https://dashboard.convex.dev/d/effervescent-crab-895/data/correos> con
`actualizadoEn` cambiando.
