<?php
error_reporting(0);
ini_set('display_errors', 0);
require_once 'config.php';
require_once 'notificaciones.php';
sesionRequerida();

// Cargar auditar()
if (!function_exists('auditar')) {
    require_once 'auditoria.php';
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ── Asegurar columnas necesarias (por si las tablas se crearon
      manualmente en algún momento y quedaron incompletas). ── */
try {
    foreach (['solicitudes', 'pedidos_agrupados'] as $tabla) {
        $existe = $pdo->query("SHOW COLUMNS FROM $tabla LIKE 'gestionado_por'")->fetch();
        if (!$existe) {
            $pdo->exec("ALTER TABLE $tabla ADD COLUMN gestionado_por VARCHAR(60) DEFAULT NULL");
        }
        $existeAprob = $pdo->query("SHOW COLUMNS FROM $tabla LIKE 'aprobado_por'")->fetch();
        if (!$existeAprob) {
            $pdo->exec("ALTER TABLE $tabla ADD COLUMN aprobado_por VARCHAR(60) DEFAULT NULL");
        }
        // Si 'estado' quedó como ENUM con una lista fija de valores viejos,
        // se convierte a texto libre para que acepte cualquier estado que
        // el sistema use ahora o en el futuro (en_gestion, parcial, etc.).
        $colEstado = $pdo->query("SHOW COLUMNS FROM $tabla LIKE 'estado'")->fetch();
        if ($colEstado && stripos($colEstado['Type'], 'enum') === 0) {
            $pdo->exec("ALTER TABLE $tabla MODIFY estado VARCHAR(30) NOT NULL DEFAULT 'pendiente'");
        }
    }
} catch (\Throwable $e) { error_log('[pedidos_agrupados/columna gestionado_por] '.$e->getMessage()); }

/* ══ LISTAR ══════════════════════════════════════════════ */
if ($method === 'GET' && $action === 'listar') {
    $rol     = $_SESSION['rol']      ?? '';
    $usuario = $_SESSION['usuario']  ?? '';
    $sede    = $_SESSION['sede']     ?? '';

    // Ve TODOS los pedidos: superadmin, distribuidor, o cualquier cuenta a
    // la que le hayan dado a mano el permiso de gestionar/aprobar pedidos
    // (sin esto, aunque tuviera el permiso para aprobar, esta lista solo
    // le traía sus propios pedidos y nunca los de los demás).
    $veTodos = $rol === 'superadmin' || $rol === 'distribuidor'
        || usuarioTienePermiso('gestionar_pedidos') || usuarioTienePermiso('aprobar_pedidos');

    if ($veTodos) {
        $stmt = $pdo->query("
            SELECT pa.*, pa.municipio as destino,
              COUNT(s.id) as total_items
            FROM pedidos_agrupados pa
            LEFT JOIN solicitudes s ON s.pedido_agrupado_id = pa.id
            GROUP BY pa.id
            ORDER BY pa.fecha DESC
        ");
    } else {
        $stmt = $pdo->prepare("
            SELECT pa.*, pa.municipio as destino,
              COUNT(s.id) as total_items
            FROM pedidos_agrupados pa
            LEFT JOIN solicitudes s ON s.pedido_agrupado_id = pa.id
            WHERE pa.solicitado_por = ?
            GROUP BY pa.id
            ORDER BY pa.fecha DESC
        ");
        $stmt->execute([$usuario]);
    }

    $pedidos = $stmt->fetchAll();

    $solCols = $pdo->query("SHOW COLUMNS FROM solicitudes")->fetchAll(PDO::FETCH_COLUMN);
    $colCatFibra = in_array('categoria_fibra_id', $solCols) ? ', s.categoria_fibra_id' : '';

    $colMotivo = in_array('motivo', $solCols) ? ', s.motivo' : '';
    foreach ($pedidos as &$ped) {
        $items = $pdo->prepare("
            SELECT s.id, s.ref, s.nombre, s.cantidad, s.cantidad_aprobada, s.unidad_envio, s.estado$colMotivo$colCatFibra
            FROM solicitudes s
            WHERE s.pedido_agrupado_id = ?
            ORDER BY s.fecha
        ");
        $items->execute([$ped['id']]);
        $ped['items'] = $items->fetchAll();
    }

    responder($pedidos);
}

/* ══ CREAR ═══════════════════════════════════════════════ */
// Guarda el motivo del rechazo en cada producto rechazado, para que se vea en la lista (no solo en "Ver detalles").
function _guardarMotivoRechazoItem(PDO $pdo, string $solId, string $motivo): void {
    if ($motivo === '') return;
    try {
        $cols = $pdo->query("SHOW COLUMNS FROM solicitudes")->fetchAll(PDO::FETCH_COLUMN);
        $set = []; $par = [];
        if (in_array('motivo', $cols))        { $set[] = "motivo = ?";        $par[] = mb_substr($motivo, 0, 500); }
        if (in_array('rechazado_por', $cols)) { $set[] = "rechazado_por = ?"; $par[] = $_SESSION['usuario'] ?? ''; }
        if (!$set) return;
        $par[] = $solId;
        $pdo->prepare("UPDATE solicitudes SET " . implode(', ', $set) . " WHERE id = ?")->execute($par);
    } catch (\Throwable $e) { error_log('[motivo rechazo item] ' . $e->getMessage()); }
}

if ($method === 'POST' && $action === 'crear') {
    $data    = json_decode(file_get_contents('php://input'), true);
    $items   = $data['items']   ?? [];
    $destino = $data['destino'] ?? '';
    $nota    = trim($data['nota']    ?? '');
    $notaSellada = $nota !== '' ? "[Solicitud · {$_SESSION['usuario']}] $nota" : '';

    if (empty($items) || !$destino) {
        responder(['error' => 'Faltan datos'], 400);
    }

    // Las ONT solo las puede solicitar la oficina (municipio) — ella es
    // quien las recibe y las asigna internamente a sus técnicos/personas.
    $rolActual = $_SESSION['rol'] ?? '';
    if (in_array($rolActual, ['tecnico','persona'])) {
        foreach ($items as $item) {
            if (stripos($item['ref'] ?? '', 'ONT::') === 0) {
                responder(['error' => 'Solo tu oficina (municipio) puede solicitar ONTs — pídesela a ellos y ellos te la asignan.'], 403);
            }
        }
    }

    $pedidoId = uniqid('pag_', true);
    $usuario  = $_SESSION['usuario'];

    $pdo->beginTransaction();
    try {
        // INSERT tolerante en pedidos_agrupados (solo columnas existentes).
        $pcols = $pdo->query("SHOW COLUMNS FROM pedidos_agrupados")->fetchAll(PDO::FETCH_COLUMN);
        $pvals = ['id'=>$pedidoId, 'destino'=>$destino, 'municipio'=>$destino, 'solicitado_por'=>$usuario, 'nota'=>$notaSellada, 'estado'=>'pendiente'];
        $pc=[]; $pp=[]; $ppar=[];
        foreach ($pvals as $col=>$val){ if(in_array($col,$pcols)){ $pc[]=$col; $pp[]='?'; $ppar[]=$val; } }
        if (in_array('fecha', $pcols)) { $pc[]='fecha'; $pp[]='NOW()'; }
        $pdo->prepare("INSERT INTO pedidos_agrupados (".implode(',',$pc).") VALUES (".implode(',',$pp).")")->execute($ppar);

        // Detectar columnas e id de solicitudes (la columna id es VARCHAR sin auto_increment).
        $scols = $pdo->query("SHOW COLUMNS FROM solicitudes")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($items as $item) {
            $origenItem = trim($item['origen_stock'] ?? 'nuevo');
            $carreteIdItem = intval($item['carrete_id'] ?? 0);
            $notaItem = ($origenItem === 'recuperado' ? '[STOCK:recuperado] ' : '')
                . ($carreteIdItem ? "Carrete elegido: $carreteIdItem " : '')
                . $nota;
            $svals = [
                'id'                 => uniqid('sol_', true),
                'ref'                => $item['ref']    ?? '',
                'nombre'             => $item['nombre'] ?? '',
                'destino'            => $destino,
                'cantidad'           => intval($item['cantidad'] ?? 0),
                'unidad_envio'       => $item['unidad'] ?? 'unidad',
                'solicitado_por'     => $usuario,
                'estado'             => 'pendiente',
                'nota'               => $notaItem,
                'pedido_agrupado_id' => $pedidoId,
                'categoria_fibra_id' => $item['categoria_fibra_id'] ?? null,
            ];
            $sc=[]; $sp=[]; $spar=[];
            foreach ($svals as $col=>$val){ if(in_array($col,$scols)){ $sc[]=$col; $sp[]='?'; $spar[]=$val; } }
            if (in_array('fecha', $scols)) { $sc[]='fecha'; $sp[]='NOW()'; }
            $pdo->prepare("INSERT INTO solicitudes (".implode(',',$sc).") VALUES (".implode(',',$sp).")")->execute($spar);
        }

        $pdo->commit();
        try { auditar($pdo, 'crear', 'solicitudes', "Pedido agrupado: $destino — " . count($items) . " productos", ''); } catch (\Throwable $e) { error_log('[ped_agrup/auditar] '.$e->getMessage()); }

        try {
            $resumen = implode(', ', array_map(function($it){
                $u = ($it['unidad'] ?? '') === 'metros' ? 'mts.' : 'uds.';
                return intval($it['cantidad'] ?? 0) . " {$u} de \"" . ($it['nombre'] ?? '') . "\"";
            }, $items));
            notificarNuevoPedidoAdmin($pdo, $usuario, $destino, $resumen, 'solicitudes');
        } catch (\Throwable $e) { error_log('[pedidos_agrupados/crear notif] '.$e->getMessage()); }
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('[pedidos_agrupados/crear] ' . $e->getMessage());
        responder(['error' => 'Error al crear: ' . $e->getMessage()], 500);
    }

    responder(['ok' => true, 'id' => $pedidoId]);
}

/* ══ APROBAR ITEMS ═══════════════════════════════════════ */
/* Escalar items (distribuidor) */
/* ══ CANCELAR (solo quien lo pidió y solo si NADA se ha procesado) ══ */
if ($method === 'POST' && $action === 'cancelar') {
    $d  = json_decode(file_get_contents('php://input'), true);
    $id = $d['id'] ?? '';
    if (!$id) responder(['error' => 'ID requerido'], 400);
    $st = $pdo->prepare("SELECT solicitado_por, estado FROM pedidos_agrupados WHERE id = ?");
    $st->execute([$id]);
    $g = $st->fetch();
    if (!$g) responder(['error' => 'Pedido no encontrado'], 404);
    if ($g['solicitado_por'] !== ($_SESSION['usuario'] ?? '')) responder(['error' => 'Solo quien hizo el pedido lo puede cancelar'], 403);
    $pdo->beginTransaction();
    try {
        $hijas = $pdo->prepare("SELECT COUNT(*) FROM solicitudes WHERE pedido_agrupado_id = ? AND estado <> 'pendiente'");
        $hijas->execute([$id]);
        if ($g['estado'] !== 'pendiente' || (int)$hijas->fetchColumn() > 0) {
            $pdo->rollBack();
            responder(['error' => 'Este pedido ya tiene partes procesadas, no se puede cancelar'], 409);
        }
        $pdo->prepare("DELETE FROM solicitudes WHERE pedido_agrupado_id = ? AND estado = 'pendiente'")->execute([$id]);
        $pdo->prepare("DELETE FROM pedidos_agrupados WHERE id = ? AND estado = 'pendiente'")->execute([$id]);
        $pdo->commit();
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('[agrupados/cancelar] ' . $e->getMessage());
        responder(['error' => 'No se pudo cancelar el pedido'], 500);
    }
    try { auditar($pdo, 'cancelar', 'pedidos_agrupados', "Canceló su pedido múltiple pendiente: $id" . (($d['nota'] ?? '') !== '' ? " — Nota: " . mb_substr(trim($d['nota']), 0, 300) : ''), (string)$id); } catch (\Throwable $e) {}
    responder(['ok' => true]);
}

if ($method === 'POST' && $action === 'escalar_items') {
    // Ajustar cantidades aprobadas es exclusivo de superadmin — el
    // distribuidor solo puede ver el detalle, no gestionar/ajustar nada,
    // aunque tenga el permiso general de "gestionar_pedidos" (ese permiso
    // solo controla si ve la pantalla, no si puede ajustar cantidades aquí).
    rolRequerido('superadmin');
    $data     = json_decode(file_get_contents('php://input'), true);
    $pedidoId = $data['pedido_id'] ?? '';
    $items    = $data['items']    ?? [];
    $nota     = trim($data['nota'] ?? '');
    if (!$pedidoId) responder(['error' => 'Pedido requerido'], 400);
    foreach ($items as $item) {
        $pdo->prepare("UPDATE solicitudes SET cantidad_aprobada=?, gestionado_por=? WHERE id=?")
            ->execute([$item['cantidad_aprobada'], $_SESSION['usuario'], $item['id']]);
    }
    if ($nota !== '') {
        $sello = '[Escalado · ' . ($_SESSION['usuario'] ?? '') . '] ';
        try { $pdo->prepare("UPDATE pedidos_agrupados SET estado='en_gestion', gestionado_por=?, nota=TRIM(CONCAT(COALESCE(nota,''),'\n',?)) WHERE id=?")
            ->execute([$_SESSION['usuario'], $sello . $nota, $pedidoId]); }
        catch (\Throwable $e) {
            $pdo->prepare("UPDATE pedidos_agrupados SET estado='en_gestion', gestionado_por=? WHERE id=?")->execute([$_SESSION['usuario'], $pedidoId]);
        }
    } else {
        $pdo->prepare("UPDATE pedidos_agrupados SET estado='en_gestion', gestionado_por=? WHERE id=?")
            ->execute([$_SESSION['usuario'], $pedidoId]);
    }
    $pdo->prepare("UPDATE solicitudes SET estado='en_gestion', gestionado_por=? WHERE pedido_agrupado_id=? AND estado='pendiente'")
        ->execute([$_SESSION['usuario'], $pedidoId]);
    auditar($pdo, 'escalar', 'pedidos', "Pedido agrupado escalado: $pedidoId".($nota?" ($nota)":''), '');
    responder(['ok' => true, 'escalado' => count($items)]);
}

/* Cuenta ONTs disponibles (tabla ont_seriales) para un ref tipo "ONT::<modelo>".
   Usa el mismo criterio de coincidencia (exacta/parcial, con respaldo a todas
   las disponibles) que ya usa cajas.php?action=onts_disponibles_de_modelo,
   para que valide contra la misma fuente de verdad que ve el usuario. */
function _ontCantidadDisponible(PDO $pdo, string $refOnt): int {
    $modelo = trim(str_ireplace('ONT::', '', $refOnt));
    if ($modelo === '') return 0;
    $like = '%' . $modelo . '%';
    $st = $pdo->prepare("SELECT COUNT(*) FROM ont_seriales
        WHERE estado='disponible'
          AND (
            LOWER(TRIM(COALESCE(modelo,''))) = LOWER(?)
            OR LOWER(COALESCE(modelo,'')) LIKE LOWER(?)
            OR LOWER(?) LIKE CONCAT('%', LOWER(TRIM(COALESCE(modelo,''))), '%')
          )");
    $st->execute([$modelo, $like, $modelo]);
    $cant = (int)$st->fetchColumn();
    if ($cant > 0) return $cant;
    // Sin coincidencia por modelo: contar todas las disponibles como respaldo.
    return (int)$pdo->query("SELECT COUNT(*) FROM ont_seriales WHERE estado='disponible'")->fetchColumn();
}

/* Metros disponibles en almacén central para una categoría de fibra,
   mismo cálculo que usa fibra.php?action=categorias. */
function _fibraMetrosDisponibles(PDO $pdo, $categoriaId): float {
    if (!$categoriaId) return -1; // -1 = no se pudo determinar la categoría (no bloquear)
    $centrales = $pdo->query("SELECT nombre FROM sedes WHERE tipo IN ('central','distribuidor') AND nombre NOT IN ('Sistema','Administración')")->fetchAll(PDO::FETCH_COLUMN);
    $centrales = array_values(array_unique($centrales));
    $ph = implode(',', array_fill(0, count($centrales), '?'));
    $st = $pdo->prepare("SELECT COALESCE(SUM(metros - metros_usados),0) FROM fibra_carretes WHERE categoria_id = ? AND sede_nombre IN ($ph)");
    $st->execute(array_merge([$categoriaId], $centrales));
    return (float)$st->fetchColumn();
}

if ($method === 'POST' && $action === 'aprobar_items') {
    // Superadmin siempre puede. Distribuidor solo si tiene el permiso
    // 'aprobar_pedidos' asignado — antes esto solo revisaba el rol, lo que
    // dejaba que CUALQUIER distribuidor aprobara aunque no se le hubiera
    // dado ese permiso desde Gestión de usuarios.
    rolOPermiso(['superadmin'], 'aprobar_pedidos');

    $data     = json_decode(file_get_contents('php://input'), true);
    $pedidoId = $data['pedido_id'] ?? '';
    $items    = $data['items']     ?? [];
    $nota     = trim($data['nota'] ?? '');

    if (!$pedidoId || empty($items)) {
        responder(['error' => 'Faltan datos'], 400);
    }

    $ped = $pdo->prepare("SELECT * FROM pedidos_agrupados WHERE id = ?");
    $ped->execute([$pedidoId]);
    $pedido = $ped->fetch();
    if (!$pedido) responder(['error' => 'Pedido no encontrado'], 404);

    $aprobados  = 0;
    $rechazados = 0;

    $pdo->beginTransaction();
    try {
        foreach ($items as $item) {
            $solId     = $item['id'];
            $cantAprob = intval($item['cantidad_aprobada'] ?? 0);
            $estado    = ($item['estado'] === 'rechazada' || $cantAprob <= 0) ? 'rechazada' : 'aprobada';

            // Validar stock antes de aprobar
            if ($estado === 'aprobada') {
                $solRef = $pdo->prepare("SELECT * FROM solicitudes WHERE id = ?");
                $solRef->execute([$solId]);
                $refRow = $solRef->fetch();
                if ($refRow) {
                    if (str_starts_with($refRow['ref'], 'ONT::')) {
                        $disp = _ontCantidadDisponible($pdo, $refRow['ref']);
                        if ($cantAprob > $disp) {
                            $pdo->rollBack();
                            responder(['error' => "Stock insuficiente para {$refRow['ref']}: solo hay {$disp} unidades disponibles"], 400);
                        }
                    } elseif ($refRow['ref'] === 'FIBRA') {
                        $disp = _fibraMetrosDisponibles($pdo, $refRow['categoria_fibra_id'] ?? null);
                        if ($disp >= 0 && $cantAprob > $disp) {
                            $pdo->rollBack();
                            responder(['error' => "Stock insuficiente de fibra: solo hay {$disp} m disponibles"], 400);
                        }
                    } else {
                        $stockRow = $pdo->prepare("SELECT stock_neiva FROM productos WHERE ref = ?");
                        $stockRow->execute([$refRow['ref']]);
                        $st = $stockRow->fetch();
                        if ($st && $cantAprob > (int)$st['stock_neiva']) {
                            $pdo->rollBack();
                            responder(['error' => "Stock insuficiente para {$refRow['ref']}: solo hay {$st['stock_neiva']} unidades disponibles"], 400);
                        }
                    }
                }
            }

            if ($estado === 'rechazada') {
                $pdo->prepare("UPDATE solicitudes SET estado='rechazada', cantidad_aprobada=0, fecha_respuesta=NOW() WHERE id=?")
                    ->execute([$solId]);
                _guardarMotivoRechazoItem($pdo, $solId, $nota);
                notificarRechazo($pdo, $solId, $nota !== '' ? $nota : 'Rechazado por el administrador en pedido agrupado');
                $rechazados++;
            } else {
                $sol = $pdo->prepare("SELECT * FROM solicitudes WHERE id = ?");
                $sol->execute([$solId]);
                $s = $sol->fetch();

                if (str_starts_with($s['ref'], 'ONT::')) {
                    $dispOnt = _ontCantidadDisponible($pdo, $s['ref']);
                    if ($dispOnt < $cantAprob) $cantAprob = $dispOnt;
                } elseif ($s['ref'] === 'FIBRA') {
                    $dispFibra = _fibraMetrosDisponibles($pdo, $s['categoria_fibra_id'] ?? null);
                    if ($dispFibra >= 0 && $dispFibra < $cantAprob) $cantAprob = (int)$dispFibra;
                } else {
                    $prod = $pdo->prepare("SELECT id, stock_neiva FROM productos WHERE ref = ?");
                    $prod->execute([$s['ref']]);
                    $p = $prod->fetch();

                    if (!$p || $p['stock_neiva'] < $cantAprob) {
                        $cantAprob = (int)($p['stock_neiva'] ?? 0);
                    }
                }

                if ($cantAprob > 0) {
                    $notaOrigItem = $s['nota'] ?? '';
                    $notaSeg = (strpos($notaOrigItem, '[STOCK:recuperado]') !== false) ? '[STOCK:recuperado]' : '';
                    if (preg_match('/Recoge en persona:\s*.+$/m', $notaOrigItem, $mAprobItem)) {
                        $notaSeg = trim(($notaSeg ? $notaSeg . "\n" : '') . $mAprobItem[0]);
                    }
                    if (preg_match('/Carrete elegido:\s*\d+/', $notaOrigItem, $mAprobCarrete)) {
                        $notaSeg = trim(($notaSeg ? $notaSeg . "\n" : '') . $mAprobCarrete[0]);
                    }
                    $pdo->prepare("
                        INSERT INTO envios_seguimiento
                          (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad,
                           origen, destino, enviado_por, estado, notas, fecha_aprobado)
                        VALUES ('solicitud', ?, ?, ?, ?, ?, 'Almacen Central', ?, ?, 'aprobado', ?, NOW())
                    ")->execute([
                        $solId, $s['ref'], $s['nombre'], $cantAprob,
                        $s['unidad_envio'] ?? 'unidad',
                        $s['destino'] ?: $pedido['municipio'], $_SESSION['usuario'], $notaSeg
                    ]);

                    $pdo->prepare("UPDATE solicitudes SET estado='aprobada', cantidad_aprobada=?, aprobado_por=?, fecha_respuesta=NOW() WHERE id=?")
                        ->execute([$cantAprob, $_SESSION['usuario'], $solId]);

                    $aprobados++;
                } else {
                    $pdo->prepare("UPDATE solicitudes SET estado='rechazada', cantidad_aprobada=0, fecha_respuesta=NOW() WHERE id=?")
                        ->execute([$solId]);
                    _guardarMotivoRechazoItem($pdo, $solId, $nota !== '' ? $nota : 'Sin stock disponible');
                    $rechazados++;
                }
            }
        }

        $nuevoEstado = ($aprobados > 0 && $rechazados > 0) ? 'parcial'
                     : ($aprobados > 0 ? 'aprobado' : 'rechazado');

        if ($nota !== '') {
            $etiquetaDecision = ($nuevoEstado === 'rechazado') ? 'Rechazó' : (($nuevoEstado === 'parcial') ? 'Aprobó parcialmente' : 'Aprobó');
            $sello = "[$etiquetaDecision · " . ($_SESSION['usuario'] ?? '') . '] ';
            try { $pdo->prepare("UPDATE pedidos_agrupados SET estado=?, aprobado_por=?, fecha_respuesta=NOW(), nota=TRIM(CONCAT(COALESCE(nota,''),'\n',?)) WHERE id=?")
                ->execute([$nuevoEstado, $_SESSION['usuario'] ?? '', $sello . $nota, $pedidoId]); }
            catch (\Throwable $e) {
                $pdo->prepare("UPDATE pedidos_agrupados SET estado=?, aprobado_por=?, fecha_respuesta=NOW() WHERE id=?")->execute([$nuevoEstado, $_SESSION['usuario'] ?? '', $pedidoId]);
            }
        } else {
            $pdo->prepare("UPDATE pedidos_agrupados SET estado=?, aprobado_por=?, fecha_respuesta=NOW() WHERE id=?")
                ->execute([$nuevoEstado, $_SESSION['usuario'] ?? '', $pedidoId]);
        }

        $pdo->commit();
        auditar($pdo, 'aprobar', 'solicitudes', "Pedido agrupado $pedidoId: $aprobados aprobados, $rechazados rechazados".($nota?" ($nota)":''), '');
    } catch (Exception $e) {
        $pdo->rollBack();
        responder(['error' => 'Error: ' . $e->getMessage()], 500);
    }

    require_once __DIR__ . '/ont_compromiso_lib.php';
    $avisos = [];
    foreach ($items as $it) {
        try {
            $q = $pdo->prepare("SELECT ref FROM solicitudes WHERE id = ? AND estado = 'aprobada'");
            $q->execute([$it['id'] ?? '']);
            $r = $q->fetchColumn();
            if ($r && stripos($r, 'ONT::') === 0 && !isset($avisos[$r])) {
                $av = ontAvisoCompromiso($pdo, $r);
                if ($av) $avisos[$r] = $av;
            }
        } catch (\Throwable $e) {}
    }
    responder(['ok' => true, 'aprobados' => $aprobados, 'rechazados' => $rechazados, 'aviso' => implode("\n", $avisos)]);
}

responder(['error' => 'Accion no reconocida'], 400);