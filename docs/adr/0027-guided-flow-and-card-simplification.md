# 27. Flujo guiado de nueva semana y simplificación de tarjetas

Fecha: 4 de noviembre de 2026  
Estado: Aceptado

## Contexto

A pesar de la simplificación de interfaz introducida en el ADR 0025, la separación entre las pestañas «Ideas» y «Planificar» seguía generando incertidumbre sobre el momento en que terminaba la extracción y comenzaba la preparación del plan semanal. Por otro lado, las tarjetas de ideas extraídas presentaban una densidad visual excesiva, mostrando de forma simultánea múltiples insignias de tipo, proyecto, estado y citas textuales de origen. Finalmente, la presencia de cuatro pestañas principales, incluyendo «Cierre», dispersaba la atención cuando el cierre es un hito de ciclo y no un espacio permanente de trabajo diario.

El objetivo de esta fase fue unificar las pestañas de entrada en un único flujo guiado paso a paso, simplificar las tarjetas a un formato sereno y reducir la navegación a dos espacios esenciales, manteniendo íntegros la lógica de negocio, el dominio, las habilidades, los proveedores de IA y los contratos de persistencia existentes.

## Decisión

1. **Flujo guiado «Nueva semana» con línea de progreso visible**:
   - Se unifican los pasos en una progresión clara de tres etapas: **Escribir → Revisar → Confirmar**.
   - **Escribir**: Un único área de texto con botón «Continuar →». Al pulsar «Continuar», se ejecutan la extracción de elementos y la generación de la propuesta semanal utilizando las funciones y contratos ya existentes. En caso de error, el texto introducido se conserva intacto y el usuario permanece en el mismo paso con mensaje descriptivo.
   - **Revisar**: Muestra los elementos identificados en forma de tarjetas serenas con sus casillas de selección, junto a la propuesta generada (resumen de capacidad en una frase, elementos programados y sección de diferidos colapsada). Mantiene colapsadas las secciones de «Añadir más ideas», «Opciones» (fechas, calendario, cuaderno limpio) y el botón compacto de dictado por voz. Incluye un botón visible «← Volver a escribir» que preserva todas las notas y selecciones.
   - **Confirmar**: Presenta la confirmación definitiva mediante el botón «Confirmar y activar semana», junto al menú colapsado «Más acciones». Incluye un botón visible «← Volver a revisar». Tras confirmar, navega automáticamente al espacio «Mi semana».

2. **Tarjetas de ideas serenas (Calm Idea Cards)**:
   - En la vista inicial de cada tarjeta solo se muestran el título y la fecha límite (si existe), junto a la casilla de inclusión.
   - Los datos adicionales (tipo de elemento, proyecto asociado, estado, estimación de esfuerzo y cita textual de procedencia) se trasladan tras un botón interactivo «Detalles» dotado de atributo `aria-expanded` y control por teclado.

3. **Reducción de pestañas a dos espacios principales**:
   - La barra de navegación superior se reduce a **«Mi semana»** y **«Nueva semana»**.
   - La funcionalidad de cierre se integra en «Mi semana» a través del botón visible **«Cerrar semana →»**, que abre la vista reflexiva preexistente sin alterar su componente ni su funcionamiento.
   - La barra de siguiente paso («Paso sugerido») solo se muestra cuando hay una decisión o acción pendiente, ocultándose en «Mi semana» cuando hay una semana activa en curso sin imprevistos ni cambios pendientes.
   - Se mantiene la regla de aterrizaje inicial (ADR 0025): sin semana ni borrador se inicia en «Nueva semana» (Escribir); con borrador se abre en «Nueva semana» (Revisar); con semana activa se abre en «Mi semana».

4. **Bienvenida de primer uso y ayuda contextual**:
   - Tarjeta informativa descartable de tres líneas («Escribe → Revisa → Vive tu semana»), visible únicamente en la primera visita gracias a un indicador local (`conscious_tech_welcome_dismissed`).
   - Se añade un botón en el menú «Ajustes» para volver a consultar la guía de bienvenida en cualquier momento.
   - Se incorporan bloques desplegables de ayuda contextual «¿Qué es esto?» en las secciones de «Imprevistos» y «Lo que he aprendido».

5. **Compatibilidad retrospectiva total**:
   - Se preservan todos los valores del tipo `NavigationSpace` (`capture`, `prepare`, `active`, `review`) y las claves de `localStorage`.
   - Los accesos directos o estados antiguos se mapean internamente hacia los dos espacios de la nueva interfaz sin pérdida de datos ni rotura de pruebas anteriores.

6. **Verificación y calidad**:
   - Cobertura de pruebas unitarias y de integración actualizada para transiciones de etapas, navegación hacia atrás con preservación de texto, retención en caso de error y reglas de aterrizaje.
   - Prueba de humo completa en navegador real (`scripts/smoke-test.ts`) ejecutada y validada en modos `preview` y `dev`.
