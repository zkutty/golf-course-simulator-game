import type { Page } from "@playwright/test";

/**
 * WorkspaceNav renders only the first three actions of a workspace inline and
 * collapses the rest behind "More" (see src/ui/WorkspaceNav.tsx). Specs that
 * reach for an action by test id must therefore select its workspace first and
 * expand the overflow when the action is not already on show — otherwise the
 * locator never resolves and the test burns its full timeout.
 *
 * Probing visibility rather than always opening the overflow keeps this working
 * whichever side of the slice(0, 3) boundary an action currently falls on.
 */
export async function openWorkspaceAction(
  page: Page,
  workspace: "design" | "operate" | "legacy",
  testId: string,
): Promise<void> {
  await page.getByTestId(`workspace-${workspace}`).click();
  const action = page.getByTestId(testId);
  if (!(await action.isVisible())) {
    await page.getByRole("button", { name: "More" }).click();
  }
  await action.click();
}
