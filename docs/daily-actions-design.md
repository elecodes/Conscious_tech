# Acciones diarias: contrato previo a la implementación

Estado: diseño propuesto. No hay botones ni cambios de persistencia implementados.
Rama de trabajo: `codex/ux-step-by-step`. Continúa el paso 7 del plan UX.

## Resultado esperado

Desde Mi semana, una persona podrá registrar que terminó un elemento, mover una
asignación o aplazarlo. Cada acción tendrá un resultado visible, persistirá al
recargar y ofrecerá una reversión segura. El cierre seguirá siendo una revisión
explícita de todos los elementos, incluidos los que quedaron fuera de la semana.
No se añaden porcentajes de productividad, rachas ni llamadas a IA.

## Lo que permite el código actual

| Área           | Evidencia                                                                                                                                    | Consecuencia                                                                                                 |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Progreso       | `WeeklySessionView` guarda `dispositions` con `useState`; `StoredWeeklyPlanSchema` no contiene resultados diarios.                           | Un botón de completar que solo cambie el componente perdería su estado al recargar.                          |
| Movimiento     | `applyAdjustmentToSchedule` admite `reassign_time_block` y `reallocate_day_work`, valida colisiones y conserva horas.                        | Reutilizar estas operaciones para una asignación concreta, con selección explícita si hay varias.            |
| Postergación   | `postpone_item` elimina bloques y asignaciones del elemento y conserva la decisión en el historial; no cambia la propuesta.                  | La vista debe mostrar la postergación vigente, sin seguir presentando el elemento como compromiso pendiente. |
| Deshacer       | `ScheduleLifecycleStatusSchema` admite `reverted`, pero no hay operación pública de reversión ni estado previo completo de una postergación. | La etiqueta del esquema no basta: hace falta una operación y evidencia reversible.                           |
| Cierre         | `close-week/deterministic.ts` trata un resultado distinto de `consciously_postponed` como contradictorio si hay postergación vigente.        | No dar prioridad silenciosa a «completado»: resolver o revertir la postergación antes.                       |
| Continuidad    | `findPendingCarryOverTasks` combina candidatos del último cierre y postergaciones activas; deduplica por `itemId`.                           | Conservar identidad y semana destino; presentar candidatos para elegir, sin insertarlos automáticamente.     |
| Reapertura     | `reopenWeek` reactiva el plan y elimina su informe en una transacción.                                                                       | Capturar los resultados revisados antes de eliminar el informe cuando se implemente el progreso persistente. |
| Compatibilidad | Agenda y copia JSON usan esquemas estrictos; el respaldo actual tiene versión 1.                                                             | Cualquier campo nuevo exige validación, pruebas de importación y preservación por los escritores existentes. |

Referencias: ADR 0011 (cierre), 0012 (agenda), 0013 (persistencia), 0014
(reapertura), `src/application/weekly-session-service.ts`,
`src/application/weekly-session-carryover.ts`,
`src/domain/schedule-adjustment-applier.ts` y
`src/infrastructure/storage/indexeddb/backup.ts`.

## Contrato de las acciones

| Acción visible         | Qué cambia                                                                           | Qué conserva                                                                                                                                                   | Deshacer                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Marcar como completado | Resultado explícito del `itemId` en esta semana.                                     | Pertenencia a la propuesta, estimaciones, bloques históricos y capacidad planificada. Completar no demuestra horas reales ni libera capacidad automáticamente. | Restituye el resultado anterior, incluso «sin registrar»; nunca inventa `not_started`.             |
| Mover una asignación   | Un bloque concreto o una cantidad explícita de horas entre días de la semana activa. | Total de horas y demás asignaciones; no cambia fecha límite ni resultado.                                                                                      | Restituye solo la asignación afectada, tras validar versión y colisiones.                          |
| Aplazar                | Retira las asignaciones del elemento, registra motivo y destino opcional.            | Identidad, fuentes y pertenencia original para auditoría y cierre.                                                                                             | Repone sus asignaciones anteriores y revierte la decisión vigente; no restaura la agenda completa. |

Primera interfaz: solo «Marcar como completado» en elementos individuales y su
«Deshacer». Mover y aplazar llegan en incrementos separados. Un foco agrupado no
se completa en bloque: se registran sus miembros y se deriva el resultado del
foco como ya hace el cierre. No se reparte su esfuerzo agregado arbitrariamente.

Un completado conserva acceso a detalles y corrección. Una postergación vigente
se muestra fuera de las prioridades, con su destino/motivo. Si se intenta
completar un elemento postergado, se explica la contradicción y se ofrece revisar
la postergación. Si su reversión ya no es segura, se mantiene el estado y se pide
revisar la agenda actual. No se elimina evidencia para hacer pasar el cierre.

## Persistencia mínima propuesta

Añadir un campo opcional `itemActivity` a `WeeklySchedule`, usando la versión de
agenda existente para controlar concurrencia. No crear otro almacén ni modificar
el contrato de propuestas de IA.

- `outcomes`: resultados explícitos por `itemId`, con los estados y datos del
  contrato `ItemOutcomeInput` existente. La ausencia significa «sin registrar».
  Un `itemId` aparece como máximo una vez y debe pertenecer al inventario del plan.
- `history`: registros tipados de acciones diarias, con identificador único,
  fecha, elemento, versión aplicada y los valores anteriores/posteriores del
  alcance afectado. Una reversión referencia la acción original y conserva su
  evidencia. Para movimientos/postergaciones también referencia el ajuste existente;
  no sustituye ni duplica sus decisiones humanas.
- La primera implementación solo habilita registrar `completed` y restaurar el
  valor previo. El tipo reutiliza resultados existentes para conservar correcciones
  del cierre al reabrir; no añade cinco controles nuevos.

Las semanas antiguas sin `itemActivity` se leen como «sin actividad registrada».
La primera acción escribe el campo. No inferir progreso por fechas pasadas,
asignaciones, exportaciones ni pertenencia a aplazados.

El servicio debe leer plan y agenda, comprobar que la semana sigue activa,
validar pertenencia, versión e identificador de acción, y guardar resultado e
historial en una sola transacción. La comprobación de estado y versión debe
repetirse dentro de la transacción; una lectura previa no evita otra pestaña.
Doble activación con el mismo identificador produce un solo efecto. Error de
almacenamiento: estado anterior intacto y mensaje visible; no mostrar éxito antes
de persistir. El camino de repositorios en memoria debe ofrecer el mismo contrato.

Auditar todos los escritores de agendas (ajustes manuales, radar, guardado,
importación y reapertura): deben conservar el campo opcional, no reconstruir una
agenda que lo pierda. Las operaciones de resultados no modifican la capacidad
planificada ni los archivos ICS; esos efectos requieren una decisión aparte.

## Deshacer y concurrencia

Para la primera versión, permitir deshacer únicamente cuando la versión actual
coincide con la versión producida por esa acción y la semana continúa activa.
Es una regla conservadora: un cambio posterior, incluso de otro elemento, obliga
a revisar el estado actual. No se promete deshacer arbitrario del historial.

1. Comprobar identificador, versión, vigencia y estado posterior esperado.
2. Validar el resultado inverso con los invariantes de agenda existentes.
3. Guardar el alcance restaurado, el registro de reversión y una versión nueva
   en una transacción. Conservar fechas y decisión originales del ajuste.
4. Ante conflicto, no modificar nada. Mostrar «La semana cambió después de esta
   acción. Revisa la versión actual antes de corregirla» y permitir recargar.

«Deshacer» permanece accesible desde la última acción compatible tras recargar;
no depende únicamente de un aviso temporal. Un historial antiguo sin datos previos
suficientes es consultable, pero no recibe un botón de reversión inventado.

## Cierre, reapertura y arrastre

- Al abrir el cierre, precargar los resultados diarios guardados. Mostrar cuáles
  ya estaban registrados y permitir corregirlos. Las selecciones explícitas de
  esta revisión prevalecen sobre esos valores iniciales; no emitir dos resultados
  contradictorios para el mismo ID.
- Conservar «sin revisar» donde no haya resultado. Aplazados e ideas no pasan a
  «no iniciados» automáticamente. Mantener la detección de contradicciones con
  postergaciones vigentes y exigir resolverlas explícitamente.
- Al confirmar, enviar un único resultado por ID al motor actual. Validar en la
  transacción la versión revisada: un cambio en otra pestaña requiere recargar y
  revisar otra vez. No sobrescribir selecciones locales mientras se revisa.
- El informe persistido sigue siendo la autoridad de una semana cerrada. No aceptar
  acciones diarias ni deshacer sobre ella.
- Al reabrir, copiar al estado de actividad los resultados explícitos del informe
  antes de eliminarlo, dentro de la misma transacción de reapertura. No copiar
  `unreported` como un resultado inventado. Mantener el bloqueo si hay otra semana
  activa. Un fallo conserva tanto informe como estado cerrado.
- El arrastre desde cierres sigue usando sus candidatos. Para postergaciones
  activas, excluir resultados completados/descartados y decisiones revertidas o
  sustituidas. Conservar filtro por semana destino e identidad; elegir un candidato
  que ya existe en el borrador no lo duplica.
- Deshacer una postergación retira su candidatura en futuras consultas. No elimina
  silenciosamente un elemento que la persona ya incorporó a otro borrador; ese
  borrador es una decisión independiente que deberá revisarse explícitamente.

## Compatibilidad y verificación requerida

El campo opcional evita una migración de almacenes IndexedDB. El lector actualizado
debe restaurar copias de versión 1 sin el campo y conservarlo en nuevas copias.
Esto es compatibilidad con datos antiguos, no una promesa de que una app antigua
acepte campos nuevos: sus esquemas estrictos pueden rechazarlos. No hacer downgrade
silencioso que borre progreso. Validar copias antes de cualquier escritura.

Antes de habilitar cada control, cubrir:

- Registro, recarga, repetición del mismo comando y fallo transaccional.
- Dos pestañas: conflicto de versión, cierre concurrente y reversión rechazada
  después de un cambio posterior, sin escrituras parciales.
- Completar un miembro de un foco sin completar sus otros miembros ni multiplicar
  horas; elementos flexibles/aplazados siguen presentes en el inventario.
- Movimiento: conservación de horas, selección entre varios bloques, colisiones y
  límites de semana. Postergación: retiro y restauración exactos de asignaciones.
- Cierre: precarga, corrección explícita, sin revisar y contradicción con
  postergación; completados no reaparecen como candidatos.
- Reapertura: conservación de resultados revisados, atomicidad y unicidad de semana
  activa. Arrastre: destino, deduplicación y borrador ya creado antes de deshacer.
- Copia antigua, copia nueva, restauración inválida, exportación y escritores de
  agenda que preserven actividad. Navegador móvil, teclado y mensajes de error.

## Orden de entrega

1. **7a: persistencia y contrato.** Campo opcional, operación de completar/revertir,
   transacciones, compatibilidad y pruebas de concurrencia. Sin nuevos botones.
2. **7b: completar de principio a fin.** Control individual, historial/deshacer,
   recarga, integración con cierre, reapertura y arrastre. Habilitar solo cuando
   todo este recorrido esté verificado.
3. **7c: mover.** Selección de asignación y reversión mediante el motor existente.
4. **7d: aplazar.** Captura reversible, presentación de vigencia y candidatos de
   arrastre. Resolver el caso de postergación seguida de finalización.

Cada entrega requiere su propio commit verificado. Este documento completa la
investigación del paso 7; la implementación y su aceptación funcional siguen
pendientes. El próximo incremento es 7a.
