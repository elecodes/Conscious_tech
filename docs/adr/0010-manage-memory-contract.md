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
     - `plan_decision` jamás se confirma por coincidencia léxica en texto libre; requiere una referencia estructurada que coincida con una entrada en `verifiedAcceptedDecisionRefs`, sin marcadores de duda, negación, hipótesis o estado pendiente.

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

11. **Límite de Confianza de `verifiedAcceptedDecisionRefs` (Punto de Integración Futuro)**:
    - **Capacidad preparada, no seguridad ya implementada**: El campo `verifiedAcceptedDecisionRefs` en `ManageMemoryInputSchema` es un punto de integración arquitectónico para la futura capa de aplicación, no un subsistema de autenticación o verificación intrínseca en sí mismo.
    - **Frontera de confianza actual**: Al ser un motor determinista puro de dominio sin infraestructura de I/O, cualquier llamador directo de la función puede suministrar referencias arbitrarias que coincidan con los candidatos. Por ende, **este parámetro jamás debe exponerse ni aceptarse directamente desde clientes o interfaces no confiables**.
    - **Responsabilidad del futuro servicio de aplicación**: La capa de aplicación o servicio backend encargada de orquestar la llamada deberá hidratar internamente `verifiedAcceptedDecisionRefs` consultando un registro autoritativo de eventos de aceptación (p. ej., un registro inmutable de auditoría o eventos de decisión), sin delegar la autenticidad en datos enviados por el cliente.
    - **Ortogonalidad entre certeza y persistencia**: La certeza epistémica (`confirmationStatus: "confirmed"`) y la autorización para persistir (`requiresHumanConfirmation: true`) operan como controles estrictamente separados. Incluso si una decisión se evalúa como confirmada en la propuesta, ninguna mutación se persiste sin la decisión explícita de la persona.
    - **Alcance de los tests de regresión**: Las pruebas que suministran identificadores en `verifiedAcceptedDecisionRefs` demuestran el comportamiento condicional y la simetría del motor ante referencias declaradas como válidas; no demuestran la autenticidad real del evento en un entorno de producción hasta que exista la infraestructura autoritativa correspondiente.

## Consecuencias

- 64 pruebas unitarias y de fixtures canónicos (19 en `memory-domain.test.ts` y 45 en `manage-memory-fixtures.test.ts`) certifican la totalidad de las invariantes y regresiones de auditoría.
- Proporciona un marco auditable, seguro y respetuoso con la soberanía y privacidad del usuario para la gestión de su memoria personal.
- Sienta las bases para que una capa superior de interacción y persistencia ejecute las operaciones aprobadas por el usuario, delimitando con precisión la frontera de confianza de la verificación de decisiones.
