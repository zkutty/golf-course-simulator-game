import { Mesh, MeshGeometry, type Buffer, type Texture } from "pixi.js";

/** A scene-local lease owner; only the two immutable mesh attributes are shared. */
class SharedAttributeBuffers {
  private leases = 0;

  readonly position: Buffer;
  readonly uv: Buffer;

  constructor(position: Buffer, uv: Buffer) {
    this.position = position;
    this.uv = uv;
  }

  retain(): void { this.leases++; }

  release(): void {
    if (--this.leases !== 0) return;
    this.position.destroy();
    this.uv.destroy();
  }
}

/**
 * Keep MeshGeometry identity/layout for the existing viewport and index cohort.
 * Geometry.destroy(true) cannot destroy a live peer's attributes. Each geometry
 * always owns its index buffer; the last lease owns attribute destruction.
 */
class OwnedAttributeGeometry extends MeshGeometry {
  private owner: SharedAttributeBuffers | null;

  constructor(
    positions: Float32Array,
    uvs: Float32Array,
    indices: Uint32Array,
    shared?: SharedAttributeBuffers,
  ) {
    super({
      positions: shared ? new Float32Array(0) : positions,
      uvs: shared ? new Float32Array(0) : uvs,
      indices,
    });
    this.owner = shared ?? new SharedAttributeBuffers(
      this.getBuffer("aPosition"), this.getBuffer("aUV"),
    );
    this.owner.retain();
    if (shared) {
      try {
        this.replaceEmptyAttribute("aPosition", shared.position);
        this.replaceEmptyAttribute("aUV", shared.uv);
        // Preserve the constructor's position, UV, index buffer order too.
        this.buffers.splice(0, this.buffers.length, shared.position, shared.uv, this.indexBuffer);
      } catch (error) {
        this.destroy();
        throw error;
      }
    }
  }

  private replaceEmptyAttribute(name: "aPosition" | "aUV", buffer: Buffer): void {
    const attribute = this.attributes[name];
    const empty = attribute.buffer;
    empty.off("update", this.onBufferUpdate, this);
    empty.off("change", this.onBufferUpdate, this);
    this.buffers.splice(this.buffers.indexOf(empty), 1);
    empty.destroy();
    this.addAttribute(name, { ...attribute, buffer });
  }

  sharedAttributes(): SharedAttributeBuffers { return this.owner!; }

  override destroy(_destroyBuffers = false): void {
    const owner = this.owner;
    if (!owner) return;
    this.owner = null;
    // Geometry.destroy(false) does not detach its attribute subscriptions.
    // Match this receiver so the remaining geometry still receives updates.
    for (const buffer of this.buffers) {
      buffer.off("update", this.onBufferUpdate, this);
      buffer.off("change", this.onBufferUpdate, this);
      // A failed second-peer attribute attachment can leave a private empty
      // placeholder. It is never part of the shared lease owner.
      if (buffer !== owner.position && buffer !== owner.uv && buffer !== this.indexBuffer) {
        buffer.destroy();
      }
    }
    try { super.destroy(false); } finally { owner.release(); }
  }
}

/**
 * Transfer private typed arrays into a scene-local pair without attribute copies.
 * The caller gives up attribute mutation for the entire mesh lifetime. Geometry
 * and index buffers remain independent; textures remain borrowed. This is an
 * internal producer API, not an adapter for externally mutable geometry.
 */
export function createOwnedAttributeMeshPair(
  data: { readonly positions: Float32Array; readonly uvs: Float32Array; readonly indices: Uint32Array },
  textures: readonly [Texture | null, Texture | null],
): [Mesh<MeshGeometry> | null, Mesh<MeshGeometry> | null] {
  const meshes: [Mesh<MeshGeometry> | null, Mesh<MeshGeometry> | null] = [null, null];
  const geometries: OwnedAttributeGeometry[] = [];
  try {
    for (const slot of [0, 1] as const) {
      const texture = textures[slot];
      if (!texture) continue;
      const geometry = new OwnedAttributeGeometry(
        data.positions, data.uvs, geometries.length ? data.indices.slice() : data.indices,
        geometries[0]?.sharedAttributes(),
      );
      geometries.push(geometry);
      const mesh = new Mesh({ geometry, texture });
      mesh.once("destroyed", () => geometry.destroy());
      meshes[slot] = mesh;
    }
    return meshes;
  } catch (error) {
    for (const mesh of meshes) mesh?.destroy();
    for (const geometry of geometries) geometry.destroy();
    throw error;
  }
}

/** Number-array macro inputs are copied once and never retained. */
export function createOwnedMacroMeshes(
  positions: readonly number[],
  uvs: readonly number[],
  indices: readonly number[],
  textures: readonly [Texture | null, Texture | null],
): [Mesh<MeshGeometry> | null, Mesh<MeshGeometry> | null] {
  if (!textures[0] && !textures[1]) return [null, null];
  return createOwnedAttributeMeshPair({
    positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices),
  }, textures);
}
