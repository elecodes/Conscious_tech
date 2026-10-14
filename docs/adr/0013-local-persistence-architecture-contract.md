# ADR 0013: Arquitectura y Contrato de Persistencia Local (`LocalPersistence`)

## Estado
Propuesto

## Contexto
En Conscious Tech, la experiencia de usuario se define como:
> **Un cuaderno personal + un asistente reflexivo + IA tranquila.**
> **La IA propone. La persona decide.**
> **Código antes que IA.**

A lo largo de las Fases 1 a 3 del ciclo semanal, se han diseñado e implementado motores deterministas y esquemas estrictos de dominio para:
1. Construcción macro de la semana (`build_week` $\to$ `ProposedWeek`).
2. Análisis de cambios y detección de conflictos (`analyze_change`, `detect_conflict`).
3. Formulación y aplicación determinista de ajustes a la agenda (`propose_adjustment`, `applyAdjustmentToSchedule` $\to$ `WeeklySchedule`).
4. Cierre y balance retrospectivo (`close_week` $\to$ `CloseWeekOutput`).
5. Gestión de recuerdos y aprendizaje personal (`manage_memory` $\to$ `ManageMemoryOutput`).

Sin embargo, hasta este momento todo el estado de la aplicación reside en la memoria volátil de JavaScript y en suites de tests automatizados. La auditoría previa confirmó que ante un reinicio del navegador o recarga de la página, se pierde la totalidad del estado acumulado:
- El plan activo acordado por la persona.
- La micro-agenda horaria, sus asignaciones diarias y el historial inmutable de ajustes aceptados (`appliedAdjustments`).
- El informe de balance del cierre semanal y las reflexiones registradas.
- Los recuerdos consolidados y confirmados por la persona.

Este ADR define la **arquitectura, contrato de repositorios y modelo de integridad para la persistencia local**, preservando la soberanía de los datos, la privacidad estricta y una vía de desacoplamiento limpia para una futura migración a un backend remoto.

---

## 1. Inspección de la Arquitectura Actual y Discrepancias Estructurales

La inspección de la base de código existente (`src/domain/`, `src/skills/`, `src/web/`, `package.json`, ADRs 0010–0012) reveló hallazgos y discrepancias estructurales que el contrato de persistencia debe resolver:

### Discrepancia 1: `ProposedWeek` carece de identidad persistente (`planId`)
- **Realidad de dominio:** En `src/domain/week.ts`, `ProposedWeekSchema` es un esquema cerrado (`.strict()`) sin identificador único `planId`, `id`, ni campos de auditoría (`createdAt`, `status`). Su clave de negocio es `weekSummary.targetWeek` (`startDate`, `endDate`).
- **Realidad de la agenda:** En `src/domain/schedule.ts`, `WeeklyScheduleSchema` exige formalmente `planId: z.string().min(1)`.
- **Resolución arquitectónica:** El modelo de dominio `ProposedWeek` no se debe romper ni inflar. Para persistencia, se define la entidad envolvente de almacenamiento **`StoredWeeklyPlan`**, la cual asigna un `planId` canónico (UUID/nanoid), estado de ciclo de vida (`draft`, `active`, `closed`), timestamps ISO UTC y contiene el payload inmutable `proposal: ProposedWeek`.

### Discrepancia 2: `CloseWeekOutput` no define un identificador de informe de primer nivel
- **Realidad de dominio:** En `src/domain/close-week.ts`, el resultado de la función `executeCloseWeekDeterministic` se denomina `CloseWeekOutput` y contiene `closedAt`, `weekRange`, `fociOutcomes`, `classifiedItems`, `capacityAnalysis`, `memoryCandidates`, etc., pero no contiene un `closeReportId`.
- **Resolución arquitectónica:** Se define la entidad envolvente de almacenamiento **`StoredCloseWeekReport`**, que añade `reportId: z.string().min(1)`, `planId: z.string().min(1)`, `scheduleId: z.string().min(1).optional()`, garantizando relación referencial biunívoca con el plan y agenda correspondientes.

### Discrepancia 3: `MemoryItem` es una entidad completa con clave propia
- **Realidad de dominio:** En `src/domain/memory.ts`, `MemoryItem` posee `id: z.string().min(1)`, `content`, `category`, `confirmationStatus`, `temporalStatus`, `provenance`, etc.
- **Resolución arquitectónica:** `MemoryItem` se persiste directamente como entidad raíz en su propio almacén de objetos.

### Discrepancia 4: El estado actual de la UI web
- **Realidad de la UI:** `src/web/App.tsx` es actualmente un visor interactivo de prueba para la skill `extract_items` que utiliza `localStorage` únicamente para guardar API keys de proveedores (`CT_GROQ_KEY`, `CT_GEMINI_KEY`). No existe aún un gestor de estado ni persistencia para el ciclo de semanas.

---

## 2. Comparación y Selección del Motor de Almacenamiento

Se evaluaron tres alternativas tecnológicas bajo el contexto real de Conscious Tech (SPA web desarrollada con Vite 6, React 19, TypeScript estricto, sin servidor backend existente):

| Criterio | `localStorage` | SQLite Local (Node / Backend) | IndexedDB (Nativo en Navegador) |
| :--- | :--- | :--- | :--- |
| **Arquitectura actual** | Compatible directo en navegador. | Requiere introducir un servidor Node (Express/Fastify/tRPC) o empaquetador desktop (Electron/Tauri), o SQLite-WASM con headers COOP/COEP. | **100 % compatible con la arquitectura SPA actual (Vite + React 19).** |
| **Capacidad y límites** | Muy limitado (~5 MB). Inviable para historial de semanas y ajustes. | Prácticamente ilimitado (disco local). | **Muy amplia (cientos de MB a GBs según cuota de navegador).** |
| **Atomicidad y transacciones** | Nula. Escrituras sincrónicas, sin rollback ante fallo. | Completa (ACID relacional). | **Completa por almacén de objetos (`readwrite` con rollback automático en abort/error).** |
| **Rendimiento e I/O** | Sincrónico (bloquea el hilo principal de la UI). | Asíncrono vía IPC / HTTP local. | **Completamente asíncrono (Promise-friendly, no bloquea UI).** |
| **Migraciones de esquema** | Manuales, propensas a errores, parseo JSON global. | Maduras (migraciones SQL numeradas). | **Integradas nativamente vía evento `onupgradeneeded` y versiones numéricas.** |
| **Privacidad y soberanía** | Local en navegador. | Local en filesystem de la máquina. | **Local al origen del usuario. Cero fugas de red por diseño.** |
| **Dependencias externas** | Ninguna. | `better-sqlite3` (binarios nativos C++) o WASM pesado (~1MB+). | **Cero dependencias npm obligatorias; TypeScript puro sobre API web.** |
| **Facilidad de migración futura** | Mala. | Media (relacional a relacional). | **Excelente: la abstracción de repositorios async es idéntica a un cliente HTTP/tRPC.** |

### Decisión de Motor
**Se selecciona `IndexedDB` como el motor de persistencia local primario.**
- Se rechaza `localStorage` por falta de transacciones, límites de tamaño y bloqueo de UI.
- Se descarta SQLite en esta fase porque forzaría a duplicar la arquitectura introduciendo un proceso servidor en Node o dependencias nativas de compilación, cuando el producto actual opera como una aplicación web enfocada y ligera.
- IndexedDB proporciona transaccionalidad, almacenamiento estructurado, migraciones seguras y privacidad absoluta sin costo de infraestructura ni dependencias externas.

---

## 3. Diagrama de Arquitectura y Flujo de Dependencias

Se aplica una arquitectura hexagonal / puertos y adaptadores para aislar completamente el dominio y las skills de los detalles de IndexedDB:

```text
+-----------------------------------------------------------------------+
|                              Capa UI                                  |
|                 (React 19 Components / Pages / Hooks)                 |
+-----------------------------------+-----------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------+
|                    Capa de Aplicación / Orquestación                   |
|                   (WeeklySessionService, MemoryService)               |
+-------------------+-------------------------------+-------------------+
                    |                               |
                    v                               v
+-----------------------------------+   +-------------------------------+
|     Skills de Dominio Puras       |   |    Puertos de Persistencia    |
| (build_week, close_week, etc.)    |   |     (Interfaces Repository)   |
|   100 % deterministas / Zod       |   |                               |
+-----------------------------------+   +---------------+---------------+
                                                        |
                                                        | implementa
                                                        v
                                        +-------------------------------+
                                        |    Adaptador de Persistencia  |
                                        |  (IndexedDbStorageAdapter)    |
                                        |  - IndexedDB nativo (v1)      |
                                        |  - Transacciones y Rollback   |
                                        |  - Validación Zod al leer     |
                                        +-------------------------------+
```

---

## 4. Entidades, Claves, Relaciones y Estrategia de Actualización

| Entidad de Almacenamiento | Store en IndexedDB | Clave Primaria (`keyPath`) | Índices Secundarios | Relaciones Referenciales | Estrategia de Actualización |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`StoredWeeklyPlan`** | `plans` | `planId` (string) | `targetWeek.startDate`<br>`status` | 1 $\to$ 1 opcional con `WeeklySchedule`<br>1 $\to$ 1 opcional con `StoredCloseWeekReport` | Reemplazo inmutable por versión o cambio de estado (`draft` $\to$ `active` $\to$ `closed`). |
| **`WeeklySchedule`** | `schedules` | `scheduleId` (string) | `planId` (único)<br>`weekRange.startDate` | N $\to$ 1 con `StoredWeeklyPlan` (`planId`) | **Concurrencia optimista:** actualización atómica verificando estricta igualdad de `version`. Incremento monotónico `version + 1`. |
| **`StoredCloseWeekReport`** | `close_reports` | `reportId` (string) | `planId` (único)<br>`closedAt` | N $\to$ 1 con `StoredWeeklyPlan` (`planId`)<br>N $\to$ 1 con `WeeklySchedule` (`scheduleId`) | Solo adición / Inmutable una vez cerrado (`read-only`). |
| **`MemoryItem`** | `memories` | `id` (string) | `category`<br>`confirmationStatus`<br>`temporalStatus`<br>`createdAt` | Referencia causal a `adjustmentId` o `planId` en `provenance.referenceText` | Mutación condicionada a confirmación humana explícita. Olvido real (`delete`). |

---

## 5. Contrato Propuesto de Interfaces de Repositorios (TypeScript)

Los contratos de persistencia se ubicarán en `src/domain/repositories/` y no contendrán dependencias de IndexedDB ni de navegadores.

```ts
import { ProposedWeek, TargetWeek } from "../week";
import { WeeklySchedule } from "../schedule";
import { CloseWeekOutput } from "../close-week";
import { MemoryItem, MemoryCategory, ConfirmationStatus, TemporalStatus, MemoryOperation } from "../memory";

// ============================================================================
// Modelos de Almacenamiento Envolventes
// ============================================================================

export type WeeklyPlanStatus = "draft" | "active" | "closed";

export interface StoredWeeklyPlan {
  planId: string;
  targetWeek: TargetWeek;
  status: WeeklyPlanStatus;
  proposal: ProposedWeek;
  createdAt: string; // ISO UTC
  updatedAt: string; // ISO UTC
}

export interface StoredCloseWeekReport {
  reportId: string;
  planId: string;
  scheduleId?: string;
  closedAt: string;  // ISO UTC
  output: CloseWeekOutput;
}

export interface MemoryFilter {
  categories?: MemoryCategory[];
  confirmationStatuses?: ConfirmationStatus[];
  temporalStatuses?: TemporalStatus[];
  referenceDate?: string; // Para filtrar vigencia temporal
}

// ============================================================================
// Interfaces de Repositorios
// ============================================================================

export interface WeeklyPlanRepository {
  save(plan: StoredWeeklyPlan): Promise<void>;
  getById(planId: string): Promise<StoredWeeklyPlan | null>;
  getActivePlan(): Promise<StoredWeeklyPlan | null>;
  getByWeekRange(week: TargetWeek): Promise<StoredWeeklyPlan | null>;
  updateStatus(planId: string, status: WeeklyPlanStatus): Promise<void>;
}

export interface WeeklyScheduleRepository {
  /**
   * Guarda una agenda semanal.
   * Si expectedVersion se proporciona, exige concurrencia optimista estricta.
   * Lanza StaleVersionConflictError si la versión almacenada difiere de expectedVersion.
   */
  save(schedule: WeeklySchedule, expectedVersion?: number): Promise<void>;
  getById(scheduleId: string): Promise<WeeklySchedule | null>;
  getByPlanId(planId: string): Promise<WeeklySchedule | null>;
}

export interface WeeklyCloseRepository {
  save(report: StoredCloseWeekReport): Promise<void>;
  getById(reportId: string): Promise<StoredCloseWeekReport | null>;
  getByPlanId(planId: string): Promise<StoredCloseWeekReport | null>;
}

export interface MemoryRepository {
  getById(id: string): Promise<MemoryItem | null>;
  getAll(filter?: MemoryFilter): Promise<MemoryItem[]>;
  save(memory: MemoryItem): Promise<void>;
  saveBatch(memories: MemoryItem[]): Promise<void>;
  archive(id: string): Promise<void>;
  delete(id: string): Promise<void>; // Olvido efectivo del registro
}

// ============================================================================
// Orquestación de Sesión y Continuidad
// ============================================================================

export interface WeeklySessionState {
  activePlan: StoredWeeklyPlan | null;
  activeSchedule: WeeklySchedule | null;
  latestCloseReport: StoredCloseWeekReport | null;
  memories: MemoryItem[];
}

export interface WeeklyLifecycleService {
  /**
   * Recupera el estado necesario para reanudar el cuaderno tras un reinicio.
   */
  resumeCurrentSession(): Promise<WeeklySessionState>;

  /**
   * Aplica formalmente una operación de memoria confirmada por la persona.
   * "AI propone. La persona decide."
   */
  confirmMemoryOperation(operation: MemoryOperation): Promise<void>;

  /**
   * Restablecimiento y olvido total soberano.
   */
  clearAllLocalData(): Promise<void>;
}
```

---

## 6. Integridad, Versionado, Atomicidad y Concurrencia

### 1. Versionado del Motor y Migraciones
- La base de datos IndexedDB se llamará `conscious_tech_db` con versión inicial `1`.
- El proceso de apertura implementará una función migradora determinista:
  $$\text{runMigrations}(db, \text{oldVersion}, \text{newVersion}, transaction)$$
- Las migraciones serán incrementales, lineales y testeadas en suites automatizadas con mocks en memoria de IDB (`fake-indexeddb` en tests).

### 2. Validación de Esquemas en Lectura (Defensa en Profundidad)
- Al leer datos persistidos de IndexedDB, el adaptador ejecutará `safeParse` con los esquemas canónicos de dominio:
  - `StoredWeeklyPlan` valida su payload con `ProposedWeekSchema`.
  - `WeeklySchedule` valida con `WeeklyScheduleSchema` y `validateWeeklyScheduleInvariants`.
  - `StoredCloseWeekReport` valida su payload con `CloseWeekOutputSchema`.
  - `MemoryItem` valida con `MemoryItemSchema`.
- **Estrategia ante corrupción:** Si un registro en la base de datos no supera la validación Zod por manipulación manual o incompatibilidad grave, no se crashea la aplicación. Se aísla el registro, se registra un log de error estructurado y se ofrece al usuario recuperar la sesión o purgar el elemento dañado.

### 3. Concurrencia Optimista en `WeeklySchedule`
- Para prevenir que dos pestañas o flujos concurrentes sobreescriban la agenda:
  ```ts
  async save(schedule: WeeklySchedule, expectedVersion?: number): Promise<void> {
    const tx = db.transaction("schedules", "readwrite");
    const store = tx.objectStore("schedules");
    const existing = await store.get(schedule.scheduleId);
    
    if (expectedVersion !== undefined) {
      const currentVersion = existing ? existing.version : 0;
      if (currentVersion !== expectedVersion) {
        tx.abort();
        throw new StaleVersionConflictError(currentVersion, expectedVersion);
      }
    }
    await store.put(schedule);
    await tx.done;
  }
  ```
- Si la versión en disco no coincide con `expectedVersion`, la transacción se aborta de inmediato y la agenda original queda intacta.

### 4. Idempotencia y Transaccionalidad
- Toda operación de guardado utiliza identificadores deterministas (`planId`, `scheduleId`, `reportId`, `id`). Repetir una operación con los mismos datos es idempotente y no crea duplicados.
- Transacciones compuestas (por ejemplo, archivar el plan activo y guardar el informe de cierre) se ejecutan dentro de una misma transacción IDB multitienda (`db.transaction(["plans", "close_reports"], "readwrite")`), garantizando que si el guardado del informe falla, el plan no cambie su estado a `closed`.

---

## 7. Privacidad y Soberanía de la Persona

1. **Sin persistencia de transcripciones crudas:** Los volcados mentales crudos (`brain dumps`) o textos conversacionales no se persisten en la base de datos de dominio a menos que el usuario lo solicite expresamente en una nota. Solo se persisten los modelos estructurados extraídos y acordados.
2. **Cero persistencia automática de candidatos:** Los `memoryCandidates` producidos por `close_week` jamás se insertan en el almacén `memories`. Permanecen dentro del `StoredCloseWeekReport` como candidatos efímeros hasta que la persona los confirme a través de `confirmMemoryOperation`.
3. **Soberanía del olvido:** La operación `delete(id)` en `MemoryRepository` elimina físicamente el registro del almacén local. No se deja rastro oculto.
4. **Almacenamiento 100 % local:** Todos los almacenes residen exclusivamente en el perfil de usuario del navegador. No se envía telemetría ni datos personales a ningún servidor externo.
5. **Botón de purga total:** La API proveerá `clearAllLocalData()`, eliminando por completo la base de datos local si el usuario decide reiniciar su cuaderno desde cero.

---

## 8. Preparación para un Backend Remoto Futuro

El diseño separa estrictamente los contratos de dominio de la implementación técnica:
1. Las interfaces de repositorios no dependen de ningún tipo de IndexedDB (`IDBDatabase`, `IDBTransaction`).
2. Una futura migración a un backend remoto se limitará a crear implementaciones alternativas:
   - `HttpWeeklyPlanRepository`
   - `HttpWeeklyScheduleRepository`
   - `HttpMemoryRepository`
3. La capa de dominio, las 11 skills deterministas y las reglas de negocio no requerirán modificación alguna.
4. Las responsabilidades de autenticación, autorización multinquilino (multi-tenant), cifrado en tránsito/reposo y sincronización de conflictos remotos pertenecerán exclusivamente a la futura capa de transporte de la aplicación.

---

## 9. Plan de Implementación Incremental por Fases

### Fase P1: Arquitectura y Contratos de Repositorios (Esta Fase)
- **Alcance:** Documentación del ADR 0013, definición de contratos TypeScript en `src/domain/repositories/` y validación de tipos sin dependencias nuevas.
- **Aceptación:** Compilación limpia con `tsc --noEmit`, cero regresiones en la suite de pruebas existente.

### Fase P2: Adaptador Local de IndexedDB y Pruebas con Motor Aislado
- **Alcance:** Creación del adaptador `src/infrastructure/storage/indexeddb/` implementando las interfaces definidas.
- **Aceptación:** Pruebas unitarias de repositorios con `fake-indexeddb` verificando CRUD, transacciones, rollback en fallo, concurrencia optimista de `WeeklySchedule` y migraciones de versión.

### Fase P3: Servicio de Orquestación del Ciclo Semanal (`WeeklySessionService`)
- **Alcance:** Implementación de `resumeCurrentSession()` y `confirmMemoryOperation()`.
- **Aceptación:** Pruebas de integración E2E demostrando que una semana construida, ajustada y cerrada sobrevive al ciclo de recuperación tras reiniciar el servicio.

### Fase P4: Integración en la Interfaz de Usuario (`src/web/`)
- **Alcance:** Conexión de los hooks y componentes de React con `WeeklySessionService` para reanudar la vista del cuaderno semanal.

---

## 10. Riesgos, Limitaciones y Decisiones Pendientes

1. **Riesgo de cuota o limpieza de caché del navegador:** Si el usuario utiliza modo incógnito o limpia datos de navegación con "borrar cookies y almacenamiento de sitios", IndexedDB se purga.
   - *Mitigación:* Informar con claridad en la UI sobre el almacenamiento local y ofrecer una función futura de exportación/importación en formato JSON ("Copia de seguridad del cuaderno").
2. **Concurrencia multiventana:** Si el usuario abre la aplicación en dos pestañas simultáneas y reajusta la agenda en ambas, la concurrencia optimista (`StaleVersionConflictError`) abortará correctamente la segunda actualización para evitar sobreescrituras ciegas, pero la UI deberá ofrecer recargar el estado vigente.
3. **Decisión pendiente para P2:** Elegir entre implementar el adaptador directamente con la API estándar de IndexedDB (Promise wrapper en 150 líneas de código en TypeScript puro) o evaluar un paquete minúsculo tipo `idb` si las reglas del proyecto lo justifican. Preferencia actual: código TypeScript puro propio para mantener cero dependencias adicionales.

---

## Consecuencias
- Queda establecido el contrato normativo para la persistencia local de Conscious Tech.
- Se resuelve la discrepancia de identidad entre `ProposedWeek` y `WeeklySchedule` mediante el patrón envolvente `StoredWeeklyPlan`.
- Se preserva el 100 % de la privacidad y el principio rector: **la IA propone; la persona decide**.
