<?php
/* ══════════════════════════════════════════════════════
   auditoria.php — Integrados
   Doble uso:
   1. Helper incluido desde otros endpoints (define auditar())
   2. Endpoint directo para listar/consultar
══════════════════════════════════════════════════════ */

/* ── Función helper ── */
if (!function_exists('auditar')) {
    // Detecta la IP real del usuario — si el servidor está detrás de un
    // proxy/CDN (común en hosting compartido), REMOTE_ADDR muestra la IP
    // del proxy, no la del usuario real. Se revisan los encabezados que
    // los proxies suelen usar para preservarla, antes de caer en REMOTE_ADDR.
    function _ipReal() {
        $candidatos = ['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'HTTP_X_REAL_IP', 'REMOTE_ADDR'];
        foreach ($candidatos as $key) {
            if (!empty($_SERVER[$key])) {
                // X-Forwarded-For puede traer varias IPs separadas por coma
                // (la del usuario, luego las de cada proxy intermedio) — la
                // primera es la real.
                $ip = trim(explode(',', $_SERVER[$key])[0]);
                if (filter_var($ip, FILTER_VALIDATE_IP)) return $ip;
            }
        }
        return $_SERVER['REMOTE_ADDR'] ?? '';
    }
    function auditar($pdo, $accion, $modulo, $detalle = '', $referencia = '') {
        try {
            $usuario = $_SESSION['usuario'] ?? 'sistema';
            $rol     = $_SESSION['rol']     ?? '';
            $sede    = $_SESSION['sede']    ?? '';
            $ip      = _ipReal();
            // Truncar campos largos para evitar errores de BD
            $detalle    = mb_substr((string)$detalle,    0, 500);
            $referencia = mb_substr((string)$referencia, 0, 100);
            $accion     = mb_substr((string)$accion,     0, 100);
            $modulo     = mb_substr((string)$modulo,     0, 100);
            $stmt = $pdo->prepare("
                INSERT INTO auditoria (usuario, rol, sede, accion, modulo, tabla, detalle, ref, ip, fecha)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
            ");
            $stmt->execute([$usuario, $rol, $sede, $accion, $modulo, $modulo, $detalle, $referencia, $ip]);
        } catch (Throwable $e) {
            // No interrumpir el flujo principal pero sí loguear
            error_log('[AUDITORIA ERROR] ' . $e->getMessage() . ' | SQL data: ' . json_encode([$usuario,$rol,$sede,$accion,$modulo,$detalle,$referencia,$ip]));
        }
    }
}

/* ── Solo procesar como endpoint si se llama directamente ── */
if (basename($_SERVER['SCRIPT_FILENAME']) === 'auditoria.php') {
    require_once 'config.php';
    sesionRequerida();

    $method = $_SERVER['REQUEST_METHOD'];
    $action = $_GET['action'] ?? '';

    if ($method === 'GET' && $action === 'listar') {
        rolRequerido('superadmin');
        $where = []; $params = [];
        if (!empty($_GET['usuario']))     { $where[] = "usuario LIKE ?";    $params[] = '%'.$_GET['usuario'].'%'; }
        if (!empty($_GET['modulo']))      { $where[] = "modulo = ?";        $params[] = $_GET['modulo']; }
        if (!empty($_GET['accion']))      { $where[] = "accion = ?";        $params[] = $_GET['accion']; }
        if (!empty($_GET['sede']))        { $where[] = "sede LIKE ?";       $params[] = '%'.$_GET['sede'].'%'; }
        if (!empty($_GET['fecha']))       { $where[] = "DATE(fecha) >= ?";  $params[] = $_GET['fecha']; }
        if (!empty($_GET['fecha_hasta'])) { $where[] = "DATE(fecha) <= ?";  $params[] = $_GET['fecha_hasta']; }
        $pagina    = max(1, intval($_GET['pagina']    ?? 1));
        $porPagina = max(10, min(100, intval($_GET['por_pagina'] ?? 50)));
        $offset    = ($pagina - 1) * $porPagina;

        // Total con filtros
        $sqlCount = "SELECT COUNT(*) FROM auditoria" . ($where ? " WHERE ".implode(" AND ",$where) : "");
        $stmtC = $pdo->prepare($sqlCount);
        $stmtC->execute($params);
        $total = (int)$stmtC->fetchColumn();

        $sql = "SELECT *, ref as referencia FROM auditoria"
             . ($where ? " WHERE ".implode(" AND ",$where) : "")
             . " ORDER BY fecha DESC LIMIT $porPagina OFFSET $offset";
        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);

        responder([
            'registros'  => $stmt->fetchAll(),
            'total'      => $total,
            'pagina'     => $pagina,
            'por_pagina' => $porPagina,
            'paginas'    => (int)ceil($total / $porPagina),
        ]);
    }

    if ($method === 'POST' && $action === 'registrar') {
        rolRequerido('superadmin');
        $data = json_decode(file_get_contents('php://input'), true);
        auditar($pdo, $data['accion'] ?? '', $data['modulo'] ?? '', $data['detalle'] ?? '', $data['referencia'] ?? '');
        responder(['ok' => true]);
    }

    if ($method === 'GET' && $action === 'resumen') {
        rolRequerido('superadmin');
        $stmt = $pdo->query("SELECT modulo, accion, COUNT(*) as total FROM auditoria WHERE fecha >= DATE_SUB(NOW(), INTERVAL 30 DAY) GROUP BY modulo, accion ORDER BY total DESC");
        responder($stmt->fetchAll());
    }

    if ($method === 'GET' && $action === 'resumen_usuario') {
        rolRequerido('superadmin');
        $stmt = $pdo->query("
            SELECT usuario, COUNT(*) as total
            FROM auditoria
            WHERE fecha >= DATE_SUB(NOW(), INTERVAL 30 DAY)
              AND usuario != 'sistema'
            GROUP BY usuario
            ORDER BY total DESC
            LIMIT 1
        ");
        $row = $stmt->fetch();
        responder($row ?: ['usuario' => '—', 'total' => 0]);
    }

    responder(['error' => 'Acción no reconocida'], 400);
}