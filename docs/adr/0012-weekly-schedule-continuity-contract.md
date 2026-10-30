# ADR 0012: Contrato de Continuidad Temporal de la Agenda (`WeeklySchedule`)

## Estado

Aceptado

## Contexto

En Conscious Tech rige el principio fundacional:

> **La IA propone. La persona decide.**
> **Código antes que IA.**
> **No hay mutaciones silenciosas.**

La Skill 06 (`build_week`) genera la propuesta macro semanal ([`ProposedWeek`](file:///Users/elena/Developer/Conscious_tech/src/domain/week.ts#L217)), que contiene focos, compromisos, opciones flexibles y capacidad agregada.
Sin embargo, durante la semana surgen restricciones horarias y desequilibrios diarios que las Skills 08 (`detect_conflict`) y 09 (`propose_adjustment`) modelan mediante franjas horarias fijas ([`TimeBlock`](file:///Users/elena/Developer/Conscious_tech/src/domain/conflict.ts#L67)) y asignaciones de esfuerzo por jornada ([`DailyWorkAllocation`](file:///Users/elena/Developer/Conscious_tech/src/domain/conflict.ts#L83)).

Hasta ahora, estos bloques y asignaciones diarias vivían como parámetros efímeros de entrada o sugerencias dentro del informe de reajuste. Al llegar a la Skill 11 (`close_week`), la micro-agenda y las decisiones de reajuste tomadas por la persona durante la semana se perdían, forzando a re-explicar postergaciones y privando al cierre de evaluar la disciplina temporal real.

Este ADR define el contrato cerrado de continuidad temporal de la agenda (`WeeklySchedule`), desacoplado de `ProposedWeek`, con ciclo de vida riguroso de decisiones, atomicidad funcional y sin persistencia prematura.

---

## Decisiones de Arquitectura

### 1. Desacoplamiento Estricto: `WeeklySchedule` Independiente de `ProposedWeek`

- `ProposedWeek` se mantiene intacto como la representación de la **intención macro estratégica** (focos, compromisos, opciones flexibles y capacidad semanal).
- Se introduce `WeeklySchedule` como un modelo de dominio independiente que representa el **estado temporal vigente de la agenda**.
- La vinculación entre ambos es referencial mediante `planId` y el rango temporal `weekRange: TargetWeek`.
- No se infla `ProposedWeek` con estructuras de micro-calendario.

### 2. Franjas Horarias Intra-Día Estrictas

- Se mantiene la restricción del contrato actual: todo `TimeBlock` debe satisfacer estrictamente `startTime < endTime` en formato `HH:MM` dentro del mismo día calendario gregoriano (`YYYY-MM-DD`).
- **Los intervalos que cruzan medianoche quedan formalmente fuera del contrato inicial.** Si un usuario declara un evento nocturno (ej. 23:00 a 01:00), debe representarse como dos bloques discretos acotados por la medianoche o mantenerse fuera de la agenda horaria fija.

### 3. Semántica del Historial y Separación Ortogonal de Dimensiones

Para garantizar que ninguna transición posterior borre la evidencia histórica de lo ocurrido, el registro de cada reajuste desacopla tres dimensiones ortogonales:

1. **Decisión humana (`humanDecision`)**:
   - `"accepted"`: La persona aceptó explícitamente la propuesta.
   - `"rejected"`: La persona descartó explícitamente la propuesta.
2. **Resultado técnico de aplicación (`applicationOutcome`)**:
   - `"applied"`: La mutación se consolidó exitosamente sobre los bloques o asignaciones.
   - `"failed"`: La aplicación no pudo ejecutarse (p. ej., colisión horaria sobrevenida o versión desactualizada).
3. **Vigencia en la agenda (`lifecycleStatus`)**:
   - `"active"`: El cambio rige actualmente en la agenda vigente.
   - `"superseded"`: Un reajuste posterior sobre el mismo bloque o ítem sustituyó a este cambio.
   - `"reverted"`: El cambio fue deshecho mediante una operación explícita de reversión posterior.

#### Matriz de Transiciones de Estado Permitidas

| Estado Inicial      | Evento Desencadenante                         | `humanDecision`            | `applicationOutcome`      | `lifecycleStatus` | Notas                                       |
| :------------------ | :-------------------------------------------- | :------------------------- | :------------------------ | :---------------- | :------------------------------------------ |
| _Propuesta emitida_ | Usuario acepta y validación pasa              | `"accepted"`               | `"applied"`               | `"active"`        | Muta bloques en nueva versión de agenda.    |
| _Propuesta emitida_ | Usuario acepta pero validación falla          | `"accepted"`               | `"failed"`                | `"active"`        | Agenda intacta; no muta versión.            |
| _Propuesta emitida_ | Usuario rechaza la propuesta                  | `"rejected"`               | `"failed"`                | `"active"`        | Agenda intacta; registra el rechazo.        |
| `"active"`          | Reajuste posterior sobre el mismo ítem/bloque | `"accepted"` _(inmutable)_ | `"applied"` _(inmutable)_ | `"superseded"`    | Preserva evidencia histórica de aceptación. |
| `"active"`          | Acción explícita de reversión                 | `"accepted"` _(inmutable)_ | `"applied"` _(inmutable)_ | `"reverted"`      | Preserva evidencia histórica de aceptación. |

_Invariante Absoluta:_ Ningún estado borra la evidencia histórica de una decisión aceptada y aplicada. Los campos `humanDecision`, `decidedAt`, `applicationOutcome` y `appliedAt` son de solo anexado e inmutables.

### 4. Atomicidad y Función Pura de Aplicación

La aplicación de un reajuste sobre la agenda se ejecuta exclusivamente a través de la función determinista y pura:

$$\text{applyAdjustmentToSchedule}(S_{\text{v}}, D, T) \to \text{ApplyAdjustmentResult}$$

```ts
export type ApplyAdjustmentResult =
  | {
      status: "success";
      schedule: WeeklySchedule; // Nueva versión inmutable (version = v + 1)
      appliedRecord: ScheduleAdjustmentRecord;
    }
  | {
      status: "failed";
      schedule: WeeklySchedule; // Agenda original intacta (version = v)
      failedRecord: ScheduleAdjustmentRecord;
      errorCode:
        | "stale_schedule_version"
        | "item_not_found"
        | "schedule_overlap"
        | "constraint_violation"
        | "insufficient_source_hours";
      failureReason: string;
    };
```

- **Atomicidad estricta:** Ante cualquier error de validación, la función devuelve el resultado de fallo y conserva intacta la agenda vigente. No se producen mutaciones parciales ni efectos secundarios.

### 5. Control de Versiones y Detección de Concurrencia

- La función de aplicación verifica como precondición obligatoria:
  $$\text{decision.expectedScheduleVersion} === \text{schedule.version}$$
- **Tratamiento de versión obsoleta:** Si la versión difiere, la operación falla inmediatamente con `errorCode: "stale_schedule_version"`.
- **Regla de oro:** Una versión obsoleta **requiere volver a evaluar la propuesta contra el estado actual de la agenda** (re-ejecutando `detect_conflict` y `propose_adjustment`). **Bajo ninguna circunstancia se permite forzar la aplicación automática de una propuesta desactualizada.**

### 6. Validación de Sobrecarga y Restricciones Diarias

- **Sin `DayConstraint` explícito:** No se inventa un límite universal o arbitrario (p. ej., no se asume un tope de 8h ni 10h si la persona no lo declaró). La redistribución de horas se permite siempre que cumpla las invariantes de conservación de horas y de ítems, delegando la detección y advertencia de riesgos a `detect_conflict`.
- **Con `DayConstraint` explícito:** Si el día destino posee una restricción formal declarada (`availableHours` o `isNonWorkingDay: true`), la aplicación valida:
  1. Que el día no esté marcado como `isNonWorkingDay: true`.
  2. Que la nueva carga diaria no supere `availableHours`.
     Si alguna de estas condiciones se incumple, la aplicación falla con `errorCode: "constraint_violation"`.

### 7. Invariantes de `DailyWorkAllocation`

- **Conservación Estricta de Horas en Redistribución (`reallocate_day_work`)**:
  $$\sum_{d \in \text{semana}} \text{allocatedHours}(d)_{\text{post}} = \sum_{d \in \text{semana}} \text{allocatedHours}(d)_{\text{ante}}$$
  Las horas movidas se restan exactamente del día origen y se suman en el día destino.
- **Asignación Parcial Permitida**:
  No se exige igualdad universal entre las horas estimadas macro y las asignadas en agenda diaria:
  $$\sum_{d \in \text{semana}} \text{allocatedHours}(d, \text{item}) \le \text{estimatedHours}(\text{item})$$
  Se admite que una persona agende solo una fracción de su esfuerzo y mantenga el resto como flexible.
- **Cambios de Alcance**: Un cambio en las horas totales estimadas debe provenir de una acción formal de tipo `reduce_scope` o `negotiate_deadline`, no de una simple redistribución de calendario.

### 8. Compatibilidad y Reconocimiento en `close_week`

En `src/domain/close-week.ts`:

```ts
export const CloseWeekInputSchema = z
  .object({
    closedAt: IsoUtcTimestampSchema,
    activePlan: ProposedWeekSchema,
    schedule: WeeklyScheduleSchema.optional(), // Estrictamente opcional
    itemOutcomes: z.array(ItemOutcomeInputSchema).default([]),
    userReflection: UserReflectionInputSchema.optional(),
  })
  .strict();
```

- **Sin agenda (`schedule === undefined`)**:
  - `close_week` opera a nivel macro (focos, compromisos, capacidad semanal agregada).
  - **No infiere franjas horarias.**
  - **No afirma cumplimiento ni vulneración de espacio protegido diario** (`spaceRespected: null` en granularidad diaria).
  - No inventa horas reales por día ni penaliza por falta de agenda.
- **Con agenda (`schedule` presente)**:
  - Evalúa la coherencia entre los bloques agendados y los resultados reportados.
  - Comprueba si se respetó el espacio protegido diario día por día.
- **Reconocimiento de Postergaciones Conscientes**:
  - `close_week` busca en `schedule.appliedAdjustments` registros que cumplan estrictamente:
    1. `action.type === "postpone_item"`
    2. `action.itemId === item.itemId`
    3. `humanDecision === "accepted"`
    4. `applicationOutcome === "applied"`
    5. `lifecycleStatus === "active"`
  - Si se cumplen las 5 condiciones:
    - Clasifica el ítem como `consciously_postponed`.
    - Adopta la justificación del reajuste aceptado, **sin pedir una segunda justificación al usuario**.
    - Emite un candidato a memoria con procedencia `plan_decision` y referencia estructurada verificable hacia el `adjustmentId`.
  - Si no consta la evidencia de aceptación y aplicación previa, **no se reconoce**: el ítem se clasifica como `unreported` o `not_started`, exigiendo reporte manual. Una propuesta no es una decisión.

### 9. Límites de Granularidad, Identidad y Evolución del Historial

1. **Redistribuciones Encadenadas (`reallocate_day_work`)**:
   - La regla heurística `newAction.sourceDay === prevRecord.action.targetDay` identifica una relación operativa entre reajustes secuenciales, pero **no demuestra por sí sola que el ajuste previo haya sido sustituido semánticamente**.
   - _Ejemplo:_ Si la persona traslada 2h de lunes a martes (Ajuste 1) y más adelante mueve 1h de martes a jueves (Ajuste 2), el Ajuste 2 es una continuación del flujo de trabajo, no el reemplazo del Ajuste 1. El Ajuste 1 sigue explicando por qué se retiraron horas del lunes original.
   - _Criterio arquitectónico:_ El historial debe preservar ambos ajustes como `"active"` mientras ambos sigan describiendo cambios vigentes sobre la agenda. El estado `"superseded"` solo debe aplicarse cuando un reajuste posterior invalida o reemplaza directamente el alcance del anterior (como la reversión del mismo par, redefinición completa de la misma asignación o postergación total del ítem con `postpone_item`).

2. **Identidad de `TimeBlock`: Coincidencia Estructural vs `blockId` Persistente**:
   - Actualmente, `TimeBlock` se modela como un _Value Object_ sin identificador discreto, identificado por su coincidencia estructural `(itemId, day, startTime, endTime)`.
   - Esta coincidencia es suficiente y determinista bajo la premisa de que no coexistan bloques idénticos duplicados para el mismo ítem en el mismo horario exacto.
   - Si en el futuro el dominio admitiese bloques duplicados concurrentes con idéntico ítem, día y horario, será indispensable introducir un `blockId` estable y persistente para desambiguar qué bloque específico es modificado o sustituido en el historial.

---

## Esquemas de Datos Canónicos

```ts
// src/domain/schedule.ts

export const ScheduleAdjustmentRecordSchema = z
  .object({
    adjustmentId: z.string().min(1),
    proposalId: z.string().min(1),
    action: AdjustmentActionSchema,
    expectedScheduleVersion: z.number().int().positive(),
    decidedAt: IsoUtcTimestampSchema,
    humanDecision: z.enum(["accepted", "rejected"]),
    userNotes: z.string().optional(),
    applicationOutcome: z.enum(["applied", "failed"]),
    appliedAt: IsoUtcTimestampSchema.optional(),
    failureReason: z.string().optional(),
    lifecycleStatus: z.enum(["active", "superseded", "reverted"]),
  })
  .strict();
export type ScheduleAdjustmentRecord = z.infer<typeof ScheduleAdjustmentRecordSchema>;

export const WeeklyScheduleSchema = z
  .object({
    scheduleId: z.string().min(1),
    planId: z.string().min(1),
    weekRange: TargetWeekSchema,
    timeBlocks: z.array(TimeBlockSchema),
    dailyAllocations: z.array(DailyWorkAllocationSchema),
    dayConstraints: z.array(DayConstraintSchema).optional(),
    appliedAdjustments: z.array(ScheduleAdjustmentRecordSchema),
    version: z.number().int().positive(),
    createdAt: IsoUtcTimestampSchema,
    updatedAt: IsoUtcTimestampSchema,
  })
  .strict();
export type WeeklySchedule = z.infer<typeof WeeklyScheduleSchema>;
```

---

## Casos de Prueba Requeridos (`tests/schedule-lifecycle.test.ts`)

1. **Reasignación Exitosa de `TimeBlock`**:
   - `schedule` v1 con bloque el martes 10:00–11:00.
   - Decisión aceptada para mover a jueves 15:00–16:00 con `expectedScheduleVersion: 1`.
   - Resultado: `status: "success"`, agenda v2 con bloque en jueves, registro `"applied"` y `"active"`.
2. **Rechazo Humano**:
   - Decisión con `humanDecision: "rejected"`.
   - Resultado: agenda v1 intacta (versión no se incrementa), registro registrado con `"rejected"`, `"failed"`.
3. **Rechazo por Concurrencia (`stale_schedule_version`)**:
   - Intento de aplicar con `expectedScheduleVersion: 1` sobre una agenda que ya está en v2.
   - Resultado: `status: "failed"`, `errorCode: "stale_schedule_version"`, agenda v2 intacta.
4. **Validación de Restricción Diaria Explícita**:
   - Mover 4h a un día con `DayConstraint(availableHours: 2)`.
   - Resultado: `status: "failed"`, `errorCode: "constraint_violation"`, agenda intacta.
5. **Permisión de Sobrecarga Sin Restricción Explícita**:
   - Mover 4h a un día sin `DayConstraint` donde ya había 8h asignadas (total 12h).
   - Resultado: `status: "success"`, agenda v2 actualizada. Una posterior llamada a `detect_conflict` señala la sobrecarga.
6. **Conservación Estricta de Horas en `reallocate_day_work`**:
   - Verificación de que la suma de horas asignadas en todos los días antes y después de la redistribución es idéntica al micro-segundo.
7. **Semántica de `superseded` vs `reverted`**:
   - Reajuste 1 aplicado (`"active"`).
   - Reajuste 2 aplicado sobre el mismo bloque $\to$ Reajuste 1 transiciona a `"superseded"`, conservando `humanDecision: "accepted"` y `applicationOutcome: "applied"`.
   - Reversión explícita $\to$ Reajuste 2 transiciona a `"reverted"`, restaurando el bloque original en una nueva versión.
8. **Reconocimiento en `close_week`**:
   - Ítem no completado con postergación aplicada en `schedule` $\to$ `close_week` lo clasifica como `consciously_postponed` adoptando la justificación del reajuste sin pedir re-confirmación.
   - Ítem con propuesta sugerida pero rechazada $\to$ `close_week` no lo reconoce como postergación consciente y lo clasifica como `unreported`/`not_started`.
9. **Invariancia Sin Agenda**:
   - `close_week` ejecutado sin `schedule` $\to$ comportamiento y análisis de capacidad agregada idénticos a los existentes, sin inferir datos diarios.

---

## Consecuencias

- Cierra con rigor la continuidad temporal entre el análisis de conflictos a mitad de semana y la retrospectiva semanal.
- Garantiza la soberanía de la persona: las decisiones humanas quedan grabadas de forma inmutable y determinan la agenda.
- Mantiene el código libre de efectos secundarios y preparado para una futura persistencia mediante un almacén de eventos.
