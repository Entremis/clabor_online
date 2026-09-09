'use strict';
let accountStore,accountBusy=false;
const accountEl=id=>document.getElementById(id);
function accountNode(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
function describeVersion(value) {
    if(value===null)return 'Запись удалена';
    if(value.kind==='active'){
        const result=Clabor.calculate(value.game);return 'Текущая игра · '+value.game.players.map((p,i)=>p.name+': '+result.totals[i]).join(' / ')+' · раздач: '+value.game.rounds.length;
    }
    if(value.kind==='history')return 'История · '+value.game.players.join(' / ')+' · '+(value.game.standings||[]).map(p=>p.name+': '+p.score).join(' / ');
    if(value.gameId)return 'Выбор текущей игры из этой версии. Сначала выберите нужный вариант самой игры, затем — её выбор для продолжения.';
    if(Array.isArray(value.slots))return value.name+' · '+(value.mode==='pairs'?'Пара на пару':'Каждый за себя')+' · до '+value.target;
    return (value.name||'Запись')+' · '+(value.favorite?'В избранном':'Без звезды')+' · '+(value.archived?'В архиве':'Доступен для игры');
}
async function renderConflicts() {
    if(!accountStore?.owner)return;
    const state=await accountStore.syncStatus(),list=accountEl('conflictList');list.replaceChildren();accountEl('conflictsPanel').hidden=!Object.keys(state.conflicts).length;
    for(const [key,conflict] of Object.entries(state.conflicts)) {
        const card=accountNode('section');card.className='panel';card.append(accountNode('h3',key.startsWith('game:')?'Игра':key.startsWith('profile:')?'Игрок':key.startsWith('lineup:')?'Состав':'Выбор текущей игры'));
        for(const [choice,label] of [['mine','На этом устройстве'],['theirs','В облаке']]) {
            card.append(accountNode('h4',label),accountNode('p',describeVersion(conflict[choice])));
            const value=conflict[choice];
            if(value?.game?.rounds?.length){
                const details=accountNode('details'),summary=accountNode('summary','Счёт по раздачам'),list=accountNode('ol');
                value.game.rounds.forEach(round=>list.append(accountNode('li',Array.isArray(round)?round.map(p=>p.name+': '+p.score).join(' / '):round.scores.join(' / '))));
                details.append(summary,list);card.append(details);
            }
            const use=accountNode('button',choice==='mine'?'Оставить вариант устройства':'Использовать вариант облака');
            use.onclick=async()=>{if(accountBusy)return;accountBusy=true;try{if(!await askConfirmation('Использовать выбранный вариант? Обе версии останутся в локальной резервной копии.'))return;await accountStore.resolveConflict(key,choice);await ClaborCloud.syncNow();await renderConflicts();}catch(error){accountEl('accountError').textContent=error.message;}finally{accountBusy=false;}};
            card.append(use);
        }
        list.append(card);
    }
}
document.querySelectorAll('[name="authMode"]').forEach(radio=>radio.onchange=()=>{
    const register=document.querySelector('[name="authMode"]:checked').value==='register';accountEl('confirmPasswordField').hidden=!register;accountEl('confirmPassword').required=register;accountEl('accountPassword').autocomplete=register?'new-password':'current-password';accountEl('authSubmit').textContent=register?'Создать аккаунт':'Войти';
});
accountEl('authForm').onsubmit=async event=>{
    event.preventDefault();if(accountBusy)return;accountBusy=true;accountEl('authFields').disabled=true;accountEl('accountError').textContent='';
    try{
        const mode=document.querySelector('[name="authMode"]:checked').value;
        if(mode==='register'&&accountEl('accountPassword').value!==accountEl('confirmPassword').value)throw new Error('Пароли не совпадают.');
        const session=await ClaborCloud.request('/auth/'+mode,{method:'POST',body:JSON.stringify({username:accountEl('accountLogin').value,password:accountEl('accountPassword').value})});
        await accountStore.activateSession(session,accountEl('importLocal').checked);location.href='index.html';
    }catch(error){accountEl('accountError').textContent=error.message;}finally{accountBusy=false;accountEl('authFields').disabled=false;}
};
accountEl('syncNow').onclick=async()=>{await ClaborCloud.syncNow();await renderConflicts();};
accountEl('importAfterLogin').onclick=async()=>{
    if(accountBusy)return;accountBusy=true;
    try{const session=await accountStore.getSession();if(!await askConfirmation('Добавить прежние сохранения этого устройства в компанию «'+session.username+'»?'))return;await accountStore.activateSession(session,true);location.reload();}
    catch(error){accountEl('accountError').textContent=error.message;}finally{accountBusy=false;}
};
accountEl('signOut').onclick=async()=>{
    if(accountBusy)return;accountBusy=true;
    try{
        const state=await accountStore.syncStatus();
        if(!await askConfirmation(state.pending||state.flight?'Есть неотправленные изменения. Они сохранятся только на этом устройстве до следующего входа в тот же аккаунт. Выйти?':'Выйти из общего аккаунта?'))return;
        const session=await accountStore.getSession();
        try{await ClaborCloud.request('/auth/logout',{method:'POST'},session);}catch(_){}
        await accountStore.logout();location.reload();
    }catch(error){accountEl('accountError').textContent=error.message;}finally{accountBusy=false;}
};
window.addEventListener('clabor-sync-status',event=>{accountEl('accountSync').textContent=event.detail.message;renderConflicts().catch(error=>{accountEl('accountError').textContent=error.message;});});
(async()=>{
    try{
        accountStore=await ClaborDatabase.open();const session=await accountStore.getSession();
        if(session){
            accountEl('signedIn').hidden=false;accountEl('accountName').textContent='Компания: '+session.username;
            const local=await accountStore.localSummary();accountEl('legacyImportPanel').hidden=Boolean(local.importedBy)||!(local.profiles||local.games||local.active);
            try{await ClaborCloud.request('/auth/me',{},session);}catch(error){if(error.status===401){accountEl('authForm').hidden=false;accountEl('accountLogin').value=session.username;accountEl('accountError').textContent='Войдите повторно. Ваши неотправленные изменения сохранены.';}}
            await renderConflicts();
        }else{
            accountEl('authForm').hidden=false;const local=await accountStore.localSummary();
            if(!local.importedBy&&(local.profiles||local.games||local.active)){
                accountEl('importField').hidden=false;accountEl('localSummary').textContent='На устройстве: '+local.profiles+' игроков, '+local.games+' игр в истории'+(local.active?' и незаконченная игра.':'.');
            }
        }
    }catch(error){accountEl('accountError').textContent=error.message;}
})();
