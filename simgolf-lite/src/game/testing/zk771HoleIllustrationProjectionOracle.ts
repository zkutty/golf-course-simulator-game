import { DOMParser } from "@xmldom/xmldom";
import type { HoleIllustrationLocalPoint, HoleIllustrationSnapshot } from "../holeIllustration/types";

export interface SvgPoint { readonly x: number; readonly y: number; }

export function numericAttribute(node: Element, name: string): number {
  const raw = node.getAttribute(name);
  if (raw === null || raw.trim() === "") throw new Error(`Missing numeric SVG ${name}.`);
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Missing numeric SVG ${name}.`);
  return value;
}

export function parseSvg(svg: string): Document {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.getElementsByTagName("parsererror").length) throw new Error("Invalid SVG.");
  return document;
}

export function elements(parent: Document | Element, name: string): Element[] {
  const matches = parent.getElementsByTagName(name);
  const result: Element[] = [];
  for (let index = 0; index < matches.length; index += 1) {
    const item = matches.item(index);
    if (item) result.push(item as Element);
  }
  return result;
}

export function semanticElement(parent: Document | Element, semantic: string, name?: string): Element {
  const candidates = name ? elements(parent, name) : ["ellipse", "polyline", "polygon", "g"].flatMap((tag) => elements(parent, tag));
  const node = candidates.find((item) => item.getAttribute("data-semantic") === semantic);
  if (!node) throw new Error(`Missing ${semantic}.`);
  return node;
}

export function semanticPoint(svg: string, semantic: string): SvgPoint {
  const node = semanticElement(parseSvg(svg), semantic, "ellipse");
  return { x: numericAttribute(node, "cx"), y: numericAttribute(node, "cy") };
}

export function pointList(node: Element): SvgPoint[] {
  const raw = node.getAttribute("points");
  if (!raw) throw new Error("Missing SVG points.");
  const values = raw.trim().split(/[\s,]+/).map(Number);
  if (!values.length || values.length % 2 || values.some((value) => !Number.isFinite(value))) throw new Error("Invalid SVG points.");
  return Array.from({ length: values.length / 2 }, (_, index) => ({ x: values[index * 2], y: values[index * 2 + 1] }));
}

export function attributePoint(node: Element, xName = "cx", yName = "cy"): SvgPoint {
  return { x: numericAttribute(node, xName), y: numericAttribute(node, yName) };
}

export function atlasPanel(svg: string, holeId: string): Element {
  const panel = elements(parseSvg(svg), "g").find((item) => item.getAttribute("data-hole-id") === holeId);
  if (!panel) throw new Error(`Missing atlas panel for ${holeId}.`);
  return panel;
}

export function atlasHoleIds(svg: string): string[] {
  return elements(parseSvg(svg), "g").flatMap((item) => {
    const id = item.getAttribute("data-hole-id");
    return id ? [id] : [];
  });
}

export function atlasInnerSvg(panel: Element): Element {
  const nested = elements(panel, "svg")[0];
  if (!nested) throw new Error("Missing nested atlas SVG.");
  return nested;
}

/** Applies the nested panel's x/y/width/height/viewBox xMidYMid meet transform to an inner 960×640 point. */
export function atlasOuterPoint(nested: Element, point: SvgPoint): SvgPoint {
  const [minX, minY, viewWidth, viewHeight] = (nested.getAttribute("viewBox") ?? "").trim().split(/\s+/).map(Number);
  if (![minX, minY, viewWidth, viewHeight].every(Number.isFinite) || viewWidth <= 0 || viewHeight <= 0) throw new Error("Invalid nested atlas viewBox.");
  if (nested.getAttribute("preserveAspectRatio") !== "xMidYMid meet") throw new Error("Unexpected nested atlas aspect contract.");
  const width = numericAttribute(nested, "width"), height = numericAttribute(nested, "height");
  if (width <= 0 || height <= 0) throw new Error("Invalid nested atlas dimensions.");
  const scale = Math.min(width / viewWidth, height / viewHeight);
  return {
    x: numericAttribute(nested, "x") + (width - viewWidth * scale) / 2 + (point.x - minX) * scale,
    y: numericAttribute(nested, "y") + (height - viewHeight * scale) / 2 + (point.y - minY) * scale,
  };
}

/** Independent course-to-final-viewBox transform mirrored from the documented snapshot frame contract. */
export function project(snapshot: HoleIllustrationSnapshot, point: SvgPoint, frameName: "north-up" | "tee-to-green" = "north-up"): SvgPoint {
  const frame = frameName === "north-up" ? snapshot.framing.northUp : snapshot.framing.teeToGreen;
  const dx = point.x - frame.originCourse.x, dy = point.y - frame.originCourse.y;
  const local = { x: point.x + frame.translation.x, y: point.y + frame.translation.y };
  const transformed = frame.mode === "north-up" ? local : { x: frame.matrix.a * dx + frame.matrix.c * dy + frame.translation.x, y: frame.matrix.b * dx + frame.matrix.d * dy + frame.translation.y };
  const scale = Math.min(960 * .88 / frame.crop.width, 640 * .88 / frame.crop.height);
  return { x: (960 - frame.crop.width * scale) / 2 + transformed.x * scale, y: (640 - frame.crop.height * scale) / 2 + transformed.y * scale };
}

/** Renderer marks grid-backed tee, pin, terrain, and obstacle values at cell centres. */
export function projectCellCenter(snapshot: HoleIllustrationSnapshot, point: SvgPoint, frameName: "north-up" | "tee-to-green" = "north-up"): SvgPoint {
  return project(snapshot, { x: point.x + .5, y: point.y + .5 }, frameName);
}

/** Projects snapshot-local coordinates without importing a renderer or preview output. */
export function projectSnapshotPoint(snapshot: HoleIllustrationSnapshot, point: HoleIllustrationLocalPoint, frameName: "north-up" | "tee-to-green", dx = 0, dy = 0): SvgPoint {
  const frame = frameName === "north-up" ? snapshot.framing.northUp : snapshot.framing.teeToGreen;
  const local = frameName === "north-up"
    ? { x: point.x + dx, y: point.y + dy }
    : { x: point.teeToGreen.x + frame.matrix.a * dx + frame.matrix.c * dy, y: point.teeToGreen.y + frame.matrix.b * dx + frame.matrix.d * dy };
  const scale = Math.min(960 * .88 / frame.crop.width, 640 * .88 / frame.crop.height);
  return { x: (960 - frame.crop.width * scale) / 2 + local.x * scale, y: (640 - frame.crop.height * scale) / 2 + local.y * scale };
}

export function assertNear(actual: SvgPoint, expected: SvgPoint, tolerance = .001, label = "coordinate"): void {
  if (Math.abs(actual.x - expected.x) > tolerance || Math.abs(actual.y - expected.y) > tolerance) throw new Error(`${label} coordinate mismatch: ${actual.x},${actual.y} vs ${expected.x},${expected.y}`);
}
