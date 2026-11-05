# 26. Recordatorios en exportación de calendario y resumen semanal por correo sin servidor

Fecha: 4 de noviembre de 2026  
Estado: Aceptado

## Contexto

Las personas que utilizan Conscious Tech organizan su semana con claridad y calma en su cuaderno local. Sin embargo, para trasladar dicha planificación a su día a día práctico, surgían dos necesidades recurrentes:

1. Contar con avisos o recordatorios en su calendario personal habitual (Google Calendar o Apple Calendar) para compromisos fijados y fechas límite.
2. Poder enviarse un resumen claro de la semana planificada o de los aprendizajes del cierre a su correo electrónico personal, o copiarlo para su archivo.

Abordar estas necesidades mediante servicios automáticos en la nube (como el envío de correos programados desde un servidor o la sincronización directa vía API/OAuth de Google Calendar) habría introducido graves inconvenientes:

- Requeriría un backend permanente, bases de datos remotas y almacenamiento de datos privados en servidores externos.
- Exigiría credenciales de OAuth, pantallas de consentimiento de Google y permisos invasivos sobre la cuenta de la persona.
- Vulneraría el principio fundacional de Conscious Tech: soberanía local de los datos, privacidad por diseño y primacía de la decisión humana ("La IA propone. La persona decide."). Nada debe enviarse automáticamente sin una acción intencionada y consciente.

## Decisión

### 1. Recordatorios deterministas en la exportación de calendario (.ics / RFC 5545)

- **Preferencias locales y control:** Se añade una sección de "Recordatorios" en Ajustes y en el menú de exportación, desactivada por defecto ("Sin recordatorio"). Las opciones contempladas son: sin recordatorio, 15 minutos antes, 1 hora antes y 1 día antes. La elección se almacena localmente en el navegador (`localStorage`) sin tocar ningún servidor.
- **Generación de VALARM:** Cuando los recordatorios están activados, se añade un bloque `VALARM` (`ACTION:DISPLAY`, `TRIGGER:-PT15M`, `-PT1H` o `-P1D`) a los eventos con fecha u hora. Por defecto, solo reciben alarma los compromisos y las tareas con fecha límite; se ofrece la casilla opcional "Incluir también tareas" para abarcar las actividades flexibles.
- **Eventos de día completo (`VALUE=DATE`) y avisos a las 09:00:** Se exportan con sintaxis estándar RFC 5545 (`DTSTART;VALUE=DATE:YYYYMMDD` y `DTEND` exclusivo al día siguiente). Para evitar que los avisos suenen la tarde o noche anterior, los recordatorios para tareas de día completo se mapean a horas de reloj a las 09:00: las opciones de 15 minutos antes y 1 hora antes disparan a las 09:00 del mismo día (`+PT9H` desde el inicio del día), mientras que 1 día antes dispara a las 09:00 del día anterior (`-PT15H` respecto al inicio del día del evento). Los disparadores relativos (`-PT15M`, `-PT1H`, `-P1D`) se reservan para eventos con hora concreta.
- **Definición canónica de zona horaria VTIMEZONE:** Para eventos con `TZID=Europe/Madrid`, se incorpora el bloque canónico `VTIMEZONE` con las reglas de cambio horario de la Unión Europea (CET/CEST), asegurando que todo `TZID` referenciado cuente con su componente de zona horaria correspondiente en el archivo.
- **Corrección estricta RFC 5545:**
  - Saltos de línea CRLF (`\r\n`).
  - Plegado de líneas a un máximo de 75 octetos (bytes UTF-8) mediante continuación con espacio, respetando límites de caracteres multibyte.
  - Escape de caracteres reservados (`\`, `;`, `,`, y saltos de línea).
  - Identificador único determinista y estable (`UID`) por elemento (basado en el identificador o slug del elemento) para que importar de nuevo el archivo actualice los eventos existentes en lugar de duplicarlos.
  - Cabecera con `DTSTAMP` y soporte de zona horaria (`Europe/Madrid`).
- **Botón prominente de exportación:** Se incorpora un botón claro "Añadir semana a Google Calendar" tanto en Mi semana como en el pie de revisión de la propuesta. Descarga el archivo `.ics` configurado con sus recordatorios y muestra una indicación concisa de importación ("Google Calendar → Ajustes → Importar"), manteniendo intactos los enlaces individuales existentes a Google Calendar.
- **Redacción honesta:** La interfaz no promete el envío de correos, indicando en su lugar "Tu calendario te avisará" con el texto de ayuda explicativo: _"Google Calendar te avisará con una notificación; puedes activar el aviso por correo en sus ajustes."_

### 2. Resumen por correo en el cliente ("Enviarme el resumen por correo")

- **Disparado exclusivamente por la persona:** Se habilita en Mi semana y en Cierre. Abre la ventana de redacción de Gmail (`https://mail.google.com/mail/?view=cm&fs=1&su=...&body=...`) en una nueva pestaña (`target="_blank" rel="noopener,noreferrer"`) y ofrece como alternativa "Usar mi programa de correo" mediante un enlace `mailto:`.
- **Destinatario siempre en blanco:** El enlace no incluye ningún destinatario (`to=`). Es la persona quien introduce su propia dirección en su cliente de correo. La aplicación nunca solicita, registra ni almacena correos electrónicos.
- **Contenido en texto plano legible:** Asunto estructurado como `Mi semana · <rango de fechas>` y cuerpo en texto limpio con los compromisos y prioridades. En el espacio de Cierre, incorpora además las reflexiones personales y aprendizajes cosechados. Se excluyen por completo identificadores internos, UUIDs o estructuras JSON.
- **Control de longitud de URL y respaldo seguro:** Para evitar roturas en clientes o navegadores que limitan URLs largas, el cuerpo en los enlaces se limita a aproximadamente 1.500 caracteres, truncándose amablemente con `… (ver el resto en la app)` si se excede. Se complementa con un botón "Copiar resumen" que copia el texto íntegro y sin recortes al portapapeles.
- **Transparencia y privacidad:** Se muestra una previsualización del texto antes de abrir el enlace y se advierte expresamente de que la información se comparte con el proveedor de correo únicamente al pulsar sobre el botón.

### 3. Preservación de la calma visual

- En Mi semana, los recordatorios y la herramienta de correo se agrupan en un bloque compacto "Recordatorios y avisos" plegado por defecto (`<details>`), evitando cualquier saturación visual o nueva pestaña innecesaria.

## Consecuencias

- **Privacidad y soberanía intactas:** Ningún dato viaja a servidores intermedios; todo se ejecuta localmente en el cliente mediante estándares abiertos (RFC 5545, URLs de redacción y enlaces `mailto:`).
- **Cero dependencias y cero costes de infraestructura:** No se incorporan bibliotecas externas, servicios backend ni integraciones OAuth complejas que requieran verificación o mantenimiento.
- **Compatibilidad e interoperabilidad:** Los archivos `.ics` resultantes son compatibles con Google Calendar, Apple Calendar, Thunderbird y Outlook, actualizándose correctamente gracias a los UIDs estables.
- **Red de pruebas verificada:** Pruebas unitarias de ida y vuelta con el analizador `ical-parser.ts`, pruebas de límites de caracteres en correos, pruebas de denegación de voseo y pruebas completas de integración en navegador real (`scripts/smoke-test.ts`) que verifican la descarga del `.ics` con `VALARM` y la apertura de Gmail con destinatario vacío.
