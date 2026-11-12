# 29. Planificación desde el calendario y recuperación explícita de tareas

Fecha: 11 de noviembre de 2026
Estado: Aceptado en la rama de prueba `codex/ux-step-by-step`

## Contexto

Las revisiones con la persona usuaria mostraron demasiados pasos y texto entre
capturar tareas, elegir días y ajustar horas. La vista semanal debía permitir
correcciones locales y dar contexto de semanas futuras sin reducir permanentemente
el espacio del calendario. Una tarea podía necesitar varios días y las tareas
fuera de semana requerían bajar a otros controles para recuperarlas.

## Decisión

- El calendario editable es la vista principal de revisión del borrador. La
  activación de la semana sigue siendo una decisión explícita de la persona.
- Las horas totales de una tarea pueden repartirse entre fechas mediante
  asignaciones diarias existentes. El total y el recuento de tareas no se duplican.
  Mover una parte conserva las demás; las estimaciones compartidas y los horarios
  fijos mantienen controles específicos.
- Los repartos del borrador se guardan en el campo opcional
  `draftContext.plannedAllocations`. Al activar, las asignaciones reales de la agenda
  son la fuente de verdad. Los respaldos anteriores siguen siendo válidos.
- El panel Mis semanas muestra la activa y las futuras; puede ocultarse con un
  control visible y devolver su ancho al calendario. La vista mensual facilita
  navegar entre semanas sin sustituir sus borradores ni decisiones.
- Una bandeja visible encima de los días permite recuperar tareas fuera de semana
  o aplazadas, con arrastre y alternativa por botón. Soltar abre un diálogo de día y
  horas: cancelar no escribe, guardar incluye únicamente esa tarea. Las horas sin
  estimar permanecen desconocidas y no se convierten en una hora por defecto.
- Recuperar un aplazamiento registra la acción `resume`, vuelve el resultado a
  `not_started` y revierte solo sus registros de aplazamiento activos, conservando la
  historia y los resultados de otras tareas. No usa el deshacer de la última acción.
- Las escrituras de propuesta y agenda son atómicas y comprueban la versión
  esperada. Las correcciones de calendario no requieren llamadas nuevas de IA.
- Las tarjetas muestran las horas diarias en formato breve, por ejemplo `1 h`.
  Repartir horas conserva sus detalles dentro del editor; Ajustar horas es compacto.

## Consecuencias y límites actuales

La persona puede organizar tareas desde su contexto diario sin repetir el esfuerzo
semanal. Persistencia, capacidad, fechas y cambios concurrentes siguen validados.
La recuperación de tareas aplazadas no elimina silenciosamente un plan futuro que
la persona haya organizado de forma independiente.

El 12 de noviembre se agrupan instrucciones y leyenda en desplegables de ayuda,
con las acciones visibles. La persona confirma corregida la repetición del dictado Chrome ese mismo día.
La separación de tareas por el comando explícito «siguiente tarea» se incorpora
después (ver ADR 0019). Quedan pendientes su comprobación hablada por la persona
y el arrastre de tareas **ya incluidas pero sin día**.
No confundir este último caso con la bandeja de tareas fuera de semana implementada.

## Evidencia y seguimiento

- Última verificación funcional completa: 1.081 pruebas en 85 archivos, tipos,
  lint, formato, ciclos, compilación y navegador en preview y desarrollo.
- El último cambio visual del botón se verificó después en navegador, tipos y lint.
- [Próxima sesión y pruebas previstas](../ux-improvement-plan.md).
- Decisiones relacionadas: [flujo guiado](0027-guided-flow-and-card-simplification.md),
  [persistencia local](0013-local-persistence-architecture-contract.md) y
  [dictado nativo](0019-native-voice-dictation-and-mcp-integration-architecture.md).

## Corrección visible de tareas — 12 de noviembre de 2026

Las tarjetas del borrador ofrecen Editar tarea y el pie Editar intención o elementos
abre un diálogo explícito, en lugar de activar una revisión que quedaba oculta en
secciones cerradas. Guardar cambia los nombres en fuente y propuesta preservando
ID, procedencia original, decisiones, horas y asignaciones. Cancelar no escribe.
Añadir más ideas abre el campo correspondiente y evita colisiones de ID al anexar.
