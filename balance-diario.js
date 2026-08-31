/* V35.3.44: CIERRE DE BALANCE SOLO LECTURA respecto de movements. No crea, edita ni elimina cuentas corrientes. */
/* DON ZOILO V35.3.13 — BALANCE DIARIO CONSOLIDADO: CORRECCIÓN NUMÉRICA DEFINITIVA */
(function(){
'use strict';
const TABLE='daily_balances';
const LOCAL_KEY='don_zoilo_daily_balances_v34';
const MOVEMENTS_KEY='don_zoilo_movements_v1';
const STOCK_KEY='don_zoilo_stock_v33';
const ASSETS_KEYS=['don_zoilo_current_assets_v34_1','don_zoilo_current_assets_v34'];
let closings=[];
let current=null;
let cachedAssets=[];
const $=id=>document.getElementById(id);
const num=v=>{
  // Los totales compartidos entre módulos ya llegan como Number.
  // No deben convertirse a texto: un decimal como 32549269.116 podría
  // confundirse con separadores de miles y transformarse en 32549269116.
  if(typeof v==='number') return Number.isFinite(v)?v:0;
  const raw=String(v??'').trim().replace(/\$/g,'').replace(/\s/g,'');
  if(!raw) return 0;
  let normalized=raw;
  if(raw.includes(',')&&raw.includes('.')){
    // Formato argentino: 1.234.567,89
    normalized=raw.replace(/\./g,'').replace(',','.');
  }else if(raw.includes(',')){
    normalized=raw.replace(',','.');
  }else if(/^[-+]?\d{1,3}(?:\.\d{3})+$/.test(raw)){
    // Texto con puntos de miles: 32.549.269
    normalized=raw.replace(/\./g,'');
  }
  const n=Number(normalized);
  return Number.isFinite(n)?n:0;
};
const money=v=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(num(v));
const pct=v=>`${num(v).toLocaleString('es-AR',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const uid=()=>crypto.randomUUID?crypto.randomUUID():`balance-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const today=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch(_){return fallback}};
const cloud=()=>window.supabaseClient||null;
function localWrite(){localStorage.setItem(LOCAL_KEY,JSON.stringify(closings))}
function isOpening(m){return m.type==='ajuste'&&String(m.notes||'').includes('SALDO_INICIAL')}
function stockValue(rows){return rows.reduce((sum,r)=>{const basis=num(r.kg)>0?num(r.kg):num(r.quantity);return sum+basis*num(r.unit_cost)},0)}
async function loadCurrentAssets(){
  try{
    if(cloud()){
      const {data,error}=await cloud().from('current_assets').select('*').order('sort_order',{ascending:true});
      if(error)throw error;
      cachedAssets=data||[];
      localStorage.setItem(ASSETS_KEYS[0],JSON.stringify(cachedAssets));
      return cachedAssets;
    }
  }catch(e){console.warn('Balance diario: no se pudo leer current_assets desde Supabase',e)}
  for(const key of ASSETS_KEYS){
    const local=readJson(key,[]);
    if(Array.isArray(local)&&local.length){cachedAssets=local;return cachedAssets}
  }
  cachedAssets=[];
  return cachedAssets;
}
function calculations(date,previousOverride,assetsRows=cachedAssets){
  const movements=readJson(MOVEMENTS_KEY,[]);
  const assets=Array.isArray(assetsRows)?assetsRows:[];
  const stock=readJson(STOCK_KEY,[]);
  const currentAssets=assets.reduce((s,r)=>s+num(r.balance),0);
  // Usa exactamente la misma función que alimenta el total visible del módulo Saldos.
  // El cálculo local queda solo como respaldo por compatibilidad.
  const sharedAccountsTotal=window.DonZoiloFinancialTotals?.clientCurrentAccounts;
  const sharedAccountsValue=typeof sharedAccountsTotal==='function'?sharedAccountsTotal():null;
  const clientAccounts=typeof sharedAccountsValue==='number'&&Number.isFinite(sharedAccountsValue)
    ? sharedAccountsValue
    : movements.filter(m=>m.status!=='pendiente'&&['venta','cobro','ajuste'].includes(m.type)).reduce((s,m)=>{
        if(m.type==='venta'||isOpening(m))return s+num(m.amount);
        if(m.type==='cobro')return s-num(m.amount);
        return s;
      },0);
  const inventory=stockValue(stock);
  // V35.3.47: usa la misma fuente protegida que Proveedores (incluye checkpoints conciliados).
  const sharedSupplierDebt=window.DonZoiloFinancialTotals?.supplierDebt;
  const sharedSupplierValue=typeof sharedSupplierDebt==='function'?sharedSupplierDebt():null;
  const supplierDebt=typeof sharedSupplierValue==='number'&&Number.isFinite(sharedSupplierValue)
    ? sharedSupplierValue
    : movements.filter(m=>m.status!=='pendiente'&&['compra','pago'].includes(m.type)).reduce((s,m)=>s+(m.type==='compra'?num(m.amount):-num(m.amount)),0);
  const expenses=movements.filter(m=>m.type==='gasto'&&m.status!=='pendiente'&&m.date===date).reduce((s,m)=>s+num(m.amount),0);
  const totalAssets=currentAssets+clientAccounts+inventory;
  const finalEquity=totalAssets-supplierDebt;
  const previous=previousOverride!==undefined?num(previousOverride):previousEquity(date);
  // V35.3.54 — los bienes/inversiones que ya existían antes de cargarlos en la app
  // aumentan el patrimonio informado, pero NO son una ganancia del día ni del mes.
  const openingAdjustment=assets
    .filter(r=>['opening_investment','opening_fixed_asset'].includes(r.asset_type))
    .filter(r=>String(r.created_at||'').slice(0,10)===date)
    .reduce((s,r)=>s+num(r.balance),0);
  const netResult=finalEquity-previous-openingAdjustment;
  const beforeExpenses=netResult+expenses;
  const variation=previous?netResult/previous*100:0;
  return {date,current_assets:currentAssets,client_accounts:clientAccounts,stock_value:inventory,total_assets:totalAssets,supplier_debt:supplierDebt,total_liabilities:supplierDebt,daily_expenses:expenses,previous_equity:previous,final_equity:finalEquity,opening_adjustment:openingAdjustment,result_before_expenses:beforeExpenses,net_result:netResult,variation_pct:variation};
}
function previousEquity(date){
  const prior=closings.filter(r=>r.balance_date<date).sort((a,b)=>String(b.balance_date).localeCompare(String(a.balance_date)))[0];
  return prior?num(prior.final_equity):0;
}
async function loadClosings(){
  try{
    if(cloud()){
      const {data,error}=await cloud().from(TABLE).select('*').order('balance_date',{ascending:false});
      if(error)throw error;
      closings=data||[];localWrite();
    }else closings=readJson(LOCAL_KEY,[]);
  }catch(e){console.warn('Balance diario:',e);closings=readJson(LOCAL_KEY,[])}
}
function injectStyles(){if($('dailyBalanceStyles'))return;const s=document.createElement('style');s.id='dailyBalanceStyles';s.textContent=`
#dailyBalance .balance-toolbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap;margin-bottom:16px}#dailyBalance .balance-toolbar label{display:flex;flex-direction:column;gap:5px;font-weight:700}#dailyBalance .balance-toolbar input{min-width:180px}#dailyBalance .balance-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}#dailyBalance .balance-panel{background:#fff;border:1px solid #d9dee7;border-radius:14px;padding:16px}#dailyBalance .balance-panel h3{margin:0 0 12px;color:#101820}#dailyBalance .balance-line{display:flex;justify-content:space-between;gap:16px;padding:9px 0;border-bottom:1px solid #eceff3}#dailyBalance .balance-line.total{font-size:1.08rem;font-weight:900;border-top:2px solid #101820;border-bottom:0;margin-top:7px}#dailyBalance .balance-result{grid-column:1/-1;background:#101820;color:#fff;border-radius:15px;padding:18px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}#dailyBalance .result-card{border:1px solid #ffffff33;border-radius:11px;padding:12px}#dailyBalance .result-card span{display:block;color:#d0d5dd;font-size:.8rem;margin-bottom:6px}#dailyBalance .result-card strong{font-size:1.2rem}#dailyBalance .positive{color:#1f9d55}#dailyBalance .negative{color:#d92d20}#dailyBalance .balance-actions{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}#dailyBalance .balance-history{background:#fff;border:1px solid #d9dee7;border-radius:14px;overflow:hidden}#dailyBalance .balance-history-tools{display:flex;gap:12px;align-items:end;justify-content:space-between;flex-wrap:wrap;margin:18px 0 10px}#dailyBalance .balance-history-tools label{display:flex;flex-direction:column;gap:5px;font-weight:700}#dailyBalance .month-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 12px}#dailyBalance .month-summary-card{background:#fff;border:1px solid #d9dee7;border-radius:12px;padding:12px}#dailyBalance .month-summary-card span{display:block;font-size:.78rem;color:#667085;margin-bottom:5px}#dailyBalance .month-summary-card strong{font-size:1.05rem}#dailyBalance .history-row{display:grid;grid-template-columns:110px 1fr 1fr 80px;gap:10px;padding:11px 14px;border-bottom:1px solid #eceff3;align-items:center}#dailyBalance .history-row.head{font-weight:900;background:#f3f5f7}#dailyBalance .balance-note{width:100%;min-height:80px}
#dailyBalance .income-statement{margin-top:24px;background:#fff;border:1px solid #d9dee7;border-radius:14px;padding:16px}
#dailyBalance .income-head{display:flex;justify-content:space-between;gap:12px;align-items:end;flex-wrap:wrap;margin-bottom:12px}
#dailyBalance .income-head h3{margin:0}
#dailyBalance .income-head label{display:flex;flex-direction:column;gap:5px;font-weight:700}
#dailyBalance .income-meta{font-size:.82rem;color:#667085;margin-bottom:10px}
#dailyBalance .income-row{width:100%;display:grid;grid-template-columns:1fr auto;gap:12px;padding:12px 8px;border:0;border-bottom:1px solid #eceff3;background:transparent;text-align:left;font:inherit;color:inherit}
#dailyBalance button.income-row{cursor:pointer}
#dailyBalance button.income-row:hover{background:#f8fafc}
#dailyBalance button.income-row span{text-decoration:underline;text-underline-offset:3px}
#dailyBalance .income-row strong{white-space:nowrap}
#dailyBalance .income-row.major{font-size:1.08rem;font-weight:900}
#dailyBalance .income-row.clean{background:#f3f5f7;border-top:2px solid #101820}
#dailyBalance .income-row.final{background:#101820;color:#fff;border-radius:10px;margin-top:8px;font-size:1.15rem;font-weight:900;border-bottom:0}
#dailyBalance .income-detail{margin-top:14px;border:1px solid #d9dee7;border-radius:12px;overflow:hidden}
#dailyBalance .income-detail-head{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:12px;background:#f3f5f7}
#dailyBalance .income-detail-head h4{margin:0}
#dailyBalance .income-detail-row{display:grid;grid-template-columns:100px 120px 1fr auto;gap:10px;padding:9px 12px;border-top:1px solid #eceff3;font-size:.88rem}
#dailyBalance .income-detail-total{display:flex;justify-content:space-between;padding:12px;font-weight:900;border-top:2px solid #101820}@media(max-width:800px){#dailyBalance .month-summary{grid-template-columns:1fr}#dailyBalance .balance-grid{grid-template-columns:1fr}#dailyBalance .balance-result{grid-template-columns:repeat(2,1fr)}#dailyBalance .history-row{grid-template-columns:90px 1fr 1fr}.history-row>*:last-child{display:none}}`;
document.head.appendChild(s)}
function injectUI(){
  if($('dailyBalance'))return;
  const nav=document.querySelector('.tabs');
  const tab=document.createElement('button');tab.className='tab';tab.dataset.view='dailyBalance';tab.textContent='📊 Balance diario';nav?.appendChild(tab);
  const main=document.querySelector('main.container')||document.querySelector('main')||document.body;
  const sec=document.createElement('section');sec.id='dailyBalance';sec.className='view';sec.innerHTML=`
    <div class="section-head"><div><h2>📊 Balance diario</h2><p class="muted">Activos menos pasivos, comparación patrimonial y gastos del día.</p></div></div>
    <div class="balance-toolbar"><label>Fecha<input id="balanceDate" type="date"></label><label>Patrimonio anterior<input id="balancePrevious" type="number" step="0.01" inputmode="decimal"></label><button id="balanceRefresh" type="button" class="secondary">↻ Actualizar cálculo</button></div>
    <div class="balance-grid">
      <section class="balance-panel"><h3>ACTIVOS</h3><div class="balance-line"><span>Caja y activos</span><strong id="balAssets"></strong></div><div class="balance-line"><span>Cuentas corrientes clientes</span><strong id="balAccounts"></strong></div><div class="balance-line"><span>Stock valorizado</span><strong id="balStock"></strong></div><div class="balance-line total"><span>TOTAL ACTIVOS</span><strong id="balTotalAssets"></strong></div></section>
      <section class="balance-panel"><h3>PASIVOS Y GASTOS</h3><div class="balance-line"><span>Deudas con proveedores</span><strong id="balSuppliers"></strong></div><div class="balance-line total"><span>TOTAL PASIVOS</span><strong id="balLiabilities"></strong></div><div class="balance-line"><span>Gastos del día</span><strong id="balExpenses"></strong></div><div class="balance-line" id="balOpeningAdjustmentRow" style="display:none"><span>Altas patrimoniales existentes (no resultado)</span><strong id="balOpeningAdjustment"></strong></div><p class="muted small">Los gastos ya reducen los activos; se muestran por separado para explicar el resultado real.</p></section>
      <section class="balance-result"><div class="result-card"><span>Patrimonio anterior</span><strong id="balPrevious"></strong></div><div class="result-card"><span>Patrimonio final</span><strong id="balFinal"></strong></div><div class="result-card"><span>Resultado antes de gastos</span><strong id="balBeforeExpenses"></strong></div><div class="result-card"><span>Resultado neto</span><strong id="balNet"></strong><small id="balVariation"></small></div></section>
    </div>
    <label>Observaciones<textarea id="balanceNotes" class="balance-note" placeholder="Aclaraciones del cierre..."></textarea></label>
    <div class="balance-actions"><button id="balanceSave" type="button">💾 Guardar cierre diario</button><button id="balancePdf" type="button" class="secondary">📄 Generar PDF</button><button id="balanceShare" type="button" class="secondary">📲 Compartir PDF / WhatsApp</button></div>
    <div class="balance-history-tools">
      <div>
        <h3 style="margin:0">Historial de cierres</h3>
        <p class="muted small" style="margin:4px 0 0">Por defecto se muestran los movimientos del mes corriente.</p>
      </div>
      <label>Filtrar por mes<input id="balanceMonthFilter" type="month"></label>
    </div>
    <div class="month-summary">
      <div class="month-summary-card"><span>Resultados positivos del mes</span><strong id="balMonthPositive" class="positive">$0</strong></div>
      <div class="month-summary-card"><span>Resultados negativos del mes</span><strong id="balMonthNegative" class="negative">$0</strong></div>
      <div class="month-summary-card"><span>Resultado acumulado del mes</span><strong id="balMonthAccumulated">$0</strong></div>
    </div>
    <div class="balance-history" id="balanceHistory"></div>

    <section class="income-statement">
      <div class="income-head">
        <div>
          <h3>Estado de resultados</h3>
          <p class="muted small" style="margin:4px 0 0">Resultado mensual calculado desde Balance Diario y Gastos.</p>
        </div>
        <label>Mes<input id="incomeStatementMonth" type="month"></label>
      </div>
      <div id="incomeStatementMeta" class="income-meta"></div>
      <div id="incomeStatementRows"></div>
      <div id="incomeStatementDetail" class="income-detail" hidden></div>
    </section>`;
  main.appendChild(sec);
  if($('balanceMonthFilter'))$('balanceMonthFilter').value=currentMonthValue();
  tab.addEventListener('click',async()=>{document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));sec.classList.add('active');tab.classList.add('active');await refresh(true)});
}
function render(){
  if(!current)return;
  $('balAssets').textContent=money(current.current_assets);if($('balOpeningAdjustment')){$('balOpeningAdjustment').textContent=money(current.opening_adjustment||0);$('balOpeningAdjustmentRow').style.display=num(current.opening_adjustment)>0?'flex':'none';}$('balAccounts').textContent=money(current.client_accounts);$('balStock').textContent=money(current.stock_value);$('balTotalAssets').textContent=money(current.total_assets);$('balSuppliers').textContent=money(current.supplier_debt);$('balLiabilities').textContent=money(current.total_liabilities);$('balExpenses').textContent=money(current.daily_expenses);$('balPrevious').textContent=money(current.previous_equity);$('balFinal').textContent=money(current.final_equity);$('balBeforeExpenses').textContent=money(current.result_before_expenses);$('balNet').textContent=money(current.net_result);$('balNet').className=current.net_result>=0?'positive':'negative';$('balVariation').textContent=` · ${current.net_result>=0?'+':''}${pct(current.variation_pct)}`;
}
function currentMonthValue(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function renderHistory(){
  const box=$('balanceHistory');
  if(!box)return;

  const monthInput=$('balanceMonthFilter');
  const month=monthInput?.value||currentMonthValue();
  if(monthInput&&!monthInput.value)monthInput.value=month;

  const rows=closings
    .filter(r=>String(r.balance_date||'').slice(0,7)===month)
    .sort((a,b)=>String(a.balance_date).localeCompare(String(b.balance_date)));

  const positive=rows.reduce((s,r)=>s+(num(r.net_result)>0?num(r.net_result):0),0);
  const negative=rows.reduce((s,r)=>s+(num(r.net_result)<0?num(r.net_result):0),0);
  const accumulated=positive+negative;

  if($('balMonthPositive'))$('balMonthPositive').textContent=money(positive);
  if($('balMonthNegative'))$('balMonthNegative').textContent=money(negative);
  if($('balMonthAccumulated')){
    $('balMonthAccumulated').textContent=money(accumulated);
    $('balMonthAccumulated').className=accumulated>=0?'positive':'negative';
  }

  let running=0;
  const body=rows.map(r=>{
    running+=num(r.net_result);
    return `<div class="history-row">
      <span>${new Date(r.balance_date+'T12:00:00').toLocaleDateString('es-AR')}</span>
      <strong>${money(r.final_equity)}</strong>
      <strong class="${num(r.net_result)>=0?'positive':'negative'}">${money(r.net_result)}</strong>
      <span class="${running>=0?'positive':'negative'}">${money(running)}</span>
    </div>`;
  }).join('');

  box.innerHTML='<div class="history-row head"><span>Fecha</span><span>Patrimonio</span><span>Resultado</span><span>Acumulado</span></div>'
    +(body||'<div style="padding:16px" class="muted">No hay cierres guardados para este mes.</div>');
}

const INCOME_GROUPS={
  reparto:["MERMA","DESAYUNO","NAFTA","PEAJE","PROPINA","REPARTO","ATENCIÓN","SUELDOS","KANGOO"],
  impuestos:["RETENCIONES","IMPUESTOS"],
  local:["LOCAL"],
  casa:["CASA","LEO","ROMI","SERVICIOS","VACACIONES","TARJETAS"]
};
function expenseCategoryForIncome(m){
  const notes=String(m.notes||"");
  const match=notes.match(/RUBRO:\s*([^|]+)/i);
  if(match)return match[1].trim().toUpperCase();
  const concept=String(m.concept||"").toUpperCase();
  const all=[...new Set(Object.values(INCOME_GROUPS).flat())];
  return all.find(c=>concept.includes(c))||"OTROS";
}
function incomeMonth(){
  return $('incomeStatementMonth')?.value||currentMonthValue();
}
function incomeExpenses(month){
  const movements=readJson(MOVEMENTS_KEY,[]);
  return movements.filter(m=>m.type==='gasto'&&m.status!=='pendiente'&&String(m.date||'').slice(0,7)===month);
}
function groupExpenseTotal(list,categories){
  return list.filter(m=>categories.includes(expenseCategoryForIncome(m))).reduce((s,m)=>s+num(m.amount),0);
}
function showIncomeDetail(key,title){
  const box=$('incomeStatementDetail');
  if(!box)return;
  const month=incomeMonth();
  const expenses=incomeExpenses(month);
  const cats=INCOME_GROUPS[key]||[];
  const rows=expenses
    .filter(m=>cats.includes(expenseCategoryForIncome(m)))
    .sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  const total=rows.reduce((s,m)=>s+num(m.amount),0);
  box.hidden=false;
  box.innerHTML=`<div class="income-detail-head"><h4>${esc(title)}</h4><button type="button" id="incomeDetailClose" class="secondary">Cerrar</button></div>
    ${rows.map(m=>`<div class="income-detail-row"><span>${new Date(String(m.date).slice(0,10)+'T12:00:00').toLocaleDateString('es-AR')}</span><strong>${esc(expenseCategoryForIncome(m))}</strong><span>${esc(m.concept||'')}</span><strong>${money(m.amount)}</strong></div>`).join('')||'<div style="padding:12px" class="muted">No hay movimientos para este grupo en el mes elegido.</div>'}
    <div class="income-detail-total"><span>Total ${esc(title)}</span><strong>${money(total)}</strong></div>`;
  $('incomeDetailClose')?.addEventListener('click',()=>box.hidden=true);
}
// V35.3.13 — Ajuste histórico excepcional del Estado de Resultados.
// Solo julio 2026: margen real antes de gastos acumulado del 01/07 al 23/07.
// No crea cierres, no modifica patrimonio y no toca Supabase.
const HISTORICAL_MARGIN_ADJUSTMENTS=Object.freeze({
  "2026-07":15418004
});
function historicalMarginAdjustment(month){
  return Number(HISTORICAL_MARGIN_ADJUSTMENTS[String(month||"")]||0);
}

function renderIncomeStatement(){
  const rowsBox=$('incomeStatementRows');
  if(!rowsBox)return;
  const month=incomeMonth();
  if($('incomeStatementMonth')&&!$('incomeStatementMonth').value)$('incomeStatementMonth').value=month;

  const monthClosings=closings.filter(r=>String(r.balance_date||'').slice(0,7)===month);
  // Definición acordada: suma mensual de "Resultado antes de gastos" de cada cierre diario.
  // Para julio 2026 se agrega, una sola vez, el margen histórico real 01/07–23/07.
  const closingMargin=monthClosings.reduce((s,r)=>s+num(r.result_before_expenses),0);
  const historicalAdjustment=historicalMarginAdjustment(month);
  const margin=closingMargin+historicalAdjustment;
  const expenses=incomeExpenses(month);
  const reparto=groupExpenseTotal(expenses,INCOME_GROUPS.reparto);
  const impuestos=groupExpenseTotal(expenses,INCOME_GROUPS.impuestos);
  const local=groupExpenseTotal(expenses,INCOME_GROUPS.local);
  const casa=groupExpenseTotal(expenses,INCOME_GROUPS.casa);
  const clean=margin-reparto-impuestos-local;
  const result=clean-casa;

  const meta=$('incomeStatementMeta');
  if(meta){
    const adjustmentText=historicalAdjustment
      ?` · Ajuste histórico 01/07–23/07: ${money(historicalAdjustment)}`
      :"";
    meta.textContent=`Balances registrados: ${monthClosings.length} día${monthClosings.length===1?'':'s'} · Gastos cargados: ${expenses.length}${adjustmentText}`;
  }

  rowsBox.innerHTML=`
    <div class="income-row major"><span>Margen total antes de gastos</span><strong class="${margin>=0?'positive':'negative'}">${money(margin)}</strong></div>
    <button type="button" class="income-row" data-income-detail="reparto"><span>− Gastos de reparto</span><strong>${money(reparto)}</strong></button>
    <button type="button" class="income-row" data-income-detail="impuestos"><span>− Impuestos</span><strong>${money(impuestos)}</strong></button>
    <button type="button" class="income-row" data-income-detail="local"><span>− Gastos del local</span><strong>${money(local)}</strong></button>
    <div class="income-row major clean"><span>Ganancia limpia</span><strong class="${clean>=0?'positive':'negative'}">${money(clean)}</strong></div>
    <button type="button" class="income-row" data-income-detail="casa"><span>− Gastos de casa</span><strong>${money(casa)}</strong></button>
    <div class="income-row final"><span>RESULTADO DEL PERÍODO</span><strong>${money(result)}</strong></div>`;

  const titles={reparto:'Gastos de reparto',impuestos:'Impuestos',local:'Gastos del local',casa:'Gastos de casa'};
  rowsBox.querySelectorAll('[data-income-detail]').forEach(btn=>{
    btn.addEventListener('click',()=>showIncomeDetail(btn.dataset.incomeDetail,titles[btn.dataset.incomeDetail]));
  });
  if($('incomeStatementDetail'))$('incomeStatementDetail').hidden=true;
}

async function refresh(preserveInput=false){await Promise.all([loadClosings(),loadCurrentAssets()]);const date=$('balanceDate')?.value||today();const saved=closings.find(r=>r.balance_date===date);let previous;if(preserveInput&&$('balancePrevious')?.value!=='')previous=num($('balancePrevious').value);else previous=saved?num(saved.previous_equity):previousEquity(date);current=calculations(date,previous,cachedAssets);if($('balancePrevious'))$('balancePrevious').value=String(current.previous_equity);if($('balanceNotes'))$('balanceNotes').value=saved?.notes||'';render();renderHistory();renderIncomeStatement()}
async function save(){
  if(!current)return;
  await loadCurrentAssets();
  current=calculations($('balanceDate').value,num($('balancePrevious').value),cachedAssets);
  const existing=closings.find(r=>r.balance_date===current.date);
  const record={id:existing?.id||uid(),balance_date:current.date,...current,notes:$('balanceNotes').value.trim(),created_at:existing?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()};delete record.date;
  try{if(cloud()){const {data,error}=await cloud().from(TABLE).upsert(record,{onConflict:'balance_date'}).select().single();if(error)throw error;Object.assign(record,data)}closings=closings.filter(r=>r.balance_date!==record.balance_date);closings.push(record);localWrite();renderHistory();renderIncomeStatement();alert('Cierre diario guardado correctamente.')}catch(e){alert('No se pudo guardar el cierre: '+(e.message||e))}
}
function balanceClientRows(){
  const getDetail=window.DonZoiloFinancialTotals?.clientAccountDetail;
  return typeof getDetail==='function'?(getDetail()||[]):[];
}
function balanceSupplierRows(){
  const getDetail=window.DonZoiloFinancialTotals?.supplierDebtDetail;
  return typeof getDetail==='function'?(getDetail()||[]).filter(r=>num(r.debt)>0.5).sort((a,b)=>num(b.debt)-num(a.debt)):[];
}
function balanceAssetSplit(){
  const cash=cachedAssets.filter(r=>r.asset_type==='cash').reduce((s,r)=>s+num(r.balance),0);
  // El resto de Caja y Activos se muestra junto a Bancos para conservar exactamente el total activo.
  const investments=cachedAssets.filter(r=>['investment','opening_investment'].includes(r.asset_type)).reduce((s,r)=>s+num(r.balance),0);
  const fixedAssets=cachedAssets.filter(r=>['fixed_asset','opening_fixed_asset'].includes(r.asset_type)).reduce((s,r)=>s+num(r.balance),0);
  return {cash,investments,fixedAssets,banks:Math.max(0,num(current.current_assets)-cash-investments-fixedAssets)};
}
function pdfDate(v){
  if(!v)return '';
  const m=String(v).slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?`${m[3]}/${m[2]}`:String(v);
}
function simplePdfBlob(){
  const W=595,H=842,M=18, sidebarW=180, gap=9, mainW=W-M*2-sidebarW-gap, colGap=7, colW=(mainW-colGap)/2;
  const clients=balanceClientRows();
  const suppliers=balanceSupplierRows();
  const assetSplit=balanceAssetSplit();
  const clean=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'').replace(/([\\()])/g,'\\$1');
  const fmt=n=>money(n).replace('$','$ ');
  const ops=[];
  const text=(x,y,t,size=7,bold=false)=>ops.push(`BT /F${bold?2:1} ${size.toFixed(2)} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${clean(t)}) Tj ET`);
  const line=(x1,y1,x2,y2,w=.45,dash=false)=>ops.push(`${w} w ${dash?'[2 2] 0 d':'[] 0 d'} ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  const box=(x,y,w,h,fill=false)=>{if(fill)ops.push(`0.94 g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`);ops.push(`0.55 w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`)};
  const rightText=(right,y,t,size=7,bold=false)=>{const approx=clean(t).length*size*.49;text(right-approx,y,t,size,bold)};
  const titleY=815;
  text(M,titleY,'DON ZOILO',16,true); text(M,titleY-13,'CARNES DE CONFIANZA',7,false);
  text(232,titleY,'BALANCE DIARIO',14,true); text(228,titleY-13,'TU NEGOCIO, EN UN SOLO VISTAZO',6,false);
  rightText(W-M,titleY,'FECHA DEL BALANCE: '+pdfDate(current.date),7,true);
  rightText(W-M,titleY-13,'GENERADO: '+new Date().toLocaleString('es-AR'),5.5,false);
  line(M,786,W-M,786,.8);
  text(M,772,'DETALLE CUENTAS CORRIENTES DE CLIENTES',8.5,true);

  const rowCount=r=>1+(Array.isArray(r.pending)?r.pending.length:0)+(Math.round(num(r.correctionPending||0))!==0?1:0)+(Math.abs(num(r.reconciliation||0))>=.5?1:0)+1;
  const weighted=clients.map(r=>({r,w:rowCount(r)}));
  let cols=[[],[]], sums=[0,0];
  weighted.forEach(o=>{const k=sums[0]<=sums[1]?0:1;cols[k].push(o.r);sums[k]+=o.w+1});
  const availableH=730-30;
  const maxUnits=Math.max(...sums,1);
  let fs=Math.min(7.0,Math.max(4.2,(availableH/(maxUnits*1.28))*.72));
  let lh=fs*1.34, headH=fs*2.05, pad=3.2;
  function clientHeight(r){return headH+pad*2+rowCount(r)*lh;}
  const totalHeights=cols.map(c=>c.reduce((s,r)=>s+clientHeight(r)+4,0));
  const scale=Math.min(1,availableH/Math.max(...totalHeights,1));
  if(scale<1){fs=Math.max(3.8,fs*scale);lh=fs*1.30;headH=fs*1.95;pad=2.4;}
  cols.forEach((col,ci)=>{
    let top=758, x=M+ci*(colW+colGap);
    col.forEach(r=>{
      const h=clientHeight(r), y=top-h;
      box(x,y,colW,h,false); box(x,y+h-headH,colW,headH,true);
      text(x+4,y+h-headH+fs*.55,String(r.client||'CLIENTE').toUpperCase(),fs+.5,true);
      let cy=y+h-headH-pad-lh*.78;
      const detail=[];
      const pending=Array.isArray(r.pending)?r.pending:[];
      pending.forEach(p=>{
        const remitoRaw=String(p.remito||'').trim();
        const remitoNum=remitoRaw.replace(/^remito\s*/i,'').trim();
        let doc=remitoNum?`Remito ${remitoNum}`:(p.invoice?`Factura ${p.invoice}`:'Comprobante pendiente');
        if(p.invoice&&remitoNum)doc=`Factura ${p.invoice} / Remito ${remitoNum}`;
        detail.push([pdfDate(p.date||p.created_at),doc,num(p.remaining)]);
      });
      if(Math.round(num(r.correctionPending||0))!==0)detail.push(['','Saldo anterior / regularizacion',num(r.correctionPending)]);
      const recon=num(r.reconciliation||0);if(Math.abs(recon)>=.5)detail.push(['',recon<0?'Saldo a favor / excedente':'Diferencia de cuenta',recon]);
      if(!pending.length&&num(r.balance)>0&&!detail.length)detail.push(['','Sin comprobantes individualizados',num(r.balance)]);
      detail.forEach(d=>{
        text(x+4,cy,(d[0]?d[0]+'  ':'')+d[1],fs,false);rightText(x+colW-4,cy,fmt(d[2]),fs,false);cy-=lh;
      });
      // V35.3.50: el renglón TOTAL queda limpio, sin línea punteada atravesándolo.
      text(x+4,cy,`TOTAL ${String(r.client||'').toUpperCase()}:`,fs+.15,true);rightText(x+colW-4,cy,fmt(r.balance),fs+.15,true);
      top=y-4;
    });
  });

  const sx=M+mainW+gap, sw=sidebarW;
  function panel(top,h,title){const y=top-h;box(sx,y,sw,h,false);text(sx+8,top-15,title,10,true);line(sx+7,top-21,sx+sw-7,top-21,.35);return {y,top};}
  let top=772;
  let p1=panel(top,205,'RESUMEN GENERAL');
  const metrics=[['CAJA',assetSplit.cash],['BANCOS Y OTROS CORRIENTES',assetSplit.banks],['INVERSIONES',assetSplit.investments],['BIENES DE USO',assetSplit.fixedAssets],['TOTAL CUENTAS CORRIENTES',current.client_accounts],['STOCK VALORIZADO',current.stock_value]];
  let yy=top-38;metrics.forEach(([lab,val])=>{text(sx+9,yy,lab,6.5,lab.startsWith('TOTAL'));rightText(sx+sw-9,yy,fmt(val),8,true);line(sx+8,yy-8,sx+sw-8,yy-8,.25,true);yy-=22;});
  box(sx+7,p1.y+9,sw-14,23,true);text(sx+11,p1.y+17,'TOTAL ACTIVOS',8,true);rightText(sx+sw-11,p1.y+17,fmt(current.total_assets),9,true);

  top=p1.y-9; const passH=Math.min(160,72+suppliers.length*14);let p2=panel(top,passH,'PASIVOS');yy=top-38;
  if(suppliers.length){suppliers.forEach(r=>{text(sx+9,yy,String(r.name).toUpperCase(),6.3,false);rightText(sx+sw-9,yy,fmt(r.debt),6.7,true);yy-=13;});}
  else {text(sx+9,yy,'Deudas con proveedores',6.5,false);rightText(sx+sw-9,yy,fmt(current.supplier_debt),7,true);yy-=14;}
  box(sx+7,p2.y+9,sw-14,22,true);text(sx+11,p2.y+16,'TOTAL PASIVOS',8,true);rightText(sx+sw-11,p2.y+16,fmt(current.total_liabilities),8.5,true);

  // V35.3.50: acumulado mensual del resultado hasta la fecha seleccionada.
  // Si ya existe un cierre para la fecha actual, se reemplaza por el cálculo visible
  // para evitar duplicarlo y para que el PDF coincida con lo que se ve en pantalla.
  const monthKey=String(current.date||'').slice(0,7);
  const monthlyAccumulated=closings
    .filter(r=>String(r.balance_date||'').slice(0,7)===monthKey && String(r.balance_date||'')<=String(current.date||'') && String(r.balance_date||'')!==String(current.date||''))
    .reduce((s,r)=>s+num(r.net_result),0)+num(current.net_result);

  top=p2.y-9;let p3=panel(top,171,'PATRIMONIO Y RESULTADO');yy=top-38;
  [['Patrimonio anterior',current.previous_equity],['PATRIMONIO FINAL',current.final_equity],['Resultado antes de gastos',current.result_before_expenses],['Gastos del dia',current.daily_expenses],['RESULTADO NETO',current.net_result]].forEach(([lab,val],i)=>{text(sx+9,yy,lab,6.6,i===1||i===4);rightText(sx+sw-9,yy,fmt(val),7.3,true);if(i<4)line(sx+8,yy-7,sx+sw-8,yy-7,.25,true);yy-=21;});
  text(sx+9,yy,'Variacion s/ patrimonio inicial',5.8,false);rightText(sx+sw-9,yy,pct(current.variation_pct),7,true);yy-=20;
  box(sx+7,p3.y+9,sw-14,22,true);text(sx+11,p3.y+16,'ACUMULADO MENSUAL',7.5,true);rightText(sx+sw-11,p3.y+16,fmt(monthlyAccumulated),8.2,true);

  top=p3.y-9;const obsH=Math.max(75,top-28);let p4=panel(top,obsH,'OBSERVACIONES');text(sx+9,top-38,$('balanceNotes').value.trim()||'-',6,false);
  line(M,20,W-M,20,.6);text(220,11,'MAS CONTROL, MAS POSIBILIDADES',5.5,false);

  const content=ops.join('\n');
  const objs=[];objs[1]='<< /Type /Catalog /Pages 2 0 R >>';objs[2]='<< /Type /Pages /Kids [5 0 R] /Count 1 >>';objs[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';objs[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';objs[5]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents 6 0 R >>';objs[6]=`<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  let pdf='%PDF-1.4\n',offsets=[0];for(let i=1;i<=6;i++){offsets[i]=pdf.length;pdf+=`${i} 0 obj\n${objs[i]}\nendobj\n`;}const xref=pdf.length;pdf+='xref\n0 7\n0000000000 65535 f \n';for(let i=1;i<=6;i++)pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';pdf+=`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf],{type:'application/pdf'});
}
function pdfFile(){return new File([simplePdfBlob()],`Balance_Don_Zoilo_${current.date}.pdf`,{type:'application/pdf'})}
function downloadPdf(){const file=pdfFile();const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
async function sharePdf(){const file=pdfFile();try{if(navigator.canShare?.({files:[file]})&&navigator.share){await navigator.share({title:'Balance diario Don Zoilo',text:`Balance diario ${current.date}`,files:[file]})}else{downloadPdf();alert('Se descargó el PDF. Abrilo desde Descargas y compartilo por WhatsApp.')}}catch(e){if(e.name!=='AbortError')alert('No se pudo compartir: '+e.message)} }
function bind(){$('balanceDate').value=today();$('balanceDate').addEventListener('change',()=>refresh(false));$('balancePrevious').addEventListener('input',()=>{current=calculations($('balanceDate').value,num($('balancePrevious').value),cachedAssets);render()});$('balanceRefresh').addEventListener('click',()=>refresh(true));$('balanceSave').addEventListener('click',save);$('balancePdf').addEventListener('click',downloadPdf);$('balanceShare').addEventListener('click',sharePdf)}
async function init(){injectStyles();injectUI();
setTimeout(()=>{
  $('balanceMonthFilter')?.addEventListener('change',renderHistory);
  if($('incomeStatementMonth'))$('incomeStatementMonth').value=currentMonthValue();
  $('incomeStatementMonth')?.addEventListener('change',renderIncomeStatement);
},0);bind();window.addEventListener('donzoilo:remote-change',e=>{if(e.detail?.table==='current_assets')refresh(true)});window.addEventListener('donzoilo:app-visible',()=>refresh(true));await refresh(false)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
