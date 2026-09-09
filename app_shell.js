'use strict';
(function () {
    let preference = 'system';
    try { preference = localStorage.getItem('claborTheme') || 'system'; } catch (_) {}
    if (!['system','light','dark'].includes(preference)) preference = 'system';
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    function apply() {
        document.documentElement.dataset.theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', document.documentElement.dataset.theme === 'dark' ? '#141a24' : '#f6f8fc');
    }
    apply(); media.addEventListener('change', apply);
    document.addEventListener('DOMContentLoaded', () => {
        const header = document.createElement('header'); header.className = 'app-header';
        const brand = document.createElement('a'); brand.href = 'index.html'; brand.className = 'brand'; brand.textContent = '♣ Клабор';
        const label = document.createElement('label'); label.className = 'theme-control'; label.textContent = 'Тема ';
        const select = document.createElement('select'); select.setAttribute('aria-label', 'Тема оформления');
        [['system','Как на устройстве'],['light','Светлая'],['dark','Тёмная']].forEach(([value,text]) => {
            const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
        });
        select.value = preference;
        select.onchange = () => { preference = select.value; try { localStorage.setItem('claborTheme', preference); } catch (_) {} apply(); };
        label.append(select); header.append(brand,label);
        const nav = document.createElement('nav'); nav.className = 'main-nav'; nav.setAttribute('aria-label','Основные разделы');
        [['index.html','Новая игра'],['players.html','Игроки'],['history.html','История'],['statistics.html','Статистика']].forEach(([url,text]) => {
            const link = document.createElement('a'); link.href = url; link.textContent = text;
            if (location.pathname.endsWith('/' + url) || (url === 'index.html' && location.pathname.endsWith('/'))) link.setAttribute('aria-current','page');
            nav.append(link);
        });
        const offline = document.createElement('p'); offline.id = 'offlineStatus'; offline.className = 'hint'; offline.setAttribute('role','status');
        document.body.prepend(header,nav,offline);
        function networkStatus() { offline.textContent = navigator.onLine ? '' : 'Без интернета · игры сохраняются на этом устройстве'; }
        window.addEventListener('online',networkStatus); window.addEventListener('offline',networkStatus); networkStatus();
        const local = ['localhost','127.0.0.1','[::1]'].includes(location.hostname);
        if ('serviceWorker' in navigator && (!local || new URLSearchParams(location.search).has('offline'))) {
            navigator.serviceWorker.register('sw.js').then(async registration => {
                await navigator.serviceWorker.ready;
                if (navigator.onLine) offline.textContent = 'Готово к игре без интернета';
                function offerUpdate() {
                    if (!registration.waiting || !navigator.serviceWorker.controller || document.getElementById('appUpdate')) return;
                    const button = document.createElement('button'); button.id = 'appUpdate'; button.className = 'secondary'; button.textContent = 'Доступна новая версия · обновить';
                    button.onclick = async () => {
                        if (typeof askConfirmation === 'function' && !await askConfirmation('Обновить приложение? Сохранённые игры и профили останутся на устройстве.')) return;
                        if (typeof saveQueue !== 'undefined') await saveQueue;
                        registration.waiting.postMessage({type:'SKIP_WAITING'});
                    };
                    offline.after(button);
                }
                offerUpdate();
                registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', offerUpdate));
            }).catch(() => { if (navigator.onLine) offline.textContent = 'Офлайн-версия пока не готова. Откройте приложение ещё раз с интернетом.'; });
            let reloading = false;
            const hadController = Boolean(navigator.serviceWorker.controller);
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (!hadController || reloading) return;
                // Another tab may request an update. Keep this tab's drafts safe first.
                reloading = true;
                Promise.resolve(typeof saveQueue !== 'undefined' ? saveQueue : undefined).then(() => {
                    if (typeof unsaved !== 'undefined' && unsaved) { reloading = false; return; }
                    location.reload();
                });
            });
        }
    });
})();
