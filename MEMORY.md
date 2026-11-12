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

17. **Desacoplamiento de Ciclos en Dominio, Pruebas de Humo en Navegador y Endurecimiento de Privacidad (ADR 0024)**:

- **Desacoplamiento de Agenda (`schedule.ts`)**: Descomposición modular en `schedule-types.ts`, `schedule-invariants.ts` y `schedule-adjustment-applier.ts`. Se eliminó la dependencia circular con `week.ts` que provocaba fallos de inicialización en previsualización de producción.
- **Compuerta Estricta Anti-Ciclos**: Se añadió `npm run check:cycles` con `madge` como verificación obligatoria de cero ciclos en CI.
- **Pruebas de Humo Programáticas con Playwright Chromium**: `scripts/smoke-test.ts` utiliza la API de Node.js de Vite (`createServer`, `preview`, `build`) con cierre limpio sin procesos huérfanos. Se integró la instalación de Chromium y el smoke test (`npm run test:smoke`) en el flujo de CI.
- **Estandarización de Copia y Mapeo de Enums (ADR 0022/0024)**:
  - Unificación al español de España eliminando formas remanentes de voseo (`Tienes`, `Sincroniza`, `Elige`), con test automatizado de denylist (`tests/voseo-denylist.test.ts`).
  - Actualización de la etiqueta del selector de casos a "Caso de ejemplo:" en `App.tsx` para reflejar la naturaleza sintética de los benchmarks.
  - Creación de `src/web/labels.ts` con mapeos en español y sentence case para tipos de ítem, estado, compromiso e importancia, manteniendo los valores crudos para esquemas, APIs y clases CSS (`badge-task`).
- **Endurecimiento de Privacidad en Logger**:
  - Introducción de `AppError` e `isAppError: true` en `src/utils/logger.ts`.
  - Los errores planos (`Error`) o nativos del runtime (`TypeError`, `SyntaxError`) se redactan a `[REDACTED_ERROR_MESSAGE]`, impidiendo que notas o entradas privadas del usuario se filtren a través de mensajes de error cortos en la consola.
  - Errores confiables de la aplicación (`StorageError`, validaciones) conservan su mensaje técnico diagnóstico. Suite ampliada a 909 tests passing.

18. **Simplificación de la interfaz y divulgación progresiva (ADR 0025)**:

- **Paso sugerido único**: Barra bajo las pestañas que guía a la persona según el estado actual (Ideas, Planificar, Propuesta, Semana activa o Cierre), ocultando el botón cuando ya se encuentra en el espacio destino.
- **Pestaña inicial reactiva**: Carga en «Ideas» si no hay semana activa ni borrador, en «Planificar» si hay borrador/propuesta pendiente, y en «Mi semana» si hay semana activa, esperando la carga inicial sin parpadeos.
- **Reducción de ruido técnico**: Opciones de desarrollo e inspección JSON contenidas tras `?dev=1`; selector de proveedor IA, copia de seguridad y soberanía agrupados en el menú «Ajustes» en la cabecera.
- **Divulgación progresiva en pantallas con datos**:
  - Propuesta: resumen de balance en una sola frase legible, menú contextual «••• Más» por elemento, diferidos colapsados con contador y botón principal único «Confirmar y activar semana».
  - Semana activa: foco en tareas activas con menú contextual, secciones analíticas (Imprevistos, historial y aprendizajes) colapsadas por defecto con conteo.
  - Planificar: parámetros avanzados (fechas, sincronización, limpieza) recogidos en «Opciones».
- **Limpieza de lenguaje**: Reemplazo de jerga interna («Radar» $\rightarrow$ «Imprevistos», «Memorias activas confirmadas» $\rightarrow$ «Lo que he aprendido», «Cierre reflexivo» $\rightarrow$ «Cierre de semana», «volcado mental» $\rightarrow$ «ideas de tu captura»).
- **Red de seguridad completa**: Validación exhaustiva en CI mediante Playwright (`test:smoke`) en Chromium real y pruebas de denegación de voseo (`voseo-denylist.test.ts`), con 918 pruebas pasando y 0 dependencias circulares.

19. **Flujo Guiado «Nueva semana», Simplificación de Tarjetas y Pulido (v0.25.0 - v0.25.1 / ADR 0027)**:

- **Flujo Guiado Unificado (Escribir → Revisar → Confirmar)**: Reemplazo de las pestañas fragmentadas de Ideas y Planificar por una línea de progreso visible en 3 etapas. Conservación total de notas y selecciones en navegaciones hacia atrás.
- **CalmIdeaCard**: Tarjetas limpias con título, fecha límite y casilla visible; detalles técnicos secundarios agrupados tras botón accesible «Detalles» (`aria-expanded`).
- **Navegación a 2 Espacios**: Reducción de la navegación principal a «Mi semana» y «Nueva semana». Integración del cierre de ciclo en Mi semana.
- **Pulido Visual y Redundancias**: Eliminación de insignias duplicadas («IA propone · Tú decides» y «Borrador en cuaderno local») en Revisar, Confirmar y Mi semana.
- **Reparto 5 → 2 + 3**: Explicación contextual de división de ideas bajo elementos identificados con flexión singular/plural correcta, oculta si todo está programado.
- **Títulos Limpios sin IDs**: Corrección en `extractPlanItems` para resolver títulos limpios de tareas a partir de `draftContext.extractedItems` o el foco a secas, eliminando la interpolación de IDs técnicos `(${itemId})` en la agenda y resumen de correo.
- **Claridad de Proveedor en Ajustes**: Mensaje informativo explicativo bajo el selector cuando el modo Mock determinista está activo, preservando el proveedor predeterminado.
- **Cobertura Automatizada Exhaustiva**: Tests para persistencia de recordatorios (`localStorage`), límites seguros de URL en resumen por correo (< 3.500 caracteres), codificación de caracteres especiales, ausencia de destinatario, copia íntegra al portapapeles y prueba de humo ampliada en Chromium real (953 tests en 70 suites).

20. **Resolución de Exportación a Calendario y «Enviarme el resumen por correo» (Gmail y Calendario)**:

- **Descubrimiento y Acceso Inmediato en «Mi semana»**:
  - Se añadió el botón superior `✉️ Enviar a Gmail / Correo` junto a los accesos directos de la cabecera de la agenda activa.
  - Se renombró el contenedor inferior colapsado a `📤 Exportar y compartir semana (Google Calendar, Gmail y recordatorios y avisos)` y se sincronizó su apertura automática (`open={isExportOpen}`) al pulsar el botón superior, posicionando el scroll directo sobre la tarjeta de correo.
- **Blindaje de Longitud de URL y Prevención de HTTP 400**:
  - Se acotó la longitud codificada de la URL a un techo estricto de < 1.800 caracteres en `src/domain/email-summary.ts` mediante truncado por búsqueda binaria sobre caracteres seguros, impidiendo que Google Frontend rechace peticiones por URI excesiva (`400 Bad Request` / `414 URI Too Long`).
  - Se corrigió la sintaxis HTML del atributo `rel` en el enlace a Gmail de `rel="noopener,noreferrer"` a `rel="noopener noreferrer"`.
  - El botón «Copiar resumen» sigue copiando el 100% del texto íntegro sin truncar al portapapeles.
  - Se corrigió el alcance de estilos CSS en `style.css` para `a.button`, dotando de silueta de botón píldora y jerarquía visual nítida a `[✉️ Abrir en Gmail]` (primario verde salvia), `[📬 Usar mi programa de correo]` (secundario con borde) y `[📋 Copiar resumen]`.
- **Transparencia en Calendario y Puente Asistido a Google Calendar Web**:
  - Botón renombrado a `Añadir semana a Google Calendar (.ics)` en Mi semana y Confirmar propuesta, explicitando que la exportación semanal se realiza mediante archivo `.ics`.
  - Tarjeta de aviso enriquecida con botón directo `Abrir importador de Google Calendar` (`https://calendar.google.com/calendar/u/0/r/settings/export`) para facilitar la subida a la nube de Google y sincronización automática con el móvil.
  - Visibilización del botón `Google Cal (1 clic)` en las acciones de cada tarea (`••• Más`), permitiendo guardar eventos individuales en la nube sin descargar archivos.

Detailed specifications for individual skills live separately from this file.

---

## North Star

The product succeeds when the person can say:

> **“Ahora veo con claridad qué quiero cuidar.”**

## UX incremental: contexto antes de planificar

- La captura muestra fechas y horas libres opcionales antes de generar la propuesta.
  Las horas ya excluyen los compromisos existentes; importar un calendario no
  presupone 40 horas ni descuenta reuniones de nuevo.
- Sin horas, la propuesta se presenta como provisional; cero es capacidad conocida.
- El contexto previo se conserva en una clave local transitoria validada, sin
  migrar IndexedDB. Los borradores antiguos sin contexto siguen siendo compatibles.
- Fechas, selecciones, estimaciones y límites modificados requieren actualizar la
  propuesta. Un fallo al generar conserva la revisión e impide activar la anterior.
  Cambiar solo el contexto no vuelve a extraer ni descarta correcciones manuales.

## UX incremental: confirmación autocontenida

- La confirmación presenta la propuesta exacta que se guardará, sin recalcular
  reglas de capacidad ni sumar las opciones flexibles al tiempo de focos y
  compromisos. Las estimaciones parciales y la capacidad desconocida siguen
  apareciendo como pendientes de verificación.
- La intención se edita en revisión y se regenera antes de confirmar; la última
  pantalla es de lectura. La exportación sigue disponible en Mi semana tras
  activar. El foco de teclado entra en la región de confirmación.
- La activación tiene una protección inmediata contra envíos repetidos además del
  estado de guardado. No se han cambiado contratos de IA ni esquemas persistidos.

## UX incremental: revisión unificada

- Con propuesta, las decisiones se presentan por posición y las correcciones se
  abren dentro de la entrada correspondiente; no hay otra lista principal de
  elementos extraídos. Sin propuesta se mantiene la captura revisable y una acción
  explícita para generar la primera propuesta.
- Seleccionar significa tener en cuenta al regenerar, no planificar. Los elementos
  excluidos y pendientes siguen accesibles durante la revisión. Las ideas y
  preocupaciones no se convierten en tareas por cambiar de presentación.
- Los movimientos de focos que no representan un único elemento están protegidos,
  igual que los cambios individuales de vencidos dentro de un foco agrupado. No se
  deben perder miembros ni inventar cómo repartir su estimación agregada.
- La edición y los movimientos usan extractItemHours, la misma normalización que
  el planificador, sin modificar la unidad original hasta que la persona la edite.

## UX incremental: semana activa clara

- Mi semana presenta focos y compromisos como prioridades. Opciones flexibles y
  aplazados permanecen consultables en secciones plegadas, sin reclasificar datos.
- La pertenencia explícita a la propuesta prevalece sobre asignaciones residuales
  de agenda. Los grupos conservan todas sus fuentes y su estimación conjunta.
- Ajustes, cierre y exportación conservan el inventario completo; la exportación
  explica este alcance. Un ajuste explícito puede seguir moviendo un aplazado a
  opciones flexibles según el comportamiento existente.
- Versiones e historial vacío quedan en detalles; el historial con cambios sigue
  visible. Imprevistos aparece antes de las listas secundarias.
- No hay migración, nuevas dependencias ni llamadas adicionales a IA. La siguiente
  etapa consolidará calendario, compartir y lenguaje de confianza.

## UX incremental: calendario, compartir y confianza

- Una sola descarga semanal .ics comparte sección con recordatorios, importación y
  resumen. Mantiene el contenido completo; no filtra aplazados silenciosamente.
- Descargar, preparar un evento, preparar un correo y copiar describen acciones
  diferentes. La app no promete envío, conexión de cuenta ni sincronización continua.
- La importación es puntual: el archivo se lee en el navegador; un enlace se consulta
  mediante el servidor al servicio de calendario. Se mantiene «Olvidar enlace».
- Ajustes distingue almacenamiento en navegador de procesamiento externo. Mock sigue
  por defecto; Groq/Gemini muestran que generar envía notas y contexto al proveedor.
- «Eliminar semana» sustituye «Purgar» sin cambiar confirmación, cancelación ni alcance.
- El siguiente paso requiere diseñar persistencia, deshacer y relación con el cierre
  antes de añadir acciones diarias con estado.

## UX incremental: diseño de acciones diarias (pendiente de implementar)

- Contrato propuesto en `docs/daily-actions-design.md`. Las disposiciones actuales
  del cierre son estado de componente; no constituyen progreso diario persistente.
- `reverted` existe en el esquema del historial, pero falta la operación de
  reversión y la captura previa necesaria para deshacer postergaciones.
- Una postergación vigente contradice un resultado completado en el cierre actual:
  resolver explícitamente, sin cambiar silenciosamente la prioridad de evidencias.
- Propuesta: actividad opcional en la agenda, concurrencia con su versión existente,
  reversión solo si no hubo cambios posteriores y transacciones atómicas.
- Completar no libera horas ni completa automáticamente un foco agrupado. Cierre y
  reapertura deben conservar resultados; arrastre mantiene identidad y selección.
- Entregas futuras: 7a contrato/persistencia, 7b completar con cierre y deshacer,
  7c mover, 7d aplazar. Todavía no hay controles ni esquemas nuevos implementados.

## UX incremental: base de persistencia 7a

- Implementados `WeeklySchedule.itemActivity` opcional y operación interna
  `WeeklySessionService.recordItemActivity`: completar un elemento y deshacer con
  ID idempotente, versión y transacción conjunta de plan/agenda.
- Reversión solo en la versión compatible; conserva historial y restaura el estado
  previo o su ausencia. Completar no cambia capacidad ni asignaciones.
- Una postergación vigente impide completar con evidencia contradictoria. Datos
  antiguos siguen sin progreso inferido; copias nuevas preservan la actividad.
- Repositorios sin soporte transaccional reciben `atomic_storage_required`, sin
  escrituras parciales. Pruebas con IndexedDB en memoria verifican la atomicidad.
- Sin botones ni conexión al formulario de cierre todavía. En 7b integrar cierre,
  correcciones y reapertura antes de exponer completar/deshacer.

## UX incremental: completar/deshacer con cierre y reapertura (7b)

- Mi semana permite completar un elemento del plan y deshacer la última acción
  compatible tras recargar. No cambia capacidad, asignaciones ni otros miembros
  de su foco. Ideas/preocupaciones permanecen como notas.
- El cierre precarga resultados y permite corregirlos o dejarlos sin revisar.
  Comprueba versión y estado dentro de la transacción plan/agenda/informe; cambios
  posteriores requieren recargar/revisar, sin sobrescribir decisiones.
- Reabrir conserva resultados explícitos mediante `itemActivity.reviewCheckpoint`
  (referencia al informe, versión, antes/después), mantiene historial y elimina el
  informe en la misma transacción. No permite deshacer una acción anterior al cierre.
- Arrastre excluye completados/descartados activos. No resuelve silenciosamente una
  contradicción entre postergación vigente y resultado completado.
- Siguiente: 7c mover asignaciones con reversión; 7d postergaciones reversibles.

## UX incremental: movimiento reversible de asignaciones (7c)

- «Más → Mover una asignación» permite elegir un bloque horario o horas de un día.
  Se conserva duración/total respectivamente, sin mover la otra representación ni
  cambiar pertenencia, estimaciones o fecha límite. No se adivina el origen.
- Comandos de actividad `move` reutilizan las acciones temporales del dominio.
  La evidencia opcional `temporalChange` conserva solo filas afectadas/posiciones y
  referencias a ajustes sustituidos. Mismos control de versión y transacción.
- Deshacer comprueba el inverso, restaura ese alcance y conserva la decisión humana
  del ajuste como revertida. Reactiva únicamente los ajustes sustituidos por ese
  movimiento; no restaura toda la agenda ni sobrescribe decisiones posteriores.
- Recarga y copias conservan la reversión. No hay nuevas dependencias o migración.
  Siguiente: 7d, postergación reversible y sus efectos en candidatos de arrastre.

## UX incremental: postergación reversible (7d)

- «Más → Aplazar elemento» exige motivo y ofrece destino futuro opcional. Retira
  asignaciones y registra una postergación consciente sin modificar la propuesta,
  repartir horas de grupos ni crear automáticamente otra semana.
- La presentación prioriza postergaciones vigentes sobre pertenencia original:
  aparecen en «Aplazados durante la semana», conservando todos los miembros.
- Deshacer usa evidencia temporal y versión compatible, restaura asignaciones y
  resultado previos y conserva historial. Una postergación vigente exige deshacer
  explícitamente antes de completar; no se permite sobrescribir decisiones posteriores.
- Cierre, candidatos por destino, deduplicación, recarga y copias están cubiertos.
  Deshacer no elimina un elemento ya elegido en otro borrador independiente.
- Pasos 0–7 (7a–7d) implementados. Próximo checkpoint: revisión de uso con la persona,
  antes de ampliar el alcance. La rama sigue local hasta una instrucción de publicar.

## Ajuste de usabilidad: incluir junto a horas y fecha

- Tras la revisión en la app, la persona pidió que incluir un elemento y ver su
  posición en la semana estuvieran en el mismo panel que sus horas y fecha.
- Las tarjetas muestran estado de pertenencia real y la acción de incluir dentro
  del panel de correcciones. Se conserva abierto tras cambiar de categoría y se
  devuelve el foco a la misma fuente, sin perder sus valores.
- Se quitaron los botones de decisión repetidos fuera de esas tarjetas; las
  propuestas antiguas sin fuentes conservan sus controles anteriores.
- Selección para regenerar y pertenencia a la propuesta siguen siendo distintas.
  Se reutilizan las operaciones existentes y sus protecciones de focos agrupados.

## Ajuste de usabilidad: calendario de tareas en Mi semana

- La persona aclaró que el cambio es solo para las tareas de «Mi semana», no para
  el listado de semanas/borradores guardados.
- Vista rápida con rango semanal explícito, días reales, filtro Pendientes/Todas
  y contadores separados de pendientes, opcionales, completadas y aplazadas.
- Solo bloques/asignaciones guardadas colocan una tarea en un día. La fecha límite
  se etiqueta como tal; lo incluido en la semana sin día permanece en su sección.
  No se reparten estimaciones agregadas de focos entre miembros.
- Postergaciones, elementos fuera de la semana y notas permanecen aparte. Una tarea
  abre sus controles existentes, desplegando ancestros y devolviendo el foco.
- Es una proyección de lectura, sin cambios de almacenamiento, acciones de dominio,
  integración de calendario externa ni listas de borradores. Responsive en móvil.

## Ajuste de usabilidad: de notas directamente al calendario

- La persona encontró demasiados pasos entre listar tareas y organizar su semana.
  El flujo principal pasa a Escribir tareas → Calendario editable → Guardar y
  activar semana, con resumen opcional dentro de la misma vista.
- Cada tarjeta permite incluir, dejar para después, ajustar horas y elegir día.
  Se mantienen las protecciones de compromisos y focos agrupados; sus estimaciones
  compartidas se ajustan en Opciones avanzadas. Las notas no se convierten en tareas
  hasta una decisión explícita de dedicarles atención.
- Las horas modificadas actualizan fuente, propuesta y capacidad determinísticamente,
  sin nuevas llamadas de IA. Cero limpia la estimación, igual que dejarla vacía.
- `draftContext.plannedDays` es opcional, validado como fechas reales y compatible
  con copias antiguas. Guarda decisiones de día sin inventar horas. Al activar,
  solo estimaciones individuales conocidas generan asignaciones de horas; las
  asignaciones/bloques reales tienen precedencia en Mi semana.
- La activación conserva las fuentes y días elegidos. No se reutilizan días cuando
  un proveedor recicla el ID de una fuente distinta. Las ediciones activas actualizan
  o eliminan el día guardado para evitar que reaparezca una asignación antigua.
- Guardados de borrador serializados, indicador de progreso, error recuperable y
  activación bloqueada mientras el guardado está pendiente o ha fallado. Se conserva
  el bloqueo de propuestas desactualizadas y de otra semana ya activa.
- El resumen y la revisión detallada quedan como opciones, sin una tercera pantalla.
  Los días vacíos ocupan menos espacio en móvil; rangos largos se paginan.

## Calendario: arrastrar tareas y vista mensual

- La persona pidió drag/drop y eligió explícitamente Vista mensual frente a limitar
  la navegación a Esta semana / Próxima semana.
- El borrador permite arrastrar tareas ya incluidas entre días o a Sin día elegido.
  Se conserva el campo de fecha como alternativa táctil y para teclado. Las notas
  fuera de la semana requieren una inclusión explícita antes de poder arrastrarse.
- Mi semana permite mover asignaciones diarias simples o un bloque fijo individual
  mediante drag/drop o Mover a. Se reutilizan el comando atómico move, sus controles
  de versión/solapamiento/capacidad y Deshacer. Las asignaciones divididas o mixtas
  siguen usando controles detallados; no se adivina qué parte mover. No se inventan
  horas para permitir arrastrar tareas que solo tienen un día elegido.
- Mes y otras semanas, dentro de Nueva semana, proyecta tareas pendientes de la
  semana activa y borradores, sin interpretar fechas límite como días asignados.
  Las tareas sin día permanecen en el resumen de su semana. Funciona entre meses y
  años y conserva los rangos personalizados de las semanas guardadas.
- Seleccionar un día abre su semana; un futuro plan es un borrador separado. La
  navegación guarda primero el borrador actual, bloquea cambios pendientes de
  regeneración y errores de guardado, y conserva la única semana activa.
- Los guardados pasan por el controlador de sesión para refrescar todos los
  borradores visibles; también se atienden resultados invalid_data, sin tratarlos
  como un guardado exitoso. No hay nuevos esquemas, dependencias ni llamadas de IA
  para arrastrar, navegar o proyectar el mes.

## Tarjetas del calendario: movimiento individual y colores

- La persona detectó selectores Mover a desproporcionados, presentes solo en algunas
  tareas, y percibió que dos tareas cambiaban a la vez.
- Reproducción: al mover una tarea, los selectores de todas las tareas desaparecían
  durante busy y volvían a aparecer (conteos DOM 3 → 0 → 3), provocando saltos de
  distribución. En esa reproducción solo cambió la asignación del ID seleccionado.
- Se separó capacidad de movimiento de busy: los controles permanecen montados y
  se deshabilitan durante el guardado. El mensaje de progreso tiene espacio fijo.
- Cada tarjeta incluida pendiente ofrece Cambiar día, con el nombre de la tarea y
  un selector compacto o acceso a sus controles existentes si no hay asignación
  simple. El control vive dentro de la tarjeta. Tras mover, el foco vuelve a esa
  tarea y el aviso de éxito la nombra.
- Color más texto y símbolo: ámbar Sin día, azul Programada, verde Completada,
  violeta Aplazada y gris para notas/exclusiones. Programada describe tener día;
  no significa completada ni cambia el filtro Pendientes.
- Pruebas específicas verifican que mover/deshacer una de dos tareas del mismo
  foco y día conserva las asignaciones de la otra, las horas y la propuesta.
  No se modificaron reglas de dominio, esquemas, proveedores ni dependencias.

## Disponibilidad posterior y seguimiento de semanas

- La persona pidió poder configurar tiempo disponible después de listar/activar
  tareas, encontrar las reprogramadas y ver la semana activa y la siguiente juntas.
- Añadir/Cambiar horas disponibles está a la vista en el calendario de borrador y
  junto al balance activo. Valida los mismos límites, distingue Por definir de 0,
  recalcula capacidad determinísticamente y preserva tareas, días y completitud.
  La semana activa usa la operación de guardado con versión esperada de agenda.
- Mis semanas es un lateral plegable en escritorio y panel plegable sobre el
  contenido en móvil. Lista la activa, borradores y destinos explícitos conservados
  en las postergaciones de la activa o el último cierre. No inventa borradores ni
  horas: distingue Por preparar de Borrador y Reprogramada · por incluir de incluida.
- El lateral abre rangos exactos mediante la navegación protegida ya usada por Mes;
  espera restauración del borrador, conserva cambios pendientes y no activa semanas.
- La vista previa de reprogramación usaba la disponibilidad de origen para avisar
  sobre el destino: ahora mira el borrador del destino y permite abrirlo directamente.
  El destino por defecto es la semana posterior a la activa.
- Las tareas postergadas se eligen desde el flujo principal, sin buscar en opciones
  avanzadas. Al generar se conservan fuentes, IDs aceptados y horas individuales;
  antes el calendario podía quedar sin tarjetas aunque la propuesta incluyera tareas.
- Restaurar candidatos conserva selecciones válidas. Un foco agrupado no reparte ni
  repite su estimación total en cada miembro recuperado: usa la fuente individual
  si existe y mantiene desconocido si no hay esa información.
- Sin dependencias ni cambios de esquema, y sin IA para editar disponibilidad,
  navegar o proyectar el lateral. Reprogramar conserva su acción explícita actual.

## Tareas repartidas entre varios días

- La persona pidió prolongar una tarea dentro de su semana y repartir, por ejemplo,
  5 h entre lunes 2 h, miércoles 2 h y viernes 1 h.
- Repartir horas aparece en cada tarjeta incluida del borrador y la semana activa.
  Permite repartos parciales, muestra lo pendiente y valida fechas reales, días
  únicos, valores positivos y que el reparto no supere el total conocido.
- Cada día muestra solo su parte. Una tarea conserva su única estimación semanal
  y su contador de pendiente; repetirla en días distintos no multiplica la carga.
- Los borradores usan `draftContext.plannedAllocations`, opcional y basada en el
  esquema existente DailyWorkAllocation. Se conserva al recargar/cambiar semana,
  y las fuentes sustituidas con IDs reutilizados no heredan repartos ajenos.
  Las copias antiguas siguen siendo válidas y se probó el recorrido de importación.
- Activar valida y transfiere el reparto a la agenda sin duplicar el antiguo día
  único. Las agendas activas usan sus asignaciones reales; no recuperan metadatos
  de borrador como si fueran movimientos actuales.
- Guardar reparto activo sustituye solo las filas de esa tarea, conserva estimación,
  pertenencia y demás tareas, y usa versión esperada. Los límites diarios explícitos
  siguen aplicándose. Los bloques horarios fijos mantienen sus controles propios.
- No se divide una estimación compartida entre miembros de un foco por conjetura:
  solo se usan esfuerzos individuales conocidos o asignaciones reales existentes,
  y el conjunto no puede superar la estimación del foco.
- Arrastrar una parte preserva el resto, fusiona el destino cuando ya existe y
  conserva fracciones de hora. Dejar una parte sin día mantiene el esfuerzo pendiente.
- Editar el total desde el control anterior conserva el reparto existente cuando
  no se cambia el día; no permite reducirlo por debajo de las horas ya repartidas.
- Mes, lateral, ICS, enlaces de evento y correo reflejan todos los días. Las
  asignaciones sin reloj se exportan como eventos de día completo con horas en
  el título; no se inventa una hora de inicio.
- Sin dependencias ni llamadas nuevas de IA. Se conserva la distinción entre
  estimación desconocida, horas explícitas y capacidad disponible.

### Reparto: corregir la confusión al añadir días

- El editor conserva las asignaciones anteriores; añadir días no resta horas del
  original. Se explica explícitamente y se ofrece repartir el total por igual entre
  los días con horas, sin guardar ni redistribuir silenciosamente.
- El formulario abierto sale de la columna estrecha del calendario y se cierra al
  guardar correctamente. Cerrar sin guardar mantiene el calendario anterior.
- Comprobado en navegador: exceso de horas, corrección por igual, ancho del editor,
  reparto por día, persistencia y movimiento de porciones, sin alterar otras tareas.

### Calendario más despejado

- El control cerrado Repartir horas ya no repite el total en cada tarjeta; los
  detalles y balances permanecen dentro del editor.
- Mis semanas indica Mostrar/Ocultar panel. Al contraerlo se libera la columna
  lateral y el calendario ocupa el ancho disponible; se puede expandir de nuevo.

### Traer tareas al calendario activo

- Las tareas fuera de semana y aplazadas se muestran en una bandeja visible encima
  de los días. Arrastrar o Añadir a un día abre un diálogo con día y horas; cancelar
  no escribe nada. Guardar incluye solo esa tarea y guarda agenda/propuesta juntas
  con la versión esperada. No se inventan horas cuando el campo queda vacío.
- Las tareas con una sola asignación tienen Ajustar horas en su propia tarjeta.
  Los repartos y horarios fijos conservan sus controles específicos; las estimaciones
  compartidas no se cambian desde una tarjeta individual.
- Recuperar una tarea aplazada utiliza la acción auditada resume: registra su vuelta
  a not_started y revierte únicamente sus aplazamientos activos. Funciona después
  de cambios en otras tareas; no utiliza el undo de la última acción ni borra historia.
  Resume no ofrece deshacer como si fuera un movimiento simple.
- Sin IA ni dependencias nuevas. El balance se recalcula con el esfuerzo explícito;
  se validan límites diarios, fechas, tareas cerradas y concurrencia antes de guardar.

### Cierre de sesión — 11 de noviembre de 2026

- La persona decide parar por hoy. Último cambio de aplicación: `d556170`, botón
  Ajustar horas compacto. Guardar este cierre y documentación en la misma rama
  `codex/ux-step-by-step`; no integrar en main ni publicar una versión.
- Próxima sesión, en pasos pequeños: (1) revisar desplegables y reducir texto del
  calendario; (2) diagnosticar el dictado por voz comunicado como no funcional;
  (3) permitir arrastrar tareas incluidas pero sin día al calendario y ajustar horas
  allí, con alternativa accesible. Estos tres puntos siguen pendientes.
- La bandeja de fuera de semana/aplazadas ya permite arrastre, pero las tareas de
  «En esta semana · sin día asignado» no. No confundir ambas implementaciones.
- La voz aún no tiene causa reproducida ni solución verificada. Revisar navegador,
  permisos, idioma y eventos de reconocimiento; no afirmar funcionamiento real
  basándose solo en pruebas simuladas.
- ADR 0029 consolida las decisiones del calendario. ADR 0019 registra el problema
  pendiente del dictado. README y plan UX enlazan el punto de reanudación; Changelog
  reúne los cambios recientes bajo Unreleased, sin alterar versiones publicadas.

### Reanudación — 12 de noviembre de 2026, primer paso

- La persona pide continuar. Se aplica primero la simplificación de texto acordada:
  instrucciones del borrador y ayuda/leyenda del calendario activo tras desplegables
  cerrados. Tareas, días, horas y acciones siguen visibles. Textos vacíos y bandeja
  se acortan. No se modifican decisiones, asignaciones ni persistencia.
- Continúan pendientes el diagnóstico del dictado real y el drag/drop de las tareas
  incluidas sin día asignado. El arrastre desde la bandeja de aplazadas ya existe.

### Dictado Chrome — 12 de noviembre de 2026

- La persona confirma que el fallo es repetición progresiva de palabras en Chrome.
  Causa reproducida: la captura inicial concatenaba cada snapshot completo que el
  hook devuelve. Se cambia a sustituir el valor, como ya hacían revisión y Radar.
- El hook reconstruye la lista de resultados, conserva notas y finales tras Parar,
  usa callbacks actuales y detiene la sesión si la persona edita manualmente. No
  reinicia a escondidas tras fin/error. Inicio/parada y errores tienen feedback claro.
- Smoke con eventos de servicio simulados verifica frases crecientes, finales
  repetidos, texto existente, parada, errores, idioma, móvil y limpieza al salir.
  NO equivale a probar audio real: pendiente que la persona lo confirme con su
  micrófono en Chrome del Mac. No declarar validada la transcripción real aún.
- Sigue pendiente el arrastre de tareas ya incluidas pero sin día.
