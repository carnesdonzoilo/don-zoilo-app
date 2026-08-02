/* DON ZOILO V35.0 — Agenda de vencimientos */
(() => {
  const CACHE_KEY="don_zoilo_due_dates_v1";
  let rows=[];
  let selectedMonth="";
  let initialized=false;

  const q=id=>document.getElementById(id);
  const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const isoToday=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
  const currentMonth=()=>isoToday().slice(0,7);
  const arMoney=n=>new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(n||0));
  const dateObj=s=>new Date(`${s}T12:00:00`);
  const fmt=s=>s?dateObj(s).toLocaleDateString("es-AR"):"";
  const uuid=()=>crypto.randomUUID?crypto.randomUUID():`${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const effectiveStatus=r=>r.status==="paid"?"paid":(r.due_date<isoToday()?"overdue":"pending");

  function localSave(){try{localStorage.setItem(CACHE_KEY,JSON.stringify(rows))}catch(_){}}
  function localLoad(){try{rows=JSON.parse(localStorage.getItem(CACHE_KEY)||"[]")}catch(_){rows=[]}}

  async function ensureData(){
    localLoad();
    if(typeof supabaseClient==="undefined" || !supabaseClient){renderAllDue();return;}
    const {data,error}=await supabaseClient.from("due_dates").select("*").order("due_date",{ascending:true}).order("created_at",{ascending:true});
    if(error){
      console.warn("Agenda de vencimientos:",error.message);
      if(error.message?.toLowerCase().includes("due_dates")) showSetupWarning();
      renderAllDue(); return;
    }
    rows=data||[]; localSave(); renderAllDue();
  }

  function showSetupWarning(){
    const box=q("dueUpcomingList"); if(!box) return;
    box.innerHTML='<div class="due-empty"><strong>Falta activar la tabla en Supabase.</strong><br><small>Ejecutá el archivo <b>supabase_update_v35_vencimientos.sql</b> una sola vez.</small></div>';
  }

  async function saveRow(item){
    const index=rows.findIndex(x=>x.id===item.id);
    if(index>=0) rows[index]=item; else rows.push(item);
    rows.sort((a,b)=>a.due_date.localeCompare(b.due_date)); localSave(); renderAllDue();
    if(typeof supabaseClient==="undefined" || !supabaseClient) throw new Error("No hay conexión con Supabase.");
    const {error}=await supabaseClient.from("due_dates").upsert(item,{onConflict:"id"});
    if(error) throw error;
    await ensureData();
  }

  async function deleteRow(id){
    const old=[...rows]; rows=rows.filter(x=>x.id!==id); localSave(); renderAllDue();
    if(typeof supabaseClient==="undefined" || !supabaseClient){rows=old;localSave();renderAllDue();throw new Error("No hay conexión con Supabase.");}
    const {error}=await supabaseClient.from("due_dates").delete().eq("id",id);
    if(error){rows=old;localSave();renderAllDue();throw error;}
  }

  function createDialog(){
    if(q("dueDialog")) return;
    const d=document.createElement("dialog"); d.id="dueDialog";
    d.innerHTML=`<form id="dueForm" class="dialog-card due-dialog-card">
      <div class="panel-head"><h2 id="dueDialogTitle">Nuevo vencimiento</h2><button type="button" id="dueClose" class="secondary">Cerrar</button></div>
      <input type="hidden" id="dueId">
      <div class="due-form-grid">
        <label class="full">Concepto<input id="dueTitle" required placeholder="Ej.: Seguro Kangoo, ARCA, alquiler"></label>
        <label>Fecha<input id="dueDate" type="date" required></label>
        <label>Importe opcional<input id="dueAmount" type="number" min="0" step="0.01" inputmode="decimal" value="0"></label>
        <label>Categoría<select id="dueCategory"><option>General</option><option>Impuestos</option><option>Servicios</option><option>Vehículos</option><option>Proveedores</option><option>Personal</option><option>Habilitaciones</option><option>Otros</option></select></label>
        <label>Avisar con anticipación<select id="dueRemind"><option value="0">El mismo día</option><option value="1">1 día antes</option><option value="3" selected>3 días antes</option><option value="7">7 días antes</option><option value="15">15 días antes</option><option value="30">30 días antes</option></select></label>
        <label>Estado<select id="dueStatus"><option value="pending">Pendiente</option><option value="paid">Pagado</option></select></label>
        <label class="full">Observaciones<textarea id="dueNotes" rows="3" placeholder="Detalle, número de póliza, forma de pago, etc."></textarea></label>
      </div>
      <div class="due-dialog-actions"><button type="button" id="dueDelete" class="secondary due-danger hidden">Eliminar</button><button type="submit" class="primary">Guardar vencimiento</button></div>
    </form>`;
    document.body.appendChild(d);
    q("dueClose").onclick=()=>d.close();
    q("dueDelete").onclick=async()=>{const id=q("dueId").value;if(!id)return;if(!confirm("¿Eliminar este vencimiento?"))return;try{await deleteRow(id);d.close()}catch(e){alert("No se pudo eliminar: "+e.message)}};
    q("dueForm").onsubmit=async e=>{
      e.preventDefault();
      const old=rows.find(x=>x.id===q("dueId").value);
      const status=q("dueStatus").value;
      const item={
        id:q("dueId").value||uuid(), title:q("dueTitle").value.trim(), due_date:q("dueDate").value,
        amount:Number(q("dueAmount").value||0), category:q("dueCategory").value||"General", remind_days:Number(q("dueRemind").value||0),
        status, notes:q("dueNotes").value.trim(), source_text:old?.source_text||"", paid_at:status==="paid"?(old?.paid_at||new Date().toISOString()):null,
        created_at:old?.created_at||new Date().toISOString(), updated_at:new Date().toISOString()
      };
      try{await saveRow(item);d.close()}catch(err){alert("No se pudo guardar en Supabase: "+err.message)}
    };
  }

  function openEditor(row=null,date=""){
    createDialog();
    q("dueDialogTitle").textContent=row?"Editar vencimiento":"Nuevo vencimiento";
    q("dueId").value=row?.id||""; q("dueTitle").value=row?.title||""; q("dueDate").value=row?.due_date||date||isoToday();
    q("dueAmount").value=Number(row?.amount||0); q("dueCategory").value=row?.category||"General"; q("dueRemind").value=String(row?.remind_days??3);
    q("dueStatus").value=row?.status||"pending"; q("dueNotes").value=row?.notes||""; q("dueDelete").classList.toggle("hidden",!row);
    q("dueDialog").showModal(); setTimeout(()=>q("dueTitle").focus(),40);
  }

  function monthRows(){return rows.filter(r=>r.due_date?.startsWith(selectedMonth));}
  function renderKpis(){
    const today=isoToday(), now=dateObj(today), in7=new Date(now);in7.setDate(in7.getDate()+7);
    const active=rows.filter(r=>r.status!=="paid");
    const next=active.filter(r=>{const d=dateObj(r.due_date);return d>=now&&d<=in7}).length;
    const overdue=active.filter(r=>r.due_date<today).length;
    const mon=monthRows().filter(r=>r.status!=="paid");
    if(q("dueNext7"))q("dueNext7").textContent=next;if(q("dueOverdue"))q("dueOverdue").textContent=overdue;
    if(q("duePendingMonth"))q("duePendingMonth").textContent=mon.length;if(q("duePendingAmount"))q("duePendingAmount").textContent=arMoney(mon.reduce((a,r)=>a+Number(r.amount||0),0));
  }

  function renderCalendar(){
    const root=q("dueCalendar");if(!root)return;
    const [y,m]=selectedMonth.split("-").map(Number);const first=new Date(y,m-1,1);const start=(first.getDay()+6)%7;const days=new Date(y,m,0).getDate();const prevDays=new Date(y,m-1,0).getDate();
    const title=new Date(y,m-1,1).toLocaleDateString("es-AR",{month:"long",year:"numeric"});if(q("dueMonthTitle"))q("dueMonthTitle").textContent=title.charAt(0).toUpperCase()+title.slice(1);
    root.innerHTML="";
    for(let cell=0;cell<42;cell++){
      let day,cm=m,cy=y,out=false;
      if(cell<start){day=prevDays-start+cell+1;cm=m-1;out=true;if(cm===0){cm=12;cy--}}
      else if(cell>=start+days){day=cell-start-days+1;cm=m+1;out=true;if(cm===13){cm=1;cy++}}
      else day=cell-start+1;
      const iso=`${cy}-${String(cm).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const items=rows.filter(r=>r.due_date===iso).slice(0,3);
      const b=document.createElement("button");b.type="button";b.className=`due-day${out?" outside":""}${iso===isoToday()?" today":""}`;
      b.innerHTML=`<div class="due-day-number">${day}</div><div class="due-day-items">${items.map(r=>`<span class="due-chip ${effectiveStatus(r)}" title="${esc(r.title)}">${esc(r.title)}${Number(r.amount)>0?` · <span class="due-chip-amount">${arMoney(r.amount)}</span>`:""}</span>`).join("")}${rows.filter(r=>r.due_date===iso).length>3?`<span class="due-chip">+${rows.filter(r=>r.due_date===iso).length-3} más</span>`:""}</div>`;
      b.onclick=()=>{selectedMonth=iso.slice(0,7);q("dueMonth").value=selectedMonth;openEditor(null,iso)};root.appendChild(b);
    }
  }

  function rowHtml(r){
    const st=effectiveStatus(r),d=dateObj(r.due_date),mon=d.toLocaleDateString("es-AR",{month:"short"}).replace(".","");
    return `<div class="due-row" data-due-id="${esc(r.id)}"><div class="due-datebox"><strong>${String(d.getDate()).padStart(2,"0")}</strong>${esc(mon.toUpperCase())}</div><div class="due-row-main"><strong>${esc(r.title)}</strong><small>${esc(r.category||"General")}${Number(r.amount)>0?` · ${arMoney(r.amount)}`:""}${r.remind_days?` · aviso ${r.remind_days} d antes`:""}</small>${r.notes?`<small>${esc(r.notes)}</small>`:""}<span class="due-badge ${st}">${st==="paid"?"PAGADO":st==="overdue"?"VENCIDO":"PENDIENTE"}</span></div><div class="due-row-actions">${r.status!=="paid"?'<button type="button" class="due-paid-btn" data-action="paid">✓ Pagado</button>':'<button type="button" class="due-paid-btn" data-action="pending">↶ Reabrir</button>'}<button type="button" class="due-edit-btn" data-action="edit">Editar</button></div></div>`;
  }

  function bindRows(root){root?.querySelectorAll(".due-row").forEach(el=>el.onclick=async ev=>{const r=rows.find(x=>x.id===el.dataset.dueId);if(!r)return;const action=ev.target.closest("button")?.dataset.action;if(action==="edit")return openEditor(r);if(action==="paid"||action==="pending"){const upd={...r,status:action==="paid"?"paid":"pending",paid_at:action==="paid"?new Date().toISOString():null,updated_at:new Date().toISOString()};try{await saveRow(upd)}catch(e){alert("No se pudo actualizar: "+e.message)}}});}
  function renderLists(){
    const today=isoToday();const upcoming=rows.filter(r=>r.status!=="paid"&&r.due_date>=today).sort((a,b)=>a.due_date.localeCompare(b.due_date)).slice(0,10);
    const ur=q("dueUpcomingList");if(ur){ur.innerHTML=upcoming.length?upcoming.map(rowHtml).join(""):'<div class="due-empty">No hay próximos vencimientos.</div>';bindRows(ur)}
    let list=monthRows();const f=q("dueStatusFilter")?.value||"all";if(f!=="all")list=list.filter(r=>effectiveStatus(r)===f);
    const mr=q("dueMonthList");if(mr){mr.innerHTML=list.length?list.map(rowHtml).join(""):'<div class="due-empty">No hay vencimientos para este mes.</div>';bindRows(mr)}
  }

  function renderDashboardAlerts(){
    const root=q("homeAlerts");if(!root)return;
    root.querySelectorAll(".due-home-alert").forEach(x=>x.remove());
    const today=dateObj(isoToday());
    const alerts=rows.filter(r=>r.status!=="paid").filter(r=>{const d=dateObj(r.due_date);const delta=Math.ceil((d-today)/86400000);return delta<0||delta<=Number(r.remind_days||0)}).sort((a,b)=>a.due_date.localeCompare(b.due_date));
    alerts.slice(0,5).forEach(r=>{const st=effectiveStatus(r);const div=document.createElement("div");div.className="alert-item due-home-alert";div.innerHTML=`<strong>📅 ${st==="overdue"?"Vencido":"Próximo vencimiento"}: ${esc(r.title)}</strong><span>${fmt(r.due_date)}${Number(r.amount)>0?` · ${arMoney(r.amount)}`:""}</span>`;div.onclick=()=>document.querySelector('.tab[data-view="dueDates"]')?.click();root.prepend(div)});
  }

  function renderAllDue(){renderKpis();renderCalendar();renderLists();renderDashboardAlerts();}
  function moveMonth(delta){const [y,m]=selectedMonth.split("-").map(Number);const d=new Date(y,m-1+delta,1);selectedMonth=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;q("dueMonth").value=selectedMonth;renderAllDue();}

  function parseOcrText(text){
    const year=new Date().getFullYear();const out=[];
    for(const raw of text.split(/\r?\n/)){
      const line=raw.replace(/\s+/g," ").trim();if(line.length<4)continue;
      const dm=line.match(/\b([0-3]?\d)[\/\-.]([01]?\d)(?:[\/\-.](20\d{2}|\d{2}))?\b/);if(!dm)continue;
      let y=dm[3]?Number(dm[3]):year;if(y<100)y+=2000;const mo=Number(dm[2]),da=Number(dm[1]);if(mo<1||mo>12||da<1||da>31)continue;
      const iso=`${y}-${String(mo).padStart(2,"0")}-${String(da).padStart(2,"0")}`;
      const moneyMatch=line.match(/\$?\s*([0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{1,2})?|[0-9]{4,}(?:,[0-9]{1,2})?)/g);
      let amount=0;if(moneyMatch?.length){const v=moneyMatch[moneyMatch.length-1].replace(/\$/g,"").replace(/\./g,"").replace(",",".").trim();amount=Number(v)||0}
      let title=line.replace(dm[0],"").replace(/\$?\s*[0-9]{1,3}(?:\.[0-9]{3})+(?:,[0-9]{1,2})?/g,"").replace(/\s[-–:]\s*$/," ").trim();if(!title)title="Vencimiento";
      out.push({date:iso,title,amount,source:line});
    }
    return out;
  }

  async function scanPhoto(){
    const file=q("duePhotoInput")?.files?.[0];if(!file)return alert("Primero elegí o sacá una foto.");
    if(typeof Tesseract==="undefined")return alert("El lector de imágenes todavía no está disponible. Volvé a intentar en unos segundos.");
    const btn=q("scanDuePhoto"),status=q("dueOcrStatus");btn.disabled=true;status.textContent="Leyendo imagen…";
    try{
      const result=await Tesseract.recognize(file,"eng",{logger:m=>{if(m.status==="recognizing text")status.textContent=`Leyendo imagen… ${Math.round((m.progress||0)*100)}%`}});
      const candidates=parseOcrText(result.data?.text||"");renderOcrPreview(candidates);status.textContent=candidates.length?`Encontré ${candidates.length} posible${candidates.length===1?"":"s"} vencimiento${candidates.length===1?"":"s"}. Revisalos antes de guardar.`:"No encontré fechas claras. Probá con una foto más de cerca y bien iluminada.";
    }catch(e){status.textContent="No se pudo interpretar la imagen.";alert("No se pudo leer la foto: "+e.message)}finally{btn.disabled=false}
  }

  function renderOcrPreview(items){
    const root=q("dueOcrPreview");if(!root)return;if(!items.length){root.classList.add("hidden");root.innerHTML="";return}
    root.classList.remove("hidden");root.innerHTML=`<div id="dueOcrRows">${items.map((x,i)=>`<div class="due-ocr-row" data-i="${i}"><label>Fecha<input type="date" class="ocr-date" value="${x.date}"></label><label class="ocr-concept">Concepto<input class="ocr-title" value="${esc(x.title)}"></label><label>Importe<input type="number" class="ocr-amount" min="0" step="0.01" value="${x.amount||0}"></label><label>Aviso<select class="ocr-remind"><option value="3">3 días</option><option value="7">7 días</option><option value="15">15 días</option><option value="30">30 días</option></select></label><button type="button" class="secondary ocr-remove">Quitar</button><input type="hidden" class="ocr-source" value="${esc(x.source)}"></div>`).join("")}</div><button type="button" id="saveOcrDueDates" class="primary">Guardar vencimientos revisados</button>`;
    root.querySelectorAll(".ocr-remove").forEach(b=>b.onclick=()=>b.closest(".due-ocr-row").remove());
    q("saveOcrDueDates").onclick=async()=>{const candidates=[...root.querySelectorAll(".due-ocr-row")].map(el=>({id:uuid(),title:el.querySelector(".ocr-title").value.trim(),due_date:el.querySelector(".ocr-date").value,amount:Number(el.querySelector(".ocr-amount").value||0),status:"pending",remind_days:Number(el.querySelector(".ocr-remind").value||3),category:"General",notes:"Cargado desde foto",source_text:el.querySelector(".ocr-source").value,paid_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()})).filter(x=>x.title&&x.due_date);if(!candidates.length)return alert("No hay filas válidas para guardar.");try{if(!supabaseClient)throw new Error("No hay conexión con Supabase.");const {error}=await supabaseClient.from("due_dates").upsert(candidates,{onConflict:"id"});if(error)throw error;root.classList.add("hidden");root.innerHTML="";q("duePhotoInput").value="";await ensureData();alert(`Se guardaron ${candidates.length} vencimientos.`)}catch(e){alert("No se pudieron guardar: "+e.message)}};
  }

  function init(){
    if(initialized)return;initialized=true;selectedMonth=currentMonth();if(q("dueMonth"))q("dueMonth").value=selectedMonth;
    createDialog();
    q("newDueDateBtn")?.addEventListener("click",()=>openEditor());q("duePrevMonth")?.addEventListener("click",()=>moveMonth(-1));q("dueNextMonth")?.addEventListener("click",()=>moveMonth(1));
    q("dueToday")?.addEventListener("click",()=>{selectedMonth=currentMonth();q("dueMonth").value=selectedMonth;renderAllDue()});q("dueMonth")?.addEventListener("change",e=>{selectedMonth=e.target.value||currentMonth();renderAllDue()});
    q("dueStatusFilter")?.addEventListener("change",renderLists);q("refreshDueDates")?.addEventListener("click",ensureData);q("scanDuePhoto")?.addEventListener("click",scanPhoto);
    document.querySelector('.tab[data-view="dueDates"]')?.addEventListener("click",ensureData);
    // Espera a que la app principal termine su conexión con Supabase.
    setTimeout(ensureData,900);
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
