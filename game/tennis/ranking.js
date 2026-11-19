// Court-aligned screens; native input keeps Japanese IME and mobile keyboards.
const rankingUI = (() => {
  const dialog=document.getElementById('ranking-dialog');
  const heading=document.getElementById('ranking-heading');
  const scoreText=document.getElementById('ranking-score');
  const breakdown=document.getElementById('ranking-breakdown');
  const stageLabel=document.getElementById('ranking-stage');
  const stagePoints=document.getElementById('ranking-stage-points');
  const form=document.getElementById('ranking-form');
  const name=document.getElementById('ranking-name');
  const submit=document.getElementById('ranking-submit');
  const message=document.getElementById('ranking-message');
  const table=document.getElementById('ranking-table');
  const next=document.getElementById('ranking-next');
  let reveal=null, revealNodes=[], currentNumber=null, previousNumber=null, plusSign=null, lastFrame=null, announcedRows=0, totalAnnounced=false;
  let timer, generation=0, completed=false, returnHome=false, savedId=null, runId=null, busy=false;
  const clean=value=>Array.from(value.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu,'').trim()).slice(0,6).join('');
  const api=()=>window.SEAL_RANKING_API?.replace(/\/$/,'');
  async function request(path,options={}) {
    if(!api())throw new Error('共有ランキングの接続設定が必要です。');
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
    try {
      const response=await fetch(api()+path,{...options,signal:controller.signal});
      if(!response.ok)throw new Error('登録・取得できませんでした。もう一度お試しください。');
      return await response.json();
    }catch(error){if(error.name==='AbortError')throw new Error('通信がタイムアウトしました。');throw error;}
    finally{clearTimeout(timeout);}
  }
  function position() {
    if(!dialog.open)return;
    const b=canvas.getBoundingClientRect();
    Object.assign(dialog.style,{left:b.left+'px',top:b.top+'px',width:b.width+'px',height:b.height+'px'});
  }
  function prepare(phase) {
    reveal=null;lastFrame=null;scoreText.removeAttribute('aria-label');scoreText.classList.remove('paired','score-pop');
    clearTimeout(timer);generation++;input.cancel();screen.phase=phase;
    document.getElementById('game-container').dataset.screen=phase;
    dialog.dataset.mode=phase;
    heading.textContent=phase==='ranking'?'ランキング':'スコア';
    table.replaceChildren();breakdown.replaceChildren();message.textContent='';scoreText.textContent='';
    stageLabel.hidden=true;stagePoints.hidden=true;form.hidden=true;submit.hidden=true;next.hidden=true;next.textContent='登録せず進む';submit.disabled=false;next.disabled=false;busy=false;
    if(dialog.open)dialog.close();
    if(phase==='ranking'||phase==='result')dialog.show();else dialog.showModal();
    position();
  }
  function close() {reveal=null;lastFrame=null;clearTimeout(timer);generation++;dialog.close();input.cancel();}
  function finish() {close();if(completed)beginEnding();else returnToOpening();canvas.focus();}
  function showScore(stageOnly=false) {
    scoreText.textContent=String(arcade.total);
    for(const row of arcade.breakdown(stageOnly)){
      const line=document.createElement('div');line.className='score-detail';
      const label=document.createElement('span');label.textContent=row.label;
      const value=document.createElement('span');value.textContent=String(row.points);
      line.append(label,value);breakdown.append(line);
    }
  }
  async function load() {
    const version=generation;message.textContent='読み込み中…';
    try {
      const data=await request('/scores?stage='+campaign.selectedStage);
      if(version!==generation)return;
      const entries=data.entries.slice(0,5);
      const t=document.createElement('table');t.setAttribute('aria-label','ベスト５');const body=t.createTBody();
      for(let i=0;i<5;i++){
        const entry=entries[i],row=body.insertRow();
        if(entry&&entry.id===savedId)row.className='my-record';
        for(const value of ['#'+(i+1),entry?.name??'—',entry?.score??'—'])row.insertCell().textContent=String(value);
      }
      table.replaceChildren(t);message.textContent=entries.length?'':'まだ記録がありません。';
    }catch(error){if(version===generation)message.textContent=error.message;}
  }
  function show(auto=true,fromResult=false) {
    if(!fromResult){completed=false;savedId=null;}
    prepare('ranking');load();timer=setTimeout(finish,8000);
  }
  function record(clear,home=false) {
    returnHome=home;
    completed=clear;savedId=null;runId=crypto.randomUUID();
    prepare('record');showScore();form.hidden=false;submit.hidden=false;
    submit.textContent=clear?'エンディングへ':'ホームに戻る';
    try{name.value=localStorage.getItem('seal-ranking-name')||'';}catch{}
    name.placeholder='６文字まで';
    // Keyboard opens only when the player chooses the input.
    submit.focus();
  }
  function result() {
    completed=campaign.stage===3;prepare('result');
    stageLabel.hidden=false;stageLabel.textContent='STAGE '+campaign.stage+' CLEAR';
    const rows=arcade.breakdown(true);
    reveal=new ScoreReveal(rows,arcade.checkpoint);announcedRows=0;totalAnnounced=false;lastFrame=null;
    currentNumber=document.createElement('span');currentNumber.className='score-current';
    plusSign=document.createElement('span');plusSign.className='score-plus';plusSign.textContent='＋';
    previousNumber=document.createElement('span');previousNumber.className='score-previous';
    scoreText.append(currentNumber,plusSign,previousNumber);
    revealNodes=rows.map(row=>{
      const line=document.createElement('div');line.className='score-detail score-pending';
      const label=document.createElement('span');label.textContent=row.label;
      const value=document.createElement('span');value.textContent=String(row.points);
      line.append(label,value);breakdown.append(line);return line;
    });
    stagePoints.hidden=false;next.hidden=false;next.disabled=true;next.textContent='集計中…';
    paintReveal(reveal.state());
  }
  function paintReveal(state){
    currentNumber.textContent=String(state.score);previousNumber.textContent=String(state.previous);
    scoreText.classList.toggle('paired',state.paired);scoreText.classList.toggle('score-pop',state.pop);
    plusSign.setAttribute('aria-hidden',String(!state.paired));previousNumber.setAttribute('aria-hidden',String(!state.paired));
    revealNodes.forEach((line,i)=>{line.classList.toggle('score-pending',i>=state.revealed);line.setAttribute('aria-hidden',String(i>=state.revealed));});
    stagePoints.textContent=state.phase==='bonuses'?'今回の獲得スコア':state.paired?'今回 ＋ 前回までの累計':'合計スコア';
    if(state.done){next.disabled=false;next.textContent='次へ';scoreText.setAttribute('aria-label','合計スコア '+state.score);}
  }
  function update(now){
    if(!reveal||screen.phase!=='result'){lastFrame=null;return;}
    if(document.hidden){lastFrame=null;return;}
    const delta=lastFrame===null?0:Math.min(100,Math.max(0,now-lastFrame));lastFrame=now;
    const state=reveal.advance(delta);paintReveal(state);
    while(announcedRows<state.revealed){sound.tune('bonus');announcedRows++;}
    if((state.pop||state.done)&&!totalAnnounced){sound.tune('score-total');totalAnnounced=true;}
  }
  function advanceResult(){
    if(screen.phase!=='result'||(reveal&&!reveal.state().done))return;
    if(completed){record(true);return;}
    close();campaign.stage++;arcade.startStage();cpu=createOpponent();beginStageIntro();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const value=clean(name.value);name.value=value;
    if(!value){afterRecord();return;}
    busy=true;submit.disabled=true;next.disabled=true;message.textContent='登録中…';
    const version=generation;
    try{
      const data=await request('/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:runId,name:value,score:arcade.total,continues:arcade.continues,startStage:campaign.selectedStage,cleared:completed})});
      if(version!==generation)return;
      try{localStorage.setItem('seal-ranking-name',value);}catch{}
      savedId=data.id;afterRecord();
    }catch(error){if(version===generation){message.textContent=error.message;busy=false;submit.disabled=false;next.disabled=false;next.hidden=false;}}
  });
  name.addEventListener('input',event=>{if(!event.isComposing)name.value=clean(name.value);});
  name.addEventListener('compositionend',()=>{name.value=clean(name.value);});
  function afterRecord(){if(returnHome){completed=false;finish();}else show(true,true);}
  next.addEventListener('click',()=>{if(screen.phase==='result')advanceResult();else if(!busy)afterRecord();});
  dialog.addEventListener('cancel',event=>event.preventDefault());
  // The attract screen can start a game; its timer is never cancelled by incidental input.
  function backToOpening(){if(screen.phase!=='ranking')return;close();completed=false;returnToOpening();canvas.focus();}
  dialog.addEventListener('pointerdown',()=>{if(screen.phase==='ranking')backToOpening();});
  for(const kind of ['keydown','keyup'])window.addEventListener(kind,event=>{
    if(!dialog.open)return;
    event.stopImmediatePropagation();
    if(kind==='keydown'&&['ranking','result'].includes(screen.phase)&&['Space','Enter','KeyZ'].includes(event.code)){event.preventDefault();if(event.repeat)return;if(screen.phase==='result')advanceResult();else backToOpening();}
  },{capture:true});
  window.addEventListener('pointerdown',()=>{if(screen.phase==='title')titleIdle=0;},{passive:true});
  window.addEventListener('resize',position);
  return {record,result,show,position,backToOpening,advanceResult,update};
})();
