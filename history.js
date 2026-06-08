function loadHistory() {
    var raw = localStorage.getItem('gameHistory');
    if (!raw) { return []; }
    try { return JSON.parse(raw); } catch (e) { return []; }
}

function deleteGame(idx) {
    if (!confirm('Удалить эту игру из истории?')) { return; }
    var history = loadHistory();
    history.splice(idx, 1);
    localStorage.setItem('gameHistory', JSON.stringify(history));
    renderHistory();
}

function toggleDetails(idx) {
    var tableDiv = document.getElementById('table-' + idx);
    var btn = document.getElementById('expand-btn-' + idx);
    if (!tableDiv) { return; }
    if (tableDiv.style.display === 'none') {
        tableDiv.style.display = 'block';
        if (btn) { btn.innerText = 'Детали ▴'; }
    } else {
        tableDiv.style.display = 'none';
        if (btn) { btn.innerText = 'Детали ▾'; }
    }
}

function formatDate(isoString) {
    if (!isoString) { return '—'; }
    var d = new Date(isoString);
    return d.toLocaleDateString('ru-RU') + ' ' +
           d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatMode(mode) {
    return mode === 'pairs' ? 'Пара на пару' : 'Каждый сам за себя';
}

function buildHistoryTable(game) {
    if (!game.rounds || game.rounds.length === 0) {
        return '<p class="hint">Нет сыгранных партий.</p>';
    }

    var html = '<table><thead><tr>' +
        '<th>Партия</th><th>Игрок</th><th>Набранные очки</th>' +
        '<th>Итоговые очки</th><th>Бейт</th><th>Играл</th>' +
        '</tr></thead><tbody>';

    game.rounds.forEach(function(roundEntries, roundIdx) {
        var roundNum = roundIdx + 1;
        roundEntries.forEach(function(entry) {
            html += '<tr>' +
                '<td>' + roundNum + '</td>' +
                '<td>' + entry.name + '</td>' +
                '<td>' + entry.score + '</td>' +
                '<td>' + (entry.finalScore !== undefined ? entry.finalScore : '') + '</td>' +
                '<td>' + (entry.beit !== undefined ? entry.beit : '-') + '</td>' +
                '<td>' + (entry.played || '') + '</td>' +
                '</tr>';
        });
    });

    html += '</tbody></table>';
    return html;
}

function renderHistory() {
    var history = loadHistory();
    var container = document.getElementById('historyList');
    container.innerHTML = '';

    if (history.length === 0) {
        container.innerHTML = '<p>Завершённых игр ещё нет.</p>';
        return;
    }

    history.forEach(function(game, idx) {
        var card = document.createElement('div');
        card.className = 'history-card';

        var winnerText = game.winner
            ? game.winner.name + ' — ' + game.winner.score + ' очков'
            : '—';

        var standingsText = (game.standings || [])
            .map(function(s) { return s.name + ': ' + s.score; })
            .join(' / ');

        card.innerHTML =
            '<div class="history-header">' +
                '<div class="history-meta">' +
                    '<div class="history-players">' + game.players.join(', ') + '</div>' +
                    '<div class="history-info">' +
                        formatDate(game.finishedAt) + ' · ' +
                        formatMode(game.mode) + ' · до ' + game.target +
                    '</div>' +
                    '<div class="history-winner">🏆 ' + winnerText + '</div>' +
                    '<div class="history-scores">' + standingsText + '</div>' +
                '</div>' +
                '<div class="history-actions">' +
                    '<button id="expand-btn-' + idx + '" class="expand-btn" onclick="toggleDetails(' + idx + ')">Детали ▾</button>' +
                    '<button class="delete-btn" onclick="deleteGame(' + idx + ')">Удалить</button>' +
                '</div>' +
            '</div>' +
            '<div id="table-' + idx + '" class="history-details" style="display:none;">' +
                buildHistoryTable(game) +
            '</div>';

        container.appendChild(card);
    });
}

renderHistory();
