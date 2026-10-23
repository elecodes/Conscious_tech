# ADR 0018: Radar de Imprevistos e Incorporación Soberana al Plan Activo

## Estado
Aprobado

## Contexto
En el ciclo de vida semanal (Secciones 21 a 25 de `PROJECT_CONTEXT.md`), una vez activado un plan semanal, la realidad no se detiene: surgen urgencias, tareas imprevistas, ideas espontáneas o reuniones sobrevenidas. 

El principio fundamental del producto es:
> **La IA propone. La persona decide. Ningún cambio silencioso.**

Para honrar este principio durante la semana en curso, se requerían las siguientes capacidades:
1. **Evaluación de Imprevistos en Tiempo Real (Radar)**: Capacidad de introducir cualquier novedad o imprevisto en lenguaje natural y analizar su impacto respecto al plan activo y la agenda sin mutar nada silenciosamente.
2. **Cuatro Veredictos Honestos y Claros**:
   - 🟢 *No cambia la semana*: Ideas o inquietudes sin compromiso que no requieren alterar el plan.
   - 🟡 *Opción flexible*: Tareas opcionales o sin compromiso que pueden realizarse si sobra tiempo.
   - 🟢 *Cabe en el espacio disponible*: Compromisos o tareas que caben dentro del margen de calma sin desplazar focos prioritarios.
   - 🔴 *Cambia el equilibrio*: Tareas que exceden la capacidad planificable o crean conflictos temporales, requiriendo alternativas de ajuste explícitas (Skill 09).
3. **Incorporación Soberana y Segura al Plan y Agenda**: El usuario debe tener botones explícitos para decidir si añadir los elementos a su semana, agregarlos como opciones flexibles o descartar el aviso. La incorporación debe ser atómica, recalcular la capacidad honestamente y garantizar identificadores únicos para evitar colisiones y pérdida de tareas en la interfaz.
4. **Extracción Determinista Robusta**: Descomposición limpia de listas telegráficas en español e inglés sin fragmentar expresiones de preocupación compuestas ni separar cláusulas de esfuerzo (como `", me llevará 2 horas"`).

---

## Decisiones

### 1. Pipeline de Aplicación del Radar (`src/application/radar-pipeline.ts`)
- Se implementó `evaluateRadarInput` orquestando:
  1. Extracción semántica determinista (Skill 01).
  2. Detección temprana de ideas/inquietudes puras (`no_change`).
  3. Detección de elementos flexibles (`flexible_option`).
  4. Análisis de impacto en capacidad (Skill 07 `analyzeChange`) y detección de conflictos temporales (Skill 08 `detectConflict`).
  5. Generación de alternativas de ajuste (Skill 09 `proposeAdjustment`) únicamente cuando el balance cambia (`hasDeficit || hasBlocking`).
- **Inmutabilidad estricta**: La evaluación recibe el plan y agenda como referencias de sólo lectura; nunca muta el estado persistido.

### 2. Integración en UI y Acciones de Decisión Humana (`src/web/components/weekly-session-view.tsx`)
- Renderizado de la sección Radar exclusivamente en el espacio de semana activa (`activeSpace === "active"` / "Mi semana").
- Presentación accesible del veredicto con título, badge cromático y listado de elementos extraídos.
- **Acciones Interactivas**:
  - `Añadir a mi semana` (`data-testid="radar-add-to-week-button"`): Incorpora tareas al plan activo (a `obligations` si tienen compromiso externo o fecha límite estricta, o a `flexibleOptions` como tareas de la semana). Asigna bloques diarios en la agenda si la fecha límite cae dentro del rango semanal.
  - `Añadir como opciones flexibles` (`data-testid="radar-add-as-flexible-button"`): Incorpora todos los elementos como condicionales (*"si sobra tiempo"*), protegiendo focos y calma.
  - `Descartar aviso` (`data-testid="radar-cancel-button"` / `radar-dismiss-button`): Limpia el radar sin alterar la semana.
  - `Aplicar este ajuste` (`data-testid="apply-radar-proposal-${prop.id}"`): Aplica atómicamente propuestas de ajuste cuando el balance cambia.

### 3. Aislamiento de Identificadores y Prevención de Colisiones
- Al incorporar elementos desde el Radar, se mapean todos los IDs existentes en el plan (`foci`, `obligations`, `flexibleOptions`, `deferredItems`).
- Se resuelven IDs únicos garantizados (`item-radar-${timestamp}-${counter}`) para evitar que `extractPlanItems` descarte elementos recién agregados por deduplicación de IDs sintéticos (`item-mock-1`).

### 4. Robustecimiento del Extractor Determinista (`src/providers/mock-deterministic-extractor.ts`)
- Soporte de verbos de acción en inglés (`COMMON_ENGLISH_ACTION_VERBS`).
- Detección de cláusulas de esfuerzo (`isEffortClause`) para fusionar expresiones como `", me llevará 2 horas"` al ítem anterior en lugar de tratarlas como tareas independientes.
- Regla de salvaguarda para preocupaciones compuestas (`isConcern`), impidiendo la división de frases de desahogo o agobio.
- Corrección de límites de palabra con caracteres Unicode acentuados en expresiones temporales.

---

## Consecuencias

### Positivas
- Se cierra el bucle completo de interacción durante la semana activa: el usuario puede capturar imprevistos, recibir un análisis inmediato y decidir soberanamente cómo incorporarlos.
- Cero mutaciones silenciosas: la agenda y el plan sólo cambian por acción explícita del usuario.
- Conservación y visualización fiable de tareas: no se pierden tareas por colisiones de ID.
- Suite de pruebas completa en verde: 789 tests en 56 archivos pasando sin errores.

### Consideraciones
- Si una tarea incorporada no tiene estimación de horas, la completitud de la estimación pasa honestamente a `partial` y se muestra el aviso calmado correspondiente sin alarmas intrusivas.
