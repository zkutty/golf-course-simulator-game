import { createRequire } from "node:module";
import * as PIXI from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { destroySceneSubtree } from "../../game/render/destroySceneSubtree";

const implementations = [
  ["esm", PIXI],
  ["cjs", createRequire(import.meta.url)("pixi.js") as typeof PIXI],
] as const;

for (const [format, pixi] of implementations) {
  describe(`installed Pixi ${format} Text style lifetime`, () => {
    for (const path of ["direct", "subtree"] as const) {
      it(`detaches twelve retired ${path} Text listeners while preserving a shared-style peer`, () => {
        const source = new pixi.BufferImageSource({ resource: new Uint8Array(16), width: 2, height: 2 });
        const texture = new pixi.Texture({ source });
        const style = new pixi.TextStyle({ fontSize: 12, fill: { texture } });
        const peer = new pixi.Text({ text: "live peer", style });
        const styleDestroy = vi.spyOn(style, "destroy");
        const textureDestroy = vi.spyOn(texture, "destroy");
        const sourceDestroy = vi.spyOn(source, "destroy");
        const roots: PIXI.Container[] = [];
        const texts: PIXI.Text[] = [];
        expect(style.listenerCount("update")).toBe(1);
        try {
          for (let cycle = 0; cycle < 12; cycle++) {
            const root = new pixi.Container();
            const retired = root.addChild(new pixi.Text({ text: `retired ${cycle}`, style }));
            roots.push(root);
            texts.push(retired);
            expect(style.listenerCount("update")).toBe(2);
            if (path === "direct") retired.destroy();
            else destroySceneSubtree(root);
            expect(retired.destroyed).toBe(true);
            expect(style.listenerCount("update")).toBe(1);
            expect(peer.style).toBe(style);
            peer.didViewUpdate = false;
            style.fontSize = 13 + cycle;
            expect(peer.didViewUpdate).toBe(true);
            expect(peer.style.fontSize).toBe(13 + cycle);
            expect(styleDestroy).not.toHaveBeenCalled();
            expect(textureDestroy).not.toHaveBeenCalled();
            expect(sourceDestroy).not.toHaveBeenCalled();
            expect(texture.source).toBe(source);
            expect(source.destroyed).toBe(false);
          }
          peer.destroy();
          expect(style.listenerCount("update")).toBe(0);
        } finally {
          for (const text of texts) if (!text.destroyed) text.destroy();
          for (const root of roots) destroySceneSubtree(root);
          if (!peer.destroyed) peer.destroy();
          style.destroy();
          texture.destroy(true);
          vi.restoreAllMocks();
        }
      });
    }
  });
}
