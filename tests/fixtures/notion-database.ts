// Anonymized shape of a database response observed from the live Notion MCP.
export const db = "a1111111-1111-4111-8111-111111111111",
  source = "b2222222-2222-4222-8222-222222222222",
  view = "c3333333-3333-4333-8333-333333333333";
export const url = `https://app.notion.com/p/${db.replaceAll("-", "")}`;
export const title = "Conscious Tech · 2026-11-16 – 2026-11-22";
const schema: Record<string, { type: string }> = Object.fromEntries(
  Object.entries({
    Nombre: "title",
    Fecha: "date",
    Estado: "text",
    "Horas asignadas": "number",
    "Horas sin asignar": "number",
    Tipo: "text",
    Semana: "text",
    "Fecha límite": "date",
    Horario: "text",
    "ID de tarea": "text",
  }).map(([key, type]) => [key, { type }])
);
export const document = (
  options: { title?: string; filtered?: boolean; extraView?: boolean; missingSchema?: boolean } = {}
) =>
  `<database url="{{${url}}}" inline="false"><data-sources><data-source url="{{collection://${source}}}"><data-source-state>${JSON.stringify({ name: options.title ?? title, url: `collection://${source}`, schema: options.missingSchema ? {} : schema })}</data-source-state></data-source></data-sources><views><view url="{{view://${view}}}">${JSON.stringify({ dataSourceUrl: `{{collection://${source}}}`, name: "Default view", type: "table", ...(options.filtered ? { filter: {} } : {}) })}</view>${options.extraView ? `<view url="{{view://${db}}}">{"type":"calendar"}</view>` : ""}</views></database>`;
export const wrap = (text: string) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify({ id: db, title, text, url, metadata: { type: "database" } }),
    },
  ],
});
