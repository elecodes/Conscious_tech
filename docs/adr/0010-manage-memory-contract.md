# ADR 0010: Contrato de Gestión de Memoria (`manage_memory`)

## Estado
Aceptado

## Contexto
En Conscious Tech, la memoria personal y de contexto tiene como misión proporcionar continuidad a la persona sin acumular información indiscriminadamente, sin tomar decisiones silenciosas sobre su conocimiento y respetando en todo momento el principio central del producto:

> **La IA propone. La persona decide.**
> **Código antes que IA.**
> **La memoria pertenece a la persona: debe poder revisarla, corregirla y olvidarla.**

La Skill 10 (`manage_memory`) evalúa recuerdos activos y nueva información candidata para formular propuestas estructuradas de memoria (`add`, `update`, `merge`, `archive`, `forget`, `keep`, `request_clarification`), garantizando la preservación estricta de invariantes epistémicos, temporales y de consentimiento.

## Decisión

1. **Principio de No-Persistencia e Inmutabilidad**:
   - `manage_memory` es estrictamente propositiva. No persiste, no actualiza ni borra recuerdos de forma autónoma.
   - Toda operación mutable (`add`, `update`, `merge`, `archive`, `forget`) requiere confirmación humana explícita (`requiresHumanConfirmation: true`).
   - La colección de recuerdos de entrada (`existingMemories`) no sufre mutaciones por referencia ni efectos colaterales.

2. **Separación de Procedencia, Certeza y Consentimiento**:
   - **`provenance.source`**: Identifica el canal de procedencia (`user_explicit`, `conversation_inference`, `plan_decision`, `system`).
   - **`confirmationStatus`**: Certeza epistémica (`confirmed`, `inferred`, `unconfirmed`).
   - **Invariante Epistémico Universal**:
     - Las fuentes `conversation_inference` y `system` **jamás** pueden producir recuerdos con estado `confirmed`.
     - La categoría `working_hypothesis` **jamás** puede tener estado `confirmed`.
     - `user_explicit` con marcadores de duda o especulación lingüística no se eleva a `confirmed`.
     - `plan_decision` solo justifica `confirmed` si contiene evidencia verificable de aceptación formal del plan en `referenceText`.

3. **Prioridad Absoluta del Olvido (`forget`)**:
   - Una petición explícita de olvido sobre un recuerdo existente prevalece de manera absoluta sobre cualquier operación concurrente (`update`, `merge`, `archive`, `keep`) sobre ese mismo recuerdo.
   - El recuerdo en proceso de olvido se aísla inmediatamente en `suppressedContextMemoryIds` para suspender su uso activo como contexto mientras se confirma.
   - Las peticiones de olvido sobre identificadores inexistentes se reportan en `invalidReferences` sin simular un borrado.
   - El campo `rawText` es opcional en candidatos de olvido para evitar textos artificiales.

4. **Integridad Temporal Determinista**:
   - Reutiliza `CalendarDateSchema` de `src/domain/week.ts` y la función de calendario gregoriano real.
   - Definición inclusiva de fecha límite: un recuerdo permanece plenamente `active` durante el día de `validUntil`. Solo se considera `expired` cuando $\text{referenceDate} > \text{validUntil}$.
   - La detección de caducidad genera una propuesta de archivo (`archive`), nunca una mutación automática del estado persistido.
   - Timestamps en `provenance.timestamp` validan sintaxis y componentes reales del reloj UTC (horas 0–23, minutos 0–59, segundos 0–59) con año de 4 dígitos (1000–9999).

5. **Aislamiento de Errores y Distinción en Referencias**:
   - Los errores de esquema de candidatos individuales se aíslan por elemento; no invalidan en bloque el procesamiento de peticiones de olvido u otros candidatos legítimos independientes.
   - `invalidReferences` se reserva estrictamente para identificadores de recuerdos inexistentes en el almacén; los errores estructurales de candidatos se reportan en `warnings` de forma higienizada sin exponer textos crudos sensibles.

6. **Normalización Léxica y Preservación de Términos Técnicos**:
   - `normalizeMemoryContent` realiza una normalización léxica estricta para duplicados exactos (NFD, colapso de espacios, minúsculas, eliminación de signos de puntuación ornamentales).
   - Preserva operadores y caracteres técnicos significativos (`+`, `#`, `@`, `/`, `-`, `_`, `.`, `:`) evitando colapsar términos como `"C++"` vs `"C"`, `"C#"` vs `"C"`, o `"node.js"` vs `"node"`.
   - Se documenta expresamente que se trata de equivalencia léxica normalizada, no de equivalencia semántica profunda.

7. **Procedencia y Conservación Universal en Fusiones (`merge`)**:
   - Las operaciones `merge` registran `sourceProvenances` (`memoryId`, `provenance`, `confirmationStatus`, `temporalStatus`).
   - Una fusión jamás puede elevar el estado a `confirmed` si alguna de sus fuentes es `unconfirmed`, `inferred` o de mantenimiento/plan sin aceptación demostrada.
   - La certeza epistémica y la vigencia temporal se mantienen como dimensiones independientes: recuerdos caducados (`expired`) u obsoletos (`outdated`) fusionados no se transforman mágicamente en `active`.

8. **Resolución Determinista de Conflictos e Idempotencia**:
   - Propuestas concurrentes divergentes sobre el mismo recuerdo (`update` o `add` con igual ID pero distinto contenido) se suprimen y generan `request_clarification` en lugar de una elección arbitraria.
   - Todas las propuestas se deduplican y ordenan canónicamente (`forget` $\to$ `archive` $\to$ `update` $\to$ `merge` $\to$ `add` $\to$ `keep` $\to$ `request_clarification`), garantizando igualdad profunda ante cualquier permutación de entrada.

9. **Precedencia del Estado Global (`status`)**:
   - Jerarquía estricta: `invalid_request` > `clarification_required` > `proposals_generated` > `no_action_needed`.
   - Si existen referencias inexistentes o candidatos mal formados aislados, el estado es `invalid_request`, pero las propuestas válidas independientes se preservan en `proposedOperations`.

10. **Implementación 100 % Determinista**:
    - Toda la lógica opera mediante TypeScript puro y esquemas Zod, con cero llamadas a proveedores de IA y cero consumo de tokens.

## Consecuencias
- 52 pruebas unitarias y de fixtures canónicos (19 en `memory-domain.test.ts` y 33 en `manage-memory-fixtures.test.ts`) certifican la totalidad de las invariantes y regresiones de auditoría.
- Proporciona un marco auditable, seguro y respetuoso con la soberanía y privacidad del usuario para la gestión de su memoria personal.
- Sienta las bases para que una capa superior de interacción y persistencia ejecute las operaciones aprobadas por el usuario.
