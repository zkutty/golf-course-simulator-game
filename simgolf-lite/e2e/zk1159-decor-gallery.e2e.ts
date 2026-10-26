import { expect, test, type TestInfo } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
const evidenceOverride = process.env.ZK1159_EVIDENCE_ROOT ?? null;
const evidencePath = (info: TestInfo, filename: string) => evidenceOverride === null ? info.outputPath(filename) : `${evidenceOverride}/${filename}`;
for(const dpr of [1,2]) test(`ZK1159 native Decor matrix, DPR ${dpr}`, async ({page}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {if(message.type()==="error")errors.push(message.text());});
  if(evidenceOverride !== null) mkdirSync(evidenceOverride,{recursive:true});
  await page.setViewportSize({width:1020,height:820});
  await page.goto(`/e2e/fixtures/zk1159-decor-gallery.html?dpr=${dpr}`);
  await page.waitForFunction(() => "zk1159Gallery" in window);
  const records: unknown[] = [];
  for(const theme of ["parkland","links","desert"] as const)for(const quality of ["high","medium","low"] as const)for(const season of [0,1,2,3])for(const rotation of [0,90,180,270] as const) {
    const result = await page.evaluate(async ({theme,quality,season,rotation}) => {
      const fixture = (window as unknown as {zk1159Gallery:{run:(...args:unknown[])=>Promise<unknown>}}).zk1159Gallery;
      return fixture.run(theme,quality,season,rotation,1,true);
    }, {theme,quality,season,rotation});
    records.push(result);
    if(quality==="high" && rotation===0)await page.locator("canvas").first().screenshot({path:evidencePath(testInfo, `${theme}-${quality}-season${season}-dpr${dpr}.png`)});
  }
  for(const zoom of [0.15,0.5,2,8])for(const rotation of [0,90,180,270]) {
    records.push(await page.evaluate(async ({zoom,rotation}) => {
      const fixture = (window as unknown as {zk1159Gallery:{run:(...args:unknown[])=>Promise<unknown>}}).zk1159Gallery;
      return fixture.run("parkland","high",1,rotation,zoom,true);
    },{zoom,rotation}));
  }
  writeFileSync(evidencePath(testInfo, `matrix-dpr${dpr}.json`),JSON.stringify(records,null,2));
  expect(records).toHaveLength(160);
  expect(errors).toEqual([]);
});
