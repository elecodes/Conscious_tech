# ADR 0019: Modo Dictado por Voz Nativo (Web Speech API) y Arquitectura de Integración MCP

## Estado

Aprobado

## Contexto

En el flujo de volcado mental (Brain Dump) y en la captura rápida de novedades para el Radar de Imprevistos, escribir textos extensos puede generar fricción cognitiva y retrasar la reflexión consciente.

El usuario solicitó:

1. **Modo Voz para Entrada de Notas**: Permitir dictado por voz fluido (similar al patrón Whisper Flow) pero respetando estrictamente el principio rector del proyecto: **coste cero (free-tier first), sin dependencias pesadas ni servidores externos obligatorios**.
2. **Conexión con MCPs Externos (Notion, Google Drive, Google Calendar)**: Diseñar la arquitectura para conectar fuentes de contexto externas preservando la soberanía del usuario y la privacidad de datos.

---

## Decisiones

### 1. Entrada de Voz Nativa con Web Speech API (`SpeechRecognition`)

- **Coste cero y privacidad**: Se adopta la API nativa de los navegadores (`window.SpeechRecognition` / `webkitSpeechRecognition`). No requiere claves API de pago ni dependencias externas en el bundle.
  > **Nota de Privacidad y Flujo de Datos**: A diferencia del procesamiento puramente local en dispositivo (como Safari en Apple Silicon), navegadores como Google Chrome pueden procesar el audio mediante servicios remotos de transcripción del proveedor del navegador. Esto debe indicarse al usuario en la interfaz para respetar el principio de transparencia y soberanía de datos personales.
- **Hook Reutilizable (`src/web/hooks/use-speech-recognition.ts`)**:
  - Encapsula el ciclo de vida del reconocimiento continuo (`continuous: true`, `interimResults: true`).
  - Reconexión fluida ante interrupciones involuntarias de audio.
  - Soporte de conmutación de idiomas (`es-ES` / `en-US`).
  - Preservación íntegra de texto previo: el dictado se concatena al final del texto escrito sin sobrescribirlo.
  - Manejo amigable y no bloqueante de permisos (`not-allowed`, `no-speech`).
- **Componente Tranquilo (`src/web/components/voice-dictation-button.tsx`)**:
  - Estado visual activo claro (🎙️ Dictar por voz / 🔴 Escuchando... [Parar]).
  - Selector de idioma integrado accesible.
  - Degradación elegante: si el navegador no soporta la API nativa (o en entornos SSR/Node), muestra un mensaje sutil sin arrojar errores ni bloquear la entrada manual.
- **Puntos de Integración**:
  - Volcado inicial de notas en planificación semanal (`src/web/components/weekly-planning-from-notes.tsx`).
  - Volcado adicional de notas en la revisión de propuesta (`src/web/components/weekly-planning-from-notes.tsx`).
  - Entrada de imprevistos en el Radar de Imprevistos (`src/web/components/weekly-session-view.tsx`).

### 2. Arquitectura de Integración MCP (Roadmap Notion, Drive, Calendar)

- **Principio**: La IA propone e inspecciona; la persona decide qué contexto importar.
- **Fase de Lectura Soberana (Read-only Context Bridges)**:
  - Los MCPs se integran como proveedores de contexto externo en la capa de aplicación/infraestructura (`src/infrastructure/mcp/`).
  - **Google Calendar**: Inicialmente conceptualizado como servidor MCP; posteriormente implementado de forma más liviana y sin credenciales en la nube mediante feeds iCal y archivos `.ics` en [ADR 0020](0020-google-calendar-ical-integration.md).
  - **Notion & Google Drive**: Puentes de contexto aplazados (_deferred post-v1_). Su implementación requeriría transporte autenticado y configuración adicional de servidores locales, por lo que se mantienen como diseño conceptual en el roadmap hasta validar la adopción del flujo autónomo de cuaderno e iCal.
  - **Seguridad**: Nunca enviar datos de planes privados a MCPs externos sin confirmación explícita.

---

## Consecuencias

- **Positivas**:
  - Los usuarios pueden dictar tareas e imprevistos instantáneamente desde cualquier navegador compatible (Chrome, Edge, Safari) sin coste.
  - Arquitectura desacoplada y lista para soportar Whisper local (WebAssembly/Transformers.js) como proveedor alternativo si se requiere precisión offline en el futuro.
  - Cero dependencias npm añadidas.
- **Limitaciones**:
  - La compatibilidad depende del soporte Web Speech API del navegador. En navegadores sin soporte, la interfaz degrada elegantemente a entrada por teclado.
