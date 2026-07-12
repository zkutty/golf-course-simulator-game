import { chromium } from 'playwright';
const W = 110, H = 70;
function buildCourse() {
  const tiles = Array.from({ length: W * H }, () => 'fairway');
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < W && y < H) tiles[y * W + x] = t; };
  const holes = []; let idx = 0;
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
    const cy = 14 + row * 20, tx = 12 + col * 32, gx = tx + 22;
    set(tx, cy, 'tee');
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) set(gx + dx, cy + dy, 'green');
    holes.push({ tee: { x: tx, y: cy }, green: { x: gx, y: cy }, parMode: 'AUTO', name: `H${idx + 1}` }); idx++;
  }
  return { name: 'V', width: W, height: H, tiles, holes, obstacles: [], yardsPerTile: 10, baseGreenFee: 65, condition: 0.85 };
}
const save = { schemaVersion: 1, savedAt: Date.now(), course: buildCourse(), world: { week: 1, cash: 25000, reputation: 60, staffLevel: 2, marketingLevel: 2, maintenanceBudget: 1200, runSeed: 4242, distressWeeks: 0, isBankrupt: false, lastWeekProfit: 0, lastBridgeLoanWeek: -999, loans: [] }, history: [] };
const SHOT = '/tmp/claude-0/-home-user-golf-course-simulator-game/e8758271-2dec-53ec-98f3-4f8c478c3f4e/scratchpad';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage();
await p.addInitScript((s) => localStorage.setItem('simgolf_lite_save_v1', JSON.stringify(s)), save);
await p.goto('http://localhost:5173/?livegolfers=20', { waitUntil: 'domcontentloaded' });
await p.getByText('Load Game').waitFor({ timeout: 20000 });
for (let i = 0; i < 6; i++) { await p.getByText('Load Game').click({ force: true, timeout: 2000 }).catch(() => {}); if (await p.locator('button[title="Speed 3x"]').isVisible().catch(() => false)) break; await p.waitForTimeout(500); }
await p.locator('button[title="Speed 3x"]').click({ force: true });
await p.waitForFunction(() => (window.__ccGolfers || []).length >= 8, { timeout: 40000 }).catch(() => {});
const n = await p.evaluate(() => (window.__ccGolfers || []).length);
await p.screenshot({ path: SHOT + '/busy-course.png' });
console.log('ON_COURSE:', n);
await b.close();
process.exit(n >= 8 ? 0 : 2);
