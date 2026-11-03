/* ════════════════════════════════════════════════
   GASTAR (municipio / técnico)
════════════════════════════════════════════════ */
// ════════════════════════════════════════════════
//  PROVEEDORES
// ════════════════════════════════════════════════
let _proveedores=[];

// Render de los modelos como chips en el panel de Ingreso por escaneo
function renderChipsModelosOnt(){
  const cont = document.getElementById('ontModelosChips');
  const card = document.getElementById('ontModelosCard');
  const cnt  = document.getElementById('ontModelosContador');
  if(!cont) return;
  // Mostrar el panel solo a quien puede gestionar (superadmin/distribuidor)
  if(card){
    const puede = sesion && (sesion.rol==='superadmin' || sesion.rol==='distribuidor');
    card.style.display = puede ? '' : 'none';
    if(!puede) return;
  }
  if(cnt) cnt.textContent = _modelosOnt.length ? `(${_modelosOnt.length})` : '';
  // Mantener los desplegables de modelo sincronizados
  if(typeof _llenarSelectsModeloOnt==='function') _llenarSelectsModeloOnt();
  if(!_modelosOnt.length){
    cont.innerHTML = '<span class="!text-[12px] !text-[#94A3B8]">No hay modelos. Crea el primero con "Nuevo modelo".</span>';
    return;
  }
  cont.innerHTML = _modelosOnt.map(m=>`
    <span class="!inline-flex !items-center !gap-[6px] ![background:#F1F5F9] ![border:1px_solid_#E2E8F0] !rounded-[99px] !p-[4px_6px_4px_12px] !text-[12px]">
      <span class="!font-semibold !text-[#0F172A]">${esc(m.nombre)}</span>
      ${m.marca?`<span class="!text-[#64748B] !text-[11px]">· ${esc(m.marca)}</span>`:''}
      <button class="![background:#EFF6FF] !text-[#1D4ED8] ![border:none] !rounded-[50%] !w-[20px] !h-[20px] !cursor-pointer !text-[10px]" onclick="abrirEditarModeloOnt(${m.id})" title="Editar">✎</button>
      <button class="![background:#FEF2F2] !text-[#B91C1C] ![border:none] !rounded-[50%] !w-[20px] !h-[20px] !cursor-pointer !text-[10px]" onclick="eliminarModeloOnt(${m.id},'${esc(m.nombre).replace(/'/g,'')}')" title="Eliminar">✕</button>
    </span>`).join('');
}

// Cargar modelos al entrar a Ingreso por escaneo
async function cargarModelosEnEscaneo(){
  await cargarModelosOnt();
  renderChipsModelosOnt();
  _llenarSelectsModeloOnt();
}

// Llenar los desplegables de modelo (ONT nueva e histórica) con los modelos creados
function _llenarSelectsModeloOnt(){
  ['ontModeloInput','histModelo'].forEach(id=>{
    const sel = document.getElementById(id);
    if(!sel || sel.tagName!=='SELECT') return;
    const actual = sel.value;
    const opts = '<option value="">Selecciona un modelo…</option>' +
      _modelosOnt.map(m=>`<option value="${esc(m.nombre)}">${esc(m.nombre)}${m.marca?` — ${esc(m.marca)}`:''}</option>`).join('');
    sel.innerHTML = opts;
    if(actual) sel.value = actual; // conservar selección si seguía válida
  });
  // Filtro de categoría en la tabla de inventario (usa solo el nombre, sin marca).
  const selFiltro = document.getElementById('ontInvFiltroModelo');
  if(selFiltro){
    const actual = selFiltro.value;
    selFiltro.innerHTML = '<option value="">Todas las categorías</option>' +
      _modelosOnt.map(m=>`<option value="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
    if(actual) selFiltro.value = actual;
  }
}

async function cargarProveedores(){
  try{
    const res=await fetch('api/proveedores.php?action=listar',{credentials:'same-origin'});
    const data=await res.json();
    _proveedores=Array.isArray(data)?data:[];
  }catch(e){ _proveedores=[]; }
}

// Buscador de proveedor en el formulario de producto
function filtrarProveedorProducto(){
  const inp=document.getElementById('proveedorBuscar');
  const lista=document.getElementById('proveedorLista');
  if(!inp||!lista) return;
  const q=inp.value.toLowerCase().trim();
  const filtrados=_proveedores.filter(p=>p.nombre.toLowerCase().includes(q));
  let html=`<div onclick="seleccionarProveedorProducto('','Sin proveedor')" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;color:#94A3B8;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">Sin proveedor</div>`;
  if(filtrados.length){
    html+=filtrados.map(p=>`<div onclick="seleccionarProveedorProducto('${esc(p.nombre).replace(/'/g,'')}','${esc(p.nombre).replace(/'/g,'')}')" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">🏭 ${esc(p.nombre)}</div>`).join('');
  } else if(q){
    html+=`<div class="!p-[10px_12px] !text-[12px] !text-[#94A3B8]">Sin coincidencias. Crea el proveedor en la sección "Proveedores".</div>`;
  }
  lista.innerHTML=html;
  lista.style.display='block';
}

function seleccionarProveedorProducto(valor, texto){
  document.getElementById('proveedor').value=valor;
  document.getElementById('proveedorBuscar').value=valor?texto:'';
  document.getElementById('proveedorLista').style.display='none';
}

// Cerrar la lista del buscador de proveedor al hacer clic fuera.
document.addEventListener('click', function(e){
  const cont=document.getElementById('proveedorLista');
  const inp=document.getElementById('proveedorBuscar');
  if(cont && inp && !inp.contains(e.target) && !cont.contains(e.target)){
    cont.style.display='none';
  }
});

async function abrirGestionProveedores(){
  document.getElementById('modalProveedores').classList.add('open');
  await cargarProveedores();
  renderListaProveedores();
}

// Render del panel de proveedores (sección del menú)
function renderPanelProveedores(){
  const cont=document.getElementById('panelProveedoresLista');
  if(!cont) return;
  const q=(document.getElementById('buscarProveedorPanel')?.value||'').toLowerCase().trim();
  // Resaltado amarillo de la coincidencia.
  const hlProv=(txt)=>{
    txt=String(txt==null?'':txt);
    if(!q||!txt) return esc(txt);
    const idx=txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      +`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`
      +esc(txt.slice(idx+q.length));
  };
  const lista=_proveedores.filter(p=>
    !q || p.nombre.toLowerCase().includes(q) ||
    (p.contacto||'').toLowerCase().includes(q) ||
    (p.telefono||'').toLowerCase().includes(q) ||
    (p.nit||'').toLowerCase().includes(q) ||
    (p.correo||'').toLowerCase().includes(q)
  );
  if(!lista.length){
    cont.innerHTML=`<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[30px]">${_proveedores.length?'Sin coincidencias.':'No hay proveedores aún. Crea el primero con el botón "Nuevo proveedor".'}</div>`;
    return;
  }
  cont.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:16px;">`+
    lista.map(p=>{
      const prods=(_productos||[]).filter(x=>(x.proveedor||'').toLowerCase()===p.nombre.toLowerCase());
      const prodsHtml=prods.length
        ? `<div class="!mt-[10px] !pt-[10px] ![border-top:1px_solid_#F1F5F9]">
             <div class="!text-[10px] !font-bold !text-[#94A3B8] !uppercase !tracking-[.8px] !mb-[6px]">Productos asociados</div>
             <div style="display:flex;flex-wrap:wrap;gap:5px;">${prods.map(x=>`<span class="![background:#E6F1FB] !text-[#0A58B5] !rounded-[20px] !p-[3px_10px] !text-[11px] !font-semibold">${esc(x.nombre)}</span>`).join('')}</div>
           </div>`
        : `<div class="!mt-[10px] !pt-[10px] ![border-top:1px_solid_#F1F5F9] !text-[11px] !text-[#CBD5E1]">Sin productos asociados aún</div>`;

      const waBtn=p.telefono
        ? `<a class="!inline-flex !items-center !gap-[6px] !p-[6px_12px] !rounded-[20px] ![background:#25D366] ![color:white] ![text-decoration:none] !text-[12px] !font-semibold" href="https://wa.me/57${p.telefono.replace(/\D/g,'')}?text=${encodeURIComponent(_waSaludoProveedor(p))}" target="_blank" title="WhatsApp">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.128.558 4.127 1.535 5.858L0 24l6.335-1.518A11.945 11.945 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.891 0-3.667-.497-5.207-1.371l-.371-.219-3.862.926.971-3.77-.242-.389A9.941 9.941 0 012 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/></svg>
            WhatsApp</a>` : '';

      const callBtn=p.telefono
        ? `<a class="!inline-flex !items-center !gap-[6px] !p-[6px_12px] !rounded-[20px] ![background:#E6F1FB] !text-[#0A58B5] ![text-decoration:none] !text-[12px] !font-semibold" href="tel:${p.telefono.replace(/\D/g,'')}" title="Llamar">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="#0A58B5" stroke-width="2"><path stroke-linecap="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
            Llamar</a>` : '';

      const mailBtn=p.correo
        ? `<button class="!inline-flex !items-center !gap-[6px] !p-[6px_12px] !rounded-[20px] ![background:#FAEEDA] !text-[#92400E] ![border:none] !cursor-pointer !text-[12px] !font-semibold" onclick="abrirCorreoProveedor('${esc(p.correo)}'.replace(/\'/g,''))" title="Email">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="#92400E" stroke-width="2"><path stroke-linecap="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
            Email</button>` : '';

      const contactBtns=(waBtn||callBtn||mailBtn)
        ? `<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:12px;">${waBtn}${callBtn}${mailBtn}</div>` : '';

      return `
      <div style="border:1.5px solid #E2E8F0;border-radius:16px;padding:18px;background:white;box-shadow:0 1px 4px rgba(0,0,0,.04);transition:box-shadow .2s,border-color .2s;"
           onmouseover="this.style.boxShadow='0 6px 20px rgba(0,0,0,.09)';this.style.borderColor='#C7D7F0'"
           onmouseout="this.style.boxShadow='0 1px 4px rgba(0,0,0,.04)';this.style.borderColor='#E2E8F0'">
        <div class="!flex !justify-between !items-start !gap-[8px] !mb-[10px]">
          <div class="!flex !items-center !gap-[8px]">
            <div style="width:38px;height:38px;background:#EDE9FE;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:18px;">🏭</div>
            <div class="![font-family:Syne,sans-serif] !font-bold !text-[15px] !text-[#0F172A]">${hlProv(p.nombre)}</div>
          </div>
          <div style="display:flex;gap:5px;flex-shrink:0;">
            ${tienePermiso('editar_proveedores')?`<button class="![background:#E6F1FB] !text-[#0A58B5] ![border:none] !rounded-[8px] !p-[5px_10px] !cursor-pointer !text-[11px] !font-semibold" onclick="abrirEditarProveedor(${p.id})">Editar</button>`:''}
            ${tienePermiso('eliminar_proveedores')?`<button onclick="eliminarProveedor(${p.id},'${esc(p.nombre).replace(/'/g,"\\'")}');" style="background:#FEF2F2;color:#B91C1C;border:none;border-radius:8px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:600;">Eliminar</button>`:''}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px;">
          ${p.nit?`<div class="!text-[12px] !text-[#475569] !font-semibold">🏢 NIT/RUT: ${hlProv(p.nit)}</div>`:'<div class="!text-[12px] !text-[#B45309]">⚠️ Sin NIT/RUT — edítalo para completarlo</div>'}
          ${p.contacto?`<div class="!flex !items-center !gap-[6px] !text-[12px] !text-[#475569]"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#94A3B8" stroke-width="2"><path stroke-linecap="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>${hlProv(p.contacto)}</div>`:''}
          ${p.telefono?`<div class="!flex !items-center !gap-[6px] !text-[12px] !text-[#475569]"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#94A3B8" stroke-width="2"><path stroke-linecap="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>${hlProv(p.telefono)}</div>`:''}
          ${p.correo?`<div class="!flex !items-center !gap-[6px] !text-[12px] !text-[#475569]"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#94A3B8" stroke-width="2"><path stroke-linecap="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>${hlProv(p.correo)}</div>`:''}
          ${p.direccion?`<div class="!flex !items-center !gap-[6px] !text-[12px] !text-[#475569]"><svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="#94A3B8" stroke-width="2"><path stroke-linecap="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>${esc(p.direccion)}</div>`:''}
          ${p.nota?`<div class="!text-[11px] !text-[#94A3B8] ![font-style:italic] !mt-[2px]">${esc(p.nota)}</div>`:''}
          ${!p.contacto&&!p.telefono&&!p.correo?'<div class="!text-[12px] !text-[#CBD5E1]">Sin datos de contacto aún</div>':''}
        </div>
        ${contactBtns}
        ${prodsHtml}
      </div>`;
    }).join('')+`</div>`;
}

// Abrir el modal de nuevo proveedor desde el panel
function abrirNuevoProveedorPanel(){
  document.getElementById('modalProveedores').classList.add('open');
  renderListaProveedores();
}

// ════════ PEDIR ONTs (municipio desde Mis equipos) ════════
let _dispEquiposCentral = null;
async function _cargarDispEquiposCentral(){
  try{
    const res = await fetch('api/equipos.php?action=disponibilidad_equipos_central', {credentials:'same-origin'});
    _dispEquiposCentral = await res.json();
  }catch(e){ _dispEquiposCentral = null; /* si falla, no se bloquea — el servidor igual valida al enviar */ }
}
function _dispParaTipo(tipo){
  if(!_dispEquiposCentral) return null; // desconocido — no se sabe, no se bloquea en el cliente
  if(String(tipo).toUpperCase()==='OLT') return _dispEquiposCentral.OLT ?? 0;
  return _dispEquiposCentral.tipos?.[tipo] ?? 0;
}
function _solEquipoActualizarDisponible(){
  const tipo = document.getElementById('solEquipoTipo')?.value || '';
  const msg = document.getElementById('solEquipoDisponibleMsg');
  const btn = document.querySelector('#modalSolicitarEquipo .btn-primary');
  if(!msg) return;
  if(!tipo || _dispEquiposCentral===null){ msg.style.display='none'; if(btn) btn.disabled=false; return; }
  const disp = _dispParaTipo(tipo);
  msg.style.display = 'block';
  if(disp<=0){
    msg.innerHTML = `⚠ No hay ${esc(tipo)} disponibles en el almacén ahora mismo — no se puede pedir.`;
    msg.style.color = '#DC2626';
    if(btn) btn.disabled = true;
  } else {
    msg.innerHTML = `✓ ${disp} ${esc(tipo)} disponible${disp!==1?'s':''} en el almacén`;
    msg.style.color = '#166534';
    if(btn) btn.disabled = false;
  }
}
async function abrirSolicitarEquipo(tipoFijo){
  // Poblar tipos
  if(!_tiposEquipo.length) await cargarTiposEquipo();
  await _cargarDispEquiposCentral();
  const sel = document.getElementById('solEquipoTipo');
  if(sel){
    if(tipoFijo){
      sel.innerHTML = `<option value="${esc(tipoFijo)}" selected>${esc(tipoFijo)}</option>`;
      sel.disabled = true;
      const msg=document.getElementById('solEquipoTipoFijoMsg'); if(msg) msg.style.display='';
    } else {
      // Se muestra cuántos hay de cada uno en el almacén, y se deshabilitan
      // (sin quitarlos) los que estén en 0 — así se ve de una vez qué SÍ se
      // puede pedir, en vez de dejar elegir algo que después el servidor
      // igual va a rechazar.
      const dispOlt = _dispParaTipo('OLT');
      sel.innerHTML = '<option value="">Selecciona un tipo…</option>'
        + `<option value="OLT" ${dispOlt===0?'disabled':''}>🖧 OLT${_dispEquiposCentral?` — ${dispOlt} disp.`:''}</option>`
        + _tiposEquipo.map(t=>{
            const disp = _dispParaTipo(t.nombre);
            return `<option value="${esc(t.nombre)}" ${disp===0?'disabled':''}>${t.icono} ${esc(t.nombre)}${_dispEquiposCentral?` — ${disp} disp.`:''}</option>`;
          }).join('');
      sel.disabled = false;
      const msg=document.getElementById('solEquipoTipoFijoMsg'); if(msg) msg.style.display='none';
    }
  }
  ['solEquipoNota'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const cantEl=document.getElementById('solEquipoCantidad'); if(cantEl) cantEl.value='';
  const dispMsg=document.getElementById('solEquipoDisponibleMsg'); if(dispMsg) dispMsg.style.display='none';
  const btnEnv = document.querySelector('#modalSolicitarEquipo .btn-primary'); if(btnEnv) btnEnv.disabled=false;
  document.getElementById('modalSolicitarEquipo')?.classList.add('open');
  if(tipoFijo) _solEquipoActualizarDisponible();
}

async function enviarSolicitudEquipo(){
  const tipo     = (document.getElementById('solEquipoTipo')?.value||'').trim();
  const cantidad = parseInt(document.getElementById('solEquipoCantidad')?.value||'0');
  const nota     = (document.getElementById('solEquipoNota')?.value||'').trim();
  if(!tipo){     toast('Selecciona el tipo de equipo','error'); return; }
  if(!cantidad){ toast('Indica la cantidad','error'); return; }
  // Si ya sabemos que no hay disponible, ni se manda — el servidor lo
  // rechazaría igual, pero así se avisa de inmediato sin el viaje de red.
  const disp = _dispParaTipo(tipo);
  if(disp!==null && disp<=0){
    toast(`No hay ${tipo} disponibles en el almacén ahora mismo.`,'error');
    return;
  }
  if(disp!==null && cantidad>disp){
    toast(`Solo hay ${disp} ${tipo} disponible(s) en el almacén.`,'error');
    return;
  }
  try{
    const res = await _api('solicitudes','crear',{
      ref: 'EQUIPO::'+tipo,
      nombre: tipo,
      destino: sesion.sede,
      cantidad,
      unidadEnvio: 'unidad',
      nota: nota || `Solicitud de ${tipo} desde ${sesion.sede}`,
      solicitadoPor: sesion.usuario
    });
    if(res?.error) throw new Error(res.error);
    cerrarModal('modalSolicitarEquipo');
    toast(`Solicitud de ${tipo} enviada ✓`,'success');
    await _recargarSolicitudes();
  }catch(e){ toast(e.message||'Error al enviar solicitud','error'); }
}

let _devolverEqData = null;
function abrirDevolverEquipo(tipo, id, nombre){
  _devolverEqData = {tipo, id, nombre};
  const el = document.getElementById('devolverEqNombre');
  if(el) el.textContent = `"${nombre}"`;
  document.getElementById('modalConfirmarDevolverEquipo')?.classList.add('open');
}
async function confirmarDevolverEquipo(){
  if(!_devolverEqData) return;
  const {tipo, id, nombre} = _devolverEqData;
  cerrarModal('modalConfirmarDevolverEquipo');
  try{
    const res = await fetch('api/equipos.php?action=devolver_equipo',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({tipo, id, sede_origen: sesion.sede, enviado_por: sesion.usuario})
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error');
    toast(`"${nombre}" en camino al almacén ✓`,'success');
    await cargarMisMikrotik();
    if(typeof _recargarSeguimiento==='function') _recargarSeguimiento();
  }catch(e){ toast(e.message,'error'); }
  _devolverEqData = null;
}

let _asgEqData = null;
let _asgEqUsuariosCache = null;
function abrirAsignarEquipo(tipo, id, nombre){
  if(sesion?.rol==='distribuidor'){ return abrirEnviarEquipo(tipo, id, nombre); }
  _asgEqData = {tipo, id, nombre};
  const el = document.getElementById('asgEqNombre');
  if(el) el.textContent = `"${nombre}"`;
  const buscar = document.getElementById('asgEqBuscarUsuario');
  if(buscar) buscar.value = '';
  const valor = document.getElementById('asgEqUsuarioValor');
  if(valor) valor.value = '';
  const nota = document.getElementById('asgEqNota');
  if(nota) nota.value = '';
  const res = document.getElementById('asgEqUsuarioResultados');
  if(res){ res.style.display='none'; res.innerHTML=''; }
  document.getElementById('modalAsignarEquipo')?.classList.add('open');
}
async function _asgEqFiltrarUsuario(){
  const q = (document.getElementById('asgEqBuscarUsuario')?.value||'').toLowerCase().trim();
  const cont = document.getElementById('asgEqUsuarioResultados');
  if(!cont) return;
  // No se muestra la lista completa: solo aparecen coincidencias cuando se empieza a escribir.
  if(!q){ cont.style.display='none'; cont.innerHTML=''; return; }
  if(!_asgEqUsuariosCache){
    try{
      const res = await fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'});
      _asgEqUsuariosCache = await res.json();
      if(!Array.isArray(_asgEqUsuariosCache)) _asgEqUsuariosCache = [];
    }catch(e){ _asgEqUsuariosCache = []; }
  }
  // Solo técnico/persona/municipio pueden recibir un equipo asignado
  // directamente (igual que valida el backend) — nunca distribuidor
  // (es el almacén de origen, no un destino) ni otro admin.
  const encontrados = _asgEqUsuariosCache.filter(u=>
    u.usuario!==sesion.usuario &&
    ['tecnico','persona','municipio'].includes(u.rol) &&
    ((u.nombre||'')+' '+(u.apellido||'')+' '+(u.usuario||'')).toLowerCase().includes(q)
  ).slice(0,8);
  cont.innerHTML = encontrados.length
    ? encontrados.map(u=>`<div onclick="_asgEqSeleccionarUsuario('${u.usuario}','${(u.nombre||'')} ${(u.apellido||'')} @${u.usuario}')" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #F1F5F9;font-size:13px;" onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'"><b>${(u.nombre||'')} ${(u.apellido||'')}</b> <span class="!text-[#94A3B8]">@${u.usuario} · ${u.rol||''}</span></div>`).join('')
    : '<div class="!p-[10px] !text-center !text-[#94A3B8] !text-[12px]">Sin resultados</div>';
  cont.style.display = 'block';
}
function _asgEqSeleccionarUsuario(usuario, etiqueta){
  document.getElementById('asgEqUsuarioValor').value = usuario;
  document.getElementById('asgEqBuscarUsuario').value = etiqueta;
  document.getElementById('asgEqUsuarioResultados').style.display = 'none';
}
async function confirmarAsignarEquipo(){
  if(!_asgEqData) return;
  const {tipo, id, nombre} = _asgEqData;
  const aQuien = (document.getElementById('asgEqUsuarioValor')?.value||'').trim();
  if(!aQuien){ toast('Busca y selecciona una persona de la lista','error'); return; }
  const nota = (document.getElementById('asgEqNota')?.value||'').trim();
  try{
    const res = await fetch('api/equipos.php?action=asignar_equipo_persona',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({tipo, id, a_quien: aQuien, nota})
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error');
    cerrarModal('modalAsignarEquipo');
    toast(`Asignado ✓ — va en camino a ${aQuien}; solo debe confirmar que lo recibió`,'success');
    if(tipo==='olt') cargarMisOlt(); else cargarMisMikrotik();
    if(typeof _recargarSeguimiento==='function') _recargarSeguimiento();
  }catch(e){ toast(e.message,'error'); }
  _asgEqData = null;
}

async function abrirPedirOnt(){
  // Cargar modelos disponibles en el selector
  const sel = document.getElementById('pedirOntModelo');
  if(sel) sel.innerHTML = '<option value="">Cargando modelos…</option>';
  document.getElementById('pedirOntCantidad').value = '';
  document.getElementById('pedirOntNotas').value = '';
  document.getElementById('modalPedirOnt').classList.add('open');
  try{
    await cargarModelosOnt();
    if(sel){
      if(_modelosOnt.length){
        sel.innerHTML = '<option value="">Selecciona un modelo…</option>' +
          _modelosOnt.map(m=>`<option value="${esc(m.nombre)}">${esc(m.nombre)}${m.marca?` — ${esc(m.marca)}`:''}</option>`).join('');
      } else {
        sel.innerHTML = '<option value="">No hay modelos registrados aún</option>';
      }
    }
  }catch(e){ if(sel) sel.innerHTML='<option value="">Error al cargar modelos</option>'; }
}

// Cuenta ONTs disponibles de un modelo específico (tabla ont_seriales real),
// usando el endpoint agrupado por modelo. Devuelve null si no se pudo verificar
// (para no bloquear el pedido por un problema de red, p.ej.).
async function _ontStockDisponibleModelo(modelo){
  try{
    const res = await fetch('api/cajas.php?action=onts_disponibles_modelo', {credentials:'same-origin'});
    const data = await res.json();
    const rows = Array.isArray(data?.almacen) ? data.almacen : null;
    if(!Array.isArray(rows)) return null;
    const m = String(modelo||'').toLowerCase().trim();
    const exacto = rows.find(r => String(r.modelo||'').toLowerCase().trim() === m);
    if(exacto) return parseInt(exacto.cantidad)||0;
    const parcial = rows.find(r => {
      const rm = String(r.modelo||'').toLowerCase().trim();
      return rm.includes(m) || m.includes(rm);
    });
    return parcial ? (parseInt(parcial.cantidad)||0) : 0;
  }catch(e){ return null; }
}

async function enviarPedidoOnt(){
  const modelo = document.getElementById('pedirOntModelo')?.value || '';
  const cant   = parseInt(document.getElementById('pedirOntCantidad')?.value || '0');
  const notas  = (document.getElementById('pedirOntNotas')?.value || '').trim();

  if(!modelo){ toast('Selecciona un modelo de ONT','error'); return; }
  if(!cant || cant<1){ toast('Indica una cantidad válida','error'); return; }

  // Validar stock REAL disponible de ese modelo (tabla ont_seriales) antes de enviar.
  const disp = await _ontStockDisponibleModelo(modelo);
  if(disp !== null && cant > disp){
    toast(`Solo hay ${disp} ONT(s) "${modelo}" disponibles en almacén. Ajusta la cantidad.`,'error');
    return;
  }

  try{
    const res = await fetch('api/pedidos_agrupados.php?action=crear',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        items: [{ ref:'ONT::'+modelo, nombre:'📡 ONT — '+modelo, cantidad:cant, unidad:'unidad' }],
        destino: sesion.sede || sesion.sede_nombre || '',
        nota: notas || `Pedido de ${cant} ONT(s) modelo ${modelo}`
      })
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error');
    await Promise.all([_recargarSolicitudes?.(), _recargarPedidosAgrupados?.()]);
    cerrarModal('modalPedirOnt');
    if(typeof renderSolicitudes==='function') renderSolicitudes();
    if(typeof updateNotifBadges==='function') updateNotifBadges();
    toast(`✅ Pedido enviado — ${cant} ONT${cant!==1?'s':''} ${modelo}`,'success');
  }catch(e){ toast(e.message||'Error al enviar pedido','error'); }
}

// ════════ MODELOS DE ONT ════════
let _modelosOnt = [];
async function cargarModelosOnt(){
  try{
    const res = await fetch('api/modelos_ont.php?action=listar',{credentials:'same-origin'});
    const data = await res.json();
    _modelosOnt = Array.isArray(data) ? data : [];
  }catch(e){ _modelosOnt = []; }
}

async function _guardarIdMikrowispInline(id, input){
  const m = _modelosOnt.find(x=>x.id===id);
  if(!m) return;
  const nuevoId = input.value.trim();
  try{
    const res = await fetch('api/modelos_ont.php?action=actualizar',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({id:m.id, nombre:m.nombre, marca:m.marca||'', descripcion:m.descripcion||'', id_mikrowisp:nuevoId})
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error al guardar');
    m.id_mikrowisp = nuevoId || null;
    toast(nuevoId?`✓ ID MikroWisp "${nuevoId}" asignado a "${m.nombre}"`:'ID MikroWisp quitado','success');
    renderPanelModelosOnt();
  }catch(e){ toast(e.message,'error'); }
}

function renderPanelModelosOnt(){
  // El panel ahora vive en "Ingreso por escaneo" como chips.
  if(typeof renderChipsModelosOnt==='function') renderChipsModelosOnt();
  const cont = document.getElementById('panelModelosOntLista');
  if(!cont) return;
  const q = (document.getElementById('buscarModeloOntPanel')?.value||'').toLowerCase().trim();
  const hl = (txt)=>{
    txt = String(txt==null?'':txt);
    if(!q||!txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))+`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`+esc(txt.slice(idx+q.length));
  };
  const lista = _modelosOnt.filter(m=>
    !q || m.nombre.toLowerCase().includes(q) || (m.marca||'').toLowerCase().includes(q)
  );
  if(!lista.length){
    cont.innerHTML = `<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[30px]">${_modelosOnt.length?'Sin coincidencias.':'No hay modelos aún. Crea el primero con "Nuevo modelo".'}</div>`;
    return;
  }
  cont.innerHTML = `<table class="!w-[100%] ![border-collapse:collapse] !text-[13px]">
    <thead><tr style="background:#F8FAFC;text-align:left;">
      <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Nombre</th>
      <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Marca</th>
      <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">ID MikroWisp</th>
      <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Descripción</th>
      <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Acciones</th>
    </tr></thead>
    <tbody>
      ${lista.map(m=>`
        <tr class="![border-bottom:1px_solid_#F1F5F9]">
          <td class="!p-[8px_10px] !font-bold">📡 ${hl(m.nombre)}</td>
          <td class="!p-[8px_10px] !text-[#64748B]">${m.marca?hl(m.marca):'—'}</td>
          <td class="!p-[8px_10px]">
            <input type="text" value="${esc(m.id_mikrowisp||'')}" placeholder="— sin asignar"
              onchange="_guardarIdMikrowispInline(${m.id}, this)"
              style="width:90px;border:1.5px solid ${m.id_mikrowisp?'#DDD6FE':'#E2E8F0'};background:${m.id_mikrowisp?'#EDE9FE':'#F8FAFC'};color:${m.id_mikrowisp?'#5B21B6':'#94A3B8'};border-radius:6px;padding:4px 8px;font-size:12px;font-weight:${m.id_mikrowisp?'700':'400'};">
          </td>
          <td class="!p-[8px_10px] !text-[#94A3B8] !text-[12px]">${m.descripcion?hl(m.descripcion):'—'}</td>
          <td class="!p-[8px_10px] !whitespace-nowrap">
            <button onclick="abrirEditarModeloOnt(${m.id})" class="btn-sm ![background:#EFF6FF] !text-[#1D4ED8]">Editar</button>
            <button onclick="eliminarModeloOnt(${m.id},'${esc(m.nombre).replace(/'/g,"\\'")}')" class="btn-sm" style="background:#FEF2F2;color:#B91C1C;">Eliminar</button>
          </td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

function abrirListaModelos(){
  const buscar = document.getElementById('buscarModeloOntPanel'); if(buscar) buscar.value='';
  renderPanelModelosOnt();
  document.getElementById('modalListaModelos')?.classList.add('open');
}

function abrirNuevoModeloOnt(){
  document.getElementById('modeloOntId').value='';
  document.getElementById('modeloOntNombre').value='';
  document.getElementById('modeloOntMarca').value='';
  document.getElementById('modeloOntIdMkw').value='';
  document.getElementById('modeloOntDesc').value='';
  document.getElementById('modeloOntTitulo').textContent='Nuevo modelo de ONT';
  document.getElementById('modalModeloOnt').classList.add('open');
  setTimeout(()=>document.getElementById('modeloOntNombre')?.focus(),150);
}

function abrirEditarModeloOnt(id){
  const m = _modelosOnt.find(x=>x.id===id);
  if(!m) return;
  document.getElementById('modeloOntId').value=m.id;
  document.getElementById('modeloOntNombre').value=m.nombre||'';
  document.getElementById('modeloOntMarca').value=m.marca||'';
  document.getElementById('modeloOntIdMkw').value=m.id_mikrowisp||'';
  document.getElementById('modeloOntDesc').value=m.descripcion||'';
  document.getElementById('modeloOntTitulo').textContent='Editar modelo de ONT';
  document.getElementById('modalModeloOnt').classList.add('open');
}

async function guardarModeloOnt(){
  const id     = document.getElementById('modeloOntId').value;
  const nombre = (document.getElementById('modeloOntNombre').value||'').trim();
  const marca  = (document.getElementById('modeloOntMarca').value||'').trim();
  const idMkw  = (document.getElementById('modeloOntIdMkw').value||'').trim();
  const desc   = (document.getElementById('modeloOntDesc').value||'').trim();
  if(!nombre){ toast('Escribe el nombre del modelo','error'); return; }
  try{
    const accion = id ? 'actualizar' : 'crear';
    const res = await fetch(`api/modelos_ont.php?action=${accion}`,{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ id: id?parseInt(id):undefined, nombre, marca, id_mikrowisp:idMkw, descripcion:desc })
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error');
    await cargarModelosOnt();
    renderPanelModelosOnt();
    _llenarSelectsModeloOnt();
    cerrarModal('modalModeloOnt');
    toast(id?`Modelo actualizado ✓`:`Modelo "${nombre}" creado ✓`,'success');
  }catch(e){ toast(e.message||'Error al guardar','error'); }
}

function eliminarModeloOnt(id,nombre){
  mostrarConfirmar({
    icono:'🗑️', color:'#E24B4A',
    titulo:`¿Eliminar el modelo "${nombre}"?`,
    desc:'Ya no aparecerá al registrar o pedir ONTs. Las ONTs que ya tienen este modelo no se modifican.',
    btnTxt:'Eliminar', btnColor:'#E24B4A',
    onConfirmar: async()=>{
      try{
        const res = await fetch('api/modelos_ont.php?action=eliminar',{
          method:'POST', credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ id })
        });
        const d = await res.json();
        if(!res.ok||d.error) throw new Error(d.error||'Error');
        await cargarModelosOnt();
        renderPanelModelosOnt();
        toast('Modelo eliminado.','success');
      }catch(e){ toast(e.message||'Error al eliminar','error'); }
    }
  });
}

function renderListaProveedores(){
  const cont=document.getElementById('listaProveedores');
  if(!cont) return;
  if(!_proveedores.length){
    cont.innerHTML='<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[20px]">No hay proveedores aún. Crea el primero arriba.</div>';
    return;
  }
  cont.innerHTML=_proveedores.map(p=>`
    <div class="!flex !justify-between !items-start !gap-[10px] !p-[11px_12px] ![border:1px_solid_#E2E8F0] !rounded-[10px] !mb-[8px]">
      <div class="![flex:1] !min-w-[0]">
        <div class="!font-bold !text-[14px]">🏭 ${esc(p.nombre)}</div>
        ${p.nit?`<div class="!text-[12px] !text-[#64748B] !mt-[2px]">🏢 NIT/RUT: ${esc(p.nit)}</div>`:''}
        ${p.contacto?`<div class="!text-[12px] !text-[#64748B] !mt-[2px]">👤 ${esc(p.contacto)}</div>`:''}
        ${p.telefono?`<div class="!text-[12px] !text-[#64748B]">📞 ${esc(p.telefono)}</div>`:''}
        ${p.correo?`<div class="!text-[12px] !text-[#64748B]">✉️ ${esc(p.correo)}</div>`:''}
        ${p.direccion?`<div class="!text-[12px] !text-[#64748B]">📍 ${esc(p.direccion)}</div>`:''}
        ${p.nota?`<div class="!text-[11px] !text-[#94A3B8] !mt-[3px]">${esc(p.nota)}</div>`:''}
      </div>
      <button onclick="eliminarProveedor(${p.id},'${esc(p.nombre)}')" style="flex-shrink:0;background:#FEF2F2;color:#B91C1C;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px;display:${tienePermiso('eliminar_proveedores')?'inline-block':'none'};">Eliminar</button>
    </div>`).join('');
}

function abrirCorreoProveedor(correo){
  if(!correo) return;
  const dominio = correo.split('@')[1]?.toLowerCase() || '';
  let url;
  if(dominio.includes('gmail'))        url = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(correo)}`;
  else if(dominio.includes('hotmail') || dominio.includes('outlook') || dominio.includes('live') || dominio.includes('msn'))
                                        url = `https://outlook.live.com/mail/0/deeplink/compose?to=${encodeURIComponent(correo)}`;
  else if(dominio.includes('yahoo'))   url = `https://compose.mail.yahoo.com/?to=${encodeURIComponent(correo)}`;
  else                                  url = `mailto:${correo}`; // fallback genérico
  window.open(url, '_blank');
}

// NIT/RUT: solo números, puntos y guion, mínimo 6 dígitos (ej: 901593819-1)
function _nitValidoProv(v){ v=String(v||'').replace(/\s+/g,''); return /^[0-9][0-9.\-]*$/.test(v) && v.replace(/\D/g,'').length>=6 && v.length<=20; }
let _provEditId = null;
function abrirEditarProveedor(id){
  const p = _proveedores.find(x=>x.id===id||x.id===String(id));
  if(!p){ toast('Proveedor no encontrado','error'); return; }
  _provEditId = id;
  document.getElementById('editProvNombre').value    = p.nombre    || '';
  document.getElementById('editProvNit').value       = p.nit       || '';
  document.getElementById('editProvContacto').value  = p.contacto  || '';
  document.getElementById('editProvTelefono').value  = p.telefono  || '';
  document.getElementById('editProvCorreo').value    = p.correo    || '';
  document.getElementById('editProvDireccion').value = p.direccion || '';
  document.getElementById('editProvIdMikrowisp').value = p.id_mikrowisp || '';
  document.getElementById('editProvNota').value      = p.nota      || '';
  document.getElementById('modalEditarProveedor').classList.add('open');
}
async function guardarEdicionProveedor(){
  const nombre = (document.getElementById('editProvNombre')?.value||'').trim();
  if(!nombre){ toast('La razón social es obligatoria','error'); return; }
  const nitEd = (document.getElementById('editProvNit')?.value||'').trim();
  if(!nitEd){ toast('El NIT/RUT de la empresa es obligatorio.','error'); return; }
  if(!_nitValidoProv(nitEd)){ toast('El NIT/RUT no es válido — usa solo números (ej: 901593819-1)','error'); return; }
  const contactoEd = (document.getElementById('editProvContacto')?.value||'').trim();
  if(!contactoEd){ toast('La persona de contacto es obligatoria.','error'); return; }
  if(!_nombreSoloLetras(contactoEd)){ toast('La persona de contacto solo puede llevar letras (sin números).','error'); return; }
  const telefonoEd = (document.getElementById('editProvTelefono')?.value||'').trim();
  if(!telefonoEd){ toast('El teléfono es obligatorio.','error'); return; }
  const correo = (document.getElementById('editProvCorreo')?.value||'').trim();
  if(correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)){
    toast('El correo no tiene un formato válido (ej: nombre@gmail.com)','error'); return;
  }
  try{
    const res = await fetch('api/proveedores.php?action=actualizar',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        id: _provEditId,
        nombre,
        nit: nitEd,
        contacto:  contactoEd,
        telefono:  telefonoEd,
        correo,
        direccion: (document.getElementById('editProvDireccion')?.value||'').trim(),
        id_mikrowisp: (document.getElementById('editProvIdMikrowisp')?.value||'').trim(),
        nota:      (document.getElementById('editProvNota')?.value||'').trim(),
      })
    });
    const r = await res.json();
    if(!res.ok||r.error) throw new Error(r.error||'Error');
    cerrarModal('modalEditarProveedor');
    toast(`Proveedor actualizado ✓`,'success');
    await cargarProveedores();
    renderPanelProveedores();
  }catch(e){ toast(e.message,'error'); }
}

async function crearProveedor(){
  const nombre=(document.getElementById('provNombre')?.value||'').trim();
  if(!nombre){ toast('La razón social es obligatoria.','error'); return; }
  const nit=(document.getElementById('provNit')?.value||'').trim();
  if(!nit){ toast('El NIT/RUT de la empresa es obligatorio.','error'); return; }
  if(!_nitValidoProv(nit)){ toast('El NIT/RUT no es válido — usa solo números (ej: 901593819-1)','error'); return; }
  const contacto=(document.getElementById('provContacto')?.value||'').trim();
  if(!contacto){ toast('La persona de contacto es obligatoria.','error'); return; }
  if(!_nombreSoloLetras(contacto)){ toast('La persona de contacto solo puede llevar letras (sin números).','error'); return; }
  const telefono=(document.getElementById('provTelefono')?.value||'').trim();
  if(!telefono){ toast('El teléfono es obligatorio.','error'); return; }
  const correo=(document.getElementById('provCorreo')?.value||'').trim();
  if(correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)){
    toast('El correo no tiene un formato válido (ej: nombre@gmail.com)','error'); return;
  }
  const datos={
    nombre,
    nit,
    contacto,
    telefono,
    correo,
    direccion:(document.getElementById('provDireccion')?.value||'').trim(),
    id_mikrowisp:(document.getElementById('provIdMikrowisp')?.value||'').trim(),
    nota:(document.getElementById('provNota')?.value||'').trim()
  };
  try{
    const res=await fetch('api/proveedores.php?action=crear',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(datos)
    });
    const r=await res.json();
    if(!res.ok) throw new Error(r.error||'Error');
    // Limpiar formulario
    ['provNombre','provNit','provContacto','provTelefono','provCorreo','provDireccion','provIdMikrowisp','provNota'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    await cargarProveedores();
    renderListaProveedores();
    if(typeof renderPanelProveedores==='function') renderPanelProveedores();
    toast(`Proveedor "${nombre}" creado exitosamente ✓`,'success');
    // Cerrar la ventana de crear proveedor
    cerrarModal('modalProveedores');
  }catch(e){ toast(e.message||'Error al crear proveedor','error'); }
}

async function eliminarProveedor(id,nombre){
  mostrarConfirmar({
    icono:'🗑️', color:'#E24B4A',
    titulo:'¿Eliminar proveedor?',
    desc:`Se eliminará "${nombre}" de la lista. Si tiene productos asignados, no se podrá eliminar hasta que se les cambie el proveedor.`,
    btnTxt:'Eliminar', btnColor:'#E24B4A',
    requirePassword:true,
    onConfirmar: async()=>{
      try{
        const res=await fetch('api/proveedores.php?action=eliminar',{
          method:'POST',credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body:JSON.stringify({id})
        });
        const r=await res.json();
        if(!res.ok){
          const msg = r.error||'Error';
          if(msg.includes('todavía hay')){
            mostrarAlertaBloqueo(msg, 'No se puede eliminar');
          } else {
            toast(msg,'error');
          }
          return;
        }
        await cargarProveedores();
        renderListaProveedores();
        if(typeof renderPanelProveedores==='function') renderPanelProveedores();
        toast('Proveedor eliminado.','success');
      }catch(e){ toast(e.message||'Error al eliminar','error'); }
    }
  });
}

// Municipio / técnico / persona NO pueden asignarle material al distribuidor ni al
// administrador (ellos no gastan nada; a ellos solo se les devuelve con "Devolver").
function _destinoAsignablePorMi(u){
  const miRol = (typeof sesion!=='undefined' && sesion && sesion.rol) || '';
  if(['municipio','tecnico','persona'].includes(miRol) && ['superadmin','distribuidor'].includes(u.rol)) return false;
  return true;
}
function abrirAsignar(idx){
  if(sesion?.rol==='distribuidor'){ toast('El distribuidor no asigna: solo entrega (usa Envío directo / Enviar a una oficina).','warn'); return; }
  const p=getProductos()[idx];if(!p)return;
  window._asignarIdx = idx;
  const disponible = (p.stockUsuario||0);
  if(disponible<=0 && (sesion.rol==='superadmin')){
    toast('No tienes inventario personal de este producto. "Asignar" reparte lo que tienes contigo (recibido, recogido o devuelto); para sacar del almacén central usa "Enviar".','error'); return;
  }
  document.getElementById('asignarNombreShow').value=`${p.ref} — ${p.nombre}`;
  document.getElementById('asignarStockShow').value=`${valorMostrar(p,disponible)} ${sufijoMostrar(p)}`;
  document.getElementById('asignarBuscarUsuario').value='';
  document.getElementById('asignarUsuarioValor').value='';
  document.getElementById('asignarUsuarioResultados').style.display='none';
  document.getElementById('cantidadAsignar').value='';
  document.getElementById('motivoAsignar').value='';
  // Si el producto viene empacado en rollos iguales (ej: DROP), lo que se
  // escribe aquí son ROLLOS (igual que el "Disponible" de arriba), no metros
  // sueltos — se convierte a metros al confirmar.
  const lblCant = document.getElementById('asignarCantidadLabel');
  if(lblCant) lblCant.textContent = p.metrosPorUnidad ? 'Cantidad a asignar (rollos)' : 'Cantidad a asignar';
  document.getElementById('modalAsignar').classList.add('open');
}
let _asignarUsuariosCache = null;
async function _asignarFiltrarUsuario(){
  const q = (document.getElementById('asignarBuscarUsuario')?.value||'').toLowerCase().trim();
  const cont = document.getElementById('asignarUsuarioResultados');
  if(!cont) return;
  if(!_asignarUsuariosCache){
    try{
      const res = await fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'});
      _asignarUsuariosCache = await res.json();
      if(!Array.isArray(_asignarUsuariosCache)) _asignarUsuariosCache = [];
    }catch(e){ _asignarUsuariosCache = []; }
  }
  const encontrados = _asignarUsuariosCache.filter(u=>
    u.usuario!==sesion.usuario &&
    _destinoAsignablePorMi(u) &&
    (!q || (u.nombre||'').toLowerCase().includes(q) || (u.apellido||'').toLowerCase().includes(q) || (u.usuario||'').toLowerCase().includes(q))
  );
  cont.innerHTML = encontrados.length
    ? encontrados.map(u=>`<div onclick="_asignarSeleccionarUsuario('${u.usuario}','${(u.nombre||'')} ${(u.apellido||'')} @${u.usuario}')" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #F1F5F9;font-size:13px;" onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'"><b>${(u.nombre||'')} ${(u.apellido||'')}</b> <span class="!text-[#94A3B8]">@${u.usuario} · ${u.rol||''}</span></div>`).join('')
    : '<div class="!p-[10px] !text-center !text-[#94A3B8] !text-[12px]">Sin resultados</div>';
  cont.style.display = 'block';
}
function _asignarSeleccionarUsuario(usuario, etiqueta){
  document.getElementById('asignarUsuarioValor').value = usuario;
  document.getElementById('asignarBuscarUsuario').value = etiqueta;
  document.getElementById('asignarUsuarioResultados').style.display = 'none';
}
async function confirmarAsignar(){
  const p=getProductos()[window._asignarIdx];if(!p)return;
  const aQuien = document.getElementById('asignarUsuarioValor').value;
  const cantidadInput = parseInt(document.getElementById('cantidadAsignar').value||'0');
  const nota = (document.getElementById('motivoAsignar').value||'').trim();
  if(!aQuien){ toast('Busca y elige a quién se lo asignas','error'); return; }
  if(!cantidadInput||cantidadInput<=0){ toast('Escribe una cantidad válida','error'); return; }
  // Si es "por rollo" (metrosPorUnidad), lo que se escribió son ROLLOS —
  // se convierte a metros antes de enviar, igual que en Enviar/Solicitar.
  const cantidad = p.metrosPorUnidad ? cantidadInput * p.metrosPorUnidad : cantidadInput;
  try{
    const res = await _api('productos','asignar_a_persona',{ref:p.ref, cantidad, a_quien:aQuien, nota});
    if(res.error){ toast(res.error,'error'); return; }
    cerrarModal('modalAsignar');
    toast(`Asignado a ${aQuien} — queda en camino hasta que confirme recibido ✓`,'success');
    _avisoCorreoAsignacion(res.correo,aQuien);
    await _recargarProductos();
    renderTabla(); renderStats();
  }catch(e){ toast('Error al asignar','error'); }
}
async function abrirDevolverProducto(idx){
  const p=getProductos()[idx];if(!p)return;
  _devolverIdx=idx;
  const stockMunicipio=p.stockUsuario||0,suf=sufijoP(p);
  document.getElementById('devolverNombreShow').value=`${p.ref} — ${p.nombre}`;
  document.getElementById('devolverStockShow').value=`${valorMostrar(p,stockMunicipio)} ${sufijoMostrar(p)} disponibles`;
  document.getElementById('devolverSedeLabel').textContent=sesion.sede;
  document.getElementById('cantidadDevolver').value='';
  document.getElementById('motivoDevolver').value='';
  window._devolverRolloIdsElegidos = [];

  const tipoWrap = document.getElementById('devolverRolloTipoWrap');
  const cantWrap = document.getElementById('devolverCantidadWrap');
  if(p.metrosPorUnidad){
    tipoWrap.style.display = 'block';
    cantWrap.style.display = 'none';
    try{
      const res = await fetch(`api/productos.php?action=mis_rollos&ref=${encodeURIComponent(p.ref)}`, {credentials:'same-origin'});
      const rollos = await res.json();
      window._devolverMisRollos = Array.isArray(rollos) ? rollos : [];
    }catch(e){ window._devolverMisRollos = []; }
    const cont = document.getElementById('devolverRolloCheckList');
    const rollos = window._devolverMisRollos;
    cont.innerHTML = rollos.length
      ? rollos.map((r,i)=>`
          <label class="!flex !items-center !gap-[8px] !text-[13px] !cursor-pointer !p-[4px]">
            <input type="checkbox" value="${r.id}" data-metros="${r.metros_disponibles}" onchange="_devolverRollosActualizar()">
            Rollo ${i+1} — ${parseFloat(r.metros_disponibles).toFixed(1)} m disponibles
          </label>`).join('')
      : '<div class="!text-[12px] !text-[#94A3B8]">No tienes rollos disponibles</div>';
    _devolverRollosActualizar();
  } else {
    tipoWrap.style.display = 'none';
    cantWrap.style.display = 'block';
  }
  const _dvD=document.getElementById('devolverDestinoTxt');
  if(_dvD) _dvD.textContent = (sesion.rol==='tecnico'||sesion.rol==='persona') ? '📍 Al enviar eliges: Almacén Central o tu oficina.' : '📍 Se devuelve al Almacén Central';
  document.getElementById('modalDevolver').classList.add('open');
}
function _devolverRollosActualizar(){
  const marcados = [...document.querySelectorAll('#devolverRolloCheckList input:checked')];
  window._devolverRolloIdsElegidos = marcados.map(el=>el.value);
  const totalMetros = marcados.reduce((s,el)=>s+parseFloat(el.dataset.metros||0),0);
  document.getElementById('cantidadDevolver').value = Math.round(totalMetros);
}
let _pendienteDevolverStock = null;
async function confirmarDevolver(){
  const p=getProductos()[_devolverIdx];if(!p)return;
  const esPorRollo = !!p.metrosPorUnidad;
  if(esPorRollo && !(window._devolverRolloIdsElegidos||[]).length){ toast('Elige al menos un rollo','error'); return; }
  const cantidad=parseInt(document.getElementById('cantidadDevolver').value||'0');
  const motivo=(document.getElementById('motivoDevolver').value||'').trim();
  if(!cantidad||cantidad<=0){ toast('Escribe una cantidad válida','error'); return; }
  cerrarModal('modalDevolver');
  _pendienteDevolverStock = {ref:p.ref, cantidad, motivo, rollo_ids: esPorRollo ? window._devolverRolloIdsElegidos : undefined};
  document.getElementById('tdDevTipo').value = 'stock';
  document.getElementById('tdDevId').value = '';
  document.getElementById('tdDevCantidadWrap').style.display = 'none';
  // El servidor decide el destino real: tu municipio si tiene una cuenta
  // activa que pueda confirmarlo, o el almacén central si no — así que aquí
  // solo se avisa en general, sin prometer un destino que después el
  // servidor podría no usar.
  const destinoTxtDev = (sesion.rol==='tecnico'||sesion.rol==='persona') ? `tu municipio (${sesion.sede}) o el almacén central` : 'el almacén';
  document.getElementById('tdDevSubtitulo').textContent = `${p.nombre} (${cantidad}) — queda en camino hasta que lo confirmen recibido en ${destinoTxtDev}.`;
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

let _gastarEsMetros = false;
function _filtrarCantidadGastar(el){
  if(_gastarEsMetros){
    // Permite decimales (ej: 12.5 metros) — solo dígitos y un punto.
    let v = el.value.replace(/[^0-9.]/g,'');
    const partes = v.split('.');
    if(partes.length>2) v = partes[0]+'.'+partes.slice(1).join('');
    el.value = v;
  } else {
    el.value = el.value.replace(/[^0-9]/g,'');
  }
}
async function abrirGastar(idx){
  gastarIndex=idx;const p=getProductos()[idx];if(!p)return;
  _gastarEsMetros = p.unidad==='metros';
  const stockMunicipio=p.stockUsuario||0,suf=sufijoP(p);
  document.getElementById('gastarNombreShow').value=`${p.ref} — ${p.nombre}`;
  document.getElementById('gastarStockShow').value=`${stockMunicipio} ${suf} disponibles`;
  document.getElementById('gastarSedeLabel').textContent=sesion.sede;
  document.getElementById('cantidadGastar').value='';document.getElementById('motivoGastar').value='';document.getElementById('lugarGastar').value='';document.getElementById('clienteProyectoGastar').value='';
  document.getElementById('cantidadGastar').step = _gastarEsMetros ? '0.01' : '1';
  document.getElementById('gastarLat').value=''; document.getElementById('gastarLng').value='';
  const ubicStatus=document.getElementById('ubicacionGastarStatus'); if(ubicStatus){ ubicStatus.textContent='Puedes escribir la dirección, capturar el GPS, o ambos'; ubicStatus.style.color='#94A3B8'; }
  const ubicResultados=document.getElementById('ubicacionGastarResultados'); if(ubicResultados){ ubicResultados.style.display='none'; ubicResultados.innerHTML=''; }
  const btnGps=document.getElementById('btnUbicacionGastar'); if(btnGps){ btnGps.disabled=false; btnGps.textContent='📍 GPS'; }
  document.getElementById('modalGastar').classList.add('open');

  // Si además tiene material recogido reutilizable de este mismo
  // producto, deja elegir de cuál gastar (nuevo vs recogido) — son 2
  // inventarios separados por dentro, pero para quien gasta debe sentirse
  // como una sola elección simple.
  const origenWrap = document.getElementById('gastarOrigenRecogidoWrap');
  window._gastarRecogidoDisponible = p.misRecogidos || null;
  if(p.misRecogidos && origenWrap){
    origenWrap.style.display = 'block';
    document.querySelector('input[name="gastarOrigenRecogido"][value="nuevo"]').checked = true;
    document.getElementById('gastarOrigenNuevoCant').textContent = `${stockMunicipio} ${suf}`;
    document.getElementById('gastarOrigenRecogidoCant').textContent = `${p.misRecogidos.cantidad} disponibles`;
  } else if(origenWrap){
    origenWrap.style.display = 'none';
  }

  // Si es un producto "por rollo" y tienes más de uno, deja elegir de
  // cuál sacar — con uno solo, se usa automático sin preguntar nada.
  const rolloWrap = document.getElementById('gastarRolloWrap');
  const rolloSel = document.getElementById('gastarRolloSelect');
  if(rolloWrap) rolloWrap.style.display = 'none';
  if(rolloSel) rolloSel.innerHTML = '';
  if(p.metrosPorUnidad){
    try{
      const res = await fetch(`api/productos.php?action=mis_rollos&ref=${encodeURIComponent(p.ref)}`, {credentials:'same-origin'});
      const rollos = await res.json();
      if(Array.isArray(rollos)){
        // El total "en bolsa" (stockUsuario) puede quedar desfasado del
        // rollo físico real — aquí se muestra lo que de verdad tienen tus
        // rollos, que es lo que el servidor va a validar al gastar. Sin
        // esto, un técnico con un rollo completo podía ver "0 disponibles"
        // (por el acumulado desfasado) aunque su rollo sí tuviera metros.
        const totalRollos = rollos.reduce((s,r)=>s+(parseFloat(r.metros_disponibles)||0), 0);
        document.getElementById('gastarStockShow').value = `${totalRollos.toFixed(rollos.length?1:0).replace(/\.0$/,'')} ${suf} disponibles (rollo)`;
        if(rollos.length > 1 && rolloWrap && rolloSel){
          rolloSel.innerHTML = rollos.map((r,i) => `<option value="${r.id}">Rollo #${r.id} — ${parseFloat(r.metros_disponibles).toFixed(1)} m disponibles${(r.metros&&parseFloat(r.metros)>parseFloat(r.metros_disponibles))?' (de '+parseFloat(r.metros).toFixed(0)+' m, ya usado en parte)':''}</option>`).join('');
          rolloWrap.style.display = 'block';
        } else if(rollos.length === 1 && rolloWrap && rolloSel){
          // Un solo rollo: no hace falta elegir, pero se deja fijado para
          // que se mande igual el rollo_id exacto al confirmar.
          rolloSel.innerHTML = `<option value="${rollos[0].id}" selected>Rollo 1 — ${parseFloat(rollos[0].metros_disponibles).toFixed(1)} m disponibles</option>`;
        } else if(rollos.length === 0){
          document.getElementById('gastarStockShow').value = `0 ${suf} disponibles (no tienes rollos)`;
        }
      }
    }catch(e){ /* si falla, se gasta del total sin especificar rollo */ }
  }
}
function _gastarCambiarOrigenRecogido(){
  const esRecogido = document.querySelector('input[name="gastarOrigenRecogido"]:checked')?.value === 'recogido';
  const cantInput = document.getElementById('cantidadGastar');
  if(esRecogido && window._gastarRecogidoDisponible){
    cantInput.value = window._gastarRecogidoDisponible.cantidad;
    cantInput.max = window._gastarRecogidoDisponible.cantidad;
  } else {
    cantInput.removeAttribute('max');
  }
}

let venderIndex = null;
let _origenStockVentaActual = null;
let _origenStockDisponible = {nuevo:0, recuperado:0};
function _elegirOrigenStockVenta(origen){
  _origenStockVentaActual = origen;
  const btnN = document.getElementById('btnOrigenNuevo');
  const btnR = document.getElementById('btnOrigenRecuperado');
  const suf = sufijoP(getProductos()[venderIndex]||{});
  if(origen==='recuperado'){
    btnR.style.background='#EAF3DE'; btnR.style.color='#166534';
    btnN.style.background='#F1F5F9'; btnN.style.color='#475569';
    document.getElementById('venderStockShow').textContent = `${_origenStockDisponible.recuperado} ${suf} recuperadas disponibles`;
  } else {
    btnN.style.background='#E0F6FF'; btnN.style.color='#0369A1';
    btnR.style.background='#F1F5F9'; btnR.style.color='#475569';
    document.getElementById('venderStockShow').textContent = `${_origenStockDisponible.nuevo} ${suf} nuevas disponibles`;
  }
}
/* Producto por rollos: el sistema asigna N rollos al azar (N = cantidad) y los muestra. */
async function _venderRollosCfg(p, esCentral){
  const wrap = document.getElementById('venderRollosWrap');
  const lista = document.getElementById('venderRollosLista');
  const cant = document.getElementById('cantidadVender');
  const lblC = document.getElementById('lblCantidadVender');
  const lblP = document.getElementById('lblPrecioUnitVender');
  const esRollo = !!p.metrosPorUnidad;
  if(esRollo) document.getElementById('venderStockShow').textContent = 'Cargando rollos…';
  if(wrap) wrap.style.display = esRollo ? 'block' : 'none';
  if(lblC) lblC.textContent = esRollo ? 'Cantidad (rollos)' : 'Cantidad';
  if(lblP) lblP.textContent = esRollo ? 'Precio por rollo' : 'Precio unitario';
  if(cant){ cant.readOnly = false; cant.placeholder = '0'; }
  if(!esRollo){ if(lista) lista.innerHTML=''; return; }
  document.getElementById('venderOrigenStockWrap').style.display='none';
  _origenStockVentaActual = null;
  window._ventaRolloElegido = null; window._ventaRollosPool = [];
  lista.innerHTML = '<div class="!p-[10px] !text-[#94A3B8] !text-[12px]">Cargando rollos…</div>';
  try{
    const url = esCentral ? `api/productos.php?action=rollos_disponibles&ref=${encodeURIComponent(p.ref)}&sede=${encodeURIComponent('Almacen Central')}`
                          : `api/productos.php?action=mis_rollos&ref=${encodeURIComponent(p.ref)}`;
    const res = await fetch(url,{credentials:'same-origin'});
    const rollos = await res.json();
    if(!Array.isArray(rollos) || !rollos.length){
      lista.innerHTML = '<div class="!p-[10px] !text-[#B91C1C] !text-[12px]">No tienes rollos disponibles de este producto.</div>';
      document.getElementById('venderStockShow').textContent = '0 rollos disponibles';
      return;
    }
    const totalM = rollos.reduce((s,r)=>s+(parseFloat(r.metros_disponibles)||0),0);
    document.getElementById('venderStockShow').textContent = `${rollos.length} rollo${rollos.length!==1?'s':''} disponible${rollos.length!==1?'s':''} (${Math.round(totalM*10)/10} m)`;
    // Mezcla al azar una sola vez; la cantidad N toma los N primeros
    window._ventaRollosPool = rollos.map(r=>[Math.random(),r]).sort((x,y)=>x[0]-y[0]).map(x=>x[1]);
    window._ventaRollosOrden = rollos.slice(); window._ventaManualSel = new Set(); window._ventaModoRollo = 'azar';
    cant.value = 1; cant.max = rollos.length;
    _venderRolloModo('azar');
  }catch(e){
    lista.innerHTML = '<div class="!p-[10px] !text-[#B91C1C] !text-[12px]">No se pudieron cargar los rollos.</div>';
  }
}
function _venderRolloModo(m){
  window._ventaModoRollo = m;
  const cant = document.getElementById('cantidadVender');
  const ba = document.getElementById('btnRolloAzar'), bm = document.getElementById('btnRolloManual');
  if(ba){ ba.style.background = m==='azar'?'#2DB82D':'#F1F5F9'; ba.style.color = m==='azar'?'#fff':'#475569'; }
  if(bm){ bm.style.background = m==='manual'?'#2DB82D':'#F1F5F9'; bm.style.color = m==='manual'?'#fff':'#475569'; }
  cant.readOnly = (m==='manual');
  if(m==='manual'){ window._ventaManualSel = new Set(); cant.value = ''; }
  else { cant.value = 1; }
  _venderRolloCambio();
}
function _venderRolloToggle(id, chk){
  const S = window._ventaManualSel; if(chk) S.add(String(id)); else S.delete(String(id));
  document.getElementById('cantidadVender').value = S.size || '';
  window._ventaRolloElegido = S.size ? [...S] : null;
  _actualizarPrecioTotalVenta();
}
function _venderRolloCambio(){
  const cant = document.getElementById('cantidadVender'); const lista = document.getElementById('venderRollosLista');
  const fmt = r=>{ const disp = parseFloat(r.metros_disponibles)||0, total = parseFloat(r.metros)||0; return `${Math.round(disp*10)/10} m${disp<total?` de ${Math.round(total*10)/10}`:''}`; };
  if(window._ventaModoRollo==='manual'){
    const todos = window._ventaRollosOrden||[]; if(!todos.length) return;
    lista.innerHTML = todos.map(r=>`<label class="!flex !items-center !gap-[8px] !p-[6px_8px] !rounded-[8px] !cursor-pointer !text-[13px]">
      <input type="checkbox" ${window._ventaManualSel.has(String(r.id))?'checked':''} onchange="_venderRolloToggle('${r.id}',this.checked)">
      <span class="![flex:1]">${r.codigo?`<span class="![font-family:monospace]">${esc(r.codigo)}</span>`:`Rollo #${r.id}`}</span><span class="!text-[#64748B] !text-[12px]">${fmt(r)}</span></label>`).join('');
    window._ventaRolloElegido = window._ventaManualSel.size ? [...window._ventaManualSel] : null;
    _actualizarPrecioTotalVenta(); return;
  }
  const pool = window._ventaRollosPool||[];
  if(!pool.length) return;
  let n = parseInt(cant.value)||0;
  if(n>pool.length){ n=pool.length; cant.value=n; toast(`Solo tienes ${pool.length} rollo${pool.length!==1?'s':''} disponible${pool.length!==1?'s':''}.`,'error'); }
  const sel = pool.slice(0, Math.max(n,0));
  window._ventaRolloElegido = sel.length ? sel.map(r=>r.id) : null;
  lista.innerHTML = sel.length ? sel.map(r=>`<div class="!p-[6px_10px] !text-[13px] !flex !items-center !gap-[8px]"><span>🎲</span>
      <b class="![flex:1] !text-[#1E293B]">${r.codigo?`<span class="![font-family:monospace]">${esc(r.codigo)}</span>`:`Rollo #${r.id}`}</b>
      <span class="!text-[#64748B] !text-[12px]">${fmt(r)}</span></div>`).join('') : '<div class="!p-[8px] !text-[#94A3B8] !text-[12px]">Escribe cuántos rollos vender.</div>';
  _actualizarPrecioTotalVenta();
}
let _ventaEquipo = null; // {tipo,id} cuando se vende un equipo con serial (ONT/OLT/Mikrotik)
async function abrirVender(idx){
  _ventaEquipo = null;
  venderIndex = idx;
  const p = getProductos()[idx]; if(!p) return;
  const esCentral = sesion.rol==='superadmin'||sesion.rol==='distribuidor';
  const stockNuevo = esCentral ? _stockCentral(p) : (p.stockUsuario||0);
  const stockRecuperado = esCentral ? (p.stockRecuperado||0) : 0;
  const suf = sufijoP(p);
  document.getElementById('venderNombreShow').textContent = `${p.ref} — ${p.nombre}`;
  const wrapOrigen = document.getElementById('venderOrigenStockWrap');
  if(esCentral && stockRecuperado>0){
    wrapOrigen.style.display='block';
    _origenStockVentaActual = 'nuevo';
    _elegirOrigenStockVenta('nuevo');
    _origenStockDisponible = {nuevo:stockNuevo, recuperado:stockRecuperado};
    document.getElementById('venderStockShow').textContent = `${stockNuevo} ${suf} nuevas disponibles`;
  } else {
    wrapOrigen.style.display='none';
    _origenStockVentaActual = null;
    document.getElementById('venderStockShow').textContent = `${stockNuevo} ${suf} disponibles${esCentral?' (almacén central)':''}`;
  }
  document.getElementById('cantidadVender').value='';
  _venderRollosCfg(p, esCentral);
  document.getElementById('clienteVender').value='';
  document.getElementById('precioUnitarioVender').value='';
  document.getElementById('precioTotalVender').value='';
  document.getElementById('formaPagoVender').value='';
  document.getElementById('modalVender').classList.add('open');
  _cargarCatalogoProyectos();
}
function _recargarVistasEquipos(tipo){
  const llamar = (fn,...args)=>{ try{ if(typeof fn==='function') fn(...args); }catch(e){} };
  if(tipo==='olt') llamar(cargarMisOlt);
  else if(tipo==='mikrotik'){ llamar(cargarMisMikrotik); document.querySelectorAll('[id^="teTabla_"]').forEach(el=>llamar(teCargarInventario, el.id.replace('teTabla_',''))); }
  else if(tipo==='ont'){ llamar(cargarMisOnt); llamar(cargarInventarioOnt); }
}
function abrirVenderEquipo(tipo, id, nombre){
  _ventaEquipo = {tipo, id};
  window._ventaRollosPool = []; window._ventaRolloElegido = null;
  document.getElementById('venderNombreShow').textContent = nombre;
  document.getElementById('venderStockShow').textContent = ({ont:'ONT',olt:'OLT',mikrotik:'Equipo'})[tipo] + ' · 1 unidad';
  document.getElementById('venderRollosWrap').style.display = 'none';
  document.getElementById('venderOrigenStockWrap').style.display = 'none';
  _origenStockVentaActual = null;
  const c = document.getElementById('cantidadVender'); c.value = 1; c.readOnly = true;
  const lc = document.getElementById('lblCantidadVender'); if(lc) lc.textContent = 'Cantidad';
  const lp = document.getElementById('lblPrecioUnitVender'); if(lp) lp.textContent = 'Precio';
  ['clienteVender','precioUnitarioVender','precioTotalVender','formaPagoVender'].forEach(i=>{ const e=document.getElementById(i); if(e) e.value=''; });
  document.getElementById('modalVender').classList.add('open');
  _cargarCatalogoProyectos();
}
function _actualizarPrecioTotalVenta(){
  const cant = parseInt(document.getElementById('cantidadVender')?.value)||0;
  const unit = parseFloat(document.getElementById('precioUnitarioVender')?.value)||0;
  if(cant>0 && unit>0){
    document.getElementById('precioTotalVender').value = (cant*unit).toFixed(0);
  }
}
function _actualizarPrecioUnitarioVenta(){
  const cant = parseInt(document.getElementById('cantidadVender')?.value)||0;
  const total = parseFloat(document.getElementById('precioTotalVender')?.value)||0;
  if(cant>0 && total>0){
    document.getElementById('precioUnitarioVender').value = (total/cant).toFixed(0);
  }
}
async function confirmarVender(){
  const cant = parseInt(document.getElementById('cantidadVender')?.value);
  const cliente = (document.getElementById('clienteVender')?.value||'').trim();
  const precioUnitario = parseFloat(document.getElementById('precioUnitarioVender')?.value)||null;
  const precioTotal = parseFloat(document.getElementById('precioTotalVender')?.value)||null;
  const formaPago = document.getElementById('formaPagoVender')?.value||'';
  if(!cant||cant<1){ toast('Ingresa una cantidad válida.','error'); return; }
  if(!cliente){ toast('Escribe el nombre del cliente.','error'); return; }
  if(!precioTotal || precioTotal<=0){ toast('Ingresa el precio de la venta.','error'); return; }
  if(_ventaEquipo){
    try{
      const rv = await _api('pedidos','vender_equipo',{tipo:_ventaEquipo.tipo, id:_ventaEquipo.id, cliente, precio_total:precioTotal, forma_pago:formaPago});
      const t = _ventaEquipo.tipo; _ventaEquipo = null;
      cerrarModal('modalVender');
      toast(rv && rv.pendiente ? '⏳ Venta enviada a aprobación. El equipo queda apartado hasta que la aprueben.' : '💰 Venta registrada ✓','success');
      if(rv && rv.pendiente) _actualizarBadgeVentas();
      _recargarVistasEquipos(t);
    }catch(e){ toast(e.message||'Error al registrar la venta','error'); }
    return;
  }
  const p = getProductos()[venderIndex];
  if(!p){ toast('Producto no encontrado.','error'); return; }
  const rolloIds = p.metrosPorUnidad ? (window._ventaRolloElegido||[]) : undefined;
  if(p.metrosPorUnidad && rolloIds.length!==cant){ toast('No hay rollos suficientes para esa cantidad.','error'); return; }
  try{
    const rv = await _api('pedidos','vender',{ref:p.ref, cantidad:cant, cliente, precio_unitario:precioUnitario, precio_total:precioTotal, forma_pago:formaPago, origen_stock:_origenStockVentaActual||undefined, rollo_ids:rolloIds});
    await Promise.all([_recargarProductos(),_recargarHistorial()]);
    cerrarModal('modalVender'); renderTabla(); renderStats(); renderHistorial();
    const fmtCOP = (n)=>n.toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
    if(rv && rv.pendiente){
      toast(`⏳ Venta enviada a aprobación: ${cant} ${sufijoMostrar(p)} de "${p.nombre}" a ${cliente} por ${fmtCOP(precioTotal)}. El material queda apartado hasta que la aprueben.`,'success');
      _actualizarBadgeVentas();
    } else {
      toast(`💰 Venta registrada: ${cant} ${sufijoMostrar(p)} de "${p.nombre}" a ${cliente} por ${fmtCOP(precioTotal)} ✓`,'success');
    }
  }catch(e){ toast(e.message||'Error al registrar la venta','error'); }
}

let _mapaElegirInstancia = null;
let _mapaElegirMarcador = null;
let _mapaElegirLatLng = null;
let _mapaElegirTargetLat = 'gastarLat';
let _mapaElegirTargetLng = 'gastarLng';
let _mapaElegirTargetStatus = 'ubicacionGastarStatus';
let _mapaElegirCb = null;
function _abrirMapaElegirGastar(targetLat, targetLng, targetStatus, alConfirmar){
  _mapaElegirCb = (typeof alConfirmar==='function') ? alConfirmar : null;
  _mapaElegirTargetLat = targetLat || 'gastarLat';
  _mapaElegirTargetLng = targetLng || 'gastarLng';
  _mapaElegirTargetStatus = targetStatus || 'ubicacionGastarStatus';
  const _mm = document.getElementById('modalMapaElegir'); _mm.style.zIndex = '10001'; _mm.classList.add('open');
  document.getElementById('btnConfirmarMapaElegir').disabled = true;
  document.getElementById('mapaElegirCoordsTexto').textContent = 'Toca el mapa para elegir un punto';
  const buscarInp = document.getElementById('mapaElegirBuscar'); if(buscarInp) buscarInp.value='';
  const resultadosDiv = document.getElementById('mapaElegirResultados'); if(resultadosDiv){ resultadosDiv.style.display='none'; resultadosDiv.innerHTML=''; }
  _mapaElegirLatLng = null;

  setTimeout(()=>{
    // Centro inicial: coordenadas ya elegidas si hay, si no, un punto por
    // defecto razonable (se puede mover libremente con el mapa).
    const latActual = parseFloat(document.getElementById(_mapaElegirTargetLat)?.value) || 2.9273;
    const lngActual = parseFloat(document.getElementById(_mapaElegirTargetLng)?.value) || -75.2819;

    if(!_mapaElegirInstancia){
      _mapaElegirInstancia = L.map('mapaElegirContenedor').setView([latActual, lngActual], 14);
      agregarCapaBaseMapa(_mapaElegirInstancia);
      _mapaElegirInstancia.on('click', function(e){
        _colocarMarcadorElegir(e.latlng.lat, e.latlng.lng);
      });
    } else {
      _mapaElegirInstancia.setView([latActual, lngActual], 14);
      _mapaElegirInstancia.invalidateSize();
    }
    // Si ya había una ubicación elegida antes, mostrarla de una vez.
    if(document.getElementById(_mapaElegirTargetLat)?.value){
      _colocarMarcadorElegir(latActual, lngActual);
    } else if(_mapaElegirMarcador){
      _mapaElegirInstancia.removeLayer(_mapaElegirMarcador);
      _mapaElegirMarcador = null;
    }
  }, 100);
}
function _colocarMarcadorElegir(lat, lng){
  _mapaElegirLatLng = {lat, lng};
  if(_mapaElegirMarcador) _mapaElegirInstancia.removeLayer(_mapaElegirMarcador);
  _mapaElegirMarcador = L.marker([lat, lng], {draggable:true}).addTo(_mapaElegirInstancia);
  _mapaElegirMarcador.on('dragend', function(e){
    const pos = e.target.getLatLng();
    _mapaElegirLatLng = {lat: pos.lat, lng: pos.lng};
    document.getElementById('mapaElegirCoordsTexto').textContent = `📍 ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)} (arrastra para ajustar)`;
  });
  document.getElementById('mapaElegirCoordsTexto').textContent = `📍 ${lat.toFixed(6)}, ${lng.toFixed(6)} (arrastra el pin para ajustar)`;
  document.getElementById('btnConfirmarMapaElegir').disabled = false;
}
function _confirmarMapaElegir(){
  if(!_mapaElegirLatLng) return;
  document.getElementById(_mapaElegirTargetLat).value = _mapaElegirLatLng.lat.toFixed(6);
  document.getElementById(_mapaElegirTargetLng).value = _mapaElegirLatLng.lng.toFixed(6);
  const status = document.getElementById(_mapaElegirTargetStatus);
  if(status){ status.innerHTML = `✓ Ubicación elegida en el mapa: <a class="!text-[#0369A1] ![text-decoration:underline]" href="https://maps.google.com/?q=${_mapaElegirLatLng.lat},${_mapaElegirLatLng.lng}" target="_blank">${_mapaElegirLatLng.lat.toFixed(6)}, ${_mapaElegirLatLng.lng.toFixed(6)}</a>`; status.style.color='#16A871'; }
  const _cb = _mapaElegirCb, _ll = _mapaElegirLatLng; _mapaElegirCb = null;
  cerrarModal('modalMapaElegir');
  toast('Ubicación elegida ✓','success');
  if(_cb) _cb(_ll.lat, _ll.lng);
}
async function _buscarEnMapaElegir(){
  const texto = (document.getElementById('mapaElegirBuscar')?.value||'').trim();
  const resultados = document.getElementById('mapaElegirResultados');
  if(!texto){ toast('Escribe algo para buscar','error'); return; }
  if(resultados){ resultados.style.display='block'; resultados.innerHTML='<div class="!p-[10px] !text-[12px] !text-[#94A3B8]">Buscando…</div>'; }
  try{
    const q = encodeURIComponent(texto + ', Colombia');
    const res = await fetchConTiempo(`https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=5&addressdetails=1`,{
      headers:{'Accept-Language':'es'}
    }, 6000);
    const data = await res.json();
    if(!Array.isArray(data) || !data.length){
      if(resultados) resultados.innerHTML = '<div class="!p-[10px] !text-[12px] !text-[#B45309]">No se encontró — prueba con más detalle (ciudad, barrio…).</div>';
      return;
    }
    if(resultados){
      resultados.innerHTML = data.map(r=>`
        <div onclick="_irAResultadoMapaElegir(${r.lat},${r.lon})" style="padding:9px 12px;cursor:pointer;font-size:12.5px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
          📍 ${esc(r.display_name)}
        </div>`).join('');
    }
  }catch(e){
    if(resultados) resultados.innerHTML = '<div class="!p-[10px] !text-[12px] !text-[#B91C1C]">El buscador de direcciones no está disponible ahora — haz clic directo en el mapa o escribe las coordenadas.</div>';
  }
}
function _irAResultadoMapaElegir(lat, lng){
  document.getElementById('mapaElegirResultados').style.display='none';
  _mapaElegirInstancia.setView([lat, lng], 16);
  _colocarMarcadorElegir(lat, lng);
}
function _capturarUbicacionGm(){
  const status = document.getElementById('gmUbicacionStatus');
  const btn = document.getElementById('btnUbicacionGm');
  if(!navigator.geolocation){
    if(status){ status.textContent='Tu navegador no soporta ubicación GPS.'; status.style.color='#B91C1C'; }
    return;
  }
  if(btn){ btn.disabled=true; btn.textContent='📍 Buscando…'; }
  if(status){ status.textContent='Obteniendo tu ubicación…'; status.style.color='#0369A1'; }
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      document.getElementById('gmLat').value = lat;
      document.getElementById('gmLng').value = lng;
      if(status){ status.innerHTML = `✓ Ubicación capturada: <a class="!text-[#0369A1] ![text-decoration:underline]" href="https://maps.google.com/?q=${lat},${lng}" target="_blank">${lat}, ${lng}</a>`; status.style.color='#16A871'; }
      if(btn){ btn.disabled=false; btn.textContent='📍 Actualizar'; }
    },
    (err)=>{
      if(status){ status.textContent = err.code===1 ? 'Permiso de ubicación denegado — puedes seguir sin GPS.' : 'No se pudo obtener la ubicación — puedes seguir sin GPS.'; status.style.color='#B45309'; }
      if(btn){ btn.disabled=false; btn.textContent='📍 GPS'; }
    },
    {enableHighAccuracy:true, timeout:10000}
  );
}
let _catalogoProyectosCache = null;
async function _cargarCatalogoProyectos(){
  if(_catalogoProyectosCache) return; // ya cargado, no repetir la consulta
  try{
    const res = await fetch('api/historial.php?action=catalogo_proyectos', {credentials:'same-origin'});
    const lista = await res.json();
    _catalogoProyectosCache = Array.isArray(lista) ? lista : [];
    _rellenarSelectsProyecto();
  }catch(e){ _catalogoProyectosCache = []; }
}
function _rellenarSelectsProyecto(){
  // Ya no rellena nada directo — el desplegable propio (_cpFiltrar) lee
  // _catalogoProyectosCache cada vez que se muestra, así que solo hace
  // falta refrescar la lista si ya estaba abierta en ese momento.
  ['clienteProyectoGastar','clienteVender','gmClienteProyecto','gfClienteProyecto','instalarOntCliente','ontClienteNombre','editOntCliente'].forEach(id=>{
    const lista = document.getElementById(id+'Lista');
    if(lista && lista.style.display==='block') _cpFiltrar(id);
  });
}
// Desplegable propio de "Cliente/Proyecto" (con buscador y resaltado, estilo
// consistente con el resto de la app) en vez del <select> nativo largo o el
// <datalist> del navegador — y con una opción explícita para crear uno
// nuevo, para que nunca se cuele un texto cualquiera como si fuera válido.
function _cpFiltrar(inputId){
  const input = document.getElementById(inputId);
  const lista = document.getElementById(inputId+'Lista');
  if(!input || !lista) return;
  if(input.dataset && input.dataset.fijo === '1'){ lista.style.display = 'none'; return; } // campo fijo: sin buscador
  const q = (input.value||'').trim();
  const ql = q.toLowerCase();
  const cache = _catalogoProyectosCache || [];
  const coincidencias = q ? cache.filter(p=>(p.nombre||'').toLowerCase().includes(ql)) : cache;
  const existeExacto = cache.some(p=>(p.nombre||'').toLowerCase() === ql);

  // Cliente/Proyecto es obligatorio en ambos formularios de gasto, así
  // que ya no tiene sentido ofrecer "Sin proyecto asociado". En cambio,
  // si todavía no ha escrito nada, se le muestra de una vez la pista de
  // que puede escribir un nombre para crear uno — así no tiene que
  // adivinar que debe empezar a teclear para que aparezca esa opción.
  let filas = '';
  // Si no hay ningún proyecto creado todavía (o ninguno coincide con lo escrito)
  // NO se muestra la cajita blanca: queda libre para escribir. Al salir del
  // campo, si el nombre es nuevo, se pregunta con un aviso si se quiere crear.
  if(!q && cache.length){
    filas += `<div class="!p-[9px_12px] !text-[12px] !text-[#94A3B8]">✏️ Escribe el nombre del cliente o proyecto para buscarlo o crear uno nuevo</div>`;
  }
  filas += coincidencias.map(p=>{
    const nombreJs = esc(p.nombre).replace(/'/g,"\\'");
    // Se usa "onmousedown" (con preventDefault) en vez de "onclick": el
    // mousedown ocurre ANTES de que el campo de texto pierda el foco, así
    // la selección queda hecha antes de que corra la validación de "blur"
    // (_cpValidarBlur) — si se usara onclick, en algunos navegadores/equipos
    // (reportado en Brave y en algunos móviles) el blur se dispara primero
    // y puede alcanzar a borrar el campo antes de que el clic se registre.
    return `<div onmousedown="event.preventDefault();_cpSeleccionar('${inputId}','${nombreJs}')" style="padding:9px 12px;cursor:pointer;font-size:13px;border-top:1px solid #F1F5F9;" onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'">🏗️ ${_resaltarTexto(p.nombre, q)}</div>`;
  }).join('');
  if(q && !existeExacto && coincidencias.length){
    const qJs = esc(q).replace(/'/g,"\\'");
    filas += `<div onmousedown="event.preventDefault();_cpCrearNuevo('${inputId}','${qJs}')" style="padding:9px 12px;cursor:pointer;font-size:13px;border-top:1px solid #F1F5F9;color:#B45309;font-weight:600;" onmouseover="this.style.background='#FFFBEB'" onmouseout="this.style.background='white'">➕ Crear proyecto nuevo "${esc(q)}"</div>`;
  }
  lista.innerHTML = filas;
  lista.style.display = filas.trim() ? 'block' : 'none';
}
function _cpSeleccionar(inputId, nombre){
  const input = document.getElementById(inputId);
  if(input) input.value = nombre;
  const lista = document.getElementById(inputId+'Lista');
  if(lista) lista.style.display = 'none';
}
async function _cpCrearNuevo(inputId, nombre){
  // Abre el modal de "Nuevo proyecto" con el nombre ya escrito, para poder
  // agregar de una vez el teléfono (opcional) en vez de crearlo a ciegas
  // con solo el nombre.
  const lista = document.getElementById(inputId+'Lista');
  if(lista) lista.style.display = 'none';
  abrirCrearProyecto(nombre, inputId);
}
// Al salir del campo: si lo que quedó escrito no es ni un proyecto ya
// creado ni algo que se acaba de crear con el botón de arriba, se borra —
// nunca se manda un texto suelto como si fuera un proyecto válido. El
// pequeño retraso deja que el clic sobre una opción de la lista se
// registre primero (si no, el blur cerraría la lista antes del clic).
function _cpValidarBlur(inputId){
  setTimeout(()=>{
    const input = document.getElementById(inputId);
    const lista = document.getElementById(inputId+'Lista');
    if(lista) lista.style.display = 'none';
    if(!input) return;
    if(input.dataset && input.dataset.fijo === '1') return; // campo fijo: no se valida ni se borra
    const val = (input.value||'').trim();
    if(!val) return;
    // Si es el valor que ya tenía guardado (ej: un cliente viejo escrito a mano
    // al editar una ONT), se respeta tal cual — solo se valida lo que se cambie.
    if(input.dataset.original && val === input.dataset.original) return;
    const existe = (_catalogoProyectosCache||[]).some(p=>(p.nombre||'').toLowerCase()===val.toLowerCase());
    if(!existe){
      input.value = '';
      _cpAvisoNuevo(inputId, val);
    }
  }, 200);
}
// Aviso (modal) cuando se escribe un cliente/proyecto que no existe todavía.
function _cpAvisoNuevo(inputId, nombre){
  document.getElementById('modalCpNuevo')?.remove();
  const m = document.createElement('div');
  m.id = 'modalCpNuevo'; m.className = 'modal-bg open';
  m.style.zIndex = '10000';
  const safe = esc(nombre);
  m.innerHTML = `<div class="modal-box" style="max-width:400px;text-align:center;">
    <div style="width:54px;height:54px;background:linear-gradient(135deg,#FEF3C7,#FDE68A);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:26px;">🆕</div>
    <h3 style="font-family:Syne,sans-serif;font-weight:700;font-size:18px;margin:0 0 6px;">Este cliente / proyecto es nuevo</h3>
    <div style="display:inline-block;background:#F1F5F9;border-radius:10px;padding:6px 14px;font-weight:700;font-size:14px;color:#0F172A;margin:4px 0 10px;max-width:100%;word-break:break-word;">${safe}</div>
    <p style="color:#64748B;font-size:13px;line-height:1.5;margin:0 0 18px;">Todavía no está creado. Créalo ahora para poder usarlo; así todos lo ven igual y no se repiten nombres.</p>
    <div style="display:flex;gap:10px;">
      <button class="btn btn-ghost" style="flex:1;" id="cpAvisoOtro">Elegir otro</button>
      <button class="btn btn-primary" style="flex:1;" id="cpAvisoCrear">➕ Crear proyecto</button>
    </div></div>`;
  document.body.appendChild(m);
  const cerrar = ()=>m.remove();
  m.querySelector('#cpAvisoOtro').onclick = ()=>{ cerrar(); setTimeout(()=>document.getElementById(inputId)?.focus(), 50); };
  m.querySelector('#cpAvisoCrear').onclick = ()=>{ cerrar(); abrirCrearProyecto(nombre, inputId); };
  m.addEventListener('mousedown', e=>{ if(e.target===m) cerrar(); });
}
document.addEventListener('click', function(e){
  ['clienteProyectoGastar','clienteVender','gmClienteProyecto','gfClienteProyecto','instalarOntCliente','ontClienteNombre','editOntCliente'].forEach(id=>{
    const lista = document.getElementById(id+'Lista');
    const input = document.getElementById(id);
    if(lista && input && !input.contains(e.target) && !lista.contains(e.target)) lista.style.display = 'none';
  });
});
let _cpProyOrigenInput = null; // si se abrió desde el buscador de Cliente/Proyecto, a qué input volver
function abrirCrearProyecto(prefillNombre, origenInputId){
  document.getElementById('cpProyId').value = ''; // vacío = está creando uno nuevo, no editando
  document.getElementById('cpNombre').value = prefillNombre || '';
  document.getElementById('cpProyTelefono').value = '';
  document.getElementById('cpDescripcion').value = '';
  document.getElementById('cpProyTitulo').textContent = 'Nuevo proyecto';
  document.getElementById('cpProySubtitulo').textContent = 'Una vez creado, cualquiera puede elegirlo al gastar material.';
  document.getElementById('cpProyBtnConfirmar').textContent = 'Crear proyecto';
  _cpProyOrigenInput = origenInputId || null;
  document.getElementById('modalCrearProyecto').classList.add('open');
  setTimeout(()=>document.getElementById('cpNombre')?.focus(), 200);
}
// Editar uno ya creado — mismo modal, precargado, y guarda con
// "editar_proyecto" en vez de "crear_proyecto".
function abrirEditarProyecto(nombreActual, telefonoActual, descripcionActual){
  document.getElementById('cpProyId').value = nombreActual;
  document.getElementById('cpNombre').value = nombreActual || '';
  document.getElementById('cpProyTelefono').value = telefonoActual || '';
  document.getElementById('cpDescripcion').value = descripcionActual || '';
  document.getElementById('cpProyTitulo').textContent = 'Editar proyecto';
  document.getElementById('cpProySubtitulo').textContent = 'Cambia el nombre y/o el teléfono de este proyecto.';
  document.getElementById('cpProyBtnConfirmar').textContent = 'Guardar cambios';
  _cpProyOrigenInput = null;
  document.getElementById('modalCrearProyecto').classList.add('open');
  setTimeout(()=>document.getElementById('cpNombre')?.focus(), 200);
}
async function confirmarCrearProyecto(){
  const nombre = (document.getElementById('cpNombre')?.value||'').trim();
  const telefono = (document.getElementById('cpProyTelefono')?.value||'').trim();
  const descripcion = (document.getElementById('cpDescripcion')?.value||'').trim();
  const editando = (document.getElementById('cpProyId')?.value||'').trim(); // nombre original si es edición
  if(!nombre){ toast('Escribe el nombre del proyecto','error'); return; }
  if(telefono && !/^[0-9]+$/.test(telefono)){ toast('El teléfono solo puede tener números','error'); return; }
  try{
    const res = editando
      ? await _api('historial','editar_proyecto',{nombre_actual:editando, nombre, telefono, descripcion})
      : await _api('historial','crear_proyecto',{nombre, telefono, descripcion});
    if(res.error){
      toast(res.error,'error');
      return;
    }
    cerrarModal('modalCrearProyecto');
    toast(editando ? 'Proyecto actualizado ✓' : `Proyecto "${nombre}" creado ✓`,'success');
    _catalogoProyectosCache = null; // para que Gastar lo vea la próxima vez que abra
    if(_cpProyOrigenInput){
      const input = document.getElementById(_cpProyOrigenInput);
      if(input) input.value = nombre;
      _cpProyOrigenInput = null;
      await _cargarCatalogoProyectos();
    } else {
      cargarPanelProyectos();
    }
  }catch(e){ toast('Error al guardar el proyecto','error'); }
}
let _proyectosListaCache = [];
async function cargarPanelProyectos(){
  const lista = document.getElementById('pyLista');
  const buscador = document.getElementById('pyBuscador');
  if(buscador) buscador.value = '';
  lista.innerHTML = '<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[30px]">Cargando…</div>';
  try{
    const res = await fetch('api/historial.php?action=listar_proyectos', {credentials:'same-origin'});
    _proyectosListaCache = await res.json();
    if(!Array.isArray(_proyectosListaCache)) _proyectosListaCache = [];
  }catch(e){ _proyectosListaCache = []; }
  renderListaProyectos();
}
// Eliminar un cliente/proyecto (superadmin o quien tenga el permiso "eliminar_proyectos").
// Sin movimientos se borra; con historial se archiva y el historial se conserva.
function eliminarProyecto(nombre, movimientos){
  const conHistorial = movimientos > 0;
  mostrarConfirmar({
    icono:'🗑', color:'#B91C1C',
    titulo:'¿Eliminar "'+nombre+'"?',
    desc: conHistorial
      ? 'Tiene '+movimientos+' movimiento(s) en el historial. Dejará de aparecer en las listas, pero esos movimientos y los informes conservan su nombre. Si luego creas uno con el mismo nombre, se reactiva.'
      : 'No tiene movimientos, se borrará por completo.',
    btnTxt:'Sí, eliminar', btnColor:'#B91C1C', requirePassword:true,
    onConfirmar: async ()=>{
      try{
        const res = await _api('historial','eliminar_proyecto',{nombre});
        if(res.error){ toast(res.error,'error'); return; }
        _catalogoProyectosCache = null;
        toast(res.modo==='archivado' ? 'Eliminado (el historial se conserva) ✓' : 'Eliminado ✓','success');
        await cargarPanelProyectos();
      }catch(e){ toast('No se pudo eliminar: '+(e&&e.message?e.message:'intenta de nuevo'),'error'); }
    }
  });
}
function renderListaProyectos(){
  const lista = document.getElementById('pyLista');
  const q = (document.getElementById('pyBuscador')?.value||'').toLowerCase().trim();
  if(!lista) return;
  const filtrados = q ? _proyectosListaCache.filter(p=>p.proyecto_cliente.toLowerCase().includes(q)) : _proyectosListaCache;
  if(!filtrados.length){
    lista.innerHTML = `<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[40px]">
      ${q ? '🔍 Sin resultados para "'+esc(q)+'"' : 'Todavía no hay ningún proyecto registrado.<br><span class="!text-[11px]">Se crean solos cuando alguien escribe un nombre de proyecto al gastar.</span>'}
    </div>`;
    return;
  }
  lista.innerHTML = filtrados.map(p => {
    const telJs = esc(p.telefono||'').replace(/'/g,"\\'");
    const descJs = esc(p.descripcion||'').replace(/'/g,"\\'");
    const nombreJs = esc(p.proyecto_cliente).replace(/'/g,"\\'");
    return `
    <div onclick="abrirDetalleProyecto('${esc(p.proyecto_cliente)}')"
      style="padding:14px 16px;border-radius:12px;border:1.5px solid #E2E8F0;cursor:pointer;transition:all .15s;background:white;"
      onmouseover="this.style.borderColor='#FCD34D';this.style.background='#FFFDF5'"
      onmouseout="this.style.borderColor='#E2E8F0';this.style.background='white'">
      <div class="!flex !items-center !justify-between !gap-[8px]">
        <div class="!min-w-[0]">
          <div class="!font-bold !text-[14px] !text-[#0F172A]">🏗️ ${_resaltarTexto(p.proyecto_cliente, q)}</div>
          ${p.telefono ? `<div class="!text-[12px] !text-[#64748B] !mt-[2px]">📞 ${esc(p.telefono)}</div>` : ''}
          ${p.descripcion ? `<div class="!text-[12px] !text-[#64748B] !mt-[2px]">${esc(p.descripcion)}</div>` : ''}
          <div class="!text-[12px] !text-[#94A3B8] !mt-[3px]">
            ${p.total_movimientos
              ? `${p.total_movimientos} movimiento${p.total_movimientos!=1?'s':''} · ${p.total_personas} persona${p.total_personas!=1?'s':''} · última vez: ${new Date(p.ultima_fecha).toLocaleDateString('es-CO')}${p.total_ventas>0?` · <span class="badge ![background:#EAF3DE] !text-[#166534] !text-[10px]">💰 ${p.total_ventas} venta${p.total_ventas!=1?'s':''}</span>`:''}`
              : `Sin movimientos todavía · creado por ${esc(p.creado_por||'—')}`}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          <button onclick="event.stopPropagation();abrirEditarProyecto('${nombreJs}','${telJs}','${descJs}')" class="btn-sm ![background:#F1F5F9] !text-[#475569]" title="Editar nombre o teléfono">✎ Editar</button>
          ${tienePermiso('eliminar_proyectos')?`<button onclick="event.stopPropagation();eliminarProyecto('${nombreJs}',${p.total_movimientos||0})" class="btn-sm ![background:#FEF2F2] !text-[#B91C1C]" title="Eliminar este cliente/proyecto">🗑 Eliminar</button>`:''}
          <span class="!text-[#CBD5E1] !text-[18px]">›</span>
        </div>
      </div>
    </div>`;
  }).join('');
}
// Abre "Gastar múltiple" con este cliente/proyecto ya puesto (solo técnico y persona, que son quienes gastan)
function gastarEnEsteProyecto(){
  if(!_pdProyectoActual) return;
  if(typeof abrirGastoMultiple !== 'function'){ toast('No se pudo abrir el gasto','error'); return; }
  abrirGastoMultiple();
  // abrirGastoMultiple limpia el campo al abrir, así que se llena justo después
  const el = document.getElementById('gmClienteProyecto');
  if(el){
    el.value = _pdProyectoActual;
    // Queda FIJO: no se puede cambiar ni abrir el buscador (se desbloquea solo al abrir Gastar múltiple normal)
    el.dataset.fijo = '1'; el.readOnly = true;
    el.style.background = '#F1F5F9'; el.style.cursor = 'not-allowed'; el.style.fontWeight = '600';
    el.title = 'Cliente/Proyecto fijo: estás gastando desde este proyecto';
  }
  const lista = document.getElementById('gmClienteProyectoLista'); if(lista) lista.style.display = 'none';
}
let _pdProyectoActual = null; // nombre del proyecto que se está viendo ahora
let _pdDetalleActual = null;  // últimos datos cargados (para exportar sin volver a pedirlos)
async function abrirDetalleProyecto(proyecto){
  goPanel('proyecto-detalle');
  document.getElementById('pdTitulo').textContent = '🏗️ ' + proyecto;
  document.getElementById('pdResumenCards').innerHTML = '';
  document.getElementById('pdPorProducto').innerHTML = '<div class="!text-[#94A3B8] !text-[13px]">Cargando…</div>';
  document.getElementById('pdDetalle').innerHTML = '';
  _pdProyectoActual = proyecto;
  _pdDetalleActual = null;
  { const bg = document.getElementById('pdBtnGastar'); if(bg) bg.style.display = (sesion.rol==='tecnico'||sesion.rol==='persona') ? 'inline-flex' : 'none'; }
  try{
    const res = await fetch(`api/historial.php?action=ver_por_proyecto&proyecto=${encodeURIComponent(proyecto)}`, {credentials:'same-origin'});
    const data = await res.json();
    if(data.error){ toast(data.error,'error'); goPanel('proyectos'); return; }
    _pdDetalleActual = data;

    document.getElementById('pdResumenCards').innerHTML = `
      <div class="![background:#FFFBEB] !rounded-[10px] !p-[14px] !text-center">
        <div class="!text-[24px] !font-extrabold !text-[#92400E]">${data.total_movimientos}</div>
        <div class="!text-[11px] !text-[#78350F]">Movimientos${data.total_retirados?` · ${data.total_retirados} retirado${data.total_retirados==1?'':'s'}`:''}</div>
      </div>
      <div class="![background:#EFF6FF] !rounded-[10px] !p-[14px] !text-center">
        <div class="!text-[24px] !font-extrabold !text-[#1E40AF]">${data.tecnicos.length}</div>
        <div class="!text-[11px] !text-[#1E3A8A]">Personas: ${data.tecnicos.map(esc).join(', ')}</div>
      </div>`;

    // "1" solo, sin unidad, no dice nada — mejor "1 unidad" / "5 metros".
    const _fmtCantUnidad = (cant, unidad) => {
      const u = (unidad||'unidad').toLowerCase();
      if(u==='metros') return `${cant} metro${cant==1?'':'s'}`;
      return `${cant} unidad${cant==1?'':'es'}`;
    };

    document.getElementById('pdPorProducto').innerHTML = Object.entries(data.resumen_productos).map(([nombre,total])=>
      `<div class="!flex !justify-between !p-[7px_0] ![border-bottom:1px_solid_#F1F5F9] !text-[13px]"><span>${esc(nombre)}</span><b class="!text-[#B45309]">${_fmtCantUnidad(total, data.resumen_productos_unidad?.[nombre])}</b></div>`
    ).join('') || '<div class="!text-[#94A3B8] !text-[12px]">Nada instalado actualmente.</div>';
    // Lo que ya se retiró del cliente, aparte (para ver bien qué hay HOY).
    const _ret = Object.entries(data.resumen_retirados||{});
    if(_ret.length){
      document.getElementById('pdPorProducto').innerHTML += `<div class="!mt-[10px] !text-[11px] !font-bold !text-[#64748B] !uppercase">🚫 Ya retirado</div>` + _ret.map(([nombre,total])=>
        `<div class="!flex !justify-between !p-[6px_0] ![border-bottom:1px_solid_#F1F5F9] !text-[12px] !text-[#94A3B8]"><span>${esc(nombre)}</span><b>${_fmtCantUnidad(total, data.resumen_productos_unidad?.[nombre])}</b></div>`).join('');
    }

    { const bq=document.getElementById('pdBuscar'); if(bq) bq.value=''; }
    _pdRenderDetalle();
  }catch(e){ toast('Error al cargar el proyecto','error'); goPanel('proyectos'); }
}
function _pdRenderDetalle(){
  const data=_pdDetalleActual; if(!data) return;
  const q=(document.getElementById('pdBuscar')?.value||'').trim();
  const ql=q.toLowerCase();
  const _fmtCantUnidad=(cant,unidad)=>{const u=(unidad||'unidad').toLowerCase();if(u==='metros')return `${cant} metro${cant==1?'':'s'}`;return `${cant} unidad${cant==1?'':'es'}`;};
  const _txtFila=d=>[d.nombre,d.ref,d.enviado_por,d.descripcion,d.retirado==1?('retirado '+(d.retirado_motivo||'')+' '+(d.retirado_por||'')):'',d.es_venta==1?'venta':'gasto',d.fecha?new Date(d.fecha).toLocaleString('es-CO'):''].join(' ').toLowerCase();
  const lista=q?data.detalle.filter(d=>_txtFila(d).includes(ql)):data.detalle;
  const cnt=document.getElementById('pdBuscarCuenta'); if(cnt) cnt.textContent = q ? `${lista.length} de ${data.detalle.length}` : '';
  document.getElementById('pdDetalle').innerHTML = lista.map(d=>{
      const tieneUbicacion = d.gps_lat && d.gps_lng;
      const linkUbicacion = tieneUbicacion
        ? `<a class="!text-[#0369A1] ![text-decoration:underline] !text-[11px]" href="https://maps.google.com/?q=${d.gps_lat},${d.gps_lng}" target="_blank" onclick="event.stopPropagation();">📍 Ver ubicación</a>`
        : '';
      return `<div onclick="abrirRemision('${d.id}','gasto')" title="Click para ver el comprobante de este movimiento" style="padding:9px 12px;background:${d.retirado==1?'#F1F5F9':(d.es_venta==1?'#F0FDF4':'#FAFAFA')};${d.retirado==1?'border-left:4px solid #94A3B8;opacity:.8;':(d.es_venta==1?'border-left:4px solid #16A34A;':'border-left:4px solid #F59E0B;')}border-radius:8px;font-size:12px;cursor:pointer;" onmouseover="this.style.filter='brightness(.97)'" onmouseout="this.style.filter=''">
        <div class="!flex !justify-between"><b>${_resaltarTexto(d.nombre,q)}${d.retirado==1?` <span class="badge badge-gray !text-[10px] !ml-[4px]">🚫 Retirado</span>`:''}${d.es_venta!=1?` <span class="badge badge-warn !text-[10px] !ml-[4px]">💸 Gasto</span>`:''}${d.es_venta==1?` <span class="badge ![background:#16A34A] !text-[#fff] !text-[10px] !ml-[4px]">💰 VENTA${d.precio_total?' · '+Number(d.precio_total).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}):''}</span>`:''}</b><span>${_fmtCantUnidad(d.cantidad, d.unidad_envio)}</span></div>
        <div style="color:#64748B;margin-top:2px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;">
          <span>👤 ${_resaltarTexto(d.enviado_por,q)} · ${new Date(d.fecha).toLocaleString('es-CO')}</span>
          ${linkUbicacion}
        </div>
        ${d.descripcion?`<div style="margin-top:3px;color:#475569;">${_resaltarTexto(d.descripcion,q)}</div>`:''}
        ${d.retirado==1?`<div style="margin-top:4px;color:#92400E;">🚫 Retirado${d.retirado_en?' el '+new Date(d.retirado_en).toLocaleString('es-CO'):''}${d.retirado_por?' por '+esc(d.retirado_por):''}${d.retirado_motivo?' — '+_resaltarTexto(d.retirado_motivo,q):''}</div>`:''}
      </div>`;
    }).join('') || (q?'<div class="!text-[#94A3B8] !text-[12px]">Nada coincide con tu búsqueda.</div>':'<div class="!text-[#94A3B8] !text-[12px]">Sin movimientos.</div>');
}
// Una hoja de Excel con el detalle completo de UN proyecto: quién gastó
// qué, cuándo y cuánto — más el resumen por producto al final.
function _hojaProyectoDetalle(nombreProyecto, data){
  const filas = [
    [`Proyecto / Cliente: ${nombreProyecto}`],
    [`Movimientos: ${data.total_movimientos||0}   ·   Personas que han trabajado: ${(data.tecnicos||[]).join(', ')||'—'}`],
    [],
    ['Fecha','Usuario','Tipo','Producto','Cantidad','Unidad','Descripción / Lugar','Estado'],
  ];
  (data.detalle||[]).forEach(d=>{
    filas.push([
      d.fecha ? new Date(d.fecha).toLocaleString('es-CO') : '',
      d.enviado_por || '',
      d.es_venta==1 ? 'VENTA' : 'Gasto',
      d.nombre || '',
      d.cantidad,
      d.unidad_envio || '',
      d.descripcion || '',
      d.retirado==1 ? ('RETIRADO' + (d.retirado_en ? ' el ' + new Date(d.retirado_en).toLocaleString('es-CO') : '') + (d.retirado_motivo ? ' — ' + d.retirado_motivo : '')) : 'En el cliente',
    ]);
  });
  filas.push([]);
  filas.push(['Total por producto:']);
  Object.entries(data.resumen_productos||{}).forEach(([nombre,total])=>{
    filas.push(['', '', '', nombre, total, data.resumen_productos_unidad?.[nombre]||'']);
  });
  return XLSX.utils.aoa_to_sheet(filas);
}
// Nombre de hoja válido para Excel: máx. 31 caracteres, sin los símbolos
// prohibidos (: \ / ? * [ ]), y sin repetirse dentro del mismo libro.
function _nombreHojaExcel(nombre, usados){
  let limpio = String(nombre||'Proyecto').replace(/[:\\\/\?\*\[\]]/g,' ').trim().slice(0,31);
  if(!limpio) limpio = 'Proyecto';
  let final = limpio, i = 2;
  while(usados.has(final)){
    const sufijo = ' ('+i+')';
    final = limpio.slice(0, 31-sufijo.length) + sufijo;
    i++;
  }
  usados.add(final);
  return final;
}
// Exportar SOLO el proyecto que se está viendo en este momento.
async function exportarProyectoDetalleExcel(){
  if(!_pdProyectoActual){ toast('Abre un proyecto primero','error'); return; }
  let data = _pdDetalleActual;
  if(!data){
    try{
      const res = await fetch(`api/historial.php?action=ver_por_proyecto&proyecto=${encodeURIComponent(_pdProyectoActual)}`, {credentials:'same-origin'});
      data = await res.json();
      if(data.error){ toast(data.error,'error'); return; }
    }catch(e){ toast('Error al exportar','error'); return; }
  }
  const wb = XLSX.utils.book_new();
  const ws = _hojaProyectoDetalle(_pdProyectoActual, data);
  XLSX.utils.book_append_sheet(wb, ws, _nombreHojaExcel(_pdProyectoActual, new Set()));
  const fechaHoy = new Date().toISOString().split('T')[0];
  const nombreArchivo = String(_pdProyectoActual).replace(/[^a-z0-9]+/gi,'_').slice(0,40);
  XLSX.writeFile(wb, `proyecto_${nombreArchivo}_${fechaHoy}.xlsx`);
}
// Exportar TODOS los proyectos de una vez — una hoja por proyecto, cada
// una con lo que gastó cada usuario que trabajó ahí.
async function exportarProyectosExcel(){
  let proyectos = (_proyectosListaCache && _proyectosListaCache.length) ? _proyectosListaCache : null;
  if(!proyectos){
    try{
      const res = await fetch('api/historial.php?action=listar_proyectos', {credentials:'same-origin'});
      proyectos = await res.json();
      if(!Array.isArray(proyectos)) proyectos = [];
    }catch(e){ proyectos = []; }
  }
  if(!proyectos.length){ toast('No hay proyectos creados todavía','error'); return; }

  toast('Generando Excel… un momento','warn');
  const wb = XLSX.utils.book_new();
  const usados = new Set();
  for(const p of proyectos){
    let data;
    try{
      const res = await fetch(`api/historial.php?action=ver_por_proyecto&proyecto=${encodeURIComponent(p.proyecto_cliente)}`, {credentials:'same-origin'});
      data = await res.json();
      if(data.error) continue;
    }catch(e){ continue; }
    const ws = _hojaProyectoDetalle(p.proyecto_cliente, data);
    XLSX.utils.book_append_sheet(wb, ws, _nombreHojaExcel(p.proyecto_cliente, usados));
  }
  if(!wb.SheetNames.length){ toast('No se pudo exportar ningún proyecto','error'); return; }
  const fechaHoy = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `proyectos_clientes_${fechaHoy}.xlsx`);
  toast('Excel generado ✓','success');
}
function _capturarUbicacionGastar(){
  const status = document.getElementById('ubicacionGastarStatus');
  const btn = document.getElementById('btnUbicacionGastar');
  if(!navigator.geolocation){
    if(status){ status.textContent='Tu navegador no soporta ubicación GPS.'; status.style.color='#B91C1C'; }
    return;
  }
  if(btn){ btn.disabled=true; btn.textContent='📍 Buscando…'; }
  if(status){ status.textContent='Obteniendo tu ubicación…'; status.style.color='#0369A1'; }
  navigator.geolocation.getCurrentPosition(
    (pos)=>{
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      document.getElementById('gastarLat').value = lat;
      document.getElementById('gastarLng').value = lng;
      if(status){ status.innerHTML = `✓ Ubicación capturada: <a class="!text-[#0369A1] ![text-decoration:underline]" href="https://maps.google.com/?q=${lat},${lng}" target="_blank">${lat}, ${lng}</a>`; status.style.color='#16A871'; }
      if(btn){ btn.disabled=false; btn.textContent='📍 Actualizar'; }
    },
    (err)=>{
      if(status){ status.textContent = err.code===1 ? 'Permiso de ubicación denegado — puedes seguir sin GPS.' : 'No se pudo obtener la ubicación — puedes seguir sin GPS.'; status.style.color='#B45309'; }
      if(btn){ btn.disabled=false; btn.textContent='📍 GPS'; }
    },
    {enableHighAccuracy:true, timeout:10000}
  );
}
async function confirmarGastar(){
  const cant=_gastarEsMetros ? parseFloat(document.getElementById('cantidadGastar')?.value) : parseInt(document.getElementById('cantidadGastar')?.value);
  const motivo=(document.getElementById('motivoGastar')?.value||'').trim();
  const lugar=(document.getElementById('lugarGastar')?.value||'').trim();
  const lat=(document.getElementById('gastarLat')?.value||'').trim();
  const lng=(document.getElementById('gastarLng')?.value||'').trim();
  const proyectoCliente=(document.getElementById('clienteProyectoGastar')?.value||'').trim();
  if(!cant||cant<=0){toast('Ingresa una cantidad válida.','error');return;}
  if(!proyectoCliente){toast('Escribe el Cliente/Proyecto — es obligatorio para registrar el gasto.','error');document.getElementById('clienteProyectoGastar')?.focus();return;}
  if(!lugar && !(lat&&lng)){toast('Ingresa el lugar de instalación/uso, o usa el botón de GPS.','error');return;}
  const p=getProductos()[gastarIndex];
  if(!p){toast('Producto no encontrado.','error');return;}
  const rolloWrapVisible = document.getElementById('gastarRolloWrap')?.style.display === 'block';
  const rolloId = rolloWrapVisible ? document.getElementById('gastarRolloSelect')?.value : undefined;
  const esOrigenRecogido = document.querySelector('input[name="gastarOrigenRecogido"]:checked')?.value === 'recogido';
  try{
    if(esOrigenRecogido && window._gastarRecogidoDisponible){
      if(cant > window._gastarRecogidoDisponible.cantidad){
        toast(`Solo tienes ${window._gastarRecogidoDisponible.cantidad} recogidos disponibles`,'error');
        return;
      }
      // Puede haber más de un registro recogido (ej: 2 recogidos en
      // fechas distintas) — se va tomando de cada uno hasta completar la
      // cantidad exacta que la persona pidió, sin pasarse.
      const ids = window._gastarRecogidoDisponible.ids;
      let faltante = cant;
      for(const rid of ids){
        if(faltante <= 0) break;
        const res = await _api('productos','gastar_recogido',{id:rid, cantidad:faltante, lugar, lat:lat||undefined, lng:lng||undefined, proyecto_cliente:proyectoCliente||undefined}).catch(e=>({error:e.message}));
        if(res?.error && /Solo tienes (\d+)/.test(res.error)){
          // Ese registro no alcanzaba por sí solo — se toma completo de
          // ahí y se sigue con el siguiente por la diferencia.
          const disponibleAqui = parseInt(res.error.match(/\d+/)[0]);
          if(disponibleAqui > 0){
            const res2 = await _api('productos','gastar_recogido',{id:rid, cantidad:disponibleAqui, lugar, lat:lat||undefined, lng:lng||undefined, proyecto_cliente:proyectoCliente||undefined});
            if(!res2?.error) faltante -= disponibleAqui;
          }
        } else if(!res?.error){
          faltante = 0;
        }
      }
      if(faltante > 0) throw new Error('No se pudo completar toda la cantidad desde lo recogido.');
    } else {
      await _api('pedidos','gastar',{ref:p.ref,cantidad:cant,motivo,lugar,lat:lat||undefined,lng:lng||undefined,rollo_id:rolloId||undefined,proyecto_cliente:proyectoCliente||undefined});
    }
    await Promise.all([_recargarProductos(),_recargarHistorial()]);
    cerrarModal('modalGastar');renderTabla();renderStats();renderHistorial();
    toast(`Gasto registrado: −${cant} ${sufijoP(p)} de "${p.nombre}" en ${sesion.sede} ✓`,'success');
  }catch(e){toast(e.message||'Error al registrar gasto','error');}
}


// Mensaje inicial que se abre en WhatsApp al escribirle a un proveedor.
function _waSaludoProveedor(p){
  const quien = ((sesion?.nombre||'')+' '+(sesion?.apellido||'')).trim() || sesion?.usuario || '';
  const prov  = (p?.nombre||'').trim();
  return `Hola${prov?' '+prov:''}, le habla ${quien} de INTEGRADOS SYS.NET SAS. `;
}

// Nombres de persona: solo letras (con tildes/ñ), espacios, punto, apóstrofe y guion. Sin números.
function _soloLetrasNombre(inp){
  const v = inp.value, limpio = v.replace(/[^\p{L}\s.'’-]/gu,'');
  if(v !== limpio) inp.value = limpio;
}
function _nombreSoloLetras(t){ return /^\p{L}[\p{L}\s.'’-]*$/u.test(String(t||'').trim()); }


/* ══ INFORME DE PROVEEDORES (Excel) ══
   Hoja 1: datos de cada proveedor + los productos asociados.
   Hoja 2: un renglón por producto de cada proveedor.
   Hoja 3: lo que se ha pedido/comprado a cada proveedor (solicitudes de compra
           aprobadas, compradas o recibidas) — solo si el usuario tiene acceso. */
async function descargarInformeProveedores(){
  try{
    await cargarProveedores();
    if(!_proveedores.length){ toast('No hay proveedores para el informe','error'); return; }
    const prods = (typeof _productos!=='undefined' && Array.isArray(_productos)) ? _productos : [];
    const norm = t => String(t||'').trim().toLowerCase();

    // Compras (opcional: no todos los roles pueden verlas)
    let compras = [];
    try{
      const rc = await fetch('api/compras.php?action=listar',{credentials:'same-origin'});
      if(rc.ok){ const dc = await rc.json(); compras = Array.isArray(dc.solicitudes)?dc.solicitudes:[]; }
    }catch(e){}
    const comprasOk = compras.filter(s=>['aprobada','comprada','recibida'].includes(s.estado));
    const lblEst = {aprobada:'Aprobada',comprada:'Comprada',recibida:'Recibida'};

    const filasProv = [['Proveedor (razón social)','NIT / RUT','Persona de contacto','Teléfono','Correo','Dirección','# Productos','Productos que se compran','# Solicitudes de compra','Nota']];
    const filasProd = [['Proveedor','Ref','Producto','Unidad','Stock en almacén central']];
    const filasCom  = [['Proveedor','Solicitud','Fecha','Estado','Producto','Cantidad','Unidad']];

    _proveedores.slice().sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es')).forEach(p=>{
      const mios = prods.filter(x=>norm(x.proveedor)===norm(p.nombre)).sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es'));
      const sols = comprasOk.filter(s=>norm(s.proveedor)===norm(p.nombre) || (s.items||[]).some(i=>norm(i.proveedor)===norm(p.nombre)));
      filasProv.push([
        p.nombre, p.nit||'', p.contacto||'', p.telefono||'', p.correo||'', p.direccion||'',
        mios.length, mios.map(x=>x.nombre).join(', '), sols.length, p.nota||''
      ]);
      mios.forEach(x=>filasProd.push([p.nombre, x.ref||'', x.nombre||'', x.unidad||'unidad', (typeof _stockCentral==='function'?_stockCentral(x):0)]));
      sols.forEach(s=>{
        (s.items||[]).filter(i=>!i.proveedor || norm(i.proveedor)===norm(p.nombre) || norm(s.proveedor)===norm(p.nombre)).forEach(i=>{
          filasCom.push([p.nombre, s.codigo||('#'+s.id), s.creadoEn?new Date(s.creadoEn).toLocaleDateString('es-CO'):'', lblEst[s.estado]||s.estado, i.nombre||'', i.cantidad, i.unidad||'']);
        });
      });
    });

    const wb = XLSX.utils.book_new();
    const w1 = XLSX.utils.aoa_to_sheet(filasProv);
    w1['!cols']=[{wch:28},{wch:16},{wch:24},{wch:14},{wch:28},{wch:30},{wch:11},{wch:50},{wch:14},{wch:30}];
    XLSX.utils.book_append_sheet(wb,w1,'Proveedores');
    const w2 = XLSX.utils.aoa_to_sheet(filasProd);
    w2['!cols']=[{wch:28},{wch:14},{wch:34},{wch:10},{wch:14}];
    XLSX.utils.book_append_sheet(wb,w2,'Productos por proveedor');
    if(filasCom.length>1){
      const w3 = XLSX.utils.aoa_to_sheet(filasCom);
      w3['!cols']=[{wch:28},{wch:12},{wch:12},{wch:12},{wch:34},{wch:10},{wch:10}];
      XLSX.utils.book_append_sheet(wb,w3,'Compras por proveedor');
    }
    XLSX.writeFile(wb, `informe_proveedores_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast('Informe de proveedores descargado ✓','success');
  }catch(e){ console.error(e); toast('No se pudo generar el informe: '+(e.message||''),'error'); }
}