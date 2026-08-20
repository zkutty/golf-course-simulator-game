import { expect, test, type Page } from '@playwright/test'
import { enterGameThroughQuickStart } from './reporter-readiness'

async function fillRequiredReport(page: Page): Promise<void> {
  await page.getByLabel('Short title').fill('Golfer stops near the green')
  await page.getByLabel('What happened?').fill('The golfer remains idle on the fringe.')
  await page
    .getByLabel('What should have happened?')
    .fill('The golfer should walk to the ball.')
  await page
    .getByLabel('Reproduction steps — one per line')
    .fill('Start a quick game\nAdvance the clock\nWatch the first green')
}

test('manual reporter sends only required fields when optional evidence is off', async ({
  page,
}) => {
  let submitted: Record<string, unknown> | undefined
  await page.route('**/api/bug-reports', async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      contentType: 'application/json',
      status: 201,
      body: JSON.stringify({
        status: 'created',
        occurrenceCount: 1,
        issue: {
          id: 'linear-issue-id',
          identifier: 'ZK-999',
          title: '[Manual] Golfer stops near the green',
          url: 'https://linear.app/zkutty/issue/ZK-999',
        },
      }),
    })
  })

  await page.goto('/')
  await page.getByTestId('bug-report-launcher').click()
  const dialog = page.getByTestId('bug-report-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/Saves, identity, cookies/)).toBeVisible()
  await fillRequiredReport(page)
  await dialog.getByRole('button', { name: 'Submit report' }).click()

  await expect(dialog.getByText('Report received as ZK-999.')).toBeVisible()
  expect(submitted).toMatchObject({
    schemaVersion: 1,
    source: 'manual',
    consent: { diagnostics: false, screenshot: false },
  })
  expect(submitted).not.toHaveProperty('diagnostics')
  expect(submitted).not.toHaveProperty('screenshot')
  expect(JSON.stringify(submitted)).not.toContain('localStorage')
})

test('diagnostics and renderer screenshot require separate explicit consent', async ({
  page,
}) => {
  let submitted: Record<string, unknown> | undefined
  await page.route('**/api/bug-reports', async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({
      contentType: 'application/json',
      status: 200,
      body: JSON.stringify({
        status: 'duplicate',
        occurrenceCount: 2,
        issue: {
          id: 'linear-issue-id',
          identifier: 'ZK-999',
          title: '[Manual] Golfer stops near the green',
          url: 'https://linear.app/zkutty/issue/ZK-999',
        },
      }),
    })
  })

  await page.goto('/')
  await enterGameThroughQuickStart(page)

  await page.getByTestId('bug-report-launcher').click()
  const dialog = page.getByTestId('bug-report-dialog')
  await fillRequiredReport(page)
  await dialog
    .getByLabel('Include the diagnostic capsule previewed below')
    .check()
  await dialog
    .getByLabel('Allow a screenshot of the CourseCraft renderer only')
    .check()
  await dialog.getByRole('button', { name: 'Capture screenshot' }).click()
  await expect(
    dialog.getByAltText('Screenshot that will be submitted'),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Submit report' }).click()

  await expect(dialog.getByText(/occurrence 2/)).toBeVisible()
  expect(submitted).toMatchObject({
    consent: { diagnostics: true, screenshot: true },
    diagnostics: {
      app: expect.objectContaining({ environment: 'e2e' }),
    },
    screenshot: {
      mime: 'image/png',
    },
  })
  expect(JSON.stringify(submitted)).not.toContain('founderName')
  expect(JSON.stringify(submitted)).not.toContain('course.tiles')
})

test('keyboard close restores focus to the launcher', async ({ page }) => {
  await page.goto('/')
  const launcher = page.getByTestId('bug-report-launcher')
  await launcher.focus()
  await page.keyboard.press('Enter')

  const dialog = page.getByTestId('bug-report-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Short title')).toBeFocused()
  await page.keyboard.press('Escape')

  await expect(dialog).toBeHidden()
  await expect(launcher).toBeFocused()
})

test('canceling an in-flight submission keeps one report ID for a safe retry', async ({
  page,
}) => {
  const reportIds: string[] = []
  let releaseFirst: (() => void) | undefined
  const firstRequestGate = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  await page.route('**/api/bug-reports', async (route) => {
    const body = route.request().postDataJSON() as { reportId: string }
    reportIds.push(body.reportId)
    if (reportIds.length === 1) await firstRequestGate
    await route.fulfill({
      contentType: 'application/json',
      status: 201,
      body: JSON.stringify({
        status: 'created',
        occurrenceCount: 1,
        issue: {
          id: 'linear-issue-id',
          identifier: 'ZK-999',
          title: '[Manual] Golfer stops near the green',
          url: 'https://linear.app/zkutty/issue/ZK-999',
        },
      }),
    }).catch(() => undefined)
  })

  await page.goto('/')
  await page.getByTestId('bug-report-launcher').click()
  const dialog = page.getByTestId('bug-report-dialog')
  await fillRequiredReport(page)
  await dialog.getByRole('button', { name: 'Submit report' }).click()
  await dialog.getByRole('button', { name: 'Cancel submission' }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Submission canceled.')

  releaseFirst?.()
  await dialog.getByRole('button', { name: 'Submit report' }).click()
  await expect(dialog.getByText('Report received as ZK-999.')).toBeVisible()
  expect(reportIds).toHaveLength(2)
  expect(reportIds[1]).toBe(reportIds[0])
})
