import {
  Graphics, StencilMask, StencilMaskPipe, GlStencilSystem, GlColorMaskSystem,
  GlRenderTargetAdaptor, GraphicsPipe, GlGraphicsAdaptor, ViewContainer,
  AbstractRenderer,
  Application,
  Container,
  GlobalUniformSystem,
  GlMeshAdaptor,
  Mesh,
  MeshGeometry,
  MeshPipe,
  State,
  RenderGroupSystem,
  RenderTargetSystem,
  RendererType,
  ViewSystem,
  WebGLRenderer,
} from "pixi.js";

// This guard describes only Pixi 8.14.3's default root-canvas WebGL mesh path.
// It does not read active uniforms: they may still describe an earlier render.
// A caller must restore the original indices whenever the result is null.
type Affine = { a: number; b: number; c: number; d: number; tx: number; ty: number };
type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
const extentBrand = Symbol("root-stage-full-geometry-extent");
const unit32 = 2 ** -24;
const unit64 = 2 ** -53;
const stepBits = new DataView(new ArrayBuffer(8));

export type FullGeometryExtent = Readonly<Bounds & {
  readonly [extentBrand]: true;
  readonly mesh: Mesh<MeshGeometry>;
  readonly geometry: MeshGeometry;
  readonly positions: Float32Array;
  readonly positionUpdateId: number;
}>;

export type KnownRootStageViewport = Readonly<{
  local: Bounds;
  screenErrorPx: number;
  worldToScreen: Affine;
}>;

function finite(...values: number[]): boolean {
  return values.every(Number.isFinite);
}

function nextUp(value: number): number {
  if (!Number.isFinite(value) || value === Infinity) return value;
  if (value === 0) return Number.MIN_VALUE;
  stepBits.setFloat64(0, value);
  stepBits.setBigUint64(0, stepBits.getBigUint64(0) + (value > 0 ? 1n : -1n));
  return stepBits.getFloat64(0);
}

function nextDown(value: number): number {
  return -nextUp(-value);
}

const gamma64 = nextUp(64 * unit32 / (1 - 64 * unit32));
const gamma64Double = nextUp(64 * unit64 / (1 - 64 * unit64));

function upAdd(left: number, right: number): number {
  return nextUp(left + right);
}

function upMul(left: number, right: number): number {
  return nextUp(left * right);
}

function affineOf(matrix: Affine): Affine {
  return { a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, tx: matrix.tx, ty: matrix.ty };
}

function identity(matrix: Affine): boolean {
  return matrix.a === 1 && matrix.b === 0 && matrix.c === 0
    && matrix.d === 1 && matrix.tx === 0 && matrix.ty === 0;
}

function updatedLocal(container: Container): Affine {
  container.updateLocalTransform();
  return affineOf(container.localTransform);
}

function positionUpdateId(geometry: MeshGeometry): number {
  return (geometry.attributes.aPosition.buffer as { _updateID?: number })._updateID ?? NaN;
}

/** Scan once at registration, over every original Float32 vertex (including unused vertices). */
export function scanFullGeometryExtent(mesh: Mesh<MeshGeometry>): FullGeometryExtent | null {
  if (!(mesh instanceof Mesh) || !(mesh.geometry instanceof MeshGeometry)) return null;
  const geometry = mesh.geometry;
  const positions = geometry.positions;
  const updateId = positionUpdateId(geometry);
  if (!(positions instanceof Float32Array) || positions.length < 2
    || positions.length % 2 !== 0 || !Number.isSafeInteger(updateId)) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 2) {
    const x = positions[i];
    const y = positions[i + 1];
    if (!finite(x, y)) return null;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Object.freeze({
    minX, minY, maxX, maxY, mesh, geometry, positions,
    positionUpdateId: updateId, [extentBrand]: true as const,
  });
}

function quantized(matrix: Affine): Affine {
  return {
    a: Math.fround(matrix.a), b: Math.fround(matrix.b),
    c: Math.fround(matrix.c), d: Math.fround(matrix.d),
    tx: Math.fround(matrix.tx), ty: Math.fround(matrix.ty),
  };
}

function composed(left: Affine, right: Affine): Affine {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    tx: left.a * right.tx + left.c * right.ty + left.tx,
    ty: left.b * right.tx + left.d * right.ty + left.ty,
  };
}

function conservativeError(bounds: Bounds, fresh: Affine, projection: Affine,
  quantizedCamera: Affine, width: number, height: number): number {
  const projected = composed(projection, quantizedCamera);
  const maxAbsX = Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX));
  const maxAbsY = Math.max(Math.abs(bounds.minY), Math.abs(bounds.maxY));
  let disagreement = 0;
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      const freshX = fresh.a * x + fresh.c * y + fresh.tx;
      const freshY = fresh.b * x + fresh.d * y + fresh.ty;
      const projectedX = (projected.a * x + projected.c * y + projected.tx + 1) * width / 2;
      const projectedY = (1 - projected.b * x - projected.d * y - projected.ty) * height / 2;
      disagreement = Math.max(disagreement, Math.abs(projectedX - freshX), Math.abs(projectedY - freshY));
    }
  }
  const m = quantizedCamera;
  const p = projection;
  const majorX = upAdd(upAdd(upMul(Math.abs(m.a), maxAbsX), upMul(Math.abs(m.c), maxAbsY)), Math.abs(m.tx));
  const majorY = upAdd(upAdd(upMul(Math.abs(m.b), maxAbsX), upMul(Math.abs(m.d), maxAbsY)), Math.abs(m.ty));
  const clipX = upAdd(upAdd(upMul(Math.abs(p.a), majorX), upMul(Math.abs(p.c), majorY)), Math.abs(p.tx));
  const clipY = upAdd(upAdd(upMul(Math.abs(p.b), majorX), upMul(Math.abs(p.d), majorY)), Math.abs(p.ty));
  const gpuMajorPx = Math.max(upMul(clipX, width / 2), upMul(clipY, height / 2));
  const freshMajorX = upAdd(upAdd(upMul(Math.abs(fresh.a), maxAbsX),
    upMul(Math.abs(fresh.c), maxAbsY)), Math.abs(fresh.tx));
  const freshMajorY = upAdd(upAdd(upMul(Math.abs(fresh.b), maxAbsX),
    upMul(Math.abs(fresh.d), maxAbsY)), Math.abs(fresh.ty));
  const gpuRoundoff = upMul(gamma64, gpuMajorPx);
  const cpuRoundoff = upMul(gamma64Double, Math.max(gpuMajorPx, freshMajorX, freshMajorY));
  return upAdd(upAdd(nextUp(disagreement), gpuRoundoff), cpuRoundoff);
}

function supportedRenderer(app: Application): { width: number; height: number } | null {
  const renderer = app.renderer;
  if (!(renderer instanceof WebGLRenderer) || renderer.type !== RendererType.WEBGL
    || renderer.render !== AbstractRenderer.prototype.render
    || app.render !== Application.prototype.render
    || !(renderer.renderGroup instanceof RenderGroupSystem)
    || (renderer.renderGroup as unknown as { render: unknown }).render
      !== (RenderGroupSystem.prototype as unknown as { render: unknown }).render
    || !(renderer.renderTarget instanceof RenderTargetSystem)
    || renderer.renderTarget.bind !== RenderTargetSystem.prototype.bind
    || !(renderer.globalUniforms instanceof GlobalUniformSystem)
    || renderer.globalUniforms.start !== GlobalUniformSystem.prototype.start
    || !(renderer.view instanceof ViewSystem)
    || renderer._roundPixels !== 0 || renderer.resolution !== 1) return null;
  const pipe = renderer.renderPipes.mesh;
  if (!(pipe instanceof MeshPipe) || pipe.execute !== MeshPipe.prototype.execute
    || pipe.renderer !== renderer) return null;
  const adaptor = (pipe as unknown as { _adaptor?: unknown })._adaptor;
  if (!(adaptor instanceof GlMeshAdaptor)
    || adaptor.execute !== GlMeshAdaptor.prototype.execute) return null;
  const gl = renderer.gl;
  let highp: WebGLShaderPrecisionFormat | null | undefined;
  try {
    highp = gl?.getShaderPrecisionFormat?.(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
  } catch {
    return null;
  }
  if (!highp || highp.precision < 23) return null;
  const view = renderer.view;
  const target = view.renderTarget;
  const source = view.texture.source;
  const frame = view.texture.frame;
  const width = app.screen.width;
  const height = app.screen.height;
  if (!finite(width, height) || width <= 0 || height <= 0
    || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || app.screen.x !== 0 || app.screen.y !== 0
    || app.canvas !== view.canvas || source.resource !== app.canvas
    || target.isRoot !== true || target.colorTexture !== source
    || source.resolution !== 1 || target.resolution !== 1
    || source.pixelWidth !== width || source.pixelHeight !== height
    || target.pixelWidth !== width || target.pixelHeight !== height
    || app.canvas.width !== width || app.canvas.height !== height
    || frame.x !== 0 || frame.y !== 0 || frame.width !== width || frame.height !== height) return null;
  return { width, height };
}

/**
 * Qualify the *next* normal app.render() root-stage mesh draw, including the
 * first populated frame. Null means render every original index. Never use
 * this result for render-to-texture, a custom render call, or a later frame.
 */
export function knownRootStageViewport(app: Application, world: Container,
  mesh: Mesh<MeshGeometry>, extent: FullGeometryExtent): KnownRootStageViewport | null {
  return rootViewport(app, world, mesh, extent);
}

function rootViewport(app: Application, world: Container,
  mesh: Mesh<MeshGeometry>, extent: FullGeometryExtent,
  owned?: OwnedStencilViewportProof): KnownRootStageViewport | null {
  if (!(app instanceof Application) || !(world instanceof Container)
    || !(mesh instanceof Mesh) || !(mesh.geometry instanceof MeshGeometry)
    || extent?.[extentBrand] !== true || extent.mesh !== mesh
    || extent.geometry !== mesh.geometry || extent.positions !== mesh.geometry.positions
    || extent.positionUpdateId !== positionUpdateId(mesh.geometry)
    || mesh.geometry.topology !== "triangle-list" || mesh.renderPipeId !== "mesh"
    || mesh.shader !== null || mesh.batched || mesh.roundPixels) return null;
  const dimensions = supportedRenderer(app);
  if (!dimensions || app.stage.parent !== null || world.parent !== app.stage
    || world.rotation !== 0 || (app.stage.renderGroup != null
      && (app.stage.renderGroup.root !== app.stage
        || app.stage.renderGroup.renderGroupParent != null))) return null;
  let node: Container | null = mesh;
  let seenWorld = false;
  while (node) {
    // The generic entry point always rejects masks/effects, unchanged.
    if (((node.effects?.length !== 0 || node.mask != null) && !(node === mesh && owned))
      || (node !== app.stage && node.renderGroup)) return null;
    const local = updatedLocal(node);
    if (!finite(local.a, local.b, local.c, local.d, local.tx, local.ty)) return null;
    if (node === world) {
      seenWorld = true;
      if (local.a <= 0 || local.d !== local.a || local.b !== 0 || local.c !== 0) return null;
    } else if (!identity(local)) return null;
    if (node === app.stage) break;
    node = node.parent;
  }
  if (!seenWorld || node !== app.stage) return null;
  const fresh = updatedLocal(world);
  const { width, height } = dimensions;
  const projection = quantized({ a: 2 / width, b: 0, c: 0, d: -2 / height, tx: -1, ty: 1 });
  const camera = quantized(fresh);
  if (!finite(...Object.values(projection), ...Object.values(camera))
    || projection.a <= 0 || projection.d >= 0 || camera.a <= 0 || camera.d <= 0) return null;
  const error = conservativeError(extent, fresh, projection, camera, width, height);
  if (!Number.isFinite(error) || error > 0.5) return null;
  // Invert the 2 px AA margin plus the proven <=0.5 px position uncertainty.
  // Bound each subtraction and division outward, rather than relying on a
  // single rounded inverse at the viewport edge.
  const minNumeratorX = nextDown(nextDown(-2.5) - fresh.tx);
  const maxNumeratorX = nextUp(nextUp(width + 2.5) - fresh.tx);
  const minNumeratorY = nextDown(nextDown(-2.5) - fresh.ty);
  const maxNumeratorY = nextUp(nextUp(height + 2.5) - fresh.ty);
  const local = {
    minX: nextDown(minNumeratorX / fresh.a),
    maxX: nextUp(maxNumeratorX / fresh.a),
    minY: nextDown(minNumeratorY / fresh.d),
    maxY: nextUp(maxNumeratorY / fresh.d),
  };
  if (!finite(...Object.values(local)) || local.minX >= local.maxX || local.minY >= local.maxY
    || (minNumeratorX !== 0 && local.minX === 0) || (maxNumeratorX !== 0 && local.maxX === 0)
    || (minNumeratorY !== 0 && local.minY === 0) || (maxNumeratorY !== 0 && local.maxY === 0)) return null;
  return { local, screenErrorPx: error, worldToScreen: fresh };
}


const stencilProofBrand = Symbol("private-owned-stencil-viewport");
export type OwnedStencilViewportProof = Readonly<{
  [stencilProofBrand]: true; mesh: Mesh<MeshGeometry>; mask: Graphics;
  parent: Container; ancestors: readonly Container[]; effect: StencilMask; context: Graphics["context"];
}>;
const stockCulled = Object.getOwnPropertyDescriptor(Container.prototype, "culled")!;
const stock2dState = State.for2d().data;
function sameMethod(value: object, key: string, prototype: object): boolean {
  return Reflect.get(value, key) === Reflect.get(prototype, key);
}
/** Read-only SDK identity checks; no direct use of the @ignore culled setter. */
export function stockOwnedCullingAccessor(mesh: Mesh): boolean {
  let node: object | null = mesh;
  let descriptor: PropertyDescriptor | undefined;
  while (node && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(node, "culled"); node = Object.getPrototypeOf(node); }
  return descriptor?.get === stockCulled.get && descriptor?.set === stockCulled.set
    && sameMethod(mesh, "_onUpdate", Container.prototype);
}
export function stockComponentCullingControls(mesh: Mesh): boolean {
  return stockOwnedCullingAccessor(mesh)
    && sameMethod(mesh, "collectRenderables", Container.prototype)
    && sameMethod(mesh, "collectRenderablesWithEffects", Container.prototype)
    && sameMethod(mesh, "collectRenderablesSimple", ViewContainer.prototype);
}
function ownedStencilSource(proof: OwnedStencilViewportProof): boolean {
  const { mesh, mask, parent, effect, context } = proof;
  return proof[stencilProofBrand] === true
    && proof.ancestors.every((node, index) => !node.destroyed && node.parent === (proof.ancestors[index + 1] ?? null))
    && !mesh.destroyed && !mask.destroyed
    && mesh.parent === parent && mask.parent === parent && mesh.children.length === 0 && mask.children.length === 0
    && mesh.mask === mask && mesh.effects?.length === 1 && mesh.effects?.[0] === effect
    && effect instanceof StencilMask && effect.mask === mask && effect.pipe === "stencilMask"
    && Reflect.get(mesh, "_maskOptions")?.inverse === false
    && mask.context === context && Array.isArray(context.instructions) && !context.customShader && mask.effects?.length === 0 && mask.mask == null
    && !mask.renderGroup && mask.includeInBuild === false && !mask.measurable
    && mesh.state.data === stock2dState && stockComponentCullingControls(mesh)
    && sameMethod(mask, "collectRenderables", Container.prototype)
    && sameMethod(mask, "collectRenderablesSimple", ViewContainer.prototype)
    && sameMethod(mask, "collectRenderablesWithEffects", Container.prototype)
    && identity(updatedLocal(mask));
}
/** Only the private freshly built floor/mask producer opts into this proof. */
export function captureOwnedStencilViewport(mesh: Mesh<MeshGeometry>, mask: Graphics): OwnedStencilViewportProof | null {
  const parent = mesh.parent, effect = mesh.effects?.[0];
  if (!parent || !(mask instanceof Graphics) || !(effect instanceof StencilMask)) return null;
  const ancestors: Container[] = [];
  let node: Container | null = parent;
  while (node) {
    if (ancestors.length >= 64 || ancestors.includes(node)) return null;
    ancestors.push(node); node = node.parent;
  }
  const proof = Object.freeze({ [stencilProofBrand]: true as const, mesh, mask, parent,
    ancestors: Object.freeze(ancestors), effect, context: mask.context });
  return ownedStencilSource(proof) ? proof : null;
}

/** Distinct private path: generic knownRootStageViewport still rejects this mesh. */
export function knownOwnedStencilRootViewport(app: Application, world: Container,
  extent: FullGeometryExtent, proof: OwnedStencilViewportProof): KnownRootStageViewport | null {
  if (!ownedStencilSource(proof) || proof.mesh !== extent.mesh) return null;
  const renderer = app.renderer;
  if (!(renderer instanceof WebGLRenderer) || renderer.gl.isContextLost?.() !== false
    || renderer.background.clearBeforeRender !== true || renderer.background.alpha !== 1
    || app.stage.renderGroup?.isCachedAsTexture || proof.ancestors.at(-1) !== app.stage) return null;
  const pipes = renderer.renderPipes, stencil = pipes.stencilMask;
  const target = renderer.renderTarget, adaptor = target.adaptor;
  const graphics = pipes.graphics;
  if (!graphics) return null;
  const graphicsAdaptor = Reflect.get(graphics, "_adaptor");
  if (!(stencil instanceof StencilMaskPipe) || Reflect.get(stencil, "_renderer") !== renderer
    || (Reflect.get(stencil, "_maskStackHash")?.[renderer.view.renderTarget.uid] ?? 0) !== 0
    || !["push", "pop", "execute"].every(key => sameMethod(stencil, key, StencilMaskPipe.prototype))
    || !(renderer.stencil instanceof GlStencilSystem) || !sameMethod(renderer.stencil, "setStencilMode", GlStencilSystem.prototype)
    || !(renderer.colorMask instanceof GlColorMaskSystem) || !sameMethod(renderer.colorMask, "setMask", GlColorMaskSystem.prototype)
    || !sameMethod(target, "ensureDepthStencil", RenderTargetSystem.prototype)
    || !(adaptor instanceof GlRenderTargetAdaptor) || !sameMethod(adaptor, "startRenderPass", GlRenderTargetAdaptor.prototype)
    || !(graphics instanceof GraphicsPipe) || !sameMethod(graphics, "execute", GraphicsPipe.prototype)
    || !(graphicsAdaptor instanceof GlGraphicsAdaptor) || !sameMethod(graphicsAdaptor, "execute", GlGraphicsAdaptor.prototype)
    || !["_updateRenderGroups", "_buildInstructions"].every(key => sameMethod(renderer.renderGroup, key, RenderGroupSystem.prototype))) return null;
  return rootViewport(app, world, proof.mesh, extent, proof);
}
