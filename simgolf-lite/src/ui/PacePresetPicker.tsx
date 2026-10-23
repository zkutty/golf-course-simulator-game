import { useEffect, useId, useRef, useState } from "react";
import { PACE_PRESETS } from "../game/models/courseOperations";
import type { CourseOperations, PacePreset } from "../game/models/types";
import type { MessageKey } from "../i18n/catalog";
import { translateCurrent } from "../i18n/core";
import { formatCurrency } from "../i18n/format";
import { formatStaffShiftMinute } from "./liveOverviewPresentation";
import "./PacePresetPicker.css";

const PRESETS: PacePreset[] = ["relaxed", "balanced", "brisk"];
const TIME_PAR: Record<CourseOperations["timeParStyle"], MessageKey> = {
  relaxed: "pacePreview.timePar.relaxed", standard: "pacePreview.timePar.standard", brisk: "pacePreview.timePar.brisk",
};
const TEE_GUIDANCE: Record<CourseOperations["teeGuidance"], MessageKey> = {
  open: "pacePreview.teeGuidance.open", recommended: "pacePreview.teeGuidance.recommended", required: "pacePreview.teeGuidance.required",
};
const ENFORCEMENT: Record<CourseOperations["enforcement"], MessageKey> = {
  advisory: "pacePreview.enforcement.advisory", active: "pacePreview.enforcement.active", strict: "pacePreview.enforcement.strict",
};
const DAYLIGHT: Record<CourseOperations["daylightPolicy"], MessageKey> = {
  finish_started: "live.pace.finishStarted", strict_sunset: "live.pace.strictSunset",
};
const COMPENSATION: Record<CourseOperations["compensationPolicy"], MessageKey> = {
  refund: "live.pace.refund", credit: "live.pace.credit", goodwill: "live.pace.goodwill",
};
const MENU: Record<CourseOperations["beverage"]["menu"], MessageKey> = {
  off: "common.off", refreshments: "live.pace.refreshments", beer_wine: "live.pace.beerWine",
};
type Setting = Exclude<keyof CourseOperations, "beverage"> | `beverage.${keyof CourseOperations["beverage"]}`;
type PreviewRow = { label: MessageKey; value: string | number };

function previewRows(operations: CourseOperations): Record<Setting, PreviewRow> {
  return {
    preset: { label: "pacePreview.preset", value: translateCurrent(`live.pace.preset.${operations.preset}`) },
    teeIntervalMinutes: { label: "live.pace.teeInterval", value: translateCurrent("live.pace.minutes", { minutes: operations.teeIntervalMinutes }) },
    maxGroupSize: { label: "live.pace.maximumGroup", value: operations.maxGroupSize },
    starterGapEveryGroups: { label: "pacePreview.starterGap", value: operations.starterGapEveryGroups === 0 ? translateCurrent("pacePreview.noStarterGap") : translateCurrent("pacePreview.everyGroups", { groups: operations.starterGapEveryGroups }) },
    timeParStyle: { label: "pacePreview.timePar", value: translateCurrent(TIME_PAR[operations.timeParStyle]) },
    teeGuidance: { label: "pacePreview.teeGuidance", value: translateCurrent(TEE_GUIDANCE[operations.teeGuidance]) },
    enforcement: { label: "pacePreview.enforcement", value: translateCurrent(ENFORCEMENT[operations.enforcement]) },
    lastTeeMinute: { label: "pacePreview.lastTee", value: formatStaffShiftMinute(operations.lastTeeMinute) },
    daylightPolicy: { label: "live.pace.daylight", value: translateCurrent(DAYLIGHT[operations.daylightPolicy]) },
    compensationPolicy: { label: "live.pace.compensation", value: translateCurrent(COMPENSATION[operations.compensationPolicy]) },
    "beverage.menu": { label: "live.pace.beverageService", value: translateCurrent(MENU[operations.beverage.menu]) },
    "beverage.passes": { label: "pacePreview.beveragePasses", value: operations.beverage.passes },
    "beverage.alcoholLimit": { label: "pacePreview.alcoholLimit", value: operations.beverage.alcoholLimit },
    "beverage.price": { label: "pacePreview.beveragePrice", value: formatCurrency(operations.beverage.price) },
  };
}

export function PacePresetPicker(props: { currentPreset?: PacePreset; onApply?: (preset: PacePreset) => void }) {
  const [selected, setSelected] = useState<PacePreset | null>(null);
  const pending = useRef<PacePreset | null>(null);
  const triggers = useRef<Partial<Record<PacePreset, HTMLButtonElement | null>>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useEffect(() => { if (selected) heading.current?.focus(); }, [selected]);

  const close = () => {
    const preset = pending.current;
    pending.current = null;
    setSelected(null);
    if (preset) triggers.current[preset]?.focus();
    return preset;
  };

  return <div className="cc-pace-preset-picker" data-testid="pace-preset-picker">
    <div className="cc-pace-preset-choices" role="group" aria-label={translateCurrent("pacePreview.choose")}>
      {PRESETS.map(preset => <button key={preset} type="button"
        ref={element => { triggers.current[preset] = element; }}
        aria-pressed={props.currentPreset == null ? undefined : props.currentPreset === preset}
        aria-expanded={selected === preset} aria-controls={`${id}-preview`}
        onClick={() => { pending.current = preset; setSelected(preset); }}>
        {translateCurrent(`live.pace.preset.${preset}`)}
      </button>)}
    </div>
    {selected && <section className="cc-pace-preset-preview" id={`${id}-preview`} role="region"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-warning`} data-testid="pace-preset-preview"
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <h3 ref={heading} tabIndex={-1} id={`${id}-title`}>{translateCurrent("pacePreview.title", { preset: translateCurrent(`live.pace.preset.${selected}`) })}</h3>
      <p id={`${id}-warning`}>{translateCurrent("pacePreview.warning")}</p>
      <dl>{Object.entries(previewRows(PACE_PRESETS[selected])).map(([setting, row]) => <div key={setting} data-setting={setting}>
        <dt>{translateCurrent(row.label)}</dt><dd>{row.value}</dd>
      </div>)}</dl>
      <div className="cc-pace-preset-actions">
        <button type="button" onClick={() => close()}>{translateCurrent("pacePreview.cancel")}</button>
        <button type="button" onClick={() => { const preset = close(); if (preset) props.onApply?.(preset); }}>{translateCurrent("pacePreview.apply")}</button>
      </div>
    </section>}
  </div>;
}
