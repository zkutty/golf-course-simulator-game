/** Explicit offline staging only. No package/build/workflow or legacy mutation. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const NATURAL_GOLFER_RUNTIME_FILES = Object.freeze(['atlas.png','shadow.png','manifest.json','cost.json']);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function pngSize(bytes){if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw new Error('Invalid PNG header');return[bytes.readUInt32BE(16),bytes.readUInt32BE(20)];}
export async function stageNaturalGolferV1({sourceDir=resolve(root,'art/natural-golfer-v1'),outDir=resolve(root,'public/atlases/natural-golfer-v1')}={}){
  if(resolve(sourceDir)===resolve(outDir))throw new Error('Keep authoring and runtime staging separate');
  const files=Object.fromEntries(await Promise.all(NATURAL_GOLFER_RUNTIME_FILES.map(async name=>[name,await readFile(resolve(sourceDir,name))])));
  if(files['manifest.json'].length>131072||files['cost.json'].length>4096)throw new Error('Metadata byte bound');
  const manifest=JSON.parse(files['manifest.json']),cost=JSON.parse(files['cost.json']);
  if(manifest.schema!=='coursecraft.natural-golfer-atlas'||manifest.version!==1||manifest.texture.file!=='atlas.png'||manifest.shadow.file!=='shadow.png')throw new Error('Unexpected versioned candidate');
  const sizes={};let pngBytes=0,decoded=0;
  for(const[name,expected]of[['atlas.png',manifest.texture],['shadow.png',manifest.shadow]]){
    const [width,height]=pngSize(files[name]);if(width!==expected.width||height!==expected.height||sha(files[name])!==expected.sha256)throw new Error(`PNG dimensions/hash mismatch: ${name}`);
    sizes[name]={width,height};pngBytes+=files[name].length;decoded+=width*height*4;
  }
  if(cost.baseline.compressedPNGBytes!==501591||cost.baseline.decodedRGBABytes!==12700960||cost.manifestBytes!==files['manifest.json'].length||cost.runtimeTextures.compressedPNGBytes!==pngBytes||cost.runtimeTextures.decodedRGBABytes!==decoded||cost.runtimePNGPlusManifestBytes!==pngBytes+files['manifest.json'].length)throw new Error('Cost receipt mismatch');
  for(const file of cost.runtimeTextures.files){if(!sizes[file.file]||file.bytes!==files[file.file].length||file.width!==sizes[file.file].width||file.height!==sizes[file.file].height)throw new Error('Texture byte receipt mismatch');}
  const totalBytes=NATURAL_GOLFER_RUNTIME_FILES.reduce((sum,name)=>sum+files[name].length,0);
  if(totalBytes>501591||decoded>12700960)throw new Error('Complete runtime payload exceeds unchanged budget');
  await mkdir(outDir,{recursive:true});const existing=await readdir(outDir);if(existing.some(name=>!NATURAL_GOLFER_RUNTIME_FILES.includes(name)))throw new Error('Staging directory contains unrelated files');
  for(const name of NATURAL_GOLFER_RUNTIME_FILES)await writeFile(resolve(outDir,name),files[name]);
  return{schema:'coursecraft.natural-golfer-stage',version:1,totalRuntimeBytesIncludingCostReceipt:totalBytes,decodedRGBABytes:decoded,withinBaseline:true,files:NATURAL_GOLFER_RUNTIME_FILES.map(name=>({file:name,bytes:files[name].length,sha256:sha(files[name])}))};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const args=process.argv.slice(2),value=key=>{const i=args.indexOf(key);return i<0?undefined:args[i+1];};console.log(JSON.stringify(await stageNaturalGolferV1({sourceDir:value('--source-dir'),outDir:value('--out-dir')}),null,2));}
