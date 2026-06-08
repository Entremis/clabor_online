window.onload = function() {
    var playerNames = JSON.parse(localStorage.getItem('playerNames'));
    var mode = getMode();
    var gameForm = document.getElementById('gameForm');

    playerNames.forEach(function(name, index) {
        var div = document.createElement('div');
        var scoreAttrs = 'type="number" inputmode="numeric" name="score' + index + '" placeholder="Очки"';
        if (mode === 'pairs') {
            scoreAttrs += ' oninput="onPairScoreInput(\'score' + index + '\')"';
        }
        div.innerHTML = '<label>' + name + '</label>' +
                        '<input type="radio" name="played" value="' + index + '"> Выбирал масть' +
                        '<input ' + scoreAttrs + '>';
        gameForm.appendChild(div);
    });

    document.getElementById('targetScore').innerText = String(getTarget());

    // Банк раздачи нужен только в режиме «пара на пару».
    if (mode === 'pairs') {
        document.getElementById('bankControls').style.display = 'block';
        updateBankDisplay();
    }

    updateDealer();
    updateResults();
};

// Режим игры: 'individual' или 'pairs' (по умолчанию individual).
function getMode() {
    return localStorage.getItem('gameMode') || 'individual';
}

// Целевой счёт игры (501 / 1001, по умолчанию 501)
function getTarget() {
    return parseInt(localStorage.getItem('gameSize'), 10) || 501;
}

function recordScores() {
    var playerNames = JSON.parse(localStorage.getItem('playerNames'));
    var scoreTable = document.getElementById('scoreTable').getElementsByTagName('tbody')[0];
    var currentRound = Math.floor(scoreTable.rows.length / playerNames.length) + 1;
    var scores = [];

    playerNames.forEach(function(name, index) {
        var score = parseInt(document.querySelector('input[name="score' + index + '"]').value, 10) || 0;
        var played = document.querySelector('input[name="played"]:checked') ? (document.querySelector('input[name="played"]:checked').value == index ? 'Да' : 'Нет') : 'Нет';
        scores.push({ name: name, score: score, played: played });
    });

    scores.forEach(function(player, index) {
        var newRow = scoreTable.insertRow();

        var newCell = newRow.insertCell();
        newCell.innerText = currentRound;

        newCell = newRow.insertCell();
        newCell.innerText = player.name;

        newCell = newRow.insertCell();
        newCell.innerHTML = `<input type="number" value="${player.score}" class="editable" data-player="${player.name}" data-round="${currentRound}" onchange="handleInputChange(this)">`;

        newCell = newRow.insertCell(); // Итоговые очки
        newCell.innerText = '';

        newCell = newRow.insertCell();
        newCell.className = "beit";
        newCell.innerText = calculateBeit(scoreTable, player, scores, currentRound);

        newCell = newRow.insertCell();
        newCell.innerHTML = `<select class="editable" data-player="${player.name}" data-round="${currentRound}">
                                <option value="Да" ${player.played === 'Да' ? 'selected' : ''}>Да</option>
                                <option value="Нет" ${player.played === 'Нет' ? 'selected' : ''}>Нет</option>
                             </select>`;

        newCell = newRow.insertCell();
        newCell.innerHTML = `<button onclick="saveChanges(this)">Сохранить</button>`;
    });

    updateDealer();
    recalculateAllScores();
    updateResults();
    resetForm();
}

function resetForm() {
    var gameForm = document.getElementById('gameForm');
    gameForm.reset();
}

function calculateFinalScore(scoreTable, player, scores, currentRound) {
    var previousRoundScores = getPreviousRoundScores(scoreTable, player.name, currentRound);
    var previousScore = previousRoundScores.previousScore || 0;
    var currentScore = player.score;
    var beit = player.beit;

    if (beit > 0) {
        if (beit < 3) {
            return previousScore;
        } else {
            return previousScore - 100;
        }
    } else {
        var highestScore = Math.max(...scores.map(s => s.score));
        if (player.played === 'Нет') {
            if (player.score === highestScore) {
                var scoreWithBeit = scores.find(s => s.beit > 0)?.score || 0;
                return previousScore + currentScore + scoreWithBeit;
            } else {
                return previousScore + currentScore;
            }
        } else {
            return previousScore + currentScore;
        }
    }
}

function getPreviousRoundScores(scoreTable, playerName, currentRound) {
    for (var i = scoreTable.rows.length - 1; i >= 0; i--) {
        var row = scoreTable.rows[i];
        if (row.cells[1].innerText === playerName && parseInt(row.cells[0].innerText, 10) < currentRound) {
            return {
                previousScore: parseInt(row.cells[3].innerText, 10) || 0,
                previousBeit: row.cells[4].innerText
            };
        }
    }
    return {};
}

function saveChanges(button) {
    var row = button.parentElement.parentElement;
    var round = parseInt(row.cells[0].innerText, 10);
    var playerName = row.cells[1].innerText;
    var newScore = parseInt(row.cells[2].querySelector('input').value, 10);
    var newPlayed = row.cells[5].querySelector('select').value;

    updateRow(round, playerName, newScore, newPlayed);
    recalculateBeitFromRound(round);
    recalculateAllScores();
    updateResults();
}

function handleInputChange(input) {
    var row = input.parentElement.parentElement;
    var round = parseInt(row.cells[0].innerText, 10);
    recalculateBeitFromRound(round);
    recalculateAllScores();
    updateResults();
}

function updateRow(round, playerName, newScore, newPlayed) {
    var scoreTable = document.getElementById('scoreTable').getElementsByTagName('tbody')[0];
    for (var i = 0; i < scoreTable.rows.length; i++) {
        var row = scoreTable.rows[i];
        if (parseInt(row.cells[0].innerText, 10) === round && row.cells[1].innerText === playerName) {
            row.cells[2].querySelector('input').value = newScore;
            row.cells[5].querySelector('select').value = newPlayed;
            break;
        }
    }
}

function recalculateBeitFromRound(fromRound) {
    var scoreTable = document.getElementById('scoreTable').getElementsByTagName('tbody')[0];
    var playerNames = JSON.parse(localStorage.getItem('playerNames'));

    for (var i = fromRound - 1; i < scoreTable.rows.length; i++) {
        var row = scoreTable.rows[i];
        var round = parseInt(row.cells[0].innerText, 10);
        var playerName = row.cells[1].innerText;
        var score = parseInt(row.cells[2].querySelector('input').value, 10);
        var played = row.cells[5].querySelector('select').value;

        var scores = playerNames.map(name => {
            var playerRow = Array.from(scoreTable.rows).find(r => r.cells[0].innerText == round && r.cells[1].innerText == name);
            var playerScore = parseInt(playerRow.cells[2].querySelector('input').value, 10);
            return { name: name, score: playerScore, beit: playerRow.cells[4].innerText === '-' ? 0 : parseInt(playerRow.cells[4].innerText, 10) };
        });

        row.cells[4].innerText = calculateBeit(scoreTable, { name: playerName, score: score, played: played }, scores, round);
    }
}

function recalculateAllScores() {
    var scoreTable = document.getElementById('scoreTable').getElementsByTagName('tbody')[0];
    var playerNames = JSON.parse(localStorage.getItem('playerNames'));

    for (var i = 0; i < scoreTable.rows.length; i++) {
        var row = scoreTable.rows[i];
        var round = parseInt(row.cells[0].innerText, 10);
        var playerName = row.cells[1].innerText;
        var score = parseInt(row.cells[2].querySelector('input').value, 10);
        var played = row.cells[5].querySelector('select').value;
        var beit = row.cells[4].innerText === '-' ? 0 : parseInt(row.cells[4].innerText, 10);

        var scores = playerNames.map(name => {
            var playerRow = Array.from(scoreTable.rows).find(r => r.cells[0].innerText == round && r.cells[1].innerText == name);
            var playerScore = parseInt(playerRow.cells[2].querySelector('input').value, 10);
            return { name: name, score: playerScore, beit: playerRow.cells[4].innerText === '-' ? 0 : parseInt(playerRow.cells[4].innerText, 10) };
        });

        row.cells[3].innerText = calculateFinalScore(scoreTable, { name: playerName, score: score, played: played, beit: beit }, scores, round);
    }
}

function calculateBeit(scoreTable, player, scores, currentRound) {
    if (player.played === 'Да' && player.score < Math.max(...scores.map(s => s.score))) {
        var lastBeitValue = 0;
        for (var i = 0; i < scoreTable.rows.length; i++) {
            var row = scoreTable.rows[i];
            if (row.cells[1].innerText === player.name && parseInt(row.cells[0].innerText, 10) < currentRound) {
                var beitValue = row.cells[4].innerText;
                if (beitValue !== '-') {
                    lastBeitValue = parseInt(beitValue, 10);
                }
            }
        }
        return lastBeitValue + 1;
    }
    return '-';
}

function updateDealer() {
    var playerNames = JSON.parse(localStorage.getItem('playerNames'));
    var currentDealer = (parseInt(localStorage.getItem('currentDealer')) || 0) % playerNames.length;
    document.getElementById('dealerName').innerText = playerNames[currentDealer];
    localStorage.setItem('currentDealer', currentDealer + 1);
}

function openTab(tabName) {
    var i;
    var x = document.getElementsByClassName("tab-content");
    for (i = 0; i < x.length; i++) {
        x[i].style.display = "none";
    }
    document.getElementById(tabName).style.display = "block";
}

function updateResults() {
    var scoreTable = document.getElementById('scoreTable').getElementsByTagName('tbody')[0];
    var playerNames = JSON.parse(localStorage.getItem('playerNames'));
    var resultsDiv = document.getElementById('results');
    resultsDiv.innerHTML = '';

    var target = getTarget();
    var standings = [];

    playerNames.forEach(function(name, index) {
        var lastScore = 0;
        var maxBeit = 0;

        for (var i = 0; i < scoreTable.rows.length; i++) {
            var row = scoreTable.rows[i];
            if (row.cells[1].innerText === name) {
                lastScore = parseInt(row.cells[3].innerText, 10) || 0;
                var beit = row.cells[4].innerText === '-' ? 0 : parseInt(row.cells[4].innerText, 10);
                if (beit > maxBeit) {
                    maxBeit = beit;
                }
            }
        }

        standings.push({ name: name, score: lastScore, beit: maxBeit });

        var resultItem = document.createElement('div');
        resultItem.innerText = name + ' Очки: ' + lastScore + ', Бейт: ' + maxBeit;
        resultsDiv.appendChild(resultItem);
    });

    showWinner(standings, target);
}

// Победитель: первый, кто достиг целевого счёта. Строка = игрок (или пара в режиме «пара на пару»).
function showWinner(standings, target) {
    var banner = document.getElementById('winnerBanner');
    if (!banner) { return; }

    var reached = standings.filter(function(s) { return s.score >= target; });
    if (reached.length === 0) {
        banner.style.display = 'none';
        banner.innerText = '';
        return;
    }

    reached.sort(function(a, b) { return b.score - a.score; });
    var winner = reached[0];
    banner.style.display = 'block';
    banner.innerText = '🏆 Победитель: ' + winner.name + ' — ' + winner.score + ' очков (игра до ' + target + ')';
}

/* ============== Банк раздачи и авторасчёт очков пары (режим «пара на пару») ============== */
// Банк = 162 (голая игра) + объявления. Зная очки одной пары, вторая = банк − первая.

var calcDecls = { terz: 0, fifty: 0 };
var lastEditedScore = 'score0';

function getBank() {
    var bellaEl = document.getElementById('bella');
    var bella = (bellaEl && bellaEl.checked) ? 20 : 0;
    return 162 + calcDecls.terz * 20 + calcDecls.fifty * 50 + bella;
}

function updateBankDisplay() {
    var bankEl = document.getElementById('bankTotal');
    if (bankEl) { bankEl.innerText = String(getBank()); }
}

function changeDecl(type, delta) {
    calcDecls[type] = Math.max(0, calcDecls[type] + delta);
    var el = document.getElementById(type === 'terz' ? 'terzCount' : 'fiftyCount');
    if (el) { el.innerText = String(calcDecls[type]); }
    onDeclChange();
}

// Изменили объявления — обновить банк и пересчитать очки второй пары.
function onDeclChange() {
    updateBankDisplay();
    recomputeOtherPairScore();
}

// Ввели очки одной пары — посчитать вторую (банк − введённое). Можно поправить вручную.
function onPairScoreInput(which) {
    lastEditedScore = which;
    recomputeOtherPairScore();
}

function recomputeOtherPairScore() {
    if (getMode() !== 'pairs') { return; }
    var s0 = document.querySelector('input[name="score0"]');
    var s1 = document.querySelector('input[name="score1"]');
    if (!s0 || !s1) { return; }

    var src = lastEditedScore === 'score0' ? s0 : s1;
    var dst = lastEditedScore === 'score0' ? s1 : s0;
    if (src.value === '') { return; }

    var bank = getBank();
    var v = parseInt(src.value, 10) || 0;
    dst.value = bank - v;
}
