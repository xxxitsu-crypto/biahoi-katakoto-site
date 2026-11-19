const assert=require('node:assert/strict');
const Reveal=require('../score-reveal.js'),Score=require('../scoring.js');
for(const [previous,points] of [[0,[80,30,225,70,120,100,20]],[615,[80,30,225,70,120,100,30]],[1240,[80,30,225,70,120,100,40]],[0,[]],[615,[]]]){
 const rows=points.map((points,i)=>({label:String(i),points})),subtotal=points.reduce((a,b)=>a+b,0);
 const reveal=new Reveal(rows,previous);let before=0,lastRevealed=0;
 for(let time=0;time<=reveal.end+20;time+=10){
  const s=reveal.advance(10);
  assert.ok(s.score>=before);assert.ok(s.revealed>=lastRevealed);assert.ok(s.score<=subtotal+previous);
  if(s.paired)assert.equal(s.score+s.previous,subtotal+previous);
  before=s.score;lastRevealed=s.revealed;
 }
 assert.deepEqual(reveal.finish(),{score:subtotal+previous,previous:0,revealed:rows.length,paired:false,pop:false,done:true,phase:'total'});
 assert.deepEqual(rows,points.map((points,i)=>({label:String(i),points})));
}
const score=new Score();for(let stage=0;stage<3;stage++){
 if(stage)score.startStage();for(let game=0;game<3;game++){for(let point=0;point<4;point++)score.point('player');score.game('player');}score.clearStage();
 const r=new Reveal(score.breakdown(true),score.checkpoint);assert.equal(r.finish().score,score.total);
}
assert.equal(score.total,1875);
console.log('Score reveal: monotonic row counts, exact carry transfer, zero scores and all-stage totals passed');
