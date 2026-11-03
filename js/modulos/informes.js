/* ════════════════════════════════════════════════
   REMISIÓN PDF
════════════════════════════════════════════════ */
function anularIngreso(historialId, nombreProducto, cantidad){
  mostrarConfirmar({
    icono:'↩', color:'#B91C1C',
    titulo:'¿Anular este ingreso?',
    desc:`Se le van a restar ${cantidad} unidades de vuelta a "${nombreProducto}" (por si se registró la cantidad equivocada).`,
    btnTxt:'Sí, anular', btnColor:'#B91C1C',
    requirePassword:true,
    withNotes:true,
    notesLabel:'¿Por qué se anula? (obligatorio)',
    notesPlaceholder:'Ej: se registró el doble por error, la mercancía nunca llegó, etc.',
    notesRequired:true,
    onConfirmar: async(motivo)=>{
      await _ejecutarAnularIngreso(historialId, motivo, false);
    }
  });
}

async function _ejecutarAnularIngreso(historialId, motivo, confirmarAunque){
  try{
    const res = await fetch('api/productos.php?action=anular_ingreso',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({historial_id: historialId, motivo, confirmar_aunque_se_movio: confirmarAunque})
    });
    const d = await res.json();
    if(!res.ok && !d.aviso) throw new Error(d.error||'Error al anular');

    // El backend avisa si parte de ese ingreso ya se despachó/usó — pedir una segunda confirmación
    if(d.aviso){
      mostrarConfirmar({
        icono:'⚠️', color:'#B45309',
        titulo:'Este stock ya se movió',
        desc: d.mensaje,
        btnTxt:'Anular de todos modos', btnColor:'#B91C1C',
        onConfirmar: async()=>{ await _ejecutarAnularIngreso(historialId, motivo, true); }
      });
      return;
    }

    toast(`✓ Ingreso anulado — nuevo stock: ${d.stock_nuevo}`,'success');
    await _recargarProductos();
    await cargarHistorialPaginado(_histPagina||1);
    renderTabla(); renderStats();
  }catch(e){ toast(e.message,'error'); }
}

function abrirRemision(id, tipo) {
  if (!id) { toast('No hay remisión disponible para este registro.', 'warn'); return; }
  const url = `api/remision_pdf.php?action=generar&id=${encodeURIComponent(id)}&tipo=${tipo}`;
  window.open(url, '_blank', 'width=900,height=700,scrollbars=yes');
}

/* ════════════════════════════════════════════════
   AUDITORÍA
════════════════════════════════════════════════ */
// Estado paginación auditoría
let _audPagina = 1, _audPorPagina = 50, _audTotal = 0, _audPaginas = 0;

async function renderAuditoria(pagina){
  _audPagina = pagina || _audPagina;
  const tbody = document.getElementById('tablaAuditoria');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td class="!p-[24px] !text-center !text-[#94A3B8]" colspan="8">Cargando registros…</td></tr>';

  const fecha      = document.getElementById('audFecha')?.value   || '';
  const fechaHasta = document.getElementById('audFechaHasta')?.value || '';
  const usuario = document.getElementById('audUsuario')?.value || '';
  const modulo  = document.getElementById('audModulo')?.value  || '';
  const accion  = (document.getElementById('audAccion')?.value || '').trim();

  const sede = document.getElementById('audSede')?.value.trim() || '';
  const params = new URLSearchParams({pagina:_audPagina, por_pagina:_audPorPagina});
  if(fecha)      params.append('fecha',       fecha);
  if(fechaHasta) params.append('fecha_hasta', fechaHasta);
  if(usuario)    params.append('usuario', usuario);
  if(modulo)     params.append('modulo',  modulo);
  if(accion)     params.append('accion',  accion);
  if(sede)       params.append('sede',    sede);


  try {
    const res  = await fetch(`api/auditoria.php?action=listar&${params}`, {credentials:'same-origin'});
    const data = await res.json();

    _audTotal   = data.total   || 0;
    _audPaginas = data.paginas || 1;
    const rows  = data.registros || [];

    if(!rows.length){
      tbody.innerHTML = '<tr><td class="!p-[32px] !text-center !text-[#94A3B8]" colspan="8">Sin registros.</td></tr>';
      _actualizarPaginacionAud();
      return;
    }

    const colores = {
      crear:'#EAF3DE', editar:'#E6F1FB', eliminar:'#FCEBEB',
      aprobar:'#EAF3DE', rechazar:'#FCEBEB', login:'#EDE9FE',
      desactivar:'#FAEEDA', editar_permisos:'#E6F1FB'
    };
    const textos = {
      crear:'Crear', editar:'Editar', eliminar:'Eliminar',
      aprobar:'Aprobar', rechazar:'Rechazar', login:'Login',
      desactivar:'Desactivar', editar_permisos:'Permisos'
    };

    // Acciones críticas
    const _criticas = ['eliminar','rechazar','desactivar','cancelar'];
    const _esCritica = a => _criticas.some(x=>(a||'').toLowerCase().includes(x));

    // Resaltador — aplica a los campos que el usuario puede estar buscando
    const qUsr  = (document.getElementById('audUsuario')?.value||'').trim().toLowerCase();
    const qSede = (document.getElementById('audSede')?.value||'').trim().toLowerCase();
    const hlAud = (txt, q) => {
      txt = String(txt==null?'':txt);
      if(!q||!txt) return esc(txt);
      const idx = txt.toLowerCase().indexOf(q);
      if(idx<0) return esc(txt);
      return esc(txt.slice(0,idx))
        +`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`
        +esc(txt.slice(idx+q.length));
    };

    tbody.innerHTML = rows.map(r => {
      const critica = _esCritica(r.accion);
      const bg  = critica ? '#FCEBEB' : (colores[r.accion] || '#F1F5F9');
      const lbl = textos[r.accion] || r.accion;
      const fecha = r.fecha ? r.fecha.slice(0,16).replace('T',' ') : '';
      const ipMostrar = (r.ip==='::1'||r.ip==='127.0.0.1') ? '🖥 Local' : (r.ip||'—');
      const rowBg = critica ? 'background:#FFF5F5;' : '';
    return `<tr class="fade-row" style="${rowBg}">
        <td class="!text-[11px] !text-[#64748B] !whitespace-nowrap">${fecha}</td>
        <td style="font-weight:600;font-size:13px;color:${critica?'#B91C1C':'#0F172A'};">${hlAud(r.usuario, qUsr)}</td>
        <td><span class="badge badge-gray !text-[10px]">${esc(r.rol)}</span></td>
        <td class="!text-[12px] !text-[#64748B]">${hlAud(r.sede||'—', qSede)}</td>
        <td><span class="badge ![background:#F1F5F9] !text-[#475569] !text-[10px]">${esc(r.tabla||r.modulo||'—')}</span></td>
        <td><span class="badge" style="background:${bg};color:${critica?'#B91C1C':'#475569'};font-size:10px;font-weight:${critica?'700':'500'};">${critica?'⚠ ':''} ${lbl}</span></td>
        <td class="!text-[12px] !text-[#64748B] !max-w-[280px]">
          <div class="!whitespace-nowrap !overflow-hidden !text-ellipsis !cursor-pointer"
            title="Clic para ver completo"
            onclick="const s=this.style;s.whiteSpace=s.whiteSpace==='normal'?'nowrap':'normal';s.overflow=s.whiteSpace==='normal'?'hidden':'visible';s.textOverflow=s.whiteSpace==='normal'?'ellipsis':'unset';">
            ${esc(r.detalle||'—')}
          </div>
        </td>
        <td class="!text-[11px] !text-[#94A3B8] ![font-family:monospace] !whitespace-nowrap">${ipMostrar}</td>
      </tr>`;
    }).join('');
    _actualizarPaginacionAud();
  } catch(e) {
    tbody.innerHTML = '<tr><td class="!p-[24px] !text-center !text-[#B91C1C]" colspan="8">Error al cargar auditoría.</td></tr>';
  }
}

function audLimpiarFiltros(){
  ['audFecha','audFechaHasta','audUsuario','audSede'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const m=document.getElementById('audModulo'); if(m) m.value='';
  const ac=document.getElementById('audAccion'); if(ac) ac.value='';
  renderAuditoria(1);
}

async function _cargarResumenAuditoria(){
  try{
    const res = await fetch('api/auditoria.php?action=resumen',{credentials:'same-origin'});
    const data = await res.json();
    const el = document.getElementById('audResumen');
    if(!el || !Array.isArray(data)) return;

    // Contar por módulo — ignorar null/vacío
    const porModulo = {};
    data.forEach(r=>{
      const mod = r.modulo||'';
      if(!mod || mod==='null') return;
      porModulo[mod] = (porModulo[mod]||0) + parseInt(r.total);
    });

    // Totales
    const total = Object.values(porModulo).reduce((a,b)=>a+b,0);
    const modEntries = Object.entries(porModulo).sort((a,b)=>b[1]-a[1]);
    const modTop = modEntries[0];

    // Buscar usuario más activo desde la BD
    const resU = await fetch('api/auditoria.php?action=resumen_usuario',{credentials:'same-origin'});
    const dataU = resU.ok ? await resU.json() : null;
    const usuTop = dataU?.usuario || '—';
    const usuCnt = dataU?.total   || 0;

    el.innerHTML = [
      {label:'Acciones últimos 30 días', valor: total,                    color:'#0C6EDE', bg:'#E6F1FB'},
      {label:'Módulo más activo',        valor: modTop?modTop[0]:'—',     color:'#7C3AED', bg:'#EDE9FE'},
      {label:'Usuario más activo',       valor: `${usuTop} (${usuCnt})`,  color:'#16A850', bg:'#EAF3DE'},
    ].map(k=>`
      <div style="background:${k.bg};border-radius:10px;padding:8px 16px;flex:1;min-width:140px;">
        <div class="!text-[11px] !text-[#64748B] !mb-[2px]">${k.label}</div>
        <div style="font-weight:700;color:${k.color};font-size:15px;">${k.valor}</div>
      </div>`).join('');
  }catch(e){ console.warn('resumen auditoria:',e); }
}

function _actualizarPaginacionAud(){
  const pag = document.getElementById('audPaginacion');
  const info = document.getElementById('audPagInfo');
  const prev = document.getElementById('audBtnPrev');
  const next = document.getElementById('audBtnNext');
  const nums = document.getElementById('audPagNumeros');
  if(!pag) return;
  if(_audTotal===0){ pag.style.display='none'; return; }
  pag.style.display='flex';
  const desde = (_audPagina-1)*_audPorPagina+1;
  const hasta = Math.min(_audPagina*_audPorPagina, _audTotal);
  if(info) info.textContent = `Mostrando ${desde}–${hasta} de ${_audTotal} registros`;
  if(prev) prev.disabled = _audPagina<=1;
  if(next) next.disabled = _audPagina>=_audPaginas;
  if(nums){
    const inicio=Math.max(1,_audPagina-2), fin=Math.min(_audPaginas,inicio+4);
    let html='';
    for(let i=inicio;i<=fin;i++){
      const a=i===_audPagina;
      html+=`<button onclick="renderAuditoria(${i})" class="btn-sm"
        style="background:${a?'#0C6EDE':'#F1F5F9'};color:${a?'white':'#475569'};
        min-width:32px;font-weight:${a?'700':'400'};">${i}</button>`;
    }
    nums.innerHTML=html;
  }
}

function audCambiarPagina(dir){
  const n=_audPagina+dir;
  if(n<1||n>_audPaginas) return;
  renderAuditoria(n);
}

/* ════════════════════════════════════════════════
   INFORMES — producto más pedido, quién pidió más, sedes que más piden
════════════════════════════════════════════════ */
let _infCh = {};
let _infDatosActuales = null;

function _filtrarInfProducto(){
  const q = (document.getElementById('infProductoBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('infProductoLista');
  if(!lista) return;
  const productos = getProductos().filter(p=>!q||p.nombre.toLowerCase().includes(q)||p.ref.toLowerCase().includes(q));
  const hl = (txt) => {
    txt = String(txt||'');
    if(!q||!txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))+`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`+esc(txt.slice(idx+q.length));
  };
  lista.innerHTML = productos.length ? productos.slice(0,30).map(p=>`
    <div onclick="_seleccionarInfProducto('${esc(p.ref)}','${esc(p.nombre).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
      <div class="!font-semibold">${hl(p.nombre)}</div>
      <div class="!text-[11px] !text-[#94A3B8]">Ref. ${hl(p.ref)}</div>
    </div>`).join('') : '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>';
  lista.style.display='block';
}
function _seleccionarInfProducto(ref,nombre){
  document.getElementById('infProductoRef').value = ref;
  document.getElementById('infProductoBuscar').value = nombre;
  document.getElementById('infProductoLista').style.display='none';
}

function _filtrarInfUsuario(){
  const q = (document.getElementById('infUsuarioBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('infUsuarioLista');
  if(!lista) return;
  const usuarios = getUsuarios().filter(u=>['municipio','tecnico','persona','distribuidor'].includes(u.rol))
    .filter(u=>{
      const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
      return !q || nombreCompleto.toLowerCase().includes(q) || u.usuario.toLowerCase().includes(q);
    });
  const hl = (txt) => {
    txt = String(txt||'');
    if(!q||!txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))+`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`+esc(txt.slice(idx+q.length));
  };
  lista.innerHTML = usuarios.length ? usuarios.map(u=>{
    const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
    return `<div onclick="_seleccionarInfUsuario('${esc(u.usuario)}','${esc(nombreCompleto).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
      <div class="!font-semibold">${hl(nombreCompleto)}</div>
      <div class="!text-[11px] !text-[#94A3B8]">@${hl(u.usuario)} · ${esc(u.rol)}</div>
    </div>`;
  }).join('') : '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>';
  lista.style.display='block';
}
function _seleccionarInfUsuario(usuario,nombre){
  document.getElementById('infUsuarioVal').value = usuario;
  document.getElementById('infUsuarioBuscar').value = nombre;
  document.getElementById('infUsuarioLista').style.display='none';
}
document.addEventListener('click', function(e){
  ['infProducto','infUsuario'].forEach(pref=>{
    const lista=document.getElementById(pref+'Lista'), inp=document.getElementById(pref+'Buscar');
    if(lista && inp && !inp.contains(e.target) && !lista.contains(e.target)) lista.style.display='none';
  });
});

function _infLimpiarFiltros(){
  ['infProductoBuscar','infProductoRef','infUsuarioBuscar','infUsuarioVal','infDesde','infHasta'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const chk=document.getElementById('infIncluirPendientes'); if(chk) chk.checked=false;
  cargarInformes();
}

function _infRangoRapido(dias){
  const hoy = new Date();
  const desde = new Date(); desde.setDate(hoy.getDate()-dias);
  document.getElementById('infDesde').value = desde.toISOString().split('T')[0];
  document.getElementById('infHasta').value = hoy.toISOString().split('T')[0];
  cargarInformes();
}
function _infRangoMes(){
  const hoy = new Date();
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  document.getElementById('infDesde').value = inicio.toISOString().split('T')[0];
  document.getElementById('infHasta').value = hoy.toISOString().split('T')[0];
  cargarInformes();
}

function _setTabInformes(tab){
  const botones = {pedidos:'tabInfPedidos', ventas:'tabInfVentas', proveedores:'tabInfProveedores', margen:'tabInfMargen', incidencias:'tabInfIncidencias', auditoria:'tabInfAuditoria', onts:'tabInfOnts', gastos:'tabInfGastos'};
  const paneles = {pedidos:'infPanelPedidos', ventas:'infPanelVentas', proveedores:'infPanelProveedores', margen:'infPanelMargen', incidencias:'infPanelIncidencias', auditoria:'infPanelAuditoria', onts:'infPanelOnts', gastos:'infPanelGastos'};
  Object.keys(botones).forEach(t=>{
    const b=document.getElementById(botones[t]), p=document.getElementById(paneles[t]);
    const activo = t===tab;
    if(b){ b.style.background=activo?'#0C6EDE':'#F1F5F9'; b.style.color=activo?'white':'#475569'; }
    if(p) p.style.display=activo?'block':'none';
  });
  if(tab==='incidencias') cargarIncidenciasMaterial();
  if(tab==='onts') cargarOntInforme(true);
  if(tab==='gastos'){ if(!document.getElementById('gasInfDesde').value) _gasInfRango(30,true); else cargarGastosInforme(true); }
  if(tab==='ventas' && !document.getElementById('ventDesde').value){ _ventRangoRapido(30); }
  if(tab==='proveedores' && !document.getElementById('provDesde').value){ _provRangoRapido(9999); }
  if(tab==='margen' && !document.getElementById('margDesde').value){ _margRangoRapido(365); }
}
function _filtrarAudPersona(){
  const q = (document.getElementById('audPersBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('audPersLista');
  if(!lista) return;
  const personas = (getUsuarios()||[]).filter(u=>u.estado==='activo').filter(u=>{
    const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
    return !q || nombreCompleto.toLowerCase().includes(q) || u.usuario.toLowerCase().includes(q);
  });
  const hl = (txt) => {
    txt = String(txt||'');
    if(!q||!txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))+`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`+esc(txt.slice(idx+q.length));
  };
  lista.innerHTML = personas.length ? personas.slice(0,30).map(u=>{
    const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
    return `<div onclick="_seleccionarAudPersona('${esc(u.usuario)}','${esc(nombreCompleto).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
      <div class="!font-semibold">${hl(nombreCompleto)}</div>
      <div class="!text-[11px] !text-[#94A3B8]">@${hl(u.usuario)} · ${esc(u.rol)}</div>
    </div>`;
  }).join('') : '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>';
  lista.style.display='block';
}
function _seleccionarAudPersona(usuario,nombre){
  document.getElementById('audPersBuscar').value = nombre;
  document.getElementById('audPersLista').style.display='none';
  _cargarAuditoriaPersona(usuario);
}
document.addEventListener('click', function(e){
  const lista=document.getElementById('audPersLista');
  const inp=document.getElementById('audPersBuscar');
  if(lista && inp && !inp.contains(e.target) && !lista.contains(e.target)) lista.style.display='none';
});
async function _cargarAuditoriaPersona(usuario){
  const cont = document.getElementById('audResultado');
  if(!cont) return;
  cont.innerHTML = '<div class="!text-[#94A3B8] !text-[13px] !p-[20px] !text-center">Cargando…</div>';
  document.getElementById('audAnterioresWrap').style.display = 'block';
  _cargarAuditoriasAnteriores(usuario);
  try{
    const res = await fetch('api/informes.php?action=auditoria_persona&usuario='+encodeURIComponent(usuario), {credentials:'same-origin'});
    const data = await res.json();
    if(data.error){ cont.innerHTML = `<div class="!text-[#E24B4A] !text-[13px] !p-[20px]">${esc(data.error)}</div>`; return; }
    _renderAuditoriaPersona(data);
  }catch(e){
    cont.innerHTML = '<div class="!text-[#E24B4A] !text-[13px] !p-[20px]">Error al cargar.</div>';
  }
}
function _renderAuditoriaPersona(data){
  const cont = document.getElementById('audResultado');
  if(!cont) return;
  const p = data.persona;
  const nombreCompleto = `${p.nombre||''} ${p.apellido||''}`.trim() || p.usuario;

  if(!data.total_items){
    cont.innerHTML = `
      <div class="pcard">
        <div class="!p-[30px] !text-center !text-[#94A3B8]">
          <div class="!text-[32px] !mb-[8px]">📭</div>
          <div class="!font-semibold !text-[#334155]">${esc(nombreCompleto)}</div>
          <div class="!text-[13px] !mt-[4px]">No tiene nada registrado a su nombre en el sistema ahora mismo.</div>
        </div>
      </div>`;
    return;
  }

  const filaCheck = (id, label, sub) => `
    <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;cursor:pointer;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
      <input type="checkbox" id="${id}" onchange="_audActualizarResumen()" style="width:17px;height:17px;flex-shrink:0;accent-color:#16A871;">
      <div class="![flex:1]">
        <div class="!text-[13px] !font-semibold !text-[#334155]">${label}</div>
        ${sub?`<div class="!text-[11px] !text-[#94A3B8]">${sub}</div>`:''}
      </div>
    </label>`;

  const filaCantidad = (idx, nombre, ref, esperado, unidad) => {
    const suf = unidad==='metros'?'mts.':'uds.';
    return `<tr>
      <td class="!p-[9px_12px] !text-[13px]">
        <div class="!font-semibold !text-[#334155]">${esc(nombre)}</div>
        <div class="!text-[11px] !text-[#94A3B8]">Ref. ${esc(ref)}</div>
      </td>
      <td class="!p-[9px_12px] !text-[13px] !text-center">${fmtNum(esperado)} ${suf}</td>
      <td class="!p-[9px_12px]">
        <input type="number" min="0" step="any" id="audcant_${idx}" data-esperado="${esperado}" data-suf="${suf}"
          placeholder="Sin contar" oninput="_audActualizarDiferenciaCant(${idx})"
          style="width:100px;padding:6px 8px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:13px;">
      </td>
      <td style="padding:9px 12px;font-size:12px;" id="audDif_${idx}">—</td>
    </tr>`;
  };

  let secciones = '';
  let idx = 0;

  if(data.productos?.length){
    secciones += `<div class="pcard !mb-[12px]">
      <div class="pcard-header"><span class="!font-bold !text-[13px]">📦 Productos (${data.productos.length})</span></div>
      <div class="!overflow-x-auto">
        <table class="!w-[100%]">
          <thead><tr style="background:#F8FAFC;"><th class="!p-[8px_12px] !text-left !text-[11px] !text-[#64748B]">Producto</th><th class="!p-[8px_12px] !text-[11px] !text-[#64748B]">Sistema dice</th><th class="!p-[8px_12px] !text-left !text-[11px] !text-[#64748B]">Cantidad real</th><th class="!p-[8px_12px] !text-left !text-[11px] !text-[#64748B]">Diferencia</th></tr></thead>
          <tbody>${data.productos.map(x=>{const html=filaCantidad(idx, x.nombre, x.ref, x.cantidad, x.unidad); idx++; return html;}).join('')}</tbody>
        </table>
      </div>
    </div>`;
  }
  if(data.onts?.length){
    const lblEstado={disponible:'Disponible',despachada:'Despachada',ocupado:'Instalada/en uso',comodato:'Comodato',dañado:'Dañada'};
    secciones += `<div class="pcard !mb-[12px]">
      <div class="pcard-header"><span class="!font-bold !text-[13px]">📡 ONTs (${data.onts.length})</span></div>
      <div class="!p-[8px]">${data.onts.map(x=>{
        const rolAqui = x.tecnico_asignado===data.persona.usuario ? '🏢 Dueña' : '👤 Solo instala';
        return filaCheck(`audchk_${idx++}`, `${esc(x.modelo||'ONT')} — MAC ${esc(x.mac_fmt||'—')}`, `SN: ${esc(x.sn||'—')} · ${lblEstado[x.estado]||esc(x.estado)} · ${rolAqui}${x.cliente?' · Cliente: '+esc(x.cliente):''}`);
      }).join('')}</div>
    </div>`;
  }
  if(data.fibra?.length){
    secciones += `<div class="pcard !mb-[12px]">
      <div class="pcard-header"><span class="!font-bold !text-[13px]">🧵 Fibra (${data.fibra.length})</span></div>
      <div class="!p-[8px]">${data.fibra.map(x=>filaCheck(`audchk_${idx++}`, `${esc(x.categoria)} — ${parseFloat(x.disponible)} mts. disponibles`, `Carrete: ${esc(x.codigo)} (${x.metros} mts. totales)`)).join('')}</div>
    </div>`;
  }
  if(data.recogido?.length){
    secciones += `<div class="pcard !mb-[12px]">
      <div class="pcard-header"><span class="!font-bold !text-[13px]">♻️ Material recogido pendiente (${data.recogido.length})</span></div>
      <div class="!overflow-x-auto">
        <table class="!w-[100%]">
          <thead><tr style="background:#F8FAFC;"><th class="!p-[8px_12px] !text-left !text-[11px] !text-[#64748B]">Material</th><th class="!p-[8px_12px] !text-[11px] !text-[#64748B]">Sistema dice</th><th class="!p-[8px_12px] !text-left !text-[11px] !text-[#64748B]">Cantidad real</th><th class="!p-[8px_12px] !text-left !text-[11px] !text-[#64748B]">Diferencia</th></tr></thead>
          <tbody>${data.recogido.map(x=>{const html=filaCantidad(idx, `${x.nombre}${x.motivo?' — '+x.motivo:''}`, x.tipo||'—', x.cantidad, 'unidad'); idx++; return html;}).join('')}</tbody>
        </table>
      </div>
    </div>`;
  }

  cont.innerHTML = `
    <div class="pcard" style="margin-bottom:12px;background:#F8FAFC;">
      <div style="padding:14px 16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div>
          <div class="!font-bold !text-[15px] !text-[#0F172A]">${esc(nombreCompleto)}</div>
          <div class="!text-[12px] !text-[#94A3B8]">${esc(p.rol)} · ${esc(p.sede||'—')} · ${data.total_items} cosas en total registradas a su nombre</div>
        </div>
        <div class="!flex !items-center !gap-[10px]">
          <div id="audResumenContador" style="font-size:13px;font-weight:700;color:#16A871;">0 de ${data.total_items} verificadas ✓</div>
          <button onclick="_exportarAuditoriaExcel()" class="btn btn-ok !p-[6px_14px] !text-[12px]">
            <svg class="!inline ![vertical-align:middle] !mr-[3px]" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 3v13m0 0l-4-4m4 4l4-4M5 21h14"/></svg> Exportar Excel
          </button>
          <button onclick="_exportarAuditoriaPdf()" class="btn !p-[6px_14px] !text-[12px] ![background:#7C3AED] ![color:white]">📄 Descargar PDF</button>
        </div>
      </div>
    </div>
    ${secciones}
    <p class="!text-[11px] !text-[#94A3B8] !text-center !mt-[6px]">Marca cada cosa que sí encontraste físicamente. Lo que quede sin marcar es lo que hay que revisar o corregir en el sistema.</p>
  `;
  window._audTotalItems = data.total_items;
  window._audDatosActuales = data;
}
function _exportarAuditoriaExcel(){
  const data = window._audDatosActuales;
  if(!data){ toast('Primero genera la auditoría de una persona','error'); return; }
  const p = data.persona;
  const nombreCompleto = `${p.nombre||''} ${p.apellido||''}`.trim() || p.usuario;

  const filas = [['Categoría','Ítem','Detalle','Sistema dice','Cantidad real / Verificado']];
  let idx = 0;
  const verificado = () => {
    const cb = document.getElementById('audchk_'+idx); idx++;
    return cb?.checked ? 'Sí' : 'No';
  };
  const cantidadReal = () => {
    const inp = document.getElementById('audcant_'+idx); idx++;
    return inp?.value!=='' && inp?.value!==undefined ? `${fmtNum(inp.value)} ${inp.dataset.suf||''}` : 'Sin contar';
  };

  (data.productos||[]).forEach(x=>{
    filas.push(['Producto', x.nombre, `Ref. ${x.ref}`, `${fmtNum(x.cantidad)} ${x.unidad==='metros'?'mts.':'uds.'}`, cantidadReal()]);
  });
  const lblEstado={disponible:'Disponible',despachada:'Despachada',ocupado:'Instalada/en uso',comodato:'Comodato',dañado:'Dañada'};
  (data.onts||[]).forEach(x=>{
    filas.push(['ONT', x.modelo||'ONT', `MAC ${x.mac_fmt||'—'} · SN ${x.sn||'—'}`, `${lblEstado[x.estado]||x.estado}${x.cliente?' · Cliente: '+x.cliente:''}`, verificado()]);
  });
  (data.fibra||[]).forEach(x=>{
    filas.push(['Fibra', x.categoria, `Carrete: ${x.codigo}`, `${parseFloat(x.disponible)} de ${x.metros} mts.`, verificado()]);
  });
  (data.recogido||[]).forEach(x=>{
    filas.push(['Material recogido', x.nombre, x.motivo||'', `${fmtNum(x.cantidad)} uds.`, cantidadReal()]);
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols']=[{wch:16},{wch:26},{wch:28},{wch:22},{wch:20}];
  XLSX.utils.book_append_sheet(wb, ws, 'Auditoría');

  const fechaHoy = new Date().toISOString().split('T')[0];
  const nombreLimpio = nombreCompleto.replace(/[^a-zA-Z0-9]/g,'_');
  XLSX.writeFile(wb, `auditoria_${nombreLimpio}_${fechaHoy}.xlsx`);
}
async function _exportarAuditoriaPdf(){
  const data = window._audDatosActuales;
  if(!data){ toast('Primero genera la auditoría de una persona','error'); return; }

  let idx = 0;
  const productosOut = (data.productos||[]).map(x=>{
    const inp = document.getElementById('audcant_'+idx); idx++;
    return { ref:x.ref, nombre:x.nombre, unidad:x.unidad, esperado:x.cantidad, real: (inp?.value!==''&&inp?.value!==undefined) ? inp.value : null };
  });
  const ontsOut = (data.onts||[]).map(x=>{
    const cb = document.getElementById('audchk_'+idx); idx++;
    return { modelo:x.modelo||'ONT', sn:x.sn||'—', estado:x.estado, verificado: !!cb?.checked };
  });
  const fibraOut = (data.fibra||[]).map(x=>{
    const cb = document.getElementById('audchk_'+idx); idx++;
    return { categoria:x.categoria, codigo:x.codigo, disponible:`${parseFloat(x.disponible)} de ${x.metros} mts.`, verificado: !!cb?.checked };
  });
  const recogidoOut = (data.recogido||[]).map(x=>{
    const inp = document.getElementById('audcant_'+idx); idx++;
    return { ref:x.tipo||'—', nombre:`${x.nombre}${x.motivo?' — '+x.motivo:''}`, unidad:'unidad', esperado:x.cantidad, real: (inp?.value!==''&&inp?.value!==undefined) ? inp.value : null };
  });

  const payload = {
    usuario: data.persona.usuario,
    datos: {
      persona: data.persona,
      items: { productos: [...productosOut, ...recogidoOut], onts: ontsOut, fibra: fibraOut }
    }
  };

  // Se abre la ventana YA, antes de esperar la respuesta del servidor —
  // si se abre después del await, el navegador la bloquea como popup
  // porque ya no lo cuenta como "clic directo del usuario".
  const ventanaPdf = window.open('', '_blank');
  if(ventanaPdf) ventanaPdf.document.write('<p class="![font-family:Arial] !p-[40px] !text-[#64748B]">Generando auditoría…</p>');

  try{
    const res = await _api('informes','guardar_auditoria', payload);
    if(res.error){
      toast(res.error,'error');
      if(ventanaPdf) ventanaPdf.close();
      return;
    }
    toast('Auditoría guardada ✓','success');
    const url = `api/auditoria_pdf.php?id=${res.id}&autoprint=1`;
    if(ventanaPdf) ventanaPdf.location.href = url;
    else window.open(url, '_blank'); // por si el navegador igual la bloqueó
    _cargarAuditoriasAnteriores(data.persona.usuario);
  }catch(e){
    toast('Error al guardar la auditoría','error');
    if(ventanaPdf) ventanaPdf.close();
  }
}
async function _cargarAuditoriasAnteriores(usuario){
  const cont = document.getElementById('audAnterioresLista');
  if(!cont) return;
  try{
    const res = await fetch(`api/informes.php?action=listar_auditorias&usuario=${encodeURIComponent(usuario)}`, {credentials:'same-origin'});
    const lista = await res.json();
    if(!Array.isArray(lista) || !lista.length){
      cont.innerHTML = '<div class="!text-[12px] !text-[#94A3B8]">Sin auditorías guardadas todavía para esta persona.</div>';
      return;
    }
    cont.innerHTML = lista.map(a=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:6px;">
        <span class="!text-[12px] !text-[#334155]">📅 ${new Date(a.fecha).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'})} — por ${esc(a.realizado_por)}</span>
        <button onclick="window.open('api/auditoria_pdf.php?id=${a.id}&autoprint=1','_blank')" class="btn-sm ![background:#EDE9FE] !text-[#7C3AED]">Ver PDF</button>
      </div>`).join('');
  }catch(e){ cont.innerHTML = '<div class="!text-[12px] !text-[#E24B4A]">Error al cargar.</div>'; }
}
function fmtNum(n){ n = parseFloat(n)||0; return Number.isInteger(n) ? n : parseFloat(n.toFixed(2)); }
function _audActualizarResumen(){
  const total = window._audTotalItems || 0;
  const marcadosChk = document.querySelectorAll('#audResultado input[type="checkbox"]:checked').length;
  const marcadosCant = Array.from(document.querySelectorAll('#audResultado input[type="number"]')).filter(i=>i.value!=='').length;
  const marcados = marcadosChk + marcadosCant;
  const el = document.getElementById('audResumenContador');
  if(el){
    el.textContent = `${marcados} de ${total} verificadas ✓`;
    el.style.color = marcados===total ? '#16A871' : '#BA7517';
  }
}
function _audActualizarDiferenciaCant(idx){
  const inp = document.getElementById(`audcant_${idx}`);
  const dif = document.getElementById(`audDif_${idx}`);
  if(!inp||!dif) return;
  const esperado = parseFloat(inp.dataset.esperado)||0;
  const suf = inp.dataset.suf||'uds.';
  if(inp.value===''){ dif.innerHTML='—'; dif.style.color='#94A3B8'; _audActualizarResumen(); return; }
  const real = parseFloat(inp.value)||0;
  const diferencia = fmtNum(real - esperado);
  if(diferencia===0){ dif.innerHTML='✅ Coincide'; dif.style.color='#166534'; }
  else if(diferencia<0){ dif.innerHTML=`❌ Faltan ${fmtNum(Math.abs(diferencia))} ${suf}`; dif.style.color='#B91C1C'; }
  else { dif.innerHTML=`⚠ Sobran ${fmtNum(diferencia)} ${suf}`; dif.style.color='#BA7517'; }
  _audActualizarResumen();
}
function _incRangoRapido(dias){
  const hoy = new Date();
  if(dias>=9999){
    document.getElementById('incDesde').value = '';
    document.getElementById('incHasta').value = '';
  } else {
    const desde = new Date(); desde.setDate(hoy.getDate()-dias);
    document.getElementById('incDesde').value = desde.toISOString().split('T')[0];
    document.getElementById('incHasta').value = hoy.toISOString().split('T')[0];
  }
  cargarIncidenciasMaterial();
}

function _ventRangoRapido(dias){
  const hoy = new Date();
  if(dias>=9999){
    document.getElementById('ventDesde').value = '2000-01-01';
  } else {
    const desde = new Date(); desde.setDate(hoy.getDate()-dias);
    document.getElementById('ventDesde').value = desde.toISOString().split('T')[0];
  }
  document.getElementById('ventHasta').value = hoy.toISOString().split('T')[0];
  cargarInformeVentas();
}
async function cargarInformeVentas(){
  const desde = document.getElementById('ventDesde')?.value || '';
  const hasta = document.getElementById('ventHasta')?.value || '';
  const fmtCOP = (n) => (parseFloat(n)||0).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
  try{
    const res = await fetch(`api/informes.php?action=ventas&desde=${desde}&hasta=${hasta}`, {credentials:'same-origin'});
    const data = await res.json();
    if(data.error){ toast(data.error,'error'); return; }
    window._ventDatosActuales = data;

    const t = data.totales || {};
    document.getElementById('ventTotalIngresos').textContent = fmtCOP(t.total_ingresos);
    document.getElementById('ventNumVentas').textContent = t.num_ventas || 0;
    document.getElementById('ventTotalUnidades').textContent = t.total_unidades || 0;
    const promedio = t.num_ventas>0 ? (t.total_ingresos/t.num_ventas) : 0;
    document.getElementById('ventTicketPromedio').textContent = fmtCOP(promedio);

    const ov = data.origen_ventas || {};
    const origenWrap = document.getElementById('ventOrigenWrap');
    if((parseFloat(ov.total_recuperado)||0) > 0){
      origenWrap.style.display = 'block';
      document.getElementById('ventOrigenNuevo').textContent = fmtCOP(ov.total_nuevo);
      document.getElementById('ventOrigenRecuperado').textContent = fmtCOP(ov.total_recuperado);
      document.getElementById('ventOrigenRecupUds').textContent = `(${fmtNum(ov.unidades_recuperado)} uds.)`;
    } else {
      origenWrap.style.display = 'none';
    }

    const tvend = document.getElementById('ventTablaVendedores');
    tvend.innerHTML = (data.vendedores||[]).length
      ? data.vendedores.map(v=>`<tr><td>${esc(v.nombre_completo)}</td><td class="!text-center">${v.num_ventas}</td><td class="!text-right !font-semibold !text-[#166534]">${fmtCOP(v.total_vendido)}</td></tr>`).join('')
      : '<tr><td class="!text-center !text-[#94A3B8] !p-[16px]" colspan="3">Sin ventas registradas</td></tr>';

    const tprod = document.getElementById('ventTablaProductos');
    tprod.innerHTML = (data.productos_vendidos||[]).length
      ? data.productos_vendidos.map(p=>`<tr><td>${esc(p.nombre)}</td><td class="!text-center">${fmtNum(p.total_unidades)}</td><td class="!text-right !font-semibold !text-[#166534]">${fmtCOP(p.total_vendido)}</td></tr>`).join('')
      : '<tr><td class="!text-center !text-[#94A3B8] !p-[16px]" colspan="3">Sin ventas registradas</td></tr>';

    const pagosDiv = document.getElementById('ventFormasPago');
    pagosDiv.innerHTML = (data.formas_pago||[]).length
      ? data.formas_pago.map(fp=>`
          <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:10px 16px;min-width:140px;">
            <div class="!text-[11px] !text-[#94A3B8]">${esc(fp.forma_pago)}</div>
            <div class="!text-[16px] !font-bold !text-[#166534]">${fmtCOP(fp.total)}</div>
            <div class="!text-[10px] !text-[#94A3B8]">${fp.num_ventas} venta${fp.num_ventas!=1?'s':''}</div>
          </div>`).join('')
      : '<div class="!text-[#94A3B8] !text-[13px]">Sin datos</div>';

    const tdet = document.getElementById('ventTablaDetalle');
    const vacio = document.getElementById('ventVacio');
    if((data.detalle||[]).length){
      vacio.style.display='none';
      tdet.innerHTML = data.detalle.map(d=>`<tr>
        <td class="!text-[12px] !text-[#94A3B8]">${new Date(d.fecha).toLocaleDateString('es-CO')}</td>
        <td>${esc(d.nombre)}${d.es_recuperado?'<div class="!text-[9px] !font-bold !text-[#166534] ![background:#EAF3DE] !inline-block !p-[1px_5px] !rounded-[4px] !mt-[2px]">♻️ Recuperado</div>':''}</td>
        <td>${esc(d.cliente_venta||'—')}</td>
        <td class="!text-center">${fmtNum(d.cantidad)}</td>
        <td class="!text-right !font-semibold !text-[#166534]">${fmtCOP(d.precio_total)}</td>
        <td class="!text-[12px]">${esc(d.forma_pago||'—')}</td>
        <td class="!text-[12px] !text-[#94A3B8]">${esc(d.enviado_por)}</td>
      </tr>`).join('');
    } else {
      tdet.innerHTML = '';
      vacio.style.display='block';
    }
  }catch(e){ toast('Error al cargar el informe de ventas','error'); }
}
function _exportarVentasExcel(){
  const data = window._ventDatosActuales;
  if(!data){ toast('Primero genera el informe','error'); return; }
  const filas = [['Fecha','Producto','Cliente','Cantidad','Precio unitario','Precio total','Forma de pago','Vendedor']];
  (data.detalle||[]).forEach(d=>{
    filas.push([
      new Date(d.fecha).toLocaleDateString('es-CO'), d.nombre, d.cliente_venta||'',
      parseFloat(d.cantidad), parseFloat(d.precio_unitario)||0, parseFloat(d.precio_total)||0,
      d.forma_pago||'', d.enviado_por,
    ]);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols']=[{wch:12},{wch:26},{wch:20},{wch:10},{wch:14},{wch:14},{wch:16},{wch:16}];
  XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
  const fechaHoy = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `ventas_${fechaHoy}.xlsx`);
}

let _cvsMargenChart = null;
function _margRangoRapido(dias){
  const hoy = new Date();
  if(dias>=9999){
    document.getElementById('margDesde').value = '2000-01-01';
  } else {
    const desde = new Date(); desde.setDate(hoy.getDate()-dias);
    document.getElementById('margDesde').value = desde.toISOString().split('T')[0];
  }
  document.getElementById('margHasta').value = hoy.toISOString().split('T')[0];
  cargarInformeMargen();
}
async function cargarInformeMargen(){
  const desde = document.getElementById('margDesde')?.value || '';
  const hasta = document.getElementById('margHasta')?.value || '';
  const fmtCOP = (n) => (parseFloat(n)||0).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
  try{
    const res = await fetch(`api/informes.php?action=costos_vs_ventas&desde=${desde}&hasta=${hasta}`, {credentials:'same-origin'});
    const data = await res.json();
    if(data.error){ toast(data.error,'error'); return; }

    document.getElementById('margTotalCostos').textContent = fmtCOP(data.costos?.total);
    document.getElementById('margTotalVentas').textContent = fmtCOP(data.ventas?.total);
    const margenEl = document.getElementById('margMargen');
    const margen = parseFloat(data.margen)||0;
    margenEl.textContent = fmtCOP(margen);
    margenEl.style.color = margen>=0 ? '#166534' : '#B91C1C';

    const tend = data.tendencia || [];
    const cvs = document.getElementById('cvsMargenTendencia');
    const sinDatos = document.getElementById('margSinDatos');
    if(!tend.length){
      if(_cvsMargenChart){ _cvsMargenChart.destroy(); _cvsMargenChart=null; }
      cvs.style.display='none'; sinDatos.style.display='block';
      return;
    }
    cvs.style.display='block'; sinDatos.style.display='none';
    const etiquetas = tend.map(t=>{
      const [y,m] = t.mes.split('-');
      return new Date(y,m-1,1).toLocaleDateString('es-CO',{month:'short',year:'2-digit'});
    });
    if(_cvsMargenChart) _cvsMargenChart.destroy();
    _cvsMargenChart = new Chart(cvs.getContext('2d'), {
      type:'bar',
      data:{
        labels: etiquetas,
        datasets:[
          {label:'Compras', data: tend.map(t=>t.costos), backgroundColor:'rgba(185,28,28,.75)', borderRadius:4},
          {label:'Ventas', data: tend.map(t=>t.ventas), backgroundColor:'rgba(22,101,52,.75)', borderRadius:4},
        ]
      },
      options:{responsive:true, maintainAspectRatio:false,
        plugins:{legend:{position:'top', labels:{font:{size:11}}}},
        scales:{x:{ticks:{font:{size:10}},grid:{display:false}}, y:{ticks:{font:{size:10},callback:v=>fmtCOP(v)},grid:{color:'#E2E8F0'},beginAtZero:true}}
      }
    });
  }catch(e){ toast('Error al cargar el informe de margen','error'); }
}
function _provRangoRapido(dias){
  const hoy = new Date();
  if(dias>=9999){
    document.getElementById('provDesde').value = '2000-01-01';
  } else {
    const desde = new Date(); desde.setDate(hoy.getDate()-dias);
    document.getElementById('provDesde').value = desde.toISOString().split('T')[0];
  }
  document.getElementById('provHasta').value = hoy.toISOString().split('T')[0];
  cargarInformeProveedores();
}
async function cargarInformeProveedores(){
  const desde = document.getElementById('provDesde')?.value || '';
  const hasta = document.getElementById('provHasta')?.value || '';
  const fmtCOP = (n) => (parseFloat(n)||0).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
  try{
    const res = await fetch(`api/informes.php?action=proveedores_informe&desde=${desde}&hasta=${hasta}`, {credentials:'same-origin'});
    const data = await res.json();
    if(data.error){ toast(data.error,'error'); return; }
    window._provDatosActuales = data;

    const t = data.totales || {};
    document.getElementById('provTotalComprado').textContent = fmtCOP(t.total_comprado);
    document.getElementById('provNumIngresos').textContent = t.num_ingresos || 0;
    document.getElementById('provNumProveedores').textContent = t.num_proveedores || 0;

    const alerta = document.getElementById('provAlertaSinDato');
    if(data.sin_proveedor > 0){
      alerta.style.display = 'block';
      alerta.textContent = `⚠ Hay ${data.sin_proveedor} ingreso(s) en este rango SIN proveedor registrado — no aparecen aquí. Elige el proveedor al registrar la llegada para que este reporte quede completo.`;
    } else {
      alerta.style.display = 'none';
    }

    const trank = document.getElementById('provTablaRanking');
    trank.innerHTML = (data.proveedores||[]).length
      ? data.proveedores.map(p=>`<tr>
          <td class="!font-semibold">${esc(p.proveedor)}</td>
          <td class="!text-center">${p.num_ingresos}</td>
          <td class="!text-center">${fmtNum(p.total_unidades)}</td>
          <td class="!text-right !font-semibold !text-[#166534]">${fmtCOP(p.total_comprado)}</td>
          <td class="!text-[12px] !text-[#94A3B8]">${new Date(p.ultima_compra).toLocaleDateString('es-CO')}</td>
        </tr>`).join('')
      : '<tr><td class="!text-center !text-[#94A3B8] !p-[16px]" colspan="5">Sin compras con proveedor identificado</td></tr>';

    const tdet = document.getElementById('provTablaDetalle');
    const vacio = document.getElementById('provVacio');
    if((data.detalle||[]).length){
      vacio.style.display='none';
      tdet.innerHTML = data.detalle.map(d=>`<tr>
        <td class="!text-[12px] !text-[#94A3B8]">${new Date(d.fecha).toLocaleDateString('es-CO')}</td>
        <td>${esc(d.nombre)}</td>
        <td>${esc(d.proveedor)}</td>
        <td class="!text-center">${fmtNum(d.cantidad)}</td>
        <td class="!text-right !font-semibold !text-[#166534]">${d.precio_total?fmtCOP(d.precio_total):'—'}</td>
      </tr>`).join('');
    } else {
      tdet.innerHTML = '';
      vacio.style.display='block';
    }
  }catch(e){ toast('Error al cargar el informe de proveedores','error'); }
}
function _exportarProveedoresExcel(){
  const data = window._provDatosActuales;
  if(!data){ toast('Primero genera el informe','error'); return; }
  const filas = [['Fecha','Producto','Proveedor','Cantidad','Precio total']];
  (data.detalle||[]).forEach(d=>{
    filas.push([
      new Date(d.fecha).toLocaleDateString('es-CO'), d.nombre, d.proveedor,
      parseFloat(d.cantidad), parseFloat(d.precio_total)||0,
    ]);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(filas);
  ws['!cols']=[{wch:12},{wch:26},{wch:22},{wch:10},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws, 'Proveedores');
  const fechaHoy = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `proveedores_${fechaHoy}.xlsx`);
}
function _exportarIncidenciasExcel(){
  const data = window._incDatosActuales;
  if(!data){ toast('Primero genera el reporte','error'); return; }
  const wb = XLSX.utils.book_new();

  // Resumen por tipo
  const filasResumen = [['Tipo','Veces','Cantidad total']];
  const lblTipo = {dañado_recibido:'Llegó dañado en envíos', recogido_reutilizable:'Recogido — reutilizable', recogido_dañado:'Recogido — dañado'};
  (data.totales_por_tipo||[]).forEach(t=>filasResumen.push([lblTipo[t.origen]||t.origen, t.veces, parseFloat(t.total)]));
  const wsResumen = XLSX.utils.aoa_to_sheet(filasResumen);
  wsResumen['!cols']=[{wch:28},{wch:10},{wch:14}];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  // Productos que más se dañan
  const filasProd = [['Producto','Cantidad total','# Veces']];
  (data.top_productos_danados||[]).forEach(p=>filasProd.push([p.nombre, parseFloat(p.total), p.veces]));
  const wsProd = XLSX.utils.aoa_to_sheet(filasProd);
  wsProd['!cols']=[{wch:28},{wch:16},{wch:12}];
  XLSX.utils.book_append_sheet(wb, wsProd, 'Productos que más dañan');

  // Quién más reporta daño
  const filasUsr = [['Persona','Cantidad total','# Veces']];
  (data.top_usuarios_danan||[]).forEach(u=>filasUsr.push([u.nombre_completo||u.usuario, parseFloat(u.total), u.veces]));
  const wsUsr = XLSX.utils.aoa_to_sheet(filasUsr);
  wsUsr['!cols']=[{wch:24},{wch:16},{wch:12}];
  XLSX.utils.book_append_sheet(wb, wsUsr, 'Quién más reporta');

  // Pendientes por persona (lo que sigue sin devolver ahora mismo)
  const filasPend = [['Persona','Producto','Cantidad','Motivo','Desde cuándo']];
  (data.pendientes_por_persona||[]).forEach(p=>filasPend.push([p.nombre_completo||p.usuario, p.nombre, p.cantidad, p.motivo||'', p.fecha]));
  const wsPend = XLSX.utils.aoa_to_sheet(filasPend);
  wsPend['!cols']=[{wch:22},{wch:26},{wch:10},{wch:26},{wch:18}];
  XLSX.utils.book_append_sheet(wb, wsPend, 'Pendientes de devolver');

  // Detalle completo
  const filasDet = [['Fecha','Tipo','Producto','Cantidad','Persona','Detalle']];
  (data.detalle||[]).forEach(d=>filasDet.push([d.fecha, lblTipo[d.origen]||d.origen, d.nombre, d.cantidad, d.destino||d.enviado_por||'', d.descripcion||'']));
  const wsDet = XLSX.utils.aoa_to_sheet(filasDet);
  wsDet['!cols']=[{wch:18},{wch:24},{wch:26},{wch:10},{wch:18},{wch:32}];
  XLSX.utils.book_append_sheet(wb, wsDet, 'Detalle');

  const sufijo = (data.desde?`_${data.desde}`:'') + (data.hasta?`_a_${data.hasta}`:'');
  XLSX.writeFile(wb, `material_danado_recogido${sufijo}.xlsx`);
}

async function cargarIncidenciasMaterial(){
  const desde = document.getElementById('incDesde')?.value || '';
  const hasta = document.getElementById('incHasta')?.value || '';
  const kpis = document.getElementById('incKpis');
  if(kpis) kpis.innerHTML = '<div class="!text-[#94A3B8] !text-[13px] !p-[12px]">Generando…</div>';
  try{
    const params = new URLSearchParams({desde, hasta});
    const res = await fetch('api/informes.php?action=incidencias_material&'+params, {credentials:'same-origin'});
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    window._incDatosActuales = data;
    _renderIncKpis(data);
    _renderIncTablas(data);
  }catch(e){
    if(kpis) kpis.innerHTML = `<div class="!text-[#E24B4A] !text-[13px] !p-[12px]">Error: ${e.message}</div>`;
  }
}
function _renderIncKpis(data){
  const el = document.getElementById('incKpis');
  if(!el) return;
  const porTipo = {};
  (data.totales_por_tipo||[]).forEach(t=>{ porTipo[t.origen] = t; });
  const danadoRecibido = porTipo['dañado_recibido']?.total || 0;
  const recogidoReut   = porTipo['recogido_reutilizable']?.total || 0;
  const recogidoDan    = porTipo['recogido_dañado']?.total || 0;
  const tarjetas = [
    {label:'Llegó dañado en envíos', valor: danadoRecibido, color:'#B91C1C', bg:'#FCEBEB'},
    {label:'Recogido — reutilizable', valor: recogidoReut, color:'#166534', bg:'#EAF3DE'},
    {label:'Recogido — dañado', valor: recogidoDan, color:'#B91C1C', bg:'#FCEBEB'},
  ];
  el.innerHTML = tarjetas.map(t=>`
    <div style="background:${t.bg};border-radius:12px;padding:12px 18px;flex:1;min-width:180px;">
      <div class="!text-[11px] !text-[#64748B] !mb-[3px]">${t.label}</div>
      <div style="font-weight:700;color:${t.color};font-size:20px;">${t.valor}</div>
    </div>`).join('');

  // Estado de lo reutilizable recogido
  const estWrap = document.getElementById('incEstadoReut');
  if(estWrap){
    const labels = {en_poder:'📦 Aún en poder de alguien', devuelto:'↩ Devuelto al almacén', gastado:'🔧 Ya se usó'};
    const colores = {en_poder:'#BA7517', devuelto:'#0C6EDE', gastado:'#166534'};
    const est = data.estado_reutilizable || [];
    estWrap.innerHTML = est.length ? est.map(e=>`
      <div style="background:#F8FAFC;border-radius:10px;padding:10px 16px;">
        <div class="!text-[11px] !text-[#64748B]">${labels[e.estado]||e.estado}</div>
        <div style="font-weight:700;font-size:16px;color:${colores[e.estado]||'#334155'};">${e.total} <span class="!text-[11px] !font-normal !text-[#94A3B8]">(${e.veces} veces)</span></div>
      </div>`).join('') : '<div class="!text-[#94A3B8] !text-[13px]">Sin datos en este rango.</div>';
  }
}
function _renderIncTablas(data){
  const tp = document.getElementById('incTablaProductos');
  if(tp){
    const prods = data.top_productos_danados || [];
    tp.innerHTML = prods.length ? prods.map(p=>`
      <tr><td class="!font-semibold">${esc(p.nombre)}</td>
      <td class="!font-bold !text-[#B91C1C]">${p.total}</td>
      <td class="!text-[#64748B]">${p.veces}</td></tr>
    `).join('') : '<tr><td class="!text-center !text-[#94A3B8] !p-[20px]" colspan="3">Sin datos en este rango.</td></tr>';
  }
  const tu = document.getElementById('incTablaUsuarios');
  if(tu){
    const usrs = data.top_usuarios_danan || [];
    tu.innerHTML = usrs.length ? usrs.map(u=>`
      <tr><td class="!font-semibold">${esc(u.nombre_completo||u.usuario)}</td>
      <td class="!font-bold !text-[#B91C1C]">${u.total}</td>
      <td class="!text-[#64748B]">${u.veces}</td></tr>
    `).join('') : '<tr><td class="!text-center !text-[#94A3B8] !p-[20px]" colspan="3">Sin datos en este rango.</td></tr>';
  }
  const tpend = document.getElementById('incTablaPendientes');
  const contPend = document.getElementById('incPendContador');
  if(tpend){
    const pend = data.pendientes_por_persona || [];
    if(contPend) contPend.textContent = pend.length ? `${pend.length} pendientes` : '';
    tpend.innerHTML = pend.length ? pend.map(p=>`
      <tr>
        <td class="!font-semibold">${esc(p.nombre_completo||p.usuario)}</td>
        <td>${esc(p.nombre)} <span class="!text-[10px] !text-[#94A3B8]">(${esc(p.ref)})</span></td>
        <td class="!font-bold !text-[#166534]">${p.cantidad}</td>
        <td class="!text-[11px] !text-[#64748B]">${esc(p.motivo||'—')}</td>
        <td class="!text-[11px] !text-[#94A3B8] !whitespace-nowrap">${fmtDate(p.fecha)}</td>
      </tr>
    `).join('') : '<tr><td class="!text-center !text-[#94A3B8] !p-[20px]" colspan="5">Nadie tiene material pendiente de devolver ahora mismo. ✓</td></tr>';
  }
  const td = document.getElementById('incTablaDetalle');
  const cont = document.getElementById('incDetContador');
  if(td){
    const det = data.detalle || [];
    if(cont) cont.textContent = det.length ? `${det.length}${data.detalle_truncado?'+ (primeros 300)':''} registros` : '';
    const labelTipo = {dañado_recibido:'⚠️ Llegó dañado', recogido_reutilizable:'♻️ Recogido — reutilizable', recogido_dañado:'🛠 Recogido — dañado'};
    const colorTipo = {dañado_recibido:'#B91C1C', recogido_reutilizable:'#166534', recogido_dañado:'#B91C1C'};
    td.innerHTML = det.length ? det.map(d=>`
      <tr>
        <td class="!text-[11px] !text-[#64748B] !whitespace-nowrap">${fmtDate(d.fecha)}</td>
        <td><span style="font-size:11px;font-weight:600;color:${colorTipo[d.origen]||'#334155'};">${labelTipo[d.origen]||d.origen}</span></td>
        <td class="!font-semibold">${esc(d.nombre)}</td>
        <td style="font-weight:700;">${d.cantidad}</td>
        <td>${esc(d.destino||d.enviado_por||'—')}</td>
        <td class="!text-[11px] !text-[#64748B]">${esc(d.descripcion||'')}</td>
      </tr>
    `).join('') : '<tr><td class="!text-center !text-[#94A3B8] !p-[24px]" colspan="6">Sin movimientos en este rango.</td></tr>';
  }
}

async function cargarInformes(){
  const dEl = document.getElementById('infDesde'), hEl = document.getElementById('infHasta');
  const desde = dEl?.value || '';
  const hasta = hEl?.value || '';
  const filtroProd = document.getElementById('infProductoRef')?.value || '';
  const filtroUsr  = document.getElementById('infUsuarioVal')?.value || '';

  const tarjetas = document.getElementById('infResumenTarjetas');
  if(tarjetas) tarjetas.innerHTML = '<div class="!text-[#94A3B8] !text-[13px] !p-[12px]">Generando informe…</div>';

  try{
    const params = new URLSearchParams({desde, hasta, limite: 15});
    if(filtroProd) params.append('producto', filtroProd);
    if(filtroUsr)  params.append('usuario', filtroUsr);
    if(document.getElementById('infIncluirPendientes')?.checked) params.append('incluir_pendientes', '1');
    const res = await fetch('api/informes.php?action=resumen&'+params, {credentials:'same-origin'});
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    _infDatosActuales = data;
    _renderInfFiltrosActivos(data);
    _renderInfTarjetas(data);
    _renderInfGraficas(data);
    _renderInfTablas(data);
  }catch(e){
    if(tarjetas) tarjetas.innerHTML = `<div class="!text-[#E24B4A] !text-[13px] !p-[12px]">Error: ${e.message}</div>`;
  }
}

function _renderInfFiltrosActivos(data){
  const el = document.getElementById('infFiltrosActivos');
  if(!el) return;
  const partes = [];
  if(data.filtro_producto) partes.push(`producto <b>"${esc(document.getElementById('infProductoBuscar')?.value||data.filtro_producto)}"</b>`);
  if(data.filtro_usuario)  partes.push(`usuario <b>"${esc(document.getElementById('infUsuarioBuscar')?.value||data.filtro_usuario)}"</b>`);
  if(!partes.length){ el.style.display='none'; return; }
  el.style.display='block';
  el.innerHTML = `🔎 Mostrando solo: ${partes.join(' + ')}`;
}

function _renderInfTarjetas(data){
  const el = document.getElementById('infResumenTarjetas');
  if(!el) return;
  const prodTop = data.top_productos?.[0];
  const usrTop  = data.top_usuarios?.[0];
  const etiquetaModo = data.incluir_pendientes ? '(incluye pendientes)' : '(solo aprobado/entregado)';
  const tarjetas = [
    {label:`Total de pedidos ${etiquetaModo}`, valor: data.totales?.total_pedidos||0, color:'#0C6EDE', bg:'#E6F1FB'},
    {label:`Unidades ${etiquetaModo}`, valor: _infNum(data.totales?.total_unidades||0), color:'#7C3AED', bg:'#EDE9FE'},
    {label:'Producto más pedido', valor: prodTop ? `${prodTop.nombre} (${_infCantProd(prodTop).txt})` : '—', color:'#16A850', bg:'#EAF3DE'},
    {label:'Quién más solicitó', valor: usrTop ? `${usrTop.nombre_completo} (${_infNum(usrTop.total_unidades)})` : '—', color:'#BA7517', bg:'#FAEEDA'},
  ];
  if(!data.incluir_pendientes && data.pendientes && parseInt(data.pendientes.total)>0){
    tarjetas.push({label:'⏳ Aparte, quedan pendientes sin aprobar', valor:`${data.pendientes.total} pedidos (${data.pendientes.unidades} uds.)`, color:'#94A3B8', bg:'#F1F5F9'});
  }
  el.innerHTML = tarjetas.map(t=>`
    <div style="background:${t.bg};border-radius:12px;padding:12px 18px;flex:1;min-width:200px;">
      <div class="!text-[11px] !text-[#64748B] !mb-[3px]">${t.label}</div>
      <div style="font-weight:700;color:${t.color};font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(String(t.valor))}</div>
    </div>`).join('');
}

function _renderInfGraficas(data){
  const C = {azul:'#0C6EDE',morado:'#7C3AED',verde:'#16A850',naranja:'#BA7517',rojo:'#B91C1C',borde:'#E2E8F0'};
  const paleta = ['#0C6EDE','#7C3AED','#16A850','#BA7517','#DB2777','#0891B2','#65A30D','#C2410C','#4F46E5','#059669'];

  Object.values(_infCh).forEach(c=>{ if(c) c.destroy(); });
  _infCh = {};

  const prods = data.top_productos || [];
  const cvsP = document.getElementById('infChartProductos');
  if(cvsP && prods.length){
    const altoP = Math.max(280, prods.length * 26);
    cvsP.parentElement.style.height = altoP + 'px';
    cvsP.parentElement.style.overflowY = prods.length > 12 ? 'auto' : 'visible';
    _infCh.prod = new Chart(cvsP, {type:'bar', data:{
      labels: prods.map(p=>p.nombre.length>18?p.nombre.slice(0,18)+'…':p.nombre),
      datasets:[{label:'Cantidad pedida', data: prods.map(p=>_infCantProd(p).n), backgroundColor: paleta, borderRadius:5}]
    }, options:{indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}, tooltip:{callbacks:{label:(ctx)=>' '+_infCantProd(prods[ctx.dataIndex]).txt}}},
      scales:{x:{ticks:{font:{size:10}},grid:{color:C.borde}}, y:{ticks:{font:{size:10}},grid:{display:false}}}
    }});
  } else if(cvsP){ cvsP.parentElement.innerHTML = '<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[40px]">Sin datos en este rango.</div>'; }

  const usrs = data.top_usuarios || [];
  const cvsU = document.getElementById('infChartUsuarios');
  if(cvsU && usrs.length){
    _infCh.usr = new Chart(cvsU, {type:'bar', data:{
      labels: usrs.map(u=>u.nombre_completo.length>18?u.nombre_completo.slice(0,18)+'…':u.nombre_completo),
      datasets:[{label:'Unidades solicitadas', data: usrs.map(u=>parseFloat(u.total_unidades)), backgroundColor: paleta, borderRadius:5}]
    }, options:{indexAxis:'y', responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{x:{ticks:{font:{size:10}},grid:{color:C.borde}}, y:{ticks:{font:{size:10}},grid:{display:false}}}
    }});
  } else if(cvsU){ cvsU.parentElement.innerHTML = '<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[40px]">Sin datos en este rango.</div>'; }

  const sedes = data.top_sedes || [];
  const cvsS = document.getElementById('infChartSedes');
  if(cvsS && sedes.length){
    _infCh.sedes = new Chart(cvsS, {type:'bar', data:{
      labels: sedes.map(s=>s.destino),
      datasets:[{label:'Unidades pedidas', data: sedes.map(s=>parseFloat(s.total_cantidad)), backgroundColor:C.azul, borderRadius:5}]
    }, options:{responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{x:{ticks:{font:{size:10}},grid:{display:false}}, y:{ticks:{font:{size:10}},grid:{color:C.borde}}}
    }});
  } else if(cvsS){ cvsS.parentElement.innerHTML = '<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[40px]">Sin datos en este rango.</div>'; }

  const tend = data.tendencia || [];
  const cvsT = document.getElementById('infChartTendencia');
  if(cvsT && tend.length){
    _infCh.tend = new Chart(cvsT, {type:'line', data:{
      labels: tend.map(t=>{ const d=new Date(t.dia+'T00:00:00'); return d.toLocaleDateString('es-CO',{day:'2-digit',month:'short'}); }),
      datasets:[{label:'Unidades', data: tend.map(t=>parseFloat(t.total_cantidad)), borderColor:C.morado, backgroundColor:'rgba(124,58,237,.12)', fill:true, tension:.3, pointRadius:3}]
    }, options:{responsive:true, maintainAspectRatio:false,
      plugins:{legend:{display:false}},
      scales:{x:{ticks:{font:{size:10}},grid:{display:false}}, y:{ticks:{font:{size:10}},grid:{color:C.borde},beginAtZero:true}}
    }});
  } else if(cvsT){ cvsT.parentElement.innerHTML = '<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[40px]">Sin datos en este rango.</div>'; }
}

function _renderInfTablas(data){
  const fmtCOP = (n) => (parseFloat(n)||0).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
  const pcardEst = document.getElementById('pcardStockEstancado');
  const teEstancado = document.getElementById('infTablaEstancado');
  const estancados = data.stock_sin_movimiento || [];
  if(pcardEst && teEstancado){
    if(estancados.length){
      pcardEst.style.display = 'block';
      document.getElementById('stockEstancadoValor').textContent =
        data.valor_total_estancado > 0 ? `${fmtCOP(data.valor_total_estancado)} guardados` : '';
      teEstancado.innerHTML = estancados.map(p=>{
        const valor = (parseFloat(p.stock_actual)||0) * (parseFloat(p.costo_unitario)||0);
        return `<tr>
          <td><span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_6px] !rounded-[5px]">${esc(p.ref)}</span></td>
          <td class="!font-semibold">${esc(p.nombre)}</td>
          <td class="!text-center !font-bold !text-[#B45309]">${fmtNum(p.stock_actual)}</td>
          <td style="text-align:right;color:${valor>0?'#B91C1C':'#94A3B8'};font-weight:${valor>0?'600':'400'};">${valor>0?fmtCOP(valor):'— (sin costo registrado)'}</td>
        </tr>`;
      }).join('');
    } else {
      pcardEst.style.display = 'none';
    }
  }
  const tp = document.getElementById('infTablaProductos');
  if(tp){
    const prods = data.top_productos || [];
    tp.innerHTML = prods.length ? prods.map(p=>{
      const sinActividad = parseFloat(p.total_cantidad) === 0;
      return `<tr style="${sinActividad?'opacity:.55;':''}">
      <td><span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_6px] !rounded-[5px]">${esc(p.ref)}</span></td>
      <td style="font-weight:${sinActividad?'400':'600'};">${esc(p.nombre)}</td>
      <td style="font-weight:700;color:${sinActividad?'#94A3B8':'#0C6EDE'};">${_infCantProd(p).txt}${sinActividad?' <span class="!font-normal !text-[11px]">— sin pedidos</span>':''}</td>
      <td class="!text-[#64748B]">${p.veces}</td></tr>`;
    }).join('') : '<tr><td class="!text-center !text-[#94A3B8] !p-[20px]" colspan="4">Sin productos en el catálogo.</td></tr>';
  }
  const tu = document.getElementById('infTablaUsuarios');
  if(tu){
    const usrs = data.top_usuarios || [];
    tu.innerHTML = usrs.length ? usrs.map(u=>`
      <tr><td class="!font-semibold">${esc(u.nombre_completo)}</td>
      <td class="!text-[11px] !text-[#64748B]">${esc(u.rol||'—')} · ${esc(u.sede||'—')}</td>
      <td class="!font-bold !text-[#7C3AED]">${_infNum(u.total_unidades)}</td>
      <td class="!text-[#64748B]">${u.num_items}</td></tr>
    `).join('') : '<tr><td class="!text-center !text-[#94A3B8] !p-[20px]" colspan="4">Sin datos en este rango.</td></tr>';
  }

  // ── Movimientos detallados ──
  const tm = document.getElementById('infTablaMovimientos');
  const movCont = document.getElementById('infMovContador');
  if(tm){
    const movs = data.movimientos || [];
    if(movCont) movCont.textContent = movs.length ? `${movs.length}${data.movimientos_truncado?'+ (mostrando los primeros 500)':''} movimientos` : '';
    const lblEstado = {aprobado:'✅ Aprobado',en_camino:'🚚 En camino',entregado:'📦 Entregado',recibido:'✅ Recibido',cancelado:'❌ Cancelado'};
    tm.innerHTML = movs.length ? movs.map(m=>{
      const fecha = m.fecha_recibido || m.fecha_entrega || m.fecha_envio || m.fecha_aprobado;
      return `<tr>
        <td class="!text-[11px] !text-[#64748B] !whitespace-nowrap">${fecha?fmtDate(fecha):'—'}</td>
        <td class="!font-semibold">${esc(m.nombre||'—')} <span class="!text-[10px] !text-[#94A3B8]">(${esc(m.ref||'—')})</span></td>
        <td class="!font-bold !text-[#0C6EDE]">${m.cantidad}</td>
        <td>${esc(m.solicitado_por_nombre||m.solicitado_por||'—')}</td>
        <td><span class="badge badge-brand !text-[10px]">${esc(m.destino||'—')}</span></td>
        <td><span class="badge ${m.estado==='recibido'?'badge-ok':m.estado==='cancelado'?'badge-danger':'badge-warn'}" style="font-size:10px;">${lblEstado[m.estado]||esc(m.estado||'—')}</span></td>
        <td class="!text-[11px] !text-[#64748B]">${esc(m.enviado_por||'—')}</td>
        <td class="!text-[11px] !text-[#64748B]">${esc(m.transportador||'—')}</td>
        <td class="!text-[11px] !text-[#64748B]">${esc(m.entregado_a||'—')}</td>
        <td class="!text-[11px] !text-[#64748B]">${esc(m.recibido_por||'—')}</td>
      </tr>`;
    }).join('') : '<tr><td class="!text-center !text-[#94A3B8] !p-[24px]" colspan="10">Sin movimientos en este rango.</td></tr>';
  }
}

function exportarInformeExcel(){
  if(!_infDatosActuales){ toast('Primero genera el informe','error'); return; }
  const d = _infDatosActuales;
  const wb = XLSX.utils.book_new();

  const filasProd = [['Ref','Producto','Cantidad total','Unidad','Nº de pedidos']];
  (d.top_productos||[]).forEach(p=>{ const c=_infCantProd(p); filasProd.push([p.ref, p.nombre, c.n, (parseFloat(p.metros_por_unidad)||0)>0?'rollos':'unidades', p.veces]); });
  const wsProd = XLSX.utils.aoa_to_sheet(filasProd);
  wsProd['!cols']=[{wch:12},{wch:30},{wch:16},{wch:14}];
  XLSX.utils.book_append_sheet(wb, wsProd, 'Productos');

  const filasUsr = [['Usuario','Nombre','Rol','Sede','Cantidad total','Nº de pedidos']];
  (d.top_usuarios||[]).forEach(u=>filasUsr.push([u.solicitado_por, u.nombre_completo, u.rol, u.sede, parseFloat(u.total_unidades), u.num_items]));
  const wsUsr = XLSX.utils.aoa_to_sheet(filasUsr);
  wsUsr['!cols']=[{wch:14},{wch:24},{wch:12},{wch:16},{wch:16},{wch:14}];
  XLSX.utils.book_append_sheet(wb, wsUsr, 'Solicitantes');

  const filasSede = [['Sede/Destino','Cantidad total']];
  (d.top_sedes||[]).forEach(s=>filasSede.push([s.destino, parseFloat(s.total_cantidad)]));
  const wsSede = XLSX.utils.aoa_to_sheet(filasSede);
  wsSede['!cols']=[{wch:24},{wch:16}];
  XLSX.utils.book_append_sheet(wb, wsSede, 'Sedes');

  const filasMov = [['Fecha','Ref','Producto','Cantidad','Solicitó','Destino','Estado','Enviado por','Transportador','Entregado a','Recibido por']];
  (d.movimientos||[]).forEach(m=>{
    const fecha = m.fecha_recibido || m.fecha_entrega || m.fecha_envio || m.fecha_aprobado || '';
    filasMov.push([fecha, m.ref, m.nombre, m.cantidad, m.solicitado_por_nombre||m.solicitado_por, m.destino, m.estado, m.enviado_por||'', m.transportador||'', m.entregado_a||'', m.recibido_por||'']);
  });
  const wsMov = XLSX.utils.aoa_to_sheet(filasMov);
  wsMov['!cols']=[{wch:18},{wch:8},{wch:28},{wch:10},{wch:18},{wch:14},{wch:12},{wch:14},{wch:14},{wch:14},{wch:14}];
  XLSX.utils.book_append_sheet(wb, wsMov, 'Movimientos');

  const sufijoFiltro = (d.filtro_producto?'_prod':'') + (d.filtro_usuario?'_usr':'');
  const limpiarNombre = s => String(s).replace(/[^a-zA-Z0-9-]/g, '_');
  XLSX.writeFile(wb, `informe_${limpiarNombre(d.desde)}_a_${limpiarNombre(d.hasta)}${sufijoFiltro}.xlsx`);
}