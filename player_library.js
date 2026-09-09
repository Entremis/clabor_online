(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./game_engine.js'));
    else root.ClaborPlayers = factory(root.Clabor);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
    'use strict';
    const empty = () => ({ version: 1, profiles: [], lineups: [] });
    function validate(library) {
        if (!library || library.version !== 1 || !Array.isArray(library.profiles) || !Array.isArray(library.lineups))
            throw new Error('Не удалось прочитать профили игроков. Исходные данные сохранены.');
        if (library.profiles.some(p => !p || typeof p.id !== 'string' || !p.id || typeof p.name !== 'string' ||
            !p.name.trim() || typeof p.favorite !== 'boolean' || typeof p.archived !== 'boolean') ||
            new Set(library.profiles.map(p => p.id)).size !== library.profiles.length) throw new Error('Некорректные профили игроков.');
        if (library.lineups.some(l => !l || typeof l.id !== 'string' || !l.id || typeof l.name !== 'string' || !l.name.trim()) ||
            new Set(library.lineups.map(l => l.id)).size !== library.lineups.length)
            throw new Error('Некорректные сохранённые составы.');
        library.lineups.forEach(l => validateRoster(l, library.profiles, true));
        return engine.clone(library);
    }
    function addProfile(library, name) {
        name = name.trim();
        if (!name || name.length > 100) throw new Error('Имя игрока должно содержать от 1 до 100 символов.');
        const next = validate(library);
        const time = new Date().toISOString();
        const profile = { id: engine.id(), name, favorite: true, archived: false, createdAt: time, updatedAt: time };
        next.profiles.push(profile);
        return { library: next, profile };
    }
    function validateRoster(roster, profiles, allowArchived = false) {
        if (!roster || !['individual', 'pairs'].includes(roster.mode) || ![501,1001].includes(roster.target) ||
            !Array.isArray(roster.slots) || roster.slots.length < 2 || roster.slots.length > (roster.mode === 'pairs' ? 2 : 3))
            throw new Error('Выберите двух или трёх игроков; для пар — две команды по два человека.');
        const members = roster.slots.flatMap(slot => {
            if (!slot || !Array.isArray(slot.memberIds) || slot.memberIds.length !== (roster.mode === 'pairs' ? 2 : 1))
                throw new Error('Выберите всех участников состава.');
            return slot.memberIds;
        });
        if (new Set(members).size !== members.length) throw new Error('Один игрок не может занимать два места в одной игре.');
        if (members.some(id => !profiles.some(p => p.id === id && (allowArchived || !p.archived))))
            throw new Error('В составе есть недоступный профиль. Выберите другого игрока или верните профиль из архива.');
        return engine.clone(roster);
    }
    function profileLabel(profile, profiles) {
        const duplicates = profiles.filter(p => p.name === profile.name);
        return profile.name + (duplicates.length > 1 ? ' · ' + (duplicates.findIndex(p => p.id === profile.id) + 1) : '');
    }
    function createGame(roster, profiles) {
        validateRoster(roster, profiles);
        const names = roster.slots.map(slot => slot.memberIds.map(id => profiles.find(p => p.id === id).name).join(' и '));
        const game = engine.createGame(names, roster.mode, roster.target);
        game.players.forEach((player, i) => {
            player.memberIds = roster.slots[i].memberIds.slice();
            player.members = player.memberIds.map(id => ({ id, name: profiles.find(p => p.id === id).name }));
        });
        return game;
    }
    function rosterFromGame(game) {
        return { mode: game.mode, target: game.target,
            slots: game.players.map(p => ({ memberIds: Array.isArray(p.memberIds) ? p.memberIds.slice() : [] })) };
    }
    function rematch(entry, profiles) {
        if (entry.roster) return createGame(entry.roster, profiles);
        // Old history did not store profile IDs. A rematch keeps its original labels, without guessing identities.
        return engine.createGame(entry.players.map(p => typeof p === 'string' ? p : p.name), entry.mode, entry.target);
    }
    function saveLineup(library, roster, name) {
        validateRoster(roster, library.profiles);
        name = name.trim();
        if (!name || name.length > 100) throw new Error('Введите название состава (до 100 символов).');
        const next = validate(library);
        const previous = next.lineups.find(l => l.name.toLocaleLowerCase('ru') === name.toLocaleLowerCase('ru'));
        if (previous) throw new Error('Состав с таким названием уже есть. Выберите другое название.');
        next.lineups.push({ ...engine.clone(roster), id: engine.id(), name, updatedAt: new Date().toISOString() });
        return next;
    }
    function legacyLabel(value) {
        return String(value || '').trim().toLocaleLowerCase('ru').replace(/\s+/g, ' ');
    }
    function legacyRoster(entry, profiles) {
        const byName = new Map(profiles.map(profile => [legacyLabel(profile.name), profile.id]));
        const profile = name => byName.get(legacyLabel(name));
        const aliases = {
            'дима':['я','д','дима','dima','димик','димкинс','dimonchik','димо','da'],
            'яна':['яна','yana','ya'],
            'анжела':['анжела','энжи','анжи','анжик','анжелка','анжеликс','энжикс','эенжи','анжело','mc angy','а'],
            'алеша':['алеша','алёша','леха','леша','лехо','l']
        };
        const individual = Object.entries(aliases).reduce((all,[name,values]) => {
            values.forEach(value => all.set(legacyLabel(value),profile(name))); return all;
        },new Map());
        const teams = {
            'мы':['дима','анжела'], 'они':['яна','алеша'],
            'ля':['алеша','яна'], 'ад':['анжела','дима']
        };
        const labels = Array.isArray(entry.players) ? entry.players.map(player => typeof player === 'string' ? player : player?.name) : [];
        let slots;
        if (entry.mode === 'individual') slots = labels.map(label => [individual.get(legacyLabel(label))]);
        else if (entry.mode === 'pairs') slots = labels.map(label => (teams[legacyLabel(label)] || []).map(profile));
        else return null;
        const expected = entry.mode === 'pairs' ? 2 : 1;
        const members = slots.flat();
        if (slots.length !== labels.length || slots.some(slot => slot.length !== expected || slot.some(id => !id)) ||
            new Set(members).size !== members.length) return null;
        return {mode:entry.mode,target:entry.target,slots:slots.map(memberIds => ({memberIds}))};
    }
    function linkKnownLegacyHistory(entries, profiles) {
        const next=engine.clone(entries); let linked=0,skipped=0;
        next.forEach(entry => {
            if (!entry || entry.roster || !entry.winner || entry.status === 'empty' || entry.status === 'closed') return;
            const roster=legacyRoster(entry,profiles);
            if (!roster) { skipped++; return; }
            entry.roster=roster;entry.legacyLinked=true;linked++;
        });
        return {entries:next,linked,skipped};
    }
    function unlinkKnownLegacyHistory(entries) {
        const next=engine.clone(entries);let unlinked=0;
        next.forEach(entry => {if(entry?.legacyLinked){delete entry.roster;delete entry.legacyLinked;unlinked++;}});
        return {entries:next,unlinked};
    }
    function statistics(entries, profiles, options = {}) {
        const mode = options.mode || 'all';
        const since = options.since || 0;
        const people = new Map(), teams = new Map();
        let eligible = 0, unlinked = 0, closed = 0;
        const selected = entries.filter(g => g && (mode === 'all' || g.mode === mode) &&
            (!since || Date.parse(g.finishedAt) >= since)).sort((a,b) => (a.finishedAt || '').localeCompare(b.finishedAt || '') || String(a.id).localeCompare(String(b.id)));
        const make = (id, name) => ({id, name, games:0, wins:0, points:0, beits:0, individual:0, pairs:0, series:[]});
        function add(record, game, standing, won) {
            record.games++; record.wins += Number(won); record.points += standing.score;
            record.beits += Number.isFinite(standing.beit) ? standing.beit : 0;
            record[game.mode === 'pairs' ? 'pairs' : 'individual']++;
            record.series.push({ gameId:game.id, date:game.finishedAt, score:standing.score, won, mode:game.mode });
        }
        selected.forEach(g => {
            if (!g.winner || g.status === 'empty' || g.status === 'closed') { closed++; return; }
            if (!g.roster || !Array.isArray(g.roster.slots) || !Array.isArray(g.standings) || g.roster.slots.length !== g.standings.length ||
                !g.roster.slots.every(s => s && Array.isArray(s.memberIds) && s.memberIds.length === (g.mode === 'pairs' ? 2 : 1)) ||
                !g.standings.every(s => s && Number.isFinite(s.score))) { unlinked++; return; }
            const allMembers = g.roster.slots.flatMap(s => s.memberIds || []);
            if (allMembers.length !== (g.mode === 'pairs' ? 4 : g.standings.length) ||
                new Set(allMembers).size !== allMembers.length || allMembers.some(id => !profiles.some(p => p.id === id))) { unlinked++; return; }
            eligible++;
            g.standings.forEach((standing, i) => {
                const members = g.roster.slots[i].memberIds;
                const won = g.winner.id ? g.winner.id === standing.id : g.winner.name === standing.name;
                members.forEach(id => {
                    const profile = profiles.find(p => p.id === id);
                    if (!people.has(id)) people.set(id, make(id, profileLabel(profile, profiles)));
                    add(people.get(id), g, standing, won);
                });
                if (g.mode === 'pairs') {
                    const ids = members.slice().sort(), key = JSON.stringify(ids);
                    if (!teams.has(key)) teams.set(key, make(key, ids.map(id => profileLabel(profiles.find(p => p.id === id), profiles)).join(' и ')));
                    add(teams.get(key), g, standing, won);
                }
            });
        });
        const finish = map => [...map.values()].map(p => ({...p, winRate: Math.round(p.wins / p.games * 100), average: Math.round(p.points / p.games)}))
            .sort((a,b) => b.wins - a.wins || b.winRate - a.winRate || a.name.localeCompare(b.name, 'ru'));
        return { people: finish(people), teams: finish(teams), games:eligible, unlinked, closed };
    }
    return { empty, validate, addProfile, validateRoster, createGame, rosterFromGame, rematch, saveLineup, profileLabel, legacyRoster, linkKnownLegacyHistory, unlinkKnownLegacyHistory, statistics };
});
