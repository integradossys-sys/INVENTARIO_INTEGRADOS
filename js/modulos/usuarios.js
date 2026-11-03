/* ════════════════════════════════════════════════
   USUARIOS — con pestañas por tipo + permisos
════════════════════════════════════════════════ */
function renderUsuarios(){
  const tbody=document.getElementById('tablaUsuarios');if(!tbody)return;
  const PROT=['superadmin'];
  let lista=getUsuarios().filter(u=>!PROT.includes(u.usuario.toLowerCase()));

  // Contadores — todos los del rol sin importar estado
  const cntP   =lista.filter(u=>u.estado==='pendiente').length;
  const cntDist=lista.filter(u=>u.rol==='distribuidor'&&u.estado!=='pendiente').length;
  const cntMun =lista.filter(u=>u.rol==='municipio'&&u.estado!=='pendiente').length;
  const cntTec =lista.filter(u=>u.rol==='tecnico'&&u.estado!=='pendiente').length;
  const cntPer =lista.filter(u=>u.rol==='persona'&&u.estado!=='pendiente').length;
  const st=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v||'';};
  st('cntUsrPend',cntP||'');st('cntUsrDist',cntDist||'');st('cntUsrMun',cntMun||'');st('cntUsrTec',cntTec||'');st('cntUsrPer',cntPer||'');

  // Filtro por tab
  if(tabUsuarios==='pendiente')
    lista=lista.filter(u=>u.estado==='pendiente');
  else if(tabUsuarios==='distribuidor')
    lista=lista.filter(u=>u.rol==='distribuidor');
  else if(tabUsuarios==='municipio')
    lista=lista.filter(u=>u.rol==='municipio');
  else if(tabUsuarios==='tecnico')
    lista=lista.filter(u=>u.rol==='tecnico');
  else if(tabUsuarios==='persona')
    lista=lista.filter(u=>u.rol==='persona');
  // todos — muestra absolutamente todos sin filtrar

  // "Crear usuario" es solo del superadmin (el servidor lo exige): quien solo tiene permisos sueltos (ej. aprobar registros) no lo ve.
  const _bCrearU=document.getElementById('btnCrearUsuarioAdmin'); if(_bCrearU) _bCrearU.style.display = sesion?.rol==='superadmin' ? '' : 'none';
  const q=(document.getElementById('buscarUsuario')?.value||'').toLowerCase();
  if(q) lista=lista.filter(u=>u.usuario.toLowerCase().includes(q)||(u.nombre||'').toLowerCase().includes(q)||(u.apellido||'').toLowerCase().includes(q));

  // Función para resaltar coincidencia
  const hl=(txt)=>{
    if(!q||!txt) return esc(txt||'');
    const idx=txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      +`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`
      +esc(txt.slice(idx+q.length));
  };

  if(!lista.length){
    tbody.innerHTML=`<tr><td class="!p-[32px] !text-center !text-[#94A3B8] !text-[13px]" colspan="7">No hay usuarios en esta categoría.</td></tr>`;
    return;
  }

  const clsE={activo:'badge-ok',pendiente:'badge-warn',inactivo:'badge-danger'};
  const lblE={activo:'Activo',pendiente:'Pendiente',inactivo:'Inactivo'};
  const clsT={municipio:'badge-brand',tecnico:'badge-purple',persona:'badge-teal',distribuidor:'badge-ok'};
  const lblT={municipio:'Municipio',tecnico:'Técnico',persona:'Persona',distribuidor:'Distribuidor'};

  tbody.innerHTML=lista.map(u=>{
    const inactivo=u.estado==='inactivo';
    const sedesHTML=u.sedes&&u.sedes.length>1
      ?`<div style="display:flex;flex-wrap:wrap;gap:3px;">${u.sedes.map(s=>`<span class="badge badge-gray !text-[10px] !p-[1px_6px]">${esc(s)}</span>`).join('')}</div>`
      :`<span style="font-size:13px;color:${inactivo?'#94A3B8':'#374151'};">${esc(u.sede||'—')}</span>`;
    const permCount=(u.permisos||[]).length;
    const _puedeAsignarPermisos = sesion?.rol==='superadmin'||tienePermiso('gestionar_usuarios')||tienePermiso('asignar_permisos_usuarios');
    const permHTML=_puedeAsignarPermisos
      ?`<span class="badge badge-purple !cursor-pointer" onclick="abrirModalPermisos('${u.usuario}')" title="Click para editar permisos">${permCount} permisos ✎</span>`
      :`<span class="badge badge-purple !opacity-[.7]" title="No tienes permiso para editar permisos">${permCount} permisos</span>`;

    let acc='';
    // ── Menú dropdown de acciones (renderizado en body para evitar overflow) ──
    const uid = 'um_'+u.usuario.replace(/[^a-z0-9]/gi,'_');
    const menuItem = (icon,label,onclick,color='#0F172A',bg='#F8FAFC') =>
      `<button onclick="cerrarMenusUsuario();${onclick}"
        style="display:flex;align-items:center;gap:8px;width:100%;padding:9px 16px;border:none;background:transparent;cursor:pointer;font-size:13px;color:${color};text-align:left;white-space:nowrap;"
        onmouseover="this.style.background='${bg}'" onmouseout="this.style.background='transparent'">
        ${icon} ${label}
      </button>`;

    // Cada acción revisa su propio permiso — antes "gestionar_usuarios" era
    // un solo interruptor para todo esto; ahora se puede dar por separado.
    const _esSuper = sesion?.rol==='superadmin';
    const _pGestAll = tienePermiso('gestionar_usuarios'); // antiguo, incluye todo
    const _pEditar   = _esSuper||_pGestAll||tienePermiso('editar_usuarios');
    const _pPermisos = _esSuper||_pGestAll||tienePermiso('asignar_permisos_usuarios');
    const _pDesact   = _esSuper||_pGestAll||tienePermiso('desactivar_usuarios');
    const _pEliminar = _esSuper||_pGestAll||tienePermiso('eliminar_usuarios');

    let menuItems = '';
    if(u.estado==='pendiente'){
      menuItems =
        (tienePermiso('aprobar_registros')||_esSuper ? menuItem('✅','Aprobar',`abrirAprobarConRol('${u.usuario}')`, '#166534','#F0FDF4') : '') +
        ((_pEliminar||tienePermiso('aprobar_registros')) ? menuItem('❌','Rechazar',`rechazarUsuario('${u.usuario}')`, '#B91C1C','#FEF2F2') : '');
    } else if(u.estado==='activo'){
      menuItems =
        (_pEditar ? menuItem('✎','Editar',`abrirEditarUsuario('${u.usuario}')`, '#0F172A','#F8FAFC') : '') +
        (u.rol==='tecnico' && _pEditar ? menuItem('📍','Sedes',`abrirEditarSedesTecnico('${u.usuario}')`, '#5B21B6','#F5F3FF') : '') +
        (tienePermiso('cambiar_rol')||_esSuper ? menuItem('🔄','Cambiar rol',`abrirCambiarRol('${u.usuario}','${u.rol}')`, '#0C6EDE','#EFF6FF') : '') +
        (_pDesact ? menuItem('⏸','Desactivar',`desactivarUsuario('${u.usuario}')`, '#92400E','#FFFBEB') : '') +
        (_pEliminar ? `<div class="!h-[1px] ![background:#F1F5F9] !m-[4px_0]"></div>` + menuItem('🗑','Eliminar',`eliminarUsuarioDB('${u.usuario}')`, '#B91C1C','#FEF2F2') : '');
      if(!menuItems) menuItems = `<div class="!p-[9px_16px] !text-[12px] !text-[#94A3B8]">Sin acciones disponibles</div>`;
    } else {
      menuItems =
        (_pDesact ? menuItem('✅','Reactivar',`reactivarUsuario('${u.usuario}')`, '#166534','#F0FDF4') : '') +
        (_pEliminar ? `<div class="!h-[1px] ![background:#F1F5F9] !m-[4px_0]"></div>` + menuItem('🗑','Eliminar',`eliminarUsuarioDB('${u.usuario}')`, '#B91C1C','#FEF2F2') : '');
      if(!menuItems) menuItems = `<div class="!p-[9px_16px] !text-[12px] !text-[#94A3B8]">Sin acciones disponibles</div>`;
    }

    acc = `<button class="![background:#F1F5F9] ![border:1.5px_solid_#E2E8F0] !rounded-[8px] !p-[5px_14px] !cursor-pointer !text-[18px] !text-[#475569] !font-bold !leading-[1]" onclick="event.stopPropagation();abrirMenuUsuario('${uid}',this)"
        title="Acciones" data-menu="${uid}">···</button>
      <div id="${uid}" data-usermenu style="display:none;position:fixed;background:white;border:1.5px solid #E2E8F0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);z-index:9999;min-width:170px;padding:4px 0;overflow:hidden;">
        ${menuItems}
      </div>`;

    return `<tr class="fade-row" style="${inactivo?'opacity:.65;background:#FFF5F5;':''}">
      <td>
        <div style="font-weight:600;color:${inactivo?'#94A3B8':'#0F172A'};">${hl(u.usuario)}</div>
        ${u.cargo?`<div class="!text-[11px] !text-[#94A3B8]">${esc(u.cargo)}</div>`:''}
      </td>
      <td class="!text-[#64748B]">${hl((u.nombre||'').trim()||u.usuario)}${u.apellido?' '+hl(u.apellido):''}</td>
      <td><span class="badge ${clsT[u.rol]||'badge-gray'}">${lblT[u.rol]||u.rol}</span></td>
      <td>${sedesHTML}</td>
      <td class="!text-[11px] !text-[#64748B]">
        ${u.correo?`<div>✉ ${esc(u.correo)}</div>`:''}
        ${u.telefono?`<div>📞 ${esc(u.telefono)}</div>`:''}
        ${!u.correo&&!u.telefono?'<span class="!text-[#CBD5E1]">—</span>':''}
      </td>
      <td><span class="badge ${clsE[u.estado]||'badge-gray'}">${lblE[u.estado]||u.estado}</span></td>
      <td>${inactivo?'—':permHTML}</td>
      <td><div style="display:flex;gap:5px;flex-wrap:wrap;">${acc}</div></td>
    </tr>`;
  }).join('');
}

/* ════════════════════════════════════════════════
   EDITAR USUARIO (admin / quien tenga permiso editar_usuarios)
════════════════════════════════════════════════ */
function abrirEditarUsuario(nombreUsuario){
  // Verificar permiso
  if(!tienePermiso('gestionar_usuarios') && !tienePermiso('editar_usuarios') && sesion?.rol !== 'superadmin'){
    toast('No tienes permiso para editar usuarios.','error'); return;
  }
  const u = getUsuarios().find(x=>x.usuario===nombreUsuario);
  if(!u){ toast('Usuario no encontrado','error'); return; }

  // Llenar formulario
  document.getElementById('euUsuario').value  = u.usuario;
  document.getElementById('euNombre').value   = u.nombre   || '';
  document.getElementById('euApellido').value = u.apellido || '';
  document.getElementById('euCorreo').value   = u.correo   || '';
  document.getElementById('euTelefono').value = u.telefono || '';
  document.getElementById('euCargo').value    = u.cargo    || '';

  // Rol
  const euRol = document.getElementById('euRol');
  if(euRol) euRol.value = u.rol || 'persona';

  // Poblar y seleccionar sede
  const euSede = document.getElementById('euSedeEdit');
  if(euSede){
    euSede.innerHTML = '<option value="">Sin cambiar sede</option>' +
      getSedes().map(s=>`<option value="${s.id}" ${s.nombre===u.sede?'selected':''}>${esc(s.nombre)}</option>`).join('');
  }

  const euLabel = document.getElementById('euUsuarioLabel');
  if(euLabel) euLabel.textContent = '@' + u.usuario;
  const euSub = document.getElementById('euSubtitulo');
  if(euSub) euSub.textContent = u.sede || '';
  // Avatar según rol
  const _avatarEmojis = {superadmin:'👑',distribuidor:'🏢',municipio:'🏛️',tecnico:'🔧',persona:'👤'};
  const _avatarColors = {superadmin:'#2DB82D',distribuidor:'#16A871',municipio:'#BA7517',tecnico:'#7C3AED',persona:'#0F766E'};
  const euAv = document.getElementById('euAvatar');
  if(euAv){
    euAv.textContent = _avatarEmojis[u.rol] || '👤';
    euAv.style.background = (_avatarColors[u.rol] || '#64748B') + '22';
    euAv.style.fontSize = '20px';
  }
  const al = document.getElementById('euAlerta');
  al.style.display = 'none'; al.className = 'alerta';
  document.getElementById('modalEditarUsuario').classList.add('open');
  setTimeout(()=>document.getElementById('euNombre')?.focus(), 200);
}

async function guardarEdicionUsuario(){
  const al = document.getElementById('euAlerta');
  al.style.display='none'; al.className='alerta';

  const usuario  = document.getElementById('euUsuario').value.trim();
  const nombre   = document.getElementById('euNombre').value.trim();
  const apellido = document.getElementById('euApellido').value.trim();
  const correo   = document.getElementById('euCorreo').value.trim();
  const telefono = document.getElementById('euTelefono').value.trim();
  const cargo    = document.getElementById('euCargo').value.trim();
  const rol      = document.getElementById('euRol')?.value || '';
  const sedeId   = document.getElementById('euSedeEdit')?.value || '';

  if(!nombre){ al.textContent='El nombre es obligatorio.'; al.className='alerta error'; al.style.display='block'; return; }
  if(correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)){
    al.textContent='El correo no tiene un formato válido.'; al.className='alerta error'; al.style.display='block'; return;
  }

  try {
    const res = await _api('usuarios','editar', {usuario, nombre, apellido, correo, telefono, cargo});
    if(res.error){ al.textContent=res.error; al.className='alerta error'; al.style.display='block'; return; }

    // Cambiar rol si cambió
    const uActual = getUsuarios().find(x=>x.usuario===usuario);
    if(rol && uActual && rol !== uActual.rol){
      await _api('usuarios','cambiar_rol', {usuario, rol});
    }
    // Cambiar sede solo si realmente es una diferente a la actual
    // (antes se enviaba siempre y fallaba para quien no es superadmin)
    const sedeActual = (getSedes().find(s=>s.nombre===uActual?.sede)||{}).id;
    if(sedeId && String(sedeId)!==String(sedeActual??'')){
      await _api('usuarios','cambiar_sede', {usuario, sede_id: parseInt(sedeId)});
    }

    cerrarModal('modalEditarUsuario');
    await _recargarUsuarios();
    renderUsuarios();
    toast(`Usuario @${usuario} actualizado ✓`, 'success');
  } catch(e){
    al.textContent='Error al guardar: ' + (e && e.message ? e.message : 'intenta de nuevo.'); al.className='alerta error'; al.style.display='block';
  }
}

/* ════════════════════════════════════════════════
   EDITAR SEDES DE TÉCNICO
════════════════════════════════════════════════ */
async function abrirEditarSedesTecnico(usuarioNombre){
  const u = getUsuarios().find(x=>x.usuario===usuarioNombre);
  if(!u){ toast('Usuario no encontrado','error'); return; }

  document.getElementById('estUsuario').value = usuarioNombre;
  document.getElementById('estSubtitulo').textContent = '@'+usuarioNombre+' · '+u.sede;
  const al = document.getElementById('estAlerta');
  al.style.display='none'; al.className='alerta';

  // Cargar chips de sedes
  const chips = document.getElementById('estSedesChips');
  const sedes = await _cargarSedes();
  // Asegurar que sedesActuales sea siempre un array
  let sedesActuales = u.sedes || [u.sede];
  if(!Array.isArray(sedesActuales)) sedesActuales = [sedesActuales];

  chips.innerHTML = sedes.filter(s=>s.activa||s.activa==1).map(s=>{
    const marcada = sedesActuales.includes(s.nombre);
    return `<div id="chip_est_${s.id}"
      data-id="${s.id}" data-nombre="${s.nombre}" data-marcada="${marcada?'1':'0'}"
      onclick="estToggleChip(this)"
      style="padding:6px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:${marcada?'600':'400'};
        color:${marcada?'#5B21B6':'#475569'};transition:all .15s;user-select:none;
        background:${marcada?'#EDE9FE':'#F8FAFC'};border:1.5px solid ${marcada?'#7C3AED':'#E2E8F0'};">
      ${s.nombre}
    </div>`;
  }).join('');

  document.getElementById('modalEditarSedesTecnico').classList.add('open');
}

function estToggleChip(el){
  const marcada = el.dataset.marcada === '1';
  el.dataset.marcada = marcada ? '0' : '1';
  el.style.background    = !marcada ? '#EDE9FE' : '#F8FAFC';
  el.style.borderColor   = !marcada ? '#7C3AED' : '#E2E8F0';
  el.style.color         = !marcada ? '#5B21B6' : '#475569';
  el.style.fontWeight    = !marcada ? '600'     : '400';
}

async function guardarSedesTecnico(){
  const usuario = document.getElementById('estUsuario').value;
  const al = document.getElementById('estAlerta');
  al.style.display='none';

  const sedesIds = Array.from(document.querySelectorAll('#estSedesChips div[data-marcada="1"]'))
    .map(d=>parseInt(d.dataset.id));
  const sedeNombres = Array.from(document.querySelectorAll('#estSedesChips div[data-marcada="1"]'))
    .map(d=>d.dataset.nombre);

  if(!sedesIds.length){
    al.textContent='Selecciona al menos una sede.'; al.className='alerta error'; al.style.display='';
    return;
  }

  try{
    const res = await _api('usuarios','editar_sedes_tecnico', {
      usuario, sede_id: sedesIds[0], sedes_ids: sedesIds
    });
    if(res.error){ al.textContent=res.error; al.className='alerta error'; al.style.display=''; return; }
    await _recargarUsuarios();
    cerrarModal('modalEditarSedesTecnico');
    renderTecnicosPersonas('tecnico');
    renderUsuarios();
    toast(`Sedes de @${usuario} actualizadas ✓`,'success');
  }catch(e){
    al.textContent='Error al guardar. Intenta de nuevo.'; al.className='alerta error'; al.style.display='';
  }
}

function setTabUsuarios(t){
  tabUsuarios=t;
  ['todos','pendiente','distribuidor','municipio','tecnico','persona'].forEach(id=>{const b=document.getElementById('tabUsr_'+id);if(b)b.classList.toggle('active',id===t);});
  renderUsuarios();
}

/* ════════════════════════════════════════════════
   MODAL PERMISOS
════════════════════════════════════════════════ */
function abrirModalPermisos(nombreUsuario){
  const u=getUsuarios().find(x=>x.usuario===nombreUsuario);if(!u)return;
  permisosUsuarioActual=nombreUsuario;
  setText('modalPermisosTitle',`Permisos de "${nombreUsuario}"`);
  setText('modalPermisosSubtitle',`Rol: ${u.rol} · ${u.cargo||''}`);
  const permActuales=(Array.isArray(u.permisos) && u.permisos.length) ? u.permisos : (PERMISOS_DEFAULT[u.rol]||[]);
  const grid=document.getElementById('permisosGrid');if(!grid)return;
  grid.innerHTML=Object.entries(PERMISOS_DISPONIBLES).map(([key,label])=>{
    const checked=permActuales.includes(key);
    return `<label class="perm-item ${checked?'checked':''}" id="perm_${key}"><input type="checkbox" value="${key}" ${checked?'checked':''} onchange="_permCheckboxCambio(this)"><div class="perm-check-box">${checked?`<svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="3"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg>`:''}</div><span class="!text-[12.5px] !text-[#374151]" data-label="${esc(label)}">${esc(label)}</span></label>`;
  }).join('');
  const buscar=document.getElementById('permisosBuscar'); if(buscar) buscar.value='';
  const cont=document.getElementById('permisosContador'); if(cont) cont.textContent='';
  document.getElementById('modalPermisos').classList.add('open');
}
function _filtrarPermisosGrid(){
  const q=(document.getElementById('permisosBuscar')?.value||'').toLowerCase().trim();
  const items=document.querySelectorAll('#permisosGrid .perm-item');
  let visibles=0;
  items.forEach(item=>{
    const span=item.querySelector('span[data-label]');
    if(!span) return;
    const label=span.dataset.label;
    const coincide=!q || label.toLowerCase().includes(q);
    item.style.display=coincide?'':'none';
    if(coincide) visibles++;
    if(!q){
      span.innerHTML=esc(label);
    } else {
      const idx=label.toLowerCase().indexOf(q);
      if(idx<0){ span.innerHTML=esc(label); }
      else{
        span.innerHTML=esc(label.slice(0,idx))
          +`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_1px]">${esc(label.slice(idx,idx+q.length))}</mark>`
          +esc(label.slice(idx+q.length));
      }
    }
  });
  const cont=document.getElementById('permisosContador');
  if(cont) cont.textContent = q ? `${visibles} de ${items.length}` : '';
}
function _permCheckboxCambio(cb){
  const label=cb.closest('.perm-item');if(!label)return;
  label.classList.toggle('checked',cb.checked);
  const box=label.querySelector('.perm-check-box');if(box)box.innerHTML=cb.checked?`<svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="3"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg>`:'';
}
function aplicarPerfilBase(perfil){
  const perfiles={
    municipio:    PERMISOS_DEFAULT.municipio,
    tecnico:      PERMISOS_DEFAULT.tecnico,
    distribuidor: PERMISOS_DEFAULT.distribuidor,
    persona:      PERMISOS_DEFAULT.persona,
    todos:        Object.keys(PERMISOS_DISPONIBLES),
    ninguno:      []
  };
  const sel=perfiles[perfil]||[];
  Object.keys(PERMISOS_DISPONIBLES).forEach(key=>{
    const label=document.getElementById('perm_'+key),cb=label?.querySelector('input[type="checkbox"]');if(!label||!cb)return;
    cb.checked=sel.includes(key);label.classList.toggle('checked',cb.checked);
    const box=label.querySelector('.perm-check-box');if(box)box.innerHTML=cb.checked?`<svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="white" stroke-width="3"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg>`:'';
  });
}
async function guardarPermisos(){
  if(!permisosUsuarioActual)return;
  const nuevosPermisos=Array.from(document.querySelectorAll('#permisosGrid input[type="checkbox"]:checked')).map(cb=>cb.value);
  const ok=await asignarPermisos(permisosUsuarioActual,nuevosPermisos);
  if(ok){
    cerrarModal('modalPermisos');renderUsuarios();updateNotifBadges();
    toast(`Permisos de "${permisosUsuarioActual}" actualizados ✓`,'success');
  } else { toast('Error al guardar permisos','error'); }
  permisosUsuarioActual=null;
}

/* ════════════════════════════════════════════════
   GESTIÓN DE OFICINAS
════════════════════════════════════════════════ */

function setTabOficinas(t){
  tabOficinas=t;
  ['sedes','tecnicos','personas'].forEach(id=>{
    const b=document.getElementById('tabOf_'+id);
    if(b)b.classList.toggle('active',id===t);
    const panel=document.getElementById('ofTab_'+id);
    if(panel)panel.style.display=id===t?'':'none';
  });
  // Cambiar botón según tab
  const btnWrap=document.getElementById('btnOficinaWrap');
  if(btnWrap){
    if(t==='sedes')
      btnWrap.innerHTML=tienePermiso('crear_oficinas')?`<button onclick="abrirModalOficina()" class="btn btn-primary">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
        Nueva oficina</button>`:'';
    else if(t==='tecnicos')
      btnWrap.innerHTML=tienePermiso('crear_tecnicos')?`<button onclick="abrirModalCrearTecnico()" class="btn btn-purple">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
        Nuevo técnico</button>`:'';
    else
      btnWrap.innerHTML=tienePermiso('crear_personas')?`<button onclick="abrirModalCrearPersona()" class="btn ![background:linear-gradient(135deg,#0F766E,#14B8A6)] ![color:white]">
        <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
        Nuevo personal</button>`:'';
  }
  if(t==='sedes')    renderOficinas();
  if(t==='tecnicos') renderTecnicosPersonas('tecnico');
  if(t==='personas') renderTecnicosPersonas('persona');
}

let _subTabSedes='todas';
function setSubTabSedes(sub){
  _subTabSedes=sub;
  ['todas','distribuidor','municipio'].forEach(id=>{
    const b=document.getElementById('tabOfSub_'+id);
    if(b)b.classList.toggle('active',id===sub);
  });
  renderOficinas();
}

function renderOficinas(){
  const grid=document.getElementById('oficinasGrid');if(!grid)return;
  // Ocultar sedes internas del sistema
  const SEDES_OCULTAS = ['Administración','Sistema'];
  let sedes=getSedes().filter(s=>!SEDES_OCULTAS.includes(s.nombre));
  if(_subTabSedes==='distribuidor')   sedes=sedes.filter(s=>s.tipo==='distribuidor'||s.tipo==='central');
  if(_subTabSedes==='municipio') sedes=sedes.filter(s=>s.tipo==='municipio');
  if(!sedes.length){
    grid.innerHTML=`<div class="![grid-column:1/-1] !text-center !text-[#94A3B8] !text-[13px] !p-[32px]">No hay sedes en esta categoría.</div>`;
    return;
  }
  const usuarios=getUsuarios();
  const productos=getProductos();
  grid.innerHTML=sedes.map(s=>{
    const usrSede=usuarios.filter(u=>(u.sedes?.includes(s.nombre)||u.sede===s.nombre)&&u.estado!=='pendiente');
    const municipios=usrSede.filter(u=>u.rol==='municipio');
    const tecnicos  =usrSede.filter(u=>u.rol==='tecnico');
    const personas  =usrSede.filter(u=>u.rol==='persona');
    const stockSede =productos.reduce((sum,p)=>sum+(p.stock?.[s.nombre]||0),0);
    const tipoBadge =(s.tipo==='distribuidor'||s.tipo==='central')?`<span class="badge badge-ok">Central</span>`:`<span class="badge badge-brand">Municipio</span>`;
    const tieneInactivos=usrSede.filter(u=>u.estado==='inactivo').length>0;
    const todosInactivos=usrSede.length>0&&usrSede.every(u=>u.estado==='inactivo');
    const estadoBadge=!s.activa
      ?`<span class="badge badge-danger !text-[10px]">Inactiva</span>`
      :todosInactivos
      ?`<span class="badge badge-danger !text-[10px]">Inactiva</span>`
      :tieneInactivos
      ?`<span class="badge !text-[10px] ![background:#FEF3C7] !text-[#92400E]">Parcial</span>`
      :`<span class="badge badge-ok !text-[10px]">Activa</span>`;

    return `<div class="sede-card ${!s.activa?'inactiva':''}" style="cursor:default;">
      <div class="!flex !items-start !justify-between !mb-[10px]">
        <div>
          <div class="![font-family:Syne,sans-serif] !font-bold !text-[15px] !text-[#0F172A]">${esc(s.nombre)}</div>
          <div class="!mt-[4px] !flex !gap-[5px]">${tipoBadge} ${estadoBadge}</div>
          ${s.descripcion?`<div class="!mt-[6px] !text-[11px] !text-[#94A3B8] !leading-[1.3]">${esc(s.descripcion)}</div>`:''}
        </div>
        <div style="width:36px;height:36px;background:${s.activa?'#E8F8E8':'#F1F5F9'};border-radius:9px;display:flex;align-items:center;justify-content:center;">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="${s.activa?'#2DB82D':'#94A3B8'}" stroke-width="2"><path stroke-linecap="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg>
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
        ${usrSede.filter(u=>u.rol==='municipio'&&u.estado==='activo').length?`<span class="badge badge-brand !text-[10px]">${usrSede.filter(u=>u.rol==='municipio'&&u.estado==='activo').length} municipio${usrSede.filter(u=>u.rol==='municipio'&&u.estado==='activo').length!==1?'s':''}</span>`:''}
        ${usrSede.filter(u=>u.rol==='tecnico'&&u.estado==='activo').length?`<span class="badge badge-purple !text-[10px]">${usrSede.filter(u=>u.rol==='tecnico'&&u.estado==='activo').length} técnico${usrSede.filter(u=>u.rol==='tecnico'&&u.estado==='activo').length!==1?'s':''}</span>`:''}
        ${usrSede.filter(u=>u.rol==='persona'&&u.estado==='activo').length?`<span class="badge badge-teal !text-[10px]">${usrSede.filter(u=>u.rol==='persona'&&u.estado==='activo').length} persona${usrSede.filter(u=>u.rol==='persona'&&u.estado==='activo').length!==1?'s':''}</span>`:''}
        ${usrSede.filter(u=>u.estado==='inactivo').length?`<span class="badge badge-danger !text-[10px]">${usrSede.filter(u=>u.estado==='inactivo').length} inactivo${usrSede.filter(u=>u.estado==='inactivo').length!==1?'s':''}</span>`:''}
        ${!usrSede.length?`<span class="!text-[11px] !text-[#94A3B8]">Sin usuarios</span>`:''}
      </div>
      <div class="!text-[12px] !mb-[10px]">
        ${stockSede>0?`<span class="!text-[#2DB82D] !font-semibold">${stockSede} uds.</span> <span class="!text-[#94A3B8]">en stock</span>`:`<span class="!text-[#94A3B8]">Sin stock asignado</span>`}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <button class="btn-sm sede-ver-detalle ![background:#E8F8E8] !text-[#1E8F1E] !font-semibold" data-id="${s.id}">
          👁 Ver detalle
        </button>
      ${(()=>{
        // El almacén central (tipo='central') nunca se desactiva ni se
        // elimina — es donde opera superadmin. Ni se muestra la opción.
        if(s.tipo==='central'||s.nombre==='Almacen Central') return `<span class="!text-[11px] !text-[#94A3B8] ![font-style:italic]">🏭 Almacén central — protegido</span>`;
        // El botón refleja el estado real: si hay usuarios inactivos → Activar, si todos activos → Desactivar sede
        const tieneInactivos=usrSede.filter(u=>u.estado==='inactivo').length>0;
        const todosInactivos=usrSede.length>0&&usrSede.every(u=>u.estado==='inactivo');
        const btnEliminar=tienePermiso('eliminar_sedes')?`<button onclick="eliminarSede(${s.id},'${esc(s.nombre)}')" class="btn-sm ![background:#FEF2F2] !text-[#991B1B] !font-semibold">🗑 Eliminar</button>`:'';
        if(!s.activa){
          if(!tienePermiso('desactivar_sedes')) return btnEliminar;
          return `<div style="display:flex;flex-direction:column;gap:4px;">
            <button class="btn-sm btn-toggle-sede ![background:#E8F8E8] !text-[#1E8F1E] !font-semibold" data-id="${s.id}" data-activa="0">✓ Activar</button>
            ${btnEliminar}
          </div>`;
        } else if(tieneInactivos){
          const inactivos=usrSede.filter(u=>u.estado==='inactivo');
          if(inactivos.length===1)
            return `<button onclick="reactivarUsuario('${inactivos[0].usuario}')" class="btn-sm ![background:#E8F8E8] !text-[#1E8F1E] !font-semibold">✓ Activar ${esc(inactivos[0].usuario)}</button>`;
          return `<button onclick="abrirSedeDrawer(${s.id})" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6] !font-semibold">✓ Activar (${inactivos.length})</button>`;
        } else {
          if(!tienePermiso('desactivar_sedes')) return btnEliminar;
          return `<div style="display:flex;flex-direction:column;gap:4px;">
            <button class="btn-sm btn-toggle-sede ![background:#FCEBEB] !text-[#B91C1C] !font-semibold" data-id="${s.id}" data-activa="1">⛔ Desactivar</button>
            ${btnEliminar}
          </div>`;
        }
      })()}
      </div>
    </div>`;
  }).join('');

  // Asignar eventos
  grid.querySelectorAll('.sede-ver-detalle').forEach(b=>{
    b.addEventListener('click', ()=>abrirSedeDrawer(parseInt(b.dataset.id)));
  });
  grid.querySelectorAll('.btn-toggle-sede').forEach(b=>{
    b.addEventListener('click', ()=>{
      const sedeId=b.dataset.id;
      const activa=b.dataset.activa==='1';
      const sede=getSedes().find(s=>s.id==sedeId);
      const nombre=sede?.nombre||'esta sede';
      if(activa){
        mostrarConfirmar({
          icono:'⛔', color:'#E24B4A',
          titulo:`Desactivar ${nombre}`,
          desc:`¿Desactivar la sede "${nombre}"? Sus usuarios también serán desactivados y no podrán ingresar.`,
          btnTxt:'Desactivar sede', btnColor:'#E24B4A',
          onConfirmar:()=>toggleOficina(sedeId, false)
        });
      } else {
        mostrarConfirmar({
          icono:'✅', color:'#2DB82D',
          titulo:`Activar ${nombre}`,
          desc:`¿Activar la sede "${nombre}"? Sus usuarios serán reactivados automáticamente.`,
          btnTxt:'Activar sede', btnColor:'#2DB82D',
          onConfirmar:()=>toggleOficina(sedeId, true)
        });
      }
    });
  });
}

function cerrarSedeDrawer(){ cerrarModal('modalSede'); }

function abrirSedeDrawer(sedeId){
  const sedes=getSedes();
  const s=sedes.find(x=>x.id==sedeId);
  if(!s) return;
  const usuarios=getUsuarios();
  const productos=getProductos();
  const usrSede=usuarios.filter(u=>(u.sedes?.includes(s.nombre)||u.sede===s.nombre)&&u.estado!=="pendiente");
  const activos=usrSede.filter(u=>u.estado==="activo").length;
  const inactivos=usrSede.filter(u=>u.estado==="inactivo").length;
  const stockSede=productos.reduce((sum,p)=>sum+(p.stock?.[s.nombre]||0),0);
  const conStock=productos.filter(p=>(p.stock?.[s.nombre]||0)>0).length;

  document.getElementById("modalSedeNombre").textContent=s.nombre;
  const tipoBadge=s.tipo==="distribuidor"||s.tipo==="central"
    ?'<span class="![background:rgba(255,255,255,.2)] ![color:white] !p-[2px_10px] !rounded-[99px] !text-[11px] !font-semibold">Central</span>'
    :'<span class="![background:rgba(255,255,255,.2)] ![color:white] !p-[2px_10px] !rounded-[99px] !text-[11px] !font-semibold">Municipio</span>';
  const estadoBadge=s.activa
    ?'<span class="![background:rgba(45,184,45,.3)] !text-[#B9F5B9] !p-[2px_10px] !rounded-[99px] !text-[11px] !font-semibold">✓ Activa</span>'
    :'<span class="![background:rgba(226,75,74,.3)] !text-[#FCA5A5] !p-[2px_10px] !rounded-[99px] !text-[11px] !font-semibold">⛔ Inactiva</span>';
  document.getElementById("modalSedeBadges").innerHTML=tipoBadge+estadoBadge;

  document.getElementById("modalSedeStats").innerHTML=`
    <div class="![background:rgba(255,255,255,.12)] !rounded-[12px] !p-[12px] !text-center">
      <div style="font-family:Syne,sans-serif;font-weight:800;font-size:22px;color:white;">${activos}</div>
      <div class="!text-[11px] !text-[rgba(255,255,255,.7)]">Usuarios activos</div>
    </div>
    <div class="![background:rgba(255,255,255,.12)] !rounded-[12px] !p-[12px] !text-center">
      <div style="font-family:Syne,sans-serif;font-weight:800;font-size:22px;color:white;">${stockSede}</div>
      <div class="!text-[11px] !text-[rgba(255,255,255,.7)]">Unidades en stock</div>
    </div>
    <div class="![background:rgba(255,255,255,.12)] !rounded-[12px] !p-[12px] !text-center">
      <div style="font-family:Syne,sans-serif;font-weight:800;font-size:22px;color:white;">${conStock}</div>
      <div class="!text-[11px] !text-[rgba(255,255,255,.7)]">Productos distintos</div>
    </div>`;

  document.getElementById("modalSedeAccion").innerHTML=s.activa
    ?`<button class="![background:rgba(255,255,255,.15)] ![color:white] ![border:1px_solid_rgba(255,255,255,.3)] !p-[6px_14px] !rounded-[8px] !cursor-pointer !text-[12px]" onclick="toggleOficina(${s.id},false);cerrarSedeDrawer();">Desactivar sede</button>`
    :`<button class="![background:rgba(45,184,45,.3)] !text-[#B9F5B9] ![border:1px_solid_rgba(45,184,45,.4)] !p-[6px_14px] !rounded-[8px] !cursor-pointer !text-[12px]" onclick="toggleOficina(${s.id},true);cerrarSedeDrawer();">✓ Reactivar sede</button>`;

  const clsT={municipio:"badge-brand",tecnico:"badge-purple",persona:"badge-teal",distribuidor:"badge-ok"};
  document.getElementById("modalSedeContenido").innerHTML=`
    <div class="!mb-[20px]">
      <div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !tracking-[.06em] !mb-[10px]">
        👥 Usuarios (${usrSede.length})${inactivos?` <span class="badge badge-danger !text-[10px]">${inactivos} inactivo${inactivos!==1?"s":""}</span>`:""}
      </div>
      ${!usrSede.length
        ?'<div style="text-align:center;padding:20px;color:#94A3B8;font-size:13px;background:#F8FAFC;border-radius:12px;">Sin usuarios en esta sede</div>'
        :`<div style="display:flex;flex-direction:column;gap:6px;">${usrSede.map(u=>{
            const activo=u.estado==="activo";
            return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:${activo?"#F8FFFE":"#FFF5F5"};border-radius:12px;border:1.5px solid ${activo?"#E0F5E0":"#FECACA"};">
              <div style="width:38px;height:38px;border-radius:11px;background:${activo?"linear-gradient(135deg,#2DB82D,#1E8F1E)":"#FEE2E2"};display:flex;align-items:center;justify-content:center;font-family:Syne,sans-serif;font-weight:800;font-size:14px;color:${activo?"white":"#B91C1C"};flex-shrink:0;">
                ${(u.usuario||"?")[0].toUpperCase()}
              </div>
              <div class="![flex:1]">
                <div class="!font-bold !text-[13px]">${esc(u.usuario)}</div>
                <div class="!text-[11px] !text-[#94A3B8]">${esc(u.nombre||"")} ${esc(u.apellido||"")}${u.cargo?" · "+esc(u.cargo):""}</div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
                <span class="badge ${clsT[u.rol]||"badge-gray"}" style="font-size:10px;">${u.rol}</span>
                ${!activo?'<span class="!text-[10px] !text-[#B91C1C] !font-semibold">Inactivo</span>':""}
              </div>
            </div>`;
          }).join("")}</div>`}
    </div>
    <div class="!mb-[20px]">
      <div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !tracking-[.06em] !mb-[10px]">📡 ONT y fibra</div>
      <div id="sedeEquiposResumen" class="!text-[13px] !text-[#94A3B8]">Cargando…</div>
    </div>
    <div>
      <div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !tracking-[.06em] !mb-[10px]">📦 Productos en stock</div>
      <div style="display:flex;flex-direction:column;gap:5px;">
        ${productos.map(p=>{
          const cant=p.stock?.[s.nombre]||0, suf=p.unidad==="metros"?"mts.":"uds.";
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;background:${cant>0?"#F8FFFE":"#FAFAFA"};border-radius:10px;border:1.5px solid ${cant>0?"#E0F5E0":"#F1F5F9"};">
            <div class="!flex !items-center !gap-[8px]">
              <span class="![font-family:monospace] !text-[10px] ![background:#F1F5F9] !p-[2px_7px] !rounded-[5px]">${esc(p.ref)}</span>
              <span style="font-weight:600;font-size:13px;color:${cant>0?"#0F172A":"#94A3B8"};">${esc(p.nombre)}</span>
            </div>
            <span class="badge ${cant>0?"badge-ok":"badge-danger"}" style="font-size:11px;">${cant} ${suf}</span>
          </div>`;
        }).join("")}
        ${!productos.length?'<div class="!text-center !p-[16px] !text-[#94A3B8] !text-[13px]">Sin productos registrados</div>':""}
      </div>
    </div>
  `;
  document.getElementById("modalSede").classList.add("open");
  _cargarResumenEquiposSede(s.nombre);
}
// Solo cantidades: ONTs por estado + carretes de fibra de la sede.
async function _cargarResumenEquiposSede(nombre){
  const box=document.getElementById('sedeEquiposResumen');
  if(!box) return;
  try{
    const res=await fetch('api/sedes.php?action=resumen_equipos&sede='+encodeURIComponent(nombre),{credentials:'same-origin'});
    const d=await res.json();
    if(d.error){ box.textContent='No se pudo cargar.'; return; }
    const lbl={disponible:'Disponibles',despachada:'Despachadas',ocupado:'Instaladas',comodato:'Comodato',dañado:'Dañadas',no_disponible:'No disponibles'};
    const onts=d.onts||{};
    const totalOnt=Object.values(onts).reduce((a,b)=>a+b,0);
    const fila=(txt,n,suf)=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 14px;background:${n>0?'#F8FFFE':'#FAFAFA'};border-radius:10px;border:1.5px solid ${n>0?'#E0F5E0':'#F1F5F9'};margin-bottom:5px;"><span style="font-weight:600;font-size:13px;color:${n>0?'#0F172A':'#94A3B8'};">${txt}</span><span class="badge ${n>0?'badge-ok':'badge-danger'}" style="font-size:11px;">${n} ${suf}</span></div>`;
    const estados=Object.keys(onts).sort().map(e=>`<span class="!text-[11px] !text-[#64748B]">${lbl[e]||esc(e)}: <strong>${onts[e]}</strong></span>`).join(' · ');
    const fib=Array.isArray(d.fibra)?d.fibra:[];
    const filasFib=fib.length
      ? fib.map(f=>fila('🧵 '+esc(f.categoria)+` <span class="!text-[11px] !font-normal !text-[#94A3B8]">(${f.carretes} ${f.carretes===1?'carrete':'carretes'})</span>`,fmtNum(f.metros),'mts.')).join('')
      : fila('🧵 Fibra',0,'0 mts.');
    box.innerHTML=
      fila('📡 ONT',totalOnt,'uds.')+(estados?`<div class="!mb-[6px] !p-[0_4px]">${estados}</div>`:'')+
      filasFib;
  }catch(e){ box.textContent='No se pudo cargar.'; }
}


/* ── Técnicos y Personal por tarjeta expandible ── */
function renderTecnicosPersonas(tipo){
  const gridId = tipo==='tecnico'?'tecnicosGrid':'personasGrid';
  const buscId = tipo==='tecnico'?'buscarTecnico':'buscarPersona';
  const grid   = document.getElementById(gridId);if(!grid)return;
  const q      = (document.getElementById(buscId)?.value||'').toLowerCase().trim();

  let lista = getUsuarios().filter(u=>u.rol===tipo && u.estado!=='pendiente');
  if(q) lista=lista.filter(u=>
    u.usuario.toLowerCase().includes(q)||
    (u.nombre||'').toLowerCase().includes(q)||
    (u.apellido||'').toLowerCase().includes(q)
  );

  if(!lista.length){
    grid.innerHTML=`<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[32px]">
      No hay ${tipo==='tecnico'?'técnicos':'personal general'}${q?' con ese nombre':' registrados'}.
    </div>`;
    return;
  }

  const clsT={tecnico:'badge-purple',persona:'badge-teal'};
  const productos=getProductos();

  // Resaltar coincidencia de búsqueda
  const hlT=(txt)=>{
    if(!q||!txt) return esc(txt||'');
    const idx=txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      +`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`
      +esc(txt.slice(idx+q.length));
  };

  grid.innerHTML=lista.map(u=>{
    const sedes     = u.sedes||[u.sede];
    const activo    = u.estado==='activo';
    const stockTotal= activo ? sedes.reduce((sum,s)=>
      sum+productos.reduce((ps,p)=>ps+(p.stock?.[s]||0),0),0) : 0;

    return `<div class="pcard" style="margin-bottom:0;${!activo?'opacity:.75;border-color:#FECACA!important;':''}">
      <div style="padding:14px 18px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;cursor:pointer;" onclick="toggleDetalleUsuario('usr_${u.usuario}')">
        <div class="!flex !items-center !gap-[12px]">
          <div style="width:40px;height:40px;border-radius:11px;background:${!activo?'#F1F5F9':tipo==='tecnico'?'#EDE9FE':'#CCFBF1'};display:flex;align-items:center;justify-content:center;font-family:Syne,sans-serif;font-weight:800;font-size:14px;color:${!activo?'#94A3B8':tipo==='tecnico'?'#5B21B6':'#0F766E'};flex-shrink:0;">
            ${(u.nombre||u.usuario).substring(0,2).toUpperCase()}
          </div>
          <div>
            <div style="font-weight:700;font-size:14px;color:${activo?'#0F172A':'#94A3B8'};">
              ${hlT(u.nombre||'')} ${hlT(u.apellido||'')}
              <span class="!text-[12px] !text-[#94A3B8] !font-normal">@${hlT(u.usuario)}</span>
            </div>
            <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;align-items:center;">
              <span class="badge ${activo?clsT[u.rol]:'badge-danger'}" style="font-size:10px;">
                ${activo?(u.rol==='tecnico'?'Técnico':'Personal'):'⛔ Desactivado'}
              </span>
              ${u.cargo?`<span class="!text-[11px] !text-[#64748B]">${esc(u.cargo)}</span>`:''}
              ${sedes.length>1
                ?`<span class="!text-[11px] !text-[#94A3B8]">${sedes.length} sedes</span>`
                :`<span class="!text-[11px] !text-[#94A3B8]">${esc(sedes[0]||'—')}</span>`}
            </div>
          </div>
        </div>
        <div class="!flex !items-center !gap-[8px]" onclick="event.stopPropagation();">
          ${activo
            ? `<div class="!flex !items-center !gap-[8px]">
                <div class="!text-right ![cursor:default]" onclick="event.stopPropagation();toggleDetalleUsuario('usr_${u.usuario}')">
                  <div style="font-family:Syne,sans-serif;font-weight:800;font-size:18px;color:${stockTotal>0?'#2DB82D':'#94A3B8'};">${stockTotal}</div>
                  <div class="!text-[10px] !text-[#94A3B8]">uds. totales</div>
                </div>
                ${tipo==='tecnico'?`<button onclick="event.stopPropagation();abrirEditarSedesTecnico('${u.usuario}')" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6]" title="Cambiar sedes">📍 Sedes</button>`:''}
               </div>`
            : `<span class="!text-[11px] !text-[#E24B4A] ![background:#FCEBEB] !p-[4px_10px] !rounded-[8px] !font-semibold">Inactivo</span>`
          }
          <svg id="chevron_usr_${u.usuario}" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#94A3B8" stroke-width="2" style="transition:transform .2s;flex-shrink:0;cursor:pointer;" onclick="toggleDetalleUsuario('usr_${u.usuario}')"><path stroke-linecap="round" d="M19 9l-7 7-7-7"/></svg>
        </div>
      </div>
      <div id="detalleUsr_usr_${u.usuario}" style="display:none;border-top:1px solid #E8F4E8;padding:14px 18px;">
        <div class="!mb-[14px]">
          <div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !tracking-[.06em] !mb-[8px]">Sedes asignadas</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${sedes.map(s=>`<span class="badge badge-brand !text-[11px]">${esc(s)}</span>`).join('')}
          </div>
        </div>
        <div>
          <div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !tracking-[.06em] !mb-[8px]">Productos a cargo</div>
          ${(()=>{
            if(!activo) return `<div class="!text-[12px] !text-[#E24B4A] !p-[8px_0]">⛔ Usuario inactivo — sin acceso al inventario.</div>`;
            const rows=[];
            sedes.forEach(s=>{
              const conStock=productos.filter(p=>(p.stock?.[s]||0)>0);
              if(conStock.length){
                rows.push(`<div class="!text-[11px] !font-semibold !text-[#2D6E2D] !m-[8px_0_4px]">${esc(s)}</div>`);
                conStock.forEach(p=>{
                  const cant=p.stock[s], suf=p.unidad==='metros'?'mts.':'uds.';
                  rows.push(`<div class="!flex !items-center !justify-between !p-[5px_10px] ![background:#F8FAF8] !rounded-[7px] !mb-[3px]">
                    <div><span class="![font-family:monospace] !text-[10px] ![background:#F1F5F9] !p-[1px_5px] !rounded-[4px] !mr-[6px]">${esc(p.ref)}</span><span class="!text-[12px] !font-semibold">${esc(p.nombre)}</span></div>
                    <span class="badge ${cant===0?'badge-danger':'badge-ok'}" style="font-size:11px;">${cant} ${suf}</span>
                  </div>`);
                });
              }
            });
            if(!rows.length) return `<div class="!text-[12px] !text-[#94A3B8]">Sin stock en sus sedes actualmente.</div>`;
            return rows.join('');
          })()}
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleDetalleUsuario(key){
  const el      = document.getElementById(`detalleUsr_${key}`);
  const chevron = document.getElementById(`chevron_${key}`);
  if(!el)return;
  const visible = el.style.display!=='none';
  el.style.display = visible?'none':'';
  if(chevron) chevron.style.transform = visible?'':'rotate(180deg)';
}
function abrirModalOficina(){
  const inp=document.getElementById('oficinaNombre'),desc=document.getElementById('oficinaDesc');
  if(inp)inp.value='';if(desc)desc.value='';selectTipoOficina('municipio');

  // Ocultar opción Central si ya existe un distribuidor
  const yaHayDistribuidor = getSedes().some(s=>s.tipo==='distribuidor'||s.tipo==='central');
  const lblCentral = document.getElementById('labelOfCentral');
  if(lblCentral) lblCentral.style.display = yaHayDistribuidor ? 'none' : '';

  document.getElementById('modalOficina').classList.add('open');
}

function eliminarSede(id, nombre){
  mostrarConfirmar({
    icono:'🗑', color:'#B91C1C',
    titulo:'Eliminar sede',
    desc:`¿Eliminar la sede "${nombre}" permanentemente? Esta acción no se puede deshacer.`,
    btnTxt:'Sí, eliminar',
    btnColor:'#B91C1C',
    requirePassword:true,
    onConfirmar: async()=>{
      try{
        const res = await _api('sedes','eliminar',{id});
        if(res.error){ toast(res.error,'error'); return; }
        toast(`Sede "${nombre}" eliminada`,'success');
      }catch(e){
        toast(e.message||'Error al eliminar la sede','error');
        return;
      } finally {
        _sedesCache = null;
        await _cargarSedes();
        renderOficinas(); renderStats();
      }
    }
  });
}

async function guardarOficina(){
  const nombre=(document.getElementById('oficinaNombre')?.value||'').trim();
  const tipo=document.querySelector('input[name="tipoOficina"]:checked')?.value||'municipio';
  const desc=(document.getElementById('oficinaDesc')?.value||'').trim();
  if(!nombre){toast('El nombre de la oficina es obligatorio.','error');return;}
  try{
    await _api('sedes','crear',{nombre,tipo,descripcion:desc});
    _sedesCache=null;
    await _cargarSedes();
    cerrarModal('modalOficina');
    renderOficinas();
    _poblarFiltroMunicipios();
    _poblarSelectEnvio();
    // También actualizar selects del modal de envío múltiple
    const emSel=document.getElementById('emSedeDestino');
    if(emSel){
      const sedes=getSedesMunicipio();
      emSel.innerHTML='<option value="">Seleccionar municipio…</option>'+
        sedes.map(s=>`<option>${esc(s.nombre)}</option>`).join('');
    }
    toast(`Oficina "${nombre}" creada ✓ — ya disponible en el sistema`,'success');
  }catch(e){toast(e.message||'Error al crear oficina','error');}
}

/* ── Crear Técnico desde gestión de oficinas ── */
async function abrirModalCrearTecnico(){
  ['ctNombre','ctApellido','ctUsuario','ctPassword','ctCargo'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  const alerta=document.getElementById('ctAlerta');
  if(alerta){alerta.style.display='none';alerta.textContent='';}

  // Poblar chips de sedes
  const chips=document.getElementById('ctSedesChips');
  if(chips){
    const sedes=getSedes().filter(s=>s.activa==1);
    chips.innerHTML=sedes.map(s=>`
      <label class="sede-chip" onclick="toggleChipOf(this,'ct')">
        <input type="checkbox" value="${s.id}" data-nombre="${esc(s.nombre)}">
        <svg width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" class="chip-check !hidden"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg>
        ${esc(s.nombre)}
      </label>`).join('');
  }
  // Agregar al listener de cerrar
  const modal=document.getElementById('modalCrearTecnico');
  if(modal&&!modal._listenerAdded){
    modal.addEventListener('click',e=>{if(e.target===modal)cerrarModal('modalCrearTecnico');});
    modal._listenerAdded=true;
  }
  modal?.classList.add('open');
}

async function guardarNuevoTecnico(){
  const nombre   =(document.getElementById('ctNombre')?.value||'').trim();
  const apellido =(document.getElementById('ctApellido')?.value||'').trim();
  const usuario  =(document.getElementById('ctUsuario')?.value||'').trim();
  const password = document.getElementById('ctPassword')?.value||'';
  const cargo    =(document.getElementById('ctCargo')?.value||'').trim();
  const alerta   = document.getElementById('ctAlerta');

  const sedesIds=Array.from(document.querySelectorAll('#ctSedesChips input[type="checkbox"]:checked'))
    .map(cb=>parseInt(cb.value));
  const sedeNombres=Array.from(document.querySelectorAll('#ctSedesChips input[type="checkbox"]:checked'))
    .map(cb=>cb.dataset.nombre);

  const mostrarError=msg=>{if(alerta){alerta.textContent=msg;alerta.className='alerta error';}};

  if(!nombre||!apellido){mostrarError('Ingresa nombre y apellido.');return;}
  if(!usuario){mostrarError('El usuario es obligatorio.');return;}
  if(password.length<6){mostrarError('La contraseña debe tener al menos 6 caracteres.');return;}
  if(!sedesIds.length){mostrarError('Selecciona al menos una sede.');return;}
  if(!document.getElementById('ctAceptaTerminos')?.checked){mostrarError('Debes aceptar los términos y condiciones y el tratamiento de datos personales.');return;}
  const ctCorreoVal=(document.getElementById('ctCorreo')?.value||'').trim();
  if(ctCorreoVal && !esCorreoValido(ctCorreoVal)){mostrarError('Escribe un correo válido (ej: nombre@dominio.com).');return;}

  try{
    const res=await fetch('api/auth.php?action=registro',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        usuario,password,nombre,apellido,cargo:cargo||'Técnico',
        correo:(document.getElementById('ctCorreo')?.value||'').trim(),
        telefono:(document.getElementById('ctTelefono')?.value||'').trim(),
        sede_id:sedesIds[0],sedes_ids:sedesIds,tipo:'tecnico'
      })
    });
    const data=await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error al crear técnico');

    // Aprobar automáticamente (lo crea el admin directamente)
    await fetch('api/usuarios.php?action=estado',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({usuario,estado:'activo'})
    });

    await _recargarUsuarios();
    cerrarModal('modalCrearTecnico');
    renderTecnicosPersonas('tecnico');
    toast(`Técnico "${usuario}" creado y activado ✓`,'success');
  }catch(e){mostrarError(e.message||'Error al crear técnico');}
}

/* ── Crear Personal desde gestión de oficinas ── */
async function abrirModalCrearPersona(){
  ['cpNombre','cpApellido','cpUsuario','cpPassword','cpCargo'].forEach(id=>{
    const el=document.getElementById(id);if(el)el.value='';
  });
  const alerta=document.getElementById('cpAlerta');
  if(alerta){alerta.style.display='none';alerta.textContent='';}

  // Poblar select de sedes
  const sel=document.getElementById('cpSede');
  if(sel){
    const sedes=getSedes().filter(s=>s.activa==1);
    sel.innerHTML='<option value="">Seleccionar sede…</option>'+
      sedes.map(s=>`<option value="${s.id}">${esc(s.nombre)}</option>`).join('');
  }
  const modal=document.getElementById('modalCrearPersona');
  if(modal&&!modal._listenerAdded){
    modal.addEventListener('click',e=>{if(e.target===modal)cerrarModal('modalCrearPersona');});
    modal._listenerAdded=true;
  }
  modal?.classList.add('open');
}

async function guardarNuevaPersona(){
  const nombre   =(document.getElementById('cpNombre')?.value||'').trim();
  const apellido =(document.getElementById('cpApellido')?.value||'').trim();
  const usuario  =(document.getElementById('cpUsuario')?.value||'').trim();
  const password = document.getElementById('cpPassword')?.value||'';
  const cargo    =(document.getElementById('cpCargo')?.value||'').trim();
  const correo   =(document.getElementById('cpCorreo')?.value||'').trim();
  const telefono =(document.getElementById('cpTelefono')?.value||'').trim();
  const sedeId   = document.getElementById('cpSede')?.value||'';
  const alerta   = document.getElementById('cpAlerta');
  const mostrarError=msg=>{if(alerta){alerta.textContent=msg;alerta.className='alerta error';}};

  if(!nombre||!apellido){mostrarError('Ingresa nombre y apellido.');return;}
  if(!usuario){mostrarError('El usuario es obligatorio.');return;}
  if(password.length<6){mostrarError('La contraseña debe tener al menos 6 caracteres.');return;}
  if(!sedeId){mostrarError('Selecciona una sede.');return;}
  if(telefono && (!/^[0-9]+$/.test(telefono)||telefono.length<7||telefono.length>10)){mostrarError('El teléfono debe tener entre 7 y 10 dígitos.');return;}
  if(!document.getElementById('cpAceptaTerminos')?.checked){mostrarError('Debes aceptar los términos y condiciones y el tratamiento de datos personales.');return;}
  if(correo && !esCorreoValido(correo)){mostrarError('Escribe un correo válido (ej: nombre@dominio.com).');return;}

  try{
    const res=await fetch('api/auth.php?action=registro',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        usuario,password,nombre,apellido,
        cargo:cargo||'Personal General',
        correo,telefono,
        sede_id:parseInt(sedeId),tipo:'persona'
      })
    });
    const data=await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error al crear usuario');

    // Aprobar con rol persona (envía correo de bienvenida automáticamente)
    await fetch('api/usuarios.php?action=aprobar_con_rol',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({usuario,rol:'persona'})
    });

    await _recargarUsuarios();
    // Limpiar campos
    ['cpNombre','cpApellido','cpUsuario','cpPassword','cpCargo','cpCorreo','cpTelefono'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    document.getElementById('cpSede').value='';
    cerrarModal('modalCrearPersona');
    renderTecnicosPersonas('persona');
    toast(`Personal "${usuario}" creado y activado ✓`,'success');
  }catch(e){mostrarError(e.message||'Error al crear personal');}
}

function toggleChipOf(label,prefix){
  const cb=label.querySelector('input[type="checkbox"]');if(!cb)return;
  cb.checked=!cb.checked;
  label.classList.toggle('selected',cb.checked);
  const icon=label.querySelector('.chip-check');
  if(icon)icon.style.display=cb.checked?'inline':'none';
}

function togglePassField(id){
  const inp=document.getElementById(id);
  if(!inp)return;
  inp.type=inp.type==='password'?'text':'password';
}
async function toggleOficina(sedeId,activar){
  try{
    const res=await fetch('api/sedes.php?action=toggle',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:sedeId,activa:activar?1:0})
    });
    const data=await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error');
    _sedesCache=null;
    await Promise.all([_cargarSedes(), _recargarUsuarios()]);
    renderOficinas();
    renderUsuarios();
    renderTecnicosPersonas('tecnico');
    renderTecnicosPersonas('persona');
    if(activar)
      toast(`Sede "${data.sede}" reactivada — usuarios reactivados ✓`,'success');
    else
      toast(`Sede "${data.sede}" desactivada — usuarios desactivados`,'warn');
  }catch(e){toast(e.message||'Error al cambiar estado de sede','error');}
}
function selectTipoOficina(val){
  const l1=document.getElementById('labelOfMunicipio'),l2=document.getElementById('labelOfCentral');if(!l1||!l2)return;
  document.querySelectorAll('input[name="tipoOficina"]').forEach(r=>r.checked=r.value===val);
  l1.classList.toggle('selected',val==='municipio');l2.classList.toggle('selected',val==='distribuidor');
  const s1=l1.querySelector('span'),s2=l2.querySelector('span');
  if(s1){s1.style.color=val==='municipio'?'#0A58B5':'#6B7280';s1.style.fontWeight=val==='municipio'?'600':'400';}
  if(s2){s2.style.color=val==='distribuidor'?'#0A58B5':'#6B7280';s2.style.fontWeight=val==='distribuidor'?'600':'400';}
}

/* ════════════════════════════════════════════════
   TABS
════════════════════════════════════════════════ */
function setTabHistorial(t){
  tabHistorial=t;
  ['todos','aprobado','pendiente','rechazado','gasto','venta','ingreso','anulado'].forEach(id=>{const b=document.getElementById('tabHist_'+id);if(b)b.classList.toggle('active',id===t);});
  if(t==='anulado') cargarReporteAnulados();
  else renderHistorial();
}

async function cargarReporteAnulados(){
  const tbody = document.getElementById('tablaHistorial');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td class="!text-center !p-[24px] !text-[#94A3B8]" colspan="10">Cargando…</td></tr>';
  try{
    const res = await fetch('api/productos.php?action=ingresos_anulados',{credentials:'same-origin'});
    const data = await res.json();
    if(!Array.isArray(data)){ tbody.innerHTML = '<tr><td class="!text-center !p-[24px] !text-[#E24B4A]" colspan="10">Error al cargar.</td></tr>'; return; }
    st_local('cntHistAnulado', data.length||'');
    if(!data.length){
      tbody.innerHTML = '<tr><td class="!text-center !p-[32px] !text-[#94A3B8]" colspan="10">No hay ingresos anulados todavía.</td></tr>';
      return;
    }
    tbody.innerHTML = data.map(h=>`
      <tr class="fade-row">
        <td><span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_6px] !rounded-[5px]">${esc(h.ref||'—')}</span></td>
        <td class="!font-semibold ![text-decoration:line-through] !text-[#94A3B8]">${esc(h.nombre||'—')}</td>
        <td><span class="badge badge-gray">Almacen Central</span></td>
        <td class="!font-semibold">${h.cantidad||0}</td>
        <td class="!text-[12px] !text-[#64748B]">${esc(h.enviado_por||'—')}</td>
        <td class="!text-[12px] !text-[#64748B]">${esc(h.anulado_por||'—')}</td>
        <td><span class="badge ![background:#B91C1C] ![color:white] !font-bold">❌ ANULADO</span></td>
        <td class="!text-[12px] !text-[#475569] !max-w-[220px]">
          ${h.motivo_anulacion?`<div class="![white-space:normal] !leading-[1.5] ![font-style:italic]">"${esc(h.motivo_anulacion)}"</div>`:'<span class="!text-[#CBD5E1]">—</span>'}
          <div class="!text-[11px] !text-[#94A3B8] !mt-[2px]">Ingreso original: ${fmtDate(h.fecha)}</div>
        </td>
        <td class="!text-[12px] !text-[#94A3B8] !whitespace-nowrap">${h.anulado_en?fmtDate(h.anulado_en):'—'}</td>
        <td><span class="!text-[#E2E8F0] !text-[11px]">—</span></td>
      </tr>
    `).join('');
  }catch(e){ tbody.innerHTML = `<tr><td class="!text-center !p-[24px] !text-[#E24B4A]" colspan="10">${e.message}</td></tr>`; }
}
function st_local(id,v){const e=document.getElementById(id);if(e)e.textContent=v||'';}
function setTabMisSol(t){tabMisSol=t;['todos','pendiente','en_gestion','aprobada','rechazada','en_camino','recibida'].forEach(id=>{const b=document.getElementById('tabMisSol_'+id);if(b)b.classList.toggle('active',id===t);});renderMisSolicitudes();}
function setTabMisPed(t){tabMisPed=t;['todos','pendiente','en_gestion','atendido','rechazado'].forEach(id=>{const b=document.getElementById('tabMisPed_'+id);if(b)b.classList.toggle('active',id===t);});renderMisPedidos();}

/* ════════════════════════════════════════════════
   UNIDADES
════════════════════════════════════════════════ */
function selectUnidad(val){
  _radioCards('unidadMedida','labelUnidad','labelMetros',val,'labelUnidadSufijo');
  const rollosWrap = document.getElementById('crearProdRollosWrap');
  const cantWrap = document.getElementById('crearProdCantidadWrap');
  const sueltosWrap = document.getElementById('crearProdMetrosSueltosWrap');
  // Editando un producto ya existente: la cantidad NUNCA se toca desde
  // aquí (se usa "Registrar llegada" para eso) — así que nunca se
  // muestran los campos de rollos editables, sin importar la unidad;
  // el campo de cantidad bloqueado se queda visible siempre.
  if(editIndex!==null){
    if(rollosWrap) rollosWrap.style.display = 'none';
    if(sueltosWrap) sueltosWrap.style.display = 'none';
    if(cantWrap) cantWrap.style.display = 'block';
    return;
  }
  if(val==='metros'){
    // Siempre arranca en modo "rollos" — si el usuario prefiere metros
    // sueltos, lo elige con el enlace de abajo.
    if(rollosWrap) rollosWrap.style.display = 'block';
    if(sueltosWrap) sueltosWrap.style.display = 'none';
    if(cantWrap) cantWrap.style.display = 'none';
    document.getElementById('crearProdRollosCantidad').value = '';
    document.getElementById('crearProdRollosMetros').value = '';
    document.getElementById('crearProdRollosTotal').style.display = 'none';
    document.getElementById('crearProdMetrosSueltos').value = '';
    document.getElementById('cantidad').value = '';
  } else {
    if(rollosWrap) rollosWrap.style.display = 'none';
    if(sueltosWrap) sueltosWrap.style.display = 'none';
    if(cantWrap) cantWrap.style.display = 'block';
  }
}
function _toggleCrearProdMetrosSueltos(activo){
  document.getElementById('crearProdRollosWrap').style.display = activo ? 'none' : 'block';
  document.getElementById('crearProdMetrosSueltosWrap').style.display = activo ? 'block' : 'none';
  document.getElementById('crearProdMetrosSueltos').value = '';
  document.getElementById('cantidad').value = '';
  // En modo "metros sueltos" no hay un tamaño de rollo fijo — se manda
  // vacío para que metrosPorUnidad quede null al guardar.
  document.getElementById('crearProdRollosCantidad').value = '';
  document.getElementById('crearProdRollosMetros').value = '';
  document.getElementById('crearProdRollosTotal').style.display = 'none';
}
function _sincronizarMetrosSueltosCrearProd(){
  const v = document.getElementById('crearProdMetrosSueltos').value;
  document.getElementById('cantidad').value = v;
}
function _filtrarCantidadIngreso(el){
  const p = getProductos().find(x=>x.ref===_ingresoRefActual);
  if(p?.unidad==='metros'){
    let v = el.value.replace(/[^0-9.]/g,'');
    const partes = v.split('.');
    if(partes.length>2) v = partes[0]+'.'+partes.slice(1).join('');
    el.value = v;
  } else {
    el.value = el.value.replace(/[^0-9]/g,'');
  }
}
function _calcularTotalRollosCrearProd(){
  const rollos = parseInt(document.getElementById('crearProdRollosCantidad').value) || 0;
  const metrosCada = parseFloat(document.getElementById('crearProdRollosMetros').value) || 0;
  const total = rollos * metrosCada;
  const totalDiv = document.getElementById('crearProdRollosTotal');
  document.getElementById('cantidad').value = total || '';
  if(rollos && metrosCada){
    totalDiv.textContent = `= ${total.toLocaleString('es-CO')} metros en total`;
    totalDiv.style.display = 'block';
  } else {
    totalDiv.style.display = 'none';
  }
}
function selectEnvioUnidad(val){_radioCards('envioUnidad','envioLabelUnidad','envioLabelMetros',val,'envioUnidadSufijo');}
function selectPedidoUnidad(val){_radioCards('pedidoUnidad','pedidoLabelUnidad','pedidoLabelMetros',val,'pedidoUnidadSufijo');}
function _radioCards(name,id1,id2,chosen,sfxId){
  const l1=document.getElementById(id1),l2=document.getElementById(id2);if(!l1||!l2)return;
  document.querySelectorAll(`input[name="${name}"]`).forEach(r=>r.checked=r.value===chosen);
  const act=chosen==='unidad'?l1:l2,inact=chosen==='unidad'?l2:l1;
  act.classList.add('selected');inact.classList.remove('selected');
  const asvg=act.querySelector('svg'),isvg=inact.querySelector('svg');
  if(asvg)asvg.style.stroke='#0C6EDE';if(isvg)isvg.style.stroke='#94A3B8';
  const aspan=act.querySelector('span'),ispan=inact.querySelector('span');
  if(aspan){aspan.style.color='#0A58B5';aspan.style.fontWeight='600';}if(ispan){ispan.style.color='#6B7280';ispan.style.fontWeight='400';}
  const sfx=document.getElementById(sfxId);if(sfx)sfx.textContent=chosen==='metros'?'(mts.)':'(uds.)';
}