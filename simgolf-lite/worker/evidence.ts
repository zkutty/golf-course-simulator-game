import {
  BUG_REPORT_LIMITS,
  type BugReportScreenshot,
} from '../src/bug-reporting/contracts'

export type EvidenceValidationResult =
  | {
      ok: true
      bytes: Uint8Array
      screenshot: BugReportScreenshot
      strippedChunks: string[]
    }
  | { ok: false; reason: string }

const pngPrefix = 'data:image/png;base64,'
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const retainedChunkTypes = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND'])
const rejectedAnimationChunkTypes = new Set(['acTL', 'fcTL', 'fdAT'])

function decodeBase64(value: string): Uint8Array | undefined {
  try {
    const decoded = atob(value)
    const bytes = new Uint8Array(decoded.length)
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index)
    }
    return bytes
  } catch {
    return undefined
  }
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  )
}

function chunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  )
}

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function concatenate(parts: Uint8Array[], totalBytes: number): Uint8Array {
  const result = new Uint8Array(totalBytes)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function encodeBase64(bytes: Uint8Array): string {
  const pieces: string[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += 8_192) {
    pieces.push(
      String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 8_192, bytes.byteLength))),
    )
  }
  return btoa(pieces.join(''))
}

/**
 * Verify the PNG independently of client metadata, then rebuild it from only
 * rendering-critical chunks. Text, EXIF, profiles, timestamps, and bytes after
 * IEND never cross into Linear.
 */
export function validatePngEvidence(
  screenshot: BugReportScreenshot,
): EvidenceValidationResult {
  if (
    screenshot.width < 1 ||
    screenshot.width > BUG_REPORT_LIMITS.screenshotWidth ||
    screenshot.height < 1 ||
    screenshot.height > BUG_REPORT_LIMITS.screenshotHeight ||
    screenshot.bytes < 1 ||
    screenshot.bytes > BUG_REPORT_LIMITS.screenshotBytes ||
    !screenshot.dataUrl.startsWith(pngPrefix)
  ) {
    return { ok: false, reason: 'Screenshot metadata exceeds the accepted limits.' }
  }

  const bytes = decodeBase64(screenshot.dataUrl.slice(pngPrefix.length))
  if (!bytes || bytes.byteLength !== screenshot.bytes || bytes.byteLength < 24) {
    return { ok: false, reason: 'Screenshot encoding or declared size is invalid.' }
  }

  if (pngSignature.some((value, index) => bytes[index] !== value)) {
    return { ok: false, reason: 'Screenshot does not have a PNG signature.' }
  }

  const retained: Uint8Array[] = [bytes.slice(0, pngSignature.length)]
  const strippedChunks: string[] = []
  let retainedBytes: number = pngSignature.length
  let offset: number = pngSignature.length
  let sawHeader = false
  let sawImageData = false
  let sawEnd = false

  while (offset < bytes.byteLength) {
    if (offset + 12 > bytes.byteLength) {
      return { ok: false, reason: 'Screenshot has a truncated PNG chunk.' }
    }
    const length = uint32(bytes, offset)
    const end = offset + 12 + length
    if (length > BUG_REPORT_LIMITS.screenshotBytes || end > bytes.byteLength) {
      return { ok: false, reason: 'Screenshot has an invalid PNG chunk length.' }
    }
    const type = chunkType(bytes, offset + 4)
    if (!/^[A-Za-z]{4}$/.test(type)) {
      return { ok: false, reason: 'Screenshot has an invalid PNG chunk type.' }
    }
    if (crc32(bytes, offset + 4, end - 4) !== uint32(bytes, end - 4)) {
      return { ok: false, reason: `Screenshot PNG chunk ${type} failed its checksum.` }
    }
    if (!sawHeader && (type !== 'IHDR' || length !== 13)) {
      return { ok: false, reason: 'Screenshot is missing a valid PNG IHDR chunk.' }
    }
    if (type === 'IHDR') {
      if (sawHeader || offset !== pngSignature.length || length !== 13) {
        return { ok: false, reason: 'Screenshot has an invalid PNG IHDR sequence.' }
      }
      sawHeader = true
      const width = uint32(bytes, offset + 8)
      const height = uint32(bytes, offset + 12)
      if (
        width !== screenshot.width ||
        height !== screenshot.height ||
        width > BUG_REPORT_LIMITS.screenshotWidth ||
        height > BUG_REPORT_LIMITS.screenshotHeight
      ) {
        return { ok: false, reason: 'Screenshot dimensions do not match its PNG header.' }
      }
    } else if (type === 'IDAT') {
      sawImageData = true
    } else if (type === 'IEND') {
      if (length !== 0 || !sawImageData) {
        return { ok: false, reason: 'Screenshot has an invalid PNG IEND sequence.' }
      }
      sawEnd = true
    } else if ((type.charCodeAt(0) & 0x20) === 0) {
      return { ok: false, reason: `Screenshot uses unsupported critical PNG chunk ${type}.` }
    }

    if (rejectedAnimationChunkTypes.has(type)) {
      return { ok: false, reason: 'Animated PNG screenshots are not accepted.' }
    }
    if (retainedChunkTypes.has(type)) {
      const chunk = bytes.slice(offset, end)
      retained.push(chunk)
      retainedBytes += chunk.byteLength
    } else {
      strippedChunks.push(type)
    }
    offset = end
    if (sawEnd) break
  }

  if (!sawHeader || !sawImageData || !sawEnd) {
    return { ok: false, reason: 'Screenshot is not a complete PNG image.' }
  }

  const sanitizedBytes = concatenate(retained, retainedBytes)
  return {
    ok: true,
    bytes: sanitizedBytes,
    screenshot: {
      bytes: sanitizedBytes.byteLength,
      dataUrl: `${pngPrefix}${encodeBase64(sanitizedBytes)}`,
      height: screenshot.height,
      mime: 'image/png',
      width: screenshot.width,
    },
    strippedChunks,
  }
}
