import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarSyncCard } from "../src/web/components/calendar-sync-card";
import { TargetWeek } from "../src/domain/week";
import { isSafeCalendarUrl } from "../src/server/calendar-proxy-handler";

describe("CalendarSyncCard UI Component & Server Proxy Handler", () => {
  const targetWeek: TargetWeek = {
    startDate: "2026-10-19",
    endDate: "2026-10-25",
  };

  describe("CalendarSyncCard Component Rendering", () => {
    it("renders card in initial calm collapsed state", () => {
      const html = renderToStaticMarkup(
        <CalendarSyncCard
          targetWeek={targetWeek}
          onCalendarApplied={vi.fn()}
        />
      );

      expect(html).toContain("data-testid=\"calendar-sync-card\"");
      expect(html).toContain("Google Calendar (Compromisos fijos)");
      expect(html).toContain("Conectar / Sincronizar");
      // Initially collapsed, input should not be in the DOM
      expect(html).not.toContain("data-testid=\"ical-url-input\"");
    });
  });

  describe("isSafeCalendarUrl SSRF Protection", () => {
    it("allows valid Google Calendar HTTPS URL", () => {
      expect(
        isSafeCalendarUrl(
          "https://calendar.google.com/calendar/ical/user%40gmail.com/private-12345/basic.ics"
        )
      ).toBe(true);
    });

    it("allows webcal:// protocol by normalizing to https", () => {
      expect(
        isSafeCalendarUrl(
          "webcal://calendar.google.com/calendar/ical/user%40gmail.com/private-12345/basic.ics"
        )
      ).toBe(true);
    });

    it("rejects localhost and 127.0.0.1 loopbacks", () => {
      expect(isSafeCalendarUrl("http://localhost:3000/calendar.ics")).toBe(false);
      expect(isSafeCalendarUrl("http://127.0.0.1:8080/events.ics")).toBe(false);
      expect(isSafeCalendarUrl("https://localhost/secret.ics")).toBe(false);
    });

    it("rejects internal RFC 1918 private IP ranges", () => {
      expect(isSafeCalendarUrl("http://192.168.1.1/cal.ics")).toBe(false);
      expect(isSafeCalendarUrl("http://10.0.0.1/cal.ics")).toBe(false);
      expect(isSafeCalendarUrl("http://172.16.0.1/cal.ics")).toBe(false);
    });

    it("rejects invalid URLs or non-http protocols", () => {
      expect(isSafeCalendarUrl("ftp://example.com/cal.ics")).toBe(false);
      expect(isSafeCalendarUrl("not-a-valid-url")).toBe(false);
      expect(isSafeCalendarUrl("javascript:alert(1)")).toBe(false);
    });
  });
});
