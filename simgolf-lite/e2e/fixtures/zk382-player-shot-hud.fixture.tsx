import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PlayerShotHud } from "../../src/ui/PlayerProPanel";
import { DEFAULT_WORLD } from "../../src/game/models/defaults";
import { createZk725BrowserFixture } from "../../src/game/testing/zk725BrowserFixture";
import { caddieShotGuidance, commitPlayerShot, finishPlayerShot, concedePlayerRound, startPlayableRound, type PlayerShotSelection } from "../../src/game/playerPro/playerPro";
import { completePlayerTraining, playerTrainingOptions } from "../../src/game/playerPro/playerProPanelAuthority";
import { starterPropertyCourse } from "../../src/game/property/property";
import { I18nContext } from "../../src/i18n/context";
import { loadLocale, setActiveLocale, translate } from "../../src/i18n/core";
import "../../src/index.css";
const locale = loadLocale(); setActiveLocale(locale); document.documentElement.dataset.locale = locale;
const fixture = createZk725BrowserFixture(structuredClone(DEFAULT_WORLD));
const training: { week: number; day: number; skill: string; cost: number; available: boolean; recovery: number; shortGame: number }[] = [];
if (new URLSearchParams(location.search).has("trained")) {
  fixture.course.property ??= starterPropertyCourse();
  fixture.course.property.assets.push({ id: "hud-evidence-short-game", kind: "short_game_area", name: "Evidence Short Game Area", category: "practice", tier: 1, x: 2, y: 2, width: 12, height: 5, capacity: 20, condition: 1, price: 20, enabled: true, openHour: 7, closeHour: 20 });
  fixture.world.staffRoster = [{ id: "hud-evidence-coach", name: "Morgan", role: "club_pro", shiftStart: 0, shiftEnd: 840, weeklyWage: 500 }];
  const startWeek = fixture.world.week;
  for (let session = 0; session < 18; session++) {
    const career = fixture.world.playerPro!;
    if (career.skills.recovery >= 46) break;
    const day = Math.floor(session / 2) % 7, skill = "recovery";
    fixture.world.week = startWeek + Math.floor(session / 14);
    const option = playerTrainingOptions(fixture.course, fixture.world, day, 600).find(option => option.skill === skill && option.available);
    if (!option) throw new Error("Genuine training option unavailable");
    const result = completePlayerTraining(career, fixture.world, option, day);
    if (result.career === career || !result.cost) throw new Error("Genuine training made no progress");
    fixture.world = { ...fixture.world, cash: fixture.world.cash - result.cost, playerPro: result.career };
    training.push({ week: fixture.world.week, day, skill, cost: result.cost, available: option.available, recovery: result.career.skills.recovery, shortGame: result.career.skills.shortGame });
  }
  if (fixture.world.playerPro!.skills.recovery < 46) throw new Error("Training bounds exceeded");
}
const career = fixture.world.playerPro!;
const started = startPlayableRound({ course: fixture.course, world: fixture.world, day: 0 });
if (!started.ok) throw new Error(started.reason);
const phase = new URLSearchParams(location.search).get("phase") ?? "awaiting";
const firstGuidance = caddieShotGuidance(started.round, career.skills);
const flight = phase === "result" || phase === "flight" ? commitPlayerShot(started.round, career.skills, firstGuidance.selection) : null;
if (flight && flight.phase !== "flight") throw new Error("Real first shot must emit flight");
const round = phase === "flight" ? flight! : phase === "result" ? finishPlayerShot(flight!) : phase === "conceded" ? concedePlayerRound(started.round) : started.round;
const guidance = caddieShotGuidance(round, career.skills);
const initial = JSON.stringify({ ...fixture, career, round });
export function Fixture() {
  const [aim, setAim] = useState({ ...round.course.holes[round.currentHoleIndex].pin });
  const [calls, setCalls] = useState<{ name: string; value?: unknown }[]>([]);
  const [background, setBackground] = useState(0);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.code === "KeyW") setBackground(count => count + 1); }; window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key); }, []);
  const record = (name: string, value?: unknown) => setCalls(previous => [...previous, { name, value }]);
  return <I18nContext.Provider value={{ locale, setLocale: () => {}, t: (key, args) => translate(locale, key, args) }}>
    <main style={{ position: "relative", height: "100vh", width: "100%" }}>
      <button data-testid="outside-before" onClick={() => setBackground(count => count + 1)}>Course background action</button>
      <PlayerShotHud career={career} round={round} aim={aim} onAim={point => { record("aim", point); setAim(point); }} onCommit={(selection: PlayerShotSelection) => record("commit", selection)} onAdvance={() => record("advance")} onAutoFinish={() => record("auto")} onConcede={() => record("concede")} onReturnToDesign={() => record("return")} />
      <button data-testid="outside-after" style={{ position: "absolute", bottom: 0 }} onClick={() => setBackground(count => count + 1)}>Course footer action</button>
    </main>
    <output hidden data-testid="calls">{JSON.stringify(calls)}</output><output hidden data-testid="background">{background}</output>
    <output hidden data-testid="aim">{JSON.stringify(aim)}</output><output hidden data-testid="guidance">{JSON.stringify(guidance.selection)}</output>
    <output hidden data-testid="phase">{round.phase}</output><output hidden data-testid="immutable">{String(initial === JSON.stringify({ ...fixture, career, round }))}</output>
    <output hidden data-testid="training-output">{JSON.stringify(training)}</output>
    <output hidden data-testid="input-snapshot">{initial}</output>
  </I18nContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
