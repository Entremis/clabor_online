'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const P=require('../player_library.js'), E=require('../game_engine.js');
function library(names=['А','Б','В','Г']) { let lib=P.empty(); for(const name of names) lib=P.addProfile(lib,name).library; return lib; }
function roster(lib, mode='individual', order=mode==='pairs'?[[0,1],[2,3]]:[[0],[1]]) {
    return {mode,target:501,slots:order.map(indices=>({memberIds:indices.map(i=>lib.profiles[i].id)}))};
}
function entry(lib, mode='individual', order) {
    const game=P.createGame(roster(lib,mode,order),lib.profiles);
    return {id:game.id,mode,target:501,status:'won',finishedAt:'2026-09-09T12:00:00Z',roster:P.rosterFromGame(game),
        players:game.players.map(p=>p.name),standings:game.players.map((p,i)=>({id:p.id,name:p.name,score:i? -100:510,beit:i?3:0})),winner:{id:game.players[0].id}};
}
test('duplicate names are separate profiles; a single profile cannot occupy two seats',()=>{
    const lib=library(['Саша','Саша']); assert.notEqual(lib.profiles[0].id,lib.profiles[1].id);
    assert.equal(P.profileLabel(lib.profiles[1],lib.profiles),'Саша · 2');
    assert.throws(()=>P.createGame(roster(lib,'individual',[[0],[0]]),lib.profiles),/два места/);
    assert.equal(P.createGame(roster(lib),lib.profiles).players.length,2);
});
test('rosters enforce two actual people per pair and unique lineup names',()=>{
    const lib=library(); assert.throws(()=>P.createGame(roster(lib,'pairs',[[0],[1]]),lib.profiles));
    const saved=P.saveLineup(lib,roster(lib,'pairs'),'Друзья');
    assert.throws(()=>P.saveLineup(saved,roster(lib),'друзья'),/уже есть/);
    assert.equal(P.validate(saved).lineups.length,1);
});
test('rematch retains identities and settings but resets scores, drafts, and round IDs',()=>{
    const lib=library(), old=entry(lib,'pairs'); lib.profiles[0].name='Новое имя';
    const next=P.rematch(old,lib.profiles);
    assert.notEqual(next.id,old.id); assert.equal(next.mode,'pairs'); assert.equal(next.target,501);
    assert.deepEqual(next.players.map(p=>p.memberIds),old.roster.slots.map(s=>s.memberIds));
    assert.match(next.players[0].name,/Новое имя/); assert.deepEqual(E.calculate(next).totals,[0,0]);
    assert.equal(next.rounds.length,0); assert.deepEqual(next.draft.scores,['','']);
});
test('legacy rematch preserves labels without claiming profile ownership',()=>{
    const game=P.rematch({players:['А','Б'],mode:'individual',target:1001},library().profiles);
    assert.equal(game.target,1001); assert.equal(game.players[0].memberIds,undefined);
});
test('confirmed old aliases link only approved individual and pair history',()=>{
    const lib=library(['Дима','Яна','Анжела','Алеша']);
    const legacy=(id,mode,players)=>({id,mode,target:501,players,finishedAt:'2026-09-01T12:00:00Z',
        standings:players.map((name,index)=>({id:id+'-'+index,name,score:index?300:600,beit:0})),winner:{id:id+'-0'}});
    const entries=[
        legacy('solo','individual',['Я','Анжик','Леха']),
        legacy('teams','pairs',['Мы','Они']),
        legacy('skip','pairs',['Дима Настя','Дима Яна'])
    ];
    const result=P.linkKnownLegacyHistory(entries,lib.profiles);
    assert.equal(result.linked,2);assert.equal(result.skipped,1);
    assert.deepEqual(result.entries[0].roster.slots.map(slot=>slot.memberIds[0]),[lib.profiles[0].id,lib.profiles[2].id,lib.profiles[3].id]);
    assert.deepEqual(result.entries[1].roster.slots.map(slot=>slot.memberIds),[[lib.profiles[0].id,lib.profiles[2].id],[lib.profiles[1].id,lib.profiles[3].id]]);
    assert.equal(result.entries[2].roster,undefined);assert.equal(P.statistics(result.entries,lib.profiles).games,2);
    const undone=P.unlinkKnownLegacyHistory(result.entries);
    assert.equal(undone.unlinked,2);assert.ok(undone.entries.every(game=>!game.roster));
});
test('statistics follows renamed and archived IDs, separates modes and excludes unfinished/legacy games',()=>{
    const lib=library(), solo=entry(lib), pair=entry(lib,'pairs');
    const old={...solo,id:'old',roster:undefined}, unfinished={...solo,id:'unfinished',status:'closed',winner:null};
    lib.profiles[0].name='Переименован'; lib.profiles[0].archived=true;
    const stats=P.statistics([solo,pair,old,unfinished],lib.profiles);
    assert.equal(stats.games,2); assert.equal(stats.unlinked,1); assert.equal(stats.closed,1);
    const first=stats.people.find(p=>p.id===lib.profiles[0].id);
    assert.equal(first.name,'Переименован'); assert.equal(first.wins,2); assert.equal(first.individual,1); assert.equal(first.pairs,1);
    assert.equal(stats.people.find(p=>p.id===lib.profiles[1].id).points,410);
    assert.equal(P.statistics([solo,pair],lib.profiles,{mode:'pairs'}).games,1);
    assert.equal(P.statistics([solo,pair],lib.profiles,{since:Date.parse('2026-09-10')}).games,0);
    assert.throws(()=>P.rematch(solo,lib.profiles),/архива/);
});
test('pair order does not split one team; partner changes create a separate team',()=>{
    const lib=library(); const stats=P.statistics([entry(lib,'pairs'),entry(lib,'pairs',[[1,0],[3,2]]),entry(lib,'pairs',[[0,2],[1,3]])],lib.profiles);
    assert.equal(stats.teams.length,4); assert.equal(stats.teams.filter(t=>t.games===2).length,2);
    assert.equal(stats.people.length,4); assert.ok(stats.people.every(p=>p.games===3));
});
test('malformed profile mappings are excluded safely from statistics',()=>{
    const lib=library(), game=entry(lib); game.roster={};
    assert.equal(P.statistics([game],lib.profiles).unlinked,1);
});
