<?php
require 'config.php';
require_once 'auditoria.php';
require_once 'notificaciones.php';
sesionRequerida();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ══ LISTAR pedidos ══════════════════════════════════════ */
if ($method === 'GET' && $action === 'listar') {
    $rol = $_SESSION['rol'] ?? '';
    try {
        // Superadmin, distribuidor y quien tenga el permiso de aprobar/gestionar
        // pedidos ven TODOS los pedidos; los demás solo los suyos.
        if ($rol === 'superadmin' || $rol === 'distribuidor'
            || usuarioTienePermiso('aprobar_pedidos') || usuarioTienePermiso('gestionar_pedidos')) {
            $stmt = $pdo->query("
                SELECT pm.*, u.sede AS sede_actual
                FROM pedidos_municipio pm
                LEFT JOIN usuarios u ON u.usuario = pm.solicitado_por
                ORDER BY pm.fecha DESC
            ");
        } else {
            $usuario = $_SESSION['usuario'] ?? '';
            $stmt = $pdo->prepare("
                SELECT pm.*, u.sede AS sede_actual
                FROM pedidos_municipio pm
                LEFT JOIN usuarios u ON u.usuario = pm.solicitado_por
                WHERE pm.solicitado_por = ?
                ORDER BY pm.fecha DESC
            ");
            $stmt->execute([$usuario]);
        }
        responder($stmt->fetchAll());
    } catch (\Throwable $e) {
        responder([]);
    }
}

/* ══ CREAR pedido (municipio/técnico) ═══════════════════ */
if ($method === 'POST' && $action === 'crear') {
    // "Pedidos directos" es exclusivo de municipio/técnico/persona — el
    // distribuidor (o quien tenga permiso) usa "Solicitudes" en su lugar.
    if (!in_array($_SESSION['rol'] ?? '', ['municipio','tecnico','persona'])) {
        responder(['error' => 'Los pedidos directos son solo para municipios, técnicos y personas. Usa Solicitudes.'], 403);
    }
    $d     = json_decode(file_get_contents('php://input'), true);
    $ref   = trim($d['ref']   ?? '');
    $nom   = trim($d['nombre']?? '');
    $cant  = intval($d['cantidad'] ?? 0);
    $unidad= $d['unidadPedido'] ?? 'unidad';
    $just  = trim($d['justificacion'] ?? '');
    $mun   = $_SESSION['sede'];
    if (!$ref || !$nom || $cant < 1) responder(['error' => 'Datos inválidos'], 400);
    if ($cant > 10000) responder(['error' => 'Cantidad fuera de rango permitido'], 400);

    // Las ONT solo las puede solicitar la oficina (municipio) o el
    // distribuidor — nunca técnico/persona directamente (ellos la reciben
    // ya asignada por su oficina).
    if (stripos($ref, 'ONT::') === 0 && !in_array($_SESSION['rol'] ?? '', ['municipio','distribuidor'])) {
        responder(['error' => 'Solo tu oficina (municipio) puede solicitar ONTs — pídesela a ellos y ellos te la asignan.'], 403);
    }

    // Validar que el producto exista (evita pedidos fantasma)
    // ONT (ref tipo "ONT::modelo") y FIBRA no viven en la tabla productos,
    // así que se exentan de esta validación.
    if ($ref !== 'FIBRA' && stripos($ref, 'ONT::') !== 0) {
        $checkProd = $pdo->prepare("SELECT id FROM productos WHERE ref = ?");
        $checkProd->execute([$ref]);
        if (!$checkProd->fetch()) responder(['error' => 'Producto no encontrado'], 404);
    }

    try {
        // Detectar el nombre real de la columna de justificación/nota en la tabla,
        // ya que en algunas instalaciones se llama 'justificacion' y en otras 'nota'.
        // Nota: SHOW COLUMNS ... LIKE ? no admite parámetros vinculados, por eso
        // listamos todas las columnas y comprobamos en PHP.
        $colsTabla = $pdo->query("SHOW COLUMNS FROM pedidos_municipio")->fetchAll(PDO::FETCH_COLUMN);
        $colJust = null;
        foreach (['justificacion', 'nota', 'justificación'] as $cand) {
            if (in_array($cand, $colsTabla, true)) { $colJust = $cand; break; }
        }

        if ($colJust) {
            $sql = "INSERT INTO pedidos_municipio
                (ref,nombre,municipio,cantidad,unidad_pedido,solicitado_por,`$colJust`,estado,fecha)
                VALUES (?,?,?,?,?,?,?,'pendiente',NOW())";
            $pdo->prepare($sql)->execute([$ref,$nom,$mun,$cant,$unidad,$_SESSION['usuario'],$just]);
        } else {
            // La tabla no tiene columna de justificación: insertar sin ella.
            $sql = "INSERT INTO pedidos_municipio
                (ref,nombre,municipio,cantidad,unidad_pedido,solicitado_por,estado,fecha)
                VALUES (?,?,?,?,?,?,'pendiente',NOW())";
            $pdo->prepare($sql)->execute([$ref,$nom,$mun,$cant,$unidad,$_SESSION['usuario']]);
        }
        $id = $pdo->lastInsertId();
    } catch (\Throwable $e) {
        error_log('[pedidos/crear] ' . $e->getMessage());
        $esProd = ($_ENV['APP_ENV'] ?? 'local') === 'production';
        responder(['error' => 'No se pudo crear el pedido' . ($esProd ? '' : ': ' . $e->getMessage())], 500);
    }

    try {
        $unidadLbl = $unidad === 'metros' ? 'mts.' : 'uds.';
        notificarNuevoPedidoAdmin(
            $pdo, $_SESSION['usuario'], $mun,
            "{$cant} {$unidadLbl} de \"{$nom}\"" . ($just ? " — Nota: {$just}" : ''),
            'pedidosmun'
        );
    } catch (\Throwable $e) { error_log('[pedidos/crear notif] '.$e->getMessage()); }

    auditar($pdo, 'crear_pedido', 'pedidos_municipio', "Solicitó {$cant} {$unidad} de \"{$nom}\"" . ($just ? " — $just" : ''), (string)$id);
    responder(['ok'=>true,'id'=>$id]);
}

/* ══ APROBAR DIRECTO (superadmin sin pasar por Neiva) ══ */
if ($method === 'POST' && $action === 'aprobar_directo') {
    rolOPermiso(['superadmin'], 'aprobar_pedidos');
    $d    = json_decode(file_get_contents('php://input'), true);
    $id   = $d['id'] ?? '';
    $nota = trim($d['observacion'] ?? $d['nota'] ?? '');
    if (!$id) responder(['error' => 'ID requerido'], 400);

    $ped = $pdo->prepare("SELECT * FROM pedidos_municipio WHERE id=?");
    $ped->execute([$id]);
    $s = $ped->fetch();
    if (!$s) responder(['error' => 'Pedido no encontrado'], 404);
    if ($s['estado'] !== 'pendiente' && $s['estado'] !== 'en_gestion')
        responder(['error' => 'El pedido ya fue procesado'], 400);

    $esOntOFibra = ($s['ref'] === 'FIBRA' || stripos($s['ref'], 'ONT::') === 0);
    if ($esOntOFibra) {
        // ONT y fibra no viven en la tabla productos ni controlan su stock por stock_neiva;
        // se usa un producto "virtual" para no bloquear la aprobación.
        $p = ['ref' => $s['ref'], 'nombre' => $s['nombre'], 'unidad' => $s['unidad_pedido'] ?? 'unidad', 'stock_neiva' => 999999];
    } else {
        $prod = $pdo->prepare("SELECT * FROM productos WHERE ref=?");
        $prod->execute([$s['ref']]);
        $p = $prod->fetch();
        if (!$p) responder(['error' => 'Producto no encontrado'], 404);
    }

    $cant = intval($s['cantidad']);

    // NO descontar stock aquí — se descuenta cuando se marque "en camino" en seguimiento

    // Marcar pedido como atendido (guarda la observación del admin, si
    // escribió una, en la misma columna "motivo" que usa el rechazo —
    // así queda visible junto con el pedido sin importar si se aprobó o
    // se rechazó).
    $pcolsAprob = $pdo->query("SHOW COLUMNS FROM pedidos_municipio")->fetchAll(PDO::FETCH_COLUMN);
    $setAprob = ["estado='atendido'", "fecha_respuesta=NOW()"];
    $paramsAprob = [];
    if ($nota !== '' && in_array('motivo', $pcolsAprob)) { $setAprob[] = "motivo=?"; $paramsAprob[] = $nota; }
    $paramsAprob[] = $id;
    $pdo->prepare("UPDATE pedidos_municipio SET " . implode(', ', $setAprob) . " WHERE id=?")->execute($paramsAprob);

    // Crear registro en seguimiento
    // Resetear cualquier seguimiento previo para este pedido (sin importar estado)
    $segExiste = $pdo->prepare("SELECT id, estado FROM envios_seguimiento WHERE tipo='pedido' AND referencia_id=? ORDER BY id DESC LIMIT 1");
    $segExiste->execute([$id]);
    $segRow = $segExiste->fetch();
    if ($segRow) {
        if ($segRow['estado'] === 'en_camino') {
            $pdo->prepare("UPDATE productos SET stock_neiva = stock_neiva + ? WHERE ref=?")
                ->execute([$cant, $p['ref']]);
        }
        $pdo->prepare("UPDATE envios_seguimiento SET estado='aprobado', ref_producto=?, nombre_producto=?, cantidad=?, unidad=?, origen='Almacen Central', destino=?, enviado_por=?, fecha_aprobado=NOW(), transportador=NULL, fecha_envio=NULL, notas=? WHERE id=?")
            ->execute([$p['ref'], $p['nombre'], $cant, $s['unidad_pedido'] ?? 'unidad', $s['municipio'], $_SESSION['usuario'], $nota, $segRow['id']]);
    } else {
        $pdo->prepare("
            INSERT INTO envios_seguimiento
              (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, estado, notas, fecha_aprobado)
            VALUES ('pedido', ?, ?, ?, ?, ?, 'Almacen Central', ?, ?, 'aprobado', ?, NOW())
        ")->execute([
            $id, $p['ref'], $p['nombre'], $cant,
            $s['unidad_pedido'] ?? 'unidad',
            $s['municipio'],
            $_SESSION['usuario'],
            $nota
        ]);
    }

    auditar($pdo, 'aprobar_directo', 'pedidos', "Pedido aprobado: {$s['nombre']} × {$cant} → {$s['municipio']}" . ($nota ? " ($nota)" : ''), $s['ref']);
    require_once __DIR__ . '/ont_compromiso_lib.php';
    responder(['ok'=>true, 'municipio'=>$s['municipio'], 'producto'=>$s['nombre'], 'cantidad'=>$cant, 'aviso'=>ontAvisoCompromiso($pdo, (string)($p['ref'] ?? $s['ref'] ?? ''))]);
}

/* ══ ATENDER (distribuidor pasa a superadmin) ══════════ */
if ($method === 'POST' && $action === 'atender') {
    // Solo superadmin aprueba/atiende — distribuidor únicamente despacha
    // lo que ya fue aprobado (desde Seguimiento), nunca decide qué se aprueba.
    rolRequerido('superadmin');
    $d  = json_decode(file_get_contents('php://input'), true);
    $id = $d['id'] ?? '';
    if (!$id) responder(['error' => 'ID requerido'], 400);

    try {
        $ped = $pdo->prepare("SELECT * FROM pedidos_municipio WHERE id=?");
        $ped->execute([$id]);
        $s = $ped->fetch();
        if (!$s) responder(['error' => 'Pedido no encontrado'], 404);

        $esOntOFibra = ($s['ref'] === 'FIBRA' || stripos($s['ref'], 'ONT::') === 0);
        if ($esOntOFibra) {
            // ONT y fibra no viven en la tabla productos ni controlan su stock por stock_neiva;
            // se usa un producto "virtual" para no bloquear ni rechazar por error.
            $p = ['ref' => $s['ref'], 'nombre' => $s['nombre'], 'unidad' => $s['unidad_pedido'] ?? 'unidad', 'stock_neiva' => 999999];
        } else {
            $prod = $pdo->prepare("SELECT * FROM productos WHERE ref=?");
            $prod->execute([$s['ref']]);
            $p = $prod->fetch();
            if (!$p) responder(['error' => 'Producto no encontrado'], 404);
        }

        $cant = intval($s['cantidad']);

        // Verificar stock
        if ($cant > intval($p['stock_neiva'])) {
            $motivo = "Stock insuficiente. Disponible: {$p['stock_neiva']}";
            $pdo->prepare("UPDATE pedidos_municipio SET estado='rechazado',motivo=?,rechazado_por='Sistema',fecha_respuesta=NOW() WHERE id=?")
                ->execute([$motivo, $id]);
            responder(['ok'=>true,'estado'=>'rechazado','motivo'=>$motivo]);
        }

        // Marcar en gestión y crear solicitud al superadmin
        $pdo->prepare("UPDATE pedidos_municipio SET estado='en_gestion',fecha_respuesta=NOW() WHERE id=?")
            ->execute([$id]);

        // Detectar columnas existentes en solicitudes para insertar solo las válidas.
        $cols = $pdo->query("SHOW COLUMNS FROM solicitudes")->fetchAll(PDO::FETCH_COLUMN);
        $solId = uniqid('sol_', true);
        // Todos los valores candidatos; solo se insertan los que tengan columna en la tabla.
        $valores = [
            'id'              => $solId,
            'ref'             => $s['ref'],
            'nombre'          => $s['nombre'],
            'destino'         => $s['municipio'],
            'cantidad'        => $cant,
            'unidad_envio'    => $s['unidad_pedido'] ?? 'unidad',
            'solicitado_por'  => $s['solicitado_por'],
            'gestionado_por'  => $_SESSION['usuario'],
            'estado'          => 'en_gestion',
            'nota'            => "Atendido por {$_SESSION['usuario']} — pedido de {$s['solicitado_por']} ({$s['municipio']})",
            'origen_pedido_id'=> $id,
        ];
        // Filtrar solo las columnas que existen realmente en la tabla.
        $insCols = [];
        $insPlace = [];
        $params = [];
        foreach ($valores as $col => $val) {
            if (in_array($col, $cols)) { $insCols[] = $col; $insPlace[] = '?'; $params[] = $val; }
        }
        // Añadir fecha si la columna existe.
        if (in_array('fecha', $cols)) { $insCols[] = 'fecha'; $insPlace[] = 'NOW()'; }

        $sql = "INSERT INTO solicitudes (" . implode(',', $insCols) . ") VALUES (" . implode(',', $insPlace) . ")";
        $pdo->prepare($sql)->execute($params);

        try { auditar($pdo, 'atender', 'pedidos', "Pedido enviado a gestión: {$s['nombre']} × {$cant} ({$s['municipio']})", $s['ref']); } catch (\Throwable $e) { error_log('[atender/auditar] '.$e->getMessage()); }
        try { notificarPedidoEnGestion($pdo, $id); } catch (\Throwable $e) { error_log('[atender/notif] '.$e->getMessage()); }

        responder(['ok'=>true,'estado'=>'en_gestion','solicitudId'=>$solId]);
    } catch (\Throwable $e) {
        error_log('[pedidos/atender] ' . $e->getMessage());
        responder(['error' => 'No se pudo atender: ' . $e->getMessage()], 500);
    }
}

/* ══ RECHAZAR pedido ═══════════════════════════════════ */
/* ══ CANCELAR (solo quien lo pidió y mientras siga pendiente) ══ */
if ($method === 'POST' && $action === 'cancelar') {
    $d  = json_decode(file_get_contents('php://input'), true);
    $id = $d['id'] ?? '';
    if (!$id) responder(['error' => 'ID requerido'], 400);
    $st = $pdo->prepare("SELECT solicitado_por, estado FROM pedidos_municipio WHERE id = ?");
    $st->execute([$id]);
    $p = $st->fetch();
    if (!$p) responder(['error' => 'Pedido no encontrado'], 404);
    if ($p['solicitado_por'] !== ($_SESSION['usuario'] ?? '')) responder(['error' => 'Solo quien hizo el pedido lo puede cancelar'], 403);
    $del = $pdo->prepare("DELETE FROM pedidos_municipio WHERE id = ? AND estado = 'pendiente'");
    $del->execute([$id]);
    if ($del->rowCount() === 0) responder(['error' => 'Este pedido ya fue procesado, no se puede cancelar'], 409);
    try { auditar($pdo, 'cancelar', 'pedidos', "Canceló su pedido pendiente: $id" . (($d['nota'] ?? '') !== '' ? " — Nota: " . mb_substr(trim($d['nota']), 0, 300) : ''), (string)$id); } catch (\Throwable $e) { error_log('[cancelar/auditar] ' . $e->getMessage()); }
    responder(['ok' => true]);
}

if ($method === 'POST' && $action === 'rechazar') {
    sesionRequerida();
    $rolR = $_SESSION['rol'] ?? '';
    // Pueden rechazar: superadmin, quien tenga el permiso de aprobar pedidos, y el
    // distribuidor solo si tiene "rechazar_envios".
    if ($rolR !== 'superadmin' && !usuarioTienePermiso('aprobar_pedidos')) {
        if ($rolR !== 'distribuidor') responder(['error' => 'Sin permisos para esta acción'], 403);
        $permRaw = $pdo->prepare("SELECT permisos FROM usuarios WHERE id = ?");
        $permRaw->execute([$_SESSION['usuario_id'] ?? 0]);
        $perms = json_decode($permRaw->fetchColumn() ?: '[]', true) ?: [];
        if (!in_array('rechazar_envios', $perms)) {
            responder(['error' => 'No tienes permiso para rechazar pedidos'], 403);
        }
    }
    $d      = json_decode(file_get_contents('php://input'), true);
    $id     = $d['id']     ?? '';
    $motivo = $d['motivo'] ?? 'Sin motivo';
    if (!$id) responder(['error' => 'ID requerido'], 400);

    try {
        // UPDATE tolerante: solo columnas que existan en pedidos_municipio.
        $pcols = $pdo->query("SHOW COLUMNS FROM pedidos_municipio")->fetchAll(PDO::FETCH_COLUMN);
        $set = ["estado='rechazado'"];
        $params = [];
        if (in_array('motivo', $pcols))          { $set[] = "motivo=?";          $params[] = $motivo; }
        if (in_array('rechazado_por', $pcols))   { $set[] = "rechazado_por=?";   $params[] = $_SESSION['usuario'] ?? ''; }
        if (in_array('fecha_respuesta', $pcols)) { $set[] = "fecha_respuesta=NOW()"; }
        $params[] = $id;
        $pdo->prepare("UPDATE pedidos_municipio SET " . implode(',', $set) . " WHERE id=?")->execute($params);

        // Historial + auditoría + notificación (no tumban la operación).
        try {
            $ped = $pdo->prepare("SELECT * FROM pedidos_municipio WHERE id=?");
            $ped->execute([$id]);
            $s = $ped->fetch();
            if ($s) {
                $hcols = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN);
                $hval = [
                    'ref' => $s['ref'], 'nombre' => $s['nombre'], 'destino' => $s['municipio'],
                    'cantidad' => $s['cantidad'], 'unidad_envio' => $s['unidad_pedido'] ?? 'unidad',
                    'enviado_por' => $_SESSION['usuario'],
                    'descripcion' => "Pedido rechazado por {$_SESSION['usuario']}: $motivo",
                    'estado' => 'rechazado', 'es_gasto' => 0, 'origen' => 'sistema',
                ];
                $hc = []; $hp = []; $hpar = [];
                foreach ($hval as $col => $val) { if (in_array($col, $hcols)) { $hc[]=$col; $hp[]='?'; $hpar[]=$val; } }
                if (in_array('fecha', $hcols)) { $hc[] = 'fecha'; $hp[] = 'NOW()'; }
                if ($hc) $pdo->prepare("INSERT INTO historial (".implode(',',$hc).") VALUES (".implode(',',$hp).")")->execute($hpar);

                try { auditar($pdo, 'rechazar', 'pedidos', "Pedido rechazado: {$s['nombre']} ({$s['municipio']}) — $motivo", $s['ref']); } catch (\Throwable $e) { error_log('[rechazar-ped/auditar] '.$e->getMessage()); }
                try { notificarPedidoRechazado($pdo, $id, $motivo); } catch (\Throwable $e) { error_log('[rechazar-ped/notif] '.$e->getMessage()); }
            }
        } catch (\Throwable $e) { error_log('[rechazar-ped/historial] '.$e->getMessage()); }

        responder(['ok'=>true]);
    } catch (\Throwable $e) {
        error_log('[pedidos/rechazar] ' . $e->getMessage());
        responder(['error' => 'No se pudo rechazar: ' . $e->getMessage()], 500);
    }
}

/* ══ GASTAR stock (municipio) ══════════════════════════ */
if ($method === 'POST' && $action === 'gastar') {
    // El checkbox "Registrar gastos en sede" (permiso registrar_gastos)
    // existía en el listado de permisos pero nunca se verificaba aquí —
    // quitárselo a alguien no le impedía gastar material. Se agrega el
    // mismo control que ya tienen "vender" e "instalar_ont".
    rolOPermiso(['superadmin'], 'registrar_gastos');
    // Municipio reparte material, no lo consume él mismo — el gasto real
    // en campo lo hace el técnico/persona a quien se le asignó.
    if (($_SESSION['rol'] ?? '') === 'municipio') {
        responder(['error' => 'Municipio no gasta material directamente — asígnalo a un técnico primero'], 403);
    }
    $d      = json_decode(file_get_contents('php://input'), true);
    $ref    = $d['ref']    ?? '';
    $sede   = $_SESSION['sede'];
    $usuario= $_SESSION['usuario'];
    $motivo = $d['motivo'] ?? '';
    $lugar  = trim($d['lugar']  ?? '');
    $lat = isset($d['lat']) && $d['lat'] !== '' ? floatval($d['lat']) : null;
    $lng = isset($d['lng']) && $d['lng'] !== '' ? floatval($d['lng']) : null;
    $proyectoCliente = trim($d['proyecto_cliente'] ?? '') ?: null;
    if (!$ref) responder(['error' => 'Datos inválidos'], 400);
    if (empty($lugar) && !($lat && $lng)) responder(['error' => 'El lugar de instalación/uso es requerido (o usa el GPS)'], 400);

    $prod = $pdo->prepare("SELECT id, nombre, unidad, metros_por_unidad FROM productos WHERE ref=?");
    $prod->execute([$ref]);
    $p = $prod->fetch();
    if (!$p) responder(['error' => 'Producto no encontrado'], 404);

    // Por metros se permiten decimales (ej: 12.5 mts); todo lo demás,
    // solo enteros.
    $esMetros = ($p['unidad'] ?? '') === 'metros';
    $cant = $esMetros ? floatval($d['cantidad'] ?? 0) : intval($d['cantidad'] ?? 0);
    if ($cant <= 0) responder(['error' => 'Datos inválidos'], 400);

    // Si el producto es "por rollo": si se eligió uno específico (hay más
    // de uno), se usa ese. Si no se eligió ninguno pero la persona solo
    // tiene UN rollo de este producto (no le salió selector porque no
    // hacía falta), se usa ESE automáticamente.
    $esPorRolloGasto = !empty($p['metros_por_unidad']);
    $rolloId = intval($d['rollo_id'] ?? 0);
    if ($esPorRolloGasto && !$rolloId) {
        $misRollosAuto = $pdo->prepare("SELECT id FROM producto_rollos WHERE producto_id = ? AND usuario_actual = ? AND estado = 'disponible' AND (metros - metros_usados) > 0");
        $misRollosAuto->execute([$p['id'], $usuario]);
        $candidatos = $misRollosAuto->fetchAll(PDO::FETCH_COLUMN);
        if (count($candidatos) === 1) $rolloId = (int)$candidatos[0];
    }

    if ($rolloId) {
        // Validar contra lo que de verdad tiene ESE rollo, no contra el
        // acumulado "en bolsa" del usuario (stockUsuarioObtener) — ese
        // total puede quedar desfasado respecto a los rollos físicos, y
        // comparar contra él rechazaba gastos válidos (ej: "1 rollo, 6 m"
        // salía como "stock insuficiente" aunque el rollo sí tuviera
        // esos 6 m disponibles).
        $rollo = $pdo->prepare("SELECT id, metros, metros_usados FROM producto_rollos WHERE id = ? AND producto_id = ? AND usuario_actual = ?");
        $rollo->execute([$rolloId, $p['id'], $usuario]);
        $r = $rollo->fetch();
        if (!$r) responder(['error' => 'Ese rollo no es tuyo o no existe'], 404);
        $dispRollo = (float)$r['metros'] - (float)$r['metros_usados'];
        if ($cant > $dispRollo) responder(['error' => "Ese rollo solo tiene {$dispRollo} m disponibles"], 400);
        $pdo->prepare("UPDATE producto_rollos SET metros_usados = metros_usados + ? WHERE id = ?")->execute([$cant, $rolloId]);
        if (($dispRollo - $cant) <= 0) {
            $pdo->prepare("UPDATE producto_rollos SET estado = 'agotado' WHERE id = ?")->execute([$rolloId]);
        }
    } else {
        // Producto normal (no por rollo), o por rollo sin poder resolver
        // cuál (varios candidatos y no se eligió ninguno) — se valida
        // contra el acumulado general, como antes.
        $stockPersonal = stockUsuarioObtener($pdo, $p['id'], $usuario);
        if ($cant > $stockPersonal) responder(['error' => 'Stock insuficiente en tu inventario personal'], 400);
    }

    stockUsuarioAjustar($pdo, $p['id'], $usuario, -$cant);

    try {
        // Quien realiza el gasto es siempre el usuario que tiene la sesión
        // iniciada — no se pregunta por separado, para evitar que alguien
        // registre un gasto "a nombre de otro" sin que ese otro lo sepa.
        $descGasto = ($lugar ? "Lugar: $lugar" : '') . ($motivo ? " — $motivo" : '');
        // Si viene de "Gasto múltiple", todos los productos del mismo lote
        // comparten este id — así, en Historial, el botón "Ver PDF" de
        // cualquiera de ellos sabe abrir el comprobante COMBINADO con
        // todos los del mismo lote, no uno separado por cada producto.
        $loteId = trim($d['lote_id'] ?? '') ?: null;
        $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,fecha,gps_lat,gps_lng,usuario_destino,pedido_agrupado_id,proyecto_cliente)
            VALUES (?,?,?,?,?,?,?,'aprobado',1,'gasto',NOW(),?,?,?,?,?)")
            ->execute([$ref, $p['nombre'], $sede, $cant, $p['unidad'], $usuario, $descGasto, $lat, $lng, $usuario, $loteId, $proyectoCliente]);
        $historialId = $pdo->lastInsertId();

    } catch (\Exception $e) { $historialId = null; }

    auditar($pdo, 'gastar', 'productos', "Gastó {$cant} {$p['unidad']} de {$p['nombre']}" . ($lugar ? " en $lugar" : ''), $ref);
    responder(['ok'=>true, 'historial_id' => $historialId]);
}

/* ══════════════════════════════════════
   VENDER — como gastar, pero genera dinero: pide cliente, precio y
   forma de pago. Queda marcado aparte (es_venta=1) para poder sacar
   reportes de ventas sin mezclarlos con gastos normales.
══════════════════════════════════════ */
/* ── Tabla de ventas pendientes de aprobación (se crea sola) ── */
function _ventasAsegurarTabla($pdo) {
    static $ok = false; if ($ok) return; $ok = true;
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS ventas_pendientes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            ref VARCHAR(60) NOT NULL,
            nombre VARCHAR(200) NOT NULL,
            cantidad INT NOT NULL,
            unidad VARCHAR(30) DEFAULT '',
            cliente VARCHAR(200) NOT NULL,
            precio_unitario DECIMAL(14,2) DEFAULT NULL,
            precio_total DECIMAL(14,2) NOT NULL,
            forma_pago VARCHAR(60) DEFAULT '',
            lat DECIMAL(10,7) DEFAULT NULL,
            lng DECIMAL(10,7) DEFAULT NULL,
            origen_stock VARCHAR(20) DEFAULT 'nuevo',
            es_central TINYINT(1) DEFAULT 0,
            solicitado_por VARCHAR(60) NOT NULL,
            sede VARCHAR(100) DEFAULT '',
            estado ENUM('pendiente','aprobada','rechazada','cancelada') DEFAULT 'pendiente',
            motivo_rechazo VARCHAR(400) DEFAULT '',
            resuelto_por VARCHAR(60) DEFAULT NULL,
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
            fecha_resuelto DATETIME DEFAULT NULL,
            historial_id INT DEFAULT NULL,
            KEY idx_estado (estado),
            KEY idx_solicitante (solicitado_por)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        $cols = $pdo->query("SHOW COLUMNS FROM ventas_pendientes")->fetchAll(PDO::FETCH_COLUMN);
        if (!in_array('cantidad_original', $cols)) $pdo->exec("ALTER TABLE ventas_pendientes ADD COLUMN cantidad_original INT DEFAULT NULL");
        if (!in_array('es_rollo', $cols)) $pdo->exec("ALTER TABLE ventas_pendientes ADD COLUMN es_rollo TINYINT(1) DEFAULT 0");
        if (!in_array('rollo_ids', $cols)) $pdo->exec("ALTER TABLE ventas_pendientes ADD COLUMN rollo_ids TEXT DEFAULT NULL");
        if (!in_array('equipo_tipo', $cols)) $pdo->exec("ALTER TABLE ventas_pendientes ADD COLUMN equipo_tipo VARCHAR(20) DEFAULT NULL");
        if (!in_array('equipo_id', $cols)) $pdo->exec("ALTER TABLE ventas_pendientes ADD COLUMN equipo_id INT DEFAULT NULL");
        if (!in_array('estado_previo', $cols)) $pdo->exec("ALTER TABLE ventas_pendientes ADD COLUMN estado_previo VARCHAR(30) DEFAULT NULL");
        // OLT y Mikrotik: el estado es un ENUM; se agregan 'en_venta' (apartado) y 'vendido'
        foreach (['olts', 'mikrotiks'] as $tEq) {
            $tipoCol = (string)($pdo->query("SHOW COLUMNS FROM $tEq LIKE 'estado'")->fetch()['Type'] ?? '');
            if ($tipoCol !== '' && stripos($tipoCol, 'en_venta') === false) {
                $pdo->exec("ALTER TABLE $tEq MODIFY estado ENUM('activo','inactivo','dañado','instalado','de_baja','recuperado','comodato','en_venta','vendido') DEFAULT 'activo'");
            }
        }
        if (!in_array('observacion', $cols)) $pdo->exec("ALTER TABLE ventas_pendientes ADD COLUMN observacion VARCHAR(400) DEFAULT ''");
        if (!in_array('metros_reservados', $cols)) $pdo->exec("ALTER TABLE ventas_pendientes ADD COLUMN metros_reservados DECIMAL(12,2) DEFAULT NULL");
        // Ventas antiguas: conectarlas con Cliente/Proyecto (solo corre si hay pendientes de enlazar)
        $falta = $pdo->query("SELECT 1 FROM historial WHERE es_venta = 1 AND cliente_venta <> '' AND (proyecto_cliente IS NULL OR proyecto_cliente = '') LIMIT 1")->fetchColumn();
        if ($falta) {
            $nombres = $pdo->query("SELECT DISTINCT cliente_venta FROM historial WHERE es_venta = 1 AND cliente_venta <> '' AND (proyecto_cliente IS NULL OR proyecto_cliente = '')")->fetchAll(PDO::FETCH_COLUMN);
            foreach ($nombres as $nm) {
                $real = _ventaAsegurarProyecto($pdo, $nm, 'sistema');
                $pdo->prepare("UPDATE historial SET proyecto_cliente = ? WHERE es_venta = 1 AND cliente_venta = ? AND (proyecto_cliente IS NULL OR proyecto_cliente = '')")->execute([$real, $nm]);
            }
        }
    } catch (\Throwable $e) { error_log('[ventas_pendientes tabla] ' . $e->getMessage()); }
}

/* Escribe la venta en el historial (ya aprobada). Devuelve el id o null. */
function _ventaRegistrarHistorial($pdo, array $v, string $usuarioVende, string $sede, string $notaExtra = '') {
    $fmtCOP = fn($n) => number_format($n, 0, ',', '.');
    $descVenta = "Cliente: {$v['cliente']} · Precio: \$" . $fmtCOP($v['precio_total']) . ($v['forma_pago'] ? " · Pago: {$v['forma_pago']}" : '') . $notaExtra;
    try {
        $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,fecha,gps_lat,gps_lng,usuario_destino,es_venta,cliente_venta,precio_unitario,precio_total,forma_pago,proyecto_cliente)
            VALUES (?,?,?,?,?,?,?,'aprobado',1,'venta',NOW(),?,?,?,1,?,?,?,?,?)")
            ->execute([$v['ref'], $v['nombre'], $sede, $v['cantidad'], $v['unidad'], $usuarioVende, $descVenta, $v['lat'] ?? null, $v['lng'] ?? null, $usuarioVende, $v['cliente'], $v['precio_unitario'] ?? null, $v['precio_total'], $v['forma_pago'] ?? '', $v['cliente']]);
        return $pdo->lastInsertId();
    } catch (\Exception $e) { return null; }
}

/* Conecta el cliente de la venta con el catálogo Cliente/Proyecto: si ya existe
   (sin importar mayúsculas) usa ese nombre; si no, lo crea. */
function _ventaAsegurarProyecto($pdo, string $cliente, string $usuario): string {
    try {
        $q = $pdo->prepare("SELECT nombre FROM proyectos WHERE LOWER(nombre) = LOWER(?) AND activo = 1 LIMIT 1");
        $q->execute([$cliente]);
        $n = $q->fetchColumn();
        if ($n) return $n;
        $pdo->prepare("INSERT INTO proyectos (nombre, creado_por) VALUES (?, ?)")->execute([$cliente, $usuario]);
    } catch (\Throwable $e) { error_log('[venta proyecto] ' . $e->getMessage()); }
    return $cliente;
}

/* Quién puede aprobar ventas: superadmin o quien tenga el permiso. */
function _puedeAprobarVentas(): bool {
    return ($_SESSION['rol'] ?? '') === 'superadmin' || usuarioTienePermiso('aprobar_ventas');
}

/* ── Venta de EQUIPOS con serial (ONT / OLT / Mikrotik): se vende UNA unidad ── */
function _equipoTabla(string $tipo): ?string {
    return ['ont' => 'ont_seriales', 'olt' => 'olts', 'mikrotik' => 'mikrotiks'][$tipo] ?? null;
}
function _equipoEtiqueta(string $tipo, array $row): array {
    if ($tipo === 'ont') {
        $id = $row['sn'] ?: ($row['serial'] ?: ($row['mac_fmt'] ?: ('#' . $row['id'])));
        return ['ONT-' . $id, trim('ONT ' . ($row['modelo'] ?? '') . ' · SN ' . $id)];
    }
    if ($tipo === 'olt') return ['OLT-' . $row['id'], trim('OLT ' . ($row['marca'] ?? '') . ' ' . ($row['modelo'] ?? ''))];
    $sn = $row['sn'] ?? '';
    return ['MK-' . $row['id'], trim(($row['tipo_equipo'] ?: 'Equipo') . ' ' . ($row['marca'] ?: ($row['proveedor'] ?? '')) . ' ' . ($row['modelo'] ?? '') . ($sn ? ' · SN ' . $sn : ''))];
}
/* Deja el equipo como vendido (definitivo) */
function _equipoMarcarVendido(PDO $pdo, string $tipo, int $id, string $cliente, string $usuario): void {
    $t = _equipoTabla($tipo); if (!$t) return;
    if ($tipo === 'ont') {
        $pdo->prepare("UPDATE ont_seriales SET estado='vendido', cliente_nombre=?, fecha_salida=NOW(), fecha_estado=NOW() WHERE id=?")->execute([$cliente, $id]);
        try { $pdo->prepare("INSERT INTO ont_historial (ont_id, evento, detalle, usuario) VALUES (?, 'vendida', ?, ?)")->execute([$id, "Vendida a $cliente", $usuario]); } catch (\Throwable $e) {}
    } else {
        $pdo->prepare("UPDATE $t SET estado='vendido', cliente_nombre=? WHERE id=?")->execute([$cliente, $id]);
    }
}
/* Devuelve el equipo a su estado anterior (venta rechazada/cancelada) */
function _equipoRestaurar(PDO $pdo, array $v): void {
    $t = _equipoTabla((string)($v['equipo_tipo'] ?? '')); if (!$t) return;
    $prev = $v['estado_previo'] ?: ($v['equipo_tipo'] === 'ont' ? 'disponible' : 'activo');
    $pdo->prepare("UPDATE $t SET estado=? WHERE id=? AND estado='en_venta'")->execute([$prev, (int)$v['equipo_id']]);
}

/* Devuelve el stock apartado de una venta que no se concretó.
   Si es por rollos, los rollos vuelven a quedar disponibles y se devuelven
   sus metros al inventario. */
function _ventaLiberarStock($pdo, array $v) {
    if (!empty($v['equipo_tipo'])) { _equipoRestaurar($pdo, $v); return; }
    $pid = $pdo->prepare("SELECT id FROM productos WHERE ref = ?");
    $pid->execute([$v['ref']]);
    $productoId = (int)$pid->fetchColumn();
    if (!$productoId) return;
    if (!empty($v['es_rollo'])) {
        $ids = array_values(array_filter(array_map('intval', json_decode($v['rollo_ids'] ?? '[]', true) ?: [])));
        if (!$ids) return;
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $q = $pdo->prepare("SELECT COALESCE(SUM(metros - metros_usados),0) FROM producto_rollos WHERE id IN ($ph)");
        $q->execute($ids);
        $metros = (float)$q->fetchColumn();
        $pdo->prepare("UPDATE producto_rollos SET estado = 'disponible' WHERE id IN ($ph) AND estado = 'en_transito'")->execute($ids);
        if (!empty($v['es_central'])) {
            $pdo->prepare("UPDATE productos SET stock_neiva = stock_neiva + ? WHERE id = ?")->execute([$metros, $productoId]);
        } else {
            stockUsuarioAjustar($pdo, $productoId, $v['solicitado_por'], $metros);
        }
        return;
    }
    if (!empty($v['es_central'])) {
        $col = ($v['origen_stock'] === 'recuperado') ? 'stock_recuperado' : 'stock_neiva';
        $pdo->prepare("UPDATE productos SET $col = $col + ? WHERE id = ?")->execute([$v['cantidad'], $productoId]);
    } else {
        stockUsuarioAjustar($pdo, $productoId, $v['solicitado_por'], (int)$v['cantidad']);
    }
}

/* ══════════════════════════════════════
   VENDER — cualquier usuario vende de SU stock (sin permiso especial).
   Superadmin vende directo; todos los demás generan una solicitud que
   debe aprobar el superadmin o alguien con el permiso "aprobar_ventas".
   El stock queda APARTADO (sale de su inventario) hasta que se resuelva:
   si se aprueba pasa a venta; si se rechaza o cancela, se le devuelve.
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'vender') {
    _ventasAsegurarTabla($pdo);
    $usuario = $_SESSION['usuario'];
    $sede    = $_SESSION['sede'];
    $rolV    = $_SESSION['rol'] ?? '';
    $d = json_decode(file_get_contents('php://input'), true);

    $ref    = trim($d['ref'] ?? '');
    $cant   = intval($d['cantidad'] ?? 0);
    $cliente = trim($d['cliente'] ?? '');
    $precioUnitario = isset($d['precio_unitario']) ? floatval($d['precio_unitario']) : null;
    $precioTotal    = isset($d['precio_total']) ? floatval($d['precio_total']) : ($precioUnitario ? $precioUnitario * $cant : null);
    $formaPago = trim($d['forma_pago'] ?? '');
    $lat = isset($d['lat']) && $d['lat'] !== '' ? floatval($d['lat']) : null;
    $lng = isset($d['lng']) && $d['lng'] !== '' ? floatval($d['lng']) : null;

    $origenStock = trim($d['origen_stock'] ?? 'nuevo'); // 'nuevo' | 'recuperado'
    if ($origenStock !== 'recuperado') $origenStock = 'nuevo';

    if (!$ref || $cant < 1) responder(['error' => 'Datos inválidos'], 400);
    if (!$cliente) responder(['error' => 'Escribe el nombre del cliente'], 400);
    if (!$precioTotal || $precioTotal <= 0) responder(['error' => 'Ingresa el precio de la venta'], 400);
    $cliente = _ventaAsegurarProyecto($pdo, $cliente, $usuario);

    $prod = $pdo->prepare("SELECT id, nombre, unidad, metros_por_unidad FROM productos WHERE ref=?");
    $prod->execute([$ref]);
    $p = $prod->fetch();
    if (!$p) responder(['error' => 'Producto no encontrado'], 404);

    // Superadmin/distribuidor no tienen "stock personal" — manejan el
    // almacén central directamente, y ahí eligen manualmente de cuál de
    // los 2 pools descontar (stock nuevo o material recuperado). El resto
    // vende de lo que tiene en su propio inventario personal.
    $esCentral = in_array($rolV, ['superadmin', 'distribuidor']);
    $esRollo = !empty($p['metros_por_unidad']);
    $rolloIds = []; $metrosRollos = 0.0;
    if ($esRollo) {
        // Producto por rollos: se venden ROLLOS completos (los que se elijan);
        // la cantidad es el número de rollos y el stock en metros se
        // descuenta por lo que de verdad le queda a cada rollo.
        $rolloIds = array_values(array_unique(array_filter(array_map('intval', $d['rollo_ids'] ?? []))));
        if (!$rolloIds) responder(['error' => 'Elige los rollos que vas a vender'], 400);
        $ph = implode(',', array_fill(0, count($rolloIds), '?'));
        if ($esCentral) {
            $qr = $pdo->prepare("SELECT id, (metros - metros_usados) AS disp FROM producto_rollos WHERE producto_id = ? AND id IN ($ph) AND sede_nombre = 'Almacen Central' AND usuario_actual IS NULL AND estado = 'disponible' AND (metros - metros_usados) > 0");
            $qr->execute(array_merge([$p['id']], $rolloIds));
        } else {
            $qr = $pdo->prepare("SELECT id, (metros - metros_usados) AS disp FROM producto_rollos WHERE producto_id = ? AND id IN ($ph) AND usuario_actual = ? AND estado = 'disponible' AND (metros - metros_usados) > 0");
            $qr->execute(array_merge([$p['id']], $rolloIds, [$usuario]));
        }
        $filasR = $qr->fetchAll();
        if (count($filasR) !== count($rolloIds)) responder(['error' => 'Alguno de los rollos elegidos ya no está disponible'], 400);
        foreach ($filasR as $fr) $metrosRollos += (float)$fr['disp'];
        $cant = count($rolloIds);
        // Apartar los rollos (quedan fuera de "disponibles" hasta resolver)
        $pdo->prepare("UPDATE producto_rollos SET estado = 'en_transito' WHERE id IN ($ph)")->execute($rolloIds);
        if ($esCentral) {
            $pdo->prepare("UPDATE productos SET stock_neiva = GREATEST(stock_neiva - ?, 0) WHERE id = ?")->execute([$metrosRollos, $p['id']]);
        } else {
            stockUsuarioAjustar($pdo, $p['id'], $usuario, -$metrosRollos);
        }
    } elseif ($esCentral) {
        $col = ($origenStock === 'recuperado') ? 'stock_recuperado' : 'stock_neiva';
        $stockDisponible = (int)$pdo->query("SELECT $col FROM productos WHERE id=" . (int)$p['id'])->fetchColumn();
        if ($cant > $stockDisponible) responder(['error' => 'Stock insuficiente en el almacén central (' . ($origenStock === 'recuperado' ? 'recuperado' : 'nuevo') . ')'], 400);
        $pdo->prepare("UPDATE productos SET $col = $col - ? WHERE id = ?")->execute([$cant, $p['id']]);
        if ($col === 'stock_neiva') notificarStockBajoCentral($pdo, (int)$p['id'], (float)$stockDisponible);
    } else {
        $stockPersonal = stockUsuarioObtener($pdo, $p['id'], $usuario);
        if ($cant > $stockPersonal) responder(['error' => 'Stock insuficiente en tu inventario personal'], 400);
        stockUsuarioAjustar($pdo, $p['id'], $usuario, -$cant);
    }

    $v = ['ref' => $ref, 'nombre' => $p['nombre'], 'cantidad' => $cant, 'unidad' => $p['unidad'], 'cliente' => $cliente,
          'precio_unitario' => $precioUnitario, 'precio_total' => $precioTotal, 'forma_pago' => $formaPago, 'lat' => $lat, 'lng' => $lng];

    // Superadmin: vende directo, sin aprobación
    if ($rolV === 'superadmin') {
        $notaOrigen = $esRollo ? " · {$cant} rollo(s)" : " · Stock: " . ($origenStock === 'recuperado' ? '♻️ Recuperado' : '🆕 Nuevo');
        $vH = $v;
        if ($esRollo) {
            $phD = implode(',', array_fill(0, count($rolloIds), '?'));
            $pdo->prepare("UPDATE producto_rollos SET metros_usados = metros, estado = 'agotado' WHERE id IN ($phD)")->execute($rolloIds);
            $vH['cantidad'] = $metrosRollos; $vH['unidad'] = 'metros';
        }
        $historialId = _ventaRegistrarHistorial($pdo, $vH, $usuario, $sede, $notaOrigen);
        $fmtCOP = fn($n) => number_format($n, 0, ',', '.');
        auditar($pdo, 'vender', 'productos', "Venta: {$p['nombre']} x{$cant} a $cliente por \$" . $fmtCOP($precioTotal) . ($formaPago ? " ($formaPago)" : ''), $ref);
        responder(['ok'=>true, 'historial_id' => $historialId, 'pendiente' => false]);
    }

    // Todos los demás: queda pendiente de aprobación (stock ya apartado)
    try {
        $pdo->prepare("INSERT INTO ventas_pendientes (ref,nombre,cantidad,unidad,cliente,precio_unitario,precio_total,forma_pago,lat,lng,origen_stock,es_central,solicitado_por,sede,es_rollo,rollo_ids,metros_reservados)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([$ref, $p['nombre'], $cant, $p['unidad'], $cliente, $precioUnitario, $precioTotal, $formaPago, $lat, $lng, $origenStock, $esCentral ? 1 : 0, $usuario, $sede, $esRollo ? 1 : 0, $esRollo ? json_encode($rolloIds) : null, $esRollo ? $metrosRollos : null]);
        $ventaId = (int)$pdo->lastInsertId();
    } catch (\Throwable $e) {
        // si no se pudo guardar la solicitud, se devuelve el stock que se acababa de apartar
        _ventaLiberarStock($pdo, $v + ['es_central' => $esCentral ? 1 : 0, 'origen_stock' => $origenStock, 'solicitado_por' => $usuario, 'es_rollo' => $esRollo ? 1 : 0, 'rollo_ids' => json_encode($rolloIds)]);
        error_log('[vender pendiente] ' . $e->getMessage());
        responder(['error' => 'No se pudo registrar la solicitud de venta'], 500);
    }
    $fmtCOP = fn($n) => number_format($n, 0, ',', '.');
    auditar($pdo, 'venta_solicitada', 'ventas_pendientes', "Solicitó venta: {$p['nombre']} x{$cant} a $cliente por \$" . $fmtCOP($precioTotal), (string)$ventaId);
    try { notificarVentaSolicitada($pdo, $ventaId); } catch (\Throwable $e) { error_log('[vender notificar] ' . $e->getMessage()); }
    responder(['ok' => true, 'pendiente' => true, 'venta_id' => $ventaId]);
}

/* ══ VENDER EQUIPO (ONT / OLT / Mikrotik) — mismo flujo que los productos ══ */
if ($method === 'POST' && $action === 'vender_equipo') {
    _ventasAsegurarTabla($pdo);
    $usuario = $_SESSION['usuario'];
    $sede    = $_SESSION['sede'] ?? '';
    $rolV    = $_SESSION['rol'] ?? '';
    $d = json_decode(file_get_contents('php://input'), true);
    $tipo = trim($d['tipo'] ?? '');
    $eid  = intval($d['id'] ?? 0);
    $cliente = trim($d['cliente'] ?? '');
    $precioTotal = isset($d['precio_total']) ? floatval($d['precio_total']) : 0;
    $formaPago = trim($d['forma_pago'] ?? '');
    $tabla = _equipoTabla($tipo);
    if (!$tabla || !$eid) responder(['error' => 'Equipo inválido'], 400);
    if ($cliente === '') responder(['error' => 'Escribe el cliente'], 400);
    if ($precioTotal <= 0) responder(['error' => 'Ingresa el precio de la venta'], 400);
    $cliente = _ventaAsegurarProyecto($pdo, $cliente, $usuario);

    $pdo->beginTransaction();
    try {
        $q = $pdo->prepare("SELECT * FROM $tabla WHERE id = ? FOR UPDATE");
        $q->execute([$eid]);
        $row = $q->fetch();
        if (!$row) { $pdo->rollBack(); responder(['error' => 'Equipo no encontrado'], 404); }
        $esAdminV = in_array($rolV, ['superadmin', 'distribuidor']);
        if ($tipo === 'ont') {
            if (!in_array($row['estado'], ['disponible', 'despachada'])) { $pdo->rollBack(); responder(['error' => 'Esta ONT no está disponible para vender (estado: ' . $row['estado'] . ')'], 400); }
            $mia = ($row['tecnico_asignado'] ?? '') === $usuario;
            $libre = ($row['tecnico_asignado'] ?? '') === '' || $row['tecnico_asignado'] === null;
            if (!($rolV === 'superadmin' || $mia || ($rolV === 'distribuidor' && $libre))) { $pdo->rollBack(); responder(['error' => 'Solo puedes vender ONTs que tienes a tu cargo'], 403); }
        } else {
            if (!in_array($row['estado'], ['activo', 'recuperado'])) { $pdo->rollBack(); responder(['error' => 'Este equipo no está disponible para vender (estado: ' . $row['estado'] . ')'], 400); }
            if (!$esAdminV) {
                if (($row['sede'] ?? '') !== $sede || (($row['asignado_a'] ?? '') !== '' && $row['asignado_a'] !== null && $row['asignado_a'] !== $usuario)) {
                    $pdo->rollBack(); responder(['error' => 'Solo puedes vender equipos de tu sede'], 403);
                }
            }
            $enEnvio = $pdo->prepare("SELECT COUNT(*) FROM envios_seguimiento WHERE tipo = ? AND referencia_id = ? AND estado IN ('aprobado','en_camino','entregado')");
            $enEnvio->execute([$tipo, $eid]);
            if ((int)$enEnvio->fetchColumn() > 0) { $pdo->rollBack(); responder(['error' => 'Este equipo tiene un envío en curso'], 400); }
        }
        [$refEq, $nombreEq] = _equipoEtiqueta($tipo, $row);
        $estadoPrevio = $row['estado'];
        $unidad = 'unidad';
        $v = ['ref' => $refEq, 'nombre' => $nombreEq, 'cantidad' => 1, 'unidad' => $unidad, 'cliente' => $cliente,
              'precio_unitario' => $precioTotal, 'precio_total' => $precioTotal, 'forma_pago' => $formaPago, 'lat' => null, 'lng' => null];

        if ($rolV === 'superadmin') {
            _equipoMarcarVendido($pdo, $tipo, $eid, $cliente, $usuario);
            $historialId = _ventaRegistrarHistorial($pdo, $v, $usuario, $sede, ' · Equipo ' . strtoupper($tipo));
            auditar($pdo, 'vender', $tabla, "Venta de $nombreEq a $cliente por \$" . number_format($precioTotal, 0, ',', '.'), (string)$eid);
            $pdo->commit();
            responder(['ok' => true, 'pendiente' => false, 'historial_id' => $historialId]);
        }
        // Apartado: queda en 'en_venta' hasta que lo aprueben
        $pdo->prepare("UPDATE $tabla SET estado='en_venta' WHERE id = ?")->execute([$eid]);
        $pdo->prepare("INSERT INTO ventas_pendientes (ref,nombre,cantidad,unidad,cliente,precio_unitario,precio_total,forma_pago,origen_stock,es_central,solicitado_por,sede,es_rollo,equipo_tipo,equipo_id,estado_previo)
            VALUES (?,?,1,?,?,?,?,?,'nuevo',?,?,?,0,?,?,?)")
            ->execute([$refEq, $nombreEq, $unidad, $cliente, $precioTotal, $precioTotal, $formaPago, $esAdminV ? 1 : 0, $usuario, $sede, $tipo, $eid, $estadoPrevio]);
        $ventaId = (int)$pdo->lastInsertId();
        $pdo->commit();
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('[vender_equipo] ' . $e->getMessage());
        responder(['error' => 'No se pudo registrar la venta del equipo'], 500);
    }
    auditar($pdo, 'venta_solicitada', 'ventas_pendientes', "Solicitó venta: $nombreEq a $cliente por \$" . number_format($precioTotal, 0, ',', '.'), (string)$ventaId);
    try { notificarVentaSolicitada($pdo, $ventaId); } catch (\Throwable $e) { error_log('[vender_equipo notificar] ' . $e->getMessage()); }
    responder(['ok' => true, 'pendiente' => true, 'venta_id' => $ventaId]);
}

/* ══ VENTAS PENDIENTES — quien aprueba ve todas; el resto, las suyas ══ */
if ($method === 'GET' && $action === 'ventas_pendientes') {
    _ventasAsegurarTabla($pdo);
    $puedeAprobar = _puedeAprobarVentas();
    if ($puedeAprobar) {
        $rows = $pdo->query("SELECT * FROM ventas_pendientes WHERE estado = 'pendiente' OR fecha_resuelto >= (NOW() - INTERVAL 90 DAY) ORDER BY (estado='pendiente') DESC, fecha DESC LIMIT 300")->fetchAll();
    } else {
        $st = $pdo->prepare("SELECT * FROM ventas_pendientes WHERE solicitado_por = ? AND (estado = 'pendiente' OR fecha_resuelto >= (NOW() - INTERVAL 90 DAY)) ORDER BY (estado='pendiente') DESC, fecha DESC LIMIT 300");
        $st->execute([$_SESSION['usuario']]);
        $rows = $st->fetchAll();
    }
    responder(['puede_aprobar' => $puedeAprobar, 'ventas' => $rows]);
}

/* ══ VENTAS POR CLIENTE — ventas ya registradas (aprobadas o directas).
   Quien aprueba (o superadmin) ve todas; el resto, solo las suyas. ══ */
if ($method === 'GET' && $action === 'ventas_por_cliente') {
    $sql = "SELECT id, fecha, ref, nombre, cantidad, unidad_envio AS unidad, enviado_por AS vendedor,
                   cliente_venta AS cliente, precio_total, forma_pago
            FROM historial
            WHERE es_venta = 1 AND (anulado IS NULL OR anulado = 0)";
    $params = [];
    if (!_puedeAprobarVentas()) { $sql .= " AND enviado_por = ?"; $params[] = $_SESSION['usuario']; }
    $sql .= " ORDER BY fecha DESC LIMIT 1500";
    $st = $pdo->prepare($sql);
    $st->execute($params);
    responder(['ventas' => $st->fetchAll()]);
}

/* ══ CLIENTES DE VENTAS — para sugerir al registrar otra venta.
   Quien aprueba ve los de todos; el resto, solo los suyos. ══ */
if ($method === 'GET' && $action === 'clientes_venta') {
    _ventasAsegurarTabla($pdo);
    $todos = _puedeAprobarVentas();
    $u = $_SESSION['usuario'];
    $sql1 = "SELECT cliente_venta AS c FROM historial WHERE es_venta = 1 AND (anulado IS NULL OR anulado = 0) AND cliente_venta <> ''" . ($todos ? '' : " AND enviado_por = ?");
    $st = $pdo->prepare($sql1); $st->execute($todos ? [] : [$u]);
    $nombres = $st->fetchAll(PDO::FETCH_COLUMN);
    $sql2 = "SELECT cliente AS c FROM ventas_pendientes WHERE estado = 'pendiente'" . ($todos ? '' : " AND solicitado_por = ?");
    $st2 = $pdo->prepare($sql2); $st2->execute($todos ? [] : [$u]);
    $nombres = array_merge($nombres, $st2->fetchAll(PDO::FETCH_COLUMN));
    $unicos = [];
    foreach ($nombres as $n) { $n = trim($n); if ($n !== '') $unicos[mb_strtolower($n)] = $unicos[mb_strtolower($n)] ?? $n; }
    $lista = array_values($unicos);
    sort($lista, SORT_NATURAL | SORT_FLAG_CASE);
    responder(['clientes' => $lista]);
}

/* ══ APROBAR venta ══ */
if ($method === 'POST' && $action === 'aprobar_venta') {
    _ventasAsegurarTabla($pdo);
    if (!_puedeAprobarVentas()) responder(['error' => 'No tienes permiso para aprobar ventas'], 403);
    $d = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['id'] ?? 0);
    $st = $pdo->prepare("SELECT * FROM ventas_pendientes WHERE id = ?");
    $st->execute([$id]);
    $v = $st->fetch();
    if (!$v) responder(['error' => 'Venta no encontrada'], 404);
    if ($v['estado'] !== 'pendiente') responder(['error' => 'Esta venta ya fue resuelta (' . $v['estado'] . ')'], 400);
    if ($v['solicitado_por'] === ($_SESSION['usuario'] ?? '') && ($_SESSION['rol'] ?? '') !== 'superadmin') {
        responder(['error' => 'No puedes aprobar tu propia venta — debe hacerlo otra persona'], 403);
    }
    // Quien aprueba puede ajustar la cantidad (solo hacia abajo: el material
    // apartado es el de la solicitud) y el precio total.
    $cantNueva = isset($d['cantidad']) ? intval($d['cantidad']) : (int)$v['cantidad'];
    // ONT / OLT / equipos: cada uno tiene SN propio, la cantidad no se puede cambiar
    if (!empty($v['equipo_tipo'])) $cantNueva = (int)$v['cantidad'];
    if ($cantNueva < 1 || $cantNueva > (int)$v['cantidad']) {
        responder(['error' => 'La cantidad debe estar entre 1 y ' . (int)$v['cantidad'] . ' (lo que se apartó)'], 400);
    }
    $precioNuevo = isset($d['precio_total']) && $d['precio_total'] !== '' ? floatval($d['precio_total']) : null;
    if ($precioNuevo === null) {
        // sin precio indicado: se mantiene el precio por unidad
        $precioNuevo = $cantNueva === (int)$v['cantidad'] ? (float)$v['precio_total'] : round((float)$v['precio_total'] / (int)$v['cantidad'] * $cantNueva, 2);
    }
    if ($precioNuevo <= 0) responder(['error' => 'El precio debe ser mayor a 0'], 400);
    $cantOriginal = (int)$v['cantidad'];
    $obsAprob = mb_substr(trim((string)($d['observacion'] ?? '')), 0, 400);

    // Por rollos: se conservan los primeros N rollos; el resto se libera
    $metrosVenta = null;
    $rollosVenta = null;
    if (!empty($v['es_rollo'])) {
        $idsAll = array_values(array_filter(array_map('intval', json_decode($v['rollo_ids'] ?? '[]', true) ?: [])));
        $rollosVenta = array_slice($idsAll, 0, $cantNueva);
        $sobran = array_slice($idsAll, $cantNueva);
    }
    // El primero que la resuelve gana (evita doble aprobación)
    $u = $pdo->prepare("UPDATE ventas_pendientes SET estado='aprobada', resuelto_por=?, fecha_resuelto=NOW(), cantidad=?, precio_total=?, precio_unitario=?, cantidad_original=?, observacion=? WHERE id=? AND estado='pendiente'");
    $u->execute([$_SESSION['usuario'], $cantNueva, $precioNuevo, round($precioNuevo / $cantNueva, 2), $cantOriginal, $obsAprob, $id]);
    if ($u->rowCount() === 0) responder(['error' => 'Esta venta ya fue resuelta por otra persona'], 409);
    // Lo que no se vende vuelve al inventario de quien lo apartó
    if (!empty($v['es_rollo'])) {
        if ($sobran) _ventaLiberarStock($pdo, array_merge($v, ['rollo_ids' => json_encode($sobran)]));
        $phK = implode(',', array_fill(0, count($rollosVenta), '?'));
        $qk = $pdo->prepare("SELECT COALESCE(SUM(metros - metros_usados),0) FROM producto_rollos WHERE id IN ($phK)");
        $qk->execute($rollosVenta);
        $metrosVenta = (float)$qk->fetchColumn();
        $pdo->prepare("UPDATE producto_rollos SET metros_usados = metros, estado = 'agotado' WHERE id IN ($phK)")->execute($rollosVenta);
        $pdo->prepare("UPDATE ventas_pendientes SET rollo_ids = ?, metros_reservados = ? WHERE id = ?")->execute([json_encode($rollosVenta), $metrosVenta, $id]);
    } elseif ($cantNueva < $cantOriginal) {
        _ventaLiberarStock($pdo, array_merge($v, ['cantidad' => $cantOriginal - $cantNueva]));
    }
    if (!empty($v['equipo_tipo'])) _equipoMarcarVendido($pdo, $v['equipo_tipo'], (int)$v['equipo_id'], $v['cliente'], $_SESSION['usuario']);
    $v['cantidad'] = $cantNueva; $v['precio_total'] = $precioNuevo; $v['precio_unitario'] = round($precioNuevo / $cantNueva, 2);

    $nota = $v['es_central'] ? (" · Stock: " . ($v['origen_stock'] === 'recuperado' ? '♻️ Recuperado' : '🆕 Nuevo')) : '';
    if (!empty($v['equipo_tipo'])) $nota = ' · Equipo ' . strtoupper($v['equipo_tipo']) . $nota;
    $nota .= " · Aprobada por {$_SESSION['usuario']}" . ($cantNueva !== $cantOriginal ? " (cantidad ajustada de $cantOriginal a $cantNueva)" : '');
    if ($obsAprob !== '') $nota .= " · Obs. aprobador: {$obsAprob}";
    $vH = $v;
    if (!empty($v['es_rollo'])) { $vH['cantidad'] = $metrosVenta; $vH['unidad'] = 'metros'; $nota = " · {$cantNueva} rollo(s)" . $nota; }
    $histId = _ventaRegistrarHistorial($pdo, $vH, $v['solicitado_por'], $v['sede'], $nota);
    if ($histId) $pdo->prepare("UPDATE ventas_pendientes SET historial_id=? WHERE id=?")->execute([$histId, $id]);
    auditar($pdo, 'venta_aprobada', 'ventas_pendientes', "Aprobó la venta #{$id} de {$v['solicitado_por']}: {$v['nombre']} x{$v['cantidad']} a {$v['cliente']}", (string)$id);
    try { notificarVentaResuelta($pdo, $id); } catch (\Throwable $e) { error_log('[aprobar_venta notificar] ' . $e->getMessage()); }
    responder(['ok' => true]);
}

/* ══ RECHAZAR venta (devuelve el stock apartado) ══ */
if ($method === 'POST' && $action === 'rechazar_venta') {
    _ventasAsegurarTabla($pdo);
    if (!_puedeAprobarVentas()) responder(['error' => 'No tienes permiso para rechazar ventas'], 403);
    $d = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['id'] ?? 0);
    $motivo = trim($d['motivo'] ?? '');
    if ($motivo === '') responder(['error' => 'Escribe el motivo del rechazo'], 400);
    $st = $pdo->prepare("SELECT * FROM ventas_pendientes WHERE id = ?");
    $st->execute([$id]);
    $v = $st->fetch();
    if (!$v) responder(['error' => 'Venta no encontrada'], 404);
    if ($v['estado'] !== 'pendiente') responder(['error' => 'Esta venta ya fue resuelta (' . $v['estado'] . ')'], 400);
    $u = $pdo->prepare("UPDATE ventas_pendientes SET estado='rechazada', motivo_rechazo=?, resuelto_por=?, fecha_resuelto=NOW() WHERE id=? AND estado='pendiente'");
    $u->execute([mb_substr($motivo, 0, 400), $_SESSION['usuario'], $id]);
    if ($u->rowCount() === 0) responder(['error' => 'Esta venta ya fue resuelta por otra persona'], 409);
    _ventaLiberarStock($pdo, $v);
    auditar($pdo, 'venta_rechazada', 'ventas_pendientes', "Rechazó la venta #{$id} de {$v['solicitado_por']} — $motivo", (string)$id);
    try { notificarVentaResuelta($pdo, $id); } catch (\Throwable $e) { error_log('[rechazar_venta notificar] ' . $e->getMessage()); }
    responder(['ok' => true]);
}

/* ══ CANCELAR venta — la cancela quien la pidió, mientras esté pendiente ══ */
if ($method === 'POST' && $action === 'cancelar_venta') {
    _ventasAsegurarTabla($pdo);
    $d = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['id'] ?? 0);
    $st = $pdo->prepare("SELECT * FROM ventas_pendientes WHERE id = ?");
    $st->execute([$id]);
    $v = $st->fetch();
    if (!$v) responder(['error' => 'Venta no encontrada'], 404);
    if ($v['solicitado_por'] !== ($_SESSION['usuario'] ?? '')) responder(['error' => 'Solo quien pidió la venta la puede cancelar'], 403);
    $u = $pdo->prepare("UPDATE ventas_pendientes SET estado='cancelada', resuelto_por=?, fecha_resuelto=NOW() WHERE id=? AND estado='pendiente'");
    $u->execute([$_SESSION['usuario'], $id]);
    if ($u->rowCount() === 0) responder(['error' => 'Esta venta ya fue resuelta, no se puede cancelar'], 409);
    _ventaLiberarStock($pdo, $v);
    auditar($pdo, 'venta_cancelada', 'ventas_pendientes', "Canceló su solicitud de venta #{$id}", (string)$id);
    responder(['ok' => true]);
}

/* ══ DISTRIBUIDORES CON STOCK ══ */
if ($method === 'GET' && $action === 'distribuidores_con_stock') {
    $ref  = $_GET['ref'] ?? '';
    $cant = intval($_GET['cantidad'] ?? 1);
    if (!$ref) responder(['error' => 'Ref requerida'], 400);

    // Obtener producto
    $prod = $pdo->prepare("SELECT id, stock_neiva FROM productos WHERE ref = ?");
    $prod->execute([$ref]);
    $producto = $prod->fetch();
    if (!$producto) responder([], 200);

    // Obtener distribuidores activos con su sede
    $stmt = $pdo->query("
        SELECT u.usuario, u.nombre, u.apellido, s.id as sede_id, s.nombre as sede, s.tipo
        FROM usuarios u
        JOIN sedes s ON u.sede_id = s.id
        WHERE u.rol = 'distribuidor' AND u.estado = 'activo'
    ");
    $distribuidores = $stmt->fetchAll();

    $resultado = [];
    foreach ($distribuidores as $d) {
        // Stock según tipo de sede
        if ($d['tipo'] === 'central' || $d['sede'] === 'Almacen Central') {
            $stock = intval($producto['stock_neiva'] ?? 0);
        } else {
            $stock = stockUsuarioObtener($pdo, $producto['id'], $d['usuario']);
        }

        if ($stock >= $cant) {
            $resultado[] = [
                'usuario' => $d['usuario'],
                'nombre'  => trim(($d['nombre'] ?? '') . ' ' . ($d['apellido'] ?? '')),
                'sede'    => $d['sede'],
                'stock'   => $stock,
            ];
        }
    }
    responder($resultado);
}

responder(['error'=>'Acción no reconocida'],400);