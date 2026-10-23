# ADR 0020: Integración de Google Calendar mediante Feed iCal y Análisis de Capacidad

## Estado
Aprobado

## Contexto
Para planificar una semana de forma consciente y realista (principio *AI proposes. The person decides*), es crítico conocer los **compromisos fijos e inamovibles** (reuniones con clientes, clases, turnos médicos) antes de distribuir tareas.

Se evaluaron dos enfoques de integración con Google Calendar:
1. **OAuth2 / Google Cloud API / Servidor MCP bidireccional**: Alto coste de configuración (Google Cloud Console, Client ID, Client Secret, consent screen, refresh tokens que caducan). Innecesario para un producto donde la regla es **no mutar el calendario silenciosamente**.
2. **Feed iCal Privado (RFC 5545) y Carga de Archivo `.ics`**: Cero coste, sin configuración en Google Cloud, 100% privado y soberano, y resuelve exactamente la necesidad: **leer los eventos con horario de la semana para deducir la capacidad real ocupada y advertir sobre colisiones**.

---

## Decisiones

### 1. Modelo de Dominio de Calendario (`src/domain/calendar.ts`)
- Esquema estricto `CalendarEvent`:
  - `id`, `title`, `day` (YYYY-MM-DD), `startTime` (HH:MM), `endTime` (HH:MM), `durationHours`, `allDay`, `location`, `description`.
- Cálculo de resumen semanal `calculateCalendarWeekSummary`:
  - Suma de horas comprometidas en reuniones (`totalCommittedHours`).
  - Desglose diario (`dailyCommittedHours`).
  - Restricciones diarias (`DayConstraint[]`) con horas restantes disponibles sobre la base de jornada (ej. 8h).
  - Conversión a `TimeBlock[]` para interoperabilidad directa con el detector de colisiones (`detectConflict`).

### 2. Parser Determinista RFC 5545 (`src/infrastructure/calendar/ical-parser.ts`)
- Parser sin dependencias externas:
  - Despliegue de líneas (line unfolding).
  - Bloques `BEGIN:VEVENT` ... `END:VEVENT`.
  - Fechas UTC (`YYYYMMDDTHHMMSSZ`), locales (`YYYYMMDDTHHMMSS`) y de todo el día (`YYYYMMDD`).
  - Descarte automático de eventos cancelados (`STATUS:CANCELLED`).
  - Expansión de recurrencias semanales básicas (`RRULE:FREQ=WEEKLY`).
  - Filtro por rango semanal.

### 3. Proxy Local Anti-CORS con Protección SSRF (`src/server/calendar-proxy-handler.ts`)
- Endpoint local `/api/calendar/fetch-ical`:
  - Valida que la URL sea un recurso HTTP/HTTPS/webcal seguro (`isSafeCalendarUrl`).
  - Bloquea accesos a localhost, 127.0.0.1, y rangos IP privados RFC 1918 (anti-SSRF).
  - Timeout de 12 segundos y límite de 5 MB.
- También soporta carga directa de archivos `.ics` en el cliente sin requerir llamadas al servidor.

### 4. Componente de Sincronización en UI (`src/web/components/calendar-sync-card.tsx`)
- Card calmo y plegable antes de introducir notas.
- Guarda la URL iCal de forma local en `localStorage` para no obligar a reescribirla en cada sesión.
- Muestra el total de horas ocupadas y los eventos de la semana.
- Ajusta automáticamente la capacidad disponible calculada de la semana.

---

## Consecuencias
- **Positivas**:
  - Los usuarios pueden conectar su calendario en 1 minuto pegando su dirección privada iCal de Google Calendar o subiendo un archivo `.ics`.
  - La capacidad semanal calculada refleja la realidad de sus compromisos fijos.
  - Cero costo, cero credenciales en la nube.
- **Limitaciones**:
  - Unidireccional (sólo lectura): no crea eventos en Google Calendar (lo cual respeta el principio de no interferir en herramientas externas).
