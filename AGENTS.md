# Instrucciones del repo — Hermes Task Tracker

## Idioma: español neutro, SIEMPRE

Todo texto que produzcas (respuestas, resúmenes, reportes, comentarios, chats,
avisos WhatsApp, textos de UI, documentación) debe estar en **español neutro
con "tú"**:

- Nada de voseo argentino/rioplatense: no uses "vos", "tenés", "hacé", "poné",
  "probá", "mirá", "decí", "andá", ni imperativos en -á/-é/-í ("respondé",
  "revisá", "tocalá"…). Usa las formas de tú: "responde", "revisa", "prueba".
- Nada de "che", "vos sabés", "después te aviso" estilo coloquial rioplatense.
- Trato: "tú" (nunca "vos"); mantén el tono directo y técnico de siempre.
- El código, identificadores y logs técnicos quedan como estén.

Esta regla aplica también a los textos que escribas PARA otros componentes
(prompts del puente, notificaciones, copy de UI): el voseo se contagia — si el
prompt habla en voseo, el agente responde en voseo.

## Contexto del proyecto

- App: React + Vite (`src/`) + Convex (`convex/`) + puente local de agentes
  (`agent-bridge/`, ZCode y Claude Code). Deploy: Vercel + Convex prod.
- Metodología DataCEF: PRD en `docs/prds/`, resúmenes en `docs/resumenes/`,
  ver `docs/prds/cristian/` y `agent-bridge/README.md` antes de tocar el puente.
- Contrato de los agentes delegados: `CONTRATO_AGENTE.md` (raíz).
