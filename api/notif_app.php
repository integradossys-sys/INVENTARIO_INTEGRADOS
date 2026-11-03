<?php
/* ══════════════════════════════════════════════════════
   notif_app.php — Integrados S&S
   Backend de la campana de notificaciones dentro de la app
   (NO es correo — eso lo maneja notificaciones.php).
   Cada usuario ve solo sus propias notificaciones.
══════════════════════════════════════════════════════ */
require 'config.php';
sesionRequerida();

$method  = $_SERVER['REQUEST_METHOD'];
$action  = $_GET['action'] ?? '';
$usuario = $_SESSION['usuario'] ?? '';

/* ── Asegurar que la tabla exista ─────────────────────── */
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS notif_app (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        usuario    VARCHAR(60) NOT NULL,
        notif_key  VARCHAR(120) NOT NULL,
        tipo       VARCHAR(30) DEFAULT 'solicitud',
        titulo     VARCHAR(200) NOT NULL,
        msg        VARCHAR(400) DEFAULT '',
        accion     VARCHAR(60) DEFAULT '',
        fecha      VARCHAR(40) DEFAULT '',
        leida      TINYINT(1) DEFAULT 0,
        creado_en  DATETIME DEFAULT NOW(),
        UNIQUE KEY uq_usuario_key (usuario, notif_key)
    )");
} catch (\Throwable $e) { error_log('[notif_app/crear tabla] '.$e->getMessage()); }

/* ══ LISTAR — notificaciones del usuario logueado ══════ */
if ($method === 'GET' && $action === 'listar') {
    // Avisos de inspección SST (se generan como máximo 1 vez por hora, al entrar cualquier usuario)
    try { require_once __DIR__.'/notificaciones.php'; require_once __DIR__.'/sst_avisos_lib.php'; sstGenerarAvisos($pdo); } catch (\Throwable $e) {}
    try {
        $stmt = $pdo->prepare("
            SELECT notif_key as id, tipo, titulo, msg, accion, fecha, leida
            FROM notif_app
            WHERE usuario = ?
            ORDER BY creado_en DESC
            LIMIT 100
        ");
        $stmt->execute([$usuario]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) { $r['leida'] = (bool)$r['leida']; }
        responder($rows);
    } catch (\Throwable $e) {
        error_log('[notif_app/listar] '.$e->getMessage());
        responder([]);
    }
}

/* ══ PUSH_LOTE — guardar notificaciones nuevas generadas en el navegador ══ */
if ($method === 'POST' && $action === 'push_lote') {
    $d = json_decode(file_get_contents('php://input'), true);
    $lista = $d['notificaciones'] ?? [];
    if (!is_array($lista) || !$lista) responder(['ok' => true, 'nuevas' => []]);

    $nuevas = [];
    try {
        $ins = $pdo->prepare("
            INSERT IGNORE INTO notif_app (usuario, notif_key, tipo, titulo, msg, accion, fecha, leida)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ");
        foreach ($lista as $n) {
            $key = trim($n['id'] ?? '');
            if ($key === '') continue;
            $ins->execute([
                $usuario, $key,
                trim($n['tipo'] ?? 'solicitud'),
                trim($n['titulo'] ?? ''),
                trim($n['msg'] ?? ''),
                trim($n['accion'] ?? ''),
                trim($n['fecha'] ?? ''),
            ]);
            if ($ins->rowCount() > 0) $nuevas[] = $key; // rowCount 0 = ya existía (INSERT IGNORE)
        }
        responder(['ok' => true, 'nuevas' => $nuevas]);
    } catch (\Throwable $e) {
        error_log('[notif_app/push_lote] '.$e->getMessage());
        responder(['error' => 'No se pudo guardar: ' . $e->getMessage()], 500);
    }
}

/* ══ MARCAR_LEIDAS — todas las del usuario ═════════════ */
if ($method === 'POST' && $action === 'marcar_leidas') {
    try {
        $pdo->prepare("UPDATE notif_app SET leida = 1 WHERE usuario = ?")->execute([$usuario]);
        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[notif_app/marcar_leidas] '.$e->getMessage());
        responder(['error' => 'No se pudo actualizar'], 500);
    }
}

/* ══ ELIMINAR — una notificación puntual ═══════════════ */
if ($method === 'POST' && $action === 'eliminar') {
    $d = json_decode(file_get_contents('php://input'), true);
    $notifId = trim($d['notif_id'] ?? '');
    if ($notifId === '') responder(['error' => 'notif_id requerido'], 400);
    try {
        $pdo->prepare("DELETE FROM notif_app WHERE usuario = ? AND notif_key = ?")
            ->execute([$usuario, $notifId]);
        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[notif_app/eliminar] '.$e->getMessage());
        responder(['error' => 'No se pudo eliminar'], 500);
    }
}

/* ══ LIMPIAR — borrar todas las del usuario ════════════ */
if ($method === 'POST' && $action === 'limpiar') {
    try {
        $pdo->prepare("DELETE FROM notif_app WHERE usuario = ?")->execute([$usuario]);
        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[notif_app/limpiar] '.$e->getMessage());
        responder(['error' => 'No se pudo limpiar'], 500);
    }
}

responder(['error' => 'Acción no reconocida'], 404);