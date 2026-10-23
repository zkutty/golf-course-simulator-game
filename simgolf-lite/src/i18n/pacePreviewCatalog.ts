import { registerMessages } from "./core";

// Pace preview copy travels with the picker used by deferred inspector/overview.
// A type-only catalog import retains MessageKey coverage without an eager edge.
export const pacePreviewEn = {
  "pacePreview.preset": "Preset",
  "pacePreview.choose": "Preview a pace preset",
  "pacePreview.title": "Preview {preset}",
  "pacePreview.warning": "Applying this preset replaces all pace and beverage settings, including any manual overrides. Previewing or canceling keeps your current settings.",
  "pacePreview.apply": "Apply preset",
  "pacePreview.cancel": "Cancel preview",
  "pacePreview.starterGap": "Starter gap",
  "pacePreview.noStarterGap": "No extra gap",
  "pacePreview.everyGroups": "Every {groups} groups",
  "pacePreview.timePar": "Time par style",
  "pacePreview.timePar.relaxed": "Relaxed",
  "pacePreview.timePar.standard": "Standard",
  "pacePreview.timePar.brisk": "Brisk",
  "pacePreview.teeGuidance": "Tee guidance",
  "pacePreview.teeGuidance.open": "Open choice",
  "pacePreview.teeGuidance.recommended": "Recommended tees",
  "pacePreview.teeGuidance.required": "Required tees",
  "pacePreview.enforcement": "Pace enforcement",
  "pacePreview.enforcement.advisory": "Advisory",
  "pacePreview.enforcement.active": "Active",
  "pacePreview.enforcement.strict": "Strict",
  "pacePreview.lastTee": "Last tee time",
  "pacePreview.beveragePasses": "Beverage service passes",
  "pacePreview.alcoholLimit": "Alcohol limit per guest",
  "pacePreview.beveragePrice": "Beverage price",
} as const;

export function registerPacePreviewCatalog(): () => void {
  return registerMessages(pacePreviewEn);
}
