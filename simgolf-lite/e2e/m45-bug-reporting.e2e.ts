import { expect, test, type Page } from '@playwright/test'
import { enterGameThroughQuickStart } from './reporter-readiness'

interface CapturedReport {
  consent?: { diagnostics?: boolean; screenshot?: boolean }
  diagnostics?: {
    error?: { message?: string }
    route?: string
  }
  reportId?: string
  screenshot?: { dataUrl?: string; mime?: string }
  source?: string
  summary?: { title?: string }
}

async function mockIntake(page: Page, reports: CapturedReport[]) {
  await page.route('**/api/bug-reports', async (route) => {
    reports.push(route.request().postDataJSON() as CapturedReport)
    await route.fulfill({
      contentType: 'application/json',
      status: 201,
      body: JSON.stringify({
        status: 'created',
        issue: {
          id: 'linear-issue-id',
          identifier: 'ZK-999',
          title: '[Manual] Controlled test',
          url: 'https://linear.app/zkutty/issue/ZK-999',
        },
        occurrenceCount: 1,
      }),
    })
  })
}

test('manual reporter sends only the previewed, consented payload', async ({ page }) => {
  const reports: CapturedReport[] = []
  await mockIntake(page, reports)
  await page.addInitScript(() => {
    localStorage.setItem('m45-private-test', 'must-not-copy-local-storage')
    document.cookie = 'm45_private=must-not-copy-cookie; SameSite=Strict'
  })
  await page.goto('/?private=must-not-copy-query')
  await enterGameThroughQuickStart(page)

  await page.keyboard.press('Alt+Shift+B')
  const dialog = page.getByTestId('bug-report-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Short title').fill('Golfer stops at the green')
  await dialog.getByLabel('What happened?').fill('The golfer stayed idle.')
  await dialog
    .getByLabel('What should have happened?')
    .fill('The golfer should continue.')
  await dialog
    .getByLabel('Reproduction steps — one per line')
    .fill('Quick Start\nAdvance the day')
  await dialog
    .getByLabel('Include the diagnostic capsule previewed below')
    .check()
  await dialog
    .getByLabel('Allow a screenshot of the CourseCraft renderer only')
    .check()
  await dialog.getByRole('button', { name: 'Capture screenshot' }).click()
  await expect(dialog.getByAltText('Screenshot that will be submitted')).toBeVisible()
  await dialog.getByRole('button', { name: 'Submit report' }).click()

  await expect(dialog.getByText('Report received as ZK-999.')).toBeVisible()
  expect(reports).toHaveLength(1)
  expect(reports[0]).toMatchObject({
    consent: { diagnostics: true, screenshot: true },
    source: 'manual',
    summary: { title: 'Golfer stops at the green' },
    screenshot: { mime: 'image/png' },
  })
  expect(reports[0].diagnostics?.route).toBe('/')
  const serialized = JSON.stringify(reports[0])
  expect(serialized).not.toContain('must-not-copy-local-storage')
  expect(serialized).not.toContain('must-not-copy-cookie')
  expect(serialized).not.toContain('must-not-copy-query')
})

test('React crash boundary hands bounded crash context to an opt-in report', async ({
  page,
}) => {
  const reports: CapturedReport[] = []
  await mockIntake(page, reports)
  await page.goto('/?crash-test=react')

  await expect(
    page.getByRole('heading', { name: 'CourseCraft hit an unexpected problem' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Report this crash' }).click()
  const dialog = page.getByTestId('bug-report-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('React crash', { exact: true })).toBeVisible()
  await expect(dialog.getByLabel('Short title')).toHaveValue(
    /M45 controlled React crash/,
  )
  await dialog
    .getByLabel('Reproduction steps — one per line')
    .fill('Open the controlled crash route')
  await dialog
    .getByLabel('Include the diagnostic capsule previewed below')
    .check()
  await dialog.getByRole('button', { name: 'Submit report' }).click()

  await expect(dialog.getByText('Report received as ZK-999.')).toBeVisible()
  expect(reports).toHaveLength(1)
  expect(reports[0].source).toBe('react-crash')
  expect(reports[0].consent).toEqual({
    diagnostics: true,
    screenshot: false,
  })
  expect(reports[0].diagnostics?.error?.message).toContain(
    'M45 controlled React crash',
  )
})
