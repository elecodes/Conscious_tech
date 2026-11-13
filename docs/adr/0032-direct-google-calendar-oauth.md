# ADR 0032 — Google Calendar OAuth: experimento aplazado

Fecha: 2026-11-13
Estado: Sincronización pendiente de revisión; experimento OAuth aplazado por decisión de la persona

La conexión OAuth directa añadió una configuración de Google Cloud que la persona considera más compleja que la integración anterior. Se conserva el flujo de disponibilidad iCal y exportación ICS en la vista de prueba.

El experimento completo, sus instrucciones y sus pruebas se guardan en la rama `codex/google-calendar-oauth-experiment`, commit `a9bc2ba`. Se retiran de la rama UX su panel, rutas, ejemplos de configuración y pruebas exclusivas. Notion MCP continúa activo.

No se borra ni migra ningún cuaderno o credencial. `.google-calendar-local/` permanece excluido de Git. Una conexión directa futura requiere justificar de nuevo su utilidad y simplicidad con la persona.

## Punto de reanudación — cierre del 13 de noviembre de 2026

Revisar primero la necesidad de sincronización con Google Calendar y la experiencia de conexión: envío puntual o actualización, dirección del intercambio y manejo de duplicados/conflictos. Comparar las opciones disponibles con el flujo iCal/ICS actual. No adoptar una solución que obligue a las personas usuarias a configurar proyectos de Google Cloud. El experimento guardado es una referencia, no una decisión de activarlo ni una promesa de conexión MCP equivalente a Notion.

Notion ha sido confirmado funcionando por la persona. La rama de prueba permanece separada de main y mantiene el origen local `http://localhost:5181`.
