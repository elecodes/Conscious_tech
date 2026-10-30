# MEMORY.md

This file contains important project context and decisions that should survive across development sessions.

It is not a full specification.

---

## Project identity

**Conscious Tech**

The project explores a more conscious, human-centered way of using technology and AI.

The goal is not to help people simply do more.

The goal is to help people create **clarity, intention, and better decisions** when using technology.

---

## Current product direction

The first product is a weekly clarity/focus system.

A person can express everything they currently have in their head — by writing or speaking — and the system helps them understand it, identify relationships, decide what deserves attention, and create a realistic week.

The system should help the person reach:

> **“Ahora veo con claridad qué quiero cuidar.”**

Not:

> “La IA me ha dicho qué tengo que hacer.”

---

## Core principles

### AI proposes. The person decides.

The AI can:

- understand
- organize
- detect relationships
- explain
- propose

The person decides:

- what matters
- what to prioritize
- what to postpone
- what to remove
- what changes when something new appears

### Space is part of the plan

The system must never assume that 100% of available time should be planned.

Uncommitted space is intentional.

It allows for:

- unexpected events
- tasks taking longer
- thinking
- rest
- flexibility
- doing nothing

### Concentration over fragmentation

Many individual tasks may belong to the same larger line of attention.

The system should be able to transform:

> many disconnected items

into:

> a smaller number of meaningful areas of attention.

The unit received by the AI does not have to be the unit returned to the user.

### Not doing something can be a decision

Postponing something consciously is different from forgetting it.

The product should make this distinction visible.

### The tool accompanies; it does not chase

The product should reduce cognitive noise, not create more of it.

---

## Weekly model

The central object is the **week**, not the task.

Conceptually:

```text
WEEK
├── intention
├── capacity
├── space
├── focuses
├── options
├── obligations
├── novelties
└── decisions
```

The week can change when reality changes.

The system should adapt without silently destroying previous decisions.

---

## Radar

The product includes a concept called **Radar**.

Its purpose is to answer:

> “Ha aparecido algo nuevo. ¿Esto necesita entrar en mi semana o puede esperar?”

A new item may:

1. require no action
2. become a flexible option
3. fit into existing space
4. create a conflict requiring a decision

The AI may detect a conflict, but it must not silently decide what the person should sacrifice.

Important principle:

> **If I choose this, something else may change.**

The person decides.

---

## Memory philosophy

Memory should:

1. remember what is useful
2. preserve meaningful context
3. allow forgetting

Memory belongs to the person.

The system should remember decisions and context, not every piece of conversation.

Users must be able to delete stored information.

---

## AI vs code

The project deliberately separates semantic reasoning from deterministic logic.

AI is useful for:

- natural-language understanding
- semantic grouping
- relationships
- interpretation
- explanations
- proposals

Code should handle:

- business rules
- capacity
- conflicts
- calculations
- state
- persistence
- validation
- memory lifecycle

This principle should guide architectural decisions throughout the project.

---

## Product direction

The project should remain:

- human-centered
- calm
- privacy-conscious
- low-cost
- simple
- AI-assisted rather than AI-controlled

The technical architecture should support experimentation without locking the project to one AI provider.

---

## Development philosophy

Build → test → use with real examples → learn → adjust.

Real user behavior and real brain dumps can change the design.

The conceptual model is a starting point, not a reason to over-engineer.

---

## Current state

The repository is being built incrementally.

Implemented and calibrated skills:

1. **Skill 01: `extract_items`**: Convert free-form user input into structured items (`task`, `idea`, `concern`, `commitment`, `project`) without prioritizing or planning.
2. **Skill 02: `detect_relationships`**: Detect semantic links (`same_project`, `same_objective`, `related_to`, `part_of`, `depends_on`, `duplicate`) with strict boundaries (concerns isolated, preconditions as `depends_on`, workarounds not linked, zero grouping).
3. **Skill 03: `group_work`**: Synthesize items into coherent lines of attention (`WorkGroup` and `ungroupedItemIds`) without deciding weekly priorities or capacities, backed by a deterministic invariant engine.
4. **Skill 04: `detect_deadlines`**: Detect and normalize temporal references and deadlines anchored to an explicit `currentDate`, without inventing dates, inferring priority/urgency, or estimating effort. Vague expressions discarded deterministically.
5. **Skill 05: `evaluate_context`**: Evaluate situational context, gravity, dependencies, and open questions without building weekly plans or making choices for the user (`ItemContextAssessment`, `GroupContextAssessment`, `OpenQuestion`).
6. **Skill 06: `build_week`**: Synthesize evaluated context into a realistic, human-centered weekly focus proposal (`ProposedWeek`) respecting capacity, protected space, and user sovereignty ("AI proposes. The person decides.").

### Key Decisions & Conventions (Skill 05)

- **Strict "Code before AI" for `dependency`**: The `dependency` signal requires an explicit, valid `depends_on` relationship between input items. Spurious signals derived from `part_of`, `related_to`, or `same_project` are strictly filtered out by the deterministic invariant engine.
- **`waiting` does not penalize attention**: Being blocked by an external party describes objective context, not lower user attention. Items in `waiting` preserve `high` or `medium` attention when deadlines or gravity dictate it.
- **Exploratory / Optional items**: Items conditioned by "si tengo tiempo" or "si me da tiempo" preserve `low` attention even when nearing calendar horizons.
- **Calibration validated with Groq & Mock**: 25/25 cases verified with 100% item (63/63) and group (7/7) coverage, 0 phantom IDs, and 0 duplicate entries.

### Key Decisions & Conventions (Skill 06)

- **Contractual obligations require explicit backing**: High importance and urgent wording ("urgente", "crítico", "prioritario") do NOT invent contractual obligations. Only explicit dates in `strictDeadlinesInWeek` or verified `externalCommitments` qualify as `obligations`.
- **Honesty over mathematical pretense**: When users provide no hour estimates, capacity status remains `unknown` rather than fabricating hours to simulate a tight calendar plan.
- **Protected space is mandatory**: At least 25–30% of plannable capacity is protected for margin and rest.
- **Consolidation engine protection**: Evaluator runs safely merge records without letting offline mock runs destroy live Groq evaluations, maintaining active records and execution history.
- **Calibration with real Groq (`qwen/qwen3.8-27b`)**:
  - 25/25 fixtures evaluated with real Groq.
  - 25 clean passes, 0 repairs, 0 failures, 100% 1:1 item conservation.
  - Semantic audit approved with product observations registered:
    - _Prior dates_: External commitments with dates prior to target week are kept visible for explicit human reconciliation (`case-08`).
    - _Product backlog items_: Handling sub-hour quick tasks prior to the week (`case-22`), delegation trigger vs focus tracking (`case-24`), and UI distinction between weekly due dates and future milestone commitments (`case-13`).

7. **Skill 07: `analyze_change`**: Evaluate mid-week changes, incoming unexpected inputs, and trade-offs against an active weekly plan (`ProposedWeek`) with a strict read-only analytical scope.

### Key Decisions & Conventions (Skill 07)

- **Strict Read-Only Guarantee**: `analyze_change` never alters, recalculates, or replaces the active plan. Explains what is affected without resolving conflicts or dictating priorities.
- **Plazos pasados e intervención no universal**: El sistema identifica plazos y fechas anteriores a la semana objetivo (`temporalScope: "past"`), informando con precisión sobre el desfase y su impacto. Sin embargo, esto **no es una regla universal para obligar a rehacer el plan**: la skill comunica el hecho sin asumir unilateralmente que el usuario deba descartar o reconstruir su semana.
- **Aritmética estricta de capacidad**: Si `totalAvailableHours` o `plannableHours` es desconocido, reporta `unknown_capacity` en lugar de inventar valores por defecto. Si las estimaciones son parciales o incompletas, el balance es `indeterminate` (salvo que las horas conocidas ya provoquen un `deficit_known`). `surplus_known` se certifica solo con 100% de estimaciones conocidas que quepan en la capacidad plannable.
- **Aislamiento verificado (`unaffectedAreas`)**: La ausencia de impactos detectados no basta; se requiere prueba positiva de que los elementos y dependencias de un área no fueron alcanzados por el cambio.
- **Desbloqueos informan sin forzar intervención**: Cuando una dependencia causal se resuelve (`satisfied`), la skill lo comunica como un hecho favorable sin requerir obligatoriamente una decisión del usuario.

8. **Skill 08: `detect_conflict`**: Evaluate objective and material incompatibilities (capacity deficits, blocking dependencies, deadline mismatches, and schedule overlaps) with a 100% deterministic engine.

### Key Decisions & Conventions (Skill 08)

- **Taxonomía Canónica de 4 Tipos**: `capacity_deficit`, `blocked_by_dependency`, `deadline_incompatibility` y `schedule_overlap`. Se retira `focus_fragmentation` para evitar solapamientos con la integridad de foco o déficit de capacidad.
- **Diferenciación Diaria Estricta**: `schedule_overlap` aplica únicamente a colisiones horarias explícitas (`TimeBlock` coincidentes con inicio < fin). Tareas asignadas a un día que superen su disponibilidad se clasifican como `capacity_deficit` diario, no como solapamiento.
- **Riesgos Inciertos Nunca Bloquean**: Un conflicto con certeza `insufficient_information` o `potential` jamás activa `hasBlockingConflicts: true`.
- **Aislamiento Causal Estricto**: Se evalúa exclusivamente la arista `depends_on`. `related_to`, `part_of` y `same_project` no constituyen bloqueo causal.
- **Certificación Positiva de Áreas Indemnes**: `unconflictedAreas` sólo incluye áreas con datos completos y capacidad conocida. Si la capacidad es desconocida (`null`), no se inventan conflictos pero tampoco se certifica que el plan esté libre de ellos.

9. **Skill 09: `propose_adjustment`**: Formulate structured, discrete adjustment alternatives (up to 3) for detected conflicts while strictly preserving user sovereignty and plan immutability.

### Key Decisions & Conventions (Skill 09)

- **Inmutabilidad y No-Aplicación**: `propose_adjustment` es estrictamente propositiva; jamás muta `activePlan` ni aplica decisiones automáticamente.
- **Partición Exacta del 100% ($S\_{\text{total}}$)**: Cada propuesta particiona exhaustiva y disjuntamente todos los ítems en `affectedPlanItemIds`, `retainedPlanItemIds` y `previouslyDeferredItemIds`.
- **Aritmética Estricta sin Máscaras**: Se prohíbe `max(0, ...)`; balances negativos se rechazan de inmediato. Estimaciones desconocidas nunca se asumen como cero.
- **Trazabilidad Preservando Certeza**: `resolvedConflictIds` solo puede declararse si `viability === "viable"`. Propuestas de aceptación de riesgo o condicionales mantienen `resolvedConflictIds: []`, y los residuales en `unresolvedBreakdown` conservan intacta su certeza original (`confirmed`, `potential`, `insufficientInformation`).
- **Duración Dinámica y Colisiones Intra-Ítem**: Reasignación de bloques conserva la duración exacta en minutos del bloque origen; se detectan colisiones excluyendo únicamente el bloque de origen específico.
- **Prioridad de Estados**: Conflictos bloqueantes confirmados sin alternativa viable devuelven `no_viable_alternatives` con independencia de riesgos secundarios menores.

10. **Skill 10: `manage_memory`**: Manage memory lifecycle, candidate validation, epistemic provenance, conservative deduplication/merging, and forget precedence via a 100% deterministic engine.

### Key Decisions & Conventions (Skill 10)

- **Separación de Procedencia, Confirmación y Persistencia**: De dónde procede un recuerdo (`source`), si está confirmado (`confirmationStatus`), y si se autoriza su persistencia son dimensiones ortogonales. `user_explicit` o declaraciones explícitas no implican autorización ni persistencia automática.
- **Invariante Epistémico Universal**: Ningún recuerdo con `confirmationStatus: "confirmed"` puede provenir exclusivamente de `conversation_inference` o `system`. Decisiones de plan solo justifican confirmación si existe aceptación verificable del usuario (`decisionEvidence.acceptedByUser === true`).
- **Prioridad Absoluta del Olvido**: Solicitudes de olvido (`forget`) invalidan de forma prioritaria cualquier propuesta de actualización (`update`), adición (`add`), conservación (`keep`) o fusión (`merge`) sobre ese mismo recuerdo en el mismo lote.
- **Fusión Conservadora sin Elevación**: En operaciones `merge`, la procedencia del resultado debe rastrearse en `sourceProvenances`. El estado resultante nunca puede ser más certero que el más débil de sus fuentes (requiere 100% de fuentes confirmadas sin inferencias) ni revivir recuerdos con vigencia temporal expirada/obsoleta a `active`.
- **Normalización Preservando Símbolos**: `normalizeMemoryContent` aplica NFD pero preserva caracteres técnicos y de código (`+`, `#`, `@`, `/`, `-`, `_`, `.`, `:`), evitando colisiones falsas (p. ej., `C++` vs `C`).
- **Aislamiento de Errores de Entrada**: Candidatos mal formados se aíslan en `warnings` activando `invalid_request` sin contaminar `invalidReferences` (reservado estrictamente para IDs de recuerdos inexistentes) y sin descartar propuestas u órdenes de olvido válidas independientes.
- **Fechas ISO-8601 UTC Reales y Expiración Inclusiva**: Validación de fechas de calendario reales (rechaza meses/días/horas imposibles). Expiración temporal con cota inclusiva: un recuerdo con `validUntil === evaluationTime` se considera vencido y se archiva determinísticamente.

11. **UX Simplification, Guided Navigation & Human Capacity Language (ADR 0015)**:

- **Cuatro Espacios Conscientes**: Separación limpia entre Capturar (bloc libre), Preparar semana (extracción/capacidad/propuesta), Mi semana (agenda/seguimiento) y Revisar y aprender (cierre/memoria). Preparar una semana futura no cierra la semana activa.
- **Divulgación Progresiva**: El desglose de fórmulas y certidumbre matemática reside en `<details className="calm-details">` plegado por defecto; la vista principal expone un resumen compacto en tarjetas legibles.
- **Lenguaje Humano**: Reemplazo de jerga técnica/industrial por conceptos naturales (_Balance de tu semana_, _Tu tiempo de un vistazo_, _Margen de calma_ y _Tareas sin estimar_ cuando faltan horas en lugar de alarmar con "Desconocido").
- **Extracción de Acciones Coordinadas**: Descomposición determinista de oraciones compuestas con verbos de acción coordinados (_«avanzar X, estudiar Y y seguir con Z»_ $\to$ 3 tareas) preservando listas de sustantivos (_«comprar X, Y y Z»_ $\to$ 1 tarea) y normalizando fusiones léxicas (_«quieroavanzar»_ $\to$ _«quiero avanzar»_).

12. **Focus Capacity Conservation, HUD Bar & Calm Task Adjustment (ADR 0016)**:

- **Límite Estricto de 3 Focos con Conservación Total**: Se garantiza `foci.length <= 3` en `deterministic.ts` resolviendo el error Zod de 3 elementos. Elementos excedentes se derivan a `deferredItems` (`out_of_capacity`) o `flexibleOptions` sin pérdidas ni identificadores inventados.
- **Barra HUD Superior de Capacidad**: Síntesis horizontal en una sola fila (`Disponibles`, `Planificadas`, `Planificables`, `Protegidas`, `Restantes`) con barra de 6px y desglose matemático accesible bajo demanda en acordeón.
- **Ajuste Calmado y Cierre Automático**: Al guardar cambios en una tarea, la persitencia al plan y a la agenda se ejecuta atómicamente, el panel se repliega solo y se presenta un aviso verde claro de confirmación con botón para volver a editar.
- **Limpieza Estética**: Eliminación del motivo artificial de cinta adhesiva (`.washi-card::before`) y cambio de etiqueta en navegación superior a `1. Capturar ideas`.

13. **Local Persistence Resilience, Data Sovereignty & Dependency Maintenance (ADR 0017)**:

- **Transacciones Compensatorias en Persistencia**: `WeeklySessionService.createOrSavePlanAndSchedule` captura snapshot del plan previo; si falla el guardado de la agenda, restaura el plan existente en lugar de borrarlo destructivamente.
- **Soberanía y Portabilidad de Datos**: Exportación e importación completa de los 4 stores de IndexedDB vía `src/infrastructure/storage/indexeddb/backup.ts` validado con Zod (`UserDataBackupSchema`), con modos `merge` y `replace`. Archivo y eliminación definitiva de recuerdos individuales (derecho al olvido).
- **Recuerdos Activos en No-Sesión**: `resumeSession()` entrega recuerdos activos cuando `no_active_session` para contextualizar la preparación de la semana.
- **Actualización Segura de Dependencias**: Auditoría de breaking changes con Context7; actualización de `groq-sdk` a 1.6.0 encapsulada en `src/providers/groq-provider.ts` y dependencias menores/parches actualizadas con 776 tests en verde.

14. **Radar de Imprevistos e Incorporación Soberana al Plan Activo (ADR 0018)**:

- **Pipeline de Evaluación de Imprevistos (`src/application/radar-pipeline.ts`)**: Implementación de las Secciones 21 a 25 de `PROJECT_CONTEXT.md` con 4 veredictos canónicos (`no_change`, `flexible_option`, `fits_available_space`, `changes_balance`).
- **Inmutabilidad y Decisión Humana**: Evaluación 100% de sólo lectura. En la UI ("Mi semana"), se ofrecen botones explícitos: `Añadir a mi semana` (a obligaciones o tareas con fecha/horas), `Añadir como opciones flexibles` (sin comprometer margen de calma ni focos) y `Descartar aviso`.
- **Aislamiento de Identificadores (Prevención de Colisiones)**: Generación garantizada de IDs únicos (`item-radar-...`) al incorporar elementos al plan para impedir que `extractPlanItems` los descarte silenciosamente por deduplicación contra IDs iniciales (`item-mock-1`).
- **Extractor Determinista Mejorado**: Vocabulario ampliado con verbos en inglés, descomposición limpia de listas separadas por coma, protección de expresiones compuestas de agobio/preocupación y fusión automática de cláusulas de esfuerzo (como `", me llevará 2 horas"`). 789 tests en verde.

15. **Auditoría de Privacidad y Naturaleza de Casos de Benchmark (Plan Oct 2026)**:

- **Casos de Calibración 100% Sintéticos**: Se confirmó y documentó formalmente en `cases/README.md` y `README.md` que los 25 casos en `cases/sample-dumps.json` (y sus logs de evaluación en `eval-*-results.json`) son ejemplos completamente ficticios/sintéticos diseñados para benchmarking y suites zero-token. No contienen datos reales, PII ni información personal, cumpliendo con la regla 6 de `AGENTS.md`.
- **Transparencia en Dictado por Voz**: Se documentó en ADR 0019 y en la interfaz (`VoiceDictationButton`) el flujo de procesamiento de la Web Speech API (transcripción en la nube en Chrome vs procesamiento en dispositivo en Safari).

16. **Paridad de Proveedores, Higiene de Concurrencia y Modularización de UI (Plan Oct 2026 - Pasos 5 y 6)**:

- **Paridad Gemini y Groq**: Implementación de `buildWeek` en `GeminiProvider` con structured output, completando la paridad en todas las habilidades semánticas (01 a 06).
- **Contrato Unificado `completeJson`**: Abstracción genérica que desacopla el transporte de los parsers específicos de cada skill.
- **Higiene de Concurrencia**: Eliminación del estado de instancia (`lastRawResponse` / `lastParseResult`) en `GroqProvider` para evitar colisiones en llamadas paralelas.
- **Modularización de UI y Code-Splitting**: Extracción de componentes y formateadores (`weekly-session-formatters.tsx`, `confirmed-active-memories-section.tsx`, `capacity-protected-space-section.tsx`, `carry-over-tasks-section.tsx`) y configuración de `manualChunks` en Rollup/Vite, reduciendo todos los bundles de producción por debajo de 500 kB.
- **ADR 0021**: Migración a Zod 4 implementada (zod@4.6.7), resolviendo el aviso de seguridad GHSA-mrhx-c7xc-m3w5 con paridad total de esquemas, compatibilidad regresiva en IndexedDB y 0 vulnerabilidades en audit.

Detailed specifications for individual skills live separately from this file.

---

## North Star

The product succeeds when the person can say:

> **“Ahora veo con claridad qué quiero cuidar.”**
