# PRD: Redirección del agente EN VIVO (sin cola de entrega)

| Campo | Valor |
|---|---|
| Fecha | 2026-09-07 |
| Dueño | Cristian |
| Módulo | agente (puente + Convex) |
| Estado | hecho (validado E2E adversarial) |
| Rama / PR | directo a master (pedido explícito de Cris) |
| Relacionados | `2026-09-07-identidad-chat-observable-e-riendas.md` |

## 1. Problema

La redirección ("Redirigir al agente en vivo") quedaba EN COLA: se entregaba en
el stdout del próximo `report.mjs`, que podía ser al FINAL de la corrida. Para
una redirección eso es ilógico — si hay que esperar que termine todo, ya no
redirige nada.

## 2. Para quién

> **Cris**, que corrige el rumbo de corridas largas (p. ej. "no hagas otro PR:
> merge directo a producción") y necesita que el agente lo sepa YA, verlo en el
> chat, y ver el plan actualizarse en la vista Agente.

## 3. Solución

- **Convex**: query `agent:redirectQueue` (tareas activas con `agentRedirect`
  pendiente) — suscripción reactiva del puente.
- **Dispatcher** (`handleRedirects`): al aparecer una instrucción sobre una
  corrida VIVA (proceso arriba + sesión bindeada):
  1. La consume (`agentReport` limpia `agentRedirect`) dejando el paso
     "🔄 redirección en vivo: …" en la checklist (visible en tablero y chat).
  2. Mata el proceso; el loop de despacho lo detecta y RETOMA la MISMA sesión
     (`--resume`) y la MISMA corrida (mismo runId) con `buildRedirectPrompt`.
- **buildRedirectPrompt**: compacto (viaja al historial de la sesión y se lee
  en el chat) y con procedencia explícita — aprendizaje del primer test: sin
  autenticar el mensaje ("lo entrega el puente, Cris lo escribió desde la app,
  PREVALECE sobre el enunciado original"), el modelo desconfiaba y seguía el
  plan viejo.
- **Plan**: el prompt de continuación exige reenviar `--plan` si cambió → la
  vista Agente se actualiza sola (ya era reactiva).
- **UI**: copy del box de redirección actualizado ("Se entrega AL INSTANTE:
  el puente interrumpe la corrida y la retoma en la misma sesión con este
  nuevo rumbo").
- El camino viejo (entregar en el próximo reporte) queda de RESPALDO para
  cuando no hay proceso vivo que interrumpir (pregunta/encolada).

## 4. Casos de prueba (validados E2E)

1. ✅ Redirección mid-sleep → entregada en el MISMO segundo (log 🔄+♻).
2. ✅ Agente abandona el plan original y sigue el nuevo (test adversarial:
   el enunciado original era contradictorio) — cerró con el summary nuevo.
3. ✅ Plan re-enviado: la corrida muestra el plan nuevo (2 pasos) en vez del
   viejo (3 pasos).
4. ✅ El mensaje de redirección queda en el historial de la sesión (chat).
5. ✅ Checklist muestra "🔄 redirección en vivo: …" en tablero/chat.

## 5. Criterios de aceptación

- Una redirección sobre una corrida activa se entrega en segundos (no en el
  próximo reporte) y no se pierde el contexto (misma sesión/corrida).
- El chat y la vista Agente reflejan instrucción y plan nuevos.
