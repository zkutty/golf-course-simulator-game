import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PNG} from 'pngjs';
import {auditDecor,inspectDecor} from './zk1159-decor-audit.mjs';
import {M22_DECOR_REGIONS} from './m22-decor-regions.mjs';
test('all production Decor frames preserve source pixels, clean silhouettes, frame contracts and gutters',()=>{
  const result=auditDecor();assert.equal(result.frames,66);assert.deepEqual(result.failures,[]);
  assert.equal(Object.keys(M22_DECOR_REGIONS).length,11);
});
test('a detached pixel outside the real authored alpha and inside its gutter is rejected',()=>{
  const sprite=PNG.sync.read(readFileSync(new URL('../src/assets/sprites/parkland_planter.png',import.meta.url)));
  assert.equal(inspectDecor(sprite).detachedPixels,0);
  sprite.data[3]=255;
  const contaminated=inspectDecor(sprite);assert.equal(contaminated.detachedPixels,1);assert.equal(contaminated.paddingPixels,1);
});
