/* ══════════════════════════════════════
   CAMBIAR CONTRASEÑA
══════════════════════════════════════ */
const _rolEmoji = {
  superadmin:   '👑',
  distribuidor: '🏢',
  municipio:    '🏛️',
  tecnico:      '🔧',
  persona:      '👤',
};
const _rolColor = {
  superadmin:   'linear-gradient(135deg,#7C3AED,#5B21B6)',
  distribuidor: 'linear-gradient(135deg,#0A4EAE,#0C6EDE)',
  municipio:    'linear-gradient(135deg,#065F46,#059669)',
  tecnico:      'linear-gradient(135deg,#92400E,#D97706)',
  persona:      'linear-gradient(135deg,#1E40AF,#3B82F6)',
};

function actualizarHeaderPerfil(){
  const nombre   = document.getElementById('perfilNombre')?.value.trim() || '';
  const apellido = document.getElementById('perfilApellido')?.value.trim() || '';
  const nm = document.getElementById('perfilNombreHeader');
  if(nm) nm.textContent = (nombre + (apellido?' '+apellido:'')).trim() || sesion.usuario;
}

function perfilModoVista(){
  document.getElementById('perfilVista').style.display='';
  document.getElementById('perfilEdicion').style.display='none';
}
function perfilModoEditar(){
  document.getElementById('perfilVista').style.display='none';
  document.getElementById('perfilEdicion').style.display='';
  setTimeout(()=>document.getElementById('perfilNombre')?.focus(),100);
}

function _perfilActualizarVista(s){
  const nombre = (s.nombre||'') + (s.apellido?' '+s.apellido:'');
  document.getElementById('viNombre').textContent    = nombre    || '—';
  document.getElementById('viCargo').textContent     = s.cargo   || '—';
  document.getElementById('viCorreo').textContent    = s.correo  || '—';
  document.getElementById('viTelefono').textContent  = s.telefono|| '—';
  document.getElementById('perfilUsuario').textContent = s.usuario|| '';
  document.getElementById('perfilRol').textContent     = s.rol    || '';
  document.getElementById('perfilSede').textContent    = s.sede   || '';
  document.getElementById('perfilNombreHeader').textContent = nombre || s.usuario;
  document.getElementById('perfilRolSede').textContent = `${s.rol} · ${s.sede}`;
  const av = document.getElementById('perfilAvatar');
  const hd = document.getElementById('perfilHeader');
  if(av) av.textContent = _rolEmoji[s.rol] || '👤';
  if(hd) hd.style.background = _rolColor[s.rol] || 'linear-gradient(135deg,#0A4EAE,#0C6EDE)';
}

function abrirPerfil(){
  const s = sesion;
  _perfilActualizarVista(s);
  document.getElementById('perfilNombre').value      = s.nombre   || '';
  document.getElementById('perfilApellido').value    = s.apellido || '';
  document.getElementById('perfilCargo').value       = s.cargo    || '';
  document.getElementById('perfilCorreo').value      = s.correo   || '';
  document.getElementById('perfilTelefono').value    = s.telefono || '';
  document.getElementById('perfilUsuarioEdit').value = s.usuario  || '';
  // Limpiar contraseña cada vez que se abre
  document.getElementById('perfilAlerta').className = 'alerta';
  perfilModoVista();
  document.getElementById('modalPerfil').classList.add('open');
}

async function guardarPerfil(){
  const nombre      = document.getElementById('perfilNombre').value.trim();
  const apellido    = document.getElementById('perfilApellido').value.trim();
  const cargo       = document.getElementById('perfilCargo').value.trim();
  const correo      = document.getElementById('perfilCorreo').value.trim();
  const telefono    = document.getElementById('perfilTelefono').value.trim();
  const usuarioNuevo= document.getElementById('perfilUsuarioEdit').value.trim();
  const alerta      = document.getElementById('perfilAlerta');
  alerta.className  = 'alerta'; alerta.textContent = '';

  if(!nombre){ alerta.textContent='El nombre es obligatorio.'; alerta.className='alerta error'; return; }
  if(!usuarioNuevo){ alerta.textContent='El usuario no puede quedar vacío.'; alerta.className='alerta error'; return; }

  try{
    const res = await _api('usuarios','actualizar_perfil', {nombre, apellido, cargo, correo, telefono, usuario_nuevo: usuarioNuevo});
    if(res.error){ alerta.textContent=res.error; alerta.className='alerta error'; return; }

    const cambioUsuario = usuarioNuevo !== sesion.usuario;
    sesion.nombre   = nombre;
    sesion.apellido = apellido;
    sesion.cargo    = cargo;
    sesion.correo   = correo;
    sesion.telefono = telefono;
    sesion.usuario  = usuarioNuevo;
    _perfilActualizarVista(sesion);
    const nm = document.getElementById('sidebarNombre');
    if(nm) nm.textContent = nombre + (apellido?' '+apellido:'');

    if(cambioUsuario){
      cerrarModal('modalPerfil');
      toast('Usuario cambiado. Inicia sesión nuevamente.','success');
      setTimeout(()=>logout(), 2000);
    } else {
      perfilModoVista();
      toast('Perfil actualizado ✓','success');
    }
  }catch(e){ alerta.textContent='Error al guardar.'; alerta.className='alerta error'; }
}

function abrirInstalacionOnt(ontId){
  document.getElementById('instOntId').value = ontId;
  document.getElementById('instOntCliente').value = '';
  document.getElementById('instOntDireccion').value = '';
  document.getElementById('instOntFecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('instOntAlerta').className = 'alerta';
  ['instOntMunicipio','instOntNodo','instOntRack'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  const sel = document.getElementById('instOntTecnicoSel');
  if(sel){
    sel.innerHTML = '<option value="">Cargando...</option>';
    fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'})
      .then(r=>r.json())
      .then(usuarios=>{
        const tec = Array.isArray(usuarios) ? usuarios : []; // el servidor ya trae solo los activos
        sel.innerHTML = '<option value="">Seleccionar técnico...</option>' +
          tec.map(u=>`<option value="${esc(u.usuario)}">${esc(u.nombre||u.usuario)} ${esc(u.apellido||'')} (@${esc(u.usuario)})</option>`).join('');
      });
  }
  document.getElementById('modalInstalacionOnt').classList.add('open');
  setTimeout(()=>document.getElementById('instOntCliente')?.focus(), 200);
}

async function confirmarInstalacionOnt(){
  const ontId    = document.getElementById('instOntId').value;
  const cliente  = document.getElementById('instOntCliente').value.trim();
  const municipio= document.getElementById('instOntMunicipio')?.value.trim()||'';
  const nodo     = document.getElementById('instOntNodo')?.value.trim()||'';
  const rack     = document.getElementById('instOntRack')?.value.trim()||'';
  const direccion= document.getElementById('instOntDireccion').value.trim();
  const tecnico  = document.getElementById('instOntTecnicoSel').value;
  const fecha    = document.getElementById('instOntFecha').value;
  const alerta   = document.getElementById('instOntAlerta');
  alerta.className = 'alerta';
  if(!cliente){ alerta.textContent='El nombre del cliente es obligatorio.'; alerta.className='alerta error'; return; }
  if(!tecnico){ alerta.textContent='Selecciona el técnico que realizó la instalación.'; alerta.className='alerta error'; return; }
  if(!fecha)  { alerta.textContent='La fecha de instalación es obligatoria.'; alerta.className='alerta error'; return; }
  try{
    const res = await fetch('api/cajas.php?action=instalar_ont', {
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ont_id: parseInt(ontId), cliente_nombre: cliente, cliente_direccion: direccion,
        municipio_instalacion: municipio, nodo_zona: nodo, rack_instalacion: rack,
        tecnico_instalacion: tecnico, fecha_instalacion: fecha})
    });
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    cerrarModal('modalInstalacionOnt');
    toast('ONT instalada en comodato ✓','success');
    cargarInventarioOnt();
  }catch(e){ alerta.textContent = e.message||'Error al registrar instalación.'; alerta.className='alerta error'; }
}


/* ════════════════════════════════════════════════
   MANUAL DE USUARIO
════════════════════════════════════════════════ */
/* ── Manual de usuario dentro del sistema ──
   El botón «Manual» abre directamente el manual (PDF con imágenes) que corresponde al rol de
   quien entró. El superadmin puede elegir cualquiera de los manuales con el selector. */
let _manualPdfUrl = null;
let _manualPdfLista = null;
let _manualPdfId = null;

function abrirManualAyuda(){
  document.getElementById('modalManual')?.classList.add('open');
  _manualMostrarPdf();
}
async function _manualMostrarPdf(id){
  const cont = document.getElementById('manualContenido'); if(!cont) return;
  cont.innerHTML = '<div style="padding:40px;text-align:center;color:#94A3B8;">Cargando el manual…</div>';
  try{
    if(!_manualPdfLista){
      const r = await fetch('api/manual.php?action=lista', {credentials:'same-origin'});
      _manualPdfLista = await r.json();
      if(_manualPdfLista.error) throw new Error(_manualPdfLista.error);
    }
    _manualPdfId = id || _manualPdfId || _manualPdfLista.propio;
    const r = await fetch('api/manual.php?action=ver&id='+encodeURIComponent(_manualPdfId), {credentials:'same-origin'});
    if(!r.ok){ let m='No se pudo abrir el manual'; try{ m=(await r.json()).error||m; }catch(e){} throw new Error(m); }
    const blob = await r.blob();
    if(_manualPdfUrl) URL.revokeObjectURL(_manualPdfUrl);
    _manualPdfUrl = URL.createObjectURL(new Blob([blob], {type:'application/pdf'}));
    const lista = _manualPdfLista.manuales || [];
    const titulo = (lista.find(m=>m.id===_manualPdfId)||{}).titulo || 'Manual de usuario';
    const selector = lista.length>1
      ? `<select onchange="_manualMostrarPdf(this.value)" class="inp" style="width:auto;max-width:280px;font-size:12px;padding:6px 10px;">${lista.map(m=>`<option value="${m.id}" ${m.id===_manualPdfId?'selected':''}>${esc(m.titulo)}</option>`).join('')}</select>`
      : `<strong style="font-size:13px;color:#0F172A;">${esc(titulo)}</strong>`;
    const btn = 'font-size:12px;padding:6px 12px;';
    const visor = (navigator.pdfViewerEnabled === false)
      ? `<div style="padding:40px 24px;text-align:center;color:#475569;font-size:14px;">Tu navegador no muestra PDF aquí dentro.<br>Usa «Abrir en otra pestaña» o «Descargar PDF» para leer el manual.</div>`
      : `<iframe src="${_manualPdfUrl}#navpanes=0" title="${esc(titulo)}" style="flex:1;width:100%;border:0;min-height:0;"></iframe>`;
    cont.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 16px;border-bottom:1px solid #F1F5F9;background:#F8FAFC;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:8px;">📘 ${selector}</div>
        <div style="display:flex;gap:8px;">
          <button class="btn btn-ghost" style="${btn}" onclick="window.open(_manualPdfUrl,'_blank')">↗ Abrir en otra pestaña</button>
          <button class="btn btn-primary" style="${btn}" onclick="_manualDescargar()">⬇ Descargar PDF</button>
        </div>
      </div>${visor}`;
  }catch(e){
    cont.innerHTML = `<div style="padding:40px;text-align:center;color:#B91C1C;font-size:13px;">${esc(e.message)}</div>`;
  }
}
function _manualDescargar(){
  if(!_manualPdfUrl) return;
  const a = document.createElement('a'); a.href = _manualPdfUrl;
  a.download = 'Manual_' + (_manualPdfId||'usuario') + '_Integrados_SS.pdf';
  document.body.appendChild(a); a.click(); a.remove();
}

function abrirCambiarPassword() {
// perfil inserted above
  // Limpiar campos
  ['cpActual','cpNueva','cpConfirm'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.type = 'password'; }
  });
  const barra = document.getElementById('cpBarra');
  const txt   = document.getElementById('cpFortalezaTxt');
  const alerta= document.getElementById('cpAlerta');
  if (barra)  { barra.style.width = '0%'; barra.style.background = '#E2E8F0'; }
  if (txt)    txt.textContent = '';
  if (alerta) { alerta.style.display = 'none'; alerta.textContent = ''; }
  document.getElementById('modalCambiarPassword').classList.add('open');
  setTimeout(() => { const el = document.getElementById('cpActual'); if (el) el.focus(); }, 150);
}

function toggleVerCp(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  const mostrar = inp.type === 'password';
  inp.type = mostrar ? 'text' : 'password';
  btn.style.color = mostrar ? '#0C6EDE' : '#94A3B8';
}

function cpEvaluarFortaleza() {
  const val   = document.getElementById('cpNueva').value;
  const barra = document.getElementById('cpBarra');
  const txt   = document.getElementById('cpFortalezaTxt');
  if (!val) { barra.style.width = '0%'; txt.textContent = ''; return; }
  let puntos = 0;
  if (val.length >= 6)  puntos++;
  if (val.length >= 10) puntos++;
  if (/[A-Z]/.test(val) && /[a-z]/.test(val)) puntos++;
  if (/[0-9]/.test(val)) puntos++;
  if (/[^A-Za-z0-9]/.test(val)) puntos++;
  const niveles = [
    { min: 0, label: '',         color: '#E2E8F0', w: '0%'   },
    { min: 1, label: 'Débil',    color: '#E24B4A', w: '25%'  },
    { min: 2, label: 'Regular',  color: '#BA7517', w: '50%'  },
    { min: 3, label: 'Buena',    color: '#0C6EDE', w: '75%'  },
    { min: 5, label: 'Fuerte',   color: '#16A34A', w: '100%' },
  ];
  const n = [...niveles].reverse().find(n => puntos >= n.min) || niveles[0];
  barra.style.width     = n.w;
  barra.style.background= n.color;
  txt.textContent       = n.label;
  txt.style.color       = n.color;
}

function _cpMostrarAlerta(msg, tipo) {
  const el = document.getElementById('cpAlerta');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  if (tipo === 'error') {
    el.style.background   = '#FCEBEB';
    el.style.color        = '#B91C1C';
    el.style.borderColor  = '#FECACA';
  } else {
    el.style.background   = '#EAF3DE';
    el.style.color        = '#166534';
    el.style.borderColor  = '#BBF7D0';
  }
}

async function confirmarCambiarPassword() {
  const actual  = document.getElementById('cpActual').value.trim();
  const nueva   = document.getElementById('cpNueva').value;
  const confirm = document.getElementById('cpConfirm').value;
  const btn     = document.getElementById('cpBtnGuardar');

  const alerta = document.getElementById('cpAlerta');
  if (alerta) alerta.style.display = 'none';

  if (!actual || !nueva || !confirm) {
    _cpMostrarAlerta('Completa todos los campos.', 'error'); return;
  }
  if (nueva.length < 6) {
    _cpMostrarAlerta('La nueva contraseña debe tener al menos 6 caracteres.', 'error'); return;
  }
  if (nueva !== confirm) {
    _cpMostrarAlerta('Las contraseñas nuevas no coinciden.', 'error'); return;
  }

  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    const res = await fetch('api/cambiar_password.php?action=cambiar', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actual, nueva, confirmacion: confirm })
    });
    const data = await res.json();
    if (data.ok) {
      _cpMostrarAlerta('✅ Contraseña actualizada correctamente.', 'ok');
      ['cpActual','cpNueva','cpConfirm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      setTimeout(() => {
        cerrarModal('modalCambiarPassword');
        toast('🔒 Contraseña actualizada correctamente', 'success');
      }, 800);
    } else {
      _cpMostrarAlerta(data.error || 'Error al actualizar.', 'error');
    }
  } catch(e) {
    _cpMostrarAlerta('Error de conexión. Intenta de nuevo.', 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Actualizar';
}
}


/* ══════════════════════════════════════
   VENTAS CON APROBACIÓN
   Todos venden de su stock; superadmin directo, el resto queda
   pendiente hasta que lo apruebe el superadmin o quien tenga el
   permiso "aprobar_ventas".
══════════════════════════════════════ */
let _ventasPendDatos = [];
let _ventasPuedeAprobar = false;
let _ventasClienteDatos = [];
let _ventaRechazarId = null;

const _fmtCOPv = n => Number(n||0).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
const _fechaV = f => f ? new Date(String(f).replace(' ','T')).toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const _rollTxt = v => Number(v.es_rollo) ? (Number(v.cantidad)===1?' rollo':' rollos') : '';
const _cantCliente = v => {
  try{
    const p = (typeof getProductos==='function' ? getProductos() : []).find(x=>x.ref===v.ref);
    if(p && p.metrosPorUnidad){ const q = cantRolloPartes(p, v.cantidad); return `${q.n} ${q.suf}`; }
  }catch(e){}
  return v.cantidad;
};
const _hlV = (txt,q) => {
  txt = String(txt==null?'':txt);
  if(!q || !txt) return esc(txt);
  const i = txt.toLowerCase().indexOf(q.toLowerCase());
  if(i<0) return esc(txt);
  return esc(txt.slice(0,i)) + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(i,i+q.length))}</mark>` + esc(txt.slice(i+q.length));
};
const _thV = t => `<th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">${t}</th>`;

async function _actualizarBadgeVentas(){
  try{
    const r = await _api('pedidos','ventas_pendientes');
    window._ventasPorAprobarN = r.puede_aprobar ? (r.ventas||[]).filter(v=>v.estado==='pendiente').length : 0;
    if(typeof updateNotifBadges==='function') updateNotifBadges();
  }catch(e){}
}

async function cargarVentasPend(){
  try{
    const [r, c] = await Promise.all([_api('pedidos','ventas_pendientes'), _api('pedidos','ventas_por_cliente')]);
    _ventasPendDatos = r.ventas || [];
    _ventasPuedeAprobar = !!r.puede_aprobar;
    _ventasClienteDatos = c.ventas || [];
  }catch(e){
    const l = document.getElementById('ventasPendLista');
    if(l) l.innerHTML = '<div class="!text-center !p-[24px] !text-[#B91C1C] !text-[13px]">No se pudo cargar. Intenta de nuevo.</div>';
    return;
  }
  window._ventasPorAprobarN = _ventasPuedeAprobar ? _ventasPendDatos.filter(v=>v.estado==='pendiente').length : 0;
  if(typeof updateNotifBadges==='function') updateNotifBadges();
  const lbl = document.getElementById('navVentasLabel'); if(lbl) lbl.textContent = 'Ventas';
  const tit = document.getElementById('ventasPendTitulo');
  const sub = document.getElementById('ventasPendSubtitulo');
  if(tit) tit.textContent = _ventasPuedeAprobar ? 'Solicitudes de venta' : 'Mis solicitudes de venta';
  if(sub) sub.textContent = _ventasPuedeAprobar ? 'Ventas que piden los usuarios — filtra por estado' : 'Estado de las ventas que has pedido';
  _renderVentasPend();
  _renderVentasCliente();
}

let _ventasFiltro = null; // 'todos' | 'pendiente' | 'aprobada' | 'rechazada'
let _ventasPag = 1; const _VENTAS_POR_PAG = 5;
function _ventasSetFiltro(f){ _ventasFiltro = f; _ventasPag = 1; _renderVentasPend(); }
function _ventasBuscarCambio(){ _ventasPag = 1; _renderVentasPend(); }
function _ventasIrPag(n){ _ventasPag = n; _renderVentasPend(); }
function _renderVentasPend(){
  const yo = (typeof sesion!=='undefined' && sesion) ? sesion.usuario : '';
  const esSA = (typeof sesion!=='undefined' && sesion) ? sesion.rol==='superadmin' : false;
  const datos = _ventasPendDatos;
  const cnt = {todos:datos.length, pendiente:0, aprobada:0, rechazada:0};
  datos.forEach(v=>{ if(cnt[v.estado]!==undefined) cnt[v.estado]++; });
  if(!_ventasFiltro) _ventasFiltro = cnt.pendiente ? 'pendiente' : 'todos';
  const chips = [['todos','Todos'],['pendiente','⏳ Pendientes'],['aprobada','✅ Aprobadas'],['rechazada','❌ Rechazadas']].map(([k,l])=>{
    const on = _ventasFiltro===k;
    return `<button onclick="_ventasSetFiltro('${k}')" style="border:1.5px solid ${on?'#2DB82D':'#E2E8F0'};background:${on?'#2DB82D':'white'};color:${on?'#fff':'#475569'};border-radius:20px;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;">${l} <span class="!opacity-[.8]">${cnt[k]}</span></button>`;
  }).join('');
  const ch = document.getElementById('ventasFiltroChips'); if(ch) ch.innerHTML = chips;
  const qRaw = (document.getElementById('ventasPendBuscar')?.value||'').trim();
  const q = qRaw.toLowerCase();
  const nomEstado = {pendiente:'pendiente',aprobada:'aprobada',rechazada:'rechazada',cancelada:'cancelada'};
  let lista = _ventasFiltro==='todos' ? datos : datos.filter(v=>v.estado===_ventasFiltro);
  if(q) lista = lista.filter(v=>[v.solicitado_por,v.sede,v.ref,v.nombre,v.cliente,v.forma_pago,nomEstado[v.estado],v.resuelto_por,v.motivo_rechazo,v.observacion].some(x=>String(x||'').toLowerCase().includes(q)));
  const cont = document.getElementById('ventasPendLista');
  if(!cont) return;
  const vacio = {todos:'Todavía no hay solicitudes de venta.', pendiente:'No hay ventas pendientes.', aprobada:'No hay ventas aprobadas (últimos 90 días).', rechazada:'No hay ventas rechazadas (últimos 90 días).'}[_ventasFiltro];
  if(!lista.length){ cont.innerHTML = `<div class="!text-center !p-[26px] !text-[#94A3B8] !text-[13px]">${q?'Nada coincide con la búsqueda.':vacio}</div>`; return; }
  const totalPag = Math.max(1, Math.ceil(lista.length/_VENTAS_POR_PAG));
  if(_ventasPag>totalPag) _ventasPag = totalPag;
  const ini = (_ventasPag-1)*_VENTAS_POR_PAG;
  const pagina = lista.slice(ini, ini+_VENTAS_POR_PAG);
  const hl = t=>_hlV(String(t==null?'':t), qRaw);
  const badge = v=>{
    if(v.estado==='pendiente') return `<span class="badge ![background:#FEF3C7] !text-[#92400E] !text-[10px] !whitespace-nowrap">⏳ Pendiente</span>`;
    if(v.estado==='aprobada') return `<span class="badge ![background:#DCFCE7] !text-[#166534] !text-[10px] !whitespace-nowrap">✅ Aprobada</span><div class="!text-[11px] !text-[#64748B] !mt-[3px]">${escU(v.resuelto_por||'')}${v.observacion?': '+esc(v.observacion):''}</div>`;
    if(v.estado==='rechazada') return `<span class="badge ![background:#FEE2E2] !text-[#B91C1C] !text-[10px] !whitespace-nowrap">❌ Rechazada</span><div class="!text-[11px] !text-[#B91C1C] !mt-[3px]">${escU(v.resuelto_por||'')}: ${esc(v.motivo_rechazo||'—')}</div>`;
    return `<span class="badge ![background:#F1F5F9] !text-[#475569] !text-[10px] !whitespace-nowrap">⛔ Cancelada</span>`;
  };
  cont.innerHTML = `<div class="!overflow-x-auto"><table class="!w-[100%] ![border-collapse:collapse] !text-[13px]">
    <thead><tr style="background:#F8FAFC;text-align:left;">${_thV('Fecha')}${_thV('Vendedor')}${_thV('Producto')}${_thV('Cant.')}${_thV('Cliente')}${_thV('Precio')}${_thV('Estado')}${_thV('Acciones')}</tr></thead><tbody>
    ${pagina.map(v=>{
      let acc = '';
      if(v.estado==='pendiente'){
        if(_ventasPuedeAprobar && (v.solicitado_por!==yo || esSA)) acc += `<button onclick="aprobarVenta(${v.id})" class="btn-sm ![background:#DCFCE7] !text-[#166534]">✅ Aprobar</button> <button onclick="abrirRechazarVenta(${v.id})" class="btn-sm ![background:#FEE2E2] !text-[#B91C1C]">✕ Rechazar</button>`;
        if(v.solicitado_por===yo) acc += ` <button onclick="cancelarVenta(${v.id})" class="btn-sm ![background:#F1F5F9] !text-[#475569]">Cancelar</button>`;
      } else if(v.estado==='aprobada' && v.historial_id){
        acc = `<button onclick="abrirRemision('${v.historial_id}','gasto')" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6] !whitespace-nowrap">📄 PDF</button>`;
      }
      return `<tr style="border-bottom:1px solid #F1F5F9;${v.estado==='pendiente'?'background:#FFFBEB;':''}">
        <td class="!p-[8px_10px] !whitespace-nowrap !text-[#64748B] !text-[12px]">${_fechaV(v.estado==='pendiente'?v.fecha:(v.fecha_resuelto||v.fecha))}</td>
        <td class="!p-[8px_10px]"><strong>${hl(nombreUsr(v.solicitado_por))}</strong><div class="!text-[11px] !text-[#94A3B8]">${esc(v.sede||'')}</div></td>
        <td class="!p-[8px_10px]"><span class="![font-family:monospace] !text-[10px] ![background:#F1F5F9] !p-[1px_6px] !rounded-[4px]">${hl(v.ref)}</span> ${hl(v.nombre)}${_provVenta(v.ref)?`<div class="!text-[10px] !text-[#7C3AED] !mt-[2px]">🏭 ${esc(_provVenta(v.ref))}</div>`:''}</td>
        <td class="!p-[8px_10px] !font-semibold !whitespace-nowrap">${v.cantidad}${_rollTxt(v)}</td>
        <td class="!p-[8px_10px]">${hl(v.cliente)}${v.forma_pago?`<div class="!text-[11px] !text-[#94A3B8]">${esc(v.forma_pago)}</div>`:''}</td>
        <td class="!p-[8px_10px] !whitespace-nowrap !font-semibold">${_fmtCOPv(v.precio_total)}</td>
        <td class="!p-[8px_10px]">${badge(v)}</td>
        <td class="!p-[8px_10px] !whitespace-nowrap">${acc||'<span class="!text-[#CBD5E1]">—</span>'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 18px 14px;font-size:12px;color:#64748B;">
      <span>Mostrando ${ini+1}–${ini+pagina.length} de ${lista.length}</span>
      ${totalPag>1?`<div class="!flex !items-center !gap-[6px]">
        <button onclick="_ventasIrPag(${_ventasPag-1})" ${_ventasPag<=1?'disabled':''} class="btn-sm" style="background:#F1F5F9;color:#475569;${_ventasPag<=1?'opacity:.4;cursor:default;':''}">‹ Anterior</button>
        <span class="!font-semibold !text-[#1E293B]">Página ${_ventasPag} de ${totalPag}</span>
        <button onclick="_ventasIrPag(${_ventasPag+1})" ${_ventasPag>=totalPag?'disabled':''} class="btn-sm" style="background:#F1F5F9;color:#475569;${_ventasPag>=totalPag?'opacity:.4;cursor:default;':''}">Siguiente ›</button>
      </div>`:''}
    </div>`;
}

let _ventasCliPag = 1; const _CLI_POR_PAG = 5;
function _ventasCliIrPag(n){ _ventasCliPag = n; _renderVentasCliente(); }
function _ventasCliBuscarCambio(){ _ventasCliPag = 1; _renderVentasCliente(); }
function _renderVentasCliente(){
  const cont = document.getElementById('ventasClienteLista');
  if(!cont) return;
  const qRaw = (document.getElementById('ventasClienteBuscar')?.value||'').trim();
  const q = qRaw.toLowerCase();
  const filas = _ventasClienteDatos.filter(v=>!q || (v.cliente||'').toLowerCase().includes(q) || (v.nombre||'').toLowerCase().includes(q) || (v.vendedor||'').toLowerCase().includes(q));
  const sub = document.getElementById('ventasClienteSub');
  if(sub) sub.textContent = _ventasPuedeAprobar ? 'A quién se le vendió, qué y quién lo vendió' : 'A quién le has vendido y qué';
  if(!filas.length){
    cont.innerHTML = `<div class="!text-center !p-[26px] !text-[#94A3B8] !text-[13px]">${q?'Nada coincide con la búsqueda.':'Todavía no hay ventas registradas.'}</div>`;
    return;
  }
  const grupos = {};
  filas.forEach(v=>{ const k=(v.cliente||'(sin cliente)').trim(); (grupos[k]=grupos[k]||[]).push(v); });
  const lista = Object.entries(grupos).map(([cli,items])=>({cli,items,total:items.reduce((a,x)=>a+Number(x.precio_total||0),0),ultima:items[0].fecha}))
    .sort((a,b)=>String(b.ultima).localeCompare(String(a.ultima)));
  const totalPagC = Math.max(1, Math.ceil(lista.length/_CLI_POR_PAG));
  if(_ventasCliPag>totalPagC) _ventasCliPag = totalPagC;
  const iniC = (_ventasCliPag-1)*_CLI_POR_PAG;
  const paginaC = lista.slice(iniC, iniC+_CLI_POR_PAG);
  cont.innerHTML = paginaC.map(g=>`
    <details class="![border-bottom:1px_solid_#F1F5F9]"${q?' open':''}>
      <summary style="padding:12px 18px;cursor:pointer;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span class="!font-semibold !text-[14px] ![flex:1] !min-w-[140px]">👤 ${_hlV(g.cli,qRaw)}</span>
        <span class="!text-[12px] !text-[#64748B]">${g.items.length} venta${g.items.length>1?'s':''}</span>
        <span class="!font-bold !text-[13px] !text-[#166534]">${_fmtCOPv(g.total)}</span>
        <span class="!text-[11px] !text-[#94A3B8]">última: ${_fechaV(g.ultima)}</span>
      </summary>
      <div class="!overflow-x-auto !p-[0_18px_12px]"><table class="!w-[100%] ![border-collapse:collapse] !text-[13px]">
        <thead><tr style="background:#F8FAFC;text-align:left;">${_thV('Fecha')}${_thV('Producto')}${_thV('Cant.')}${_thV('Precio')}${_thV('Pago')}${_thV('Vendió')}${_thV('PDF')}</tr></thead><tbody>
        ${g.items.map(v=>`<tr onclick="abrirRemision('${v.id}','gasto')" title="Click para ver el comprobante de venta (PDF)" style="border-bottom:1px solid #F8FAFC;cursor:pointer;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background=''">
          <td class="!p-[7px_10px] !whitespace-nowrap !text-[#64748B] !text-[12px]">${_fechaV(v.fecha)}</td>
          <td class="!p-[7px_10px]">${_hlV(v.nombre,qRaw)}${_provVenta(v.ref)?`<div class="!text-[10px] !text-[#7C3AED]">🏭 ${esc(_provVenta(v.ref))}</div>`:''}</td>
          <td class="!p-[7px_10px] !font-semibold !whitespace-nowrap">${_cantCliente(v)}</td>
          <td class="!p-[7px_10px] !whitespace-nowrap !font-semibold">${_fmtCOPv(v.precio_total)}</td>
          <td class="!p-[7px_10px] !text-[#64748B]">${esc(v.forma_pago||'—')}</td>
          <td class="!p-[7px_10px]">${_hlV(v.vendedor||'',qRaw)}</td>
          <td class="!p-[7px_10px]"><button onclick="event.stopPropagation();abrirRemision('${v.id}','gasto')" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6] !whitespace-nowrap">📄 PDF</button></td>
        </tr>`).join('')}</tbody></table></div>
    </details>`).join('') + `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 18px 14px;font-size:12px;color:#64748B;">
      <span>Clientes ${iniC+1}–${iniC+paginaC.length} de ${lista.length}</span>
      ${totalPagC>1?`<div class="!flex !items-center !gap-[6px]">
        <button onclick="_ventasCliIrPag(${_ventasCliPag-1})" ${_ventasCliPag<=1?'disabled':''} class="btn-sm" style="background:#F1F5F9;color:#475569;${_ventasCliPag<=1?'opacity:.4;cursor:default;':''}">‹ Anterior</button>
        <span class="!font-semibold !text-[#1E293B]">Página ${_ventasCliPag} de ${totalPagC}</span>
        <button onclick="_ventasCliIrPag(${_ventasCliPag+1})" ${_ventasCliPag>=totalPagC?'disabled':''} class="btn-sm" style="background:#F1F5F9;color:#475569;${_ventasCliPag>=totalPagC?'opacity:.4;cursor:default;':''}">Siguiente ›</button>
      </div>`:''}
    </div>`;
}

let _ventaAprobarId = null;
function _provVenta(ref){
  try{ const p = (typeof getProductos==='function' ? getProductos() : []).find(x=>x.ref===ref); return (p && p.proveedor) ? p.proveedor : ''; }catch(e){ return ''; }
}
function aprobarVenta(id){
  const v = _ventasPendDatos.find(x=>x.id==id); if(!v) return;
  _ventaAprobarId = id;
  const _o=document.getElementById('apvObs'); if(_o) _o.value='';
  const prov = _provVenta(v.ref);
  document.getElementById('apvSubtitulo').textContent = `Solicitada por ${nombreUsr(v.solicitado_por)}${v.sede?' · '+v.sede:''}`;
  document.getElementById('apvResumen').innerHTML =
    `<div><span class="!text-[#64748B]">Producto:</span> <strong>${esc(v.nombre)}</strong> <span class="![font-family:monospace] !text-[10px] ![background:#E2E8F0] !p-[1px_6px] !rounded-[4px]">${esc(v.ref)}</span></div>`
    + (prov ? `<div><span class="!text-[#64748B]">Proveedor:</span> <strong>🏭 ${esc(prov)}</strong></div>` : '')
    + `<div><span class="!text-[#64748B]">Cliente:</span> <strong>${esc(v.cliente)}</strong></div>`
    + `<div><span class="!text-[#64748B]">Forma de pago:</span> <strong>${esc(v.forma_pago||'—')}</strong></div>`
    + `<div><span class="!text-[#64748B]">Pidió:</span> <strong>${v.cantidad}${_rollTxt(v)}</strong>${Number(v.es_rollo)&&v.metros_reservados?` (${Math.round(Number(v.metros_reservados)*10)/10} m)`:''} por <strong>${_fmtCOPv(v.precio_total)}</strong></div>`
    + `<div><span class="!text-[#64748B]">Fecha:</span> ${_fechaV(v.fecha)}</div>`
    + (v.origen_stock==='recuperado' && Number(v.es_central) ? `<div><span class="!text-[#64748B]">Stock:</span> ♻️ Recuperado</div>` : '');
  const c = document.getElementById('apvCantidad');
  c.value = v.cantidad; c.max = v.cantidad;
  const _esEq = !!v.equipo_tipo; // ONT/OLT/equipo: cada uno tiene su SN → siempre 1, no se cambia
  c.readOnly = _esEq; c.style.background = _esEq ? '#F1F5F9' : ''; c.style.cursor = _esEq ? 'not-allowed' : '';
  document.getElementById('apvUnit').value = +(Number(v.precio_total)/Number(v.cantidad)).toFixed(2);
  document.getElementById('apvPrecio').value = Math.round(Number(v.precio_total));
  document.getElementById('apvMaxTxt').textContent = (v.equipo_tipo ? 'Equipo con SN propio: cantidad fija' : `Máx. ${v.cantidad} (lo apartado)`);
  const lc = document.getElementById('apvLblCant'); if(lc) lc.textContent = Number(v.es_rollo) ? 'Cantidad (rollos)' : 'Cantidad';
  const lu = document.getElementById('apvLblUnit'); if(lu) lu.textContent = Number(v.es_rollo) ? 'Precio rollo' : 'Precio unidad';
  _apvDesde('none');
  document.getElementById('modalAprobarVenta').classList.add('open');
}
/* Cantidad, precio por unidad y total se mantienen cuadrados:
   - cambias cantidad o precio por unidad → el total se recalcula (cantidad × unidad)
   - cambias el total → el precio por unidad se recalcula */
function _apvDesde(origen){
  const v = _ventasPendDatos.find(x=>x.id==_ventaAprobarId); if(!v) return;
  const cEl = document.getElementById('apvCantidad'), uEl = document.getElementById('apvUnit'), tEl = document.getElementById('apvPrecio');
  const cant = parseInt(cEl.value)||0;
  if(origen==='cant' || origen==='unit'){
    const unit = parseFloat(uEl.value)||0;
    if(cant>0 && unit>0) tEl.value = Math.round(cant*unit);
  } else if(origen==='total'){
    const total = parseFloat(tEl.value)||0;
    if(cant>0 && total>0) uEl.value = +(total/cant).toFixed(2);
  }
  const av = document.getElementById('apvAviso');
  if(cant>Number(v.cantidad)){
    av.style.display='block'; av.style.color='#B91C1C'; av.style.background='#FEF2F2'; av.style.borderLeftColor='#F87171';
    av.textContent = `No puedes aprobar más de ${v.cantidad} (lo que el vendedor apartó).`;
  } else if(cant>0 && cant<Number(v.cantidad)){
    av.style.display='block'; av.style.color='#92400E'; av.style.background='#FFFBEB'; av.style.borderLeftColor='#FBBF24';
    av.textContent = `Se aprueban ${cant} de ${v.cantidad}${_rollTxt(v)}. Lo restante (${Number(v.cantidad)-cant}) vuelve al inventario de ${nombreUsr(v.solicitado_por)}.`;
  } else { av.style.display='none'; }
}
async function confirmarAprobarVenta(){
  const v = _ventasPendDatos.find(x=>x.id==_ventaAprobarId); if(!v) return;
  const cantidad = parseInt(document.getElementById('apvCantidad').value)||0;
  const precio_total = parseFloat(document.getElementById('apvPrecio').value)||0;
  if(cantidad<1 || cantidad>Number(v.cantidad)){ toast(`La cantidad debe estar entre 1 y ${v.cantidad}.`,'error'); return; }
  if(precio_total<=0){ toast('Ingresa un precio válido.','error'); return; }
  try{
    await _api('pedidos','aprobar_venta',{id:_ventaAprobarId, cantidad, precio_total, observacion:(document.getElementById('apvObs')?.value||'').trim()});
    cerrarModal('modalAprobarVenta');
    toast(cantidad<Number(v.cantidad) ? `✅ Venta aprobada con ${cantidad} de ${v.cantidad}` : '✅ Venta aprobada','success');
    cargarVentasPend();
    if(typeof _recargarHistorial==='function') _recargarHistorial().catch(()=>{});
  }catch(e){ toast(e.message||'No se pudo aprobar','error'); cargarVentasPend(); }
}
function abrirRechazarDesdeAprobar(){
  const id = _ventaAprobarId;
  cerrarModal('modalAprobarVenta');
  abrirRechazarVenta(id);
}
function abrirRechazarVenta(id){
  _ventaRechazarId = id;
  const v = _ventasPendDatos.find(x=>x.id==id);
  document.getElementById('rechVentaResumen').textContent = v ? `${nombreUsr(v.solicitado_por)} · ${v.cantidad} × ${v.nombre} → ${v.cliente}` : '';
  document.getElementById('rechVentaMotivo').value = '';
  document.getElementById('modalRechazarVenta').classList.add('open');
}
async function confirmarRechazarVenta(){
  const motivo = (document.getElementById('rechVentaMotivo').value||'').trim();
  if(!motivo){ toast('Escribe el motivo del rechazo.','error'); return; }
  try{
    await _api('pedidos','rechazar_venta',{id:_ventaRechazarId, motivo});
    cerrarModal('modalRechazarVenta');
    toast('Venta rechazada — el material volvió al vendedor','success');
    cargarVentasPend();
  }catch(e){ toast(e.message||'No se pudo rechazar','error'); }
}
async function cancelarVenta(id){
  if(!confirm('¿Cancelar tu solicitud de venta? El material vuelve a tu inventario.')) return;
  try{
    await _api('pedidos','cancelar_venta',{id});
    toast('Solicitud cancelada — el material volvió a tu inventario','success');
    cargarVentasPend();
    if(typeof _recargarProductos==='function') _recargarProductos().catch(()=>{});
  }catch(e){ toast(e.message||'No se pudo cancelar','error'); cargarVentasPend(); }
}