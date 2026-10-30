# 23. Endurecimiento de Proxies de Desarrollo y Desacoplamiento de Proveedores AI

Fecha: 30 de octubre de 2026  
Estado: Aceptado

## Contexto

Durante la revisión de residuos técnicos y de seguridad se identificaron tres áreas que requerían mejoras arquitectónicas:

1. **Seguridad y mitigación perimetral en proxies locales:**
   Los endpoints middleware de Vite (`/api/calendar/fetch-ical` y `/api/ai`) requerían defensas más estrictas contra vectores avanzados de SSRF (tales como rangos IPv6 IPv4-compatibles `::/96`, Teredo `2001::/32` y NAT64 `64:ff9b:1::/48`), vulnerabilidad de DNS rebinding durante peticiones concurrentes, orígenes no restringidos por omisión de cabecera Origin, y acumulación de claves en el limitador de tasa deslizante.

2. **Acoplamiento de capas y estado oculto en proveedores de IA:**
   `GroqProvider` y `GeminiProvider` contenían lógica de formateo de prompts y parseo JSON específica de cada skill, además de retener estado mutable en instancia (`lastParseResult`), violando la separación de capas y dificultando la concurrencia limpia y el reemplazo transparente de modelos.

3. **Mantenibilidad y granularidad de UI y lógica determinista:**
   Las vistas principales de React (`weekly-planning-from-notes.tsx` y `weekly-session-view.tsx`) y el motor `build-week/deterministic.ts` superaban los límites de manejabilidad cognitiva (> 1,500 líneas), y las llamadas dispersas a `console.*` arriesgaban la exposición inadvertida de texto sensible del usuario en consola.

## Decisión

1. **Endurecimiento perimetral de proxies locales:**
   - **SSRF integral:** Bloqueo explícito de rangos IPv6 no públicos adicionales (`::/96`, `2001::/32`, `64:ff9b:1::/48`) junto con los rangos RFC 1918, CGNAT, loopback y link-local preexistentes.
   - **Prevención de DNS rebinding:** Conexión HTTP pineada mediante `undici.Agent` personalizado con función `lookup` que devuelve la IP ya validada, preservando la cabecera `Host` y SNI originales.
   - **Validación de origen estricta:** Rechazo de peticiones sin cabecera `Origin` en rutas navegables y restricción a orígenes localhost o lista explícita vía variable de entorno `ALLOWED_ORIGINS` (sin reflejar la cabecera `Host`).
   - **Autenticación opcional vía token:** Soporte de `AI_PROXY_TOKEN` para requerir clave compartida en el proxy de IA cuando esté configurada.
   - **Poda activa en el limitador de tasa:** Limpieza automática de claves expiradas para prevenir fugas de memoria.

2. **Inversión de control y proveedores sin estado:**
   - La construcción de prompts y la validación con Zod se transfieren enteramente a los servicios de las skills (`01` a `06`).
   - Los proveedores implementan exclusivamente `completeJson`, eliminando estado mutable de instancia (`lastParseResult`).
   - `buildWeek` devuelve directamente `{ data, meta, parseResult }`.
   - Las importaciones dinámicas en `mock-provider.ts` se reemplazan por estáticas para evitar advertencias de Vite.

3. **Modularización y registro seguro:**
   - Descomposición de las vistas de sesión y planificación en subcomponentes modulares manteniendo cada archivo por debajo de 1,500 líneas.
   - División de `src/skills/build-week/deterministic.ts` en submódulos especializados (`capacity-math`, `planning-context`, `validation`, `repair`) expuestos a través de una fachada.
   - Centralización de registros de depuración en `src/utils/logger.ts`, sanitizando metadatos y excluyendo texto libre del usuario.
   - Incorporación de configuración mínima de ESLint y Prettier.

## Consecuencias

- **Positivas:**
  - Los proxies de desarrollo quedan protegidos contra DNS rebinding y accesos externos no autorizados.
  - Los proveedores de IA son completamente intercambiables, sin estado oculto ni acoplamiento a detalles de parseo de esquemas específicos.
  - La base de código de interfaz y lógica determinista resulta legible, testeable y mantenible.
  - Se garantiza el respeto estricto a la privacidad de los datos personales del usuario.
- **Negativas / Compromisos:**
  - Ninguno.
