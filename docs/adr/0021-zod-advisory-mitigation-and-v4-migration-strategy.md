# 21. Estrategia de Mitigación de Vulnerabilidad Zod y Migración a Zod 4

Fecha: 29 de octubre de 2026  
Estado: Aceptado

## Contexto

El análisis de dependencias de seguridad identificó el aviso de severidad alta **GHSA-mrhx-c7xc-m3w5** afectando a versiones de `zod` inferiores a 4.6.6 («*Zod can exhaust memory while validating oversized constrained collections*»).

Dado que Conscious Tech utiliza esquemas Zod en todas las capas del dominio para validar salidas de LLMs (Groq, Gemini, RemoteAI) y registros persistidos en IndexedDB, una colección sobredimensionada transmitida por un proveedor o un tercero podría inducir sobrecarga de memoria si no existen límites defensivos de entrada.

La actualización sugerida por los gestores de paquetes instala `zod@4.6.7`, la cual introduce cambios de ruptura mayores (*breaking changes*) respecto a la API de `zod@3.24.2` en definiciones de esquemas, inferencias de tipos y métodos de transformación.

## Decisión

1. **Mitigaciones operativas inmediatas en capa de infraestructura y proxy:**
   - Mantener techos estrictos en el tamaño de carga útil entrante en todos los endpoints (`calendar-proxy-handler` aplica corte por flujo de 5 MB; `ai-proxy-handler` procesa payloads tipados con limitador de tasa deslizante).
   - Limitar de forma determinista la cantidad máxima de elementos aceptados en los pipelines de dominio (por ejemplo, el techo de 7 focos y corte conservador de items).

2. **Aislamiento de la migración de Zod 4:**
   - La migración completa a Zod 4 se agenda como un hito arquitectónico dedicado e independiente (no acoplado a refactorizaciones de UI o proxies), permitiendo auditar metódicamente los esquemas de dominio sin riesgos de regresión en las 61 suites de prueba existentes.

## Consecuencias

- **Positivas:**
  - El sistema mantiene estabilidad y 100% de cobertura en tests sin introducir roturas accidentales de tipos en los 19 archivos de dominio.
  - La superficie de ataque queda acotada mediante guardas perimetrales a nivel de proxy y límites de carga útil.
- **Negativas / Compromisos:**
  - `npm audit` mantendrá el aviso hasta que se concrete la migración programada a Zod 4.
