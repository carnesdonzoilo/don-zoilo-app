
(async function clearOldAppCache(){
  try{
    if("serviceWorker" in navigator){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if("caches" in window){
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  }catch(e){ console.warn("No se pudo limpiar caché anterior", e); }
})();


const STORAGE_KEY = "don_zoilo_movements_v1";
const CONFIG_KEY = "don_zoilo_supabase_config";

let movements = [];
let orders = [];
let productPrices = {};
let supabaseClient = null;
let deferredPrompt = null;

const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat("es-AR", {style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(n || 0));
const fmtDate = (s) => s ? new Date(s + "T12:00:00").toLocaleDateString("es-AR") : "";
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);

function todayISO(){
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}
function monthStart(){
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
}

const ORDERS_STORAGE_KEY = "don_zoilo_orders_v1";
const PRICES_STORAGE_KEY = "don_zoilo_product_prices_v1";
function localLoad(){
  movements = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  orders = JSON.parse(localStorage.getItem(ORDERS_STORAGE_KEY) || "[]");
  productPrices = JSON.parse(localStorage.getItem(PRICES_STORAGE_KEY) || "{}");
}
function localSave(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(movements));
  localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(orders));
  localStorage.setItem(PRICES_STORAGE_KEY, JSON.stringify(productPrices));
}

async function initCloud(){
  const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
  if(!cfg?.url || !cfg?.key || !window.supabase) return false;
  try{
    supabaseClient = window.supabase.createClient(cfg.url, cfg.key);
    const {data, error} = await supabaseClient
      .from("movements")
      .select("*")
      .order("date", {ascending:false})
      .order("created_at", {ascending:false});
    if(error) throw error;
    movements = data || [];
    const {data: orderData, error: orderError} = await supabaseClient
      .from("orders").select("*")
      .order("delivery_date", {ascending:false})
      .order("created_at", {ascending:false});
    if(orderError) throw orderError;
    orders = orderData || [];

    const {data: priceData, error: priceError} = await supabaseClient
      .from("product_prices")
      .select("*");
    if(priceError) throw priceError;
    productPrices = {};
    (priceData || []).forEach(row => productPrices[row.product_key] = Number(row.last_price || 0));

    $("syncLabel").textContent = "Sincronización online activa";
    $("syncDetail").textContent = "Los movimientos se comparten entre dispositivos.";
    $("openConfig").textContent = "Cambiar configuración";
    return true;
  }catch(err){
    console.error(err);
    $("syncLabel").textContent = "No se pudo conectar";
    $("syncDetail").textContent = "Se continúa en modo local. Revisá la configuración.";
    return false;
  }
}

async function addMovement(item){
  if(supabaseClient){
    const {data, error} = await supabaseClient.from("movements").insert(item).select().single();
    if(error) throw error;
    movements.unshift(data);
  }else{
    movements.unshift(item);
    localSave();
  }
}

async function removeMovement(id){
  if(!confirm("¿Eliminar este movimiento?")) return;
  if(supabaseClient){
    const {error} = await supabaseClient.from("movements").delete().eq("id", id);
    if(error) return alert("No se pudo eliminar: " + error.message);
  }
  movements = movements.filter(m => m.id !== id);
  localSave();
  renderAll();
}


async function addOrder(order){
  if(supabaseClient){
    const {data,error}=await supabaseClient.from("orders").insert(order).select().single();
    if(error) throw error;
    orders.unshift(data);
  }else{ orders.unshift(order); localSave(); }
}

async function toggleDelivered(order, delivered){
  if(supabaseClient){
    if(delivered){
      const rows=[{
        id:uid(),date:order.delivery_date,type:"venta",party:order.client,concept:order.product,
        kg:Number(order.quantity||0),amount:Number(order.total||0),payment_method:order.payment_method,
        status:"confirmado",notes:`Pedido entregado ${order.id}`,source_order_id:order.id,
        created_at:new Date().toISOString()
      }];
      if(["efectivo","transferencia"].includes(order.payment_method)){
        rows.push({
          id:uid(),date:order.delivery_date,type:"cobro",party:order.client,
          concept:`Cobro ${order.product}`,kg:0,amount:Number(order.total||0),
          payment_method:order.payment_method,status:"confirmado",
          notes:`Cobro automático ${order.id}`,source_order_id:order.id,created_at:new Date().toISOString()
        });
      }
      const {data:ins,error:me}=await supabaseClient.from("movements").insert(rows).select();
      if(me) throw me;
      movements=[...(ins||[]),...movements];
    }else{
      const {error:de}=await supabaseClient.from("movements").delete().eq("source_order_id",order.id);
      if(de) throw de;
      movements=movements.filter(m=>m.source_order_id!==order.id);
    }
    const {data:upd,error:oe}=await supabaseClient.from("orders")
      .update({delivered,delivered_at:delivered?new Date().toISOString():null})
      .eq("id",order.id).select().single();
    if(oe) throw oe;
    orders=orders.map(o=>o.id===order.id?upd:o);
  }else{
    if(delivered){
      movements.unshift({
        id:uid(),date:order.delivery_date,type:"venta",party:order.client,concept:order.product,
        kg:Number(order.quantity||0),amount:Number(order.total||0),payment_method:order.payment_method,
        status:"confirmado",notes:`Pedido entregado ${order.id}`,source_order_id:order.id,
        created_at:new Date().toISOString()
      });
      if(["efectivo","transferencia"].includes(order.payment_method)){
        movements.unshift({
          id:uid(),date:order.delivery_date,type:"cobro",party:order.client,concept:`Cobro ${order.product}`,
          kg:0,amount:Number(order.total||0),payment_method:order.payment_method,status:"confirmado",
          notes:`Cobro automático ${order.id}`,source_order_id:order.id,created_at:new Date().toISOString()
        });
      }
    }else movements=movements.filter(m=>m.source_order_id!==order.id);
    orders=orders.map(o=>o.id===order.id?{...o,delivered,delivered_at:delivered?new Date().toISOString():null}:o);
    localSave();
  }
}


async function deleteOrderGroup(items){
  if(!items?.length) return;
  const client=items[0].client||"este cliente";
  const delivered=items.some(x=>x.delivered);
  const message=delivered
    ? `Este pedido de ${client} está entregado. Al eliminarlo también se revertirán la venta y la cuenta corriente. ¿Continuar?`
    : `¿Eliminar por completo el pedido de ${client}?`;
  if(!confirm(message)) return;

  try{
    if(delivered){
      for(const item of items){
        if(item.delivered) await toggleDelivered(item,false);
      }
    }

    const ids=items.map(x=>x.id);
    if(supabaseClient){
      const {error}=await supabaseClient.from("orders").delete().in("id",ids);
      if(error) throw error;
    }
    orders=orders.filter(o=>!ids.includes(o.id));
    localSave();
    renderAll();
  }catch(e){
    alert("No se pudo eliminar el pedido: "+e.message);
  }
}


async function saveEditedOrderGroup(items, card){
  if(items.some(x=>x.delivered)){
    alert("Primero desmarcá Entregado para modificar el pedido.");
    return;
  }

  const client=card.querySelector(".edit-client").value.trim();
  const payment=card.querySelector(".edit-payment").value;
  const rows=[...card.querySelectorAll(".edit-item-row")];

  try{
    for(let i=0;i<items.length;i++){
      const controls=rows[i].querySelectorAll("input,select");
      const quantity=Number(controls[0].value||0);
      const unit=controls[1].value;
      const product=controls[2].value.trim();
      const unit_price=Number(controls[3].value||0);
      const changes={client,payment_method:payment,quantity,unit,product,unit_price,total:quantity*unit_price};
      await rememberProductPrice(product,unit_price);

      if(supabaseClient){
        const {data,error}=await supabaseClient.from("orders").update(changes).eq("id",items[i].id).select().single();
        if(error) throw error;
        orders=orders.map(o=>o.id===items[i].id?data:o);
      }else{
        orders=orders.map(o=>o.id===items[i].id?{...o,...changes}:o);
      }
    }
    localSave();
    renderAll();
  }catch(e){
    alert("No se pudo modificar el pedido: "+e.message);
  }
}

function renderOrders(){
  const date=$("ordersFilterDate")?.value;
  const filtered=orders.filter(o=>!date||o.delivery_date===date);

  const groups=new Map();
  filtered.forEach(o=>{
    const key=o.batch_id||o.id;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(o);
  });

  const grouped=[...groups.entries()].sort((a,b)=>{
    const ad=a[1].every(x=>x.delivered), bd=b[1].every(x=>x.delivered);
    return (ad-bd)||String(a[1][0].client).localeCompare(String(b[1][0].client));
  });

  const box=$("ordersList"); if(!box) return; box.innerHTML="";
  if(!grouped.length) box.append($("emptyTemplate").content.cloneNode(true));

  grouped.forEach(([batchId,items])=>{
    const first=items[0];
    const allDelivered=items.every(x=>x.delivered);
    const total=items.reduce((a,x)=>a+Number(x.total||0),0);
    const card=document.createElement("div");
    card.className="order-group"+(allDelivered?" delivered":"");

    card.innerHTML=`
      <div class="order-group-head">
        <div>
          <div class="order-client">${escapeHtml(first.client)}</div>
          <div class="order-info">${fmtDate(first.delivery_date)} · ${escapeHtml((first.payment_method||"").replace("_"," "))}</div>
        </div>
        <label class="delivery-check"><input type="checkbox" ${allDelivered?"checked":""}>Entregado</label>
      </div>

      <div class="group-items">
        ${items.map(o=>`
          <div class="group-item">
            <div><strong>${escapeHtml(o.product)}</strong><div class="order-info">${Number(o.quantity||0).toLocaleString("es-AR")} ${escapeHtml(o.unit||"kg")} × ${money(o.unit_price||0)}</div></div>
            <strong>${money(o.total||0)}</strong>
          </div>`).join("")}
      </div>

      <div class="group-total">
        <span class="order-status ${allDelivered?"done":"pending"}">${allDelivered?"Entregado y contabilizado":"Pendiente"}</span>
        <strong>${money(total)}</strong>
      </div>

      <div class="group-footer">
        <button type="button" class="generate-remito-btn">🧾 Generar remito</button>
        <button type="button" class="edit-order-btn">✏️ Editar pedido</button>
        <button type="button" class="delete-order-btn">🗑 Eliminar pedido</button>
      </div>

      <div class="edit-group hidden">
        <div class="edit-client-row">
          <label>Cliente<input class="edit-client" value="${escapeHtml(first.client)}"></label>
          <label>Forma de cobro
            <select class="edit-payment">
              ${["cuenta_corriente","efectivo","transferencia"].map(p=>`<option value="${p}" ${p===first.payment_method?"selected":""}>${p.replace("_"," ")}</option>`).join("")}
            </select>
          </label>
        </div>
        ${items.map(o=>`
          <div class="edit-item-row">
            <input type="number" step="0.01" min="0" value="${Number(o.quantity||0)}">
            <select>${["kg","piezas","caja","gancho","unidad"].map(u=>`<option value="${u}" ${u===(o.unit||"kg")?"selected":""}>${u}</option>`).join("")}</select>
            <input value="${escapeHtml(o.product)}">
            <input type="number" step="0.01" min="0" value="${Number(o.unit_price||0)}">
          </div>`).join("")}
        <div class="group-footer">
          <button type="button" class="cancel-edit-btn">Cancelar</button>
          <button type="button" class="save-edit-btn">Guardar cambios</button>
        </div>
      </div>`;

    const check=card.querySelector('input[type="checkbox"]');
    check.addEventListener("change",async()=>{
      check.disabled=true;
      const target=check.checked;
      try{
        for(const item of items){
          if(Boolean(item.delivered)!==target) await toggleDelivered(item,target);
        }
        renderAll();
      }catch(e){
        check.checked=!target;
        alert("No se pudo actualizar: "+e.message);
      }finally{check.disabled=false}
    });

    card.querySelector(".generate-remito-btn").addEventListener("click",()=>openRemito(items));

    const editArea=card.querySelector(".edit-group");
    card.querySelector(".edit-order-btn").addEventListener("click",()=>{
      if(allDelivered) return alert("Primero desmarcá Entregado para modificar el pedido.");
      editArea.classList.toggle("hidden");
    });
    card.querySelector(".cancel-edit-btn").addEventListener("click",()=>editArea.classList.add("hidden"));
    card.querySelector(".save-edit-btn").addEventListener("click",()=>saveEditedOrderGroup(items,card));

    const deleteBtn=card.querySelector(".delete-order-btn");
    deleteBtn.addEventListener("click",async()=>{
      deleteBtn.disabled=true;
      await deleteOrderGroup(items);
      deleteBtn.disabled=false;
    });

    box.append(card);
  });
}


function signedAmount(m){
  if(["venta","cobro","ajuste"].includes(m.type)) return Number(m.amount || 0);
  return -Number(m.amount || 0);
}

function movementCard(m){
  const div = document.createElement("div");
  div.className = "movement";
  const signClass = signedAmount(m) >= 0 ? "positive" : "negative";
  div.innerHTML = `
    <div><span class="badge">${m.type.replace("_"," ")}</span><div class="movement-meta">${fmtDate(m.date)}</div></div>
    <div>
      <div class="movement-title">${escapeHtml(m.party || "Sin nombre")} · ${escapeHtml(m.concept || "")}</div>
      <div class="movement-meta">${m.kg ? `${Number(m.kg).toLocaleString("es-AR")} kg · ` : ""}${escapeHtml(m.payment_method || "")} · ${escapeHtml(m.status || "")}</div>
    </div>
    <div class="amount ${signClass}">${money(m.amount)}</div>
    <button class="delete-btn" title="Eliminar">✕</button>
  `;
  div.querySelector(".delete-btn").addEventListener("click", () => removeMovement(m.id));
  return div;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

function filteredByDates(){
  const from = $("dateFrom").value;
  const to = $("dateTo").value;
  return movements.filter(m => (!from || m.date >= from) && (!to || m.date <= to));
}

function renderHomePanel(){
  const today=todayISO(), todayOrders=orders.filter(o=>o.delivery_date===today), groups=new Map();
  todayOrders.forEach(o=>{const k=o.batch_id||o.id;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(o)});
  const grouped=[...groups.values()], total=grouped.length, delivered=grouped.filter(g=>g.every(x=>x.delivered)).length, pending=total-delivered;
  const kg=todayOrders.filter(o=>(o.unit||'kg')==='kg').reduce((s,o)=>s+Number(o.quantity||0),0), billing=todayOrders.reduce((s,o)=>s+Number(o.total||0),0);
  const receivable=movements.filter(m=>m.status!=='pendiente').reduce((s,m)=>m.type==='venta'?s+Number(m.amount||0):m.type==='cobro'?s-Number(m.amount||0):s,0);
  $('homeOrders').textContent=total;$('homePending').textContent=pending;$('homeDelivered').textContent=delivered;$('homeKg').textContent=kg.toLocaleString('es-AR')+' kg';$('homeBilling').textContent=money(billing);$('homeReceivable').textContent=money(Math.max(receivable,0));
  const pct=total?Math.round(delivered/total*100):0;$('homeProgressPercent').textContent=pct+'%';$('homeProgressBar').style.width=pct+'%';$('homeProgressText').textContent=total?`${delivered} entregados de ${total} pedidos.`:'Sin pedidos cargados para hoy.';
  const d=new Date(today+'T12:00:00');$('homeDate').textContent=d.toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long',year:'numeric'});$('homeGreeting').textContent=new Date().getHours()<12?'Buenos días':'Resumen del día';
  const alerts=$('homeAlerts');alerts.innerHTML='';const a=[];if(!total)a.push(['warning','No hay pedidos para hoy','Podés cargarlos desde el botón superior.']);else if(pending)a.push(['warning',pending+' pedidos pendientes','Todavía no fueron marcados como entregados.']);else a.push(['good','Reparto completo','Todos los pedidos de hoy están entregados.']);
  const noPrice=todayOrders.filter(o=>Number(o.unit_price||0)<=0).length;if(noPrice)a.push(['warning',noPrice+' productos sin precio','Revisalos antes de generar remitos.']);if(receivable>0)a.push(['warning','Saldo pendiente de cobro',money(receivable)]);
  a.forEach(x=>{const div=document.createElement('div');div.className='alert-item '+x[0];div.innerHTML=`<strong>${escapeHtml(x[1])}</strong><div class="muted small">${escapeHtml(x[2])}</div>`;alerts.append(div)});
}

function renderDashboard(){
  const list = filteredByDates();
  const sum = (type) => list.filter(m=>m.type===type && m.status!=="pendiente").reduce((a,m)=>a+Number(m.amount||0),0);
  const sales=sum("venta"), collections=sum("cobro"), purchases=sum("compra"), payments=sum("pago"), expenses=sum("gasto"), adjustments=sum("ajuste");
  $("salesTotal").textContent=money(sales);
  $("collectionsTotal").textContent=money(collections);
  $("purchasesTotal").textContent=money(purchases);
  $("outTotal").textContent=money(payments+expenses);
  $("cashResult").textContent=money(collections-payments-expenses+adjustments);
  $("kgTotal").textContent=list.filter(m=>m.type==="venta").reduce((a,m)=>a+Number(m.kg||0),0).toLocaleString("es-AR")+" kg";

  const box=$("recentList"); box.innerHTML="";
  if(!list.length) box.append($("emptyTemplate").content.cloneNode(true));
  list.slice(0,8).forEach(m=>box.append(movementCard(m)));
}

function renderMovements(){
  const q=$("searchText").value.trim().toLowerCase();
  const t=$("filterType").value;
  const list=movements.filter(m=>{
    const hay=`${m.party||""} ${m.concept||""} ${m.notes||""}`.toLowerCase();
    return (!q || hay.includes(q)) && (!t || m.type===t);
  });
  const box=$("allList"); box.innerHTML="";
  if(!list.length) box.append($("emptyTemplate").content.cloneNode(true));
  list.forEach(m=>box.append(movementCard(m)));
}

function renderBalances(){
  const map=new Map();
  movements.filter(m=>m.status!=="pendiente").forEach(m=>{
    const name=(m.party||"Sin nombre").trim();
    if(!map.has(name)) map.set(name,{client:0,supplier:0});
    const b=map.get(name);
    if(m.type==="venta") b.client+=Number(m.amount||0);
    if(m.type==="cobro") b.client-=Number(m.amount||0);
    if(m.type==="compra") b.supplier+=Number(m.amount||0);
    if(m.type==="pago") b.supplier-=Number(m.amount||0);
  });
  const rows=[...map.entries()]
    .map(([name,b])=>({name, balance:b.client!==0?b.client:-b.supplier, detail:b.client!==0?"Saldo cliente":"Saldo proveedor"}))
    .filter(x=>x.balance!==0)
    .sort((a,b)=>Math.abs(b.balance)-Math.abs(a.balance));
  const box=$("balanceList"); box.innerHTML="";
  if(!rows.length) box.append($("emptyTemplate").content.cloneNode(true));
  rows.forEach(r=>{
    const div=document.createElement("div");
    div.className="balance-row";
    div.innerHTML=`<div><strong>${escapeHtml(r.name)}</strong><div class="muted small">${r.detail}</div></div><strong class="${r.balance>=0?"positive":"negative"}">${money(Math.abs(r.balance))}</strong>`;
    box.append(div);
  });
}

function renderAll(){ renderHomePanel(); renderDashboard(); renderOrders(); renderMovements(); renderBalances(); }

function exportCSV(){
  const cols=["date","type","party","concept","kg","amount","payment_method","status","notes"];
  const esc=v=>`"${String(v??"").replaceAll('"','""')}"`;
  const csv=[cols.join(","),...movements.map(m=>cols.map(c=>esc(m[c])).join(","))].join("\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`don-zoilo-movimientos-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  btn.classList.add("active");
  $(btn.dataset.view).classList.add("active");
}));

$("movementForm").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const item={
    id:uid(),
    date:$("movementDate").value,
    type:$("movementType").value,
    party:$("party").value.trim(),
    concept:$("concept").value.trim(),
    kg:Number($("kg").value||0),
    amount:Number($("amount").value||0),
    payment_method:$("paymentMethod").value,
    status:$("status").value,
    notes:$("notes").value.trim(),
    created_at:new Date().toISOString()
  };
  try{
    await addMovement(item);
    e.target.reset();
    $("movementDate").value=todayISO();
  $("orderDate").value=todayISO();
  $("importOrderDate").value=todayISO();
  $("ordersFilterDate").value=todayISO();
    renderAll();
    document.querySelector('[data-view="dashboard"]').click();
  }catch(err){
    alert("No se pudo guardar: "+err.message);
  }
});

$("searchText").addEventListener("input",renderMovements);
$("filterType").addEventListener("change",renderMovements);
$("applyDates").addEventListener("click",renderDashboard);
$("exportCsv").addEventListener("click",exportCSV);
$("openConfig").addEventListener("click",()=>{
  const cfg=JSON.parse(localStorage.getItem(CONFIG_KEY)||"null");
  $("supabaseUrl").value=cfg?.url||"";
  $("supabaseKey").value=cfg?.key||"";
  $("configDialog").showModal();
});
$("saveConfig").addEventListener("click",()=>{
  localStorage.setItem(CONFIG_KEY,JSON.stringify({url:$("supabaseUrl").value.trim(),key:$("supabaseKey").value.trim()}));
  location.reload();
});



let parsedImportGroups=[];


function productKey(name){
  return normalizeProductName(String(name||""))
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9\s]/g,"")
    .replace(/\s+/g," ")
    .trim();
}

function suggestedPrice(product){
  return Number(productPrices[productKey(product)] || 0);
}

async function rememberProductPrice(product, price){
  const key=productKey(product);
  const value=Number(price||0);
  if(!key || value<=0) return;

  productPrices[key]=value;
  localSave();

  if(supabaseClient){
    const {error}=await supabaseClient.from("product_prices").upsert({
      product_key:key,
      product_name:normalizeProductName(product),
      last_price:value,
      updated_at:new Date().toISOString()
    },{onConflict:"product_key"});
    if(error) console.warn("No se pudo guardar precio sugerido",error);
  }
}

function normalizeProductName(text){
  return text
    .replace(/\bozobuco\b/gi,"osobuco")
    .replace(/\bbondiolas?\b/gi,"bondiola")
    .replace(/\bpalomitas?\b/gi,"palomita")
    .replace(/\s+/g," ")
    .trim();
}

function inferUnit(product, explicitUnit){
  if(explicitUnit) return explicitUnit;
  const pieceProducts=["bondiola","nalga","vacío","vacio","lomo","roastbeef","roast beef","palomita","peceto","mondongo","pollo","bife","tapa asado","tapa de asado"];
  const p=product.toLowerCase();
  return pieceProducts.some(x=>p.includes(x))?"piezas":"kg";
}

function parseQuantity(raw){
  raw=raw.trim().replace(",",".");
  if(raw.includes("/")){
    const [a,b]=raw.split("/").map(Number);
    if(b) return a/b;
  }
  return Number(raw);
}


function isProductLine(line){
  return /^[-•]?\s*(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+)\s*(kg|kilos?|k|piezas?|pz|unidades?|un|cajas?|cajones?|c|ganchos?|g)?\s+.+$/i.test(line.trim());
}

function parseProductLine(original){
  let line=original.replace(/^[-•]\s*/,"").trim();
  const match=line.match(/^(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+)\s*(kg|kilos?|k|piezas?|pz|unidades?|un|cajas?|cajones?|c|ganchos?|g)?\s+(.+)$/i);
  if(!match) return null;

  const quantity=parseQuantity(match[1].replace(/\s/g,""));
  const unitToken=(match[2]||"").toLowerCase();
  const product=normalizeProductName(match[3]);

  const unitMap={
    kg:"kg",k:"kg",kilo:"kg",kilos:"kg",
    pieza:"piezas",piezas:"piezas",pz:"piezas",
    unidad:"unidad",unidades:"unidad",un:"unidad",
    caja:"caja",cajas:"caja",cajon:"caja",cajones:"caja",c:"caja",
    gancho:"gancho",ganchos:"gancho",g:"gancho"
  };

  return {
    quantity,
    unit:inferUnit(product,unitMap[unitToken]),
    product,
    unit_price:suggestedPrice(product)
  };
}

function parseOrderText(raw){
  const lines=raw.split(/\r?\n/).map(x=>x.trim());
  const groups=[];
  let current=null;

  for(const rawLine of lines){
    const line=rawLine.trim();
    if(!line) continue;

    if(isProductLine(line)){
      if(!current) throw new Error("El texto debe comenzar con el nombre del cliente.");
      const item=parseProductLine(line);
      if(item) current.items.push(item);
    }else{
      if(current && current.items.length) groups.push(current);
      current={client:line.replace(/:$/,"").trim().toUpperCase(),items:[]};
    }
  }

  if(current && current.items.length) groups.push(current);
  if(!groups.length) throw new Error("No pude reconocer pedidos. Poné el cliente en una línea y sus productos debajo.");
  return groups;
}

function groupTotal(group){
  return group.items.reduce((sum,item)=>sum+Number(item.quantity||0)*Number(item.unit_price||0),0);
}


function updatePreviewGroupTotal(section, group){
  const totalNode=section.querySelector(".preview-total strong");
  if(totalNode) totalNode.textContent=money(groupTotal(group));
}

function renderImportPreview(){
  const box=$("previewItems");
  box.innerHTML="";

  parsedImportGroups.forEach((group,gIndex)=>{
    const section=document.createElement("div");
    section.className="preview-client-group";
    section.innerHTML=`
      <div class="preview-client-title">${escapeHtml(group.client)}</div>
      <div class="preview-labels"><span>Cantidad</span><span>Unidad</span><span>Producto</span><span>Precio</span><span></span></div>`;

    group.items.forEach((item,iIndex)=>{
      const row=document.createElement("div");
      row.className="preview-row-v8";
      row.innerHTML=`
        <input type="number" step="0.01" min="0" value="${item.quantity}">
        <select>${["kg","piezas","caja","gancho","unidad"].map(u=>`<option value="${u}" ${u===item.unit?"selected":""}>${u}</option>`).join("")}</select>
        <input value="${escapeHtml(item.product)}">
        <input type="number" step="0.01" min="0" value="${item.unit_price||0}" title="${item.unit_price ? "Último precio usado" : "Sin precio anterior"}">
        <button class="remove-preview" type="button">✕</button>`;

      const inputs=row.querySelectorAll("input,select");
      const qtyInput=inputs[0];
      const unitSelect=inputs[1];
      const productInput=inputs[2];
      const priceInput=inputs[3];

      qtyInput.addEventListener("input",()=>{
        item.quantity=Number(qtyInput.value||0);
        updatePreviewGroupTotal(section,group);
      });

      unitSelect.addEventListener("change",()=>{
        item.unit=unitSelect.value;
      });

      productInput.addEventListener("input",()=>{
        item.product=productInput.value;
      });

      priceInput.addEventListener("input",()=>{
        item.unit_price=Number(priceInput.value||0);
        updatePreviewGroupTotal(section,group);
      });

      row.querySelector("button").addEventListener("click",()=>{
        group.items.splice(iIndex,1);
        if(!group.items.length) parsedImportGroups.splice(gIndex,1);
        renderImportPreview();
      });

      section.append(row);
    });

    const total=document.createElement("div");
    total.className="preview-total";
    total.innerHTML=`<span>Total ${escapeHtml(group.client)}</span><strong>${money(groupTotal(group))}</strong>`;
    section.append(total);
    box.append(section);
  });

  $("previewClient").textContent=`${parsedImportGroups.length} pedido${parsedImportGroups.length===1?"":"s"}`;
}

$("parseOrderBtn").addEventListener("click",()=>{
  try{
    parsedImportGroups=parseOrderText($("rawOrderText").value);
    $("importPreview").classList.remove("hidden");
    renderImportPreview();
  }catch(e){alert(e.message)}
});

$("saveImportedOrder").addEventListener("click",async()=>{
  if(!parsedImportGroups.length) return alert("No hay pedidos para guardar.");
  const deliveryDate=$("importOrderDate").value;
  const payment=$("importPayment").value;

  try{
    for(const group of parsedImportGroups){
      const batchId=uid();
      for(const item of group.items){
        await addOrder({
          id:uid(),batch_id:batchId,delivery_date:deliveryDate,client:group.client,
          product:item.product,quantity:Number(item.quantity||0),unit:item.unit,
          unit_price:Number(item.unit_price||0),
          total:Number(item.quantity||0)*Number(item.unit_price||0),
          payment_method:payment,notes:"Importado desde texto",
          delivered:false,delivered_at:null,created_at:new Date().toISOString()
        });
        await rememberProductPrice(item.product,item.unit_price);
      }
    }

    const count=parsedImportGroups.length;
    $("rawOrderText").value="";
    parsedImportGroups=[];
    $("importPreview").classList.add("hidden");
    $("ordersFilterDate").value=deliveryDate;
    renderAll();
    alert(`${count} pedido${count===1?"":"s"} guardado${count===1?"":"s"} correctamente.`);
  }catch(e){alert("No se pudo guardar: "+e.message)}
});



$("orderProduct").addEventListener("input",()=>{
  const price=suggestedPrice($("orderProduct").value);
  if(price>0 && (!$("orderUnitPrice").value || Number($("orderUnitPrice").value)===0)){
    $("orderUnitPrice").value=price;
    updateOrderPreview();
  }
});

function updateOrderPreview(){
  $("orderTotalPreview").textContent=money(Number($("orderQty").value||0)*Number($("orderUnitPrice").value||0));
}
$("orderQty").addEventListener("input",updateOrderPreview);
$("orderUnitPrice").addEventListener("input",updateOrderPreview);
$("ordersFilterDate").addEventListener("change",renderOrders);
$("orderForm").addEventListener("submit",async e=>{
  e.preventDefault();
  const quantity=Number($("orderQty").value||0), unit_price=Number($("orderUnitPrice").value||0);
  const order={
    id:uid(),delivery_date:$("orderDate").value,client:$("orderClient").value.trim(),
    product:$("orderProduct").value.trim(),quantity,unit:$("orderUnit").value,unit_price,total:quantity*unit_price,
    payment_method:$("orderPayment").value,notes:$("orderNotes").value.trim(),
    batch_id:uid(),delivered:false,delivered_at:null,created_at:new Date().toISOString()
  };
  try{
    await addOrder(order);
    await rememberProductPrice(order.product,order.unit_price);
    e.target.reset(); $("orderDate").value=todayISO();
    $("ordersFilterDate").value=todayISO(); updateOrderPreview(); renderAll();
  }catch(err){alert("No se pudo guardar: "+err.message)}
});



let currentRemitoItems=[];

function remitoSequence(items){
  const raw=(items?.[0]?.batch_id || items?.[0]?.id || "").replace(/[^a-zA-Z0-9]/g,"");
  return raw ? raw.slice(-8).toUpperCase() : "—";
}

function openRemito(items){
  if(!items?.length) return;
  currentRemitoItems=items;
  const first=items[0];
  const total=items.reduce((sum,item)=>sum+Number(item.total||0),0);

  $("remitoNumber").textContent=`N.º ${remitoSequence(items)}`;
  $("remitoDate").textContent=fmtDate(first.delivery_date);
  $("remitoClient").textContent=first.client||"";
  $("remitoPayment").textContent=(first.payment_method||"").replace("_"," ");
  $("remitoStatus").textContent=items.every(i=>i.delivered)?"ENTREGADO":"PENDIENTE";
  $("remitoTotal").textContent=money(total);

  const notes=[...new Set(items.map(i=>i.notes).filter(Boolean))];
  $("remitoNotes").textContent=notes.join(" · ") || "—";

  const tbody=$("remitoItems");
  tbody.innerHTML="";
  items.forEach(item=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${Number(item.quantity||0).toLocaleString("es-AR")}</td>
      <td>${escapeHtml(item.unit||"kg")}</td>
      <td>${escapeHtml(item.product||"")}</td>
      <td>${money(item.unit_price||0)}</td>
      <td>${money(item.total||0)}</td>`;
    tbody.append(tr);
  });

  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));
  document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));
  $("remitoView").classList.add("active");
  window.scrollTo({top:0,behavior:"smooth"});
}

$("backFromRemito").addEventListener("click",()=>{
  document.querySelector('[data-view="orders"]').click();
});

$("printRemito").addEventListener("click",()=>{
  if(!currentRemitoItems?.length){
    alert("No hay datos para generar el remito.");
    return;
  }

  const first=currentRemitoItems[0];
  const total=currentRemitoItems.reduce((sum,item)=>sum+Number(item.total||0),0);
  const notes=[...new Set(currentRemitoItems.map(i=>i.notes).filter(Boolean))].join(" · ") || "—";
  const remitoNo=remitoSequence(currentRemitoItems);

  const rows=currentRemitoItems.map(item=>`
    <tr>
      <td>${Number(item.quantity||0).toLocaleString("es-AR")}</td>
      <td>${escapeHtml(item.unit||"kg")}</td>
      <td>${escapeHtml(item.product||"")}</td>
      <td>${money(item.unit_price||0)}</td>
      <td>${money(item.total||0)}</td>
    </tr>`).join("");

  const remitoBody=(copyLabel)=>`
    <section class="ticket">
      <div class="header">
        <div>
          <div class="logo">DON ZOILO</div>
          <div class="tag">CARNES · CALIDAD · SERVICIO</div>
        </div>
        <div class="title">
          <div class="copy">${copyLabel}</div>
          <h1>REMITO</h1>
          <div class="number">N.º ${remitoNo}</div>
        </div>
      </div>

      <div class="info">
        <div><span>Fecha</span><strong>${fmtDate(first.delivery_date)}</strong></div>
        <div><span>Cliente</span><strong>${escapeHtml(first.client||"")}</strong></div>
        <div><span>Condición</span><strong>${escapeHtml((first.payment_method||"").replace("_"," "))}</strong></div>
        <div><span>Estado</span><strong>${currentRemitoItems.every(i=>i.delivered)?"ENTREGADO":"PENDIENTE"}</strong></div>
      </div>

      <table>
        <thead><tr><th>Cant.</th><th>Unidad</th><th>Descripción</th><th>P. unit.</th><th>Importe</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="bottom">
        <div class="notes"><span>Observaciones</span><div>${escapeHtml(notes)}</div></div>
        <div class="total"><span>TOTAL</span><strong>${money(total)}</strong></div>
      </div>

      <div class="signatures">
        <div><div class="line"></div><span>Entregó</span></div>
        <div><div class="line"></div><span>Recibió conforme</span></div>
        <div><div class="line"></div><span>Aclaración / DNI</span></div>
      </div>
    </section>`;

  const remitoHtml=`<!doctype html>
  <html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Remito ${escapeHtml(first.client||"Don Zoilo")}</title>
    <style>
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;background:#eceff1;font-family:Arial,Helvetica,sans-serif;color:#111}
      .actions{position:sticky;top:0;display:flex;justify-content:center;gap:10px;padding:10px;background:#101820;z-index:10}
      .actions button{border:0;border-radius:10px;padding:11px 15px;font-weight:800;cursor:pointer}
      .print{background:#b38a3e;color:#16120a}.close{background:#e9ecef;color:#20262c}
      .sheet{width:210mm;height:297mm;margin:12px auto;background:white;padding:6mm;box-shadow:0 4px 18px #0002;overflow:hidden}
      .ticket{height:137.5mm;border:1.2px solid #111;padding:5mm;overflow:hidden}
      .cut{height:10mm;display:flex;align-items:center;gap:4mm;color:#555;font-size:8pt}
      .cut:before,.cut:after{content:"";flex:1;border-top:1px dashed #777}
      .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:3mm;margin-bottom:3mm}
      .logo{font-size:18pt;font-weight:900;letter-spacing:1px;line-height:1}
      .tag{font-size:6.5pt;letter-spacing:1.3px;margin-top:1.5mm}
      .title{text-align:right}.copy{font-size:7pt;font-weight:900;letter-spacing:1px}
      .title h1{margin:1mm 0 0;font-size:16pt}.number{font-size:8pt;font-weight:800;margin-top:1mm}
      .info{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #111;margin-bottom:3mm}
      .info>div{padding:2mm;border-right:1px solid #111;min-height:10mm}.info>div:last-child{border-right:0}
      .info span{display:block;font-size:6pt;text-transform:uppercase;font-weight:800;color:#555;margin-bottom:.7mm}
      .info strong{font-size:8pt}
      table{width:100%;border-collapse:collapse;margin-bottom:2.5mm}
      th,td{border:1px solid #111;padding:1.4mm}th{font-size:6pt;text-transform:uppercase;background:#f1f1f1}td{font-size:7.2pt}
      th:nth-child(1),td:nth-child(1){width:13mm;text-align:right}
      th:nth-child(2),td:nth-child(2){width:17mm}
      th:nth-child(4),td:nth-child(4),th:nth-child(5),td:nth-child(5){width:27mm;text-align:right}
      .bottom{display:grid;grid-template-columns:1fr 48mm;gap:4mm;align-items:start}
      .notes{border:1px solid #111;min-height:16mm;padding:2mm}
      .notes span{display:block;font-size:6pt;font-weight:900;text-transform:uppercase;margin-bottom:1.5mm}.notes div{font-size:7pt}
      .total{border-top:2px solid #111;padding-top:2mm;display:flex;justify-content:space-between;align-items:center;font-size:9pt}.total strong{font-size:12pt}
      .signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:8mm;margin-top:11mm}
      .signatures>div{text-align:center}.line{border-top:1px solid #111;margin-bottom:1mm}.signatures span{font-size:6.5pt;font-weight:700}
      @page{size:A4 portrait;margin:0}
      @media print{
        html,body{width:210mm;height:297mm;margin:0!important;padding:0!important;overflow:hidden!important;background:white}
        .actions{display:none!important}
        .sheet{width:210mm!important;height:297mm!important;margin:0!important;padding:6mm!important;box-shadow:none!important;overflow:hidden!important}
      }
      @media screen and (max-width:900px){
        .sheet{width:100%;height:auto;min-height:100vh;margin:0;padding:10px}
        .ticket{height:auto;min-height:520px}
        .info{grid-template-columns:repeat(2,1fr)}
        .info>div{border-bottom:1px solid #111}
      }
    </style>
  </head>
  <body>
    <div class="actions">
      <button class="print" onclick="window.print()">Imprimir / Guardar PDF</button>
      <button class="close" onclick="window.close()">Cerrar</button>
    </div>
    <main class="sheet">
      ${remitoBody("ORIGINAL")}
      <div class="cut">CORTAR AQUÍ</div>
      ${remitoBody("COPIA")}
    </main>
  </body>
  </html>`;

  const printWindow=window.open("","_blank");
  if(!printWindow){
    alert("El navegador bloqueó la nueva ventana. Permití ventanas emergentes para este sitio.");
    return;
  }
  printWindow.document.open();
  printWindow.document.write(remitoHtml);
  printWindow.document.close();
  printWindow.focus();
});

window.addEventListener("afterprint",()=>{
  document.body.classList.remove("printing-remito","printing-sheet");
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("print-active"));
});

// Limpieza preventiva al volver a la app.
window.addEventListener("focus",()=>{
  setTimeout(()=>document.body.classList.remove("printing-remito","printing-sheet"),500);
});

const ROUTE_ORDER=[
  "ARDENTE","ITUZAINGÓ","ITUZAINGO","NOI","INTENDENCIA","MORÓN","MORON",
  "CARLITOS","HAEDO","CLÍNICA HAEDO","CLINICA HAEDO","RAMOS","CASEROS",
  "VILLA DEL PARQUE","SIFÓN","SIFON","DUMPLING","PALERMO","BELGRANO","SENDERO"
];

function routeIndex(name){
  const normalized=String(name||"").toUpperCase().trim();
  const idx=ROUTE_ORDER.indexOf(normalized);
  return idx===-1?999:idx;
}


function sheetDateLong(dateStr){
  if(!dateStr) return "";
  const d=new Date(`${dateStr}T12:00:00`);
  const days=["DOMINGO","LUNES","MARTES","MIÉRCOLES","JUEVES","VIERNES","SÁBADO"];
  return `${days[d.getDay()]} ${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

function ordersAsText(date){
  const byClient=new Map();
  orders.filter(o=>!date||o.delivery_date===date).forEach(o=>{
    const client=String(o.client||"SIN NOMBRE").trim().toUpperCase();
    if(!byClient.has(client)) byClient.set(client,[]);
    byClient.get(client).push(o);
  });

  return [...byClient.entries()]
    .sort((a,b)=>routeIndex(a[0])-routeIndex(b[0]) || a[0].localeCompare(b[0]))
    .map(([client,items])=>{
      const lines=items.map(item=>{
        const qty=Number(item.quantity||0).toLocaleString("es-AR");
        return `${qty} ${item.unit||"kg"} ${item.product}`;
      });
      return `${client}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

function buildOrderSheet(){
  const date=$("sheetDate").value;
  const title=$("sheetTitle").value.trim()||"PEDIDOS DON ZOILO";
  $("printSheetTitle").textContent=date?`${title} – ${sheetDateLong(date)}`:title;
  $("printSheetDate").textContent="";

  const byClient=new Map();
  orders.filter(o=>!date||o.delivery_date===date).forEach(o=>{
    const key=String(o.client||"SIN NOMBRE").trim().toUpperCase();
    if(!byClient.has(key)) byClient.set(key,[]);
    byClient.get(key).push(o);
  });

  const clients=[...byClient.entries()].sort((a,b)=>{
    const ai=routeIndex(a[0]),bi=routeIndex(b[0]);
    return ai-bi || a[0].localeCompare(b[0]);
  });

  const boxes=[];
  clients.slice(0,16).forEach(([client,items])=>{
    boxes.push({client,items});
  });
  while(boxes.length<16) boxes.push({client:"",items:[]});

  const grid=$("sheetGrid");
  grid.innerHTML="";
  boxes.forEach((box,index)=>{
    const div=document.createElement("div");
    div.className="sheet-box";
    const lines=box.items.map(item=>{
      const qty=Number(item.quantity||0).toLocaleString("es-AR");
      const unit=item.unit||"kg";
      return `<div class="sheet-line">${qty} ${escapeHtml(unit)} ${escapeHtml(item.product)}</div>`;
    }).join("");
    div.innerHTML=`
      <div class="sheet-number">${index+1}</div>
      <div class="sheet-client">${box.client?escapeHtml(box.client):"&nbsp;"}</div>
      <div class="sheet-lines">${lines || '<div class="sheet-empty">.</div>'}</div>`;
    grid.append(div);
  });
}

$("sheetDate").addEventListener("change",buildOrderSheet);
$("sheetTitle").addEventListener("input",buildOrderSheet);
$("refreshSheet").addEventListener("click",buildOrderSheet);

$("copyOrders").addEventListener("click",async()=>{
  const text=ordersAsText($("sheetDate").value);
  if(!text){
    alert("No hay pedidos para copiar en la fecha elegida.");
    return;
  }
  try{
    await navigator.clipboard.writeText(text);
    alert("Pedidos copiados. Ya podés pegarlos en WhatsApp.");
  }catch(e){
    const area=document.createElement("textarea");
    area.value=text;
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    alert("Pedidos copiados. Ya podés pegarlos en WhatsApp.");
  }
});

$("printSheet").addEventListener("click",()=>{
  buildOrderSheet();

  const date=$("sheetDate").value;
  const title=$("sheetTitle").value.trim()||"PEDIDOS DON ZOILO";

  const byClient=new Map();
  orders.filter(o=>!date||o.delivery_date===date).forEach(o=>{
    const key=String(o.client||"SIN NOMBRE").trim().toUpperCase();
    if(!byClient.has(key)) byClient.set(key,[]);
    byClient.get(key).push(o);
  });

  const clients=[...byClient.entries()].sort((a,b)=>{
    const ai=routeIndex(a[0]), bi=routeIndex(b[0]);
    return ai-bi || a[0].localeCompare(b[0]);
  });

  const boxes=[];
  clients.slice(0,16).forEach(([client,items])=>boxes.push({client,items}));
  while(boxes.length<16) boxes.push({client:"",items:[]});

  const boxHtml=boxes.map((box,index)=>{
    const lines=box.items.map(item=>{
      const qty=Number(item.quantity||0).toLocaleString("es-AR");
      const unit=item.unit||"kg";
      return `<div class="line">${qty} ${escapeHtml(unit)} ${escapeHtml(item.product)}</div>`;
    }).join("");

    return `
      <div class="box">
        <div class="num">${index+1}</div>
        <div class="client">${box.client?escapeHtml(box.client):"&nbsp;"}</div>
        <div class="lines">${lines||'<div class="empty">.</div>'}</div>
      </div>`;
  }).join("");

  const sheetHtml=`<!doctype html>
  <html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
      *{box-sizing:border-box}
      html,body{margin:0;padding:0;background:#eceff1;font-family:Arial,Helvetica,sans-serif;color:#000}
      .actions{position:sticky;top:0;display:flex;justify-content:center;gap:10px;padding:12px;background:#101820;z-index:10}
      .actions button{border:0;border-radius:10px;padding:12px 16px;font-weight:800;cursor:pointer}
      .print{background:#b38a3e;color:#16120a}
      .close{background:#e9ecef;color:#20262c}
      .sheet{
        width:210mm;
        height:297mm;
        margin:16px auto;
        padding:6mm;
        background:#fff;
        overflow:hidden;
        box-shadow:0 4px 18px #0002;
      }
      .header{
        height:16mm;
        display:flex;
        justify-content:space-between;
        align-items:flex-end;
        border-bottom:2px solid #000;
        padding-bottom:2.5mm;
        margin-bottom:3mm;
      }
      .title{font-size:18pt;font-weight:900;letter-spacing:.2px}
      .subtitle{font-size:8pt;font-weight:800}
      .date{font-size:10pt;font-weight:900}
      .grid{
        display:grid;
        grid-template-columns:repeat(4,1fr);
        grid-template-rows:repeat(4,1fr);
        width:198mm;
        height:266mm;
        border-left:1.2px solid #000;
        border-top:1.2px solid #000;
      }
      .box{
        border-right:1.2px solid #000;
        border-bottom:1.2px solid #000;
        padding:2.5mm;
        position:relative;
        overflow:hidden;
        min-width:0;
        min-height:0;
      }
      .num{position:absolute;top:2mm;right:2.5mm;font-size:8pt;font-weight:900}
      .client{
        font-size:10.2pt;
        font-weight:900;
        text-transform:uppercase;
        border-bottom:.8px solid #000;
        padding-bottom:1.2mm;
        margin-bottom:1.5mm;
        padding-right:7mm;
        white-space:nowrap;
        overflow:hidden;
        text-overflow:ellipsis;
      }
      .lines{font-size:8.3pt;line-height:1.18}
      .line{margin-bottom:.7mm}
      .empty{color:transparent}
      @page{size:A4 portrait;margin:0}
      @media print{
        html,body{
          width:210mm!important;
          height:297mm!important;
          margin:0!important;
          padding:0!important;
          overflow:hidden!important;
          background:#fff!important;
        }
        .actions{display:none!important}
        .sheet{
          width:210mm!important;
          height:297mm!important;
          min-height:297mm!important;
          max-height:297mm!important;
          margin:0!important;
          padding:6mm!important;
          box-shadow:none!important;
          overflow:hidden!important;
          page-break-after:avoid!important;
          break-after:avoid-page!important;
        }
      }
      @media screen and (max-width:900px){
        .sheet{width:100%;height:auto;min-height:100vh;margin:0;padding:10px}
        .grid{width:100%;height:auto;grid-template-columns:repeat(2,1fr);grid-template-rows:none;grid-auto-rows:220px}
      }

      @media print{
        .grid{
          display:grid!important;
          grid-template-columns:repeat(4,1fr)!important;
          grid-template-rows:repeat(4,1fr)!important;
          grid-auto-rows:unset!important;
          width:198mm!important;
          height:266mm!important;
        }
      }
    </style>
  </head>
  <body>
    <div class="actions">
      <button class="print" onclick="window.print()">Imprimir / Guardar PDF</button>
      <button class="close" onclick="window.close()">Cerrar</button>
    </div>
    <main class="sheet">
      <div class="header">
        <div>
          <div class="title">${escapeHtml(date?`${title} – ${sheetDateLong(date)}`:title)}</div>
          <div class="subtitle">HOJA DE REPARTO</div>
        </div>
        <div class="date"></div>
      </div>
      <div class="grid">${boxHtml}</div>
    </main>
  </body>
  </html>`;

  const printWindow=window.open("","_blank");
  if(!printWindow){
    alert("El navegador bloqueó la nueva ventana. Permití ventanas emergentes para este sitio.");
    return;
  }

  printWindow.document.open();
  printWindow.document.write(sheetHtml);
  printWindow.document.close();
  printWindow.focus();
});

document.querySelectorAll(".quick-nav").forEach(btn=>btn.addEventListener("click",()=>{const tab=document.querySelector(`.tab[data-view="${btn.dataset.target}"]`);if(tab)tab.click()}));

window.addEventListener("beforeinstallprompt",(e)=>{
  e.preventDefault(); deferredPrompt=e; $("installBtn").classList.remove("hidden");
});
$("installBtn").addEventListener("click",async()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null;
});

(async function init(){
  $("movementDate").value=todayISO();
  $("orderDate").value=todayISO();
  $("importOrderDate").value=todayISO();
  $("ordersFilterDate").value=todayISO();
  $("dateFrom").value=monthStart();
  $("dateTo").value=todayISO();
  localLoad();
  await initCloud();
  renderAll();
  buildOrderSheet();
})();
