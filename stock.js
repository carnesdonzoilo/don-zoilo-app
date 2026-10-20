/* DON ZOILO V33.2 — STOCK TIPO EXCEL
   Edición directa por celda. Independiente de compras, ventas y pedidos. */
(function(){
  "use strict";
  const STOCK_LOCAL_KEY="don_zoilo_stock_v33";
  const CATEGORIES=["Vacuno","Cerdo","Pollo","Embutidos","Achuras","Otros"];
  const UNITS=["kg","unidad","caja","pieza","gancho"];
  let stockRows=[];
  let editingId=null;
  let draftId=null;
  const savingIds=new Set();
  const saveQueues=new Map();
  const revisions=new Map();
  let reloadPending=false;
  let loading=false;
  function hasPending(){return saveQueues.size>0 || savingIds.size>0;}
  function requestReload(showError=false){
    if(hasPending()){reloadPending=true;return;}
    loadStock(showError);
  }
  function flushReload(){if(!hasPending()&&reloadPending){reloadPending=false;loadStock(false);}}

  const byId=id=>document.getElementById(id);
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const attr=value=>esc(value).replace(/`/g,"&#096;");
  const num=value=>{const n=Number(String(value??0).replace(",","."));return Number.isFinite(n)?n:0};
  const cash=value=>new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(num(value));
  const decimal=value=>num(value).toLocaleString("es-AR",{maximumFractionDigits:2});
  const uuid=()=>crypto.randomUUID?crypto.randomUUID():`stock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const nowIso=()=>new Date().toISOString();
  function localRead(){try{return JSON.parse(localStorage.getItem(STOCK_LOCAL_KEY)||"[]")}catch(_){return[]}}
  // Supabase is authoritative. A full browser cache must never invalidate a cloud save.
  function localWrite(){
    // No duplicar en localStorage el inventario que ya está en Supabase.
    if(cloud())return true;
    try{localStorage.setItem(STOCK_LOCAL_KEY,JSON.stringify(stockRows.filter(r=>r.product?.trim())));return true;}
    catch(error){console.warn("Copia local de stock no disponible; se mantiene Supabase como fuente principal.",error);return false;}
  }
  function cloud(){return typeof supabaseClient!=="undefined"&&supabaseClient;}
  function amountOf(row){const basis=num(row.kg)>0?num(row.kg):num(row.quantity);return basis*num(row.unit_cost);}

  async function loadStock(showError=false){
    if(hasPending()){reloadPending=true;return;}
    if(loading)return;
    loading=true;
    try{
      if(cloud()){
        const {data,error}=await cloud().from("inventory_stock").select("*").order("product",{ascending:true});
        if(error)throw error;
        if(hasPending()){reloadPending=true;return;}
        stockRows=data||[];localWrite();
      }else stockRows=localRead();
      draftId=null;renderStock();
    }catch(error){
      console.error("Stock:",error);
      // Keep currently displayed cloud data instead of overwriting with stale local cache.
      if(!stockRows.length)stockRows=localRead();
      renderStock();
      if(showError)alert("No se pudo actualizar Stock desde Supabase. No se reemplazaron los cambios en pantalla. "+error.message);
    }finally{loading=false;flushReload();}
  }

  function filteredRows(){
    const q=(byId("stockSearch")?.value||"").trim().toLowerCase();
    const cat=byId("stockCategoryFilter")?.value||"";
    return stockRows.filter(r=>(!cat||r.category===cat)&&(!q||[r.product,r.detail_status,r.notes,r.category].some(v=>String(v||"").toLowerCase().includes(q))));
  }

  function inputCell(row,field,type="text",extra=""){
    return `<input class="stock-cell-input ${type==='number'?'stock-cell-number':''}" data-field="${field}" data-id="${attr(row.id)}" type="${type}" ${extra} value="${attr(type==='number'?num(row[field]):row[field]||'')}">`;
  }
  function selectCell(row,field,options){
    return `<select class="stock-cell-input" data-field="${field}" data-id="${attr(row.id)}">${options.map(v=>`<option value="${attr(v)}" ${v===(row[field]||options[0])?'selected':''}>${esc(v)}</option>`).join('')}</select>`;
  }

  function renderStock(focusField=null,focusId=null){
    const body=byId("stockTableBody");if(!body)return;
    const rows=filteredRows();body.innerHTML="";
    rows.forEach(row=>{
      const tr=document.createElement("tr");tr.dataset.id=row.id;
      if(num(row.kg)<0||num(row.quantity)<0)tr.classList.add("stock-negative");
      if(savingIds.has(row.id))tr.classList.add("stock-saving");
      tr.innerHTML=`
        <td class="stock-product-name">${inputCell(row,"product")}</td>
        <td>${inputCell(row,"detail_status")}</td>
        <td>${selectCell(row,"category",CATEGORIES)}</td>
        <td>${selectCell(row,"unit",UNITS)}</td>
        <td class="num">${inputCell(row,"quantity","number",'step="0.01"')}</td>
        <td class="num">${inputCell(row,"kg","number",'step="0.01"')}</td>
        <td class="num">${inputCell(row,"unit_cost","number",'step="0.01"')}</td>
        <td class="num stock-amount" data-amount-id="${attr(row.id)}"><strong>${cash(amountOf(row))}</strong></td>
        <td>${inputCell(row,"notes")}</td>
        <td><div class="stock-row-actions"><button type="button" class="stock-delete-inline" data-delete="${attr(row.id)}" title="Eliminar">🗑</button></div></td>`;
      body.appendChild(tr);
    });
    byId("stockEmpty")?.classList.toggle("hidden",rows.length>0);
    updateKpis();
    if(focusId){requestAnimationFrame(()=>{const el=body.querySelector(`[data-id="${CSS.escape(focusId)}"][data-field="${focusField||'product'}"]`);el?.focus();el?.select?.();});}
  }

  function updateKpis(){
    const valid=stockRows.filter(r=>r.product?.trim());
    const totalKg=valid.reduce((s,r)=>s+num(r.kg),0),totalValue=valid.reduce((s,r)=>s+amountOf(r),0);
    byId("stockProductCount").textContent=String(valid.length);
    byId("stockKgTotal").textContent=`${decimal(totalKg)} kg`;
    byId("stockValueTotal").textContent=cash(totalValue);
    const last=valid.map(r=>r.updated_at).filter(Boolean).sort().at(-1);
    byId("stockUpdatedAt").textContent=last?new Date(last).toLocaleString("es-AR"):"—";
    byId("stockSheetDate").textContent=new Date().toLocaleDateString("es-AR");
  }

  function updateRowFromCell(input){
    const row=stockRows.find(r=>r.id===input.dataset.id);if(!row)return null;
    const field=input.dataset.field;
    row[field]=input.type==="number"?num(input.value):input.value;
    row.updated_at=nowIso();
    const amount=byId("stockTableBody")?.querySelector(`[data-amount-id="${CSS.escape(row.id)}"] strong`);
    if(amount)amount.textContent=cash(amountOf(row));
    updateKpis();
    return row;
  }

  function persistRow(row,input){
    if(!row||!String(row.product||"").trim()){
      input?.classList.add("stock-cell-error");return Promise.resolve(false);
    }
    const id=row.id;
    const revision=(revisions.get(id)||0)+1;
    revisions.set(id,revision);
    // Snapshot every edit. Sequential writes prevent an older response overwriting a newer value.
    const snapshot={...row};
    savingIds.add(id);
    input?.classList.remove("stock-cell-error","stock-cell-saved");
    input?.closest("tr")?.classList.add("stock-saving");
    const previous=saveQueues.get(id)||Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      if(cloud()){
        const {data,error}=await cloud().from("inventory_stock").upsert(snapshot,{onConflict:"id"}).select().single();
        if(error)throw error;
        return data;
      }
      // Offline writes are not presented as cloud-confirmed saves.
      throw new Error("Sin conexión a Supabase. El cambio no fue confirmado.");
    }).then(saved=>{
      if(revisions.get(id)===revision){
        const i=stockRows.findIndex(r=>r.id===id);
        if(i>=0)stockRows[i]=saved;
        if(draftId===id)draftId=null;
        localWrite();
        input?.classList.add("stock-cell-saved");
        setTimeout(()=>input?.classList.remove("stock-cell-saved"),1000);
      }
      return true;
    }).catch(error=>{
      if(revisions.get(id)===revision){
        input?.classList.add("stock-cell-error");
        alert("El cambio de stock NO se guardó en Supabase: "+(error.message||error)+". Conservá el valor en pantalla y volvé a intentar.");
      }
      return false;
    }).finally(()=>{
      if(saveQueues.get(id)===task){
        saveQueues.delete(id);savingIds.delete(id);
        input?.closest("tr")?.classList.remove("stock-saving");
        flushReload();
      }
      updateKpis();
    });
    saveQueues.set(id,task);
    return task;
  }

  function addInlineRow(){
    if(draftId){renderStock("product",draftId);return;}
    const row={id:uuid(),product:"",detail_status:"",category:"Vacuno",unit:"kg",quantity:0,kg:0,unit_cost:0,notes:"",created_at:nowIso(),updated_at:nowIso()};
    stockRows.unshift(row);draftId=row.id;
    byId("stockSearch").value="";byId("stockCategoryFilter").value="";
    renderStock("product",row.id);
  }

  async function deleteInline(row){
    if(!row)return;
    if(row.product&& !confirm(`¿Eliminar ${row.product} del stock?`))return;
    try{
      if(cloud()&&row.product){const {error}=await cloud().from("inventory_stock").delete().eq("id",row.id);if(error)throw error;}
      stockRows=stockRows.filter(r=>r.id!==row.id);if(draftId===row.id)draftId=null;localWrite();renderStock();
    }catch(error){alert("No se pudo eliminar: "+(error.message||error));}
  }

  function openForm(row=null){
    editingId=row?.id||null;
    byId("stockDialogTitle").textContent=row?"Editar mercadería":"Agregar mercadería";
    byId("stockId").value=row?.id||"";byId("stockProduct").value=row?.product||"";byId("stockStatus").value=row?.detail_status||"";
    byId("stockCategory").value=row?.category||"Vacuno";byId("stockUnit").value=row?.unit||"kg";
    byId("stockQuantity").value=num(row?.quantity);byId("stockKg").value=num(row?.kg);byId("stockUnitCost").value=num(row?.unit_cost);byId("stockNotes").value=row?.notes||"";
    byId("stockDeleteBtn").classList.toggle("hidden",!row);updatePreview();
    const d=byId("stockDialog");if(d.showModal)d.showModal();else d.setAttribute("open","");
  }
  function closeForm(){const d=byId("stockDialog");if(d.close)d.close();else d.removeAttribute("open");}
  function updatePreview(){byId("stockAmountPreview").value=cash((num(byId("stockKg")?.value)>0?num(byId("stockKg")?.value):num(byId("stockQuantity")?.value))*num(byId("stockUnitCost")?.value));}
  async function saveRow(event){event.preventDefault();const existing=stockRows.find(r=>r.id===editingId);const row={id:editingId||uuid(),product:byId("stockProduct").value.trim(),detail_status:byId("stockStatus").value.trim(),category:byId("stockCategory").value,unit:byId("stockUnit").value,quantity:num(byId("stockQuantity").value),kg:num(byId("stockKg").value),unit_cost:num(byId("stockUnitCost").value),notes:byId("stockNotes").value.trim(),created_at:existing?.created_at||nowIso(),updated_at:nowIso()};if(!row.product)return alert("Ingresá el nombre del producto.");const ok=await persistRow(row);if(!ok)return;if(!stockRows.some(r=>r.id===row.id))stockRows.push(row);closeForm();renderStock();}
  async function deleteRow(){const row=stockRows.find(r=>r.id===editingId);await deleteInline(row);closeForm();}

  function exportCsv(){
    const cols=["producto","detalle_estado","categoria","unidad","cantidad","kg","precio_unitario","importe","detalle"];
    const quote=v=>`"${String(v??"").replaceAll('"','""')}"`;
    const lines=[cols.join(","),...stockRows.filter(r=>r.product?.trim()).map(r=>[r.product,r.detail_status,r.category,r.unit,r.quantity,r.kg,r.unit_cost,amountOf(r),r.notes].map(quote).join(","))];
    const blob=new Blob(["\ufeff"+lines.join("\n")],{type:"text/csv;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`Don_Zoilo_Stock_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
  }

  function exportPdfA4(){
    const rows=stockRows.filter(r=>r.product?.trim()).sort((a,b)=>String(a.product).localeCompare(String(b.product),"es",{sensitivity:"base"}));
    if(!rows.length)return alert("No hay productos cargados en Stock para exportar.");
    const totalKg=rows.reduce((s,r)=>s+num(r.kg),0);
    const totalValue=rows.reduce((s,r)=>s+amountOf(r),0);
    const generated=new Date();
    const win=window.open("","_blank");
    if(!win)return alert("El navegador bloqueó la ventana de impresión. Habilitá las ventanas emergentes e intentá nuevamente.");
    const rowHtml=rows.map((r,i)=>`
      <tr>
        <td class="n">${i+1}</td>
        <td class="product">${esc(r.product)}</td>
        <td>${esc(r.detail_status||"")}</td>
        <td>${esc(r.category||"")}</td>
        <td>${esc(r.unit||"")}</td>
        <td class="num">${decimal(r.quantity)}</td>
        <td class="num kg"><strong>${decimal(r.kg)}</strong></td>
        <td class="num">${cash(r.unit_cost)}</td>
        <td class="num">${cash(amountOf(r))}</td>
      </tr>`).join("");
    const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Stock Don Zoilo</title>
      <style>
        @page{size:A4 landscape;margin:8mm}
        *{box-sizing:border-box}
        body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:8px}
        .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:4px;margin-bottom:6px}
        h1{font-size:18px;margin:0;letter-spacing:.2px}
        .sub{font-size:8px;margin-top:2px}
        .meta{text-align:right;font-size:8px;line-height:1.35}
        table{width:100%;border-collapse:collapse;table-layout:fixed}
        thead{display:table-header-group}
        th,td{border:1px solid #777;padding:2.2px 3px;vertical-align:middle;line-height:1.15;overflow-wrap:anywhere}
        th{background:#eee;font-size:7.5px;text-transform:uppercase}
        tr{break-inside:avoid}
        .n{width:4%;text-align:center}.product{width:19%;font-weight:700}.detail{width:15%}.cat{width:10%}.unit{width:7%}.qty{width:8%}.kg{width:8%}.price{width:12%}.amount{width:13%}
        .num{text-align:right;white-space:nowrap}
        .summary{display:flex;justify-content:flex-end;gap:18px;margin-top:6px;font-size:10px;font-weight:700}
        .foot{margin-top:5px;font-size:7px;text-align:right;color:#444}
        @media print{.no-print{display:none!important}}
      </style></head><body>
      <div class="head"><div><h1>STOCK ACTUAL - DON ZOILO</h1><div class="sub">Listado general de mercadería</div></div><div class="meta">${generated.toLocaleDateString("es-AR")}<br>${generated.toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"})}</div></div>
      <table><thead><tr><th class="n">#</th><th class="product">Producto</th><th class="detail">Detalle</th><th class="cat">Categoría</th><th class="unit">Unidad</th><th class="qty">Cantidad</th><th class="kg">Kg</th><th class="price">Precio</th><th class="amount">Importe</th></tr></thead><tbody>${rowHtml}</tbody></table>
      <div class="summary"><span>Productos: ${rows.length}</span><span>Total kilos: ${decimal(totalKg)} kg</span><span>Valor stock: ${cash(totalValue)}</span></div>
      <div class="foot">Don Zoilo - Stock generado desde la app</div>
      <script>window.onload=()=>setTimeout(()=>window.print(),250);<\/script>
      </body></html>`;
    win.document.open();win.document.write(html);win.document.close();
  }

  function bind(){
    byId("stockNewBtn")?.addEventListener("click",addInlineRow);byId("stockCloseBtn")?.addEventListener("click",closeForm);byId("stockForm")?.addEventListener("submit",saveRow);byId("stockDeleteBtn")?.addEventListener("click",deleteRow);
    ["stockQuantity","stockKg","stockUnitCost"].forEach(id=>byId(id)?.addEventListener("input",updatePreview));
    byId("stockSearch")?.addEventListener("input",()=>renderStock());byId("stockCategoryFilter")?.addEventListener("change",()=>renderStock());byId("stockRefreshBtn")?.addEventListener("click",()=>requestReload(true));byId("stockExportBtn")?.addEventListener("click",exportCsv);byId("stockPdfBtn")?.addEventListener("click",exportPdfA4);
    const body=byId("stockTableBody");
    body?.addEventListener("input",e=>{if(e.target.matches(".stock-cell-input"))updateRowFromCell(e.target);});
    body?.addEventListener("change",e=>{if(e.target.matches("select.stock-cell-input")){const row=updateRowFromCell(e.target);persistRow(row,e.target);}});
    body?.addEventListener("focusout",e=>{if(e.target.matches("input.stock-cell-input")){const row=updateRowFromCell(e.target);persistRow(row,e.target);}});
    body?.addEventListener("keydown",e=>{
      if(!e.target.matches(".stock-cell-input"))return;
      if(e.key==="Enter"){e.preventDefault();const inputs=[...body.querySelectorAll(".stock-cell-input")];const next=inputs[inputs.indexOf(e.target)+1];if(next){next.focus();next.select?.();}else e.target.blur();}
      if(e.key==="Escape"){e.target.blur();}
    });
    body?.addEventListener("click",e=>{const del=e.target.closest("[data-delete]");if(del)deleteInline(stockRows.find(r=>r.id===del.dataset.delete));});
    document.querySelector('[data-view="stock"]')?.addEventListener("click",()=>requestReload(false));
  }
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{bind();loadStock(false);}):(()=>{bind();loadStock(false);})();

  window.addEventListener("donzoilo:cloud-ready",()=>requestReload(false));
  window.addEventListener("donzoilo:remote-change",e=>{if(e.detail?.table==="inventory_stock")requestReload(false)});
  window.addEventListener("donzoilo:app-visible",()=>requestReload(false));
})();
