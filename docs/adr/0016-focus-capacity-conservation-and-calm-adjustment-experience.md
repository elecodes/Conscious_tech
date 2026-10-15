# ADR 0016: Conservación Estricta de Focos, Barra HUD de Capacidad y Ajuste Calmado de Tareas

## Estado
Aprobado

## Contexto
Durante la interacción real con la aplicación surgieron varios puntos de fricción e inconsistencias en la experiencia:
1. **Límite de Focos en Propuestas con Muchos Elementos**: Al ingresar 7 elementos, el sistema arrojaba un error de validación `No se pudo activar la semana: Los datos de la propuesta no son válidos: Array must contain at most 3 element(s)` debido a que `ProposedWeekSchema.foci` tiene un tope estricto de 3. El generador determinista permitía que la lista candidata de focos superara 3, provocando el fallo al guardar o activar.
2. **Conservación de Elementos sin Pérdidas**: Cualquier elemento que exceda el tope de 3 focos no debe descartarse silenciosamente ni inventar identidades, sino preservarse en `deferredItems` (`out_of_capacity`) o, si el usuario decide incluirlo conscientemente, enrutarse a `flexibleOptions`.
3. **Sobrecarga Visual en la Sección de Capacidad**: La sección *«Capacidad y margen»* en *Mi semana* ocupaba demasiado espacio vertical con frases y tarjetas de cálculo repetitivas, empujando la agenda y la lista de tareas hacia abajo.
4. **Ruido Decorativo Artificial (*Washi Tape*)**: Las tarjetas de tareas y focos tenían una cinta adhesiva simulada (`.washi-card::before`) que se percibía pesada, recargada y poco funcional.
5. **Formulario de Ajuste de Tareas Confuso**: Al editar horas o día de una tarea y pulsar *«Guardar cambios»*, el formulario permanecía estático y completamente abierto en pantalla, generando desconcierto en el usuario sobre si la modificación había tenido éxito.
6. **Claridad en la Barra Superior**: La pestaña *«1. Capturar (Volcado & Extracción)»* contenía tecnicismos de implementación que no reflejaban el lenguaje calmado del cuaderno.

---

## Decisiones

### 1. Invariante de 3 Focos con Conservación Estricta
- Se mantiene el contrato de dominio de un máximo de 3 focos principales por semana (`foci.length <= 3`).
- El generador determinista (`src/skills/build-week/deterministic.ts`) limita estrictamente los focos candidatos a 3. Los focos excedentes se transforman automáticamente en `deferredItems` con motivo `out_of_capacity` y explicación transparente.
- En la interfaz de preparación (`weekly-planning-from-notes.tsx`), si el usuario incluye manualmente un elemento cuando ya existen 3 focos, este se deriva a `flexibleOptions` con la condición *«Reconsiderado e incluido conscientemente en la semana como opción flexible al alcanzarse el máximo de 3 focos»*.
- **Invariante de conservación**: Ningún ítem se pierde ni se duplica; cada elemento de entrada queda representado exactamente una vez.

### 2. Barra Compacta de Capacidad (HUD Top Bar)
- En *Mi semana* (`WeeklySessionView`), la sección de capacidad se sintetiza en una barra horizontal compacta:
  - Fila superior con resumen en píldoras: `Disponibles`, `Planificadas`, `Planificables`, `Protegidas` y `Restantes` junto al badge de estado.
  - Barra de progreso delgada (6px) para visualizar la proporción de tiempo.
  - El desglose detallado de fórmulas, tarjetas de límites de tiempo y certidumbre se repliegan en un desplegable discreto (*«Ver desglose completo de cálculos y límites»*).

### 3. Eliminación del Motivo de Cinta Adhesiva (*Washi Tape*)
- Se elimina el pseudoelemento `.washi-card::before` en `src/web/style.css` y se normalizan las tarjetas a `.item-card`, logrando una estética limpia, ligera y con padding equilibrado.

### 4. Ajuste Calmado con Cierre Automático y Confirmación
- El panel de ajuste de tareas pasa a ser un elemento plegable (`<details className="calm-details">`).
- Al pulsar *«Guardar cambios»*:
  - Los cambios de horas y asignación de día se persisten atómicamente en el plan y en la agenda (`WeeklySchedule.dailyAllocations`).
  - El formulario se cierra automáticamente.
  - Se despliega una confirmación verde tranquila (*«✓ Ajuste guardado para «{tarea}»: {horas}h {asignación}»*) con acceso directo a *«Ajustar otra tarea»*.
- Se añade un botón explícito de *«Cerrar»* dentro del formulario.

### 5. Simplificación del Menú de Navegación
- Se renombra la primera pestaña de la barra superior a **`1. Capturar ideas`** en `src/web/App.tsx`.

---

## Consecuencias

### Positivas
- Resuelto el error de límite Zod al activar semanas con 7 o más elementos.
- Respeto total al principio de no sobrecargar la atención humana (máximo 3 focos).
- Experiencia de uso mucho más ágil, sin formularios que queden abiertos indefinidamente.
- Reducción sustancial del ruido visual en las tarjetas y en la visualización de capacidad.
- 100% de la suite de pruebas automatizadas (750 tests en 51 archivos) pasando en verde.

### Negativas / Consideraciones
- Si el usuario desea asignar más de 3 focos prioritarios, el sistema lo reconduce a tareas flexibles para salvaguardar el foco cognitivo semanal.
