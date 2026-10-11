# ADR 0009: Contrato de Propuesta de Ajustes (`propose_adjustment`)

## Estado
Aceptado

## Contexto
En Conscious Tech, tras detectar conflictos materiales, temporales o de capacidad mediante la Skill 08 (`detect_conflict`), el sistema debe proporcionar alternativas de ajuste respetando el principio central del producto:

> **La IA propone. La persona decide.**
> **Código antes que IA.**

La Skill 09 (`propose_adjustment`) formula hasta tres alternativas de reajuste estructuradas, independientes y materialmente distintas para ayudar a la persona a recuperar la viabilidad y calma de su plan sin tomar decisiones por ella ni mutar silenciosamente el plan semanal activo.

## Decisión

1. **Inmutabilidad y No-Aplicación Automática**:
   - `propose_adjustment` es estrictamente propositiva. No muta `activePlan`, no aplica cambios en cascada y no compromete automáticamente el tiempo del usuario.
   - Las alternativas son opciones discretas que la persona puede revisar, elegir o descartar.

2. **Acciones Tipadas (Unión Discriminada)**:
   - `postpone_item`: posterga una tarea a `deferredItems` liberando carga.
   - `reassign_time_block`: reasigna un bloque horario fijo a una franja libre conservando su duración exacta al minuto.
   - `reallocate_day_work`: traslada trabajo asignado de un día sobrecargado a otro día con capacidad disponible demostrada.
   - `unblock_dependency`: condiciona el trabajo activo a la resolución externa de un prerrequisito.
   - `accept_risk`: registra la decisión consciente de asumir una tensión o riesgo potencial sin modificar el plan.
   - `request_information`: solicita datos faltantes indispensables al usuario.

3. **Invariante de Conservación y Partición Exacta del 100 % ($S_{\text{total}}$)**:
   - Para cada propuesta generada, todos los ítems de `activePlan` se particionan de forma biyectiva y disjunta en:
     $$S_{\text{total}} = \text{affectedPlanItemIds} \ \dot\cup \ \text{retainedPlanItemIds} \ \dot\cup \ \text{previouslyDeferredItemIds}$$
   - Se prohíben terminantemente ítems fantasma, omisiones o duplicaciones entre subconjuntos.

4. **Trazabilidad de Conflictos Preservando Certeza Original**:
   - `addressedConflictIds`: conflictos que la propuesta ataca directamente.
   - `resolvedConflictIds`: conflictos que la propuesta elimina demostrablemente ($\subseteq \text{addressedConflictIds}$). Solo puede tener elementos si `viability === "viable"`.
   - `unresolvedConflictIds` y `unresolvedBreakdown`: preservan los conflictos residuales desglosados en `confirmed`, `potential` e `insufficientInformation`. Aceptar un riesgo nunca lo elimina de los residuales.
   - `unaddressedConflictIds` global: conflictos del plan que ninguna propuesta del catálogo atiende.

5. **Aritmética Estricta de Balance Bruto**:
   - Se prohíbe `max(0, ...)` o cualquier truncamiento artificial. El balance bruto $H_{\text{raw}} = H_{\text{orig}} - \text{netHoursFreed}$ debe ser estrictamente no negativo; balances negativos se rechazan de inmediato como inconsistencia matemática.
   - Estimaciones desconocidas (`null`) nunca se asumen como cero.
   - Si una tarea postergada no cubre el déficit semanal completo, la propuesta se califica como reducción parcial (`conditional`) y no declara resuelto el déficit.

6. **Validación de Bloques Horarios y Colisiones Intra-Ítem**:
   - Las reasignaciones de horario conservan exactamente la duración en minutos del bloque de origen.
   - La detección de colisiones excluye únicamente el bloque de origen exacto (`currentBlock`), detectando colisiones con otros bloques de cualquier ítem e incluso del mismo ítem.

7. **Cuatro Estados de Salida Mutuamente Excluyentes**:
   - `no_adjustment_needed`: plan verificado sin conflictos, dentro de capacidad y con estimaciones completas.
   - `clarification_required`: capacidad desconocida o ausencia de datos esenciales.
   - `no_viable_alternatives`: conflictos bloqueantes confirmados donde ninguna alternativa viable es posible sin renegociar obligaciones rígidas o límites externos.
   - `adjustments_proposed`: entre 1 y 3 alternativas estructuradas y materialmente distintas.

8. **Implementación 100 % Determinista**:
   - Todo el motor opera mediante reglas de código puro en TypeScript y esquemas Zod, con cero llamadas a proveedores de IA y cero consumo de tokens.

## Consecuencias
- 14 tests canónicos de fixtures y 20 tests unitarios de dominio verifican la totalidad de las invariantes.
- Proporciona una base sólida, auditable y segura para la interacción del usuario o la posterior confirmación de ajustes (Skill 10).
