/* ════════════════════════════════════════════════
   ENVÍO DIRECTO / SOLICITUD
════════════════════════════════════════════════ */
/* ── Ingreso de mercancía (llegó stock nuevo, se suma al existente) ── */
let _ingresoRefActual = null;
// Estado de un pedido múltiple tal como se muestra en las listas. Si el pedido
// figura aprobado pero TODOS sus productos fueron rechazados/cancelados, se
// muestra Rechazado (así no aparece en el filtro Aprobados).
function _estadoPedAgrupBase(p){
  const items = p.items||[];
  if((p.estado==='aprobado'||p.estado==='parcial') && items.length && items.every(i=>i.estado==='rechazada')) return 'rechazada';
  return p.estado==='aprobado'?'aprobada':p.estado==='rechazado'?'rechazada':p.estado==='parcial'?'aprobada':p.estado;
}

function abrirIngresoStock(){
  _ingresoRefActual = null;
  _ingresoEsFibra = null;
  _ingresoModoFibra = 'metros';
  if(!_fibraCats || !_fibraCats.length) cargarCategoriasFibra().catch(()=>{});
  const fibraModoWrap = document.getElementById('ingresoFibraModoWrap'); if(fibraModoWrap) fibraModoWrap.style.display='none';
  const fibraNombreWrap = document.getElementById('ingresoFibraNombreWrap'); if(fibraNombreWrap) fibraNombreWrap.style.display='none';
  const fibraNombre = document.getElementById('ingresoFibraNombre'); if(fibraNombre) fibraNombre.value='';
  const cantLabel = document.getElementById('ingresoCantidadLabel'); if(cantLabel) cantLabel.textContent='¿Cuántas llegaron?';
  const buscar = document.getElementById('ingresoProdBuscar'); if(buscar) buscar.value='';
  const ref = document.getElementById('ingresoRef'); if(ref) ref.value='';
  const info = document.getElementById('ingresoProdInfo'); if(info) info.style.display='none';
  const cInput = document.getElementById('ingresoCantidad'); if(cInput) cInput.value='';
  const vuInput = document.getElementById('ingresoValorUnitario'); if(vuInput) vuInput.value='';
  const ptInput = document.getElementById('ingresoPrecioTotal'); if(ptInput) ptInput.value='';
  const veInput = document.getElementById('ingresoValorEnvio'); if(veInput) veInput.value='';
  const provBuscar = document.getElementById('ingresoProveedorBuscar');
  if(provBuscar){ provBuscar.value=''; provBuscar.disabled=false; provBuscar.style.background=''; provBuscar.style.cursor=''; provBuscar.placeholder='Sin proveedor — escribe para buscar…'; }
  const provHidden = document.getElementById('ingresoProveedor'); if(provHidden) provHidden.value='';
  const nInput = document.getElementById('ingresoNota'); if(nInput) nInput.value='';
  const oInput = document.getElementById('ingresoObservaciones'); if(oInput) oInput.value='';
  const prev = document.getElementById('ingresoPreview'); if(prev) prev.style.display='none';
  document.getElementById('modalIngresoStock')?.classList.add('open');
  setTimeout(()=>buscar?.focus(),200);
}
function _filtrarProductoIngreso(){
  const q = (document.getElementById('ingresoProdBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('ingresoProdLista');
  if(!lista) return;
  const hl = (txt) => {
    txt = String(txt || '');
    if (!q || !txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if (idx < 0) return esc(txt);
    return esc(txt.slice(0, idx))
      + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx + q.length))}</mark>`
      + esc(txt.slice(idx + q.length));
  };
  const productos = getProductos().filter(p=>!q||p.nombre.toLowerCase().includes(q)||p.ref.toLowerCase().includes(q));
  // Fibra: se muestra como una opción más, simple por cantidad (sin pedir
  // nombre de carrete aquí — se guarda como carrete sin nombre / genérico).
  const fibraMatch = (_fibraCats||[]).filter(c=>!q||c.nombre.toLowerCase().includes(q)||'fibra'.includes(q));
  // ONT: no se puede ingresar solo por cantidad (cada una necesita su MAC/
  // Serial) — se muestra como acceso directo a la pantalla correcta.
  const ontMatch = (!q || 'ont'.includes(q) || 'ont'.startsWith(q)) ? [{_esAtajoOnt:true}] : [];
  const totalResultados = productos.length + fibraMatch.length + ontMatch.length;
  if(!totalResultados){
    lista.innerHTML = '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin resultados.</div>';
  } else {
    const filasProductos = productos.slice(0,30).map(p=>{
      // Productos por rollo: se muestra la cantidad de rollos, no los
      // metros totales — mismo criterio que en el resto del ingreso.
      const almacenTxt = p.metrosPorUnidad
        ? `${p.rollosCentral ? p.rollosCentral.length : valorMostrar(p,_stockCentral(p))} ${sufijoMostrar(p)}`
        : `${_stockCentral(p)} ${p.unidad==='metros'?'mts.':'uds.'}`;
      return `<div onclick="_seleccionarProductoIngreso('${p.ref}')" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
        <div class="!font-semibold">${hl(p.nombre)}</div>
        <div class="!text-[11px] !text-[#94A3B8]">Ref. ${hl(p.ref)} · Almacén: ${almacenTxt}</div>
        <div class="!text-[11px] !mt-[1px]">${p.proveedor?`<span class="!text-[#5B21B6]">🏭 ${hl(p.proveedor)}</span>`:'<span class="!text-[#CBD5E1] ![font-style:italic]">Sin proveedor</span>'}</div>
      </div>`;
    }).join('');
    const filasFibra = fibraMatch.map(c=>`
      <div onclick="_seleccionarFibraIngreso(${c.id},'${esc(c.nombre).replace(/'/g,"\\'")}')" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;background:#F0FBFF;" onmouseover="this.style.background='#E0F6FF'" onmouseout="this.style.background='#F0FBFF'">
        <div class="!font-semibold">🔵 Fibra — ${hl(c.nombre)}</div>
        <div class="!text-[11px] !text-[#94A3B8]">Disponible: ${c.metros_disponibles||0} mts.</div>
      </div>`).join('');
    const filaOnt = ontMatch.length ? `
      <div onclick="_irARegistrarOntDesdeIngreso()" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;background:#F5F3FF;" onmouseover="this.style.background='#EDE9FE'" onmouseout="this.style.background='#F5F3FF'">
        <div class="!font-semibold">📡 ONT — ir a Registrar ONT</div>
        <div class="!text-[11px] !text-[#94A3B8]">Cada ONT necesita su propio MAC/Serial, se registra en su pantalla</div>
      </div>` : '';
    lista.innerHTML = filasProductos + filasFibra + filaOnt;
  }
  lista.style.display='block';
}
let _ingresoEsFibra = null;
let _ingresoModoFibra = 'metros';
function _seleccionarFibraIngreso(catId, nombre){
  _ingresoEsFibra = catId;
  _ingresoModoFibra = 'metros';
  document.getElementById('ingresoProdBuscar').value = `🔵 Fibra — ${nombre}`;
  document.getElementById('ingresoProdLista').style.display='none';
  const infoBox = document.getElementById('ingresoProdInfo');
  if(infoBox) infoBox.style.display='block';
  const infoEl = document.getElementById('ingresoProdActual');
  if(infoEl) infoEl.parentElement.innerHTML = 'Elige si es un carrete completo o solo unos metros sueltos';
  const provBuscar = document.getElementById('ingresoProveedorBuscar');
  if(provBuscar){ provBuscar.value=''; provBuscar.disabled=false; provBuscar.style.background=''; provBuscar.style.cursor=''; provBuscar.placeholder='Proveedor (opcional)'; }
  document.getElementById('ingresoFibraModoWrap').style.display='flex';
  _elegirModoIngresoFibra('metros');
  _actualizarPreviewIngreso();
}
function _elegirModoIngresoFibra(modo){
  _ingresoModoFibra = modo;
  const btnMetros = document.getElementById('btnIngresoFibraMetros');
  const btnCompleto = document.getElementById('btnIngresoFibraCompleto');
  const nombreWrap = document.getElementById('ingresoFibraNombreWrap');
  const cantLabel = document.getElementById('ingresoCantidadLabel');
  if(modo==='completo'){
    btnMetros.style.background='#F1F5F9'; btnMetros.style.color='#475569';
    btnCompleto.style.background='#EDE9FE'; btnCompleto.style.color='#5B21B6';
    if(nombreWrap) nombreWrap.style.display='block';
    if(cantLabel) cantLabel.textContent = '¿Cuántos metros tiene el carrete?';
  } else {
    btnMetros.style.background='#EDE9FE'; btnMetros.style.color='#5B21B6';
    btnCompleto.style.background='#F1F5F9'; btnCompleto.style.color='#475569';
    if(nombreWrap) nombreWrap.style.display='none';
    if(cantLabel) cantLabel.textContent = '¿Cuántas llegaron?';
  }
}
function _calcularTotalRollos(){
  const p = getProductos().find(x=>x.ref===_ingresoRefActual);
  const rollos = parseInt(document.getElementById('ingresoRollosCantidad').value) || 0;
  const metrosCada = p?.metrosPorUnidad || 0;
  const total = rollos * metrosCada;
  const totalDiv = document.getElementById('ingresoRollosTotal');
  document.getElementById('ingresoCantidad').value = total || '';
  if(rollos && metrosCada){
    totalDiv.textContent = `= ${total.toLocaleString('es-CO')} metros en total`;
    totalDiv.style.display = 'block';
  } else {
    totalDiv.style.display = 'none';
  }
  _actualizarPreviewIngreso();
  _sincronizarPrecioIngreso(document.getElementById('ingresoValorUnitario').value?'unitario':'total');
}
function _irARegistrarOntDesdeIngreso(){
  cerrarModal('modalIngresoStock');
  goPanel('escaneo');
  toast('Cada ONT se registra aquí, con su MAC/Serial propio','warn');
}
function _seleccionarProductoIngreso(ref){
  const p = getProductos().find(x=>x.ref===ref);
  if(!p) return;
  _ingresoEsFibra = null;
  const fibraModoWrap = document.getElementById('ingresoFibraModoWrap'); if(fibraModoWrap) fibraModoWrap.style.display='none';
  const fibraNombreWrap = document.getElementById('ingresoFibraNombreWrap'); if(fibraNombreWrap) fibraNombreWrap.style.display='none';
  _ingresoRefActual = ref;
  document.getElementById('ingresoRef').value = ref;
  document.getElementById('ingresoProdBuscar').value = p.nombre;
  document.getElementById('ingresoProdLista').style.display='none';
  const info = document.getElementById('ingresoProdInfo');
  if(info){ info.style.display='block'; }
  setText('ingresoProdActual', p.metrosPorUnidad
    ? `${p.rollosCentral ? p.rollosCentral.length : valorMostrar(p,_stockCentral(p))} ${sufijoMostrar(p)}`
    : `${_stockCentral(p)} ${p.unidad==='metros'?'mts.':'uds.'}`);
  const rollosWrap = document.getElementById('ingresoRollosWrap');
  const cantWrap = document.getElementById('ingresoCantidadWrap');
  document.getElementById('ingresoRollosCantidad').value = '';
  document.getElementById('ingresoRollosTotal').style.display = 'none';
  document.getElementById('ingresoCantidad').value = '';
  const vuLabel = document.getElementById('ingresoValorUnitarioLabel');
  const vuAyuda = document.getElementById('ingresoValorUnitarioAyuda');
  if(vuAyuda){ vuAyuda.style.display='none'; vuAyuda.textContent=''; }
  if(p.unidad==='metros' && p.metrosPorUnidad){
    // El producto se registró con "metros por rollo" definido — siempre
    // se pregunta por cantidad de rollos, fijo (así se registró).
    rollosWrap.style.display = 'block';
    cantWrap.style.display = 'none';
    document.getElementById('ingresoRollosInfoTxt').textContent = `(${p.metrosPorUnidad} mts. cada uno)`;
    // El valor que se cobra normalmente es POR ROLLO, no por metro suelto
    // — se aclara en la etiqueta para no confundir el total.
    if(vuLabel) vuLabel.innerHTML = 'Valor por rollo (COP) <span class="!text-[#94A3B8] !font-normal">(opcional)</span>';
  } else if(p.unidad==='metros'){
    // El producto se registró como metros sueltos — siempre se pregunta
    // el total de metros directo, fijo (así se registró).
    rollosWrap.style.display = 'none';
    cantWrap.style.display = 'block';
    document.getElementById('ingresoCantidadLabel').textContent = '¿Cuántos metros llegaron?';
    if(vuLabel) vuLabel.innerHTML = 'Valor unitario por metro (COP) <span class="!text-[#94A3B8] !font-normal">(opcional)</span>';
  } else {
    rollosWrap.style.display = 'none';
    cantWrap.style.display = 'block';
    document.getElementById('ingresoCantidadLabel').textContent = '¿Cuántas llegaron?';
    if(vuLabel) vuLabel.innerHTML = 'Valor unitario (COP) <span class="!text-[#94A3B8] !font-normal">(opcional)</span>';
  }
  // El proveedor del producto es fijo (se definió al crearlo) — se
  // muestra ya elegido y bloqueado, no se puede cambiar desde aquí.
  const provBuscar = document.getElementById('ingresoProveedorBuscar');
  const provHidden = document.getElementById('ingresoProveedor');
  if(p.proveedor){
    if(provHidden) provHidden.value = p.proveedor;
    if(provBuscar){ provBuscar.value = p.proveedor; provBuscar.disabled = true; provBuscar.style.background = '#F1F5F9'; provBuscar.style.cursor = 'not-allowed'; }
  } else {
    if(provHidden) provHidden.value = '';
    if(provBuscar){ provBuscar.value = ''; provBuscar.disabled = false; provBuscar.style.background = ''; provBuscar.style.cursor = ''; provBuscar.placeholder = 'Este producto no tiene proveedor asignado'; }
  }
  _actualizarPreviewIngreso();
  document.getElementById('ingresoCantidad')?.focus();
}
document.addEventListener('click', (e)=>{
  const wrap = document.getElementById('ingresoProdLista');
  if(wrap && !e.target.closest('#ingresoProdBuscar') && !e.target.closest('#ingresoProdLista')) wrap.style.display='none';
});
function _actualizarPreviewIngreso(){
  const p = getProductos().find(x=>x.ref===_ingresoRefActual);
  const cant = parseInt(document.getElementById('ingresoCantidad')?.value)||0;
  const prev = document.getElementById('ingresoPreview');
  if(!p || !prev) return;
  if(cant>0){
    const actual = _stockCentral(p);
    prev.style.display='block';
    prev.textContent = `${actual} + ${cant} = ${actual+cant} ${p.unidad==='metros'?'mts.':'uds.'} en total`;
  } else {
    prev.style.display='none';
  }
}
function _filtrarProveedorIngreso(){
  const inp=document.getElementById('ingresoProveedorBuscar');
  const lista=document.getElementById('ingresoProveedorLista');
  if(!inp||!lista) return;
  const q=inp.value.toLowerCase().trim();
  const filtrados=_proveedores.filter(p=>p.nombre.toLowerCase().includes(q));
  let html=`<div onclick="_seleccionarProveedorIngreso('','Sin proveedor')" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;color:#94A3B8;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">Sin proveedor</div>`;
  if(filtrados.length){
    html+=filtrados.map(p=>`<div onclick="_seleccionarProveedorIngreso('${esc(p.nombre).replace(/'/g,'')}','${esc(p.nombre).replace(/'/g,'')}')" style="padding:9px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">🏭 ${esc(p.nombre)}</div>`).join('');
  } else if(q){
    html+=`<div class="!p-[10px_12px] !text-[12px] !text-[#94A3B8]">Sin coincidencias. Crea el proveedor en la sección "Proveedores".</div>`;
  }
  lista.innerHTML=html;
  lista.style.display='block';
}
function _seleccionarProveedorIngreso(valor, texto){
  document.getElementById('ingresoProveedor').value=valor;
  document.getElementById('ingresoProveedorBuscar').value=valor?texto:'';
  document.getElementById('ingresoProveedorLista').style.display='none';
}
document.addEventListener('click', function(e){
  const cont=document.getElementById('ingresoProveedorLista');
  const inp=document.getElementById('ingresoProveedorBuscar');
  if(cont && inp && !inp.contains(e.target) && !cont.contains(e.target)) cont.style.display='none';
});
function _sincronizarPrecioIngreso(origen){
  // Si el producto es "por rollos", el precio que se escribe (unitario)
  // es POR ROLLO — el total se calcula con la cantidad de ROLLOS, no con
  // los metros totales (antes multiplicaba por metros, dando un total
  // absurdamente alto: ej. $150.000 x 900m en vez de x 3 rollos).
  const enModoRollos = document.getElementById('ingresoRollosWrap')?.style.display === 'block';
  const totalMetros = parseFloat(document.getElementById('ingresoCantidad')?.value) || 0;
  const rollos = parseInt(document.getElementById('ingresoRollosCantidad')?.value) || 0;
  const cant = enModoRollos ? rollos : totalMetros;
  const vuEl = document.getElementById('ingresoValorUnitario');
  const ptEl = document.getElementById('ingresoPrecioTotal');
  const ayuda = document.getElementById('ingresoValorUnitarioAyuda');
  if(!cant){ if(ayuda){ayuda.style.display='none';ayuda.textContent='';} return; } // sin cantidad todavía, no se puede calcular el otro lado
  if(origen === 'unitario'){
    const vu = parseFloat(vuEl?.value) || 0;
    if(ptEl) ptEl.value = vu ? (vu * cant).toFixed(2) : '';
  } else if(origen === 'total'){
    const pt = parseFloat(ptEl?.value) || 0;
    if(vuEl) vuEl.value = pt ? (pt / cant).toFixed(2) : '';
  }
  // Referencia útil: cuánto sale por metro, para comparar precios entre
  // proveedores que cobran distinto por rollo.
  if(enModoRollos && ayuda){
    const pt = parseFloat(ptEl?.value) || 0;
    if(pt && totalMetros){
      ayuda.textContent = `≈ ${(pt/totalMetros).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:2})} por metro`;
      ayuda.style.display = 'block';
    } else { ayuda.style.display='none'; ayuda.textContent=''; }
  }
}
// Paso previo: valida lo básico y pide confirmación antes de registrar la llegada.
function confirmarIngresoStock(){
  const cantidad = parseFloat(document.getElementById('ingresoCantidad')?.value)||0;
  if(!_ingresoEsFibra && !_ingresoRefActual){ toast('Elige primero un producto de la lista','error'); return; }
  if(cantidad<=0){ toast(_ingresoEsFibra?'Ingresa cuántos metros llegaron':'Ingresa cuántas unidades llegaron','error'); return; }
  if(_ingresoEsFibra && _ingresoModoFibra==='completo' && !(document.getElementById('ingresoFibraNombre')?.value||'').trim()){ toast('Escribe el nombre/código del carrete completo','error'); return; }
  const nombre = (document.getElementById('ingresoProdBuscar')?.value||'').trim() || 'este producto';
  const rollos = parseInt(document.getElementById('ingresoRollosCantidad')?.value)||0;
  const prod = (typeof getProductos==='function' ? getProductos().find(x=>x.ref===_ingresoRefActual) : null);
  const fmt = n => Number(n).toLocaleString('es-CO');
  const que = _ingresoEsFibra ? `${fmt(cantidad)} metros`
            : (rollos>0 ? `${fmt(rollos)} rollo${rollos===1?'':'s'} (${fmt(cantidad)} ${prod?.unidad||'unidades'})`
            : `${fmt(cantidad)} ${prod?.unidad||'unidades'}`);
  const prov = (document.getElementById('ingresoProveedorBuscar')?.value||'').trim();
  mostrarConfirmar({
    icono:'📥', color:'#16A871',
    titulo:'¿Registrar esta llegada?',
    desc:`Vas a registrar la llegada de ${que} de "${nombre}"${prov?` del proveedor ${prov}`:''}. Se sumará al inventario del almacén. ¿Estás seguro?`,
    btnTxt:'Sí, registrar llegada', btnColor:'#16A871',
    onConfirmar: ()=>_ejecutarIngresoStock()
  });
}
async function _ejecutarIngresoStock(){
  const cantidad = parseFloat(document.getElementById('ingresoCantidad')?.value)||0;
  const notaExtra = [(document.getElementById('ingresoNota')?.value||'').trim(), (document.getElementById('ingresoObservaciones')?.value||'').trim()?`Notas: ${(document.getElementById('ingresoObservaciones').value||'').trim()}`:''].filter(Boolean).join(' · ');

  // Modo fibra: se crea un carrete nuevo (sin nombre, código automático)
  // con estos metros — mucho más simple que el flujo completo de carretes.
  if(_ingresoEsFibra){
    if(cantidad<=0){ toast('Ingresa cuántos metros llegaron','error'); return; }
    const nombreCarrete = (_ingresoModoFibra==='completo') ? (document.getElementById('ingresoFibraNombre')?.value||'').trim() : '';
    if(_ingresoModoFibra==='completo' && !nombreCarrete){ toast('Escribe el nombre/código del carrete completo','error'); return; }
    try{
      const res = await fetch('api/fibra.php?action=registrar_carrete',{
        method:'POST', credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({categoria_id:_ingresoEsFibra, metros:cantidad, sede:'Almacen Central', nombre:nombreCarrete, proveedor:(document.getElementById('ingresoProveedor')?.value||'').trim()})
      });
      const d = await res.json();
      if(!res.ok||d.error) throw new Error(d.error||'Error al registrar el ingreso de fibra');
      cerrarModal('modalIngresoStock');
      cargarCategoriasFibra().catch(()=>{});
      toast(`✓ Carrete ${d.codigo} creado con ${cantidad} mts.`,'success');
    }catch(e){ toast(e.message,'error'); }
    return;
  }

  const proveedor = (document.getElementById('ingresoProveedor')?.value||'').trim();
  const valorUnitario = parseFloat(document.getElementById('ingresoValorUnitario')?.value) || 0;
  const precioTotal = parseFloat(document.getElementById('ingresoPrecioTotal')?.value) || 0;
  const valorEnvio = parseFloat(document.getElementById('ingresoValorEnvio')?.value) || 0;
  const rollosCantidad = parseInt(document.getElementById('ingresoRollosCantidad')?.value) || 0;
  const enModoRollos = rollosCantidad > 0;
  const fmtCOP = (n) => n.toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0});
  // En modo rollos, lo que se escribió en "Valor unitario" es el precio
  // POR ROLLO, no por metro — el costo interno del producto (costo_unitario,
  // usado para valorizar todo el inventario) se guarda por metro, así que
  // se convierte a partir del total real antes de mandarlo al backend.
  const valorUnitarioBackend = enModoRollos
    ? ((precioTotal && cantidad) ? (precioTotal / cantidad) : 0)
    : valorUnitario;
  const notaPrecio = enModoRollos
    ? (valorUnitario ? `Valor por rollo: ${fmtCOP(valorUnitario)} (${rollosCantidad} rollo${rollosCantidad===1?'':'s'}) · Total: ${fmtCOP(precioTotal||valorUnitario*rollosCantidad)}` : '')
    : (valorUnitario ? `Valor unitario: ${fmtCOP(valorUnitario)} · Total: ${fmtCOP(precioTotal||valorUnitario*cantidad)}` : '');
  const notaEnvio = valorEnvio ? `Valor de envío: ${fmtCOP(valorEnvio)}` : '';
  const nota = [proveedor?`Proveedor: ${proveedor}`:'', notaPrecio, notaEnvio, notaExtra].filter(Boolean).join(' · ');
  if(!_ingresoRefActual){ toast('Elige primero un producto de la lista','error'); return; }
  if(cantidad<=0){ toast('Ingresa cuántas unidades llegaron','error'); return; }
  try{
    const res = await fetch('api/productos.php?action=ingreso_stock',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ref:_ingresoRefActual, cantidad, nota, valor_unitario: valorUnitarioBackend||undefined, precio_total: precioTotal||undefined, valor_envio: valorEnvio||undefined, proveedor: proveedor||undefined, rollos_cantidad: rollosCantidad||undefined})
    });
    const d = await res.json();
    if(!res.ok||d.error) throw new Error(d.error||'Error al registrar el ingreso');
    cerrarModal('modalIngresoStock');
    await _recargarProductos();
    renderTabla(); renderStats();
    // Para productos por rollo, el mensaje de confirmación se da en rollos
    // (lo que se acaba de agregar y el nuevo total), no en metros.
    if(enModoRollos){
      const pActualizado = getProductos().find(x=>x.ref===_ingresoRefActual);
      const metrosPorUnidad = pActualizado?.metrosPorUnidad || (cantidad/rollosCantidad) || 1;
      const totalRollosNuevo = Math.round((d.stock_nuevo/metrosPorUnidad)*100)/100;
      toast(`✓ Se agregaron ${rollosCantidad} rollo${rollosCantidad!==1?'s':''} — nuevo total: ${totalRollosNuevo} rollo${totalRollosNuevo!==1?'s':''}`,'success');
    } else {
      toast(`✓ Se agregaron ${cantidad} unidades — nuevo total: ${d.stock_nuevo}`,'success');
    }
  }catch(e){ toast(e.message,'error'); }
}

function abrirEnviarOntDesdeStock(modeloNombre, cantDisponible){
  if(cantDisponible<=0){ toast('No hay ONTs disponibles de este modelo en el almacén','error'); return; }
  envioModo='directo';
  envioIndex=-999; // marcador: producto virtual de ONT, no viene de getProductos()
  window._envioProductoVirtual = {
    ref: 'ONT::'+modeloNombre,
    nombre: '📡 ONT '+modeloNombre,
    unidad: 'unidad',
    id: null,
    _stockEspecial: cantDisponible
  };
  setText('envioTitulo','Enviar ONT directo');
  setText('envioSubtitulo','Quedará en seguimiento para trazabilidad. Los seriales exactos se eligen al despachar.');
  const btn=document.getElementById('envioAccionBtn');if(btn){btn.className='btn btn-primary';btn.style.flex='1';}
  setText('envioAccionLabel','Enviar ahora');
  const tw=document.getElementById('envioTransportadorWrap');
  if(tw) tw.style.display='none';
  _poblarSelectEnvio();
  _poblarModalEnvio(window._envioProductoVirtual);
  window._envioOntSeleccionadas = [];
  window._envioOntDisponiblesCache = [];
  document.getElementById('modalEnvio').classList.add('open');
}
function abrirEnvioDirecto(ref){
  // Igual que en abrirSolicitud: se recibe la REFERENCIA (estable), no
  // una posición en la lista que puede quedar desactualizada si la lista
  // se recargó en segundo plano entre que se abrió el menú y el clic.
  const idx = getProductos().findIndex(x => x.ref === ref);
  if (idx === -1) { toast('Ese producto ya no está disponible — actualiza la página.', 'error'); return; }
  envioIndex=idx;
  // Distribuidor crea solicitud, superadmin envía directo
  if(sesion.rol==='distribuidor'){
    envioModo='solicitar';
    setText('envioTitulo','Solicitar envío');
    setText('envioSubtitulo','El superadmin recibirá y aprobará la solicitud.');
    const btn=document.getElementById('envioAccionBtn');if(btn){btn.className='btn btn-ok';btn.style.flex='1';}
    setText('envioAccionLabel','Solicitar');
  } else {
    envioModo='directo';
    setText('envioTitulo','Enviar directo');
    setText('envioSubtitulo','Quedará en seguimiento para trazabilidad.');
    const btn=document.getElementById('envioAccionBtn');if(btn){btn.className='btn btn-primary';btn.style.flex='1';}
    setText('envioAccionLabel','Enviar ahora');
  }
  const p=getProductos()[idx];
  _poblarSelectEnvio(); // refiltrar destinos al abrir
  _poblarModalEnvio(p);
  window._envioOntSeleccionadas = [];
  window._envioOntDisponiblesCache = [];
  document.getElementById('modalEnvio').classList.add('open');
}
async function _actualizarSelectorOntEnvioDirecto(){
  const lista = document.getElementById('envioOntSelLista');
  const cont  = document.getElementById('envioOntSelContador');
  if(!lista) return;
  const p = envioIndex===-999 ? window._envioProductoVirtual : getProductos()[envioIndex];
  if(!p || !String(p.ref||'').startsWith('ONT::')) return;
  const modelo = p.ref.replace('ONT::','');
  try{
    const res = await fetch('api/cajas.php?action=listar_onts_todas&estado=disponible&modelo='+encodeURIComponent(modelo),{credentials:'same-origin'});
    const data = await res.json();
    window._envioOntDisponiblesCache = (Array.isArray(data)?data:[]).filter(o=>!o.tecnico_asignado);
  }catch(e){ window._envioOntDisponiblesCache = []; }
  window._envioOntSeleccionadas = [];
  _filtrarOntSelEnvioDirecto();
}
function _filtrarOntSelEnvioDirecto(){
  const lista = document.getElementById('envioOntSelLista');
  const cont  = document.getElementById('envioOntSelContador');
  if(!lista) return;
  const q = (document.getElementById('envioOntSelBuscar')?.value||'').toLowerCase().trim();
  const hl = (txt) => {
    txt = String(txt||'—');
    if(!q||!txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))+`<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_1px]">${esc(txt.slice(idx,idx+q.length))}</mark>`+esc(txt.slice(idx+q.length));
  };
  const visibles = (window._envioOntDisponiblesCache||[]).filter(o=>!q || (o.sn||'').toLowerCase().includes(q) || (o.mac||'').toLowerCase().includes(q));
  const sel = window._envioOntSeleccionadas || [];
  lista.innerHTML = visibles.slice(0,80).map(o=>{
    const checked = sel.includes(String(o.id)) ? 'checked' : '';
    return `<label class="!flex !items-center !gap-[8px] !p-[6px_8px] ![border:1px_solid_#E2E8F0] !rounded-[7px] !cursor-pointer !text-[11px] ![background:white]">
      <input type="checkbox" value="${o.id}" ${checked} onchange="_toggleOntSelEnvioDirecto('${o.id}',this.checked)">
      <div>
        <div class="![font-family:monospace] !font-semibold">SN: ${hl(o.sn)}</div>
        <div class="![font-family:monospace] !text-[#64748B]">MAC: ${hl(o.mac_fmt||o.mac)}</div>
      </div>
    </label>`;
  }).join('') || '<div class="!text-center !text-[#94A3B8] !text-[12px] !p-[10px]">Sin coincidencias.</div>';
  const cant = parseInt(document.getElementById('cantidadEnvio')?.value||0);
  if(cont) cont.textContent = `${sel.length} / ${cant||'?'} elegidas`;
}
function _toggleOntSelEnvioDirecto(id,checked){
  const cant = parseInt(document.getElementById('cantidadEnvio')?.value||0);
  let sel = window._envioOntSeleccionadas || [];
  if(checked){
    if(cant && sel.length>=cant){ toast(`Ya elegiste ${cant} — desmarca una para cambiarla`,'error'); _filtrarOntSelEnvioDirecto(); return; }
    sel.push(String(id));
  } else {
    sel = sel.filter(x=>x!==String(id));
  }
  window._envioOntSeleccionadas = sel;
  _filtrarOntSelEnvioDirecto();
}
function abrirSolicitud(ref){
  // Se recibe la REFERENCIA del producto directamente (no una posición
  // en la lista) — si la lista se recargó en segundo plano entre que se
  // abrió el menú y se le dio clic, un índice guardado de antes podría
  // apuntar a otro producto distinto, o a ninguno; la referencia nunca
  // cambia, así que siempre encuentra el producto correcto.
  const idxReal = getProductos().findIndex(x => x.ref === ref);
  if (idxReal === -1) { toast('Ese producto ya no está disponible — actualiza la página.', 'error'); return; }
  envioIndex=idxReal;envioModo='solicitar';const p=getProductos()[idxReal];
  setText('envioTitulo','Solicitar envío');setText('envioSubtitulo','Requiere aprobación del superadmin.');
  const btn=document.getElementById('envioAccionBtn');if(btn){btn.className='btn btn-ok';btn.style.flex='1';}
  setText('envioAccionLabel','Solicitar');_poblarModalEnvio(p);document.getElementById('modalEnvio').classList.add('open');
}
let _origenStockEnvioActual = null;
let _origenStockEnvioDisponible = {nuevo:0, recuperado:0};
function _elegirOrigenStockEnvio(origen){
  _origenStockEnvioActual = origen;
  const p = envioIndex===-999 ? window._envioProductoVirtual : getProductos()[envioIndex];
  const sufijo = (p?.unidad==='metros') ? 'mts.' : 'uds.';
  const conRollos = (valorCrudo)=> p?.metrosPorUnidad ? `${valorCrudo} mts. (${rollosYMetrosTxt(p,valorCrudo)})` : `${valorCrudo} ${sufijo}`;
  const btnN = document.getElementById('btnEnvioOrigenNuevo');
  const btnR = document.getElementById('btnEnvioOrigenRecuperado');
  if(origen==='recuperado'){
    btnR.style.background='#EAF3DE'; btnR.style.color='#166534';
    btnN.style.background='#F1F5F9'; btnN.style.color='#475569';
    document.getElementById('envioStockShow').value = `${conRollos(_origenStockEnvioDisponible.recuperado)} recuperadas disponibles`;
  } else {
    btnN.style.background='#E0F6FF'; btnN.style.color='#0369A1';
    btnR.style.background='#F1F5F9'; btnR.style.color='#475569';
    document.getElementById('envioStockShow').value = `${conRollos(_origenStockEnvioDisponible.nuevo)} nuevas disponibles`;
  }
}
function _poblarModalEnvio(p){
  const s=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v;};
  const unidad=p.unidad||'unidad';
  const sufijo=unidad==='metros'?'mts.':'uds.';
  const stockConRollos = (valorCrudo)=> p.metrosPorUnidad ? `${valorCrudo} mts. (${rollosYMetrosTxt(p,valorCrudo)})` : `${valorCrudo} ${sufijo}`;
  s('envioNombreShow',`${p.ref} — ${p.nombre}${p.proveedor?' ('+p.proveedor+')':''}`);
  s('selectSede','');s('cantidadEnvio','');s('envioDescripcion','');

  // Origen del stock (nuevo vs recuperado) — solo aplica a quien maneja
  // el almacén central, y solo si hay algo recuperado disponible.
  const wrapOrigenEnv = document.getElementById('envioOrigenStockWrap');
  const esCentralEnv = sesion.rol==='superadmin'||sesion.rol==='distribuidor';
  const recuperadoEnv = p.stockRecuperado||0;
  if(esCentralEnv && recuperadoEnv>0){
    wrapOrigenEnv.style.display='block';
    _origenStockEnvioDisponible = {nuevo:_stockCentral(p), recuperado:recuperadoEnv};
    _elegirOrigenStockEnvio('nuevo');
  } else {
    wrapOrigenEnv.style.display='none';
    _origenStockEnvioActual = null;
    s('envioStockShow',`${stockConRollos(_stockCentral(p))} disponibles`);
  }

  // Mostrar/ocultar destino según rol
  const esAdmin = sesion.rol==='superadmin'||sesion.rol==='distribuidor';
  const wrapManual = document.getElementById('envioDestinoWrap');
  const wrapAuto   = document.getElementById('envioDestinoAuto');
  if(esAdmin){
    if(wrapManual) wrapManual.style.display='';
    if(wrapAuto)   wrapAuto.style.display='none';
  } else {
    if(wrapManual) wrapManual.style.display='none';
    if(wrapAuto)   wrapAuto.style.display='';
    const sedeProp = sesion.sede || sesion.sede_nombre || '';
    s('selectSede', sedeProp);
    const autoShow = document.getElementById('envioDestinoAutoShow');
    if(autoShow) autoShow.value = sedeProp + ' (tu sede)';
  }
  // Unidad fija
  const badge=document.getElementById('envioUnidadBadge');
  const hidden=document.getElementById('envioUnidadHidden');
  const sufEl=document.getElementById('envioUnidadSufijo');
  const pActualEnvio = envioIndex===-999 ? window._envioProductoVirtual : getProductos()[envioIndex];
  const sufijoReal = pActualEnvio?.metrosPorUnidad ? 'rollos' : sufijo;
  if(badge) badge.textContent=unidad==='metros'?(pActualEnvio?.metrosPorUnidad?'📦 Por rollo':'📏 Metros'):'📦 Por unidad';
  if(hidden) hidden.value=unidad;
  if(sufEl)  sufEl.textContent='('+sufijoReal+')';
}

async function _envioActualizarRollos(){
  const wrap = document.getElementById('envioRolloWrap');
  const sel = document.getElementById('envioRolloSelect');
  window._envioRolloElegido = null;
  if(!wrap || !sel) return;
  wrap.style.display = 'none';
  sel.innerHTML = '<option value="">No importa cuál (automático)</option>';
  const p = envioIndex===-999 ? window._envioProductoVirtual : getProductos()[envioIndex];
  const sedeDest = document.getElementById('selectSede')?.value || '';
  if(!p || !p.metrosPorUnidad || sedeDest !== 'Almacen Central') return;
  try{
    const res = await fetch(`api/productos.php?action=rollos_disponibles&ref=${encodeURIComponent(p.ref)}&sede=Almacen Central`, {credentials:'same-origin'});
    const rollos = await res.json();
    if(Array.isArray(rollos) && rollos.length > 1){
      rollos.forEach((r,i) => {
        sel.innerHTML += `<option value="${r.id}">Rollo #${r.id} — ${parseFloat(r.metros_disponibles).toFixed(1)} m disponibles${(r.metros&&parseFloat(r.metros)>parseFloat(r.metros_disponibles))?' (de '+parseFloat(r.metros).toFixed(0)+' m, ya usado en parte)':''}</option>`;
      });
      wrap.style.display = 'block';
    }
  }catch(e){ /* si falla, se envía sin especificar rollo (automático) */ }
}
function procesarEnvio(){
  const sede=document.getElementById('selectSede')?.value;
  const cantIngresada=parseInt(document.getElementById('cantidadEnvio')?.value);
  const desc=(document.getElementById('envioDescripcion')?.value||'').trim();
  const unidadEnvio=document.getElementById('envioUnidadHidden')?.value||'unidad';
  if(!sede){toast('Selecciona un municipio.','error');return;}
  if(!cantIngresada||cantIngresada<1){toast('Ingresa cantidad válida.','error');return;}
  const productos=getProductos();
  const p = envioIndex===-999 ? window._envioProductoVirtual : productos[envioIndex];
  if(!p){toast('Producto no encontrado.','error');return;}
  // Si el producto viene en rollos, lo que se escribió es CANTIDAD DE
  // ROLLOS — se convierte a metros (lo que realmente se descuenta y se
  // acredita al técnico, para que luego pueda gastar en metros exactos).
  const cant = p.metrosPorUnidad ? cantIngresada * p.metrosPorUnidad : cantIngresada;
  const stockDisponibleEnvio = _origenStockEnvioActual==='recuperado' ? _origenStockEnvioDisponible.recuperado : _origenStockEnvioActual==='nuevo' ? _origenStockEnvioDisponible.nuevo : _stockCentral(p);
  if(cant>stockDisponibleEnvio){toast(p.metrosPorUnidad?'No hay suficientes rollos disponibles.':'Stock insuficiente.','error');return;}
  const transpWrap = document.getElementById('envioTransportadorWrap');
  if(envioModo==='directo'){
    if(transpWrap) transpWrap.style.display='none'; // ya validado antes
    const ontSel = window._envioOntSeleccionadas || [];
    if(ontSel.length && ontSel.length!==cant){
      toast(`Elegiste ${ontSel.length} ONT(s), pero la cantidad es ${cant} — completa la selección o desmarca todas.`,'error');
      return;
    }
    _ejecutarEnvioDirecto(p,productos,sede,cant,desc,unidadEnvio,ontSel);
  }
  else _crearSolicitud(p,sede,cant,desc,unidadEnvio);
}
async function _ejecutarEnvioDirecto(p,productos,sede,cant,desc,unidadEnvio,ontIds){
  try{
    let notasFinal = desc||'';
    if(window._envioDestinoUsuarioEspecifico){
      notasFinal = (notasFinal + `\nRecoge en persona: ${window._envioDestinoUsuarioEspecifico}`).trim();
    }
    // Crear registro en seguimiento como aprobado (listo para despachar)
    const res = await fetch('api/seguimiento.php?action=crear_envio_directo',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        ref: p.ref, nombre: p.nombre, destino: sede,
        cantidad: cant, unidad_envio: unidadEnvio,
        notas: notasFinal, producto_id: p.id,
        ont_ids: ontIds && ontIds.length ? ontIds : undefined,
        destinatario_especifico: window._envioDestinoUsuarioEspecifico || undefined,
        origen_stock: _origenStockEnvioActual || undefined,
        rollo_id: window._envioRolloElegido || undefined
      })
    });
    const data = await res.json();
    if(data.error) throw new Error(data.error);

    await Promise.all([_recargarProductos(),_recargarSeguimiento(),_recargarHistorial()]);
    cerrarModal('modalEnvio');renderTabla();renderSeguimiento();renderHistorial();renderStats();updateNotifBadges();
    toast(`✓ Envío creado — ${cant} ${unidadEnvio==='metros'?'mts.':'uds.'} de "${p.nombre}" → ${sede}. Aparece en Seguimiento.`,'success');
  }catch(e){toast(e.message||'Error al enviar','error');}
}
async function _crearSolicitud(p,sede,cant,desc,unidadEnvio){
  try{
    let notaFinal = desc||'';
    if(window._envioDestinoUsuarioEspecifico){
      notaFinal = `Para: ${window._envioDestinoUsuarioEspecifico}.${notaFinal?' '+notaFinal:''}`;
    }
    await _api('solicitudes','crear',{ref:p.ref,nombre:p.nombre,destino:sede,cantidad:cant,unidadEnvio,solicitadoPor:sesion.usuario,nota:notaFinal,destinatario_especifico:window._envioDestinoUsuarioEspecifico||undefined});
    await Promise.all([_recargarSolicitudes()]);
    cerrarModal('modalEnvio');renderStats();renderMisSolicitudes();renderHistorial();updateNotifBadges();
    toast('Solicitud enviada. Esperando aprobación.','success');
  }catch(e){toast(e.message||'Error al crear solicitud','error');}
}

/* ════════════════════════════════════════════════
   SOLICITUDES (superadmin)
════════════════════════════════════════════════ */
let _tabSol='todos';
function setTabSol(t){
  _tabSol=t;
  ['todos','pendiente','aprobada','rechazada','recibida'].forEach(id=>{
    document.getElementById('tabSol_'+id)?.classList.toggle('active',id===t);
  });
  renderSolicitudes();
}
function limpiarFiltrosSol(){
  ['filtroSolProducto','filtroSolFechaDesde','filtroSolFechaHasta'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const m=document.getElementById('filtroSolMunicipio');if(m)m.value='';
  const mb=document.getElementById('filtroSolMunicipioBuscar');if(mb)mb.value='';
  const t=document.getElementById('filtroSolTipo');if(t)t.value='';
  const tu=document.getElementById('filtroSolUsuario');if(tu)tu.value='';
  const tb=document.getElementById('filtroSolUsuarioBuscar');if(tb)tb.value='';
  _tabSol='todos';
  ['todos','pendiente','aprobada','rechazada','recibida'].forEach(id=>document.getElementById('tabSol_'+id)?.classList.toggle('active',id==='todos'));
  renderSolicitudes();
}

// Teléfonos para WhatsApp: funciona aunque el rol no pueda listar usuarios.
function _waUsuarioDe(usuario) {
  const u = getUsuarios().find(x => x.usuario === usuario);
  if (u && u.telefono) return u;
  if (window._waTel) return window._waTel[usuario] || u || null;
  if (!window._waTelCargando) {
    window._waTelCargando = true;
    _api('usuarios', 'telefonos_whatsapp').then(r => {
      const m = {};
      (Array.isArray(r) ? r : []).forEach(x => { m[x.usuario] = x; });
      window._waTel = m;
      try { if (typeof renderSolicitudes === 'function') renderSolicitudes(); } catch(e){}
      try { if (typeof renderSolicitudesMunicipio === 'function') renderSolicitudesMunicipio(); } catch(e){}
    }).catch(() => { window._waTel = {}; });
  }
  return u || null;
}

// Columna "Nota / Motivo" de un pedido múltiple en "Mis solicitudes": el motivo del rechazo (rojo) si lo hay
// y, si no, la nota que escribió quien pidió.
function _notaMotivoGrupo(pid, items){
  try{
    const p = (getPedidosAgrupados()||[]).find(x=>String(x.id)===String(pid));
    let motivo = p ? _motivoDecisionPedAgrup(p) : '';
    if(!motivo){ const it=(items||[]).find(i=>i.motivo); if(it) motivo = it.motivo; }
    if(motivo) return `<div class="!text-[12px] !text-[#E24B4A]">❌ ${esc(motivo)}</div>`;
    const nota = p ? String(p.nota||'').split('\n').map(l=>l.replace(/^\[[^\]]*\]\s*/,'').trim()).filter(Boolean)[0] : '';
    if(p && ['rechazado','rechazada'].includes(p.estado)) return '<span class="!text-[11px] !text-[#94A3B8] ![font-style:italic]">Sin motivo registrado</span>';
    return nota ? `<div class="!text-[12px] !text-[#64748B]">${esc(nota)}</div>` : '<span class="!text-[#CBD5E1]">—</span>';
  }catch(e){ return '<span class="!text-[#CBD5E1]">—</span>'; }
}
// Motivo del rechazo de un pedido múltiple: sale de la nota con el sello "[Rechazó · usuario] motivo".
// Así se ve directo en la lista (antes solo aparecía dentro de "Ver detalles").
function _motivoDecisionPedAgrup(p){
  if(!p || !['rechazado','rechazada','parcial'].includes(p.estado)) return '';
  const lineas = String(p.nota||'').split('\n');
  for(let i=lineas.length-1;i>=0;i--){
    const m = lineas[i].match(/^\[(Rechaz[oó]|Aprob[oó] parcialmente)[^\]]*\]\s*(.+)$/);
    if(m) return m[2].trim();
  }
  return '';
}
// Arma un link de WhatsApp (wa.me) con un número y un mensaje ya escrito.
// Colombia por defecto si el número no trae indicativo de país.
function _waLink(tel, msg) {
  let t = (tel || '').replace(/\D/g, '');
  if (!t) return null;
  if (t.length === 10) t = '57' + t; // celular colombiano sin indicativo
  return `https://wa.me/${t}?text=${encodeURIComponent(msg)}`;
}

function _filtrarSolDestinos(){
  const q = (document.getElementById('filtroSolMunicipioBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('filtroSolMunicipioLista');
  if(!lista) return;
  const destinos = [...new Set([
    ...getSolicitudes().map(s=>s.destino),
    ...getPedidosAgrupados().map(p=>p.destino)
  ].filter(Boolean))].sort();
  const filtrados = destinos.filter(d=>!q||d.toLowerCase().includes(q));
  let html = `<div onclick="_seleccionarSolDestino('')" style="padding:8px 12px;cursor:pointer;font-size:13px;font-weight:600;color:#0C6EDE;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">Todos</div>`;
  html += filtrados.length
    ? filtrados.map(d=>`<div onclick="_seleccionarSolDestino('${esc(d).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">${esc(d)}</div>`).join('')
    : `<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>`;
  lista.innerHTML = html;
  lista.style.display='block';
}
function _seleccionarSolDestino(destino){
  document.getElementById('filtroSolMunicipio').value = destino;
  document.getElementById('filtroSolMunicipioBuscar').value = destino || '';
  document.getElementById('filtroSolMunicipioLista').style.display='none';
  renderSolicitudes();
}
document.addEventListener('click', function(e){
  const cont=document.getElementById('filtroSolMunicipioLista');
  const inp=document.getElementById('filtroSolMunicipioBuscar');
  if(cont && inp && !inp.contains(e.target) && !cont.contains(e.target)) cont.style.display='none';
});

function _filtrarSolUsuarios(){
  const q = (document.getElementById('filtroSolUsuarioBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('filtroSolUsuarioLista');
  if(!lista) return;
  const tipoLbl = {municipio:'Municipio',tecnico:'Técnico',persona:'Persona'};
  const personas = getUsuarios()
    .filter(u=>['municipio','tecnico','persona'].includes(u.rol))
    .filter(u=>{
      const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
      return !q || nombreCompleto.toLowerCase().includes(q) || u.usuario.toLowerCase().includes(q) || (u.sede||'').toLowerCase().includes(q);
    })
    .sort((a,b)=>(a.nombre||a.usuario).localeCompare(b.nombre||b.usuario));
  if(!personas.length){
    lista.innerHTML = '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>';
  } else {
    lista.innerHTML = personas.map(u=>{
      const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
      return `<div onclick="_seleccionarSolUsuario('${esc(u.usuario)}','${esc(nombreCompleto).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
        <div class="!font-semibold">${esc(nombreCompleto)}</div>
        <div class="!text-[11px] !text-[#94A3B8]">${tipoLbl[u.rol]||u.rol} · ${esc(u.sede||'—')}</div>
      </div>`;
    }).join('');
  }
  lista.style.display='block';
}
function _seleccionarSolUsuario(usuario,nombre){
  document.getElementById('filtroSolUsuario').value = usuario;
  document.getElementById('filtroSolUsuarioBuscar').value = nombre;
  document.getElementById('filtroSolUsuarioLista').style.display='none';
  renderSolicitudes();
}
document.addEventListener('click', function(e){
  const cont=document.getElementById('filtroSolUsuarioLista');
  const inp=document.getElementById('filtroSolUsuarioBuscar');
  if(cont && inp && !inp.contains(e.target) && !cont.contains(e.target)) cont.style.display='none';
});

function renderSolicitudes(){
  const tbody=document.getElementById('tablaSolicitudes');if(!tbody)return;

  // Solicitudes pendientes:
  // - Superadmin: ve solo lo que el distribuidor originó — lo de
  //   municipio/técnico/persona vive exclusivamente en "Pedidos directos"
  //   (aunque el distribuidor lo haya gestionado/escalado), para no duplicar.
  // - Distribuidor: ve las que él escaló (gestionadoPor) + las que él creó
  const usuariosDistrib = getUsuarios().filter(u=>u.rol==='distribuidor').map(u=>u.usuario);
  const _esDistribInd = (u)=> u==='distribuidor' || usuariosDistrib.includes(u);
  const rolActual = sesion?.rol;
  // Solicitudes individuales
  let lista=[...getSolicitudes().filter(s=>{
    if(s.pedidoAgrupadoId) return false;
    if(rolActual==='superadmin') return _esDistribInd(s.solicitadoPor);
    if(rolActual==='distribuidor') return true;
    return false;
  })];

  // Agregar pedidos agrupados para que el admin los vea:
  // - escalados (en_gestion) y ya resueltos (aprobado/rechazado)
  // - pendientes CREADOS POR EL DISTRIBUIDOR (el distribuidor escala al superadmin)
  if(rolActual==='superadmin'){
    const _distribUsers = getUsuarios().filter(u=>u.rol==='distribuidor').map(u=>u.usuario);
    const _esDistrib = (u)=> u==='distribuidor' || _distribUsers.includes(u);
    // Solo lo que el distribuidor ORIGINÓ él mismo — lo de municipio/técnico/
    // persona (aunque el distribuidor lo haya escalado) vive exclusivamente
    // en "Pedidos directos", no se duplica aquí.
    const pedAgrupEscalados = getPedidosAgrupados().filter(p => _esDistrib(p.solicitado_por));
    pedAgrupEscalados.forEach(p=>{
      // Representar como un item en la lista
      lista.push({
        id: 'pag_'+p.id,
        ref: '📦',
        nombre: `Pedido múltiple (${p.total_items||'?'} productos)`,
        destino: p.destino,
        cantidad: p.total_items||0,
        unidadEnvio: 'pedido',
        solicitadoPor: p.solicitado_por,
        gestionadoPor: p.gestionado_por,
        estado: (p.estado==='parcial' && _estadoPedAgrupBase(p)==='aprobada') ? 'parcial' : _estadoPedAgrupBase(p),
        fecha: p.fecha,
        _esPedidoAgrupado: true,
        _pedidoAgrupadoId: p.id,
        nota: p.nota||'',
        motivo: _motivoDecisionPedAgrup(p),
        _items: p.items||[],
      });
    });
  }

  // (el buscador de destino se llena dinámicamente al escribir — ver _filtrarSolDestinos)

  // Contadores
  const cntPend=lista.filter(s=>s.estado==='pendiente'||s.estado==='en_gestion').length;
  const cntRech=lista.filter(s=>s.estado==='rechazada').length;
  const st=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v||'';};
  const cntRecib=lista.filter(s=>s.estado==='recibida'||s.estado==='recibido').length;
  st('cntSolPend',cntPend||'');st('cntSolRech',cntRech||'');st('cntSolRecib',cntRecib||'');
  st('badgePendSolicitudes',cntPend?cntPend+' pendientes':'');

  // Filtros
  const q=(document.getElementById('filtroSolProducto')?.value||'').toLowerCase();
  const mun=(document.getElementById('filtroSolMunicipio')?.value||'');
  const tipoUsr=(document.getElementById('filtroSolTipo')?.value||'');
  const usrSel=(document.getElementById('filtroSolUsuario')?.value||'');
  const desde=document.getElementById('filtroSolFechaDesde')?.value;
  const hasta=document.getElementById('filtroSolFechaHasta')?.value;

  const _rolPorUsuarioSol = Object.fromEntries(getUsuarios().map(u=>[u.usuario,u.rol]));

  if(_tabSol==='recibida') lista=lista.filter(s=>s.estado==='recibida'||s.estado==='recibido');
  else if(_tabSol==='pendiente') lista=lista.filter(s=>s.estado==='pendiente'||s.estado==='en_gestion');
  else if(_tabSol!=='todos') lista=lista.filter(s=>s.estado===_tabSol);
  if(q) lista=lista.filter(s=>(s.nombre||'').toLowerCase().includes(q)||(s.ref||'').toLowerCase().includes(q)
    ||(s._items||[]).some(i=>(i.nombre||'').toLowerCase().includes(q)));
  if(mun) lista=lista.filter(s=>s.destino===mun);
  if(tipoUsr) lista=lista.filter(s=>_rolPorUsuarioSol[s.solicitadoPor]===tipoUsr);
  if(usrSel) lista=lista.filter(s=>s.solicitadoPor===usrSel);
  if(desde) lista=lista.filter(s=>s.fecha&&s.fecha.slice(0,10)>=desde);
  if(hasta) lista=lista.filter(s=>s.fecha&&s.fecha.slice(0,10)<=hasta);

  lista.sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));

  if(!lista.length){tbody.innerHTML=`<tr><td class="!p-[32px] !text-center !text-[#94A3B8]" colspan="7">Sin resultados.</td></tr>`;return;}

  // Resaltado amarillo de la coincidencia de búsqueda
  const hlSol = (txt) => {
    txt = String(txt==null?'':txt);
    if(!q || !txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx+q.length))}</mark>`
      + esc(txt.slice(idx+q.length));
  };

  const ecls={pendiente:'badge-warn',en_gestion:'badge-brand',aprobada:'badge-ok',rechazada:'badge-danger'};
  const elbl={pendiente:'Pendiente',en_gestion:'⏳ En gestión',aprobada:'Aprobada ✓',rechazada:'Rechazada'};

  // Arma el botón de WhatsApp para esta solicitud (ver función global _waLink).
  const _waBoton = (s) => {
    if (!tienePermiso('usar_whatsapp')) return '';
    const u = _waUsuarioDe(s.solicitadoPor);
    const tel = u?.telefono;
    if (!tel) return '';
    const nombreU = (u?.nombre ? `${u.nombre} ${u.apellido||''}`.trim() : s.solicitadoPor);
    let msg;
    if (s._esPedidoAgrupado) {
      const pedido = getPedidosAgrupados().find(p => p.id === (s._pedidoAgrupadoId||s.pedidoAgrupadoId));
      const items = pedido?.items || [];
      const listaItems = items.map(i => `• ${i.nombre} — ${i.cantidad} ${i.unidad_envio==='metros'?'mts.':'uds.'}`).join('\n');
      msg = `Hola ${nombreU}, tengo una pregunta sobre tu pedido para ${s.destino} (${fmtDate(s.fecha)}):\n${listaItems || `${s.cantidad} producto(s)`}`;
    } else {
      msg = `Hola ${nombreU}, tengo una pregunta sobre tu solicitud de ${s.cantidad} ${s.unidadEnvio==='metros'?'mts.':'uds.'} de "${s.nombre}" para ${s.destino} (${fmtDate(s.fecha)}).`;
    }
    return `<a href="${_waLink(tel, msg)}" target="_blank" rel="noopener" class="btn-sm ![background:#DCFCE7] !text-[#166534] ![text-decoration:none] !inline-flex !items-center !gap-[3px]">📱 WhatsApp</a>`;
  };

  tbody.innerHTML=lista.map(s=>{
    const _pagId = s._pedidoAgrupadoId || s.pedidoAgrupadoId;
    const acc=(s.estado==='pendiente'||s.estado==='en_gestion')
      ?`<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
          <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
            ${_pagId
              ? `<button onclick="verDetallePedidoAgrupado('${_pagId}')" class="btn-sm ![background:#E0F6FF] !text-[#0369A1]">🔍 Ver detalle</button>
                 ${(sesion.rol==='superadmin'||tienePermiso('aprobar_pedidos'))?`<button onclick="abrirGestionPedido('${_pagId}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">📋 Gestionar</button>`:''}`
              : `<button onclick="aprobarSolicitud('${s.id}',${s.cantidad},'${s.unidadEnvio||'unidad'}','${esc(s.nombre)}','${s.ref}','${esc(s.nota||'')}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">${(sesion.rol==='superadmin'||tienePermiso('aprobar_pedidos'))?'✓ Aprobar':'↑ Escalar'}</button>`
            }
            ${!_pagId&&(sesion.rol==='superadmin'||tienePermiso('rechazar_envios'))?`<button onclick="rechazarSolicitud('${s.id}')" class="btn-sm ![background:#FCEBEB] !text-[#B91C1C]">✕ Rechazar</button>`:''}
          </div>
          ${_waBoton(s)}
        </div>`
      :`<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">${_pagId?`<button onclick="verDetallePedidoAgrupado('${_pagId}')" class="btn-sm ![background:#E0F6FF] !text-[#0369A1]">🔍 Ver detalle</button>`:''}
        ${(s.aprobadoPor||s.rechazadoPor)?`<span class="!text-[11px] !text-[#94A3B8]">${s.estado==='rechazada'?'Rechazó':'Aprobó'}: ${escU(s.aprobadoPor||s.rechazadoPor)}</span>`:''}</div>`;
    return `<tr class="fade-row">
      <td><span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[1px_6px] !rounded-[4px] !mr-[6px]">${esc(s.ref)}</span><span class="!font-semibold">${esc(s.nombre)}</span>${(q&&s._items&&s._items.length)?`<div class="!text-[11px] !text-[#64748B] !mt-[2px]">${s._items.map(i=>hlSol(i.nombre)).join(', ')}</div>`:''}${s.nota?`<div class="!text-[11px] !text-[#94A3B8] ![font-style:italic]">"${esc(s.nota)}"</div>`:''}</td>
      <td><span class="badge badge-brand">${esc(s.destino)}</span></td>
      <td class="!font-semibold">${s.cantidad} <span class="!text-[11px] !font-normal !text-[#94A3B8]">${s.unidadEnvio==='metros'?'mts.':'uds.'}</span></td>
      <td class="!text-[12px] !text-[#64748B]">${escU(s.solicitadoPor)}${s.gestionadoPor?`<div class="!text-[11px] !text-[#94A3B8]">vía ${escU(s.gestionadoPor)}</div>`:''}</td>
      <td class="!text-[12px] !text-[#94A3B8] !whitespace-nowrap">${fmtDate(s.fecha)}</td>
      <td><span class="badge ${ecls[s.estado]||'badge-gray'}">${elbl[s.estado]||s.estado}</span>${s.motivo?`<div class="!text-[11px] !text-[#E24B4A] !mt-[2px]">${esc(s.motivo)}</div>`:''}</td>
      <td>${acc}</td>

    </tr>`;
  }).join('');
}
// ID actual para aprobar
let _aprobarId = null;

function aprobarSolicitud(id, cantSolParam, unidParam, nombreParam, refParam, notaParam){
  // Usar parámetros directos si se pasan, o buscar en el array
  const s = getSolicitudes().find(x=>x.id===id||x.id===String(id));
  _aprobarId = id;
  // Llenar modal
  const el = n => document.getElementById(n);
  const refMostrar  = refParam  || s?.ref   || '';
  const nomMostrar  = nombreParam || s?.nombre || '';
  if(el('aprobarNombreProducto')) el('aprobarNombreProducto').textContent = refMostrar ? `${refMostrar} — ${nomMostrar}` : nomMostrar;
  const cantSol = cantSolParam || s?.cantidad || 0;
  const unidSol = (unidParam||s?.unidadEnvio||'unidad')==='metros'?'mts.':'uds.';
  if(el('aprobarCantSolicitada')) el('aprobarCantSolicitada').textContent = cantSol||'—';
  if(el('aprobarUnidSolicitada')) el('aprobarUnidSolicitada').textContent = unidSol;
  if(el('aprobarUnidAprobar'))   el('aprobarUnidAprobar').textContent   = unidSol;
  if(el('aprobarCantSolMax')) el('aprobarCantSolMax').value = cantSol;
  if(el('aprobarCantidad')) { el('aprobarCantidad').value = cantSol; }
  if(el('aprobarObservacion')) el('aprobarObservacion').value = '';
  if(el('aprobarWarnCant')) el('aprobarWarnCant').style.display='none';
  // Mostrar nota del solicitante si tiene
  const notaDiv = el('aprobarNotaSolicitante');
  if(notaDiv){
    const nota = notaParam || s?.nota || '';
    if(nota){ notaDiv.textContent = '💬 '+nota; notaDiv.style.display=''; }
    else { notaDiv.style.display='none'; }
  }
  if(el('aprobarAlerta')) { el('aprobarAlerta').style.display='none'; }
  document.getElementById('modalAprobarSolicitud')?.classList.add('open');
}

async function confirmarAprobarSolicitud(){
  const cant = parseInt(document.getElementById('aprobarCantidad')?.value||'0');
  const obs  = (document.getElementById('aprobarObservacion')?.value||'').trim();
  const al   = document.getElementById('aprobarAlerta');
  if(!cant||cant<1){ if(al){al.textContent='Ingresa una cantidad válida.';al.className='alerta error';al.style.display='';} return; }
  try{
    const puedeAprobarSol = (sesion.rol==='superadmin' || tienePermiso('aprobar_pedidos'));
    const accion = puedeAprobarSol ? 'aprobar' : 'escalar';
    const rAp = await _api('solicitudes', accion, {id:_aprobarId, cantidadAprobada:cant, observacion:obs});
    document.getElementById('modalAprobarSolicitud')?.classList.remove('open');
    await Promise.all([_recargarProductos(),_recargarHistorial(),_recargarSolicitudes(),_recargarPedidos()]);
    renderSolicitudes();renderSolicitudesMunicipio();renderTabla();renderHistorial();renderStats();updateNotifBadges();
    const msg = puedeAprobarSol ? 'Solicitud aprobada ✓' : 'Solicitud enviada al superadmin ✓';
    toast(msg,'success');
    if(rAp&&rAp.aviso) setTimeout(()=>mostrarAlertaBloqueo(rAp.aviso.replace(/^⚠️ /,''),'ONT insuficientes','warn'),400);
  }catch(e){toast(e.message||'Error al aprobar','error');}
}
async function abrirRechazar(id){
  rechazarId = id;
  // Limpiar input
  const inputMotivo = document.getElementById('motivoRechazo') || document.getElementById('rechazoMotivoInput');
  if(inputMotivo) inputMotivo.value = '';
  // Conectar botón confirmar para solicitudes
  const btn = document.getElementById('btnConfirmarRechazo');
  if(btn){
    btn.onclick = async()=>{
      const motivo = (document.getElementById('rechazoMotivoInput')?.value || document.getElementById('motivoRechazo')?.value || '').trim();
      try{
        const res = await _api('solicitudes','rechazar',{id:rechazarId,motivo});
        if(res && res.error){ toast(res.error,'error'); return; }
        cerrarModal('modalRechazoMotivo');
        await Promise.all([_recargarSolicitudes(), _recargarHistorial()]);
        renderSolicitudes(); renderSolicitudesMunicipio(); renderMisSolicitudes(); renderStats(); renderHistorial(); updateNotifBadges();
        toast('Solicitud rechazada.','success');
      }catch(e){ toast(e.message||'Error al rechazar','error'); }
    };
  }
  const modal = document.getElementById('modalRechazoMotivo');
  if(modal && !modal._listenerAdded){
    modal.addEventListener('click',e=>{if(e.target===modal)cerrarModal('modalRechazoMotivo');});
    modal._listenerAdded = true;
  }
  modal?.classList.add('open');
  setTimeout(()=>(document.getElementById('rechazoMotivoInput')||document.getElementById('motivoRechazo'))?.focus(),100);
}
function rechazarSolicitud(id){ abrirRechazar(id); }
async function confirmarRechazo(){
  const motivo=document.getElementById('motivoRechazo')?.value.trim();
  try{
    const res = await _api('solicitudes','rechazar',{id:rechazarId,motivo});
    if(res.error){ toast(res.error,'error'); return; }
    await _recargarSolicitudes();
    cerrarModal('modalRechazoMotivo');
    renderSolicitudesMunicipio();renderMisSolicitudes();renderStats();renderHistorial();updateNotifBadges();
    toast('Solicitud rechazada.','success');
  }catch(e){toast(e.message||'Error al rechazar','error');}
}

/* ════════════════════════════════════════════════
   MIS SOLICITUDES
════════════════════════════════════════════════ */
function renderMisSolicitudes(){
  const tbody = document.getElementById('tablaMisSolicitudes');
  if(!tbody) return;

  const rol   = sesion.rol;
  const sedes = sesion.sedes || [sesion.sede];

  // ── Título dinámico según rol ──────────────────────────────
  const tit = document.getElementById('misSolTitulo');
  const sub = document.getElementById('misSolSubtitulo');
  if(tit) tit.textContent = rol==='distribuidor' ? 'Solicitudes gestionadas' : 'Mis pedidos de material';
  if(sub) sub.textContent = rol==='distribuidor'
    ? 'Solicitudes que tú mismo hiciste'
    : `Pedidos realizados desde ${sedes.join(', ')}`;
  const btnNuevo = document.getElementById('misSolBtnNuevo');
  if(btnNuevo) btnNuevo.textContent = rol==='distribuidor' ? 'Nueva solicitud' : 'Nuevo pedido';

  // ── Cabecera de tabla adaptada ─────────────────────────────
  const thead = tbody.closest('table')?.querySelector('thead tr');
  if(thead){
    if(rol==='distribuidor'){
      thead.innerHTML = '<th>Producto</th><th>Municipio destino</th><th>Cantidad</th><th>Estado</th><th>Solicitado por</th><th>Fecha</th>';
    } else {
      thead.innerHTML = '<th>Producto</th><th>Cantidad</th><th>Estado</th><th>Nota / Motivo</th><th>Fecha</th><th>Acción</th>';
    }
  }

  // ── Filtrar solicitudes por rol ────────────────────────────
  let sols;
  if(rol==='distribuidor'){
    // Distribuidor ve solo lo que él mismo solicitó — lo que gestionó/escaló
    // de otras personas (municipio/técnico/persona) NO cuenta aquí, eso es
    // de ellos, no de él.
    sols = getSolicitudes()
      .filter(s => s.solicitadoPor===sesion.usuario)
      .sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  } else {
    // Municipio / técnico / persona: solo las solicitudes que hizo ESTE usuario
    // (antes también se mostraban las de toda su sede — ya no, cada quien ve lo suyo).
    const solsBase = getSolicitudes()
      .filter(s => s.solicitadoPor === sesion.usuario);

    // También incluir los PEDIDOS al almacén (tabla pedidos_municipio), normalizados
    // al mismo formato que una solicitud para que se muestren juntos.
    const mapEstadoPed = {atendido:'aprobada', aprobado:'aprobada', rechazado:'rechazada'};
    const pedidos = (getPedidosMun()||[])
      .filter(p => p.solicitado_por === sesion.usuario)
      .map(p => ({
        id: p.id,
        ref: p.ref,
        nombre: p.nombre,
        destino: p.municipio,
        cantidad: parseInt(p.cantidad||0),
        unidadEnvio: p.unidad_pedido || 'unidad',
        solicitadoPor: p.solicitado_por,
        estado: mapEstadoPed[p.estado] || p.estado,
        nota: p.justificacion || p.nota || '',
        motivo: p.motivo || '',
        fecha: p.fecha,
        _esPedido: true
      }));

    sols = [...solsBase, ...pedidos]
      .sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  }

  // Contadores para tabs
  const cntP = sols.filter(s=>s.estado==='pendiente'||s.estado==='en_gestion').length;
  const cntR = sols.filter(s=>s.estado==='rechazada').length;
  const e1=document.getElementById('cntMisSolPend'), e2=document.getElementById('cntMisSolRech');
  if(e1) e1.textContent = cntP||'';
  if(e2) e2.textContent = cntR||'';

  // Filtros
  const qP = (document.getElementById('filtroMisSolProducto')?.value||'').toLowerCase();
  const qM = document.getElementById('filtroMisSolMunicipio')?.value||'';
  if(qP) sols = sols.filter(s=>(s.nombre||'').toLowerCase().includes(qP)||(s.ref||'').toLowerCase().includes(qP));
  if(qM) sols = sols.filter(s=>s.destino===qM);
  if(tabMisSol==='en_camino')  sols = sols.filter(s=>s.estado==='en_camino'||s.estado==='aprobada');
  else if(tabMisSol==='recibida')   sols = sols.filter(s=>s.estado==='recibida'||s.estado==='recibido');
  else if(tabMisSol!=='todos') sols = sols.filter(s=>s.estado===tabMisSol);

  // Agrupar pedidos agrupados
  const grupos = [];
  const yaAgrupados = new Set();
  sols.forEach(s=>{
    if(s.pedidoAgrupadoId){
      if(!yaAgrupados.has(s.pedidoAgrupadoId)){
        yaAgrupados.add(s.pedidoAgrupadoId);
        const itemsDelGrupo = sols.filter(x=>x.pedidoAgrupadoId===s.pedidoAgrupadoId);
        grupos.push({ esGrupo:true, pedidoAgrupadoId:s.pedidoAgrupadoId,
          destino:s.destino, estado:s.estado, fecha:s.fecha, items:itemsDelGrupo });
      }
    } else {
      grupos.push(s);
    }
  });

  if(!grupos.length){
    const cols = rol==='distribuidor' ? 6 : 6;
    tbody.innerHTML=`<tr><td class="!p-[40px] !text-center !text-[#94A3B8] !text-[13px]" colspan="${cols}">
      <div class="!text-[32px] !mb-[8px]">📭</div>
      Sin ${rol==='distribuidor'?'solicitudes':'pedidos'} en esta categoría.
      ${rol!=='distribuidor'?'<div class="!mt-[8px]"><button onclick="goPanel(\'productos\')" class="btn btn-primary !text-[12px]">+ Hacer un pedido</button></div>':''}
    </td></tr>`;
    return;
  }

  const ecls={pendiente:'badge-warn',en_gestion:'badge-brand',aprobada:'badge-ok',recibida:'badge-teal',rechazada:'badge-danger',en_camino:'badge-brand'};
  const elbl={pendiente:'⏳ Pendiente',en_gestion:'🔄 En gestión',aprobada:'✅ Aprobada',recibida:'📦 Recibida',rechazada:'❌ Rechazada',en_camino:'🚚 En camino'};

  tbody.innerHTML = grupos.map(s=>{
    const estadoBadge = `<span class="badge ${ecls[s.estado]||'badge-gray'}">${elbl[s.estado]||s.estado}</span>`;

    // Pedido agrupado
    if(s.esGrupo){
      const items = s.items||[];
      const total = items.reduce((a,i)=>a+parseInt(i.cantidad||0),0);
      const pid   = s.pedidoAgrupadoId||s.id;
      if(rol==='distribuidor'){
        return `<tr class="fade-row ![border-top:2px_solid_#E2E8F0]">
          <td><div class="!text-[11px] !font-bold !text-[#7C3AED]">📦 Pedido múltiple (${items.length} productos)</div>
            <button onclick="verDetallePedidoAgrupado('${pid}')" class="btn-sm ![background:#E0F6FF] !text-[#0369A1] !text-[11px] !mt-[4px]">🔍 Ver detalle</button></td>
          <td><span class="badge badge-brand">${esc(s.destino)}</span></td>
          <td style="font-weight:700;">${total} <span class="!text-[11px] !text-[#94A3B8]">uds.</span></td>
          <td>${estadoBadge}</td><td>—</td><td class="!text-[12px] !text-[#94A3B8]">${fmtDate(s.fecha)}</td>
        </tr>`;
      } else {
        return `<tr class="fade-row ![border-top:2px_solid_#E2E8F0]">
          <td><div class="!text-[11px] !font-bold !text-[#7C3AED]">📦 Pedido múltiple (${items.length} productos)</div>
            <button onclick="verDetallePedidoAgrupado('${pid}')" class="btn-sm ![background:#E0F6FF] !text-[#0369A1] !text-[11px] !mt-[4px]">🔍 Ver detalle</button></td>
          <td style="font-weight:700;">${total} <span class="!text-[11px] !text-[#94A3B8]">uds.</span></td>
          <td>${estadoBadge}</td><td>${_notaMotivoGrupo(pid, items)}</td><td class="!text-[12px] !text-[#94A3B8]">${fmtDate(s.fecha)}</td><td>${items.length&&items.every(i=>i.estado==='pendiente')?`<button onclick="cancelarMiPedido('agrupado','${pid}')" class="btn-sm ![background:#FEE2E2] !text-[#B91C1C]">✕ Cancelar</button>`:''}</td>
        </tr>`;
      }
    }

    // Solicitud individual
    const suf = s.unidadEnvio==='metros' ? 'mts.' : sufijo(s.ref);
    const nota = s.nota||s.motivo||'';

    if(rol==='distribuidor'){
      return `<tr class="fade-row">
        <td><span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_6px] !rounded-[5px] !mr-[5px]">${esc(s.ref)}</span>
            <span class="!font-semibold">${esc(s.nombre)}</span></td>
        <td><span class="badge badge-brand">${esc(s.destino)}</span></td>
        <td class="!font-semibold">${s.cantidad} <span class="!text-[11px] !text-[#94A3B8]">${suf}</span></td>
        <td>${estadoBadge}</td>
        <td class="!text-[12px] !text-[#64748B]">${escU(s.solicitadoPor||'')}</td>
        <td class="!text-[12px] !text-[#94A3B8]">${fmtDate(s.fecha)}</td>
      </tr>`;
    } else {
      // Para municipio/tecnico/persona: mostrar qué pidieron y su estado
      // Botón confirmar recibido si está "entregado"
      let accion = '';
      if(s.estado==='en_camino'){
        accion = `<span class="!text-[11px] !text-[#0C6EDE] !font-semibold">🚚 En camino…</span>`;
      } else if(s.estado==='aprobada'){
        accion = `<span class="!text-[11px] !text-[#16A871] !font-semibold">✅ Listo para envío</span>`;
      } else if(s.estado==='recibida'){
        accion = `<span class="!text-[11px] !text-[#0F766E] !font-semibold">📦 Recibido</span>`;
      } else if(s.estado==='rechazada'){
        accion = `<span class="!text-[11px] !text-[#B91C1C]">${nota?`"${esc(nota)}"`:''}</span>`;
      }
      else if(s.estado==='pendiente' && !s.pedidoAgrupadoId){
        accion = `<button onclick="cancelarMiPedido('${s._esPedido?'pedido':'solicitud'}','${s.id}')" class="btn-sm ![background:#FEE2E2] !text-[#B91C1C]">✕ Cancelar</button>`;
      }
      return `<tr class="fade-row">
        <td>
          <span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_6px] !rounded-[5px] !mr-[5px]">${esc(s.ref)}</span>
          <span class="!font-semibold">${esc(s.nombre)}</span>
        </td>
        <td class="!font-semibold">${s.cantidad} <span class="!text-[11px] !text-[#94A3B8]">${suf}</span></td>
        <td>${estadoBadge}</td>
        <td class="!text-[12px] !text-[#64748B]">${nota&&s.estado!=='rechazada'?esc(nota):'—'}</td>
        <td class="!text-[12px] !text-[#94A3B8]">${fmtDate(s.fecha)}</td>
        <td>${accion}</td>
      </tr>`;
    }
  }).join('');
}

/* Cancelar un pedido propio que aún no ha sido aprobado/rechazado */
function cancelarMiPedido(tipo, id){
  const ep = tipo==='pedido' ? 'pedidos' : tipo==='agrupado' ? 'pedidos_agrupados' : 'solicitudes';
  mostrarConfirmar({
    icono:'✕', color:'#DC2626',
    titulo:'¿Cancelar este pedido?',
    desc:'Se eliminará tu pedido pendiente y podrás volver a pedir. Solo se puede cancelar mientras nadie lo haya aprobado.',
    btnTxt:'Sí, cancelar pedido', btnColor:'#DC2626',
    withNotes:true, notesRequired:false,
    notesLabel:'📝 Nota <span class="!text-[#94A3B8] !font-normal">(opcional)</span>',
    notesPlaceholder:'Ej: me equivoqué de producto, ya no lo necesito…',
    onConfirmar: async(nota)=>{
      try{
        await _api(ep,'cancelar',{id,nota:nota||''});
        await Promise.all([_recargarSolicitudes(), _recargarPedidos(), _recargarPedidosAgrupados()]);
        if(typeof renderMisSolicitudes==='function') renderMisSolicitudes();
        if(typeof renderMisPedidos==='function') renderMisPedidos();
        if(typeof renderSolicitudesMunicipio==='function') renderSolicitudesMunicipio();
        if(typeof renderStats==='function') renderStats();
        if(typeof updateNotifBadges==='function') updateNotifBadges();
        toast('Pedido cancelado. Ya puedes volver a pedir.','success');
      }catch(e){toast(e.message||'No se pudo cancelar','error');}
    }
  });
}

let _tabPed='todos';
function setTabPed(t){
  _tabPed=t;
  ['todos','pendiente','en_gestion','atendido','rechazado','en_camino','recibida'].forEach(id=>{const b=document.getElementById('tabPed_'+id);if(b)b.classList.toggle('active',id===t);});
  ['todos','pendiente','en_gestion','atendido','rechazado'].forEach(id=>{
    document.getElementById('tabPed_'+id)?.classList.toggle('active',id===t);
  });
  renderSolicitudesMunicipio();
}
function limpiarFiltrosPed(){
  ['filtroPedProducto','filtroPedFechaDesde','filtroPedFechaHasta'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  const m=document.getElementById('filtroPedMunicipio');if(m)m.value='';
  const mb=document.getElementById('filtroPedMunicipioBuscar');if(mb)mb.value='';
  const t=document.getElementById('filtroPedTipo');if(t)t.value='';
  const tu=document.getElementById('filtroPedUsuario');if(tu)tu.value='';
  const tb=document.getElementById('filtroPedUsuarioBuscar');if(tb)tb.value='';
  _tabPed='todos';
  ['todos','pendiente','en_gestion','atendido','rechazado'].forEach(id=>document.getElementById('tabPed_'+id)?.classList.toggle('active',id==='todos'));
  renderSolicitudesMunicipio();
}

function _filtrarPedDestinos(){
  const q = (document.getElementById('filtroPedMunicipioBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('filtroPedMunicipioLista');
  if(!lista) return;
  const destinos = [...new Set([
    ...getSolicitudes().map(s=>s.destino),
    ...getPedidosAgrupados().map(p=>p.destino),
    ...(getPedidosMun()||[]).map(p=>p.municipio)
  ].filter(Boolean))].sort();
  const filtrados = destinos.filter(d=>!q||d.toLowerCase().includes(q));
  let html = `<div onclick="_seleccionarPedDestino('')" style="padding:8px 12px;cursor:pointer;font-size:13px;font-weight:600;color:#0C6EDE;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">Todos</div>`;
  html += filtrados.length
    ? filtrados.map(d=>`<div onclick="_seleccionarPedDestino('${esc(d).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">${esc(d)}</div>`).join('')
    : `<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>`;
  lista.innerHTML = html;
  lista.style.display='block';
}
function _seleccionarPedDestino(destino){
  document.getElementById('filtroPedMunicipio').value = destino;
  document.getElementById('filtroPedMunicipioBuscar').value = destino || '';
  document.getElementById('filtroPedMunicipioLista').style.display='none';
  renderSolicitudesMunicipio();
}
document.addEventListener('click', function(e){
  const cont=document.getElementById('filtroPedMunicipioLista');
  const inp=document.getElementById('filtroPedMunicipioBuscar');
  if(cont && inp && !inp.contains(e.target) && !cont.contains(e.target)) cont.style.display='none';
});

function _filtrarPedUsuarios(){
  const q = (document.getElementById('filtroPedUsuarioBuscar')?.value||'').toLowerCase().trim();
  const lista = document.getElementById('filtroPedUsuarioLista');
  if(!lista) return;
  const tipoLbl = {municipio:'Municipio',tecnico:'Técnico',persona:'Persona'};
  const personas = getUsuarios()
    .filter(u=>['municipio','tecnico','persona'].includes(u.rol))
    .filter(u=>{
      const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
      return !q || nombreCompleto.toLowerCase().includes(q) || u.usuario.toLowerCase().includes(q) || (u.sede||'').toLowerCase().includes(q);
    })
    .sort((a,b)=>(a.nombre||a.usuario).localeCompare(b.nombre||b.usuario));
  if(!personas.length){
    lista.innerHTML = '<div class="!p-[12px] !text-[#94A3B8] !text-[13px] !text-center">Sin coincidencias.</div>';
  } else {
    lista.innerHTML = personas.map(u=>{
      const nombreCompleto = `${u.nombre||''} ${u.apellido||''}`.trim() || u.usuario;
      return `<div onclick="_seleccionarPedUsuario('${esc(u.usuario)}','${esc(nombreCompleto).replace(/'/g,"\\'")}')" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #F1F5F9;" onmouseover="this.style.background='#F8FAFC'" onmouseout="this.style.background='white'">
        <div class="!font-semibold">${esc(nombreCompleto)}</div>
        <div class="!text-[11px] !text-[#94A3B8]">${tipoLbl[u.rol]||u.rol} · ${esc(u.sede||'—')}</div>
      </div>`;
    }).join('');
  }
  lista.style.display='block';
}
function _seleccionarPedUsuario(usuario,nombre){
  document.getElementById('filtroPedUsuario').value = usuario;
  document.getElementById('filtroPedUsuarioBuscar').value = nombre;
  document.getElementById('filtroPedUsuarioLista').style.display='none';
  renderSolicitudesMunicipio();
}
document.addEventListener('click', function(e){
  const cont=document.getElementById('filtroPedUsuarioLista');
  const inp=document.getElementById('filtroPedUsuarioBuscar');
  if(cont && inp && !inp.contains(e.target) && !cont.contains(e.target)) cont.style.display='none';
});

function renderSolicitudesMunicipio(){
  const tbody=document.getElementById('tablaSolicitudesMunicipio');if(!tbody)return;

  // Cruce con el seguimiento real — una vez que se despacha (en_camino), el
  // pedido/solicitud ya no debe seguir mostrando "Aprobado" como si nada
  // hubiera pasado; su propio registro no se actualiza solo, así que se
  // busca el envío real correspondiente para mostrar el estado verdadero.
  const _segPorRef = {};
  (_seguimiento||[]).forEach(e=>{
    if(!e.referencia_id) return;
    const clave = `${e.tipo}:${e.referencia_id}`;
    // Si hay varios envíos para la misma referencia, se queda con el más avanzado/reciente.
    const actual = _segPorRef[clave];
    if(!actual || (e.id||0) > (actual.id||0)) _segPorRef[clave] = e;
  });
  const _estadoReal = (estadoBase, tipo, refId) => {
    const seg = _segPorRef[`${tipo}:${refId}`];
    if(!seg) return estadoBase;
    if(seg.estado==='en_camino') return 'en_camino';
    if(seg.estado==='entregado') return 'entregado';
    if(seg.estado==='recibido')  return 'recibido';
    return estadoBase;
  };

  // Pedidos individuales (tabla pedidos_municipio)
  const pedidosInd = getPedidosMun().map(p=>({
    ...p,
    estado: _estadoReal(p.estado, 'pedido', p.id),
  }));

  // Solicitudes de TODOS los orígenes (municipio/técnico/persona Y
  // distribuidor) — antes se excluía al distribuidor porque tenía su
  // propia pantalla separada; ahora todo vive junto aquí.
  const solMun = getSolicitudes()
    .filter(s=>!s.pedidoAgrupadoId)
    .map(s=>({
      id: s.id,
      ref: s.ref,
      nombre: s.nombre,
      municipio: s.destino,
      cantidad: s.cantidad,
      unidadPedido: s.unidadEnvio,
      solicitado_por: s.solicitadoPor,
      solicitadoPor: s.solicitadoPor,
      nota: s.nota || '',
      estado: _estadoReal(s.estado, 'solicitud', s.id),
      fecha: s.fecha,
      esSolicitud: true,
      solicitudId: s.id,
    }));

  // Pedidos agrupados — todos los estados, de cualquier origen (antes se
  // excluían los del distribuidor porque tenían su propia pantalla).
  const pedAgrup = getPedidosAgrupados()
    .map(p=>({
    id: p.id,
    ref: '📦',
    nombre: `Pedido múltiple (${p.total_items||'?'} productos)`,
    municipio: p.destino,
    cantidad: p.total_items||0,
    unidadPedido: 'pedido',
    solicitado_por: p.solicitado_por,
    estado: (()=>{
      const base = _estadoPedAgrupBase(p);
      // Si TODOS los productos de este pedido ya están en camino (o más
      // avanzados) en su seguimiento real, se refleja aquí también.
      const items = p.items||[];
      if(base==='aprobada' && items.length){
        const estados = items.map(it=>_estadoReal('aprobada','solicitud',it.id));
        const orden = {aprobada:0, en_camino:1, entregado:2, recibido:3};
        const peor = estados.reduce((min,e)=> (orden[e]??0) < (orden[min]??0) ? e : min, estados[0]);
        if((orden[peor]??0) > 0) return peor;
      }
      return base;
    })(),
    fecha: p.fecha,
    esPedidoAgrupado: true,
    motivo: _motivoDecisionPedAgrup(p),
    items: p.items||[],
  }));

  let pedidos = [...pedidosInd, ...solMun, ...pedAgrup]
    .sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));

  // (el buscador de destino se llena dinámicamente al escribir — ver _filtrarPedDestinos)

  // Contadores
  const pend=pedidos.filter(p=>p.estado==='pendiente').length;
  const rech=pedidos.filter(p=>p.estado==='rechazado'||p.estado==='rechazada').length;
  const badge=document.getElementById('badgePedidosMunicipio');
  if(badge)badge.textContent=pend?pend+' pendientes':'';
  const apro=pedidos.filter(p=>p.estado==='atendido'||p.estado==='aprobada'||p.estado==='aprobado'||p.estado==='parcial').length;
  const st=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v||'';};
  st('cntPedPend',pedidos.filter(p=>p.estado==='pendiente').length||'');
  st('cntPedRech',rech||'');
  st('cntPedApro',apro||'');

  // Aplicar filtros
  const q=(document.getElementById('filtroPedProducto')?.value||'').toLowerCase();
  const mun=document.getElementById('filtroPedMunicipio')?.value||'';
  const tipoUsr=document.getElementById('filtroPedTipo')?.value||'';
  const usrSel=document.getElementById('filtroPedUsuario')?.value||'';
  const desde=document.getElementById('filtroPedFechaDesde')?.value;
  const hasta=document.getElementById('filtroPedFechaHasta')?.value;

  const _rolPorUsuarioPed = Object.fromEntries(getUsuarios().map(u=>[u.usuario,u.rol]));

  if(_tabPed==='atendido')
    pedidos=pedidos.filter(p=>['atendido','aprobada','aprobado','parcial'].includes(p.estado));
  else if(_tabPed==='pendiente')
    pedidos=pedidos.filter(p=>p.estado==='pendiente');
  else if(_tabPed==='en_camino')
    pedidos=pedidos.filter(p=>p.estado==='en_camino');
  else if(_tabPed==='recibida')
    pedidos=pedidos.filter(p=>p.estado==='recibida'||p.estado==='recibido');
  else if(_tabPed==='rechazado')
    pedidos=pedidos.filter(p=>p.estado==='rechazado'||p.estado==='rechazada');
  else if(_tabPed!=='todos')
    pedidos=pedidos.filter(p=>p.estado===_tabPed);
  if(q) pedidos=pedidos.filter(p=>(p.nombre||'').toLowerCase().includes(q)||(p.ref||'').toLowerCase().includes(q)
    ||(p.items||[]).some(i=>(i.nombre||'').toLowerCase().includes(q)));
  if(mun) pedidos=pedidos.filter(p=>p.municipio===mun);
  if(tipoUsr) pedidos=pedidos.filter(p=>_rolPorUsuarioPed[p.solicitado_por||p.solicitadoPor]===tipoUsr);
  if(usrSel) pedidos=pedidos.filter(p=>(p.solicitado_por||p.solicitadoPor)===usrSel);
  if(desde) pedidos=pedidos.filter(p=>p.fecha&&p.fecha.slice(0,10)>=desde);
  if(hasta) pedidos=pedidos.filter(p=>p.fecha&&p.fecha.slice(0,10)<=hasta);

  // Resaltado amarillo de la coincidencia de búsqueda
  const hlPed = (txt) => {
    txt = String(txt==null?'':txt);
    if(!q || !txt) return esc(txt);
    const idx = txt.toLowerCase().indexOf(q);
    if(idx<0) return esc(txt);
    return esc(txt.slice(0,idx))
      + `<mark class="![background:#FEF08A] !text-[#713F12] !rounded-[3px] !p-[0_2px]">${esc(txt.slice(idx, idx+q.length))}</mark>`
      + esc(txt.slice(idx+q.length));
  };

  pedidos.sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));  if(badge)badge.textContent=pend>0?pend+' pendientes':'';
  if(!pedidos.length){tbody.innerHTML=`<tr><td class="!p-[32px] !text-center !text-[#94A3B8] !text-[13px]" colspan="7">No hay pedidos de municipios.</td></tr>`;return;}

  const ecls={pendiente:'badge-warn',en_gestion:'badge-brand',atendido:'badge-ok',rechazado:'badge-danger',en_camino:'badge-brand',entregado:'badge-brand',recibida:'badge-ok',recibido:'badge-ok',aprobada:'badge-ok'};
  const elbl={pendiente:'Pendiente',en_gestion:'⏳ En gestión',atendido:'✅ Aprobada',rechazado:'❌ Rechazado',aprobada:'✅ Aprobada',rechazada:'❌ Rechazada',aprobado:'✅ Aprobada',en_camino:'🚚 En camino',entregado:'🚚 Entregado',recibida:'✅ Recibida',recibido:'✅ Recibido'};

  // Botón de WhatsApp para esta bandeja (los campos vienen con nombres
  // distintos según el origen: pedido individual, solicitud o agrupado).
  const _waBotonPed = (s) => {
    if (!tienePermiso('usar_whatsapp')) return '';
    const solicitante = s.solicitadoPor || s.solicitado_por;
    const u = _waUsuarioDe(solicitante);
    const tel = u?.telefono;
    if (!tel) return '';
    const nombreU = (u?.nombre ? `${u.nombre} ${u.apellido||''}`.trim() : solicitante);
    const destino = s.destino || s.municipio;
    let msg;
    if (s.esPedidoAgrupado || s._esPedidoAgrupado) {
      const items = s.items || [];
      const listaItems = items.map(i => `• ${i.nombre} — ${i.cantidad} ${i.unidad_envio==='metros'?'mts.':'uds.'}`).join('\n');
      msg = `Hola ${nombreU}, tengo una pregunta sobre tu pedido para ${destino} (${fmtDate(s.fecha)}):\n${listaItems || `${s.cantidad} producto(s)`}`;
    } else {
      const unidad = (s.unidadPedido||s.unidadEnvio)==='metros' ? 'mts.' : 'uds.';
      msg = `Hola ${nombreU}, tengo una pregunta sobre tu solicitud de ${s.cantidad} ${unidad} de "${s.nombre}" para ${destino} (${fmtDate(s.fecha)}).`;
    }
    return `<a href="${_waLink(tel, msg)}" target="_blank" rel="noopener" class="btn-sm ![background:#DCFCE7] !text-[#166534] ![text-decoration:none] !inline-flex !items-center !gap-[3px]">📱 WhatsApp</a>`;
  };

  tbody.innerHTML=pedidos.map(s=>{
    let acciones='';
    // Botón Ver detalle siempre visible para pedidos agrupados
    const _btnDetalle = s.esPedidoAgrupado
      ? `<button onclick="verDetallePedidoAgrupado('${s.id}')" class="btn-sm ![background:#E0F6FF] !text-[#0369A1] !mb-[3px]">🔍 Ver detalle</button><br>`
      : '';
    if(s.esPedidoAgrupado){
      // Siempre mostrar Ver detalle para pedidos agrupados
      acciones = _btnDetalle;
    }
    if(s.estado==='pendiente'||s.estado==='en_gestion'){
      if(sesion.rol==='superadmin'||tienePermiso('aprobar_pedidos')){
        if(s.esPedidoAgrupado){
          acciones=`<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
              <button onclick="verDetallePedidoAgrupado('${s.id}')" class="btn-sm ![background:#E0F6FF] !text-[#0369A1]">🔍 Ver detalle</button>
              <button onclick="abrirGestionPedido('${s.id}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">📋 Gestionar</button>
            </div>
            ${_waBotonPed(s)}
          </div>`;
        } else if(s.esSolicitud){
          acciones=`<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
              <button onclick="aprobarSolicitud('${s.solicitudId}',${s.cantidad},'${s.unidadPedido||s.unidadEnvio||'unidad'}','${esc(s.nombre)}','${s.ref}','${esc(s.nota||s.justificacion||'')}')" class="btn-sm ![background:#EAF3DE] !text-[#166534]">✓ Aprobar</button>
              <button onclick="rechazarSolicitud('${s.solicitudId}')" class="btn-sm ![background:#FCEBEB] !text-[#B91C1C]">✕ Rechazar</button>
            </div>
            ${_waBotonPed(s)}
          </div>`;
        } else {
          acciones=`<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
              <button onclick="aprobarPedidoDirecto('${s.id}')" class="btn-sm ![background:#2DB82D] ![color:white] !font-semibold">✓ Aprobar</button>
              <button onclick="rechazarPedidoMunicipio('${s.id}')" class="btn-sm ![background:#FCEBEB] !text-[#B91C1C]">✕ Rechazar</button>
            </div>
            ${_waBotonPed(s)}
          </div>`;
        }
      } else if(sesion.rol==='distribuidor' && s.estado==='pendiente' && !tienePermiso('aprobar_pedidos')){
        if(s.esPedidoAgrupado){
          acciones=`<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
              <button onclick="verDetallePedidoAgrupado('${s.id}')" class="btn-sm ![background:#E0F6FF] !text-[#0369A1]">🔍 Ver detalle</button>
            </div>
            ${_waBotonPed(s)}
          </div>`;
        } else if(s.esSolicitud){
          acciones=`<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
              <button onclick="verDetalleSolicitudIndividual('${s.solicitudId}')" class="btn-sm ![background:#E0F6FF] !text-[#0369A1]">👁 Ver detalle</button>
              ${tienePermiso('rechazar_envios')?`<button onclick="rechazarSolicitud('${s.solicitudId}')" class="btn-sm ![background:#FCEBEB] !text-[#B91C1C]">✕ Rechazar</button>`:''}
            </div>
            ${_waBotonPed(s)}
          </div>`;
        } else {
          // Distribuidor NUNCA aprueba/atiende — solo superadmin. El
          // distribuidor únicamente despacha lo que ya fue aprobado
          // (desde Seguimiento), así que aquí solo ve el detalle.
          acciones=`<div style="display:flex;flex-direction:column;gap:6px;align-items:flex-start;">
            <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">
              <span class="!text-[11px] !text-[#94A3B8] ![font-style:italic]">⏳ Esperando aprobación del admin</span>
              ${tienePermiso('rechazar_envios')?`<button onclick="rechazarPedidoMunicipio('${s.id}')" class="btn-sm ![background:#FCEBEB] !text-[#B91C1C]">Rechazar</button>`:''}
            </div>
            ${_waBotonPed(s)}
          </div>`;
        }
      }
    }
    return `<tr class="fade-row">
      <td>
        <span class="![font-family:monospace] !text-[11px] ![background:#F1F5F9] !p-[2px_6px] !rounded-[5px] !mr-[5px]">${esc(s.ref)}</span>
        <span class="!font-semibold">${esc(s.nombre)}</span>
        ${(q&&s.items&&s.items.length)?`<div class="!text-[11px] !text-[#64748B] !mt-[2px]">${s.items.map(i=>hlPed(i.nombre)).join(', ')}</div>`:''}
        ${(s.nota||s.justificacion)?`<div style="font-size:11px;color:#64748B;font-style:italic;margin-top:3px;background:#F8FAFC;padding:3px 7px;border-radius:5px;border-left:3px solid #CBD5E1;">💬 ${esc(s.nota||s.justificacion)}</div>`:''}
      </td>
      <td><span class="badge badge-purple">${esc(s.sede_actual||s.municipio)}</span></td>
      <td class="!font-semibold">${s.cantidad} <span class="!text-[11px] !font-normal !text-[#94A3B8]">${s.unidadPedido==='metros'?'mts.':'uds.'}</span></td>
      <td class="!text-[12px] !text-[#64748B]">${escU(s.solicitadoPor||s.solicitado_por||'—')}</td>
      <td class="!text-[12px] !text-[#94A3B8] !whitespace-nowrap">${fmtDate(s.fecha)}</td>
      <td>
        <span class="badge ${ecls[s.estado]||'badge-gray'}">${elbl[s.estado]||s.estado}</span>
        ${s.motivo?`<div class="!text-[11px] !text-[#E24B4A] !mt-[2px]">${esc(s.motivo)}</div>`:''}
      </td>
      <td>${acciones}</td>

    </tr>`;
  }).join('');
}

async function aprobarPedidoDirecto(id){
  mostrarConfirmar({
    icono:'✓', color:'#16A871',
    titulo:'Aprobar pedido',
    desc:'¿Apruebas este pedido? Puedes escribir una observación abajo antes de confirmar.',
    btnTxt:'Sí, aprobar', btnColor:'#16A871',
    withNotes:true,
    notesLabel:'📝 Observación <span class="!text-[#94A3B8] !font-normal">(opcional)</span>',
    notesPlaceholder:'Ej: se aprueba con cambio de cantidad, prioridad alta…',
    onConfirmar: async(observacion)=>{
      try{
        const res=await _api('pedidos','aprobar_directo',{id, observacion: observacion||''});
        await Promise.all([_recargarPedidos(),_recargarProductos(),_recargarHistorial(),_recargarSolicitudes(),_recargarPedidosAgrupados()]);
        renderSolicitudesMunicipio();renderMisSolicitudes();renderStats();renderHistorial();updateNotifBadges();
        toast(`✓ Aprobado — ${res.cantidad} uds. de "${res.producto}" → ${res.municipio}`,'success');
        if(res&&res.aviso) setTimeout(()=>mostrarAlertaBloqueo(res.aviso.replace(/^⚠️ /,''),'ONT insuficientes','warn'),400);
      }catch(e){toast(e.message||'Error al aprobar pedido','error');}
    }
  });
}

async function atenderPedidoMunicipio(id){
  mostrarConfirmar({
    icono:'✓', color:'#16A871',
    titulo:'Atender solicitud',
    desc:'¿Confirmas que atendiste esta solicitud? Pasará al administrador para aprobación final.',
    btnTxt:'Sí, atender',
    btnColor:'#16A871',
    withNotes:true,
    onConfirmar: async(nota)=>{
      try{
        const res=await _api('pedidos','atender',{id, nota: nota||''});
        await Promise.all([_recargarPedidos(),_recargarSolicitudes()]);
        renderSolicitudesMunicipio();renderMisSolicitudes();renderHistorial();renderStats();updateNotifBadges();
        if(res.estado==='rechazado') toast(`Sin stock suficiente: ${res.motivo||''}`, 'error');
        else toast('Pedido escalado al superadmin ✓','success');
      }catch(e){toast(e.message||'Error al atender pedido','error');}
    }
  });
}

let _rechazarPedidoId=null;

async function rechazarPedidoMunicipio(id){
  _rechazarPedidoId=id;
  const input=document.getElementById('rechazoMotivoInput');
  if(input) input.value='';
  // Conectar botón confirmar
  const btn=document.getElementById('btnConfirmarRechazo');
  if(btn){
    btn.onclick=async()=>{
      const motivo=(document.getElementById('rechazoMotivoInput')?.value||'').trim();
      try{
        await _api('pedidos','rechazar',{id:_rechazarPedidoId,motivo});
        await Promise.all([_recargarPedidos(), _recargarHistorial()]);
        cerrarModal('modalRechazoMotivo');
        renderSolicitudesMunicipio(); renderHistorial(); renderStats(); updateNotifBadges();
        toast('Pedido rechazado','success');
      }catch(e){toast(e.message||'Error','error');}
    };
  }
  const modal=document.getElementById('modalRechazoMotivo');
  if(modal&&!modal._listenerAdded){
    modal.addEventListener('click',e=>{if(e.target===modal)cerrarModal('modalRechazoMotivo');});
    modal._listenerAdded=true;
  }
  modal?.classList.add('open');
  setTimeout(()=>document.getElementById('rechazoMotivoInput')?.focus(),200);
}

/* ════════════════════════════════════════════════
   PEDIDO MUNICIPIO → NEIVA
════════════════════════════════════════════════ */
async function abrirSolicitarOntDesdeStock(modeloNombre){
  let disponibleAlmacen = 0;
  try{
    const res = await fetch('api/cajas.php?action=onts_disponibles_modelo',{credentials:'same-origin'});
    const data = await res.json();
    const fila = (data?.almacen||[]).find(r=>r.modelo===modeloNombre);
    disponibleAlmacen = fila ? parseInt(fila.cantidad)||0 : 0;
  }catch(e){}
  window._pedidoProductoVirtual = {
    ref: 'ONT::'+modeloNombre,
    nombre: '📡 ONT '+modeloNombre,
    unidad: 'unidad',
    descripcion: '',
    _stockEspecial: disponibleAlmacen,
  };
  pedidoIndex = -999; // marcador: producto virtual, no viene de getProductos()
  const p = window._pedidoProductoVirtual;
  const s=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v;};
  s('pedidoNombreShow',`${p.ref} — ${p.nombre}`);
  s('pedidoStockShow',`0 uds.`);
  s('pedidoStockNeiva',`${disponibleAlmacen} uds.`);
  const inputCant = document.getElementById('cantidadPedido');
  if(inputCant){ inputCant.style.borderColor = ''; }
  s('cantidadPedido', '');
  s('justificacionPedido','');
  const badge=document.getElementById('pedidoUnidadBadge');
  const hidden=document.getElementById('pedidoUnidadHidden');
  const sufEl=document.getElementById('pedidoUnidadSufijo');
  if(badge) badge.textContent='📦 Por unidad';
  if(hidden) hidden.value='unidad';
  if(sufEl)  sufEl.textContent='(uds.)';
  document.getElementById('modalPedido').classList.add('open');
  setTimeout(()=>document.getElementById('cantidadPedido')?.focus(),200);
}
function abrirPedidoMunicipio(ref){
  // Igual que en abrirSolicitud/abrirEnvioDirecto: referencia estable, no
  // posición que puede quedar desactualizada.
  const idx = getProductos().findIndex(x => x.ref === ref);
  if (idx === -1) { toast('Ese producto ya no está disponible — actualiza la página.', 'error'); return; }
  pedidoIndex=idx;
  const p=getProductos()[idx];if(!p)return;
  const s=(id,v)=>{const e=document.getElementById(id);if(e)e.value=v;};
  const unidad=p.unidad||'unidad';
  const sufijo=unidad==='metros'?'mts.':'uds.';
  // Si es "por rollo" (metrosPorUnidad definido), todo se muestra y se
  // pide en ROLLOS, no en metros sueltos — igual que en Enviar/Solicitar.
  const sufijoReal = p.metrosPorUnidad ? 'rollos' : sufijo;
  const aRollos = (metros) => p.metrosPorUnidad ? valorMostrar(p, metros) : metros;

  const miStock    = p.stockUsuario || 0;
  const stockNeiva = _stockCentral(p);
  s('pedidoNombreShow',`${p.ref} — ${p.nombre}`);
  s('pedidoStockShow',`${aRollos(miStock)} ${sufijoReal}`);
  s('pedidoStockNeiva',`${aRollos(stockNeiva)} ${sufijoReal}`);
  const inputCant = document.getElementById('cantidadPedido');
  if(inputCant){ inputCant.style.borderColor = ''; }
  s('cantidadPedido', miStock > 0 ? aRollos(miStock) : '');
  s('justificacionPedido','');

  // Mostrar unidad fija — no editable
  const badge=document.getElementById('pedidoUnidadBadge');
  const hidden=document.getElementById('pedidoUnidadHidden');
  const sufEl=document.getElementById('pedidoUnidadSufijo');
  if(badge) badge.textContent = p.metrosPorUnidad ? '📦 Por rollo' : (unidad==='metros'?'📏 Metros':'📦 Por unidad');
  if(hidden) hidden.value=unidad;
  if(sufEl)  sufEl.textContent='('+sufijoReal+')';

  document.getElementById('modalPedido').classList.add('open');
  setTimeout(()=>document.getElementById('cantidadPedido')?.focus(),200);
}

async function cargarDistribuidores(ref, cantidad){
  const wrap = document.getElementById('pedidoDistribuidores');
  if(!wrap) return;
  wrap.innerHTML = '<div class="!text-center !text-[#94A3B8] !text-[13px] !p-[12px]">Buscando distribuidores...</div>';
  try {
    const lista = await _api('pedidos','distribuidores_con_stock',null,`ref=${encodeURIComponent(ref)}&cantidad=${cantidad}`);
    if(!lista || !lista.length){
      wrap.innerHTML = '<div class="!text-center !text-[#B91C1C] !text-[13px] !p-[12px] ![background:#FCEBEB] !rounded-[10px]">⚠️ Ningún distribuidor tiene suficiente stock para esta cantidad.</div>';
      return;
    }
    wrap.innerHTML = lista.map((d,i)=>`
      <label style="display:flex;align-items:center;gap:12px;border:1.5px solid #E2E8F0;border-radius:12px;padding:12px 14px;cursor:pointer;transition:all .15s;" 
             onmouseover="this.style.borderColor='#0C6EDE'" onmouseout="if(!document.getElementById('dist_${i}').checked)this.style.borderColor='#E2E8F0'">
        <input type="radio" id="dist_${i}" name="distribuidorPedido" value="${d.sede}" 
               style="accent-color:#0C6EDE;" onchange="document.querySelectorAll('[name=distribuidorPedido]').forEach((r,j)=>{r.closest('label').style.borderColor=r.checked&&j===${i}?'#0C6EDE':'#E2E8F0';})">
        <div class="![flex:1]">
          <div class="!font-bold !text-[14px]">${esc(d.nombre||d.usuario)}</div>
          <div class="!text-[12px] !text-[#64748B]">Sede: ${esc(d.sede)}</div>
        </div>
        <div class="!text-right">
          <div class="!font-bold !text-[16px] !text-[#16A871]">${d.stock}</div>
          <div class="!text-[11px] !text-[#94A3B8]">disponibles</div>
        </div>
      </label>`).join('');
    // Auto-seleccionar el primero
    const first = wrap.querySelector('input[type=radio]');
    if(first){ first.checked=true; first.closest('label').style.borderColor='#0C6EDE'; }
  } catch(e){
    wrap.innerHTML = '<div class="!text-[#B91C1C] !text-[13px] !p-[8px]">Error al cargar distribuidores.</div>';
  }
}

async function enviarPedidoMunicipio(){
  const cantIngresada=parseInt(document.getElementById('cantidadPedido')?.value);

  const just=(document.getElementById('justificacionPedido')?.value||'').trim();
  const unidadPedido=document.getElementById('pedidoUnidadHidden')?.value||'unidad';
  if(!cantIngresada||cantIngresada<1){toast('Ingresa una cantidad válida.','error');return;}
  const p = pedidoIndex===-999 ? window._pedidoProductoVirtual : getProductos()[pedidoIndex];
  if(!p){toast('Producto no encontrado.','error');return;}
  // Si es "por rollo", lo que se escribió son ROLLOS — se convierte a
  // metros antes de guardar (igual que en Enviar/Solicitar directo).
  const cant = p.metrosPorUnidad ? cantIngresada * p.metrosPorUnidad : cantIngresada;
  const sufijo = p.metrosPorUnidad ? 'rollos' : (unidadPedido==='metros'?'mts.':'uds.');
  try{
    const res=await _api('pedidos','crear',{ref:p.ref,nombre:p.nombre,descripcion:p.descripcion||'',cantidad:cant,unidadPedido,justificacion:just,municipio:sesion.sede});
    await _recargarPedidos();
    cerrarModal('modalPedido');renderMisPedidos();renderStats();updateNotifBadges();
    if(res.estado==='rechazado') toast(`Rechazado: ${res.motivo}`,'error');
    else toast(`Pedido enviado: ${cantIngresada} ${sufijo} de "${p.nombre}" al almacén ✓`,'success');
  }catch(e){toast(e.message||'Error al enviar pedido','error');}
}

/* ════════════════════════════════════════════════
   PEDIDO MÚLTIPLE — municipio / técnico
════════════════════════════════════════════════ */
let _pmCantidades = {}; // {ref: cantidad}

/* ════════════════════════════════════════════════
   PEDIDO MÚLTIPLE — nuevo diseño con buscador y carrito
════════════════════════════════════════════════ */
let _pmProds = []; // todos los productos
let _pmFiltro = ''; // texto de búsqueda actual

async function abrirPedidoMultiple(){
  _pmCantidades = {};
  _pmFiltro = '';

  // Productos normales del catálogo
  const prodsNormales = getProductos();

  // ONTs: se agregan como "producto" más en el mismo catálogo/carrito,
  // usando el stock real (tabla ont_seriales) vía _stockEspecial.
  // Solo para municipio — es la oficina quien solicita ONT, no técnico/persona.
  let prodsOnt = [];
  if(sesion?.rol==='municipio'){
    try{
      await cargarModelosOnt();
      const resStock = await fetch('api/cajas.php?action=onts_disponibles_modelo', {credentials:'same-origin'});
      const stockData = await resStock.json();
      const stockRows = Array.isArray(stockData?.almacen) ? stockData.almacen : [];
      const stockMap = {};
      if(Array.isArray(stockRows)){
        stockRows.forEach(r => { stockMap[String(r.modelo||'').toLowerCase().trim()] = parseInt(r.cantidad)||0; });
      }
      prodsOnt = (_modelosOnt||[]).map(m => ({
        ref: 'ONT::'+m.nombre,
        nombre: '📡 ONT — '+m.nombre + (m.marca?` (${m.marca})`:''),
        unidad: 'unidad',
        _stockEspecial: stockMap[String(m.nombre||'').toLowerCase().trim()] || 0,
      }));
    }catch(e){ prodsOnt = []; }
  }

  // Fibra: se agrega como "producto" más en el mismo catálogo (por categoría),
  // usando los metros disponibles reales vía _stockEspecial. Además, se
  // cargan los carretes INDIVIDUALES del almacén central — así quien pide
  // puede elegir "quiero ESE carrete completo" en vez de solo un número de
  // metros sueltos.
  let prodsFibra = [];
  window._pmCarretesPorCategoria = {};
  try{
    const resFibra = await fetch('api/fibra.php?action=categorias', {credentials:'same-origin'});
    const cats = await resFibra.json();
    prodsFibra = (Array.isArray(cats)?cats:[])
      .filter(c => parseFloat(c.metros_disponibles||0) > 0)
      .map(c => ({
        ref: 'FIBRA::'+c.id,
        nombre: '🧵 Fibra — '+c.nombre,
        unidad: 'metros',
        _stockEspecial: parseFloat(c.metros_disponibles||0),
        _catId: c.id,
      }));
    const resCarretes = await fetch(`api/fibra.php?action=carretes_sede&sede=${encodeURIComponent('Almacen Central')}`, {credentials:'same-origin'});
    const carretesData = await resCarretes.json();
    if(Array.isArray(carretesData)){
      carretesData.forEach(c=>{
        if(!(parseFloat(c.metros_disponibles)>0)) return;
        (window._pmCarretesPorCategoria[c.categoria_id] ||= []).push(c);
      });
    }
  }catch(e){ prodsFibra = []; }

  _pmProds = [...prodsNormales, ...prodsOnt, ...prodsFibra];

  const buscador = document.getElementById('pmBuscador');
  if(buscador) buscador.value = '';
  const notaEl = document.getElementById('pmNota');
  if(notaEl) notaEl.value = '';

  document.getElementById('modalPedidoMultiple')?.classList.add('open');
  setTimeout(()=>document.getElementById('pmBuscador')?.focus(), 200);

  pmRenderCatalogo();
  pmRenderCarrito();
}

function pmFiltrar(){
  _pmFiltro = (document.getElementById('pmBuscador')?.value || '').toLowerCase().trim();
  pmRenderCatalogo();
}

function pmRenderCatalogo(){
  const cat = document.getElementById('pmCatalogo');
  const cnt = document.getElementById('pmContadorCatalogo');
  if(!cat) return;

  const filtrados = _pmFiltro
    ? _pmProds.filter(p =>
        p.nombre.toLowerCase().includes(_pmFiltro) ||
        (p.ref||'').toLowerCase().includes(_pmFiltro) ||
        (p.descripcion||'').toLowerCase().includes(_pmFiltro)
      )
    : _pmProds;

  if(cnt) cnt.textContent = filtrados.length ? '('+filtrados.length+')' : '';

  if(!filtrados.length){
    cat.innerHTML = '<div class="!p-[24px] !text-center !text-[#94A3B8] !text-[13px]">'
      + (_pmFiltro ? '🔍 Sin resultados para "'+_pmFiltro+'"' : 'Sin productos disponibles.')
      + '</div>';
    return;
  }

  cat.innerHTML = filtrados.map(p => {
    const sufijo    = p.metrosPorUnidad ? 'rollos' : (p.unidad==='metros' ? 'mts.' : 'uds.');
    const stockNeiva = p.metrosPorUnidad ? valorMostrar(p, _stockCentral(p)) : _stockCentral(p);
    const enCarrito  = _pmCantidades[p.ref] || 0;
    const yaAgregado = enCarrito > 0;
    const carretesHtml = '';
    return `<div onclick="pmAgregarDelCatalogo('${p.ref}')"
      style="padding:10px 12px;border-radius:10px;border:1.5px solid ${yaAgregado?'#7C3AED':'#E2E8F0'};
        background:${yaAgregado?'#F5F3FF':'white'};cursor:pointer;transition:all .15s;"
      onmouseover="if(!${yaAgregado})this.style.borderColor='#C4B5FD',this.style.background='#FAF8FF'"
      onmouseout="if(!${yaAgregado})this.style.borderColor='#E2E8F0',this.style.background='white'">
      <div class="!flex !items-center !justify-between">
        <div class="!min-w-[0] ![flex:1]">
          <div class="!font-semibold !text-[13px] !text-[#0F172A] !whitespace-nowrap !overflow-hidden !text-ellipsis">${esc(p.nombre)}</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap;">
            <span class="badge badge-brand !text-[10px]">${p.ref}</span>
            ${p.proveedor?`<span class="!text-[10px] !text-[#7C3AED]">🏭 ${esc(p.proveedor)}</span>`:''}
            <span class="!text-[11px] !text-[#64748B]">Almacén: <b>${stockNeiva}</b> ${sufijo}</span>
          </div>
          ${carretesHtml}
        </div>
        <div style="flex-shrink:0;margin-left:8px;">
          ${yaAgregado
            ? `<span class="![background:#7C3AED] ![color:white] !rounded-[20px] !p-[3px_10px] !text-[11px] !font-bold">✓ ${enCarrito} ${sufijo}</span>`
            : `<span class="![background:#F1F5F9] !text-[#475569] !rounded-[20px] !p-[3px_10px] !text-[11px]">+ Agregar</span>`
          }
        </div>
      </div>
    </div>`;
  }).join('');
}

function pmAgregarDelCatalogo(ref){
  const p = _pmProds.find(x=>x.ref===ref);
  if(!p) return;
  if(!_pmCantidades[ref]) _pmCantidades[ref] = 0;
  pmRenderCatalogo();
  pmRenderCarrito();
  // Scroll al item en el carrito
  setTimeout(()=>{
    const el = document.getElementById('pmItem_'+ref);
    if(el) el.scrollIntoView({behavior:'smooth',block:'nearest'});
  }, 50);
}

// Agrega directamente la cantidad exacta de un carrete específico (botón "Carrete completo: Xm")
function pmAgregarCarreteCompleto(ref, metros, ev){
  if(ev){ ev.stopPropagation(); }
  _pmCantidades[ref] = metros;
  pmRenderCatalogo();
  pmRenderCarrito();
  setTimeout(()=>{
    const el = document.getElementById('pmItem_'+ref);
    if(el) el.scrollIntoView({behavior:'smooth',block:'nearest'});
  }, 50);
}

function pmRenderCarrito(){
  const carr  = document.getElementById('pmCarrito');
  const vacio = document.getElementById('pmCarritoVacio');
  const cnt   = document.getElementById('pmContadorCarrito');
  const btnLimpiar = document.getElementById('pmBtnLimpiar');
  const resumen = document.getElementById('pmResumen');
  if(!carr) return;

  const items = Object.keys(_pmCantidades);

  if(cnt) cnt.textContent = items.length ? '('+items.length+')' : '';
  if(btnLimpiar) btnLimpiar.style.display = items.length ? '' : 'none';
  if(vacio) vacio.style.display = items.length ? 'none' : '';
  carr.style.display = items.length ? '' : 'none';

  if(resumen){
    if(items.length){
      const total = items.reduce((s,r)=>s+(_pmCantidades[r]||0),0);
      resumen.textContent = items.length+' producto'+(items.length!==1?'s':'')+' · '+total+' unidades totales';
    } else {
      resumen.textContent = '';
    }
  }

  if(!items.length){ carr.innerHTML=''; return; }

  carr.innerHTML = items.map(ref => {
    const p = _pmProds.find(x=>x.ref===ref);
    if(!p) return '';
    const esFibraItem = String(ref).startsWith('FIBRA::');
    const carretesDisp = esFibraItem ? (window._pmCarretesPorCategoria?.[p._catId] || []) : [];
    const sufijo     = p.metrosPorUnidad ? 'rollos' : (p.unidad==='metros' ? 'mts.' : 'uds.');
    const cant       = _pmCantidades[ref] || 0;
    const stockNeivaRaw = _stockCentral(p);
    const stockNeiva = p.metrosPorUnidad ? valorMostrar(p, stockNeivaRaw) : stockNeivaRaw;
    const excede     = cant > stockNeivaRaw && stockNeivaRaw > 0;
    const borde      = excede ? '#FCA5A5' : '#DDD6FE';
    const fondo      = excede ? '#FFF5F5' : '#F5F3FF';
    const carreteElegidoId = _pmCarreteElegido[ref];
    const selectorCarrete = (esFibraItem && carretesDisp.length) ? `
      <div class="!mt-[8px] !pt-[8px] ![border-top:1px_dashed_#DDD6FE]">
        <div class="!text-[10px] !text-[#7C3AED] !mb-[4px]">¿Carrete específico o metros sueltos?</div>
        <select onchange="pmElegirCarrete('${ref}',this.value)" class="inp !text-[11px] !p-[4px_8px]">
          <option value="">Metros sueltos (no importa cuál carrete)</option>
          ${carretesDisp.map(c=>`<option value="${c.id}" ${String(carreteElegidoId)===String(c.id)?'selected':''}>Carrete #${c.id} — ${parseFloat(c.metros_disponibles).toFixed(0)}m completo</option>`).join('')}
        </select>
      </div>` : '';
    return `<div id="pmItem_${ref}" style="padding:10px 12px;border-radius:10px;border:1.5px solid ${borde};background:${fondo};">
      <div class="!flex !items-center !justify-between !gap-[8px]">
        <div class="![flex:1] !min-w-[0]">
          <div class="!font-semibold !text-[12px] !text-[#0F172A] !whitespace-nowrap !overflow-hidden !text-ellipsis">${esc(p.nombre)}</div>
          <div class="!text-[10px] !mt-[2px]">
            ${excede
              ? `<span class="!text-[#DC2626] !font-semibold">⚠ Máx. disponible: ${stockNeiva} ${sufijo}</span>`
              : `<span class="!text-[#7C3AED]">${p.ref}</span>`
            }
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
          <button class="!w-[24px] !h-[24px] !rounded-[6px] ![background:#EDE9FE] ![border:none] !cursor-pointer !font-bold !text-[#5B21B6] !text-[14px] !flex !items-center !justify-center" onclick="pmCambiarCant('${ref}',-1)" ${carreteElegidoId?'disabled':''}>−</button>
          <input id="pmInp_${ref}" type="number" min="0" value="${cant}" class="inp" ${carreteElegidoId?'readonly':''}
            style="width:56px;text-align:center;padding:4px;font-weight:700;font-size:13px;"
            onblur="pmSetCant('${ref}',this.value)"
            onkeydown="if(event.key==='Enter')this.blur()"
            onfocus="this.select()">
          <button class="!w-[24px] !h-[24px] !rounded-[6px] ![background:#EDE9FE] ![border:none] !cursor-pointer !font-bold !text-[#5B21B6] !text-[14px] !flex !items-center !justify-center" onclick="pmCambiarCant('${ref}',1)" ${carreteElegidoId?'disabled':''}>+</button>
          <span class="!text-[10px] !text-[#94A3B8] !min-w-[24px]">${sufijo}</span>
          <button class="!w-[22px] !h-[22px] !rounded-[50%] ![background:#FEE2E2] ![border:none] !cursor-pointer !text-[#DC2626] !text-[12px] !flex !items-center !justify-center" onclick="pmQuitarItem('${ref}')" title="Quitar">✕</button>
        </div>
      </div>
      ${selectorCarrete}
    </div>`;
  }).join('');
}
let _pmCarreteElegido = {}; // [ref] = carrete_id (para fibra, si se quiere uno completo)
function pmElegirCarrete(ref, carreteId){
  if(!carreteId){
    _pmCarreteElegido[ref] = null;
  } else {
    _pmCarreteElegido[ref] = carreteId;
    const p = _pmProds.find(x=>x.ref===ref);
    const carretesDisp = window._pmCarretesPorCategoria?.[p?._catId] || [];
    const c = carretesDisp.find(x=>String(x.id)===String(carreteId));
    if(c) _pmCantidades[ref] = Math.round(parseFloat(c.metros_disponibles));
  }
  pmRenderCarrito();
}

function pmCambiarCant(ref, delta){
  const actual = _pmCantidades[ref] || 0;
  const nueva  = actual + delta;
  if(nueva <= 0){
    // Si llega a 0 o menos, quitar del carrito
    delete _pmCantidades[ref];
  } else {
    _pmCantidades[ref] = nueva;
    const inp = document.getElementById('pmInp_'+ref);
    if(inp) inp.value = nueva;
  }
  pmRenderCarrito();
  pmRenderCatalogo();
}

function pmSetCant(ref, val){
  const n = parseInt(val) || 0;
  if(n < 0) return; // no permitir negativos
  _pmCantidades[ref] = n; // 0 es válido mientras edita
  pmRenderCarrito();
  pmRenderCatalogo();
}

function pmQuitarItem(ref){
  delete _pmCantidades[ref];
  pmRenderCarrito();
  pmRenderCatalogo();
}

function pmLimpiarCarrito(){
  _pmCantidades = {};
  pmRenderCarrito();
  pmRenderCatalogo();
}

function pmActualizar(ref, val){ pmSetCant(ref, val); } // compatibilidad

/* ════════════════════════════════════════════════
   GASTO MÚLTIPLE (municipio / técnico / persona)
   Mismo patrón que pedido múltiple, pero descuenta del
   stock de TU SEDE y registra cada uso vía pedidos/gastar.
════════════════════════════════════════════════ */
let _gmCantidades = {}; // {ref: cantidad}
let _gmProds = [];
let _gmFiltro = '';

function _stockMiSede(p){ return p.stockUsuario || 0; }

let _dmCantidades = {}, _dmProds = [], _dmFiltro = '';

function abrirDevolverMultiple(){
  _dmCantidades = {};
  _dmRollosCache = {};
  _dmRolloIdsElegidos = {};
  _dmProds = getProductos().filter(p => _stockMiSede(p) > 0); // solo lo que tienes en sede
  _dmFiltro = '';
  const buscador = document.getElementById('dmBuscador');
  if(buscador) buscador.value = '';
  const motivoEl= document.getElementById('dmMotivo');  if(motivoEl) motivoEl.value = '';
  document.getElementById('modalDevolverMultiple')?.classList.add('open');
  setTimeout(()=>document.getElementById('dmBuscador')?.focus(), 200);
  dmRenderCatalogo();
  dmRenderCarrito();
  const _dmD=document.getElementById('dmDestinoTxt');
  if(_dmD) _dmD.textContent = (sesion.rol==='tecnico'||sesion.rol==='persona') ? '📍 Al enviar eliges: Almacén Central o tu oficina. El material recogido va siempre al Almacén Central.' : '📍 Se devuelve al Almacén Central';
  _dmCargarFibra();
  _dmCargarRecogido();
}

// Material recogido que aún tienes en tu poder — también se puede devolver
// aquí (siempre va al Almacén Central).
async function _dmCargarRecogido(){
  try{
    const res = await fetch('api/productos.php?action=mi_material_recogido', {credentials:'same-origin'});
    const filas = await res.json();
    if(Array.isArray(filas)){
      filas.filter(r => r.estado==='en_poder' && parseInt(r.cantidad)>0).forEach(r => {
        _dmProds.push({
          ref: `REC_${r.id}`,
          nombre: `♻️ ${r.nombre} (recogido ${r.tipo==='dañado'?'dañado':'reutilizable'})`,
          unidad: 'unidades',
          stockUsuario: parseInt(r.cantidad),
          _esRecogido: true,
          _recId: parseInt(r.id),
        });
      });
      dmRenderCatalogo();
    }
  }catch(e){ /* si falla, el catálogo sigue sin el material recogido */ }
}

// Carretes de fibra a tu nombre — se pueden devolver PARCIALES (lo que de
// verdad tengas en ese momento, no obligatoriamente el rollo entero).
async function _dmCargarFibra(){
  try{
    const res = await fetch('api/fibra.php?action=mis_carretes', {credentials:'same-origin'});
    const carretes = await res.json();
    if(Array.isArray(carretes)){
      carretes.filter(c => parseFloat(c.metros_disponibles) > 0).forEach(c => {
        _dmProds.push({
          ref: `FIBRA_${c.id}`,
          nombre: `🧵 ${c.cat_nombre}${c.codigo ? ' — '+c.codigo : ''}`,
          unidad: 'metros',
          stockUsuario: parseFloat(c.metros_disponibles),
          _esFibra: true,
          _carreteId: c.id,
          _metrosTotal: parseFloat(c.metros)||0,
          _metrosDisp: parseFloat(c.metros_disponibles)||0,
        });
      });
      dmRenderCatalogo();
    }
  }catch(e){ /* si falla, el catálogo sigue funcionando sin la fibra */ }
}

function dmFiltrar(){
  _dmFiltro = (document.getElementById('dmBuscador')?.value || '').toLowerCase().trim();
  dmRenderCatalogo();
}

function dmRenderCatalogo(){
  const cat = document.getElementById('dmCatalogo');
  const cnt = document.getElementById('dmContadorCatalogo');
  if(!cat) return;
  const filtrados = _dmFiltro
    ? _dmProds.filter(p =>
        p.nombre.toLowerCase().includes(_dmFiltro) ||
        (p.ref||'').toLowerCase().includes(_dmFiltro) ||
        (p.descripcion||'').toLowerCase().includes(_dmFiltro))
    : _dmProds;
  if(cnt) cnt.textContent = filtrados.length ? '('+filtrados.length+')' : '';
  if(!filtrados.length){
    cat.innerHTML = '<div class="!p-[24px] !text-center !text-[#94A3B8] !text-[13px]">'
      + (_dmFiltro ? '🔍 Sin resultados para "'+_dmFiltro+'"' : 'No tienes productos con stock en tu sede.')
      + '</div>';
    return;
  }
  cat.innerHTML = filtrados.map(p => {
    const sufijo    = p.unidad==='metros' ? 'mts.' : 'uds.';
    const stockSede = _stockMiSede(p);
    const enCarrito = _dmCantidades[p.ref] || 0;
    const yaAgregado= enCarrito > 0;
    return `<div onclick="dmAgregarDelCatalogo('${p.ref}')"
      style="padding:10px 12px;border-radius:10px;border:1.5px solid ${yaAgregado?'#0A58B5':'#E2E8F0'};
        background:${yaAgregado?'#F0F7FF':'white'};cursor:pointer;transition:all .15s;"
      onmouseover="if(!${yaAgregado})this.style.borderColor='#93C5FD',this.style.background='#F8FBFF'"
      onmouseout="if(!${yaAgregado})this.style.borderColor='#E2E8F0',this.style.background='white'">
      <div class="!flex !items-center !justify-between">
        <div class="!min-w-[0] ![flex:1]">
          <div class="!font-semibold !text-[13px] !text-[#0F172A] !whitespace-nowrap !overflow-hidden !text-ellipsis">${esc(p.nombre)}</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap;">
            ${p._esRecogido?'':`<span class="badge !text-[10px] ![background:#E6F1FB] !text-[#0A58B5]">${p.ref}</span>`}
            <span class="!text-[11px] !text-[#64748B]">En tu sede: <b>${stockSede}</b> ${sufijo}</span>
          </div>
        </div>
        <div style="flex-shrink:0;margin-left:8px;">
          ${yaAgregado
            ? `<span class="![background:#0A58B5] ![color:white] !rounded-[20px] !p-[3px_10px] !text-[11px] !font-bold">✓ ${enCarrito} ${sufijo}</span>`
            : `<span class="![background:#F1F5F9] !text-[#475569] !rounded-[20px] !p-[3px_10px] !text-[11px]">+ Agregar</span>`
          }
        </div>
      </div>
    </div>`;
  }).join('');
}

function dmAgregarDelCatalogo(ref){
  const p = _dmProds.find(x=>x.ref===ref);
  if(!p) return;
  if(p._esFibra || p._esRecogido){
    // Por defecto se ofrece devolver todo lo que tienes de ese carrete —
    // queda editable abajo para devolver solo una parte.
    if(_dmCantidades[ref]) delete _dmCantidades[ref];
    else _dmCantidades[ref] = Math.round(p.stockUsuario);
    dmRenderCatalogo();
    dmRenderCarrito();
    return;
  }
  if(!_dmCantidades[ref]) _dmCantidades[ref] = 1;
  dmRenderCatalogo();
  dmRenderCarrito();
  if(p.metrosPorUnidad) _dmCargarRollosSiAplica(ref);
  setTimeout(()=>{ const el=document.getElementById('dmItem_'+ref); if(el) el.scrollIntoView({behavior:'smooth',block:'nearest'}); }, 50);
}
let _dmRollosCache = {};
let _dmRolloIdsElegidos = {}; // [ref] = [id1, id2, ...]
async function _dmCargarRollosSiAplica(ref){
  const p = _dmProds.find(x=>x.ref===ref);
  if(!p || !p.metrosPorUnidad || _dmRollosCache[ref]) return;
  try{
    const res = await fetch(`api/productos.php?action=mis_rollos&ref=${encodeURIComponent(ref)}`, {credentials:'same-origin'});
    const rollos = await res.json();
    _dmRollosCache[ref] = Array.isArray(rollos) ? rollos : [];
  }catch(e){ _dmRollosCache[ref] = []; }
  dmRenderCarrito();
}
function _dmRollosActualizar(ref){
  const marcados = [...document.querySelectorAll(`#dmItem_${ref} input[type="checkbox"]:checked`)];
  _dmRolloIdsElegidos[ref] = marcados.map(el=>el.value);
  const totalMetros = marcados.reduce((s,el)=>s+parseFloat(el.dataset.metros||0),0);
  _dmCantidades[ref] = Math.round(totalMetros);
  dmRenderCarrito();
}

function dmRenderCarrito(){
  const carr  = document.getElementById('dmCarrito');
  const vacio = document.getElementById('dmCarritoVacio');
  const cnt   = document.getElementById('dmContadorCarrito');
  const btnLimpiar = document.getElementById('dmBtnLimpiar');
  const resumen = document.getElementById('dmResumen');
  if(!carr) return;
  const items = Object.keys(_dmCantidades);
  if(cnt) cnt.textContent = items.length ? '('+items.length+')' : '';
  if(btnLimpiar) btnLimpiar.style.display = items.length ? '' : 'none';
  if(vacio) vacio.style.display = items.length ? 'none' : '';
  carr.style.display = items.length ? '' : 'none';
  if(resumen){
    if(items.length){
      const total = items.reduce((s,r)=>s+(_dmCantidades[r]||0),0);
      resumen.textContent = items.length+' producto'+(items.length!==1?'s':'')+' · '+total+' unidades a devolver';
    } else resumen.textContent = '';
  }
  if(!items.length){ carr.innerHTML=''; return; }
  carr.innerHTML = items.map(ref => {
    const p = _dmProds.find(x=>x.ref===ref);
    if(!p) return '';
    const sufijo    = p.metrosPorUnidad ? 'rollos' : (p.unidad==='metros' ? 'mts.' : 'uds.');
    const cant      = _dmCantidades[ref] || 0;
    const stockSedeRaw = _stockMiSede(p);
    const stockSede = p.metrosPorUnidad ? valorMostrar(p, stockSedeRaw) : stockSedeRaw;
    const excede    = cant > stockSedeRaw;
    const borde     = excede ? '#FCA5A5' : '#93C5FD';
    const fondo     = excede ? '#FFF5F5' : '#F0F7FF';
    const rollosDeEste = (p.metrosPorUnidad && _dmRollosCache[ref]) ? _dmRollosCache[ref] : null;
    const selectorRollo = rollosDeEste ? `
      <div class="!mt-[8px] !pt-[8px] ![border-top:1px_dashed_#BFDBFE]">
        <div class="!text-[10px] !text-[#64748B] !mb-[4px]">¿Cuáles rollos?</div>
        ${rollosDeEste.length ? rollosDeEste.map((r,i)=>`
          <label class="!flex !items-center !gap-[6px] !text-[11px] !cursor-pointer !p-[3px_0]">
            <input type="checkbox" value="${r.id}" data-metros="${r.metros_disponibles}" ${(_dmRolloIdsElegidos[ref]||[]).includes(String(r.id))?'checked':''} onchange="_dmRollosActualizar('${ref}')">
            Rollo ${i+1} — ${parseFloat(r.metros_disponibles).toFixed(1)} m
          </label>`).join('') : '<div class="!text-[11px] !text-[#94A3B8]">No tienes rollos disponibles</div>'}
      </div>` : '';
    return `<div id="dmItem_${ref}" style="padding:10px 12px;border-radius:10px;border:1.5px solid ${borde};background:${fondo};">
      <div class="!flex !items-center !justify-between !gap-[8px]">
        <div class="![flex:1] !min-w-[0]">
          <div class="!font-semibold !text-[12px] !text-[#0F172A] !whitespace-nowrap !overflow-hidden !text-ellipsis">${esc(p.nombre)}</div>
          <div class="!text-[10px] !mt-[2px]">
            ${excede
              ? `<span class="!text-[#DC2626] !font-semibold">⚠ Máx. en tu sede: ${stockSede} ${sufijo}</span>`
              : (p._esRecogido ? '<span class="!text-[#0F766E]">♻️ material recogido → Almacén Central</span>' : `<span class="!text-[#0A58B5]">${p.ref}</span>`)}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
          <button class="!w-[24px] !h-[24px] !rounded-[6px] ![background:#E6F1FB] ![border:none] !cursor-pointer !font-bold !text-[#0A58B5] !text-[14px] !flex !items-center !justify-center" onclick="dmCambiarCant('${ref}',-1)" ${p.metrosPorUnidad?'disabled':''}>−</button>
          <input id="dmInp_${ref}" type="number" min="0" ${(p._esFibra||p._esRecogido)?`max="${Math.round(stockSedeRaw)}"`:''} value="${cant}" class="inp" ${p.metrosPorUnidad?'readonly':''}
            style="width:56px;text-align:center;padding:4px;font-weight:700;font-size:13px;"
            onblur="dmSetCant('${ref}',this.value)" onkeydown="if(event.key==='Enter')this.blur()" onfocus="this.select()">
          <button class="!w-[24px] !h-[24px] !rounded-[6px] ![background:#E6F1FB] ![border:none] !cursor-pointer !font-bold !text-[#0A58B5] !text-[14px] !flex !items-center !justify-center" onclick="dmCambiarCant('${ref}',1)" ${p.metrosPorUnidad?'disabled':''}>+</button>
          <span class="!text-[10px] !text-[#94A3B8] !min-w-[24px]">${sufijo}</span>
          ${(p._esFibra||p._esRecogido) ? `<button onclick="dmSetCant('${ref}','${Math.round(stockSedeRaw)}')" class="btn-sm ![background:#DBEAFE] !text-[#0A58B5] p-[2px_7px] !text-[10px]" title="Devolver todo">Todo</button>` : ''}
          <button class="!w-[22px] !h-[22px] !rounded-[50%] ![background:#FEE2E2] ![border:none] !cursor-pointer !text-[#DC2626] !text-[12px] !flex !items-center !justify-center" onclick="dmQuitarItem('${ref}')" title="Quitar">✕</button>
        </div>
      </div>
      ${selectorRollo}
    </div>`;
  }).join('');
}

function dmCambiarCant(ref, delta){
  const actual = _dmCantidades[ref] || 0;
  const nueva  = actual + delta;
  if(nueva <= 0){ delete _dmCantidades[ref]; }
  else { _dmCantidades[ref] = nueva; const inp=document.getElementById('dmInp_'+ref); if(inp) inp.value=nueva; }
  dmRenderCarrito();
  dmRenderCatalogo();
}
function dmSetCant(ref, val){
  let n = parseInt(val) || 0;
  if(n < 0) return;
  const p = _dmProds.find(x=>x.ref===ref);
  if(p && (p._esFibra||p._esRecogido)) n = Math.min(n, Math.round(p.stockUsuario||0)); // no más de lo que de verdad tiene
  if(n === 0){ delete _dmCantidades[ref]; } else { _dmCantidades[ref] = n; }
  dmRenderCarrito();
  dmRenderCatalogo();
}
function dmQuitarItem(ref){ delete _dmCantidades[ref]; dmRenderCarrito(); dmRenderCatalogo(); }
function dmLimpiarCarrito(){ _dmCantidades = {}; dmRenderCarrito(); dmRenderCatalogo(); }

/* ═══ ASIGNAR MÚLTIPLE: varios productos a una sola persona ═══ */
let _amProds = [], _amFiltro = '', _amCantidades = {};
let _amUsuariosCache = null;
let _amOntModeloSel = '';
let _amOntBuscar = '';
function _amCambiarModeloOnt(modelo){
  _amOntModeloSel = modelo || '';
  _amOntBuscar = '';
  amRenderCatalogo();
}
function _amFiltrarOnt(){
  _amOntBuscar = (document.getElementById('amOntBuscador')?.value || '').toLowerCase().trim();
  amRenderCatalogo();
}
async function _amCargarOnts(){
  if(!['municipio','superadmin','distribuidor'].includes(sesion.rol)) return;
  try{
    // Las ONT de esta oficina son las que ya están a su nombre (tecnico_asignado
    // = este usuario) y aún no fueron entregadas a un técnico — el mismo criterio
    // que usa "Gastar múltiple" para las ONT propias de un técnico/persona.
    const res = await fetch('api/cajas.php?action=mis_onts_asignadas',{credentials:'same-origin'});
    const todas = await res.json();
    if(!Array.isArray(todas)) return;
    // Igual que "instalar_ont" en el backend: solo se bloquea si está
    // dañada/no disponible o ya instalada (comodato) — cualquier otro
    // estado (disponible, despachada, asignado, etc.) se puede entregar.
    const noAsignablesAm = ['dañado','no_disponible','comodato'];
    const onts = todas.filter(o => !noAsignablesAm.includes(o.estado));
    // Una tarjeta POR CADA ONT individual (no agrupadas por modelo), con su
    // propio SN/MAC a la vista, para que se pueda elegir exactamente cuál
    // se está despachando en vez de que el sistema la escoja sola.
    const nuevosOnt = onts.map(o => ({
      ref: 'ONT_'+o.id,
      nombre: '📡 SN ' + (o.sn || o.mac_fmt || o.mac || o.id),
      unidad: 'unidad',
      _esOnt: true,
      _ontId: o.id,
      _modelo: o.modelo || 'Sin modelo',
      stockUsuario: 1
    }));
    // Reemplaza las ONT anteriores (por si cambió el stock) sin tocar los productos normales.
    _amProds = _amProds.filter(p=>!p._esOnt).concat(nuevosOnt);
    amRenderCatalogo();
  }catch(e){ /* si falla, simplemente no se muestran ONT en el catálogo */ }
}
function abrirAsignarMultiple(){
  if(sesion?.rol==='distribuidor'){ toast('El distribuidor no asigna: solo entrega (usa Envío directo / Enviar a una oficina).','warn'); return; }
  _amCantidades = {};
  _amRollosCache = {};
  _amRolloIdsElegidos = {};
  _amProds = getProductos().filter(p => _stockMiSede(p) > 0);
  _amFiltro = '';
  _amOntModeloSel = '';
  _amOntBuscar = '';
  const buscador = document.getElementById('amBuscador');
  if(buscador) buscador.value = '';
  const motivoEl = document.getElementById('amMotivo'); if(motivoEl) motivoEl.value = '';
  document.getElementById('amBuscarUsuario').value = '';
  document.getElementById('amUsuarioValor').value = '';
  document.getElementById('amUsuarioResultados').style.display = 'none';
  document.getElementById('modalAsignarMultiple')?.classList.add('open');
  setTimeout(()=>document.getElementById('amBuscarUsuario')?.focus(), 200);
  amRenderCatalogo();
  amRenderCarrito();
  _amCargarOnts();
  _amCargarFibra();
}

// También los carretes de fibra que tiene esta persona a su nombre — por
// defecto se agregan completos, pero la cantidad (en metros) se puede
// editar en el carrito antes de confirmar, igual que "Devolver Multiple".
async function _amCargarFibra(){
  try{
    const res = await fetch('api/fibra.php?action=mis_carretes', {credentials:'same-origin'});
    const carretes = await res.json();
    if(Array.isArray(carretes)){
      carretes.filter(c => parseFloat(c.metros_disponibles) > 0).forEach(c => {
        _amProds.push({
          ref: `FIBRA_${c.id}`,
          nombre: `🧵 ${c.cat_nombre}${c.codigo ? ' — '+c.codigo : ''}`,
          unidad: 'metros',
          stockUsuario: parseFloat(c.metros_disponibles),
          _esFibra: true,
          _carreteId: c.id,
          _metrosTotal: parseFloat(c.metros)||0,
          _metrosDisp: parseFloat(c.metros_disponibles)||0,
        });
      });
      amRenderCatalogo();
    }
  }catch(e){ /* si falla, el catálogo sigue funcionando sin la fibra */ }
}
async function _amFiltrarUsuario(){
  const q = (document.getElementById('amBuscarUsuario')?.value||'').toLowerCase().trim();
  const cont = document.getElementById('amUsuarioResultados');
  if(!cont) return;
  if(!_amUsuariosCache){
    try{
      const res = await fetch('api/usuarios.php?action=buscar_activos', {credentials:'same-origin'});
      _amUsuariosCache = await res.json();
      if(!Array.isArray(_amUsuariosCache)) _amUsuariosCache = [];
    }catch(e){ _amUsuariosCache = []; }
  }
  const encontrados = _amUsuariosCache.filter(u=>
    u.usuario!==sesion.usuario &&
    _destinoAsignablePorMi(u) &&
    (!q || (u.nombre||'').toLowerCase().includes(q) || (u.apellido||'').toLowerCase().includes(q) || (u.usuario||'').toLowerCase().includes(q))
  );
  cont.innerHTML = encontrados.length
    ? encontrados.map(u=>`<div onclick="_amSeleccionarUsuario('${u.usuario}','${(u.nombre||'')} ${(u.apellido||'')} @${u.usuario}')" style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #F1F5F9;font-size:13px;" onmouseover="this.style.background='#F1F5F9'" onmouseout="this.style.background='white'"><b>${(u.nombre||'')} ${(u.apellido||'')}</b> <span class="!text-[#94A3B8]">@${u.usuario} · ${u.rol||''}</span></div>`).join('')
    : '<div class="!p-[10px] !text-center !text-[#94A3B8] !text-[12px]">Sin resultados</div>';
  cont.style.display = 'block';
}
function _amSeleccionarUsuario(usuario, etiqueta){
  document.getElementById('amUsuarioValor').value = usuario;
  document.getElementById('amBuscarUsuario').value = etiqueta;
  document.getElementById('amUsuarioResultados').style.display = 'none';
}
function amFiltrar(){
  _amFiltro = (document.getElementById('amBuscador')?.value || '').toLowerCase().trim();
  amRenderCatalogo();
}
function amRenderCatalogo(){
  const cat = document.getElementById('amCatalogo');
  const cnt = document.getElementById('amContadorCatalogo');
  if(!cat) return;
  const soloProds = _amProds.filter(p=>!p._esOnt && !p._esFibra);
  const todasOnt  = _amProds.filter(p=>p._esOnt);
  const todaFibra = _amProds.filter(p=>p._esFibra);

  const filtrados = _amFiltro
    ? soloProds.filter(p =>
        p.nombre.toLowerCase().includes(_amFiltro) ||
        (p.ref||'').toLowerCase().includes(_amFiltro) ||
        (p.descripcion||'').toLowerCase().includes(_amFiltro))
    : soloProds;

  const totalMostrado = filtrados.length + todasOnt.length + todaFibra.length;
  if(cnt) cnt.textContent = totalMostrado ? '('+totalMostrado+')' : '';

  // Bloque de fibra: cada carrete se asigna COMPLETO (el rollo entero,
  // no metros sueltos) — por eso es un clic simple como las ONT, mostrando
  // claramente "Rollo de X m" y cuánto le queda disponible para gastar.
  let bloqueFibra = '';
  if(todaFibra.length){
    bloqueFibra = `<div class="!mb-[10px] !p-[10px] ![border:1.5px_dashed_#5EEAD4] !rounded-[10px] ![background:#ECFEFF]">
      <div class="!text-[11px] !font-bold !text-[#0E7490] !mb-[6px] !uppercase !tracking-[.04em]">🧵 Fibra — toca para agregar (por defecto el rollo completo; editable abajo)</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${todaFibra.map(p=>{
          const enCarrito = _amCantidades[p.ref] || 0;
          const yaAgregado = enCarrito > 0;
          return `<div onclick="amAgregarDelCatalogo('${p.ref}')"
            style="padding:8px 10px;border-radius:8px;border:1.5px solid ${yaAgregado?'#0E7490':'#99F6E4'};background:${yaAgregado?'#CCFBF1':'white'};cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div class="!min-w-[0]">
              <div class="!text-[12px] !text-[#0F172A] !font-semibold !overflow-hidden !text-ellipsis !whitespace-nowrap">${esc(p.nombre)}</div>
              <div class="!text-[10px] !text-[#0E7490] !mt-[1px]">Rollo de ${p._metrosTotal.toFixed(0)} m — ${p._metrosDisp.toFixed(0)} m disponibles</div>
            </div>
            ${yaAgregado
              ? `<span style="background:#0E7490;color:white;border-radius:20px;padding:2px 9px;font-size:10px;font-weight:700;flex-shrink:0;">✓ Agregado</span>`
              : `<span style="background:#CCFBF1;color:#0E7490;border-radius:20px;padding:2px 9px;font-size:10px;flex-shrink:0;">+ Agregar</span>`}
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  // Bloque de ONT: primero se elige el MODELO en un desplegable, y solo
  // entonces aparecen las ONT concretas (con su serial) de ese modelo —
  // así no se ve un reguero largo de seriales sueltos de una.
  let bloqueOnt = '';
  if(todasOnt.length){
    const porModelo = {};
    todasOnt.forEach(o=>{ porModelo[o._modelo] = (porModelo[o._modelo]||0) + 1; });
    if(_amOntModeloSel && !porModelo[_amOntModeloSel]) _amOntModeloSel = '';
    const opciones = Object.keys(porModelo).sort().map(m =>
      `<option value="${esc(m)}" ${_amOntModeloSel===m?'selected':''}>${esc(m)} (${porModelo[m]} disponible${porModelo[m]!==1?'s':''})</option>`
    ).join('');
    let delModelo = _amOntModeloSel ? todasOnt.filter(o=>o._modelo===_amOntModeloSel) : [];
    const totalDelModelo = delModelo.length;
    if(_amOntModeloSel && _amOntBuscar){
      delModelo = delModelo.filter(o => o.nombre.toLowerCase().includes(_amOntBuscar));
    }
    bloqueOnt = `<div class="!mb-[10px] !p-[10px] ![border:1.5px_dashed_#93C5FD] !rounded-[10px] ![background:#EFF6FF]">
      <div class="!text-[11px] !font-bold !text-[#1D4ED8] !mb-[6px] !uppercase !tracking-[.04em]">📡 ONT — elige el modelo</div>
      <select id="amOntModeloSelect" class="inp" style="font-size:13px;width:100%;" onchange="_amCambiarModeloOnt(this.value)">
        <option value="">Selecciona un modelo…</option>
        ${opciones}
      </select>
      ${_amOntModeloSel ? `
      <input id="amOntBuscador" type="text" class="inp" placeholder="🔍 Buscar por número de serie…"
        value="${esc(_amOntBuscar)}" oninput="_amFiltrarOnt()"
        style="font-size:13px;width:100%;margin-top:8px;">
      ` : ''}
      ${totalDelModelo ? `<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;">
        ${delModelo.length ? delModelo.map(p=>{
          const enCarrito = _amCantidades[p.ref] || 0;
          const yaAgregado = enCarrito > 0;
          return `<div onclick="amAgregarDelCatalogo('${p.ref}')"
            style="padding:8px 10px;border-radius:8px;border:1.5px solid ${yaAgregado?'#B45309':'#BFDBFE'};background:${yaAgregado?'#FFFBEB':'white'};cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <span class="!text-[12px] !text-[#0F172A] !min-w-[0] !overflow-hidden !text-ellipsis !whitespace-nowrap">${_resaltarTexto(p.nombre, _amOntBuscar)}</span>
            ${yaAgregado
              ? `<span style="background:#B45309;color:white;border-radius:20px;padding:2px 9px;font-size:10px;font-weight:700;flex-shrink:0;">✓ Agregada</span>`
              : `<span style="background:#DBEAFE;color:#1D4ED8;border-radius:20px;padding:2px 9px;font-size:10px;flex-shrink:0;">+ Agregar</span>`}
          </div>`;
        }).join('') : `<div class="!p-[10px] !text-center !text-[#94A3B8] !text-[12px]">Sin resultados para "${esc(_amOntBuscar)}"</div>`}
      </div>` : ''}
    </div>`;
  }

  if(!filtrados.length && !todasOnt.length && !todaFibra.length){
    cat.innerHTML = '<div class="!p-[24px] !text-center !text-[#94A3B8] !text-[13px]">'
      + (_amFiltro ? '🔍 Sin resultados para "'+_amFiltro+'"' : 'No tienes productos, ONT ni fibra con stock a tu nombre.')
      + '</div>';
    return;
  }

  const filasProds = filtrados.map(p => {
    const sufijo    = p.metrosPorUnidad ? 'rollo(s)' : (p.unidad==='metros' ? 'mts.' : 'uds.');
    const stockSedeRaw = _stockMiSede(p);
    // Para "por rollo" se muestra la cantidad REAL de rollos discretos que
    // tienes (no metros÷tamaño, que puede dar un número casi-entero
    // confuso como "2.0" cuando en realidad hay solo 1 rollo completo y
    // sobras de otro) — usa la lista real si ya está cargada.
    const stockSede = p.metrosPorUnidad ? (p.misRollos ? p.misRollos.length : Math.round(stockSedeRaw/(p.metrosPorUnidad||1))) : stockSedeRaw;
    const enCarrito = p.metrosPorUnidad ? (_amRolloIdsElegidos[p.ref]||[]).length : (_amCantidades[p.ref] || 0);
    const yaAgregado= (_amCantidades[p.ref] || 0) > 0;
    return `<div onclick="amAgregarDelCatalogo('${p.ref}')"
      style="padding:10px 12px;border-radius:10px;border:1.5px solid ${yaAgregado?'#B45309':'#E2E8F0'};
        background:${yaAgregado?'#FFFBEB':'white'};cursor:pointer;transition:all .15s;"
      onmouseover="if(!${yaAgregado})this.style.borderColor='#FCD34D',this.style.background='#FFFDF5'"
      onmouseout="if(!${yaAgregado})this.style.borderColor='#E2E8F0',this.style.background='white'">
      <div class="!flex !items-center !justify-between">
        <div class="!min-w-[0] ![flex:1]">
          <div class="!font-semibold !text-[13px] !text-[#0F172A] !whitespace-nowrap !overflow-hidden !text-ellipsis">${esc(p.nombre)}</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap;">
            <span class="badge !text-[10px] ![background:#FEF3E2] !text-[#92400E]">${p.ref}</span>
            <span class="!text-[11px] !text-[#64748B]">Tienes: <b>${stockSede}</b> ${sufijo}</span>
          </div>
        </div>
        <div style="flex-shrink:0;margin-left:8px;">
          ${yaAgregado
            ? `<span class="![background:#B45309] ![color:white] !rounded-[20px] !p-[3px_10px] !text-[11px] !font-bold">✓ ${p.metrosPorUnidad?'elige abajo':enCarrito+' '+sufijo}</span>`
            : `<span class="![background:#F1F5F9] !text-[#475569] !rounded-[20px] !p-[3px_10px] !text-[11px]">+ Agregar</span>`
          }
        </div>
      </div>
    </div>`;
  }).join('');

  cat.innerHTML = bloqueOnt + bloqueFibra + filasProds;
}
function amAgregarDelCatalogo(ref){
  const p = _amProds.find(x=>x.ref===ref);
  if(p && p._esFibra){
    // Por defecto se agrega el carrete completo; la cantidad se puede
    // editar después en el carrito (metros parciales también son válidos).
    if(_amCantidades[ref]) delete _amCantidades[ref];
    else _amCantidades[ref] = Math.round(p.stockUsuario);
    amRenderCatalogo();
    amRenderCarrito();
    return;
  }
  if(!_amCantidades[ref]) _amCantidades[ref] = 1;
  amRenderCatalogo();
  amRenderCarrito();
  if(p && p.metrosPorUnidad) _amCargarRollosSiAplica(ref);
  setTimeout(()=>{ const el=document.getElementById('amItem_'+ref); if(el) el.scrollIntoView({behavior:'smooth',block:'nearest'}); }, 50);
}
let _amRollosCache = {};
let _amRolloIdsElegidos = {}; // [ref] = [id1, id2, ...]
async function _amCargarRollosSiAplica(ref){
  const p = _amProds.find(x=>x.ref===ref);
  if(!p || !p.metrosPorUnidad || _amRollosCache[ref]) return;
  try{
    const res = await fetch(`api/productos.php?action=mis_rollos&ref=${encodeURIComponent(ref)}`, {credentials:'same-origin'});
    const rollos = await res.json();
    _amRollosCache[ref] = Array.isArray(rollos) ? rollos : [];
  }catch(e){ _amRollosCache[ref] = []; }
  amRenderCarrito();
}
function _amRollosActualizar(ref){
  const marcados = [...document.querySelectorAll(`#amItem_${ref} input[type="checkbox"]:checked`)];
  _amRolloIdsElegidos[ref] = marcados.map(el=>el.value);
  const rollos = _amRollosCache[ref] || [];
  const totalMetros = marcados.reduce((s,el)=>{
    const r = rollos.find(x=>String(x.id)===el.value);
    return s + (r ? parseFloat(r.metros_disponibles||0) : 0);
  }, 0);
  _amCantidades[ref] = Math.round(totalMetros);
  amRenderCarrito();
}
function amRenderCarrito(){
  const carr = document.getElementById('amCarrito');
  const vacio = document.getElementById('amCarritoVacio');
  const cnt = document.getElementById('amContadorCarrito');
  const btnLimpiar = document.getElementById('amBtnLimpiar');
  if(!carr) return;
  const items = Object.keys(_amCantidades).filter(ref => _amCantidades[ref] > 0);
  if(cnt) cnt.textContent = items.length ? '('+items.length+')' : '';
  if(btnLimpiar) btnLimpiar.style.display = items.length ? 'block' : 'none';
  if(!items.length){
    carr.innerHTML = '';
    if(vacio) vacio.style.display = 'flex';
    document.getElementById('amResumen').textContent = '';
    return;
  }
  if(vacio) vacio.style.display = 'none';
  carr.innerHTML = items.map(ref => {
    const p = _amProds.find(x=>x.ref===ref);
    if(!p) return '';
    const sufijo    = p._esOnt ? 'ONT(s)' : p._esFibra ? 'm' : (p.metrosPorUnidad ? 'rollo(s)' : (p.unidad==='metros' ? 'mts.' : 'uds.'));
    const cant      = _amCantidades[ref] || 0;
    const stockSedeRaw = _stockMiSede(p);
    const excede    = cant > stockSedeRaw;
    const borde     = excede ? '#FCA5A5' : '#FCD34D';
    const fondo     = excede ? '#FFF5F5' : '#FFFBEB';
    // Rollos "por producto" (ej: DROP): se eligen rollos COMPLETOS y
    // discretos de tu lista real — nunca una fracción calculada.
    const rollosDeEste = (p.metrosPorUnidad && _amRollosCache[ref]) ? _amRollosCache[ref] : null;
    const elegidos = _amRolloIdsElegidos[ref] || [];
    const selectorRollo = rollosDeEste ? `
      <div class="!mt-[6px] !pt-[6px] ![border-top:1px_dashed_#FCD9A0]">
        <div class="!text-[10px] !text-[#92400E] !mb-[4px]">¿Cuáles rollos? (se entregan completos)</div>
        ${rollosDeEste.length ? rollosDeEste.map((r,i)=>`
          <label class="!flex !items-center !gap-[6px] !text-[11px] !cursor-pointer !p-[3px_0]">
            <input type="checkbox" value="${r.id}" ${elegidos.includes(String(r.id))?'checked':''} onchange="_amRollosActualizar('${ref}')">
            Rollo ${i+1} — ${parseFloat(r.metros_disponibles).toFixed(0)} m
          </label>`).join('') : '<div class="!text-[11px] !text-[#94A3B8]">No tienes rollos disponibles</div>'}
      </div>` : '';
    return `<div id="amItem_${ref}" style="padding:10px 12px;border-radius:10px;border:1.5px solid ${borde};background:${fondo};">
      <div class="!flex !items-center !justify-between !gap-[8px]">
        <div class="![flex:1] !min-w-[0]">
          <div class="!font-semibold !text-[12px] !text-[#0F172A] !whitespace-nowrap !overflow-hidden !text-ellipsis">${esc(p.nombre)}</div>
          <div class="!text-[10px] !mt-[2px]">
            ${p._esFibra
              ? `<span style="color:${cant>=Math.round(p.stockUsuario||0)?'#0E7490':'#92400E'};">${cant>=Math.round(p.stockUsuario||0)?'Carrete completo':'Parcial'} — de ${(p._metrosDisp||0).toFixed(0)} m disponibles</span>`
              : p.metrosPorUnidad
              ? `<span style="color:${elegidos.length?'#92400E':'#DC2626'};">${elegidos.length} rollo(s) elegido(s)</span>`
              : excede
              ? `<span class="!text-[#DC2626] !font-semibold">⚠ Tienes: ${stockSedeRaw} ${sufijo}</span>`
              : `<span class="!text-[#92400E]">${p.ref}</span>`}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
          ${p._esOnt ? `
          <span class="!text-[10px] !text-[#94A3B8]">1 unidad</span>
          ` : p._esFibra ? `
          <button class="!w-[24px] !h-[24px] !rounded-[6px] ![background:#FEF3E2] ![border:none] !cursor-pointer !font-bold !text-[#92400E] !text-[14px] !flex !items-center !justify-center" onclick="amCambiarCant('${ref}',-1)">−</button>
          <input id="amInp_${ref}" type="number" min="1" max="${Math.round(p.stockUsuario||0)}" value="${cant}" class="inp"
            style="width:56px;text-align:center;padding:4px;font-weight:700;font-size:13px;"
            onblur="amSetCant('${ref}',this.value)" onkeydown="if(event.key==='Enter')this.blur()" onfocus="this.select()">
          <button class="!w-[24px] !h-[24px] !rounded-[6px] ![background:#FEF3E2] ![border:none] !cursor-pointer !font-bold !text-[#92400E] !text-[14px] !flex !items-center !justify-center" onclick="amCambiarCant('${ref}',1)">+</button>
          <span class="!text-[10px] !text-[#94A3B8] !min-w-[24px]">${sufijo}</span>
          ` : p.metrosPorUnidad ? `
          <span class="!text-[10px] !text-[#94A3B8]">elige abajo</span>
          ` : `
          <button class="!w-[24px] !h-[24px] !rounded-[6px] ![background:#FEF3E2] ![border:none] !cursor-pointer !font-bold !text-[#92400E] !text-[14px] !flex !items-center !justify-center" onclick="amCambiarCant('${ref}',-1)">−</button>
          <input id="amInp_${ref}" type="number" min="0" value="${cant}" class="inp"
            style="width:56px;text-align:center;padding:4px;font-weight:700;font-size:13px;"
            onblur="amSetCant('${ref}',this.value)" onkeydown="if(event.key==='Enter')this.blur()" onfocus="this.select()">
          <button class="!w-[24px] !h-[24px] !rounded-[6px] ![background:#FEF3E2] ![border:none] !cursor-pointer !font-bold !text-[#92400E] !text-[14px] !flex !items-center !justify-center" onclick="amCambiarCant('${ref}',1)">+</button>
          <span class="!text-[10px] !text-[#94A3B8] !min-w-[24px]">${sufijo}</span>
          `}
          <button class="!w-[22px] !h-[22px] !rounded-[50%] ![background:#FEE2E2] ![border:none] !cursor-pointer !text-[#DC2626] !text-[12px] !flex !items-center !justify-center" onclick="amQuitarItem('${ref}')" title="Quitar">✕</button>
        </div>
      </div>
      ${selectorRollo}
    </div>`;
  }).join('');
  const resumen = document.getElementById('amResumen');
  if(resumen) resumen.textContent = `${items.length} producto${items.length!==1?'s':''} listo${items.length!==1?'s':''} para asignar`;
}
function amCambiarCant(ref, delta){
  const actual = _amCantidades[ref] || 0;
  let nueva = Math.max(0, actual + delta);
  const p = _amProds.find(x=>x.ref===ref);
  if(p && p._esFibra) nueva = Math.min(nueva, Math.round(p.stockUsuario||0)); // no más de lo que hay en ese carrete
  if(nueva === 0) delete _amCantidades[ref]; else _amCantidades[ref] = nueva;
  amRenderCarrito(); amRenderCatalogo();
}
function amSetCant(ref, val){
  let n = parseInt(val) || 0;
  const p = _amProds.find(x=>x.ref===ref);
  if(p && p._esFibra) n = Math.min(n, Math.round(p.stockUsuario||0)); // no más de lo disponible en ese rollo
  if(n <= 0) delete _amCantidades[ref]; else _amCantidades[ref] = n;
  amRenderCarrito(); amRenderCatalogo();
}
function amQuitarItem(ref){ delete _amCantidades[ref]; delete _amRolloIdsElegidos[ref]; amRenderCarrito(); amRenderCatalogo(); }
function amLimpiarCarrito(){ _amCantidades = {}; _amRolloIdsElegidos = {}; amRenderCarrito(); amRenderCatalogo(); }
async function confirmarAsignarMultiple(){
  const aQuien = document.getElementById('amUsuarioValor').value;
  const items = Object.entries(_amCantidades).filter(([,v])=>v>0);
  if(!aQuien){ toast('Busca y elige a quién se lo asignas','error'); return; }
  if(!items.length){ toast('Agrega al menos un producto con cantidad mayor a 0.','error'); return; }
  const motivo = (document.getElementById('amMotivo')?.value || '').trim();

  const sinStock = [];
  const sinRollo = [];
  for(const [ref,cant] of items){
    const p = _amProds.find(x=>x.ref===ref);
    if(!p || p._esOnt) continue; // la ONT es una unidad concreta, se valida aparte
    if(p.metrosPorUnidad){
      if(!(_amRolloIdsElegidos[ref]||[]).length) sinRollo.push(`• ${p.nombre} — elige cuáles rollos`);
      continue; // los rollos elegidos ya garantizan que es tuyo y está disponible
    }
    const stockSedeRaw = _stockMiSede(p);
    if(cant > Math.round(stockSedeRaw)) sinStock.push(`• ${p.nombre} — asignas ${cant}${p._esFibra?' m':''}, tienes: ${p._esFibra?Math.round(stockSedeRaw)+' m':stockSedeRaw}`);
  }
  if(sinRollo.length){
    const resumen = document.getElementById('amResumen');
    if(resumen){
      resumen.innerHTML = '<div class="!text-[#DC2626] !text-[12px] !leading-[1.6]">'
        + '<b>⚠ Falta elegir el rollo:</b><br>' + sinRollo.join('<br>') + '</div>';
    }
    return;
  }
  if(sinStock.length){
    const resumen = document.getElementById('amResumen');
    if(resumen){
      resumen.innerHTML = '<div class="!text-[#DC2626] !text-[12px] !leading-[1.6]">'
        + '<b>⚠ No tienes suficiente:</b><br>' + sinStock.join('<br>') + '</div>';
    }
    return;
  }

  // Todos los productos de este "Asignar Multiple" comparten el mismo id de
  // lote — así, igual que "Devolver múltiple" y "Gasto múltiple", en
  // Seguimiento aparecen agrupados en una sola tarjeta con un solo
  // "Confirmar recibido" para todos, en vez de uno separado por producto.
  const loteAsigMultiple = `am_${Date.now()}`;
  const llamadas = [];
  for(const [ref,cant] of items){
    const p = _amProds.find(x=>x.ref===ref);
    if(!p) continue;
    if(p._esOnt){
      // Cada tarjeta de ONT es una unidad concreta y específica (su propio
      // SN/MAC ya se eligió al agregarla del catálogo) — una sola llamada
      // con ese id exacto, no un reparto automático de cualquiera del modelo.
      llamadas.push(
        fetch('api/cajas.php?action=asignar_tecnico_ont', {
          method:'POST', credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ont_id: p._ontId, tecnico: aQuien, lote_id: loteAsigMultiple, silenciar_correo: true})
        }).then(r=>r.json())
      );
    } else if(p._esFibra){
      // Se manda la cantidad elegida en metros — si es el total disponible,
      // el backend lo trata como el carrete completo (cambia de dueño);
      // si es menos, descuenta solo esos metros y el resto se queda contigo.
      llamadas.push(
        fetch('api/fibra.php?action=asignar_carrete_a_persona', {
          method:'POST', credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({carrete_id: p._carreteId, a_quien: aQuien, nota: motivo, lote_id: loteAsigMultiple, metros: cant, silenciar_correo: true})
        }).then(r=>r.json())
      );
    } else if(p.metrosPorUnidad){
      // Rollo(s) completos elegidos a propósito — se manda su identidad
      // exacta para que salgan de tu lista YA, no una cantidad genérica.
      // silenciar_correo=true: el correo de este va combinado con los
      // demás productos del lote (ver más abajo), no uno por separado.
      const rolloIds = (_amRolloIdsElegidos[ref]||[]).map(id=>parseInt(id));
      llamadas.push(_api('productos','asignar_a_persona',{ref, cantidad:cant, a_quien:aQuien, nota:motivo, rollo_ids:rolloIds, silenciar_correo:true, lote_id:loteAsigMultiple}));
    } else {
      llamadas.push(_api('productos','asignar_a_persona',{ref, cantidad:cant, a_quien:aQuien, nota:motivo, silenciar_correo:true, lote_id:loteAsigMultiple}));
    }
  }

  const resultados = await Promise.allSettled(llamadas);
  const errores = resultados.filter(r=>r.status==='rejected' || r.value?.error);
  // Un solo correo con TODOS los productos de este lote (en vez de uno por
  // producto, que es lo que pasaba antes al silenciar el correo individual
  // de cada "asignar_a_persona" de arriba).
  const envioIdsLote = resultados
    .filter(r=>r.status==='fulfilled' && r.value?.envio_id)
    .map(r=>r.value.envio_id);
  if(envioIdsLote.length){
    _api('productos','notificar_asignacion_multiple',{envio_ids:envioIdsLote}).then(r=>_avisoCorreoAsignacion(r&&r.correo,aQuien)).catch(()=>{});
  }
  // Igual que en Gasto Múltiple: antes esto solo decía "X con error" sin
  // explicar por qué, así que una ONT rechazada por el servidor (o cualquier
  // otro producto) se podía pasar por alto sin que nadie supiera la causa
  // real — y entonces "no llegaba" a Seguimiento sin ninguna pista de qué pasó.
  const erroresDetalle = resultados
    .map((r,i) => {
      const [ref] = items[i];
      const p = _amProds.find(x=>x.ref===ref);
      const nombreItem = p?.nombre || ref;
      if(r.status==='rejected') return `${nombreItem}: ${r.reason?.message || 'Error de conexión'}`;
      if(r.value?.error) return `${nombreItem}: ${r.value.error}`;
      return null;
    })
    .filter(Boolean);

  if(errores.length===0){
    cerrarModal('modalAsignarMultiple');
    toast(`Asignado a ${aQuien}: ${items.length} producto${items.length!==1?'s':''} — en camino ✓`,'success');
    await _recargarProductos();
    renderTabla(); renderStats();
  } else if(errores.length < resultados.length){
    toast(`${resultados.length-errores.length} de ${resultados.length} asignados.`,'warn');
    mostrarAlertaBloqueo(
      `Estos ${errores.length} producto(s) NO se asignaron:\n\n${erroresDetalle.join('\n')}`,
      'Algunos productos quedaron pendientes', 'warn'
    );
    await _recargarProductos();
    abrirAsignarMultiple();
  } else {
    mostrarAlertaBloqueo(
      erroresDetalle.length ? erroresDetalle.join('\n') : 'No se pudo asignar. Revisa el stock.',
      'No se pudo asignar', 'error'
    );
  }
}

async function confirmarDevolverMultiple(){
  const itemsTodos = Object.entries(_dmCantidades).filter(([,v])=>v>0);
  if(!itemsTodos.length){ toast('Agrega al menos un producto con cantidad mayor a 0.','error'); return; }
  const motivo = (document.getElementById('dmMotivo')?.value || '').trim();

  // La fibra se devuelve directo (al almacén central) con su propio
  // endpoint — no pasa por el flujo de "elegir transporte" de productos,
  // y se puede devolver solo una PARTE de lo que tiene, no todo el rollo.
  const itemsFibra = itemsTodos.filter(([ref])=>_dmProds.find(x=>x.ref===ref)?._esFibra);
  const itemsRec = itemsTodos.filter(([ref])=>_dmProds.find(x=>x.ref===ref)?._esRecogido)
    .map(([ref,cant])=>({id:_dmProds.find(x=>x.ref===ref)._recId, cantidad:cant, nombre:_dmProds.find(x=>x.ref===ref).nombre}));
  const items = itemsTodos.filter(([ref])=>{ const q=_dmProds.find(x=>x.ref===ref); return !q?._esFibra && !q?._esRecogido; });

  // Productos por rollo: hay que elegir cuáles rollos se devuelven.
  const sinRollo = items.filter(([ref])=>{ const q=_dmProds.find(x=>x.ref===ref); return q?.metrosPorUnidad && !(_dmRolloIdsElegidos[ref]||[]).length; })
    .map(([ref])=>_dmProds.find(x=>x.ref===ref).nombre);
  if(sinRollo.length){
    const resumen = document.getElementById('dmResumen');
    if(resumen) resumen.innerHTML = '<div class="!text-[#DC2626] !text-[12px] !leading-[1.6]"><b>⚠ Elige cuáles rollos devuelves:</b><br>'+sinRollo.map(n=>'• '+esc(n)).join('<br>')+'</div>';
    toast('Elige al menos un rollo en: '+sinRollo.join(', '),'error');
    return;
  }

  const prods = getProductos();
  const sinStock = [];
  for(const [ref,cant] of items){
    const p = prods.find(x=>x.ref===ref);
    if(!p) continue;
    const stockSede = _stockMiSede(p);
    if(cant > stockSede) sinStock.push(`• ${p.nombre} — devuelves ${cant}, en tu sede: ${stockSede}`);
  }
  if(sinStock.length){
    const resumen = document.getElementById('dmResumen');
    if(resumen){
      resumen.innerHTML = '<div class="!text-[#DC2626] !text-[12px] !leading-[1.6]">'
        + '<b>⚠ Stock insuficiente en tu sede:</b><br>' + sinStock.join('<br>')
        + '<br><span class="!text-[#64748B]">Ajusta las cantidades o quita esos productos.</span></div>';
    }
    return;
  }

  cerrarModal('modalDevolverMultiple');
  const fibraPend = itemsFibra.map(([ref,cant])=>{ const q=_dmProds.find(x=>x.ref===ref); return {carrete_id:q._carreteId, cantidad:cant, nombre:q.nombre}; });
  _pendienteDevolverStock = {items, recogidos: itemsRec, fibra: fibraPend, motivo, rollos: {..._dmRolloIdsElegidos}};
  document.getElementById('tdDevTipo').value = 'stock_multiple';
  document.getElementById('tdDevId').value = '';
  const destinoTxtDevM = 'el destino que elijas';
  document.getElementById('tdDevSubtitulo').textContent = `${items.length+itemsRec.length+fibraPend.length} producto${(items.length+itemsRec.length+fibraPend.length)!==1?'s':''}${itemsRec.length?` (${itemsRec.length} de material recogido)`:''} — queda en camino hasta que lo confirmen recibido en ${destinoTxtDevM}.`;
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

// ─── Gasto múltiple: navegación por pasos (solo aplica visualmente en celular, ver estilos.css) ───
let _gmPaso = 1;
// El orden es Detalles → Productos → Confirmar (y no Productos primero)
// porque para poder agregar una ONT al carrito hace falta tener ya
// escrito el Cliente/Proyecto — si "Productos" fuera el paso 1, ese campo
// quedaría oculto y no dejaría seleccionar la ONT.
const _gmPasoNombres = ['Detalles', 'Productos', 'Confirmar'];
function _gmEsMobile(){ return window.matchMedia('(max-width:640px)').matches; }
function gmIrAPaso(n){
  _gmPaso = Math.min(3, Math.max(1, n));
  const box = document.querySelector('#modalGastarMultiple .modal-box');
  if(box) box.setAttribute('data-gmpaso', _gmPaso);
  const lbl = document.getElementById('gmPasoLabel');
  if(lbl) lbl.textContent = `Paso ${_gmPaso} de 3 · ${_gmPasoNombres[_gmPaso-1]}`;
  document.querySelectorAll('#gmPasosNav .gm-dot').forEach((d,i)=>{
    d.style.background = (i === _gmPaso-1) ? '#92400E' : '#E2E8F0';
  });
  const btnAtras = document.getElementById('gmBtnAtras');
  const btnSig = document.getElementById('gmBtnSiguiente');
  if(btnAtras) btnAtras.style.visibility = (_gmPaso===1) ? 'hidden' : 'visible';
  if(btnSig) btnSig.style.display = (_gmPaso===3) ? 'none' : 'inline-flex';
  if(box) box.scrollTop = 0;
}
function gmPasoSiguiente(){
  if(_gmPaso===1){
    if(!(document.getElementById('gmClienteProyecto')?.value || '').trim()){
      toast('Escribe el Cliente/Proyecto para continuar.','error');
      document.getElementById('gmClienteProyecto')?.focus();
      return;
    }
    const lugar = (document.getElementById('gmLugar')?.value || '').trim();
    const lat = (document.getElementById('gmLat')?.value || '').trim();
    const lng = (document.getElementById('gmLng')?.value || '').trim();
    if(!lugar && !(lat && lng)){
      toast('Ingresa el lugar de instalación/uso, o usa el botón de GPS.','error');
      return;
    }
  } else if(_gmPaso===2){
    const items = Object.entries(_gmCantidades||{}).filter(([,v])=>v>0);
    if(!items.length){ toast('Agrega al menos un producto antes de continuar.','error'); return; }
  }
  gmIrAPaso(_gmPaso+1);
}
function gmPasoAnterior(){ gmIrAPaso(_gmPaso-1); }

async function abrirGastoMultiple(){
  _gmCantidades = {};
  _gmRollosCache = {};
  _gmRolloElegido = {};
  _gmProds = getProductos().filter(p => _stockMiSede(p) > 0); // solo lo que tienes en sede
  _gmFiltro = '';
  const btnConfirmarGM = document.getElementById('btnConfirmarGastoMultiple');
  if(btnConfirmarGM){ btnConfirmarGM.disabled = false; btnConfirmarGM.style.opacity = ''; btnConfirmarGM.style.cursor = ''; }
  const buscador = document.getElementById('gmBuscador');
  if(buscador) buscador.value = '';
  const lugarEl = document.getElementById('gmLugar');   if(lugarEl) lugarEl.value = '';
  const motivoEl= document.getElementById('gmMotivo');  if(motivoEl) motivoEl.value = '';
  const clienteProyEl = document.getElementById('gmClienteProyecto');
  if(clienteProyEl){ clienteProyEl.value = ''; clienteProyEl.dataset.fijo = ''; clienteProyEl.readOnly = false; clienteProyEl.style.background = ''; clienteProyEl.style.cursor = ''; clienteProyEl.style.fontWeight = ''; clienteProyEl.title = ''; }
  document.getElementById('gmLat').value = ''; document.getElementById('gmLng').value = '';
  const ubicStatus = document.getElementById('gmUbicacionStatus');
  if(ubicStatus){ ubicStatus.textContent='Puedes escribir la dirección, capturar el GPS, o ambos'; ubicStatus.style.color='#94A3B8'; }
  const btnGpsGm = document.getElementById('btnUbicacionGm');
  if(btnGpsGm){ btnGpsGm.disabled=false; btnGpsGm.textContent='📍 GPS'; }
  document.getElementById('modalGastarMultiple')?.classList.add('open');
  gmIrAPaso(1);
  setTimeout(()=>document.getElementById('gmBuscador')?.focus(), 200);
  gmRenderCatalogo();
  gmRenderCarrito();

  // Traer también los carretes de fibra que tiene esta persona, para poder
  // gastarlos en el mismo carrito junto a los productos normales — se
  // agregan como "productos" con una referencia especial FIBRA_<id>.
  try{
    const res = await fetch('api/fibra.php?action=mis_carretes', {credentials:'same-origin'});
    const carretes = await res.json();
    if(Array.isArray(carretes)){
      carretes.filter(c => parseFloat(c.metros_disponibles) > 0).forEach(c => {
        _gmProds.push({
          ref: `FIBRA_${c.id}`,
          nombre: `🧵 ${c.cat_nombre}${c.codigo ? ' — '+c.codigo : ''}`,
          unidad: 'metros',
          stockUsuario: parseFloat(c.metros_disponibles),
          _esFibra: true,
          _carreteId: c.id,
        });
      });
      gmRenderCatalogo();
    }
  }catch(e){ /* si falla, el catálogo sigue funcionando solo con productos normales */ }

  // También las ONT disponibles de esta persona — así no hay que ir a
  // "Mis equipos" por separado para instalar. Al hacerle clic a una,
  // abre el mismo formulario de instalar de siempre (cliente, dirección) —
  // no se mete al carrito de cantidades, porque una ONT es una unidad
  // completa, no algo que se gaste "un poco".
  try{
    const resOnt = await fetch('api/cajas.php?action=mis_onts_asignadas', {credentials:'same-origin'});
    let misOnt = await resOnt.json();
    if(Array.isArray(misOnt)){
      // El backend solo bloquea instalar cuando está dañada/no disponible o
      // ya instalada (comodato) — cualquier otro estado (disponible,
      // despachada, asignado, etc.) es válido para instalar, igual que
      // permite el propio endpoint "instalar_ont". PERO si te la asignaron
      // como instalador (no eres el dueño) y todavía no aceptaste esa
      // asignación, el backend SÍ la rechaza — antes igual aparecía aquí
      // como si se pudiera instalar, y el gasto fallaba en silencio (solo
      // salía un aviso genérico de "con error", sin decir por qué).
      const noInstalablesGm = ['dañado','no_disponible','comodato'];
      misOnt
        .filter(o => !noInstalablesGm.includes(o.estado))
        .filter(o => o.es_dueño || o.asignacion_confirmada === 'aceptada')
        .forEach(o => {
          _gmProds.push({
            ref: `ONT_${o.id}`,
            nombre: `📡 ONT ${o.modelo||''} — SN ${o.sn||o.mac||o.id}`,
            unidad: 'unidad',
            stockUsuario: 1,
            _esOnt: true,
            _ontId: o.id,
          });
        });
      gmRenderCatalogo();
    }
  }catch(e){ /* si falla, el catálogo sigue funcionando sin las ONT */ }

  // También el material "recogido" (reutilizable, todavía en tu poder) —
  // se puede gastar de ahí, eligiendo la cantidad (hasta lo que tengas
  // registrado), igual que un producto normal.
  try{
    const resRec = await fetch('api/productos.php?action=mi_material_recogido', {credentials:'same-origin'});
    let misRecogidos = await resRec.json();
    if(Array.isArray(misRecogidos)){
      misRecogidos
        .filter(r => r.tipo==='reutilizable' && r.estado==='en_poder' && parseFloat(r.cantidad) > 0)
        .forEach(r => {
          _gmProds.push({
            ref: `RECOGIDO_${r.id}`,
            nombre: `♻️ ${r.nombre} (recogido)`,
            unidad: 'unidad',
            stockUsuario: parseFloat(r.cantidad),
            _esRecogido: true,
            _recogidoId: r.id,
            _recogidoCant: parseFloat(r.cantidad),
          });
        });
      gmRenderCatalogo();
    }
  }catch(e){ /* si falla, el catálogo sigue funcionando sin lo recogido */ }
}

function gmFiltrar(){
  _gmFiltro = (document.getElementById('gmBuscador')?.value || '').toLowerCase().trim();
  gmRenderCatalogo();
}

function gmRenderCatalogo(){
  const cat = document.getElementById('gmCatalogo');
  const cnt = document.getElementById('gmContadorCatalogo');
  if(!cat) return;
  const filtrados = _gmFiltro
    ? _gmProds.filter(p =>
        p.nombre.toLowerCase().includes(_gmFiltro) ||
        (p.ref||'').toLowerCase().includes(_gmFiltro) ||
        (p.descripcion||'').toLowerCase().includes(_gmFiltro))
    : _gmProds;
  if(cnt) cnt.textContent = filtrados.length ? '('+filtrados.length+')' : '';
  if(!filtrados.length){
    cat.innerHTML = '<div class="!p-[24px] !text-center !text-[#94A3B8] !text-[13px]">'
      + (_gmFiltro ? '🔍 Sin resultados para "'+_gmFiltro+'"' : 'No tienes productos con stock en tu sede.')
      + '</div>';
    return;
  }
  cat.innerHTML = filtrados.map(p => {
    const sufijo    = p.unidad==='metros' ? 'mts.' : 'uds.';
    const stockSede = _stockMiSede(p);
    const enCarrito = _gmCantidades[p.ref] || 0;
    const yaAgregado= enCarrito > 0;
    return `<div onclick="gmAgregarDelCatalogo('${p.ref}')"
      style="padding:10px 12px;border-radius:10px;border:1.5px solid ${yaAgregado?'#BA7517':'#E2E8F0'};
        background:${yaAgregado?'#FEF9F0':'white'};cursor:pointer;transition:all .15s;"
      onmouseover="if(!${yaAgregado})this.style.borderColor='#FCD9A0',this.style.background='#FFFBF5'"
      onmouseout="if(!${yaAgregado})this.style.borderColor='#E2E8F0',this.style.background='white'">
      <div class="!flex !items-center !justify-between">
        <div class="!min-w-[0] ![flex:1]">
          <div class="!font-semibold !text-[13px] !text-[#0F172A] !whitespace-nowrap !overflow-hidden !text-ellipsis">${esc(p.nombre)}</div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:3px;flex-wrap:wrap;">
            <span class="badge badge-warn !text-[10px]">${p.ref}</span>
            <span class="!text-[11px] !text-[#64748B]">En tu sede: <b>${stockSede}</b> ${sufijo}</span>
          </div>
        </div>
        <div style="flex-shrink:0;margin-left:8px;">
          ${yaAgregado
            ? `<span class="![background:#BA7517] ![color:white] !rounded-[20px] !p-[3px_10px] !text-[11px] !font-bold">✓ ${enCarrito} ${sufijo}</span>`
            : `<span class="![background:#F1F5F9] !text-[#475569] !rounded-[20px] !p-[3px_10px] !text-[11px]">+ Agregar</span>`
          }
        </div>
      </div>
    </div>`;
  }).join('');
}

function gmAgregarDelCatalogo(ref){
  const p = _gmProds.find(x=>x.ref===ref);
  if(!p) return;
  if(p._esOnt){
    // Ya no abre el formulario aparte de "Instalar ONT" — usa el mismo
    // Cliente/Proyecto que ya se escribió arriba en Gastar múltiple, para
    // no repetir el dato dos veces. Si todavía no lo llenaron, se les pide
    // llenarlo primero (así el nombre del cliente queda bien desde el inicio).
    const clienteEl = document.getElementById('gmClienteProyecto');
    const cliente = (clienteEl?.value || '').trim();
    if(!cliente){
      toast('Escribe primero el Cliente/Proyecto (arriba) para poder agregar la ONT','error');
      clienteEl?.focus();
      return;
    }
    // Toggle: si ya estaba agregada, la quita; si no, la agrega (siempre 1).
    if(_gmCantidades[ref]) delete _gmCantidades[ref];
    else _gmCantidades[ref] = 1;
    gmRenderCatalogo();
    gmRenderCarrito();
    return;
  }
  if(p._esRecogido){
    // Se puede elegir cuánto gastar de ahí (hasta lo que haya en ese
    // registro) — arranca en 1, igual que un producto normal.
    if(!_gmCantidades[ref]) _gmCantidades[ref] = 1;
    gmRenderCatalogo();
    gmRenderCarrito();
    setTimeout(()=>{ const el=document.getElementById('gmItem_'+ref); if(el) el.scrollIntoView({behavior:'smooth',block:'nearest'}); }, 50);
    return;
  }
  if(!_gmCantidades[ref]) _gmCantidades[ref] = 1; // arranca en 1 para gasto
  gmRenderCatalogo();
  gmRenderCarrito();
  if(p.metrosPorUnidad) _gmCargarRollosSiAplica(ref);
  setTimeout(()=>{ const el=document.getElementById('gmItem_'+ref); if(el) el.scrollIntoView({behavior:'smooth',block:'nearest'}); }, 50);
}

function gmRenderCarrito(){
  const carr  = document.getElementById('gmCarrito');
  const vacio = document.getElementById('gmCarritoVacio');
  const cnt   = document.getElementById('gmContadorCarrito');
  const btnLimpiar = document.getElementById('gmBtnLimpiar');
  const resumen = document.getElementById('gmResumen');
  if(!carr) return;
  const items = Object.keys(_gmCantidades);
  if(cnt) cnt.textContent = items.length ? '('+items.length+')' : '';
  if(btnLimpiar) btnLimpiar.style.display = items.length ? '' : 'none';
  if(vacio) vacio.style.display = items.length ? 'none' : '';
  carr.style.display = items.length ? '' : 'none';
  if(resumen){
    if(items.length){
      const total = items.reduce((s,r)=>s+(_gmCantidades[r]||0),0);
      resumen.textContent = items.length+' producto'+(items.length!==1?'s':'')+' · '+total+' unidades a gastar';
    } else resumen.textContent = '';
  }
  if(!items.length){ carr.innerHTML=''; return; }
  carr.innerHTML = items.map(ref => {
    const p = _gmProds.find(x=>x.ref===ref);
    if(!p) return '';
    if(p._esOnt){
      // Se instala directo al confirmar — no tiene cantidad ni rollo, es
      // siempre 1 ONT concreta usando el Cliente/Proyecto de arriba.
      return `<div id="gmItem_${ref}" style="padding:10px 12px;border-radius:10px;border:1.5px solid #BFDBFE;background:#EFF6FF;">
        <div class="!flex !items-center !justify-between !gap-[8px]">
          <div class="![flex:1] !min-w-[0]">
            <div class="!font-semibold !text-[12px] !text-[#0F172A] !whitespace-nowrap !overflow-hidden !text-ellipsis">${esc(p.nombre)}</div>
            <div class="!text-[10px] !mt-[2px] !text-[#1D4ED8]">Se instalará al confirmar</div>
          </div>
          <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
            <button class="!w-[22px] !h-[22px] !rounded-[50%] ![background:#FEE2E2] ![border:none] !cursor-pointer !text-[#DC2626] !text-[12px] !flex !items-center !justify-center" onclick="gmQuitarItem('${ref}')" title="Quitar">✕</button>
          </div>
        </div>
      </div>`;
    }
    const sufijo    = p.unidad==='metros' ? 'mts.' : 'uds.';
    const cant      = _gmCantidades[ref] || 0;
    const rollosDeEste = (p.metrosPorUnidad && _gmRollosCache[ref]) ? _gmRollosCache[ref] : null;
    // Si es "por rollo", el límite real es lo que tenga DISPONIBLE el
    // rollo elegido (no el acumulado "en bolsa" del usuario, que puede
    // quedar desfasado) — así, con 1 solo rollo, igual se ve y se valida
    // contra su cantidad real, no contra un total que podría no coincidir.
    let stockSede;
    if(rollosDeEste){
      const rolloSel = rollosDeEste.find(r=>String(r.id)===String(_gmRolloElegido[ref])) || rollosDeEste[0];
      stockSede = rolloSel ? parseFloat(rolloSel.metros_disponibles) || 0 : 0;
    } else {
      stockSede = _stockMiSede(p);
    }
    const excede    = cant > stockSede;
    const borde     = excede ? '#FCA5A5' : '#FCD9A0';
    const fondo     = excede ? '#FFF5F5' : '#FEF9F0';
    // El selector de rollo sale siempre que el producto sea "por rollo"
    // (aunque solo tenga uno) — así se ve de cuál rollo se está sacando y
    // cuánto tiene disponible ese rollo en concreto, en vez de solo
    // aparecer cuando hay para escoger entre varios.
    const selectorRollo = rollosDeEste ? (rollosDeEste.length ? `
      <div class="!mt-[6px]">
        <select id="gmRolloSel_${ref}" onchange="_gmSetRollo('${ref}',this.value)" class="inp" style="font-size:11px;padding:4px 8px;" ${rollosDeEste.length<=1?'disabled':''}>
          ${rollosDeEste.map((r,i)=>`<option value="${r.id}" ${String(r.id)===String(_gmRolloElegido[ref])?'selected':''}>Rollo ${i+1} — ${parseFloat(r.metros_disponibles).toFixed(1)} m disp.</option>`).join('')}
        </select>
      </div>` : `<div class="!mt-[6px] !text-[10px] !text-[#DC2626]">⚠ No tienes rollos disponibles de este producto</div>`) : '';
    return `<div id="gmItem_${ref}" style="padding:10px 12px;border-radius:10px;border:1.5px solid ${borde};background:${fondo};">
      <div class="!flex !items-center !justify-between !gap-[8px]">
        <div class="![flex:1] !min-w-[0]">
          <div class="!font-semibold !text-[12px] !text-[#0F172A] !whitespace-nowrap !overflow-hidden !text-ellipsis">${esc(p.nombre)}</div>
          <div class="!text-[10px] !mt-[2px]">
            ${excede
              ? `<span class="!text-[#DC2626] !font-semibold">⚠ Máx. en tu sede: ${stockSede} ${sufijo}</span>`
              : `<span class="!text-[#BA7517]">${p.ref}</span>`}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
          <button class="!w-[24px] !h-[24px] !rounded-[6px] ![background:#FAEEDA] ![border:none] !cursor-pointer !font-bold !text-[#92400E] !text-[14px] !flex !items-center !justify-center" onclick="gmCambiarCant('${ref}',-1)">−</button>
          <input id="gmInp_${ref}" type="number" min="0" value="${cant}" class="inp"
            style="width:56px;text-align:center;padding:4px;font-weight:700;font-size:13px;"
            onblur="gmSetCant('${ref}',this.value)" onkeydown="if(event.key==='Enter')this.blur()" onfocus="this.select()">
          <button class="!w-[24px] !h-[24px] !rounded-[6px] ![background:#FAEEDA] ![border:none] !cursor-pointer !font-bold !text-[#92400E] !text-[14px] !flex !items-center !justify-center" onclick="gmCambiarCant('${ref}',1)">+</button>
          <span class="!text-[10px] !text-[#94A3B8] !min-w-[24px]">${sufijo}</span>
          <button class="!w-[22px] !h-[22px] !rounded-[50%] ![background:#FEE2E2] ![border:none] !cursor-pointer !text-[#DC2626] !text-[12px] !flex !items-center !justify-center" onclick="gmQuitarItem('${ref}')" title="Quitar">✕</button>
        </div>
      </div>
      ${selectorRollo}
    </div>`;
  }).join('');
}

let _gmRollosCache = {};
let _gmRolloElegido = {};
function _gmSetRollo(ref, rolloId){ _gmRolloElegido[ref] = rolloId; gmRenderCarrito(); }
async function _gmCargarRollosSiAplica(ref){
  const p = _gmProds.find(x=>x.ref===ref);
  if(!p || !p.metrosPorUnidad || _gmRollosCache[ref]) return;
  try{
    const res = await fetch(`api/productos.php?action=mis_rollos&ref=${encodeURIComponent(ref)}`, {credentials:'same-origin'});
    const rollos = await res.json();
    if(Array.isArray(rollos)){
      _gmRollosCache[ref] = rollos;
      if(rollos.length) _gmRolloElegido[ref] = rollos[0].id;
      gmRenderCarrito();
    }
  }catch(e){ /* si falla, se gasta del total sin especificar rollo */ }
}

function gmCambiarCant(ref, delta){
  const actual = _gmCantidades[ref] || 0;
  const nueva  = actual + delta;
  if(nueva <= 0){ delete _gmCantidades[ref]; }
  else { _gmCantidades[ref] = nueva; const inp=document.getElementById('gmInp_'+ref); if(inp) inp.value=nueva; }
  gmRenderCarrito();
  gmRenderCatalogo();
}
function gmSetCant(ref, val){
  const n = parseInt(val) || 0;
  if(n < 0) return;
  if(n === 0){ delete _gmCantidades[ref]; } else { _gmCantidades[ref] = n; }
  gmRenderCarrito();
  gmRenderCatalogo();
}
function gmQuitarItem(ref){ delete _gmCantidades[ref]; gmRenderCarrito(); gmRenderCatalogo(); }
function gmLimpiarCarrito(){ _gmCantidades = {}; gmRenderCarrito(); gmRenderCatalogo(); }

async function confirmarGastoMultiple(){
  const items = Object.entries(_gmCantidades).filter(([,v])=>v>0);
  if(!items.length){ toast('Agrega al menos un producto con cantidad mayor a 0.','error'); return; }
  const lugar  = (document.getElementById('gmLugar')?.value || '').trim();
  const motivo = (document.getElementById('gmMotivo')?.value || '').trim();
  const gmLatVal = (document.getElementById('gmLat')?.value || '').trim();
  const gmLngVal = (document.getElementById('gmLng')?.value || '').trim();
  if(!(document.getElementById('gmClienteProyecto')?.value || '').trim()){
    toast('Escribe el Cliente/Proyecto — es obligatorio para registrar el gasto.','error');
    document.getElementById('gmClienteProyecto')?.focus();
    return;
  }
  if(!lugar && !(gmLatVal && gmLngVal)){ toast('Ingresa el lugar de instalación/uso, o usa el botón de GPS/mapa.','error'); return; }

  // Bloquear el botón mientras procesa — si alguien le da varios clics por
  // impaciencia (la operación puede tardar un par de segundos), sin esto
  // la función completa se ejecuta varias veces en paralelo, registrando
  // el gasto repetido y abriendo un PDF por cada clic.
  const btnConfirmar = document.getElementById('btnConfirmarGastoMultiple');
  if(btnConfirmar?.disabled) return; // ya se está procesando, ignorar clics extra
  if(btnConfirmar){ btnConfirmar.disabled = true; btnConfirmar.style.opacity = '.6'; btnConfirmar.style.cursor = 'not-allowed'; }

  // Validar stock de la sede antes de gastar (usa _gmProds, que ya incluye
  // tanto productos normales como los carretes de fibra agregados).
  const sinStock = [];
  for(const [ref,cant] of items){
    const p = _gmProds.find(x=>x.ref===ref);
    if(!p) continue;
    let stockSede;
    if(p.metrosPorUnidad){
      // El límite real es el rollo elegido, no el acumulado "en bolsa".
      const rollosDeEste = _gmRollosCache[ref] || [];
      const rolloSel = rollosDeEste.find(r=>String(r.id)===String(_gmRolloElegido[ref])) || rollosDeEste[0];
      stockSede = rolloSel ? (parseFloat(rolloSel.metros_disponibles) || 0) : 0;
      if(!rolloSel){ sinStock.push(`• ${p.nombre} — no tienes rollos disponibles`); continue; }
    } else {
      stockSede = p._esFibra ? p.stockUsuario : _stockMiSede(p);
    }
    if(cant > stockSede){
      sinStock.push(p.metrosPorUnidad
        ? `• ${p.nombre} — gastas ${cant} m, el rollo elegido tiene: ${stockSede} m`
        : `• ${p.nombre} — gastas ${cant}, en tu sede: ${stockSede}`);
    }
  }
  if(sinStock.length){
    const resumen = document.getElementById('gmResumen');
    if(resumen){
      resumen.innerHTML = '<div class="!text-[#DC2626] !text-[12px] !leading-[1.6]">'
        + '<b>⚠ Stock insuficiente en tu sede:</b><br>' + sinStock.join('<br>')
        + '<br><span class="!text-[#64748B]">Ajusta las cantidades o quita esos productos.</span></div>';
    }
    if(btnConfirmar){ btnConfirmar.disabled = false; btnConfirmar.style.opacity = ''; btnConfirmar.style.cursor = ''; }
    return;
  }

  const lat = (document.getElementById('gmLat')?.value || '').trim();
  const lng = (document.getElementById('gmLng')?.value || '').trim();
  const proyectoCliente = (document.getElementById('gmClienteProyecto')?.value || '').trim();

  // Registrar cada gasto (en paralelo, sin abortar si uno falla) — la
  // fibra usa su propio endpoint (carrete_id, metros), distinto del de
  // productos normales (ref, cantidad). Se manda un "lote_id" compartido
  // para que después, en Historial, el botón de "Ver PDF" de cualquiera
  // de estos productos sepa abrir el comprobante COMBINADO con todos,
  // no uno separado por cada producto.
  const loteGastoMultiple = `gm_${Date.now()}`;
  const resultados = await Promise.allSettled(
    items.map(([ref,cant]) => {
      const p = _gmProds.find(x=>x.ref===ref);
      if(p?._esOnt){
        // Se instala directo, usando el mismo Cliente/Proyecto y lugar de
        // arriba — sin el formulario aparte de "Instalar ONT".
        return fetch('api/cajas.php?action=instalar_ont', {
          method:'POST', credentials:'same-origin',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({
            ont_id: p._ontId,
            cliente_nombre: proyectoCliente,
            cliente_direccion: lugar,
            tecnico_instalador: sesion.usuario,
            lat: lat || undefined, lng: lng || undefined,
            lote_id: loteGastoMultiple
          })
        }).then(r=>r.json());
      }
      if(p?._esFibra){
        return _api('fibra','registrar_gasto_fibra',{carrete_id:p._carreteId, metros:cant, descripcion:motivo||lugar, sede_destino:lugar, lat, lng, lote_id:loteGastoMultiple, proyecto_cliente:proyectoCliente||undefined});
      }
      if(p?._esRecogido){
        return _api('productos','gastar_recogido',{id:p._recogidoId, lugar, lat, lng, proyecto_cliente:proyectoCliente||undefined, lote_id:loteGastoMultiple});
      }
      return _api('pedidos','gastar',{ref,cantidad:cant,motivo,lugar,lat,lng,rollo_id:_gmRolloElegido[ref]||undefined,lote_id:loteGastoMultiple,proyecto_cliente:proyectoCliente||undefined});
    })
  );
  const errores = resultados.filter(r=>r.status==='rejected' || r.value?.error);
  // Antes esto solo decía "X con error" sin explicar por qué — quien
  // registraba el gasto no tenía forma de saber qué falló ni de cuál
  // producto, así que un ONT rechazado (p.ej. por no haber aceptado la
  // asignación) se podía pasar por alto sin que nadie se diera cuenta.
  const erroresDetalle = resultados
    .map((r,i) => {
      const [ref] = items[i];
      const p = _gmProds.find(x=>x.ref===ref);
      const nombreItem = p?.nombre || ref;
      if(r.status==='rejected') return `${nombreItem}: ${r.reason?.message || 'Error de conexión'}`;
      if(r.value?.error) return `${nombreItem}: ${r.value.error}`;
      return null;
    })
    .filter(Boolean);
  const historialIds = resultados
    .filter(r=>r.status==='fulfilled' && r.value?.historial_id)
    .map(r=>r.value.historial_id);
  await Promise.all([_recargarProductos(),_recargarHistorial()]);
  renderTabla(); renderStats(); renderHistorial();
  // Si el lote incluía ONT, refrescar también sus vistas/stock sin recargar la página
  if(items.some(([ref])=>_gmProds.find(x=>x.ref===ref)?._esOnt)){
    try{ if(typeof cargarMisOnt==='function') cargarMisOnt(); }catch(_){}
    try{ if(document.getElementById('ontInventarioGrid') && typeof renderInventarioOnt==='function') renderInventarioOnt(); }catch(_){}
    try{ if(document.getElementById('tablaOntEnUso') && typeof cargarTablaOntEnUso==='function') cargarTablaOntEnUso(); }catch(_){}
    try{ if(typeof renderStats==='function') renderStats(); }catch(_){}
  }

  if(errores.length===0){
    cerrarModal('modalGastarMultiple');
    toast(`Gasto registrado: ${items.length} producto${items.length!==1?'s':''} en ${sesion.sede} ✓`,'success');
    // Ya no se abre el PDF automático — queda disponible en Historial
    // (botón "PDF" en cualquiera de los productos del lote) por si lo
    // necesitan, sin interrumpir con una ventana nueva cada vez.
  } else if(errores.length < items.length){
    toast(`${items.length-errores.length} de ${items.length} registrados.`,'warn');
    mostrarAlertaBloqueo(
      `Estos ${errores.length} producto(s) NO se registraron:\n\n${erroresDetalle.join('\n')}`,
      'Algunos productos quedaron pendientes', 'warn'
    );
    abrirGastoMultiple();
  } else {
    mostrarAlertaBloqueo(
      erroresDetalle.length ? erroresDetalle.join('\n') : 'No se pudo registrar el gasto. Revisa el stock.',
      'No se pudo registrar el gasto', 'error'
    );
  }
  if(btnConfirmar){ btnConfirmar.disabled = false; btnConfirmar.style.opacity = ''; btnConfirmar.style.cursor = ''; }
}

async function enviarPedidoMultiple(){
  const items=Object.entries(_pmCantidades).filter(([,v])=>v>0);
  if(!items.length){toast('Agrega al menos un producto con cantidad mayor a 0.','error');return;}
  const prods=_pmProds; // incluye productos normales + ONTs (con su stock real vía _stockEspecial)

  // Validar stock del almacén antes de enviar
  const sinStock = [];
  for(const [ref,cant] of items){
    const p = prods.find(x=>x.ref===ref);
    if(!p) continue;
    const stockNeivaRaw = _stockCentral(p);
    const stockComparar = p.metrosPorUnidad ? (stockNeivaRaw / p.metrosPorUnidad) : stockNeivaRaw;
    if(cant > stockComparar){
      const suf = p.metrosPorUnidad ? 'rollos' : '';
      sinStock.push(`• ${p.nombre} — pediste ${cant} ${suf}, disponible en almacén: ${valorMostrar(p,stockNeivaRaw)} ${suf}`);
    }
  }
  if(sinStock.length){
    // Mostrar alerta en el modal
    const resumen = document.getElementById('pmResumen');
    if(resumen){
      resumen.innerHTML = '<div class="!text-[#DC2626] !text-[12px] !leading-[1.6]">'
        + '<b>⚠ Stock insuficiente en almacén:</b><br>'
        + sinStock.join('<br>')
        + '<br><span class="!text-[#64748B]">Ajusta las cantidades o quita esos productos.</span>'
        + '</div>';
    }
    return;
  }

  // Armar items: todo en un solo pedido agrupado — productos, ONT y fibra juntos.
  const itemsAgrupados = [];
  for(const [ref,cant] of items){
    const p = prods.find(x=>x.ref===ref);
    if(!p) continue;
    if(String(ref).startsWith('FIBRA::')){
      itemsAgrupados.push({ ref:'FIBRA', nombre:p.nombre, cantidad:cant, unidad:'metros', categoria_fibra_id: ref.replace('FIBRA::',''), carrete_id: _pmCarreteElegido[ref]||undefined });
    } else {
      // Si es "por rollo" (metrosPorUnidad), lo que se escribió en el
      // carrito son ROLLOS — se convierte a metros antes de guardar,
      // igual que en Enviar/Solicitar directo.
      const cantFinal = p.metrosPorUnidad ? cant * p.metrosPorUnidad : cant;
      itemsAgrupados.push({ref:p.ref, nombre:p.nombre, cantidad:cantFinal, unidad:p.unidad||'unidad'});
    }
  }

  const notaMun = (document.getElementById('pmNota')?.value || '').trim();
  const destinoMun = sesion.sede || sesion.sede_nombre || '';

  try{
    const res = await fetch('api/pedidos_agrupados.php?action=crear',{
      method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        items: itemsAgrupados,
        destino: destinoMun,
        nota: notaMun || 'Pedido múltiple'
      })
    });
    const data = await res.json();
    if(!res.ok||data.error) throw new Error(data.error||'Error al enviar pedido');

    await Promise.all([_recargarSolicitudes(), _recargarPedidosAgrupados()]);
    cerrarModal('modalPedidoMultiple');
    pmLimpiarCarrito();
    renderSolicitudes();renderStats();updateNotifBadges();
    toast(`✅ Pedido enviado — ${itemsAgrupados.length} producto${itemsAgrupados.length!==1?'s':''}`, 'success');
  }catch(e){
    toast(e.message||'Error al enviar pedido','error');
  }
}
