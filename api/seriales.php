<?php
require 'config.php';
require_once 'auditoria.php';
sesionRequerida();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ══════════════════════════════════════
   LISTAR seriales de un producto
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'listar') {
    $producto_id = intval($_GET['producto_id'] ?? 0);
    $params = [];
    $where  = [];

    if ($producto_id) {
        $where[]  = "producto_id = ?";
        $params[] = $producto_id;
    }
    if (!empty($_GET['sede'])) {
        $where[]  = "sede_nombre = ?";
        $params[] = $_GET['sede'];
    }

    $sql = "SELECT * FROM equipos_seriales"
         . ($where ? " WHERE " . implode(" AND ", $where) : "")
         . " ORDER BY fecha DESC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    responder($stmt->fetchAll());
}

/* ══════════════════════════════════════
   PARSEAR código de barras escaneado
   Detecta automáticamente qué campo es
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'parsear') {
    $data  = json_decode(file_get_contents('php://input'), true);
    $codigo = trim($data['codigo'] ?? '');

    if (!$codigo) responder(['error' => 'Código vacío'], 400);

    $resultado = _parsearCodigo($codigo);
    responder($resultado);
}

/* ══════════════════════════════════════
   REGISTRAR lote completo
   Recibe: producto_id, lista de unidades
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'registrar_lote') {
    // Acepta cualquiera de los 2 permisos — el normal (registrar_ingresos,
    // para llegadas al almacén) o el de campo (registrar_ont_campo, para
    // que un técnico/municipio/persona registre una ONT que nunca había
    // estado en el sistema, ej: para poder devolverla).
    sesionRequerida();
    if (!in_array($_SESSION['rol'], ['superadmin'])) {
        $stPerm = $pdo->prepare("SELECT permisos FROM usuarios WHERE id = ?");
        $stPerm->execute([$_SESSION['usuario_id'] ?? 0]);
        $permsLote = json_decode($stPerm->fetchColumn() ?: '[]', true) ?: [];
        if (empty($permsLote)) $permsLote = PERMISOS_DEFAULT_POR_ROL[$_SESSION['rol']] ?? [];
        if (!in_array('registrar_ingresos', $permsLote) && !in_array('registrar_ont_campo', $permsLote)) {
            responder(['error' => 'Sin permisos para esta acción'], 403);
        }
    }
    $data       = json_decode(file_get_contents('php://input'), true);
    $producto_id = intval($data['producto_id'] ?? 0);
    $unidades    = $data['unidades'] ?? [];   // array de {pn, mac, sn, hw, sw, descripcion}
    $sede_nombre = $data['sede']     ?? 'Almacen Central';

    if (!$producto_id || empty($unidades)) {
        responder(['error' => 'Datos incompletos'], 400);
    }

    // Obtener ref del producto
    $prod = $pdo->prepare("SELECT ref, nombre, stock_neiva FROM productos WHERE id = ?");
    $prod->execute([$producto_id]);
    $p = $prod->fetch();
    if (!$p) responder(['error' => 'Producto no encontrado'], 404);

    // Obtener sede_id
    $sedeRow = $pdo->prepare("SELECT id FROM sedes WHERE nombre = ?");
    $sedeRow->execute([$sede_nombre]);
    $sede = $sedeRow->fetch();
    $sede_id = $sede ? $sede['id'] : null;

    $insertados = 0;
    $duplicados = 0;
    $stmt = $pdo->prepare("
        INSERT INTO equipos_seriales
          (producto_id, producto_ref, pn, descripcion, mac, sn, hw_version, sw_version, sede_id, sede_nombre, registrado_por)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");

    foreach ($unidades as $u) {
        // Verificar duplicado por SN
        if (!empty($u['sn'])) {
            $dup = $pdo->prepare("SELECT id FROM equipos_seriales WHERE sn = ?");
            $dup->execute([$u['sn']]);
            if ($dup->fetch()) { $duplicados++; continue; }
        }
        $stmt->execute([
            $producto_id,
            $p['ref'],
            $u['pn']          ?? '',
            $u['descripcion'] ?? '',
            $u['mac']         ?? '',
            $u['sn']          ?? '',
            $u['hw']          ?? '',
            $u['sw']          ?? '',
            $sede_id,
            $sede_nombre,
            $_SESSION['usuario'],
        ]);
        $insertados++;
    }

    // Sumar al stock_neiva del producto
    if ($insertados > 0) {
        $pdo->prepare("UPDATE productos SET stock_neiva = stock_neiva + ? WHERE id = ?")
            ->execute([$insertados, $producto_id]);

        // Registrar en historial
        $pdo->prepare("
            INSERT INTO historial
              (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha)
            VALUES (?, ?, 'Almacen Central', ?, 'unidad', ?, ?, 'aprobado', 0, 'directo', NOW())
        ")->execute([
            $p['ref'], $p['nombre'], $insertados,
            $_SESSION['usuario'],
            "Ingreso por escaneo de códigos de barras ($insertados unidades)"
        ]);

        auditar($pdo, 'ingreso', 'seriales', "Ingreso por escaneo: {$p['nombre']} x{$insertados} ($duplicados duplicados omitidos)", $p['ref']);
    }

    responder([
        'ok'         => true,
        'insertados' => $insertados,
        'duplicados' => $duplicados,
        'total'      => count($unidades),
    ]);
}

/* ══════════════════════════════════════
   ELIMINAR serial
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'eliminar') {
    rolRequerido('superadmin');
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);

    // Restar del stock
    $ser = $pdo->prepare("SELECT producto_id, sede_nombre FROM equipos_seriales WHERE id = ?");
    $ser->execute([$id]);
    $s = $ser->fetch();
    if ($s) {
        if (strtolower($s['sede_nombre']) === 'neiva') {
            $pdo->prepare("UPDATE productos SET stock_neiva = GREATEST(0, stock_neiva - 1) WHERE id = ?")
                ->execute([$s['producto_id']]);
        } else {
            $pdo->prepare("
                UPDATE stock_sedes ss
                JOIN sedes se ON se.nombre = ?
                SET ss.cantidad = GREATEST(0, ss.cantidad - 1)
                WHERE ss.producto_id = ? AND ss.sede_id = se.id
            ")->execute([$s['sede_nombre'], $s['producto_id']]);
        }
    }
    $pdo->prepare("DELETE FROM equipos_seriales WHERE id = ?")->execute([$id]);
    auditar($pdo, 'eliminar', 'seriales', "Serial eliminado (id $id)", (string)$id);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   PARSER de códigos de barras Huawei
   Detecta tipo por prefijo o longitud
══════════════════════════════════════ */
function _parsearCodigo($raw) {
    // Limpiar caracteres de control que algunos lectores añaden
    $codigo = preg_replace('/[\x00-\x1F\x7F]/', '', trim($raw));

    $resultado = [
        'raw'    => $codigo,
        'tipo'   => 'desconocido',
        'campos' => [],
    ];

    // ── Huawei GS1-128 completo (contiene MAC, SN, P/N en un solo escaneo) ──
    // Formato típico: (1P)PXXXX (Q)Qty (MAC)... (SN)...
    if (preg_match('/\(1P\)([^\s\(]+)/i', $codigo, $m)) {
        $resultado['tipo']         = 'caja_completa';
        $resultado['campos']['pn'] = $m[1];
    }
    if (preg_match('/\(Q\)Qty[:\s]*(\d+)/i', $codigo, $m)) {
        $resultado['campos']['qty'] = intval($m[1]);
    }
    if (preg_match('/MAC[:\s]*([0-9A-Fa-f]{12}|(?:[0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2})/i', $codigo, $m)) {
        $resultado['campos']['mac'] = strtoupper(str_replace([':','-'], '', $m[1]));
        $resultado['campos']['mac_fmt'] = implode(':', str_split($resultado['campos']['mac'], 2));
    }
    if (preg_match('/\bSN[:\s]*([A-Z0-9]{6,20})/i', $codigo, $m)) {
        $resultado['campos']['sn'] = strtoupper($m[1]);
    }
    if (preg_match('/HW\s*M[\.:\s]*([^\s]+)/i', $codigo, $m)) {
        $resultado['campos']['hw'] = $m[1];
    }
    if (preg_match('/S\/W\s*VER[:\s]*([^\s]+)/i', $codigo, $m)) {
        $resultado['campos']['sw'] = $m[1];
    }
    if (preg_match('/Description[:\s]*(.+?)(?:\n|$)/i', $codigo, $m)) {
        $resultado['campos']['descripcion'] = trim($m[1]);
    }

    // ── Escaneo individual de código MAC (12 hex sin separadores) ──
    if (empty($resultado['campos']) && preg_match('/^[0-9A-Fa-f]{12}$/', $codigo)) {
        $resultado['tipo']             = 'mac';
        $resultado['campos']['mac']    = strtoupper($codigo);
        $resultado['campos']['mac_fmt']= implode(':', str_split(strtoupper($codigo), 2));
    }

    // ── Escaneo individual de SN ──
    if (empty($resultado['campos']) && preg_match('/^[A-Z0-9]{8,20}$/i', $codigo)) {
        $resultado['tipo']          = 'sn';
        $resultado['campos']['sn']  = strtoupper($codigo);
    }

    // Si se detectó al menos el P/N o MAC, marcar como exitoso
    if (!empty($resultado['campos'])) {
        $resultado['ok'] = true;
    } else {
        $resultado['ok']    = false;
        $resultado['error'] = 'No se pudo interpretar el código escaneado';
    }

    return $resultado;
}

responder(['error' => 'Acción no reconocida'], 400);