/* auth.js — Integrados v4 — conectado con PHP/MySQL */
const API_URL = 'api/auth.php';

async function llamarAPI(action, body = null) {
  try {
    const opts = { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(`${API_URL}?action=${action}`, opts);
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (e) { return { ok: false, data: { error: 'Error de conexión con el servidor' } }; }
}

async function login() {
  const usuario = (_id('loginUsuario')?.value || '').trim();
  const pass    = _id('loginPass')?.value || '';
  if (!usuario || !pass) { _alert('loginAlerta', 'Ingresa usuario y contraseña.', 'error'); return; }
  const btn = document.querySelector('#viewLogin button');
  if (btn) { btn.textContent = 'Verificando…'; btn.disabled = true; }
  const { ok, data } = await llamarAPI('login', { usuario, password: pass });
  if (btn) { btn.textContent = 'Entrar al sistema'; btn.disabled = false; }
  if (!ok || data.error) { _alert('loginAlerta', data.error || 'Usuario o contraseña incorrectos.', 'error'); return; }
  sessionStorage.setItem('integrados_user', JSON.stringify(data));
  _alert('loginAlerta', `Bienvenido, ${data.nombre || data.usuario}. Redirigiendo…`, 'success');
  setTimeout(() => { window.location.href = 'dashboard.html'; }, 800);
}

async function logout() {
  await llamarAPI('logout', {});
  sessionStorage.removeItem('integrados_user');
  window.location.href = 'index.html';
}

// Validación de correo: formato general (no restringe a proveedores
// específicos) — así funcionan tanto Gmail/Hotmail como correos de
// dominio propio de empresa (ej: nombre@tuempresa.com).
function esCorreoValido(correo) {
  if (!correo) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo.trim().toLowerCase());
}

// Formulario de registro: primero se elige el tipo de cuenta (cards),
// y luego aparece este formulario único y corto — mismo patrón que usa
// el panel del admin al crear un usuario.
async function registrarUsuario() {
  const tipo     = tipoRegistroSeleccionado || 'municipio';
  const nombre   = (_id('reg-nombre')?.value || '').trim();
  const apellido = (_id('reg-apellido')?.value || '').trim();
  const usuario  = (_id('reg-usuario')?.value || '').trim();
  const pass     = _id('reg-pass')?.value || '';
  const correo   = (_id('reg-correo')?.value || '').trim();
  const telefono = (_id('reg-telefono')?.value || '').trim();
  const cargo    = (_id('reg-cargo')?.value || '').trim();
  const sedeId   = _id('reg-sede')?.value || '';

  if (!nombre)                { _alert('regAlerta', tipo === 'municipio' ? 'Ingresa el nombre de la sede.' : 'Ingresa tu nombre.', 'error'); return; }
  if (tipo !== 'municipio' && !apellido) { _alert('regAlerta', 'Ingresa tu apellido.', 'error'); return; }
  if (!usuario)                { _alert('regAlerta', 'El usuario es obligatorio.', 'error'); return; }
  if (pass.length < 6)         { _alert('regAlerta', 'La contraseña debe tener al menos 6 caracteres.', 'error'); return; }
  if (!sedeId)                 { _alert('regAlerta', 'Selecciona una sede.', 'error'); return; }
  if (!_id('reg-acepta-terminos')?.checked) { _alert('regAlerta', 'Debes aceptar los términos y condiciones y el tratamiento de datos personales.', 'error'); return; }
  if (correo && !esCorreoValido(correo)) { _alert('regAlerta', 'Escribe un correo válido (ej: nombre@dominio.com).', 'error'); return; }

  const cargoPorDefecto = { tecnico: 'Técnico', persona: 'Personal General' };
  const { ok, data } = await llamarAPI('registro', {
    usuario, password: pass,
    nombre, apellido: tipo === 'municipio' ? '' : apellido,
    cargo: cargo || cargoPorDefecto[tipo] || '',
    sede_id: parseInt(sedeId), sedes_ids: [parseInt(sedeId)],
    tipo, correo, telefono
  });
  if (!ok || data.error) { _alert('regAlerta', data.error || 'Error al registrar.', 'error'); return; }
  mostrarExito(tipo);
}

async function aprobarUsuario(nombreUsuario) {
  await fetch('api/usuarios.php?action=estado', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ usuario: nombreUsuario, estado: 'activo' }) });
  if (typeof renderUsuarios === 'function') renderUsuarios();
  if (typeof updateNotifBadges === 'function') updateNotifBadges();
  if (typeof toast === 'function') toast(`${nombreUsuario} aprobado ✓`, 'success');
}
async function desactivarUsuario(nombreUsuario) {
  await fetch('api/usuarios.php?action=estado', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ usuario: nombreUsuario, estado: 'inactivo' }) });
  if (typeof renderUsuarios === 'function') renderUsuarios();
  if (typeof toast === 'function') toast(`${nombreUsuario} desactivado.`, 'success');
}
async function rechazarUsuario(nombreUsuario) { await eliminarUsuarioDB(nombreUsuario); }
async function eliminarUsuarioDB(nombreUsuario) {
  await fetch('api/usuarios.php?action=eliminar', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ usuario: nombreUsuario }) });
  if (typeof renderUsuarios === 'function') renderUsuarios();
  if (typeof updateNotifBadges === 'function') updateNotifBadges();
  if (typeof toast === 'function') toast(`Usuario ${nombreUsuario} eliminado.`, 'success');
}
async function asignarPermisos(nombreUsuario, permisos) {
  const res = await fetch('api/usuarios.php?action=permisos', { method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ usuario: nombreUsuario, permisos }) });
  return res.ok;
}

async function cargarSedesEnRegistro() {
  try {
    const res   = await fetch('api/sedes.php?action=listar', { credentials: 'same-origin' });
    const sedes = await res.json();
    // Excluir la sede del distribuidor del registro:
    // - si ya tiene distribuidor (ocupada_por_distribuidor), o
    // - la sede "Almacen Central" (exclusiva del distribuidor).
    const disponibles = sedes.filter(s => s.activa == 1 && s.nombre !== 'Almacen Central' && !s.ocupada_por_distribuidor);
    const selReg = _id('reg-sede');
    if (selReg) {
      selReg.innerHTML = '<option value="">Selecciona tu sede…</option>' +
        disponibles.map(s => `<option value="${s.id}">${s.nombre}${s.tipo==='central'?' (Central)':''}</option>`).join('');
    }
  } catch(e) { console.error('[Auth] Error cargando sedes:', e); }
}

// Ajusta las etiquetas y el encabezado del formulario según el tipo de
// cuenta elegido en el paso anterior — igual patrón que usa el panel del
// admin al crear un usuario: una sede/municipio es un solo nombre (sin
// apellido), una persona/técnico sí lleva nombre y apellido.
const _REG_INFO = {
  municipio: { titulo:'Cuenta para Sede', color:'#0C6EDE', bg:'#E6F1FB', icon:'<path stroke-linecap="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>', sede:'Sede / Municipio' },
  tecnico:   { titulo:'Cuenta de Técnico', color:'#7C3AED', bg:'#EDE9FE', icon:'<path stroke-linecap="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/>', sede:'Sede principal' },
  persona:   { titulo:'Cuenta General', color:'#16A871', bg:'#EAF3DE', icon:'<path stroke-linecap="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>', sede:'Sede principal' }
};
function _regAplicarTipo(tipo) {
  const info = _REG_INFO[tipo] || _REG_INFO.municipio;
  const lbl   = _id('regLblNombre');
  const apDiv = _id('regApellidoDiv');
  const grid  = _id('regNombreGrid');
  const nomInp = _id('reg-nombre');
  const lblSede = _id('regLblSede');
  const cargoDiv = _id('regCargoDiv');
  if (tipo === 'municipio') {
    if (lbl) lbl.textContent = 'Nombre de la sede';
    if (nomInp) nomInp.placeholder = 'Ej: Oficina Palermo';
    if (nomInp) nomInp.removeAttribute('oninput');
    if (apDiv) apDiv.style.display = 'none';
    if (grid) grid.style.gridTemplateColumns = '1fr';
    const ap = _id('reg-apellido'); if (ap) ap.value = '';
    if (cargoDiv) cargoDiv.style.display = 'none';
  } else {
    if (lbl) lbl.textContent = 'Nombre';
    if (nomInp) nomInp.placeholder = 'Tu nombre';
    if (nomInp) nomInp.setAttribute('oninput', "this.value=this.value.replace(/[^a-zA-ZÀ-ÿ\\s]/g,'')");
    if (apDiv) apDiv.style.display = '';
    if (grid) grid.style.gridTemplateColumns = '1fr 1fr';
    if (cargoDiv) cargoDiv.style.display = '';
  }
  if (lblSede) lblSede.textContent = info.sede;
  const icono = _id('regIconWrap');
  if (icono) {
    icono.style.background = info.bg;
    icono.innerHTML = `<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="${info.color}" stroke-width="2">${info.icon}</svg>`;
  }
  const titulo = _id('regTitulo'); if (titulo) titulo.textContent = info.titulo;
  const btn = _id('btnRegistrar');
  if (btn) { btn.style.background = info.color; }
}

let tipoRegistroSeleccionado = null;
function irALogin() { _mostrarVista('viewLogin'); _clearAlerts(); tipoRegistroSeleccionado = null; }
function irARegistro() {
  _mostrarVista('viewTipoRegistro'); _clearAlerts(); tipoRegistroSeleccionado = null;
  ['cardMunicipio','cardTecnico','cardPersona'].forEach(id => _id(id)?.classList.remove('selected'));
  const btn = _id('btnContinuarTipo'); if (btn) { btn.disabled = true; btn.style.opacity = '.5'; }
}
function irATipoRegistro() { _mostrarVista('viewTipoRegistro'); _clearAlerts(); }
function seleccionarTipo(tipo) {
  tipoRegistroSeleccionado = tipo;
  ['cardMunicipio','cardTecnico','cardPersona'].forEach(id => _id(id)?.classList.remove('selected'));
  const mapa = { municipio:'cardMunicipio', tecnico:'cardTecnico', persona:'cardPersona' };
  _id(mapa[tipo])?.classList.add('selected');
  const btn = _id('btnContinuarTipo'); if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
}
function continuarRegistro() {
  if (!tipoRegistroSeleccionado) return;
  _clearAlerts();
  // Limpiar todos los campos del formulario
  ['reg-nombre','reg-apellido','reg-usuario','reg-pass','reg-correo','reg-telefono','reg-cargo'].forEach(id => {
    const el = _id(id); if (el) el.value = '';
  });
  const sede = _id('reg-sede'); if (sede) sede.value = '';
  const terminos = _id('reg-acepta-terminos'); if (terminos) terminos.checked = false;
  _regAplicarTipo(tipoRegistroSeleccionado);
  cargarSedesEnRegistro();
  _mostrarVista('viewRegistro');
}
function mostrarExito(tipo) {
  const titulos = { municipio:'¡Solicitud enviada!', tecnico:'¡Registro de técnico enviado!', persona:'¡Solicitud enviada!' };
  const msgs    = { municipio:'Tu solicitud fue recibida. El administrador la revisará pronto.', tecnico:'Tu solicitud como técnico fue enviada. El superadmin la revisará.', persona:'Tu solicitud de acceso fue recibida y será aprobada pronto.' };
  const t = _id('exitoTitulo'), m = _id('exitoMsg');
  if (t) t.textContent = titulos[tipo] || '¡Solicitud enviada!';
  if (m) m.textContent = msgs[tipo]    || 'Tu solicitud está pendiente.';
  _mostrarVista('viewExito');
}
function _mostrarVista(id) {
  ['viewLogin','viewTipoRegistro','viewRegistro','viewExito','viewOlvidePass','viewCodigoPass'].forEach(v => { const el = _id(v); if (el) el.style.display = v === id ? '' : 'none'; });
  const el = _id(id); if (el) { el.style.animation = 'none'; void el.offsetHeight; el.style.animation = 'slideUp .25s ease both'; }
}
function togglePass(inputId) { const inp = _id(inputId); if (!inp) return; inp.type = inp.type === 'password' ? 'text' : 'password'; }
function checkPassStrength(inputId, barId, txtId) {
  const val = _id(inputId)?.value || '', bar = _id(barId), txt = _id(txtId); if (!bar||!txt) return;
  let s = 0; if (val.length>=6) s++; if (val.length>=10) s++; if (/[A-Z]/.test(val)&&/[0-9]/.test(val)) s++;
  bar.className = 'pass-bar';
  if (!val) { bar.style.width='0'; txt.textContent=''; return; }
  if (s<=1) { bar.classList.add('weak');   txt.textContent='Débil';  txt.style.color='#E24B4A'; }
  else if (s===2) { bar.classList.add('medium'); txt.textContent='Media';  txt.style.color='#BA7517'; }
  else            { bar.classList.add('strong'); txt.textContent='Fuerte'; txt.style.color='#16A871'; }
}
function _alert(elId, msg, tipo) { const el = _id(elId); if (!el) return; el.textContent = msg; el.className = `alerta ${tipo}`; }
function _clearAlerts() { ['loginAlerta','regAlerta'].forEach(id => { const el = _id(id); if (el) { el.textContent=''; el.className='alerta'; } }); }
function _id(id) { return document.getElementById(id); }

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res  = await fetch('api/auth.php?action=sesion', { credentials: 'same-origin' });
    const data = await res.json();
    if (data.ok) { sessionStorage.setItem('integrados_user', JSON.stringify(data)); window.location.href = 'dashboard.html'; return; }
  } catch(e) { console.warn('[Auth] Sin sesión activa'); }
  _mostrarVista('viewLogin');
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && _id('viewLogin') && _id('viewLogin').style.display !== 'none') login(); });
});