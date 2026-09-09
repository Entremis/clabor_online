(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./game_store.js'),require('./sync_model.js'));
    else root.ClaborDatabase = factory(root.ClaborStore,root.ClaborSyncModel);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core, syncModel) {
    'use strict';
    const keysToMigrate = ['currentGame', 'gameHistory', 'playerLibrary', 'claborBackupV1'];
    function storageError(error) {
        if (['QuotaExceededError','SecurityError','InvalidStateError','UnknownError','OpenFailedError'].includes(error.name)) {
            const message = new Error('Не удалось открыть или сохранить данные на устройстве. Проверьте свободное место и разрешение браузера на хранение данных. Не закрывайте страницу с несохранённым вводом.');
            message.cause = error; return message;
        }
        return error;
    }
    async function createDatabaseStore(DexieClass, name, legacyStorage, notify = () => {}) {
        const db = new DexieClass(name);
        db.version(1).stores({ kv: 'key' });
        db.version(2).stores({kv:'key',sync:'key'});
        await db.open();
        await db.transaction('rw', db.kv, async () => {
            if (await db.kv.get('__initialized')) return;
            const originals = {};
            for (const key of keysToMigrate) {
                const value = legacyStorage ? legacyStorage.getItem(key) : null;
                if (value !== null) { originals[key] = value; await db.kv.put({ key, value }); }
            }
            await db.kv.put({key:'__migrationBackup', value:JSON.stringify(originals)});
            await db.kv.put({key:'__initialized', value:'1'});
            // Keep the original localStorage untouched as a recovery copy. Never re-import it.
        });
        const sessionRow=await db.kv.get('__session');
        const owner=sessionRow?JSON.parse(sessionRow.value).userId:null;
        const prefix=owner?'account:'+owner+':':'';
        const scoped=key=>prefix+key;
        const initialSync=()=>({version:0,base:{},conflicts:{},retained:{},flight:null});
        async function session() {const row=await db.kv.get('__session');return row?JSON.parse(row.value):null;}
        async function assertOwner() {
            if(((await session())?.userId||null)!==owner) {
                const error=new Error('Аккаунт изменён в другой вкладке. Откройте приложение заново.');error.code='ACCOUNT_CHANGED';throw error;
            }
        }
        async function readSnapshot(scope=prefix) {
            const rows=await db.kv.bulkGet(['currentGame','gameHistory','playerLibrary'].map(k=>scope+k));
            const get=(i,fallback)=>rows[i]?JSON.parse(rows[i].value):fallback;
            return {current:get(0,null),history:get(1,[]),library:get(2,{version:1,profiles:[],lineups:[]})};
        }
        async function writeSnapshot(snapshot) {
            const before=await readSnapshot(),changed=[];
            for(const [field,key] of [['current','currentGame'],['history','gameHistory'],['library','playerLibrary']]) {
                if(syncModel.same(before[field],snapshot[field])) continue;
                if(field==='current' && !snapshot[field]) await db.kv.delete(scoped(key));
                else await db.kv.put({key:scoped(key),value:JSON.stringify(snapshot[field])});
                changed.push(key);
            }
            return changed;
        }
        async function state() {return (await db.sync.get(prefix))?.value || initialSync();}
        const saveState=value=>db.sync.put({key:prefix,value});
        const localRecords=async s=>({...s.retained,...syncModel.records(await readSnapshot())});
        function keepUnselected(s,records,snapshot) {
            s.retained=Object.fromEntries(Object.entries(records).filter(([key,value])=>key.startsWith('game:')&&value?.kind==='active'&&value.game.id!==snapshot.current?.id));
        }
        // Assign missing legacy history IDs once; never infer identity from player names.
        await db.transaction('rw',db.kv,async()=>{
            const row=await db.kv.get(scoped('gameHistory'));let history;
            try {history=row?JSON.parse(row.value):[];} catch(_) {return;}
            if(Array.isArray(history) && history.some(g=>g && !g.id)) {
                history.forEach(g=>{if(g && !g.id) g.id=crypto.randomUUID();});
                await db.kv.put({key:scoped('gameHistory'),value:JSON.stringify(history)});
            }
        });
        const api = {};
        const reads = ['readCurrent', 'readHistory', 'readLibrary'];
        const methods = [...reads, 'save', 'archive', 'archiveAndRematch', 'discard', 'deleteHistory', 'replaceHistory', 'saveLibrary'];
        for (const method of methods) api[method] = async (...args) => {
            const changed = new Set();
            const result = await db.transaction(reads.includes(method) ? 'r' : 'rw', db.kv, async () => {
                await assertOwner();
                const rows = await db.kv.toArray();
                const values = new Map(rows.map(row => [row.key, row.value]));
                const memory = {
                    getItem: key => values.has(scoped(key)) ? values.get(scoped(key)) : null,
                    setItem: (key, value) => { changed.add(key); values.set(scoped(key), value); },
                    removeItem: key => { changed.add(key); values.delete(scoped(key)); }
                };
                const value = core.createStore(memory)[method](...args);
                for (const key of changed) {
                    if (values.has(scoped(key))) await db.kv.put({key:scoped(key), value:values.get(scoped(key))});
                    else await db.kv.delete(scoped(key));
                }
                return value;
            }).catch(error => { throw storageError(error); });
            changed.forEach(key => notify(key));
            return result;
        };
        api.owner=owner;
        api.getSession=session;
        api.localSummary=async()=>{
            const local=await readSnapshot('');
            return {profiles:local.library.profiles.length,games:local.history.length,active:Boolean(local.current),importedBy:(await db.kv.get('__importedBy'))?.value||null};
        };
        api.activateSession=async (next,importLocal=false)=>{
            if(!next || typeof next.userId!=='string' || typeof next.token!=='string' || typeof next.username!=='string') throw new Error('Некорректная сессия.');
            await db.transaction('rw',db.kv,db.sync,async()=>{
                await assertOwner();
                if(importLocal) {
                    const imported=(await db.kv.get('__importedBy'))?.value;
                    if(imported && imported!==next.userId) throw new Error('Локальные данные уже перенесены в другую компанию.');
                    if(!imported) {
                        const target='account:'+next.userId+':',original=await readSnapshot('');
                        if(original.current) {
                            const token=JSON.stringify(original.current);
                            original.current=core.createStore({getItem:key=>key==='currentGame'?token:null}).readCurrent().game;
                        }
                        const source=syncModel.records(original);
                        const existing=syncModel.records(await readSnapshot(target));
                        for(const [key,value] of Object.entries(source)) {
                            if(value!==null && existing[key]!=null && !syncModel.same(value,existing[key])) throw new Error('В этом аккаунте уже есть другая версия локальной игры. Войдите без переноса.');
                            if(value!==null) existing[key]=value;
                        }
                        const merged=syncModel.snapshot(existing);
                        await db.kv.bulkPut([{key:target+'gameHistory',value:JSON.stringify(merged.history)},{key:target+'playerLibrary',value:JSON.stringify(merged.library)}]);
                        if(merged.current) await db.kv.put({key:target+'currentGame',value:JSON.stringify(merged.current)});
                        else await db.kv.delete(target+'currentGame');
                        await db.kv.put({key:'__importedBy',value:next.userId});
                    }
                }
                await db.kv.put({key:'__session',value:JSON.stringify(next)});
            });
            notify('__session');
        };
        api.logout=async()=>{
            await db.transaction('rw',db.kv,db.sync,async()=>{await assertOwner();await db.kv.delete('__session');});
            notify('__session');
        };
        api.syncStatus=()=>db.transaction('r',db.kv,db.sync,async()=>{
            await assertOwner();const s=await state(),local=await localRecords(s);
            return {pending:syncModel.changes(local,s.base).length,conflicts:s.conflicts,flight:Boolean(s.flight),version:s.version};
        });
        api.prepareSync=()=>db.transaction('rw',db.kv,db.sync,async()=>{
            await assertOwner();const s=await state();if(s.flight) return s.flight;
            const changes=syncModel.changes(await localRecords(s),s.base,s.conflicts);
            if(!changes.length) return null;
            const batch=[];let bytes=0;
            for(const change of changes){syncModel.validateRecord(change.key,change.value);const size=JSON.stringify(change).length*3;if(batch.length&&(bytes+size>900000||batch.length===20))break;batch.push(change);bytes+=size;}
            // Ordinary edits and archive/rematch fit in one batch. Import can span batches.
            s.flight={requestId:crypto.randomUUID(),baseVersion:s.version,changes:batch};
            await saveState(s);return s.flight;
        });
        api.ackSync=(id,revision)=>db.transaction('rw',db.kv,db.sync,async()=>{
            await assertOwner();const s=await state();if(s.flight?.requestId!==id) {if(revision<=s.version)return;throw new Error('Изменилась очередь синхронизации. Повторите попытку.');}
            for(const change of s.flight.changes) s.base[change.key]=change.value;
            s.version=revision;s.flight=null;await saveState(s);
        });
        api.rejectSync=id=>db.transaction('rw',db.kv,db.sync,async()=>{await assertOwner();const s=await state();if(s.flight?.requestId===id){s.flight=null;await saveState(s);}});
        api.acceptRemote=async ({revision,records})=>{
            const changed=await db.transaction('rw',db.kv,db.sync,async()=>{
                await assertOwner();const s=await state();if(s.flight) throw new Error('Сначала нужно проверить отправку предыдущих изменений.');
                if(revision<s.version) return [];
                records.forEach(r=>syncModel.validateRecord(r.key,r.value));
                const merged=syncModel.merge(await localRecords(s),s.base,records,s.conflicts),next=syncModel.snapshot(merged.local);
                s.base=merged.base;s.conflicts=merged.conflicts;s.version=revision;keepUnselected(s,merged.local,next);await saveState(s);
                return writeSnapshot(next);
            });
            changed.forEach(key=>notify(key,true));return changed;
        };
        api.resolveConflict=async (key,choice)=>{
            const changed=await db.transaction('rw',db.kv,db.sync,async()=>{
                await assertOwner();const s=await state(),conflict=s.conflicts[key];if(!conflict) return [];
                if(!['mine','theirs'].includes(choice)) throw new Error('Выберите вариант.');
                const local=await localRecords(s);
                // Preserve both alternatives before an explicit choice, including later local edits.
                await db.kv.put({key:prefix+'conflict-backup:'+crypto.randomUUID(),value:JSON.stringify({key,mine:local[key]??null,theirs:conflict.theirs,date:new Date().toISOString()})});
                local[key]=choice==='theirs'?conflict.theirs:(local[key]??null);
                if(key==='active'&&local.active&&!local['game:'+local.active.gameId])local['game:'+local.active.gameId]=s.base['game:'+local.active.gameId];
                const next=syncModel.snapshot(local);keepUnselected(s,local,next);
                delete s.conflicts[key];await saveState(s);
                return writeSnapshot(next);
            });
            changed.forEach(key=>notify(key,true));notify('sync');
        };
        api.close = () => db.close();
        return api;
    }
    let opening;
    function open() {
        if (!opening) {
            const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('clabor-data') : null;
            if (channel) channel.onmessage = event => window.dispatchEvent(new CustomEvent('clabor-storage', {detail:event.data}));
            opening = createDatabaseStore(Dexie, 'clabor', localStorage, (key,remote=false) => {
                channel?.postMessage({key});
                if(remote) window.dispatchEvent(new CustomEvent('clabor-storage',{detail:{key}}));
                window.dispatchEvent(new CustomEvent('clabor-local-change',{detail:{key}}));
            }).then(store=>{
                if(window.CLABOR_CLOUD?.apiUrl && !store.owner && !location.pathname.endsWith('/account.html')) {
                    location.replace('account.html');throw new Error('Войдите в общий аккаунт, чтобы продолжить.');
                }
                if(window.ClaborCloud && store.owner) ClaborCloud.start(store);
                return store;
            }).catch(error => { throw storageError(error); });
        }
        return opening;
    }
    return { open, createDatabaseStore };
});
