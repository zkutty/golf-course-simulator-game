import { afterEach, describe, expect, it, vi } from "vitest";
import { shareBlob } from "./photoCapture";

afterEach(() => vi.unstubAllGlobals());

function globals(share: ReturnType<typeof vi.fn>, clipboard: ReturnType<typeof vi.fn>) {
  const click = vi.fn();
  const revoke = vi.fn();
  vi.stubGlobal("File", class { constructor(_parts: unknown[], _name: string, _options: unknown) {} });
  vi.stubGlobal("ClipboardItem", class { constructor(_parts: unknown) {} });
  vi.stubGlobal("navigator", { share, canShare: () => true, clipboard: { write: clipboard } });
  vi.stubGlobal("document", { createElement: () => ({ click, href: "", download: "" }) });
  vi.stubGlobal("URL", { createObjectURL: () => "blob:download", revokeObjectURL: revoke });
  vi.stubGlobal("window", { setTimeout: (callback: () => void) => { callback(); return 1; } });
  return { click, revoke };
}

describe("PNG share fallbacks", () => {
  it("uses Web Share before clipboard", async () => {
    const share = vi.fn(async () => undefined), clipboard = vi.fn(async () => undefined);
    globals(share, clipboard);
    await expect(shareBlob(new Blob(["png"], { type: "image/png" }), "hole.png", "Hole")).resolves.toBe("shared");
    expect(share).toHaveBeenCalledOnce();
    expect(clipboard).not.toHaveBeenCalled();
  });

  it("uses PNG clipboard when Web Share rejects", async () => {
    const share = vi.fn(async () => { throw new Error("denied"); }), clipboard = vi.fn(async () => undefined);
    globals(share, clipboard);
    await expect(shareBlob(new Blob(["png"], { type: "image/png" }), "hole.png", "Hole")).resolves.toBe("copied");
    expect(clipboard).toHaveBeenCalledOnce();
  });

  it("downloads and revokes the object URL when both share paths reject", async () => {
    const share = vi.fn(async () => { throw new Error("denied"); }), clipboard = vi.fn(async () => { throw new Error("denied"); });
    const { click, revoke } = globals(share, clipboard);
    await expect(shareBlob(new Blob(["png"], { type: "image/png" }), "hole.png", "Hole")).resolves.toBe("downloaded");
    expect(click).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:download");
  });
});
