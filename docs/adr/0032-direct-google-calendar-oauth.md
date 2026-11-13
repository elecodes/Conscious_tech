# ADR 0032 — Google Calendar OAuth: experimento aplazado

Fecha: 2026-11-13
Estado: Aplazado por decisión de la persona

La conexión OAuth directa añadió una configuración de Google Cloud que la persona considera más compleja que la integración anterior. Se conserva el flujo de disponibilidad iCal y exportación ICS en la vista de prueba.

El experimento completo, sus instrucciones y sus pruebas se guardan en la rama `codex/google-calendar-oauth-experiment`, commit `a9bc2ba`. Se retiran de la rama UX su panel, rutas, ejemplos de configuración y pruebas exclusivas. Notion MCP continúa activo.

No se borra ni migra ningún cuaderno o credencial. `.google-calendar-local/` permanece excluido de Git. Una conexión directa futura requiere justificar de nuevo su utilidad y simplicidad con la persona.
