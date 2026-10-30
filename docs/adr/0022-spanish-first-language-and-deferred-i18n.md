# 22. Idioma Español como Lengua Nativa y Aplazamiento de Internacionalización (i18n)

Fecha: 29 de octubre de 2026  
Estado: Aceptado

## Contexto

Conscious Tech fue concebido como un cuaderno de claridad y acompañante reflexivo humano («_Un cuaderno personal + un asistente prudente + IA en calma_»). A diferencia de gestores de tareas mecánicos o tableros de productividad corporativos, la voz y el tono del producto están íntimamente arraigados en el idioma español (con sensibilidad rioplatense y neutral: _«AI propone, tú decides»_, _«Margen de calma»_, _«Qué quieres cuidar esta semana»_, _«Tu tiempo de un vistazo»_, _«Tareas postergadas de semanas anteriores»_).

Tanto los prompts del sistema hacia los modelos de lenguaje (Groq, Gemini), como los analizadores de lenguaje natural (verbos de acción, expresiones de agobio, normalización de fechas como «viernes», «dentro de 2 semanas»), los esquemas de persistencia y las cadenas de interfaz de usuario se encuentran codificados en español.

Introducir frameworks de internacionalización en esta etapa (`react-i18next`, diccionarios externos, abstracciones multilingües en prompts) incrementaría sustancialmente la complejidad accidental y el consumo de tokens sin una justificación de producto validada.

## Decisión

1. **Español Nativo Primero (_Spanish-First_):**
   - El idioma canónico de prompts, lógica de extracción semántica, normalización temporal y UI es el español.
   - Las decisiones de vocabulario priorizan calidez, claridad y dignidad humana sobre términos de productividad industrial (evitar "backlog", "sprint", "throughput", "overdue alerts").

2. **Aplazamiento de Internacionalización (_Deferred i18n_):**
   - En estricta concordancia con las reglas de `AGENTS.md` (_«Build incrementally»_, _«Can this be simpler?»_, _«Do not build future abstractions before justified»_), se aplaza cualquier infraestructura formal de i18n hasta que el ciclo de planificación semanal y la retención del producto estén validados con personas reales.

## Consecuencias

- **Positivas:**
  - Código simple, directo y sin capas de indirección o llaves de traducción arbitrarias.
  - Prompts altamente afinados en español que evitan ambigüedades de traducción automática en modelos compactos (Qwen, Gemini Flash).
- **Negativas / Compromisos:**
  - El producto está acotado inicialmente al público hispanohablante. La expansión a otros idiomas requerirá extraer prompts y cadenas cuando exista demanda concreta.
