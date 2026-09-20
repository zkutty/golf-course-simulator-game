import { Assets, type Texture } from "pixi.js";
import type { AtlasQuality } from "./atlasManifest";

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
  const fields = await Promise.all([
    ["undercoat", urls.undercoat] as const,
    ...runtime.PARKLAND_COMPOSABLE_SEMANTICS.map((semantic) => [semantic, urls.semantics[semantic]] as const),
  ].map(async ([role, url]) => {
    const source = await Assets.load(url) as Texture;
    const texture = role === "undercoat"
      ? source
      : runtime.createParklandMotifTexture(source, role, quality);
    texture.source.style.addressMode = "repeat";
    texture.source.style.scaleMode = "nearest";
    return [role, texture] as const;
  }));
  for (const [role, texture] of fields) destination.set(`${bundleKey}:${role}`, texture);
}
