# 28. Puente asistido a Google Calendar Web, honestidad en exportación .ics y jerarquía visual en resumen de correo

Fecha: 5 de noviembre de 2026  
Estado: Aceptado

## Contexto

Tras la implementación de la exportación a calendario y el resumen semanal por correo (ADR 0026 y 0027), las pruebas de usuario evidenciaron tres fricciones críticas en el flujo práctico:

1. **Confusión en la sincronización con el móvil:** El botón de la cabecera indicaba _"Añadir semana a Google Calendar"_, pero en realidad ejecutaba una descarga de archivo `.ics` al almacenamiento local de la laptop. La persona esperaba ver la semana inmediatamente sincronizada en su móvil; al quedar el archivo en `Descargas` o importarse localmente en la app de calendario del sistema operativo (p. ej. Apple Calendar en local), nunca subía a la nube de Google ni llegaba al teléfono móvil.
2. **Desorientación al importar en Google Calendar:** La importación de un archivo `.ics` en Google Calendar requiere acudir a su configuración web (`Ajustes → Importar y exportar`), elegir el archivo y confirmar. Al no existir una indicación guiada ni un enlace directo, las personas no sabían cómo completar la incorporación de sus tareas a su calendario en la nube.
3. **Falta de diferenciación visual en las opciones de correo:** En la tarjeta de resumen por correo, las opciones _«Abrir en Gmail»_ y _«Usar mi programa de correo»_ se percibían como texto idéntico y sin relieve. La hoja de estilos (`style.css`) aplicaba las clases `.primary` y `.secondary` exclusivamente a la etiqueta `button`, omitiendo los elementos `a.button`.
4. **Riesgo de error HTTP 400 por longitud de URL:** Los enlaces de redacción de Gmail con semanas largas (> 15 tareas) generaban URLs codificadas de más de 2.500 caracteres, superando el límite estricto de ~2.000 caracteres de los servidores de Google Frontend (GFE) y provocando fallos de petición inválida.

## Decisión

### 1. Honestidad en las etiquetas de exportación

- Se actualizan los botones de exportación semanal en «Mi semana» y en el pie de revisión de la propuesta a **`Añadir semana a Google Calendar (.ics)`**.
- Se explicita en todo momento que la exportación de la semana completa genera un estándar abierto `.ics` (RFC 5545) y se mantiene el principio de no engañar al usuario simulando una sincronización directa en la nube que no existe sin OAuth.

### 2. Puente asistido al importador de Google Calendar Web

- Al pulsar el botón de descarga, la aplicación presenta una tarjeta destacada con fondo suave y borde claro que:
  - Confirma la descarga: _"✓ Archivo .ics descargado en tu equipo"_.
  - Explica con precisión: _"Para que aparezca en tu Google Calendar y sincronice con tu móvil, impórtalo en la web de Google Calendar"_.
  - Proporciona un botón directo **`[📅 Abrir importador de Google Calendar]`** que abre en una pestaña nueva la ruta oficial de importación: `https://calendar.google.com/calendar/u/0/r/settings/export`.
  - Ofrece instrucciones visuales claras para que con solo 3 clics (_Seleccionar archivo → Elegir el .ics descargado → Importar_) la semana completa suba a la nube de Google y sincronice automáticamente con el móvil y otros dispositivos.
- Se mantiene el botón **`📅 Google Cal (1 clic)`** en las acciones secundarias (`••• Más`) de cada tarea individual, que utiliza la URL de plantilla (`action=TEMPLATE`) para abrir el evento en Google Calendar y guardarlo en la nube en 1 clic sin manipular archivos.

### 3. Jerarquía visual y estilos de botón para enlaces (`a.button`)

- Se actualiza `style.css` para que las reglas de diseño atómico apliquen tanto a etiquetas `<button>` como a enlaces `<a>` con clase `.button`:
  - `button.primary, a.button.primary, .button.primary`: Botón sólido en tono salvia (`--accent-sage`), texto blanco y sombra suave.
  - `button.secondary, a.button.secondary, .button.secondary`: Botón blanco con borde sutil (`--border-color`), tipografía principal y hover cálido.
  - `button.small, a.button.small`: Relleno compacto y bordes redondeados tipo píldora (`border-radius: 999px`).
- En `EmailSummaryCard`, se dota de identidad propia a cada acción:
  - **`[✉️ Abrir en Gmail]`**: Botón principal visiblemente destacado.
  - **`[📬 Usar mi programa de correo]`**: Botón secundario con silueta nítida.
  - **`[📋 Copiar resumen]`**: Botón de utilidad con icono explicativo.

### 4. Techo estricto de longitud de URL (< 1.800 caracteres)

- Se acota la generación determinista de URLs en `src/domain/email-summary.ts` mediante cálculo iterativo de longitud codificada, garantizando que el parámetro `body` se recorte con `… (ver el resto en la app)` si el enlace completo excede 1.800 caracteres.
- Se mantiene la copia íntegra (100% sin truncar) del texto de la semana mediante el botón de portapapeles.
- Se normaliza el atributo HTML de seguridad a `rel="noopener noreferrer"`.

## Consecuencias

- **Soberanía y privacidad preservadas:** No se añaden servidores intermedios, bibliotecas pesadas de cliente ni pantallas de consentimiento OAuth invasivas. El cuaderno sigue siendo 100% local.
- **Comprensión inmediata de la sincronización:** La persona usuaria sabe exactamente dónde está su información y cómo lograr que aparezca en su teléfono móvil.
- **Diseño consistente y accesible:** Se resuelve la discrepancia CSS entre botones nativos y enlaces estilizados como botón en toda la interfaz.
- **Red de pruebas en verde:** 953 pruebas automatizadas pasando y pruebas de humo completas en Chromium real verificando el flujo guiado, la descarga del `.ics`, la preservación de alarmas `VALARM`, y los límites de URL seguros.
