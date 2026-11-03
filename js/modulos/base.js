/* Celular: las ventanas se ajustan a la parte REALMENTE visible (cuando sale el teclado, la ventana se encoge y los botones siguen a la vista). */
(function(){
  try{
    const v = window.visualViewport; if(!v) return;
    const r = document.documentElement;
    const f = ()=>{ r.style.setProperty('--vvh', v.height+'px'); r.style.setProperty('--vvt', v.offsetTop+'px'); };
    v.addEventListener('resize', f); v.addEventListener('scroll', f); f();
    // Al escribir en un campo dentro de una ventana, se lleva el campo a la vista
    document.addEventListener('focusin', e=>{
      const t = e.target; if(!t || !t.closest || !t.closest('.modal-bg.open')) return;
      setTimeout(()=>{ try{ t.scrollIntoView({block:'center', behavior:'smooth'}); }catch(_){} }, 300);
    });
  }catch(_){}
})();
/* ════════════════════════════════════════════════
   API BASE — helper fetch contra PHP
════════════════════════════════════════════════ */
const API = 'api';
async function _api(endpoint, action, body=null, extraParams=''){
  try{
    const url=`${API}/${endpoint}.php?action=${action}${extraParams?'&'+extraParams:''}`;
    const opts={method:body?'POST':'GET',credentials:'same-origin',headers:{'Content-Type':'application/json'}};
    if(body) opts.body=JSON.stringify(body);
    const r=await fetch(url,opts);
    const d=await r.json();
    if(!r.ok) throw new Error(d.detalle || d.error || `Error ${r.status}`);
    return d;
  }catch(e){console.error(`[API] ${endpoint}/${action}`,e);throw e;}
}

/* ════════════════════════════════════════════════
   SISTEMA DE SEDES (desde PHP)
════════════════════════════════════════════════ */
let _sedesCache=null;
async function _cargarSedes(){
  if(_sedesCache!==null) return _sedesCache;
  try{
    const url = sesion?.rol==='superadmin'
      ? 'api/sedes.php?action=listar&todas=1'
      : 'api/sedes.php?action=listar';
    const res = await fetch(url,{credentials:'same-origin'});
    _sedesCache = await res.json();
    return _sedesCache;
  }catch{ _sedesCache=[]; return []; }
}
// Sedes internas del sistema — no se muestran en selectores ni en oficinas
const _SEDES_INTERNAS = ['Administración','Sistema'];
function getSedes(){return (_sedesCache||[]).filter(s=>!_SEDES_INTERNAS.includes(s.nombre));}
// Stock del almacén central (identificado únicamente como "Almacen Central")
function _stockCentral(p){
  if(p && p._stockEspecial!==undefined) return p._stockEspecial;
  if(!p||!p.stock) return p?.stock_neiva||0;
  return p.stock['Almacen Central']||p.stock_neiva||0;
}
function getSedesActivas(){return getSedes().filter(s=>s.activa==1||s.activa==null||s.activa===undefined);}
function getSedesMunicipio(){
  // "Almacen Central" está reservado en todo el sistema como sinónimo del
  // almacén central — nunca debe aparecer como una oficina seleccionable,
  // sin importar qué "tipo" tenga guardado por error.
  // NOTA: "Neiva" YA NO está reservado — es una ciudad real con oficinas
  // normales, no un sinónimo del almacén.
  const reservados = ['almacen central','almacén central','administración','administracion','sistema'];
  return getSedesActivas().filter(s=>
    (s.tipo==='municipio'||s.tipo==='otro') && !reservados.includes((s.nombre||'').toLowerCase().trim())
  );
}
function getNombresSedes(){return getSedesMunicipio().map(s=>s.nombre);}

/* ════════════════════════════════════════════════
   PERMISOS DISPONIBLES
════════════════════════════════════════════════ */
const PERMISOS_DISPONIBLES = {
  // Inventario
  ver_inventario:      "Ver inventario y productos",
  editar_productos:    "Agregar y editar productos",
  eliminar_productos:  "Eliminar productos",
  registrar_gastos:    "Registrar gastos en sede",
  aprobar_ventas:      "Aprobar o rechazar las ventas que piden los demás usuarios",
  auditar_inventario:  "Auditar inventario físico de personas",
  registrar_ont_campo: "Registrar/escanear ONT nuevas en campo (técnico/municipio/persona)",
  marcar_retirado:     "Marcar algo instalado (mufla, caja, etc.) como retirado en el mapa",
  registrar_ingresos:  "Registrar llegada de stock (ingreso)",
  anular_ingresos:     "Anular un ingreso ya registrado",
  ver_mapa_actividad:  "Ver el mapa de actividad (ubicaciones GPS)",
  gestionar_sst:       "Gestionar SST (cascos, escaleras, eslingas, herramientas: inventario, entregas, inspecciones)",

  // Envíos y pedidos
  crear_solicitudes:   "Crear solicitudes de envío a superadmin",
  rechazar_envios:     "Rechazar solicitudes de envío",
  gestionar_pedidos:   "Ver y gestionar pedidos de municipios",
  aprobar_pedidos:     "Aprobar pedidos directo (sin pasar por el almacén)",
  despachar:           "Despachar pedidos (marcar en camino)",
  elegir_material_despacho: "Elegir de qué carrete/ONT despachar",
  ver_envios:          "Ver el seguimiento de todos los envíos",
  enviar_multiple:     "Envío múltiple directo (varios productos a la vez)",

  // Historial y reportes
  ver_historial:       "Ver historial de movimientos",
  ver_reportes:        "Ver y exportar reportes Excel",

  // ONT y Fibra
  registrar_ont:       "Ingreso de equipos/FO (escaneo de ONT, OLT, fibra)",
  gestionar_fibra:     "Gestionar carretes y categorías de fibra (crear, enviar)",
  eliminar_fibra:      "Eliminar categorías y carretes de fibra",
  ver_mis_equipos:     "Ver mis ONTs y fibra asignados a mí",
  gestionar_olt:       "Gestionar OLT (crear, editar, eliminar, enviar, estado)",
  gestionar_equipos:   "Gestionar Mikrotik (crear, editar, eliminar, enviar, estado)",

  // Envio entre sedes
  enviar_material:     "Enviar material de su inventario personal a otra persona",

  // Compras
  solicitar_compras:   "Crear solicitudes de compra (incluye productos nuevos)",
  gestionar_compras:   "Ver todas las solicitudes de compra, aprobarlas o rechazarlas",

  // Proveedores
  crear_proveedores:   "Crear proveedores",
  editar_proveedores:  "Editar proveedores",
  eliminar_proveedores:"Eliminar proveedores",

  // Clientes / Proyectos
  eliminar_proyectos:  "Eliminar clientes/proyectos",

  // WhatsApp
  usar_whatsapp:       "Avisar por WhatsApp al solicitante (en Solicitudes/Pedidos)",

  // Administración
  eliminar_ont_masivo: "Eliminar ONTs masivamente (borrar todo)",
  gestionar_usuarios:  "Gestionar cuentas de usuarios (antiguo, incluye todo lo de abajo)",
  editar_usuarios:     "Editar datos de usuarios (nombre, correo, sede, etc.)",
  asignar_permisos_usuarios: "Asignar permisos a otros usuarios",
  desactivar_usuarios: "Activar/desactivar cuentas de usuarios",
  eliminar_usuarios:   "Eliminar cuentas de usuarios",
  cambiar_rol:         "Cambiar el rol de un usuario",
  crear_tecnicos:      "Crear cuentas de técnico",
  crear_personas:      "Crear cuentas de persona",
  crear_oficinas:      "Crear sedes/oficinas",
  desactivar_sedes:    "Activar/desactivar sedes",
  eliminar_sedes:      "Eliminar sedes",
  aprobar_registros:   "Aprobar registros de nuevos usuarios",
};

const PERMISOS_DEFAULT = {
  superadmin: Object.keys(PERMISOS_DISPONIBLES),

  // Lista exacta definida por el dueño del sistema: editar productos,
  // enviar material (incluye envío múltiple), agregar productos, registrar
  // llegada de stock, gestionar proveedores, despachar pedidos (elegir
  // carrete/ONT), registrar ONT por escaneo, y ver informes.
  // NO incluye: aprobar solicitudes/pedidos, gestionar usuarios, crear
  // sedes, aprobar registros nuevos, eliminar productos/proveedores/ONTs.
  distribuidor: [
    "ver_inventario","editar_productos","enviar_material","enviar_multiple",
    "registrar_gastos","registrar_ingresos","gestionar_pedidos",
    "despachar","elegir_material_despacho",
    "crear_proveedores","editar_proveedores","solicitar_compras",
    "ver_historial","ver_reportes",
    "registrar_ont","gestionar_fibra","ver_mis_equipos","gestionar_equipos",
  ],

  // "enviar_material" (Asignar a alguien / Asignar Multiple) SÍ viene
  // predeterminado para estos tres roles, igual que Pedir Multiple, Gastar
  // Multiple y Devolver Multiple — no hace falta dárselo a mano.
  // Municipio (oficina que supervisa a sus técnicos/personas) tiene lo de
  // Persona/Técnico más registrar la llegada de stock a su sede y ver sus
  // propios reportes. "ver_mapa_actividad" quedó descartado para los tres
  // a pedido explícito del dueño del sistema.
  // Debe reflejar la misma lista que PERMISOS_DEFAULT_POR_ROL en config.php.
  municipio: [
    "ver_inventario","ver_historial","crear_solicitudes","enviar_material",
    "registrar_gastos","ver_mis_equipos","registrar_ont",
    "registrar_ingresos","ver_reportes"
  ],

  tecnico: [
    "ver_inventario","ver_historial","crear_solicitudes","enviar_material",
    "registrar_gastos","ver_mis_equipos","registrar_ont"
  ],

  persona: [
    "ver_inventario","ver_historial","crear_solicitudes","enviar_material",
    "registrar_gastos","ver_mis_equipos","registrar_ont"
  ]
};
// Validación de correo: formato general (no restringe a proveedores
// específicos) — así funcionan tanto Gmail/Hotmail como correos de
// dominio propio de empresa (ej: nombre@tuempresa.com).
function esCorreoValido(correo) {
  if (!correo) return false;
  // usuario@dominio.algo — exige al menos un punto en el dominio, y
  // rechaza espacios/arrobas de más, pero no restringe qué dominio es.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo.trim().toLowerCase());
}

// "Asignar a alguien" y "Asignar múltiple": el superadmin NO los ve por defecto
// (él entrega y administra, no asigna). Solo aparecen si se le da a mano el
// permiso "enviar_material" en su lista personal de permisos.
function _adminPuedeAsignar(){
  if(!sesion) return false;
  if(sesion.rol!=='superadmin') return true;
  return Array.isArray(sesion.permisos) && sesion.permisos.includes('enviar_material');
}

function tienePermiso(perm){
  if(!sesion) return false;
  if(sesion.rol==='superadmin') return true;
  // OJO: un arreglo vacío [] es "verdadero" en JS, así que "sesion.permisos||X"
  // nunca caía a los permisos por defecto si el backend guardaba [] en vez de
  // null — por eso cualquier cuenta sin permisos personalizados asignados a
  // mano se quedaba sin nada. Se revisa explícitamente si tiene contenido.
  const permisos = (Array.isArray(sesion.permisos) && sesion.permisos.length) ? sesion.permisos : (PERMISOS_DEFAULT[sesion.rol]||[]);
  return permisos.includes(perm);
}

/* ════════════════════════════════════════════════
   AUTH — conectado a PHP
════════════════════════════════════════════════ */
const KEY_SESION="integrados_user";
function getSesion(){try{const r=sessionStorage.getItem(KEY_SESION);return r?JSON.parse(r):null;}catch{return null;}}
function confirmarLogout(){
  document.getElementById('modalConfirmarLogout')?.classList.add('open');
}

/* ── Timeout de inactividad: 30 minutos ──────────────────────
   Avisa al usuario 2 minutos antes con un modal para que pueda
   extender la sesión. Si no responde, cierra sesión solo.
   Mientras el aviso está abierto, NO se reinicia solo con
   mover el mouse — hay que confirmar a propósito con el botón,
   para que el aviso de seguridad tenga sentido de verdad.     */
(function(){
  const TIMEOUT_MS   = 30 * 60 * 1000; // 30 min
  const AVISO_MS     = 28 * 60 * 1000; // avisa a los 28 min
  const AVISO_SEG    = 120; // 2 minutos de cuenta regresiva
  let timerAviso, timerLogout, intervaloCuenta;
  let avisoAbierto = false;

  function resetTimers(){
    if(avisoAbierto) return; // mientras el aviso está abierto, solo el botón cuenta
    clearTimeout(timerAviso);
    clearTimeout(timerLogout);
    timerAviso  = setTimeout(mostrarAvisoInactividad, AVISO_MS);
    timerLogout = setTimeout(()=>{ logout(); }, TIMEOUT_MS);
  }

  function cerrarAvisoInactividad(){
    avisoAbierto = false;
    clearInterval(intervaloCuenta);
    document.getElementById('modalInactividad')?.classList.remove('open');
  }

  function _actualizarVisualCuenta(seg){
    const el = document.getElementById('inactividadCuenta');
    const barra = document.getElementById('inactividadBarra');
    const icono = document.getElementById('inactividadIcono');
    const m = Math.floor(seg/60), s = seg%60;
    if(el) el.textContent = m+':'+String(s).padStart(2,'0');
    if(barra) barra.style.width = Math.max(0,(seg/AVISO_SEG*100))+'%';
    const urgente = seg <= 20;
    const color = urgente ? '#DC2626' : '#F59E0B';
    if(barra) barra.style.background = color;
    if(el) el.style.color = color;
    if(icono) icono.style.background = urgente ? '#FEE2E2' : '#FEF3C7';
  }

  function mostrarAvisoInactividad(){
    avisoAbierto = true;
    document.getElementById('modalInactividad')?.classList.add('open');
    let seg = AVISO_SEG;
    _actualizarVisualCuenta(seg);
    clearInterval(intervaloCuenta);
    intervaloCuenta = setInterval(()=>{
      seg--;
      _actualizarVisualCuenta(seg);
      if(seg <= 0) clearInterval(intervaloCuenta);
    }, 1000);
  }

  // Reiniciar en cualquier interacción del usuario — solo mientras el
  // aviso NO está abierto (ver resetTimers).
  ['mousemove','keydown','mousedown','touchstart','scroll','click'].forEach(ev=>{
    document.addEventListener(ev, resetTimers, {passive:true});
  });

  // Arrancar al cargar
  window.addEventListener('load', resetTimers);

  // Exponer para el botón "Seguir conectado" — esta es la ÚNICA forma de
  // extender la sesión mientras el aviso está mostrándose.
  window._extenderSesion = function(){
    cerrarAvisoInactividad();
    clearTimeout(timerAviso);
    clearTimeout(timerLogout);
    timerAviso  = setTimeout(mostrarAvisoInactividad, AVISO_MS);
    timerLogout = setTimeout(()=>{ logout(); }, TIMEOUT_MS);
  };
})();

async function logout(){
  try{await _api('auth','logout',{});}catch(e){}
  sessionStorage.removeItem('integrados_user');
  localStorage.clear();
  window.location.replace("index.html"); // replace evita que quede en historial
}

// Verificar sesión cuando el usuario vuelve con botón Atrás
// (pageshow se dispara incluso cuando la página sale del caché bfcache)
window.addEventListener('pageshow', function(e){
  if(e.persisted || performance.getEntriesByType('navigation')[0]?.type === 'back_forward'){
    fetch('api/auth.php?action=sesion', {credentials:'same-origin'})
      .then(r=>r.json())
      .then(d=>{ if(!d||!d.usuario) window.location.replace('index.html'); })
      .catch(()=>{ window.location.replace('index.html'); });
  }
});

/* Gestión de usuarios — llama a PHP */
/* ════════════════════════════════════════════════
   ENVIO DE MATERIAL (sub-distribuidor)
════════════════════════════════════════════════ */
let _emIndex = null;

/* ════════════════════════════════════════════════
   CARRITO DE ENVÍO MÚLTIPLE
════════════════════════════════════════════════ */
function toggleModoEnvio(){
  _modoEnvio = !_modoEnvio;
  _carritoEnvio = {};
  const carrito = document.getElementById('carritoEnvio');
  const btn = document.getElementById('btnModoEnvio');
  if(_modoEnvio){
    carrito.style.display = 'block';
    if(btn){ btn.style.background='linear-gradient(135deg,#B91C1C,#E24B4A)'; btn.innerHTML='✕ Cancelar envío'; }
  } else {
    carrito.style.display = 'none';
    if(btn){ btn.style.background='linear-gradient(135deg,#1E8F1E,#2DB82D)'; btn.innerHTML='<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg> Enviar material'; }
  }
  renderTabla();
}

function cancelarModoEnvio(){
  _modoEnvio = false;
  _carritoEnvio = {};
  const carrito = document.getElementById('carritoEnvio');
  const btn = document.getElementById('btnModoEnvio');
  if(carrito) carrito.style.display='none';
  if(btn){ btn.style.background='linear-gradient(135deg,#1E8F1E,#2DB82D)'; btn.textContent='Enviar material'; }
  renderTabla();
}

function _setC(inp){
  const ref=inp.dataset.ref, max=parseInt(inp.dataset.max)||1;
  let v=parseInt(inp.value)||1;
  if(v<1)v=1; if(v>max)v=max;
  inp.value=v;
  if(_carritoEnvio[ref]) _carritoEnvio[ref].cantidad=v;
}

function toggleCarrito(ref, checked, idx){
  const p = getProductos()[idx];
  if(!p) return;
  if(checked){
    _carritoEnvio[ref] = { p, cantidad: 1 };
  } else {
    delete _carritoEnvio[ref];
  }
  actualizarCarritoUI();
  renderTabla();
}

function setCantCarrito(ref, val, maxStock){
  if(!_carritoEnvio[ref]) return;
  let cant = parseInt(val) || 1;
  if(cant < 1) cant = 1;
  if(cant > maxStock) cant = maxStock;
  _carritoEnvio[ref].cantidad = cant;
}

function actualizarCarritoUI(){
  const count = Object.keys(_carritoEnvio).length;
  const span = document.getElementById('carritoCount');
  const btn = document.getElementById('btnContinuarEnvio');
  if(span) span.textContent = `${count} producto${count!==1?'s':''} seleccionado${count!==1?'s':''}`;
  if(btn) btn.disabled = count === 0;
}

function abrirResumenEnvio(){
  const items = Object.values(_carritoEnvio);
  if(!items.length){ toast('Selecciona al menos un producto','error'); return; }

  // Build summary HTML
  const resumen = items.map(({p,cantidad})=>`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#F8FAFC;border-radius:8px;margin-bottom:6px;">
      <div><span style="font-family:monospace;font-size:10px;background:#E2E8F0;padding:1px 6px;border-radius:4px;margin-right:6px;">${esc(p.ref)}</span><strong>${esc(p.nombre)}</strong></div>
      <div style="font-weight:700;color:#16A871;">${cantidad} ${p.metrosPorUnidad ? ('rollo'+(cantidad!=1?'s':'')) : (p.unidad==='metros'?'mts.':'uds.')}</div>
    </div>`).join('');

  // Populate resumen modal
  document.getElementById('emResumenItems').innerHTML = resumen;
  document.getElementById('emResumenMotivo').value = '';
  document.getElementById('emResumenAlerta').className = 'alerta';

  // Load sedes
  const sel = document.getElementById('emResumenDestino');
  sel.innerHTML = '';
  getSedesActivas().filter(s=>s.nombre!==sesion.sede).forEach(s=>{
    const o=document.createElement('option');
    o.value=s.nombre; o.textContent=s.nombre;
    sel.appendChild(o);
  });

  document.getElementById('modalEnvioResumen').classList.add('open');
}

async function confirmarEnvioMultiple(){
  const destino = document.getElementById('emResumenDestino').value;
  const motivo  = document.getElementById('emResumenMotivo').value.trim();
  const alerta  = document.getElementById('emResumenAlerta');
  const items   = Object.values(_carritoEnvio);

  alerta.className = 'alerta';
  if(!destino){ alerta.textContent='Selecciona una sede destino.'; alerta.className='alerta error'; return; }
  if(!items.length){ alerta.textContent='No hay productos seleccionados.'; alerta.className='alerta error'; return; }

  // Varios productos: crear UN pedido agrupado (no solicitudes sueltas).
  if(items.length > 1){
    try{
      const itemsAgrup = items.map(({p, cantidad})=>({ref:p.ref, nombre:p.nombre, cantidad: p.metrosPorUnidad ? cantidad * p.metrosPorUnidad : cantidad, unidad:p.unidad||'unidad'}));
      const res = await fetch('api/pedidos_agrupados.php?action=crear',{
        method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ items:itemsAgrup, destino, nota: motivo || `Envío de material desde ${sesion.sede}` })
      });
      const data = await res.json();
      if(!res.ok||data.error) throw new Error(data.error||'Error');
      cerrarModal('modalEnvioResumen');
      cancelarModoEnvio();
      await Promise.all([_recargarSolicitudes(), _recargarPedidosAgrupados&&_recargarPedidosAgrupados()]);
      renderStats(); updateNotifBadges();
      toast(`Pedido agrupado enviado — ${items.length} productos ✓`,'success');
    }catch(e){ alerta.textContent=e.message||'Error al enviar.'; alerta.className='alerta error'; }
    return;
  }

  // Send one solicitud per product
  let errores = 0;
  for(const {p, cantidad} of items){
    try{
      const cantFinal = p.metrosPorUnidad ? cantidad * p.metrosPorUnidad : cantidad;
      const res = await _api('solicitudes','crear',{
        ref: p.ref, nombre: p.nombre, destino,
        cantidad: cantFinal, unidadEnvio: p.unidad||'unidad',
        nota: motivo || `Envío de material desde ${sesion.sede}`,
        origen_pedido_id: null
      });
      if(res.error) errores++;
    }catch(e){ errores++; }
  }

  cerrarModal('modalEnvioResumen');
  cancelarModoEnvio();
  await _recargarSolicitudes();
  renderStats(); updateNotifBadges();
  if(errores===0) toast(`${items.length} solicitud${items.length>1?'es':''} enviada${items.length>1?'s':''} al superadmin ✓`,'success');
  else toast(`${items.length-errores} enviadas, ${errores} con error`,'warn');
}

function abrirEnvioMaterial(idx){
  _emIndex = idx;
  const p = getProductos()[idx]; if(!p) return;
  const sufijo = p.unidad==='metros'?'mts.':'uds.';
  const miStock = p.stockUsuario || 0;

  document.getElementById('emProducto').value = `${p.ref} — ${p.nombre}`;
  document.getElementById('emStockPropio').value = `${miStock} ${sufijo}`;
  document.getElementById('emCantidad').value = '';
  document.getElementById('emCantidad').max = miStock;
  document.getElementById('emMotivo').value = '';
  document.getElementById('envioMaterialAlerta').className = 'alerta';

  // Cargar sedes destino (todas menos la propia)
  const sel = document.getElementById('emDestino');
  sel.innerHTML = '';
  getSedesActivas()
    .filter(s => s.nombre !== sesion.sede)
    .forEach(s => {
      const o = document.createElement('option');
      o.value = s.nombre; o.textContent = s.nombre;
      sel.appendChild(o);
    });

  document.getElementById('modalEnvioMaterial').classList.add('open');
}

async function confirmarEnvioMaterial(){
  const p       = getProductos()[_emIndex]; if(!p) return;
  const cant    = parseInt(document.getElementById('emCantidad').value);
  const destino = document.getElementById('emDestino').value;
  const motivo  = document.getElementById('emMotivo').value.trim();
  const alerta  = document.getElementById('envioMaterialAlerta');
  const miStock = p.stockUsuario || 0;

  alerta.className = 'alerta';
  if(!cant||cant<1){ alerta.textContent='Ingresa una cantidad válida.'; alerta.className='alerta error'; return; }
  if(cant > miStock){ alerta.textContent=`No puedes enviar más de tu stock disponible (${miStock}).`; alerta.className='alerta error'; return; }
  if(!destino){ alerta.textContent='Selecciona una sede destino.'; alerta.className='alerta error'; return; }

  try{
    const res = await _api('solicitudes','crear',{
      ref: p.ref, nombre: p.nombre, destino,
      cantidad: cant, unidadEnvio: p.unidad||'unidad',
      nota: motivo || `Envío de material desde ${sesion.sede}`,
      origen: 'sub_distribuidor'
    });
    if(res.error){ alerta.textContent=res.error; alerta.className='alerta error'; return; }
    cerrarModal('modalEnvioMaterial');
    await _recargarSolicitudes();
    renderStats(); updateNotifBadges();
    toast('Solicitud de envío enviada al superadmin ✓','success');
  }catch(e){
    alerta.textContent='Error al enviar la solicitud.';
    alerta.className='alerta error';
  }
}

// ── Menú de acciones de usuario ──────────────────────
function cerrarMenusUsuario(){
  document.querySelectorAll('[data-usermenu]').forEach(m=>m.style.display='none');
}
function abrirMenuUsuario(uid, btn){
  cerrarMenusUsuario();
  const menu = document.getElementById(uid);
  if(!menu) return;
  const r = btn.getBoundingClientRect();
  menu.style.display = 'block';
  // Posicionar debajo del botón, alineado a la derecha
  const menuW = 175;
  let left = r.right - menuW;
  let top  = r.bottom + 6;
  // Si se sale por abajo, abrir hacia arriba
  if(top + 200 > window.innerHeight) top = r.top - 210;
  if(left < 8) left = 8;
  menu.style.top  = top  + 'px';
  menu.style.left = left + 'px';
}
document.addEventListener('click', function(e){
  if(!e.target.closest('[data-menu]')) cerrarMenusUsuario();
  // Cerrar popovers de producto en historial
  if(!e.target.closest('.hist-pop') && !e.target.closest('span[onclick*="pop_"]'))
    document.querySelectorAll('.hist-pop').forEach(p=>p.style.display='none');
});

function abrirCambiarRol(usuario, rolActual){
  document.getElementById('cambiarRolUsuario').value = usuario;
  document.getElementById('cambiarRolSelect').value = rolActual || 'municipio';
  document.getElementById('cambiarRolDesc').textContent = 'Usuario: ' + usuario + ' — Rol actual: ' + (rolActual || '—');
  document.getElementById('modalCambiarRol').classList.add('open');
}

async function confirmarCambiarRol(){
  const usuario = document.getElementById('cambiarRolUsuario').value;
  const rol     = document.getElementById('cambiarRolSelect').value;
  try{
    const res = await fetch(`${API}/usuarios.php?action=cambiar_rol`,{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ usuario, rol })
    });
    const data = await res.json();
    if(data.error){ toast(data.error,'error'); return; }
    document.getElementById('modalCambiarRol').classList.remove('open');
    await _recargarUsuarios(); renderUsuarios();
    toast(`Rol de ${usuario} cambiado a ${rol} ✓`,'success');
  }catch(e){ toast('Error al cambiar rol','error'); }
}

function abrirAprobarConRol(usuario){
  document.getElementById('aprobarRolUsuario').value = usuario;
  // Preseleccionar el rol que solicitó al registrarse
  const u = getUsuarios().find(u=>u.usuario===usuario);
  const rolSolicitado = u?.rol || u?.tipo || 'municipio';
  document.getElementById('aprobarRolSelect').value = rolSolicitado;
  document.getElementById('modalAprobarRol').classList.add('open');
}

async function confirmarAprobarConRol(){
  const usuario = document.getElementById('aprobarRolUsuario').value;
  const rol     = document.getElementById('aprobarRolSelect').value;
  try{
    await fetch(`${API}/usuarios.php?action=aprobar_con_rol`,{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ usuario, rol })
    });
    document.getElementById('modalAprobarRol').classList.remove('open');
    await _recargarUsuarios(); renderUsuarios(); updateNotifBadges();
    toast(`${usuario} aprobado como ${rol} ✓`,'success');
  }catch(e){ toast('Error al aprobar usuario','error'); }
}

async function aprobarUsuario(n){
  try{
    await fetch(`${API}/usuarios.php?action=estado`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:n,estado:'activo'})});
    await _recargarUsuarios();renderUsuarios();updateNotifBadges();toast(`${n} aprobado ✓`,'success');
  }catch(e){toast('Error al aprobar usuario','error');}
}
// Pide "¿Estás seguro?" antes de registrar la llegada/ingreso de algo. Devuelve una
// promesa que se resuelve en true solo si la persona confirma (si cancela, no sigue).
function _confirmarRegistroLlegada(que, detalle){
  return new Promise(resolve=>{
    mostrarConfirmar({
      icono:'📥', color:'#16A871',
      titulo:`¿Registrar ${que}?`,
      desc:`Vas a registrar ${detalle}. Quedará en el inventario del almacén. ¿Estás seguro?`,
      btnTxt:'Sí, registrar', btnColor:'#16A871',
      onConfirmar: ()=>resolve(true)
    });
  });
}

function mostrarConfirmar({icono,color,titulo,desc,btnTxt,btnColor,onConfirmar,requirePassword,withNotes,notesLabel,notesPlaceholder,notesRequired,avisoResponsabilidad}){
  document.getElementById('modalConfirmarIcono').style.background=color+'22';
  document.getElementById('modalConfirmarIcono').innerHTML=`<span style="font-size:24px;">${icono}</span>`;
  document.getElementById('modalConfirmarTitulo').textContent=titulo;
  document.getElementById('modalConfirmarDesc').textContent=desc;
  // Aviso rojo: al recibir material (envío o asignación) queda a cargo de
  // quien confirma — si se daña o se pierde, debe responder por él.
  const avisoResp = document.getElementById('modalConfirmarAvisoResp');
  if(avisoResp) avisoResp.style.display = avisoResponsabilidad ? '' : 'none';
  const passBox = document.getElementById('modalConfirmarPassBox');
  const passInp = document.getElementById('modalConfirmarPass');
  const passErr = document.getElementById('modalConfirmarPassError');
  const notasBox = document.getElementById('modalConfirmarNotasBox');
  const notasInp = document.getElementById('modalConfirmarNotas');
  const notasLbl = document.getElementById('modalConfirmarNotasLabel');
  const notasErr = document.getElementById('modalConfirmarNotasError');
  if(requirePassword){
    passBox.style.display='';
    passInp.value='';
    passErr.style.display='none';
  } else {
    passBox.style.display='none';
  }
  if(withNotes){
    if(notasBox) notasBox.style.display='';
    if(notasInp){ notasInp.value=''; notasInp.placeholder = notesPlaceholder || 'Ej: llegó completo, una caja con golpe, faltó un equipo…'; }
    if(notasLbl) notasLbl.innerHTML = notesLabel || '📝 Notas <span style="color:#94A3B8;font-weight:400;">(opcional)</span>';
    if(notasErr) notasErr.style.display='none';
  } else {
    if(notasBox) notasBox.style.display='none';
  }
  const btn=document.getElementById('modalConfirmarBtn');
  btn.textContent=btnTxt;
  btn.style.background=btnColor;
  btn.style.color='white';
  btn.onclick=async()=>{
    if(withNotes && notesRequired && !(notasInp?.value||'').trim()){
      if(notasErr) notasErr.style.display='block';
      notasInp?.focus();
      return;
    }
    if(requirePassword){
      const pass = passInp.value.trim();
      if(!pass){ passErr.textContent='Ingresa tu contraseña.'; passErr.style.display=''; return; }
      try{
        const r = await fetch('api/auth.php?action=verificar_password',{
          method:'POST', credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({password: pass})
        });
        const d = await r.json();
        if(d.error||!d.ok){ passErr.textContent='Contraseña incorrecta.'; passErr.style.display=''; passInp.value=''; passInp.focus(); return; }
      }catch(e){ passErr.textContent='Error al verificar.'; passErr.style.display=''; return; }
    }
    cerrarModal('modalConfirmar');
    onConfirmar(withNotes ? (notasInp?.value||'').trim() : undefined);
  };
  document.getElementById('modalConfirmar').classList.add('open');
  if(requirePassword) setTimeout(()=>passInp.focus(), 200);
}

async function desactivarUsuario(n){
  mostrarConfirmar({
    icono:'⛔',color:'#E24B4A',
    titulo:`Desactivar cuenta`,
    desc:`¿Desactivar la cuenta de "${n}"? El usuario no podrá iniciar sesión. Podrás reactivarla cuando quieras.`,
    btnTxt:'Desactivar',btnColor:'#E24B4A',
    onConfirmar: async()=>{
      try{
        await fetch(`${API}/usuarios.php?action=estado`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:n,estado:'inactivo'})});
        await _recargarUsuarios();
        renderUsuarios();renderOficinas();renderTecnicosPersonas('tecnico');renderTecnicosPersonas('persona');
        cerrarModal('modalSede');
        toast(`Cuenta de "${n}" desactivada`,'warn');
      }catch(e){toast('Error al desactivar','error');}
    }
  });
}
async function reactivarUsuario(n){
  try{
    await fetch(`${API}/usuarios.php?action=estado`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:n,estado:'activo'})});
    await _recargarUsuarios();
    // Refrescar ambos paneles siempre
    renderUsuarios();
    renderOficinas();
    renderTecnicosPersonas('tecnico');
    renderTecnicosPersonas('persona');
    cerrarModal('modalSede');
    toast(`Cuenta de "${n}" reactivada ✓`,'success');
  }catch(e){toast('Error al reactivar','error');}
}
async function rechazarUsuario(n){
  // Solicitud pendiente: la cuenta aún no existe, solo se rechaza (no es eliminar, no pide contraseña).
  mostrarConfirmar({
    icono:'❌', color:'#E24B4A',
    titulo:'Rechazar solicitud',
    desc:`¿Rechazar la solicitud de acceso de "${n}"? No se creará la cuenta.`,
    btnTxt:'Sí, rechazar', btnColor:'#B91C1C',
    onConfirmar: async()=>{
      try{
        const res = await fetch(`${API}/usuarios.php?action=rechazar`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:n})});
        const d = await res.json().catch(()=>({}));
        if(!res.ok || d.error){ toast(d.error || 'No se pudo rechazar','error'); return; }
        await _recargarUsuarios();
        renderUsuarios();renderOficinas();updateNotifBadges();
        toast(`Solicitud de "${n}" rechazada.`,'success');
      }catch(e){toast('Error al rechazar','error');}
    }
  });
}
async function eliminarUsuarioDB(n){
  // Paso 1: ¿tiene material a su nombre? Si sí, no se deja eliminar.
  try{
    const r0 = await fetch(`${API}/usuarios.php?action=material_pendiente&usuario=${encodeURIComponent(n)}`,{credentials:'same-origin'});
    const d0 = await r0.json().catch(()=>({}));
    if(d0 && d0.tiene_material){
      mostrarConfirmar({
        icono:'📦', color:'#D97706',
        titulo:'No se puede eliminar',
        desc:`"${n}" todavía tiene ${(d0.pendientes||[]).join(', ')} a su nombre. Primero debe devolver ese material al almacén (o reasignarlo) y después podrás eliminar la cuenta.`,
        btnTxt:'Entendido', btnColor:'#D97706',
        onConfirmar: ()=>{}
      });
      return;
    }
  }catch(e){ /* si falla la consulta, el servidor vuelve a validar al eliminar */ }
  // Paso 2: confirmación + contraseña de quien elimina.
  mostrarConfirmar({
    icono:'🗑️', color:'#E24B4A',
    titulo:'Eliminar cuenta',
    desc:`¿Estás seguro de eliminar la cuenta "${n}"? Esta acción no se puede deshacer. Escribe tu contraseña para confirmar.`,
    btnTxt:'Sí, eliminar', btnColor:'#B91C1C',
    requirePassword:true,
    onConfirmar: async()=>{
      const pw = (document.getElementById('modalConfirmarPass')||{}).value||'';
      try{
        const res = await fetch(`${API}/usuarios.php?action=eliminar`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:n,password:pw})});
        const d = await res.json().catch(()=>({}));
        const pi=document.getElementById('modalConfirmarPass'); if(pi) pi.value='';
        if(!res.ok || d.error){
          if(d.tiene_material){
            mostrarConfirmar({
              icono:'📦', color:'#D97706',
              titulo:'No se puede eliminar',
              desc: d.error,
              btnTxt:'Entendido', btnColor:'#D97706',
              onConfirmar: ()=>{}
            });
          } else {
            toast(d.error || 'No se pudo eliminar','error');
          }
          return;
        }
        await _recargarUsuarios();
        renderUsuarios();renderOficinas();updateNotifBadges();
        toast(`Cuenta "${n}" eliminada.`,'success');
      }catch(e){toast('Error al eliminar','error');}
    }
  });
}
// ── Respaldo de seguridad ──
async function _cargarInfoRespaldo(){
  const box = document.getElementById('respaldoInfo');
  if(!box) return;
  box.textContent = 'Cargando información de la base de datos…';
  try{
    const res = await fetch(`${API}/backup.php?action=info`,{credentials:'same-origin'});
    const d = await res.json();
    if(d.ok){
      box.innerHTML = `Tu base de datos tiene <strong>${d.registros.toLocaleString('es')}</strong> registros en <strong>${d.tablas}</strong> tablas. Última verificación: ${d.fecha}.`;
    }else{
      box.textContent = 'No se pudo leer la información de la base de datos.';
    }
  }catch(e){ box.textContent = 'No se pudo conectar para leer la base de datos.'; }
}

async function _cargarRespaldosAuto(){
  const box = document.getElementById('listaRespaldosAuto');
  if(!box) return;
  box.textContent = 'Cargando…';
  try{
    const res = await fetch(`${API}/backup.php?action=listar_auto`,{credentials:'same-origin'});
    const d = await res.json();
    if(!d.ok){ box.textContent = 'No se pudo cargar la lista.'; return; }
    if(!d.respaldos.length){
      box.innerHTML = `<div style="color:#94A3B8;">Todavía no hay respaldos automáticos — se generará el primero cuando programes la tarea (ver arriba).</div>`;
      return;
    }
    box.innerHTML = d.respaldos.map(r=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;margin-bottom:6px;">
        <span>📅 ${new Date(r.fecha).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'})} <span style="color:#94A3B8;font-size:11px;">(${r.tamano_mb} MB)</span></span>
        <button onclick="window.open('${API}/backup.php?action=descargar_auto&nombre=${encodeURIComponent(r.nombre)}','_blank')" class="btn-sm" style="background:#DBEAFE;color:#1E40AF;">⬇ Descargar</button>
      </div>`).join('');
  }catch(e){ box.textContent = 'No se pudo conectar.'; }
}
async function descargarRespaldo(tipo){
  const btnId = tipo==='full' ? 'btnRespaldoFull' : 'btnRespaldoDb';
  const btn = document.getElementById(btnId);
  const txtOriginal = btn ? btn.textContent : '';
  if(btn){ btn.disabled=true; btn.style.opacity='0.6'; btn.textContent = tipo==='full' ? 'Generando .zip… (puede tardar)' : 'Generando…'; }
  try{
    // Descargar vía fetch para poder detectar errores (si el backend devuelve JSON de error).
    const res = await fetch(`${API}/backup.php?action=${tipo}`,{credentials:'same-origin'});
    const ct = res.headers.get('Content-Type')||'';
    if(!res.ok || ct.includes('application/json')){
      const d = await res.json().catch(()=>({error:'Error desconocido'}));
      throw new Error(d.error || 'No se pudo generar el respaldo');
    }
    // Es un archivo: forzar la descarga.
    const blob = await res.blob();
    const disp = res.headers.get('Content-Disposition')||'';
    const m = disp.match(/filename="([^"]+)"/);
    const nombre = m ? m[1] : (tipo==='full'?'backup_completo.zip':'backup.sql');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast('Respaldo descargado ✓ Guárdalo en un lugar seguro.','success');
  }catch(e){
    toast('Error: '+e.message,'error');
  }finally{
    if(btn){ btn.disabled=false; btn.style.opacity='1'; btn.textContent=txtOriginal; }
  }
}

async function asignarPermisos(nombre,perms){
  try{
    await fetch(`${API}/usuarios.php?action=permisos`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({usuario:nombre,permisos:perms})});
    await _recargarUsuarios();return true;
  }catch(e){return false;}
}


/* ── Mapas sin depender de internet ──
   Los mapas (Leaflet) ahora viven dentro del sistema. Solo el "dibujo" de calles
   (tiles) viene de internet; si no carga, el mapa sigue funcionando con fondo liso
   y los marcadores/coordenadas siguen sirviendo. Para usar un servidor propio de
   tiles, define window.MAPA_TILES_URL antes de cargar los módulos. */
/* ── Nombres completos: en pedidos/seguimiento/historial se muestra "Nombre Apellido" en vez del usuario ── */
window._NOMBRES_USR = window._NOMBRES_USR || {};
function cargarNombresUsuarios(){
  try{
    fetch('api/usuarios.php?action=nombres_usuarios',{credentials:'same-origin'})
      .then(r=>r.ok?r.json():{}).then(d=>{ if(d && !d.error) window._NOMBRES_USR = d; }).catch(()=>{});
  }catch(e){}
}
function nombreUsr(u){
  if(u==null || u==='') return '';
  u = String(u);
  if(u.startsWith('EXT:')) return u.slice(4);
  return (window._NOMBRES_USR && window._NOMBRES_USR[u]) || u;
}
cargarNombresUsuarios(); // se carga al abrir el panel (la sesión ya existe)
/* igual que esc() pero con el nombre completo */
function escU(u){ return esc(nombreUsr(u)); }

function agregarCapaBaseMapa(mapa){
  const url = window.MAPA_TILES_URL || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  try{
    mapa.getContainer().style.background = '#E8EEF4';
    L.tileLayer(url, {attribution:'&copy; OpenStreetMap', maxZoom:19, errorTileUrl:''}).addTo(mapa);
  }catch(e){}
}
/* fetch con tiempo límite, para que un servicio externo caído no deje colgada la pantalla */
function fetchConTiempo(url, opciones, ms){
  const c = new AbortController(); const t = setTimeout(()=>c.abort(), ms||5000);
  return fetch(url, Object.assign({}, opciones||{}, {signal:c.signal})).finally(()=>clearTimeout(t));
}