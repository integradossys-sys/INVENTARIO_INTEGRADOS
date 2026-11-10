<?php
// Capturar errores como JSON para evitar HTML en respuesta
set_exception_handler(function($e){ http_response_code(500); header('Content-Type: application/json'); echo json_encode(['error' => $e->getMessage()]); exit; });
ini_set('display_errors', 0);
require 'config.php';
require_once 'auditoria.php';
require_once 'notificaciones.php';
sesionRequerida();

// Auto-migración: columna para saber a qué categoría de fibra pertenece
// una solicitud (necesaria para validar stock real de fibra al aprobar).
try {
    $pdo->exec("ALTER TABLE solicitudes ADD COLUMN categoria_fibra_id INT NULL");
} catch (\Throwable $e) { /* ya existe */ }

/* Metros de fibra realmente disponibles en el almacén central para una
   categoría dada. -1 = no se pudo determinar la categoría (no bloquear). */
function _fibraMetrosDisponiblesSol(PDO $pdo, $categoriaId): float {
    if (!$categoriaId) return -1;
    $centrales = $pdo->query("SELECT nombre FROM sedes WHERE tipo IN ('central','distribuidor') AND nombre NOT IN ('Sistema','Administración')")->fetchAll(PDO::FETCH_COLUMN);
    $centrales = array_values(array_unique($centrales));
    $ph = implode(',', array_fill(0, count($centrales), '?'));
    $st = $pdo->prepare("SELECT COALESCE(SUM(metros - metros_usados),0) FROM fibra_carretes WHERE categoria_id = ? AND sede_nombre IN ($ph)");
    $st->execute(array_merge([$categoriaId], $centrales));
    return (float)$st->fetchColumn();
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ══════════════════════════════════════
   LISTAR solicitudes
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'listar') {
    $where  = [];
    $params = [];

    $rol     = $_SESSION['rol'];
    $usuario = $_SESSION['usuario'] ?? '';

    // Distribuidor y superadmin ven todas (necesitan gestionar/aprobar).
    // Cualquier otro rol ve solo lo que ÉL solicitó, A MENOS que le hayan
    // dado a mano el permiso de gestionar/aprobar pedidos — en ese caso
    // también necesita ver las de los demás para poder gestionarlas.
    if ($rol !== 'distribuidor' && $rol !== 'superadmin'
        && !usuarioTienePermiso('gestionar_pedidos') && !usuarioTienePermiso('aprobar_pedidos')) {
        $where[]  = "solicitado_por = ?";
        $params[] = $usuario;
    }

    // Filtro por estado opcional
    if (!empty($_GET['estado'])) {
        $where[]  = "estado = ?";
        $params[] = $_GET['estado'];
    }

    $sql = "SELECT * FROM solicitudes" .
           ($where ? " WHERE " . implode(" AND ", $where) : "") .
           " ORDER BY fecha DESC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $resultado = array_map(function($s) {
        return [
            'id'              => $s['id'],
            'ref'             => $s['ref'],
            'nombre'          => $s['nombre'],
            'destino'         => $s['destino'],
            'cantidad'        => (int)$s['cantidad'],
            'unidadEnvio'     => $s['unidad_envio'],
            'solicitadoPor'   => $s['solicitado_por'],
            'gestionadoPor'   => $s['gestionado_por'] ?? '',
            'estado'          => $s['estado'],
            'nota'            => $s['nota'] ?? '',
            'motivo'          => $s['motivo'] ?? '',
            'aprobadoPor'     => $s['aprobado_por'] ?? '',
            'fecha'           => $s['fecha'],
            'fechaRespuesta'  => $s['fecha_respuesta'] ?? null,
            'origenPedidoId'      => $s['origen_pedido_id']      ?? null,
            'pedidoAgrupadoId'    => $s['pedido_agrupado_id']    ?? null,
            'cantidadAprobada'    => $s['cantidad_aprobada']     ?? null,
        ];
    }, $rows);

    responder($resultado);
}

/* ══════════════════════════════════════
   CREAR solicitud
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'crear') {
    $data = json_decode(file_get_contents('php://input'), true);

    // Si es una solicitud de EQUIPO (OLT o cualquier tipo de "tipos_equipo"),
    // no se deja pedir lo que de verdad no existe en el almacén central —
    // antes se podía crear la solicitud igual aunque el conteo estuviera en
    // 0, y quedaba pendiente para siempre sin que nadie pudiera despacharla.
    $refSol = trim($data['ref'] ?? '');
    if (str_starts_with($refSol, 'EQUIPO::')) {
        $tipoEquipoSol = substr($refSol, 8);
        $cantPedidaSol = intval($data['cantidad'] ?? 0);
        $centralesSol = $pdo->query("SELECT nombre FROM sedes WHERE tipo IN ('central','distribuidor')")->fetchAll(PDO::FETCH_COLUMN);
        $centralesSol = array_values(array_unique(array_merge($centralesSol, ['Almacen Central'])));
        $phSol = implode(',', array_fill(0, count($centralesSol), '?'));
        if (strcasecmp($tipoEquipoSol, 'OLT') === 0) {
            $dispSol = $pdo->prepare("SELECT COUNT(*) FROM olts WHERE estado = 'activo' AND sede IN ($phSol)");
        } else {
            $dispSol = $pdo->prepare("SELECT COUNT(*) FROM mikrotiks WHERE estado = 'activo' AND tipo_equipo = ? AND sede IN ($phSol)");
        }
        $paramsSol = strcasecmp($tipoEquipoSol, 'OLT') === 0 ? $centralesSol : array_merge([$tipoEquipoSol], $centralesSol);
        $dispSol->execute($paramsSol);
        $disponibleSol = (int)$dispSol->fetchColumn();
        if ($disponibleSol <= 0) {
            responder(['error' => "No hay $tipoEquipoSol disponibles en el almacén ahora mismo — no se puede pedir."], 400);
        }
        if ($cantPedidaSol > $disponibleSol) {
            responder(['error' => "Solo hay $disponibleSol $tipoEquipoSol disponible(s) en el almacén."], 400);
        }
    }

    // La columna id de 'solicitudes' es VARCHAR sin auto_increment (igual que en
    // pedidos_agrupados.php), así que hay que generarlo nosotros.
    $id   = uniqid('sol_', true);
    $cols = $pdo->query("SHOW COLUMNS FROM solicitudes")->fetchAll(PDO::FETCH_COLUMN);

    $vals = [
        'id'                 => $id,
        'ref'                => $data['ref']            ?? '',
        'nombre'             => $data['nombre']         ?? '',
        'destino'            => $data['destino']        ?? '',
        'cantidad'           => intval($data['cantidad'] ?? 0),
        'unidad_envio'       => $data['unidadEnvio']    ?? 'unidad',
        'solicitado_por'     => $data['solicitadoPor']  ?? $_SESSION['usuario'],
        'estado'             => 'pendiente',
        'nota'               => $data['nota']           ?? '',
        'origen_pedido_id'   => $data['origenPedidoId'] ?? null,
        'categoria_fibra_id' => $data['categoria_fibra_id'] ?? null,
    ];
    $c = []; $p = []; $par = [];
    foreach ($vals as $col => $val) {
        if (in_array($col, $cols)) { $c[] = $col; $p[] = '?'; $par[] = $val; }
    }
    if (in_array('fecha', $cols)) { $c[] = 'fecha'; $p[] = 'NOW()'; }

    $pdo->prepare("INSERT INTO solicitudes (" . implode(',', $c) . ") VALUES (" . implode(',', $p) . ")")
        ->execute($par);

    try {
        $cant   = intval($data['cantidad'] ?? 0);
        $unidad = ($data['unidadEnvio'] ?? '') === 'metros' ? 'mts.' : 'uds.';
        notificarNuevoPedidoAdmin(
            $pdo,
            $data['solicitadoPor'] ?? $_SESSION['usuario'],
            $data['destino'] ?? '',
            "{$cant} {$unidad} de \"" . ($data['nombre'] ?? '') . "\"" . (!empty($data['nota']) ? " — Nota: " . $data['nota'] : ''),
            'solicitudes'
        );
    } catch (\Throwable $e) { error_log('[solicitudes/crear notif] '.$e->getMessage()); }

    auditar($pdo, 'crear_solicitud', 'solicitudes', "Solicitó {$cant} {$unidad} de \"" . ($data['nombre'] ?? '') . "\" para " . ($data['destino'] ?? ''), $id);
    responder(['ok' => true, 'id' => $id]);
}

/* ══════════════════════════════════════
   APROBAR solicitud (superadmin)
   Mueve el stock y registra en historial
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'aprobar') {
    rolOPermiso(['superadmin'], 'aprobar_pedidos');
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = $data['id'] ?? '';
    if (!$id) responder(['error' => 'ID requerido'], 400);

    // Obtener solicitud
    $sol = $pdo->prepare("SELECT * FROM solicitudes WHERE id = ?");
    $sol->execute([$id]);
    $s = $sol->fetch();
    if (!$s) responder(['error' => 'Solicitud no encontrada'], 404);
    if ($s['estado'] !== 'pendiente' && $s['estado'] !== 'en_gestion') responder(['error' => 'La solicitud ya fue procesada'], 400);

    // Obtener producto (FIBRA, ONT:: y EQUIPO:: no viven en la tabla
    // productos ni controlan su stock por stock_neiva — se arma un
    // producto "virtual" para esos, igual que ya se hacía solo con FIBRA.
    // Sin esto, aprobar una solicitud de OLT/Mikrotik u ONT individual
    // fallaba con "Producto no encontrado".
    $esFibra  = ($s['ref'] === 'FIBRA');
    $esOnt    = (stripos($s['ref'] ?? '', 'ONT::') === 0);
    $esEquipo = (stripos($s['ref'] ?? '', 'EQUIPO::') === 0);
    if ($esFibra || $esOnt || $esEquipo) {
        $p = [
            'id'          => 0,
            'ref'         => $s['ref'],
            'nombre'      => $s['nombre'] ?? ($esFibra ? 'Fibra óptica' : $s['ref']),
            'stock_neiva' => 999999,
            'unidadEnvio' => $esFibra ? 'metros' : 'unidad',
        ];
    } else {
        $prod = $pdo->prepare("SELECT * FROM productos WHERE ref = ?");
        $prod->execute([$s['ref']]);
        $p = $prod->fetch();
        if (!$p) responder(['error' => 'Producto no encontrado'], 404);
    }

    // Usar cantidad_aprobada si existe, si no usar cantidad original
    $cant = !empty($s['cantidad_aprobada']) ? (int)$s['cantidad_aprobada'] : (int)$s['cantidad'];

    // Detectar si el solicitante tiene permiso enviar_material (descuenta de SU stock personal)
    $solicitante = $s['solicitado_por'] ?? '';
    $userRow = $pdo->prepare("SELECT u.permisos FROM usuarios u WHERE u.usuario = ?");
    $userRow->execute([$solicitante]);
    $userInfo = $userRow->fetch();
    $tienePermisoEnvio = false;

    if ($userInfo) {
        $perms = json_decode($userInfo['permisos'] ?? '[]', true) ?? [];
        $tienePermisoEnvio = in_array('enviar_material', $perms);
    }

    // Stock se moverá cuando se marque "en camino" en seguimiento
    if ($esFibra) {
        // Validar metros reales disponibles en el almacén central para esta categoría.
        $metrosDisp = _fibraMetrosDisponiblesSol($pdo, $s['categoria_fibra_id'] ?? null);
        if ($metrosDisp >= 0 && $cant > $metrosDisp) {
            responder(['error' => "Stock de fibra insuficiente en el almacén. Disponible: {$metrosDisp} m"], 400);
        }
    } else {
        // Si la solicitud viene escalada (en_gestion), siempre verifica stock en Neiva
        // independientemente del rol del solicitante
        $esEscalada = ($s['estado'] === 'en_gestion' || !empty($s['gestionado_por']));

        // El superadmin y el distribuidor SIEMPRE aprueban desde el almacén
        // central (stock_neiva/stock_recuperado) — ninguno de los 2 tiene
        // "stock personal" propio, aunque distribuidor sí tenga el permiso
        // enviar_material (que es para enviar DESDE el almacén, no desde
        // un inventario suyo).
        $aprobadorRol = $_SESSION['rol'] ?? '';
        $esAprobadorAdmin = in_array($aprobadorRol, ['superadmin', 'distribuidor']);

        if ($tienePermisoEnvio && $solicitante && !$esEscalada && !$esAprobadorAdmin) {
            $stockActual = stockUsuarioObtener($pdo, $p['id'], $solicitante);
            if ($stockActual < $cant) {
                responder(['error' => 'Stock insuficiente en tu inventario personal'], 400);
            }
        } else {
            if ($cant > (int)$p['stock_neiva'] + (int)($p['stock_recuperado'] ?? 0)) { // nuevo + recuperado
                responder(['error' => 'Stock insuficiente en el almacén central'], 400);
            }
        }
    }

    // NOTA: El stock en la sede destino se suma únicamente cuando el municipio
    // confirma la recepción (seguimiento.php → acción 'recibido').
    // No se toca el stock aquí para evitar duplicación.

    // Crear registro de seguimiento (stock se mueve al marcar en camino)
    // Determinar origen del envío — si viene escalada siempre sale de Neiva
    $esEscalada = ($s['estado'] === 'en_gestion' || !empty($s['gestionado_por']));
    $origen = 'Almacen Central';
    // El origen "stock personal de quien solicitó" solo aplica a productos
    // REALES con inventario personal (tabla stock_usuarios). ONT y equipos
    // (OLT/Mikrotik) no tienen inventario personal — sus unidades viven en
    // ont_seriales/olts/mikrotiks, siempre "centralizadas" — así que forzar
    // aquí un origen distinto de 'Almacen Central' rompía la búsqueda de
    // unidades disponibles al despachar (el origen se usa como la sede
    // donde buscar el equipo físico, y un nombre de usuario nunca coincide
    // con ninguna sede real).
    if ($tienePermisoEnvio && $solicitante && !$esEscalada && !$esAprobadorAdmin && !$esOnt && !$esEquipo) {
        $origen = $solicitante; // sale del stock personal de quien solicitó
    }

    // Resetear cualquier seguimiento previo para esta solicitud (sin importar estado)
    $segExiste = $pdo->prepare("SELECT id, estado FROM envios_seguimiento WHERE tipo='solicitud' AND referencia_id=? ORDER BY id DESC LIMIT 1");
    $segExiste->execute([$id]);
    $segRow = $segExiste->fetch();
    if ($segRow) {
        // Si estaba en_camino el stock ya fue descontado, hay que devolverlo
        if ($segRow['estado'] === 'en_camino' && !$esFibra) {
            if ($origen === 'Almacen Central') {
                $pdo->prepare("UPDATE productos SET stock_neiva = stock_neiva + ? WHERE id=?")
                    ->execute([$cant, $p['id']]);
            } else {
                // Salió del stock personal de $origen (el usuario) — se le devuelve.
                stockUsuarioAjustar($pdo, $p['id'], $origen, $cant);
            }
        }
        $pdo->prepare("UPDATE envios_seguimiento SET estado='aprobado', ref_producto=?, nombre_producto=?, cantidad=?, unidad=?, origen=?, destino=?, enviado_por=?, fecha_aprobado=NOW(), transportador=NULL, fecha_envio=NULL WHERE id=?")
            ->execute([$p['ref'], $p['nombre'], $cant, $s['unidad_envio'] ?? 'unidad', $origen, $s['destino'], $_SESSION['usuario'], $segRow['id']]);
    } else {
        $pdo->prepare("
            INSERT INTO envios_seguimiento
              (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, estado, fecha_aprobado)
            VALUES ('solicitud', ?, ?, ?, ?, ?, ?, ?, ?, 'aprobado', NOW())
        ")->execute([
            $id, $p['ref'], $p['nombre'], $cant,
            $s['unidad_envio'] ?? 'unidad',
            $origen, $s['destino'],
            $_SESSION['usuario']
        ]);
    }

    // Cantidad aprobada y observación del admin/distribuidor
    $cantAprobada = isset($data['cantidadAprobada']) ? intval($data['cantidadAprobada']) : $s['cantidad'];
    $observacion  = trim($data['observacion'] ?? '');
    if ($cantAprobada < 1) $cantAprobada = $s['cantidad'];

    // Actualizar solicitud
    $pdo->prepare("
        UPDATE solicitudes SET estado='aprobada', aprobado_por=?, cantidad_aprobada=?, fecha_respuesta=NOW() WHERE id=?
    ")->execute([$_SESSION['usuario'], $cantAprobada, $id]);

    // Guardar observación en la solicitud misma (campo motivo = observación del admin)
    if ($observacion) {
        $pdo->prepare("UPDATE solicitudes SET motivo=? WHERE id=?")
            ->execute([$observacion, $id]);
    }

    // Si vino de pedido municipio, marcarlo como atendido
    if (!empty($s['origen_pedido_id'])) {
        $pdo->prepare("UPDATE pedidos_municipio SET estado='atendido', fecha_respuesta=NOW() WHERE id=?")
            ->execute([$s['origen_pedido_id']]);
    }

    auditar($pdo, 'aprobar', 'solicitudes', "Solicitud aprobada: {$s['nombre']} → {$s['destino']} ({$cantAprobada}/{$s['cantidad']})", $s['ref']);
    notificarAprobacion($pdo, $id);
    require_once __DIR__ . '/ont_compromiso_lib.php';
    responder(['ok' => true, 'aviso' => $esOnt ? ontAvisoCompromiso($pdo, (string)$s['ref']) : '']);
}

/* ══════════════════════════════════════
   ESCALAR solicitud (distribuidor → superadmin)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'escalar') {
    rolRequerido('distribuidor');
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = $data['id'] ?? '';
    if (!$id) responder(['error' => 'ID requerido'], 400);

    $sol = $pdo->prepare("SELECT * FROM solicitudes WHERE id = ?");
    $sol->execute([$id]);
    $s = $sol->fetch();
    if (!$s) responder(['error' => 'Solicitud no encontrada'], 404);
    if ($s['estado'] !== 'pendiente') responder(['error' => 'La solicitud ya fue procesada'], 400);

    $pdo->prepare("UPDATE solicitudes SET estado='en_gestion', gestionado_por=? WHERE id=?")
        ->execute([$_SESSION['usuario'], $id]);

    auditar($pdo, 'aprobar', 'solicitudes', "Solicitud escalada por distribuidor: {$s['nombre']} → {$s['destino']}", $s['ref']);
    require_once 'notificaciones.php';
    notificarEscalada($pdo, $id);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   RECHAZAR solicitud
══════════════════════════════════════ */
/* ══ CANCELAR (solo quien la pidió y mientras siga pendiente) ══ */
if ($method === 'POST' && $action === 'cancelar') {
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = $data['id'] ?? '';
    if (!$id) responder(['error' => 'ID requerido'], 400);
    $st = $pdo->prepare("SELECT solicitado_por, estado, pedido_agrupado_id FROM solicitudes WHERE id = ?");
    $st->execute([$id]);
    $s = $st->fetch();
    if (!$s) responder(['error' => 'Solicitud no encontrada'], 404);
    if ($s['solicitado_por'] !== ($_SESSION['usuario'] ?? '')) responder(['error' => 'Solo quien hizo la solicitud la puede cancelar'], 403);
    if (!empty($s['pedido_agrupado_id'])) responder(['error' => 'Esta solicitud es parte de un pedido múltiple; cancela el pedido completo'], 400);
    $del = $pdo->prepare("DELETE FROM solicitudes WHERE id = ? AND estado = 'pendiente'");
    $del->execute([$id]);
    if ($del->rowCount() === 0) responder(['error' => 'Esta solicitud ya fue procesada, no se puede cancelar'], 409);
    try { auditar($pdo, 'cancelar', 'solicitudes', "Canceló su solicitud pendiente: $id" . (($data['nota'] ?? '') !== '' ? " — Nota: " . mb_substr(trim($data['nota']), 0, 300) : ''), $id); } catch (\Throwable $e) { error_log('[cancelar/auditar] ' . $e->getMessage()); }
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
            responder(['error' => 'No tienes permiso para rechazar solicitudes'], 403);
        }
    }
    $data   = json_decode(file_get_contents('php://input'), true);
    $id     = $data['id']     ?? '';
    $motivo = $data['motivo'] ?? '';

    if (!$id) responder(['error' => 'ID requerido'], 400);

    try {
        // Verificar que existe y está pendiente
        $sol = $pdo->prepare("SELECT estado FROM solicitudes WHERE id = ?");
        $sol->execute([$id]);
        $s = $sol->fetch();
        if (!$s) responder(['error' => 'Solicitud no encontrada'], 404);
        if ($s['estado'] !== 'pendiente') responder(['error' => 'La solicitud ya fue procesada'], 400);

        // Detectar qué columnas existen para no fallar si falta alguna.
        $cols = $pdo->query("SHOW COLUMNS FROM solicitudes")->fetchAll(PDO::FETCH_COLUMN);
        $set = ["estado='rechazada'"];
        $params = [];
        if (in_array('motivo', $cols))          { $set[] = "motivo=?";          $params[] = $motivo; }
        if (in_array('rechazado_por', $cols))   { $set[] = "rechazado_por=?";   $params[] = $_SESSION['usuario'] ?? ''; }
        if (in_array('fecha_respuesta', $cols)) { $set[] = "fecha_respuesta=NOW()"; }
        $params[] = $id;

        $sql = "UPDATE solicitudes SET " . implode(', ', $set) . " WHERE id=?";
        $pdo->prepare($sql)->execute($params);

        // Auditoría y notificación: no deben tumbar la operación si fallan.
        try { auditar($pdo, 'rechazar', 'solicitudes', "Solicitud rechazada: $id — $motivo", $id); } catch (\Throwable $e) { error_log('[rechazar/auditar] ' . $e->getMessage()); }
        try { notificarRechazo($pdo, $id, $motivo); } catch (\Throwable $e) { error_log('[rechazar/notif] ' . $e->getMessage()); }

        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[solicitudes/rechazar] ' . $e->getMessage());
        responder(['error' => 'No se pudo rechazar: ' . $e->getMessage()], 500);
    }
}

responder(['error' => 'Acción no reconocida'], 400);
