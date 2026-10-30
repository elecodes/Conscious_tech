# ADR 0014: Inspección de Semanas Cerradas y Soberanía de Reapertura del Ciclo Semanal

## Estado

Aprobado

## Contexto

En Conscious Tech, los principios rectores establecen:

> **La IA propone. La persona decide.**
> **La persona permanece en control.**
> **No hay cambios silenciosos ni callejones sin salida: el usuario puede corregir, deshacer, posponer o eliminar.**

Al implementar y validar el ciclo de cierre semanal (`close_week`) y la persistencia local en IndexedDB (ADR 0011 y ADR 0013), se identificaron dos requerimientos esenciales de soberanía y experiencia de usuario cuando el estado del sistema pasa a `no_active_session`:

1. **Visibilidad e inspección del plan cerrado:** El cierre semanal consolida resultados y reflexiones, pero la vista de estado previo únicamente exhibía métricas agregadas en badges (fechas, tareas completadas, postergadas y descartadas). El usuario no podía auditar en detalle qué tareas formaban parte del plan, qué focos u obligaciones se habían establecido, ni las horas reales registradas frente a las estimadas.
2. **Reversibilidad y corrección de cierres prematuros:** Una semana cerrada no debe ser una trampa inmutable si el usuario cerró por error, antes de tiempo o requiere añadir/ajustar tareas reales. Si no existe otra semana activa concurrente, el usuario debe contar con la capacidad explícita de **reabrir la semana**.

Adicionalmente, se detectó una discrepancia de formato temporal durante la deserialización de fechas de cierre (`YYYY-MM-DD` vs `ISO-8601 UTC timestamp`), generando excepciones de tipo `InvalidRecordDataError` en registros guardados en almacenes locales.

---

## Decisiones

### 1. Inspección detallada y no mutativa (`ClosedWeekSummary`)

Se amplía la tarjeta `latestClosedWeek` en `WeeklySessionView` para ofrecer un acordeón interactivo de auditoría («Ver detalle de la semana» / «Ocultar detalle»), exponiendo de forma transparente:

- **Focos principales:** Títulos, resultados deseados y horas estimadas.
- **Obligaciones y compromisos fijos:** Fechas límite y esfuerzo planificado.
- **Opciones flexibles:** Condiciones de ejecución y horas asignadas.
- **Balance pormenorizado de ítems:** Lista completa de tareas con badges de estado final (_Completada_, _Postergada_, _En progreso_, _Descartada_, _Sin reportar_), comparativa de horas reales vs. estimadas, notas del usuario y motivos de postergación consciente.
- **Reflexión retrospectiva:** Análisis de capacidad, logros consolidados y preguntas abiertas para el siguiente ciclo.

Esta visualización es 100% de lectura y no genera efectos colaterales sobre el almacenamiento.

### 2. Capacidad de reapertura atómica (`reopenWeek`)

Se introduce el método `reopenWeek(planId: string): Promise<ReopenWeekResult>` en `WeeklySessionService` y se integra en `WeeklySessionController`:

- **Invariante de unicidad:** Valida que no exista ningún otro plan activo en el repositorio (`getActivePlans()`). Si existe otro plan activo, rechaza la operación con `conflict_active_plan_exists` evitando inconsistencias.
- **Atomicidad transaccional:** Dentro de una transacción `readwrite` en IndexedDB sobre `[plans, close_reports]`:
  1. Revierte el estado del plan de `closed` a `active` y actualiza `updatedAt`.
  2. Elimina el informe de cierre previo (`close_reports`) asociado al `planId`. De este modo, la semana vuelve a comportarse como una semana en curso y puede ser cerrada nuevamente con datos actualizados en el futuro.
- **Actualización reactiva de sesión:** Invoca automáticamente `reloadSession()` en el controlador, transicionando la UI a `session_resumed` sin recargas manuales.

### 3. Normalización resiliente de fechas de cierre (`ClosedAtTimestampSchema`)

En `src/domain/close-week.ts` y `src/domain/repositories/types.ts`, el esquema `ClosedAtTimestampSchema` preprocesa cadenas de fecha en formato `YYYY-MM-DD` convirtiéndolas deterministamente a timestamps ISO-8601 UTC válidos (`${val}T23:59:59.000Z`), garantizando compatibilidad con registros preexistentes y eliminando fallos de deserialización.

### 4. Tolerancia a HMR (Hot Module Replacement)

Para evitar errores de tipo `TypeError: this.service.reopenWeek is not a function` en entornos de desarrollo durante recargas en caliente de React Fast Refresh, `WeeklySessionController` resuelve dinámicamente el prototipo de `WeeklySessionService` si la instancia en memoria es anterior al montaje del nuevo módulo.

---

## Consecuencias

### Positivas

- Se cumple cabalmente el principio de soberanía del usuario: ningún cierre es irreversible si la persona necesita continuar o enmendar su plan.
- Transparencia total sobre lo realizado durante la semana anterior.
- Resiliencia completa ante datos de fecha de cierre heredados en IndexedDB.
- Cobertura de pruebas completa (49 suites y 732 tests unitarios e integrados pasando sin consumo de tokens de LLM).

### Negativas / Mitigaciones

- Reabrir una semana elimina el informe de cierre preliminar. Esto es deliberado: evita informes huérfanos desfasados respecto al nuevo estado activo del plan. Cuando el usuario concluya su semana, generará un nuevo informe fiel a la realidad.
