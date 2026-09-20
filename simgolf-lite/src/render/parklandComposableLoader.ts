import { Assets, Rectangle, Texture } from "pixi.js";
import type { AtlasQuality } from "./atlasManifest";
import { PARKLAND_PAIR_ATLAS_COLUMNS, PARKLAND_PAIR_ATLAS_ROLES } from "./parklandComposableAssets/pairAtlas";

const sourceLoaders = {
  high: () => import("./parklandComposableAssets/high"),
  medium: () => import("./parklandComposableAssets/medium"),
  low: () => import("./parklandComposableAssets/low"),
} as const;

export async function loadParklandComposableFields(
  quality: AtlasQuality,
  bundleKey: string,
  destination: Map<string, Texture>,
): Promise<void> {
  const [source, runtime] = await Promise.all([
    sourceLoaders[quality](),
    import("../game/render/parklandComposable"),
  ]);
  const urls = source.default;
  const [fields, pairAtlas] = await Promise.all([Promise.all([
    ["undercoat", urls.undercoat] as const,
    ...runtime.PARKLAND_COMPOSABLE_SEMANTICS.map((semantic) => [semantic, urls.semantics[semantic]] as const),
  ].map(async ([role, url]) => {
    const source = await Assets.load(url) as Texture;
    const semantic = runtime.PARKLAND_COMPOSABLE_SEMANTICS.find((candidate) => candidate === role);
    const texture = semantic ? runtime.createParklandMotifTexture(source, semantic, quality) : source;
    texture.source.style.addressMode = "repeat";
    texture.source.style.scaleMode = "nearest";
    return [role, texture] as const;
  })), Assets.load(urls.pairAtlas) as Promise<Texture>]);
  for (const [role, texture] of fields) destination.set(`${bundleKey}:${role}`, texture);
  pairAtlas.source.style.addressMode = "clamp-to-edge";
  pairAtlas.source.style.scaleMode = "nearest";
  const [width, height] = urls.pairFrame;
  for (const [index, role] of PARKLAND_PAIR_ATLAS_ROLES.entries()) {
    const texture = new Texture({
      source: pairAtlas.source,
      frame: new Rectangle(
        index % PARKLAND_PAIR_ATLAS_COLUMNS * width,
        Math.floor(index / PARKLAND_PAIR_ATLAS_COLUMNS) * height,
        width,
        height,
      ),
      label: `parkland-pair:${quality}:${role}`,
    });
    destination.set(`${bundleKey}:${role}`, texture);
  }
}
