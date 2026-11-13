import { describe, expect, it, vi } from "vitest";
import {
  createdDatabase,
  databaseReference,
  notionLink,
} from "../src/infrastructure/notion/result-parser";
import { sendNotionCalendar, notionSnapshotHash } from "../src/infrastructure/notion/send-calendar";
import { checkNotionDelivery } from "../src/infrastructure/notion/check-delivery";
import { recoverNotionCalendar } from "../src/infrastructure/notion/recover-calendar";
import { NotionRemoteError, type NotionSession } from "../src/infrastructure/notion/mcp-client";
import type { NotionSnapshot } from "../src/application/notion-snapshot";
import { db, source, url, title, document, wrap } from "./fixtures/notion-database";
const snapshot: NotionSnapshot = {
  title,
  rows: [2, 2, 1].map((hours, index) => ({
    name: "Práctica",
    date: `2026-11-${16 + index}`,
    deadline: "",
    status: "Pendiente",
    hours,
    remaining: null,
    kind: "Reparto diario",
    week: "2026-11-16 – 2026-11-22",
    time: "",
    taskId: "plan/task",
  })),
};
function harness(
  options: {
    nonempty?: boolean;
    archived?: boolean;
    unknownRows?: boolean;
    loseReply?: boolean;
    title?: string;
    filtered?: boolean;
    extraView?: boolean;
    missingSchema?: boolean;
  } = {}
) {
  const session: NotionSession = {
    expiresAt: Date.now() + 100000,
    exports: { [notionSnapshotHash(snapshot)]: { status: "uncertain", sent: 0 } },
  };
  const list = async () => ({
    tools: [
      "notion-search",
      "notion-fetch",
      "notion-create-database",
      "notion-create-view",
      "notion-create-pages",
      "notion-query-data-sources",
    ].map((name) => ({ name })),
  });
  const call = vi.fn(
    async (name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (name === "notion-search")
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                results: [
                  { title, url },
                  { title: "Unrelated", url: "https://evil.test" },
                ],
                has_more: false,
              }),
            },
          ],
        };
      if (name === "notion-fetch")
        return args.id === "notion://docs/view-dsl-spec"
          ? { content: [{ type: "text", text: "CALENDAR BY" }] }
          : wrap(document(options));
      if (name === "notion-query-data-sources") {
        const data = args.data as { is_archived: boolean };
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                options.unknownRows
                  ? {}
                  : {
                      results:
                        options.nonempty || (options.archived && data.is_archived)
                          ? [{ id: db }]
                          : [],
                      has_more: false,
                    }
              ),
            },
          ],
        };
      }
      if (name === "notion-create-database") return wrap(document());
      if (name === "notion-create-pages" && options.loseReply) throw new Error("Lost reply");
      return { content: [{ type: "text", text: "{}" }] };
    }
  );
  return { session, list, call, save: async () => {} };
}
describe("Notion response compatibility and partial-copy recovery", () => {
  it("decodes the live response shape: JSON wrapper, app.notion.com/p and double braces", () => {
    expect(createdDatabase(wrap(document()))).toEqual({ id: db.replaceAll("-", ""), url, source });
    expect(databaseReference(wrap(document()))?.url).toBe(url);
    expect(
      createdDatabase({
        structuredContent: {
          object: "database",
          id: db,
          url: `https://www.notion.so/${db}`,
          data_sources: [{ id: source }],
        },
      })
    ).toMatchObject({ source, id: db });
    expect(notionLink("https://app.notion.com.evil.test/p/" + db)).toBeNull();
    expect(notionLink("https://app.notion.com/redirect/" + db)).toBeNull();
  });
  it("completes a fresh send with the live response shape", async () => {
    const h = harness();
    h.session.exports = {};
    expect(await sendNotionCalendar(snapshot, h.session, h.call, h.list, h.save)).toMatchObject({
      status: "complete",
      sent: 3,
      url,
    });
    expect(h.call.mock.calls.filter(([name]) => name === "notion-create-database")).toHaveLength(1);
  });
  it("diagnoses legacy incomplete sends by search only, without clearing guards or creating anything", async () => {
    const h = harness();
    const before = JSON.stringify(h.session);
    const result = await checkNotionDelivery(snapshot, h.session, h.list, h.call);
    expect(result.candidates).toEqual([{ title, url }]);
    expect(result.code).toBe("NOTION_LEGACY_INCOMPLETE");
    expect(h.call.mock.calls.map(([name]) => name)).toEqual(["notion-search"]);
    expect(JSON.stringify(h.session)).toBe(before);
  });
  it("fills a verified empty existing copy, preserves 2/2/1 hours and prevents repeat recovery", async () => {
    const h = harness();
    const result = await recoverNotionCalendar(snapshot, url, h.session, h.list, h.call, h.save);
    expect(result).toMatchObject({ status: "complete", sent: 3, url, recoveryAttempted: true });
    const queries = h.call.mock.calls.filter(([name]) => name === "notion-query-data-sources");
    expect(queries.map(([, args]) => (args.data as { is_archived: boolean }).is_archived)).toEqual([
      false,
      true,
    ]);
    expect(h.call.mock.calls.some(([name]) => name === "notion-create-database")).toBe(false);
    const pages = h.call.mock.calls.find(([name]) => name === "notion-create-pages")![1].pages as {
      properties: Record<string, unknown>;
    }[];
    expect(pages.map((page) => page.properties["Horas asignadas"])).toEqual([2, 2, 1]);
    const count = h.call.mock.calls.length;
    await recoverNotionCalendar(snapshot, url, h.session, h.list, h.call, h.save);
    expect(h.call.mock.calls).toHaveLength(count);
  });
  it.each([
    { nonempty: true },
    { archived: true },
    { unknownRows: true },
    { title: "Other week" },
    { filtered: true },
    { extraView: true },
    { missingSchema: true },
  ])("refuses unsafe recovery without writes: %j", async (options) => {
    const h = harness(options);
    const before = JSON.stringify(h.session);
    await expect(
      recoverNotionCalendar(snapshot, url, h.session, h.list, h.call, h.save)
    ).rejects.toThrow();
    expect(h.call.mock.calls.some(([name]) => name.startsWith("notion-create"))).toBe(false);
    expect(JSON.stringify(h.session)).toBe(before);
  });
  it("retains the selected-copy guard after a lost task response", async () => {
    const h = harness({ loseReply: true });
    expect(
      await recoverNotionCalendar(snapshot, url, h.session, h.list, h.call, h.save)
    ).toMatchObject({ status: "uncertain", stage: "create_tasks", recoveryAttempted: true });
    const count = h.call.mock.calls.length;
    await recoverNotionCalendar(snapshot, url, h.session, h.list, h.call, h.save);
    expect(h.call.mock.calls).toHaveLength(count);
  });
  it("keeps safe failure stage and code without exposing provider text", async () => {
    const h = harness();
    h.session.exports = {};
    h.call.mockImplementation(async () => {
      throw new NotionRemoteError(403);
    });
    // The document read fails before any write and must remain retryable.
    await expect(sendNotionCalendar(snapshot, h.session, h.call, h.list, h.save)).rejects.toThrow();
    expect(h.session.exports).toEqual({});
    h.call.mockImplementation(async (name) => {
      if (name === "notion-create-database") throw new NotionRemoteError(403);
      return { content: [{ type: "text", text: "{}" }] };
    });
    expect(await sendNotionCalendar(snapshot, h.session, h.call, h.list, h.save)).toMatchObject({
      status: "uncertain",
      stage: "create_database",
      code: "NOTION_HTTP_403",
    });
  });
});
