import { BUG_REPORT_LIMITS, type BugReportScreenshot } from './contracts'

function imageBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',', 2)[1] ?? ''
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(base64.length * 3 / 4) - padding)
}

function applicationCanvas(): HTMLCanvasElement | null {
  const canvases = [...document.querySelectorAll<HTMLCanvasElement>('#root canvas')]
    .filter((canvas) => canvas.width > 1 && canvas.height > 1)
  return canvases.sort(
    (left, right) => right.width * right.height - left.width * left.height,
  )[0] ?? null
}

/**
 * Captures only the renderer canvas that belongs to #root. Drawing it into a
 * fresh canvas re-encodes the image and drops source metadata.
 */
export async function captureApplicationScreenshot(): Promise<BugReportScreenshot> {
  const source = applicationCanvas()
  if (!source) throw new Error('The application view is not available to capture.')

  const scale = Math.min(
    1,
    BUG_REPORT_LIMITS.screenshotWidth / source.width,
    BUG_REPORT_LIMITS.screenshotHeight / source.height,
  )
  const width = Math.max(1, Math.floor(source.width * scale))
  const height = Math.max(1, Math.floor(source.height * scale))
  const target = document.createElement('canvas')
  target.width = width
  target.height = height
  const context = target.getContext('2d', { alpha: false })
  if (!context) throw new Error('Screenshot capture is not supported by this browser.')
  context.fillStyle = '#25382d'
  context.fillRect(0, 0, width, height)
  context.drawImage(source, 0, 0, width, height)
  const dataUrl = target.toDataURL('image/png')
  const bytes = imageBytes(dataUrl)
  if (bytes > BUG_REPORT_LIMITS.screenshotBytes) {
    throw new Error('The screenshot is too large. Zoom out or submit without it.')
  }
  return { bytes, dataUrl, height, mime: 'image/png', width }
}
