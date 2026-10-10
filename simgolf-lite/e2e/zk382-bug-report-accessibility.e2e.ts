import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'

const fixture = '/e2e/fixtures/zk382-bug-report.html'
const successBody = {
  status: 'created', occurrenceCount: 1,
  issue: { id: 'fixture-issue-id', identifier: 'ZK-382', title: '[Manual] Fixture report', url: 'https://linear.app/fixture/issue/ZK-382' },
}
const pageErrors = new WeakMap<Page, string[]>()
const intakeState = new WeakMap<Page, { mocked: number; requests: number; status: number }>()
const evidence = new WeakMap<Page, Record<string, unknown>>()
const textSelector = 'h1, .cc-bug-report-kicker, label, input, textarea, select, option, button, legend, .cc-bug-report-privacy, summary, pre, .cc-bug-report-actions > span, .cc-bug-report-selection-copy, [role="alert"], [role="status"], [role="status"] strong, [role="status"] p, [role="status"] a'

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  const intake = { mocked: 0, requests: 0, status: 201 }
  pageErrors.set(page, errors)
  intakeState.set(page, intake)
  evidence.set(page, {})
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    if (request.url().includes('/api/bug-reports')) intake.requests += 1
  })
  // One route owns every submission, including deliberately failed responses.
  await page.route('**/api/bug-reports', async (route) => {
    intake.mocked += 1
    await route.fulfill({ contentType: 'application/json', status: intake.status,
      body: JSON.stringify(intake.status === 201 ? successBody : { error: 'fixture unavailable' }) })
  })
})

test.afterEach(async ({ page }, testInfo) => {
  const intake = intakeState.get(page)!
  await record(testInfo, 'measurements', { ...evidence.get(page), intake, pageErrors: pageErrors.get(page) })
  expect(pageErrors.get(page)).toEqual([])
  expect(intake.requests).toBe(intake.mocked)
})

async function record(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, { body: JSON.stringify(value, null, 2), contentType: 'application/json' })
}

async function open(page: Page, locale: 'en' | 'pseudo') {
  await page.goto(fixture)
  if (locale === 'pseudo') await page.getByRole('button', { name: 'Pseudo locale' }).click()
  const launcher = page.getByRole('button', { name: 'Open bug report', exact: true })
  await launcher.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByTestId('bug-report-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toHaveAccessibleName(await dialog.getByRole('heading').innerText())
  await expect(dialog.locator('form > label > input')).toBeFocused()
  return { dialog, launcher }
}

async function labels(dialog: Locator) {
  const controls = dialog.locator('input, textarea, select')
  const names: string[] = []
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index)
    const name = await control.evaluate((item) => {
      const field = item as HTMLInputElement
      return [...field.labels ?? []].map((label) => [...label.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('').trim()).join(' ')
    })
    expect(name).not.toBe('')
    await expect(control).toHaveAccessibleName(name)
    names.push(name)
  }
  return names
}

async function fill(dialog: Locator) {
  await dialog.locator('form > label > input').fill('Fixture report — complete copy and native scrolling')
  await dialog.locator('textarea').nth(0).fill(Array.from({ length: 30 }, (_, index) => `Observed line ${index + 1}: the control remained open.`).join('\n'))
  await dialog.locator('textarea').nth(1).fill('The control should close and restore the launcher.')
  await dialog.locator('textarea').nth(2).fill('Open the report\nRead the content\nClose the report')
}

async function measureTextSizes(dialog: Locator, rootSize: number) {
  await dialog.page().evaluate((size) => { document.documentElement.style.fontSize = `${size}px` }, rootSize)
  return dialog.locator(textSelector).evaluateAll((items) => items.map((item, index) => ({
    index, tag: item.tagName, text: item.getAttribute('aria-label') ?? item.textContent?.trim().slice(0, 50),
    size: Number.parseFloat(getComputedStyle(item).fontSize),
  })))
}

function expectScale(base: Awaited<ReturnType<typeof measureTextSizes>>, enlarged: Awaited<ReturnType<typeof measureTextSizes>>) {
  expect(enlarged.length).toBe(base.length)
  expect(base.length).toBeGreaterThan(20)
  return base.map((item, index) => {
    expect(enlarged[index].tag).toBe(item.tag)
    const ratio = enlarged[index].size / item.size
    expect(Math.abs(ratio - 1.3), `${item.tag} ${item.text} font scale`).toBeLessThanOrEqual(.01)
    return { ...item, enlarged: enlarged[index].size, ratio }
  })
}

async function paintedContrast(dialog: Locator) {
  const measured = await dialog.locator(textSelector).evaluateAll((items) => {
    const rgba = (color: string) => color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]
    const blend = (front: number[], back: number[]) => {
      const alpha = front[3] ?? 1
      return front.slice(0, 3).map((channel, index) => channel * alpha + back[index] * (1 - alpha))
    }
    return items.filter((item) => !item.matches(':disabled, option, input[type="checkbox"]')
      && item.getClientRects().length > 0).map((item) => {
      const ancestors: Element[] = []
      for (let parent: Element | null = item; parent; parent = parent.parentElement) ancestors.push(parent)
      let background = [255, 255, 255]
      for (const parent of ancestors.reverse()) background = blend(rgba(getComputedStyle(parent).backgroundColor), background)
      const style = getComputedStyle(item)
      const foreground = blend(rgba(style.color), background)
      return { tag: item.tagName, text: item.textContent?.trim().slice(0, 50), color: foreground, background }
    })
  })
  return measured.map((item) => {
    const ratio = contrast(item.color, item.background)
    expect(ratio, `${item.tag} ${item.text} actual painted contrast`).toBeGreaterThanOrEqual(4.5)
    return { ...item, ratio }
  })
}

// Check each painted text fragment separately after scrolling its owning dialog.
// Large paragraphs can exceed a mobile panel; every line must still be reachable.
async function completeCopy(dialog: Locator) {
  const fragments = await dialog.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const result: { node: number; fragment: number; text: string }[] = []
    let ordinal = 0
    for (let node = walker.nextNode(); node; node = walker.nextNode(), ordinal += 1) {
      const parent = node.parentElement!
      if (!node.textContent?.trim() || parent.closest('pre, option, svg') || !parent.getClientRects().length) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      Array.from(range.getClientRects()).forEach((_, fragment) => result.push({ node: ordinal, fragment, text: node.textContent!.trim().slice(0, 50) }))
    }
    return result
  })
  expect(fragments.length).toBeGreaterThan(0)
  const reached: unknown[] = []
  for (const fragment of fragments) {
    const box = await dialog.evaluate((element, target) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      for (let index = 0; index < target.node; index += 1) node = walker.nextNode()
      const range = document.createRange()
      range.selectNodeContents(node!)
      let rect = range.getClientRects()[target.fragment]
      const panel = element.getBoundingClientRect()
      element.scrollTop += rect.top - panel.top - 20
      rect = range.getClientRects()[target.fragment]
      return { text: target.text, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        panelLeft: panel.left, panelRight: panel.right, panelTop: panel.top, panelBottom: panel.bottom }
    }, fragment)
    expect(box.left, box.text).toBeGreaterThanOrEqual(box.panelLeft)
    expect(box.right, box.text).toBeLessThanOrEqual(box.panelRight)
    expect(box.top, box.text).toBeGreaterThanOrEqual(box.panelTop)
    expect(box.bottom, box.text).toBeLessThanOrEqual(box.panelBottom)
    reached.push(box)
  }
  return reached
}

async function controlsReachable(dialog: Locator) {
  const controls = dialog.locator('input, textarea, select, button, summary, a[href]')
  const reached = []
  for (let index = 0; index < await controls.count(); index += 1) {
    const control = controls.nth(index)
    await control.evaluate((item) => item.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
    const box = await control.evaluate((item) => {
      const rect = item.getBoundingClientRect()
      const panel = item.closest('[role="dialog"]')!.getBoundingClientRect()
      return { tag: item.tagName, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        panelLeft: panel.left, panelRight: panel.right, panelTop: panel.top, panelBottom: panel.bottom }
    })
    expect(box.left).toBeGreaterThanOrEqual(box.panelLeft)
    expect(box.right).toBeLessThanOrEqual(box.panelRight)
    expect(box.top).toBeGreaterThanOrEqual(box.panelTop)
    expect(box.bottom).toBeLessThanOrEqual(box.panelBottom)
    reached.push(box)
  }
  return reached
}

async function nativeScroll(page: Page, target: Locator) {
  await target.evaluate((item) => item.scrollIntoView({ block: 'center' }))
  const before = await target.evaluate((item) => ({ scrollTop: item.scrollTop, clientHeight: item.clientHeight, scrollHeight: item.scrollHeight,
    clientWidth: item.clientWidth, scrollWidth: item.scrollWidth, overflowY: getComputedStyle(item).overflowY, overflowWrap: getComputedStyle(item).overflowWrap,
    value: item instanceof HTMLTextAreaElement ? item.value : null }))
  expect(before.scrollHeight).toBeGreaterThan(before.clientHeight)
  expect(before.scrollWidth).toBeLessThanOrEqual(before.clientWidth)
  await target.hover()
  await page.mouse.wheel(0, -before.scrollHeight * 2)
  await expect.poll(() => target.evaluate((item) => item.scrollTop)).toBe(0)
  // Overscroll at the native start can move the parent panel underneath the pointer.
  await target.evaluate((item) => item.scrollIntoView({ block: 'center' }))
  await target.hover()
  await page.mouse.wheel(0, before.scrollHeight * 2)
  await expect.poll(() => target.evaluate((item) => item.scrollTop + item.clientHeight >= item.scrollHeight - 1)).toBe(true)
  const after = await target.evaluate((item) => {
    const rect = item.getBoundingClientRect()
    const range = document.createRange()
    const last = item.lastChild
    if (last?.nodeType === Node.TEXT_NODE) {
      range.setStart(last, Math.max(0, (last.textContent?.length ?? 1) - 1))
      range.setEnd(last, last.textContent?.length ?? 0)
    }
    const end = range.getBoundingClientRect()
    return { scrollTop: item.scrollTop, bottom: end.bottom, top: end.top, viewportTop: rect.top, viewportBottom: rect.bottom,
      value: item instanceof HTMLTextAreaElement ? item.value : null,
      selectionEnd: item instanceof HTMLTextAreaElement ? item.selectionEnd : null }
  })
  expect(after.scrollTop).toBeGreaterThan(0)
  if (before.value !== null) {
    expect(after.value).toBe(before.value)
    expect(after.selectionEnd).toBe(before.value.length)
  }
  if (await target.evaluate((item) => item.tagName === 'PRE')) {
    expect(after.top).toBeGreaterThanOrEqual(after.viewportTop)
    expect(after.bottom).toBeLessThanOrEqual(after.viewportBottom)
  }
  return { before, after, method: 'native mouse wheel to both ends' }
}

test('bug report text scales with root size and stays contained in English and pseudo at target viewports', async ({ page }, testInfo) => {
  const results = []
  for (const locale of ['en', 'pseudo'] as const) {
    for (const viewport of [{ width: 320, height: 640 }, { width: 768, height: 800 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport)
      const { dialog } = await open(page, locale)
      const associatedNames = await labels(dialog)
      await fill(dialog)
      await dialog.locator('details > summary').nth(0).click()
      await dialog.locator('details > summary').nth(1).click()
      const fonts = expectScale(await measureTextSizes(dialog, 16), await measureTextSizes(dialog, 20.8))
      expect(fonts.some((item) => item.tag === 'OPTION')).toBe(true)
      const selected = []
      for (const value of ['low', 'medium', 'high', 'critical']) {
        await dialog.locator('select').selectOption(value)
        const option = await dialog.locator('select option:checked').textContent()
        const copy = dialog.getByTestId('bug-report-severity-copy')
        await expect(copy).toHaveText(option!)
        await expect(copy).toHaveAttribute('aria-hidden', 'true')
        await expect(dialog.locator('select')).toHaveValue(value)
        selected.push({ value, copy: option })
      }
      let captured = null
      if (viewport.width === 320 && locale === 'pseudo') {
        // Supply a real painted DOM canvas; the production capture function re-encodes it.
        await page.evaluate(() => {
          const canvas = document.createElement('canvas')
          canvas.width = 320; canvas.height = 640
          const context = canvas.getContext('2d')!
          context.fillStyle = '#3b6044'; context.fillRect(0, 0, 320, 640)
          context.fillStyle = '#fffaf0'; context.font = '20px sans-serif'
          context.fillText('ZK-382 native capture fixture', 10, 60)
          context.fillStyle = '#caa663'; context.fillRect(24, 100, 180, 220)
          document.querySelector('#root')!.append(canvas)
        })
        await dialog.locator('input[type="checkbox"]').nth(1).check()
        const captureFonts = expectScale(await measureTextSizes(dialog, 16), await measureTextSizes(dialog, 20.8))
        const captureContrast = await paintedContrast(dialog)
        await dialog.locator('.cc-bug-report-screenshot button').click()
        const image = dialog.locator('.cc-bug-report-screenshot img')
        await expect(image).toBeVisible()
        captured = await image.evaluate((item) => {
          const img = item as HTMLImageElement
          const rect = img.getBoundingClientRect()
          const panel = img.closest('[role="dialog"]')!.getBoundingClientRect()
          return { src: img.src.slice(0, 30), width: img.naturalWidth, height: img.naturalHeight,
            paintedWidth: rect.width, right: rect.right, panelRight: panel.right }
        })
        expect(captured.src).toMatch(/^data:image\/png;base64,/)
        expect(captured.width).toBe(320); expect(captured.height).toBe(640)
        expect(captured.right).toBeLessThanOrEqual(captured.panelRight)
        const removeFonts = expectScale(await measureTextSizes(dialog, 16), await measureTextSizes(dialog, 20.8))
        const removeContrast = await paintedContrast(dialog)
        evidence.get(page)!.captureControls = { captureFonts, captureContrast, removeFonts, removeContrast }
        await image.evaluate((item) => item.scrollIntoView({ block: 'center' }))
        await dialog.screenshot({ path: testInfo.outputPath('capture-320-pseudo-130pct.png') })
      }
      const layout = await dialog.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
        documentWidth: document.documentElement.scrollWidth, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right }))
      expect(layout.left).toBeGreaterThanOrEqual(0); expect(layout.right).toBeLessThanOrEqual(viewport.width)
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
      expect(layout.documentWidth).toBeLessThanOrEqual(viewport.width)
      const copy = await completeCopy(dialog)
      const controls = await controlsReachable(dialog)
      const jsonScroll = []
      for (let index = 0; index < 2; index += 1) {
        const pre = dialog.locator('pre').nth(index)
        await expect(dialog.locator('details').nth(index)).toHaveAttribute('open', '')
        const proof = await nativeScroll(page, pre)
        expect(proof.before.overflowY).toBe('auto')
        expect(proof.before.overflowWrap).toBe('anywhere')
        expect(JSON.parse(await pre.innerText())).toBeTruthy()
        jsonScroll.push(proof)
      }
      const textarea = await nativeScroll(page, dialog.locator('textarea').first())
      const contrasts = await paintedContrast(dialog)
      if (viewport.width === 320 && locale === 'pseudo') {
        await dialog.evaluate((element) => { element.scrollTop = 0 })
        await dialog.screenshot({ path: testInfo.outputPath('form-320-pseudo-130pct.png') })
        await dialog.locator('.cc-bug-report-screenshot button').click()
        await expect(dialog.locator('.cc-bug-report-screenshot img')).toHaveCount(0)
        await expect(dialog.locator('input[type="checkbox"]').nth(1)).toBeChecked()
        await expect(dialog.locator('input[type="checkbox"]').first()).not.toBeChecked()
      }
      results.push({ locale, viewport, associatedNames, fonts, selected, captured, layout, copy, controls, jsonScroll, textarea, contrasts })
      evidence.get(page)!.matrix = results
      await dialog.locator('.cc-bug-report-header button').click()
      await expect(dialog).toBeHidden()
    }
  }
})

test('keyboard focus reaches every control, remains trapped, and close restores the launcher', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 })
  const { dialog, launcher } = await open(page, 'pseudo')
  await measureTextSizes(dialog, 20.8)
  const associatedNames = await labels(dialog)
  await fill(dialog)
  // Filling scrolled the form; reestablish the original first-field focus.
  await dialog.locator('form > label > input').focus()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.locator('.cc-bug-report-header button')).toBeFocused()
  const selector = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href]'
  const sequence = await dialog.locator(selector).evaluateAll((items) => items.map((item, index) => ({ index, tag: item.tagName })))
  expect(sequence.length).toBeGreaterThan(5)
  const focused = []
  for (let index = 0; index < sequence.length; index += 1) {
    const ring = await page.evaluate(() => {
      const item = document.activeElement as HTMLElement
      const owned = [...item.closest('[role="dialog"]')!.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, a[href]')]
      const style = getComputedStyle(item)
      const rect = item.getBoundingClientRect()
      const panel = item.closest('[role="dialog"]')!.getBoundingClientRect()
      const rgba = (color: string) => color.match(/[\d.]+/g)!.map(Number)
      const ancestors = []
      for (let parent = item.parentElement; parent; parent = parent.parentElement) ancestors.push(parent)
      let background = [255, 255, 255]
      for (const parent of ancestors.reverse()) {
        const color = rgba(getComputedStyle(parent).backgroundColor)
        const alpha = color[3] ?? 1
        background = color.slice(0, 3).map((channel, position) => channel * alpha + background[position] * (1 - alpha))
      }
      const band = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset)
      const clippedBy = []
      for (let parent = item.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const parentStyle = getComputedStyle(parent)
        const bounds = parent.getBoundingClientRect()
        if (parentStyle.overflowX !== 'visible' && (rect.left - band < bounds.left || rect.right + band > bounds.right)) clippedBy.push(`${parent.tagName}:x`)
        if (parentStyle.overflowY !== 'visible' && (rect.top - band < bounds.top || rect.bottom + band > bounds.bottom)) clippedBy.push(`${parent.tagName}:y`)
      }
      return { index: owned.indexOf(item), tag: item.tagName, name: item.getAttribute('aria-label') ?? item.textContent?.trim().slice(0, 50),
        visible: item.matches(':focus-visible'), width: style.outlineWidth, offset: style.outlineOffset, style: style.outlineStyle,
        color: rgba(style.outlineColor).slice(0, 3), background, clippedBy,
        withinPanel: rect.left - band >= panel.left && rect.right + band <= panel.right && rect.top - band >= panel.top && rect.bottom + band <= panel.bottom }
    })
    expect({ index: ring.index, tag: ring.tag }).toEqual(sequence[index])
    expect(ring.visible).toBe(true)
    expect(ring.style).toBe('solid'); expect(ring.width).toBe('3px'); expect(ring.offset).toBe('2px')
    expect(ring.withinPanel).toBe(true); expect(ring.clippedBy).toEqual([])
    const ratio = contrast(ring.color, ring.background)
    expect(ratio).toBeGreaterThanOrEqual(3)
    focused.push({ ...ring, ratio })
    if (index === 0) await dialog.screenshot({ path: testInfo.outputPath('focus-320-pseudo-130pct.png') })
    await page.keyboard.press('Tab')
  }
  await expect(dialog.locator('.cc-bug-report-header button')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.locator('button[type="submit"]')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.locator('.cc-bug-report-header button')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden(); await expect(launcher).toBeFocused()
  await expect(page.getByTestId('close-count')).toHaveText('1')
  await launcher.click()
  await expect(dialog).toBeVisible()
  await dialog.locator('.cc-bug-report-header button').click()
  await expect(dialog).toBeHidden(); await expect(launcher).toBeFocused()
  await expect(page.getByTestId('close-count')).toHaveText('2')
  evidence.get(page)!.keyboard = { associatedNames, sequence, focused, forwardWrap: true, reverseWrap: true, escapeRestored: true, closeRestored: true, closeCount: 2 }
})

test('visible report copy keeps readable contrast and error/success text scales', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 })
  const { dialog } = await open(page, 'pseudo')
  await labels(dialog)
  await fill(dialog)
  intakeState.get(page)!.status = 500
  await dialog.locator('button[type="submit"]').click()
  await expect(dialog.getByRole('alert')).toBeVisible()
  const errorFonts = expectScale(await measureTextSizes(dialog, 16), await measureTextSizes(dialog, 20.8))
  const alertCopy = await dialog.getByRole('alert').innerText()
  expect(alertCopy).not.toBe('')
  expect(errorFonts.some((item) => item.tag === 'P' && item.text === alertCopy)).toBe(true)
  const errorContrast = await paintedContrast(dialog)
  const errorCopy = await completeCopy(dialog)
  const errorControls = await controlsReachable(dialog)
  await dialog.getByRole('alert').evaluate((item) => item.scrollIntoView({ block: 'center' }))
  await dialog.screenshot({ path: testInfo.outputPath('error-320-pseudo-130pct.png') })
  intakeState.get(page)!.status = 201
  await dialog.locator('button[type="submit"]').click()
  await expect(dialog.getByRole('status')).toBeVisible()
  // The success branch has fewer targets; measure both sizes within that branch.
  const successBase = await measureTextSizes(dialog, 16)
  const successEnlarged = await measureTextSizes(dialog, 20.8)
  expect(successBase.length).toBe(successEnlarged.length)
  const successFonts = successBase.map((item, index) => {
    const ratio = successEnlarged[index].size / item.size
    expect(Math.abs(ratio - 1.3), `${item.tag} success font scale`).toBeLessThanOrEqual(.01)
    return { ...item, enlarged: successEnlarged[index].size, ratio }
  })
  for (const tag of ['STRONG', 'P', 'A', 'BUTTON']) expect(successFonts.some((item) => item.tag === tag)).toBe(true)
  const successContrast = await paintedContrast(dialog)
  const successCopy = await completeCopy(dialog)
  const successControls = await controlsReachable(dialog)
  await dialog.evaluate((item) => { item.scrollTop = 0 })
  await dialog.screenshot({ path: testInfo.outputPath('success-320-pseudo-130pct.png') })
  evidence.get(page)!.states = { errorFonts, errorContrast, errorCopy, errorControls, successFonts, successContrast, successCopy, successControls }
  expect(intakeState.get(page)!.requests).toBe(2)
})

function contrast(foreground: number[], background: number[]): number {
  const luminance = (color: number[]) => {
    const [r, g, b] = color.slice(0, 3).map((channel) => {
      const value = channel / 255
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
    })
    return .2126 * r + .7152 * g + .0722 * b
  }
  const a = luminance(foreground); const b = luminance(background)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}
