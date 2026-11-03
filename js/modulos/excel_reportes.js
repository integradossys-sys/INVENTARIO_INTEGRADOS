/* ════════════════════════════════════════════════
   HELPERS
════════════════════════════════════════════════ */
function setText(id,t){const e=document.getElementById(id);if(e)e.textContent=t;}
function cerrarModal(id){document.getElementById(id)?.classList.remove('open');}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
// Subraya/resalta la parte de un texto que coincide con la búsqueda activa
// (se usa en Seguimiento para que se vea, dentro de la tabla, cuál fue el
// dato que hizo que esa fila apareciera en el filtro).
function _resaltarTexto(texto, q){
  const t = esc(texto||'');
  if(!q) return t;
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if(i<0) return t;
  return t.slice(0,i) + '<mark style="background:#FEF08A;text-decoration:underline;text-decoration-color:#CA8A04;border-radius:2px;padding:0 1px;">' + t.slice(i,i+q.length) + '</mark>' + t.slice(i+q.length);
}
function sufijo(ref){const p=getProductos().find(x=>x.ref===ref);return p?.unidad==='metros'?'mts.':'uds.';}
function sufijoP(p){return p?.unidad==='metros'?'mts.':'uds.';}
// Si el producto viene empacado en rollos iguales (metrosPorUnidad seteado),
// se muestra como cantidad de rollos en vez de metros sueltos — el stock
// real sigue guardado en metros por dentro, esto es solo para mostrar.
function sufijoMostrar(p){return p?.metrosPorUnidad ? 'rollos' : sufijoP(p);}
// ¿Este producto está en o bajo su stock mínimo? Para productos por rollo,
// compara CANTIDAD DE ROLLOS (no metros) — usado en todos los contadores,
// reportes y alertas de "bajo stock mínimo" para que sea consistente.
function _bajoStockMinimo(p){
  const min = p.stockMinimo||0;
  if(min<=0) return false;
  const esRollos = p.metrosPorUnidad && p.rollosCentral;
  const cant = esRollos ? (p.rollosCentral?.length||0) : _stockCentral(p);
  return cant<=min;
}
function _infNum(v){ const n=parseFloat(v); if(isNaN(n)) return v; return Number.isInteger(n)?String(n):String(Math.round(n*10)/10); }
function _infCantProd(p){
  const m=parseFloat(p.metros_por_unidad)||0, c=parseFloat(p.total_cantidad)||0;
  if(m>0){ const r=Math.round(c/m*100)/100; return {n:r, txt:(Number.isInteger(r)?r:r.toFixed(1))+' rollo'+(r!==1?'s':'')}; }
  return {n:c, txt:String(p.total_cantidad)};
}
// Cantidad de un producto "por rollo": rollos completos -> "2 rollos"; una parte de rollo
// (ej. 800 m de un rollo de 1000) -> "800 m", nunca "0.8 rollos".
function cantRolloPartes(p, crudo){
  const m = parseFloat(p?.metrosPorUnidad)||0, c = parseFloat(crudo)||0;
  if(m>0 && Math.abs(c/m - Math.round(c/m)) < 1e-6){ const r = Math.round(c/m); return {n:r, suf:(r===1?'rollo':'rollos')}; }
  return {n:Math.round(c*100)/100, suf:'m'};
}
// "48 rollos + 800 m" en vez de "≈ 48.8 rollos"
function rollosYMetrosTxt(p, crudo){
  const m = parseFloat(p?.metrosPorUnidad)||0, c = parseFloat(crudo)||0;
  if(!(m>0)) return String(c);
  const n = Math.floor(c/m + 1e-9), r = Math.round((c - n*m)*100)/100;
  const a = n+' rollo'+(n===1?'':'s');
  return r>0 ? (n>0 ? a+' + '+r+' m' : r+' m') : a;
}
function valorMostrar(p, valorCrudo){
  if(p?.metrosPorUnidad && p.metrosPorUnidad>0){
    const rollos = parseFloat(valorCrudo) / parseFloat(p.metrosPorUnidad);
    const rollosRedondeado = Math.round(rollos * 100) / 100; // corrige imprecisión decimal (ej: 0.9999999 → 1)
    return Number.isInteger(rollosRedondeado) ? rollosRedondeado : rollosRedondeado.toFixed(1);
  }
  return valorCrudo;
}
function fmtDate(iso){if(!iso)return'—';try{return new Date(iso).toLocaleString('es-CO',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});}catch{return'—';}}
let _toastTimer;
function toast(msg,tipo='success'){
  const t=document.getElementById('toast');if(!t)return;
  t.textContent=msg;
  const cls={success:'#166534',error:'#B91C1C',warn:'#92400E'};
  t.style.background=cls[tipo]||cls.success;t.style.opacity='1';t.style.transform='translateY(0)';
  clearTimeout(_toastTimer);_toastTimer=setTimeout(()=>{t.style.opacity='0';t.style.transform='translateY(8px)';},3400);
}
// Alerta llamativa (modal con ícono y animación) para bloqueos importantes
// que merecen más atención que un toast pasajero — ej: "no se puede
// eliminar porque tiene X asociado".
function mostrarAlertaBloqueo(mensaje, titulo, tipo='error'){
  const paleta = {
    error: {bg:'#FCEBEB', stroke:'#B91C1C', titulo:'No se puede continuar'},
    warn:  {bg:'#FEF3C7', stroke:'#B45309', titulo:'Atención'},
  };
  const p = paleta[tipo] || paleta.error;
  const icono = document.getElementById('alertaBloqueoIcono');
  const tit = document.getElementById('alertaBloqueoTitulo');
  const msj = document.getElementById('alertaBloqueoMensaje');
  const caja = document.getElementById('alertaBloqueoCaja');
  if(icono) icono.style.background = p.bg;
  if(icono) icono.querySelector('svg')?.setAttribute('stroke', p.stroke);
  if(tit) tit.textContent = titulo || p.titulo;
  if(msj) msj.textContent = mensaje;
  // Reiniciar la animación cada vez que se abre (si no, solo se ve la primera vez)
  if(caja){ caja.style.animation='none'; void caja.offsetWidth; caja.style.animation='alertaPop .4s cubic-bezier(.34,1.56,.64,1)'; }
  if(icono){ icono.style.animation='none'; void icono.offsetWidth; icono.style.animation='alertaShake .5s ease .15s'; }
  document.getElementById('modalAlertaBloqueo')?.classList.add('open');
}

/* ════════════════════════════════════════════════
   EXCEL — hojas completas
════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════
   reportes.js — Integrados v2
   Exportación Excel profesional con SheetJS (100% cliente)
   Hojas: Dashboard · Stock · Historial · Municipios · Solicitudes · Pedidos
═══════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════
   PALETA CORPORATIVA
════════════════════════════════════════════════ */
const P = {
  azul_osc  : "FF0A58B5", azul_med : "FF0C6EDE", azul_cla : "FFE6F1FB",
  verde_osc : "FF166534", verde_med: "FF16A871", verde_cla: "FFEAF3DE",
  naranj_os : "FF92400E", naranj_me: "FFBA7517", naranj_cl: "FFFAEEDA",
  rojo_osc  : "FFB91C1C", rojo_cla : "FFFCEBEB",
  morado    : "FF7C3AED", morado_cl: "FFEDE9FE",
  gris_osc  : "FF0F172A", gris_med : "FF475569", gris_cla : "FFF1F5F9",
  blanco    : "FFFFFFFF", amarillo : "FFFFF3CD",
  slate     : "FFF8FAFC", border   : "FFE2E8F0",
};

const SEDES_REP = ["Palermo","Campoalegre","Rivera","Yaguará","Íquira","Algeciras","Teruel","Juncal"];

/* ════════════════════════════════════════════════
   HELPERS SHEETJS AVANZADOS
════════════════════════════════════════════════ */
function _s(bold=false, fg=P.gris_osc, bg=null, halign="left", sz=10, italic=false) {
  return {
    font: { name:"Arial", sz, bold, color:{rgb:fg}, italic },
    fill: bg ? { patternType:"solid", fgColor:{rgb:bg} } : undefined,
    alignment: { horizontal:halign, vertical:"center", wrapText:false },
    border: {
      top:   {style:"thin", color:{rgb:P.border}},
      bottom:{style:"thin", color:{rgb:P.border}},
      left:  {style:"thin", color:{rgb:P.border}},
      right: {style:"thin", color:{rgb:P.border}},
    }
  };
}

function _sHdr(bg=P.azul_med, sz=10) {
  return {
    font: { name:"Arial", sz, bold:true, color:{rgb:P.blanco} },
    fill: { patternType:"solid", fgColor:{rgb:bg} },
    alignment: { horizontal:"center", vertical:"center" },
    border: {
      top:   {style:"medium", color:{rgb:"FFCBD5E1"}},
      bottom:{style:"medium", color:{rgb:"FFCBD5E1"}},
      left:  {style:"medium", color:{rgb:"FFCBD5E1"}},
      right: {style:"medium", color:{rgb:"FFCBD5E1"}},
    }
  };
}

function _sTitle(bg=P.azul_osc, sz=16) {
  return {
    font: { name:"Arial", sz, bold:true, color:{rgb:P.blanco} },
    fill: { patternType:"solid", fgColor:{rgb:bg} },
    alignment: { horizontal:"center", vertical:"center" },
  };
}

function _sTarjeta(fg, bg) {
  return {
    font: { name:"Arial", sz:22, bold:true, color:{rgb:fg} },
    fill: { patternType:"solid", fgColor:{rgb:bg} },
    alignment: { horizontal:"center", vertical:"center" },
  };
}

function _sTarjetaLabel(fg, bg) {
  return {
    font: { name:"Arial", sz:9, bold:true, color:{rgb:fg} },
    fill: { patternType:"solid", fgColor:{rgb:bg} },
    alignment: { horizontal:"center", vertical:"center" },
  };
}

function _cell(v, s) {
  return { v, t: typeof v === "number" ? "n" : "s", s: s || {} };
}

function _fmtF(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-CO",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
  } catch { return iso; }
}

/* Escribe un rango de celdas con el mismo estilo */
function _fillRange(ws, r1, c1, r2, c2, style, value="") {
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const addr = XLSX.utils.encode_cell({r, c});
      if (!ws[addr]) ws[addr] = { v:"", t:"s" };
      ws[addr].s = style;
      if (value !== "") ws[addr].v = value;
    }
  }
}

/* Establece un merge en la hoja */
function _merge(ws, r1, c1, r2, c2) {
  if (!ws["!merges"]) ws["!merges"] = [];
  ws["!merges"].push({ s:{r:r1,c:c1}, e:{r:r2,c:c2} });
}

/* Escribe celda con valor + estilo */
function _wc(ws, r, c, v, s) {
  const addr = XLSX.utils.encode_cell({r, c});
  ws[addr] = { v, t: typeof v === "number" ? "n" : "s", s };
}

/* Fila de cabecera de tabla */
function _headerRow(ws, r, cols, bg=P.azul_med) {
  cols.forEach((txt, c) => _wc(ws, r, c, txt, _sHdr(bg)));
}

/* Borde de fila de totales */
function _sTotales(bg=P.azul_osc) {
  return {
    font: { name:"Arial", sz:10, bold:true, color:{rgb:P.blanco} },
    fill: { patternType:"solid", fgColor:{rgb:bg} },
    alignment: { horizontal:"center", vertical:"center" },
    border: {
      top:   {style:"medium", color:{rgb:"FFCBD5E1"}},
      bottom:{style:"medium", color:{rgb:"FFCBD5E1"}},
      left:  {style:"medium", color:{rgb:"FFCBD5E1"}},
      right: {style:"medium", color:{rgb:"FFCBD5E1"}},
    }
  };
}

/* ════════════════════════════════════════════════
   HOJA 1: DASHBOARD EJECUTIVO
════════════════════════════════════════════════ */
function _hojaDashboard(productos, historial, solicitudes, pedidos) {
  const ws = {};
  const usedRows = []; // track last row

  /* — Título principal — */
  ws["!merges"] = [];
  _merge(ws, 0, 0, 1, 9);
  _wc(ws, 0, 0, "INTEGRADOS — DASHBOARD EJECUTIVO DE INVENTARIO", _sTitle(P.azul_osc, 18));

  _merge(ws, 2, 0, 2, 9);
  _wc(ws, 2, 0,
    `Reporte generado el ${_fmtF(new Date().toISOString())}  ·  Usuario: ${(typeof sesion !== 'undefined' && sesion?.usuario) || '—'}`,
    { font:{name:"Arial",sz:10,italic:true,color:{rgb:P.gris_med}},
      fill:{patternType:"solid",fgColor:{rgb:P.azul_cla}},
      alignment:{horizontal:"center",vertical:"center"} }
  );

  /* — KPIs tarjetas — */
  const stockNeiva    = productos.reduce((s,p) => s+(_stockCentral(p)), 0);
  const totalEnvios   = historial.filter(h => h.estado === "aprobado" && !h._esGasto).length;
  const totalGastos   = historial.filter(h => h._esGasto || h._origen === "gasto").length;
  const pendSol       = solicitudes.filter(s => s.estado === "pendiente").length;
  const pendPed       = pedidos.filter(p => p.estado === "pendiente").length;
  const prodSinStock  = productos.filter(p => (_stockCentral(p)) === 0).length;
  const bajoMin       = productos.filter(_bajoStockMinimo).length;
  const totalDist     = SEDES_REP.reduce((s,se) => s+productos.reduce((a,p)=>a+(p.stock?.[se]||0),0), 0);

  const kpis = [
    { lbl:"Total Productos",         val:productos.length, fg:P.azul_osc,  bg:P.azul_cla  },
    { lbl:"Unidades en el almacén", val:stockNeiva,       fg:P.verde_osc, bg:P.verde_cla },
    { lbl:"Distribuido Municipios",  val:totalDist,        fg:P.morado,    bg:P.morado_cl },
    { lbl:"Envíos Aprobados",        val:totalEnvios,      fg:P.verde_osc, bg:P.verde_cla },
    { lbl:"Gastos Registrados",      val:totalGastos,      fg:P.naranj_os, bg:P.naranj_cl },
    { lbl:"Solicitudes Pendientes",  val:pendSol,          fg:P.naranj_os, bg:P.naranj_cl },
    { lbl:"Pedidos directos Pend.",val:pendPed,          fg:P.morado,    bg:P.morado_cl },
    { lbl:"Productos Sin Stock",     val:prodSinStock,     fg:P.rojo_osc,  bg:P.rojo_cla  },
    { lbl:"Bajo Stock Mínimo",       val:bajoMin,          fg:P.naranj_os, bg:P.naranj_cl },
  ];

  /* 3 columnas x 3 filas de tarjetas, ancho 2 columnas c/u */
  _merge(ws, 4, 0, 4, 9);
  _wc(ws, 4, 0, "INDICADORES CLAVE (KPIs)", _sHdr(P.gris_osc, 11));

  let tarRow = 5;
  kpis.forEach((k, i) => {
    const col = (i % 3) * 3;
    const row = tarRow + Math.floor(i / 3) * 3;
    _merge(ws, row, col, row, col+2);
    _merge(ws, row+1, col, row+1, col+2);
    _wc(ws, row,   col, k.lbl, _sTarjetaLabel(k.fg, k.bg));
    _wc(ws, row+1, col, k.val, _sTarjeta(k.fg, k.bg));
    /* borde inferior decorativo */
    for (let c=col;c<=col+2;c++) {
      const a=XLSX.utils.encode_cell({r:row+2,c});
      ws[a]={v:"",t:"s",s:{fill:{patternType:"solid",fgColor:{rgb:k.bg}},border:{bottom:{style:"medium",color:{rgb:k.fg}}}}};
    }
  });
  tarRow += 10;

  /* — Tabla: Stock por municipio (resumen) — */
  const munRow = tarRow + 1;
  _merge(ws, munRow, 0, munRow, 9);
  _wc(ws, munRow, 0, "STOCK DISTRIBUIDO POR MUNICIPIO", _sHdr(P.morado, 11));

  _wc(ws, munRow+1, 0, "Municipio", _sHdr(P.morado));
  _wc(ws, munRow+1, 1, "Unidades en sede", _sHdr(P.morado));
  _wc(ws, munRow+1, 2, "% del total distribuido", _sHdr(P.morado));
  _wc(ws, munRow+1, 3, "Productos con stock > 0", _sHdr(P.morado));

  const altStyles = [P.morado_cl, P.blanco];
  SEDES_REP.forEach((sede, i) => {
    const r = munRow+2+i;
    const unidades = productos.reduce((s,p)=>s+(p.stock?.[sede]||0),0);
    const conStock = productos.filter(p=>(p.stock?.[sede]||0)>0).length;
    const pct      = totalDist > 0 ? ((unidades/totalDist)*100).toFixed(1)+"%" : "0%";
    const bg       = altStyles[i%2];
    _wc(ws, r, 0, sede,            _s(true,  P.gris_osc, bg));
    _wc(ws, r, 1, unidades,        _s(false, P.azul_med, bg, "center"));
    _wc(ws, r, 2, pct,             _s(false, P.gris_med, bg, "center"));
    _wc(ws, r, 3, conStock,        _s(false, P.gris_med, bg, "center"));
  });

  /* Fila total municipios */
  const totMunRow = munRow+2+SEDES_REP.length;
  _wc(ws, totMunRow, 0, "TOTAL", _sTotales(P.morado));
  _wc(ws, totMunRow, 1, totalDist, _sTotales(P.morado));
  _wc(ws, totMunRow, 2, "100%",   _sTotales(P.morado));
  _wc(ws, totMunRow, 3, "", _sTotales(P.morado));

  /* — Tabla: Top productos más distribuidos — */
  const topRow = totMunRow + 2;
  _merge(ws, topRow, 0, topRow, 9);
  _wc(ws, topRow, 0, "TOP PRODUCTOS — MAYOR DISTRIBUCIÓN TOTAL", _sHdr(P.verde_osc, 11));

  _headerRow(ws, topRow+1, ["Ref","Nombre","Unidad","Stock Almacén","Total Distribuido","Sedes con Stock"], P.verde_med);

  const topProds = [...productos]
    .map(p => ({
      ...p,
      totalDist: SEDES_REP.reduce((s,se)=>s+(p.stock?.[se]||0),0),
      sedesConStock: SEDES_REP.filter(se=>(p.stock?.[se]||0)>0).length
    }))
    .sort((a,b) => b.totalDist - a.totalDist)
    .slice(0, 8);

  topProds.forEach((p,i) => {
    const r = topRow+2+i;
    const bg = i%2===0 ? P.verde_cla : P.blanco;
    _wc(ws, r, 0, p.ref,         _s(true,  P.gris_osc, bg));
    _wc(ws, r, 1, p.nombre,      _s(false, P.gris_osc, bg));
    _wc(ws, r, 2, p.unidad==="metros"?"Metros":"Unidad", _s(false, P.gris_med, bg, "center"));
    _wc(ws, r, 3, _stockCentral(p), _s(false, P.azul_med, bg, "center"));
    _wc(ws, r, 4, p.totalDist,   _s(true,  P.verde_osc, bg, "center"));
    _wc(ws, r, 5, p.sedesConStock, _s(false, P.gris_med, bg, "center"));
  });

  /* — Tabla: Alertas — */
  const alertRow = topRow+2+topProds.length+2;
  const bajoMinProds = productos.filter(_bajoStockMinimo);
  const sinStockProds = productos.filter(p=>(_stockCentral(p))===0);

  if (bajoMinProds.length || sinStockProds.length) {
    _merge(ws, alertRow, 0, alertRow, 9);
    _wc(ws, alertRow, 0, `⚠  ALERTAS DE INVENTARIO — ${bajoMinProds.length} bajo mínimo · ${sinStockProds.length} sin stock`,
      { font:{name:"Arial",sz:11,bold:true,color:{rgb:P.naranj_os}},
        fill:{patternType:"solid",fgColor:{rgb:P.naranj_cl}},
        alignment:{horizontal:"center",vertical:"center"},
        border:{bottom:{style:"medium",color:{rgb:P.naranj_me}}} }
    );

    _headerRow(ws, alertRow+1, ["Ref","Nombre","Unidad","Stock Almacén","Stock Mínimo","Diferencia","Estado"], P.naranj_me);

    const alertas = [...sinStockProds.map(p=>({...p,estado:"SIN STOCK",bg:P.rojo_cla,fc:P.rojo_osc})),
                     ...bajoMinProds.filter(p=>(_stockCentral(p))>0).map(p=>({...p,estado:"BAJO MÍNIMO",bg:P.naranj_cl,fc:P.naranj_os}))];

    alertas.forEach((p,i) => {
      const r = alertRow+2+i;
      const sn = _stockCentral(p);
      _wc(ws, r, 0, p.ref,              _s(true,  P.rojo_osc, p.bg));
      _wc(ws, r, 1, p.nombre,           _s(false, P.gris_osc, p.bg));
      _wc(ws, r, 2, p.unidad==="metros"?"Metros":"Unidad", _s(false, P.gris_med, p.bg, "center"));
      _wc(ws, r, 3, sn,                 _s(true,  p.fc,       p.bg, "center"));
      _wc(ws, r, 4, p.stockMinimo||0,   _s(false, P.gris_med, p.bg, "center"));
      _wc(ws, r, 5, sn-(p.stockMinimo||0), _s(true, p.fc, p.bg, "center"));
      _wc(ws, r, 6, p.estado,           _s(true,  p.fc,       p.bg, "center"));
    });
  }

  ws["!cols"] = [{wch:12},{wch:32},{wch:12},{wch:18},{wch:22},{wch:20},{wch:18},{wch:14},{wch:14},{wch:14}];
  ws["!rows"] = [{hpt:42},{hpt:30},{hpt:22}];

  /* ref final */
  const lastR = alertRow + 2 + (bajoMinProds.length||1) + 2;
  ws["!ref"] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:lastR+5,c:9}});
  return ws;
}

/* ════════════════════════════════════════════════
   HOJA 2: STOCK POR PRODUCTO
════════════════════════════════════════════════ */
function _hojaStock(productos) {
  const ws = {};
  ws["!merges"] = [];

  _merge(ws, 0, 0, 1, 5);
  _wc(ws, 0, 0, "STOCK ACTUAL POR PRODUCTO — NEIVA", _sTitle(P.azul_osc));

  _headerRow(ws, 2, ["Ref","Nombre","Proveedor","Unidad","Stock Almacén","Stock Mín.","Estado"], P.azul_med);

  let r = 3;
  productos.forEach((p, i) => {
    const sn  = _stockCentral(p);
    const min = p.stockMinimo||0;
    let est = "Normal", fg = P.verde_osc, bg = i%2===0 ? P.gris_cla : P.blanco;
    if (sn === 0)         { est="Sin stock";   fg=P.rojo_osc;  bg=P.rojo_cla; }
    else if (min>0&&sn<=min){ est="Bajo mínimo";fg=P.naranj_os; bg=P.naranj_cl; }

    _wc(ws, r, 0, p.ref,                          _s(true,  P.gris_osc, bg));
    _wc(ws, r, 1, p.nombre,                        _s(false, P.gris_osc, bg));
    _wc(ws, r, 2, p.proveedor||'—',               _s(false, P.gris_med, bg));
    _wc(ws, r, 3, p.unidad==="metros"?"Metros":"Unidad", _s(false, P.gris_med, bg, "center"));
    _wc(ws, r, 4, sn,                              _s(false, P.azul_med, bg, "center"));
    _wc(ws, r, 5, min||0,                          _s(false, P.gris_med, bg, "center"));
    _wc(ws, r, 6, est,                             _s(true,  fg,         bg, "center"));
    r++;
  });

  /* Totales */
  _wc(ws, r, 0, "TOTAL", _sTotales());
  _wc(ws, r, 1, `${productos.length} productos`, _sTotales());
  _wc(ws, r, 2, "", _sTotales());
  _wc(ws, r, 3, "", _sTotales());
  _wc(ws, r, 4, productos.reduce((s,p)=>s+(_stockCentral(p)),0), _sTotales());
  _wc(ws, r, 5, "", _sTotales());
  _wc(ws, r, 6, "", _sTotales());

  ws["!cols"] = [{wch:14},{wch:34},{wch:20},{wch:12},{wch:14},{wch:14},{wch:16}];
  ws["!rows"] = [{hpt:30},{hpt:14},{hpt:22}];
  ws["!ref"]  = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:r+1,c:6}});
  return ws;
}

/* ════════════════════════════════════════════════
   HOJA 3: HISTORIAL ENVÍOS
════════════════════════════════════════════════ */
function _hojaHistorial(historial, productos) {
  const ws = {};
  ws["!merges"] = [];

  _merge(ws, 0, 0, 1, 8);
  _wc(ws, 0, 0, "HISTORIAL COMPLETO DE ENVÍOS Y GASTOS", _sTitle(P.verde_osc));

  /* Subtotales rápidos */
  const aprobados = historial.filter(h=>h.estado==="aprobado"&&!h._esGasto).length;
  const gastos    = historial.filter(h=>h._esGasto||h._origen==="gasto").length;
  const rechazados= historial.filter(h=>h.estado==="rechazado").length;

  _merge(ws, 2, 0, 2, 2);
  _wc(ws, 2, 0, `Aprobados: ${aprobados}`, _s(true, P.verde_osc, P.verde_cla, "center"));
  _merge(ws, 2, 3, 2, 5);
  _wc(ws, 2, 3, `Gastos: ${gastos}`, _s(true, P.naranj_os, P.naranj_cl, "center"));
  _merge(ws, 2, 6, 2, 8);
  _wc(ws, 2, 6, `Rechazados / Pendientes: ${rechazados}`, _s(true, P.rojo_osc, P.rojo_cla, "center"));

  _headerRow(ws, 3, ["Ref","Nombre","Proveedor","Destino/Sede","Cantidad","Enviado por","Movimiento","Descripción","Fecha"], P.verde_med);

  const sorted = [...historial].sort((a,b) => new Date(b.fecha)-new Date(a.fecha));
  sorted.forEach((h, i) => {
    const r = 4+i;
    const esGasto = h._esGasto||h._origen==="gasto";
    const esVentaExp = h.es_venta==1;
    const tipo    = esVentaExp ? "💰 Venta" : esGasto ? "💸 Gasto" : h._origen==="directo" ? "📦 Directo" : "✅ Aprobado";
    const estado  = esVentaExp ? "Vendido" : esGasto ? "Gastado" : (h.estado||"—");
    const sfx     = h.unidadEnvio==="metros" ? "mts." : "uds.";
    let desc = h.descripcion||"";
    if (!desc) { const p=productos.find(x=>x.ref===h.ref); desc=p?.descripcion||""; }

    let bg = i%2===0 ? P.gris_cla : P.blanco;
    let estadoFg = P.verde_osc, estadoBg = P.verde_cla;
    if (esGasto)                { bg=P.amarillo; estadoFg=P.naranj_os; estadoBg=P.naranj_cl; }
    else if (h.estado==="rechazado") { estadoFg=P.rojo_osc; estadoBg=P.rojo_cla; }
    else if (h.estado==="pendiente") { estadoFg=P.naranj_os; estadoBg=P.naranj_cl; }

    const prov = h.proveedor || (productos.find(x=>x.ref===h.ref)?.proveedor) || '—';
    _wc(ws, r, 0, h.ref||"—",           _s(true,  P.gris_osc, bg));
    _wc(ws, r, 1, h.nombre||"—",         _s(false, P.gris_osc, bg));
    _wc(ws, r, 2, prov,                  _s(false, P.gris_med, bg));
    _wc(ws, r, 3, h.destino||"—",        _s(false, P.azul_med, bg));
    _wc(ws, r, 4, `${h.cantidad||0} ${sfx}`, _s(true, P.gris_osc, bg, "center"));
    _wc(ws, r, 5, h.enviadoPor||"—",     _s(false, P.gris_med, bg));
    _wc(ws, r, 6, estado,                _s(true,  estadoFg,   estadoBg, "center"));
    _wc(ws, r, 7, desc||"—",             _s(false, P.gris_med, bg));
    _wc(ws, r, 8, _fmtF(h.fecha),        _s(false, P.gris_med, bg, "center"));
  });

  ws["!cols"] = [{wch:12},{wch:30},{wch:20},{wch:16},{wch:14},{wch:20},{wch:14},{wch:32},{wch:20}];
  ws["!rows"] = [{hpt:30},{hpt:14},{hpt:22}];
  ws["!ref"]  = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:4+sorted.length,c:8}});
  return ws;
}

/* ════════════════════════════════════════════════
   HOJA 4: STOCK POR MUNICIPIO
════════════════════════════════════════════════ */
function _hojaStockMunicipios(productos) {
  const ws = {};
  ws["!merges"] = [];
  const totalCols = 2+SEDES_REP.length+1;

  _merge(ws, 0, 0, 1, totalCols-1);
  _wc(ws, 0, 0, "STOCK DISTRIBUIDO POR MUNICIPIO", _sTitle(P.morado));

  _headerRow(ws, 2, ["Ref","Nombre",...SEDES_REP,"Total Dist."], P.morado);

  let r = 3;
  productos.forEach((p, i) => {
    const stocks = SEDES_REP.map(s=>p.stock?.[s]||0);
    const total  = stocks.reduce((a,b)=>a+b,0);
    const bg     = i%2===0 ? P.morado_cl+"55" : P.blanco; // ligero tinte

    _wc(ws, r, 0, p.ref,    _s(true, P.gris_osc, i%2===0?P.gris_cla:P.blanco));
    _wc(ws, r, 1, p.nombre, _s(false,P.gris_osc, i%2===0?P.gris_cla:P.blanco));

    stocks.forEach((v, si) => {
      let fg = P.gris_med, cellBg = i%2===0?P.gris_cla:P.blanco;
      if (v === 0)   { fg=P.rojo_osc;  cellBg=P.rojo_cla; }
      else if (v>=5) { fg=P.verde_osc; cellBg=P.verde_cla; }
      else           { fg=P.naranj_os; cellBg=P.naranj_cl; }
      _wc(ws, r, 2+si, v, _s(false, fg, cellBg, "center"));
    });
    _wc(ws, r, 2+SEDES_REP.length, total, _s(true, P.morado, P.morado_cl, "center"));
    r++;
  });

  /* Totales */
  const totStyle = _sTotales(P.morado);
  _wc(ws, r, 0, "TOTALES", totStyle);
  _wc(ws, r, 1, `${productos.length} productos`, totStyle);
  SEDES_REP.forEach((se, si) => {
    const tot = productos.reduce((s,p)=>s+(p.stock?.[se]||0),0);
    _wc(ws, r, 2+si, tot, totStyle);
  });
  _wc(ws, r, 2+SEDES_REP.length,
    productos.reduce((s,p)=>s+SEDES_REP.reduce((a,se)=>a+(p.stock?.[se]||0),0),0),
    totStyle);

  ws["!cols"] = [{wch:12},{wch:30},...SEDES_REP.map(()=>({wch:13})),{wch:14}];
  ws["!rows"] = [{hpt:30},{hpt:14},{hpt:22}];
  ws["!ref"]  = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:r+1,c:totalCols}});
  return ws;
}

/* ════════════════════════════════════════════════
   HOJA 5: SOLICITUDES
════════════════════════════════════════════════ */
function _holaSolicitudes(solicitudes) {
  const ws = {};
  ws["!merges"] = [];

  _merge(ws, 0, 0, 1, 7);
  _wc(ws, 0, 0, "HISTORIAL DE SOLICITUDES DE ENVÍO", _sTitle(P.naranj_me));

  /* Contadores */
  const pend = solicitudes.filter(s=>s.estado==="pendiente").length;
  const apro = solicitudes.filter(s=>s.estado==="aprobada").length;
  const rech = solicitudes.filter(s=>s.estado==="rechazada").length;
  _merge(ws, 2, 0, 2, 2);
  _wc(ws, 2, 0, `Pendientes: ${pend}`, _s(true, P.naranj_os, P.naranj_cl, "center"));
  _merge(ws, 2, 3, 2, 5);
  _wc(ws, 2, 3, `Aprobadas: ${apro}`, _s(true, P.verde_osc, P.verde_cla, "center"));
  _merge(ws, 2, 6, 2, 7);
  _wc(ws, 2, 6, `Rechazadas: ${rech}`, _s(true, P.rojo_osc, P.rojo_cla, "center"));

  _headerRow(ws, 3, ["Ref","Nombre","Destino","Cantidad","Solicitado por","Estado","Motivo","Fecha"], P.naranj_me);

  const sorted = [...solicitudes].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  sorted.forEach((s, i) => {
    const r    = 4+i;
    const sfx  = s.unidadEnvio==="metros"?"mts.":"uds.";
    const labs = {aprobada:"Aprobada ✓",rechazada:"Rechazada",pendiente:"Pendiente"};
    let fg=P.naranj_os,bg=P.naranj_cl;
    if (s.estado==="aprobada")  { fg=P.verde_osc; bg=P.verde_cla; }
    if (s.estado==="rechazada") { fg=P.rojo_osc;  bg=P.rojo_cla; }
    const rowBg = i%2===0 ? P.gris_cla : P.blanco;

    _wc(ws, r, 0, s.ref||"—",           _s(true,  P.gris_osc, rowBg));
    _wc(ws, r, 1, s.nombre||"—",         _s(false, P.gris_osc, rowBg));
    _wc(ws, r, 2, s.destino||"—",        _s(false, P.azul_med, rowBg));
    _wc(ws, r, 3, `${s.cantidad||0} ${sfx}`, _s(true, P.gris_osc, rowBg, "center"));
    _wc(ws, r, 4, s.solicitadoPor||"—",  _s(false, P.gris_med, rowBg));
    _wc(ws, r, 5, labs[s.estado]||s.estado, _s(true, fg, bg, "center"));
    _wc(ws, r, 6, s.motivo||"—",         _s(false, P.gris_med, rowBg));
    _wc(ws, r, 7, _fmtF(s.fecha),         _s(false, P.gris_med, rowBg, "center"));
  });

  ws["!cols"] = [{wch:12},{wch:30},{wch:16},{wch:14},{wch:22},{wch:16},{wch:32},{wch:20}];
  ws["!rows"] = [{hpt:30},{hpt:14},{hpt:22}];
  ws["!ref"]  = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:4+sorted.length,c:7}});
  return ws;
}

/* ════════════════════════════════════════════════
   HOJA 6: PEDIDOS MUNICIPIOS
════════════════════════════════════════════════ */
function _holaPedidosMunicipios(pedidos) {
  const ws = {};
  ws["!merges"] = [];

  _merge(ws, 0, 0, 1, 7);
  _wc(ws, 0, 0, "PEDIDOS DE MUNICIPIOS AL ALMACÉN", _sTitle("FF5B21B6"));

  const pend = pedidos.filter(p=>p.estado==="pendiente").length;
  const aten = pedidos.filter(p=>p.estado==="atendido").length;
  const rech = pedidos.filter(p=>p.estado==="rechazado").length;
  const gest = pedidos.filter(p=>p.estado==="en_gestion").length;

  _merge(ws, 2, 0, 2, 1);
  _wc(ws, 2, 0, `Pendientes: ${pend}`, _s(true, P.naranj_os, P.naranj_cl, "center"));
  _merge(ws, 2, 2, 2, 3);
  _wc(ws, 2, 2, `En gestión: ${gest}`, _s(true, P.azul_osc, P.azul_cla, "center"));
  _merge(ws, 2, 4, 2, 5);
  _wc(ws, 2, 4, `Atendidos: ${aten}`, _s(true, P.verde_osc, P.verde_cla, "center"));
  _merge(ws, 2, 6, 2, 7);
  _wc(ws, 2, 6, `Rechazados: ${rech}`, _s(true, P.rojo_osc, P.rojo_cla, "center"));

  _headerRow(ws, 3, ["Ref","Nombre","Municipio","Cantidad","Solicitado por","Estado","Justificación / Motivo","Fecha"], P.morado);

  const sorted = [...pedidos].sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
  sorted.forEach((p, i) => {
    const r   = 4+i;
    const sfx = p.unidadPedido==="metros"?"mts.":"uds.";
    const labs = {pendiente:"Pendiente",en_gestion:"En gestión",atendido:"Atendido ✓",rechazado:"Rechazado"};
    let fg=P.naranj_os,bg=P.naranj_cl;
    if (p.estado==="atendido")   { fg=P.verde_osc; bg=P.verde_cla; }
    if (p.estado==="rechazado")  { fg=P.rojo_osc;  bg=P.rojo_cla; }
    if (p.estado==="en_gestion") { fg=P.azul_osc;  bg=P.azul_cla; }
    const rowBg = i%2===0 ? P.gris_cla : P.blanco;

    _wc(ws, r, 0, p.ref||"—",            _s(true,  P.gris_osc, rowBg));
    _wc(ws, r, 1, p.nombre||"—",          _s(false, P.gris_osc, rowBg));
    _wc(ws, r, 2, p.municipio||"—",       _s(false, P.morado,   rowBg));
    _wc(ws, r, 3, `${p.cantidad||0} ${sfx}`, _s(true, P.gris_osc, rowBg, "center"));
    _wc(ws, r, 4, p.solicitadoPor||"—",   _s(false, P.gris_med, rowBg));
    _wc(ws, r, 5, labs[p.estado]||p.estado, _s(true, fg, bg, "center"));
    _wc(ws, r, 6, p.justificacion||p.motivo||"—", _s(false, P.gris_med, rowBg));
    _wc(ws, r, 7, _fmtF(p.fecha),          _s(false, P.gris_med, rowBg, "center"));
  });

  ws["!cols"] = [{wch:12},{wch:30},{wch:16},{wch:14},{wch:22},{wch:16},{wch:34},{wch:20}];
  ws["!rows"] = [{hpt:30},{hpt:14},{hpt:22}];
  ws["!ref"]  = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:4+sorted.length,c:7}});
  return ws;
}

/* ════════════════════════════════════════════════
   EXPORTAR — función principal (reemplaza la anterior)
════════════════════════════════════════════════ */
async function generarReporteExcelConFiltros(filtros={}) {
  if (typeof XLSX === "undefined") {
    toast("Cargando librería de exportación… intenta de nuevo en unos segundos.", "warn");
    return;
  }

  const enRango = fecha => {
    if(!fecha) return true;
    const d = new Date(fecha);
    if(filtros.desde && d < new Date(filtros.desde)) return false;
    if(filtros.hasta && d > new Date(filtros.hasta+'T23:59:59')) return false;
    return true;
  };
  const porSede     = s => !filtros.sede    || s===filtros.sede;
  const porEstado   = s => !filtros.estado  || s===filtros.estado;
  const porProducto = n => !filtros.producto|| (n||'').toLowerCase().includes(filtros.producto);

  let productos   = getProductos();
  let historial   = ((window._extrasExcel && window._extrasExcel.historialTodo && window._extrasExcel.historialTodo.length) ? window._extrasExcel.historialTodo : getHistorial()).filter(h=>enRango(h.fecha)&&porSede(h.destino)&&porEstado(h.estado)&&porProducto(h.nombre));
  let solicitudes = getSolicitudes().filter(s=>enRango(s.fecha)&&porSede(s.destino)&&porEstado(s.estado)&&porProducto(s.nombre));
  let pedidos     = getPedidosMun().filter(p=>enRango(p.fecha)&&porSede(p.municipio)&&porEstado(p.estado)&&porProducto(p.nombre));

  if (!productos.length && !historial.length) {
    toast("No hay datos para exportar.", "warn");
    return;
  }

  toast("Generando reporte Excel profesional…", "warn");

  setTimeout(() => {
    try {
      const wb = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(wb, _hojaDashboard(productos, historial, solicitudes, pedidos), "📊 Dashboard");
      XLSX.utils.book_append_sheet(wb, _hojaStock(productos),                                       "📦 Stock Almacén");
      XLSX.utils.book_append_sheet(wb, _hojaHistorial(historial, productos),                        "📋 Historial Envíos");
      // Stock de las OFICINAS (usuarios tipo municipio) y de técnicos/personas — lo que realmente tiene cada uno
      const stockU = (window._extrasExcel && window._extrasExcel.stockUsuarios) || [];
      const mapaStock = {usuario:'Usuario',nombre:'Nombre',sede:'Sede',ref:'Ref',producto:'Producto',cantidad:'Cantidad',unidad:'Unidad'};
      const stockMun = stockU.filter(x=>x.rol==='municipio');
      const stockOtros = stockU.filter(x=>x.rol!=='municipio');
      XLSX.utils.book_append_sheet(wb, stockMun.length ? _hojaTabla('Stock Municipios', stockMun, mapaStock) : XLSX.utils.aoa_to_sheet([['Las oficinas (municipio) no tienen stock en este momento.']]), "🏘 Stock Municipios");
      if(stockOtros.length) XLSX.utils.book_append_sheet(wb, _hojaTabla('Stock Técnicos', stockOtros, {...mapaStock, rol:'Rol'}), "🔧 Stock Técnicos");
      XLSX.utils.book_append_sheet(wb, _holaSolicitudes(solicitudes),                               "📨 Solicitudes");
      XLSX.utils.book_append_sheet(wb, _holaPedidosMunicipios(pedidos),                             "🛒 Pedidos directos");

      // Hoja de Seguimiento
      XLSX.utils.book_append_sheet(wb, _hojaSeguimiento(_seguimiento || []), "🚚 Seguimiento");

      // ONT y Fibra - cargados previamente
      const ontData  = window._ontData  || [];
      const fibraData= window._fibraData|| [];
      if(ontData.length)  XLSX.utils.book_append_sheet(wb, _hojaONT(ontData),   "📡 ONT Seriales");
      if(fibraData.length)XLSX.utils.book_append_sheet(wb, _hojaFibra(fibraData),"🔵 Fibra Carretes");

      // Hojas extra (proveedores, clientes/proyectos, usuarios, sedes, OLT, equipos, material recogido)
      const ex = window._extrasExcel || {};
      [
        ['🏪 Proveedores',          ex.proveedores,  null],
        ['👷 Clientes-Proyectos',   ex.proyectos,    {proyecto_cliente:'Cliente / Proyecto',telefono:'Teléfono',descripcion:'Descripción',creado_por:'Creado por',total_movimientos:'Movimientos (gastos)',total_personas:'Personas que gastaron',ultima_fecha:'Última actividad'}],
        ['👥 Usuarios',             ex.usuarios,     {usuario:'Usuario',nombre:'Nombre',apellido:'Apellido',rol:'Rol',cargo:'Cargo',sede:'Sede',estado:'Estado',correo:'Correo',telefono:'Teléfono',creado_en:'Creado'}],
        ['🏢 Sedes',                ex.sedes,        {nombre:'Sede',tipo:'Tipo',activa:'Activa'}],
        ['🖧 OLT',                  ex.olts,         null],
        ['📦 Equipos (Mikrotik)',   ex.mikrotiks,    null],
        ['♻️ Material recogido',    ex.recogido,     {usuario:'Usuario',ref:'Ref',nombre:'Producto',cantidad:'Cantidad',tipo:'Tipo',estado:'Estado',motivo:'Motivo',fecha:'Fecha'}],
      ].forEach(([nombreHoja, filas, mapa]) => {
        if(Array.isArray(filas) && filas.length){
          try{ XLSX.utils.book_append_sheet(wb, _hojaTabla(nombreHoja, filas, mapa), nombreHoja); }
          catch(eh){ console.error('[Excel] hoja extra', nombreHoja, eh); }
        }
      });
      const fecha  = new Date().toISOString().slice(0, 10);
      const nombre = `Integrados_Reporte_${fecha}.xlsx`;

      XLSX.writeFile(wb, nombre);
      toast(`✅ Reporte exportado correctamente: ${nombre}`, "success");

    } catch (e) {
      console.error("[Integrados] Error al generar Excel:", e);
      toast("Error al generar el reporte. Revisa la consola (F12).", "error");
    }
  }, 60);
}

/* ════════════════════════════════════════════════
   HOJA: SEGUIMIENTO DE ENVÍOS
════════════════════════════════════════════════ */
function _hojaSeguimiento(segs) {
  const ws = {};
  const cols = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const hdrs = ['Producto','Ref','Cantidad','Unidad','Origen','Destino','Transportador','Estado','Aprobado','Enviado','Recibido por','Fecha recibido'];

  // Título
  ws['A1'] = _cell('🚚 SEGUIMIENTO DE ENVÍOS', _sTitle(P.azul_osc, 14));
  ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:11}}];

  // Encabezados
  hdrs.forEach((h,i) => {
    ws[cols[i]+'2'] = _cell(h, _sHdr(P.azul_med));
  });

  const estadoColor = {
    aprobado:  P.naranj_me,
    en_camino: P.azul_med,
    recibido:  P.verde_med,
  };

  segs.forEach((s,r) => {
    const row = r + 3;
    const bg = r%2===0 ? P.slate : P.blanco;
    const est = s.estado || 'aprobado';
    const estLabel = est==='aprobado'?'⏳ Aprobado':est==='en_camino'?'🚚 En camino':'✅ Recibido';
    const vals = [
      s.nombre_producto||'—', s.ref_producto||'—',
      s.cantidad||0, s.unidad||'unidad',
      s.origen||'—', s.destino||'—',
      s.transportador||'—', estLabel,
      _fmtF(s.fecha_aprobado), _fmtF(s.fecha_envio),
      s.recibido_por||'—', _fmtF(s.fecha_recibido)
    ];
    vals.forEach((v,i) => {
      const stl = i===7
        ? _s(true, P.blanco, estadoColor[est]||P.gris_med, 'center')
        : _s(false, P.gris_osc, bg);
      ws[cols[i]+row] = _cell(v, stl);
    });
  });

  const lastRow = segs.length + 2;
  ws['!ref'] = `A1:L${lastRow}`;
  ws['!cols'] = [28,10,10,8,14,14,20,14,18,18,16,18].map(w=>({wch:w}));
  ws['!rows'] = [{hpt:30},{hpt:22}];
  return ws;
}

/* ════════════════════════════════════════════════
   HOJA: ONT SERIALES
════════════════════════════════════════════════ */
function _hojaONT(onts) {
  const ws = {};
  const cols = ['A','B','C','D','E','F','G','H','I'];
  const hdrs = ['MAC','MAC Formato','Serial (SN)','Estado','Sede actual','Enviado a','Enviado por','Registrado por','Fecha'];

  ws['A1'] = _cell('📡 ONT SERIALES', _sTitle(P.morado, 14));
  ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:8}}];
  hdrs.forEach((h,i) => ws[cols[i]+'2'] = _cell(h, _sHdr(P.morado)));

  const estColor = {disponible: P.verde_cla, ocupado: P.naranj_cl, dañado: P.rojo_cla};
  onts.forEach((o,r) => {
    const row = r + 3;
    const bg = r%2===0 ? P.slate : P.blanco;
    const vals = [
      o.mac||'—', o.mac_fmt||'—', o.sn||'—',
      o.estado||'—', o.sede_actual||'—',
      o.enviado_a||'—', o.enviado_por||'—',
      o.registrado_por||'—', _fmtF(o.fecha)
    ];
    vals.forEach((v,i) => {
      const stl = i===3 ? _s(true, P.gris_osc, estColor[o.estado]||bg, 'center') : _s(false, P.gris_osc, bg);
      ws[cols[i]+row] = _cell(v, stl);
    });
  });

  const lastRow = onts.length + 2;
  ws['!ref'] = `A1:I${lastRow}`;
  ws['!cols'] = [18,14,18,12,14,14,14,16,18].map(w=>({wch:w}));
  ws['!rows'] = [{hpt:30},{hpt:22}];
  return ws;
}

/* ════════════════════════════════════════════════
   HOJA: FIBRA CARRETES
════════════════════════════════════════════════ */
function _hojaFibra(fibra) {
  const ws = {};
  const cols = ['A','B','C','D','E','F','G','H'];
  const hdrs = ['Código','Categoría','Metros totales','Metros usados','Disponibles','Sede','Estado','Fecha'];

  ws['A1'] = _cell('🔵 FIBRA - CARRETES', _sTitle('FF0F766E', 14));
  ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:7}}];
  hdrs.forEach((h,i) => ws[cols[i]+'2'] = _cell(h, _sHdr('FF0F766E')));

  fibra.forEach((f,r) => {
    const row = r + 3;
    const bg = r%2===0 ? P.slate : P.blanco;
    const metros = parseFloat(f.metros)||0;
    const usados = parseFloat(f.metros_usados)||0;
    const disp   = metros - usados;
    const vals = [
      f.codigo||'—', f.cat_nombre||f.categoria||f.categoria_nombre||'—',
      metros, usados, disp,
      f.sede_nombre||'—', f.estado||'—', _fmtF(f.fecha)
    ];
    vals.forEach((v,i) => {
      const stl = (i===2||i===3||i===4)
        ? _s(true, P.gris_osc, bg, 'center')
        : _s(false, P.gris_osc, bg);
      ws[cols[i]+row] = _cell(v, stl);
    });
  });

  const lastRow = fibra.length + 2;
  ws['!ref'] = `A1:H${lastRow}`;
  ws['!cols'] = [16,18,14,14,14,14,12,18].map(w=>({wch:w}));
  ws['!rows'] = [{hpt:30},{hpt:22}];
  return ws;
}


// Hoja simple tipo tabla: mapa = {campo:'Encabezado'} o null para usar todos los campos simples tal cual.
function _hojaTabla(titulo, filas, mapa){
  let claves = mapa ? Object.keys(mapa) : Object.keys(filas[0]||{}).filter(k=>{
    const v = filas[0][k]; return v===null || ['string','number','boolean'].includes(typeof v);
  });
  const pretty = k => mapa ? mapa[k] : k.replace(/_/g,' ').replace(/^./,c=>c.toUpperCase());
  const datos = filas.map(f=>{
    const o = {};
    claves.forEach(k=>{ let v=f[k]; if(v===undefined||v===null) v=''; o[pretty(k)] = v; });
    return o;
  });
  const ws = XLSX.utils.json_to_sheet(datos);
  ws['!cols'] = claves.map(k=>({wch: Math.min(40, Math.max(12, String(pretty(k)).length+2))}));
  return ws;
}

async function _cargarExtrasExcel(){
  const get = async (url) => { try{ const r = await fetch(url,{credentials:'same-origin'}); const d = await r.json(); return Array.isArray(d)?d:[]; }catch(e){ return []; } };
  const [proveedores, proyectos, usuarios, sedes, olts, mikrotiks, recogido] = await Promise.all([
    get('api/proveedores.php?action=listar'),
    get('api/historial.php?action=listar_proyectos'),
    get('api/usuarios.php?action=listar'),
    get('api/sedes.php?action=listar'),
    get('api/equipos.php?action=listar_olts'),
    get('api/equipos.php?action=listar_mikrotiks'),
    get('api/productos.php?action=material_recogido_admin'),
  ]);
  // Historial COMPLETO (la pantalla lo trae paginado; aquí se piden todas las páginas)
  let historialTodo = [];
  try{
    for(let pag=1; pag<=300; pag++){
      const r = await fetch(`api/historial.php?action=listar&pagina=${pag}&por_pagina=100`,{credentials:'same-origin'});
      const d = await r.json();
      const regs = Array.isArray(d) ? d : (d.registros||[]);
      historialTodo = historialTodo.concat(regs);
      if(Array.isArray(d) || pag >= (d.paginas||1)) break;
    }
  }catch(e){ console.error('[Excel] historial', e); }
  const stockUsuarios = await get('api/productos.php?action=stock_por_usuario');
  window._extrasExcel = {proveedores, proyectos, usuarios, sedes, olts, mikrotiks, recogido, historialTodo, stockUsuarios};
}

function exportarExcel(){
  if(typeof XLSX==='undefined'){toast('Librería Excel no cargada, reintenta.','warn');return;}
  toast('Generando reporte…','warn');
  Promise.all([
    _recargarProductos(),_recargarHistorial(),_recargarSolicitudes(),
    _recargarPedidos(),_recargarSeguimiento(),
    _api('seriales','listar_todos').then(d=>window._ontData=d||[]).catch(()=>window._ontData=[]),
    _api('fibra','listar_carretes').then(d=>window._fibraData=d||[]).catch(()=>window._fibraData=[]),
    _cargarExtrasExcel()
  ]).then(()=>setTimeout(()=>generarReporteExcelConFiltros({}),100));
}



// Abre la ventana del reporte Excel completo (con filtros) — carga primero los datos más recientes.
async function abrirModalReporte(){
  if(typeof XLSX==='undefined'){toast('Librería Excel no cargada, reintenta.','warn');return;}
  _limpiarFiltrosReporte();
  document.getElementById('modalReporte').classList.add('open');
  try{
    await Promise.all([
      _recargarProductos(),_recargarHistorial(),_recargarSolicitudes(),
      _recargarPedidos(),_recargarSeguimiento(),
      _api('seriales','listar_todos').then(d=>window._ontData=d||[]).catch(()=>window._ontData=[]),
      _api('fibra','listar_carretes').then(d=>window._fibraData=d||[]).catch(()=>window._fibraData=[])
    ]);
  }catch(e){ console.error('[abrirModalReporte]', e); }
}
// Botón "Generar Excel" de esa ventana: lee los filtros y arma el reporte.
async function generarReporteExcel(){
  const v = id => (document.getElementById(id)?.value||'').trim();
  const filtros = {
    desde: v('rptDesde'), hasta: v('rptHasta'), sede: v('rptSede'),
    estado: v('rptEstado'), producto: v('rptProducto').toLowerCase()
  };
  cerrarModal('modalReporte');
  await generarReporteExcelConFiltros(filtros);
}

function _limpiarFiltrosReporte(){
  ['rptDesde','rptHasta','rptSede','rptEstado','rptProducto'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value='';
  });
  // Poblar select de sedes
  const selSede=document.getElementById('rptSede');
  if(selSede){
    selSede.innerHTML='<option value="">Todas las sedes</option>';
    getSedesActivas().forEach(s=>{
      const o=document.createElement('option');
      o.value=s.nombre; o.textContent=s.nombre;
      selSede.appendChild(o);
    });
  }
}