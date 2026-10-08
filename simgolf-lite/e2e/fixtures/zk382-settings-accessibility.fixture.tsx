import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsModal } from "../../src/ui/SettingsModal";
import { GolfopediaModal } from "../../src/ui/help/GolfopediaModal";
import { GameTabs } from "../../src/ui/gameui/GameTabs";
import { AudioReactContext, type AudioContextValue } from "../../src/audio/audioContext";
import { I18nContext } from "../../src/i18n/context";
import { translate } from "../../src/i18n/core";
import { loadAppProfile, saveAppProfile, type AppProfile } from "../../src/game/onboarding/profile";
import "../../src/index.css";

const audio: AudioContextValue = {
  unlock: async () => {}, setMusicContext: async () => {}, setSurface: () => {},
  setMusicOverride: async () => {}, playSfx: async () => {}, playSting: async () => {},
  setAmbientMix: () => {}, setPaused: () => {}, testChannel: () => {}, setVolumes: () => {},
  syncVolumes: () => {}, getVolumes: () => ({ masterVolume: 1, musicVolume: .25, sfxVolume: .6, ambienceVolume: .4, masterMuted: false, muteWhenHidden: true }),
};

export function Fixture() {
  const [profile, setProfile] = useState(loadAppProfile);
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [closeCount, setCloseCount] = useState(0);
  const [changeCount, setChangeCount] = useState(0);
  const [active, setActive] = useState("One");
  const [tabLog, setTabLog] = useState<string[]>([]);
  const [locale, setLocale] = useState<"en" | "pseudo">(() => localStorage.getItem("coursecraft_locale") === "pseudo" ? "pseudo" : "en");
  useEffect(() => { document.documentElement.style.fontSize = `${profile.accessibility.textScale}%`; }, [profile]);
  useEffect(() => { document.documentElement.dataset.locale = locale; }, [locale]);
  const change = (next: AppProfile) => { setChangeCount((count) => count + 1); setProfile(next); saveAppProfile(next); };
  return <I18nContext.Provider value={{ locale, setLocale, t: (key, params) => translate(locale, key, params) }}><AudioReactContext.Provider value={audio}>
    <button data-testid="open-settings" onClick={() => setOpen(true)}>Open settings</button>
    <button data-testid="open-golfopedia" onClick={() => setHelp(true)}>Open Golfopedia</button>
    <output data-testid="close-count">{closeCount}</output><output data-testid="change-count">{changeCount}</output>
    <output data-testid="profile">{JSON.stringify(profile)}</output>
    <div data-testid="tabs-demo"><GameTabs tabs={["One", "Two", "Three"]} activeTab={active} onTabChange={(next) => { setActive(next); setTabLog((log) => [...log, next]); }} /></div>
    <output data-testid="tab-log">{tabLog.join(",")}</output>
    <SettingsModal open={open} profile={profile} onProfileChange={change} onClose={() => { setCloseCount((count) => count + 1); setOpen(false); }} />
    <GolfopediaModal open={help} onClose={() => setHelp(false)} />
  </AudioReactContext.Provider></I18nContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
