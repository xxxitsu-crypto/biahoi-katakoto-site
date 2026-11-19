// Deterministic presentation only: never mutates the actual score.
(function(root){
 class ScoreReveal {
  constructor(rows,previous=0){
   this.rows=rows.map(r=>({...r}));this.previous=previous;
   this.subtotal=rows.reduce((n,r)=>n+r.points,0);
   this.time=0;this.rowStart=350;this.rowDuration=620;
   this.pairStart=this.rowStart+rows.length*this.rowDuration+400;
   this.transferStart=this.pairStart+500;
   this.popStart=previous>0?this.transferStart+1000+150:this.pairStart;
   this.end=this.popStart+500;
  }
  advance(ms){this.time=Math.min(this.end,this.time+Math.max(0,ms));return this.state();}
  finish(){this.time=this.end;return this.state();}
  state(){
   const t=this.time;let score=0,revealed=0;
   this.rows.forEach((r,i)=>{const local=t-this.rowStart-i*this.rowDuration;if(local>=0){revealed++;score+=Math.round(r.points*Math.min(1,local/320));}});
   const paired=this.previous>0&&t>=this.pairStart&&t<this.popStart;
   const moved=this.previous>0?Math.round(this.previous*Math.max(0,Math.min(1,(t-this.transferStart)/1000))):0;
   if(t>=this.pairStart)score=this.subtotal+moved;
   return {score,previous:this.previous-moved,revealed,paired,pop:t>=this.popStart&&t<this.end,done:t>=this.end,phase:t<this.pairStart?'bonuses':paired?'transfer':'total'};
  }
 }
 if(typeof module!=='undefined')module.exports=ScoreReveal;else root.ScoreReveal=ScoreReveal;
})(typeof window!=='undefined'?window:globalThis);
