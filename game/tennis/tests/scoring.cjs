const assert=require('node:assert/strict');
const Score=require('../scoring.js');
const win=s=>{for(let n=0;n<4;n++)s.point('player');s.game('player');};
const perfect=s=>{for(let n=0;n<3;n++)win(s);s.clearStage();};
let s=new Score();win(s);assert.equal(s.total,135); // 115 + first-game 20
win(s);win(s);s.clearStage();assert.equal(s.total,615); // 595 + no-continue 20
s.startStage();perfect(s);assert.equal(s.total,1240); // +595 +30
s.startStage();perfect(s);assert.equal(s.total,1875); // +595 +40
s=new Score();perfect(s);s.startStage();win(s);s.retry();assert.equal(s.total,615);assert.equal(s.noContinue,0);assert.equal(s.continues,1);
perfect(s);assert.equal(s.total,1210); // retried stage: 595, no no-continue
s.startStage();perfect(s);assert.equal(s.total,1825); // next stage starts again at +20
s=new Score();s.point('player');s.point('cpu');for(let n=0;n<3;n++)s.point('player');s.game('player');assert.equal(s.total,50); // 10 + basic20 + first20
s=new Score();s.point('cpu');s.game('cpu');win(s);assert.equal(s.total,115); // opponent took first game
console.log('Scoring: perfect run, retry rollback, streak restart, lost point, first-game bonus passed');

s=new Score();perfect(s);s.startStage();win(s);s.retry();assert.equal(s.breakdown().reduce((n,r)=>n+r.points,0),s.total);perfect(s);assert.equal(s.breakdown().reduce((n,r)=>n+r.points,0),1210);s.retry();assert.equal(s.breakdown().reduce((n,r)=>n+r.points,0),615);
