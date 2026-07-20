/* DON ZOILO V33.1 — IMPORTAR STOCK DESDE FOTO/CAPTURA
   OCR local en el navegador. Siempre requiere revisión antes de guardar. */
(function(){
  "use strict";
  const $=id=>document.getElementById(id);
  const num=v=>{const n=Number(String(v??"").replace(/\s/g,"").replace(/\.(?=\d{3}(?:\D|$))/g,"").replace(",","."));return Number.isFinite(n)?n:0};
  const money=n=>new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(Number(n||0));
  const uuid=()=>crypto.randomUUID?crypto.randomUUID():`stock-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let selectedFile=null;
  let parsedRows=[];

  const categories={
    Vacuno:["lomo","entraña","vacio","vacío","nalga","paleta","roastbeef","roast beef","tapa de asado","bife","asado","peceto","osobuco","matambre","colita","picaña","cuadril","bola de lomo","cuadrada","palomita"],
    Cerdo:["bondiola","carre","carré","churrasquito","cerdo","pechito","solomillo"],
    Pollo:["pollo","suprema","pata muslo","pata y muslo","pechuga"],
    Embutidos:["chorizo","morcilla","colorado","salchicha"],
    Achuras:["molleja","riñon","riñón","chinchulin","chinchulín","mondongo","tripa","higado","hígado"]
  };
  function categoryOf(product){const p=String(product||"").toLowerCase();for(const [cat,words] of Object.entries(categories))if(words.some(w=>p.includes(w)))return cat;return "Otros";}
  function cleanProduct(s){return String(s||"").replace(/^[\d\s.,$-]+/,"").replace(/\s{2,}/g," ").replace(/[|]/g," ").trim().toUpperCase();}
  function normalizeLine(line){return String(line||"").replace(/[|]/g," ").replace(/\s+/g," ").trim();}
  function isHeader(line){return /^(producto|mercader[ií]a|detalle|estado|unidad|kg|precio|prcio|importe|total|fecha)/i.test(line.trim());}
  function parseOcrText(text){
    const lines=String(text||"").split(/\r?\n/).map(normalizeLine).filter(Boolean);
    const out=[];
    for(const line of lines){
      if(isHeader(line)||line.length<3)continue;
      const tokens=line.match(/\d+(?:[.,]\d+)?|\$|[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:[-/][A-Za-z0-9]+)*/g)||[];
      const numbers=(line.match(/\d+(?:[.,]\d+)?/g)||[]).map(num);
      if(!numbers.length)continue;
      // Usually the last numbers in spreadsheet rows are KG, unit price and amount.
      let amount=0, unitCost=0, kg=0, quantity=0;
      if(numbers.length>=3){
        const last=numbers[numbers.length-1], prev=numbers[numbers.length-2], prev2=numbers[numbers.length-3];
        // If last approximately equals kg * price, use that structure.
        if(prev2>0&&prev>0&&Math.abs(prev2*prev-last)<=Math.max(20,last*.08)){kg=prev2;unitCost=prev;amount=last;}
        else {kg=prev2;unitCost=prev;amount=last;}
      }else if(numbers.length===2){kg=numbers[0];unitCost=numbers[1];amount=kg*unitCost;}
      else {kg=numbers[0];}
      const firstNumIndex=line.search(/\d/);
      let productPart=firstNumIndex>0?line.slice(0,firstNumIndex):line;
      productPart=productPart.replace(/\b(CONGELAD[AO]|FRESC[AO]|CAJA|CAJAS|UNID|UNIDAD|RIopla|PILOTTI|GIULIANA)\b.*$/i,m=>" "+m);
      const words=productPart.split(" ").filter(Boolean);
      let detail="";
      const detailAt=words.findIndex(w=>/CONGEL|FRESC|RIOPLA|PILOTTI|GIULIANA|CAJA|UNID|\d{1,2}-\d{1,2}/i.test(w));
      if(detailAt>0){detail=words.slice(detailAt).join(" ");productPart=words.slice(0,detailAt).join(" ");}
      const product=cleanProduct(productPart);
      if(!product||product.length<2||/^(TOTAL|KG|FECHA|PRECIO|IMPORTE)$/.test(product))continue;
      if(amount&&unitCost&&kg===0)kg=amount/unitCost;
      out.push({product,detail_status:detail,category:categoryOf(product),unit:"kg",quantity,kg,unit_cost:unitCost,notes:"Importado desde imagen"});
    }
    // Remove obvious duplicates from OCR repeated lines.
    const seen=new Set();
    return out.filter(r=>{const k=`${r.product}|${r.kg}|${r.unit_cost}`;if(seen.has(k))return false;seen.add(k);return true;});
  }

  function openDialog(){const d=$("stockImageDialog");if(d?.showModal)d.showModal();else d?.setAttribute("open","");}
  function closeDialog(){const d=$("stockImageDialog");if(d?.close)d.close();else d?.removeAttribute("open");}
  function chooseFile(){$("stockImageFile")?.click();}
  function setFile(file){
    if(!file)return;selectedFile=file;
    const img=$("stockImagePreview");img.src=URL.createObjectURL(file);img.classList.remove("hidden");
    $("stockImagePlaceholder")?.classList.add("hidden");$("stockReadImage").disabled=false;
    $("stockOcrResults")?.classList.add("hidden");parsedRows=[];
  }
  function progress(percent,text){$("stockOcrProgress").classList.remove("hidden");$("stockOcrProgressBar").style.width=`${Math.max(0,Math.min(100,percent))}%`;$("stockOcrProgressText").textContent=text;}

  async function readImage(){
    if(!selectedFile)return;
    if(!window.Tesseract)return alert("No se pudo cargar el lector de imágenes. Revisá la conexión a internet y volvé a intentar.");
    const btn=$("stockReadImage");btn.disabled=true;btn.textContent="Leyendo…";
    try{
      progress(3,"Preparando la imagen…");
      const result=await Tesseract.recognize(selectedFile,"spa",{logger:m=>{if(m.status==="recognizing text")progress(10+Math.round((m.progress||0)*85),`Reconociendo texto… ${Math.round((m.progress||0)*100)}%`);else if(m.status)progress(5,m.status);}});
      parsedRows=parseOcrText(result?.data?.text||"");
      if(!parsedRows.length){
        addBlankRow();
        alert("No se pudieron separar los productos automáticamente. Se agregó una fila para que puedas cargar o corregir los datos manualmente.");
      }
      renderRows();$("stockOcrResults").classList.remove("hidden");progress(100,"Lectura terminada. Revisá los datos antes de guardar.");
    }catch(error){console.error(error);alert("No se pudo leer la imagen: "+(error.message||error));progress(0,"No se pudo completar la lectura.");}
    finally{btn.disabled=false;btn.textContent="🔎 Reconocer productos";}
  }

  function addBlankRow(){parsedRows.push({product:"",detail_status:"",category:"Vacuno",unit:"kg",quantity:0,kg:0,unit_cost:0,notes:"Importado desde imagen"});}
  function renderRows(){
    const body=$("stockOcrBody");if(!body)return;body.innerHTML="";
    parsedRows.forEach((r,i)=>{
      const tr=document.createElement("tr");tr.dataset.index=i;
      tr.innerHTML=`<td><input class="ocr-product" value="${String(r.product||"").replace(/"/g,"&quot;")}" placeholder="Producto"></td><td><input class="ocr-detail" value="${String(r.detail_status||"").replace(/"/g,"&quot;")}" placeholder="Estado / marca"></td><td><select class="ocr-category">${["Vacuno","Cerdo","Pollo","Embutidos","Achuras","Otros"].map(c=>`<option ${c===r.category?"selected":""}>${c}</option>`).join("")}</select></td><td><input class="ocr-quantity ocr-num" type="number" step="0.01" value="${Number(r.quantity||0)}"></td><td><input class="ocr-kg ocr-num" type="number" step="0.01" value="${Number(r.kg||0)}"></td><td><input class="ocr-cost ocr-num" type="number" step="0.01" value="${Number(r.unit_cost||0)}"></td><td class="ocr-amount"><strong>${money((r.kg||r.quantity||0)*(r.unit_cost||0))}</strong></td><td><button type="button" class="ocr-remove">×</button></td>`;
      body.appendChild(tr);
    });
    updateSummary();
  }
  function syncRows(){
    parsedRows=[...$("stockOcrBody").querySelectorAll("tr")].map(tr=>({product:tr.querySelector(".ocr-product").value.trim(),detail_status:tr.querySelector(".ocr-detail").value.trim(),category:tr.querySelector(".ocr-category").value,unit:"kg",quantity:num(tr.querySelector(".ocr-quantity").value),kg:num(tr.querySelector(".ocr-kg").value),unit_cost:num(tr.querySelector(".ocr-cost").value),notes:"Importado desde imagen"}));
  }
  function updateSummary(){
    syncRows();let kg=0,value=0;parsedRows.forEach(r=>{kg+=r.kg;value+=(r.kg||r.quantity)*r.unit_cost});
    $("stockOcrRowsCount").textContent=parsedRows.filter(r=>r.product).length;$("stockOcrKgTotal").textContent=`${kg.toLocaleString("es-AR",{maximumFractionDigits:2})} kg`;$("stockOcrValueTotal").textContent=money(value);
    [...$("stockOcrBody").querySelectorAll("tr")].forEach((tr,i)=>tr.querySelector(".ocr-amount strong").textContent=money((parsedRows[i].kg||parsedRows[i].quantity)*parsedRows[i].unit_cost));
  }

  async function saveAll(){
    syncRows();const rows=parsedRows.filter(r=>r.product&&((r.kg>0)||(r.quantity>0)));
    if(!rows.length)return alert("No hay filas completas para guardar.");
    if(!confirm(`Se guardarán ${rows.length} productos en Stock. ¿Continuar?`))return;
    const now=new Date().toISOString();
    const records=rows.map(r=>({...r,id:uuid(),created_at:now,updated_at:now}));
    const client=typeof supabaseClient!=="undefined"?supabaseClient:null;
    try{
      if(client){const {error}=await client.from("inventory_stock").insert(records);if(error)throw error;}
      else {
        const key="don_zoilo_stock_v33",current=JSON.parse(localStorage.getItem(key)||"[]");localStorage.setItem(key,JSON.stringify([...current,...records]));
      }
      alert(`${records.length} productos guardados correctamente.`);closeDialog();
      $("stockRefreshBtn")?.click();
    }catch(error){alert("No se pudo guardar la importación: "+(error.message||error));}
  }

  function bind(){
    $("stockImageBtn")?.addEventListener("click",openDialog);$("stockImageClose")?.addEventListener("click",closeDialog);$("stockChooseImage")?.addEventListener("click",chooseFile);$("stockImageFile")?.addEventListener("change",e=>setFile(e.target.files?.[0]));$("stockReadImage")?.addEventListener("click",readImage);$("stockAddOcrRow")?.addEventListener("click",()=>{syncRows();addBlankRow();renderRows();});$("stockSaveOcr")?.addEventListener("click",saveAll);
    $("stockOcrBody")?.addEventListener("input",updateSummary);$("stockOcrBody")?.addEventListener("change",updateSummary);$("stockOcrBody")?.addEventListener("click",e=>{if(e.target.closest(".ocr-remove")){syncRows();parsedRows.splice(Number(e.target.closest("tr").dataset.index),1);renderRows();}});
  }
  document.readyState==="loading"?document.addEventListener("DOMContentLoaded",bind):bind();
})();
