<?php
/* ══════════════════════════════════════════════════════════
   recuperar_password.php — Integrados S&S
   Usa Brevo API (HTTPS) — sin puertos SMTP bloqueados
   La API key se lee del .env (variable BREVO_API_KEY)
   Flujo por CÓDIGO de 6 dígitos (no por enlace) — más simple
   en celular, sin depender de que el botón del correo funcione.
══════════════════════════════════════════════════════════ */
require 'config.php';
require_once 'auditoria.php';

// Asegurar que 'usuarios' tenga las columnas para el flujo de recuperación.
// Se reutiliza reset_token para guardar el código (más simple que migrar
// nombre de columna), pero ahora contiene 6 dígitos, no un token largo.
try {
    $colsUsr = $pdo->query("SHOW COLUMNS FROM usuarios")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('reset_token', $colsUsr)) {
        $pdo->exec("ALTER TABLE usuarios ADD COLUMN reset_token VARCHAR(64) DEFAULT NULL");
    }
    if (!in_array('reset_expira', $colsUsr)) {
        $pdo->exec("ALTER TABLE usuarios ADD COLUMN reset_expira DATETIME DEFAULT NULL");
    }
    if (!in_array('reset_intentos', $colsUsr)) {
        $pdo->exec("ALTER TABLE usuarios ADD COLUMN reset_intentos TINYINT DEFAULT 0");
    }
} catch (\Throwable $e) { error_log('[recuperar_password/columnas] '.$e->getMessage()); }

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];


/* Intentos de código: devuelve true si el usuario ya agotó sus 5 intentos con el código vigente. */
function recuperacionBloqueada($pdo, $usuario) {
    $st = $pdo->prepare("SELECT reset_intentos FROM usuarios WHERE usuario = ? AND reset_token IS NOT NULL AND reset_expira > NOW()");
    $st->execute([$usuario]);
    $r = $st->fetch();
    return $r && (int)$r['reset_intentos'] >= 5;
}
function recuperacionContarFallo($pdo, $usuario) {
    $pdo->prepare("UPDATE usuarios SET reset_intentos = reset_intentos + 1 WHERE usuario = ? AND reset_token IS NOT NULL AND reset_expira > NOW()")->execute([$usuario]);
}

/* ══════════════════════════════════════
   1. SOLICITAR CÓDIGO
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'solicitar') {
    $data    = json_decode(file_get_contents('php://input'), true);
    $usuario = trim($data['usuario'] ?? '');

    if (!$usuario) responder(['error' => 'Ingresa tu nombre de usuario.'], 400);

    $stmt = $pdo->prepare("SELECT id, usuario, nombre, correo FROM usuarios WHERE usuario = ? AND estado = 'activo'");
    $stmt->execute([$usuario]);
    $u = $stmt->fetch();

    // Respuesta genérica para no revelar si el usuario existe
    if (!$u || empty($u['correo'])) {
        responder(['ok' => true, 'msg' => 'Si el usuario existe y tiene correo registrado, recibirá un código.']);
    }

    // No se emite un código nuevo si ya se pidió uno hace menos de 1 minuto (evita reiniciar los intentos y llenar el correo).
    $cd = $pdo->prepare("SELECT 1 FROM usuarios WHERE id = ? AND reset_token IS NOT NULL AND reset_expira > DATE_ADD(NOW(), INTERVAL 14 MINUTE)");
    $cd->execute([$u['id']]);
    if ($cd->fetchColumn()) {
        responder(['ok' => true, 'msg' => 'Si el usuario existe y tiene correo registrado, recibirá un código.']);
    }

    // Código numérico de 6 dígitos, válido por 15 minutos.
    $codigo = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $expira = date('Y-m-d H:i:s', strtotime('+15 minutes'));

    $pdo->prepare("UPDATE usuarios SET reset_token = ?, reset_expira = ?, reset_intentos = 0 WHERE id = ?")
        ->execute([$codigo, $expira, $u['id']]);

    auditar($pdo, 'solicitar_recuperacion', 'auth', "Solicitud de recuperación de contraseña para: {$u['usuario']}", $u['usuario']);

    $nombre = $u['nombre'] ?: $u['usuario'];

    $enviado = enviarCorreoBrevo(
        $u['correo'],
        $nombre,
        'Tu código de recuperación — Integrados S&S',
        "
        <p>Hola <strong>{$nombre}</strong>,</p>
        <p>Recibimos una solicitud para restablecer la contraseña de tu cuenta <strong>{$u['usuario']}</strong> en Integrados S&S.</p>
        <p>Este es tu código de verificación:</p>
        <p style='text-align:center;margin:28px 0;'>
          <span style='background:#F1F5F9;color:#0A1F5C;padding:16px 32px;border-radius:12px;font-weight:800;font-size:32px;letter-spacing:8px;display:inline-block;font-family:monospace;'>{$codigo}</span>
        </p>
        <p style='font-size:13px;color:#64748B;'>Este código es válido por <strong>15 minutos</strong>. Si no solicitaste este cambio, ignora este correo.</p>
        "
    );

    if (!$enviado) {
        responder(['error' => 'No se pudo enviar el correo. Contacta al administrador.'], 200);
    }

    responder(['ok' => true, 'msg' => 'Código enviado. Revisa tu correo.']);
}

/* ══════════════════════════════════════
   2. VERIFICAR CÓDIGO (sin cambiar la contraseña todavía)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'verificar_codigo') {
    $data    = json_decode(file_get_contents('php://input'), true);
    $usuario = trim($data['usuario'] ?? '');
    $codigo  = trim($data['codigo']  ?? '');

    if (!$usuario || !$codigo) responder(['error' => 'Datos incompletos.'], 400);

    if (recuperacionBloqueada($pdo, $usuario)) {
        responder(['error' => 'Demasiados intentos fallidos. Solicita un código nuevo.'], 429);
    }

    $stmt = $pdo->prepare("
        SELECT id, usuario, nombre, reset_intentos FROM usuarios
        WHERE usuario = ? AND reset_token = ? AND reset_expira > NOW() AND estado = 'activo'
    ");
    $stmt->execute([$usuario, $codigo]);
    $u = $stmt->fetch();

    if (!$u) {
        recuperacionContarFallo($pdo, $usuario);
        responder(['error' => 'Código incorrecto o expirado. Verifica o solicita uno nuevo.'], 400);
    }

    responder(['ok' => true, 'nombre' => $u['nombre'] ?: $u['usuario']]);
}

/* ══════════════════════════════════════
   3. RESTABLECER CONTRASEÑA (con el código)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'restablecer') {
    $data     = json_decode(file_get_contents('php://input'), true);
    $usuario  = trim($data['usuario']  ?? '');
    $codigo   = trim($data['codigo']   ?? '');
    $password = trim($data['password'] ?? '');

    if (!$usuario || !$codigo || !$password) responder(['error' => 'Datos incompletos.'], 400);
    if (strlen($password) < 6)  responder(['error' => 'La contraseña debe tener al menos 6 caracteres.'], 400);

    if (recuperacionBloqueada($pdo, $usuario)) {
        responder(['error' => 'Demasiados intentos fallidos. Solicita un código nuevo.'], 429);
    }

    $stmt = $pdo->prepare("
        SELECT id, usuario FROM usuarios
        WHERE usuario = ? AND reset_token = ? AND reset_expira > NOW() AND estado = 'activo'
    ");
    $stmt->execute([$usuario, $codigo]);
    $u = $stmt->fetch();

    if (!$u) { recuperacionContarFallo($pdo, $usuario); responder(['error' => 'El código es inválido o ha expirado. Solicita uno nuevo.'], 400); }

    $hash = password_hash($password, PASSWORD_BCRYPT);
    $pdo->prepare("UPDATE usuarios SET password = ?, reset_token = NULL, reset_expira = NULL, reset_intentos = 0 WHERE id = ?")
        ->execute([$hash, $u['id']]);

    auditar($pdo, 'restablecer_password', 'auth', "Contraseña restablecida vía código de verificación para: {$u['usuario']}", $u['usuario']);
    responder(['ok' => true, 'msg' => 'Contraseña actualizada correctamente.']);
}

responder(['error' => 'Acción no reconocida.'], 400);

/* ══════════════════════════════════════
   HELPER: Enviar correo via Brevo API
══════════════════════════════════════ */
function enviarCorreoBrevo($destinatario, $nombreDest, $asunto, $cuerpoHtml) {
    $apiKey = $_ENV['BREVO_API_KEY'] ?? '';

    if (!function_exists('curl_init')) {
        error_log('[Brevo] cURL no está habilitado');
        return false;
    }

    $payload = json_encode([
        'sender'      => ['name' => 'Integrados S&S', 'email' => 'inventario@integradossys.com'],
        'to'          => [['email' => $destinatario, 'name' => $nombreDest]],
        'subject'     => $asunto,
        'htmlContent' => plantillaCorreo($nombreDest, $cuerpoHtml),
    ]);

    $ch = curl_init('https://api.brevo.com/v3/smtp/email');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'api-key: ' . $apiKey,
        ],
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
    ]);

    $response  = curl_exec($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    error_log("[Brevo] HTTP: $httpCode | cURL error: $curlError | Response: $response");

    if ($curlError) {
        error_log("[Brevo] Error cURL: " . $curlError);
        return false;
    }

    if ($httpCode !== 201) {
        error_log("[Brevo] Error API $httpCode: " . $response);
        return false;
    }

    return true;
}

function plantillaCorreo($nombre, $cuerpo) {
    return "
    <!DOCTYPE html>
    <html lang='es'>
    <head><meta charset='UTF-8'></head>
    <body style='margin:0;padding:0;background:#F1F5F9;font-family:Arial,sans-serif;'>
      <table width='100%' cellpadding='0' cellspacing='0' style='background:#F1F5F9;padding:32px 16px;'>
        <tr><td align='center'>
          <table width='520' cellpadding='0' cellspacing='0' style='background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);'>
            <tr>
              <td style='background:linear-gradient(135deg,#0A1F5C,#0D2B7A);padding:28px 32px;'>
                <div style='font-size:20px;font-weight:900;color:white;'>Integrados S&S</div>
                <div style='font-size:11px;color:#00AADD;text-transform:uppercase;letter-spacing:2px;margin-top:3px;'>Sistema de Inventario</div>
              </td>
            </tr>
            <tr>
              <td style='padding:32px;color:#1E293B;font-size:14px;line-height:1.7;'>
                {$cuerpo}
              </td>
            </tr>
            <tr>
              <td style='background:#F8FAFC;padding:18px 32px;border-top:1px solid #E2E8F0;font-size:11px;color:#94A3B8;text-align:center;'>
                © " . date('Y') . " Integrados S&S — Correo automático, no respondas este mensaje.
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body>
    </html>";
}