import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { M22_DECOR_REGIONS } from './m22-decor-regions.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function inspectDecor(png) {
  const {width:w,height:h,data} = png;
  const visited = new Uint8Array(w*h), components=[];
  let paddingPixels=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;
    if((x<2||y<2||x>=w-2||y>=h-2)&&data[i*4+3])paddingPixels++;
    if(visited[i]||data[i*4+3]<8)continue;
    const queue=[i];visited[i]=1;
    for(let k=0;k<queue.length;k++){
      const n=queue[k],xx=n%w,yy=Math.floor(n/w);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const sx=xx+dx,sy=yy+dy,j=sy*w+sx;
        if(sx<0||sx>=w||sy<0||sy>=h||visited[j]||data[j*4+3]<8)continue;
        visited[j]=1;queue.push(j);
      }
    }
    components.push(queue);
  }
  components.sort((a,b)=>b.length-a.length);
  const silhouette=new Uint8Array(w*h);
  for(const n of components[0]??[])for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
    const x=n%w+dx,y=Math.floor(n/w)+dy;if(x>=0&&x<w&&y>=0&&y<h)silhouette[y*w+x]=1;
  }
  const detached=components.slice(1).filter(c=>c.every(n=>!silhouette[n]));
  return {width:w,height:h,paddingPixels,foregroundPixels:components.flat().length,detachedPixels:detached.flat().length,detachedClusters:detached.length};
}
export function auditDecor(atlasRoot=path.join(root,'public/atlases'), spriteRoot=path.join(root,'src/assets/sprites')) {
  const report=[], failures=[];
  const names=Object.keys(M22_DECOR_REGIONS);
  const atlasFiles=['buildings-decor.json'];
  const manifestPath=path.join(atlasRoot,'biomes/manifest.json');
  let manifest;
  try {manifest=JSON.parse(readFileSync(manifestPath));}catch { /* Before-control can supply the aggregate only. */ }
  if(manifest)for(const theme of ['parkland','links','desert']){
    const bundles=['high','medium','low'].map(q=>manifest.biomes[theme][q].base.buildings);
    assert.equal(new Set(bundles.map(b=>b.json)).size,1,`${theme}: stale tier bundle`);
    atlasFiles.push(`biomes/${bundles[0].json}`);
  }
  for(const file of atlasFiles){
    const metadata=JSON.parse(readFileSync(path.join(atlasRoot,file)));
    const atlas=PNG.sync.read(readFileSync(path.join(atlasRoot,path.dirname(file),metadata.meta.image)));
    assert.deepEqual(metadata.meta.size,{w:atlas.width,h:atlas.height});
    for(const [name,entry] of Object.entries(metadata.frames)){
      if(!['parkland','links','desert'].some(theme=>names.some(kind=>name===`${theme}_${kind}`)))continue;
      const {x,y,w,h}=entry.frame;
      assert.ok([x,y,w,h].every(Number.isInteger)&&x>=2&&y>=2&&w>0&&h>0&&x+w<=atlas.width-2&&y+h<=atlas.height-2,`${file}/${name}: frame bounds`);
      assert.equal(entry.trimmed,false);assert.equal(entry.rotated,false);
      assert.deepEqual(entry.sourceSize,{w,h});assert.deepEqual(entry.spriteSourceSize,{x:0,y:0,w,h});
      const crop=new PNG({width:w,height:h});PNG.bitblt(atlas,crop,x,y,w,h,0,0);
      const source=PNG.sync.read(readFileSync(path.join(spriteRoot,`${name}.png`)));
      assert.equal(source.width,w);assert.equal(source.height,h);assert.ok(source.data.equals(crop.data),`${name}: source/atlas pixel mismatch`);
      const result=inspectDecor(crop);report.push({atlas:file,name,...result});
      if(result.paddingPixels||result.detachedPixels)failures.push({atlas:file,name,...result});
      // Packing's entire immediate gutter must be transparent, not another frame.
      for(let yy=y-1;yy<=y+h;yy++)for(let xx=x-1;xx<=x+w;xx++)if(xx<x||xx>=x+w||yy<y||yy>=y+h)assert.equal(atlas.data[(yy*atlas.width+xx)*4+3],0,`${name}: atlas gutter bleed`);
    }
  }
  return {frames:report.length,report,failures,passed:failures.length===0};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const result=auditDecor(process.argv[2],process.argv[3]);console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
}
