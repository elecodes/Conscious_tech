import type { Browser, Page } from "playwright";
import type { StoredWeeklyPlan } from "../src/domain/repositories/types";
import { createReviewFixture } from "../tests/fixtures/review-proposal";

async function readDraft(page: Page): Promise<StoredWeeklyPlan> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("conscious_tech_db");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<StoredWeeklyPlan>((resolve, reject) => {
        const request = db.transaction("plans").objectStore("plans").get("draft-2026-12-07");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

function assertMembership(plan: StoredWeeklyPlan, expected: string[]) {
  const proposal = plan.proposal;
  const ids = [
    ...proposal.foci.flatMap((focus) => focus.contributingItemIds),
    ...proposal.obligations.map((item) => item.itemId),
    ...proposal.flexibleOptions.map((item) => item.itemId),
    ...proposal.deferredItems.map((item) => item.itemId),
  ];
  if (JSON.stringify(ids.sort()) !== JSON.stringify([...expected].sort()))
    throw new Error("A review action lost, duplicated or invented proposal items");
}

export async function verifyPlanningReview(browser: Browser, url: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const fixture = createReviewFixture();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByTestId("flow-textarea").waitFor();
    await page.evaluate(
      async ({ plan, items }) => {
        localStorage.setItem(
          "conscious_tech_transient_planning_context",
          JSON.stringify({
            targetWeekStart: plan.targetWeek.startDate,
            targetWeekEnd: plan.targetWeek.endDate,
            availableHoursInput: "16",
            protectedSpacePercentInput: "25",
          })
        );
        localStorage.setItem("conscious_tech_transient_dump_result", JSON.stringify({ items }));
        localStorage.setItem("conscious_tech_transient_dump_text", plan.draftContext!.noteText!);
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open("conscious_tech_db");
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction("plans", "readwrite");
            tx.objectStore("plans").put(plan);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          });
        } finally {
          db.close();
        }
      },
      { plan: fixture.plan, items: fixture.items }
    );
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("draft-advanced-details").evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await page.getByTestId("planning-review-board").waitFor();
    for (const item of fixture.items) {
      if ((await page.getByTestId(`idea-card-${item.id}`).count()) !== 1)
        throw new Error(`Source ${item.id} is missing or duplicated`);
    }
    const groupMove = page.getByTestId("demote-focus-to-flexible-group-focus");
    if (!(await groupMove.isDisabled()))
      throw new Error("Grouped focus can lose contributing items through demotion");
    const sourceDetails = page.getByTestId("review-details-a");
    await sourceDetails.locator(":scope > summary").focus();
    await page.keyboard.press("Enter");
    if (!(await sourceDetails.evaluate((el: HTMLDetailsElement) => el.open)))
      throw new Error("Keyboard cannot open source corrections");
    if (!(await page.getByTestId("idea-card-b").innerText()).includes(fixture.items[1]!.rawText))
      throw new Error("Long source wording was lost");
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error(
        "Open source corrections overflow on mobile: " +
          JSON.stringify(
            await page.evaluate(() =>
              [...document.querySelectorAll(".planning-review-board *")]
                .filter((el) => el.getBoundingClientRect().right > innerWidth)
                .slice(0, 8)
                .map((el) => ({
                  tag: el.tagName,
                  class: el.className,
                  width: el.getBoundingClientRect().width,
                }))
            )
          )
      );
    await page.getByTestId("review-overdue-decisions").locator(":scope > summary").click();
    if (!(await page.getByTestId("decision-postpone-a").isDisabled()))
      throw new Error("Overdue move can discard a grouped focus member");
    assertMembership(await readDraft(page), fixture.selectedIds);

    // Reuse existing single-item moves and preserve all other group members.
    await page.getByTestId("promote-flexible-to-focus-d").click();
    await page.getByTestId("proposed-focus-focus-d").waitFor();
    assertMembership(await readDraft(page), fixture.selectedIds);
    await page.getByTestId("demote-focus-to-flexible-focus-d").click();
    await page.getByTestId("promote-flexible-to-focus-d").waitFor();
    assertMembership(await readDraft(page), fixture.selectedIds);
    await page.getByTestId("proposed-deferred-items-summary").click();
    await page.getByTestId("review-details-g").locator(":scope > summary").click();
    const gPanel = page.getByTestId("idea-details-g");
    await gPanel.getByLabel("Fecha límite para Revisar una tarea pendiente").fill("2026-12-12");
    if (!(await gPanel.getByTestId("defer-item-include-button-g").isVisible()))
      throw new Error("Inclusion is not available next to hours and date");
    await gPanel.getByTestId("defer-item-postpone-button-g").click();
    await page.getByTestId("postponed-category-badge-g").waitFor();
    assertMembership(await readDraft(page), fixture.selectedIds);
    await page.getByTestId("defer-item-unschedule-button-g").click();
    await page.getByTestId("defer-item-include-button-g").click();
    await page.getByTestId("proposed-focus-focus-included-g").waitFor();
    await page
      .getByTestId("review-placement-status-g")
      .filter({ hasText: "En esta semana" })
      .waitFor();
    await gPanel.getByLabel("Horas estimadas para Revisar una tarea pendiente").waitFor();
    if (
      (await gPanel.getByLabel("Fecha límite para Revisar una tarea pendiente").inputValue()) !==
      "2026-12-12"
    )
      throw new Error("Inclusion lost the date in the same panel");
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("data-testid") === "idea-card-g"
    );
    if ((await page.getByTestId("defer-item-include-button-g").count()) !== 0)
      throw new Error("An included item still offers inclusion");
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
      throw new Error("Inline inclusion controls overflow on mobile");
    assertMembership(await readDraft(page), fixture.selectedIds);
    if (
      (await readDraft(page)).proposal.foci.find((focus) => focus.id === "focus-included-g")
        ?.estimatedHours !== 0.75
    )
      throw new Error("Moving a 45-minute item invented hours");

    // Selection is distinct from placement, and excluded notes stay inspectable.
    if (
      !(await page
        .getByTestId("review-details-g")
        .evaluate((element) => (element as HTMLDetailsElement).open))
    )
      await page.getByTestId("review-details-g").locator(":scope > summary").click();
    await page.getByTestId("idea-card-g").getByRole("checkbox").uncheck();
    await page.getByTestId("proposal-dirty-banner").waitFor();
    await page.getByTestId("update-proposal-button").click();
    await page.getByTestId("proposal-dirty-banner").waitFor({ state: "hidden" });
    const expected = fixture.selectedIds.filter((id) => id !== "g");
    assertMembership(await readDraft(page), expected);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("draft-advanced-details").evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await page.getByTestId("planning-review-board").waitFor();
    for (const item of fixture.items) {
      if ((await page.getByTestId(`idea-card-${item.id}`).count()) !== 1)
        throw new Error(`Reload lost or duplicated source ${item.id}`);
    }
    if (await page.getByTestId("idea-card-g").getByRole("checkbox").isChecked())
      throw new Error("Excluded selection was not restored");
    const restored = await readDraft(page);
    if (restored.draftContext?.extractedItems?.find((item) => item.id === "f")?.type !== "concern")
      throw new Error("Concern was converted into a task");
    if (errors.length) throw new Error(errors.join("\n"));
    console.log(
      "  ✓ Unified review: source conservation, keyboard corrections, group protection, moves, exclusion and reload verified"
    );
  } finally {
    await context.close();
  }

  const captureContext = await browser.newContext();
  try {
    const capture = await captureContext.newPage();
    await capture.goto(url, { waitUntil: "networkidle" });
    await capture.getByTestId("flow-textarea").waitFor();
    await capture.evaluate((item) => {
      localStorage.setItem(
        "conscious_tech_transient_dump_result",
        JSON.stringify({ items: [item] })
      );
      localStorage.setItem("conscious_tech_transient_dump_text", item.title);
    }, fixture.items[3]!);
    await capture.reload({ waitUntil: "networkidle" });
    await capture.getByTestId("step-indicator-review").click();
    await capture.getByTestId("prepare-calendar-button").click();
    await capture.getByTestId("draft-advanced-details").evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await capture.getByTestId("planning-review-board").waitFor();
    console.log("  ✓ Captured items without a proposal can generate their first proposal");
  } finally {
    await captureContext.close();
  }
}
