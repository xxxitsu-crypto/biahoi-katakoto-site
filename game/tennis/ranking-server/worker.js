// Cloudflare Worker + D1. The database schema is applied before deployment.
const headers={
  'Access-Control-Allow-Origin':'https://xxxitsu-crypto.github.io',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':'Content-Type',
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'Vary':'Origin',
};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
export default {
  async fetch(request,env) {
    if(request.headers.get('Origin') && request.headers.get('Origin')!=='https://xxxitsu-crypto.github.io')return json({error:'origin'},403);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    const url=new URL(request.url);
    if(url.pathname!=='/scores')return json({error:'not found'},404);
    try {
      if(request.method==='GET') {
        const stage=Number(url.searchParams.get('stage')||1);
        if(![1,2,3].includes(stage))return json({error:'stage'},400);
        const {results}=await env.DB.prepare('SELECT id,name,score,continues,cleared FROM scores WHERE start_stage=? ORDER BY score DESC,continues ASC,created_at ASC,id ASC LIMIT 10').bind(stage).all();
        return json({entries:results});
      }
      if(request.method!=='POST')return json({error:'method'},405);
      if(!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'content type'},415);
      const raw=await request.text();if(raw.length>2048)return json({error:'too large'},413);
      let data;try{data=JSON.parse(raw);}catch{return json({error:'json'},400);}
      if(typeof data.name!=='string')return json({error:'name'},400);
      const name=data.name.normalize('NFC').trim();
      if(!name || Array.from(name).length>6 || /[\p{Cc}\p{Cf}]/u.test(name))return json({error:'name'},400);
      if(!/^[a-f0-9-]{36}$/i.test(data.id)||!Number.isInteger(data.score)||data.score<0||data.score>3000||data.score%5 || ![1,2,3].includes(data.startStage)||!Number.isInteger(data.continues)||data.continues<0||data.continues>9999||typeof data.cleared!=='boolean')return json({error:'invalid result'},400);
      // Idempotency protects against duplicate entries after a lost response.
      const existing=await env.DB.prepare('SELECT id FROM scores WHERE id=?').bind(data.id).first();
      if(existing)return json({id:existing.id});
      // Persist only a salted hash of the address, never the address itself.
      const address=request.headers.get('CF-Connecting-IP')||'unknown';
      if(!env.RATE_LIMIT_SALT)return json({error:'server configuration'},503);
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.RATE_LIMIT_SALT+address));
      const client=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('');
      const now=Date.now();
      // Conditional insert makes the per-address 10-second throttle atomic.
      const inserted=await env.DB.prepare('INSERT INTO scores (id,name,score,continues,start_stage,cleared,created_at,client) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM scores WHERE client=? AND created_at>?)').bind(data.id,name,data.score,data.continues,data.startStage,data.cleared?1:0,now,client,client,now-10000).run();
      if(!inserted.meta.changes)return json({error:'wait before retry'},429);
      return json({id:data.id},201);
    }catch {return json({error:'server error'},500);}
  }
};
