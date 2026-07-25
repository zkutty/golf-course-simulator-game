import { describe, expect, it } from 'vitest'
import { validatePngEvidence } from './evidence'

const onePixelPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg=='

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function pngWithChunk(typeName: string, data: Uint8Array): Uint8Array {
  const original = Uint8Array.from(atob(onePixelPng), (value) => value.charCodeAt(0))
  const type = new TextEncoder().encode(typeName)
  const chunk = new Uint8Array(12 + data.byteLength)
  new DataView(chunk.buffer).setUint32(0, data.byteLength)
  chunk.set(type, 4)
  chunk.set(data, 8)
  new DataView(chunk.buffer).setUint32(8 + data.byteLength, crc32(chunk.subarray(4, 8 + data.byteLength)))
  const insertion = 8 + 12 + 13
  const result = new Uint8Array(original.byteLength + chunk.byteLength)
  result.set(original.subarray(0, insertion))
  result.set(chunk, insertion)
  result.set(original.subarray(insertion), insertion + chunk.byteLength)
  return result
}

function metadataPng(): Uint8Array {
  return pngWithChunk(
    'tEXt',
    new TextEncoder().encode('Author\0Private Player Name'),
  )
}

function dataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`
}

describe('validatePngEvidence', () => {
  it('accepts a size- and dimension-matched PNG', () => {
    const result = validatePngEvidence({
      bytes: 70,
      dataUrl: `data:image/png;base64,${onePixelPng}`,
      height: 1,
      mime: 'image/png',
      width: 1,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.strippedChunks).toEqual([])
    expect(result.screenshot.bytes).toBe(70)
  })

  it('rebuilds the PNG without metadata or trailing bytes', () => {
    const withMetadata = metadataPng()
    const withTrailingBytes = new Uint8Array(withMetadata.byteLength + 4)
    withTrailingBytes.set(withMetadata)
    withTrailingBytes.set([1, 2, 3, 4], withMetadata.byteLength)

    const result = validatePngEvidence({
      bytes: withTrailingBytes.byteLength,
      dataUrl: dataUrl(withTrailingBytes),
      height: 1,
      mime: 'image/png',
      width: 1,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.strippedChunks).toEqual(['tEXt'])
    expect(result.screenshot.bytes).toBe(70)
    expect(result.screenshot.dataUrl).not.toContain('Private')
  })

  it('rejects spoofed content and mismatched IHDR dimensions', () => {
    expect(
      validatePngEvidence({
        bytes: 4,
        dataUrl: 'data:image/png;base64,AAAAAA==',
        height: 1,
        mime: 'image/png',
        width: 1,
      }).ok,
    ).toBe(false)

    expect(
      validatePngEvidence({
        bytes: 70,
        dataUrl: `data:image/png;base64,${onePixelPng}`,
        height: 2,
        mime: 'image/png',
        width: 1,
      }).ok,
    ).toBe(false)
  })

  it('rejects animation, unknown critical chunks, and checksum tampering', () => {
    const animationControl = new Uint8Array(8)
    new DataView(animationControl.buffer).setUint32(0, 2)
    const animated = pngWithChunk('acTL', animationControl)
    expect(
      validatePngEvidence({
        bytes: animated.byteLength,
        dataUrl: dataUrl(animated),
        height: 1,
        mime: 'image/png',
        width: 1,
      }).ok,
    ).toBe(false)

    const critical = pngWithChunk('ABCD', new Uint8Array([1]))
    expect(
      validatePngEvidence({
        bytes: critical.byteLength,
        dataUrl: dataUrl(critical),
        height: 1,
        mime: 'image/png',
        width: 1,
      }).ok,
    ).toBe(false)

    const tampered = Uint8Array.from(
      atob(onePixelPng),
      (value) => value.charCodeAt(0),
    )
    tampered[25] ^= 1
    expect(
      validatePngEvidence({
        bytes: tampered.byteLength,
        dataUrl: dataUrl(tampered),
        height: 1,
        mime: 'image/png',
        width: 1,
      }).ok,
    ).toBe(false)
  })
})
