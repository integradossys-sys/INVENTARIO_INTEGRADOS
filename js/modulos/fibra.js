/* ════════════════════════════════════════════════
   FIBRA — CATEGORÍAS Y CARRETES
════════════════════════════════════════════════ */
let _fibraCats=[], _carreteIdGasto=null;

async function cargarCategoriasFibra(){
  try{
    const res=await fetch('api/fibra.php?action=categorias',{credentials:'same-origin'});
    const dataCats=await res.json();
    if(!Array.isArray(dataCats)){
      _fibraCats=[];
      console.error('Error cargando fibra:',dataCats);
      toast('Fibra: '+((dataCats&&dataCats.error)||'el servidor devolvió un error'),'error');
      return;
    }
    _fibraCats=dataCats;
    // Poblar selects de modales
    const rcSel=document.getElementById('rcCategoria');
    if(rcSel) rcSel.innerHTML='<option value="">Seleccionar categoría…</option>'+
      _fibraCats.map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
    renderCategoriasGrid();
    // Si estamos viendo "Productos en stock", agregar/actualizar las filas de fibra ahí.
    if(document.getElementById('panel-productos')?.classList.contains('active')) renderTabla();
  }catch(e){ console.error('Error cargando fibra:',e); }
}

function renderCategoriasGrid(){
  const grid=document.getElementById('fibCategoriasGrid');
  if(!grid) return;
  if(!_fibraCats.length){
    grid.innerHTML=`<div class="!text-center !p-[48px_20px]">
      <div class="!text-[40px] !mb-[14px]">🔵</div>
      <div class="![font-family:Syne,sans-serif] !font-bold !text-[16px] !mb-[8px]">Sin categorías de fibra</div>
      <div class="!text-[13px] !text-[#94A3B8] !mb-[20px]">Crea la primera categoría para empezar</div>
      <button id="btnPrimCat" class="btn btn-primary" style="display:inline-flex;">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
        Nueva categoría
      </button>
    </div>`;
    document.getElementById('btnPrimCat')?.addEventListener('click', abrirCrearCategoria);
    return;
  }
  grid.innerHTML=_fibraCats.map(c=>`
    <div class="pcard">
      <div style="padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div class="!flex !items-center !gap-[12px]">
          <div style="width:18px;height:18px;background:${esc(c.color)};border-radius:5px;flex-shrink:0;box-shadow:0 2px 6px rgba(0,0,0,.2);"></div>
          <div>
            <div class="![font-family:Syne,sans-serif] !font-bold !text-[15px] !text-[#0F172A]">${esc(c.nombre)}</div>
            <div class="!flex !gap-[6px] !mt-[3px] !items-center">
              <span class="badge badge-brand !text-[10px]">${c.tipo}</span>
              ${c.descripcion?`<span class="!text-[11px] !text-[#94A3B8]">${esc(c.descripcion)}</span>`:''}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
          ${tienePermiso('gestionar_fibra')||sesion?.rol==='superadmin'||sesion?.rol==='distribuidor'?`<button class="btn btn-primary fib-nuevo-carrete !text-[12px] !p-[6px_14px]" data-id="${c.id}" data-nombre="${esc(c.nombre)}">
            <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
            Nuevo carrete
          </button>`:``}
          <button class="btn-sm fib-ver-carretes" data-id="${c.id}" id="btnToggleCat_${c.id}" style="background:#F1F5F9;color:#0F172A;font-weight:600;">
            📋 Ver carretes
          </button>
          ${sesion?.rol==='superadmin'?`<button class="btn-sm fib-eliminar-cat ![background:#FCEBEB] !text-[#B91C1C] p-[5px_8px]" data-id="${c.id}"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>`:''}
        </div>
      </div>
      <div id="carretsCat_${c.id}" style="display:none;border-top:1px solid #E8F4E8;"></div>
    </div>
  `).join('');

  // Eventos — necesarios porque son elementos dinámicos
  grid.querySelectorAll('.fib-nuevo-carrete').forEach(b=>{
    b.addEventListener('click', ()=>abrirRegistrarCarreteCat(b.dataset.id, b.dataset.nombre));
  });
  grid.querySelectorAll('.fib-ver-carretes').forEach(b=>{
    b.addEventListener('click', ()=>toggleCarretesCat(parseInt(b.dataset.id)));
  });
  grid.querySelectorAll('.fib-eliminar-cat').forEach(b=>{
    b.addEventListener('click', ()=>eliminarCategoria(parseInt(b.dataset.id)));
  });
}


async function toggleCarretesCat(catId){
  const panel=document.getElementById('carretsCat_'+catId);
  const btn=document.getElementById('btnToggleCat_'+catId);
  if(!panel) return;
  if(panel.style.display!=='none'){
    panel.style.display='none';
    if(btn){ btn.innerHTML='📋 Ver carretes'; btn.style.background='#F1F5F9'; btn.style.color='#0F172A'; }
    return;
  }
  if(btn){ btn.innerHTML='▲ Ocultar'; btn.style.background='#E8F8E8'; btn.style.color='#1E8F1E'; }
  panel.style.display='';
  panel.innerHTML='<div class="!p-[16px_20px] !text-[#94A3B8] !text-[13px]">Cargando carretes…</div>';
  try{
    const res=await fetch('api/fibra.php?action=listar_carretes&categoria_id='+catId+'&solo_centrales=1',{credentials:'same-origin'});
    const data=await res.json();
    if(!data.length){
      panel.innerHTML=`<div class="!p-[20px] !text-center !text-[#94A3B8] !text-[13px]">
        Sin carretes en esta categoría.
        <button onclick="abrirRegistrarCarreteCat(${catId},'')" class="btn-sm !ml-[8px] ![background:#E0F6FF] !text-[#0088BB]">+ Agregar carrete</button>
      </div>`;
      return;
    }
    panel.innerHTML=`<div class="!p-[12px_20px_16px]">
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${data.map((c,i)=>{
          const disp=parseFloat(c.metros_disponibles)||0;
          const total=parseFloat(c.metros)||0;
          const pct=total>0?Math.round((disp/total)*100):0;
          const barColor=pct>50?'#2DB82D':pct>20?'#BA7517':'#E24B4A';
          const esSuperDist=tienePermiso('gestionar_fibra');
          const puedEnviar=esSuperDist&&disp>0;
          const puedGastar=(sesion?.rol==='municipio'||sesion?.rol==='tecnico'||sesion?.rol==='persona')&&disp>0;
          return `<div style="background:#F8FAFC;border-radius:12px;padding:14px 16px;border:1.5px solid #E8F4E8;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
              <div>
                <div class="!font-bold !text-[14px] !text-[#0F172A]">
                  ${c.codigo?`<span class="![font-family:monospace] !text-[11px] ![background:#E0F6FF] !text-[#0369A1] !p-[2px_7px] !rounded-[5px] !font-bold">${esc(c.codigo)}</span>`:(`Carrete ${i+1}`)}
                </div>
                <div class="!text-[11px] !text-[#94A3B8] !mt-[2px]">${esc(c.sede_nombre)} · ${fmtDate(c.fecha)}${c.proveedor?` · 🏭 ${esc(c.proveedor)}`:''}</div>
              </div>
              <div class="!flex !items-center !gap-[10px]">
                <div class="!text-right">
                  <div style="font-family:Syne,sans-serif;font-weight:800;font-size:20px;color:${barColor};">
                    ${disp.toFixed(0)}<span class="!text-[12px] !font-normal !text-[#94A3B8]"> m</span>
                  </div>
                  <div class="!text-[11px] !text-[#94A3B8]">de ${total.toFixed(0)} m totales · ${pct}%</div>
                </div>
                ${puedEnviar?`<button onclick="abrirEnviarCarrete(${c.id},'${esc(c.cat_nombre)}',${disp})" class="btn-sm ![background:#EAF3DE] !text-[#166534]">📤 Enviar</button>`:''}
                ${puedGastar?`<button onclick="abrirGastoFibra(${c.id},'${esc(c.cat_nombre)}',${disp})" class="btn-sm ![background:#FAEEDA] !text-[#92400E]">📝 Registrar uso</button>`:''}
                ${(sesion?.rol==='superadmin'||tienePermiso('eliminar_fibra'))?`<button class="btn-sm btn-eliminar-carrete ![background:#FCEBEB] !text-[#B91C1C] p-[5px_8px]" data-id="${c.id}" data-nombre="${esc(c.codigo||c.cat_nombre)}"><svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>`:''}
              </div>
            </div>
            <div class="![background:#E2E8F0] !rounded-[99px] !h-[6px]">
              <div style="background:${barColor};border-radius:99px;height:6px;width:${pct}%;transition:width .4s;"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;

    // Eventos eliminar carrete
    panel.querySelectorAll('.btn-eliminar-carrete').forEach(b=>{
      b.addEventListener('click', ()=>{
        mostrarConfirmar({
          icono:'🗑️', color:'#E24B4A',
          titulo:'Eliminar carrete',
          desc:`¿Eliminar el carrete "${b.dataset.nombre}"? Esta acción no se puede deshacer.`,
          btnTxt:'Sí, eliminar', btnColor:'#B91C1C',
          requirePassword:true,
          onConfirmar: async()=>{
            try{
              const pi=document.getElementById('modalConfirmarPass'); const pw=(pi&&pi.value)||''; if(pi) pi.value='';
              const rr=await fetch('api/fibra.php?action=eliminar_carrete',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:parseInt(b.dataset.id),password:pw})});
              const dd=await rr.json().catch(()=>({}));
              if(!rr.ok||dd.error){ toast(dd.error||'No se pudo eliminar','error'); return; }
              toast('Carrete eliminado ✓','success');
              panel.style.display='none';
              await toggleCarretesCat(parseInt(panel.id.replace('carretsCat_','')));
            }catch(e){toast('Error al eliminar','error');}
          }
        });
      });
    });
  }catch(e){ panel.innerHTML=`<div class="!p-[16px] !text-[#E24B4A] !text-[13px]">${e.message}</div>`; }
}

function abrirRegistrarCarreteCat(catId, catNombre){
  // Poblar select con categorías disponibles
  const sel=document.getElementById('carreteCatSel');
  const lbl=document.getElementById('carreteCatLbl');
  if(sel){
    const cat=catId?(_fibraCats||[]).find(c=>String(c.id)===String(catId)):null;
    if(catId){
      // Categoría FIJA: la del carrete que se está agregando, no se puede cambiar
      sel.innerHTML=`<option value="${catId}">${esc((cat&&cat.nombre)||catNombre||('Categoría #'+catId))}</option>`;
      sel.value=catId; sel.disabled=true;
      sel.style.background='#F1F5F9'; sel.style.color='#475569'; sel.style.cursor='not-allowed';
      if(lbl) lbl.textContent='Categoría (fija)';
    } else {
      sel.disabled=false; sel.style.background=''; sel.style.color=''; sel.style.cursor='';
      sel.innerHTML='<option value="">Seleccionar categoría…</option>'+
        (_fibraCats||[]).map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
      if(lbl) lbl.textContent='Categoría';
    }
  }
  const m=document.getElementById('carreteMetros');if(m)m.value='';
  const n=document.getElementById('carreteNombre');if(n)n.value='';
  const cpv=document.getElementById('carreteProveedor');if(cpv)cpv.value='';
  const cpb=document.getElementById('carreteProveedorBuscar');if(cpb)cpb.value='';
  if(!_proveedores.length){ cargarProveedores().catch(()=>{}); }
  document.getElementById('modalRegistrarCarrete')?.classList.add('open');
  setTimeout(()=>document.getElementById('carreteNombre')?.focus(),200);
}

// Buscador de proveedor en "Registrar carrete" (mismo patrón que _filtrarProveedorIngreso).
function _filtrarProveedorCarrete(){
  const inp=document.getElementById('carreteProveedorBuscar');
  const lista=document.getElementById('carreteProveedorLista');
  if(!inp||!lista) return;
  const q=inp.value.toLowerCase().trim();
  const filtrados=_proveedores.filter(p=>p.nombre.toLowerCase().includes(q));
  const estilo="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;";
  let html=`<div onclick="_seleccionarProveedorCarrete('','Sin proveedor')" style="${estilo}color:#94A3B8;">Sin proveedor</div>`;
  if(filtrados.length){
    html+=filtrados.map(p=>`<div onclick="_seleccionarProveedorCarrete('${esc(p.nombre).replace(/'/g,'')}','${esc(p.nombre).replace(/'/g,'')}')" style="${estilo}">${esc(p.nombre)}</div>`).join('');
  } else if(q){
    html+=`<div class="!p-[10px_12px] !text-[12px] !text-[#94A3B8]">Sin coincidencias. Crea el proveedor en la sección "Proveedores".</div>`;
  }
  lista.innerHTML=html;
  lista.style.display='block';
}
function _seleccionarProveedorCarrete(valor, texto){
  document.getElementById('carreteProveedor').value=valor;
  document.getElementById('carreteProveedorBuscar').value=valor?texto:'';
  document.getElementById('carreteProveedorLista').style.display='none';
}
document.addEventListener('click', function(e){
  const cont=document.getElementById('carreteProveedorLista');
  const inp=document.getElementById('carreteProveedorBuscar');
  if(cont && inp && !inp.contains(e.target) && !cont.contains(e.target)) cont.style.display='none';
});

async function confirmarRegistrarCarrete(){
  const catId=parseInt(document.getElementById('carreteCatSel')?.value||0);
  const metros=parseFloat(document.getElementById('carreteMetros')?.value||0);
  const nombre=(document.getElementById('carreteNombre')?.value||'').trim();
  const proveedor=(document.getElementById('carreteProveedor')?.value||'').trim();
  if(!catId){toast('Selecciona una categoría','error');return;}
  if(!metros||metros<=0){toast('Ingresa los metros del carrete','error');return;}
  const catTxt=(document.getElementById('carreteCatSel')?.selectedOptions?.[0]?.textContent||'').trim();
  if(!(await _confirmarRegistroLlegada('este carrete', `un carrete de ${metros} m${catTxt?` de ${catTxt}`:''}${nombre?` (${nombre})`:''}`))) return;
  try{
    const res=await fetch('api/fibra.php?action=registrar_carrete',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({categoria_id:catId,metros,nombre,proveedor,sede:'Almacen Central'})
    });
    const data=await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error');
    cerrarModal('modalRegistrarCarrete');
    toast(`${data.codigo||''} — Carrete de ${metros} m registrado ✓`,'success');
    const panel=document.getElementById('carretsCat_'+catId);
    if(panel){ panel.style.display='none'; await toggleCarretesCat(catId); }
  }catch(e){toast(e.message,'error');}
}


async function abrirCrearCategoria(){
  const n=document.getElementById('catFibNombre');if(n)n.value='';
  const d=document.getElementById('catFibDesc');if(d)d.value='';
  const pv=document.getElementById('catFibProveedor');        if(pv) pv.value='';
  const pvb=document.getElementById('catFibProveedorBuscar'); if(pvb) pvb.value='';
  if(!_proveedores.length){ await cargarProveedores().catch(()=>{}); }
  document.getElementById('modalCrearCategoria')?.classList.add('open');
  setTimeout(()=>document.getElementById('catFibNombre')?.focus(),200);
}


async function confirmarCrearCategoria(){
  const nombre=(document.getElementById('catFibNombre')?.value||'').trim();
  const desc=(document.getElementById('catFibDesc')?.value||'').trim();
  const color='#2DB82D'; // color por defecto
  if(!nombre){toast('El nombre es obligatorio','error');return;}
  try{
    const res=await fetch('api/fibra.php?action=crear_categoria',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({nombre,descripcion:desc,color})
    });
    const data=await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error');
    cerrarModal('modalCrearCategoria');
    toast('Categoría "'+nombre+'" creada ✓','success');
    await cargarCategoriasFibra();
  }catch(e){toast(e.message,'error');}
}
async function eliminarCategoria(id){
  try{
    const r=await fetch('api/fibra.php?action=puede_eliminar_categoria&id='+id,{credentials:'same-origin'});
    const p=await r.json();
    if(p && p.ok===false){
      mostrarConfirmar({icono:'🚫',color:'#D97706',titulo:'No se puede eliminar la categoría',desc:p.motivo||'La categoría tiene carretes.',btnTxt:'Entendido',btnColor:'#D97706',onConfirmar:()=>{}});
      return;
    }
  }catch(e){ /* el servidor vuelve a validar */ }
  mostrarConfirmar({
    icono:'🗑️', color:'#E24B4A',
    titulo:'Eliminar categoría',
    desc:'¿Seguro que quieres eliminar esta categoría? Esta acción no se puede deshacer. Escribe tu contraseña para confirmar.',
    btnTxt:'Sí, eliminar', btnColor:'#B91C1C',
    requirePassword:true,
    onConfirmar: async()=>{
      const pi=document.getElementById('modalConfirmarPass'); const pw=(pi&&pi.value)||''; if(pi) pi.value='';
      try{
        const res=await fetch('api/fibra.php?action=eliminar_categoria',{
          method:'POST',credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({id,password:pw})
        });
        const d=await res.json().catch(()=>({}));
        if(!res.ok||d.error){
          if(d.bloqueado) mostrarConfirmar({icono:'🚫',color:'#D97706',titulo:'No se puede eliminar la categoría',desc:d.error,btnTxt:'Entendido',btnColor:'#D97706',onConfirmar:()=>{}});
          else toast(d.error||'No se pudo eliminar','error');
          return;
        }
        toast('Categoría eliminada ✓','success');
        await cargarCategoriasFibra();
      }catch(e){toast(e.message,'error');}
    }
  });
}

/* Enviar carrete a municipio */
let _carreteIdEnviar=null;
let _carreteMetrosDisponibles=0;
function abrirEnviarCarrete(carreteId,catNombre,disponibles){
  _carreteIdEnviar=carreteId;
  _carreteMetrosDisponibles=disponibles;
  const info=document.getElementById('enviarCarreteInfo');
  if(info) info.innerHTML='<strong>'+catNombre+'</strong> — <span class="!text-[#2DB82D]">'+disponibles+' m disponibles</span>';
  const metrosEl=document.getElementById('enviarCarreteMetros');
  if(metrosEl){ metrosEl.value=''; metrosEl.disabled=false; }
  const checkCompleto = document.getElementById('enviarCarreteCompletoCheck');
  if(checkCompleto) checkCompleto.checked = false;
  // Poblar destinos
  const buscUsrCarrete = document.getElementById('enviarCarreteBuscarUsuario');
  if(buscUsrCarrete) buscUsrCarrete.value = '';
  document.getElementById('enviarCarreteUsuarioValor').value = '';
  document.getElementById('enviarCarreteDestino').value = '';
  document.getElementById('enviarCarreteUsuarioResultados').style.display = 'none';
  document.getElementById('modalEnviarCarrete')?.classList.add('open');
}
function _toggleEnviarCarreteCompleto(){
  const checked = document.getElementById('enviarCarreteCompletoCheck')?.checked;
  const metrosEl = document.getElementById('enviarCarreteMetros');
  if(!metrosEl) return;
  if(checked){
    metrosEl.value = _carreteMetrosDisponibles;
    metrosEl.disabled = true;
  } else {
    metrosEl.value = '';
    metrosEl.disabled = false;
  }
}
let _carreteUsuariosCache = null;
async function _filtrarUsuarioCarrete(){
  const q = (document.getElementById('enviarCarreteBuscarUsuario')?.value||'').toLowerCase().trim();
  const cont = document.getElementById('enviarCarreteUsuarioResultados');
  if(!cont) return;
  if(!q){ cont.style.display='none'; return; }
  if(!_carreteUsuariosCache){
    try{
      const res = await fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'});
      _carreteUsuariosCache = await res.json();
      if(!Array.isArray(_carreteUsuariosCache)) _carreteUsuariosCache = [];
    }catch(e){ _carreteUsuariosCache = []; }
  }
  const encontrados = _carreteUsuariosCache.filter(u=>
    (u.nombre||'').toLowerCase().includes(q) || (u.apellido||'').toLowerCase().includes(q) || (u.usuario||'').toLowerCase().includes(q)
  );
  cont.innerHTML = encontrados.length
    ? encontrados.map(u=>`<div onclick="_seleccionarUsuarioCarrete('${u.usuario}','${(u.nombre||'')} ${(u.apellido||'')} @${u.usuario}','${esc(u.sede||'')}')" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #F1F5F9;font-size:13px;" onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'"><b>${(u.nombre||'')} ${(u.apellido||'')}</b> <span class="!text-[#94A3B8]">@${u.usuario} · ${u.sede||''} · ${u.rol||''}</span></div>`).join('')
    : '<div class="!p-[10px] !text-center !text-[#94A3B8] !text-[12px]">Sin resultados</div>';
  cont.style.display = 'block';
}
function _seleccionarUsuarioCarrete(usuario, etiqueta, sede){
  document.getElementById('enviarCarreteUsuarioValor').value = usuario;
  document.getElementById('enviarCarreteDestino').value = sede;
  document.getElementById('enviarCarreteBuscarUsuario').value = etiqueta;
  document.getElementById('enviarCarreteUsuarioResultados').style.display = 'none';
}
async function confirmarEnviarCarrete(){
  const esCompleto = document.getElementById('enviarCarreteCompletoCheck')?.checked;
  const metros=parseFloat(document.getElementById('enviarCarreteMetros')?.value||0);
  const destino=document.getElementById('enviarCarreteDestino')?.value||'';
  const destinatarioEsp = document.getElementById('enviarCarreteUsuarioValor')?.value||'';
  if(!metros||metros<=0){toast('Ingresa los metros a enviar','error');return;}
  if(!destinatarioEsp||!destino){toast('Busca y elige a quién se lo envías','error');return;}
  if(!_carreteIdEnviar){toast('Error: carrete no seleccionado','error');return;}
  const descripcion = `Envío a ${destino}\nRecoge en persona: ${destinatarioEsp}`;
  try{
    const res=await fetch('api/fibra.php?action='+(esCompleto?'enviar_carrete_completo':'enviar_metros'),{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({carrete_id:_carreteIdEnviar,metros,destino,descripcion})
    });
    const data=await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error');
    cerrarModal('modalEnviarCarrete');
    toast(metros+' m enviados a '+destino+' — revisa Seguimiento para despacharlo ✓','success');
    await Promise.all([cargarCategoriasFibra(), (typeof _recargarSeguimiento==='function'?_recargarSeguimiento():Promise.resolve())]);
  }catch(e){toast(e.message,'error');}
}
let _gastoEsSaldo=false;

/* Botón "Enviar"/"Solicitar" de una fila de fibra en la tabla de Productos en stock.
   Enruta según el rol, reutilizando los flujos de fibra que ya existen. */
let _catFibraEditId=null;
async function abrirEditarCategoriaFibra(catId){
  const cat=_fibraCats.find(c=>String(c.id)===String(catId));
  if(!cat){ toast('Categoría no encontrada','error'); return; }
  if(!_proveedores.length){ await cargarProveedores().catch(()=>{}); }
  _catFibraEditId=catId;
  const n=document.getElementById('editCatFibNombre'); if(n) n.value=cat.nombre||'';
  const d=document.getElementById('editCatFibDesc');    if(d) d.value=cat.descripcion||'';
  const pv=document.getElementById('editCatFibProveedor');        if(pv) pv.value=cat.proveedor||'';
  const pvb=document.getElementById('editCatFibProveedorBuscar'); if(pvb) pvb.value=cat.proveedor||'';
  document.getElementById('modalEditarCategoriaFibra')?.classList.add('open');
}
async function confirmarEditarCategoriaFibra(){
  const nombre=(document.getElementById('editCatFibNombre')?.value||'').trim();
  const descripcion=(document.getElementById('editCatFibDesc')?.value||'').trim();
  if(!nombre){ toast('El nombre es obligatorio','error'); return; }
  if(!_catFibraEditId){ toast('Error: categoría no seleccionada','error'); return; }
  try{
    const cat=_fibraCats.find(c=>String(c.id)===String(_catFibraEditId));
    const res=await _api('fibra','editar_categoria',{id:_catFibraEditId,nombre,descripcion,color:cat?.color||'#2DB82D'});
    if(res.error) throw new Error(res.error);
    cerrarModal('modalEditarCategoriaFibra');
    toast('Categoría actualizada ✓','success');
    await cargarCategoriasFibra();
  }catch(e){ toast(e.message,'error'); }
}

async function abrirEnviarOSolicitarFibraTabla(catId){
  const cat = _fibraCats.find(c=>String(c.id)===String(catId));
  if(!cat){ toast('Categoría no encontrada','error'); return; }
  const esAdmin = sesion.rol==='superadmin'||sesion.rol==='distribuidor';

  if(!esAdmin){
    // Solicitar: abre el modal con esta categoría ya fija (no un desplegable),
    // porque el usuario ya la eligió al hacer clic en esta fila.
    await abrirSolicitarFibra(catId);
    return;
  }

  // Enviar (superadmin/distribuidor): hace falta un carrete específico de origen.
  try{
    const carretes = await _api('fibra','listar_carretes',null,`categoria_id=${catId}&solo_centrales=1`);
    const disponibles=(carretes||[]).filter(c=>parseFloat(c.metros_disponibles||0)>0);
    if(!disponibles.length){ toast('No hay carretes con stock disponible en esta categoría.','error'); return; }
    if(disponibles.length===1){
      const c=disponibles[0];
      abrirEnviarCarrete(c.id, cat.nombre, parseFloat(c.metros_disponibles));
      return;
    }
    _mostrarSelectorCarreteFibra(disponibles, cat.nombre);
  }catch(e){ toast('No se pudieron cargar los carretes de esta categoría.','error'); }
}

/* Cuando una categoría tiene varios carretes en el almacén, deja elegir cuál usar
   (esto ya cubre "carrete completo": basta con no editar el campo de metros
   después, que llega pre-cargado con el total disponible de ese carrete). */
function _mostrarSelectorCarreteFibra(carretes, catNombre){
  const wrap=document.getElementById('elegirCarreteFibraLista');
  if(!wrap) return;
  wrap.innerHTML=carretes.map(c=>{
    const disp=parseFloat(c.metros_disponibles||0);
    return `<button class="btn-sm sel-carrete-fibra" data-id="${c.id}" data-disp="${disp}" style="text-align:left;padding:12px 14px;background:#F8FAFC;border:1.5px solid #E2E8F0;border-radius:10px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
              <span class="!font-semibold">${esc(c.codigo||('Carrete #'+c.id))}</span>
              <span class="!text-[#16A871] !font-bold">${disp.toFixed(0)} m</span>
            </button>`;
  }).join('');
  wrap.querySelectorAll('.sel-carrete-fibra').forEach(b=>{
    b.addEventListener('click', ()=>{
      cerrarModal('modalElegirCarreteFibra');
      abrirEnviarCarrete(parseInt(b.dataset.id), catNombre, parseFloat(b.dataset.disp));
    });
  });
  document.getElementById('modalElegirCarreteFibra')?.classList.add('open');
}

let _carreteIdDevolver=null;
function abrirDevolverFibra(carreteId,catNombre,disponibles){
  _carreteIdDevolver=carreteId;
  const info=document.getElementById('devolverFibraInfo');
  if(info) info.innerHTML='<strong>'+catNombre+'</strong> — <span class="!text-[#2DB82D]">'+disponibles.toFixed(0)+' m disponibles en tu sede</span>';
  if(document.getElementById('dfMetros')) document.getElementById('dfMetros').value='';
  if(document.getElementById('dfDesc'))   document.getElementById('dfDesc').value='';
  document.getElementById('modalDevolverFibra')?.classList.add('open');
}
async function confirmarDevolverFibra(){
  const metros=parseFloat(document.getElementById('dfMetros')?.value||0);
  const desc=(document.getElementById('dfDesc')?.value||'').trim();
  if(!metros||metros<=0){toast('Ingresa los metros a devolver','error');return;}
  if(!_carreteIdDevolver){toast('Error: carrete no seleccionado','error');return;}
  // Pasa por la misma ventana que los demás productos: elegir Almacén Central u oficina (municipio) y quién lo lleva.
  const nombreCar = (document.getElementById('devolverFibraInfo')?.querySelector('strong')?.textContent) || 'Fibra';
  cerrarModal('modalDevolverFibra');
  _pendienteDevolverStock = {items:[], recogidos:[], fibra:[{carrete_id:_carreteIdDevolver, cantidad:metros, nombre:nombreCar}], motivo:desc, rollos:{}};
  document.getElementById('tdDevTipo').value = 'stock_multiple';
  document.getElementById('tdDevId').value = '';
  const cw = document.getElementById('tdDevCantidadWrap'); if(cw) cw.style.display = 'none';
  document.getElementById('tdDevSubtitulo').textContent = `🧵 ${nombreCar} (${metros} m) — queda en camino hasta que lo confirmen recibido.`;
  _tdDevLimpiarUsuario();
  document.getElementById('tdDevBuscarUsuario').value = '';
  document.getElementById('tdDevNombreExterno').value = '';
  document.getElementById('tdDevNotas').value = '';
  document.getElementById('tdDevAlerta').className = 'alerta';
  document.querySelector('input[name="tdDevTransporte"][value="usuario"]').checked = true;
  _toggleTdDevTransporte();
  _tdDevCargarUsuarios();
  _tdDevPonerDestino(true);
  document.getElementById('modalTransporteDevolucion').classList.add('open');
}

function abrirGastoFibra(carreteId,catNombre,disponibles){
  _carreteIdGasto=carreteId;
  _gastoEsSaldo=false;
  const info=document.getElementById('gastoFibraInfo');
  if(info) info.innerHTML='<strong>'+catNombre+'</strong> — <span class="!text-[#2DB82D]">'+disponibles.toFixed(0)+' m disponibles</span>';
  if(document.getElementById('gfMetros')) document.getElementById('gfMetros').value='';
  if(document.getElementById('gfClienteProyecto')) document.getElementById('gfClienteProyecto').value='';
  if(document.getElementById('gfDesc'))   document.getElementById('gfDesc').value='';
  document.getElementById('modalGastoFibra')?.classList.add('open');
}

async function confirmarGastoFibra(){
  const metros=parseFloat(document.getElementById('gfMetros')?.value||0);
  const desc=(document.getElementById('gfDesc')?.value||'').trim();
  const proyectoCliente=(document.getElementById('gfClienteProyecto')?.value||'').trim();
  if(!metros||metros<=0){toast('Ingresa los metros a registrar','error');return;}
  if(!proyectoCliente){toast('Escribe el Cliente/Proyecto — es obligatorio para registrar el uso.','error');return;}
  if(!_carreteIdGasto){toast('Error: no seleccionado','error');return;}
  try{
    const body=_gastoEsSaldo
      ?{saldo_id:_carreteIdGasto,metros,descripcion:desc,proyecto_cliente:proyectoCliente}
      :{carrete_id:_carreteIdGasto,metros,descripcion:desc,proyecto_cliente:proyectoCliente};
    const res=await fetch('api/fibra.php?action=registrar_gasto_fibra',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    const data=await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error');
    cerrarModal('modalGastoFibra');
    toast(metros+' m registrados ✓','success');
    if(_gastoEsSaldo){
      await cargarMiFibra();
    } else {
      // Refrescar tanto la vista de administración como "Mis equipos" (Carretes e Historial),
      // para que el descuento se vea al instante sin tener que recargar la página.
      await Promise.all([
        cargarCategoriasFibra().catch(()=>{}),
        cargarMiFibra().catch(()=>{}),
        (document.getElementById('meHistFibraGrid') ? cargarHistFibra() : Promise.resolve()).catch(()=>{}),
      ]);
      // También refrescar el caché de "mi fibra" que usa la fila de fibra en
      // Productos en stock, para que el botón "Gastar" quede con el saldo real.
      if(Array.isArray(window._misFibraCache)){
        try{
          const r = await fetch('api/fibra.php?action=mis_carretes',{credentials:'same-origin'});
          window._misFibraCache = await r.json();
        }catch(e){}
        if(typeof renderTabla==='function') renderTabla();
      }
    }
  }catch(e){toast(e.message,'error');}
}

/* ════════════════════════════════════════════════
   ONT — CAMBIAR ESTADO
════════════════════════════════════════════════ */
function cambiarEstadoOnt(nuevoEstado){
  if(!_ontIdEditar){ toast('Error: ONT no seleccionada','error'); return; }
  if(nuevoEstado==='comodato'){
    cerrarModal('modalEstadoOnt');
    // La oficina no instala: elige a la persona y la ONT solo pasa a comodato cuando esa persona acepta e instala.
    if(sesion?.rol==='municipio'){
      toast('Elige quién la instalará: la ONT queda en comodato cuando esa persona acepte e instale.','info');
      _abrirAsignarOntTecnico(_ontIdEditar, 'ONT #'+_ontIdEditar);
      return;
    }
    abrirInstalacionOnt(_ontIdEditar);
    return;
  }
  fetch('api/cajas.php?action=cambiar_estado_ont',{
    method:'POST', credentials:'same-origin',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ont_id: _ontIdEditar, estado: nuevoEstado})
  }).then(r=>r.json()).then(data=>{
    if(data.error) throw new Error(data.error);
    cerrarModal('modalEstadoOnt');
    toast('Estado actualizado ✓','success');
    if(document.getElementById('ontInventarioGrid')) cargarInventarioOnt();
    else if(document.getElementById('meOntGrid')) cargarMisOnt();
  }).catch(e=>toast(e.message||'Error','error'));
}


let _ontIdEditar=null;