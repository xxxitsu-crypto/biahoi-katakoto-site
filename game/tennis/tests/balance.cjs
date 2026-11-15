// Runs the actual game's state transitions with minimal browser/audio stubs.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..');
const draw=new Proxy({}, {get:(_,key)=>key==='measureText'?()=>({width:100}):()=>{}});
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{dataset:{},style:{},classList:{toggle(){}},addEventListener(type,fn){(this.listeners??={})[type]=fn;},setAttribute(){},removeAttribute(){},getContext:()=>draw,getBoundingClientRect:()=>({left:0,top:0,width:512,height:640}),focus(){},replaceChildren(){},append(){},showModal(){this.open=true},close(){this.open=false},value:'',textContent:''});return elements.get(id);}
const pending=[];const w={addEventListener(){},SEAL_RANKING_API:''};
const context={assert,window:w,document:{getElementById:element,createElement:()=>element(Symbol()),addEventListener(){},querySelectorAll:()=>[],hidden:false,hasFocus:()=>true},Image:class{addEventListener(){}},console,performance:{now:()=>0},requestAnimationFrame(){},setTimeout:f=>{pending.push(f);return pending.length},clearTimeout(){},crypto:require('node:crypto').webcrypto,localStorage:{getItem:()=>'',setItem(){}},fetch:async()=>({ok:false}),Audio:class{addEventListener(){}},ResizeObserver:class{observe(){}},innerHeight:800,innerWidth:600};
w.window=w;vm.createContext(context);
for(const f of ['scoring.js','ranking.js','main.js']){vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context,{filename:f});if(f==='scoring.js')context.TennisScore=w.TennisScore;}
// scoring.js attaches to window as in a browser.

const run=source=>vm.runInContext(source,context);

run(`sound.enabled=false;
function setup(stage,server='cpu'){campaign.stage=stage;cpu=createOpponent();match.reset(server);arcade.reset();input.cancel();Object.assign(player,new SealPlayer(120,180));ball.resetServe();Object.assign(ball,{resetTimer:0,playTicks:0,serveWaiting:false,serving:false,cpuServing:false,servicePending:false,lastHitter:'player',rallyHits:1,bouncesInCurrentCourt:0});screen.phase='playing';}
let serveResults=[];
for(const x of [104,116,128,140,152])for(const ticks of [54,72]){
 setup(2,'player');Object.assign(ball,{x:120,y:206,z:30,rallyHits:0,serviceTargetX:x});launchOverNet(ball,x,102,ticks,.075);ball.servicePending=true;Math.random=()=>.1;let swung=false;
 for(let n=0;n<200&&!ball.resetTimer&&ball.lastHitter==='player';n++){cpu.update(ball);swung||=cpu.isSwinging;ball.update(player,cpu);}
 assert(!cpu.centerWhiff);serveResults.push({x,ticks,returned:ball.lastHitter==='cpu',swung,msg:ball.message});
}
assert(serveResults.every(r=>r.returned),'all sampled serves should be received');console.log('Serve returns',serveResults);
let normal=[];for(const x of [64,96,128,160,192])for(const rng of [.1,.9]){setup(2);Object.assign(ball,{x:128,y:176,z:12});ball.launch(x,60,48,.09);Math.random=()=>rng;let swung=false;for(let n=0;n<140&&!ball.resetTimer&&ball.lastHitter==='player';n++){cpu.update(ball);swung||=cpu.isSwinging;ball.update(player,cpu);}normal.push({x,rng,returned:ball.lastHitter==='cpu',whiff:cpu.centerWhiff,swung});}
console.log('Rally returns',normal);
`);
run(`
let specials=[];
for(const dir of [-1,0,1])for(const superShot of [false,true])for(const rng of [.1,.9]){
 setup(3);Math.random=()=>rng;
 Object.assign(player,{shotType:'smash',isSwinging:true,hasHit:false,lobShot:false});
 player.swingElapsed=VOLLEY.smash.phases.slice(0,VOLLEY.smash.phases.findIndex(p=>p.quality==='smash')).reduce((n,p)=>n+p.ticks,0);
 if(dir)input.keys.add(dir<0?'ArrowLeft':'ArrowRight');
 const r=player.getRacketPosition();Object.assign(ball,{x:r.x,y:r.y-1,z:r.z,vx:0,vy:1,vz:0,lastHitter:'cpu',lastShotQuality:'float',erinSmashOpening:!superShot,erinSuper:superShot});
 ball.update(player,null);assert.equal(ball.lastHitter,'player');
 const target=ball.x+ball.vx*(superShot?40:30);assert.equal(Math.sign(target-128),dir);
 assert.equal(ball.erinRecoveryMiss,!superShot&&rng<.3);assert.equal(!!ball.guaranteedWinner,superShot);
 let swung=false,bounced=false,scoreOnBounce=false;
 for(let n=0;n<160&&!ball.resetTimer&&ball.lastHitter==='player';n++){
  cpu.update(ball);swung||=cpu.isSwinging;ball.update(player,cpu);
  if(ball.bouncesInCurrentCourt===1){bounced=true;scoreOnBounce||=score.player>0;}
 }
 const miss=superShot||rng<.3;
 if(miss){assert(swung,'opponent must attempt a swing');assert.equal(score.player,1);assert(bounced,'must bounce before winning');assert(!scoreOnBounce||ball.y < -30,'no score on first landing');}
 else if(ball.lastHitter==='cpu'){assert(ball.erinSmashOpening);assert.equal(ball.lastShotQuality,'float');}
 specials.push({dir,superShot,rng,swung,bounced,returned:ball.lastHitter==='cpu',point:score.player});
 if(ball.pointFlight){const total=arcade.total,y=ball.pointFlight.y;for(let i=0;i<36;i++)ball.updatePointFlight();assert(ball.pointFlight.y<y);assert.equal(arcade.total,total);ball.resetServe();assert.equal(ball.pointFlight,null);}
}
console.log('Special shots',specials);
`);
run(`
let contacts=[];
for(const target of [96,128,160]){
 setup(2);Math.random=()=>.9;Object.assign(ball,{x:128,y:176,z:12});ball.launch(target,60,48,.09);
 const hit=cpu.hit;cpu.hit=function(b){contacts.push({target,x:this.x,y:this.y,kind:this.shotKind,elapsed:this.swingElapsed,b:{x:b.x,y:b.y,z:b.z}});hit.call(this,b);};
 for(let n=0;n<140&&!ball.resetTimer&&ball.lastHitter==='player';n++){cpu.update(ball);ball.update(player,cpu);}
}
assert.equal(contacts.length,3);
setup(2);cpu.startSwing('rightShot');cpu.swingElapsed=7;const racket=cpu.racket();
Object.assign(ball,{x:racket.x+20,y:racket.y,z:racket.z,vy:-1});assert(!cpu.canHit(ball),'distant ball must not hit');
Object.assign(ball,{x:racket.x,y:racket.y,z:racket.z});assert(cpu.canHit(ball),'racket center must hit');
let whiffCount=0;for(let i=0;i<100;i++){setup(2);Object.assign(ball,{x:128,y:176,z:12});ball.launch(128,60,48,.09);Math.random=()=>(i+.5)/100;cpu.update(ball);if(cpu.centerWhiff)whiffCount++;}assert.equal(whiffCount,50);
console.log('PASS exact contact, detached-ball rejection, 50/100 central whiffs');
`);
