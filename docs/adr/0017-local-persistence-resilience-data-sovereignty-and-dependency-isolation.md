# ADR 0017: Resiliencia en Persistencia Local, Soberanía de Datos y Actualización Aislada de Dependencias

## Estado
Aprobado

## Contexto
A medida que la aplicación madura hacia un uso real con persistencia en IndexedDB y almacenamiento de reflexiones e información personal sensible, surgieron requerimientos críticos de arquitectura y soberanía de datos:

1. **Riesgo de Pérdida en Fallos Parciales de Persistencia**: Al guardar o actualizar un plan semanal junto con su agenda (`createOrSavePlanAndSchedule`), si el guardado de la agenda fallaba (por ejemplo, por conflicto de versiones optimistas o cuota de almacenamiento), el mecanismo anterior ejecutaba `plans.delete(plan.planId)`. Si la operación era una modificación de un plan existente y no una creación desde cero, esto causaba la eliminación accidental y destructiva del plan preexistente.
2. **Soberanía del Usuario y Portabilidad de Datos**: Siguiendo el principio fundacional *"los recuerdos y planes pertenecen a la persona, no a la herramienta"*, el usuario debe tener control total sobre sus datos: capacidad de exportar toda la base de datos local en formato abierto JSON, restaurarla/importarla (mediante fusión o reemplazo total) y archivar o borrar definitivamente recuerdos individuales (derecho al olvido).
3. **Resiliencia en Borradores y Sesiones Inactivas**: Cuando no hay una semana activa (`no_active_session`), el usuario debe poder acceder a los recuerdos activos confirmados para planificar con contexto, además de permitir la eliminación selectiva de borradores correspondientes a una semana específica sin eliminar borradores de otras semanas.
4. **Mantenimiento y Actualización Segura de Dependencias**: El ecosistema de bibliotecas externas avanza rápidamente. Se requería auditar dependencias con saltos mayores usando Context7 (para evaluar breaking changes en `zod`, `groq-sdk` y herramientas de build), aplicando una actualización controlada de `groq-sdk` a 1.6.0 manteniendo el aislamiento estricto de proveedores de IA en la capa de infraestructura.

---

## Decisiones

### 1. Patrón de Transacción Compensatoria en `WeeklySessionService`
- En `createOrSavePlanAndSchedule`, se captura una instantánea previa (`previousPlan`) antes de cualquier mutación sobre el repositorio de planes.
- Si el guardado de la agenda falla:
  - Si el plan ya existía previamente, se restaura su estado anterior (`plans.save(previousPlan)`).
  - Únicamente si el plan fue creado como nuevo en esa operación se procede a su eliminación para no dejar huérfanos.
- Soporte explícito de control de concurrencia optimista mediante `expectedScheduleVersion` y avance automático de versión en agendas existentes.

### 2. Motor de Exportación e Importación de Datos (Soberanía Local)
- Se implementó `src/infrastructure/storage/indexeddb/backup.ts` con validación estricta en tiempo de ejecución vía Zod (`UserDataBackupSchema`, versión 1).
- Cubre exhaustivamente los 4 almacenes de IndexedDB: `plans`, `schedules`, `closeReports` y `memories`.
- La importación (`importUserData`) admite modos `merge` (fusión no destructiva) y `replace` (limpieza y restauración limpia).
- En `WeeklySessionService`, se exponen métodos directos para `exportBackup()`, `importBackup()`, `archiveMemory(id)` y `deleteMemory(id)`.

### 3. Exposición de Recuerdos en Estados de No-Sesión
- Al reanudar la sesión (`resumeSession()`), si el estado es `no_active_session`, se recuperan y entregan los recuerdos activos (`memories: activeMemories`) para que la vista de preparación de semana disponga de contexto inmediatamente sin requerir una semana activa en curso.

### 4. Actualización Aislada de `groq-sdk` a 1.6.0
- Se auditó la documentación de `groq-sdk` (v1.6.0) mediante Context7 (`/groq/groq-typescript`).
- La actualización se aplicó en `package.json` y se verificó que la encapsulación en `src/providers/groq-provider.ts` protege al dominio y a las skills de cualquier cambio de SDK.
- Las dependencias con cambios incompatibles profundos (como `zod` v4, que altera la semántica de `preprocess` y `.optional()`) se mantuvieron congeladas para garantizar estabilidad absoluta.

---

## Consecuencias

### Positivas
- Se elimina cualquier riesgo de pérdida de datos preexistentes ante errores transaccionales en IndexedDB.
- Soberanía de datos completa: el usuario puede hacer copias de seguridad de sus planes y reflexiones en cualquier momento y restaurarlas localmente.
- Se preserva el derecho al olvido y la gestión granular del ciclo de vida de la memoria.
- 100% de la suite de pruebas automatizadas pasando en verde: 776 tests en 54 archivos, incluyendo nuevas suites de regresión de fase 1 y fase 2 (`tests/phase1-stabilization-regression.test.ts`, `tests/phase2-sovereignty-and-resilience.test.tsx`, `tests/planning-clarity-and-item-adjustment.test.tsx`).

### Negativas / Consideraciones
- La exportación e importación maneja JSON en memoria en el cliente; para volúmenes históricos de varios años, el esquema versión 1 garantiza integridad estricta pero requerirá migraciones de versión de respaldo si el esquema de dominio evoluciona.
