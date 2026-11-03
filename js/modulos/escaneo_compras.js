/* ════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════
   ESCANEO — OLT y MIKROTIK
════════════════════════════════════════════════ */

// Rellena un <select> de sede con las sedes activas; preselecciona la del usuario.
function poblarSedesEquipo(selId){
  const sel=document.getElementById(selId);
  if(!sel) return;
  const sedes=getSedesActivas();
  sel.innerHTML='<option value="">— Sin sede —</option>'+
    sedes.map(s=>`<option value="${esc(s.nombre)}">${esc(s.nombre)}</option>`).join('');
  if(sesion?.sede) sel.value=sesion.sede;
}

/* ── OLT ── */
async function cargarOlts(){
  _oltLlenarProveedores();
  const tbody=document.getElementById('oltTabla');
  if(!tbody) return;
  const q=(document.getElementById('oltBuscarInv')?.value||'').toLowerCase();
  try{
    const res=await fetch('api/equipos.php?action=listar_olts',{credentials:'same-origin'});
    const data=await res.json();
    if(!Array.isArray(data)){ throw new Error(data.error||'Respuesta inválida'); }
    window._invOltData=data; // para mostrar los datos guardados al editar el estado
    let filas = data;
    if(q) filas = data.filter(o=>((o.marca||'')+(o.modelo||'')+(o.sede||'')).toLowerCase().includes(q));
    if(!filas.length){ tbody.innerHTML=`<tr><td class="!text-center !text-[#94A3B8] !p-[20px]" colspan="8">${q?'Sin resultados para esa búsqueda':'Sin OLTs registradas'}</td></tr>`; return; }
    const puedeEliminar=sesion?.rol==='superadmin'||tienePermiso('gestionar_olt')||tienePermiso('gestionar_equipos');
    const puedeEnviar=puedeEliminar;
    tbody.innerHTML=filas.map((o,i)=>{
      const enTransito=(parseInt(o.en_envio)>0);
      return `<tr>
      <td>${i+1}</td>
      <td>${esc(o.marca)}${o.proveedor?`<div class="!text-[11px] !text-[#7C3AED]">🏭 ${esc(o.proveedor)}</div>`:''}</td>
      <td>${esc(o.modelo)}</td>
      <td>${esc(o.tarjetas_pon??'')}</td>
      <td>${esc(o.puertos_pon??'')}</td>
      <td>${_celdaUbicacionEquipo(o)}</td>
      <td>${enTransito?'<span class="badge badge-warn !text-[10px]">en tránsito</span>':_badgeEstadoEquipo(o.estado)}</td>
      <td>${_accionesMenu('ol_2'+o.id, `
        ${puedeEnviar&&!enTransito?`<button onclick="abrirEnviarEquipo('olt',${parseInt(o.id)},'${esc((o.marca||'')+' '+(o.modelo||''))}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">Enviar</button>`:''}
        ${['activo','recuperado'].includes(o.estado)&&!enTransito?`<button onclick="abrirVenderEquipo('olt',${parseInt(o.id)},'${esc((('OLT '+(o.marca||'')+' '+(o.modelo||'')).trim()))}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">💰 Vender</button>`:''}
        <button onclick="abrirHistorialEquipo('olt',${parseInt(o.id)},'${esc((o.marca||'')+' '+(o.modelo||''))}')" class="btn-sm ![background:#E0F2FE] !text-[#0369A1]">📜 Historial</button>
        ${puedeEnviar&&!enTransito?`<button onclick="abrirEstadoEquipo('olt',${parseInt(o.id)},'${esc((o.marca||'')+' '+(o.modelo||''))}','${esc(o.estado||'')}','${esc(o.sede||'')}')" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6]">✎ Estado</button>`:''}
        ${puedeEliminar?`<button onclick="oltEliminar(${parseInt(o.id)})" class="btn-sm ![background:#FEF2F2] !text-[#B91C1C]">Eliminar</button>`:''}
      `)}</td>
    </tr>`;}).join('');
  }catch(e){
    tbody.innerHTML=`<tr><td class="!text-center !text-[#B91C1C] !p-[20px]" colspan="8">⚠ ${esc(e.message)}</td></tr>`;
  }
}

async function _oltLlenarProveedores(){
  try{ if(!_proveedores.length) await cargarProveedores(); }catch(e){}
  const sel=document.getElementById('oltProveedor');
  if(!sel) return;
  const actual=sel.value;
  sel.innerHTML='<option value="">Sin proveedor (opcional)</option>'+(_proveedores||[]).map(p=>`<option value="${esc(p.nombre)}">${esc(p.nombre)}</option>`).join('');
  sel.value=actual;
}
async function oltRegistrar(){
  const marca=(document.getElementById('oltMarca')?.value||'').trim();
  const modelo=(document.getElementById('oltModelo')?.value||'').trim();
  const tarjetas=parseInt(document.getElementById('oltTarjetas')?.value||'0')||0;
  const puertos=parseInt(document.getElementById('oltPuertos')?.value||'0')||0;
  const proveedor=(document.getElementById('oltProveedor')?.value||'').trim();
  const estado=document.getElementById('oltEstadoReg');
  const btn=document.getElementById('btnOltRegistrar');

  if(!marca||!modelo){ toast('Marca y modelo son obligatorios','error'); return; }
  const notasOlt=(document.getElementById('oltNotas')?.value||'').trim();
  if(!(await _confirmarRegistroLlegada('esta OLT', `la OLT ${marca} ${modelo}`))) return;
  if(btn){ btn.disabled=true; btn.style.opacity='0.6'; }
  try{
    const res=await fetch('api/equipos.php?action=crear_olt',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({marca,modelo,proveedor,tarjetas_pon:tarjetas,puertos_pon:puertos,notas:notasOlt})
    });
    const data=await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error al registrar');
    if(estado){ estado.style.display=''; estado.style.background='#EAF3DE'; estado.style.color='#166534'; estado.textContent=`✓ OLT registrada: ${marca} ${modelo}`; }
    toast('OLT registrada ✓','success');
    ['oltMarca','oltModelo','oltProveedor','oltTarjetas','oltPuertos','oltNotas'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    await cargarOlts();
    document.getElementById('oltMarca')?.focus();
  }catch(e){
    if(estado){ estado.style.display=''; estado.style.background='#FCEBEB'; estado.style.color='#B91C1C'; estado.textContent=`⚠ ${e.message}`; }
    toast(e.message,'error');
  }finally{
    if(btn){ btn.disabled=false; btn.style.opacity='1'; }
  }
}

async function oltEliminar(id){ _eliminarEquipo('olt', id, '#'+id); }

/* ── MIKROTIK ── */
function mkValidarMac(){
  const input=document.getElementById('mkMacInput');
  const icono=document.getElementById('mkMacIcono');
  const msg=document.getElementById('mkMacMsg');
  const raw=(input?.value||'').replace(/[^A-Fa-f0-9]/g,'');
  if(!input?.value.trim()){ if(icono)icono.style.display='none'; if(msg)msg.style.display='none'; _actualizarBtnMk(); return; }
  const ok=raw.length>0;
  if(ok){
    input.style.borderColor='#16A871'; input.style.boxShadow='0 0 0 3px rgba(22,168,113,.1)';
    if(icono){icono.style.display='inline';icono.innerHTML='<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#16A871" stroke-width="2.5"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg>';}
    if(msg){msg.style.display='block';msg.style.color='#16A871';msg.textContent='MAC válida ✓';}
  }else{
    input.style.borderColor='#E24B4A'; input.style.boxShadow='0 0 0 3px rgba(226,75,74,.1)';
    if(icono){icono.style.display='inline';icono.innerHTML='<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#E24B4A" stroke-width="2.5"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>';}
    if(msg){msg.style.display='block';msg.style.color='#E24B4A';msg.textContent='Escribe la MAC';}
  }
  _actualizarBtnMk();
}

function mkValidarSn(){
  const input=document.getElementById('mkSnInput');
  const icono=document.getElementById('mkSnIcono');
  const msg=document.getElementById('mkSnMsg');
  const val=(input?.value||'').trim();
  if(!val){ if(icono)icono.style.display='none'; if(msg)msg.style.display='none'; _actualizarBtnMk(); return; }
  const ok=val.length>=4;
  if(ok){
    input.style.borderColor='#16A871'; input.style.boxShadow='0 0 0 3px rgba(22,168,113,.1)';
    if(icono){icono.style.display='inline';icono.innerHTML='<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#16A871" stroke-width="2.5"><path stroke-linecap="round" d="M5 13l4 4L19 7"/></svg>';}
    if(msg){msg.style.display='block';msg.style.color='#16A871';msg.textContent='SN válido ✓';}
  }else{
    input.style.borderColor='#E24B4A'; input.style.boxShadow='0 0 0 3px rgba(226,75,74,.1)';
    if(icono){icono.style.display='inline';icono.innerHTML='<svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="#E24B4A" stroke-width="2.5"><path stroke-linecap="round" d="M6 18L18 6M6 6l12 12"/></svg>';}
    if(msg){msg.style.display='block';msg.style.color='#E24B4A';msg.textContent='SN muy corto';}
  }
  _actualizarBtnMk();
}

function _actualizarBtnMk(){
  const modelo=(document.getElementById('mkModelo')?.value||'').trim();
  const mac=(document.getElementById('mkMacInput')?.value||'').replace(/[^A-Fa-f0-9]/g,'');
  const sn=(document.getElementById('mkSnInput')?.value||'').trim();
  const ok=modelo.length>0 && mac.length>0 && sn.length>=4;
  const btn=document.getElementById('btnMkRegistrar');
  if(btn){ btn.disabled=!ok; btn.style.opacity=ok?'1':'0.5'; }
}

async function cargarMikrotiks(){
  const tbody=document.getElementById('mkTabla');
  if(!tbody) return;
  try{
    const res=await fetch('api/equipos.php?action=listar_mikrotiks',{credentials:'same-origin'});
    const data=await res.json();
    if(!Array.isArray(data)){ throw new Error(data.error||'Respuesta inválida'); }
    // Filtro por tipo
    const filtroTipo=(document.getElementById('mkFiltroTipo')?.value||'').trim();
    const filtrados=filtroTipo ? data.filter(m=>(m.tipo_equipo||'Mikrotik')===filtroTipo) : data;
    if(!filtrados.length){
      tbody.innerHTML=`<tr><td class="!text-center !text-[#94A3B8] !p-[20px]" colspan="8">${filtroTipo?`Sin equipos de tipo "${filtroTipo}"` : 'Sin equipos registrados'}</td></tr>`;
      return;
    }
    const puedeEliminar=sesion?.rol==='superadmin'||tienePermiso('gestionar_equipos');
    const puedeEnviar=puedeEliminar;
    tbody.innerHTML=filtrados.map((m,i)=>{
      const enTransito=(parseInt(m.en_envio)>0);
      const tipo=m.tipo_equipo||'Mikrotik';
      const nombre=(tipo+' '+(m.proveedor||'')+' '+(m.modelo||'')).trim()+(m.sn?(' · SN '+m.sn):'');
      return `<tr>
      <td>${i+1}</td>
      <td><span class="badge ![background:#EDE9FE] !text-[#5B21B6] !text-[11px]">${esc(tipo)}</span></td>
      <td>${esc(m.proveedor||'—')}</td>
      <td>${esc(m.modelo)}</td>
      <td class="![font-family:monospace]">${esc(m.sn||'—')}</td>
      <td class="![font-family:monospace]">${esc(m.mac_fmt||m.mac||'—')}</td>
      <td>${esc(m.sede||'—')} ${enTransito?'<span class="badge badge-warn !text-[10px]">en tránsito</span>':_badgeEstadoEquipo(m.estado)}</td>
      <td>${_accionesMenu('mi_3'+m.id, `
        ${puedeEnviar&&!enTransito?`<button onclick="abrirEnviarEquipo('mikrotik',${parseInt(m.id)},'${esc(nombre)}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">Enviar</button>`:''}
        <button onclick="abrirHistorialEquipo('mikrotik',${parseInt(m.id)},'${esc(nombre)}')" class="btn-sm ![background:#E0F2FE] !text-[#0369A1]">📜 Historial</button>
        ${puedeEnviar&&!enTransito?`<button onclick="abrirEstadoEquipo('mikrotik',${parseInt(m.id)},'${esc(nombre)}','${esc(m.estado||'')}','${esc(m.sede||'')}')" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6]">✎ Estado</button>`:''}
        ${puedeEliminar?`<button onclick="mkEliminar(${parseInt(m.id)})" class="btn-sm ![background:#FEF2F2] !text-[#B91C1C]">Eliminar</button>`:''}
      `)}</td>
    </tr>`;}).join('');
  }catch(e){
    tbody.innerHTML=`<tr><td class="!text-center !text-[#B91C1C] !p-[20px]" colspan="8">⚠ ${esc(e.message)}</td></tr>`;
  }
}
function renderMkInventario(){ cargarMikrotiks(); }

/* ── Tipos de equipo ── */
let _tiposEquipo = [];
let _tipoEquipoActual = '';

async function cargarTiposEquipo(){
  try{
    const res = await fetch('api/equipos.php?action=listar_tipos_equipo',{credentials:'same-origin'});
    _tiposEquipo = await res.json() || [];
  }catch{ _tiposEquipo=[]; }

  // Sub-pestañas dentro de escTab_mikrotik
  const subRow = document.getElementById('tiposEquipoTabRow');
  if(subRow){
    if(!_tiposEquipo.length){
      subRow.innerHTML = `<div class="!text-[13px] !text-[#94A3B8] !p-[6px_0]">
        Aún no tienes tipos de equipo. 
        <button onclick="abrirGestionTiposEquipo()" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6]">+ Crear primer tipo</button>
      </div>`;
    } else {
      subRow.innerHTML = _tiposEquipo.map(t=>`
        <div class="!inline-flex !items-center !gap-[1px] !relative">
          <button class="tab-btn ${_tipoEquipoActual===t.nombre?'active':''}"
            data-subtipo="${esc(t.nombre)}"
            onclick="setTipoEquipoActivo('${esc(t.nombre)}')"
            style="font-size:12px;border-radius:8px 0 0 8px;margin:0;">
            ${t.icono} ${esc(t.nombre)}
          </button>
          <button onclick="toggleMenuTipoEquipo(event,'${esc(t.nombre)}',${t.id})"
            style="height:100%;padding:0 6px;background:#F1F5F9;border:none;border-left:1px solid #E2E8F0;border-radius:0 8px 8px 0;cursor:pointer;font-size:14px;color:#64748B;"
            title="Opciones">⋮</button>
        </div>`).join('')
        + `<button class="tab-btn ![background:#F1F5F9] !text-[12px] !p-[6px_10px]" onclick="abrirGestionTiposEquipo()">+ Nuevo tipo</button>`;
    }
  }
}

function setTipoEquipoActivo(nombre){
  _tipoEquipoActual = nombre;
  const tipo = _tiposEquipo.find(t=>t.nombre===nombre);
  if(!tipo) return;

  // Marcar activo solo en sub-pestañas internas
  document.querySelectorAll('[data-subtipo]').forEach(b=>{
    b.classList.toggle('active', b.dataset.subtipo===nombre);
  });

  // Renderizar contenido del tipo
  const cont = document.getElementById('tipoEquipoContenido');
  if(!cont) return;
  const esAdmin = sesion?.rol==='superadmin'||sesion?.rol==='distribuidor';
  cont.innerHTML = `
    <!-- Registro -->
    ${esAdmin?`<div class="pcard !mb-[16px]">
      <div class="pcard-header !cursor-pointer ![user-select:none]" onclick="teToggleRegistro()">
        <div class="!flex !items-center !gap-[8px]">
          <span class="!text-[20px]">${tipo.icono}</span>
          <span class="!font-bold !text-[14px]">Registrar ${esc(nombre)}</span>
        </div>
        <button id="teToggleBtn" style="background:none;border:none;cursor:pointer;font-size:18px;color:#94A3B8;padding:0;" title="Colapsar/expandir">▲</button>
      </div>
      <div id="teFormBody" style="padding:16px 20px;display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="lbl">Marca <span class="!text-[#E24B4A]">*</span></label>
          <input id="teMarca" class="inp" placeholder="Ej: HP, Epson, TP-Link…">
        </div>
        <div>
          <label class="lbl">Modelo <span class="!text-[#E24B4A]">*</span></label>
          <input id="teModelo" class="inp" placeholder="Ej: LaserJet Pro, RB750…">
        </div>
        <div>
          <label class="lbl">Proveedor <span class="!text-[#94A3B8] !font-normal">(opcional)</span></label>
          <select id="teProveedor" class="inp">
            <option value="">Sin proveedor</option>
            ${(_proveedores||[]).map(p=>`<option value="${esc(p.nombre)}">${esc(p.nombre)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="lbl">Serial Number (SN) <span class="!text-[#E24B4A]">*</span></label>
          <input id="teSn" class="inp" placeholder="Escanea o escribe SN…">
        </div>
        <div>
          <label class="lbl">MAC Address <span class="!text-[#94A3B8] !font-normal">(opcional)</span></label>
          <input id="teMac" class="inp" placeholder="Escanea MAC…" oninput="teMacValidar()">
          <div id="teMacMsg" style="font-size:11px;margin-top:3px;display:none;"></div>
        </div>
        <div>
          <label class="lbl">Estado inicial <span class="!text-[#E24B4A]">*</span></label>
          <select id="teEstadoInicial" class="inp" onchange="teEstadoCambio()">
            <option value="activo">✅ Disponible</option>
            <option value="comodato">🤝 Comodato</option>
            <option value="dañado">⚠️ Dañado</option>
            <option value="recuperado">♻️ Recogido — disponible</option>
            <option value="de_baja">🚫 De baja</option>
          </select>
        </div>
        <div id="teCamposComodato" style="display:none;grid-column:1/-1;background:#F0FDF4;border-radius:10px;padding:12px;flex-direction:column;gap:10px;">
          <div class="!text-[11px] !font-bold !text-[#166534] !uppercase !tracking-[.6px]">🤝 Datos de comodato</div>
          <div>
            <label class="lbl">Cliente / Proyecto <span class="!text-[#E24B4A]">*</span></label>
            <div class="!relative">
              <input id="teComodCliente" class="inp" placeholder="Escribe o elige uno existente…" autocomplete="off" oninput="_clienteEqFiltrar('teComodCliente','teComodClienteResultados')" onfocus="_clienteEqFiltrar('teComodCliente','teComodClienteResultados')">
              <div id="teComodClienteResultados" style="display:none;position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid #E2E8F0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:200px;overflow-y:auto;z-index:50;"></div>
            </div>
          </div>
          ${_ubiHtml('teComodUbi','teComodMunicipio','teComodZona')}
          <div>
            <label class="lbl">Instalado por <span class="!text-[#94A3B8] !font-normal">(opcional: si eliges a alguien, queda pendiente de que él lo confirme)</span></label>
            <div class="!relative">
              <input id="teComodInstalador" class="inp" placeholder="Buscar técnico/persona…" autocomplete="off" oninput="_respEqFiltrar('teComodInstalador','teComodInstaladorResultados','teComodInstaladorValor',['tecnico','persona'])" onfocus="_respEqFiltrar('teComodInstalador','teComodInstaladorResultados','teComodInstaladorValor',['tecnico','persona'])">
              <input type="hidden" id="teComodInstaladorValor">
              <div id="teComodInstaladorResultados" style="display:none;position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid #E2E8F0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:200px;overflow-y:auto;z-index:50;"></div>
            </div>
          </div>
        </div>
        <div id="teCamposRecuperado" style="display:none;grid-column:1/-1;background:#F0FDF4;border-radius:10px;padding:12px;flex-direction:column;gap:10px;">
          <div class="!text-[11px] !font-bold !text-[#166534] !uppercase !tracking-[.6px]">♻️ Datos de recuperación</div>
          ${_ubiHtml('teRecUbi','teRecMunicipio','teRecZona')}
          <div>
            <label class="lbl">Retirado por <span class="!text-[#94A3B8] !font-normal">(opcional: si eliges a alguien, queda pendiente de que él lo confirme)</span></label>
            <div class="!relative">
              <input id="teRecResp" class="inp" placeholder="Buscar técnico/persona…" autocomplete="off" oninput="_respEqFiltrar('teRecResp','teRecRespResultados','teRecRespValor',['tecnico','persona'])" onfocus="_respEqFiltrar('teRecResp','teRecRespResultados','teRecRespValor',['tecnico','persona'])">
              <input type="hidden" id="teRecRespValor">
              <div id="teRecRespResultados" style="display:none;position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid #E2E8F0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:200px;overflow-y:auto;z-index:50;"></div>
            </div>
          </div>
        </div>
        <div id="teCamposDanado" style="display:none;grid-column:1/-1;background:#FFF7ED;border-radius:10px;padding:12px;flex-direction:column;gap:10px;">
          <div class="!text-[11px] !font-bold !text-[#92400E] !uppercase !tracking-[.6px]">⚠️ Datos del daño</div>
          <div>
            <label class="lbl">Tipo de daño <span class="!text-[#E24B4A]">*</span></label>
            <input id="teDanTipo" class="inp" placeholder="Ej: Puerto quemado, pantalla rota…">
          </div>
          <div>
            <label class="lbl">Reportado por <span class="!text-[#94A3B8] !font-normal">(opcional: si eliges a alguien, queda pendiente de que él lo confirme)</span></label>
            <div class="!relative">
              <input id="teDanResp" class="inp" placeholder="Buscar técnico/persona…" autocomplete="off" oninput="_respEqFiltrar('teDanResp','teDanRespResultados','teDanRespValor',['tecnico','persona'])" onfocus="_respEqFiltrar('teDanResp','teDanRespResultados','teDanRespValor',['tecnico','persona'])">
              <input type="hidden" id="teDanRespValor">
              <div id="teDanRespResultados" style="display:none;position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid #E2E8F0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:200px;overflow-y:auto;z-index:50;"></div>
            </div>
          </div>
        </div>
        <div id="teCamposBaja" style="display:none;grid-column:1/-1;background:#FEF2F2;border-radius:10px;padding:12px;flex-direction:column;gap:10px;">
          <div class="!text-[11px] !font-bold !text-[#B91C1C] !uppercase !tracking-[.6px]">🚫 Motivo de baja</div>
          <div>
            <label class="lbl">Motivo <span class="!text-[#E24B4A]">*</span></label>
            <select id="teBajMotivo" class="inp">
              <option value="">Seleccionar motivo…</option>
              <option value="Obsolescencia">Obsolescencia</option>
              <option value="Daño irreparable">Daño irreparable</option>
              <option value="Robo o pérdida">Robo o pérdida</option>
              <option value="Fin de vida útil">Fin de vida útil</option>
              <option value="Reemplazo por modelo nuevo">Reemplazo por modelo nuevo</option>
              <option value="Otro">Otro</option>
            </select>
          </div>
          <div>
            <label class="lbl">Autorizado por <span class="!text-[#94A3B8] !font-normal">(opcional: si eliges a un administrador, queda pendiente de que él lo confirme)</span></label>
            <div class="!relative">
              <input id="teBajResp" class="inp" placeholder="Buscar administrador…" autocomplete="off" oninput="_respEqFiltrar('teBajResp','teBajRespResultados','teBajRespValor',['superadmin'])" onfocus="_respEqFiltrar('teBajResp','teBajRespResultados','teBajRespValor',['superadmin'])">
              <input type="hidden" id="teBajRespValor">
              <div id="teBajRespResultados" style="display:none;position:absolute;left:0;right:0;top:100%;background:#fff;border:1px solid #E2E8F0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:200px;overflow-y:auto;z-index:50;"></div>
            </div>
          </div>
        </div>
        <div class="![grid-column:1/-1]">
          <label class="lbl">Notas adicionales <span class="!text-[#94A3B8] !font-normal">(opcional)</span></label>
          <textarea id="teNotas" class="inp" rows="2" maxlength="500" placeholder="Ej: llegó con la caja golpeada, factura 123…" style="resize:vertical;font-family:inherit;"></textarea>
        </div>
        <div class="![grid-column:1/-1]">
          <div id="teEstadoReg" style="display:none;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:10px;"></div>
          <button onclick="teRegistrar('${esc(nombre)}')" class="btn btn-ok">
            <svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" d="M12 5v14M5 12h14"/></svg>
            Registrar ${esc(nombre)}
          </button>
        </div>
      </div>
    </div>`:''}
    <!-- Inventario -->
    <div class="pcard">
      <div class="pcard-header">
        <span class="!font-bold !text-[14px]">${tipo.icono} Inventario de ${esc(nombre)}</span>
        <input id="teBuscar" class="inp" placeholder="Buscar…" style="width:180px;font-size:12px;" oninput="teCargarInventario('${esc(nombre)}')">
      </div>
      <div class="!overflow-x-auto">
        <table><thead><tr><th>#</th><th>Marca</th><th>Proveedor</th><th>Modelo</th><th>SN</th><th>MAC</th><th>Sede</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody id="teTabla_${esc(nombre)}"><tr><td class="!text-center !text-[#94A3B8] !p-[20px]" colspan="9">Cargando…</td></tr></tbody>
        </table>
      </div>
    </div>`;

  teCargarInventario(nombre);
  setTimeout(()=>document.getElementById(esAdmin?'teMac':'teBuscar')?.focus(), 100);
}

function teMacValidar(){
  const inp=document.getElementById('teMac');
  const msg=document.getElementById('teMacMsg');
  if(!inp||!msg) return;
  const raw=(inp.value||'').replace(/[^A-Fa-f0-9]/g,'');
  if(!raw){ msg.style.display='none'; return; }
  if(raw.length>0){
    msg.style.display='';msg.style.color='#166534';
    msg.textContent='✓ '+raw.match(/.{2}/g).join(':');
  } else {
    msg.style.display='';msg.style.color='#B91C1C';
    msg.textContent='Escribe la MAC';
  }
}

function teToggleRegistro(){
  const body = document.getElementById('teFormBody');
  const btn  = document.getElementById('teToggleBtn');
  if(!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? 'grid' : 'none';
  if(btn) btn.textContent = collapsed ? '▲' : '▼';
}

function teEstadoCambio(){
  const v=document.getElementById('teEstadoInicial')?.value;
  const bloques={comodato:'teCamposComodato',recuperado:'teCamposRecuperado','dañado':'teCamposDanado',de_baja:'teCamposBaja'};
  Object.entries(bloques).forEach(([est,id])=>{
    const el=document.getElementById(id);
    if(el) el.style.display = v===est ? 'flex' : 'none';
  });
  if(v==='comodato' && typeof _cargarClientesExistentesEquipo==='function') _cargarClientesExistentesEquipo();
}

async function teRegistrar(tipo){
  const marca    =(document.getElementById('teMarca')?.value||'').trim();
  const proveedor=(document.getElementById('teProveedor')?.value||'').trim();
  const modelo   =(document.getElementById('teModelo')?.value||'').trim();
  const macRaw   =(document.getElementById('teMac')?.value||'').replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
  const sn       =(document.getElementById('teSn')?.value||'').trim().toUpperCase();
  const estadoInicial=document.getElementById('teEstadoInicial')?.value||'activo';
  const estadoEl =document.getElementById('teEstadoReg');
  if(!marca){   toast('La marca es obligatoria','error'); document.getElementById('teMarca')?.focus(); return; }
  if(!modelo){  toast('El modelo es obligatorio','error'); document.getElementById('teModelo')?.focus(); return; }
  if(!sn){      toast('El SN es obligatorio','error'); document.getElementById('teSn')?.focus(); return; }
  if(macRaw && macRaw.length===0){ toast('Escribe la MAC','error'); return; }
  // Según el estado inicial se piden los mismos datos que al cambiar el estado de un equipo.
  const val=id=>(document.getElementById(id)?.value||'').trim();
  let cliente='', direccion='', nota='', resp='';
  if(estadoInicial==='comodato'){
    cliente=val('teComodCliente');
    if(!cliente){ toast('Escribe el Cliente/Proyecto del comodato — es obligatorio.','error'); document.getElementById('teComodCliente')?.focus(); return; }
    if(typeof _confirmarClienteProyectoNuevo==='function' && !(await _confirmarClienteProyectoNuevo(cliente))) return;
    const mun=val('teComodMunicipio'), zona=val('teComodZona'), inst=val('teComodInstalador');
    if(!mun){ toast('Falta la ubicación: usa tu ubicación actual, elígela en el mapa o escribe la dirección.','error'); document.getElementById('teComodMunicipio')?.focus(); return; }
    resp=val('teComodInstaladorValor');
    direccion=[mun,zona].filter(Boolean).join(' · ');
    nota=[mun&&`Ubicación: ${mun}`, zona&&`Zona: ${zona}`, inst&&`Instalado por: ${inst}`].filter(Boolean).join(' | ');
  } else if(estadoInicial==='recuperado'){
    const mun=val('teRecMunicipio'), zona=val('teRecZona'), por=val('teRecResp');
    if(!mun){ toast('Falta la ubicación: usa tu ubicación actual, elígela en el mapa o escribe la dirección.','error'); document.getElementById('teRecMunicipio')?.focus(); return; }
    resp=val('teRecRespValor');
    nota=[mun&&`Ubicación: ${mun}`, zona&&`Zona: ${zona}`, por&&`Retirado por: ${por}`].filter(Boolean).join(' | ');
  } else if(estadoInicial==='dañado'){
    const tipoD=val('teDanTipo'), por=val('teDanResp');
    if(!tipoD){ toast('Describe el tipo de daño — es obligatorio.','error'); document.getElementById('teDanTipo')?.focus(); return; }
    resp=val('teDanRespValor');
    nota=[`Daño: ${tipoD}`, por&&`Reportado por: ${por}`].filter(Boolean).join(' | ');
  } else if(estadoInicial==='de_baja'){
    const motivo=val('teBajMotivo'), por=val('teBajResp');
    if(!motivo){ toast('Selecciona el motivo de baja — es obligatorio.','error'); document.getElementById('teBajMotivo')?.focus(); return; }
    resp=val('teBajRespValor');
    nota=[`Motivo: ${motivo}`, por&&`Autorizado por: ${por}`].filter(Boolean).join(' | ');
  }
  const conDatos=['comodato','recuperado','dañado','de_baja'].includes(estadoInicial);
  const notasEq=(document.getElementById('teNotas')?.value||'').trim();
  if(!(await _confirmarRegistroLlegada(`este equipo (${tipo})`, `${tipo} ${marca} ${modelo} · SN ${sn}`))) return;
  try{
    const res=await fetch('api/equipos.php?action=crear_mikrotik',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({marca, proveedor, modelo, sn, mac:macRaw, tipo_equipo:tipo, estado: conDatos ? 'activo' : estadoInicial, notas:notasEq})
    });
    const d=await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error');
    let msgExtra='';
    if(conDatos){
      // Se registra y se pasa al estado por el mismo camino que "Cambiar estado" (queda historial y confirmación).
      const r2=await fetch('api/equipos.php?action=cambiar_estado_equipo',{
        method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({tipo:'mikrotik', id:d.id, estado:estadoInicial, nota, cliente_nombre:cliente||undefined, cliente_direccion:direccion||undefined, responsable_usuario:resp||undefined, directo: !resp, ...(typeof _ubiCoords==='function'?_ubiCoords(estadoInicial==='comodato'?'teComodUbi':estadoInicial==='recuperado'?'teRecUbi':''):{})})
      });
      const d2=await r2.json();
      if(!r2.ok||d2.error) throw new Error('El equipo se registró, pero no se pudo dejar en ese estado: '+(d2.error||'Error')+'. Cámbialo desde su fila.');
      msgExtra = d2.pendiente ? ' · pendiente de confirmar por '+d2.confirma : ' · estado: '+estadoInicial+(cliente?' en '+cliente:'');
    }
    if(estadoEl){ estadoEl.style.display='';estadoEl.style.background='#EAF3DE';estadoEl.style.color='#166534';
      estadoEl.textContent=`✓ ${tipo} registrado: ${marca} ${modelo} · SN ${sn}${msgExtra}`; }
    toast(`${tipo} registrado ✓`,'success');
    if(typeof _ubiReset==='function') _ubiReset();
    ['teMarca','teProveedor','teModelo','teMac','teSn','teComodCliente','teComodMunicipio','teComodZona','teComodInstalador','teComodInstaladorValor','teRecMunicipio','teRecZona','teRecResp','teRecRespValor','teDanTipo','teDanResp','teDanRespValor','teBajMotivo','teBajResp','teBajRespValor','teNotas'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    const msg=document.getElementById('teMacMsg'); if(msg) msg.style.display='none';
    const sel=document.getElementById('teEstadoInicial'); if(sel) sel.value='activo'; teEstadoCambio();
    teCargarInventario(tipo);
    setTimeout(()=>document.getElementById('teMarca')?.focus(),100);
  }catch(e){
    if(estadoEl){ estadoEl.style.display='';estadoEl.style.background='#FCEBEB';estadoEl.style.color='#B91C1C';
      estadoEl.textContent=`⚠ ${e.message}`; }
    toast(e.message,'error');
  }
}

async function teCargarInventario(tipo){
  const tbody=document.getElementById('teTabla_'+tipo);
  if(!tbody) return;
  const q=(document.getElementById('teBuscar')?.value||'').toLowerCase();
  try{
    const res=await fetch('api/equipos.php?action=listar_mikrotiks',{credentials:'same-origin'});
    const data=await res.json();
    if(!Array.isArray(data)) throw new Error('Error');
    window._invMkData=data; // para mostrar los datos guardados al editar el estado
    let filas=data.filter(m=>(m.tipo_equipo||'Mikrotik')===tipo);
    if(q) filas=filas.filter(m=>(m.proveedor+m.modelo+m.sn+m.mac_fmt+m.sede).toLowerCase().includes(q));
    if(!filas.length){ tbody.innerHTML=`<tr><td class="!text-center !text-[#94A3B8] !p-[20px]" colspan="9">Sin ${tipo}s registrados</td></tr>`; return; }
    const esAdmin=sesion?.rol==='superadmin'||sesion?.rol==='distribuidor';
    tbody.innerHTML=filas.map((m,i)=>{
      const enT=(parseInt(m.en_envio)>0);
      const nom=((m.proveedor||'')+' '+(m.modelo||'')).trim()+(m.sn?' · SN '+m.sn:'');
      return `<tr>
        <td>${i+1}</td>
        <td class="!font-semibold">${esc(m.marca||m.proveedor||'—')}</td>
        <td>${esc(m.proveedor||'—')}</td>
        <td>${esc(m.modelo)}</td>
        <td class="![font-family:monospace]">${esc(m.sn||'—')}</td>
        <td class="![font-family:monospace]">${esc(m.mac_fmt||m.mac||'—')}</td>
        <td>${_celdaUbicacionEquipo(m)}</td>
        <td>${enT?'<span class="badge badge-warn !text-[10px]">en tránsito</span>':_badgeEstadoEquipo(m.estado)}</td>
        <td>${_accionesMenu('mi_4'+m.id, `
          ${esAdmin&&!enT?`<button onclick="abrirEnviarEquipo('mikrotik',${parseInt(m.id)},'${esc(nom)}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">Enviar</button>`:''}
          ${['activo','recuperado'].includes(m.estado)&&!enT?`<button onclick="abrirVenderEquipo('mikrotik',${parseInt(m.id)},'${esc(nom)}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">💰 Vender</button>`:''}
          <button onclick="abrirHistorialEquipo('mikrotik',${parseInt(m.id)},'${esc(nom)}')" class="btn-sm ![background:#E0F2FE] !text-[#0369A1]">📜 Historial</button>
          <button onclick="abrirEstadoEquipo('mikrotik',${parseInt(m.id)},'${esc(nom)}','${esc(m.estado||'')}','${esc(m.sede||'')}')" class="btn-sm ![background:#EDE9FE] !text-[#5B21B6]">✎ Estado</button>
          ${esAdmin?`<button onclick="mkEliminar(${parseInt(m.id)})" class="btn-sm ![background:#FEF2F2] !text-[#B91C1C]">Eliminar</button>`:''}
          ${!esAdmin&&(m.estado==='recuperado'||m.estado==='activo')?`<button onclick="abrirDevolverEquipo('mikrotik',${parseInt(m.id)},'${esc(nom)}')" class="btn-sm ![background:#E6F1FB] !text-[#0A58B5]">↩ Devolver</button>`:''}
        `)}</td>
      </tr>`;
    }).join('');
  }catch(e){
    tbody.innerHTML=`<tr><td class="!text-[#B91C1C] !text-center !p-[16px]" colspan="8">⚠ ${esc(e.message)}</td></tr>`;
  }
}
let _menuTipoEl = null;
function toggleMenuTipoEquipo(ev, nombre, id){
  ev.stopPropagation();
  // Cerrar menú anterior si existe
  if(_menuTipoEl){ _menuTipoEl.remove(); _menuTipoEl=null; return; }
  const btn = ev.currentTarget;
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.id = '_menuTipoEq';
  menu.style.cssText = `position:fixed;z-index:9999;background:white;border:1.5px solid #E2E8F0;border-radius:10px;
    box-shadow:0 8px 24px rgba(0,0,0,.12);padding:6px;min-width:160px;
    top:${rect.bottom+4}px;left:${rect.left}px;`;
  menu.innerHTML = `
    <button onclick="setTipoEquipoActivo('${esc(nombre)}');_menuTipoEl?.remove();_menuTipoEl=null;"
      style="display:block;width:100%;text-align:left;padding:8px 12px;border:none;background:none;cursor:pointer;border-radius:7px;font-size:13px;"
      onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='none'">
      📋 Ver inventario
    </button>
    <div class="!h-[1px] ![background:#F1F5F9] !m-[4px_0]"></div>
    <button onclick="_menuTipoEl?.remove();_menuTipoEl=null;eliminarTipoEquipo(${id},'${esc(nombre)}')"
      style="display:block;width:100%;text-align:left;padding:8px 12px;border:none;background:none;cursor:pointer;border-radius:7px;font-size:13px;color:#B91C1C;"
      onmouseover="this.style.background='#FEF2F2'" onmouseout="this.style.background='none'">
      🗑 Eliminar tipo
    </button>`;
  document.body.appendChild(menu);
  _menuTipoEl = menu;
  // Cerrar al hacer clic fuera
  setTimeout(()=>document.addEventListener('click', function h(){ menu.remove(); _menuTipoEl=null; document.removeEventListener('click',h); }), 50);
}

async function abrirGestionTiposEquipo(){
  await renderListaTiposEquipo();
  document.getElementById('tipoEqNombre').value='';
  document.getElementById('modalTiposEquipo')?.classList.add('open');
  setTimeout(()=>document.getElementById('tipoEqNombre')?.focus(),200);
}
async function renderListaTiposEquipo(){
  await cargarTiposEquipo();
  const wrap = document.getElementById('listaTiposEquipo');
  if(!wrap) return;
  if(!_tiposEquipo.length){
    wrap.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[16px] !text-[13px]">No hay tipos configurados.</div>';
    return;
  }
  wrap.innerHTML = _tiposEquipo.length
    ? _tiposEquipo.map(t=>`
        <div class="!flex !items-center !gap-[10px] !p-[10px_12px] ![border:1.5px_solid_#E2E8F0] !rounded-[10px] ![background:white]">
          <span class="!text-[18px]">${t.icono}</span>
          <div class="![flex:1] !min-w-[0]">
            <div class="!font-bold !text-[13px]">${esc(t.nombre)}</div>
            ${t.descripcion?`<div class="!text-[11px] !text-[#94A3B8]">${esc(t.descripcion)}</div>`:''}
          </div>
          <span class="!text-[11px] !text-[#CBD5E1]">Elimina desde ⋮</span>
        </div>`).join('')
    : '<div class="!text-[#94A3B8] !text-center !p-[16px] !text-[13px]">No hay tipos configurados.</div>';
}

async function crearTipoEquipo(){
  const nombre = (document.getElementById('tipoEqNombre')?.value||'').trim();
  const desc   = (document.getElementById('tipoEqDesc')?.value||'').trim();
  const icono  = '📦';
  if(!nombre){ toast('El nombre es obligatorio','error'); document.getElementById('tipoEqNombre')?.focus(); return; }
  try{
    const res = await fetch('api/equipos.php?action=crear_tipo_equipo',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({nombre, icono, descripcion: desc})
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error al crear');
    document.getElementById('tipoEqNombre').value='';
    if(document.getElementById('tipoEqDesc')) document.getElementById('tipoEqDesc').value='';
    cerrarModal('modalTiposEquipo');
    await cargarTiposEquipo();
    toast(`Tipo "${nombre}" creado ✓`,'success');
    setTipoEquipoActivo(nombre);
  }catch(e){ toast(e.message,'error'); }
}
async function eliminarTipoEquipo(id, nombre){
  try{
    const r=await fetch(`api/equipos.php?action=puede_eliminar_tipo_equipo&id=${id}`,{credentials:'same-origin'});
    const p=await r.json();
    if(p && p.ok===false){
      mostrarConfirmar({icono:'🚫',color:'#D97706',titulo:'No se puede eliminar el tipo',desc:p.motivo||'Hay equipos de este tipo.',btnTxt:'Entendido',btnColor:'#D97706',onConfirmar:()=>{}});
      return;
    }
  }catch(e){ /* el servidor vuelve a validar */ }
  mostrarConfirmar({
    icono:'🗑️',color:'#E24B4A',titulo:'¿Eliminar tipo de equipo?',
    desc:`Vas a eliminar el tipo "${nombre}". Escribe tu contraseña para confirmar.`,
    btnTxt:'Sí, eliminar',btnColor:'#B91C1C',requirePassword:true,
    onConfirmar: async()=>{
      const pi=document.getElementById('modalConfirmarPass'); const pw=(pi&&pi.value)||''; if(pi) pi.value='';
      try{
        const res=await fetch('api/equipos.php?action=eliminar_tipo_equipo',{
          method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({id:Number(id),password:pw})
        });
        const d=await res.json().catch(()=>({}));
        if(!res.ok||d.error){
          if(d.bloqueado){ mostrarConfirmar({icono:'🚫',color:'#D97706',titulo:'No se puede eliminar el tipo',desc:d.error,btnTxt:'Entendido',btnColor:'#D97706',onConfirmar:()=>{}}); }
          else toast(d.error||'No se pudo eliminar','error');
          return;
        }
        toast(`Tipo "${nombre}" eliminado ✓`,'success');
        if(_tipoEquipoActual===nombre) _tipoEquipoActual='';
        await cargarTiposEquipo();
        if(_tiposEquipo.length) setTipoEquipoActivo(_tiposEquipo[0].nombre);
        else { const c=document.getElementById('tipoEquipoContenido'); if(c) c.innerHTML=''; }
      }catch(e){ toast(e.message||'Error','error'); }
    }
  });
}

async function mkRegistrar(){
  const tipoEquipo=(document.getElementById('mkTipoEquipo')?.value||'').trim();
  const proveedor=(document.getElementById('mkProveedor')?.value||'').trim();
  const modelo=(document.getElementById('mkModelo')?.value||'').trim();
  const macRaw=(document.getElementById('mkMacInput')?.value||'').replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
  const sn=(document.getElementById('mkSnInput')?.value||'').trim().toUpperCase();
  const estado=document.getElementById('mkEstadoReg');
  const btn=document.getElementById('btnMkRegistrar');

  if(!tipoEquipo){ toast('Selecciona el tipo de equipo','error'); return; }
  if(!modelo){ toast('El modelo es obligatorio','error'); return; }
  if(macRaw.length===0){ toast('Escribe la MAC','error'); return; }
  if(sn.length<4){ toast('El SN es obligatorio','error'); return; }
  if(!(await _confirmarRegistroLlegada(`este equipo (${tipoEquipo})`, `${tipoEquipo} ${modelo} · SN ${sn}`))) return;

  if(btn){ btn.disabled=true; btn.style.opacity='0.6'; }
  try{
    const res=await fetch('api/equipos.php?action=crear_mikrotik',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({proveedor, modelo, sn, mac:macRaw, tipo_equipo:tipoEquipo})
    });
    const data=await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error al registrar');
    const macFmt=macRaw.match(/.{2}/g).join(':');
    if(estado){ estado.style.display=''; estado.style.background='#EAF3DE'; estado.style.color='#166534'; estado.textContent=`✓ ${tipoEquipo} registrado: ${modelo} · MAC ${macFmt} · SN ${sn}`; }
    toast(`${tipoEquipo} registrado ✓ — SN ${sn}`,'success');
    ['mkMacInput','mkSnInput'].forEach(id=>{const el=document.getElementById(id);if(el){el.value='';el.style.borderColor='';el.style.boxShadow='';}});
    ['mkMacMsg','mkSnMsg','mkMacIcono','mkSnIcono'].forEach(id=>{const el=document.getElementById(id);if(el)el.style.display='none';});
    _actualizarBtnMk();
    await cargarMikrotiks();
    setTimeout(()=>document.getElementById('mkMacInput')?.focus(),100);
  }catch(e){
    if(estado){ estado.style.display=''; estado.style.background='#FCEBEB'; estado.style.color='#B91C1C'; estado.textContent=`⚠ ${e.message}`; }
    toast(e.message,'error');
  }finally{
    if(btn){ btn.disabled=false; _actualizarBtnMk(); }
  }
}

/* ════════════════════════════════════════════════
   SUB-PESTAÑAS OLT Y MIKROTIK
════════════════════════════════════════════════ */
let _tabFibActual='carr';

function setTabFib(t){
  _tabFibActual=t;
  ['carr','hist'].forEach(id=>{
    document.getElementById('tabFib_'+id)?.classList.toggle('active',id===t);
    const el=document.getElementById('fibTab'+id.charAt(0).toUpperCase()+id.slice(1));
    if(el) el.style.display=id===t?'':'none';
  });
  if(t==='carr') cargarCategoriasFibra();
  if(t==='hist') cargarFibHistorial();
}

let _fibHistData = [];
async function cargarFibHistorial(){
  const grid=document.getElementById('fibHistGrid');
  if(!grid) return;
  grid.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[32px]">Cargando…</div>';
  try{
    const r = await fetch('api/fibra.php?action=historial_fibra_completo',{credentials:'same-origin'});
    const movs = await r.json();
    _fibHistData = Array.isArray(movs) ? movs : [];
    filtrarFibHistorial();
  }catch(e){ grid.innerHTML=`<div class="!text-[#E24B4A] !p-[16px]">${esc(e.message)}</div>`; }
}

function filtrarFibHistorial(){
  const grid=document.getElementById('fibHistGrid');
  if(!grid) return;
  const q = (document.getElementById('fibHistBuscar')?.value||'').trim().toLowerCase();
  const tipo = document.getElementById('fibHistTipo')?.value||'';
  const coincide = (t)=> !q || (t||'').toLowerCase().includes(q);
  // Resaltado amarillo de la coincidencia
  const hl=(txt)=>{
    txt=String(txt||'');
    if(!q||!txt) return esc(txt);
    const idx=txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      +`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`
      +esc(txt.slice(idx+q.length));
  };

  const movs = _fibHistData.filter(m=>
    (!tipo || m.clase===tipo) &&
    (coincide(m.fibra)||coincide(m.origen)||coincide(m.destino)||coincide(m.usuario))
  );

  if(!movs.length){
    grid.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[32px] !text-[13px]">'
      + (_fibHistData.length ? 'Sin resultados para el filtro.' : 'Sin movimientos de fibra registrados.')
      + '</div>';
    return;
  }

  const badgeClase={envio:'badge-warn',gasto:'badge-danger',ingreso:'badge-ok'};
  const tipoLabel={envio:'📤 Envío',gasto:'📝 Gasto',ingreso:'📥 Ingreso'};
  let html=`<div class="tbl-wrap"><table><thead><tr>
      <th>Tipo</th><th>Fibra</th><th>Metros</th><th>Origen</th><th>Destino</th><th>Estado</th><th>Usuario</th><th>Fecha</th>
    </tr></thead><tbody>`;
  html+=movs.map(m=>`<tr>
      <td>${tipoLabel[m.clase]||m.clase}</td>
      <td class="!font-semibold">${hl(m.fibra)}</td>
      <td class="![font-family:monospace]">${esc(String(m.metros||'—'))} m</td>
      <td>${hl(m.origen)}</td>
      <td>${hl(m.destino)}</td>
      <td><span class="badge ${badgeClase[m.clase]||'badge-gray'}">${esc(m.estado)}</span></td>
      <td class="!text-[12px] !text-[#64748B]">${hl(m.usuario)}</td>
      <td class="!text-[11px] !text-[#94A3B8] !whitespace-nowrap">${m.fecha?fmtDate(m.fecha):'—'}</td>
    </tr>`).join('');
  html+=`</tbody></table></div>`;
  grid.innerHTML=html;
}

let _tabOltActual='reg', _tabMkActual='reg';

function oltToggleRegistro(){
  const body = document.getElementById('oltFormBody');
  const btn  = document.getElementById('oltToggleBtn');
  if(!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  if(btn) btn.textContent = collapsed ? '▲' : '▼';
}

function setTabOlt(t){
  // Simplificado — solo carga el inventario al entrar
  cargarOlts();
  cargarOltsStock().catch(()=>{});
}

function setTabMk(t){
  _tabMkActual=t;
  ['reg','inv','hist'].forEach(id=>{
    document.getElementById('tabMk_'+id)?.classList.toggle('active',id===t);
    const el=document.getElementById('mkTab'+id.charAt(0).toUpperCase()+id.slice(1));
    if(el) el.style.display=id===t?'':'none';
  });
  if(t==='inv') cargarMikrotiks();
  if(t==='hist') cargarMkHistorial();
}

// Renderiza el historial de un tipo de equipo (OLT o Mikrotik)
// Combina envios_seguimiento + historial general
// Almacena los datos crudos de cada historial para poder filtrar sin recargar.
const _histEquipoData = { olt:{envios:[],hist:[],gridId:'oltHistGrid'},
                          mikrotik:{envios:[],hist:[],gridId:'mkHistGrid'},
                          ont:{envios:[],hist:[],gridId:'ontHistGrid'} };

function filtrarHistEquipo(tipo){
  const st = _histEquipoData[tipo];
  if(!st) return;
  const pref = tipo==='mikrotik'?'mk':tipo; // ids: mkHistBuscar, oltHistBuscar, ontHistBuscar
  const q = (document.getElementById(pref+'HistBuscar')?.value||'').trim().toLowerCase();
  const est = document.getElementById(pref+'HistEstado')?.value||'';

  const coincide = (txt)=> !q || (txt||'').toLowerCase().includes(q);
  const envios = st.envios.filter(e=>
    (!est || e.estado===est) &&
    (coincide(e.nombre_producto)||coincide(e.origen)||coincide(e.destino)||coincide(e.sn)||coincide(e.mac))
  );
  // Los registros de 'hist' no tienen estado de envío; si hay filtro de estado, se ocultan.
  const hist = est ? [] : st.hist.filter(h=>
    coincide(h.nombre)||coincide(h.destino)||coincide(h.enviado_por)
  );
  _pintarHistEquipo(document.getElementById(st.gridId), {envios, hist}, q);
}

function _renderHistEquipo(grid, tipo, data){
  if(!grid) return;
  // Guardar datos crudos para filtrado posterior
  if(_histEquipoData[tipo]){
    _histEquipoData[tipo].envios = data.envios||[];
    _histEquipoData[tipo].hist   = data.hist||[];
    _histEquipoData[tipo].gridId = grid.id;
  }
  // Aplicar filtros actuales (si los hay) al pintar por primera vez
  if(_histEquipoData[tipo]) return filtrarHistEquipo(tipo);
  _pintarHistEquipo(grid, data);
}

function _pintarHistEquipo(grid, data, q){
  if(!grid) return;
  const envios = (data.envios||[]);
  const hist   = (data.hist||[]);
  q = (q||'').toLowerCase();
  // Resaltado amarillo de la coincidencia
  const hl=(txt)=>{
    txt=String(txt||'');
    if(!q||!txt) return esc(txt);
    const idx=txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      +`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`
      +esc(txt.slice(idx+q.length));
  };
  if(!envios.length && !hist.length){
    grid.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[32px] !text-[13px]">Sin movimientos registrados.</div>';
    return;
  }
  const badgeEst={aprobado:'badge-warn',en_camino:'badge-warn',entregado:'badge-ok',recibido:'badge-ok',cancelado:'badge-danger'};
  let html='';
  if(envios.length){
    html+=`<div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !tracking-[.06em] !mb-[10px]">Envíos por seguimiento</div>`;
    html+=`<div class="tbl-wrap"><table><thead><tr><th>Equipo</th><th>Origen</th><th>Destino</th><th>Estado</th><th>Despachado</th><th>Recibido</th></tr></thead><tbody>`;
    html+=envios.map(e=>`<tr>
      <td class="!font-semibold">${hl(e.nombre_producto)}</td>
      <td>${hl(e.origen)}</td>
      <td>${hl(e.destino)}</td>
      <td><span class="badge ${badgeEst[e.estado]||'badge-gray'}">${esc(e.estado)}</span></td>
      <td class="!text-[11px] !text-[#94A3B8]">${e.fecha_aprobado?fmtDate(e.fecha_aprobado):'—'}</td>
      <td class="!text-[11px] !text-[#94A3B8]">${e.fecha_recibido?fmtDate(e.fecha_recibido):'—'}</td>
    </tr>`).join('');
    html+=`</tbody></table></div>`;
  }
  if(hist.length){
    html+=`<div class="!text-[11px] !font-bold !text-[#64748B] !uppercase !tracking-[.06em] !m-[16px_0_10px]">Historial de registros</div>`;
    html+=`<div class="tbl-wrap"><table><thead><tr><th>Equipo</th><th>Destino</th><th>Cantidad</th><th>Registrado por</th><th>Fecha</th></tr></thead><tbody>`;
    html+=hist.map(h=>`<tr>
      <td class="!font-semibold">${hl(h.nombre)}</td>
      <td>${hl(h.destino)}</td>
      <td>${esc(h.cantidad||'1')}</td>
      <td>${hl(h.enviado_por)}</td>
      <td class="!text-[11px] !text-[#94A3B8]">${fmtDate(h.fecha)}</td>
    </tr>`).join('');
    html+=`</tbody></table></div>`;
  }
  grid.innerHTML=html;
}

async function cargarOltHistorial(){
  const grid=document.getElementById('oltHistGrid');
  if(!grid) return;
  grid.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[32px]">Cargando…</div>';
  try{
    const [rEnv, rHist] = await Promise.all([
      fetch('api/seguimiento.php?action=listar&tipo=olt',{credentials:'same-origin'}),
      fetch('api/historial.php?action=listar&producto=OLT&por_pagina=200',{credentials:'same-origin'})
    ]);
    const envios = await rEnv.json();
    const histData = await rHist.json();
    const histLista = histData.registros || histData.rows || (Array.isArray(histData)?histData:[]);
    _renderHistEquipo(grid,'olt',{
      envios: Array.isArray(envios) ? envios.filter(e=>e.tipo==='olt') : [],
      hist:   Array.isArray(histLista) ? histLista.filter(h=>h.ref==='OLT') : []
    });
  }catch(e){ grid.innerHTML=`<div class="!text-[#E24B4A] !p-[16px]">${esc(e.message)}</div>`; }
}

async function cargarMkHistorial(){
  const grid=document.getElementById('mkHistGrid');
  if(!grid) return;
  grid.innerHTML='<div class="!text-[#94A3B8] !text-center !p-[32px]">Cargando…</div>';
  try{
    const [rEnv, rHist] = await Promise.all([
      fetch('api/seguimiento.php?action=listar&tipo=mikrotik',{credentials:'same-origin'}),
      fetch('api/historial.php?action=listar&producto=MIKROTIK&por_pagina=200',{credentials:'same-origin'})
    ]);
    const envios = await rEnv.json();
    const histData = await rHist.json();
    const histLista = histData.registros || histData.rows || (Array.isArray(histData)?histData:[]);
    _renderHistEquipo(grid,'mikrotik',{
      envios: Array.isArray(envios) ? envios.filter(e=>e.tipo==='mikrotik') : [],
      hist:   Array.isArray(histLista) ? histLista.filter(h=>h.ref==='MIKROTIK') : []
    });
  }catch(e){ grid.innerHTML=`<div class="!text-[#E24B4A] !p-[16px]">${esc(e.message)}</div>`; }
}

/* Enruta el botón "Confirmar envío" del modal según el contexto activo. */
function confirmarEnvioModal(){
  if(_equipoEnviar) return confirmarEnviarEquipo();
  return confirmarEnviarOnt();
}

/* ── Enviar OLT / Mikrotik (vía seguimiento) ── */
let _equipoEnviar = null; // {tipo, id}
function abrirEnviarEquipo(tipo, id, nombre){
  _equipoEnviar = {tipo, id};
  const macEl  = document.getElementById('enviarOntMac');
  const snEl   = document.getElementById('enviarOntSn');
  const cajaEl = document.getElementById('enviarOntCaja');
  const sel    = document.getElementById('enviarOntDestino');
  const tit    = document.getElementById('enviarOntTitulo');
  const sub    = document.getElementById('enviarOntSub');
  const lbl    = document.getElementById('enviarOntDestinoLbl');
  if(tit) tit.textContent = `Enviar ${tipo==='olt'?'OLT':'equipo'} a una oficina`;
  if(sub) sub.innerHTML   = 'Elige cualquier oficina del sistema — no solo municipios.';
  if(lbl) lbl.textContent = 'Oficina destino';
  if(macEl)  macEl.textContent  = nombre;
  if(snEl)   snEl.textContent   = (tipo==='olt'?'OLT':'Mikrotik');
  if(cajaEl) cajaEl.textContent = '';
  if(sel){
    // Cualquier oficina activa puede recibir el equipo, no solo municipios.
    const sedes = getSedesActivas();
    sel.innerHTML='<option value="">Seleccionar oficina…</option>'+
      sedes.map(s=>`<option>${esc(s.nombre)}</option>`).join('');
  }
  _ontIdEnviar = null; _ontLoteCajaId = null; // no es envío de ONT
  document.getElementById('modalEnviarOnt')?.classList.add('open');
}

async function confirmarEnviarEquipo(){
  const destino = document.getElementById('enviarOntDestino')?.value;
  if(!destino){ toast('Selecciona un municipio destino','error'); return; }
  if(!_equipoEnviar){ toast('Error: equipo no seleccionado','error'); return; }
  const accion = _equipoEnviar.tipo==='olt' ? 'enviar_olt' : 'enviar_mikrotik';
  try{
    const res = await fetch('api/equipos.php?action='+accion,{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({id:_equipoEnviar.id, destino})
    });
    const data = await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error');
    cerrarModal('modalEnviarOnt');
    toast(`Equipo enviado a ${destino} ✓`,'success');
    if(_equipoEnviar.tipo==='olt') cargarOlts(); else cargarMikrotiks();
    _equipoEnviar=null;
  }catch(e){ toast(e.message,'error'); }
}

async function mkEliminar(id){ _eliminarEquipo('mikrotik', id, '#'+id); }


/* ════════════════════════════════════════════════
   SOLICITUDES DE COMPRA
   Pedir que se COMPRE algo (producto ya registrado o uno nuevo).
   Flujo: pendiente → aprobada (o rechazada/cancelada). El ingreso del material se hace en Ingreso de stock.
════════════════════════════════════════════════ */
let _comprasPendCache = 0;
// Cuenta las solicitudes de compra pendientes (solo para quien las aprueba)
let _comprasMias = [];
async function _recargarComprasPend(){
  if(!sesion) return;
  const gestiona = sesion.rol==='superadmin' || tienePermiso('gestionar_compras');
  const solicita = gestiona || tienePermiso('solicitar_compras');
  if(!solicita){ _comprasPendCache = 0; _comprasMias = []; return; }
  try{
    const d = await _api('compras','listar');
    const lista = Array.isArray(d.solicitudes) ? d.solicitudes : [];
    _comprasMias = lista.filter(s=>s.solicitadoPor===sesion.usuario);
    _comprasPendCache = gestiona ? lista.filter(s=>s.estado==='pendiente').length : 0;
  }catch(e){ return; }
  const b = document.getElementById('nbCompras');
  if(b){ b.textContent = _comprasPendCache || ''; b.style.display = _comprasPendCache>0 ? 'inline-flex' : 'none'; }
  _actualizarBadgeNotifTotal();
  if(document.getElementById('notifLista')) _renderPanelNotif();
}
let _compras = [];
let _comprasPuedeGestionar = false;
let _comprasFiltro = 'todas';
let _compraItemSeq = 0;

const _COMPRA_ESTADOS = {
  pendiente:{t:'Pendiente', bg:'#FAEEDA', c:'#92400E'},
  aprobada: {t:'Aprobada',  bg:'#E6F1FB', c:'#0B4A99'},
  rechazada:{t:'Rechazada', bg:'#FEF2F2', c:'#B91C1C'},
  cancelada:{t:'Cancelada', bg:'#F1F5F9', c:'#64748B'},
};

async function cargarCompras(){
  const cont = document.getElementById('comprasLista');
  if(cont) cont.innerHTML = '<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[30px]">Cargando…</div>';
  try{
    const d = await _api('compras','listar');
    _compras = Array.isArray(d.solicitudes) ? d.solicitudes : [];
    _comprasPuedeGestionar = !!d.puedeGestionar;
    _recargarComprasPend();
  }catch(e){
    _compras = [];
    if(cont) cont.innerHTML = `<div class="!text-center !text-[#DC2626] !text-[13px] !p-[30px]">No se pudieron cargar las solicitudes: ${esc(e.message)}</div>`;
    return;
  }
  renderCompras();
}

function setFiltroCompras(f){
  _comprasFiltro = f;
  renderCompras();
}

function _fmtCantCompra(n){
  const v = parseFloat(n);
  return Number.isInteger(v) ? String(v) : String(Math.round(v*100)/100);
}

function renderCompras(){
  const cont = document.getElementById('comprasLista');
  if(!cont) return;

  // Chips de filtro con contador
  const orden = ['todas','pendiente','aprobada','rechazada'];
  const cuenta = k => k==='todas' ? _compras.length : _compras.filter(s=>s.estado===k).length;
  const chips = document.getElementById('comprasFiltros');
  if(chips){
    chips.innerHTML = orden.map(k=>{
      const act = _comprasFiltro===k;
      const etiqueta = k==='todas' ? 'Todas' : _COMPRA_ESTADOS[k].t;
      return `<button onclick="setFiltroCompras('${k}')" style="border:1.5px solid ${act?'#0C6EDE':'#E2E8F0'};background:${act?'#E6F1FB':'#fff'};color:${act?'#0C6EDE':'#475569'};border-radius:20px;padding:5px 14px;font-size:12px;font-weight:600;cursor:pointer;">${etiqueta} (${cuenta(k)})</button>`;
    }).join('');
  }

  // Filtros: estado + texto + rango de fechas. Orden: más reciente primero.
  const q = ((document.getElementById('comprasBuscar')||{}).value||'').trim().toLowerCase();
  const fd = (document.getElementById('comprasDesde')||{}).value || '';
  const fh = (document.getElementById('comprasHasta')||{}).value || '';
  const ts = s => { const t = Date.parse(String(s.creadoEn||'').replace(' ','T')); return isNaN(t) ? 0 : t; };
  const lista = _compras.filter(s=>{
    if(_comprasFiltro!=='todas' && s.estado!==_comprasFiltro) return false;
    const dia = String(s.creadoEn||'').slice(0,10);
    if(fd && dia < fd) return false;
    if(fh && dia > fh) return false;
    if(q){
      const txt = [s.codigo,s.solicitante,s.solicitadoPor,s.proveedor,s.motivo,s.observacionAdmin,s.motivoRechazo,(s.items||[]).map(i=>i.nombre+' '+(i.nota||'')).join(' ')].join(' ').toLowerCase();
      if(!txt.includes(q)) return false;
    }
    return true;
  }).sort((a,b)=> ts(b)-ts(a) || (b.id||0)-(a.id||0));
  // Resalta en amarillo lo buscado (igual que en las otras pantallas)
  const hl = v => {
    const txt = String(v==null?'':v), idx = q ? txt.toLowerCase().indexOf(q) : -1;
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))+`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx,idx+q.length))}</mark>`+esc(txt.slice(idx+q.length));
  };
  const res = document.getElementById('comprasResumen');
  if(res) res.textContent = lista.length===_compras.length ? `${lista.length} solicitud(es), de la más reciente a la más antigua` : `${lista.length} de ${_compras.length} solicitud(es) con esos filtros`;
  if(!lista.length){
    cont.innerHTML = `<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[40px]">${_compras.length ? 'No hay solicitudes con esos filtros.' : 'Todavía no hay solicitudes de compra. Crea la primera con “+ Nueva solicitud”.'}</div>`;
    return;
  }
  cont.innerHTML = lista.map(s=>{
    const e = _COMPRA_ESTADOS[s.estado] || {t:s.estado,bg:'#F1F5F9',c:'#64748B'};
    const urgente = s.prioridad==='urgente' ? '<span class="![background:#FEE2E2] !text-[#B91C1C] !rounded-[10px] !p-[2px_9px] !text-[11px] !font-bold !ml-[6px]">🔴 Urgente</span>' : '';
    const its = s.items || [];
    const resumen = its.length ? hl(its[0].nombre) + (its.length>1 ? ` y ${its.length-1} más` : '') : 'Sin productos';
    // Con búsqueda activa, se abren solas las solicitudes donde lo encontrado no se ve en la línea de arriba
    const cabeza = [s.codigo, its[0]&&its[0].nombre, s.solicitante].join(' ').toLowerCase();
    const abierta = _comprasAbiertas.has(s.id) || (q && !cabeza.includes(q));
    const items = its.map(i=>`
      <div class="!flex !justify-between !gap-[10px] !p-[6px_0] ![border-bottom:1px_solid_#F1F5F9] !text-[13px]">
        <span>${hl(i.nombre)}${i.esNuevo?' <span class="![background:#FAEEDA] !text-[#7A4300] !rounded-[8px] !p-[1px_8px] !text-[10px] !font-bold">✨ Producto nuevo</span>':''}${i.proveedor?`<div class="!text-[11px] !text-[#7C3AED]">🏭 ${hl(i.proveedor)}</div>`:''}${i.nota?`<div class="!text-[11px] !text-[#94A3B8]">${hl(i.nota)}</div>`:''}</span>
        <strong class="!whitespace-nowrap">${_fmtCantCompra(i.cantidad)} ${esc(i.unidad||'')}${(i.cantidadOriginal!==null && i.cantidadOriginal!==undefined && Math.abs(i.cantidadOriginal-i.cantidad)>0.0001)?`<div class="!text-[11px] !font-medium !text-[#BA7517]">ajustada · pidieron ${_fmtCantCompra(i.cantidadOriginal)}</div>`:''}</strong>
      </div>`).join('');

    // Acciones según estado y permisos
    const acc = [];
    const btn = (txt,fn,cls)=>`<button onclick="${fn}" class="btn ${cls}" style="font-size:12px;padding:6px 14px;">${txt}</button>`;
    if(_comprasPuedeGestionar){
      if(s.estado==='pendiente'){
        acc.push(btn('✓ Aprobar',`abrirAprobarCompra(${s.id})`,'btn-primary'));
        acc.push(btn('✕ Rechazar',`abrirAccionCompra(${s.id})`,'btn-ghost'));
      }
      if(s.estado==='aprobada') acc.push(btn('✕ Rechazar',`abrirAccionCompra(${s.id})`,'btn-ghost'));
    }
    if(s.estado==='aprobada'||s.estado==='rechazada') acc.push(btn('📄 PDF',`_pdfCompra(${s.id})`,'btn-ghost'));
    const esMia = s.solicitadoPor === (sesion && sesion.usuario);
    if(s.estado==='pendiente' && esMia) acc.push(btn('Cancelar solicitud',`cancelarCompra(${s.id})`,'btn-ghost'));

    const extra = [];
    if(s.proveedor) extra.push(`<div><span class="!text-[#94A3B8]">Proveedor:</span> <strong>${hl(s.proveedor)}</strong></div>`);
    if(s.motivo) extra.push(`<div><span class="!text-[#94A3B8]">Motivo:</span> ${hl(s.motivo)}</div>`);
    if(s.estado==='rechazada' && s.motivoRechazo) extra.push(`<div class="!text-[#B91C1C]"><span class="!text-[#94A3B8]">Rechazada:</span> ${hl(s.motivoRechazo)}</div>`);
    if(s.observacionAdmin) extra.push(`<div class="![background:#E6F1FB] !rounded-[8px] !p-[8px_12px]"><span class="!text-[#0B4A99] !font-semibold">Observación del admin:</span> ${hl(s.observacionAdmin)}</div>`);
    if(s.estado==='aprobada') extra.push(`<div class="!text-[12px] !text-[#0B4A99]">✅ Aprobada por ${escU(s.gestionadoPor||'')}. Cuando llegue el material, regístralo en Ingreso de stock.</div>`);

    return `<div style="border:1.5px solid ${abierta?'#B7D4F5':'#E2E8F0'};border-radius:12px;margin-bottom:8px;background:#fff;overflow:hidden;">
      <div onclick="toggleCompra(${s.id})" style="display:flex;align-items:center;gap:12px;padding:11px 16px;cursor:pointer;flex-wrap:wrap;${abierta?'background:#F8FBFF;':''}">
        <span class="!text-[11px] !text-[#94A3B8] !w-[12px]">${abierta?'▼':'▶'}</span>
        <span class="!font-bold !text-[14px]">${hl(s.codigo)}</span>${urgente}
        <span class="!text-[12px] !text-[#64748B] !whitespace-nowrap">${fmtDate(s.creadoEn)}</span>
        <span class="!text-[12px] !text-[#475569] ![flex:1] !min-w-[140px] !overflow-hidden !text-ellipsis !whitespace-nowrap">${resumen} · <span class="!text-[#94A3B8]">${hl(nombreUsr(s.solicitante))}</span></span>
        <span style="background:${e.bg};color:${e.c};border-radius:12px;padding:2px 11px;font-size:11px;font-weight:700;">${e.t}</span>
      </div>
      ${abierta?`<div class="!p-[4px_18px_16px] ![border-top:1px_solid_#EEF2F6]">
        <div class="!text-[12px] !text-[#94A3B8] !m-[8px_0]">Pedida por ${hl(nombreUsr(s.solicitante))} · ${fmtDate(s.creadoEn)}</div>
        ${items}
        ${extra.length?`<div style="margin-top:10px;font-size:13px;display:flex;flex-direction:column;gap:4px;">${extra.join('')}</div>`:''}
        ${acc.length?`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">${acc.join('')}</div>`:''}
      </div>`:''}
    </div>`;
  }).join('');
}
const _comprasAbiertas = new Set();
function toggleCompra(id){
  if(_comprasAbiertas.has(id)) _comprasAbiertas.delete(id); else _comprasAbiertas.add(id);
  renderCompras();
}
function limpiarFiltrosCompras(){
  ['comprasBuscar','comprasDesde','comprasHasta'].forEach(i=>{ const e=document.getElementById(i); if(e) e.value=''; });
  _comprasFiltro = 'todas';
  renderCompras();
}

/* ── Formulario de nueva solicitud ── */
function _limpiarFormCompra(){
  _compraItemSeq = 0;
  const w = document.getElementById('compraItems'); if(w) w.innerHTML = '';
  const m = document.getElementById('compraMotivo'); if(m) m.value = '';
  const pr = document.getElementById('compraProveedor'); if(pr){ pr.value = ''; pr.dataset.auto = ''; }
  const pri = document.getElementById('compraPrioridad'); if(pri) pri.value = 'normal';
}
async function abrirNuevaCompra(){
  _limpiarFormCompra();
  _compraItemSeq = 0;
  document.getElementById('compraItems').innerHTML = '';
  document.getElementById('compraMotivo').value = '';
  document.getElementById('compraPrioridad').value = 'normal';
  try{ if(!_proveedores.length) await cargarProveedores(); }catch(e){}
  try{ await _cargarEspecialesCompra(); }catch(e){}
  const dl = document.getElementById('compraProveedoresDL');
  if(dl) dl.innerHTML = _proveedores.map(p=>`<option value="${esc(p.nombre)}">`).join('');
  _limpiarFormCompra();
  agregarItemCompra();
  document.getElementById('modalCompra').classList.add('open');
}

let _compraEspeciales = []; // ONT, fibra, OLT y equipos (no viven en la tabla de productos)
async function _cargarEspecialesCompra(){
  const out = [];
  try{ if(!(_modelosOnt&&_modelosOnt.length)) await cargarModelosOnt(); }catch(e){}
  (_modelosOnt||[]).forEach(m=> out.push({grupo:'📡 ONT', val:'ONT::'+m.nombre, nombre:'ONT — '+m.nombre+(m.marca?' ('+m.marca+')':''), unidad:'unidades'}));
  try{
    const r = await fetch('api/fibra.php?action=categorias',{credentials:'same-origin'});
    const cats = await r.json();
    (Array.isArray(cats)?cats:[]).forEach(c=> out.push({grupo:'🧵 Fibra / carretes', val:'FIBRA::'+c.id, nombre:'Fibra — '+c.nombre, unidad:'rollos'}));
  }catch(e){}
  out.push({grupo:'🖥️ OLT y equipos', val:'EQUIPO::OLT', nombre:'OLT', unidad:'unidades'});
  try{ if(!(_tiposEquipo&&_tiposEquipo.length)) await cargarTiposEquipo(); }catch(e){}
  (_tiposEquipo||[]).forEach(t=>{ if(String(t.nombre).trim().toLowerCase()==='olt') return; out.push({grupo:'🖥️ OLT y equipos', val:'EQUIPO::'+t.nombre, nombre:'Equipo — '+t.nombre, unidad:'unidades'}); });
  _compraEspeciales = out;
}
function _opcionesProductosCompra(){
  const prods = getProductos().slice().sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es'));
  let h = '<option value="">Selecciona un producto…</option>'
    + '<option value="__nuevo__">✨ Producto nuevo (que no está registrado)</option>'
    + '<optgroup label="📦 Productos">' + prods.map(p=>`<option value="${p.id}">${esc(p.nombre)}</option>`).join('') + '</optgroup>';
  const grupos = {};
  _compraEspeciales.forEach(e=>{ (grupos[e.grupo] ||= []).push(e); });
  Object.keys(grupos).forEach(g=>{ h += `<optgroup label="${esc(g)}">` + grupos[g].map(e=>`<option value="${esc(e.val)}">${esc(e.nombre)}</option>`).join('') + '</optgroup>'; });
  return h;
}

function agregarItemCompra(pre){
  const n = ++_compraItemSeq;
  const wrap = document.getElementById('compraItems');
  const div = document.createElement('div');
  div.className = 'compra-item';
  div.dataset.n = n;
  div.style.cssText = 'border:1.5px solid #E2E8F0;border-radius:12px;padding:12px;background:#FAFBFC;';
  div.innerHTML = `
    <div class="!flex !gap-[8px] !items-center">
      <select class="inp ci-prod ![flex:1]" onchange="_compraItemCambio(${n})">${_opcionesProductosCompra()}</select>
      <button class="![background:#F1F5F9] ![border:none] !rounded-[50%] !w-[28px] !h-[28px] !cursor-pointer !text-[#64748B]" type="button" onclick="quitarItemCompra(${n})" title="Quitar">✕</button>
    </div>
    <input class="inp ci-nuevo !hidden !mt-[8px]" placeholder="Nombre del producto nuevo (ej: Conector SC/APC)">
    <div class="!flex !gap-[8px] !mt-[8px]">
      <input class="inp ci-cant ![flex:1]" type="number" min="0" step="any" placeholder="Cantidad">
      <select class="inp ci-unidad ![flex:1]">
        <option>unidades</option><option>metros</option><option>rollos</option><option>carretes</option><option>cajas</option><option>paquetes</option>
      </select>
    </div>
    <input class="inp ci-provin !mt-[8px]" list="compraProveedoresDL" autocomplete="off" placeholder="🏭 Proveedor de este producto (opcional)">
    <input class="inp ci-nota !mt-[8px]" placeholder="Nota (opcional): referencia, marca, para qué se necesita…">`;
  wrap.appendChild(div);
  if(pre){
    const sel = div.querySelector('.ci-prod');
    if(pre.productoId) sel.value = String(pre.productoId);
    div.querySelector('.ci-cant').value = pre.cantidad || '';
    if(pre.unidad) div.querySelector('.ci-unidad').value = pre.unidad;
    _compraItemCambio(n);
  }
}

function quitarItemCompra(n){
  const el = document.querySelector(`.compra-item[data-n="${n}"]`);
  if(el) el.remove();
}

function _compraItemCambio(n){
  const el = document.querySelector(`.compra-item[data-n="${n}"]`);
  if(!el) return;
  const v = el.querySelector('.ci-prod').value;
  el.querySelector('.ci-nuevo').style.display = v==='__nuevo__' ? '' : 'none';
  // Sugerir la unidad según el producto elegido
  const esp = _compraEspeciales.find(x=>x.val===v);
  if(esp){
    el.querySelector('.ci-unidad').value = esp.unidad;
    const ip = el.querySelector('.ci-provin'); if(ip) ip.value = '';
  } else if(v && v!=='__nuevo__'){
    const p = getProductos().find(x=>String(x.id)===v);
    if(p){
      const sel = el.querySelector('.ci-unidad');
      if(p.metrosPorUnidad>0) sel.value='rollos';
      else if(p.unidad==='metros') sel.value='metros';
      else sel.value='unidades';
      // Proveedor propio de ESTE producto (editable)
      const ip = el.querySelector('.ci-provin');
      if(ip) ip.value = p.proveedor || '';
    }
  } else {
    const ip = el.querySelector('.ci-provin'); if(ip) ip.value = '';
  }
}

// Agrega de una vez los productos cuyo stock en el almacén está en el mínimo o por debajo
function agregarStockBajoCompra(){
  const bajos = getProductos().filter(p=>{
    const min = parseFloat(valorMostrar(p, p.stockMinimo||0))||0;
    if(min<=0) return false;
    const actual = (p.metrosPorUnidad>0 && Array.isArray(p.rollosCentral)) ? p.rollosCentral.length : (parseFloat(valorMostrar(p,_stockCentral(p)||0))||0);
    return actual<=min;
  });
  if(!bajos.length){ toast('Ningún producto está bajo el mínimo ahora mismo','warn'); return; }
  // Quitar la fila vacía inicial si no se ha llenado
  document.querySelectorAll('.compra-item').forEach(el=>{
    if(!el.querySelector('.ci-prod').value && !el.querySelector('.ci-cant').value) el.remove();
  });
  const yaAgregados = new Set([...document.querySelectorAll('.compra-item .ci-prod')].map(s=>s.value));
  let nAgregados = 0;
  bajos.forEach(p=>{
    if(yaAgregados.has(String(p.id))) return;
    const min = parseFloat(valorMostrar(p, p.stockMinimo||0))||0;
    const actual = (p.metrosPorUnidad>0 && Array.isArray(p.rollosCentral)) ? p.rollosCentral.length : (parseFloat(valorMostrar(p,_stockCentral(p)||0))||0);
    const sugerido = Math.max(1, Math.ceil(min*2 - actual)); // reponer hasta el doble del mínimo
    agregarItemCompra({productoId:p.id, cantidad:sugerido});
    nAgregados++;
  });
  toast(nAgregados ? `Se agregaron ${nAgregados} producto(s) con stock bajo — ajusta las cantidades` : 'Esos productos ya estaban en la lista','success');
}

async function enviarSolicitudCompra(){
  const items = [];
  let error = '';
  document.querySelectorAll('.compra-item').forEach(el=>{
    const v = el.querySelector('.ci-prod').value;
    const cant = parseFloat(el.querySelector('.ci-cant').value);
    const unidad = el.querySelector('.ci-unidad').value;
    const nota = el.querySelector('.ci-nota').value.trim();
    const provItem = (el.querySelector('.ci-provin')?.value||'').trim();
    if(!v && !cant) return; // fila vacía: se ignora
    if(!v){ error = 'Elige un producto en cada fila (o quita la fila vacía).'; return; }
    if(!(cant>0)){ error = 'Escribe la cantidad en cada producto.'; return; }
    if(v==='__nuevo__'){
      const nombre = el.querySelector('.ci-nuevo').value.trim();
      if(!nombre){ error = 'Escribe el nombre del producto nuevo.'; return; }
      items.push({nombre, cantidad:cant, unidad, nota, proveedor:provItem});
    } else if(_compraEspeciales.find(x=>x.val===v)){
      const esp = _compraEspeciales.find(x=>x.val===v);
      items.push({especial:v, nombre:esp.nombre, cantidad:cant, unidad, nota, proveedor:provItem});
    } else {
      items.push({productoId:parseInt(v,10), cantidad:cant, unidad, nota, proveedor:provItem});
    }
  });
  if(error){ toast(error,'error'); return; }
  if(!items.length){ toast('Agrega al menos un producto','error'); return; }
  const btn = document.getElementById('btnEnviarCompra');
  if(btn) btn.disabled = true;
  try{
    await _api('compras','crear',{
      items,
      prioridad: document.getElementById('compraPrioridad').value,
      proveedor: (()=>{ const ps=[...new Set(items.map(i=>i.proveedor).filter(Boolean))]; return ps.length===1 ? ps[0] : ''; })(),
      motivo: document.getElementById('compraMotivo').value.trim(),
    });
    cerrarModal('modalCompra');
    _limpiarFormCompra();
    toast('Solicitud de compra enviada','success');
    await cargarCompras();
  }catch(e){ toast(e.message||'No se pudo enviar la solicitud','error'); }
  finally{ if(btn) btn.disabled = false; }
}

/* ── Acciones de gestión ── */
let _compraAprobarId = null;
function abrirAprobarCompra(id){
  const s = _compras.find(x=>x.id===id);
  if(!s) return;
  _compraAprobarId = id;
  document.getElementById('compraAprobarCodigo').textContent = `${s.codigo} · pedida por ${nombreUsr(s.solicitante)}`;
  document.getElementById('compraAprobarObs').value = '';
  document.getElementById('compraAprobarItems').innerHTML = s.items.map(i=>`
    <div class="!flex !items-center !gap-[10px] !p-[10px_12px] ![border:1.5px_solid_#E2E8F0] !rounded-[10px] ![background:#FAFBFC]">
      <div class="![flex:1] !min-w-[0]">
        <div class="!text-[13px] !font-semibold">${esc(i.nombre)}${i.esNuevo?' <span class="![background:#FAEEDA] !text-[#7A4300] !rounded-[8px] !p-[1px_8px] !text-[10px] !font-bold">✨ Nuevo</span>':''}</div>
        <div class="!text-[11px] !text-[#94A3B8]">Pidieron ${_fmtCantCompra(i.cantidad)} ${esc(i.unidad||'')}</div>
      </div>
      <input type="number" min="0" step="any" class="inp ca-cant !w-[90px] !text-right" data-id="${i.id}" data-orig="${i.cantidad}" value="${i.cantidad}" oninput="_compraAprobarMarca(this)">
      <span class="!text-[12px] !text-[#64748B] !min-w-[54px]">${esc(i.unidad||'')}</span>
    </div>`).join('');
  document.getElementById('modalCompraAprobar').classList.add('open');
}
function _compraAprobarMarca(inp){
  const cambio = Math.abs(parseFloat(inp.value||0) - parseFloat(inp.dataset.orig)) > 0.0001;
  inp.style.borderColor = cambio ? '#BA7517' : '';
  inp.style.background = cambio ? '#FFFBEB' : '';
}
function _pdfCompra(id){
  let ov=document.getElementById('compraPdfOverlay');
  if(!ov){
    ov=document.createElement('div');
    ov.id='compraPdfOverlay';
    ov.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:100000;display:none;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML='<div style="background:#fff;border-radius:12px;width:min(960px,100%);height:100%;max-height:94vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4);">'
      +'<div class="!flex !justify-between !items-center !p-[10px_16px] ![border-bottom:1px_solid_#E2E8F0]">'
      +'<strong class="!text-[14px]">📄 Solicitud de compra</strong>'
      +'<span class="!flex !gap-[8px]"><button onclick="try{var f=document.getElementById(\'compraPdfFrame\').contentWindow;f.focus();f.print();}catch(e){}" class="btn btn-primary !text-[12px] !p-[6px_14px]">🖨️ Imprimir</button>'
      +'<button onclick="_cerrarPdfCompra()" class="btn btn-ghost !text-[12px] !p-[6px_14px]">✕ Cerrar</button></span></div>'
      +'<iframe id="compraPdfFrame" style="flex:1;border:0;width:100%;background:#fff;"></iframe></div>';
    ov.addEventListener('click',e=>{ if(e.target===ov) _cerrarPdfCompra(); });
    document.body.appendChild(ov);
  }
  const fr=document.getElementById('compraPdfFrame');
  fr.srcdoc='<p class="![font-family:Arial] !p-[40px] !text-[#64748B]">Cargando…</p>';
  ov.style.display='flex';
  // Se descarga el HTML y se muestra con srcdoc: el servidor bloquea abrir api/ dentro de un iframe (X-Frame-Options)
  const base=new URL('api/',location.href).href;
  fetch('api/compras_pdf.php?id='+id+'&autoprint=1',{credentials:'same-origin'})
    .then(r=>r.text())
    .then(h=>{
      fr.onload = ()=>{
        if(!fr.srcdoc || fr.srcdoc.indexOf('Cargando…')>-1 || fr.srcdoc.indexOf('No se pudo')>-1) return;
        fr.onload = null;
        setTimeout(()=>{ try{ fr.contentWindow.focus(); fr.contentWindow.print(); }catch(e){} _cerrarPdfCompra(); }, 400);
      };
      fr.srcdoc = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i,m=>m+'<base href="'+base+'">') : '<base href="'+base+'">'+h; })
    .catch(()=>{ fr.srcdoc='<p class="![font-family:Arial] !p-[40px] !text-[#B91C1C]">No se pudo cargar el documento.</p>'; });
}
function _cerrarPdfCompra(){
  const ov=document.getElementById('compraPdfOverlay');
  if(ov){ ov.style.display='none'; const f=document.getElementById('compraPdfFrame'); if(f) f.srcdoc=''; }
}
async function confirmarAprobarCompra(){
  if(!_compraAprobarId) return;
  const items = [];
  let error = '';
  document.querySelectorAll('#compraAprobarItems .ca-cant').forEach(inp=>{
    const c = parseFloat(inp.value);
    if(!(c>0)) error = 'Todas las cantidades deben ser mayores a 0.';
    items.push({id:parseInt(inp.dataset.id,10), cantidad:c});
  });
  if(error){ toast(error,'error'); return; }
  const btn = document.getElementById('btnConfirmarAprobar');
  if(btn) btn.disabled = true;
  const idA = _compraAprobarId;
  try{
    await _api('compras','aprobar',{
      id:_compraAprobarId, items,
      observacion: document.getElementById('compraAprobarObs').value.trim(),
    });
    cerrarModal('modalCompraAprobar');
    toast('Solicitud aprobada','success');
    await cargarCompras();
  }catch(e){ toast(e.message,'error'); }
  finally{ if(btn) btn.disabled = false; }
}
async function cancelarCompra(id){
  if(!confirm('¿Cancelar esta solicitud de compra?')) return;
  try{ await _api('compras','cancelar',{id}); toast('Solicitud cancelada','success'); await cargarCompras(); }
  catch(e){ toast(e.message,'error'); }
}

let _compraAccion = null; // {id}
function abrirAccionCompra(id){
  _compraAccion = {id};
  document.getElementById('compraAccionMotivo').value = '';
  document.getElementById('modalCompraAccion').classList.add('open');
}
async function confirmarAccionCompra(){
  if(!_compraAccion) return;
  const motivo = document.getElementById('compraAccionMotivo').value.trim();
  if(!motivo){ toast('Escribe el motivo del rechazo','error'); return; }
  const idR = _compraAccion.id;
  try{
    await _api('compras','rechazar',{id:idR,motivo});
    toast('Solicitud rechazada','success');
    cerrarModal('modalCompraAccion');
    await cargarCompras();
  }catch(e){ toast(e.message,'error'); }
}

/* ════════════════════════════════════════════════
   INFORME DE ONT POR OFICINA (Informes → 📡 ONT por oficina)
════════════════════════════════════════════════ */
let _ontInfDatos = null;
function _ontInfEstadoTxt(e){ return e==='sin_estado' ? 'Sin estado' : (String(e||'').charAt(0).toUpperCase()+String(e||'').slice(1)).replace(/_/g,' '); }
function _ontInfFiltros(){
  const v = id => (document.getElementById(id)||{}).value || '';
  return { fecha_tipo:v('ontInfTipo')||'despacho', desde:v('ontInfDesde'), hasta:v('ontInfHasta'),
           modelo:v('ontInfModelo'), estado:v('ontInfEstado'), oficina:v('ontInfOficina') };
}
function _ontInfQuery(){
  const f = _ontInfFiltros();
  return Object.keys(f).filter(k=>f[k]).map(k=>k+'='+encodeURIComponent(f[k])).join('&');
}
function _ontInfRango(r){
  const hoy = new Date(), iso = d => d.toISOString().slice(0,10);
  const dEl=document.getElementById('ontInfDesde'), hEl=document.getElementById('ontInfHasta');
  if(r===0){ dEl.value=''; hEl.value=''; }
  else if(r==='mes'){ dEl.value = iso(new Date(hoy.getFullYear(),hoy.getMonth(),1)); hEl.value = iso(hoy); }
  else { dEl.value = iso(new Date(hoy.getTime()-r*86400000)); hEl.value = iso(hoy); }
  cargarOntInforme();
}
function _ontInfLlenarSelect(id, valores, todos, fmt){
  const sel = document.getElementById(id); if(!sel) return;
  const actual = sel.value;
  sel.innerHTML = `<option value="">${todos}</option>` + valores.map(x=>`<option value="${esc(x)}">${esc(fmt?fmt(x):x)}</option>`).join('');
  if(valores.includes(actual)) sel.value = actual;
}
async function cargarOntInforme(auto){
  const cuerpo = document.getElementById('ontInfCuerpo'); if(!cuerpo) return;
  cuerpo.innerHTML = '<div class="!p-[30px] !text-center !text-[#94A3B8]">Cargando…</div>';
  try{
    const d = await _api('informes','onts_informe',null,_ontInfQuery()+(auto===true?'&auto=1':''));
    _ontInfDatos = d;
    _ontInfLlenarSelect('ontInfModelo', d.opciones.modelos, 'Todos');
    _ontInfLlenarSelect('ontInfEstado', d.opciones.estados, 'Todos', _ontInfEstadoTxt);
    _ontInfLlenarSelect('ontInfOficina', d.opciones.oficinas, 'Todas');
    _renderOntInforme(d);
  }catch(e){ cuerpo.innerHTML = `<div class="!p-[30px] !text-[#B91C1C]">Error: ${esc(e.message)}</div>`; }
}
function _renderOntInforme(d){
  const kp = document.getElementById('ontInfKpis'), cuerpo = document.getElementById('ontInfCuerpo');
  const estados = Object.keys(d.por_estado);
  kp.innerHTML = `<div class="pcard !p-[12px_20px] !text-center"><div style="font-size:26px;font-weight:800;color:#0C6EDE;">${d.total}</div><div class="!text-[11px] !text-[#64748B]">Total ONT</div></div>`
    + estados.map(e=>`<div class="pcard !p-[12px_20px] !text-center"><div style="font-size:26px;font-weight:800;color:#0F172A;">${d.por_estado[e]}</div><div class="!text-[11px] !text-[#64748B]">${esc(_ontInfEstadoTxt(e))}</div></div>`).join('');
  if(!d.total){ cuerpo.innerHTML = '<div class="pcard !p-[30px] !text-center !text-[#94A3B8]">No hay ONT con esos filtros.</div>'; return; }
  const th = 'padding:8px 10px;font-size:10px;color:#7C8DB5;text-transform:uppercase;text-align:center;';
  const td = 'padding:8px 10px;border-top:1px solid #F1F5F9;font-size:12px;text-align:center;';
  const matriz = (titulo, filas, campo) => `
    <div class="pcard !mb-[16px] !overflow-x-auto">
      <div class="pcard-header"><span class="!font-bold !text-[14px]">${titulo}</span></div>
      <table class="!w-[100%] ![border-collapse:collapse]">
        <thead><tr><th style="${th}text-align:left;">${campo==='oficina'?'Oficina':'Modelo'}</th>${estados.map(e=>`<th style="${th}">${esc(_ontInfEstadoTxt(e))}</th>`).join('')}<th style="${th}">Total</th></tr></thead>
        <tbody>${filas.map(o=>`<tr><td style="${td}text-align:left;font-weight:600;">${esc(o[campo])}</td>${estados.map(e=>`<td style="${td}">${o.estados[e]||'·'}</td>`).join('')}<td style="${td}font-weight:800;">${o.total}</td></tr>`).join('')}</tbody>
      </table>
    </div>`;
  const MAX = 300;
  const fe = f => f ? fmtDate(f) : '—';
  cuerpo.innerHTML = matriz('🏢 Por oficina', d.por_oficina, 'oficina')
    + matriz('📡 Por modelo', d.por_modelo, 'modelo')
    + `<div class="pcard !mb-[16px] !overflow-x-auto">
      <div class="pcard-header"><span class="!font-bold !text-[14px]">📋 Detalle</span>
        <span class="!text-[11px] !text-[#94A3B8]">${d.filas.length>MAX?`Se muestran ${MAX} de ${d.total} — el Excel trae todas`:`${d.filas.length} ONT`}</span></div>
      <table class="!w-[100%] ![border-collapse:collapse]">
        <thead><tr><th style="${th}text-align:left;">MAC</th><th style="${th}text-align:left;">Serie</th><th style="${th}text-align:left;">Modelo</th><th style="${th}">Estado</th><th style="${th}text-align:left;">Oficina</th><th style="${th}text-align:left;">Técnico</th><th style="${th}">Despacho</th><th style="${th}">Instalación</th></tr></thead>
        <tbody>${d.filas.slice(0,MAX).map(r=>`<tr>
          <td style="${td}text-align:left;font-family:monospace;color:#0A58B5;">${esc(r.mac||'—')}</td>
          <td style="${td}text-align:left;font-family:monospace;color:#64748B;">${esc(r.sn||'—')}</td>
          <td style="${td}text-align:left;">${esc(r.modelo)}</td>
          <td style="${td}"><span class="badge badge-brand !text-[10px]">${esc(_ontInfEstadoTxt(r.estado||'sin_estado'))}</span></td>
          <td style="${td}text-align:left;">${esc(r.oficina)}</td>
          <td style="${td}text-align:left;">${esc(r.tecnico||'—')}</td>
          <td style="${td}">${fe(r.f_despacho)}</td><td style="${td}">${fe(r.f_instalacion)}</td></tr>`).join('')}</tbody>
      </table></div>`;
}
function exportarOntInformeExcel(){
  const d = _ontInfDatos;
  if(!d || !d.total){ toast('No hay datos para exportar. Genera el informe primero.','warn'); return; }
  const estados = Object.keys(d.por_estado);
  const matriz = (filas,campo,nom) => filas.map(o=>{
    const r = {[nom]:o[campo]}; estados.forEach(e=>{ r[_ontInfEstadoTxt(e)] = o.estados[e]||0; }); r['Total']=o.total; return r; });
  const f = _ontInfFiltros();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matriz(d.por_oficina,'oficina','Oficina')), 'Por oficina');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(matriz(d.por_modelo,'modelo','Modelo')), 'Por modelo');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.filas.map(r=>({
    'MAC':r.mac||'', 'Serie':r.sn||'', 'Modelo':r.modelo, 'Estado':_ontInfEstadoTxt(r.estado||'sin_estado'),
    'Oficina':r.oficina, 'Técnico':r.tecnico||'', 'Cliente':r.cliente||'',
    'Fecha despacho':r.f_despacho||'', 'Fecha ingreso':r.f_ingreso||'', 'Fecha instalación':r.f_instalacion||''
  }))), 'Detalle');
  const rango = (f.desde||f.hasta) ? `_${f.desde||'inicio'}_a_${f.hasta||'hoy'}` : '';
  XLSX.writeFile(wb, `ONT_por_oficina${rango}.xlsx`);
  _api('informes','onts_informe_excel',{...f,total:d.total}).catch(()=>{});
  if(d.truncado) toast('Ojo: el detalle se cortó en 5000 ONT. Filtra por fecha u oficina para ver el resto.','warn');
}
function verPdfOntInforme(){
  _verPdfEnPagina('api/onts_informe_pdf.php?autoprint=1&'+_ontInfQuery(), 'Informe de ONT por oficina');
}

/* ════════════════════════════════════════════════
   INFORME DE GASTOS (Informes → 📉 Gastos)
════════════════════════════════════════════════ */
let _gasInfDatos = null;
function _gasInfFiltros(){
  const v = id => (document.getElementById(id)||{}).value || '';
  return { desde:v('gasInfDesde'), hasta:v('gasInfHasta'), producto:v('gasInfProducto'),
           usuario:v('gasInfUsuario'), sede:v('gasInfSede'), cliente:v('gasInfCliente') };
}
function _gasInfQuery(){
  const f = _gasInfFiltros();
  return Object.keys(f).filter(k=>f[k]).map(k=>k+'='+encodeURIComponent(f[k])).join('&');
}
function _gasInfRango(r, auto){
  const hoy = new Date(), iso = d => d.toISOString().slice(0,10);
  const dEl=document.getElementById('gasInfDesde'), hEl=document.getElementById('gasInfHasta');
  if(r==='mes'){ dEl.value = iso(new Date(hoy.getFullYear(),hoy.getMonth(),1)); hEl.value = iso(hoy); }
  else { dEl.value = iso(new Date(hoy.getTime()-r*86400000)); hEl.value = iso(hoy); }
  cargarGastosInforme(auto===true);
}
function _gasInfLimpiar(){
  ['gasInfDesde','gasInfHasta','gasInfProducto','gasInfUsuario','gasInfSede','gasInfCliente'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  cargarGastosInforme();
}
function _gasInfNum(n){ n=parseFloat(n); if(isNaN(n)) return '0'; return Number.isInteger(n)?String(n):String(Math.round(n*100)/100); }
async function cargarGastosInforme(auto){
  const cuerpo = document.getElementById('gasInfCuerpo'); if(!cuerpo) return;
  cuerpo.innerHTML = '<div class="!p-[30px] !text-center !text-[#94A3B8]">Cargando…</div>';
  try{
    const d = await _api('informes','gastos_informe',null,_gasInfQuery()+(auto===true?'&auto=1':''));
    _gasInfDatos = d;
    const llenar = (id, vacio, lista, conTexto) => {
      const sel = document.getElementById(id); if(!sel) return;
      const act = sel.value;
      sel.innerHTML = `<option value="">${vacio}</option>` + (lista||[]).map(x => conTexto
        ? `<option value="${esc(x.valor)}">${esc(x.texto)}</option>` : `<option value="${esc(x)}">${esc(x)}</option>`).join('');
      sel.value = act;
    };
    llenar('gasInfSede','Todas',d.opciones.sedes,false);
    llenar('gasInfProducto','Todos',d.opciones.productos,true);
    llenar('gasInfUsuario','Todas',d.opciones.personas,true);
    llenar('gasInfCliente','Todos',d.opciones.clientes,false);
    _renderGastosInforme(d);
  }catch(e){ cuerpo.innerHTML = `<div class="!p-[30px] !text-[#B91C1C]">Error: ${esc(e.message)}</div>`; }
}
function _renderGastosInforme(d){
  const kp = document.getElementById('gasInfKpis'), cuerpo = document.getElementById('gasInfCuerpo');
  const k = (n,t,c)=>`<div class="pcard !p-[12px_20px] !text-center"><div style="font-size:26px;font-weight:800;color:${c};">${n}</div><div class="!text-[11px] !text-[#64748B]">${t}</div></div>`;
  kp.innerHTML = k(d.total,'Gastos registrados','#B45309') + k(d.por_producto.length,'Productos distintos','#0C6EDE') + k(d.por_persona.length,'Personas','#7C3AED');
  if(!d.total){ cuerpo.innerHTML = '<div class="pcard !p-[30px] !text-center !text-[#94A3B8]">No hay gastos con esos filtros.</div>'; return; }
  const th = 'padding:8px 10px;font-size:10px;color:#7C8DB5;text-transform:uppercase;text-align:left;';
  const td = 'padding:8px 10px;border-top:1px solid #F1F5F9;font-size:12px;';
  const MAX = 300;
  cuerpo.innerHTML = `
    <div class="pcard !mb-[16px] !overflow-x-auto">
      <div class="pcard-header"><span class="!font-bold !text-[14px]">📦 Total gastado por producto</span></div>
      <table class="!w-[100%] ![border-collapse:collapse]"><thead><tr><th style="${th}">Ref</th><th style="${th}">Producto</th><th style="${th}text-align:right;">Total gastado</th><th style="${th}text-align:right;"># Gastos</th></tr></thead>
      <tbody>${d.por_producto.map(r=>`<tr><td style="${td}font-family:monospace;color:#64748B;">${esc(r.ref)}</td><td style="${td}font-weight:600;">${esc(r.nombre)}</td><td style="${td}text-align:right;font-weight:800;color:#B45309;">${_gasInfNum(r.total)} ${esc(r.unidad)}</td><td style="${td}text-align:right;">${r.veces}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="pcard !mb-[16px] !overflow-x-auto">
      <div class="pcard-header"><span class="!font-bold !text-[14px]">👤 Por persona — qué gastó cada una</span></div>
      <table class="!w-[100%] ![border-collapse:collapse]"><thead><tr><th style="${th}">Persona</th><th style="${th}">Sede</th><th style="${th}text-align:right;"># Gastos</th><th style="${th}">Qué gastó</th></tr></thead>
      <tbody>${d.por_persona.map(r=>`<tr><td style="${td}font-weight:600;">${esc(r.nombre)}</td><td style="${td}">${esc(r.sede||'—')}</td><td style="${td}text-align:right;font-weight:700;">${r.num_gastos}</td><td style="${td}color:#475569;">${esc(r.detalle)}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="pcard !mb-[16px] !overflow-x-auto">
      <div class="pcard-header"><span class="!font-bold !text-[14px]">📋 Detalle de gastos</span>
        <span class="!text-[11px] !text-[#94A3B8]">${d.filas.length>MAX?`Se muestran ${MAX} de ${d.total} — el Excel trae todos`:`${d.filas.length} gasto(s)`}</span></div>
      <table class="!w-[100%] ![border-collapse:collapse]"><thead><tr><th style="${th}">Fecha</th><th style="${th}">Producto</th><th style="${th}text-align:right;">Cantidad</th><th style="${th}">Persona</th><th style="${th}">Cliente / proyecto</th><th style="${th}">Descripción</th></tr></thead>
      <tbody>${d.filas.slice(0,MAX).map(r=>`<tr><td style="${td}white-space:nowrap;color:#64748B;">${fmtDate(r.fecha)}</td><td style="${td}font-weight:600;">${esc(r.nombre)}</td><td style="${td}text-align:right;font-weight:700;">${_gasInfNum(r.cantidad)} ${esc(r.unidad)}</td><td style="${td}">${esc(r.persona_nombre||'—')}</td><td style="${td}">${esc(r.cliente||'—')}</td><td style="${td}font-size:11px;color:#64748B;max-width:260px;">${esc((r.descripcion||'').slice(0,120))}</td></tr>`).join('')}</tbody></table>
    </div>`;
}
function exportarGastosInformeExcel(){
  const d = _gasInfDatos;
  if(!d || !d.total){ toast('No hay datos para exportar. Genera el informe primero.','warn'); return; }
  const f = _gasInfFiltros();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.por_producto.map(r=>({'Ref':r.ref,'Producto':r.nombre,'Total gastado':r.total,'Unidad':r.unidad,'Nº de gastos':r.veces}))), 'Total por producto');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.por_persona.map(r=>({'Usuario':r.usuario,'Persona':r.nombre,'Sede':r.sede,'Nº de gastos':r.num_gastos,'Qué gastó':r.detalle}))), 'Por persona');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d.filas.map(r=>({'Fecha':r.fecha,'Ref':r.ref,'Producto':r.nombre,'Cantidad':r.cantidad,'Unidad':r.unidad,'Usuario':r.persona,'Persona':r.persona_nombre,'Sede':r.sede,'Cliente / proyecto':r.cliente,'Descripción':r.descripcion,'GPS lat':r.gps_lat||'','GPS lng':r.gps_lng||''}))), 'Detalle');
  const rango = (f.desde||f.hasta) ? `_${f.desde||'inicio'}_a_${f.hasta||'hoy'}` : '';
  XLSX.writeFile(wb, `Gastos${rango}.xlsx`);
  _api('informes','gastos_informe_excel',{...f,total:d.total}).catch(()=>{});
  if(d.truncado) toast('Ojo: el detalle se cortó en 5000 gastos. Filtra por fecha para ver el resto.','warn');
}
function verPdfGastosInforme(){
  _verPdfEnPagina('api/gastos_informe_pdf.php?autoprint=1&'+_gasInfQuery(), 'Informe de gastos');
}

/* Muestra un PDF imprimible ahí mismo (sin pestaña nueva) y abre la impresión */
function _verPdfEnPagina(url, titulo){
  let ov = document.getElementById('pdfGenOverlay');
  if(!ov){
    ov = document.createElement('div');
    ov.id = 'pdfGenOverlay';
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.65);z-index:100000;display:none;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML = '<div style="background:#fff;border-radius:12px;width:min(1000px,100%);height:100%;max-height:94vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4);">'
      + '<div class="!flex !justify-between !items-center !p-[10px_16px] ![border-bottom:1px_solid_#E2E8F0]">'
      + '<strong id="pdfGenTitulo" style="font-size:14px;"></strong>'
      + '<button onclick="_cerrarPdfEnPagina()" class="btn btn-ghost !text-[12px] !p-[6px_14px]">✕ Cerrar</button></div>'
      + '<iframe id="pdfGenFrame" style="flex:1;border:0;width:100%;background:#fff;"></iframe></div>';
    ov.addEventListener('click', e=>{ if(e.target===ov) _cerrarPdfEnPagina(); });
    document.body.appendChild(ov);
  }
  document.getElementById('pdfGenTitulo').textContent = '📄 ' + titulo;
  const fr = document.getElementById('pdfGenFrame');
  fr.srcdoc = '<p class="![font-family:Arial] !p-[40px] !text-[#64748B]">Cargando…</p>';
  ov.style.display = 'flex';
  const base = new URL('api/', location.href).href;
  fetch(url, {credentials:'same-origin'}).then(r=>r.text()).then(h=>{
    fr.onload = ()=>{
      if(fr.srcdoc.indexOf('Cargando…')>-1) return;
      fr.onload = null;
      setTimeout(()=>{ try{ fr.contentWindow.focus(); fr.contentWindow.print(); }catch(e){} _cerrarPdfEnPagina(); }, 400);
    };
    fr.srcdoc = /<head[^>]*>/i.test(h) ? h.replace(/<head[^>]*>/i, m=>m+'<base href="'+base+'">') : '<base href="'+base+'">'+h;
  }).catch(()=>{ fr.srcdoc = '<p class="![font-family:Arial] !p-[40px] !text-[#B91C1C]">No se pudo cargar el documento.</p>'; });
}
function _cerrarPdfEnPagina(){
  const ov = document.getElementById('pdfGenOverlay');
  if(ov){ ov.style.display='none'; const f=document.getElementById('pdfGenFrame'); if(f) f.srcdoc=''; }
}

init();