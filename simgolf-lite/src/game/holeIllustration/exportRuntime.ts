import { platformServices } from "../../platform";
import type { PlatformServices } from "../../platform/types";
import { shareBlob } from "../../utils/photoCapture";
import {
  HOLE_ILLUSTRATION_EXPORT_LIMITS,
  type HoleIllustrationExportArtifact,
} from "./export";

export type HoleIllustrationDeliveryResult =
  | { readonly status: "saved" | "shared" | "copied" | "downloaded"; readonly fileName: string; readonly location?: string }
  | { readonly status: "cancelled" | "failed"; readonly fileName: string; readonly message: string };

export interface HoleIllustrationRasterAdapters {
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly loadImage: (url: string) => Promise<CanvasImageSource>;
  readonly encodeCanvas: (source: CanvasImageSource, width: number, height: number) => Promise<Blob>;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const textEncoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function uint32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = textEncoder.encode(type);
  return concat([uint32(data.length), typeBytes, data, uint32(crc32(concat([typeBytes, data])))]);
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

/** Inserts one deterministic, inspectable, allowlisted CourseCraft tEXt chunk after IHDR. */
export function injectCourseCraftPngMetadata(png: Uint8Array, metadata: HoleIllustrationExportArtifact["metadata"]): Uint8Array {
  if (png.length < 33 || !PNG_SIGNATURE.every((value, index) => png[index] === value)) throw new Error("PNG encoding did not produce a valid signature.");
  const ihdrLength = readUint32(png, 8);
  const ihdrEnd = 8 + 12 + ihdrLength;
  if (ihdrLength !== 13 || ihdrEnd > png.length || new TextDecoder().decode(png.slice(12, 16)) !== "IHDR") throw new Error("PNG encoding did not produce a valid IHDR chunk.");
  const safeJson = JSON.stringify(metadata).replace(/[\u007f-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const text = textEncoder.encode(`CourseCraft\0${safeJson}`);
  const result = concat([png.slice(0, ihdrEnd), chunk("tEXt", text), png.slice(ihdrEnd)]);
  if (result.length > HOLE_ILLUSTRATION_EXPORT_LIMITS.maxPngBytes) throw new Error("The encoded PNG exceeds the 24 MiB desktop limit.");
  return result;
}

const browserAdapters: HoleIllustrationRasterAdapters = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  loadImage: (url) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The SVG could not be decoded for PNG export."));
    image.src = url;
  }),
  encodeCanvas: (source, width, height) => new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) { reject(new Error("Canvas is unavailable for PNG export.")); return; }
    context.drawImage(source, 0, 0, width, height);
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG encoding failed.")), "image/png");
  }),
};

export async function rasterizeHoleIllustrationPng(
  artifact: HoleIllustrationExportArtifact,
  adapters: HoleIllustrationRasterAdapters = browserAdapters,
): Promise<Blob> {
  if (!Number.isInteger(artifact.width) || !Number.isInteger(artifact.height) || artifact.width < 1 || artifact.height < 1
    || artifact.width * artifact.height > HOLE_ILLUSTRATION_EXPORT_LIMITS.maxRasterPixels) throw new Error("The requested PNG exceeds the supported pixel limit.");
  const source = new Blob([artifact.svg], { type: "image/svg+xml" });
  const url = adapters.createObjectURL(source);
  try {
    const image = await adapters.loadImage(url);
    const encoded = await adapters.encodeCanvas(image, artifact.width, artifact.height);
    if (encoded.type !== "image/png" || encoded.size === 0) throw new Error("PNG encoding returned an invalid image.");
    if (encoded.size > HOLE_ILLUSTRATION_EXPORT_LIMITS.maxPngBytes) throw new Error("The encoded PNG exceeds the 24 MiB desktop limit.");
    const encodedBytes = new Uint8Array(await encoded.arrayBuffer());
    if (readUint32(encodedBytes, 16) !== artifact.width || readUint32(encodedBytes, 20) !== artifact.height) {
      throw new Error("PNG encoding returned dimensions that do not match the export artifact.");
    }
    const withMetadata = injectCourseCraftPngMetadata(encodedBytes, artifact.metadata);
    return new Blob([Uint8Array.from(withMetadata).buffer], { type: "image/png" });
  } finally {
    adapters.revokeObjectURL(url);
  }
}

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("PNG data encoding failed."));
    reader.onerror = () => reject(reader.error ?? new Error("PNG data encoding failed."));
    reader.readAsDataURL(blob);
  });
}

export async function deliverHoleIllustrationSvg(
  artifact: HoleIllustrationExportArtifact,
  platform: PlatformServices = platformServices,
): Promise<HoleIllustrationDeliveryResult> {
  const fileName = `${artifact.fileStem}.svg`;
  try {
    const saved = await platform.files.chooseExport(fileName, artifact.svg, "image/svg+xml");
    return saved ? { status: "saved", fileName } : { status: "cancelled", fileName, message: "SVG export was cancelled." };
  } catch (error) {
    return { status: "failed", fileName, message: error instanceof Error ? error.message : "SVG export failed." };
  }
}

export async function deliverHoleIllustrationPng(
  artifact: HoleIllustrationExportArtifact,
  options: { platform?: PlatformServices; share?: boolean; adapters?: HoleIllustrationRasterAdapters; shareFile?: typeof shareBlob; toDataUrl?: (blob: Blob) => Promise<string> } = {},
): Promise<HoleIllustrationDeliveryResult> {
  const fileName = `${artifact.fileStem}.png`;
  try {
    const png = await rasterizeHoleIllustrationPng(artifact, options.adapters);
    if (options.share) {
      const shared = await (options.shareFile ?? shareBlob)(png, fileName, artifact.metadata.layoutName);
      return { status: shared, fileName };
    }
    const dataUrl = await (options.toDataUrl ?? blobDataUrl)(png);
    if (dataUrl.length > HOLE_ILLUSTRATION_EXPORT_LIMITS.maxDataUrlCharacters) throw new Error("The PNG data URL exceeds the desktop bridge limit.");
    const location = await (options.platform ?? platformServices).screenshots.save(dataUrl, fileName);
    return location ? { status: "saved", fileName, location } : { status: "cancelled", fileName, message: "PNG export was cancelled." };
  } catch (error) {
    return { status: "failed", fileName, message: error instanceof Error ? error.message : "PNG export failed." };
  }
}
