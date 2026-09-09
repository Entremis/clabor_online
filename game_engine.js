(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Clabor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const clone = value => JSON.parse(JSON.stringify(value));
    const id = () => typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    function requireValue(condition, message) { if (!condition) throw new Error(message); }
    function nonnegative(value) { return Number.isSafeInteger(value) && value >= 0; }
    function validScore(value) { return nonnegative(value) || value === -100; }
    // -100 is a no-tricks penalty, not negative card points to transfer to an opponent.
    function cardPoints(value) { return value === -100 ? 0 : value; }
    function declarations(value) {
        requireValue(value && nonnegative(value.terz) && nonnegative(value.fifty) &&
            typeof value.bella === 'boolean', 'Некорректные объявления.');
        requireValue(Number.isSafeInteger(162 + value.terz * 20 + value.fifty * 50 + (value.bella ? 20 : 0)),
            'Слишком большой банк раздачи.');
        return { terz: value.terz, fifty: value.fifty, bella: value.bella };
    }
    function bank(value) {
        const d = declarations(value);
        return 162 + d.terz * 20 + d.fifty * 50 + (d.bella ? 20 : 0);
    }
    function emptyDraft(players, callerId = null) {
        return { scores: players.map(() => ''), callerId,
            declarations: { terz: 0, fifty: 0, bella: false }, lastEdited: 0 };
    }
    function createGame(names, mode, target) {
        const players = names.map(name => ({ id: id(), name: name.trim() }));
        return normalizeGame({ version: 2, id: id(), revision: 0, startedAt: new Date().toISOString(),
            mode, target, players, initialDealer: 0, rounds: [], draft: emptyDraft(players), finished: false });
    }
    function validateRound(round, game, allowLegacy = false) {
        requireValue(round && typeof round.id === 'string' && round.id.length > 0, 'Некорректная раздача.');
        requireValue(Array.isArray(round.scores) && round.scores.length === game.players.length &&
            round.scores.every(validScore) && Number.isSafeInteger(round.scores.reduce((a, b) => a + cardPoints(b), 0)),
            'Введите целые очки или −100, если нет взяток.');
        const legacy = allowLegacy && round.legacy === true;
        requireValue(game.players.some(p => p.id === round.callerId) || (legacy && round.callerId === null),
            'Укажите, кто выбирал масть.');
        requireValue(round.scores.some(score => score > 0) || legacy, 'Пустую раздачу записать нельзя.');
        if (game.mode === 'pairs' && !(legacy && round.declarations === null)) {
            requireValue(round.scores.reduce((a, b) => a + cardPoints(b), 0) === bank(round.declarations),
                'Сумма очков обеих пар должна совпадать с банком раздачи.');
        }
        return clone(round);
    }
    function normalizeGame(input) {
        requireValue(input && typeof input === 'object' && !Array.isArray(input), 'Не удалось прочитать игру.');
        const game = clone(input);
        requireValue(game.version === undefined || game.version === 2, 'Эта игра сохранена другой версией приложения.');
        requireValue(typeof game.id === 'string' && game.id.length > 0, 'У игры отсутствует идентификатор.');
        requireValue(game.mode === 'pairs' || game.mode === 'individual', 'Неизвестный режим игры.');
        requireValue(game.target === 501 || game.target === 1001, 'Неизвестная цель игры.');
        requireValue(Array.isArray(game.players) && game.players.length >= 2 &&
            game.players.length <= (game.mode === 'pairs' ? 2 : 3), 'Неверное количество игроков.');
        const legacy = game.version !== 2;
        if (legacy) {
            requireValue(game.players.every(p => typeof p === 'string'), 'Некорректные имена игроков.');
            game.players = game.players.map((name, i) => ({ id: 'p' + i, name }));
        }
        requireValue(game.players.every(p => p && typeof p.id === 'string' && p.id.length &&
            typeof p.name === 'string' && p.name.trim().length), 'Некорректные игроки.');
        requireValue(new Set(game.players.map(p => p.id)).size === game.players.length, 'Повторяются идентификаторы игроков.');
        if (game.players.some(p => p.memberIds !== undefined)) {
            const members = game.players.flatMap(p => {
                requireValue(Array.isArray(p.memberIds) && p.memberIds.length === (game.mode === 'pairs' ? 2 : 1) &&
                    p.memberIds.every(id => typeof id === 'string' && id), 'Некорректный состав профилей.');
                return p.memberIds;
            });
            requireValue(new Set(members).size === members.length, 'Один профиль не может занимать два места.');
        }
        requireValue(Array.isArray(game.rounds), 'Не удалось прочитать раздачи.');
        if (legacy) {
            game.rounds = game.rounds.map((entries, r) => {
                requireValue(Array.isArray(entries) && entries.length === game.players.length &&
                    entries.every((entry, i) => entry && entry.name === game.players[i].name),
                    'В старой игре нарушен состав раздачи. Исходные данные сохранены.');
                const callers = entries.map((e, i) => e.played === 'Да' ? i : -1).filter(i => i >= 0);
                requireValue(callers.length <= 1, 'В старой раздаче несколько игроков выбрали масть. Исходные данные сохранены.');
                return { id: 'r' + r, scores: entries.map(e => e.score),
                    callerId: callers.length ? game.players[callers[0]].id : null, declarations: null, legacy: true };
            });
            // Old screens incremented currentDealer during rendering. Reconstruct from rounds instead.
            game.initialDealer = 0;
            game.draft = emptyDraft(game.players);
            game.revision = 0;
        }
        requireValue(nonnegative(game.initialDealer) && game.initialDealer < game.players.length,
            'Некорректный раздающий.');
        game.rounds = game.rounds.map(round => validateRound(round, game, true));
        requireValue(new Set(game.rounds.map(r => r.id)).size === game.rounds.length, 'Повторяются идентификаторы раздач.');
        requireValue(nonnegative(game.revision), 'Некорректная версия сохранения.');
        const draft = game.draft;
        requireValue(draft && Array.isArray(draft.scores) && draft.scores.length === game.players.length &&
            draft.scores.every(s => typeof s === 'string') &&
            (draft.callerId === null || game.players.some(p => p.id === draft.callerId)) &&
            nonnegative(draft.lastEdited) && draft.lastEdited < game.players.length, 'Некорректный черновик раздачи.');
        draft.declarations = declarations(draft.declarations);
        if (game.editDraft !== undefined) {
            const edit = game.editDraft;
            requireValue(edit && game.rounds.some(r => r.id === edit.roundId) &&
                Array.isArray(edit.scores) && edit.scores.length === game.players.length &&
                edit.scores.every(s => typeof s === 'string') &&
                (edit.callerId === null || game.players.some(p => p.id === edit.callerId)), 'Некорректный черновик исправления.');
            if (edit.declarations !== null) edit.declarations = declarations(edit.declarations);
            ['terzText', 'fiftyText'].forEach(key => requireValue(edit[key] === undefined || typeof edit[key] === 'string',
                'Некорректные объявления в исправлении.'));
        }
        game.version = 2;
        return game;
    }
    function parseScore(value) {
        requireValue(typeof value === 'string', 'Введите очки во все поля.');
        const text = value.trim().replace(/^−/, '-');
        requireValue(/^-?\d+$/.test(text), 'Введите целые очки или −100, если нет взяток.');
        const score = Number(text);
        requireValue(Number.isSafeInteger(score), 'Слишком большое число очков.');
        requireValue(validScore(score), 'Отрицательное значение может быть только −100 — нет взяток.');
        return score;
    }
    function parseCount(value) {
        const count = parseScore(value);
        requireValue(nonnegative(count), 'Количество объявлений не может быть отрицательным.');
        return count;
    }

    function calculate(game) {
        const count = game.players.length;
        const totals = Array(count).fill(0);
        const beits = Array(count).fill(0);
        const rounds = [];
        let dealer = game.initialDealer;
        let hanging = null;
        let pots = [];
        let winner = null;
        let extraRound = false;
        const name = i => game.players[i].name + (game.players.filter(p => p.name === game.players[i].name).length > 1
            ? ' (' + (i + 1) + ')' : '');
        const leaders = (indices, scores) => {
            const maximum = Math.max(...indices.map(i => scores[i]));
            return indices.filter(i => scores[i] === maximum);
        };
        function pay(amount, candidates, sourceRound, notes) {
            if (amount === 0) return;
            if (candidates.length === 1) {
                totals[candidates[0]] += amount;
                notes.push(name(candidates[0]) + ' получает ' + amount + ' очков бейта из раздачи ' + sourceRound + '.');
            } else {
                pots.push({ amount, candidates: candidates.slice(), sourceRound });
                notes.push(amount + ' очков бейта из раздачи ' + sourceRound + ' ждут следующей раздачи между ' +
                    candidates.map(name).join(', ') + '.');
            }
        }
        game.rounds.forEach((round, index) => {
            const number = index + 1;
            const notes = [];
            const before = totals.slice();
            const scores = round.scores;
            const forced = hanging !== null;
            const caller = forced ? hanging.caller : game.players.findIndex(p => p.id === round.callerId);
            const roundDealer = dealer;
            // Only pots created in earlier rounds can be settled by this round.
            const previousPots = pots;
            pots = [];
            previousPots.forEach(pot => pay(pot.amount, leaders(pot.candidates, scores), pot.sourceRound, notes));
            const opponents = Array.from({ length: count }, (_, i) => i).filter(i => i !== caller);
            const maximum = Math.max(...opponents.map(i => scores[i]));
            let outcome = 'normal';
            if (caller >= 0 && scores[caller] === maximum) {
                outcome = 'hang';
                if (!hanging) hanging = { caller, rounds: [] };
                hanging.rounds.push({ scores: scores.slice(), number });
                dealer = caller;
                notes.push('Висяк: очки этой раздачи отложены. ' + name(caller) +
                    ' раздаёт и снова играет в выпавшую масть.');
            } else {
                const failed = caller >= 0 && scores[caller] < maximum;
                outcome = failed ? 'beit' : 'normal';
                const held = hanging ? hanging.rounds : [];
                const settled = [...held, { scores, number }];
                if (failed) {
                    beits[caller]++;
                    // No tricks and a third/later beit share a single -100 deduction.
                    const noTricks = scores[caller] === -100;
                    if (beits[caller] >= 3 || noTricks) totals[caller] -= 100;
                    settled.forEach(item => {
                        opponents.forEach(i => { totals[i] += item.scores[i]; });
                        pay(cardPoints(item.scores[caller]), leaders(opponents, item.scores), item.number, notes);
                    });
                    notes.push('Бейт №' + beits[caller] + ' у ' + name(caller) +
                        (noTricks ? ', нет взяток: штраф −100.' : beits[caller] >= 3 ? ', штраф −100.' : '.'));
                } else {
                    settled.forEach(item => item.scores.forEach((score, i) => { totals[i] += score; }));
                    if (held.length) notes.push('Висяк разрешён: каждому начислены свои очки за ' + settled.length + ' раздачи.');
                    if (caller < 0) notes.push('Старая раздача без выбравшего масть: проверьте её в редакторе.');
                }
                hanging = null;
                dealer = (roundDealer + 1) % count;
            }
            requireValue(totals.every(Number.isSafeInteger), 'Общий счёт слишком велик.');
            const top = leaders(Array.from({ length: count }, (_, i) => i), totals);
            const reached = totals[top[0]] >= game.target;
            extraRound = !hanging && !pots.length && reached && top.length > 1;
            winner = !hanging && !pots.length && reached && top.length === 1 ? game.players[top[0]].id : null;
            rounds.push({ id: round.id, dealer: roundDealer, callerId: caller >= 0 ? game.players[caller].id : null,
                forced, outcome, totals: totals.slice(), awarded: totals.map((score, i) => score - before[i]),
                beits: beits.slice(), notes });
        });
        return { totals, beits, rounds, dealer, hanging, pots, winner, extraRound,
            forcedCallerId: hanging ? game.players[hanging.caller].id : null,
            pendingPoints: pots.reduce((sum, pot) => sum + pot.amount, 0) +
                (hanging ? hanging.rounds.reduce((sum, round) => sum + round.scores.reduce((a, b) => a + b, 0), 0) : 0) };
    }
    function appendRound(game) {
        const result = calculate(game);
        requireValue(!result.winner, 'Игра уже выиграна. Завершите её или исправьте прошлую раздачу.');
        if (game.mode === 'pairs') game.draft.scores.filter(value => value.trim() !== '').forEach(value => {
            requireValue(parseScore(value) <= bank(game.draft.declarations), 'Очки пары не могут превышать банк раздачи.');
        });
        const round = { id: id(), scores: game.draft.scores.map(parseScore),
            callerId: result.forcedCallerId || game.draft.callerId,
            declarations: game.mode === 'pairs' ? clone(game.draft.declarations) : null };
        validateRound(round, game);
        const next = clone(game);
        next.rounds.push(round);
        next.draft = emptyDraft(next.players, calculate(next).forcedCallerId);
        return next;
    }
    return { clone, id, bank, cardPoints, emptyDraft, createGame, normalizeGame, validateRound, parseScore, parseCount, calculate, appendRound };
});
