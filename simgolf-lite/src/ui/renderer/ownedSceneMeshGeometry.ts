import { Container, Geometry, Mesh } from "pixi.js";

// Only construction sites with exclusive geometry/buffer ownership register.
// Weak keys never retain a completed scene, and borrowed meshes stay unmarked.
const ownedGeometry = new WeakMap<Mesh, Geometry>();

export function ownSceneMeshGeometry<T extends Mesh>(mesh: T): T {
  ownedGeometry.set(mesh, mesh.geometry);
  return mesh;
}

/** Capture before Mesh.destroy() clears its geometry reference. */
export function takeOwnedSceneMeshGeometry(display: Container): Geometry | undefined {
  if (!(display instanceof Mesh)) return undefined;
  const geometry = ownedGeometry.get(display);
  ownedGeometry.delete(display);
  return geometry;
}
