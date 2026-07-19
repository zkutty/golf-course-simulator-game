import { useState } from "react";
import {
  DEFAULT_APP_PROFILE,
  type AppProfile,
  type ProfileTab,
} from "../game/onboarding/profile";
import { GameButton, GameTabs } from "./gameui";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  profile: AppProfile;
  onProfileChange: (profile: AppProfile) => void;
  onOpenKeybindings?: () => void;
}

const TABS = ["Gameplay", "Graphics", "Audio", "Accessibility"] as const;
type Tab = typeof TABS[number];
const tabKey: Record<Tab, ProfileTab> = {
  Gameplay: "gameplay",
  Graphics: "graphics",
  Audio: "audio",
  Accessibility: "accessibility",
};

function copyProfile(profile: AppProfile): AppProfile {
  return JSON.parse(JSON.stringify(profile)) as AppProfile;
}

export function SettingsModal(props: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>("Gameplay");
  if (!props.open) return null;

  const change = <T extends ProfileTab>(key: T, patch: Partial<AppProfile[T]>) => {
    const next = copyProfile(props.profile);
    next[key] = { ...next[key], ...patch };
    props.onProfileChange(next);
  };
  const reset = () => {
    if (!window.confirm(`Reset ${tab.toLowerCase()} options to defaults?`)) return;
    const key = tabKey[tab];
    const next = copyProfile(props.profile);
    props.onProfileChange({ ...next, [key]: copyProfile(DEFAULT_APP_PROFILE)[key] });
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="options-title" data-testid="options-screen" style={{ position: "fixed", inset: 0, background: "rgba(15,24,18,.68)", display: "grid", placeItems: "center", padding: 16, zIndex: 99990 }} onClick={props.onClose}>
      <section style={{ width: "min(820px, 100%)", maxHeight: "min(760px, 92vh)", overflow: "hidden", display: "grid", gridTemplateRows: "auto auto minmax(0,1fr) auto", borderRadius: 20, background: "#f7f0df", border: "2px solid #a9987f", boxShadow: "0 24px 64px rgba(0,0,0,.42)" }} onClick={(event) => event.stopPropagation()}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 22px 12px" }}>
          <div><div id="options-title" style={{ fontFamily: "var(--font-heading)", fontSize: 28, fontWeight: 900, color: "#344338" }}>Options</div><div style={{ fontSize: 12, color: "#687266" }}>Changes apply immediately and save outside your course files.</div></div>
          <button aria-label="Close options" onClick={props.onClose} style={{ border: "1px solid #687266", borderRadius: 9, background: "#fffaf0", padding: "8px 11px", cursor: "pointer", fontWeight: 900 }}>✕</button>
        </header>
        <nav aria-label="Option categories" style={{ padding: "0 20px 14px", overflowX: "auto" }}><GameTabs tabs={[...TABS]} activeTab={tab} onTabChange={(next) => setTab(next as Tab)} /></nav>
        <div style={{ overflowY: "auto", padding: "4px 24px 22px" }}>
          {tab === "Gameplay" && <GameplayTab profile={props.profile} change={change} onProfileChange={props.onProfileChange} />}
          {tab === "Graphics" && <GraphicsTab profile={props.profile} change={change} />}
          {tab === "Audio" && <AudioTab profile={props.profile} change={change} />}
          {tab === "Accessibility" && <AccessibilityTab profile={props.profile} change={change} onOpenKeybindings={props.onOpenKeybindings} />}
        </div>
        <footer style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: 16, borderTop: "1px solid rgba(61,74,62,.2)", background: "rgba(255,255,255,.35)" }}>
          <GameButton variant="secondary" onClick={reset}>Reset {tab}</GameButton>
          <GameButton onClick={props.onClose}>Done</GameButton>
        </footer>
      </section>
    </div>
  );
}

type Change = <T extends ProfileTab>(key: T, patch: Partial<AppProfile[T]>) => void;

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label style={{ display: "grid", gridTemplateColumns: "minmax(180px,1fr) minmax(180px,1fr)", alignItems: "center", gap: 18, padding: "13px 0", borderBottom: "1px solid rgba(61,74,62,.12)" }}><span><span style={{ display: "block", fontWeight: 800, color: "#344338" }}>{label}</span>{hint && <span style={{ display: "block", fontSize: 12, color: "#72776b", marginTop: 2 }}>{hint}</span>}</span>{children}</label>;
}
const selectStyle: React.CSSProperties = { width: "100%", border: "1px solid #9ba293", borderRadius: 8, background: "#fffdf6", padding: 9, font: "inherit" };

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return <span style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 9 }}><input aria-label={label} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} style={{ width: 18, height: 18 }} /><span>{checked ? "On" : "Off"}</span></span>;
}

function Range({ value, onChange, min = 0, max = 1, step = .05, label }: { value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; label: string }) {
  return <span style={{ display: "grid", gridTemplateColumns: "1fr 54px", gap: 10, alignItems: "center" }}><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /><output style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round(value * 100)}%</output></span>;
}

function GameplayTab({ profile, change, onProfileChange }: { profile: AppProfile; change: Change; onProfileChange: (profile: AppProfile) => void }) {
  const p = profile.gameplay;
  return <div>
    <Row label="Autosave cadence" hint="Rotating autosaves never overwrite manual slots"><select aria-label="Autosave cadence" value={p.autosaveCadence} onChange={(e) => change("gameplay", { autosaveCadence: e.target.value as typeof p.autosaveCadence })} style={selectStyle}><option value="off">Off</option><option value="weekly">Every game week</option><option value="5m">Every 5 real minutes</option><option value="15m">Every 15 real minutes</option></select></Row>
    <Row label="Caddie advisor"><select aria-label="Advisor frequency" value={profile.advisorFrequency} onChange={(e) => onProfileChange({ ...copyProfile(profile), advisorFrequency: e.target.value as AppProfile["advisorFrequency"] })} style={selectStyle}><option value="chatty">Chatty</option><option value="normal">Normal</option><option value="important">Important only</option><option value="off">Off</option></select></Row>
    <Row label="Edge scrolling"><Toggle label="Edge scrolling" checked={p.edgeScroll} onChange={(edgeScroll) => change("gameplay", { edgeScroll })} /></Row>
    <Row label="Edge-scroll speed"><Range label="Edge-scroll speed" value={p.edgeScrollSpeed} min={.5} max={2} step={.25} onChange={(edgeScrollSpeed) => change("gameplay", { edgeScrollSpeed })} /></Row>
    <Row label="Camera smoothing"><Toggle label="Camera smoothing" checked={p.cameraSmoothing} onChange={(cameraSmoothing) => change("gameplay", { cameraSmoothing })} /></Row>
    <Row label="Confirm bulldoze"><Toggle label="Confirm bulldoze" checked={p.confirmBulldoze} onChange={(confirmBulldoze) => change("gameplay", { confirmBulldoze })} /></Row>
    <Row label="Confirm salvage"><Toggle label="Confirm salvage" checked={p.confirmSalvage} onChange={(confirmSalvage) => change("gameplay", { confirmSalvage })} /></Row>
    <Row label="Default game speed"><select aria-label="Default game speed" value={p.defaultGameSpeed} onChange={(e) => change("gameplay", { defaultGameSpeed: e.target.value as typeof p.defaultGameSpeed })} style={selectStyle}><option value="1x">1×</option><option value="2x">2×</option><option value="3x">3×</option></select></Row>
  </div>;
}

function GraphicsTab({ profile, change }: { profile: AppProfile; change: Change }) {
  const p = profile.graphics;
  return <div>
    <Row label="Animations master"><Toggle label="Animations master" checked={p.animations} onChange={(animations) => change("graphics", { animations })} /></Row>
    <Row label="Ambient world FX"><Toggle label="Ambient world FX" checked={p.ambienceFx} onChange={(ambienceFx) => change("graphics", { ambienceFx })} /></Row>
    <Row label="Water animation"><Toggle label="Water animation" checked={p.waterAnimation} onChange={(waterAnimation) => change("graphics", { waterAnimation })} /></Row>
    <Row label="Tree sway"><Toggle label="Tree sway" checked={p.treeSway} onChange={(treeSway) => change("graphics", { treeSway })} /></Row>
    <Row label="Resolution scale"><Range label="Resolution scale" value={p.resolutionScale} min={.5} max={1.5} step={.25} onChange={(resolutionScale) => change("graphics", { resolutionScale })} /></Row>
    <Row label="Grid overlays by default"><Toggle label="Grid overlays by default" checked={p.gridOverlays} onChange={(gridOverlays) => change("graphics", { gridOverlays })} /></Row>
    <Row label="Renderer"><select aria-label="Renderer" value={p.renderer} onChange={(e) => change("graphics", { renderer: e.target.value as typeof p.renderer })} style={selectStyle}><option value="pixi">Pixi — isometric</option><option value="canvas">Canvas — legacy</option></select></Row>
  </div>;
}

function AudioTab({ profile, change }: { profile: AppProfile; change: Change }) {
  const p = profile.audio;
  return <div>
    <Row label="Master volume"><Range label="Master volume" value={p.masterVolume} onChange={(masterVolume) => change("audio", { masterVolume })} /></Row>
    <Row label="Music volume"><Range label="Music volume" value={p.musicVolume} onChange={(musicVolume) => change("audio", { musicVolume })} /></Row>
    <Row label="Sound effects"><Range label="Sound effects" value={p.sfxVolume} onChange={(sfxVolume) => change("audio", { sfxVolume })} /></Row>
    <Row label="Ambience volume"><Range label="Ambience volume" value={p.ambienceVolume} onChange={(ambienceVolume) => change("audio", { ambienceVolume })} /></Row>
  </div>;
}

function AccessibilityTab({ profile, change, onOpenKeybindings }: { profile: AppProfile; change: Change; onOpenKeybindings?: () => void }) {
  const p = profile.accessibility;
  return <div>
    <Row label="Color-vision palette"><select aria-label="Color-vision palette" value={p.colorVision} onChange={(e) => change("accessibility", { colorVision: e.target.value as typeof p.colorVision })} style={selectStyle}><option value="standard">Standard</option><option value="deuteranopia">Deuteranopia-safe</option><option value="protanopia">Protanopia-safe</option><option value="tritanopia">Tritanopia-safe</option></select></Row>
    <Row label="Terrain patterns"><Toggle label="Terrain patterns" checked={p.terrainPatterns} onChange={(terrainPatterns) => change("accessibility", { terrainPatterns })} /></Row>
    <Row label="Reduced motion"><Toggle label="Reduced motion" checked={p.reducedMotion} onChange={(reducedMotion) => change("accessibility", { reducedMotion })} /></Row>
    <Row label="Text scale"><select aria-label="Text scale" value={p.textScale} onChange={(e) => change("accessibility", { textScale: Number(e.target.value) as typeof p.textScale })} style={selectStyle}>{[90,100,115,130].map((scale) => <option key={scale} value={scale}>{scale}%</option>)}</select></Row>
    <Row label="Keyboard controls" hint="Review and remap every game action"><GameButton type="button" variant="secondary" onClick={onOpenKeybindings}>Configure keybindings…</GameButton></Row>
  </div>;
}
