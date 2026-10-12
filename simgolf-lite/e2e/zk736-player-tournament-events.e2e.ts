import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import type { TournamentFixtureEvidence } from "./fixtures/zk736-player-tournament-events.fixture";
import type { TournamentEvent } from "../src/game/tournaments/types";
import type { TournamentRankedStanding } from "../src/game/tournaments/tournamentStandings";

const evidence = process.env.TOURNAMENT_EVIDENCE_DIR ?? "/private/tmp/golf-batch20-tournament-candidate-attempt2/proof";
const fixture = "/e2e/fixtures/zk736-player-tournament-events.html";
test.setTimeout(45_000);
const normalize = (text: string) => text.replace(/\s+/g, " ").trim();
const names = (event: TournamentEvent, id: string): string => {
  const snapshot = event.activationSnapshot!;
  const entrant = snapshot.entrants.find((candidate) => candidate.entrantId === id);
  if (entrant) return entrant.name;
  const team = snapshot.teams.find((candidate) => candidate.id === id)!;
  return `${team.id} · ${team.entrantIds.map((entrantId) => snapshot.entrants.find((candidate) => candidate.entrantId === entrantId)!.name).join(" + ")}`;
};
type Row = { id: string; cells: string[] };
const readRows = (table: Locator): Promise<Row[]> => table.locator("tbody > tr").evaluateAll((rows) => rows.map((row) => ({ id: (row as HTMLElement).dataset.competitorId ?? "", cells: Array.from(row.querySelectorAll("td,th")).map((cell) => (cell as HTMLElement).innerText.replace(/\s+/g, " ").trim()) })));
function expectedRow(event: TournamentEvent, standing: TournamentRankedStanding): Row {
  const snapshot = event.activationSnapshot!;
  const stableford = snapshot.scoringMode === "stableford";
  const total = snapshot.teamFormat === "individual" ? "Gross" : "Team net";
  const ranking = stableford ? "Stableford points" : snapshot.scoringMode === "gross-stroke" ? "Gross ranking total" : "Net ranking total";
  const status = standing.status === "dnf" ? "DNF" : standing.status[0].toUpperCase() + standing.status.slice(1);
  const place = standing.place === null ? "Unranked" : standing.tied ? `Tied ${standing.place}` : String(standing.place);
  return { id: standing.competitorId, cells: [normalize(`${place} ${standing.occupiedPlaces.length ? `Occupied places: ${standing.occupiedPlaces.join(", ")}` : ""}`),
    normalize(`${names(event, standing.competitorId)} ${status} Rounds: ${standing.completedRounds} · holes: ${standing.holesCompleted}`),
    standing.scoreTotal === null ? "No ranked score" : normalize(`${total}: ${standing.scoreTotal} ${ranking}: ${stableford ? -standing.rankingTotal! : standing.rankingTotal}${stableford ? "" : ` To par: ${standing.scoreToPar}`}`)] };
}
const assertRows = (actual: Row[], event: TournamentEvent, expected: readonly TournamentRankedStanding[]) => expect(actual).toEqual(expected.map((standing) => expectedRow(event, standing)));
const openNative = async (page: Page, details: Locator) => {
  const summary = details.locator(":scope > summary");
  await summary.focus(); await page.keyboard.press("Enter");
  await expect(details).toHaveAttribute("open", "");
};
async function enterTab(page: Page, query: string) {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${fixture}?${query}`);
  const tab = page.getByTestId("player-pro-tab-tournaments");
  await tab.focus(); await page.keyboard.press("Enter");
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("player-tournament-events")).toBeVisible();
  return errors;
}
const snapshot = (page: Page): Promise<{ expected: TournamentFixtureEvidence["expected"]; calls: TournamentFixtureEvidence["calls"]; immutable: boolean }> => page.evaluate(() => ({ expected: window.tournamentEventFixture.expected, calls: window.tournamentEventFixture.calls,
  immutable: JSON.stringify({ course: window.tournamentEventFixture.course, world: window.tournamentEventFixture.world }) === window.tournamentEventFixture.initial }));
async function record(page: Page, info: TestInfo, payload: unknown) {
  mkdirSync(evidence, { recursive: true });
  const stem = info.title.replace(/[^a-zA-Z0-9]+/g, "-");
  writeFileSync(`${evidence}/${stem}.json`, JSON.stringify(payload, null, 2));
  await page.screenshot({ path: `${evidence}/${stem}.png` });
  await info.attach("tournament acceptance evidence", { body: JSON.stringify(payload), contentType: "application/json" });
}
async function verifyCanonical(page: Page) {
  const actual = await snapshot(page), { expected } = actual;
  expect(actual.immutable).toBe(true); expect(actual.calls).toEqual([]); expect(expected.getterSameArray).toBe(true);
  const canonical = expected.canonical!; expect(canonical).not.toBeNull();
  const overview = page.getByTestId("player-tournament-standings-overview");
  await expect(overview).toBeVisible();
  const overviewRows = await readRows(overview);
  assertRows(overviewRows, expected.event, canonical.standings.slice(0, 5));
  for (const row of await overview.locator("tbody > tr").all()) await expect(row).toBeVisible();
  await expect(overview.locator("p")).toHaveText(`${canonical.standings.length - overviewRows.length} additional competitors appear in the full standings below.`);
  const full = page.getByTestId("player-tournament-standings"); expect(await full.getAttribute("open")).toBeNull();
  await expect(full.locator("table")).not.toBeVisible();
  const winners = page.getByTestId("player-tournament-winners");
  if (canonical.winnerIds.length) expect(await winners.locator("li").allTextContents()).toEqual(canonical.winnerIds.map((id) => names(expected.event, id)));
  else await expect(winners).toHaveCount(0);
  await openNative(page, full);
  const fullRows = await readRows(full); assertRows(fullRows, expected.event, canonical.standings);
  return { ...actual, overviewRows, fullRows };
}
async function verifySetup(page: Page, expected: TournamentEvent) {
  const setup = page.getByTestId("player-tournament-frozen-setup");
  await openNative(page, setup);
  const frozen = expected.activationSnapshot!;
  const facts = await setup.locator(":scope > dl dd").allTextContents();
  expect(facts).toEqual([`${frozen.courseName} · ${frozen.courseId}`, ({ individual: "Individual", "four-ball": "Four-ball", "alternate-shot": "Alternate shot", scramble: "Scramble", "pro-am": "Pro-Am" })[frozen.teamFormat],
    ({ "stableford": "Stableford", "net-stroke": "Net stroke play", "gross-stroke": "Gross stroke play" })[frozen.scoringMode],
    ({ forward: "Forward", member: "Member", championship: "Championship" })[frozen.teeSet], frozen.pinRotation, String(frozen.rating), String(frozen.slope), String(frozen.par)]);
  const roster = setup.locator(":scope > details").filter({ has: page.locator("summary", { hasText: /^Roster \(/ }) }).first();
  await openNative(page, roster);
  const rows = roster.locator("tbody > tr"); expect(await rows.count()).toBe(frozen.entrants.length);
  for (let index = 0; index < frozen.entrants.length; index += 1) {
    const entrant = frozen.entrants[index], text = normalize(await rows.nth(index).innerText());
    expect(text).toContain(entrant.name); expect(text).toContain(entrant.teamId);
    expect(text).toContain(new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 2 }).format(entrant.allowance));
    expect(text).toContain(`Handicap index: ${entrant.handicapIndex}`); expect(text).toContain(`Playing handicap: ${entrant.playingHandicap}`);
    if (entrant.teamRole) expect(text).toContain(entrant.teamRole[0].toUpperCase() + entrant.teamRole.slice(1));
  }
  const strokes = rows.first().locator("details"); await openNative(page, strokes);
  expect(await strokes.locator("li").allTextContents()).toEqual(frozen.entrants[0].strokesByHole.map((value, index) => `Hole ${frozen.holes[index].id}: ${value} strokes`));
  const dates = page.getByTestId("player-tournament-events").locator("details").filter({ has: page.locator(":scope > summary", { hasText: "Round dates and status" }) }).first();
  await openNative(page, dates);
  expect(await dates.locator("tbody > tr").allTextContents()).toEqual(expected.rounds!.map((round) => `${round.roundNumber}Week ${round.scheduledWeek}, day ${round.scheduledDay + 1}${round.status[0].toUpperCase() + round.status.slice(1)}`));
  return { facts, rosterCount: frozen.entrants.length, dates: expected.rounds };
}
const canonicalCases = [
  ["gross two-round tied default", "rounds=2&mode=gross-stroke"],
  ["net four-round cumulative", "template=individual&rounds=4&mode=net-stroke"],
  ["Stableford three-round points", "template=individual&rounds=3&mode=stableford"],
  ["four-ball two-round tied teams", "template=two-v-two-four-ball&rounds=2"],
  ["alternate-shot two-round DNF", "template=two-v-two-alternate-shot&rounds=2&dnf=1"],
  ["scramble one-round tied teams", "template=two-person-scramble&rounds=1"],
  ["Pro-Am two-round tied counting", "template=four-person-pro-am&rounds=2"],
  ["Pro-Am pro-only DNF", "template=four-person-pro-am&rounds=1&dnf=1"],
] as const;
for (const [name, query] of canonicalCases) test(`[functional] ${name}`, async ({ page }, info) => {
  const errors = await enterTab(page, `phase=completed&${query}`);
  const proof = await verifyCanonical(page); const setup = await verifySetup(page, proof.expected.event);
  const cards = page.getByTestId("player-tournament-events").locator("details").filter({ has: page.locator(":scope > summary", { hasText: "Participant scorecards by round" }) }).first();
  await openNative(page, cards); const round = cards.locator(":scope > details").first(); await openNative(page, round);
  const persisted = proof.expected.event.rounds![0].scorecards;
  expect(await round.locator("tbody > tr").count()).toBe(persisted.length);
  for (let index = 0; index < persisted.length; index += 1) {
    const card = persisted[index], row = round.locator("tbody > tr").nth(index);
    expect(normalize(await row.innerText())).toContain(names(proof.expected.event, card.entrantId));
    if (card.status === "completed") expect(await row.locator("li").allTextContents()).toEqual(card.grossByHole.map((gross, hole) => `Hole ${proof.expected.event.activationSnapshot!.holes[hole].id}: gross ${gross}`));
    else expect(normalize(await row.innerText())).toContain("Withdrawn");
  }
  const counting: unknown[] = [];
  if (proof.expected.canonical!.proAmRounds.length) {
    const proAm = page.getByTestId("player-tournament-events").locator("details").filter({ has: page.locator(":scope > summary", { hasText: "Pro-Am counted balls by round" }) }).first();
    await openNative(page, proAm); await expect(proAm.locator(":scope > p")).toContainText("including at least one amateur");
    for (const canonicalRound of proof.expected.canonical!.proAmRounds) {
      const shownRound = proAm.locator(":scope > details").nth(canonicalRound.roundNumber - 1); await openNative(page, shownRound);
      const team = shownRound.locator(":scope > details").first(); await openNative(page, team);
      for (let holeIndex = 0; holeIndex < canonicalRound.teams[0].holes.length; holeIndex += 1) {
        const hole = canonicalRound.teams[0].holes[holeIndex], shown = team.locator(":scope > ol > li").nth(holeIndex);
        if (hole.status === "scored") {
          await expect(shown.locator(":scope > p").first()).toHaveText(`Counted players: ${hole.countedEntrantIds.map((id) => names(proof.expected.event, id)).join(" + ")}`);
          expect(hole.countedEntrantIds.some((id) => hole.members.find((member) => member.entrantId === id)?.role === "amateur")).toBe(true);
          await expect(shown.locator(":scope > p").nth(1)).toHaveText(`Team net: ${hole.net}`);
        } else await expect(shown.locator(":scope > p")).toHaveText("No eligible pair of counting balls; this hole is DNF.");
        expect(await shown.locator("tbody > tr").count()).toBe(hole.members.length);
        const memberCells = await shown.locator("tbody > tr").evaluateAll((rows) => rows.map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => (cell as HTMLElement).innerText.replace(/\s+/g, " ").trim())));
        expect(memberCells).toEqual(hole.members.map((member) => [normalize(`${names(proof.expected.event, member.entrantId)} ${member.role === "pro" ? "Pro" : "Amateur"}`),
          normalize(`${member.status === "played" ? "Played" : "Withdrawn"} ${hole.countedEntrantIds.includes(member.entrantId) ? "Counted ball" : ""} Allocated strokes: ${member.handicapStrokes}${member.status === "played" ? ` Gross: ${member.gross} Net: ${member.net}` : ""}`)]));
        counting.push({ round: canonicalRound.roundNumber, hole, memberCells });
      }
    }
  }
  const negative = { missingOverviewRejected: false, alteredIdentityRejected: false, alteredScoreRejected: false };
  try { assertRows([], proof.expected.event, proof.expected.canonical!.standings.slice(0, 5)); } catch { negative.missingOverviewRejected = true; }
  const alteredIdentity = structuredClone(proof.overviewRows); alteredIdentity[0].id = "forged-identity";
  try { assertRows(alteredIdentity, proof.expected.event, proof.expected.canonical!.standings.slice(0, 5)); } catch { negative.alteredIdentityRejected = true; }
  const alteredScore = structuredClone(proof.overviewRows); alteredScore[0].cells[2] = "Forged score -9999";
  try { assertRows(alteredScore, proof.expected.event, proof.expected.canonical!.standings.slice(0, 5)); } catch { negative.alteredScoreRejected = true; }
  expect(Object.values(negative)).toEqual([true, true, true]);
  expect(errors).toEqual([]); expect((await snapshot(page)).immutable).toBe(true);
  await record(page, info, { proof, setup, counting, negative, errors });
});
const phaseCases = ["scheduled", "future", "active-entered", "active-unentered", "cancelled", "legacy", "forged-individual", "forged-pro-am", "malformed"] as const;
for (const phase of phaseCases) test(`[functional] event ${phase}`, async ({ page }, info) => {
  const actualPhase = phase.startsWith("forged") ? "forged" : phase;
  const query = phase === "forged-pro-am" ? "&template=four-person-pro-am" : "";
  const errors = await enterTab(page, `phase=${actualPhase}${query}${phase === "active-entered" ? "&notice=custom" : ""}`);
  let proof: unknown = await snapshot(page);
  if (phase.startsWith("forged")) {
    proof = await verifyCanonical(page);
    expect((await snapshot(page)).expected.normalizedCount).toBe(0);
    await expect(page.getByTestId("player-tournament-events")).not.toContainText("Forged winner");
    await expect(page.getByTestId("player-tournament-events")).not.toContainText("-9999");
  } else if (phase === "legacy") {
    const details = page.getByTestId("player-tournament-events").locator("details").filter({ has: page.locator(":scope > summary", { hasText: "Recorded results · unranked" }) });
    await openNative(page, details); await expect(details).toContainText("Recorded score: 40"); await expect(details).toContainText("Recorded score to par: 4");
    await expect(page.getByTestId("player-tournament-standings-overview")).toHaveCount(0); await expect(details.locator("thead")).not.toContainText("Place");
  } else if (phase === "malformed") {
    await expect(page.getByTestId("player-tournament-events")).toContainText("recorded evidence is incomplete or invalid");
    await expect(page.getByTestId("player-tournament-events").getByRole("button")).toHaveCount(0);
    await expect(page.getByTestId("player-tournament-standings-overview")).toHaveCount(0);
  } else if (phase === "scheduled" || phase === "future") {
    const setup = page.getByTestId("player-tournament-planned-setup"); await openNative(page, setup);
    const actual = await snapshot(page); expect(await setup.locator(":scope > dl dd").nth(0).textContent()).toContain(actual.expected.event.courseName!);
    await expect(setup.locator(":scope > dl dd").last()).toHaveText("Not recorded");
  }
  const entry = page.getByTestId("player-tournament-events").getByRole("button", { name: "Enter and play", exact: true });
  const actual = await snapshot(page);
  if (["scheduled", "future", "active-entered"].includes(phase)) {
    expect(actual.expected.entry).toHaveLength(1);
    if (actual.expected.entry[0].eligibility!.eligible) {
      await expect(entry).toBeEnabled(); await entry.focus(); await page.keyboard.press("Enter");
      const after = await snapshot(page);
      expect(after.calls).toEqual([{ name: "tournament", event: actual.expected.entry[0].event, originalIdentity: true }]);
      await expect(page.getByRole("tabpanel")).toContainText(phase === "active-entered" ? "Fixture entry acknowledged." : "✓ Resume active round");
      proof = { before: actual, after };
    } else { await expect(entry).toBeDisabled(); expect(actual.calls).toEqual([]); }
  } else await expect(entry).toHaveCount(0);
  if (phase === "future") {
    const lowSkillErrors = await enterTab(page, "phase=scheduled&skill=low");
    const lowSkill = await snapshot(page);
    expect(lowSkill.expected.entry[0].eligibility!.eligible).toBe(false);
    expect(lowSkill.expected.entry[0].eligibility!.reason).not.toBe("round_date");
    await expect(page.getByTestId("player-tournament-events").getByRole("button", { name: "Enter and play", exact: true })).toBeDisabled();
    expect(lowSkill.calls).toEqual([]); expect(lowSkill.immutable).toBe(true); expect(lowSkillErrors).toEqual([]);
    const blockedPaint = await collectPaint(page);
    expect(blockedPaint.filter((item) => item.contrast < 4.5)).toEqual([]);
    proof = { future: proof, lowSkill, blockedPaint };
  }
  expect((await snapshot(page)).immutable).toBe(true); expect(errors).toEqual([]);
  await record(page, info, { proof, errors });
});

for (const locale of ["en", "pseudo"] as const) for (const width of [320, 768, 1280]) test(`[paint] native text and glyphs ${locale} ${width}`, async ({ page }, info) => {
  await verifyPaint(page, info, locale, width);
});

// Alpha-compositing authority adapted from frozen Batch19 glyph/paint acceptance.
const collectPaint = (page: Page) => page.getByTestId("player-tournament-events").evaluate((panel) => {
  type RGBA = [number, number, number, number];
  const rgba = (value: string): RGBA => { const values = value.match(/[\d.]+/g)!.map(Number); return [values[0], values[1], values[2], values[3] ?? 1]; };
  const over = (fg: RGBA, bg: RGBA): RGBA => { const alpha = fg[3] + bg[3] * (1 - fg[3]); return [0, 1, 2].map((i) => alpha ? (fg[i] * fg[3] + bg[i] * bg[3] * (1 - fg[3])) / alpha : 0).concat(alpha) as RGBA; };
  const lum = (value: RGBA) => value.slice(0, 3).map((c) => { const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const contrast = (a: RGBA, b: RGBA) => (Math.max(lum(a), lum(b)) + .05) / (Math.min(lum(a), lum(b)) + .05);
  const paint = (element: Element, foreground = getComputedStyle(element).color, outline = false) => {
    let pairs = [{ foreground: rgba(foreground), background: [0, 0, 0, 0] as RGBA }];
    const layers = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const css = getComputedStyle(node), gradient = outline && node === element ? null : css.backgroundImage.match(/rgba?\([^)]+\)/g), base = outline && node === element ? [0, 0, 0, 0] as RGBA : rgba(css.backgroundColor), opacity = Number(css.opacity);
      const colors = gradient?.map((value) => over(rgba(value), base)) ?? [base];
      layers.push({ tag: node.tagName, background: css.backgroundColor, image: css.backgroundImage, opacity });
      pairs = pairs.flatMap((pair) => colors.map((background) => { const fg = over(pair.foreground, background), bg = over(pair.background, background); fg[3] *= opacity; bg[3] *= opacity; return { foreground: fg, background: bg }; }));
    }
    pairs = pairs.map((pair) => ({ foreground: over(pair.foreground, [255, 255, 255, 1]), background: over(pair.background, [255, 255, 255, 1]) }));
    return { pairs, layers, contrast: Math.min(...pairs.map((pair) => contrast(pair.foreground, pair.background))) };
  };
  return Array.from(panel.querySelectorAll<HTMLElement>("*")).filter((element) => element.checkVisibility() && element.getClientRects().length && (Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) || element.matches("button,summary"))).map((element, index) => {
    const css = getComputedStyle(element), painted = paint(element);
    return { index, tag: element.tagName, text: element.textContent, size: Number.parseFloat(css.fontSize), painted, contrast: painted.contrast,
      focus: document.activeElement === element ? { visible: element.matches(":focus-visible"), width: Number.parseFloat(css.outlineWidth), offset: Number.parseFloat(css.outlineOffset), contrast: paint(element, css.outlineColor, true).contrast } : null };
  });
});
async function glyphGeometry(page: Page) {
  return page.getByTestId("player-tournament-events").evaluate((panel) => {
    const rect = (box: DOMRect) => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
    const clipsFor = (node: Element) => {
      const clips = [{ name: "viewport", x: true, y: true, left: 0, right: innerWidth, top: 0, bottom: innerHeight }];
      for (let parent: Element | null = node; parent; parent = parent.parentElement) {
        const css = getComputedStyle(parent), x = /^(hidden|clip|scroll|auto)$/.test(css.overflowX), y = /^(hidden|clip|scroll|auto)$/.test(css.overflowY), box = parent.getBoundingClientRect();
        if (x || y) clips.push({ name: parent.getAttribute("data-testid") ?? parent.tagName, x, y, left: box.left + parent.clientLeft, right: box.left + parent.clientLeft + parent.clientWidth, top: box.top + parent.clientTop, bottom: box.top + parent.clientTop + parent.clientHeight });
      }
      return clips;
    };
    const crosses = (box: ReturnType<typeof rect>, clips: ReturnType<typeof clipsFor>) => clips.filter((clip) => (clip.x && (box.left < clip.left - 1 || box.right > clip.right + 1)) || (clip.y && (box.top < clip.top - 1 || box.bottom > clip.bottom + 1)));
    const body = panel.closest<HTMLElement>("[role=tabpanel]")!;
    const samples: { tag: string; text: string | null; lines: { glyph: ReturnType<typeof rect>; clips: ReturnType<typeof clipsFor>; intersections: ReturnType<typeof clipsFor> }[]; controlIntersections: ReturnType<typeof clipsFor> }[] = [];
    for (const node of panel.querySelectorAll<HTMLElement>("*")) {
      if (!node.checkVisibility() || !node.getClientRects().length) continue;
      const children = Array.from(node.childNodes).filter((child) => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
      if (!children.length && !node.matches("button,summary")) continue;
      const lines = [];
      for (const child of children) {
        const range = document.createRange(); range.selectNodeContents(child);
        const count = range.getClientRects().length;
        for (let index = 0; index < count; index += 1) {
          let box = range.getClientRects()[index], bodyBox = body.getBoundingClientRect();
          body.scrollTop += box.top - (bodyBox.top + body.clientTop) - (body.clientHeight - box.height) / 2;
          box = range.getClientRects()[index]; bodyBox = body.getBoundingClientRect();
          const glyph = rect(box), clips = clipsFor(node);
          lines.push({ glyph, clips, intersections: crosses(glyph, clips) });
        }
      }
      let controlIntersections: ReturnType<typeof clipsFor> = [];
      if (node.matches("button,summary")) { node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }); controlIntersections = crosses(rect(node.getBoundingClientRect()), clipsFor(node)); }
      samples.push({ tag: node.tagName, text: node.textContent, lines, controlIntersections });
    }
    const glyphs = (element: Element) => { const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), boxes: ReturnType<typeof rect>[] = []; while (walker.nextNode()) { if (!walker.currentNode.textContent?.trim() || !walker.currentNode.parentElement?.checkVisibility()) continue; const range = document.createRange(); range.selectNodeContents(walker.currentNode); boxes.push(...Array.from(range.getClientRects()).map(rect)); } return boxes; };
    const overlaps = [];
    for (const row of panel.querySelectorAll("tr,header")) {
      const cells = Array.from(row.children).map(glyphs);
      for (let first = 0; first < cells.length; first += 1) for (let second = first + 1; second < cells.length; second += 1) {
        for (const a of cells[first]) for (const b of cells[second]) if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlaps.push({ a, b, text: row.textContent });
      }
    }
    return { samples, overlaps, body: { clientWidth: body.clientWidth, scrollWidth: body.scrollWidth, clientHeight: body.clientHeight, scrollHeight: body.scrollHeight }, viewport: { width: innerWidth, height: innerHeight } };
  });
}
async function focusRing(page: Page, element: Locator, evidenceId: string) {
  await element.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); await expect(element).toBeFocused();
  const ring = await element.evaluate((node) => {
    const css = getComputedStyle(node), box = node.getBoundingClientRect(), extra = Number.parseFloat(css.outlineWidth) + Number.parseFloat(css.outlineOffset);
    const paint = { left: box.left - extra, right: box.right + extra, top: box.top - extra, bottom: box.bottom + extra };
    const clips = [{ left: 0, right: innerWidth, top: 0, bottom: innerHeight }];
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (/^(hidden|clip|auto|scroll)$/.test(style.overflowX) || /^(hidden|clip|auto|scroll)$/.test(style.overflowY)) clips.push({ left: bounds.left + parent.clientLeft, right: bounds.left + parent.clientLeft + parent.clientWidth, top: bounds.top + parent.clientTop, bottom: bounds.top + parent.clientTop + parent.clientHeight });
    }
    return { paint, clips, width: Number.parseFloat(css.outlineWidth), style: css.outlineStyle, visible: node.matches(":focus-visible") };
  });
  const sample = (await collectPaint(page)).find((item) => item.focus)!;
  const text = await element.textContent();
  mkdirSync(evidence, { recursive: true });
  writeFileSync(`${evidence}/focus-ring-${evidenceId}.json`, JSON.stringify({ text, ring, sample }, null, 2));
  expect(ring.visible).toBe(true); expect(ring.style).toBe("solid"); expect(ring.width).toBe(3); expect(sample.focus!.contrast).toBeGreaterThanOrEqual(3);
  for (const clip of ring.clips) { expect(ring.paint.left).toBeGreaterThanOrEqual(clip.left); expect(ring.paint.right).toBeLessThanOrEqual(clip.right); expect(ring.paint.top).toBeGreaterThanOrEqual(clip.top); expect(ring.paint.bottom).toBeLessThanOrEqual(clip.bottom); }
  return { ring, sample };
}
async function verifyPaint(page: Page, info: TestInfo, locale: "en" | "pseudo", width: number) {
  await page.setViewportSize({ width, height: width === 320 ? 640 : 800 });
  const errors = await enterTab(page, `phase=completed&template=four-person-pro-am&rounds=1&locale=${locale}`);
  const events = page.getByTestId("player-tournament-events"), panel = page.getByTestId("player-pro-panel"), body = page.getByRole("tabpanel");
  await expect(panel).toHaveAttribute("role", "dialog"); await expect(panel).toHaveAttribute("aria-modal", "false");
  // Expand with native Enter; the same semantic subtree remains open at both root font sizes.
  const full = page.getByTestId("player-tournament-standings"); await openNative(page, full);
  const setup = page.getByTestId("player-tournament-frozen-setup"); await openNative(page, setup);
  await openNative(page, setup.locator(":scope > details").first());
  const counting = events.locator(":scope > article > details").nth(4); await openNative(page, counting);
  const firstRound = counting.locator(":scope > details").first(); await openNative(page, firstRound);
  const firstTeam = firstRound.locator(":scope > details").first(); await openNative(page, firstTeam);
  const hosting = events.locator(":scope > article > details").last(); await openNative(page, hosting);
  const baseline = await collectPaint(page); expect(await page.locator("html").evaluate((node) => getComputedStyle(node).fontSize)).toBe("16px");
  await page.evaluate(() => { document.documentElement.style.fontSize = "130%"; });
  const scaled = await collectPaint(page); expect(await page.locator("html").evaluate((node) => getComputedStyle(node).fontSize)).toBe("20.8px");
  expect(scaled.length).toBe(baseline.length); expect(scaled.map(({ index, tag, text }) => ({ index, tag, text }))).toEqual(baseline.map(({ index, tag, text }) => ({ index, tag, text })));
  const ratios = scaled.map((item, index) => ({ ...item, baseline: baseline[index].size, ratio: item.size / baseline[index].size }));
  expect(ratios.filter((item) => Math.abs(item.ratio - 1.3) >= .01)).toEqual([]); expect(scaled.filter((item) => item.contrast < 4.5)).toEqual([]);
  const geometry = await glyphGeometry(page);
  expect(geometry.samples.filter((item) => item.lines.some((line) => line.intersections.length) || item.controlIntersections.length)).toEqual([]);
  expect(geometry.overlaps).toEqual([]); expect(geometry.body.scrollWidth - geometry.body.clientWidth).toBeLessThanOrEqual(1);
  const focused = [];
  const summaries = await events.locator("summary").all();
  expect(summaries.length).toBeLessThanOrEqual(128);
  for (const summary of summaries) {
    if (!await summary.evaluate((node) => node.checkVisibility())) continue;
    focused.push(await focusRing(page, summary, `${locale}-${width}-${focused.length}`));
  }
  expect(focused.length).toBeGreaterThan(1);
  await hosting.locator(":scope > summary").focus();
  await page.keyboard.press("Tab"); await expect(page.getByTestId("outside-after")).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(hosting.locator(":scope > summary")).toBeFocused();
  await body.focus(); await expect(body).toBeFocused();
  const scrollMetrics = await body.evaluate((node) => ({ height: node.scrollHeight, viewport: node.clientHeight }));
  const pages = Math.ceil(scrollMetrics.height / scrollMetrics.viewport);
  const nativeStepCap = pages + Math.ceil(pages * .25) + 8;
  expect(nativeStepCap).toBeLessThanOrEqual(512);
  const frames = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  let upSteps = 0;
  for (; upSteps < nativeStepCap; upSteps += 1) {
    if (await body.evaluate((node) => node.scrollTop === 0)) break;
    await page.keyboard.press("PageUp"); await frames();
  }
  await expect.poll(() => body.evaluate((node) => node.scrollTop)).toBe(0);
  const nativeTop = await body.evaluate((node) => node.scrollTop);
  let downSteps = 0;
  for (; downSteps < nativeStepCap; downSteps += 1) {
    if (await body.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop <= 1)) break;
    await page.keyboard.press("PageDown"); await frames();
  }
  await expect.poll(() => body.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThanOrEqual(1);
  const nativeBottom = await body.evaluate((node) => node.scrollTop); await expect(hosting).toBeInViewport();
  await hosting.locator(":scope > summary").focus(); await page.keyboard.press("Enter"); expect(await hosting.getAttribute("open")).toBeNull();
  await page.keyboard.press("Enter"); await expect(hosting).toHaveAttribute("open", "");
  expect(errors).toEqual([]); expect((await snapshot(page)).immutable).toBe(true);
  await record(page, info, { locale, width, baseline, scaled, ratios, geometry, focused, scrollMetrics, nativeStepCap, upSteps, downSteps, nativeTop, nativeBottom, errors, final: await snapshot(page) });
}
