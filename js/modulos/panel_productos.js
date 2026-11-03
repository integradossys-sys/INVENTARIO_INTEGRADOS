/* ════════════════════════════════════════════════
   NAVEGACIÓN
════════════════════════════════════════════════ */
const panelMeta={
  ventaspend:{titulo:"Ventas",desc:"Aprobación de ventas y a quién se le vendió"},
  resumen:{titulo:"Resumen",desc:"Vista general del sistema"},
  productos:{titulo:"Productos en stock",desc:"Gestiona el inventario de productos"},
  proveedores:{titulo:"Proveedores",desc:"Gestiona los proveedores de productos"},
  compras:{titulo:"Solicitudes de compra",desc:"Pide que se compre material, incluso productos que aún no están registrados"},
  historial:{titulo:"Historial",desc:"Registro de todos los movimientos"},
  proyectos:{titulo:"Proyectos / Clientes",desc:"Todo lo gastado en cada trabajo, sin importar quién lo hizo"},
  mapa:{titulo:"Mapa de actividad",desc:"Gastos e instalaciones con ubicación GPS"},
  seguimiento:{titulo:"Seguimiento",desc:"Estado de tus envíos en camino"},
  solicitudes:{titulo:"Solicitudes pendientes",desc:"Aprueba o rechaza solicitudes de envío"},
  missolicitudes:{titulo:"Mis solicitudes",desc:"Solicitudes que enviaste al superadmin"},
  pedidosmun:{titulo:"Solicitudes y pedidos",desc:"Todo lo que han solicitado — de distribuidor, municipios, técnicos y personas"},
  mispedidos:{titulo:"Mis pedidos al almacén",desc:"Seguimiento de tus pedidos al centro"},
  usuarios:{titulo:"Gestión de usuarios",desc:"Administra cuentas, tipos y permisos"},
  auditoria:{titulo:"Auditoría",desc:"Registro de acciones del sistema"},
  recogidoadmin:{titulo:"Material recogido",desc:"Reutilizable y dañado recogido por todos los usuarios"},
  oficinas:{titulo:"Gestión de oficinas",desc:"Administra sedes y dependencias"},
  misequipos:{titulo:"Mis equipos",desc:"ONTs y carretes de fibra asignados a tu sede"},
  sst:{titulo:"SST — Seguridad y Salud",desc:"Cascos, escaleras, eslingas, herramientas: inventario, entregas e inspecciones"},
  escaneo: {titulo:"Ingreso de equipos/FO",desc:"Escanea equipos para registrarlos en el inventario"},
  respaldo: {titulo:"Respaldo de seguridad",desc:"Descarga copias de seguridad de tus datos y archivos"}
};
function goPanel(id){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  const el=document.getElementById('panel-'+id);if(el)el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  const nb=document.getElementById('nav-'+id);if(nb)nb.classList.add('active');
  const meta=panelMeta[id]||{};setText('topbarTitulo',meta.titulo||id);setText('topbarDesc',meta.desc||'');
  closeSidebar();
  switch(id){
    case'resumen':
      Promise.all([_recargarProductos(),_recargarSolicitudes(),_recargarPedidos(),_recargarPedidosAgrupados()]).then(()=>{
        renderStats(); checkAlertaStockMin();
        if(typeof window.renderGraficas==='function') setTimeout(window.renderGraficas,120);
        updateNotifBadges();
      });
      break;
    case'productos':
      _recargarProductos().then(()=>{ renderTabla(); checkAlertaStockMin(); });
      cargarCategoriasFibra().catch(()=>{});
      (async()=>{ if(!(_modelosOnt&&_modelosOnt.length)) await cargarModelosOnt().catch(()=>{}); await cargarOntStockParaProductos().catch(()=>{}); })();
      {const btnEnvio=document.getElementById('btnModoEnvio');
      if(btnEnvio) btnEnvio.style.display='none';}
      break;
    case'proveedores':
      cargarProveedores().then(()=>renderPanelProveedores());
      break;
    case'compras':
      _recargarProductos().catch(()=>{}).then(()=>cargarCompras());
      break;
    case'historial':
      _histPagina=1;
      Promise.all([_recargarPedidos()]).then(()=>cargarHistorialPaginado(1));
      break;
    case'proyectos':
      cargarPanelProyectos();
      break;
    case'mapa':
      cargarMapaActividad();
      break;
    case'solicitudes':
      Promise.all([_recargarSolicitudes(),_recargarPedidosAgrupados()]).then(()=>renderSolicitudes());
      break;
    case'missolicitudes':
      Promise.all([_recargarSolicitudes(),_recargarPedidosAgrupados(),_recargarPedidos()]).then(()=>{
        renderMisSolicitudes();
      });
      break;
    case'pedidosmun':
      Promise.all([_recargarPedidos(),_recargarSolicitudes()]).then(()=>renderSolicitudesMunicipio());
      break;
    case'ventaspend': cargarVentasPend(); break;
    case'seguimiento':
      _recargarSeguimiento().then(()=>renderSeguimiento());
      break;
    case'mispedidos':
      Promise.all([_recargarPedidos(),_recargarPedidosAgrupados()]).then(()=>renderMisPedidos());
      break;
    case'usuarios':
      _recargarUsuarios().then(()=>renderUsuarios());
      break;
    case'oficinas': setTabOficinas('sedes'); break;
    case'misequipos': iniciarMisEquipos(); break;
    case'sst': iniciarSST(); break;
    case'escaneo': iniciarPanelEscaneo(); break;
    case'auditoria': _audPagina=1; renderAuditoria(1); _cargarResumenAuditoria(); break;
    case'recogidoadmin': cargarRecogidoAdmin(); break;
    case'informes': cargarInformes(); break;
    case'respaldo': _cargarInfoRespaldo(); _cargarRespaldosAuto(); break;
  }
}
function toggleSidebar(){document.getElementById('sidebar').classList.toggle('open');document.getElementById('overlay').classList.toggle('open');}
function closeSidebar(){document.getElementById('sidebar').classList.remove('open');document.getElementById('overlay').classList.remove('open');}

/* ════════════════════════════════════════════════
   INIT — carga datos desde PHP
════════════════════════════════════════════════ */
async function init(){
  // Verificar sesión
  const raw=sessionStorage.getItem(KEY_SESION);
  if(!raw){
    // Intentar recuperar sesión del servidor
    try{
      const s=await _api('auth','sesion');
      if(s.ok){sessionStorage.setItem(KEY_SESION,JSON.stringify(s));sesion=s;}
      else{location.href="index.html";return;}
    }catch{location.href="index.html";return;}
  } else {
    try{sesion=JSON.parse(raw);}catch{location.href="index.html";return;}
    // Verificar que la sesión sigue válida en el servidor (por si fue desactivada)
    try{
      const check=await fetch('api/auth.php?action=sesion',{credentials:'same-origin'});
      const cd=await check.json();
      if(!cd.ok){
        sessionStorage.removeItem(KEY_SESION);
        location.href='index.html';
        return;
      }
      // Refrescar con los datos actuales del servidor (permisos pueden
      // haber cambiado desde que se inició sesión) — antes esto solo
      // confirmaba que la sesión seguía activa, sin traer lo nuevo.
      sesion = cd;
      sessionStorage.setItem(KEY_SESION, JSON.stringify(cd));
    }catch{}
  }

  const rol=sesion.rol;

  // UI básica inmediata
  const avatarColors={superadmin:"#2DB82D",distribuidor:"#16A871",municipio:"#BA7517",tecnico:"#7C3AED",persona:"#0F766E"};
  const color=avatarColors[rol]||"#64748B";
  const emojiRol={superadmin:'👑',distribuidor:'🏢',municipio:'🏛️',tecnico:'🔧',persona:'👤'};
  const avatarEmoji = emojiRol[rol] || '👤';
  const sbAv=document.getElementById('sbAvatar');
  if(sbAv){sbAv.textContent=avatarEmoji;sbAv.style.background=color;sbAv.style.fontSize='18px';}
  const nombreMostrar=sesion.nombre?`${sesion.nombre} ${sesion.apellido||''}`.trim():sesion.usuario;
  setText('sbNombre',nombreMostrar);
  setText('sbSede',sesion.sedes?.length>1?`${sesion.sedes.length} sedes`:sesion.sede);
  const uiAv=document.getElementById('uiAvatar');
  if(uiAv){uiAv.textContent=avatarEmoji;uiAv.style.background=color;uiAv.style.fontSize='18px';}
  const pillData={superadmin:{label:"Superadmin",bg:"#E8F8E8",c:"#1E8F1E"},distribuidor:{label:"Distribuidor",bg:"#EAF3DE",c:"#166534"},municipio:{label:"Municipio",bg:"#FAEEDA",c:"#92400E"},tecnico:{label:"Técnico",bg:"#EDE9FE",c:"#5B21B6"},persona:{label:"Personal",bg:"#CCFBF1",c:"#0F766E"}};
  const pd=pillData[rol]||{label:rol,bg:"#F1F5F9",c:"#475569"};
  const pill=document.getElementById('topbarPill');
  if(pill){pill.textContent=pd.label;pill.style.background=pd.bg;pill.style.color=pd.c;}
  const subtitles={superadmin:"Control total del sistema de inventario.",distribuidor:"Gestiona stock y atiende pedidos de municipios.",municipio:`Inventario y pedidos de ${sesion.sede}.`,tecnico:`Técnico — operando en ${(sesion.sedes||[]).join(', ')}.`,persona:`Personal — ${sesion.cargo||'Acceso general'}.`};
  setText('resumeSubtitle',subtitles[rol]||"");

  // Navegación 100% basada en permisos — cualquier usuario con el permiso ve la sección
  const mostrar=id=>{const b=document.getElementById('nav-'+id);if(b)b.style.display='';};
  const secAdmin=()=>{
    const sa=document.getElementById('sec-admin');if(sa)sa.style.display='';
    const sr=document.getElementById('sec-reportes');if(sr)sr.style.display='';
    const ss=document.getElementById('sec-sistema');if(ss)ss.style.display='';
  };

  // Siempre visible
  try {
  mostrar('resumen');mostrar('historial');mostrar('ventaspend');

  // Estos 2 se configuran primero a propósito — son los que más se
  // reportaron como "no me salen", así que van antes de cualquier otra
  // línea que pudiera fallar y detener el resto del bloque.
  if((tienePermiso('crear_solicitudes')||tienePermiso('enviar_material')||rol==='persona'||rol==='municipio'||rol==='tecnico')&&rol!=='superadmin'&&rol!=='distribuidor') mostrar('missolicitudes');
  if(rol==='municipio'||rol==='tecnico'||rol==='persona') mostrar('misequipos');

  // Mapa de actividad — solo superadmin o quien tenga el permiso asignado
  if(rol==='superadmin'||rol==='distribuidor'||tienePermiso('ver_mapa_actividad')) mostrar('mapa');
  if(rol==='superadmin'||tienePermiso('ver_inventario')) mostrar('productos');
  // SST — superadmin, distribuidor o quien tenga "Gestionar SST"
  if(rol==='superadmin'||rol==='distribuidor'||tienePermiso('gestionar_sst')){ mostrar('sst'); try{ actualizarBadgeSst(); }catch(e){} }

  // Proveedores — solo superadmin y distribuidor (gestionan el inventario)
  if(rol==='superadmin'||rol==='distribuidor'||tienePermiso('crear_proveedores')||tienePermiso('editar_proveedores')||tienePermiso('eliminar_proveedores')) mostrar('proveedores');
  // Solicitudes de compra — quien pueda solicitarlas o gestionarlas
  if(rol==='superadmin'||tienePermiso('solicitar_compras')||tienePermiso('gestionar_compras')) mostrar('compras');
  if(rol==='superadmin'||tienePermiso('crear_proveedores')){
    const bnp=document.getElementById('btnNuevoProveedor');if(bnp)bnp.style.display='inline-flex';
  }

  // "Solicitudes pendientes" se retiró como pantalla separada — todo
  // vive ahora junto en "Pedidos directos" (renombrada), sin importar
  // si el origen es distribuidor, municipio, técnico o persona.

  // Municipio/técnico/persona ven "Mis pedidos" — nunca la palabra
  // "solicitudes". El distribuidor sigue viendo "Solicitudes gestionadas".
  const lblMisSol = document.getElementById('navMisSolicitudesLabel');
  if(lblMisSol) lblMisSol.textContent = (rol==='municipio'||rol==='tecnico'||rol==='persona') ? 'Mis pedidos' : 'Solicitudes gestionadas';

  // Pedidos directos — distribuidor, superadmin, o cualquiera con el
  // permiso de ver/gestionar O el de aprobar (uno solo de los dos ya
  // alcanza para que le aparezca la pestaña, no hace falta darle ambos).
  if(tienePermiso('gestionar_pedidos')||tienePermiso('aprobar_pedidos')||rol==='superadmin') mostrar('pedidosmun');

  // Ingreso por escaneo — solo superadmin y distribuidor por defecto.
  // Otros roles solo si el admin les asignó el permiso manualmente
  // (municipio/tecnico/persona tienen registrar_ont en sus permisos de base
  //  para ver sus equipos, pero NO el panel de escaneo/registro — para eso
  //  necesitan el permiso APARTE "registrar_ont_campo", para no confundir
  //  "puede ver sus equipos" con "puede registrar equipo nuevo").
  if(rol==='superadmin'||rol==='distribuidor'){
    mostrar('escaneo'); secAdmin();
  } else if((tienePermiso('registrar_ont')||tienePermiso('gestionar_fibra'))
            && !['municipio','tecnico','persona'].includes(rol)){
    mostrar('escaneo');
  } else if(['municipio','tecnico','persona'].includes(rol) && tienePermiso('registrar_ont_campo')){
    mostrar('escaneo');
  }
  // Formulario de registrar OLT: solo con gestionar_olt / gestionar_equipos (el servidor igual lo exige)
  try{
    const _cardOlt=document.getElementById('oltToggleBtn')?.closest('.pcard');
    if(_cardOlt) _cardOlt.style.display = (rol==='superadmin'||tienePermiso('gestionar_olt')||tienePermiso('gestionar_equipos')) ? '' : 'none';
  }catch(e){}

  // Gestión de usuarios y oficinas
  if(tienePermiso('gestionar_usuarios')||tienePermiso('aprobar_registros')
     ||tienePermiso('editar_usuarios')||tienePermiso('asignar_permisos_usuarios')
     ||tienePermiso('desactivar_usuarios')||tienePermiso('eliminar_usuarios')){
    mostrar('usuarios');secAdmin();
  }
  if(tienePermiso('crear_oficinas')||tienePermiso('desactivar_sedes')||tienePermiso('eliminar_sedes')||tienePermiso('crear_tecnicos')||tienePermiso('crear_personas')){mostrar('oficinas');secAdmin();}
  // Auditoría — solo superadmin (son datos sensibles de toda la actividad del sistema)
  if(rol==='superadmin'){mostrar('auditoria');secAdmin();}
  // Material recogido (vista general) — superadmin y distribuidor, para
  // ver reutilizable/dañado de TODOS los usuarios, no solo lo propio.
  if(rol==='superadmin'||rol==='distribuidor'){mostrar('recogidoadmin');secAdmin();}
  // Informes — superadmin y distribuidor
  if(rol==='superadmin'||rol==='distribuidor'){mostrar('informes');secAdmin();}
  // La pestaña de auditoría por persona, dentro de Informes, es aparte:
  // superadmin siempre, cualquier otro rol solo con el permiso explícito.
  const tabAudPersona = document.getElementById('tabInfAuditoria');
  if(tabAudPersona) tabAudPersona.style.display = (rol==='superadmin'||tienePermiso('auditar_inventario')) ? '' : 'none';
  // Respaldo de seguridad — solo superadmin (datos sensibles)
  if(rol==='superadmin'){mostrar('respaldo');secAdmin();}
  // Mostrar botón de reporte PDF solo para admin/distribuidor
  const btnPdfUsu = document.getElementById('btnPdfUsuarios');
  if(btnPdfUsu && (rol==='superadmin'||rol==='distribuidor')) btnPdfUsu.style.display='flex';

  // Botones en productos
  if(tienePermiso('editar_productos')){
    const b=document.getElementById('btnAdd');if(b)b.style.display='inline-flex';
  }
  if(rol==='superadmin'||tienePermiso('registrar_ingresos')){
    const bi=document.getElementById('btnIngresoStock');if(bi)bi.style.display='inline-flex';
  }
  // Envío múltiple — superadmin siempre, distribuidor solo con el permiso
  if(rol==='superadmin'||(rol==='distribuidor'&&tienePermiso('enviar_multiple'))){
    const bm=document.getElementById('btnEnvioMultiple');if(bm)bm.style.display='inline-flex';
  }
  // Material recogido — cualquiera con inventario personal (a cualquiera le
  // puede llegar algo dañado o recoger algo reutilizable, no solo técnicos)
  if(rol!=='superadmin'){
    const brr=document.getElementById('btnRegistrarRecogido');if(brr)brr.style.display='inline-flex';
  }
  // Pedir múltiple — solo roles que solicitan a la bodega (no superadmin ni distribuidor, que son quienes abastecen)
  if(rol!=='superadmin' && rol!=='distribuidor'){
    const bpm=document.getElementById('btnPedidoMultiple');if(bpm)bpm.style.display='inline-flex';
  }
  // Gastar múltiple — solo roles que de verdad consumen inventario en
  // campo (municipio reparte, no gasta él mismo).
  if(rol==='tecnico'||rol==='persona'){
    const bgm=document.getElementById('btnGastoMultiple');if(bgm)bgm.style.display='inline-flex';
  }
  // Superadmin y distribuidor (con el permiso "enviar_material") también asignan
  // lo que tienen en su inventario personal.
  if(rol==='superadmin'||(rol==='distribuidor'&&tienePermiso('enviar_material'))){
    const bam2=document.getElementById('btnAsignarMultiple');if(bam2)bam2.style.display=(sesion?.rol==='distribuidor'||!_adminPuedeAsignar())?'none':'inline-flex';
  }
  if(rol==='municipio'||rol==='tecnico'||rol==='persona'){
    const bdm=document.getElementById('btnDevolverMultiple');if(bdm)bdm.style.display='inline-flex';
    // "Asignar Multiple" es lo mismo que "Asignar a alguien" pero por lote —
    // para estos 3 roles sale siempre, igual que Pedir/Gastar/Devolver
    // Multiple, sin depender de un permiso aparte.
    const bam=document.getElementById('btnAsignarMultiple');if(bam)bam.style.display=(sesion?.rol==='distribuidor')?'none':'inline-flex';
  }

  // Excel
  if(tienePermiso('ver_reportes')){
    const bEx=document.getElementById('btnExcel');if(bEx)bEx.style.display='inline-flex';
  }
  } catch(errMenu) {
    // Antes, un error en CUALQUIER línea de este bloque (por ejemplo, un
    // elemento que no existía todavía en el DOM) detenía en silencio TODO
    // lo que venía después — dejando el menú a medio configurar sin
    // ningún aviso visible. Ahora se atrapa, se deja constancia en la
    // consola para poder diagnosticarlo, y el resto de init() sigue
    // corriendo con normalidad.
    console.error('[init] Error configurando el menú lateral:', errMenu);
  }

  // Cargar datos desde PHP en paralelo
  await Promise.all([
    _cargarSedes(),
    _recargarProductos(),
    _recargarHistorial(),
    _recargarSolicitudes(),
    _recargarPedidos(),
    _recargarPedidosAgrupados(),
    _recargarSeguimiento(),
    (rol==='superadmin'||rol==='distribuidor'||tienePermiso('gestionar_usuarios'))?_recargarUsuarios():Promise.resolve()
  ]);

  // Poblar selects con sedes reales de la BD
  _poblarFiltroMunicipios();
  _poblarSelectEnvio();

  ['modalProducto','modalEnvio','modalEliminar','modalRechazar','modalPedido','modalGastar','modalOficina','modalPermisos','modalEnvioMultiple','modalCrearCaja','modalEnviarOnt','modalCrearTecnico','modalCrearPersona','modalEditarUsuario','modalEditarSedesTecnico','modalIngresoStock','modalInstalarOnt','modalImportarMikrowisp','modalNuevoOnt','modalTrazaOnt','modalListaModelos','modalRecibirEnvio','modalRegistrarRecogido','modalDistribuirRecogido','modalAsignarOntTecnico','modalDevolverOnt'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.addEventListener('click',e=>{if(e.target===el)cerrarModal(id);});
  });
  document.addEventListener('click',e=>{
    const panel=document.getElementById('panelNotif'),btn=document.getElementById('btnNotif');
    if(panel&&btn&&!panel.contains(e.target)&&!btn.contains(e.target))panel.classList.remove('notif-open');
  });

  goPanel('resumen');
  updateNotifBadges();
  iniciarPollingNotificaciones();
  // graficas se disparan via hook en renderStats
}

function _poblarFiltroMunicipios(){
  const sedes=getSedesMunicipio();
  ['filtroMisSolMunicipio'].forEach(id=>{
    const sel=document.getElementById(id);if(!sel)return;
    const first=sel.options[0]?.text||'Todos';
    sel.innerHTML=`<option value="">${first}</option>`+sedes.map(s=>`<option>${s.nombre}</option>`).join('');
  });
}
let _usuariosDestinoEnvio = [];

function filtrarDestinoEnvio(){
  const q = (document.getElementById('buscarDestinoEnvio')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('listaDestinoEnvio');
  if(!lista) return;
  // Excluir: sí mismo, superadmin, y usuarios de la sede central/sistema (Neiva)
  const sinYo = _usuariosDestinoEnvio.filter(u=>{
    if(u.usuario === sesion.usuario) return false;
    if(u.rol === 'superadmin') return false;
    if(u.rol === 'distribuidor') return false; // distribuidores no reciben, envían
    return true;
  });
  const filtrados = q
    ? sinYo.filter(u=>
        (u.nombre||'').toLowerCase().includes(q)||
        (u.apellido||'').toLowerCase().includes(q)||
        (u.usuario||'').toLowerCase().includes(q)||
        (u.sede||'').toLowerCase().includes(q))
    : sinYo;
  if(!filtrados.length){
    lista.innerHTML='<div style="padding:12px;text-align:center;color:#94A3B8;font-size:13px;">'+(q?'Sin resultados para "'+q+'"':'Sin usuarios disponibles')+'</div>';
  } else {
    lista.innerHTML = filtrados.map(u=>`<div onclick="seleccionarDestinoEnvio('${esc(u.sede||u.usuario)}','${esc((u.nombre||u.usuario)+' '+(u.apellido||''))} @${esc(u.usuario)} · ${esc(u.sede||'')}','${esc(u.usuario)}')" style="padding:10px 14px;cursor:pointer;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'"><div style="font-weight:600;font-size:13px;color:#0F172A;">${esc(u.nombre||u.usuario)} ${esc(u.apellido||'')}</div><div style="font-size:11px;color:#94A3B8;">@${esc(u.usuario)} · ${esc(u.sede||'')} · ${esc(u.rol||'')}</div></div>`).join('');
  }
  lista.style.display='block';
}

function seleccionarDestinoEnvio(valor, etiqueta, usuarioEspecifico){
  document.getElementById('selectSede').value = valor;
  document.getElementById('buscarDestinoEnvio').value = '';
  document.getElementById('listaDestinoEnvio').style.display = 'none';
  const div = document.getElementById('destinoEnvioSeleccionado');
  const span = document.getElementById('destinoEnvioNombre');
  if(div) div.style.display='flex';
  if(span) span.textContent = etiqueta;
  // Se guarda aparte quién específicamente se eligió (no solo su sede),
  // para poder sugerirlo luego como "recoge en persona" al despachar.
  window._envioDestinoUsuarioEspecifico = usuarioEspecifico || null;
}

function limpiarDestinoEnvio(){
  document.getElementById('selectSede').value = '';
  document.getElementById('buscarDestinoEnvio').value = '';
  document.getElementById('listaDestinoEnvio').style.display = 'none';
  const div = document.getElementById('destinoEnvioSeleccionado');
  if(div) div.style.display='none';
  window._envioDestinoUsuarioEspecifico = null;
  document.getElementById('buscarDestinoEnvio')?.focus();
}

function _poblarSelectEnvio(){
  limpiarDestinoEnvio();
  _usuariosDestinoEnvio = [];
  const lista = document.getElementById('listaDestinoEnvio');
  if(lista){ lista.innerHTML='<div style="padding:12px;text-align:center;color:#94A3B8;font-size:13px;">Cargando...</div>'; lista.style.display='block'; }
  fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'})
    .then(r=>r.json())
    .then(usuarios=>{
      const todos = Array.isArray(usuarios) ? usuarios : [];
      // Filtrar desde el origen — solo municipios, técnicos y personas
      _usuariosDestinoEnvio = todos.filter(u=>
        u.rol !== 'superadmin' &&
        u.rol !== 'distribuidor' &&
        u.usuario !== sesion.usuario
      );
      filtrarDestinoEnvio();
    })
    .catch(()=>{ _usuariosDestinoEnvio = []; });
}

/* ════════════════════════════════════════════════
   NOTIFICACIONES — fuente: PHP
════════════════════════════════════════════════ */
const KEY_SNAP="integrados_snap"; // el snapshot de "qué ya vi" sigue local, es solo una optimización — la fuente de verdad real ahora es el backend
let _notifTimer=null;
let _notifCache=[]; // caché en memoria, sincronizado con api/notif_app.php
function getNotificaciones(){return _notifCache;}
async function cargarNotificacionesBackend(){
  try{ _notifCache = await _api('notif_app','listar') || []; }
  catch(e){ /* si falla, se queda con lo que ya tenía en caché */ }
}
function getSnap(){try{return JSON.parse(localStorage.getItem(KEY_SNAP))||{};}catch{return{};}}
function saveSnap(s){localStorage.setItem(KEY_SNAP,JSON.stringify(s));}
async function marcarTodasLeidas(){
  _notifCache.forEach(n=>n.leida=true); _renderPanelNotif(); _actualizarBadge(); // optimista
  try{ await _api('notif_app','marcar_leidas',{}); }catch(e){}
}
async function eliminarNotificacion(id){
  _notifCache = _notifCache.filter(n=>n.id!==id); _renderPanelNotif(); _actualizarBadge(); // optimista
  try{ await _api('notif_app','eliminar',{notif_id:id}); }catch(e){}
}
async function limpiarTodasNotificaciones(){
  _notifCache = []; _renderPanelNotif(); _actualizarBadge(); // optimista
  try{ await _api('notif_app','limpiar',{}); }catch(e){}
}

/* ════════════════════════════════════════════════
   POLLING — actualiza datos del servidor cada 45 seg
   Así los usuarios ven cambios sin recargar la página
════════════════════════════════════════════════ */
let _pollingTimer = null;
let _pollingActivo = false;

async function _pollingActualizar(){
  if(_pollingActivo) return; // evitar doble ejecución
  _pollingActivo = true;
  try {
    await Promise.all([
      _recargarProductos(),
      _recargarSolicitudes(),
      _recargarPedidos(),
      _recargarPedidosAgrupados(),
      _recargarComprasPend(),
    ]);
    // Ventas por aprobar: contador del menú + campana (avisos que crea el servidor)
    try{
      if(typeof _actualizarBadgeVentas==='function') _actualizarBadgeVentas();
      await cargarNotificacionesBackend(); _actualizarBadge(); _renderPanelNotif();
    }catch(e){}
    // Actualizar UI del panel activo solo si no hay ningún modal abierto
    // (evita interrumpir al usuario mientras llena un formulario)
    const hayModalAbierto = document.querySelector('.modal-bg.open') !== null;
    if(!hayModalAbierto){
      const panelActivo = document.querySelector('.panel.active')?.id?.replace('panel-','');
      switch(panelActivo){
        case 'resumen':     renderStats(); checkAlertaStockMin(); break;
        case 'productos':   renderTabla(); break;
        case 'solicitudes': renderSolicitudes(); break;
        case 'pedidosmun':  renderSolicitudesMunicipio(); break;
        case 'missolicitudes': renderMisSolicitudes(); break;
      }
    }
    updateNotifBadges();
    _generarNotificaciones();
    _actualizarBadge();
    _renderPanelNotif();
    _mostrarEstadoConexion(true);
  } catch(e) {
    _mostrarEstadoConexion(false);
  } finally {
    _pollingActivo = false;
  }
}

function _iniciarPolling(){
  if(_pollingTimer) clearInterval(_pollingTimer);
  _pollingTimer = setInterval(_pollingActualizar, 15000); // cada 15 segundos — así un cambio hecho en un dispositivo se ve en los demás casi de inmediato, sin tener que recargar la página
}

function _mostrarEstadoConexion(ok){
  let ind = document.getElementById('_indicadorConexion');
  if(!ind){
    ind = document.createElement('div');
    ind.id = '_indicadorConexion';
    ind.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);padding:8px 18px;border-radius:20px;font-size:12px;font-weight:600;z-index:9999;transition:opacity .4s;pointer-events:none;opacity:0;';
    document.body.appendChild(ind);
  }
  if(!ok){
    ind.textContent = '⚠ Sin conexión — los datos pueden estar desactualizados';
    ind.style.background = '#FEF2F2';
    ind.style.color = '#B91C1C';
    ind.style.border = '1.5px solid #FECACA';
    ind.style.opacity = '1';
  } else {
    // Si estaba en error, mostrar brevemente "Conectado" y ocultar
    if(ind.style.opacity === '1'){
      ind.textContent = '✓ Conectado';
      ind.style.background = '#F0FDF4';
      ind.style.color = '#15803D';
      ind.style.border = '1.5px solid #BBF7D0';
      ind.style.opacity = '1';
      setTimeout(()=>{ ind.style.opacity='0'; }, 2000);
    }
  }
}

async function _generarNotificaciones(){
  if(!sesion)return;
  const ahora=new Date().toISOString();
  const snap=getSnap();
  const notifIds=new Set(getNotificaciones().map(n=>n.id));
  const nuevas=[];
  const push=(id,tipo,titulo,msg,accion,fecha)=>{
    if(!notifIds.has(id)) nuevas.push({id,tipo,titulo,msg,fecha:fecha||ahora,accion});
  };

  /* ─── SUPERADMIN ─────────────────────────────── */
  if(sesion.rol==='superadmin'){
    // Usuarios pendientes
    getUsuarios().forEach(u=>{
      if(u.estado==='pendiente' && snap[`usr_${u.usuario}`]!=='pendiente'){
        push(`notif_usr_${u.usuario}`,'usuario','👤 Nuevo registro pendiente',
          `"${u.usuario}" (${u.sede||u.tipo}) espera aprobación`,'usuarios');
      }
    });
    // Solicitudes de envío pendientes o escaladas — un pedido múltiple
    // (varios productos de una) agrupa sus filas con el mismo
    // pedidoAgrupadoId: se junta en UNA sola notificación (antes salía
    // una por cada producto) y se manda al panel donde ese pedido SÍ se
    // ve. La pantalla "Solicitudes" solo muestra pedidos múltiples
    // originados por un distribuidor (ver renderSolicitudes) — los de
    // municipio/técnico/persona viven en "Pedidos directos"; mandar ahí
    // una notificación de esos a "solicitudes" daba siempre "Sin
    // resultados" al hacer clic.
    const _distribUsersNotif = getUsuarios().filter(u=>u.rol==='distribuidor').map(u=>u.usuario);
    const _esDistribNotif = (u)=> u==='distribuidor' || _distribUsersNotif.includes(u);
    const _gruposSolNotif = {};
    getSolicitudes().forEach(s=>{
      if(!s.pedidoAgrupadoId){
        if(s.estado==='pendiente' && snap[`sol_${s.id}`]!=='pendiente'){
          push(`notif_sol_${s.id}`,'solicitud','📨 Solicitud de envío pendiente',
            `${s.solicitadoPor} solicita ${s.cantidad} de "${s.nombre}" → ${s.destino}`,
            'solicitudes', s.fecha);
        }
        if(s.estado==='en_gestion' && snap[`sol_${s.id}`]!=='en_gestion'){
          push(`notif_sol_gest_${s.id}`,'solicitud','📋 Solicitud escalada por distribuidor',
            `${s.gestionadoPor||s.solicitadoPor} escaló: ${s.cantidad} de "${s.nombre}" → ${s.destino}`,
            'solicitudes', s.fecha);
        }
        return;
      }
      const g = _gruposSolNotif[s.pedidoAgrupadoId] || (_gruposSolNotif[s.pedidoAgrupadoId] = {
        items:[], solicitadoPor:s.solicitadoPor, gestionadoPor:s.gestionadoPor, destino:s.destino, fecha:s.fecha
      });
      g.items.push(s);
      if(s.gestionadoPor) g.gestionadoPor = s.gestionadoPor;
    });
    Object.entries(_gruposSolNotif).forEach(([pagId, g])=>{
      const accionDest = _esDistribNotif(g.solicitadoPor) ? 'solicitudes' : 'pedidosmun';
      const totalItems = g.items.length;
      const plural = totalItems!==1 ? 's' : '';
      const huboPendiente = g.items.some(s=>s.estado==='pendiente');
      const todasPendientesAntes = g.items.every(s=>snap[`sol_${s.id}`]==='pendiente');
      if(huboPendiente && !todasPendientesAntes){
        push(`notif_solgrp_${pagId}_pendiente`,'solicitud','📨 Pedido múltiple pendiente',
          `${g.solicitadoPor} solicita ${totalItems} producto${plural} → ${g.destino}`,
          accionDest, g.fecha);
      }
      const huboGestion = g.items.some(s=>s.estado==='en_gestion');
      const todasGestionAntes = g.items.every(s=>snap[`sol_${s.id}`]==='en_gestion');
      if(huboGestion && !todasGestionAntes){
        push(`notif_solgrp_${pagId}_gestion`,'solicitud','📋 Pedido múltiple escalado por distribuidor',
          `${g.gestionadoPor||g.solicitadoPor} escaló un pedido de ${totalItems} producto${plural} → ${g.destino}`,
          accionDest, g.fecha);
      }
    });
    // Pedidos directos pendientes — superadmin también debe verlos
    getPedidosMun().forEach(p=>{
      if(p.estado==='pendiente' && snap[`ped_${p.id}`]!=='pendiente'){
        push(`notif_ped_mun_${p.id}`,'pedido','🏘 Pedido de municipio pendiente',
          `${p.municipio} solicita ${p.cantidad} de "${p.nombre}"`,
          'pedidosmun', p.fecha);
      }
      if(p.estado==='en_gestion' && snap[`ped_${p.id}`]!=='en_gestion'){
        push(`notif_ped_gest_${p.id}`,'pedido','📋 Pedido escalado para aprobar',
          `${p.municipio} necesita ${p.cantidad} de "${p.nombre}" — requiere tu aprobación`,
          'solicitudes', p.fechaRespuesta||p.fecha);
      }
    });
    // Stock bajo mínimo
    getProductos().forEach(p=>{
      const min=p.stockMinimo||0, stock=_stockCentral(p);
      const esRollosNotif = p.metrosPorUnidad && p.rollosCentral;
      const cantNotif = esRollosNotif ? (p.rollosCentral?.length||0) : stock;
      if(min>0 && cantNotif<=min){
        const snapVal=snap[`stock_${p.ref}`];
        if(snapVal===undefined || snapVal>min){
          push(`notif_stock_${p.ref}_${cantNotif}`,'stock',
            stock===0?'⛔ Sin stock en almacén':'⚠️ Stock bajo mínimo',
            `"${p.nombre}" → ${cantNotif} ${esRollosNotif?('rollo'+(cantNotif!==1?'s':'')):(p.unidad==='metros'?'mts.':'uds.')} (mín: ${min})`,
            'productos');
        }
      }
    });
  }

  /* ─── DISTRIBUIDOR ───────────────────────────── */
  if(sesion.rol==='distribuidor'){
    // Pedidos nuevos de municipios
    getPedidosMun().forEach(p=>{
      if(p.estado==='pendiente' && snap[`ped_${p.id}`]!=='pendiente'){
        push(`notif_ped_dist_${p.id}`,'pedido','🏘 Nuevo pedido de municipio',
          `${p.municipio} solicita ${p.cantidad} de "${p.nombre}"`,
          'pedidosmun', p.fecha);
      }
    });
    // Respuestas del superadmin a mis solicitudes
    getSolicitudes().forEach(s=>{
      if(s.solicitadoPor===sesion.usuario||s.gestionadoPor===sesion.usuario){
        if(s.estado==='aprobada' && snap[`sol_${s.id}`]!=='aprobada'){
          push(`notif_sol_ap_${s.id}`,'aprobado','✅ Solicitud aprobada por superadmin',
            `${s.cantidad} de "${s.nombre}" → ${s.destino} fue aprobada`,
            'missolicitudes', s.fechaRespuesta||s.fecha);
        }
        if(s.estado==='rechazada' && snap[`sol_${s.id}`]!=='rechazada'){
          push(`notif_sol_re_${s.id}`,'rechazado','❌ Solicitud rechazada por superadmin',
            `"${s.nombre}" → ${s.destino}${s.motivo?` — "${s.motivo}"`:''} fue rechazada`,
            'missolicitudes', s.fechaRespuesta||s.fecha);
        }
      }
    });
    // Stock bajo mínimo
    getProductos().forEach(p=>{
      const min=p.stockMinimo||0, stock=_stockCentral(p);
      const esRollosNotifD = p.metrosPorUnidad && p.rollosCentral;
      const cantNotifD = esRollosNotifD ? (p.rollosCentral?.length||0) : stock;
      if(min>0 && cantNotifD<=min){
        const snapVal=snap[`stock_${p.ref}`];
        if(snapVal===undefined || snapVal>min){
          push(`notif_stock_dist_${p.ref}_${cantNotifD}`,'stock',
            stock===0?'⛔ Sin stock':'⚠️ Stock bajo mínimo',
            `"${p.nombre}" → ${cantNotifD} ${esRollosNotifD?('rollo'+(cantNotifD!==1?'s':'')):(p.unidad==='metros'?'mts.':'uds.')} (mín: ${min})`,
            'productos');
        }
      }
    });
  }

  /* ─── MUNICIPIO / TÉCNICO ────────────────────── */
  if(sesion.rol==='municipio'||sesion.rol==='tecnico'){
    const sedes=sesion.sedes||[sesion.sede];
    getPedidosMun().forEach(p=>{
      if(!(p.solicitado_por===sesion.usuario||sedes.includes(p.municipio)))return;
      const snapEstado=snap[`mipedido_${p.id}`];

      if(p.estado==='en_gestion' && snapEstado!=='en_gestion' && snapEstado!==undefined){
        push(`notif_mip_gest_${p.id}`,'solicitud','⏳ Pedido en gestión',
          `Tu pedido de ${p.cantidad} de "${p.nombre}" está siendo gestionado`,
          'mispedidos', p.fechaRespuesta||p.fecha);
      }
      if(p.estado==='atendido' && snapEstado!=='atendido'){
        push(`notif_mip_ok_${p.id}`,'aprobado','✅ Pedido aprobado',
          `${p.cantidad} de "${p.nombre}" fueron aprobados y están en camino`,
          'mispedidos', p.fechaRespuesta||p.fecha);
      }
      if(p.estado==='rechazado' && snapEstado!=='rechazado'){
        push(`notif_mip_re_${p.id}`,'rechazado','❌ Pedido rechazado',
          `"${p.nombre}"${p.motivo?` — ${p.motivo}`:''}`,
          'mispedidos', p.fechaRespuesta||p.fecha);
      }
    });
    // Notificaciones de solicitudes propias
    getSolicitudes().forEach(s=>{
      if(s.solicitadoPor !== sesion.usuario) return;
      const snapEstado = snap[`sol_${s.id}`];

      if(s.estado==='en_gestion' && snapEstado!=='en_gestion' && snapEstado!==undefined){
        push(`notif_sol_gest_${s.id}`,'solicitud','⏳ Solicitud recibida por distribuidor',
          `Tu solicitud de ${s.cantidad} de "${s.nombre}" está siendo revisada`,
          'missolicitudes', s.fechaRespuesta||s.fecha);
      }
      if(s.estado==='aprobada' && snapEstado!=='aprobada'){
        push(`notif_sol_ok_${s.id}`,'aprobado','✅ Solicitud aprobada',
          `${s.cantidad} de "${s.nombre}" fueron aprobados — el material está en camino`,
          'missolicitudes', s.fechaRespuesta||s.fecha);
      }
      if(s.estado==='rechazada' && snapEstado!=='rechazada'){
        push(`notif_sol_re_${s.id}`,'rechazado','❌ Solicitud rechazada',
          `"${s.nombre}"${s.motivo?` — ${s.motivo}`:''}`,
          'missolicitudes', s.fechaRespuesta||s.fecha);
      }
    });

    // Envíos directos recibidos en mi sede
    getHistorial().forEach(h=>{
      if(!sedes.includes(h.destino)) return;
      if((h._origen==='directo'||h._origen==='aprobado') && !h._esGasto){
        if(snap[`hist_${h.id}`]===undefined){
          push(`notif_hist_${h.id}`,'aprobado','📦 Envío recibido en tu sede',
            `${h.cantidad} de "${h.nombre}" llegaron a ${h.destino}`,
            'historial', h.fecha);
        }
      }
    });
  }

  /* ─── GUARDAR Y MOSTRAR ──────────────────────── */
  // Mis solicitudes de compra aprobadas o rechazadas (recientes) — para quien las pidió
  const _hace7d = Date.now() - 7*24*3600*1000;
  (_comprasMias||[]).forEach(s=>{
    if(s.estado!=='aprobada' && s.estado!=='rechazada') return;
    if(snap[`compra_${s.id}`]===s.estado) return;
    const t = s.gestionadoEn ? new Date(String(s.gestionadoEn).replace(' ','T')).getTime() : 0;
    if(!(t>_hace7d)) return;
    if(s.estado==='aprobada'){
      push(`notif_compra_ok_${s.id}`,'aprobado','✅ Solicitud de compra aprobada',
        `${s.codigo} fue aprobada — se comprará el material`,'compras', s.gestionadoEn);
    } else {
      push(`notif_compra_re_${s.id}`,'rechazado','❌ Solicitud de compra rechazada',
        `${s.codigo}${s.motivoRechazo?` — ${s.motivoRechazo}`:''}`,'compras', s.gestionadoEn);
    }
  });

  if(nuevas.length){
    try{
      const res = await _api('notif_app','push_lote',{notificaciones:nuevas});
      await cargarNotificacionesBackend();
      _actualizarBadge();
      _renderPanelNotif();
      const realmenteNuevas = res?.nuevas?.length || 0;
      const panel=document.getElementById('panelNotif');
      if(realmenteNuevas && !panel?.classList.contains('notif-open'))
        toast(`🔔 ${realmenteNuevas} notificación${realmenteNuevas>1?'es':''} nueva${realmenteNuevas>1?'s':''}`,'warn');
    }catch(e){ /* si falla el backend, no rompemos el resto de la carga de la pantalla */ }
  }

  // Actualizar snapshot
  const nuevoSnap={...snap};
  (_comprasMias||[]).forEach(s=>{ nuevoSnap[`compra_${s.id}`]=s.estado; });
  getSolicitudes().forEach(s=>{ nuevoSnap[`sol_${s.id}`]=s.estado; });
  getPedidosMun().forEach(p=>{
    nuevoSnap[`ped_${p.id}`]=p.estado;
    nuevoSnap[`mipedido_${p.id}`]=p.estado;
  });
  getProductos().forEach(p=>{ nuevoSnap[`stock_${p.ref}`]=_stockCentral(p); });
  getUsuarios().forEach(u=>{ nuevoSnap[`usr_${u.usuario}`]=u.estado; });
  getHistorial().forEach(h=>{ nuevoSnap[`hist_${h.id}`]=h.id; });
  saveSnap(nuevoSnap);
}

function _actualizarBadge(){
  const sinLeer=getNotificaciones().filter(n=>!n.leida).length + _comprasPendCache;
  const badge=document.getElementById('notifBadge'),btn=document.getElementById('btnNotif');
  if(!badge||!btn)return;
  if(sinLeer>0){badge.textContent=sinLeer>99?'99+':sinLeer;badge.style.display='flex';btn.classList.add('notif-pulse');}
  else{badge.style.display='none';btn.classList.remove('notif-pulse');}
}
function _renderPanelNotif(){
  const lista=document.getElementById('notifLista'),empty=document.getElementById('notifEmpty');if(!lista)return;
  let notifs=getNotificaciones();
  // Para municipio/técnico/persona: agregar entradas "en vivo" de ONT
  // pendientes (instalación por confirmar / asignación por aceptar) —
  // no son notificaciones guardadas, reflejan lo pendiente ahora mismo.
  if(sesion.rol==='municipio'||sesion.rol==='tecnico'||sesion.rol==='persona'){
    const extra=[];
    if(_ontPendCache.asignar>0) extra.push({
      id:'ont-asig-live', tipo:'pedido', leida:false,
      titulo:`${_ontPendCache.asignar} ONT por aceptar`,
      msg:'Te asignaron equipos para instalar — entra a "Mis equipos" para aceptarlos o no.',
      fecha:new Date().toISOString(), accion:'misequipos'
    });
    if(_ontPendCache.instalar>0) extra.push({
      id:'ont-inst-live', tipo:'solicitud', leida:false,
      titulo:`${_ontPendCache.instalar} instalación${_ontPendCache.instalar!==1?'es':''} por confirmar`,
      msg:'Alguien dice que instalaste estas ONT — confírmalo en "Mis equipos".',
      fecha:new Date().toISOString(), accion:'misequipos'
    });
    notifs = [...extra, ...notifs];
  }
  // Cambios de estado de OLT/equipo esperando que ESTE usuario confirme
  // si son ciertos — aplica a cualquier rol, porque a cualquiera lo
  // pueden nombrar como "quien confirma".
  if((_confEqPendCache||[]).length>0){
    notifs = [{
      id:'equipo-conf-live', tipo:'solicitud', leida:false,
      titulo:`${_confEqPendCache.length} cambio${_confEqPendCache.length!==1?'s':''} de equipo por confirmar`,
      msg:'Alguien registró un cambio en un OLT/equipo y te nombró para confirmarlo — entra a "Mis equipos".',
      fecha:new Date().toISOString(), accion:'misequipos'
    }, ...notifs];
  }
  // Solicitudes de compra por aprobar (solo quien las gestiona) — entrada "en vivo"
  if(_comprasPendCache>0){
    notifs = [{
      id:'compras-pend-live', tipo:'pedido', leida:false,
      titulo:`🛒 ${_comprasPendCache} solicitud${_comprasPendCache!==1?'es':''} de compra por revisar`,
      msg:'Hay solicitudes de compra pendientes — entra a "Solicitudes de compra" para aprobarlas o rechazarlas.',
      fecha:new Date().toISOString(), accion:'compras'
    }, ...notifs];
  }
  if(!notifs.length){lista.innerHTML='';if(empty)empty.style.display='flex';return;}
  if(empty)empty.style.display='none';
  const iconos={
    stock:    {bg:'#FAEEDA',color:'#BA7517',svg:`<path stroke-linecap="round" d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z"/>`},
    solicitud:{bg:'#E6F1FB',color:'#0C6EDE',svg:`<path stroke-linecap="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/>`},
    aprobado: {bg:'#EAF3DE',color:'#16A871',svg:`<path stroke-linecap="round" d="M5 13l4 4L19 7"/>`},
    rechazado:{bg:'#FCEBEB',color:'#E24B4A',svg:`<path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/>`},
    pedido:   {bg:'#EDE9FE',color:'#7C3AED',svg:`<path stroke-linecap="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>`},
    usuario:  {bg:'#F1F5F9',color:'#475569',svg:`<path stroke-linecap="round" d="M17 20h5v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2h5"/>`}
  };
  lista.innerHTML=notifs.map(n=>{
    const nueva=!n.leida;
    const ic=iconos[n.tipo]||iconos.solicitud;
    const fmtF=(()=>{try{return new Date(n.fecha).toLocaleString('es-CO',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}catch{return '';}})();
    return `<div class="notif-item${nueva?' notif-nueva':''}" onclick="_clickNotif('${n.accion}','${n.id}')">
      <div class="notif-icono" style="background:${ic.bg};"><svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="${ic.color}" stroke-width="2">${ic.svg}</svg></div>
      <div class="notif-body">
        <div class="notif-titulo">${esc(n.titulo)}${nueva?`<span class="notif-dot"></span>`:''}</div>
        <div class="notif-msg" title="${esc(n.msg)}">${esc(n.msg)}</div>
        <div class="notif-fecha">${fmtF}</div>
      </div>
      <button class="notif-close" onclick="event.stopPropagation();eliminarNotificacion('${n.id}')" title="Descartar">
        <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>`;
  }).join('');
}
function _clickNotif(accion,id){eliminarNotificacion(id);togglePanelNotif(false);if(accion)goPanel(accion);}
function togglePanelNotif(forzar){
  const panel=document.getElementById('panelNotif');if(!panel)return;
  const abrir=forzar!==undefined?forzar:!panel.classList.contains('notif-open');
  if(abrir){panel.classList.add('notif-open');marcarTodasLeidas();_renderPanelNotif();}
  else panel.classList.remove('notif-open');
}
async function iniciarPollingNotificaciones(){
  const snap=getSnap();

  // Limpiar del snapshot cosas que siempre deben re-detectarse al cargar:
  // - usuarios pendientes
  // - pedidos pendientes (superadmin y distribuidor deben verlos siempre)
  // - solicitudes pendientes
  Object.keys(snap).forEach(k=>{
    if(k.startsWith('usr_')) delete snap[k];
    if(k.startsWith('ped_') || k.startsWith('mipedido_') || k.startsWith('sol_')) delete snap[k];
  });

  // Pre-llenar solo stock y historial (no generan alertas urgentes al cargar)
  getProductos().forEach(p=>{
    if(snap[`stock_${p.ref}`]===undefined) snap[`stock_${p.ref}`]=_stockCentral(p);
  });
  getHistorial().forEach(h=>{ snap[`hist_${h.id}`]=h.id; });

  // Para municipio/técnico: pre-llenar pedidos YA resueltos (atendido/rechazado)
  // para no re-notificar resoluciones antiguas
  if(sesion.rol==='municipio'||sesion.rol==='tecnico'){
    getPedidosMun().forEach(p=>{
      if(p.estado==='atendido'||p.estado==='rechazado'){
        snap[`mipedido_${p.id}`]=p.estado;
      }
      // pendiente y en_gestion: no pre-llenar → genera notif
    });
    getSolicitudes().forEach(s=>{
      if(s.estado==='aprobada'||s.estado==='rechazada'||s.estado==='en_gestion'){
        snap[`sol_${s.id}`]=s.estado;
      }
    });
  }

  saveSnap(snap);
  await _recargarComprasPend().catch(()=>{});
  await cargarNotificacionesBackend(); // trae lo que ya existe en el servidor antes de detectar novedades
  await _generarNotificaciones(); // ejecutar inmediatamente — detecta pedidos y usuarios pendientes
  _actualizarBadge();
  _renderPanelNotif();
  if(_notifTimer)clearInterval(_notifTimer);
  try{ if(typeof _actualizarBadgeVentas==='function') _actualizarBadgeVentas(); }catch(e){}
  // Arrancar polling de datos (actualiza cada 45 seg en segundo plano)
  _iniciarPolling();
}
function updateNotifBadges(){
  // Solicitudes individuales pendientes
  // Solicitudes del distribuidor pendientes (para badge de Solicitudes pendientes)
  const _distribUsers = getUsuarios().filter(u=>u.rol==='distribuidor').map(u=>u.usuario);
  const _rolesSede = ['municipio','tecnico','persona'];
  const _usrRolMap = Object.fromEntries(getUsuarios().map(u=>[u.usuario,u.rol]));

  const pendSolInd = getSolicitudes().filter(s=>
    !s.pedidoAgrupadoId &&
    (s.estado==='pendiente'||s.estado==='en_gestion') &&
    (_distribUsers.includes(s.solicitadoPor) || s.estado==='en_gestion')
  ).length;

  // Solicitudes pendientes de municipios (excluir distribuidor y superadmin)
  const _noMunUsers = [..._distribUsers, 'superadmin'];
  // Solo contar pendientes que aún no han sido atendidos por el distribuidor
  const pendSolMunicipio = getSolicitudes().filter(s=>
    !s.pedidoAgrupadoId &&
    s.estado==='pendiente' &&
    !_noMunUsers.includes(s.solicitadoPor)
  ).length;
  // Pedidos agrupados pendientes (no en_gestion — esos ya fueron atendidos)
  // Separar pedidos agrupados por quién los creó:
  // - del distribuidor → solicitudes pendientes del superadmin
  // - de municipios → bandeja de pedidos del distribuidor
  const _esAbastecedorBadge = (u)=> u==='superadmin' || u==='distribuidor' || ['distribuidor','superadmin'].includes(_usrRolMap[u]);
  const pendAgrupMun = getPedidosAgrupados().filter(p=>p.estado==='pendiente' && !_esAbastecedorBadge(p.solicitado_por)).length;

  // Pedidos agrupados del distribuidor (pendientes) + escalados (en_gestion) → para el superadmin
  const pendAgrupDistrib = getPedidosAgrupados().filter(p=>
    (p.estado==='pendiente' && _esAbastecedorBadge(p.solicitado_por)) || p.estado==='en_gestion'
  ).length;

  // Pedidos agrupados pendientes (genérico, para el distribuidor: los de municipios)
  const pendAgrup = pendAgrupMun;

  const pendSol = pendSolInd;
  const pendMunTotal = pendAgrup;
  const pendMun = getPedidosMun().filter(p=>p.estado==='pendiente'||p.estado==='en_gestion').length;
  const pendUsr = getUsuarios().filter(u=>u.estado==='pendiente').length;

  // Badge seguimiento — deduplicar por transportador+destino+fecha_envio (pedidos múltiples = 1)
  const seg = _seguimiento || [];
  const _uniqueSeg = (lista) => {
    const vistos = new Set();
    return lista.filter(s => {
      // Agrupar por transportador + destino + fecha_envio truncada al minuto
      const fechaMin = (s.fecha_envio||s.fecha_aprobado||'').slice(0,16);
      const key = `${s.transportador||''}|${s.destino}|${fechaMin}|${s.estado}`;
      if(vistos.has(key)) return false;
      vistos.add(key); return true;
    });
  };
  let pendSeguimiento = 0;
  const rol = sesion?.rol;
  if(rol==='superadmin'||rol==='distribuidor'){
    pendSeguimiento = _uniqueSeg(seg.filter(s=>s.estado==='aprobado'||s.estado==='en_camino')).length;
  } else {
    const sedes = sesion?.sedes||[sesion?.sede];
      // Solo contar en_camino y entregado (no recibido)
    const comoTransp  = _uniqueSeg(seg.filter(s=>['en_camino','entregado'].includes(s.estado)&&s.transportador===sesion?.usuario)).length;
    // Solo contar como destino si NO es también el transportador (evitar
    // doble conteo), Y si esta persona específicamente puede actuar sobre
    // él — si el envío tiene un destinatario específico ("Recoge en
    // persona: X" en las notas), solo cuenta si X es esta misma persona;
    // si no hay nadie específico, cuenta para cualquiera de la sede
    // (igual que hace la tabla de Seguimiento real, para que el contador
    // nunca prometa algo que la tabla después no deja hacer).
    const comoDestino = _uniqueSeg(seg.filter(s=>{
      if(!['en_camino','entregado'].includes(s.estado)) return false;
      if(!sedes.includes(s.destino)) return false;
      if(s.transportador===sesion?.usuario) return false;
      const mDestEspecifico = (s.notas||'').match(/Recoge en persona:\s*(.+)$/m);
      if(mDestEspecifico) return mDestEspecifico[1].trim() === sesion?.usuario;
      return true;
    })).length;
    pendSeguimiento = comoTransp + comoDestino;
  }

  const nb=(id,v)=>{const e=document.getElementById(id);if(e){e.textContent=v||'';e.style.display=v>0?(id==='nbSeguimiento'?'flex':'inline-flex'):'none';}};
  // El badge de "Solicitudes pendientes":
  // - superadmin: cuenta los pedidos agrupados del distribuidor + escalados
  // - distribuidor: cuenta sus solicitudes individuales pendientes
  const agrupParaBadge = sesion.rol==='superadmin' ? pendAgrupDistrib : 0;
  nb('nbSolicitudes',   pendSol + agrupParaBadge);
  nb('nbPedidosMun',    pendSolMunicipio + pendMun + pendAgrupMun);
  nb('nbVentas',        window._ventasPorAprobarN||0);
  nb('nbUsuariosPend',  pendUsr);
  nb('nbSeguimiento',   pendSeguimiento);
  nb('nbCompras',       _comprasPendCache);

  // Badge del campana — total de todo lo pendiente. Se guarda en
  // _badgeBaseTotal porque las confirmaciones de equipo (abajo) y lo
  // pendiente de ONT se cargan aparte (async) y no deben pisar este número,
  // sino sumarse a él — ver _actualizarBadgeNotifTotal.
  _badgeBaseTotal = (sesion.rol==='superadmin'||sesion.rol==='distribuidor')
    ? pendSol + pendMun + pendUsr
    : 0;
  _actualizarBadgeNotifTotal();

  // Cambios de estado de OLT/equipo por confirmar — aplica a cualquier rol,
  // porque a cualquiera lo pueden nombrar como "quien confirma".
  if(typeof cargarConfirmacionesEquipoPendientes==='function') cargarConfirmacionesEquipoPendientes();

  // Para municipio/técnico/persona: instalaciones y asignaciones de ONT
  // pendientes de su respuesta — antes esto no le avisaba a nadie, solo
  // se veía si entraban manualmente a "Mis equipos".
  if(sesion.rol==='municipio'||sesion.rol==='tecnico'||sesion.rol==='persona'){
    _actualizarBadgeOntPendientes();
  }

  const bp=document.getElementById('badgePendUsuarios');
  if(bp){bp.textContent=`${pendUsr} pendientes`;bp.style.display=pendUsr>0?'':'none';}
}
let _ontPendCache = {instalar:0, asignar:0};
let _badgeBaseTotal = 0;
// Suma lo pendiente "de siempre" (solicitudes/pedidos/usuarios, solo
// admin), lo pendiente de ONT (solo municipio/técnico/persona) y las
// confirmaciones de equipo (cualquier rol) en el badge de la campana, sin
// que una sobreescriba lo que puso la otra (todas son async e independientes).
function _actualizarBadgeNotifTotal(){
  const total = _badgeBaseTotal + _ontPendCache.instalar + _ontPendCache.asignar + (_confEqPendCache||[]).length + _comprasPendCache;
  const badge = document.getElementById('notifBadge');
  if(badge){ badge.textContent=total; badge.style.display=total>0?'flex':'none'; }
}
async function _actualizarBadgeOntPendientes(){
  try{
    const [r1,r2] = await Promise.all([
      fetch('api/cajas.php?action=mis_instalaciones_pendientes',{credentials:'same-origin'}).then(r=>r.json()).catch(()=>[]),
      fetch('api/cajas.php?action=mis_asignaciones_pendientes',{credentials:'same-origin'}).then(r=>r.json()).catch(()=>[]),
    ]);
    _ontPendCache.instalar = Array.isArray(r1)?r1.length:0;
    _ontPendCache.asignar  = Array.isArray(r2)?r2.length:0;
  }catch(e){ _ontPendCache = {instalar:0, asignar:0}; }
  _actualizarBadgeNotifTotal();
}

/* ════════════════════════════════════════════════
   ALERTA STOCK MÍNIMO
════════════════════════════════════════════════ */
function checkAlertaStockMin(){
  if(sesion?.rol==='municipio'||sesion?.rol==='tecnico'||sesion?.rol==='persona') return;
  const bajoMin=getProductos().filter(p=>{
    const min=p.stockMinimo||0,stock=_stockCentral(p);
    if(min<=0) return false;
    // Productos por rollo: el mínimo compara contra CANTIDAD DE ROLLOS,
    // no metros — mismo criterio que en la tabla de Productos en stock.
    const cant = (p.metrosPorUnidad && p.rollosCentral) ? (p.rollosCentral.length||0) : stock;
    return cant<=min;
  });
  const alEl=document.getElementById('alertaStockMin'),textoEl=document.getElementById('alertaStockMinTexto');
  if(!alEl||!textoEl)return;
  if(bajoMin.length>0){
    alEl.style.display='flex';
    const refs=bajoMin.map(p=>`<span style="font-family:monospace;background:#fff;border:1px solid #BA7517;padding:1px 7px;border-radius:5px;font-size:12px;">${esc(p.ref)}</span>`).join(' ');
    textoEl.innerHTML=`<strong>⚠ ${bajoMin.length} producto${bajoMin.length>1?'s':''} bajo stock mínimo:</strong> ${refs}<button onclick="goPanel('productos')" style="margin-left:10px;background:#BA7517;color:white;border:none;border-radius:7px;padding:4px 12px;font-size:11px;cursor:pointer;font-weight:700;font-family:inherit;">Ver inventario →</button>`;
  } else {alEl.style.display='none';}
}

/* ════════════════════════════════════════════════
   ACCIONES RÁPIDAS — por permisos reales del usuario
   Aplica a: municipio, tecnico, persona (y cualquier rol
   que no sea superadmin ni distribuidor).
   Cada acción solo aparece si el usuario tiene el permiso.
════════════════════════════════════════════════ */
function _accionesPorPermisos(){
  const productos = getProductos();
  const sedes     = sesion.sedes || [sesion.sede];
  const miStock   = productos.reduce((s,p)=>s+sedes.reduce((a,se)=>a+(p.stock?.[se]||0),0),0);
  const misSols   = getSolicitudes().filter(s=>sedes.includes(s.destino)||s.solicitadoPor===sesion.usuario);
  const pendSols  = misSols.filter(s=>s.estado==='pendiente'||s.estado==='en_gestion').length;
  const totalHist = getHistorial().length;

  const acciones = [];

  // Siempre: ver inventario
  acciones.push({
    icon:'M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z',
    iconColor:'#0C6EDE', iconBg:'#E6F1FB',
    label:'Inventario', val: miStock, panel:'productos'
  });

  // Pedir / solicitar material
  if(tienePermiso('crear_solicitudes')){
    acciones.push({
      icon:'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z',
      iconColor:'#5B21B6', iconBg:'#EDE9FE',
      label:'Mis pedidos', val: pendSols, panel:'missolicitudes'
    });
  }

  // Seguimiento de envíos
  acciones.push({
    icon:'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 8a2 2 0 002 2h8a2 2 0 002-2l1-8',
    iconColor:'#16A871', iconBg:'#EAF3DE',
    label:'Seguimiento', val:'Ver →', panel:'seguimiento'
  });

  // Historial
  if(tienePermiso('ver_historial')){
    acciones.push({
      icon:'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
      iconColor:'#0891B2', iconBg:'#E0F6FF',
      label:'Historial', val: totalHist, panel:'historial'
    });
  }

  // Registrar ONT / escaneo
  if(tienePermiso('registrar_ont')){
    acciones.push({
      icon:'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9',
      iconColor:'#0369A1', iconBg:'#E0F6FF',
      label:'Registrar ONT', val:'Escanear →', panel:'escaneo'
    });
  }

  // Ver mis equipos / ONTs asignados
  if(tienePermiso('ver_mis_equipos')&&!tienePermiso('registrar_ont')){
    acciones.push({
      icon:'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9',
      iconColor:'#0369A1', iconBg:'#E0F6FF',
      label:'Mis equipos', val:'Ver ONTs →', panel:'escaneo'
    });
  }

  // Gestionar fibra
  if(tienePermiso('gestionar_fibra')){
    acciones.push({
      icon:'M13 10V3L4 14h7v7l9-11h-7z',
      iconColor:'#0891B2', iconBg:'#E0F6FF',
      label:'Fibra óptica', val:'Ver saldos →', panel:'escaneo'
    });
  }

  // Registrar gasto
  if(tienePermiso('registrar_gastos')){
    acciones.push({
      icon:'M20 12H4M4 12l4-4M4 12l4 4',
      iconColor:'#BA7517', iconBg:'#FAEEDA',
      label:'Registrar gasto', val:'Gastar →', panel:'productos'
    });
  }

  // Enviar material entre sedes
  if(tienePermiso('enviar_material')){
    acciones.push({
      icon:'M5 10l7-7m0 0l7 7m-7-7v18',
      iconColor:'#16A871', iconBg:'#EAF3DE',
      label:'Enviar material', val:'Enviar →', panel:'productos'
    });
  }

  return acciones;
}

/* ════════════════════════════════════════════════
   ACCIONES RÁPIDAS — helper
   Genera tarjetas idénticas a stat-card.
   { icon, iconColor, iconBg, label, val, panel }
════════════════════════════════════════════════ */
function _buildQA(acciones){
  const t = document.getElementById('qaTitle');
  if(t) t.style.display = acciones.length ? '' : 'none';
  return acciones.map(a=>{
    const color = a.iconColor;
    const hOn  = `this.style.borderColor='${color}';this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,.10)'`;
    const hOut = `this.style.borderColor='#E2E8F0';this.style.transform='translateY(0)';this.style.boxShadow='none'`;
    const fontSize = (typeof a.val==='number'||String(a.val).match(/^\d+$/)) ? '28px' : '20px';
    return `<div class="stat-card" onclick="goPanel('${a.panel}')"
        onmouseover="${hOn}" onmouseout="${hOut}"
        style="cursor:pointer;transition:all .2s ease;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:600;color:#94A3B8;text-transform:uppercase;letter-spacing:.06em;">${a.label}</div>
        <div style="width:32px;height:32px;background:${a.iconBg};border-radius:8px;display:flex;align-items:center;justify-content:center;">
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="${color}" stroke-width="2">
            <path stroke-linecap="round" d="${a.icon}"/>
          </svg>
        </div>
      </div>
      <div style="font-family:Syne,sans-serif;font-weight:800;font-size:${fontSize};color:${color};">${a.val}</div>
    </div>`;
  }).join('');
}

/* ════════════════════════════════════════════════
   STATS
════════════════════════════════════════════════ */
let _oltsStockData = [];
async function cargarOltsStock(){
  try{
    const res = await fetch('api/equipos.php?action=listar_olts',{credentials:'same-origin'});
    const data = await res.json() || [];
    _oltsStockData = Array.isArray(data) ? data.filter(o=>(o.estado||'activo')==='activo') : [];
  }catch{ _oltsStockData=[]; }
  if(document.getElementById('panel-productos')?.classList.contains('active')) renderTabla();
}

// Reutiliza _ontStockMap (ya declarada más abajo, para el carrito de pedidos)
async function cargarOntStockParaProductos(){
  try{
    const res = await fetch('api/cajas.php?action=onts_disponibles_modelo',{credentials:'same-origin'});
    const data = await res.json();
    const esAdmin = sesion?.rol==='superadmin'||sesion?.rol==='distribuidor';
    // Admin/distribuidor ven el almacén central; el resto ve lo que ya es suyo.
    const rows = esAdmin ? (data.almacen||[]) : (data.personal||[]);
    _ontStockMap = {};
    if(Array.isArray(rows)) rows.forEach(r=>{ _ontStockMap[String(r.modelo||'').toLowerCase().trim()] = parseInt(r.cantidad)||0; });
  }catch(e){ _ontStockMap = {}; }
  if(document.getElementById('panel-productos')?.classList.contains('active')) renderTabla();
}

function _filasOntTabla(q){
  const modelos = _modelosOnt||[];
  if(!modelos.length) return '';
  // Solo superadmin puede "Enviar" directo (auto-aprobado) — distribuidor
  // debe pasar por aprobación como todo lo demás, igual que con productos
  // normales (que ya usan "Solicitar" para distribuidor).
  const esSuperadmin = sesion.rol==='superadmin';
  const puedeSolicitar = sesion.rol==='municipio'||sesion.rol==='distribuidor';
  return modelos.filter(m=>!q || m.nombre.toLowerCase().includes(q) || 'ont'.includes(q) || (m.marca||'').toLowerCase().includes(q)).map((m,i)=>{
    const cant = _ontStockMap[String(m.nombre||'').toLowerCase().trim()] || 0;
    const sinStock = esSuperadmin && cant <= 0; // el botón de solicitar no depende de mi stock personal
    let solicBtn;
    if(esSuperadmin || puedeSolicitar){
      const uidO = 'menuOnt_'+i;
      solicBtn = `<button class="![background:#F1F5F9] ![border:1.5px_solid_#E2E8F0] !rounded-[8px] !p-[5px_14px] !cursor-pointer !text-[18px] !text-[#475569] !font-bold !leading-[1]" onclick="event.stopPropagation();abrirMenuUsuario('${uidO}',this)"
          title="Acciones" data-menu="${uidO}">···</button>
        <div id="${uidO}" data-usermenu style="display:none;position:fixed;background:white;border:1.5px solid #E2E8F0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:9999;min-width:170px;padding:4px 0;overflow:hidden;">
          ${esSuperadmin
            ? `<button onclick="cerrarMenusUsuario();abrirEnviarOntDesdeStock('${esc(m.nombre)}',${cant})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#166534;" onmouseover="this.style.background='#F0FDF4'" onmouseout="this.style.background='none'" ${cant<=0?'disabled':''}>📤 Enviar</button>`
            : `<button onclick="cerrarMenusUsuario();abrirSolicitarOntDesdeStock('${esc(m.nombre)}')" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#5B21B6;" onmouseover="this.style.background='#F5F3FF'" onmouseout="this.style.background='none'">📋 Solicitar</button>`}
        </div>`;
    } else {
      solicBtn = `<span class="!text-[11px] !text-[#94A3B8] ![font-style:italic]">Solo tu oficina puede solicitar</span>`;
    }
    return `<tr class="fade-row">
      <td><span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_7px] !rounded-[6px]">ONT</span></td>
      <td class="!font-semibold">📡 ONT ${esc(m.nombre)}${m.marca?` <span class="!font-normal !text-[#94A3B8] !text-[12px]">(${esc(m.marca)})</span>`:''}</td>
      <td><span class="badge badge-brand">Unidad</span></td>
      <td><span class="badge ${sinStock?'badge-danger':'badge-ok'}">${cant} uds.</span>${!esSuperadmin?`<div class="!text-[10px] !text-[#94A3B8] !mt-[2px]">Mi inventario</div>`:''}</td>
      <td><span class="!text-[11px] !text-[#CBD5E1]">—</span></td>
      <td class="!text-[12px] !text-[#CBD5E1]">—</td>
      <td class="!text-[12px] !text-[#94A3B8]">Se despacha eligiendo el serial exacto</td>
      <td>${solicBtn}</td>
    </tr>`;
  }).join('');
}

function _filasOltTabla(q){
  if(!_oltsStockData.length && !q) return '';
  const total = _oltsStockData.length;
  if(q && !'olt'.includes(q)) return '';
  const esAdmin = sesion.rol==='superadmin'||sesion.rol==='distribuidor';
  const sinStock = total <= 0;
  const solicBtn = !esAdmin
    ? `<button onclick="abrirSolicitarEquipoTipo('OLT')" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6]" ${sinStock?'disabled':''}>Solicitar</button>`
    : `<button onclick="goPanel('escaneo');setTimeout(()=>setTabEscaneo('olt'),150);" class="btn-sm ![background:#E6F1FB] !text-[#0A58B5]">Gestionar</button>`;
  return `<tr class="fade-row">
    <td><span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_7px] !rounded-[6px]">OLT</span></td>
    <td class="!font-semibold">🖧 OLT</td>
    <td><span class="badge badge-gray">Unidad</span></td>
    <td><span class="badge ${sinStock?'badge-danger':'badge-ok'}">${total} uds.</span></td>
    <td><span class="!text-[11px] !text-[#CBD5E1]">—</span></td>
    <td class="!text-[12px] !text-[#CBD5E1]">—</td>
    <td class="!text-[12px] !text-[#94A3B8]">Varios modelos</td>
    <td>${solicBtn}</td>
  </tr>`;
}
async function cargarEquiposStock(){
  try{
    const res = await fetch('api/equipos.php?action=listar_equipos_por_tipo',{credentials:'same-origin'});
    _equiposStockData = await res.json() || [];
  }catch{ _equiposStockData=[]; }
  if(document.getElementById('panel-productos')?.classList.contains('active')) renderTabla();
}

function _filasEquiposTabla(q){
  if(!_equiposStockData.length) return '';
  const datos = q
    ? _equiposStockData.filter(t=>t.tipo.toLowerCase().includes(q))
    : _equiposStockData;
  if(!datos.length) return '';
  const esAdmin = sesion.rol==='superadmin'||sesion.rol==='distribuidor';
  return datos.map(t=>{
    const sinStock = t.total <= 0;
    const stockBadge = `<span class="badge ${sinStock?'badge-danger':'badge-ok'}">${t.total} uds.</span>`;
    const solicBtn = !esAdmin
      ? `<button onclick="abrirSolicitarEquipoTipo('${esc(t.tipo)}')" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6]" ${sinStock?'disabled':''}>Solicitar</button>`
      : `<button onclick="goPanel('escaneo');setTimeout(()=>setTabEscaneo('mikrotik'),150);" class="btn-sm ![background:#E6F1FB] !text-[#0A58B5]">Gestionar</button>`;
    return `<tr class="fade-row">
      <td><span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_7px] !rounded-[6px]">EQ</span></td>
      <td class="!font-semibold">📦 ${esc(t.tipo)}</td>
      <td><span class="badge badge-gray">Unidad</span></td>
      <td>${stockBadge}</td>
      <td><span class="!text-[11px] !text-[#CBD5E1]">—</span></td>
      <td class="!text-[12px] !text-[#CBD5E1]">—</td>
      <td class="!text-[12px] !text-[#94A3B8]">Varios proveedores</td>
      <td>${solicBtn}</td>
    </tr>`;
  }).join('');
}

function toggleDetalleEquipo(id){
  const el=document.getElementById(id);
  if(el) el.style.display=el.style.display==='none'?'block':'none';
}

function abrirSolicitarEquipoTipo(tipo){
  abrirSolicitarEquipo(tipo);
}

function _actualizarDonaHistorial(s){
  // La dona vive en graficas.js (su manejador de gráficas es local allá)
  if(typeof window.actualizarDonaHistorial==='function') window.actualizarDonaHistorial(s);
}

function renderStats(){
  const grid = document.getElementById('statsGrid');
  if(!grid) return;

  const productos   = getProductos();
  const sedes       = sesion.sedes || [sesion.sede];
  // Productos por rollo se cuentan en ROLLOS (no en metros) — antes se sumaban metros con unidades.
  const stockNeiva  = productos.reduce((s,p)=>s+((p.metrosPorUnidad && p.rollosCentral) ? (p.rollosCentral.length||0) : (_stockCentral(p)||0)),0);
  // Lo que tiene esta persona/oficina (inventario personal), no el viejo "stock por sede".
  const miStock     = productos.reduce((s,p)=>s+((p.metrosPorUnidad && p.misRollos) ? (p.misRollos.length||0) : (parseFloat(p.stockUsuario)||0)),0);
  // El historial ya no se carga completo en memoria (viene paginado): el total sale del resumen del servidor.
  const totalEnvios = (_statsHist && typeof _statsHist.aprobados==='number') ? _statsHist.aprobados : 0;
  const pendPed     = getPedidosMun().filter(p=>p.estado==='pendiente').length;
  const enCaminoSeg = (_seguimiento||[]).filter(s=>s.estado==='en_camino').length;

  // Cargar conteos reales del historial en segundo plano, sin bloquear el render
  _api('historial','stats_resumen').then(res=>{
    if(res && !res.error){
      _statsHist = res;
      _actualizarDonaHistorial(_statsHist);
      const elEnv = document.querySelector('[data-stat="envios"]');
      if(elEnv) elEnv.textContent = res.aprobados||0;
    }
  }).catch(()=>{});
  // Mis solicitudes
  const misSols      = getSolicitudes().filter(s=>sedes.includes(s.destino)||s.solicitadoPor===sesion.usuario);
  const solPend      = misSols.filter(s=>s.estado==='pendiente'||s.estado==='en_gestion').length;
  const solAprobadas = misSols.filter(s=>s.estado==='aprobada').length;
  const pedAgrupPend = getPedidosAgrupados().filter(p=>sedes.includes(p.destino)&&(p.estado==='pendiente'||p.estado==='en_gestion')).length;
  const totalPend    = solPend + pedAgrupPend;

  /* ── Tarjeta unificada ── */
  function card(label, val, color, iconPath, bg, panel, stat){
    const isNum  = (typeof val==='number' || (typeof val==='string' && val.match(/^\d+$/)));
    const fSize  = isNum ? '28px' : '20px';
    // panel puede ser un nombre de panel ("productos") o una llamada JS directa ("irAEscaneoFibra()")
    const onclickVal = panel ? (panel.includes('(') ? panel : `goPanel('${panel}')`) : '';
    const click  = panel ? `onclick="${onclickVal}"` : '';
    const cursor = panel ? 'cursor:pointer;' : '';
    const hOn    = panel ? `onmouseover="this.style.borderColor='${color}';this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,.10)'"` : '';
    const hOff   = panel ? `onmouseout="this.style.borderColor='#E2E8F0';this.style.transform='translateY(0)';this.style.boxShadow='none'"` : '';
    return `<div class="stat-card" ${click} ${hOn} ${hOff} style="${cursor}transition:all .2s ease;">
      <div class="!flex !items-center !justify-between !mb-[12px]">
        <div class="!text-[11.5px] !font-semibold !text-[#94A3B8] !uppercase !tracking-[.06em] !leading-[1.3]">${label}</div>
        <div style="width:32px;height:32px;background:${bg};border-radius:8px;flex-shrink:0;display:flex;align-items:center;justify-content:center;">
          <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="${color}" stroke-width="2"><path stroke-linecap="round" d="${iconPath}"/></svg>
        </div>
      </div>
      <div ${stat?`data-stat="${stat}"`:''} style="font-family:Syne,sans-serif;font-weight:800;font-size:${fSize};color:${color};line-height:1.1;">${val}</div>
    </div>`;
  }

  const rol = sesion.rol;

  /* ════════ SUPERADMIN ════════ */
  if(rol==='superadmin'){
    const pendUsr    = getUsuarios().filter(u=>u.estado==='pendiente'&&u.usuario!=='superadmin').length;
    const pendSolA   = getSolicitudes().filter(s=>s.estado==='pendiente'||s.estado==='en_gestion').length;
    const bajoMin    = productos.filter(_bajoStockMinimo).length;
    const cBM        = bajoMin>0?'#DC2626':'#16A871';
    const bgBM       = bajoMin>0?'#FEF2F2':'#EAF3DE';
    const pedMunPend = getPedidosMun().filter(p=>p.estado==='pendiente'||p.estado==='en_gestion').length
                     + getPedidosAgrupados().filter(p=>p.estado==='pendiente'||p.estado==='en_gestion').length;
    const sedesCount = getSedes().filter(s=>s.nombre!=='Sistema').length;

    // Cargar ONTs + fibra si no están
    Promise.all([
      fetch('api/cajas.php?action=stats_onts',{credentials:'same-origin'}).then(r=>r.json()).catch(()=>({disponibles:0,total:0})),
      fetch('api/fibra.php?action=saldo_total',{credentials:'same-origin'}).then(r=>r.json()).catch(()=>({total:0}))
    ]).then(([onts,fibra])=>{
      if(!window._statsRendered) return; // evitar loop
      document.querySelector('[data-stat="onts"]') && (document.querySelector('[data-stat="onts"]').textContent = onts.disponibles||0);
      document.querySelector('[data-stat="fibra"]') && (document.querySelector('[data-stat="fibra"]').textContent = (fibra.total||0)+' m');
    });

    window._statsRendered = true;
    grid.innerHTML =
      card('Total productos',        productos.length, '#0C6EDE', 'M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z',         '#E6F1FB', 'productos')+
      card('Unidades en Almacén',      stockNeiva,  '#0F172A', 'M9 17v-2m3 2v-4m3 4v-6',                                                      '#F1F5F9', 'productos')+
      card('Bajo mínimo',            bajoMin,            cBM,       'M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z',                            bgBM,      'productos')+
      card('Solicitudes pendientes', pendSolA,           '#BA7517', 'M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z',                            '#FAEEDA', 'solicitudes')+
      card('Pedidos directos',     pedMunPend,         '#5B21B6', 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z',                                 '#EDE9FE', 'pedidosmun')+
      card('Usuarios pendientes',    pendUsr,            '#7C3AED', 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',       '#EDE9FE', 'usuarios')+
      card('ONTs disponibles (almacén)', window._ontCount||0,'#0369A1', 'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9',   '#E0F6FF', 'escaneo','onts')+
      card('Metros de fibra',        (window._metrosFibra||0)+' m','#0891B2','M13 10V3L4 14h7v7l9-11h-7z',                                        '#E0F6FF', 'irAEscaneoFibra()','fibra')+
      card('Envíos en camino',       enCaminoSeg,        '#16A871', 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 8a2 2 0 002 2h8a2 2 0 002-2l1-8','#EAF3DE','seguimiento')+
      card('Envíos realizados',      totalEnvios,        '#16A871', 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2',        '#EAF3DE', 'historial','envios')+
      card('Sedes registradas',      sedesCount,         '#16A871', 'M19 21H5a2 2 0 01-2-2V7l7-4 7 4v12zM9 21V12h6v9',                            '#EAF3DE', 'oficinas');

    // Actualizar ONTs y fibra async (ya se mostraron con caché)
    if(!window._statsLoading){
      window._statsLoading=true;
      Promise.all([
        fetch('api/cajas.php?action=stats_onts',{credentials:'same-origin'}).then(r=>r.json()).catch(()=>({disponibles:0})),
        fetch('api/fibra.php?action=saldo_total',{credentials:'same-origin'}).then(r=>r.json()).catch(()=>({total:0}))
      ]).then(([onts,fibra])=>{
        window._ontCount    = onts.disponibles || 0;
        window._metrosFibra = fibra.total      || 0;
        window._statsLoading=false;
        const eO=document.querySelector('[data-stat="onts"]'); if(eO) eO.textContent = window._ontCount;
        const eF=document.querySelector('[data-stat="fibra"]'); if(eF) eF.textContent = (window._metrosFibra)+' m';
      });
    }
    checkAlertaStockMin();

  /* ════════ DISTRIBUIDOR ════════ */
  } else if(rol==='distribuidor'){
    const pendSolD   = getSolicitudes().filter(s=>s.estado==='pendiente'||s.estado==='en_gestion').length;
    const bajoMin    = productos.filter(_bajoStockMinimo).length;
    const cBM        = bajoMin>0?'#DC2626':'#16A871';
    const bgBM       = bajoMin>0?'#FEF2F2':'#EAF3DE';

    if(!window._statsLoading){
      window._statsLoading=true;
      Promise.all([
        fetch('api/cajas.php?action=stats_onts',{credentials:'same-origin'}).then(r=>r.json()).catch(()=>({disponibles:0})),
        fetch('api/fibra.php?action=saldo_total',{credentials:'same-origin'}).then(r=>r.json()).catch(()=>({total:0}))
      ]).then(([onts,fibra])=>{
        window._ontCount    = onts.disponibles || 0;
        window._metrosFibra = fibra.total      || 0;
        window._statsLoading=false;
        const eO=document.querySelector('[data-stat="onts"]'); if(eO) eO.textContent = window._ontCount;
        const eF=document.querySelector('[data-stat="fibra"]'); if(eF) eF.textContent = (window._metrosFibra)+' m';
      });
    }

    grid.innerHTML =
      card('Total productos',      productos.length, '#0C6EDE', 'M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z',          '#E6F1FB', 'productos')+
      card('Unidades en Almacén',    stockNeiva,  '#0F172A', 'M9 17v-2m3 2v-4m3 4v-6',                                                        '#F1F5F9', 'productos')+
      card('Bajo mínimo',          bajoMin,            cBM,       'M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z',                              bgBM,      'productos')+
      card('Pedidos directos',   pendPed,           '#7C3AED', 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z',                                    '#EDE9FE', 'pedidosmun')+
      card('Solicitudes',          pendSolD,          '#BA7517', 'M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z',                               '#FAEEDA', 'solicitudes')+
      card('ONTs disponibles (almacén)', window._ontCount||0,'#0369A1','M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9',      '#E0F6FF', 'escaneo','onts')+
      card('Metros de fibra',      (window._metrosFibra||0)+' m','#0891B2','M13 10V3L4 14h7v7l9-11h-7z',                                          '#E0F6FF', 'irAEscaneoFibra()','fibra')+
      card('Envíos en camino',     enCaminoSeg,       '#16A871', 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 8a2 2 0 002 2h8a2 2 0 002-2l1-8', '#EAF3DE', 'seguimiento')+
      card('Envíos realizados',    totalEnvios,       '#16A871', 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2',          '#EAF3DE', 'historial','envios');
    checkAlertaStockMin();

  /* ════════ MUNICIPIO / TÉCNICO / PERSONA ════════ */
  } else {
    const labelStock = 'Mi stock (unidades)';
    // Cargar ONTs y fibra — misma fuente que "Mis equipos"/"Productos en
    // stock" (por persona, no por sede), para que los 3 números siempre
    // coincidan entre sí.
    Promise.all([
      fetch(`api/cajas.php?action=onts_disponibles_modelo`,{credentials:'same-origin'}).then(r=>r.json()).catch(()=>({personal:[]})),
      fetch(`api/fibra.php?action=mis_carretes`,{credentials:'same-origin'}).then(r=>r.json()).catch(()=>[])
    ]).then(([ontData, carretes])=>{
      const personal = Array.isArray(ontData?.personal) ? ontData.personal : [];
      window._misSedeonts     = personal.reduce((s,r)=>s+(parseInt(r.cantidad)||0), 0);
      window._miSedeMetros    = Array.isArray(carretes)  ? carretes.reduce((s,c)=>s+(parseFloat(c.metros_disponibles)||0),0) : 0;
      // Actualizar las tarjetas si ya están en el DOM
      const el1 = document.querySelector('[data-stat="mis-onts"]');
      const el2 = document.querySelector('[data-stat="mis-fibra"]');
      if(el1) el1.textContent = window._misSedeonts;
      if(el2) el2.textContent = Math.round(window._miSedeMetros)+' m';
    });

    const ontsMiSede   = window._misSedeonts  || 0;
    const fibraMiSede  = window._miSedeMetros ? Math.round(window._miSedeMetros)+' m' : '0 m';

    grid.innerHTML =
      card('Productos disponibles', productos.length, '#0C6EDE', 'M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z',          '#E6F1FB', 'productos')+
      card(labelStock,              miStock,           '#0F172A', 'M9 17v-2m3 2v-4m3 4v-6',                                                        '#F1F5F9', 'productos')+
      card('Pedidos pendientes',totalPend,         '#BA7517', 'M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z',                               '#FAEEDA', 'missolicitudes')+
      card('Pedidos aprobados', solAprobadas,      '#16A871', 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',                                 '#EAF3DE', 'missolicitudes')+
      card('Envíos en camino',      enCaminoSeg,       '#16A871', 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 8a2 2 0 002 2h8a2 2 0 002-2l1-8', '#EAF3DE', 'seguimiento')+
      card('Envíos recibidos',      totalEnvios,       '#0891B2', 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2',          '#E0F6FF', 'historial','envios')+
      `<div class="stat-card" onclick="goPanel('misequipos')"
        onmouseover="this.style.borderColor='#0369A1';this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,.10)'"
        onmouseout="this.style.borderColor='#E2E8F0';this.style.transform='translateY(0)';this.style.boxShadow='none'"
        style="cursor:pointer;transition:all .2s ease;">
        <div class="!flex !items-center !justify-between !mb-[12px]">
          <div class="!text-[11.5px] !font-semibold !text-[#94A3B8] !uppercase !tracking-[.06em]">ONTs disponibles</div>
          <div class="!w-[32px] !h-[32px] ![background:#E0F6FF] !rounded-[8px] !flex !items-center !justify-center">
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="#0369A1" stroke-width="2"><path stroke-linecap="round" d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9"/></svg>
          </div>
        </div>
        <div class="![font-family:Syne,sans-serif] !font-extrabold !text-[28px] !text-[#0369A1]" data-stat="mis-onts">${ontsMiSede}</div>
      </div>`+
      `<div class="stat-card" onclick="goPanel('misequipos')"
        onmouseover="this.style.borderColor='#0891B2';this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,.10)'"
        onmouseout="this.style.borderColor='#E2E8F0';this.style.transform='translateY(0)';this.style.boxShadow='none'"
        style="cursor:pointer;transition:all .2s ease;">
        <div class="!flex !items-center !justify-between !mb-[12px]">
          <div class="!text-[11.5px] !font-semibold !text-[#94A3B8] !uppercase !tracking-[.06em]">Fibra en mi sede</div>
          <div class="!w-[32px] !h-[32px] ![background:#E0F6FF] !rounded-[8px] !flex !items-center !justify-center">
            <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="#0891B2" stroke-width="2"><path stroke-linecap="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          </div>
        </div>
        <div class="![font-family:Syne,sans-serif] !font-extrabold !text-[20px] !text-[#0891B2]" data-stat="mis-fibra">${fibraMiSede}</div>
      </div>`;
  }
}

/* ════════════════════════════════════════════════
   TABLA INVENTARIO
════════════════════════════════════════════════ */
let _modoEnvio = false;
let _carritoEnvio = {}; // { ref: { p, cantidad } }

// Descarga a Excel lo que hay en "Productos en stock" (respeta lo que se escribió en el buscador).
function exportarProductosStockExcel(){
  if(typeof XLSX==='undefined'){ toast('No se pudo cargar el generador de Excel. Recarga la página.','error'); return; }
  const productos = getProductos();
  const q = (document.getElementById('buscar')?.value||'').toLowerCase();
  const lista = productos.filter(p=>p.nombre.toLowerCase().includes(q)||p.ref.toLowerCase().includes(q)||(p.proveedor||'').toLowerCase().includes(q)||(p.descripcion||'').toLowerCase().includes(q));
  const esAdmin = sesion.rol==='superadmin'||sesion.rol==='distribuidor';
  const cant = (p, v)=> p.metrosPorUnidad ? valorMostrar(p, v) : v;
  const unidadTxt = p => p.metrosPorUnidad ? 'Rollos' : (p.unidad==='metros' ? 'Metros' : 'Unidades');
  const filas = lista.map(p=>{
    const rollos = p.metrosPorUnidad && p.rollosCentral;
    const almacen = rollos ? (p.rollosCentral.length||0) : cant(p, _stockCentral(p));
    const min = p.stockMinimo||0;
    const estado = (almacen<=0) ? 'Sin stock' : (min>0 && almacen<=min ? 'Bajo mínimo' : 'OK');
    const f = {
      'Ref': p.ref, 'Producto': p.nombre, 'Proveedor': p.proveedor||'', 'Unidad': unidadTxt(p),
    };
    if(esAdmin){
      f['En almacén'] = almacen;
      f['♻️ Recuperado'] = cant(p, p.stockRecuperado||0);
      f['En manos de técnicos'] = p.metrosPorUnidad ? (p.rollosEnTecnicos||0) : (p.stockTotalUsuarios||0);
      f['Stock mínimo'] = min;
      f['Estado'] = estado;
    } else {
      f['Disponible en almacén'] = almacen;
      f['Mi stock'] = cant(p, p.stockUsuario||0);
    }
    return f;
  });
  // Lo que la tabla también muestra aparte de los productos: ONT (por modelo), OLT, equipos y fibra.
  const extra = (ref, nombre, unidad, almacen, miStock, proveedor)=>{
    const f = {'Ref': ref, 'Producto': nombre, 'Proveedor': proveedor||'', 'Unidad': unidad};
    if(esAdmin){
      f['En almacén'] = almacen||0; f['♻️ Recuperado'] = ''; f['En manos de técnicos'] = ''; f['Stock mínimo'] = '';
      f['Estado'] = (almacen||0)<=0 ? 'Sin stock' : 'OK';
    } else {
      f['Disponible en almacén'] = almacen==null ? '' : almacen; f['Mi stock'] = miStock==null ? '' : miStock;
    }
    return f;
  };
  const qq = q.trim();
  try{
    (_modelosOnt||[]).filter(m=>!qq || (m.nombre||'').toLowerCase().includes(qq) || 'ont'.includes(qq) || (m.marca||'').toLowerCase().includes(qq)).forEach(m=>{
      const c = _ontStockMap[String(m.nombre||'').toLowerCase().trim()] || 0;
      filas.push(extra('ONT', 'ONT '+m.nombre+(m.marca?' ('+m.marca+')':''), 'Unidades', esAdmin ? c : null, esAdmin ? null : c, m.marca));
    });
  }catch(e){}
  try{
    if((_oltsStockData||[]).length && (!qq || 'olt'.includes(qq))) filas.push(extra('OLT', 'OLT', 'Unidades', _oltsStockData.length, null, ''));
    (_equiposStockData||[]).filter(t=>!qq || (t.tipo||'').toLowerCase().includes(qq)).forEach(t=> filas.push(extra('EQ', t.tipo, 'Unidades', t.total||0, null, '')));
  }catch(e){}
  try{
    const mis = {};
    if(!esAdmin) (window._misFibraCache||[]).forEach(c=>{ mis[c.cat_nombre] = (mis[c.cat_nombre]||0) + ((parseFloat(c.metros)||0) - (parseFloat(c.metros_usados)||0)); });
    (_fibraCats||[]).filter(c=>(c.nombre||'').toLowerCase().includes(qq)).forEach(c=>{
      filas.push(extra('FIBRA', 'Fibra — '+c.nombre, 'Metros', parseFloat(c.metros_disponibles||0), esAdmin ? null : (mis[c.nombre]||0), ''));
    });
  }catch(e){}
  if(!filas.length){ toast('No hay productos para exportar','warn'); return; }
  const ws = XLSX.utils.json_to_sheet(filas);
  ws['!cols'] = Object.keys(filas[0]).map(k=>({wch: k==='Producto'?36 : k==='Proveedor'?22 : 16}));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Productos en stock');
  const fechaHoy = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `productos_en_stock_${fechaHoy}.xlsx`);
  toast(`✓ Excel descargado (${filas.length} productos)`,'success');
}

// Aviso "reservadas / disponibles": lo aprobado que todavía no se despacha (el stock solo baja al despachar).
function _avisoReservado(p, neiva, suf){
  const r = p.reservadoCentral||0;
  if(!(r>0)) return '';
  const disp = Math.max(0, neiva - r);
  const un = v => p.metrosPorUnidad ? (valorMostrar(p,v)==1?'rollo':'rollos') : suf;
  return `<div class="!text-[10px] !text-[#B45309] !font-semibold !mt-[2px]" title="Aprobadas que aún no se despachan">⏳ Reservado: ${valorMostrar(p,r)} ${un(r)} · Disponible: ${valorMostrar(p,disp)} ${un(disp)}</div>`;
}
function renderTabla(){
  const productos=getProductos(),tbody=document.getElementById('tabla');
  if(!tbody)return;
  const q=(document.getElementById('buscar')?.value||'').toLowerCase();
  const filtrados=productos.filter(p=>p.nombre.toLowerCase().includes(q)||p.ref.toLowerCase().includes(q)||(p.proveedor||'').toLowerCase().includes(q)||(p.descripcion||'').toLowerCase().includes(q));
  if(!filtrados.length){
    const filasFibra=_modoEnvio?'':_filasFibraTabla(q);
    const filasOlt=_modoEnvio?'':_filasOltTabla(q);
    const filasEq=_modoEnvio?'':_filasEquiposTabla(q);
    const filasOnt=_modoEnvio?'':_filasOntTabla(q);
    if(filasFibra||filasOlt||filasEq||filasOnt){ tbody.innerHTML=(filasFibra+filasOlt+filasEq+filasOnt); return; }
    tbody.innerHTML=`<tr><td class="!p-[32px] !text-center !text-[#94A3B8] !text-[13px]" colspan="${_modoEnvio?8:7}">Sin productos registrados.</td></tr>`;return;
  }
  // Update table header for cart mode
  const thead = tbody.closest('table')?.querySelector('thead tr');
  if(thead){
    if(_modoEnvio && !thead.querySelector('.th-check')){
      thead.insertAdjacentHTML('afterbegin','<th class="th-check" style="width:40px;"></th>');
      thead.insertAdjacentHTML('beforeend','<th>Cantidad a enviar</th>');
    } else if(!_modoEnvio){
      thead.querySelector('.th-check')?.remove();
      thead.querySelectorAll('th').forEach(th=>{ if(th.textContent==='Cantidad a enviar') th.remove(); });
    }
  }
  const SEDES_NOMBRES=getNombresSedes();
  // Ajustar encabezado según rol
  const thMin = document.getElementById('thStockMin');
  if(thMin){
    const esAdminH = sesion.rol==='superadmin'||sesion.rol==='distribuidor';
    thMin.textContent = esAdminH ? 'Stock mín.' : 'Puedes pedir';
  }

  tbody.innerHTML=filtrados.map(p=>{
    const idx=productos.indexOf(p),suf=sufijoMostrar(p);
    const unidBadge=p.unidad==='metros'?`<span class="badge badge-purple">Metros</span>`:`<span class="badge badge-brand">Unidad</span>`;
    const neiva0=_stockCentral(p), min0=p.stockMinimo||0;
    const esAdmin = sesion.rol==='superadmin'||sesion.rol==='distribuidor';
    // Para productos por rollo, "cuánto hay" se compara en ROLLOS (cantidad
    // de rollos físicos), no en metros — igual que el resto de la tabla.
    const esRollosMin = p.metrosPorUnidad && p.rollosCentral;
    const cantActualMin = esRollosMin ? (p.rollosCentral?.length||0) : neiva0;
    const minBadge = esAdmin
      ? (p.stockMinimo>0
          ?(cantActualMin>=min0
            ?`<span class="badge badge-ok !text-[11px]">✓ mín. ${min0} ${esRollosMin?('rollo'+(min0!==1?'s':'')):sufijoP(p)}</span>`
            :`<span class="badge badge-warn !text-[11px]">⚠ mín. ${min0} ${esRollosMin?('rollo'+(min0!==1?'s':'')):sufijoP(p)}</span>`)
          :`<span class="!text-[11px] !text-[#CBD5E1]">—</span>`)
      : (neiva0>0
          ? `<span class="badge badge-ok !text-[11px]">📥 Puedes pedir hasta ${p.metrosPorUnidad ? (p.rollosCentral?.length||0)+' rollo'+((p.rollosCentral?.length||0)!==1?'s':'') : valorMostrar(p,neiva0)+' '+suf}</span>`
          : `<span class="badge badge-danger !text-[11px]">Sin stock en almacén</span>`);
    let stockHTML='';
    // Antes cada rollo se listaba aparte ("Rollo #12: de 300m quedan 180m"),
    // lo que se veía como un reguero largo apenas había varios rollos. Ahora
    // en "Productos en stock" solo se muestra la cantidad de rollos (sin
    // metros) — el detalle de metros por rollo sigue disponible donde hace
    // falta (al elegir de cuál rollo gastar/despachar).
    if(sesion.rol==='superadmin'){
      const neiva=_stockCentral(p),min=p.stockMinimo||0;
      const dist=p.stockTotalUsuarios||0;
      const esRollosSA = p.metrosPorUnidad && p.rollosCentral;
      // Para productos por rollo, el mínimo se compara contra la CANTIDAD
      // DE ROLLOS que hay en almacén, no contra los metros totales — si el
      // mínimo se puso como "2", es "avisar cuando queden menos de 2 rollos".
      const cantParaMin = esRollosSA ? (p.rollosCentral?.length||0) : neiva;
      const clsNeiva=neiva===0?'badge-danger':(min>0&&cantParaMin<=min)?'badge-warn':'';
      const alertaNeiva=(min>0&&cantParaMin<=min&&neiva>0)?`<div class="!text-[10px] !text-[#BA7517] !mt-[2px]">⚠ bajo mínimo</div>`:'';
      const almacenLinea = esRollosSA
        ? `<div class="!font-semibold">${p.rollosCentral.length} rollo${p.rollosCentral.length!==1?'s':''} <span class="!text-[11px] !text-[#94A3B8] !font-normal">Almacén</span>${clsNeiva?` <span class="badge ${clsNeiva} !text-[10px] !p-[1px_6px]">!</span>`:''}</div>`
        : `<div class="!font-semibold">${valorMostrar(p,neiva)} ${suf} <span class="!text-[11px] !text-[#94A3B8] !font-normal">Almacén</span>${clsNeiva?` <span class="badge ${clsNeiva} !text-[10px] !p-[1px_6px]">!</span>`:''}</div>`;
      stockHTML=`${almacenLinea}${_avisoReservado(p,neiva,suf)}${_detalleRollosCentral(p)}<div class="!text-[11px] !text-[#94A3B8]">${p.metrosPorUnidad ? ((p.rollosEnTecnicos||0)+' rollo'+((p.rollosEnTecnicos||0)!==1?'s':'')) : valorMostrar(p,dist)} en manos de técnicos</div>${(p.stockRecuperado>0)?`<div class="!text-[10px] !font-bold !text-[#166534] ![background:#EAF3DE] !inline-block !p-[1px_6px] !rounded-[4px] !mt-[3px]">♻️ ${valorMostrar(p,p.stockRecuperado)} recuperado disponible</div>`:''}${alertaNeiva}`;
    } else if(sesion.rol==='distribuidor'){
      const n=_stockCentral(p),min=p.stockMinimo||0;
      const esRollosDist = p.metrosPorUnidad && p.rollosCentral;
      const cantParaMinDist = esRollosDist ? (p.rollosCentral?.length||0) : n;
      const cls=n===0?'badge-danger':(min>0&&cantParaMinDist<=min)?'badge-warn':'badge-ok';
      const alerta=(min>0&&cantParaMinDist<=min&&n>0)?(esRollosDist?`<div class="!text-[10px] !text-[#BA7517] !mt-[2px]">⚠ Mín: ${min} rollo${min!==1?'s':''}</div>`:`<div class="!text-[10px] !text-[#BA7517] !mt-[2px]">⚠ Mín: ${valorMostrar(p,min)} ${suf}</div>`):'';
      const etiquetaRecup=(p.stockRecuperado>0)?`<div class="!text-[10px] !font-bold !text-[#166534] ![background:#EAF3DE] !inline-block !p-[1px_6px] !rounded-[4px] !mt-[3px]">♻️ ${valorMostrar(p,p.stockRecuperado)} recuperado disponible</div>`:'';
      const badgeStock = esRollosDist
        ? `<span class="badge ${cls}">${p.rollosCentral.length} rollo${p.rollosCentral.length!==1?'s':''}</span>`
        : `<span class="badge ${cls}">${valorMostrar(p,n)} ${suf}</span>`;
      stockHTML=`${badgeStock}${_avisoReservado(p,n,suf)}${_detalleRollosCentral(p)}${alerta}${etiquetaRecup}`;
    } else {
      const total=p.stockUsuario||0;
      const cls=total===0?'badge-danger':'badge-ok';
      if(p.metrosPorUnidad && p.misRollos && p.misRollos.length){
        // Se muestra el rollo Y cuánto tiene disponible cada uno — antes
        // solo salía "1 rollo" sin metros, así que no se podía saber
        // cuánto había de verdad sin abrir "Gastar" primero.
        const rollosOrdenados = p.misRollos;
        const totalDispRollos = rollosOrdenados.reduce((s,r)=>s+Math.max(0,(r.metros||0)-(r.metrosUsados||0)),0);
        const clsRollos = totalDispRollos>0 ? 'badge-ok' : 'badge-danger';
        const detalleRollos = rollosOrdenados.map((r,i)=>{
          const disp = Math.max(0,(r.metros||0)-(r.metrosUsados||0));
          return `Rollo ${i+1}: ${disp.toFixed(disp%1===0?0:1)} m`;
        }).join(' · ');
        stockHTML=`<span class="badge ${clsRollos}">${rollosOrdenados.length} rollo${rollosOrdenados.length!==1?'s':''} — ${totalDispRollos.toFixed(totalDispRollos%1===0?0:1)} m</span><div class="!text-[10px] !text-[#94A3B8] !mt-[2px]">${detalleRollos}</div>`;
      } else {
        const notaRecogido = p.misRecogidos
          ? `<div class="!cursor-pointer !text-[10px] !font-bold !text-[#166534] ![background:#EAF3DE] !inline-block !p-[1px_6px] !rounded-[4px] !mt-[3px]" onclick="event.stopPropagation();abrirGastar(${idx}).then(()=>{const r=document.querySelector('input[name=&quot;gastarOrigenRecogido&quot;][value=&quot;recogido&quot;]');if(r){r.checked=true;_gastarCambiarOrigenRecogido();}})" title="Click para gastarlo">♻️ +${p.misRecogidos.cantidad} recogido${p.misRecogidos.cantidad!==1?'s':''} sin gastar</div>`
          : '';
        stockHTML=`<span class="badge ${cls}">${valorMostrar(p,total)} ${suf}</span><div class="!text-[10px] !text-[#94A3B8] !mt-[2px]">Mi inventario</div>${notaRecogido}`;
      }
    }
    let acc=`<span class="!text-[11px] !text-[#CBD5E1]">Solo lectura</span>`;
    if(sesion.rol==='superadmin'){
      const uidP = 'menuProd_'+idx;
      acc = `<button class="![background:#F1F5F9] ![border:1.5px_solid_#E2E8F0] !rounded-[8px] !p-[5px_14px] !cursor-pointer !text-[18px] !text-[#475569] !font-bold !leading-[1]" onclick="event.stopPropagation();abrirMenuUsuario('${uidP}',this)"
          title="Acciones" data-menu="${uidP}">···</button>
        <div id="${uidP}" data-usermenu style="display:none;position:fixed;background:white;border:1.5px solid #E2E8F0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:9999;min-width:170px;padding:4px 0;overflow:hidden;">
          <button onclick="cerrarMenusUsuario();abrirModal(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#0F172A;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='none'">✎ Editar</button>
          <button onclick="cerrarMenusUsuario();abrirEnvioDirecto('${p.ref}')" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#166534;" onmouseover="this.style.background='#F0FDF4'" onmouseout="this.style.background='none'">📤 Enviar</button>
          ${(tienePermiso('enviar_material')&&sesion?.rol!=='distribuidor'&&_adminPuedeAsignar())?`<button onclick="cerrarMenusUsuario();abrirAsignar(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#B45309;" onmouseover="this.style.background='#FFFBEB'" onmouseout="this.style.background='none'">🤝 Asignar a alguien</button>`:''}
          ${true?`<button onclick="cerrarMenusUsuario();abrirVender(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#166534;" onmouseover="this.style.background='#F0FDF4'" onmouseout="this.style.background='none'">💰 Vender</button>`:''}
          <div class="!h-[1px] ![background:#F1F5F9] !m-[4px_0]"></div>
          <button onclick="cerrarMenusUsuario();abrirEliminar(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#B91C1C;" onmouseover="this.style.background='#FEF2F2'" onmouseout="this.style.background='none'">🗑 Eliminar</button>
        </div>`;
    }
    else if(tienePermiso('editar_productos')||tienePermiso('eliminar_productos')){
      const uidP = 'menuProd_'+idx;
      acc = `<button class="![background:#F1F5F9] ![border:1.5px_solid_#E2E8F0] !rounded-[8px] !p-[5px_14px] !cursor-pointer !text-[18px] !text-[#475569] !font-bold !leading-[1]" onclick="event.stopPropagation();abrirMenuUsuario('${uidP}',this)"
          title="Acciones" data-menu="${uidP}">···</button>
        <div id="${uidP}" data-usermenu style="display:none;position:fixed;background:white;border:1.5px solid #E2E8F0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:9999;min-width:170px;padding:4px 0;overflow:hidden;">
          ${tienePermiso('editar_productos')?`<button onclick="cerrarMenusUsuario();abrirModal(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#0F172A;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='none'">✎ Editar</button>`:''}
          <button onclick="cerrarMenusUsuario();abrirEnvioDirecto('${p.ref}')" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#166534;" onmouseover="this.style.background='#F0FDF4'" onmouseout="this.style.background='none'">📤 Enviar</button>
          ${(tienePermiso('enviar_material')&&sesion?.rol!=='distribuidor')?`<button onclick="cerrarMenusUsuario();abrirAsignar(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#B45309;" onmouseover="this.style.background='#FFFBEB'" onmouseout="this.style.background='none'">🤝 Asignar a alguien</button>`:''}
          ${true?`<button onclick="cerrarMenusUsuario();abrirVender(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#166534;" onmouseover="this.style.background='#F0FDF4'" onmouseout="this.style.background='none'">💰 Vender</button>`:''}
          ${tienePermiso('eliminar_productos')?`<div class="!h-[1px] ![background:#F1F5F9] !m-[4px_0]"></div><button onclick="cerrarMenusUsuario();abrirEliminar(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#B91C1C;" onmouseover="this.style.background='#FEF2F2'" onmouseout="this.style.background='none'">🗑 Eliminar</button>`:''}
        </div>`;
    }
    else if(sesion.rol==='distribuidor'){
      const uidP = 'menuProd_'+idx;
      acc = `<button class="![background:#F1F5F9] ![border:1.5px_solid_#E2E8F0] !rounded-[8px] !p-[5px_14px] !cursor-pointer !text-[18px] !text-[#475569] !font-bold !leading-[1]" onclick="event.stopPropagation();abrirMenuUsuario('${uidP}',this)"
          title="Acciones" data-menu="${uidP}">···</button>
        <div id="${uidP}" data-usermenu style="display:none;position:fixed;background:white;border:1.5px solid #E2E8F0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:9999;min-width:170px;padding:4px 0;overflow:hidden;">
          <button onclick="cerrarMenusUsuario();abrirModal(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#0F172A;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='none'">✎ Editar</button>
          <button onclick="cerrarMenusUsuario();abrirSolicitud('${p.ref}')" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#92400E;" onmouseover="this.style.background='#FFFBEB'" onmouseout="this.style.background='none'">📋 Solicitar</button>
          ${(tienePermiso('enviar_material')&&sesion?.rol!=='distribuidor')?`<button onclick="cerrarMenusUsuario();abrirAsignar(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#B45309;" onmouseover="this.style.background='#FFFBEB'" onmouseout="this.style.background='none'">🤝 Asignar a alguien</button>`:''}
          ${true?`<button onclick="cerrarMenusUsuario();abrirVender(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#166534;" onmouseover="this.style.background='#F0FDF4'" onmouseout="this.style.background='none'">💰 Vender</button>`:''}
        </div>`;
    }
    else if(tienePermiso('enviar_material') && sesion.rol!=='municipio' && sesion.rol!=='tecnico' && sesion.rol!=='persona') acc=`<button onclick="abrirSolicitud('${p.ref}')" class="btn-sm" style="background:#FAEEDA;color:#92400E;" onmouseover="this.style.background='#FDE68A'" onmouseout="this.style.background='#FAEEDA'">Solicitar</button>`;
    else if(sesion.rol==='municipio'||sesion.rol==='tecnico'||sesion.rol==='persona'){
      const uidP = 'menuProd_'+idx;
      acc = `<button class="![background:#F1F5F9] ![border:1.5px_solid_#E2E8F0] !rounded-[8px] !p-[5px_14px] !cursor-pointer !text-[18px] !text-[#475569] !font-bold !leading-[1]" onclick="event.stopPropagation();abrirMenuUsuario('${uidP}',this)"
          title="Acciones" data-menu="${uidP}">···</button>
        <div id="${uidP}" data-usermenu style="display:none;position:fixed;background:white;border:1.5px solid #E2E8F0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:9999;min-width:170px;padding:4px 0;overflow:hidden;">
          <button onclick="cerrarMenusUsuario();abrirPedidoMunicipio('${p.ref}')" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#5B21B6;" onmouseover="this.style.background='#F5F3FF'" onmouseout="this.style.background='none'">📋 Solicitar</button>
          ${sesion.rol!=='municipio' ? `<button onclick="cerrarMenusUsuario();abrirGastar(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#92400E;" onmouseover="this.style.background='#FFFBEB'" onmouseout="this.style.background='none'">➡️ Gastar</button>` : ''}
          ${true?`<button onclick="cerrarMenusUsuario();abrirVender(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#166534;" onmouseover="this.style.background='#F0FDF4'" onmouseout="this.style.background='none'">💰 Vender</button>`:''}
          <div class="!h-[1px] ![background:#F1F5F9] !m-[4px_0]"></div>
          <button onclick="cerrarMenusUsuario();abrirDevolverProducto(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#0A58B5;" onmouseover="this.style.background='#EFF6FF'" onmouseout="this.style.background='none'">↩ Devolver</button>
          <button onclick="cerrarMenusUsuario();abrirAsignar(${idx})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#B45309;" onmouseover="this.style.background='#FFFBEB'" onmouseout="this.style.background='none'">🤝 Asignar a alguien</button>
        </div>`;
    }
    const miStockCarrito = p.stock?.[sesion.sede] || 0;
    const enCarrito = _carritoEnvio[p.ref];
    // Si el producto viene empacado en rollos iguales (ej: DROP), lo que se
    // escribe aquí son ROLLOS (igual que el resto de la app), no metros
    // sueltos — se convierte a metros al armar el pedido.
    const maxCarrito = p.metrosPorUnidad ? Math.floor(miStockCarrito / p.metrosPorUnidad) : miStockCarrito;
    if(_modoEnvio && enCarrito && miStockCarrito>0){ acc = '<input type="number" id="cant_'+p.ref+'" min="1" max="'+maxCarrito+'" value="'+(enCarrito.cantidad||1)+'" oninput="_setC(this)" data-ref="'+p.ref+'" data-max="'+maxCarrito+'" style="width:65px;border:1.5px solid #16A871;border-radius:6px;padding:4px 8px;font-size:13px;font-weight:600;">'+(p.metrosPorUnidad?' <span class="!text-[10px] !text-[#94A3B8]">rollo(s)</span>':''); }
    const checkCol = _modoEnvio ? '<td><input type="checkbox" '+(enCarrito?'checked':'')+' '+(maxCarrito<1?'disabled':'')+' onchange="toggleCarrito(\''+p.ref+'\',this.checked,'+idx+')" style="width:16px;height:16px;accent-color:#16A871;cursor:pointer;"></td>' : '';
    return `<tr class="fade-row" style="${_modoEnvio&&enCarrito?'background:#F0FDF4;':''}">${checkCol}<td><span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_7px] !rounded-[6px]">${hl(p.ref,q)}</span></td><td class="!font-semibold">${hl(p.nombre,q)}</td><td>${unidBadge}</td><td>${stockHTML}</td><td>${minBadge}</td><td class="!text-[12px] !text-[#475569] !max-w-[140px] !whitespace-nowrap !overflow-hidden !text-ellipsis">${p.proveedor?`🏭 ${hl(p.proveedor,q)}`:'<span class="!text-[#CBD5E1]">—</span>'}</td>
      <td class="!text-[12px] !text-[#94A3B8] !max-w-[160px]"><div class="!whitespace-nowrap !overflow-hidden !text-ellipsis">${esc(p.descripcion||'—')}</div></td><td>${acc}</td></tr>`;

  }).join('') + (_modoEnvio ? '' : _filasFibraTabla(q) + _filasOltTabla(q) + _filasEquiposTabla(q) + _filasOntTabla(q));
}

/* Filas de las categorías de fibra, con el mismo look de la tabla de productos.
   No participan del modo "envío múltiple" (carrito) — solo se listan y se
   envían/solicitan desde su propio botón, reutilizando el flujo ya existente. */
function _filasFibraTabla(q){
  if(!_fibraCats || !_fibraCats.length) return '';
  const cats=_fibraCats.filter(c=>c.nombre.toLowerCase().includes(q||''));
  if(!cats.length) return '';
  const esAdmin=sesion.rol==='superadmin'||sesion.rol==='distribuidor';
  // Para no-admin: cuánta fibra es REALMENTE suya (por categoría), sacado
  // de sus propios carretes — así no se confunde con el total del almacén.
  // Se auto-carga la primera vez que hace falta, y vuelve a pintar la
  // tabla apenas llega la respuesta.
  if(!esAdmin && !Array.isArray(window._misFibraCache)){
    window._misFibraCache = []; // evita pedirlo 2 veces mientras llega
    fetch('api/fibra.php?action=mis_carretes',{credentials:'same-origin'})
      .then(r=>r.json())
      .then(data=>{ window._misFibraCache = Array.isArray(data)?data:[]; renderTabla(); })
      .catch(()=>{ window._misFibraCache = []; });
  }
  const miFibraPorCat = {};
  const miActivoPorCat = {}; // primer carrete con saldo, para el botón "Gastar" de esta fila
  if(!esAdmin && Array.isArray(window._misFibraCache)){
    window._misFibraCache.forEach(c=>{
      const disp = (parseFloat(c.metros)||0) - (parseFloat(c.metros_usados)||0);
      miFibraPorCat[c.cat_nombre] = (miFibraPorCat[c.cat_nombre]||0) + disp;
      if(disp>0 && !miActivoPorCat[c.cat_nombre]) miActivoPorCat[c.cat_nombre] = c.id;
    });
  }
  return cats.map(c=>{
    const disp=parseFloat(c.metros_disponibles||0);
    const sinStock=disp<=0;
    let stockHTML;
    if(esAdmin){
      stockHTML=`<span class="badge ${sinStock?'badge-danger':'badge-ok'}">${disp.toFixed(0)} mts.</span>`;
    } else {
      const miMetros = miFibraPorCat[c.nombre]||0;
      stockHTML=`<span class="badge ${miMetros>0?'badge-ok':'badge-danger'}">${miMetros.toFixed(0)} mts.</span><div class="!text-[10px] !text-[#94A3B8] !mt-[2px]">Mi inventario</div>`
        + (disp>0?`<div class="!text-[10px] !text-[#0369A1] !mt-[2px]">📥 Puedes pedir hasta ${disp.toFixed(0)}</div>`:'');
    }
    const miMetrosCat = miFibraPorCat[c.nombre]||0;
    const carreteActivo = miActivoPorCat[c.nombre];
    // Editar/Enviar/Eliminar fibra desde esta tabla es exclusivo de superadmin/distribuidor,
    // sin excepción — el permiso "gestionar_fibra" solo habilita otras pantallas (como
    // registrar carretes), no estas acciones sobre el almacén central.
    const puedeGestionar=esAdmin;
    const uidF = 'menuFibra_'+c.id;
    const acc = `<button class="![background:#F1F5F9] ![border:1.5px_solid_#E2E8F0] !rounded-[8px] !p-[5px_14px] !cursor-pointer !text-[18px] !text-[#475569] !font-bold !leading-[1]" onclick="event.stopPropagation();abrirMenuUsuario('${uidF}',this)"
        title="Acciones" data-menu="${uidF}">···</button>
      <div id="${uidF}" data-usermenu style="display:none;position:fixed;background:white;border:1.5px solid #E2E8F0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:9999;min-width:170px;padding:4px 0;overflow:hidden;">
        ${puedeGestionar ? `
          <button onclick="cerrarMenusUsuario();abrirEditarCategoriaFibra(${c.id})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#0F172A;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='none'">✎ Editar</button>
          ${!sinStock?`<button onclick="cerrarMenusUsuario();abrirEnviarOSolicitarFibraTabla(${c.id})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#166534;" onmouseover="this.style.background='#F0FDF4'" onmouseout="this.style.background='none'">📤 Enviar</button>`:''}
          ${(sesion.rol==='superadmin'||tienePermiso('eliminar_fibra'))?`<div class="!h-[1px] ![background:#F1F5F9] !m-[4px_0]"></div><button onclick="cerrarMenusUsuario();eliminarCategoria(${c.id})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#B91C1C;" onmouseover="this.style.background='#FEF2F2'" onmouseout="this.style.background='none'">🗑 Eliminar</button>`:''}
        ` : `
          ${carreteActivo?`<button onclick="cerrarMenusUsuario();abrirGastoFibra(${carreteActivo},'${esc(c.nombre).replace(/'/g,"\\'")}',${miMetrosCat})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#92400E;" onmouseover="this.style.background='#FFFBEB'" onmouseout="this.style.background='none'">📝 Gastar</button>`:''}
          ${!sinStock?`<button onclick="cerrarMenusUsuario();abrirEnviarOSolicitarFibraTabla(${c.id})" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#92400E;" onmouseover="this.style.background='#FFFBEB'" onmouseout="this.style.background='none'">📋 Solicitar</button>`:''}
          <button onclick="cerrarMenusUsuario();goPanel('misequipos')" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;padding:9px 14px;font-size:13px;background:none;border:none;cursor:pointer;color:#475569;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='none'">🔵 Ver mi fibra →</button>
        `}
      </div>`;
    return `<tr class="fade-row">
      <td><span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_7px] !rounded-[6px]">FIBRA</span></td>
      <td class="!font-semibold"><span style="display:inline-block;width:9px;height:9px;border-radius:3px;background:${esc(c.color||'#2DB82D')};margin-right:6px;vertical-align:middle;"></span>${esc(c.nombre)}</td>
      <td><span class="badge badge-purple">Metros</span></td>
      <td>${stockHTML}</td>
      <td><span class="!text-[11px] !text-[#CBD5E1]">—</span></td>
      <td class="!text-[12px] !text-[#475569]">${c.proveedores?`🏭 ${esc(c.proveedores)}`:'<span class="!text-[#CBD5E1]">—</span>'}</td>
      <td class="!text-[12px] !text-[#94A3B8]">${esc(c.descripcion||'—')}</td>
      <td>${acc}</td>
    </tr>`;
  }).join('');
}

/* ════════════════════════════════════════════════
   MODAL PRODUCTO
════════════════════════════════════════════════ */
async function abrirModal(idx){
  editIndex=idx!==undefined?idx:null;
  await cargarProveedores(); // poblar el selector de proveedor
  const refWrap=document.getElementById('refAutoWrap');
  const refLabel=document.getElementById('refAutoLabel');
  if(editIndex!==null){
    const p=getProductos()[editIndex];
    document.getElementById('ref').value=p.ref;
    document.getElementById('nombre').value=p.nombre;
    document.getElementById('proveedor').value=p.proveedor||'';
    {const pb=document.getElementById('proveedorBuscar');if(pb)pb.value=p.proveedor||'';}
    document.getElementById('cantidad').value=valorMostrar(p, _stockCentral(p));
    document.getElementById('cantidad').disabled=true;
    document.getElementById('cantidad').style.background='#F1F5F9';
    document.getElementById('cantidad').style.cursor='not-allowed';
    const cantAyuda=document.getElementById('cantidadAyuda');
    if(cantAyuda) cantAyuda.style.display='block';
    document.getElementById('stockMinimo').value=p.stockMinimo||0;
    document.getElementById('descripcion').value=p.descripcion||'';
    // Aunque el campo de rollos queda oculto al editar (selectUnidad se
    // encarga), se precarga con el valor real — si no, "guardar()" mandaría
    // metrosPorUnidad vacío y borraría el dato al guardar cualquier edición.
    const campoMxu = document.getElementById('crearProdRollosMetros');
    if(campoMxu) campoMxu.value = p.metrosPorUnidad || '';
    selectUnidad(p.unidad||'unidad');
    if(refLabel) refLabel.textContent=p.ref;
    if(refWrap) refWrap.style.background='#F0F7FF';
    setText('modalProdTitulo','Editar producto');
  } else {
    ['ref','nombre','proveedor','cantidad','descripcion'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    {const pb=document.getElementById('proveedorBuscar');if(pb)pb.value='';}
    document.getElementById('cantidad').disabled=false;
    document.getElementById('cantidad').style.background='';
    document.getElementById('cantidad').style.cursor='';
    const cantAyuda=document.getElementById('cantidadAyuda');
    if(cantAyuda) cantAyuda.style.display='none';
    document.getElementById('stockMinimo').value='';
    selectUnidad('unidad');
    if(refLabel) refLabel.textContent='Se genera automáticamente';
    if(refWrap) refWrap.style.background='#F8FAFC';
    setText('modalProdTitulo','Agregar producto');
  }
  document.getElementById('modalProducto').classList.add('open');
  setTimeout(()=>document.getElementById('nombre')?.focus(),200);
}

async function guardar(){
  const refManual=(document.getElementById('ref')?.value||'').trim();
  const nom=(document.getElementById('nombre')?.value||'').trim();
  const cant=parseFloat(document.getElementById('cantidad')?.value);
  const desc=(document.getElementById('descripcion')?.value||'').trim();
  const unidad=document.querySelector('input[name="unidadMedida"]:checked')?.value||'unidad';
  const stockMin=parseInt(document.getElementById('stockMinimo')?.value)||0;
  const metrosPorUnidad = unidad==='metros' ? (parseFloat(document.getElementById('crearProdRollosMetros')?.value)||null) : null;
  // Cuántos rollos exactos son (solo aplica al crear un producto nuevo
  // "por rollos" — al editar, este campo siempre está vacío/oculto y no
  // debe volver a crear rollos duplicados).
  const rollosCantidad = (editIndex===null && unidad==='metros') ? (parseInt(document.getElementById('crearProdRollosCantidad')?.value)||0) : 0;
  if(!nom||isNaN(cant)||cant<0){toast('Completa nombre y cantidad.','error');return;}
  if(stockMin>0 && cant>0 && stockMin>cant){
    toast(`⚠ El stock mínimo (${stockMin}) es mayor al stock actual (${cant}). El producto quedará en alerta inmediatamente.`,'warn');
    // No bloquear — solo advertir
  }
  // Si es nuevo producto, ref vacía → el PHP la genera automáticamente
  const ref = editIndex!==null ? refManual : '';
  try{
    const prov=(document.getElementById('proveedor')?.value||'').trim();
  const datos={ref,nombre:nom,proveedor:prov,descripcion:desc,unidad,stockMinimo:stockMin,stockNeiva:cant,metrosPorUnidad,rollosCantidad};
    if(editIndex!==null){
      const p=getProductos()[editIndex];
      datos.id=p.id;
      await _api('productos','actualizar',datos);
      toast('Producto actualizado ✓','success');
    } else {
      await _api('productos','crear',datos);
      toast('Producto agregado ✓','success');
    }
    await _recargarProductos();
    cerrarModal('modalProducto');renderTabla();renderStats();updateNotifBadges();
  }catch(e){toast(e.message||'Error al guardar','error');}
}
function validarRef(){
  const inputEl=document.getElementById('ref'),msgEl=document.getElementById('refMsg'),iconoEl=document.getElementById('refIcono');
  if(!inputEl||!msgEl||!iconoEl)return true;
  const val=inputEl.value.trim();if(!val){resetRefUI();return false;}
  const dup=getProductos().some((p,i)=>p.ref.trim().toLowerCase()===val.toLowerCase()&&i!==editIndex);
  if(dup){inputEl.style.cssText='border-color:#E24B4A;box-shadow:0 0 0 3px rgba(226,75,74,.12)';msgEl.textContent=`Ref "${val}" ya existe.`;msgEl.style.color='#E24B4A';msgEl.style.display='block';iconoEl.innerHTML=`<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#E24B4A" stroke-width="2.5"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>`;iconoEl.style.display='inline';return false;}
  else{inputEl.style.cssText='border-color:#16A871;box-shadow:0 0 0 3px rgba(22,168,113,.12)';msgEl.textContent='Disponible ✓';msgEl.style.color='#16A871';msgEl.style.display='block';iconoEl.innerHTML=`<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#16A871" stroke-width="2.5"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg>`;iconoEl.style.display='inline';return true;}
}
function resetRefUI(){const i=document.getElementById('ref'),m=document.getElementById('refMsg'),ic=document.getElementById('refIcono');if(i){i.style.borderColor='';i.style.boxShadow='';}if(m){m.style.display='none';m.textContent='';}if(ic){ic.style.display='none';ic.innerHTML='';}}

function abrirEliminar(idx){
  elimIndex=idx;
  const inp=document.getElementById('eliminarPassword');
  const err=document.getElementById('eliminarPasswordError');
  if(inp){ inp.value=''; }
  if(err){ err.style.display='none'; err.textContent=''; }
  document.getElementById('modalEliminar').classList.add('open');
  setTimeout(()=>inp?.focus(), 200);
}
async function confirmarEliminar(){
  const p=getProductos()[elimIndex];
  if(!p) return;
  const pass=(document.getElementById('eliminarPassword')?.value||'').trim();
  const errEl=document.getElementById('eliminarPasswordError');
  if(!pass){
    if(errEl){ errEl.textContent='Debes ingresar tu contraseña.'; errEl.style.display='block'; }
    document.getElementById('eliminarPassword')?.focus();
    return;
  }
  if(errEl) errEl.style.display='none';
  try{
    await _api('productos','eliminar',{id:p.id, password:pass});
    await _recargarProductos();
    cerrarModal('modalEliminar');
    renderTabla();renderStats();
    toast('Producto eliminado.','success');
  }catch(e){
    const msg=e.message||'Error al eliminar';
    if(errEl){ errEl.textContent=msg; errEl.style.display='block'; }
    document.getElementById('eliminarPassword')?.select();
  }
}