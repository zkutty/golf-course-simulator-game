import { expect, type Page } from '@playwright/test'

export async function enterGameThroughQuickStart(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Quick Start' }).click()

  const tutorial = page.getByRole('dialog', { name: 'First-launch tutorial' })
  await expect(tutorial).toBeVisible()
  await tutorial.getByRole('button', { name: 'Skip tutorial' }).click()
  await expect(tutorial).toBeHidden()
  await expect(page.locator('#root canvas').first()).toBeVisible()
}
