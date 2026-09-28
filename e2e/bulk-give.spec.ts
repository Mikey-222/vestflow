// Playwright E2E test — bulk give CSV upload (#946)
//
// Covers: upload a fixed 5-row CSV → preview lists exactly 5 rows → submit →
// the app makes ONE `batch_give` call carrying all 5 receivers, and the mocked
// chain reports the 5 `given` events that call should produce.
//
// The single-call assertion is the point of the test. Five separate `give`
// calls would also move 5 XLM and also emit 5 `given` events, so a UI-only
// assertion ("it worked") cannot tell the two apart — but they differ hugely in
// gas, in fees, and in atomicity, where a partial failure in the N-call version
// strands the transfers that already landed. Asserting on the recorded
// invocation is what pins the batching behaviour rather than the outcome.
//
// Prerequisites:
//   npx playwright install chromium
//   npm run dev (or the app is running on http://localhost:3000)
//
// Run:
//   npx playwright test e2e/bulk-give.spec.ts

import { readFileSync } from "fs";
import path from "path";
import { test, expect, type Page } from "@playwright/test";
import { mockFreighterAndRpc, type MockRpc } from "./fixtures/sorobanMock";

// Resolved relative to this file rather than process.cwd() so the test works
// regardless of the directory Playwright is invoked from.
const CSV_PATH = path.join(__dirname, "fixtures", "bulk-give-5.csv");
const EXPECTED_ROWS = 5;

/** The Give modal is opened by the Shift+G shortcut (#816). */
async function openBulkGiveTab(page: Page) {
  // The Give modal lives on the dashboard at /app, not the marketing landing
  // page at / -- Shift+G is bound there.
  await page.goto("/app");
  // Wait for hydration so the keydown listener is attached.
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press("Shift+G");
  await page.getByRole("button", { name: /bulk give \(csv\)/i }).click({ timeout: 15_000 });
}

test.describe("Bulk give CSV upload", () => {
  let rpc: MockRpc;

  test.beforeEach(async ({ page }) => {
    rpc = await mockFreighterAndRpc(page, "https://soroban-testnet.stellar.org/**");
  });

  test("previews 5 rows and settles them with a single batch_give", async ({ page }) => {
    await openBulkGiveTab(page);

    // ── Upload the checked-in fixture ───────────────────────────────────
    // Read from disk rather than generating in-code so the addresses are
    // stable across runs and a typo shows up as a real diff.
    const csv = readFileSync(CSV_PATH, "utf8");
    await page.getByTestId("bulk-give-file-input").setInputFiles({
      name: "bulk-give.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });

    // ── Preview: exactly 5 rows, none invalid ───────────────────────────
    const preview = page.getByText(/Preview:/);
    await expect(preview).toBeVisible({ timeout: 10_000 });
    // The count sits in a nested <strong>, so assert the rendered text rather
    // than trying to match across element boundaries.
    await expect(preview).toHaveText(
      `Preview: ${EXPECTED_ROWS} rows (${EXPECTED_ROWS} valid)`
    );
    // One <tr> per receiver, so the row count is checked against the DOM and
    // not just the summary line.
    await expect(page.locator("tbody tr")).toHaveCount(EXPECTED_ROWS);
    await expect(page.getByText(/invalid/i)).toHaveCount(0);

    // ── Submit ──────────────────────────────────────────────────────────
    const submit = page.getByRole("button", { name: new RegExp(`Send Bulk Give \\(${EXPECTED_ROWS}\\)`) });
    await expect(submit).toBeEnabled();
    await submit.click();

    // Wait for the app to report success before inspecting the recording.
    // Without this the assertions can race the client: polling merely for
    // "at least one invocation" would resolve after the first of several calls
    // and under-count, so a regression to one-call-per-row could pass.
    await expect(page.getByText(/Bulk give completed/i)).toBeVisible({ timeout: 30_000 });

    // ── The app batched all 5 into one contract call ────────────────────
    const batchCalls = rpc.invocations.filter((i) => i.functionName === "batch_give");
    const singleCalls = rpc.invocations.filter((i) => i.functionName === "give");

    // One call, not five.
    expect(batchCalls).toHaveLength(1);
    expect(singleCalls).toHaveLength(0);
    // And it carried every receiver in that one call.
    expect(batchCalls[0].receiverCount).toBe(EXPECTED_ROWS);

    // ── The chain reported 5 `given` events for it ──────────────────────
    expect(batchCalls[0].givenEventCount).toBe(EXPECTED_ROWS);

  });
});
