// DON ZOILO V35.3.25 — ESTADÍSTICAS
// Ranking de productos + ranking de clientes a partir de remitos ENTREGADOS.
(() => {
  const byId = id => document.getElementById(id);
  const moneyFmt = new Intl.NumberFormat('es-AR', {style:'currency', currency:'ARS', maximumFractionDigits:0});
  const numFmt = new Intl.NumberFormat('es-AR', {maximumFractionDigits:2});

  function isoLocal(date){
    const y=date.getFullYear();
    const m=String(date.getMonth()+1).padStart(2,'0');
    const d=String(date.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  function parseISO(value){
    const [y,m,d]=String(value||'').split('-').map(Number);
    return new Date(y,m-1,d);
  }
  function today(){ return isoLocal(new Date()); }
  function weekRange(){
    const now=new Date();
    const day=(now.getDay()+6)%7; // lunes = 0
    const start=new Date(now); start.setDate(now.getDate()-day);
    const end=new Date(start); end.setDate(start.getDate()+6);
    return [isoLocal(start),isoLocal(end)];
  }
  function monthRange(){
    const now=new Date();
    return [isoLocal(new Date(now.getFullYear(),now.getMonth(),1)),isoLocal(new Date(now.getFullYear(),now.getMonth()+1,0))];
  }
  function displayDate(value){
    if(!value) return '';
    return parseISO(value).toLocaleDateString('es-AR');
  }
  function norm(value){
    return String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('es-AR');
  }
  function titleCase(value){
    return String(value||'').trim().replace(/\s+/g,' ').replace(/(^|\s)\S/g,m=>m.toLocaleUpperCase('es-AR'));
  }


  // V35.3.25: unificación de nombres equivalentes SOLO para el ranking de clientes.
  function clientKey(value){
    return norm(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  }
  const CLIENT_GROUPS = new Map();
  function addClientGroup(canonical, variants){
    [canonical,...variants].forEach(v=>CLIENT_GROUPS.set(clientKey(v), canonical));
  }
  addClientGroup('ITUZAINGÓ', ['ITUZAINGO']);
  addClientGroup('MORÓN', ['MORON']);
  addClientGroup('DUMPLING', ['GORRITI 5612','PRINGLES 1272']);
  addClientGroup('GARCÍA DEL RIO', ['GARCIA DEL RIO']);

  function canonicalClient(value){
    const raw=String(value||'').trim();
    return CLIENT_GROUPS.get(clientKey(raw)) || raw || 'Sin cliente';
  }

  // V35.2.6: unificación ampliada de nombres equivalentes para el ranking.
  function productKey(value){
    return norm(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/º/g,'').trim();
  }
  const PRODUCT_GROUPS = new Map();
  function addProductGroup(canonical, variants){
    [canonical,...variants].forEach(v=>PRODUCT_GROUPS.set(productKey(v), canonical));
  }
  addProductGroup('Paleta', ['paleta churrasco','paleta picada','paleta entera']);
  addProductGroup('Paleta oferta', ['paleta de oferta','paleta envasada']);
  addProductGroup('Tapa de asado', ['tapa asado','tapa de asado oferta','tapa','tapa asado oferta','tapa de asado envasada', 'tapa asado envasada','tapa de asado envasado']);
  addProductGroup('Lomo', ['lomos']);
  addProductGroup('Bife', ['bife con lomo']);
  addProductGroup('Matambrito', ['matambrito de cerdo']);
  addProductGroup('Suprema', ['suprema caja','suprema congelada']);
  addProductGroup('Nalga sin tapa', ['nalgas sin tapa']);
  addProductGroup('Bife de chorizo', ['bife chorizo','bife de chorizo fresco']);
  addProductGroup('Chorizo', ['chorizo atado']);
  addProductGroup('Vacío fresco', ['vacio fresco']);
  addProductGroup('Pollo 8', ['pollo de 8']);
  addProductGroup('Chorizo con morrón', ['chorizo con morron','chorizo con morronº']);
  addProductGroup('Nalga sin tapa', ['nalga sin tapa envasada','nalgas sin tapa']);
  addProductGroup('Carré', ['carre','carre cortado']);
  addProductGroup('Cuadril', ['cuadril sin tapa']);
  addProductGroup('Riñón', ['riñon']);
  addProductGroup('Chinchulín', ['chinchulin']);
  addProductGroup('Molleja', ['mollejas']);

  function canonicalProduct(value){
    const raw=String(value||'').trim();
    return PRODUCT_GROUPS.get(productKey(raw)) || titleCase(raw || 'Sin producto');
  }

  // Para pollo/huevo: caja = 20 kg; unidad = 3 kg.
  function equivalentKg(product, unit, quantity){
    const key=productKey(product);
    const u=String(unit||'kg').toLowerCase();
    const q=Number(quantity||0);
    if(u==='kg') return q;
    const isChickenOrEgg = key.includes('pollo') || key.includes('huevo');
    if(isChickenOrEgg && (u==='caja' || u==='cajas')) return q*20;
    if(isChickenOrEgg && (u==='unidad' || u==='unidades')) return q*3;
    return 0;
  }
  function orderRows(){
    try { return Array.isArray(orders) ? orders : []; }
    catch(_) { return []; }
  }
  function deliveredRows(){ return orderRows().filter(o=>o && o.delivered===true); }

  function setRange(type){
    let from=today(), to=today();
    if(type==='week') [from,to]=weekRange();
    if(type==='month') [from,to]=monthRange();
    byId('statsDateFrom').value=from;
    byId('statsDateTo').value=to;
    renderStatistics();
  }

  function fillClients(){
    const select=byId('statsClientFilter');
    if(!select) return;
    const current=select.value;
    const clients=[...new Set(deliveredRows().map(x=>String(x.client||'').trim()).filter(Boolean))]
      .sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'}));
    select.innerHTML='<option value="">Todos los clientes</option>'+clients.map(c=>`<option value="${escapeHtmlStats(c)}">${escapeHtmlStats(c)}</option>`).join('');
    if(clients.includes(current)) select.value=current;
  }

  function escapeHtmlStats(value){
    return String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
  }

  function unitLabel(unit){
    const u=String(unit||'kg').toLowerCase();
    if(u==='piezas' || u==='pieza') return 'piezas';
    if(u==='caja') return 'cajas';
    if(u==='gancho') return 'ganchos';
    if(u==='unidad') return 'unidades';
    return u || 'unidades';
  }

  function uniqueRemitoKey(o){ return String(o.batch_id || o.id || ''); }

  // V35.3.25: una única fuente de cálculo para Resumen y rankings.
  function lineKg(o){
    return equivalentKg(o?.product, o?.unit, o?.quantity);
  }

  function lineBilling(o){
    const quantity=Number(o?.quantity);
    const unitPrice=Number(o?.unit_price);
    if(Number.isFinite(quantity) && Number.isFinite(unitPrice) && quantity>=0 && unitPrice>=0){
      return quantity * unitPrice;
    }
    const savedTotal=Number(o?.total);
    return Number.isFinite(savedTotal) ? savedTotal : 0;
  }


  function aggregate(rows){
    const map=new Map();
    for(const o of rows){
      const canonical=canonicalProduct(o.product);
      const key=productKey(canonical) || 'sin producto';
      if(!map.has(key)) map.set(key,{product:canonical,kg:0,billing:0,remitos:new Set(),units:{}});
      const item=map.get(key);
      const q=Number(o.quantity||0);
      const u=String(o.unit||'kg').toLowerCase();
      const kg=lineKg(o);
      if(kg>0) item.kg+=kg;
      if(u!=='kg') {
        const label=unitLabel(u);
        item.units[label]=(item.units[label]||0)+q;
      }
      item.billing+=lineBilling(o);
      item.remitos.add(uniqueRemitoKey(o));
    }
    return [...map.values()].map(x=>({...x,remitoCount:x.remitos.size}));
  }


  function aggregateClients(rows){
    const map=new Map();
    for(const o of rows){
      const client=canonicalClient(o.client);
      const key=clientKey(client) || 'sin cliente';
      if(!map.has(key)) map.set(key,{client,kg:0,billing:0,remitos:new Set()});
      const item=map.get(key);
      item.kg+=lineKg(o);
      item.billing+=lineBilling(o);
      const remitoKey=uniqueRemitoKey(o);
      if(remitoKey) item.remitos.add(remitoKey);
    }
    return [...map.values()].map(x=>({...x,orderCount:x.remitos.size}));
  }

  function renderClientRanking(rows,from,to){
    const body=byId('statsClientRankingBody');
    const empty=byId('statsClientEmpty');
    const period=byId('statsClientPeriodLabel');
    if(!body) return;
    if(period) period.textContent=`${displayDate(from)} al ${displayDate(to)}`;
    const ranking=aggregateClients(rows).sort((a,b)=>
      b.billing-a.billing || b.kg-a.kg || b.orderCount-a.orderCount ||
      String(a.client||'').localeCompare(String(b.client||''),'es',{sensitivity:'base'})
    );
    if(!ranking.length){
      body.innerHTML='';
      if(empty){
        empty.textContent='No hay clientes con remitos entregados para este período.';
        empty.classList.remove('hidden');
      }
      return;
    }
    if(empty) empty.classList.add('hidden');
    const totalClientKg=ranking.reduce((sum,r)=>sum+Number(r.kg||0),0);
    const totalClientBilling=ranking.reduce((sum,r)=>sum+Number(r.billing||0),0);
    const totalClientOrders=new Set(rows.map(uniqueRemitoKey).filter(Boolean)).size;
    body.innerHTML=ranking.map((r,i)=>`<tr>
      <td class="stats-rank">${i+1}</td>
      <td><strong>${escapeHtmlStats(r.client)}</strong></td>
      <td>${numFmt.format(r.kg)} kg</td>
      <td>${r.orderCount}</td>
      <td class="stats-money">${moneyFmt.format(r.billing)}</td>
    </tr>`).join('') + `<tr class="stats-total-row">
      <td></td>
      <td><strong>TOTAL</strong></td>
      <td><strong>${numFmt.format(totalClientKg)} kg</strong></td>
      <td><strong>${totalClientOrders}</strong></td>
      <td class="stats-money"><strong>${moneyFmt.format(totalClientBilling)}</strong></td>
    </tr>`;
  }

  function renderStatistics(){
    const from=byId('statsDateFrom')?.value || today();
    const to=byId('statsDateTo')?.value || today();
    const client=byId('statsClientFilter')?.value || '';
    const sortBy=byId('statsSortBy')?.value || 'kg';
    if(from>to){
      byId('statsRankingBody').innerHTML='';
      byId('statsEmpty').classList.remove('hidden');
      byId('statsEmpty').textContent='La fecha Desde no puede ser posterior a Hasta.';
      if(byId('statsClientRankingBody')) byId('statsClientRankingBody').innerHTML='';
      if(byId('statsClientEmpty')){
        byId('statsClientEmpty').textContent='La fecha Desde no puede ser posterior a Hasta.';
        byId('statsClientEmpty').classList.remove('hidden');
      }
      return;
    }

    // El ranking de clientes usa TODOS los clientes del período.
    // El filtro Cliente se mantiene solamente para el ranking de productos/KPIs.
    const periodRows=deliveredRows().filter(o=>{
      const date=String(o.delivery_date||'');
      return date>=from && date<=to;
    });
    const rows=periodRows.filter(o=>!client || o.client===client);
    renderClientRanking(periodRows,from,to);
    const ranking=aggregate(rows);
    ranking.sort((a,b)=>{
      const alpha=(x,y)=>String(x.product||'').localeCompare(String(y.product||''),'es',{sensitivity:'base'});
      if(sortBy==='alpha') return alpha(a,b);
      if(sortBy==='billing') return b.billing-a.billing || b.kg-a.kg || alpha(a,b);
      if(sortBy==='remitos') return b.remitoCount-a.remitoCount || b.kg-a.kg || alpha(a,b);
      return b.kg-a.kg || b.billing-a.billing || alpha(a,b);
    });

    // Los totales del Resumen salen de la MISMA agregación que alimenta el ranking.
    // De esta forma, la suma visible del ranking y los KPIs siempre coinciden.
    const totalKg=ranking.reduce((sum,item)=>sum+Number(item.kg||0),0);
    const totalBilling=ranking.reduce((sum,item)=>sum+Number(item.billing||0),0);
    const remitos=new Set(rows.map(uniqueRemitoKey).filter(Boolean));

    byId('statsTotalKg').textContent=`${numFmt.format(totalKg)} kg`;
    byId('statsTotalBilling').textContent=moneyFmt.format(totalBilling);
    byId('statsProductCount').textContent=String(ranking.length);
    byId('statsRemitoCount').textContent=String(remitos.size);
    byId('statsPeriodLabel').textContent=`${displayDate(from)} al ${displayDate(to)}${client?` · ${client}`:''}`;

    const tbody=byId('statsRankingBody');
    const empty=byId('statsEmpty');
    if(!ranking.length){
      tbody.innerHTML='';
      empty.textContent='No hay remitos entregados para este período.';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    tbody.innerHTML=ranking.map((r,i)=>{
      const other=Object.entries(r.units).map(([u,q])=>`${numFmt.format(q)} ${u}`).join(' · ') || '—';
      return `<tr>
        <td class="stats-rank">${i+1}</td>
        <td><strong>${escapeHtmlStats(r.product)}</strong></td>
        <td>${numFmt.format(r.kg)} kg</td>
        <td>${escapeHtmlStats(other)}</td>
        <td>${r.remitoCount}</td>
        <td class="stats-money">${moneyFmt.format(r.billing)}</td>
      </tr>`;
    }).join('') + `<tr class="stats-total-row">
      <td></td>
      <td><strong>TOTAL</strong></td>
      <td><strong>${numFmt.format(totalKg)} kg</strong></td>
      <td>—</td>
      <td><strong>${remitos.size}</strong></td>
      <td class="stats-money"><strong>${moneyFmt.format(totalBilling)}</strong></td>
    </tr>`;
  }

  function initStatistics(){
    if(!byId('statistics')) return;
    setRange('month');
    fillClients();
    document.querySelectorAll('.stats-period-btn').forEach(btn=>btn.addEventListener('click',()=>setRange(btn.dataset.period)));
    byId('statsApply')?.addEventListener('click',renderStatistics);
    byId('statsRefresh')?.addEventListener('click',async()=>{
      const btn=byId('statsRefresh');
      const old=btn.textContent; btn.disabled=true; btn.textContent='Actualizando…';
      try{
        if(typeof reloadCloudData==='function' && typeof supabaseClient!=='undefined' && supabaseClient) await reloadCloudData();
        fillClients(); renderStatistics();
      }catch(e){ alert('No se pudieron actualizar las estadísticas: '+(e.message||e)); }
      finally{ btn.disabled=false; btn.textContent=old; }
    });
    byId('statsClientFilter')?.addEventListener('change',renderStatistics);
    byId('statsSortBy')?.addEventListener('change',renderStatistics);
    byId('statsDateFrom')?.addEventListener('change',renderStatistics);
    byId('statsDateTo')?.addEventListener('change',renderStatistics);

    document.querySelector('.tab[data-view="statistics"]')?.addEventListener('click',()=>{ fillClients(); renderStatistics(); });
    window.addEventListener('donzoilo:remote-change',e=>{ if(e.detail?.table==='orders') setTimeout(()=>{fillClients();renderStatistics();},700); });
    window.addEventListener('focus',()=>{ if(byId('statistics')?.classList.contains('active')) {fillClients();renderStatistics();} });
    setTimeout(()=>{fillClients();renderStatistics();},1200);
  }

  initStatistics();
})();
