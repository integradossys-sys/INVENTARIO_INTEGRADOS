/* ════════════════════════════════════════════════
   MIS PEDIDOS (municipio / técnico)
════════════════════════════════════════════════ */
// Nota del pedido sin los sellos "[Solicitud · usuario]"; las decisiones (Rechazó/Aprobó…) se muestran aparte como motivo.
function _notaSolicitudPedAgrup(nota){
  return String(nota||'').split('\n').map(l=>l.trim()).filter(Boolean)
    .filter(l=>!/^\[(Rechaz|Aprob|Escal|Gestion)/i.test(l))
    .map(l=>l.replace(/^\[[^\]]*\]\s*/,'')).filter(Boolean).join(' · ');
}
// Motivo de la decisión (rechazo / aprobación parcial): sello en la nota del pedido o, si no, el motivo guardado en cada producto.
function _motivoPedAgrupLocal(p){
  if(!p) return '';
  const lineas = String(p.nota||'').split('\n');
  for(let i=lineas.length-1;i>=0;i--){
    const m = lineas[i].trim().match(/^\[(Rechaz[oó]|Aprob[oó] parcialmente)[^\]]*\]\s*(.+)$/i);
    if(m) return m[2].trim();
  }
  const its = (p.items||[]).filter(i=>i.motivo && String(i.estado||'').startsWith('rechaz'));
  const uniq = [...new Set(its.map(i=>String(i.motivo).trim()))];
  if(uniq.length===1) return uniq[0];
  if(uniq.length>1) return its.map(i=>(i.nombre||i.ref||'')+': '+i.motivo).join(' · ');
  return '';
}
function renderMisPedidos(){
  const tbody=document.getElementById('tablaMisPedidos');if(!tbody)return;
  const sedes=sesion.sedes||[sesion.sede];

  // Pedidos individuales (tabla vieja) — por persona, sin importar la sede
  // actual (si cambia de sede, sus pedidos viejos le siguen apareciendo)
  const pedidosIndiv = getPedidosMun().filter(p=>p.solicitado_por===sesion.usuario||sedes.includes(p.municipio));

  // Pedidos agrupados del municipio
  const pedidosAgrup = getPedidosAgrupados()
    .filter(p=>sedes.includes(p.destino)||p.solicitado_por===sesion.usuario)
    .map(p=>({
      id: p.id,
      solicitado_por: p.solicitado_por,
      ref: '📦',
      nombre: `Pedido agrupado — ${p.total_items||'?'} productos`,
      cantidad: p.total_items||0,
      unidadPedido: 'pedido',
      estado: p.estado,
      justificacion: _notaSolicitudPedAgrup(p.nota)||'Pedido múltiple',
      motivo: (['rechazado','rechazada','parcial'].includes(p.estado) ? _motivoPedAgrupLocal(p) : ''),
      fecha: p.fecha,
      esPedidoAgrupado: true,
      items: p.items||[],
    }));

  let pedidos = [...pedidosIndiv, ...pedidosAgrup]
    .sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  const cntP=pedidos.filter(p=>p.estado==='pendiente').length,cntR=pedidos.filter(p=>p.estado==='rechazado').length;
  const e1=document.getElementById('cntMisPedPend'),e2=document.getElementById('cntMisPedRech');
  if(e1)e1.textContent=cntP||'';if(e2)e2.textContent=cntR||'';
  const qP=(document.getElementById('filtroMisPedProducto')?.value||'').toLowerCase();
  if(qP)pedidos=pedidos.filter(p=>(p.nombre||'').toLowerCase().includes(qP));
  if(tabMisPed!=='todos')pedidos=pedidos.filter(p=>p.estado===tabMisPed);
  if(!pedidos.length){tbody.innerHTML=`<tr><td class="!p-[32px] !text-center !text-[#94A3B8] !text-[13px]" colspan="7">Sin pedidos en esta categoría.</td></tr>`;return;}
  const ecls={pendiente:'badge-warn',en_gestion:'badge-brand',atendido:'badge-ok',aprobado:'badge-ok',parcial:'badge-warn',rechazado:'badge-danger'};
  const elbl={pendiente:'Pendiente',en_gestion:'En gestión',atendido:'Aprobada ✓',aprobado:'Aprobada ✓',parcial:'Aprobada parcial',rechazado:'Rechazado'};
  tbody.innerHTML=pedidos.map(s=>{
    if(s.esPedidoAgrupado){
      const totalCant = (s.items||[]).reduce((a,i)=>a+parseInt(i.cantidad||0),0);
      const numItems  = s.items?.length || s.total_items || '?';
      const btnDetalle = `<button onclick="verDetallePedidoAgrupado('${s.id}')" class="btn-sm ![background:#E0F6FF] !text-[#0369A1] !mt-[4px]">🔍 Ver detalle</button>`;
      // Botones de gestión según estado y rol
      let btnGestion = '';
      if((s.estado==='pendiente'||s.estado==='en_gestion') && (sesion.rol==='superadmin'||tienePermiso('aprobar_pedidos')))
        btnGestion = `<button onclick="abrirGestionPedido('${s.id}')" class="btn-sm ![background:#EAF3DE] !text-[#166534] !mt-[4px]">📋 Gestionar</button>`;
      return `<tr class="fade-row">
        <td>
          <div class="!font-bold !text-[13px] !text-[#7C3AED]">📦 Pedido múltiple (${numItems} productos)</div>
          ${btnDetalle}
        </td>
        <td style="font-weight:700;">${totalCant} <span class="!text-[11px] !font-normal !text-[#94A3B8]">uds. total</span></td>
        <td><span class="badge ${ecls[s.estado]||'badge-gray'}">${elbl[s.estado]||s.estado}</span>${s.motivo?`<div class="!text-[11px] !text-[#E24B4A] !mt-[3px] ![white-space:normal]">❌ Motivo: ${esc(s.motivo)}</div>`:''}</td>
        <td class="!text-[12px] !text-[#94A3B8] ![font-style:italic]">${s.justificacion?`"${esc(s.justificacion)}"`:'—'}</td>
        <td class="!text-[12px] !text-[#94A3B8]">${esc(s.sede_actual||s.municipio||s.destino||'—')}</td>
        <td class="!text-[12px] !text-[#94A3B8]">${fmtDate(s.fecha)}</td>
        <td>
          ${btnGestion}
          ${s.estado==='pendiente'&&s.solicitado_por===sesion.usuario?`<button onclick="cancelarMiPedido('agrupado','${s.id}')" class="btn-sm ![background:#FEE2E2] !text-[#B91C1C] !mt-[4px]">✕ Cancelar</button>`:''}
        </td>
      </tr>`;
    }
    const notaSol = s.nota || s.justificacion || '';
    return `<tr class="fade-row">
      <td>
        <span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_6px] !rounded-[5px] !mr-[5px]">${esc(s.ref)}</span>
        <span class="!font-semibold">${esc(s.nombre)}</span>
        ${notaSol ? `<div style="font-size:11px;color:#64748B;font-style:italic;margin-top:3px;background:#F8FAFC;padding:3px 7px;border-radius:5px;border-left:3px solid #CBD5E1;">💬 ${esc(notaSol)}</div>` : ''}
      </td>
      <td class="!font-semibold">${s.cantidad} <span class="!text-[11px] !font-normal !text-[#94A3B8]">${s.unidadPedido==='metros'?'mts.':sufijo(s.ref)}</span></td>
      <td><span class="badge ${ecls[s.estado]||'badge-gray'}">${elbl[s.estado]||s.estado}</span>${(s.motivo||(s.estado==='rechazado'&&s.nota))?`<div class="!text-[11px] !text-[#E24B4A] !mt-[3px] ![white-space:normal]">❌ Motivo: ${esc(s.motivo||s.nota)}</div>`:''}</td>
      <td class="!text-[12px] !text-[#94A3B8] ![font-style:italic]">${s.justificacion?`"${esc(s.justificacion)}"`:s.rechazadoPor?`Rechazado por: ${escU(s.rechazadoPor)}`:'—'}</td>
      <td class="!text-[12px] !text-[#94A3B8]"><div class="!whitespace-nowrap !overflow-hidden !text-ellipsis !max-w-[150px]">${s.descripcion?esc(s.descripcion):'—'}</div></td>
      <td class="!text-[12px] !text-[#94A3B8]">${fmtDate(s.fecha)}</td>
      <td>${s.estado==='pendiente'&&s.solicitado_por===sesion.usuario?`<button onclick="cancelarMiPedido('pedido','${s.id}')" class="btn-sm ![background:#FEE2E2] !text-[#B91C1C]">✕ Cancelar</button>`:''}</td>
    </tr>`;
  }).join('');
}

/* ════════════════════════════════════════════════
   HISTORIAL
════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════
   HISTORIAL CON PAGINACIÓN
════════════════════════════════════════════════ */
// Al cambiar un filtro se vuelve a pedir al servidor (así busca en TODO el historial,
// no solo en la página que está cargada). Espera un momento mientras se escribe.
let _histFiltroTimer = null;
function _histFiltroCambio(){
  clearTimeout(_histFiltroTimer);
  _histFiltroTimer = setTimeout(()=>cargarHistorialPaginado(1), 350);
}
async function cargarHistorialPaginado(pagina){
  _histPagina = pagina || _histPagina;
  const tbody = document.getElementById('tablaHistorial');
  if(tbody) tbody.innerHTML = '<tr><td class="!p-[24px] !text-center !text-[#94A3B8]" colspan="10">Cargando...</td></tr>';

  // Leer filtros activos
  const fecha    = document.getElementById('filtroFecha')?.value        || '';
  const producto = (document.getElementById('filtroProducto')?.value     || '').trim();
  const usuarioF = (document.getElementById('filtroUsuarioHist')?.value  || '').trim();
  const tipoUsrF = document.getElementById('filtroTipoUsuarioHist')?.value || '';
  const municipio= document.getElementById('histFiltroMun')?.value      || '';
  const origen   = document.getElementById('histFiltroOrigen')?.value   || '';

  const params = new URLSearchParams({
    pagina:     _histPagina,
    por_pagina: _histPorPagina,
  });
  if(fecha)     params.append('fecha',    fecha);
  if(producto)  params.append('producto', producto);
  if(usuarioF)  params.append('usuario', usuarioF);
  if(tipoUsrF)  params.append('tipo_usuario', tipoUsrF);
  if(municipio) params.append('municipio',municipio);
  if(origen)    params.append('origen',   origen);

  try{
    const res = await fetch(`api/historial.php?action=listar&${params}`,{credentials:'same-origin'});
    const data = await res.json();

    // Actualizar estado
    _histTotal   = data.total   || 0;
    _histPaginas = data.paginas || 1;
    const rows   = data.registros || [];

    // Guardar en memoria para filtros de UI (tabs aprobados/rechazados/etc)
    _historial = rows.map(h=>({
      ...h,
      _esGasto: h._esGasto||h.es_gasto||false,
      _origen:  h._origen||h.origen||'directo'
    }));

    renderHistorial();
    _actualizarPaginacionHistorial();
  } catch(e){
    if(tbody) tbody.innerHTML = '<tr><td class="!p-[24px] !text-center !text-[#E24B4A]" colspan="10">Error al cargar historial.</td></tr>';
  }
}

function _actualizarPaginacionHistorial(){
  const pag = document.getElementById('histPaginacion');
  const info = document.getElementById('histPagInfo');
  const prev = document.getElementById('histBtnPrev');
  const next = document.getElementById('histBtnNext');
  const nums = document.getElementById('histPagNumeros');
  if(!pag) return;

  if(_histTotal === 0){ pag.style.display='none'; return; }
  pag.style.display='flex';

  const desde = (_histPagina-1)*_histPorPagina+1;
  const hasta = Math.min(_histPagina*_histPorPagina, _histTotal);
  if(info) info.textContent = `Mostrando ${desde}–${hasta} de ${_histTotal} registros`;
  if(prev) prev.disabled = _histPagina <= 1;
  if(next) next.disabled = _histPagina >= _histPaginas;

  // Números de página (máximo 5 visibles)
  if(nums){
    const inicio = Math.max(1, _histPagina-2);
    const fin    = Math.min(_histPaginas, inicio+4);
    let html = '';
    for(let i=inicio;i<=fin;i++){
      const activa = i===_histPagina;
      html += `<button onclick="cargarHistorialPaginado(${i})" class="btn-sm"
        style="background:${activa?'#0C6EDE':'#F1F5F9'};color:${activa?'white':'#475569'};
        min-width:32px;font-weight:${activa?'700':'400'};">${i}</button>`;
    }
    nums.innerHTML = html;
  }
}

function histCambiarPagina(dir){
  const nueva = _histPagina + dir;
  if(nueva < 1 || nueva > _histPaginas) return;
  cargarHistorialPaginado(nueva);
}

function histCambiarPorPagina(){
  _histPorPagina = parseInt(document.getElementById('histPorPagina')?.value||50);
  cargarHistorialPaginado(1);
}

function renderHistorial(){
  const rol   = sesion.rol;
  const sedes = sesion.sedes||[sesion.sede];

  // Base: historial real de la BD
  let todasEntradas = getHistorial().map(h=>({
    ...h,
    _esGasto: h._esGasto||h.es_gasto||false,
    _origen:  h._origen||h.origen||'directo'
  }));

  if(rol==='municipio'||rol==='tecnico'||rol==='persona'){
    // El backend ya filtra por usuario_destino exacto — no hace falta
    // volver a filtrar aquí por sede (eso mezclaba el historial de toda
    // la oficina, no solo lo de esta cuenta).

    // Agregar pedidos propios (pendiente, en_gestion, rechazado)
    // para que el municipio vea el estado de sus solicitudes
    // Pendientes y en camino ya se ven en Seguimiento - historial solo muestra completados/rechazados
    const pedidosPropios = getPedidosMun()
      .filter(p=> p.solicitado_por===sesion.usuario || sedes.includes(p.municipio))
      .filter(p=> p.estado==='rechazado') // solo rechazados, los demás van a Seguimiento
      .map(p=>({
        ref:         p.ref,
        nombre:      p.nombre,
        destino:     p.municipio,
        cantidad:    p.cantidad,
        unidadEnvio: p.unidadPedido||'unidad',
        enviadoPor:  p.solicitadoPor,
        descripcion: p.justificacion||'',
        motivo:      p.motivo||'',
        estado:      p.estado==='rechazado' ? 'rechazado'
                   : p.estado==='en_gestion'? 'pendiente'
                   : 'pendiente',
        _esGasto:    false,
        _origen:     p.estado==='rechazado'?'sistema':'solicitud',
        _esPedido:   true,
        _estadoReal: p.estado, // para mostrar etiqueta correcta
        fecha:       p.fecha,
        id:          'ped_'+p.id
      }));
    // Productos rechazados de sus solicitudes / pedidos múltiples (antes solo salían los de la tabla vieja de pedidos)
    const solPropiasRech = getSolicitudes()
      .filter(s=>s.estado==='rechazada' && s.solicitadoPor===sesion.usuario)
      .map(s=>({
        ref:s.ref, nombre:s.nombre, destino:s.destino, cantidad:s.cantidad,
        unidadEnvio:s.unidadEnvio||'unidad',
        enviadoPor:s.solicitadoPor, fecha:s.fecha_respuesta||s.fecha, descripcion:s.nota||'',
        motivo:s.motivo||'',
        estado:'rechazado', pedidoAgrupadoId:s.pedidoAgrupadoId||null, _solicitudId:s.id,
        _esGasto:false, _origen:'solicitud',
        id:'sol_'+s.id
      }));
    todasEntradas = [...todasEntradas, ...pedidosPropios, ...solPropiasRech];

  } else {
    // Superadmin y distribuidor: agregan solicitudes, pedidos municipios y rechazos
    // Pedidos pendientes/en gestión/en camino van a Seguimiento - historial solo muestra completados y rechazados
    const pedidosMunExtra = getPedidosMun()
      .filter(p => p.estado === 'rechazado')
      .map(p => ({
        ref: p.ref, nombre: p.nombre, destino: p.municipio, cantidad: p.cantidad,
        unidadEnvio: p.unidadPedido||'unidad',
        enviadoPor: p.solicitadoPor, fecha: p.fecha,
        descripcion: p.justificacion||'', motivo: p.motivo||'',
        estado: 'rechazado',
        _esGasto: false, _origen: 'sistema',
        _esPedido: true, _estadoReal: 'rechazado',
        id: 'ped_'+p.id
      }));
    // Solo solicitudes rechazadas en historial - las aprobadas van a Seguimiento
    const solExtra = getSolicitudes().filter(s=>s.estado==='rechazada').map(s=>({
      ref:s.ref, nombre:s.nombre, destino:s.destino, cantidad:s.cantidad,
      unidadEnvio:s.unidadEnvio||'unidad',
      enviadoPor:s.solicitadoPor, fecha:s.fecha, descripcion:s.nota||'',
      motivo:s.motivo||'',
      estado: s.estado==='rechazada'?'rechazado':'pendiente', pedidoAgrupadoId:s.pedidoAgrupadoId||null, _solicitudId:s.id,
      _esGasto:false, _origen:'solicitud',
      id:'sol_'+s.id
    }));
    const rechSistema = getPedidosMun().filter(p=>p.rechazadoPor==='Sistema').map(p=>({
      ref:p.ref, nombre:p.nombre, destino:p.municipio, cantidad:p.cantidad,
      unidadEnvio:p.unidadPedido||'unidad',
      enviadoPor:'Sistema', fecha:p.fecha, descripcion:'',
      motivo:p.motivo||'', estado:'rechazado',
      _esGasto:false, _origen:'sistema',
      id:'rsys_'+p.id
    }));
    todasEntradas = [...todasEntradas, ...pedidosMunExtra, ...solExtra, ...rechSistema];
  }

  // ── Filtros ──
  const fecha = document.getElementById('filtroFecha')?.value||'';
  const prod  = (document.getElementById('filtroProducto')?.value||'').toLowerCase().trim();
  const tipoUsr = document.getElementById('filtroTipoUsuarioHist')?.value||'';
  const usrBuscar = (document.getElementById('filtroUsuarioHist')?.value||'').toLowerCase().trim();
  const orig  = document.getElementById('filtroEnviadoPor')?.value||'';

  // Resaltado amarillo de la coincidencia de búsqueda de producto
  const hlHist = (txt) => {
    txt = String(txt==null?'':txt);
    if(!prod || !txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(prod);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx+prod.length))}</mark>`
      + esc(txt.slice(idx+prod.length));
  };
  // Resaltado amarillo de la coincidencia de búsqueda de usuario
  const hlUsrHist = (txt) => {
    txt = String(txt==null?'':txt);
    if(!usrBuscar || !txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(usrBuscar);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx+usrBuscar.length))}</mark>`
      + esc(txt.slice(idx+usrBuscar.length));
  };

  if(fecha) todasEntradas = todasEntradas.filter(h=>(h.fecha||'').slice(0,10)===fecha);
  if(prod)  todasEntradas = todasEntradas.filter(h=>
    (h.nombre||'').toLowerCase().includes(prod)||(h.ref||'').toLowerCase().includes(prod));
  if(tipoUsr && rol!=='municipio'&&rol!=='tecnico'&&rol!=='persona'){
    const usuariosDelTipo = new Set(getUsuarios().filter(u=>u.rol===tipoUsr).map(u=>u.usuario));
    todasEntradas = todasEntradas.filter(h=>usuariosDelTipo.has(h.enviado_por||h.enviadoPor));
  }
  if(usrBuscar && rol!=='municipio'&&rol!=='tecnico'&&rol!=='persona'){
    todasEntradas = todasEntradas.filter(h=>(h.enviado_por||h.enviadoPor||'').toLowerCase().includes(usrBuscar));
  }
  if(orig)  todasEntradas = todasEntradas.filter(h=>h._origen===orig||
    (orig==='gasto'&&(h._esGasto||h.es_gasto)));

  // ── Contadores tabs ──
  const esGasto = h=> h._esGasto||h.es_gasto||h._origen==='gasto';
  const esVenta = h=> h.es_venta==1||h._origen==='venta';
  const esIngreso = h=> h._origen==='ingreso' && !h.anulado;
  const esAnulado = h=> h._origen==='ingreso' && h.anulado;
  const cntT = todasEntradas.length;
  // Un pedido con varios productos cuenta 1 (igual que la gráfica del Resumen)
  const _contarPedidos = arr => new Set(arr.map(h=>h.pedidoAgrupadoId||('i'+h.id))).size;
  const cntA = _contarPedidos(todasEntradas.filter(h=>(h.estado==='aprobado'||h.estado==='recibido'||h.estado==='entregado')&&!esGasto(h)&&!esIngreso(h)&&!esAnulado(h)));
  const cntP = _contarPedidos(todasEntradas.filter(h=>h.estado==='pendiente'&&!esGasto(h)));
  const cntR  = _contarPedidos(todasEntradas.filter(h=>h.estado==='rechazado'&&!esGasto(h)));
  const cntG  = todasEntradas.filter(esGasto).length;
  const cntV  = todasEntradas.filter(esVenta).length;
  const cntI  = todasEntradas.filter(esIngreso).length;
  const cntAn = todasEntradas.filter(esAnulado).length;
  const cntEG = todasEntradas.filter(h=>h._estadoReal==='en_gestion').length;
  const st=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v||'';};
  st('cntHistTodos',cntT||'');st('cntHistAprobado',cntA||'');
  st('cntHistPend',cntP||'');st('cntHistRech',cntR||'');st('cntHistGasto',cntG||'');
  st('cntHistVenta',cntV||'');
  st('cntHistIngreso',cntI||'');st('cntHistAnulado',cntAn||'');
  st('cntHistGestion',cntEG||'');

  // ── Tab activo ──
  if(tabHistorial==='gasto')
    todasEntradas = todasEntradas.filter(esGasto);
  else if(tabHistorial==='venta')
    todasEntradas = todasEntradas.filter(esVenta);
  else if(tabHistorial==='ingreso')
    todasEntradas = todasEntradas.filter(esIngreso);
  else if(tabHistorial==='anulado')
    todasEntradas = todasEntradas.filter(esAnulado);
  else if(tabHistorial==='en_gestion')
    todasEntradas = todasEntradas.filter(h=>h._estadoReal==='en_gestion');
  else if(tabHistorial==='aprobado')
    todasEntradas = todasEntradas.filter(h=>(h.estado==='aprobado'||h.estado==='recibido'||h.estado==='entregado')&&!esGasto(h)&&!esIngreso(h)&&!esAnulado(h));
  else if(tabHistorial!=='todos')
    todasEntradas = todasEntradas.filter(h=>h.estado===tabHistorial&&!esGasto(h));

  todasEntradas.sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));

  // ── Agrupar pedidos múltiples ──
  // 1) Forma confiable: mismo pedidoAgrupadoId real (viene del backend desde que
  //    se aprobó como "Pedido múltiple"). 2) Respaldo heurístico para entradas
  //    antiguas que no tengan ese dato (mismo destino + enviado_por + descripcion + ventana 10 min).
  const _gruposHist = [];
  const _visitadosHist = new Set();

  // Paso 1: agrupar por pedidoAgrupadoId real
  const _porPagId = {};
  todasEntradas.forEach(h => {
    if(!h.pedidoAgrupadoId) return;
    (_porPagId[h.pedidoAgrupadoId] ||= []).push(h);
  });
  Object.values(_porPagId).forEach(grupo => {
    grupo.forEach(x => _visitadosHist.add(x.id));
    if(grupo.length > 1){
      const h0 = grupo[0];
      const esGrupoGasto = !!(h0._esGasto || h0.es_gasto);
      _gruposHist.push({
        _esGrupoHist: true,
        _esGastoGrupo: esGrupoGasto,
        _items: grupo,
        id: h0.id,
        _solicitudId: h0._solicitudId || null,
        destino: h0.destino,
        fecha: h0.fecha,
        estado: h0.estado,
        enviadoPor: h0.enviadoPor||h0.enviado_por||'',
        aprobadoPor: h0.aprobadoPor||h0.aprobado_por||'',
        descripcion: h0.descripcion||'',
        _origen: h0._origen,
        // Sin esto, al agrupar varios productos de un mismo lote/pedido en
        // una sola fila se perdía el "👤 destinatario" debajo de la sede
        // (ej: una asignación directa a una persona con varios productos).
        usuarioDestino: h0.usuarioDestino||null,
      });
    } else {
      _gruposHist.push(grupo[0]);
    }
  });

  // Extraer transportador de descripcion para comparar
  const _transpDesc = d => (d||'').replace(/^Entregado por:\s*/i,'').trim().toLowerCase();
  // Redondear a ventana de 10 minutos
  const _ventana10 = fecha => {
    if(!fecha) return '';
    const d = new Date(fecha);
    d.setMinutes(Math.floor(d.getMinutes()/10)*10, 0, 0);
    return d.toISOString().slice(0,15);
  };
  todasEntradas.forEach(h => {
    if(_visitadosHist.has(h.id)) return;
    // No agrupar gastos ni entradas de ONT (tienen descripcion de MAC)
    if(h._esGasto||h.es_gasto) { _visitadosHist.add(h.id); _gruposHist.push(h); return; }
    if((h.descripcion||'').toLowerCase().includes('mac:')) { _visitadosHist.add(h.id); _gruposHist.push(h); return; }
    const ventanaH  = _ventana10(h.fecha);
    const transpH   = _transpDesc(h.descripcion);
    const envByH    = h.enviadoPor||h.enviado_por||'';
    // Buscar hermanos: mismo destino + enviado_por + transportador + ventana 10min
    const hermanos = todasEntradas.filter(x =>
      !_visitadosHist.has(x.id) && x.id !== h.id &&
      x.destino === h.destino &&
      (x.enviadoPor||x.enviado_por||'') === envByH &&
      x.estado === h.estado &&
      !(x._esGasto||x.es_gasto) &&
      !(x.descripcion||'').toLowerCase().includes('mac:') &&
      _ventana10(x.fecha) === ventanaH &&
      _transpDesc(x.descripcion) === transpH
    );
    if(hermanos.length > 0){
      // Agrupar
      const todos = [h, ...hermanos];
      todos.forEach(x => _visitadosHist.add(x.id));
      _gruposHist.push({
        _esGrupoHist: true,
        _items: todos,
        id: h.id,
        _solicitudId: h._solicitudId || null,
        destino: h.destino,
        fecha: h.fecha,
        estado: h.estado,
        enviadoPor: h.enviadoPor||h.enviado_por||'',
        aprobadoPor: h.aprobadoPor||h.aprobado_por||'',
        descripcion: h.descripcion||'',
        _origen: h._origen,
        // Mismo caso que en el agrupado por pedidoAgrupadoId: conservar el
        // destinatario puntual para que no desaparezca al agrupar.
        usuarioDestino: h.usuarioDestino||null,
      });
    } else {
      _visitadosHist.add(h.id);
      _gruposHist.push(h);
    }
  });
  // La agrupación anterior arma primero TODOS los grupos y luego los
  // individuales, sin importar la fecha de cada uno — se reordena una
  // vez más aquí para que quede todo mezclado por fecha real, sea grupo
  // o pedido individual.
  const entradasRender = _gruposHist.sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));

  const tbody=document.getElementById('tablaHistorial');if(!tbody)return;
  if(!entradasRender.length){
    tbody.innerHTML=`<tr><td class="!p-[32px] !text-center !text-[#94A3B8] !text-[13px]" colspan="9">Sin registros en esta categoría.</td></tr>`;
    return;
  }

  const ecls={aprobado:'badge-ok',pendiente:'badge-warn',rechazado:'badge-danger'};

  // Etiquetas especiales para pedidos de municipio
  const lblEstado = h=>{
    if(h._esPedido){
      const r=h._estadoReal;
      if(r==='en_gestion') return `<span class="badge badge-brand">⏳ En gestión</span>`;
      if(r==='rechazado')  return `<span class="badge badge-danger">❌ Rechazado</span>${h.motivo?`<div class="!text-[11px] !text-[#E24B4A] !mt-[2px]">${esc(h.motivo)}</div>`:''}`;
      return `<span class="badge badge-warn">🕐 Pendiente</span>`;
    }
    const _esGlbl=esGasto(h);
    if(_esGlbl) return h.es_venta==1 ? `<span class="badge ![background:#EAF3DE] !text-[#166534]">💰 Vendido</span>` : `<span class="badge badge-warn">Gastado</span>`;
    if(h.estado==='recibido') return `<span class="badge badge-ok">📦 Recibido</span>`;
    if(h.estado==='entregado') return `<span class="badge badge-brand">✅ Entregado</span>`;
    return `<span class="badge ${ecls[h.estado]||'badge-gray'}">${
      h.estado==='aprobado'?'Enviado ✓':h.estado==='pendiente'?'Pendiente':'Rechazado'
    }</span>${h.motivo?`<div class="!text-[11px] !text-[#E24B4A] !mt-[2px] !max-w-[130px] !overflow-hidden !text-ellipsis">${esc(h.motivo)}</div>`:''}`;
  };

  tbody.innerHTML=entradasRender.map(h=>{
    // Fila agrupada (pedido múltiple o gasto múltiple)
    if(h._esGrupoHist){
      const items  = h._items;
      const total  = items.reduce((s,x)=>s+(parseFloat(x.cantidad)||0),0);
      const envBy  = items[0]?.enviadoPor||items[0]?.enviado_por||'—';
      // Determinar ID y tipo para el PDF
      // Para grupos: pasar los IDs del historial separados por coma
      // El PHP construye el PDF desde los registros de historial directamente
      const histIds = items.map(x=>x.id).join(',');
      let pdfId   = histIds;
      let pdfTipo = 'historial_grupo';
      // Productos rechazados que vienen de solicitudes (no del historial): el comprobante es el del pedido múltiple
      if(items.length && items.every(x=>x._solicitudId) && items[0].pedidoAgrupadoId){
        pdfId = items[0].pedidoAgrupadoId; pdfTipo = 'pedido_agrupado';
      }
      const esGastoGrp = !!h._esGastoGrupo;
      const iconoGrp = esGastoGrp ? '🔧' : '📦';
      const tituloGrp = esGastoGrp ? 'Gasto múltiple' : 'Pedido múltiple';
      const colorGrp = esGastoGrp ? '#B45309' : '#5B21B6';
      const fondoGrp = esGastoGrp ? '#FFFBEB' : '#F8F5FF';
      const bordeGrp = esGastoGrp ? '#F59E0B' : '#7C3AED';
      // Cliente/Proyecto del gasto múltiple (todos los items del lote lo
      // comparten — se toma el primero que lo tenga guardado).
      const proyGrp = esGastoGrp ? ((items.find(x=>x.proyectoCliente)||{}).proyectoCliente || '') : '';
      const etiquetaProyGrp = proyGrp
        ? `<div class="!cursor-pointer !text-[10px] !font-bold !text-[#B45309] ![background:#FFF] ![border:1px_solid_#FCD34D] !inline-block !p-[1px_6px] !rounded-[4px] !mt-[3px]" onclick="event.stopPropagation();abrirDetalleProyecto('${esc(proyGrp)}')" title="Ver todo el proyecto ${esc(proyGrp)}">🏗️ ${esc(proyGrp)}</div>`
        : '';
      // Expandir/colapsar detalle
      const gid = 'ghist_'+h.id;
      return `<tr class="fade-row" style="background:${fondoGrp};border-left:3px solid ${bordeGrp};cursor:pointer;" onclick="(()=>{const d=document.getElementById('${gid}');if(d)d.style.display=d.style.display==='none'?'':'none';})()">
        <td colspan="2">
          <div class="!flex !items-center !gap-[8px]">
            <span class="!text-[16px]">${iconoGrp}</span>
            <div>
              <div style="font-weight:700;font-size:13px;color:${colorGrp};">${tituloGrp} · ${items.length} productos</div>
              ${etiquetaProyGrp}
              ${prod ? `<div class="!text-[11px] !text-[#64748B] !mt-[2px]">${items.map(i=>hlHist(i.nombre)).join(', ')}</div>` : `<div class="!text-[11px] !text-[#94A3B8] !mt-[2px]">Click para ver el detalle ▾</div>`}
            </div>
          </div>
        </td>
        <td>${h.usuarioDestino?`<span class="badge badge-brand !text-[11px]">👤 ${esc(h.usuarioDestino)}</span><div class="!text-[10px] !text-[#64748B] !mt-[2px]">${esc(h.destino||'')}</div>`:`<span class="badge badge-brand !text-[11px]">${esc(h.destino)}</span>`}</td>
        <td style="font-weight:700;">${total} <span class="!text-[11px] !text-[#94A3B8]">uds.</span></td>
        <td class="!text-[12px] !text-[#64748B]">${escU(envBy)}</td>
        <td class="!text-[12px] !text-[#64748B]">${escU(h.aprobadoPor||'—')}</td>
        <td>${esGastoGrp ? '<span class="badge badge-warn">Gastado</span>' : (items.every(x=>x.estado==='rechazado') ? (()=>{ const _m=[...new Set(items.map(x=>x.motivo).filter(Boolean))].join(' · '); return '<span class="badge badge-danger">❌ Rechazado</span>'; })() : items.some(x=>x.estado==='recibido') ? '<span class="badge badge-ok">📦 Recibido</span>' : '<span class="badge badge-ok">✅ Entregado</span>')}</td>
        <td class="!text-[12px] !text-[#475569] !max-w-[220px]">${(()=>{ if(esGastoGrp || !items.every(x=>x.estado==='rechazado')) return ''; const _m=[...new Set(items.map(x=>x.motivo).filter(Boolean))].join(' · '); return _m?`<div class="![white-space:normal] !leading-[1.5]">❌ Motivo: ${hlHist(_m)}</div>`:'<span class="!text-[#CBD5E1]">—</span>'; })()}</td>
        <td class="!text-[11px] !text-[#64748B]">${fmtDate(h.fecha)}</td>
        <td>${pdfId?`<button onclick="event.stopPropagation();abrirRemision('${pdfId}','${pdfTipo}')" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6] !whitespace-nowrap"><svg class="!inline ![vertical-align:middle] !mr-[2px]" width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>PDF</button>`:'—'}</td>
      </tr>
      <tr id="${gid}" style="display:none;background:#FAF7FF;">
        <td class="!p-[0_0_0_32px]" colspan="10">
          <table class="!w-[100%] ![border-collapse:collapse]">
            <thead><tr class="!text-[11px] !text-[#94A3B8] !uppercase !tracking-[.05em]">
              <th class="!p-[6px_8px] !text-left">Ref</th>
              <th class="!p-[6px_8px] !text-left">Producto</th>
              <th class="!p-[6px_8px] !text-left">Cantidad</th>
              <th class="!p-[6px_8px] !text-left">Estado</th>
            </tr></thead>
            <tbody>
              ${items.map(x=>{
                const prodX = getProductos().find(p=>p.ref===x.ref);
                const esRolloX = prodX && prodX.metrosPorUnidad;
                const cantTxt = esRolloX
                  ? (()=>{const _q=cantRolloPartes(prodX,x.cantidad); return `${_q.n} ${_q.suf}`;})()
                  : `${x.cantidad} <span class="!text-[#94A3B8]">${x.unidadEnvio==='metros'?'mts.':'uds.'}</span>`;
                return `<tr class="![border-top:1px_solid_#EDE9FE]">
                <td class="!p-[6px_8px] ![font-family:monospace] !text-[11px] !text-[#7C3AED]">${esc(x.ref)}</td>
                <td class="!p-[6px_8px] !text-[12px] !font-semibold">${esc(x.nombre)}${x.seriales?`<div class="!text-[11px] !font-semibold !text-[#475569] !mt-[2px]">🔢 SN: ${esc(x.seriales)}</div>`:''}</td>
                <td class="!p-[6px_8px] !text-[12px]">${cantTxt}</td>
                <td class="!p-[6px_8px]">${x.estado==='rechazado'?`<span class="badge badge-danger !text-[10px]">❌ Rechazado</span>${x.motivo?`<div class="!text-[10px] !text-[#E24B4A]">${esc(x.motivo)}</div>`:''}`:`<span class="badge badge-ok !text-[10px]">${x.estado==='recibido'?'📦 Recibido':'✅ Entregado'}</span>`}</td>
              </tr>`;
              }).join('')}
            </tbody>
          </table>
        </td>
      </tr>`;
    }
    const esG=esGasto(h);
    let desc=h.descripcion||'';
    if(!desc){const pp=getProductos().find(p=>p.ref===h.ref);if(pp)desc=pp.descripcion||'';}
    if(h.gps_lat && h.gps_lng){
      desc = desc + ' [MAPA:'+h.gps_lat+','+h.gps_lng+']';
    }
    // Limpiar prefijo EXT: del transportador en la descripción
    // Motivo del rechazo/cancelación: va en la columna de descripción, no pegado al estado
    if(h.estado==='rechazado' && h.motivo && !desc.includes(h.motivo)) desc = '❌ Motivo: '+h.motivo + (desc?'\n'+desc:'');
    // Ingresos de mercancía: una línea por dato y sin repetir precio/envío (ingresos viejos los traían duplicados)
    if(h._origen==='ingreso' && /^Ingreso de mercanc/i.test(desc)){
      const vistos = new Set();
      desc = desc.replace(/^Ingreso de mercancía:?\s*/i,'').split(' · ').map(x=>x.trim()).filter(Boolean)
        .filter(x=>{ const k=(x.match(/^(Proveedor|Valor unitario|Valor por rollo|Total|Valor de env[ií]o|Nuevo total)\s*:/i)||[])[1]; if(!k) return true; const kk=k.toLowerCase(); if(vistos.has(kk)) return false; vistos.add(kk); return true; })
        .join('\n');
    }
    desc = desc.replace(/^Entregado por: EXT:/i, 'Entregado por: 🚛 ')
               .replace(/EXT:/g, '');

    // Una sola columna "Movimiento" que combina tipo + estado
    let movBadge;
    if(esG){
      movBadge = h.es_venta==1 ? `<span class="badge ![background:#EAF3DE] !text-[#166534]">💰 Venta registrada</span>` : `<span class="badge badge-warn">💸 Gasto registrado</span>`;
    } else if(h._esPedido){
      const r=h._estadoReal;
      if(r==='rechazado')
        movBadge=`<span class="badge badge-danger">❌ Pedido rechazado</span>`;
      else if(r==='en_gestion')
        movBadge=`<span class="badge badge-brand">⏳ Pedido en gestión</span>`;
      else
        movBadge=`<span class="badge badge-warn">🕐 Pedido pendiente</span>`;
    } else if(h.estado==='rechazado'){
      const motR = h.motivo||'';
      if(h._origen==='sistema')
        movBadge=`<span class="badge badge-danger">❌ Rechazado — sin stock</span>`;
      else if(h._origen==='solicitud')
        movBadge=`<span class="badge badge-danger">❌ Solicitud rechazada</span>`;
      else
        movBadge=`<span class="badge badge-danger">❌ Rechazado</span>`;
    } else if(h.estado==='aprobado' && h._origen==='ingreso' && h.anulado){
      movBadge=`<span class="badge badge-danger ![text-decoration:line-through]">📥 Ingreso</span> <span class="badge ![background:#B91C1C] ![color:white] !font-bold">❌ ANULADO</span>
        <div class="!text-[11px] !text-[#B91C1C] !mt-[4px]">Por: ${esc(h.anuladoPor||'—')} · ${h.anuladoEn?fmtDate(h.anuladoEn):''}</div>
        ${h.motivoAnulacion?`<div class="!text-[11px] !text-[#94A3B8] ![font-style:italic] !mt-[2px]">"${esc(h.motivoAnulacion)}"</div>`:''}`;
    } else if(h.estado==='aprobado' && h._origen==='ingreso'){
      movBadge=`<span class="badge ![background:#EAF3DE] !text-[#166534]">📥 Ingreso</span>`;
    } else if(h._origen==='devolucion' || /↩️ Devolución/.test(h.descripcion||'')){
      movBadge = h.estado==='recibido'
        ? `<span class="badge ![background:#E0F2FE] !text-[#0369A1]">↩️ Devolución recibida</span>`
        : `<span class="badge ![background:#E0F2FE] !text-[#0369A1]">↩️ Devolución</span>`;
      const _mRec = (h.descripcion||'').match(/Recogido (reutilizable|dañado)( \(\d+\) \+ dañado \(\d+\))?/);
      if(_mRec){
        const _mix = !!_mRec[2], _dan = _mRec[1]==='dañado';
        movBadge += `<div class="!mt-[3px]"><span class="badge" style="background:${_dan?'#FCEBEB':(_mix?'#FEF3C7':'#EAF3DE')};color:${_dan?'#B91C1C':(_mix?'#92400E':'#166534')};">${_dan?'🛠':'♻️'} ${esc(_mRec[0])}</span></div>`;
      }
    } else if(h.estado==='aprobado'){
      movBadge=`<span class="badge badge-ok">✅ Entregado</span>`;
    } else if(h.estado==='recibido'){
      movBadge=`<span class="badge badge-ok">📦 Recibido</span>`;
    } else if(h.estado==='pendiente'){
      movBadge=`<span class="badge badge-warn">⏳ Pendiente</span>`;
    } else {
      movBadge=`<span class="badge badge-gray">${esc(h.estado||'—')}</span>`;
    }

    // Aprobado por — extraer del campo descripcion o del seguimiento
    const aprobadoPor = h._aprobadoPor || h.aprobadoPor || '—';
    // Producto clickeable con popover de info
    const prodInfo = getProductos().find(p=>p.ref===h.ref);
    const popoverId = 'pop_'+h.id;
    // Ya queda anotado en la descripción cuando algo se vendió/envió desde
    // el pool de recuperado — solo se detecta ese texto para mostrarlo
    // como una etiqueta visible, en vez de texto plano enterrado.
    const esDeRecuperado = /Stock:\s*♻️\s*Recuperado/i.test(h.descripcion||'');
    const etiquetaRecuperado = esDeRecuperado
      ? `<div class="!text-[10px] !font-bold !text-[#166534] ![background:#EAF3DE] !inline-block !p-[1px_6px] !rounded-[4px] !mb-[3px]">♻️ Recuperado</div><br>`
      : '';
    // Material que era de una persona (prestado_por) pero lo usó otra —
    // se resalta en rojo para que quede claro de un vistazo que no fue
    // el dueño quien lo instaló, sin tener que abrir la descripción.
    const mUsoPrestamo = (h.descripcion||'').match(/Prestado por ([^,]+), usado por (.+)$/i);
    const etiquetaPrestamo = mUsoPrestamo
      ? `<div class="!text-[10px] !font-bold !text-[#B91C1C] ![background:#FEE2E2] !inline-block !p-[1px_6px] !rounded-[4px] !mb-[3px]" title="Material de ${esc(mUsoPrestamo[1].trim())}, prestado y usado por ${esc(mUsoPrestamo[2].trim())}">🤝 Usó ${esc(mUsoPrestamo[2].trim())}</div><br>`
      : '';
    const etiquetaRetirado = h.retirado
      ? `<div class="!text-[10px] !font-bold !text-[#92400E] ![background:#FEF3C7] !inline-block !p-[1px_6px] !rounded-[4px] !mb-[3px]" title="Retirado por ${esc(h.retiradoPor||'')} — ${esc(h.retiradoMotivo||'')}">🚫 Retirado — ${esc(h.retiradoMotivo||'')}</div><br>`
      : '';
    const etiquetaProyecto = h.proyectoCliente
      ? `<div class="!cursor-pointer !text-[10px] !font-bold !text-[#B45309] ![background:#FFFBEB] !inline-block !p-[1px_6px] !rounded-[4px] !mb-[3px]" onclick="event.stopPropagation();abrirDetalleProyecto('${esc(h.proyectoCliente)}')" title="Ver todo el proyecto ${esc(h.proyectoCliente)}">🏗️ ${esc(h.proyectoCliente)}</div><br>`
      : '';
    const productoCell = `<td class="!font-semibold !relative">
      ${etiquetaRetirado}${etiquetaRecuperado}${etiquetaPrestamo}${etiquetaProyecto}
      <span onclick="(()=>{document.querySelectorAll('.hist-pop').forEach(x=>x.style.display='none');const p=document.getElementById('${popoverId}');if(p){const r=this.getBoundingClientRect();p.style.top=(r.bottom+6)+'px';p.style.left=r.left+'px';p.style.display=p.style.display==='block'?'none':'block';}})()" 
        style="cursor:pointer;border-bottom:1px dashed #CBD5E1;">${hlHist(h.nombre||'—')}</span>
      ${h.seriales?`<div class="!text-[11px] !font-semibold !text-[#475569] !mt-[3px]">🔢 SN: ${hlHist(h.seriales)}</div>`:''}
      ${prodInfo ? `<div id="${popoverId}" class="hist-pop" style="display:none;position:fixed;z-index:9999;background:white;border:1.5px solid #E2E8F0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.15);padding:12px 14px;min-width:220px;font-size:12px;">
        <div class="!font-bold !text-[#0F172A] !mb-[6px]">📦 ${esc(prodInfo.nombre)}</div>
        <div class="!text-[#64748B]"><b>Ref:</b> ${esc(prodInfo.ref)}</div>
        <div class="!text-[#64748B]"><b>Unidad:</b> ${esc(prodInfo.unidad||'unidad')}</div>
        ${prodInfo.proveedor?`<div class="!text-[#64748B]"><b>Proveedor:</b> 🏭 ${esc(prodInfo.proveedor)}</div>`:''}
        ${prodInfo.descripcion?`<div class="!text-[#94A3B8] !mt-[4px] ![font-style:italic]">${esc(prodInfo.descripcion)}</div>`:''}
      </div>` : ''}
    </td>`;

    return `<tr class="fade-row" style="${esG?'background:#FFFBF2;':h._esPedido&&h._estadoReal==='en_gestion'?'background:#F0F7FF;':h._esPedido&&h._estadoReal==='rechazado'?'background:#FFF5F5;':''}">
      <td><span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_6px] !rounded-[5px]">${hlHist(h.ref||'—')}</span></td>
      ${productoCell}
      <td>${h.usuarioDestino?`<span class="badge ${esG?'badge-warn':'badge-brand'}">👤 ${esc(h.usuarioDestino)}</span><div class="!text-[10px] !text-[#64748B] !mt-[2px]">${esc(h.destino||'')}</div>`:`<span class="badge ${esG?'badge-warn':'badge-brand'}">${esc(h.destino||'—')}</span>`}</td>
      <td class="!font-semibold">${prodInfo && prodInfo.metrosPorUnidad ? (()=>{const _q=cantRolloPartes(prodInfo,h.cantidad||0); return `${_q.n} <span class="!text-[11px] !font-normal !text-[#94A3B8]">${_q.suf}</span>`;})() : `${h.cantidad||0} <span class="!text-[11px] !font-normal !text-[#94A3B8]">${h.unidadEnvio==='metros'?'mts.':sufijo(h.ref)}</span>`}</td>
      <td class="!text-[12px] !text-[#64748B]">${hlUsrHist(h.enviadoPor?nombreUsr(h.enviadoPor):'—')}</td>
      <td class="!text-[12px] !text-[#64748B]">${escU(aprobadoPor)}</td>
      <td>${movBadge}</td>
      <td class="!text-[12px] !text-[#475569] !max-w-[220px]">
        ${(()=>{
          const mMapa = desc.match(/\s*\[MAPA:([\d.\-]+),([\d.\-]+)\]$/);
          const descSinMapa = mMapa ? desc.slice(0, mMapa.index) : desc;
          const linkMapa = mMapa ? ` <a class="!text-[#0369A1] ![text-decoration:underline] !whitespace-nowrap" href="https://maps.google.com/?q=${mMapa[1]},${mMapa[2]}" target="_blank">📍 Ver en mapa</a>` : '';
          return descSinMapa
            ? `<div class="![white-space:normal] !leading-[1.5]">${hlHist(descSinMapa).replace(/\n/g,'<br>')}${linkMapa}</div>`
            : (linkMapa ? `<div class="![white-space:normal]">${linkMapa}</div>` : '<span class="!text-[#CBD5E1]">—</span>');
        })()}
      </td>
      <td class="!text-[12px] !text-[#94A3B8] !whitespace-nowrap">${fmtDate(h.fecha)}</td>
      <td>${(()=>{
        const refUp=(h.ref||'').toUpperCase();
        const esEnvioDirecto=['FIBRA','OLT','MIKROTIK'].includes(refUp);
        if(h._origen==='ingreso'){
          const yaAnulado = !!h.anulado;
          const btnPdf = '<button onclick="abrirRemision(\''+h.id+'\',\'ingreso\')" class="btn-sm ![background:#EAF3DE] !text-[#166534] !whitespace-nowrap" title="Ver comprobante de ingreso"><svg class="!inline ![vertical-align:middle] !mr-[2px]" width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>PDF</button>';
          const puedeAnular = (sesion?.rol==='superadmin'||tienePermiso('anular_ingresos'));
          const btnAnular = (!yaAnulado && puedeAnular)
            ? `<button onclick="anularIngreso('${h.id}','${esc(h.nombre).replace(/'/g,"\\'")}',${h.cantidad||0})" class="btn-sm ![background:#FCEBEB] !text-[#B91C1C] !whitespace-nowrap !ml-[4px]" title="Anular este ingreso (se registró mal)">↩ Anular</button>`
            : '';
          if(/^(Registro de|Llegada de|Ingreso ONT)/.test(h.descripcion||h.desc||'')) return `<div style="display:flex;">${btnPdf}</div>`;
          return `<div style="display:flex;">${btnPdf}${btnAnular}</div>`;
        }
        let pid, ptipo;
        if(h.pedidoAgrupadoId && h.pedidoAgrupadoId.startsWith('gm_')){
          // Viene de "Gasto múltiple" (producto normal o fibra) — se abre
          // el comprobante COMBINADO con todos los del mismo lote, no uno
          // separado por cada fila.
          const idsDelLote = entradasRender.filter(x=>x.pedidoAgrupadoId===h.pedidoAgrupadoId).map(x=>x.id);
          pid = idsDelLote.join(',');
          ptipo = 'historial_grupo';
        }
        else if(esEnvioDirecto){ pid=h.id; ptipo='historial'; }
        else if(h._esGasto){ pid=h.id; ptipo='gasto'; }
        else { pid=h._solicitudId||h.id; ptipo='solicitud'; }
        if(!pid) return '<span style="color:#E2E8F0;font-size:11px;">—</span>';
        return '<button onclick="abrirRemision(\''+pid+'\',\''+ptipo+'\')" class="btn-sm" style="background:#EDE9FE;color:#5B21B6;white-space:nowrap;" title="Ver remisión PDF"><svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="display:inline;vertical-align:middle;margin-right:2px;"><path stroke-linecap="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>PDF</button>';
      })()}</td>
    </tr>`;
  }).join('');
}
