import { useState } from "react";
import { createRoot } from "react-dom/client";
import { PlayerProPanel } from "../../src/ui/PlayerProPanel";
import { DEFAULT_WORLD } from "../../src/game/models/defaults";
import { createZk725BrowserFixture } from "../../src/game/testing/zk725BrowserFixture";
import { startPlayableRound } from "../../src/game/playerPro/playerPro";
import { I18nContext } from "../../src/i18n/context";
import { loadLocale, setActiveLocale, translate } from "../../src/i18n/core";
import "../../src/index.css";
const locale = loadLocale(); setActiveLocale(locale); document.documentElement.dataset.locale = locale;
const fixture = createZk725BrowserFixture(structuredClone(DEFAULT_WORLD));
const career = fixture.world.playerPro!;
career.identity.name = "Alexandra Isabella Montgomery-Wellington of the Riverside Golf Club";
if (new URLSearchParams(location.search).has("activeRound")) {
  const started = startPlayableRound({ course: fixture.course, world: fixture.world, day: 0 });
  if (!started.ok) throw new Error(started.reason);
  career.activeRound = started.round;
}
const initial = JSON.stringify(fixture);
const calls: { name: string; args: unknown[] }[] = [];
Object.assign(window, { playerShellFixture: { fixture, initial, calls } });
function record(name: string, ...args: unknown[]) {
  calls.push({ name, args });
  document.querySelector<HTMLOutputElement>("[data-testid=callback-log]")!.value = JSON.stringify(calls);
}
export function Fixture() {
  const [open, setOpen] = useState(true);
  return <I18nContext.Provider value={{ locale, setLocale: () => {}, t: (key, args) => translate(locale, key, args) }}>
    <button data-testid="outside-before" onClick={() => setOpen(true)}>Open player</button>
    <output data-testid="callback-log" />
    {open && <PlayerProPanel career={career} course={fixture.course} world={fixture.world} day={0}
      onUpdateIdentity={(identity) => record("identity", identity)}
      onStartRound={async (...args) => { record("start", ...args); return "Returned round notice"; }}
      onTrain={async (...args) => { record("train", ...args); return "Returned training notice"; }}
      onChallenge={async (...args) => { record("challenge", ...args); return "Returned challenge notice"; }}
      onMentorChallenge={async (...args) => { record("mentor", ...args); return null; }}
      onLoadout={async (...args) => { record("loadout", ...args); return "Returned loadout notice"; }}
      onTournament={async (...args) => { record("tournament", ...args); return null; }}
      onResume={() => record("resume")} onClose={() => { record("close"); setOpen(false); }} />}
    <button data-testid="outside-after">Outside focus destination</button>
  </I18nContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
