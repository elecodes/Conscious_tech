# ADR 0030 — Copia opcional para Notion mediante CSV

Fecha: 2026-11-13
Estado: Aceptado para este primer paso incremental

## Contexto

Se solicita poder trasladar el calendario a Notion, además del cuaderno local. Una conexión permanente requeriría autorización de cuentas, almacenamiento seguro de credenciales y reglas de sincronización y conflictos. No se introducen esos servicios para una exportación puntual.

## Decisión

Ofrecer un CSV descargable explícitamente desde la semana activa y desde el historial, sin escribir en Notion. La persona importa el archivo y crea una vista Calendario. No se requiere IA ni nuevas dependencias.

Reutilizar el inventario y clasificación del calendario. Exportar cada reparto diario o bloque fijo como una fila, conservar horas y fechas reales, separar la fecha límite y mantener las tareas sin día y el esfuerzo restante sin asignar. Los informes de cierre proporcionan el estado final histórico. No repartir estimaciones de grupos por inferencia. Ambos tipos de asignación se conservan si coexisten; no se presume que un bloque y un reparto son equivalentes.

El CSV escapa comillas y saltos de línea y protege texto que podría interpretarse como fórmula en una hoja de cálculo. Las fechas se expresan como MM/DD/YYYY, según la documentación del importador. No hay horarios inventados; los bloques fijos incluyen su intervalo textual.

## Consecuencias y límites

- Copia puntual, sin sincronización, OAuth ni transmisión automática de datos.
- La vista de calendario se configura manualmente en Notion utilizando `Fecha`.
- Una nueva importación puede generar filas duplicadas; el identificador de tarea no se trata como un mecanismo de actualización.
- El CSV no reemplaza la copia JSON completa ni restaura el cuaderno de la aplicación.
- La exportación se comprueba con pruebas deterministas y descargas en Chromium. No se ha probado la importación en una cuenta real de Notion.
- Los puentes MCP autenticados de contexto de ADR 0019 siguen aplazados. Una futura sincronización requiere otra decisión y alcance explícito.

Referencias: [Importar CSV](https://www.notion.com/help/import-data-into-notion), [Vista Calendario](https://www.notion.com/help/calendars).
