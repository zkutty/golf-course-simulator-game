import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const p=fileURLToPath(new URL('.',import.meta.url));
const read=n=>readFileSync(p+n,'utf8');
const data=n=>'data:image/png;base64,'+readFileSync(n).toString('base64');
const m=read('activity-manifest.v1.json'),s=read('storyboard.v1.json');
const assets={candidate:data(p+'golfer-look-source.png'),base:data(p+'../../../src/assets/sprites/golfers/golfer0_swing.grid8x5.png'),tint:data(p+'../../../src/assets/sprites/golfers/golfer0_swing_t.grid8x5.png')};
const out=read('review.template.html').replace('__MANIFEST__',()=>m).replace('__STORYBOARD__',()=>s).replace('__ASSETS__',()=>JSON.stringify(assets)).replace('__PLAYER__',()=>read('review-player.mjs').replaceAll('export function','function'));
writeFileSync(p+'review.html',out);console.log('Built self-contained review.html');
