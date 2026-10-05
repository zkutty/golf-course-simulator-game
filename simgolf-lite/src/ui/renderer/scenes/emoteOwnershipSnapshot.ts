import * as PIXI from "pixi.js";
import { EMOTE_MAX_CONCURRENT, type EmoteKind } from "../../../game/render/emotes";

export interface EmoteOwnershipChild {
  uid: number;
  className: "Graphics" | "Text";
  destroyed: false;
  parentIsGroup: true;
  childCount: 0;
  text: string | null;
}
export interface EmoteOwnershipGroup {
  golferId: number;
  builtKind: EmoteKind;
  schedulerKind: EmoteKind;
  uid: number;
  className: "Container";
  destroyed: false;
  parentIsCurrentOverlay: true;
  children: EmoteOwnershipChild[];
}
export interface EmoteOwnershipSnapshot {
  schemaVersion: 1;
  complete: boolean;
  failure: string | null;
  generation: number;
  stageUID: number | null;
  overlayUID: number | null;
  currentOwner: boolean;
  apiIdentityCurrent: boolean;
  ownerCount: number;
  scheduler: { golferId: number; kind: EmoteKind }[];
  groups: EmoteOwnershipGroup[];
  contribution: { displayObjects: number; graphics: number; text: number } | null;
}

const kinds = new Set<EmoteKind>(["star", "happy", "angry", "storm", "zzz", "cashGood", "cashBad", "alert"]);
const validId = (value: number) => Number.isSafeInteger(value) && value >= 0;
let generation = 0; // A scalar identity only; no historical scene/display references.
export const nextEmoteOwnerGeneration = () => ++generation;

export function failedEmoteOwnership(failure: string, generation = 0): EmoteOwnershipSnapshot {
  return { schemaVersion: 1, complete: false, failure, generation, stageUID: null, overlayUID: null,
    currentOwner: false, apiIdentityCurrent: false, ownerCount: 0, scheduler: [], groups: [], contribution: null };
}

/** Bounded read-only projection of the current source owner's exact attached subtrees. */
export function captureEmoteOwnership(input: {
  generation: number;
  stage: PIXI.Container;
  overlay: PIXI.Container;
  currentOwner: boolean;
  apiIdentityCurrent: boolean;
  bubbles: ReadonlyMap<number, PIXI.Container>;
  active: readonly { golferId: number; kind: EmoteKind }[];
  builtKinds: WeakMap<PIXI.Container, EmoteKind>;
}): EmoteOwnershipSnapshot {
  const fail = (code: string) => failedEmoteOwnership(code, input.generation);
  try {
    const { stage, overlay, bubbles, active, builtKinds } = input;
    if (!validId(input.generation) || input.generation === 0 || input.currentOwner !== true || input.apiIdentityCurrent !== true) return fail("not-current-owner-api");
    if (!validId(stage.uid) || !validId(overlay.uid) || stage.uid === overlay.uid || stage.destroyed || overlay.destroyed
      || stage.parent !== null || overlay.parent !== stage || !stage.children.includes(overlay)) return fail("stage-overlay-mismatch");
    if (bubbles.size > EMOTE_MAX_CONCURRENT || active.length > EMOTE_MAX_CONCURRENT) return fail("emote-cap-exceeded");
    if (bubbles.size !== active.length) return fail("scheduler-owner-size-mismatch");
    const activeById = new Map<number, EmoteKind>();
    for (const item of active) {
      if (!validId(item.golferId) || !kinds.has(item.kind) || activeById.has(item.golferId)) return fail("scheduler-identity-kind-mismatch");
      activeById.set(item.golferId, item.kind);
    }
    const seen = new Set([stage.uid, overlay.uid]);
    const groups: EmoteOwnershipGroup[] = [];
    let graphics = 0, text = 0, displayObjects = 0;
    for (const [golferId, group] of bubbles) {
      const builtKind = builtKinds.get(group);
      const schedulerKind = activeById.get(golferId);
      if (!validId(golferId) || !builtKind || !kinds.has(builtKind) || builtKind !== schedulerKind) return fail("built-scheduler-kind-mismatch");
      if (group.constructor !== PIXI.Container || !validId(group.uid) || seen.has(group.uid) || group.destroyed
        || group.parent !== overlay || !overlay.children.includes(group)) return fail("group-identity-parent-mismatch");
      const glyph = builtKind === "zzz" ? "Zz" : builtKind === "alert" ? "!"
        : builtKind === "cashGood" || builtKind === "cashBad" ? "$" : null;
      if (group.children.length !== (glyph === null ? 2 : 3)) return fail("group-shape-mismatch");
      seen.add(group.uid);
      const children: EmoteOwnershipChild[] = [];
      for (const [index, child] of group.children.entries()) {
        const expectedClass = glyph !== null && index === 1 ? "Text" : "Graphics";
        const childUID = child.uid;
        if (!validId(childUID) || seen.has(childUID) || child.destroyed || child.parent !== group || child.children.length !== 0) return fail("child-identity-parent-leaf-mismatch");
        if (child.constructor !== (expectedClass === "Text" ? PIXI.Text : PIXI.Graphics)) return fail("child-class-mismatch");
        const childText = expectedClass === "Text" ? (child as PIXI.Text).text : null;
        if (childText !== (expectedClass === "Text" ? glyph : null)) return fail("child-glyph-mismatch");
        seen.add(childUID);
        children.push({ uid: childUID, className: expectedClass, destroyed: false, parentIsGroup: true, childCount: 0, text: childText });
        if (expectedClass === "Text") text++; else graphics++;
      }
      displayObjects += 1 + children.length;
      groups.push({ golferId, builtKind, schedulerKind: builtKind, uid: group.uid, className: "Container", destroyed: false, parentIsCurrentOverlay: true, children });
    }
    return { schemaVersion: 1, complete: true, failure: null, generation: input.generation,
      stageUID: stage.uid, overlayUID: overlay.uid, currentOwner: true, apiIdentityCurrent: true,
      ownerCount: bubbles.size, scheduler: active.map(({ golferId, kind }) => ({ golferId, kind })),
      groups, contribution: { displayObjects, graphics, text } };
  } catch {
    return fail("emote-projection-exception");
  }
}
