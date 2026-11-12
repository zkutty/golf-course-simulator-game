import * as PIXI from "pixi.js";

export type OwnedShimmer = Readonly<{
  stage: PIXI.Container;
  world: PIXI.Container;
  layer: PIXI.Container;
  sprite: PIXI.Sprite;
  texture: PIXI.Texture;
  source: PIXI.TextureSource;
}>;

export type OwnedShimmerEvidence =
  | { status: "unqualified"; reason: string }
  | {
    status: "qualified";
    documentTimeOrigin: number;
    rendererUid: number;
    stageUid: number;
    textureUid: number;
    sourceUid: number;
    registered: 0 | 1;
  };

type CurrentRenderer = {
  app: PIXI.Application | null;
  container: HTMLElement | null;
  world: PIXI.Container | null;
  fx: PIXI.Container | null;
  atmosphere: { readOwnedShimmerForTest(): OwnedShimmer | null } | null;
  document: Document;
  documentTimeOrigin: number;
};

type TextureSystem = {
  readonly _renderer?: object;
  readonly managedTextures?: readonly PIXI.TextureSource[];
};

const isUid = (value: number) => Number.isSafeInteger(value) && value >= 0;

function graphicsOwnershipConflict(node: PIXI.Graphics, shimmer: OwnedShimmer) {
  // Pixi draws Graphics from context instructions. Its node.texture is a method.
  const instructions = node.context?.instructions;
  if (!Array.isArray(instructions)) return true;
  for (const instruction of instructions) {
    let texture: PIXI.Texture | null | undefined;
    switch (instruction?.action) {
      case "texture":
        texture = instruction.data?.image;
        break;
      case "fill":
      case "stroke":
        texture = instruction.data?.style?.texture;
        break;
      default:
        return true;
    }
    if (!(texture instanceof PIXI.Texture) || texture.destroyed !== false || !isUid(texture.uid)) return true;
    const source = texture.source;
    if (!(source instanceof PIXI.TextureSource) || source.destroyed !== false || !isUid(source.uid)
      || source === shimmer.source || source.uid === shimmer.source.uid
      || texture === shimmer.texture || texture.uid === shimmer.texture.uid) return true;
  }
  return false;
}

function collectStage(stage: PIXI.Container, shimmer: OwnedShimmer | null) {
  const textures = new Set<PIXI.Texture>();
  const sources = new Set<PIXI.TextureSource>();
  let shimmerAttachments = 0;
  let sharedShimmer = false;
  const counts = { displayObjects: 0, containers: 0, sprites: 0, graphics: 0, meshes: 0, text: 0 };
  const visit = (node: PIXI.Container) => {
    counts.displayObjects++;
    if (node instanceof PIXI.Container) counts.containers++;
    if (node instanceof PIXI.Sprite) counts.sprites++;
    if (node instanceof PIXI.Graphics) counts.graphics++;
    if (node instanceof PIXI.Mesh) counts.meshes++;
    if (node instanceof PIXI.Text) counts.text++;
    // Match the existing raw census, including stock texture getters.
    const texture = (node as PIXI.Container & { texture?: PIXI.Texture }).texture;
    if (texture) {
      const source = texture.source;
      textures.add(texture);
      sources.add(source);
      if (shimmer && (source === shimmer.source || source?.uid === shimmer.source.uid
        || texture === shimmer.texture || texture.uid === shimmer.texture.uid)) {
        if (node === shimmer.sprite && texture === shimmer.texture && source === shimmer.source) shimmerAttachments++;
        else sharedShimmer = true;
      }
    }
    if (shimmer && !sharedShimmer && node instanceof PIXI.Graphics && graphicsOwnershipConflict(node, shimmer)) {
      sharedShimmer = true;
    }
    for (const child of node.children) visit(child);
  };
  visit(stage);
  return {
    counts: { ...counts, attachedTextures: textures.size, attachedTextureSources: sources.size },
    shimmerAttachments,
    sharedShimmer,
  };
}

function registrationCount(managed: readonly PIXI.TextureSource[], source: PIXI.TextureSource) {
  const identities = new Set<number>();
  let count: 0 | 1 = 0;
  for (const entry of managed) {
    if (!(entry instanceof PIXI.TextureSource) || entry.destroyed !== false || !isUid(entry.uid) || identities.has(entry.uid)) return null;
    identities.add(entry.uid);
    if (entry === source) count = 1;
    else if (entry.uid === source.uid) return null;
  }
  return count;
}

/** E2E callbacks use the same raw counts. Only save/load requests owner evidence. */
export function createRendererResourceSnapshots(readCurrent: () => CurrentRenderer) {
  function snapshot(proveOwner: boolean) {
    const current = readCurrent();
    const { app, container, world, fx, atmosphere, document, documentTimeOrigin } = current;
    if (!app?.renderer || !app.stage) return null;
    const { renderer, stage, canvas } = app;
    if (!canvas) return null;
    const shimmer = proveOwner ? atmosphere?.readOwnedShimmerForTest() ?? null : null;
    const { counts, shimmerAttachments, sharedShimmer } = collectStage(stage, shimmer);
    const system = renderer.texture as unknown as TextureSystem | undefined;
    const managed = system?.managedTextures;
    const resources = {
      ...counts,
      managedTextureSources: managed?.length ?? -1,
      canvasConnected: canvas.isConnected,
    };
    const unqualified = (reason: string) => ({ resources, ownedShimmer: { status: "unqualified", reason } as const });
    if (!proveOwner) return unqualified("not-requested");
    if (!container || !world || !fx || stage.destroyed !== false || world.destroyed !== false || fx.destroyed !== false
      || canvas.isConnected !== true || canvas.parentElement !== container || canvas.ownerDocument !== document
      || world.parent !== stage || fx.parent !== world || !Number.isFinite(documentTimeOrigin) || documentTimeOrigin <= 0
      || renderer.name !== "webgl" || system?._renderer !== renderer || !isUid(renderer.uid) || !isUid(stage.uid)) {
      return unqualified("renderer-or-document");
    }
    if (!shimmer || shimmer.stage !== stage || shimmer.world !== world || shimmer.layer !== fx
      || shimmer.sprite.destroyed !== false || shimmer.sprite.parent !== fx || shimmer.sprite.texture !== shimmer.texture
      || shimmer.texture.destroyed !== false || shimmer.texture.source !== shimmer.source || shimmer.source.destroyed !== false
      || !isUid(shimmer.texture.uid) || !isUid(shimmer.source.uid)) return unqualified("shimmer-owner");
    if (shimmerAttachments !== 1 || sharedShimmer) return unqualified("shimmer-attachment");
    if (!Array.isArray(managed)) return unqualified("managed-registry");
    const registered = registrationCount(managed, shimmer.source);
    if (registered === null) return unqualified("managed-registry");
    const after = readCurrent();
    if (after.app !== app || app.renderer !== renderer || app.stage !== stage || app.canvas !== canvas
      || (renderer.texture as unknown) !== system || system.managedTextures !== managed || managed.length !== resources.managedTextureSources
      || after.container !== container || after.world !== world || after.fx !== fx || after.atmosphere !== atmosphere
      || after.document !== document || after.documentTimeOrigin !== documentTimeOrigin) return unqualified("renderer-changed");
    const ownedShimmer: OwnedShimmerEvidence = {
      status: "qualified", documentTimeOrigin, rendererUid: renderer.uid, stageUid: stage.uid,
      textureUid: shimmer.texture.uid, sourceUid: shimmer.source.uid, registered,
    };
    return { resources, ownedShimmer };
  }
  return {
    resourceSnapshot: () => snapshot(false)?.resources ?? null,
    saveLoadResourceSnapshot: () => snapshot(true),
  };
}

export type SaveLoadResourceSnapshot = ReturnType<ReturnType<typeof createRendererResourceSnapshots>["saveLoadResourceSnapshot"]>;
