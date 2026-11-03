<?php
/* ══════════════════════════════════════════════════════════
   notificaciones.php — Integrados S&S
   Helper para envío de emails automáticos via Brevo API.
   Misma API key que recuperar_password.php — sin config extra.

   CÓMO USAR (desde cualquier endpoint):
     require_once 'notificaciones.php';
     notificarAprobacion($pdo, $solicitudId);
     notificarRechazo($pdo, $solicitudId, $motivo);
     notificarEnCamino($pdo, $seguimientoId);
     notificarRecibido($pdo, $seguimientoId);
     notificarPedidoEnGestion($pdo, $pedidoId);
     notificarPedidoRechazado($pdo, $pedidoId, $motivo);
     notificarStockBajo($pdo, $ref, $nombre, $sede, $stock, $minimo);
══════════════════════════════════════════════════════════ */

if (!function_exists('_notif_enviar')) :

function _notif_enviar(string $destinatario, string $nombreDest, string $asunto, string $cuerpoHtml): bool {
    $apiKey = $_ENV['BREVO_API_KEY'] ?? '';

    $payload = json_encode([
        'sender'      => ['name' => 'Integrados S&S', 'email' => 'inventario@integradossys.com'],
        'to'          => [['email' => $destinatario, 'name'  => $nombreDest]],
        'subject'     => $asunto,
        'htmlContent' => _notif_plantilla($nombreDest, $cuerpoHtml),
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
        CURLOPT_TIMEOUT        => 12,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);

    $response  = curl_exec($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) { error_log("[Integrados/notif] cURL error: $curlError"); return false; }
    if ($httpCode !== 201) { error_log("[Integrados/notif] Brevo $httpCode: $response"); return false; }
    return true;
}

function _notif_plantilla(string $nombre, string $cuerpo): string {
    $year = date('Y');
    return "<!DOCTYPE html><html lang='es'><head><meta charset='UTF-8'></head>
    <body style='margin:0;padding:0;background:#F1F5F9;font-family:Arial,sans-serif;'>
      <table width='100%' cellpadding='0' cellspacing='0' style='background:#F1F5F9;padding:32px 16px;'>
        <tr><td align='center'>
          <table width='520' cellpadding='0' cellspacing='0'
            style='background:white;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);'>
            <tr>
              <td style='background:linear-gradient(135deg,#0A1F5C,#0D2B7A);padding:24px 32px;'>
                <div style='font-size:20px;font-weight:900;color:white;'>Integrados S&S</div>
                <div style='font-size:11px;color:#00AADD;text-transform:uppercase;letter-spacing:2px;margin-top:3px;'>Sistema de Inventario</div>
              </td>
            </tr>
            <tr>
              <td style='padding:28px 32px;color:#1E293B;font-size:14px;line-height:1.7;'>
                $cuerpo
              </td>
            </tr>
            <tr>
              <td style='background:#F8FAFC;padding:16px 32px;border-top:1px solid #E2E8F0;font-size:11px;color:#94A3B8;text-align:center;'>
                &copy; $year Integrados S&S &mdash; Correo automático, no respondas este mensaje.
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </body></html>";
}

function _notif_correoUsuario($pdo, string $usuario): ?array {
    $s = $pdo->prepare("SELECT nombre, correo FROM usuarios WHERE usuario = ? AND estado = 'activo'");
    $s->execute([$usuario]);
    $r = $s->fetch();
    return ($r && !empty($r['correo'])) ? $r : null;
}

function _notif_correoSede($pdo, string $sedeNombre): ?array {
    $s = $pdo->prepare("
        SELECT u.nombre, u.correo
        FROM usuarios u
        JOIN sedes se ON se.id = u.sede_id
        WHERE se.nombre = ?
          AND u.rol IN ('municipio','distribuidor','tecnico','persona')
          AND u.estado = 'activo'
        ORDER BY FIELD(u.rol,'municipio','distribuidor','tecnico','persona')
        LIMIT 1
    ");
    $s->execute([$sedeNombre]);
    $r = $s->fetch();
    return ($r && !empty($r['correo'])) ? $r : null;
}

// Nombre "limpio" del transportador para mostrar en correos: quita el prefijo
// interno "EXT:" que se usa para distinguir transporte externo de un usuario del sistema.
function _notif_nombreTransportador(?string $valor): string {
    $valor = trim($valor ?? '');
    if ($valor === '') return 'Transportador asignado';
    if (str_starts_with($valor, 'EXT:')) {
        return trim(substr($valor, 4)) . ' (transporte externo)';
    }
    return $valor;
}

/* ── Solicitud APROBADA ─────────────────────────────── */
function notificarAprobacion($pdo, string $solicitudId): void {
    try {
        $s = $pdo->prepare("SELECT * FROM solicitudes WHERE id = ?");
        $s->execute([$solicitudId]);
        $sol = $s->fetch();
        if (!$sol) return;

        $dest = _notif_correoUsuario($pdo, $sol['solicitado_por'])
             ?? _notif_correoSede($pdo, $sol['destino']);
        if (!$dest) return;

        $nombre   = htmlspecialchars($dest['nombre'] ?: $sol['solicitado_por']);
        $producto = htmlspecialchars($sol['nombre']);
        $cantidad = (int)$sol['cantidad'];
        $unidad   = $sol['unidad_envio'] === 'metros' ? 'metros' : ($cantidad === 1 ? 'unidad' : 'unidades');
        $destino  = htmlspecialchars($sol['destino']);
        $aprobador= htmlspecialchars($sol['aprobado_por'] ?? 'el administrador');

        _notif_enviar(
            $dest['correo'], $dest['nombre'],
            "✅ Solicitud aprobada — {$producto}",
            "<p>Hola <strong>{$nombre}</strong>,</p>
             <p>Tu solicitud fue <strong style='color:#16A34A;'>aprobada</strong> por {$aprobador}.</p>
             <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:16px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;'>
               <tr><td style='color:#64748B;padding:4px 0;'>Producto</td><td style='font-weight:600;'>{$producto}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Cantidad</td><td style='font-weight:600;'>{$cantidad} {$unidad}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Destino</td><td style='font-weight:600;'>{$destino}</td></tr>
             </table>
             <p style='font-size:13px;color:#64748B;'>El envío está siendo preparado. Recibirás otro aviso cuando esté en camino.</p>"
        );
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarAprobacion: " . $e->getMessage()); }
}

/* ── Solicitud RECHAZADA ────────────────────────────── */
function notificarRechazo($pdo, string $solicitudId, string $motivo = ''): void {
    try {
        $s = $pdo->prepare("SELECT * FROM solicitudes WHERE id = ?");
        $s->execute([$solicitudId]);
        $sol = $s->fetch();
        if (!$sol) return;

        $dest = _notif_correoUsuario($pdo, $sol['solicitado_por'])
             ?? _notif_correoSede($pdo, $sol['destino']);
        if (!$dest) return;

        $nombre   = htmlspecialchars($dest['nombre'] ?: $sol['solicitado_por']);
        $producto = htmlspecialchars($sol['nombre']);
        $cantidad = (int)$sol['cantidad'];
        $motivoHtml = $motivo
            ? "<p style='background:#FEF2F2;border:1.5px solid #FECACA;border-radius:8px;padding:12px;font-size:13px;color:#B91C1C;'>Motivo: " . htmlspecialchars($motivo) . "</p>"
            : '';

        _notif_enviar(
            $dest['correo'], $dest['nombre'],
            "❌ Solicitud rechazada — {$producto}",
            "<p>Hola <strong>{$nombre}</strong>,</p>
             <p>Tu solicitud de <strong>{$cantidad} uds. de {$producto}</strong> fue <strong style='color:#DC2626;'>rechazada</strong>.</p>
             {$motivoHtml}
             <p style='font-size:13px;color:#64748B;'>Si tienes dudas, comunícate con el administrador.</p>"
        );
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarRechazo: " . $e->getMessage()); }
}

/* ── Envío EN CAMINO ────────────────────────────────── */
function notificarEnCamino($pdo, int $seguimientoId): void {
    try {
        $s = $pdo->prepare("SELECT * FROM envios_seguimiento WHERE id = ?");
        $s->execute([$seguimientoId]);
        $seg = $s->fetch();
        if (!$seg) return;

        // Buscar destinatario: solicitante original → cualquier usuario activo de la sede
        $dest = null;
        if (!empty($seg['solicitud_id'])) {
            $qs = $pdo->prepare("SELECT solicitado_por FROM solicitudes WHERE id = ?");
            $qs->execute([$seg['solicitud_id']]);
            $solRow = $qs->fetch();
            if ($solRow && !empty($solRow['solicitado_por']))
                $dest = _notif_correoUsuario($pdo, $solRow['solicitado_por']);
        }
        if (!$dest && !empty($seg['pedido_id'])) {
            $qp = $pdo->prepare("SELECT solicitado_por FROM pedidos_municipio WHERE id = ?");
            $qp->execute([$seg['pedido_id']]);
            $pedRow = $qp->fetch();
            if ($pedRow && !empty($pedRow['solicitado_por']))
                $dest = _notif_correoUsuario($pdo, $pedRow['solicitado_por']);
        }
        if (!$dest) $dest = _notif_correoSede($pdo, $seg['destino']);
        if (!$dest) {
            error_log("[Integrados/notif] notificarEnCamino: sin destinatario con correo para destino '{$seg['destino']}' (seguimiento #{$seguimientoId})");
            return;
        }

        $nombre        = htmlspecialchars($dest['nombre']);
        $producto      = htmlspecialchars($seg['nombre_producto']);
        $cantidad      = (int)$seg['cantidad'];
        $unidad        = $seg['unidad'] === 'metros' ? 'metros' : ($cantidad === 1 ? 'unidad' : 'unidades');
        $transportador = htmlspecialchars(_notif_nombreTransportador($seg['transportador'] ?? null));
        $destino       = htmlspecialchars($seg['destino']);
        $notasHtml     = !empty(trim($seg['notas'] ?? '')) ? "<p style='font-size:13px;color:#475569;background:#FFFBEB;border-left:3px solid #FBBF24;padding:8px 12px;border-radius:0 8px 8px 0;margin:12px 0;'>📝 " . nl2br(htmlspecialchars(trim($seg['notas']))) . "</p>" : '';

        _notif_enviar(
            $dest['correo'], $dest['nombre'],
            "🚚 Tu pedido va en camino — {$producto}",
            "<p>Hola <strong>{$nombre}</strong>,</p>
             <p>Un envío está <strong style='color:#0C6EDE;'>en camino</strong> hacia <strong>{$destino}</strong>.</p>
             <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:16px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;'>
               <tr><td style='color:#64748B;padding:4px 0;'>Producto</td><td style='font-weight:600;'>{$producto}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Cantidad</td><td style='font-weight:600;'>{$cantidad} {$unidad}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Transportador</td><td style='font-weight:600;'>{$transportador}</td></tr>
             </table>
             {$notasHtml}
             <p style='font-size:13px;color:#64748B;'>Cuando lo recibas, confirma la recepción en el sistema para actualizar tu inventario.</p>"
        );
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarEnCamino: " . $e->getMessage()); }
}

/* ── Asignación DIRECTA persona-a-persona (material u OLT/equipo) ──
   A diferencia de notificarEnCamino (que busca al solicitante original
   de una solicitud/pedido), aquí el destinatario YA se conoce de una vez
   — es "aQuien" — porque alguien lo asignó directo a él sin pasar por
   una solicitud. Se guarda en las notas del envío como
   "Recoge en persona: <usuario>". ── */
function notificarAsignacionDirecta($pdo, int $seguimientoId): string {
    try {
        $s = $pdo->prepare("SELECT * FROM envios_seguimiento WHERE id = ?");
        $s->execute([$seguimientoId]);
        $seg = $s->fetch();
        if (!$seg) return 'no_aplica';

        if (!preg_match('/Recoge en persona:\s*(.+)$/m', $seg['notas'] ?? '', $m)) return 'no_aplica';
        $aQuien = trim($m[1]);
        if (!$aQuien) return 'no_aplica';

        $dest = _notif_correoUsuario($pdo, $aQuien);
        if (!$dest) {
            error_log("[Integrados/notif] notificarAsignacionDirecta: sin correo para '{$aQuien}' (seguimiento #{$seguimientoId})");
            return 'sin_correo';
        }

        $nombre    = htmlspecialchars($dest['nombre']);
        $producto  = htmlspecialchars($seg['nombre_producto']);
        $cantidad  = (int)$seg['cantidad'];
        $unidad    = $seg['unidad'] === 'metros' ? 'metros' : ($cantidad === 1 ? 'unidad' : 'unidades');
        $asignadoPor = htmlspecialchars($seg['enviado_por'] ?? '');
        $origen    = htmlspecialchars($seg['origen'] ?? '');
        $pendiente = ($seg['estado'] === 'en_camino');
        // Nota visible: quita la línea técnica "Recoge en persona: X" antes de mostrarla.
        // También se quitan las líneas internas repetidas (asignación, destinatario, lote, rollos).
        $notaLimpia = preg_replace('/^(Recoge en persona|Destinatario ONT|Lote|Rollos elegidos):.*$/m', '', $seg['notas'] ?? '');
        $notaLimpia = trim(preg_replace('/^Asignación directa a [^\n—]*(—\s*)?/m', '', $notaLimpia));
        $notaLimpia = trim(preg_replace("/\n{2,}/", "\n", $notaLimpia));
        $notasHtml = $notaLimpia !== '' ? "<p style='font-size:13px;color:#475569;background:#FFFBEB;border-left:3px solid #FBBF24;padding:8px 12px;border-radius:0 8px 8px 0;margin:12px 0;'>📝 " . nl2br(htmlspecialchars($notaLimpia)) . "</p>" : '';

        $ok = _notif_enviar(
            $dest['correo'], $dest['nombre'],
            "📦 Te asignaron material/equipo — {$producto}",
            "<p>Hola <strong>{$nombre}</strong>,</p>
             <p><strong>{$asignadoPor}</strong> te asignó directamente lo siguiente" . ($origen ? " desde <strong>{$origen}</strong>" : "") . ":</p>
             <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:16px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;'>
               <tr><td style='color:#64748B;padding:4px 0;'>Producto/Equipo</td><td style='font-weight:600;'>{$producto}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Cantidad</td><td style='font-weight:600;'>{$cantidad} {$unidad}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Asignado por</td><td style='font-weight:600;'>{$asignadoPor}</td></tr>
             </table>
             {$notasHtml}
             <p style='font-size:13px;color:#64748B;'>" . ($pendiente
                ? "Entra al sistema y confirma la recepción cuando lo tengas en tus manos, para que quede en tu inventario."
                : "Queda pendiente de despacho — cuando te llegue, confirma la recepción en el sistema.") . "</p>"
        );
        return $ok ? 'enviado' : 'fallo';
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarAsignacionDirecta: " . $e->getMessage()); return 'fallo'; }
}

/* ── Asignación DIRECTA de VARIOS productos de una vez ──
   "Asignar Multiple" crea un envío por producto — en vez de un correo por
   cada uno (ver notificarAsignacionDirecta), esto junta todos los que
   correspondan al MISMO destinatario en un solo correo con una tabla.
   $usuarioSesion es quien asignó (se usa solo para loguear si algo no
   cuadra; no filtra nada, los ids ya vienen de las llamadas que el propio
   usuario acaba de hacer). ── */
function notificarAsignacionDirectaMultiple($pdo, array $seguimientoIds, string $usuarioSesion = ''): string {
    $resultado = 'enviado';
    try {
        if (!$seguimientoIds) return 'no_aplica';
        $ph = implode(',', array_fill(0, count($seguimientoIds), '?'));
        $stmt = $pdo->prepare("SELECT * FROM envios_seguimiento WHERE id IN ($ph) AND tipo IN ('asignacion','fibra','fibra_carrete')");
        $stmt->execute($seguimientoIds);
        $filas = $stmt->fetchAll();
        if (!$filas) return 'no_aplica';

        // Agrupar por destinatario real ("Recoge en persona: X") — por si
        // alguna vez se mezclaran asignaciones a distintas personas en un
        // mismo lote, cada quien recibe su propio correo con SUS productos.
        $grupos = [];
        foreach ($filas as $seg) {
            if (!preg_match('/Recoge en persona:\s*(.+)$/m', $seg['notas'] ?? '', $m)) continue;
            $aQuien = trim($m[1]);
            if (!$aQuien) continue;
            $grupos[$aQuien][] = $seg;
        }

        foreach ($grupos as $aQuien => $items) {
            $dest = _notif_correoUsuario($pdo, $aQuien);
            if (!$dest) {
                error_log("[Integrados/notif] notificarAsignacionDirectaMultiple: sin correo para '{$aQuien}'");
                $resultado = 'sin_correo';
                continue;
            }
            $nombre      = htmlspecialchars($dest['nombre']);
            $primero     = $items[0];
            $asignadoPor = htmlspecialchars($primero['enviado_por'] ?? '');
            $origen      = htmlspecialchars($primero['origen'] ?? '');
            $totalItems  = count($items);

            $filasHtml = '';
            foreach ($items as $it) {
                $prod = htmlspecialchars($it['nombre_producto']);
                $cant = (int)$it['cantidad'];
                $uni  = $it['unidad'] === 'metros' ? 'metros' : ($cant === 1 ? 'unidad' : 'unidades');
                $filasHtml .= "<tr><td style='padding:6px 0;border-top:1px solid #E2E8F0;'>{$prod}</td><td style='padding:6px 0;border-top:1px solid #E2E8F0;font-weight:600;text-align:right;'>{$cant} {$uni}</td></tr>";
            }

            $okEnv = _notif_enviar(
                $dest['correo'], $dest['nombre'],
                "📦 Te asignaron {$totalItems} producto" . ($totalItems !== 1 ? 's' : '') . " — {$asignadoPor}",
                "<p>Hola <strong>{$nombre}</strong>,</p>
                 <p><strong>{$asignadoPor}</strong> te asignó directamente estos {$totalItems} producto" . ($totalItems !== 1 ? 's' : '') . ($origen ? " desde <strong>{$origen}</strong>" : "") . ":</p>
                 <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:16px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;'>
                   <tr><td style='color:#64748B;padding:4px 0;font-weight:700;'>Producto</td><td style='color:#64748B;padding:4px 0;font-weight:700;text-align:right;'>Cantidad</td></tr>
                   {$filasHtml}
                 </table>
                 <p style='font-size:13px;color:#64748B;'>Entra al sistema y confirma la recepción cuando los tengas en tus manos, para que queden en tu inventario.</p>"
            );
            if (!$okEnv) $resultado = 'fallo';
        }
        return $resultado;
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarAsignacionDirectaMultiple: " . $e->getMessage()); return 'fallo'; }
}

/* ── Envío RECIBIDO ─────────────────────────────────── */
function notificarEntregado($pdo, int $seguimientoId, string $entregadoA): void {
    try {
        $s = $pdo->prepare("SELECT * FROM envios_seguimiento WHERE id = ?");
        $s->execute([$seguimientoId]);
        $seg = $s->fetch();
        if (!$seg) return;

        // ¿Pertenece a un pedido agrupado?
        $pagId = null;
        if (($seg['tipo'] ?? '') === 'solicitud' && !empty($seg['referencia_id'])) {
            $solQ = $pdo->prepare("SELECT pedido_agrupado_id FROM solicitudes WHERE id = ?");
            $solQ->execute([$seg['referencia_id']]);
            $pagId = $solQ->fetchColumn() ?: null;
        }

        // Destinatario: municipio/distribuidor de la sede destino
        $destUser = $pdo->prepare("SELECT u.nombre, u.correo FROM usuarios u JOIN sedes s ON s.id = u.sede_id WHERE s.nombre = ? AND u.estado = 'activo' AND u.rol IN ('municipio','distribuidor') ORDER BY FIELD(u.rol,'municipio','distribuidor') LIMIT 1");
        $destUser->execute([$seg['destino']]);
        $du = $destUser->fetch();
        if (!$du || empty($du['correo'])) return;
        $nombreD = htmlspecialchars($du['nombre']);
        $destino = htmlspecialchars($seg['destino']);
        $transp  = htmlspecialchars(_notif_nombreTransportador($seg['transportador'] ?? null));
        $recibe  = htmlspecialchars($entregadoA);

        // PEDIDO AGRUPADO: un solo correo cuando TODOS los items estén entregados (o recibidos).
        if ($pagId) {
            $allQ = $pdo->prepare("SELECT es.* FROM envios_seguimiento es JOIN solicitudes sol ON sol.id = es.referencia_id AND es.tipo='solicitud' WHERE sol.pedido_agrupado_id = ?");
            $allQ->execute([$pagId]);
            $items = $allQ->fetchAll();
            if (!$items) return;
            // Si algún item aún está 'en_camino' (no entregado ni recibido), esperar al último.
            foreach ($items as $it) {
                if (!in_array($it['estado'] ?? '', ['entregado','recibido'], true)) return;
            }
            $filas = '';
            foreach ($items as $it) {
                $prod = htmlspecialchars($it['nombre_producto']);
                $cant = (int)$it['cantidad'];
                $uni  = $it['unidad'] === 'metros' ? 'metros' : ($cant === 1 ? 'unidad' : 'unidades');
                $filas .= "<tr><td style='padding:6px 0;border-top:1px solid #E2E8F0;'>{$prod}</td><td style='padding:6px 0;border-top:1px solid #E2E8F0;font-weight:600;text-align:right;'>{$cant} {$uni}</td></tr>";
            }
            $totalProd = count($items);
            _notif_enviar(
                $du['correo'], $du['nombre'],
                "✅ Pedido entregado — {$totalProd} productos en {$destino}",
                "<p>Hola <strong>{$nombreD}</strong>,</p>
                 <p><strong>{$transp}</strong> ha confirmado la entrega del pedido completo ({$totalProd} productos) en <strong>{$destino}</strong>:</p>
                 <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:16px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;'>
                   <tr><td style='color:#64748B;padding:4px 0;font-weight:700;'>Producto</td><td style='color:#64748B;padding:4px 0;font-weight:700;text-align:right;'>Cantidad</td></tr>
                   {$filas}
                   <tr><td style='color:#64748B;padding:8px 0 0;'>Recibido por</td><td style='font-weight:600;padding:8px 0 0;text-align:right;'>{$recibe}</td></tr>
                 </table>
                 <p style='font-size:13px;color:#64748B;'>Por favor confirma la recepción en el sistema para actualizar tu inventario.</p>"
            );
            return;
        }

        // ENVÍO INDIVIDUAL
        $prod = htmlspecialchars($seg['nombre_producto']);
        $cant = (int)$seg['cantidad'];
        $uni  = htmlspecialchars($seg['unidad']);
        _notif_enviar(
            $du['correo'], $du['nombre'],
            "✅ Material entregado — {$prod}",
            "<p>Hola <strong>{$nombreD}</strong>,</p>
             <p><strong>{$transp}</strong> ha confirmado la entrega del siguiente material en <strong>{$destino}</strong>:</p>
             <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:16px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;'>
               <tr><td style='color:#64748B;padding:4px 0;'>Producto</td><td style='font-weight:600;'>{$prod}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Cantidad</td><td style='font-weight:600;'>{$cant} {$uni}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Recibido por</td><td style='font-weight:600;'>{$recibe}</td></tr>
             </table>
             <p style='font-size:13px;color:#64748B;'>Por favor confirma la recepción en el sistema para actualizar tu inventario.</p>"
        );
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarEntregado: " . $e->getMessage()); }
}

function notificarRecibido($pdo, int $seguimientoId): void {
    try {
        $s = $pdo->prepare("SELECT * FROM envios_seguimiento WHERE id = ?");
        $s->execute([$seguimientoId]);
        $seg = $s->fetch();
        if (!$seg) return;

        // ¿Pertenece a un pedido agrupado? Buscar el pedido_agrupado_id vía la solicitud.
        $pagId = null;
        if (($seg['tipo'] ?? '') === 'solicitud' && !empty($seg['referencia_id'])) {
            $solQ = $pdo->prepare("SELECT pedido_agrupado_id FROM solicitudes WHERE id = ?");
            $solQ->execute([$seg['referencia_id']]);
            $pagId = $solQ->fetchColumn() ?: null;
        }

        // PEDIDO AGRUPADO: un solo correo con todos los productos, solo cuando TODOS estén recibidos.
        if ($pagId) {
            $allQ = $pdo->prepare("SELECT es.* FROM envios_seguimiento es JOIN solicitudes sol ON sol.id = es.referencia_id AND es.tipo='solicitud' WHERE sol.pedido_agrupado_id = ?");
            $allQ->execute([$pagId]);
            $items = $allQ->fetchAll();
            if (!$items) return;
            foreach ($items as $it) { if (($it['estado'] ?? '') !== 'recibido') return; }

            $destG = _notif_correoUsuario($pdo, $items[0]['enviado_por']);
            if (!$destG) return;
            $nombreG  = htmlspecialchars($destG['nombre']);
            $destinoG = htmlspecialchars($items[0]['destino']);
            $recibidoG= htmlspecialchars($items[0]['recibido_por'] ?? $items[0]['destino']);
            $filas = '';
            foreach ($items as $it) {
                $prod = htmlspecialchars($it['nombre_producto']);
                $cant = (int)$it['cantidad'];
                $uni  = $it['unidad'] === 'metros' ? 'metros' : ($cant === 1 ? 'unidad' : 'unidades');
                $filas .= "<tr><td style='padding:6px 0;border-top:1px solid #E2E8F0;'>{$prod}</td><td style='padding:6px 0;border-top:1px solid #E2E8F0;font-weight:600;text-align:right;'>{$cant} {$uni}</td></tr>";
            }
            $totalProd = count($items);
            _notif_enviar(
                $destG['correo'], $destG['nombre'],
                "✅ Pedido confirmado recibido — {$totalProd} productos → {$destinoG}",
                "<p>Hola <strong>{$nombreG}</strong>,</p>
                 <p><strong>{$destinoG}</strong> confirmó haber recibido el pedido completo ({$totalProd} productos).</p>
                 <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:16px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;'>
                   <tr><td style='color:#64748B;padding:4px 0;font-weight:700;'>Producto</td><td style='color:#64748B;padding:4px 0;font-weight:700;text-align:right;'>Cantidad</td></tr>
                   {$filas}
                   <tr><td style='color:#64748B;padding:8px 0 0;'>Recibido por</td><td style='font-weight:600;padding:8px 0 0;text-align:right;'>{$recibidoG}</td></tr>
                 </table>"
            );
            return;
        }

        $dest = _notif_correoUsuario($pdo, $seg['enviado_por']);
        if (!$dest) return;

        $nombre   = htmlspecialchars($dest['nombre']);
        $producto = htmlspecialchars($seg['nombre_producto']);
        $cantidad = (int)$seg['cantidad'];
        $unidad   = $seg['unidad'] === 'metros' ? 'metros' : ($cantidad === 1 ? 'unidad' : 'unidades');
        $destino  = htmlspecialchars($seg['destino']);
        $recibido = htmlspecialchars($seg['recibido_por'] ?? $seg['destino']);

        _notif_enviar(
            $dest['correo'], $dest['nombre'],
            "✅ Envío confirmado recibido — {$producto}",
            "<p>Hola <strong>{$nombre}</strong>,</p>
             <p><strong>{$destino}</strong> confirmó haber recibido el envío.</p>
             <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:16px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;'>
               <tr><td style='color:#64748B;padding:4px 0;'>Producto</td><td style='font-weight:600;'>{$producto}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Cantidad</td><td style='font-weight:600;'>{$cantidad} {$unidad}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Recibido por</td><td style='font-weight:600;'>{$recibido}</td></tr>
             </table>"
        );
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarRecibido: " . $e->getMessage()); }
}

/* ── Pedido EN GESTIÓN ──────────────────────────────── */
function notificarPedidoEnGestion($pdo, string $pedidoId): void {
    try {
        $s = $pdo->prepare("SELECT * FROM pedidos_municipio WHERE id = ?");
        $s->execute([$pedidoId]);
        $ped = $s->fetch();
        if (!$ped) return;

        $dest = _notif_correoUsuario($pdo, $ped['solicitado_por'])
             ?? _notif_correoSede($pdo, $ped['municipio']);
        if (!$dest) return;

        $nombre   = htmlspecialchars($dest['nombre']);
        $producto = htmlspecialchars($ped['nombre']);
        $cantidad = (int)$ped['cantidad'];

        _notif_enviar(
            $dest['correo'], $dest['nombre'],
            "⏳ Tu pedido está en gestión — {$producto}",
            "<p>Hola <strong>{$nombre}</strong>,</p>
             <p>Tu pedido de <strong>{$cantidad} uds. de {$producto}</strong> fue recibido y está <strong style='color:#92400E;'>en gestión</strong>.</p>
             <p style='font-size:13px;color:#64748B;'>El administrador lo revisará y te notificará cuando sea aprobado o rechazado.</p>"
        );
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarPedidoEnGestion: " . $e->getMessage()); }
}

/* ── Pedido RECHAZADO ───────────────────────────────── */
function notificarPedidoRechazado($pdo, string $pedidoId, string $motivo = ''): void {
    try {
        $s = $pdo->prepare("SELECT * FROM pedidos_municipio WHERE id = ?");
        $s->execute([$pedidoId]);
        $ped = $s->fetch();
        if (!$ped) return;

        $dest = _notif_correoUsuario($pdo, $ped['solicitado_por'])
             ?? _notif_correoSede($pdo, $ped['municipio']);
        if (!$dest) return;

        $nombre     = htmlspecialchars($dest['nombre']);
        $producto   = htmlspecialchars($ped['nombre']);
        $cantidad   = (int)$ped['cantidad'];
        $motivoHtml = $motivo
            ? "<p style='background:#FEF2F2;border:1.5px solid #FECACA;border-radius:8px;padding:12px;font-size:13px;color:#B91C1C;'>Motivo: " . htmlspecialchars($motivo) . "</p>"
            : '';

        _notif_enviar(
            $dest['correo'], $dest['nombre'],
            "❌ Pedido rechazado — {$producto}",
            "<p>Hola <strong>{$nombre}</strong>,</p>
             <p>Tu pedido de <strong>{$cantidad} uds. de {$producto}</strong> fue <strong style='color:#DC2626;'>rechazado</strong>.</p>
             {$motivoHtml}
             <p style='font-size:13px;color:#64748B;'>Puedes hacer un nuevo pedido desde el sistema cuando lo necesites.</p>"
        );
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarPedidoRechazado: " . $e->getMessage()); }
}

/* ── Stock BAJO MÍNIMO (para uso futuro) ────────────── */
function notificarStockBajo($pdo, string $refProducto, string $nombreProducto, string $sede, int $stockActual, int $stockMinimo): void {
    try {
        $s = $pdo->prepare("SELECT nombre, correo FROM usuarios WHERE rol = 'superadmin' AND estado = 'activo' AND correo IS NOT NULL AND correo != '' LIMIT 1");
        $s->execute();
        $admin = $s->fetch();
        if (!$admin) return;

        $producto = htmlspecialchars($nombreProducto);
        $sedeH    = htmlspecialchars($sede);
        $emoji    = $stockActual === 0 ? '⛔' : '⚠️';
        $titulo   = $stockActual === 0 ? 'Sin stock' : 'Stock bajo mínimo';

        _notif_enviar(
            $admin['correo'], $admin['nombre'],
            "{$emoji} {$titulo} — {$producto} en {$sedeH}",
            "<p>Hola <strong>{$admin['nombre']}</strong>,</p>
             <p>El stock de <strong>{$producto}</strong> en <strong>{$sedeH}</strong> está por debajo del mínimo configurado.</p>
             <table style='width:100%;background:#FEF2F2;border-radius:10px;padding:16px;border:1.5px solid #FECACA;margin:16px 0;font-size:13px;'>
               <tr><td style='color:#64748B;padding:4px 0;'>Producto</td><td style='font-weight:600;'>{$producto} (Ref: {$refProducto})</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Sede</td><td style='font-weight:600;'>{$sedeH}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Stock actual</td><td style='font-weight:600;color:#DC2626;'>{$stockActual} unidades</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Stock mínimo</td><td style='font-weight:600;'>{$stockMinimo} unidades</td></tr>
             </table>
             <p style='font-size:13px;color:#64748B;'>Ingresa al sistema para gestionar un envío de reabastecimiento.</p>"
        );
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarStockBajo: " . $e->getMessage()); }
}

/* ── Stock BAJO MÍNIMO del almacén central ──────────────
   Se llama justo DESPUÉS de bajar stock_neiva, con el stock que había ANTES.
   Solo avisa cuando el stock CRUZA el mínimo (estaba por encima y ahora está
   en o por debajo) — así no llega un correo en cada movimiento mientras siga
   bajo. Va a TODOS los superadmin y distribuidores activos con correo.
   Para productos por rollo, el mínimo y el stock se comparan en ROLLOS. */
function notificarStockBajoCentral($pdo, int $productoId, float $stockAntes): void {
    try {
        $q = $pdo->prepare("SELECT ref, nombre, unidad, stock_neiva, stock_minimo, metros_por_unidad FROM productos WHERE id = ?");
        $q->execute([$productoId]);
        $p = $q->fetch();
        if (!$p) return;
        $minimo = (float)($p['stock_minimo'] ?? 0);
        if ($minimo <= 0) return;
        $mpr   = (float)($p['metros_por_unidad'] ?? 0);
        $div   = $mpr > 0 ? $mpr : 1;
        $antes = round($stockAntes / $div, 2);
        $ahora = round((float)$p['stock_neiva'] / $div, 2);
        if (!($antes > $minimo && $ahora <= $minimo)) return;

        $unidadTxt = $mpr > 0 ? 'rollos' : (($p['unidad'] ?? '') === 'metros' ? 'metros' : 'unidades');
        $producto  = htmlspecialchars($p['nombre']);
        $ref       = htmlspecialchars($p['ref']);
        $sinStock  = $ahora <= 0;
        $emoji     = $sinStock ? '⛔' : '⚠️';
        $titulo    = $sinStock ? 'Sin stock' : 'Stock bajo en el almacén';
        $ahoraTxt  = rtrim(rtrim(number_format($ahora, 2, '.', ''), '0'), '.');
        $minTxt    = rtrim(rtrim(number_format($minimo, 2, '.', ''), '0'), '.');

        $us = $pdo->query("SELECT nombre, correo FROM usuarios WHERE rol IN ('superadmin','distribuidor') AND estado = 'activo' AND correo IS NOT NULL AND correo != ''");
        foreach ($us->fetchAll() as $u) {
            $nom = htmlspecialchars($u['nombre']);
            _notif_enviar(
                $u['correo'], $u['nombre'],
                "{$emoji} {$titulo} — {$p['nombre']}",
                "<p>Hola <strong>{$nom}</strong>,</p>
                 <p>El stock de <strong>{$producto}</strong> en el <strong>Almacén Central</strong> llegó al mínimo configurado o por debajo.</p>
                 <table style='width:100%;background:#FEF2F2;border-radius:10px;padding:16px;border:1.5px solid #FECACA;margin:16px 0;font-size:13px;'>
                   <tr><td style='color:#64748B;padding:4px 0;'>Producto</td><td style='font-weight:600;'>{$producto} (Ref: {$ref})</td></tr>
                   <tr><td style='color:#64748B;padding:4px 0;'>Stock actual</td><td style='font-weight:600;color:#DC2626;'>{$ahoraTxt} {$unidadTxt}</td></tr>
                   <tr><td style='color:#64748B;padding:4px 0;'>Stock mínimo</td><td style='font-weight:600;'>{$minTxt} {$unidadTxt}</td></tr>
                 </table>
                 <p style='font-size:13px;color:#64748B;'>Ingresa al sistema para registrar un ingreso de mercancía.</p>"
            );
        }
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarStockBajoCentral: " . $e->getMessage()); }
}

/* ── Solicitud ESCALADA por distribuidor ────────────── */
function notificarEscalada($pdo, string $solicitudId): void {
    try {
        $s = $pdo->prepare("SELECT * FROM solicitudes WHERE id = ?");
        $s->execute([$solicitudId]);
        $sol = $s->fetch();
        if (!$sol) return;

        $dest = _notif_correoUsuario($pdo, $sol['solicitado_por'])
             ?? _notif_correoSede($pdo, $sol['destino']);
        if (!$dest) return;

        $nombre   = htmlspecialchars($dest['nombre'] ?: $sol['solicitado_por']);
        $producto = htmlspecialchars($sol['nombre']);
        $cantidad = (int)$sol['cantidad'];
        $unidad   = $sol['unidad_envio'] === 'metros' ? 'metros' : ($cantidad === 1 ? 'unidad' : 'unidades');

        _notif_enviar(
            $dest['correo'], $dest['nombre'],
            "⏳ Tu solicitud está en revisión — {$producto}",
            "<p>Hola <strong>{$nombre}</strong>,</p>
             <p>Tu solicitud de <strong>{$cantidad} {$unidad} de {$producto}</strong> fue recibida por el distribuidor y está siendo <strong style='color:#92400E;'>revisada por el administrador</strong>.</p>
             <p style='font-size:13px;color:#64748B;'>Recibirás otro aviso cuando sea aprobada o rechazada.</p>"
        );
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarEscalada: " . $e->getMessage()); }
}

/* ── Notificar a admin/distribuidor: llegó un pedido/solicitud nuevo ── */
function notificarNuevoPedidoAdmin($pdo, string $solicitante, string $destino, string $resumen, string $accionUrl = 'solicitudes'): void {
    try {
        // Superadmin y distribuidor, MÁS cualquier usuario al que se le dio a mano
        // el permiso de aprobar o gestionar pedidos. No se avisa a quien hizo el pedido.
        $stmt = $pdo->prepare("
            SELECT usuario, nombre, correo FROM usuarios
            WHERE estado = 'activo' AND correo IS NOT NULL AND correo != ''
              AND usuario <> ?
              AND (rol IN ('superadmin','distribuidor')
                   OR permisos LIKE '%\"aprobar_pedidos\"%'
                   OR permisos LIKE '%\"gestionar_pedidos\"%')
        ");
        $stmt->execute([$solicitante]);
        $vistos = [];
        $destinatarios = [];
        foreach ($stmt->fetchAll() as $d) {
            $k = strtolower($d['correo']);
            if (isset($vistos[$k])) continue;
            $vistos[$k] = true;
            $destinatarios[] = $d;
        }
        if (!$destinatarios) return;

        $solicitanteEsc = htmlspecialchars($solicitante);
        $destinoEsc     = htmlspecialchars($destino);
        $resumenEsc     = htmlspecialchars($resumen);

        $claveAviso = 'pedido_nuevo_' . uniqid();
        foreach ($destinatarios as $dest) {
            $nombre = htmlspecialchars($dest['nombre'] ?: 'Administrador');
            // Aviso en la campana del sistema (no depende del correo).
            _notif_campana($pdo, $dest['usuario'], $claveAviso, 'solicitud',
                "📥 Nuevo pedido — {$destino}", "{$solicitante}: {$resumen}", $accionUrl);
            $ok = _notif_enviar(
                $dest['correo'], $dest['nombre'],
                "📥 Nuevo pedido — {$destinoEsc}",
                "<p>Hola <strong>{$nombre}</strong>,</p>
                 <p><strong>{$solicitanteEsc}</strong> ({$destinoEsc}) acaba de enviar un pedido:</p>
                 <p style='background:#F8FAFC;border-radius:8px;padding:12px 16px;font-size:13px;color:#334155;'>{$resumenEsc}</p>
                 <p style='font-size:13px;color:#64748B;'>Entra al sistema para revisarlo y aprobarlo.</p>"
            );
            if (!$ok) error_log("[Integrados/notif] nuevo pedido: no se pudo enviar el correo a {$dest['usuario']}");
        }
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarNuevoPedidoAdmin: " . $e->getMessage()); }
}

/* ── Notificación en camino GRUPO ─────────────────── */
function notificarEnCaminoGrupo($pdo, array $seguimientoIds, string $transportador, ?string $destino): void {
    $destino = $destino ?? '';
    try {
        if (empty($seguimientoIds)) return;

        // Obtener todos los items del grupo
        $placeholders = implode(',', array_fill(0, count($seguimientoIds), '?'));
        $stmt = $pdo->prepare("SELECT * FROM envios_seguimiento WHERE id IN ($placeholders)");
        $stmt->execute($seguimientoIds);
        $items = $stmt->fetchAll();
        if (empty($items)) return;

        // Buscar destinatario desde el primer item
        $first = $items[0];
        $dest = null;
        if (!empty($first['solicitud_id'])) {
            $qs = $pdo->prepare("SELECT solicitado_por FROM solicitudes WHERE id = ?");
            $qs->execute([$first['solicitud_id']]);
            $solRow = $qs->fetch();
            if ($solRow) $dest = _notif_correoUsuario($pdo, $solRow['solicitado_por']);
        }
        if (!$dest) $dest = _notif_correoSede($pdo, $destino);
        if (!$dest) {
            error_log("[Integrados/notif] notificarEnCaminoGrupo: sin destinatario con correo para destino '{$destino}' (ids: " . implode(',', $seguimientoIds) . ")");
            return;
        }

        // Construir tabla de productos
        $tablaHtml = '';
        $totalCant = 0;
        foreach ($items as $item) {
            $nombre = htmlspecialchars($item['nombre_producto']);
            $cant   = (int)$item['cantidad'];
            $unidad = $cant === 1 ? 'unidad' : 'unidades';
            $tablaHtml .= "<tr><td style='padding:6px 10px;border-bottom:1px solid #F1F5F9;font-weight:600;'>{$nombre}</td><td style='padding:6px 10px;border-bottom:1px solid #F1F5F9;text-align:center;font-weight:700;color:#0C6EDE;'>{$cant} {$unidad}</td></tr>";
            $totalCant += $cant;
        }

        $transp = htmlspecialchars(_notif_nombreTransportador($transportador));
        $dest_esc = htmlspecialchars($destino);
        $nombre_dest = htmlspecialchars($dest['nombre']);

        // Notas combinadas de todos los items (sin duplicar), ej. nota del usuario +
        // "Seriales: ..." de ONTs + "Carretes: ..." de fibra, cada cosa una sola vez.
        $notasVistas = [];
        foreach ($items as $item) {
            foreach (explode("\n", trim($item['notas'] ?? '')) as $ln) {
                $ln = trim($ln);
                $clave = strtolower($ln);
                if ($ln !== '' && !isset($notasVistas[$clave])) $notasVistas[$clave] = $ln;
            }
        }
        $notasHtml = $notasVistas
            ? "<p style='font-size:13px;color:#475569;background:#FFFBEB;border-left:3px solid #FBBF24;padding:8px 12px;border-radius:0 8px 8px 0;margin:12px 0;'>📝 " . implode('<br>', array_map(fn($n) => htmlspecialchars($n), $notasVistas)) . "</p>"
            : '';

        _notif_enviar(
            $dest['correo'], $dest['nombre'],
            "🚚 Tu pedido múltiple va en camino — {$dest_esc}",
            "<p>Hola <strong>{$nombre_dest}</strong>,</p>
             <p>Tu pedido múltiple está <strong style='color:#0C6EDE;'>en camino</strong> hacia <strong>{$dest_esc}</strong>.</p>
             <table style='width:100%;background:#F8FAFC;border-radius:10px;border:1.5px solid #E2E8F0;margin:16px 0;border-collapse:collapse;'>
               <thead><tr style='background:#E2E8F0;'>
                 <th style='padding:8px 10px;text-align:left;font-size:12px;color:#475569;'>Producto</th>
                 <th style='padding:8px 10px;text-align:center;font-size:12px;color:#475569;'>Cantidad</th>
               </tr></thead>
               <tbody>{$tablaHtml}</tbody>
               <tfoot><tr style='background:#EAF3DE;'>
                 <td style='padding:8px 10px;font-weight:700;color:#166534;'>Total</td>
                 <td style='padding:8px 10px;text-align:center;font-weight:700;color:#166534;'>{$totalCant} uds.</td>
               </tr></tfoot>
             </table>
             <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:12px 16px;border:1.5px solid #E2E8F0;margin:12px 0;font-size:13px;'>
               <tr><td style='color:#64748B;padding:4px 0;'>Transportador</td><td style='font-weight:600;'>{$transp}</td></tr>
             </table>
             {$notasHtml}
             <p style='font-size:13px;color:#64748B;'>Cuando lo recibas, confirma la recepción en el sistema.</p>"
        );
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarEnCaminoGrupo: " . $e->getMessage()); }
}

/* ── Bienvenida al nuevo usuario ────────────────────── */
function notificarBienvenida($pdo, string $usuarioNombre, string $nombreCompleto, string $correo, string $sede): void {
    try {
        if (empty($correo)) return;

        $link = (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS']==='on' ? 'https' : 'http')
              . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost')
              . '/inventario-integrados/';

        _notif_enviar(
            $correo, $nombreCompleto,
            "👋 Bienvenido a Integrados S&S — Sistema de Inventario",
            "<p>Hola <strong>{$nombreCompleto}</strong>,</p>
             <p>Tu cuenta en el sistema de inventario de <strong>Integrados S&S</strong> ha sido creada exitosamente. Ya puedes acceder con tu usuario.</p>
             <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:16px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;'>
               <tr><td style='color:#64748B;padding:4px 0;'>Usuario</td><td style='font-weight:700;color:#0C6EDE;'>{$usuarioNombre}</td></tr>
               <tr><td style='color:#64748B;padding:4px 0;'>Sede asignada</td><td style='font-weight:600;'>{$sede}</td></tr>
             </table>
             <div style='text-align:center;margin:24px 0;'>
               <a href='{$link}' style='background:linear-gradient(135deg,#0A1F5C,#0C6EDE);color:white;padding:12px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block;'>
                 🚀 Ingresar al sistema
               </a>
             </div>
             <p style='font-size:12px;color:#94A3B8;'>Si tienes algún problema para ingresar, comunícate con el administrador del sistema.</p>
             <div style='margin-top:20px;padding:14px 16px;background:#F8FAFC;border:1.5px solid #E2E8F0;border-left:4px solid #0C6EDE;border-radius:0 8px 8px 0;font-size:12px;color:#475569;line-height:1.7;'>
               <strong style='color:#0F172A;display:block;margin-bottom:4px;'>⚠️ Uso corporativo exclusivo</strong>
               Esta cuenta es de carácter <strong>empresarial y corporativo</strong>, asignada únicamente para el ejercicio de las funciones dentro de <strong>Integrados S&S</strong>.
               <br><br>
               • El acceso es <strong>personal e intransferible</strong> — no comparta sus credenciales con terceros.<br>
               • El uso indebido del sistema puede acarrear consecuencias disciplinarias.<br>
               • Toda actividad queda registrada en el sistema de auditoría.
             </div>"
        );
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarBienvenida: " . $e->getMessage()); }
}


/* ── Ventas con aprobación ──────────────────────────────
   Dejan aviso en la campana (notif_app) Y correo. */
function _notif_campana($pdo, string $usuario, string $key, string $tipo, string $titulo, string $msg, string $accion): void {
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS notif_app (
            id INT AUTO_INCREMENT PRIMARY KEY, usuario VARCHAR(60) NOT NULL, notif_key VARCHAR(120) NOT NULL,
            tipo VARCHAR(30) DEFAULT 'solicitud', titulo VARCHAR(200) NOT NULL, msg VARCHAR(400) DEFAULT '',
            accion VARCHAR(60) DEFAULT '', fecha VARCHAR(40) DEFAULT '', leida TINYINT(1) DEFAULT 0,
            creado_en DATETIME DEFAULT NOW(), UNIQUE KEY uq_usuario_key (usuario, notif_key))");
        $pdo->prepare("INSERT IGNORE INTO notif_app (usuario, notif_key, tipo, titulo, msg, accion, fecha, leida) VALUES (?,?,?,?,?,?,?,0)")
            ->execute([$usuario, $key, $tipo, mb_substr($titulo, 0, 200), mb_substr($msg, 0, 400), $accion, date('c')]);
    } catch (\Throwable $e) { error_log('[Integrados/notif] campana: ' . $e->getMessage()); }
}

function notificarVentaSolicitada($pdo, int $ventaId): void {
    try {
        $q = $pdo->prepare("SELECT * FROM ventas_pendientes WHERE id = ?");
        $q->execute([$ventaId]);
        $v = $q->fetch();
        if (!$v) return;
        // Aprobadores: superadmin + quien tenga el permiso aprobar_ventas (menos quien vende)
        $aprobadores = $pdo->prepare("SELECT usuario, nombre, correo FROM usuarios
            WHERE estado = 'activo' AND usuario <> ? AND (rol = 'superadmin' OR permisos LIKE '%\"aprobar_ventas\"%')");
        $aprobadores->execute([$v['solicitado_por']]);
        $fmt = number_format((float)$v['precio_total'], 0, ',', '.');
        $titulo = '💰 Venta por aprobar';
        $uTxt = !empty($v['es_rollo']) ? ' rollo(s)' : '';
        $msg = "{$v['solicitado_por']} quiere vender {$v['cantidad']}{$uTxt} de {$v['nombre']} a {$v['cliente']} por \${$fmt}";
        foreach ($aprobadores->fetchAll() as $a) {
            _notif_campana($pdo, $a['usuario'], 'venta_sol_' . $ventaId, 'venta', $titulo, $msg, 'ventaspend');
            if (!empty($a['correo'])) {
                $nom = htmlspecialchars($a['nombre'] ?: $a['usuario']);
                _notif_enviar($a['correo'], $a['nombre'] ?: $a['usuario'], "💰 Venta por aprobar — " . $v['solicitado_por'],
                    "<p>Hola <strong>{$nom}</strong>,</p>
                     <p><strong>" . htmlspecialchars($v['solicitado_por']) . "</strong> pidió autorización para una venta:</p>
                     <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:16px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;'>
                       <tr><td style='color:#64748B;padding:4px 0;'>Producto</td><td style='font-weight:600;'>" . htmlspecialchars($v['nombre']) . "</td></tr>
                       <tr><td style='color:#64748B;padding:4px 0;'>Cantidad</td><td style='font-weight:600;'>" . (int)$v['cantidad'] . (!empty($v['es_rollo']) ? ' rollo(s)' : '') . "</td></tr>
                       <tr><td style='color:#64748B;padding:4px 0;'>Cliente</td><td style='font-weight:600;'>" . htmlspecialchars($v['cliente']) . "</td></tr>
                       <tr><td style='color:#64748B;padding:4px 0;'>Precio total</td><td style='font-weight:600;'>\${$fmt}</td></tr>
                       <tr><td style='color:#64748B;padding:4px 0;'>Forma de pago</td><td style='font-weight:600;'>" . htmlspecialchars($v['forma_pago'] ?: '—') . "</td></tr>
                     </table>
                     <p style='font-size:13px;color:#64748B;'>Entra al sistema, sección <strong>Ventas</strong>, para aprobarla o rechazarla. El material queda apartado mientras tanto.</p>");
            }
        }
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarVentaSolicitada: " . $e->getMessage()); }
}

function notificarVentaResuelta($pdo, int $ventaId): void {
    try {
        $q = $pdo->prepare("SELECT * FROM ventas_pendientes WHERE id = ?");
        $q->execute([$ventaId]);
        $v = $q->fetch();
        if (!$v || !in_array($v['estado'], ['aprobada', 'rechazada'])) return;
        $ok = $v['estado'] === 'aprobada';
        $fmt = number_format((float)$v['precio_total'], 0, ',', '.');
        $titulo = $ok ? '✅ Venta aprobada' : '❌ Venta rechazada';
        $ajuste = ($ok && !empty($v['cantidad_original']) && (int)$v['cantidad_original'] !== (int)$v['cantidad'])
            ? " (cantidad ajustada de {$v['cantidad_original']} a {$v['cantidad']}; el resto volvió a tu inventario)" : '';
        $msg = $ok
            ? "Tu venta de {$v['cantidad']}" . (!empty($v['es_rollo']) ? ' rollo(s)' : '') . " de {$v['nombre']} a {$v['cliente']} fue aprobada por {$v['resuelto_por']}{$ajuste}" . (!empty($v['observacion']) ? ". Observación: {$v['observacion']}" : '')
            : "Tu venta de {$v['nombre']} a {$v['cliente']} fue rechazada por {$v['resuelto_por']}: {$v['motivo_rechazo']}. El material volvió a tu inventario.";
        _notif_campana($pdo, $v['solicitado_por'], 'venta_res_' . $ventaId, 'venta', $titulo, $msg, 'ventaspend');
        $dest = _notif_correoUsuario($pdo, $v['solicitado_por']);
        if ($dest) {
            $nom = htmlspecialchars($dest['nombre'] ?: $v['solicitado_por']);
            $obsHtml = ($ok && !empty($v['observacion'])) ? "<p style='font-size:13px;color:#166534;background:#F0FDF4;border-left:3px solid #4ADE80;padding:8px 12px;border-radius:0 8px 8px 0;'>Observación: " . htmlspecialchars($v['observacion']) . "</p>" : '';
            $motivoHtml = (!$ok && $v['motivo_rechazo']) ? "<p style='font-size:13px;color:#475569;background:#FEF2F2;border-left:3px solid #F87171;padding:8px 12px;border-radius:0 8px 8px 0;'>Motivo: " . htmlspecialchars($v['motivo_rechazo']) . "</p>" : '';
            _notif_enviar($dest['correo'], $dest['nombre'] ?: $v['solicitado_por'], $titulo . " — " . $v['nombre'],
                "<p>Hola <strong>{$nom}</strong>,</p>
                 <p>Tu solicitud de venta de <strong>" . (int)$v['cantidad'] . " × " . htmlspecialchars($v['nombre']) . "</strong> a <strong>" . htmlspecialchars($v['cliente']) . "</strong> por \${$fmt} fue <strong>" . ($ok ? 'aprobada' : 'rechazada') . "</strong> por " . htmlspecialchars((string)$v['resuelto_por']) . ".</p>" . ($ajuste ? "<p style='font-size:13px;color:#92400E;background:#FFFBEB;border-left:3px solid #FBBF24;padding:8px 12px;border-radius:0 8px 8px 0;'>" . htmlspecialchars(trim($ajuste, ' ()')) . "</p>" : '') . "
                 {$motivoHtml}{$obsHtml}
                 <p style='font-size:13px;color:#64748B;'>" . ($ok ? "La venta ya quedó registrada en el historial." : "El material apartado volvió a tu inventario.") . "</p>");
        }
    } catch (\Throwable $e) { error_log("[Integrados/notif] notificarVentaResuelta: " . $e->getMessage()); }
}


endif;