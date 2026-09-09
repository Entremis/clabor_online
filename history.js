'use strict';
let historyStore;
function historyElement(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
}
function formatDate(value) {
    const date = new Date(value);
    return !value || Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}
function buildHistoryTable(game) {
    const wrapper = historyElement('div', null, 'history-details');
    if (!Array.isArray(game.rounds) || !game.rounds.length) {
        wrapper.append(historyElement('p', 'Нет сыгранных раздач.', 'hint')); return wrapper;
    }
    const table = historyElement('table');
    const head = table.createTHead().insertRow();
    ['Раздача', 'Игрок', 'Набрано', 'Всего', 'Бейт', 'Играл'].forEach(title => {
        const th = historyElement('th', title); th.scope = 'col'; head.append(th);
    });
    const body = table.createTBody();
    game.rounds.forEach((entries, index) => {
        if (!Array.isArray(entries)) return;
        entries.forEach(entry => {
            if (!entry || typeof entry !== 'object') return;
            const row = body.insertRow();
            [index + 1, entry.name, entry.score, entry.finalScore ?? '—', entry.beit ?? '—', entry.played].forEach(value => {
                row.insertCell().textContent = value == null ? '—' : String(value);
            });
        });
        if (Array.isArray(game.roundNotes) && typeof game.roundNotes[index] === 'string' && game.roundNotes[index]) {
            const cell = body.insertRow().insertCell(); cell.colSpan = 6; cell.textContent = game.roundNotes[index];
        }
    });
    wrapper.append(table); return wrapper;
}
async function renderLegacyTools(history) {
    const panel=document.getElementById('legacyLinkPanel'),summary=document.getElementById('legacyLinkSummary');
    const {library}=await historyStore.readLibrary();
    const proposal=ClaborPlayers.linkKnownLegacyHistory(history.entries,library.profiles);
    const linked=history.entries.filter(game=>game?.legacyLinked).length;
    panel.hidden=!(proposal.linked||linked);
    if(panel.hidden) return;
    summary.textContent='По подтверждённому сопоставлению можно добавить в статистику '+proposal.linked+' старых игр. Игры с Настей и остальные нераспознанные команды останутся только в истории.';
    const link=document.getElementById('linkLegacyHistory'),unlink=document.getElementById('unlinkLegacyHistory');
    link.hidden=!proposal.linked;unlink.hidden=!linked;
    link.onclick=async()=>{
        if(!await askConfirmation('Привязать '+proposal.linked+' старых игр к профилям? Это можно отменить этой же кнопкой.')) return;
        await historyStore.replaceHistory(proposal.entries,history.token);await renderHistory();
    };
    unlink.onclick=async()=>{
        if(!await askConfirmation('Убрать привязку '+linked+' старых игр? Сами игры останутся в истории.')) return;
        const result=ClaborPlayers.unlinkKnownLegacyHistory(history.entries);
        await historyStore.replaceHistory(result.entries,history.token);await renderHistory();
    };
}
async function renderHistory() {
    const container = document.getElementById('historyList'); container.replaceChildren();
    try {
        const history = await historyStore.readHistory();
        await renderLegacyTools(history);
        if (!history.entries.length) container.append(historyElement('p', 'Завершённых игр ещё нет.'));
        history.entries.forEach((game, index) => {
            if (!game || !Array.isArray(game.players)) {
                container.append(historyElement('p', 'Запись ' + (index + 1) + ' имеет неизвестный формат. Она сохранена без изменений.', 'error-message')); return;
            }
            const card = historyElement('section', null, 'history-card');
            const header = historyElement('div', null, 'history-header');
            const meta = historyElement('div', null, 'history-meta');
            meta.append(historyElement('div', game.players.map(p => typeof p === 'string' ? p : p?.name || '—').join(', '), 'history-players'));
            meta.append(historyElement('div', formatDate(game.finishedAt) + ' · ' +
                (game.mode === 'pairs' ? 'Пара на пару' : 'Каждый сам за себя') + ' · до ' + game.target, 'history-info'));
            const winnerText = game.winner ? '🏆 ' + game.winner.name + ' — ' + game.winner.score + ' очков'
                : game.status === 'empty' ? 'Закрыта без раздач' : 'Закрыта досрочно · без победителя';
            meta.append(historyElement('div', winnerText, 'history-winner'));
            meta.append(historyElement('div', (Array.isArray(game.standings) ? game.standings : [])
                .filter(Boolean).map(s => s.name + ': ' + s.score).join(' / '), 'history-scores'));
            if (game.pendingNote) meta.append(historyElement('p', game.pendingNote, 'hint'));
            const actions = historyElement('div', null, 'history-actions');
            const rematch = historyElement('button','Реванш','secondary');
            rematch.onclick = async () => {
                rematch.disabled = true;
                try {
                    const {library} = await historyStore.readLibrary();
                    const next = ClaborPlayers.rematch(game,library.profiles);
                    const previous = await historyStore.readCurrent();
                    if (previous.game && !await askConfirmation('Начать реванш вместо текущей незаконченной игры?')) return;
                    await historyStore.save(next,previous.token); location.href = 'game_page.html';
                } catch (error) { document.getElementById('historyError').textContent = error.message; }
                finally { rematch.disabled = false; }
            };
            const details = buildHistoryTable(game); details.hidden = true; details.id = 'history-details-' + index;
            const expand = historyElement('button', 'Детали ▾', 'expand-btn');
            expand.setAttribute('aria-controls', details.id); expand.setAttribute('aria-expanded', 'false');
            expand.onclick = () => {
                details.hidden = !details.hidden; expand.textContent = details.hidden ? 'Детали ▾' : 'Детали ▴';
                expand.setAttribute('aria-expanded', String(!details.hidden));
            };
            const remove = historyElement('button', 'Удалить', 'delete-btn');
            remove.onclick = async () => {
                if (!await askConfirmation('Удалить эту игру из истории?')) return;
                try { await historyStore.deleteHistory(index, history.token); await renderHistory(); }
                catch (error) { document.getElementById('historyError').textContent = error.message; }
            };
            if (!game.roster) meta.append(historyElement('p','Старая игра без профилей: сохранена в истории, но не входит в личную статистику.','hint'));
            actions.append(rematch, expand, remove); header.append(meta, actions); card.append(header, details); container.append(card);
        });
        document.getElementById('historyError').textContent = '';
    } catch (error) { document.getElementById('historyError').textContent = error.message; }
}
async function loadHistory() {
    try { historyStore = await ClaborDatabase.open(); await renderHistory(); }
    catch (error) { document.getElementById('historyError').textContent = 'Сохранения недоступны: ' + error.message; }
}
window.addEventListener('clabor-storage', ({detail:event}) => { if (event.key === 'gameHistory' || event.key === null) renderHistory(); });
loadHistory();
