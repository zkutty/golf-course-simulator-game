/* eslint-disable react-refresh/only-export-components -- exported pure transitions are UI interaction contracts. */
import { useMemo, useState } from "react";
import { BIOME_KEYS } from "../game/models/biomes";
import type { Course, CourseLayout, PinRotation, TeeSet } from "../game/models/types";
import { SEASONS } from "../game/seasons/types";
import {
  buildHoleIllustrationPreview,
  defaultHoleIllustrationPreviewSettings,
  type HoleIllustrationEvidenceStatus,
  type HoleIllustrationPreviewSettings,
} from "../game/holeIllustration/preview";
import { HOLE_ILLUSTRATION_CONTRASTS } from "../game/holeIllustration/style";
import { useI18n } from "../i18n/useI18n";
import { normalizeCourseLayouts } from "../game/models/courseLayouts";

const TEES: readonly TeeSet[] = ["forward", "member", "championship"];
const PINS: readonly PinRotation[] = ["A", "B", "C"];

export function transitionIllustrationLayout(settings: HoleIllustrationPreviewSettings, layouts: readonly CourseLayout[], layoutId: string): HoleIllustrationPreviewSettings {
  const layout = layouts.find((item) => item.id === layoutId);
  const published = layout?.publishedHoleIds ?? [], draft = layout?.draftHoleIds ?? [];
  return { ...settings, layoutId, routeSource: published.length ? "published" : "draft", holeId: published[0] ?? draft[0] ?? "" };
}

export function transitionIllustrationRouteSource(settings: HoleIllustrationPreviewSettings, layouts: readonly CourseLayout[], routeSource: "published" | "draft"): HoleIllustrationPreviewSettings {
  const layout = layouts.find((item) => item.id === settings.layoutId);
  const ids = layout?.[routeSource === "published" ? "publishedHoleIds" : "draftHoleIds"] ?? [];
  return { ...settings, routeSource, holeId: ids.includes(settings.holeId) ? settings.holeId : ids[0] ?? "" };
}

export function HoleIllustrationPreviewPanel(props: { course: Course; evidence: { status: HoleIllustrationEvidenceStatus; layoutId: string; holeId: string; teeSet: string; pinRotation: string }; onClose: () => void; initialSettings?: HoleIllustrationPreviewSettings | null }) {
  const { t } = useI18n();
  const initial = props.initialSettings === undefined ? defaultHoleIllustrationPreviewSettings(props.course) : props.initialSettings;
  const [settings, setSettings] = useState<HoleIllustrationPreviewSettings | null>(initial);
  const preview = useMemo(() => settings ? buildHoleIllustrationPreview(props.course, settings, props.evidence) : null, [props.course, props.evidence, settings]);
  const set = <K extends keyof HoleIllustrationPreviewSettings>(key: K, value: HoleIllustrationPreviewSettings[K]) => setSettings((current) => current ? { ...current, [key]: value } : current);
  const normalizedCourse = normalizeCourseLayouts(props.course);
  const layouts = normalizedCourse.layouts ?? [];
  const holes = settings ? (layouts.find((layout) => layout.id === settings.layoutId)?.[settings.routeSource === "published" ? "publishedHoleIds" : "draftHoleIds"] ?? []) : [];

  return <section id="hole-illustration-preview" aria-labelledby="hole-illustration-preview-title" data-testid="hole-illustration-preview" style={{ marginTop: 12, padding: 10, borderRadius: 9, background: "#e6f0e8", border: "1px solid #71917c" }}>
    <header style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
      <div><strong id="hole-illustration-preview-title">{t("architecture.illustration.title")}</strong><small style={{ display: "block" }}>{t("architecture.illustration.readOnly")}</small></div>
      <button aria-label={t("architecture.illustration.close")} onClick={props.onClose}>✕</button>
    </header>
    {!settings || !preview ? <p role="status">{t("architecture.illustration.none")}</p> : <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 7, marginTop: 9 }}>
        {layouts.length > 1 && <label>{t("architecture.illustration.layout")}<select aria-label={t("architecture.illustration.layout")} value={settings.layoutId} onChange={(event) => setSettings((current) => current && transitionIllustrationLayout(current, layouts, event.target.value))}>{layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}</select></label>}
        <label>{t("architecture.illustration.routeSource")}<select aria-label={t("architecture.illustration.routeSource")} value={settings.routeSource} onChange={(event) => setSettings((current) => current && transitionIllustrationRouteSource(current, layouts, event.target.value as "published" | "draft"))}><option value="published">{t("architecture.illustration.published")}</option><option value="draft">{t("architecture.illustration.draft")}</option></select></label>
        <label>{t("architecture.illustration.hole")}<select aria-label={t("architecture.illustration.hole")} value={settings.holeId} onChange={(event) => set("holeId", event.target.value)} disabled={holes.length === 0}>{holes.length ? holes.map((holeId) => <option key={holeId} value={holeId}>{normalizedCourse.holes.find((hole) => hole.id === holeId)?.name ?? holeId}</option>) : <option value="">{t("architecture.illustration.none")}</option>}</select></label>
        <label>{t("architecture.illustration.tee")}<select aria-label={t("architecture.illustration.tee")} value={settings.teeSet} onChange={(event) => set("teeSet", event.target.value as TeeSet)}>{TEES.map((tee) => <option key={tee}>{tee}</option>)}</select></label>
        <label>{t("architecture.illustration.pin")}<select aria-label={t("architecture.illustration.pin")} value={settings.pinRotation} onChange={(event) => set("pinRotation", event.target.value as PinRotation)}>{PINS.map((pin) => <option key={pin}>{pin}</option>)}</select></label>
        <label>{t("architecture.illustration.frame")}<select aria-label={t("architecture.illustration.frame")} value={settings.frame} onChange={(event) => set("frame", event.target.value as "north-up" | "tee-to-green")}><option value="north-up">{t("architecture.illustration.northUp")}</option><option value="tee-to-green">{t("architecture.illustration.teeToGreen")}</option></select></label>
        <label>{t("architecture.illustration.biome")}<select aria-label={t("architecture.illustration.biome")} value={settings.biome} onChange={(event) => set("biome", event.target.value as HoleIllustrationPreviewSettings["biome"])}>{BIOME_KEYS.map((biome) => <option key={biome}>{biome}</option>)}</select></label>
        <label>{t("architecture.illustration.season")}<select aria-label={t("architecture.illustration.season")} value={settings.season} onChange={(event) => set("season", event.target.value as HoleIllustrationPreviewSettings["season"])}>{SEASONS.map((season) => <option key={season}>{season}</option>)}</select></label>
        <label>{t("architecture.illustration.contrast")}<select aria-label={t("architecture.illustration.contrast")} value={settings.contrast} onChange={(event) => set("contrast", event.target.value as HoleIllustrationPreviewSettings["contrast"])}>{HOLE_ILLUSTRATION_CONTRASTS.map((contrast) => <option key={contrast}>{contrast}</option>)}</select></label>
      </div>
      <fieldset style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0 0", fontSize: 12 }}>
        <legend>{t("architecture.illustration.details")}</legend>
        {([['showContours', 'architecture.illustration.contours'], ['showVegetation', 'architecture.illustration.vegetation'], ['showHazards', 'architecture.illustration.hazards'], ['showShotLine', 'architecture.illustration.shotLine'], ['showLabels', 'architecture.illustration.labels'], ['showLandingDistances', 'architecture.illustration.landingDistances']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={settings[key]} onChange={(event) => set(key, event.target.checked)} /> {t(label)}</label>)}
      </fieldset>
      {!preview.complete ? <p role="status" data-testid="hole-illustration-incomplete">{t("architecture.illustration.incomplete", { message: preview.message ?? "" })}</p> : <>
        <div role="status" aria-live="polite" data-testid="hole-illustration-metadata" style={{ fontSize: 12, marginTop: 8 }}>
          {t("architecture.illustration.metadata", { hole: preview.metadata!.holeNumber, name: preview.metadata!.holeName, tee: preview.metadata!.tee, pin: preview.metadata!.pin, par: preview.metadata!.par, yardage: preview.metadata!.yardage, route: preview.metadata!.routeSource })}<br />
          {t("architecture.illustration.hashes", { snapshot: preview.metadata!.snapshotHash, plan: preview.metadata!.planHash })}
        </div>
        {preview.warning && <p role="status" data-testid="hole-illustration-evidence-warning" style={{ fontSize: 12, background: "#fff1c8", padding: 6 }}>{preview.warning}</p>}
        {settings.showLabels && <p style={{ fontSize: 12, margin: "7px 0" }}>{t("architecture.illustration.labelsValue", { tee: preview.metadata!.tee, pin: preview.metadata!.pin, landings: "" })}</p>}
        {settings.showLandingDistances && preview.landings.length > 0 && <p role="status" style={{ fontSize: 12, margin: "7px 0" }}>{preview.landings.map((landing) => t("architecture.illustration.landingShot", { landing: landing.name, yards: landing.yards })).join(" · ")}</p>}
        <figure style={{ position: "relative", margin: 0 }}><img alt={t("architecture.illustration.alt", { hole: preview.metadata!.holeName })} src={`data:image/svg+xml,${encodeURIComponent(preview.svg!)}`} style={{ display: "block", width: "100%", height: "auto", boxSizing: "border-box", border: "1px solid #718674", background: "white" }} />
          {settings.showLabels && <figcaption style={{ position: "absolute", top: 8, left: 8, maxWidth: "calc(100% - 16px)", boxSizing: "border-box", padding: "5px 7px", background: "rgba(255,255,255,.9)", borderRadius: 4, fontSize: "clamp(12px,3vw,16px)", fontWeight: 700 }}>{t("architecture.illustration.metadata", { hole: preview.metadata!.holeNumber, name: preview.metadata!.holeName, tee: preview.metadata!.tee, pin: preview.metadata!.pin, par: preview.metadata!.par, yardage: preview.metadata!.yardage, route: preview.metadata!.routeSource })}</figcaption>}
        </figure>
      </>}
    </>}
    <div style={{ marginTop: 9 }}><button data-testid="hole-illustration-cancel" onClick={props.onClose}>{t("architecture.illustration.cancel")}</button></div>
  </section>;
}
