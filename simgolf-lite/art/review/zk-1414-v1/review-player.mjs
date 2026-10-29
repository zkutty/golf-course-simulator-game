/** Non-shipping storyboard math, deliberately independent of the production game. */
export function polylineLength(points) {
  return points.slice(1).reduce((n,p,i)=>n+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0);
}
export function routeAt(points,t) {
  const total=polylineLength(points); let d=Math.max(0,Math.min(1,t))*total;
  for(let i=1;i<points.length;i++) {
    const a=points[i-1],b=points[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);
    if(d<=len||i===points.length-1){const q=len?d/len:0;return[a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q];} d-=len;
  }return points[0];
}
export function pacingFor(beat) {
  const putt=beat.kind==='putt';
  return {durationMs:putt?2400+Math.min(40,beat.distanceYards)*45:6000+Math.min(400,beat.distanceYards)*10,
    addressMs:putt?500:1000,contactMs:putt?150:200,restMs:putt?650:900,
    settleMs:putt?300:600,reactionDelayMs:putt?50:300};
}
export function frameAt(storyboard,timeMs,{suppressReaction=false}={}) {
  const t=Math.max(0,Math.min(storyboard.durationMs,timeMs));
  const beat=storyboard.beats.find(b=>t<b.endMs)||storyboard.beats.at(-1);
  const local=t-beat.startMs,duration=beat.endMs-beat.startMs;
  if(beat.kind==='walk')return{beat,phase:beat.phase,pose:Math.floor(local/350)%2?'walk-b':'walk-a',position:routeAt(beat.route,local/duration),ballProgress:null,reaction:null,complete:t===storyboard.durationMs};
  const p=pacingFor(beat),launch=p.addressMs+p.contactMs,restStart=duration-p.restMs;
  const address=beat.lie==='bunker'?'bunker':beat.lie==='fringe'?'chip':beat.kind==='putt'?'putt':'address';
  let phase,pose;
  if(local<p.settleMs){phase='settle';pose=address;}
  else if(local<p.addressMs-(beat.kind==='putt'?100:200)){phase='address';pose=address;}
  else if(local<p.addressMs){phase='backswing';pose=beat.kind==='putt'?'putt':'backswing';}
  else if(local<launch){phase='contact';pose=local<launch-75&&beat.kind!=='putt'?'backswing':beat.kind==='putt'?'putt':'contact';}
  else if(local<launch+350){phase='follow-through';pose=beat.kind==='putt'?'putt':'follow';}
  else{phase='watch';pose='watch';}
  const settled=local>=restStart;
  let reaction=null;
  if(!suppressReaction&&settled&&local>=restStart+p.reactionDelayMs&&['good','bad','hole-out'].includes(beat.observedOutcome)){
    reaction=beat.observedOutcome;phase='reaction';pose=reaction==='bad'?'disappointed':'pleased';
  }
  return{beat,phase,pose,position:beat.position,ballProgress:Math.max(0,Math.min(1,(local-launch)/(restStart-launch))),ballMoving:local>=launch&&local<restStart,reaction,resultKnown:settled,complete:false};
}
export function advanceReviewCursor(current,delta,{hidden=false,paused=false,skip=false,durationMs}={}) {
  if(hidden)return current;
  if(skip)return durationMs;
  if(paused||!Number.isFinite(delta)||delta<=0)return current;
  return Math.min(durationMs,current+Math.min(100,delta));
}
export function matchingSavedCursor(value,key,durationMs) {
  return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='elapsedMs,key,version'
    &&value.version===1&&value.key===key&&Number.isFinite(value.elapsedMs)&&value.elapsedMs>=0&&value.elapsedMs<=durationMs;
}
