# ADR 0007: Contrato de Impacto y Análisis de Cambio (`analyze_change`)

## Estado
Aceptado

## Contexto
Tras completar Skill 06 (`build_week`), el usuario cuenta con un plan semanal estructurado (`ProposedWeek`). En la operativa real surgen imprevistos, tareas adicionales, cambios de disponibilidad, cancelaciones o renegociaciones de plazos.

El principio fundacional de Conscious Tech dicta:
> **La IA propone. La persona decide.**
> **Código antes que IA.**

No se debe mutar el plan activo de forma silenciosa ni saltar directamente a replanificar o resolver conflictos sin antes informar al usuario con precisión sobre qué elementos, compromisos, dependencias y márgenes resultan afectados.

## Decisión

1. **Naturaleza de Sólo Lectura**:
   - `analyze_change` es una skill exclusivamente analítica.
   - Entrada: `currentDate`, `activePlan` (`ProposedWeek`), `changeDescription`, y opcionalmente `incomingDelta` (`IncomingChangeDelta`).
   - Salida: `AnalyzeChangeOutput`.
   - **Invariante**: Nunca modifica, reconstruye ni devuelve un `ProposedWeek` alterado. Tampoco reasigna prioridades ni toma decisiones por el usuario.

2. **Tipificación de Cambios (`ChangeType`)**:
   - `new_item`: incorporación de elemento.
   - `drop_item`: retirada explícita de elemento.
   - `modified_item`: modificación de atributos sin cambio de fecha ni dependencia.
   - `deadline_change`: cambio exclusivo de fecha límite.
   - `dependency_change`: adición o eliminación de dependencia causal (`depends_on`).
   - `capacity_change`: variación de horas disponibles semanales.
   - `mixed_change`: combinación ortogonal o simultánea de múltiples tipos de cambio.
   - `none_detected`: texto sin impacto estructural detectable o conversación neutra.

3. **Aritmética Determinista de Capacidad (`CapacityImpactAnalysis`)**:
   - Si `totalAvailableHours` o `plannableHours` es desconocido o nulo, `arithmeticBalance` es estrictamente `"unknown_capacity"`. No se asumen valores arbitrarios.
   - Si las estimaciones son incompletas (`estimationCompleteness !== "complete"`) o se añaden items sin estimación, `arithmeticBalance` es `"indeterminate"` (a menos que las horas conocidas ya excedan matemáticamente la capacidad disponible, en cuyo caso es `"deficit_known"`).
   - `"surplus_known"` se certifica exclusivamente cuando todas las estimaciones están completas y caben dentro de la capacidad disponible proyectada respetando el ratio de espacio protegido.

4. **Grafo Causal y Dependencias**:
   - Se procesan exclusivamente relaciones de causalidad temporal directa (`depends_on`). Se ignoran categorizaciones semánticas como `part_of` o `related_to`.
   - Estados de dependencia: `"satisfied"` (desbloqueada o retirada), `"pending"` (bloqueante), `"unknown"`.
   - Un desbloqueo (`satisfied`) NO requiere intervención del usuario; simplemente se informa.

5. **Prueba Positiva de Aislamiento (`unaffectedAreas`)**:
   - No se declara un área indemne por omisión. Se requiere prueba positiva de que ni sus elementos ni sus dependencias fueron modificados ni alcanzados por el delta.

6. **Gatillos de Intervención del Usuario (`requiresUserIntervention`)**:
   - La intervención se solicita únicamente ante situaciones críticas demostradas:
     - Déficit aritmético confirmado (`deficit_known`).
     - Ruptura de integridad de un foco activo (`focus_integrity`).
     - Dependencia causal sobrevenida en estado pendiente (`pending`).
     - Fecha límite crítica desplazada a una fecha pasada o anterior al inicio de la semana (cuando se trata de un compromiso activo vencido que requiere conciliación explícita).
   - **Principio de no-prescripción en plazos pasados**: La presencia de un plazo o fecha anterior a la semana comunica el hecho y su impacto (`temporalScope: "past"`, `category: "deadline_risk"`), pero **no constituye una regla universal para obligar a rehacer el plan**. La skill informa con precisión sin decidir automáticamente que el plan activo queda invalidado o deba replanificarse.

7. **Validación de Referencias y Fallo Seguro**:
   - Cualquier operación que intente modificar o eliminar un identificador no existente en el plan activo ni en el delta genera un `ValidationError` (`fatal: true`) y concluye con `status: "invalid_references"` sin corromper el modelo.

## Consecuencias
- Skill 07 queda implementada y verificada mediante 348 tests automatizados sin consumo de tokens ni llamadas de red.
- Sienta las bases para Skill 08 (`detect_conflicts`) y Skill 09 (`propose_adjustments`) manteniendo la separación de responsabilidades.
