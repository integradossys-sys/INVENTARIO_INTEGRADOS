/* ════════════════════════════════════════════════
   CARRITO DE PEDIDO AGRUPADO
════════════════════════════════════════════════ */
let _carrito = []; // [{ref, nombre, unidad, cantidad, stockNeiva, max}]

function agregarAlCarrito(idx) {
  const p = getProductos()[idx];
  if (!p) return;
  const stockNeiva = _stockCentral(p);
  if (stockNeiva === 0) {
    toast(`"${p.nombre}" no tiene stock disponible en el almacén`, 'error');
    return;
  }
  // Si ya está en el carrito, aumentar cantidad
  const existing = _carrito.find(i => i.ref === p.ref);
  if (existing) {
    if (existing.cantidad < stockNeiva) existing.cantidad++;
    toast(`"${p.nombre}" ya está en tu pedido — cantidad: ${existing.cantidad}`, 'warn');
  } else {
    _carrito.push({ ref: p.ref, nombre: p.nombre, unidad: p.unidad||'unidad', cantidad: 1, stockNeiva });
    toast(`"${p.nombre}" agregado al pedido 🛒`, 'success');
  }
  _actualizarBtnCarrito();
}

function _actualizarBtnCarrito() {
  const btn = document.getElementById('btnVerCarrito');
  if (!btn) return;
  if (_carrito.length > 0) {
    btn.style.display = 'inline-flex';
    btn.innerHTML = `🛒 Mi pedido <span class="![background:white] !text-[#92400E] !rounded-[99px] !p-[0_7px] !font-extrabold !ml-[6px]">${_carrito.length}</span>`;
  } else {
    btn.style.display = 'none';
  }
}

function abrirCarrito() {
  _renderCarrito();
  document.getElementById('modalCarrito')?.classList.add('open');
}

function _renderCarrito() {
  const el = document.getElementById('carritoItems');
  if (!el) return;
  if (!_carrito.length) {
    el.innerHTML = '<div class="!text-center !p-[24px] !text-[#94A3B8]">No hay productos en tu pedido.</div>';
    return;
  }
  el.innerHTML = _carrito.map((item, i) => `
    <div style="display:flex;align-items:center;gap:10px;background:#F8FAFC;border-radius:10px;padding:10px 14px;border:1.5px solid #E2E8F0;">
      <div class="![flex:1]">
        <div class="!font-semibold !text-[13px]">${esc(item.nombre)}</div>
        <div class="!text-[11px] !text-[#94A3B8]">Ref: ${esc(item.ref)} · Disponible en el almacén: ${item.stockNeiva} ${item.unidad==='metros'?'mts.':'uds.'}</div>
      </div>
      <div class="!flex !items-center !gap-[6px]">
        <button class="!w-[26px] !h-[26px] !rounded-[6px] ![border:1.5px_solid_#E2E8F0] ![background:white] !cursor-pointer !text-[14px] !font-bold" onclick="_carritoAjustar(${i},-1)">−</button>
        <input class="!w-[52px] !text-center ![border:1.5px_solid_#E2E8F0] !rounded-[7px] !p-[3px_4px] !font-semibold" type="number" min="1" max="${item.stockNeiva}" value="${item.cantidad}"
          oninput="_carritoSetCant(${i},this.value)">
        <button class="!w-[26px] !h-[26px] !rounded-[6px] ![border:1.5px_solid_#E2E8F0] ![background:white] !cursor-pointer !text-[14px] !font-bold" onclick="_carritoAjustar(${i},1)">+</button>
        <span class="!text-[11px] !text-[#94A3B8]">${item.unidad==='metros'?'mts.':'uds.'}</span>
      </div>
      <button class="![background:#FCEBEB] ![border:none] !rounded-[7px] !p-[4px_8px] !cursor-pointer !text-[#B91C1C] !text-[12px]" onclick="_carritoEliminar(${i})">✕</button>
    </div>
  `).join('');
}

function _carritoAjustar(i, dir) {
  const item = _carrito[i];
  if (!item) return;
  item.cantidad = Math.max(1, Math.min(item.stockNeiva, item.cantidad + dir));
  _renderCarrito();
}

function _carritoSetCant(i, val) {
  const item = _carrito[i];
  if (!item) return;
  item.cantidad = Math.max(1, Math.min(item.stockNeiva, parseInt(val)||1));
}

function _carritoEliminar(i) {
  _carrito.splice(i, 1);
  _renderCarrito();
  _actualizarBtnCarrito();
  if (!_carrito.length) cerrarModal('modalCarrito');
}

async function enviarCarrito() {
  if (!_carrito.length) { toast('Tu pedido está vacío','error'); return; }
  const nota = document.getElementById('carritoNota')?.value || '';
  const destino = sesion.sede || sesion.sede_nombre || '';

  try {
    const res = await fetch('api/pedidos_agrupados.php?action=crear', {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({
        items: _carrito.map(i => ({ref:i.ref, nombre:i.nombre, cantidad:i.cantidad, unidad:i.unidad})),
        destino, nota
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error||'Error');
    _carrito = [];
    _actualizarBtnCarrito();
    cerrarModal('modalCarrito');
    toast('✅ Pedido enviado — esperando aprobación', 'success');
    await _recargarSolicitudes();
    renderStats(); updateNotifBadges();
  } catch(e) { toast(e.message||'Error al enviar pedido','error'); }
}

/* ════════════════════════════════════════════════
   GESTIÓN DE PEDIDO AGRUPADO (admin/distribuidor)
════════════════════════════════════════════════ */
let _pedidoGestionActual = null;
let _ontStockMap = {}; // modelo (lowercase) -> cantidad disponible real (tabla ont_seriales)
let _fibraStockMap = {}; // categoria_fibra_id -> metros disponibles reales (tabla fibra_carretes)

function verDetalleSeguimientoGrupo(referenciaId, pagId) {
  // Si tenemos pagId, agrupar todos los del mismo pedido agrupado — el
  // pagId puede venir de 3 fuentes distintas (igual que en renderSeguimiento):
  // el campo real pedidoAgrupadoId (pedidos por solicitud), un referencia_id
  // "pag_...", o la etiqueta "Lote: X" en notas (asignación/devolución/gasto
  // múltiple) — antes solo comparaba contra pedidoAgrupadoId, así que estos
  // últimos dos casos nunca encontraban sus items ("Sin items").
  const _pagIdDe = s => _grupoSegId(s);
  const items = (_seguimiento||[]).filter(s=>{
    if(pagId) return _pagIdDe(s)===pagId;
    return s.referencia_id===referenciaId;
  });
  if(!items.length){ toast('Sin items','error'); return; }
  const itemsHtml = items.map(i=>{
    const prodI = getProductos().find(p=>p.ref===i.ref_producto);
    const esRolloI = prodI && prodI.metrosPorUnidad > 0;
    const cantTxt = esRolloI
      ? (()=>{const _q=cantRolloPartes(prodI,i.cantidad); return `${_q.n} <span class="!text-[11px] !font-normal !text-[#94A3B8]">${_q.suf}</span>`;})()
      : `${i.cantidad} <span class="!text-[11px] !font-normal !text-[#94A3B8]">${esc(i.unidad)}</span>`;
    return `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#F8FAFC;border-radius:8px;margin-bottom:6px;">
      <div>
        <span class="![font-family:monospace] !text-[11px] ![background:#E2E8F0] !p-[1px_6px] !rounded-[4px] !mr-[6px]">${esc(i.ref_producto)}</span>
        <span class="!font-semibold !text-[13px]">${esc(i.nombre_producto)}</span>
      </div>
      <span class="!font-bold !text-[13px]">${cantTxt}</span>
    </div>`;
  }).join('');
  // ── Notas del ENVÍO (transporte): vienen del seguimiento ──
  const notasSet = new Set();
  items.forEach(i=>{
    (i.notas||'').split('\n').forEach(linea=>{
      const t=linea.trim();
      if(!t) return;
      // Líneas internas del sistema (ej. "Lote: am_1759…"): no son notas de personas, no se muestran.
      if(/^(Recoge en persona|Destinatario ONT|Lote|Rollos elegidos|Devoluci[oó]n):/i.test(t) || /^\[STOCK:recuperado\]$/i.test(t) || /^Stock:\s*♻️\s*Recuperado$/i.test(t) || /^Asignaci[oó]n directa a\b/i.test(t)) return;
      notasSet.add(t);
    });
  });
  const notasEnvio = Array.from(notasSet);

  // ── Notas del PEDIDO: nota del municipio + gestión, desde el pedido agrupado ──
  let notaMun = '', notaGesBloque = '';
  if(pagId){
    const ped = getPedidosAgrupados().find(p=>p.id===pagId || p.id===String(pagId));
    if(ped){
      const txt=(ped.nota||'').trim();
      const idxG = txt.search(/\[(Gestión|Gestion|Escalado)/);
      notaMun = idxG>=0 ? txt.slice(0,idxG).trim() : txt;
      notaGesBloque = idxG>=0 ? txt.slice(idxG).trim() : '';
      if(notaMun==='Pedido múltiple') notaMun='';
    }
  }

  let notasPedidoHtml = '';
  if(notaMun){
    notasPedidoHtml += `<div class="!mt-[12px] !p-[10px_12px] ![background:#EFF6FF] ![border:1px_solid_#BFDBFE] !rounded-[8px] !text-[12px] !text-[#1E40AF]">
      <strong>📝 Nota del municipio:</strong> ${esc(notaMun).replace(/\n/g,'<br>')}
    </div>`;
  }
  notasPedidoHtml += _formatNotasGestion(notaGesBloque);

  const notasEnvioHtml = notasEnvio.length
    ? `<div class="!mt-[12px] !p-[10px_12px] ![background:#FEF9E7] ![border:1px_solid_#FDE68A] !rounded-[8px] !text-[12px] !text-[#92400E]">
         <strong>🚚 Notas del envío:</strong>
         <div class="!mt-[6px] !leading-[1.7]">${notasEnvio.map(n=>`<div>• ${esc(n)}</div>`).join('')}</div>
       </div>`
    : '';

  const modal = document.getElementById('modalDetallePedido');
  const body  = document.getElementById('modalDetallePedidoBody');
  if(!modal||!body) return;
  body.innerHTML = `
    <div class="!text-[12px] !text-[#64748B] !mb-[12px]">
      Destino: <strong>${esc(items[0]?.destino||'')}</strong> · Origen: <strong>${esc(items[0]?.origen||'Almacen Central')}</strong>
    </div>
    ${itemsHtml}
    <div class="!mt-[12px] !p-[8px_12px] ![background:#EAF3DE] !rounded-[8px] !text-[12px] !text-[#166534] !font-semibold">
      Total: ${totalPedidoTxt(items,false)}
    </div>
    ${notasPedidoHtml}
    ${notasEnvioHtml}`;
  modal.classList.add('open');
}

// Formatea el bloque de notas de gestión, mostrando el autor de cada una.
// Reconoce el formato nuevo "[Gestión · usuario]" / "[Escalado · usuario]"
// y el viejo "[Gestión]" / "[Escalado]" (sin autor).
function _formatNotasGestion(bloque){
  if(!bloque || !bloque.trim()) return '';
  // Partir por cada etiqueta tipo [Palabra · usuario], conservándola —
  // genérico para reconocer cualquier etiqueta futura (Escalado, Aprobó,
  // Rechazó, Aprobó parcialmente, etc.), no solo las dos originales.
  const partes = bloque.split(/(?=\[[^\]·]+\s*·)/);
  const filas = [];
  partes.forEach(p=>{
    p = p.trim();
    if(!p) return;
    const m = p.match(/^\[([^\]·]+?)(?:\s*·\s*([^\]]+))?\]\s*([\s\S]*)$/);
    if(m){
      const tipo = m[1].trim();
      const autor = (m[2]||'').trim();
      const texto = (m[3]||'').trim();
      if(texto) filas.push(`<div class="!mb-[4px]"><strong>${esc(tipo)}${autor?` · ${esc(autor)}`:''}:</strong> ${esc(texto).replace(/\n/g,'<br>')}</div>`);
    } else {
      filas.push(`<div class="!mb-[4px]">${esc(p).replace(/\n/g,'<br>')}</div>`);
    }
  });
  if(!filas.length) return '';
  return `<div class="!mb-[12px] !p-[10px_12px] ![background:#FEF9E7] ![border:1px_solid_#FDE68A] !rounded-[8px] !text-[13px] !text-[#92400E]">
     <strong>📋 Gestión del pedido:</strong>
     <div class="!mt-[6px]">${filas.join('')}</div>
   </div>`;
}

// Total del pedido SIN mezclar metros con unidades: los rollos/carretes cuentan
// de a 1 (no por sus metros) y los metros sueltos se muestran aparte.
function totalPedidoTxt(items, usarAprobada){
  let uds = 0, rollos = 0, metros = 0;
  (items||[]).forEach(i=>{
    const c = parseFloat(usarAprobada && i.cantidad_aprobada!=null ? i.cantidad_aprobada : i.cantidad) || 0;
    // Acepta ítems de seguimiento (ref_producto/unidad) y de pedido (ref/unidad_envio)
    const ref = i.ref_producto ?? i.ref ?? '';
    const und = i.unidad ?? i.unidad_envio ?? '';
    const prod = (String(ref).startsWith('ONT::') || ref==='FIBRA') ? null : getProductos().find(p=>p.ref===ref);
    const m = parseFloat(prod?.metrosPorUnidad) || 0;
    if(m > 0){                                   // producto en rollos (ej: DROP)
      const n = Math.floor(c/m + 1e-9);
      rollos += n; uds += n;
      const resto = Math.round((c - n*m)*100)/100;
      if(resto > 0) metros += resto;
    } else if(und === 'metros'){      // fibra en metros sueltos
      metros += c;
    } else {
      uds += c;
    }
  });
  let t = uds + ' unidad' + (uds===1?'':'es');
  if(rollos > 0) t += ' (' + rollos + ' rollo' + (rollos===1?'':'s') + ')';
  if(metros > 0) t += ' + ' + (Math.round(metros*100)/100) + ' m';
  return t;
}

async function verDetallePedidoAgrupado(pedidoId) {
  try {
    const res = await fetch('api/pedidos_agrupados.php?action=listar',{credentials:'same-origin'});
    const pedidos = await res.json();
    const pedido = pedidos.find(p=>p.id===pedidoId||p.id===String(pedidoId));
    if(!pedido){ toast('No se encontró el pedido','error'); return; }

    const items = pedido.items || [];
    const itemsHtml = items.map(i=>{
      // Si el producto viene empacado en rollos iguales (ej: DROP), mostrar
      // en rollos (lo que de verdad se entrega) en vez de metros sueltos.
      const prodI  = String(i.ref||'').startsWith('ONT::')||i.ref==='FIBRA' ? null : getProductos().find(p=>p.ref===i.ref);
      const esRolloI = prodI && prodI.metrosPorUnidad > 0;
      const _qS = esRolloI ? cantRolloPartes(prodI,i.cantidad) : null, _qA = esRolloI ? cantRolloPartes(prodI,i.cantidad_aprobada) : null;
      const unidadTxt = esRolloI ? _qS.suf : (i.unidad_envio==='metros'?'mts.':'uds.');
      const cantTxt = esRolloI ? _qS.n : i.cantidad;
      const cantAprobTxt = esRolloI ? (_qA.n+' '+_qA.suf) : i.cantidad_aprobada;
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#F8FAFC;border-radius:8px;margin-bottom:6px;">
        <div>
          <span class="![font-family:monospace] !text-[11px] ![background:#E2E8F0] !p-[1px_6px] !rounded-[4px] !mr-[6px]">${esc(i.ref)}</span>
          <span class="!font-semibold !text-[13px]">${esc(i.nombre)}</span>
        </div>
        <div class="!flex !items-center !gap-[8px]">
          <div class="!text-right">
            <div class="!font-bold !text-[13px]">
              ${cantTxt} <span class="!text-[11px] !font-normal !text-[#94A3B8]">${unidadTxt}</span>
              ${i.cantidad_aprobada!=null && i.cantidad_aprobada!=i.cantidad ? `<span class="!text-[11px] !text-[#B45309]"> → aprobado: ${cantAprobTxt}</span>` : ''}
            </div>
            <span class="badge ${i.estado==='aprobada'?'badge-ok':i.estado==='rechazada'?'badge-danger':'badge-warn'}" style="font-size:10px;">${i.estado==='aprobada'?'✓ Aprobado':i.estado==='rechazada'?'✕ Rechazado':'Pendiente'}</span>
          </div>
        </div>
      </div>`;
    }).join('');

    // Mostrar en modal de detalle
    const modal = document.getElementById('modalDetallePedido');
    const body  = document.getElementById('modalDetallePedidoBody');
    if(!modal||!body){ toast('Modal no encontrado','error'); return; }
    // Separar la nota original del municipio (etiqueta [Solicitud · x], si la
    // tiene) de todas las demás notas de gestión que se le fueron agregando
    // después (Escalado, Aprobó, Rechazó, etc. — cualquier etiqueta nueva).
    let notaCompleta = (pedido.nota||'').trim();
    let notaMunicipio = '';
    const mSol = notaCompleta.match(/^\[Solicitud\s*·\s*[^\]]+\]\s*([\s\S]*?)(?=\[[^\]·]+\s*·|$)/);
    if(mSol){
      notaMunicipio = mSol[1].trim();
      notaCompleta = notaCompleta.slice(mSol[0].length).trim();
    } else {
      // Notas viejas, de antes de este cambio: sin etiqueta al principio
      const idxGestion = notaCompleta.search(/\[[^\]·]+\s*·/);
      notaMunicipio = idxGestion>=0 ? notaCompleta.slice(0,idxGestion).trim() : notaCompleta;
      notaCompleta = idxGestion>=0 ? notaCompleta.slice(idxGestion).trim() : '';
    }
    const bloqueGestion = notaCompleta;
    if(notaMunicipio === 'Pedido múltiple') notaMunicipio = '';

    const notaMunHtml = notaMunicipio
      ? `<div class="!mb-[12px] !p-[10px_12px] ![background:#EFF6FF] ![border:1px_solid_#BFDBFE] !rounded-[8px] !text-[13px] !text-[#1E40AF]">
           <strong>📝 Nota del municipio:</strong><br>${esc(notaMunicipio).replace(/\n/g,'<br>')}
         </div>` : '';
    const notaGesHtml = _formatNotasGestion(bloqueGestion);

    body.innerHTML = `
      <div class="!text-[12px] !text-[#64748B] !mb-[12px]">
        Solicitado por <strong>${escU(pedido.solicitado_por)}</strong> · ${fmtDate(pedido.fecha)}
      </div>
      ${notaMunHtml}
      ${notaGesHtml}
      ${itemsHtml}
      <div class="!mt-[12px] !p-[8px_12px] ![background:#EAF3DE] !rounded-[8px] !text-[12px] !text-[#166534] !font-semibold">
        ${items.every(i=>i.estado==='pendiente'||i.estado==='en_gestion')
          ? `Total solicitado: ${totalPedidoTxt(items,false)}`
          : `Total aprobado: ${totalPedidoTxt(items,true)}`}
      </div>`;
    modal.classList.add('open');
  } catch(e) { toast('Error al cargar detalle','error'); }
}

function verDetalleSolicitudIndividual(id){
  const s = getSolicitudes().find(x=>String(x.id)===String(id));
  if(!s){ toast('Solicitud no encontrada','error'); return; }
  mostrarConfirmar({
    icono:'👁', color:'#0369A1',
    titulo: s.nombre||'Solicitud',
    desc: `<div class="!text-left !text-[13px] !leading-[1.7]">
      <div><strong>Solicitó:</strong> ${escU(s.solicitadoPor||'—')}</div>
      <div><strong>Destino:</strong> ${esc(s.destino||'—')}</div>
      <div><strong>Cantidad:</strong> ${s.cantidad||0} ${s.unidadEnvio==='metros'?'mts.':'uds.'}</div>
      <div><strong>Estado:</strong> ${esc(s.estado||'—')}</div>
      ${s.nota||s.justificacion?`<div style="margin-top:6px;background:#F8FAFC;padding:6px 10px;border-radius:8px;border-left:3px solid #CBD5E1;">💬 ${esc(s.nota||s.justificacion)}</div>`:''}
    </div>`,
    btnTxt:'Cerrar', btnColor:'#0369A1',
    soloInfo:true,
    onConfirmar: ()=>{}
  });
}
async function atenderSolicitudDistrib(id){
  mostrarConfirmar({
    icono:'✓', color:'#16A871',
    titulo:'Atender solicitud',
    desc:'¿Confirmas que atendiste esta solicitud? Pasará al administrador para aprobación final.',
    btnTxt:'Sí, atender',
    btnColor:'#16A871',
    withNotes:true,
    onConfirmar: async(nota)=>{
      try{
        await _api('solicitudes','escalar',{id, nota: nota||''});
        await Promise.all([_recargarSolicitudes(),_recargarPedidosAgrupados()]);
        renderSolicitudesMunicipio();renderMisSolicitudes();renderStats();updateNotifBadges();
        toast('Solicitud atendida — el admin la aprobará ✓','success');
      }catch(e){ toast(e.message||'Error','error'); }
    }
  });
}

async function abrirGestionPedido(pedidoId) {
  try {
    const res = await fetch('api/pedidos_agrupados.php?action=listar', {credentials:'same-origin'});
    const pedidos = await res.json();
    const pedido = pedidos.find(p => p.id === pedidoId);
    if (!pedido) { toast('Pedido no encontrado','error'); return; }
    _pedidoGestionActual = pedido;

    document.getElementById('gestionPedidoTitulo').textContent = `Pedido de ${pedido.destino}`;
    document.getElementById('gestionPedidoSubtitulo').textContent =
      `${pedido.total_items} productos · Solicitado por ${pedido.solicitado_por} · ${fmtDate(pedido.fecha)}`;

    // Mostrar notas: la original del municipio y, si existe, las de gestión (con autor).
    const notaPrev = document.getElementById('gestionPedidoNotaPrevia');
    if(notaPrev){
      const txt=(pedido.nota||'').trim();
      const idxG = txt.search(/\[(Gestión|Gestion|Escalado)/);
      let notaMun = idxG>=0 ? txt.slice(0,idxG).trim() : txt;
      const bloqueGes = idxG>=0 ? txt.slice(idxG).trim() : '';
      if(notaMun === 'Pedido múltiple') notaMun = '';
      let html='';
      if(notaMun){
        html += `<div class="!mb-[8px]"><strong>📝 Nota del municipio${pedido.solicitado_por?` · ${escU(pedido.solicitado_por)}`:''}:</strong><br>${esc(notaMun).replace(/\n/g,'<br>')}</div>`;
      }
      const gesHtml = _formatNotasGestion(bloqueGes);
      if(notaMun || gesHtml){
        // Reusar el contenedor: nota municipio arriba + bloque de gestión (que ya trae su propio recuadro)
        notaPrev.innerHTML = (notaMun?`<div style="margin-bottom:${gesHtml?'10px':'0'};color:#1E40AF;"><strong>📝 Nota del municipio${pedido.solicitado_por?` · ${escU(pedido.solicitado_por)}`:''}:</strong><br>${esc(notaMun).replace(/\n/g,'<br>')}</div>`:'') + gesHtml;
        notaPrev.style.display='';
        notaPrev.style.background='transparent';
        notaPrev.style.border='none';
        notaPrev.style.padding='0';
      } else {
        notaPrev.style.display='none';
      }
    }

    // Traer el stock REAL de ONTs (tabla ont_seriales) agrupado por modelo,
    // para no depender de getProductos() que no incluye ONTs.
    _ontStockMap = {};
    try {
      const resOnt = await fetch('api/cajas.php?action=onts_disponibles_modelo', {credentials:'same-origin'});
      const ontStock = await resOnt.json();
      const rowsAlmacen = Array.isArray(ontStock?.almacen) ? ontStock.almacen : [];
      if (Array.isArray(rowsAlmacen)) {
        rowsAlmacen.forEach(o => {
          _ontStockMap[String(o.modelo||'').toLowerCase().trim()] = parseInt(o.cantidad)||0;
        });
      }
    } catch(e) { /* si falla, se usa 0 y no se rompe el resto del modal */ }

    // Traer metros reales disponibles por categoría de fibra (tabla fibra_carretes).
    _fibraStockMap = {};
    try {
      const resFibra = await fetch('api/fibra.php?action=categorias', {credentials:'same-origin'});
      const cats = await resFibra.json();
      if (Array.isArray(cats)) {
        cats.forEach(c => { _fibraStockMap[String(c.id)] = parseFloat(c.metros_disponibles)||0; });
      }
    } catch(e) { /* idem */ }

    _modoRechazoGestion = false; _btnConfGuardado = null;
    { const _l=document.getElementById('gestionPedidoNotaLbl'); if(_l) _l.textContent='Nota / observación (opcional)'; const _b=document.getElementById('gestionPedidoNota'); if(_b) _b.style.borderColor=''; const _r=document.getElementById('btnRechazarTodoGestion'); if(_r) _r.textContent='✕ Rechazar todo'; }
    _renderGestionItems(pedido.items);
    document.getElementById('gestionPedidoNota').value = '';
    // El distribuidor gestiona (ajusta + manda al admin); el admin (o con permiso) aprueba/despacha.
    const btnConf = document.getElementById('btnConfirmarGestion');
    const btnEsc  = document.getElementById('btnEscalarGestion');
    const btnRechTodo = document.getElementById('btnRechazarTodoGestion');
    if(btnEsc) btnEsc.style.display='none';
    const puedeAprobar = sesion?.rol==='superadmin' || tienePermiso('aprobar_pedidos');
    if(btnRechTodo) btnRechTodo.style.display = puedeAprobar ? 'flex' : 'none';
    if(btnConf){
      if(puedeAprobar){
        btnConf.textContent = '✓ Aprobar pedido';
        btnConf.dataset.modo = 'gestionar';
        btnConf.style.background = '';
      } else {
        btnConf.textContent = '✓ Gestionar y enviar al admin';
        btnConf.dataset.modo = 'escalar';
        btnConf.style.background = '';
      }
    }
    document.getElementById('modalGestionPedido')?.classList.add('open');
  } catch(e) { toast(e.message||'Error','error'); }
}

function _stockOntDisponible(refOnt) {
  // refOnt viene como "ONT::<modelo>". Busca en _ontStockMap (modelo -> cantidad)
  // con coincidencia exacta y, si no, parcial (igual que hace el backend).
  const modelo = String(refOnt||'').replace('ONT::','').trim().toLowerCase();
  if (!modelo) return 0;
  if (_ontStockMap[modelo] !== undefined) return _ontStockMap[modelo];
  const claveParcial = Object.keys(_ontStockMap).find(k => k.includes(modelo) || modelo.includes(k));
  return claveParcial ? _ontStockMap[claveParcial] : 0;
}

function _stockFibraDisponible(item) {
  const catId = item.categoria_fibra_id;
  if (catId == null || _fibraStockMap[String(catId)] === undefined) return 0;
  return _fibraStockMap[String(catId)];
}

function _renderGestionItems(items) {
  const el = document.getElementById('gestionPedidoItems');
  if (!el) return;
  el.innerHTML = items.map((item, i) => {
    const esOnt      = String(item.ref||'').startsWith('ONT::');
    const esFibra    = item.ref === 'FIBRA';
    const prod       = (esOnt||esFibra) ? null : getProductos().find(p=>p.ref===item.ref);
    const stockDisp  = esOnt ? _stockOntDisponible(item.ref) : esFibra ? _stockFibraDisponible(item) : (prod ? _stockCentral(prod) : 0);
    const rechazado  = item.estado === 'rechazada';
    const cantInicial = item.cantidad_aprobada != null ? item.cantidad_aprobada : item.cantidad;
    const stockColor  = stockDisp >= item.cantidad ? '#16A871' : stockDisp > 0 ? '#B45309' : '#B91C1C';
    // Si el producto viene empacado en rollos iguales (ej: DROP), se entrega
    // el rollo completo — mostrar y editar en rollos, no en metros sueltos.
    const esRollo     = prod && prod.metrosPorUnidad > 0;
    const sufRollo     = esRollo ? ' rollo'+(valorMostrar(prod,item.cantidad)!=1?'s':'') : '';
    const sufRolloDisp  = esRollo ? ' rollo'+(valorMostrar(prod,stockDisp)!=1?'s':'') : '';
    const solicitoTxt   = esRollo ? valorMostrar(prod,item.cantidad) : item.cantidad;
    const stockTxt      = esRollo ? valorMostrar(prod,stockDisp) : stockDisp;
    const cantInicialTxt = esRollo ? valorMostrar(prod,cantInicial) : cantInicial;
    return `
    <div style="background:#F8FAFC;border-radius:12px;padding:12px 14px;border:1.5px solid ${rechazado?'#FECACA':'#E2E8F0'};">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div class="![flex:1]">
          <div class="!font-semibold !text-[13px]">${esc(item.nombre)}</div>
          <div class="!text-[11px] !text-[#94A3B8]">Ref: ${esc(item.ref)} · Solicitó: <strong>${solicitoTxt}${sufRollo}</strong> · Stock almacén: <strong style="color:${stockColor};">${stockTxt}${sufRolloDisp}</strong></div>
        </div>
        <div class="!flex !items-center !gap-[8px]">
          <div style="display:flex;flex-direction:column;align-items:center;min-width:70px;">
            <label class="!text-[11px] !text-[#64748B] !block !mb-[2px] !whitespace-nowrap">Cantidad a aprobar${esRollo?' (rollos)':''}</label>
            <input type="number" min="0" ${esRollo?'step="1"':''} value="${cantInicialTxt}"
              id="gestion_cant_${item.id}"
              ${esRollo?`data-rollo="1" data-metros-unidad="${prod.metrosPorUnidad}"`:''}
              style="width:70px;text-align:center;border:1.5px solid #E2E8F0;border-radius:7px;padding:4px 6px;font-weight:600;${(!(sesion?.rol==='superadmin'||tienePermiso('aprobar_pedidos')))?'background:#F1F5F9;color:#94A3B8;cursor:not-allowed;':''}"
              ${(rechazado||!(sesion?.rol==='superadmin'||tienePermiso('aprobar_pedidos')))?'disabled':''}>
            ${(!(sesion?.rol==='superadmin'||tienePermiso('aprobar_pedidos')))?'<div class="!text-[10px] !text-[#94A3B8] !mt-[2px] !text-center">🔒 Solo el admin la cambia</div>':''}
          </div>
          ${(sesion?.rol==='superadmin'||tienePermiso('aprobar_pedidos')) ? `<div>
            <label class="!text-[11px] !text-[#64748B] !block !mb-[2px]">Estado</label>
            <select id="gestion_est_${item.id}"
              onchange="const s=this;s.style.background=s.value==='aprobada'?'#EAF3DE':'#FCEBEB';s.style.color=s.value==='aprobada'?'#166534':'#B91C1C';s.style.fontWeight='700';"
              style="padding:4px 10px;width:auto;font-size:12px;border-radius:8px;border:1.5px solid #E2E8F0;font-weight:700;
                background:${rechazado?'#FCEBEB':'#EAF3DE'};color:${rechazado?'#B91C1C':'#166534'};">
              <option value="aprobada" ${!rechazado?'selected':''}>✓ Aprobar</option>
              <option value="rechazada" ${rechazado?'selected':''}>✕ Rechazar</option>
            </select>
          </div>` : `<div>
            <label class="!text-[11px] !text-[#64748B] !block !mb-[2px]">Disponibilidad</label>
            <select id="gestion_disp_${item.id}"
              onchange="_toggleDispItem('${item.id}', this.value)"
              style="padding:4px 10px;width:auto;font-size:12px;border-radius:8px;border:1.5px solid #E2E8F0;font-weight:700;background:#EAF3DE;color:#166534;">
              <option value="disponible" selected>✓ Disponible</option>
              <option value="no_disponible">✕ No se puede enviar</option>
            </select>
            <input type="hidden" id="gestion_est_${item.id}" value="en_gestion">
          </div>`}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Selector de ONTs específicas para despachar (lo usa el distribuidor) ──
let _selectorOntItemId = null;
let _selectorOntDisponibles = [];

function _renderSelectorOnt(yaSel){
  const cont = document.getElementById('selectorOntLista');
  if(!cont) return;
  if(!_selectorOntDisponibles.length){
    cont.innerHTML = '<div class="!text-center !text-[#94A3B8] !p-[20px] !text-[13px]">No hay ONTs disponibles de este modelo.</div>';
    return;
  }
  yaSel = yaSel || [];
  cont.innerHTML = _selectorOntDisponibles.map(o=>{
    const checked = yaSel.includes(String(o.id)) ? 'checked' : '';
    return `<label class="!flex !items-center !gap-[10px] !p-[9px_12px] ![border:1px_solid_#E2E8F0] !rounded-[9px] !mb-[6px] !cursor-pointer">
      <input type="checkbox" class="sel-ont-chk" value="${o.id}" ${checked} onchange="_actualizarSelectorOnt()">
      <div>
        <div class="![font-family:monospace] !text-[12px] !font-semibold">SN: ${esc(o.sn||'—')}</div>
        <div class="![font-family:monospace] !text-[11px] !text-[#64748B]">MAC: ${esc(o.mac||'—')}</div>
      </div>
    </label>`;
  }).join('');
  _actualizarSelectorOnt();
}

function _actualizarSelectorOnt(){
  const checks = [...document.querySelectorAll('#selectorOntLista .sel-ont-chk:checked')];
  const max = parseInt(document.getElementById('selectorOntMax').textContent)||0;
  const cont = document.getElementById('selectorOntContador');
  if(cont) cont.textContent = `${checks.length} seleccionada${checks.length!==1?'s':''}`;
  // Avisar si se pasa del máximo
  const btn = document.getElementById('btnConfirmarSelectorOnt');
  if(checks.length>max && max>0){
    if(cont){ cont.style.color='#B91C1C'; cont.textContent += ` (máximo ${max})`; }
    if(btn){ btn.disabled=true; btn.style.opacity='0.5'; }
  } else {
    if(cont) cont.style.color='#64748B';
    if(btn){ btn.disabled=false; btn.style.opacity='1'; }
  }
}

function confirmarSelectorOnt(){
  const checks = [...document.querySelectorAll('#selectorOntLista .sel-ont-chk:checked')];
  const ids = checks.map(c=>c.value);
  const itemId = _selectorOntItemId;
  if(itemId){
    const hidden = document.getElementById(`gestion_ont_ids_${itemId}`);
    if(hidden) hidden.value = ids.join(',');
    const lbl = document.getElementById(`gestion_ont_sel_${itemId}`);
    if(lbl) lbl.textContent = ids.length ? `✓ ${ids.length} ONT${ids.length!==1?'s':''} seleccionada${ids.length!==1?'s':''}` : '';
    // Ajustar la cantidad a aprobar al número de ONTs seleccionadas
    const cantInput = document.getElementById(`gestion_cant_${itemId}`);
    if(cantInput && ids.length) cantInput.value = ids.length;
  }
  cerrarModal('modalSelectorOnt');
}

// Cuando el distribuidor marca un producto como no disponible, pone la cantidad en 0 y lo deshabilita.
function _toggleDispItem(itemId, val){
  const cant = document.getElementById(`gestion_cant_${itemId}`);
  const sel  = document.getElementById(`gestion_disp_${itemId}`);
  if(!cant) return;
  if(val==='no_disponible'){
    cant.dataset.prev = cant.value;
    cant.value = 0;
    cant.disabled = true;
    cant.style.opacity = '0.5';
    if(sel){ sel.style.background='#FCEBEB'; sel.style.color='#B91C1C'; }
  } else {
    cant.disabled = false;
    cant.style.opacity = '1';
    if(cant.dataset.prev!=null && parseInt(cant.value)===0) cant.value = cant.dataset.prev;
    if(sel){ sel.style.background='#EAF3DE'; sel.style.color='#166534'; }
  }
}

// Rechazar todo: se hace AQUÍ MISMO, sin abrir otra ventana. Al tocar "Rechazar todo" el cuadro de
// nota pasa a ser "Motivo del rechazo (obligatorio)" y el botón verde se vuelve rojo "Confirmar rechazo".
let _modoRechazoGestion = false, _btnConfGuardado = null;
function _setModoRechazoGestion(on){
  const btnConf = document.getElementById('btnConfirmarGestion');
  const btnRech = document.getElementById('btnRechazarTodoGestion');
  const lbl = document.getElementById('gestionPedidoNotaLbl');
  const box = document.getElementById('gestionPedidoNota');
  if(!btnConf) return;
  if(on && !_modoRechazoGestion){
    _btnConfGuardado = {txt:btnConf.textContent, modo:btnConf.dataset.modo, bg:btnConf.style.background};
    _modoRechazoGestion = true;
    btnConf.textContent = '✕ Confirmar rechazo'; btnConf.dataset.modo = 'rechazar_todo'; btnConf.style.background = '#B91C1C';
    if(btnRech) btnRech.textContent = '↩ Volver';
    if(lbl) lbl.innerHTML = '📝 Motivo del rechazo <span style="color:#B91C1C;">(obligatorio)</span>';
    if(box){ box.placeholder = 'Ej: no hay stock, pedido duplicado, ya no se necesita…'; box.style.borderColor = '#B91C1C'; setTimeout(()=>box.focus(), 50); }
  } else if(!on && _modoRechazoGestion){
    _modoRechazoGestion = false;
    if(_btnConfGuardado){ btnConf.textContent = _btnConfGuardado.txt; btnConf.dataset.modo = _btnConfGuardado.modo; btnConf.style.background = _btnConfGuardado.bg; }
    if(btnRech) btnRech.textContent = '✕ Rechazar todo';
    if(lbl) lbl.textContent = 'Nota / observación (opcional)';
    if(box){ box.style.borderColor = ''; }
  }
}
function rechazarTodoPedidoGestion(){
  if (!_pedidoGestionActual) return;
  _setModoRechazoGestion(!_modoRechazoGestion);
}
async function _ejecutarRechazoTodoGestion(){
  if (!_pedidoGestionActual) return;
  const box = document.getElementById('gestionPedidoNota');
  const motivo = (box?.value||'').trim();
  if(!motivo){ toast('Escribe el motivo del rechazo','error'); box?.focus(); return; }
  _pedidoGestionActual.items.forEach(item=>{
    const sel = document.getElementById(`gestion_est_${item.id}`);
    if(sel){ sel.value = 'rechazada'; sel.style.background = '#FCEBEB'; sel.style.color = '#B91C1C'; }
  });
  _modoRechazoGestion = false; // el flujo normal usa el botón; se restaura al reabrir
  await confirmarGestionPedido('gestionar');
}
async function confirmarGestionPedido(modo) {
  if (modo === 'rechazar_todo') return _ejecutarRechazoTodoGestion();
  if (!_pedidoGestionActual) return;
  // modo: 'gestionar' (aprobar/rechazar directo) | 'escalar' (mandar al superadmin)
  const esEscalar = (modo === 'escalar');
  let nota = document.getElementById('gestionPedidoNota')?.value.trim() || '';

  // Si el distribuidor marcó productos como "no disponible", anexarlos a la nota para el admin
  if(esEscalar){
    const noDisp = _pedidoGestionActual.items
      .filter(it => document.getElementById(`gestion_disp_${it.id}`)?.value === 'no_disponible')
      .map(it => it.nombre);
    if(noDisp.length){
      const aviso = 'No se puede enviar: ' + noDisp.join(', ');
      nota = nota ? (nota + ' · ' + aviso) : aviso;
    }
  }

  // Validar stock antes de aprobar (aplica a quien gestiona directo: superadmin o distribuidor)
  const errores = [];
  const items = _pedidoGestionActual.items.map(item => {
    const inputCant = document.getElementById(`gestion_cant_${item.id}`);
    const esRolloInput = inputCant?.dataset.rollo === '1';
    const metrosUnidadInput = parseFloat(inputCant?.dataset.metrosUnidad || 0);
    const valorInput = parseFloat(inputCant?.value || 0);
    // Si se edita en rollos, convertir a metros (unidad real guardada) antes de enviar.
    const cantAprob = esRolloInput ? Math.round(valorInput * metrosUnidadInput * 100) / 100 : parseInt(valorInput || 0);
    const estado    = esEscalar ? 'en_gestion' : (document.getElementById(`gestion_est_${item.id}`)?.value || 'aprobada');
    if(!esEscalar && estado === 'aprobada'){
      const esOntItem = String(item.ref||'').startsWith('ONT::');
      const esFibraItem = item.ref === 'FIBRA';
      const prod  = (esOntItem||esFibraItem) ? null : getProductos().find(p=>p.ref===item.ref);
      const stock = esOntItem ? _stockOntDisponible(item.ref) : esFibraItem ? _stockFibraDisponible(item) : (prod ? _stockCentral(prod) : 0);
      if(cantAprob > stock)
        errores.push(esRolloInput
          ? `${item.nombre}: apruebas ${valorMostrar(prod,cantAprob)} rollo(s) pero solo hay ${valorMostrar(prod,stock)} en almacén`
          : `${item.nombre}: apruebas ${cantAprob} pero solo hay ${stock} en almacén`);
      if(cantAprob < 1)
        errores.push(`${item.nombre}: la cantidad debe ser al menos 1`);
    }
    return { id: item.id, cantidad_aprobada: cantAprob, estado };
  });
  if(errores.length){ toast('⚠ ' + errores[0], 'error'); return; }

  try {
    const accionGestion = esEscalar ? 'escalar_items' : 'aprobar_items';
    const res = await fetch(`api/pedidos_agrupados.php?action=${accionGestion}`, {
      method: 'POST', credentials: 'same-origin',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ pedido_id: _pedidoGestionActual.id, items, nota })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error||'Error');
    cerrarModal('modalGestionPedido');
    const msg = esEscalar
      ? `↑ Pedido escalado al superadmin (${items.length} productos)`
      : `✅ ${data.aprobados} aprobados · ${data.rechazados} rechazados`;
    toast(msg, 'success');
    if(data.aviso) setTimeout(()=>mostrarAlertaBloqueo(data.aviso.replace(/⚠️ /g,''),'ONT insuficientes','warn'),400);
    // Recargar y actualizar todo de inmediato sin esperar al polling
    await Promise.all([
      _recargarSolicitudes(),
      _recargarPedidosAgrupados(),
      _recargarProductos(),
      _recargarHistorial(),
    ]);
    renderSolicitudes();
    renderSolicitudesMunicipio();
    renderMisSolicitudes();
    renderTabla();
    renderStats();
    updateNotifBadges();
  } catch(e) { toast(e.message||'Error','error'); }
}


/* ════════════════════════════════════════════════
   HIGHLIGHT — resaltar texto buscado
════════════════════════════════════════════════ */
function hl(text, q){
  if(!q||!text) return esc(text||'');
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return esc(text).replace(re, '<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">$1</mark>');
}