import { useState } from "react";
import {
  DEFAULT_APP_PROFILE,
  type AppProfile,
  type ProfileTab,
} from "../game/onboarding/profile";
import { GameButton, GameTabs } from "./gameui";
import { KeybindingsPanel } from "./accessibility/KeybindingsPanel";
import { useFocusTrap } from "./accessibility/useFocusTrap";
import { useI18n } from "../i18n/useI18n";
import { T } from "../i18n/T";
import { useAudio } from "../audio/audioContext";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  profile: AppProfile;
  onProfileChange: (profile: AppProfile) => void;
  onOpenKeybindings?: () => void;
}

const TABS: ProfileTab[] = ["gameplay", "graphics", "audio", "accessibility"];
const TAB_KEYS = { gameplay: "options.tab.gameplay", graphics: "options.tab.graphics", audio: "options.tab.audio", accessibility: "options.tab.accessibility" } as const;

function copyProfile(profile: AppProfile): AppProfile {
  return JSON.parse(JSON.stringify(profile)) as AppProfile;
}

export function SettingsModal(props: SettingsModalProps) {
  const [tab, setTab] = useState<ProfileTab>("gameplay");
  const [bindingsOpen, setBindingsOpen] = useState(false);
  const trapRef = useFocusTrap<HTMLElement>(props.open && !bindingsOpen, props.onClose);
  const { t } = useI18n();
  if (!props.open) return null;

  const change = <T extends ProfileTab>(key: T, patch: Partial<AppProfile[T]>) => {
    const next = copyProfile(props.profile);
    next[key] = { ...next[key], ...patch };
    props.onProfileChange(next);
  };
  const reset = () => {
    if (!window.confirm(t("options.resetConfirm", { section: t(TAB_KEYS[tab]) }))) return;
    const key = tab;
    const next = copyProfile(props.profile);
    props.onProfileChange({ ...next, [key]: copyProfile(DEFAULT_APP_PROFILE)[key] });
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="options-title" data-testid="options-screen" style={{ position: "fixed", inset: 0, background: "rgba(15,24,18,.68)", display: "grid", placeItems: "center", padding: 16, zIndex: 99990 }} onClick={props.onClose}>
      <section className="cc-tycoon-panel cc-options-panel" ref={trapRef} style={{ width: "min(820px, 100%)", maxHeight: "min(760px, 92vh)", overflow: "hidden", display: "grid", gridTemplateRows: "auto auto minmax(0,1fr) auto", borderRadius: 20, background: "#f7f0df", border: "2px solid #a9987f", boxShadow: "0 24px 64px rgba(0,0,0,.42)" }} onClick={(event) => event.stopPropagation()}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 22px 12px" }}>
          <div><div id="options-title" style={{ fontFamily: "var(--font-heading)", fontSize: 28, fontWeight: 900, color: "#344338" }}>{t("common.options")}</div><div style={{ fontSize: 12, color: "#687266" }}>{t("options.subtitle")}</div></div>
          <button aria-label={t("options.close")} onClick={props.onClose} style={{ border: "1px solid #687266", borderRadius: 9, background: "#fffaf0", padding: "8px 11px", cursor: "pointer", fontWeight: 900 }}>✕</button>
        </header>
        <nav aria-label={t("options.tabs.label")} style={{ padding: "0 20px 14px", overflowX: "auto" }}><GameTabs tabs={TABS.map((id) => t(TAB_KEYS[id]))} activeTab={t(TAB_KEYS[tab])} onTabChange={(next) => setTab(TABS.find((id) => t(TAB_KEYS[id]) === next) ?? tab)} /></nav>
        <div style={{ overflowY: "auto", padding: "4px 24px 22px" }}>
          {tab === "gameplay" && <GameplayTab profile={props.profile} change={change} onProfileChange={props.onProfileChange} />}
          {tab === "graphics" && <GraphicsTab profile={props.profile} change={change} />}
          {tab === "audio" && <AudioTab profile={props.profile} change={change} />}
          {tab === "accessibility" && <AccessibilityTab profile={props.profile} change={change} onOpenKeybindings={() => setBindingsOpen(true)} />}
        </div>
        <footer style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: 16, borderTop: "1px solid rgba(61,74,62,.2)", background: "rgba(255,255,255,.35)" }}>
          <GameButton variant="secondary" onClick={reset}>{t("common.reset", { section: t(TAB_KEYS[tab]) })}</GameButton>
          <GameButton onClick={props.onClose}>{t("common.done")}</GameButton>
        </footer>
      </section>
      {bindingsOpen && <KeybindingsPanel
        bindings={props.profile.accessibility.keybindings}
        onChange={(keybindings) => change("accessibility", { keybindings })}
        onClose={() => setBindingsOpen(false)}
      />}
    </div>
  );
}

type Change = <T extends ProfileTab>(key: T, patch: Partial<AppProfile[T]>) => void;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(180px,1fr)", alignItems: "center", gap: 18, padding: "13px 0", borderBottom: "1px solid rgba(61,74,62,.12)" }}><span><span style={{ display: "block", fontWeight: 800, color: "#344338" }}>{label}</span>{hint && <span style={{ display: "block", fontSize: 12, color: "#72776b", marginTop: 2 }}>{hint}</span>}</span>{children}</label>;
}
const selectStyle: React.CSSProperties = { width: "100%", border: "1px solid #9ba293", borderRadius: 8, background: "#fffdf6", padding: 9, font: "inherit" };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  const { t } = useI18n();
  return <span style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 9 }}><input aria-label={label} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} style={{ width: 18, height: 18 }} /><span>{checked ? t("common.on") : t("common.off")}</span></span>;
}

function Range({ value, onChange, min = 0, max = 1, step = .05, label }: { value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; label: string }) {
  return <span style={{ display: "grid", gridTemplateColumns: "1fr 54px", gap: 10, alignItems: "center" }}><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /><output style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round(value * 100)}%</output></span>;
}

function GameplayTab({ profile, change, onProfileChange }: { profile: AppProfile; change: Change; onProfileChange: (profile: AppProfile) => void }) {
  const { t } = useI18n();
  const p = profile.gameplay;
  return <div>
    <Row label={t("settings.autosave")} hint={t("settings.autosaveHint")}><select aria-label={t("settings.autosave")} value={p.autosaveCadence} onChange={(e) => change("gameplay", { autosaveCadence: e.target.value as typeof p.autosaveCadence })} style={selectStyle}><option value="off"><T id="auto.ui.settingsmodal.off" /></option><option value="weekly"><T id="auto.ui.settingsmodal.every.game.week" /></option><option value="5m"><T id="auto.ui.settingsmodal.every.5.real.minutes" /></option><option value="15m"><T id="auto.ui.settingsmodal.every.15.real.minutes" /></option></select></Row>
    <Row label={t("settings.advisor")}><select aria-label={t("settings.advisorFrequency")} value={profile.advisorFrequency} onChange={(e) => onProfileChange({ ...copyProfile(profile), advisorFrequency: e.target.value as AppProfile["advisorFrequency"] })} style={selectStyle}><option value="chatty"><T id="auto.ui.settingsmodal.chatty" /></option><option value="normal"><T id="auto.ui.settingsmodal.normal" /></option><option value="important"><T id="auto.ui.settingsmodal.important.only" /></option><option value="off"><T id="auto.ui.settingsmodal.off" /></option></select></Row>
    <Row label={t("settings.edgeScroll")}><Toggle label={t("settings.edgeScroll")} checked={p.edgeScroll} onChange={(edgeScroll) => change("gameplay", { edgeScroll })} /></Row>
    <Row label={t("settings.edgeScrollSpeed")}><Range label={t("settings.edgeScrollSpeed")} value={p.edgeScrollSpeed} min={.5} max={2} step={.25} onChange={(edgeScrollSpeed) => change("gameplay", { edgeScrollSpeed })} /></Row>
    <Row label={t("settings.cameraSmoothing")}><Toggle label={t("settings.cameraSmoothing")} checked={p.cameraSmoothing} onChange={(cameraSmoothing) => change("gameplay", { cameraSmoothing })} /></Row>
    <Row label={t("settings.newsTicker")}><Toggle label={t("settings.newsTicker")} checked={p.tickerVisible} onChange={(tickerVisible) => change("gameplay", { tickerVisible })} /></Row>
    <Row label={t("settings.momentCamera")} hint={t("settings.momentCameraHint")}><Toggle label={t("settings.momentCamera")} checked={p.momentCamera} onChange={(momentCamera) => change("gameplay", { momentCamera })} /></Row>
    <Row label={t("settings.confirmBulldoze")}><Toggle label={t("settings.confirmBulldoze")} checked={p.confirmBulldoze} onChange={(confirmBulldoze) => change("gameplay", { confirmBulldoze })} /></Row>
    <Row label={t("settings.confirmSalvage")}><Toggle label={t("settings.confirmSalvage")} checked={p.confirmSalvage} onChange={(confirmSalvage) => change("gameplay", { confirmSalvage })} /></Row>
    <Row label={t("settings.defaultSpeed")}><select aria-label={t("settings.defaultSpeed")} value={p.defaultGameSpeed} onChange={(e) => change("gameplay", { defaultGameSpeed: e.target.value as typeof p.defaultGameSpeed })} style={selectStyle}><option value="1x">1×</option><option value="2x">2×</option><option value="3x">3×</option></select></Row>
  </div>;
}

function GraphicsTab({ profile, change }: { profile: AppProfile; change: Change }) {
  const { t } = useI18n();
  const p = profile.graphics;
  return <div>
    <Row label={t("settings.animations")}><Toggle label={t("settings.animations")} checked={p.animations} onChange={(animations) => change("graphics", { animations })} /></Row>
    <Row label={t("settings.ambientFx")}><Toggle label={t("settings.ambientFx")} checked={p.ambienceFx} onChange={(ambienceFx) => change("graphics", { ambienceFx })} /></Row>
    <Row label={t("settings.waterAnimation")}><Toggle label={t("settings.waterAnimation")} checked={p.waterAnimation} onChange={(waterAnimation) => change("graphics", { waterAnimation })} /></Row>
    <Row label={t("settings.treeSway")}><Toggle label={t("settings.treeSway")} checked={p.treeSway} onChange={(treeSway) => change("graphics", { treeSway })} /></Row>
    <Row label={t("settings.resolutionScale")}><Range label={t("settings.resolutionScale")} value={p.resolutionScale} min={.5} max={1.5} step={.25} onChange={(resolutionScale) => change("graphics", { resolutionScale })} /></Row>
    <Row label={t("settings.gridOverlays")}><Toggle label={t("settings.gridOverlays")} checked={p.gridOverlays} onChange={(gridOverlays) => change("graphics", { gridOverlays })} /></Row>
  </div>;
}

function AudioTab({ profile, change }: { profile: AppProfile; change: Change }) {
  const { t } = useI18n();
  const audio = useAudio();
  const [devOverride, setDevOverride] = useState("auto");
  const p = profile.audio;
  return <div>
    <Row label={t("settings.masterMute")} hint={t("settings.masterMuteHint")}><Toggle label={t("settings.masterMute")} checked={p.masterMuted} onChange={(masterMuted) => change("audio", { masterMuted })} /></Row>
    <Row label={t("settings.masterVolume")}><Range label={t("settings.masterVolume")} value={p.masterVolume} onChange={(masterVolume) => change("audio", { masterVolume })} /></Row>
    <AudioRange label={t("settings.musicVolume")} value={p.musicVolume} onChange={(musicVolume) => change("audio", { musicVolume })} onTest={() => audio.testChannel("music")} testLabel={t("settings.testMusic")} />
    <AudioRange label={t("settings.soundEffects")} value={p.sfxVolume} onChange={(sfxVolume) => change("audio", { sfxVolume })} onTest={() => audio.testChannel("sfx")} testLabel={t("settings.testSfx")} />
    <AudioRange label={t("settings.ambienceVolume")} value={p.ambienceVolume} onChange={(ambienceVolume) => change("audio", { ambienceVolume })} onTest={() => audio.testChannel("ambience")} testLabel={t("settings.testAmbience")} />
    <Row label={t("settings.muteWhenHidden")} hint={t("settings.muteWhenHiddenHint")}><Toggle label={t("settings.muteWhenHidden")} checked={p.muteWhenHidden} onChange={(muteWhenHidden) => change("audio", { muteWhenHidden })} /></Row>
    {import.meta.env.DEV && <Row label={t("settings.musicOverride")} hint={t("settings.musicOverrideHint")}><select aria-label={t("settings.musicOverride")} value={devOverride} onChange={(event) => { const value = event.target.value; setDevOverride(value); void audio.setMusicOverride(value === "auto" ? null : value as "silent" | "title" | "build" | "live" | "tension"); }} style={selectStyle}><option value="auto">{t("settings.musicContext.auto")}</option><option value="silent">{t("settings.musicContext.silent")}</option><option value="title">{t("settings.musicContext.title")}</option><option value="build">{t("settings.musicContext.build")}</option><option value="live">{t("settings.musicContext.live")}</option><option value="tension">{t("settings.musicContext.tension")}</option></select></Row>}
  </div>;
}

function AudioRange(props: { label: string; value: number; onChange: (value: number) => void; onTest: () => void; testLabel: string }) {
  return <Row label={props.label}><span style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}><Range label={props.label} value={props.value} onChange={props.onChange} /><button type="button" aria-label={props.testLabel} onClick={props.onTest} style={{ border: "1px solid #87907f", borderRadius: 8, background: "#fffdf6", padding: "7px 9px", cursor: "pointer" }}>▶</button></span></Row>;
}

function AccessibilityTab({ profile, change, onOpenKeybindings }: { profile: AppProfile; change: Change; onOpenKeybindings?: () => void }) {
  const p = profile.accessibility;
  const { locale, setLocale, t } = useI18n();
  return <div>
    <Row label={t("a11y.colorVision")}><select aria-label={t("a11y.colorVision")} value={p.colorVision} onChange={(e) => change("accessibility", { colorVision: e.target.value as typeof p.colorVision })} style={selectStyle}><option value="standard">{t("a11y.palette.standard")}</option><option value="deuteranopia">{t("a11y.palette.deuteranopia")}</option><option value="protanopia">{t("a11y.palette.protanopia")}</option><option value="tritanopia">{t("a11y.palette.tritanopia")}</option></select></Row>
    <Row label={t("a11y.terrainPatterns")}><Toggle label={t("a11y.terrainPatterns")} checked={p.terrainPatterns} onChange={(terrainPatterns) => change("accessibility", { terrainPatterns })} /></Row>
    <Row label={t("a11y.reducedMotion")}><Toggle label={t("a11y.reducedMotion")} checked={p.reducedMotion} onChange={(reducedMotion) => change("accessibility", { reducedMotion })} /></Row>
    <Row label={t("a11y.textScale")}><select aria-label={t("a11y.textScale")} value={p.textScale} onChange={(e) => change("accessibility", { textScale: Number(e.target.value) as typeof p.textScale })} style={selectStyle}>{[90,100,115,130].map((scale) => <option key={scale} value={scale}>{scale}%</option>)}</select></Row>
    <Row label={t("options.locale")} hint={t("options.localeHint")}><select aria-label={t("options.locale")} value={locale} onChange={(event) => setLocale(event.target.value as typeof locale)} style={selectStyle}><option value="en">{t("options.locale.en")}</option><option value="pseudo">{t("options.locale.pseudo")}</option></select></Row>
    <Row label={t("a11y.keyboard")} hint={t("a11y.keyboardHint")}><GameButton type="button" variant="secondary" aria-label={t("a11y.configure")} onClick={onOpenKeybindings}>{t("a11y.configure")}</GameButton></Row>
  </div>;
}
