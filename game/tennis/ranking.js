// Native form controls keep Japanese IME and mobile keyboards available.
const rankingUI = (() => {
  const dialog=document.getElementById('ranking-dialog');
  const openButton=document.getElementById('ranking-open');
  const heading=document.getElementById('ranking-heading');
  const scoreText=document.getElementById('ranking-score');
  const form=document.getElementById('ranking-form');
  const name=document.getElementById('ranking-name');
  const submit=document.getElementById('ranking-submit');
  const message=document.getElementById('ranking-message');
  const table=document.getElementById('ranking-table');
  const next=document.getElementById('ranking-next');
  let timer, generation=0, completed=false, result=false, savedId=null, runId=null, busy=false;
  const clean=value=>Array.from(value.normalize('NFC').replace(/[\p{Cc}\p{Cf}]/gu,'').trim()).slice(0,6).join('');
  const api=()=>window.SEAL_RANKING_API?.replace(/\/$/,'');
  async function request(path,options={}) {
    if(!api())throw new Error('共有ランキングの接続設定が必要です。');
    const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),10000);
    try{
      const response=await fetch(api()+path,{...options,signal:controller.signal});
      if(!response.ok)throw new Error('通信できませんでした。再度お試しください。');
      return await response.json();
    }catch(error){if(error.name==='AbortError')throw new Error('通信がタイムアウトしました。');throw error;}
    finally{clearTimeout(timeout);}
  }
  function prepare(phase) {
    clearTimeout(timer);generation++;input.cancel();screen.phase=phase;
    document.getElementById('game-container').dataset.screen=phase;
    heading.textContent=phase==='record'?'NAME ENTRY':'RANKING';
    table.replaceChildren();message.textContent='';scoreText.textContent='';form.hidden=true;
    next.disabled=false;busy=false;
    if(!dialog.open)dialog.showModal();
  }
  function leave() {
    clearTimeout(timer);generation++;dialog.close();input.cancel();
    if(result&&completed)beginEnding();else returnToOpening();
    canvas.focus();
  }
  async function load() {
    const version=generation;
    message.textContent='読み込み中…';
    try {
      const data=await request('/scores?stage='+campaign.selectedStage);
      if(version!==generation)return;
      message.textContent=data.entries.length?'':'まだ記録がありません。';
      const t=document.createElement('table');
      const caption=document.createElement('caption');caption.textContent='ST'+campaign.selectedStage+' START · TOP 10';t.append(caption);
      const header=t.createTHead().insertRow();
      for(const text of ['順位','名前','スコア']){const th=document.createElement('th');th.scope='col';th.textContent=text;header.append(th);}
      const body=t.createTBody();
      data.entries.forEach((entry,index)=>{
        const row=body.insertRow();if(entry.id===savedId)row.className='my-record';
        for(const value of [index+1,entry.name,entry.score])row.insertCell().textContent=String(value);
      });table.replaceChildren(t);
      if(savedId&&!data.entries.some(e=>e.id===savedId))message.textContent='登録しました。今回は上位10位圏外です。';
    }catch(error){if(version===generation)message.textContent=error.message;}
  }
  function show(auto=false,fromResult=false) {
    if(!fromResult){result=false;savedId=null;}
    prepare('ranking');next.textContent=result&&completed?'エンディングへ':'OPENへ';
    load();
    if(auto)timer=setTimeout(leave,8000);
  }
  function record(clear) {
    completed=clear;result=true;savedId=null;runId=crypto.randomUUID();
    prepare('record');scoreText.textContent='SCORE '+String(arcade.total).padStart(6,'0');
    form.hidden=false;submit.disabled=false;
    next.textContent=clear?'登録せずエンディングへ':'登録せずOPENへ';
    try{name.value=localStorage.getItem('seal-ranking-name')||'';}catch{}
    message.textContent=api()?'名前を入力してください。':'共有ランキングの接続設定が必要です。';
    // Do not automatically summon a mobile keyboard before the player taps.
    next.focus();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    const value=clean(name.value);name.value=value;
    if(!value){message.textContent='名前を1〜6文字で入力してください。';name.focus();return;}
    busy=true;submit.disabled=true;next.disabled=true;message.textContent='登録中…';
    const version=generation;
    try{
      const data=await request('/scores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:runId,name:value,score:arcade.total,continues:arcade.continues,startStage:campaign.selectedStage,cleared:completed})});
      if(version!==generation)return;
      try{localStorage.setItem('seal-ranking-name',value);}catch{}
      savedId=data.id;show(false,true);
    }catch(error){if(version===generation){message.textContent=error.message;busy=false;submit.disabled=false;next.disabled=false;}}
  });
  name.addEventListener('input',event=>{if(!event.isComposing)name.value=clean(name.value);});
  name.addEventListener('compositionend',()=>{name.value=clean(name.value);});
  next.addEventListener('click',leave);
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy)leave();});
  for(const event of ['pointerdown','keydown','input'])dialog.addEventListener(event,()=>clearTimeout(timer));
  openButton.addEventListener('click',()=>show());
  // Stop gameplay shortcuts without preventing normal typing or IME defaults.
  for(const kind of ['keydown','keyup'])window.addEventListener(kind,event=>{
    if(dialog.open)event.stopImmediatePropagation();
  },{capture:true});
  window.addEventListener('pointerdown',()=>{if(screen.phase==='title')titleIdle=0;},{passive:true});
  return {record,show,positionButton(visible,selected){
    openButton.hidden=!visible;if(!visible)return;
    const bounds=canvas.getBoundingClientRect();
    Object.assign(openButton.style,{left:(bounds.left+bounds.width*.25)+'px',top:(bounds.top+bounds.height*.39)+'px',width:(bounds.width*.5)+'px',height:Math.max(36,bounds.height*.07)+'px'});
    openButton.classList.toggle('selected',selected);
  }};
})();
