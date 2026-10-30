# ADR 0008: Contrato de Detección de Conflictos (`detect_conflict`)

## Estado

Aceptado

## Contexto

En Conscious Tech, tras construir una propuesta semanal (`build_week`) y analizar el impacto de cambios sobrevenidos (`analyze_change`), es imprescindible disponer de una capacidad analítica que verifique si el plan contiene incompatibilidades materiales, estructurales o temporales antes de proponer ajustes.

El principio fundacional dicta:

> **La IA propone. La persona decide.**
> **Código antes que IA.**

Un conflicto no es una diferencia de opiniones ni una lista de deseos o prioridades en pugna: es una colisión demostrable mediante datos estructurados.

## Decisión

1. **Naturaleza Estricta de Sólo Lectura**:
   - `detect_conflict` no modifica, reorganiza ni resuelve el plan. Tampoco propone ajustes o alternativas de solución (responsabilidad delegada a la Skill 09 `propose_adjustments`).
   - Entrada: `currentDate`, `activePlan` (`ProposedWeek`), y opcionalmente `changeAnalysis`, `relationships`, `dayConstraints`, `timeBlocks` y `dailyAllocations`.
   - Salida: `DetectConflictOutput`.

2. **Taxonomía Canónica de Cuatro Tipos (`ConflictType`)**:
   - `capacity_deficit`: Superávit imposible: las horas requeridas y confirmadas superan la capacidad disponible (a nivel semanal o en una restricción diaria explícita).
   - `blocked_by_dependency`: Un elemento activo depende causalmente (`depends_on`) de un prerrequisito postergado, archivado o no planificado.
   - `deadline_incompatibility`: Incompatibilidad temporal en cadena de dependencias o plazos vencidos no ejecutables.
   - `schedule_overlap`: Colisión horaria demostrable en la misma franja horaria (bloques fijos concurrentes).

3. **Criterios de Diferenciación Diaria**:
   - `schedule_overlap` aplica **únicamente** cuando existen intervalos horarios demostrables superpuestos en el mismo día (`TimeBlock`).
   - Si la suma de trabajo asignado a un día supera la capacidad disponible de esa ventana (`DayConstraint` y `DailyWorkAllocation`), se clasifica estrictamente como `capacity_deficit` (ámbito `daily`), no como solapamiento horario.

4. **Niveles de Certeza y Regla de Bloqueo (`ConflictCertainty`)**:
   - `confirmed`: Evidencia demostrada matemáticamente o causalmente con datos completos.
   - `potential`: Riesgo probable sujeto a factores no formalizados o fechas internas movibles.
   - `insufficient_information`: Tensión sospechada pero con datos incompletos (e.g. tareas sin estimar o capacidad nula).
   - **Invariante Crítico**: Un conflicto con `certainty: "insufficient_information"` o `"potential"` **NUNCA activa `hasBlockingConflicts: true`**.

5. **Aislamiento Causal de Dependencias**:
   - Se excluyen terminantemente `part_of`, `related_to` y `same_project`. Solo la relación `depends_on` unida al estado real del prerrequisito demuestra bloqueo causal.

6. **Certificación Positiva de Áreas no Conflictivas (`unconflictedAreas`)**:
   - Un área (`foci`, `obligations`) solo se certifica si fue verificada positivamente con datos completos y capacidad conocida. Si la capacidad es desconocida (`null`), la skill no inventa conflictos pero tampoco certifica que el plan esté libre de conflicto.

7. **Implementación 100 % Determinista (v1)**:
   - Todo el motor opera mediante reglas de código puro, sin llamadas a LLM ni consumo de tokens.

## Consecuencias

- 10 fixtures canónicos verificados cubren desde conflictos confirmados hasta tensiones potenciales, incertidumbres y planes limpios.
- Sienta una base sólida y objetiva para la Skill 09 (`propose_adjustments`).
