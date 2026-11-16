import { Mesh, type Container } from "pixi.js";
import type { PathMaterialScenePlan } from "./pathMaterialScene";

interface PathLayerContext {
  generation: number;
  quality: PathMaterialScenePlan["quality"];
  planKey: string;
}

export interface ConnectedSurfaceOwnership extends PathLayerContext {
  pathMeshes: number;
  pathTriangles: number;
  otherOwners: number;
  hasVisibleIndexedTerrain: boolean;
}

function liveChild(child: Container, parent: Container): boolean {
  return !child.destroyed && child.parent === parent;
}

function indexedMeshSize(child: Container): number {
  if (!(child instanceof Mesh) || child.destroyed || child.children.length || !child.visible || !child.renderable) return 0;
  const size = child.geometry.getIndex()?.data.length ?? 0;
  return size > 0 && size % 3 === 0 ? size : 0;
}

function hasVisibleIndexedMesh(node: Container, parent: Container): boolean {
  if (!liveChild(node, parent) || !node.visible || !node.renderable || !(node.alpha > 0)) return false;
  return indexedMeshSize(node) > 0 || node.children.some(child => hasVisibleIndexedMesh(child, node));
}

function matchesChildren(parent: Container, witnesses: readonly WeakRef<Container>[]): boolean {
  return parent.children.length === witnesses.length && parent.children.every((child, index) =>
    child === witnesses[index].deref() && liveChild(child, parent));
}

/** An E2E instance follows the existing append and keeps no retired display objects alive. */
export function createPathLayerOwnership() {
  const installed = new WeakMap<Container, {
    context: PathLayerContext;
    owner: WeakRef<Container>;
    directChildren: WeakRef<Container>[];
    pathChildren: WeakRef<Container>[];
    indexSizes: number[];
  }>();

  return {
    observeAttachment(parent: Container, owner: Container, generation: number, plan: PathMaterialScenePlan) {
      installed.delete(parent);
      if (owner.parent || owner.destroyed) return;
      const expectedSizes = plan.layers.map(layer => layer.indices.length).filter(size => size > 0);
      const plannedMeshes = [...owner.children];
      if (plannedMeshes.length !== expectedSizes.length || plannedMeshes.some((child, index) =>
        !liveChild(child, owner) || indexedMeshSize(child) !== expectedSizes[index])) return;
      const context = { generation, quality: plan.quality, planKey: plan.key };
      const coreSize = plan.layers.find(layer => layer.role === "core")?.indices.length ?? 0;
      const reliefMeshes: Mesh[] = [];
      let invalidRelief = false;
      owner.once("added", (actualParent) => {
        if (actualParent !== parent || !liveChild(owner, parent) || !parent.children.includes(owner) || invalidRelief) return;
        const expectedMeshes = [...plannedMeshes, ...reliefMeshes];
        const indexSizes = [...expectedSizes, ...reliefMeshes.map(() => coreSize)];
        if (owner.children.length !== expectedMeshes.length || owner.children.some((child, index) =>
          child !== expectedMeshes[index] || !liveChild(child, owner) || indexedMeshSize(child) !== indexSizes[index])) return;
        installed.set(parent, {
          context,
          owner: new WeakRef(owner),
          directChildren: parent.children.map(child => new WeakRef(child)),
          pathChildren: expectedMeshes.map(child => new WeakRef(child)),
          indexSizes,
        });
      });
      return (mesh: Mesh) => {
        if (owner.parent || context.quality === "low" || !coreSize || !liveChild(mesh, owner)
          || indexedMeshSize(mesh) !== coreSize || reliefMeshes.length === 2
          || plannedMeshes.includes(mesh) || reliefMeshes.includes(mesh)) {
          invalidRelief = true;
          return;
        }
        reliefMeshes.push(mesh);
      };
    },

    read(parent: Container, current: PathLayerContext): ConnectedSurfaceOwnership | null {
      const record = installed.get(parent);
      const owner = record?.owner.deref();
      if (!record || parent.destroyed || !owner || !liveChild(owner, parent) || !owner.visible || !owner.renderable
        || record.context.generation !== current.generation || record.context.quality !== current.quality
        || record.context.planKey !== current.planKey
        || !matchesChildren(parent, record.directChildren) || !matchesChildren(owner, record.pathChildren)
        || owner.children.some((child, index) => indexedMeshSize(child) !== record.indexSizes[index])) return null;
      return {
        ...record.context,
        pathMeshes: record.pathChildren.length,
        pathTriangles: record.indexSizes.reduce((sum, size) => sum + size / 3, 0),
        otherOwners: record.directChildren.length - 1,
        hasVisibleIndexedTerrain: parent.visible && parent.renderable && parent.alpha > 0
          && parent.children.some(child => child !== owner && hasVisibleIndexedMesh(child, parent)),
      };
    },
  };
}
