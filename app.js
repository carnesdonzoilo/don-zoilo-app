
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
const on = (id,event,handler) => { const el=$(id); if(el) el.addEventListener(event,handler); return el; };
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


async function reloadCloudData(){
  if(!supabaseClient) return;
  const {data: movementData, error: movementError} = await supabaseClient
    .from("movements").select("*")
    .order("date",{ascending:false})
    .order("created_at",{ascending:false});
  if(movementError) throw movementError;

  const {data: orderData, error: orderError} = await supabaseClient
    .from("orders").select("*")
    .order("delivery_date",{ascending:false})
    .order("created_at",{ascending:false});
  if(orderError) throw orderError;

  const {data: priceData, error: priceError} = await supabaseClient
    .from("product_prices").select("*");
  if(priceError) throw priceError;

  movements=movementData||[];
  orders=orderData||[];
  productPrices={};
  (priceData||[]).forEach(row=>productPrices[row.product_key]=Number(row.last_price||0));
  localSave();
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
  const from = $("dateFrom")?.value || "";
  const to = $("dateTo")?.value || "";
  return movements.filter(m => (!from || m.date >= from) && (!to || m.date <= to));
}


function dateWithOffset(offset){
  const d=new Date();
  d.setDate(d.getDate()+Number(offset||0));
  const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}

function renderHomePanel(){
  const date=$("homeSelectedDate")?.value || todayISO();
  const selected=orders.filter(o=>o.delivery_date===date);

  const groups=new Map();
  selected.forEach(o=>{
    const key=o.batch_id||o.id;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(o);
  });

  const grouped=[...groups.values()];
  const total=grouped.length;
  const delivered=grouped.filter(items=>items.every(x=>x.delivered)).length;
  const pending=total-delivered;
  const kg=selected.filter(o=>(o.unit||"kg")==="kg").reduce((sum,o)=>sum+Number(o.quantity||0),0);
  const billing=selected.reduce((sum,o)=>sum+Number(o.total||0),0);

  const receivable=movements.filter(m=>m.status!=="pendiente").reduce((sum,m)=>{
    if(m.type==="venta") return sum+Number(m.amount||0);
    if(m.type==="cobro") return sum-Number(m.amount||0);
    return sum;
  },0);

  if($("homeOrders")) $("homeOrders").textContent=total;
  if($("homePending")) $("homePending").textContent=pending;
  if($("homeDelivered")) $("homeDelivered").textContent=delivered;
  if($("homeKg")) $("homeKg").textContent=`${kg.toLocaleString("es-AR")} kg`;
  if($("homeBilling")) $("homeBilling").textContent=money(billing);
  if($("homeReceivable")) $("homeReceivable").textContent=money(Math.max(receivable,0));

  const pct=total?Math.round(delivered/total*100):0;
  if($("homeProgressPercent")) $("homeProgressPercent").textContent=`${pct}%`;
  if($("homeProgressBar")) $("homeProgressBar").style.width=`${pct}%`;
  if($("homeProgressText")) $("homeProgressText").textContent=total
    ? `${delivered} entregado${delivered===1?"":"s"} de ${total} pedido${total===1?"":"s"}.`
    : "Sin pedidos para esta fecha.";

  const d=new Date(`${date}T12:00:00`);
  if($("homeSelectedDateLabel")) $("homeSelectedDateLabel").textContent=d.toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  if($("homeGreeting")) $("homeGreeting").textContent=new Date().getHours()<12?"Buenos días":"Resumen operativo";

  document.querySelectorAll(".home-date-btn").forEach(btn=>{
    btn.classList.toggle("active",date===dateWithOffset(btn.dataset.offset));
  });

  const alerts=$("homeAlerts");
  if(!alerts) return;
  alerts.innerHTML="";
  const list=[];

  if(!total) list.push(["warning","No hay pedidos","Todavía no hay pedidos cargados para la fecha elegida."]);
  if(pending>0) list.push(["warning",`${pending} pedido${pending===1?"":"s"} pendiente${pending===1?"":"s"}`,"Todavía no fueron marcados como entregados."]);
  if(total>0 && pending===0) list.push(["good","Reparto completo","Todos los pedidos de la fecha están entregados."]);

  const missingPrices=selected.filter(o=>Number(o.unit_price||0)<=0).length;
  if(missingPrices>0) list.push(["warning",`${missingPrices} producto${missingPrices===1?"":"s"} sin precio`,"Completá los precios antes de emitir remitos."]);
  if(receivable>0) list.push(["warning","Saldo pendiente de cobro",money(receivable)]);
  if(!list.length) list.push(["good","Todo en orden","No hay alertas importantes."]);

  list.forEach(([kind,title,text])=>{
    const div=document.createElement("div");
    div.className=`alert-item ${kind}`;
    div.innerHTML=`<strong>${escapeHtml(title)}</strong><div class="muted small">${escapeHtml(text)}</div>`;
    alerts.append(div);
  });
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

function renderAll(){ renderHomePanel(); renderDashboard(); renderOrders(); renderMovements(); renderBalances(); renderPrices(); renderPricePrintSheet(); }

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
    if($("movementDate")) $("movementDate").value=todayISO();
  if($("orderDate")) $("orderDate").value=todayISO();
  if($("importOrderDate")) $("importOrderDate").value=todayISO();
  if($("ordersFilterDate")) $("ordersFilterDate").value=todayISO();
    renderAll();
    document.querySelector('[data-view="dashboard"]').click();
  }catch(err){
    alert("No se pudo guardar: "+err.message);
  }
});

on("searchText","input",renderMovements);
on("filterType","change",renderMovements);
on("applyDates","click",renderDashboard);
on("exportCsv","click",exportCSV);
on("openConfig","click",()=>{
  const cfg=JSON.parse(localStorage.getItem(CONFIG_KEY)||"null");
  if($("supabaseUrl")) $("supabaseUrl").value=cfg?.url||"";
  if($("supabaseKey")) $("supabaseKey").value=cfg?.key||"";
  const dialog=$("configDialog");
  if(!dialog) return alert("No se encontró la ventana de configuración.");
  if(typeof dialog.showModal==="function") dialog.showModal();
  else dialog.setAttribute("open","");
});

on("saveConfig","click",(event)=>{
  event.preventDefault();
  const url=$("supabaseUrl")?.value.trim()||"";
  const key=$("supabaseKey")?.value.trim()||"";
  if(!url.startsWith("https://") || !key){
    alert("Completá la URL del proyecto y la clave pública.");
    return;
  }
  localStorage.setItem(CONFIG_KEY,JSON.stringify({url,key}));
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


function cleanWhatsAppLine(raw){
  let line=String(raw||"").trim();
  // Remove copied WhatsApp prefixes: [14/7, 11:20 a.m.] Leandro:
  line=line.replace(/^\[[^\]]+\]\s*[^:]{1,50}:\s*/u,"");
  // Remove bullet characters and repeated separators.
  line=line.replace(/^[\s\-–—•⁠·*]+/u,"").trim();
  return line;
}

function normalizeProductKey(text){
  return String(text||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g," ")
    .trim();
}

function normalizeProductName(text){
  return String(text||"")
    .replace(/\bozobuco\b/gi,"osobuco")
    .replace(/\brof\s*bef\b/gi,"roastbeef")
    .replace(/\broast\s*beef\b/gi,"roastbeef")
    .replace(/\bbondiolas?\b/gi,"bondiola")
    .replace(/\bpalomitas?\b/gi,"palomita")
    .replace(/\bnalgas?\s+s\/?t(?:apa)?\b/gi,"nalga sin tapa")
    .replace(/\bnalgas?\s+c\/?t(?:apa)?\b/gi,"nalga con tapa")
    .replace(/\bchinchus?\b/gi,"chinchulín")
    .replace(/\bsupremas?\b/gi,"suprema")
    .replace(/\s+/g," ")
    .trim()
    .replace(/[.,;:]+$/,"");
}

function inferUnit(product, explicitUnit, quantityToken=""){
  if(explicitUnit) return explicitUnit;
  const p=String(product||"").toLowerCase();

  if(/\b(maple|maples)\b/.test(p)) return "unidad";
  if(/\b(caja|cajón|cajon)\b/.test(p)) return "caja";
  if(/\b(gancho)\b/.test(p)) return "gancho";

  const pieceProducts=[
    "bondiola","nalga","vacío","vacio","lomo","roastbeef","palomita",
    "peceto","mondongo","pollo","bife","tapa asado","tapa de asado",
    "riñón","riñon","lengua","picaña","carré","carre","churrasco"
  ];
  if(pieceProducts.some(x=>p.includes(x)) && !/^\d+[.,]?\d*\s*k$/i.test(quantityToken)) return "piezas";
  return "kg";
}

function parseQuantity(raw){
  raw=String(raw||"").trim().replace(",",".").replace(/\s/g,"");
  if(raw.includes("/")){
    const [a,b]=raw.split("/").map(Number);
    if(b) return a/b;
  }
  return Number(raw);
}

const UNIT_MAP={
  kg:"kg",k:"kg",kilo:"kg",kilos:"kg",
  pieza:"piezas",piezas:"piezas",pz:"piezas",p:"piezas",
  unidad:"unidad",unidades:"unidad",un:"unidad",u:"unidad",
  caja:"caja",cajas:"caja",cajon:"caja",cajones:"caja",cajón:"caja",cajónes:"caja",c:"caja",
  gancho:"gancho",ganchos:"gancho",g:"gancho",
  maple:"unidad",maples:"unidad"
};

function productMatch(line){
  const clean=cleanWhatsAppLine(line);
  // Supports: 40k lomo, 10 kg lomo, 1/2 g chorizo, 5 c picaña, 2 bondiolas.
  return clean.match(
    /^(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+)\s*(kg|kilos?|k|piezas?|pieza|pz|p|unidades?|unidad|un|u|cajas?|cajones?|cajón|c|ganchos?|gancho|g|maples?|maple)?\s*(?:de\s+)?(.+)$/iu
  );
}

function isProductLine(line){
  const match=productMatch(line);
  return Boolean(match && match[3] && !/^(am|pm|a\.m\.|p\.m\.)$/i.test(match[3].trim()));
}

function parseProductLine(original){
  const match=productMatch(original);
  if(!match) return null;

  const quantity=parseQuantity(match[1]);
  if(!Number.isFinite(quantity) || quantity<=0) return null;

  const token=(match[2]||"").toLowerCase();
  let product=normalizeProductName(match[3]);
  if(!product) return null;

  // "15 maples de huevo" -> product "huevo", unit unidad.
  if(/^(maple|maples)$/i.test(token)) product=product.replace(/^de\s+/i,"");

  return {
    quantity,
    unit:inferUnit(product,UNIT_MAP[token],`${match[1]}${token}`),
    product,
    unit_price:suggestedPrice(product)
  };
}

function looksLikeNoise(line){
  const clean=cleanWhatsAppLine(line).toLowerCase();
  return !clean ||
    /^(gracias|por favor|buen día|buen dia|hola|pedido|pedidos)$/i.test(clean) ||
    /^https?:\/\//i.test(clean);
}

function parseOrderText(raw){
  const lines=String(raw||"").split(/\r?\n/);
  const groups=[];
  let current=null;

  const pushCurrent=()=>{
    if(current && current.items.length){
      groups.push(current);
    }
    current=null;
  };

  for(const original of lines){
    const line=cleanWhatsAppLine(original);
    if(looksLikeNoise(line)) continue;

    if(isProductLine(line)){
      if(!current){
        throw new Error(`Encontré un producto antes del cliente: "${line}". Poné el nombre del cliente arriba.`);
      }
      const item=parseProductLine(line);
      if(item) current.items.push(item);
      continue;
    }

    // A line without quantity starts a new client.
    pushCurrent();
    current={
      client:line.replace(/:$/,"").trim().toUpperCase(),
      items:[]
    };
  }

  pushCurrent();

  if(!groups.length){
    throw new Error("No pude reconocer pedidos. Pegá el cliente en una línea y los productos con cantidad debajo.");
  }
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

on("parseOrderBtn","click",()=>{
  try{
    parsedImportGroups=parseOrderText($("rawOrderText")?.value||"");
    $("importPreview")?.classList.remove("hidden");
    renderImportPreview();
    const totalItems=parsedImportGroups.reduce((sum,g)=>sum+g.items.length,0);
    const old=document.querySelector(".import-detected");
    if(old) old.remove();
    const note=document.createElement("div");
    note.className="import-detected";
    note.textContent=`✓ Detecté ${parsedImportGroups.length} cliente${parsedImportGroups.length===1?"":"s"} y ${totalItems} producto${totalItems===1?"":"s"}.`;
    $("parseOrderBtn")?.insertAdjacentElement("afterend",note);
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
    if($("ordersFilterDate")) $("ordersFilterDate").value=todayISO(); updateOrderPreview(); renderAll();
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




const PRICE_CATALOG={"Vacunos": [["Asado banderita", 19000], ["Asado completo", 17500], ["Asado costillar marcado", 17000], ["Asado premium 10 costillas", 24500], ["Bife ancho x taco", 16500], ["Bife ancho", 17500], ["Bife angosto", 18500], ["Bife con lomo 10 costillas", 17800], ["Bife de chorizo envasado", 22500], ["Bife de chorizo", 24000], ["Bife T-bone", 24000], ["Bola de lomo envasada", 15500], ["Colita de cuadril envasada", 18500], ["Cuadrada envasada", 15500], ["Cuadril envasado", 18000], ["Entraña", 26000], ["Lomo con cordón", 26000], ["Matambre envasado", 16000], ["Nalga con tapa envasada", 16000], ["Nalga feteada envasada", 18000], ["Nalga sin tapa envasada", 17500], ["Nalga sin tapa fresca", 20500], ["Ojo de bife envasado", 24500], ["Ojo de bife", 26500], ["Osobuco pata corta", 12500], ["Paleta envasada", 14000], ["Paleta", 16000], ["Peceto envasado", 18500], ["Picada especial", 13500], ["Picada oferta", 9500], ["Picaña", 17000], ["Roastbeef envasado", 14000], ["Roastbeef", 15500], ["Tapa asado envasada", 13500], ["Tapa de asado", 17500], ["Tapa de bife (marucha)", 14000], ["Tapa de nalga", 17000], ["Vacío envasado", 19000], ["Vacío", 20500]], "Pollos": [["Cajón de pollo", 75000], ["Pata y muslo", 4900], ["Churrasquito de pollo", 8800], ["Suprema fresca", 9500], ["Suprema x 15 kg congelada", 7900]], "Cerdo": [["Bondiola x caja", 8000], ["Bondiola", 8800], ["Carré deshuesado", 10000], ["Carré", 8200], ["Churrasquito de cerdo", 12500], ["Jamón", 6500], ["Lechón", 15000], ["Matambrito", 14500], ["Paleta de cerdo", 5500], ["Pechito con manta", 8200], ["Ribs Paladini", 12000], ["Solomillo", 10500]], "Achuras": [["Chinchulín", 5500], ["Lengua", 9500], ["Molleja", 26000], ["Mondongo", 8500], ["Rabo", 8500], ["Riñón", 5500]], "Embutidos": [["Chorizo colorado", 12500], ["Chorizo puro cerdo con morrón", 9500], ["Chorizo puro cerdo", 7500], ["Chorizo vacuno", 6500], ["Longaniza", 6500], ["Morcilla", 6500], ["Panceta", 22500], ["Salchicha copetín", 9800], ["Salchicha parrillera", 12500], ["Salchicha viena", 9500]], "Granja": [["Chivito", 16500], ["Cordero", 15500], ["Cochinillo", 17500], ["Pata de cordero", 14500]], "Preparados": [["Hamburguesas de carne", 13500], ["Milanesas de carne", 13500], ["Milanesas de pollo", 9500], ["Hamburguesas de pollo", 13500]]};

function catalogPrice(name,defaultPrice){
  const key=normalizeProductKey(name);
  const direct=Object.prototype.hasOwnProperty.call(productPrices,key)
    ? productPrices[key]
    : undefined;

  if(direct !== undefined) return Number(direct||0);

  const matchedKey=Object.keys(productPrices).find(existingKey =>
    normalizeProductKey(existingKey) === key
  );
  if(matchedKey) return Number(productPrices[matchedKey]||0);

  return Number(defaultPrice||0);
}

function renderPricePrintSheet(){
  const grid=$("priceSheetGrid");
  if(!grid) return;
  grid.innerHTML="";
  Object.entries(PRICE_CATALOG).forEach(([category,items])=>{
    const section=document.createElement("section");
    section.className="price-category";
    section.innerHTML=`<h2>${escapeHtml(category.toUpperCase())}</h2><div class="price-category-list"></div>`;
    const list=section.querySelector(".price-category-list");
    items.forEach(([name,defaultPrice])=>{
      const row=document.createElement("div");
      row.className="price-sheet-row";
      row.innerHTML=`<span class="product">${escapeHtml(name)}</span><span class="price">${money(catalogPrice(name,defaultPrice))}</span>`;
      list.append(row);
    });
    grid.append(section);
  });
  if($("priceSheetTitle")) $("priceSheetTitle").textContent=($("pricePrintTitle")?.value||"LISTA DE PRECIOS").toUpperCase();
  if($("priceSheetPhone")) $("priceSheetPhone").textContent=$("pricePrintPhone")?.value||"11 3039 0331";
  const date=$("pricePrintDate")?.value;
  if($("priceSheetDate")) $("priceSheetDate").textContent=date
    ? `VIGENTE A PARTIR DEL ${new Date(date+"T12:00:00").toLocaleDateString("es-AR")}`
    : "";
}

async function loadBaseCatalogPrices(){
  let saved=0;
  for(const items of Object.values(PRICE_CATALOG)){
    for(const [name,value] of items){
      const key=normalizeProductKey(name);
      if(!Object.prototype.hasOwnProperty.call(productPrices,key)){
        await rememberProductPrice(name,value);
        saved++;
      }
    }
  }
  renderPrices();
  renderPricePrintSheet();
  alert(saved ? `Se cargaron ${saved} precios base.` : "El catálogo base ya estaba cargado.");
}

function priceEntries(){
  return Object.entries(productPrices)
    .map(([key,value])=>({key,name:key.replace(/\s+/g," "),value:Number(value||0)}))
    .sort((a,b)=>a.name.localeCompare(b.name,"es"));
}

function renderPrices(){
  const list=$("priceList");
  if(!list) return;
  const search=($("priceSearch")?.value||"").trim().toLowerCase();
  const entries=priceEntries().filter(row=>row.name.includes(search));
  if($("priceCount")) $("priceCount").textContent=`${entries.length} producto${entries.length===1?"":"s"}`;
  list.innerHTML="";

  if(!entries.length){
    list.innerHTML='<div class="price-empty">No hay precios guardados con ese nombre.</div>';
    return;
  }

  entries.forEach(row=>{
    const div=document.createElement("div");
    div.className="price-row";
    div.innerHTML=`
      <div class="price-name">${escapeHtml(row.name)}</div>
      <input type="number" min="0" step="0.01" value="${row.value}">
      <div class="price-actions">
        <button type="button" class="secondary save-price-row">Guardar</button>
        <button type="button" class="danger delete-price-row">Eliminar</button>
      </div>`;
    const input=div.querySelector("input");
    div.querySelector(".save-price-row").addEventListener("click",async()=>{
      try{
        await rememberProductPrice(row.name,Number(input.value||0));
        renderPrices();
      }catch(e){ alert("No se pudo guardar el precio: "+e.message); }
    });
    div.querySelector(".delete-price-row").addEventListener("click",async()=>{
      if(!confirm(`¿Eliminar el precio guardado de ${row.name}?`)) return;
      try{
        delete productPrices[row.key];
        localSave();
        if(supabaseClient){
          const {error}=await supabaseClient.from("product_prices").delete().eq("product_key",row.key);
          if(error) throw error;
        }
        renderPrices();
      }catch(e){ alert("No se pudo eliminar: "+e.message); }
    });
    list.append(div);
  });
}


on("loadCatalogPrices","click",async()=>{
  const btn=$("loadCatalogPrices");
  if(btn) btn.disabled=true;
  try{ await loadBaseCatalogPrices(); }
  catch(e){ alert("No se pudo cargar el catálogo: "+e.message); }
  finally{ if(btn) btn.disabled=false; }
});
function buildPricePrintDocument(autoPrint=false){
  renderPricePrintSheet();
  const sheet=$("pricePrintSheet");
  if(!sheet) throw new Error("No se encontró la hoja de precios.");

  const popup=window.open("","_blank");
  if(!popup){
    alert("El navegador bloqueó la vista de impresión. Habilitá las ventanas emergentes para este sitio.");
    return;
  }

  const printableCss=`
    *{box-sizing:border-box}
    body{margin:0;padding:7mm;font-family:Arial,sans-serif;color:#111;background:#fff}
    .price-print-sheet{display:block;width:196mm;min-height:283mm;margin:0 auto}
    .price-print-header{display:grid;grid-template-columns:1fr 1.6fr 1fr;align-items:center;gap:12px;border-bottom:3px solid #0c2748;padding-bottom:9px;margin-bottom:10px}
    .price-brand-name{font-family:Georgia,serif;font-size:24px;font-weight:900;letter-spacing:1px;color:#0c2748}
    .price-brand-sub{font-size:7px;letter-spacing:1.3px}
    .price-print-title-wrap{text-align:center}
    .price-print-title-wrap h1{font-size:27px;margin:0;color:#0c2748;letter-spacing:1px}
    .price-print-title-wrap div{font-size:11px;color:#b5232a;font-weight:800;letter-spacing:3px}
    .price-contact{border:2px solid #b5232a;border-radius:6px;padding:7px;text-align:center;display:flex;flex-direction:column}
    .price-contact strong{font-size:8px;color:#b5232a}
    .price-contact span{font-size:17px;font-weight:900;color:#b5232a}
    .price-contact small{font-size:7px;color:#0c2748;font-weight:800}
    .price-sheet-grid{columns:3;column-gap:10px}
    .price-category{break-inside:avoid;border:1px solid #bfc5cc;margin:0 0 8px;background:#fff}
    .price-category h2{font-size:10px;line-height:1.2;margin:0;padding:5px 7px;text-align:center;background:#0c2748;color:#fff;letter-spacing:.5px}
    .price-category-list{padding:4px 6px}
    .price-sheet-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px;align-items:end;font-size:7px;line-height:1.35;padding:1.2px 0;border-bottom:1px dotted #a8adb3}
    .price-sheet-row:last-child{border-bottom:0}
    .price-sheet-row .product{font-weight:700;text-transform:uppercase;overflow:hidden}
    .price-sheet-row .price{font-weight:900;white-space:nowrap}
    .price-print-footer{margin-top:8px;border-top:3px solid #0c2748;text-align:center;display:flex;flex-direction:column;gap:3px;padding-top:5px;color:#0c2748}
    .price-print-footer strong{font-size:8px}
    .price-print-footer span,.price-print-footer small{font-size:7px}
    .print-help{display:none}
    @page{size:A4 portrait;margin:7mm}
    @media screen{
      body{background:#e9ecef}
      .price-print-sheet{background:#fff;padding:7mm;box-shadow:0 5px 24px rgba(0,0,0,.18)}
      .print-help{display:block;position:sticky;top:0;margin:-7mm -7mm 7mm;padding:12px;background:#101820;color:#fff;text-align:center;font-size:14px}
    }
    @media print{
      body{padding:0}
      .price-print-sheet{box-shadow:none;padding:0}
      .print-help{display:none!important}
    }`;

  popup.document.open();
  popup.document.write(`<!doctype html>
  <html lang="es">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Lista de precios Don Zoilo</title>
    <style>${printableCss}</style>
  </head>
  <body>
    <div class="print-help">En Android: menú ⋮ → Compartir → Imprimir, o Guardar como PDF.</div>
    ${sheet.outerHTML}
    <script>
      window.addEventListener("load",()=>{
        ${autoPrint ? 'setTimeout(()=>window.print(),350);' : ''}
      });
    <\/script>
  </body>
  </html>`);
  popup.document.close();
  popup.focus();
}

on("previewPriceList","click",()=>{
  try{ buildPricePrintDocument(false); }
  catch(e){ alert("No se pudo abrir la vista A4: "+e.message); }
});

on("printPriceList","click",()=>{
  try{ buildPricePrintDocument(true); }
  catch(e){ alert("No se pudo abrir la impresión: "+e.message); }
});
on("pricePrintTitle","input",renderPricePrintSheet);
on("pricePrintPhone","input",renderPricePrintSheet);
on("pricePrintDate","change",renderPricePrintSheet);
window.addEventListener("afterprint",()=>document.body.classList.remove("price-list-printing"));

on("priceSearch","input",renderPrices);
on("priceForm","submit",async(event)=>{
  event.preventDefault();
  const product=normalizeProductName($("priceProduct")?.value||"");
  const value=Number($("priceValue")?.value||0);
  if(!product || value<0) return alert("Completá producto y precio.");
  try{
    await rememberProductPrice(product,value);
    if($("priceProduct")) $("priceProduct").value="";
    if($("priceValue")) $("priceValue").value="";
    renderPrices();
  }catch(e){ alert("No se pudo guardar: "+e.message); }
});
on("refreshPrices","click",async()=>{
  try{
    if(supabaseClient) await reloadCloudData();
    renderPrices();
  }catch(e){ alert("No se pudieron actualizar los precios: "+e.message); }
});

document.querySelectorAll(".quick-nav").forEach(btn=>{
  btn.addEventListener("click",()=>{
    const tab=document.querySelector(`.tab[data-view="${btn.dataset.target}"]`);
    if(tab) tab.click();
  });
});

document.querySelectorAll(".home-date-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    if($("homeSelectedDate")) $("homeSelectedDate").value=dateWithOffset(btn.dataset.offset);
    renderHomePanel();
  });
});
on("homeSelectedDate","change",renderHomePanel);

on("refreshOrders","click",async()=>{
  const btn=$("refreshOrders");
  if(btn) btn.disabled=true;
  try{
    if(supabaseClient) await reloadCloudData();
    renderAll();
    buildOrderSheet();
  }catch(error){
    alert("No se pudieron actualizar los pedidos: "+error.message);
  }finally{
    if(btn) btn.disabled=false;
  }
});

window.addEventListener("beforeinstallprompt",(e)=>{
  e.preventDefault(); deferredPrompt=e; $("installBtn").classList.remove("hidden");
});
$("installBtn").addEventListener("click",async()=>{
  if(!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt=null;
});

(async function init(){
  if($("movementDate")) $("movementDate").value=todayISO();
  if($("orderDate")) $("orderDate").value=todayISO();
  if($("importOrderDate")) $("importOrderDate").value=todayISO();
  if($("ordersFilterDate")) $("ordersFilterDate").value=todayISO();
  if($("dateFrom")) $("dateFrom").value=monthStart();
  if($("dateTo")) $("dateTo").value=todayISO();
  if($("homeSelectedDate")) $("homeSelectedDate").value=dateWithOffset(1);
  if($("pricePrintDate")) $("pricePrintDate").value=todayISO();
  localLoad();
  await initCloud();
  renderAll();
  buildOrderSheet();
})();
