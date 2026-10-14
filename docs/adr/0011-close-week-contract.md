# ADR 0011: Contrato de Cierre y Reflexión Semanal (`close_week`)

## Estado
Aceptado

## Contexto
En Conscious Tech, el ciclo semanal no termina simplemente cuando pasan los días; requiere un momento de **cierre y reflexión consciente** antes de planificar un nuevo ciclo o consolidar recuerdos a largo plazo. Según `PROJECT_CONTEXT.md` (§7 y §30):

> **Cierre semanal:** Al terminar la semana se muestra completado, avanzado, pendiente, conscientemente pospuesto y cambios importantes.
> **Evitar lenguaje de fracaso:** No utilizar "Has incumplido 4 tareas". Preferir "Esto quedó pendiente" y "Esto decidiste conscientemente dejar para después".
> **AI propone. La persona decide.**
> **Código antes que IA.**

La Skill 11 (`close_week`) compara el plan semanal activo (`ProposedWeek`) con los resultados reales reportados por la persona (`itemOutcomes`), clasificando exhaustivamente cada elemento, auditando honestamente el uso de la capacidad y el espacio protegido, generando candidatos de memoria sin confirmar y resumiendo la semana con un tono constructivo y libre de culpas.

## Decisión

1. **100 % Determinista y Sin Modelos de IA**:
   - `close_week` opera completamente mediante TypeScript puro y esquemas Zod en `src/domain/close-week.ts` y `src/skills/close-week/deterministic.ts`.
   - Cero llamadas a proveedores externos de IA y cero consumo de tokens.

2. **Invariante de Conservación Total de Ítems (100% $S_{\text{plan}}$)**:
   - Todo elemento presente en el plan (`foci`, `obligations`, `flexibleOptions`, `deferredItems`) debe ser mapeado de forma biyectiva y unívoca en `classifiedItems`.
   - Elementos sin resultado en `itemOutcomes` no se descartan ni se transforman arbitrariamente en fallos: se clasifican explícitamente con disposición final `unreported` y activan el estado global `partial_data`.

3. **Tratamiento Diferencial de `deferredItems`**:
   - Los elementos diferidos en el plan original (`deferredItems`) no exigen reporte individual de la persona.
   - Pasan automáticamente a `carryOverCandidates` con motivo `not_scheduled`, manteniéndose disponibles en el radar sin reactivarse como obligaciones de la siguiente semana.

4. **Distinción entre Postergación Consciente y Elementos Descartados**:
   - `consciously_postponed` refleja una decisión explícita y meditada de la persona; se preserva en `carryOverCandidates` con su justificación y genera un candidato a recuerdo de tipo `decision`.
   - `dropped` refleja elementos explícitamente descartados de la atención actual; no se proponen para continuidad en el siguiente ciclo salvo reintroducción expresa.

5. **Aritmética y Auditoría Honesta de Horas**:
   - Se distinguen con rigor las horas estimadas de las reales (`actualHours`).
   - La ausencia de horas reales se modela como `null` y **nunca** como `0`.
   - Si el reporte de horas es incompleto, `capacityAnalysis.status` es `partial` y `spaceRespected` permanece estrictamente `null` (no se inventa cumplimiento ni vulneración).
   - Solo cuando el 100 % de los elementos reportan horas y la capacidad planificable es conocida, `spaceRespected` certifica determinísticamente si el trabajo real respetó el margen de espacio protegido.

6. **Generación de Candidatos de Memoria Sin Confirmar**:
   - Los candidatos generados tienen intención `actionIntent: "store"` y permanecen en estado no confirmado, listos para ser presentados a la persona y procesados por Skill 10 (`manage_memory`).
   - Focos logrados se proponen con categoría `fact`.
   - Postergaciones conscientes se proponen con categoría `decision`.
   - Reflexiones generales del usuario se proponen con categoría `project_context`.
   - No se generan recuerdos a partir de suposiciones ni elementos no reportados.

7. **Tono Reflexivo No Punitivo**:
   - Las plantillas de síntesis narrativa evitan métricas de "éxito porcentual", calificaciones de productividad o términos como "fallo", "deuda" o "incumplimiento".
   - Destacan logros, trabajo en curso, postergaciones conscientes y preguntas abiertas para el siguiente ciclo.

8. **Aislamiento de Entradas y Deduplicación**:
   - Elementos ajenos al plan en `itemOutcomes` se aíslan con advertencias en `warnings` sin contaminar `classifiedItems`.
   - Múltiples reportes para un mismo `itemId` se deduplican conservando la primera entrada comunicada.
   - Idempotencia garantizada mediante ordenamiento canónico de elementos y listas resultantes.

## Consecuencias
- Cierra orgánicamente el bucle retrospectivo del producto entre la ejecución de la semana y la planificación del ciclo siguiente.
- 16 pruebas automatizadas (4 de dominio y 12 de fixtures de comportamiento e invariantes) certifican todos los escenarios canónicos.
- Proporciona una base sólida y auditable para alimentar tanto el siguiente Brain Dump como la memoria permanente del usuario.
