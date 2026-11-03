<?php
require 'config.php';
require_once 'auditoria.php';

/* Municipio/técnico/persona no pueden asignarle material al distribuidor ni al administrador: a ellos solo se les devuelve. */
if (!function_exists('destinoAsignablePorMi')) {
    function destinoAsignablePorMi($pdo, $aQuien) {
        if (!in_array($_SESSION['rol'] ?? '', ['municipio','tecnico','persona'], true)) return true;
        $st = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?");
        $st->execute([$aQuien]);
        return !in_array($st->fetchColumn(), ['superadmin','distribuidor'], true);
    }
}
require_once 'notificaciones.php';
sesionRequerida();

// Asegurar que 'productos' tenga las columnas para vincular con modelos de ONT.
try {
    $colsProd = $pdo->query("SHOW COLUMNS FROM productos")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('es_ont', $colsProd)) {
        $pdo->exec("ALTER TABLE productos ADD COLUMN es_ont TINYINT(1) DEFAULT 0");
    }
    if (!in_array('modelo_ont_id', $colsProd)) {
        $pdo->exec("ALTER TABLE productos ADD COLUMN modelo_ont_id INT DEFAULT NULL");
    }
} catch (\Throwable $e) { error_log('[productos/columnas ont] '.$e->getMessage()); }

// Columnas dedicadas para marcar un ingreso anulado (mismo chequeo que historial.php)
try {
    $colsHistAnu = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN);
    $faltantesAnu = [
        'anulado'          => "TINYINT(1) DEFAULT 0",
        'anulado_por'      => "VARCHAR(60) DEFAULT NULL",
        'anulado_en'       => "DATETIME DEFAULT NULL",
        'motivo_anulacion' => "VARCHAR(300) DEFAULT NULL",
        'stock_al_momento' => "INT DEFAULT NULL",
    ];
    foreach ($faltantesAnu as $col => $def) {
        if (!in_array($col, $colsHistAnu)) {
            $pdo->exec("ALTER TABLE historial ADD COLUMN $col $def");
        }
    }
} catch (\Throwable $e) { error_log('[productos/columnas anulacion] '.$e->getMessage()); }

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ══════════════════════════════════════
   LISTAR todos los productos con stock
══════════════════════════════════════ */
/* Crea el proveedor en la lista de Proveedores si todavía no existe (sin importar mayúsculas),
   para no tener que crearlo a mano antes. */
function _proveedorAsegurar($pdo, $nombre, $usuario = '') {
    $nombre = mb_substr(trim((string)$nombre), 0, 100);
    if ($nombre === '') return;
    try {
        $q = $pdo->prepare("SELECT id FROM proveedores WHERE LOWER(TRIM(nombre)) = LOWER(?) LIMIT 1");
        $q->execute([$nombre]);
        if ($q->fetchColumn()) return;
        $pdo->prepare("INSERT INTO proveedores (nombre, creado_por) VALUES (?, ?)")->execute([$nombre, $usuario ?: null]);
    } catch (\Throwable $e) { error_log('[productos/_proveedorAsegurar] ' . $e->getMessage()); }
}

if ($method === 'GET' && $action === 'listar') {
    $stmt = $pdo->query("
        SELECT p.*,
               COALESCE(GROUP_CONCAT(
                   CONCAT(s.nombre, ':', ss.cantidad)
                   ORDER BY s.nombre SEPARATOR '|'
               ), '') as stock_sedes
        FROM productos p
        LEFT JOIN stock_sedes ss ON ss.producto_id = p.id
        LEFT JOIN sedes s ON s.id = ss.sede_id
        GROUP BY p.id
        ORDER BY CAST(p.ref AS UNSIGNED)
    ");
    $rows = $stmt->fetchAll();

    // Stock personal de CADA usuario, para armar tanto "mi stock" (el de
    // quien está viendo la pantalla) como el total repartido entre todos.
    $usuarioActual = $_SESSION['usuario'] ?? '';
    $stockPorProductoUsuario = []; // [producto_id][usuario] = cantidad
    $stmtSU = $pdo->query("SELECT producto_id, usuario, cantidad FROM stock_usuarios WHERE cantidad > 0");
    foreach ($stmtSU->fetchAll() as $su) {
        $stockPorProductoUsuario[$su['producto_id']][$su['usuario']] = (float)$su['cantidad'];
    }

    // Detalle de CADA rollo individual del usuario actual — para mostrar
    // "de 50m quedan 30m" en vez de un confuso "0.6 rollos" cuando un
    // rollo está parcialmente usado, y para listar cada uno por separado
    // cuando la persona tiene más de uno del mismo producto.
    $misRollosPorProducto = []; // [producto_id] = [{id, metros, metros_usados}, ...]
    $stmtRollos = $pdo->prepare("
        SELECT producto_id, id, metros, metros_usados
        FROM producto_rollos
        WHERE usuario_actual = ? AND estado != 'agotado' AND (metros - metros_usados) > 0
        ORDER BY fecha ASC
    ");
    $stmtRollos->execute([$usuarioActual]);
    foreach ($stmtRollos->fetchAll() as $r) {
        $misRollosPorProducto[$r['producto_id']][] = [
            'id' => (int)$r['id'],
            'metros' => (float)$r['metros'],
            'metrosUsados' => (float)$r['metros_usados'],
        ];
    }

    // Mismo detalle, pero para los rollos que están en el ALMACÉN CENTRAL
    // (sin dueño personal todavía) — para que admin/distribuidor también
    // vean "Rollo #X: 50m" en vez de un número confuso como "8.8 rollos".
    $rollosCentralPorProducto = []; // [producto_id] = [{id, metros, metrosUsados}, ...]
    $stmtRollosCentral = $pdo->query("
        SELECT producto_id, id, metros, metros_usados
        FROM producto_rollos
        WHERE sede_nombre = 'Almacen Central' AND usuario_actual IS NULL
          AND estado = 'disponible' AND (metros - metros_usados) > 0
        ORDER BY fecha ASC
    ");
    foreach ($stmtRollosCentral->fetchAll() as $r) {
        $rollosCentralPorProducto[$r['producto_id']][] = [
            'id' => (int)$r['id'],
            'metros' => (float)$r['metros'],
            'metrosUsados' => (float)$r['metros_usados'],
        ];
    }

    // Cuántos ROLLOS físicos tienen los técnicos/personas en este momento
    // (un rollo empezado cuenta como 1) — para mostrar un número entero en
    // vez de metros ÷ metros por rollo (ej: "2.9 rollos").
    $rollosEnManos = []; // [producto_id] = cantidad de rollos
    try {
        $stmtRM = $pdo->query("
            SELECT producto_id, COUNT(*) AS n FROM producto_rollos
            WHERE usuario_actual IS NOT NULL AND estado = 'disponible' AND (metros - metros_usados) > 0
            GROUP BY producto_id
        ");
        foreach ($stmtRM->fetchAll() as $r) $rollosEnManos[$r['producto_id']] = (int)$r['n'];
    } catch (\Throwable $e) { error_log('[productos/listar rollosEnManos] ' . $e->getMessage()); }

    // Material recogido REUTILIZABLE que esta persona tiene sin gastar
    // todavía — se muestra directo en "Productos en stock" (junto a su
    // stock normal de ese mismo producto), para que no tenga que ir a
    // buscarlo aparte en "Material recogido".
    $misRecogidosPorRef = []; // [ref] = {cantidad, ids: [id1, id2, ...]}
    $stmtRecogido = $pdo->prepare("
        SELECT id, ref, cantidad FROM material_recogido
        WHERE usuario = ? AND estado = 'en_poder' AND tipo = 'reutilizable'
    ");
    $stmtRecogido->execute([$usuarioActual]);
    foreach ($stmtRecogido->fetchAll() as $r) {
        if (!isset($misRecogidosPorRef[$r['ref']])) $misRecogidosPorRef[$r['ref']] = ['cantidad' => 0, 'ids' => []];
        $misRecogidosPorRef[$r['ref']]['cantidad'] += (int)$r['cantidad'];
        $misRecogidosPorRef[$r['ref']]['ids'][] = (int)$r['id'];
    }

    // Dar formato igual al que espera el frontend
    $resultado = array_map(function($p) use ($stockPorProductoUsuario, $usuarioActual, $misRollosPorProducto, $rollosCentralPorProducto, $misRecogidosPorRef, $rollosEnManos) {
        // Stock del almacén central, bajo la única clave reservada ahora.
        $stock = [
            'Almacen Central'=> (int)$p['stock_neiva'],
        ];
        if ($p['stock_sedes']) {
            foreach (explode('|', $p['stock_sedes']) as $par) {
                [$sede, $cant] = explode(':', $par);
                $stock[$sede] = (int)$cant;
            }
        }
        $stockUsuarios = $stockPorProductoUsuario[$p['id']] ?? [];
        return [
            'id'          => $p['id'],
            'ref'         => $p['ref'],
            'nombre'      => $p['nombre'],
            'unidad'      => $p['unidad'],
            'stockMinimo' => (int)($p['stock_minimo'] ?? $p['stock_min'] ?? 0),
            'descripcion' => $p['descripcion'] ?? '',
            'proveedor'   => $p['proveedor']   ?? '',
            'stock'       => $stock,
            'stockRecuperado'   => (int)($p['stock_recuperado'] ?? 0),
            'metrosPorUnidad'   => isset($p['metros_por_unidad']) ? (float)$p['metros_por_unidad'] : null,
            'stockUsuario'      => $stockUsuarios[$usuarioActual] ?? 0,
            'stockTotalUsuarios'=> array_sum($stockUsuarios),
            'rollosEnTecnicos'  => $rollosEnManos[$p['id']] ?? 0,
            'misRollos'         => $misRollosPorProducto[$p['id']] ?? [],
            // El número real de rollos en el almacén sale del stock (metros ÷
            // metros por rollo, redondeado hacia arriba por si hay uno
            // empezado). Si hay filas de rollo "de más" (ej: de envíos viejos
            // que salieron sin marcar el rollo), no se cuentan.
            'rollosCentral'     => (function() use ($p, $rollosCentralPorProducto) {
                $lista = $rollosCentralPorProducto[$p['id']] ?? [];
                $mpr = (float)($p['metros_por_unidad'] ?? 0);
                if ($mpr > 0 && $lista) {
                    $max = (int)ceil(((float)$p['stock_neiva'] / $mpr) - 0.0001);
                    if ($max < 0) $max = 0;
                    if (count($lista) > $max) $lista = array_slice($lista, 0, $max);
                }
                return $lista;
            })(),
            'misRecogidos'      => $misRecogidosPorRef[$p['ref']] ?? null,
        ];
    }, $rows);

    responder($resultado);
}

/* ══════════════════════════════════════
   CREAR producto
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'crear') {
    rolOPermiso(['superadmin'], 'editar_productos');
    $data = json_decode(file_get_contents('php://input'), true);

    $nombre     = trim($data['nombre']      ?? '');
    $proveedor  = trim($data['proveedor']   ?? '');
    $unidad     = $data['unidad']           ?? 'unidad';
    $stockNeiva = floatval($data['stockNeiva']  ?? 0);
    $stockMin   = intval($data['stockMinimo'] ?? 0);
    $desc       = trim($data['descripcion']  ?? '');
    $metrosPorUnidad = ($unidad === 'metros' && !empty($data['metrosPorUnidad'])) ? floatval($data['metrosPorUnidad']) : null;
    $rollosCant = intval($data['rollosCantidad'] ?? 0); // cuántos rollos, si el producto se creó indicando "por rollos"

    if (!$nombre) responder(['error' => 'El nombre es obligatorio'], 400);

    // Auto-generar referencia: buscar el mayor número actual y sumar 1
    $maxRef = $pdo->query("
        SELECT MAX(CAST(ref AS UNSIGNED))
        FROM productos WHERE ref REGEXP '^[0-9]+$'
    ")->fetchColumn();
    $siguiente = ($maxRef ? intval($maxRef) : 0) + 1;
    $ref = str_pad($siguiente, 3, '0', STR_PAD_LEFT); // 001, 002, 003...

    // Asegurar que no existe (por si acaso)
    while (true) {
        $check = $pdo->prepare("SELECT id FROM productos WHERE ref = ?");
        $check->execute([$ref]);
        if (!$check->fetch()) break;
        $siguiente++;
        $ref = str_pad($siguiente, 3, '0', STR_PAD_LEFT);
    }

    $stmt = $pdo->prepare("
        INSERT INTO productos (ref, nombre, unidad, stock_neiva, stock_minimo, descripcion, proveedor, metros_por_unidad)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([$ref, $nombre, $unidad, $stockNeiva, $stockMin, $desc, $proveedor, $metrosPorUnidad]);
    $id = $pdo->lastInsertId();

    // Crear filas de stock para cada sede municipio
    $sedes = $pdo->query("SELECT id FROM sedes WHERE tipo = 'municipio' AND activa = 1")->fetchAll();
    $ins = $pdo->prepare("INSERT IGNORE INTO stock_sedes (producto_id, sede_id, cantidad) VALUES (?, ?, 0)");
    foreach ($sedes as $s) $ins->execute([$id, $s['id']]);

    // Si el producto se creó indicando "por rollos" (ej: 5 rollos de 300m
    // cada uno), cada rollo debe quedar como su PROPIA fila en
    // producto_rollos — igual que cuando llega mercancía con "Registrar
    // llegada" — para que se pueda ver/elegir cada rollo individualmente
    // en vez de mostrar 0 rollos aunque el total en metros sí quedó bien.
    if ($metrosPorUnidad && $rollosCant > 0) {
        $insRollo = $pdo->prepare("
            INSERT INTO producto_rollos (producto_id, metros, metros_usados, sede_nombre, estado, registrado_por)
            VALUES (?, ?, 0, 'Almacen Central', 'disponible', ?)
        ");
        for ($i = 0; $i < $rollosCant; $i++) {
            $insRollo->execute([$id, $metrosPorUnidad, $_SESSION['usuario'] ?? null]);
        }
    }

    auditar($pdo, 'crear', 'productos', "Producto creado: $nombre (Ref: $ref), stock inicial: $stockNeiva", $ref);
    responder(['ok' => true, 'id' => $id, 'ref' => $ref]);
}

/* ══════════════════════════════════════
   ACTUALIZAR producto
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'actualizar') {
    rolOPermiso(['superadmin'], 'editar_productos');
    $data = json_decode(file_get_contents('php://input'), true);

    $id         = intval($data['id'] ?? 0);
    $ref        = trim($data['ref']        ?? '');
    $nombre     = trim($data['nombre']     ?? '');
    $proveedor  = trim($data['proveedor']  ?? '');
    $unidad     = $data['unidad']          ?? 'unidad';
    $stockMin   = intval($data['stockMinimo'] ?? 0);
    $desc       = trim($data['descripcion'] ?? '');
    $metrosPorUnidad = ($unidad === 'metros' && !empty($data['metrosPorUnidad'])) ? floatval($data['metrosPorUnidad']) : null;

    if (!$id || !$ref || !$nombre) responder(['error' => 'Datos incompletos'], 400);

    // Verificar ref única (excluir el propio)
    $check = $pdo->prepare("SELECT id FROM productos WHERE ref = ? AND id != ?");
    $check->execute([$ref, $id]);
    if ($check->fetch()) responder(['error' => "La referencia \"$ref\" ya está en uso"], 400);

    // OJO: editar un producto ya NO toca el stock (stock_neiva) — eso solo
    // se cambia con "Registrar llegada" o al despachar, para que siempre
    // quede registrado quién y cuándo movió el inventario.
    $pdo->prepare("
        UPDATE productos SET ref=?, nombre=?, unidad=?, stock_minimo=?, descripcion=?, proveedor=?, metros_por_unidad=?
        WHERE id=?
    ")->execute([$ref, $nombre, $unidad, $stockMin, $desc, $proveedor, $metrosPorUnidad, $id]);

    auditar($pdo, 'editar', 'productos', "Producto actualizado: $nombre (Ref: $ref)", $ref);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   ACTUALIZAR stock de una sede específica
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'actualizar_stock') {
    rolOPermiso(['superadmin'], 'editar_productos');
    $data       = json_decode(file_get_contents('php://input'), true);
    $productoId = intval($data['producto_id'] ?? 0);
    $sedeNombre = trim($data['sede']          ?? '');
    $cantidad   = intval($data['cantidad']    ?? 0);
    // Sedes centrales que usan stock_neiva
    $sedesCentrales = ['neiva', 'almacen central', 'administración', 'administracion', 'sistema'];
    $esNeiva    = in_array(strtolower($sedeNombre), $sedesCentrales);

    if (!$productoId || !$sedeNombre) responder(['error' => 'Datos incompletos'], 400);

    $prodInfo = $pdo->prepare("SELECT nombre, stock_neiva FROM productos WHERE id = ?");
    $prodInfo->execute([$productoId]);
    $pInfo = $prodInfo->fetch();
    $stockAntes = $esNeiva ? ($pInfo['stock_neiva'] ?? null) : null;

    if ($esNeiva) {
        $pdo->prepare("UPDATE productos SET stock_neiva = ? WHERE id = ?")
            ->execute([$cantidad, $productoId]);
    } else {
        $sede = $pdo->prepare("SELECT id FROM sedes WHERE nombre = ?");
        $sede->execute([$sedeNombre]);
        $sedeRow = $sede->fetch();
        if (!$sedeRow) responder(['error' => 'Sede no encontrada'], 404);

        $pdo->prepare("
            INSERT INTO stock_sedes (producto_id, sede_id, cantidad)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE cantidad = ?
        ")->execute([$productoId, $sedeRow['id'], $cantidad, $cantidad]);
    }
    $detalleAntes = $stockAntes !== null ? " (antes: {$stockAntes})" : '';
    auditar($pdo, 'actualizar_stock', 'productos', "Cambió stock de \"" . ($pInfo['nombre'] ?? $productoId) . "\" en {$sedeNombre} a {$cantidad}{$detalleAntes}", (string)$productoId);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   ELIMINAR producto
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'eliminar') {
    rolOPermiso(['superadmin'], 'eliminar_productos');
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    $pass = $data['password'] ?? '';
    if (!$id) responder(['error' => 'ID requerido'], 400);

    // Verificar contraseña del usuario actual antes de eliminar
    if (empty($pass)) responder(['error' => 'Debes ingresar tu contraseña para confirmar'], 403);
    $chkPass = $pdo->prepare("SELECT password FROM usuarios WHERE usuario = ?");
    $chkPass->execute([$_SESSION['usuario'] ?? '']);
    $hash = $chkPass->fetchColumn();
    if (!$hash || !password_verify($pass, $hash)) {
        responder(['error' => 'Contraseña incorrecta'], 403);
    }
    // stock_sedes se elimina en cascada por FK
    $prod = $pdo->prepare('SELECT ref, nombre FROM productos WHERE id = ?');
    $prod->execute([$id]);
    $p = $prod->fetch();
    $pdo->prepare("DELETE FROM productos WHERE id = ?")->execute([$id]);
    auditar($pdo, 'eliminar', 'productos', "Producto eliminado: {$p['nombre']} (Ref: {$p['ref']})", $p['ref']);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   INGRESO DE MERCANCÍA
   (llegó stock nuevo al almacén central — se suma a lo que ya había,
   sin tener que calcular el total a mano)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'ingreso_stock') {
    rolOPermiso(['superadmin'], 'registrar_ingresos');
    $data = json_decode(file_get_contents('php://input'), true);
    $ref  = trim($data['ref'] ?? '');
    $cant = floatval($data['cantidad'] ?? 0);
    $nota = trim($data['nota'] ?? '');
    $valorUnitario = isset($data['valor_unitario']) ? floatval($data['valor_unitario']) : null;
    $precioTotal   = isset($data['precio_total'])   ? floatval($data['precio_total'])   : null;
    $valorEnvio    = isset($data['valor_envio'])    ? floatval($data['valor_envio'])    : null;
    $proveedor     = trim($data['proveedor'] ?? '');
    $rollosCant    = intval($data['rollos_cantidad'] ?? 0); // cuántos rollos llegaron (si aplica)

    if (!$ref) responder(['error' => 'Producto requerido'], 400);
    if ($cant <= 0) responder(['error' => 'La cantidad debe ser mayor a 0'], 400);

    $prod = $pdo->prepare("SELECT * FROM productos WHERE ref = ?");
    $prod->execute([$ref]);
    $p = $prod->fetch();
    if (!$p) responder(['error' => 'Producto no encontrado'], 404);

    // Si es un producto "por rollo" (metros_por_unidad definido) y llegó
    // como tal (rollos_cantidad > 0), cada rollo queda como su PROPIA fila
    // en producto_rollos — así, si llegan 3, se sabe cuál es cuál, y al
    // gastar se puede elegir de cuál sacar. stock_neiva se mantiene como
    // el TOTAL calculado (para no romper nada que ya lo usa para mostrar).
    $esPorRollo = !empty($p['metros_por_unidad']) && $rollosCant > 0;
    if ($esPorRollo) {
        for ($i = 0; $i < $rollosCant; $i++) {
            $pdo->prepare("
                INSERT INTO producto_rollos (producto_id, metros, metros_usados, sede_nombre, estado, registrado_por)
                VALUES (?, ?, 0, 'Almacen Central', 'disponible', ?)
            ")->execute([$p['id'], $p['metros_por_unidad'], $_SESSION['usuario']]);
        }
    }

    if ($valorUnitario) {
        $pdo->prepare("UPDATE productos SET stock_neiva = stock_neiva + ?, costo_unitario = ? WHERE id = ?")
            ->execute([$cant, $valorUnitario, $p['id']]);
    } else {
        $pdo->prepare("UPDATE productos SET stock_neiva = stock_neiva + ? WHERE id = ?")
            ->execute([$cant, $p['id']]);
    }

    $stockNuevo = (int)$p['stock_neiva'] + $cant;
    $precioTotalFinal = $precioTotal ?: ($valorUnitario ? $valorUnitario * $cant : null);

    try {
        // El front ya incluye precio/envío dentro de la nota: no repetirlos
        $yaPrecio = (bool)preg_match('/Valor (unitario|por rollo):/u', (string)$nota);
        $yaEnvio  = (bool)preg_match('/Valor de env[ií]o:/u', (string)$nota);
        $descPrecio = ($valorUnitario && !$yaPrecio) ? " · Valor unitario: $" . number_format($valorUnitario, 2) . " · Total: $" . number_format($precioTotalFinal, 2) : '';
        $descEnvio  = ($valorEnvio && !$yaEnvio) ? " · Valor de envío: $" . number_format($valorEnvio, 2) : '';
        $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,stock_al_momento,proveedor,precio_unitario,precio_total)
            VALUES (?,?,?,?,?,?,?,'aprobado',0,'ingreso',?,?,?,?)")
            ->execute([
                $p['ref'], $p['nombre'], 'Almacen Central', $cant, $p['unidad'] ?? 'unidad',
                $_SESSION['usuario'],
                "Ingreso de mercancía" . ($nota ? ": $nota" : '') . " · Nuevo total: $stockNuevo" . $descPrecio . $descEnvio,
                $stockNuevo, $proveedor ?: null, $valorUnitario, $precioTotalFinal
            ]);
    } catch (\Throwable $e) { error_log('[productos/ingreso_stock historial] '.$e->getMessage()); }

    try { auditar($pdo, 'ingreso_stock', 'productos', "Ingreso: +{$cant} de \"{$p['nombre']}\" (total: {$stockNuevo})" . ($valorUnitario ? " — \${$valorUnitario} c/u" : '') . ($proveedor ? " — proveedor: $proveedor" : ''), $p['ref']); } catch (\Throwable $e) {}

    responder(['ok' => true, 'stock_nuevo' => $stockNuevo]);
}

/* ══════════════════════════════════════
   ANULAR UN INGRESO (se registró mal — resta lo que se sumó de más
   y deja la marca de quién lo anuló y cuándo, sin borrar el rastro)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'anular_ingreso') {
    rolOPermiso(['superadmin'], 'anular_ingresos');
    $data = json_decode(file_get_contents('php://input'), true);
    $histId = intval($data['historial_id'] ?? 0);
    $motivo = trim($data['motivo'] ?? '');
    $confirmarAunque = !empty($data['confirmar_aunque_se_movio']);
    if (!$histId) responder(['error' => 'ID de ingreso requerido'], 400);
    if (!$motivo) responder(['error' => 'Escribe el motivo de la anulación'], 400);

    $hist = $pdo->prepare("SELECT * FROM historial WHERE id = ? AND origen = 'ingreso'");
    $hist->execute([$histId]);
    $h = $hist->fetch();
    if (!$h) responder(['error' => 'Ese ingreso no existe o ya no se puede anular'], 404);
    if (!empty($h['anulado'])) responder(['error' => 'Ese ingreso ya estaba anulado'], 400);
    if (preg_match('/^(Registro de|Llegada de|Ingreso ONT)/u', (string)$h['descripcion']))
        responder(['error' => 'Este ingreso es un registro de equipo/ONT/carrete; no se anula desde aquí'], 400);

    $prod = $pdo->prepare("SELECT * FROM productos WHERE ref = ?");
    $prod->execute([$h['ref']]);
    $p = $prod->fetch();
    if (!$p) responder(['error' => 'El producto de ese ingreso ya no existe'], 404);

    $cant = (int)$h['cantidad'];

    // Si el stock actual es menor al que quedó justo después de este ingreso,
    // significa que parte de esa mercancía ya se movió (se envió/instaló) —
    // avisar antes de restar, para no dejar el número mal.
    if (!$confirmarAunque && $h['stock_al_momento'] !== null && (int)$p['stock_neiva'] < (int)$h['stock_al_momento']) {
        $yaMovido = (int)$h['stock_al_momento'] - (int)$p['stock_neiva'];
        responder([
            'aviso' => true,
            'mensaje' => "Ojo: de este ingreso ya se movieron $yaMovido unidad(es) (se enviaron o usaron). Anular ahora restará $cant de todos modos — el stock puede quedar más bajo de lo real.",
        ]);
    }

    $pdo->prepare("UPDATE productos SET stock_neiva = GREATEST(0, stock_neiva - ?) WHERE id = ?")
        ->execute([$cant, $p['id']]);
    $stockNuevo = max(0, (int)$p['stock_neiva'] - $cant);

    $pdo->prepare("UPDATE historial SET anulado=1, anulado_por=?, anulado_en=NOW(), motivo_anulacion=? WHERE id=?")
        ->execute([$_SESSION['usuario'], $motivo, $histId]);

    try { auditar($pdo, 'anular_ingreso', 'productos', "Anuló ingreso de {$cant} de \"{$h['nombre']}\" — motivo: {$motivo} — nuevo total: {$stockNuevo}", $h['ref']); } catch (\Throwable $e) {}

    responder(['ok' => true, 'stock_nuevo' => $stockNuevo]);
}

/* ══════════════════════════════════════
   REPORTE: Ingresos anulados (auditoría)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'ingresos_anulados') {
    rolOPermiso(['superadmin'], 'editar_productos');
    $stmt = $pdo->query("
        SELECT id, ref, nombre, cantidad, unidad_envio, enviado_por, fecha,
               anulado_por, anulado_en, motivo_anulacion, stock_al_momento
        FROM historial
        WHERE origen = 'ingreso' AND anulado = 1
        ORDER BY anulado_en DESC
    ");
    responder($stmt->fetchAll());
}

/* ══════════════════════════════════════
   DEVOLVER material al almacén central
   (una sede/técnico regresa stock que no usó)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'devolver') {
    sesionRequerida();
    $data    = json_decode(file_get_contents('php://input'), true);
    $ref     = trim($data['ref'] ?? '');
    $cant    = intval($data['cantidad'] ?? 0);
    $motivo  = trim($data['motivo'] ?? '');
    $transportador = trim($data['transportador'] ?? '');
    $usuario = $_SESSION['usuario'];

    if (!$ref || $cant <= 0) responder(['error' => 'Datos incompletos'], 400);
    if (!$transportador) responder(['error' => 'Indica quién lo transporta'], 400);

    $prod = $pdo->prepare("SELECT * FROM productos WHERE ref = ?");
    $prod->execute([$ref]);
    $p = $prod->fetch();
    if (!$p) responder(['error' => 'Producto no encontrado'], 404);

    $rolloIds = array_filter(array_map('intval', (array)($data['rollo_ids'] ?? [])));
    if (!$rolloIds && (float)($p['metros_por_unidad'] ?? 0) > 0) {
        responder(['error' => 'Este producto es por rollo: elige cuáles rollos devuelves'], 400);
    }
    if ($rolloIds) {
        $ph = implode(',', array_fill(0, count($rolloIds), '?'));
        $rollosChk = $pdo->prepare("SELECT id FROM producto_rollos WHERE id IN ($ph) AND producto_id = ? AND usuario_actual = ?");
        $rollosChk->execute([...$rolloIds, $p['id'], $usuario]);
        $encontrados = $rollosChk->fetchAll(PDO::FETCH_COLUMN);
        if (count($encontrados) !== count($rolloIds)) responder(['error' => 'Uno o más rollos no son tuyos o no existen'], 404);
    }

    // Verificar que la persona realmente tenga esa cantidad disponible para devolver
    $stockActual = stockUsuarioObtener($pdo, $p['id'], $usuario);
    if ($cant > $stockActual) {
        responder(['error' => "No puedes devolver más de lo que tienes registrado. Disponible: $stockActual"], 400);
    }

    // Si el técnico/persona elige devolver a una oficina, se valida ANTES de descontar stock.
    $sedeElegida = '';
    if (in_array($_SESSION['rol'] ?? '', ['tecnico', 'persona']) && (($data['destino_tipo'] ?? 'almacen') === 'oficina')) {
        $sedeElegida = trim($data['destino_sede'] ?? '');
        if ($sedeElegida === '') responder(['error' => 'Elige a qué municipio devuelves'], 400);
        $esMunSede = $pdo->prepare("SELECT 1 FROM sedes WHERE nombre = ? AND tipo = 'municipio' LIMIT 1");
        $esMunSede->execute([$sedeElegida]);
        if (!$esMunSede->fetchColumn()) responder(['error' => 'Elige un municipio válido'], 400);
        $hayMun = $pdo->prepare("SELECT 1 FROM usuarios u JOIN sedes s ON s.id = u.sede_id WHERE u.rol = 'municipio' AND u.estado = 'activo' AND s.nombre = ? LIMIT 1");
        $hayMun->execute([$sedeElegida]);
        if (!$hayMun->fetchColumn()) responder(['error' => "En $sedeElegida no hay una oficina activa que pueda recibirlo. Elige otro municipio o devuélvelo al Almacén Central."], 400);
    }

    // Ya NO se suma al almacén de inmediato — sale de tu inventario personal
    // ahora mismo (ya no lo tienes físicamente), pero queda "en camino"
    // hasta que alguien confirme que de verdad llegó (mismo criterio que ya
    // se usa para ONT y material recogido). Técnico/persona devuelven a su
    // municipio, no directo al almacén central.
    stockUsuarioAjustar($pdo, $p['id'], $usuario, -$cant);

    // Si se devuelven ROLLOS COMPLETOS (uno o varios, no metros sueltos),
    // salen de tu lista ahora mismo — quedan "en_transito" hasta que se
    // confirmen recibidos en destino, momento en que se transfieren
    // completos con su misma identidad (no se crean genéricos nuevos).
    $notaRollo = '';
    if ($rolloIds) {
        $ph2 = implode(',', array_fill(0, count($rolloIds), '?'));
        $pdo->prepare("UPDATE producto_rollos SET estado = 'en_transito', usuario_actual = NULL WHERE id IN ($ph2)")->execute($rolloIds);
        $notaRollo = "\nRollos elegidos: " . implode(',', $rolloIds);
    }

    // Técnico y persona devuelven a SU municipio (quien se lo asignó), nunca
    // directo al almacén central — solo municipio/admin/distribuidor pueden
    // mandarlo directo al almacén. PERO si esa sede no tiene ninguna cuenta
    // de municipio activa que pueda confirmar el recibido, la devolución se
    // queda "en camino" para siempre sin que nadie la vea (ni el municipio,
    // que no existe, ni el propio técnico, que no puede confirmarse a sí
    // mismo su propia devolución) — mismo problema ya resuelto para ONT en
    // cajas.php. Por eso: primero se busca el municipio que REALMENTE le
    // asignó este producto (último envío recibido con su nombre en "Recoge
    // en persona"), y si no se encuentra ninguno activo, se manda directo
    // al almacén central en vez de perderse en una sede sin nadie.
    $rolDev = $_SESSION['rol'] ?? '';
    $destinoDev = 'Almacen Central';
    // El técnico/persona ELIGE: 'almacen' (por defecto) o 'oficina' (su municipio).
    $eligeOficina = (($data['destino_tipo'] ?? 'almacen') === 'oficina');
    if (in_array($rolDev, ['tecnico', 'persona']) && $eligeOficina) {
        $destinoDev = $sedeElegida;
    }

    // Si viene de "Devolver múltiple", todos los productos del mismo lote
    // comparten este id en las notas — así, en Seguimiento, aparecen
    // agrupados en una sola tarjeta con un solo "Confirmar recibido" para
    // todos, en vez de uno separado por cada producto.
    $loteIdDev = trim($data['lote_id'] ?? '');
    if ($loteIdDev) $notaRollo .= "\nLote: $loteIdDev";

    try {
        $pdo->prepare("
            INSERT INTO envios_seguimiento
              (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, transportador, estado, notas, fecha_aprobado, fecha_envio)
            VALUES ('devolucion_stock', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'en_camino', ?, NOW(), NOW())
        ")->execute([
            $p['ref'], $p['nombre'], $cant, $p['unidad'] ?? 'unidad',
            $_SESSION['sede'] ?? '', $destinoDev, $usuario, $transportador,
            "Devolución de stock" . ($motivo ? " — $motivo" : '') . $notaRollo,
        ]);
    } catch (\Throwable $e) {
        error_log('[productos/devolver seguimiento] ' . $e->getMessage());
        // Revertir el descuento si no se pudo crear el seguimiento, para no perder el stock.
        stockUsuarioAjustar($pdo, $p['id'], $usuario, $cant);
        if ($rolloIds) {
            $phR = implode(',', array_fill(0, count($rolloIds), '?'));
            $pdo->prepare("UPDATE producto_rollos SET estado = 'disponible', usuario_actual = ? WHERE id IN ($phR)")->execute([$usuario, ...$rolloIds]);
        }
        responder(['error' => 'No se pudo iniciar la devolución'], 500);
    }

    auditar($pdo, 'devolver', 'productos', "Inició devolución: {$p['nombre']} x{$cant} por $usuario" . ($motivo ? " ($motivo)" : ''), $p['ref']);
    responder(['ok' => true]);
}

/* ══ REGISTRAR MATERIAL RECOGIDO (dañado o reutilizable) ══
   Cualquier persona logueada puede reportar material que recogió en campo
   (ej: un cambio en casa del cliente) — no solo técnicos. Queda en una
   bolsa APARTE de su inventario normal (no se mezcla) — lo reutilizable se
   puede devolver al almacén central más tarde; lo dañado solo queda registrado. */
if ($method === 'POST' && $action === 'registrar_recogido') {
    sesionRequerida();
    $data   = json_decode(file_get_contents('php://input'), true);
    $ref    = trim($data['ref']      ?? '');
    $cant   = intval($data['cantidad'] ?? 0);
    $tipo   = $data['tipo']          ?? ''; // 'reutilizable' | 'dañado'
    $motivo = trim($data['motivo']   ?? '');
    $usuario = $_SESSION['usuario'];

    if (!in_array($tipo, ['reutilizable', 'dañado'])) responder(['error' => 'Indica si es reutilizable o dañado'], 400);

    // Producto que NO está en el catálogo (o es de otro proveedor): queda pendiente
    // hasta que un admin/distribuidor lo acepte (ver 'aceptar_recogido_nuevo').
    if (!empty($data['nuevo'])) {
        $nomNuevo  = mb_substr(trim($data['nombre'] ?? ''), 0, 255);
        $provNuevo = mb_substr(trim($data['proveedor'] ?? ''), 0, 150);
        if ($nomNuevo === '' || $cant < 1) responder(['error' => 'Escribe el nombre del producto y la cantidad'], 400);
        $pdo->prepare("
            INSERT INTO material_recogido (producto_id, ref, nombre, usuario, cantidad, tipo, motivo, estado, fecha, es_nuevo, proveedor_nuevo)
            VALUES (0, 'NUEVO', ?, ?, ?, ?, ?, 'en_poder', NOW(), 1, ?)
        ")->execute([$nomNuevo, $usuario, $cant, $tipo, $motivo ?: null, $provNuevo ?: null]);
        _proveedorAsegurar($pdo, $provNuevo, $usuario);
        $nid = (int)$pdo->lastInsertId();
        $pdo->prepare("UPDATE material_recogido SET ref = ? WHERE id = ?")->execute(['NUEVO-'.$nid, $nid]);
        auditar($pdo, 'registrar_recogido', 'productos', "Material recogido NUEVO/otro proveedor ($tipo): $nomNuevo" . ($provNuevo ? " — proveedor $provNuevo" : '') . " x{$cant}", 'NUEVO-'.$nid);
        responder(['ok' => true, 'nuevo' => true]);
    }

    if (!$ref || $cant < 1) responder(['error' => 'Datos inválidos'], 400);

    $prod = $pdo->prepare("SELECT id, ref, nombre, unidad FROM productos WHERE ref = ?");
    $prod->execute([$ref]);
    $p = $prod->fetch();
    if (!$p) responder(['error' => 'Producto no encontrado'], 404);

    $pdo->prepare("
        INSERT INTO material_recogido (producto_id, ref, nombre, usuario, cantidad, tipo, motivo, estado, fecha)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'en_poder', NOW())
    ")->execute([$p['id'], $p['ref'], $p['nombre'], $usuario, $cant, $tipo, $motivo ?: null]);

    $origen = $tipo === 'reutilizable' ? 'recogido_reutilizable' : 'recogido_dañado';
    $descripcion = ($tipo === 'reutilizable' ? 'Material recogido, reutilizable (aparte del inventario)' : 'Material recogido, dañado (no reutilizable)')
        . ($motivo ? " — $motivo" : '');
    try {
        $pdo->prepare("
            INSERT INTO historial (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha, usuario_destino)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'aprobado', 0, ?, NOW(), ?)
        ")->execute([$p['ref'], $p['nombre'], $usuario, $cant, $p['unidad'] ?? 'unidad', $usuario, $descripcion, $origen, $usuario]);
    } catch (\Throwable $e) { error_log('[registrar_recogido] '.$e->getMessage()); }

    auditar($pdo, 'registrar_recogido', 'productos', "$descripcion: {$p['nombre']} x{$cant}", $ref);
    responder(['ok' => true]);
}

/* ══ Datos de un registro de material recogido (para el conteo al recibir) ══ */
if ($method === 'GET' && $action === 'recogido_info') {
    sesionRequerida();
    $q = $pdo->prepare("SELECT id, nombre, tipo, cantidad, es_nuevo, usuario FROM material_recogido WHERE id = ?");
    $q->execute([intval($_GET['id'] ?? 0)]);
    $r = $q->fetch();
    if (!$r) responder(['error' => 'No encontrado'], 404);
    responder($r);
}

/* ══ LISTAR mi material recogido pendiente ══ */
if ($method === 'GET' && $action === 'mi_material_recogido') {
    sesionRequerida();
    $stmt = $pdo->prepare("SELECT * FROM material_recogido WHERE usuario = ? ORDER BY fecha DESC");
    $stmt->execute([$_SESSION['usuario']]);
    responder($stmt->fetchAll());
}

/* ══ DEVOLVER material recogido (solo lo reutilizable, aún en_poder) ══
   Ya NO se auto-confirma: crea un envío en Seguimiento hacia el almacén
   central, y el stock solo se acredita cuando alguien allá confirma que
   de verdad lo recibió — igual que cualquier otro material. */
if ($method === 'POST' && $action === 'devolver_recogido') {
    sesionRequerida();
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    $transportador = trim($data['transportador'] ?? '');
    $notasUsuario = trim($data['notas'] ?? '');
    if (!$id) responder(['error' => 'ID requerido'], 400);
    if (!$transportador) responder(['error' => 'Indica quién lo transporta'], 400);

    $mr = $pdo->prepare("SELECT * FROM material_recogido WHERE id = ? AND usuario = ?");
    $mr->execute([$id, $_SESSION['usuario']]);
    $row = $mr->fetch();
    if (!$row) responder(['error' => 'Registro no encontrado'], 404);
    if ($row['estado'] !== 'en_poder') responder(['error' => 'Ya fue devuelto o está en camino'], 400);
    // Ya no se bloquea lo dañado — puede estar exagerado, o ser reparable.
    // Al llegar al almacén, alguien lo revisa y decide: se reincorpora al
    // stock, o se da de baja definitivamente (ver "Material recogido").

    // Cuánto se devuelve AHORA — puede ser menos de lo que tiene en total
    // (ej: recogió 5 conectores dañados, pero solo va a devolver 2 esta
    // vez). Si no se especifica, se asume todo (compatibilidad).
    $cantDevolver = isset($data['cantidad']) ? intval($data['cantidad']) : (int)$row['cantidad'];
    if ($cantDevolver <= 0) responder(['error' => 'La cantidad a devolver debe ser mayor a 0'], 400);
    if ($cantDevolver > (int)$row['cantidad']) responder(['error' => "No puedes devolver más de lo que tienes: {$row['cantidad']}"], 400);

    if ($cantDevolver < (int)$row['cantidad']) {
        // Devolución PARCIAL: se resta del registro original (que se queda
        // "en_poder" con el resto), y se crea uno nuevo aparte para la
        // parte que sí se está devolviendo ahora — así cada uno se rastrea
        // por separado, sin perder lo que aún se conserva.
        $pdo->prepare("UPDATE material_recogido SET cantidad = cantidad - ? WHERE id = ?")->execute([$cantDevolver, $id]);
        $pdo->prepare("
            INSERT INTO material_recogido (producto_id, ref, nombre, usuario, cantidad, tipo, motivo, estado, fecha)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'en_transito', NOW())
        ")->execute([$row['producto_id'], $row['ref'], $row['nombre'], $row['usuario'], $cantDevolver, $row['tipo'], $row['motivo']]);
        $idParaSeguimiento = (int)$pdo->lastInsertId();
    } else {
        // Devolución completa — el registro original se marca en camino.
        $pdo->prepare("UPDATE material_recogido SET estado='en_transito' WHERE id=?")->execute([$id]);
        $idParaSeguimiento = $id;
    }

    // Material recogido siempre va directo al almacén central — a
    // diferencia de ONT, aquí no hay paso intermedio por el municipio,
    // sin importar el rol de quien lo devuelve.
    $destinoRec = 'Almacen Central';

    try {
        $pdo->prepare("
            INSERT INTO envios_seguimiento
              (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, transportador, estado, notas, fecha_aprobado, fecha_envio)
            VALUES ('recogido', ?, ?, ?, ?, 'unidad', ?, ?, ?, ?, 'en_camino', ?, NOW(), NOW())
        ")->execute([
            $idParaSeguimiento, $row['ref'], $row['nombre'], $cantDevolver,
            $_SESSION['sede'], $destinoRec, $_SESSION['usuario'], $transportador, $notasUsuario,
        ]);
    } catch (\Throwable $e) {
        error_log('[devolver_recogido seguimiento] ' . $e->getMessage());
        responder(['error' => 'No se pudo iniciar el envío de devolución'], 500);
    }

    try {
        $pdo->prepare("
            INSERT INTO historial (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha, usuario_destino)
            VALUES (?, ?, 'Almacen Central', ?, 'unidad', ?, ?, 'aprobado', 0, 'devolucion', NOW(), ?)
        ")->execute([$row['ref'], $row['nombre'], $cantDevolver, $_SESSION['usuario'], "Devolución de material recogido — en camino al almacén", $_SESSION['usuario']]);
    } catch (\Throwable $e) {}

    auditar($pdo, 'devolver_recogido', 'productos', "Inició devolución de material recogido: {$row['nombre']} x{$cantDevolver}", $row['ref']);
    responder(['ok' => true]);
}

/* ══ DISTRIBUIR material recogido a otra persona directo ══
   Sin pasar por el almacén central — queda directo en la bolsa de la otra
   persona, con el rastro de quién se lo pasó a quién. Cualquiera con algo
   pendiente puede usarlo (incluido el distribuidor), hacia cualquier
   persona (incluido él mismo desde otra cuenta). */
if ($method === 'POST' && $action === 'distribuir_recogido') {
    sesionRequerida();
    $data      = json_decode(file_get_contents('php://input'), true);
    $id        = intval($data['id'] ?? 0);
    $destino   = trim($data['destino'] ?? '');
    if (!$id) responder(['error' => 'ID requerido'], 400);
    if (!$destino) responder(['error' => 'Elige a quién se lo vas a dar'], 400);
    if ($destino === $_SESSION['usuario']) responder(['error' => 'No puedes distribuirlo a ti mismo'], 400);

    $chkDestino = $pdo->prepare("SELECT usuario FROM usuarios WHERE usuario = ? AND estado = 'activo'");
    $chkDestino->execute([$destino]);
    if (!$chkDestino->fetch()) responder(['error' => 'Esa persona no existe o está inactiva'], 404);

    $mr = $pdo->prepare("SELECT * FROM material_recogido WHERE id = ? AND usuario = ?");
    $mr->execute([$id, $_SESSION['usuario']]);
    $row = $mr->fetch();
    if (!$row) responder(['error' => 'Registro no encontrado'], 404);
    if ($row['estado'] !== 'en_poder') responder(['error' => 'Ya fue usado o devuelto'], 400);
    if ($row['tipo'] !== 'reutilizable') responder(['error' => 'Lo dañado no se puede distribuir'], 400);

    // Pasa directo a la bolsa de la otra persona, con el mismo registro
    // (así queda como "en_poder" de ella, no como algo nuevo desde cero).
    $pdo->prepare("UPDATE material_recogido SET usuario = ?, motivo = ? WHERE id = ?")
        ->execute([$destino, trim(($row['motivo'] ? $row['motivo'].' — ' : '') . "Recibido de {$_SESSION['usuario']}"), $id]);

    try {
        $pdo->prepare("
            INSERT INTO historial (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha, usuario_destino)
            VALUES (?, ?, ?, ?, 'unidad', ?, ?, 'aprobado', 0, 'recogido_reutilizable', NOW(), ?)
        ")->execute([$row['ref'], $row['nombre'], $destino, $row['cantidad'], $_SESSION['usuario'], "Material recogido distribuido — de {$_SESSION['usuario']} a $destino", $destino]);
    } catch (\Throwable $e) {}

    auditar($pdo, 'distribuir_recogido', 'productos', "Distribuido material recogido: {$row['nombre']} x{$row['cantidad']} — de {$_SESSION['usuario']} a $destino", $row['ref']);
    responder(['ok' => true]);
}

/* ══ GASTAR material recogido (usarlo directo, no devolverlo) ══ */
if ($method === 'POST' && $action === 'gastar_recogido') {
    sesionRequerida();
    $data   = json_decode(file_get_contents('php://input'), true);
    $id     = intval($data['id'] ?? 0);
    $lugar  = trim($data['lugar'] ?? '');
    $cantidadPedida = isset($data['cantidad']) ? intval($data['cantidad']) : null;
    $lat = isset($data['lat']) && $data['lat'] !== '' ? floatval($data['lat']) : null;
    $lng = isset($data['lng']) && $data['lng'] !== '' ? floatval($data['lng']) : null;
    $proyectoCliente = trim($data['proyecto_cliente'] ?? '') ?: null;
    // Igual que en "pedidos/gastar": si viene de "Gasto múltiple", comparte
    // lote_id con los demás productos del lote, para el PDF combinado.
    $loteId = trim($data['lote_id'] ?? '') ?: null;
    if (!$id) responder(['error' => 'ID requerido'], 400);
    if (!$lugar) responder(['error' => 'El lugar de uso es requerido'], 400);

    $mr = $pdo->prepare("SELECT * FROM material_recogido WHERE id = ? AND usuario = ?");
    $mr->execute([$id, $_SESSION['usuario']]);
    $row = $mr->fetch();
    if (!$row) responder(['error' => 'Registro no encontrado'], 404);
    if ($row['estado'] !== 'en_poder') responder(['error' => 'Ya fue usado o devuelto'], 400);
    if (!empty($row['es_nuevo'])) responder(['error' => 'Este material aún no está en el catálogo: devuélvelo al almacén para que lo acepten.'], 400);
    if ($row['tipo'] !== 'reutilizable') responder(['error' => 'Lo dañado no se puede gastar'], 400);

    // Si no se especifica cantidad, se toma todo el registro (compatibilidad
    // con como funcionaba antes). Si se pide MENOS de lo que tiene, el
    // registro se reduce y sigue "en_poder" con lo que sobra — no hay que
    // gastarlo todo de una vez.
    $cantidadDisponible = (int)$row['cantidad'];
    $cantidadGastar = $cantidadPedida ?? $cantidadDisponible;
    if ($cantidadGastar <= 0) responder(['error' => 'La cantidad debe ser mayor a 0'], 400);
    if ($cantidadGastar > $cantidadDisponible) responder(['error' => "Solo tienes $cantidadDisponible disponibles de este registro"], 400);

    if ($cantidadGastar < $cantidadDisponible) {
        $pdo->prepare("UPDATE material_recogido SET cantidad = cantidad - ? WHERE id = ?")->execute([$cantidadGastar, $id]);
    } else {
        $pdo->prepare("UPDATE material_recogido SET estado='gastado' WHERE id=?")->execute([$id]);
    }

    try {
        $pdo->prepare("
            INSERT INTO historial (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha, usuario_destino, gps_lat, gps_lng, proyecto_cliente, pedido_agrupado_id)
            VALUES (?, ?, ?, ?, 'unidad', ?, ?, 'aprobado', 1, 'gasto_recogido', NOW(), ?, ?, ?, ?, ?)
        ")->execute([$row['ref'], $row['nombre'], $_SESSION['usuario'], $cantidadGastar, $_SESSION['usuario'], "Gasto de material recogido — Lugar: $lugar", $_SESSION['usuario'], $lat, $lng, $proyectoCliente, $loteId]);
    } catch (\Throwable $e) {}

    auditar($pdo, 'gastar_recogido', 'productos', "Gastado material recogido: {$row['nombre']} x{$row['cantidad']} en $lugar", $row['ref']);
    responder(['ok' => true]);
}

/* ══ LISTAR TODO el material recogido — vista general para admin/distribuidor ══
   A diferencia de "mi_material_recogido" (que cada quien ve solo lo suyo),
   esta trae de TODOS los usuarios, con filtros opcionales. */
if ($method === 'GET' && $action === 'material_recogido_admin') {
    rolOPermiso(['superadmin', 'distribuidor'], 'ver_reportes');

    $tipo    = trim($_GET['tipo']    ?? '');
    $estado  = trim($_GET['estado']  ?? '');
    $usuario = trim($_GET['usuario'] ?? '');

    $where  = ['1=1'];
    $params = [];
    if ($tipo)    { $where[] = 'tipo = ?';    $params[] = $tipo; }
    if ($estado)  { $where[] = 'estado = ?';  $params[] = $estado; }
    if ($usuario) { $where[] = 'usuario LIKE ?'; $params[] = "%$usuario%"; }

    $stmt = $pdo->prepare("SELECT * FROM material_recogido WHERE " . implode(' AND ', $where) . " ORDER BY fecha DESC");
    $stmt->execute($params);
    responder($stmt->fetchAll());
}

/* ══ DAR DE BAJA material dañado — solo admin/distribuidor ══
   Es la única acción posible sobre lo dañado (nunca se devuelve ni se
   gasta) — lo saca de la lista de pendientes de forma definitiva. */
if ($method === 'POST' && $action === 'dar_de_baja_recogido') {
    rolOPermiso(['superadmin', 'distribuidor'], 'ver_reportes');
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);

    $mr = $pdo->prepare("SELECT * FROM material_recogido WHERE id = ?");
    $mr->execute([$id]);
    $row = $mr->fetch();
    if (!$row) responder(['error' => 'Registro no encontrado'], 404);
    if ($row['tipo'] !== 'dañado') responder(['error' => 'Solo lo dañado se puede dar de baja'], 400);
    if (!in_array($row['estado'], ['en_poder', 'devuelto'])) responder(['error' => 'Ya no se puede dar de baja'], 400);
    if (!empty($row['stock_acreditado'])) responder(['error' => 'Ya se reincorporó al stock: no se puede dar de baja'], 400);

    $pdo->prepare("UPDATE material_recogido SET estado='dado_de_baja' WHERE id=?")->execute([$id]);
    auditar($pdo, 'dar_de_baja_recogido', 'productos', "Dado de baja: {$row['nombre']} x{$row['cantidad']} (de {$row['usuario']})", $row['ref']);
    responder(['ok' => true]);
}

/* ══ REINCORPORAR material dañado que resultó estar bien (ya devuelto y
   revisado) — se acredita al stock recuperado, admin/distribuidor. ══ */
if ($method === 'POST' && $action === 'reincorporar_recogido') {
    rolOPermiso(['superadmin', 'distribuidor'], 'ver_reportes');
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);

    $mr = $pdo->prepare("SELECT * FROM material_recogido WHERE id = ?");
    $mr->execute([$id]);
    $row = $mr->fetch();
    if (!$row) responder(['error' => 'Registro no encontrado'], 404);
    if ($row['tipo'] !== 'dañado') responder(['error' => 'Esta acción es solo para lo marcado como dañado'], 400);
    if ($row['estado'] !== 'devuelto') responder(['error' => 'Solo se puede reincorporar lo que ya llegó al almacén (devuelto)'], 400);
    if (!empty($row['stock_acreditado'])) responder(['error' => 'Ya fue reincorporado al stock'], 400);
    if (!empty($row['es_nuevo'])) responder(['error' => 'Es un producto nuevo: usa "Aceptar" para crearlo o sumarlo a uno existente'], 400);

    $prod = $pdo->prepare("SELECT id FROM productos WHERE ref = ?");
    $prod->execute([$row['ref']]);
    $p = $prod->fetch();
    if ($p) {
        $pdo->prepare("UPDATE productos SET stock_recuperado = stock_recuperado + ? WHERE id = ?")
            ->execute([$row['cantidad'], $p['id']]);
        $pdo->prepare("UPDATE material_recogido SET stock_acreditado = 1 WHERE id = ?")->execute([$id]);
    }
    auditar($pdo, 'reincorporar_recogido', 'productos', "Reincorporado al stock (revisado, sí servía): {$row['nombre']} x{$row['cantidad']}", $row['ref']);
    responder(['ok' => true]);
}

/* ══ INGRESAR AL ALMACÉN material recogido propio — solo superadmin/distribuidor ══
   Ellos ya están en el almacén: no hace falta transportador ni que otra persona reciba.
   - reutilizable: se suma de una vez al stock recuperado.
   - dañado: queda 'devuelto' para revisión (luego reincorporar o dar de baja).
   - nuevo / otro proveedor: queda 'devuelto' y se acepta después (crear producto o sumar a uno existente). */
if ($method === 'POST' && $action === 'ingresar_recogido_almacen') {
    sesionRequerida();
    if (!in_array($_SESSION['rol'] ?? '', ['superadmin', 'distribuidor'], true)) responder(['error' => 'Solo el almacén puede ingresar material directamente'], 403);
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);

    $mr = $pdo->prepare("SELECT * FROM material_recogido WHERE id = ? AND usuario = ?");
    $mr->execute([$id, $_SESSION['usuario']]);
    $row = $mr->fetch();
    if (!$row) responder(['error' => 'Registro no encontrado'], 404);
    if ($row['estado'] !== 'en_poder') responder(['error' => 'Ya fue ingresado, devuelto o usado'], 400);
    $cant = (int)$row['cantidad'];
    $esNuevo = !empty($row['es_nuevo']);

    if (!$esNuevo && $row['tipo'] === 'reutilizable') {
        $q = $pdo->prepare("SELECT id FROM productos WHERE ref = ?");
        $q->execute([$row['ref']]);
        $p = $q->fetch();
        if (!$p) responder(['error' => 'No se encontró el producto en el catálogo'], 404);
        $pdo->prepare("UPDATE productos SET stock_recuperado = stock_recuperado + ? WHERE id = ?")->execute([$cant, $p['id']]);
        $pdo->prepare("UPDATE material_recogido SET stock_acreditado = 1 WHERE id = ?")->execute([$id]);
    }
    $pdo->prepare("UPDATE material_recogido SET estado='devuelto', fecha_devolucion=NOW() WHERE id=?")->execute([$id]);

    try {
        $pdo->prepare("
            INSERT INTO historial (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha, usuario_destino)
            VALUES (?, ?, 'Almacen Central', ?, 'unidad', ?, ?, 'aprobado', 0, 'devolucion', NOW(), ?)
        ")->execute([$row['ref'], $row['nombre'], $cant, $_SESSION['usuario'], 'Material recogido ingresado directo al almacén por ' . $_SESSION['usuario'], $_SESSION['usuario']]);
    } catch (\Throwable $e) {}

    auditar($pdo, 'ingresar_recogido_almacen', 'productos', "Ingresó al almacén material recogido ({$row['tipo']}" . ($esNuevo ? ', nuevo' : '') . "): {$row['nombre']} x{$cant}", $row['ref']);
    responder(['ok' => true, 'es_nuevo' => $esNuevo, 'tipo' => $row['tipo'], 'cantidad' => $cant, 'nombre' => $row['nombre'], 'proveedor' => $row['proveedor_nuevo'] ?? '']);
}

/* ══ EDITAR material recogido registrado por error ══
   - Quien lo registró: mientras siga en su poder.
   - Admin/distribuidor: en su poder o ya recibido en el almacén (devuelto).
   Si es reutilizable y ya fue sumado al stock recuperado, se corrige ese stock
   (se resta del producto anterior y se suma al nuevo). */
if ($method === 'POST' && $action === 'editar_recogido') {
    sesionRequerida();
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);
    $mr = $pdo->prepare("SELECT * FROM material_recogido WHERE id = ?");
    $mr->execute([$id]);
    $row = $mr->fetch();
    if (!$row) responder(['error' => 'Registro no encontrado'], 404);

    $esAdmin = in_array($_SESSION['rol'] ?? '', ['superadmin', 'distribuidor'], true);
    $esDueno = ($row['usuario'] === $_SESSION['usuario']);
    $estado  = $row['estado'];
    $puede = ($esDueno && $estado === 'en_poder') || ($esAdmin && in_array($estado, ['en_poder', 'devuelto'], true));
    if (!$puede) responder(['error' => $estado === 'en_transito' ? 'Está en camino: corrígelo cuando llegue al almacén' : 'Ya no se puede editar este registro'], 400);

    $cant   = intval($data['cantidad'] ?? 0);
    $tipo   = $data['tipo'] ?? $row['tipo'];
    $motivo = trim($data['motivo'] ?? '');
    if ($cant < 1) responder(['error' => 'La cantidad debe ser mayor a 0'], 400);
    if (!in_array($tipo, ['reutilizable', 'dañado'], true)) responder(['error' => 'Tipo inválido'], 400);
    $esNuevo = !empty($row['es_nuevo']);

    if ($esNuevo) {
        $nom  = mb_substr(trim($data['nombre'] ?? ''), 0, 255);
        $prov = mb_substr(trim($data['proveedor'] ?? ''), 0, 150);
        if ($nom === '') responder(['error' => 'Escribe el nombre del producto'], 400);
        _proveedorAsegurar($pdo, $prov, $_SESSION['usuario'] ?? '');
        $pdo->prepare("UPDATE material_recogido SET nombre=?, proveedor_nuevo=?, cantidad=?, tipo=?, motivo=? WHERE id=?")
            ->execute([$nom, $prov ?: null, $cant, $tipo, $motivo ?: null, $id]);
        auditar($pdo, 'editar_recogido', 'productos', "Editó material recogido nuevo #{$id}: {$row['nombre']} x{$row['cantidad']} → $nom x$cant", $row['ref']);
        responder(['ok' => true]);
    }

    $refNuevo = trim($data['ref'] ?? $row['ref']);
    $q = $pdo->prepare("SELECT id, ref, nombre FROM productos WHERE ref = ?");
    $q->execute([$refNuevo]);
    $pNuevo = $q->fetch();
    if (!$pNuevo) responder(['error' => 'Producto no encontrado'], 404);

    // ¿Estas unidades ya están sumadas al stock recuperado? (se guarda en el registro)
    $acreditadoAntes = !empty($row['stock_acreditado']);
    if ($estado !== 'devuelto') {
        $acreditadoDespues = false;
    } elseif ($tipo === 'reutilizable') {
        $acreditadoDespues = true;                       // lo reutilizable recibido siempre cuenta
    } else {
        $acreditadoDespues = ($row['tipo'] === 'dañado') ? $acreditadoAntes : false; // dañado: solo si ya se reincorporó
    }
    // Mismo producto y sigue sumado: solo se ajusta la DIFERENCIA (ej. 20 → 15 resta 5)
    $mismoProd = ($pNuevo['ref'] === $row['ref']);
    $quitar = 0; $poner = 0;
    if ($acreditadoAntes && $acreditadoDespues && $mismoProd) {
        $delta = $cant - (int)$row['cantidad'];
        if ($delta < 0) $quitar = -$delta; else $poner = $delta;
    } else {
        if ($acreditadoAntes)   $quitar = (int)$row['cantidad'];
        if ($acreditadoDespues) $poner  = $cant;
    }
    if ($quitar > 0) {
        $st = $pdo->prepare("SELECT stock_recuperado FROM productos WHERE ref = ?");
        $st->execute([$row['ref']]);
        if ((int)$st->fetchColumn() < $quitar) {
            responder(['error' => 'Ese stock recuperado ya se usó; no se puede corregir desde aquí'], 400);
        }
    }
    $pdo->beginTransaction();
    try {
        if ($quitar > 0) {
            $pdo->prepare("UPDATE productos SET stock_recuperado = stock_recuperado - ? WHERE ref = ?")->execute([$quitar, $row['ref']]);
        }
        if ($poner > 0) {
            $pdo->prepare("UPDATE productos SET stock_recuperado = stock_recuperado + ? WHERE id = ?")->execute([$poner, $pNuevo['id']]);
        }
        $pdo->prepare("UPDATE material_recogido SET producto_id=?, ref=?, nombre=?, cantidad=?, tipo=?, motivo=?, stock_acreditado=? WHERE id=?")
            ->execute([$pNuevo['id'], $pNuevo['ref'], $pNuevo['nombre'], $cant, $tipo, $motivo ?: null, $acreditadoDespues ? 1 : 0, $id]);
        $pdo->commit();
    } catch (\Throwable $e) {
        $pdo->rollBack();
        error_log('[editar_recogido] ' . $e->getMessage());
        responder(['error' => 'No se pudo editar'], 500);
    }
    auditar($pdo, 'editar_recogido', 'productos', "Editó material recogido #{$id} (de {$row['usuario']}): {$row['nombre']} x{$row['cantidad']} ({$row['tipo']}) → {$pNuevo['nombre']} x$cant ($tipo)" . ($acreditadoAntes || $acreditadoDespues ? ' — stock recuperado corregido' : ''), $pNuevo['ref']);
    responder(['ok' => true]);
}

/* ══ ACEPTAR material recogido NUEVO / de otro proveedor — admin/distribuidor ══
   Ya llegó al almacén (estado 'devuelto'). Dos opciones:
   - modo 'existente': se suma al stock recuperado de un producto que ya existe.
   - modo 'nuevo': se crea el producto (con su proveedor) y queda en el stock recuperado. */
if ($method === 'POST' && $action === 'aceptar_recogido_nuevo') {
    rolOPermiso(['superadmin', 'distribuidor'], 'ver_reportes');
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    $modo = $data['modo'] ?? '';
    if (!$id) responder(['error' => 'ID requerido'], 400);

    $mr = $pdo->prepare("SELECT * FROM material_recogido WHERE id = ?");
    $mr->execute([$id]);
    $row = $mr->fetch();
    if (!$row || empty($row['es_nuevo'])) responder(['error' => 'Registro no encontrado o ya fue aceptado'], 404);
    if ($row['estado'] !== 'devuelto') responder(['error' => 'Solo se puede aceptar lo que ya llegó al almacén (devuelto)'], 400);
    $cant = (int)$row['cantidad'];

    if ($modo === 'existente') {
        $q = $pdo->prepare("SELECT id, ref, nombre FROM productos WHERE ref = ?");
        $q->execute([trim($data['ref'] ?? '')]);
        $p = $q->fetch();
        if (!$p) responder(['error' => 'Elige el producto de la lista'], 400);
    } elseif ($modo === 'nuevo') {
        $nombre = mb_substr(trim($data['nombre'] ?? ''), 0, 255);
        $prov   = mb_substr(trim($data['proveedor'] ?? ''), 0, 150);
        if ($nombre === '') responder(['error' => 'El nombre es obligatorio'], 400);
        $maxRef = $pdo->query("SELECT MAX(CAST(ref AS UNSIGNED)) FROM productos WHERE ref REGEXP '^[0-9]+$'")->fetchColumn();
        $sig = ($maxRef ? intval($maxRef) : 0) + 1;
        $refN = str_pad($sig, 3, '0', STR_PAD_LEFT);
        $chk = $pdo->prepare("SELECT id FROM productos WHERE ref = ?");
        while (true) { $chk->execute([$refN]); if (!$chk->fetch()) break; $sig++; $refN = str_pad($sig, 3, '0', STR_PAD_LEFT); }
        _proveedorAsegurar($pdo, $prov, $_SESSION['usuario'] ?? '');
        $pdo->prepare("INSERT INTO productos (ref, nombre, unidad, stock_neiva, stock_minimo, descripcion, proveedor, metros_por_unidad) VALUES (?, ?, 'unidad', 0, 0, '', ?, NULL)")
            ->execute([$refN, $nombre, $prov]);
        $pid = (int)$pdo->lastInsertId();
        $ins = $pdo->prepare("INSERT IGNORE INTO stock_sedes (producto_id, sede_id, cantidad) VALUES (?, ?, 0)");
        foreach ($pdo->query("SELECT id FROM sedes WHERE tipo = 'municipio' AND activa = 1")->fetchAll() as $sd) $ins->execute([$pid, $sd['id']]);
        $p = ['id' => $pid, 'ref' => $refN, 'nombre' => $nombre];
    } else {
        responder(['error' => 'Modo inválido'], 400);
    }

    $pdo->prepare("UPDATE productos SET stock_recuperado = stock_recuperado + ? WHERE id = ?")->execute([$cant, $p['id']]);
    $pdo->prepare("UPDATE material_recogido SET es_nuevo = 0, stock_acreditado = 1, producto_id = ?, ref = ?, nombre = ? WHERE id = ?")
        ->execute([$p['id'], $p['ref'], $p['nombre'], $id]);
    auditar($pdo, 'aceptar_recogido_nuevo', 'productos', ($modo === 'nuevo' ? 'Producto creado desde material recogido' : 'Sumado a producto existente') . ": {$p['nombre']} (Ref {$p['ref']}) x{$cant}", $p['ref']);
    responder(['ok' => true, 'ref' => $p['ref'], 'nombre' => $p['nombre'], 'creado' => $modo === 'nuevo']);
}

/* ══ CAMBIAR TIPO de material recogido (reutilizable ↔ dañado) —
   admin/distribuidor puede corregir la clasificación después de
   revisarlo físicamente, si lo que reportó el técnico no coincide con
   lo que de verdad llegó. ══ */
if ($method === 'POST' && $action === 'cambiar_tipo_recogido') {
    rolOPermiso(['superadmin', 'distribuidor'], 'ver_reportes');
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);

    $mr = $pdo->prepare("SELECT * FROM material_recogido WHERE id = ?");
    $mr->execute([$id]);
    $row = $mr->fetch();
    if (!$row) responder(['error' => 'Registro no encontrado'], 404);
    if (!in_array($row['estado'], ['en_poder', 'devuelto'])) {
        responder(['error' => 'Ya no se puede cambiar — este registro ya se gastó o se dio de baja'], 400);
    }

    $nuevoTipo = $row['tipo'] === 'dañado' ? 'reutilizable' : 'dañado';
    $cantMR = (int)$row['cantidad'];
    $ajusteStock = '';
    // Si ya llegó al almacén (devuelto) y es un producto del catálogo, el stock recuperado se
    // ajusta igual que con Reincorporar: reutilizable suma; pasarlo a dañado resta lo ya sumado.
    if ($row['estado'] === 'devuelto' && empty($row['es_nuevo'])) {
        if ($nuevoTipo === 'reutilizable' && empty($row['stock_acreditado'])) {
            $pdo->prepare("UPDATE productos SET stock_recuperado = stock_recuperado + ? WHERE ref = ?")->execute([$cantMR, $row['ref']]);
            $pdo->prepare("UPDATE material_recogido SET stock_acreditado = 1 WHERE id = ?")->execute([$id]);
            $ajusteStock = ' — sumado al stock recuperado';
        } elseif ($nuevoTipo === 'dañado' && !empty($row['stock_acreditado'])) {
            $st = $pdo->prepare("SELECT stock_recuperado FROM productos WHERE ref = ?");
            $st->execute([$row['ref']]);
            if ((int)$st->fetchColumn() < $cantMR) responder(['error' => 'Ese stock recuperado ya se usó; no se puede pasar a dañado'], 400);
            $pdo->prepare("UPDATE productos SET stock_recuperado = stock_recuperado - ? WHERE ref = ?")->execute([$cantMR, $row['ref']]);
            $pdo->prepare("UPDATE material_recogido SET stock_acreditado = 0 WHERE id = ?")->execute([$id]);
            $ajusteStock = ' — restado del stock recuperado';
        }
    }
    $pdo->prepare("UPDATE material_recogido SET tipo = ? WHERE id = ?")->execute([$nuevoTipo, $id]);

    auditar($pdo, 'cambiar_tipo_recogido', 'productos', "Cambió la clasificación de {$row['nombre']} x{$row['cantidad']} de \"{$row['tipo']}\" a \"$nuevoTipo\"$ajusteStock", $row['ref']);
    responder(['ok' => true, 'nuevo_tipo' => $nuevoTipo]);
}

/* ══ AUDITORÍA DE INVENTARIO FÍSICO — qué tiene una persona según el
   sistema. Solo lo que se puede contar en campo (productos normales,
   no ONT/fibra que ya tienen su propia trazabilidad individual). ══ */
if ($method === 'GET' && $action === 'auditoria_persona') {
    rolOPermiso(['superadmin'], 'auditar_inventario');
    $usuario = trim($_GET['usuario'] ?? '');
    if (!$usuario) responder(['error' => 'Falta el usuario'], 400);

    $stmt = $pdo->prepare("
        SELECT p.ref, p.nombre, p.unidad, p.metros_por_unidad, su.cantidad
        FROM stock_usuarios su
        JOIN productos p ON p.id = su.producto_id
        WHERE su.usuario = ? AND su.cantidad > 0
        ORDER BY p.nombre
    ");
    $stmt->execute([$usuario]);
    $filas = array_map(function($r){
        return [
            'ref'             => $r['ref'],
            'nombre'          => $r['nombre'],
            'unidad'          => $r['unidad'],
            'metrosPorUnidad' => $r['metros_por_unidad'] !== null ? (float)$r['metros_por_unidad'] : null,
            'cantidadSistema' => (float)$r['cantidad'],
        ];
    }, $stmt->fetchAll());
    responder($filas);
}

/* ══ STOCK POR USUARIO — lo que tiene cada persona/oficina ahora mismo (para el Excel general) ══
   Productos por rollo: se cuentan rollos físicos (uno empezado cuenta como 1). */
if ($method === 'GET' && $action === 'stock_por_usuario') {
    rolOPermiso(['superadmin', 'distribuidor'], 'ver_reportes');
    $stmt = $pdo->query("
        SELECT su.usuario, u.nombre AS u_nombre, u.apellido AS u_apellido, u.rol, s.nombre AS sede,
               p.id AS producto_id, p.ref, p.nombre AS producto, p.unidad, p.metros_por_unidad, su.cantidad
        FROM stock_usuarios su
        JOIN productos p ON p.id = su.producto_id
        LEFT JOIN usuarios u ON u.usuario = su.usuario
        LEFT JOIN sedes s ON s.id = u.sede_id
        WHERE su.cantidad > 0
        ORDER BY u.rol, s.nombre, su.usuario, p.nombre
    ");
    $rows = $stmt->fetchAll();
    $rollos = [];
    try {
        $rq = $pdo->query("SELECT producto_id, usuario_actual, COUNT(*) AS n FROM producto_rollos WHERE usuario_actual IS NOT NULL AND estado = 'disponible' AND (metros - metros_usados) > 0 GROUP BY producto_id, usuario_actual");
        foreach ($rq->fetchAll() as $r) $rollos[$r['producto_id'] . '|' . $r['usuario_actual']] = (int)$r['n'];
    } catch (\Throwable $e) {}
    $out = [];
    foreach ($rows as $r) {
        $porRollo = !empty($r['metros_por_unidad']);
        $out[] = [
            'usuario'  => $r['usuario'],
            'nombre'   => trim(($r['u_nombre'] ?? '') . ' ' . ($r['u_apellido'] ?? '')),
            'rol'      => $r['rol'] ?? '',
            'sede'     => $r['sede'] ?? '',
            'ref'      => $r['ref'],
            'producto' => $r['producto'],
            'cantidad' => $porRollo ? ($rollos[$r['producto_id'] . '|' . $r['usuario']] ?? 0) : (float)$r['cantidad'],
            'unidad'   => $porRollo ? 'Rollos' : (($r['unidad'] ?? '') === 'metros' ? 'Metros' : 'Unidades'),
        ];
    }
    responder($out);
}

/* ══ MIS ROLLOS de un producto por rollo — para elegir de cuál sacar
   al gastar, cuando hay más de uno asignado a la misma persona ══ */
if ($method === 'GET' && $action === 'mis_rollos') {
    sesionRequerida();
    $ref = trim($_GET['ref'] ?? '');
    if (!$ref) responder(['error' => 'Producto requerido'], 400);
    $prodR = $pdo->prepare("SELECT id FROM productos WHERE ref = ?");
    $prodR->execute([$ref]);
    $pId = $prodR->fetchColumn();
    if (!$pId) responder(['error' => 'Producto no encontrado'], 404);

    $stmt = $pdo->prepare("
        SELECT id, codigo, metros, metros_usados, (metros - metros_usados) AS metros_disponibles, fecha
        FROM producto_rollos
        WHERE producto_id = ? AND usuario_actual = ? AND estado = 'disponible' AND (metros - metros_usados) > 0
        ORDER BY fecha ASC
    ");
    $stmt->execute([$pId, $_SESSION['usuario'] ?? '']);
    responder($stmt->fetchAll());
}

/* ══ ROLLOS DISPONIBLES en una sede — para elegir cuál enviar
   específicamente, cuando hay más de uno (ej: varios rollos de Drop en
   el almacén central) ══ */
if ($method === 'GET' && $action === 'rollos_disponibles') {
    sesionRequerida();
    $ref  = trim($_GET['ref'] ?? '');
    $sede = trim($_GET['sede'] ?? 'Almacen Central');
    if (!$ref) responder(['error' => 'Producto requerido'], 400);
    $prodR = $pdo->prepare("SELECT id FROM productos WHERE ref = ?");
    $prodR->execute([$ref]);
    $pId = $prodR->fetchColumn();
    if (!$pId) responder(['error' => 'Producto no encontrado'], 404);

    // "Disponible en una sede" = sin dueño personal (usuario_actual NULL)
    // y en esa sede — igual criterio que el stock central de siempre.
    $stmt = $pdo->prepare("
        SELECT id, codigo, metros, metros_usados, (metros - metros_usados) AS metros_disponibles, fecha
        FROM producto_rollos
        WHERE producto_id = ? AND sede_nombre = ? AND usuario_actual IS NULL
          AND estado = 'disponible' AND (metros - metros_usados) > 0
        ORDER BY fecha ASC
    ");
    $stmt->execute([$pId, $sede]);
    responder($stmt->fetchAll());
}
/* ══ ASIGNAR material a otra persona — transfiere la propiedad real
   (no es un préstamo temporal): sale de TU inventario personal (no del
   almacén central), pasa por Seguimiento como cualquier envío, y queda
   completamente a cargo de quien lo recibe — puede gastarlo o devolverlo
   normalmente, como si se lo hubieran enviado desde cualquier otro lado.
   Sirve tanto para que un municipio reparta entre sus técnicos, como para
   que un técnico "líder" (el que solicitó) reparta a sus compañeros. ══ */
if ($method === 'POST' && $action === 'asignar_a_persona') {
    sesionRequerida(); noAsignaDistribuidor();
    // "Asignar a alguien" (individual o dentro de "Asignar Multiple") usa el
    // mismo permiso que "Enviar material" — antes no se validaba nada aquí,
    // así que quitarle el permiso a alguien en su cuenta no le impedía
    // seguir asignando directo desde la API.
    // Municipio/Técnico/Persona siempre pueden asignar, sin depender de
    // permisos guardados — solo otros roles (ej. distribuidor) necesitan
    // el permiso "enviar_material".
    rolOPermiso(['superadmin','municipio','tecnico','persona'], 'enviar_material');
    $data     = json_decode(file_get_contents('php://input'), true);
    $ref      = trim($data['ref'] ?? '');
    $cantidad = floatval($data['cantidad'] ?? 0);
    $aQuien   = trim($data['a_quien'] ?? '');
    if (!destinoAsignablePorMi($pdo, $aQuien)) responder(['error' => 'No puedes asignarle material al distribuidor ni al administrador; para enviárselo usa "Devolver".'], 403);
    $nota     = trim($data['nota'] ?? '');
    $usuario  = $_SESSION['usuario'];
    // Cuando el frontend asigna VARIOS productos de una ("Asignar Multiple"),
    // llama esta misma acción una vez por producto — si cada una mandara su
    // propio correo, al destinatario le llegarían separados en vez de uno
    // solo con toda la lista. En ese caso el frontend manda
    // silenciar_correo=true y, al terminar todas las llamadas, pide UN
    // correo combinado vía "notificar_asignacion_multiple" (ver abajo).
    $silenciarCorreo = !empty($data['silenciar_correo']);
    // Si viene de "Asignar Multiple", todos los productos del mismo lote
    // comparten este id en las notas — así, en Seguimiento, aparecen
    // agrupados en una sola tarjeta con un solo "Confirmar recibido" para
    // todos, en vez de uno separado por cada producto (igual que ya pasa
    // con "Devolver múltiple" y "Gasto múltiple").
    $loteIdAsig = trim($data['lote_id'] ?? '');

    if (!$ref || $cantidad <= 0) responder(['error' => 'Datos incompletos'], 400);
    if (!$aQuien) responder(['error' => 'Elige a quién se lo asignas'], 400);
    if ($aQuien === $usuario) responder(['error' => 'No puedes asignarte algo a ti mismo'], 400);

    $prod = $pdo->prepare("SELECT * FROM productos WHERE ref = ?");
    $prod->execute([$ref]);
    $p = $prod->fetch();
    if (!$p) responder(['error' => 'Producto no encontrado'], 404);

    // Si es "por rollo" y se eligieron rollos ESPECÍFICOS (uno o varios
    // completos, no metros sueltos), se valida que sean tuyos — se
    // transfieren esos mismos, con su identidad, igual que "devolver".
    $rolloIds = array_filter(array_map('intval', (array)($data['rollo_ids'] ?? [])));
    if ($rolloIds) {
        $ph = implode(',', array_fill(0, count($rolloIds), '?'));
        $rollosChk = $pdo->prepare("SELECT id, metros, metros_usados FROM producto_rollos WHERE id IN ($ph) AND producto_id = ? AND usuario_actual = ?");
        $rollosChk->execute([...$rolloIds, $p['id'], $usuario]);
        $filasRollos = $rollosChk->fetchAll();
        if (count($filasRollos) !== count($rolloIds)) responder(['error' => 'Uno o más rollos no son tuyos o no existen'], 404);
        // La cantidad real a transferir es lo que de verdad queda
        // disponible en ESOS rollos elegidos (metros - metros_usados de
        // cada uno), NO el acumulado "en bolsa" del usuario
        // (stockUsuarioObtener) — ese total puede quedar desfasado
        // respecto a los rollos físicos, y comparar contra él rechazaba
        // asignaciones válidas (ej: "Tienes: 98" aunque el rollo elegido
        // sí tuviera esos 98 m disponibles). Se recalcula aquí en vez de
        // confiar en lo que mandó el navegador, para blindarlo también
        // contra cualquier redondeo del lado del cliente.
        $cantidad = 0.0;
        foreach ($filasRollos as $fr) {
            $cantidad += max(0, floatval($fr['metros']) - floatval($fr['metros_usados']));
        }
        if ($cantidad <= 0) responder(['error' => 'Ese rollo ya no tiene metros disponibles'], 400);
    } else {
        $stockActual = stockUsuarioObtener($pdo, $p['id'], $usuario);
        if ($cantidad > $stockActual) {
            responder(['error' => "No tienes esa cantidad disponible. Tienes: $stockActual"], 400);
        }
    }

    $destU = $pdo->prepare("SELECT s.nombre AS sede FROM usuarios u LEFT JOIN sedes s ON u.sede_id = s.id WHERE u.usuario = ?");
    $destU->execute([$aQuien]);
    $sedeDestino = $destU->fetchColumn();
    if (!$sedeDestino) responder(['error' => 'Ese usuario no existe o no tiene sede'], 404);

    // Sale de tu inventario AHORA (ya no lo tienes físicamente) — queda
    // "en camino" hasta que la otra persona confirme que lo recibió.
    stockUsuarioAjustar($pdo, $p['id'], $usuario, -$cantidad);

    // Si eran rollos completos elegidos a propósito, salen de tu lista
    // AHORA MISMO (quedan "en_transito") — si no, el receptor recibe
    // rollo(s) genéricos nuevos reconstruidos de los metros recibidos
    // (igual que cualquier otro envío "por rollo").
    $notaRollo = '';
    if ($rolloIds) {
        $ph2 = implode(',', array_fill(0, count($rolloIds), '?'));
        $pdo->prepare("UPDATE producto_rollos SET estado = 'en_transito', usuario_actual = NULL WHERE id IN ($ph2)")->execute($rolloIds);
        $notaRollo = "\nRollos elegidos: " . implode(',', $rolloIds);
    }
    if ($loteIdAsig) $notaRollo .= "\nLote: $loteIdAsig";

    try {
        $pdo->prepare("
            INSERT INTO envios_seguimiento
              (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, transportador, estado, notas, fecha_aprobado, fecha_envio)
            VALUES ('asignacion', NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'en_camino', ?, NOW(), NOW())
        ")->execute([
            $p['ref'], $p['nombre'], $cantidad, $p['unidad'] ?? 'unidad',
            $_SESSION['sede'] ?? '', $sedeDestino, $usuario, $usuario,
            "Asignación directa a $aQuien" . ($nota ? " — $nota" : '') . "\nRecoge en persona: $aQuien" . $notaRollo,
        ]);
        $idEnvioAsig = (int)$pdo->lastInsertId();
        $estadoCorreoAsig = 'silenciado';
        if (!$silenciarCorreo) {
            try { $estadoCorreoAsig = notificarAsignacionDirecta($pdo, $idEnvioAsig); }
            catch (\Throwable $e) { error_log('[productos/asignar_a_persona notificar] ' . $e->getMessage()); $estadoCorreoAsig = 'fallo'; }
        }
    } catch (\Throwable $e) {
        error_log('[productos/asignar_a_persona] ' . $e->getMessage());
        stockUsuarioAjustar($pdo, $p['id'], $usuario, $cantidad);
        if ($rolloIds) {
            $phR = implode(',', array_fill(0, count($rolloIds), '?'));
            $pdo->prepare("UPDATE producto_rollos SET estado = 'disponible', usuario_actual = ? WHERE id IN ($phR)")->execute([$usuario, ...$rolloIds]);
        }
        responder(['error' => 'No se pudo iniciar la asignación'], 500);
    }

    auditar($pdo, 'asignar_a_persona', 'productos', "Asignó {$p['nombre']} x{$cantidad} a $aQuien", $p['ref']);
    responder(['ok' => true, 'envio_id' => $idEnvioAsig, 'correo' => $estadoCorreoAsig ?? 'silenciado']);
}

/* ══ Correo ÚNICO para una asignación de VARIOS productos de una vez ══
   Se llama una sola vez, después de que "Asignar Multiple" terminó de
   crear todos los envíos (cada uno con silenciar_correo=true) — junta
   todos esos productos en un solo correo al destinatario, en vez de uno
   por producto. ══ */
if ($method === 'POST' && $action === 'notificar_asignacion_multiple') {
    sesionRequerida();
    $data     = json_decode(file_get_contents('php://input'), true);
    $envioIds = array_values(array_filter(array_map('intval', (array)($data['envio_ids'] ?? []))));
    if (!$envioIds) responder(['ok' => true]);
    $estadoCorreoM = 'fallo';
    try {
        require_once 'notificaciones.php';
        $estadoCorreoM = notificarAsignacionDirectaMultiple($pdo, $envioIds, $_SESSION['usuario'] ?? '');
    } catch (\Throwable $e) {
        error_log('[productos/notificar_asignacion_multiple] ' . $e->getMessage());
    }
    responder(['ok' => true, 'correo' => $estadoCorreoM]);
}

responder(['error' => 'Acción no reconocida'], 400);