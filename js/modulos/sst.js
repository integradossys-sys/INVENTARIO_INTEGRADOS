/* ════════════════════════════════════════════════
   SST — Seguridad y Salud en el Trabajo
   Cascos, escaleras, eslingas, arneses, herramientas…
   (estilos inline a propósito: no requiere recompilar Tailwind)
════════════════════════════════════════════════ */
let SST_CATS={};   // clave → [icono, nombre]; se llena desde el servidor (las crea el usuario)
let _sstItems=[], _sstPersonas=[], _sstTab='resumen', _sstEntFiltro='abiertas', _sstEntregas=[], _sstResumen=null;

function sstPuedeGestionar(){
  return !!sesion && (sesion.rol==='superadmin'||sesion.rol==='distribuidor'||tienePermiso('gestionar_sst'));
}
function _sstCat(c){const x=SST_CATS[c];return x?x[0]+' '+x[1]:'📦 '+esc(c||'');}
async function _sstCargarCats(){
  try{
    const r=await _api('sst','categorias'); SST_CATS={};
    r.forEach(c=>{SST_CATS[c.clave]=[c.icono,c.nombre,c.usados,c.campos||[]];});
  }catch(e){}
  const f=document.getElementById('sstFiltroCat');
  if(f){const v=f.value;f.innerHTML='<option value="">Todas</option>'+Object.entries(SST_CATS).map(([k,x])=>`<option value="${esc(k)}">${esc(x[0])} ${esc(x[1])}</option>`).join('');f.value=SST_CATS[v]?v:'';}
}
function _sstFechaCorta(d){
  if(!d) return '—';
  const p=String(d).slice(0,10).split('-');
  return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:d;
}
function _sstDias(d){
  if(!d) return null;
  const hoy=new Date();hoy.setHours(0,0,0,0);
  const f=new Date(String(d).slice(0,10)+'T00:00:00');
  return Math.round((f-hoy)/86400000);
}
function _sstTextoDias(d){
  const n=_sstDias(d); if(n===null) return '';
  if(n<0) return `hace ${-n} día${n===-1?'':'s'}`;
  if(n===0) return 'hoy';
  return `en ${n} día${n===1?'':'s'}`;
}
function _sstBadgeEstado(it){
  if(it.estado==='baja') return '<span class="badge badge-gray">⚫ De baja</span>';
  if(it.estado==='mantenimiento') return '<span class="badge badge-warn">🛠️ Mantenimiento</span>';
  if(it.disponible===0 && it.en_uso>0) return '<span class="badge badge-purple">👤 Todo entregado</span>';
  return '<span class="badge badge-ok">✅ Disponible</span>';
}
function _sstAlertaFecha(d){
  const n=_sstDias(d); if(n===null) return '';
  return n<0?'inspeccion_vencida':(n<=30?'inspeccion_proxima':'');
}
function _sstBadgeAlerta(a){
  const m={inspeccion_vencida:['badge-danger','🔍 Inspección vencida'],inspeccion_proxima:['badge-warn','🔍 Inspección próxima']};
  return m[a]?`<span class="badge ${m[a][0]}">${m[a][1]}</span>`:'';
}

/* ───────── Carga y tabs ───────── */
async function iniciarSST(){
  if(!sstPuedeGestionar()) return;
  await _sstCargarCats();
  setTabSST(_sstTab||'resumen');
}
function setTabSST(t){
  _sstTab=t;
  ['resumen','inventario','entregas','mio'].forEach(id=>{
    document.getElementById('tabSST_'+id)?.classList.toggle('active',id===t);
    const el=document.getElementById('sstTab_'+id); if(el) el.style.display=id===t?'':'none';
  });
  if(t==='resumen') cargarSstResumen();
  if(t==='inventario') cargarSstInventario();
  if(t==='entregas') cargarSstEntregas();
  if(t==='mio') sstRenderMio('sstMioLista');
}
async function _sstCargarItems(){
  _sstItems=await _api('sst','listar');
  if(!Array.isArray(_sstItems)) _sstItems=[];
  return _sstItems;
}
async function actualizarBadgeSst(){
  try{
    if(!sstPuedeGestionar()) return;
    const r=await _api('sst','badge');
    const b=document.getElementById('nbSst'); if(!b) return;
    if(r.alertas>0){b.textContent=r.alertas;b.style.display='inline-flex';} else b.style.display='none';
  }catch(e){}
}

/* ───────── Resumen ───────── */
async function cargarSstResumen(){
  const box=document.getElementById('sstResumenBox'); if(!box) return;
  box.innerHTML='<div style="text-align:center;color:#94A3B8;padding:30px;font-size:13px;">Cargando…</div>';
  try{
    const r=await _api('sst','resumen'); _sstResumen=r;
    const s=r.resumen;
    const kpi=(ico,n,txt,col,bg,tab)=>`<div ${tab?`onclick="setTabSST('${tab}')"`:''} style="flex:1 1 150px;min-width:140px;background:${bg};border-radius:14px;padding:14px 16px;${tab?'cursor:pointer;':''}">
      <div style="font-size:22px;">${ico}</div><div style="font-size:26px;font-weight:700;color:${col};line-height:1.1;margin-top:4px;">${n}</div>
      <div style="font-size:12px;color:#64748B;margin-top:2px;">${txt}</div></div>`;
    let h=`<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;">
      ${kpi('🦺',s.total,'Total en operación','#0A1F5C','#EEF3FB','inventario')}
      ${kpi('✅',s.disponibles,'Disponibles','#1E8F1E','#E8F8E8','inventario')}
      ${kpi('👤',s.en_uso,'Entregados a personas','#5B21B6','#EDE9FE','entregas')}
      ${kpi('🛠️',s.mantenimiento,'En mantenimiento','#92400E','#FAEEDA','inventario')}
      ${kpi('⚠️',s.alertas,'Con alertas','#B91C1C','#FCEBEB',null)}
      ${kpi('⏱️',s.pendientes_confirmar,'Entregas sin confirmar','#0F766E','#CCFBF1','entregas')}
    </div>`;
    if(!r.alertas.length){
      h+='<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:16px;text-align:center;color:#166534;font-size:14px;">✅ Todo al día: no hay inspecciones vencidas ni por vencer en los próximos 30 días.</div>';
    }else{
      h+='<div style="font-weight:700;font-size:14px;margin-bottom:8px;">⚠️ Requieren atención</div>';
      h+=r.alertas.map(i=>{
        const fecha=i.prox_inspeccion;
        return `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;border:1px solid #EEF2F6;border-radius:12px;padding:10px 14px;margin-bottom:8px;">
          <div style="flex:1;min-width:180px;"><div style="font-weight:600;font-size:13px;">${esc(i.nombre)} <span style="color:#94A3B8;font-weight:500;">${esc(i.codigo)}</span></div>
            <div style="font-size:12px;color:#64748B;">${_sstCat(i.categoria)} · Próxima inspección: ${_sstFechaCorta(fecha)} (${_sstTextoDias(fecha)})</div></div>
          ${_sstBadgeAlerta(i.alerta)}
          <button class="btn btn-ghost" style="font-size:12px;padding:6px 12px;" onclick="sstAbrirInspeccion(${i.id})">🔍 Inspeccionar</button>
        </div>`;}).join('');
    }
    box.innerHTML=h;
  }catch(e){box.innerHTML=`<div style="color:#B91C1C;padding:20px;font-size:13px;">${esc(e.message)}</div>`;}
  actualizarBadgeSst();
}

/* ───────── Inventario ───────── */
async function cargarSstInventario(){
  const l=document.getElementById('sstInvLista'); if(!l) return;
  l.innerHTML='<div style="text-align:center;color:#94A3B8;padding:30px;font-size:13px;">Cargando…</div>';
  try{ await _sstCargarItems(); renderSstInventario(); }
  catch(e){ l.innerHTML=`<div style="color:#B91C1C;padding:20px;font-size:13px;">${esc(e.message)}</div>`; }
}
function _sstFiltrados(){
  const q=(document.getElementById('sstBuscar')?.value||'').toLowerCase().trim();
  const cat=document.getElementById('sstFiltroCat')?.value||'';
  const est=document.getElementById('sstFiltroEst')?.value||'';
  return _sstItems.filter(i=>{
    if(cat && i.categoria!==cat) return false;
    if(est==='baja' ? i.estado!=='baja' : (i.estado==='baja' && est!=='todos')) return false;
    if(est==='disponible' && !(i.estado==='disponible' && i.disponible>0)) return false;
    if(est==='mantenimiento' && i.estado!=='mantenimiento') return false;
    if(est==='entregado' && !(i.en_uso>0)) return false;
    if(est==='alertas' && !i.alerta) return false;
    if(q && !`${i.nombre} ${i.codigo} ${i.serial||''} ${i.marca||''} ${SST_CATS[i.categoria]?.[1]||''}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
let _sstAbiertos={}, _sstGrpKeys=[];
function sstToggleGrupo(n){ const k=_sstGrpKeys[n]; _sstAbiertos[k]=!_sstAbiertos[k]; renderSstInventario(); }
function _sstClaveGrupo(i){ return [i.nombre,i.categoria,i.marca||''].map(x=>String(x).toLowerCase().trim()).join('|'); }
function _sstFilaItem(i,sub){
  const baja=i.estado==='baja', mant=i.estado==='mantenimiento';
  const b=(txt,fn,extra='')=>`<button class="btn btn-ghost" style="font-size:11px;padding:4px 9px;${extra}" onclick="${fn}">${txt}</button>`;
  let acc='';
  if(!baja){
    if(i.estado==='disponible' && i.disponible>0) acc+=b('👤 Entregar',`sstAbrirEntregar(${i.id})`);
    acc+=b('🔍 Inspeccionar',`sstAbrirInspeccion(${i.id})`);
    acc+=b('✏️',`sstAbrirItem(${i.id})`);
    if(mant) acc+=b('♻️ Reactivar',`sstCambiarEstado(${i.id},'disponible')`);
    else acc+=b('🛠️ Mantenimiento',`sstAbrirEstado(${i.id},'mantenimiento')`);
    acc+=b('⚫ Baja',`sstAbrirEstado(${i.id},'baja')`,'color:#B91C1C;');
    if(!i.en_uso) acc+=b('🗑️',`sstEliminar([${i.id}],'${esc(i.serial||i.codigo).replace(/'/g,'')}')`,'color:#B91C1C;');
  }
  acc+=b('📜',`sstAbrirHistorial(${i.id})`);
  const ident = sub && i.serial ? `<div style="font-weight:700;font-family:monospace;">${esc(i.serial)}</div><div style="font-size:11px;color:#94A3B8;">${esc(i.codigo)}</div>`
    : `<div style="font-weight:600;">${esc(i.nombre)}</div>
        <div style="font-size:11px;color:#94A3B8;">${esc(i.codigo)} · ${_sstCat(i.categoria)}${i.marca?' · '+esc(i.marca):''}${i.serial?' · S/N '+esc(i.serial):''}</div>`;
  return `<tr style="border-top:1px solid #F1F5F9;${baja?'opacity:.6;':''}${sub?'background:#FAFAFF;':''}">
    <td style="padding:10px;${sub?'padding-left:34px;':''}">${ident}
      ${sstDatosTxt(i)?`<div style="font-size:11px;color:#64748B;">${esc(sstDatosTxt(i))}</div>`:''}
      ${i.motivo_baja&&(baja||mant)?`<div style="font-size:11px;color:#92400E;">${esc(i.motivo_baja)}</div>`:''}</td>
    <td style="padding:10px;white-space:nowrap;">${i.cantidad>1||i.en_uso?`<b>${i.disponible}</b> / ${i.cantidad}`:i.cantidad}${i.en_uso?`<div style="font-size:11px;color:#5B21B6;">${i.en_uso} entregad${i.en_uso===1?'o':'os'}</div>`:''}</td>
    <td style="padding:10px;">${_sstBadgeEstado(i)} ${_sstBadgeAlerta(i.alerta)}</td>
    <td style="padding:10px;white-space:nowrap;">${_sstFechaCorta(i.fecha_fabricacion)}</td>
    <td style="padding:10px;white-space:nowrap;">${_sstFechaCorta(i.fecha_inspeccion||i.ultima_inspeccion)}</td>
    <td style="padding:10px;white-space:nowrap;">${_sstFechaCorta(i.prox_inspeccion)}</td>
    <td style="padding:10px;text-align:right;"><div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">${acc}</div></td></tr>`;
}
function renderSstInventario(){
  const l=document.getElementById('sstInvLista'); if(!l) return;
  const rows=_sstFiltrados();
  const c=document.getElementById('sstInvContador'); if(c) c.textContent=`${rows.length} unidad${rows.length===1?'':'es'} / artículo${rows.length===1?'':'s'}`;
  if(!rows.length){ l.innerHTML='<div style="text-align:center;color:#94A3B8;padding:36px;font-size:13px;">No hay artículos con esos filtros. Usa "+ Nuevo artículo" para registrar el primero.</div>'; return; }
  // Agrupar unidades individuales del mismo tipo (ej: 25 "Casco blanco") en una sola fila desplegable
  const grupos=new Map(); _sstGrpKeys=[];
  rows.forEach(i=>{ const k=_sstClaveGrupo(i); if(!grupos.has(k)) grupos.set(k,[]); grupos.get(k).push(i); });
  const q=(document.getElementById('sstBuscar')?.value||'').trim();
  let html=`<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr style="text-align:left;color:#94A3B8;font-size:11px;text-transform:uppercase;">
      <th style="padding:8px 10px;">Artículo</th><th style="padding:8px 10px;">Cant.</th><th style="padding:8px 10px;">Estado</th>
      <th style="padding:8px 10px;">Fabricación</th><th style="padding:8px 10px;">Última inspección</th><th style="padding:8px 10px;">Próx. inspección</th><th style="padding:8px 10px;text-align:right;">Acciones</th></tr></thead><tbody>`;
  grupos.forEach((arr,k)=>{
    if(arr.length<2 || arr.some(i=>i.cantidad>1)){ html+=arr.map(i=>_sstFilaItem(i,false)).join(''); return; }
    const f=arr[0], disp=arr.filter(i=>i.estado==='disponible'&&i.disponible>0), uso=arr.reduce((a,i)=>a+(i.en_uso||0),0);
    const mant=arr.filter(i=>i.estado==='mantenimiento').length, baja=arr.filter(i=>i.estado==='baja').length;
    const alertas=arr.filter(i=>i.alerta).length;
    const abierto=!!_sstAbiertos[k] || !!q;
    const kk=_sstGrpKeys.push(k)-1;
    html+=`<tr style="border-top:1px solid #E2E8F0;background:#F8FAFC;cursor:pointer;" onclick="sstToggleGrupo(${kk})">
      <td style="padding:10px;"><div style="font-weight:700;">${abierto?'▾':'▸'} ${esc(f.nombre)} <span class="badge badge-gray" style="font-size:10px;">${arr.length} unidades</span></div>
        <div style="font-size:11px;color:#94A3B8;padding-left:14px;">${_sstCat(f.categoria)}${f.marca?' · '+esc(f.marca):''}</div></td>
      <td style="padding:10px;white-space:nowrap;"><b>${disp.length}</b> / ${arr.length}</td>
      <td style="padding:10px;font-size:12px;">${disp.length?`<span class="badge badge-ok">${disp.length} disponibles</span> `:''}${uso?`<span class="badge badge-brand">${uso} entregados</span> `:''}${mant?`<span class="badge badge-warn">${mant} mant.</span> `:''}${baja?`<span class="badge badge-gray">${baja} baja</span> `:''}${alertas?`<span class="badge badge-danger">${alertas} con alerta</span>`:''}</td>
      <td colspan="3" style="padding:10px;font-size:11px;color:#94A3B8;">Toca para ${abierto?'ocultar':'ver cada unidad'}</td>
      <td style="padding:10px;text-align:right;" onclick="event.stopPropagation()">${disp.length?`<button class="btn btn-ghost" style="font-size:11px;padding:4px 9px;" onclick="sstAbrirEntregarGrupo(${kk})">👤 Entregar</button> `:''}<button class="btn btn-ghost" style="font-size:11px;padding:4px 9px;color:#B91C1C;" onclick="sstAbrirEliminarGrupo(${kk})">🗑️ Eliminar…</button></td></tr>`;
    if(abierto) html+=arr.map(i=>_sstFilaItem(i,true)).join('');
  });
  l.innerHTML=html+'</tbody></table></div>';
}

// Eliminar (creado por error). Solo se puede si nunca se entregó; si ya tuvo entregas se usa "Baja".
function sstEliminar(ids,nombre){
  mostrarConfirmar({icono:'🗑️',color:'#DC2626',titulo:'Eliminar artículo',
    desc:'¿Eliminar '+(ids.length>1?ids.length+' unidades':'"'+nombre+'"')+'? Solo se puede si nunca se ha entregado. Esto no se puede deshacer.',
    btnTxt:'Sí, eliminar', btnColor:'#DC2626',
    onConfirmar:async()=>{ try{ const r=await _api('sst','eliminar',{ids}); toast('Eliminado'+(r.aviso?' · '+r.aviso:'')); await _sstRefrescar(); }catch(e){ toast(e.message||'Error','error'); } }});
}
function sstAbrirEliminarGrupo(n){
  const k=_sstGrpKeys[n]; const arr=_sstItems.filter(i=>_sstClaveGrupo(i)===k && i.estado!=='baja' && !i.en_uso);
  if(!arr.length){ toast('Todas las unidades están entregadas o dadas de baja: usa Baja o devuélvelas primero','error'); return; }
  const chips=arr.map(i=>`<label style="display:inline-flex;gap:5px;align-items:center;border:1px solid #E2E8F0;border-radius:8px;padding:4px 8px;font-size:12px;cursor:pointer;background:#fff;"><input type="checkbox" class="sstDelChk" value="${i.id}"> <span style="font-family:monospace;font-weight:600;">${esc(i.serial||i.codigo)}</span></label>`).join(' ');
  _sstModal(_sstTitulo('🗑️','#FEE2E2','Eliminar '+esc(arr[0].nombre),'Marca las unidades creadas por error')+`
    <div style="max-height:34vh;overflow:auto;display:flex;flex-wrap:wrap;gap:6px;">${chips}</div>
    <div style="font-size:11px;margin-top:6px;"><a href="#" onclick="document.querySelectorAll('.sstDelChk').forEach(c=>c.checked=true);return false;">Marcar todas</a></div>
    <div style="font-size:12px;color:#92400E;margin-top:8px;">Solo se eliminan las que nunca se han entregado. Si ya tuvieron entregas, usa "Baja" en cada una.</div>`+
    _sstBotones('Eliminar marcadas','sstConfirmarEliminarGrupo()'),560);
}
function sstConfirmarEliminarGrupo(){
  const ids=[...document.querySelectorAll('.sstDelChk:checked')].map(c=>parseInt(c.value));
  if(!ids.length){toast('Marca al menos una unidad','error');return;}
  _sstEnviar('eliminar',{ids},'Eliminado',_sstRefrescar);
}
// Entregar desde un grupo: se escogen una o varias unidades por su identificador
async function sstAbrirEntregarGrupo(n){
  const k=_sstGrpKeys[n];
  const arr=_sstItems.filter(i=>_sstClaveGrupo(i)===k && i.estado==='disponible' && i.disponible>0);
  if(!arr.length) return;
  const per=await _sstCargarPersonas();
  const dl=per.map(p=>`<option value="${esc((p.nombre||p.usuario)+' ('+p.usuario+')')}"></option>`).join('');
  const chips=arr.map(i=>`<label style="display:inline-flex;gap:5px;align-items:center;border:1px solid #E2E8F0;border-radius:8px;padding:4px 8px;font-size:12px;cursor:pointer;background:#fff;"><input type="checkbox" class="sstGrpChk" value="${i.id}"> <span style="font-family:monospace;font-weight:600;">${esc(i.serial||i.codigo)}</span></label>`).join(' ');
  _sstModal(_sstTitulo('👤','#EDE9FE','Entregar '+esc(arr[0].nombre),arr.length+' disponibles · marca las unidades que entregas')+`
    <div style="max-height:30vh;overflow:auto;display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">${chips}</div>
    <div style="font-size:11px;color:#64748B;margin-bottom:8px;"><a href="#" onclick="document.querySelectorAll('.sstGrpChk').forEach(c=>c.checked=true);return false;">Marcar todas</a></div>
    <label class="lbl">Persona que recibe *</label>
    <input id="sstPersona" class="inp" list="sstPersonasDl" placeholder="Escribe para buscar…" autocomplete="off">
    <datalist id="sstPersonasDl">${dl}</datalist>
    <div style="margin-top:10px;"><label class="lbl">Nota</label><input id="sstEntNota" class="inp" placeholder="Opcional"></div>
    <div style="font-size:12px;color:#94A3B8;margin-top:8px;">La persona debe confirmar que recibió cada unidad.</div>`+
    _sstBotones('Entregar','sstConfirmarEntregaGrupo()'),560);
}
async function sstConfirmarEntregaGrupo(){
  const ids=[...document.querySelectorAll('.sstGrpChk:checked')].map(c=>parseInt(c.value));
  if(!ids.length){toast('Marca al menos una unidad','error');return;}
  const txt=document.getElementById('sstPersona').value.trim();
  const m=txt.match(/\(([^()]+)\)\s*$/); const usr=m?m[1]:txt;
  const p=_sstPersonas.find(x=>x.usuario===usr);
  if(!p){toast('Elige a la persona de la lista','error');return;}
  const nota=document.getElementById('sstEntNota').value;
  const b=document.getElementById('sstBtnOk'); if(b) b.disabled=true;
  let ok=0, err='';
  for(const id of ids){
    try{ await _api('sst','entregar',{item_id:id,usuario:p.usuario,cantidad:1,nota}); ok++; }
    catch(e){ err=e.message||'Error'; break; }
  }
  cerrarModal('modalSst');
  toast(ok+' unidad'+(ok===1?'':'es')+' entregada'+(ok===1?'':'s')+' a '+(p.nombre||p.usuario)+(err?' · se detuvo: '+err:''), err?'error':undefined);
  await _sstRefrescar();
}

/* ───────── Modal genérico ───────── */
function _sstModal(html,ancho=560){
  const box=document.getElementById('modalSstBox'); if(!box) return;
  box.style.maxWidth=ancho+'px'; box.style.maxHeight='92vh'; box.style.overflowY='auto';
  box.innerHTML=`<button onclick="cerrarModal('modalSst')" style="position:absolute;top:16px;right:16px;width:30px;height:30px;border-radius:50%;background:#F1F5F9;border:none;cursor:pointer;font-size:16px;color:#64748B;">✕</button>`+html;
  document.getElementById('modalSst').classList.add('open');
}
function _sstTitulo(ico,bg,t,sub=''){
  return `<div style="text-align:center;margin-bottom:16px;"><div style="width:44px;height:44px;background:${bg};border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 10px;font-size:22px;">${ico}</div>
    <h3 style="font-family:Syne,sans-serif;font-weight:700;font-size:18px;margin:0;">${t}</h3>${sub?`<div style="font-size:12px;color:#94A3B8;margin-top:4px;">${sub}</div>`:''}</div>`;
}
function _sstBotones(txt,fn){
  return `<div style="display:flex;gap:10px;margin-top:18px;"><button class="btn btn-ghost" style="flex:1;" onclick="cerrarModal('modalSst')">Cancelar</button>
    <button class="btn btn-primary" style="flex:1;" id="sstBtnOk" onclick="${fn}">${txt}</button></div>`;
}
async function _sstEnviar(accion,body,okMsg,despues){
  const b=document.getElementById('sstBtnOk'); if(b){b.disabled=true;}
  try{
    const r=await _api('sst',accion,body);
    cerrarModal('modalSst');
    toast(okMsg+(r.aviso?' · '+r.aviso:''));
    if(despues) await despues();
  }catch(e){ toast(e.message||'Error','error'); if(b) b.disabled=false; }
}
function _sstRefrescar(){
  actualizarBadgeSst();
  if(_sstTab==='resumen') return cargarSstResumen();
  if(_sstTab==='inventario') return cargarSstInventario();
  if(_sstTab==='entregas') return cargarSstEntregas();
}

/* ───────── Crear / editar ───────── */
function sstAbrirItem(id){
  const it=id?_sstItems.find(x=>x.id===id):null;
  const v=(k)=>esc(it?.[k]??'');
  const f=(k)=>it?.[k]?String(it[k]).slice(0,10):'';
  const opts=Object.entries(SST_CATS).map(([k,[ico,n]])=>`<option value="${esc(k)}" ${it?.categoria===k?'selected':''}>${esc(ico)} ${esc(n)}</option>`).join('');
  _sstModal(_sstTitulo('🦺','#E8F8E8',it?'Editar artículo':'Nuevo artículo SST',it?esc(it.codigo):'El código se genera solo')+`
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px 12px;">
      <div><label class="lbl">Nombre *</label><input id="sstNombre" class="inp" list="sstNombresDl" autocomplete="off" value="${v('nombre')}" placeholder="Ej: Casco blanco" ${it?'':'onchange="sstNombreExistente()"'}>
        <datalist id="sstNombresDl">${[...new Set(_sstItems.map(x=>x.nombre))].map(n=>`<option value="${esc(n)}"></option>`).join('')}</datalist></div>
      <div><label class="lbl">Categoría *</label><div style="display:flex;gap:6px;"><select id="sstCat" class="inp" style="flex:1;min-width:0;" onchange="sstRenderExtra({})">${opts||'<option value="">— Primero crea una categoría —</option>'}</select>
        <button type="button" class="btn btn-ghost" style="padding:0 10px;font-size:12px;white-space:nowrap;" title="Crear o borrar categorías" onclick="sstAbrirCategorias(${id||0})">⚙️ Categorías</button></div></div>
      <div><label class="lbl">Marca</label><input id="sstMarca" class="inp" value="${v('marca')}" placeholder="Opcional"></div>
      <div id="sstSerialCell"><label class="lbl" id="sstSerialLbl">Serial (si es único)</label><input id="sstSerial" class="inp" value="${v('serial')}" placeholder="Opcional" oninput="sstSerialCant()">
        ${it?'':`<textarea id="sstSeriales" class="inp" rows="3" style="display:none;width:100%;resize:vertical;font-family:monospace;font-size:12px;line-height:1.5;" oninput="sstIndivToggle()" placeholder="Un SN por línea (puedes pegar desde Excel)"></textarea>`}</div>
      <div><label class="lbl">Cantidad *</label><input id="sstCant" type="number" min="1" class="inp" value="${it?it.cantidad:1}" oninput="sstIndivToggle()"></div>
      <div><label class="lbl">Fecha de fabricación</label><input id="sstFab" type="date" class="inp" value="${f('fecha_fabricacion')}"></div>
      <div><label class="lbl">Fecha de inspección (última)</label><input id="sstInsp" type="date" class="inp" value="${f('fecha_inspeccion')}" onchange="sstProxPreview()"></div>
      <div><label class="lbl">Inspección cada (días)</label><input id="sstPer" type="number" min="0" class="inp" value="${it?.periodicidad_dias||''}" placeholder="Ej: 90" oninput="sstProxPreview()"><div id="sstProxTxt" style="font-size:11px;color:#64748B;margin-top:3px;"></div></div>
      <div><label class="lbl">Descripción</label><input id="sstDesc" class="inp" value="${v('descripcion')}" placeholder="Opcional"></div>
      ${it?'':`<div id="sstIndivBox" style="grid-column:1/-1;display:none;background:#F5F3FF;border:1px solid #DDD6FE;border-radius:10px;padding:8px 12px;">
        <label style="display:flex;gap:8px;align-items:center;font-size:13px;font-weight:600;cursor:pointer;"><input type="checkbox" id="sstIndiv" checked onchange="sstIndivToggle()"> Cada unidad con su propio SN / identificador </label></div>`}
      <div id="sstExtra" style="display:none;"></div>
    </div>`+_sstBotones(it?'Guardar cambios':'Crear artículo',`sstGuardarItem(${id||0})`));
  let vals=it?.datos||{};
  if(_sstBorr){ _SST_CAMPOS.forEach(c=>{const el=document.getElementById(c); if(el&&_sstBorr[c]) el.value=_sstBorr[c];}); _sstBorr=null; vals=_sstBorrDatos||vals; _sstBorrDatos=null; }
  sstRenderExtra(vals);
  sstProxPreview();
}
function sstProxPreview(){
  const el=document.getElementById('sstProxTxt'); if(!el) return;
  const per=parseInt(document.getElementById('sstPer')?.value)||0, ins=document.getElementById('sstInsp')?.value;
  if(per<=0){ el.textContent='Sin inspección periódica: no genera alertas.'; return; }
  const base=ins?new Date(ins+'T00:00:00'):new Date(); base.setDate(base.getDate()+per);
  el.textContent='Próxima inspección: '+base.toLocaleDateString('es-CO')+(ins?'':' (desde hoy)');
}
function sstIndivToggle(){
  const box=document.getElementById('sstIndivBox'); if(!box) return;
  const n=parseInt(document.getElementById('sstCant')?.value)||1;
  box.style.display=n>1?'':'none';
  const on=n>1 && document.getElementById('sstIndiv')?.checked;
  const inp=document.getElementById('sstSerial'), ta=document.getElementById('sstSeriales'), lb=document.getElementById('sstSerialLbl');
  const cell=document.getElementById('sstSerialCell');
  if(cell){ cell.style.gridColumn=on?'1/-1':''; cell.style.order=on?'90':''; }
  box.style.order='95';
  if(inp) inp.style.display=on?'none':'';
  if(ta) ta.style.display=on?'':'none';
  if(lb){ if(on){ const k=(ta?.value||'').split(/[\s,;]+/).filter(x=>x.trim()).length; lb.innerHTML='Serial de cada unidad (uno por línea) — <b style="color:'+(k===n?'#16A34A':'#B45309')+'">'+k+' de '+n+'</b>'; } else lb.textContent='Serial (si es único)'; }
}
// Al escribir un nombre que ya existe: se rellenan categoría, marca, etc. para sumar más unidades del mismo tipo
function sstNombreExistente(){
  const n=(document.getElementById('sstNombre')?.value||'').trim().toLowerCase();
  const x=_sstItems.find(i=>(i.nombre||'').toLowerCase()===n); if(!x) return;
  const set=(id,val)=>{const el=document.getElementById(id); if(el&&val!=null&&val!=='') el.value=String(val);};
  const cat=document.getElementById('sstCat'); if(cat) cat.value=x.categoria;
  sstRenderExtra(x.datos||{});
  set('sstMarca',x.marca); set('sstDesc',x.descripcion); set('sstPer',x.periodicidad_dias);
  sstProxPreview();
  toast('Ya existe "'+x.nombre+'": se copiaron sus datos. Escribe la cantidad y los identificadores nuevos.');
}
function sstSerialCant(){
  const s=document.getElementById('sstSerial')?.value.trim(), c=document.getElementById('sstCant');
  if(s&&c) c.value=1;
}
function sstGuardarItem(id){
  const g=i=>document.getElementById(i).value;
  const body={id,nombre:g('sstNombre').trim(),categoria:g('sstCat'),marca:g('sstMarca'),serial:g('sstSerial'),cantidad:g('sstCant'),
    fecha_fabricacion:g('sstFab'),fecha_inspeccion:g('sstInsp'),periodicidad_dias:g('sstPer'),descripcion:g('sstDesc'),datos:sstLeerDatos()};
  if(!id && (parseInt(body.cantidad)||1)>1 && document.getElementById('sstIndiv')?.checked){ body.serial=''; body.individual=true; body.seriales=document.getElementById('sstSeriales')?.value||'';
    const k=body.seriales.split(/[\s,;]+/).filter(x=>x.trim()).length;
    if(k!==(parseInt(body.cantidad)||1)){ toast('Escribe un identificador por cada unidad ('+k+' de '+body.cantidad+')','error'); return; } }
  if(!body.nombre){toast('Escribe el nombre','error');return;}
  if(!body.categoria){toast('Primero crea una categoría con el botón ⚙️ Categorías','error');return;}
  _sstEnviar(id?'editar':'crear',body,id?'Artículo actualizado':'Artículo creado',_sstRefrescar);
}

/* ───────── Categorías propias ───────── */
let _sstBorr=null, _sstBorrDatos=null;
const _SST_CAMPOS=['sstNombre','sstCat','sstMarca','sstSerial','sstCant','sstFab','sstInsp','sstPer','sstDesc'];
let _sstFormCampos=[], _sstFormClave='';
const SST_TIPOS={texto:'Texto',numero:'Número',fecha:'Fecha',lista:'Lista de opciones'};

function sstAbrirCategorias(volverId){
  if(document.getElementById('sstNombre')){ _sstBorr={}; _SST_CAMPOS.forEach(c=>{_sstBorr[c]=document.getElementById(c)?.value;}); _sstBorrDatos=sstLeerDatos(); }
  _sstVolverId=volverId||0; sstListaCategorias();
}
let _sstVolverId=0;
function sstListaCategorias(){
  const volverId=_sstVolverId;
  const lista=Object.entries(SST_CATS).map(([k,[ico,n,u,cp]])=>`<div style="display:flex;align-items:center;gap:8px;border:1px solid #EEF2F6;border-radius:10px;padding:8px 10px;margin-bottom:6px;font-size:13px;">
    <span style="flex:1;min-width:0;">${esc(ico)} <b>${esc(n)}</b><div style="color:#94A3B8;font-size:11px;">${(cp||[]).length?esc((cp||[]).map(c=>c.nombre).join(' · ')):'sin campos propios'} — ${u?u+' artículo'+(u===1?'':'s'):'sin uso'}</div></span>
    <button class="btn btn-ghost" style="font-size:11px;padding:3px 9px;" onclick="sstFormCategoria('${esc(k)}')">✏️ Editar</button>
    <button class="btn btn-ghost" style="font-size:11px;padding:3px 9px;color:#B91C1C;" onclick="sstEliminarCategoria('${esc(k)}')">Borrar</button></div>`).join('')||'<div style="color:#94A3B8;font-size:13px;text-align:center;padding:14px;">Aún no tienes categorías. Crea la primera según lo que maneje tu empresa (Casco, Escalera, Eslinga…).</div>';
  _sstModal(_sstTitulo('🏷️','#EDE9FE','Categorías SST','Cada categoría tiene sus propios campos: la escalera lleva altura y tipo, el casco lleva talla…')+`
    <button class="btn btn-primary" style="width:100%;margin-bottom:12px;" onclick="sstFormCategoria('')">+ Nueva categoría</button>
    <div style="max-height:320px;overflow-y:auto;">${lista}</div>
    <div style="margin-top:14px;"><button class="btn btn-ghost" style="width:100%;" onclick="sstVolverItem(${volverId})">← Volver al artículo</button></div>`,540);
}
function sstVolverItem(id){ sstAbrirItem(id); }

function sstFormCategoria(clave){
  _sstFormClave=clave||'';
  const c=clave?SST_CATS[clave]:null;
  _sstFormCampos=c?JSON.parse(JSON.stringify(c[3]||[])).map(x=>({...x,opciones:(x.opciones||[]).join(', ')})):[];
  _sstDibujarFormCat(c?c[0]:'📦',c?c[1]:'');
}
function _sstDibujarFormCat(ico,nom){
  const filas=_sstFormCampos.map((c,i)=>`<div style="border:1px solid #EEF2F6;border-radius:10px;padding:8px;margin-bottom:6px;background:#FAFBFC;">
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
      <input class="inp sst-cf-nom" style="flex:2;min-width:120px;" placeholder="Nombre del campo (ej: Altura)" value="${esc(c.nombre||'')}">
      <select class="inp sst-cf-tipo" style="flex:1;min-width:110px;" onchange="sstCampoTipo()">${Object.entries(SST_TIPOS).map(([k,v])=>`<option value="${k}" ${c.tipo===k?'selected':''}>${v}</option>`).join('')}</select>
      <label style="font-size:11px;color:#64748B;display:flex;align-items:center;gap:4px;white-space:nowrap;"><input type="checkbox" class="sst-cf-obl" ${c.obligatorio?'checked':''}> Obligatorio</label>
      <button class="btn btn-ghost" style="font-size:12px;padding:2px 8px;color:#B91C1C;" onclick="sstQuitarCampo(${i})">✕</button></div>
    ${c.tipo==='lista'?`<input class="inp sst-cf-ops" style="margin-top:6px;" placeholder="Opciones separadas por coma (ej: Tijera, Extensión, Telescópica)" value="${esc(c.opciones||'')}">`:'<input type="hidden" class="sst-cf-ops" value="">'}</div>`).join('');
  _sstModal(_sstTitulo('🏷️','#EDE9FE',_sstFormClave?'Editar categoría':'Nueva categoría','Define qué datos se piden al registrar un artículo de esta categoría')+`
    <div style="display:flex;gap:8px;margin-bottom:12px;"><input id="sstCatIco" class="inp" style="width:64px;text-align:center;" maxlength="4" value="${esc(ico)}">
      <input id="sstCatNom" class="inp" style="flex:1;" placeholder="Nombre de la categoría (ej: Escalera)" value="${esc(nom)}"></div>
    <div style="font-weight:700;font-size:13px;margin-bottom:6px;">Campos propios <span style="font-weight:400;color:#94A3B8;font-size:12px;">(además de nombre, cantidad, fabricación e inspección)</span></div>
    <div id="sstCamposForm" style="max-height:280px;overflow-y:auto;">${filas||'<div style="color:#94A3B8;font-size:12px;padding:6px 0;">Sin campos propios todavía. Ejemplos: Tipo (lista), Altura (número), Material (texto), Talla (lista).</div>'}</div>
    <button class="btn btn-ghost" style="width:100%;margin-top:6px;font-size:12px;" onclick="sstAgregarCampo()">+ Agregar campo</button>
    <div style="display:flex;gap:10px;margin-top:16px;"><button class="btn btn-ghost" style="flex:1;" onclick="sstListaCategorias()">Cancelar</button>
      <button class="btn btn-primary" style="flex:1;" onclick="sstGuardarCategoria()">${_sstFormClave?'Guardar cambios':'Crear categoría'}</button></div>`,560);
}
function _sstSyncCampos(){
  const nom=[...document.querySelectorAll('.sst-cf-nom')], tipo=[...document.querySelectorAll('.sst-cf-tipo')],
        obl=[...document.querySelectorAll('.sst-cf-obl')], ops=[...document.querySelectorAll('.sst-cf-ops')];
  _sstFormCampos=nom.map((n,i)=>({nombre:n.value,tipo:tipo[i].value,obligatorio:obl[i].checked,opciones:ops[i].value}));
}
function _sstRedibujar(){ _sstSyncCampos(); _sstDibujarFormCat(document.getElementById('sstCatIco').value,document.getElementById('sstCatNom').value); }
function sstAgregarCampo(){ _sstSyncCampos(); _sstFormCampos.push({nombre:'',tipo:'texto',obligatorio:false,opciones:''}); _sstDibujarFormCat(document.getElementById('sstCatIco').value,document.getElementById('sstCatNom').value); }
function sstQuitarCampo(i){ _sstSyncCampos(); _sstFormCampos.splice(i,1); _sstDibujarFormCat(document.getElementById('sstCatIco').value,document.getElementById('sstCatNom').value); }
function sstCampoTipo(){ _sstRedibujar(); }
async function sstGuardarCategoria(){
  _sstSyncCampos();
  const nombre=document.getElementById('sstCatNom').value.trim(), icono=document.getElementById('sstCatIco').value.trim();
  if(!nombre){toast('Escribe el nombre de la categoría','error');return;}
  const campos=_sstFormCampos.filter(c=>c.nombre.trim()).map(c=>({nombre:c.nombre.trim(),tipo:c.tipo,obligatorio:c.obligatorio,opciones:c.tipo==='lista'?c.opciones:''}));
  try{
    if(_sstFormClave) await _api('sst','editar_categoria',{clave:_sstFormClave,nombre,icono,campos});
    else await _api('sst','crear_categoria',{nombre,icono,campos});
    await _sstCargarCats(); toast(_sstFormClave?'Categoría actualizada':'Categoría creada'); sstListaCategorias();
  }catch(e){ toast(e.message,'error'); }
}
async function sstEliminarCategoria(clave){
  const c=SST_CATS[clave]; const nom=c?c[1]:clave;
  try{ await _sstCargarItems(); }catch(e){}
  const lista=_sstItems.filter(i=>i.categoria===clave);
  if(lista.length>0){
    const cnt={}; lista.forEach(i=>{ const e=i.estado==='baja'?'de baja':i.estado==='mantenimiento'?'en mantenimiento':i.en_uso?'entregado(s)':'disponible(s)'; cnt[e]=(cnt[e]||0)+1; });
    const det=Object.entries(cnt).map(([k,v])=>v+' '+k).join(', ');
    mostrarConfirmar({icono:'⚠️',color:'#D97706',titulo:'No se puede borrar "'+nom+'"',
      desc:'Tiene '+lista.length+' artículo'+(lista.length===1?'':'s')+' ('+det+'). Una categoría con artículos no se borra. Toca "Ver esos artículos" para revisarlos: elimínalos o cámbialos de categoría si corresponde.',
      btnTxt:'Ver esos artículos',btnColor:'#D97706',
      onConfirmar:()=>{ cerrarModal('modalSst'); setTabSST('inventario'); setTimeout(()=>{ const c=document.getElementById('sstFiltroCat'); if(c) c.value=clave; const e=document.getElementById('sstFiltroEst'); if(e) e.value='todos'; const b=document.getElementById('sstBuscar'); if(b) b.value=''; renderSstInventario(); },400); }});
    return;
  }
  mostrarConfirmar({icono:'🗑️',color:'#DC2626',titulo:'Borrar la categoría "'+nom+'"',
    desc:'No tiene artículos. Se borra la categoría y sus campos personalizados. Esto no se puede deshacer.',
    btnTxt:'Sí, borrar',btnColor:'#DC2626',
    onConfirmar:async()=>{
      try{ await _api('sst','eliminar_categoria',{clave}); await _sstCargarCats(); toast('Categoría "'+nom+'" borrada'); sstListaCategorias(); }
      catch(e){ toast(e.message,'error'); }
    }});
}
/* Campos propios dentro del formulario del artículo */
function sstRenderExtra(valores){
  const box=document.getElementById('sstExtra'); if(!box) return;
  const cat=SST_CATS[document.getElementById('sstCat')?.value];
  const campos=cat?(cat[3]||[]):[];
  valores=valores||sstLeerDatos();
  box.innerHTML=campos.map(c=>{
    const val=valores[c.clave]??'';
    const lbl=`<label class="lbl">${esc(c.nombre)}${c.obligatorio?' *':''}</label>`;
    let inp;
    if(c.tipo==='lista') inp=`<select class="inp sst-extra" data-k="${esc(c.clave)}"><option value="">— Elegir —</option>${(c.opciones||[]).map(o=>`<option value="${esc(o)}" ${o===val?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
    else inp=`<input class="inp sst-extra" data-k="${esc(c.clave)}" type="${c.tipo==='numero'?'text':c.tipo==='fecha'?'date':'text'}" ${c.tipo==='numero'?'inputmode="decimal"':''} value="${esc(val)}">`;
    return `<div>${lbl}${inp}</div>`;
  }).join('');
  box.style.display=campos.length?'contents':'none';
}
function sstLeerDatos(){
  const o={}; document.querySelectorAll('.sst-extra').forEach(el=>{o[el.dataset.k]=el.value;}); return o;
}
function sstDatosTxt(i){
  const campos=SST_CATS[i.categoria]?.[3]||[]; const d=i.datos||{};
  return campos.filter(c=>d[c.clave]!==undefined&&d[c.clave]!=='').map(c=>`${c.nombre}: ${c.tipo==='fecha'?_sstFechaCorta(d[c.clave]):d[c.clave]}`).join(' · ');
}

/* ───────── Mantenimiento / baja / reactivar ───────── */
function sstAbrirEstado(id,estado){
  const it=_sstItems.find(x=>x.id===id); if(!it) return;
  const baja=estado==='baja';
  _sstModal(_sstTitulo(baja?'⚫':'🛠️',baja?'#F1F5F9':'#FAEEDA',baja?'Dar de baja':'Enviar a mantenimiento',esc(it.nombre)+' · '+esc(it.codigo))+`
    <label class="lbl">Motivo *</label><textarea id="sstMotivo" class="inp" rows="2" placeholder="${baja?'Ej: Cumplió vida útil, golpeado, perdido…':'Ej: Reparar correa, cambio de suspensión…'}"></textarea>
    ${baja?'<div style="font-size:12px;color:#B91C1C;margin-top:8px;">La baja saca el artículo de uso. No se puede entregar de nuevo.</div>':''}`+
    _sstBotones(baja?'Dar de baja':'Enviar a mantenimiento',`sstCambiarEstado(${id},'${estado}',true)`),480);
}
function sstCambiarEstado(id,estado,conMotivo){
  const motivo=conMotivo?document.getElementById('sstMotivo').value.trim():'';
  if(conMotivo&&!motivo){toast('Escribe el motivo','error');return;}
  const ok={disponible:'Artículo reactivado',mantenimiento:'Enviado a mantenimiento',baja:'Dado de baja'}[estado];
  if(!conMotivo){ _api('sst','estado',{id,estado,motivo}).then(()=>{toast(ok);_sstRefrescar();}).catch(e=>toast(e.message,'error')); return; }
  _sstEnviar('estado',{id,estado,motivo},ok,_sstRefrescar);
}

/* ───────── Entregar ───────── */
async function _sstCargarPersonas(){
  if(_sstPersonas.length) return _sstPersonas;
  try{ _sstPersonas=await _api('sst','personas'); }catch(e){ _sstPersonas=[]; }
  return _sstPersonas;
}
async function sstAbrirEntregar(id){
  const it=_sstItems.find(x=>x.id===id); if(!it) return;
  const per=await _sstCargarPersonas();
  const dl=per.map(p=>`<option value="${esc((p.nombre||p.usuario)+' ('+p.usuario+')')}"></option>`).join('');
  _sstModal(_sstTitulo('👤','#EDE9FE','Entregar a una persona',esc(it.nombre)+' · '+esc(it.codigo)+' · disponibles: '+it.disponible)+`
    <label class="lbl">Persona que recibe *</label>
    <input id="sstPersona" class="inp" list="sstPersonasDl" placeholder="Escribe para buscar…" autocomplete="off">
    <datalist id="sstPersonasDl">${dl}</datalist>
    <div style="margin-top:10px;"><label class="lbl">Cantidad</label><input id="sstEntCant" type="number" min="1" max="${it.disponible}" value="1" class="inp" ${it.cantidad===1?'disabled':''}></div>
    <div style="margin-top:10px;"><label class="lbl">Nota</label><input id="sstEntNota" class="inp" placeholder="Opcional"></div>
    <div style="font-size:12px;color:#94A3B8;margin-top:8px;">La persona verá el artículo en "Mis equipos" y debe confirmar que lo recibió.</div>`+
    _sstBotones('Entregar',`sstConfirmarEntrega(${id})`),480);
}
function sstConfirmarEntrega(id){
  const txt=document.getElementById('sstPersona').value.trim();
  const m=txt.match(/\(([^()]+)\)\s*$/);
  const usr=m?m[1]:txt;
  const p=_sstPersonas.find(x=>x.usuario===usr);
  if(!p){toast('Elige a la persona de la lista','error');return;}
  _sstEnviar('entregar',{item_id:id,usuario:p.usuario,cantidad:document.getElementById('sstEntCant').value,nota:document.getElementById('sstEntNota').value},
    'Entregado a '+(p.nombre||p.usuario),_sstRefrescar);
}

/* ───────── Entregas ───────── */
async function cargarSstEntregas(f){
  if(f) _sstEntFiltro=f;
  document.querySelectorAll('.sst-ent-f').forEach(b=>b.classList.toggle('active',b.dataset.f===_sstEntFiltro));
  const l=document.getElementById('sstEntLista'); if(!l) return;
  l.innerHTML='<div style="text-align:center;color:#94A3B8;padding:30px;font-size:13px;">Cargando…</div>';
  try{
    _sstEntregas=await _api('sst','entregas',null,'estado='+_sstEntFiltro);
    if(!_sstEntregas.length){ l.innerHTML='<div style="text-align:center;color:#94A3B8;padding:36px;font-size:13px;">No hay entregas en esta vista.</div>'; return; }
    l.innerHTML=`<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="text-align:left;color:#94A3B8;font-size:11px;text-transform:uppercase;">
      <th style="padding:8px 10px;">Artículo</th><th style="padding:8px 10px;">Persona</th><th style="padding:8px 10px;">Cant.</th><th style="padding:8px 10px;">Entregado</th><th style="padding:8px 10px;">Estado</th><th></th></tr></thead><tbody>`+
    _sstEntregas.map(e=>{
      const est=e.estado==='pendiente'?'<span class="badge badge-warn">⏱️ Sin confirmar</span>':e.estado==='activa'?'<span class="badge badge-ok">✅ En uso</span>'
        :`<span class="badge badge-gray">↩️ Devuelto${e.estado_devolucion&&e.estado_devolucion!=='bueno'?' ('+(e.estado_devolucion==='danado'?'dañado':'perdido')+')':''}</span>`;
      return `<tr style="border-top:1px solid #F1F5F9;"><td style="padding:10px;"><b>${esc(e.item_nombre)}</b><div style="font-size:11px;color:#94A3B8;">${esc(e.codigo)} · ${_sstCat(e.categoria)}</div></td>
        <td style="padding:10px;">${esc(e.receptor_nombre||nombreUsr(e.usuario))}</td><td style="padding:10px;">${e.cantidad}</td>
        <td style="padding:10px;white-space:nowrap;">${fmtDate(e.fecha_entrega)}<div style="font-size:11px;color:#94A3B8;">por ${escU(e.entregado_por)}</div></td>
        <td style="padding:10px;">${est}${e.estado!=='devuelta'&&_sstAlertaFecha(e.prox_inspeccion)?`<div style="margin-top:4px;">${_sstBadgeAlerta(_sstAlertaFecha(e.prox_inspeccion))}</div><div style="font-size:11px;color:#94A3B8;">${_sstFechaCorta(e.prox_inspeccion)} · pídele que lo entregue</div>`:''}</td>
        <td style="padding:10px;text-align:right;">${e.estado!=='devuelta'?`<button class="btn btn-ghost" style="font-size:11px;padding:4px 9px;" onclick="sstAbrirDevolver(${e.id})">↩️ Recibir devolución</button>`:''}</td></tr>`;
    }).join('')+'</tbody></table></div>';
  }catch(e){ l.innerHTML=`<div style="color:#B91C1C;padding:20px;font-size:13px;">${esc(e.message)}</div>`; }
}
function sstAbrirDevolver(id){
  const e=_sstEntregas.find(x=>x.id===id); if(!e) return;
  _sstModal(_sstTitulo('↩️','#E6F1FB','Recibir devolución',esc(e.item_nombre)+' · '+esc(e.receptor_nombre||e.usuario))+`
    <label class="lbl">¿En qué estado vuelve? *</label>
    <select id="sstDevEst" class="inp"><option value="bueno">✅ Buen estado</option><option value="danado">🛠️ Dañado (pasa a mantenimiento)</option><option value="perdido">❌ Perdido / no devuelve</option></select>
    <div style="margin-top:10px;"><label class="lbl">Nota</label><input id="sstDevNota" class="inp" placeholder="Opcional"></div>`+
    _sstBotones('Registrar devolución',`sstConfirmarDevolver(${id})`),460);
}
function sstConfirmarDevolver(id){
  _sstEnviar('devolver',{entrega_id:id,estado_devolucion:document.getElementById('sstDevEst').value,nota:document.getElementById('sstDevNota').value},'Devolución registrada',_sstRefrescar);
}

/* ───────── Inspecciones ───────── */
function sstAbrirInspeccion(id){
  const it=_sstItems.find(x=>x.id===id)||(_sstResumen?.alertas||[]).find(x=>x.id===id); if(!it) return;
  const hoy=new Date().toISOString().slice(0,10);
  _sstModal(_sstTitulo('🔍','#E6F1FB','Registrar inspección',esc(it.nombre)+' · '+esc(it.codigo))+`
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px 12px;">
      <div><label class="lbl">Fecha</label><input id="sstInsFecha" type="date" class="inp" value="${hoy}"></div>
      <div><label class="lbl">Resultado *</label><select id="sstInsRes" class="inp"><option value="aprobado">✅ Aprobado</option><option value="observacion">⚠️ Con observación</option><option value="rechazado">⛔ Rechazado (pasa a mantenimiento)</option></select></div>
    </div>
    <div style="margin-top:10px;"><label class="lbl">Observaciones</label><textarea id="sstInsNotas" class="inp" rows="2" placeholder="Obligatorio si hay observación o rechazo"></textarea></div>`+
    _sstBotones('Guardar inspección',`sstGuardarInspeccion(${id})`));
}
function sstGuardarInspeccion(id){
  _sstEnviar('inspeccionar',{item_id:id,fecha:document.getElementById('sstInsFecha').value,resultado:document.getElementById('sstInsRes').value,
    notas:document.getElementById('sstInsNotas').value},'Inspección registrada',_sstRefrescar);
}
async function sstAbrirHistorial(id){
  const it=_sstItems.find(x=>x.id===id); if(!it) return;
  _sstModal(_sstTitulo('📜','#F1F5F9','Historial',esc(it.nombre)+' · '+esc(it.codigo))+'<div id="sstHistBody" style="text-align:center;color:#94A3B8;font-size:13px;">Cargando…</div>',620);
  try{
    const r=await _api('sst','inspecciones',null,'item_id='+id);
    const resI={aprobado:'✅ Aprobado',observacion:'⚠️ Observación',rechazado:'⛔ Rechazado'};
    let h='<div style="font-weight:700;font-size:13px;margin-bottom:6px;">🔍 Inspecciones</div>';
    h+=r.inspecciones.length?r.inspecciones.map(n=>`<div style="border:1px solid #EEF2F6;border-radius:10px;padding:8px 12px;margin-bottom:6px;font-size:12px;text-align:left;"><b>${_sstFechaCorta(n.fecha)}</b> · ${resI[n.resultado]||n.resultado} · ${esc(n.inspector_nombre||nombreUsr(n.inspector))}${n.notas?`<div style="color:#64748B;">${esc(n.notas)}</div>`:''}</div>`).join(''):'<div style="font-size:12px;color:#94A3B8;text-align:left;margin-bottom:6px;">Sin inspecciones registradas.</div>';
    h+='<div style="font-weight:700;font-size:13px;margin:12px 0 6px;text-align:left;">👤 Entregas</div>';
    h+=r.entregas.length?r.entregas.map(e=>`<div style="border:1px solid #EEF2F6;border-radius:10px;padding:8px 12px;margin-bottom:6px;font-size:12px;text-align:left;"><b>${esc(e.receptor_nombre||nombreUsr(e.usuario))}</b> · x${e.cantidad} · ${fmtDate(e.fecha_entrega)} · ${e.estado==='devuelta'?'↩️ devuelto '+fmtDate(e.devuelta_en)+(e.estado_devolucion&&e.estado_devolucion!=='bueno'?' ('+(e.estado_devolucion==='danado'?'dañado':'perdido')+')':''):e.estado==='activa'?'✅ en uso':'⏱️ sin confirmar'}</div>`).join(''):'<div style="font-size:12px;color:#94A3B8;text-align:left;">Nunca se ha entregado.</div>';
    document.getElementById('sstHistBody').innerHTML=h;
  }catch(e){ document.getElementById('sstHistBody').textContent=e.message; }
}

/* ───────── Excel ───────── */
async function exportarSstExcel(){
  if(typeof XLSX==='undefined'){toast('No se cargó la librería de Excel','error');return;}
  try{
    await _sstCargarItems();
    const ent=await _api('sst','entregas',null,'estado=abiertas');
    const estTxt=i=>i.estado==='baja'?'De baja':i.estado==='mantenimiento'?'Mantenimiento':'Disponible';
    const inv=_sstItems.map(i=>({Código:i.codigo,Artículo:i.nombre,Categoría:SST_CATS[i.categoria]?.[1]||i.categoria,Datos:sstDatosTxt(i),Marca:i.marca||'',Serial:i.serial||'',
      Cantidad:i.cantidad,Disponibles:i.disponible,Entregados:i.en_uso,Estado:estTxt(i),Fabricación:_sstFechaCorta(i.fecha_fabricacion),
      'Última inspección':_sstFechaCorta(i.fecha_inspeccion||i.ultima_inspeccion),'Próxima inspección':_sstFechaCorta(i.prox_inspeccion),Motivo:i.motivo_baja||''}));
    const en=ent.map(e=>({Código:e.codigo,Artículo:e.item_nombre,Persona:e.receptor_nombre||e.usuario,Cantidad:e.cantidad,Entregado:fmtDate(e.fecha_entrega),
      'Entregado por':nombreUsr(e.entregado_por),Estado:e.estado==='pendiente'?'Sin confirmar':'En uso'}));
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(inv),'Inventario SST');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(en),'Entregas abiertas');
    XLSX.writeFile(wb,`SST_${new Date().toISOString().slice(0,10)}.xlsx`);
  }catch(e){toast(e.message||'No se pudo exportar','error');}
}

/* ───────── "Mi equipo SST" (lo que me entregaron) ───────── */
function _sstAvisoMis(e){
  const a=_sstAlertaFecha(e.prox_inspeccion); if(!a) return '';
  const venc=a==='inspeccion_vencida';
  return `<div style="font-size:12px;font-weight:600;color:${venc?'#B91C1C':'#92400E'};margin-top:3px;">${venc?'⛔ Inspección vencida':'🔍 Inspección próxima'} (${_sstFechaCorta(e.prox_inspeccion)}) — entrégalo al responsable de SST para revisarlo</div>`;
}
function _sstDatosMis(e){
  try{
    const campos=JSON.parse(e.cat_campos||'[]'), d=JSON.parse(e.datos||'{}');
    return campos.filter(c=>d[c.clave]).map(c=>`${c.nombre}: ${c.tipo==='fecha'?_sstFechaCorta(d[c.clave]):d[c.clave]}`).join(' · ');
  }catch(x){return '';}
}
async function sstRenderMio(contId){
  const c=document.getElementById(contId); if(!c) return;
  c.innerHTML='<div style="text-align:center;color:#94A3B8;padding:26px;font-size:13px;">Cargando…</div>';
  try{
    const rows=await _api('sst','mis_sst');
    if(!rows.length){ c.innerHTML='<div style="text-align:center;color:#94A3B8;padding:30px;font-size:13px;">🦺 No tienes elementos de seguridad entregados.</div>'; return; }
    c.innerHTML=rows.map(e=>{
      const pend=e.estado==='pendiente';
      return `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid ${pend?'#FDE68A':'#EEF2F6'};background:${pend?'#FFFBEB':'#fff'};border-radius:12px;padding:12px 14px;margin-bottom:8px;">
        <div style="font-size:24px;">${esc(e.cat_icono||'📦')}</div>
        <div style="flex:1;min-width:170px;"><div style="font-weight:600;font-size:13px;">${esc(e.nombre)} ${e.cantidad>1?`<span style="color:#64748B;">x${e.cantidad}</span>`:''}</div>
          <div style="font-size:12px;color:#94A3B8;">${esc(e.codigo)}${e.serial?' · S/N '+esc(e.serial):''} · entregado ${fmtDate(e.fecha_entrega)} por ${esc(e.entregado_por_nombre||nombreUsr(e.entregado_por))}</div>
          ${_sstAvisoMis(e)}
          ${_sstDatosMis(e)?`<div style="font-size:12px;color:#64748B;">${esc(_sstDatosMis(e))}</div>`:''}
          ${e.fecha_fabricacion?`<div style="font-size:12px;color:#64748B;">Fabricado: ${_sstFechaCorta(e.fecha_fabricacion)}</div>`:''}</div>
        ${pend?`<button class="btn btn-primary" style="font-size:12px;padding:7px 14px;" onclick="sstConfirmarRecibido(${e.id},'${contId}')">✅ Confirmar que lo recibí</button>`:'<span class="badge badge-ok">✅ Recibido</span>'}
      </div>`;}).join('');
  }catch(e){ c.innerHTML=`<div style="color:#B91C1C;padding:20px;font-size:13px;">${esc(e.message)}</div>`; }
}
async function sstConfirmarRecibido(id,contId){
  try{ await _api('sst','confirmar_recibido',{entrega_id:id}); toast('¡Listo! Confirmaste que lo recibiste'); sstRenderMio(contId); actualizarBadgeMisSst(); }
  catch(e){ toast(e.message,'error'); }
}
async function actualizarBadgeMisSst(){
  try{
    const rows=await _api('sst','mis_sst');
    const n=rows.filter(r=>r.estado==='pendiente').length;
    const b=document.getElementById('tabME_sst_n'); if(b){b.textContent=n;b.style.display=n?'inline-flex':'none';}
  }catch(e){}
}