# Catch-up Weekly Specification (delta)

## ADDED Requirements

### Requirement: Sección de imprevistos de la semana
El sistema SHALL incluir en el resumen semanal una sección retráctil
"Imprevistos" con los imprevistos surgidos en la ventana (título, día,
si se resolvieron el mismo día y si fueron promovidos) y el contador
`metrics.unplanned`. La sección se congela en el snapshot al cerrar la
semana (mismo mecanismo que el resto) y los snapshots anteriores a la
feature la muestran vacía sin errores.

#### Scenario: Semana con imprevistos
- **WHEN** la ventana contiene 5 imprevistos, 3 resueltos el mismo día
- **THEN** la sección retráctil lista los 5 con su estado
- **AND** el contador marca 5

#### Scenario: Snapshot viejo
- **WHEN** se abre una semana cerrada antes de la feature
- **THEN** la sección de imprevistos no aparece (o aparece vacía) sin
  errores de lectura
