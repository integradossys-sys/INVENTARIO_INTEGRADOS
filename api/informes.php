<?php
/* ══════════════════════════════════════════════════════
   informes.php — Integrados S&S
   Reportes agregados: qué producto se pidió más, quién pidió más,
   en un rango de fechas que elige el usuario.

   IMPORTANTE: "aprobada" en una solicitud NO significa que el
   material ya llegó — falta todo el proceso de envío (en camino →
   entregado → recibido). Por eso este informe, por defecto, solo
   cuenta lo que de verdad se CONFIRMÓ COMO RECIBIDO (usando la
   tabla envios_seguimiento, que es el rastreo real del envío),
   no solo lo que el admin aprobó en el papel.
══════════════════════════════════════════════════════ */
require 'config.php';
require_once 'auditoria.php';
sesionRequerida();
rolRequerido('superadmin', 'distribuidor');

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

if ($method === 'GET' && $action === 'resumen') {
    if (!empty($_GET['debug'])) {
        $debugUsr = trim($_GET['usuario'] ?? '');
        $sol = $pdo->prepare("SELECT id, ref, nombre, cantidad, solicitado_por, estado, fecha FROM solicitudes WHERE solicitado_por LIKE ? ORDER BY fecha DESC LIMIT 20");
        $sol->execute(['%'.$debugUsr.'%']);
        $seg = $pdo->prepare("
            SELECT es.id, es.ref_producto, es.nombre_producto, es.cantidad, es.estado,
                   es.fecha_aprobado, es.fecha_recibido, sol.solicitado_por
            FROM envios_seguimiento es
            LEFT JOIN solicitudes sol ON sol.id = es.referencia_id AND es.tipo = 'solicitud'
            WHERE sol.solicitado_por LIKE ?
            ORDER BY es.fecha_aprobado DESC LIMIT 20
        ");
        $seg->execute(['%'.$debugUsr.'%']);
        responder([
            'buscando'                  => $debugUsr,
            'solicitudes_encontradas'   => $sol->fetchAll(),
            'envios_seguimiento_encontrados' => $seg->fetchAll(),
        ]);
    }

    $desde = trim($_GET['desde'] ?? '');
    $hasta = trim($_GET['hasta'] ?? '');
    $desdeOriginal = $desde;
    $hastaOriginal = $hasta;
    // Si no se manda fecha, no se filtra por fecha — se ve TODO el histórico.
    // Si se manda una de las dos, se completa la otra con un límite amplio.
    if (!$desde) $desde = '2000-01-01';
    if (!$hasta) $hasta = date('Y-m-d');
    $hastaFin = $hasta . ' 23:59:59';

    $limite = max(1, min(50, intval($_GET['limite'] ?? 15)));

    $filtroRef     = trim($_GET['producto'] ?? '');
    $filtroUsuario = trim($_GET['usuario'] ?? '');

    auditar($pdo, 'generar_informe', 'informes', "Informe generado — rango: {$desdeOriginal}..{$hastaOriginal}" . ($filtroRef ? " · producto: $filtroRef" : '') . ($filtroUsuario ? " · usuario: $filtroUsuario" : ''), '');

    // Por defecto solo cuenta lo REALMENTE RECIBIDO (rastreo real del envío).
    // Si se pide incluir_pendientes, se agrega también lo aprobado que sigue
    // en camino o entregado sin confirmar recepción, y lo que ni siquiera se
    // ha aprobado todavía (para ver la demanda total, aprobada o no).
    $incluirPendientes = !empty($_GET['incluir_pendientes']);

    $condProdSol = $filtroRef !== ''     ? " AND sol.ref = "            . $pdo->quote($filtroRef)     : "";
    $condUsrSol  = $filtroUsuario !== '' ? " AND sol.solicitado_por = " . $pdo->quote($filtroUsuario)  : "";
    $condProdPed = $filtroRef !== ''     ? " AND ref = "                . $pdo->quote($filtroRef)     : "";
    $condUsrPed  = $filtroUsuario !== '' ? " AND solicitado_por = "     . $pdo->quote($filtroUsuario)  : "";

    // Base: todo lo REALMENTE recibido, según el rastreo de envíos (fuente
    // de verdad — no depende de que la solicitud diga "aprobada", depende
    // de que alguien de verdad confirmó "lo recibí"). Cubre tanto
    // solicitudes/pedidos múltiples (tipo='solicitud') como pedidos
    // directos de municipio (tipo='pedido').
    $sqlBaseRecibido = "
        SELECT sol.ref AS ref, sol.nombre AS nombre, es.cantidad AS cantidad,
               sol.solicitado_por AS solicitado_por, es.destino AS destino, es.fecha_recibido AS fecha_mov
        FROM envios_seguimiento es
        JOIN solicitudes sol ON sol.id = es.referencia_id AND es.tipo = 'solicitud'
        WHERE es.estado = 'recibido' AND es.fecha_recibido BETWEEN ? AND ?
        UNION ALL
        SELECT pm.ref AS ref, pm.nombre AS nombre, es.cantidad AS cantidad,
               pm.solicitado_por AS solicitado_por, es.destino AS destino, es.fecha_recibido AS fecha_mov
        FROM envios_seguimiento es
        JOIN pedidos_municipio pm ON pm.id = es.referencia_id AND es.tipo = 'pedido'
        WHERE es.estado = 'recibido' AND es.fecha_recibido BETWEEN ? AND ?
    ";

    $paramsBase = [$desde, $hastaFin, $desde, $hastaFin];

    if ($incluirPendientes) {
        // Modo "incluir todo": se le suma lo que está aprobado pero aún no
        // confirmado como recibido, y lo pedido pero sin aprobar todavía
        // (solicitudes) más los pedidos directos de municipio.
        $sqlUnion = "
            $sqlBaseRecibido
            UNION ALL
            SELECT ref, nombre, cantidad, solicitado_por, destino, fecha AS fecha_mov
            FROM solicitudes
            WHERE fecha BETWEEN ? AND ? AND estado != 'rechazada'
              AND id NOT IN (SELECT referencia_id FROM envios_seguimiento WHERE tipo='solicitud' AND estado='recibido')
            UNION ALL
            SELECT ref, nombre, cantidad, solicitado_por, municipio AS destino, fecha AS fecha_mov
            FROM pedidos_municipio
            WHERE fecha BETWEEN ? AND ? AND estado != 'rechazado'
        ";
        $paramsFull = array_merge($paramsBase, [$desde, $hastaFin, $desde, $hastaFin]);
    } else {
        $sqlUnion = $sqlBaseRecibido;
        $paramsFull = $paramsBase;
    }

    // Misma base pero con la cantidad expresada en ROLLOS cuando el producto
    // viene en rollos (ej: fibra), para que sumar sedes/solicitantes no mezcle
    // metros con unidades.
    $sqlUnionRollos = "
        SELECT x.ref, x.nombre, x.solicitado_por, x.destino, x.fecha_mov,
               x.cantidad / CASE WHEN pr.metros_por_unidad > 0 THEN pr.metros_por_unidad ELSE 1 END AS cantidad
        FROM ($sqlUnion) x LEFT JOIN productos pr ON pr.ref = x.ref
    ";

    // ── Productos: TODOS los del catálogo, incluidos los que están en 0
    //    (para que se vea claro qué no se ha pedido, no solo el top) ──────
    // Se incluye stock_neiva y costo_unitario para poder señalar, aparte,
    // cuáles productos casi no rotan Y cuánta plata tienen quietas en el
    // almacén (sección "📦 Stock sin movimiento").
    $condUsrFiltro = $filtroUsuario !== '' ? " WHERE solicitado_por = " . $pdo->quote($filtroUsuario) : "";
    $stmtProd = $pdo->prepare("
        SELECT p.ref AS ref, p.nombre AS nombre, p.stock_neiva AS stock_actual,
               p.costo_unitario AS costo_unitario, p.metros_por_unidad AS metros_por_unidad,
               COALESCE(SUM(t.cantidad), 0) AS total_cantidad,
               COUNT(t.ref) AS veces
        FROM productos p
        LEFT JOIN (SELECT * FROM ($sqlUnion) x $condUsrFiltro) t ON t.ref = p.ref
        " . ($filtroRef !== '' ? "WHERE p.ref = " . $pdo->quote($filtroRef) : "") . "
        GROUP BY p.ref, p.nombre, p.stock_neiva, p.costo_unitario, p.metros_por_unidad
        ORDER BY total_cantidad DESC, p.nombre ASC
    ");
    $stmtProd->execute($paramsFull);
    $topProductos = $stmtProd->fetchAll();

    // Stock sin movimiento: productos con 0 solicitudes en el rango, pero
    // que SÍ tienen algo guardado en el almacén (para no listar cosas que
    // ni siquiera hay en stock).
    $stockSinMovimiento = array_values(array_filter($topProductos, function($p){
        return (float)$p['total_cantidad'] === 0.0 && (float)$p['stock_actual'] > 0;
    }));
    usort($stockSinMovimiento, function($a, $b){
        $valorA = (float)$a['stock_actual'] * (float)($a['costo_unitario'] ?? 0);
        $valorB = (float)$b['stock_actual'] * (float)($b['costo_unitario'] ?? 0);
        return $valorB <=> $valorA;
    });
    $valorTotalEstancado = array_reduce($stockSinMovimiento, function($acc, $p){
        return $acc + ((float)$p['stock_actual'] * (float)($p['costo_unitario'] ?? 0));
    }, 0);

    // ── Top solicitantes ────────────────────────────────────────
    $stmtUsr = $pdo->prepare("
        SELECT solicitado_por, ROUND(SUM(cantidad),1) AS total_unidades, COUNT(*) AS num_items
        FROM ($sqlUnionRollos) t
        WHERE COALESCE(solicitado_por,'') NOT IN (SELECT usuario FROM usuarios WHERE rol = 'superadmin') " . ($filtroRef !== '' ? " AND ref = " . $pdo->quote($filtroRef) : "")
                    . ($filtroUsuario !== '' ? " AND solicitado_por = " . $pdo->quote($filtroUsuario) : "") . "
        GROUP BY solicitado_por
        ORDER BY total_unidades DESC
        LIMIT $limite
    ");
    $stmtUsr->execute($paramsFull);
    $topUsuarios = $stmtUsr->fetchAll();

    if ($topUsuarios) {
        $usuariosMap = [];
        $rows = $pdo->query("SELECT usuario, nombre, apellido, rol, sede FROM usuarios")->fetchAll();
        foreach ($rows as $u) { $usuariosMap[$u['usuario']] = $u; }
        foreach ($topUsuarios as &$tu) {
            $info = $usuariosMap[$tu['solicitado_por']] ?? null;
            $tu['nombre_completo'] = $info ? trim(($info['nombre'] ?? '') . ' ' . ($info['apellido'] ?? '')) : $tu['solicitado_por'];
            if ($tu['nombre_completo'] === '') $tu['nombre_completo'] = $tu['solicitado_por'];
            $tu['rol']  = $info['rol']  ?? '';
            $tu['sede'] = $info['sede'] ?? '';
        }
        unset($tu);
    }

    // ── Totales generales ───────────────────────────────────────
    $stmtTot = $pdo->prepare("
        SELECT COUNT(*) AS total_pedidos, COALESCE(ROUND(SUM(cantidad),1),0) AS total_unidades
        FROM ($sqlUnionRollos) t
        WHERE 1=1 " . ($filtroRef !== '' ? " AND ref = " . $pdo->quote($filtroRef) : "")
                    . ($filtroUsuario !== '' ? " AND solicitado_por = " . $pdo->quote($filtroUsuario) : "") . "
    ");
    $stmtTot->execute($paramsFull);
    $totales = $stmtTot->fetch();

    // ── Cuánto sigue sin confirmarse como recibido (informativo) ──
    $stmtPend = $pdo->prepare("
        SELECT COUNT(*) AS total, COALESCE(SUM(es.cantidad),0) AS unidades
        FROM envios_seguimiento es
        LEFT JOIN solicitudes sol ON sol.id = es.referencia_id AND es.tipo = 'solicitud'
        WHERE es.estado != 'recibido' AND es.fecha_aprobado BETWEEN ? AND ? $condProdSol $condUsrSol
    ");
    $stmtPend->execute([$desde, $hastaFin]);
    $pendientes = $stmtPend->fetch();

    // ── Top sedes/destinos ──────────────────────────────────────
    $stmtSede = $pdo->prepare("
        SELECT destino, ROUND(SUM(cantidad),1) AS total_cantidad
        FROM ($sqlUnionRollos) t
        WHERE destino IS NOT NULL AND destino != ''
        " . ($filtroRef !== '' ? " AND ref = " . $pdo->quote($filtroRef) : "")
          . ($filtroUsuario !== '' ? " AND solicitado_por = " . $pdo->quote($filtroUsuario) : "") . "
        GROUP BY destino
        ORDER BY total_cantidad DESC
        LIMIT $limite
    ");
    $stmtSede->execute($paramsFull);
    $topSedes = $stmtSede->fetchAll();

    // ── Tendencia diaria (para la gráfica de evolución en el rango) ──
    $stmtTend = $pdo->prepare("
        SELECT DATE(fecha_mov) AS dia, SUM(cantidad) AS total_cantidad, COUNT(*) AS total_pedidos
        FROM ($sqlUnion) t
        WHERE fecha_mov IS NOT NULL
        " . ($filtroRef !== '' ? " AND ref = " . $pdo->quote($filtroRef) : "")
          . ($filtroUsuario !== '' ? " AND solicitado_por = " . $pdo->quote($filtroUsuario) : "") . "
        GROUP BY DATE(fecha_mov)
        ORDER BY dia ASC
    ");
    $stmtTend->execute($paramsFull);
    $tendencia = $stmtTend->fetchAll();

    // ── Movimientos detallados (el rastro completo, uno por uno) ──
    // Trae hasta 500 movimientos individuales con todos los datos:
    // quién solicitó, a dónde, quién lo envió, quién lo recibió, cuándo.
    // Esta tabla SIEMPRE muestra el rastreo completo (aprobado, en camino,
    // entregado, recibido) sin importar la casilla "incluir pendientes"
    // (esa casilla solo afecta los números resumen de arriba).
    $condProdMov = $filtroRef !== ''     ? " AND ref = "            . $pdo->quote($filtroRef)     : "";
    $condUsrMov  = $filtroUsuario !== '' ? " AND solicitado_por = " . $pdo->quote($filtroUsuario)  : "";
    $stmtMov = $pdo->prepare("
        SELECT es.id, sol.ref AS ref, sol.nombre AS nombre, es.cantidad, sol.solicitado_por,
               es.destino, es.estado, es.enviado_por, es.transportador, es.entregado_a, es.recibido_por,
               es.fecha_aprobado, es.fecha_envio, es.fecha_entrega, es.fecha_recibido, 'solicitud' AS tipo
        FROM envios_seguimiento es
        JOIN solicitudes sol ON sol.id = es.referencia_id AND es.tipo = 'solicitud'
        WHERE es.fecha_aprobado BETWEEN ? AND ? $condProdSol $condUsrSol
        UNION ALL
        SELECT es.id, pm.ref AS ref, pm.nombre AS nombre, es.cantidad, pm.solicitado_por,
               es.destino, es.estado, es.enviado_por, es.transportador, es.entregado_a, es.recibido_por,
               es.fecha_aprobado, es.fecha_envio, es.fecha_entrega, es.fecha_recibido, 'pedido' AS tipo
        FROM envios_seguimiento es
        JOIN pedidos_municipio pm ON pm.id = es.referencia_id AND es.tipo = 'pedido'
        WHERE es.fecha_aprobado BETWEEN ? AND ? $condProdPed $condUsrPed
        ORDER BY fecha_aprobado DESC
        LIMIT 500
    ");
    $stmtMov->execute([$desde, $hastaFin, $desde, $hastaFin]);
    $movimientos = $stmtMov->fetchAll();

    // Completar el nombre real de quien solicitó, envió y recibió en cada movimiento
    if ($movimientos) {
        $usuariosMap2 = $usuariosMap ?? [];
        if (!$usuariosMap2) {
            $rows2 = $pdo->query("SELECT usuario, nombre, apellido FROM usuarios")->fetchAll();
            foreach ($rows2 as $u) { $usuariosMap2[$u['usuario']] = $u; }
        }
        $nombreDe = function($usr) use ($usuariosMap2) {
            if (!$usr) return '';
            $info = $usuariosMap2[$usr] ?? null;
            $n = $info ? trim(($info['nombre'] ?? '') . ' ' . ($info['apellido'] ?? '')) : '';
            return $n !== '' ? $n : $usr;
        };
        foreach ($movimientos as &$m) {
            $m['solicitado_por_nombre'] = $nombreDe($m['solicitado_por']);
        }
        unset($m);
    }

    responder([
        'desde'              => $desdeOriginal ?: 'Todo el historial',
        'hasta'              => $hastaOriginal ?: 'hoy',
        'filtro_producto'    => $filtroRef,
        'filtro_usuario'     => $filtroUsuario,
        'incluir_pendientes' => $incluirPendientes,
        'top_productos'      => $topProductos,
        'stock_sin_movimiento' => $stockSinMovimiento,
        'valor_total_estancado' => $valorTotalEstancado,
        'top_usuarios'       => $topUsuarios,
        'top_sedes'          => $topSedes,
        'totales'            => $totales,
        'pendientes'         => $pendientes,
        'tendencia'          => $tendencia,
        'movimientos'        => $movimientos,
        'movimientos_truncado' => count($movimientos) >= 500,
    ]);
}

/* ══ MATERIAL DAÑADO Y RECOGIDO ══════════════════════════════
   Reporte separado: qué llegó dañado en envíos, qué se recogió en campo
   (reutilizable o dañado), y qué pasó con lo reutilizable después
   (sigue en poder de alguien / se devolvió / se gastó). */
if ($method === 'GET' && $action === 'incidencias_material') {
    $desde = trim($_GET['desde'] ?? '');
    $hasta = trim($_GET['hasta'] ?? '');
    if (!$desde) $desde = '2000-01-01';
    if (!$hasta) $hasta = date('Y-m-d');
    $hastaFin = $hasta . ' 23:59:59';

    $filtroRef     = trim($_GET['producto'] ?? '');
    $filtroUsuario = trim($_GET['usuario'] ?? '');
    $condProd = $filtroRef !== ''     ? " AND ref = "         . $pdo->quote($filtroRef)     : "";
    $condUsr  = $filtroUsuario !== '' ? " AND enviado_por = " . $pdo->quote($filtroUsuario)  : "";

    $origenes = "'dañado_recibido','recogido_reutilizable','recogido_dañado'";

    // Totales generales por tipo
    $stmtTot = $pdo->prepare("
        SELECT origen, COUNT(*) AS veces, COALESCE(SUM(cantidad),0) AS total
        FROM historial
        WHERE origen IN ($origenes) AND fecha BETWEEN ? AND ? $condProd $condUsr
        GROUP BY origen
    ");
    $stmtTot->execute([$desde, $hastaFin]);
    $totalesPorTipo = $stmtTot->fetchAll();

    // Top productos que más se dañan (cuenta dañado_recibido + recogido_dañado)
    $stmtProd = $pdo->prepare("
        SELECT ref, nombre, SUM(cantidad) AS total, COUNT(*) AS veces
        FROM historial
        WHERE origen IN ('dañado_recibido','recogido_dañado') AND fecha BETWEEN ? AND ? $condProd $condUsr
        GROUP BY ref, nombre
        ORDER BY total DESC
        LIMIT 15
    ");
    $stmtProd->execute([$desde, $hastaFin]);
    $topProductosDanados = $stmtProd->fetchAll();

    // Quién más reporta daño (enviado_por = quien lo registró)
    $stmtUsr = $pdo->prepare("
        SELECT enviado_por AS usuario, SUM(cantidad) AS total, COUNT(*) AS veces
        FROM historial
        WHERE origen IN ('dañado_recibido','recogido_dañado') AND fecha BETWEEN ? AND ? $condProd $condUsr
        GROUP BY enviado_por
        ORDER BY total DESC
        LIMIT 15
    ");
    $stmtUsr->execute([$desde, $hastaFin]);
    $topUsuariosDanan = $stmtUsr->fetchAll();
    if ($topUsuariosDanan) {
        $usuariosMapD = [];
        $rowsD = $pdo->query("SELECT usuario, nombre, apellido FROM usuarios")->fetchAll();
        foreach ($rowsD as $u) { $usuariosMapD[$u['usuario']] = $u; }
        foreach ($topUsuariosDanan as &$tu) {
            $info = $usuariosMapD[$tu['usuario']] ?? null;
            $tu['nombre_completo'] = $info ? trim(($info['nombre'] ?? '') . ' ' . ($info['apellido'] ?? '')) : $tu['usuario'];
            if ($tu['nombre_completo'] === '') $tu['nombre_completo'] = $tu['usuario'];
        }
        unset($tu);
    }

    // Qué pasó con lo reutilizable recogido: en poder / devuelto / gastado
    $condProdMR = $filtroRef !== ''     ? " AND ref = "     . $pdo->quote($filtroRef)     : "";
    $condUsrMR  = $filtroUsuario !== '' ? " AND usuario = " . $pdo->quote($filtroUsuario)  : "";
    $stmtEstadoReut = $pdo->prepare("
        SELECT estado, COUNT(*) AS veces, COALESCE(SUM(cantidad),0) AS total
        FROM material_recogido
        WHERE tipo = 'reutilizable' AND fecha BETWEEN ? AND ? $condProdMR $condUsrMR
        GROUP BY estado
    ");
    $stmtEstadoReut->execute([$desde, $hastaFin]);
    $estadoReutilizable = $stmtEstadoReut->fetchAll();

    // Todo lo que SIGUE pendiente de devolver ahora mismo, sin importar
    // cuándo se recogió — para que el admin pueda supervisar quién tiene
    // qué en su poder en este momento (no depende del rango de fechas).
    $stmtPendPersona = $pdo->prepare("
        SELECT mr.id, mr.usuario, mr.ref, mr.nombre, mr.cantidad, mr.motivo, mr.fecha,
               COALESCE(TRIM(CONCAT(u.nombre,' ',u.apellido)), mr.usuario) AS nombre_completo
        FROM material_recogido mr
        LEFT JOIN usuarios u ON u.usuario = mr.usuario
        WHERE mr.tipo = 'reutilizable' AND mr.estado = 'en_poder' $condProdMR $condUsrMR
        ORDER BY mr.fecha ASC
    ");
    $stmtPendPersona->execute();
    $pendientesPorPersona = $stmtPendPersona->fetchAll();

    // Detalle completo (los movimientos individuales, uno por uno)
    $stmtDet = $pdo->prepare("
        SELECT id, ref, nombre, destino, cantidad, enviado_por, descripcion, origen, fecha
        FROM historial
        WHERE origen IN ($origenes) AND fecha BETWEEN ? AND ? $condProd $condUsr
        ORDER BY fecha DESC
        LIMIT 300
    ");
    $stmtDet->execute([$desde, $hastaFin]);
    $detalle = $stmtDet->fetchAll();

    responder([
        'desde'                => $desde,
        'hasta'                => $hasta,
        'totales_por_tipo'     => $totalesPorTipo,
        'top_productos_danados'=> $topProductosDanados,
        'top_usuarios_danan'   => $topUsuariosDanan,
        'estado_reutilizable'  => $estadoReutilizable,
        'pendientes_por_persona' => $pendientesPorPersona,
        'detalle'              => $detalle,
        'detalle_truncado'     => count($detalle) >= 300,
    ]);
}

/* ══ AUDITORÍA FÍSICA POR PERSONA ══════════════════════════════
   Todo lo que el sistema dice que esta persona debería tener ahora
   mismo: productos normales, ONTs asignadas, carretes de fibra, y
   material recogido pendiente. Para comparar contra la realidad. */
if ($method === 'GET' && $action === 'auditoria_persona') {
    rolOPermiso(['superadmin'], 'auditar_inventario');
    $usuario = trim($_GET['usuario'] ?? '');
    if (!$usuario) responder(['error' => 'Indica la persona a auditar'], 400);

    $infoUsr = $pdo->prepare("SELECT usuario, nombre, apellido, rol, sede FROM usuarios WHERE usuario = ?");
    $infoUsr->execute([$usuario]);
    $persona = $infoUsr->fetch();
    if (!$persona) responder(['error' => 'Persona no encontrada'], 404);

    // Productos: distribuidor/superadmin manejan el ALMACÉN CENTRAL
    // (stock_neiva/stock_recuperado), no tienen inventario personal — para
    // ellos se audita eso. Todos los demás roles sí usan stock_usuarios.
    $esCentral = in_array($persona['rol'], ['superadmin', 'distribuidor']);
    if ($esCentral) {
        $stmtProd = $pdo->query("
            SELECT ref, nombre, unidad, stock_neiva, stock_recuperado
            FROM productos
            WHERE stock_neiva > 0 OR stock_recuperado > 0
            ORDER BY nombre ASC
        ");
        $productos = [];
        foreach ($stmtProd->fetchAll() as $r) {
            if ((float)$r['stock_neiva'] > 0) {
                $productos[] = ['ref' => $r['ref'], 'nombre' => $r['nombre'] . ' (🆕 Nuevo)', 'unidad' => $r['unidad'], 'cantidad' => (float)$r['stock_neiva']];
            }
            if ((float)$r['stock_recuperado'] > 0) {
                $productos[] = ['ref' => $r['ref'], 'nombre' => $r['nombre'] . ' (♻️ Recuperado)', 'unidad' => $r['unidad'], 'cantidad' => (float)$r['stock_recuperado']];
            }
        }
    } else {
        $stmtProd = $pdo->prepare("
            SELECT su.cantidad, p.ref, p.nombre, p.unidad
            FROM stock_usuarios su
            JOIN productos p ON p.id = su.producto_id
            WHERE su.usuario = ? AND su.cantidad > 0
            ORDER BY p.nombre ASC
        ");
        $stmtProd->execute([$usuario]);
        $productos = array_map(function($r){
            $r['cantidad'] = (float)$r['cantidad'];
            return $r;
        }, $stmtProd->fetchAll());
    }

    // ONTs — tanto las que son de esta persona (dueña) como las que está
    // instalando para otra oficina (instaladora)
    $colsOnt = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
    $colCliente = in_array('cliente_nombre', $colsOnt) ? 'cliente_nombre' : (in_array('cliente', $colsOnt) ? 'cliente' : "''");
    $stmtOnt = $pdo->prepare("
        SELECT mac_fmt, sn, modelo, estado, tecnico_asignado, tecnico_instalador, $colCliente AS cliente
        FROM ont_seriales
        WHERE tecnico_asignado = ? OR tecnico_instalador = ?
        ORDER BY estado ASC, modelo ASC
    ");
    $stmtOnt->execute([$usuario, $usuario]);
    $onts = $stmtOnt->fetchAll();

    // Carretes de fibra
    $stmtFib = $pdo->prepare("
        SELECT fc.codigo, fc.metros, fc.metros_usados, (fc.metros - fc.metros_usados) AS disponible,
               fcat.nombre AS categoria
        FROM fibra_carretes fc
        JOIN fibra_categorias fcat ON fcat.id = fc.categoria_id
        WHERE fc.usuario_actual = ? AND fc.estado = 'disponible'
        ORDER BY fcat.nombre ASC
    ");
    $stmtFib->execute([$usuario]);
    $fibra = $stmtFib->fetchAll();

    // Material recogido pendiente (reutilizable, todavía en su poder)
    $stmtRec = $pdo->prepare("
        SELECT ref, nombre, cantidad, motivo, fecha
        FROM material_recogido
        WHERE usuario = ? AND estado = 'en_poder' AND tipo = 'reutilizable'
        ORDER BY fecha ASC
    ");
    $stmtRec->execute([$usuario]);
    $recogido = $stmtRec->fetchAll();

    responder([
        'persona'   => $persona,
        'productos' => $productos,
        'onts'      => $onts,
        'fibra'     => $fibra,
        'recogido'  => $recogido,
        'total_items' => count($productos) + count($onts) + count($fibra) + count($recogido),
    ]);
}

/* ══ GUARDAR una auditoría ya realizada — queda buscable después ══ */
if ($method === 'POST' && $action === 'guardar_auditoria') {
    rolOPermiso(['superadmin'], 'auditar_inventario');
    $data = json_decode(file_get_contents('php://input'), true);
    $usuarioAuditado = trim($data['usuario'] ?? '');
    $datos = $data['datos'] ?? null;
    if (!$usuarioAuditado || !$datos) responder(['error' => 'Datos incompletos'], 400);

    $stmt = $pdo->prepare("INSERT INTO auditorias_inventario (usuario_auditado, realizado_por, datos) VALUES (?, ?, ?)");
    $stmt->execute([$usuarioAuditado, $_SESSION['usuario'], json_encode($datos, JSON_UNESCAPED_UNICODE)]);
    $id = $pdo->lastInsertId();

    auditar($pdo, 'guardar_auditoria', 'auditorias_inventario', "Auditoría de inventario guardada para $usuarioAuditado", (string)$id);
    responder(['ok' => true, 'id' => $id]);
}

/* ══ LISTAR auditorías guardadas de una persona (historial de auditorías) ══ */
if ($method === 'GET' && $action === 'listar_auditorias') {
    rolOPermiso(['superadmin'], 'auditar_inventario');
    $usuario = trim($_GET['usuario'] ?? '');
    if (!$usuario) responder(['error' => 'Falta el usuario'], 400);

    $stmt = $pdo->prepare("SELECT id, fecha, realizado_por FROM auditorias_inventario WHERE usuario_auditado = ? ORDER BY fecha DESC");
    $stmt->execute([$usuario]);
    responder($stmt->fetchAll());
}

/* ══ OBTENER una auditoría guardada específica (para ver detalle o el PDF) ══ */
if ($method === 'GET' && $action === 'obtener_auditoria') {
    rolOPermiso(['superadmin'], 'auditar_inventario');
    $id = intval($_GET['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);

    $stmt = $pdo->prepare("SELECT * FROM auditorias_inventario WHERE id = ?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if (!$row) responder(['error' => 'Auditoría no encontrada'], 404);

    $row['datos'] = json_decode($row['datos'], true);
    responder($row);
}

/* ══ INFORME DE VENTAS — cuánto se ha vendido, por quién, y qué productos
   se venden más. Es la pestaña "💰 Ventas" en Informes. ══ */
/* ══════════════════════════════════════
   INFORME DE ONT POR OFICINA (filtros: fecha, modelo, estado, oficina)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'onts_informe') {
    require_once __DIR__ . '/onts_informe_lib.php';
    // Respaldo: si en el servidor quedó una versión vieja de onts_informe_lib.php
    // sin esta función, que no se caiga el informe (solo afecta el texto del registro).
    if (!function_exists('_ontInformeResumenFiltros')) {
        function _ontInformeResumenFiltros(array $f, int $total): string {
            return 'Informe de ONT · ' . $total . ' registros';
        }
    }
    $fOnt = ontsInformeFiltrosDeGet($_GET);
    $dOnt = ontsInformeDatos($pdo, $fOnt);
    if (empty($_GET['auto'])) {   // no se anota cuando solo se abrió la pestaña
        auditar($pdo, 'generar_informe_onts', 'informes', _ontInformeResumenFiltros($fOnt, $dOnt['total']), '');
    }
    responder($dOnt);
}

// El Excel se arma en el navegador; esto solo deja constancia en el Registro de actividad
if ($method === 'POST' && $action === 'onts_informe_excel') {
    require_once __DIR__ . '/onts_informe_lib.php';
    if (!function_exists('_ontInformeResumenFiltros')) {
        function _ontInformeResumenFiltros(array $f, int $total): string { return 'Informe de ONT · ' . $total . ' registros'; }
    }
    $b = json_decode(file_get_contents('php://input'), true) ?: [];
    $fOnt = ontsInformeFiltrosDeGet($b);
    auditar($pdo, 'exportar_excel_onts', 'informes', 'Excel ' . _ontInformeResumenFiltros($fOnt, intval($b['total'] ?? 0)), '');
    responder(['ok' => true]);
}

/* ══ INFORME DE GASTOS (Informes → 📉 Gastos) ══ */
if ($method === 'GET' && $action === 'gastos_informe') {
    require_once __DIR__ . '/gastos_informe_lib.php';
    $fG = gastosInformeFiltrosDeGet($_GET);
    $dG = gastosInformeDatos($pdo, $fG);
    if (empty($_GET['auto'])) auditar($pdo, 'generar_informe_gastos', 'informes', gastosInformeResumenFiltros($fG, $dG['total']), '');
    responder($dG);
}
if ($method === 'POST' && $action === 'gastos_informe_excel') {
    require_once __DIR__ . '/gastos_informe_lib.php';
    $b = json_decode(file_get_contents('php://input'), true) ?: [];
    $fG = gastosInformeFiltrosDeGet($b);
    auditar($pdo, 'exportar_excel_gastos', 'informes', 'Excel ' . gastosInformeResumenFiltros($fG, intval($b['total'] ?? 0)), '');
    responder(['ok' => true]);
}

if ($method === 'GET' && $action === 'ventas') {
    $desde = trim($_GET['desde'] ?? '');
    $hasta = trim($_GET['hasta'] ?? '');
    if (!$desde) $desde = '2000-01-01';
    if (!$hasta) $hasta = date('Y-m-d');
    $hastaFin = $hasta . ' 23:59:59';

    auditar($pdo, 'generar_informe_ventas', 'informes', "Informe de ventas generado — rango: {$desde}..{$hasta}", '');

    // Totales generales
    $stmtTot = $pdo->prepare("
        SELECT COUNT(*) AS num_ventas, COALESCE(SUM(h.precio_total),0) AS total_ingresos,
               ROUND(COALESCE(SUM(h.cantidad / CASE WHEN pr.metros_por_unidad > 0 THEN pr.metros_por_unidad ELSE 1 END),0),1) AS total_unidades
        FROM historial h LEFT JOIN productos pr ON pr.ref = h.ref
        WHERE h.es_venta = 1 AND (h.anulado IS NULL OR h.anulado = 0) AND h.fecha BETWEEN ? AND ?
    ");
    $stmtTot->execute([$desde, $hastaFin]);
    $totales = $stmtTot->fetch();

    // Ranking de vendedores (quién ha vendido más, en plata y en cantidad)
    $stmtVend = $pdo->prepare("
        SELECT h.enviado_por AS usuario, COUNT(*) AS num_ventas,
               COALESCE(SUM(h.precio_total),0) AS total_vendido,
               ROUND(COALESCE(SUM(h.cantidad / CASE WHEN pr.metros_por_unidad > 0 THEN pr.metros_por_unidad ELSE 1 END),0),1) AS total_unidades
        FROM historial h LEFT JOIN productos pr ON pr.ref = h.ref
        WHERE h.es_venta = 1 AND (h.anulado IS NULL OR h.anulado = 0) AND h.fecha BETWEEN ? AND ?
        GROUP BY h.enviado_por
        ORDER BY total_vendido DESC
        LIMIT 20
    ");
    $stmtVend->execute([$desde, $hastaFin]);
    $vendedores = $stmtVend->fetchAll();
    // Agregar nombre completo de cada vendedor
    foreach ($vendedores as &$v) {
        $u = $pdo->prepare("SELECT nombre, apellido FROM usuarios WHERE usuario = ?");
        $u->execute([$v['usuario']]);
        $uRow = $u->fetch();
        $v['nombre_completo'] = $uRow ? trim($uRow['nombre'].' '.$uRow['apellido']) : $v['usuario'];
        if (!$v['nombre_completo']) $v['nombre_completo'] = $v['usuario'];
    }
    unset($v);

    // Ranking de productos más vendidos (por unidades y por plata)
    $stmtProdV = $pdo->prepare("
        SELECT h.ref AS ref, h.nombre AS nombre, COUNT(*) AS veces_vendido,
               ROUND(COALESCE(SUM(h.cantidad / CASE WHEN pr.metros_por_unidad > 0 THEN pr.metros_por_unidad ELSE 1 END),0),1) AS total_unidades,
               COALESCE(SUM(h.precio_total),0) AS total_vendido
        FROM historial h LEFT JOIN productos pr ON pr.ref = h.ref
        WHERE h.es_venta = 1 AND (h.anulado IS NULL OR h.anulado = 0) AND h.fecha BETWEEN ? AND ?
        GROUP BY h.ref, h.nombre
        ORDER BY total_vendido DESC
        LIMIT 20
    ");
    $stmtProdV->execute([$desde, $hastaFin]);
    $productosVendidos = $stmtProdV->fetchAll();

    // Formas de pago (para saber cuánto entra en efectivo vs transferencia, etc.)
    $stmtPago = $pdo->prepare("
        SELECT COALESCE(NULLIF(forma_pago,''),'Sin especificar') AS forma_pago,
               COUNT(*) AS num_ventas, COALESCE(SUM(precio_total),0) AS total
        FROM historial
        WHERE es_venta = 1 AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
        GROUP BY forma_pago
        ORDER BY total DESC
    ");
    $stmtPago->execute([$desde, $hastaFin]);
    $formasPago = $stmtPago->fetchAll();

    // Cuánto de lo vendido vino del pool "nuevo" vs "recuperado" — para que
    // quede visible que una parte de las ventas es material que alguien
    // devolvió, no solo stock comprado nuevo.
    $stmtOrigenVenta = $pdo->prepare("
        SELECT
            SUM(CASE WHEN h.descripcion LIKE '%Stock: ♻️ Recuperado%' THEN h.precio_total ELSE 0 END) AS total_recuperado,
            ROUND(SUM(CASE WHEN h.descripcion LIKE '%Stock: ♻️ Recuperado%' THEN h.cantidad / CASE WHEN pr.metros_por_unidad > 0 THEN pr.metros_por_unidad ELSE 1 END ELSE 0 END),1) AS unidades_recuperado,
            SUM(CASE WHEN h.descripcion LIKE '%Stock: ♻️ Recuperado%' THEN 0 ELSE h.precio_total END) AS total_nuevo
        FROM historial h LEFT JOIN productos pr ON pr.ref = h.ref
        WHERE h.es_venta = 1 AND (h.anulado IS NULL OR h.anulado = 0) AND h.fecha BETWEEN ? AND ?
    ");
    $stmtOrigenVenta->execute([$desde, $hastaFin]);
    $origenVentas = $stmtOrigenVenta->fetch();

    // Detalle completo (para la tabla y el Excel)
    $stmtDet = $pdo->prepare("
        SELECT id, ref, nombre, cantidad, cliente_venta, precio_unitario, precio_total,
               forma_pago, enviado_por, fecha, descripcion
        FROM historial
        WHERE es_venta = 1 AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
        ORDER BY fecha DESC
        LIMIT 500
    ");
    $stmtDet->execute([$desde, $hastaFin]);
    $detalle = $stmtDet->fetchAll();
    foreach ($detalle as &$d) {
        $d['es_recuperado'] = strpos($d['descripcion'] ?? '', 'Stock: ♻️ Recuperado') !== false;
    }
    unset($d);

    responder([
        'totales'            => $totales,
        'origen_ventas'      => $origenVentas,
        'vendedores'         => $vendedores,
        'productos_vendidos' => $productosVendidos,
        'formas_pago'        => $formasPago,
        'detalle'            => $detalle,
    ]);
}

/* ══ INFORME DE PROVEEDORES — cuánto se le ha comprado a cada uno,
   basado en los ingresos de stock que tienen proveedor registrado. ══ */
if ($method === 'GET' && $action === 'proveedores_informe') {
    $desde = trim($_GET['desde'] ?? '');
    $hasta = trim($_GET['hasta'] ?? '');
    if (!$desde) $desde = '2000-01-01';
    if (!$hasta) $hasta = date('Y-m-d');
    $hastaFin = $hasta . ' 23:59:59';

    auditar($pdo, 'generar_informe_proveedores', 'informes', "Informe de proveedores generado — rango: {$desde}..{$hasta}", '');

    // Totales generales (solo lo que tiene proveedor identificado)
    $stmtTot = $pdo->prepare("
        SELECT COUNT(*) AS num_ingresos, COALESCE(SUM(h.precio_total),0) AS total_comprado,
               ROUND(COALESCE(SUM(h.cantidad / CASE WHEN pr.metros_por_unidad > 0 THEN pr.metros_por_unidad ELSE 1 END),0),1) AS total_unidades,
               COUNT(DISTINCT h.proveedor) AS num_proveedores
        FROM historial h LEFT JOIN productos pr ON pr.ref = h.ref
        WHERE h.origen = 'ingreso' AND h.proveedor IS NOT NULL AND h.proveedor != ''
          AND (h.anulado IS NULL OR h.anulado = 0) AND h.fecha BETWEEN ? AND ?
    ");
    $stmtTot->execute([$desde, $hastaFin]);
    $totales = $stmtTot->fetch();

    // Ranking de proveedores (a quién se le ha comprado más)
    $stmtProv = $pdo->prepare("
        SELECT h.proveedor AS proveedor, COUNT(*) AS num_ingresos,
               COALESCE(SUM(h.precio_total),0) AS total_comprado,
               ROUND(COALESCE(SUM(h.cantidad / CASE WHEN pr.metros_por_unidad > 0 THEN pr.metros_por_unidad ELSE 1 END),0),1) AS total_unidades,
               MAX(h.fecha) AS ultima_compra
        FROM historial h LEFT JOIN productos pr ON pr.ref = h.ref
        WHERE h.origen = 'ingreso' AND h.proveedor IS NOT NULL AND h.proveedor != ''
          AND (h.anulado IS NULL OR h.anulado = 0) AND h.fecha BETWEEN ? AND ?
        GROUP BY h.proveedor
        ORDER BY total_comprado DESC
        LIMIT 30
    ");
    $stmtProv->execute([$desde, $hastaFin]);
    $proveedores = $stmtProv->fetchAll();

    // Qué productos se le compran a cada proveedor (para el detalle)
    $stmtDet = $pdo->prepare("
        SELECT id, ref, nombre, cantidad, proveedor, precio_unitario, precio_total, fecha
        FROM historial
        WHERE origen = 'ingreso' AND proveedor IS NOT NULL AND proveedor != ''
          AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
        ORDER BY fecha DESC
        LIMIT 500
    ");
    $stmtDet->execute([$desde, $hastaFin]);
    $detalle = $stmtDet->fetchAll();

    // Cuántos ingresos NO tienen proveedor identificado (para saber si
    // vale la pena empezar a registrarlo más consistentemente)
    $stmtSinProv = $pdo->prepare("
        SELECT COUNT(*) FROM historial
        WHERE origen = 'ingreso' AND (proveedor IS NULL OR proveedor = '')
          AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
    ");
    $stmtSinProv->execute([$desde, $hastaFin]);
    $sinProveedor = (int)$stmtSinProv->fetchColumn();

    responder([
        'totales'      => $totales,
        'proveedores'  => $proveedores,
        'detalle'      => $detalle,
        'sin_proveedor'=> $sinProveedor,
    ]);
}

/* ══ INFORME DE PROVEEDORES — cuánto se le ha comprado a cada uno,
   qué se les compra más, y el histórico de compras. ══ */
if ($method === 'GET' && $action === 'proveedores_informe') {
    $desde = trim($_GET['desde'] ?? '');
    $hasta = trim($_GET['hasta'] ?? '');
    if (!$desde) $desde = '2000-01-01';
    if (!$hasta) $hasta = date('Y-m-d');
    $hastaFin = $hasta . ' 23:59:59';

    auditar($pdo, 'generar_informe_proveedores', 'informes', "Informe de proveedores generado — rango: {$desde}..{$hasta}", '');

    // Totales generales (solo ingresos que sí tienen proveedor registrado)
    $stmtTot = $pdo->prepare("
        SELECT COUNT(*) AS num_ingresos, COALESCE(SUM(precio_total),0) AS total_comprado,
               COALESCE(SUM(cantidad),0) AS total_unidades,
               COUNT(DISTINCT proveedor) AS num_proveedores
        FROM historial
        WHERE origen = 'ingreso' AND proveedor IS NOT NULL AND proveedor != ''
          AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
    ");
    $stmtTot->execute([$desde, $hastaFin]);
    $totales = $stmtTot->fetch();

    // Ranking de proveedores — a quién se le ha comprado más
    $stmtProv = $pdo->prepare("
        SELECT proveedor, COUNT(*) AS num_ingresos,
               COALESCE(SUM(precio_total),0) AS total_comprado,
               COALESCE(SUM(cantidad),0) AS total_unidades,
               MAX(fecha) AS ultima_compra
        FROM historial
        WHERE origen = 'ingreso' AND proveedor IS NOT NULL AND proveedor != ''
          AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
        GROUP BY proveedor
        ORDER BY total_comprado DESC
        LIMIT 30
    ");
    $stmtProv->execute([$desde, $hastaFin]);
    $proveedores = $stmtProv->fetchAll();

    // Qué producto se le compra más a cada proveedor (el #1 de cada uno)
    foreach ($proveedores as &$pv) {
        $stmtTop = $pdo->prepare("
            SELECT nombre, SUM(cantidad) AS total
            FROM historial
            WHERE origen = 'ingreso' AND proveedor = ? AND (anulado IS NULL OR anulado = 0)
              AND fecha BETWEEN ? AND ?
            GROUP BY nombre
            ORDER BY total DESC
            LIMIT 1
        ");
        $stmtTop->execute([$pv['proveedor'], $desde, $hastaFin]);
        $topProd = $stmtTop->fetch();
        $pv['producto_top'] = $topProd ? $topProd['nombre'] : '—';
    }
    unset($pv);

    // Ingresos sin proveedor registrado (para saber cuánto queda "sin trazar")
    $stmtSinProv = $pdo->prepare("
        SELECT COUNT(*) AS num
        FROM historial
        WHERE origen = 'ingreso' AND (proveedor IS NULL OR proveedor = '')
          AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
    ");
    $stmtSinProv->execute([$desde, $hastaFin]);
    $sinProveedor = (int)$stmtSinProv->fetchColumn();

    // Detalle completo de compras (para la tabla y el Excel)
    $stmtDet = $pdo->prepare("
        SELECT id, ref, nombre, cantidad, proveedor, precio_unitario, precio_total, enviado_por, fecha
        FROM historial
        WHERE origen = 'ingreso' AND proveedor IS NOT NULL AND proveedor != ''
          AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
        ORDER BY fecha DESC
        LIMIT 500
    ");
    $stmtDet->execute([$desde, $hastaFin]);
    $detalle = $stmtDet->fetchAll();

    responder([
        'totales'       => $totales,
        'proveedores'   => $proveedores,
        'sin_proveedor' => $sinProveedor,
        'detalle'       => $detalle,
    ]);
}

/* ══ COSTOS VS VENTAS — cuánto se ha invertido comprando vs cuánto ha
   entrado vendiendo, y la tendencia mes a mes. Es el margen real (no
   contable exacto, pero da una foto clara de si el negocio está
   ganando o solo moviendo inventario). ══ */
if ($method === 'GET' && $action === 'costos_vs_ventas') {
    $desde = trim($_GET['desde'] ?? '');
    $hasta = trim($_GET['hasta'] ?? '');
    if (!$desde) $desde = '2000-01-01';
    if (!$hasta) $hasta = date('Y-m-d');
    $hastaFin = $hasta . ' 23:59:59';

    auditar($pdo, 'generar_informe_costos_ventas', 'informes', "Informe costos vs ventas generado — rango: {$desde}..{$hasta}", '');

    // Totales generales
    $stmtCostos = $pdo->prepare("
        SELECT COALESCE(SUM(precio_total),0) AS total, COUNT(*) AS num
        FROM historial
        WHERE origen = 'ingreso' AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
    ");
    $stmtCostos->execute([$desde, $hastaFin]);
    $costos = $stmtCostos->fetch();

    $stmtVentas = $pdo->prepare("
        SELECT COALESCE(SUM(precio_total),0) AS total, COUNT(*) AS num
        FROM historial
        WHERE es_venta = 1 AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
    ");
    $stmtVentas->execute([$desde, $hastaFin]);
    $ventas = $stmtVentas->fetch();

    $margen = (float)$ventas['total'] - (float)$costos['total'];

    // Tendencia mes a mes (últimos 12 meses dentro del rango, para el gráfico)
    $stmtTendCostos = $pdo->prepare("
        SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes, COALESCE(SUM(precio_total),0) AS total
        FROM historial
        WHERE origen = 'ingreso' AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
        GROUP BY mes ORDER BY mes ASC
    ");
    $stmtTendCostos->execute([$desde, $hastaFin]);
    $tendCostos = $stmtTendCostos->fetchAll();

    $stmtTendVentas = $pdo->prepare("
        SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes, COALESCE(SUM(precio_total),0) AS total
        FROM historial
        WHERE es_venta = 1 AND (anulado IS NULL OR anulado = 0) AND fecha BETWEEN ? AND ?
        GROUP BY mes ORDER BY mes ASC
    ");
    $stmtTendVentas->execute([$desde, $hastaFin]);
    $tendVentas = $stmtTendVentas->fetchAll();

    // Unir ambas series por mes, para que el gráfico tenga los mismos
    // puntos en el eje X aunque falte un dato en una de las 2.
    $mesesSet = [];
    foreach ($tendCostos as $r) $mesesSet[$r['mes']] = true;
    foreach ($tendVentas as $r) $mesesSet[$r['mes']] = true;
    $meses = array_keys($mesesSet);
    sort($meses);
    $costosPorMes = array_column($tendCostos, 'total', 'mes');
    $ventasPorMes = array_column($tendVentas, 'total', 'mes');
    $tendencia = array_map(function($m) use ($costosPorMes, $ventasPorMes){
        return [
            'mes'    => $m,
            'costos' => (float)($costosPorMes[$m] ?? 0),
            'ventas' => (float)($ventasPorMes[$m] ?? 0),
        ];
    }, $meses);

    responder([
        'costos'    => $costos,
        'ventas'    => $ventas,
        'margen'    => $margen,
        'tendencia' => $tendencia,
    ]);
}

responder(['error' => 'Acción no reconocida'], 400);