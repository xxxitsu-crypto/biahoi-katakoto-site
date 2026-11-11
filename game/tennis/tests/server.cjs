const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
(async()=>{
const root=path.join(__dirname,'..','ranking-server');
const worker=(await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync(path.join(root,'worker.js'),'utf8')).toString('base64'))).default;
const sqlite=new DatabaseSync(':memory:');sqlite.exec(fs.readFileSync(path.join(root,'schema.sql'),'utf8'));
const env={RATE_LIMIT_SALT:'local-test-only',DB:{prepare(sql){const statement=sqlite.prepare(sql);let values=[];const q={bind(...args){values=args;return q},async all(){return {results:statement.all(...values)}},async first(){return statement.get(...values)||null},async run(){const r=statement.run(...values);return {meta:{changes:r.changes}}}};return q}}};
const base={id:crypto.randomUUID(),name:'アザラシ太郎',score:615,continues:0,startStage:1,cleared:true};
const post=(data,ip='test-address')=>worker.fetch(new Request('https://test/scores',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://xxxitsu-crypto.github.io','CF-Connecting-IP':ip},body:JSON.stringify(data)}),env);
assert.equal((await post(base)).status,201);
assert.equal((await post(base)).status,200); // idempotent retry
assert.equal((await post({...base,id:crypto.randomUUID()})).status,429);
assert.equal((await post({...base,id:crypto.randomUUID(),name:'1234567'},'other')).status,400);
assert.equal((await post({...base,id:crypto.randomUUID(),score:999999},'other')).status,400);
const response=await worker.fetch(new Request('https://test/scores?stage=1'),env);const body=await response.json();assert.equal(body.entries.length,1);assert.equal(body.entries[0].name,base.name);
assert.equal((await (await worker.fetch(new Request('https://test/scores?stage=2'),env)).json()).entries.length,0);
assert.equal((await worker.fetch(new Request('https://test/scores',{headers:{Origin:'https://example.com'}}),env)).status,403);
console.log('API: save, duplicate retry, throttling, name/score validation, shared reads, stage separation, origin passed');
})();
