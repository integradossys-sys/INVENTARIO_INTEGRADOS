<?php
/* ══════════════════════════════════════════════════════
   equipos.php — OLTs, Equipos (antes Mikrotiks) y tipos
   Integrados S&S
══════════════════════════════════════════════════════ */
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);
require_once 'config.php';

/* Municipio/técnico/persona no pueden asignarle material al distribuidor ni al administrador: a ellos solo se les devuelve. */
if (!function_exists('destinoAsignablePorMi')) {
    function destinoAsignablePorMi($pdo, $aQuien) {
        if (!in_array($_SESSION['rol'] ?? '', ['municipio','tecnico','persona'], true)) return true;
        $st = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?");
        $st->execute([$aQuien]);
        return !in_array($st->fetchColumn(), ['superadmin','distribuidor'], true);
    }
}
require_once 'auditoria.php';
require_once 'notificaciones.php';
sesionRequerida();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ── Auto-migración: columna marca en mikrotiks ── */
try {
    $pdo->exec("ALTER TABLE mikrotiks ADD COLUMN marca VARCHAR(80) NOT NULL DEFAULT ''");
} catch (\Throwable $e) { /* ya existe */ }
try {
    $pdo->exec("ALTER TABLE mikrotiks ADD COLUMN tipo_equipo VARCHAR(80) NOT NULL DEFAULT 'Mikrotik'");
} catch (\Throwable $e) { /* ya existe */ }

/* ── Auto-migración: datos del cliente cuando un OLT/equipo se marca
   "instalado" — antes no existía ningún dato de a quién/dónde quedó,
   así que no se podía ver la evidencia en Cliente/Proyecto. ── */
foreach (['olts', 'mikrotiks'] as $_tablaCli) {
    foreach ([
        'cliente_nombre'    => "VARCHAR(150) DEFAULT NULL",
        'cliente_direccion' => "VARCHAR(250) DEFAULT NULL",
        'gps_lat'           => "DECIMAL(10,7) DEFAULT NULL",
        'gps_lng'           => "DECIMAL(10,7) DEFAULT NULL",
        // "asignado_a" = a qué PERSONA puntual quedó este equipo (no solo
        // a qué sede/oficina). Si está vacío, el equipo es "de la oficina"
        // y lo ve cualquiera que trabaje ahí — igual que antes. Si tiene un
        // usuario, SOLO esa persona lo ve en "Mis equipos", aunque otros
        // compartan su misma sede (ver listar_olts/listar_mikrotiks).
        'asignado_a'        => "VARCHAR(60) DEFAULT NULL",
    ] as $_col => $_def) {
        try { $pdo->exec("ALTER TABLE $_tablaCli ADD COLUMN $_col $_def"); } catch (\Throwable $e) { /* ya existe */ }
    }
}

/* ── Auto-migración: tabla de confirmaciones de cambio de estado de equipo.
   Cuando alguien marca un OLT/Mikrotik como dañado/recuperado/de_baja/
   comodato/instalado, el cambio no se aplica de una — queda aquí, pendiente,
   hasta que la persona nombrada (usuario_confirma) diga si es cierto. ── */
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS equipo_confirmaciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tipo VARCHAR(20) NOT NULL,
        equipo_id INT NOT NULL,
        estado_propuesto VARCHAR(30) NOT NULL,
        nota TEXT,
        cliente_nombre VARCHAR(150) DEFAULT NULL,
        cliente_direccion VARCHAR(250) DEFAULT NULL,
        lat DECIMAL(10,7) DEFAULT NULL,
        lng DECIMAL(10,7) DEFAULT NULL,
        lote_id VARCHAR(60) DEFAULT NULL,
        propuesto_por VARCHAR(60) NOT NULL,
        usuario_confirma VARCHAR(60) NOT NULL,
        resultado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        creado_en DATETIME DEFAULT CURRENT_TIMESTAMP,
        resuelto_en DATETIME DEFAULT NULL,
        INDEX idx_confirma_pend (usuario_confirma, resultado)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
} catch (\Throwable $e) { /* ya existe */ }

/* ── Auto-migración: tabla de tipos de equipo ── */
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS tipos_equipo (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nombre VARCHAR(80) NOT NULL UNIQUE,
        icono VARCHAR(10) DEFAULT '📦',
        descripcion VARCHAR(200) DEFAULT '',
        creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    /* Agregar columna descripcion si no existe */
    try { $pdo->exec("ALTER TABLE tipos_equipo ADD COLUMN descripcion VARCHAR(200) DEFAULT ''"); } catch(\Throwable $e){}
} catch (\Throwable $e) { /* ya existe */ }

/* Limpiar tipos predeterminados una sola vez usando una bandera en la BD */
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS _migraciones (clave VARCHAR(100) PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    $yaHecho = $pdo->query("SELECT COUNT(*) FROM _migraciones WHERE clave='tipos_equipo_limpieza_v1'")->fetchColumn();
    if (!$yaHecho) {
        $defaults = ['Mikrotik','Router','Impresora','Validadora','Switch','Servidor'];
        $ph = implode(',', array_fill(0, count($defaults), '?'));
        $pdo->prepare("DELETE FROM tipos_equipo WHERE nombre IN ($ph)")->execute($defaults);
        $pdo->exec("INSERT IGNORE INTO _migraciones (clave) VALUES ('tipos_equipo_limpieza_v1')");
    }
} catch (\Throwable $e) { /* ignorar */ }

/* OLT: columna proveedor (migración segura) */
try {
    $colsOlt = $pdo->query("SHOW COLUMNS FROM olts")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('proveedor', $colsOlt)) $pdo->exec("ALTER TABLE olts ADD COLUMN proveedor VARCHAR(150) DEFAULT NULL");
} catch (\Throwable $e) { error_log('[equipos/olts proveedor] ' . $e->getMessage()); }

/* ── CRUD tipos de equipo ── */
if ($method === 'GET' && $action === 'listar_tipos_equipo') {
    $rows = $pdo->query("SELECT * FROM tipos_equipo ORDER BY nombre ASC")->fetchAll();
    responder($rows);
}
if ($method === 'POST' && $action === 'crear_tipo_equipo') {
    rolOPermiso(['superadmin'], 'gestionar_equipos');
    $d = json_decode(file_get_contents('php://input'), true);
    $nombre = trim($d['nombre'] ?? '');
    $icono  = trim($d['icono']  ?? '📦');
    $desc   = trim($d['descripcion'] ?? '');
    if (!$nombre) responder(['error' => 'Nombre requerido'], 400);
    try {
        $pdo->prepare("INSERT INTO tipos_equipo (nombre, icono, descripcion) VALUES (?,?,?)")->execute([$nombre, $icono, $desc]);
        $nuevoId = $pdo->lastInsertId();
        auditar($pdo, 'crear_tipo_equipo', 'tipos_equipo', "Creado tipo de equipo: $nombre", (string)$nuevoId);
        responder(['ok' => true, 'id' => $nuevoId]);
    } catch (\Throwable $e) { responder(['error' => 'Ya existe un tipo con ese nombre'], 409); }
}
function _tipoEquipoBloqueo(PDO $pdo, string $nombre): ?string {
    if ($nombre === '') return null;
    $st = $pdo->prepare("SELECT COUNT(*) FROM mikrotiks WHERE tipo_equipo = ?");
    $st->execute([$nombre]);
    $n = (int)$st->fetchColumn();
    if (strcasecmp($nombre, 'OLT') === 0) {
        try { $n += (int)$pdo->query("SELECT COUNT(*) FROM olts")->fetchColumn(); } catch (\Throwable $e) {}
    }
    if ($n > 0) {
        return "Ya hay $n equipo(s) registrado(s) con el tipo \"$nombre\". No se puede eliminar el tipo mientras existan equipos de este tipo. Primero elimina esos equipos (déjalos disponibles en el almacén y bórralos) y después podrás eliminar el tipo.";
    }
    return null;
}
if ($method === 'GET' && $action === 'puede_eliminar_tipo_equipo') {
    rolOPermiso(['superadmin'], 'gestionar_equipos');
    $st = $pdo->prepare("SELECT nombre FROM tipos_equipo WHERE id=?");
    $st->execute([intval($_GET['id'] ?? 0)]);
    $m = _tipoEquipoBloqueo($pdo, (string)$st->fetchColumn());
    responder(['ok' => $m === null, 'motivo' => $m]);
}
if ($method === 'POST' && $action === 'eliminar_tipo_equipo') {
    rolOPermiso(['superadmin'], 'gestionar_equipos');
    $d  = json_decode(file_get_contents('php://input'), true) ?: [];
    $id = intval($d['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);
    exigirPasswordSesion($d);
    $infoTipo = $pdo->prepare("SELECT nombre FROM tipos_equipo WHERE id=?");
    $infoTipo->execute([$id]);
    $nombreTipo = (string)$infoTipo->fetchColumn();
    $m = _tipoEquipoBloqueo($pdo, $nombreTipo);
    if ($m) responder(['error' => $m, 'bloqueado' => true], 400);
    $pdo->prepare("DELETE FROM tipos_equipo WHERE id=?")->execute([$id]);
    auditar($pdo, 'eliminar_tipo_equipo', 'tipos_equipo', "Eliminado tipo de equipo: " . ($nombreTipo ?: $id), (string)$id);
    responder(['ok' => true]);
}

/* ══ OLTs ══════════════════════════════════════════ */

// Listar OLTs
if ($method === 'GET' && $action === 'listar_olts') {
    $where = []; $params = [];
    // Seguridad: los roles no-admin solo ven los equipos de SU sede,
    // sin importar lo que llegue por parámetro.
    $rol = $_SESSION['rol'] ?? '';
    if ($rol !== 'superadmin' && $rol !== 'distribuidor') {
        $where[] = "sede = ?"; $params[] = $_SESSION['sede'] ?? '';
        // Si el equipo quedó asignado a una PERSONA puntual (asignado_a),
        // solo esa persona lo ve, aunque otros compartan su misma sede —
        // si no tiene a nadie asignado en puntual, es "de la oficina" y lo
        // ve cualquiera de ahí, como siempre.
        $where[] = "(asignado_a IS NULL OR asignado_a = '' OR asignado_a = ?)"; $params[] = $_SESSION['usuario'] ?? '';
    } elseif (!empty($_GET['sede'])) {
        $where[] = "sede = ?"; $params[] = $_GET['sede'];
    }
    if (!empty($_GET['estado'])) { $where[] = "estado = ?";           $params[] = $_GET['estado']; }
    if (!empty($_GET['q']))      { $where[] = "(marca LIKE ? OR modelo LIKE ?)"; $params[] = '%'.$_GET['q'].'%'; $params[] = '%'.$_GET['q'].'%'; }
    $sql = "SELECT olts.*,
                   (SELECT COUNT(*) FROM envios_seguimiento es
                     WHERE es.tipo='olt' AND es.referencia_id=olts.id
                       AND es.estado IN ('aprobado','en_camino','entregado')) AS en_envio,
                   (SELECT TRIM(CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,''))) FROM usuarios u WHERE u.usuario = olts.asignado_a LIMIT 1) AS asignado_nombre
            FROM olts" . ($where ? " WHERE ".implode(" AND ",$where) : "") . " ORDER BY fecha DESC";
    $stmt = $pdo->prepare($sql); $stmt->execute($params);
    responder($stmt->fetchAll());
}

// Crear OLT
if ($method === 'POST' && $action === 'crear_olt') {
    rolOPermisoAlt(['superadmin'], ['gestionar_olt', 'gestionar_equipos']);
    $d = json_decode(file_get_contents('php://input'), true) ?? [];
    $marca        = trim($d['marca']        ?? '');
    $modelo       = trim($d['modelo']       ?? '');
    $tarjetas     = intval($d['tarjetas_pon']?? 0);
    $puertos      = intval($d['puertos_pon'] ?? 0);
    $sede         = trim($d['sede']         ?? '') ?: 'Almacen Central';
    $notas        = trim($d['notas']        ?? '');
    $proveedor    = mb_substr(trim($d['proveedor'] ?? ''), 0, 150);
    if (!$marca || !$modelo) responder(['error' => 'Marca y modelo son requeridos'], 400);
    // El proveedor es opcional; si viene, debe existir en la lista.
    if ($proveedor !== '') {
        $qp = $pdo->prepare("SELECT nombre FROM proveedores WHERE LOWER(TRIM(nombre)) = LOWER(?) LIMIT 1");
        $qp->execute([$proveedor]);
        $provReal = $qp->fetchColumn();
        if ($provReal === false) responder(['error' => 'Ese proveedor no existe. Créalo primero en Proveedores.'], 400);
        $proveedor = $provReal;
    }
    $pdo->prepare("INSERT INTO olts (marca, modelo, proveedor, tarjetas_pon, puertos_pon, sede, notas, registrado_por, fecha)
        VALUES (?,?,?,?,?,?,?,?,NOW())")
        ->execute([$marca, $modelo, $proveedor ?: null, $tarjetas, $puertos, $sede, $notas, $_SESSION['usuario']]);
    $id = $pdo->lastInsertId();
    auditar($pdo, 'crear', 'olts', "OLT creada: $marca $modelo — $sede", '');
    // Aparece en Historial → Ingreso (solo registro; no mueve stock de productos)
    try {
        $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,proveedor,fecha)
            VALUES ('OLT',?,?,1,'unidad',?,?,'aprobado',0,'ingreso',?,NOW())")
            ->execute(["OLT $marca $modelo", $sede, $_SESSION['usuario'],
                "Registro de OLT: $marca $modelo · {$tarjetas} tarjetas / {$puertos} puertos PON" . ($notas !== '' ? " · Notas: $notas" : ''), $proveedor ?: null]);
    } catch (\Throwable $e) { error_log('[hist olt] '.$e->getMessage()); }
    responder(['ok' => true, 'id' => $id]);
}

// Editar OLT
if ($method === 'POST' && $action === 'editar_olt') {
    rolOPermisoAlt(['superadmin'], ['gestionar_olt', 'gestionar_equipos']);
    $d = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = intval($d['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);
    // Editar a mano desde el admin deja el equipo "libre" (de toda la
    // oficina) — esta pantalla no permite elegir una persona puntual, así
    // que si quedaba asignado a alguien en concreto, se limpia para que no
    // desaparezca por accidente de la vista de los demás de esa sede.
    $pdo->prepare("UPDATE olts SET marca=?, modelo=?, proveedor=?, tarjetas_pon=?, puertos_pon=?, sede=?, estado=?, notas=?, asignado_a=NULL WHERE id=?")
        ->execute([$d['marca'], $d['modelo'], ($d['proveedor'] ?? null) ?: null, $d['tarjetas_pon'], $d['puertos_pon'], $d['sede'], $d['estado']??'activo', $d['notas']??'', $id]);
    auditar($pdo, 'editar', 'olts', "OLT editada: #{$id}", '');
    responder(['ok' => true]);
}

/* Motivo por el que un equipo (OLT/Mikrotik) NO se puede eliminar todavía (null = se puede). */
function _equipoBloqueoEliminar(PDO $pdo, string $tabla, int $id): ?string {
    if (!in_array($tabla, ['olts','mikrotiks'], true)) return 'Tipo de equipo no válido.';
    $tipo = $tabla === 'olts' ? 'olt' : 'mikrotik';
    $q = $pdo->prepare("SELECT estado, asignado_a, sede, cliente_nombre FROM $tabla WHERE id = ?");
    $q->execute([$id]); $r = $q->fetch();
    if (!$r) return 'El equipo ya no existe.';
    $fin = ' Primero déjalo DISPONIBLE (devuélvelo al almacén y que lo reciban) y después podrás eliminarlo.';
    if ($r['estado'] === 'comodato' || $r['estado'] === 'instalado')
        return 'Está en comodato / instalado' . ($r['cliente_nombre'] ? ' en "' . $r['cliente_nombre'] . '"' : '') . '.' . $fin;
    if (!empty($r['asignado_a'])) return 'Está en poder de "' . $r['asignado_a'] . '".' . $fin;
    if ($r['estado'] === 'en_venta') return 'Tiene una venta pendiente de aprobación. Espera a que la aprueben o rechacen (o cancélala).';
    $e = $pdo->prepare("SELECT COUNT(*) FROM envios_seguimiento WHERE tipo = ? AND referencia_id = ? AND estado IN ('aprobado','en_camino','entregado')");
    $e->execute([$tipo, $id]);
    if ($e->fetchColumn() > 0) return 'Va en un envío que todavía no se ha recibido.' . $fin;
    if (!empty($r['sede'])) {
        $t = $pdo->prepare("SELECT tipo FROM sedes WHERE nombre = ? LIMIT 1");
        $t->execute([$r['sede']]); $tp = $t->fetchColumn();
        if ($tp !== false && $tp !== 'central') return 'Está en la sede "' . $r['sede'] . '", no en el almacén.' . $fin;
    }
    return null;
}

if ($method === 'GET' && $action === 'puede_eliminar_equipo') {
    $tabla = ($_GET['tipo'] ?? '') === 'olt' ? 'olts' : (($_GET['tipo'] ?? '') === 'mikrotik' ? 'mikrotiks' : '');
    $mot = $tabla ? _equipoBloqueoEliminar($pdo, $tabla, intval($_GET['id'] ?? 0)) : 'Tipo de equipo no válido.';
    responder(['ok' => $mot === null, 'motivo' => $mot]);
}

// Eliminar OLT
if ($method === 'POST' && $action === 'eliminar_olt') {
    rolOPermisoAlt(['superadmin'], ['gestionar_olt', 'gestionar_equipos']);
    $d = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = intval($d['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);
    exigirPasswordSesion($d, 'Debes confirmar tu contraseña para eliminar la OLT.');
    $mot = _equipoBloqueoEliminar($pdo, 'olts', $id);
    if ($mot) responder(['error' => 'No se puede eliminar esta OLT. ' . $mot, 'bloqueado' => true], 400);
    $pdo->prepare("DELETE FROM olts WHERE id=?")->execute([$id]);
    auditar($pdo, 'eliminar', 'olts', "OLT eliminada: #{$id}", '');
    responder(['ok' => true]);
}

/* ══ MIKROTIKS ══════════════════════════════════════ */

// Listar Mikrotiks
/* Agrupado por tipo para "Productos en stock" */
if ($method === 'POST' && $action === 'devolver_equipo') {
    sesionRequerida();
    $d    = json_decode(file_get_contents('php://input'), true);
    $tipo = trim($d['tipo'] ?? 'mikrotik');
    $id   = intval($d['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);

    $tabla = $tipo === 'olt' ? 'olts' : 'mikrotiks';
    $eq = $pdo->prepare("SELECT * FROM $tabla WHERE id=?");
    $eq->execute([$id]);
    $e = $eq->fetch();
    if (!$e) responder(['error' => 'Equipo no encontrado'], 404);

    // Solo puede devolver quien está en la misma sede
    if (strtolower(trim($e['sede']??'')) !== strtolower(trim($_SESSION['sede']??''))) {
        responder(['error' => 'Este equipo no pertenece a tu sede'], 403);
    }

    $nombre = ($e['marca']??'') . ' ' . ($e['modelo']??'');
    // Igual que la devolución de ONT: sale directo "en camino" al almacén (quien devuelve lo lleva);
    // en Seguimiento solo falta que el almacén confirme que lo recibió. No hay nada que despachar.
    $pdo->prepare("INSERT INTO envios_seguimiento
        (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, transportador, estado, notas, fecha_aprobado, fecha_envio)
        VALUES (?, ?, ?, ?, 1, 'unidad', ?, 'Almacen Central', ?, ?, 'en_camino', ?, NOW(), NOW())")
        ->execute([$tipo, $id, strtoupper($tipo), trim($nombre), $_SESSION['sede'], $_SESSION['usuario'], $_SESSION['usuario'],
                   "Devolución desde {$_SESSION['sede']}: $nombre"]);

    auditar($pdo, 'devolver', $tabla, "Devolución iniciada: $nombre desde {$_SESSION['sede']}", '');
    responder(['ok' => true]);
}

if ($method === 'GET' && $action === 'listar_equipos_por_tipo') {
    // Primero obtener todos los tipos configurados
    $tiposStmt = $pdo->query("SELECT nombre, icono FROM tipos_equipo ORDER BY nombre ASC");
    $tiposList = $tiposStmt->fetchAll();

    // Luego contar los disponibles
    $stmt = $pdo->prepare("
        SELECT tipo_equipo, marca, proveedor, modelo,
               COUNT(*) as cantidad
        FROM mikrotiks
        WHERE estado IN ('activo','recuperado')
        GROUP BY tipo_equipo, marca, proveedor, modelo
        ORDER BY tipo_equipo, marca, modelo
    ");
    $stmt->execute();
    $rows = $stmt->fetchAll();

    // Agrupar equipos por tipo
    $equiposPorTipo = [];
    foreach($rows as $r){
        $t = $r['tipo_equipo'] ?: 'Equipo';
        if(!isset($equiposPorTipo[$t])) $equiposPorTipo[$t] = ['total'=>0,'detalle'=>[]];
        $equiposPorTipo[$t]['total'] += (int)$r['cantidad'];
        $equiposPorTipo[$t]['detalle'][] = [
            'marca'    => $r['marca'] ?: $r['proveedor'] ?: '—',
            'modelo'   => $r['modelo'],
            'cantidad' => (int)$r['cantidad'],
        ];
    }

    // Construir resultado con TODOS los tipos, incluso los vacíos
    $resultado = [];
    foreach($tiposList as $t){
        $nombre = $t['nombre'];
        $resultado[] = [
            'tipo'    => $nombre,
            'icono'   => $t['icono'],
            'total'   => $equiposPorTipo[$nombre]['total'] ?? 0,
            'detalle' => $equiposPorTipo[$nombre]['detalle'] ?? [],
        ];
    }
    responder($resultado);
}

/* ══ Cuánto hay REALMENTE disponible en el almacén central para pedir ══
   A diferencia de "listar_equipos_por_tipo" (que cuenta TODO el sistema,
   sin importar la sede), esto solo cuenta lo que está sin asignar en el
   almacén — que es lo que de verdad se le puede despachar a quien pida.
   Cualquier rol puede consultarlo (solo son números, sin detalle), para
   que "Solicitar equipo" pueda avisar/bloquear ANTES de mandar la
   solicitud, en vez de dejarla pendiente para siempre sin que nadie la
   pueda cumplir. */
if ($method === 'GET' && $action === 'disponibilidad_equipos_central') {
    $centrales = $pdo->query("SELECT nombre FROM sedes WHERE tipo IN ('central','distribuidor')")->fetchAll(PDO::FETCH_COLUMN);
    $centrales = array_values(array_unique(array_merge($centrales, ['Almacen Central'])));
    $ph = implode(',', array_fill(0, count($centrales), '?'));

    $olt = $pdo->prepare("SELECT COUNT(*) FROM olts WHERE estado = 'activo' AND sede IN ($ph)");
    $olt->execute($centrales);
    $totalOlt = (int)$olt->fetchColumn();

    $stmtT = $pdo->prepare("SELECT tipo_equipo, COUNT(*) AS cantidad FROM mikrotiks WHERE estado = 'activo' AND sede IN ($ph) GROUP BY tipo_equipo");
    $stmtT->execute($centrales);
    $porTipo = [];
    foreach ($stmtT->fetchAll() as $r) { $porTipo[$r['tipo_equipo']] = (int)$r['cantidad']; }

    responder(['OLT' => $totalOlt, 'tipos' => $porTipo]);
}

if ($method === 'GET' && $action === 'listar_mikrotiks') {
    $where = []; $params = [];
    $rol = $_SESSION['rol'] ?? '';
    if ($rol !== 'superadmin' && $rol !== 'distribuidor') {
        $where[] = "sede = ?"; $params[] = $_SESSION['sede'] ?? '';
        // Igual que en listar_olts: si quedó asignado a una persona
        // puntual, solo ella lo ve aunque otros compartan su misma sede.
        $where[] = "(asignado_a IS NULL OR asignado_a = '' OR asignado_a = ?)"; $params[] = $_SESSION['usuario'] ?? '';
    } elseif (!empty($_GET['sede'])) {
        $where[] = "sede = ?"; $params[] = $_GET['sede'];
    }
    if (!empty($_GET['estado'])) { $where[] = "estado = ?"; $params[] = $_GET['estado']; }
    if (!empty($_GET['q']))      { $where[] = "(proveedor LIKE ? OR modelo LIKE ? OR sn LIKE ? OR mac LIKE ?)";
        $q = '%'.$_GET['q'].'%'; $params = array_merge($params, [$q,$q,$q,$q]); }
    $sql = "SELECT mikrotiks.*,
                   (SELECT COUNT(*) FROM envios_seguimiento es
                     WHERE es.tipo='mikrotik' AND es.referencia_id=mikrotiks.id
                       AND es.estado IN ('aprobado','en_camino','entregado')) AS en_envio,
                   (SELECT TRIM(CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,''))) FROM usuarios u WHERE u.usuario = mikrotiks.asignado_a LIMIT 1) AS asignado_nombre
            FROM mikrotiks" . ($where ? " WHERE ".implode(" AND ",$where) : "") . " ORDER BY fecha DESC";
    $stmt = $pdo->prepare($sql); $stmt->execute($params);
    responder($stmt->fetchAll());
}

// Crear Mikrotik
if ($method === 'POST' && $action === 'crear_mikrotik') {
    rolOPermiso(['superadmin'], 'gestionar_equipos');
    $d = json_decode(file_get_contents('php://input'), true) ?? [];
    $marca      = trim($d['marca']      ?? '');
    $proveedor  = trim($d['proveedor']  ?? $marca); // fallback por compatibilidad
    $modelo     = trim($d['modelo']      ?? '');
    $sn         = strtoupper(trim($d['sn'] ?? ''));
    $mac        = strtoupper(preg_replace('/[^A-Fa-f0-9]/','',$d['mac'] ?? ''));
    $mac_fmt    = $mac ? implode(':', str_split($mac, 2)) : '';
    $sede       = trim($d['sede']  ?? '') ?: 'Almacen Central';
    $notas      = trim($d['notas'] ?? '');
    $tipoEquipo = trim($d['tipo_equipo'] ?? 'Mikrotik');
    $estadosOk  = ['activo','disponible','dañado','comodato','recuperado','de_baja','instalado','inactivo'];
    $estado     = in_array($d['estado']??'', $estadosOk) ? $d['estado'] : 'activo';
    if (!$modelo) responder(['error' => 'Modelo es requerido'], 400);
    if ($sn) {
        $dup = $pdo->prepare("SELECT id FROM mikrotiks WHERE sn = ?");
        $dup->execute([$sn]);
        if ($dup->fetch()) responder(['error' => "El SN $sn ya está registrado"], 400);
    }
    $pdo->prepare("INSERT INTO mikrotiks (marca, proveedor, modelo, sn, mac, mac_fmt, sede, notas, registrado_por, fecha, tipo_equipo, estado)
        VALUES (?,?,?,?,?,?,?,?,?,NOW(),?,?)")
        ->execute([$marca, $proveedor, $modelo, $sn, $mac, $mac_fmt, $sede, $notas, $_SESSION['usuario'], $tipoEquipo, $estado]);
    $id = $pdo->lastInsertId();
    auditar($pdo, 'crear', 'mikrotiks', "Equipo ($tipoEquipo) creado: $marca $modelo SN:$sn — $sede", '');
    try {
        $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,proveedor,fecha)
            VALUES ('MIKROTIK',?,?,1,'unidad',?,?,'aprobado',0,'ingreso',?,NOW())")
            ->execute(["$tipoEquipo $marca $modelo", $sede, $_SESSION['usuario'],
                "Registro de equipo ($tipoEquipo): $marca $modelo" . ($sn !== '' ? " · SN: $sn" : '') . ($notas !== '' ? " · Notas: $notas" : ''), $proveedor ?: null]);
    } catch (\Throwable $e) { error_log('[hist equipo] '.$e->getMessage()); }
    responder(['ok' => true, 'id' => $id]);
}

// Editar Mikrotik
if ($method === 'POST' && $action === 'editar_mikrotik') {
    rolOPermiso(['superadmin'], 'gestionar_equipos');
    $d  = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = intval($d['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);
    $mac     = strtoupper(preg_replace('/[^A-Fa-f0-9]/','',$d['mac'] ?? ''));
    $mac_fmt = $mac ? implode(':', str_split($mac, 2)) : '';
    // Ver nota equivalente en editar_olt: se limpia asignado_a para que
    // no quede invisible para el resto de su oficina por accidente.
    $pdo->prepare("UPDATE mikrotiks SET proveedor=?, modelo=?, sn=?, mac=?, mac_fmt=?, sede=?, estado=?, notas=?, asignado_a=NULL WHERE id=?")
        ->execute([$d['proveedor'], $d['modelo'], strtoupper($d['sn']??''), $mac, $mac_fmt, $d['sede'], $d['estado']??'activo', $d['notas']??'', $id]);
    auditar($pdo, 'editar', 'mikrotiks', "Mikrotik editado: #{$id}", '');
    responder(['ok' => true]);
}

// Eliminar Mikrotik
if ($method === 'POST' && $action === 'eliminar_mikrotik') {
    rolOPermiso(['superadmin'], 'gestionar_equipos');
    $d  = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = intval($d['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);
    exigirPasswordSesion($d, 'Debes confirmar tu contraseña para eliminar el equipo.');
    $mot = _equipoBloqueoEliminar($pdo, 'mikrotiks', $id);
    if ($mot) responder(['error' => 'No se puede eliminar este equipo. ' . $mot, 'bloqueado' => true], 400);
    $pdo->prepare("DELETE FROM mikrotiks WHERE id=?")->execute([$id]);
    auditar($pdo, 'eliminar', 'mikrotiks', "Mikrotik eliminado: #{$id}", '');
    responder(['ok' => true]);
}

/* ══ UNIDADES DISPONIBLES DE UN TIPO (para elegir al despachar
   una solicitud de "Pedir equipos") ══════════════════════════ */
if ($method === 'GET' && $action === 'disponibles_por_tipo') {
    $tipo = trim($_GET['tipo'] ?? '');
    $sede = trim($_GET['sede'] ?? '');
    if (!$tipo) responder(['error' => 'Tipo requerido'], 400);
    $tabla = (strtoupper($tipo) === 'OLT') ? 'olts' : 'mikrotiks';

    $where = []; $params = [];
    if ($tabla === 'mikrotiks') { $where[] = "tipo_equipo = ?"; $params[] = $tipo; }
    if ($sede !== '')            { $where[] = "sede = ?";       $params[] = $sede; }
    $where[] = "estado IN ('activo','disponible','recuperado')";
    $sql = "SELECT * FROM $tabla" . ($where ? " WHERE ".implode(" AND ", $where) : "") . " ORDER BY fecha DESC";
    $stmt = $pdo->prepare($sql); $stmt->execute($params);
    $rows = $stmt->fetchAll();

    // Excluir unidades ya reservadas en otro envío activo — ya sea un envío
    // directo (tipo='olt'/'mikrotik' con referencia_id = el equipo) o una
    // solicitud de "Pedir equipos" que ya eligió esa unidad ("EquipoIDs:"
    // en las notas de otro envío en curso).
    $tipoCol = $tabla === 'olts' ? 'olt' : 'mikrotik';
    $reservados = [];
    $stD = $pdo->prepare("SELECT referencia_id FROM envios_seguimiento WHERE tipo = ? AND estado IN ('aprobado','en_camino','entregado')");
    $stD->execute([$tipoCol]);
    foreach ($stD->fetchAll(PDO::FETCH_COLUMN) as $rid) $reservados[(int)$rid] = true;
    $stN = $pdo->query("SELECT notas FROM envios_seguimiento WHERE estado IN ('aprobado','en_camino','entregado') AND notas LIKE '%EquipoIDs:%'");
    foreach ($stN->fetchAll(PDO::FETCH_COLUMN) as $notasChk) {
        if (preg_match('/EquipoIDs:\s*([a-z]+):([0-9,]+)/', $notasChk, $m) && $m[1] === $tabla) {
            foreach (explode(',', $m[2]) as $rid) $reservados[(int)$rid] = true;
        }
    }
    $rows = array_values(array_filter($rows, fn($r) => empty($reservados[(int)$r['id']])));
    responder($rows);
}

/* ══ ENVIAR EQUIPO A SEDE (vía seguimiento) ══════════ */

// Enviar OLT — crea registro de seguimiento (en camino → entregado → recibido)
if ($method === 'POST' && $action === 'enviar_olt') {
    rolOPermisoAlt(['superadmin'], ['gestionar_olt', 'gestionar_equipos']);
    $d       = json_decode(file_get_contents('php://input'), true) ?? [];
    $id      = intval($d['id'] ?? 0);
    $destino = trim($d['destino'] ?? '');
    if (!$id || !$destino) responder(['error' => 'Equipo y destino requeridos'], 400);

    try {
        $o = $pdo->prepare("SELECT * FROM olts WHERE id=?");
        $o->execute([$id]);
        $olt = $o->fetch();
        if (!$olt) responder(['error' => 'OLT no encontrada'], 404);
        if (in_array($olt['estado'] ?? '', ['dañado','de_baja'], true)) responder(['error' => 'Un equipo dañado o de baja no se puede enviar'], 400);
        $rolEnv = $_SESSION['rol'] ?? '';
        if ($rolEnv !== 'superadmin' && $rolEnv !== 'distribuidor' && !empty($olt['sede']) && $olt['sede'] !== ($_SESSION['sede'] ?? '')) responder(['error' => 'No puedes enviar equipos de otra sede'], 403);

        // ¿Ya tiene un envío activo? (no usamos la columna estado del equipo)
        $chk = $pdo->prepare("SELECT id FROM envios_seguimiento WHERE tipo='olt' AND referencia_id=? AND estado IN ('aprobado','en_camino','entregado') LIMIT 1");
        $chk->execute([$id]);
        if ($chk->fetch()) responder(['error' => 'Esta OLT ya tiene un envío en curso'], 400);

        $origen = (!empty($olt['sede'])) ? $olt['sede'] : 'Almacen Central';
        $nombre = trim(($olt['marca'] ?? '') . ' ' . ($olt['modelo'] ?? ''));

        $pdo->prepare("
            INSERT INTO envios_seguimiento
              (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, estado, notas, fecha_aprobado)
            VALUES ('olt', ?, 'OLT', ?, 1, 'unidad', ?, ?, ?, 'aprobado', ?, NOW())
        ")->execute([$id, $nombre, $origen, $destino, $_SESSION['usuario'], "OLT enviada a $destino: $nombre"]);

        try {
            $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,fecha)
                VALUES ('OLT',?,?,1,'unidad',?,?,'aprobado',0,'directo',NOW())")
                ->execute([$nombre, $destino, $_SESSION['usuario'], "OLT enviada a $destino: $nombre"]);
        } catch (\Throwable $e) { error_log('[enviar_olt/historial] '.$e->getMessage()); }

        try { auditar($pdo, 'enviar', 'olts', "OLT #$id enviada a $destino", ''); }
        catch (\Throwable $e) { error_log('[enviar_olt/auditar] '.$e->getMessage()); }

        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[enviar_olt] '.$e->getMessage());
        responder(['error' => 'No se pudo enviar la OLT: '.$e->getMessage()], 500);
    }
}

// Enviar Mikrotik — crea registro de seguimiento
if ($method === 'POST' && $action === 'enviar_mikrotik') {
    rolOPermiso(['superadmin'], 'gestionar_equipos');
    $d       = json_decode(file_get_contents('php://input'), true) ?? [];
    $id      = intval($d['id'] ?? 0);
    $destino = trim($d['destino'] ?? '');
    if (!$id || !$destino) responder(['error' => 'Equipo y destino requeridos'], 400);

    try {
        $m = $pdo->prepare("SELECT * FROM mikrotiks WHERE id=?");
        $m->execute([$id]);
        $mk = $m->fetch();
        if (!$mk) responder(['error' => 'Mikrotik no encontrado'], 404);
        if (in_array($mk['estado'] ?? '', ['dañado','de_baja'], true)) responder(['error' => 'Un equipo dañado o de baja no se puede enviar'], 400);
        $rolEnv = $_SESSION['rol'] ?? '';
        if ($rolEnv !== 'superadmin' && $rolEnv !== 'distribuidor' && !empty($mk['sede']) && $mk['sede'] !== ($_SESSION['sede'] ?? '')) responder(['error' => 'No puedes enviar equipos de otra sede'], 403);

        $chk = $pdo->prepare("SELECT id FROM envios_seguimiento WHERE tipo='mikrotik' AND referencia_id=? AND estado IN ('aprobado','en_camino','entregado') LIMIT 1");
        $chk->execute([$id]);
        if ($chk->fetch()) responder(['error' => 'Este Mikrotik ya tiene un envío en curso'], 400);

        $origen = (!empty($mk['sede'])) ? $mk['sede'] : 'Almacen Central';
        $nombre = trim(($mk['proveedor'] ?? '') . ' ' . ($mk['modelo'] ?? '')) . (!empty($mk['sn']) ? " · SN {$mk['sn']}" : '');

        $pdo->prepare("
            INSERT INTO envios_seguimiento
              (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, estado, notas, fecha_aprobado)
            VALUES ('mikrotik', ?, 'MIKROTIK', ?, 1, 'unidad', ?, ?, ?, 'aprobado', ?, NOW())
        ")->execute([$id, $nombre, $origen, $destino, $_SESSION['usuario'], "Mikrotik enviado a $destino: $nombre"]);

        try {
            $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,fecha)
                VALUES ('MIKROTIK',?,?,1,'unidad',?,?,'aprobado',0,'directo',NOW())")
                ->execute([$nombre, $destino, $_SESSION['usuario'], "Mikrotik enviado a $destino: $nombre"]);
        } catch (\Throwable $e) { error_log('[enviar_mikrotik/historial] '.$e->getMessage()); }

        try { auditar($pdo, 'enviar', 'mikrotiks', "Mikrotik #$id enviado a $destino", ''); }
        catch (\Throwable $e) { error_log('[enviar_mikrotik/auditar] '.$e->getMessage()); }

        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[enviar_mikrotik] '.$e->getMessage());
        responder(['error' => 'No se pudo enviar el Mikrotik: '.$e->getMessage()], 500);
    }
}

/* ══ CLIENTES/PROYECTOS YA REGISTRADOS (para autocompletar al marcar
   instalado/comodato) — junta el cliente_nombre ya usado en OLTs y
   Mikrotiks CON el proyecto_cliente de historial (el mismo "Cliente /
   Proyecto" que ya se usa en gastos de productos, fibra y pedidos — por
   eso esa lista ya tenía nombres y esta estaba vacía: antes solo miraba
   olts/mikrotiks, nunca ese catálogo más grande), sin repetidos, para que
   el usuario pueda elegir uno existente en vez de escribirlo de cero cada
   vez, y si no está, simplemente escribe uno nuevo (el campo sigue siendo
   de texto libre). ══ */
if ($method === 'GET' && $action === 'clientes_existentes') {
    try {
        $nombres = $pdo->query("
            SELECT cliente_nombre FROM olts WHERE cliente_nombre IS NOT NULL AND cliente_nombre <> ''
            UNION
            SELECT cliente_nombre FROM mikrotiks WHERE cliente_nombre IS NOT NULL AND cliente_nombre <> ''
            UNION
            SELECT proyecto_cliente FROM historial WHERE proyecto_cliente IS NOT NULL AND proyecto_cliente <> ''
            ORDER BY cliente_nombre ASC
        ")->fetchAll(PDO::FETCH_COLUMN);
        responder(array_values($nombres));
    } catch (\Throwable $e) {
        responder([]);
    }
}

/* ══ Aplica de verdad el cambio de estado sobre el OLT/Mikrotik — la
   misma lógica que antes vivía directamente dentro de cambiar_estado_equipo,
   movida a función aparte para poder reutilizarla también cuando una
   confirmación pendiente se acepta (ver responder_confirmacion_equipo). ══ */
function _aplicarEstadoEquipoDirecto($pdo, string $tabla, string $tipo, int $id, array $row, string $estado, string $nota, string $clienteNombre, string $clienteDireccion, ?float $lat, ?float $lng, ?string $loteIdEquipo, string $actorUsuario): ?string {
    require_once __DIR__ . '/retiro_proyecto_lib.php';
    // ¿Es solo actualizar datos (p. ej. la ubicación) de un equipo que YA estaba en ese mismo cliente?
    // En ese caso se corrige el movimiento existente en vez de crear otro (salía duplicado).
    $esActualizacion = in_array($row['estado'] ?? '', ['comodato','instalado'], true)
        && in_array($estado, ['comodato','instalado'], true)
        && mb_strtolower(trim($clienteNombre)) === mb_strtolower(trim((string)($row['cliente_nombre'] ?? '')));
    // Si el equipo estaba en un cliente y ahora sale de ahí → queda "retirado" en la vista de ese cliente.
    if (in_array($row['estado'] ?? '', ['comodato','instalado'], true) && !in_array($estado, ['comodato','instalado'], true) && !empty($row['cliente_nombre'])) {
        $nomEq = trim(($row['marca'] ?? '') . ' ' . ($row['modelo'] ?? ''));
        if ($tipo === 'olt') {
            marcarRetiradoEnProyecto($pdo, 'OLT', $nomEq, null, $row['cliente_nombre'], $actorUsuario, 'Retirado del cliente (estado: ' . $estado . ')');
        } else {
            marcarRetiradoEnProyecto($pdo, 'MIKROTIK', $nomEq, $row['sn'] ?? null, $row['cliente_nombre'], $actorUsuario, 'Retirado del cliente (estado: ' . $estado . ')');
        }
    }
    // Anexar la nota al campo notas con marca de tiempo, sin perder lo anterior.
    // "comodato" se guarda igual que "instalado" (mismo Cliente/Proyecto,
    // mismas columnas) — es la misma idea: el equipo salió a un cliente.
    if (in_array($estado, ['instalado','comodato'])) {
        $etiquetaEst = $estado === 'comodato' ? 'En comodato en' : 'Instalado en';
        $sello = '['.date('d/m/Y H:i').' · '.$estado.' · '.$actorUsuario.'] '.$etiquetaEst.' "'.$clienteNombre.'"'.($clienteDireccion?" — $clienteDireccion":'').($nota?" — $nota":'');
        $pdo->prepare("UPDATE $tabla SET estado=?, cliente_nombre=?, cliente_direccion=?, gps_lat=?, gps_lng=?, notas=TRIM(CONCAT(COALESCE(notas,''), '\n', ?)) WHERE id=?")
            ->execute([$estado, $clienteNombre, $clienteDireccion ?: null, $lat, $lng, $sello, $id]);
    } elseif ($nota !== '') {
        $sello = '['.date('d/m/Y H:i').' · '.$estado.' · '.$actorUsuario.'] '.$nota;
        $pdo->prepare("UPDATE $tabla SET estado=?, notas=TRIM(CONCAT(COALESCE(notas,''), '\n', ?)) WHERE id=?")
            ->execute([$estado, $sello, $id]);
    } else {
        $pdo->prepare("UPDATE $tabla SET estado=? WHERE id=?")->execute([$estado, $id]);
    }
    // Recogido de un cliente: ya no está en ese cliente (el rastro queda en notas e historial).
    if ($estado === 'recuperado') {
        try { $pdo->prepare("UPDATE $tabla SET cliente_nombre=NULL, cliente_direccion=NULL WHERE id=?")->execute([$id]); }
        catch (\Throwable $e) { error_log('[cambiar_estado_equipo/limpiar cliente] '.$e->getMessage()); }
    }
    try { auditar($pdo, 'cambiar_estado', $tabla, "Equipo #$id → $estado".($nota?" ($nota)":''), ''); }
    catch (\Throwable $e) { error_log('[cambiar_estado_equipo/auditar] '.$e->getMessage()); }

    $historialIdEquipo = null;
    if (in_array($estado, ['instalado','comodato']) && $clienteNombre !== '') {
        // Si el Cliente/Proyecto es nuevo, se crea en el catálogo (pantalla "Cliente / Proyecto");
        // si estaba archivado, se reactiva. Sin esto el movimiento quedaba suelto y el cliente no salía.
        try {
            $ex = $pdo->prepare("SELECT id, activo FROM proyectos WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?)) LIMIT 1");
            $ex->execute([$clienteNombre]);
            $pr = $ex->fetch();
            if (!$pr) {
                $pdo->prepare("INSERT INTO proyectos (nombre, descripcion, creado_por, fecha, activo) VALUES (?, ?, ?, NOW(), 1)")
                    ->execute([$clienteNombre, 'Creado desde ' . ($estado === 'comodato' ? 'un comodato' : 'una instalación') . ' de equipo', $actorUsuario]);
            } elseif ((int)$pr['activo'] === 0) {
                $pdo->prepare("UPDATE proyectos SET activo = 1 WHERE id = ?")->execute([$pr['id']]);
            }
        } catch (\Throwable $e) { error_log('[cambiar_estado_equipo proyecto] '.$e->getMessage()); }
    }
    if (in_array($estado, ['instalado','comodato'])) {
        // También queda en el Historial general (como gasto), para que
        // se vea en "Cliente/Proyecto" junto con todo lo demás.
        try {
            $refEquipo = strtoupper($tipo); // 'OLT' | 'MIKROTIK'
            $etiquetaHist = $estado === 'comodato' ? 'En comodato en' : 'Instalado en';
            $descEquipo = trim(($row['marca']??'').' '.($row['modelo']??'')) . (!empty($row['sn']) ? ' — SN '.$row['sn'] : '')
                . " · $etiquetaHist \"$clienteNombre\"" . ($clienteDireccion ? " — $clienteDireccion" : '');
            if ($esActualizacion) {
                $qh = "SELECT id FROM historial WHERE ref = ? AND es_gasto = 1 AND origen = 'instalacion'
                         AND LOWER(TRIM(proyecto_cliente)) = LOWER(TRIM(?)) AND (retirado IS NULL OR retirado = 0)
                         AND (anulado IS NULL OR anulado = 0) AND nombre = ?";
                $ph = [$refEquipo, $clienteNombre, trim(($row['marca']??'').' '.($row['modelo']??'')) ?: $refEquipo];
                if (!empty($row['sn'])) { $qh .= " AND descripcion LIKE ?"; $ph[] = '%SN ' . $row['sn'] . '%'; }
                $qh .= " ORDER BY id DESC LIMIT 1";
                $stH = $pdo->prepare($qh); $stH->execute($ph);
                $hid = $stH->fetchColumn();
                if ($hid) {
                    $pdo->prepare("UPDATE historial SET descripcion = ?, gps_lat = COALESCE(?, gps_lat), gps_lng = COALESCE(?, gps_lng) WHERE id = ?")
                        ->execute([$descEquipo, $lat, $lng, $hid]);
                    return (string)$hid;
                }
            }
            $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,fecha,gps_lat,gps_lng,usuario_destino,pedido_agrupado_id,proyecto_cliente)
                VALUES (?,?,?,1,'unidad',?,?,'aprobado',1,'instalacion',NOW(),?,?,?,?,?)")
                ->execute([$refEquipo, trim(($row['marca']??'').' '.($row['modelo']??'')) ?: $refEquipo, $clienteNombre, $actorUsuario, $descEquipo, $lat, $lng, $actorUsuario, $loteIdEquipo, $clienteNombre]);
            $historialIdEquipo = $pdo->lastInsertId();
        } catch (\Throwable $e) { error_log('[cambiar_estado_equipo historial] '.$e->getMessage()); }
    }
    return $historialIdEquipo;
}

// Estados que, al cambiar, deben quedar en espera de que la persona que
// "lo hizo de verdad" lo confirme — así cualquiera con acceso a Mis Equipos
// puede registrar el cambio (sin necesitar el permiso "Gestionar OLT/Equipos"),
// pero no queda aplicado hasta que esa persona diga que sí es cierto.
const ESTADOS_EQUIPO_CON_CONFIRMACION = ['dañado','recuperado','de_baja','comodato','instalado'];

// Quién puede ser la persona que confirma cada estado — para que, por
// ejemplo, no se pueda nombrar a un municipio como "quien instaló" (eso le
// corresponde a un técnico o persona de campo), y "de baja" solo lo pueda
// confirmar un administrador.
const ROLES_RESPONSABLE_POR_ESTADO = [
    'instalado'  => ['tecnico','persona'],
    'comodato'   => ['tecnico','persona'],
    'recuperado' => ['tecnico','persona'],
    'dañado'     => ['tecnico','persona'],
    'de_baja'    => ['superadmin'],
];

/* ══ CAMBIAR ESTADO DE EQUIPO (OLT / Mikrotik) ══════ */
if ($method === 'POST' && $action === 'cambiar_estado_equipo') {
    $d      = json_decode(file_get_contents('php://input'), true) ?? [];
    $tipo   = trim($d['tipo']   ?? '');   // 'olt' | 'mikrotik'
    $id     = intval($d['id']   ?? 0);
    $estado = trim($d['estado'] ?? '');
    $nota   = trim($d['nota']   ?? '');
    // Si se marca "instalado", queda vinculado a un Cliente/Proyecto —
    // igual que una ONT — para que se pueda ver esa evidencia después.
    $clienteNombre = trim($d['cliente_nombre'] ?? '');
    $clienteDireccion = trim($d['cliente_direccion'] ?? '');
    $lat = isset($d['lat']) && $d['lat'] !== '' ? floatval($d['lat']) : null;
    $lng = isset($d['lng']) && $d['lng'] !== '' ? floatval($d['lng']) : null;
    $loteIdEquipo = trim($d['lote_id'] ?? '') ?: null;

    // "comodato" faltaba en esta lista — la columna estado en la base de
    // datos SÍ lo permite (es parte del enum), pero esta validación lo
    // rechazaba antes de siquiera intentar guardarlo, así que marcar un
    // OLT/equipo como comodato nunca funcionaba.
    $estadosOk = ['activo','inactivo','dañado','instalado','de_baja','recuperado','comodato'];
    if (!in_array($tipo, ['olt','mikrotik'])) responder(['error' => 'Tipo inválido'], 400);
    if (!$id)                                 responder(['error' => 'ID requerido'], 400);
    if (!in_array($estado, $estadosOk))       responder(['error' => 'Estado no permitido'], 400);
    // Comodato también queda vinculado a un Cliente/Proyecto, igual que
    // "instalado" — es equipo que salió a un cliente, así que debe quedar
    // registrado a nombre de quién/dónde, no solo como "comodato" a secas.
    if (in_array($estado, ['instalado','comodato']) && !$clienteNombre) {
        responder(['error' => 'Escribe el Cliente/Proyecto — es obligatorio para marcarlo como ' . ($estado==='comodato'?'comodato':'instalado')], 400);
    }

    if (in_array($estado, ['instalado','comodato','recuperado']) && !$clienteDireccion) {
        responder(['error' => 'La ubicación / dirección es obligatoria para marcarlo como ' . ($estado==='comodato'?'comodato':($estado==='instalado'?'instalado':'recuperado'))], 400);
    }

    $tabla = $tipo === 'olt' ? 'olts' : 'mikrotiks';
    $rol = $_SESSION['rol'] ?? '';
    $cur = $pdo->prepare("SELECT * FROM $tabla WHERE id=?");
    $cur->execute([$id]);
    $row = $cur->fetch();
    if (!$row) responder(['error' => 'Equipo no encontrado'], 404);
    // Sede: admin/distribuidor siempre; municipio/técnico solo equipos de su sede.
    // Esto aplica siempre, tenga o no el permiso de gestión — nadie debe
    // tocar equipos de una oficina que no es la suya.
    if ($rol !== 'superadmin' && $rol !== 'distribuidor') {
        if (($row['sede'] ?? '') !== ($_SESSION['sede'] ?? '')) {
            responder(['error' => 'No puedes modificar equipos de otra sede'], 403);
        }
    }

    // Un equipo que ya está en comodato/instalado en un cliente NO pasa directo a otro
    // cliente ni a "disponible": primero hay que recogerlo ("Recogido — disponible").
    // Sí se puede volver a guardar con el MISMO cliente (para corregir datos).
    if (in_array($row['estado'] ?? '', ['comodato','instalado'], true) && in_array($estado, ['activo','comodato','instalado'], true)) {
        $mismoCliente = in_array($estado, ['comodato','instalado'], true)
            && mb_strtolower(trim($clienteNombre)) === mb_strtolower(trim((string)($row['cliente_nombre'] ?? '')));
        if (!$mismoCliente) {
            $en = !empty($row['cliente_nombre']) ? ' en "' . $row['cliente_nombre'] . '"' : '';
            responder(['error' => 'Este equipo está en ' . ($row['estado'] === 'comodato' ? 'comodato' : 'instalado') . $en . '. Primero márcalo como "Recogido — disponible" (retirado del cliente) y después podrás instalarlo en otro lado.'], 400);
        }
    }

    // Admin/distribuidor pueden aplicar el estado DIRECTO (sin que nadie lo confirme):
    // sirve para ir alimentando el sistema con equipos que ya están en comodato,
    // instalados, etc. Queda en auditoría con el nombre de quien lo hizo.
    $aplicarDirecto = !empty($d['directo']) && in_array($rol, ['superadmin','distribuidor'], true);
    // Técnico/persona que TIENE el equipo en su poder: él mismo es quien lo
    // instala/retira/reporta, así que no hace falta que se nombre ni se
    // confirme a sí mismo. ("de baja" sigue necesitando a un administrador.)
    $respPedido = trim($d['responsable_usuario'] ?? '');
    if (!$aplicarDirecto && in_array($rol, ['tecnico','persona'], true) && $estado !== 'de_baja'
        && in_array((string)($row['asignado_a'] ?? ''), ['', ($_SESSION['usuario'] ?? '')], true)
        && ($respPedido === '' || $respPedido === ($_SESSION['usuario'] ?? ''))) {
        $aplicarDirecto = true;
        if (in_array($estado, ['instalado','comodato','recuperado','dañado'], true)) {
            $nota = trim($nota . ' | Registrado por: ' . ($_SESSION['usuario'] ?? ''), ' |');
        }
    }
    if (!$aplicarDirecto && in_array($estado, ESTADOS_EQUIPO_CON_CONFIRMACION)) {
        // Estos 5 estados no se aplican de una — cualquiera con acceso a
        // Mis Equipos puede registrarlos (no hace falta el permiso especial),
        // pero quedan pendientes de que la persona nombrada confirme que sí
        // es cierto. Así el control real ya no depende de quién tiene el
        // permiso en el sistema, sino de que la persona que estuvo ahí lo
        // confirme — esto reemplaza el bloqueo de "Sin permisos" que veía
        // antes un municipio al intentar marcar, por ejemplo, un comodato.
        $responsableUsuario = trim($d['responsable_usuario'] ?? '');
        if (!$responsableUsuario) {
            responder(['error' => 'Elige quién debe confirmar este cambio'], 400);
        }
        $uConf = $pdo->prepare("SELECT usuario, rol, sede FROM usuarios WHERE usuario = ? AND estado = 'activo'");
        $uConf->execute([$responsableUsuario]);
        $uConfRow = $uConf->fetch();
        if (!$uConfRow) responder(['error' => 'Ese usuario no existe o no está activo'], 404);
        $rolesOk = ROLES_RESPONSABLE_POR_ESTADO[$estado] ?? [];
        if ($rolesOk && !in_array($uConfRow['rol'], $rolesOk)) {
            $mensajeRol = $estado === 'de_baja' ? 'un administrador' : 'un técnico o una persona de campo';
            responder(['error' => "Para \"$estado\" debes elegir a $mensajeRol — no un admin, distribuidor o municipio"], 400);
        }

        try {
            $pdo->prepare("
                INSERT INTO equipo_confirmaciones
                  (tipo, equipo_id, estado_propuesto, nota, cliente_nombre, cliente_direccion, lat, lng, lote_id, propuesto_por, usuario_confirma, resultado, creado_en)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', NOW())
            ")->execute([
                $tipo, $id, $estado, $nota, $clienteNombre ?: null, $clienteDireccion ?: null, $lat, $lng, $loteIdEquipo,
                $_SESSION['usuario'] ?? '', $responsableUsuario,
            ]);
            $confNuevaId = (int)$pdo->lastInsertId();
            // Aviso a quien debe confirmar: campana + correo (si tiene correo registrado)
            try {
                $etq = ['instalado'=>'Instalado','comodato'=>'En comodato','recuperado'=>'Recuperado','dañado'=>'Dañado','de_baja'=>'De baja'][$estado] ?? $estado;
                $nomEq = trim((string)($row['nombre'] ?? '') ?: trim((string)($row['marca'] ?? '').' '.(string)($row['modelo'] ?? '')));
                $nomEq = ($tipo === 'olt' ? 'OLT' : 'Equipo') . ($nomEq !== '' ? " $nomEq" : " #$id");
                $qp = $pdo->prepare("SELECT TRIM(CONCAT(COALESCE(nombre,''),' ',COALESCE(apellido,''))) FROM usuarios WHERE usuario=?");
                $qp->execute([$_SESSION['usuario'] ?? '']);
                $quien = trim((string)$qp->fetchColumn()) ?: ($_SESSION['usuario'] ?? 'Alguien');
                $detalle = "$quien registró que el $nomEq quedó \"$etq\"" . ($clienteNombre ? " en $clienteNombre" : '') . ". Entra a Mis equipos y confirma si es cierto.";
                $pdo->exec("CREATE TABLE IF NOT EXISTS notif_app (
                    id INT AUTO_INCREMENT PRIMARY KEY, usuario VARCHAR(60) NOT NULL, notif_key VARCHAR(120) NOT NULL,
                    tipo VARCHAR(30) DEFAULT 'solicitud', titulo VARCHAR(200) NOT NULL, msg VARCHAR(400) DEFAULT '',
                    accion VARCHAR(60) DEFAULT '', fecha VARCHAR(40) DEFAULT '', leida TINYINT(1) DEFAULT 0,
                    creado_en DATETIME DEFAULT NOW(), UNIQUE KEY uq_usuario_key (usuario, notif_key))");
                $pdo->prepare("INSERT IGNORE INTO notif_app (usuario,notif_key,tipo,titulo,msg,accion,fecha,leida) VALUES (?,?,?,?,?,?,?,0)")
                    ->execute([$responsableUsuario, "eqconf-$confNuevaId", 'equipo', "🔔 Confirma un cambio: $nomEq → $etq", mb_substr($detalle, 0, 400), 'misequipos', date('c')]);
                $dest = _notif_correoUsuario($pdo, $responsableUsuario);
                if ($dest) _notif_enviar($dest['correo'], $dest['nombre'] ?: $responsableUsuario, "Confirma un cambio de equipo: $nomEq → $etq",
                    '<p style="margin:0 0 10px;">'.htmlspecialchars($detalle).'</p><p style="margin:0;color:#64748B;font-size:13px;">Mientras no lo confirmes, el cambio queda pendiente.</p>');
            } catch (\Throwable $e) { error_log('[cambiar_estado_equipo/aviso] '.$e->getMessage()); }
            try { auditar($pdo, 'proponer_estado_equipo', $tabla, "Equipo #$id → $estado (pendiente que $responsableUsuario confirme)", (string)$id); }
            catch (\Throwable $e) { error_log('[cambiar_estado_equipo/auditar-pendiente] '.$e->getMessage()); }
            responder(['ok' => true, 'pendiente' => true, 'confirma' => $responsableUsuario]);
        } catch (\Throwable $e) {
            error_log('[cambiar_estado_equipo/crear-pendiente] '.$e->getMessage());
            responder(['error' => 'No se pudo registrar el cambio: '.$e->getMessage()], 500);
        }
    }

    // Estados sin confirmación (activo/inactivo): siguen requiriendo el
    // permiso de gestión, y se aplican de inmediato como siempre.
    if (!$aplicarDirecto) {
        if ($tipo === 'olt') {
            rolOPermisoAlt(['superadmin'], ['gestionar_olt', 'gestionar_equipos']);
        } else {
            rolOPermiso(['superadmin'], 'gestionar_equipos');
        }
    }

    try {
        $historialIdEquipo = _aplicarEstadoEquipoDirecto($pdo, $tabla, $tipo, $id, $row, $estado, $nota, $clienteNombre, $clienteDireccion, $lat, $lng, $loteIdEquipo, $_SESSION['usuario'] ?? '');
        responder(['ok' => true, 'historial_id' => $historialIdEquipo]);
    } catch (\Throwable $e) {
        error_log('[cambiar_estado_equipo] '.$e->getMessage());
        responder(['error' => 'No se pudo cambiar el estado: '.$e->getMessage()], 500);
    }
}

/* ══ DIAGNÓSTICO TEMPORAL — muestra qué usuario/rol/sede tiene guardado
   AHORA MISMO la sesión de quien llama esto. Cualquier usuario logueado
   puede verlo (solo lo suyo), para comparar contra lo que debería ser. ══ */
if ($method === 'GET' && $action === 'diag_mi_sesion') {
    responder([
        'session_id_php' => session_id(),
        'usuario'        => $_SESSION['usuario']   ?? null,
        'rol'             => $_SESSION['rol']       ?? null,
        'sede'            => $_SESSION['sede']      ?? null,
        'usuario_id'      => $_SESSION['usuario_id'] ?? null,
    ]);
}

/* ══ DIAGNÓSTICO TEMPORAL — comparar qué quedó guardado como
   "usuario_confirma" contra los usuarios reales del sistema, para
   encontrar por qué un técnico no ve su confirmación pendiente.
   Solo superadmin. Se puede borrar este bloque cuando ya no haga falta. ══ */
if ($method === 'GET' && $action === 'diag_confirmaciones_equipo') {
    if (($_SESSION['rol'] ?? '') !== 'superadmin') {
        responder(['error' => 'Solo superadmin'], 403);
    }
    try {
        $pend = $pdo->query("SELECT id, tipo, equipo_id, estado_propuesto, propuesto_por, usuario_confirma, resultado, creado_en FROM equipo_confirmaciones ORDER BY creado_en DESC LIMIT 15")->fetchAll();
        $usrs = $pdo->query("SELECT usuario, nombre, apellido, rol, estado, sede, sede_id FROM usuarios ORDER BY nombre ASC")->fetchAll();
        $envios = $pdo->query("SELECT id, tipo, referencia_id, nombre_producto, origen, destino, enviado_por, transportador, estado, notas, fecha_aprobado FROM envios_seguimiento WHERE tipo IN ('olt','mikrotik') ORDER BY id DESC LIMIT 10")->fetchAll();
        $olts = $pdo->query("SELECT id, marca, modelo, sede, estado FROM olts ORDER BY id DESC LIMIT 10")->fetchAll();
        responder(['confirmaciones_recientes' => $pend, 'usuarios_del_sistema' => $usrs, 'envios_equipo_recientes' => $envios, 'olts' => $olts]);
    } catch (\Throwable $e) {
        responder(['error' => $e->getMessage()], 500);
    }
}

/* ══ MIS CONFIRMACIONES DE EQUIPO PENDIENTES — lo que alguien más
   registró y me nombró a mí para confirmar si es cierto. ══ */
if ($method === 'GET' && $action === 'mis_confirmaciones_equipo_pendientes') {
    // DIAGNÓSTICO TEMPORAL: si algo falla, en vez de responder [] a secas
    // (que oculta el motivo real), con ?debug=1 se devuelve el error tal
    // cual para poder verlo desde el navegador.
    $debug = isset($_GET['debug']);
    try {
        $st = $pdo->prepare("SELECT * FROM equipo_confirmaciones WHERE usuario_confirma = ? AND resultado = 'pendiente' ORDER BY creado_en DESC");
        $st->execute([$_SESSION['usuario'] ?? '']);
        $filas = $st->fetchAll();
        foreach ($filas as &$f) {
            // OJO: olts NO tiene columnas "proveedor"/"sn" (esas son solo de
            // mikrotiks) — pedirlas igual para una OLT tiraba un error SQL
            // que quedaba atrapado por el catch de abajo y terminaba
            // respondiendo [] siempre, por eso nunca aparecía nada pendiente.
            $esOlt = $f['tipo'] === 'olt';
            $tabla = $esOlt ? 'olts' : 'mikrotiks';
            $cols  = $esOlt ? 'marca, modelo' : 'proveedor, modelo, sn';
            $eq = $pdo->prepare("SELECT $cols FROM $tabla WHERE id = ?");
            $eq->execute([$f['equipo_id']]);
            $e = $eq->fetch();
            $f['equipo_nombre'] = $esOlt
                ? trim(($e['marca'] ?? '') . ' ' . ($e['modelo'] ?? ''))
                : trim(($e['proveedor'] ?? '') . ' ' . ($e['modelo'] ?? '')) . (!empty($e['sn']) ? " · SN {$e['sn']}" : '');
        }
        if ($debug) { responder(['_debug_usuario' => $_SESSION['usuario'] ?? null, '_debug_count' => count($filas), 'filas' => $filas]); }
        responder($filas);
    } catch (\Throwable $e) {
        error_log('[mis_confirmaciones_equipo_pendientes] '.$e->getMessage());
        if ($debug) { responder(['_debug_error' => $e->getMessage(), '_debug_usuario' => $_SESSION['usuario'] ?? null], 500); }
        responder([]);
    }
}

/* ══ RESPONDER UNA CONFIRMACIÓN DE EQUIPO — la persona nombrada dice si
   es cierto (y ahí sí se aplica el cambio) o no (y se descarta). ══ */
if ($method === 'POST' && $action === 'responder_confirmacion_equipo') {
    $d = json_decode(file_get_contents('php://input'), true) ?? [];
    $confId   = intval($d['id'] ?? 0);
    $respuesta = trim($d['respuesta'] ?? '');
    if (!$confId) responder(['error' => 'Confirmación requerida'], 400);
    if (!in_array($respuesta, ['si','no'])) responder(['error' => 'Respuesta inválida'], 400);

    $c = $pdo->prepare("SELECT * FROM equipo_confirmaciones WHERE id = ?");
    $c->execute([$confId]);
    $conf = $c->fetch();
    if (!$conf) responder(['error' => 'Confirmación no encontrada'], 404);
    if ($conf['usuario_confirma'] !== ($_SESSION['usuario'] ?? '')) {
        responder(['error' => 'Esta confirmación no te corresponde a ti'], 403);
    }
    if ($conf['resultado'] !== 'pendiente') {
        responder(['error' => 'Esta confirmación ya fue respondida'], 400);
    }

    if ($respuesta === 'no') {
        $pdo->prepare("UPDATE equipo_confirmaciones SET resultado = 'rechazado', resuelto_en = NOW() WHERE id = ?")->execute([$confId]);
        try { auditar($pdo, 'rechazar_confirmacion_equipo', $conf['tipo']==='olt'?'olts':'mikrotiks', "Confirmación #$confId rechazada por ".($_SESSION['usuario']??''), (string)$conf['equipo_id']); }
        catch (\Throwable $e) { error_log('[responder_confirmacion_equipo/auditar] '.$e->getMessage()); }
        responder(['ok' => true, 'resultado' => 'rechazado']);
    }

    $tabla = $conf['tipo'] === 'olt' ? 'olts' : 'mikrotiks';
    $cur = $pdo->prepare("SELECT * FROM $tabla WHERE id=?");
    $cur->execute([$conf['equipo_id']]);
    $row = $cur->fetch();
    if (!$row) {
        $pdo->prepare("UPDATE equipo_confirmaciones SET resultado = 'rechazado', resuelto_en = NOW() WHERE id = ?")->execute([$confId]);
        responder(['error' => 'El equipo ya no existe'], 404);
    }

    try {
        $historialIdEquipo = _aplicarEstadoEquipoDirecto(
            $pdo, $tabla, $conf['tipo'], (int)$conf['equipo_id'], $row,
            $conf['estado_propuesto'], $conf['nota'] ?? '', $conf['cliente_nombre'] ?? '', $conf['cliente_direccion'] ?? '',
            $conf['lat'] !== null ? (float)$conf['lat'] : null, $conf['lng'] !== null ? (float)$conf['lng'] : null,
            $conf['lote_id'], $_SESSION['usuario'] ?? ''
        );
        $pdo->prepare("UPDATE equipo_confirmaciones SET resultado = 'confirmado', resuelto_en = NOW() WHERE id = ?")->execute([$confId]);
        try { auditar($pdo, 'confirmar_estado_equipo', $tabla, "Confirmación #$confId aceptada por ".($_SESSION['usuario']??'')." → {$conf['estado_propuesto']}", (string)$conf['equipo_id']); }
        catch (\Throwable $e) { error_log('[responder_confirmacion_equipo/auditar] '.$e->getMessage()); }
        responder(['ok' => true, 'resultado' => 'confirmado', 'historial_id' => $historialIdEquipo]);
    } catch (\Throwable $e) {
        error_log('[responder_confirmacion_equipo] '.$e->getMessage());
        responder(['error' => 'No se pudo aplicar el cambio: '.$e->getMessage()], 500);
    }
}

/* ══ ASIGNAR UN OLT/EQUIPO A UNA PERSONA (técnico/persona/municipio) ══
   Antes solo existía "enviar" de sede a sede (superadmin) y "devolver"
   (y ni eso para equipo en comodato) — no había forma de pasarle un OLT
   o equipo DIRECTAMENTE a alguien, como ya se puede con productos y ONT.
   Mismo patrón que asignar_tecnico_ont: queda "en camino" en Seguimiento
   hasta que la otra persona confirme que lo recibió. Un equipo en
   comodato TAMBIÉN se puede asignar así (p.ej. trasladarlo de un cliente
   a otro técnico) — no se excluye por estado, salvo dañado/de_baja. */
if ($method === 'POST' && $action === 'asignar_equipo_persona') {
    sesionRequerida(); noAsignaDistribuidor();
    // Solo la oficina (municipio) y admin/distribuidor reparten equipo
    // directamente a otra persona — técnico/persona solo lo reciben, lo
    // devuelven, o le cambian el estado (con confirmación de quien
    // corresponda). Esto respalda en el backend lo que ya se oculta en
    // pantalla, para que no se pueda forzar llamando la API directo.
    $rolAsigna = $_SESSION['rol'] ?? '';
    if (!in_array($rolAsigna, ['municipio', 'superadmin', 'distribuidor', 'tecnico', 'persona'])) {
        responder(['error' => 'No tienes permiso para asignar equipos'], 403);
    }
    $d      = json_decode(file_get_contents('php://input'), true) ?? [];
    $tipo   = trim($d['tipo'] ?? '');
    $id     = intval($d['id'] ?? 0);
    $aQuien = trim($d['a_quien'] ?? '');
    $nota   = trim($d['nota'] ?? '');
    if (!in_array($tipo, ['olt','mikrotik'])) responder(['error' => 'Tipo inválido'], 400);
    if (!$id) responder(['error' => 'Equipo requerido'], 400);
    if (!$aQuien) responder(['error' => 'Elige a quién se lo asignas'], 400);
    if ($aQuien === ($_SESSION['usuario'] ?? '')) responder(['error' => 'No puedes asignarte algo a ti mismo'], 400);
    if (!destinoAsignablePorMi($pdo, $aQuien)) responder(['error' => 'No puedes asignarle material al distribuidor ni al administrador; para enviárselo usa "Devolver".'], 403);

    $tabla = $tipo === 'olt' ? 'olts' : 'mikrotiks';
    $cur = $pdo->prepare("SELECT * FROM $tabla WHERE id=?");
    $cur->execute([$id]);
    $row = $cur->fetch();
    if (!$row) responder(['error' => 'Equipo no encontrado'], 404);

    // Mismo control de sede que cambiar_estado_equipo: admin/distribuidor
    // pueden asignar cualquiera; el resto, solo lo que está en su sede.
    $rol = $_SESSION['rol'] ?? '';
    if ($rol === 'tecnico' || $rol === 'persona') {
        // Quien tiene el equipo en su poder puede pasárselo a otra persona.
        if (($row['asignado_a'] ?? '') !== ($_SESSION['usuario'] ?? '')) {
            responder(['error' => 'Solo puedes asignar un equipo que tengas en tu poder'], 403);
        }
    } elseif ($rol !== 'superadmin' && $rol !== 'distribuidor') {
        if (($row['sede'] ?? '') !== ($_SESSION['sede'] ?? '')) {
            responder(['error' => 'No puedes asignar equipos de otra sede'], 403);
        }
    }
    if (in_array($row['estado'], ['dañado','de_baja'])) {
        responder(['error' => 'Un equipo dañado o de baja no se puede asignar'], 400);
    }

    // IMPORTANTE: la columna de texto usuarios.sede suele venir VACÍA —
    // la sede real del usuario está en usuarios.sede_id (relación a la
    // tabla sedes). Antes esto usaba solo el texto vacío y, como estaba
    // vacío, terminaba usando por error la sede de quien ENVÍA en vez de
    // la del destinatario. Ahora se resuelve por sede_id primero.
    $tec = $pdo->prepare("
        SELECT u.usuario, u.sede, u.sede_id, s.nombre AS sede_nombre
        FROM usuarios u LEFT JOIN sedes s ON s.id = u.sede_id
        WHERE u.usuario = ? AND u.rol IN ('tecnico','persona','municipio') AND u.estado = 'activo'
    ");
    $tec->execute([$aQuien]);
    $t = $tec->fetch();
    if (!$t) responder(['error' => 'Destinatario no encontrado'], 404);

    $chkEnvio = $pdo->prepare("SELECT id FROM envios_seguimiento WHERE tipo = ? AND referencia_id = ? AND estado IN ('aprobado','en_camino','entregado') LIMIT 1");
    $chkEnvio->execute([$tipo, $id]);
    if ($chkEnvio->fetch()) responder(['error' => 'Este equipo ya tiene un envío/asignación en curso'], 400);

    $origen = (!empty($row['sede'])) ? $row['sede'] : 'Almacen Central';
    // Antes esto bloqueaba con "Ese usuario no tiene municipio asignado" si
    // el destinatario no tenía sede propia en su cuenta — igual que ya se
    // hace con asignar_tecnico_ont (ONT), si no tiene sede se usa la sede de
    // quien envía (o el origen) como destino, en vez de impedir la
    // asignación por completo.
    $sedeDestino = $t['sede_nombre'] ?: $t['sede'] ?: ($_SESSION['sede'] ?? $origen);
    $nombreEq = $tipo === 'olt'
        ? trim(($row['marca'] ?? '') . ' ' . ($row['modelo'] ?? ''))
        : trim(($row['proveedor'] ?? '') . ' ' . ($row['modelo'] ?? '')) . (!empty($row['sn']) ? " · SN {$row['sn']}" : '');

    try {
        // Igual que la ONT: queda "en camino" directo a la persona elegida
        // (quien asigna figura como transportador). NO pasa por el admin
        // para despachar: el destinatario solo confirma que lo recibió.
        $pdo->prepare("
            INSERT INTO envios_seguimiento
              (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, transportador, estado, notas, fecha_aprobado, fecha_envio)
            VALUES (?, ?, ?, ?, 1, 'unidad', ?, ?, ?, ?, 'en_camino', ?, NOW(), NOW())
        ")->execute([
            $tipo, $id, strtoupper($tipo), $nombreEq,
            $origen, $sedeDestino, $_SESSION['usuario'], $_SESSION['usuario'],
            "Asignación directa a $aQuien" . ($nota ? " — $nota" : '') . "\nRecoge en persona: $aQuien",
        ]);
        $idEnvioAsigEq = (int)$pdo->lastInsertId();
        try { notificarAsignacionDirecta($pdo, $idEnvioAsigEq); }
        catch (\Throwable $e) { error_log('[asignar_equipo_persona notificar] ' . $e->getMessage()); }
        auditar($pdo, 'asignar_equipo_persona', $tabla, "Equipo #$id asignado a $aQuien (pendiente de que confirme recibido)", (string)$id);
        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[asignar_equipo_persona] ' . $e->getMessage());
        responder(['error' => 'No se pudo asignar el equipo: ' . $e->getMessage()], 500);
    }
}

/* ══ HISTORIAL DE UN EQUIPO (OLT / Mikrotik) ════════ */
if ($method === 'GET' && $action === 'historial_equipo') {
    $tipo = trim($_GET['tipo'] ?? '');
    $id   = intval($_GET['id'] ?? 0);
    if (!in_array($tipo, ['olt','mikrotik'])) responder(['error' => 'Tipo inválido'], 400);
    if (!$id) responder(['error' => 'ID requerido'], 400);

    $tabla = $tipo === 'olt' ? 'olts' : 'mikrotiks';
    $eq = $pdo->prepare("SELECT * FROM $tabla WHERE id=?");
    $eq->execute([$id]);
    $equipo = $eq->fetch(PDO::FETCH_ASSOC);
    if (!$equipo) responder(['error' => 'Equipo no encontrado'], 404);

    // Seguridad: los roles no-admin solo consultan el historial de equipos de SU sede.
    $rolActual = $_SESSION['rol'] ?? '';
    if (!in_array($rolActual, ['superadmin','distribuidor'])) {
        if (($equipo['sede'] ?? '') !== ($_SESSION['sede'] ?? '')) {
            responder(['error' => 'No puedes ver el historial de equipos de otra sede'], 403);
        }
    }

    // Movimientos de envío (cada despacho con sus fechas/estado)
    $mov = $pdo->prepare("
        SELECT estado, origen, destino, enviado_por, transportador, entregado_a, recibido_por,
               fecha_aprobado, fecha_envio, fecha_entrega, fecha_recibido, notas
        FROM envios_seguimiento
        WHERE tipo = ? AND referencia_id = ?
        ORDER BY id DESC
    ");
    $mov->execute([$tipo, $id]);
    $envios = $mov->fetchAll(PDO::FETCH_ASSOC);

    // Nombres completos de todas las personas que aparecen (para no mostrar solo el usuario).
    $cand = [];
    foreach ($envios as $e) foreach (['enviado_por','transportador','entregado_a','recibido_por'] as $k) if (!empty($e[$k])) $cand[] = preg_replace('/^EXT:/', '', $e[$k]);
    foreach (['asignado_a','registrado_por'] as $k) if (!empty($equipo[$k])) $cand[] = $equipo[$k];
    if (preg_match_all('/·\s*([A-Za-z0-9_.\-]+)\]/u', (string)($equipo['notas'] ?? ''), $mm)) foreach ($mm[1] as $u) $cand[] = $u;
    foreach ($envios as $e) {
        if (preg_match_all('/(?:Asignaci[oó]n directa a|Recoge en persona:|Destinatario ONT:)\s*([A-Za-z0-9_.\-]+)/u', (string)($e['notas'] ?? ''), $m2)) foreach ($m2[1] as $u) $cand[] = $u;
    }
    $cand = array_values(array_unique(array_filter($cand)));
    $nombres = [];
    if ($cand) {
        $ph = implode(',', array_fill(0, count($cand), '?'));
        $qn = $pdo->prepare("SELECT usuario, TRIM(CONCAT(COALESCE(nombre,''),' ',COALESCE(apellido,''))) AS n FROM usuarios WHERE usuario IN ($ph)");
        $qn->execute($cand);
        foreach ($qn->fetchAll(PDO::FETCH_ASSOC) as $r) if ($r['n'] !== '') $nombres[$r['usuario']] = $r['n'];
    }

    responder([
        'ok' => true,
        'equipo' => [
            'estado' => $equipo['estado'] ?? '',
            'sede'   => $equipo['sede'] ?? '',
            'notas'  => $equipo['notas'] ?? '',
            'marca'  => $equipo['marca'] ?? '',
            'modelo' => $equipo['modelo'] ?? '',
            'sn'     => $equipo['sn'] ?? '',
            'mac'    => $equipo['mac_fmt'] ?? ($equipo['mac'] ?? ''),
            'proveedor' => $equipo['proveedor'] ?? '',
            'cliente_nombre'    => $equipo['cliente_nombre'] ?? '',
            'cliente_direccion' => $equipo['cliente_direccion'] ?? '',
            'asignado_a'        => $equipo['asignado_a'] ?? '',
            'registrado_por'    => $equipo['registrado_por'] ?? '',
            'fecha'             => $equipo['fecha'] ?? '',
        ],
        'envios' => $envios,
        'nombres' => $nombres,
    ]);
}

responder(['error' => 'Acción no reconocida'], 400);