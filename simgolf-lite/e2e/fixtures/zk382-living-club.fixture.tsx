import { useState } from "react";
import { createRoot } from "react-dom/client";
import { LivingClubPanel } from "../../src/ui/LivingClubPanel";
import { DEFAULT_COURSE, DEFAULT_WORLD } from "../../src/game/models/defaults";
import { DEFAULT_APP_PROFILE } from "../../src/game/onboarding/profile";
import { normalizeLivingClub } from "../../src/game/livingClub/livingClub";
import { SYSTEMIC_EVENT_DEFINITIONS } from "../../src/game/livingClub/content";
import { I18nProvider } from "../../src/i18n/I18nProvider";
import type { RegularGolfer } from "../../src/game/livingClub/types";
import "../../src/index.css";
const variant = new URLSearchParams(location.search).get("state") ?? "normal";
const course = structuredClone(DEFAULT_COURSE);
const world = structuredClone(DEFAULT_WORLD);
const regular: RegularGolfer = {
  id: "person-fixture", kind: "regular", name: "Morgan " + "Longname".repeat(8), archetype: "lowHandicap",
  appearance: { portrait: "cap", palette: 1, accent: 2 }, skill: .8, preferences: { pace: "balanced", challenge: "competitive", hospitality: "club" },
  loyalty: 75, visits: 2, rounds: 1234, bestToPar: -3, member: true, relationship: { score: 20, tier: "friend", interactionIds: [] },
  memories: [{ id: "memory-a", week: 1, kind: "record", summary: "Authored memory " + "word ".repeat(20), immutable: true }], recentThoughts: [],
  history: [{ id: "visit-a", week: 1, day: 2, courseId: "course-primary", courseName: "Older authored course", scoreToPar: -2, mood: .8 }, { id: "visit-b", week: 2, day: 3, courseId: "course-primary", courseName: "Newer authored course", scoreToPar: 1, mood: .8 }],
};
const living = normalizeLivingClub(world.livingClub);
living.regulars = variant === "empty" ? [] : [regular];
const definition = SYSTEMIC_EVENT_DEFINITIONS[0];
if (variant === "stories") living.story.instances = [{ id: "story-fixture", definitionId: definition.id, week: 2, day: 1, priority: definition.priority, category: definition.category, participantIds: [regular.id], facts: { key: "fixture", facts: { cash: 123456 } }, status: "pending", expiresWeek: 4, resolution: null }];
living.story.journal = [1, 2].map(week => ({ id: `journal-${week}`, eventInstanceId: `event-${week}`, definitionId: definition.id, week, participantIds: [regular.id], choiceId: definition.choices[0].id, resolution: "chosen", facts: { key: "fixture", facts: {} } }));
world.livingClub = living;
if (variant === "empty") world.staffRoster = [];
const inputs = JSON.stringify({ world, course });
export function Fixture() {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(() => ({ ...structuredClone(DEFAULT_APP_PROFILE), favoritePersonIds: variant === "bound" ? Array.from({ length: 100 }, (_, i) => `existing-${i}`) : [] }));
  const [log, setLog] = useState<unknown[]>([]);
  const record = (value: unknown) => setLog(current => [...current, value]);
  return <><button data-testid="opener" onClick={() => setOpen(true)}>Open Living Club</button><button data-testid="outside">Outside control</button>
    <output hidden data-testid="log">{JSON.stringify(log)}</output><output hidden data-testid="profile">{JSON.stringify(profile)}</output>
    <output hidden data-testid="initial-profile">{JSON.stringify({ ...structuredClone(DEFAULT_APP_PROFILE), favoritePersonIds: variant === "bound" ? Array.from({ length: 100 }, (_, i) => `existing-${i}`) : [] })}</output><output hidden data-testid="course-id">{course.activeCourseId}</output><output hidden data-testid="immutable">{String(inputs === JSON.stringify({ world, course }))}</output>
    {open && <LivingClubPanel course={course} world={world} profile={profile} activeGolferPersonIds={variant === "off-course" ? [] : [{ id: 42, personId: regular.id }]} onProfile={next => { record({ type: "profile", profile: next }); setProfile(next); }} onFollow={id => record({ type: "follow", id })} onStaffCommand={command => { record(command); return command.type === "dismiss" ? "cash" : null; }} onChooseStory={(instanceId, choiceId) => record({ type: "choice", instanceId, choiceId })} onDeferStory={instanceId => record({ type: "defer", instanceId })} onClose={() => { record({ type: "close" }); setOpen(false); }} />}
  </>;
}
createRoot(document.getElementById("root")!).render(<I18nProvider><Fixture /></I18nProvider>);
