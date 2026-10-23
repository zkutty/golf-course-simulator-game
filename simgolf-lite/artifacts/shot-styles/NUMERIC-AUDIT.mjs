import assert from 'node:assert/strict';
const SCALE=1_000_000;
// Analysis-only candidate. No repository source is changed.
function candidate(v){
  if(v===0)return 0;
  if(typeof v==='number'&&Math.abs(v)<1_000_000){
    const scaled=v*SCALE;
    const nearest=Math.round(scaled);
    if(Math.abs(scaled-nearest)<0.499)return nearest/SCALE;
  }
  return Number(v.toFixed(6));
}
const store=new DataView(new ArrayBuffer(8));
function bits(v){store.setFloat64(0,v);return store.getBigUint64(0);}
function fromBits(b){store.setBigUint64(0,b);return store.getFloat64(0);}
function nextUp(v){if(Number.isNaN(v)||v===Infinity)return v;if(v===0)return Number.MIN_VALUE;return fromBits(bits(v)+(v>0?1n:-1n));}
function nextDown(v){return -nextUp(-v);}
function exactDecimalInteger(v){
  const b=bits(Math.abs(v)),rawExponent=Number((b>>52n)&2047n),fraction=b&((1n<<52n)-1n);
  const significand=rawExponent===0?fraction:(1n<<52n)|fraction;
  const exponent=rawExponent===0?-1074:rawExponent-1023-52;
  let num=significand*1_000_000n,den=1n;
  if(exponent>=0)num<<=BigInt(exponent);else den<<=BigInt(-exponent);
  let n=num/den;if((num%den)*2n>=den)n++;
  return n;
}
let seed=0x7391397;const rng=()=>seed=(Math.imul(seed,1664525)+1013904223)>>>0;
let checked=0,fast=0,fallback=0,divisionChecks=0,naiveMismatches=0;
const examples=[];const started=performance.now();
function display(v){if(Object.is(v,-0))return '-0';return String(v);}
function test(v,kind){
  const old=Number(v.toFixed(6)),actual=candidate(v);checked++;
  assert.ok(Object.is(actual,old),`candidate mismatch ${kind}: ${display(v)} old=${display(old)} actual=${display(actual)}`);
  const scaled=v*SCALE,nearest=Math.round(scaled);
  if(v!==0&&Math.abs(v)<1_000_000&&Math.abs(scaled-nearest)<.499){
    fast++;const exact=exactDecimalInteger(v);assert.ok(exact<=1_000_000_000_000n);
    const q=Number(exact),oracle=v<0?-q/SCALE:q/SCALE;
    assert.ok(Object.is(actual,oracle),`exact-rational mismatch ${kind}: ${display(v)}`);
  }else fallback++;
  const naive=Math.round(v*SCALE)/SCALE;
  if(!Object.is(naive,old)){naiveMismatches++;if(examples.length<24)examples.push({kind,v:display(v),scaled:display(scaled),old:display(old),naive:display(naive),candidate:display(actual)});}
}
for(const v of [0,-0,Number.MIN_VALUE,-Number.MIN_VALUE,2**-1022,-(2**-1022),Number.MAX_VALUE,-Number.MAX_VALUE,Infinity,-Infinity,NaN,.0000005,-.0000005,.0078125,-.0078125,999999.9999995,-999999.9999995,1e6,-1e6,1e21,-1e21])test(v,'special');
for(let i=0;i<300_000;i++)test((rng()/2**32-.5)*2_000_000,'uniform-bounded');
for(let i=0;i<100_000;i++)test(fromBits((BigInt(rng())<<32n)|BigInt(rng())),'raw-binary64');
for(let i=0;i<10_000;i++){
 const n=(rng()*256+(rng()&255))%1_000_000_000_000;
 const mid=(n+.5)/SCALE;
 for(const v of [mid,nextUp(mid),nextDown(mid),nextUp(nextUp(mid)),nextDown(nextDown(mid))]){test(v,'half-neighbors');test(-v,'negative-half-neighbors');}
}
for(let e=-1074;e<=1023;e++)for(const v of [2**e,nextUp(2**e),nextDown(2**e)]){test(v,'binade-boundary');test(-v,'negative-binade-boundary');}
for(let i=0;i<10_000;i++){test((i*2+1)/128,'exact-binary-decimal-half');test(-(i*2+1)/128,'negative-exact-binary-decimal-half');}
for(let i=0;i<200_000;i++){
 const n=(rng()*256+(rng()&255))%1_000_000_000_001;
 const digits=String(n).padStart(7,'0'),decimal=digits.slice(0,-6)+'.'+digits.slice(-6);
 assert.ok(Object.is(n/SCALE,Number(decimal)));assert.ok(Object.is(-n/SCALE,Number('-'+decimal)));divisionChecks+=2;
}
const result={sourceChanged:false,guard:'v===0 => +0; typeof v===number && abs(v)<1e6 && abs(v*1e6-Math.round(v*1e6))<.499 => Math.round(v*1e6)/1e6; otherwise Number(v.toFixed(6))',checked,fast,fallback,divisionChecks,mismatches:0,naiveMismatches,examples,elapsedMs:performance.now()-started};
console.log(JSON.stringify(result));
