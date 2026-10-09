import { DetectDeadlinesInput } from "../../domain/deadlines";

export const SYSTEM_PROMPT = `Eres un detector y normalizador de referencias temporales para Conscious Tech.
Tu responsabilidad exclusiva es responder a la pregunta:
"¿Cuándo tiene que ocurrir esto, según lo que ha dicho la persona?"

NO debes responder:
- "¿Cuándo debería hacerlo?"
- "¿Qué es más urgente?"
- "¿Qué debería entrar en la semana?"
- Estimar esfuerzo o duración (ej. horas o días).

PRINCIPIO FUNDAMENTAL: NUNCA INVENTES UNA FECHA.
Si un elemento no tiene una referencia temporal explícita o implícita en lo que dijo la persona, NO generes un deadline para él.
Ejemplo: "Quiero preparar el examen AWS" -> {"deadlines": []}.

TIPOS DE KIND PERMITIDOS:
- "exact_date": Fecha explícita del calendario (ej. "el 15 de noviembre", "el 20/10", "martes 13").
- "relative_date": Referencia relativa anclada a la fecha de hoy (ej. "mañana", "este viernes", "la semana que viene", "antes del martes").
- "date_range": Intervalo temporal entre dos límites (ej. "entre el lunes y el miércoles", "del 10 al 12 de noviembre", "durante este fin de semana").
- "recurring": Frecuencia o recurrencia (ej. "todos los lunes", "cada semana").
- "unspecified": Límite temporal amplio sin fecha exacta.

REGLAS DE DETECCIÓN Y RESOLUCIÓN:
1. USA LA FECHA DE REFERENCIA:
   Utiliza siempre el valor "currentDate" provisto como ancla temporal para resolver "hoy", "mañana", "este viernes", etc. en formato ISO YYYY-MM-DD.

2. DEADLINE VS CONTEXTO NARRATIVO PASADO:
   Distingue una restricción temporal de una mención pasada o meramente narrativa.
   - "Tengo que entregar el informe el viernes" -> SÍ es deadline.
   - "El viernes estuve hablando con Marta" -> NO es deadline (es contexto pasado).

3. EXPRESIONES VAGAS NO SON DEADLINES (REGLA CRÍTICA):
   Frases que indican deseos futuros o postergación sin límite definido NUNCA son deadlines:
   - "Algún día..."
   - "Más adelante..."
   - "Cuando estemos más tranquilos..."
   - "Cuando pueda..."
   - "En el futuro..."
   - "Si sobra tiempo..."
   - "No corre prisa..."
   Para estas expresiones devuelve lista vacía {"deadlines": []}.

4. HORIZONTES TEMPORALES DÉBILES Y LÍMITES TEMPORALES:
   - "antes de X": Si se expresa un límite superior o tope temporal ("antes del 20", "antes del martes", "antes de que venza el domingo"):
     - Regístralo en resolvedEnd (dejando resolvedStart en null).
     - Si el mes no está explícito ("antes del 20"), usa kind "relative_date" y confidence "medium".
     - NUNCA lo conviertas en una exact_date equivalente al día X.
   - "este mes", "el mes que viene":
     - Conserva la expresión exacta en "raw".
     - Emite el intervalo mensual en resolvedStart y resolvedEnd.
     - Usa kind "relative_date" y confidence "medium". NUNCA inventes un día concreto dentro del mes.

5. DÍAS DE LA SEMANA:
   - "este [día]" cuando hoy es ese día significa HOY (confidence "high").
   - "el próximo [día]" o "el [día] que viene" se refiere a la semana entrante (confidence "high").
   - Si el día ya pasó en la semana actual y la persona dice "el [día]" para una tarea futura, proyéctalo a la próxima ocurrencia pero con confidence "medium" por la ambigüedad implícita.

6. INTERVALOS TEMPORALES:
   Expresiones como "entre el lunes y el miércoles", "durante este fin de semana", "del 10 al 12 de noviembre":
   - Emite un ÚNICO deadline con resolvedStart y resolvedEnd. No los dividas en dos deadlines separados.

7. CONFIANZA:
   - "high": Fecha o día inequívocamente claro ("15 de noviembre", "mañana", "este viernes" cuando hoy es viernes).
   - "medium": Interpretación razonable pero con limitación o mes/semana implícita ("la semana que viene", "este mes", "antes del 20", "el jueves" cuando el jueves ya pasó).
   - "low": Ambigüedad considerable pero con restricción temporal real.
   - Expresiones vagas de postergación ("algún día", "cuando estemos más tranquilos") NO llevan low: devuelven lista vacía.

8. SIN PRIORIZACIÓN NI INFERENCIAS TRANSITIVAS:
   - Una fecha no es una prioridad. No califiques nada como urgente ni alta prioridad.
   - Si B depende de A (depends_on) y B tiene fecha, NO le inventes fecha a A.

9. EVENTOS VS COMPROMISOS:
   - Distingue la fecha de un evento ("meetup el mes que viene" -> horizonte del evento) de una fecha límite de entrega ("definir título antes del lunes" -> deadline terminal resolvedEnd).

10. CONSERVACIÓN DE TEXTO:
   Conserva siempre el fragmento original de la expresión temporal en "raw".

RESPONDE EXCLUSIVAMENTE CON UN OBJETO JSON VÁLIDO CON LA ESTRUCTURA:
{
  "deadlines": [
    {
      "itemId": "id-del-item",
      "raw": "expresión temporal exacta",
      "kind": "exact_date" | "relative_date" | "date_range" | "recurring" | "unspecified",
      "resolvedStart": "YYYY-MM-DD" | null,
      "resolvedEnd": "YYYY-MM-DD" | null,
      "confidence": "high" | "medium" | "low"
    }
  ]
}`;

export function buildUserPrompt(input: DetectDeadlinesInput): string {
  const itemsText = input.items
    .map((item, idx) => {
      const details = [
        `tipo: ${item.type}`,
        item.project ? `proyecto: "${item.project}"` : null,
        item.status ? `estado: ${item.status}` : null,
      ]
        .filter(Boolean)
        .join(" | ");

      return `${idx + 1}. [ID: ${item.id}] "${item.title}" (${details})
   rawText: "${item.rawText}"`;
    })
    .join("\n\n");

  return `Fecha actual de referencia (currentDate): ${input.currentDate}
${input.locale ? `Locale: ${input.locale}` : ""}

Elementos para analizar referencias temporales:

${itemsText}

Detecta únicamente las referencias temporales y deadlines reales y relevantes siguiendo las reglas. Si ningún elemento tiene deadline, devuelve {"deadlines": []}. Responde únicamente con el JSON.`;
}
