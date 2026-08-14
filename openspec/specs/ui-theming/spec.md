# UI Theming Specification

## Purpose

Sistema visual de 4 temas intercambiables vía CSS variables, con fondos
animados por tema y accesibilidad de movimiento. No hay toggle claro/oscuro:
el tema claro es "papel".

## Requirements

### Requirement: Cuatro temas
El sistema SHALL ofrecer exactamente 4 temas seleccionables desde la
Toolbar: `terminal` (default, CRT ámbar sobre negro, JetBrains Mono),
`paper` (claro, editorial serif Lora, color-scheme light), `brutal`
(neo-brutalista, acento amarillo, sombras duras) y `matrix` (ciberpunk
verde). Se aplican con `data-theme` en `<html>`; cada tema define paleta,
fuentes, radios, bordes, sombras y los tonos `--status-*` y `--area-*`.

#### Scenario: Cambiar a papel
- **WHEN** se selecciona el tema papel
- **THEN** toda la UI pasa al esquema claro serif sin recargar

### Requirement: Persistencia del tema
El sistema SHALL persistir el tema en `localStorage["cat-theme"]` y eliminar
activamente el sistema legacy (`hermes-theme` + clase `.dark`) al arrancar.

#### Scenario: Recargar la página
- **WHEN** se recarga con tema brutal elegido
- **THEN** el tema persiste sin flash visible

### Requirement: Fondos animados por tema
El sistema SHALL renderizar un fondo distintivo por tema: MatrixRain
(canvas katakana), TerminalScan (scanlines CRT + fósforo), PaperGlyphs
(glifos tipográficos flotantes) y BrutalShapes (geometría rotante); todos
se desactivan bajo `prefers-reduced-motion`.

#### Scenario: Usuario con reduced motion
- **WHEN** el SO pide reducir movimiento
- **THEN** los fondos quedan estáticos (y el ícono En curso no gira)

### Requirement: Tokens semánticos
Los componentes SHALL consumir clases utilitarias semánticas (`.input`,
`.label`, `.btn-primary`, `.card`, `.chip`) y clases Tailwind mapeadas a
variables (`bg-panel`, `text-ink`, `border-line`, `rounded-el`), nunca
colores crudos, para que los 4 temas funcionen sin tocar los componentes.

#### Scenario: Nuevo componente con tokens
- **WHEN** un componente usa bg-panel/text-ink/border-line
- **THEN** se ve correcto en los 4 temas sin CSS adicional

### Requirement: Responsivo universal
El sistema SHALL ser 100% responsivo: Kanban con scroll horizontal snap en
móvil (columnas 82vw), toolbar con búsqueda en segunda fila, botones con
labels ocultos en pantallas chicas y respeto de safe-area-inset-bottom.

#### Scenario: Usar el tablero desde el celular
- **WHEN** se abre en un viewport angosto
- **THEN** las columnas se deslizan horizontalmente con snap y el modal
  ocupa la pantalla completa desde abajo
