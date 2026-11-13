/* ════════════════════════════════════════════════
   APP DATA — caché en memoria, fuente: PHP/MySQL
════════════════════════════════════════════════ */
let _productos=[], _historial=[], _solicitudes=[], _pedidosMun=[], _usuarios=[];
let _statsHist = {aprobados:0, pendientes:0, rechazados:0, gastos:0};
let _equiposStockData = [];
let sesion=null,editIndex=null,elimIndex=null,envioIndex=null,envioModo=null,pedidoIndex=null,gastarIndex=null,rechazarId=null,permisosUsuarioActual=null,_devolverIdx=null;
let _seguimiento = [];
let _ontsSeleccionadasDespacho = {}; // { [segId]: [ont_id, ...] } — selección manual de MAC/SN al despachar
let _ontsDisponiblesPorItem = {};    // cache { [segId]: [{id,mac,sn,modelo}] }
let _fibraAllocDespacho = {};        // { [segId]: { [carrete_id]: metros } } — reparto manual de metros al despachar
let _fibraCarretesPorItem = {};      // cache { [segId]: [{id,codigo,metros_disponibles,sede_nombre}] }
let _equiposSeleccionadosDespacho = {}; // { [segId]: [equipo_id, ...] } — selección manual de unidad(es) OLT/Mikrotik al despachar una solicitud "Pedir equipos"
let _equiposDisponiblesPorItem = {};    // cache { [segId]: [{id,marca,modelo,sn,mac,sede}] }
let _tabSeg = 'todos';
// Cuántos envíos mostrar a la vez en Seguimiento (0 = todos). "Ver más" suma otro tanto.
let _segPorPagina = 25;
let _segLimite = 25;
function _segCambiarCantidad(v){
  _segPorPagina = parseInt(v,10)||0;
  _segLimite = _segPorPagina;
  try{ localStorage.setItem('segPorPagina', String(_segPorPagina)); }catch(e){}
  renderSeguimiento();
}
function _segVerMas(){
  _segLimite += (_segPorPagina||25);
  renderSeguimiento();
}
try{
  const g = localStorage.getItem('segPorPagina');
  if(g!==null && [0,25,50,100].includes(parseInt(g,10))){ _segPorPagina=parseInt(g,10); _segLimite=_segPorPagina; }
}catch(e){}

// Id de grupo de un envío en Seguimiento: pedido agrupado, "pag_...", etiqueta "Lote: X" o,
// para asignaciones directas hechas una tras otra (ONT + drop + conectores) sin lote, la misma
// persona que asigna + el mismo destinatario + el mismo minuto.
function _grupoSegId(s){
  const loteMatch = (s.notas||'').match(/Lote:\s*(\S+)/);
  const g = s.pedidoAgrupadoId || (s.referencia_id && String(s.referencia_id).startsWith('pag_') ? s.referencia_id : null) || (loteMatch ? loteMatch[1] : null);
  if(g) return g;
  if(s.tipo==='asignacion'){
    const dest = ((s.notas||'').match(/Recoge en persona:\s*(.+?)(?:\s+·\s+.*)?$/mu)||[])[1];
    const f = String(s.fecha_envio||s.fecha_aprobado||'').slice(0,16);
    if(dest && f) return `asg_${s.enviado_por||''}_${dest.trim()}_${f}`;
  }
  return null;
}
async function _recargarSeguimiento(){
  try{ _seguimiento = await _api('seguimiento','listar'); }catch{ _seguimiento=[]; }
}

function setTabSeg(t){
  _tabSeg=t;
  _segLimite=_segPorPagina;
  ['todos','aprobado','en_camino','entregado','recibido'].forEach(id=>{
    const el=document.getElementById('tabSeg_'+id);
    if(el) el.classList.toggle('active',id===t);
  });
  renderSeguimiento();
}

// Compara nombres de sede sin importar mayúsculas/minúsculas ni espacios extra
// (mismo criterio ya usado en el backend, para evitar que un espacio o una
// mayúscula distinta esconda botones que sí deberían mostrarse).
// ¿Esta sesión puede despachar/cancelar este envío aprobado? (misma regla que el servidor)
function _puedeDespacharSeg(s){
  if(sesion.rol==='superadmin') return true;
  const items = s._esGrupo ? s._items : [s];
  return items.every(i=>{
    if(!['solicitud','pedido','asignacion'].includes(i.tipo)) return true;
    const o=(i.origen||'').trim().toLowerCase();
    if(!o || o==='almacen central') return true;
    return sesion.usuario===i.enviado_por || sesion.usuario===i.origen;
  });
}
function _sedesIguales(a,b){
  return (a||'').trim().toLowerCase() === (b||'').trim().toLowerCase();
}
// Cuenta "envíos" como los ve el usuario: un pedido múltiple (varios productos) es UNO,
// igual que la fila que se muestra en la tabla de Seguimiento.
function _contarUnidadesSeg(lista){
  return new Set(lista.map(s=>_grupoSegId(s)||('i'+s.id))).size;
}
function _limpiarFiltrosSeg(){
  _segLimite=_segPorPagina;
  const b=document.getElementById('filtroSegBuscar'); if(b) b.value='';
  const fd=document.getElementById('filtroSegFechaDesde'); if(fd) fd.value='';
  const fh=document.getElementById('filtroSegFechaHasta'); if(fh) fh.value='';
  renderSeguimiento();
}
function renderSeguimiento(){
  const tbody=document.getElementById('tablaSeguimiento');
  if(!tbody)return;
  let items=[..._seguimiento];
  const st=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v||'';};
  st('cntSegAprobado',_contarUnidadesSeg(items.filter(s=>s.estado==='aprobado'))||'');
  st('cntSegCamino',_contarUnidadesSeg(items.filter(s=>s.estado==='en_camino'))||'');
  st('cntSegEntregado',_contarUnidadesSeg(items.filter(s=>s.estado==='entregado'))||'');
  st('cntSegRecibido',_contarUnidadesSeg(items.filter(s=>s.estado==='recibido'))||'');
  if(_tabSeg!=='todos') items=items.filter(s=>s.estado===_tabSeg);

  // Filtro de texto libre: busca en producto, ref, origen, destino,
  // transportador y solicitante — así sirve para encontrar un envío sin
  // saber exactamente en qué campo quedó el dato.
  const qBuscar=(document.getElementById('filtroSegBuscar')?.value||'').trim().toLowerCase();
  if(qBuscar){
    items=items.filter(s=>{
      const campos=[s.nombre_producto,s.ref_producto,s.origen,s.destino,s.transportador,s.solicitado_por,s.entregadoA,s.notas,nombreUsr(s.transportador),nombreUsr(s.solicitado_por),nombreUsr(s.enviado_por),nombreUsr(s.entregadoA),s.enviado_por,s.recibido_por,nombreUsr(s.recibido_por)];
      return campos.some(c=>(c||'').toString().toLowerCase().includes(qBuscar));
    });
  }
  // Filtro por rango de fechas: compara contra la fecha más reciente que
  // tenga el envío (aprobado → enviado → entregado → recibido), para que
  // el filtro encuentre el envío sin importar en qué paso esté.
  const qDesde=document.getElementById('filtroSegFechaDesde')?.value||'';
  const qHasta=document.getElementById('filtroSegFechaHasta')?.value||'';
  if(qDesde || qHasta){
    items=items.filter(s=>{
      const fechaRef = s.fecha_recibido || s.fecha_entrega || s.fecha_envio || s.fecha_aprobado;
      if(!fechaRef) return false;
      const soloFecha = String(fechaRef).slice(0,10);
      if(qDesde && soloFecha < qDesde) return false;
      if(qHasta && soloFecha > qHasta) return false;
      return true;
    });
  }

  if(!items.length){
    tbody.innerHTML='<tr><td class="!p-[32px] !text-center !text-[#94A3B8] !text-[13px]" colspan="9">Sin envíos que coincidan con los filtros.</td></tr>';
    const _i0=document.getElementById('segInfoCantidad'); if(_i0) _i0.textContent='';
    return;
  }
  const estadoInfo = {
    aprobado:  { label:'Por despachar', cls:'badge-warn', icon:'⏳' },
    en_camino: { label:'En camino',  cls:'badge-brand',   icon:'🚚' },
    entregado: { label:'Entregado',  cls:'badge-purple',  icon:'📦' },
    recibido:  { label:'Recibido',   cls:'badge-ok',      icon:'✅' },
    cancelado: { label:'Cancelado',  cls:'badge-danger',  icon:'✕' },
  };
  // Agrupar items del mismo pedido agrupado (por pag_ o por pedidoAgrupadoId)
  const gruposSeg = [];
  const yaVistosRef = new Set();
  items.forEach(s=>{
    const pagId = _grupoSegId(s);
    if(pagId){
      if(!yaVistosRef.has(pagId)){
        yaVistosRef.add(pagId);
        const delGrupo = items.filter(x=>_grupoSegId(x)===pagId);
        gruposSeg.push((()=>{
          // Estado consolidado del grupo: el menos avanzado de sus items,
          // para que el pedido se trate como una unidad. Orden de avance:
          const orden = {aprobado:0, en_camino:1, entregado:2, recibido:3, cancelado:-1};
          let estadoGrupo = delGrupo[0].estado;
          let minRank = 99;
          delGrupo.forEach(it=>{
            const r = orden[it.estado] ?? 0;
            if(it.estado!=='cancelado' && r < minRank){ minRank = r; estadoGrupo = it.estado; }
          });
          // Si todos están recibidos, el grupo está recibido
          const todosRecibidos = delGrupo.every(it=>it.estado==='recibido');
          if(todosRecibidos) estadoGrupo='recibido';
          // Transportador consolidado: solo si TODOS los ítems "en camino" comparten
          // el mismo transportador. Si hay mezcla (ej. por un reenvío parcial viejo),
          // se marca como mixto para no mostrar/permitir acciones con datos incorrectos.
          const enCaminoItems = delGrupo.filter(it=>it.estado==='en_camino');
          const transportadores = [...new Set(enCaminoItems.map(it=>it.transportador||''))];
          const transportadorMixto = transportadores.length > 1;
          const transportadorConsolidado = transportadorMixto ? null : (transportadores[0] ?? s.transportador);
          return {...s, estado:estadoGrupo, transportador:transportadorConsolidado, _transportadorMixto:transportadorMixto, _esGrupo:true, _items:delGrupo, _pagId:pagId};
        })());
      }
    } else {
      gruposSeg.push(s);
    }
  });

  const _totalSeg = gruposSeg.length;
  const _visiblesSeg = _segLimite>0 ? gruposSeg.slice(0,_segLimite) : gruposSeg;
  tbody.innerHTML = _visiblesSeg.map(s=>{
    const ei = estadoInfo[s.estado] || {label:s.estado,cls:'badge-gray',icon:'•'};
    const rol = sesion.rol;
    let acciones = '';
    const esDuenioDevolucionFibra = s.tipo==='fibra_devolucion' && _sedesIguales(sesion.sede, s.origen);
    if(s.estado==='aprobado' && (rol==='superadmin'||tienePermiso('despachar')||esDuenioDevolucionFibra) && _puedeDespacharSeg(s)){
      const idsAprobados = s._esGrupo ? s._items.filter(i=>i.estado==='aprobado').map(i=>i.id) : [s.id];
      const _puedeCancelarAprob = (s._esGrupo ? s._items : [s]).every(i=>['solicitud','pedido','olt','mikrotik','asignacion'].includes(i.tipo));
      acciones = `<div style="display:flex;flex-direction:column;gap:4px;"><button onclick="${s._esGrupo?`abrirEnCaminoGrupo('${idsAprobados.join(',')}')`:`abrirEnCamino(${s.id})`}" class="btn-sm ![background:#E6F1FB] !text-[#0C6EDE]">🚚 Despachar</button>${_puedeCancelarAprob?`<button onclick="abrirCancelarAprobado('${idsAprobados.join(',')}')" class="btn-sm ![background:#FEF2F2] !text-[#B91C1C]">✕ Cancelar</button>`:''}</div>`;
    } else if(s.estado==='en_camino'){
      // Para devoluciones (recogido/ont_devolucion), no importa si el que
      // "lleva" es el mismo técnico u otra persona — el único paso real
      // que importa es que alguien EN el almacén confirme que llegó, sin
      // un paso intermedio de "confirmar entrega" en medio.
      // Un OLT/Mikrotik asignado DIRECTO a una persona (no un despacho de
      // sede a sede) se reconoce porque el envío ya nace en 'en_camino'
      // con el mismo usuario como enviado_por Y transportador (igual que
      // 'asignacion' de productos) — así no exige el paso intermedio de
      // "confirmar entrega" que sí aplica a un despacho real de sede a sede.
      const esAsignEquipoDirecta = (s.tipo==='olt'||s.tipo==='mikrotik') && s.enviado_por && s.transportador===s.enviado_por;
      const esFibraDev = s.tipo==='fibra' && /Devoluci[oó]n:\s*s[ií]/i.test(s._esGrupo ? (s._items[0]?.notas||s.notas||'') : (s.notas||''));
      const esDevolucion  = s.tipo==='recogido' || s.tipo==='ont_devolucion' || s.tipo==='devolucion_stock' || s.tipo==='asignacion' || esAsignEquipoDirecta || esFibraDev;
      // Material recogido llevado por OTRO usuario del sistema: ese usuario confirma la
      // entrega primero y el almacén recibe después (como un despacho normal).
      const _transpInternoRec = (s.tipo==='recogido'||s.tipo==='devolucion_stock'||s.tipo==='ont_devolucion'||esFibraDev) && !!s.transportador && !(s.transportador||'').startsWith('EXT:') && s.transportador!==s.enviado_por;
      const esExterno     = (esDevolucion && !_transpInternoRec) || (s.transportador||'').startsWith('EXT:');
      const esTransportador = !esExterno && sesion.usuario===s.transportador;
      // En una devolución, origen y destino pueden ser LA MISMA sede (ej:
      // un técnico devolviendo a su propio municipio) — sin este chequeo,
      // el sistema pensaría que quien ENVIÓ también está "en la sede
      // destino" y le dejaría confirmarse a sí mismo su propia devolución.
      const esQuienEnvio  = sesion.usuario === s.enviado_por;
      // Solo el usuario que hizo la solicitud puede confirmar la recepción
      // — PERO cuando quien "solicitó" es en realidad superadmin/distribuidor
      // (porque así se guarda un "Enviar directo": el creador queda como
      // solicitante, a propósito, para no mezclar "quien transporta" con
      // "quien pidió"), esa restricción no tiene a quién aplicarle: nadie
      // en la oficina destino ES superadmin/distribuidor. En ese caso,
      // cualquiera en la sede destino puede confirmar.
      const solicitante   = s._esGrupo ? (s._items[0]?.solicitado_por||s.solicitado_por) : s.solicitado_por;
      const solicitanteRol = s._esGrupo ? (s._items[0]?.solicitanteRol||s.solicitanteRol) : s.solicitanteRol;
      const esEnvioDirectoSinSolicitanteReal = solicitanteRol==='superadmin' || solicitanteRol==='distribuidor';
      // Si es un "Enviar directo" (solicitante = superadmin/distribuidor,
      // no una persona real), primero se revisa si se eligió un
      // destinatario específico ("Recoge en persona: X" en las notas) —
      // solo si NO se eligió nadie en particular, se abre a cualquiera en
      // la sede destino. Sin este chequeo, el transportador podía
      // confirmárselo a sí mismo con el botón completo, con tal de vivir
      // en la misma sede destino — aunque el envío fuera para alguien más.
      const notasParaRecoge = s._esGrupo ? (s._items[0]?.notas||s.notas) : s.notas;
      const mRecogeSolicitante = (notasParaRecoge||'').match(/Recoge en persona:\s*(.+?)(?:\s+·\s+.*)?$/mu);
      const destinatarioEspecifico = mRecogeSolicitante ? mRecogeSolicitante[1].trim() : null;
      // Si se eligió un destinatario específico, o si hay un solicitante
      // real identificado (una persona, no un "Enviar directo" de admin),
      // esa persona puede confirmar aunque la sede registrada en su cuenta
      // no coincida exactamente con la sede destino del envío (pueden no
      // coincidir por distintos motivos administrativos) — lo que de
      // verdad importa es que sea la persona indicada, no que su sede
      // tenga el mismo nombre en texto.
      const esSedeDest    = (
        _sedesIguales(sesion.sede, s.destino) ||
        (destinatarioEspecifico && sesion.usuario===destinatarioEspecifico) ||
        (solicitante && !esEnvioDirectoSinSolicitanteReal && sesion.usuario===solicitante) ||
        // Devoluciones al Almacén Central: cualquier superadmin/distribuidor
        // (que no sea quien la envió) puede recibirla, aunque su sede escrita no coincida.
        (esDevolucion && _sedesIguales(s.destino,'Almacen Central') && (rol==='superadmin'||rol==='distribuidor'))
      ) && !(esDevolucion && esQuienEnvio);
      const puedeCancelar = esQuienEnvio;
      const esSolicitante = destinatarioEspecifico
        ? sesion.usuario===destinatarioEspecifico
        : (!solicitante || esEnvioDirectoSinSolicitanteReal || sesion.usuario===solicitante);
      // Transporte externo: la sede destino confirma directamente recibido
      // Transportador usuario: él confirma entrega, luego sede confirma recibido
      // El transportador cierra el ciclo completo (entrega+recibido) con un solo botón
      // SOLO si él mismo es quien solicitó el material. Si el transportador es de la
      // sede destino pero NO fue el solicitante, solo confirma la entrega; el recibido
      // lo confirma el usuario que hizo la solicitud.
      // Devoluciones/recogidos con transportador interno distinto de quien envía: el transportador SOLO confirma la entrega; la oficina destino confirma el recibido.
      // Excepción: si el transportador ES la misma persona elegida para recibir ("Recoge en persona: X"),
      // no hay nadie más que confirme el recibido, así que cierra el ciclo completo él mismo.
      const _transpEsDestinatario = !!destinatarioEspecifico && sesion.usuario===destinatarioEspecifico;
      const esMismoUsuarioDestino = esTransportador && esSedeDest && esSolicitante && (!_transpInternoRec || _transpEsDestinatario);
      // ¿Hay un transportador asignado que todavía no ha entregado?
      // Si lo hay, el solicitante debe ESPERAR a que entregue antes de poder confirmar recibido.
      // ¿Hay un transportador INTERNO (con usuario en el sistema) que aún no entrega?
      // Los transportadores externos (EXT:) no tienen usuario y nunca confirmarán entrega,
      // así que en ese caso el solicitante puede confirmar el recibido directamente.
      // Asignación directa (oficina → técnico, sale de su propio stock): el
      // material ya está con quien lo asigna, así que no hay entrega que
      // esperar — el destinatario puede confirmar el recibido de una vez.
      const _esAsigDirecta = (s._esGrupo ? s._items : [s]).every(i=>/^Asignaci[oó]n directa a/m.test(i.notas||''));
      const hayTransportadorPendiente = !!(s.transportador) && !esExterno && !esMismoUsuarioDestino && !_esAsigDirecta;
      acciones = `<div style="display:flex;flex-direction:column;gap:4px;">
        ${esMismoUsuarioDestino ? `<button onclick="confirmarRecepcionCompleta('${s._esGrupo?s._items.filter(i=>i.estado==='en_camino'||i.estado==='entregado').map(i=>i.id).join(','):s.id}')" class="btn-sm ![background:#16A871] ![color:white] !font-semibold">✅ Confirmar recepción</button>` : ''}
        ${!esMismoUsuarioDestino && !hayTransportadorPendiente && esSedeDest && esSolicitante && !esTransportador ? `<button onclick="${s._esGrupo?`confirmarRecibidoGrupo('${s._items.filter(i=>i.estado==='en_camino'||i.estado==='entregado').map(i=>i.id).join(',')}')`:`confirmarRecibido(${s.id})`}" class="btn-sm ![background:#EAF3DE] !text-[#166534]">✅ Confirmar recibido</button>` : ''}
        ${!esMismoUsuarioDestino && !esExterno && esTransportador && !_esAsigDirecta ? `<button onclick="${s._esGrupo?`confirmarEntregaGrupo('${s._items.filter(i=>i.estado==='en_camino').map(i=>i.id).join(',')}')`:`abrirConfirmarEntrega(${s.id})`}" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6]">📦 Confirmar entrega</button>` : ''}
        ${hayTransportadorPendiente && esSedeDest && esSolicitante ? `<span class="!text-[11px] !text-[#94A3B8] ![font-style:italic]">Esperando que ${escU(s.transportador)} confirme la entrega…</span>` : ''}
        ${puedeCancelar ? `<button onclick="abrirCancelarDespacho('${s._esGrupo ? s._items.filter(i=>i.estado==='en_camino').map(i=>i.id).join(',') : s.id}')" class="btn-sm ![background:#FEF2F2] !text-[#B91C1C]">✕ Cancelar despacho</button>` : ''}
      </div>`;
      if(!esSedeDest && !esTransportador && !puedeCancelar) acciones='';
    } else if(s.estado==='entregado'){
      // El usuario que hizo la solicitud confirma la recepción. El
      // transportador normalmente NO recibe (ya cumplió su parte al
      // entregar) — EXCEPCIÓN: en un "Enviar directo" sin solicitante real
      // (admin/distribuidor creó el envío para alguien que "recoge en
      // persona"), no hay nadie más registrado como solicitante, así que
      // cualquiera en la sede destino puede confirmar (menos el propio
      // transportador, que ya cumplió su parte al entregar).
      const solicitanteE = s._esGrupo ? (s._items[0]?.solicitado_por||s.solicitado_por) : s.solicitado_por;
      const solicitanteRolE = s._esGrupo ? (s._items[0]?.solicitanteRol||s.solicitanteRol) : s.solicitanteRol;
      const esEnvioDirectoSinSolicitanteRealE = solicitanteRolE==='superadmin' || solicitanteRolE==='distribuidor';
      const notasParaRecogeE = s._esGrupo ? (s._items[0]?.notas||s.notas) : s.notas;
      const mRecogeE = (notasParaRecogeE||'').match(/Recoge en persona:\s*(.+?)(?:\s+·\s+.*)?$/mu);
      const destinatarioEspecificoE = mRecogeE ? mRecogeE[1].trim() : null;
      const esTranspE = sesion.usuario===s.transportador;
      const enSedeDestE = _sedesIguales(sesion.sede, s.destino);
      // Si se eligió un destinatario específico, o si hay un solicitante
      // real identificado, esa persona confirma sin importar si la sede de
      // su cuenta coincide exactamente con la del envío — igual que arriba,
      // en "en_camino". Solo cuando NO hay nadie identificable (un "Enviar
      // directo" sin destinatario elegido) se exige estar en la sede destino.
      const esSolicitanteE = destinatarioEspecificoE
        ? sesion.usuario===destinatarioEspecificoE
        : ((solicitanteE && !esEnvioDirectoSinSolicitanteRealE)
            ? sesion.usuario===solicitanteE
            : enSedeDestE);
      if(esSolicitanteE && (!esTranspE || (destinatarioEspecificoE && sesion.usuario===destinatarioEspecificoE))){
        acciones = `<button onclick="${s._esGrupo?`confirmarRecibidoGrupo('${s._items.filter(i=>i.estado==='entregado'||i.estado==='en_camino').map(i=>i.id).join(',')}')`:`confirmarRecibido(${s.id})`}" class="btn-sm ![background:#EAF3DE] !text-[#166534]">✅ Confirmar recibido</button>`;
      } else if(esSolicitanteE || enSedeDestE){
        const quien = destinatarioEspecificoE || solicitanteE || 'el solicitante';
        acciones = `<span class="!text-[11px] !text-[#94A3B8] ![font-style:italic]">Esperando que ${escU(quien)} confirme la recepción…</span>`;
      }
    }
    // Sin botón PDF en seguimiento — el PDF está disponible en Historial de envíos
    const fechas = [
      s.fecha_aprobado ? '✓ Aprobado: '+fmtDate(s.fecha_aprobado) : '',
      s.fecha_envio    ? '🚚 Enviado: '+fmtDate(s.fecha_envio) : '',
      s.fecha_entrega  ? '📦 Entregado: '+fmtDate(s.fecha_entrega)+(s.entregadoA?' a '+escU(s.entregadoA):'') : '',
      s.fecha_recibido ? '✅ Recibido: '+fmtDate(s.fecha_recibido) : '',
    ].filter(Boolean).join('<br>');
    // Para grupos, unir notas únicas de todos los items (sin duplicar por
    // mayúsculas/espacios). La nota general escrita al crear el envío se
    // copia igual en CADA item del pedido — y al despachar, cada item le
    // pega SU propio dato (" · Carretes: ...", " · EquipoIDs: ...") al
    // final de esa misma línea. Antes se deduplicaba por línea EXACTA, así
    // que esa nota general sobrevivía dos veces: una con el "· Carretes…"
    // de un item y otra sin sufijo (la de otro item que no lo necesitaba).
    // Ahora se agrupa por el texto ANTES del " · ", y de cada grupo se
    // conserva la versión más completa (la que tenga el sufijo).
    const notas = s._esGrupo
      ? (() => {
          const orden = [];
          const mejorPorClave = {};
          s._items.forEach(i => (i.notas||'').split(/\n/).forEach(ln => {
            const t = ln.trim();
            if(!t) return;
            const idxSep = t.indexOf(' · ');
            const clave = (idxSep >= 0 ? t.slice(0, idxSep) : t).trim().toLowerCase();
            if(!clave) return;
            if(!(clave in mejorPorClave)) orden.push(clave);
            if(!(clave in mejorPorClave) || t.length > mejorPorClave[clave].length) mejorPorClave[clave] = t;
          }));
          return orden.map(c => mejorPorClave[c]).join('\n');
        })()
      : (s.notas || '');
    const tieneCancel  = notas.includes('CANCELADO:');
    const tieneReenvio = notas.includes('Re-enviado el');
    // Construir historial de gestión visual línea por línea (cancelaciones, reenvíos, comentarios).
    // Cada tipo de línea se distingue con su propio color/ícono/etiqueta —
    // antes todo (nota de despacho, destinatario, seriales, nota de
    // entrega...) se veía igual (💬 genérico), lo que hacía confuso saber
    // qué era cada cosa de un vistazo.
    const notasHtml = notas ? (() => {
      const lineas = notas.split(/\n/);
      let html = '';
      let abierto = null;
      const ESTILOS = {
        entrega: ['#F0FDF4','#86EFAC','#166534','📦 <strong>Entrega:</strong> ','normal'],
        recibido:['#ECFDF5','#6EE7B7','#065F46','✅ <strong>Recibido:</strong> ','normal'],
        libre:   ['#F8FAFC','#CBD5E1','#64748B','💬 ','italic']
      };
      // Pinta la nota abierta: máx. 2 líneas visibles y "ver más" si es larga.
      const flush = () => {
        if(!abierto) return;
        const [bg,bd,col,pre,fs] = ESTILOS[abierto.tipo];
        const txt = abierto.lineas.map(esc).join('<br>');
        const larga = abierto.lineas.length>2 || abierto.lineas.join(' ').length>110;
        html += `<div style="margin-top:2px;padding:3px 8px;background:${bg};border-left:3px solid ${bd};border-radius:0 6px 6px 0;font-size:11px;color:${col};font-style:${fs};">${pre}<span class="nota-cuerpo" style="${larga?'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;':''}">${txt}</span>${larga?` <a href="#" onclick="return toggleNotaLarga(this)" style="color:inherit;text-decoration:underline;font-size:10px;">ver más</a>`:''}</div>`;
        abierto = null;
      };
      lineas.forEach(ln => {
        if(!ln.trim()) return;
        // Líneas internas del sistema: no son comentarios de usuarios, no se muestran.
        if(/^(Recoge en persona|Destinatario ONT|Lote|Rollos elegidos|Devoluci[oó]n):/i.test(ln.trim()) || /^\[STOCK:recuperado\]$/i.test(ln.trim()) || /^Stock:\s*♻️\s*Recuperado$/i.test(ln.trim()) || /^Asignaci[oó]n directa a\b/i.test(ln.trim())) return;
        const mDestinatario = ln.match(/^Destinatario ONT:\s*(.*)$/i);
        const mSeriales     = ln.match(/^Seriales:\s*(.*)$/i);
        const mEntrega      = ln.match(/^\[Entrega\]\s*(.*)$/i);
        const mRecibido     = ln.match(/^\[Recibido\]\s*(.*)$/i);
        const mRollos       = ln.match(/^Rollos elegidos:\s*([\d,\s]+)$/i);
        if(!(mEntrega||mRecibido) && (mRollos || ln.startsWith('CANCELADO:') || ln.startsWith('---') || (mDestinatario&&mDestinatario[1]) || (mSeriales&&mSeriales[1]))) flush();
        if(mRollos) {
          const ids = mRollos[1].split(',').map(x=>x.trim()).filter(Boolean);
          html += `<div style="margin-top:2px;padding:3px 8px;background:#FFF7ED;border-left:3px solid #FDBA74;border-radius:0 6px 6px 0;font-size:11px;color:#9A3412;">🧵 <strong>${ids.length===1?'1 rollo completo':ids.length+' rollos completos'}</strong> <span class="!opacity-[.7]">(código interno ${ids.map(x=>'#'+esc(x)).join(', ')})</span></div>`;
        } else if(ln.startsWith('CANCELADO:')) {
          html += `<div style="margin-top:4px;padding:4px 8px;background:#FEF2F2;border-left:3px solid #FCA5A5;border-radius:0 6px 6px 0;font-size:11px;color:#B91C1C;">⚠ Cancelado: ${esc(ln.replace('CANCELADO:','').trim())}</div>`;
        } else if(ln.startsWith('---')) {
          html += `<div class="!mt-[4px] !text-[10px] !text-[#16A871] !font-bold !tracking-[.03em]">🔄 ${esc(ln.replace(/---/g,'').trim())}</div>`;
        } else if(mDestinatario && mDestinatario[1]) {
          html += `<div style="margin-top:2px;padding:3px 8px;background:#F0F7FF;border-left:3px solid #93C5FD;border-radius:0 6px 6px 0;font-size:11px;color:#1D4ED8;">📡 <strong>Destinatario:</strong> ${esc(mDestinatario[1])}</div>`;
        } else if(mSeriales && mSeriales[1]) {
          const sers = mSeriales[1].split(/[,\s]+/).filter(Boolean);
          html += sers.length>2
            ? `<div style="margin-top:2px;padding:3px 8px;background:#F5F3FF;border-left:3px solid #C4B5FD;border-radius:0 6px 6px 0;font-size:11px;color:#6D28D9;">🔢 <strong>${sers.length} seriales</strong> <a href="#" onclick="return toggleNotaSeriales(this)" style="color:#6D28D9;text-decoration:underline;font-size:10px;">ver</a><div style="display:none;font-family:monospace;word-break:break-all;margin-top:2px;">${sers.map(esc).join('<br>')}</div></div>`
            : `<div style="margin-top:2px;padding:3px 8px;background:#F5F3FF;border-left:3px solid #C4B5FD;border-radius:0 6px 6px 0;font-size:11px;color:#6D28D9;font-family:monospace;">🔢 <strong class="![font-family:inherit]">Seriales:</strong> ${esc(mSeriales[1])}</div>`;
        } else if(mEntrega || mRecibido) {
          // Nota con etiqueta: lo que siga sin etiqueta se agrupa dentro de ella.
          const m = mEntrega || mRecibido;
          if(!m[1]) return;
          flush();
          abierto = {tipo: mEntrega?'entrega':'recibido', lineas:[m[1]]};
        } else {
          // Renglón libre: si sigue a una nota abierta se une a ella; si no, abre un 💬.
          if(abierto) abierto.lineas.push(ln.trim());
          else abierto = {tipo:'libre', lineas:[ln.trim()]};
        }
      });
      flush();
      return html ? `<div>${html}</div>` : '';
    })() : '';
    const esCancelado  = tieneCancel && !tieneReenvio;
    const filaCancelada = esCancelado ? 'background:#FFFBFB;' : tieneReenvio ? 'background:#F0FBF4;' : (s.tipo==='ont_devolucion' && /Estado previo:\s*no_disponible/.test(s.notas||'')) ? 'background:#FEF2F2;' : '';
    const etiquetaTipoEspecial = s.tipo==='recogido'
      ? `<div class="!text-[10px] !font-bold !text-[#166534] ![background:#EAF3DE] !inline-block !p-[1px_6px] !rounded-[4px] !mb-[3px]">♻️ Material recuperado — vuelve al almacén</div><br>`
      : s.tipo==='ont_devolucion'
        ? (/Estado previo:\s*no_disponible/.test(s.notas||'')
            ? `<div class="!text-[10px] !font-bold !text-[#B91C1C] ![background:#FEE2E2] ![border:1px_solid_#FCA5A5] !inline-block !p-[1px_6px] !rounded-[4px] !mb-[3px]">⛔ ONT DAÑADA / NO DISPONIBLE — vuelve al almacén</div><br>`
            : `<div class="!text-[10px] !font-bold !text-[#0369A1] ![background:#E0F6FF] !inline-block !p-[1px_6px] !rounded-[4px] !mb-[3px]">🏭 ONT — vuelve al almacén</div><br>`)
        : /\[STOCK:recuperado\]|Stock:\s*♻️\s*Recuperado/i.test(s.notas||'')
          ? `<div class="!text-[10px] !font-bold !text-[#166534] ![background:#EAF3DE] !inline-block !p-[1px_6px] !rounded-[4px] !mb-[3px]">♻️ Recuperado</div><br>`
          : '';
    const productoCell = s._esGrupo
      ? `<td>
          <div class="!font-bold !text-[13px] !mb-[4px]">📦 Pedido múltiple (${s._items.length} productos)</div>
          <button onclick="verDetalleSeguimientoGrupo('${s.referencia_id}','${s._pagId||''}')" class="btn-sm ![background:#E0F6FF] !text-[#0369A1] !text-[11px]">🔍 Ver detalle</button>
        </td>
        <td style="font-weight:700;">${totalPedidoTxt(s._items,false)} <span class="!text-[11px] !text-[#94A3B8]">total</span></td>`
      : (()=>{
          const pRef = getProductos().find(x=>x.ref===s.ref_producto);
          const _ppR = pRef?.metrosPorUnidad ? cantRolloPartes(pRef, s.cantidad) : null;
          const cantMostrar = _ppR ? _ppR.n : (pRef ? valorMostrar(pRef, s.cantidad) : s.cantidad);
          const sufMostrar = _ppR ? _ppR.suf : (pRef ? sufijoMostrar(pRef) : esc(s.unidad));
          return `<td>${etiquetaTipoEspecial}<span class="![font-family:monospace] !text-[10px] ![background:#F1F5F9] !p-[1px_6px] !rounded-[4px] !mr-[4px]">${esc(s.ref_producto)}</span><strong>${_resaltarTexto(s.nombre_producto,qBuscar)}</strong>${pRef?.proveedor?`<div class="!text-[10px] !text-[#7C3AED] !mt-[2px]">🏭 ${esc(pRef.proveedor)}</div>`:""}</td>
        <td style="font-weight:700;">${cantMostrar} <span class="!text-[11px] !text-[#94A3B8]">${sufMostrar}</span></td>`;
        })();

    return `<tr class="fade-row" style="${filaCancelada}">
      ${productoCell}
      <td>${(()=>{
        // Primero QUIÉN lo envió/despachó (persona), y abajo la sede de origen.
        const envBy = s._esGrupo ? (s._items[0]?.enviado_por||s.enviado_por) : s.enviado_por;
        const sedeO = `<span class="badge badge-gray !text-[11px]">${_resaltarTexto(s.origen,qBuscar)}</span>`;
        if(!envBy) return `<div class="!text-[12px] !font-semibold !text-[#0F172A]">${_resaltarTexto(s.origen,qBuscar)}</div>`;
        return `<div class="!text-[12px] !font-semibold !text-[#0F172A]">👤 ${_resaltarTexto(nombreUsr(envBy),qBuscar)}</div>`;
      })()}</td>
      <td>${(()=>{
        // Primero QUIÉN recibe (persona), y abajo pequeño la sede. Si no hay
        // persona puntual, se muestra la sede como antes.
        const solic = s._esGrupo ? (s._items[0]?.solicitado_por||s.solicitado_por) : s.solicitado_por;
        const notasRef = s._esGrupo ? (s._items[0]?.notas||s.notas) : s.notas;
        const m = (notasRef||'').match(/Recoge en persona:\s*(.+?)(?:\s+·\s+.*)?$/mu) || (notasRef||'').match(/Destinatario ONT:\s*(.+)$/m);
        const persona = m ? m[1].trim() : (solic||'');
        const sede = _resaltarTexto(s.destino,qBuscar);
        if(!persona) return `<div class="!text-[12px] !font-semibold !text-[#0F172A]">${sede}</div>`;
        return `<div class="!text-[12px] !font-semibold !text-[#0F172A]">👤 ${_resaltarTexto(nombreUsr(persona),qBuscar)}</div>`;
      })()}</td>
      <td class="!text-[12px] !text-[#475569]">${s._transportadorMixto
        ? `<span class="!text-[#B91C1C] !font-semibold" title="Los ítems de este pedido quedaron con transportadores distintos (probablemente por un reenvío parcial). Cancela el despacho y vuelve a despacharlo.">⚠️ Inconsistente</span>`
        : s.transportador
          ? ((s.transportador.startsWith('EXT:'))
              ? `<span class="!text-[#92400E]">🚛 ${_resaltarTexto(s.transportador.slice(4),qBuscar)}</span>`
              : `<span>👤 ${_resaltarTexto(nombreUsr(s.transportador),qBuscar)}</span>`)
          : '<span class="!text-[#CBD5E1]">—</span>'}</td>
      <td><span class="badge ${ei.cls}">${ei.icon} ${ei.label}</span></td>
      <td class="!text-[11px] !text-[#64748B] !leading-[1.6]">${fechas||'—'}</td>
      <td class="!text-[11px] !leading-[1.5] !max-w-[220px]">${notasHtml||'<span class="!text-[#CBD5E1]">—</span>'}</td>
      <td>${acciones}</td>
    </tr>`;
  }).join('');
  // Pie: "Mostrando X de Y" + botón "Ver más"
  const _selSeg = document.getElementById('segPorPagina');
  if(_selSeg && _selSeg.value!==String(_segPorPagina)) _selSeg.value=String(_segPorPagina);
  const _infoSeg = document.getElementById('segInfoCantidad');
  if(_infoSeg) _infoSeg.textContent = `Mostrando ${_visiblesSeg.length} de ${_totalSeg}`;
  if(_visiblesSeg.length < _totalSeg){
    tbody.insertAdjacentHTML('beforeend', `<tr><td colspan="9" style="text-align:center;padding:14px;"><button onclick="_segVerMas()" class="btn-sm ![background:#EFF6FF] !text-[#1D4ED8]">Ver más (${Math.min(_segPorPagina||25,_totalSeg-_visiblesSeg.length)} de ${_totalSeg-_visiblesSeg.length} restantes)</button></td></tr>`);
  }
}

let _usuariosTransp = [];

function mostrarListaUsuariosTransp(){
  const q = (document.getElementById('buscarUsuarioTransp')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('listaUsuariosTransp');
  if(!lista) return;
  // El solicitante/destinatario NO puede elegirse como "usuario del
  // sistema" que transporta — si es él mismo quien viene, es el caso de
  // "Alguien viene a recogerlo en persona" (la otra opción), no este.
  const excluirId = window._recogeEnPersonaUsuario;
  const base = excluirId ? _usuariosTransp.filter(u=>u.usuario!==excluirId) : _usuariosTransp;
  const filtrados = q
    ? base.filter(u=>
        (u.nombre||'').toLowerCase().includes(q) ||
        (u.apellido||'').toLowerCase().includes(q) ||
        (u.usuario||'').toLowerCase().includes(q) ||
        (u.sede||'').toLowerCase().includes(q)
      )
    : base;
  if(!filtrados.length){
    lista.innerHTML='<div class="!p-[12px] !text-center !text-[#94A3B8] !text-[13px]">'+(q?'Sin resultados para "'+q+'"':'Sin usuarios disponibles')+'</div>';
  } else {
    lista.innerHTML = filtrados.map(u=>`<div onclick="seleccionarUsuarioTransp('${u.usuario}','${(u.nombre||'')} ${(u.apellido||'')} @${u.usuario}${u.sede?' · '+u.sede:''}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #F1F5F9;transition:background .1s;" onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'"><div class="!font-semibold !text-[13px] !text-[#0F172A]">${(u.nombre||'')} ${(u.apellido||'')}</div><div class="!text-[11px] !text-[#94A3B8]">@${u.usuario} · ${u.sede||''} · ${u.rol||''}</div></div>`).join('');
  }
  lista.style.display='block';
}
function filtrarUsuariosTransp(){ mostrarListaUsuariosTransp(); }

function seleccionarUsuarioTransp(valor, etiqueta){
  document.getElementById('enCaminoUsuario').value = valor;
  document.getElementById('buscarUsuarioTransp').value = '';
  document.getElementById('listaUsuariosTransp').style.display = 'none';
  const div = document.getElementById('usuarioSeleccionado');
  const span = document.getElementById('usuarioSeleccionadoNombre');
  if(div) div.style.display='flex';
  if(span) span.textContent = etiqueta;
}

function _toggleRecogeEnPersona(){
  const chk = document.getElementById('chkRecogeEnPersona');
  if(chk?.checked){
    if(window._recogeEnPersonaUsuario){
      // Ya se sabe quién probablemente viene (solicitante real, o quien
      // se propuso al crear un envío directo) — se sugiere de una vez.
      const u = getUsuarios().find(x=>x.usuario===window._recogeEnPersonaUsuario);
      const nombreCompleto = u ? (`${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario) : window._recogeEnPersonaUsuario;
      seleccionarUsuarioTransp(window._recogeEnPersonaUsuario, `🙋 ${nombreCompleto} (recoge en persona)`);
    } else {
      // No se sabe quién específico — se filtra la lista por la sede
      // destino (para que salgan de una vez los de esa oficina, ej:
      // Palermo), en vez de dejar el buscador completamente vacío.
      limpiarUsuarioTransp();
      const b = document.getElementById('buscarUsuarioTransp');
      if(b && window._despachoDestinoActual){ b.value = window._despachoDestinoActual; mostrarListaUsuariosTransp(); }
      setTimeout(()=>document.getElementById('buscarUsuarioTransp')?.focus(),100);
    }
  } else {
    limpiarUsuarioTransp();
  }
}
function limpiarUsuarioTransp(){
  document.getElementById('enCaminoUsuario').value = '';
  const b = document.getElementById('buscarUsuarioTransp');
  if(b) b.value = '';
  const l = document.getElementById('listaUsuariosTransp');
  if(l) l.style.display='none';
  const div = document.getElementById('usuarioSeleccionado');
  if(div) div.style.display='none';
}

function toggleTipoTransportador(){
  const tipo = document.querySelector('input[name="tipoTransportador"]:checked')?.value;
  const lblU = document.getElementById('lblTipoUsuario');
  const lblT = document.getElementById('lblTipoTransporte');
  const selU = document.getElementById('selectorUsuarioTransp');
  const selT = document.getElementById('selectorTransporteExterno');
  if(tipo==='usuario'){
    selU.style.display=''; selT.style.display='none';
    if(lblU) lblU.style.borderColor='#0C6EDE';
    if(lblT) lblT.style.borderColor='#E2E8F0';
    setTimeout(()=>document.getElementById('buscarUsuarioTransp')?.focus(),100);
  } else {
    selU.style.display='none'; selT.style.display='';
    if(lblT) lblT.style.borderColor='#0C6EDE';
    if(lblU) lblU.style.borderColor='#E2E8F0';
    setTimeout(()=>document.getElementById('enCaminoTransporteNombre')?.focus(),100);
  }
}

async function abrirEnCamino(id){
  document.getElementById('enCaminoId').value = id;
  document.getElementById('enCaminoNotas').value = '';
  document.getElementById('enCaminoAlerta').className = 'alerta';
  limpiarUsuarioTransp();
  const radios = document.querySelectorAll('input[name="tipoTransportador"]');
  radios.forEach(r => r.checked = r.value==='usuario');
  toggleTipoTransportador();

  // Checkbox "recoge en persona" — siempre disponible. Si se sabe quién
  // podría venir (solicitante real, o quien se propuso al crear un envío
  // directo), se sugiere de una vez al marcarlo; si no, simplemente abre
  // el buscador para elegir a cualquiera (ej: Luisfer).
  const item = (_seguimiento||[]).find(s=>s.id===id);
  window._despachoDestinoActual = item?.destino || null;
  const chkWrap = document.getElementById('chkRecogeEnPersonaWrap');
  const chk = document.getElementById('chkRecogeEnPersona');
  if(chk) chk.checked = false;
  const solicitante = item?.solicitado_por || null;
  const solicitanteEsReal = solicitante && solicitante !== sesion.usuario;
  const mRecoge = (item?.notas||'').match(/Recoge en persona:\s*(.+?)(?:\s+·\s+.*)?$/mu);
  const recogePropuesto = mRecoge ? mRecoge[1].trim() : null;
  window._recogeEnPersonaUsuario = recogePropuesto || (solicitanteEsReal ? solicitante : null);
  if(chkWrap) chkWrap.style.display = 'flex';

  _usuariosTransp = [];
  const lista = document.getElementById('listaUsuariosTransp');
  if(lista){ lista.innerHTML='<div class="!p-[12px] !text-center !text-[#94A3B8] !text-[13px]">Cargando...</div>'; lista.style.display='block'; }
  fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'})
    .then(r=>r.json())
    .then(usuarios=>{
      // Superadmin y distribuidor son quienes despachan desde el almacén —
      // no tiene sentido elegirlos como el "usuario del sistema" que
      // transporta el envío, así que no aparecen en esta lista.
      const base = Array.isArray(usuarios) ? usuarios : [];
      _usuariosTransp = base.filter(u=>u.rol!=='superadmin' && u.rol!=='distribuidor');
      mostrarListaUsuariosTransp();
    })
    .catch(()=>{ _usuariosTransp = []; });

  // Si el envío (o el grupo) incluye ONTs o fibra, mostrar selector(es)
  const _contSel = document.getElementById('onCaminoOntSelectores');
  if(_contSel) _contSel.innerHTML = '';
  _ontsSeleccionadasDespacho = {};
  _fibraAllocDespacho = {};
  _equiposSeleccionadosDespacho = {};
  _rollosDespacho = {};
  await _renderSelectorOntsEnDespacho(id);
  await _renderSelectorFibraEnDespacho(id);
  await _renderSelectorEquipoEnDespacho(id);
  await _renderSelectorRollosEnDespacho(id);
  _renderSelectorOrigenStockEnDespacho(id);

  document.getElementById('modalEnCamino').classList.add('open');
  setTimeout(()=>document.getElementById('buscarUsuarioTransp')?.focus(),200);
}

// ── Escoger de qué bolsa sale cada producto al despachar: "Nuevo" o "♻️ Recuperado" ──
// Solo aparece si el producto tiene material recuperado disponible en el almacén.
function _renderSelectorOrigenStockEnDespacho(id){
  const cont = document.getElementById('onCaminoOntSelectores');
  if(!cont) return;
  const idsGrupo = (window._grupoDespacharIds && window._grupoDespacharIds.length > 1) ? window._grupoDespacharIds : [id];
  const prods = (typeof getProductos==='function') ? getProductos() : [];
  const html = idsGrupo.map(i=>{
    const it = _seguimiento.find(x=>x.id===i);
    if(!it || it.estado!=='aprobado') return '';
    const ref = String(it.ref_producto||'');
    if(!ref || ref.startsWith('ONT::') || ref.startsWith('EQUIPO::') || ref==='FIBRA' || ref.startsWith('FIBRA')) return '';
    if(it.origen && it.origen!=='Almacen Central') return '';
    const p = prods.find(x=>x.ref===ref);
    if(!p || p.metrosPorUnidad || !((p.stockRecuperado||0)>0)) return '';
    const yaRec = /\[STOCK:recuperado\]/i.test(it.notas||'');
    const nuevo = (typeof _stockCentral==='function') ? _stockCentral(p) : 0;
    return `<div class="!mb-[14px] ![background:#F0FDF4] ![border:1.5px_solid_#BBF7D0] !rounded-[10px] !p-[10px_12px]">
      <div class="!text-[12px] !font-semibold !mb-[6px]">♻️ ¿De cuál stock sale? — ${esc(it.nombre_producto||ref)} (${it.cantidad})</div>
      <select id="despOrigen_${it.id}" class="inp" style="font-size:12px;padding:6px 10px;">
        <option value="nuevo" ${(yaRec||nuevo<it.cantidad)?'':'selected'}>🆕 Nuevo (${nuevo} disponibles)</option>
        <option value="recuperado" ${(yaRec||nuevo<it.cantidad)?'selected':''}>♻️ Recuperado (${p.stockRecuperado} disponibles)</option>
      </select>
    </div>`;
  }).join('');
  if(html) cont.insertAdjacentHTML('beforeend', html);
}
function _origenStockDespacho(itemId){
  const el = document.getElementById('despOrigen_'+itemId);
  return el ? {origen_stock: el.value} : {};
}

// ── Rollos de un producto por metros: solo si hay alguno EMPEZADO en el almacén ──
// Por defecto (todos completos) el despacho es automático y no se muestra nada. Si hay un
// rollo empezado, sale marcado primero y el admin puede cambiar cuál(es) salen. Va
// dentro de un desplegable para no alargar la ventana en el celular.
let _rollosDespacho = {}; // {idSeguimiento: {numR, sel:[ids]}}
async function _renderSelectorRollosEnDespacho(id){
  const cont = document.getElementById('onCaminoOntSelectores');
  if(!cont) return;
  if(!(sesion?.rol==='superadmin' || tienePermiso('elegir_material_despacho'))) return;
  const idsGrupo = (window._grupoDespacharIds && window._grupoDespacharIds.length > 1) ? window._grupoDespacharIds : [id];
  for(const sid of idsGrupo){
    const it = _seguimiento.find(x=>x.id===sid);
    if(!it || it.estado==='en_camino' || it.origen!=='Almacen Central') continue;
    const ref = String(it.ref_producto||'');
    if(/^(ONT::|EQUIPO::|FIBRA)/.test(ref) || /\[STOCK:recuperado\]/.test(it.notas||'')) continue;
    if(/Rollos? elegidos?:/i.test(it.notas||'')) continue; // el rollo ya se eligió al crear el envío: se respeta
    const p = getProductos().find(x=>x.ref===ref);
    if(!p || !(p.metrosPorUnidad>0)) continue;
    const numR = Math.round(it.cantidad / p.metrosPorUnidad);
    if(numR<1 || Math.abs(it.cantidad - numR*p.metrosPorUnidad) > 0.01) continue;
    let rollos = [];
    try{
      const r = await fetch(`api/productos.php?action=rollos_disponibles&ref=${encodeURIComponent(ref)}&sede=${encodeURIComponent('Almacen Central')}`, {credentials:'same-origin'});
      rollos = await r.json();
    }catch(e){ continue; }
    if(!Array.isArray(rollos)) continue;
    const empezados = rollos.filter(r=>parseFloat(r.metros_usados)>0);
    if(!empezados.length) continue; // todos completos: automático, sin pasos extra
    const orden = [...empezados, ...rollos.filter(r=>!(parseFloat(r.metros_usados)>0))];
    const sel = orden.slice(0, numR).map(r=>String(r.id));
    _rollosDespacho[sid] = {numR, sel, rollos};
    const fm = n => { n=parseFloat(n)||0; return n%1===0 ? n.toFixed(0) : n.toFixed(1); };
    const filas = orden.map(r=>{
      const disp = parseFloat(r.metros_disponibles)||0, tot = parseFloat(r.metros)||0, parcial = parseFloat(r.metros_usados)>0;
      return `<label class="!flex !items-center !gap-[8px] !text-[13px] !p-[6px_4px] ![border-bottom:1px_solid_#F1F5F9] !cursor-pointer">
        <input type="checkbox" value="${r.id}" ${sel.includes(String(r.id))?'checked':''} onchange="_rollosDespToggle(${sid})">
        <span>Rollo #${r.id} — <b>${fm(disp)} m</b>${parcial?` <span class="![background:#FEF3C7] !text-[#92400E] !rounded-[6px] !p-[0_6px] !text-[10px]">empezado (de ${fm(tot)})</span>`:''}</span></label>`;
    }).join('');
    cont.insertAdjacentHTML('beforeend', `
      <div id="rollosDesp_${sid}" style="margin-bottom:14px;background:#FFFBEB;border:1.5px solid #FDE68A;border-radius:10px;padding:8px 12px;">
        <details>
          <summary class="!cursor-pointer !text-[12px] !font-semibold !text-[#92400E]">⚠ Hay ${empezados.length} rollo${empezados.length>1?'s':''} empezado${empezados.length>1?'s':''} de ${esc(it.nombre_producto||ref)} — toca para elegir cuál sale
            <div id="rollosDespResumen_${sid}" style="font-weight:500;color:#166534;margin-top:2px;"></div></summary>
          <div class="!text-[11px] !text-[#64748B] !m-[6px_0]">Elige exactamente ${numR} rollo${numR>1?'s':''}. Se entrega lo que tengan esos rollos.</div>
          <div class="!max-h-[min(220px,34dvh)] !overflow-y-auto ![-webkit-overflow-scrolling:touch]">${filas}</div>
        </details>
      </div>`);
    _rollosDespToggle(sid);
  }
}
function _rollosDespToggle(sid){
  const st = _rollosDespacho[sid]; if(!st) return;
  const marcados = [...document.querySelectorAll(`#rollosDesp_${sid} input[type=checkbox]:checked`)];
  st.sel = marcados.map(c=>c.value);
  const metros = marcados.reduce((a,c)=>{ const r = st.rollos.find(x=>String(x.id)===c.value); return a + (parseFloat(r?.metros_disponibles)||0); },0);
  const ok = st.sel.length === st.numR;
  const el = document.getElementById('rollosDespResumen_'+sid);
  if(el){ el.style.color = ok ? '#166534' : '#B91C1C'; el.textContent = ok ? `✓ ${st.sel.length} rollo${st.sel.length>1?'s':''} elegido${st.sel.length>1?'s':''} · ${metros%1===0?metros:metros.toFixed(1)} m (${st.sel.map(x=>'#'+x).join(', ')})` : `Elegidos ${st.sel.length} de ${st.numR}`; }
}

// ── Selector de ONTs específicas (MAC/SN/modelo) al momento de despachar ──
async function _renderSelectorOntsEnDespacho(id){
  const cont = document.getElementById('onCaminoOntSelectores');
  if(!cont) return;
  const idsGrupo = (window._grupoDespacharIds && window._grupoDespacharIds.length > 1) ? window._grupoDespacharIds : [id];
  const itemsOnt = idsGrupo
    .map(i => _seguimiento.find(s=>s.id===i))
    .filter(s => s && String(s.ref_producto||'').startsWith('ONT::'));

  if(!itemsOnt.length) return;

  const tienePermisoElegir = (sesion?.rol==='superadmin' || tienePermiso('elegir_material_despacho'));

  cont.insertAdjacentHTML('beforeend', itemsOnt.map(it => {
    const puedeElegir = tienePermisoElegir;
    return puedeElegir ? `
    <div style="margin-bottom:14px;background:#F8FAFC;border:1.5px solid #E2E8F0;border-radius:10px;padding:10px 12px;">
      <div class="!text-[12px] !font-semibold !mb-[6px]">📡 Elige ${it.cantidad} ONT(s) — ${esc(it.nombre_producto||it.ref_producto)}</div>
      <input id="ontSelBuscar_${it.id}" type="text" class="inp" placeholder="🔍 Buscar por SN o MAC…"
        oninput="_filtrarOntSelDespacho(${it.id})" autocomplete="off"
        style="margin-bottom:6px;font-size:12px;padding:6px 10px;">
      <div id="ontSelLista_${it.id}" style="max-height:min(280px,42dvh);-webkit-overflow-scrolling:touch;overflow-y:auto;display:flex;flex-direction:column;gap:5px;">
        <div class="!text-center !text-[#94A3B8] !text-[12px] !p-[8px]">Cargando ONTs disponibles…</div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:6px;">
        <div id="ontSelContador_${it.id}" style="font-size:11px;color:#B45309;font-weight:600;">0 / ${it.cantidad} seleccionadas</div>
        <button type="button" onclick="_autoSelOntDespacho(${it.id})" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6] !text-[11px]">⚡ Elegir las ${it.cantidad} primeras</button>
      </div>
    </div>
    ` : `
    <div style="margin-bottom:14px;background:#F8FAFC;border:1.5px solid #E2E8F0;border-radius:10px;padding:10px 12px;">
      <div class="!text-[12px] !font-semibold !mb-[6px]">📡 ${it.cantidad} ONT(s) — ${esc(it.nombre_producto||it.ref_producto)}</div>
      <div class="!text-[11px] !text-[#94A3B8]">🔒 Solo el administrador puede elegir cuáles se envían — se asignan automáticamente las disponibles más antiguas.</div>
      <div id="ontSelContador_${it.id}" style="font-size:11px;color:#166534;font-weight:600;margin-top:6px;"></div>
    </div>
    `;
  }).join(''));

  for(const it of itemsOnt){
    const modelo = String(it.ref_producto||'').replace('ONT::','');
    _ontOtrosModelos[it.id] = false;
    try{
      const res = await fetch(`api/cajas.php?action=onts_disponibles_de_modelo&modelo=${encodeURIComponent(modelo)}`, {credentials:'same-origin'});
      const disp = await res.json();
      _ontsDisponiblesPorItem[it.id] = Array.isArray(disp) ? disp : [];
    }catch(e){ _ontsDisponiblesPorItem[it.id] = []; }

    const puedeElegirEste = tienePermisoElegir;
    if(puedeElegirEste){
      _ontsSeleccionadasDespacho[it.id] = [];
      _renderListaOntSelDespacho(it);
    } else {
      // Sin permiso, o todavía sin aprobar: se asignan automáticamente las primeras disponibles (las más antiguas).
      const auto = (_ontsDisponiblesPorItem[it.id]||[]).slice(0, it.cantidad).map(o=>o.id);
      _ontsSeleccionadasDespacho[it.id] = auto;
      const contEl = document.getElementById(`ontSelContador_${it.id}`);
      if(contEl) contEl.textContent = `✓ ${auto.length} / ${it.cantidad} asignadas automáticamente`;
    }
  }
}

// ── Selector de carretes de fibra (código + metros disponibles) al despachar ──
// Sugiere de qué carrete(s) tomar los metros: prioriza gastar un carrete que
// alcance solo (el más chico que cubra todo, para irlos agotando), y solo
// combina varios si de verdad ninguno solo alcanza. El admin puede ajustarlo.
function _sugerirRepartoFibra(carretes, cantidadNecesaria){
  const alloc = {};
  const disp = c => parseFloat(c.metros_disponibles)||0;

  // Siempre se empieza por el PRIMER carrete registrado (el más antiguo,
  // por ID) — mientras le alcance, se usa solo ese. Si no alcanza, se pasa
  // al siguiente en orden, y así sucesivamente, avisando cuando toca partir
  // el pedido entre varios.
  const porOrdenRegistro = [...carretes].sort((a,b)=>(a.id||0)-(b.id||0));
  let restante = cantidadNecesaria;
  let carretesUsados = 0;
  for(const c of porOrdenRegistro){
    if(restante <= 0) break;
    const disponible = disp(c);
    if(disponible <= 0) continue;
    const tomar = Math.min(disponible, restante);
    alloc[c.id] = tomar;
    restante -= tomar;
    carretesUsados++;
  }
  return { alloc, huboQueDividir: carretesUsados > 1, faltante: Math.max(0, restante) };
}

async function _renderSelectorFibraEnDespacho(id){
  const cont = document.getElementById('onCaminoOntSelectores');
  if(!cont) return;
  const idsGrupo = (window._grupoDespacharIds && window._grupoDespacharIds.length > 1) ? window._grupoDespacharIds : [id];
  const itemsFibra = idsGrupo
    .map(i => _seguimiento.find(s=>s.id===i))
    .filter(s => s && s.ref_producto === 'FIBRA' && s.tipo === 'solicitud');

  if(!itemsFibra.length) return;

  const tienePermisoElegirFibra = (sesion?.rol==='superadmin' || tienePermiso('elegir_material_despacho'));

  cont.insertAdjacentHTML('beforeend', itemsFibra.map(it => {
    const puedeElegir = tienePermisoElegirFibra;
    return puedeElegir ? `
    <div style="margin-bottom:14px;background:#F8FAFC;border:1.5px solid #E2E8F0;border-radius:10px;padding:10px 12px;">
      <div class="!text-[12px] !font-semibold !mb-[6px]">🧵 Reparte ${it.cantidad} m — ${esc(it.nombre_producto||'Fibra')}</div>
      <div id="fibraSelLista_${it.id}" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;">
        <div class="!text-center !text-[#94A3B8] !text-[12px] !p-[8px]">Cargando carretes…</div>
      </div>
      <div id="fibraSelContador_${it.id}" style="font-size:11px;color:#B45309;font-weight:600;margin-top:6px;">0 / ${it.cantidad} m asignados</div>
    </div>
    ` : `
    <div style="margin-bottom:14px;background:#F8FAFC;border:1.5px solid #E2E8F0;border-radius:10px;padding:10px 12px;">
      <div class="!text-[12px] !font-semibold !mb-[6px]">🧵 ${it.cantidad} m — ${esc(it.nombre_producto||'Fibra')}</div>
      <div class="!text-[11px] !text-[#94A3B8]">🔒 Solo el administrador puede elegir de qué carrete se toma — se asigna automáticamente.</div>
      <div id="fibraSelContador_${it.id}" style="font-size:11px;color:#166534;font-weight:600;margin-top:6px;"></div>
    </div>
    `;
  }).join(''));

  for(const it of itemsFibra){
    const catId = it.categoriaFibraId;
    let carretes = [];
    if(catId){
      try{
        const res = await fetch(`api/fibra.php?action=listar_carretes&categoria_id=${encodeURIComponent(catId)}&solo_centrales=1`, {credentials:'same-origin'});
        const rows = await res.json();
        carretes = (Array.isArray(rows)?rows:[]).filter(c => parseFloat(c.metros_disponibles) > 0);
      }catch(e){ carretes = []; }
    }
    _fibraCarretesPorItem[it.id] = carretes;
    const reparto = _sugerirRepartoFibra(carretes, it.cantidad);
    _fibraAllocDespacho[it.id] = reparto.alloc;
    const puedeElegirEste = tienePermisoElegirFibra;
    if(puedeElegirEste){
      _renderListaFibraSelDespacho(it);
    } else {
      const totalAsignado = Object.values(_fibraAllocDespacho[it.id]||{}).reduce((a,b)=>a+b,0);
      const contEl = document.getElementById(`fibraSelContador_${it.id}`);
      if(contEl){
        let msg = `✓ ${totalAsignado} / ${it.cantidad} m asignados automáticamente`;
        if(reparto.huboQueDividir){
          msg = `⚠️ ${totalAsignado} / ${it.cantidad} m — no alcanzaba con el primer carrete, se completó con otro más`;
          contEl.style.color = '#B45309';
        }
        if(reparto.faltante > 0){
          msg = `⚠️ Solo se pudo cubrir ${totalAsignado} de ${it.cantidad} m — no hay suficiente en almacén`;
          contEl.style.color = '#B91C1C';
        }
        contEl.textContent = msg;
      }
    }
  }
}

function _renderListaFibraSelDespacho(it){
  const listaEl = document.getElementById(`fibraSelLista_${it.id}`);
  if(!listaEl) return;
  const carretes = _fibraCarretesPorItem[it.id] || [];
  if(!carretes.length){
    listaEl.innerHTML = '<div class="!text-center !text-[#B91C1C] !text-[12px] !p-[8px]">No hay carretes con metros disponibles para esta categoría.</div>';
    return;
  }
  const alloc = _fibraAllocDespacho[it.id] || {};
  listaEl.innerHTML = carretes.map(c => {
    const val = alloc[c.id] || '';
    return `<div class="!flex !items-center !justify-between !gap-[8px] !p-[6px_8px] ![border:1px_solid_#E2E8F0] !rounded-[7px] !text-[11px] ![background:white]">
      <div>
        <div class="!font-semibold">${esc(c.codigo||'—')} <span class="!text-[#94A3B8] !font-normal">· ${esc(c.sede_nombre||'')}</span></div>
        <div class="!text-[#64748B]">Disponible: ${parseFloat(c.metros_disponibles).toFixed(0)} m</div>
      </div>
      <input class="!w-[70px] ![border:1.5px_solid_#E2E8F0] !rounded-[8px] !p-[5px_8px] !text-[12px] !text-right" type="number" min="0" max="${c.metros_disponibles}" step="1" value="${val}" placeholder="0"
        oninput="_setFibraAllocDespacho(${it.id},${c.id},this.value,${it.cantidad})">
    </div>`;
  }).join('');
  _actualizarContadorFibraDespacho(it.id, it.cantidad);
}

function _setFibraAllocDespacho(itemId, carreteId, valor, max){
  const n = Math.max(0, parseFloat(valor)||0);
  const alloc = _fibraAllocDespacho[itemId] || (_fibraAllocDespacho[itemId]={});
  if(n > 0) alloc[carreteId] = n; else delete alloc[carreteId];
  _actualizarContadorFibraDespacho(itemId, max);
}

function _actualizarContadorFibraDespacho(itemId, max){
  const el = document.getElementById(`fibraSelContador_${itemId}`);
  const alloc = _fibraAllocDespacho[itemId] || {};
  const total = Object.values(alloc).reduce((s,v)=>s+v, 0);
  if(el){
    el.textContent = `${total} / ${max} m asignados`;
    el.style.color = total===max ? '#16A871' : '#B45309';
  }
}

// ── Selector de unidad(es) reales de OLT/Mikrotik al despachar una
// solicitud de "Pedir equipos" (ref "EQUIPO::tipo") — a diferencia de las
// ONT no hay asignación automática: siempre hay que elegir exactamente
// cuál(es) unidad(es) físicas de inventario se están enviando, para que al
// confirmarse "recibido" esa unidad real se mueva de verdad al destino.
async function _renderSelectorEquipoEnDespacho(id){
  const cont = document.getElementById('onCaminoOntSelectores');
  if(!cont) return;
  const idsGrupo = (window._grupoDespacharIds && window._grupoDespacharIds.length > 1) ? window._grupoDespacharIds : [id];
  const itemsEquipo = idsGrupo
    .map(i => _seguimiento.find(s=>s.id===i))
    .filter(s => s && String(s.ref_producto||'').startsWith('EQUIPO::'));

  if(!itemsEquipo.length) return;

  const tienePermisoElegir = (sesion?.rol==='superadmin' || tienePermiso('elegir_material_despacho'));

  cont.insertAdjacentHTML('beforeend', itemsEquipo.map(it => {
    const tipoEq = String(it.ref_producto||'').replace('EQUIPO::','');
    if(!tienePermisoElegir){
      return `
      <div class="!mb-[14px] ![background:#FEF2F2] ![border:1.5px_solid_#FECACA] !rounded-[10px] !p-[10px_12px]">
        <div class="!text-[12px] !font-semibold !mb-[4px]">🖧 ${it.cantidad} ${esc(tipoEq)} — ${esc(it.nombre_producto||it.ref_producto)}</div>
        <div class="!text-[11px] !text-[#B91C1C]">🔒 Necesitas permiso para elegir la unidad exacta a despachar. Pide a un administrador que despache este pedido.</div>
      </div>`;
    }
    return `
    <div style="margin-bottom:14px;background:#F8FAFC;border:1.5px solid #E2E8F0;border-radius:10px;padding:10px 12px;">
      <div class="!text-[12px] !font-semibold !mb-[6px]">🖧 Elige ${it.cantidad} ${esc(tipoEq)} — ${esc(it.nombre_producto||it.ref_producto)}</div>
      <input id="equipoSelBuscar_${it.id}" type="text" class="inp" placeholder="🔍 Buscar por marca, modelo o SN…"
        oninput="_filtrarEquipoSelDespacho(${it.id})" autocomplete="off"
        style="margin-bottom:6px;font-size:12px;padding:6px 10px;">
      <div id="equipoSelLista_${it.id}" style="max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:5px;">
        <div class="!text-center !text-[#94A3B8] !text-[12px] !p-[8px]">Cargando unidades disponibles…</div>
      </div>
      <div id="equipoSelContador_${it.id}" style="font-size:11px;color:#B45309;font-weight:600;margin-top:6px;">0 / ${it.cantidad} seleccionadas</div>
    </div>`;
  }).join(''));

  for(const it of itemsEquipo){
    if(!tienePermisoElegir) continue;
    const tipoEq = String(it.ref_producto||'').replace('EQUIPO::','');
    try{
      const res = await fetch(`api/equipos.php?action=disponibles_por_tipo&tipo=${encodeURIComponent(tipoEq)}&sede=${encodeURIComponent(it.origen||'Almacen Central')}`, {credentials:'same-origin'});
      const disp = await res.json();
      _equiposDisponiblesPorItem[it.id] = Array.isArray(disp) ? disp : [];
    }catch(e){ _equiposDisponiblesPorItem[it.id] = []; }
    _equiposSeleccionadosDespacho[it.id] = [];
    _renderListaEquipoSelDespacho(it);
  }
}

function _renderListaEquipoSelDespacho(it){
  const listaEl = document.getElementById(`equipoSelLista_${it.id}`);
  if(!listaEl) return;
  const disp = _equiposDisponiblesPorItem[it.id] || [];
  if(!disp.length){
    listaEl.innerHTML = '<div class="!text-center !text-[#B91C1C] !text-[12px] !p-[8px]">No hay unidades disponibles de este tipo en el origen del envío. Registra o mueve una antes de despachar.</div>';
    return;
  }
  const filtro = (document.getElementById(`equipoSelBuscar_${it.id}`)?.value || '').toLowerCase().trim();
  const visibles = filtro
    ? disp.filter(e => [e.marca,e.modelo,e.proveedor,e.sn,e.mac].some(v=>String(v||'').toLowerCase().includes(filtro)))
    : disp;

  if(!visibles.length){
    listaEl.innerHTML = `<div class="!text-center !text-[#94A3B8] !text-[12px] !p-[8px]">Sin resultados para "${esc(filtro)}"</div>`;
    return;
  }

  const sel = _equiposSeleccionadosDespacho[it.id] || [];
  listaEl.innerHTML = visibles.map(e => {
    const checked = sel.includes(String(e.id)) ? 'checked' : '';
    const nombreEq = [e.marca||e.proveedor, e.modelo].filter(Boolean).join(' ') || `#${e.id}`;
    return `<label class="!flex !items-center !gap-[8px] !p-[6px_8px] ![border:1px_solid_#E2E8F0] !rounded-[7px] !cursor-pointer !text-[11px] ![background:white]">
      <input type="checkbox" value="${e.id}" ${checked} onchange="_toggleEquipoSelDespacho(${it.id},'${e.id}',${it.cantidad},this.checked)">
      <div>
        <div class="!font-semibold">${esc(nombreEq)}</div>
        ${e.sn?`<div class="![font-family:monospace] !text-[#64748B]">SN: ${esc(e.sn)}</div>`:''}
      </div>
    </label>`;
  }).join('');
  _actualizarContadorEquipoDespacho(it.id, it.cantidad);
}

function _filtrarEquipoSelDespacho(itemId){
  const it = _seguimiento.find(s=>s.id===itemId);
  if(it) _renderListaEquipoSelDespacho(it);
}

function _toggleEquipoSelDespacho(itemId, equipoId, max, checked){
  const arr = _equiposSeleccionadosDespacho[itemId] || (_equiposSeleccionadosDespacho[itemId]=[]);
  if(checked){
    if(arr.length >= max){
      toast(`Ya seleccionaste ${max} unidad(es) para este pedido.`,'warn');
      const cb = document.querySelector(`#equipoSelLista_${itemId} input[value="${equipoId}"]`);
      if(cb) cb.checked = false;
      return;
    }
    if(!arr.includes(String(equipoId))) arr.push(String(equipoId));
  } else {
    const idx = arr.indexOf(String(equipoId));
    if(idx>=0) arr.splice(idx,1);
  }
  _actualizarContadorEquipoDespacho(itemId, max);
}

function _actualizarContadorEquipoDespacho(itemId, max){
  const el = document.getElementById(`equipoSelContador_${itemId}`);
  const n = (_equiposSeleccionadosDespacho[itemId]||[]).length;
  if(el){
    el.textContent = `${n} / ${max} seleccionadas`;
    el.style.color = n===max ? '#16A871' : '#B45309';
  }
}

function _renderListaOntSelDespacho(it){
  const listaEl = document.getElementById(`ontSelLista_${it.id}`);
  if(!listaEl) return;
  const disp = _ontsDisponiblesPorItem[it.id] || [];
  if(!disp.length){
    listaEl.innerHTML = '<div class="!text-center !text-[#B91C1C] !text-[12px] !p-[8px]">No hay ONTs disponibles de este modelo.</div>'
      + (_ontOtrosModelos[it.id] ? '' : `<button type="button" onclick="_cargarOtrosModelosOnt(${it.id})" class="btn btn-ghost !text-[12px] !p-[8px]">🔄 Ver ONT de otros modelos</button>`);
    return;
  }
  const filtro = (document.getElementById(`ontSelBuscar_${it.id}`)?.value || '').toLowerCase().trim();
  const visibles = filtro
    ? disp.filter(o => String(o.sn||'').toLowerCase().includes(filtro) || String(o.mac||'').toLowerCase().includes(filtro))
    : disp; // sin filtro: se respeta el orden tal cual llega del backend (agrupado por caja)

  if(!visibles.length){
    listaEl.innerHTML = `<div class="!text-center !text-[#94A3B8] !text-[12px] !p-[8px]">Sin resultados para "${esc(filtro)}"</div>`;
    return;
  }

  const sel = _ontsSeleccionadasDespacho[it.id] || [];
  const hl = (txt) => {
    txt = String(txt||'—');
    if(!filtro||!txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(filtro);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_1px]">${esc(txt.slice(idx, idx+filtro.length))}</mark>`
      + esc(txt.slice(idx+filtro.length));
  };
  // Solo se dibuja una parte (20 por vez) para que la lista no sea eterna en celular; "Ver más" trae otras 20.
  const pag = _ontPagina();
  const lim = _ontVerLimite[it.id] || pag;
  const mostrar = visibles.slice(0, lim);
  const resto = visibles.length - mostrar.length;
  const modeloPedido = String(it.ref_producto||'').replace('ONT::','').trim().toLowerCase();
  const esOtroModelo = o => modeloPedido && String(o.modelo||'').trim().toLowerCase() !== modeloPedido && !String(o.modelo||'').toLowerCase().includes(modeloPedido);
  const infoTop = `<div class="!text-[11px] !text-[#94A3B8] !p-[0_2px]">Mostrando ${mostrar.length} de ${visibles.length}${filtro?' (filtradas)':''} — usa el buscador para ir directo a una</div>`
    + (_ontOtrosModelos[it.id]
        ? `<div class="!text-[11px] !text-[#B45309] !font-semibold !p-[4px_2px]">⚠️ Incluye otros modelos (marcados). Si eliges uno, el envío saldrá con ese modelo y quedará anotado. <a href="#" onclick="_soloModeloPedidoOnt(${it.id});return false;" style="color:#5B21B6;">Volver solo al modelo pedido</a></div>`
        : `<div class="!p-[2px_2px]"><a href="#" onclick="_cargarOtrosModelosOnt(${it.id});return false;" style="font-size:11px;color:#5B21B6;">🔄 ¿Falta de este modelo? Ver ONT de otros modelos</a></div>`);
  const btnMas = resto>0 ? `<button type="button" onclick="_verMasOntDespacho(${it.id})" class="btn btn-ghost !text-[12px] !p-[8px]">⬇ Ver ${Math.min(pag,resto)} más (${resto} restantes)</button>` : '';
  listaEl.innerHTML = infoTop + mostrar.map(o => {
    const checked = sel.includes(String(o.id)) ? 'checked' : '';
    return `<label class="!flex !items-center !gap-[8px] !p-[6px_8px] ![border:1px_solid_#E2E8F0] !rounded-[7px] !cursor-pointer !text-[11px] ![background:white]">
      <input type="checkbox" value="${o.id}" ${checked} onchange="_toggleOntSelDespacho(${it.id},'${o.id}',${it.cantidad},this.checked)">
      <div>
        <div class="![font-family:monospace] !font-semibold">SN: ${hl(o.sn)}</div>
        <div class="![font-family:monospace] !text-[#64748B]">MAC: ${hl(o.mac)}${o.modelo?` · ${esc(o.modelo)}`:''}${esOtroModelo(o)?' <span style="color:#B45309;font-weight:700;">⚠️ otro modelo</span>':''}</div>
      </div>
    </label>`;
  }).join('') + btnMas;
  _actualizarContadorOntDespacho(it.id, it.cantidad);
}

let _ontOtrosModelos = {}; // { [itemId]: true si se están mostrando ONT de otros modelos }
async function _cargarOtrosModelosOnt(itemId){
  const it = _seguimiento.find(s=>s.id===itemId); if(!it) return;
  try{
    const res = await fetch('api/cajas.php?action=onts_disponibles_de_modelo&todos=1', {credentials:'same-origin'});
    const disp = await res.json();
    _ontsDisponiblesPorItem[itemId] = Array.isArray(disp) ? disp : [];
    _ontOtrosModelos[itemId] = true;
    _ontsSeleccionadasDespacho[itemId] = [];
    _ontVerLimite[itemId] = 0;
    _renderListaOntSelDespacho(it);
  }catch(e){ toast('No se pudo cargar las ONT de otros modelos','error'); }
}
async function _soloModeloPedidoOnt(itemId){
  const it = _seguimiento.find(s=>s.id===itemId); if(!it) return;
  const modelo = String(it.ref_producto||'').replace('ONT::','');
  try{
    const res = await fetch(`api/cajas.php?action=onts_disponibles_de_modelo&modelo=${encodeURIComponent(modelo)}`, {credentials:'same-origin'});
    const disp = await res.json();
    _ontsDisponiblesPorItem[itemId] = Array.isArray(disp) ? disp : [];
    _ontOtrosModelos[itemId] = false;
    _ontsSeleccionadasDespacho[itemId] = [];
    _ontVerLimite[itemId] = 0;
    _renderListaOntSelDespacho(it);
  }catch(e){}
}
let _ontVerLimite = {}; // { [itemId]: cuántas filas se muestran }
// En celular se muestran de 6 en 6 (lista corta); en pantalla grande, de 20 en 20.
function _ontPagina(){ return (window.innerWidth<=640) ? 6 : 20; }
function _verMasOntDespacho(itemId){
  _ontVerLimite[itemId] = (_ontVerLimite[itemId]||_ontPagina()) + _ontPagina();
  const it = _seguimiento.find(s=>s.id===itemId);
  const lista = document.getElementById(`ontSelLista_${itemId}`);
  const y = lista ? lista.scrollTop : 0;
  if(it) _renderListaOntSelDespacho(it);
  if(lista) lista.scrollTop = y;
}
// Marca de una vez las N primeras disponibles (las más antiguas, según el orden que llega del servidor)
function _autoSelOntDespacho(itemId){
  const it = _seguimiento.find(s=>s.id===itemId); if(!it) return;
  const disp = _ontsDisponiblesPorItem[itemId] || [];
  _ontsSeleccionadasDespacho[itemId] = disp.slice(0, it.cantidad).map(o=>String(o.id));
  _renderListaOntSelDespacho(it);
  toast(`✓ ${_ontsSeleccionadasDespacho[itemId].length} ONT elegidas — puedes cambiar cualquiera`,'success');
}

function _filtrarOntSelDespacho(itemId){
  _ontVerLimite[itemId] = _ontPagina();
  const it = _seguimiento.find(s=>s.id===itemId);
  if(it) _renderListaOntSelDespacho(it);
}

function _toggleOntSelDespacho(itemId, ontId, max, checked){
  const arr = _ontsSeleccionadasDespacho[itemId] || (_ontsSeleccionadasDespacho[itemId]=[]);
  if(checked){
    if(arr.length >= max){
      toast(`Ya seleccionaste ${max} ONT(s) para este producto.`,'warn');
      const cb = document.querySelector(`#ontSelLista_${itemId} input[value="${ontId}"]`);
      if(cb) cb.checked = false;
      return;
    }
    if(!arr.includes(String(ontId))) arr.push(String(ontId));
  } else {
    const idx = arr.indexOf(String(ontId));
    if(idx>=0) arr.splice(idx,1);
  }
  _actualizarContadorOntDespacho(itemId, max);
}

function _actualizarContadorOntDespacho(itemId, max){
  const el = document.getElementById(`ontSelContador_${itemId}`);
  const n = (_ontsSeleccionadasDespacho[itemId]||[]).length;
  if(el){
    el.textContent = `${n} / ${max} seleccionadas`;
    el.style.color = n===max ? '#16A871' : '#B45309';
  }
}

async function confirmarEnCamino(){
  const id = parseInt(document.getElementById('enCaminoId').value);
  const notas = document.getElementById('enCaminoNotas').value.trim();
  const alerta = document.getElementById('enCaminoAlerta');
  const tipo = document.querySelector('input[name="tipoTransportador"]:checked')?.value;
  alerta.className='alerta';
  document.getElementById('enCaminoTransporteNombre').style.borderColor='';
  document.getElementById('selectorUsuarioTransp').style.outline='';
  let transportador = '';
  if(tipo==='usuario'){
    transportador = document.getElementById('enCaminoUsuario').value.trim();
    if(!transportador){
      alerta.textContent='Selecciona el usuario que llevará el envío.'; alerta.className='alerta error';
      document.getElementById('selectorUsuarioTransp').style.outline='1.5px solid #E24B4A';
      document.getElementById('selectorUsuarioTransp').style.borderRadius='10px';
      return;
    }
  } else {
    const nombre = document.getElementById('enCaminoTransporteNombre').value.trim();
    if(!nombre){
      alerta.textContent='Escribe el nombre del transportador.'; alerta.className='alerta error';
      document.getElementById('enCaminoTransporteNombre').style.borderColor='#E24B4A';
      return;
    }
    transportador = 'EXT:' + nombre; // prefijo para identificar transporte externo
  }

  // Si hay ONTs o fibra en este despacho, exigir que ya estén repartidas antes de continuar
  const idsGrupoChk = (window._grupoDespacharIds && window._grupoDespacharIds.length > 1) ? window._grupoDespacharIds : [id];
  for(const i of idsGrupoChk){
    const it = _seguimiento.find(s=>s.id===i);
    if(!it) continue;
    if(String(it.ref_producto||'').startsWith('ONT::')){
      const sel = _ontsSeleccionadasDespacho[i] || [];
      if(sel.length !== it.cantidad){
        alerta.textContent = `Selecciona exactamente ${it.cantidad} ONT(s) para "${it.nombre_producto||it.ref_producto}".`;
        alerta.className = 'alerta error';
        return;
      }
    }
    if(it.ref_producto === 'FIBRA' && it.tipo === 'solicitud'){
      const alloc = _fibraAllocDespacho[i] || {};
      const total = Object.values(alloc).reduce((s,v)=>s+v, 0);
      if(total !== it.cantidad){
        alerta.textContent = `Reparte exactamente ${it.cantidad} m entre los carretes para "${it.nombre_producto||'Fibra'}" (llevas ${total} m).`;
        alerta.className = 'alerta error';
        return;
      }
    }
    if(_rollosDespacho[i] && _rollosDespacho[i].sel.length !== _rollosDespacho[i].numR){
      alerta.textContent = `Elige exactamente ${_rollosDespacho[i].numR} rollo(s) para "${it.nombre_producto||it.ref_producto}" (llevas ${_rollosDespacho[i].sel.length}).`;
      alerta.className = 'alerta error';
      return;
    }
    if(String(it.ref_producto||'').startsWith('EQUIPO::')){
      const sel = _equiposSeleccionadosDespacho[i] || [];
      if(sel.length !== it.cantidad){
        alerta.textContent = `Selecciona exactamente ${it.cantidad} unidad(es) para "${it.nombre_producto||it.ref_producto}".`;
        alerta.className = 'alerta error';
        return;
      }
    }
  }

  // Convierte el mapa {carrete_id: metros} al formato que espera el backend
  const _allocToArray = alloc => Object.entries(alloc||{}).map(([carrete_id,metros])=>({carrete_id:parseInt(carrete_id),metros}));

  try{
    const esGrupo = window._grupoDespacharIds && window._grupoDespacharIds.length > 1;
    // En grupo: suprimir notificación en todos menos el último
    const ontIdsPrincipal = _ontsSeleccionadasDespacho[id];
    const allocPrincipal = _allocToArray(_fibraAllocDespacho[id]);
    const equipoIdsPrincipal = _equiposSeleccionadosDespacho[id];
    const res = await _api('seguimiento','en_camino',{id,transportador,notas, suprimirNotif: esGrupo ? 1 : 0,
      ...(ontIdsPrincipal&&ontIdsPrincipal.length?{ont_ids:ontIdsPrincipal}:{}),
      ...(allocPrincipal.length?{carrete_alloc:allocPrincipal}:{}),
      ...(equipoIdsPrincipal&&equipoIdsPrincipal.length?{equipo_ids:equipoIdsPrincipal}:{}),
      ...(_rollosDespacho[id]?{rollo_ids:_rollosDespacho[id].sel.map(Number)}:{}),
      ..._origenStockDespacho(id)});
    if(res.error){ alerta.textContent=res.error; alerta.className='alerta error'; return; }

    // Si es un grupo, despachar todos los demás items también — sin abortar
    // el resto si alguno falla, para no dejar el grupo a medias sin avisar.
    let erroresGrupo = [];
    if(esGrupo){
      const otrosIds = window._grupoDespacharIds.filter(x=>x!==id);
      const resultados = await Promise.allSettled(otrosIds.map((oid,i) => {
        const esUltimo = i === otrosIds.length - 1;
        const ontIdsOtro = _ontsSeleccionadasDespacho[oid];
        const allocOtro = _allocToArray(_fibraAllocDespacho[oid]);
        const equipoIdsOtro = _equiposSeleccionadosDespacho[oid];
        return _api('seguimiento','en_camino',{id:oid,transportador,notas, suprimirNotif: esUltimo ? 0 : 1, esUltimoGrupo: esUltimo ? 1 : 0, grupoIds: window._grupoDespacharIds.join(','),
          ...(ontIdsOtro&&ontIdsOtro.length?{ont_ids:ontIdsOtro}:{}),
          ...(allocOtro.length?{carrete_alloc:allocOtro}:{}),
          ...(equipoIdsOtro&&equipoIdsOtro.length?{equipo_ids:equipoIdsOtro}:{}),
          ...(_rollosDespacho[oid]?{rollo_ids:_rollosDespacho[oid].sel.map(Number)}:{}),
          ..._origenStockDespacho(oid)});
      }));
      erroresGrupo = resultados
        .filter(r => r.status==='rejected')
        .map(r => r.reason?.message || 'Error desconocido');
      window._grupoDespacharIds = null;
    }

    cerrarModal('modalEnCamino');
    await Promise.all([_recargarSeguimiento(),_recargarProductos()]);
    renderSeguimiento(); renderTabla(); renderStats();
    if(erroresGrupo.length){
      toast(`⚠️ Se despachó parte del pedido, pero ${erroresGrupo.length} ítem(s) fallaron: ${[...new Set(erroresGrupo)].join(' · ')}. Revisa "Ver detalle" y despacha lo que falte.`,'warn');
    } else {
      toast('Envío despachado ✓','success');
    }
  }catch(e){ alerta.textContent='Error: '+(e.message||'Error al despachar. Verifica la consola.'); alerta.className='alerta error'; console.error('confirmarEnCamino error:',e); }
}

let _cancelModoAprobado = false;
function abrirCancelarAprobado(ids){
  abrirCancelarDespacho(ids);
  _cancelModoAprobado = true;
  const h = document.querySelector('#modalCancelarDespacho h3'); if(h) h.textContent = 'Cancelar envío aprobado';
  const p = document.querySelector('#modalCancelarDespacho h3 + p'); if(p) p.innerHTML = 'Ya no se necesita: el envío queda <strong>cancelado</strong> y el material sigue disponible en el almacén';
}
function abrirCancelarDespacho(id){
  _cancelModoAprobado = false;
  const h0 = document.querySelector('#modalCancelarDespacho h3'); if(h0) h0.textContent = 'Cancelar despacho';
  const p0 = document.querySelector('#modalCancelarDespacho h3 + p'); if(p0) p0.innerHTML = 'El envío volverá a estado <strong>Aprobado</strong> y el stock se restaurará';
  document.getElementById('cancelDespachoId').value = id;
  document.getElementById('cancelDespachoNota').value = '';
  document.getElementById('cancelDespachoAlerta').className = 'alerta';
  document.getElementById('modalCancelarDespacho').classList.add('open');
  setTimeout(()=>document.getElementById('cancelDespachoNota')?.focus(), 200);
}

async function confirmarCancelarDespacho(){
  const ids = String(document.getElementById('cancelDespachoId').value).split(',').map(x=>parseInt(x)).filter(Boolean);
  const id = ids[0];
  const nota = document.getElementById('cancelDespachoNota').value.trim();
  const alerta = document.getElementById('cancelDespachoAlerta');
  alerta.className = 'alerta';
  if(!nota){ alerta.textContent='Escribe el motivo de la cancelación.'; alerta.className='alerta error'; return; }
  try{
    // Si es un envío múltiple, se cancelan TODOS los productos del grupo de una vez.
    let errores = [], okCount = 0;
    for(const unId of ids){
      const r = await _api('seguimiento', _cancelModoAprobado ? 'cancelar_aprobado' : 'cancelar_despacho',{id:unId, nota});
      if(r && r.error) errores.push(r.error); else okCount++;
    }
    if(!okCount){ alerta.textContent=errores[0]||'No se pudo cancelar.'; alerta.className='alerta error'; return; }
    cerrarModal('modalCancelarDespacho');
    await Promise.all([_recargarSeguimiento(),_recargarProductos()]);
    renderSeguimiento(); renderTabla(); renderStats();
    if(errores.length) toast(`Cancelados ${okCount} de ${ids.length}. Error: ${errores[0]}`,'warn');
    else if(_cancelModoAprobado) toast(ids.length>1 ? `Se cancelaron los ${ids.length} productos ✓` : 'Envío cancelado ✓','success');
    else toast(ids.length>1 ? `Se cancelaron los ${ids.length} productos del envío ✓` : 'Despacho cancelado — vuelve a estado Aprobado','success');
  }catch(e){ alerta.textContent='Error al cancelar.'; alerta.className='alerta error'; }
}

let _usuariosEntrega = [];

function filtrarUsuariosEntrega(){
  const q = (document.getElementById('buscarEntregaA')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('listaUsuariosEntrega');
  if(!lista) return;
  const filtrados = q
    ? _usuariosEntrega.filter(u=>
        (u.nombre||'').toLowerCase().includes(q)||
        (u.apellido||'').toLowerCase().includes(q)||
        (u.usuario||'').toLowerCase().includes(q)||
        (u.sede||'').toLowerCase().includes(q))
    : _usuariosEntrega;
  if(!filtrados.length){
    lista.innerHTML='<div class="!p-[12px] !text-center !text-[#94A3B8] !text-[13px]">'+(q?'Sin resultados para "'+q+'"':'Sin usuarios disponibles')+'</div>';
  } else {
    lista.innerHTML = filtrados.map(u=>{
      const nombreCompleto = [u.nombre, u.apellido].filter(Boolean).join(' ').trim() || u.usuario;
      const etiqueta = nombreCompleto; // Solo el nombre limpio para el campo
      return `<div onclick="seleccionarEntregaA('${u.usuario}','${nombreCompleto}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'"><div class="!font-semibold !text-[13px] !text-[#0F172A]">${nombreCompleto}</div><div class="!text-[11px] !text-[#94A3B8]">@${u.usuario} · ${u.sede||''}</div></div>`;
    }).join('');
  }
  lista.style.display='block';
}

function seleccionarEntregaA(valor, etiqueta){
  document.getElementById('entregaA').value = valor;
  document.getElementById('buscarEntregaA').value = '';
  document.getElementById('listaUsuariosEntrega').style.display = 'none';
  const div = document.getElementById('entregaASeleccionado');
  const span = document.getElementById('entregaANombre');
  if(div){ div.style.display='flex'; }
  if(span) span.textContent = etiqueta;
}

function limpiarEntregaA(){
  document.getElementById('entregaA').value = '';
  document.getElementById('buscarEntregaA').value = '';
  document.getElementById('listaUsuariosEntrega').style.display = 'none';
  const div = document.getElementById('entregaASeleccionado');
  if(div) div.style.display = 'none';
  document.getElementById('buscarEntregaA')?.focus();
}

function abrirConfirmarEntrega(id){
  window._grupoEntregaIds = null; // entrega individual
  document.getElementById('entregaId').value = id;
  document.getElementById('entregaA').value = '';
  document.getElementById('entregaNotas').value = '';
  document.getElementById('entregaAlerta').className = 'alerta';
  limpiarEntregaA();
  _usuariosEntrega = [];
  const lista = document.getElementById('listaUsuariosEntrega');
  if(lista){ lista.innerHTML='<div class="!p-[12px] !text-center !text-[#94A3B8] !text-[13px]">Cargando...</div>'; lista.style.display='block'; }
  // Si es una devolución al almacén (recogido, ONT devuelta, stock
  // devuelto, etc.), el distribuidor SÍ puede ser quien recibe — él
  // maneja el almacén central. Para un despacho normal, ni superadmin
  // ni distribuidor deben salir aquí (ellos despachan, no reciben).
  const itemSeg = (_seguimiento||[]).find(s=>s.id===id);
  const esDevolucionEntrega = itemSeg && ['recogido','ont_devolucion','devolucion_stock','asignacion'].includes(itemSeg.tipo);
  fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'})
    .then(r=>r.json())
    .then(usuarios=>{
      const base = Array.isArray(usuarios) ? usuarios : [];
      _usuariosEntrega = base.filter(u=>u.rol!=='superadmin' && (esDevolucionEntrega || u.rol!=='distribuidor'));
      filtrarUsuariosEntrega();
    })
    .catch(()=>{
      _usuariosEntrega = [];
      const lista = document.getElementById('listaUsuariosEntrega');
      if(lista) lista.innerHTML='<div class="!p-[12px] !text-center !text-[#EF4444] !text-[13px]">Error al cargar usuarios</div>';
    });
  document.getElementById('modalConfirmarEntrega').classList.add('open');
  setTimeout(()=>document.getElementById('buscarEntregaA')?.focus(), 200);
}

async function confirmarEntrega(){
  const id = parseInt(document.getElementById('entregaId').value);
  const entregadoA = document.getElementById('entregaA').value.trim();
  const notas = document.getElementById('entregaNotas').value.trim();
  const alerta = document.getElementById('entregaAlerta');
  alerta.className = 'alerta';
  if(!entregadoA){ alerta.textContent='Indica quién recibió el material.'; alerta.className='alerta error'; return; }
  try{
    const grupoIds = window._grupoEntregaIds;
    if(Array.isArray(grupoIds) && grupoIds.length){
      // Entrega de pedido múltiple: procesar todos los items en camino, sin abortar si uno falla
      const resultados = await Promise.allSettled(
        grupoIds.map(gid => _api('seguimiento','entregado',{id:gid, entregado_a: entregadoA, notas}))
      );
      const errores = resultados.filter(r=>r.status==='rejected'||r.value?.error);
      window._grupoEntregaIds = null;
      cerrarModal('modalConfirmarEntrega');
      await _recargarSeguimiento();
      renderSeguimiento(); renderStats();
      if(errores.length===0) toast('Entrega del pedido confirmada ✓','success');
      else{
        const motivos = [...new Set(errores.map(r => r.status==='rejected' ? (r.reason?.message||'Error') : (r.value?.error||'Error')))];
        toast(`Entrega parcial: ${grupoIds.length-errores.length} de ${grupoIds.length} confirmados — ${motivos.join(' · ')}`,'warn');
      }
      return;
    }
    const res = await _api('seguimiento','entregado',{id, entregado_a: entregadoA, notas});
    if(res.error){ alerta.textContent=res.error; alerta.className='alerta error'; return; }
    cerrarModal('modalConfirmarEntrega');
    await _recargarSeguimiento();
    renderSeguimiento(); renderStats();
    toast('Entrega confirmada ✓','success');
  }catch(e){ alerta.textContent='Error al confirmar entrega.'; alerta.className='alerta error'; }
}

function confirmarEntregaGrupo(idsStr){
  const ids = (idsStr||'').split(',').map(Number).filter(Boolean);
  if(!ids.length){ toast('No hay productos en camino para entregar','warn'); return; }
  abrirConfirmarEntrega(ids[0]);     // abre el modal (carga usuarios, etc.)
  window._grupoEntregaIds = ids;     // marca que es entrega de grupo
}

async function abrirEnCaminoGrupo(idsStr){
  // Abre el modal de despacho del primer item y guarda los demás para procesarlos juntos
  const ids = idsStr.split(',').map(Number);
  window._grupoDespacharIds = ids;
  abrirEnCamino(ids[0]);
}

async function confirmarRecibidoGrupo(idsStr){
  const ids = idsStr.split(',').map(Number);
  mostrarConfirmar({
    icono:'✅', color:'#16A871',
    titulo:'Confirmar recibido',
    desc:`¿Confirmas que recibiste los ${ids.length} productos de este pedido?`,
    btnTxt:'Sí, recibido',
    btnColor:'#16A871',
    withNotes:true,
    avisoResponsabilidad:true,
    onConfirmar: async(notas)=>{
      // Procesar todos en paralelo — no abortar si uno falla
      const resultados = await Promise.allSettled(
        ids.map(id => _api('seguimiento','recibido',{id,notas: notas||''}))
      );
      const errores = resultados.filter(r=>r.status==='rejected'||r.value?.error);
      await Promise.all([_recargarSeguimiento(),_recargarProductos(),_recargarHistorial()]);
      renderSeguimiento(); renderTabla(); renderHistorial(); renderStats();
      if(errores.length===0){
        toast('Todos los productos confirmados como recibidos ✓','success');
      } else if(errores.length < ids.length){
        toast(`${ids.length - errores.length} de ${ids.length} confirmados. ${errores.length} con error.`,'warn');
      } else {
        toast('Error al confirmar la recepción','error');
      }
    }
  });
}

// Confirmar recepción completa (entrega + recibido en un paso)
// Usado cuando el transportador ES la sede destino
function toggleNotaLarga(a){
  const c=a.previousElementSibling, abre=a.textContent==='ver más';
  c.style.display=abre?'block':'-webkit-box'; c.style.webkitLineClamp=abre?'unset':'2';
  a.textContent=abre?'ver menos':'ver más'; return false;
}
function toggleNotaSeriales(a){
  const d=a.nextElementSibling, abre=d.style.display==='none';
  d.style.display=abre?'block':'none'; a.textContent=abre?'ocultar':'ver'; return false;
}
async function confirmarRecepcionCompleta(idsStr){
  const ids = String(idsStr).split(',').map(Number).filter(Boolean);
  mostrarConfirmar({
    icono:'✅', color:'#16A871',
    titulo:'Confirmar recepción',
    desc: ids.length>1
      ? `¿Confirmas que recibiste los ${ids.length} productos de este pedido? Se registrará la entrega y recepción de todos.`
      : '¿Confirmas que recibiste el material? Se registrará la entrega y recepción.',
    btnTxt:'Sí, recibido',
    btnColor:'#16A871',
    withNotes:true,
    avisoResponsabilidad:true,
    onConfirmar: async(notas)=>{
      // Procesar cada producto del pedido — no abortar si uno falla, para
      // que un problema en uno no deje a los demás sin confirmar.
      const resultados = await Promise.allSettled(ids.map(async id=>{
        // La nota se guarda UNA sola vez (en 'Recibido'); si no, salía repetida como Entrega y Recibido.
        await _api('seguimiento','entregado',{id, entregado_a: sesion.usuario, notas: ''});
        return _api('seguimiento','recibido',{id, notas: notas||''});
      }));
      const errores = resultados.filter(r=>r.status==='rejected'||r.value?.error);
      await Promise.all([_recargarSeguimiento(),_recargarProductos(),_recargarHistorial()]);
      renderSeguimiento(); renderTabla(); renderHistorial(); renderStats(); updateNotifBadges();
      if(errores.length===0){
        toast('Material recibido correctamente ✓','success');
      } else if(errores.length < ids.length){
        toast(`${ids.length-errores.length} de ${ids.length} confirmados. ${errores.length} con error.`,'warn');
      } else {
        toast('Error al confirmar la recepción','error');
      }
    }
  });
}

function abrirModalRegistrarRecogido(){
  { const tp=document.getElementById('tabRecogidoPendientes'); if(tp) tp.textContent = (sesion&&(sesion.rol==='superadmin'||sesion.rol==='distribuidor')) ? '📋 Material recogido' : '📋 Pendientes de devolver'; }
  document.getElementById('recogidoProductoBuscar').value = '';
  document.getElementById('recogidoProductoRef').value = '';
  document.getElementById('recogidoCantidad').value = '';
  document.getElementById('recogidoMotivo').value = '';
  document.querySelector('input[name="recogidoTipo"][value="reutilizable"]').checked = true;
  const _chkN = document.getElementById('recogidoEsNuevo'); if(_chkN) _chkN.checked = false;
  ['recogidoNuevoNombre','recogidoNuevoProveedor'].forEach(i=>{const e=document.getElementById(i); if(e) e.value='';});
  _toggleRecogidoNuevo();
  (async()=>{ try{ if(!_proveedores.length) await cargarProveedores(); }catch(e){} const dl=document.getElementById('recogidoProvDL'); if(dl) dl.innerHTML=_proveedores.map(p=>`<option value="${esc(p.nombre)}">`).join(''); })();
  const al = document.getElementById('recogidoAlerta'); if(al){al.style.display='none';al.textContent='';}
  _setTabRecogido('nuevo');
  document.getElementById('modalRegistrarRecogido')?.classList.add('open');
}
function _toggleRecogidoNuevo(){
  const on = !!document.getElementById('recogidoEsNuevo')?.checked;
  const c = document.getElementById('recogidoNuevoCampos'); if(c) c.style.display = on ? 'block' : 'none';
  const b = document.getElementById('recogidoProductoBuscar'); if(b){ b.disabled = on; b.style.opacity = on ? '.5' : ''; }
}
function _setTabRecogido(tab){
  const bNuevo=document.getElementById('tabRecogidoNuevo'), bPend=document.getElementById('tabRecogidoPendientes');
  const pNuevo=document.getElementById('recogidoPanelNuevo'), pPend=document.getElementById('recogidoPanelPendientes');
  if(tab==='nuevo'){
    bNuevo.style.background='#0F766E';bNuevo.style.color='white';
    bPend.style.background='#F1F5F9';bPend.style.color='#475569';
    pNuevo.style.display='block'; pPend.style.display='none';
  } else {
    bPend.style.background='#0F766E';bPend.style.color='white';
    bNuevo.style.background='#F1F5F9';bNuevo.style.color='#475569';
    pNuevo.style.display='none'; pPend.style.display='block';
    _cargarRecogidoPendientes();
  }
}
function _renderRecAdminStock(){
  const grid = document.getElementById('recAdminStockGrid');
  const vacio = document.getElementById('recAdminStockVacio');
  if(!grid) return;
  const conRecuperado = getProductos().filter(p => (p.stockRecuperado||0) > 0);
  if(!conRecuperado.length){
    grid.innerHTML = '';
    vacio.style.display = 'block';
    return;
  }
  vacio.style.display = 'none';
  grid.innerHTML = conRecuperado.map(p => `
    <div class="![background:#EAF3DE] !rounded-[10px] !p-[8px_10px]">
      <div class="!text-[11px] !font-semibold !text-[#0F172A] !whitespace-nowrap !overflow-hidden !text-ellipsis">${esc(p.nombre)}</div>
      <div class="!text-[15px] !font-extrabold !text-[#166534]">${valorMostrar(p,p.stockRecuperado)} <span class="!text-[10px] !font-normal !text-[#4D7C58]">${sufijoMostrar(p)}</span></div>
    </div>`).join('');
}
async function cargarRecogidoAdmin(){
  _renderRecAdminStock();
  const tbody = document.getElementById('tablaRecogidoAdmin');
  const vacio = document.getElementById('recAdminVacio');
  const contador = document.getElementById('recAdminContador');
  if(!tbody) return;
  const tipo = document.getElementById('recAdminFiltroTipo')?.value||'';
  const estado = document.getElementById('recAdminFiltroEstado')?.value||'';
  const usuario = (document.getElementById('recAdminFiltroUsuario')?.value||'').trim();
  const params = new URLSearchParams();
  if(tipo) params.set('tipo', tipo);
  if(estado) params.set('estado', estado);
  if(usuario) params.set('usuario', usuario);
  try{
    const res = await fetch(`api/productos.php?action=material_recogido_admin&${params}`,{credentials:'same-origin'});
    const data = await res.json();
    const filas = Array.isArray(data) ? data : [];
    if(!filas.length){
      tbody.innerHTML=''; vacio.style.display='block'; contador.textContent='';
      return;
    }
    vacio.style.display='none';
    contador.textContent = `${filas.length} registro${filas.length!==1?'s':''}`;
    const labelsEstado = {en_poder:'📦 En poder', en_transito:'🚚 En camino', devuelto:'↩ Devuelto', gastado:'🔧 Gastado', dado_de_baja:'🗑 Dado de baja'};
    const coloresEstado = {en_poder:'#BA7517', en_transito:'#0369A1', devuelto:'#0C6EDE', gastado:'#166534', dado_de_baja:'#94A3B8'};
    window._recRows = window._recRows || {}; filas.forEach(r=>{ window._recRows[r.id]=r; });
    tbody.innerHTML = filas.map(r=>{
      const puedeDarBaja = r.tipo==='dañado' && (r.estado==='en_poder' || r.estado==='devuelto') && !r.stock_acreditado;
      const puedeReincorporar = r.tipo==='dañado' && r.estado==='devuelto' && !r.stock_acreditado;
      const puedeCambiarTipo = (r.estado==='en_poder' || r.estado==='devuelto');
      let acciones = '';
      if(r.estado==='en_poder' || r.estado==='devuelto'){
        acciones += `<button onclick="_editarRecogido(${r.id})" class="btn-sm ![background:#F1F5F9] !text-[#475569] !mr-[4px]">✎ Editar</button>`;
      }
      if(puedeCambiarTipo){
        const aTexto = r.tipo==='dañado' ? '♻️ Marcar reutilizable' : '🔧 Marcar dañado';
        acciones += `<button onclick="_cambiarTipoRecogido(${r.id})" class="btn-sm ![background:#F1F5F9] !text-[#475569] !mr-[4px]">${aTexto}</button>`;
      }
      if(r.es_nuevo && r.estado==='devuelto') acciones += `<button onclick="_abrirAceptarRecogidoNuevo(${r.id},'${esc(r.nombre).replace(/'/g,"\\'")}','${esc(r.proveedor_nuevo||'').replace(/'/g,"\\'")}',${r.cantidad})" class="btn-sm ![background:#7C3AED] ![color:white] !mr-[4px]">✨ Aceptar</button>`;
      if(puedeReincorporar && !r.es_nuevo) acciones += `<button onclick="_reincorporarRecogido(${r.id})" class="btn-sm" style="background:#EAF3DE;color:#166534;margin-right:4px;">✅ Reincorporar</button>`;
      if(puedeDarBaja) acciones += `<button onclick="_darDeBajaRecogido(${r.id})" class="btn-sm" style="background:#FCEBEB;color:#B91C1C;">🗑 Dar de baja</button>`;
      return `<tr>
        <td>${esc(r.nombre)} ${r.es_nuevo?'<span style="background:#EDE9FE;color:#6D28D9;border-radius:8px;padding:1px 8px;font-size:10px;font-weight:700;">✨ Nuevo</span>':`<span class="!text-[#94A3B8] !text-[11px]">(${esc(r.ref)})</span>`}${(()=>{ const pv = r.es_nuevo ? r.proveedor_nuevo : (getProductos().find(x=>x.ref===r.ref)?.proveedor||''); return pv?`<div class="!text-[11px] !text-[#7C3AED]">🏭 ${esc(pv)}</div>`:''; })()}</td>
        <td>${r.cantidad}</td>
        <td>${r.tipo==='dañado'?'🔧 Dañado':'♻️ Reutilizable'}${(r.tipo==='dañado'&&r.stock_acreditado&&r.estado==='devuelto')?'<div class="!text-[10px] !text-[#166534] !font-bold">✅ Reincorporado</div>':''}</td>
        <td>${hl(r.usuario, usuario)}</td>
        <td class="!text-[12px] !text-[#64748B]">${esc(r.motivo||'—')}</td>
        <td><span class="badge" style="background:${coloresEstado[r.estado]||'#F1F5F9'}22;color:${coloresEstado[r.estado]||'#475569'};">${labelsEstado[r.estado]||r.estado}</span></td>
        <td class="!text-[12px] !text-[#94A3B8]">${new Date(r.fecha).toLocaleDateString('es-CO')}</td>
        <td>${acciones||'—'}</td>
      </tr>`;
    }).join('');
  }catch(e){
    tbody.innerHTML=''; vacio.style.display='block'; vacio.textContent='Error al cargar.';
  }
}
let _editRecId = null;
function _editarRecogido(id){
  const m = (window._recRows||{})[id];
  if(!m){ toast('No se encontró el registro','error'); return; }
  _editRecId = id;
  let ov = document.getElementById('modalEditarRecogido');
  if(!ov){
    ov = document.createElement('div'); ov.id='modalEditarRecogido'; ov.className='modal-bg'; ov.style.zIndex='9990';
    ov.innerHTML = `<div class="modal-box mx-box max-w-[440px]">
      <button class="mx-close !absolute ![top:14px] ![right:14px] !w-[30px] !h-[30px] !rounded-[50%] ![background:#F1F5F9] ![border:none] !cursor-pointer !text-[16px] !text-[#64748B]" onclick="cerrarModal('modalEditarRecogido')">✕</button>
      <h3 class="![font-family:Syne,sans-serif] !font-bold !text-[17px] !m-[0_0_4px]">✎ Editar material recogido</h3>
      <p id="emrAviso" style="font-size:12px;color:#64748B;margin:0 0 14px;"></p>
      <div id="emrExistente"><label class="lbl">Producto</label><select id="emrRef" class="inp"></select></div>
      <div id="emrNuevo" style="display:none;">
        <label class="lbl">Nombre</label><input id="emrNombre" class="inp" autocomplete="off">
        <label class="lbl !mt-[10px]">Proveedor</label><input id="emrProveedor" class="inp" list="recogidoProvDL" autocomplete="off">
      </div>
      <label class="lbl !mt-[10px]">Cantidad</label><input id="emrCantidad" type="number" min="1" class="inp">
      <label class="lbl !mt-[10px]">¿Cómo llegó?</label>
      <div class="!flex !gap-[8px]">
        <label class="![flex:1] !flex !items-center !gap-[6px] !p-[10px] ![background:#EAF3DE] ![border:1.5px_solid_#BBF7D0] !rounded-[10px] !text-[13px] !text-[#166534]"><input type="radio" name="emrTipo" value="reutilizable"> ♻️ Reutilizable</label>
        <label class="![flex:1] !flex !items-center !gap-[6px] !p-[10px] ![background:#FCEBEB] ![border:1.5px_solid_#FECACA] !rounded-[10px] !text-[13px] !text-[#B91C1C]"><input type="radio" name="emrTipo" value="dañado"> 🛠 Dañado</label>
      </div>
      <label class="lbl !mt-[10px]">Motivo (opcional)</label><input id="emrMotivo" class="inp">
      <div id="emrAlerta" class="alerta error" style="display:none;margin-top:10px;"></div>
      <div class="mx-foot !flex !gap-[8px] !mt-[16px]">
        <button class="btn btn-ghost ![flex:1]" onclick="cerrarModal('modalEditarRecogido')">Cancelar</button>
        <button class="btn btn-primary ![flex:1]" onclick="_guardarEdicionRecogido()">Guardar</button>
      </div></div>`;
    document.body.appendChild(ov);
  }
  const esNuevo = !!m.es_nuevo;
  document.getElementById('emrExistente').style.display = esNuevo ? 'none' : 'block';
  document.getElementById('emrNuevo').style.display = esNuevo ? 'block' : 'none';
  document.getElementById('emrAviso').textContent = esNuevo ? 'Corrige lo que se registró por error.'
    : (m.estado==='devuelto' && m.stock_acreditado) ? 'Ya llegó al almacén y está sumado al stock: si cambias el producto, la cantidad o lo pasas a dañado, el stock recuperado se corrige solo.'
    : (m.estado==='devuelto') ? 'Está en revisión (aún no suma al stock). Si lo pasas a reutilizable, se suma al producto elegido.'
    : 'Corrige lo que se registró por error.';
  const sel = document.getElementById('emrRef');
  sel.innerHTML = getProductos().slice().sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es')).map(p=>`<option value="${esc(p.ref)}"${p.ref===m.ref?' selected':''}>${esc(p.nombre)}${p.proveedor?' — 🏭 '+esc(p.proveedor):''}</option>`).join('');
  document.getElementById('emrNombre').value = esNuevo ? m.nombre : '';
  document.getElementById('emrProveedor').value = esNuevo ? (m.proveedor_nuevo||'') : '';
  document.getElementById('emrCantidad').value = m.cantidad;
  document.getElementById('emrMotivo').value = m.motivo||'';
  document.querySelectorAll('input[name="emrTipo"]').forEach(r=>{ r.checked = (r.value===m.tipo); });
  document.getElementById('emrAlerta').style.display='none';
  (async()=>{ try{ if(!_proveedores.length) await cargarProveedores(); }catch(e){} const dl=document.getElementById('recogidoProvDL'); if(dl) dl.innerHTML=_proveedores.map(p=>`<option value="${esc(p.nombre)}">`).join(''); })();
  ov.classList.add('open');
}
async function _guardarEdicionRecogido(){
  const m = (window._recRows||{})[_editRecId];
  const al = document.getElementById('emrAlerta'); al.style.display='none';
  const body = {
    id:_editRecId,
    cantidad: parseInt(document.getElementById('emrCantidad').value)||0,
    tipo: document.querySelector('input[name="emrTipo"]:checked')?.value,
    motivo: document.getElementById('emrMotivo').value.trim(),
  };
  if(m?.es_nuevo){ body.nombre = document.getElementById('emrNombre').value.trim(); body.proveedor = document.getElementById('emrProveedor').value.trim(); }
  else body.ref = document.getElementById('emrRef').value;
  if(body.cantidad<1){ al.textContent='Ingresa una cantidad válida.'; al.style.display='block'; return; }
  try{
    const res = await _api('productos','editar_recogido',body);
    if(res.error){ al.textContent=res.error; al.style.display='block'; return; }
    cerrarModal('modalEditarRecogido');
    toast('Registro corregido ✓','success');
    await _recargarProductos();
    if(typeof renderTabla==='function') renderTabla();
    if(document.getElementById('recogidoListaPendientes')) _cargarRecogidoPendientes();
    if(document.getElementById('tablaRecogidoAdmin')) cargarRecogidoAdmin();
  }catch(e){ al.textContent='Error al guardar.'; al.style.display='block'; }
}
let _aceptarNuevoId = null;
function _abrirAceptarRecogidoNuevo(id, nombre, proveedor, cant){
  _aceptarNuevoId = id;
  let ov = document.getElementById('modalAceptarRecNuevo');
  if(!ov){
    ov = document.createElement('div'); ov.id='modalAceptarRecNuevo'; ov.className='modal-bg';
    ov.innerHTML = `<div class="modal-box mx-box max-w-[440px]">
      <button class="mx-close !absolute ![top:14px] ![right:14px] !w-[30px] !h-[30px] !rounded-[50%] ![background:#F1F5F9] ![border:none] !cursor-pointer !text-[16px] !text-[#64748B]" onclick="cerrarModal('modalAceptarRecNuevo')">✕</button>
      <h3 class="![font-family:Syne,sans-serif] !font-bold !text-[17px] !m-[0_0_4px]">✨ Aceptar material nuevo</h3>
      <p id="arnResumen" style="font-size:12.5px;color:#64748B;margin:0 0 14px;"></p>
      <div class="!flex !gap-[8px] !mb-[14px]">
        <label class="![flex:1] !flex !gap-[6px] !items-center !p-[10px] ![border:1.5px_solid_#E2E8F0] !rounded-[10px] !cursor-pointer !text-[13px]"><input type="radio" name="arnModo" value="nuevo" checked onchange="_arnModo()"> Crear producto nuevo</label>
        <label class="![flex:1] !flex !gap-[6px] !items-center !p-[10px] ![border:1.5px_solid_#E2E8F0] !rounded-[10px] !cursor-pointer !text-[13px]"><input type="radio" name="arnModo" value="existente" onchange="_arnModo()"> Sumar a uno existente</label>
      </div>
      <div id="arnNuevo">
        <label class="lbl">Nombre</label><input id="arnNombre" class="inp">
        <label class="lbl !mt-[10px]">Proveedor</label><input id="arnProveedor" class="inp" list="recogidoProvDL" autocomplete="off">
      </div>
      <div id="arnExistente" style="display:none;position:relative;">
        <label class="lbl">Producto</label>
        <select id="arnRef" class="inp"></select>
      </div>
      <div id="arnAlerta" class="alerta error" style="display:none;margin-top:10px;"></div>
      <div class="mx-foot !flex !gap-[8px] !mt-[16px]">
        <button class="btn btn-ghost ![flex:1]" onclick="cerrarModal('modalAceptarRecNuevo')">Cancelar</button>
        <button class="btn btn-primary ![flex:1]" onclick="_ejecutarAceptarRecogidoNuevo()">Aceptar</button>
      </div></div>`;
    document.body.appendChild(ov);
  }
  document.getElementById('arnResumen').innerHTML = `<strong>${esc(nombre)}</strong> x${cant}${proveedor?' · 🏭 '+esc(proveedor):''} — ya llegó al almacén. Elige cómo agregarlo al stock.`;
  document.getElementById('arnNombre').value = nombre;
  document.getElementById('arnProveedor').value = proveedor;
  document.querySelector('input[name="arnModo"][value="nuevo"]').checked = true;
  document.getElementById('arnAlerta').style.display='none';
  const sel = document.getElementById('arnRef');
  sel.innerHTML = '<option value="">Selecciona un producto…</option>' + getProductos().slice().sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es')).map(p=>`<option value="${esc(p.ref)}">${esc(p.nombre)}${p.proveedor?' — '+esc(p.proveedor):''}</option>`).join('');
  (async()=>{ try{ if(!_proveedores.length) await cargarProveedores(); }catch(e){} const dl=document.getElementById('recogidoProvDL'); if(dl) dl.innerHTML=_proveedores.map(p=>`<option value="${esc(p.nombre)}">`).join(''); })();
  _arnModo();
  ov.classList.add('open');
}
function _arnModo(){
  const m = document.querySelector('input[name="arnModo"]:checked')?.value;
  document.getElementById('arnNuevo').style.display = m==='nuevo' ? 'block' : 'none';
  document.getElementById('arnExistente').style.display = m==='existente' ? 'block' : 'none';
}
async function _ejecutarAceptarRecogidoNuevo(){
  const modo = document.querySelector('input[name="arnModo"]:checked')?.value;
  const al = document.getElementById('arnAlerta'); al.style.display='none';
  const body = {id:_aceptarNuevoId, modo};
  if(modo==='nuevo'){
    body.nombre = document.getElementById('arnNombre').value.trim();
    body.proveedor = document.getElementById('arnProveedor').value.trim();
    if(!body.nombre){ al.textContent='Escribe el nombre.'; al.style.display='block'; return; }
  } else {
    body.ref = document.getElementById('arnRef').value;
    if(!body.ref){ al.textContent='Elige el producto de la lista.'; al.style.display='block'; return; }
  }
  try{
    const res = await _api('productos','aceptar_recogido_nuevo',body);
    if(res.error){ al.textContent=res.error; al.style.display='block'; return; }
    cerrarModal('modalAceptarRecNuevo');
    toast(res.creado ? `Producto creado (Ref ${res.ref}) y agregado al stock ✓` : 'Sumado al stock del producto ✓','success');
    await _recargarProductos();
    if(typeof renderTabla==='function') renderTabla();
    cargarRecogidoAdmin();
  }catch(e){ al.textContent='Error al aceptar.'; al.style.display='block'; }
}
async function _reincorporarRecogido(id){
  mostrarConfirmar({
    icono:'✅', color:'#166534',
    titulo:'¿Reincorporar al stock?',
    desc:'Confirma que lo revisaste y sí sirve — se suma al stock recuperado disponible.',
    btnTxt:'Sí, reincorporar', btnColor:'#166534',
    onConfirmar: async ()=>{
      try{
        const res = await _api('productos','reincorporar_recogido',{id});
        if(res.error){ toast(res.error,'error'); return; }
        toast('Reincorporado al stock ✓','success');
        await _recargarProductos();
        cargarRecogidoAdmin();
      }catch(e){ toast('Error al reincorporar','error'); }
    }
  });
}
async function _cambiarTipoRecogido(id){
  try{
    const res = await _api('productos','cambiar_tipo_recogido',{id});
    if(res.error){ toast(res.error,'error'); return; }
    toast(res.nuevo_tipo==='reutilizable' ? 'Marcado reutilizable ✓ (si ya estaba en el almacén, se sumó al stock)' : 'Marcado dañado ✓ (si estaba sumado, se restó del stock)','success'); await _recargarProductos();
    cargarRecogidoAdmin();
  }catch(e){ toast('Error al cambiar la clasificación','error'); }
}
async function _darDeBajaRecogido(id){
  mostrarConfirmar({
    icono:'🗑', color:'#B91C1C',
    titulo:'¿Dar de baja este material?',
    desc:'Queda registrado como descartado — ya no aparecerá como pendiente.',
    btnTxt:'Sí, dar de baja', btnColor:'#B91C1C',
    onConfirmar: async ()=>{
      try{
        const res = await _api('productos','dar_de_baja_recogido',{id});
        if(res.error){ toast(res.error,'error'); return; }
        toast('Material dado de baja ✓','success');
        cargarRecogidoAdmin();
      }catch(e){ toast('Error al dar de baja','error'); }
    }
  });
}
function _ingresarRecogidoAlmacen(id, nombre){
  mostrarConfirmar({
    icono:'📥', color:'#0C6EDE',
    titulo:'¿Ingresar al almacén?',
    desc:`${nombre} — se ingresa de una vez, sin transportador. Lo reutilizable suma al stock recuperado; lo dañado queda para revisión; lo nuevo se acepta enseguida.`,
    btnTxt:'Sí, ingresar', btnColor:'#0C6EDE',
    onConfirmar: async ()=>{
      try{
        const res = await _api('productos','ingresar_recogido_almacen',{id});
        if(res.error){ toast(res.error,'error'); return; }
        await Promise.all([_recargarProductos(),_recargarHistorial()]);
        if(typeof renderTabla==='function') renderTabla();
        if(typeof renderHistorial==='function') renderHistorial();
        _cargarRecogidoPendientes();
        if(res.es_nuevo){
          toast('Ingresado — ahora acéptalo: crea el producto o súmalo a uno existente','success');
          cerrarModal('modalRegistrarRecogido');
          _abrirAceptarRecogidoNuevo(id, res.nombre, res.proveedor||'', res.cantidad);
        } else if(res.tipo==='dañado'){
          toast('Ingresado para revisión — en Material recogido puedes reincorporarlo o darlo de baja ✓','success');
        } else {
          toast('Ingresado al stock recuperado del almacén ✓','success');
        }
      }catch(e){ toast('Error al ingresar','error'); }
    }
  });
}
async function _cargarRecogidoPendientes(){
  const _esAlmacenRec = sesion && (sesion.rol==='superadmin'||sesion.rol==='distribuidor');
  const cont = document.getElementById('recogidoListaPendientes');
  if(!cont) return;
  cont.innerHTML = '<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[20px]">Cargando…</div>';
  try{
    const res = await fetch('api/productos.php?action=mi_material_recogido', {credentials:'same-origin'});
    const data = await res.json();
    window._recRows = window._recRows || {}; (Array.isArray(data)?data:[]).forEach(m=>{ window._recRows[m.id]=m; });
    const enPoder = (Array.isArray(data)?data:[]).filter(m=>m.estado==='en_poder');
    const enTransito = (Array.isArray(data)?data:[]).filter(m=>m.estado==='en_transito');
    if(!enPoder.length && !enTransito.length){
      cont.innerHTML = '<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[24px]">No tienes material recogido pendiente.</div>';
      return;
    }
    const filasTransito = enTransito.map(m=>`
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;flex-wrap:wrap;background:#E0F6FF;border:1px solid #BAE6FD;border-radius:10px;margin-bottom:8px;">
        <div>
          <div class="!font-semibold !text-[13px] !text-[#334155]">${esc(m.nombre)} <span class="!font-normal !text-[#94A3B8]">x${m.cantidad}</span></div>
          <div class="!text-[11px] !text-[#0369A1]">🚚 En camino al almacén — esperando confirmación</div>
        </div>
      </div>`).join('');
    if(!enPoder.length){
      cont.innerHTML = filasTransito;
      return;
    }
    cont.innerHTML = filasTransito + enPoder.map(m=>{
      const esReut = m.tipo === 'reutilizable';
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;flex-wrap:wrap;background:${esReut?'#EAF3DE':'#FCEBEB'};border:1px solid ${esReut?'#BBF7D0':'#FECACA'};border-radius:10px;margin-bottom:8px;">
        <div>
          <div class="!font-semibold !text-[13px] !text-[#334155]">${esc(m.nombre)} <span class="!font-normal !text-[#94A3B8]">x${m.cantidad}</span>${m.es_nuevo?' <span class="![background:#EDE9FE] !text-[#6D28D9] !rounded-[8px] !p-[1px_8px] !text-[10px] !font-bold">✨ Nuevo</span>':''}</div>
          ${(()=>{ const pv = m.es_nuevo ? m.proveedor_nuevo : (getProductos().find(x=>x.ref===m.ref)?.proveedor||''); return pv?`<div class="!text-[11px] !text-[#7C3AED]">🏭 ${esc(pv)}</div>`:''; })()}
          <div style="font-size:11px;color:${esReut?'#166534':'#B91C1C'};">${esReut?'♻️ Reutilizable':'🛠 Dañado'}${m.motivo?' — '+esc(m.motivo):''}</div>
          <div class="!text-[10px] !text-[#94A3B8] !mt-[2px]">${fmtDate(m.fecha)}</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;">
          <button onclick="_editarRecogido(${m.id})" class="btn-sm ![background:#F1F5F9] !text-[#475569]">✎ Editar</button>
          ${(esReut&&!m.es_nuevo)?`<button onclick="_gastarMaterialRecogido(${m.id},'${esc(m.ref)}')" class="btn-sm ![background:#BA7517] ![color:white]">🔧 Gastar</button>
          <button onclick="_abrirDistribuirRecogido(${m.id},'${esc(m.nombre).replace(/'/g,"\\'")}',${m.cantidad})" class="btn-sm ![background:#5B21B6] ![color:white]">➤ Distribuir</button>`:''}
          ${_esAlmacenRec?`<button onclick="_ingresarRecogidoAlmacen(${m.id},'${esc(m.nombre).replace(/'/g,"\\'")}')" class="btn-sm" style="background:#0C6EDE;color:white;">📥 Ingresar al almacén</button>`:`<button onclick="_devolverMaterialRecogido(${m.id},${m.cantidad})" class="btn-sm" style="background:#0C6EDE;color:white;">↩ Devolver${esReut?'':' para revisión'}</button>`}
        </div>
      </div>`;
    }).join('');
  }catch(e){
    cont.innerHTML = '<div style="text-align:center;color:#E24B4A;font-size:13px;padding:20px;">Error al cargar.</div>';
  }
}
let _distribuirIdActual = null;
function _abrirDistribuirRecogido(id, nombre, cantidad){
  _distribuirIdActual = id;
  document.getElementById('distribuirResumen').innerHTML = `<strong>${esc(nombre)}</strong> — ${cantidad} uds.`;
  document.getElementById('distribuirDestinoBuscar').value = '';
  document.getElementById('distribuirDestinoVal').value = '';
  const al = document.getElementById('distribuirAlerta'); if(al){al.style.display='none';al.textContent='';}
  document.getElementById('modalDistribuirRecogido')?.classList.add('open');
}
function _filtrarDistribuirDestino(){
  const q = (document.getElementById('distribuirDestinoBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('distribuirDestinoLista');
  if(!lista) return;
  const personas = (getUsuarios()||[]).filter(u=>u.usuario!==sesion?.usuario && u.estado==='activo').filter(u=>{
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
    return `<div onclick="_seleccionarDistribuirDestino('${esc(u.usuario)}','${esc(nombreCompleto).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
      <div class="!font-semibold">${hl(nombreCompleto)}</div>
      <div class="!text-[11px] !text-[#94A3B8]">@${hl(u.usuario)} · ${esc(u.rol)}</div>
    </div>`;
  }).join('') : '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>';
  lista.style.display='block';
}
function _seleccionarDistribuirDestino(usuario,nombre){
  document.getElementById('distribuirDestinoVal').value = usuario;
  document.getElementById('distribuirDestinoBuscar').value = nombre;
  document.getElementById('distribuirDestinoLista').style.display='none';
}
document.addEventListener('click', function(e){
  const lista=document.getElementById('distribuirDestinoLista');
  const inp=document.getElementById('distribuirDestinoBuscar');
  if(lista && inp && !inp.contains(e.target) && !lista.contains(e.target)) lista.style.display='none';
});
async function _ejecutarDistribuirRecogido(){
  const destino = document.getElementById('distribuirDestinoVal').value;
  const alerta = document.getElementById('distribuirAlerta');
  alerta.style.display='none';
  if(!destino){ alerta.textContent='Elige a quién se lo vas a dar, de la lista.'; alerta.className='alerta error'; alerta.style.display='block'; return; }
  try{
    const res = await _api('productos','distribuir_recogido',{id:_distribuirIdActual, destino});
    if(res.error){ alerta.textContent=res.error; alerta.className='alerta error'; alerta.style.display='block'; return; }
    cerrarModal('modalDistribuirRecogido');
    toast('Distribuido correctamente ✓','success');
    _cargarRecogidoPendientes();
  }catch(e){ alerta.textContent='Error al distribuir.'; alerta.className='alerta error'; alerta.style.display='block'; }
}

let _tdDevUsuarios = [];
function _tdDevCargarUsuarios(){
  _tdDevUsuarios = [];
  fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'})
    .then(r=>r.json())
    .then(usuarios=>{ _tdDevUsuarios = Array.isArray(usuarios) ? usuarios : []; })
    .catch(()=>{ _tdDevUsuarios = []; });
}
function _tdDevFiltrarUsuarios(){
  const q = (document.getElementById('tdDevBuscarUsuario')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('tdDevListaUsuarios');
  if(!lista) return;
  if(!q){ lista.style.display='none'; return; }
  const filtrados = _tdDevUsuarios.filter(u=>
    (u.nombre||'').toLowerCase().includes(q) ||
    (u.apellido||'').toLowerCase().includes(q) ||
    (u.usuario||'').toLowerCase().includes(q)
  );
  lista.innerHTML = filtrados.length
    ? filtrados.map(u=>`<div onclick="_tdDevSeleccionarUsuario('${u.usuario}','${(u.nombre||'')} ${(u.apellido||'')} @${u.usuario}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'"><div class="!font-semibold !text-[13px]">${(u.nombre||'')} ${(u.apellido||'')}</div><div class="!text-[11px] !text-[#94A3B8]">@${u.usuario} · ${u.sede||''} · ${u.rol||''}</div></div>`).join('')
    : '<div class="!p-[12px] !text-center !text-[#94A3B8] !text-[13px]">Sin resultados</div>';
  lista.style.display='block';
}
function _tdDevSeleccionarUsuario(valor, etiqueta){
  document.getElementById('tdDevUsuarioValor').value = valor;
  document.getElementById('tdDevBuscarUsuario').value = '';
  document.getElementById('tdDevListaUsuarios').style.display = 'none';
  document.getElementById('tdDevUsuarioSeleccionado').style.display = 'flex';
  document.getElementById('tdDevUsuarioSeleccionadoNombre').textContent = etiqueta;
  document.getElementById('tdDevBtnYoMismo').style.display = 'none';
}
function _tdDevLimpiarUsuario(){
  document.getElementById('tdDevUsuarioValor').value = '';
  document.getElementById('tdDevUsuarioSeleccionado').style.display = 'none';
  document.getElementById('tdDevBtnYoMismo').style.display = 'block';
}
function _tdDevYoMismo(){
  const nombreCompleto = `${sesion.nombre||''} ${sesion.apellido||''}`.trim() || sesion.usuario;
  _tdDevSeleccionarUsuario(sesion.usuario, `🙋 ${nombreCompleto} (yo mismo)`);
}

function _destSedeDev(){ return _destTipoDev()==='oficina' ? (document.getElementById('tdDevSedeSel')?.value||'') : ''; }
function _destTipoDev(){ return document.querySelector('input[name="tdDevDestinoSel"]:checked')?.value==='oficina' ? 'oficina' : 'almacen'; }
function _tdDevPonerDestino(reset){
  if(reset===true){ const r0=document.querySelector('input[name="tdDevDestinoSel"][value="almacen"]'); if(r0) r0.checked=true; }
  const el = document.getElementById('tdDevDestino'); if(!el) return;
  const tipo = document.getElementById('tdDevTipo').value;
  const tecPer = (sesion.rol==='tecnico'||sesion.rol==='persona');
  let txt, verde = true;
  const opc = document.getElementById('tdDevDestinoOpc');
  const hayStock = tipo==='stock' || (tipo==='stock_multiple' && ((_pendienteDevolverStock?.items||[]).length || (_pendienteDevolverStock?.fibra||[]).length));
  if(opc){
    opc.style.display = (tecPer && hayStock) ? '' : 'none';
    if(opc.style.display==='none'){ const r=opc.querySelector('input[value="almacen"]'); if(r) r.checked=true; }
  }
  const aOficina = tecPer && hayStock && document.querySelector('input[name="tdDevDestinoSel"]:checked')?.value==='oficina';
  const wrapSede = document.getElementById('tdDevSedeWrap'), selSede = document.getElementById('tdDevSedeSel');
  if(wrapSede && selSede){
    wrapSede.style.display = aOficina ? '' : 'none';
    if(aOficina && selSede.options.length<=1){
      const prev = selSede.value;
      // Solo las sedes que tienen una oficina (usuario de rol municipio) activa que pueda recibir
      (async()=>{
        let sedesOficina = null;
        try{
          const r = await fetch('api/usuarios.php?action=buscar_activos',{credentials:'same-origin'});
          const us = await r.json();
          if(Array.isArray(us)) sedesOficina = new Set(us.filter(u=>u.rol==='municipio').map(u=>u.sede));
        }catch(e){}
        if(selSede.options.length>1) return;
        getSedes().filter(sd=>sd.tipo==='municipio' && (!sedesOficina || sedesOficina.has(sd.nombre))).forEach(sd=>{ const o=document.createElement('option'); o.value=sd.nombre; o.textContent=sd.nombre; selSede.appendChild(o); });
        selSede.value = prev || '';
      })();
    }
    if(reset===true) selSede.value='';
  }
  if(tecPer && hayStock){
    txt = aOficina ? (selSede?.value ? `📍 Destino: oficina de ${selSede.value}. Quien la reciba allá debe confirmarlo.` : '📍 Destino: elige el municipio al que lo devuelves.') : '📍 Destino: Almacén Central.';
    if(tipo==='stock_multiple' && (_pendienteDevolverStock?.recogidos||[]).length) txt += ' El material recogido va siempre al Almacén Central.';
    el.textContent = txt; return;
  }
  if(tipo==='recogido' || (tipo==='stock_multiple' && !(_pendienteDevolverStock?.items||[]).length && !(_pendienteDevolverStock?.fibra||[]).length)){ txt = '📍 Destino: Almacén Central'; }
  else if(tecPer){
    txt = `📍 Destino: tu municipio (${sesion.sede}). Si ahí no hay quien lo reciba, va al Almacén Central.`;
    if(tipo==='stock_multiple' && (_pendienteDevolverStock?.recogidos||[]).length) txt += ' El material recogido va siempre al Almacén Central.';
  } else { txt = '📍 Destino: Almacén Central'; }
  el.textContent = txt;
}
function _devolverMaterialRecogido(id, cantidadDisponible){
  document.getElementById('tdDevTipo').value = 'recogido';
  document.getElementById('tdDevId').value = id;
  document.getElementById('tdDevSubtitulo').textContent = `El material queda en camino hasta que lo confirmen recibido en el almacén.`;
  const cantWrapRec = document.getElementById('tdDevCantidadWrap');
  const cantInputRec = document.getElementById('tdDevCantidad');
  if(cantWrapRec && cantInputRec){
    cantWrapRec.style.display = 'block';
    cantInputRec.max = cantidadDisponible;
    cantInputRec.value = cantidadDisponible;
    document.getElementById('tdDevCantidadMax').textContent = `(tienes ${cantidadDisponible})`;
  }
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
function _toggleTdDevTransporte(){
  const esExterno = document.querySelector('input[name="tdDevTransporte"]:checked')?.value === 'externo';
  document.getElementById('tdDevUsuarioWrap').style.display = esExterno ? 'none' : 'block';
  document.getElementById('tdDevExternoWrap').style.display = esExterno ? 'block' : 'none';
  document.getElementById('tdDevLblUsuario').style.borderColor = esExterno ? '#E2E8F0' : '#0C6EDE';
  document.getElementById('tdDevLblExterno').style.borderColor = esExterno ? '#0C6EDE' : '#E2E8F0';
}
async function _confirmarTransporteDevolucion(){
  const tipo = document.getElementById('tdDevTipo').value;
  const id = document.getElementById('tdDevId').value;
  const esExterno = document.querySelector('input[name="tdDevTransporte"]:checked')?.value === 'externo';
  const alerta = document.getElementById('tdDevAlerta');
  let transportador = '';
  if(esExterno){
    const nombreExt = document.getElementById('tdDevNombreExterno').value.trim();
    if(!nombreExt){ alerta.textContent='Escribe el nombre del transportador.'; alerta.className='alerta error'; return; }
    transportador = 'EXT:' + nombreExt;
  } else {
    const nombreUsr = document.getElementById('tdDevUsuarioValor').value.trim();
    if(!nombreUsr){ alerta.textContent='Elige quién lo lleva.'; alerta.className='alerta error'; return; }
    transportador = nombreUsr;
  }
  if((tipo==='stock'||(tipo==='stock_multiple' && ((_pendienteDevolverStock?.items||[]).length||(_pendienteDevolverStock?.fibra||[]).length))) && (sesion.rol==='tecnico'||sesion.rol==='persona') && _destTipoDev()==='oficina' && !_destSedeDev()){ alerta.textContent='Elige a qué municipio lo devuelves.'; alerta.className='alerta error'; return; }
  try{
    const notas = document.getElementById('tdDevNotas').value.trim();
    let res;
    if(tipo==='recogido'){
      const cantRecogido = parseInt(document.getElementById('tdDevCantidad')?.value) || undefined;
      res = await _api('productos','devolver_recogido',{id, transportador, notas, cantidad:cantRecogido});
    } else if(tipo==='stock'){
      res = await _api('productos','devolver',{destino_tipo:_destTipoDev(), destino_sede:_destSedeDev(), ref:_pendienteDevolverStock.ref, cantidad:_pendienteDevolverStock.cantidad, motivo:notas||_pendienteDevolverStock.motivo, transportador, rollo_ids:_pendienteDevolverStock.rollo_ids});
    } else if(tipo==='stock_multiple'){
      const loteDevMultiple = `dm_${Date.now()}`;
      const _recs = _pendienteDevolverStock.recogidos || [];
      const resultados = await Promise.allSettled([
        ..._pendienteDevolverStock.items.map(([ref,cant]) => _api('productos','devolver',{destino_tipo:_destTipoDev(), destino_sede:_destSedeDev(), ref,cantidad:cant,motivo:notas||_pendienteDevolverStock.motivo,transportador,rollo_ids:_pendienteDevolverStock.rollos?.[ref]||undefined,lote_id:loteDevMultiple})),
        ..._recs.map(r => _api('productos','devolver_recogido',{id:r.id, transportador, notas:notas||_pendienteDevolverStock.motivo, cantidad:r.cantidad})),
        ...(_pendienteDevolverStock.fibra||[]).map(f => fetch('api/fibra.php?action=devolver_metros',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({carrete_id:f.carrete_id, metros:f.cantidad, descripcion:notas||_pendienteDevolverStock.motivo, transportador, lote_id:loteDevMultiple, destino_tipo:_destTipoDev(), destino_sede:_destSedeDev()})}).then(r=>r.json()).then(j=>{ if(j.error) throw new Error(j.error); return j; }))
      ]);
      const conError = resultados.filter(r=>r.status==='rejected' || r.value?.error);
      const _motivos = [...new Set(conError.map(r=>r.status==='rejected' ? (r.reason?.message||'Error de conexión') : r.value.error))];
      res = conError.length ? {error:`${conError.length} de ${resultados.length} productos con error: ${_motivos.join(' | ')}`} : {ok:true};
    } else {
      res = await _api('cajas','devolver_ont_almacen',{ont_id:id, transportador, motivo:notas});
    }
    if(res.error){ alerta.textContent=res.error; alerta.className='alerta error'; return; }
    const destinoMsg = ((tipo==='stock'||(tipo==='stock_multiple' && ((_pendienteDevolverStock?.items||[]).length||(_pendienteDevolverStock?.fibra||[]).length))) && (sesion.rol==='tecnico'||sesion.rol==='persona') && _destTipoDev()==='oficina') ? `la oficina de ${_destSedeDev()}` : 'el almacén central';
    toast(`En camino a ${destinoMsg} — se acreditará cuando lo confirmen recibido ✓`,'success');
    cerrarModal('modalTransporteDevolucion');
    if(typeof cargarMiFibra==='function') cargarMiFibra().catch(()=>{});
    await Promise.all([_recargarProductos(),_recargarHistorial(),(typeof _recargarSeguimiento==='function'?_recargarSeguimiento():Promise.resolve())]);
    if(typeof renderTabla==='function') renderTabla();
    if(typeof renderHistorial==='function') renderHistorial();
    _cargarRecogidoPendientes();
    if(typeof cargarMisOnt==='function') cargarMisOnt();
  }catch(e){ alerta.textContent='Error al devolver.'; alerta.className='alerta error'; }
}
async function _gastarMaterialRecogido(id, ref){
  // Se abre el mismo "Gastar" normal de ese producto, con "Recogido" ya
  // elegido — así el formulario es siempre el mismo, sin importar desde
  // dónde se gaste.
  const idx = getProductos().findIndex(p=>p.ref===ref);
  if(idx===-1){ toast('No se encontró ese producto en tu inventario.','error'); return; }
  await abrirGastar(idx);
  if(window._gastarRecogidoDisponible){
    const r = document.querySelector('input[name="gastarOrigenRecogido"][value="recogido"]');
    if(r){ r.checked = true; _gastarCambiarOrigenRecogido(); }
  } else {
    toast('No se encontró ese material — puede que ya se haya gastado o devuelto.','error');
  }
}
function _filtrarRecogidoProducto(){
  const q = (document.getElementById('recogidoProductoBuscar')?.value||'').split(' — 🏭')[0].toLowerCase().trim();
  const lista = document.getElementById('recogidoProductoLista');
  if(!lista) return;
  const productos = getProductos().filter(p=>!q||p.nombre.toLowerCase().includes(q)||p.ref.toLowerCase().includes(q)||(p.proveedor||'').toLowerCase().includes(q));
  const hl = (txt) => {
    txt = String(txt||'');
    if(!q||!txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))+`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`+esc(txt.slice(idx+q.length));
  };
  lista.innerHTML = productos.length ? productos.slice(0,30).map(p=>`
    <div onclick="_seleccionarRecogidoProducto('${esc(p.ref)}','${esc(p.nombre).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
      <div class="!font-semibold">${hl(p.nombre)}</div>
      <div class="!text-[11px] !text-[#94A3B8]">Ref. ${hl(p.ref)}${p.proveedor?` · <span class="!text-[#7C3AED] !font-semibold">🏭 ${hl(p.proveedor)}</span>`:''}</div>
    </div>`).join('') : '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>';
  lista.style.display='block';
}
function _seleccionarRecogidoProducto(ref,nombre){
  document.getElementById('recogidoProductoRef').value = ref;
  const _pSel = getProductos().find(x=>x.ref===ref);
  document.getElementById('recogidoProductoBuscar').value = nombre + (_pSel?.proveedor ? ' — 🏭 '+_pSel.proveedor : '');
  document.getElementById('recogidoProductoLista').style.display='none';
}
document.addEventListener('click', function(e){
  const lista=document.getElementById('recogidoProductoLista');
  const inp=document.getElementById('recogidoProductoBuscar');
  if(lista && inp && !inp.contains(e.target) && !lista.contains(e.target)) lista.style.display='none';
});
async function _ejecutarRegistrarRecogido(){
  const ref = document.getElementById('recogidoProductoRef').value;
  const cantidad = parseInt(document.getElementById('recogidoCantidad').value) || 0;
  const tipo = document.querySelector('input[name="recogidoTipo"]:checked')?.value;
  const motivo = document.getElementById('recogidoMotivo').value.trim();
  const alerta = document.getElementById('recogidoAlerta');
  alerta.style.display='none';
  const esNuevo = !!document.getElementById('recogidoEsNuevo')?.checked;
  const nomNuevo = (document.getElementById('recogidoNuevoNombre')?.value||'').trim();
  const provNuevo = (document.getElementById('recogidoNuevoProveedor')?.value||'').trim();
  if(esNuevo){
    if(!nomNuevo){ alerta.textContent='Escribe el nombre del producto.'; alerta.className='alerta error'; alerta.style.display='block'; return; }
  } else if(!ref){ alerta.textContent='Selecciona un producto de la lista.'; alerta.className='alerta error'; alerta.style.display='block'; return; }
  if(cantidad<1){ alerta.textContent='Ingresa una cantidad válida.'; alerta.className='alerta error'; alerta.style.display='block'; return; }
  // Confirmar producto + proveedor antes de guardar (evita confundir dos productos iguales de distinto proveedor)
  const _pConf = esNuevo ? null : getProductos().find(x=>x.ref===ref);
  const _nomConf = esNuevo ? nomNuevo : (_pConf?.nombre||ref);
  const _provConf = esNuevo ? provNuevo : (_pConf?.proveedor||'');
  mostrarConfirmar({
    icono:'♻️', color:'#0F766E',
    titulo:'¿Seguro de registrar este material?',
    desc:`${_nomConf}${esNuevo?' (nuevo)':''}\nProveedor: ${_provConf||'sin proveedor'}\nCantidad: ${cantidad} · ${tipo==='reutilizable'?'♻️ Reutilizable':'🛠 Dañado'}`,
    btnTxt:'Sí, registrar', btnColor:'#0F766E',
    onConfirmar: ()=>_guardarRecogido({ref,cantidad,tipo,motivo,esNuevo,nomNuevo,provNuevo})
  });
}
async function _guardarRecogido({ref,cantidad,tipo,motivo,esNuevo,nomNuevo,provNuevo}){
  const alerta = document.getElementById('recogidoAlerta');
  try{
    const res = await _api('productos','registrar_recogido', esNuevo ? {nuevo:true, nombre:nomNuevo, proveedor:provNuevo, cantidad, tipo, motivo} : {ref, cantidad, tipo, motivo});
    if(res.error){ alerta.textContent=res.error; alerta.className='alerta error'; alerta.style.display='block'; return; }
    cerrarModal('modalRegistrarRecogido');
    await _recargarHistorial();
    renderHistorial(); renderStats();
    toast(esNuevo ? 'Registrado — queda pendiente: devuélvelo al almacén para que lo acepten ✓' : tipo==='reutilizable' ? 'Registrado — queda aparte de tu inventario, disponible para devolver ✓' : 'Material dañado registrado ✓','success');
  }catch(e){ alerta.textContent='Error al registrar.'; alerta.className='alerta error'; alerta.style.display='block'; }
}

let _recibirSegId = null;
let _recibirRec = null; // datos del material recogido que se está recibiendo (conteo real)
function _recalcRecogido(){
  const m = _recibirRec; if(!m) return;
  const T = parseInt(m.cantidad)||0;
  const r = m.tipo==='reutilizable' ? (parseInt(document.getElementById('recibirCantReut').value)||0) : 0;
  const d = parseInt(document.getElementById('recibirCantDanRec').value)||0;
  const f = T - r - d;
  const el = document.getElementById('recibirRecogidoFaltan');
  if(f<0){ el.style.color='#B91C1C'; el.textContent=`⚠️ Pusiste ${-f} unidad(es) de más (se enviaron ${T}).`; }
  else if(f>0){ el.style.color='#B45309'; el.textContent=`Faltan ${f} unidad(es) — se le avisará a quien lo devolvió.`; }
  else { el.style.color='#166534'; el.textContent='✓ Llegó todo lo que se envió.'; }
}
async function confirmarRecibido(id){
  _recibirRec = null;
  const wrapRec = document.getElementById('recibirRecogidoWrap'); if(wrapRec) wrapRec.style.display='none';
  const lblDan = document.getElementById('recibirDanadoLbl'); if(lblDan) lblDan.style.display='flex';
  const _seg = (_seguimiento||[]).find(x=>x.id===id);
  if(_seg && _seg.tipo==='recogido' && _seg.referencia_id){
    try{
      const info = await _api('productos','recogido_info',null,'id='+encodeURIComponent(_seg.referencia_id));
      if(info && !info.error){
        _recibirRec = info;
        const T = parseInt(_seg.cantidad)||parseInt(info.cantidad)||0;
        _recibirRec.cantidad = T;
        const esReut = info.tipo==='reutilizable';
        wrapRec.style.display='block'; if(lblDan) lblDan.style.display='none';
        document.getElementById('recibirRecogidoTitulo').textContent = `${info.nombre}: registraron ${T} ${esReut?'reutilizable(s)':'dañado(s)'}. Cuenta lo que llegó:`;
        document.getElementById('recibirRecReutWrap').style.display = esReut ? 'block' : 'none';
        document.getElementById('recibirCantDanLbl').textContent = esReut ? '🛠 Dañados que llegaron' : '🛠 Unidades que llegaron';
        document.getElementById('recibirCantReut').value = esReut ? T : 0;
        document.getElementById('recibirCantDanRec').value = esReut ? 0 : T;
        _recalcRecogido();
      }
    }catch(e){}
  }
  _recibirSegId = id;
  const f = document.getElementById('recibirNotas'); if(f) f.value='';
  const chk = document.getElementById('recibirHayDanado'); if(chk) chk.checked=false;
  const cantWrap = document.getElementById('recibirCantDanadaWrap'); if(cantWrap) cantWrap.style.display='none';
  const cant = document.getElementById('recibirCantDanada'); if(cant) cant.value='';
  document.getElementById('modalRecibirEnvio')?.classList.add('open');
}
function _toggleRecibirDanado(){
  const chk = document.getElementById('recibirHayDanado');
  const wrap = document.getElementById('recibirCantDanadaWrap');
  if(wrap) wrap.style.display = chk?.checked ? 'block' : 'none';
}
async function _ejecutarConfirmarRecibido(){
  const id = _recibirSegId;
  if(!id) return;
  const notas = document.getElementById('recibirNotas')?.value.trim() || '';
  const hayDanado = document.getElementById('recibirHayDanado')?.checked;
  const cantidadDanada = (!_recibirRec && hayDanado) ? (parseInt(document.getElementById('recibirCantDanada')?.value) || 0) : 0;
  if(!_recibirRec && hayDanado && cantidadDanada < 1){ toast('Indica cuántas unidades llegaron dañadas','error'); return; }
  const cuerpo = {id, notas, cantidad_danada: cantidadDanada};
  if(_recibirRec){
    const T = parseInt(_recibirRec.cantidad)||0;
    const r = _recibirRec.tipo==='reutilizable' ? (parseInt(document.getElementById('recibirCantReut').value)||0) : 0;
    const d = parseInt(document.getElementById('recibirCantDanRec').value)||0;
    if(r+d>T){ toast(`No pueden llegar más de las ${T} unidades enviadas`,'error'); return; }
    if(_recibirRec.tipo==='reutilizable') cuerpo.cant_reutilizable = r;
    cuerpo.cant_danada_rec = d;
  }
  try{
    const res = await _api('seguimiento','recibido',cuerpo);
    if(res.error){ toast(res.error,'error'); return; }
    cerrarModal('modalRecibirEnvio');
    await Promise.all([_recargarSeguimiento(),_recargarProductos(),_recargarHistorial()]);
    renderSeguimiento(); renderTabla(); renderHistorial(); renderStats();
    toast(cantidadDanada>0 ? `Recibido confirmado — ${cantidadDanada} unidad(es) reportadas dañadas ✓` : 'Recibido confirmado ✓','success');
  }catch(e){ toast('Error al confirmar','error'); }
}

let tabHistorial="todos",tabMisSol="todos",tabMisPed="todos",tabUsuarios="todos",tabOficinas="todas";

// Detalle de CADA rollo del almacén central: "Rollo #12: 100 m" o, si ya se usó parte
// (ej. devolvieron un rollo de 100 m con 50 m gastados): "Rollo #15: 50 m de 100".
function _detalleRollosCentral(p){
  if(!(p.metrosPorUnidad && Array.isArray(p.rollosCentral) && p.rollosCentral.length)) return '';
  const fm = n => (n%1===0 ? n.toFixed(0) : n.toFixed(1));
  const info = p.rollosCentral.map(r=>{
    const tot = Number(r.metros)||0, disp = Math.max(0, tot-(Number(r.metrosUsados)||0));
    return {id:r.id, tot, disp, parcial: disp < tot};
  });
  const total = info.reduce((a,r)=>a+r.disp,0);
  const empezados = info.filter(r=>r.parcial);
  const completos = info.filter(r=>!r.parcial);
  // Resumen corto: "48 completos de 1000 m" (agrupados por tamaño) y los empezados aparte
  const grupos = {};
  completos.forEach(r=>{ grupos[r.tot] = (grupos[r.tot]||0)+1; });
  const txtCompletos = Object.keys(grupos).map(t=>`${grupos[t]} completo${grupos[t]>1?'s':''} de ${fm(Number(t))} m`).join(' · ');
  const chip = r => `<span style="display:inline-block;margin:1px 4px 1px 0;padding:1px 7px;border-radius:6px;font-size:10px;background:${r.parcial?'#FEF3C7':'#EFF6FF'};color:${r.parcial?'#92400E':'#1E40AF'};white-space:nowrap;">#${r.id}: ${fm(r.disp)} m${r.parcial?' de '+fm(r.tot):''}</span>`;
  const chipsEmp = empezados.map(chip).join('');
  const lista = info.map(chip).join('');
  return `<div class="!mt-[3px] !max-w-[240px]">
    <div class="!text-[11px] !text-[#64748B]">Total: <b>${fm(total)} m</b></div>
    ${txtCompletos?`<div class="!text-[10px] !text-[#1E40AF]">${txtCompletos}</div>`:''}
    ${empezados.length?`<div class="!text-[10px] !text-[#92400E] !mt-[1px]">Empezados:</div><div>${chipsEmp}</div>`:''}
    ${info.length>1?`<details class="!mt-[2px]" onclick="event.stopPropagation();"><summary class="!cursor-pointer !text-[10px] !text-[#64748B]">Ver los ${info.length} rollos</summary><div class="!max-h-[130px] !overflow-y-auto ![-webkit-overflow-scrolling:touch] !mt-[3px]">${lista}</div></details>`:''}
  </div>`;
}
function getProductos(){return _productos;}
function getHistorial(){return _historial;}
function getSolicitudes(){return _solicitudes;}
let _pedidosAgrupados = [];
function getPedidosAgrupados(){return _pedidosAgrupados;}
async function _recargarPedidosAgrupados(){
  try{
    const res = await fetch('api/pedidos_agrupados.php?action=listar',{credentials:'same-origin'});
    _pedidosAgrupados = await res.json();
  }catch{ _pedidosAgrupados=[]; }
}
function getPedidosMun(){return _pedidosMun;}
function getUsuarios(){return _usuarios;}

async function _recargarProductos(){window._misFibraCache=null;try{_productos=await _api('productos','listar');}catch{_productos=[];}}
// Estado paginación historial
let _histPagina = 1, _histPorPagina = 50, _histTotal = 0, _histPaginas = 0;

let _mapaActividadInstancia = null;
let _mapaPuntosCache = [];
let _mapaActividadMarcadores = [];
// Paleta de colores distinguibles para diferenciar productos en el mapa.
const _mapaPaletaColores = ['#E24B4A','#0C6EDE','#16A871','#F59E0B','#8B5CF6','#EC4899','#06B6D4','#F97316','#84CC16','#6366F1','#14B8A6','#D946EF','#A16207','#0F766E','#BE123C','#1D4ED8','#4D7C0F','#7E22CE','#C2410C','#0E7490','#475569','#DB2777'];
const _mapaColorPorProducto = {};
function _colorParaProducto(nombre){
  const clave = (nombre||'—').trim();
  if(_mapaColorPorProducto[clave]) return _mapaColorPorProducto[clave];
  // Se asigna el siguiente color disponible de la paleta, en orden — así
  // los primeros productos que aparecen tienen colores bien distintos entre sí.
  const idx = Object.keys(_mapaColorPorProducto).length % _mapaPaletaColores.length;
  _mapaColorPorProducto[clave] = _mapaPaletaColores[idx];
  return _mapaColorPorProducto[clave];
}
// Campos de "escribir y elegir": Prod (producto), Quien (quién lo instaló), Cli (cliente / proyecto).
// El <select> oculto guarda el valor elegido; el campo de texto solo lo muestra y busca.
const _MAPA_COMBOS = {
  Prod:{todos:'Todos los productos'},
  Quien:{todos:'Quién lo instaló: todos'},
  Cli:{todos:'Cliente / proyecto: todos'}
};
function _mapaComboSel(k){ return document.getElementById('mapaFiltro'+(k==='Prod'?'Producto':k)); }
function _mapaComboBuscar(k, todos){
  const inp = document.getElementById('mapa'+k+'Input'), lista = document.getElementById('mapa'+k+'Lista'), sel = _mapaComboSel(k);
  if(!inp||!lista||!sel) return;
  const q = todos ? '' : inp.value.toLowerCase().trim();
  const ops = [...sel.options].filter(o=>o.value && (!q || (o.textContent||'').toLowerCase().includes(q)));
  const fila = (val, txt, extra)=>`<div data-k="${k}" data-v="${esc(val)}" onclick="_mapaComboPick(this.dataset.k,this.dataset.v)" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;${extra||''}" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">${esc(txt)}</div>`;
  lista.innerHTML = fila('', '✕ '+_MAPA_COMBOS[k].todos, 'color:#64748B;font-weight:600;') +
    (ops.length ? ops.map(o=>fila(o.value,o.textContent)).join('') : '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>');
  lista.style.display='block';
}
function _mapaComboPick(k, v){
  const sel = _mapaComboSel(k), inp = document.getElementById('mapa'+k+'Input');
  document.getElementById('mapa'+k+'Lista').style.display='none';
  if(sel){ sel.value = v; if(inp) inp.value = v ? ([...sel.options].find(o=>o.value===v)?.textContent||v) : ''; cargarMapaActividad(); }
}
function _mapaComboSync(k){
  const sel = _mapaComboSel(k), inp = document.getElementById('mapa'+k+'Input');
  if(inp && sel && document.activeElement!==inp) inp.value = sel.value ? ([...sel.options].find(o=>o.value===sel.value)?.textContent||sel.value) : '';
}
function _mapaLimpiarFiltros(){
  ['mapaFiltroDesde','mapaFiltroHasta','mapaFiltroRol','mapaFiltroProducto','mapaFiltroQuien','mapaFiltroCli'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  ['Prod','Quien','Cli'].forEach(k=>{ const i=document.getElementById('mapa'+k+'Input'); if(i) i.value=''; });
  cargarMapaActividad();
}
document.addEventListener('click', function(e){
  ['Prod','Quien','Cli'].forEach(k=>{
    const l = document.getElementById('mapa'+k+'Lista'), i = document.getElementById('mapa'+k+'Input');
    if(!(l && i) || i.contains(e.target) || l.contains(e.target)) return;
    if(l.style.display==='none') return;
    l.style.display='none';
    const sel = _mapaComboSel(k);
    if(sel && !i.value.trim() && sel.value){ sel.value=''; cargarMapaActividad(); }
    else _mapaComboSync(k);
  });
});
const _MAPA_ROLES = {superadmin:'Administrador', distribuidor:'Distribuidor', municipio:'Oficina / municipio', tecnico:'Técnico', persona:'Persona'};
function _mapaElegirProducto(nombre){
  const sel = document.getElementById('mapaFiltroProducto');
  if(!sel) return;
  sel.value = (sel.value===nombre) ? '' : nombre;
  _mapaComboSync('Prod');
  cargarMapaActividad();
}
function _filtrarMapaActividad(){
  const q = (document.getElementById('mapaBuscarPunto')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('mapaBuscarLista');
  if(!lista) return;
  if(!q){ lista.style.display='none'; return; }
  const filtrados = _mapaPuntosCache
    .map((p,idx)=>({p, idx}))
    .filter(({p})=>
      (p.titulo||'').toLowerCase().includes(q) ||
      (p.quien||'').toLowerCase().includes(q) ||
      (p.destino||'').toLowerCase().includes(q) ||
      (p.sn||'').toLowerCase().includes(q)
    )
    .slice(0, 20);
  if(!filtrados.length){
    lista.innerHTML = '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>';
  } else {
    lista.innerHTML = filtrados.map(({p,idx})=>{
      const color = _colorParaProducto(p.producto || p.titulo);
      const fechaFmt = p.fecha ? new Date(p.fecha).toLocaleDateString('es-CO') : '';
      return `<div onclick="_irAPuntoMapa(${idx})" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;display:flex;align-items:center;gap:8px;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
        <div class="![flex:1] !min-w-[0]">
          <div class="!font-semibold !overflow-hidden !text-ellipsis !whitespace-nowrap">${esc(p.titulo||'—')}</div>
          <div class="!text-[11px] !text-[#94A3B8]">${esc(p.quien||'')} · ${fechaFmt}</div>
        </div>
      </div>`;
    }).join('');
  }
  lista.style.display='block';
}
function _irAPuntoMapa(idx){
  const p = _mapaPuntosCache[idx];
  const marcador = _mapaActividadMarcadores[idx];
  if(!p || !marcador || !_mapaActividadInstancia) return;
  document.getElementById('mapaBuscarLista').style.display='none';
  const grupo = _mapaActividadInstancia._marcadores;
  if(grupo && typeof grupo.zoomToShowLayer==='function'){
    grupo.zoomToShowLayer(marcador, ()=>marcador.openPopup());
  } else {
    _mapaActividadInstancia.setView([p.lat, p.lng], 17);
    setTimeout(()=>marcador.openPopup(), 300);
  }
}
document.addEventListener('click', function(e){
  const cont = document.getElementById('mapaBuscarLista');
  const inp = document.getElementById('mapaBuscarPunto');
  if(cont && inp && !inp.contains(e.target) && !cont.contains(e.target)) cont.style.display='none';
});
function _abrirMarcarRetirado(id, titulo){
  // El popup de Leaflet tiene su propio z-index alto — si no se cierra
  // primero, queda tapando el modal de confirmación.
  if(_mapaActividadInstancia) _mapaActividadInstancia.closePopup();
  mostrarConfirmar({
    icono:'🗑️', color:'#B91C1C',
    titulo:'¿Marcar como retirado?',
    desc:`"${titulo}" — se sigue viendo en Historial, pero desaparece del mapa como algo activo. Usa esto cuando ya no está ahí (se dañó, se lo robaron, lo cambiaron).`,
    btnTxt:'Sí, marcar retirado', btnColor:'#B91C1C',
    withNotes:true,
    notesLabel:'Motivo',
    notesPlaceholder:'Ej: Se lo robaron, se dañó, se cambió por otro equipo...',
    notesRequired:true,
    onConfirmar: async(motivo)=>{
      try{
        const res = await _api('historial','marcar_retirado',{id, motivo});
        if(res.error){ toast(res.error,'error'); return; }
        toast('Marcado como retirado ✓','success');
        cargarMapaActividad();
      }catch(e){ toast('Error al marcar retirado','error'); }
    }
  });
}
async function cargarMapaActividad(){
  const loading = document.getElementById('mapaActividadLoading');
  const cont = document.getElementById('mapaActividadContenedor');
  const vacio = document.getElementById('mapaActividadVacio');
  const contador = document.getElementById('mapaContador');
  if(!cont) return;
  if(loading) loading.style.display='block';
  cont.style.display='none';
  if(vacio) vacio.style.display='none';

  const desde = document.getElementById('mapaFiltroDesde')?.value || '';
  const hasta = document.getElementById('mapaFiltroHasta')?.value || '';
  const soloActivos = document.getElementById('mapaSoloActivos')?.checked !== false;
  const params = new URLSearchParams();
  if(desde) params.set('desde', desde);
  if(hasta) params.set('hasta', hasta);
  params.set('solo_activos', soloActivos ? '1' : '0');

  try{
    const res = await fetch(`api/historial.php?action=puntos_mapa&${params}`,{credentials:'same-origin'});
    const data = await res.json();
    let puntos = Array.isArray(data?.puntos) ? data.puntos : [];
    if(loading) loading.style.display='none';

    // Opciones de los filtros según lo que hay en el rango de fechas elegido
    const llenar = (id, valores, etiqueta, todos)=>{
      const sel = document.getElementById(id); if(!sel) return;
      const actual = sel.value;
      sel.innerHTML = `<option value="">${todos}</option>` + valores.map(v=>`<option value="${esc(v)}">${esc(etiqueta?etiqueta(v):v)}</option>`).join('');
      if(valores.includes(actual)) sel.value = actual;
    };
    const quienDe = p => (p.quien||'').trim();
    const cliDe = p => (p.proyecto||p.cliente||'').trim();
    const nombreQuien = {};
    puntos.forEach(p=>{ if(quienDe(p)) nombreQuien[quienDe(p)] = p.quien_nombre||quienDe(p); });
    llenar('mapaFiltroQuien', Object.keys(nombreQuien).sort((a,b)=>nombreQuien[a].localeCompare(nombreQuien[b])), v=>nombreQuien[v]+(nombreQuien[v]!==v?' ('+v+')':''), 'Quién lo instaló: todos');
    llenar('mapaFiltroRol', [...new Set(puntos.map(p=>p.rol).filter(Boolean))].sort(), v=>_MAPA_ROLES[v]||v, 'Tipo de usuario: todos');
    llenar('mapaFiltroCli', [...new Set(puntos.map(cliDe).filter(Boolean))].sort((a,b)=>a.localeCompare(b)), null, 'Cliente / proyecto: todos');
    const fQuien = document.getElementById('mapaFiltroQuien')?.value || '';
    const fRol = document.getElementById('mapaFiltroRol')?.value || '';
    const fCli = document.getElementById('mapaFiltroCli')?.value || '';
    if(fQuien) puntos = puntos.filter(p=>quienDe(p)===fQuien);
    if(fRol) puntos = puntos.filter(p=>p.rol===fRol);
    if(fCli) puntos = puntos.filter(p=>cliDe(p)===fCli);

    const selectProd = document.getElementById('mapaFiltroProducto');
    if(selectProd){
      const actual = selectProd.value;
      const productosUnicos = [...new Set(puntos.map(p=>(p.producto||p.titulo||'—').trim()))].sort();
      selectProd.innerHTML = '<option value="">Todos los productos</option>' +
        productosUnicos.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');
      if(productosUnicos.includes(actual)) selectProd.value = actual;
    }
    ['Prod','Quien','Cli'].forEach(_mapaComboSync);
    const filtroProd = selectProd?.value || '';
    const puntosTodos = puntos;
    if(filtroProd) puntos = puntos.filter(p=>(p.producto||p.titulo||'—').trim()===filtroProd);

    if(!puntos.length){
      if(vacio) vacio.style.display='block';
      if(contador) contador.textContent = '';
      return;
    }
    const cuerpo = document.getElementById('mapaCuerpo');
    if(cuerpo) cuerpo.style.display='grid';
    cont.style.display='block';
    if(contador) contador.textContent = `${puntos.length} punto${puntos.length!==1?'s':''} en el mapa`;
    _mapaPuntosCache = puntos;

    // Panel lateral: productos con su cantidad de puntos (los más usados primero).
    // Tocar uno filtra el mapa por ese producto; tocarlo otra vez lo quita.
    const leyenda = document.getElementById('mapaLeyenda');
    if(leyenda){
      const cuenta = {};
      puntosTodos.forEach(p=>{ const c=(p.producto||p.titulo||'—').trim(); cuenta[c]=(cuenta[c]||0)+1; });
      const items = Object.keys(cuenta).sort((a,b)=>cuenta[b]-cuenta[a]||a.localeCompare(b));
      leyenda.innerHTML = items.map(c=>`
        <div class="mapa-leg-item${c===filtroProd?' sel':''}" data-prod="${esc(c)}" onclick="_mapaElegirProducto(this.dataset.prod)" title="${esc(c)}">
          <span style="width:12px;height:12px;border-radius:50%;background:${_colorParaProducto(c)};display:inline-block;flex-shrink:0;"></span>
          <span class="t">${esc(c)}</span><span class="n">${cuenta[c]}</span>
        </div>`).join('');
      const tot = document.getElementById('mapaLegTotal');
      if(tot) tot.textContent = items.length+' tipo'+(items.length!==1?'s':'');
    }

    // Crear el mapa una sola vez; si ya existe, solo se actualizan los marcadores
    if(!_mapaActividadInstancia){
      _mapaActividadInstancia = L.map('mapaActividadContenedor');
      agregarCapaBaseMapa(_mapaActividadInstancia);
      _mapaActividadInstancia._marcadores = L.layerGroup().addTo(_mapaActividadInstancia);
    } else {
      _mapaActividadInstancia._marcadores.clearLayers();
      setTimeout(()=>_mapaActividadInstancia.invalidateSize(), 50);
    }

    _mapaActividadMarcadores = [];
    const bounds = [];
    puntos.forEach((p,idx)=>{
      if(!p.lat || !p.lng) return;
      const color = p.retirado ? '#94A3B8' : _colorParaProducto(p.producto || p.titulo);
      const icono = L.divIcon({
        className: '',
        html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:2.5px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4);${p.retirado?'opacity:.55;':''}"></div>`,
        iconSize:[16,16], iconAnchor:[8,8],
      });
      const fechaFmt = p.fecha ? new Date(p.fecha).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'}) : '';
      const puedeRetirar = sesion.rol==='superadmin'||sesion.rol==='distribuidor'||tienePermiso('marcar_retirado');
      const retiradoInfo = p.retirado
        ? `<div class="!mt-[6px] !p-[6px_8px] ![background:#FEF3C7] !rounded-[6px] !text-[11px] !text-[#92400E]">🚫 Retirado por ${esc(p.retirado_por||'—')} — ${esc(p.retirado_motivo||'')}</div>`
        : (p.tipo==='gasto' && puedeRetirar ? `<button onclick="_abrirMarcarRetirado(${p.id},'${esc((p.titulo||'').replace(/'/g,"\\'"))}')" style="margin-top:8px;width:100%;padding:6px 10px;background:#FCEBEB;color:#B91C1C;border:none;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;">🗑️ Marcar como retirado</button>` : '');
      const popupHtml = `
        <div style="font-family:'DM Sans',sans-serif;min-width:180px;">
          <div class="!font-bold !text-[13px] !mb-[4px]">${esc(p.titulo||'—')}</div>
          ${p.cantidad?`<div class="!text-[12px] !text-[#64748B]">Cantidad: ${p.cantidad}</div>`:''}
          ${p.quien?`<div class="!text-[12px] !text-[#64748B]">Por: ${esc(p.quien)}</div>`:''}
          ${p.destino?`<div class="!text-[12px] !text-[#64748B]">${esc(p.destino)}</div>`:''}
          ${p.proyecto?`<div class="!text-[11px] !font-bold !text-[#B45309] ![background:#FFFBEB] !inline-block !p-[2px_7px] !rounded-[5px] !mt-[4px]">🏗️ ${esc(p.proyecto)}</div>`:''}
          <div class="!text-[11px] !text-[#94A3B8] !mt-[4px]">${fechaFmt}</div>
          ${retiradoInfo}
        </div>`;
      const marcador = L.marker([p.lat, p.lng], {icon: icono}).bindPopup(popupHtml).addTo(_mapaActividadInstancia._marcadores);
      _mapaActividadMarcadores[idx] = marcador;
      bounds.push([p.lat, p.lng]);
    });
    if(bounds.length){
      _mapaActividadInstancia.fitBounds(bounds, {padding:[30,30], maxZoom:16});
    }
    setTimeout(()=>_mapaActividadInstancia.invalidateSize(), 100);
  }catch(e){
    if(loading) loading.style.display='none';
    if(vacio){ vacio.style.display='block'; vacio.textContent='Error al cargar el mapa.'; }
  }
}
async function _recargarHistorial(){
  try{
    const res = await _api('historial','listar');
    // Compatibilidad: si devuelve array plano (viejo) o objeto paginado (nuevo)
    if(Array.isArray(res)){ _historial=res; }
    else { _historial=[]; } // se carga directo en renderHistorial con paginación
  }catch{ _historial=[]; }
}
async function _recargarSolicitudes(){try{_solicitudes=await _api('solicitudes','listar');}catch{_solicitudes=[];}}
async function _recargarPedidos(){
  // Todos pueden ver sus propios pedidos — el backend filtra por sede
  try{_pedidosMun=await _api('pedidos','listar');}catch{_pedidosMun=[];}
}
async function _recargarUsuarios(){
  try{
    const res = await fetch('api/usuarios.php?action=listar',{credentials:'same-origin'});
    const data = await res.json();
    if(!res.ok) throw new Error(data.error||`Error ${res.status}`);
    _usuarios = Array.isArray(data) ? data : (data.usuarios||data.data||[]);
  }catch(e){
    console.error('[Usuarios] Error al cargar:', e.message);
    _usuarios=[];
    toast('Error al cargar usuarios: '+e.message,'error');
  }
}

async function saveProductos(p){_productos=p;}  // ya actualizado localmente, PHP se llama por separado
async function saveHistorial(h){_historial=h;}
async function saveSolicitudes(s){_solicitudes=s;}
async function savePedidosMun(p){_pedidosMun=p;}
async function saveSedes(s){}
