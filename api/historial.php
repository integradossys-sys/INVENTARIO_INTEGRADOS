<?php
require 'config.php';
require_once 'auditoria.php';
require_once __DIR__ . '/ont_seriales_lib.php';
sesionRequerida();

// Columnas dedicadas para marcar un ingreso anulado (en vez de texto mezclado en descripcion)
try {
    $colsHistAnu = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN);
    $faltantesAnu = [
        'anulado'          => "TINYINT(1) DEFAULT 0",
        'anulado_por'      => "VARCHAR(60) DEFAULT NULL",
        'anulado_en'       => "DATETIME DEFAULT NULL",
        'motivo_anulacion' => "VARCHAR(300) DEFAULT NULL",
        'stock_al_momento' => "INT DEFAULT NULL",
        'usuario_destino'  => "VARCHAR(60) DEFAULT NULL",
    ];
    foreach ($faltantesAnu as $col => $def) {
        if (!in_array($col, $colsHistAnu)) {
            $pdo->exec("ALTER TABLE historial ADD COLUMN $col $def");
        }
    }
} catch (\Throwable $e) { error_log('[historial/columnas anulacion] '.$e->getMessage()); }

// Teléfono opcional en cada proyecto/cliente.
try {
    $colsProy = $pdo->query("SHOW COLUMNS FROM proyectos")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('telefono', $colsProy)) {
        $pdo->exec("ALTER TABLE proyectos ADD COLUMN telefono VARCHAR(30) DEFAULT NULL");
    }
} catch (\Throwable $e) { error_log('[historial/columnas proyectos] '.$e->getMessage()); }

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ══════════════════════════════════════
   LISTAR historial (con filtros opcionales)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'listar') {
    $where  = [];
    $params = [];

    $hcolsAll = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN);
    $tieneColPag = in_array('pedido_agrupado_id', $hcolsAll);

    $rol = $_SESSION['rol'];
    if ($rol === 'municipio' || $rol === 'tecnico' || $rol === 'persona') {
        // Lo que le llegó a este usuario (usuario_destino) O lo que él mismo
        // asignó/envió directo a otra persona (enviado_por) — así, por
        // ejemplo, la oficina Palermo también ve en su Historial el material
        // que le asignó a tigre, no solo lo que recibió ella misma.
        // Estrictamente por usuario — no por sede. Los registros de antes
        // de este cambio (sin usuario_destino) no se muestran; solo admin
        // los sigue viendo todos.
        $where[]  = "(usuario_destino = ? OR enviado_por = ?)";
        $params[] = $_SESSION['usuario'];
        $params[] = $_SESSION['usuario'];
    }

    if (!empty($_GET['fecha'])) {
        $where[]  = "DATE(fecha) = ?";
        $params[] = $_GET['fecha'];
    }
    if (!empty($_GET['producto'])) {
        $where[]  = "(h.nombre LIKE ? OR h.ref LIKE ?)";
        $params[] = '%' . $_GET['producto'] . '%';
        $params[] = '%' . $_GET['producto'] . '%';
    }
    // Búsqueda por usuario / tipo de usuario: antes solo se filtraba lo ya cargado en pantalla
    // (las 50 más recientes), por eso los registros más viejos "no aparecían".
    if (!in_array($rol, ['municipio','tecnico','persona'], true)) {
        if (!empty($_GET['usuario'])) {
            $where[]  = "h.enviado_por LIKE ?";
            $params[] = '%' . $_GET['usuario'] . '%';
        }
        if (!empty($_GET['tipo_usuario'])) {
            $where[]  = "h.enviado_por IN (SELECT usuario FROM usuarios WHERE rol = ?)";
            $params[] = $_GET['tipo_usuario'];
        }
    }
    if (!empty($_GET['municipio']) && $rol !== 'municipio' && $rol !== 'tecnico' && $rol !== 'persona') {
        $where[]  = "destino = ?";
        $params[] = $_GET['municipio'];
    }
    if (!empty($_GET['origen'])) {
        $where[]  = "origen = ?";
        $params[] = $_GET['origen'];
    }
    if (isset($_GET['anulado']) && $_GET['anulado'] !== '') {
        $where[]  = "anulado = ?";
        $params[] = intval($_GET['anulado']);
    }

    // Paginación
    $pagina    = max(1, intval($_GET['pagina']    ?? 1));
    $porPagina = max(10, min(100, intval($_GET['por_pagina'] ?? 50)));
    $offset    = ($pagina - 1) * $porPagina;

    // Contar total de registros con los mismos filtros
    $sqlCount = "SELECT COUNT(*) FROM historial h LEFT JOIN productos p ON p.ref = h.ref"
              . ($where ? " WHERE " . implode(" AND ", $where) : "");
    $stmtCount = $pdo->prepare($sqlCount);
    $stmtCount->execute($params);
    $total = (int)$stmtCount->fetchColumn();

    $sql = "SELECT h.*, COALESCE(p.proveedor, '') as proveedor
             FROM historial h
             LEFT JOIN productos p ON p.ref = h.ref"
         . ($where ? " WHERE " . implode(" AND ", $where) : "")
         . " ORDER BY h.fecha DESC LIMIT $porPagina OFFSET $offset";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $resultado = array_map(function($h) use ($tieneColPag, $pdo) {
        return [
            'seriales'    => ontSerialesDeRegistro($pdo, $h),
            'id'          => $h['id'],
            'ref'         => $h['ref'],
            'nombre'      => $h['nombre'],
            'destino'     => $h['destino'],
            'cantidad'    => (int)$h['cantidad'],
            'unidadEnvio' => $h['unidad_envio'],
            'enviadoPor'  => $h['enviado_por'],
            'aprobadoPor' => $h['aprobado_por'] ?? '',
            'descripcion' => $h['descripcion'] ?? '',
            'proveedor'   => $h['proveedor']   ?? '',
            'estado'      => $h['estado'],
            'motivo'      => $h['motivo'] ?? '',
            '_esGasto'      => (bool)$h['es_gasto'],
            '_origen'       => $h['origen'],
            '_solicitudId'  => $h['solicitud_id'] ?? null,
            'pedidoAgrupadoId' => $tieneColPag ? ($h['pedido_agrupado_id'] ?? null) : null,
            'fecha'       => $h['fecha'],
            'anulado'         => !empty($h['anulado']),
            'anuladoPor'      => $h['anulado_por'] ?? '',
            'anuladoEn'       => $h['anulado_en'] ?? null,
            'motivoAnulacion' => $h['motivo_anulacion'] ?? '',
            'stockAlMomento'  => isset($h['stock_al_momento']) ? (int)$h['stock_al_momento'] : null,
            'gps_lat'         => $h['gps_lat'] ?? null,
            'gps_lng'         => $h['gps_lng'] ?? null,
            'usuarioDestino'  => $h['usuario_destino'] ?? null,
            'retirado'        => !empty($h['retirado']),
            'retiradoPor'     => $h['retirado_por'] ?? '',
            'retiradoEn'      => $h['retirado_en'] ?? null,
            'retiradoMotivo'  => $h['retirado_motivo'] ?? '',
            'es_venta'        => (int)($h['es_venta'] ?? 0),
            'cliente_venta'   => $h['cliente_venta'] ?? '',
            'precio_unitario' => $h['precio_unitario'] ?? null,
            'precio_total'    => $h['precio_total'] ?? null,
            'forma_pago'      => $h['forma_pago'] ?? '',
            'proyectoCliente' => $h['proyecto_cliente'] ?? '',
        ];
    }, $rows);

    responder([
        'registros'  => $resultado,
        'total'      => $total,
        'pagina'     => $pagina,
        'por_pagina' => $porPagina,
        'paginas'    => (int)ceil($total / $porPagina),
    ]);
}

/* ══════════════════════════════════════
   REGISTRAR movimiento
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'registrar') {
    // Nadie en la pantalla usa esto directo — se deja solo para superadmin
    // por si hace falta alguna vez, y queda auditado.
    rolRequerido('superadmin');
    $data = json_decode(file_get_contents('php://input'), true);

    $stmt = $pdo->prepare("
        INSERT INTO historial
          (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    ");
    $stmt->execute([
        $data['ref']         ?? '',
        $data['nombre']      ?? '',
        $data['destino']     ?? '',
        intval($data['cantidad'] ?? 0),
        $data['unidadEnvio'] ?? 'unidad',
        $data['enviadoPor']  ?? $_SESSION['usuario'],
        $data['descripcion'] ?? '',
        $data['estado']      ?? 'aprobado',
        !empty($data['_esGasto']) ? 1 : 0,
        $data['_origen']     ?? 'directo',
    ]);

    auditar($pdo, 'registrar', 'historial', "Registro manual en historial: " . ($data['nombre'] ?? ''), $data['ref'] ?? '');
    responder(['ok' => true, 'id' => $pdo->lastInsertId()]);
}

/* ══════════════════════════════════════
   STATS para la dona del Resumen
   Solo 4 números — sin traer filas completas
══════════════════════════════════════ */
/* DIAGNÓSTICO (solo superadmin): lista los rechazos que cuenta la gráfica del Resumen, para revisar de dónde sale cada uno. */
if ($method === 'GET' && $action === 'diag_rechazos') {
    if (($_SESSION['rol'] ?? '') !== 'superadmin') responder(['error' => 'Solo superadmin'], 403);
    $h = $pdo->query("SELECT id, ref, nombre, cantidad, destino, enviado_por, fecha, origen, pedido_agrupado_id, LEFT(descripcion,70) AS descripcion
                      FROM historial WHERE estado='rechazado' ORDER BY id DESC LIMIT 40")->fetchAll();
    $sl = $pdo->query("SELECT id, ref, nombre, cantidad, solicitado_por, pedido_agrupado_id, fecha_respuesta, LEFT(motivo,60) AS motivo
                       FROM solicitudes WHERE estado='rechazada' ORDER BY fecha_respuesta DESC LIMIT 40")->fetchAll();
    responder(['historial_rechazado' => $h, 'solicitudes_rechazadas' => $sl]);
}

if ($method === 'GET' && $action === 'stats_resumen') {
    $where  = [];
    $params = [];
    $rol = $_SESSION['rol'];
    if ($rol === 'municipio' || $rol === 'tecnico' || $rol === 'persona') {
        // "destino" ahora puede tener la sede (movimientos viejos) o el
        // usuario (movimientos nuevos, por persona) — se reconocen los dos.
        $where[]  = "(destino = ? OR destino = ?)";
        $params[] = $_SESSION['sede'];
        $params[] = $_SESSION['usuario'];
    }
    $w = $where ? "WHERE " . implode(" AND ", $where) : "";
    $q = $pdo->prepare("SELECT
        COUNT(DISTINCT CASE WHEN estado IN ('aprobado','recibido','entregado') AND es_gasto=0 THEN COALESCE(NULLIF(pedido_agrupado_id,''), CONCAT('h',id)) END) AS aprobados,
        COUNT(DISTINCT CASE WHEN estado='pendiente' THEN COALESCE(NULLIF(pedido_agrupado_id,''), CONCAT('h',id)) END) AS pendientes,
        COUNT(DISTINCT CASE WHEN estado='rechazado' THEN COALESCE(NULLIF(pedido_agrupado_id,''), CONCAT('h',id)) END) AS rechazados,
        SUM(CASE WHEN es_gasto=1                       THEN 1 ELSE 0 END) AS gastos
        FROM historial $w");
    $q->execute($params);
    $row = $q->fetch();

    // Serie diaria de los últimos 14 días (para la gráfica "Movimientos — 14 días")
    $porDia = [];
    try {
        $wd = $where; $pd = $params;
        $wd[] = "fecha >= DATE_SUB(CURDATE(), INTERVAL 13 DAY)";
        $q2 = $pdo->prepare("SELECT DATE(fecha) AS dia,
            COUNT(DISTINCT CASE WHEN estado IN ('aprobado','recibido','entregado') AND es_gasto=0 THEN COALESCE(NULLIF(pedido_agrupado_id,''), CONCAT('h',id)) END) AS aprobados,
            COUNT(DISTINCT CASE WHEN estado='rechazado' THEN COALESCE(NULLIF(pedido_agrupado_id,''), CONCAT('h',id)) END) AS rechazados,
            SUM(CASE WHEN es_gasto=1 THEN 1 ELSE 0 END) AS gastos
            FROM historial WHERE " . implode(" AND ", $wd) . " GROUP BY DATE(fecha)");
        $q2->execute($pd);
        foreach ($q2->fetchAll() as $r) {
            $porDia[$r['dia']] = [
                'aprobados'  => (int)$r['aprobados'],
                'rechazados' => (int)$r['rechazados'],
                'gastos'     => (int)$r['gastos'],
            ];
        }
    } catch (\Throwable $e) { error_log('[historial/stats por_dia] '.$e->getMessage()); }

    // Las solicitudes rechazadas (tabla solicitudes) NO escriben en historial, así que se suman aquí.
    // Los pedidos de municipio rechazados sí escriben en historial: no se suman otra vez (duplicaría).
    $rechazadosExtra = 0;
    try {
        $esAdminR = in_array($rol, ['superadmin', 'distribuidor'], true);
        $qs = "SELECT DATE(COALESCE(fecha_respuesta, fecha)) AS dia, COUNT(DISTINCT COALESCE(NULLIF(pedido_agrupado_id,''), id)) AS n FROM solicitudes WHERE estado='rechazada'";
        $ps = [];
        if (!$esAdminR) {
            $qs .= " AND (solicitado_por = ? OR destino = ? OR destino = ?)";
            $ps = [$_SESSION['usuario'], $_SESSION['sede'], $_SESSION['usuario']];
        }
        $desde14 = date('Y-m-d', strtotime('-13 days'));
        foreach ([[$qs, $ps]] as [$qq, $pr]) {
            $st = $pdo->prepare($qq . " GROUP BY dia");
            $st->execute($pr);
            foreach ($st->fetchAll() as $r) {
                $n = (int)$r['n'];
                $rechazadosExtra += $n;
                if ($r['dia'] && $r['dia'] >= $desde14) {
                    if (!isset($porDia[$r['dia']])) $porDia[$r['dia']] = ['aprobados' => 0, 'rechazados' => 0, 'gastos' => 0];
                    $porDia[$r['dia']]['rechazados'] += $n;
                }
            }
        }
    } catch (\Throwable $e) { error_log('[historial/stats rechazos extra] '.$e->getMessage()); }

    responder([
        'aprobados'  => (int)($row['aprobados']  ?? 0),
        'pendientes' => (int)($row['pendientes'] ?? 0),
        'rechazados' => (int)($row['rechazados'] ?? 0) + $rechazadosExtra,
        'gastos'     => (int)($row['gastos']     ?? 0),
        'por_dia'    => (object)$porDia,
    ]);
}

/* ══════════════════════════════════════
   MAPA — puntos con GPS (gastos + instalaciones ONT)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'puntos_mapa') {
    rolOPermiso(['superadmin', 'distribuidor'], 'ver_mapa_actividad');
    $rol = $_SESSION['rol'];
    // Quien llega hasta aquí ya pasó rolOPermiso: es admin/distribuidor o tiene el permiso
    // "ver_mapa_actividad" dado a mano. Con ese permiso ve TODO el mapa (no solo lo suyo).
    $esAdmin = true;
    $desde = trim($_GET['desde'] ?? '');
    $hasta = trim($_GET['hasta'] ?? '');
    $soloActivos = ($_GET['solo_activos'] ?? '1') !== '0';

    // 1) Gastos con GPS (de historial) — excluye los anulados (fueron un
    // error de registro) y, si se pide "solo activos", también los
    // retirados (sí pasaron, pero ya no siguen vigentes: se dañó, se lo
    // robaron, lo cambiaron — ver acción "marcar_retirado" más abajo).
    $whereH = ["gps_lat IS NOT NULL", "gps_lng IS NOT NULL", "origen != 'instalacion'", "(anulado IS NULL OR anulado = 0)"];
    if ($soloActivos) $whereH[] = "(retirado IS NULL OR retirado = 0)";
    $paramsH = [];
    if (!$esAdmin) { $whereH[] = "usuario_destino = ?"; $paramsH[] = $_SESSION['usuario']; }
    if ($desde) { $whereH[] = "DATE(fecha) >= ?"; $paramsH[] = $desde; }
    if ($hasta) { $whereH[] = "DATE(fecha) <= ?"; $paramsH[] = $hasta; }
    $sqlH = "SELECT id, ref, nombre, destino, cantidad, enviado_por, descripcion, fecha, gps_lat, gps_lng, es_gasto,
                    retirado, retirado_motivo, retirado_por, retirado_en, proyecto_cliente
             FROM historial WHERE " . implode(' AND ', $whereH) . " ORDER BY fecha DESC LIMIT 500";
    $stmtH = $pdo->prepare($sqlH);
    $stmtH->execute($paramsH);
    $gastos = array_map(function($r){
        return [
            'id' => (int)$r['id'],
            'tipo' => 'gasto',
            'lat' => (float)$r['gps_lat'], 'lng' => (float)$r['gps_lng'],
            'titulo' => $r['nombre'], 'producto' => $r['nombre'], 'cantidad' => (int)$r['cantidad'],
            'quien' => $r['enviado_por'], 'destino' => $r['destino'],
            'fecha' => $r['fecha'], 'detalle' => $r['descripcion'],
            'retirado' => (bool)$r['retirado'],
            'retirado_motivo' => $r['retirado_motivo'],
            'retirado_por' => $r['retirado_por'],
            'retirado_en' => $r['retirado_en'],
            'proyecto' => $r['proyecto_cliente'],
        ];
    }, $stmtH->fetchAll());

    // 2) Instalaciones de ONT con GPS
    $whereO = ["gps_lat IS NOT NULL", "gps_lng IS NOT NULL", "estado = 'comodato'"];
    $paramsO = [];
    if (!$esAdmin) { $whereO[] = "(tecnico_asignado = ? OR tecnico_instalador = ? OR tecnico_instalacion = ?)"; $paramsO = [$_SESSION['usuario'], $_SESSION['usuario'], $_SESSION['usuario']]; }
    if ($desde) { $whereO[] = "DATE(fecha_instalacion) >= ?"; $paramsO[] = $desde; }
    if ($hasta) { $whereO[] = "DATE(fecha_instalacion) <= ?"; $paramsO[] = $hasta; }
    $sqlO = "SELECT id, sn, mac, modelo, cliente_nombre, cliente_direccion, tecnico_instalacion, fecha_instalacion, gps_lat, gps_lng
             FROM ont_seriales WHERE " . implode(' AND ', $whereO) . " ORDER BY fecha_instalacion DESC LIMIT 500";
    $stmtO = $pdo->prepare($sqlO);
    $stmtO->execute($paramsO);
    $onts = array_map(function($r){
        return [
            'tipo' => 'ont',
            'lat' => (float)$r['gps_lat'], 'lng' => (float)$r['gps_lng'],
            'titulo' => '📡 ONT ' . ($r['modelo'] ?: '') . ' — ' . ($r['cliente_nombre'] ?: ''),
            'producto' => 'ONT ' . ($r['modelo'] ?: 'genérica'),
            'sn' => $r['sn'], 'quien' => $r['tecnico_instalacion'],
            'cliente' => $r['cliente_nombre'],
            'destino' => $r['cliente_direccion'],
            'fecha' => $r['fecha_instalacion'], 'detalle' => 'Cliente: ' . ($r['cliente_nombre'] ?: '—'),
        ];
    }, $stmtO->fetchAll());

    // Tipo de usuario (rol) y nombre de quien lo hizo, para poder filtrar en el mapa.
    $puntos = array_merge($gastos, $onts);
    $quienes = array_values(array_unique(array_filter(array_map(fn($x) => $x['quien'] ?? '', $puntos))));
    $infoU = [];
    if ($quienes) {
        $in = implode(',', array_fill(0, count($quienes), '?'));
        $stU = $pdo->prepare("SELECT usuario, rol, TRIM(CONCAT(COALESCE(nombre,''),' ',COALESCE(apellido,''))) AS nombre FROM usuarios WHERE usuario IN ($in)");
        $stU->execute($quienes);
        foreach ($stU->fetchAll() as $u) $infoU[$u['usuario']] = $u;
    }
    foreach ($puntos as &$pt) {
        $u = $infoU[$pt['quien'] ?? ''] ?? null;
        $pt['rol'] = $u['rol'] ?? '';
        $pt['quien_nombre'] = ($u && $u['nombre'] !== '') ? $u['nombre'] : ($pt['quien'] ?? '');
    }
    unset($pt);
    responder(['puntos' => $puntos]);
}

/* ══ MARCAR RETIRADO — algo instalado (mufla, caja, etc.) ya no está ahí:
   se dañó, se lo robaron, lo cambiaron. NO se anula (eso es para errores
   de registro) — el gasto SÍ pasó, solo que ya no sigue vigente. Se
   mantiene en Historial, pero desaparece del mapa como "activo". ══ */
if ($method === 'POST' && $action === 'marcar_retirado') {
    sesionRequerida();
    $data = json_decode(file_get_contents('php://input'), true);
    $id = intval($data['id'] ?? 0);
    $motivo = trim($data['motivo'] ?? '');
    if (!$id) responder(['error' => 'ID requerido'], 400);
    if (!$motivo) responder(['error' => 'Indica el motivo (dañado, robado, cambiado, etc.)'], 400);

    $chk = $pdo->prepare("SELECT nombre, es_gasto, usuario_destino, retirado FROM historial WHERE id = ?");
    $chk->execute([$id]);
    $h = $chk->fetch();
    if (!$h) responder(['error' => 'Registro no encontrado'], 404);
    if ((int)$h['retirado'] === 1) responder(['error' => 'Este punto ya estaba marcado como retirado'], 400);

    $rol = $_SESSION['rol'] ?? '';
    $miUsuario = $_SESSION['usuario'] ?? '';
    if (!in_array($rol, ['superadmin', 'distribuidor'])) {
        $chkPerm = $pdo->prepare("SELECT permisos FROM usuarios WHERE usuario = ?");
        $chkPerm->execute([$miUsuario]);
        $permsRet = json_decode($chkPerm->fetchColumn() ?: '[]', true) ?: [];
        if (empty($permsRet)) $permsRet = PERMISOS_DEFAULT_POR_ROL[$rol] ?? [];
        if (!in_array('marcar_retirado', $permsRet)) {
            responder(['error' => 'Sin permiso para marcar retirados'], 403);
        }
        // Aunque tenga el permiso, solo puede retirar lo suyo — no lo de otros.
        if ($h['usuario_destino'] !== $miUsuario) {
            responder(['error' => 'Solo puedes retirar tus propios registros'], 403);
        }
    }

    $pdo->prepare("
        UPDATE historial SET retirado = 1, retirado_motivo = ?, retirado_por = ?, retirado_en = NOW()
        WHERE id = ?
    ")->execute([$motivo, $miUsuario, $id]);

    auditar($pdo, 'marcar_retirado', 'historial', "Marcó como retirado: {$h['nombre']} — motivo: $motivo", (string)$id);
    responder(['ok' => true]);
}

/* ══ PROYECTOS/CLIENTES — sugerencias de autocompletado y vista agrupada ══ */
/* ══ Listar TODOS los proyectos/clientes conocidos, con su resumen —
   para el apartado dedicado "Proyectos", no solo la búsqueda puntual.
   (Antes había un segundo bloque idéntico más completo —con teléfono y
   los proyectos sin movimientos todavía— que nunca se ejecutaba porque
   este primer bloque ya respondía antes de llegar a él. Se unificó todo
   aquí para que sí se vea el teléfono y los proyectos recién creados.) ══ */
if ($method === 'GET' && $action === 'listar_proyectos') {
    sesionRequerida();
    $rol = $_SESSION['rol'] ?? '';
    // Todos los roles ven todo lo de cada cliente/proyecto (movimientos, productos y personas),
    // sin importar la sede de quien lo gastó.
    $veTodo = true;

    $sqlMov = "SELECT proyecto_cliente,
                      COUNT(*) AS total_movimientos,
                      COUNT(DISTINCT enviado_por) AS total_personas,
                      SUM(CASE WHEN es_venta = 1 THEN 1 ELSE 0 END) AS total_ventas,
                      MAX(fecha) AS ultima_fecha
               FROM historial
               WHERE proyecto_cliente IS NOT NULL AND proyecto_cliente != ''
                 AND es_gasto = 1 AND (anulado IS NULL OR anulado = 0)";
    $paramsMov = [];
    if (!$veTodo) {
        $sqlMov .= " AND enviado_por IN (SELECT usuario FROM usuarios WHERE sede_id = (SELECT sede_id FROM usuarios WHERE usuario = ?))";
        $paramsMov[] = $_SESSION['usuario'];
    }
    $sqlMov .= " GROUP BY proyecto_cliente";
    $stmtMov = $pdo->prepare($sqlMov);
    $stmtMov->execute($paramsMov);
    $movsPorNombre = [];
    foreach ($stmtMov->fetchAll() as $m) { $movsPorNombre[$m['proyecto_cliente']] = $m; }

    $stmtCat = $pdo->query("SELECT nombre, telefono, descripcion, creado_por, fecha AS fecha_creacion FROM proyectos WHERE activo = 1 ORDER BY nombre ASC");
    $resultado = [];
    foreach ($stmtCat->fetchAll() as $p) {
        $mov = $movsPorNombre[$p['nombre']] ?? null;
        $resultado[] = [
            'proyecto_cliente'  => $p['nombre'],
            'telefono'          => $p['telefono'],
            'descripcion'       => $p['descripcion'],
            'creado_por'        => $p['creado_por'],
            'total_movimientos' => $mov ? (int)$mov['total_movimientos'] : 0,
            'total_personas'    => $mov ? (int)$mov['total_personas'] : 0,
            'total_ventas'      => $mov ? (int)$mov['total_ventas'] : 0,
            'ultima_fecha'      => $mov ? $mov['ultima_fecha'] : $p['fecha_creacion'],
        ];
    }
    // Más recientes/activos primero
    usort($resultado, fn($a,$b) => strcmp($b['ultima_fecha'], $a['ultima_fecha']));
    responder($resultado);
}

/* ══ CATÁLOGO DE PROYECTOS — se crean primero, y al gastar solo se elige
   de esta lista (no texto libre), para que no haya 2 proyectos distintos
   por un error de tipeo (ej: "Pepe" vs "Pepa"). ══ */
if ($method === 'GET' && $action === 'catalogo_proyectos') {
    sesionRequerida();
    $stmt = $pdo->query("SELECT id, nombre, telefono, descripcion FROM proyectos WHERE activo = 1 ORDER BY nombre ASC");
    responder($stmt->fetchAll());
}

if ($method === 'POST' && $action === 'crear_proyecto') {
    sesionRequerida();
    $data = json_decode(file_get_contents('php://input'), true);
    $nombre   = trim($data['nombre'] ?? '');
    $telefono = trim($data['telefono'] ?? '');
    $desc     = trim($data['descripcion'] ?? '');
    if (!$nombre) responder(['error' => 'Escribe el nombre del proyecto'], 400);
    if (mb_strlen($nombre) < 3) responder(['error' => 'El nombre es muy corto'], 400);
    if ($telefono !== '' && !preg_match('/^[0-9]+$/', $telefono)) {
        responder(['error' => 'El teléfono solo puede tener números'], 400);
    }

    // Revisa si ya existe algo MUY parecido (mismo nombre sin importar
    // mayúsculas/espacios de más) — para que no se cree "Entrepinos" y
    // "entrepinos " como si fueran 2 proyectos distintos.
    $existe = $pdo->prepare("SELECT id, nombre, activo FROM proyectos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))");
    $existe->execute([$nombre]);
    $parecido = $existe->fetch();
    // Si ese proyecto fue eliminado antes (quedó archivado con su historial),
    // crearlo de nuevo simplemente lo reactiva.
    if ($parecido && (int)$parecido['activo'] === 0) {
        $pdo->prepare("UPDATE proyectos SET activo = 1, telefono = ?, descripcion = ? WHERE id = ?")
            ->execute([$telefono ?: null, $desc ?: null, $parecido['id']]);
        auditar($pdo, 'crear_proyecto', 'proyectos', "Reactivó el proyecto: {$parecido['nombre']}", (string)$parecido['id']);
        responder(['ok' => true, 'id' => $parecido['id'], 'nombre' => $parecido['nombre']]);
    }
    if ($parecido) {
        responder(['error' => "Ya existe un proyecto muy parecido: \"{$parecido['nombre']}\" — úsalo en vez de crear uno nuevo", 'existente' => $parecido], 409);
    }

    try {
        $pdo->prepare("INSERT INTO proyectos (nombre, telefono, descripcion, creado_por) VALUES (?, ?, ?, ?)")
            ->execute([$nombre, $telefono ?: null, $desc ?: null, $_SESSION['usuario']]);
        $id = $pdo->lastInsertId();
        auditar($pdo, 'crear_proyecto', 'proyectos', "Creó el proyecto: $nombre", (string)$id);
        responder(['ok' => true, 'id' => $id, 'nombre' => $nombre]);
    } catch (\Throwable $e) {
        responder(['error' => 'Ya existe un proyecto con ese nombre exacto'], 409);
    }
}

/* ══ EDITAR PROYECTO — cambiar nombre y/o teléfono de uno ya creado.
   Si el nombre cambia, también se actualizan las referencias que ya
   quedaron guardadas en el historial (proyecto_cliente es texto libre,
   no una llave foránea, así que si no se actualiza ahí, esos registros
   antiguos quedarían "huérfanos" con el nombre viejo). ══ */
if ($method === 'POST' && $action === 'editar_proyecto') {
    sesionRequerida();
    $data         = json_decode(file_get_contents('php://input'), true);
    $nombreActual = trim($data['nombre_actual'] ?? '');
    $nombreNuevo  = trim($data['nombre'] ?? '');
    $telefono     = trim($data['telefono'] ?? '');
    $desc         = trim($data['descripcion'] ?? '');
    if (!$nombreActual) responder(['error' => 'Falta indicar cuál proyecto editar'], 400);
    if (!$nombreNuevo) responder(['error' => 'Escribe el nombre del proyecto'], 400);
    if (mb_strlen($nombreNuevo) < 3) responder(['error' => 'El nombre es muy corto'], 400);
    if ($telefono !== '' && !preg_match('/^[0-9]+$/', $telefono)) {
        responder(['error' => 'El teléfono solo puede tener números'], 400);
    }

    $stmt = $pdo->prepare("SELECT id FROM proyectos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) AND activo = 1");
    $stmt->execute([$nombreActual]);
    $row = $stmt->fetch();
    if (!$row) responder(['error' => 'Ese proyecto no existe'], 404);

    $cambioNombre = strtolower(trim($nombreNuevo)) !== strtolower(trim($nombreActual));
    if ($cambioNombre) {
        // No dejar que el nuevo nombre choque con OTRO proyecto ya existente.
        $dupe = $pdo->prepare("SELECT id FROM proyectos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) AND id != ?");
        $dupe->execute([$nombreNuevo, $row['id']]);
        if ($dupe->fetch()) responder(['error' => "Ya existe otro proyecto llamado \"$nombreNuevo\""], 409);
    }

    $pdo->prepare("UPDATE proyectos SET nombre = ?, telefono = ?, descripcion = ? WHERE id = ?")
        ->execute([$nombreNuevo, $telefono ?: null, $desc ?: null, $row['id']]);

    if ($cambioNombre) {
        $pdo->prepare("UPDATE historial SET proyecto_cliente = ? WHERE proyecto_cliente = ?")
            ->execute([$nombreNuevo, $nombreActual]);
    }

    auditar($pdo, 'editar_proyecto', 'proyectos', "Editó el proyecto: $nombreActual → $nombreNuevo", (string)$row['id']);
    responder(['ok' => true, 'nombre' => $nombreNuevo]);
}

/* ══ ELIMINAR PROYECTO / CLIENTE — solo superadmin o quien tenga el permiso
   "eliminar_proyectos". Si nunca tuvo movimientos se borra de verdad. Si ya
   tiene historial, se ARCHIVA (desaparece de las listas, pero los movimientos
   viejos conservan su nombre y los informes no se rompen). ══ */
if ($method === 'POST' && $action === 'eliminar_proyecto') {
    rolOPermiso(['superadmin'], 'eliminar_proyectos');
    $data   = json_decode(file_get_contents('php://input'), true);
    $nombre = trim($data['nombre'] ?? '');
    if (!$nombre) responder(['error' => 'Falta indicar cuál proyecto eliminar'], 400);

    $stmt = $pdo->prepare("SELECT id, nombre FROM proyectos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) AND activo = 1");
    $stmt->execute([$nombre]);
    $row = $stmt->fetch();
    if (!$row) responder(['error' => 'Ese proyecto no existe'], 404);

    $c = $pdo->prepare("SELECT COUNT(*) FROM historial WHERE proyecto_cliente = ?");
    $c->execute([$row['nombre']]);
    $movs = (int)$c->fetchColumn();

    if ($movs === 0) {
        $pdo->prepare("DELETE FROM proyectos WHERE id = ?")->execute([$row['id']]);
        $modo = 'borrado';
    } else {
        $pdo->prepare("UPDATE proyectos SET activo = 0 WHERE id = ?")->execute([$row['id']]);
        $modo = 'archivado';
    }
    auditar($pdo, 'eliminar_proyecto', 'proyectos',
        "Eliminó el proyecto/cliente: {$row['nombre']} ($modo, $movs movimientos en el historial) (por {$_SESSION['usuario']})", (string)$row['id']);
    responder(['ok' => true, 'modo' => $modo, 'movimientos' => $movs]);
}

if ($method === 'GET' && $action === 'proyectos_sugeridos') {
    sesionRequerida();
    $q = trim($_GET['q'] ?? '');
    $sql = "SELECT DISTINCT proyecto_cliente FROM historial WHERE proyecto_cliente IS NOT NULL AND proyecto_cliente != ''";
    $params = [];
    if ($q) { $sql .= " AND proyecto_cliente LIKE ?"; $params[] = "%$q%"; }
    $sql .= " ORDER BY proyecto_cliente ASC LIMIT 15";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    responder($stmt->fetchAll(PDO::FETCH_COLUMN));
}

if ($method === 'GET' && $action === 'ver_por_proyecto') {
    sesionRequerida();
    $proyecto = trim($_GET['proyecto'] ?? '');
    if (!$proyecto) responder(['error' => 'Escribe el nombre del proyecto/cliente'], 400);

    // Superadmin/distribuidor ven todo lo de ese proyecto sin importar
    // quién lo gastó; los demás roles solo ven lo de su propia gente (no
    // pueden husmear el trabajo de otras oficinas).
    $rol = $_SESSION['rol'] ?? '';
    $veTodo = true; // todos los roles ven todo lo del proyecto

    $sql = "SELECT id, ref, nombre, cantidad, unidad_envio, enviado_por, descripcion, fecha, gps_lat, gps_lng, es_venta, precio_total,
                   retirado, retirado_motivo, retirado_por, retirado_en
            FROM historial
            WHERE proyecto_cliente = ? AND es_gasto = 1 AND (anulado IS NULL OR anulado = 0)";
    $params = [$proyecto];
    if (!$veTodo) {
        $sql .= " AND enviado_por IN (SELECT usuario FROM usuarios WHERE sede_id = (SELECT sede_id FROM usuarios WHERE usuario = ?))";
        $params[] = $_SESSION['usuario'];
    }
    $sql .= " ORDER BY fecha ASC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $filas = $stmt->fetchAll();

    // Resumen: total por producto (con su unidad), y quién ha trabajado ahí
    $porProducto = [];
    $porProductoUnidad = [];
    $porTecnico = [];
    $porProductoRetirado = [];
    $totalRetirados = 0;
    foreach ($filas as $f) {
        $key = $f['nombre'];
        $porProductoUnidad[$key] = $f['unidad_envio'] ?: 'unidad';
        if (!empty($f['retirado'])) {
            // Lo retirado ya no está en el cliente: se cuenta aparte.
            $porProductoRetirado[$key] = ($porProductoRetirado[$key] ?? 0) + (float)$f['cantidad'];
            $totalRetirados++;
        } else {
            $porProducto[$key] = ($porProducto[$key] ?? 0) + (float)$f['cantidad'];
        }
        $porTecnico[$f['enviado_por']] = ($porTecnico[$f['enviado_por']] ?? 0) + 1;
    }

    responder([
        'proyecto' => $proyecto,
        'detalle' => $filas,
        'resumen_productos' => $porProducto,
        'resumen_productos_unidad' => $porProductoUnidad,
        'resumen_retirados' => $porProductoRetirado,
        'total_retirados' => $totalRetirados,
        'tecnicos' => array_keys($porTecnico),
        'total_movimientos' => count($filas),
    ]);
}

responder(['error' => 'Acción no reconocida'], 400);
