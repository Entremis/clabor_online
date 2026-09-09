'use strict';
let statsStore, statsHistory, statsLibrary, statsResult;
const byId = id => document.getElementById(id);
function node(tag,text) { const n=document.createElement(tag); if(text !== undefined) n.textContent=text; return n; }
function drawTable(target, rows) {
    const table=node('table'), head=table.createTHead().insertRow();
    ['Имя / состав','Игр','Побед','Доля побед','Средний счёт','Бейтов'].forEach(text => { const th=node('th',text); th.scope='col'; head.append(th); });
    const body=table.createTBody();
    rows.forEach(p => { const tr=body.insertRow(); [p.name,p.games,p.wins,p.winRate+'%',p.average,p.beits].forEach(value => {tr.insertCell().textContent=value;}); });
    byId(target).replaceChildren(table);
}
function svgNode(tag,attrs,text) {
    const n=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for (const [key,value] of Object.entries(attrs || {})) n.setAttribute(key,value);
    if (text !== undefined) n.textContent=text; return n;
}
function scoreChart() {
    const player=statsResult?.people.find(p => p.id===byId('chartPlayer').value);
    const target=byId('scoreChart'); target.replaceChildren(); if (!player) return;
    const series=player.series.slice(-20), scores=series.map(s=>s.score);
    const min=Math.min(0,...scores), max=Math.max(1,...scores), left=56, top=24, width=600, height=200;
    const x=i => left+(series.length===1 ? width/2 : i*width/(series.length-1));
    const y=score => top+height-(score-min)/(max-min)*height;
    const svg=svgNode('svg',{viewBox:'0 0 680 268',role:'img','aria-label':'Итоговые очки: '+player.name,class:'score-chart'});
    svg.append(svgNode('title',{},player.name+' — итоговые очки по играм'));
    [...new Set([min,0,max])].forEach(score => {
        svg.append(svgNode('line',{x1:left,x2:left+width,y1:y(score),y2:y(score),class:'chart-grid'}));
        svg.append(svgNode('text',{x:left-8,y:y(score)+5,'text-anchor':'end'},String(score)));
    });
    svg.append(svgNode('polyline',{points:series.map((s,i)=>x(i)+','+y(s.score)).join(' '),class:'chart-line'}));
    const details=node('details'), summary=node('summary','Результаты графика списком'); details.append(summary);
    const list=node('ol');
    series.forEach((s,i) => {
        const date=new Date(s.date).toLocaleDateString('ru-RU');
        const text=date+': '+s.score+' очков'+(s.won?' · победа':'');
        const dot=svgNode('circle',{cx:x(i),cy:y(s.score),r:5,class:s.won?'chart-dot winner':'chart-dot'});
        dot.append(svgNode('title',{},text)); svg.append(dot); list.append(node('li',text));
        if (i===0 || i===series.length-1) svg.append(svgNode('text',{x:x(i),y:252,'text-anchor':series.length===1?'middle':i===0?'start':'end'},date));
    });
    details.append(list); target.append(svg,details);
}
function renderStatistics() {
    if (!statsLibrary) return;
    const days=Number(byId('statsPeriod').value);
    statsResult=ClaborPlayers.statistics(statsHistory.entries,statsLibrary.profiles,{mode:byId('statsMode').value,since:days?Date.now()-days*86400000:0});
    byId('statsSummary').textContent=statsResult.games ? 'Завершённых игр: '+statsResult.games+' · Игроков: '+statsResult.people.length : 'Пока нет завершённых игр с профилями для этих фильтров.';
    byId('statsNote').textContent=[statsResult.unlinked?'Старых игр без привязки к профилям: '+statsResult.unlinked+'. Они доступны в истории.':'',statsResult.closed?'Игр без победителя: '+statsResult.closed+'. Они не входят в статистику.':''].filter(Boolean).join(' ');
    byId('statsContent').hidden=!statsResult.games;
    drawTable('peopleTable',statsResult.people); drawTable('teamsTable',statsResult.teams); byId('teamsSection').hidden=!statsResult.teams.length;
    const bars=byId('winsChart'); bars.replaceChildren();
    const max=Math.max(1,...statsResult.people.map(p=>p.wins));
    statsResult.people.forEach(p => {
        const row=node('div'); row.className='bar-row'; const title=node('span',p.name); const track=node('div'); track.className='bar-track';
        const bar=node('div'); bar.className='bar-value'; bar.style.width=(p.wins/max*100)+'%'; track.append(bar); track.setAttribute('aria-hidden','true');
        row.append(title,track,node('span',p.wins+' / '+p.games)); bars.append(row);
    });
    const select=byId('chartPlayer'), selected=select.value; select.replaceChildren();
    statsResult.people.forEach(p => { const option=node('option',p.name); option.value=p.id; select.append(option); });
    if(statsResult.people.some(p=>p.id===selected)) select.value=selected;
    scoreChart();
}
async function loadStatistics() {
    try {
        statsStore=statsStore || await ClaborDatabase.open();
        [statsHistory, statsLibrary]=await Promise.all([statsStore.readHistory(),statsStore.readLibrary().then(s=>ClaborPlayers.validate(s.library))]);
        renderStatistics(); byId('statisticsError').textContent='';
    } catch(error) { byId('statisticsError').textContent=error.message; }
}
byId('statsMode').onchange=renderStatistics; byId('statsPeriod').onchange=renderStatistics; byId('chartPlayer').onchange=scoreChart;
window.addEventListener('clabor-storage',event=>{if(['gameHistory','playerLibrary'].includes(event.detail.key)) loadStatistics();});
window.addEventListener('pageshow',event=>{if(event.persisted) loadStatistics();});
loadStatistics();
