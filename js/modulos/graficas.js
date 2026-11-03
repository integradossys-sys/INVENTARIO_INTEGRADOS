(function(){

  /* ══════════════════════════════════════════
     TARJETA: cabecera clickeable como acceso
     rapido + grafica debajo
  ══════════════════════════════════════════ */
  function cardStatic(titulo, desc, canvasHtml, iconPath, iconColor, iconBg){
    return '<div class="![background:white] ![border:1.5px_solid_#E2E8F0] !rounded-[14px] !p-[16px_20px]">'
      +'<div class="!flex !items-center !gap-[12px] !mb-[14px]">'
        +'<div style="width:38px;height:38px;background:'+iconBg+';border-radius:10px;'
        +'flex-shrink:0;display:flex;align-items:center;justify-content:center;">'
          +'<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="'+iconColor+'" stroke-width="2">'
          +'<path stroke-linecap="round" d="'+iconPath+'"/></svg>'
        +'</div>'
        +'<div>'
          +'<div class="!font-bold !text-[14px] !text-[#0F172A]">'+titulo+'</div>'
          +'<div class="!text-[12px] !text-[#94A3B8] !mt-[2px]">'+desc+'</div>'
        +'</div>'
      +'</div>'
      + canvasHtml
      +'</div>';
  }

  function card(titulo, desc, canvasHtml, panel, iconPath, iconColor, iconBg){
    var ho   = 'this.style.borderColor=\''+iconColor+'\';this.style.boxShadow=\'0 4px 14px rgba(0,0,0,.08)\';this.style.transform=\'translateY(-2px)\'';
    var hout = 'this.style.borderColor=\'#E2E8F0\';this.style.boxShadow=\'none\';this.style.transform=\'translateY(0)\'';
    return '<div onclick="goPanel(\''+panel+'\''+')"'
      +' onmouseover="'+ho+'" onmouseout="'+hout+'"'
      +' style="background:white;border:1.5px solid #E2E8F0;border-radius:14px;padding:16px 20px;'
      +'transition:all .2s;cursor:pointer;">'
      /* ícono + título + descripción — mismo estilo que quickActions */
      +'<div class="!flex !items-center !gap-[12px] !mb-[14px]">'
        +'<div style="width:38px;height:38px;background:'+iconBg+';border-radius:10px;'
        +'flex-shrink:0;display:flex;align-items:center;justify-content:center;">'
          +'<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="'+iconColor+'" stroke-width="2">'
          +'<path stroke-linecap="round" d="'+iconPath+'"/></svg>'
        +'</div>'
        +'<div>'
          +'<div class="!font-bold !text-[14px] !text-[#0F172A]">'+titulo+'</div>'
          +'<div class="!text-[12px] !text-[#94A3B8] !mt-[2px]">'+desc+'</div>'
        +'</div>'
      +'</div>'
      + canvasHtml
      +'</div>';
  }

  /* ── colores ── */
  var C = {
    azul:'#0C6EDE', azulB:'#E6F1FB',
    verde:'#16A871', verdeB:'#EAF3DE',
    naranja:'#BA7517', naranjaB:'#FAEEDA',
    morado:'#7C3AED', moradoB:'#EDE9FE',
    rojo:'#B91C1C', borde:'#E2E8F0'
  };

  var _ch = {};
  function destroy(k){ if(_ch[k]){ _ch[k].destroy(); delete _ch[k]; } }

  function dias(n){
    var r=[];
    for(var i=n-1;i>=0;i--){var d=new Date();d.setDate(d.getDate()-i);r.push(d.toISOString().slice(0,10));}
    return r;
  }
  function lbl(iso){var p=iso.split('-');return p[2]+'/'+p[1];}

  function contenedor(){
    if(document.getElementById('chartsSection')) return;
    var qa = document.getElementById('quickActions');
    if(!qa) return;
    var s = document.createElement('div');
    s.id = 'chartsSection';
    s.style.cssText = 'margin-top:16px;display:flex;flex-direction:column;gap:16px;';
    qa.parentNode.insertBefore(s, qa.nextSibling);
  }

  function renderGraficas(){
    if(!window.Chart) return;
    var ses = getSesion();
    if(!ses) return;
    contenedor();
    var sec = document.getElementById('chartsSection');
    if(!sec) return;
    var rol = ses.rol;
    if(rol==='superadmin'||rol==='distribuidor') renderAdmin(sec);
    else if(rol==='municipio'||rol==='tecnico'||rol==='persona') renderMunicipio(sec);
    else sec.innerHTML='';
  }

  function renderAdmin(sec){
    var prods = getProductos();
    // Cantidad real en almacén: rollos físicos para productos por rollo, unidades para el resto
    function _cantAlm(p){
      if(p.metrosPorUnidad && Array.isArray(p.rollosCentral)) return p.rollosCentral.length;
      return valorMostrar(p, _stockCentral(p)||0);
    }
    var top = [].concat(prods)
      .sort(function(a,b){return _cantAlm(b)-_cantAlm(a);});
    var lN = top.map(function(p){return p.nombre.length>18?p.nombre.slice(0,16)+'\u2026':p.nombre;});
    var dN = top.map(_cantAlm);
    var dM = top.map(function(p){return valorMostrar(p, p.stockMinimo||0);});
    var cB = dN.map(function(v,i){return dM[i]>0&&v<=dM[i]?'#FCA5A5':v===0?'#FECACA':C.azulB;});
    var cBb= dN.map(function(v,i){return dM[i]>0&&v<=dM[i]?C.rojo:v===0?C.rojo:C.azul;});

    var d14 = dias(14);
    // El historial ya no está completo en memoria: las series llegan del servidor (cargarDatosAdmin)
    var apr = d14.map(function(){return 0;});
    var rec = d14.map(function(){return 0;});
    var gas = d14.map(function(){return 0;});

    var cA=(_statsHist&&_statsHist.aprobados)||0;
    var cP=(_statsHist&&_statsHist.pendientes)||0;
    var cR=(_statsHist&&_statsHist.rechazados)||0;
    var cG=(_statsHist&&_statsHist.gastos)||0;

    // Unidades por sede: se llena desde el servidor (stock real de cada oficina)
    var sedes=[];
    var sdData=[];
    var pal=[C.azul,C.verde,C.morado,C.naranja,'#0891B2','#BE185D','#D97706','#059669'];

    destroy('g1');destroy('g2');destroy('g3');destroy('g4');

    var iconStock  = 'M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z';
    var iconHist   = 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2';
    var iconAlert  = 'M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z';
    var iconOfic   = 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1';

    sec.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">'
        + card('Stock en almacén','Ver productos en stock',
  '<div class="!relative">'+
  '<div id="gc1Scroll" style="overflow-x:auto;overflow-y:hidden;">'+
    '<div id="gc1Wrap" style="height:210px;min-width:100%;"><canvas id="gc1"></canvas></div>'+
  '</div>'+
  '<div id="gc1Nav" onclick="event.stopPropagation()" style="display:none;justify-content:space-between;align-items:center;margin-top:6px;">'+
    '<button onclick="event.stopPropagation();gc1Navegar(-1)" id="gc1Prev" style="background:#F1F5F9;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;color:#475569;">◀ Anterior</button>'+
    '<span id="gc1PagLabel" style="font-size:11px;color:#94A3B8;"></span>'+
    '<button onclick="event.stopPropagation();gc1Navegar(1)" id="gc1Next" style="background:#F1F5F9;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px;color:#475569;">Siguiente ▶</button>'+
  '</div>'+
  '</div>',
  'productos',iconStock,C.azul,C.azulB)
        + card('Movimientos — 14 días','Ver historial de envíos','<div class="!h-[210px]"><canvas id="gc2"></canvas></div>','historial',iconHist,C.verde,C.verdeB)
      +'</div>'
      +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:0;">'
        + card('Distribución del historial','Ver historial completo','<div class="!h-[210px]"><canvas id="gc3"></canvas></div>','historial',iconAlert,C.naranja,C.naranjaB)
        + card('Unidades por sede','Ver gestión de oficinas','<div class="!h-[210px]"><canvas id="gc4"></canvas></div>','oficinas',iconOfic,C.morado,C.moradoB)
      +'</div>'
      +'<div id="gc5Wrapper" style="margin-top:0;">'
        + cardStatic('Estado de la flota ONT','Distribución de equipos registrados',
            '<div id="gc5Loading" style="height:220px;display:flex;align-items:center;justify-content:center;color:#94A3B8;font-size:13px;">Cargando ONTs...</div>'+
            '<div id="gc5Charts" style="display:none;">'+
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">'+
                '<div class="!h-[200px]"><canvas id="gc5a"></canvas></div>'+
                '<div class="!h-[200px]"><canvas id="gc5b"></canvas></div>'+
              '</div>'+
              '<div id="gc5Kpis" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid #F1F5F9;"></div>'+
              '<div id="gc5DetallePersona" style="margin-top:14px;padding-top:14px;border-top:1px solid #F1F5F9;"></div>'+
            '</div>',
          'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18',C.verde,C.verdeB)
      +'</div>';

    // Plugin: mostrar % en cada segmento de la dona
    var donaLabels = {
      id:'donaLabels',
      afterDatasetsDraw:function(chart){
        var ctx=chart.ctx, total=chart.data.datasets[0].data.reduce(function(a,b){return a+b;},0);
        if(!total) return;
        chart.data.datasets[0].data.forEach(function(val,i){
          if(!val) return;
          var meta=chart.getDatasetMeta(0),arc=meta.data[i];
          var mid=(arc.startAngle+arc.endAngle)/2;
          var r=(arc.outerRadius+arc.innerRadius)/2;
          var x=arc.x+Math.cos(mid)*r, y=arc.y+Math.sin(mid)*r;
          var pct=Math.round(val/total*100);
          if(pct<4) return; // no mostrar si es muy pequeño
          ctx.save();
          ctx.fillStyle='#fff';
          ctx.font='bold 11px Arial';
          ctx.textAlign='center';
          ctx.textBaseline='middle';
          ctx.shadowColor='rgba(0,0,0,.3)';
          ctx.shadowBlur=3;
          ctx.fillText(pct+'%',x,y);
          ctx.restore();
        });
        // Texto central: total
        var cx=chart.getDatasetMeta(0).data[0]?.x||0;
        var cy=chart.getDatasetMeta(0).data[0]?.y||0;
        ctx.save();
        ctx.fillStyle='#0F172A';
        ctx.font='bold 22px Syne,Arial';
        ctx.textAlign='center';
        ctx.textBaseline='middle';
        ctx.fillText(total,cx,cy-8);
        ctx.fillStyle='#94A3B8';
        ctx.font='11px Arial';
        ctx.fillText('total',cx,cy+10);
        ctx.restore();
      }
    };

    try{
      // G1 — Stock en Neiva con paginación para muchos productos
      var _gc1AllLabels = lN, _gc1AllDN = dN, _gc1AllDM = dM, _gc1AllCB = cB, _gc1AllCBb = cBb;
      var _gc1PorPagina = 5, _gc1Pagina = 0;

      function gc1TotalPags(){ return Math.ceil(_gc1AllLabels.length/_gc1PorPagina); }

      function gc1DatosPage(p){
        var ini=p*_gc1PorPagina, fin=ini+_gc1PorPagina;
        return {
          labels: _gc1AllLabels.slice(ini,fin),
          dN:     _gc1AllDN.slice(ini,fin),
          dM:     _gc1AllDM.slice(ini,fin),
          cB:     _gc1AllCB.slice(ini,fin),
          cBb:    _gc1AllCBb.slice(ini,fin)
        };
      }

      function gc1Render(p){
        var d=gc1DatosPage(p);
        var total=gc1TotalPags();
        // Ancho dinámico: min 60px por barra
        var minW=Math.max(100, d.labels.length*60);
        var wrap=document.getElementById('gc1Wrap');
        if(wrap) wrap.style.minWidth=minW+'px';

        if(_ch.g1){ _ch.g1.destroy(); _ch.g1=null; }
        _ch.g1=new Chart(document.getElementById('gc1'),{type:'bar',data:{labels:d.labels,datasets:[
          {label:'Stock',data:d.dN,backgroundColor:d.cB,borderColor:d.cBb,borderWidth:1.5,borderRadius:5},
          {label:'Mínimo',data:d.dM,type:'line',borderColor:C.naranja,borderWidth:1.5,borderDash:[5,4],pointRadius:0,fill:false}]},
          options:{responsive:true,maintainAspectRatio:false,
            plugins:{
              legend:{labels:{font:{size:11},boxWidth:10}},
              tooltip:{callbacks:{
                afterLabel:function(ctx){
                  if(ctx.datasetIndex!==0) return '';
                  var min=d.dM[ctx.dataIndex]||0; if(!min) return '';
                  var pct=Math.round(ctx.raw/min*100);
                  return pct>=100?'✅ '+pct+'% del mínimo':'⚠ '+pct+'% del mínimo';
                }
              }}
            },
            scales:{x:{ticks:{font:{size:10}},grid:{display:false}},y:{ticks:{font:{size:10}},grid:{color:C.borde}}}
          }
        });

        // Mostrar/ocultar navegación
        var nav=document.getElementById('gc1Nav');
        var lbl=document.getElementById('gc1PagLabel');
        var prev=document.getElementById('gc1Prev');
        var next=document.getElementById('gc1Next');
        if(nav){
          nav.style.display = total>1 ? 'flex' : 'none';
          if(lbl) lbl.textContent = 'Página '+(p+1)+' de '+total+' ('+_gc1AllLabels.length+' productos)';
          if(prev) prev.disabled = p===0;
          if(next) next.disabled = p>=total-1;
        }
      }

      window.gc1Navegar=function(dir){
        var tot=gc1TotalPags();
        _gc1Pagina=Math.max(0,Math.min(tot-1,_gc1Pagina+dir));
        gc1Render(_gc1Pagina);
      };

      gc1Render(_gc1Pagina);

      // G2 — Movimientos 14 días con totales en tooltip
      _ch.g2=new Chart(document.getElementById('gc2'),{type:'line',data:{labels:d14.map(lbl),datasets:[
        {label:'Aprobados',data:apr,borderColor:C.verde,backgroundColor:'rgba(22,168,113,0.1)',fill:true,tension:0.35,pointRadius:3},
        {label:'Rechazados',data:rec,borderColor:C.rojo,backgroundColor:'rgba(185,28,28,0.07)',fill:true,tension:0.35,pointRadius:3},
        {label:'Gastos',data:gas,borderColor:C.naranja,backgroundColor:'rgba(186,117,23,0.08)',fill:true,tension:0.35,pointRadius:3}]},
        options:{responsive:true,maintainAspectRatio:false,
          plugins:{
            legend:{labels:{font:{size:11},boxWidth:10}},
            tooltip:{mode:'index',intersect:false}
          },
          scales:{x:{ticks:{font:{size:10}},grid:{display:false}},y:{ticks:{font:{size:10}},grid:{color:C.borde},beginAtZero:true}}
        }
      });

      // G3 — Dona con % visibles y texto central
      var totalHist = cA+cP+cR+cG;
      _ch.g3=new Chart(document.getElementById('gc3'),{
        type:'doughnut',
        data:{
          labels:['Aprobados ('+cA+')','Pendientes ('+cP+')','Rechazados ('+cR+')','Gastos ('+cG+')'],
          datasets:[{data:[cA,cP,cR,cG],backgroundColor:[C.verde,C.naranja,C.rojo,C.morado],borderColor:'#fff',borderWidth:3,hoverOffset:8}]
        },
        options:{
          responsive:true,maintainAspectRatio:false,cutout:'58%',
          plugins:{
            legend:{position:'right',labels:{font:{size:11},boxWidth:10,padding:10}},
            tooltip:{callbacks:{
              label:function(ctx){
                var pct=totalHist?Math.round(ctx.raw/totalHist*100):0;
                return ' '+ctx.label+': '+pct+'%';
              }
            }}
          }
        },
        plugins:[donaLabels]
      });

      // G4 — Unidades por sede (todas las sedes, ordenadas de mayor a menor)
      var sedesConDatos = sedes.map(function(s,i){return {sede:s,val:sdData[i]||0};})
        .sort(function(a,b){return b.val-a.val;});
      var labSedes  = sedesConDatos.map(function(x){return x.sede;});
      var datSedes  = sedesConDatos.map(function(x){return x.val;});
      var pal2      = labSedes.map(function(_,i){return pal[i%pal.length];});
      var totSedes  = datSedes.reduce(function(a,b){return a+b;},0);

      _ch.g4=new Chart(document.getElementById('gc4'),{type:'bar',data:{labels:labSedes,datasets:[{
        label:'Unidades',data:datSedes,
        backgroundColor:pal2.map(function(c,i){
          return datSedes[i]===0?'#F1F5F9':c+'33';  // gris si es 0
        }),
        borderColor:pal2.map(function(c,i){
          return datSedes[i]===0?'#CBD5E1':c;
        }),
        borderWidth:1.5,borderRadius:5}]},
        options:{
          responsive:true,maintainAspectRatio:false,indexAxis:'y',
          plugins:{
            legend:{display:false},
            tooltip:{callbacks:{
              label:function(ctx){
                if(ctx.raw===0) return ' Sin stock';
                var pct=totSedes?Math.round(ctx.raw/totSedes*100):0;
                return ' '+ctx.raw+' uds ('+pct+'% del total)';
              }
            }}
          },
          scales:{
            x:{ticks:{font:{size:10}},grid:{color:C.borde},beginAtZero:true},
            y:{ticks:{font:{size:10}},grid:{display:false}}
          }
        }
      });
    }catch(e){console.error('Charts error:',e);}

    // G5 — Estado de la flota ONT (carga async)
    renderOntChart();
    // G2, G3 y G4 con datos reales del servidor
    cargarDatosAdmin(d14);
  }


  function _donaHistVacia(){
    var cv=document.getElementById('gc3');
    if(cv&&cv.parentElement){
      cv.parentElement.innerHTML='<div class="!h-[100%] !flex !items-center !justify-center !text-[#94A3B8] !text-[13px] !text-center !p-[20px]">Sin movimientos todavía.</div>';
    }
  }

  /* Actualiza la dona del historial (la llama también parte1 cuando llegan las cifras) */
  window.actualizarDonaHistorial = function(st){
    if(!st||!_ch.g3) return;
    var cA=st.aprobados||0,cP=st.pendientes||0,cR=st.rechazados||0,cG=st.gastos||0;
    var tot=cA+cP+cR+cG;
    if(!tot){ destroy('g3'); _donaHistVacia(); return; }
    _ch.g3.data.labels=['Aprobados ('+cA+')','Pendientes ('+cP+')','Rechazados ('+cR+')','Gastos ('+cG+')'];
    _ch.g3.data.datasets[0].data=[cA,cP,cR,cG];
    _ch.g3.options.plugins.tooltip.callbacks.label=function(ctx){
      var pct=tot?Math.round(ctx.raw/tot*100):0;
      return ' '+ctx.label+': '+pct+'%';
    };
    _ch.g3.update();
  };

  function cargarDatosAdmin(d14){
    // Movimientos por día + dona del historial
    fetch('api/historial.php?action=stats_resumen',{credentials:'same-origin'})
      .then(function(r){return r.json();})
      .then(function(st){
        if(!st||st.error) return;
        try{ window._statsHist = st; }catch(e){}
        if(typeof _statsHist!=='undefined'){ try{ _statsHist = st; }catch(e){} }
        window.actualizarDonaHistorial(st);
        if(_ch.g2){
          var pd=st.por_dia||{};
          _ch.g2.data.datasets[0].data=d14.map(function(d){return (pd[d]&&pd[d].aprobados)||0;});
          _ch.g2.data.datasets[1].data=d14.map(function(d){return (pd[d]&&pd[d].rechazados)||0;});
          _ch.g2.data.datasets[2].data=d14.map(function(d){return (pd[d]&&pd[d].gastos)||0;});
          _ch.g2.update();
        }
      })
      .catch(function(e){ console.warn('stats_resumen:',e); });

    // Unidades por sede = lo que realmente tiene cada oficina (suma de sus personas)
    fetch('api/productos.php?action=stock_por_usuario',{credentials:'same-origin'})
      .then(function(r){return r.json();})
      .then(function(rows){
        var cv=document.getElementById('gc4');
        if(!cv) return;
        if(!Array.isArray(rows)){ return; }
        var porSede={};
        rows.forEach(function(r){
          if(r.unidad==='Metros') return; // metros no se suman con unidades/rollos
          var s=r.sede||'Sin sede';
          porSede[s]=(porSede[s]||0)+(parseFloat(r.cantidad)||0);
        });
        var lista=Object.keys(porSede).map(function(s){return {sede:s,val:Math.round(porSede[s]*100)/100};})
          .sort(function(a,b){return b.val-a.val;});
        if(!lista.length){
          if(cv.parentElement) cv.parentElement.innerHTML='<div class="!h-[100%] !flex !items-center !justify-center !text-[#94A3B8] !text-[13px] !text-center !p-[20px]">Las oficinas no tienen stock todavía.</div>';
          return;
        }
        var pal=[C.azul,C.verde,C.morado,C.naranja,'#0891B2','#BE185D','#D97706','#059669'];
        var cols=lista.map(function(_,i){return pal[i%pal.length];});
        var tot=lista.reduce(function(a,x){return a+x.val;},0);
        destroy('g4');
        _ch.g4=new Chart(cv,{type:'bar',data:{labels:lista.map(function(x){return x.sede;}),datasets:[{
          label:'Unidades',data:lista.map(function(x){return x.val;}),
          backgroundColor:cols.map(function(c){return c+'33';}),borderColor:cols,borderWidth:1.5,borderRadius:5}]},
          options:{responsive:true,maintainAspectRatio:false,indexAxis:'y',
            plugins:{legend:{display:false},tooltip:{callbacks:{label:function(ctx){
              var pct=tot?Math.round(ctx.raw/tot*100):0;
              return ' '+ctx.raw+' uds ('+pct+'% del total)';
            }}}},
            scales:{x:{ticks:{font:{size:10}},grid:{color:C.borde},beginAtZero:true},y:{ticks:{font:{size:10}},grid:{display:false}}}}});
      })
      .catch(function(e){ console.warn('stock_por_usuario:',e); });
  }

  function renderOntChart(){
    fetch('api/cajas.php?action=stats_onts',{credentials:'same-origin'})
      .then(function(r){return r.json();})
      .then(function(data){
        if(data.error || !data.por_estado) return;

        var loading = document.getElementById('gc5Loading');
        var charts  = document.getElementById('gc5Charts');
        if(loading) loading.style.display='none';
        if(charts)  charts.style.display='';

        var estadoLabel = {
          'disponible':  '✅ Disponible',
          'comodato':    '📋 Instalada',
          'ocupado':     '📋 Instalada',
          'despachada':  '🚚 Despachada',
          'dañado':      '⚠️ Dañada',
          'vendido':     '💰 Vendida',
          'sin_asignar': '❓ Sin asignar'
        };
        var estadoColor = {
          'disponible':  C.verde,
          'comodato':    C.morado,
          'despachada':  C.azul,
          'dañado':      C.rojo,
          'vendido':     C.naranja,
          'sin_asignar': '#CBD5E1'
        };

        // Unificar comodato + ocupado
        var agrupado = {};
        data.por_estado.forEach(function(r){
          var key = (r.estado==='ocupado') ? 'comodato' : r.estado;
          agrupado[key] = (agrupado[key]||0) + parseInt(r.total);
        });

        // Calcular total real (excluyendo sin_asignar del porcentaje si quieres, pero mostrar todos)
        var totalReal = vals5aCalc();
        function vals5aCalc(){ return Object.values(agrupado).reduce(function(a,b){return a+b;},0); }
        var total5 = data.total||0;

        // Solo mostrar estados con datos (sin sin_asignar si es la mayoría aplastante)
        var estadosOrden = ['disponible','comodato','despachada','dañado','vendido','sin_asignar'];
        var labels5a=[], vals5a=[], cols5a=[];
        estadosOrden.forEach(function(e){
          if(agrupado[e]){
            labels5a.push(estadoLabel[e]||e);
            vals5a.push(agrupado[e]);
            cols5a.push(estadoColor[e]||'#CBD5E1');
          }
        });

        // Plugin % en dona
        var donaOnt = {
          id:'donaOnt',
          afterDatasetsDraw:function(chart){
            var ctx=chart.ctx;
            var tot=chart.data.datasets[0].data.reduce(function(a,b){return a+b;},0);
            if(!tot) return;
            chart.data.datasets[0].data.forEach(function(val,i){
              if(!val) return;
              var meta=chart.getDatasetMeta(0), arc=meta.data[i];
              var pct=Math.round(val/tot*100);
              if(pct<4) return;
              var mid=(arc.startAngle+arc.endAngle)/2;
              var r=(arc.outerRadius+arc.innerRadius)/2;
              var x=arc.x+Math.cos(mid)*r, y=arc.y+Math.sin(mid)*r;
              ctx.save();
              ctx.fillStyle='#fff'; ctx.font='bold 11px Arial';
              ctx.textAlign='center'; ctx.textBaseline='middle';
              ctx.shadowColor='rgba(0,0,0,.35)'; ctx.shadowBlur=3;
              ctx.fillText(pct+'%',x,y);
              ctx.restore();
            });
            var cx=chart.getDatasetMeta(0).data[0]?.x||0;
            var cy=chart.getDatasetMeta(0).data[0]?.y||0;
            ctx.save();
            ctx.fillStyle='#0F172A'; ctx.font='bold 20px Syne,Arial';
            ctx.textAlign='center'; ctx.textBaseline='middle';
            ctx.fillText(tot,cx,cy-8);
            ctx.fillStyle='#94A3B8'; ctx.font='11px Arial';
            ctx.fillText('ONTs',cx,cy+10);
            ctx.restore();
          }
        };

        destroy('gc5a'); destroy('gc5b');

        // Dona por estado
        _ch.gc5a = new Chart(document.getElementById('gc5a'),{
          type:'doughnut',
          data:{
            labels:labels5a,
            datasets:[{data:vals5a, backgroundColor:cols5a, borderColor:'#fff', borderWidth:3, hoverOffset:8}]
          },
          options:{
            responsive:true, maintainAspectRatio:false, cutout:'58%',
            plugins:{
              legend:{position:'right', labels:{font:{size:11}, boxWidth:10, padding:8}},
              tooltip:{callbacks:{label:function(ctx){
                var pct=total5?Math.round(ctx.raw/total5*100):0;
                return ' '+ctx.label+': '+ctx.raw+' ('+pct+'%)';
              }}}
            }
          },
          plugins:[donaOnt]
        });

        // Barras por sede — solo sedes con datos, con número entero en eje X
        var labSede = data.por_sede.map(function(r){return r.sede_actual||'Sin sede';});
        var valSede = data.por_sede.map(function(r){return parseInt(r.total)||0;});
        var maxSede = Math.max.apply(null, valSede.concat([1]));
        var colSede = valSede.map(function(v){
          var pct=v/maxSede;
          return pct>0.6?C.verde:pct>0.3?C.azul:C.morado;
        });

        _ch.gc5b = new Chart(document.getElementById('gc5b'),{
          type:'bar',
          data:{
            labels:labSede,
            datasets:[{
              label:'ONTs', data:valSede,
              backgroundColor:colSede.map(function(c){return c+'33';}),
              borderColor:colSede, borderWidth:1.5, borderRadius:5
            }]
          },
          options:{
            responsive:true, maintainAspectRatio:false, indexAxis:'y',
            plugins:{
              legend:{display:false},
              tooltip:{callbacks:{label:function(ctx){
                var pct=total5?Math.round(ctx.raw/total5*100):0;
                return ' '+ctx.raw+' ONTs ('+pct+'% del total)';
              }}}
            },
            scales:{
              x:{
                ticks:{font:{size:10}, stepSize:1,
                  callback:function(v){ return Number.isInteger(v)?v:''; }
                },
                grid:{color:C.borde}, beginAtZero:true,
                min:0, max: maxSede+1
              },
              y:{ticks:{font:{size:10}}, grid:{display:false}}
            }
          }
        });

        // Detalle: dentro de cada municipio, cuánto tiene cada persona
        const detWrap = document.getElementById('gc5DetallePersona');
        if(detWrap && Array.isArray(data.por_sede_persona) && data.por_sede_persona.length){
          const porSedeMap = {};
          data.por_sede_persona.forEach(r=>{
            const sedeKey = r.sede || 'Sin asignar';
            if(!porSedeMap[sedeKey]) porSedeMap[sedeKey]=[];
            porSedeMap[sedeKey].push(r);
          });
          detWrap.innerHTML = `<div class="!text-[12px] !font-bold !text-[#334155] !mb-[10px]">👤 Detalle por persona, dentro de cada municipio</div>` +
            Object.keys(porSedeMap).sort((a,b)=>{
              const totalA=porSedeMap[a].reduce((s,r)=>s+parseInt(r.total||0),0);
              const totalB=porSedeMap[b].reduce((s,r)=>s+parseInt(r.total||0),0);
              return totalB-totalA;
            }).map(sedeKey=>{
              const filas = porSedeMap[sedeKey];
              const totalSede = filas.reduce((s,r)=>s+parseInt(r.total||0),0);
              return `<details class="!mb-[6px]">
                <summary class="!cursor-pointer !text-[12px] !font-semibold !text-[#0C6EDE] !p-[6px_0]">${esc(sedeKey)} — ${totalSede} ONTs</summary>
                <div class="!p-[4px_0_4px_16px]">
                  ${filas.map(r=>`<div style="display:flex;justify-content:space-between;font-size:12px;color:#64748B;padding:3px 0;border-bottom:1px solid #F8FAFC;">
                    <span>${esc(r.nombre||r.usuario||'—')}</span>
                    <span class="!font-semibold !text-[#334155]">${r.total}</span>
                  </div>`).join('')}
                </div>
              </details>`;
            }).join('');
        } else if(detWrap){
          detWrap.innerHTML = '';
        }

        // KPIs — % sobre el total real con datos (no sobre 6547 sin_asignar)
        var kpis = document.getElementById('gc5Kpis');
        if(kpis){
          var disponibles = agrupado['disponible']||0;
          var instaladas  = agrupado['comodato']||0;
          var despachadas = agrupado['despachada']||0;
          var danadas     = agrupado['dañado']||0;
          // base para % = total con estado definido (excluye sin_asignar)
          var baseKpi = disponibles + instaladas + despachadas + danadas + (agrupado['vendido']||0);
          baseKpi = baseKpi || total5 || 1;
          var pctDisp = Math.round(disponibles/baseKpi*100);
          var pctInst = Math.round(instaladas/baseKpi*100);
          var pctDesp = Math.round(despachadas/baseKpi*100);

          kpis.innerHTML =
            '<div class="![background:#F0FDF4] !rounded-[10px] !p-[10px_16px] ![flex:1] !min-w-[100px] !text-center">'+
              '<div class="!text-[24px] !font-extrabold !text-[#16A850]">'+disponibles+'</div>'+
              '<div class="!text-[11px] !text-[#64748B]">✅ Disponibles</div>'+
              '<div class="!text-[11px] !text-[#16A850] !font-bold">'+pctDisp+'%</div>'+
            '</div>'+
            '<div class="![background:#EDE9FE] !rounded-[10px] !p-[10px_16px] ![flex:1] !min-w-[100px] !text-center">'+
              '<div class="!text-[24px] !font-extrabold !text-[#7C3AED]">'+instaladas+'</div>'+
              '<div class="!text-[11px] !text-[#64748B]">📋 Instaladas</div>'+
              '<div class="!text-[11px] !text-[#7C3AED] !font-bold">'+pctInst+'%</div>'+
            '</div>'+
            (despachadas>0?
            '<div class="![background:#E6F1FB] !rounded-[10px] !p-[10px_16px] ![flex:1] !min-w-[100px] !text-center">'+
              '<div class="!text-[24px] !font-extrabold !text-[#0C6EDE]">'+despachadas+'</div>'+
              '<div class="!text-[11px] !text-[#64748B]">🚚 Despachadas</div>'+
              '<div class="!text-[11px] !text-[#0C6EDE] !font-bold">'+pctDesp+'%</div>'+
            '</div>':'')
            +
            (danadas>0?
            '<div class="![background:#FEF2F2] !rounded-[10px] !p-[10px_16px] ![flex:1] !min-w-[100px] !text-center">'+
              '<div class="!text-[24px] !font-extrabold !text-[#DC2626]">'+danadas+'</div>'+
              '<div class="!text-[11px] !text-[#64748B]">⚠️ Dañadas</div>'+
              '<div class="!text-[11px] !text-[#DC2626] !font-bold">'+Math.round(danadas/baseKpi*100)+'%</div>'+
            '</div>':'');
        }
      })
      .catch(function(e){
        var loading=document.getElementById('gc5Loading');
        if(loading){ loading.textContent='No se pudieron cargar los datos de ONTs.'; }
        console.warn('ONT stats error:',e);
      });
  }

  function renderMunicipio(sec){
    var prods = getProductos();
    var ses   = getSesion();
    var sedes = ses.sedes||[ses.sede];
    var top   = [].concat(prods).map(function(p){
      return {n:p.nombre.length>18?p.nombre.slice(0,16)+'\u2026':p.nombre,
        v:valorMostrar(p, parseFloat(p.stockUsuario)||0)};
    }).filter(function(x){return x.v>0;}).sort(function(a,b){return b.v-a.v;}).slice(0,8);

    var d14  = dias(14);
    var peds = getPedidosMun()||[];
    var pd   = d14.map(function(d){return peds.filter(function(p){return (p.solicitado_por===ses.usuario||sedes.indexOf(p.municipio)>=0)&&p.fecha&&p.fecha.slice(0,10)===d;}).length;});

    destroy('gm1');destroy('gm2');destroy('gm3');

    var iconStock = 'M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z';
    var iconPed   = 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z';
    var sols  = getSolicitudes().filter(function(s){ return sedes.indexOf(s.destino)>=0||s.solicitadoPor===ses.usuario; });
    var sPend = sols.filter(function(s){ return s.estado==='pendiente'||s.estado==='en_gestion'; }).length;
    var sApro = sols.filter(function(s){ return s.estado==='aprobada'; }).length;
    var sCamino = sols.filter(function(s){ return s.estado==='en_camino'||s.estado==='entregado'; }).length;
    var sRecib = sols.filter(function(s){ return s.estado==='recibida'||s.estado==='recibido'; }).length;
    var sRech = sols.filter(function(s){ return s.estado==='rechazada'; }).length;
    var iconSol = 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';
    sec.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;">'
      + card('Mi stock actual','Ver productos en stock','<div class="!h-[210px]"><canvas id="gcm1"></canvas></div>','productos',iconStock,C.morado,C.moradoB)
      + card('Mis pedidos — 14 días','Ver mis pedidos','<div class="!h-[210px]"><canvas id="gcm2"></canvas></div>','missolicitudes',iconPed,C.azul,C.azulB)
      + card('Estado de mis pedidos','Ver mis pedidos','<div class="!h-[210px]"><canvas id="gcm3"></canvas></div>','missolicitudes',iconSol,'#16A871','#EAF3DE')
      +'</div>'
      +'<div id="gcm-ont-wrap" style="margin-top:16px;"></div>';
    try{
      _ch.gm1=new Chart(document.getElementById('gcm1'),{type:'bar',data:{
        labels:top.map(function(x){return x.n;}),
        datasets:[{label:'Unidades',data:top.map(function(x){return x.v;}),backgroundColor:C.moradoB,borderColor:C.morado,borderWidth:1.5,borderRadius:5}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10}},grid:{display:false}},y:{ticks:{font:{size:10}},grid:{color:C.borde},beginAtZero:true}}}});
      _ch.gm2=new Chart(document.getElementById('gcm2'),{type:'line',data:{labels:d14.map(lbl),
        datasets:[{label:'Pedidos',data:d14.map(function(d){ return sols.filter(function(s){ return s.fecha&&s.fecha.slice(0,10)===d; }).length; }),borderColor:C.azul,backgroundColor:'rgba(12,110,222,0.1)',fill:true,tension:0.35,pointRadius:3}]},
        options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{font:{size:10}},grid:{display:false}},y:{ticks:{font:{size:10}},grid:{color:C.borde},beginAtZero:true}}}});
      if(sPend+sApro+sCamino+sRecib+sRech>0){
        _ch.gm3=new Chart(document.getElementById('gcm3'),{type:'doughnut',data:{
          labels:['Pendientes','Aprobadas','En camino','Recibidas','Rechazadas'],
          datasets:[{data:[sPend,sApro,sCamino,sRecib,sRech],backgroundColor:['#FDE68A','#6EE7B7','#93C5FD','#86EFAC','#FECACA'],borderColor:['#BA7517','#16A871','#2563EB','#15803D','#DC2626'],borderWidth:2}]},
          options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}}}}});
      } else {
        var ctx3=document.getElementById('gcm3');
        if(ctx3){ ctx3.parentElement.innerHTML='<div class="!flex !items-center !justify-center !h-[210px] !text-[#94A3B8] !text-[13px]">Sin pedidos aún</div>'; }
      }
    }catch(e){console.error('Charts municipio:',e);}

    // Gráfica de ONT — se carga aparte porque necesita su propio fetch
    var wrap = document.getElementById('gcm-ont-wrap');
    if(wrap){
      wrap.innerHTML = cardStatic('Mis ONTs','Distribución de tus equipos',
        '<div id="gcmOntLoading" style="height:210px;display:flex;align-items:center;justify-content:center;color:#94A3B8;font-size:13px;">Cargando...</div>'+
        '<div id="gcmOntChart" style="display:none;height:210px;"><canvas id="gcmOnt"></canvas></div>',
        'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9', C.azul, C.azulB);
      fetch('api/cajas.php?action=mis_onts_asignadas',{credentials:'same-origin'})
        .then(function(r){return r.json();})
        .then(function(data){
          var onts = Array.isArray(data)?data:[];
          var disp=0, inst=0, dan=0;
          onts.forEach(function(o){
            if(o.estado==='comodato') inst++;
            else if(o.estado==='dañado'||o.estado==='no_disponible') dan++;
            else disp++;
          });
          var loading=document.getElementById('gcmOntLoading');
          var chartDiv=document.getElementById('gcmOntChart');
          if(!onts.length){
            if(loading) loading.textContent='No tienes ONTs registradas.';
            return;
          }
          if(loading) loading.style.display='none';
          if(chartDiv) chartDiv.style.display='block';
          destroy('gmOnt');
          _ch.gmOnt=new Chart(document.getElementById('gcmOnt'),{type:'doughnut',data:{
            labels:['Disponibles','Instaladas','Dañadas'],
            datasets:[{data:[disp,inst,dan],backgroundColor:['#6EE7B7','#93C5FD','#FECACA'],borderColor:['#16A871','#2563EB','#DC2626'],borderWidth:2}]},
            options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{font:{size:10},boxWidth:12}}}}});
        })
        .catch(function(){
          var loading=document.getElementById('gcmOntLoading');
          if(loading) loading.textContent='No se pudieron cargar las ONTs.';
        });
    }
  }

  /* ── enganche a goPanel ── */
  var _origGP = window.goPanel;
  if(typeof _origGP==='function'){
    window.goPanel=function(id){
      _origGP.apply(this,arguments);
      if(id==='resumen'&&window.getSesion&&getSesion()) setTimeout(window.renderGraficas,120);
    };
  }

  window.renderGraficas = renderGraficas;

})();