# PWA Android Specification

## Purpose

La app es instalable en Android como Progressive Web App (WebAPK) desde
Chrome, sin tiendas ni toolchain nativo. **Restricción dura del proyecto: la
experiencia web de escritorio queda EXACTAMENTE igual** — toda la capa PWA
está scopeada a móvil/instalada y protegida por una compuerta de
no-regresión visual.

## Requirements

### Requirement: Instalable en Android
El sistema SHALL exponer `manifest.webmanifest` (name "Hermes Task
Tracker", short_name "Hermes", display standalone, start_url/scope "/",
theme_color y background_color `#010603`) con iconos 64/192/512 + variante
maskable generados desde `public/logo.svg` (marca ámbar terminal).

#### Scenario: Instalar desde Chrome Android
- **WHEN** se abre la app en Chrome Android y se elige "Instalar aplicación"
- **THEN** se crea un WebAPK con ícono propio que abre standalone sin barra
  URL

### Requirement: Service worker scopeado a móvil
El sistema SHALL registrar el service worker (precache del app-shell,
`navigateFallback /index.html`, autoUpdate) SOLO cuando el contexto es
móvil (`pointer: coarse`) o instalado (`display-mode: standalone`); en
escritorio el registro es null y el comportamiento de red es el original.

#### Scenario: Desktop sin service worker
- **WHEN** se carga la app en desktop
- **THEN** `navigator.serviceWorker.getRegistration()` resuelve null y el
  gate pixel-diff contra el baseline pre-PWA pasa

### Requirement: No-regresión visual de escritorio
La suite e2e SHALL comparar screenshots de las vistas (Tablero, Lista,
Calendario, Catch-up, modal, Login) en 1280/1440 contra un baseline capturado
del estado pre-PWA (pixelmatch, tolerancia 0.4% general / 2% Catch-up por
datos vivos); cualquier diff bloquea la entrega.

#### Scenario: Gate de entrega
- **WHEN** se corre la suite después de un cambio
- **THEN** desktop debe ser pixel-idéntico al baseline; móvil se valida en
  la matriz responsive

### Requirement: Extras móviles scopeados
El sistema SHALL ofrecer en móvil únicamente: botón "Instalar app"
(beforeinstallprompt capturado; en Toolbar y Login), banner "Sin conexión —
reconectando…" y `navigator.storage.persist()` tras login. `overscroll-behavior-y:
none` scopeado a coarse/<640px y standalone (sin pull-to-refresh accidental).

#### Scenario: Offline con app-shell precacheado
- **WHEN** el dispositivo pierde red tras instalar
- **THEN** la recarga sirve el shell desde precache (login visible) en vez
  de la página de error del navegador

### Requirement: Limitación conocida offline-con-sesión
El sistema NO SHALL prometer datos offline: con sesión guardada y sin red,
`verifySession` queda pendiente y se muestra el spinner hasta reconectar
(Convex no es offline-first); documentado en README.

#### Scenario: Sin red con sesión guardada
- **WHEN** el dispositivo pierde conexión con un token válido
- **THEN** se muestra el estado de carga hasta que Convex reconecte (sin
  datos falsos ni fila de mutaciones fantasma)
