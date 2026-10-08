import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { BIOME_DEFINITIONS, BIOME_KEYS, biomeCompatibilityMetadataFor, type BiomeDefinition } from "../models/biomes";
import { WILDLIFE_REGISTRY, auditWildlifeOwnership, auditWildlifeRegistry } from "./registry";
import { WILDLIFE_ANIMATION_FAMILIES, WILDLIFE_AUDIO_TARGETS, WILDLIFE_BIOMES, WILDLIFE_DELIVERY_CONTRACT, WILDLIFE_FAMILIES, WILDLIFE_TIER_TARGETS, type WildlifeBundleOwnership } from "./contracts";

const mutable = () => structuredClone(WILDLIFE_REGISTRY) as unknown as Record<string, {
  setting: string;
  ownership: Record<string, unknown>;
  provenance: { status: string; assetReferences: string[]; reviews: Record<string, string> };
  species: Array<Record<string, unknown>>;
}>;
const ownership = () => Object.fromEntries(BIOME_KEYS.map(biome => [biome, structuredClone(BIOME_DEFINITIONS[biome].content.wildlife)]));

describe("ZK-660 staged wildlife authoring contract", () => {
  it("independently matches every published bible row, family, scale, silhouette, anchor and adult range", () => {
    const bible = readFileSync(new URL("../../../docs/WILDLIFE_CONTENT_BIBLE.md", import.meta.url), "utf8");
    const rows = bible.split("\n").filter(line => /^\| [^|]+ \| [^|]+; [^|]+; [GWP/F]+ \| [A-J]/.test(line)).map(line => {
      const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
      const art = cells[1].split(";").map(part => part.trim());
      const group = cells[2].split(";")[1].match(/\d+/g)!.map(Number);
      return { label: cells[0], scales: art[0].split("/"), silhouette: art[1], anchors: art[2].split("/"), family: cells[2][0], adultGroup: { min: group[0], max: group.at(-1) } };
    });
    const entries = WILDLIFE_BIOMES.flatMap(biome => WILDLIFE_REGISTRY[biome].species);
    expect(rows).toHaveLength(35);
    expect(entries.map(({ label, scales, silhouette, anchors, family, adultGroup }) => ({ label, scales, silhouette, anchors, family, adultGroup }))).toEqual(rows);
    expect(WILDLIFE_BIOMES.map(biome => WILDLIFE_REGISTRY[biome].species.length)).toEqual([5, 4, 4, 4, 4, 4, 5, 5]);
    expect([...new Set(entries.map(entry => entry.family))].sort()).toEqual(WILDLIFE_FAMILIES);
    expect(auditWildlifeRegistry()).toEqual([]);
  });

  it("requires typed current ownership while preserving three playable keys and historical compatibility versions", () => {
    expectTypeOf<BiomeDefinition<"parkland">["content"]["wildlife"]>().toEqualTypeOf<WildlifeBundleOwnership<"parkland">>();
    expectTypeOf<Omit<BiomeDefinition<"parkland">["content"], "wildlife">>().not.toMatchTypeOf<BiomeDefinition<"parkland">["content"]>();
    expect(BIOME_KEYS).toEqual(["parkland", "links", "desert"]);
    expect(BIOME_KEYS.map(biome => biomeCompatibilityMetadataFor(biome).contentVersion)).toEqual([1, 1, 1]);
    expect(auditWildlifeOwnership(ownership(), BIOME_KEYS)).toEqual([]);
    for (const biome of WILDLIFE_BIOMES) expect(WILDLIFE_REGISTRY[biome].setting).toBe(BIOME_KEYS.includes(biome as never) ? "playable" : "staged");
    expect(auditWildlifeOwnership({ ...ownership(), heathland: WILDLIFE_REGISTRY.heathland.ownership }, [...BIOME_KEYS, "heathland"]).join("\n")).toContain("staged wildlife setting cannot become playable");
  });

  it("fails for missing, cross-biome, activated or future ownership", () => {
    const missing = ownership() as Record<string, unknown>;
    delete missing.links;
    expect(auditWildlifeOwnership(missing, BIOME_KEYS).join("\n")).toContain("links: wildlife ownership: object is required");
    const changed = ownership() as Record<string, Record<string, unknown>>;
    changed.parkland.bundleOwner = "desert";
    changed.links.delivery = "production";
    changed.desert.fallback = "parkland";
    changed.heathland = WILDLIFE_REGISTRY.heathland.ownership as unknown as Record<string, unknown>;
    const errors = auditWildlifeOwnership(changed, BIOME_KEYS).join("\n");
    expect(errors).toContain("parkland: wildlife ownership.bundleOwner");
    expect(errors).toContain("links: wildlife ownership.delivery");
    expect(errors).toContain("desert: wildlife ownership.fallback");
    expect(errors).toContain("heathland: wildlife ownership is not a playable biome");
    expect(auditWildlifeOwnership(null, BIOME_KEYS)).not.toEqual([]);
  });

  it("rejects forbidden behavior and incompatible family, attachment, habitat, season or grouping metadata", () => {
    const changed = mutable();
    changed.parkland.species[0].clips = ["forage"];
    changed.links.species[0].clips = ["quiet-flight"];
    changed.desert.species[0].habitat = "feeding-station";
    changed.heathland.species[3].seasons = ["winter"];
    changed["australian-sandbelt"].species[0].adultGroup = { min: 1, max: 8 };
    changed.links.species[1].id = changed.links.species[0].id;
    changed.parkland.species[1].audio = { treatment: "distant-call", description: "Silent" };
    const errors = auditWildlifeRegistry(changed).join("\n");
    expect(errors).toContain("prohibited or unknown clip");
    expect(errors).toContain("clip is incompatible with its animation family");
    expect(errors).toContain("flight requires a flight pivot");
    expect(errors).toContain("unsupported habitat");
    expect(errors).toContain("nightjars are summer-only");
    expect(errors).toContain("bounded ordered adult range");
    expect(errors).toContain("mob/flock minimum is three");
    expect(errors).toContain("nonempty unique id");
    expect(errors).toContain("silence must match the roster description");
  });

  it("also rejects bad canonical data through semantic gates rather than comparison to itself", () => {
    const species = WILDLIFE_REGISTRY.parkland.species[0] as unknown as { clips: string[] };
    const before = species.clips;
    try {
      species.clips = ["forage"];
      expect(auditWildlifeRegistry().join("\n")).toContain("prohibited or unknown clip");
    } finally { species.clips = before; }
    expect(auditWildlifeRegistry()).toEqual([]);
  });

  it("uses conservative bird staging and retains only the explicit roadrunner travel exception", () => {
    const birds = WILDLIFE_BIOMES.flatMap(biome => WILDLIFE_REGISTRY[biome].species).filter(entry => entry.restrictedGroundNestingPresentation);
    expect(birds.map(entry => entry.label).sort()).toEqual(["Gambel's quail", "Green pheasants", "Mallards", "Nightjars", "Oystercatchers", "Rock ptarmigan"].sort());
    for (const bird of birds) expect(bird.clips.every(clip => ["perch", "quiet-flight"].includes(clip))).toBe(true);
    expect(birds.find(entry => entry.label === "Mallards")!.clips).toEqual(["quiet-flight"]);
    const changed = mutable();
    changed.parkland.species[3].clips = ["glide"];
    changed.desert.species[1].clips = ["remote-travel"];
    expect(auditWildlifeRegistry(changed).join("\n")).toContain("restricted birds permit only quiet flight/natural perch");
    expect(auditWildlifeRegistry(changed).join("\n")).toContain("clip is incompatible with its animation family");
    expect(WILDLIFE_REGISTRY.desert.species.find(entry => entry.label === "Greater roadrunners")!.clips).toContain("remote-travel");
  });

  it("fails closed for malformed/extra roster records and any implied production asset or approval", () => {
    const changed = mutable();
    changed.parkland.provenance.status = "approved";
    changed.links.provenance.assetReferences = ["https://example.invalid/unlicensed-bird.png"];
    changed.desert.provenance.reviews.ecology = "approved";
    changed.heathland.setting = "playable";
    changed["alpine-mountain"].species.push(changed["alpine-mountain"].species[0]);
    const errors = auditWildlifeRegistry(changed).join("\n");
    expect(errors).toContain("provenance.status");
    expect(errors).toContain("assetReferences");
    expect(errors).toContain("reviews.ecology");
    expect(errors).toContain("biome/setting identity is incompatible");
    expect(errors).toContain("closed roster count must be 4");
    for (const invalid of [null, [], { parkland: null }, { ...mutable(), moonbase: {} }, Object.create(WILDLIFE_REGISTRY)]) expect(auditWildlifeRegistry(invalid).length).toBeGreaterThan(0);
  });

  it("declares omission, quiet audio and current budget ceilings without loading assets", async () => {
    const request = vi.fn(() => { throw new Error("wildlife must not request assets"); });
    vi.stubGlobal("fetch", request);
    try { vi.resetModules(); await import("./registry"); expect(auditWildlifeRegistry()).toEqual([]); expect(request).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
    expect(WILDLIFE_DELIVERY_CONTRACT).toMatchObject({ missingOrUnapproved: "omit", unselectedRequests: 0, shellPrecacheAssets: 0, simulationEffects: false, playerInteraction: false, selectedBiomeBudgetBytes: 6291456, individualAtlasBudgetBytes: 8388608 });
    expect(WILDLIFE_TIER_TARGETS.low).toEqual({ groups: 0, individuals: 0, travelingGroups: 0, flightGroups: 0, artBytes: 0, decodedBytes: 0, callEventsPerMinute: 0 });
    expect(WILDLIFE_AUDIO_TARGETS).toMatchObject({ foregroundCalls: 1, maximumEventSeconds: 3, minimumEventSpacingSeconds: 20, repeatClipSpacingSeconds: 60, stormCalls: 0, nonGameOutput: 0 });
    expect(Object.keys(WILDLIFE_ANIMATION_FAMILIES)).toEqual(WILDLIFE_FAMILIES);
    for (const profile of Object.values(WILDLIFE_REGISTRY)) expect(profile.provenance.assetReferences).toEqual([]);
  });
});
