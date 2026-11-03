<?php
/* ══════════════════════════════════════════════════════════
   cambiar_password.php — Integrados S&S
   Permite al usuario autenticado cambiar su propia contraseña
══════════════════════════════════════════════════════════ */
require 'config.php';
require_once 'auditoria.php';
sesionRequerida();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ══════════════════════════════════════
   CAMBIAR CONTRASEÑA (usuario autenticado)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'cambiar') {
    $data         = json_decode(file_get_contents('php://input'), true);
    $actual       = $data['actual']       ?? '';
    $nueva        = $data['nueva']        ?? '';
    $confirmacion = $data['confirmacion'] ?? '';

    if (!$actual || !$nueva || !$confirmacion)
        responder(['error' => 'Todos los campos son obligatorios.'], 400);

    if (strlen($nueva) < 6)
        responder(['error' => 'La nueva contraseña debe tener al menos 6 caracteres.'], 400);

    if ($nueva !== $confirmacion)
        responder(['error' => 'Las contraseñas nuevas no coinciden.'], 400);

    $stmt = $pdo->prepare("SELECT id, password FROM usuarios WHERE usuario = ?");
    $stmt->execute([$_SESSION['usuario']]);
    $u = $stmt->fetch();

    if (!$u)
        responder(['error' => 'Usuario no encontrado.'], 404);

    if (!password_verify($actual, $u['password']))
        responder(['error' => 'La contraseña actual es incorrecta.'], 400);

    if (password_verify($nueva, $u['password']))
        responder(['error' => 'La nueva contraseña debe ser diferente a la actual.'], 400);

    $hash = password_hash($nueva, PASSWORD_BCRYPT);
    $pdo->prepare("UPDATE usuarios SET password = ? WHERE id = ?")
        ->execute([$hash, $u['id']]);

    auditar($pdo, 'cambiar_password', 'usuarios', "Contraseña cambiada por el propio usuario.", $_SESSION['usuario']);
    responder(['ok' => true, 'msg' => 'Contraseña actualizada correctamente.']);
}

/* ══════════════════════════════════════
   SUPERADMIN: Resetear contraseña de otro usuario
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'resetear') {
    rolRequerido('superadmin');
    $data    = json_decode(file_get_contents('php://input'), true);
    $usuario = trim($data['usuario'] ?? '');
    $nueva   = trim($data['nueva']   ?? '');

    if (!$usuario || !$nueva)
        responder(['error' => 'Datos incompletos.'], 400);

    if (strlen($nueva) < 6)
        responder(['error' => 'La contraseña debe tener al menos 6 caracteres.'], 400);

    $check = $pdo->prepare("SELECT id FROM usuarios WHERE usuario = ?");
    $check->execute([$usuario]);
    if (!$check->fetch())
        responder(['error' => 'Usuario no encontrado.'], 404);

    $hash = password_hash($nueva, PASSWORD_BCRYPT);
    $pdo->prepare("UPDATE usuarios SET password = ? WHERE usuario = ?")
        ->execute([$hash, $usuario]);

    auditar($pdo, 'resetear_password', 'usuarios', "Contraseña reseteada por superadmin para: $usuario", $usuario);
    responder(['ok' => true]);
}

responder(['error' => 'Acción no reconocida.'], 400);