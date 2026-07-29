import { describe, expect, it } from "vitest";
import type { NaturalPropFrame } from "./naturalProps";
import { deriveTreeHabitat, treeHabitatKind } from "./treeHabitat";

describe("tree habitat beds", () => {
  it("maps conifers, broadleaf trees, and desert trees to distinct ground", () => {
    expect(treeHabitatKind("parkland_tree_pine")).toBe("pine_straw");
    expect(treeHabitatKind("parkland_tree_fir")).toBe("pine_straw");
    expect(treeHabitatKind("links_tree_wind_pine")).toBe("pine_straw");
    expect(treeHabitatKind("parkland_tree_oak")).toBe("leaf_litter");
    expect(treeHabitatKind("parkland_tree_birch")).toBe("leaf_litter");
    expect(treeHabitatKind("links_tree_hawthorn")).toBe("leaf_litter");
    expect(treeHabitatKind("desert_tree_mesquite")).toBe("dry_soil");
    expect(treeHabitatKind("desert_tree_palm")).toBe("dry_soil");
  });

  it("is deterministic and bounded", () => {
    const frame = "parkland_tree_oak" as NaturalPropFrame;
    const obstacle = { x: 7, y: 9, type: "tree" as const };
    const first = deriveTreeHabitat(frame, obstacle, 42, 1);
    const second = deriveTreeHabitat(frame, obstacle, 42, 1);
    expect(first).toEqual(second);
    expect(first?.lobes.length).toBeGreaterThanOrEqual(4);
    expect(first?.lobes.length).toBeLessThanOrEqual(5);
    expect(first?.details.length).toBeLessThanOrEqual(10);
    expect(first?.roots.length).toBeLessThanOrEqual(4);
    expect(first?.rank).toBeGreaterThanOrEqual(0);
    expect(first?.rank).toBeLessThanOrEqual(1);
  });

  it("does not add tree beds beneath bushes or rocks", () => {
    expect(deriveTreeHabitat(
      "parkland_tree_oak",
      { x: 1, y: 1, type: "bush" },
      1,
      1,
    )).toBeNull();
  });
});
