'use strict';
require('fake-indexeddb/auto');
const test=require('node:test'),assert=require('node:assert/strict'),Dexie=require('dexie');
const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs');
const P=require('../player_library.js'),S=require('../sync_model.js'),E=require('../game_engine.js'),{createDatabaseStore}=require('../database.js');
function d1(){
 const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(require.resolve('../cloud-worker/migrations/0001_cloud.sql'),'utf8'));
 const prepare=sql=>({bind(...args){return {
   first:async()=>db.prepare(sql).get(...args)||null,
   all:async()=>({results:db.prepare(sql).all(...args)}),
   run:async()=>({meta:{changes:Number(db.prepare(sql).run(...args).changes)}})
 };}});
 return {prepare,batch:async statements=>{db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}},close:()=>db.close()};
}
async function server(t){const {default:worker}=await import('../cloud-worker/index.mjs');const DB=d1();t.after(()=>DB.close());const env={DB,ALLOWED_ORIGINS:'http://app.test',PASSWORD_PEPPER:'test-only-secret-'.repeat(8)};
 const call=async(path,method='GET',body,session,origin='http://app.test')=>{const r=await worker.fetch(new Request('http://api.test'+path,{method,headers:{Origin:origin,...(session?{Authorization:'Bearer '+session.token}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);return {status:r.status,data:await r.json()};};
 const register=async username=>{const r=await call('/auth/register','POST',{username,password:'test-password-2026'});assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};return {call,register,DB};
}
async function client(t,owner,legacy){const name='cloud-test-'+crypto.randomUUID();const open=()=>createDatabaseStore(Dexie,name,legacy||{getItem:()=>null});const first=await open();if(owner)await first.activateSession({userId:owner,username:owner,token:'x'});first.close();const store=await open();t.after(async()=>{store.close();await Dexie.delete(name);});return {store,open};}
const profile=(name='А')=>P.addProfile(P.empty(),name).profile;
test('independent changes merge; same-record conflicts preserve both variants and deletion',()=>{
 const a=profile(),base={['profile:'+a.id]:a};const local=structuredClone(base);local['profile:'+a.id].name='Устройство';
 const remote={...a,name:'Облако'},merged=S.merge(local,base,[{key:'profile:'+a.id,value:remote}]);
 assert.equal(merged.local['profile:'+a.id].name,'Устройство');assert.equal(merged.conflicts['profile:'+a.id].theirs.name,'Облако');
 const deleted=S.merge(base,base,[{key:'profile:'+a.id,value:null}]);assert.deepEqual(S.changes(deleted.local,deleted.base),[]);
});
test('account switch blocks stale writes and keeps pending records isolated',async t=>{
 const {store:a,open}=await client(t,'alice');const lib=await a.readLibrary();await a.saveLibrary(P.addProfile(lib.library,'А').library,lib.token);
 await a.logout();const guest=await open();await guest.activateSession({userId:'bob',username:'bob',token:'b'});guest.close();
 const b=await open();assert.equal((await b.readLibrary()).library.profiles.length,0);await assert.rejects(a.saveLibrary(lib.library,lib.token),{code:'ACCOUNT_CHANGED'});
 await b.logout();b.close();const back=await open();await back.activateSession({userId:'alice',username:'alice',token:'a'});back.close();const restored=await open();
 assert.equal((await restored.readLibrary()).library.profiles[0].name,'А');assert.equal((await restored.syncStatus()).pending,1);restored.close();
});
test('uncertain flight survives reload; acknowledgement keeps newer edits pending',async t=>{
 const {store,open}=await client(t,'alice');let lib=await store.readLibrary();lib=await store.saveLibrary(P.addProfile(lib.library,'А').library,lib.token);
 const flight=await store.prepareSync();const reloaded=await open();assert.deepEqual(await reloaded.prepareSync(),flight);
 lib.library.profiles[0].name='Новое';await reloaded.saveLibrary(lib.library,lib.token);await reloaded.ackSync(flight.requestId,1);
 assert.equal((await reloaded.syncStatus()).pending,1);assert.equal((await reloaded.prepareSync()).changes[0].value.name,'Новое');reloaded.close();
});
test('two separate devices exchange changes and explicitly resolve a conflicting rename',async t=>{
 const {store:a}=await client(t,'same'),{store:b}=await client(t,'same');let lib=await a.readLibrary();lib=await a.saveLibrary(P.addProfile(lib.library,'А').library,lib.token);
 const flight=await a.prepareSync();await a.ackSync(flight.requestId,1);await b.acceptRemote({revision:1,records:flight.changes});
 let other=await b.readLibrary();lib.library.profiles[0].name='Первый';other.library.profiles[0].name='Второй';
 await a.saveLibrary(lib.library,lib.token);await b.saveLibrary(other.library,other.token);const f=await a.prepareSync();await a.ackSync(f.requestId,2);await b.acceptRemote({revision:2,records:f.changes});
 assert.equal(Object.keys((await b.syncStatus()).conflicts).length,1);assert.equal(await b.prepareSync(),null);
 await b.resolveConflict(f.changes[0].key,'theirs');assert.equal((await b.readLibrary()).library.profiles[0].name,'Первый');assert.equal((await b.syncStatus()).pending,0);
});
test('local migration is once-only and cannot leak into another company',async t=>{
 const library=P.addProfile(P.empty(),'Старый').library,legacy={getItem:key=>key==='playerLibrary'?JSON.stringify(library):null};
 const {store:guest,open}=await client(t,null,legacy);await guest.activateSession({userId:'alice',username:'alice',token:'a'},true);const a=await open();assert.equal((await a.readLibrary()).library.profiles.length,1);assert.equal((await a.readCurrent()).game,null);
 await a.logout();a.close();const again=await open();await assert.rejects(again.activateSession({userId:'bob',username:'bob',token:'b'},true),/другую компанию/);again.close();
});
test('finishing on one device while another edits keeps the old game and new rematch available',async t=>{
 const {store:a}=await client(t,'same'),{store:b}=await client(t,'same');const g=E.createGame(['А','Б'],'individual',501);let saved=await a.save(g,null);const first=await a.prepareSync();await a.ackSync(first.requestId,1);await b.acceptRemote({revision:1,records:first.changes});
 const mine=await b.readCurrent();mine.game.draft.scores[0]='90';await b.save(mine.game,mine.token);
 const next=E.createGame(['А','Б'],'individual',501),entry={id:g.id,players:['А','Б'],rounds:[]};await a.archiveAndRematch(saved.game,saved.token,entry,next);const finish=await a.prepareSync();await a.ackSync(finish.requestId,2);await b.acceptRemote({revision:2,records:finish.changes});
 assert.equal((await b.readCurrent()).game.id,g.id);assert.ok((await b.syncStatus()).conflicts.active);assert.equal(await b.prepareSync(),null);
 await b.resolveConflict('game:'+g.id,'theirs');await b.resolveConflict('active','theirs');assert.equal((await b.readCurrent()).game.id,next.id);
});
test('legacy active game imports with stable identity and preserves the source',async t=>{
 const raw=JSON.stringify({id:'legacy-game',mode:'individual',target:501,players:['А','Б'],rounds:[]});
 const legacy={getItem:key=>key==='currentGame'?raw:null};
 const {store:guest,open}=await client(t,null,legacy);
 await guest.activateSession({userId:'alice',username:'alice',token:'a'},true);
 const account=await open();const first=await account.prepareSync();
 const game=first.changes.find(c=>c.key.startsWith('game:')).value.game;
 assert.equal(game.version,2);assert.ok(game.id);assert.equal(legacy.getItem('currentGame'),raw);
 account.close();const reloaded=await open();assert.equal((await reloaded.readCurrent()).game.id,game.id);reloaded.close();
});
test('choosing local after discarding a conflicting game preserves the deletion',async t=>{
 const {store}=await client(t,'same');const game=E.createGame(['А','Б'],'individual',501);
 let saved=await store.save(game,null);const first=await store.prepareSync();await store.ackSync(first.requestId,1);
 saved.game.draft.scores[0]='90';saved=await store.save(saved.game,saved.token);
 const other=structuredClone(game);other.draft.scores[0]='80';
 await store.acceptRemote({revision:2,records:[{key:'game:'+game.id,value:{kind:'active',game:other}}]});
 await store.discard(saved.token);await store.resolveConflict('game:'+game.id,'mine');
 assert.equal((await store.readCurrent()).game,null);
 assert.equal((await store.prepareSync()).changes.find(c=>c.key==='game:'+game.id).value,null);
});
test('server login, logout, private accounts, retries and stale versions',async t=>{
 const {call,register}=await server(t),a=await register('alice'),b=await register('bob');
 assert.equal((await call('/auth/login','POST',{username:'alice',password:'wrong-password'})).status,401);
 assert.equal((await call('/sync')).status,401);assert.equal((await call('/health','GET',undefined,undefined,'https://foreign.test')).status,403);
 const p=profile(),flight={requestId:crypto.randomUUID(),baseVersion:0,changes:[{key:'profile:'+p.id,value:p}]};
 assert.equal((await call('/sync','PUT',flight,a)).data.revision,1);assert.equal((await call('/sync','PUT',flight,a)).data.revision,1);
 assert.equal((await call('/sync','GET',undefined,b)).data.records.length,0);
 assert.equal((await call('/sync','PUT',{...flight,requestId:crypto.randomUUID()},a)).status,409);
 assert.equal((await call('/sync','PUT',{...flight,changes:[{key:'profile:'+p.id,value:{...p,name:'Other'}}]},a)).status,409);
 assert.equal((await call('/sync','GET',undefined,a)).data.records[0].value.name,p.name);
 const deletion={requestId:crypto.randomUUID(),baseVersion:1,changes:[{key:'profile:'+p.id,value:null}]};await call('/sync','PUT',deletion,a);assert.equal((await call('/sync?since=1','GET',undefined,a)).data.records[0].value,null);
 await call('/auth/logout','POST',{},a);assert.equal((await call('/sync','GET',undefined,a)).status,401);
});
test('paginated changes include equal-version rows without skipping',async t=>{
 const {call,register,DB}=await server(t),a=await register('pager');
 await DB.prepare('UPDATE users SET revision=1 WHERE id=?').bind(a.userId).run();
 for(let i=0;i<105;i++)await DB.prepare('INSERT INTO records(owner_id,key,value,revision) VALUES (?,?,?,1)').bind(a.userId,'profile:'+String(i).padStart(3,'0'),JSON.stringify({id:String(i)})).run();
 const first=(await call('/sync?since=0','GET',undefined,a)).data;assert.equal(first.records.length,100);assert.ok(first.next);
 const second=(await call('/sync?since=0&until=1&after='+first.next.after+'&key='+first.next.key,'GET',undefined,a)).data;assert.equal(second.records.length,5);assert.equal(second.next,null);
});
