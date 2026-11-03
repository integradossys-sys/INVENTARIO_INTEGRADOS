/* ════════════════════════════════════════════════
   MIS EQUIPOS — municipio / técnico
════════════════════════════════════════════════ */
let _meOntEstado='todos';

function setTabMisEquipos(t){
  ['ont','fibra','hist_ont','hist_fibra','olt','mikrotik','sst'].forEach(id=>{
    document.getElementById('tabME_'+id)?.classList.toggle('active',id===t);
    const el=document.getElementById('meTab_'+id);
    if(el) el.style.display=id===t?'':'none';
  });
  if(t==='ont')        cargarMisOnt();
  if(t==='fibra')      { setMeFibSub('carr'); cargarMiFibra(); }
  if(t==='hist_ont')   cargarHistOnt();
  if(t==='olt')        { setMeOltSub('inv'); cargarMisOlt(); }
  if(t==='mikrotik')   { setMeMkSub('inv'); cargarMisMikrotik(); }
  if(t==='sst')        { sstRenderMio('meSstLista'); actualizarBadgeMisSst(); }
}

// Badge visual para el estado de un equipo
// Celda "Sede / Ubicación": si el equipo está en comodato/instalado en un cliente, se muestra el
// cliente y la dirección (dónde está de verdad) y, más pequeño, la sede donde quedó registrado.
function _celdaUbicacionEquipo(o){
  const sede = esc(o.sede||'—');
  // Quién lo tiene: la persona asignada (nombre completo) o, si no hay, "de la oficina".
  let quien = '';
  if(o.asignado_a){
    const n = (o.asignado_nombre||'').trim();
    quien = `<div class="!text-[11px] !text-[#475569]">👤 ${n?esc(n)+' <span class="!text-[#94A3B8]">@'+esc(o.asignado_a)+'</span>':'@'+esc(o.asignado_a)}</div>`;
  } else if(o.sede && !/^almac[eé]n central$/i.test(o.sede)){
    quien = `<div class="!text-[11px] !text-[#94A3B8]">👥 De la oficina (sin persona asignada)</div>`;
  }
  if(['comodato','instalado'].includes(o.estado||'') && (o.cliente_nombre||o.cliente_direccion)){
    return `<div class="!font-semibold">🏢 ${esc(o.cliente_nombre||'—')}</div>`
      + (o.cliente_direccion?`<div class="!text-[11px] !text-[#475569]">📍 ${esc(o.cliente_direccion)}</div>`:'')
      + quien
      + `<div class="!text-[10px] !text-[#94A3B8]">Sede: ${sede}</div>`;
  }
  return `<div class="!font-semibold">${sede}</div>` + quien;
}
function _badgeEstadoEquipo(estado){
  const map={
    activo:     ['badge-ok','✅ Activo'],
    inactivo:   ['badge-gray','⚪ Inactivo'],
    instalado:  ['badge-purple','📌 Instalado'],
    comodato:   ['badge-purple','🤝 Comodato'],
    recuperado: ['badge-warn','♻️ Recuperado'],
    en_venta:   ['badge-warn','⏳ En venta'],
    vendido:    ['badge-gray','💰 Vendido'],
    de_baja:    ['badge-gray','🚫 De baja'],
    'dañado':   ['badge-danger','⚠️ Dañado'],
    'dañada':   ['badge-danger','⚠️ Dañado'],
  };
  const [cls,lbl]=map[estado]||['badge-gray', esc(estado||'—')];
  return `<span class="badge ${cls}">${lbl}</span>`;
}

let _misOltData=[], _misOltFiltroEstado='todos';
async function cargarMisOlt(){
  const grid=document.getElementById('meOltGrid');
  if(!grid) return;
  grid.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[32px]">Cargando…</div>';
  try{
    const r=await fetch(`api/equipos.php?action=listar_olts&sede=${encodeURIComponent(sesion.sede)}`,{credentials:'same-origin'});
    const data=await r.json();
    if(!Array.isArray(data)) throw new Error(data.error||'Respuesta inválida');
    _misOltData=data; _misOltFiltroEstado='todos';
    renderMisOlt('');
  }catch(e){ grid.innerHTML=`<div class="!text-[#E24B4A] !p-[16px]">${esc(e.message)}</div>`; }
}
function filtrarMisOltEstado(est){ _misOltFiltroEstado=est; renderMisOlt(document.getElementById('oltBuscar')?.value||''); }
function buscarMisOlt(){ renderMisOlt(document.getElementById('oltBuscar')?.value||''); }
function renderMisOlt(q){
  const grid=document.getElementById('meOltGrid');
  if(!grid) return;
  const qLow=(q||'').toLowerCase();
  const barra=_barraFiltroEquipo('olt', _misOltFiltroEstado, q, _misOltData);
  if(!_misOltData.length){
    grid.innerHTML=barra+'<div class="!text-center !p-[32px] !text-[#94A3B8] !text-[13px]">No hay OLTs asignadas a tu sede.</div>';
    return;
  }
  let data=_misOltData;
  if(_misOltFiltroEstado!=='todos') data=data.filter(o=>(o.estado||'')===_misOltFiltroEstado);
  if(qLow) data=data.filter(o=>(`${o.marca||''} ${o.modelo||''}`).toLowerCase().includes(qLow));
  if(!data.length){
    grid.innerHTML=barra+'<div class="!text-center !p-[24px] !text-[#94A3B8] !text-[13px]">Sin OLTs que coincidan.</div>';
    return;
  }
  grid.innerHTML=barra+`<div class="scroll-area tbl-wrap"><table>
    <thead><tr><th>#</th><th>Marca</th><th>Modelo</th><th>Tarjetas PON</th><th>Puertos PON</th><th>Estado</th><th>Fecha</th><th>Acción</th></tr></thead>
    <tbody>${data.map((o,i)=>`<tr>
      <td class="!text-[#94A3B8]">${i+1}</td>
      <td class="!font-semibold">${esc(o.marca)}</td>
      <td>${esc(o.modelo)}</td>
      <td>${esc(o.tarjetas_pon??'—')}</td>
      <td>${esc(o.puertos_pon??'—')}</td>
      <td>${_badgeEstadoEquipo(o.estado)}${['comodato','instalado'].includes(o.estado||'')&&o.cliente_nombre?`<div class="!text-[11px] !text-[#475569] !mt-[3px]">🏢 ${esc(o.cliente_nombre)}${o.cliente_direccion?`<br>📍 ${esc(o.cliente_direccion)}`:''}</div>`:''}</td>
      <td class="!text-[11px] !text-[#94A3B8] !whitespace-nowrap">${fmtDate(o.fecha)}</td>
      <td>${_accionesMenu('ol_0'+o.id, `
        <button onclick="abrirHistorialEquipo('olt',${parseInt(o.id)},'${esc((o.marca||'')+' '+(o.modelo||''))}')" class="btn-sm ![background:#E0F2FE] !text-[#0369A1]">📜 Historial</button>
        <button onclick="abrirEstadoEquipo('olt',${parseInt(o.id)},'${esc((o.marca||'')+' '+(o.modelo||''))}','${esc(o.estado||'')}','${esc(o.sede||'')}')" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6]">✎ Estado</button>
        ${['activo','recuperado'].includes(o.estado)?`<button onclick="abrirVenderEquipo('olt',${parseInt(o.id)},'${esc((('OLT '+(o.marca||'')+' '+(o.modelo||'')).trim()))}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">💰 Vender</button>`:''}
        ${(_puedeAsignarEquipoDirecto(o)&&!['dañado','de_baja'].includes(o.estado))?`<button onclick="abrirAsignarEquipo('olt',${parseInt(o.id)},'${esc((o.marca||'')+' '+(o.modelo||''))}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">➤ Asignar</button>`:''}
        ${(o.estado==='recuperado'||o.estado==='activo'||o.estado==='comodato')?`<button onclick="abrirDevolverEquipo('olt',${parseInt(o.id)},'${esc((o.marca||'')+' '+(o.modelo||''))}')" class="btn-sm ![background:#E6F1FB] !text-[#0A58B5]">↩ Devolver</button>`:''}
      `)}</td>
    </tr>`).join('')}</tbody></table></div>`;
}
// Solo la oficina (municipio) y admin/distribuidor pueden repartir un
// equipo directamente a otra persona — técnico/persona solo lo reciben,
// lo devuelven o le cambian el estado (con confirmación de quien corresponda).
function _puedeAsignarEquipoDirecto(eq){
  const r = sesion?.rol;
  if(r==='municipio' || r==='superadmin') return true;
  // Técnico/persona: pueden pasarle a otra persona SOLO el equipo que tienen en su poder
  if(r==='tecnico' || r==='persona') return !!eq && (eq.asignado_a||'')===sesion.usuario;
  return false;
}

// Barra de filtros reutilizable para equipos (tipo: 'olt' | 'mikrotik')
function _barraFiltroEquipo(tipo, filtroActual, q, data){
  // "De baja" e "Inactivos" los maneja solo el administrador/distribuidor; el resto
  // (municipio, técnico, persona) ve únicamente los estados con los que trabaja.
  const _admEq = (sesion?.rol==='superadmin'||sesion?.rol==='distribuidor');
  const estados=[
    ['todos','Todos'],['activo','✅ Activos'],['instalado','📌 Instalados'],
    ['comodato','🤝 Comodato'],['recuperado','♻️ Recuperados'],['dañado','⚠️ Dañados'],
    ...(_admEq ? [['de_baja','🚫 De baja'],['inactivo','⚪ Inactivos']] : [])
  ];
  const fnFiltro = tipo==='olt' ? 'filtrarMisOltEstado' : 'filtrarMisMkEstado';
  const fnBuscar = tipo==='olt' ? 'buscarMisOlt' : 'buscarMisMk';
  const idBuscar = tipo==='olt' ? 'oltBuscar' : 'mkBuscar';
  const placeholder = tipo==='olt' ? '🔍 Buscar marca o modelo…' : '🔍 Buscar proveedor, modelo, SN o MAC…';
  // Conteo por estado (sobre todos los datos cargados)
  const cuenta=(v)=> v==='todos' ? (data||[]).length : (data||[]).filter(x=>(x.estado||'')===v).length;
  const botones=estados.map(([v,l])=>{
    const n=cuenta(v);
    return `<button onclick="${fnFiltro}('${v}')" class="tab-btn ${filtroActual===v?'active':''}" style="font-size:12px;">${l} <span class="!opacity-[.7]">(${n})</span></button>`;
  }).join('');
  return `<div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;">${botones}</div>
    <div class="!mb-[14px]">
      <input id="${idBuscar}" class="inp" value="${esc(q||'')}" oninput="${fnBuscar}()" placeholder="${placeholder}" style="max-width:320px;margin:0;">
    </div>`;
}

let _misMkData=[], _misMkFiltroEstado='todos';
let _misMkTipoActual = '';

async function cargarMisMikrotik(){
  // Cargar tipos si no están
  if(!_tiposEquipo.length) await cargarTiposEquipo();

  const tabRow = document.getElementById('meTiposTabRow');
  const cont   = document.getElementById('meTipoContenido');
  if(!tabRow||!cont) return;

  if(!_tiposEquipo.length){
    tabRow.innerHTML='';
    cont.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[40px]">No hay tipos de equipo configurados aún.</div>';
    return;
  }

  // Generar sub-pestañas — TODOS los tipos, aunque estén vacíos
  tabRow.innerHTML = _tiposEquipo.map(t=>`
    <button class="tab-btn ${_misMkTipoActual===t.nombre?'active':''} !text-[12px]"
      data-metipo="${esc(t.nombre)}"
      onclick="setMeTipoActivo('${esc(t.nombre)}')">
      ${t.icono} ${esc(t.nombre)}
    </button>`).join('');

  // Activar el primero si ninguno está activo
  if(!_misMkTipoActual || !_tiposEquipo.find(t=>t.nombre===_misMkTipoActual)){
    _misMkTipoActual = _tiposEquipo[0].nombre;
  }
  setMeTipoActivo(_misMkTipoActual);
}

async function setMeTipoActivo(nombre){
  _misMkTipoActual = nombre;
  document.querySelectorAll('[data-metipo]').forEach(b=>{
    b.classList.toggle('active', b.dataset.metipo===nombre);
  });
  const tipo = _tiposEquipo.find(t=>t.nombre===nombre);
  const cont = document.getElementById('meTipoContenido');
  if(!cont) return;

  cont.innerHTML=`<div class="!text-[#94A3B8] !text-center !p-[40px]">Cargando…</div>`;
  try{
    const r=await fetch(`api/equipos.php?action=listar_mikrotiks&sede=${encodeURIComponent(sesion.sede)}`,{credentials:'same-origin'});
    const data=await r.json();
    if(!Array.isArray(data)) throw new Error(data.error||'Error');
    const filtrados = data.filter(m=>(m.tipo_equipo||'Mikrotik')===nombre);
    const q='';
    const barra=_barraFiltroEquipo('mikrotik', 'todos', q, filtrados);
    if(!filtrados.length){
      cont.innerHTML=barra+`<div class="!text-center !p-[40px] !text-[#94A3B8] !text-[13px]">No tienes ${esc(nombre)}s asignados a tu sede.</div>`;
      return;
    }
    cont.innerHTML=barra+`<div class="scroll-area tbl-wrap"><table>
      <thead><tr><th>#</th><th>Marca</th><th>Modelo</th><th>SN</th><th>MAC</th><th>Estado</th><th>Fecha</th><th>Acción</th></tr></thead>
      <tbody>${filtrados.map((m,i)=>{
        const nom=((m.marca||m.proveedor||'')+' '+(m.modelo||'')).trim();
        return `<tr>
          <td class="!text-[#94A3B8]">${i+1}</td>
          <td class="!font-semibold">${esc(m.marca||m.proveedor||'—')}</td>
          <td>${esc(m.modelo)}</td>
          <td class="![font-family:monospace] !text-[12px]">${esc(m.sn||'—')}</td>
          <td class="![font-family:monospace] !text-[12px]">${esc(m.mac_fmt||m.mac||'—')}</td>
          <td>${_badgeEstadoEquipo(m.estado)}${['comodato','instalado'].includes(m.estado||'')&&m.cliente_nombre?`<div class="!text-[11px] !text-[#475569] !mt-[3px]">🏢 ${esc(m.cliente_nombre)}${m.cliente_direccion?`<br>📍 ${esc(m.cliente_direccion)}`:''}</div>`:''}</td>
          <td class="!text-[11px] !text-[#94A3B8] !whitespace-nowrap">${fmtDate(m.fecha)}</td>
          <td>${_accionesMenu('mi_1'+m.id, `
            <button onclick="abrirHistorialEquipo('mikrotik',${parseInt(m.id)},'${esc(nom)}')" class="btn-sm ![background:#E0F2FE] !text-[#0369A1]">📜 Historial</button>
            <button onclick="abrirEstadoEquipo('mikrotik',${parseInt(m.id)},'${esc(nom)}','${esc(m.estado||'')}','${esc(m.sede||'')}')" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6]">✎ Estado</button>
            ${['activo','recuperado'].includes(m.estado)?`<button onclick="abrirVenderEquipo('mikrotik',${parseInt(m.id)},'${esc(nom)}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">💰 Vender</button>`:''}
            ${(_puedeAsignarEquipoDirecto(m)&&!['dañado','de_baja'].includes(m.estado))?`<button onclick="abrirAsignarEquipo('mikrotik',${parseInt(m.id)},'${esc(nom)}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">➤ Asignar</button>`:''}
            ${(m.estado==='recuperado'||m.estado==='activo'||m.estado==='comodato')?`<button onclick="abrirDevolverEquipo('mikrotik',${parseInt(m.id)},'${esc(nom)}')" class="btn-sm ![background:#E6F1FB] !text-[#0A58B5]">↩ Devolver</button>`:''}
          `)}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }catch(e){ cont.innerHTML=`<div class="!text-[#E24B4A] !p-[16px]">⚠ ${esc(e.message)}</div>`; }
}

/* ── Sub-pestañas Inventario/Historial dentro de Mis equipos (OLT y Mikrotik) ── */
function setMeFibSub(t){
  document.getElementById('meFibSub_carr')?.classList.toggle('active',t==='carr');
  document.getElementById('meFibSub_hist')?.classList.toggle('active',t==='hist');
  const carr=document.getElementById('meFibCarr'), hist=document.getElementById('meFibHist');
  if(carr) carr.style.display = t==='carr'?'':'none';
  if(hist) hist.style.display = t==='hist'?'':'none';
  if(t==='hist') cargarHistFibra();
}
function setMeOltSub(t){
  document.getElementById('meOltSub_inv')?.classList.toggle('active',t==='inv');
  document.getElementById('meOltSub_hist')?.classList.toggle('active',t==='hist');
  const inv=document.getElementById('meOltInv'), hist=document.getElementById('meOltHist');
  if(inv)  inv.style.display  = t==='inv'?'':'none';
  if(hist) hist.style.display = t==='hist'?'':'none';
  if(t==='hist') cargarMiOltHistorial();
}
function setMeMkSub(t){
  document.getElementById('meMkSub_inv')?.classList.toggle('active',t==='inv');
  document.getElementById('meMkSub_hist')?.classList.toggle('active',t==='hist');
  const inv=document.getElementById('meMkInv'), hist=document.getElementById('meMkHist');
  if(inv)  inv.style.display  = t==='inv'?'':'none';
  if(hist) hist.style.display = t==='hist'?'':'none';
  if(t==='hist') cargarMiMkHistorial();
}

// Historial de equipos de MI sede (movimientos de envío) — filtra por la sede del usuario
async function _cargarHistEquipoSede(tipo, gridId){
  const grid=document.getElementById(gridId);
  if(!grid) return;
  grid.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[32px]">Cargando…</div>';
  const miSede=(sesion?.sede||'');
  try{
    const rEnv=await fetch('api/seguimiento.php?action=listar&tipo='+tipo,{credentials:'same-origin'});
    let envios=await rEnv.json();
    if(!Array.isArray(envios)) envios=[];
    // Solo movimientos donde mi sede es origen o destino
    envios=envios.filter(e=>e.tipo===tipo && (e.origen===miSede || e.destino===miSede));
    if(!envios.length){
      grid.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[32px] !text-[13px]">Sin movimientos registrados para tu sede.</div>';
      return;
    }
    const badgeEst={aprobado:'badge-warn',en_camino:'badge-warn',entregado:'badge-ok',recibido:'badge-ok',cancelado:'badge-danger'};
    grid.innerHTML=`<div class="scroll-area tbl-wrap"><table>
      <thead><tr><th>Equipo</th><th>Origen</th><th>Destino</th><th>Estado</th><th>Despachado</th><th>Recibido</th></tr></thead>
      <tbody>${envios.map(e=>`<tr>
        <td class="!font-semibold">${esc(e.nombre_producto||'—')}</td>
        <td>${esc(e.origen||'—')}</td>
        <td>${esc(e.destino||'—')}</td>
        <td><span class="badge ${badgeEst[e.estado]||'badge-gray'}">${esc(e.estado)}</span></td>
        <td class="!text-[11px] !text-[#94A3B8] !whitespace-nowrap">${e.fecha_aprobado?fmtDate(e.fecha_aprobado):'—'}</td>
        <td class="!text-[11px] !text-[#94A3B8] !whitespace-nowrap">${e.fecha_recibido?fmtDate(e.fecha_recibido):'—'}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }catch(e){ grid.innerHTML=`<div class="!text-[#E24B4A] !p-[16px]">${esc(e.message)}</div>`; }
}
function cargarMiOltHistorial(){ return _cargarHistEquipoSede('olt','meOltHistGrid'); }
function cargarMiMkHistorial(){ return _cargarHistEquipoSede('mikrotik','meMkHistGrid'); }

/* ── Modal de cambio de estado de equipo ── */
let _estadoEquipo = null; // {tipo, id}
// Estados que quedan pendientes de que la persona nombrada confirme que es
// cierto, en vez de aplicarse de una — debe coincidir con
// ESTADOS_EQUIPO_CON_CONFIRMACION del backend (api/equipos.php). Esa misma
// persona es quien aparece en el campo "Instalado por"/"Reportado por"/
// "Retirado por"/"Autorizado por" de cada estado — no hay un campo aparte:
// así se evita que alguien ponga a otra persona sin que esta se entere.
const ESTADOS_EQUIPO_CON_CONFIRMACION = ['dañado','recuperado','de_baja','comodato','instalado'];
// Qué campo (con su "…Valor" oculto) guarda a la persona responsable de
// cada estado, para leerlo al guardar.
const CAMPO_RESPONSABLE_POR_ESTADO = {
  instalado:  'instResponsable',
  comodato:   'comodInstalador',
  recuperado: 'recResponsable',
  dañado:     'danResponsable',
  de_baja:    'bajAutorizado',
};

function toggleCamposInstalacion(){
  const estado = document.getElementById('estadoEqSelect')?.value;
  const bloques = {
    instalado:  'camposInstalacion',
    comodato:   'camposComodato',
    recuperado: 'camposRecuperado',
    dañado:     'camposDanado',
    de_baja:    'camposBaja',
  };
  Object.entries(bloques).forEach(([est, id])=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.style.display = estado === est ? 'flex' : 'none';
  });
}

// Buscador de usuario genérico y reutilizable, filtrado por rol — se usa
// en los campos "Instalado por"/"Reportado por"/"Retirado por" (solo
// técnico/persona — nunca admin, distribuidor ni municipio) y "Autorizado
// por" de baja (solo administrador). Muestra cualquier técnico/persona
// activo del sistema, sin importar su sede — puede confirmar cualquiera
// de ese rol, no solo los de la misma oficina del equipo.
let _respEqUsuariosCache = null;
async function _respEqFiltrar(inputId, resultadosId, valorId, rolesPermitidos){
  const q = (document.getElementById(inputId)?.value||'').toLowerCase().trim();
  const cont = document.getElementById(resultadosId);
  if(!cont) return;
  // Campo fijo (técnico/persona: queda a su nombre) → no hay nada que buscar.
  if(document.getElementById(inputId)?.readOnly){ cont.style.display='none'; cont.innerHTML=''; return; }
  // No se muestra la lista completa: solo aparecen coincidencias cuando se empieza a escribir.
  if(!q){ cont.style.display='none'; cont.innerHTML=''; return; }
  if(!_respEqUsuariosCache){
    try{
      const res = await fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'});
      _respEqUsuariosCache = await res.json();
      if(!Array.isArray(_respEqUsuariosCache)) _respEqUsuariosCache = [];
    }catch(e){ _respEqUsuariosCache = []; }
  }
  const candidatos = _respEqUsuariosCache.filter(u=> rolesPermitidos.includes(u.rol));
  const encontrados = candidatos.filter(u=>
    ((u.nombre||'')+' '+(u.apellido||'')+' '+(u.usuario||'')).toLowerCase().includes(q)
  ).slice(0,8);
  cont.innerHTML = encontrados.length
    ? encontrados.map(u=>`<div onclick="_respEqSeleccionar('${inputId}','${resultadosId}','${valorId}','${u.usuario}','${(u.nombre||'')} ${(u.apellido||'')} @${u.usuario}')" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #F1F5F9;font-size:13px;" onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'"><b>${(u.nombre||'')} ${(u.apellido||'')}</b> <span class="!text-[#94A3B8]">@${u.usuario} · ${u.rol||''}</span></div>`).join('')
    : `<div class="!p-[10px] !text-center !text-[#94A3B8] !text-[12px]">Sin resultados${candidatos.length?'':' — no hay usuarios con ese rol'}</div>`;
  cont.style.display = 'block';
}
function _respEqSeleccionar(inputId, resultadosId, valorId, usuario, etiqueta){
  document.getElementById(valorId).value = usuario;
  document.getElementById(inputId).value = etiqueta;
  document.getElementById(resultadosId).style.display = 'none';
}

function abrirEstadoEquipo(tipo, id, nombre, estadoActual, sede){
  _estadoEquipo = {tipo, id, sede: sede||'', estadoActual: estadoActual||''};
  document.getElementById('estadoEqNombre').textContent = nombre;
  document.getElementById('estadoEqTipo').textContent = (tipo==='olt'?'OLT':'Mikrotik');
  const sel = document.getElementById('estadoEqSelect');
  sel.value = estadoActual || 'activo';
  document.getElementById('estadoEqNota').value = '';
  // Limpiar todos los campos extra (incluyendo los "…Valor" ocultos de los
  // buscadores de usuario responsable y sus listas de resultados)
  ['instClienteProyecto','instMunicipio','instNodo','instRack','instResponsable','instResponsableValor','instCodigoCliente',
   'comodClienteProyecto','comodMunicipio','comodZona','comodInstalador','comodInstaladorValor',
   'recMunicipio','recNodo','recResponsable','recResponsableValor',
   'danTipo','danResponsable','danResponsableValor','bajMotivo','bajAutorizado','bajAutorizadoValor'].forEach(fid=>{
    const el=document.getElementById(fid); if(el) el.value='';
  });
  ['instResponsableResultados','comodInstaladorResultados','recResponsableResultados','danResponsableResultados','bajAutorizadoResultados',
   'instClienteProyectoResultados','comodClienteProyectoResultados'].forEach(rid=>{
    const el=document.getElementById(rid); if(el){ el.style.display='none'; el.innerHTML=''; }
  });
  // Técnico/persona: "Instalado/Retirado/Reportado por" sale FIJO con su propio nombre
  // (no se cambia) y no hay espera de confirmación. Municipio/otros: eligen a alguien y esperan.
  const _campoEsCampo = (sesion?.rol==='tecnico'||sesion?.rol==='persona');
  const _miNombre = ((sesion?.nombre||'')+' '+(sesion?.apellido||'')).trim() || sesion?.usuario || '';
  [['instResponsable','camposInstalacion'],['comodInstalador','camposComodato'],['recResponsable','camposRecuperado'],['danResponsable','camposDanado']].forEach(([fid,bid])=>{
    const inp=document.getElementById(fid); if(!inp) return;
    if(!inp.dataset.phOrig) inp.dataset.phOrig = inp.placeholder||'';
    const val=document.getElementById(fid+'Valor');
    const lbl = inp.closest('div.\\!relative')?.previousElementSibling;
    const ast = lbl?.querySelector?.('span');
    const aviso = [...(document.getElementById(bid)?.querySelectorAll('div')||[])].find(d=>d.children.length===0 && (d.textContent||'').trim().startsWith('⏳'));
    if(_campoEsCampo){
      inp.value = `${_miNombre} @${sesion.usuario}`; if(val) val.value = sesion.usuario;
      inp.readOnly = true; inp.style.background='#F1F5F9'; inp.style.cursor='not-allowed';
      const rb=document.getElementById(fid+'Resultados'); if(rb){ rb.style.display='none'; rb.innerHTML=''; }
      if(ast) ast.style.display='none';
      if(aviso) aviso.style.display='none';
    } else {
      inp.readOnly = false; inp.style.background=''; inp.style.cursor='';
      inp.placeholder = inp.dataset.phOrig;
      if(ast) ast.style.display='';
      if(aviso) aviso.style.display='';
    }
  });
  _ubiReset();
  // Equipo ya en comodato/instalado: se muestran los datos guardados (cliente y ubicación) para poder corregirlos.
  try{
    if(['comodato','instalado'].includes(estadoActual||'')){
      const eq=[...(tipo==='olt'?[...(_misOltData||[]),...(window._invOltData||[])]:[...(_misMkData||[]),...(window._invMkData||[])])].find(x=>String(x.id)===String(id));
      const pref = estadoActual==='comodato' ? ['comodClienteProyecto','comodMunicipio'] : ['instClienteProyecto','instMunicipio'];
      if(eq){
        const c=document.getElementById(pref[0]); if(c) c.value=eq.cliente_nombre||'';
        const d=document.getElementById(pref[1]); if(d) d.value=eq.cliente_direccion||'';
      }
      const selAct=document.getElementById('estadoEqSelect'); if(selAct && [...selAct.options].some(o=>o.value===estadoActual)) selAct.value=estadoActual;
    }
  }catch(e){}
  toggleCamposInstalacion();
  _cargarClientesExistentesEquipo();
  document.getElementById('modalEstadoEquipo')?.classList.add('open');
}

/* ════════════════════════════════════════════════
   UBICACIÓN (opcional): mi ubicación actual · elegir en el mapa · escribir
   Reemplaza los campos "Municipio" y "Zona / Sector". Estilos en línea.
════════════════════════════════════════════════ */
const _UBI_PREFIJOS = ['instUbi','comodUbi','recUbi','teComodUbi','teRecUbi'];
function _ubiHtml(pref, textId, zonaId){
  const b='font-size:12px;padding:6px 12px;';
  return `<div style="grid-column:1/-1;">
    <label class="lbl">📍 Ubicación / dirección <span style="color:#E24B4A;">*</span></label>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px;">
      <button type="button" class="btn btn-ghost" id="${pref}BtnGps" style="${b}" onclick="_ubiGps('${pref}','${textId}')">📍 Mi ubicación actual</button>
      <button type="button" class="btn btn-ghost" style="${b}" onclick="_ubiMapa('${pref}','${textId}')">🗺️ Elegir en el mapa</button>
    </div>
    <input id="${textId}" class="inp" placeholder="✏️ Dirección: municipio, barrio o dirección exacta" autocomplete="off">
    <input type="hidden" id="${zonaId}" value="">
    <input type="hidden" id="${pref}Lat"><input type="hidden" id="${pref}Lng">
    <div id="${pref}Status" style="font-size:11.5px;color:#64748B;margin-top:4px;"></div>
  </div>`;
}
function _ubiReset(){
  _UBI_PREFIJOS.forEach(p=>{
    ['Lat','Lng'].forEach(k=>{ const el=document.getElementById(p+k); if(el) el.value=''; });
    const st=document.getElementById(p+'Status'); if(st) st.innerHTML='';
  });
}
function _ubiCoords(pref){
  const lat=(document.getElementById(pref+'Lat')?.value||'').trim(), lng=(document.getElementById(pref+'Lng')?.value||'').trim();
  return (lat&&lng) ? {lat, lng} : {};
}
async function _ubiNombreLugar(lat, lng){
  try{
    const res = await fetchConTiempo(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16&addressdetails=1`, {headers:{'Accept-Language':'es'}}, 5000);
    const a = (await res.json())?.address || {};
    const barrio = a.neighbourhood || a.suburb || a.quarter || a.road || '';
    const ciudad = a.city || a.town || a.village || a.municipality || a.county || '';
    return [barrio, ciudad].filter(Boolean).join(', ');
  }catch(e){ return ''; }
}
async function _ubiAplicar(pref, textId, lat, lng, origen){
  lat = Number(lat).toFixed(6); lng = Number(lng).toFixed(6);
  document.getElementById(pref+'Lat').value = lat; document.getElementById(pref+'Lng').value = lng;
  const st = document.getElementById(pref+'Status');
  const link = `<a href="https://maps.google.com/?q=${lat},${lng}" target="_blank" style="color:#0369A1;text-decoration:underline;">${lat}, ${lng}</a>`;
  if(st){ st.style.color='#166534'; st.innerHTML = `✓ ${origen}: ${link} — buscando el nombre del lugar…`; }
  const campo = document.getElementById(textId);
  let lugar = '';
  if(campo && !campo.value.trim()){ lugar = await _ubiNombreLugar(lat, lng); if(lugar) campo.value = lugar; }
  if(st) st.innerHTML = `✓ ${origen}: ${link}${lugar?' · '+esc(lugar):''}`;
}
function _ubiGps(pref, textId){
  const st = document.getElementById(pref+'Status'), btn = document.getElementById(pref+'BtnGps');
  if(!navigator.geolocation){ if(st){ st.style.color='#B91C1C'; st.textContent='Tu navegador no permite usar la ubicación. Elige en el mapa o escríbela.'; } return; }
  if(btn){ btn.disabled=true; btn.textContent='📍 Buscando…'; }
  if(st){ st.style.color='#0369A1'; st.textContent='Obteniendo tu ubicación…'; }
  navigator.geolocation.getCurrentPosition(
    async pos=>{ await _ubiAplicar(pref, textId, pos.coords.latitude, pos.coords.longitude, 'Ubicación actual'); if(btn){ btn.disabled=false; btn.textContent='📍 Mi ubicación actual'; } },
    err=>{ if(st){ st.style.color='#B91C1C'; st.textContent = err.code===1 ? 'No diste permiso de ubicación. Puedes elegir en el mapa o escribirla.' : 'No se pudo obtener la ubicación. Elige en el mapa o escríbela.'; } if(btn){ btn.disabled=false; btn.textContent='📍 Mi ubicación actual'; } },
    {enableHighAccuracy:true, timeout:10000}
  );
}
function _ubiMapa(pref, textId){
  _abrirMapaElegirGastar(pref+'Lat', pref+'Lng', pref+'Status', (lat,lng)=>_ubiAplicar(pref, textId, lat, lng, 'Elegida en el mapa'));
}

(function _ubiMontar(){
  [['instUbiBox','instUbi','instMunicipio','instUbiZ'],['comodUbiBox','comodUbi','comodMunicipio','comodZona'],['recUbiBox','recUbi','recMunicipio','recNodo']].forEach(([box,pref,t,z])=>{
    const el=document.getElementById(box); if(el && !el.innerHTML.trim()) el.innerHTML=_ubiHtml(pref,t,z);
  });
})();

// Lista de Cliente/Proyecto ya usados antes (en OLT o Mikrotik, incluyendo
// los que quedaron en comodato), para poder elegir uno en vez de escribirlo
// de cero. El campo sigue siendo de texto libre: si lo que se escribe no
// está en la lista, se pide confirmar que es nuevo (ver
// _confirmarClienteProyectoNuevo). Antes esto usaba un <datalist> nativo del
// navegador, pero esa sugerencia nativa es poco visible/poco confiable
// (varía según navegador y a veces no aparece) — ahora es un desplegable
// propio, igual que el buscador de usuarios.
let _clientesEquipoCache = null;
async function _cargarClientesExistentesEquipo(){
  if(!_clientesEquipoCache){
    try{
      const res = await fetch('api/equipos.php?action=clientes_existentes', {credentials:'same-origin'});
      _clientesEquipoCache = await res.json();
      if(!Array.isArray(_clientesEquipoCache)) _clientesEquipoCache = [];
    }catch(e){ _clientesEquipoCache = []; }
  }
}
async function _clienteEqFiltrar(inputId, resultadosId){
  const input = document.getElementById(inputId);
  const cont = document.getElementById(resultadosId);
  if(!input || !cont) return;
  if(!_clientesEquipoCache) await _cargarClientesExistentesEquipo();
  const q = (input.value||'').toLowerCase().trim();
  const lista = _clientesEquipoCache||[];
  const encontrados = q ? lista.filter(n=>(n||'').toLowerCase().includes(q)) : lista;
  const qOrig = (input.value||'').trim();
  const existeExacto = lista.some(n=>(n||'').toLowerCase().trim()===q);
  let filas = encontrados.map(n=>`<div onmousedown="event.preventDefault();_clienteEqSeleccionar('${inputId}','${resultadosId}','${(n||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")}')" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #F1F5F9;font-size:13px;" onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'">${esc(n)}</div>`).join('');
  // Nombre que no existe todavía → opción "➕ Crear nuevo" (sin ventana de confirmación aparte).
  if(qOrig && !existeExacto){
    filas += `<div onmousedown="event.preventDefault();_clienteEqCrearNuevo('${inputId}','${resultadosId}')" style="padding:9px 12px;cursor:pointer;font-size:13px;color:#B45309;font-weight:600;" onmouseover="this.style.background='#FFFBEB'" onmouseout="this.style.background='white'">➕ Crear cliente/proyecto nuevo "${esc(qOrig)}"</div>`;
  }
  cont.innerHTML = filas;
  cont.style.display = filas ? 'block' : 'none';
}
// Nombres que la persona ya marcó con "➕ Crear nuevo": no se vuelve a preguntar.
const _clientesNuevosOk = new Set();
function _clienteEqCrearNuevo(inputId, resultadosId){
  const input = document.getElementById(inputId);
  const nombre = (input?.value||'').trim();
  if(nombre) _clientesNuevosOk.add(nombre.toLowerCase());
  const cont = document.getElementById(resultadosId); if(cont) cont.style.display='none';
  toast(`Se creará el cliente/proyecto "${nombre}" al guardar ✓`,'success');
}
// Al salir del campo se cierra la lista (para que no tape el resto del formulario).
document.addEventListener('focusout', e=>{
  const el=e.target; if(!el || !el.id || !/ClienteProyecto$|ComodCliente$/.test(el.id)) return;
  setTimeout(()=>{ const c=document.getElementById(el.id+'Resultados'); if(c && document.activeElement!==el) c.style.display='none'; },150);
});
function _clienteEqSeleccionar(inputId, resultadosId, nombre){
  document.getElementById(inputId).value = nombre;
  document.getElementById(resultadosId).style.display = 'none';
}
// Si el Cliente/Proyecto escrito no está en la lista de los ya existentes,
// pregunta si se quiere crear como uno nuevo — para que no sea un error de
// tipeo el que termine creando un cliente/proyecto distinto sin querer.
function _confirmarClienteProyectoNuevo(nombre){
  // Ya no se pregunta con ventana: si el nombre es nuevo, se crea (en la lista aparece "➕ Crear nuevo" como pista).
  return Promise.resolve(true);
}
function _confirmarClienteProyectoNuevo_VIEJO(nombre){
  const existentes = (_clientesEquipoCache||[]).map(n=>(n||'').toLowerCase().trim());
  if(existentes.includes((nombre||'').toLowerCase().trim())) return Promise.resolve(true);
  if(_clientesNuevosOk.has((nombre||'').toLowerCase().trim())) return Promise.resolve(true);
  // Aviso propio (estilos en línea, no depende de Tailwind) en vez del confirm() del navegador.
  return new Promise(resolve=>{
    document.getElementById('modalCpNuevoEq')?.remove();
    const m = document.createElement('div');
    m.id = 'modalCpNuevoEq'; m.className = 'modal-bg open'; m.style.zIndex = '10000';
    m.innerHTML = `<div class="modal-box" style="max-width:410px;text-align:center;">
      <div style="width:56px;height:56px;background:linear-gradient(135deg,#FEF3C7,#FDE68A);border-radius:16px;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:27px;">🆕</div>
      <h3 style="font-family:Syne,sans-serif;font-weight:700;font-size:18px;margin:0 0 8px;">Cliente / proyecto nuevo</h3>
      <div style="display:inline-block;background:#F1F5F9;border-radius:10px;padding:7px 15px;font-weight:700;font-size:14px;color:#0F172A;margin-bottom:10px;max-width:100%;word-break:break-word;"></div>
      <p style="color:#64748B;font-size:13px;line-height:1.55;margin:0 0 18px;">No está en la lista de clientes/proyectos existentes.<br>¿Quieres crearlo como uno nuevo? Revisa que esté bien escrito para no duplicarlo.</p>
      <div style="display:flex;gap:10px;">
        <button class="btn btn-ghost" style="flex:1;" id="cpEqNo">Corregir nombre</button>
        <button class="btn btn-primary" style="flex:1;" id="cpEqSi">✅ Sí, crear nuevo</button>
      </div></div>`;
    m.querySelector('div > div:nth-of-type(2)').textContent = nombre;
    document.body.appendChild(m);
    const fin = v=>{ m.remove(); resolve(v); };
    m.querySelector('#cpEqNo').onclick = ()=>fin(false);
    m.querySelector('#cpEqSi').onclick = ()=>fin(true);
    m.addEventListener('mousedown', e=>{ if(e.target===m) fin(false); });
  });
}

async function confirmarEstadoEquipo(){
  if(!_estadoEquipo){ toast('Equipo no seleccionado','error'); return; }
  const estado = document.getElementById('estadoEqSelect').value;
  let nota = document.getElementById('estadoEqNota').value.trim();
  const partes = [];

  // El campo "Instalado por"/"Reportado por"/"Retirado por"/"Autorizado
  // por" de cada estado ahora es, a la vez, quien debe confirmar que el
  // cambio es cierto — se busca como usuario real del sistema, filtrado
  // por rol (ver CAMPO_RESPONSABLE_POR_ESTADO y los roles permitidos en
  // cada campo del HTML).
  const campoResp = CAMPO_RESPONSABLE_POR_ESTADO[estado];
  let responsableUsuario = campoResp ? (document.getElementById(campoResp+'Valor')?.value||'').trim() : '';
  // Admin/distribuidor: pueden aplicar el estado de una vez (p. ej. equipo que ya estaba en comodato al alimentar el sistema) sin esperar confirmación de nadie. Si eligen a alguien, queda pendiente como siempre.
  const _esAdminDist = (sesion?.rol==='superadmin'||sesion?.rol==='distribuidor');
  // Técnico/persona: si el equipo lo tiene él, se registra de una vez (el mismo es quien lo hizo).
  const _esCampo = (sesion?.rol==='tecnico'||sesion?.rol==='persona') && estado!=='de_baja';
  const _aplicarDirecto = (_esAdminDist || _esCampo) && !responsableUsuario;

  let clienteProyectoEq = '', direccionEq = '';
  if(estado === 'instalado'){
    clienteProyectoEq = (document.getElementById('instClienteProyecto')?.value||'').trim();
    if(!clienteProyectoEq){ toast('Escribe el Cliente/Proyecto donde quedó instalado — es obligatorio.','error'); return; }
    if(!responsableUsuario && !_esAdminDist && !_esCampo){ toast('Busca y elige quién instaló — es obligatorio para confirmar el cambio.','error'); return; }
    if(!(await _confirmarClienteProyectoNuevo(clienteProyectoEq))) return;
    const municipio   = (document.getElementById('instMunicipio')?.value||'').trim();
    if(!municipio){ toast('Falta la ubicación: usa tu ubicación actual, elígela en el mapa o escribe la dirección.','error'); document.getElementById('instMunicipio')?.focus(); return; }
    const nodo        = (document.getElementById('instNodo')?.value||'').trim();
    const rack        = (document.getElementById('instRack')?.value||'').trim();
    const responsable = (document.getElementById('instResponsable')?.value||'').trim();
    const codCliente  = (document.getElementById('instCodigoCliente')?.value||'').trim();
    direccionEq = [municipio, nodo, rack].filter(Boolean).join(' · ');
    if(municipio)   partes.push(`Ubicación: ${municipio}`);
    if(nodo)        partes.push(`Nodo/Zona: ${nodo}`);
    if(rack)        partes.push(`Rack: ${rack}`);
    if(responsable) partes.push(`Instalado por: ${responsable}`);
    if(codCliente)  partes.push(`Código cliente: ${codCliente}`);
  } else if(estado === 'comodato'){
    clienteProyectoEq = (document.getElementById('comodClienteProyecto')?.value||'').trim();
    if(!clienteProyectoEq){ toast('Escribe el Cliente/Proyecto del comodato — es obligatorio.','error'); return; }
    if(!responsableUsuario && !_esAdminDist && !_esCampo){ toast('Busca y elige quién instaló — es obligatorio para confirmar el cambio.','error'); return; }
    if(!(await _confirmarClienteProyectoNuevo(clienteProyectoEq))) return;
    const municipio  = (document.getElementById('comodMunicipio')?.value||'').trim();
    if(!municipio){ toast('Falta la ubicación: usa tu ubicación actual, elígela en el mapa o escribe la dirección.','error'); document.getElementById('comodMunicipio')?.focus(); return; }
    const zona       = (document.getElementById('comodZona')?.value||'').trim();
    const instalador = (document.getElementById('comodInstalador')?.value||'').trim();
    direccionEq = [municipio, zona].filter(Boolean).join(' · ');
    if(municipio)  partes.push(`Ubicación: ${municipio}`);
    if(zona)       partes.push(`Zona: ${zona}`);
    if(instalador) partes.push(`Instalado por: ${instalador}`);
  } else if(estado === 'recuperado'){
    if(!responsableUsuario && !_esAdminDist && !_esCampo){ toast('Busca y elige quién lo retiró — es obligatorio para confirmar el cambio.','error'); return; }
    const municipio   = (document.getElementById('recMunicipio')?.value||'').trim();
    if(!municipio){ toast('Falta la ubicación: usa tu ubicación actual, elígela en el mapa o escribe la dirección.','error'); document.getElementById('recMunicipio')?.focus(); return; }
    const nodo        = (document.getElementById('recNodo')?.value||'').trim();
    const responsable = (document.getElementById('recResponsable')?.value||'').trim();
    direccionEq = [municipio, nodo].filter(Boolean).join(' · ');
    if(municipio)   partes.push(`Ubicación: ${municipio}`);
    if(nodo)        partes.push(`Zona: ${nodo}`);
    if(responsable) partes.push(`Retirado por: ${responsable}`);
  } else if(estado === 'dañado'){
    const tipo        = (document.getElementById('danTipo')?.value||'').trim();
    const responsable = (document.getElementById('danResponsable')?.value||'').trim();
    if(!tipo){ toast('Describe el tipo de daño — es obligatorio','error'); return; }
    if(!responsableUsuario && !_esAdminDist && !_esCampo){ toast('Busca y elige quién lo reportó — es obligatorio para confirmar el cambio.','error'); return; }
    if(tipo)        partes.push(`Daño: ${tipo}`);
    if(responsable) partes.push(`Reportado por: ${responsable}`);
  } else if(estado === 'de_baja'){
    const motivo      = (document.getElementById('bajMotivo')?.value||'').trim();
    const autorizado  = (document.getElementById('bajAutorizado')?.value||'').trim();
    if(!motivo){ toast('Selecciona el motivo de baja — es obligatorio','error'); return; }
    if(!responsableUsuario && !_esAdminDist){ toast('Busca y elige qué administrador autoriza — es obligatorio para confirmar el cambio.','error'); return; }
    if(motivo)      partes.push(`Motivo: ${motivo}`);
    if(autorizado)  partes.push(`Autorizado por: ${autorizado}`);
  }

  if(nota) partes.push(`Nota: ${nota}`);
  nota = partes.join(' | ');

  try{
    const r=await fetch('api/equipos.php?action=cambiar_estado_equipo',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({tipo:_estadoEquipo.tipo, id:_estadoEquipo.id, estado, nota, cliente_nombre:clienteProyectoEq||undefined, cliente_direccion:direccionEq||undefined, responsable_usuario:responsableUsuario||undefined, directo:_aplicarDirecto||undefined, ..._ubiCoords(estado==='instalado'?'instUbi':estado==='comodato'?'comodUbi':estado==='recuperado'?'recUbi':'')})
    });
    const d=await r.json();
    if(!r.ok||d.error) throw new Error(d.error||'Error');
    cerrarModal('modalEstadoEquipo');
    if(d.pendiente){
      toast(`Enviado ✓ — queda pendiente hasta que ${d.confirma||'esa persona'} confirme`,'success');
    } else {
      toast('Estado actualizado ✓','success');
    }
    if(_estadoEquipo.tipo==='olt'){ try{cargarMisOlt();}catch(e){} try{if(document.getElementById('oltTabla')) cargarOlts();}catch(e){} }
    else { try{cargarMisMikrotik();}catch(e){} try{if(typeof cargarMikrotiks==='function') cargarMikrotiks();}catch(e){} }
    _estadoEquipo=null;
  }catch(e){ toast(e.message,'error'); }
}

/* ── Historial de un equipo (OLT / Mikrotik) ── */
async function abrirHistorialEquipo(tipo, id, nombre){
  document.getElementById('histEqNombre').textContent = (tipo==='olt'?'OLT · ':'Mikrotik · ')+nombre;
  const body=document.getElementById('histEqBody');
  body.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[24px]">Cargando…</div>';
  document.getElementById('modalHistEquipo')?.classList.add('open');
  try{
    const r=await fetch(`api/equipos.php?action=historial_equipo&tipo=${tipo}&id=${id}`,{credentials:'same-origin'});
    const d=await r.json();
    if(!r.ok||d.error) throw new Error(d.error||'Error');

    const nombres=d.nombres||{};
    // Nombre completo (con el usuario en pequeño); si no se conoce, solo el usuario.
    const nm=u=>{ u=String(u||'').replace(/^EXT:/,'').trim(); if(!u) return '—'; return nombres[u] ? `<b>${esc(nombres[u])}</b> <span class="!text-[#94A3B8] !text-[11px]">@${esc(u)}</span>` : `<b>${esc(u)}</b>`; };
    const eq=d.equipo||{};
    const enCliente=['comodato','instalado'].includes(eq.estado||'') && (eq.cliente_nombre||eq.cliente_direccion);
    const fila=(l,v)=>v?`<div style="display:flex;gap:8px;margin-top:5px;"><span style="min-width:112px;color:#94A3B8;">${l}</span><span style="flex:1;">${v}</span></div>`:'';
    let html='';
    html+=`<div style="background:#F8FAFC;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;">
      ${fila('Equipo', `<b>${esc(((eq.marca||'')+' '+(eq.modelo||'')).trim()||nombre)}</b>${eq.sn?` · SN ${esc(eq.sn)}`:''}${eq.mac?` · MAC ${esc(eq.mac)}`:''}${eq.proveedor?`<div class="!text-[11px] !text-[#7C3AED]">🏭 ${esc(eq.proveedor)}</div>`:''}`)}
      ${fila('Estado actual', _badgeEstadoEquipo(eq.estado))}
      ${enCliente?fila('Está en', `<b>🏢 ${esc(eq.cliente_nombre||'—')}</b>${eq.cliente_direccion?`<div class="!text-[12px] !text-[#475569]">📍 ${esc(eq.cliente_direccion)}</div>`:''}`):''}
      ${fila('Sede', `<b>${esc(eq.sede||'—')}</b>`)}
      ${fila('En poder de', eq.asignado_a?nm(eq.asignado_a):'<span class="!text-[#64748B]">La oficina (sin persona puntual)</span>')}
      ${fila('Registrado', `${[eq.registrado_por?`por ${nm(eq.registrado_por)}`:'', eq.fecha?fmtDate(eq.fecha):''].filter(Boolean).join(' · ')}`)}
    </div>`;

    // ── Cambios de estado (salen de las notas del equipo, uno por línea) ──
    const crudas=(eq.notas||'').split(/\n(?=\[\d{2}\/\d{2}\/\d{4})/).map(x=>x.trim()).filter(Boolean);
    const cambios=[]; const sueltas=[];
    crudas.forEach(t=>{
      const m=t.match(/^\[(\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}) · ([^·\]]+) · ([^\]]+)\]\s*([\s\S]*)$/);
      if(m) cambios.push({fecha:m[1], estado:m[2].trim(), usuario:m[3].trim(), texto:m[4].trim()}); else sueltas.push(t);
    });
    if(cambios.length || sueltas.length){
      html+='<div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !tracking-[.06em] !mb-[10px]">Cambios de estado</div>';
      html+=cambios.slice().reverse().map(c=>{
        const partes=c.texto.split(/\s+\|\s+/).map(x=>x.trim()).filter(Boolean);
        const titulo=partes.shift()||'';
        const lineas=partes.filter(x=>!/^Registrado por:/i.test(x)).map(x=>{
          const mm=x.match(/^([^:]{2,24}):\s*([\s\S]+)$/);
          return mm?`<div><span class="!text-[#94A3B8]">${esc(mm[1])}:</span> ${esc(mm[2])}</div>`:`<div>${esc(x)}</div>`;
        }).join('');
        return `<div class="![border:1px_solid_#E2E8F0] !rounded-[10px] !p-[12px_14px] !mb-[10px]">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
            <span>${_badgeEstadoEquipo(c.estado)}</span>
            <span class="!text-[11px] !text-[#94A3B8]">🕒 ${esc(c.fecha)}</span>
          </div>
          <div class="!text-[12px] !text-[#475569] !leading-[1.7]">
            <div><span class="!text-[#94A3B8]">Registró:</span> ${nm(c.usuario)}</div>
            ${titulo?`<div>${esc(titulo)}</div>`:''}
            ${lineas}
          </div></div>`;
      }).join('');
      sueltas.forEach(t=>{ html+=`<div class="!text-[12px] !text-[#475569] ![white-space:pre-wrap] ![background:#FAFAF9] !rounded-[8px] !p-[10px_12px] !mb-[10px]">${esc(t)}</div>`; });
    }

    // ── Movimientos (envíos / asignaciones) ──
    html+='<div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !tracking-[.06em] !m-[14px_0_10px]">Movimientos (envíos y asignaciones)</div>';
    if(!d.envios.length){
      html+='<div class="!text-[#94A3B8] !text-center !p-[16px] !text-[13px]">Este equipo aún no ha tenido envíos.</div>';
    }else{
      const etqEstado={aprobado:'Aprobado',en_camino:'En camino',entregado:'Entregado',recibido:'Recibido',cancelado:'Cancelado'};
      html+=d.envios.map(e=>{
        const pasos=[];
        if(e.fecha_aprobado) pasos.push(`📦 <b>Despachado</b> · ${fmtDate(e.fecha_aprobado)}${e.enviado_por?` · por ${nm(e.enviado_por)}`:''}`);
        if(e.fecha_envio)    pasos.push(`🚚 <b>En camino</b> · ${fmtDate(e.fecha_envio)}${e.transportador?` · lo lleva ${nm(e.transportador)}`:''}`);
        if(e.fecha_entrega)  pasos.push(`📍 <b>Entregado</b> · ${fmtDate(e.fecha_entrega)}${e.entregado_a?` · a ${nm(e.entregado_a)}`:''}`);
        if(e.fecha_recibido) pasos.push(`✅ <b>Recibido</b> · ${fmtDate(e.fecha_recibido)}${e.recibido_por?` · por ${nm(e.recibido_por)}`:''}`);
        const badgeEstado={aprobado:'badge-warn',en_camino:'badge-warn',entregado:'badge-ok',recibido:'badge-ok',cancelado:'badge-danger'}[e.estado]||'badge-gray';
        // Notas del envío, ordenadas por tipo
        const extra=[]; let asignadoA='';
        String(e.notas||'').split('\n').map(x=>x.trim()).filter(Boolean).forEach(l=>{
          let m;
          if((m=l.match(/^Asignaci[oó]n directa a\s+(\S+?)(?:\s+[—-]\s+([\s\S]*))?$/))){ asignadoA=m[1]; extra.push(`👤 <span class="!text-[#94A3B8]">Asignado a:</span> ${nm(m[1])}`); if(m[2]) extra.push(`📝 <span class="!text-[#94A3B8]">Motivo:</span> ${esc(m[2])}`); }
          else if((m=l.match(/^Recoge en persona:\s*(\S+)/))){ if(m[1]!==asignadoA) extra.push(`🙋 <span class="!text-[#94A3B8]">Lo recoge:</span> ${nm(m[1])}`); }
          else if((m=l.match(/^\[Recibido\]\s*([\s\S]*)$/))){ if(m[1]) extra.push(`💬 <span class="!text-[#94A3B8]">Nota al recibir:</span> ${esc(m[1])}`); }
          else if(/^---/.test(l)) { /* separador interno */ }
          else extra.push(`📝 ${esc(l)}`);
        });
        return `<div class="![border:1px_solid_#E2E8F0] !rounded-[10px] !p-[12px_14px] !mb-[10px]">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
            <span class="!font-semibold !text-[13px]">${esc(e.origen||'—')} → ${esc(e.destino||'—')}</span>
            <span class="badge ${badgeEstado} !text-[10px]">${esc(etqEstado[e.estado]||e.estado)}</span>
          </div>
          <div class="!text-[12px] !text-[#475569] !leading-[1.7]">${pasos.map(p=>`<div>${p}</div>`).join('')}</div>
          ${extra.length?`<div class="!text-[12px] !text-[#475569] !leading-[1.7] !mt-[6px] !pt-[6px] ![border-top:1px_dashed_#E2E8F0]">${extra.map(x=>`<div>${x}</div>`).join('')}</div>`:''}
        </div>`;
      }).join('');
    }

    body.innerHTML=html;
  }catch(e){ body.innerHTML=`<div class="!text-[#E24B4A] !p-[16px]">${esc(e.message)}</div>`; }
}

let _histFibraData=[];
async function cargarHistFibra(){
  const grid=document.getElementById('meHistFibraGrid');
  if(!grid) return;
  grid.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[32px]">Cargando…</div>';
  try{
    const r=await fetch(`api/fibra.php?action=mi_historial_fibra`,{credentials:'same-origin'});
    const data=await r.json();
    _histFibraData=Array.isArray(data)?data:[];
    filtrarHistFibra();
  }catch(e){
    _histFibraData=[];
    grid.innerHTML=`<div class="!text-[#E24B4A] !p-[16px]">${e.message}</div>`;
  }
}
function filtrarHistFibra(){
  const grid=document.getElementById('meHistFibraGrid');
  if(!grid) return;
  const q=(document.getElementById('filtroHistFibraCat')?.value||'').toLowerCase();
  const desde=document.getElementById('filtroHistFibraDesde')?.value;
  const hasta=document.getElementById('filtroHistFibraHasta')?.value;
  let data=[..._histFibraData];
  if(q) data=data.filter(m=>(m.cat_nombre||'').toLowerCase().includes(q));
  if(desde) data=data.filter(m=>m.fecha&&m.fecha.slice(0,10)>=desde);
  if(hasta) data=data.filter(m=>m.fecha&&m.fecha.slice(0,10)<=hasta);
  if(!data.length){
    grid.innerHTML='<div class="!text-center !p-[32px] !text-[#94A3B8] !text-[13px]">Sin movimientos registrados para esta sede.</div>';
    return;
  }
  grid.innerHTML=`<div class="scroll-area tbl-wrap"><table>
    <thead><tr><th>Tipo</th><th>Categoría</th><th>Metros</th><th>Descripción</th><th>Por</th><th>Fecha</th></tr></thead>
    <tbody>${data.map(m=>{
      const esRecibido=m.tipo==='recibido';
      return `<tr>
        <td><span class="badge ${esRecibido?'badge-ok':'badge-warn'} !text-[10px]">${esRecibido?'📥 Recibido':'📤 Uso'}</span></td>
        <td class="!font-semibold">${esc(m.cat_nombre)}</td>
        <td><span style="font-weight:700;color:${esRecibido?'#2DB82D':'#E24B4A'};">${parseFloat(m.metros)} mts.</span></td>
        <td class="!text-[12px] !text-[#64748B]">${esc(m.descripcion||'—')}</td>
        <td class="!text-[12px] !text-[#94A3B8]">${esc(m.registrado_por||'—')}</td>
        <td class="!text-[11px] !text-[#94A3B8] !whitespace-nowrap">${fmtDate(m.fecha)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}
function limpiarHistFibra(){
  ['filtroHistFibraCat','filtroHistFibraDesde','filtroHistFibraHasta'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  filtrarHistFibra();
}

let _histOntData=[];
async function cargarHistOnt(){
  const grid=document.getElementById('meHistOntGrid');
  if(!grid) return;
  grid.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[32px]">Cargando…</div>';
  try{
    // Cargar todas las ONTs del sistema (igual que el admin)
    const res=await fetch('api/cajas.php?action=listar_ont_en_uso',{credentials:'same-origin'});
    const data=await res.json();
    _histOntData=Array.isArray(data)?data:[];
    filtrarHistOnt();
  }catch(e){grid.innerHTML=`<div class="!text-[#E24B4A] !p-[16px]">${e.message}</div>`;}
}
function filtrarHistOnt(){
  const mac      =(document.getElementById('filtroHistOntMac')?.value||'').toLowerCase().replace(/:/g,'');
  const sn       =(document.getElementById('filtroHistOntSN')?.value||'').toLowerCase();
  const q        =(document.getElementById('filtroHistOntQ')?.value||'').toLowerCase();
  const estado   = document.getElementById('filtroHistOntEstado')?.value||'';
  const sede     =(document.getElementById('filtroHistOntSede')?.value||'').toLowerCase();
  const tecnico  =(document.getElementById('filtroHistOntTecnico')?.value||'').toLowerCase();
  const desde    = document.getElementById('filtroHistOntDesde')?.value||'';
  const hasta    = document.getElementById('filtroHistOntHasta')?.value||'';
  let data=[..._histOntData];
  if(estado)  data=data.filter(o=>o.estado===estado);
  if(mac)     data=data.filter(o=>(o.mac_fmt||o.mac||'').toLowerCase().replace(/:/g,'').includes(mac));
  if(sn)      data=data.filter(o=>(o.sn||'').toLowerCase().includes(sn));
  if(q)       data=data.filter(o=>
    (o.cliente_nombre||'').toLowerCase().includes(q)||
    (o.cliente_direccion||'').toLowerCase().includes(q)
  );
  if(sede)    data=data.filter(o=>(o.sede_actual||'').toLowerCase().includes(sede));
  if(tecnico) data=data.filter(o=>(o.tecnico_instalacion||'').toLowerCase().includes(tecnico));
  if(desde)   data=data.filter(o=>o.fecha_instalacion&&o.fecha_instalacion.slice(0,10)>=desde);
  if(hasta)   data=data.filter(o=>o.fecha_instalacion&&o.fecha_instalacion.slice(0,10)<=hasta);
  const conteo=document.getElementById('filtroHistOntConteo');
  if(conteo) conteo.textContent=data.length!==_histOntData.length?`${data.length} de ${_histOntData.length} registros`:`${data.length} registros`;
  renderHistOntTabla(data);
}
function limpiarHistOnt(){
  ['filtroHistOntMac','filtroHistOntSN','filtroHistOntQ','filtroHistOntEstado','filtroHistOntSede','filtroHistOntTecnico','filtroHistOntDesde','filtroHistOntHasta']
    .forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  filtrarHistOnt();
}
function renderHistOntTabla(data){
  const grid=document.getElementById('meHistOntGrid');
  if(!grid) return;
  if(!data.length){
    grid.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[32px]">Sin ONTs que coincidan con los filtros.</div>';
    return;
  }
  const clsE={disponible:'badge-ok',despachada:'badge-ok',comodato:'badge-purple',ocupado:'badge-warn',dañado:'badge-danger',vendido:'badge-gray'};
  const lblE={disponible:'Disponible para instalar',despachada:'Disponible para instalar',comodato:'Instalada',ocupado:'Ocupada',dañado:'Dañada',vendido:'Vendida',en_venta:'En venta',sin_asignar:'Sin asignar'};
  grid.innerHTML=`<div class="scroll-area tbl-wrap"><table>
    <thead><tr>
      <th>MAC</th><th>SN</th><th>Estado</th><th>Cliente</th><th>Dirección</th><th>Técnico</th><th>Sede</th><th>Fecha inst.</th><th></th>
    </tr></thead>
    <tbody>${data.map(o=>`<tr>
      <td class="![font-family:monospace] !text-[12px] !text-[#0A58B5] !font-bold">${esc(o.mac_fmt||o.mac||'—')}</td>
      <td class="![font-family:monospace] !text-[12px] !font-semibold">${esc(o.sn||'—')}</td>
      <td>${(!o.estado||o.estado==='sin_asignar')?'<span class="!text-[#CBD5E1] !text-[12px]">—</span>':`<span class="badge ${clsE[o.estado]||'badge-gray'} !text-[10px]">${lblE[o.estado]||o.estado}</span>`}</td>
      <td class="!text-[12px]">${esc(o.cliente_nombre||'—')}</td>
      <td class="!text-[11px] !text-[#64748B]">${esc(o.cliente_direccion||'—')}</td>
      <td class="!text-[11px] !text-[#64748B]">${esc(o.tecnico_instalacion||'—')}</td>
      <td class="!text-[11px] !text-[#94A3B8]">${esc(o.sede_actual||'—')}</td>
      <td class="!text-[11px] !text-[#94A3B8] !whitespace-nowrap">${o.fecha_instalacion?fmtDate(o.fecha_instalacion):'—'}</td>
      <td onclick="event.stopPropagation()"><button onclick="editarOntMunicipio(${o.id})" class="btn-sm ![background:#E6F1FB] !text-[#0C6EDE]">✏️</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

/* ── Marcar ONT instalada (técnico) ── */
async function abrirInstalarOnt(id){
  const o = _misOntData.find(x=>String(x.id)===String(id));
  document.getElementById('instalarOntId').value = id;
  document.getElementById('instalarOntCliente').value = '';
  const _lstIC = document.getElementById('instalarOntClienteLista'); if(_lstIC) _lstIC.style.display='none';
  _cargarCatalogoProyectos();
  document.getElementById('instalarOntDireccion').value = '';
  document.getElementById('instalarOntLat').value = '';
  document.getElementById('instalarOntLng').value = '';
  const ubicStatus = document.getElementById('ubicacionInstalarStatus');
  if(ubicStatus){ ubicStatus.textContent='Puedes escribir la dirección, capturar el GPS, o ambos'; ubicStatus.style.color='#94A3B8'; }
  const btnGps = document.getElementById('btnUbicacionInstalar');
  if(btnGps){ btnGps.disabled=false; btnGps.textContent='📍 GPS'; }
  document.getElementById('instalarOntInfo').innerHTML = o
    ? `<b>MAC:</b> ${esc(o.mac||'—')} &nbsp; <b>SN:</b> ${esc(o.sn||'—')}`
    : '';
  // Traer el listado de personas con el endpoint abierto a cualquier sesión
  // (getUsuarios() no sirve aquí, municipio/técnico no tienen permiso para pedirlo)
  try{
    const res = await fetch('api/usuarios.php?action=listar_activos_basico',{credentials:'same-origin'});
    const usuarios = await res.json();
    window._personasParaInstalarOnt = Array.isArray(usuarios) ? usuarios : [];
  }catch(e){ window._personasParaInstalarOnt = []; }
  // Quien instala es FIJO: la persona que tiene la ONT (quien está confirmando
  // ahora). Si un administrador la marca a mano, es quien la tiene asignada.
  const esAdminInst = ['superadmin','distribuidor'].includes(sesion?.rol);
  const fijoUsuario = (esAdminInst && o) ? (o.tecnico_instalador || o.tecnico_asignado || sesion?.usuario) : sesion?.usuario;
  const fijoPersona = window._personasParaInstalarOnt.find(u=>u.usuario===fijoUsuario);
  const fijoNombre = fijoPersona ? (`${fijoPersona.nombre||''} ${fijoPersona.apellido||''}`.trim() || fijoUsuario) : fijoUsuario;
  document.getElementById('instalarOntTecnico').value = fijoUsuario || '';
  const inpTec = document.getElementById('instalarOntTecnicoBuscar');
  inpTec.value = fijoNombre || '';
  inpTec.readOnly = true;
  inpTec.style.background = '#F1F5F9';
  inpTec.style.cursor = 'not-allowed';
  const lstTec = document.getElementById('instalarOntTecnicoLista'); if(lstTec) lstTec.style.display='none';
  document.getElementById('modalInstalarOnt').classList.add('open');
}
function _filtrarInstalarOntTecnico(){
  if(document.getElementById('instalarOntTecnicoBuscar')?.readOnly) return; // quien instala es fijo
  const q = (document.getElementById('instalarOntTecnicoBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('instalarOntTecnicoLista');
  if(!lista) return;
  const personas = (window._personasParaInstalarOnt||[]).filter(u=>{
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
    return `<div onclick="_seleccionarInstalarOntTecnico('${esc(u.usuario)}','${esc(nombreCompleto).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
      <div class="!font-semibold">${hl(nombreCompleto)}</div>
      <div class="!text-[11px] !text-[#94A3B8]">@${hl(u.usuario)}</div>
    </div>`;
  }).join('') : '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>';
  lista.style.display='block';
}
function _seleccionarInstalarOntTecnico(usuario,nombre){
  document.getElementById('instalarOntTecnico').value = usuario;
  document.getElementById('instalarOntTecnicoBuscar').value = nombre;
  document.getElementById('instalarOntTecnicoLista').style.display='none';
}
document.addEventListener('click', function(e){
  const lista=document.getElementById('instalarOntTecnicoLista');
  const inp=document.getElementById('instalarOntTecnicoBuscar');
  if(lista && inp && !inp.contains(e.target) && !lista.contains(e.target)) lista.style.display='none';
});
function _capturarUbicacionInstalar(){
  const status = document.getElementById('ubicacionInstalarStatus');
  const btn = document.getElementById('btnUbicacionInstalar');
  if(!navigator.geolocation){
    if(status){ status.textContent='Tu navegador no soporta ubicación GPS.'; status.style.color='#B91C1C'; }
    return;
  }
  if(btn){ btn.disabled=true; btn.textContent='📍 Buscando…'; }
  if(status){ status.textContent='Obteniendo tu ubicación…'; status.style.color='#0369A1'; }
  navigator.geolocation.getCurrentPosition(
    async (pos)=>{
      const lat = pos.coords.latitude.toFixed(6);
      const lng = pos.coords.longitude.toFixed(6);
      document.getElementById('instalarOntLat').value = lat;
      document.getElementById('instalarOntLng').value = lng;
      if(status){ status.innerHTML = `✓ Ubicación capturada: <a class="!text-[#0369A1] ![text-decoration:underline]" href="https://maps.google.com/?q=${lat},${lng}" target="_blank">${lat}, ${lng}</a> — buscando la dirección…`; status.style.color='#16A871'; }
      if(btn){ btn.disabled=false; btn.textContent='📍 Actualizar'; }
      // Si el campo de dirección está vacío, se rellena solo con lo que
      // encuentre el GPS — así queda un texto legible aunque la persona
      // solo haya usado el botón de ubicación, sin escribir nada.
      const campoDir = document.getElementById('instalarOntDireccion');
      if(campoDir && !campoDir.value.trim()){
        try{
          const dirEncontrada = await _geocodificarInverso(lat, lng);
          if(dirEncontrada){
            campoDir.value = dirEncontrada;
            if(status) status.innerHTML = status.innerHTML.replace('— buscando la dirección…', `— 📍 ${esc(dirEncontrada)}`);
          } else if(status) status.innerHTML = status.innerHTML.replace('— buscando la dirección…', '');
        }catch(e){ if(status) status.innerHTML = status.innerHTML.replace('— buscando la dirección…', ''); }
      } else if(status) status.innerHTML = status.innerHTML.replace('— buscando la dirección…', '');
    },
    (err)=>{
      if(status){ status.textContent = err.code===1 ? 'Permiso de ubicación denegado — puedes seguir sin GPS.' : 'No se pudo obtener la ubicación — puedes seguir sin GPS.'; status.style.color='#B45309'; }
      if(btn){ btn.disabled=false; btn.textContent='📍 GPS'; }
    },
    {enableHighAccuracy:true, timeout:10000}
  );
}
async function _geocodificarInverso(lat, lng){
  try{
    const res = await fetchConTiempo(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`, {
      headers: {'Accept-Language': 'es'}
    }, 5000);
    const data = await res.json();
    return data?.display_name || null;
  }catch(e){ return null; }
}
async function confirmarInstalarOnt(){
  const ont_id = document.getElementById('instalarOntId').value;
  const cliente_nombre = document.getElementById('instalarOntCliente').value.trim();
  const cliente_direccion = document.getElementById('instalarOntDireccion').value.trim();
  const tecnico_instalador = document.getElementById('instalarOntTecnico').value.trim();
  const lat = document.getElementById('instalarOntLat').value.trim();
  const lng = document.getElementById('instalarOntLng').value.trim();
  if(!cliente_nombre){ toast('Elige el Cliente/Proyecto donde quedó instalada — es obligatorio','error'); return; }
  try{
    const res = await fetch('api/cajas.php?action=instalar_ont',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ont_id, cliente_nombre, cliente_direccion, tecnico_instalador, lat: lat||undefined, lng: lng||undefined})
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error al marcar como instalada');
    cerrarModal('modalInstalarOnt');
    toast('✓ ONT marcada como instalada','success');
    cargarMisOnt();
  }catch(e){ toast(e.message,'error'); }
}

/* ── Asignar ONT a un técnico (municipio) ── */
async function cargarOntsParaAsignar(){
  const box = document.getElementById('meOntAsignarLista');
  if(!box) return;
  box.innerHTML = '<div class="!text-[#94A3B8] !text-[12px]">Cargando…</div>';
  try{
    const [resOnts, resTec] = await Promise.all([
      fetch('api/cajas.php?action=onts_en_oficina',{credentials:'same-origin'}),
      fetch('api/usuarios.php?action=listar_tecnicos_sede',{credentials:'same-origin'})
    ]);
    const onts = await resOnts.json();
    const tecnicos = await resTec.json();
    window._tecnicosParaAsignar = Array.isArray(tecnicos) ? tecnicos : [];
    if(!Array.isArray(onts) || !onts.length){
      box.innerHTML = '<div class="!text-[#94A3B8] !text-[12px]">No hay ONTs nuevas esperando asignación.</div>';
      return;
    }
    box.innerHTML = `<table class="!w-[100%] ![border-collapse:collapse] !text-[13px]">
      <thead><tr class="!text-left">
        <th class="p-[6px_10px] !text-[10px] !text-[#7C8DB5] !uppercase">Nº Mac</th>
        <th class="p-[6px_10px] !text-[10px] !text-[#7C8DB5] !uppercase">Nº Serie</th>
        <th class="p-[6px_10px] !text-[10px] !text-[#7C8DB5] !uppercase">Técnico</th>
        <th></th>
      </tr></thead>
      <tbody>
        ${onts.map(o=>`
          <tr class="![background:white]">
            <td class="!p-[8px_10px] ![font-family:monospace] !font-bold !text-[#0A58B5] !rounded-[8px_0_0_8px]">${esc(o.mac||'—')}</td>
            <td class="!p-[8px_10px] ![font-family:monospace] !text-[#64748B]">${esc(o.sn||'—')}</td>
            <td class="!p-[8px_10px] !relative">
              <input id="tecBuscar_${o.id}" class="inp" placeholder="🔍 Buscar técnico…" autocomplete="off" style="font-size:12px;"
                oninput="_filtrarTecnicoAsignar(${o.id})" onfocus="_filtrarTecnicoAsignar(${o.id})">
              <input type="hidden" id="tecSel_${o.id}" value="">
              <div id="tecLista_${o.id}" style="display:none;position:absolute;top:100%;left:0;z-index:30;width:240px;background:white;border:1.5px solid #E2E8F0;border-radius:10px;margin-top:4px;max-height:200px;overflow-y:auto;box-shadow:0 8px 20px rgba(0,0,0,.1);"></div>
            </td>
            <td class="!p-[8px_10px] !rounded-[0_8px_8px_0]"><button onclick="asignarOntATecnico(${o.id})" class="btn-sm ![background:#0C6EDE] ![color:white] !whitespace-nowrap">Asignar</button></td>
          </tr>
          <tr><td class="!h-[6px]" colspan="4"></td></tr>
        `).join('')}
      </tbody>
    </table>`;
  }catch(e){ box.innerHTML = `<div class="!text-[#E24B4A] !text-[12px]">Error: ${e.message}</div>`; }
}

function _filtrarTecnicoAsignar(ontId){
  const q = (document.getElementById(`tecBuscar_${ontId}`)?.value||'').toLowerCase().trim();
  const lista = document.getElementById(`tecLista_${ontId}`);
  if(!lista) return;
  const tecnicos = window._tecnicosParaAsignar || [];
  const hl = (txt) => {
    txt = String(txt||'');
    if(!q || !txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx+q.length))}</mark>`
      + esc(txt.slice(idx+q.length));
  };
  const filtrados = tecnicos.filter(t=>{
    const nombreCompleto = (t.nombre?`${t.nombre} ${t.apellido||''}`.trim():t.usuario);
    return !q || nombreCompleto.toLowerCase().includes(q) || t.usuario.toLowerCase().includes(q);
  });
  lista.innerHTML = filtrados.length
    ? filtrados.map(t=>{
        const nombreCompleto = (t.nombre?`${t.nombre} ${t.apellido||''}`.trim():t.usuario);
        return `<div onclick="_seleccionarTecnicoAsignar(${ontId},'${esc(t.usuario)}','${esc(nombreCompleto).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
          <div class="!font-semibold">${hl(nombreCompleto)}</div>
          <div class="!text-[11px] !text-[#94A3B8]">@${hl(t.usuario)}</div>
        </div>`;
      }).join('')
    : '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>';
  lista.style.display='block';
}
function _seleccionarTecnicoAsignar(ontId, usuario, nombre){
  document.getElementById(`tecSel_${ontId}`).value = usuario;
  document.getElementById(`tecBuscar_${ontId}`).value = nombre;
  document.getElementById(`tecLista_${ontId}`).style.display='none';
}
document.addEventListener('click', function(e){
  document.querySelectorAll('[id^="tecLista_"]').forEach(lista=>{
    const ontId = lista.id.replace('tecLista_','');
    const inp = document.getElementById(`tecBuscar_${ontId}`);
    if(lista && inp && !inp.contains(e.target) && !lista.contains(e.target)) lista.style.display='none';
  });
});

function _avisoCorreoAsignacion(estado, quien){
  if(estado==='sin_correo') toast(`⚠ ${quien} no tiene correo registrado, no se le pudo avisar por correo. Agrégalo en Usuarios.`,'warn');
  else if(estado==='fallo') toast(`⚠ No se pudo enviar el correo a ${quien} (falla del servicio de correo). La asignación sí quedó hecha.`,'warn');
}
async function asignarOntATecnico(ontId){
  const sel = document.getElementById('tecSel_'+ontId);
  const tecnico = sel?.value;
  if(!tecnico){ toast('Elige un técnico','error'); return; }
  try{
    const res = await fetch('api/cajas.php?action=asignar_tecnico_ont',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ont_id:ontId, tecnico})
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error al asignar');
    toast('✓ ONT asignada','success');
    _avisoCorreoAsignacion(d.correo, tecnico);
    cargarOntsParaAsignar();
  }catch(e){ toast(e.message,'error'); }
}

/* ── Importar ONTs desde MikroWisp (Excel) ── */
let _imwRegistros = [];
async function abrirImportarMikrowisp(){
  document.getElementById('imwArchivo').value = '';
  document.getElementById('imwResumen').style.display = 'none';
  document.getElementById('imwBtnConfirmar').disabled = true;
  _imwRegistros = [];
  document.getElementById('modalImportarMikrowisp').classList.add('open');
}

function _leerExcelMikrowisp(input){
  const file = input.files?.[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try{
      const wb = XLSX.read(e.target.result, {type:'array'});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(ws, {header:1, defval:''});
      // La primera fila es el encabezado — se ignora, el orden de columnas es fijo:
      // ID Categoría, Nº serie, Nº Mac, Costo, Estado, ID cliente, Fecha Ingreso, Fecha Salida, ID Proveedor
      const datos = filas.slice(1).filter(f => f.some(v => String(v).trim() !== ''));
      _imwRegistros = datos.map(f => ({
        id_categoria: String(f[0]??'').trim(),
        sn:            String(f[1]??'').trim(),
        mac:           String(f[2]??'').trim(),
        costo:         f[3],
        estado:        String(f[4]??'2').trim(),
        id_cliente:    String(f[5]??'').trim(),
        fecha_ingreso: _formatearFechaExcel(f[6]),
        fecha_salida:  _formatearFechaExcel(f[7]),
        id_proveedor:  String(f[8]??'').trim(),
      }));

      if(!_imwRegistros.length){
        toast('No se encontraron filas con datos en el archivo','error');
        return;
      }

      const estadoLbl = {1:'Dañado',2:'Disponible',3:'Comodato'};
      const cEst = {disp:0,dan:0,com:0};
      _imwRegistros.forEach(r=>{
        if(r.estado==='1') cEst.dan++; else if(r.estado==='3') cEst.com++; else cEst.disp++;
      });
      document.getElementById('imwResumenTexto').textContent =
        `${_imwRegistros.length} ONT(s) encontradas — ${cEst.disp} disponibles, ${cEst.com} en comodato, ${cEst.dan} dañadas.`;

      // Mostrar una fila de mapeo por cada "ID Categoría" distinto encontrado.
      // Las que ya tengan un modelo guardado con ese ID de MikroWisp se reconocen solas.
      const categorias = [...new Set(_imwRegistros.map(r=>r.id_categoria).filter(Boolean))];
      const modelosExistentes = (typeof _modelosOnt !== 'undefined' ? _modelosOnt : []);
      const porIdMkw = {};
      modelosExistentes.forEach(m=>{ if(m.id_mikrowisp) porIdMkw[String(m.id_mikrowisp)] = m.nombre; });

      const reconocidas = categorias.filter(cat=>porIdMkw[cat]);
      const pendientes   = categorias.filter(cat=>!porIdMkw[cat]);

      const mapeoBox = document.getElementById('imwMapeoModelos');
      let html = '';
      if(reconocidas.length){
        html += `<div class="!text-[11px] !text-[#166534] ![background:#EAF3DE] !p-[8px_12px] !rounded-[8px] !mb-[8px]">✓ Reconocidas automáticamente: ${reconocidas.map(c=>`"${esc(porIdMkw[c])}"`).join(', ')}</div>`;
        reconocidas.forEach(cat=>{
          html += `<input type="hidden" id="imwModelo_${esc(cat)}" value="${esc(porIdMkw[cat])}">`;
        });
      }

      if(pendientes.length){
        // No se deja escribir el nombre a mano — la categoría debe existir
        // en "Categorías" antes de importar, con su ID de MikroWisp asignado.
        html += `<div class="!text-[12px] !text-[#B91C1C] ![background:#FEF2F2] ![border:1.5px_solid_#FECACA] !p-[10px_14px] !rounded-[10px]">
          ⛔ Falta crear ${pendientes.length===1?'esta categoría':'estas categorías'} antes de importar:
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
            ${pendientes.map(cat=>`<span class="![background:#FEE2E2] !text-[#991B1B] !p-[2px_9px] !rounded-[99px] !font-bold !text-[12px]">ID ${esc(cat)}</span>`).join('')}
          </div>
          <div class="!mt-[8px]">Ve a <button class="![background:none] ![border:none] !text-[#5B21B6] ![text-decoration:underline] !font-semibold !cursor-pointer !p-[0] !text-[12px]" onclick="cerrarModal('modalImportarMikrowisp');abrirListaModelos();">Categorías → Nuevo modelo</button> y asígnale ese ID en "ID en MikroWisp". Después vuelve a subir el archivo.</div>
        </div>`;
        mapeoBox.innerHTML = html;
        document.getElementById('imwResumen').style.display = 'block';
        document.getElementById('imwBtnConfirmar').disabled = true;
        return;
      }

      mapeoBox.innerHTML = html;

      document.getElementById('imwResumen').style.display = 'block';
      document.getElementById('imwBtnConfirmar').disabled = false;
    }catch(err){
      toast('No se pudo leer el archivo: '+err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function _formatearFechaExcel(v){
  if(v===''||v==null) return '';
  // Puede venir como número de serie de Excel o como texto YYYY-MM-DD.
  if(typeof v === 'number'){
    const d = XLSX.SSF.parse_date_code(v);
    if(!d) return '';
    return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
  }
  return String(v).trim();
}

async function confirmarImportarMikrowisp(){
  if(!_imwRegistros.length){ toast('Primero sube el archivo Excel','error'); return; }

  const categorias = [...new Set(_imwRegistros.map(r=>r.id_categoria).filter(Boolean))];
  const mapaModelos = {};
  for(const cat of categorias){
    const val = document.getElementById('imwModelo_'+cat)?.value.trim();
    if(val) mapaModelos[cat] = val;
  }

  const btn = document.getElementById('imwBtnConfirmar');
  btn.disabled = true; btn.textContent = 'Importando…';
  try{
    const res = await fetch('api/cajas.php?action=importar_ont_mikrowisp',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({registros:_imwRegistros, mapa_modelos:mapaModelos})
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error al importar');
    cerrarModal('modalImportarMikrowisp');
    toast(`✓ Importadas ${d.importados} ONT(s)${d.omitidos?` · ${d.omitidos} omitidas por duplicado`:''}`,'success');

    // Guardar el mapeo nuevo en el modelo (si coincide con uno existente sin ID aún),
    // para que la próxima importación ya lo reconozca solo.
    for(const cat of categorias){
      const nombreMapeado = mapaModelos[cat];
      if(!nombreMapeado) continue;
      const modeloExistente = (_modelosOnt||[]).find(m=>m.nombre===nombreMapeado && !m.id_mikrowisp);
      if(modeloExistente){
        try{
          await fetch('api/modelos_ont.php?action=actualizar',{
            method:'POST', credentials:'same-origin',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({id:modeloExistente.id, nombre:modeloExistente.nombre, marca:modeloExistente.marca||'', descripcion:modeloExistente.descripcion||'', id_mikrowisp:cat})
          });
        }catch(e){/* no crítico */}
      }
    }
    await cargarModelosOnt();

    await Promise.all([_recargarProductos(), renderInventarioOnt()]);
    renderStats();
  }catch(e){
    toast(e.message,'error');
  }finally{
    btn.disabled = false; btn.textContent = 'Importar';
  }
}

/* ── Confirmaciones de cambio de estado de OLT/equipo pendientes de que
   ESTE usuario diga si son ciertas o no (ver cambiar_estado_equipo en
   api/equipos.php) ── */
const _etiquetaEstadoEquipoConf = {
  dañado:'⚠️ Dañado', recuperado:'♻️ Recogido — disponible', de_baja:'🚫 De baja',
  comodato:'🤝 Comodato', instalado:'📍 Instalado',
};
let _confEqPendCache = [];
async function cargarConfirmacionesEquipoPendientes(){
  const cont = document.getElementById('meConfirmacionesPendientes');
  if(!cont) return;
  try{
    const res = await fetch('api/equipos.php?action=mis_confirmaciones_equipo_pendientes', {credentials:'same-origin'});
    const filas = await res.json();
    _confEqPendCache = Array.isArray(filas) ? filas : [];
  }catch(e){ _confEqPendCache = []; }
  renderConfirmacionesEquipoPendientes();
  if(typeof _actualizarBadgeNotifTotal==='function') _actualizarBadgeNotifTotal();
}
function renderConfirmacionesEquipoPendientes(){
  const cont = document.getElementById('meConfirmacionesPendientes');
  if(!cont) return;
  const filas = _confEqPendCache||[];
  if(!filas.length){ cont.style.display='none'; cont.innerHTML=''; return; }
  cont.style.display = 'block';
  cont.innerHTML = `
    <div class="![background:#FFF7ED] ![border:1px_solid_#FDBA74] !rounded-[12px] !p-[14px_16px]">
      <div class="!font-bold !text-[#9A3412] !text-[13px] !mb-[10px]">🔔 ${filas.length} cambio${filas.length!==1?'s':''} esperando tu confirmación</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${filas.map(f=>`
          <div style="background:white;border-radius:10px;padding:10px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div class="![flex:1] !min-w-[180px]">
              <div class="!text-[13px] !font-semibold">${esc(f.equipo_nombre||(f.tipo==='olt'?'OLT':'Equipo'))}</div>
              <div class="!text-[12px] !text-[#64748B]">${f.tipo==='olt'?'OLT':'Equipo'} → ${_etiquetaEstadoEquipoConf[f.estado_propuesto]||esc(f.estado_propuesto)}${f.cliente_nombre?` — "${esc(f.cliente_nombre)}"`:''}</div>
              <div class="!text-[11px] !text-[#94A3B8]">Lo registró: ${esc(f.propuesto_por)}${f.nota?` · ${esc(f.nota)}`:''}</div>
            </div>
            <div class="!flex !gap-[6px]">
              <button onclick="responderConfirmacionEquipo(${parseInt(f.id)},'si')" class="btn-sm ![background:#EAF3DE] !text-[#166534] !font-bold">✓ Sí, es cierto</button>
              <button onclick="responderConfirmacionEquipo(${parseInt(f.id)},'no')" class="btn-sm ![background:#FCEBEB] !text-[#B91C1C] !font-bold">✕ No</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
}
async function responderConfirmacionEquipo(id, respuesta){
  if(respuesta==='no' && !confirm('¿Confirmas que esto NO pasó? El cambio quedará descartado.')) return;
  try{
    const res = await fetch('api/equipos.php?action=responder_confirmacion_equipo',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({id, respuesta})
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error');
    toast(respuesta==='si' ? 'Confirmado ✓ — el estado quedó actualizado' : 'Descartado — no se aplicó ningún cambio','success');
    await cargarConfirmacionesEquipoPendientes();
    cargarMisOlt(); cargarMisMikrotik();
  }catch(e){ toast(e.message,'error'); }
}

function iniciarMisEquipos(){
  try{ actualizarBadgeMisSst(); }catch(e){}
  if(!(_modelosOnt&&_modelosOnt.length)) cargarModelosOnt().catch(()=>{});
  cargarConfirmacionesEquipoPendientes();
  // Título dinámico según rol
  const tit = document.getElementById('misequiposTitulo');
  const sub = document.getElementById('misequiposSubtitulo');
  const _r  = sesion?.rol;
  if(tit) tit.textContent = _r==='persona' ? 'Equipos de mi sede' : _r==='tecnico' ? 'Equipos a mi cargo' : 'Mis equipos';
  if(sub){
    const _s = (sesion?.sedes||[sesion?.sede]).join(', ');
    sub.textContent = `ONTs y fibra asignados a ${_s}`;
  }
  // Solo la oficina (municipio) puede pedir ONT — técnico/persona no.
  const btnPedirOnts = document.getElementById('btnPedirOnts');
  if(btnPedirOnts) btnPedirOnts.style.display = (_r==='municipio') ? 'inline-flex' : 'none';
  // Solo municipio registra las ONT que sus técnicos recogen en campo —
  // el técnico las trae físicamente, pero es la oficina quien la sube
  // al sistema.
  // Botón "Nuevo ONT": cualquier municipio/técnico/persona puede ir registrando ONT en el sistema
  // (solo con modelos ya creados); lo demás de ONT sigue siendo solo lo suyo.
  const btnNuevoOntME = document.getElementById('btnNuevoOntMisEquipos');
  if(btnNuevoOntME) btnNuevoOntME.style.display = ['municipio','tecnico','persona'].includes(_r) ? 'inline-flex' : 'none';
  const btnRegOntRec = document.getElementById('btnRegistrarOntRecogida');
  if(btnRegOntRec) btnRegOntRec.style.display = (_r==='municipio') ? 'inline-flex' : 'none';
  // El técnico ve el filtro "Asignadas a mí"; el municipio ve la pestaña "Por asignar".
  const btnAsig = document.getElementById('meOntFiltroAsignadas');
  if(btnAsig) btnAsig.style.display = (_r==='tecnico') ? 'inline-flex' : 'none';
  // "Instalé estas" — cualquiera puede haber instalado una directamente
  // (no solo técnico), así que se muestra siempre.
  const btnInstale = document.getElementById('meOntFiltroInstale');
  if(btnInstale) btnInstale.style.display = (_r==='municipio') ? 'none' : 'inline-flex'; // municipio no instala/gasta
  // "Ya asignadas a un técnico" — solo tiene sentido para el municipio,
  // que es quien reparte ONT entre sus técnicos (un técnico nunca le
  // asigna una ONT a otro técnico), así que solo él la ve.
  const btnYaNoMia = document.getElementById('meOntFiltroYaNoMia');
  if(btnYaNoMia) btnYaNoMia.style.display = (_r==='municipio') ? 'inline-flex' : 'none';
  document.querySelectorAll('.fib-tab-me').forEach(b=>{
    b.addEventListener('click',()=>setTabMisEquipos(b.dataset.tab));
  });
  document.querySelectorAll('.me-ont-filter').forEach(b=>{
    b.addEventListener('click',()=>{
      _meOntEstado=b.dataset.estado;
      document.querySelectorAll('.me-ont-filter').forEach(x=>x.classList.toggle('active',x===b));
      cargarMisOnt();
    });
  });
  cargarMisOnt();
}

let _misOntData=[];

/* ══ Menú "⋯" de acciones de equipos (ocupa poco espacio, sirve en celular) ══
   _accionesMenu(clave, htmlBotones): toma los <button class="btn-sm"> de siempre
   y los convierte en las opciones de un menú flotante único. */
const _mnuEqItems = {};
function _accionesMenu(key, html){
  const items=[]; const re=/<button\b([^>]*)>([\s\S]*?)<\/button>/g; let m;
  while((m=re.exec(String(html||'')))){
    const at=m[1];
    const on=(/onclick="([^"]*)"/.exec(at)||[])[1]; if(!on) continue;
    const tit=(/title="([^"]*)"/.exec(at)||[])[1]||'';
    const col=(/(?:^|[;"\s])color:\s*(#[0-9a-fA-F]{3,6})/.exec((/style="([^"]*)"/.exec(at)||[])[1]||'')||[])[1]||'#0F172A';
    let txt=m[2].replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();
    if(tit && !/[A-Za-zÁ-ú]{3,}/.test(txt)) txt = txt+' '+tit;
    items.push({on,txt,col, peligro:/eliminar/i.test(txt)});
  }
  if(!items.length) return '<span class="!text-[#CBD5E1]">—</span>';
  items.sort((a,b)=>(a.peligro?1:0)-(b.peligro?1:0));
  _mnuEqItems[key]=items;
  return `<button type="button" class="mnu-eq-btn" onclick="_toggleMnuEq('${key}',event)" title="Acciones" aria-label="Acciones">⋯</button>`;
}
function _cerrarMnuEq(){ const m=document.getElementById('mnuEqFlotante'); if(m) m.style.display='none'; }
function _toggleMnuEq(key, ev){
  ev.stopPropagation();
  let m=document.getElementById('mnuEqFlotante');
  if(!m){ m=document.createElement('div'); m.id='mnuEqFlotante'; m.className='mnu-eq-flotante'; document.body.appendChild(m); }
  const btn=ev.target.closest('button'); if(!btn) return;
  if(m.style.display==='block' && m.dataset.key===key){ m.style.display='none'; return; }
  const items=_mnuEqItems[key]||[];
  m.dataset.key=key;
  m.innerHTML=items.map((it,i)=>`${it.peligro&&i>0?'<div class="!h-[1px] ![background:#F1F5F9] !m-[4px_0]"></div>':''}<button type="button" class="menu-ont-item" style="color:${it.col};" onclick="_cerrarMnuEq();${it.on}">${it.txt}</button>`).join('');
  m.style.display='block'; m.style.visibility='hidden';
  const r=btn.getBoundingClientRect(), h=m.offsetHeight, w=m.offsetWidth;
  const abajo=window.innerHeight-r.bottom, arriba=r.top;
  let top = (abajo>=h+8 || abajo>=arriba) ? r.bottom+4 : r.top-h-4;
  top=Math.max(8,Math.min(top,window.innerHeight-h-8));
  m.style.top=top+'px'; m.style.left=Math.max(8,Math.min(r.right-w,window.innerWidth-w-8))+'px'; m.style.visibility='visible';
}
document.addEventListener('click',function(e){ if(!e.target.closest('#mnuEqFlotante')) _cerrarMnuEq(); });
window.addEventListener('scroll',_cerrarMnuEq,true); window.addEventListener('resize',_cerrarMnuEq);

/* ══ Eliminar equipo (ONT / OLT / Mikrotik): revisa si se puede, pide contraseña ══ */
async function _eliminarEquipo(tipo, id, nombre){
  const etq = tipo==='ont'?'ONT':(tipo==='olt'?'OLT':'equipo'); const art = tipo==='mikrotik'?'el':'la';
  const urlChk = tipo==='ont' ? `api/cajas.php?action=puede_eliminar_ont&id=${id}` : `api/equipos.php?action=puede_eliminar_equipo&tipo=${tipo}&id=${id}`;
  const urlDel = tipo==='ont' ? 'api/cajas.php?action=eliminar_ont' : (tipo==='olt' ? 'api/equipos.php?action=eliminar_olt' : 'api/equipos.php?action=eliminar_mikrotik');
  try{
    const r0 = await fetch(urlChk,{credentials:'same-origin'}); const d0 = await r0.json().catch(()=>({}));
    if(d0 && d0.ok===false && d0.motivo){
      mostrarConfirmar({ icono:'🚫', color:'#D97706', titulo:`No se puede eliminar ${art} ${etq}`,
        desc:`${nombre}: ${d0.motivo}`, btnTxt:'Entendido', btnColor:'#D97706', onConfirmar:()=>{} });
      return;
    }
  }catch(e){ /* si falla la consulta, el servidor vuelve a validar */ }
  mostrarConfirmar({
    icono:'🗑️', color:'#E24B4A', titulo:`Eliminar ${etq}`,
    desc:`¿Estás seguro de eliminar ${art} ${etq} ${nombre}? Esta acción no se puede deshacer. Escribe tu contraseña para confirmar.`,
    btnTxt:'Sí, eliminar', btnColor:'#B91C1C', requirePassword:true,
    onConfirmar: async()=>{
      const pi=document.getElementById('modalConfirmarPass'); const pw=(pi&&pi.value)||''; if(pi) pi.value='';
      try{
        const res = await fetch(urlDel,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:Number(id),password:pw})});
        const d = await res.json().catch(()=>({}));
        if(!res.ok || d.error){
          if(d.bloqueado){ mostrarConfirmar({ icono:'🚫', color:'#D97706', titulo:'No se puede eliminar', desc:d.error, btnTxt:'Entendido', btnColor:'#D97706', onConfirmar:()=>{} }); }
          else toast(d.error||'No se pudo eliminar','error');
          return;
        }
        toast(`${etq} eliminad${art==='la'?'a':'o'} ✓`,'success');
        if(tipo==='ont'){
          if(document.getElementById('ontInventarioGrid')) renderInventarioOnt();
          if(typeof cargarTablaOntEnUso==='function' && document.getElementById('tablaOntEnUso')) cargarTablaOntEnUso();
          if(typeof renderStats==='function') renderStats();
        } else if(tipo==='olt'){ if(typeof cargarOlts==='function') cargarOlts(); if(typeof cargarMisOlt==='function') try{cargarMisOlt();}catch(e){} }
        else { if(typeof cargarMikrotiks==='function') cargarMikrotiks(); }
      }catch(e){ toast(e.message||'Error','error'); }
    }
  });
}
async function _toggleMenuOntFila(id, ev){
  ev.stopPropagation();
  const menu = document.getElementById(`menuOntFila_${id}`);
  if(!menu) return;
  const yaAbierto = menu.style.display==='block';
  // Cerrar cualquier otro menú abierto antes de abrir este
  document.querySelectorAll('[id^="menuOntFila_"]').forEach(m=>m.style.display='none');
  if(yaAbierto) return;
  // Se posiciona con "fixed" calculado en JS, para que el scroll horizontal
  // de la tabla no lo corte (con "absolute" dentro de un contenedor con
  // overflow, el menú podía quedar invisible al desplazarse la tabla).
  const btn = ev.target.closest('button');
  const rect = btn.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  menu.style.display = 'block';
}
function _cerrarMenuOntFila(id){
  const menu = document.getElementById(`menuOntFila_${id}`);
  if(menu) menu.style.display='none';
}
document.addEventListener('click', function(e){
  if(!e.target.closest('[id^="menuOntFila_"]') && !e.target.closest('[onclick*="_toggleMenuOntFila"]')){
    document.querySelectorAll('[id^="menuOntFila_"]').forEach(m=>m.style.display='none');
  }
});
async function editarOntMunicipio(id){
  const o=_misOntData.find(x=>String(x.id)===String(id))||_histOntData.find(x=>String(x.id)===String(id));
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
  window._editOntCallback = () => { cargarMisOnt(); };
  document.getElementById('modalEditarOnt').classList.add('open');
}
let _asignarOntIdActual = null;
async function _abrirAsignarOntTecnico(id, etiqueta){
  if(sesion?.rol==='distribuidor'){ toast('El distribuidor no asigna: solo entrega (usa Envío directo / Enviar a una oficina).','warn'); return; }
  _asignarOntIdActual = id;
  document.getElementById('asignarOntResumen').innerHTML = `<strong>${esc(etiqueta)}</strong>`;
  document.getElementById('asignarOntDestinoBuscar').value = '';
  document.getElementById('asignarOntDestinoVal').value = '';
  const al = document.getElementById('asignarOntAlerta'); if(al){al.style.display='none';al.textContent='';}
  document.getElementById('modalAsignarOntTecnico')?.classList.add('open');
  // Traer los técnicos con el mismo endpoint que ya usa "huérfanas" (abierto
  // a cualquier sesión) — getUsuarios() no sirve aquí, municipio no tiene
  // permiso para pedir el listado completo de usuarios.
  try{
    const res = await fetch('api/usuarios.php?action=listar_activos_basico',{credentials:'same-origin'});
    const usuarios = await res.json();
    window._tecnicosParaAsignarOnt = Array.isArray(usuarios) ? usuarios.filter(u=>u.usuario!==sesion?.usuario && !['superadmin','distribuidor'].includes(u.rol)) : [];
  }catch(e){ window._tecnicosParaAsignarOnt = []; }
}
function _filtrarAsignarOntDestino(){
  const q = (document.getElementById('asignarOntDestinoBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('asignarOntDestinoLista');
  if(!lista) return;
  const personas = (window._tecnicosParaAsignarOnt||[]).filter(u=>{
    const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
    return !q || nombreCompleto.toLowerCase().includes(q) || u.usuario.toLowerCase().includes(q);
  });  const hl = (txt) => {
    txt = String(txt||'');
    if(!q||!txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))+`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`+esc(txt.slice(idx+q.length));
  };
  lista.innerHTML = personas.length ? personas.slice(0,30).map(u=>{
    const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
    return `<div onclick="_seleccionarAsignarOntDestino('${esc(u.usuario)}','${esc(nombreCompleto).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
      <div class="!font-semibold">${hl(nombreCompleto)}</div>
      <div class="!text-[11px] !text-[#94A3B8]">@${hl(u.usuario)} · ${esc(u.rol||'')}</div>
    </div>`;
  }).join('') : '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>';
  lista.style.display='block';
}
function _seleccionarAsignarOntDestino(usuario,nombre){
  document.getElementById('asignarOntDestinoVal').value = usuario;
  document.getElementById('asignarOntDestinoBuscar').value = nombre;
  document.getElementById('asignarOntDestinoLista').style.display='none';
}
document.addEventListener('click', function(e){
  const lista=document.getElementById('asignarOntDestinoLista');
  const inp=document.getElementById('asignarOntDestinoBuscar');
  if(lista && inp && !inp.contains(e.target) && !lista.contains(e.target)) lista.style.display='none';
});
async function _ejecutarAsignarOntTecnico(){
  const nuevo_usuario = document.getElementById('asignarOntDestinoVal').value;
  const alerta = document.getElementById('asignarOntAlerta');
  alerta.style.display='none';
  if(!nuevo_usuario){ alerta.textContent='Elige un técnico de la lista.'; alerta.className='alerta error'; alerta.style.display='block'; return; }
  try{
    const res = await _api('cajas','reasignar_ont',{ont_id:_asignarOntIdActual, nuevo_usuario});
    if(res.error){ alerta.textContent=res.error; alerta.className='alerta error'; alerta.style.display='block'; return; }
    cerrarModal('modalAsignarOntTecnico');
    toast('ONT asignada correctamente ✓','success');
    cargarMisOnt();
  }catch(e){ alerta.textContent='Error al asignar.'; alerta.className='alerta error'; alerta.style.display='block'; }
}

let _devolverOntIdActual = null;
function _abrirRegistrarOntRecogida(){
  document.getElementById('rorModelo').value = '';
  document.getElementById('rorSerial').value = '';
  document.getElementById('rorMac').value = '';
  document.getElementById('rorNota').value = '';
  document.getElementById('rorAlerta').className = 'alerta';
  document.querySelector('input[name="rorEstado"][value="reutilizable"]').checked = true;
  _toggleRorEstado();
  document.getElementById('modalRegistrarOntRecogida').classList.add('open');
}
function _toggleRorEstado(){
  const esDanada = document.querySelector('input[name="rorEstado"]:checked')?.value === 'dañado';
  document.getElementById('rorLblReutilizable').style.borderColor = esDanada ? '#E2E8F0' : '#16A850';
  document.getElementById('rorLblDanada').style.borderColor = esDanada ? '#B91C1C' : '#E2E8F0';
}
async function _confirmarRegistrarOntRecogida(){
  const modelo = document.getElementById('rorModelo').value.trim();
  const serial = document.getElementById('rorSerial').value.trim();
  const mac = document.getElementById('rorMac').value.trim();
  const nota = document.getElementById('rorNota').value.trim();
  const estado = document.querySelector('input[name="rorEstado"]:checked')?.value;
  const alerta = document.getElementById('rorAlerta');
  if(!modelo){ alerta.textContent='Escribe el modelo.'; alerta.className='alerta error'; return; }
  if(!serial && !mac){ alerta.textContent='Escribe al menos el serial o la MAC.'; alerta.className='alerta error'; return; }
  try{
    const res = await _api('cajas','registrar_ont_recogida',{modelo, serial, mac, estado, nota});
    if(res.error){ alerta.textContent=res.error; alerta.className='alerta error'; return; }
    toast('ONT registrada ✓ — ya aparece en Mis equipos para devolverla.','success');
    cerrarModal('modalRegistrarOntRecogida');
    cargarMisOnt();
  }catch(e){ alerta.textContent='Error al registrar.'; alerta.className='alerta error'; }
}
function _devolverOntAlmacen(id, etiqueta){
  document.getElementById('tdDevTipo').value = 'ont';
  document.getElementById('tdDevId').value = id;
  document.getElementById('tdDevCantidadWrap').style.display = 'none';
  const destinoTxt = (sesion.rol==='tecnico'||sesion.rol==='persona') ? `tu municipio (${sesion.sede})` : 'el almacén';
  document.getElementById('tdDevSubtitulo').textContent = `${etiqueta} — queda en camino hasta que la confirmen recibida en ${destinoTxt}.`;
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
function _abrirDevolverOnt(id, etiqueta, estadoActual, clienteActual){
  _devolverOntIdActual = id;
  const avisoInstalada = estadoActual==='comodato'
    ? `<div class="!mt-[6px] !text-[#B91C1C] !font-semibold">⚠️ Está instalada en "${esc(clienteActual||'un cliente')}" — al devolverla, queda desinstalada.</div>`
    : '';
  document.getElementById('devolverOntResumen').innerHTML = `<strong>${esc(etiqueta)}</strong>${avisoInstalada}`;
  document.getElementById('devolverOntMotivo').value = '';
  document.querySelectorAll('input[name="devolverOntTipo"]').forEach(r=>r.checked = r.value==='reutilizable');
  const al = document.getElementById('devolverOntAlerta'); if(al){al.style.display='none';al.textContent='';}
  document.getElementById('modalDevolverOnt')?.classList.add('open');
}
async function _ejecutarDevolverOnt(){
  const tipo = document.querySelector('input[name="devolverOntTipo"]:checked')?.value || 'reutilizable';
  const motivo = document.getElementById('devolverOntMotivo').value.trim();
  const alerta = document.getElementById('devolverOntAlerta');
  alerta.style.display='none';
  try{
    const res = await _api('cajas','devolver_ont',{ont_id:_devolverOntIdActual, tipo, motivo});
    if(res.error){ alerta.textContent=res.error; alerta.className='alerta error'; alerta.style.display='block'; return; }
    cerrarModal('modalDevolverOnt');
    toast('✓ Registrado — sigue en tu oficina','success');
    cargarMisOnt();
  }catch(e){ alerta.textContent='Error al devolver.'; alerta.className='alerta error'; alerta.style.display='block'; }
}

async function cargarMisAsignacionesPendientes(){
  const box = document.getElementById('meOntPendAsignacionBox');
  const lista = document.getElementById('meOntPendAsignacionLista');
  if(!box || !lista) return;
  try{
    const res = await fetch('api/cajas.php?action=mis_asignaciones_pendientes',{credentials:'same-origin'});
    const data = await res.json();
    const pendientes = Array.isArray(data) ? data : [];
    if(!pendientes.length){ box.style.display='none'; return; }
    box.style.display='block';
    lista.innerHTML = pendientes.map(o=>`
      <div style="background:white;border-radius:10px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div class="!text-[12.5px]">
          <strong>${esc(o.modelo||'ONT')}</strong> — SN ${esc(o.sn||'—')}<br>
          <span class="!text-[#0369A1]">Oficina: ${esc(o.tecnico_asignado||'—')}</span>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button onclick="_confirmarAceptarOnt(${o.id},'${esc(o.modelo||'ONT')} — SN ${esc(o.sn||'—')}')" class="btn-sm ![background:#16A871] ![color:white]">✓ Aceptar</button>
          <button onclick="_reportarOntDanadaAsignacion(${o.id})" class="btn-sm ![background:#FEF3C7] !text-[#92400E]">🛠 Llegó dañada</button>
          <button onclick="_responderAsignacionPendiente(${o.id},'rechazada')" class="btn-sm ![background:#FEF2F2] !text-[#B91C1C]">✗ No puedo</button>
        </div>
      </div>
    `).join('');
  }catch(e){ box.style.display='none'; }
}
function _reportarOntDanadaAsignacion(ontId){
  mostrarConfirmar({
    icono:'🛠', color:'#B45309',
    titulo:'Reportar ONT dañada',
    desc:'¿Qué tiene? Descríbelo para que quede registrado.',
    btnTxt:'Reportar dañada', btnColor:'#B45309',
    withNotes:true,
    notesLabel:'¿Qué le pasa?',
    notesPlaceholder:'Ej: llegó con el puerto óptico roto…',
    notesRequired:true,
    onConfirmar: async(motivo)=>{
      try{
        const res = await fetch('api/cajas.php?action=editar_ont_en_uso',{
          method:'POST', credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({id:ontId, estado:'dañado', motivo_dano:motivo||''})
        });
        const data = await res.json();
        if(!res.ok||data.error){ toast(data.error||'Error al reportar','error'); return; }
        toast('🛠 Reportada como dañada','warn');
        cargarMisAsignacionesPendientes();
        cargarMisOnt();
      }catch(e){ toast('Error al reportar','error'); }
    }
  });
}
function _rechazarAsignacionPendiente(ontId){
  mostrarConfirmar({
    icono:'✗', color:'#B91C1C',
    titulo:'Rechazar asignación',
    desc:'¿Por qué no puedes instalar esta ONT? (opcional)',
    btnTxt:'Rechazar', btnColor:'#B91C1C',
    withNotes:true,
    notesLabel:'Motivo (opcional)',
    notesPlaceholder:'Ej: no tengo tiempo esta semana…',
    onConfirmar: async(motivo)=>{
      try{
        const res = await _api('cajas','responder_asignacion_ont',{ont_id:ontId, respuesta:'rechazada', motivo: motivo||''});
        if(res.error){ toast(res.error,'error'); return; }
        toast('✗ Rechazada — quedó visible para la oficina','warn');
        cargarMisAsignacionesPendientes();
        cargarMisOnt();
      }catch(e){ toast('Error al responder','error'); }
    }
  });
}
function _confirmarAceptarOnt(ontId, etiqueta){
  mostrarConfirmar({
    icono:'✓', color:'#16A871',
    titulo:'Aceptar ONT asignada',
    desc:`¿Confirmas que aceptas "${etiqueta}"?`,
    btnTxt:'Sí, aceptar',
    btnColor:'#16A871',
    avisoResponsabilidad:true,
    onConfirmar: ()=> _responderAsignacionPendiente(ontId,'aceptada')
  });
}
async function _responderAsignacionPendiente(ontId, respuesta){
  if(respuesta==='rechazada'){ _rechazarAsignacionPendiente(ontId); return; }
  try{
    const res = await _api('cajas','responder_asignacion_ont',{ont_id:ontId, respuesta});
    if(res.error){ toast(res.error,'error'); return; }
    toast('✓ Asignación aceptada — ya puedes instalarla','success');
    cargarMisAsignacionesPendientes();
    cargarMisOnt();
  }catch(e){ toast('Error al responder','error'); }
}
async function cargarMisInstalacionesPendientes(){
  const box = document.getElementById('meOntPendConfirmarBox');
  const lista = document.getElementById('meOntPendConfirmarLista');
  if(!box || !lista) return;
  try{
    const res = await fetch('api/cajas.php?action=mis_instalaciones_pendientes',{credentials:'same-origin'});
    const data = await res.json();
    const pendientes = Array.isArray(data) ? data : [];
    if(!pendientes.length){ box.style.display='none'; return; }
    box.style.display='block';
    lista.innerHTML = pendientes.map(o=>`
      <div style="background:white;border-radius:10px;padding:10px 12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <div class="!text-[12.5px]">
          <strong>${esc(o.modelo||'ONT')}</strong> — SN ${esc(o.sn||'—')}<br>
          <span class="!text-[#92400E]">Instalada en "${esc(o.cliente_nombre||'—')}" · Oficina: ${esc(o.tecnico_asignado||'—')} · Registrado por ${esc(o.registrado_por||'—')}</span>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;">
          <button onclick="_responderInstalacionPendiente(${o.id},'confirmada')" class="btn-sm ![background:#16A871] ![color:white]">✓ Sí, fui yo</button>
          <button onclick="_responderInstalacionPendiente(${o.id},'disputada')" class="btn-sm ![background:#FEF2F2] !text-[#B91C1C]">✗ No fui yo</button>
        </div>
      </div>
    `).join('');
  }catch(e){ box.style.display='none'; }
}
async function _responderInstalacionPendiente(ontId, respuesta){
  if(respuesta==='disputada'){
    mostrarConfirmar({
      icono:'✗', color:'#B91C1C',
      titulo:'No fui yo quien instaló',
      desc:'¿Por qué crees que te pusieron a ti? Ayuda a que el admin lo revise mejor.',
      btnTxt:'Enviar', btnColor:'#B91C1C',
      withNotes:true,
      notesLabel:'Motivo (opcional)',
      notesPlaceholder:'Ej: nunca estuve en esa dirección…',
      onConfirmar: async(motivo)=>{
        try{
          const res = await _api('cajas','confirmar_instalacion',{ont_id:ontId, respuesta, motivo: motivo||''});
          if(res.error){ toast(res.error,'error'); return; }
          toast('✗ Marcado como disputado, el admin lo va a revisar','warn');
          cargarMisInstalacionesPendientes();
          cargarMisOnt();
        }catch(e){ toast('Error al responder','error'); }
      }
    });
    return;
  }
  try{
    const res = await _api('cajas','confirmar_instalacion',{ont_id:ontId, respuesta});
    if(res.error){ toast(res.error,'error'); return; }
    toast('✓ Confirmado','success');
    cargarMisInstalacionesPendientes();
    cargarMisOnt();
  }catch(e){ toast('Error al responder','error'); }
}
function _actualizarContadoresOnt(data){
  const equivalentes = {
    despachada: ['despachada','disponible'],
    dañado: ['dañado','no_disponible'],
  };
  const cuentas = {
    todos: data.length,
    asignado_mio: data.filter(o=>o.tecnico_instalador===sesion.usuario && o.estado!=='comodato' && o.asignacion_confirmada!=='rechazada').length,
    instale_yo: data.filter(o=>o.tecnico_instalacion===sesion.usuario).length,
    despachada: data.filter(o=>equivalentes.despachada.includes(o.estado)).length,
    comodato: data.filter(o=>o.estado==='comodato').length,
    dañado: data.filter(o=>equivalentes.dañado.includes(o.estado)).length,
    ya_no_mia: data.filter(o=>o.es_dueño!=1 && o.es_instalador!=1 && o.yo_la_instale!=1).length,
  };
  document.querySelectorAll('.me-ont-cont').forEach(el=>{
    const clave = el.dataset.cont;
    const n = cuentas[clave] ?? 0;
    el.textContent = `(${n})`;
  });
}
function _limpiarFiltrosMeOnt(){
  const b=document.getElementById('meOntBuscar'); if(b) b.value='';
  const d=document.getElementById('meOntFiltroDesde'); if(d) d.value='';
  const h=document.getElementById('meOntFiltroHasta'); if(h) h.value='';
  cargarMisOnt();
}
async function cargarMisOnt(){
  const grid=document.getElementById('meOntGrid');
  if(!grid) return;

  cargarMisInstalacionesPendientes();
  cargarMisAsignacionesPendientes();

  grid.innerHTML='<div class="!text-[#94A3B8] !text-[13px] !text-center !p-[24px]">Cargando ONTs…</div>';
  try{
    // Ya no importa la sede — cada persona solo ve las ONTs que son suyas,
    // sin importar en qué sede esté asignada.
    const res = await fetch('api/cajas.php?action=mis_onts_asignadas',{credentials:'same-origin'});
    let todasOnt = await res.json();
    if(!Array.isArray(todasOnt)) todasOnt=[];
    _misOntData=todasOnt;
    _actualizarContadoresOnt(todasOnt);

    // Filtrar por estado — algunos estados tienen dos nombres equivalentes
    // según de dónde se guardaron (ej: "despachada" = "disponible" para instalar,
    // "dañado" = "no_disponible"), así que se buscan los dos.
    const equivalentes = {
      despachada: ['despachada','disponible'],
      disponible: ['despachada','disponible'],
      dañado: ['dañado','no_disponible'],
      no_disponible: ['dañado','no_disponible'],
    };
    if(_meOntEstado==='asignado_mio'){
      todasOnt=todasOnt.filter(o=>o.tecnico_instalador===sesion.usuario && o.estado!=='comodato' && o.asignacion_confirmada!=='rechazada');
    } else if(_meOntEstado==='instale_yo'){
      todasOnt=todasOnt.filter(o=>o.tecnico_instalacion===sesion.usuario);
    } else if(_meOntEstado==='ya_no_mia'){
      // ONTs que ya no son mías (ni dueño, ni instalador, ni quien la
      // instaló) pero que en algún momento pasaron por mis manos — ej:
      // las asigné a un técnico y él ya las recibió/instaló. Aparecen
      // aquí solo para poder consultar qué pasó, no para gestionarlas.
      todasOnt=todasOnt.filter(o=>o.es_dueño!=1 && o.es_instalador!=1 && o.yo_la_instale!=1);
    } else if(_meOntEstado!=='todos'){
      const validos = equivalentes[_meOntEstado] || [_meOntEstado];
      todasOnt=todasOnt.filter(o=>validos.includes(o.estado));
    }

    // Buscador de texto (SN, MAC, cliente)
    const q = (document.getElementById('meOntBuscar')?.value||'').toLowerCase().trim();
    if(q){
      todasOnt = todasOnt.filter(o=>
        (o.sn||'').toLowerCase().includes(q) ||
        (o.mac||'').toLowerCase().includes(q) ||
        (o.mac_fmt||'').toLowerCase().includes(q) ||
        (o.cliente_nombre||'').toLowerCase().includes(q)
      );
    }
    // Filtro de fechas (usa la fecha de instalación si existe, si no la de envío)
    const desdeF = document.getElementById('meOntFiltroDesde')?.value || '';
    const hastaF = document.getElementById('meOntFiltroHasta')?.value || '';
    if(desdeF || hastaF){
      todasOnt = todasOnt.filter(o=>{
        const f = (o.fecha_instalacion||o.fecha_envio||o.fecha||'').split('T')[0];
        if(!f) return false;
        if(desdeF && f < desdeF) return false;
        if(hastaF && f > hastaF) return false;
        return true;
      });
    }

    const contadorEl = document.getElementById('meOntTotalContador');

    if(!todasOnt.length){
      if(contadorEl) contadorEl.textContent = 'Total: 0';
      grid.innerHTML=`<div class="!text-center !p-[32px] !text-[#94A3B8] !text-[13px]">
        No tienes ONTs ${_meOntEstado!=='todos'?'con estado "'+_meOntEstado+'"':''} asignadas a tu sede.
      </div>`;
      return;
    }
    if(contadorEl) contadorEl.textContent = `Total: ${todasOnt.length}`;

    const clsE={disponible:'badge-ok',despachada:'badge-ok',asignado:'badge-brand',comodato:'badge-purple',ocupado:'badge-warn',dañado:'badge-danger',no_disponible:'badge-danger',en_transito_almacen:'badge-brand'};
    const lblE={
      disponible:'✅ Disponible para instalar',
      despachada:'✅ Disponible para instalar',
      asignado:'🎯 Asignada',
      comodato:'📋 Comodato',
      ocupado:'📦 Ocupada',
      dañado:'⛔ No disponible',
      no_disponible:'⛔ No disponible',
      en_transito_almacen:'🏭 En camino al almacén'
    };

    // Resaltado amarillo de lo que se busca (SN, MAC, cliente)
    const qMe = (document.getElementById('meOntBuscar')?.value||'').toLowerCase().trim();
    const hlMe = (txt) => {
      txt = String(txt==null?'':txt);
      if(!qMe || !txt) return esc(txt);
      const idx = txt.toLowerCase().indexOf(qMe);
      if(idx<0) return esc(txt);
      return esc(txt.slice(0,idx))
        + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx+qMe.length))}</mark>`
        + esc(txt.slice(idx+qMe.length));
    };

    grid.innerHTML=`<div class="!overflow-x-auto ![background:white] ![border:1px_solid_#E2E8F0] !rounded-[12px]"><table class="!w-[100%] ![border-collapse:collapse] !text-[13px]">
      <thead><tr style="background:#F8FAFC;text-align:left;">
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Nº Serie</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Nº Mac</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Modelo</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Estado</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Oficina / Instalador</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Cliente</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Fecha</th>
        <th class="!p-[9px_10px] !text-[11px] !text-[#94A3B8] !uppercase">Acciones</th>
      </tr></thead>
      <tbody>
        ${todasOnt.map(o=>`
          <tr style="border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#FAFBFC'" onmouseout="this.style.background='white'">
            <td class="!p-[8px_10px] ![font-family:monospace] !font-semibold">${hlMe(o.sn||'—')}</td>
            <td class="!p-[8px_10px] ![font-family:monospace] !text-[12px] !text-[#64748B]">${hlMe(o.mac||'—')}</td>
            <td class="!p-[8px_10px]">${esc(o.modelo||'—')}</td>
            <td class="!p-[8px_10px]"><span class="badge ${clsE[o.estado]||'badge-gray'} !text-[10px]">${lblE[o.estado]||(o.estado||'—').toUpperCase()}</span></td>
            <td class="!p-[8px_10px] !text-[11px]">
              <div>🏢 <strong>${esc(o.tecnico_asignado||'—')}</strong></div>
              ${o.estado==='comodato'
                ? (o.tecnico_instalacion?`<div style="color:${o.instalacion_confirmada==='disputada'?'#B91C1C':o.instalacion_confirmada==='pendiente'?'#B45309':'#16A871'};">${o.instalacion_confirmada==='disputada'?'⚠️':o.instalacion_confirmada==='pendiente'?'⏳':'✓'} Instaló: ${esc(o.tecnico_instalacion)}${o.instalacion_confirmada==='pendiente'?' (sin confirmar)':o.instalacion_confirmada==='disputada'?' (disputado)':''}</div>${o.instalacion_confirmada==='disputada'&&o.motivo_disputa_instalacion?`<div class="!text-[10px] !text-[#B91C1C] ![font-style:italic]">"${esc(o.motivo_disputa_instalacion)}"</div>`:''}`:'')
                : (o.tecnico_instalador?`<div style="color:${o.asignacion_confirmada==='rechazada'?'#B91C1C':o.asignacion_confirmada==='pendiente'?'#B45309':'#5B21B6'};">👤 Instala: ${esc(o.tecnico_instalador)}${o.asignacion_confirmada==='pendiente'?' (⏳ sin aceptar)':o.asignacion_confirmada==='rechazada'?' (✗ rechazó)':''}</div>${o.asignacion_confirmada==='rechazada'&&o.motivo_rechazo_asignacion?`<div class="!text-[10px] !text-[#B91C1C] ![font-style:italic]">"${esc(o.motivo_rechazo_asignacion)}"</div>`:''}`:'')}
              ${(o.es_dueño!=1 && o.es_instalador!=1 && o.yo_la_instale!=1)?`<div class="!text-[#94A3B8] ![font-style:italic] !mt-[2px]">📜 Ya no es tuya — usa "Ver qué pasó" para el detalle</div>`:''}
            </td>
            <td class="!p-[8px_10px]">${o.estado==='comodato'
              ? (o.cliente_nombre?`<div class="!font-semibold">${hlMe(o.cliente_nombre)}</div>${o.cliente_direccion?`<div class="!text-[11px] !text-[#94A3B8]">${esc(o.cliente_direccion)}</div>`:''}${(o.gps_lat&&o.gps_lng)?`<div class="!text-[11px] !mt-[1px]"><a class="!text-[#0369A1] ![text-decoration:underline]" href="https://maps.google.com/?q=${o.gps_lat},${o.gps_lng}" target="_blank">📍 Ver en mapa</a></div>`:''}`:'<span class="!text-[#A78BFA] ![font-style:italic] !text-[12px]">Sin datos</span>')
              : '<span class="!text-[#CBD5E1]">—</span>'}</td>
            <td class="!p-[8px_10px] !text-[#94A3B8] !text-[12px] !whitespace-nowrap">${fmtDate(o.fecha_envio||o.fecha)}</td>
            <td class="!p-[8px_10px] !whitespace-nowrap !relative">
              <div class="!flex !gap-[4px] !items-center">
                ${(sesion.rol!=='municipio' && o.estado!=='comodato' && o.estado!=='dañado' && o.estado!=='no_disponible' && (o.tecnico_asignado===sesion.usuario || (o.tecnico_instalador===sesion.usuario && o.asignacion_confirmada==='aceptada')))?`<button onclick="abrirInstalarOnt(${o.id})" class="btn-sm ![background:linear-gradient(135deg,#0A58B5,#0C6EDE)] ![color:white]">🏠 Instalar</button>`:''}
                <button onclick="_toggleMenuOntFila(${o.id}, event)" class="btn-sm ![background:#F1F5F9] !text-[#475569] p-[6px_10px]" title="Más acciones">⋮</button>
                <div id="menuOntFila_${o.id}" style="display:none;position:absolute;top:100%;right:8px;z-index:40;background:white;border:1.5px solid #E2E8F0;border-radius:10px;box-shadow:0 8px 20px rgba(0,0,0,.12);min-width:150px;padding:5px;">
                  ${(sesion.rol==='municipio'&&o.tecnico_asignado===sesion.usuario&&o.estado!=='comodato'&&o.estado!=='dañado'&&o.estado!=='no_disponible')?`<button onclick="_cerrarMenuOntFila(${o.id});_abrirAsignarOntTecnico(${o.id},'${esc(o.sn||o.mac||'ONT')}')" class="menu-ont-item !text-[#5B21B6]">➤ Asignar</button>`:''}
                  ${(o.tecnico_asignado===sesion.usuario&&(o.estado==='disponible'||o.estado==='dañado'||o.estado==='no_disponible'))?`<button onclick="_cerrarMenuOntFila(${o.id});_devolverOntAlmacen(${o.id},'${esc(o.sn||o.mac||'ONT')}')" class="menu-ont-item !text-[#0369A1]">${(sesion.rol==='tecnico'||sesion.rol==='persona')?'🏢 Devolver a mi municipio':'🏭 Devolver al almacén'}</button>`:''}
                  ${(o.tecnico_asignado===sesion.usuario&&o.estado==='comodato')?`<button onclick="_cerrarMenuOntFila(${o.id});_abrirDevolverOnt(${o.id},'${esc(o.sn||o.mac||'ONT')}','${o.estado}','${esc(o.cliente_nombre||'').replace(/'/g,"\\'")}')" class="menu-ont-item" style="color:#B91C1C;">↩ Recoger</button>`:''}
                  ${((o.estado==='disponible'||o.estado==='despachada')&&(o.tecnico_asignado===sesion.usuario||sesion.rol==='superadmin'))?`<button onclick="_cerrarMenuOntFila(${o.id});abrirVenderEquipo('ont',${o.id},'${esc('ONT '+(o.modelo||'')+' · SN '+(o.sn||o.mac||o.id))}')" class="menu-ont-item !text-[#166534]">💰 Vender</button>`:''}
                  <button onclick="_cerrarMenuOntFila(${o.id});verDetalleOntMunicipio(${o.id})" class="menu-ont-item !text-[#5B21B6]">👁 Ver detalle</button>
                  ${(['superadmin','distribuidor'].includes(sesion.rol) || (o.estado==='comodato' && o.asignador_actual ? o.yo_la_asigne==1 : (o.es_dueño==1||o.yo_la_asigne==1)))?`<button onclick="_cerrarMenuOntFila(${o.id});editarOntMunicipio(${o.id})" class="menu-ont-item !text-[#065F46]">✏️ Editar</button>`:''}
                  <button onclick="_cerrarMenuOntFila(${o.id});verTrazabilidadOnt('${esc(o.sn||o.mac||'')}')" class="menu-ont-item !text-[#0369A1]">🔎 Ver qué pasó</button>
                </div>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table></div>`;

    // Eventos estado ONT (ya no aplica — se quitó el botón "Estado")
  }catch(e){
    grid.innerHTML=`<div class="!text-[#E24B4A] !text-[13px] !p-[16px]">${e.message}</div>`;
  }
}


/* Muestra, como atajo, los carretes completos disponibles de la categoría elegida
   en "Solicitar fibra" — al hacer clic en uno, llena el campo de metros con su
   tamaño exacto (así la solicitud queda por ese carrete completo). */
let _solFibraCarretesDisp = [];
let _solFibraCarreteElegido = null;
async function _cargarCarretesCompletosSolicitud(catId){
  const modoWrap = document.getElementById('solFibraModoWrap');
  _solFibraCarretesDisp = [];
  _solFibraCarreteElegido = null;
  document.querySelector('input[name="solFibraModo"][value="metros"]').checked = true;
  if(!catId){ if(modoWrap) modoWrap.style.display='none'; _cambiarModoSolFibra(); return; }
  try{
    const carretes = await _api('fibra','listar_carretes',null,`categoria_id=${catId}&solo_centrales=1`);
    _solFibraCarretesDisp = (carretes||[]).filter(c=>parseFloat(c.metros_disponibles||0)>0);
  }catch(e){ _solFibraCarretesDisp = []; }
  // La opción "carrete completo" solo tiene sentido si hay carretes de verdad.
  if(modoWrap) modoWrap.style.display = _solFibraCarretesDisp.length ? 'flex' : 'none';
  _renderCarretesCompletosLista();
  _cambiarModoSolFibra();
}
function _cambiarModoSolFibra(){
  const modo = document.querySelector('input[name="solFibraModo"]:checked')?.value || 'metros';
  const metrosWrap = document.getElementById('solFibraMetrosWrap');
  const carreteWrap = document.getElementById('solFibraCarreteWrap');
  const lblMetros = document.getElementById('solFibraModoMetrosLbl');
  const lblCarrete = document.getElementById('solFibraModoCarreteLbl');
  if(metrosWrap) metrosWrap.style.display = modo==='metros' ? 'block' : 'none';
  if(carreteWrap) carreteWrap.style.display = modo==='carrete' ? 'block' : 'none';
  if(lblMetros) { lblMetros.style.borderColor = modo==='metros' ? '#0C6EDE' : '#E2E8F0'; lblMetros.style.background = modo==='metros' ? '#E6F1FB' : 'white'; }
  if(lblCarrete){ lblCarrete.style.borderColor = modo==='carrete' ? '#0C6EDE' : '#E2E8F0'; lblCarrete.style.background = modo==='carrete' ? '#E6F1FB' : 'white'; }
}
function _renderCarretesCompletosLista(){
  const wrap=document.getElementById('solFibraCarretesCompletos');
  if(!wrap) return;
  if(!_solFibraCarretesDisp.length){
    wrap.innerHTML = '<div class="!text-[12px] !text-[#94A3B8] !text-center !p-[10px]">No hay carretes completos disponibles en esta categoría.</div>';
    return;
  }
  wrap.innerHTML = _solFibraCarretesDisp.map(c=>{
    const disp=parseFloat(c.metros_disponibles||0);
    const elegido = _solFibraCarreteElegido===String(c.id);
    return `<label style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1.5px solid ${elegido?'#16A871':'#E2E8F0'};background:${elegido?'#EAF3DE':'white'};border-radius:10px;cursor:pointer;">
      <div class="!flex !items-center !gap-[8px]">
        <input class="![accent-color:#16A871]" type="radio" name="solFibraCarreteRadio" value="${c.id}" ${elegido?'checked':''} onchange="_elegirCarreteCompleto('${c.id}')">
        <span class="![font-family:monospace] !text-[12px] !font-semibold">${esc(c.codigo||('Carrete #'+c.id))}</span>
      </div>
      <span class="!font-bold !text-[#166534] !text-[13px]">${disp.toFixed(0)} m</span>
    </label>`;
  }).join('');
}
function _elegirCarreteCompleto(carreteId){
  _solFibraCarreteElegido = String(carreteId);
  const c = _solFibraCarretesDisp.find(x=>String(x.id)===String(carreteId));
  if(c){ const m=document.getElementById('solFibraMetros'); if(m) m.value=parseFloat(c.metros_disponibles||0); }
  _renderCarretesCompletosLista();
}

async function abrirSolicitarFibra(catIdFijo){
  // Asegurar que las categorías estén cargadas (cualquier usuario puede solicitar).
  if(!_fibraCats.length){
    try{
      const rc=await fetch('api/fibra.php?action=categorias',{credentials:'same-origin'});
      _fibraCats=await rc.json();
    }catch{}
  }
  const selWrap = document.getElementById('solFibraCatSelWrap');
  const fijaWrap = document.getElementById('solFibraCatFijaWrap');
  const sel=document.getElementById('solFibraCatSel');
  // El <select> siempre se llena (aunque quede oculto), porque
  // confirmarSolicitarFibra() lee la categoría desde su value.
  if(sel){
    sel.innerHTML='<option value="">Seleccionar categoría…</option>'+
      _fibraCats.map(c=>{
        const disp = parseFloat(c.metros_disponibles||0);
        const sinStock = disp<=0;
        return `<option value="${c.id}" data-disp="${disp}" ${sinStock?'disabled':''}>${esc(c.nombre)} — ${disp.toFixed(0)} m disponibles${sinStock?' (sin stock)':''}</option>`;
      }).join('');
  }
  if(catIdFijo){
    // Vino de una fila específica de "Productos en stock": ya se sabe cuál
    // fibra se está pidiendo, así que se fija (no editable) en vez de un
    // desplegable para elegir otra distinta.
    const cat = _fibraCats.find(c=>String(c.id)===String(catIdFijo));
    if(selWrap) selWrap.style.display='none';
    if(fijaWrap) fijaWrap.style.display='block';
    const txt=document.getElementById('solFibraCatFijaTexto');
    if(txt) txt.textContent = cat ? `${cat.nombre} — ${parseFloat(cat.metros_disponibles||0).toFixed(0)} m disponibles` : 'Categoría seleccionada';
    if(sel) sel.value=String(catIdFijo);
  }else{
    // Flujo genérico ("Solicitar más fibra"): dejar elegir cualquier categoría.
    if(selWrap) selWrap.style.display='block';
    if(fijaWrap) fijaWrap.style.display='none';
  }
  const m=document.getElementById('solFibraMetros'); if(m) m.value='';
  const n=document.getElementById('solFibraNota');   if(n) n.value='';
  const modoWrap=document.getElementById('solFibraModoWrap'); if(modoWrap) modoWrap.style.display='none';
  _solFibraCarretesDisp = []; _solFibraCarreteElegido = null;
  document.querySelector('input[name="solFibraModo"][value="metros"]').checked = true;
  _cambiarModoSolFibra();
  document.getElementById('solFibraAlerta').className='alerta';
  document.getElementById('modalSolicitarFibra')?.classList.add('open');
  if(catIdFijo) _cargarCarretesCompletosSolicitud(catIdFijo);
}

async function confirmarSolicitarFibra(){
  const catId   = document.getElementById('solFibraCatSel')?.value;
  const modo    = document.querySelector('input[name="solFibraModo"]:checked')?.value || 'metros';
  const metros  = parseFloat(document.getElementById('solFibraMetros')?.value||0);
  const nota    = document.getElementById('solFibraNota')?.value.trim()||'';
  const alerta  = document.getElementById('solFibraAlerta');
  alerta.className='alerta';
  if(!catId){ alerta.textContent='Selecciona una categoría.'; alerta.className='alerta error'; return; }
  if(modo==='carrete' && !_solFibraCarreteElegido){ alerta.textContent='Elige cuál carrete necesitas.'; alerta.className='alerta error'; return; }
  if(!metros||metros<=0){ alerta.textContent='Ingresa los metros que necesitas.'; alerta.className='alerta error'; return; }
  const cat=_fibraCats.find(c=>String(c.id)===String(catId));
  // Validar que la categoría tenga metros disponibles en el almacén central.
  const disponibles = parseFloat(cat?.metros_disponibles||0);
  if(disponibles<=0){
    alerta.textContent='Esta categoría no tiene fibra disponible en el almacén. No se puede solicitar.';
    alerta.className='alerta error'; return;
  }
  if(metros>disponibles){
    alerta.textContent=`Solo hay ${disponibles.toFixed(0)} m disponibles en el almacén. Reduce la cantidad.`;
    alerta.className='alerta error'; return;
  }
  const carreteElegido = modo==='carrete' ? _solFibraCarretesDisp.find(c=>String(c.id)===_solFibraCarreteElegido) : null;
  const notaFinal = carreteElegido
    ? `${nota?nota+' — ':''}Carrete completo solicitado: ${carreteElegido.codigo||('#'+carreteElegido.id)} (${metros.toFixed(0)} m)`
    : (nota||`Solicitud de ${metros} m de fibra ${cat?cat.nombre:''} para ${sesion.sede}`);
  try{
    const res=await _api('solicitudes','crear',{
      ref:'FIBRA',
      nombre:`Fibra ${cat?cat.nombre:''}`,
      destino:sesion.sede,
      cantidad:metros,
      unidadEnvio:'metros',
      categoria_fibra_id: catId,
      nota: notaFinal
    });
    if(res.error) throw new Error(res.error);
    cerrarModal('modalSolicitarFibra');
    toast('Solicitud enviada al superadmin ✓','success');
    await _recargarSolicitudes();
    updateNotifBadges();
  }catch(e){ alerta.textContent=e.message||'Error al enviar.'; alerta.className='alerta error'; }
}
async function cargarMiFibra(){
  const grid=document.getElementById('meFibraGrid');
  if(!grid) return;
  grid.innerHTML='<div class="!text-[#94A3B8] !text-[13px] !text-center !p-[24px]">Cargando fibra…</div>';
  try{
    const res=await fetch(`api/fibra.php?action=mis_carretes`,{credentials:'same-origin'});
    const data=await res.json();
    const misFibra=data;

    const _esSuperDist=sesion?.rol==='superadmin'||sesion?.rol==='distribuidor'||tienePermiso('gestionar_fibra');

    // Cargar categorías si aún no están (necesarias para el modal de solicitud)
    if(!_fibraCats.length){
      try{
        const rc=await fetch('api/fibra.php?action=categorias',{credentials:'same-origin'});
        _fibraCats=await rc.json();
      }catch{}
    }

    if(!misFibra.length){
      const esAbastecedorFib = sesion?.rol==='superadmin' || sesion?.rol==='distribuidor';
      if(esAbastecedorFib){
        grid.innerHTML='<div class="!text-center !p-[32px] !text-[#94A3B8] !text-[13px]">No hay carretes asignados a esta sede.</div>';
      } else {
        grid.innerHTML=`<div class="!text-center !p-[40px_20px]">
          <div class="!text-[36px] !mb-[12px]">🔵</div>
          <div class="![font-family:Syne,sans-serif] !font-bold !text-[15px] !mb-[6px]">Sin carretes de fibra asignados</div>
          <div class="!text-[13px] !text-[#94A3B8] !mb-[20px]">Puedes solicitar metros de fibra al almacén central</div>
          <button onclick="abrirSolicitarFibra()" class="btn btn-primary !text-[13px]">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
            Solicitar metros de fibra
          </button>
        </div>`;
      }
      return;
    }

    const porCategoria={};
    const carretesCompletos=[];

    misFibra.forEach(c=>{
      const codigo=(c.codigo||'').trim();
      // Es carrete completo si tiene código personalizado (no vacío, no "Enviado desde Neiva")
      const esCompleto = codigo && codigo!=='' && codigo!=='Enviado desde almacén';
      if(esCompleto){
        carretesCompletos.push(c);
      } else {
        if(!porCategoria[c.cat_nombre]) porCategoria[c.cat_nombre]={color:c.cat_color,tipo:c.cat_tipo,metros_total:0,metros_usados:0,carretes:[]};
        porCategoria[c.cat_nombre].metros_total  += parseFloat(c.metros)||0;
        porCategoria[c.cat_nombre].metros_usados += parseFloat(c.metros_usados)||0;
        porCategoria[c.cat_nombre].carretes.push(c);
      }
    });

    const esSuperDist2=_esSuperDist;
    let html='';

    // Botón solicitar fibra para usuarios que NO son abastecedores (municipio/técnico/persona)
    const esAbastecedorFibra = sesion?.rol==='superadmin' || sesion?.rol==='distribuidor';
    if(!esAbastecedorFibra){
      html+=`<div class="!mb-[14px]">
        <button onclick="abrirSolicitarFibra()" class="btn btn-primary !text-[13px]">
          <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
          Solicitar más fibra
        </button>
      </div>`;
    }

    if(Object.keys(porCategoria).length){
      html+='<div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !tracking-[.06em] !mb-[10px]">Metros disponibles por categoría</div>';
      html+=Object.entries(porCategoria).map(([catNombre,cat])=>{
        const disp=cat.metros_total-cat.metros_usados;
        const pct=cat.metros_total>0?Math.round((disp/cat.metros_total)*100):0;
        const barColor=pct>50?'#2DB82D':pct>20?'#BA7517':'#E24B4A';
        const activo=cat.carretes.find(c=>(parseFloat(c.metros)-parseFloat(c.metros_usados))>0);
        return `<div class="pcard !mb-[10px] !p-[16px]">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
            <div class="!flex !items-center !gap-[10px]">
              <div style="width:14px;height:14px;background:${esc(cat.color)};border-radius:4px;"></div>
              <div>
                <div class="!font-bold !text-[14px]">${esc(catNombre)}</div>
                <div class="!text-[11px] !text-[#94A3B8]">${cat.tipo} · ${cat.carretes.length} envío${cat.carretes.length!==1?'s':''} recibidos</div>
              </div>
            </div>
            <div class="!flex !items-center !gap-[10px]">
              <div class="!text-right">
                <div style="font-family:Syne,sans-serif;font-weight:800;font-size:20px;color:${barColor};">${disp.toFixed(0)}<span class="!text-[12px] !font-normal !text-[#94A3B8]"> m disp.</span></div>
                <div class="!text-[11px] !text-[#94A3B8]">de ${cat.metros_total.toFixed(0)} m recibidos · ${pct}%</div>
              </div>
              ${activo&&disp>0?`<button class="btn-sm me-gasto-fibra ![background:#FAEEDA] !text-[#92400E]" data-id="${activo.id}" data-nombre="${esc(catNombre)}" data-disp="${disp}">📝 Registrar uso</button>
              <button class="btn-sm me-devolver-fibra ![background:#E6F1FB] !text-[#0A58B5]" data-id="${activo.id}" data-nombre="${esc(catNombre)}" data-disp="${disp}">↩ Devolver</button>`:''}
              <button class="btn-sm me-hist-fibra ![background:#F0F7FF] !text-[#0A1F5C]" data-cat="${esc(catNombre)}">📋 Historial</button>
            </div>
          </div>
          <div class="![background:#E2E8F0] !rounded-[99px] !h-[6px]"><div style="background:${barColor};border-radius:99px;height:6px;width:${pct}%;"></div></div>
          <div class="me-hist-panel !hidden !mt-[12px] ![border-top:1px_solid_#F1F5F9] !pt-[10px]" data-cat="${esc(catNombre)}">
            <div class="!text-[11px] !text-[#94A3B8] !text-center !p-[8px]">Cargando historial…</div>
          </div>
        </div>`;
      }).join('');
    }

    if(carretesCompletos.length){
      html+='<div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !tracking-[.06em] !m-[16px_0_10px]">Carretes completos asignados</div>';
      html+=carretesCompletos.map(c=>{
        const disp=parseFloat(c.metros_disponibles)||0;
        const total=parseFloat(c.metros)||0;
        const pct=total>0?Math.round((disp/total)*100):0;
        const barColor=pct>50?'#2DB82D':pct>20?'#BA7517':'#E24B4A';
        return `<div class="pcard" style="margin-bottom:10px;padding:16px;border-left:4px solid ${esc(c.cat_color)};">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px;">
            <div class="!flex !items-center !gap-[10px]">
              <div style="width:14px;height:14px;background:${esc(c.cat_color)};border-radius:4px;"></div>
              <div>
                <div class="!flex !items-center !gap-[6px]">
                  ${c.codigo?`<span class="![font-family:monospace] !text-[11px] ![background:#E0F6FF] !text-[#0369A1] !p-[2px_7px] !rounded-[5px] !font-bold">${esc(c.codigo)}</span>`:''}
                  <span class="!font-bold !text-[14px]">${esc(c.cat_nombre)}</span>
                </div>
                <div class="!text-[11px] !text-[#94A3B8]">${esc(c.cat_nombre)} · Carrete completo · ${fmtDate(c.fecha)}</div>
              </div>
            </div>
            <div class="!flex !items-center !gap-[10px]">
              <div class="!text-right">
                <div style="font-family:Syne,sans-serif;font-weight:800;font-size:20px;color:${barColor};">${disp.toFixed(0)}<span class="!text-[12px] !font-normal !text-[#94A3B8]"> m</span></div>
                <div class="!text-[11px] !text-[#94A3B8]">de ${total.toFixed(0)} m · ${pct}%</div>
              </div>
              ${disp>0?`<button class="btn-sm me-gasto-fibra ![background:#FAEEDA] !text-[#92400E]" data-id="${c.id}" data-nombre="${esc(c.cat_nombre)}" data-disp="${disp}">📝 Registrar uso</button>
              <button class="btn-sm me-devolver-fibra ![background:#E6F1FB] !text-[#0A58B5]" data-id="${c.id}" data-nombre="${esc(c.cat_nombre)}" data-disp="${disp}">↩ Devolver</button>`:'<span class="badge badge-danger">Agotado</span>'}
            </div>
          </div>
          <div class="![background:#E2E8F0] !rounded-[99px] !h-[6px]"><div style="background:${barColor};border-radius:99px;height:6px;width:${pct}%;"></div></div>
        </div>`;
      }).join('');
    }

    grid.innerHTML=html;
    grid.querySelectorAll('.me-gasto-fibra').forEach(b=>{
      b.addEventListener('click',()=>abrirGastoFibra(parseInt(b.dataset.id),b.dataset.nombre,parseFloat(b.dataset.disp)));
    });
    grid.querySelectorAll('.me-devolver-fibra').forEach(b=>{
      b.addEventListener('click',()=>abrirDevolverFibra(parseInt(b.dataset.id),b.dataset.nombre,parseFloat(b.dataset.disp)));
    });

    // Historial por categoría
    grid.querySelectorAll('.me-hist-fibra').forEach(b=>{
      b.addEventListener('click', async()=>{
        const cat=b.dataset.cat;
        const panel=grid.querySelector(`.me-hist-panel[data-cat="${cat}"]`);
        if(!panel) return;
        if(panel.style.display!=='none'){panel.style.display='none';return;}
        panel.style.display='';
        try{
          const r=await fetch(`api/fibra.php?action=mi_historial_fibra`,{credentials:'same-origin'});
          const movs=await r.json();
          const filtrados=movs.filter(m=>m.cat_nombre===cat);
          if(!filtrados.length){panel.innerHTML='<div class="!text-[12px] !text-[#94A3B8] !text-center !p-[8px]">Sin movimientos registrados.</div>';return;}
          panel.innerHTML=`<div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !mb-[8px]">Últimos movimientos — ${esc(cat)}</div>
          <div style="display:flex;flex-direction:column;gap:5px;">
            ${filtrados.map(m=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 10px;background:#F8FAFC;border-radius:8px;font-size:12px;">
              <div class="!text-[#0F172A] !font-semibold">${parseFloat(m.metros)} mts. <span class="!text-[#94A3B8] !font-normal">— ${esc(m.descripcion||'Sin descripción')}</span></div>
              <div class="!text-[#94A3B8] !whitespace-nowrap !ml-[10px]">${fmtDate(m.fecha)}</div>
            </div>`).join('')}
          </div>`;
        }catch(e){panel.innerHTML=`<div class="!text-[#E24B4A] !text-[12px] !p-[8px]">${e.message}</div>`;}
      });
    });
  }catch(e){
    grid.innerHTML=`<div class="!text-[#E24B4A] !text-[13px] !p-[16px]">${e.message}</div>`;
  }
}

/* ════════════════════════════════════════════════
   CREAR USUARIO (superadmin)
════════════════════════════════════════════════ */
function abrirModalCrearUsuario(){
  document.getElementById('crearUsuarioAlerta').className='alerta';
  ['cu-nombre','cu-apellido','cu-usuario','cu-password','cu-correo','cu-cargo','cu-telefono']
    .forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.getElementById('cu-rol').value='municipio';
  _cuActualizarNombreLabel();
  actualizarSedesCU();
  document.getElementById('modalCrearUsuario').classList.add('open');
}

function _cuActualizarNombreLabel(){
  const rol = document.getElementById('cu-rol')?.value;
  const lbl = document.getElementById('cuLblNombre');
  const apDiv = document.getElementById('cuApellidoDiv');
  const nomInp = document.getElementById('cu-nombre');
  // Municipio y distribuidor representan una sede/bodega, no una persona:
  // un solo campo de nombre, sin apellido.
  const grid = document.getElementById('cuNombreGrid');
  if(rol === 'municipio' || rol === 'distribuidor'){
    if(lbl) lbl.textContent = rol === 'distribuidor' ? 'Nombre del distribuidor' : 'Nombre de la sede';
    if(nomInp) nomInp.placeholder = rol === 'distribuidor' ? 'Ej: Bodega Central Neiva' : 'Ej: Oficina Palermo, Ofi2…';
    if(nomInp) nomInp.removeAttribute('oninput'); // aquí es nombre de sede, sí puede llevar números
    if(apDiv) apDiv.style.display = 'none';
    if(grid) grid.style.gridTemplateColumns = '1fr';
    // Limpiar apellido
    const ap = document.getElementById('cu-apellido');
    if(ap) ap.value = '';
  } else {
    if(lbl) lbl.textContent = 'Nombre';
    if(nomInp) nomInp.placeholder = 'Nombre';
    if(nomInp) nomInp.setAttribute('oninput', "this.value=this.value.replace(/[^a-zA-ZÀ-ÿ\\s]/g,'')"); // vuelve a ser nombre de persona
    if(apDiv) apDiv.style.display = '';
    if(grid) grid.style.gridTemplateColumns = '1fr 1fr';
  }
}

function actualizarSedesCU(){
  const sel=document.getElementById('cu-sede');
  const rolElegido = document.getElementById('cu-rol')?.value || '';
  // El almacén central es exclusivo de superadmin/distribuidor — para
  // cualquier otro rol (municipio/técnico/persona), ni siquiera aparece
  // como opción, así no hay forma de asignarlo por accidente.
  const permiteCentral = rolElegido==='superadmin' || rolElegido==='distribuidor';
  const sedes = permiteCentral ? getSedesActivas() : getSedesMunicipio();
  sel.innerHTML='';
  sedes.forEach(s=>{
    const o=document.createElement('option');
    o.value=s.id; o.textContent=s.nombre;
    sel.appendChild(o);
  });
}

async function confirmarCrearUsuario(){
  const nombre   = document.getElementById('cu-nombre').value.trim();
  const apellido = document.getElementById('cu-apellido').value.trim();
  const usuario  = document.getElementById('cu-usuario').value.trim();
  const password = document.getElementById('cu-password').value;
  const correo   = document.getElementById('cu-correo').value.trim();
  const rol      = document.getElementById('cu-rol').value;
  const sede_id  = parseInt(document.getElementById('cu-sede').value);
  const alerta   = document.getElementById('crearUsuarioAlerta');

  alerta.className='alerta';
  if(!usuario||!password||!sede_id){ alerta.textContent='Usuario, contraseña y sede son obligatorios.'; alerta.className='alerta error'; return; }
  if(password.length<6){ alerta.textContent='La contraseña debe tener al menos 6 caracteres.'; alerta.className='alerta error'; return; }
  if(!document.getElementById('cuAceptaTerminos')?.checked){ alerta.textContent='Debes aceptar los términos y condiciones y el tratamiento de datos personales.'; alerta.className='alerta error'; return; }
  if(correo && !esCorreoValido(correo)){ alerta.textContent='Escribe un correo válido (ej: nombre@dominio.com).'; alerta.className='alerta error'; return; }

  try{
    const cargo    = document.getElementById('cu-cargo')?.value.trim()||'';
    const telefono = document.getElementById('cu-telefono')?.value.trim()||'';
    const res  = await _api('usuarios','crear_directo', { nombre, apellido, usuario, password, correo, rol, sede_id, cargo, telefono });
    if(res.error){ alerta.textContent=res.error; alerta.className='alerta error'; return; }
    cerrarModal('modalCrearUsuario');
    await _recargarUsuarios();
    renderUsuarios();
    toast('Usuario creado correctamente ✓','ok');
  }catch(e){
    alerta.textContent='Error al crear el usuario.';
    alerta.className='alerta error';
  }
}