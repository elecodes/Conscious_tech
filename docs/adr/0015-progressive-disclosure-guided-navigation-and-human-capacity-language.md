# ADR 0015: Navegación Guiada en Cuatro Espacios, Divulgación Progresiva y Lenguaje Humano de Capacidad

## Estado

Aprobado

## Contexto

Durante el uso de Conscious Tech se identificó una acumulación de fricción cognitiva en la experiencia de usuario:

1. **Sobrecarga de información simultánea:** Las pantallas desplegaban a la vez notas crudas, extracción, configuración de capacidad, propuestas, paneles de fórmulas y avisos de certidumbre. El usuario no identificaba con claridad el siguiente paso a seguir.
2. **Jerga técnica y alarmista:** Términos como _«Resumen de viabilidad y capacidad»_, _«Presupuesto de energía cognitiva»_ y badges de _«Capacidad desconocida»_ o _«Carga total desconocida»_ sonaban a auditoría industrial o error de sistema en lugar de un cuaderno de notas reflexivo y en calma.
3. **Agrupación monolítica de acciones compuestas:** El extractor determinista trataba oraciones complejas con varias intenciones de acción (ej. _«También quiero avanzar X, estudiar Y y seguir con Z»_) como una sola tarea gigante, debido a la falta de segmentación por cláusulas coordinadas de acción.
4. **Acoplamiento de ciclo:** Preparar una semana futura o capturar ideas libres amenazaba con cerrar o mezclar el estado de la semana actualmente activa.

---

## Decisiones

### 1. Arquitectura de Navegación en Cuatro Espacios Claros

Se organiza la experiencia de la aplicación en 4 espacios reconocibles y accesibles mediante pestañas directas en el encabezado:

1. **Capturar:** Espacio limpio de notas libres tipo cuaderno personal, sin datos de muestra forzados ni distracciones.
2. **Preparar semana:** Extracción de tareas, revisión consciente de elementos no programados, configuración de disponibilidad y generación de propuesta semanal con posibilidad de guardar borrador.
3. **Mi semana:** Consulta y seguimiento de la semana activa, mapa de tiempo y registro de ajustes/reprogramaciones.
4. **Revisar y aprender:** Cierre reflexivo de la semana, asignación de disposiciones reales (_Completada_, _Postergada_, etc.) y consolidación de memoria bajo consentimiento humano explícito.

Se garantiza que preparar una nueva semana no cierre prematuramente la semana activa en curso.

### 2. Divulgación Progresiva en el Balance Semanal

Se reestructura la visualización de capacidad:

- **Resumen compacto visible por defecto:** Tarjetas métricas limpias para _Disponibles_, _Protegidas_, _Planificables_, _Planificadas_ y _Restantes_ (indicando _«Hasta Xh»_ cuando las tareas aún no tienen horas estimadas, en lugar del confuso e intimidante _«Desconocido»_).
- **Desglose técnico plegado:** Las fórmulas matemáticas, detalles de cálculo y desglose de certidumbre (_Límites de tiempo_ y _Carga y certidumbre_) se repliegan dentro de un acordeón `<details className="calm-details">` cerrado por defecto, accesible únicamente bajo demanda del usuario.

### 3. Humanización del Lenguaje del Producto

Se reemplazan términos técnicos y corporativos por expresiones alineadas con los principios de tecnología consciente:

- _«Resumen de viabilidad y capacidad»_ $\to$ **Balance de tu semana**
- _«Presupuesto de energía cognitiva»_ $\to$ **Tu tiempo de un vistazo**
- _«Espacio protegido»_ $\to$ Acompañado del subtítulo explicativo **Margen de calma**
- _«Capacidad desconocida»_ (ante tareas sin estimar) $\to$ **Tareas sin estimar**

### 4. Segmentación Determinista de Cláusulas de Acción Coordinadas

Se perfecciona el extractor determinista (`src/providers/mock-deterministic-extractor.ts`):

- **`normalizeFusedWords`**: Separa modales y perífrasis fusionadas por escritura rápida (ej. _«quieroavanzar»_ $\to$ _«quiero avanzar»_, _«voyahacer»_ $\to$ _«voy a hacer»_).
- **`splitCoordinatedActions`**: Discrimina cláusulas de acción unidas por comas o conjunciones (`y`, `e`) de listas de sustantivos comunes (_«Comprar manzanas, peras y bananas»_ permanece como una sola tarea; mientras que _«avanzar X, estudiar Y y seguir con Z»_ se descompone en 3 tareas independientes).
- **`cleanTitle` & `extractProject`**: Limpia muletillas conversacionales iniciales (_«También quiero...»_) y asocia proyectos clave (_Tecnología Consciente_, _ArchitectAI_).

---

## Consecuencias

### Positivas

- Reducción drástica del ruido cognitivo: la interfaz muestra solo lo necesario para la decisión actual.
- Flujo de planificación guiado, transparente y reversible que respeta la soberanía humana.
- Captura de notas naturales mucho más inteligente y tolerante a oraciones compuestas sin recurrir a llamadas costosas a LLMs.
- 100% de invariantes de dominio, esquemas de persistencia y tests automatizados preservados (746 tests pasando).

### Negativas / Pendientes

- Aún se debe continuar simplificando texto explicativo en pantallas secundarias para maximizar el minimalismo visual y la legibilidad a primera vista.
