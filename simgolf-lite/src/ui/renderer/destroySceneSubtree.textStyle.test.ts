import { describe, expect, it, vi } from "vitest";
import { Container, Text, TextStyle, Texture, TextureSource } from "pixi.js";
import { destroySceneSubtree } from "./destroySceneSubtree";

function makeText(style: TextStyle, value = "$"): Text {
  return new Text({ text: value, style });
}

describe("Text style subscription lifetime", () => {
  it("releases the destroyed Text's update subscription without destroying its style", () => {
    const style = new TextStyle({ fontFamily: "Arial", fontSize: 16, fill: 0x123456 });
    const text = makeText(style);
    const destroyStyle = vi.spyOn(style, "destroy");
    expect(style.listenerCount("update")).toBe(1);

    destroySceneSubtree(text);

    expect(text.destroyed).toBe(true);
    expect(style.listenerCount("update")).toBe(0);
    expect(destroyStyle).not.toHaveBeenCalled();
    expect(style.fontSize).toBe(16);
    expect(style.fill).toBe(0x123456);
    style.destroy();
  });

  it("keeps a sibling subscribed and responding to the shared style", () => {
    const style = new TextStyle({ fontSize: 16 });
    const doomed = makeText(style);
    const sibling = makeText(style, "!");
    expect(style.listenerCount("update")).toBe(2);

    destroySceneSubtree(doomed);
    expect(style.listenerCount("update")).toBe(1);
    sibling.didViewUpdate = false;
    style.fontSize = 20;

    expect(sibling.didViewUpdate).toBe(true);
    expect(sibling.style).toBe(style);
    expect(sibling.destroyed).toBe(false);
    destroySceneSubtree(sibling);
    expect(style.listenerCount("update")).toBe(0);
    style.destroy();
  });

  it("preserves identical callbacks registered under other contexts", () => {
    const style = new TextStyle({ fontSize: 16 });
    const doomed = makeText(style);
    const sibling = makeText(style, "!");
    const thirdParty = {};
    const contexts: unknown[] = [];
    function callback(this: unknown): void { contexts.push(this); }
    style.on("update", callback, doomed);
    style.on("update", callback, sibling);
    style.on("update", callback, thirdParty);
    expect(style.listenerCount("update")).toBe(5);

    destroySceneSubtree(doomed);
    expect(style.listenerCount("update")).toBe(3);
    style.fontSize = 19;

    expect(contexts).toEqual([sibling, thirdParty]);
    expect(sibling.didViewUpdate).toBe(true);
    destroySceneSubtree(sibling);
    expect(style.listenerCount("update")).toBe(1);
    style.fontSize = 21;
    expect(contexts.at(-1)).toBe(thirdParty);
    style.off("update", callback, thirdParty);
    style.destroy();
  });

  it("detaches each Text descendant before disposing a nested tree", () => {
    const style = new TextStyle({ fontSize: 16 });
    const root = new Container();
    const branch = root.addChild(new Container());
    const first = branch.addChild(makeText(style));
    const second = root.addChild(makeText(style, "!"));
    const otherUpdate = vi.fn();
    style.on("update", otherUpdate, {});

    destroySceneSubtree(root);

    expect(root.destroyed).toBe(true);
    expect(branch.destroyed).toBe(true);
    expect(first.destroyed).toBe(true);
    expect(second.destroyed).toBe(true);
    expect(style.listenerCount("update")).toBe(1);
    style.fontSize = 22;
    expect(otherUpdate).toHaveBeenCalledOnce();
    style.destroy();
  });

  it("uses only the current style after the Text setter detaches the old one", () => {
    const oldStyle = new TextStyle({ fontSize: 16 });
    const currentStyle = new TextStyle({ fontSize: 18 });
    const doomed = makeText(oldStyle);
    const sibling = makeText(oldStyle, "!");
    doomed.style = currentStyle;
    expect(oldStyle.listenerCount("update")).toBe(1);
    expect(currentStyle.listenerCount("update")).toBe(1);

    destroySceneSubtree(doomed);

    expect(oldStyle.listenerCount("update")).toBe(1);
    expect(currentStyle.listenerCount("update")).toBe(0);
    sibling.didViewUpdate = false;
    oldStyle.fontSize = 24;
    expect(sibling.didViewUpdate).toBe(true);
    destroySceneSubtree(sibling);
    oldStyle.destroy();
    currentStyle.destroy();
  });

  it("preserves borrowed style textures and texture sources", () => {
    const source = new TextureSource({ width: 1, height: 1 });
    const texture = new Texture({ source });
    const style = new TextStyle({ fill: { texture } });
    const text = makeText(style);
    const destroyTexture = vi.spyOn(texture, "destroy");
    const destroySource = vi.spyOn(source, "destroy");
    const destroyStyle = vi.spyOn(style, "destroy");

    destroySceneSubtree(text);

    expect(style.listenerCount("update")).toBe(0);
    expect(destroyStyle).not.toHaveBeenCalled();
    expect(destroyTexture).not.toHaveBeenCalled();
    expect(destroySource).not.toHaveBeenCalled();
    expect(style.fill).toMatchObject({ texture });
    style.destroy();
    texture.destroy(true);
  });

  it("does not read the style getter again after destruction", () => {
    const style = new TextStyle({ fontSize: 16 });
    const text = makeText(style);
    const getter = vi.spyOn(text, "style", "get");
    destroySceneSubtree(text);
    getter.mockClear();

    destroySceneSubtree(text);

    expect(getter).not.toHaveBeenCalled();
    getter.mockRestore();
    style.destroy();
  });
});
