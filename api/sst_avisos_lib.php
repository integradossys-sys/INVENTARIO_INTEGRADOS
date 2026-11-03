<?php
/* ══════════════════════════════════════════════════════
   sst_avisos_lib.php — Avisos de inspección SST
   Crea notificaciones en la campana (y correo si hay) cuando:
     · faltan 7 días o menos para la inspección de un artículo, o
     · la fecha de inspección ya pasó.
   Avisa a quien gestiona SST y, si el artículo está entregado,
   también a la persona que lo tiene. Cada aviso se manda UNA vez
   por ciclo (la clave incluye la fecha de inspección).
   Se genera cuando cualquier usuario entra al sistema (máx. 1 vez por hora).
══════════════════════════════════════════════════════ */
function sstGenerarAvisos(PDO $pdo, bool $forzar = false): int {
    try {
        $pdo->exec("CREATE TABLE IF NOT EXISTS sst_meta (clave VARCHAR(40) PRIMARY KEY, valor VARCHAR(100))");
        $ts = (int)$pdo->query("SELECT valor FROM sst_meta WHERE clave='avisos_ts'")->fetchColumn();
        if (!$forzar && $ts && (time() - $ts) < 3600) return 0;
        $pdo->prepare("REPLACE INTO sst_meta (clave,valor) VALUES ('avisos_ts',?)")->execute([(string)time()]);

        $hay = $pdo->query("SHOW TABLES LIKE 'sst_items'")->fetchColumn();
        if (!$hay) return 0;
        $pdo->exec("CREATE TABLE IF NOT EXISTS notif_app (
            id INT AUTO_INCREMENT PRIMARY KEY, usuario VARCHAR(60) NOT NULL, notif_key VARCHAR(120) NOT NULL,
            tipo VARCHAR(30) DEFAULT 'solicitud', titulo VARCHAR(200) NOT NULL, msg VARCHAR(400) DEFAULT '',
            accion VARCHAR(60) DEFAULT '', fecha VARCHAR(40) DEFAULT '', leida TINYINT(1) DEFAULT 0,
            creado_en DATETIME DEFAULT NOW(), UNIQUE KEY uq_usuario_key (usuario, notif_key))");

        $hoy = date('Y-m-d');
        $limite = date('Y-m-d', strtotime('+7 days'));
        $items = $pdo->prepare("SELECT id,codigo,nombre,prox_inspeccion FROM sst_items
                                WHERE activo=1 AND estado<>'baja' AND prox_inspeccion IS NOT NULL AND prox_inspeccion<=?");
        $items->execute([$limite]);
        $items = $items->fetchAll(PDO::FETCH_ASSOC);
        if (!$items) return 0;

        // Responsables de SST: superadmin, distribuidor y quien tenga el permiso
        $mgr = $pdo->query("SELECT usuario,nombre,correo,rol,permisos FROM usuarios WHERE estado='activo'
                            AND (rol IN ('superadmin','distribuidor') OR permisos LIKE '%\"gestionar_sst\"%')")->fetchAll(PDO::FETCH_ASSOC);
        // Entregas abiertas por artículo
        $ent = $pdo->query("SELECT e.item_id, e.usuario, e.cantidad, TRIM(CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,''))) AS nombre, u.correo
                            FROM sst_entregas e LEFT JOIN usuarios u ON u.usuario=e.usuario
                            WHERE e.estado IN ('pendiente','activa')")->fetchAll(PDO::FETCH_ASSOC);
        $porItem = [];
        foreach ($ent as $e) $porItem[$e['item_id']][] = $e;

        $ins = $pdo->prepare("INSERT IGNORE INTO notif_app (usuario,notif_key,tipo,titulo,msg,accion,fecha,leida) VALUES (?,?,?,?,?,?,?,0)");
        $creadas = 0;
        $enviarCorreo = function(?string $correo, string $nombre, string $asunto, string $texto) {
            if (!$correo || !function_exists('_notif_enviar')) return;
            try { _notif_enviar($correo, $nombre ?: 'Usuario', $asunto, '<p style="font-size:14px;color:#334155;">'.htmlspecialchars($texto).'</p>'); } catch (\Throwable $e) {}
        };
        $fmt = fn($d) => date('d/m/Y', strtotime($d));

        foreach ($items as $it) {
            $dias = (int)floor((strtotime($it['prox_inspeccion']) - strtotime($hoy)) / 86400);
            $vencida = $dias <= 0;
            $etapa = $vencida ? 'v' : 'p';
            $cuando = $vencida ? 'ya está vencida' : ($dias === 1 ? 'vence mañana' : "vence en $dias días");
            $titulo = ($vencida ? '⛔ Inspección vencida: ' : '🔍 Inspección próxima: ') . $it['nombre'];
            $clave = "sst-ins-{$it['id']}-{$it['prox_inspeccion']}-$etapa";
            $manos = $porItem[$it['id']] ?? [];
            $quien = $manos ? ' · En manos de: ' . implode(', ', array_map(fn($m) => ($m['nombre'] ?: $m['usuario']) . ($m['cantidad'] > 1 ? " x{$m['cantidad']}" : ''), $manos)) : '';

            // 1) Responsables de SST
            foreach ($mgr as $m) {
                $msg = "{$it['codigo']}: la inspección (" . $fmt($it['prox_inspeccion']) . ") $cuando.$quien";
                $ins->execute([$m['usuario'], $clave, 'sst', $titulo, mb_substr($msg, 0, 400), 'sst', date('c')]);
                if ($ins->rowCount() > 0) {
                    $creadas++;
                    $explicito = strpos((string)$m['permisos'], 'gestionar_sst') !== false;
                    if ($explicito) $enviarCorreo($m['correo'], $m['nombre'], $titulo, $msg);
                }
            }
            // 2) Quien lo tiene entregado
            foreach ($manos as $h) {
                $msg = "Tu {$it['nombre']} ({$it['codigo']}) necesita inspección el " . $fmt($it['prox_inspeccion']) . " ($cuando). Entrégalo al responsable de SST para revisarlo.";
                $ins->execute([$h['usuario'], $clave, 'sst', $titulo, mb_substr($msg, 0, 400), 'misequipos', date('c')]);
                if ($ins->rowCount() > 0) { $creadas++; $enviarCorreo($h['correo'], $h['nombre'], $titulo, $msg); }
            }
        }
        return $creadas;
    } catch (\Throwable $e) {
        error_log('[sst/avisos] ' . $e->getMessage());
        return 0;
    }
}