'use strict';
require('fake-indexeddb/auto');
const Dexie=require('dexie'), test=require('node:test'), assert=require('node:assert/strict');
const {createDatabaseStore}=require('../database.js'), E=require('../game_engine.js');
function storage(values={}) { const map=new Map(Object.entries(values)); return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)}; }
async function open(t, legacy=storage()) {
    const name='test-'+crypto.randomUUID(), store=await createDatabaseStore(Dexie,name,legacy);
    t.after(async()=>{store.close(); await Dexie.delete(name);}); return {store,name};
}
test('IndexedDB migration is one-time and keeps an untouched recovery copy',async t=>{
    const original=JSON.stringify(E.createGame(['А','Б'],'individual',501));
    const legacy=storage({currentGame:original,gameHistory:'[]'}), {store,name}=await open(t,legacy);
    assert.equal((await store.readCurrent()).token,original); await store.discard(original);
    const second=await createDatabaseStore(Dexie,name,legacy); t.after(()=>second.close());
    assert.equal((await second.readCurrent()).game,null); assert.equal(legacy.getItem('currentGame'),original);
    const raw=new Dexie(name); raw.version(1).stores({kv:'key'}); await raw.open();
    assert.equal(JSON.parse((await raw.kv.get('__migrationBackup')).value).currentGame,original); raw.close();
});
test('malformed imported saves remain intact and are never silently replaced',async t=>{
    const legacy=storage({currentGame:'{broken'}),{store}=await open(t,legacy);
    await assert.rejects(store.readCurrent(),/повреждены/); assert.equal(legacy.getItem('currentGame'),'{broken');
    await assert.rejects(store.save(E.createGame(['А','Б'],'individual',501),null),/другой вкладке/);
});
test('concurrent tabs use atomic compare-and-save; only one stale write wins',async t=>{
    const {store,name}=await open(t), other=await createDatabaseStore(Dexie,name,storage()); t.after(()=>other.close());
    const saved=await store.save(E.createGame(['А','Б'],'individual',501),null);
    const a=E.clone(saved.game),b=E.clone(saved.game); a.draft.scores[0]='10';b.draft.scores[0]='20';
    const results=await Promise.allSettled([store.save(a,saved.token),other.save(b,saved.token)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'CONFLICT');
    const current=await store.readCurrent(); assert.ok(['10','20'].includes(current.game.draft.scores[0]));
});
test('archive and rematch commit together, with one history entry and a fresh active game',async t=>{
    const {store}=await open(t); const saved=await store.save(E.createGame(['А','Б'],'individual',501),null);
    const next=E.createGame(['А','Б'],'individual',501), entry={id:saved.game.id};
    const result=await store.archiveAndRematch(saved.game,saved.token,entry,next);
    assert.equal((await store.readCurrent()).game.id,next.id); assert.equal((await store.readHistory()).entries.length,1);
    await assert.rejects(store.archiveAndRematch(saved.game,saved.token,entry,next),/другой вкладке/);
    assert.equal((await store.readCurrent()).token,result.token); assert.equal((await store.readHistory()).entries.length,1);
});
test('failed archiving rolls back and preserves the active game',async t=>{
    const {store}=await open(t,storage({gameHistory:'corrupted'}));
    const saved=await store.save(E.createGame(['А','Б'],'individual',501),null);
    await assert.rejects(store.archive(saved.game,saved.token,{id:saved.game.id}),/повреждены/);
    assert.equal((await store.readCurrent()).token,saved.token);
});
test('profile edits across tabs cannot silently overwrite a newer library',async t=>{
    const {store}=await open(t), first=await store.readLibrary();
    await store.saveLibrary(first.library,first.token);
    await assert.rejects(store.saveLibrary(first.library,first.token),/другой вкладке/);
});
test('a write failure midway through rematch rolls back both archive and active game',async t=>{
    let fail=false;
    class FaultyDexie extends Dexie {
        constructor(name) {
            super(name);
            this.on('ready',()=>this.table('kv').hook('updating',(_mods,key)=>{
                if(fail && key==='currentGame') throw new Error('Simulated disk failure');
            }));
        }
    }
    const name='test-'+crypto.randomUUID(), store=await createDatabaseStore(FaultyDexie,name,storage());
    t.after(async()=>{store.close();await Dexie.delete(name);});
    const saved=await store.save(E.createGame(['А','Б'],'individual',501),null);
    fail=true;
    await assert.rejects(store.archiveAndRematch(saved.game,saved.token,{id:saved.game.id},E.createGame(['А','Б'],'individual',501)),/disk failure/);
    assert.deepEqual((await store.readHistory()).entries,[]);
    assert.equal((await store.readCurrent()).token,saved.token);
});
