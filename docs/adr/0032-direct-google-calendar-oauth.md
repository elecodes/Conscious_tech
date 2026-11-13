# ADR 0032 — Envío manual a Google Calendar con OAuth

Fecha: 2026-11-13
Estado: Implementado para la rama de prueba local; pendiente configuración OAuth y validación real

## Contexto

Tras confirmar que Notion funciona, la persona solicita conectar Google Calendar. Acepta usar su API oficial con OAuth, revisar el destino y enviar explícitamente antes de plantear sincronización automática.

## Decisión

- OAuth Authorization Code con PKCE S256 y state de un solo uso ligado a una cookie HttpOnly/SameSite=Lax (Secure con HTTPS). La autorización no escribe eventos. Ventana de retorno legible y comprobación de estado mientras está abierta.
- Google requiere registrar un cliente de aplicación web: `GOOGLE_CALENDAR_CLIENT_ID` y `GOOGLE_CALENDAR_CLIENT_SECRET` permanecen en el servidor; origen inicial `http://localhost:5181`, callback `/api/google-calendar/callback`.
- Permisos: `calendar.calendarlist.readonly` y `calendar.events.owned`. Solo ofrecer calendarios con rol owner y verificarlo de nuevo en el servidor. No solicitar acceso a correo ni datos de perfil.
- Reutilizar el cifrado local AES-256-GCM de Notion mediante un almacén común, conservando el formato y las claves existentes de Notion. Google utiliza su propia carpeta ignorada `.google-calendar-local/`. Sesión de siete días, tokens y comprobaciones de envío cifrados; nunca en localStorage ni en las copias JSON del cuaderno.
- Reutilizar la proyección de tareas/partes del exportador existente. Los repartos con fecha y sin horario son eventos de día completo, con fin exclusivo y disponibilidad transparente. Las horas estimadas se describen, no se convierten en horarios inventados. Los bloques con reloj conservan hora e IANA timezone y bloquean ese intervalo. Las partes sin fecha siguen en la app. Las completadas conservan fecha y título con ✓.
- Identificadores deterministas por instalación, cuaderno del navegador, calendario, plan y parte de tarea. El identificador no secreto del cuaderno queda en localStorage; las credenciales no. Las propiedades privadas de Google identifican únicamente eventos de esta app/plan. Reinicio y nueva autorización en el mismo cuaderno reutilizan esos identificadores.
- Revisar → servidor consulta exclusivamente los eventos gestionados y devuelve nuevos, actualizaciones, eliminaciones y conflictos. Confirmar requiere un ticket de diez minutos ligado al contenido y al estado remoto; se consume antes de escribir. Si cambian, se pide una revisión nueva.
- Actualizaciones/eliminaciones con If-Match y control de campos/propiedades privados. Detenerse ante ediciones manuales detectadas, cancelaciones, asistentes, recurrencia o contenido adicional no gestionado. Las eliminaciones solo afectan eventos propios que ya no están en el plan, se muestran antes y requieren confirmación. No enviar invitaciones ni notificaciones (`sendUpdates=none`).
- Ante respuesta perdida, volver a revisar: los identificadores deterministas y los eventos remotos permiten conservar lo que ya se guardó. No repetir escrituras a ciegas. Verificar las fechas, títulos y descripciones guardadas antes de afirmar que el envío está completo.

## Límites

No hay sincronización en segundo plano ni lectura de todos los eventos de la persona. La conexión Google de esta aplicación es independiente de los conectores de la conversación y del lector iCal ya existente.

Necesita un servidor Node, no solo hosting estático. El almacén y los bloqueos son de un único proceso local; publicar un servicio exige infraestructura y gestión de claves/sesiones adecuadas. Las pruebas usan un proveedor simulado; no se ha autorizado una cuenta ni creado eventos reales. La configuración de Google Cloud debe realizarse fuera del chat, sin compartir secretos.

Google puede exigir verificación al distribuir la aplicación. En modo Testing se deben añadir usuarios de prueba y las autorizaciones pueden caducar a los siete días, según la configuración de Google. No prometer acceso permanente.

## Referencias

- [OAuth para aplicaciones web](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Scopes de Calendar](https://developers.google.com/workspace/calendar/api/auth)
- [Identificadores de eventos](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [Control de versiones y actualización](https://developers.google.com/workspace/calendar/api/v3/reference/events/update)
