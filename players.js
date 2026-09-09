'use strict';
let profilesStore, profilesSnapshot, profilesBusy = false;
function profileElement(tag,text) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; return node; }
async function updateProfiles(change) {
    if (profilesBusy || !profilesSnapshot) return;
    profilesBusy = true;
    try {
        const next = ClaborPlayers.validate(change(Clabor.clone(profilesSnapshot.library)));
        profilesSnapshot = await profilesStore.saveLibrary(next, profilesSnapshot.token);
        document.getElementById('playersError').textContent = ''; renderProfiles();
        return true;
    } catch (error) { document.getElementById('playersError').textContent = error.message; return false; }
    finally { profilesBusy = false; }
}
function renderProfiles() {
    if (!profilesSnapshot) return;
    const library = profilesSnapshot.library;
    const list = document.getElementById('profilesList'); list.replaceChildren();
    const visible = library.profiles.filter(p => !p.archived || document.getElementById('showArchived').checked)
        .sort((a,b) => Number(a.archived)-Number(b.archived) || Number(b.favorite)-Number(a.favorite) || a.name.localeCompare(b.name,'ru'));
    if (!visible.length) list.append(profileElement('p','Добавьте первого игрока — затем его можно будет выбирать для любой игры.'));
    visible.forEach(profile => {
        const card = profileElement('section'); card.className = 'panel';
        card.append(profileElement('h3',ClaborPlayers.profileLabel(profile, library.profiles) + (profile.archived ? ' · в архиве' : '')));
        const form = profileElement('form'); form.className = 'profile-edit';
        const label = profileElement('label','Имя'); label.htmlFor = 'name-' + profile.id;
        const input = profileElement('input'); input.type = 'text'; input.id = label.htmlFor; input.value = profile.name; input.maxLength = 100; input.required = true;
        const save = profileElement('button','Сохранить имя'); save.type = 'submit'; form.append(label,input,save);
        form.onsubmit = async event => {
            event.preventDefault(); const name = input.value.trim();
            if (!name) return;
            await updateProfiles(next => { const p = next.profiles.find(p => p.id === profile.id); p.name = name; p.updatedAt = new Date().toISOString(); return next; });
        };
        const favorite = profileElement('button',profile.favorite ? '★ В избранном' : '☆ В избранное'); favorite.className = 'secondary';
        favorite.setAttribute('aria-pressed',String(profile.favorite));
        favorite.onclick = () => updateProfiles(next => { const p = next.profiles.find(p => p.id === profile.id); p.favorite = !p.favorite; p.updatedAt = new Date().toISOString(); return next; });
        const archive = profileElement('button',profile.archived ? 'Вернуть в выбор игроков' : 'Убрать в архив'); archive.className = 'secondary';
        archive.onclick = () => updateProfiles(next => { const p = next.profiles.find(p => p.id === profile.id); p.archived = !p.archived; p.updatedAt = new Date().toISOString(); return next; });
        card.append(form,favorite,archive); list.append(card);
    });
    const lineups = document.getElementById('lineupsList'); lineups.replaceChildren();
    if (!library.lineups.length) lineups.append(profileElement('p','Пока нет сохранённых составов.'));
    library.lineups.forEach(lineup => {
        const card = profileElement('section'); card.className = 'panel'; card.append(profileElement('h3',lineup.name));
        card.append(profileElement('p',lineup.slots.map(s => s.memberIds.map(id => library.profiles.find(p => p.id === id)?.name || '—').join(' и ')).join(' / ')));
        const use = profileElement('a','Выбрать состав'); use.href = 'index.html?lineup=' + encodeURIComponent(lineup.id);
        const remove = profileElement('button','Удалить состав'); remove.className = 'secondary';
        remove.onclick = async () => { if (await askConfirmation('Удалить состав «' + lineup.name + '»? История игр сохранится.')) await updateProfiles(next => { next.lineups = next.lineups.filter(l => l.id !== lineup.id); return next; }); };
        card.append(use,remove); lineups.append(card);
    });
}
document.getElementById('newProfileForm').onsubmit = async event => {
    event.preventDefault(); const input = document.getElementById('newProfileName');
    if (await updateProfiles(next => ClaborPlayers.addProfile(next,input.value).library)) input.value = '';
};
document.getElementById('showArchived').onchange = renderProfiles;
async function loadProfiles() {
    try { profilesStore = await ClaborDatabase.open(); profilesSnapshot = await profilesStore.readLibrary(); ClaborPlayers.validate(profilesSnapshot.library); renderProfiles(); }
    catch (error) { document.getElementById('playersError').textContent = error.message; }
}
window.addEventListener('clabor-storage', ({detail}) => { if (detail.key === 'playerLibrary') loadProfiles(); });
loadProfiles();
