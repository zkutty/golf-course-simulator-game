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
const save = { schemaVersion: 1, savedAt: Date.now(), course: buildCourse(), world: { week: 1, cash: 25000, reputation: 55, staffLevel: 2, marketingLevel: 1, maintenanceBudget: 1200, runSeed: 4242, distressWeeks: 0, isBankrupt: false, lastWeekProfit: 0, lastBridgeLoanWeek: -999, loans: [] }, history: [] };
const SHOT = '/tmp/claude-0/-home-user-golf-course-simulator-game/e8758271-2dec-53ec-98f3-4f8c478c3f4e/scratchpad';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.evaluate((s) => localStorage.setItem('simgolf_lite_save_v1', JSON.stringify(s)), save);
await page.reload({ waitUntil: 'networkidle' });
await page.getByText('Load Game').waitFor({ timeout: 10000 });
for (let i = 0; i < 5; i++) { await page.getByText('Load Game').click({ force: true, timeout: 2000 }).catch(() => {}); if (await page.locator('button[title="Speed 3x"]').isVisible().catch(() => false)) break; await page.waitForTimeout(600); }

const readInspector = () => page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('span,div'));
  const has = (t) => nodes.some((s) => s.textContent.trim() === t);
  const val = (label) => { const el = nodes.find((s) => s.textContent.trim() === label); return el && el.previousElementSibling ? el.previousElementSibling.textContent.trim() : null; };
  return { open: has('Position') && has('Thru'), thru: val('Thru'), position: val('Position'), score: val('Score'), scorecard: has('Scorecard') };
});
const selectFirst = async () => {
  await page.locator('button[title="Pause"]').click({ force: true });
  await page.waitForTimeout(250);
  const t = await page.evaluate(() => {
    const golfers = window.__ccGolfers || []; const cam = window.__ccCam;
    const canvas = document.querySelector('.cc-course-pane canvas');
    if (!golfers.length || !cam || !canvas) return null;
    const rect = canvas.getBoundingClientRect(); const g = golfers[0];
    const sx = (g.x * cam.tile + cam.tile / 2) * cam.zoom + cam.panX;
    const sy = (g.y * cam.tile + cam.tile / 2) * cam.zoom + cam.panY;
    return { x: rect.left + sx * (rect.width / canvas.width), y: rect.top + sy * (rect.height / canvas.height) };
  });
  if (t) await page.mouse.click(t.x, t.y);
  await page.locator('button[title="Speed 3x"]').click({ force: true });
};

await page.locator('button[title="Speed 3x"]').click({ force: true });
await page.waitForFunction(() => (window.__ccGolfers || []).length >= 1, { timeout: 20000 });
await selectFirst();

let best = null;
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(1200);
  const info = await readInspector();
  console.log(i, JSON.stringify(info));
  if (info.open && info.thru != null) best = info;
  if (info.open && Number(info.thru) >= 1 && info.scorecard) { best = info; break; }
  if (!info.open) await selectFirst(); // selected golfer finished; pick another
}
if (best && best.scorecard) await page.screenshot({ path: SHOT + '/scorecard.png' });
console.log('RESULT:', JSON.stringify(best));
await browser.close();
process.exit(best && best.scorecard && Number(best.thru) >= 1 ? 0 : 2);
