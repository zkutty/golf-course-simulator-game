import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DefeatModal } from "../../src/ui/DefeatModal";
import { VictoryModal } from "../../src/ui/VictoryModal";
import { SaveLoadModal } from "../../src/ui/SaveLoadModal";
import { CampaignSceneModal } from "../../src/ui/CampaignSceneModal";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../src/game/models/defaults";
import { createCampaignRun } from "../../src/game/campaign/campaign";
import { CAMPAIGN_CHAPTER_BY_ID } from "../../src/game/campaign/content";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import { createObjectiveState } from "../../src/game/models/objectives";
import "../../src/index.css";

const params = new URLSearchParams(location.search);
const variant = params.get("variant") ?? "deadline";
const long = params.has("long");
const objectives = createObjectiveState(Array.from({ length: long ? 12 : 4 }, (_, i) => ({
  id: `goal-${i}`, label: `Goal ${i + 1}${long ? " — Create an inviting course with thoughtful fairways and complete visitor facilities for the entire community" : " raw authored label"}`,
  ...(i === 1 ? { labelKey: "stat.cash" as const } : {}),
  conditions: [{ metric: "cash" as const, comparator: ">=" as const, target: i + 1 }],
  ...(i !== 2 ? { deadlineWeek: 1200 + i } : {}),
})));
objectives.progress[0].met = true;
objectives.progress[0].completedWeek = 1199;
objectives.progress[1].completedWeek = 1201;
// The absent progress entry must still count as a missed deadline.
objectives.progress.pop();
if (!params.has("noWonWeek")) objectives.wonWeek = 1234;
const initial = JSON.stringify(objectives);
const courseName = long ? "The Long Meadow Community Golf Course with a welcoming clubhouse and scenic fairways" : "Long Meadow";
const campaignCourse = structuredClone(DEFAULT_COURSE);
const campaignWorld = structuredClone(DEFAULT_WORLD);
const campaign = createCampaignRun("back-nine");
campaign.phaseIndex = 2;
const chapter = CAMPAIGN_CHAPTER_BY_ID.get(campaign.chapterId)!;
const campaignScene = chapter.scenes.find(scene => scene.id === chapter.phases[2].completionSceneId)!;
campaignWorld.campaign = campaign;
const initialCampaign = JSON.stringify({ campaign, campaignCourse, campaignWorld });
export function Fixture() {
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(params.get("campaign") === "existing");
  const [campaignLog, setCampaignLog] = useState<unknown[]>([]);
  useEffect(() => {
    const show = () => setCampaignOpen(true);
    window.addEventListener("fixture-open-campaign", show);
    return () => window.removeEventListener("fixture-open-campaign", show);
  }, []);
  const [log, setLog] = useState<unknown[]>([]);
  const record = (value: unknown) => { setLog(items => [...items, value]); setOpen(false); };
  return <I18nProvider><main className="cc-main"><button data-testid="opener" onClick={() => setOpen(true)}>Open outcome</button><button data-testid="outside">Outside action</button>
    {open && (variant === "victory" ? <VictoryModal objectives={objectives} courseName={courseName} week={1235} cash={1234567} reputation={87} courseRating={72.3} careerNote={params.has("noNote") ? undefined : long ? "Career medal earned for completing the scenario with a strong legacy and a welcoming course that will serve generations of golfers" : "Career medal earned"} onContinue={() => record({ type: "continue" })} /> : <DefeatModal reason={variant === "bankrupt" ? "BANKRUPT" : "DEADLINE"} objectives={params.has("noObjectives") ? null : objectives} weeksSurvived={1235} peakCash={1234567} peakRep={87} courseRating={72.3} slope={130.6} seed={12345} onRetrySeed={seed => record({ type: "retry", seed })} onNewGame={() => record({ type: "new" })} onLoad={() => { setLog(items => [...items, { type: "load" }]); setLoad(true); }} />)}
    {params.has("campaign") && <div className="cc-course-frame" data-testid="course-frame" style={params.has("lowerCampaignStack") ? { position: "relative", zIndex: 1 } : undefined}><div data-testid="course-controls"><button data-testid="course-action">Ordinary course action</button><div><button data-testid="course-nested-action">Ordinary nested action</button></div></div><div data-testid="campaign-branch"><button data-testid="campaign-sibling-action">Ordinary campaign sibling action</button>{open && campaignOpen && <CampaignSceneModal campaign={campaign} scene={campaignScene} course={campaignCourse} world={campaignWorld} onChoose={(sceneId, choiceId) => { setCampaignLog(items => [...items, { sceneId, choiceId }]); setCampaignOpen(false); }} />}</div></div>}
  </main><output hidden data-testid="campaign-log">{JSON.stringify(campaignLog)}</output><output hidden data-testid="campaign-contract">{JSON.stringify({ sceneId: campaignScene.id, choiceId: campaignScene.choices[0].id })}</output><output hidden data-testid="campaign-immutable">{String(initialCampaign === JSON.stringify({ campaign, campaignCourse, campaignWorld }))}</output><output hidden data-testid="log">{JSON.stringify(log)}</output><output hidden data-testid="immutable">{String(initial === JSON.stringify(objectives))}</output><SaveLoadModal open={load} canSave={false} onClose={() => setLoad(false)} onLoaded={() => record({ type: "loaded" })} /></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
