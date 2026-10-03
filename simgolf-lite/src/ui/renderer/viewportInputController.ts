import {
  DomViewportPointerEventSource,
  type ViewportGameplayPointerEvent,
  type ViewportPointerEventSource,
  type ViewportPointerMappingPort,
} from "./viewportPointerEvents";
import type { Keybindings, BindingAction } from "../../accessibility/keybindings";
import { bindingFromEvent } from "../../accessibility/keybindings";
import type { CameraState, IsoCameraSnapshot } from "../../game/render/camera";
import { FLYOVER_DURATION_MS, sampleFlyover, type FlyoverKey } from "../../game/render/flyover";
import {
  ELEVATION_STEP_PX,
  TILE_W,
  isoToTile,
  isoToWorld,
  nextRotation,
  worldToIso,
  type IsoRotation,
} from "../../game/render/iso";
import {
  gestureScaleToWheelDelta,
  nextWheelZoomTarget,
  normalizeWheelDelta,
} from "../../game/render/wheelZoom";
import { ELEVATION_MAX, getElevation } from "../../game/models/elevation";
import type { Course, Point, SurfaceFeature, Terrain, TerrainAuthoringTool } from "../../game/models/types";
import type { TerrainStrokePreview } from "../../game/models/terrainStroke";
import type { FineGreenSculptPreview } from "../../game/greens/fineGreenSculpt";
import { defaultSurfaceTangents, withDefaultSurfaceTangents } from "../../game/models/surfaceIntent";
import {
  SCENIC_CAMERA_MARGIN_TILES,
  clampScenicCameraCenter,
} from "../../game/render/scenicSurround";

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 8;
const ROTATE_TWEEN_MS = 250;
const KEY_PAN_SPEED = 900;

export interface ViewportInputOverlayPort {
  invalidate(): void;
  setHover(tile: { x: number; y: number } | null): boolean;
}

export interface ViewportInputTerrainPort {
  cull(viewport: {
    rotation: number;
    pivotX: number;
    pivotY: number;
    scale: number;
    screenWidth: number;
    screenHeight: number;
    graphicsQuality: "high" | "medium" | "low";
    resolutionScale: number;
  }): number;
  diagnostics(): unknown;
}

export interface ViewportWorldPort {
  pivot: { x: number; y: number; set(x: number, y: number): void };
  position: { x: number; y: number; set(x: number, y: number): void };
  scale: { x: number; y: number; set(value: number): void };
  rotation: number;
}

export interface ViewportApplicationPort extends ViewportPointerMappingPort {
  screen: { width: number; height: number };
  renderer: ViewportPointerMappingPort["renderer"] & { resize(width: number, height: number): void };
  ticker: {
    add(listener: (ticker: { deltaMS: number }) => void): void;
    remove(listener: (ticker: { deltaMS: number }) => void): void;
  };
  canvas: HTMLCanvasElement;
}

export interface ViewportInputFrame {
  center: Point;
  zoom: number;
}

export interface ViewportEditorPresentation {
  terrainPreview: TerrainStrokePreview | null;
  fineGreenPreview: FineGreenSculptPreview | null;
  splineDraft: Point[];
  splineHover: Point | null;
  selectedFeatureId: string | null;
  selectedNode: number | null;
  surfaceDraft: SurfaceFeature | null;
}

export interface ViewportEditorConfig {
  mode: "PAINT" | "HOLE_WIZARD" | "OBSTACLE" | "SCULPT" | "BUILDING" | "DECOR";
  terrainTool: TerrainAuthoringTool;
  playableShotMode: boolean;
  selectedTerrain?: Terrain;
  worldCash?: number;
  onClickTile(x: number, y: number): void;
  onPreviewTerrainStroke?: (points: Point[]) => TerrainStrokePreview;
  onCommitTerrainStroke?: (points: Point[]) => void;
  onPreviewSurfaceFeatureEdit?: (feature: SurfaceFeature) => TerrainStrokePreview | null;
  onCommitSurfaceFeatureEdit?: (feature: SurfaceFeature) => void;
  onPreviewFineGreenStroke?: (points: Point[]) => FineGreenSculptPreview;
  onCommitFineGreenStroke?: (points: Point[]) => void;
  onPresentationChange(presentation: ViewportEditorPresentation): void;
  pickGolfer?(globalX: number, globalY: number, controller: ViewportInputController): boolean;
}

export interface ViewportInputConfig {
  course: Course;
  rotation: IsoRotation;
  animationsEnabled: boolean;
  cameraSmoothing: boolean;
  edgeScroll: boolean;
  edgeScrollSpeed: number;
  keybindings: Keybindings;
  graphicsQuality: "high" | "medium" | "low";
  resolutionScale: number;
  showGridOverlays: boolean;
  cameraState?: CameraState | null;
  openingFollow?: boolean;
  openingFocus?: Point | null;
  onOpeningFollowCanceled?: () => void;
  onRotationCommit(rotation: IsoRotation): void;
  onCameraUpdate?: (camera: CameraState) => void;
  onCameraCenter?: (center: Point) => void;
  onViewChange?: (view: IsoCameraSnapshot) => void;
  deriveFrame(mode: "normal" | "overview", viewport: { width: number; height: number }, rotation: IsoRotation): ViewportInputFrame | null;
  onFlyoverEnd?(): void;
  onPrimaryPointer?(event: ViewportGameplayPointerEvent, controller: ViewportInputController): void;
  onPointerCancel?(event: ViewportGameplayPointerEvent): void;
  updateCursor?(tile: { x: number; y: number } | null): void;
  editor: ViewportEditorConfig;
}

export interface ViewportInputControllerPorts {
  app: ViewportApplicationPort;
  world: ViewportWorldPort;
  element: HTMLElement;
  overlay(): ViewportInputOverlayPort | null;
  terrain(): ViewportInputTerrainPort | null;
  now?(): number;
  resizeObserver?: typeof ResizeObserver;
  pointerEvents?: ViewportPointerEventSource;
}

export interface ViewportInputState {
  attached: boolean;
  viewport: { width: number; height: number };
  camera: {
    center: Point;
    targetCenter: Point;
    zoom: number;
    targetZoom: number;
    initialized: boolean;
  };
  rotation: { committed: IsoRotation; tweening: boolean; screenRadians: number };
  flyover: { active: boolean; progress: number | null; openingFollow: boolean; saved: { cx: number; cy: number; zoom: number } | null };
  input: {
    heldPanActions: string[];
    panning: boolean;
    panPointerId: number | null;
    edgePointer: Point | null;
    gestureScale: number;
    editorGesture: "terrain" | "fine-green" | "surface" | "spline" | null;
    hover: Point | null;
  };
  counters: {
    appliedTransforms: number;
    culls: number;
    overlayInvalidations: number;
    cameraReports: number;
    viewReports: number;
  };
  terrain: unknown;
}

type CameraValues = {
  cx: number;
  cy: number;
  zoom: number;
  tcx: number;
  tcy: number;
  tzoom: number;
  initialized: boolean;
};

type PanState = { gx: number; gy: number; cx: number; cy: number; pointerId: number };
type StrokeState = { pointerId: number; points: Point[]; last: Point };
type SurfaceDragState = {
  pointerId: number;
  feature: SurfaceFeature;
  nodeIndex: number;
  target: "node" | "in" | "out";
};

export function fitViewportZoomForTileBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  screenW: number,
  screenH: number,
  rotation: IsoRotation,
): number {
  const corners = [
    worldToIso(minX, minY, 0, rotation),
    worldToIso(maxX + 1, minY, 0, rotation),
    worldToIso(maxX + 1, maxY + 1, 0, rotation),
    worldToIso(minX, maxY + 1, 0, rotation),
  ];
  const width = Math.max(...corners.map((point) => point.x)) - Math.min(...corners.map((point) => point.x));
  const height = Math.max(...corners.map((point) => point.y)) - Math.min(...corners.map((point) => point.y));
  if (width <= 0 || height <= 0 || screenW <= 0 || screenH <= 0) return 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min((screenW * 0.95) / width, (screenH * 0.95) / height)));
}

function resampleWorldLine(from: Point, to: Point, step = 0.25): Point[] {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  if (distance < 0.04) return [];
  const divisions = Math.max(1, Math.ceil(distance / step));
  return Array.from({ length: divisions }, (_, index) => {
    const progress = (index + 1) / divisions;
    return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
  });
}

function surfaceFeaturePoints(feature: SurfaceFeature): Point[] {
  return feature.geometry.kind === "corridor" ? feature.geometry.knots : feature.geometry.ring;
}

function moveSurfaceNode(feature: SurfaceFeature, nodeIndex: number, point: Point): SurfaceFeature {
  const previous = surfaceFeaturePoints(feature)[nodeIndex];
  if (!previous) return feature;
  const dx = point.x - previous.x;
  const dy = point.y - previous.y;
  const tangents = feature.geometry.tangents?.map((handles, index) => index === nodeIndex
    ? { in: { x: handles.in.x + dx, y: handles.in.y + dy }, out: { x: handles.out.x + dx, y: handles.out.y + dy } }
    : handles);
  return feature.geometry.kind === "corridor"
    ? { ...feature, geometry: { ...feature.geometry, knots: feature.geometry.knots.map((node, index) => index === nodeIndex ? point : node), tangents } }
    : { ...feature, geometry: { ...feature.geometry, ring: feature.geometry.ring.map((node, index) => index === nodeIndex ? point : node), tangents } };
}

function moveSurfaceHandle(feature: SurfaceFeature, nodeIndex: number, target: "in" | "out", point: Point, mirror: boolean): SurfaceFeature {
  const editable = withDefaultSurfaceTangents(feature);
  const node = surfaceFeaturePoints(editable)[nodeIndex];
  if (!node || !editable.geometry.tangents) return feature;
  const tangents = editable.geometry.tangents.map((handles, index) => {
    if (index !== nodeIndex) return handles;
    const opposite = { x: node.x * 2 - point.x, y: node.y * 2 - point.y };
    return target === "in" ? { in: point, out: mirror ? opposite : handles.out }
      : { in: mirror ? opposite : handles.in, out: point };
  });
  return { ...editable, geometry: { ...editable.geometry, tangents } } as SurfaceFeature;
}

function deleteSurfaceNode(feature: SurfaceFeature, nodeIndex: number): SurfaceFeature | null {
  const points = surfaceFeaturePoints(feature);
  const minimum = feature.geometry.kind === "corridor" ? 2 : 3;
  if (points.length <= minimum || !points[nodeIndex]) return null;
  if (feature.geometry.kind === "corridor") {
    return {
      ...feature,
      geometry: {
        ...feature.geometry,
        knots: feature.geometry.knots.filter((_, index) => index !== nodeIndex),
        tangents: feature.geometry.tangents?.filter((_, index) => index !== nodeIndex),
      },
    };
  }
  return {
    ...feature,
    geometry: {
      ...feature.geometry,
      ring: feature.geometry.ring.filter((_, index) => index !== nodeIndex),
      tangents: feature.geometry.tangents?.filter((_, index) => index !== nodeIndex),
    },
  };
}

function insertSurfaceNode(feature: SurfaceFeature, afterIndex: number, point: Point): SurfaceFeature {
  const insertIndex = afterIndex + 1;
  if (feature.geometry.kind === "corridor") {
    const knots = [
      ...feature.geometry.knots.slice(0, insertIndex),
      point,
      ...feature.geometry.knots.slice(insertIndex),
    ];
    const tangents = feature.geometry.tangents ? [
      ...feature.geometry.tangents.slice(0, insertIndex),
      defaultSurfaceTangents(knots)[insertIndex],
      ...feature.geometry.tangents.slice(insertIndex),
    ] : undefined;
    return { ...feature, geometry: { ...feature.geometry, knots, tangents } };
  }
  const ring = [
    ...feature.geometry.ring.slice(0, insertIndex),
    point,
    ...feature.geometry.ring.slice(insertIndex),
  ];
  const tangents = feature.geometry.tangents ? [
    ...feature.geometry.tangents.slice(0, insertIndex),
    defaultSurfaceTangents(ring, true)[insertIndex],
    ...feature.geometry.tangents.slice(insertIndex),
  ] : undefined;
  return { ...feature, geometry: { ...feature.geometry, ring, tangents } };
}

function nearestSurfaceSegment(feature: SurfaceFeature, point: Point): { index: number; distance: number } {
  const points = surfaceFeaturePoints(feature);
  const count = feature.geometry.kind === "region" ? points.length : Math.max(0, points.length - 1);
  let best = { index: 0, distance: Number.POSITIVE_INFINITY };
  for (let index = 0; index < count; index++) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length2 = dx * dx + dy * dy;
    const progress = length2 <= 1e-9 ? 0 : Math.max(0, Math.min(1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) / length2));
    const distance = Math.hypot(point.x - (start.x + dx * progress), point.y - (start.y + dy * progress));
    if (distance < best.distance) best = { index, distance };
  }
  return best;
}

/**
 * Owns all transient viewport input and camera animation state. React supplies
 * committed scene/configuration state through update(); no listener is
 * reattached when props change.
 */
export class ViewportInputController {
  private config: ViewportInputConfig;
  private readonly ports: ViewportInputControllerPorts;
  private readonly pointerEvents: ViewportPointerEventSource;
  private readonly camera: CameraValues = {
    cx: 0, cy: 0, zoom: 1, tcx: 0, tcy: 0, tzoom: 1, initialized: false,
  };
  private rotation: IsoRotation;
  private rotationTween: { start: number; toDeg: number; next: IsoRotation } | null = null;
  private flyover: { keys: FlyoverKey[]; t0: number; saved: { cx: number; cy: number; zoom: number } } | null = null;
  private openingSaved: { cx: number; cy: number; zoom: number } | null = null;
  private keys = new Set<BindingAction>();
  private edgePointer: Point | null = null;
  private pan: PanState | null = null;
  private gestureScale = 1;
  private lastAmbientReportAt = 0;
  private lastReportedCameraState: CameraState | null = null;
  private lastCameraState: CameraState | null | undefined;
  private lastReferenceId: string | null = null;
  private lastAutoFitSignature: string | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;
  private terrainStroke: StrokeState | null = null;
  private fineGreenStroke: StrokeState | null = null;
  private splineDraft: Point[] = [];
  private splineHover: Point | null = null;
  private selectedFeatureId: string | null = null;
  private selectedNode: number | null = null;
  private surfaceDraft: SurfaceFeature | null = null;
  private surfaceDrag: SurfaceDragState | null = null;
  private terrainPreview: TerrainStrokePreview | null = null;
  private fineGreenPreview: FineGreenSculptPreview | null = null;
  private terrainStrokePointerDownCell: Point | null = null;
  private hover: Point | null = null;
  private counters = { appliedTransforms: 0, culls: 0, overlayInvalidations: 0, cameraReports: 0, viewReports: 0 };

  constructor(config: ViewportInputConfig, ports: ViewportInputControllerPorts) {
    this.config = config;
    this.rotation = config.rotation;
    this.ports = ports;
    this.pointerEvents = ports.pointerEvents ?? new DomViewportPointerEventSource(ports.app, ports.element);
    this.attach();
    this.resize();
  }

  update(config: ViewportInputConfig): void {
    const previousToolRotation = this.config.rotation;
    const previouslyFollowing = Boolean(this.config.openingFollow && this.config.openingFocus);
    const previousTerrainTool = this.config.editor.terrainTool;
    this.config = config;
    if (!this.rotationTween && previousToolRotation !== config.rotation && this.rotation !== config.rotation) {
      this.rotation = config.rotation;
      this.applyCamera();
    }
    const following = Boolean(config.openingFollow && config.openingFocus);
    if (following && !previouslyFollowing && !this.openingSaved) {
      this.openingSaved = { cx: this.camera.tcx, cy: this.camera.tcy, zoom: this.camera.tzoom };
    } else if (!following && previouslyFollowing && this.openingSaved) {
      this.camera.tcx = this.openingSaved.cx;
      this.camera.tcy = this.openingSaved.cy;
      this.camera.tzoom = this.openingSaved.zoom;
      this.openingSaved = null;
      this.invalidateOverlay();
    }
    if (previousTerrainTool !== config.editor.terrainTool) {
      this.terrainStroke = null;
      this.fineGreenStroke = null;
      this.terrainPreview = null;
      this.fineGreenPreview = null;
      if (config.editor.terrainTool !== "spline") {
        this.splineDraft = [];
        this.splineHover = null;
      }
      if (config.editor.terrainTool !== "edit") {
        this.surfaceDrag = null;
        this.surfaceDraft = null;
        this.selectSurface(null);
      }
      this.publishEditor();
    }
    if (this.selectedFeatureId
      && !config.course.surfaceIntent?.features.some((feature) => feature.id === this.selectedFeatureId)) {
      this.selectSurface(null);
      this.publishEditor();
    }
    this.applyExternalCamera(config.cameraState);
  }

  initializeDefault(): void {
    if (this.camera.initialized) return;
    this.camera.initialized = true;
    this.fitDefaultView(true);
  }

  autoFit(signature: string): void {
    if (this.config.cameraState || this.lastAutoFitSignature === signature) return;
    this.lastAutoFitSignature = signature;
    this.camera.initialized = true;
    this.fitDefaultView(true);
  }

  applyReferenceCamera(reference: { id: string; center: Point; zoom: number; rotation: 0 | 1 | 2 | 3 } | null): void {
    if (!reference || this.lastReferenceId === reference.id) return;
    this.lastReferenceId = reference.id;
    this.rotation = (reference.rotation * 90) as IsoRotation;
    const center = this.clampCenter(reference.center.x, reference.center.y, reference.zoom);
    this.camera.cx = this.camera.tcx = center.x;
    this.camera.cy = this.camera.tcy = center.y;
    this.camera.zoom = this.camera.tzoom = Math.max(this.minimumZoom(), Math.min(MAX_ZOOM, reference.zoom));
    this.camera.initialized = true;
    this.applyCamera();
    this.config.onRotationCommit(this.rotation);
    this.reportView();
  }

  jump(center: Point): void {
    const next = this.clampCenter(center.x, center.y);
    this.camera.tcx = next.x;
    this.camera.tcy = next.y;
  }

  startFlyover(keys: FlyoverKey[]): void {
    if (keys.length === 0) return;
    this.flyover = {
      keys,
      t0: this.now(),
      saved: this.flyover?.saved ?? { cx: this.camera.tcx, cy: this.camera.tcy, zoom: this.camera.tzoom },
    };
  }

  endFlyover(): void {
    if (!this.flyover) return;
    this.camera.tcx = this.flyover.saved.cx;
    this.camera.tcy = this.flyover.saved.cy;
    this.camera.tzoom = this.flyover.saved.zoom;
    this.flyover = null;
    this.config.onFlyoverEnd?.();
  }

  followTarget(point: Point): void {
    const next = this.clampCenter(point.x, point.y);
    this.camera.tcx = next.x;
    this.camera.tcy = next.y;
  }

  fitWholeCourse(snap: boolean): void {
    const frame = this.config.deriveFrame("overview", this.viewport(), this.rotation);
    if (!frame) return;
    this.setFrame(frame, snap, false);
  }

  fitDefaultView(snap: boolean): void {
    if (this.config.showGridOverlays) {
      this.fitWholeCourse(snap);
      return;
    }
    const frame = this.config.deriveFrame("normal", this.viewport(), this.rotation);
    if (!frame) return;
    this.setFrame(frame, snap, true);
  }

  setZoomForTest(zoom: number): void {
    const next = Math.max(this.minimumZoom(), Math.min(MAX_ZOOM, zoom));
    this.camera.zoom = this.camera.tzoom = next;
    this.applyCamera();
  }

  focusTileForTest(x: number, y: number, zoom: number): void {
    const next = Math.max(this.minimumZoom(), Math.min(MAX_ZOOM, zoom));
    this.camera.cx = this.camera.tcx = x;
    this.camera.cy = this.camera.tcy = y;
    this.camera.zoom = this.camera.tzoom = next;
    this.camera.initialized = true;
    this.applyCamera();
  }

  viewport(): { width: number; height: number } {
    return { width: this.ports.app.screen.width, height: this.ports.app.screen.height };
  }

  cameraTransform() {
    const world = this.ports.world;
    return {
      world: {
        position: { x: world.position.x, y: world.position.y },
        pivot: { x: world.pivot.x, y: world.pivot.y },
        scale: { x: world.scale.x, y: world.scale.y },
      },
      camera: {
        center: { x: this.camera.cx, y: this.camera.cy },
        targetCenter: { x: this.camera.tcx, y: this.camera.tcy },
        zoom: this.camera.zoom,
        targetZoom: this.camera.tzoom,
      },
    };
  }

  cameraSnapshot(): Readonly<CameraValues> {
    return { ...this.camera };
  }

  clampTarget(point: Point, zoom = this.camera.tzoom): Point {
    return this.clampCenter(point.x, point.y, zoom);
  }

  applyCameraNow(): void {
    this.applyCamera();
  }

  editorPresentation(): ViewportEditorPresentation {
    return {
      terrainPreview: this.terrainPreview,
      fineGreenPreview: this.fineGreenPreview,
      splineDraft: this.splineDraft.map((point) => ({ ...point })),
      splineHover: this.splineHover ? { ...this.splineHover } : null,
      selectedFeatureId: this.selectedFeatureId,
      selectedNode: this.selectedNode,
      surfaceDraft: this.surfaceDraft,
    };
  }

  terrainStrokePointerCell(): Point | null {
    return this.terrainStrokePointerDownCell ? { ...this.terrainStrokePointerDownCell } : null;
  }

  resetTerrainStrokePointerCell(): void {
    this.terrainStrokePointerDownCell = null;
  }

  rotationSnapshot(): IsoRotation {
    return this.rotation;
  }

  screenToIsoPlane(globalX: number, globalY: number): Point | null {
    const world = this.ports.world;
    if (world.scale.x <= 0 || world.scale.y <= 0) return null;
    return {
      x: (globalX - world.position.x) / world.scale.x + world.pivot.x,
      y: (globalY - world.position.y) / world.scale.y + world.pivot.y,
    };
  }

  screenToTile(globalX: number, globalY: number): { x: number; y: number } | null {
    const iso = this.screenToIsoPlane(globalX, globalY);
    if (!iso) return null;
    const course = this.config.course;
    for (let elevation = ELEVATION_MAX; elevation >= 0; elevation--) {
      const tile = isoToTile(iso.x, iso.y + elevation * ELEVATION_STEP_PX, this.rotation);
      if (tile.x < 0 || tile.y < 0 || tile.x >= course.width || tile.y >= course.height) continue;
      if (getElevation(course, tile.x, tile.y) === elevation) return tile;
    }
    return null;
  }

  screenToWorldPoint(globalX: number, globalY: number): Point | null {
    const iso = this.screenToIsoPlane(globalX, globalY);
    const tile = this.screenToTile(globalX, globalY);
    if (!iso || !tile) return null;
    const course = this.config.course;
    const elevation = getElevation(course, tile.x, tile.y);
    const point = isoToWorld(iso.x, iso.y + elevation * ELEVATION_STEP_PX, this.rotation);
    return {
      x: Math.max(0, Math.min(course.width - 1e-6, point.x)),
      y: Math.max(0, Math.min(course.height - 1e-6, point.y)),
    };
  }

  worldPointToScreen(wx: number, wy: number, elevation = 0): Point {
    const world = this.ports.world;
    const point = worldToIso(wx, wy, elevation, this.rotation);
    return {
      x: world.position.x + (point.x - world.pivot.x) * world.scale.x,
      y: world.position.y + (point.y - world.pivot.y) * world.scale.y,
    };
  }

  reconcileCulling(): void {
    const terrain = this.ports.terrain();
    if (!terrain) return;
    const world = this.ports.world;
    terrain.cull({
      rotation: world.rotation,
      pivotX: world.pivot.x,
      pivotY: world.pivot.y,
      scale: world.scale.x,
      screenWidth: this.ports.app.screen.width,
      screenHeight: this.ports.app.screen.height,
      graphicsQuality: this.config.graphicsQuality,
      resolutionScale: this.config.resolutionScale,
    });
    this.counters.culls++;
  }

  snapshot(): ViewportInputState {
    return {
      attached: !this.destroyed,
      viewport: this.viewport(),
      camera: {
        center: { x: this.camera.cx, y: this.camera.cy },
        targetCenter: { x: this.camera.tcx, y: this.camera.tcy },
        zoom: this.camera.zoom,
        targetZoom: this.camera.tzoom,
        initialized: this.camera.initialized,
      },
      rotation: { committed: this.rotation, tweening: this.rotationTween !== null, screenRadians: this.ports.world.rotation },
      flyover: {
        active: this.flyover !== null,
        progress: this.flyover ? (this.now() - this.flyover.t0) / FLYOVER_DURATION_MS : null,
        openingFollow: this.openingSaved !== null,
        saved: this.flyover ? { ...this.flyover.saved } : null,
      },
      input: {
        heldPanActions: [...this.keys].sort(),
        panning: this.pan !== null,
        panPointerId: this.pan?.pointerId ?? null,
        edgePointer: this.edgePointer ? { ...this.edgePointer } : null,
        gestureScale: this.gestureScale,
        editorGesture: this.terrainStroke ? "terrain" : this.fineGreenStroke ? "fine-green" : this.surfaceDrag ? "surface" : this.splineDraft.length ? "spline" : null,
        hover: this.hover ? { ...this.hover } : null,
      },
      counters: { ...this.counters },
      terrain: this.ports.terrain()?.diagnostics() ?? null,
    };
  }

  tick(dtMs: number, at = this.now()): void {
    if (this.destroyed) return;
    const camera = this.camera;
    const world = this.ports.world;
    let moved = false;
    if (this.flyover) {
      const progress = (at - this.flyover.t0) / FLYOVER_DURATION_MS;
      if (progress >= 1.08) this.endFlyover();
      else {
        const sample = sampleFlyover(this.flyover.keys, progress);
        const center = this.clampCenter(sample.x, sample.y, sample.zoom);
        camera.tcx = center.x;
        camera.tcy = center.y;
        camera.tzoom = Math.max(this.minimumZoom(), Math.min(MAX_ZOOM, sample.zoom));
        moved = true;
      }
    }
    if (!this.flyover && this.config.openingFollow && this.config.openingFocus && !this.rotationTween) {
      if (!this.openingSaved) this.openingSaved = { cx: camera.tcx, cy: camera.tcy, zoom: camera.tzoom };
      const center = this.clampCenter(this.config.openingFocus.x, this.config.openingFocus.y);
      camera.tcx = center.x;
      camera.tcy = center.y;
      moved = true;
    }
    if (!this.flyover && this.keys.size > 0 && !this.rotationTween) {
      let dx = 0;
      let dy = 0;
      if (this.keys.has("panLeft")) dx--;
      if (this.keys.has("panRight")) dx++;
      if (this.keys.has("panUp")) dy--;
      if (this.keys.has("panDown")) dy++;
      moved = this.panByScreenDelta(dx, dy, dtMs, 1) || moved;
    }
    if (!this.flyover && this.config.edgeScroll && this.edgePointer && !this.rotationTween) {
      const margin = 28;
      const dx = this.edgePointer.x < margin ? -1 : this.edgePointer.x > this.ports.element.clientWidth - margin ? 1 : 0;
      const dy = this.edgePointer.y < margin ? -1 : this.edgePointer.y > this.ports.element.clientHeight - margin ? 1 : 0;
      moved = this.panByScreenDelta(dx, dy, dtMs, this.config.edgeScrollSpeed) || moved;
    }
    const smoothing = this.config.cameraSmoothing ? 1 - Math.exp(-dtMs / 90) : 1;
    const snap = (from: number, to: number) => Math.abs(from - to) < 1e-4 ? to : from + (to - from) * smoothing;
    const nextX = snap(camera.cx, camera.tcx);
    const nextY = snap(camera.cy, camera.tcy);
    const nextZoom = snap(camera.zoom, camera.tzoom);
    if (nextX !== camera.cx || nextY !== camera.cy || nextZoom !== camera.zoom) {
      camera.cx = nextX;
      camera.cy = nextY;
      camera.zoom = nextZoom;
      moved = true;
    }
    if (this.rotationTween) {
      const progress = Math.min(1, (at - this.rotationTween.start) / ROTATE_TWEEN_MS);
      const ease = progress * progress * (3 - 2 * progress);
      world.rotation = this.rotationTween.toDeg * ease * Math.PI / 180;
      if (progress >= 1) {
        const next = this.rotationTween.next;
        this.rotationTween = null;
        world.rotation = 0;
        this.rotation = next;
        this.config.onRotationCommit(next);
      }
      moved = true;
    }
    if (moved) {
      this.applyCamera();
      this.invalidateOverlay();
      if (at - this.lastAmbientReportAt >= 250) {
        this.lastAmbientReportAt = at;
        this.config.onCameraCenter?.({ x: camera.tcx, y: camera.tcy });
        this.reportView();
      }
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pointerEvents.suspend();
    const { element, app } = this.ports;
    element.removeEventListener("wheel", this.handleWheel);
    element.removeEventListener("gesturestart", this.handleGestureStart);
    element.removeEventListener("gesturechange", this.handleGestureChange);
    element.removeEventListener("gestureend", this.handleGestureEnd);
    element.removeEventListener("pointerdown", this.handlePointerDown);
    element.removeEventListener("pointermove", this.handlePointerMove);
    element.removeEventListener("pointerup", this.handlePointerUp);
    element.removeEventListener("pointercancel", this.handlePointerUp);
    element.removeEventListener("pointerleave", this.handlePointerLeave);
    element.removeEventListener("contextmenu", this.handleContextMenu);
    element.removeEventListener("pointerdown", this.handleEditorPointerDown, true);
    element.removeEventListener("pointermove", this.handleEditorPointerMove, true);
    element.removeEventListener("pointerup", this.handleEditorPointerUp, true);
    element.removeEventListener("pointercancel", this.handleEditorPointerCancel, true);
    window.removeEventListener("keydown", this.handleKeyDown, true);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("blur", this.handleBlur);
    this.pointerEvents.off("pointerdown", this.handleStagePointerDown);
    this.pointerEvents.off("pointermove", this.handleStagePointerMove);
    this.pointerEvents.off("pointercancel", this.handleStagePointerCancel);
    this.pointerEvents.destroy();
    app.ticker.remove(this.tickFromTicker);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.keys.clear();
    this.pan = null;
    this.edgePointer = null;
    this.cancelEditorGesture();
  }

  private now(): number {
    return this.ports.now?.() ?? performance.now();
  }

  private viewportFitZoom(): number {
    const course = this.config.course;
    return fitViewportZoomForTileBounds(0, 0, course.width - 1, course.height - 1, this.ports.app.screen.width, this.ports.app.screen.height, this.rotation);
  }

  private minimumZoom(): number {
    return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.viewportFitZoom() * 0.62));
  }

  private clampCenter(x: number, y: number, zoom = this.camera.tzoom): Point {
    const { course } = this.config;
    if (zoom <= 0) return clampScenicCameraCenter({ x, y }, course.width, course.height, SCENIC_CAMERA_MARGIN_TILES, SCENIC_CAMERA_MARGIN_TILES);
    const centerIso = worldToIso(0, 0, 0, this.rotation);
    const halfWidth = this.ports.app.screen.width / (2 * zoom);
    const halfHeight = this.ports.app.screen.height / (2 * zoom);
    const corners = [
      isoToWorld(centerIso.x - halfWidth, centerIso.y - halfHeight, this.rotation),
      isoToWorld(centerIso.x + halfWidth, centerIso.y - halfHeight, this.rotation),
      isoToWorld(centerIso.x + halfWidth, centerIso.y + halfHeight, this.rotation),
      isoToWorld(centerIso.x - halfWidth, centerIso.y + halfHeight, this.rotation),
    ];
    return clampScenicCameraCenter(
      { x, y }, course.width, course.height,
      Math.max(...corners.map((point) => Math.abs(point.x))) * 0.72,
      Math.max(...corners.map((point) => Math.abs(point.y))) * 0.72,
    );
  }

  private setFrame(frame: ViewportInputFrame, snap: boolean, clamp: boolean): void {
    const zoom = clamp ? Math.min(MAX_ZOOM, Math.max(this.minimumZoom(), frame.zoom)) : frame.zoom;
    const center = clamp ? this.clampCenter(frame.center.x, frame.center.y, zoom) : frame.center;
    this.camera.tcx = center.x;
    this.camera.tcy = center.y;
    this.camera.tzoom = zoom;
    if (snap) {
      this.camera.cx = center.x;
      this.camera.cy = center.y;
      this.camera.zoom = zoom;
    }
    this.applyCamera();
    this.config.onCameraCenter?.({ x: center.x, y: center.y });
    if (snap) this.reportView();
  }

  private applyCamera(): void {
    const world = this.ports.world;
    const centerIso = worldToIso(this.camera.cx, this.camera.cy, 0, this.rotation);
    world.pivot.set(centerIso.x, centerIso.y);
    world.position.set(this.ports.app.screen.width / 2, this.ports.app.screen.height / 2);
    world.scale.set(this.camera.zoom);
    this.counters.appliedTransforms++;
    this.reconcileCulling();
  }

  private invalidateOverlay(): void {
    this.ports.overlay()?.invalidate();
    this.counters.overlayInvalidations++;
  }

  private reportCamera(): void {
    const center = { x: this.camera.tcx, y: this.camera.tcy };
    this.config.onCameraCenter?.(center);
    const cameraState = this.config.cameraState;
    if (cameraState && this.config.onCameraUpdate) {
      const reported = { ...cameraState, center, zoom: this.camera.tzoom, bounds: undefined };
      this.lastReportedCameraState = reported;
      this.config.onCameraUpdate(reported);
    }
    this.counters.cameraReports++;
  }

  private reportView(): void {
    if (!this.config.onViewChange || this.camera.zoom <= 0) return;
    const centerIso = worldToIso(this.camera.cx, this.camera.cy, 0, this.rotation);
    const halfWidth = this.ports.app.screen.width / (2 * this.camera.zoom);
    const halfHeight = this.ports.app.screen.height / (2 * this.camera.zoom);
    const corners = [
      isoToWorld(centerIso.x - halfWidth, centerIso.y - halfHeight, this.rotation),
      isoToWorld(centerIso.x + halfWidth, centerIso.y - halfHeight, this.rotation),
      isoToWorld(centerIso.x + halfWidth, centerIso.y + halfHeight, this.rotation),
      isoToWorld(centerIso.x - halfWidth, centerIso.y + halfHeight, this.rotation),
    ];
    const { course } = this.config;
    this.config.onViewChange({
      center: { x: this.camera.cx, y: this.camera.cy },
      zoom: this.camera.zoom,
      rotation: this.rotation,
      bounds: {
        minX: Math.max(0, Math.min(...corners.map((point) => point.x))),
        minY: Math.max(0, Math.min(...corners.map((point) => point.y))),
        maxX: Math.min(course.width - 1, Math.max(...corners.map((point) => point.x))),
        maxY: Math.min(course.height - 1, Math.max(...corners.map((point) => point.y))),
      },
    });
    this.counters.viewReports++;
  }

  private applyExternalCamera(cameraState: CameraState | null | undefined): void {
    if (!this.camera.initialized || this.lastCameraState === cameraState) return;
    this.lastCameraState = cameraState;
    if (!cameraState) {
      this.fitDefaultView(false);
      return;
    }
    if (this.lastReportedCameraState === cameraState) return;
    this.camera.tcx = cameraState.center.x;
    this.camera.tcy = cameraState.center.y;
    if (cameraState.bounds) {
      this.camera.tzoom = fitViewportZoomForTileBounds(
        cameraState.bounds.minX,
        cameraState.bounds.minY,
        cameraState.bounds.maxX,
        cameraState.bounds.maxY,
        this.ports.app.screen.width,
        this.ports.app.screen.height,
        this.rotation,
      );
    } else if (Number.isFinite(cameraState.zoom)) {
      this.camera.tzoom = Math.max(this.minimumZoom(), Math.min(MAX_ZOOM, cameraState.zoom));
    }
  }

  private panByScreenDelta(dx: number, dy: number, dtMs: number, speed: number): boolean {
    if (!dx && !dy) return false;
    const step = KEY_PAN_SPEED * speed * dtMs / 1000 / this.camera.zoom;
    const centerIso = worldToIso(this.camera.tcx, this.camera.tcy, 0, this.rotation);
    const tile = isoToWorld(centerIso.x + dx * step, centerIso.y + dy * step, this.rotation);
    const center = this.clampCenter(tile.x, tile.y);
    this.camera.tcx = center.x;
    this.camera.tcy = center.y;
    return true;
  }

  private resize = (): void => {
    const width = Math.max(this.ports.element.clientWidth || 100, 100);
    const height = Math.max(this.ports.element.clientHeight || 100, 100);
    this.ports.app.renderer.resize(width, height);
    this.ports.app.stage.hitArea = this.ports.app.screen;
    const minimum = this.minimumZoom();
    this.camera.tzoom = Math.max(minimum, this.camera.tzoom);
    this.camera.zoom = Math.max(minimum, this.camera.zoom);
    const center = this.clampCenter(this.camera.tcx, this.camera.tcy, this.camera.tzoom);
    this.camera.tcx = center.x;
    this.camera.tcy = center.y;
    this.applyCamera();
  };

  private cancelOpeningFollow(): void {
    if (!this.openingSaved) return;
    this.openingSaved = null;
    this.config.onOpeningFollowCanceled?.();
  }

  private publishEditor(): void {
    this.config.editor.onPresentationChange(this.editorPresentation());
    this.invalidateOverlay();
  }

  private canvasPoint(event: PointerEvent): Point | null {
    const rect = this.ports.app.canvas.getBoundingClientRect();
    return this.screenToWorldPoint(
      (event.clientX - rect.left) * this.ports.app.screen.width / rect.width,
      (event.clientY - rect.top) * this.ports.app.screen.height / rect.height,
    );
  }

  private cancelEditorGesture(): void {
    this.terrainStroke = null;
    this.fineGreenStroke = null;
    this.surfaceDrag = null;
    this.surfaceDraft = null;
    this.terrainPreview = null;
    this.fineGreenPreview = null;
    this.publishEditor();
  }

  private extendStroke(stroke: StrokeState, point: Point): void {
    const next = resampleWorldLine(stroke.last, point);
    if (!next.length) return;
    stroke.points.push(...next);
    if (stroke.points.length > 2_048) stroke.points = stroke.points.filter((_, index) => index % 2 === 0 || index === stroke.points.length - 1);
    stroke.last = point;
  }

  private featureForId(id: string | null): SurfaceFeature | null {
    if (!id) return null;
    return this.surfaceDraft
      ?? this.config.course.surfaceIntent?.features.find((feature) => feature.id === id)
      ?? null;
  }

  private topFeatureAt(point: Point): SurfaceFeature | null {
    const index = Math.floor(point.y) * this.config.course.width + Math.floor(point.x);
    return this.config.course.surfaceIntent?.features
      .slice()
      .sort((left, right) => right.order - left.order)
      .find((feature) => feature.coverage.includes(index)) ?? null;
  }

  private selectSurface(featureId: string | null, nodeIndex: number | null = null): void {
    this.selectedFeatureId = featureId;
    this.selectedNode = nodeIndex;
  }

  private startSurfaceDrag(
    feature: SurfaceFeature,
    nodeIndex: number,
    target: "node" | "in" | "out",
    pointerId: number,
  ): void {
    this.selectSurface(feature.id, nodeIndex);
    this.surfaceDrag = { pointerId, feature, nodeIndex, target };
    this.surfaceDraft = feature;
  }

  private applyZoomInput(deltaPixels: number, clientX: number, clientY: number): void {
    const rect = this.ports.element.getBoundingClientRect();
    const target = nextWheelZoomTarget({
      camera: { cx: this.camera.tcx, cy: this.camera.tcy, zoom: this.camera.tzoom },
      cursor: { x: clientX - rect.left, y: clientY - rect.top },
      viewport: this.viewport(),
      deltaPixels,
      rotation: this.rotation,
      minZoom: this.minimumZoom(),
      maxZoom: MAX_ZOOM,
    });
    const center = this.clampCenter(target.cx, target.cy, target.zoom);
    this.camera.tcx = center.x;
    this.camera.tcy = center.y;
    this.camera.tzoom = target.zoom;
    this.invalidateOverlay();
    this.reportCamera();
  }

  private handleEditorPointerDown = (event: PointerEvent): void => {
    if (this.destroyed) return;
    const editor = this.config.editor;
    if (event.button !== 0 || editor.playableShotMode || this.flyover) return;
    const point = this.canvasPoint(event);
    if (!point) return;
    if (editor.mode === "SCULPT") {
      const x = Math.floor(point.x);
      const y = Math.floor(point.y);
      if (x < 0 || y < 0 || x >= this.config.course.width || y >= this.config.course.height
        || this.config.course.tiles[y * this.config.course.width + x] !== "green"
        || !editor.onPreviewFineGreenStroke || !editor.onCommitFineGreenStroke) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.fineGreenStroke = { pointerId: event.pointerId, points: [point], last: point };
      this.fineGreenPreview = editor.onPreviewFineGreenStroke([point]);
      this.ports.element.setPointerCapture?.(event.pointerId);
      this.publishEditor();
      return;
    }
    if (editor.mode !== "PAINT" || !editor.selectedTerrain) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (editor.terrainTool === "spline") {
      if (!editor.onPreviewTerrainStroke || !editor.onCommitTerrainStroke) return;
      if (event.detail >= 2 && this.splineDraft.length) {
        const last = this.splineDraft[this.splineDraft.length - 1];
        const points = Math.hypot(last.x - point.x, last.y - point.y) < 0.2 ? this.splineDraft : [...this.splineDraft, point];
        if (points.length >= 2) editor.onCommitTerrainStroke(points);
        this.splineDraft = [];
        this.splineHover = null;
        this.terrainPreview = null;
      } else {
        this.splineDraft = [...this.splineDraft, point];
        this.splineHover = null;
        this.terrainPreview = editor.onPreviewTerrainStroke(this.splineDraft);
      }
      this.publishEditor();
      return;
    }
    if (editor.terrainTool === "edit" && editor.onPreviewSurfaceFeatureEdit && editor.onCommitSurfaceFeatureEdit) {
      const selected = this.featureForId(this.selectedFeatureId);
      const candidate = selected ?? this.topFeatureAt(point);
      if (!candidate) {
        this.selectSurface(null);
        this.publishEditor();
        return;
      }
      const points = surfaceFeaturePoints(candidate);
      const radius = Math.max(0.18, 10 / Math.max(8, TILE_W * this.camera.zoom));
      if (selected?.id === candidate.id && this.selectedNode != null) {
        const tangents = candidate.geometry.tangents
          ?? defaultSurfaceTangents(points, candidate.geometry.kind === "region");
        const handles = tangents[this.selectedNode];
        if (handles && Math.hypot(handles.in.x - point.x, handles.in.y - point.y) <= radius) {
          this.startSurfaceDrag(candidate, this.selectedNode, "in", event.pointerId);
          this.ports.element.setPointerCapture?.(event.pointerId);
          this.publishEditor();
          return;
        }
        if (handles && Math.hypot(handles.out.x - point.x, handles.out.y - point.y) <= radius) {
          this.startSurfaceDrag(candidate, this.selectedNode, "out", event.pointerId);
          this.ports.element.setPointerCapture?.(event.pointerId);
          this.publishEditor();
          return;
        }
      }
      let nearestNode = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      points.forEach((node, index) => {
        const distance = Math.hypot(node.x - point.x, node.y - point.y);
        if (distance < nearestDistance) { nearestNode = index; nearestDistance = distance; }
      });
      if (event.detail >= 2) {
        const segment = nearestSurfaceSegment(candidate, point);
        if (segment.distance <= Math.max(1.25, radius * 4)) {
          const edited = insertSurfaceNode(candidate, segment.index, point);
          this.selectSurface(candidate.id, segment.index + 1);
          this.terrainPreview = editor.onPreviewSurfaceFeatureEdit(edited);
          editor.onCommitSurfaceFeatureEdit(edited);
          this.terrainPreview = null;
          this.publishEditor();
          return;
        }
      }
      this.selectSurface(candidate.id, nearestNode);
      if (nearestDistance <= radius) {
        this.startSurfaceDrag(candidate, nearestNode, "node", event.pointerId);
        this.ports.element.setPointerCapture?.(event.pointerId);
      }
      this.publishEditor();
      return;
    }
    if (!editor.onPreviewTerrainStroke || !editor.onCommitTerrainStroke) return;
    this.terrainStrokePointerDownCell = { x: Math.floor(point.x), y: Math.floor(point.y) };
    this.terrainStroke = { pointerId: event.pointerId, points: [point], last: point };
    this.terrainPreview = editor.onPreviewTerrainStroke([point]);
    this.ports.element.setPointerCapture?.(event.pointerId);
    this.publishEditor();
  };

  private handleEditorPointerMove = (event: PointerEvent): void => {
    if (this.destroyed) return;
    const point = this.canvasPoint(event);
    if (!point) return;
    const editor = this.config.editor;
    if (this.surfaceDrag?.pointerId === event.pointerId && editor.onPreviewSurfaceFeatureEdit) {
      event.preventDefault(); event.stopImmediatePropagation();
      const drag = this.surfaceDrag;
      const edited = drag.target === "node"
        ? moveSurfaceNode(drag.feature, drag.nodeIndex, point)
        : moveSurfaceHandle(drag.feature, drag.nodeIndex, drag.target, point, !event.altKey);
      this.surfaceDraft = edited;
      this.terrainPreview = editor.onPreviewSurfaceFeatureEdit(edited);
      this.publishEditor();
    } else if (this.fineGreenStroke?.pointerId === event.pointerId && editor.onPreviewFineGreenStroke) {
      event.preventDefault(); event.stopImmediatePropagation();
      this.extendStroke(this.fineGreenStroke, point);
      this.fineGreenPreview = editor.onPreviewFineGreenStroke(this.fineGreenStroke.points);
      this.publishEditor();
    } else if (this.terrainStroke?.pointerId === event.pointerId && editor.onPreviewTerrainStroke) {
      event.preventDefault(); event.stopImmediatePropagation();
      this.extendStroke(this.terrainStroke, point);
      this.terrainPreview = editor.onPreviewTerrainStroke(this.terrainStroke.points);
      this.publishEditor();
    } else if (editor.terrainTool === "spline" && this.splineDraft.length && editor.onPreviewTerrainStroke) {
      this.splineHover = point;
      this.terrainPreview = editor.onPreviewTerrainStroke([...this.splineDraft, point]);
      this.publishEditor();
    }
  };

  private handleEditorPointerUp = (event: PointerEvent): void => {
    if (this.destroyed) return;
    const editor = this.config.editor;
    if (this.surfaceDrag?.pointerId === event.pointerId) {
      event.preventDefault(); event.stopImmediatePropagation();
      const point = this.canvasPoint(event);
      if (point && editor.onPreviewSurfaceFeatureEdit) {
        const drag = this.surfaceDrag;
        this.surfaceDraft = drag.target === "node"
          ? moveSurfaceNode(drag.feature, drag.nodeIndex, point)
          : moveSurfaceHandle(drag.feature, drag.nodeIndex, drag.target, point, !event.altKey);
        this.terrainPreview = editor.onPreviewSurfaceFeatureEdit(this.surfaceDraft);
      }
      if (this.surfaceDraft) editor.onCommitSurfaceFeatureEdit?.(this.surfaceDraft);
      this.surfaceDrag = null;
      this.surfaceDraft = null;
      this.terrainPreview = null;
    } else if (this.fineGreenStroke?.pointerId === event.pointerId) {
      event.preventDefault(); event.stopImmediatePropagation();
      const point = this.canvasPoint(event);
      if (point) this.extendStroke(this.fineGreenStroke, point);
      editor.onCommitFineGreenStroke?.(this.fineGreenStroke.points);
      this.fineGreenStroke = null;
      this.fineGreenPreview = null;
    } else if (this.terrainStroke?.pointerId === event.pointerId) {
      event.preventDefault(); event.stopImmediatePropagation();
      const point = this.canvasPoint(event);
      if (point) this.extendStroke(this.terrainStroke, point);
      editor.onCommitTerrainStroke?.(this.terrainStroke.points);
      this.terrainStroke = null;
      this.terrainPreview = null;
    } else return;
    if (this.ports.element.hasPointerCapture?.(event.pointerId)) this.ports.element.releasePointerCapture(event.pointerId);
    this.publishEditor();
  };

  private handleEditorPointerCancel = (event: PointerEvent): void => {
    if (this.destroyed) return;
    if (this.terrainStroke?.pointerId !== event.pointerId && this.fineGreenStroke?.pointerId !== event.pointerId && this.surfaceDrag?.pointerId !== event.pointerId) return;
    event.stopImmediatePropagation();
    this.cancelEditorGesture();
  };

  private handleEditorKeyDown(event: KeyboardEvent): boolean {
    const editor = this.config.editor;
    if (event.key === "Escape") {
      const ownsEscape = Boolean(this.terrainStroke || this.fineGreenStroke || this.surfaceDrag
        || this.surfaceDraft || this.splineDraft.length
        || (editor.terrainTool === "edit" && this.selectedFeatureId));
      if (!ownsEscape) return false;
      this.cancelEditorGesture();
      if (this.splineDraft.length) {
        this.splineDraft = [];
        this.splineHover = null;
        this.terrainPreview = null;
        this.publishEditor();
      } else if (editor.terrainTool === "edit" && this.selectedFeatureId) {
        this.selectedFeatureId = null;
        this.selectedNode = null;
        this.publishEditor();
      }
      return true;
    }
    if (editor.terrainTool === "spline" && event.key === "Enter" && this.splineDraft.length >= 2) {
      event.preventDefault();
      editor.onCommitTerrainStroke?.(this.splineDraft);
      this.splineDraft = [];
      this.splineHover = null;
      this.terrainPreview = null;
      this.publishEditor();
      return true;
    }
    if (editor.terrainTool === "spline" && event.key === "Backspace" && this.splineDraft.length) {
      event.preventDefault();
      this.splineDraft = this.splineDraft.slice(0, -1);
      this.terrainPreview = this.splineDraft.length && editor.onPreviewTerrainStroke
        ? editor.onPreviewTerrainStroke(this.splineHover ? [...this.splineDraft, this.splineHover] : this.splineDraft)
        : null;
      this.publishEditor();
      return true;
    }
    if (editor.terrainTool === "edit" && (event.key === "Delete" || event.key === "Backspace")
      && this.selectedFeatureId && this.selectedNode != null) {
      const feature = this.featureForId(this.selectedFeatureId);
      const edited = feature ? deleteSurfaceNode(feature, this.selectedNode) : null;
      if (!edited) return false;
      event.preventDefault();
      const preview = editor.onPreviewSurfaceFeatureEdit?.(edited) ?? null;
      this.terrainPreview = preview;
      if (preview?.affordable) {
        editor.onCommitSurfaceFeatureEdit?.(edited);
        this.selectSurface(edited.id, Math.min(this.selectedNode, surfaceFeaturePoints(edited).length - 1));
      }
      this.terrainPreview = null;
      this.publishEditor();
      return true;
    }
    return false;
  }

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.flyover) return this.endFlyover();
    this.cancelOpeningFollow();
    this.applyZoomInput(normalizeWheelDelta(event.deltaY, event.deltaMode, this.ports.app.screen.height), event.clientX, event.clientY);
  };

  private handleGestureStart = (event: Event): void => {
    event.preventDefault();
    const gesture = event as Event & { scale?: number };
    this.gestureScale = Number.isFinite(gesture.scale) && gesture.scale! > 0 ? gesture.scale! : 1;
    if (this.flyover) this.endFlyover();
    this.cancelOpeningFollow();
  };

  private handleGestureChange = (event: Event): void => {
    event.preventDefault();
    if (this.flyover) return this.endFlyover();
    this.cancelOpeningFollow();
    const gesture = event as Event & { scale?: number; clientX?: number; clientY?: number };
    const nextScale = Number.isFinite(gesture.scale) && gesture.scale! > 0 ? gesture.scale! : this.gestureScale;
    const rect = this.ports.element.getBoundingClientRect();
    this.applyZoomInput(
      gestureScaleToWheelDelta(nextScale / this.gestureScale),
      gesture.clientX ?? rect.left + rect.width / 2,
      gesture.clientY ?? rect.top + rect.height / 2,
    );
    this.gestureScale = nextScale;
  };

  private handleGestureEnd = (event: Event): void => {
    event.preventDefault();
    this.gestureScale = 1;
  };

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 1 && event.button !== 2) return;
    event.preventDefault();
    if (this.flyover) return this.endFlyover();
    this.cancelOpeningFollow();
    this.pan = { gx: event.clientX, gy: event.clientY, cx: this.camera.cx, cy: this.camera.cy, pointerId: event.pointerId };
    this.ports.element.setPointerCapture(event.pointerId);
    this.ports.element.style.cursor = "grabbing";
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const rect = this.ports.element.getBoundingClientRect();
    this.edgePointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (!this.pan) return;
    const startIso = worldToIso(this.pan.cx, this.pan.cy, 0, this.rotation);
    const tile = isoToWorld(
      startIso.x - (event.clientX - this.pan.gx) / this.camera.zoom,
      startIso.y - (event.clientY - this.pan.gy) / this.camera.zoom,
      this.rotation,
    );
    const center = this.clampCenter(tile.x, tile.y, this.camera.zoom);
    this.camera.cx = this.camera.tcx = center.x;
    this.camera.cy = this.camera.tcy = center.y;
    this.applyCamera();
    this.invalidateOverlay();
  };

  private handlePointerUp = (event: PointerEvent): void => {
    if (!this.pan || this.pan.pointerId !== event.pointerId) return;
    this.pan = null;
    if (this.ports.element.hasPointerCapture?.(event.pointerId)) this.ports.element.releasePointerCapture(event.pointerId);
    this.ports.element.style.cursor = "crosshair";
    this.reportCamera();
  };

  private handlePointerLeave = (): void => { this.edgePointer = null; };
  private handleContextMenu = (event: MouseEvent): void => event.preventDefault();
  private handleBlur = (): void => this.keys.clear();

  private handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (typeof target?.closest === "function" && target.closest("input, textarea, select, [contenteditable=true]")) return;
    const binding = bindingFromEvent(event);
    const panActions: BindingAction[] = ["panUp", "panDown", "panLeft", "panRight"];
    const panAction = panActions.find((action) => this.config.keybindings[action] === binding);
    if (this.flyover) {
      if (event.code === "Escape" || panAction || binding === this.config.keybindings.rotateLeft || binding === this.config.keybindings.rotateRight) {
        this.endFlyover();
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (this.handleEditorKeyDown(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (panAction || binding === this.config.keybindings.rotateLeft || binding === this.config.keybindings.rotateRight) this.cancelOpeningFollow();
    if (!this.config.cameraState && !event.repeat && event.code === "KeyF") {
      this.fitWholeCourse(false);
      event.preventDefault();
    } else if (panAction) {
      this.keys.add(panAction);
      event.preventDefault();
    } else if (!event.repeat && !this.rotationTween && (binding === this.config.keybindings.rotateLeft || binding === this.config.keybindings.rotateRight)) {
      const right = binding === this.config.keybindings.rotateRight;
      const next = nextRotation(this.rotation, right ? 1 : -1);
      if (!this.config.animationsEnabled) {
        this.rotation = next;
        this.applyCamera();
        this.invalidateOverlay();
        this.config.onRotationCommit(next);
      } else {
        this.rotationTween = { start: this.now(), toDeg: right ? -90 : 90, next };
      }
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    for (const action of ["panUp", "panDown", "panLeft", "panRight"] as BindingAction[]) {
      if (this.config.keybindings[action].endsWith(event.code)) this.keys.delete(action);
    }
  };

  private handleStagePointerDown = (event: ViewportGameplayPointerEvent): void => {
    if (event.button !== 0) return;
    if (this.flyover) {
      event.stopImmediatePropagation();
      this.endFlyover();
      return;
    }
    this.config.onPrimaryPointer?.(event, this);
  };

  private handleStagePointerMove = (event: ViewportGameplayPointerEvent): void => {
    const tile = this.screenToTile(event.global.x, event.global.y);
    this.hover = tile;
    const changed = this.ports.overlay()?.setHover(tile) ?? true;
    if (changed) {
      this.config.updateCursor?.(tile);
      this.invalidateOverlay();
    }
  };

  private handleStagePointerCancel = (event: ViewportGameplayPointerEvent): void => this.config.onPointerCancel?.(event);
  private tickFromTicker = (ticker: { deltaMS: number }): void => this.tick(ticker.deltaMS);

  private attach(): void {
    const { element, app } = this.ports;
    element.addEventListener("wheel", this.handleWheel, { passive: false });
    element.addEventListener("gesturestart", this.handleGestureStart, { passive: false });
    element.addEventListener("gesturechange", this.handleGestureChange, { passive: false });
    element.addEventListener("gestureend", this.handleGestureEnd, { passive: false });
    element.addEventListener("pointerdown", this.handlePointerDown);
    element.addEventListener("pointermove", this.handlePointerMove);
    element.addEventListener("pointerup", this.handlePointerUp);
    element.addEventListener("pointercancel", this.handlePointerUp);
    element.addEventListener("pointerleave", this.handlePointerLeave);
    element.addEventListener("contextmenu", this.handleContextMenu);
    element.addEventListener("pointerdown", this.handleEditorPointerDown, true);
    element.addEventListener("pointermove", this.handleEditorPointerMove, true);
    element.addEventListener("pointerup", this.handleEditorPointerUp, true);
    element.addEventListener("pointercancel", this.handleEditorPointerCancel, true);
    window.addEventListener("keydown", this.handleKeyDown, true);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("blur", this.handleBlur);
    this.pointerEvents.on("pointerdown", this.handleStagePointerDown);
    this.pointerEvents.on("pointermove", this.handleStagePointerMove);
    this.pointerEvents.on("pointercancel", this.handleStagePointerCancel);
    app.ticker.add(this.tickFromTicker);
    const Observer = this.ports.resizeObserver ?? globalThis.ResizeObserver;
    if (Observer) {
      this.resizeObserver = new Observer(this.resize);
      this.resizeObserver.observe(element);
    }
  }
}
