'use strict';
let currentGame;
let currentToken;
let gameStore;
let blocked = false;
let unsaved = false;
const $ = id => document.getElementById(id);
function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
}
function playerLabel(player, index) {
    return player.name + (currentGame.players.filter(p => p.name === player.name).length > 1 ? ' (' + (index + 1) + ')' : '');
}
function reportError(error) {
    $('gameError').textContent = error.message || String(error);
    if (error.code === 'CONFLICT' || error.code === 'ACCOUNT_CHANGED') {
        blocked = true;
        document.querySelectorAll('#gameForm input, #gameForm button, #editorForm input, #editorForm button, #editorForm select, #bankControls button, #bankControls input, [data-mutation]')
            .forEach(control => { control.disabled = true; });
        $('reloadGame').hidden = false;
    }
    $('saveStatus').textContent = 'Изменения не сохранены';
}
let saveQueue = Promise.resolve();
let saveVersion = 0;
function persist(next) {
    unsaved = true;
    const snapshot = Clabor.clone(next), version = ++saveVersion;
    const operation = saveQueue.then(async () => {
        if (blocked) return false;
        try {
            const saved = await gameStore.save(snapshot, currentToken);
            currentToken = saved.token;
            if (version === saveVersion) {
                currentGame = saved.game; unsaved = false;
                $('gameError').textContent = ''; $('saveStatus').textContent = 'Сохранено на этом устройстве';
            }
            return true;
        } catch (error) { reportError(error); return false; }
    });
    saveQueue = operation;
    return operation;
}
function saveDraft() {
    if (!currentGame || blocked) return;
    unsaved = true;
    persist(currentGame);
}
function pendingDescription(result) {
    const parts = [];
    if (result.hanging) {
        const name = playerLabel(currentGame.players[result.hanging.caller], result.hanging.caller);
        parts.push('Висяк: ' + name + ' раздаёт и автоматически играет в масть, выпавшую при раздаче. Очки будут начислены после разрешения висяка.');
    }
    result.pots.forEach(pot => parts.push(pot.amount + ' очков бейта из раздачи ' + pot.sourceRound +
        ' получит тот из игроков ' + pot.candidates.map(i => playerLabel(currentGame.players[i], i)).join(', ') +
        ', кто наберёт больше очков в следующей раздаче. При равенстве перенос продолжается.'));
    if (result.extraRound) parts.push('Равный общий счёт на финише. Сыграйте ещё одну раздачу: победит игрок с большим общим счётом.');
    return parts.join(' ');
}
function scoreInput(labelText, id, value, oninput, allowPenalty = true) {
    const group = element('div', null, 'score-field');
    const label = element('label', labelText); label.htmlFor = id;
    const input = element('input');
    input.type = 'text'; input.inputMode = 'numeric';
    input.pattern = allowPenalty ? '[-−]?[0-9]*' : '[0-9]*'; input.id = id;
    input.placeholder = 'Очки'; input.value = value; input.autocomplete = 'off';
    input.oninput = () => oninput(input.value);
    group.append(label, input);
    if (allowPenalty) {
        const noTricks = element('button', 'Нет взяток (−100)', 'no-tricks-button');
        noTricks.type = 'button'; noTricks.dataset.mutation = '';
        noTricks.setAttribute('aria-label', labelText + ': нет взяток, минус 100');
        noTricks.onclick = () => { input.value = '-100'; oninput(input.value); };
        group.append(noTricks);
    }
    return group;
}
function renderForm(result) {
    const form = $('gameForm'); form.replaceChildren();
    const draft = currentGame.draft;
    const callerId = result.forcedCallerId || draft.callerId;
    currentGame.players.forEach((player, i) => {
        const group = element('div', null, 'game-player');
        group.append(scoreInput('Очки — ' + playerLabel(player, i), 'score-' + i, draft.scores[i], value => {
            currentGame.draft.scores[i] = value; currentGame.draft.lastEdited = i;
            if (currentGame.mode === 'pairs') recomputePair();
            saveDraft();
        }));
        const choice = element('label', null, 'caller-label');
        const radio = element('input'); radio.type = 'radio'; radio.name = 'played'; radio.value = player.id;
        radio.checked = callerId === player.id; radio.disabled = Boolean(result.forcedCallerId) || Boolean(result.winner);
        radio.onchange = () => { currentGame.draft.callerId = player.id; saveDraft(); };
        choice.append(radio, document.createTextNode('Выбирал масть — ' + playerLabel(player, i)));
        group.append(choice); form.append(group);
    });
    form.querySelectorAll('input[type="text"]').forEach(input => { input.disabled = Boolean(result.winner); });
    form.querySelectorAll('.no-tricks-button').forEach(button => { button.disabled = Boolean(result.winner); });
    $('recordButton').disabled = Boolean(result.winner);
    $('bankControls').querySelectorAll('button, input').forEach(input => { input.disabled = Boolean(result.winner); });
    updateBankDisplay();
}
function recomputePair() {
    const draft = currentGame.draft;
    const source = draft.lastEdited;
    const destination = source === 0 ? 1 : 0;
    let value = '';
    try {
        const score = Clabor.cardPoints(Clabor.parseScore(draft.scores[source]));
        const bank = Clabor.bank(draft.declarations);
        if (score <= bank) {
            const remaining = bank - score;
            const destinationHasNoTricks = /^[-−]100$/.test(draft.scores[destination].trim());
            value = remaining === 0 && destinationHasNoTricks ? '-100' : String(remaining);
        }
    } catch (_) { /* Preserve invalid source input so validation can explain it. */ }
    draft.scores[destination] = value;
    $('score-' + destination).value = value;
}
function updateBankDisplay() {
    const d = currentGame.draft.declarations;
    $('bankControls').hidden = currentGame.mode !== 'pairs';
    $('terzCount').textContent = d.terz; $('fiftyCount').textContent = d.fifty;
    $('bella').checked = d.bella; $('bankTotal').textContent = Clabor.bank(d);
}
function changeDecl(type, delta) {
    if (blocked) return;
    currentGame.draft.declarations[type] = Math.max(0, currentGame.draft.declarations[type] + delta);
    updateBankDisplay(); recomputePair(); saveDraft();
}
function onDeclChange() {
    currentGame.draft.declarations.bella = $('bella').checked;
    updateBankDisplay(); recomputePair(); saveDraft();
}
function renderResults(result) {
    $('results').replaceChildren();
    currentGame.players.forEach((player, i) => {
        $('results').append(element('div', playerLabel(player, i) + ' — ' + result.totals[i] +
            ' очков · Бейты: ' + result.beits[i]));
    });
    $('dealerName').textContent = playerLabel(currentGame.players[result.dealer], result.dealer);
    $('roundNumber').textContent = currentGame.rounds.length + 1;
    const note = pendingDescription(result);
    $('pendingNotice').textContent = note; $('pendingNotice').hidden = !note;
    $('winnerBanner').replaceChildren(); $('winnerBanner').hidden = !result.winner;
    if (result.winner) {
        const i = currentGame.players.findIndex(player => player.id === result.winner);
        $('winnerBanner').append(element('div', '🏆 Победитель: ' + playerLabel(currentGame.players[i], i) + ' — ' + result.totals[i] + ' очков'));
        const finish = element('button', 'Завершить и сохранить в историю', 'finish-btn');
        finish.dataset.mutation = ''; finish.onclick = () => finishGame(); $('winnerBanner').append(finish);
        const rematch = element('button', 'Сохранить и сыграть реванш'); rematch.dataset.mutation = '';
        rematch.onclick = () => finishGame(true); $('winnerBanner').append(rematch);
    }
}
function renderTable(result) {
    const body = $('scoreTable').tBodies[0]; body.replaceChildren();
    currentGame.rounds.forEach((round, r) => {
        const computed = result.rounds[r];
        currentGame.players.forEach((player, i) => {
            const row = body.insertRow();
            [r + 1, playerLabel(player, i), round.scores[i], computed.totals[i],
                computed.beits[i], computed.callerId === player.id ? 'Да' : 'Нет'].forEach(value => {
                row.insertCell().textContent = value;
            });
            if (i === 0) {
                const cell = row.insertCell(); cell.rowSpan = currentGame.players.length;
                const edit = element('button', 'Изменить'); edit.dataset.mutation = '';
                edit.setAttribute('aria-label', 'Изменить раздачу ' + (r + 1)); edit.onclick = () => startEdit(r);
                cell.append(edit);
            }
        });
        if (computed.notes.length) {
            const cell = body.insertRow().insertCell(); cell.colSpan = 7;
            cell.className = 'round-note'; cell.textContent = computed.notes.join(' ');
        }
    });
}
function render() {
    const result = Clabor.calculate(currentGame);
    $('targetScore').textContent = currentGame.target;
    renderForm(result); renderResults(result); renderTable(result); renderEditor();
}
async function recordScores() {
    if (blocked) return;
    await saveQueue;
    try {
        if (currentGame.editDraft) throw new Error('Сначала сохраните или отмените исправление прошлой раздачи.');
        const next = Clabor.appendRound(currentGame);
        if (await persist(next)) render();
    } catch (error) { reportError(error); }
}
function openTab(name) {
    ['game', 'scores'].forEach(tabName => {
        $(tabName).hidden = tabName !== name;
        $('tab-' + tabName).setAttribute('aria-selected', String(tabName === name));
    });
}
async function startEdit(index) {
    if (blocked) return;
    if (currentGame.editDraft && currentGame.editDraft.roundId !== currentGame.rounds[index].id) {
        reportError(new Error('Сначала сохраните или отмените текущее исправление.')); return;
    }
    const round = currentGame.rounds[index];
    const computed = Clabor.calculate(currentGame).rounds[index];
    const next = Clabor.clone(currentGame);
    next.editDraft = next.editDraft || { roundId: round.id, scores: round.scores.map(String),
        callerId: computed.callerId, declarations: Clabor.clone(round.declarations) };
    if (await persist(next)) renderEditor();
}
function renderEditor() {
    const draft = currentGame.editDraft;
    $('roundEditor').hidden = !draft;
    if (!draft) return;
    const index = currentGame.rounds.findIndex(round => round.id === draft.roundId);
    const computed = Clabor.calculate(currentGame).rounds[index];
    $('editorHeading').textContent = 'Исправить раздачу ' + (index + 1);
    const form = $('editorForm'); form.replaceChildren();
    currentGame.players.forEach((player, i) => {
        form.append(scoreInput('Очки — ' + playerLabel(player, i), 'edit-score-' + i, draft.scores[i], value => {
            currentGame.editDraft.scores[i] = value; saveDraft();
        }));
    });
    const label = element('label', 'Кто выбирал масть'); label.htmlFor = 'editCaller';
    const select = element('select'); select.id = 'editCaller';
    const empty = element('option', 'Выберите игрока'); empty.value = ''; select.append(empty);
    currentGame.players.forEach((player, i) => {
        const option = element('option', playerLabel(player, i)); option.value = player.id; select.append(option);
    });
    select.value = computed.forced ? computed.callerId : draft.callerId || '';
    select.disabled = computed.forced;
    select.onchange = () => { currentGame.editDraft.callerId = select.value || null; saveDraft(); };
    form.append(label, select);
    if (computed.forced) form.append(element('p', 'После висяка играет тот же игрок. Чтобы изменить это, исправьте исходную раздачу.', 'hint'));
    if (currentGame.mode === 'pairs') {
        if (draft.declarations === null) {
            form.append(element('p', 'В старой раздаче объявления не сохранены. Проверьте сумму очков вручную.', 'hint'));
        } else {
            ['terz', 'fifty'].forEach(type => {
                form.append(scoreInput(type === 'terz' ? 'Количество терцев' : 'Количество полтинн', 'edit-' + type,
                    String(draft.declarations[type]), value => {
                        // Keep incomplete declaration edits separately until Save validates them.
                        currentGame.editDraft[type + 'Text'] = value; saveDraft();
                    }, false));
                if (draft[type + 'Text'] !== undefined) $('edit-' + type).value = draft[type + 'Text'];
            });
            const bellaLabel = element('label', null, 'caller-label');
            const bella = element('input'); bella.type = 'checkbox'; bella.checked = draft.declarations.bella;
            bella.onchange = () => { currentGame.editDraft.declarations.bella = bella.checked; saveDraft(); };
            bellaLabel.append(bella, document.createTextNode('Белла (+20)')); form.append(bellaLabel);
        }
    }
}
async function saveEditedRound() {
    if (!currentGame.editDraft || blocked) return;
    try {
        const next = Clabor.clone(currentGame), draft = next.editDraft;
        const index = next.rounds.findIndex(round => round.id === draft.roundId);
        const computed = Clabor.calculate(next).rounds[index];
        const round = next.rounds[index];
        round.scores = draft.scores.map(Clabor.parseScore);
        round.callerId = computed.forced ? computed.callerId : draft.callerId;
        if (!round.callerId) throw new Error('Укажите, кто выбирал масть.');
        if (!round.scores.some(score => score > 0)) throw new Error('Пустую раздачу записать нельзя.');
        round.declarations = Clabor.clone(draft.declarations);
        if (round.declarations) ['terz', 'fifty'].forEach(type => {
            if (draft[type + 'Text'] !== undefined) round.declarations[type] = Clabor.parseCount(draft[type + 'Text']);
        });
        Clabor.validateRound(round, next, true);
        delete next.editDraft;
        next.draft.callerId = Clabor.calculate(next).forcedCallerId || next.draft.callerId;
        if (await persist(next)) render();
    } catch (error) { reportError(error); }
}
async function cancelEdit() {
    const next = Clabor.clone(currentGame); delete next.editDraft;
    if (await persist(next)) renderEditor();
}
async function recalculateAllScores() {
    if (currentGame.editDraft) return saveEditedRound();
    return guardedAction(async () => { if (await persist(currentGame)) render(); })();
}
async function deferGame() {
    if (await persist(currentGame)) window.location.href = 'index.html';
}
async function finishGame(playAgain = false) {
    if (blocked) return;
    if (currentGame.editDraft) { reportError(new Error('Сохраните или отмените исправление прошлой раздачи.')); return; }
    const result = Clabor.calculate(currentGame);
    const hasDraft = currentGame.draft.scores.some(Boolean) || currentGame.draft.declarations.terz ||
        currentGame.draft.declarations.fifty || currentGame.draft.declarations.bella;
    const message = (hasDraft ? 'Незаписанный ввод не войдёт в результат. ' : '') +
        (playAgain ? 'Сохранить результат и начать реванш тем же составом?' : result.winner ? 'Завершить игру и сохранить в историю?' : 'Закрыть игру досрочно и сохранить в историю без победителя?');
    if (!await askConfirmation(message)) return;
    const standings = currentGame.players.map((p, i) => ({ id: p.id, name: playerLabel(p, i), score: result.totals[i], beit: result.beits[i] }));
    const entry = { id: currentGame.id, version: 2, startedAt: currentGame.startedAt, finishedAt: new Date().toISOString(),
        mode: currentGame.mode, target: currentGame.target, players: standings.map(s => s.name),
        standings, winner: standings.find(s => s.id === result.winner) || null, finished: true,
        status: result.winner ? 'won' : currentGame.rounds.length ? 'closed' : 'empty',
        pendingNote: pendingDescription(result),
        roundNotes: result.rounds.map((r, i) => {
            const d = currentGame.rounds[i].declarations;
            return (d ? 'Банк: ' + Clabor.bank(d) + '. Терцы: ' + d.terz + ', полтинны: ' + d.fifty +
                ', белла: ' + (d.bella ? 'да' : 'нет') + '. ' : '') + r.notes.join(' ');
        }),
        rounds: currentGame.rounds.map((r, index) => standings.map((p, i) => ({ name: p.name, playerId: p.id,
            score: r.scores[i], finalScore: result.rounds[index].totals[i], beit: result.rounds[index].beits[i],
            played: result.rounds[index].callerId === p.id ? 'Да' : 'Нет' }))) };
    if (currentGame.players.every(p => Array.isArray(p.memberIds))) entry.roster = ClaborPlayers.rosterFromGame(currentGame);
    try {
        await saveQueue;
        if (playAgain) {
            const {library} = await gameStore.readLibrary();
            const saved = await gameStore.archiveAndRematch(currentGame, currentToken, entry, ClaborPlayers.rematch(entry, library.profiles));
            currentGame = saved.game; currentToken = saved.token; unsaved = false; render(); openTab('game');
        } else {
            await gameStore.archive(currentGame, currentToken, entry); unsaved = false; window.location.href = 'index.html';
        }
    }
    catch (error) { reportError(error); }
}
async function resetGame() {
    if (blocked || !await askConfirmation('Сбросить игру? Она будет удалена без сохранения.')) return;
    try { await saveQueue; await gameStore.discard(currentToken); unsaved = false; window.location.href = 'index.html'; }
    catch (error) { reportError(error); }
}
// IndexedDB writes are asynchronous. Freeze editing while committing a round or
// changing screens, so a second tap or a newer draft cannot replace that commit.
let actionBusy = false;
function guardedAction(action) {
    return async (...args) => {
        if (actionBusy || blocked || !currentGame) return;
        actionBusy = true;
        const controls = [...document.querySelectorAll('#gameForm input, #gameForm button, #editorForm input, #editorForm button, #editorForm select, #bankControls input, #bankControls button, [data-mutation]')].map(node => [node,node.disabled]);
        controls.forEach(([node]) => {node.disabled=true;});
        try { return await action(...args); }
        finally {
            actionBusy=false;
            if (!blocked) {
                controls.forEach(([node,disabled])=>{if(node.isConnected) node.disabled=disabled;});
                const won = Boolean(Clabor.calculate(currentGame).winner);
                document.querySelectorAll('#bankControls input, #bankControls button, #recordButton').forEach(node=>{node.disabled=won;});
                if (won) document.querySelectorAll('#gameForm input, #gameForm button').forEach(node=>{node.disabled=true;});
            }
        }
    };
}
recordScores = guardedAction(recordScores);
startEdit = guardedAction(startEdit);
saveEditedRound = guardedAction(saveEditedRound);
cancelEdit = guardedAction(cancelEdit);
deferGame = guardedAction(deferGame);
finishGame = guardedAction(finishGame);
resetGame = guardedAction(resetGame);
$('gameForm').onsubmit = event => { event.preventDefault(); recordScores(); };
$('editorForm').onsubmit = event => { event.preventDefault(); saveEditedRound(); };
window.addEventListener('beforeunload', event => {
    if (unsaved && !blocked) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('clabor-storage', async ({detail:event}) => {
    if (event.key === 'currentGame' || event.key === null) {
        if(currentGame && !unsaved && !actionBusy && !currentGame.editDraft && !currentGame.draft.scores.some(Boolean)) {
            try {
                const saved=await gameStore.readCurrent();
                if(!saved.game){location.replace('index.html');return;}
                currentGame=saved.game;currentToken=saved.token;render();return;
            }catch(error){reportError(error);return;}
        }
        const error = new Error('Игра изменена в другой вкладке. Обновите страницу, чтобы продолжить.');
        error.code = 'CONFLICT'; reportError(error);
    }
});
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
async function initializeGame() {

try {
    gameStore = await ClaborDatabase.open();
    const saved = await gameStore.readCurrent(); currentGame = saved.game; currentToken = saved.token;
    if (!currentGame || currentGame.finished) window.location.replace('index.html');
    else {
        // Migrate with a backup before editing, never reconstruct a game from legacy side keys.
        if (JSON.parse(currentToken).version !== 2) await persist(currentGame);
        render(); openTab(currentGame.editDraft ? 'scores' : 'game');
    }
} catch (error) {
    reportError(error);
    document.querySelectorAll('[data-mutation]').forEach(control => { control.disabled = true; });
}
}
initializeGame();
