(function(root,factory){
    if(typeof module==='object' && module.exports) module.exports=factory(require('./game_engine.js'),require('./player_library.js'));
    else root.ClaborSyncModel=factory(root.Clabor,root.ClaborPlayers);
})(typeof globalThis!=='undefined'?globalThis:this,function(engine,players){
    'use strict';
    const clone=engine.clone;
    function canonical(value) {
        if(value==null) return 'null';
        if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
        if(typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
        return JSON.stringify(value);
    }
    const same=(a,b)=>canonical(a)===canonical(b);
    function records(snapshot) {
        const result={};
        for(const profile of snapshot.library.profiles) result['profile:'+profile.id]=clone(profile);
        for(const lineup of snapshot.library.lineups) result['lineup:'+lineup.id]=clone(lineup);
        for(const game of snapshot.history) {
            if(!game || !game.id) throw new Error('В истории есть запись без идентификатора. Исходные данные сохранены.');
            result['game:'+game.id]={kind:'history',game:clone(game)};
        }
        if(snapshot.current) result['game:'+snapshot.current.id]={kind:'active',game:clone(snapshot.current)};
        result.active=snapshot.current?{gameId:snapshot.current.id}:null;
        return result;
    }
    function snapshot(records) {
        const library=players.empty(),history=[];
        for(const [key,value] of Object.entries(records)) {
            if(!value) continue;
            if(key.startsWith('profile:')) library.profiles.push(clone(value));
            if(key.startsWith('lineup:')) library.lineups.push(clone(value));
            if(key.startsWith('game:') && value.kind==='history') history.push(clone(value.game));
        }
        library.profiles.sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||''))||a.id.localeCompare(b.id));
        history.sort((a,b)=>String(b.finishedAt||'').localeCompare(String(a.finishedAt||''))||String(a.id).localeCompare(String(b.id)));
        const active=records.active && records['game:'+records.active.gameId];
        return {library,history,current:active?.kind==='active'?clone(active.game):null};
    }
    function changes(local,base,conflicts={}) {
        return [...new Set([...Object.keys(local),...Object.keys(base)])].filter(key=>!conflicts[key] && !same(local[key],base[key]))
            .sort((a,b)=>Number(a==='active')-Number(b==='active')||a.localeCompare(b))
            .map(key=>({key,value:clone(local[key]??null)}));
    }
    function merge(local,base,incoming,oldConflicts={}) {
        const next=clone(local),nextBase=clone(base),conflicts=clone(oldConflicts);
        for(const {key,value} of incoming) {
            if(same(next[key],base[key]) || same(next[key],value)) { next[key]=clone(value); delete conflicts[key]; }
            else if(!same(base[key],value) || conflicts[key]) conflicts[key]={mine:clone(next[key]??null),theirs:clone(value)};
            nextBase[key]=clone(value);
        }
        if(local.active && conflicts['game:'+local.active.gameId] && !same(local.active,next.active)) {
            conflicts.active={mine:clone(local.active),theirs:clone(next.active??null)};
            next.active=clone(local.active);
        }
        return {local:next,base:nextBase,conflicts};
    }
    function validateRecord(key,value) {
        if(typeof key!=='string' || key.length>160 || !/^(active|(?:profile|lineup|game):[a-zA-Z0-9_.-]+)$/.test(key)) throw new Error('Некорректный идентификатор записи.');
        if(value===null) return;
        if(!value || typeof value!=='object' || Array.isArray(value) || JSON.stringify(value).length>250000) throw new Error('Некорректная или слишком большая запись.');
        if(key==='active') { if(typeof value.gameId!=='string' || !/^[a-zA-Z0-9_.-]{1,150}$/.test(value.gameId)) throw new Error('Некорректная активная игра.'); return; }
        if(key.startsWith('profile:')) {
            if(value.id!==key.slice(8) || typeof value.name!=='string' || !value.name.trim() || value.name.length>100 || typeof value.favorite!=='boolean' || typeof value.archived!=='boolean') throw new Error('Некорректный профиль.');
        } else if(key.startsWith('lineup:')) {
            if(value.id!==key.slice(7) || typeof value.name!=='string' || !value.name.trim() || value.name.length>100 || !['pairs','individual'].includes(value.mode) || ![501,1001].includes(value.target) || !Array.isArray(value.slots) || value.slots.length<2 || value.slots.length>(value.mode==='pairs'?2:3)) throw new Error('Некорректный состав.');
            const ids=value.slots.flatMap(s=>{if(!s || !Array.isArray(s.memberIds) || s.memberIds.length!==(value.mode==='pairs'?2:1)) throw new Error('Некорректный состав.');return s.memberIds;});
            if(ids.some(id=>typeof id!=='string'||!id) || new Set(ids).size!==ids.length) throw new Error('Некорректные участники состава.');
        } else {
            if(!['active','history'].includes(value.kind) || !value.game || String(value.game.id)!==key.slice(5)) throw new Error('Некорректная игра.');
            if(value.kind==='active') {engine.normalizeGame(value.game);engine.calculate(value.game);}
            else if(!Array.isArray(value.game.players) || value.game.players.length<2 || value.game.players.length>3 || !Array.isArray(value.game.rounds)) throw new Error('Некорректная история.');
        }
    }
    return {same,records,snapshot,changes,merge,validateRecord};
});
