<?php
/* ══════════════════════════════════════════════════════════════
   SOLICITUDES DE COMPRA
   Cuando hace falta COMPRAR algo (no pedirlo al almacén): puede ser un
   producto ya registrado o uno que la empresa nunca ha tenido.
   Flujo: pendiente → aprobada   (o rechazada / cancelada).
   Cuando llega el material, el ingreso se registra como siempre (Ingreso de stock).

   Permisos:
     solicitar_compras → crear solicitudes y ver las propias
     gestionar_compras → ver todas, aprobar y rechazar
   (superadmin siempre puede todo)
══════════════════════════════════════════════════════════════ */
require 'config.php';
require_once 'auditoria.php';
require_once 'notificaciones.php';
sesionRequerida();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ── Tablas (autocreación) ── */
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS compras_solicitudes (
            id                INT AUTO_INCREMENT PRIMARY KEY,
            solicitado_por    VARCHAR(60) NOT NULL,
            solicitante_nombre VARCHAR(150) DEFAULT NULL,
            prioridad         VARCHAR(10) NOT NULL DEFAULT 'normal',
            motivo            TEXT,
            proveedor         VARCHAR(150) DEFAULT NULL,
            estado            VARCHAR(15) NOT NULL DEFAULT 'pendiente',
            gestionado_por    VARCHAR(60) DEFAULT NULL,
            gestionado_en     DATETIME DEFAULT NULL,
            motivo_rechazo    TEXT,
            nota_compra       TEXT,
            comprada_por      VARCHAR(60) DEFAULT NULL,
            comprada_en       DATETIME DEFAULT NULL,
            recibida_por      VARCHAR(60) DEFAULT NULL,
            recibida_en       DATETIME DEFAULT NULL,
            creado_en         DATETIME DEFAULT NOW(),
            INDEX idx_estado (estado),
            INDEX idx_solicitante (solicitado_por)
        ) CHARACTER SET utf8mb4
    ");
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS compras_items (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            solicitud_id  INT NOT NULL,
            producto_id   INT DEFAULT NULL,
            ref           VARCHAR(60) DEFAULT NULL,
            nombre        VARCHAR(200) NOT NULL,
            es_nuevo      TINYINT(1) NOT NULL DEFAULT 0,
            cantidad      DECIMAL(12,2) NOT NULL DEFAULT 1,
            unidad        VARCHAR(30) DEFAULT 'unidades',
            nota          VARCHAR(300) DEFAULT NULL,
            INDEX idx_sol (solicitud_id)
        ) CHARACTER SET utf8mb4
    ");
try { $pdo->exec("ALTER TABLE compras_items ADD COLUMN proveedor VARCHAR(150) DEFAULT NULL"); } catch (\Throwable $e) { /* ya existe */ }
} catch (\Throwable $e) { error_log('[compras/tablas] ' . $e->getMessage()); }

// Columnas agregadas después (observación del admin y cantidad originalmente pedida)
try {
    if (!$pdo->query("SHOW COLUMNS FROM compras_solicitudes LIKE 'observacion_admin'")->fetch())
        $pdo->exec("ALTER TABLE compras_solicitudes ADD COLUMN observacion_admin TEXT NULL");
    if (!$pdo->query("SHOW COLUMNS FROM compras_items LIKE 'cantidad_original'")->fetch())
        $pdo->exec("ALTER TABLE compras_items ADD COLUMN cantidad_original DECIMAL(12,2) NULL");
} catch (\Throwable $e) { error_log('[compras/columnas] ' . $e->getMessage()); }

function _compras_puedeGestionar(): bool {
    return usuarioTienePermiso('gestionar_compras');
}
function _compras_puedeSolicitar(): bool {
    return usuarioTienePermiso('solicitar_compras') || usuarioTienePermiso('gestionar_compras');
}
function _compras_nombreSesion($pdo): string {
    try {
        $q = $pdo->prepare("SELECT nombre, apellido FROM usuarios WHERE usuario = ?");
        $q->execute([$_SESSION['usuario']]);
        $u = $q->fetch();
        $n = trim(($u['nombre'] ?? '') . ' ' . ($u['apellido'] ?? ''));
        if ($n !== '') return $n;
    } catch (\Throwable $e) {}
    return $_SESSION['usuario'];
}
function _compras_cargar($pdo, array $filas): array {
    if (!$filas) return [];
    $ids = array_map(fn($f) => (int)$f['id'], $filas);
    $in  = implode(',', $ids);
    $items = [];
    foreach ($pdo->query("SELECT * FROM compras_items WHERE solicitud_id IN ($in) ORDER BY id")->fetchAll() as $it) {
        $items[(int)$it['solicitud_id']][] = [
            'id'         => (int)$it['id'],
            'productoId' => $it['producto_id'] !== null ? (int)$it['producto_id'] : null,
            'ref'        => $it['ref'],
            'nombre'     => $it['nombre'],
            'esNuevo'    => (bool)$it['es_nuevo'],
            'cantidad'   => (float)$it['cantidad'],
            'cantidadOriginal' => $it['cantidad_original'] !== null ? (float)$it['cantidad_original'] : null,
            'unidad'     => $it['unidad'],
            'nota'       => $it['nota'] ?? '',
            'proveedor'  => $it['proveedor'] ?? '',
        ];
    }
    return array_map(function($f) use ($items) {
        return [
            'id'              => (int)$f['id'],
            'codigo'          => 'SC-' . str_pad((string)$f['id'], 4, '0', STR_PAD_LEFT),
            'solicitadoPor'   => $f['solicitado_por'],
            'solicitante'     => $f['solicitante_nombre'] ?: $f['solicitado_por'],
            'prioridad'       => $f['prioridad'],
            'motivo'          => $f['motivo'] ?? '',
            'proveedor'       => $f['proveedor'] ?? '',
            'estado'          => $f['estado'],
            'gestionadoPor'   => $f['gestionado_por'],
            'gestionadoEn'    => $f['gestionado_en'],
            'motivoRechazo'   => $f['motivo_rechazo'] ?? '',
            'observacionAdmin'=> $f['observacion_admin'] ?? '',
            'notaCompra'      => $f['nota_compra'] ?? '',
            'compradaEn'      => $f['comprada_en'],
            'recibidaEn'      => $f['recibida_en'],
            'creadoEn'        => $f['creado_en'],
            'items'           => $items[(int)$f['id']] ?? [],
        ];
    }, $filas);
}
function _compras_resumen(array $items): string {
    return implode(', ', array_map(function($i) {
        $c = rtrim(rtrim(number_format((float)$i['cantidad'], 2, '.', ''), '0'), '.');
        return $c . ' ' . ($i['unidad'] ?: '') . ' de ' . $i['nombre'];
    }, $items));
}
function _compras_correosGestores($pdo): array {
    try {
        return $pdo->query("SELECT usuario, nombre, correo FROM usuarios
            WHERE estado = 'activo' AND correo IS NOT NULL AND correo != ''
              AND (rol = 'superadmin' OR permisos LIKE '%\"gestionar_compras\"%')")->fetchAll();
    } catch (\Throwable $e) { return []; }
}
function _compras_avisarSolicitante($pdo, array $sol, string $asunto, string $mensajeHtml): void {
    try {
        $dest = _notif_correoUsuario($pdo, $sol['solicitado_por']);
        if (!$dest) return;
        $nom = htmlspecialchars($dest['nombre'] ?: $sol['solicitado_por']);
        _notif_enviar($dest['correo'], $dest['nombre'], $asunto,
            "<p>Hola <strong>{$nom}</strong>,</p>{$mensajeHtml}
             <p style='font-size:13px;color:#64748B;'>Puedes ver el detalle en el sistema, en <strong>Solicitudes de compra</strong>.</p>");
    } catch (\Throwable $e) { error_log('[compras/avisar] ' . $e->getMessage()); }
}

/* ══ LISTAR ══ */
if ($method === 'GET' && $action === 'listar') {
    if (!_compras_puedeSolicitar()) responder(['error' => 'Sin permisos para esta acción'], 403);
    $todas = _compras_puedeGestionar();
    $where = []; $params = [];
    if (!$todas) { $where[] = 'solicitado_por = ?'; $params[] = $_SESSION['usuario']; }
    if (!empty($_GET['estado'])) { $where[] = 'estado = ?'; $params[] = $_GET['estado']; }
    $sql = "SELECT * FROM compras_solicitudes" . ($where ? ' WHERE ' . implode(' AND ', $where) : '')
         . " ORDER BY FIELD(estado,'pendiente','aprobada','comprada','recibida','rechazada','cancelada'), id DESC LIMIT 500";
    $st = $pdo->prepare($sql);
    $st->execute($params);
    responder([
        'solicitudes'   => _compras_cargar($pdo, $st->fetchAll()),
        'puedeGestionar'=> $todas,
    ]);
}

/* ══ CREAR ══ */
if ($method === 'POST' && $action === 'crear') {
    if (!_compras_puedeSolicitar()) responder(['error' => 'Sin permisos para crear solicitudes de compra'], 403);
    $data  = json_decode(file_get_contents('php://input'), true) ?: [];
    $itemsIn = is_array($data['items'] ?? null) ? $data['items'] : [];
    if (!$itemsIn) responder(['error' => 'Agrega al menos un producto a la solicitud'], 400);
    if (count($itemsIn) > 50) responder(['error' => 'Máximo 50 productos por solicitud'], 400);

    $items = [];
    foreach ($itemsIn as $it) {
        $cant = (float)($it['cantidad'] ?? 0);
        if ($cant <= 0) responder(['error' => 'Todas las cantidades deben ser mayores a 0'], 400);
        $pid = !empty($it['productoId']) ? (int)$it['productoId'] : null;
        $nombre = trim($it['nombre'] ?? '');
        $ref = null; $esNuevo = 0; $provItem = mb_substr(trim($it['proveedor'] ?? ''), 0, 150);
        if ($pid) {
            $q = $pdo->prepare("SELECT ref, nombre, proveedor FROM productos WHERE id = ?");
            $q->execute([$pid]);
            $p = $q->fetch();
            if (!$p) responder(['error' => 'Uno de los productos ya no existe'], 400);
            $ref = $p['ref']; $nombre = $p['nombre'];
            if ($provItem === '') $provItem = mb_substr(trim($p['proveedor'] ?? ''), 0, 150);
        } elseif (preg_match('/^(ONT|FIBRA|EQUIPO)::/', (string)($it['especial'] ?? ''))) {
            // ONT, fibra/carretes, OLT y equipos: no están en la tabla productos, pero NO son "producto nuevo"
            if ($nombre === '') responder(['error' => 'Falta el nombre del producto'], 400);
            $ref = mb_substr((string)$it['especial'], 0, 60);
        } else {
            if ($nombre === '') responder(['error' => 'Escribe el nombre del producto nuevo'], 400);
            $esNuevo = 1;
        }
        $items[] = [
            'producto_id' => $pid, 'ref' => $ref, 'nombre' => mb_substr($nombre, 0, 200),
            'es_nuevo' => $esNuevo, 'cantidad' => $cant,
            'unidad' => mb_substr(trim($it['unidad'] ?? 'unidades') ?: 'unidades', 0, 30),
            'nota' => mb_substr(trim($it['nota'] ?? ''), 0, 300),
            'proveedor' => $provItem,
        ];
    }
    $prioridad = ($data['prioridad'] ?? 'normal') === 'urgente' ? 'urgente' : 'normal';
    $motivo    = trim($data['motivo'] ?? '');
    $proveedor = mb_substr(trim($data['proveedor'] ?? ''), 0, 150);
    $nombreSol = _compras_nombreSesion($pdo);

    $pdo->beginTransaction();
    try {
        $pdo->prepare("INSERT INTO compras_solicitudes (solicitado_por, solicitante_nombre, prioridad, motivo, proveedor)
                       VALUES (?,?,?,?,?)")
            ->execute([$_SESSION['usuario'], $nombreSol, $prioridad, $motivo, $proveedor ?: null]);
        $id = (int)$pdo->lastInsertId();
        $ins = $pdo->prepare("INSERT INTO compras_items (solicitud_id, producto_id, ref, nombre, es_nuevo, cantidad, unidad, nota, proveedor)
                              VALUES (?,?,?,?,?,?,?,?,?)");
        foreach ($items as $i) {
            $ins->execute([$id, $i['producto_id'], $i['ref'], $i['nombre'], $i['es_nuevo'], $i['cantidad'], $i['unidad'], $i['nota'] ?: null, $i['proveedor'] ?: null]);
        }
        $pdo->commit();
    } catch (\Throwable $e) {
        $pdo->rollBack();
        error_log('[compras/crear] ' . $e->getMessage());
        responder(['error' => 'No se pudo guardar la solicitud'], 500);
    }

    auditar($pdo, 'crear', 'compras', "Solicitud de compra SC-" . str_pad((string)$id, 4, '0', STR_PAD_LEFT) . ": " . _compras_resumen($items), (string)$id);

    // Aviso por correo a quienes gestionan las compras (después de guardar; si falla, no afecta)
    try {
        $codigo = 'SC-' . str_pad((string)$id, 4, '0', STR_PAD_LEFT);
        $resumen = htmlspecialchars(_compras_resumen($items));
        $urg = $prioridad === 'urgente' ? ' 🔴 URGENTE' : '';
        $quien = htmlspecialchars($nombreSol);
        foreach (_compras_correosGestores($pdo) as $g) {
            if (($g['usuario'] ?? '') === $_SESSION['usuario']) continue;
            $nom = htmlspecialchars($g['nombre']);
            _notif_enviar($g['correo'], $g['nombre'], "🛒 Nueva solicitud de compra {$codigo}{$urg}",
                "<p>Hola <strong>{$nom}</strong>,</p>
                 <p><strong>{$quien}</strong> creó la solicitud de compra <strong>{$codigo}</strong>{$urg}.</p>
                 <p style='background:#F1F5F9;border-radius:8px;padding:12px;font-size:13px;'>{$resumen}</p>
                 <p style='font-size:13px;color:#64748B;'>Ingresa al sistema, en <strong>Solicitudes de compra</strong>, para aprobarla o rechazarla.</p>");
        }
    } catch (\Throwable $e) { error_log('[compras/aviso] ' . $e->getMessage()); }

    responder(['ok' => true, 'id' => $id]);
}

/* ── Acciones sobre una solicitud existente ── */
function _compras_obtener($pdo, int $id): array {
    $q = $pdo->prepare("SELECT * FROM compras_solicitudes WHERE id = ?");
    $q->execute([$id]);
    $s = $q->fetch();
    if (!$s) responder(['error' => 'Solicitud no encontrada'], 404);
    return $s;
}
function _compras_itemsDe($pdo, int $id): array {
    $q = $pdo->prepare("SELECT nombre, cantidad, unidad FROM compras_items WHERE solicitud_id = ?");
    $q->execute([$id]);
    return $q->fetchAll();
}

if ($method === 'POST' && in_array($action, ['aprobar','rechazar','cancelar'], true)) {
    $data = json_decode(file_get_contents('php://input'), true) ?: [];
    $id = (int)($data['id'] ?? 0);
    if (!$id) responder(['error' => 'Falta la solicitud'], 400);
    $sol = _compras_obtener($pdo, $id);
    $codigo = 'SC-' . str_pad((string)$id, 4, '0', STR_PAD_LEFT);
    $yo = $_SESSION['usuario'];

    if ($action === 'cancelar') {
        // Solo quien creó la solicitud, y mientras siga pendiente (el admin usa "rechazar")
        if ($sol['solicitado_por'] !== $yo) responder(['error' => 'Solo quien creó la solicitud puede cancelarla'], 403);
        if ($sol['estado'] !== 'pendiente') responder(['error' => 'Esta solicitud ya no se puede cancelar'], 400);
        $pdo->prepare("UPDATE compras_solicitudes SET estado='cancelada', gestionado_por=?, gestionado_en=NOW() WHERE id=?")->execute([$yo, $id]);
        auditar($pdo, 'cancelar', 'compras', "Solicitud de compra {$codigo} cancelada", (string)$id);
        responder(['ok' => true]);
    }

    // El resto solo para quien gestiona las compras
    if (!_compras_puedeGestionar()) responder(['error' => 'Sin permisos para esta acción'], 403);
    $resumenHtml = htmlspecialchars(_compras_resumen(_compras_itemsDe($pdo, $id)));

    if ($action === 'aprobar') {
        if ($sol['estado'] !== 'pendiente') responder(['error' => 'Solo se pueden aprobar solicitudes pendientes'], 400);
        $prov = mb_substr(trim($data['proveedor'] ?? ''), 0, 150);
        $obs  = mb_substr(trim($data['observacion'] ?? ''), 0, 1000);

        // El admin puede ajustar las cantidades al aprobar: se guarda lo que pidieron como "cantidad_original"
        $cambios = [];
        if (is_array($data['items'] ?? null)) {
            $q = $pdo->prepare("SELECT id, nombre, cantidad, cantidad_original, unidad FROM compras_items WHERE solicitud_id = ?");
            $q->execute([$id]);
            $actuales = [];
            foreach ($q->fetchAll() as $r) $actuales[(int)$r['id']] = $r;
            foreach ($data['items'] as $it) {
                $iid = (int)($it['id'] ?? 0);
                if (!isset($actuales[$iid])) continue;
                $nueva = (float)($it['cantidad'] ?? 0);
                if ($nueva <= 0) responder(['error' => 'Las cantidades deben ser mayores a 0'], 400);
                $ant = (float)$actuales[$iid]['cantidad'];
                if (abs($nueva - $ant) > 0.0001) {
                    $pdo->prepare("UPDATE compras_items SET cantidad_original = COALESCE(cantidad_original, cantidad), cantidad = ? WHERE id = ?")
                        ->execute([$nueva, $iid]);
                    $cambios[] = $actuales[$iid]['nombre'] . ': ' . rtrim(rtrim(number_format($ant, 2, '.', ''), '0'), '.') . ' → ' . rtrim(rtrim(number_format($nueva, 2, '.', ''), '0'), '.') . ' ' . $actuales[$iid]['unidad'];
                }
            }
        }

        $pdo->prepare("UPDATE compras_solicitudes SET estado='aprobada', gestionado_por=?, gestionado_en=NOW(), proveedor=COALESCE(NULLIF(?,''), proveedor), observacion_admin=? WHERE id=?")
            ->execute([$yo, $prov, $obs ?: null, $id]);
        $detalle = "Solicitud de compra {$codigo} aprobada" . ($cambios ? ' (cantidades ajustadas: ' . implode('; ', $cambios) . ')' : '') . ($obs ? " — Obs: {$obs}" : '');
        auditar($pdo, 'aprobar', 'compras', $detalle, (string)$id);

        $resumenHtml = htmlspecialchars(_compras_resumen(_compras_itemsDe($pdo, $id)));
        $extra = '';
        if ($cambios) $extra .= "<p style='background:#FAEEDA;border-radius:8px;padding:12px;font-size:13px;'><strong>Cantidades ajustadas:</strong><br>" . htmlspecialchars(implode("\n", $cambios)) . "</p>";
        if ($obs)     $extra .= "<p style='background:#E6F1FB;border-radius:8px;padding:12px;font-size:13px;'><strong>Observación:</strong> " . htmlspecialchars($obs) . "</p>";
        $extra = str_replace("\n", '<br>', $extra);
        _compras_avisarSolicitante($pdo, $sol, "✅ Solicitud de compra {$codigo} aprobada",
            "<p>Tu solicitud de compra <strong>{$codigo}</strong> fue <strong style='color:#16A850;'>aprobada</strong>.</p><p style='background:#F1F5F9;border-radius:8px;padding:12px;font-size:13px;'>{$resumenHtml}</p>{$extra}");
        responder(['ok' => true]);
    }
    if ($action === 'rechazar') {
        if (!in_array($sol['estado'], ['pendiente','aprobada'], true)) responder(['error' => 'Esta solicitud ya no se puede rechazar'], 400);
        $motivo = trim($data['motivo'] ?? '');
        if ($motivo === '') responder(['error' => 'Escribe el motivo del rechazo'], 400);
        $pdo->prepare("UPDATE compras_solicitudes SET estado='rechazada', gestionado_por=?, gestionado_en=NOW(), motivo_rechazo=? WHERE id=?")
            ->execute([$yo, $motivo, $id]);
        auditar($pdo, 'rechazar', 'compras', "Solicitud de compra {$codigo} rechazada: {$motivo}", (string)$id);
        $mot = htmlspecialchars($motivo);
        _compras_avisarSolicitante($pdo, $sol, "❌ Solicitud de compra {$codigo} rechazada",
            "<p>Tu solicitud de compra <strong>{$codigo}</strong> fue <strong style='color:#DC2626;'>rechazada</strong>.</p><p style='background:#FEF2F2;border-radius:8px;padding:12px;font-size:13px;'>Motivo: {$mot}</p>");
        responder(['ok' => true]);
    }
}

responder(['error' => 'Acción no válida'], 404);