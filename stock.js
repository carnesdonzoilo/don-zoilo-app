/* DON ZOILO V33.0 — MÓDULO STOCK MANUAL SEGURO
   Independiente de compras, ventas, pedidos y movimientos. */
(function(){
  "use strict";
  const STOCK_LOCAL_KEY="don_zoilo_stock_v33";
  let stockRows=[];
  let editingId=null;
  const byId=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const num=value=>Number(value||0);
  const cash=value=>new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(num(value));
  const decimal=value=>num(value).toLocaleString("es-AR",{maximumFractionDigits:2});
  const uuid=()=>crypto.randomUUID?crypto.randomUUID():`stock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const nowIso=()=>new Date().toISOString();
  function localRead(){try{return JSON.parse(localStorage.getItem(STOCK_LOCAL_KEY)||"[]")}catch(_){return[]}}
  function localWrite(){localStorage.setItem(STOCK_LOCAL_KEY,JSON.stringify(stockRows));}
  function cloud(){return typeof supabaseClient!=="undefined"&&supabaseClient;}
  function amountOf(row){const basis=num(row.kg)>0?num(row.kg):num(row.quantity);return basis*num(row.unit_cost);}

  async function loadStock(showError=false){
    try{
      if(cloud()){
        const {data,error}=await cloud().from("inventory_stock").select("*").order("product",{ascending:true});
        if(error) throw error;
        stockRows=data||[]; localWrite();
      }else stockRows=localRead();
    }catch(error){
      console.error("Stock:",error); stockRows=localRead();
      if(showError) alert("No se pudo leer Stock de Supabase. Se muestra la copia local. "+error.message);
    }
    renderStock();
  }

  function filteredRows(){
    const q=(byId("stockSearch")?.value||"").trim().toLowerCase();
    const cat=byId("stockCategoryFilter")?.value||"";
    return stockRows.filter(r=>(!cat||r.category===cat)&&(!q||[r.product,r.detail_status,r.notes,r.category].some(v=>String(v||"").toLowerCase().includes(q))));
  }

  function renderStock(){
    const body=byId("stockTableBody"); if(!body)return;
    const rows=filteredRows(); body.innerHTML="";
    rows.forEach(row=>{
      const tr=document.createElement("tr"); if(num(row.kg)<0||num(row.quantity)<0)tr.className="stock-negative";
      tr.innerHTML=`<td class="stock-product-name">${esc(row.product)}</td><td>${row.detail_status?`<span class="stock-status-pill">${esc(row.detail_status)}</span>`:""}</td><td>${esc(row.category)}</td><td>${esc(row.unit)}</td><td class="num">${decimal(row.quantity)}</td><td class="num">${decimal(row.kg)}</td><td class="num">${cash(row.unit_cost)}</td><td class="num"><strong>${cash(amountOf(row))}</strong></td><td>${esc(row.notes||"")}</td><td><div class="stock-row-actions"><button class="stock-quick" data-adjust="${esc(row.id)}">± Ajustar</button><button class="stock-edit" data-edit="${esc(row.id)}">Editar</button></div></td>`;
      body.appendChild(tr);
    });
    byId("stockEmpty")?.classList.toggle("hidden",rows.length>0);
    const totalKg=stockRows.reduce((s,r)=>s+num(r.kg),0), totalValue=stockRows.reduce((s,r)=>s+amountOf(r),0);
    byId("stockProductCount").textContent=String(stockRows.length);
    byId("stockKgTotal").textContent=`${decimal(totalKg)} kg`;
    byId("stockValueTotal").textContent=cash(totalValue);
    const last=stockRows.map(r=>r.updated_at).filter(Boolean).sort().at(-1);
    byId("stockUpdatedAt").textContent=last?new Date(last).toLocaleString("es-AR"):"—";
    byId("stockSheetDate").textContent=new Date().toLocaleDateString("es-AR");
  }

  function openForm(row=null){
    editingId=row?.id||null;
    byId("stockDialogTitle").textContent=row?"Editar mercadería":"Agregar mercadería";
    byId("stockId").value=row?.id||""; byId("stockProduct").value=row?.product||""; byId("stockStatus").value=row?.detail_status||"";
    byId("stockCategory").value=row?.category||"Vacuno"; byId("stockUnit").value=row?.unit||"kg";
    byId("stockQuantity").value=num(row?.quantity); byId("stockKg").value=num(row?.kg); byId("stockUnitCost").value=num(row?.unit_cost); byId("stockNotes").value=row?.notes||"";
    byId("stockDeleteBtn").classList.toggle("hidden",!row); updatePreview();
    const d=byId("stockDialog"); if(d.showModal)d.showModal();else d.setAttribute("open","");
  }
  function closeForm(){const d=byId("stockDialog");if(d.close)d.close();else d.removeAttribute("open");}
  function updatePreview(){byId("stockAmountPreview").value=cash((num(byId("stockKg")?.value)>0?num(byId("stockKg")?.value):num(byId("stockQuantity")?.value))*num(byId("stockUnitCost")?.value));}

  async function saveRow(event){
    event.preventDefault();
    const existing=stockRows.find(r=>r.id===editingId);
    const row={id:editingId||uuid(),product:byId("stockProduct").value.trim(),detail_status:byId("stockStatus").value.trim(),category:byId("stockCategory").value,unit:byId("stockUnit").value,quantity:num(byId("stockQuantity").value),kg:num(byId("stockKg").value),unit_cost:num(byId("stockUnitCost").value),notes:byId("stockNotes").value.trim(),created_at:existing?.created_at||nowIso(),updated_at:nowIso()};
    if(!row.product)return alert("Ingresá el nombre del producto.");
    try{
      if(cloud()){
        const {data,error}=await cloud().from("inventory_stock").upsert(row,{onConflict:"id"}).select().single(); if(error)throw error;
        const i=stockRows.findIndex(r=>r.id===row.id); if(i>=0)stockRows[i]=data;else stockRows.push(data);
      }else{const i=stockRows.findIndex(r=>r.id===row.id);if(i>=0)stockRows[i]=row;else stockRows.push(row);}
      localWrite(); closeForm(); renderStock();
    }catch(error){alert("No se pudo guardar el stock: "+error.message);}
  }

  async function deleteRow(){
    const row=stockRows.find(r=>r.id===editingId); if(!row||!confirm(`¿Eliminar ${row.product} del stock?`))return;
    try{if(cloud()){const {error}=await cloud().from("inventory_stock").delete().eq("id",row.id);if(error)throw error;}stockRows=stockRows.filter(r=>r.id!==row.id);localWrite();closeForm();renderStock();}catch(error){alert("No se pudo eliminar: "+error.message);}
  }

  async function quickAdjust(row){
    const value=prompt(`Ajuste de kilos para ${row.product}.\nUsá positivo para sumar o negativo para descontar.`,`0`); if(value===null)return;
    const delta=Number(String(value).replace(",",".")); if(!Number.isFinite(delta)||delta===0)return alert("Ingresá un ajuste válido.");
    const updated={...row,kg:num(row.kg)+delta,updated_at:nowIso()};
    try{if(cloud()){const {data,error}=await cloud().from("inventory_stock").update({kg:updated.kg,updated_at:updated.updated_at}).eq("id",row.id).select().single();if(error)throw error;Object.assign(updated,data);}stockRows=stockRows.map(r=>r.id===row.id?updated:r);localWrite();renderStock();}catch(error){alert("No se pudo ajustar: "+error.message);}
  }

  function exportCsv(){
    const cols=["producto","detalle_estado","categoria","unidad","cantidad","kg","precio_unitario","importe","detalle"];
    const quote=v=>`"${String(v??"").replaceAll('"','""')}"`;
    const lines=[cols.join(","),...stockRows.map(r=>[r.product,r.detail_status,r.category,r.unit,r.quantity,r.kg,r.unit_cost,amountOf(r),r.notes].map(quote).join(","))];
    const blob=new Blob(["\ufeff"+lines.join("\n")],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`Don_Zoilo_Stock_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
  }

  function bind(){
    byId("stockNewBtn")?.addEventListener("click",()=>openForm()); byId("stockCloseBtn")?.addEventListener("click",closeForm); byId("stockForm")?.addEventListener("submit",saveRow); byId("stockDeleteBtn")?.addEventListener("click",deleteRow);
    ["stockQuantity","stockKg","stockUnitCost"].forEach(id=>byId(id)?.addEventListener("input",updatePreview));
    byId("stockSearch")?.addEventListener("input",renderStock);byId("stockCategoryFilter")?.addEventListener("change",renderStock);byId("stockRefreshBtn")?.addEventListener("click",()=>loadStock(true));byId("stockExportBtn")?.addEventListener("click",exportCsv);
    byId("stockTableBody")?.addEventListener("click",e=>{const edit=e.target.closest("[data-edit]");if(edit)openForm(stockRows.find(r=>r.id===edit.dataset.edit));const adj=e.target.closest("[data-adjust]");if(adj)quickAdjust(stockRows.find(r=>r.id===adj.dataset.adjust));});
    document.querySelector('[data-view="stock"]')?.addEventListener("click",()=>loadStock(false));
  }
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{bind();loadStock(false);}):(()=>{bind();loadStock(false);})();
})();
