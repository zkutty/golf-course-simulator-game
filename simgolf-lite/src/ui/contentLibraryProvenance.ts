import type { HoleTemplateV1 } from "../game/holeTemplates/types";

export type HoleTemplateLibrarySummary = Pick<HoleTemplateV1, "provenance" | "fidelity">;

/** Library cards retain only bounded metadata, never blueprint geometry. */
export function holeTemplateLibrarySummary(template: HoleTemplateV1): HoleTemplateLibrarySummary {
  return {
    provenance: { ...template.provenance },
    ...(template.fidelity ? { fidelity: { ...template.fidelity } } : {}),
  };
}
