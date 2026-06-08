var MIN_PLAYERS = 2;

function getMode() {
    var el = document.querySelector('input[name="gameMode"]:checked');
    return el ? el.value : 'individual';
}

function makeIndividualRow() {
    var row = document.createElement('div');
    row.className = 'player-row';

    var input = document.createElement('input');
    input.type = 'text';
    input.name = 'playerName';
    input.placeholder = 'Имя игрока';

    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-player';
    removeBtn.innerText = '−';
    removeBtn.onclick = function () { removePlayer(removeBtn); };

    row.appendChild(input);
    row.appendChild(removeBtn);
    return row;
}

function makePairRow(label) {
    var row = document.createElement('div');
    row.className = 'player-row';

    var span = document.createElement('span');
    span.className = 'pair-label';
    span.innerText = label;

    var input = document.createElement('input');
    input.type = 'text';
    input.name = 'playerName';
    input.placeholder = label + ' (например «Дима и Саша»)';

    row.appendChild(span);
    row.appendChild(input);
    return row;
}

// Перерисовать поля состава под выбранный режим.
function renderInputs() {
    var mode = getMode();
    var container = document.getElementById('playerNames');
    var addBtn = document.getElementById('addPlayerBtn');
    var hint = document.getElementById('playersHint');
    var heading = document.getElementById('playersHeading');
    container.innerHTML = '';

    if (mode === 'pairs') {
        heading.innerText = 'Введите названия пар:';
        hint.innerText = 'Впишите оба имени в одно поле, например «Дима и Саша».';
        container.appendChild(makePairRow('Пара 1'));
        container.appendChild(makePairRow('Пара 2'));
        addBtn.style.display = 'none';
    } else {
        heading.innerText = 'Введите имена игроков:';
        hint.innerText = 'Можно играть вдвоём или втроём. Кнопка «+» добавляет игрока, «−» убирает.';
        for (var i = 0; i < 3; i++) {
            container.appendChild(makeIndividualRow());
        }
        addBtn.style.display = 'inline-block';
    }
}

function addPlayer() {
    document.getElementById('playerNames').appendChild(makeIndividualRow());
}

function removePlayer(button) {
    var rows = document.querySelectorAll('#playerNames .player-row');
    if (rows.length <= MIN_PLAYERS) {
        alert('Должно остаться минимум ' + MIN_PLAYERS + ' игрока.');
        return;
    }
    button.parentElement.remove();
}

document.getElementById('gameSetup').onsubmit = function(event) {
    event.preventDefault();
    var gameSize = document.querySelector('input[name="gameSize"]:checked').value;
    var mode = getMode();
    var playerNames = Array.from(document.querySelectorAll('input[name="playerName"]'))
                           .map(input => input.value.trim())
                           .filter(name => name !== '');

    if (mode === 'pairs') {
        if (playerNames.length !== 2) {
            alert('Для режима «пара на пару» заполните обе пары.');
            return;
        }
    } else if (playerNames.length < MIN_PLAYERS) {
        alert('Введите имена минимум для ' + MIN_PLAYERS + ' игроков.');
        return;
    }

    localStorage.setItem('gameSize', gameSize);
    localStorage.setItem('gameMode', mode);
    localStorage.setItem('playerNames', JSON.stringify(playerNames));
    // Новая игра — раздаёт первый игрок/пара.
    localStorage.setItem('currentDealer', '0');
    window.location.href = 'game_page.html';
};

// Переключение режима перерисовывает поля; первичная отрисовка при загрузке.
Array.from(document.querySelectorAll('input[name="gameMode"]')).forEach(function(r) {
    r.onchange = renderInputs;
});
renderInputs();
