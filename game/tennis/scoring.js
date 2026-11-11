// Shared, deterministic scoring rules. No network or browser dependencies.
(function(root) {
  class TennisScore {
    constructor() { this.reset(); }
    reset() { this.total=0; this.noContinue=0; this.continues=0; this.events=[]; this.startStage(); }
    startStage() { this.checkpoint=this.total; this.checkpointEvents=this.events.length; this.retried=false; this.stageLostPoints=0; this.stageLostGames=0; this.gameStreak=0; this.gameLostPoints=0; this.gamePoints=0; this.games=0; }
    add(points,label) { this.total+=points; this.events.push({points,label}); }
    point(winner) {
      if(winner==='cpu'){this.gameLostPoints++;this.stageLostPoints++;return;}
      this.gamePoints++;
      if(!this.gameLostPoints && this.gamePoints<=4) this.add([10,15,20,30][this.gamePoints-1],'連続得点');
    }
    game(winner) {
      if(winner==='player') {
        this.add(20,'ゲーム獲得'); this.gameStreak++;
        if(!this.gameLostPoints)this.add(20,'PERFECT');
        if(!this.games)this.add(20,'ゲーム先取');
        if(this.gameStreak===2)this.add(30,'2ゲーム連続');
        if(this.gameStreak===3)this.add(40,'3ゲーム連続');
      } else {this.stageLostGames++;this.gameStreak=0;}
      this.games++;this.gameLostPoints=0;this.gamePoints=0;
    }
    clearStage() {
      if(!this.stageLostGames)this.add(60,'完封');
      if(!this.stageLostPoints)this.add(100,'SUPER PERFECT');
      if(!this.retried){this.noContinue++;this.add([20,30,40][Math.min(2,this.noContinue-1)],'NO CONTINUE');}
    }
    breakdown() {
      const groups=[['GAMEポイント',['ゲーム獲得','ゲーム先取']],['連続得点',['連続得点']],['連勝',['2ゲーム連続','3ゲーム連続']],['パーフェクト',['PERFECT','完封']],['スーパーパーフェクト',['SUPER PERFECT']],['ノーコンテニュー',['NO CONTINUE']]];
      return groups.map(([label,labels])=>({label,points:this.events.filter(e=>labels.includes(e.label)).reduce((sum,e)=>sum+e.points,0)})).filter(row=>row.points>0);
    }
    retry() {
      this.total=this.checkpoint;this.noContinue=0;this.continues++;
      this.events.length=this.checkpointEvents;this.startStage();this.retried=true;
    }
  }
  if(typeof module!=='undefined')module.exports=TennisScore;
  else root.TennisScore=TennisScore;
})(typeof window!=='undefined'?window:globalThis);
