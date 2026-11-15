// Runs the actual game's state transitions with minimal browser/audio stubs.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..');
const draw=new Proxy({}, {get:(_,key)=>key==='measureText'?()=>({width:100}):()=>{}});
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{dataset:{},style:{},classList:{toggle(){}},addEventListener(type,fn){(this.listeners??={})[type]=fn;},setAttribute(){},removeAttribute(){},getContext:()=>draw,getBoundingClientRect:()=>({left:0,top:0,width:512,height:640}),focus(){},replaceChildren(){},append(){},showModal(){this.open=true},close(){this.open=false},value:'',textContent:''});return elements.get(id);}
const pending=[];const w={addEventListener(){},SEAL_RANKING_API:''};
const context={assert,window:w,document:{getElementById:element,createElement:()=>element(Symbol()),addEventListener(){},querySelectorAll:()=>[],hidden:false,hasFocus:()=>true},Image:class{addEventListener(){}},console,performance:{now:()=>0},requestAnimationFrame(){},setTimeout:f=>{pending.push(f);return pending.length},clearTimeout(){},crypto:require('node:crypto').webcrypto,localStorage:{getItem:()=>'',setItem(){}},fetch:async()=>({ok:false}),Audio:class{addEventListener(){}},ResizeObserver:class{observe(){}},innerHeight:800,innerWidth:600};
w.window=w;vm.createContext(context);
for(const f of ['scoring.js','ranking.js',process.env.SOURCE||'main.js']){vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context,{filename:f});if(f==='scoring.js')context.TennisScore=w.TennisScore;}
// scoring.js attaches to window as in a browser.

const run=source=>vm.runInContext(source,context);

run(`sound.enabled=false;
for(const stage of [2])for(const aim of [-1,0,1]){let cases=0,returned=0,playerPoints=0,cpuPoints=0,missedSwings=0,dead=0;const details=[];
for(let trial=0;trial<1;trial++)for(const px of [104,112,120,128,136])for(let delay=0;delay<85;delay++){
 Math.random=()=>.9;campaign.stage=stage;cpu=createOpponent();match.reset('cpu');input.cancel();Object.assign(player,new SealPlayer(px,180));player.cancelVersion=input.cancelVersion;
 ball.resetServe();ball.playTicks=0;screen.phase='playing';
 const originalHit=cpu.hit.bind(cpu);cpu.hit=b=>{const r=cpu.racket();assert(cpu.phase()?.quality);assert(Math.hypot(b.x-r.x,b.y-r.y)<r.hitRadius);assert(Math.abs(b.z-r.z)<r.hitHeight);const xyz=[b.x,b.y,b.z];originalHit(b);assert.deepEqual([b.x,b.y,b.z],xyz);};
 for(let n=0;n<100&&ball.cpuServing&&!ball.resetTimer;n++){cpu.update(ball);ball.update(player,cpu);}
 let didReturn=false,cpuReturned=false,maxDash=0,start=null,end=null;
 for(let n=0;n<180&&!ball.resetTimer;n++){
  if(n===delay){if(aim)input.keys.add(aim<0?'ArrowLeft':'ArrowRight');input.pressShot('test');input.releaseShot('test');}
  player.update(input,ball);cpu.update(ball);ball.update(player,cpu);
  if(!didReturn&&ball.lastHitter==='player'){didReturn=true;start={px,delay,x:ball.x,y:ball.y,z:ball.z,vx:ball.vx,quality:ball.lastShotQuality,cpuX:cpu.x,cpuY:cpu.y};}
  if(didReturn){maxDash=Math.max(maxDash,cpu.dashSpeed*(cpu.dashTimer>0));if(ball.lastHitter==='cpu'){cpuReturned=true;break;}end={x:cpu.x,y:cpu.y,plan:cpu.plan,swing:cpu.isSwinging};}
 }
 if(didReturn){cases++;if(cpuReturned)returned++;if(score.player)playerPoints++;if(score.cpu)cpuPoints++;if(!cpuReturned&&!ball.resetTimer)dead++;}
}
assert.equal(cases,87);assert.equal(dead,0);assert(returned >= (aim===-1?65:aim===1?55:75),'serve-return coverage regressed: '+aim+' '+returned);console.log(JSON.stringify({stage,aim,cases,returned,playerPoints,cpuPoints,dead}));}
`);
