# 24. Desacoplamiento de Ciclos en Dominio, Pruebas de Humo en Navegador y Endurecimiento de Privacidad

Fecha: 31 de octubre de 2026  
Estado: Aceptado

## Contexto

A medida que el producto creció hacia una experiencia interactiva completa (persistencia en IndexedDB, radar de imprevistos, sincronización con calendarios y ajustes de agenda), se identificaron cuatro áreas clave de robustez, confiabilidad y privacidad:

1. **Dependencias circulares en el módulo de agenda (`src/domain/schedule.ts`):**
   `schedule.ts` centralizaba la definición de tipos, invariantes y la lógica de aplicación de ajustes (`schedule-adjustment-applier.ts`). Esta acumulación provocaba un ciclo de importaciones que pasaba desapercibido en Node.js y pruebas unitarias con mocks, pero provocaba un error crítico de inicialización (`ReferenceError: Cannot access before initialization`) al cargarse en el navegador con Vite en modo producción (`preview`).

2. **Detección temprana de fallos de runtime en CI:**
   Las pruebas unitarias y de integración en Vitest no ejecutaban el bundle real de Vite ni el ciclo de vida del navegador, permitiendo que fallos exclusivos del entorno cliente pasasen a `main`. Se requería una prueba de humo que levantase el servidor de previsualización y dev, navegase con un navegador Chromium real y validase el montaje del DOM. Además, la ejecución debía ser programática para evitar procesos colgados en el runner de GitHub Actions.

3. **Homogeneización del lenguaje de la interfaz y etiquetado de enums:**
   La UI presentaba expresiones residuales con voseo rioplatense (en vez del español neutro/España definido para la aplicación), etiquetas de "Caso real:" para casos de prueba que son sintéticos, y valores crudos de enums del dominio expuestos al usuario final (e.g. `Commitment`, `Task`, `Pending`, `External`).

4. **Prevención de fugas de datos personales en el registrador (`src/utils/logger.ts`):**
   El sanitizador de logs truncaba cadenas a 200 caracteres pero preservaba íntegramente los mensajes de cualquier instancia de `Error`. Si un error genérico del runtime o de validación contenía texto libre de una nota personal del usuario (e.g. `new Error("Failed to parse: " + userNotes)`), este se registraba en la consola.

## Decisión

1. **Desacoplamiento de `schedule.ts` y compuerta estricta contra ciclos:**
   - Descomposición de `src/domain/schedule.ts` en tres módulos cohesivos y acíclicos:
     - `src/domain/schedule-types.ts`: tipos puros y esquemas Zod de agenda.
     - `src/domain/schedule-invariants.ts`: validación de invariantes de calendario y horas.
     - `src/domain/schedule-adjustment-applier.ts`: aplicación de transiciones y ajustes.
   - `schedule.ts` actúa como fachada re-exportando los tres módulos sin provocar dependencias circulares con `week.ts` ni con repositorios.
   - Incorporación del script `npm run check:cycles` utilizando `madge --circular --extensions ts,tsx src` como paso obligatorio de verificación y compuerta en el flujo de CI.

2. **Pruebas de humo programáticas en CI con Playwright Chromium:**
   - Refactorización de `scripts/smoke-test.ts` para interactuar directamente con la API de Node.js de Vite (`createServer`, `preview`, `build`), eliminando subprocesos huérfanos que colgaban el CI.
   - Lanzamiento de Chromium con flags seguras (`--no-sandbox`, `--disable-dev-shm-usage`) y verificación de renderizado en modos `preview` y `dev`.
   - Inclusión automática de instalación de Chromium (`npx playwright install --with-deps chromium`) y ejecución de `npm run test:smoke` en GitHub Actions.

3. **Copia en español de España, casos de ejemplo y mapeo de enums:**
   - Estandarización de toda la copia de usuario al español de España (reemplazo de `Tenés` por `Tienes`, `Sincronizá` por `Sincroniza`, `Elegí` por `Elige`).
   - Reemplazo de la etiqueta "Caso real:" por "Caso de ejemplo:" para reflejar fielmente la naturaleza sintética de los benchmarks.
   - Creación de `src/web/labels.ts` para mapear tipos, estados, compromisos e importancias a etiquetas en español con mayúsculas oracionales (`En marcha`, `Compromiso externo`), conservando los enums puros en esquemas y clases CSS (`badge-task`).
   - Creación de guardias de regresión automatizadas: `tests/voseo-denylist.test.ts` y `tests/labels-and-extracted-card.test.tsx`.

4. **Endurecimiento de privacidad en el registrador de errores:**
   - Introducción de `AppError` y la función de inspección `isAppError` en `src/utils/logger.ts`.
   - Las clases de error del dominio y las skills implementan la propiedad de solo lectura `isAppError = true` (`StorageError`, `WeekValidationError`, etc.).
   - Errores nativos (`Error`, `TypeError`, `SyntaxError`) o de procedencia externa ven su propiedad `message` redactada a `[REDACTED_ERROR_MESSAGE]`.
   - Los errores de la app conservan su mensaje técnico diagnóstico (sujeto al límite de 200 caracteres).

## Consecuencias

- **Positivas:**
  - Cero dependencias circulares en el código fuente, blindadas por análisis estático en CI.
  - Verificación end-to-end de renderizado en navegador real en cada push y PR antes de producción.
  - Interfaz homogénea, clara y en español neutro, sin filtrar términos técnicos en inglés a los usuarios.
  - Garantía reforzada de privacidad: ninguna excepción genérica del sistema o de librerías externas puede filtrar texto privado del usuario a través de los registros.
- **Negativas / Compromisos:**
  - El tiempo de ejecución del CI añade ~20 segundos para la descarga e instalación de Chromium en GitHub Actions, compensado ampliamente por la prevención de caídas en producción.
