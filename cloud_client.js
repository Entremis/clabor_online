'use strict';
window.ClaborCloud=(function(){
    let store,scheduled,running=false,reauth=false;
    function status(message,error=false) {
        let line=document.getElementById('cloudStatus');
        if(!line){line=document.createElement('p');line.id='cloudStatus';line.className='hint';line.setAttribute('role','status');document.querySelector('.main-nav')?.after(line);}
        line.textContent=message;line.classList.toggle('error-message',error);
        window.dispatchEvent(new CustomEvent('clabor-sync-status',{detail:{message,error}}));
    }
    async function request(path,options={},session) {
        const url=window.CLABOR_CLOUD?.apiUrl;
        if(!url)throw new Error('Облачное подключение пока не настроено.');
        const headers={'Content-Type':'application/json',...options.headers};if(session)headers.Authorization='Bearer '+session.token;
        let response;
        try{response=await fetch(url+path,{...options,headers,cache:'no-store',signal:AbortSignal.timeout(20000)});}
        catch(_){throw new Error('Нет связи с облаком. Изменения сохранены на устройстве.');}
        let data;try{data=await response.json();}catch(_){throw new Error('Облако вернуло неожиданный ответ. Попробуйте позже.');}
        if(!response.ok)throw Object.assign(new Error(data.error||'Не удалось связаться с облаком.'),{status:response.status});
        return data;
    }
    async function pull(session) {
        const {version}=await store.syncStatus();let params=new URLSearchParams({since:String(version)}),records=[],revision=version;
        for(let page=0;page<100;page++) {
            const result=await request('/sync?'+params,{},session);records.push(...result.records);revision=result.until;
            if(!result.next){await store.acceptRemote({revision,records});return;}
            params=new URLSearchParams({since:String(version),until:String(revision),after:String(result.next.after),key:result.next.key});
        }
        throw new Error('Слишком большая история для одной синхронизации. Обратитесь к владельцу приложения.');
    }
    async function run() {
        if(!store||running||reauth||!store.owner)return;
        running=true;
        try {
            const session=await store.getSession();if(!session||session.userId!==store.owner)return;
            if(!navigator.onLine){status('Без интернета · изменения ждут отправки');return;}
            status('Сохраняем в облако…');
            for(let pass=0;pass<12;pass++) {
                const state=await store.syncStatus();
                // First finish an uncertain request. Its durable ID makes retries safe.
                if(!state.flight) await pull(session);
                const flight=await store.prepareSync();if(!flight)break;
                try{const reply=await request('/sync',{method:'PUT',body:JSON.stringify(flight)},session);await store.ackSync(flight.requestId,reply.revision);}
                catch(error){if(error.status===409){await store.rejectSync(flight.requestId);await pull(session);}else throw error;}
            }
            const state=await store.syncStatus(),count=Object.keys(state.conflicts).length;
            status(count?'Есть разные версии записей · выберите вариант в разделе «Аккаунт»':state.pending?'Есть изменения, ожидающие отправки':'Всё сохранено в облаке · '+session.username,Boolean(count));
            if(state.pending&&!count)schedule();
        }catch(error){
            if(error.status===401){reauth=true;status('Нужно войти снова · локальные изменения сохранены',true);}
            else status(error.message,true);
        }finally{running=false;}
    }
    async function syncNow() {
        if(navigator.locks && store) return navigator.locks.request('clabor-sync-'+store.owner,{ifAvailable:true},lock=>lock?run():undefined);
        return run();
    }
    function schedule(){clearTimeout(scheduled);scheduled=setTimeout(syncNow,1200);}
    function start(next) {
        if(store)return;store=next;
        const link=document.createElement('a');link.href='account.html';link.textContent='Аккаунт';
        if(location.pathname.endsWith('/account.html'))link.setAttribute('aria-current','page');
        document.querySelector('.main-nav')?.append(link);
        window.addEventListener('clabor-local-change',schedule);
        window.addEventListener('online',()=>{reauth=false;syncNow();});window.addEventListener('offline',()=>status('Без интернета · изменения ждут отправки'));
        document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncNow();});
        setInterval(()=>{if(!document.hidden)syncNow();},30000);
        schedule();
    }
    return {start,syncNow,request};
})();
window.addEventListener('clabor-storage',({detail})=>{if(detail.key==='__session')location.reload();});
