/* ════════════════════════════════════════════════
   ENVÍO MÚLTIPLE
════════════════════════════════════════════════ */
let _emModo = 'directo'; // 'directo' | 'solicitud'

async function abrirEnvioMultiple() {
  await _recargarUsuarios().catch(()=>{});
  // Cargar disponibilidad de ONT y fibra en almacén central, para poder
  // incluirlas como opciones seleccionables junto a los productos normales.
  window._emOntCache = [];
  window._emFibraCache = [];
  try{
    const resOnt = await fetch('api/cajas.php?action=onts_disponibles_modelo',{credentials:'same-origin'});
    const dataOnt = await resOnt.json();
    window._emOntCache = (dataOnt?.almacen||[]).filter(r=>parseInt(r.cantidad)>0).map(r=>({
      ref: 'ONT::'+r.modelo, nombre: '📡 ONT '+r.modelo, unidad: 'unidad',
      _stockEspecial: parseInt(r.cantidad)||0, stockMinimo: 0,
    }));
  }catch(e){}
  try{
    if(!_fibraCats || !_fibraCats.length){ await cargarCategoriasFibra().catch(()=>{}); }
    window._emFibraCache = (_fibraCats||[]).filter(c=>parseFloat(c.metros_disponibles)>0).map(c=>({
      ref: 'FIBRA::'+c.id, nombre: '🔵 Fibra — '+c.nombre, unidad: 'metros',
      _stockEspecial: parseFloat(c.metros_disponibles)||0, stockMinimo: 0,
    }));
  }catch(e){}

  document.getElementById('emDestBuscar').value = '';
  document.getElementById('emSedeDestino').value = '';
  document.getElementById('emDestUsuario').value = '';
  document.getElementById('emDestNombre').value = '';
  const listaD = document.getElementById('emDestLista'); if(listaD) listaD.style.display='none';
  // Superadmin → directo siempre. Todos los demás → solicitud siempre
  _emModo = sesion.rol === 'superadmin' ? 'directo' : 'solicitud';
  const hidden = document.getElementById('emModoHidden');
  if(hidden) hidden.value = _emModo;

  document.getElementById('emBuscar').value = '';
  document.getElementById('emNota').value = '';
  document.getElementById('emProductosWrap').style.display = 'none';
  document.getElementById('emResumen').style.display = 'none';
  _actualizarBotonMultiple();
  document.getElementById('modalEnvioMultiple').classList.add('open');
  _filtrarEmDestinatarios();
}

// Lista de personas que pueden recibir material (municipio/técnico/persona activos con sede).
function _emReceptores(){
  return _usuarios.filter(u => ['municipio','tecnico','persona'].includes(u.rol) && u.estado==='activo' && u.sede);
}
function _filtrarEmDestinatarios(){
  const q = (document.getElementById('emDestBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('emDestLista');
  if(!lista) return;
  const hl = (txt) => {
    txt = String(txt || '');
    if (!q || !txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if (idx < 0) return esc(txt);
    return esc(txt.slice(0, idx))
      + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx + q.length))}</mark>`
      + esc(txt.slice(idx + q.length));
  };
  const filtrados = _emReceptores().filter(u=>{
    const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
    return !q || nombreCompleto.toLowerCase().includes(q) || (u.sede||'').toLowerCase().includes(q) || u.usuario.toLowerCase().includes(q);
  }).sort((a,b)=> (a.sede||'').localeCompare(b.sede||'') || (a.nombre||'').localeCompare(b.nombre||''));

  if(!filtrados.length){
    lista.innerHTML = `<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>`;
  } else {
    const porSede = {};
    filtrados.forEach(u=>{ (porSede[u.sede] = porSede[u.sede]||[]).push(u); });
    let html='';
    Object.keys(porSede).sort().forEach(sedeNom=>{
      html += `<div style="padding:6px 12px;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;background:#F8FAFC;">${hl(sedeNom)}</div>`;
      porSede[sedeNom].forEach(u=>{
        const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
        html += `<div onclick="_seleccionarEmDestinatario('${esc(u.sede).replace(/'/g,"\\'")}','${esc(u.usuario).replace(/'/g,"\\'")}','${esc(nombreCompleto).replace(/'/g,"\\'")}')" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">${hl(nombreCompleto)} <span class="!text-[#94A3B8] !text-[11px]">(${hl(u.usuario)})</span></div>`;
      });
    });
    lista.innerHTML = html;
  }
  lista.style.display='block';
}
function _seleccionarEmDestinatario(sede, usuario, nombre){
  document.getElementById('emSedeDestino').value = sede;
  document.getElementById('emDestUsuario').value = usuario;
  document.getElementById('emDestNombre').value = nombre;
  document.getElementById('emDestBuscar').value = `${nombre} — ${sede}`;
  document.getElementById('emDestLista').style.display='none';
  renderEnvioMultipleProductos();
  _actualizarBotonMultiple();
}
document.addEventListener('click', function(e){
  const cont=document.getElementById('emDestLista');
  const inp=document.getElementById('emDestBuscar');
  if(cont && inp && !inp.contains(e.target) && !cont.contains(e.target)) cont.style.display='none';
});

function renderEnvioMultipleProductos() {
  const sede = document.getElementById('emSedeDestino')?.value;
  const wrap = document.getElementById('emProductosWrap');
  if (!sede) { if (wrap) wrap.style.display = 'none'; return; }
  if (wrap) wrap.style.display = '';
  filtrarEmProductos();
}

// Devuelve la sede (para el stock) y el usuario/nombre específico elegido como destinatario.
function _emDestinoInfo(){
  return {
    sede: document.getElementById('emSedeDestino')?.value || '',
    usuario: document.getElementById('emDestUsuario')?.value || '',
    nombre: document.getElementById('emDestNombre')?.value || ''
  };
}

function _emTodosLosItems(){
  return [...getProductos(), ...(window._emOntCache||[]), ...(window._emFibraCache||[])];
}
function filtrarEmProductos() {
  const q = (document.getElementById('emBuscar')?.value || '').toLowerCase();
  const productos = _emTodosLosItems().filter(p =>
    !q || p.nombre.toLowerCase().includes(q) || p.ref.toLowerCase().includes(q)
  );
  _renderEmLista(productos, q);
}

function _renderEmLista(productos, q) {
  q = (q || '').toLowerCase();
  const esCentralEm = sesion.rol==='superadmin'||sesion.rol==='distribuidor';
  // Resaltado amarillo de la coincidencia
  const hl = (txt) => {
    txt = String(txt || '');
    if (!q || !txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if (idx < 0) return esc(txt);
    return esc(txt.slice(0, idx))
      + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx + q.length))}</mark>`
      + esc(txt.slice(idx + q.length));
  };
  const lista = document.getElementById('emProductosLista');
  if (!lista) return;
  if (!productos.length) {
    lista.innerHTML = `<div class="!p-[24px] !text-center !text-[#94A3B8] !text-[13px]">Sin productos que coincidan.</div>`;
    return;
  }
  lista.innerHTML = productos.map(p => {
    const stock = _stockCentral(p);
    const sinStock = stock === 0;
    const esRollo = p.metrosPorUnidad > 0;
    const stockMostrado = esRollo ? valorMostrar(p, stock) : stock;
    const maxInput = esRollo ? Math.floor(stock / p.metrosPorUnidad) : stock;
    const suf = esRollo ? ('rollo'+(stockMostrado!=1?'s':'')) : sufijoP(p);
    const clsStock = stock === 0 ? 'color:#E24B4A;' : _bajoStockMinimo(p) ? 'color:#BA7517;' : 'color:#16A871;';
    const tieneRecuperado = esCentralEm && (p.stockRecuperado||0) > 0;
    const selectorOrigen = tieneRecuperado ? `
      <select id="emorigen_${p.ref}" onclick="event.stopPropagation();" onchange="event.stopPropagation();" style="font-size:10px;padding:2px 4px;border-radius:6px;border:1px solid #E2E8F0;margin-left:4px;">
        <option value="nuevo">🆕 Nuevo</option>
        <option value="recuperado">♻️ Recup. (${p.stockRecuperado})</option>
      </select>` : '';
    return `<div class="em-row ${sinStock ? 'em-sin-stock' : ''}" id="emrow_${p.ref}" onclick="toggleEmProducto('${p.ref}')">
      <div class="em-check" id="emcheck_${p.ref}">
        <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="3" style="display:none;" id="emcheckIcon_${p.ref}"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg>
      </div>
      <div>
        <div class="!font-semibold !text-[13px]">${hl(p.nombre)}${selectorOrigen}</div>
        <div class="!text-[11px] !text-[#94A3B8] ![font-family:monospace]">${hl(p.ref)}</div>
      </div>
      <div style="text-align:center;font-size:12px;font-weight:600;${clsStock}">${stockMostrado} ${suf}</div>
      <div onclick="event.stopPropagation();">
        <input type="number" id="emcant_${p.ref}" class="em-cant" min="1" max="${maxInput}" placeholder="0"
          oninput="actualizarEmResumen()" disabled data-rollo="${esRollo?1:0}" data-metros-unidad="${p.metrosPorUnidad||0}"
          style="opacity:0.4;">
      </div>
      <div class="!text-center !text-[11px] !text-[#94A3B8]">${esRollo ? ('rollo'+(maxInput!=1?'s':'')) : (p.unidad === 'metros' ? 'mts.' : 'uds.')}</div>
    </div>`;
  }).join('');
  _actualizarBotonMultiple();
}

function toggleEmProducto(ref) {
  const row = document.getElementById('emrow_' + ref);
  const check = document.getElementById('emcheck_' + ref);
  const icon = document.getElementById('emcheckIcon_' + ref);
  const input = document.getElementById('emcant_' + ref);
  if (!row || !check || !input) return;

  const seleccionado = row.classList.contains('em-seleccionado');
  if (seleccionado) {
    row.classList.remove('em-seleccionado');
    check.style.background = '';
    check.style.borderColor = '#CBD5E1';
    if (icon) icon.style.display = 'none';
    input.value = '';
    input.disabled = true;
    input.style.opacity = '0.4';
  } else {
    row.classList.add('em-seleccionado');
    check.style.background = '#0C6EDE';
    check.style.borderColor = '#0C6EDE';
    if (icon) icon.style.display = '';
    input.disabled = false;
    input.style.opacity = '1';
    input.focus();
  }
  actualizarEmResumen();
}

function actualizarEmResumen() {
  const seleccionados = _getEmSeleccionados();
  const resumen = document.getElementById('emResumen');
  const texto = document.getElementById('emResumenTexto');
  const validos = seleccionados.filter(s => s.cantidad > 0 && s.cantidad <= s.stockNeiva);

  if (seleccionados.length === 0) {
    if (resumen) resumen.style.display = 'none';
  } else {
    if (resumen) resumen.style.display = '';
    const conError = seleccionados.filter(s => s.cantidad <= 0 || s.cantidad > s.stockNeiva);
    let msg = `${validos.length} producto${validos.length !== 1 ? 's' : ''} listo${validos.length !== 1 ? 's' : ''} para enviar`;
    if (conError.length > 0) msg += ` · ⚠ ${conError.length} con cantidad inválida o insuficiente`;
    if (texto) texto.textContent = msg;
    if (resumen) resumen.style.background = conError.length > 0 ? '#FAEEDA' : '#E6F1FB';
    if (resumen) resumen.style.color = conError.length > 0 ? '#92400E' : '#0A58B5';
  }
  _actualizarBotonMultiple();
}

function _getEmSeleccionados() {
  const productos = _emTodosLosItems();
  const resultado = [];
  productos.forEach(p => {
    const row = document.getElementById('emrow_' + p.ref);
    if (row && row.classList.contains('em-seleccionado')) {
      const cantEl = document.getElementById('emcant_' + p.ref);
      const cantInput = parseInt(cantEl?.value) || 0;
      const esRollo = p.metrosPorUnidad > 0;
      const cant = esRollo ? cantInput * p.metrosPorUnidad : cantInput;
      const origenEl = document.getElementById('emorigen_' + p.ref);
      const origenStock = origenEl?.value || 'nuevo';
      const stockDisponible = origenStock==='recuperado' ? (p.stockRecuperado||0) : _stockCentral(p);
      resultado.push({ ref: p.ref, nombre: p.nombre, unidad: p.unidad || 'unidad', cantidad: cant, stockNeiva: stockDisponible, origenStock });
    }
  });
  return resultado;
}

function _actualizarBotonMultiple() {
  const btn = document.getElementById('btnProcesarMultiple');
  const lbl = document.getElementById('btnProcesarMultipleLabel');
  const sede = document.getElementById('emSedeDestino')?.value;
  const seleccionados = _getEmSeleccionados();
  const validos = seleccionados.filter(s => s.cantidad > 0 && s.cantidad <= s.stockNeiva);
  const ok = sede && validos.length > 0;
  if (btn) {
    btn.disabled = !ok;
    btn.style.opacity = ok ? '1' : '0.5';
  }
  if (lbl) {
    const tipo = _emModo === 'directo' ? 'Enviar' : 'Solicitar';
    lbl.textContent = ok
      ? `${tipo} ${validos.length} producto${validos.length !== 1 ? 's' : ''}`
      : 'Confirmar envío';
  }
}

function selectEmModo(val) {
  _emModo = val;
  const l1 = document.getElementById('emLabelDirecto');
  const l2 = document.getElementById('emLabelSolicitud');
  if (!l1 || !l2) return;
  document.querySelectorAll('input[name="emModo"]').forEach(r => r.checked = r.value === val);
  l1.classList.toggle('selected', val === 'directo');
  l2.classList.toggle('selected', val === 'solicitud');
  const svgs = [l1.querySelector('svg'), l2.querySelector('svg')];
  if (svgs[0]) svgs[0].style.stroke = val === 'directo' ? '#0C6EDE' : '#94A3B8';
  if (svgs[1]) svgs[1].style.stroke = val === 'solicitud' ? '#0C6EDE' : '#94A3B8';
  const spans = [l1.querySelectorAll('span')[0], l2.querySelectorAll('span')[0]];
  if (spans[0]) { spans[0].style.color = val === 'directo' ? '#0A58B5' : '#6B7280'; spans[0].style.fontWeight = val === 'directo' ? '600' : '400'; }
  if (spans[1]) { spans[1].style.color = val === 'solicitud' ? '#0A58B5' : '#6B7280'; spans[1].style.fontWeight = val === 'solicitud' ? '600' : '400'; }
  _actualizarBotonMultiple();
}

async function procesarEnvioMultiple() {
  const { sede, usuario: destUsuario, nombre: destNombre } = _emDestinoInfo();
  const notaEscrita = (document.getElementById('emNota')?.value || '').trim();
  const paraTag = destNombre ? `Para: ${destNombre}${destUsuario?` (${destUsuario})`:''}.` : '';
  // "Recoge en persona: X" es el formato que el backend ya sabe leer (en
  // seguimiento.php, al confirmar recibido) para saber a quién acreditarle
  // el stock/ONT/fibra específicamente — sin esto, quedaba solo el texto
  // "Para: X" que nadie más revisa, y todo terminaba a nombre de quien
  // confirmara (o de nadie, en el caso de ONT).
  const recogeTag = destUsuario ? `Recoge en persona: ${destUsuario}` : '';
  const nota = [paraTag, notaEscrita, recogeTag].filter(Boolean).join(' ');
  if (!sede) { toast('Selecciona un destinatario.', 'error'); return; }
  const seleccionados = _getEmSeleccionados();
  const validos = seleccionados.filter(s => s.cantidad > 0 && s.cantidad <= s.stockNeiva);
  if (!validos.length) { toast('Agrega al menos un producto con cantidad válida.', 'error'); return; }
  const invalidos = seleccionados.filter(s => s.cantidad <= 0 || s.cantidad > s.stockNeiva);
  if (invalidos.length > 0) { toast(`Corrige las cantidades de: ${invalidos.map(s=>`"${s.nombre}"`).join(', ')}`, 'error'); return; }
  const btn=document.getElementById('btnProcesarMultiple');
  if(btn){btn.disabled=true;btn.style.opacity='0.6';}
  try{
    let procesados=0;
    // Se crea SIEMPRE un pedido agrupado (aunque sea un solo producto), porque ese
    // camino es el único que también registra el envío en "Seguimiento" — necesario
    // para que el destino pueda marcarlo como recibido.
    // - solicitud (distribuidor/otros): queda pendiente de aprobación.
    // - directo (superadmin): se auto-aprueba para pasar directo a seguimiento (sin aprobación, pero rastreable).
    {
      const items = validos.map(item=>{
        const p=_emTodosLosItems().find(x=>x.ref===item.ref);
        if(!p) return null;
        if(String(p.ref).startsWith('FIBRA::')){
          return {ref:'FIBRA', nombre:p.nombre, cantidad:item.cantidad, unidad:'metros', categoria_fibra_id: p.ref.replace('FIBRA::',''), origen_stock:item.origenStock};
        }
        return {ref:p.ref, nombre:p.nombre, cantidad:item.cantidad, unidad:p.unidad||'unidad', origen_stock:item.origenStock};
      }).filter(Boolean);
      const res = await fetch('api/pedidos_agrupados.php?action=crear',{
        method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ items, destino: sede, nota: nota||`Envío múltiple a ${sede}` })
      });
      const data = await res.json();
      if(!res.ok||data.error) throw new Error(data.error||'Error al crear el pedido');
      procesados = items.length;

      // Superadmin: auto-aprobar el pedido recién creado para que pase a seguimiento sin aprobación manual.
      let autoAprobadoOk = true;
      let autoAprobadoError = '';
      if(_emModo==='directo' && data.id){
        await _recargarSolicitudes();
        const itemsDelPedido = getSolicitudes()
          .filter(s => s.pedidoAgrupadoId === data.id)
          .map(s => ({ id: s.id, cantidad_aprobada: parseInt(s.cantidad||0), estado: 'aprobada' }));
        if(itemsDelPedido.length){
          const resAprob = await fetch('api/pedidos_agrupados.php?action=aprobar_items',{
            method:'POST', credentials:'same-origin',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ pedido_id: data.id, items: itemsDelPedido, nota: '' })
          });
          const dataAprob = await resAprob.json().catch(()=>({}));
          if(!resAprob.ok || dataAprob.error){
            autoAprobadoOk = false;
            autoAprobadoError = dataAprob.error || 'Error desconocido al auto-aprobar';
          }
        }
      }

      await Promise.all([_recargarProductos(),_recargarHistorial(),_recargarSolicitudes(),_recargarSeguimiento&&_recargarSeguimiento(),_recargarPedidosAgrupados&&_recargarPedidosAgrupados()]);
      cerrarModal('modalEnvioMultiple');
      renderTabla();renderHistorial();renderStats();updateNotifBadges();
      if(_emModo==='directo' && !autoAprobadoOk){
        toast(`⚠ El pedido se creó pero no se pudo auto-aprobar: ${autoAprobadoError}. Ve a "Pedidos" y apruébalo manualmente.`,'error');
      } else {
        toast(_emModo==='directo'
          ? `✓ Pedido enviado a ${sede} — ${procesados} producto${procesados!==1?'s':''} (listo para despachar en Seguimiento)`
          : `✓ Pedido agrupado creado para ${sede} — ${procesados} producto${procesados!==1?'s':''}`,'success');
      }
      if(btn){btn.disabled=false;btn.style.opacity='1';}
      return;
    }
  }catch(e){toast(e.message||'Error en envío múltiple','error');}
  finally{if(btn){btn.disabled=false;btn.style.opacity='1';}}
}

/* ════════════════════════════════════════════════
   GESTIÓN ONT — CAJAS Y SERIALES
════════════════════════════════════════════════ */
let _ontProductoId   = null;
let _ontCajaId       = null;
let _tabEscaneoActual= 'ont';
let _ontCajaNombre   = '';
let _ontTabActual    = 'registrar';
let _ontInvEstado    = 'todos';
let _ontIdEnviar     = null;

/* ── Tabs ── */
function irAEscaneoFibra(){
  goPanel('escaneo');
  setTimeout(()=>setTabEscaneo('fibra'), 150);
}

function setTabEscaneo(t){
  _tabEscaneoActual=t;
  ['ont','ont_hist','olt','mikrotik','fibra'].forEach(id=>{
    document.getElementById('tabEsc_'+id)?.classList.toggle('active',id===t);
    const el=document.getElementById('escTab_'+id);
    if(el)el.style.display=id===t?'':'none';
  });
  // Pestañas dinámicas de tipos de equipo — sincronizar activo
  document.querySelectorAll('.tabEsc_tipo_equipo').forEach(b=>{
    b.classList.toggle('active', t==='mkTipo_'+b.dataset.tipo);
  });
  const ontUso = document.getElementById('escTab_ont_uso');
  if(ontUso) ontUso.style.display='none';
  const wrap=document.getElementById('btnEscaneoWrap');
  if(wrap) wrap.innerHTML='';
  if(t==='ont')      setTabOnt(_ontTabActual||'registrar');
  if(t==='ont_hist') iniciarCargaHistorica();
  if(t==='olt')     { setTabOlt(_tabOltActual||'reg'); }
  if(t==='mikrotik'){
    cargarTiposEquipo().then(()=>{
      if(_tiposEquipo.length && !_tipoEquipoActual) setTipoEquipoActivo(_tiposEquipo[0].nombre);
    });
  }
  if(t==='ont'){
    setTabOnt(_ontTabActual||'registrar');
  }
  if(t==='ont_uso'){
    cargarTablaOntEnUso();
  }
  if(t==='fibra'){
    const esSuperDist=sesion?.rol==='superadmin'||sesion?.rol==='distribuidor'||tienePermiso('gestionar_fibra');
    wrap.innerHTML=esSuperDist?`<button id="btnNuevaCategoria" class="btn btn-primary" style="font-size:12px;padding:6px 14px;">
      <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg> Nueva categoría</button>`:'';
    document.getElementById('btnNuevaCategoria')?.addEventListener('click', abrirCrearCategoria);
    setTabFib(_tabFibActual||'carr');
  }
}

// Ya no hay pestañas internas — todo vive en una sola pantalla (tabla + filtros).
// Se deja esta función solo para no romper llamadas antiguas: simplemente recarga la tabla.
function setTabOnt(tab){
  cargarInventarioOnt();
}

function verTrazabilidadOnt(serial){
  if(!serial){ toast('Esta ONT no tiene serial registrado','error'); return; }
  document.getElementById('modalTrazaOnt')?.classList.add('open');
  buscarTrazabilidadOnt(serial);
}
async function buscarTrazabilidadOnt(serial){
  const box = document.getElementById('trazaOntResultado');
  if(!serial){ toast('Escribe un serial o MAC para buscar','error'); return; }
  box.innerHTML = '<div class="!text-[#94A3B8] !text-[13px] !p-[16px]">Buscando…</div>';
  try{
    const res = await fetch('api/cajas.php?action=trazabilidad_ont&serial='+encodeURIComponent(serial),{credentials:'same-origin'});
    const d = await res.json();
    if(!res.ok||d.error){ box.innerHTML = `<div class="!text-[#E24B4A] !text-[13px] !p-[16px]">${esc(d.error||'No encontrada')}</div>`; return; }
    const o = d.ont;
    const iconos = {enviada:'🚚',asignada:'🎯',instalada:'🏠',recibida:'📥',importada:'📂',editado:'✏️',reasignada:'➤'};
    const pasos = d.historial.map(h=>`
      <div class="!flex !gap-[12px] !p-[10px_0] ![border-bottom:1px_solid_#F1F5F9]">
        <div class="!text-[18px]">${iconos[h.evento]||'•'}</div>
        <div class="![flex:1]">
          <div class="!font-semibold !text-[13px] !capitalize">${esc(h.evento)}</div>
          <div class="!text-[12px] !text-[#64748B]">${esc(h.detalle)}</div>
          <div class="!text-[11px] !text-[#94A3B8]">${fmtDate(h.fecha)} · ${esc(h.usuario)}</div>
        </div>
      </div>`).join('') || '<div class="!text-[#94A3B8] !text-[12px] !p-[10px_0]">Sin movimientos registrados todavía.</div>';

    box.innerHTML = `
      <div class="pcard !mb-[14px]">
        <div class="pcard-header"><span class="!font-bold !text-[14px]">📡 ${esc(o.mac_fmt||o.mac||'—')} · SN: ${esc(o.sn||'—')}</span>
          <span class="badge ${o.estado==='comodato'?'badge-purple':'badge-ok'}">${esc(o.estado||'—')}</span>
        </div>
        <div class="!p-[14px_16px] !text-[12px] !text-[#64748B]">
          Sede actual: <b>${esc(o.sede_actual||'—')}</b>
          ${o.tecnico_asignado?` · Asignada a: <b>${esc(o.tecnico_asignado)}</b>`:''}
          ${o.cliente_nombre?` · Cliente: <b>${esc(o.cliente_nombre)}</b>`:''}
        </div>
      </div>
      <div class="pcard"><div class="pcard-header"><span class="!font-bold !text-[14px]">🕓 Línea de tiempo</span></div>
        <div class="!p-[6px_16px]">${pasos}</div>
      </div>`;
  }catch(e){ box.innerHTML = `<div class="!text-[#E24B4A] !text-[13px] !p-[16px]">Error: ${e.message}</div>`; }
}



let _histCargadas = [];
async function iniciarCargaHistorica(){
  // Poner la fecha de hoy por defecto en el campo de fecha de ingreso.
  const fechaInp = document.getElementById('histFecha');
  if(fechaInp && !fechaInp.value){
    fechaInp.value = new Date().toISOString().slice(0,10);
  }
  setTimeout(()=>document.getElementById('histMac')?.focus(),100);
}






// Datos pendientes de confirmar la importación
let _impOntPendiente = null;

// Mostrar la ventana de revisión con conteo y errores detallados
function _mostrarModalImportOnt(registros, errores){
  const nVal = registros.length, nErr = errores.length;
  document.getElementById('impOntValidas').textContent = nVal;
  document.getElementById('impOntErrores').textContent = nErr;

  // Ícono y subtítulo según el resultado
  const icono = document.getElementById('impOntIcono');
  const subt  = document.getElementById('impOntSubtitulo');
  if(nErr===0){
    icono.textContent='✅'; icono.style.background='#ECFDF5';
    subt.textContent = `${nVal} ONT${nVal!==1?'s':''} lista${nVal!==1?'s':''} para importar. Todo correcto.`;
  } else if(nVal===0){
    icono.textContent='⚠️'; icono.style.background='#FEF2F2';
    subt.textContent = 'Ninguna fila es válida. Revisa los errores y vuelve a intentar.';
  } else {
    icono.textContent='📥'; icono.style.background='#EFF6FF';
    subt.textContent = `${nVal} válida${nVal!==1?'s':''} se importarán; ${nErr} con error se omitirán.`;
  }

  // Lista de errores
  const box  = document.getElementById('impOntErroresBox');
  const lista= document.getElementById('impOntErroresLista');
  if(nErr){
    box.style.display='block';
    lista.innerHTML = errores.map(e=>{
      // e tiene formato "Fila N: motivo"
      const m = String(e).match(/^Fila (\d+):\s*(.*)$/);
      const fila = m?m[1]:'';
      const motivo = m?m[2]:String(e);
      return `<div class="!flex !gap-[9px] !items-start !p-[8px_10px] ![border:1px_solid_#FEE2E2] !rounded-[9px] !mb-[6px] ![background:#FFFBFB]">
        ${fila?`<span style="flex-shrink:0;background:#FEE2E2;color:#B91C1C;font-weight:700;font-size:11px;border-radius:6px;padding:2px 8px;">Fila ${fila}</span>`:''}
        <span class="!text-[12px] !text-[#7F1D1D]">${esc(motivo)}</span>
      </div>`;
    }).join('');
  } else {
    box.style.display='none';
    lista.innerHTML='';
  }

  // Botón de confirmar: deshabilitado si no hay válidas
  const btn = document.getElementById('impOntBtnConfirmar');
  if(nVal===0){
    btn.disabled=true; btn.style.opacity='0.5'; btn.style.cursor='not-allowed';
    btn.textContent='Nada que importar';
  } else {
    btn.disabled=false; btn.style.opacity='1'; btn.style.cursor='pointer';
    btn.textContent = nErr ? `Importar ${nVal} válida${nVal!==1?'s':''}` : `Importar ${nVal} ONT${nVal!==1?'s':''}`;
  }

  document.getElementById('modalImportOnt').classList.add('open');
}

// Confirmar e importar las ONTs válidas
async function _impOntConfirmar(){
  if(!_impOntPendiente || !_impOntPendiente.registros.length) return;
  const { registros } = _impOntPendiente;
  const btn = document.getElementById('impOntBtnConfirmar');
  btn.disabled=true; btn.textContent='Importando…';
  try{
    const res = await fetch('api/cajas.php?action=cargar_ont_historica',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ registros })
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error al importar');
    cerrarModal('modalImportOnt');
    toast(`✓ ${d.insertadas||0} ONT${(d.insertadas||0)!==1?'s':''} importada${(d.insertadas||0)!==1?'s':''}${d.omitidas?` · ${d.omitidas} omitidas`:''}`,'success');
    registros.slice(0,d.insertadas||registros.length).forEach(rg=>{
      _histCargadas.unshift({modelo:rg.modelo, mac:rg.mac, sn:rg.sn, estado:rg.estado, sede: rg.destino||'—'});
    });
    _histRenderCargadas();
    _impOntPendiente = null;
  }catch(err){
    toast('Error: '+err.message,'error');
    btn.disabled=false; btn.textContent='Reintentar';
  }
}

function _histRenderCargadas(){
  const tb=document.getElementById('histTablaCargadas');
  if(!tb) return;
  // ¿El usuario puede eliminar? (admin o con permiso)
  const puedeEliminar = sesion && (sesion.rol==='superadmin' || tienePermiso('eliminar_ont_masivo'));
  const thCheck = document.getElementById('histThCheck');
  const barra   = document.getElementById('histBarraEliminar');
  if(thCheck) thCheck.style.display = puedeEliminar ? '' : 'none';
  if(barra)   barra.style.display   = puedeEliminar ? 'flex' : 'none';
  const checkTodas = document.getElementById('histCheckTodas');
  if(checkTodas) checkTodas.checked = false;

  const ncols = puedeEliminar ? 7 : 6;
  if(!_histCargadas.length){ tb.innerHTML=`<tr><td class="!text-center !text-[#94A3B8] !p-[16px]" colspan="${ncols}">Aún no has cargado ONTs en esta sesión.</td></tr>`; return; }
  tb.innerHTML=_histCargadas.map((o,i)=>{
    // Solo se pueden seleccionar las que tienen id (registradas individualmente).
    const celdaCheck = puedeEliminar
      ? (o.id ? `<td><input type="checkbox" class="hist-check" value="${o.id}" onchange="histActualizarSeleccion()"></td>`
              : `<td title="Recarga para poder eliminar esta"></td>`)
      : '';
    return `<tr>
      ${celdaCheck}
      <td>${i+1}</td>
      <td class="!text-[12px]">${esc(o.modelo||'—')}</td>
      <td class="![font-family:monospace] !text-[12px]">${esc(o.mac)}</td>
      <td class="![font-family:monospace] !text-[12px]">${esc(o.sn)}</td>
      <td>${esc(o.estado)}</td>
      <td>${esc(o.sede)}</td>
    </tr>`;
  }).join('');
  histActualizarSeleccion();
}


// Actualizar contador y botón según selección
function histActualizarSeleccion(){
  const n = document.querySelectorAll('#histTablaCargadas .hist-check:checked').length;
  const cnt = document.getElementById('histSelCount');
  const btn = document.getElementById('histBtnEliminarSel');
  if(cnt) cnt.textContent = n ? `${n} seleccionada${n!==1?'s':''}` : '';
  if(btn){
    btn.disabled = n===0;
    btn.style.opacity = n===0 ? '.5' : '1';
    btn.style.cursor  = n===0 ? 'not-allowed' : 'pointer';
  }
}


/* ── Iniciar panel ── */
function iniciarPanelEscaneo(){
  // Con el permiso "registrar_ont_campo" (técnico/municipio/persona), solo
  // deben ver "ONTs Nuevas" — nada de gestión de OLT/Equipos/Fibra ni el
  // histórico completo, que es para quien maneja el almacén de verdad.
  const esSoloCampo = ['municipio','tecnico','persona'].includes(sesion.rol);
  ['tabEsc_ont_hist','tabEsc_olt','tabEsc_mikrotik','tabEsc_fibra'].forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = esSoloCampo ? 'none' : '';
  });

  const prods = getProductos().filter(p=>p.unidad==='unidad');
  const sel=document.getElementById('ontInvProdSel');
  if(sel){
    sel.innerHTML='<option value="">Todos los productos…</option>'+
      prods.map(p=>`<option value="${p.id}">${esc(p.ref)} — ${esc(p.nombre)}</option>`).join('');
  }
  // Cerrar cualquier modal que esté abierto
  document.querySelectorAll('.modal-bg.open').forEach(m=>m.classList.remove('open'));
  cargarCategoriasFibra();
  cargarTiposEquipo();
  cargarProveedores().catch(()=>{});
  if(typeof cargarModelosEnEscaneo==='function') cargarModelosEnEscaneo();
  setTabEscaneo(esSoloCampo ? 'ont' : (_tabEscaneoActual||'ont'));
  // Registrar listeners de modales
  ['modalCrearCaja','modalEnviarOnt','modalEstadoOnt','modalEstadoEquipo','modalHistEquipo','modalRegistrarCarrete',
   'modalCrearCategoria','modalGastoFibra','modalEnviarCarrete','modalElegirCarreteFibra','modalEditarCategoriaFibra','modalDevolver','modalDevolverMultiple','modalDevolverFibra','modalEditarProveedor','modalTiposEquipo','modalConfirmarEliminarTipo','modalSolicitarEquipo','modalConfirmarLogout','modalConfirmarDevolverEquipo'].forEach(id=>{
    const el=document.getElementById(id);
    if(el&&!el._listenerAdded){
      el.addEventListener('click',e=>{if(e.target===el)cerrarModal(id);});
      el._listenerAdded=true;
    }
  });
}

/* ── Paso 1: Seleccionar producto ── */
async function ontSeleccionarProducto(){
  const sel  = document.getElementById('ontProductoSel');
  const info = document.getElementById('ontProductoInfo');
  const step2= document.getElementById('ontStep2');
  const step3= document.getElementById('ontStep3');
  _ontProductoId = sel?.value ? parseInt(sel.value) : null;
  _ontCajaId     = null;
  _ontCajaNombre = '';
  if(step3) step3.style.display='none';
  if(!_ontProductoId){ if(info)info.style.display='none'; if(step2)step2.style.display='none'; return; }

  const opt   = sel.options[sel.selectedIndex];
  const p     = getProductos().find(x=>x.id===_ontProductoId);
  const stock = p?.stock?.['Almacen Central']||0;
  const nom   = document.getElementById('ontProductoNombre');
  const stk   = document.getElementById('ontProductoStock');
  if(nom) nom.textContent = opt?.text||'';
  if(stk) stk.textContent = `Stock actual almacén: ${stock} uds.`;
  if(info) info.style.display='';
  if(step2) step2.style.display='';
}

/* ── Cargar cajas del producto seleccionado ── */



/* ── Paso 2: Seleccionar caja ── */
// Cambia a la sub-pestaña "Inventario" y expande automáticamente la caja indicada






// Datos de las ONTs mostradas actualmente
let _ontDatosActuales = [];

// Seleccionar/deseleccionar todas
function ontToggleTodas(chk){
  document.querySelectorAll('#ontTablaActual .ont-check').forEach(c=>{ c.checked = chk.checked; });
  ontActualizarSeleccion();
}

// Actualizar contador y estado del botón según la selección
function ontActualizarSeleccion(){
  const checks = [...document.querySelectorAll('#ontTablaActual .ont-check:checked')];
  const n = checks.length;
  const cnt = document.getElementById('ontSelCount');
  const btn = document.getElementById('ontBtnEliminarSel');
  if(cnt) cnt.textContent = n ? `${n} seleccionada${n!==1?'s':''}` : '';
  if(btn){
    btn.disabled = n===0;
    btn.style.opacity = n===0 ? '.5' : '1';
    btn.style.cursor  = n===0 ? 'not-allowed' : 'pointer';
  }
}

// Eliminar las ONTs seleccionadas (pide contraseña)


/* ── Validar MAC ── */
function ontValidarMac(){
  const input  = document.getElementById('ontMacInput');
  const icono  = document.getElementById('ontMacIcono');
  const msg    = document.getElementById('ontMacMsg');
  const raw    = (input?.value||'').replace(/[^A-Fa-f0-9]/g,'');
  const ok     = raw.length>0;
  if(!input?.value.trim()){ if(icono)icono.style.display='none'; if(msg)msg.style.display='none'; _actualizarBtnOntAgregar(); return; }
  if(ok){
    input.style.borderColor='#16A871'; input.style.boxShadow='0 0 0 3px rgba(22,168,113,.1)';
    if(icono){icono.style.display='inline';icono.innerHTML='<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#16A871" stroke-width="2.5"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg>';}
    if(msg){msg.style.display='block';msg.style.color='#16A871';msg.textContent='MAC válida ✓';}
  } else {
    input.style.borderColor='#E24B4A'; input.style.boxShadow='0 0 0 3px rgba(226,75,74,.1)';
    if(icono){icono.style.display='inline';icono.innerHTML='<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#E24B4A" stroke-width="2.5"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>';}
    if(msg){msg.style.display='block';msg.style.color='#E24B4A';msg.textContent='Escribe la MAC';}
  }
  _actualizarBtnOntAgregar();
}

/* ── Validar SN ── */
function ontValidarSn(){
  const input = document.getElementById('ontSnInput');
  const icono = document.getElementById('ontSnIcono');
  const msg   = document.getElementById('ontSnMsg');
  const val   = (input?.value||'').trim();
  const ok    = val.length >= 4;
  if(!val){ if(icono)icono.style.display='none'; if(msg)msg.style.display='none'; _actualizarBtnOntAgregar(); return; }
  if(ok){
    input.style.borderColor='#16A871'; input.style.boxShadow='0 0 0 3px rgba(22,168,113,.1)';
    if(icono){icono.style.display='inline';icono.innerHTML='<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#16A871" stroke-width="2.5"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg>';}
    if(msg){msg.style.display='block';msg.style.color='#16A871';msg.textContent='SN válido ✓';}
  } else {
    input.style.borderColor='#E24B4A'; input.style.boxShadow='0 0 0 3px rgba(226,75,74,.1)';
    if(icono){icono.style.display='inline';icono.innerHTML='<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#E24B4A" stroke-width="2.5"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>';}
    if(msg){msg.style.display='block';msg.style.color='#E24B4A';msg.textContent='SN muy corto';}
  }
  _actualizarBtnOntAgregar();
}

function _actualizarBtnOntAgregar(){
  const mac  = (document.getElementById('ontMacInput')?.value||'').replace(/[^A-Fa-f0-9]/g,'');
  const sn   = (document.getElementById('ontSnInput')?.value||'').trim();
  const ok   = mac.length>0 && sn.length>=4;
  const btn  = document.getElementById('btnOntAgregar');
  if(btn){ btn.disabled=!ok; btn.style.opacity=ok?'1':'0.5'; }
}

/* ── Agregar ONT a la caja ── */
let _tecnicosEnUso = [];

function filtrarTecnicosEnUso(){
  const q = (document.getElementById('ontEnUsoBuscarTec')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('ontEnUsoListaTec');
  if(!lista) return;
  
  // Siempre mostrar "Otro" primero
  const filtrados = q
    ? _tecnicosEnUso.filter(u=>
        (u.nombre||'').toLowerCase().includes(q)||
        (u.apellido||'').toLowerCase().includes(q)||
        (u.usuario||'').toLowerCase().includes(q))
    : _tecnicosEnUso;

  const otroItem = `<div onclick="seleccionarTecEnUso('__otro__','Otro (externo)')" 
    style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #F1F5F9;background:#FFF8E1;"
    onmouseover="this.style.background='#FFF3CD'" onmouseout="this.style.background='#FFF8E1'">
    <div class="!font-semibold !text-[13px] !text-[#92400E]">✏️ Otro (técnico externo)</div>
    <div class="!text-[11px] !text-[#94A3B8]">Escribir nombre manualmente</div>
  </div>`;

  if(!filtrados.length && q){
    lista.innerHTML = otroItem + '<div class="!p-[12px] !text-center !text-[#94A3B8] !text-[13px]">Sin resultados</div>';
  } else {
    lista.innerHTML = otroItem + filtrados.map(u=>`
      <div onclick="seleccionarTecEnUso('${u.usuario}','${esc(u.nombre||u.usuario)} ${esc(u.apellido||'')} @${esc(u.usuario)}')"
        style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #F1F5F9;"
        onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'">
        <div class="!font-semibold !text-[13px] !text-[#0F172A]">${esc(u.nombre||u.usuario)} ${esc(u.apellido||'')}</div>
        <div class="!text-[11px] !text-[#94A3B8]">@${esc(u.usuario)} · ${esc(u.rol||'')} · ${esc(u.sede||'')}</div>
      </div>`).join('');
  }
  lista.style.display = 'block';
}

function seleccionarTecEnUso(valor, etiqueta){
  document.getElementById('ontEnUsoBuscarTec').value = '';
  document.getElementById('ontEnUsoListaTec').style.display = 'none';
  
  if(valor === '__otro__'){
    // Mostrar campo externo
    document.getElementById('ontEnUsoTecnico').value = '';
    document.getElementById('ontEnUsoTecSelDiv').style.display = 'none';
    document.getElementById('ontEnUsoTecExternoDiv').style.display = '';
    setTimeout(()=>document.getElementById('ontEnUsoTecExterno')?.focus(), 100);
  } else {
    document.getElementById('ontEnUsoTecnico').value = valor;
    document.getElementById('ontEnUsoTecExternoDiv').style.display = 'none';
    const div = document.getElementById('ontEnUsoTecSelDiv');
    const span = document.getElementById('ontEnUsoTecNombre');
    if(div) div.style.display = 'flex';
    if(span) span.textContent = etiqueta;
  }
}

function limpiarTecEnUso(){
  document.getElementById('ontEnUsoTecnico').value = '';
  document.getElementById('ontEnUsoBuscarTec').value = '';
  document.getElementById('ontEnUsoListaTec').style.display = 'none';
  document.getElementById('ontEnUsoTecSelDiv').style.display = 'none';
  document.getElementById('ontEnUsoTecExternoDiv').style.display = 'none';
  document.getElementById('ontEnUsoBuscarTec')?.focus();
}


function ontEnUsoValidarMac(){
  const inp  = document.getElementById('ontEnUsoMac');
  const icono= document.getElementById('ontEnUsoMacIcono');
  const msg  = document.getElementById('ontEnUsoMacMsg');
  if(!inp) return;
  inp.value = inp.value.replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
  const v = inp.value.length === 12;
  if(icono){ icono.style.display = inp.value ? '' : 'none'; icono.textContent = v ? '✅' : '❌'; }
  if(msg){ msg.textContent = inp.value.length > 0 ? (v ? 'MAC válida ✓' : 'Escribe la MAC') : ''; msg.style.color = v ? '#16A871' : '#E24B4A'; }
  if(v) setTimeout(()=>document.getElementById('ontEnUsoSn')?.focus(), 100);
}

function ontEnUsoValidarSn(){
  const inp  = document.getElementById('ontEnUsoSn');
  const icono= document.getElementById('ontEnUsoSnIcono');
  const msg  = document.getElementById('ontEnUsoSnMsg');
  if(!inp) return;
  inp.value = inp.value.toUpperCase();
  const v = inp.value.length >= 4;
  if(icono){ icono.style.display = inp.value ? '' : 'none'; icono.textContent = v ? '✅' : '❌'; }
  if(msg){ msg.textContent = inp.value.length > 0 ? (v ? 'SN válido ✓' : 'Mínimo 4 caracteres') : ''; msg.style.color = v ? '#16A871' : '#E24B4A'; }
}


let _ontEnUsoData = [];

let _importOntDatos = [];


function abrirImportarOntExcel(){
  document.getElementById('importOntFile').value = '';
  document.getElementById('importOntFileName').textContent = 'Ningún archivo seleccionado';
  document.getElementById('importOntAlerta').className = 'alerta';
  document.getElementById('importOntPreview').style.display = 'none';
  document.getElementById('btnConfirmarImport').disabled = true;
  _importOntDatos = [];
  const _nt0 = document.getElementById('importOntNota'); if(_nt0) _nt0.value='';
  document.getElementById('modalImportarOntExcel').classList.add('open');
}

function importOntArchivoSeleccionado(){
  const file = document.getElementById('importOntFile').files[0];
  if(!file) return;
  document.getElementById('importOntFileName').textContent = file.name;
  document.getElementById('importOntAlerta').className = 'alerta';

  const reader = new FileReader();
  reader.onload = e => {
    try{
      const XLSX = window.XLSX;
      if(!XLSX){ toast('Error: librería Excel no cargada','error'); return; }
      
      let rows;
      if(file.name.endsWith('.csv')){
        const text = new TextDecoder('utf-8').decode(e.target.result);
        const wb2 = XLSX.read(text, {type:'string', raw:false});
        const ws = wb2.Sheets[wb2.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:false});
      } else {
        const wb = XLSX.read(e.target.result, {type:'array', cellDates:true});
        const ws = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, {header:1, raw:false});
      }

      const primeraFila = rows[0] || [];
      const segundaFila = rows[1] || [];

      // Detectar formato: plantilla propia (fila1=título, fila2=headers MAC/SN/Sede...)
      // vs formato empresa (fila1=headers Marca/SN/MAC...)
      const esPlantillaPropia = (primeraFila[0]||'').toString().toLowerCase().includes('plantilla') ||
                                (primeraFila[0]||'').toString().toLowerCase().includes('importaci');
      const esFormatoEmpresa  = !esPlantillaPropia && (
                                (primeraFila[0]||'').toString().toLowerCase().includes('marca') ||
                                (primeraFila[1]||'').toString().toLowerCase().includes('sn') ||
                                (primeraFila[2]||'').toString().toLowerCase().includes('mac'));

      // Plantilla propia: fila1=título, fila2=headers → datos desde fila 3 (índice 2)
      // Formato empresa: fila1=headers → datos desde fila 2 (índice 1)
      // Sin cabecera reconocida: datos desde fila 1 (índice 0)
      const startRow = esPlantillaPropia ? 2 : esFormatoEmpresa ? 1 : 0;
      const datos = rows.slice(startRow).filter(r=>r[0]||r[1]||r[2]);
      const errores = [];
      const validos = [];

      datos.forEach((r, i) => {
        const linea = i + startRow + 1;
        let mac, sn, sede, cliente, dir, tec, fecha, estado;

        if(esFormatoEmpresa){
          sn     = (r[1]||'').toString().trim().toUpperCase();
          mac    = (r[2]||'').toString().replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
          sede   = (r[7]||'').toString().trim();
          fecha  = (r[6]||'').toString().trim();
          tec    = (r[8]||'').toString().trim();
          cliente= '';
          dir    = '';
        } else {
          // Plantilla propia: MAC | SN | Sede | Cliente | Dirección | Técnico | Fecha
          mac    = (r[0]||'').toString().replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
          sn     = (r[1]||'').toString().trim().toUpperCase();
          sede   = (r[2]||'').toString().trim();
          cliente= (r[3]||'').toString().trim();
          dir    = (r[4]||'').toString().trim();
          tec    = (r[5]||'').toString().trim();
          fecha  = (r[6]||'').toString().trim();
          estado = (r[7]||'').toString().trim().toLowerCase();
        }

        if(!mac||!sn){ errores.push(`Fila ${linea}: MAC o SN vacíos`); return; }
        // MAC libre: se acepta cualquier largo
        // sede puede estar vacía — se asigna después o queda sin sede
        // Dejar vacíos — se editan después

        const estadosValidos=['disponible','comodato','dañado','vendido','despachada','ocupado'];
        if(!estadosValidos.includes(estado)) estado='';
        validos.push({mac, sn, sede, estado, sede_origen: esFormatoEmpresa ? (r[3]||'').toString().trim() : '', cliente_nombre:cliente, cliente_direccion:dir, tecnico_instalacion:tec, fecha_instalacion:fecha});

      });
      _importOntDatos = validos;
      const preview = document.getElementById('importOntPreview');
      const resumen = document.getElementById('importOntResumen');
      const errDiv  = document.getElementById('importOntErrores');
      preview.style.display = '';
      resumen.textContent = `✓ ${validos.length} registros válidos${errores.length?` · ⚠ ${errores.length} con errores`:''}`;
      resumen.style.color = errores.length ? '#D97706' : '#166534';
      if(errores.length){ errDiv.style.display=''; errDiv.innerHTML=errores.map(e=>`<div>• ${e}</div>`).join(''); }
      else errDiv.style.display='none';
      document.getElementById('btnConfirmarImport').disabled = validos.length === 0;
    }catch(err){ toast('Error al leer el archivo: '+err.message,'error'); }
  };
  reader.readAsArrayBuffer(file);
}


/* ── Importar ONTs a caja específica desde Excel ── */
let _importCajaDatos = [];

function descargarPlantillaMikrowisp(){
  try{
    const XLSX = window.XLSX;
    if(!XLSX){ toast('Error: librería Excel no cargada','error'); return; }
    const datos = [
      ['ID Categoría (*)','Nº serie','Nº Mac','Costo (*)','Estado (*) \nNo disponible=1\nDisponible=2\nComodato=3','ID cliente','Fecha Ingreso (*) formato= YYYY-MM-DD','Fecha Salida formato= YYYY-MM-DD','ID Proveedor'],
      ['1','12345678','34:34:34:45:12:45','100','2','','2018-07-22','','0'],
      ['1','12345678','24:94:34:45:12:45','100','3','2','2018-07-22','2018-07-23','1'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(datos);
    ws['!cols'] = [{wch:16},{wch:14},{wch:20},{wch:10},{wch:12},{wch:10},{wch:20},{wch:20},{wch:12}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'productos');
    XLSX.writeFile(wb, 'plantilla_mikrowisp.xlsx');
  }catch(e){ toast('No se pudo generar la plantilla','error'); }
}

function descargarPlantillaOntNueva(){
  try{
    const XLSX = window.XLSX;
    if(!XLSX){ toast('Error: librería Excel no cargada','error'); return; }
    const datos = [
      ['Modelo','MAC','SN','Estado','Fecha ingreso','Fecha salida'],
      ['Huawei HG8145','AABBCCDDEEFF','SN123456789','disponible','01/06/2026',''],
      ['ZTE F670L','112233445566','SN987654321','comodato','02/06/2026','10/06/2026'],
    ];
    const ws = XLSX.utils.aoa_to_sheet(datos);
    ws['!cols'] = [{wch:18},{wch:16},{wch:16},{wch:14},{wch:14},{wch:14}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ONTs');
    XLSX.writeFile(wb, 'plantilla_onts.xlsx');
  }catch(e){ toast('No se pudo generar la plantilla','error'); }
}







// Paso previo: pide confirmación antes de importar.
function confirmarImportarOntExcel(){
  if(!_importOntDatos.length) return;
  const n = _importOntDatos.length;
  mostrarConfirmar({
    icono:'📥', color:'#16A871',
    titulo:'¿Registrar esta llegada de ONT?',
    desc:`Vas a registrar ${n} ONT. En el historial quedará un solo registro: "Llegada de ${n} ONT". ¿Estás seguro?`,
    btnTxt:'Sí, importar', btnColor:'#16A871',
    onConfirmar: ()=>_ejecutarImportarOntExcel()
  });
}
async function _ejecutarImportarOntExcel(){
  if(!_importOntDatos.length) return;
  const btn = document.getElementById('btnConfirmarImport');
  const alerta = document.getElementById('importOntAlerta');
  btn.disabled = true;
  btn.textContent = 'Importando...';
  alerta.className = 'alerta';

  try{
    const res = await fetch('api/cajas.php?action=importar_ont_excel', {
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({registros: _importOntDatos, nota: (document.getElementById('importOntNota')?.value||'').trim()})
    });
    const data = await res.json();
    if(data.error) throw new Error(data.error);

    const _nt = document.getElementById('importOntNota'); if(_nt) _nt.value='';
    cerrarModal('modalImportarOntExcel');
    toast(`✓ ${data.importados} ONTs importadas${data.omitidas?` · ${data.omitidas} omitidas (duplicadas)`:''}`, 'success');
    cargarTablaOntEnUso();
  }catch(e){
    alerta.textContent = e.message||'Error al importar.';
    alerta.className = 'alerta error';
    btn.disabled = false;
    btn.textContent = '📥 Importar';
  }
}



function abrirEliminarOntMasivo(){
  if(!tienePermiso('eliminar_ont_masivo')){ toast('Sin permiso para esta acción','error'); return; }
  const total = _ontEnUsoData.length;
  mostrarConfirmar({
    icono:'🗑️', color:'#B91C1C',
    titulo:'Eliminar TODAS las ONTs',
    desc:`¿Estás seguro? Se eliminarán ${total} ONTs de la base de datos. Esta acción no se puede deshacer.`,
    btnTxt:'Sí, eliminar todo', btnColor:'#B91C1C',
    requirePassword: true,
    onConfirmar: async()=>{
      try{
        const res=await fetch('api/cajas.php?action=eliminar_ont_masivo',{
          method:'POST', credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({confirmar:true})
        });
        const data=await res.json();
        if(data.error) throw new Error(data.error);
        toast(`✓ ${data.eliminadas} ONTs eliminadas`,'success');
        cargarTablaOntEnUso();
      }catch(e){ toast(e.message||'Error al eliminar','error'); }
    }
  });
}
async function cargarTablaOntEnUso(){
  const wrap = document.getElementById('tablaOntEnUsoWrap');
  if(!wrap) return;
  const esSuperDist = sesion?.rol==='superadmin'||sesion?.rol==='distribuidor';
  // Botón eliminar masivo — solo con permiso
  const btnElim = document.getElementById('btnEliminarOntMasivo');
  if(btnElim) btnElim.style.display = tienePermiso('eliminar_ont_masivo') ? '' : 'none';
  // Botones Importar y Registrar — solo superadmin/distribuidor
  const btnImportar  = document.querySelector('button[onclick="abrirImportarOntExcel()"]');
  const btnRegistrar = document.querySelector('button[onclick="abrirRegistrarOntEnUso()"]');
  const btnPlantilla = document.querySelector('a[download="ont_plantilla_importacion.xlsx"]')?.parentElement;
  if(btnImportar)  btnImportar.style.display  = esSuperDist ? '' : 'none';
  if(btnRegistrar) btnRegistrar.style.display = esSuperDist ? '' : 'none';
  if(btnPlantilla) btnPlantilla.style.display = esSuperDist ? '' : 'none';
  wrap.innerHTML = '<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[24px]">Cargando...</div>';
  try{
    const res = await fetch('api/cajas.php?action=listar_ont_en_uso', {credentials:'same-origin'});
    const raw = await res.json();
    _ontEnUsoData = Array.isArray(raw) ? raw : [];
    if(!Array.isArray(raw) && raw.error) throw new Error(raw.error);

    // Poblar filtro de estados con los que realmente existen, con su total
    const selEstado = document.getElementById('filtroOntUsoEstado');
    if(selEstado){
      const lblE={disponible:'Disponible (almacén)',despachada:'Lista p/ instalar',comodato:'Instalada',ocupado:'Ocupada',dañado:'Dañada',vendido:'Vendida',en_venta:'En venta',sin_asignar:'Sin asignar'};
      const estadosEnBD=[...new Set(_ontEnUsoData.map(o=>o.estado).filter(Boolean))].sort();
      const valorPrevio = selEstado.value;
      selEstado.innerHTML=`<option value="">Todos los estados (${_ontEnUsoData.length})</option>`+
        estadosEnBD.map(e=>{
          const n = _ontEnUsoData.filter(o=>o.estado===e).length;
          return `<option value="${esc(e)}">${lblE[e]||e} (${n})</option>`;
        }).join('');
      selEstado.value = valorPrevio;
    }

    // Poblar filtro de sedes
    const selSede = document.getElementById('filtroOntUsoSede');
    if(selSede){
      const sedesMap={}; _ontEnUsoData.forEach(o=>{if(o.sede_actual){const k=o.sede_actual.trim();sedesMap[k.toUpperCase()]=k;}}); const sedes=Object.values(sedesMap).sort();
      selSede.innerHTML = '<option value="">Todos los municipios</option>' +
        sedes.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('');
    }
    filtrarTablaOntEnUso();
  }catch(e){ wrap.innerHTML = '<div class="!text-center !text-[#E24B4A] !text-[13px] !p-[24px]">Error al cargar.</div>'; }
}

function limpiarFiltrosOntUso(){
  ['filtroOntUsoMac','filtroOntUsoSn','filtroOntUsoCliente','filtroOntUsoUsuario','filtroOntUsoEstado','filtroOntUsoDesde','filtroOntUsoHasta']
    .forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('filtroOntUsoSede').value = '';
  filtrarTablaOntEnUso();
}

function resaltar(texto, q){
  if(!q||!texto) return esc(texto||'');
  const idx = texto.toLowerCase().indexOf(q.toLowerCase());
  if(idx === -1) return esc(texto);
  return esc(texto.slice(0,idx)) + `<mark class="![background:#FEF08A] !rounded-[2px] !p-[0_1px]">${esc(texto.slice(idx,idx+q.length))}</mark>` + esc(texto.slice(idx+q.length));
}

function filtrarTablaOntEnUso(){
  const wrap  = document.getElementById('tablaOntEnUsoWrap');
  const qMac    = (document.getElementById('filtroOntUsoMac')?.value||'').toLowerCase().trim().replace(/:/g,'');
  const qSn     = (document.getElementById('filtroOntUsoSn')?.value||'').toLowerCase().trim();
  const qCliente= (document.getElementById('filtroOntUsoCliente')?.value||'').toLowerCase().trim();
  const qUsuario= (document.getElementById('filtroOntUsoUsuario')?.value||'').toLowerCase().trim();
  const estado  = document.getElementById('filtroOntUsoEstado')?.value||'';
  const sede    = document.getElementById('filtroOntUsoSede')?.value||'';
  const desde  = document.getElementById('filtroOntUsoDesde')?.value||'';
  const hasta  = document.getElementById('filtroOntUsoHasta')?.value||'';

  let datos = _ontEnUsoData.filter(o=>{
    if(qMac    && !(o.mac||'').toLowerCase().replace(/:/g,'').includes(qMac) && !(o.mac_fmt||'').toLowerCase().replace(/:/g,'').includes(qMac)) return false;
    if(qSn     && !(o.sn||'').toLowerCase().includes(qSn)) return false;
    if(qCliente&& !(o.cliente_nombre||'').toLowerCase().includes(qCliente)) return false;
    if(qUsuario&& !(o.tecnico_asignado||'').toLowerCase().includes(qUsuario) && !(o.tecnico_instalacion||'').toLowerCase().includes(qUsuario)) return false;
    if(estado  && (o.estado||'') !== estado) return false;
    if(sede   && (o.sede_actual||'').toUpperCase() !== sede.toUpperCase()) return false;
    if(desde  && o.fecha_instalacion && o.fecha_instalacion < desde) return false;
    if(hasta  && o.fecha_instalacion && o.fecha_instalacion > hasta+'T23:59:59') return false;
    return true;
  });

  if(!datos.length){
    wrap.innerHTML = '<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[24px]">Sin resultados.</div>';
    return;
  }
  wrap.innerHTML = `<div class="tbl-wrap"><table>
    <thead><tr><th>MAC</th><th>SN</th><th>Estado</th><th>Sede</th><th>Cliente</th><th>Dirección</th><th>Técnico</th><th>Fecha</th><th>Acciones</th></tr></thead>
    <tbody>${datos.map(o=>`<tr class="!cursor-pointer" onclick="verDetalleOnt(${o.id})">
      <td class="![font-family:monospace] !text-[12px] !text-[#0A58B5] !font-semibold">${resaltar(o.mac,qMac)}</td>
      <td class="![font-family:monospace] !text-[12px]">${resaltar(o.sn,qSn)}</td>
      <td>${(()=>{const clsE={disponible:'badge-ok',despachada:'badge-ok',comodato:'badge-purple',ocupado:'badge-warn',dañado:'badge-danger',vendido:'badge-gray'};const lblE={disponible:'Disponible (almacén)',despachada:'Lista p/inst.',comodato:'Instalada',ocupado:'Ocupada',dañado:'Dañada',vendido:'Vendida',en_venta:'En venta'};if(!o.estado||o.estado==='sin_asignar') return '<span class="!text-[#CBD5E1] !text-[12px]">—</span>';return `<span class="badge ${clsE[o.estado]||'badge-gray'} !text-[10px]">${lblE[o.estado]||o.estado}</span>`;})()}</td>
      <td><span class="badge badge-brand !text-[11px]">${esc(o.sede_actual||'—')}</span></td>
      <td class="!font-semibold">${esc(o.cliente_nombre||'—')}</td>
      <td class="!text-[12px] !text-[#94A3B8]">${esc(o.cliente_direccion||'—')}</td>
      <td class="!text-[12px]">${esc(o.tecnico_instalacion||'—')}</td>
      <td class="!text-[12px] !text-[#94A3B8] !whitespace-nowrap">${fmtDate(o.fecha_instalacion||o.fecha)}</td>
      <td class="!whitespace-nowrap" onclick="event.stopPropagation()">
        <button onclick="editarOntEnUso(${o.id})" class="btn-sm ![background:#E6F1FB] !text-[#0C6EDE]">✏️</button>
        ${(!o.tecnico_asignado&&(sesion?.rol==='superadmin'||sesion?.rol==='distribuidor'))?`<button onclick="eliminarOntEnUso(${o.id},'${esc(o.mac)}')" class="btn-sm ![background:#FEF2F2] !text-[#B91C1C]">🗑</button>`:''}
      </td>
    </tr>`).join('')}</tbody>
  </table></div>
  <div class="!flex !justify-between !items-center !p-[8px_0]">
    <div class="!text-[11px] !text-[#94A3B8]">${datos.length} registro${datos.length!==1?'s':''}</div>
    <button onclick="exportarOntEnUso()" class="btn-sm ![background:#EAF3DE] !text-[#166534]">📊 Exportar Excel</button>
  </div>`;
}

function verDetalleOntMunicipio(id){
  // Buscar primero en los datos ya cargados en la tabla actual
  let o = null;
  if(window._misOntData) o = _misOntData.find(x=>String(x.id)===String(id));
  if(!o && window._histOntData) o = _histOntData.find(x=>String(x.id)===String(id));
  if(!o && window._ontEnUsoData) o = _ontEnUsoData.find(x=>String(x.id)===String(id));
  if(!o){
    // Respaldo: pedirla directo al servidor
    fetch(`api/cajas.php?action=listar_ont_detalle&id=${id}`,{credentials:'same-origin'})
      .then(r=>r.json()).then(data=>{ if(data&&data.id) _mostrarDetalleOnt(data); else toast('ONT no encontrada','error'); })
      .catch(()=>toast('Error al cargar el detalle','error'));
    return;
  }
  _mostrarDetalleOnt(o);
}

function _mostrarDetalleOnt(o){
  const d = document.getElementById('detalleOntBody');
  if(d) d.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
      <div class="![grid-column:1/-1] ![background:#F1F5F9] !rounded-[10px] !p-[10px_14px]">
        <div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase !mb-[4px]">Identificación</div>
        <div class="![font-family:monospace] !text-[15px] !font-bold !text-[#0A58B5]">${esc(o.mac)}</div>
        <div class="![font-family:monospace] !text-[13px] !text-[#374151]">SN: ${esc(o.sn)}</div>
      </div>
      <div>
        <div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase !mb-[4px]">Estado</div>
        <div class="!text-[13px] !font-semibold">${o.estado==='comodato'?'📋 En comodato':o.estado==='despachada'?'✅ Disponible':o.estado==='dañado'?'⚠️ Dañada':'✅ Disponible'}</div>
      </div>
      <div>
        <div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase !mb-[4px]">Oficina dueña</div>
        <div class="!text-[13px] !font-semibold">🏢 ${esc(o.tecnico_asignado||'—')}</div>
      </div>
      <div>
        <div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase !mb-[4px]">Sede</div>
        <div class="!text-[13px] !font-semibold">${esc(o.sede_actual||'—')}</div>
      </div>
      <div>
        <div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase !mb-[4px]">Cliente</div>
        <div class="!text-[13px] !font-semibold">${esc(o.cliente_nombre||'—')}</div>
      </div>
      <div>
        <div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase !mb-[4px]">Dirección</div>
        <div class="!text-[13px]">${esc(o.cliente_direccion||'—')}</div>
      </div>
      <div>
        <div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase !mb-[4px]">Técnico instalador</div>
        <div class="!text-[13px]">${esc(o.tecnico_instalacion||'—')}${o.tecnico_instalacion?({confirmada:' <span class="!text-[#16A871]">✓ confirmado</span>',pendiente:' <span class="!text-[#B45309]">⏳ sin confirmar</span>',disputada:' <span class="!text-[#B91C1C]">⚠️ disputado</span>'}[o.instalacion_confirmada]||''):''}</div>
      </div>
      <div>
        <div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase !mb-[4px]">Fecha instalación</div>
        <div class="!text-[13px]">${fmtDate(o.fecha_instalacion||o.fecha)}</div>
      </div>
    </div>`;
  document.getElementById('modalDetalleOnt').classList.add('open');
}


function verDetalleOnt(id){
  const o = _ontEnUsoData.find(x=>x.id===id||x.id===String(id));
  if(!o) return;
  const d = document.getElementById('detalleOntBody');
  if(d) d.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div><div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase">MAC</div><div class="![font-family:monospace] !text-[14px] !font-bold !text-[#0A58B5]">${esc(o.mac)}</div></div>
      <div><div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase">Serial (SN)</div><div class="![font-family:monospace] !text-[14px] !font-bold">${esc(o.sn)}</div></div>
      <div><div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase">Sede</div><div class="!text-[13px] !font-semibold">${esc(o.sede_actual||'—')}</div></div>
      <div><div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase">Estado</div><div class="!text-[13px] !font-semibold">${esc(o.estado||'—')}</div></div>
      <div><div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase">Cliente</div><div class="!text-[13px] !font-semibold">${esc(o.cliente_nombre||'—')}</div></div>
      <div><div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase">Dirección</div><div class="!text-[13px]">${esc(o.cliente_direccion||'—')}</div></div>
      <div><div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase">Técnico</div><div class="!text-[13px]">${esc(o.tecnico_instalacion||'—')}</div></div>
      <div><div class="!text-[10px] !text-[#94A3B8] !font-bold !uppercase">Fecha instalación</div><div class="!text-[13px]">${fmtDate(o.fecha_instalacion||o.fecha)}</div></div>
    </div>`;
  document.getElementById('modalDetalleOnt').classList.add('open');
}

function editarOntEnUso(id){
  const o = _ontEnUsoData.find(x=>x.id===id||x.id===String(id));
  if(!o) return;
  document.getElementById('editOntId').value = id;
  const selModelo = document.getElementById('editOntModelo');
  if(selModelo){
    const modelos = (typeof _modelosOnt !== 'undefined' ? _modelosOnt : []);
    selModelo.innerHTML = '<option value="">Selecciona un modelo…</option>' +
      modelos.map(m=>`<option value="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
    selModelo.value = o.modelo || '';
  }
  document.getElementById('editOntSn').value  = o.sn||'';
  document.getElementById('editOntMac').value = o.mac_fmt||o.mac||'';
  document.getElementById('editOntCliente').value = o.cliente_nombre||''; _editOntClienteInit(o);
  document.getElementById('editOntDireccion').value = o.cliente_direccion||'';
  document.getElementById('editOntTecnico').value = o.tecnico_instalacion||''; document.getElementById('editOntTecnicoBuscar').value = o.tecnico_instalacion||'';
  document.getElementById('editOntFecha').value = (o.fecha_instalacion||'').split('T')[0]||'';
  cargarSedesEnModal(o.sede_actual||'');
  document.getElementById('editOntEstado').value = o.estado||'disponible';
  document.getElementById('editOntMotivoDano').value = o.motivo_dano||'';
  document.getElementById('editOntAlerta').className = 'alerta';
  editOntEstadoCambio();
  window._editOntCallback = () => { cargarTablaOntEnUso(); };
  document.getElementById('modalEditarOnt').classList.add('open');
}

async function cargarSedesEnModal(sedeActual=''){
  const sel = document.getElementById('editOntSede');
  if(!sel) return;
  try{
    const res = await fetch('api/sedes.php?action=listar',{credentials:'same-origin'});
    const data = await res.json();
    const sedes = Array.isArray(data) ? data : (data.sedes||[]);
    sel.innerHTML = '<option value="">— Sin sede asignada</option>' +
      sedes.map(s=>`<option value="${esc(s.nombre)}" ${s.nombre===sedeActual?'selected':''}>${esc(s.nombre)}</option>`).join('');
  }catch{
    sel.innerHTML = `<option value="${sedeActual}">${sedeActual||'— Sin sede'}</option>`;
  }
}

// Prepara el campo Cliente/Proyecto del editor de ONT: guarda el valor que ya
// tenía (para no borrarlo si es un nombre viejo escrito a mano) y precarga la lista.
function _editOntClienteInit(o){
  const inp = document.getElementById('editOntCliente');
  if(inp) inp.dataset.original = (o && o.cliente_nombre) ? String(o.cliente_nombre).trim() : '';
  const lst = document.getElementById('editOntClienteLista'); if(lst) lst.style.display='none';
  _cargarCatalogoProyectos();
}
async function confirmarEditarOnt(){
  const id       = document.getElementById('editOntId').value;
  const modelo   = document.getElementById('editOntModelo').value.trim();
  const sn       = document.getElementById('editOntSn').value.trim();
  const mac      = document.getElementById('editOntMac').value.trim();
  const cliente  = document.getElementById('editOntCliente').value.trim();
  const direccion= document.getElementById('editOntDireccion').value.trim();
  const tecnico  = document.getElementById('editOntTecnico').value.trim();
  const proveedor= document.getElementById('editOntProveedor').value.trim();
  const fecha    = document.getElementById('editOntFecha').value;
  const sede     = document.getElementById('editOntSede').value.trim();
  const estado   = document.getElementById('editOntEstado').value;
  const motivoDano = document.getElementById('editOntMotivoDano').value.trim();
  const alerta   = document.getElementById('editOntAlerta');
  alerta.className = 'alerta';
  if(!sn){ alerta.textContent='El SN es obligatorio.'; alerta.className='alerta error'; return; }
  if(!mac){ alerta.textContent='La MAC es obligatoria.'; alerta.className='alerta error'; return; }
  try{
    const res = await fetch('api/cajas.php?action=editar_ont_en_uso',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({id, modelo, sn, mac, cliente_nombre:cliente, cliente_direccion:direccion, tecnico_instalacion:tecnico, proveedor, fecha_instalacion:fecha, sede_actual:sede, estado, motivo_dano:motivoDano})
    });
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    cerrarModal('modalEditarOnt');
    toast('Registro actualizado ✓','success');
    if(window._editOntCallback){ window._editOntCallback(); window._editOntCallback=null; }
    else { cargarTablaOntEnUso(); }
  }catch(e){ alerta.textContent=e.message||'Error.'; alerta.className='alerta error'; }
}

function exportarInventarioOnt(){
  const datos = _ontInvData || [];
  if(!datos.length){ toast('No hay ONTs para exportar','error'); return; }
  const XLSX = window.XLSX;
  if(!XLSX){ toast('Error: librería Excel no cargada','error'); return; }
  const lblE={disponible:'Disponible',despachada:'Despachada',asignado:'Asignada',comodato:'Comodato',dañado:'No disponible',no_disponible:'No disponible',en_venta:'En venta',vendido:'Vendida'};
  const ws = XLSX.utils.json_to_sheet(datos.map(o=>({
    'ID': o.id,
    'Producto': o.modelo||'',
    'Proveedor': o.proveedor || o.id_proveedor_ext || '',
    'N° Serie': o.sn||'',
    'N° Mac': o.mac_fmt||o.mac||'',
    'Costo': o.costo||0,
    'F. Ingreso': (o.fecha_ingreso||'').split('T')[0]||'',
    'F. Salida': (o.fecha_salida||'').split('T')[0]||'',
    'Estado': lblE[o.estado]||o.estado||'',
    'Cliente': o.cliente_nombre||'',
    'Dirección': o.cliente_direccion||'',
    'Técnico': o.tecnico_instalacion||'',
    'Oficina dueña': o.tecnico_asignado||'',
    'Sede': o.sede_actual||'',
  })));
  const wb = XLSX.utils.book_new();
  ws['!cols']=[{wch:6},{wch:18},{wch:14},{wch:16},{wch:16},{wch:10},{wch:12},{wch:12},{wch:16},{wch:20},{wch:26},{wch:16},{wch:16},{wch:16}];
  XLSX.utils.book_append_sheet(wb, ws, 'ONTs');
  const fechaHoy = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `ont_inventario_${fechaHoy}.xlsx`);
}
function exportarMisOnt(){
  const data = _misOntData || [];
  if(!data.length){ toast('No hay ONTs para exportar','error'); return; }

  // Respeta el mismo filtro/pestaña que tengas seleccionada ahora mismo.
  const equivalentes = { despachada: ['despachada','disponible'], dañado: ['dañado','no_disponible'] };
  let datos = data;
  if(_meOntEstado==='asignado_mio'){
    datos = data.filter(o=>o.tecnico_instalador===sesion.usuario && o.estado!=='comodato' && o.asignacion_confirmada!=='rechazada');
  } else if(_meOntEstado==='instale_yo'){
    datos = data.filter(o=>o.tecnico_instalacion===sesion.usuario);
  } else if(_meOntEstado!=='todos'){
    const validos = equivalentes[_meOntEstado] || [_meOntEstado];
    datos = data.filter(o=>validos.includes(o.estado));
  }
  const qExp = (document.getElementById('meOntBuscar')?.value||'').toLowerCase().trim();
  if(qExp){
    datos = datos.filter(o=>
      (o.sn||'').toLowerCase().includes(qExp) ||
      (o.mac||'').toLowerCase().includes(qExp) ||
      (o.mac_fmt||'').toLowerCase().includes(qExp) ||
      (o.cliente_nombre||'').toLowerCase().includes(qExp)
    );
  }
  const desdeExp = document.getElementById('meOntFiltroDesde')?.value || '';
  const hastaExp = document.getElementById('meOntFiltroHasta')?.value || '';
  if(desdeExp || hastaExp){
    datos = datos.filter(o=>{
      const f = (o.fecha_instalacion||o.fecha_envio||o.fecha||'').split('T')[0];
      if(!f) return false;
      if(desdeExp && f < desdeExp) return false;
      if(hastaExp && f > hastaExp) return false;
      return true;
    });
  }

  const XLSX = window.XLSX;
  if(!XLSX){ toast('Error: librería Excel no cargada','error'); return; }
  const lblE={disponible:'Disponible para instalar',despachada:'Disponible para instalar',comodato:'Instalada',ocupado:'Ocupada',dañado:'Dañada',no_disponible:'Dañada'};
  const ws = XLSX.utils.json_to_sheet(datos.map(o=>({
    'MAC': o.mac_fmt||o.mac||'',
    'SN': o.sn||'',
    'Modelo': o.modelo||'',
    'Estado': lblE[o.estado]||o.estado||'',
    'Oficina dueña': o.tecnico_asignado||'',
    'Técnico instalador': o.tecnico_instalacion||o.tecnico_instalador||'',
    'Cliente': o.cliente_nombre||'',
    'Dirección': o.cliente_direccion||'',
    'Fecha': (o.fecha_instalacion||o.fecha_envio||o.fecha||'').split('T')[0]||'',
  })));
  const wb = XLSX.utils.book_new();
  ws['!cols']=[{wch:16},{wch:16},{wch:16},{wch:22},{wch:18},{wch:18},{wch:20},{wch:26},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws, 'Mis ONTs');
  const fechaHoy = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `mis_onts_${fechaHoy}.xlsx`);
}
function eliminarOntEnUso(id, mac){ _eliminarEquipo('ont', id, mac); }

function exportarOntEnUso(){
  const qMac  = (document.getElementById('filtroOntUsoMac')?.value||'').toLowerCase().trim();
  const qSn   = (document.getElementById('filtroOntUsoSn')?.value||'').toLowerCase().trim();
  const sede  = document.getElementById('filtroOntUsoSede')?.value||'';
  const desde = document.getElementById('filtroOntUsoDesde')?.value||'';
  const hasta = document.getElementById('filtroOntUsoHasta')?.value||'';

  let datos = _ontEnUsoData.filter(o=>{
    if(qMac && !(o.mac||'').toLowerCase().includes(qMac)) return false;
    if(qSn  && !(o.sn||'').toLowerCase().includes(qSn)) return false;
    if(sede && (o.sede_actual||'').toUpperCase() !== sede.toUpperCase()) return false;
    if(desde && o.fecha_instalacion && o.fecha_instalacion < desde) return false;
    if(hasta && o.fecha_instalacion && o.fecha_instalacion > hasta+'T23:59:59') return false;
    return true;
  });

  const XLSX = window.XLSX;
  if(!XLSX){ toast('Error: librería Excel no cargada','error'); return; }
  const ws = XLSX.utils.json_to_sheet(datos.map(o=>({
    'MAC': o.mac,
    'SN': o.sn,
    'Sede': o.sede_actual||'',
    'Cliente': o.cliente_nombre||'',
    'Dirección': o.cliente_direccion||'',
    'Técnico': o.tecnico_instalacion||'',
    'Fecha Instalación': (o.fecha_instalacion||'').split('T')[0]||'',
    'Estado': o.estado||''
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ONTs en uso');
  XLSX.writeFile(wb, `onts_en_uso_${new Date().toISOString().split('T')[0]}.xlsx`);
  toast(`${datos.length} registros exportados ✓`,'success');
}


async function abrirRegistrarOntEnUso(){
  document.getElementById('ontEnUsoMac').value = '';
  document.getElementById('ontEnUsoSn').value = '';
  document.getElementById('ontEnUsoCliente').value = '';
  document.getElementById('ontEnUsoDireccion').value = '';
  document.getElementById('ontEnUsoFecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('ontEnUsoAlerta').className = 'alerta';

  // Cargar sedes
  const selSede = document.getElementById('ontEnUsoSede');
  if(selSede){
    const sedes = getSedesActivas();
    selSede.innerHTML = '<option value="">Seleccionar sede...</option>' +
      sedes.map(s=>`<option value="${esc(s.nombre)}">${esc(s.nombre)}</option>`).join('');
  }

  // Limpiar técnico
  limpiarTecEnUso();
  _tecnicosEnUso = [];
  const listaTec = document.getElementById('ontEnUsoListaTec');
  if(listaTec){ listaTec.innerHTML='<div class="!p-[12px] !text-center !text-[#94A3B8] !text-[13px]">Cargando...</div>'; listaTec.style.display='block'; }
  fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'})
    .then(r=>r.json())
    .then(usuarios=>{
      _tecnicosEnUso = Array.isArray(usuarios) ? usuarios : [];
      filtrarTecnicosEnUso();
    });

  document.getElementById('modalRegistrarOntEnUso').classList.add('open');
  setTimeout(()=>document.getElementById('ontEnUsoMac')?.focus(), 200);
}

async function confirmarRegistrarOntEnUso(){
  const mac      = (document.getElementById('ontEnUsoMac')?.value||'').replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
  const sn       = (document.getElementById('ontEnUsoSn')?.value||'').trim().toUpperCase();
  const sede     = document.getElementById('ontEnUsoSede')?.value||'';
  const cliente  = document.getElementById('ontEnUsoCliente')?.value.trim()||'';
  const direccion= document.getElementById('ontEnUsoDireccion')?.value.trim()||'';
  const tecnico  = document.getElementById('ontEnUsoTecExternoDiv')?.style.display !== 'none'
    ? (document.getElementById('ontEnUsoTecExterno')?.value.trim()||'')
    : (document.getElementById('ontEnUsoTecnico')?.value||'');
  const fecha    = document.getElementById('ontEnUsoFecha')?.value||'';
  const alerta   = document.getElementById('ontEnUsoAlerta');
  alerta.className = 'alerta';

  if(mac.length===0){ alerta.textContent='Escribe la MAC.'; alerta.className='alerta error'; return; }
  if(!sn)     { alerta.textContent='El SN es obligatorio.'; alerta.className='alerta error'; return; }
  if(!sede)   { alerta.textContent='Selecciona la sede.'; alerta.className='alerta error'; return; }
  if(!cliente){ alerta.textContent='El nombre del cliente es obligatorio.'; alerta.className='alerta error'; return; }
  if(!tecnico){ alerta.textContent='Selecciona el técnico.'; alerta.className='alerta error'; return; }
  if(!fecha)  { alerta.textContent='La fecha es obligatoria.'; alerta.className='alerta error'; return; }

  try{
    const res = await fetch('api/cajas.php?action=registrar_ont_en_uso', {
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({mac, sn, sede, cliente_nombre:cliente, cliente_direccion:direccion, tecnico_instalacion:tecnico, fecha_instalacion:fecha})
    });
    const data = await res.json();
    if(data.error) throw new Error(data.error);
    cerrarModal('modalRegistrarOntEnUso');
    toast('ONT registrada en comodato ✓','success');
    cargarTablaOntEnUso();
  }catch(e){ alerta.textContent = e.message||'Error al registrar.'; alerta.className='alerta error'; }
}


function ontEstadoCambio(){
  const valor = document.getElementById('ontEstadoInput')?.value;
  const esComodato = valor === 'comodato';
  const esDanado = valor === 'no_disponible';
  const campos = document.getElementById('ontCamposInstalada');
  if(campos) campos.style.display = esComodato ? '' : 'none';
  const campoDano = document.getElementById('ontCampoDanado');
  if(campoDano) campoDano.style.display = esDanado ? '' : 'none';

  if(esComodato){
    const sel = document.getElementById('ontTecnicoInstalacion');
    if(sel && sel.options.length <= 1){
      fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'})
        .then(r=>r.json())
        .then(usuarios=>{
          const activos = Array.isArray(usuarios) ? usuarios.filter(u=>['tecnico','persona'].includes(u.rol)) : [];
          sel.innerHTML = '<option value="">Seleccionar técnico...</option>' +
            activos.map(u=>`<option value="${esc(u.usuario)}">${esc(u.nombre||u.usuario)} ${esc(u.apellido||'')} (@${esc(u.usuario)})</option>`).join('');
        });
    }
    const fecha = document.getElementById('ontFechaInstalacion');
    if(fecha && !fecha.value) fecha.value = new Date().toISOString().split('T')[0];
  }
}


async function abrirNuevoOnt(){
  if(!(_modelosOnt&&_modelosOnt.length)){ try{ await cargarModelosOnt(); }catch(e){} }
  if(typeof _llenarSelectsModeloOnt==='function') _llenarSelectsModeloOnt();
  ['ontMacInput','ontSnInput','ontClienteNombre','ontClienteDireccion','ontFechaInstalacion','ontMotivoDano'].forEach(id=>{
    const el=document.getElementById(id); if(el){el.value='';el.style.borderColor='';el.style.boxShadow='';}
  });
  ['ontMacMsg','ontSnMsg','ontMacIcono','ontSnIcono','ontEstadoReg'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.style.display='none';
  });
  const estadoSel = document.getElementById('ontEstadoInput'); if(estadoSel) estadoSel.value='disponible';
  const campos = document.getElementById('ontCamposInstalada'); if(campos) campos.style.display='none';
  const campoDano = document.getElementById('ontCampoDanado'); if(campoDano) campoDano.style.display='none';
  const lista = document.getElementById('ontListaCajaActual'); if(lista) lista.style.display='none';
  const fechaIng = document.getElementById('ontFechaIngreso'); if(fechaIng) fechaIng.value = new Date().toISOString().split('T')[0];
  const fechaSal = document.getElementById('ontFechaSalida'); if(fechaSal) fechaSal.value = '';
  const _lstON = document.getElementById('ontClienteNombreLista'); if(_lstON) _lstON.style.display='none';
  _cargarCatalogoProyectos();
  _actualizarBtnOntAgregar();
  document.getElementById('modalNuevoOnt')?.classList.add('open');
  setTimeout(()=>document.getElementById('ontMacInput')?.focus(),200);
}

async function ontAgregarUnidad(){
  const macRaw = (document.getElementById('ontMacInput')?.value||'').replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
  const sn     = (document.getElementById('ontSnInput')?.value||'').trim().toUpperCase();
  const estado = document.getElementById('ontEstadoReg');
  const yaInstalada = document.getElementById('ontEstadoInput')?.value === 'comodato';
  const esDanado     = document.getElementById('ontEstadoInput')?.value === 'no_disponible';

  if(macRaw.length===0){ toast('Escribe la MAC','error'); return; }
  if(!sn){ toast('El SN es obligatorio','error'); return; }

  // Validar campos de instalación si está marcado
  let clienteNombre='', clienteDireccion='', tecnico='', fechaInst='';
  if(yaInstalada){
    clienteNombre   = document.getElementById('ontClienteNombre')?.value.trim()||'';
    clienteDireccion= document.getElementById('ontClienteDireccion')?.value.trim()||'';
    tecnico         = document.getElementById('ontTecnicoInstalacion')?.value||'';
    fechaInst       = document.getElementById('ontFechaInstalacion')?.value||'';
    if(!clienteNombre){ toast('Elige el Cliente/Proyecto — es obligatorio','error'); return; }
    if(!tecnico){ toast('Selecciona el técnico que instaló','error'); return; }
    if(!fechaInst){ toast('La fecha de instalación es obligatoria','error'); return; }
  }

  let motivoDano = '';
  if(esDanado){
    motivoDano = document.getElementById('ontMotivoDano')?.value.trim()||'';
    if(!motivoDano){ toast('Escribe el motivo del daño','error'); return; }
  }

  const modelo = (document.getElementById('ontModeloInput')?.value||'').trim();
  if(!modelo){ toast('Selecciona el modelo de la ONT','error'); return; }

  const fechaIngreso = document.getElementById('ontFechaIngreso')?.value || '';
  if(!fechaIngreso){ toast('La fecha de ingreso es obligatoria','error'); return; }

  const btn=document.getElementById('btnOntAgregar');
  if(btn){btn.disabled=true;btn.style.opacity='0.6';}

  // Campos nuevos: estado y fecha de salida
  const estadoSel    = document.getElementById('ontEstadoInput')?.value || 'disponible';
  const fechaSalida  = document.getElementById('ontFechaSalida')?.value || '';

  try{
    const body = {caja_id:_ontCajaId, mac:macRaw, sn, modelo, estado:estadoSel, fecha_ingreso:fechaIngreso, fecha_salida:fechaSalida};
    if(yaInstalada){
      body.ya_instalada = true;
      body.cliente_nombre = clienteNombre;
      body.cliente_direccion = clienteDireccion;
      body.tecnico_instalacion = tecnico;
      body.fecha_instalacion = fechaInst;
    }
    if(esDanado){
      body.motivo_dano = motivoDano;
    }
    const res = await fetch('api/cajas.php?action=agregar_ont',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(body)
    });
    const data = await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error al registrar');

    toast(`✓ ONT registrada — MAC: ${data.mac_fmt}`, 'success');
    _ontCajaId = data.caja_id || _ontCajaId;

    // Cerrar el modal y actualizar la tabla de inventario, sin recargar la página
    cerrarModal('modalNuevoOnt');
    await Promise.all([_recargarProductos(), renderInventarioOnt()]);
    renderStats();
    try{ if(typeof cargarMisOnt==='function' && document.getElementById('panel-misequipos')?.classList.contains('active')) cargarMisOnt(); }catch(_){}

  }catch(e){
    if(estado){
      estado.style.display='';
      estado.style.background='#FCEBEB';
      estado.style.color='#B91C1C';
      estado.textContent=`⚠ ${e.message}`;
    }
    toast(e.message,'error');
  }finally{
    if(btn){ btn.disabled=false; _actualizarBtnOntAgregar(); }
  }
}

/* ── Modal crear caja ── */



/* ── INVENTARIO ONT ── */
let _ontInvData = [];
async function cargarInventarioOnt(){
  // Poblar el filtro de categorías con los modelos existentes (solo la primera vez)
  const selModelo = document.getElementById('ontInvFiltroModelo');
  if(selModelo && selModelo.options.length<=1){
    const modelos = (typeof _modelosOnt !== 'undefined' ? _modelosOnt : []);
    selModelo.innerHTML = '<option value="">Todas las categorías</option>' +
      modelos.map(m=>`<option value="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
  }
  renderInventarioOnt();
}

let _ontInvDebounce = null;
async function renderInventarioOnt(){
  clearTimeout(_ontInvDebounce);
  _ontInvDebounce = setTimeout(async ()=>{
    const grid = document.getElementById('ontInventarioGrid');
    if(!grid) return;
    grid.innerHTML = '<div class="!text-[#94A3B8] !text-[13px] !text-center !p-[24px]">Cargando…</div>';

    const estado = document.getElementById('ontInvFiltroEstado')?.value || '';
    const modelo = document.getElementById('ontInvFiltroModelo')?.value || '';
    const q      = document.getElementById('ontInvBuscar')?.value.trim() || '';
    const usuario= document.getElementById('ontInvFiltroUsuario')?.value.trim() || '';
    const sedeF  = document.getElementById('ontInvFiltroSede')?.value.trim() || '';
    const propiedad = document.getElementById('ontInvFiltroPropiedad')?.value || '';
    const desde  = document.getElementById('ontInvFiltroDesde')?.value || '';
    const hasta  = document.getElementById('ontInvFiltroHasta')?.value || '';

    try{
      const params = new URLSearchParams();
      if(estado) params.set('estado', estado);
      if(modelo) params.set('modelo', modelo);
      if(q) params.set('q', q);
      if(usuario) params.set('usuario', usuario);
      if(sedeF) params.set('sede', sedeF);
      if(propiedad) params.set('propiedad', propiedad);
      if(desde) params.set('desde', desde);
      if(hasta) params.set('hasta', hasta);
      const res  = await fetch('api/cajas.php?action=listar_onts_todas&'+params.toString(), {credentials:'same-origin'});
      const data = await res.json();
      _ontInvData = Array.isArray(data) ? data : [];
    }catch(e){
      grid.innerHTML = `<div class="!text-[#E24B4A] !text-[13px] !p-[16px]">${e.message}</div>`;
      return;
    }

    const contador = document.getElementById('ontInvContador');
    if(contador) contador.textContent = `${_ontInvData.length} ONT(s)`;

    if(!_ontInvData.length){
      grid.innerHTML = `<div class="!text-center !p-[32px] !text-[#94A3B8] !text-[13px]">No hay ONTs con esos filtros.</div>`;
      return;
    }

    const clsE = {disponible:'badge-ok',despachada:'badge-brand',asignado:'badge-brand',comodato:'badge-purple',dañado:'badge-danger',no_disponible:'badge-danger'};
    const lblE = {disponible:'DISPONIBLE',despachada:'DESPACHADA',asignado:'ASIGNADA',comodato:'COMODATO',dañado:'NO DISPONIBLE',no_disponible:'NO DISPONIBLE',en_venta:'EN VENTA',vendido:'VENDIDA'};

    // Resaltado amarillo de la coincidencia de búsqueda (SN, MAC, modelo, cliente)
    const hlInv = (txt) => {
      txt = String(txt==null?'':txt);
      if(!q || !txt) return esc(txt);
      const idx = txt.toLowerCase().indexOf(q.toLowerCase());
      if(idx<0) return esc(txt);
      return esc(txt.slice(0,idx))
        + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx+q.length))}</mark>`
        + esc(txt.slice(idx+q.length));
    };

    // Resaltado amarillo de la coincidencia del filtro de usuario
    const hlUsr = (txt) => {
      txt = String(txt==null?'':txt);
      if(!usuario || !txt) return esc(txt);
      const idx = txt.toLowerCase().indexOf(usuario.toLowerCase());
      if(idx<0) return esc(txt);
      return esc(txt.slice(0,idx))
        + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx+usuario.length))}</mark>`
        + esc(txt.slice(idx+usuario.length));
    };

    // Resaltado amarillo de la coincidencia del filtro de sede
    const hlSede = (txt) => {
      txt = String(txt==null?'':txt);
      if(!sedeF || !txt) return esc(txt);
      const idx = txt.toLowerCase().indexOf(sedeF.toLowerCase());
      if(idx<0) return esc(txt);
      return esc(txt.slice(0,idx))
        + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx+sedeF.length))}</mark>`
        + esc(txt.slice(idx+sedeF.length));
    };

    grid.innerHTML = `<div class="!overflow-x-auto ![background:white] ![border:1px_solid_#E2E8F0] !rounded-[12px]"><table class="!w-[100%] ![border-collapse:collapse] !text-[13px]">
      <thead><tr style="background:#F8FAFC;text-align:left;">
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">ID</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Producto</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Proveedor</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Nº Serie</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Nº Mac</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Costo</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">F. Ingreso</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">F. Salida</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Estado</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Cliente</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Oficina / Técnico</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Sede</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${_ontInvData.map((o,_idx)=>`
          <tr style="border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#FAFBFC'" onmouseout="this.style.background='white'">
            <td class="!p-[8px_10px] !text-[#64748B]">${_idx+1}</td>
            <td class="!p-[8px_10px] !font-semibold">${hlInv(o.modelo||'—')}</td>
            <td class="!p-[8px_10px] !text-[#64748B]">${hlInv(o.proveedor || o.id_proveedor_ext || '—')}</td>
            <td class="!p-[8px_10px] ![font-family:monospace]">${hlInv(o.sn||'—')}</td>
            <td class="!p-[8px_10px] ![font-family:monospace] !text-[12px]">${hlInv(o.mac_fmt||o.mac||'—')}</td>
            <td class="!p-[8px_10px] !whitespace-nowrap">COL$ ${o.costo?Number(o.costo).toLocaleString('es-CO'):'0'}</td>
            <td class="!p-[8px_10px] !text-[#64748B] !text-[12px] !whitespace-nowrap">${o.fecha_ingreso?new Date(o.fecha_ingreso).toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}):'—'}</td>
            <td class="!p-[8px_10px] !text-[#64748B] !text-[12px] !whitespace-nowrap">${o.fecha_salida?new Date(o.fecha_salida).toLocaleDateString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric'}):'<span class="!text-[#CBD5E1]">—</span>'}</td>
            <td class="!p-[8px_10px]"><span class="badge ${clsE[o.estado]||'badge-gray'} !text-[10px]" ${o.motivo_dano?`title="${esc(o.motivo_dano)}"`:''}>${lblE[o.estado]||(o.estado||'—').toUpperCase()}</span></td>
            <td class="!p-[8px_10px]">${hlInv(o.cliente_nombre||'—')}</td>
            <td class="!p-[8px_10px] !text-[#64748B] !text-[12px]">
              ${o.tecnico_asignado?`<div>🏢 ${hlUsr(o.tecnico_asignado)}</div>`:'<span class="!text-[#CBD5E1]">—</span>'}
              ${o.estado==='comodato'&&o.tecnico_instalacion?`<div class="!text-[#5B21B6]">👤 ${hlUsr(o.tecnico_instalacion)}</div>`:''}
            </td>
            <td class="!p-[8px_10px] !text-[#94A3B8] !text-[12px]">${hlSede(o.sede_actual||'—')}</td>
            <td class="!p-[8px_10px] !whitespace-nowrap">${_accionesMenu('ont'+o.id, `${(o.estado==='disponible'||o.estado==='despachada')?`<button onclick="abrirVenderEquipo('ont',${o.id},'${esc('ONT '+(o.modelo||'')+' · SN '+(o.sn||o.mac||o.id))}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]" title="Vender esta ONT">💰</button> `:''}<button onclick="editarOntInventario(${o.id})" class="btn-sm ![background:#E6F1FB] !text-[#0C6EDE]" title="Editar">✏️</button> <button onclick="verTrazabilidadOnt('${esc(o.sn||o.mac||'')}')" class="btn-sm ![background:#F1F5F9] !text-[#475569]" title="Ver trazabilidad">🔎</button> ${(!o.tecnico_asignado&&(sesion?.rol==='superadmin'||sesion?.rol==='distribuidor'))?`<button onclick="eliminarOntEnUso(${o.id},'${esc(o.mac||o.sn||'')}')" class="btn-sm ![background:#FEF2F2] !text-[#B91C1C]" title="Eliminar">🗑</button>`:''}`)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>`;
  }, 250);
}

function _filtrarEditOntProveedor(){
  const inp = document.getElementById('editOntProveedorBuscar');
  const hidden = document.getElementById('editOntProveedor');
  const q = (inp?.value||'').toLowerCase().trim();
  if(hidden) hidden.value = inp?.value||'';

  const lista = document.getElementById('editOntProveedorLista');
  if(!lista) return;
  const proveedores = (typeof _proveedores !== 'undefined' ? _proveedores : []) || [];
  const filtrados = proveedores.filter(p=>!q || (p.nombre||'').toLowerCase().includes(q));
  const hl = (txt) => {
    txt = String(txt||'');
    if(!q || !txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx+q.length))}</mark>`
      + esc(txt.slice(idx+q.length));
  };
  lista.innerHTML = filtrados.length ? filtrados.map(p=>`
    <div onclick="_seleccionarEditOntProveedor('${esc(p.nombre).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
      ${hl(p.nombre)}
    </div>`
  ).join('') : '<div class="!p-[10px_12px] !text-[#94A3B8] !text-[12px] !text-center">Sin coincidencias — puedes escribir el nombre igual.</div>';
  lista.style.display='block';
}
function _seleccionarEditOntProveedor(nombre){
  document.getElementById('editOntProveedorBuscar').value = nombre;
  document.getElementById('editOntProveedor').value = nombre;
  document.getElementById('editOntProveedorLista').style.display='none';
}
document.addEventListener('click', function(e){
  const cont=document.getElementById('editOntProveedorLista');
  const inp=document.getElementById('editOntProveedorBuscar');
  if(cont && inp && !inp.contains(e.target) && !cont.contains(e.target)) cont.style.display='none';
});
async function _filtrarEditOntTecnico(){
  const inp = document.getElementById('editOntTecnicoBuscar');
  const hidden = document.getElementById('editOntTecnico');
  const q = (inp?.value||'').toLowerCase().trim();
  // Lo que se escribe queda como valor válido de una vez (permite tanto
  // elegir de la lista como escribir un nombre libre que no esté ahí).
  if(hidden) hidden.value = inp?.value||'';

  const lista = document.getElementById('editOntTecnicoLista');
  if(!lista) return;
  if(!window._editOntTecCache){
    try{
      const r = await fetch('api/usuarios.php?action=listar_activos_basico',{credentials:'same-origin'});
      const d = await r.json();
      window._editOntTecCache = Array.isArray(d) ? d : [];
    }catch(e){ window._editOntTecCache = []; }
  }
  const tecnicos = window._editOntTecCache.filter(u=>u.rol==='tecnico'||u.rol==='persona');
  const filtrados = tecnicos.filter(t=>{
    const nombreCompleto = `${t.nombre||''} ${t.apellido||''}`.trim() || t.usuario;
    return !q || nombreCompleto.toLowerCase().includes(q) || t.usuario.toLowerCase().includes(q);
  });
  const hl = (txt) => {
    txt = String(txt||'');
    if(!q || !txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx+q.length))}</mark>`
      + esc(txt.slice(idx+q.length));
  };
  lista.innerHTML = filtrados.length ? filtrados.map(t=>{
    const nombreCompleto = `${t.nombre||''} ${t.apellido||''}`.trim() || t.usuario;
    return `<div onclick="_seleccionarEditOntTecnico('${esc(t.usuario).replace(/'/g,"\\'")}','${esc(nombreCompleto).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
      <div class="!font-semibold">${hl(nombreCompleto)}</div>
      <div class="!text-[11px] !text-[#94A3B8]">@${hl(t.usuario)}</div>
    </div>`;
  }).join('') : '<div class="!p-[10px_12px] !text-[#94A3B8] !text-[12px] !text-center">Sin coincidencias — puedes escribir el nombre igual.</div>';
  lista.style.display='block';
}
function _seleccionarEditOntTecnico(usuario, nombreCompleto){
  document.getElementById('editOntTecnicoBuscar').value = nombreCompleto || usuario;
  document.getElementById('editOntTecnico').value = usuario;
  document.getElementById('editOntTecnicoLista').style.display='none';
}
document.addEventListener('click', function(e){
  const cont=document.getElementById('editOntTecnicoLista');
  const inp=document.getElementById('editOntTecnicoBuscar');
  if(cont && inp && !inp.contains(e.target) && !cont.contains(e.target)) cont.style.display='none';
});

function editOntEstadoCambio(){
  const valor = document.getElementById('editOntEstado')?.value;
  // La oficina no pone comodato directo: elige a la persona y la ONT pasa a comodato cuando esa persona acepte e instale.
  if(sesion?.rol==='municipio' && valor==='comodato'){
    const oid = document.getElementById('editOntId')?.value;
    const o = (typeof _misOntData!=='undefined' && _misOntData.find(x=>String(x.id)===String(oid))) || (typeof _histOntData!=='undefined' && _histOntData.find(x=>String(x.id)===String(oid)));
    if(o && o.estado!=='comodato'){
      document.getElementById('editOntEstado').value = o.estado||'disponible';
      cerrarModal('modalEditarOnt');
      toast('Elige quién la instalará: la ONT queda en comodato cuando esa persona acepte e instale.','info');
      _abrirAsignarOntTecnico(oid, (o.sn||o.mac||'ONT'));
      return;
    }
  }
  const esComodato = valor === 'comodato' || valor === 'ocupado';
  const esDanado   = valor === 'dañado' || valor === 'no_disponible';
  const campos = document.getElementById('editOntCamposInstalada');
  if(campos) campos.style.display = esComodato ? '' : 'none';
  const campoDano = document.getElementById('editOntCampoDanado');
  if(campoDano) campoDano.style.display = esDanado ? '' : 'none';
}

async function editarOntInventario(id){
  const o = _ontInvData.find(x=>String(x.id)===String(id));
  if(!o){toast("ONT no encontrada","error");return;}
  document.getElementById('editOntId').value = id;
  // Llenar el select de modelo con el catálogo (Categorías) + preseleccionar el actual
  const selModelo = document.getElementById('editOntModelo');
  if(selModelo){
    const modelos = (typeof _modelosOnt !== 'undefined' ? _modelosOnt : []);
    selModelo.innerHTML = '<option value="">Selecciona un modelo…</option>' +
      modelos.map(m=>`<option value="${esc(m.nombre)}">${esc(m.nombre)}</option>`).join('');
    selModelo.value = o.modelo || '';
  }
  document.getElementById('editOntSn').value  = o.sn||'';
  document.getElementById('editOntMac').value = o.mac_fmt||o.mac||'';
  document.getElementById('editOntCliente').value   = o.cliente_nombre||''; _editOntClienteInit(o);
  document.getElementById('editOntDireccion').value = o.cliente_direccion||'';
  document.getElementById('editOntTecnico').value   = o.tecnico_instalacion||''; document.getElementById('editOntTecnicoBuscar').value = o.tecnico_instalacion||'';
  // Siempre asegurar que la lista de proveedores esté cargada ANTES de
  // abrir el modal — si no, el buscador de proveedor sale vacío aunque sí
  // tengas proveedores creados, y no puedes elegir ninguno.
  if(!(typeof _proveedores !== 'undefined' && _proveedores && _proveedores.length)){
    try{ await cargarProveedores(); }catch(e){}
  }
  let _provResuelto = o.proveedor || '';
  if(!_provResuelto && o.id_proveedor_ext){
    // Ya tenía el número (id_proveedor_ext) de una importación vieja, antes
    // de guardar el nombre — se busca en vivo con los proveedores actuales.
    const match = (typeof _proveedores !== 'undefined' ? _proveedores : []).find(p=>String(p.id_mikrowisp||'')===String(o.id_proveedor_ext));
    if(match) _provResuelto = match.nombre;
  }
  document.getElementById('editOntProveedor').value = _provResuelto; document.getElementById('editOntProveedorBuscar').value = _provResuelto;
  document.getElementById('editOntFecha').value     = (o.fecha_instalacion||'').split('T')[0]||'';
  cargarSedesEnModal(o.sede_actual||'');
  document.getElementById('editOntEstado').value     = o.estado||'disponible';
  document.getElementById('editOntMotivoDano').value = o.motivo_dano||'';
  document.getElementById('editOntAlerta').className = 'alerta';
  editOntEstadoCambio();
  window._editOntCallback = () => { renderInventarioOnt(); };
  document.getElementById('modalEditarOnt').classList.add('open');
}

// Cache de ONTs por caja + selección, para búsqueda y envío en lote.
window._ontCajaCache = window._ontCajaCache || {};   // { cajaId: [onts...] }
window._ontSeleccion = window._ontSeleccion || {};   // { cajaId: Set(ontId) }



// Resalta el texto buscado dentro de un valor (sobre texto ya escapado).
function _resaltar(texto, q){
  const safe = esc(texto||'');
  if(!q) return safe;
  const qEsc = q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return safe.replace(new RegExp(`(${qEsc})`,'ig'), '<mark class="![background:#FEF08A] ![color:inherit] !p-[0_1px] !rounded-[2px]">$1</mark>');
}













/* ── Enviar varias ONTs en lote ── */
let _ontLoteCajaId = null;




/* ── Modal enviar ONT ── */

async function confirmarEnviarOnt(){
  const destino = document.getElementById('enviarOntDestino')?.value;
  if(!destino){ toast('Selecciona un municipio destino','error'); return; }
  if(!_ontIdEnviar){ toast('Error: ONT no seleccionada','error'); return; }
  try{
    const res = await fetch('api/cajas.php?action=enviar_ont',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ont_id:_ontIdEnviar, destino})
    });
    const data = await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error');
    cerrarModal('modalEnviarOnt');
    toast(`ONT enviada a ${destino} ✓`,'success');
    await Promise.all([_recargarProductos(), _recargarHistorial()]);
    renderStats();
    cargarInventarioOnt();
  }catch(e){ toast(e.message,'error'); }
}

/* ─ Funciones antiguas mantenidas por compatibilidad ─ */
function limpiarSesionEscaneo(){ iniciarPanelEscaneo(); }
function procesarEscaneo(){}
function confirmarLoteEscaneo(){}
function seleccionarProductoEscaneo(){}
function _renderEscaneoTabla(){}
function quitarUnidadEscaneo(){}