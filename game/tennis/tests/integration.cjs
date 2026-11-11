// Runs the actual game's state transitions with minimal browser/audio stubs.
const vm=require('node:vm'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.join(__dirname,'..');
const draw=new Proxy({}, {get:(_,key)=>key==='measureText'?()=>({width:100}):()=>{}});
const elements=new Map();
function element(id){if(!elements.has(id))elements.set(id,{dataset:{},style:{},classList:{toggle(){}},addEventListener(){},setAttribute(){},removeAttribute(){},getContext:()=>draw,getBoundingClientRect:()=>({left:0,top:0,width:512,height:640}),focus(){},replaceChildren(){},append(){},showModal(){this.open=true},close(){this.open=false},value:'',textContent:''});return elements.get(id);}
const pending=[];const w={addEventListener(){},SEAL_RANKING_API:''};
const context={window:w,document:{getElementById:element,createElement:()=>element(Symbol()),addEventListener(){},querySelectorAll:()=>[],hidden:false,hasFocus:()=>true},Image:class{addEventListener(){}},console,performance:{now:()=>0},requestAnimationFrame(){},setTimeout:f=>{pending.push(f);return pending.length},clearTimeout(){},crypto:require('node:crypto').webcrypto,localStorage:{getItem:()=>'',setItem(){}},fetch:async()=>({ok:false}),Audio:class{addEventListener(){}},ResizeObserver:class{observe(){}},innerHeight:800,innerWidth:600};
w.window=w;vm.createContext(context);
for(const f of ['scoring.js','ranking.js','main.js']){vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context,{filename:f});if(f==='scoring.js')context.TennisScore=w.TennisScore;}
// scoring.js attaches to window as in a browser.

const run=source=>vm.runInContext(source,context);
assert.equal(run('screen.phase'),'title');
run('for(let n=0;n<480;n++)clock.update()');assert.equal(run('screen.phase'),'ranking');
pending.at(-1)();assert.equal(run('screen.phase'),'title');
run('for(let n=0;n<480;n++)clock.update()');assert.equal(run('screen.phase'),'ranking');
pending.at(-1)();assert.equal(run('screen.phase'),'title');
run('returnToOpening();startOpening();resetPractice();for(let n=0;n<12;n++)match.award("player")');
assert.equal(run('arcade.total'),615);assert.equal(run('match.winner'),'player');
run('screen.phase="playing";campaign.transitionTicks=1;clock.update()');assert.equal(run('campaign.stage'),2);
run('resetPractice();for(let n=0;n<4;n++)match.award("player");for(let n=0;n<12;n++)match.award("cpu");screen.phase="continue";input.pressShot("test")');
assert.equal(run('arcade.total'),615);assert.equal(run('arcade.continues'),1);
run('screen.phase="continue";screen.ticks=1;clock.update()');assert.equal(run('screen.phase'),'record');
assert.equal(element('ranking-form').hidden,false);
run('returnToOpening();campaign.selectedStage=3;startOpening();resetPractice();for(let n=0;n<12;n++)match.award("player");screen.ticks=1;clock.update()');
assert.equal(run('screen.phase'),'result');pending.at(-1)();assert.equal(run('screen.phase'),'record');assert.equal(element('ranking-submit').textContent,'エンディングへ');
console.log('Integration: idle ranking, game scoring, stage transition, retry rollback, timeout record, clear record passed');
