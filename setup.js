'use strict';
let setupStore, librarySnapshot, setupBusy = false;
const selectedPlayers = { individual: [[''],['']], pairs: [['',''],['','']] };
function setupError(message) { document.getElementById('setupError').textContent = message; }
function getMode() { return document.querySelector('[name="gameMode"]:checked').value; }
function currentRoster() {
    return { mode:getMode(), target:Number(document.querySelector('[name="gameSize"]:checked').value),
        slots:selectedPlayers[getMode()].map(ids => ({memberIds:ids.slice()})) };
}
function renderInputs() {
    const mode = getMode(), profiles = librarySnapshot.library.profiles;
    const available = profiles.filter(p => !p.archived).sort((a,b) => Number(b.favorite)-Number(a.favorite) || a.name.localeCompare(b.name,'ru'));
    const container = document.getElementById('playerNames'); container.replaceChildren();
    document.getElementById('playersHint').textContent = mode === 'pairs'
        ? 'Выберите по два человека в каждую пару. Командный результат войдёт в статистику обоих.'
        : 'Выберите двух или трёх игроков. Избранные отмечены звездой.';
    selectedPlayers[mode].forEach((slots, i) => {
        const group = document.createElement('fieldset'); group.className = 'roster-slot';
        const legend = document.createElement('legend'); legend.textContent = (mode === 'pairs' ? 'Пара ' : 'Игрок ') + (i+1); group.append(legend);
        slots.forEach((selected, j) => {
            const label = document.createElement('label'); label.textContent = mode === 'pairs' ? 'Участник ' + (j+1) : 'Профиль'; label.htmlFor = 'slot-' + i + '-' + j;
            const select = document.createElement('select'); select.id = label.htmlFor; select.required = true;
            const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Выберите игрока…'; select.append(empty);
            available.forEach(p => { const option = document.createElement('option'); option.value = p.id; option.textContent = (p.favorite ? '★ ' : '') + ClaborPlayers.profileLabel(p, profiles); select.append(option); });
            if (selected && !available.some(p => p.id === selected)) {
                const archived = document.createElement('option'); archived.value = selected; archived.textContent = 'Профиль в архиве — выберите замену'; select.append(archived);
            }
            select.value = selected; select.onchange = () => { selectedPlayers[mode][i][j] = select.value; };
            group.append(label, select);
        });
        if (mode === 'individual' && selectedPlayers.individual.length === 3) {
            const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Убрать место';
            remove.onclick = () => { selectedPlayers.individual.splice(i,1); renderInputs(); }; group.append(remove);
        }
        container.append(group);
    });
    document.getElementById('addPlayerBtn').hidden = mode === 'pairs' || selectedPlayers.individual.length === 3;
}
function addPlayer() { if (getMode() === 'individual' && selectedPlayers.individual.length < 3) { selectedPlayers.individual.push(['']); renderInputs(); } }
function renderLineups() {
    const select = document.getElementById('savedLineup'); select.replaceChildren();
    const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'Выбрать состав…'; select.append(empty);
    librarySnapshot.library.lineups.forEach(lineup => {
        const option = document.createElement('option'); option.value = lineup.id; option.textContent = lineup.name; select.append(option);
    });
}
function chooseLineup(id) {
    const lineup = librarySnapshot.library.lineups.find(l => l.id === id); if (!lineup) return;
    document.querySelector('[name="gameMode"][value="' + lineup.mode + '"]').checked = true;
    document.querySelector('[name="gameSize"][value="' + lineup.target + '"]').checked = true;
    selectedPlayers[lineup.mode] = lineup.slots.map(s => s.memberIds.slice()); renderInputs();
    document.getElementById('lineupName').value = lineup.name;
}
async function refreshResume() {
    const {game} = await setupStore.readCurrent();
    document.getElementById('resumeBlock').hidden = !game || game.finished;
    document.getElementById('resumePlayers').textContent = game ? game.players.map(p=>p.name).join(', ') : '';
}
document.getElementById('quickProfile').onsubmit = async event => {
    event.preventDefault(); if (setupBusy || !librarySnapshot) return; setupBusy = true;
    try {
        const input = document.getElementById('quickProfileName');
        const added = ClaborPlayers.addProfile(librarySnapshot.library, input.value);
        librarySnapshot = await setupStore.saveLibrary(added.library, librarySnapshot.token);
        const empty = selectedPlayers[getMode()].find(slot => slot.includes(''));
        if (empty) empty[empty.indexOf('')] = added.profile.id;
        input.value = ''; setupError(''); renderInputs();
    } catch (error) { setupError(error.message); } finally { setupBusy = false; }
};
document.getElementById('saveLineupButton').onclick = async () => {
    if (setupBusy) return; setupBusy = true;
    try {
        const next = ClaborPlayers.saveLineup(librarySnapshot.library, currentRoster(), document.getElementById('lineupName').value);
        librarySnapshot = await setupStore.saveLibrary(next, librarySnapshot.token); renderLineups();
        document.getElementById('setupStatus').textContent = 'Состав сохранён'; setupError('');
    } catch (error) { setupError(error.message); } finally { setupBusy = false; }
};
document.getElementById('gameSetup').onsubmit = async event => {
    event.preventDefault(); if (setupBusy) return; setupBusy = true;
    document.getElementById('startGameButton').disabled = true;
    try {
        const game = ClaborPlayers.createGame(currentRoster(), librarySnapshot.library.profiles);
        const previous = await setupStore.readCurrent();
        if (previous.game && !previous.game.finished && !await askConfirmation('Есть незаконченная игра. Начать новую вместо неё?')) return;
        await setupStore.save(game, previous.token); location.href = 'game_page.html';
    } catch (error) { setupError(error.message); }
    finally { setupBusy = false; document.getElementById('startGameButton').disabled = false; }
};
document.getElementById('savedLineup').onchange = event => chooseLineup(event.target.value);
document.querySelectorAll('[name="gameMode"]').forEach(input => { input.onchange = renderInputs; });
async function loadSetup() {
    try {
        setupStore = await ClaborDatabase.open(); librarySnapshot = await setupStore.readLibrary(); ClaborPlayers.validate(librarySnapshot.library);
        renderInputs(); renderLineups(); await refreshResume();
        document.getElementById('setupFields').disabled = false; document.getElementById('addProfileButton').disabled = false;
        const id = new URLSearchParams(location.search).get('lineup'); if (id) chooseLineup(id);
    } catch (error) { setupError(error.message); }
}
window.addEventListener('clabor-storage', async ({detail}) => {
    try {
        if (detail.key === 'currentGame') await refreshResume();
        if (detail.key === 'playerLibrary') { librarySnapshot = await setupStore.readLibrary(); renderInputs(); renderLineups(); }
    } catch (error) { setupError(error.message); }
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
loadSetup();
