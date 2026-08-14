# Security Specification

## Purpose

Hardening de la superficie del backend Convex y del cliente. Todo requiere
sesión; los datos nunca se borran físicamente; el workspace ClickUp real
solo se escribe desde producción.

## Requirements

### Requirement: Guard de sesión en todo el backend
El sistema SHALL exigir sesión válida en TODAS las queries y mutations
públicas (`requireAuth` en tasks/subtasks/settings/catchups) y en las
actions públicas (vía `_checkSession`); sin sesión, la operación se
rechaza. Las funciones `internal*` quedan fuera del alcance público.

#### Scenario: Llamar a la API sin token
- **WHEN** se invoca `tasks.list` sin sessionToken válido
- **THEN** la operación se rechaza con error de autorización

### Requirement: Seed protegido por admin token
El sistema SHALL exigir `HERMES_ADMIN_TOKEN` para la mutation
`resetAndSeed` (que vacía la DB); el script local `npm run seed` lo pasa
desde `.env.local`.

#### Scenario: Seed sin token admin
- **WHEN** se llama resetAndSeed con token incorrecto
- **THEN** se rechaza y no se toca la base

### Requirement: Validación server-side
El sistema SHALL validar en backend independientemente del cliente:
progreso acotado 0–100, límites de longitud en textos libres, áreas y
estados del union cerrado.

#### Scenario: Cliente malicioso envía progress 9999
- **WHEN** la mutation recibe progress 9999
- **THEN** se persiste 100 (clamp), no 9999

### Requirement: CSP y silencio en producción
El sistema SHALL incluir Content-Security-Policy en `index.html` y NO
volcar stack traces a consola en producción (solo en DEV).

#### Scenario: Error de sync en producción
- **WHEN** falla una llamada a ClickUp en prod
- **THEN** el mensaje queda registrado en la tarea, sin stack trace en
  consola

### Requirement: Guards de entorno para escritura en ClickUp
El sistema SHALL bloquear el sync outbound en dev salvo override explícito
(`settings clickup.forceSyncDev=true`); la señal de producción es
`HERMES_ENV=production` (antes se detectaba mal y prod se creía dev).

#### Scenario: Dev sin override
- **WHEN** se crea una tarea patagonia en el deployment de dev
- **THEN** no se escribe nada en ClickUp
