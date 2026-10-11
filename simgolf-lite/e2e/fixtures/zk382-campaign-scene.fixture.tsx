import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { CampaignSceneModal } from "../../src/ui/CampaignSceneModal";
import { VictoryModal } from "../../src/ui/VictoryModal";
import { SaveLoadModal } from "../../src/ui/SaveLoadModal";
import { createObjectiveState } from "../../src/game/models/objectives";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../src/game/models/defaults";
import { createCampaignRun } from "../../src/game/campaign/campaign";
import { CAMPAIGN_CHAPTER_BY_ID } from "../../src/game/campaign/content";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import "../../src/index.css";

const campaign = createCampaignRun("back-nine");
const chapter = CAMPAIGN_CHAPTER_BY_ID.get(campaign.chapterId)!;
const scene = chapter.scenes.find(candidate => candidate.id === chapter.phases[campaign.phaseIndex].introSceneId)!;
const course = structuredClone(DEFAULT_COURSE);
const world = structuredClone(DEFAULT_WORLD);
world.campaign = campaign;
const initial = JSON.stringify({ campaign, scene, course, world });
const params = new URLSearchParams(location.search);
const outcomeObjectives = createObjectiveState([]);
const outcomeOrder = params.get("stack") === "lower" ? 99999 : params.get("stack") === "equal" ? 100100 : 100200;

export function Fixture() {
  const [open, setOpen] = useState(false);
  const [log, setLog] = useState<{ sceneId: string; choiceId: string }[]>([]);
  const [outsideActions, setOutsideActions] = useState(0);
  const [gameplayKeys, setGameplayKeys] = useState<string[]>([]);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const [outcomeCount, setOutcomeCount] = useState(0);
  useEffect(() => {
    const record = (event: KeyboardEvent) => { if (event.code === "Escape" || event.code === "KeyW") setGameplayKeys(keys => [...keys, event.code]); };
    window.addEventListener("keydown", record);
    return () => window.removeEventListener("keydown", record);
  }, []);
  useEffect(() => {
    const showOutcome = () => setOutcomeOpen(true), hideOutcome = () => setOutcomeOpen(false), showPortal = () => setPortalOpen(true), hideEarlier = () => setEarlierOpen(false);
    window.addEventListener("fixture-open-outcome", showOutcome);
    window.addEventListener("fixture-remove-outcome", hideOutcome);
    window.addEventListener("fixture-open-portal", showPortal);
    window.addEventListener("fixture-remove-earlier", hideEarlier);
    return () => { window.removeEventListener("fixture-open-outcome", showOutcome); window.removeEventListener("fixture-remove-outcome", hideOutcome); window.removeEventListener("fixture-open-portal", showPortal); window.removeEventListener("fixture-remove-earlier", hideEarlier); };
  }, []);
  return <I18nProvider>
    <style>{`.fixture-outcome .cc-outcome-overlay { z-index: ${outcomeOrder}; }`}</style>
    <button data-testid="outside-main-action" onClick={() => setOutsideActions(count => count + 1)}>Outside main action</button>
    {params.get("case") === "earlier" && earlierOpen && <div role="dialog" aria-modal="true" aria-label="Earlier equal dialog" data-testid="earlier-dialog" style={{ position: "fixed", inset: 0, zIndex: 100100 }}><button>Earlier dialog action</button></div>}
    {params.get("case") === "hidden" && <div role="dialog" aria-modal="true" aria-label="Hidden higher dialog" data-testid="hidden-dialog" style={{ position: "fixed", inset: 0, zIndex: 100300, display: params.has("strict") ? undefined : "none", visibility: params.has("strict") ? "hidden" : undefined }}><button>Hidden action</button></div>}
    <main className="cc-main">
    <button data-testid="campaign-opener" onClick={() => { setOpen(true); if (params.get("case") === "earlier") setEarlierOpen(true); if (params.get("timing") === "existing") setOutcomeOpen(true); }}>Open campaign scene</button>
    <button data-testid="outside-action" onClick={() => setOutsideActions(count => count + 1)}>Outside action</button>
    <div data-testid="ordinary-background"><button data-testid="ordinary-action" onClick={() => setOutsideActions(count => count + 1)}>Ordinary course action</button><div><button data-testid="nested-action" onClick={() => setOutsideActions(count => count + 1)}>Ordinary nested action</button></div></div>
    {open && <CampaignSceneModal campaign={campaign} scene={scene} course={course} world={world} onChoose={(sceneId, choiceId) => { setLog(items => [...items, { sceneId, choiceId }]); setOpen(false); }} />}
    {outcomeOpen && <div className="fixture-outcome"><VictoryModal objectives={outcomeObjectives} courseName={course.name} week={world.week} cash={world.cash} reputation={world.reputation} courseRating={0} onContinue={() => { setOutcomeCount(count => count + 1); setOutcomeOpen(false); }} /></div>}
  </main><output hidden data-testid="campaign-log">{JSON.stringify(log)}</output><output hidden data-testid="outside-actions">{outsideActions}</output><output hidden data-testid="gameplay-keys">{JSON.stringify(gameplayKeys)}</output>
    <output hidden data-testid="outcome-count">{outcomeCount}</output>
    <output hidden data-testid="campaign-contract">{JSON.stringify({ sceneId: scene.id, choiceIds: scene.choices.map(choice => choice.id) })}</output>
    <output hidden data-testid="campaign-immutable">{String(initial === JSON.stringify({ campaign, scene, course, world }))}</output>
    {portalOpen && createPortal(<div style={{ position: "relative", zIndex: 100300 }}><SaveLoadModal open canSave={false} onClose={() => setPortalOpen(false)} onLoaded={() => setPortalOpen(false)} /></div>, document.body)}
  </I18nProvider>;
}
createRoot(document.getElementById("root")!).render(new URLSearchParams(location.search).has("strict") ? <StrictMode><Fixture /></StrictMode> : <Fixture />);
