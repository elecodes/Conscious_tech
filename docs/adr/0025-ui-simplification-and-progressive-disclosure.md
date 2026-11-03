# 25. Simplificación de la interfaz y divulgación progresiva

Fecha: 3 de noviembre de 2026  
Estado: Aceptado

## Contexto

Una persona nueva encontraba la interfaz difícil de entender: el selector de
proveedor de IA aparecía en todas las pestañas, había dos campos
casi idénticos para escribir ideas (Capturar y Preparar), la pestaña
Preparar mostraba fechas, calendario y dictado antes del campo principal, y
las pantallas con datos (propuesta y semana activa) mostraban a la vez
balance de capacidad, insignias, botones por tarea, imprevistos, historial y
memorias. Había además vocabulario interno ("Radar", "Memorias activas
confirmadas", "Cierre reflexivo", "volcado mental").

La simplificación debía mantener toda la funcionalidad y los principios del
producto ("La IA propone. La persona decide.").

## Decisión

1. **Una sola acción siguiente por pantalla.** Barra de "Paso sugerido"
   derivada del estado existente (sin estado nuevo). Su botón se oculta
   cuando ya se está en la pestaña de destino.
2. **Pestañas y vocabulario claros.** Ideas, Planificar, Mi semana, Cierre.
   Radar pasa a "Imprevistos"; "Memorias activas confirmadas" a "Lo que he
   aprendido"; "Cierre reflexivo" a "Cierre de semana". Los nombres de
   dominio y esquema no cambian.
3. **Pestaña inicial según el estado.** Sin semana activa ni borrador se
   abre Ideas; con borrador, Planificar; con semana activa, Mi semana. Se
   decide solo con estado existente y espera a que cargue para evitar
   parpadeos.
4. **Elementos técnicos fuera de la vista principal.**
   - Opciones de desarrollo e inspector JSON solo con `?dev=1` (persistido
     en `sessionStorage`).
   - El selector de proveedor de IA vive en el menú "Ajustes"
     ("Asistente de IA"), cerrado por defecto; copia de seguridad y
     restauración también en Ajustes.
   - Se elimina el indicador "Presencia" y el avatar de la cabecera, que
     no tenían función.
5. **Divulgación progresiva en las pantallas con datos.**
   - Propuesta: una frase de capacidad (desglose completo plegado), una
     fila por elemento con un menú "Más", elementos diferidos plegados con
     su recuento y un único botón principal "Confirmar y activar semana"
     (resto en "Más acciones").
   - Semana activa: tareas primero, menú "Más" por tarea; Imprevistos,
     historial y aprendizajes plegados con recuento.
   - Planificar: fechas, calendario y "limpiar" dentro de "Opciones"; el
     dictado como botón compacto; "Añadir más ideas" plegado.
6. **Cero cambios de lógica.** No se modificaron dominio, skills,
   proveedores ni persistencia. Todo lo plegado sigue siendo accesible con
   teclado (elementos `details`/botones) y conserva su comportamiento.
7. **Red de seguridad.** La prueba de humo recorre el flujo completo
   (ideas → propuesta → semana activa → cierre), comprueba cada menú o
   sección plegada, el aterrizaje inicial en Ideas y la recarga en Mi semana con
   semana activa, asegurando cero regresiones visuales o de interacción.

## Consecuencias

- **Menor carga cognitiva para nuevos usuarios:** La interfaz no satura con configuraciones o metadatos innecesarios de entrada, manteniendo el foco en la acción presente.
- **Divulgación progresiva sin pérdida funcional ni de soberanía:** Todo el detalle (balances analíticos, exportaciones, historial, ajustes finos) permanece accesible a un clic de distancia mediante elementos nativos y accesibles (`details`/`summary`).
- **Integridad y desacoplamiento:** No hubo alteraciones en contratos de persistencia, invariantes de dominio ni esquemas de datos.
- **Validación continua en navegador:** Las pruebas de humo en Chromium (`npm run test:smoke`) y las pruebas unitarias y de denegación de voseo (`tests/voseo-denylist.test.ts`) blindan la experiencia contra regresiones de navegación, renderizado y redacción.
