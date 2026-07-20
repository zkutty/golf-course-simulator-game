import { describe, expect, it } from "vitest";
import { DEFAULT_KEYBINDINGS, bindingFromEvent, findBindingConflict, normalizeKeybindings } from "./keybindings";

describe("keybindings", () => {
  it("normalizes partial registries", () => expect(normalizeKeybindings({ pause: "KeyP" })).toEqual({ ...DEFAULT_KEYBINDINGS, pause: "KeyP" }));
  it("canonicalizes modifiers", () => expect(bindingFromEvent({ code: "KeyS", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe("Ctrl+KeyS"));
  it("blocks duplicate bindings", () => {
    expect(findBindingConflict(DEFAULT_KEYBINDINGS, "pause", "KeyW")).toBe("panUp");
    expect(findBindingConflict(DEFAULT_KEYBINDINGS, "pause", "KeyP")).toBeNull();
  });
});
