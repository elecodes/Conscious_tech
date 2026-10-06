import { ExtractedItems } from "../../src/domain/items";

export interface TestCase {
  id: string;
  description: string;
  input: string;
  expected: ExtractedItems;
}

export const TEST_CASES: Record<string, TestCase> = {
  simpleTask: {
    id: "01-simple-task",
    description: "Tarea simple",
    input: "Tengo que enviar el email de reporte de ventas hoy.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "enviar el email de reporte de ventas hoy",
          title: "Enviar reporte de ventas",
          type: "task",
          status: "pending",
          commitment: "none",
        },
      ],
    },
  },
  project: {
    id: "02-project",
    description: "Proyecto",
    input: "Quiero lanzar el rediseño completo de la plataforma web este trimestre.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "lanzar el rediseño completo de la plataforma web este trimestre",
          title: "Rediseño completo de plataforma web",
          type: "project",
          project: "Rediseño Web",
          status: "pending",
          commitment: "none",
        },
      ],
    },
  },
  idea: {
    id: "03-idea",
    description: "Idea / Pensamiento que no debe ser tarea",
    input: "Quizá debería mirar cómo funciona Rust para backend en algún momento.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "Quizá debería mirar cómo funciona Rust para backend",
          title: "Explorar Rust para backend",
          type: "idea",
          status: "exploring",
          commitment: "none",
        },
      ],
    },
  },
  externalCommitment: {
    id: "04-external-commitment",
    description: "Compromiso externo",
    input: "He confirmado que voy a dar una clase para Cibervoluntarios el martes.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "He confirmado que voy a dar una clase para Cibervoluntarios el martes",
          title: "Dar clase en Cibervoluntarios",
          type: "commitment",
          project: "Cibervoluntarios",
          commitment: "external",
          status: "pending",
          deadline: {
            raw: "el martes",
            confidence: "high",
          },
        },
      ],
    },
  },
  concern: {
    id: "05-concern",
    description: "Preocupación que ocupa espacio mental",
    input: "Me preocupa que el servidor de staging se quede sin memoria con la nueva carga.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "Me preocupa que el servidor de staging se quede sin memoria",
          title: "Memoria del servidor de staging",
          type: "concern",
          commitment: "none",
        },
      ],
    },
  },
  multipleItems: {
    id: "06-multiple-items",
    description: "Varios elementos en un mismo texto",
    input: "Tengo que preparar la clase para el martes. También quiero terminar la definición del MVP, estudiar SOLID y seguir con ArchitectAI. Además quería mirar Zapsac, pero eso no corre prisa.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "preparar la clase para el martes",
          title: "Preparar clase",
          type: "commitment",
          commitment: "external",
          status: "pending",
          deadline: { raw: "el martes", confidence: "high" },
        },
        {
          id: "item-2",
          rawText: "terminar la definición del MVP",
          title: "Terminar definición del MVP",
          type: "task",
          status: "started",
        },
        {
          id: "item-3",
          rawText: "estudiar SOLID",
          title: "Estudiar SOLID",
          type: "task",
          status: "pending",
        },
        {
          id: "item-4",
          rawText: "seguir con ArchitectAI",
          title: "Seguir con ArchitectAI",
          type: "project",
          project: "ArchitectAI",
          status: "started",
        },
        {
          id: "item-5",
          rawText: "quería mirar Zapsac, pero eso no corre prisa",
          title: "Explorar Zapsac",
          type: "idea",
          project: "Zapsac",
          status: "exploring",
        },
      ],
    },
  },
  explicitDeadline: {
    id: "07-explicit-deadline",
    description: "Deadline explícito",
    input: "Tengo que entregar la propuesta antes del 2026-10-15.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "entregar la propuesta antes del 2026-10-15",
          title: "Entregar propuesta",
          type: "task",
          deadline: {
            raw: "2026-10-15",
            resolved: "2026-10-15",
            confidence: "high",
          },
        },
      ],
    },
  },
  relativeDate: {
    id: "08-relative-date",
    description: "Fecha relativa sin resolver forzada",
    input: "Revisar los contratos este finde.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "Revisar los contratos este finde",
          title: "Revisar contratos",
          type: "task",
          deadline: {
            raw: "este finde",
            confidence: "medium",
          },
        },
      ],
    },
  },
  explicitEffort: {
    id: "09-explicit-effort",
    description: "Esfuerzo explícito expresado por el usuario",
    input: "Necesito unas 3 horas para preparar las diapositivas de la conferencia.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "unas 3 horas para preparar las diapositivas",
          title: "Preparar diapositivas de conferencia",
          type: "task",
          estimatedEffort: {
            value: 3,
            unit: "hours",
            source: "user",
          },
        },
      ],
    },
  },
  explicitImportance: {
    id: "10-explicit-importance",
    description: "Importancia explícita",
    input: "Esto es crucial y muy importante para mí: asegurar la firma del cliente.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "asegurar la firma del cliente",
          title: "Asegurar firma del cliente",
          type: "task",
          importance: "high",
        },
      ],
    },
  },
  startedItem: {
    id: "11-started-item",
    description: "Elemento ya iniciado",
    input: "Continuar con el refactor del módulo de autenticación que dejé a medias.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "Continuar con el refactor del módulo de autenticación que dejé a medias",
          title: "Continuar refactor de autenticación",
          type: "task",
          status: "started",
        },
      ],
    },
  },
  exploratoryItem: {
    id: "12-exploratory-item",
    description: "Elemento exploratorio",
    input: "Investigando si vale la pena usar SQLite en memoria para tests locales.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "Investigando si vale la pena usar SQLite en memoria",
          title: "Evaluar SQLite en memoria para tests",
          type: "idea",
          status: "exploring",
        },
      ],
    },
  },
  ambiguousThought: {
    id: "13-ambiguous-thought",
    description: "Lenguaje ambiguo / pensamiento suelto",
    input: "Quizá en el futuro convenga revisar la arquitectura de eventos.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "Quizá en el futuro convenga revisar la arquitectura de eventos",
          title: "Revisar arquitectura de eventos futura",
          type: "idea",
          status: "exploring",
        },
      ],
    },
  },
  noTaskConversion: {
    id: "14-no-task-conversion",
    description: "Duda que NO debe convertirse en tarea",
    input: "No sé si tiene sentido seguir manteniendo la librería vieja.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "No sé si tiene sentido seguir manteniendo la librería vieja",
          title: "Duda sobre mantenimiento de librería vieja",
          type: "concern",
        },
      ],
    },
  },
  multipleRelated: {
    id: "17-multiple-related",
    description: "Varios elementos relacionados a un mismo proyecto",
    input: "Para Conscious Tech: redactar los principios, escribir el prompt de extracción y testearlo.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "redactar los principios",
          title: "Redactar principios",
          type: "task",
          project: "Conscious Tech",
        },
        {
          id: "item-2",
          rawText: "escribir el prompt de extracción",
          title: "Escribir prompt de extracción",
          type: "task",
          project: "Conscious Tech",
        },
        {
          id: "item-3",
          rawText: "testearlo",
          title: "Testear extracción",
          type: "task",
          project: "Conscious Tech",
        },
      ],
    },
  },
  longText: {
    id: "18-long-text",
    description: "Texto largo con mezcla de tareas, ideas y preocupaciones",
    input: "Llevo días dándole vueltas a varias cosas. Por un lado, tengo que pagar los impuestos trimestrales el viernes sin falta, eso ya me está estresando. Por otro lado, empecé a maquetar la web de Conscious Tech y quiero dejar lista la home. También me preguntaba si deberíamos integrar notas de voz con Whisper, aunque ahora mismo sería complicarnos la vida. Y tengo que llamar a Carlos para coordinar el taller.",
    expected: {
      items: [
        {
          id: "item-1",
          rawText: "pagar los impuestos trimestrales el viernes sin falta",
          title: "Pagar impuestos trimestrales",
          type: "commitment",
          commitment: "external",
          deadline: { raw: "el viernes", confidence: "high" },
        },
        {
          id: "item-2",
          rawText: "eso ya me está estresando",
          title: "Estrés por impuestos trimestrales",
          type: "concern",
        },
        {
          id: "item-3",
          rawText: "empecé a maquetar la web de Conscious Tech y quiero dejar lista la home",
          title: "Maquetar home de Conscious Tech",
          type: "task",
          project: "Conscious Tech",
          status: "started",
        },
        {
          id: "item-4",
          rawText: "me preguntaba si deberíamos integrar notas de voz con Whisper",
          title: "Integración de voz con Whisper",
          type: "idea",
          status: "exploring",
        },
        {
          id: "item-5",
          rawText: "llamar a Carlos para coordinar el taller",
          title: "Llamar a Carlos para coordinar taller",
          type: "task",
          commitment: "external",
        },
      ],
    },
  },
};
