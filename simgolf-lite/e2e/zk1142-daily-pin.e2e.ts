import {test,expect} from "@playwright/test";

test("daily pin A/B/C moves the actual flag and discloses a missing alternate",async({page})=>{
 await page.goto("/?m23Fixture=1");await page.waitForFunction(()=>window.__coursecraftPixiTest?.activeFlagGeometry());
 const stored=await page.evaluate(()=>JSON.parse(window.render_game_to_text!()).course.holeSetups[0].pinPositions);
 for(const pin of ["A","B","C"] as const){
  await page.getByTestId("daily-pin-rotation").selectOption(pin);
  const row=await page.evaluate(({pin,stored})=>new Promise<{flag:{anchor:{x:number;y:number}};expected:{x:number;y:number};route:{x:number;y:number};selected:string}>(resolve=>requestAnimationFrame(()=>{const state=JSON.parse(window.render_game_to_text!()),hooks=window.__coursecraftPixiTest!;resolve({flag:hooks.activeFlagGeometry()!,expected:hooks.tileToScreen(stored[pin].x,stored[pin].y)!,route:state.editor.activeRoute.pin,selected:state.course.activePinRotation});})),{pin,stored});
  expect(row.selected).toBe(pin);expect(row.route).toEqual(stored[pin]);expect(Math.hypot(row.flag.anchor.x-row.expected.x,row.flag.anchor.y-row.expected.y)).toBeLessThan(1);
 }
 await page.getByRole("button",{name:"Remove Pin B",exact:true}).click();await page.getByTestId("daily-pin-rotation").selectOption("B");
 await expect(page.getByTestId("daily-pin-fallback-status")).toContainText("Using Pin A");await expect(page.getByTestId("pin-fallback-status")).toContainText("Using Pin A");
 expect(await page.evaluate(()=>JSON.parse(window.render_game_to_text!()).editor.activeRoute.pin)).toEqual(stored.A);
});

for(const dpr of [1,2])test(`nine native flags stay coherent at DPR ${dpr}`,async({browser,baseURL})=>{
 const context=await browser.newContext({viewport:{width:1200,height:900},deviceScaleFactor:dpr}),page=await context.newPage(),errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 await page.goto(`${baseURL}/e2e/fixtures/zk1142-native-pins.html`);await page.waitForFunction(()=>"zk1142Native" in window);
 type Result={flags:{x:number;y:number}[];expected:{x:number;y:number}[];flagCount:number;markerCount:number;repeat:string[]};
 const sorted=(points:Result["flags"])=>points.sort((a,b)=>a.x-b.x||a.y-b.y);
 for(const partial of [false,true])for(const rotation of [0,90,180,270])for(const zoom of [.15,.5,1,2,8])for(const pin of ["A","B","C"]){
  const row=await page.evaluate(args=>(window as unknown as {zk1142Native:{render:(...args:unknown[])=>Result}}).zk1142Native.render(...args),[pin,rotation,zoom,partial,true]);
  expect(row.flagCount).toBe(9);expect(sorted(row.flags)).toEqual(sorted(row.expected));expect(row.repeat).toEqual([]);
 }
 const hidden=await page.evaluate(()=>(window as unknown as {zk1142Native:{render:(...args:unknown[])=>Result}}).zk1142Native.render("C",270,1,true,false));expect(hidden.flagCount).toBe(9);expect(hidden.markerCount).toBe(0);expect(sorted(hidden.flags)).toEqual(sorted(hidden.expected));expect(errors).toEqual([]);await context.close();
});
