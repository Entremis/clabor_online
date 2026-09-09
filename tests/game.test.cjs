'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../game_engine.js');
const { createStore } = require('../game_store.js');
function game(names = ['А', 'Б', 'В'], mode = 'individual', target = 501) { return E.createGame(names, mode, target); }
function add(g, scores, caller = 0, decl = { terz: 0, fifty: 0, bella: false }) {
    g.draft = { scores: scores.map(String), callerId: g.players[caller].id, declarations: decl, lastEdited: 0 };
    return E.appendRound(g);
}
function memory(initial = {}) {
    const data = new Map(Object.entries(initial));
    return { getItem: key => data.has(key) ? data.get(key) : null,
        setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
test('normal scores and independent identities for equal names', () => {
    const g = add(game(['Саша', 'Саша']), [100, 62]);
    assert.deepEqual(E.calculate(g).totals, [100, 62]);
    assert.notEqual(g.players[0].id, g.players[1].id);
});
test('failed caller transfers score once to the unique leader', () => {
    const result = E.calculate(add(game(), [40, 50, 72]));
    assert.deepEqual(result.totals, [0, 50, 112]);
    assert.deepEqual(result.beits, [1, 0, 0]);
});
test('equal defenders defer the failed caller score instead of duplicating it', () => {
    let g = add(game(), [52, 55, 55]);
    assert.deepEqual(E.calculate(g).totals, [0, 55, 55]);
    assert.equal(E.calculate(g).pendingPoints, 52);
    g = add(g, [90, 40, 32]);
    assert.deepEqual(E.calculate(g).totals, [90, 147, 87]);
    assert.equal(E.calculate(g).pendingPoints, 0);
});
test('equal defenders can tie again and the pot carries further', () => {
    let g = add(game(), [52, 55, 55]);
    g = add(g, [80, 41, 41]);
    assert.equal(E.calculate(g).pendingPoints, 52);
    g = add(g, [70, 30, 62]);
    assert.deepEqual(E.calculate(g).totals, [150, 126, 210]);
});
test('hang holds scores and forces the caller to deal and play again', () => {
    const result = E.calculate(add(game(), [60, 60, 42]));
    assert.deepEqual(result.totals, [0, 0, 0]);
    assert.equal(result.pendingPoints, 162);
    assert.equal(result.dealer, 0);
    assert.equal(result.beits[0], 0);
});
test('successful hang resolution credits both rounds to each player', () => {
    let g = add(game(), [60, 60, 42]);
    g = add(g, [80, 50, 32], 2); // Forced caller overrides a stale draft selection.
    const result = E.calculate(g);
    assert.deepEqual(result.totals, [140, 110, 74]);
    assert.equal(result.rounds[1].callerId, g.players[0].id);
    assert.equal(result.pendingPoints, 0);
    assert.equal(result.dealer, 1);
});
test('user-confirmed failed hang example: 0 / 170 / 154', () => {
    let g = add(game(), [60, 60, 42]);
    g = add(g, [40, 50, 72]);
    const result = E.calculate(g);
    assert.deepEqual(result.totals, [0, 170, 154]);
    assert.deepEqual(result.beits, [1, 0, 0]);
});
test('repeated hangs accumulate and count only one beit at resolution', () => {
    let g = add(game(), [60, 60, 42]);
    g = add(g, [70, 22, 70]);
    assert.equal(E.calculate(g).pendingPoints, 324);
    g = add(g, [40, 50, 72]);
    assert.deepEqual(E.calculate(g).totals, [0, 192, 294]);
    assert.deepEqual(E.calculate(g).beits, [1, 0, 0]);
});
test('triple hang followed by failure leaves a pot for equal old opponents', () => {
    let g = add(game(), [54, 54, 54]);
    g = add(g, [40, 50, 72]);
    assert.deepEqual(E.calculate(g).totals, [0, 104, 166]);
    assert.equal(E.calculate(g).pendingPoints, 54);
});
test('third and every later beit cost 100; success does not reset the counter', () => {
    let g = game(['А', 'Б'], 'individual', 1001);
    g = add(g, [60, 102]); g = add(g, [60, 102]);
    g = add(g, [100, 62]);
    g = add(g, [60, 102]); g = add(g, [60, 102]);
    assert.equal(E.calculate(g).beits[0], 4);
    assert.equal(E.calculate(g).totals[0], -100);
});
test('a third beit resolving a hang applies the penalty only once', () => {
    let g = game();
    g = add(g, [40, 50, 72]); g = add(g, [40, 50, 72]);
    g = add(g, [60, 60, 42]); g = add(g, [40, 50, 72]);
    assert.equal(E.calculate(g).totals[0], -100);
    assert.equal(E.calculate(g).beits[0], 3);
});
test('equal total scores at target require another round; higher total wins', () => {
    let g = game(['А', 'Б']);
    // High individual scores are allowed: this mode has no bank calculator.
    g = add(g, [300, 210], 0); g = add(g, [210, 300], 1);
    assert.deepEqual(E.calculate(g).totals, [510, 510]);
    assert.equal(E.calculate(g).winner, null); assert.equal(E.calculate(g).extraRound, true);
    g = add(g, [100, 62], 0);
    assert.equal(E.calculate(g).winner, g.players[0].id);
    assert.throws(() => add(g, [100, 62]), /уже выиграна/);
});
test('unequal simultaneous target crossing selects the larger total immediately', () => {
    let g = add(game(['А', 'Б']), [300, 230]); g = add(g, [210, 300], 1);
    assert.deepEqual(E.calculate(g).totals, [510, 530]);
    assert.equal(E.calculate(g).winner, g.players[1].id);
});
test('target 1001 and empty games have no premature winner', () => {
    let g = game(['А', 'Б'], 'individual', 1001);
    assert.equal(E.calculate(g).winner, null);
    g = add(g, [800, 100]); assert.equal(E.calculate(g).winner, null);
    g = add(g, [210, 100]); assert.equal(E.calculate(g).winner, g.players[0].id);
});
test('unsettled pot prevents premature victory', () => {
    const g = add(game(), [500, 501, 501]);
    assert.equal(E.calculate(g).winner, null);
    assert.equal(E.calculate(g).pendingPoints, 500);
});
test('pair declarations reset; blank, negative, fractional and over-bank input fails', () => {
    let g = game(['А', 'Б'], 'pairs');
    g = add(g, [100, 82], 0, { terz: 1, fifty: 0, bella: false });
    assert.equal(E.bank(g.draft.declarations), 162);
    assert.deepEqual(g.draft.scores, ['', '']);
    for (const scores of [['', ''], ['200', '-38'], ['100.5', '61.5'], ['200', '0'], ['0', '0']]) {
        g.draft.scores = scores;
        assert.throws(() => E.appendRound(g));
    }
    g.draft.scores = ['100', '62']; g.draft.callerId = null;
    assert.throws(() => E.appendRound(g), /выбирал масть/);
});
test('pair hang resolves without an extra beit or duplicated score', () => {
    let g = add(game(['А', 'Б'], 'pairs'), [81, 81]);
    g = add(g, [60, 102]);
    assert.deepEqual(E.calculate(g).totals, [0, 324]);
    assert.deepEqual(E.calculate(g).beits, [1, 0]);
});
test('an unfinished round edit survives save and reload without changing the score', () => {
    const g = add(game(), [80, 40, 42]);
    g.editDraft = {roundId:g.rounds[0].id, scores:['60','60','42'], callerId:g.players[0].id, declarations:null};
    const store = createStore(memory()); store.save(g, null);
    const restored = store.readCurrent().game;
    assert.deepEqual(restored.editDraft.scores, ['60','60','42']);
    assert.deepEqual(E.calculate(restored).totals, [80,40,42]);
});
test('failed active-game write preserves the previous saved version', () => {
    const storage = memory(), store = createStore(storage), saved = store.save(game(), null);
    storage.setItem = () => { throw new Error('quota'); };
    assert.throws(() => store.save(add(saved.game, [80,40,42]), saved.token), /сохранить/);
    assert.equal(storage.getItem('currentGame'), saved.token);
});
test('setup enforces supported player counts', () => {
    assert.throws(() => game(['А']));
    assert.throws(() => game(['А','Б','В','Г']));
    assert.throws(() => game(['А','Б','В'], 'pairs'));
});
test('minus 100 is accepted as no tricks; ordinary zero remains different', () => {
    assert.equal(E.parseScore('-100'), -100);
    assert.equal(E.parseScore(' −100 '), -100);
    assert.throws(() => E.parseScore('-50'), /только −100/);
    assert.throws(() => E.parseScore('-'), /целые/);
    assert.throws(() => E.parseScore('-100.5'), /целые/);
    assert.throws(() => E.parseCount('-100'), /объявлений/);
    assert.deepEqual(E.calculate(add(game(['А','Б']), [162, -100])).totals, [162, -100]);
    assert.deepEqual(E.calculate(add(game(['А','Б']), [162, 0])).totals, [162, 0]);
});
test('no-tricks caller gets -100 and a beit, without subtracting from opponent', () => {
    const result = E.calculate(add(game(), [-100, 100, 62]));
    assert.deepEqual(result.totals, [-100,100,62]);
    assert.deepEqual(result.beits, [1,0,0]);
    assert.equal(result.pots.length, 0);
});
test('no tricks on third and later beits costs only 100 each time', () => {
    let g = game(['А','Б'], 'individual', 1001);
    g = add(g, [60,102]); g = add(g, [60,102]);
    g = add(g, [-100,162]);
    assert.equal(E.calculate(g).totals[0], -100);
    assert.equal(E.calculate(g).beits[0], 3);
    g = add(g, [-100,162]);
    assert.equal(E.calculate(g).totals[0], -200);
    assert.equal(E.calculate(g).beits[0], 4);
});
test('pairs validate the card bank without counting the no-tricks penalty', () => {
    const g = add(game(['А','Б'], 'pairs'), [-100,162]);
    assert.deepEqual(E.calculate(g).totals, [-100,162]);
    assert.throws(() => add(game(['А','Б'], 'pairs'), [-100,262]));
});
test('no-tricks penalties in a hanging round are settled exactly once', () => {
    let g = add(game(), [81,81,-100]);
    assert.deepEqual(E.calculate(g).totals, [0,0,0]);
    g = add(g, [-100,100,62]);
    assert.deepEqual(E.calculate(g).totals, [-100,262,-38]);
    assert.equal(E.calculate(g).pendingPoints, 0);
});
test('saved minus 100 survives draft, recorded round, reload and recalculation', () => {
    const store = createStore(memory());
    let saved = store.save(game(['А','Б']), null);
    saved.game.draft.scores = ['162','-100']; saved.game.draft.callerId = saved.game.players[0].id;
    saved = store.save(saved.game, saved.token);
    assert.deepEqual(store.readCurrent().game.draft.scores, ['162','-100']);
    saved = store.save(E.appendRound(saved.game), saved.token);
    assert.deepEqual(E.calculate(store.readCurrent().game).totals, [162,-100]);
    const edited = E.clone(saved.game); edited.rounds[0].scores[1] = 0;
    assert.deepEqual(E.calculate(edited).totals, [162,0]);
});
test('editing an old round recalculates all later beits, hangs and standings', () => {
    let g = add(game(), [60, 60, 42]); g = add(g, [40, 50, 72]);
    const changed = E.clone(g); changed.rounds[0].scores = [80, 40, 42];
    assert.deepEqual(E.calculate(changed).totals, [80, 90, 154]);
    assert.deepEqual(E.calculate(g).totals, [0, 170, 154]);
});
test('recording and reloading never advance the dealer; deferred draft survives', () => {
    const store = createStore(memory());
    let saved = store.save(game(), null);
    const dealer = E.calculate(saved.game).dealer;
    saved.game.draft.scores = ['60', '60', '42']; saved.game.draft.callerId = saved.game.players[0].id;
    saved = store.save(saved.game, saved.token);
    assert.deepEqual(store.readCurrent().game.draft.scores, ['60', '60', '42']);
    assert.equal(E.calculate(store.readCurrent().game).dealer, dealer);
    saved = store.save(E.appendRound(saved.game), saved.token);
    assert.equal(E.calculate(store.readCurrent().game).dealer, 0);
    saved = store.save(store.readCurrent().game, saved.token);
    assert.equal(E.calculate(saved.game).dealer, 0);
});
test('stale tabs cannot overwrite, archive or discard another saved version', () => {
    const store = createStore(memory()); const first = store.save(game(), null);
    store.save(first.game, first.token);
    assert.throws(() => store.save(first.game, first.token), /другой вкладке/);
    assert.throws(() => store.discard(first.token), /другой вкладке/);
    assert.throws(() => store.archive(first.game, first.token, {}), /другой вкладке/);
});
test('legacy saves migrate by player position, reconstruct dealer and keep backup', () => {
    const legacy = { id: 'legacy', mode: 'individual', target: 501, players: ['Саша', 'Саша'], currentDealer: 17,
        rounds: [[{name:'Саша',score:100,played:'Да'},{name:'Саша',score:62,played:'Нет'}]], finished: false };
    const raw = JSON.stringify(legacy), storage = memory({ currentGame: raw }), store = createStore(storage);
    const saved = store.readCurrent();
    assert.deepEqual(E.calculate(saved.game).totals, [100, 62]);
    assert.equal(E.calculate(saved.game).dealer, 1);
    store.save(saved.game, saved.token);
    assert.equal(storage.getItem('claborBackupV1'), raw);
});
test('legacy side keys never resurrect a finished or discarded game', () => {
    const store = createStore(memory({ playerNames: '["А","Б"]', gameSize:'501' }));
    assert.equal(store.readCurrent().game, null);
});
test('malformed saves and history are reported without erasing data', () => {
    for (const raw of ['{', '{}', 'null', '[]']) {
        const storage = memory({currentGame:raw});
        assert.throws(() => createStore(storage).readCurrent());
        assert.equal(storage.getItem('currentGame'), raw);
    }
    const storage = memory({gameHistory:'{}'});
    assert.throws(() => createStore(storage).readHistory());
    assert.equal(storage.getItem('gameHistory'), '{}');
});
test('failed history write preserves active game; retry does not duplicate archive', () => {
    const storage = memory(), store = createStore(storage), saved = store.save(game(), null);
    const originalSet = storage.setItem;
    storage.setItem = (key, value) => { if (key === 'gameHistory') throw new Error('quota'); originalSet(key, value); };
    assert.throws(() => store.archive(saved.game, saved.token, {id:saved.game.id}), /сохранить/);
    assert.equal(storage.getItem('currentGame'), saved.token);
    storage.setItem = originalSet;
    const originalRemove = storage.removeItem;
    storage.removeItem = () => { throw new Error('denied'); };
    assert.throws(() => store.archive(saved.game, saved.token, {id:saved.game.id}));
    storage.removeItem = originalRemove;
    store.archive(saved.game, saved.token, {id:saved.game.id});
    assert.equal(store.readHistory().entries.length, 1);
    assert.equal(store.readCurrent().game, null);
});
test('HTML-like names remain plain model data and cannot become identifiers', () => {
    const g = add(game(['<img src=x onerror=alert(1)>', '__proto__']), [100, 62]);
    assert.deepEqual(E.calculate(g).totals, [100, 62]);
    assert.notEqual(g.players[1].id, '__proto__');
});
test('invariant: scored plus pending points equal raw points minus explicit penalties', () => {
    // Deterministic varied sequences include ties, repeated hangs and multiple pending pots.
    for (let seed = 1; seed <= 80; seed++) {
        const g = game(); let state = seed;
        for (let i = 0; i < 25; i++) {
            state = (state * 1664525 + 1013904223) >>> 0;
            const scores = [state % 5 * 10, (state >>> 5) % 5 * 10, (state >>> 10) % 5 * 10];
            g.rounds.push({ id: String(i), scores, callerId:g.players[state % 3].id, declarations:null });
        }
        const result = E.calculate(g);
        const raw = g.rounds.reduce((sum, r) => sum + r.scores.reduce((a,b)=>a+b,0), 0);
        const penalties = result.beits.reduce((sum,n) => sum + Math.max(0,n - 2) * 100, 0);
        assert.equal(result.totals.reduce((a,b)=>a+b,0) + result.pendingPoints, raw - penalties, 'seed ' + seed);
    }
});
