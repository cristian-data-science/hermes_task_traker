# PRD: Responder correos con el agente (picker nativo + contexto acumulable)

| Campo | Valor |
|---|---|
| Fecha | 2026-09-11 |
| Dueño | Cristian |
| Módulo | correos + capa agente (Convex, web, agent-bridge) |
| Estado | hecho |
| Rama / PR | master (deploy directo, patrón del repo) |
| Relacionados | `2026-09-08-auto-tarea-pendiente.md` (correo → tarea), `2026-08-31-ingesta-outlook-power-automate.md` (ingesta), CONTRATO_AGENTE.md §5 (el agente nunca envía correos) |

---

## 1. Problema

Los correos marcados ya se convierten solos en tareas (PRD 2026-09-08), pero
la respuesta sigue siendo 100 % manual: Cris lee, junta el contexto que anda
disperso (datos en carpetas, archivos descargados, números de reportes) y
redacta. El agente podría redactar el borrador si recibiera el correo
completo + el contexto que Cris le indique — pero hoy no hay forma de
entregarle archivos ni carpetas sueltos como material de consulta: las
carpetas del registro (`agentWorkspaces`) son de desarrollo/reportes y no
cubren el caso "el contexto de ESTE correo está acá".

## 2. Para quién (persona concreta)

> Este feature es para **Cris**, que marca un correo en Outlook, ve nacer la
> tarea en el tablero y quiere decirle al agente "respóndele esto, con este
> contexto" — eligiendo la carpeta o los archivos con el selector nativo de
> Windows — y recibir una propuesta lista para copiar y pegar en su cliente
> de correo. Si al agente le falta material, Cris se lo agrega en la misma
> conversación y el agente re-redacta.

## 3. User journey (paso a paso)

1. Correo marcado en Outlook → Power Automate → ingesta → tarea "pendiente"
   ligada a su correo (ya existe). La tarea guarda `correoId`.
2. Cris abre la tarea → botón **"Responder con el agente"**.
3. Panel de contexto:
   - Indicación (texto, obligatoria): "explícale X", "dale el plazo del
     martes", o solo "responde con el contexto de la carpeta".
   - **[Elegir carpeta…]** → diálogo nativo de Windows (árbol de carpetas).
   - **[Elegir archivos…]** → diálogo nativo (multiselección).
   - Lo elegido queda como chips (quitables). Ejemplo real: Cris descargó el
     adjunto del correo a `C:\Users\patag\Downloads\presupuesto-q3\` y le pasa
     esa carpeta, o el `resumen.xlsx` suelto.
4. **Delegar** → el agente recibe: cuerpo COMPLETO del correo (no el recorte
   de 5 000 de las notas) + remitente/fecha/asunto + nombres de adjuntos +
   la indicación de Cris + carpetas para explorar y archivos puntuales para
   leer — todo como material de CONSULTA (solo lectura).
5. El agente redacta y termina en "esperando tu OK" con la **propuesta de
   respuesta** como resultado → botón **"Copiar respuesta"** → Cris la pega
   en Outlook en el hilo original y envía. El agente JAMÁS envía.
6. Ajustes: "Rechazar y corregir" con feedback → re-redacta (misma sesión).
7. Falta contexto: el agente entra en "pregunta" → Cris responde con texto
   y/o **más carpetas/archivos con el mismo picker** → el contexto se SUMA
   (no reemplaza) y el re-despacho lleva todo.

## 4. Alcance

**Sí incluye:**
- **Picker nativo genérico** (reutilizable fuera de correos):
  - Modo `pick` del protocolo `hermesagent://`:
    `hermesagent://pick?kind=folder|files&key=<id>`.
  - VBS → script local con diálogos nativos de Windows (PowerShell
    `FolderBrowserDialog` / `OpenFileDialog` multiselect).
  - Round-trip: el resultado sube a Convex con las credenciales del puente
    (`auth.mjs`, mismo mecanismo que zchat-server) y la web lo recibe
    pollando una query por `key`. Cancelar el diálogo también reporta
    `{cancelado}` para que la web no quede esperando.
  - Tabla efímera `pickResults` `{key, kind, paths[], cancelado, createdAt}`
    con limpieza automática (resultados > 1 h).
  - Validación: solo rutas absolutas existentes (las garantiza el diálogo).
- **Origen correo en la tarea**: `tasks.correoId` (lo estampa
  `crearTareaDeCorreo`; backfill para las existentes vía `correos.tareaId`).
  Query interna `_correoParaTarea` para el cuerpo completo.
- **Contexto acumulable**: `tasks.contextPaths = { carpetas: string[],
  archivos: string[] }`. Se setea al delegar la respuesta y se EXTIENDE en
  cada respuesta a pregunta (nunca se pisa).
- **Botón "Responder con el agente"** en el TaskModal (visible si la tarea
  tiene `correoId`) → panel de contexto → delega con `executor=zcode`,
  `taskType="correo"`.
- **taskType `correo`** (enum nuevo en schema/constants/tasks/agent):
  sin mundo de trabajo obligatorio — `--cwd` = primera carpeta de contexto,
  o carpeta por defecto del puente si no hay (`agent-bridge/workspace-correo`,
  se crea si falta). `validateDelegation` no exige vcs para este tipo.
- **Receta "correo"** en `prompts.mjs`: redactar UNA propuesta de respuesta
  en texto plano (saludo + cuerpo + despedida, sin firma, lista para pegar);
  las carpetas/archivos son material de consulta en SOLO LECTURA; no ejecutar
  ni modificar nada; si falta información → `--state pregunta` en vez de
  inventar; el borrador COMPLETO va en el `--summary` (sin el tope de "3
  líneas" que rige para los demás tipos).
- **"Copiar respuesta"** en AgentRunsPanel para corridas de tareas
  `taskType=correo`: copia el `summary` (el borrador) al portapapeles.
- **Respuesta a pregunta con contexto**: `answerQuestion` acepta
  `contextPaths` opcionales (chips + picker) que se agregan a la tarea; el
  followUp lista el material nuevo junto al texto de Cris.
- Notificaciones WhatsApp y ciclo para-revision/rechazo: sin cambios (los
  existentes funcionan tal cual).

**No incluye:**
- Envío automático de correos (regla de oro del contrato: el agente deja
  borradores; Cris pega y envía).
- Descarga automática de adjuntos (Power Automate): fase 1 el agente ve solo
  los NOMBRES; si los necesita, lo pide y Cris los baja y pasa la carpeta.
- Firma automática o asunto sugerido (texto plano sin firma; decisión
  diferida — trivial de sumar en la receta).
- HTML enriquecido, imágenes inline, respuestas a hilos automáticas.
- UI de triage de correos (sigue pendiente del PRD anterior).

## 5. Diseño técnico (diagrama)

```
[Picker nativo — round-trip]
  web: key = rnd() → location.href = hermesagent://pick?kind=…&key=…
    → VBS: PowerShell FolderBrowserDialog | OpenFileDialog(multi)
        aceptar → picker.mjs: getToken() (auth.mjs) → mutation
          correos-like `pickReportar {sessionToken, key, paths|cancelado}`
        → web (poll 500 ms de `pickResultado {key}`) → chips en el panel
    cancelar → pickReportar {cancelado:true} → web vuelve al estado anterior

[Flujo respuesta]
  tarea (correoId) → "Responder con el agente"
    ├─ indicación (texto) + contextPaths (picker, opcional)
    ├─ tasks.update {executor:zcode, taskType:"correo", contextPaths,
    │                correoId intacto, agentState:"encolada"}
    └─ puente claim → prompt:
         cuerpo completo (_correoParaTarea, truncado a 30 000) + remitente/
         fecha/asunto/adjuntos(nombres) + indicación + carpetas + archivos
         + receta correo (solo lectura, preguntar si falta, borrador en --summary)
       corrida → para-revision con la propuesta
         ├─ "Copiar respuesta" → portapapeles → Cris pega en Outlook
         ├─ rechazar + feedback → re-encola (resume) → re-redacta
         └─ pregunta → respuesta de Cris + contextPaths NUEVOS (se suman)
                         → followUp con texto + material nuevo → re-encola
```

- Tablas nuevas: `pickResults` (efímera). Campos nuevos: `tasks.correoId`,
  `tasks.contextPaths`. Enums: `correo` en taskType (schema ×2, constants,
  tasks.ts, agent.ts, prompts del puente).
- El `--cwd` de una corrida de correo no es mundo de trabajo: el agente no
  escribe. Carpetas/archivos de contexto viajan en el prompt como lista.
- Seguridad del picker: el único que reporta es un proceso local con las
  credenciales del puente (mismo trust que zchat); las rutas las elige un
  diálogo nativo (existen, absolutas). La web nunca escribe rutas a mano.

## 6. Casos de prueba

- [ ] Picker carpeta: elegir → chip con la ruta; cancelar → sin cambios y sin
      quedar "eligiendo…" colgado.
- [ ] Picker archivos multiselección → chips por archivo.
- [ ] Picker con el puente apagado → mensaje claro en la web (no spinner
      eterno; el protocolo no abre nada).
- [ ] "Responder con el agente" sin indicación → error de validación.
- [ ] Con carpeta + archivo + indicación → el prompt del agente contiene
      cuerpo completo (no el recorte), adjuntos por nombre y las rutas.
- [ ] Correo de 80 000 chars → prompt truncado a 30 000 sin romper.
- [ ] Agente termina → propuesta completa visible en el panel y botón
      "Copiar respuesta" copia exactamente el borrador.
- [ ] Rechazar con feedback → re-redacta conservando sesión y contexto.
- [ ] Agente pregunta → respuesta con texto + carpeta nueva → la tarea suma
      la carpeta (las anteriores siguen) y el followUp la lista.
- [ ] Segunda ronda de pregunta → contexto acumula (no duplica rutas).
- [ ] Tarea de correo completada desde el tablero → delegación cerrada como
      cualquier tarea (fix de coherencia ya en prod).
- [ ] taskType "correo" sin carpeta de contexto → correge en
      `agent-bridge/workspace-correo` (creada si falta).
- [ ] Una tarea SIN correoId no muestra "Responder con el agente".
- [ ] Backfill: tareas existentes de correo quedan con `correoId`.
- [ ] WhatsApp `final` avisa "propuesta lista" al llegar a para-revision.
- [ ] El agente NO puede escribir en la carpeta de contexto (receta + el
      borrador es solo texto; verificación manual en una corrida real).
- [ ] `pickResults` se limpia sola (entradas > 1 h).

## 7. Criterios de aceptación

- [ ] `tsc` + `npm run build` sin errores; VBS y scripts del puente con
      sintaxis validada.
- [ ] Casos de prueba del §6 pasando (los de UI en navegador con datos
      reales; picker probado con diálogo real de Windows).
- [ ] Prueba end-to-end con un correo real marcado: tarea → responder →
      propuesta copiada y pegada en Outlook.
- [ ] Resumen post-implementación en `docs/resumenes/`.

## 8. Riesgos y notas

- **El picker depende del puente corriendo** (credenciales): mismo trust y
  misma limitación que "Abrir carpeta" y el chat hoy. Mensaje claro si no.
- **Diálogos PowerShell**: primera ejecución puede tardar 1-2 s (JIT de
  .NET); aceptable para una acción explícita del usuario.
- **Borrador en `summary`**: tope actual 5 000 chars — suficiente para un
  correo; si algún borrador se pasa, se trunca y el agente lo avisa en el
  propio texto.
- **Contexto = rutas locales**: si Cris muede/renomra la carpeta después de
  delegar, el agente lo reporta como pregunta (no inventa). No se suben
  archivos a la nube: el agente lee del disco local.
- **Fase 2 natural** (no en este PRD): descarga automática de adjuntos por
  Power Automate a una carpeta por correo; firma/asunto sugerido; envío
  directo con confirmación (exigiría relajar la regla de oro a conciencia).
