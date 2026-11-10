<?php
error_reporting(E_ERROR);
ini_set('display_errors', 0);
/* ══════════════════════════════════════════════════════════
   seguimiento.php — Integrados S&S
   Maneja el seguimiento de envíos: aprobado → en camino → recibido
══════════════════════════════════════════════════════════ */
require 'config.php';
require_once 'auditoria.php';
require_once 'notificaciones.php';

// Asegurar que 'historial.solicitud_id' sea texto (las solicitudes usan IDs
// tipo "sol_..."), no número — si quedó como INT de una versión anterior,
// se corrige aquí para que el vínculo con la solicitud se guarde bien.
try {
    $colSid = $pdo->query("SHOW COLUMNS FROM historial LIKE 'solicitud_id'")->fetch();
    if ($colSid && stripos($colSid['Type'], 'int') === 0) {
        $pdo->exec("ALTER TABLE historial MODIFY solicitud_id VARCHAR(64) DEFAULT NULL");
    }
} catch (\Throwable $e) { error_log('[seguimiento/columna solicitud_id] '.$e->getMessage()); }
sesionRequerida();

$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

// Marcador de versión para verificar que el archivo subido es el correcto.
if ($action === 'version') {
    header('Content-Type: application/json');
    echo json_encode(['version' => 'equipo-real-recibido-v4', 'fecha' => '2026-09-28']);
    exit;
}

/* ══ LISTAR seguimientos (filtrado por sede/rol) ══ */
if ($method === 'GET' && $action === 'listar') {
    $rol  = $_SESSION['rol'];
    $sede = $_SESSION['sede'];

    $veTodo = ($rol === 'superadmin' || $rol === 'distribuidor');
    if (!$veTodo) {
        $permRawL = $pdo->prepare("SELECT permisos FROM usuarios WHERE id = ?");
        $permRawL->execute([$_SESSION['usuario_id'] ?? 0]);
        $permsL = json_decode($permRawL->fetchColumn() ?: '[]', true) ?: [];
        $veTodo = in_array('ver_envios', $permsL);
    }

    $solColsL = $pdo->query("SHOW COLUMNS FROM solicitudes")->fetchAll(PDO::FETCH_COLUMN);
    $colCatFibraL = in_array('categoria_fibra_id', $solColsL) ? ', sol.categoria_fibra_id' : ', NULL AS categoria_fibra_id';

    if ($veTodo) {
        $stmt = $pdo->query("SELECT es.*,
            sol.pedido_agrupado_id AS pedido_agrupado_id,
            COALESCE(sol.solicitado_por, pm.solicitado_por) AS solicitado_por,
            COALESCE(usol.rol, upm.rol) AS solicitante_rol$colCatFibraL
            FROM envios_seguimiento es
            LEFT JOIN solicitudes sol ON sol.id = es.referencia_id AND es.tipo = 'solicitud'
            LEFT JOIN usuarios usol ON usol.usuario = sol.solicitado_por
            LEFT JOIN pedidos_municipio pm ON pm.id = es.referencia_id AND es.tipo = 'pedido'
            LEFT JOIN usuarios upm ON upm.usuario = pm.solicitado_por
            ORDER BY es.fecha_aprobado DESC");
    } else {
        // Municipios ven los que van a su sede + los que salen de su sede (lo que ellos
        // mismos despacharon o devolvieron) + los que llevan como transportador
        // + los que ELLOS solicitaron (aunque su sede actual ya no coincida
        // con el destino guardado en el envío) + aquellos donde quedaron
        // elegidos como destinatario específico ("Recoge en persona: X").
        // Sin esto, a quien pidió el material nunca le aparecía el envío en
        // su lista si su sede no calzaba exacto con el destino, aunque el
        // sistema ya lo deje confirmar el recibido.
        $usuarioL = $_SESSION['usuario'] ?? '';
        $stmt = $pdo->prepare("SELECT es.*,
            sol.pedido_agrupado_id AS pedido_agrupado_id,
            COALESCE(sol.solicitado_por, pm.solicitado_por) AS solicitado_por,
            COALESCE(usol.rol, upm.rol) AS solicitante_rol$colCatFibraL
            FROM envios_seguimiento es
            LEFT JOIN solicitudes sol ON sol.id = es.referencia_id AND es.tipo = 'solicitud'
            LEFT JOIN usuarios usol ON usol.usuario = sol.solicitado_por
            LEFT JOIN pedidos_municipio pm ON pm.id = es.referencia_id AND es.tipo = 'pedido'
            LEFT JOIN usuarios upm ON upm.usuario = pm.solicitado_por
            WHERE es.transportador = ?
               OR sol.solicitado_por = ? OR pm.solicitado_por = ?
               OR es.enviado_por = ? OR es.recibido_por = ? OR es.entregado_a = ?
               OR es.notas LIKE CONCAT('%Recoge en persona:%', ?, '%')
               OR (? = 1 AND es.estado = 'aprobado' AND es.origen = ?)
               OR (? <> '' AND es.destino = ? AND sol.solicitado_por IS NULL AND pm.solicitado_por IS NULL
                   AND (es.notas IS NULL OR es.notas NOT LIKE '%Recoge en persona:%'))
            ORDER BY es.fecha_aprobado DESC");
        // Cada usuario ve SOLO lo suyo: lo que pidió, lo que transporta, lo que despachó,
        // lo que recibió/le entregaron y donde lo eligieron para "Recoge en persona".
        // Quien tiene el permiso "despachar" además ve lo aprobado que sale de su sede
        // (si no, no podría despachar). Ya no se ve "todo lo de la sede".
        $puedeDespacharL = (in_array('despachar', $permsL, true) && $sede) ? 1 : 0;
        $stmt->execute([$usuarioL, $usuarioL, $usuarioL, $usuarioL, $usuarioL, $usuarioL, $usuarioL, $puedeDespacharL, $sede, (string)$sede, (string)$sede]);
    }

    $rows = $stmt->fetchAll();
    if (!$veTodo) {
        // El LIKE de arriba es amplio ("ana" también calzaría con "juana"): se confirma
        // aquí que el nombre de la línea "Recoge en persona: X" sea EXACTAMENTE el usuario.
        $yoL = mb_strtolower(trim($usuarioL));
        $rows = array_values(array_filter($rows, function($r) use ($yoL, $usuarioL, $puedeDespacharL, $sede) {
            foreach (['transportador','solicitado_por','enviado_por','recibido_por','entregado_a'] as $c) {
                if (isset($r[$c]) && mb_strtolower(trim((string)$r[$c])) === $yoL) return true;
            }
            if ($puedeDespacharL && $r['estado'] === 'aprobado' && $r['origen'] === $sede) return true;
            // Envíos "de nadie" (ej. una OLT enviada directo a una oficina, sin solicitante ni
            // persona elegida): los ve la oficina destino; si no, nadie podría confirmar el recibido.
            if ($sede !== '' && $r['destino'] === $sede && empty($r['solicitado_por'])
                && strpos((string)($r['notas'] ?? ''), 'Recoge en persona:') === false) return true;
            if (preg_match('/Recoge en persona:\s*(.+)$/m', $r['notas'] ?? '', $m)
                && mb_strtolower(trim($m[1])) === $yoL) return true;
            return false;
        }));
    }
    $resultado = array_map(function($s) {
        return [
            'id'             => $s['id'],
            'ref_producto'   => $s['ref_producto'],
            'nombre_producto'=> $s['nombre_producto'],
            'cantidad'       => (int)$s['cantidad'],
            'unidad'         => $s['unidad'],
            'origen'         => $s['origen'],
            'destino'        => $s['destino'],
            'transportador'  => $s['transportador'] ?? '',
            'enviado_por'    => $s['enviado_por'] ?? '',
            'solicitado_por' => $s['solicitado_por'] ?? '',
            'solicitanteRol' => $s['solicitante_rol'] ?? '',
            'entregadoA'     => $s['entregado_a'] ?? '',
            'recibido_por'   => $s['recibido_por'] ?? '',
            'estado'         => $s['estado'],
            'notas'          => $s['notas'] ?? '',
            'referencia_id'  => $s['referencia_id'] ?? '',
            'pedidoAgrupadoId' => $s['pedido_agrupado_id'] ?? null,
            'categoriaFibraId' => $s['categoria_fibra_id'] ?? null,
            'tipo'           => $s['tipo'] ?? '',
            'fecha_aprobado' => $s['fecha_aprobado'],
            'fecha_envio'    => $s['fecha_envio'] ?? null,
            'fecha_entrega'  => $s['fecha_entrega'] ?? null,
            'fecha_recibido' => $s['fecha_recibido'] ?? null,
        ];
    }, $rows);
    responder($resultado);
}

/* ¿Puede esta sesión despachar/cancelar este envío aprobado?
   - Lo que sale del Almacén Central: como siempre (permiso "despachar").
   - Lo que sale de una oficina/sede o del stock de una persona (solicitudes, pedidos y
     asignaciones que NO salen del almacén): solo quien lo envió (o el dueño del stock de origen).
     El superadmin siempre puede (es la salida de emergencia).
   Así el almacén/distribuidor no despacha por error lo que una oficina le entrega a su técnico. */
function _puedeDespacharEnvio(array $s): bool {
    if (($_SESSION['rol'] ?? '') === 'superadmin') return true;
    if (!in_array($s['tipo'] ?? '', ['solicitud', 'pedido', 'asignacion'], true)) return true;
    $origen = trim((string)($s['origen'] ?? ''));
    if ($origen === '' || strcasecmp($origen, 'Almacen Central') === 0) return true;
    $u = $_SESSION['usuario'] ?? '';
    return $u !== '' && (($s['enviado_por'] ?? '') === $u || $origen === $u);
}

/* ══ MARCAR EN CAMINO ══ */
/* ── CREAR ENVÍO DIRECTO (admin/distribuidor) ── */
if ($method === 'POST' && $action === 'crear_envio_directo') {
    // Esta misma acción sirve tanto para "Despachar" un solo producto como
    // para "Envío múltiple" (varios a la vez) — antes solo aceptaba el
    // permiso "despachar", así que a quien solo le daban "Envío múltiple"
    // el botón le aparecía pero el servidor le rechazaba todo igual.
    rolOPermisoAlt(['superadmin'], ['despachar', 'enviar_multiple']);
    $data        = json_decode(file_get_contents('php://input'), true) ?? [];
    $ref         = trim($data['ref']         ?? '');
    $nombre      = trim($data['nombre']      ?? '');
    $destino     = trim($data['destino']     ?? '');
    $cantidad    = intval($data['cantidad']  ?? 0);
    $unidad      = trim($data['unidad_envio']?? 'unidad');
    $notas      = trim($data['notas']      ?? '');
    $productoId = intval($data['producto_id'] ?? 0);
    $destinatarioEspecifico = trim($data['destinatario_especifico'] ?? '');
    $origenStock = trim($data['origen_stock'] ?? 'nuevo'); // 'nuevo' | 'recuperado'
    $ontIdsElegidos = is_array($data['ont_ids'] ?? null) ? array_values(array_filter(array_map('intval', $data['ont_ids']))) : [];

    if (!$ref || !$destino || $cantidad < 1) responder(['error' => 'Datos incompletos'], 400);

    // Si se eligió un destinatario específico (ej: "es para Luisfer"), se
    // guarda en las notas — así, al despachar, el sistema ya sabe sugerir
    // a esa persona en "Recoge en persona" en vez de dejarlo vacío.
    if ($destinatarioEspecifico) {
        $notas = trim($notas . "\nRecoge en persona: " . $destinatarioEspecifico);
    }

    // Si eligieron ONTs específicas (solo si es ese tipo de producto), se
    // validan y se guarda su SN en las notas — así, al despacharlo después
    // desde Seguimiento, el sistema ya sabe cuáles usar sin preguntar de nuevo.
    $esOntDirecto = str_starts_with($ref, 'ONT::');
    if ($esOntDirecto && $ontIdsElegidos) {
        if (count($ontIdsElegidos) !== $cantidad) {
            responder(['error' => "Elegiste " . count($ontIdsElegidos) . " ONT(s), pero la cantidad es $cantidad"], 400);
        }
        $ph = implode(',', array_fill(0, count($ontIdsElegidos), '?'));
        $chkOnts = $pdo->prepare("SELECT sn FROM ont_seriales WHERE id IN ($ph) AND estado='disponible' AND tecnico_asignado IS NULL");
        $chkOnts->execute($ontIdsElegidos);
        $snsElegidos = $chkOnts->fetchAll(PDO::FETCH_COLUMN);
        if (count($snsElegidos) !== $cantidad) {
            responder(['error' => 'Una o más ONTs elegidas ya no están disponibles. Vuelve a intentar.'], 400);
        }
        $notas = trim($notas . "\nSeriales preseleccionados: " . implode(', ', $snsElegidos));
    }
    if ($origenStock === 'recuperado') {
        // Marca interna (no se muestra como comentario): el stock se descuenta
        // al DESPACHAR, de la bolsa "recuperado", y la etiqueta ♻️ sale en
        // Seguimiento, el historial y el PDF.
        $notas = trim($notas . "\n[STOCK:recuperado]");
    }

    // Si se eligió un rollo específico del almacén (ej: "de este rollo en
    // particular, no de otro"), se valida que exista y le alcance, y
    // queda anotado — así, al confirmarse recibido, se transfiere ESE
    // rollo exacto (con su historial) en vez de crear uno genérico nuevo.
    $rolloIdElegido = intval($data['rollo_id'] ?? 0);
    if ($rolloIdElegido) {
        $chkRollo = $pdo->prepare("SELECT (metros - metros_usados) AS disp FROM producto_rollos WHERE id = ? AND sede_nombre = 'Almacen Central' AND usuario_actual IS NULL");
        $chkRollo->execute([$rolloIdElegido]);
        $dispRollo = $chkRollo->fetchColumn();
        if ($dispRollo === false) responder(['error' => 'Ese rollo ya no está disponible en el almacén'], 400);
        if ($cantidad > (float)$dispRollo) responder(['error' => "Ese rollo solo tiene {$dispRollo} disponibles"], 400);
        $notas = trim($notas . "\nRollo elegido: " . $rolloIdElegido);
    }

    $pdo->beginTransaction();
    try {
        // El id de "solicitudes" es texto generado a mano (no autoincremental) — igual que el resto del sistema.
        $solicitudId = uniqid('sol_', true);

        // 1) Crear solicitud aprobada — el "solicitante" registrado es
        // siempre quien crea el envío (admin), nunca se sustituye por el
        // destinatario elegido — eso mezclaba mal a "quien transporta"
        // con "quien realmente recibe", que pueden ser personas distintas
        // aunque compartan oficina (ej: Luisfer entrega, Jhon confirma).
        $pdo->prepare("
            INSERT INTO solicitudes (id, ref, nombre, destino, cantidad, cantidad_aprobada, unidad_envio, solicitado_por, aprobado_por, estado, fecha, fecha_respuesta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'aprobada', NOW(), NOW())
        ")->execute([$solicitudId, $ref, $nombre, $destino, $cantidad, $cantidad, $unidad, $_SESSION['usuario'], $_SESSION['usuario']]);

        // 2) Crear seguimiento aprobado (sin transportador — se asigna al despachar)
        $pdo->prepare("
            INSERT INTO envios_seguimiento
              (referencia_id, tipo, ref_producto, nombre_producto, origen, destino, cantidad, unidad,
               enviado_por, estado, notas, fecha_aprobado)
            VALUES (?, 'solicitud', ?, ?, 'Almacen Central', ?, ?, ?, ?, 'aprobado', ?, NOW())
        ")->execute([$solicitudId, $ref, $nombre, $destino, $cantidad, $unidad,
                     $_SESSION['usuario'], $notas]);

        // 3) El stock del almacén NO se descuenta aquí: se descuenta una sola vez
        // al despachar (así no se resta doble) y se devuelve si se cancela.

        $pdo->commit();
        auditar($pdo, 'envio_directo', 'seguimiento', "Envío directo: $nombre → $destino ($cantidad $unidad)", $ref);
        responder(['ok' => true, 'solicitud_id' => $solicitudId]);
    } catch (\Throwable $e) {
        $pdo->rollBack();
        error_log('[crear_envio_directo] ' . $e->getMessage());
        responder(['error' => 'Error al crear envío: ' . $e->getMessage()], 500);
    }
}

/* Selecciona hasta $cant ONTs disponibles (tabla ont_seriales) que coincidan
   con el modelo del ref "ONT::<modelo>" (match exacto, parcial, o respaldo a
   todas las disponibles — mismo criterio que cajas.php). Devuelve las filas
   (id, mac, sn) sin modificarlas todavía. */
function _ontSeleccionarDisponibles(PDO $pdo, string $refOnt, int $cant): array {
    $modelo = trim(str_ireplace('ONT::', '', $refOnt));
    $rows = [];
    if ($modelo !== '') {
        $like = '%' . $modelo . '%';
        $st = $pdo->prepare("SELECT id, mac, sn FROM ont_seriales
            WHERE estado='disponible' AND tecnico_asignado IS NULL
              AND (
                LOWER(TRIM(COALESCE(modelo,''))) = LOWER(?)
                OR LOWER(COALESCE(modelo,'')) LIKE LOWER(?)
                OR LOWER(?) LIKE CONCAT('%', LOWER(TRIM(COALESCE(modelo,''))), '%')
              )
            ORDER BY caja_id, id LIMIT $cant");
        $st->execute([$modelo, $like, $modelo]);
        $rows = $st->fetchAll(PDO::FETCH_ASSOC);
    }
    if (!$rows) {
        $st2 = $pdo->prepare("SELECT id, mac, sn FROM ont_seriales WHERE estado='disponible' AND tecnico_asignado IS NULL ORDER BY caja_id, id LIMIT $cant");
        $st2->execute();
        $rows = $st2->fetchAll(PDO::FETCH_ASSOC);
    }
    return $rows;
}

if ($method === 'POST' && $action === 'en_camino') {
    rolOPermiso(['superadmin'], 'despachar');
    $data          = json_decode(file_get_contents('php://input'), true);
    $id            = intval($data['id'] ?? 0);
    $transportador = trim($data['transportador'] ?? '');
    $notas         = trim($data['notas'] ?? '');
    $ontIdsManual  = is_array($data['ont_ids'] ?? null) ? array_values(array_filter(array_map('intval', $data['ont_ids']))) : [];
    $carreteAlloc  = is_array($data['carrete_alloc'] ?? null) ? $data['carrete_alloc'] : [];
    $equipoIdsManual = is_array($data['equipo_ids'] ?? null) ? array_values(array_filter(array_map('intval', $data['equipo_ids']))) : [];
    $rolloIdsManual  = is_array($data['rollo_ids'] ?? null) ? array_values(array_unique(array_filter(array_map('intval', $data['rollo_ids'])))) : [];

    if (!$id) responder(['error' => 'ID requerido'], 400);
    if (!$transportador) responder(['error' => 'Indica quién llevará el envío'], 400);

    // Obtener seguimiento
    $seg = $pdo->prepare("SELECT * FROM envios_seguimiento WHERE id = ?");
    $seg->execute([$id]);
    $s = $seg->fetch();
    if (!$s) responder(['error' => 'Seguimiento no encontrado'], 404);
    if (!_puedeDespacharEnvio($s)) responder(['error' => 'Este envío sale de una oficina o de otra persona: solo quien lo envió puede despacharlo'], 403);
    // Permitir re-despacho si estaba en_camino (por cancelacion previa mal resuelta)
    $yaEnCamino = ($s['estado'] === 'en_camino');
    $origenStockDesp = trim($data['origen_stock'] ?? ''); // 'nuevo' | 'recuperado' | '' (lo que traiga el envío)
    $esRecup = false;
    $estadosValidos = ['aprobado', 'pendiente', 'en_camino'];
    if (!in_array($s['estado'], $estadosValidos)) {
        $estadoActual = $s['estado'];
        responder(['error' => "No se puede despachar: estado '{$estadoActual}'"], 400);
    }

    // Elegir manualmente ONT/carrete específico exige el permiso
    // "elegir_material_despacho" — superadmin siempre puede.
    if (($ontIdsManual || $carreteAlloc || $equipoIdsManual || $rolloIdsManual) && ($_SESSION['rol'] ?? '') !== 'superadmin') {
        $permRaw = $pdo->prepare("SELECT permisos FROM usuarios WHERE id = ?");
        $permRaw->execute([$_SESSION['usuario_id'] ?? 0]);
        $perms = json_decode($permRaw->fetchColumn() ?: '[]', true) ?: [];
        if (!in_array('elegir_material_despacho', $perms)) {
            responder(['error' => 'No tienes permiso para elegir manualmente de qué carrete/ONT despachar'], 403);
        }
    }

    $cant    = (int)$s['cantidad'];
    $esFibraDirecta   = ($s['ref_producto'] === 'FIBRA' && $s['tipo'] === 'fibra');     // enviar_metros ya la descontó al crearse
    $esFibraSolicitud = ($s['ref_producto'] === 'FIBRA' && $s['tipo'] === 'solicitud'); // viene de un pedido, aún no se tomó de ningún carrete
    $esCarreteCompletoEnCamino = ($s['tipo'] === 'fibra_carrete'); // ya se marcó en_transito al crearse
    $esEquipo = ($s['tipo'] === 'olt' || $s['tipo'] === 'mikrotik');
    $esOnt   = str_starts_with($s['ref_producto'] ?? '', 'ONT::');
    // Solicitud de "Pedir equipos" (OLT/Mikrotik pedido por un técnico,
    // ref "EQUIPO::tipo") — tampoco vive en la tabla productos, así que
    // sin esto el despacho fallaba con "Producto no encontrado". Aquí, al
    // despachar, el admin elige la(s) unidad(es) real(es) específica(s) de
    // OLT/Mikrotik (tabla olts/mikrotiks) que se envían — igual que se
    // eligen ONTs específicas — y esa elección queda anotada ("EquipoIDs:
    // tabla:id1,id2") para que al confirmarse "recibido" esa(s) unidad(es)
    // física(s) se muevan de verdad a la sede destino.
    $esEquipoSolicitud = str_starts_with($s['ref_producto'] ?? '', 'EQUIPO::');
    $sinStock = ($esFibraDirecta || $esCarreteCompletoEnCamino || $esEquipo || $esOnt || $esEquipoSolicitud); // estos no descuentan de productos/stock_sedes
    if ($cant < 1) responder(['error' => 'Cantidad inválida en el seguimiento'], 400);

    // ── Validaciones de stock ANTES de la transacción ──────────────
    $ontsAReservar = [];
    $fibraAlloc = [];
    $equiposAReservar = [];
    $equipoTabla = null;
    if ($esEquipoSolicitud && !$yaEnCamino) {
        $tipoEq = trim(str_ireplace('EQUIPO::', '', $s['ref_producto'] ?? ''));
        $equipoTabla = (strtoupper($tipoEq) === 'OLT') ? 'olts' : 'mikrotiks';
        if (!$equipoIdsManual) {
            responder(['error' => 'Selecciona qué unidad(es) específica(s) de '.$tipoEq.' se despachan para este pedido'], 400);
        }
        if (count($equipoIdsManual) !== $cant) {
            responder(['error' => "Debes seleccionar exactamente $cant equipo(s)"], 400);
        }
        $ph = implode(',', array_fill(0, count($equipoIdsManual), '?'));
        $paramsEq = $equipoIdsManual;
        $colTipoEq = '';
        if ($equipoTabla === 'mikrotiks') { $colTipoEq = " AND tipo_equipo = ?"; $paramsEq[] = $tipoEq; }
        $stChkEq = $pdo->prepare("SELECT * FROM $equipoTabla WHERE id IN ($ph) AND estado IN ('activo','disponible','recuperado')$colTipoEq");
        $stChkEq->execute($paramsEq);
        $equiposAReservar = $stChkEq->fetchAll(PDO::FETCH_ASSOC);
        if (count($equiposAReservar) !== count($equipoIdsManual)) {
            responder(['error' => 'Una o más unidades elegidas ya no están disponibles. Vuelve a seleccionar.'], 400);
        }
        // Verificar que ninguna ya esté reservada en otro envío activo (directo
        // o vía otra solicitud "Pedir equipos" que ya la haya elegido)
        $reservadosChk = [];
        $tipoColEq = $equipoTabla === 'olts' ? 'olt' : 'mikrotik';
        $stD = $pdo->prepare("SELECT referencia_id FROM envios_seguimiento WHERE tipo = ? AND estado IN ('aprobado','en_camino','entregado')");
        $stD->execute([$tipoColEq]);
        foreach ($stD->fetchAll(PDO::FETCH_COLUMN) as $rid) $reservadosChk[(int)$rid] = true;
        $stN = $pdo->prepare("SELECT notas FROM envios_seguimiento WHERE estado IN ('aprobado','en_camino','entregado') AND notas LIKE '%EquipoIDs:%' AND id <> ?");
        $stN->execute([$id]);
        foreach ($stN->fetchAll(PDO::FETCH_COLUMN) as $notasChk) {
            if (preg_match('/EquipoIDs:\s*([a-z]+):([0-9,]+)/', $notasChk, $mChk) && $mChk[1] === $equipoTabla) {
                foreach (explode(',', $mChk[2]) as $ridChk) $reservadosChk[(int)$ridChk] = true;
            }
        }
        foreach ($equiposAReservar as $eq) {
            if (!empty($reservadosChk[(int)$eq['id']])) {
                responder(['error' => 'Una de las unidades elegidas ya está reservada en otro envío. Vuelve a seleccionar.'], 400);
            }
        }
    }
    if ($esOnt) {
        if (!$yaEnCamino) {
            if ($ontIdsManual) {
                if (count($ontIdsManual) !== $cant) {
                    responder(['error' => "Debes seleccionar exactamente $cant ONT(s)"], 400);
                }
                $ph = implode(',', array_fill(0, count($ontIdsManual), '?'));
                $stChk = $pdo->prepare("SELECT id, mac, sn FROM ont_seriales WHERE id IN ($ph) AND estado='disponible' AND tecnico_asignado IS NULL");
                $stChk->execute($ontIdsManual);
                $ontsAReservar = $stChk->fetchAll(PDO::FETCH_ASSOC);
                if (count($ontsAReservar) !== $cant) {
                    responder(['error' => 'Una o más ONTs seleccionadas ya no están disponibles. Vuelve a seleccionar.'], 400);
                }
            } elseif (preg_match('/Seriales preseleccionados:\s*(.+)$/m', $s['notas'] ?? '', $mPre)) {
                // Ya se habían elegido desde "Productos en stock" al crear el
                // envío directo — se usan esas mismas, sin volver a preguntar.
                $snsPre = array_values(array_filter(array_map('trim', explode(',', $mPre[1]))));
                if ($snsPre) {
                    $ph = implode(',', array_fill(0, count($snsPre), '?'));
                    $stChk = $pdo->prepare("SELECT id, mac, sn FROM ont_seriales WHERE sn IN ($ph) AND estado='disponible' AND tecnico_asignado IS NULL");
                    $stChk->execute($snsPre);
                    $ontsAReservar = $stChk->fetchAll(PDO::FETCH_ASSOC);
                }
                if (count($ontsAReservar) < $cant) {
                    // Si alguna ya no está disponible (raro, pero puede pasar),
                    // se completa automáticamente con otras disponibles.
                    $yaElegidas = array_column($ontsAReservar, 'id');
                    $faltan = $cant - count($ontsAReservar);
                    $extra = _ontSeleccionarDisponibles($pdo, $s['ref_producto'], $faltan);
                    foreach ($extra as $e) { if (!in_array($e['id'], $yaElegidas)) $ontsAReservar[] = $e; }
                    if (count($ontsAReservar) < $cant) {
                        responder(['error' => "Stock insuficiente de ONT: solo hay " . count($ontsAReservar) . " disponibles"], 400);
                    }
                }
            } else {
                $ontsAReservar = _ontSeleccionarDisponibles($pdo, $s['ref_producto'], $cant);
                if (count($ontsAReservar) < $cant) {
                    responder(['error' => "Stock insuficiente de ONT: solo hay " . count($ontsAReservar) . " disponibles"], 400);
                }
            }
        }
    } elseif ($esFibraSolicitud) {
        if (!$yaEnCamino) {
            // Si quien solicitó ya había elegido un carrete específico
            // ("Carrete elegido: X" en la nota) y quien despacha no
            // especificó manualmente de cuáles sacar, se usa ESE carrete
            // completo automáticamente — ahorra tener que repetir la
            // elección que el solicitante ya había hecho.
            if (!$carreteAlloc && preg_match('/Carrete elegido:\s*(\d+)/', $s['notas'] ?? '', $mCarreteSol)) {
                $carreteAlloc = [['carrete_id' => (int)$mCarreteSol[1], 'metros' => $cant]];
            }
            $sumaAlloc  = 0;
            foreach ($carreteAlloc as $a) {
                $cId = intval($a['carrete_id'] ?? 0);
                $m   = floatval($a['metros'] ?? 0);
                if ($cId && $m > 0) { $fibraAlloc[] = ['carrete_id' => $cId, 'metros' => $m]; $sumaAlloc += $m; }
            }
            if (!$fibraAlloc) {
                responder(['error' => 'Selecciona de qué carrete(s) sale la fibra y cuántos metros de cada uno'], 400);
            }
            if (round($sumaAlloc) != $cant) {
                responder(['error' => "Los metros asignados ($sumaAlloc) no coinciden con la cantidad del pedido ($cant m)"], 400);
            }
            foreach ($fibraAlloc as $a) {
                $cR = $pdo->prepare("SELECT metros, metros_usados, codigo FROM fibra_carretes WHERE id = ?");
                $cR->execute([$a['carrete_id']]);
                $cRow = $cR->fetch();
                if (!$cRow) responder(['error' => "Carrete #{$a['carrete_id']} no encontrado"], 404);
                $disp = floatval($cRow['metros']) - floatval($cRow['metros_usados']);
                if ($a['metros'] > $disp) {
                    responder(['error' => "El carrete {$cRow['codigo']} solo tiene $disp m disponibles"], 400);
                }
            }
        }
    } elseif (!$sinStock) {
        $prod = $pdo->prepare("SELECT id, stock_neiva, stock_recuperado FROM productos WHERE ref = ?");
        $prod->execute([$s['ref_producto']]);
        $p = $prod->fetch();
        if (!$p) responder(['error' => 'Producto no encontrado: '.$s['ref_producto']], 404);

        if (empty($s['origen']) || $s['origen'] === 'Almacen Central') {
            // De qué bolsa sale: la que ya traía el envío (marca interna) o la
            // que el admin escogió al despachar ("Nuevo" / "♻️ Recuperado").
            $esRecup = ($origenStockDesp === 'recuperado')
                || ($origenStockDesp !== 'nuevo' && strpos($s['notas'] ?? '', '[STOCK:recuperado]') !== false);
            $stockPool = $esRecup ? (float)($p['stock_recuperado'] ?? 0) : (float)$p['stock_neiva'];
            if ($stockPool < $cant) responder(['error' => $esRecup ? 'Stock recuperado insuficiente en el almacén central' : 'Stock insuficiente en el almacén central'], 400);
        } else {
            // El origen ahora es el nombre de usuario dueño del stock personal
            // (ya no una sede) — se valida contra stock_usuarios.
            $stockOrigenUsuario = stockUsuarioObtener($pdo, $p['id'], $s['origen']);
            if ($stockOrigenUsuario < $cant) {
                responder(['error' => 'Stock insuficiente en el inventario personal de ' . $s['origen']], 400);
            }
        }
    }

    // ── Transacción: descontar stock + actualizar estados ────────
    $pdo->beginTransaction();
    try {
        if ($esOnt && !$yaEnCamino) {
            // Re-verificar dentro de la transacción (por si otro proceso ya las tomó)
            // y marcar las ONTs específicas como despachadas — igual que cajas.php::enviar_onts_lote.
            if ($ontIdsManual) {
                $ph = implode(',', array_fill(0, count($ontIdsManual), '?'));
                $stChk = $pdo->prepare("SELECT id, mac, sn FROM ont_seriales WHERE id IN ($ph) AND estado='disponible' AND tecnico_asignado IS NULL");
                $stChk->execute($ontIdsManual);
                $ontsAReservar = $stChk->fetchAll(PDO::FETCH_ASSOC);
            } else {
                $ontsAReservar = _ontSeleccionarDisponibles($pdo, $s['ref_producto'], $cant);
            }
            if (count($ontsAReservar) < $cant) {
                $pdo->rollBack();
                responder(['error' => "Stock insuficiente de ONT: solo hay " . count($ontsAReservar) . " disponibles"], 400);
            }
            // Se asigna DIRECTO a la persona que la pidió (ya no queda "de la
            // sede" a la espera de que alguien la reparta a mano).
            // OJO: en un "Enviar directo", quien queda como "solicitado_por"
            // es siempre quien CREÓ el envío (admin/distribuidor) — nunca el
            // destinatario elegido, a propósito, para no mezclar roles. Por
            // eso, si el solicitante resulta ser admin/distribuidor, se usa
            // en su lugar el destinatario específico guardado en las notas
            // ("Recoge en persona: X"), que es quien de verdad la recibe.
            // Hay 2 flujos posibles con tablas distintas: 'solicitud' (tabla
            // solicitudes) y 'pedido' (tabla pedidos_municipio, el flujo
            // clásico de "Pedidos de municipio").
            $ontUsuarioDestino = null;
            $ontSolicitante = null;
            $ontSolicitanteRol = null;
            if (($s['tipo'] ?? '') === 'solicitud' && !empty($s['referencia_id'])) {
                $qOnt = $pdo->prepare("SELECT sol.solicitado_por, u.rol AS solicitante_rol FROM solicitudes sol LEFT JOIN usuarios u ON u.usuario = sol.solicitado_por WHERE sol.id = ?");
                $qOnt->execute([$s['referencia_id']]);
                $ontSolRow = $qOnt->fetch();
                $ontSolicitante = $ontSolRow['solicitado_por'] ?? null;
                $ontSolicitanteRol = $ontSolRow['solicitante_rol'] ?? null;
            } elseif (($s['tipo'] ?? '') === 'pedido' && !empty($s['referencia_id'])) {
                $qOnt = $pdo->prepare("SELECT pm.solicitado_por, u.rol AS solicitante_rol FROM pedidos_municipio pm LEFT JOIN usuarios u ON u.usuario = pm.solicitado_por WHERE pm.id = ?");
                $qOnt->execute([$s['referencia_id']]);
                $ontSolRow = $qOnt->fetch();
                $ontSolicitante = $ontSolRow['solicitado_por'] ?? null;
                $ontSolicitanteRol = $ontSolRow['solicitante_rol'] ?? null;
            }
            if ($ontSolicitante) {
                if (in_array($ontSolicitanteRol, ['superadmin', 'distribuidor'])) {
                    if (preg_match('/Recoge en persona:\s*(.+)$/m', $s['notas'] ?? '', $mOnt)) {
                        $ontUsuarioDestino = trim($mOnt[1]);
                    } elseif (!empty($transportador) && !str_starts_with($transportador, 'EXT:')) {
                        // No se eligió destinatario al CREAR el envío, pero sí
                        // se eligió a alguien real como "recoge en persona" al
                        // DESPACHAR (no es transporte externo) — es la persona
                        // que de verdad se lleva la ONT, se usa como destino.
                        $qTransp = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?");
                        $qTransp->execute([$transportador]);
                        $rolTransp = $qTransp->fetchColumn();
                        if ($rolTransp && !in_array($rolTransp, ['superadmin', 'distribuidor'])) {
                            $ontUsuarioDestino = $transportador;
                        }
                    }
                } else {
                    $ontUsuarioDestino = $ontSolicitante;
                }
            }
            // OJO: aquí solo se despacha (la ONT queda "en camino"). El dueño
            // (tecnico_asignado) YA NO se fija en este paso — se guarda quién
            // debería quedárselo ($ontUsuarioDestino, más abajo en las notas
            // como "Destinatario ONT: X") y la asignación real ocurre recién
            // cuando se confirma "recibido", para que el material solo cuente
            // como del destinatario cuando él de verdad confirmó que llegó,
            // no desde que se despacha ni desde que el transportador entrega.
            foreach ($ontsAReservar as $ontRow) {
                $colsOnt  = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
                $setParts = ["estado='despachada'"]; $setParams = [];
                if (in_array('enviado_a', $colsOnt))   { $setParts[] = "enviado_a=?";   $setParams[] = $s['destino']; }
                if (in_array('enviado_por', $colsOnt)) { $setParts[] = "enviado_por=?"; $setParams[] = $_SESSION['usuario'] ?? ''; }
                if (in_array('fecha_envio', $colsOnt)) { $setParts[] = "fecha_envio=NOW()"; }
                if (in_array('sede_actual', $colsOnt)) { $setParts[] = "sede_actual=?"; $setParams[] = $s['destino']; }
                $setParams[] = $ontRow['id'];
                $pdo->prepare("UPDATE ont_seriales SET " . implode(', ', $setParts) . " WHERE id=?")->execute($setParams);
            }
        }
        if ($esFibraSolicitud && !$yaEnCamino) {
            // Re-verificar disponibilidad dentro de la transacción y descontar cada carrete elegido.
            $sumaReal = 0;
            foreach ($fibraAlloc as $a) {
                $cR = $pdo->prepare("SELECT metros, metros_usados, codigo FROM fibra_carretes WHERE id = ? FOR UPDATE");
                $cR->execute([$a['carrete_id']]);
                $cRow = $cR->fetch();
                $disp = $cRow ? (floatval($cRow['metros']) - floatval($cRow['metros_usados'])) : 0;
                if (!$cRow || $a['metros'] > $disp) {
                    $pdo->rollBack();
                    $cod = $cRow['codigo'] ?? $a['carrete_id'];
                    responder(['error' => "El carrete $cod ya no tiene suficientes metros disponibles. Vuelve a seleccionar."], 400);
                }
                $sumaReal += $a['metros'];
            }
            foreach ($fibraAlloc as $a) {
                $pdo->prepare("UPDATE fibra_carretes SET metros_usados = metros_usados + ?,
                        estado = IF(metros - metros_usados - ? <= 0, 'agotado', 'disponible')
                    WHERE id = ?")
                    ->execute([$a['metros'], $a['metros'], $a['carrete_id']]);
            }
        }
        // Rollos elegidos A MANO al despachar (ej. entregar un rollo ya empezado en vez de uno
        // completo). Deben ser del almacén central, libres y del mismo producto, y la cantidad
        // de rollos debe ser la pedida. Lo que sale es lo que de verdad tienen esos rollos: la
        // cantidad del envío se ajusta a esos metros (así el stock y el destino cuadran).
        if ($rolloIdsManual && !$sinStock && !$yaEnCamino && !$esRecup && isset($p['id']) && ($s['origen'] ?? '') === 'Almacen Central') {
            $mpR = $pdo->prepare("SELECT metros_por_unidad FROM productos WHERE id = ?");
            $mpR->execute([$p['id']]);
            $mpU = (float)$mpR->fetchColumn();
            if ($mpU > 0) {
                $numPed = (int)round($cant / $mpU);
                if ($numPed < 1 || abs($cant - $numPed * $mpU) > 0.01) {
                    $pdo->rollBack();
                    responder(['error' => 'Este pedido es por metros sueltos, no por rollos: no se pueden elegir rollos.'], 400);
                }
                if (count($rolloIdsManual) !== $numPed) {
                    $pdo->rollBack();
                    responder(['error' => "Debes elegir exactamente $numPed rollo(s) para este pedido."], 400);
                }
                $phRM = implode(',', array_fill(0, count($rolloIdsManual), '?'));
                $qRM = $pdo->prepare("SELECT id, (metros - metros_usados) AS disp FROM producto_rollos
                    WHERE id IN ($phRM) AND producto_id = ? AND sede_nombre = 'Almacen Central'
                      AND usuario_actual IS NULL AND estado = 'disponible' AND (metros - metros_usados) > 0 FOR UPDATE");
                $qRM->execute(array_merge($rolloIdsManual, [$p['id']]));
                $rowsRM = $qRM->fetchAll();
                if (count($rowsRM) !== count($rolloIdsManual)) {
                    $pdo->rollBack();
                    responder(['error' => 'Uno o más rollos elegidos ya no están disponibles. Vuelve a elegir.'], 400);
                }
                $sumaRM = 0.0;
                foreach ($rowsRM as $rr) $sumaRM += (float)$rr['disp'];
                $nuevaCant = (int)round($sumaRM);
                if ($nuevaCant < 1) {
                    $pdo->rollBack();
                    responder(['error' => 'Los rollos elegidos no tienen metros disponibles.'], 400);
                }
                $pdo->prepare("UPDATE producto_rollos SET estado = 'en_transito' WHERE id IN ($phRM)")->execute($rolloIdsManual);
                $notas = trim($notas . "\nRollos elegidos: " . implode(',', $rolloIdsManual));
                if ($nuevaCant !== $cant) {
                    $notas = trim($notas . "\nAjuste de cantidad: el pedido era de $cant m y se entregan $nuevaCant m (rollo(s) elegido(s) a mano).");
                    $pdo->prepare("UPDATE envios_seguimiento SET cantidad = ? WHERE id = ?")->execute([$nuevaCant, $id]);
                    $cant = $nuevaCant;
                    $s['cantidad'] = $nuevaCant;
                }
            }
        }
        // Solo descontar stock si NO estaba ya en_camino (evitar doble descuento)
        if (!$sinStock && !$esFibraSolicitud && !$yaEnCamino) {
            if ($s['origen'] === 'Almacen Central') {
                $colStockDesp = $esRecup ? 'stock_recuperado' : 'stock_neiva';
                if ($colStockDesp === 'stock_neiva') {
                    $stockAntesBajoD = (float)($p['stock_neiva'] ?? 0);
                    $notificarBajoDespues = (int)$p['id'];
                }
                $pdo->prepare("UPDATE productos SET $colStockDesp = GREATEST(0, $colStockDesp - ?) WHERE id = ?")
                    ->execute([$cant, $p['id']]);
            } else {
                stockUsuarioAjustar($pdo, $p['id'], $s['origen'], -$cant);
            }
        }

        // Actualizar seguimiento — preservar historial de cancelaciones
        $notasAnt = $s['notas'] ?? '';
        $notasFin = $notas;
        // El destinatario específico ("Recoge en persona: X") se elige al
        // CREAR el envío, no al despachar — este paso no debe borrarlo. Si
        // las notas nuevas (del formulario de despacho) no lo repiten, se
        // conserva el de las notas originales.
        if (preg_match('/Recoge en persona:\s*.+$/m', $notasAnt, $mPreservar)
            && !preg_match('/Recoge en persona:/', $notasFin)) {
            $notasFin = trim(($notasFin ? $notasFin . "\n" : '') . $mPreservar[0]);
        }
        // Mismo criterio para el carrete elegido al pedir fibra: se decide
        // al crear la solicitud, el despacho no debe perderlo.
        if (preg_match('/Carrete elegido:\s*\d+/', $notasAnt, $mPreservarCarrete)
            && !preg_match('/Carrete elegido:/', $notasFin)) {
            $notasFin = trim(($notasFin ? $notasFin . "\n" : '') . $mPreservarCarrete[0]);
        }
        // Producto "por rollo" que sale del almacén central: los rollos
        // físicos que se van deben SALIR del almacén AHORA (quedan
        // "en_transito"), igual que ya baja stock_neiva — si no, el stock por
        // rollos de "Productos" seguía mostrando el rollo hasta que lo
        // recibían. Si no se eligió un rollo a mano, se toman los rollos
        // completos más antiguos que no se han tocado.
        if (!$sinStock && !$yaEnCamino && isset($p['id']) && ($s['origen'] ?? '') === 'Almacen Central'
            && !$esRecup) {
            try {
                $pmr = $pdo->prepare("SELECT metros_por_unidad FROM productos WHERE id = ?");
                $pmr->execute([$p['id']]);
                $mpr = (float)$pmr->fetchColumn();
                if ($mpr > 0 && !preg_match('/Rollos elegidos:/', $notasFin)) {
                    $idsRollosSalen = [];
                    if (preg_match('/Rollo elegido:\s*(\d+)/', ($notasAnt . "\n" . $notasFin), $mRE)) {
                        $idsRollosSalen = [(int)$mRE[1]];
                    } else {
                        $numR = (int)round($cant / $mpr);
                        if ($numR >= 1 && abs($cant - $numR * $mpr) < 0.01) {
                            $qR = $pdo->prepare("SELECT id FROM producto_rollos WHERE producto_id = ? AND sede_nombre = 'Almacen Central' AND usuario_actual IS NULL AND estado = 'disponible' AND metros_usados = 0 ORDER BY fecha ASC, id ASC LIMIT " . (int)$numR);
                            $qR->execute([$p['id']]);
                            $idsRollosSalen = array_map('intval', $qR->fetchAll(\PDO::FETCH_COLUMN));
                        }
                    }
                    if ($idsRollosSalen) {
                        $phS = implode(',', array_fill(0, count($idsRollosSalen), '?'));
                        $pdo->prepare("UPDATE producto_rollos SET estado = 'en_transito' WHERE id IN ($phS) AND sede_nombre = 'Almacen Central' AND usuario_actual IS NULL AND estado = 'disponible'")->execute($idsRollosSalen);
                        $notasFin = trim($notasFin . "\nRollos elegidos: " . implode(',', $idsRollosSalen));
                    }
                }
            } catch (\Throwable $e) { error_log('[seguimiento/en_camino rollos] ' . $e->getMessage()); }
        }
        if ($esRecup && !$yaEnCamino && strpos($notasFin, '[STOCK:recuperado]') === false) {
            $notasFin = trim($notasFin . "\n[STOCK:recuperado]");
        }
        if ($esOnt && !$yaEnCamino && $ontsAReservar) {
            // Se guarda quién debe quedar como dueño una vez confirmen
            // "recibido" (ver nota arriba, en el bucle que despacha las ONT).
            // Va ANTES de "Seriales:" y en su propia línea — el resto del
            // código lee "Seriales: ..." hasta el final del texto, así que
            // nada puede ir después de esa etiqueta.
            // OJO: "Destinatario ONT:" y "Seriales:" deben quedar en
            // renglones SEPARADOS (nunca unidos con " · " en la misma
            // línea) — el regex que lee "Destinatario ONT:" captura todo
            // lo que sigue hasta el final del renglón, así que si
            // "Seriales: ..." queda pegado en esa misma línea, se cuela
            // dentro del nombre del destinatario (ej: "JhonE · Seriales:
            // ABC123") y la ONT nunca queda bien asignada a esa persona.
            if (!empty($ontUsuarioDestino)) {
                $notasFin = trim(($notasFin ? $notasFin . "\n" : '') . "Destinatario ONT: $ontUsuarioDestino");
            }
            // Si el admin eligió ONT de OTRO modelo (porque del pedido no había),
            // se anota qué se pidió y qué se envió de verdad.
            try {
                $modeloPedidoOnt = trim(substr($s['ref_producto'] ?? '', 5));
                $idsOnt = array_map(fn($o) => (int)$o['id'], $ontsAReservar);
                $phM = implode(',', array_fill(0, count($idsOnt), '?'));
                $qM = $pdo->prepare("SELECT DISTINCT COALESCE(NULLIF(TRIM(modelo),''),'(sin modelo)') FROM ont_seriales WHERE id IN ($phM)");
                $qM->execute($idsOnt);
                $modelosEnv = $qM->fetchAll(PDO::FETCH_COLUMN);
                $otros = array_values(array_filter($modelosEnv, fn($m) => $modeloPedidoOnt !== '' && mb_strtolower($m) !== mb_strtolower($modeloPedidoOnt) && mb_stripos($m, $modeloPedidoOnt) === false));
                if ($otros) {
                    $notasFin = trim(($notasFin ? $notasFin . "\n" : '') . "Cambio de modelo: se pidió {$modeloPedidoOnt} y se envía " . implode(', ', $modelosEnv));
                }
            } catch (\Throwable $e) { error_log('[seguimiento/cambio modelo ont] ' . $e->getMessage()); }
            $listaSn = implode(', ', array_map(fn($o) => $o['sn'], $ontsAReservar));
            $notasFin = trim(($notasFin ? $notasFin . "\n" : '') . "Seriales: $listaSn");
        }
        if ($esEquipoSolicitud && !$yaEnCamino && $equiposAReservar) {
            // Se anota exactamente qué unidad(es) real(es) se despacharon —
            // al confirmarse "recibido" se usa esto para mover esa unidad
            // física de verdad a la sede destino (ver acción 'recibido').
            $idsListaEq = implode(',', array_map(fn($e) => $e['id'], $equiposAReservar));
            $notasFin = trim(($notasFin ? $notasFin . ' · ' : '') . "EquipoIDs: {$equipoTabla}:{$idsListaEq}");
        }
        if ($esFibraSolicitud && !$yaEnCamino && $fibraAlloc) {
            $codsCarretes = [];
            foreach ($fibraAlloc as $a) {
                $cq = $pdo->prepare("SELECT codigo FROM fibra_carretes WHERE id = ?");
                $cq->execute([$a['carrete_id']]);
                $codsCarretes[] = ($cq->fetchColumn() ?: "#{$a['carrete_id']}") . " ({$a['metros']}m)";
            }
            $notasFin = trim(($notasFin ? $notasFin . ' · ' : '') . "Carretes: " . implode(', ', $codsCarretes));
        }
        if ($notasAnt && str_contains($notasAnt, 'CANCELADO:')) {
            $fechaReenv = date('d/m/Y H:i');
            // $notasFin ya trae la nota nueva MÁS las etiquetas internas
            // (Seriales, Destinatario ONT, Recoge en persona, Carretes,
            // EquipoIDs, Rollos...). Antes aquí se ponía solo $notas y esas
            // etiquetas se perdían: al re-enviar un envío cancelado, las ONT
            // quedaban "despachada" para siempre y no aparecían al recibir.
            $notasFin = $notasAnt . "\n--- Re-enviado el {$fechaReenv} ---\n" . $notasFin;
        }
        $pdo->prepare("UPDATE envios_seguimiento SET estado='en_camino', transportador=?, notas=?, fecha_envio=NOW(), enviado_por=? WHERE id=?")
            ->execute([$transportador, $notasFin, $_SESSION['usuario'], $id]);

        // Actualizar estado en tabla origen
        if ($s['tipo'] === 'solicitud') {
            $pdo->prepare("UPDATE solicitudes SET estado='en_camino' WHERE id=?")
                ->execute([$s['referencia_id']]);
        } elseif ($s['tipo'] === 'pedido') {
            $pdo->prepare("UPDATE pedidos_municipio SET estado='en_camino' WHERE id=?")
                ->execute([$s['referencia_id']]);
        }

        $pdo->commit();
        if (!empty($notificarBajoDespues)) notificarStockBajoCentral($pdo, $notificarBajoDespues, $stockAntesBajoD);
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('[en_camino] ' . $e->getMessage());
        responder(['error' => 'No se pudo despachar: ' . $e->getMessage()], 500);
    }

    auditar($pdo, 'en_camino', 'seguimiento', "Envío despachado: {$s['nombre_producto']} → {$s['destino']} (lleva: $transportador)", $s['ref_producto']);

    $suprimirNotif  = !empty($data['suprimirNotif']);
    $esUltimoGrupo  = !empty($data['esUltimoGrupo']);
    $grupoIdsStr    = trim($data['grupoIds'] ?? '');

    try {
        if (!$suprimirNotif && !$esUltimoGrupo) {
            // Notificación individual normal
            notificarEnCamino($pdo, $id);
        } elseif ($esUltimoGrupo && !empty($grupoIdsStr)) {
            // Notificación consolidada para todo el grupo
            $grupoIds = array_filter(array_map('intval', explode(',', $grupoIdsStr)));
            notificarEnCaminoGrupo($pdo, $grupoIds, $transportador, $s['destino'] ?? '');
        }
    } catch (\Throwable $e) {
        // El despacho YA se guardó (commit arriba). Si la notificación falla,
        // no debe reportarse como si el despacho hubiera fallado.
        error_log('[en_camino/notificacion] ' . $e->getMessage());
    }

    // Notificar al transportador por correo — respetando el agrupamiento.
    // En un pedido múltiple llega UN solo correo con todos los productos.
    try {
        $transpUser = $pdo->prepare("SELECT nombre, correo FROM usuarios WHERE usuario = ? AND estado = 'activo'");
        $transpUser->execute([$transportador]);
        $tu = $transpUser->fetch();

        if ($tu && !empty($tu['correo'])) {
            if ($suprimirNotif && !$esUltimoGrupo) {
                // Parte de un grupo, pero no es el último: no enviar correo todavía.
            } elseif ($esUltimoGrupo && !empty($grupoIdsStr)) {
                // Último del grupo: enviar UN correo con todos los productos del grupo.
                $grupoIds = array_filter(array_map('intval', explode(',', $grupoIdsStr)));
                $filas = '';
                $destinoGrupo = $s['destino'];
                if ($grupoIds) {
                    $ph = implode(',', array_fill(0, count($grupoIds), '?'));
                    $q = $pdo->prepare("SELECT nombre_producto, cantidad, unidad, destino FROM envios_seguimiento WHERE id IN ($ph)");
                    $q->execute($grupoIds);
                    foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $row) {
                        $destinoGrupo = $row['destino'] ?: $destinoGrupo;
                        $filas .= "<tr><td style='padding:6px 8px;border-bottom:1px solid #E2E8F0;'>".htmlspecialchars($row['nombre_producto'])."</td>"
                                . "<td style='padding:6px 8px;border-bottom:1px solid #E2E8F0;font-weight:600;text-align:center;'>".intval($row['cantidad'])." ".htmlspecialchars($row['unidad'])."</td></tr>";
                    }
                }
                _notif_enviar(
                    $tu['correo'], $tu['nombre'],
                    "📦 Tienes un envío asignado — {$destinoGrupo} (" . count($grupoIds) . " productos)",
                    "<p>Hola <strong>{$tu['nombre']}</strong>,</p>
                     <p>Se te ha asignado un envío para entregar a <strong>{$destinoGrupo}</strong>:</p>
                     <table style='width:100%;background:#F8FAFC;border-radius:10px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;border-collapse:collapse;'>
                       <tr><th style='text-align:left;padding:6px 8px;color:#64748B;border-bottom:2px solid #E2E8F0;'>Producto</th><th style='text-align:center;padding:6px 8px;color:#64748B;border-bottom:2px solid #E2E8F0;'>Cantidad</th></tr>
                       {$filas}
                     </table>
                     <p style='font-size:13px;color:#64748B;'>Despachado por {$_SESSION['usuario']}. Una vez entregues el material, confirma la entrega en el sistema indicando quién lo recibió.</p>"
                );
            } else {
                // Envío individual normal: un producto.
                _notif_enviar(
                    $tu['correo'], $tu['nombre'],
                    "📦 Tienes un envío asignado — {$s['nombre_producto']}",
                    "<p>Hola <strong>{$tu['nombre']}</strong>,</p>
                     <p>Se te ha asignado un envío para entregar:</p>
                     <table style='width:100%;background:#F8FAFC;border-radius:10px;padding:16px;border:1.5px solid #E2E8F0;margin:16px 0;font-size:13px;'>
                       <tr><td style='color:#64748B;padding:4px 0;'>Producto</td><td style='font-weight:600;'>{$s['nombre_producto']}</td></tr>
                       <tr><td style='color:#64748B;padding:4px 0;'>Cantidad</td><td style='font-weight:600;'>{$s['cantidad']} {$s['unidad']}</td></tr>
                       <tr><td style='color:#64748B;padding:4px 0;'>Destino</td><td style='font-weight:600;'>{$s['destino']}</td></tr>
                       <tr><td style='color:#64748B;padding:4px 0;'>Despachado por</td><td style='font-weight:600;'>{$_SESSION['usuario']}</td></tr>
                     </table>
                     <p style='font-size:13px;color:#64748B;'>Una vez entregues el material, confirma la entrega en el sistema indicando quién lo recibió.</p>"
                );
            }
        }
    } catch (\Throwable $e) { error_log("[Seguimiento] Error notif transportador: " . $e->getMessage()); }

    responder(['ok' => true]);
}

/* ══ CANCELAR ENVÍO APROBADO (aún sin despachar) ══
   Para cuando ya no se necesita algo que está aprobado y esperando despacho.
   No mueve stock: el stock solo se descuenta al despachar; al pasar a 'cancelado'
   la reserva se libera sola. Solo aplica a solicitudes y pedidos normales. */
if ($method === 'POST' && $action === 'cancelar_aprobado') {
    rolOPermiso(['superadmin'], 'despachar');
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    $nota = trim($data['nota'] ?? '');
    if (!$id)   responder(['error' => 'ID requerido'], 400);
    if (!$nota) responder(['error' => 'El motivo es requerido'], 400);

    $pdo->beginTransaction();
    try {
        $seg = $pdo->prepare("SELECT * FROM envios_seguimiento WHERE id = ? FOR UPDATE");
        $seg->execute([$id]);
        $s = $seg->fetch();
        if (!$s) { $pdo->rollBack(); responder(['error' => 'Seguimiento no encontrado'], 404); }
        if (!_puedeDespacharEnvio($s)) { $pdo->rollBack(); responder(['error' => 'Este envío sale de una oficina o de otra persona: solo quien lo envió puede cancelarlo'], 403); }
        if ($s['estado'] !== 'aprobado') { $pdo->rollBack(); responder(['error' => 'Solo se puede cancelar un envío aprobado que aún no se ha despachado'], 409); }
        if (!in_array($s['tipo'], ['solicitud', 'pedido', 'olt', 'mikrotik', 'asignacion'], true)) { $pdo->rollBack(); responder(['error' => 'Este tipo de envío no se puede cancelar desde aquí'], 400); }

        $usuario = $_SESSION['usuario'] ?? '';
        $motivo  = mb_substr("Cancelado antes de despachar por {$usuario}: {$nota}", 0, 290);
        $pdo->prepare("UPDATE envios_seguimiento SET estado='cancelado', transportador=NULL, fecha_envio=NULL, notas=? WHERE id=? AND estado='aprobado'")
            ->execute([$motivo, $id]);

        if ($s['tipo'] === 'olt' || $s['tipo'] === 'mikrotik' || $s['tipo'] === 'asignacion') {
            // Asignación directa: llega a 'aprobado' solo porque se canceló un despacho, y ahí el stock ya se devolvió.
            // Equipo enviado/asignado directo: no hay solicitud que rechazar ni stock que devolver
            // (el equipo solo cambia de sede al confirmarse el recibido).
        } elseif ($s['tipo'] === 'solicitud') {
            $pdo->prepare("UPDATE solicitudes SET estado='rechazada', motivo=?, fecha_respuesta=NOW() WHERE id=? AND estado='aprobada'")
                ->execute([$motivo, $s['referencia_id']]);
            // Si venía de un pedido múltiple, el pedido general debe reflejarlo:
            // todos sus productos rechazados → Rechazado; solo algunos → Parcial.
            $qPag = $pdo->prepare("SELECT pedido_agrupado_id FROM solicitudes WHERE id = ?");
            $qPag->execute([$s['referencia_id']]);
            $pagId = (string)$qPag->fetchColumn();
            if ($pagId) {
                $qCnt = $pdo->prepare("SELECT COUNT(*) AS total, SUM(estado='rechazada') AS rech FROM solicitudes WHERE pedido_agrupado_id = ?");
                $qCnt->execute([$pagId]);
                $cn = $qCnt->fetch();
                if ($cn && (int)$cn['total'] > 0) {
                    if ((int)$cn['rech'] === (int)$cn['total']) {
                        $pdo->prepare("UPDATE pedidos_agrupados SET estado='rechazado' WHERE id=? AND estado IN ('aprobado','parcial')")->execute([$pagId]);
                    } elseif ((int)$cn['rech'] > 0) {
                        $pdo->prepare("UPDATE pedidos_agrupados SET estado='parcial' WHERE id=? AND estado='aprobado'")->execute([$pagId]);
                    }
                }
            }
        } else {
            $pdo->prepare("UPDATE pedidos_municipio SET estado='rechazado', motivo=?, rechazado_por=?, fecha_respuesta=NOW() WHERE id=? AND estado IN ('atendido','en_gestion')")
                ->execute([$motivo, $usuario, $s['referencia_id']]);
        }
        $pdo->commit();
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('[seguimiento/cancelar_aprobado] ' . $e->getMessage());
        responder(['error' => 'No se pudo cancelar el envío'], 500);
    }
    auditar($pdo, 'cancelar_aprobado', 'seguimiento', "Envío aprobado cancelado antes de despachar: {$s['nombre_producto']} → {$s['destino']}. Motivo: $nota", $s['ref_producto']);
    responder(['ok' => true]);
}

/* ══ CANCELAR DESPACHO ══ */
if ($method === 'POST' && $action === 'cancelar_despacho') {
    sesionRequerida();
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    $nota = trim($data['nota'] ?? '');

    if (!$id)   responder(['error' => 'ID requerido'], 400);
    if (!$nota) responder(['error' => 'El motivo es requerido'], 400);

    $seg = $pdo->prepare("SELECT * FROM envios_seguimiento WHERE id = ?");
    $seg->execute([$id]);
    $s = $seg->fetch();
    if (!$s) responder(['error' => 'Seguimiento no encontrado'], 404);
    if ($s['estado'] !== 'en_camino') responder(['error' => 'Solo se puede cancelar un envío en camino'], 400);

    // Solo quien lo envió puede cancelarlo — sin importar su rol. No tiene
    // sentido que admin/distribuidor cancelen algo que ellos no iniciaron
    // y de lo que no conocen el contexto (ej: la devolución de un técnico).
    if ($s['enviado_por'] !== ($_SESSION['usuario'] ?? '')) {
        responder(['error' => 'Solo quien envió esto puede cancelarlo'], 403);
    }

    $cant = (int)$s['cantidad'];
    $esFibraDirecta   = ($s['ref_producto'] === 'FIBRA' && $s['tipo'] === 'fibra');
    $esFibraSolicitud = ($s['ref_producto'] === 'FIBRA' && $s['tipo'] === 'solicitud');
    $esCarreteCompletoCancel = ($s['tipo'] === 'fibra_carrete');
    $esOlt   = ($s['tipo'] === 'olt');
    $esMk    = ($s['tipo'] === 'mikrotik');
    $esOnt   = str_starts_with($s['ref_producto'] ?? '', 'ONT::');

    $esRecogidoCancel = ($s['tipo'] === 'recogido');
    $esOntDevCancel   = ($s['tipo'] === 'ont_devolucion');
    $esStockDevCancel = ($s['tipo'] === 'devolucion_stock');
    $esDevolucionCancel = $esRecogidoCancel || $esOntDevCancel || $esStockDevCancel;

    if ($esOlt || $esMk) {
        // El equipo nunca cambió de sede ni de estado (eso ocurre al recibir),
        // así que la cancelación no necesita revertir nada en el equipo.
    } elseif ($esRecogidoCancel) {
        // El material vuelve a quedar "en poder" de quien lo había
        // devuelto — no "despachado" por nadie, porque nadie lo despachó:
        // el técnico lo envió por su cuenta, admin/distribuidor solo
        // decide si lo acepta o lo rechaza.
        if (!empty($s['referencia_id'])) {
            $pdo->prepare("UPDATE material_recogido SET estado = 'en_poder' WHERE id = ?")
                ->execute([(int)$s['referencia_id']]);
        }
    } elseif ($esOntDevCancel) {
        // La ONT vuelve a quedar disponible con quien la tenía antes de
        // iniciar la devolución.
        if (!preg_match('/Seriales:\s*(.+)$/m', $s['notas'] ?? '', $mOntDev) && !empty($s['referencia_id'])) {
            // Devoluciones viejas sin "Seriales:" en las notas: buscar el SN por id
            $qSn = $pdo->prepare("SELECT sn FROM ont_seriales WHERE id = ?");
            $qSn->execute([(int)$s['referencia_id']]);
            if ($snViejo = $qSn->fetchColumn()) $mOntDev = [1 => 'x', 1 => $snViejo];
        }
        if (!empty($mOntDev[1])) {
            $snsOntDev = array_values(array_filter(array_map('trim', explode(',', $mOntDev[1]))));
            if ($snsOntDev) {
                $ph = implode(',', array_fill(0, count($snsOntDev), '?'));
                try {
                    $estadoVuelta = preg_match('/Estado previo:\s*no_disponible/', $s['notas'] ?? '') ? 'no_disponible' : 'disponible';
                    $pdo->prepare("UPDATE ont_seriales SET estado = '{$estadoVuelta}', tecnico_asignado = ? WHERE sn IN ($ph)")
                        ->execute(array_merge([$s['enviado_por']], $snsOntDev));
                } catch (\Throwable $e) { error_log('[seguimiento/cancelar ont_devolucion] ' . $e->getMessage()); }
            }
        }
    } elseif ($esStockDevCancel) {
        // El stock vuelve al inventario personal de quien lo había
        // devuelto — se le resta a nadie más, se le devuelve a él.
        $prodDevCancel = $pdo->prepare("SELECT id FROM productos WHERE ref = ?");
        $prodDevCancel->execute([$s['ref_producto']]);
        $pDevCancel = $prodDevCancel->fetch();
        if ($pDevCancel) {
            stockUsuarioAjustar($pdo, $pDevCancel['id'], $s['enviado_por'], $cant);
            // Si eran rollos completos, vuelven a quedar disponibles con
            // quien los había devuelto — no se quedan "en tránsito" para
            // siempre.
            if (preg_match('/Rollos elegidos:\s*([\d,]+)/', $s['notas'] ?? '', $mRollosDevCancel)) {
                $idsRollosCancel = array_filter(array_map('intval', explode(',', $mRollosDevCancel[1])));
                if ($idsRollosCancel) {
                    $phC = implode(',', array_fill(0, count($idsRollosCancel), '?'));
                    $pdo->prepare("UPDATE producto_rollos SET estado = 'disponible', usuario_actual = ? WHERE id IN ($phC)")
                        ->execute([$s['enviado_por'], ...$idsRollosCancel]);
                }
            }
        }
    } elseif ($esCarreteCompletoCancel) {
        // Se conoce el carrete exacto (referencia_id) — se restaura tal
        // cual estaba antes de enviarlo, sin crear ningún registro nuevo.
        try {
            $pdo->prepare("UPDATE fibra_carretes SET metros_usados = 0, estado = 'disponible' WHERE id = ?")
                ->execute([(int)$s['referencia_id']]);
        } catch (\Throwable $e) { error_log('[seguimiento/cancelar carrete completo] ' . $e->getMessage()); }
    } elseif ($esOnt) {
        // Devolver a 'disponible' las ONTs específicas despachadas, identificadas
        // por el listado de seriales que en_camino dejó en las notas ("Seriales: SN1, SN2...").
        if (preg_match('/Seriales:\s*(.+)$/m', $s['notas'] ?? '', $m)) {
            $sns = array_values(array_filter(array_map('trim', explode(',', $m[1]))));
            if ($sns) {
                $ph = implode(',', array_fill(0, count($sns), '?'));
                try {
                    $colsOnt  = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
                    $setParts = ["estado='disponible'"];
                    if (in_array('enviado_a', $colsOnt))   $setParts[] = "enviado_a=NULL";
                    if (in_array('enviado_por', $colsOnt)) $setParts[] = "enviado_por=NULL";
                    if (in_array('fecha_envio', $colsOnt)) $setParts[] = "fecha_envio=NULL";
                    if (in_array('sede_actual', $colsOnt)) $setParts[] = "sede_actual=NULL";
                    $pdo->prepare("UPDATE ont_seriales SET " . implode(', ', $setParts) . "
                        WHERE sn IN ($ph) AND estado='despachada'")
                        ->execute($sns);
                } catch (\Throwable $e) { error_log('[seguimiento/cancelar ont] ' . $e->getMessage()); }
            }
        }
    } elseif ($esFibraSolicitud) {
        // Devolver metros exactos a los carretes específicos usados, identificados
        // por la nota que dejó en_camino ("Carretes: CAR-001 (100m), CAR-002 (50m)").
        if (preg_match('/Carretes:\s*(.+)$/m', $s['notas'] ?? '', $m)) {
            if (preg_match_all('/([^,]+?)\s*\(([\d.]+)\s*m\)/', $m[1], $mm, PREG_SET_ORDER)) {
                foreach ($mm as $par) {
                    $codigo = trim($par[1]);
                    $metros = floatval($par[2]);
                    try {
                        $pdo->prepare("UPDATE fibra_carretes
                                SET metros_usados = GREATEST(0, metros_usados - ?), estado='disponible'
                            WHERE codigo = ?")
                            ->execute([$metros, $codigo]);
                    } catch (\Throwable $e) { error_log('[seguimiento/cancelar fibra-sol] ' . $e->getMessage()); }
                }
            }
        }
    } elseif ($esFibraDirecta) {
        // Devolver los metros al almacén central creando un carrete de
        // reingreso (no se conoce el carrete origen exacto, así se
        // reingresa como nuevo).
        $categoriaId = (int)$s['referencia_id'];
        $sedeCentral = $pdo->prepare("SELECT id FROM sedes WHERE tipo = 'central' OR nombre = 'Almacen Central' LIMIT 1");
        $sedeCentral->execute();
        $sedeId = $sedeCentral->fetchColumn() ?: null;
        $codigo = "Reingreso por cancelación - " . date('d/m/Y');
        try {
            $pdo->prepare("INSERT INTO fibra_carretes (categoria_id, codigo, metros, metros_usados, sede_id, sede_nombre, estado, registrado_por)
                VALUES (?, ?, ?, 0, ?, 'Almacen Central', 'disponible', ?)")
                ->execute([$categoriaId, $codigo, $cant, $sedeId, $_SESSION['usuario']]);
        } catch (\Throwable $e) {
            error_log('[seguimiento/cancelar fibra] ' . $e->getMessage());
        }
    } else {
        // Restaurar stock al origen (productos normales)
        $prod = $pdo->prepare("SELECT id, metros_por_unidad FROM productos WHERE ref = ?");
        $prod->execute([$s['ref_producto']]);
        $p = $prod->fetch();
        if ($p) {
            if ($s['tipo'] === 'asignacion') {
                // Una asignación directa persona-a-persona se descuenta del
                // inventario de quien la envió (no de una "sede"), así que
                // se restaura ahí — y si eran rollos completos elegidos,
                // vuelven a estar disponibles a su nombre, no en tránsito
                // para siempre.
                stockUsuarioAjustar($pdo, $p['id'], $s['enviado_por'], $cant);
                if (!empty($p['metros_por_unidad']) && preg_match('/Rollos elegidos:\s*([\d,]+)/', $s['notas'] ?? '', $mRollosAsigCancel)) {
                    $idsRollosAsigCancel = array_filter(array_map('intval', explode(',', $mRollosAsigCancel[1])));
                    if ($idsRollosAsigCancel) {
                        $phAC = implode(',', array_fill(0, count($idsRollosAsigCancel), '?'));
                        $pdo->prepare("UPDATE producto_rollos SET estado = 'disponible', usuario_actual = ? WHERE id IN ($phAC)")
                            ->execute([$s['enviado_por'], ...$idsRollosAsigCancel]);
                    }
                }
            } elseif ($s['origen'] === 'Almacen Central') {
                $colRest = (strpos($s['notas'] ?? '', '[STOCK:recuperado]') !== false) ? 'stock_recuperado' : 'stock_neiva';
                $pdo->prepare("UPDATE productos SET $colRest = $colRest + ? WHERE id = ?")
                    ->execute([$cant, $p['id']]);
                // Rollos que habían salido del almacén al despachar: vuelven a estar disponibles allí.
                if (preg_match('/Rollos elegidos:\s*([\d,]+)/', $s['notas'] ?? '', $mRollosCenCancel)) {
                    $idsRC = array_filter(array_map('intval', explode(',', $mRollosCenCancel[1])));
                    if ($idsRC) {
                        $phRC = implode(',', array_fill(0, count($idsRC), '?'));
                        $pdo->prepare("UPDATE producto_rollos SET estado = 'disponible' WHERE id IN ($phRC) AND estado = 'en_transito' AND usuario_actual IS NULL AND sede_nombre = 'Almacen Central'")->execute($idsRC);
                    }
                }
            } else {
                stockUsuarioAjustar($pdo, $p['id'], $s['origen'], $cant);
            }
        }
    }

    // Revertir estado a aprobado — EXCEPTO devoluciones, que quedan
    // canceladas de una vez (no hay "despachar" de vuelta, ya que nadie
    // las despacha — el remitente las inició directamente).
    // Al cancelar se conservan los datos de DESTINO del envío (a quién iba,
    // lote, de qué stock salía, carrete elegido). Antes se borraban y, al
    // re-enviar, el sistema ya no sabía quién debía recibirlo: lo podía
    // confirmar otra persona de la misma sede, o el descuento se hacía del
    // stock equivocado ([STOCK:recuperado]). Lo que se regenera al despachar
    // (Seriales, Rollos, Carretes, EquipoIDs) NO se conserva.
    $conservar = [];
    foreach (explode("\n", (string)($s['notas'] ?? '')) as $lnC) {
        $lnC = trim($lnC);
        if ($lnC !== '' && preg_match('/^(Recoge en persona:|Asignaci[oó]n directa a\b|Lote:|Carrete elegido:|Seriales preseleccionados:|\[STOCK:recuperado\]$)/iu', $lnC)) $conservar[] = $lnC;
    }
    $notasCancel = "CANCELADO: $nota" . ($conservar ? "\n" . implode("\n", array_unique($conservar)) : '');
    if ($esDevolucionCancel) {
        $pdo->prepare("UPDATE envios_seguimiento SET estado='cancelado', transportador=NULL, fecha_envio=NULL, notas=? WHERE id=?")
            ->execute([$notasCancel, $id]);
    } else {
        $pdo->prepare("UPDATE envios_seguimiento SET estado='aprobado', transportador=NULL, fecha_envio=NULL, notas=? WHERE id=?")
            ->execute([$notasCancel, $id]);
    }

    // Revertir estado en tabla origen
    if ($s['tipo'] === 'solicitud') {
        $pdo->prepare("UPDATE solicitudes SET estado='aprobada' WHERE id=?")
            ->execute([$s['referencia_id']]);
    } elseif ($s['tipo'] === 'pedido') {
        $pdo->prepare("UPDATE pedidos_municipio SET estado='en_gestion' WHERE id=?")
            ->execute([$s['referencia_id']]);
    }

    auditar($pdo, 'cancelar_despacho', 'seguimiento', "Despacho cancelado: {$s['nombre_producto']} → {$s['destino']}. Motivo: $nota", $s['ref_producto']);
    responder(['ok' => true]);
}

/* ══ TRANSPORTADOR CONFIRMA ENTREGA ══ */
if ($method === 'POST' && $action === 'entregado') {
    $data       = json_decode(file_get_contents('php://input'), true);
    $id         = intval($data['id'] ?? 0);
    $entregadoA = trim($data['entregado_a'] ?? '');
    $notas      = trim($data['notas'] ?? '');

    if (!$id) responder(['error' => 'ID requerido'], 400);
    if (!$entregadoA) responder(['error' => 'Indica quién recibió el material'], 400);

    $seg = $pdo->prepare("SELECT * FROM envios_seguimiento WHERE id = ?");
    $seg->execute([$id]);
    $s = $seg->fetch();
    if (!$s) responder(['error' => 'Seguimiento no encontrado'], 404);
    if ($s['estado'] !== 'en_camino') responder(['error' => 'Este envío no está en camino'], 400);

    // Solo el transportador asignado puede confirmar entrega
    // (comparación tolerante a espacios/mayúsculas, por si hay diferencias de captura).
    if (strtolower(trim($_SESSION['usuario'] ?? '')) !== strtolower(trim($s['transportador'] ?? ''))) {
        responder(['error' => 'Solo el transportador asignado puede confirmar la entrega'], 403);
    }

    // Acumular notas sin sobreescribir las del despacho
    $notaActual = $pdo->prepare("SELECT notas FROM envios_seguimiento WHERE id=?");
    $notaActual->execute([$id]);
    $notaPrevia = trim($notaActual->fetchColumn() ?? '');
    $notaFinal  = $notaPrevia;
    if (!empty($notas)) $notaFinal = $notaPrevia ? $notaPrevia . "
[Entrega] " . $notas : "[Entrega] " . $notas;

    $pdo->prepare("UPDATE envios_seguimiento SET estado='entregado', entregado_a=?, notas=?, fecha_entrega=NOW() WHERE id=?")
        ->execute([$entregadoA, $notaFinal, $id]);

    // Notificar al municipio destino que ya llegó (agrupado si es pedido múltiple)
    try { notificarEntregado($pdo, $id, $entregadoA); }
    catch (\Throwable $e) { error_log("[Seguimiento] Error notif entrega: " . $e->getMessage()); }

    auditar($pdo, 'entregado', 'seguimiento', "Entregado por {$s['transportador']} a {$entregadoA} en {$s['destino']}", $s['ref_producto']);
    responder(['ok' => true]);
}

/* ══ CONFIRMAR RECIBIDO ══ */
if ($method === 'POST' && $action === 'recibido') {
    $data  = json_decode(file_get_contents('php://input'), true);
    $id    = intval($data['id'] ?? 0);
    $notas = trim($data['notas'] ?? '');
    $cantidadDanada = max(0, intval($data['cantidad_danada'] ?? 0));

    if (!$id) responder(['error' => 'ID requerido'], 400);

    $seg = $pdo->prepare("SELECT * FROM envios_seguimiento WHERE id = ?");
    $seg->execute([$id]);
    $s = $seg->fetch();
    if (!$s) responder(['error' => 'Seguimiento no encontrado'], 404);
    if ($s['estado'] !== 'en_camino' && $s['estado'] !== 'entregado')
        responder(['error' => 'El envío aún no ha sido entregado'], 400);

    // Verificar que el usuario pertenece a la sede destino (comparación
    // tolerante a espacios/mayúsculas, mismo criterio que con transportador)
    // — EXCEPTO si hay alguien identificado que debería recibirlo (el
    // destinatario elegido con "Recoge en persona: X", o quien de verdad
    // hizo la solicitud): esa persona puede confirmar aunque la sede de su
    // cuenta no coincida exactamente con la sede destino del envío (pueden
    // no coincidir por motivos administrativos) — el frontend ya la deja
    // confirmar en ese caso (ver dashboard.html) y aquí no debe bloquearla.
    //
    // IMPORTANTE: cuando SÍ se eligió una persona puntual ("Recoge en
    // persona: X"), la confirmación queda reservada SOLO para esa persona
    // — antes, cualquier otro usuario que compartiera la misma sede que X
    // (ej: un técnico y el municipio de la misma oficina) también podía
    // confirmarlo, porque el chequeo de sede funcionaba como alternativa
    // ("O"), no como restricción. Un envío dirigido a alguien puntual no
    // debe poder aceptarlo otra persona solo por estar en la misma oficina.
    $tieneDestinatarioEspecifico = false;
    $destinatarioEspecificoNombre = null;
    if (preg_match('/Recoge en persona:\s*(.+)$/m', $s['notas'] ?? '', $mDestElegido)) {
        $tieneDestinatarioEspecifico = true;
        $destinatarioEspecificoNombre = trim($mDestElegido[1]);
    }
    if ($tieneDestinatarioEspecifico) {
        if ($destinatarioEspecificoNombre !== ($_SESSION['usuario'] ?? '')) {
            responder(['error' => 'Solo ' . $destinatarioEspecificoNombre . ' puede confirmar la recepción de este envío'], 403);
        }
    } else {
        $enSedeDestino = strtolower(trim($_SESSION['sede'] ?? '')) === strtolower(trim($s['destino'] ?? ''));
        // Devoluciones al Almacén Central: superadmin/distribuidor pueden recibirla
        if (!$enSedeDestino
            && (in_array($s['tipo'] ?? '', ['recogido', 'ont_devolucion', 'devolucion_stock']) || (($s['tipo'] ?? '') === 'fibra' && preg_match('/Devoluci[oó]n:\s*s[ií]/u', $s['notas'] ?? '')))
            && strtolower(trim($s['destino'] ?? '')) === 'almacen central'
            && in_array($_SESSION['rol'] ?? '', ['superadmin', 'distribuidor'])) {
            $enSedeDestino = true;
        }
        $esDestinatarioElegido = false;
        if (!empty($s['referencia_id'])) {
            $solicitanteReal = null;
            $solicitanteRealRol = null;
            if (($s['tipo'] ?? '') === 'solicitud') {
                $qSolReal = $pdo->prepare("SELECT sol.solicitado_por, u.rol FROM solicitudes sol LEFT JOIN usuarios u ON u.usuario = sol.solicitado_por WHERE sol.id = ?");
                $qSolReal->execute([$s['referencia_id']]);
            } elseif (($s['tipo'] ?? '') === 'pedido') {
                $qSolReal = $pdo->prepare("SELECT pm.solicitado_por, u.rol FROM pedidos_municipio pm LEFT JOIN usuarios u ON u.usuario = pm.solicitado_por WHERE pm.id = ?");
                $qSolReal->execute([$s['referencia_id']]);
            } else {
                $qSolReal = null;
            }
            if ($qSolReal) {
                $rowSolReal = $qSolReal->fetch();
                $solicitanteReal = $rowSolReal['solicitado_por'] ?? null;
                $solicitanteRealRol = $rowSolReal['rol'] ?? null;
            }
            if ($solicitanteReal && !in_array($solicitanteRealRol, ['superadmin', 'distribuidor'])
                && $solicitanteReal === ($_SESSION['usuario'] ?? '')) {
                $esDestinatarioElegido = true;
            }
        }
        if (!$enSedeDestino && !$esDestinatarioElegido) {
            responder(['error' => 'Solo puede confirmar recibido alguien de la sede ' . $s['destino']], 403);
        }
    }
    // En una devolución, origen y destino pueden ser la MISMA sede (ej: un
    // técnico devolviendo a su propio municipio) — sin este chequeo, la
    // persona que la envió podría confirmársela a sí misma.
    $esFibraDevS = (($s['tipo'] ?? '') === 'fibra' && preg_match('/Devoluci[oó]n:\s*s[ií]/u', $s['notas'] ?? ''));
    $esDevolucionBloq = $esFibraDevS || in_array($s['tipo'] ?? '', ['recogido', 'ont_devolucion', 'devolucion_stock', 'asignacion']);
    if ($esDevolucionBloq && ($_SESSION['usuario'] ?? '') === ($s['enviado_por'] ?? '')) {
        responder(['error' => 'Quien envió la devolución no puede confirmarla — debe hacerlo alguien más en ' . $s['destino']], 403);
    }

    // Solo el usuario que hizo la solicitud puede confirmar la recepción,
    // EXCEPTO si quien confirma es el transportador asignado (que es de la sede
    // destino y llevó el material él mismo: p.ej. el superadmin envió y lo puso
    // como transportador), O si quien "solicitó" es en realidad superadmin/
    // distribuidor (así se guarda un "Enviar directo" — el creador queda
    // como solicitante, a propósito, para no mezclar "quien transporta" con
    // "quien pidió"). En ambos casos esta restricción no tiene a quién
    // aplicarle en la oficina destino, así que cualquiera ahí puede confirmar.
    if (($s['tipo'] ?? '') === 'solicitud' && !empty($s['referencia_id'])) {
        $solQ = $pdo->prepare("SELECT sol.solicitado_por, u.rol AS solicitante_rol FROM solicitudes sol LEFT JOIN usuarios u ON u.usuario = sol.solicitado_por WHERE sol.id = ?");
        $solQ->execute([$s['referencia_id']]);
        $solRow = $solQ->fetch();
        $solicitante = $solRow['solicitado_por'] ?? null;
        $solicitanteRol = $solRow['solicitante_rol'] ?? null;
        $esSolicitanteAdmin = in_array($solicitanteRol, ['superadmin', 'distribuidor']);
        $usuarioActual = $_SESSION['usuario'] ?? '';
        $esTransportador = ($s['transportador'] ?? '') === $usuarioActual;
        if ($solicitante && $solicitante !== $usuarioActual && !$esTransportador && !$esSolicitanteAdmin) {
            responder(['error' => 'Solo quien hizo la solicitud (' . $solicitante . ') puede confirmar la recepción'], 403);
        }
    }

    // Transporte externo: sede destino confirma directamente
    // Transporte interno: si la sede destino confirma, se salta el paso intermedio de entrega
    // (el transportador puede confirmar entrega por separado si quiere, pero no es obligatorio)
    $esExterno = str_starts_with($s['transportador'] ?? '', 'EXT:');
    // Material recogido llevado por otro usuario del sistema: primero debe confirmar
    // su entrega; el almacén recibe después.
    if ((in_array(($s['tipo'] ?? ''), ['recogido','devolucion_stock','ont_devolucion'], true) || (($s['tipo'] ?? '') === 'fibra' && preg_match('/Devoluci[oó]n:\s*s[ií]/u', $s['notas'] ?? ''))) && $s['estado'] === 'en_camino' && !$esExterno
        && !empty($s['transportador']) && $s['transportador'] !== ($s['enviado_por'] ?? '')
        && ($_SESSION['usuario'] ?? '') !== $s['transportador']) {
        responder(['error' => 'Espera a que ' . $s['transportador'] . ' confirme la entrega antes de recibirlo'], 400);
    }
    // No bloquear — permitir que la sede confirme recibido directamente en cualquier caso

    $cant = (int)$s['cantidad'];
    $esFibra = ($s['ref_producto'] === 'FIBRA' && $s['tipo'] !== 'fibra_carrete');
    $esCarreteCompleto = ($s['tipo'] === 'fibra_carrete');
    $esOlt   = ($s['tipo'] === 'olt');
    $esMk    = ($s['tipo'] === 'mikrotik');
    $esOnt   = str_starts_with($s['ref_producto'] ?? '', 'ONT::');
    $esEquipoSolicitud = str_starts_with($s['ref_producto'] ?? '', 'EQUIPO::');

    if ($esOlt || $esMk) {
        // OLT/Mikrotik: el equipo se mueve a la sede destino.
        // No tocamos 'estado' para no chocar con el ENUM de la tabla.
        // "asignado_a": si este envío iba dirigido a una persona puntual
        // ("Recoge en persona: X"), el equipo queda SOLO para ella en Mis
        // Equipos (aunque otros compartan su misma sede). Si fue un envío
        // normal a la oficina, queda libre (NULL) — de toda la oficina.
        $tabla = $esOlt ? 'olts' : 'mikrotiks';
        try {
            $pdo->prepare("UPDATE $tabla SET sede=?, asignado_a=? WHERE id=?")
                ->execute([$s['destino'], $tieneDestinatarioEspecifico ? $destinatarioEspecificoNombre : null, (int)$s['referencia_id']]);
        } catch (\Throwable $e) {
            error_log('[seguimiento/recibido equipo] ' . $e->getMessage());
            responder(['error' => 'No se pudo asignar el equipo a destino: ' . $e->getMessage()], 500);
        }
    } elseif ($esCarreteCompleto) {
        // El carrete físico (mismo código, mismo id) se actualiza para que
        // quede en la sede/persona destino — no se crea uno nuevo, así se
        // sabe siempre exactamente de dónde salió cada uno.
        $carreteIdReal = (int)$s['referencia_id'];
        $sedeDestino = $pdo->prepare("SELECT id FROM sedes WHERE nombre = ?");
        $sedeDestino->execute([$s['destino']]);
        $sedeIdDestino = $sedeDestino->fetchColumn() ?: null;
        // Si al enviarlo se eligió una persona específica ("Recoge en
        // persona: X" en las notas), el carrete queda a su nombre — si no,
        // queda a nivel de oficina (usuario_actual = NULL), como antes.
        $usuarioCarreteCompleto = null;
        if (preg_match('/Recoge en persona:\s*(.+)$/m', $s['notas'] ?? '', $mCarreteC)) {
            $usuarioCarreteCompleto = trim($mCarreteC[1]);
        }
        // Sin persona elegida: queda a nombre de quien lo recibe (si no es admin/distribuidor),
        // para que pueda verlo y gastarlo en "Mis carretes" y no quede huérfano a nivel de oficina.
        if (!$usuarioCarreteCompleto && !in_array($_SESSION['rol'] ?? '', ['superadmin','distribuidor'], true)) {
            $usuarioCarreteCompleto = $_SESSION['usuario'] ?? null;
        }
        try {
            $pdo->prepare("UPDATE fibra_carretes
                    SET metros_usados = 0, estado = 'disponible',
                        sede_id = ?, sede_nombre = ?, usuario_actual = ?
                    WHERE id = ?")
                ->execute([$sedeIdDestino, $s['destino'], $usuarioCarreteCompleto, $carreteIdReal]);
        } catch (\Throwable $e) {
            error_log('[seguimiento/recibido carrete completo] ' . $e->getMessage());
            responder(['error' => 'No se pudo actualizar el carrete: ' . $e->getMessage()], 500);
        }
    } elseif ($esFibra) {
        // La fibra no vive en stock_sedes sino en fibra_carretes.
        // Creamos el carrete en la sede destino con los metros recibidos.
        // La categoría puede venir de distintas fuentes según el origen del envío:
        $categoriaId = 0;

        // 1) Si referencia_id apunta directamente a una categoría válida (envío directo enviar_metros).
        //    SOLO para envíos directos (tipo 'fibra'): en una solicitud referencia_id es el id de la
        //    SOLICITUD, y si por casualidad coincidía con el id de una categoría (p.ej. 6) la fibra
        //    quedaba en la categoría equivocada (llegaba "6 hilos" en vez de "12 hilos").
        $refId = (int)$s['referencia_id'];
        if ($refId > 0 && ($s['tipo'] ?? '') === 'fibra') {
            $chk = $pdo->prepare("SELECT id FROM fibra_categorias WHERE id = ?");
            $chk->execute([$refId]);
            if ($chk->fetchColumn()) $categoriaId = $refId;
        }

        // 2) Si vino de una solicitud, buscar la categoría guardada en la solicitud.
        if (!$categoriaId && $refId > 0) {
            try {
                $solCols = $pdo->query("SHOW COLUMNS FROM solicitudes")->fetchAll(PDO::FETCH_COLUMN);
                if (in_array('categoria_fibra_id', $solCols)) {
                    $q = $pdo->prepare("SELECT categoria_fibra_id FROM solicitudes WHERE id = ?");
                    $q->execute([$refId]);
                    $cf = (int)$q->fetchColumn();
                    if ($cf) {
                        $chk = $pdo->prepare("SELECT id FROM fibra_categorias WHERE id = ?");
                        $chk->execute([$cf]);
                        if ($chk->fetchColumn()) $categoriaId = $cf;
                    }
                }
            } catch (\Throwable $e) { error_log('[recibido fibra cat-sol] '.$e->getMessage()); }
        }

        // 3) Resolver por el nombre del producto: "Fibra <nombre categoría>".
        if (!$categoriaId) {
            $nom = trim(preg_replace('/^[^\p{L}\p{N}]*Fibra\s*(?:[—–-]\s*)?/iu', '', $s['nombre_producto'] ?? ''));
            // También se prueba el nombre completo sin el adorno del inicio (algunas categorías
            // se llaman "FIBRA 12 HILOS…", así que quitarle "Fibra" las dejaría sin coincidir).
            $nomCompleto = trim(preg_replace('/^[^\p{L}\p{N}]*(?:Fibra\s*[—–-]\s*)?/iu', '', $s['nombre_producto'] ?? ''));
            if ($nom !== '') {
                $q = $pdo->prepare("SELECT id FROM fibra_categorias WHERE nombre = ? OR nombre = ? ORDER BY (nombre = ?) DESC LIMIT 1");
                $q->execute([$nom, $nomCompleto, $nomCompleto]);
                $categoriaId = (int)$q->fetchColumn();
            }
        }

        // 4) Último recurso: primera categoría existente (evita romper el flujo).
        if (!$categoriaId) {
            $categoriaId = (int)$pdo->query("SELECT id FROM fibra_categorias ORDER BY id LIMIT 1")->fetchColumn();
        }

        if (!$categoriaId) {
            responder(['error' => 'No hay categoría de fibra válida para registrar el carrete'], 500);
        }

        $sedeDestino = $pdo->prepare("SELECT id FROM sedes WHERE nombre = ?");
        $sedeDestino->execute([$s['destino']]);
        $sedeId = $sedeDestino->fetchColumn() ?: null;

        // El carrete queda a nombre de quien lo pidió (ya no solo "en la
        // sede") — así responde por él como cualquier otro material.
        $usuarioCarrete = null;
        if (($s['tipo'] ?? '') === 'solicitud' && !empty($s['referencia_id'])) {
            $qFib = $pdo->prepare("SELECT solicitado_por FROM solicitudes WHERE id = ?");
            $qFib->execute([$s['referencia_id']]);
            $usuarioCarrete = $qFib->fetchColumn() ?: null;
        }
        // Envío directo (enviar_metros, sin pasar por solicitud) — revisa
        // si se eligió un destinatario específico al enviar.
        if (!$usuarioCarrete && preg_match('/Recoge en persona:\s*(.+)$/m', $s['notas'] ?? '', $mFibDir)) {
            $usuarioCarrete = trim($mFibDir[1]);
        }
        // Si no hay dueño, o el solicitante es admin/distribuidor, el carrete queda a nombre de quien lo recibe
        $rolDuenioF = '';
        if ($usuarioCarrete) { $qRolF = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?"); $qRolF->execute([$usuarioCarrete]); $rolDuenioF = (string)$qRolF->fetchColumn(); }
        if ((!$usuarioCarrete || in_array($rolDuenioF, ['superadmin','distribuidor'], true))
            && !in_array($_SESSION['rol'] ?? '', ['superadmin','distribuidor'], true)) {
            $usuarioCarrete = $_SESSION['usuario'] ?? $usuarioCarrete;
        }

        // Cada carrete es un rollo físico real — nunca se fusiona con otro
        // al recibir, aunque sea de la misma categoría y persona. Se crea uno
        // nuevo por cada envío. El total por categoría (para ver cuántos
        // metros hay en total) se calcula sumando todos sus carretes aparte.
        $codigo = "Recibido desde " . ($s['origen'] ?: 'Almacen Central') . " - " . date('d/m/Y');
        try {
            $pdo->prepare("INSERT INTO fibra_carretes (categoria_id, codigo, metros, metros_usados, sede_id, sede_nombre, usuario_actual, estado, registrado_por)
                VALUES (?, ?, ?, 0, ?, ?, ?, 'disponible', ?)")
                ->execute([$categoriaId, $codigo, $cant, $sedeId, $s['destino'], $usuarioCarrete, $_SESSION['usuario']]);
        } catch (\Throwable $e) {
            error_log('[seguimiento/recibido fibra] ' . $e->getMessage());
            responder(['error' => 'No se pudo crear el carrete en destino: ' . $e->getMessage()], 500);
        }
    } elseif (($s['tipo'] ?? '') === 'devolucion_stock') {
        // Devolución de stock normal (no ONT, no material recogido) —
        // solo AQUÍ se acredita, no al momento de enviar. Si va al almacén
        // central, se suma al pool general; si va a un municipio, se
        // acredita al inventario PERSONAL de quien confirma ahí.
        $vaAlmacenDev = strtolower(trim($s['destino'] ?? '')) === 'almacen central';
        $prodDev = $pdo->prepare("SELECT id, metros_por_unidad FROM productos WHERE ref = ?");
        $prodDev->execute([$s['ref_producto']]);
        $pDev = $prodDev->fetch();
        if ($pDev) {
            if ($vaAlmacenDev) {
                $pdo->prepare("UPDATE productos SET stock_neiva = stock_neiva + ? WHERE id = ?")
                    ->execute([$cant, $pDev['id']]);
            } else {
                stockUsuarioAjustar($pdo, $pDev['id'], $_SESSION['usuario'] ?? '', $cant);
            }
            // Si es "por rollo" y se devolvieron uno o más rollos
            // COMPLETOS (no metros sueltos), se transfieren esos mismos
            // rollos con su identidad — quedan "disponibles" en el
            // destino, a nombre de quien confirma (o sin dueño si va al
            // almacén central).
            if (!empty($pDev['metros_por_unidad']) && preg_match('/Rollos elegidos:\s*([\d,]+)/', $s['notas'] ?? '', $mRollosDev)) {
                $idsRollosDev = array_filter(array_map('intval', explode(',', $mRollosDev[1])));
                if ($idsRollosDev) {
                    $usuarioRolloDev = $vaAlmacenDev ? null : ($_SESSION['usuario'] ?? null);
                    $phDev = implode(',', array_fill(0, count($idsRollosDev), '?'));
                    $pdo->prepare("UPDATE producto_rollos SET estado = 'disponible', sede_nombre = ?, usuario_actual = ? WHERE id IN ($phDev)")
                        ->execute([$s['destino'], $usuarioRolloDev, ...$idsRollosDev]);
                }
            }
        }
    } elseif (($s['tipo'] ?? '') === 'recogido') {
        // Material recogido en campo que se estaba devolviendo — puede ir
        // al almacén central O al municipio de quien lo devolvió (mismo
        // criterio que con ONT). Si es REUTILIZABLE, se acredita directo
        // (ya se sabe que sirve): al pool central si va al almacén, o al
        // inventario PERSONAL de quien confirma si va a un municipio. Si
        // es DAÑADO, solo se marca como devuelto — alguien debe revisarlo
        // primero y decidir manualmente si se reincorpora o se da de baja.
        $mrOrigen = null;
        if (!empty($s['referencia_id'])) {
            $mrStmt = $pdo->prepare("SELECT * FROM material_recogido WHERE id = ?");
            $mrStmt->execute([(int)$s['referencia_id']]);
            $mrOrigen = $mrStmt->fetch();
        }
        $esReutilizable = !$mrOrigen || ($mrOrigen['tipo'] ?? 'reutilizable') === 'reutilizable';
        $vaAlAlmacenRec = strtolower(trim($s['destino'] ?? '')) === 'almacen central';

        // ── Conteo real al recibir ──
        // reutilizable: quien recibe indica cuántos reutilizables y cuántos dañados llegaron;
        // dañado: indica cuántos llegaron. Lo que no llegó se avisa a quien lo devolvió.
        $cantR = $esReutilizable ? $cant : 0;
        $cantD = $esReutilizable ? 0 : $cant;
        if ($mrOrigen) {
            if ($esReutilizable) {
                $cantR = isset($data['cant_reutilizable']) ? max(0, intval($data['cant_reutilizable'])) : $cant;
                $cantD = isset($data['cant_danada_rec'])   ? max(0, intval($data['cant_danada_rec']))   : 0;
            } else {
                $cantD = isset($data['cant_danada_rec']) ? max(0, intval($data['cant_danada_rec'])) : $cant;
            }
            if ($cantR + $cantD > $cant) responder(['error' => "No pueden llegar más de las {$cant} unidades enviadas"], 400);
        }
        $faltan = $cant - $cantR - $cantD;
        $mrId = (int)($s['referencia_id'] ?? 0);

        if ($mrOrigen) {
            $esNuevoMR = !empty($mrOrigen['es_nuevo']);
            $tipoFinal = ($esReutilizable && $cantR > 0) ? 'reutilizable' : 'dañado';
            $cantFinal = ($esReutilizable && $cantR > 0) ? $cantR : $cantD;
            $acreditar = false;
            if ($esReutilizable && $cantR > 0 && !$esNuevoMR) {
                $prod = $pdo->prepare("SELECT id FROM productos WHERE ref = ?");
                $prod->execute([$s['ref_producto']]);
                $p = $prod->fetch();
                if ($p) {
                    if ($vaAlAlmacenRec) {
                        $pdo->prepare("UPDATE productos SET stock_recuperado = stock_recuperado + ? WHERE id = ?")->execute([$cantR, $p['id']]);
                        $acreditar = true;
                    } else {
                        stockUsuarioAjustar($pdo, $p['id'], $_SESSION['usuario'] ?? '', $cantR);
                    }
                }
            }
            if ($cantFinal > 0) {
                $pdo->prepare("UPDATE material_recogido SET estado='devuelto', fecha_devolucion=NOW(), tipo=?, cantidad=?, stock_acreditado=? WHERE id=?")
                    ->execute([$tipoFinal, $cantFinal, $acreditar ? 1 : 0, $mrId]);
            } else {
                $pdo->prepare("UPDATE material_recogido SET estado='dado_de_baja', fecha_devolucion=NOW(), motivo=CONCAT(COALESCE(motivo,''), ' [No llegó nada al almacén]') WHERE id=?")->execute([$mrId]);
            }
            // Dañados que llegaron junto a reutilizables: registro aparte, en revisión
            if ($esReutilizable && $cantR > 0 && $cantD > 0) {
                $pdo->prepare("
                    INSERT INTO material_recogido (producto_id, ref, nombre, usuario, cantidad, tipo, motivo, estado, fecha, fecha_devolucion, es_nuevo, proveedor_nuevo, stock_acreditado)
                    VALUES (?, ?, ?, ?, ?, 'dañado', ?, 'devuelto', NOW(), NOW(), ?, ?, 0)
                ")->execute([$mrOrigen['producto_id'], $mrOrigen['ref'], $mrOrigen['nombre'], $mrOrigen['usuario'], $cantD,
                    'Llegó dañado (conteo al recibir)', $mrOrigen['es_nuevo'], $mrOrigen['proveedor_nuevo']]);
            }
            // Aviso a quien lo devolvió si lo recibido no coincide con lo que registró
            if ($faltan > 0 || ($esReutilizable && $cantD > 0)) {
                try {
                    $nom = $s['nombre_producto'];
                    $partes = [];
                    if ($esReutilizable) {
                        $partes[] = "registraste {$cant} reutilizable(s)";
                        $partes[] = "el almacén recibió {$cantR} reutilizable(s)" . ($cantD > 0 ? " y {$cantD} dañado(s)" : '');
                    } else {
                        $partes[] = "registraste {$cant} dañado(s)";
                        $partes[] = "el almacén recibió {$cantD}";
                    }
                    if ($faltan > 0) $partes[] = "faltan {$faltan} unidad(es) que no llegaron";
                    $resumen = ucfirst(implode('; ', $partes)) . '.';
                    $usuarioAviso = $mrOrigen['usuario'];
                    $titulo = $faltan > 0 ? "⚠️ No llegó toda la cantidad de {$nom}" : "⚠️ Parte de {$nom} llegó dañada";
                    $pdo->exec("CREATE TABLE IF NOT EXISTS notif_app (
                        id INT AUTO_INCREMENT PRIMARY KEY, usuario VARCHAR(60) NOT NULL, notif_key VARCHAR(120) NOT NULL,
                        tipo VARCHAR(30) DEFAULT 'solicitud', titulo VARCHAR(200) NOT NULL, msg VARCHAR(400) DEFAULT '',
                        accion VARCHAR(60) DEFAULT '', fecha VARCHAR(40) DEFAULT '', leida TINYINT(1) DEFAULT 0,
                        creado_en DATETIME DEFAULT NOW(), UNIQUE KEY uq_usuario_key (usuario, notif_key))");
                    $pdo->prepare("INSERT IGNORE INTO notif_app (usuario, notif_key, tipo, titulo, msg, accion, fecha) VALUES (?,?,?,?,?,?,?)")
                        ->execute([$usuarioAviso, 'recogido_conteo_' . $id, 'stock', $titulo, mb_substr($resumen, 0, 400), '', date('c')]);
                    $dest = _notif_correoUsuario($pdo, $usuarioAviso);
                    if ($dest) {
                        _notif_enviar($dest['correo'], $dest['nombre'], $titulo,
                            "<p>Sobre el material recogido que devolviste (<strong>" . htmlspecialchars($nom) . "</strong>):</p>"
                            . "<p style='background:#FEF9E7;border-radius:8px;padding:12px;font-size:13px;'>" . htmlspecialchars($resumen) . "</p>"
                            . "<p style='font-size:13px;color:#64748B;'>Si crees que hay un error, habla con quien lo recibió en el almacén.</p>");
                    }
                    $notas = trim(($notas ? $notas . ' · ' : '') . '[Conteo] ' . $resumen);
                } catch (\Throwable $e) { error_log('[seguimiento/recogido aviso] ' . $e->getMessage()); }
            }
        } else {
            // Registro sin vínculo (datos viejos): comportamiento anterior
            if ($esReutilizable) {
                $prod = $pdo->prepare("SELECT id FROM productos WHERE ref = ?");
                $prod->execute([$s['ref_producto']]);
                $p = $prod->fetch();
                if ($p) {
                    if ($vaAlAlmacenRec) $pdo->prepare("UPDATE productos SET stock_recuperado = stock_recuperado + ? WHERE id = ?")->execute([$cant, $p['id']]);
                    else stockUsuarioAjustar($pdo, $p['id'], $_SESSION['usuario'] ?? '', $cant);
                }
            }
        }
    } elseif (($s['tipo'] ?? '') === 'ont_devolucion') {
        // ONT que vuelve — puede ser al almacén central (sin dueño, lista
        // para reasignar) O al municipio de un técnico (la toma quien la
        // confirma ahí, ej: el encargado de esa oficina).
        $vaAlmacen = strtolower(trim($s['destino'] ?? '')) === 'almacen central';
        $nuevoDuenio = $vaAlmacen ? null : ($_SESSION['usuario'] ?? null);
        // Si salió como no disponible/dañada, sigue así al llegar (no se
        // "arregla" sola por devolverla).
        $estadoLlegada = preg_match('/Estado previo:\s*no_disponible/', $s['notas'] ?? '') ? 'no_disponible' : 'disponible';
        if (!empty($s['referencia_id'])) {
            $pdo->prepare("
                UPDATE ont_seriales SET
                    estado = '{$estadoLlegada}',
                    tecnico_asignado = ?,
                    fecha_asignacion = " . ($nuevoDuenio ? 'NOW()' : 'NULL') . ",
                    asignacion_confirmada = NULL,
                    tecnico_instalador = NULL,
                    sede_actual = ?,
                    sede_id = NULL
                WHERE id = ?
            ")->execute([$nuevoDuenio, $s['destino'], (int)$s['referencia_id']]);
            try {
                $msgLog = $vaAlmacen ? 'Recibida de vuelta en el almacén central — disponible para reasignar' : "Recibida de vuelta en {$s['destino']} — asignada a {$nuevoDuenio}";
                _logOntHistorial($pdo, (int)$s['referencia_id'], 'recibida_almacen', $msgLog, $_SESSION['usuario'] ?? '');
            } catch (\Throwable $e) {}
        }
    } elseif ($esOnt) {
        // ONT normal que alguien recibe (solicitud/pedido/enviar directo) —
        // el dueño (tecnico_asignado) se fija AQUÍ, no antes: ni al
        // despachar ni al confirmar la entrega, para que el material solo
        // cuente como del destinatario cuando él de verdad confirma que
        // llegó. Se usa quien quedó guardado como destinatario al despachar
        // ("Destinatario ONT: X" en las notas); si por algo no quedó
        // guardado, se usa a quien está confirmando el recibido ahora mismo.
        $ontDuenioRec = $_SESSION['usuario'] ?? '';
        if (preg_match('/Destinatario ONT:\s*(.+)$/m', $s['notas'] ?? '', $mOntDuenio)) {
            $ontDuenioRec = trim($mOntDuenio[1]);
        }
        if (preg_match('/Seriales:\s*(.+)$/m', $s['notas'] ?? '', $mOntRec)) {
            $snsRec = array_values(array_filter(array_map('trim', explode(',', $mOntRec[1]))));
            if ($snsRec) {
                $ph = implode(',', array_fill(0, count($snsRec), '?'));
                try {
                    $pdo->prepare("UPDATE ont_seriales SET estado='disponible', tecnico_asignado=? WHERE sn IN ($ph) AND estado='despachada'")
                        ->execute(array_merge([$ontDuenioRec], $snsRec));
                } catch (\Throwable $e) { error_log('[seguimiento/recibido ont] ' . $e->getMessage()); }
            }
        }
    } elseif ($esEquipoSolicitud) {
        // Pedido de equipo (OLT/Mikrotik) vía "Pedir equipos" — al despachar
        // se reservó una unidad real específica (ver "EquipoIDs:" en las
        // notas, dejado por la acción 'en_camino'). Aquí, al confirmarse
        // recibido, esa unidad física se mueve de verdad a la sede destino
        // — igual que con un envío directo de OLT/Mikrotik — para que sí
        // aparezca en "Mis equipos" del destinatario.
        if (preg_match('/EquipoIDs:\s*([a-z]+):([0-9,]+)/', $s['notas'] ?? '', $mEq)) {
            $tablaEq = in_array($mEq[1], ['olts', 'mikrotiks'], true) ? $mEq[1] : null;
            if ($tablaEq) {
                $idsEq = array_values(array_filter(array_map('intval', explode(',', $mEq[2]))));
                if ($idsEq) {
                    // "Pedir equipos" es un pedido PERSONAL (el técnico lo
                    // pidió para él) — queda asignado solo a quien lo pidió,
                    // no "libre" para toda su oficina.
                    $asignarAPedido = $tieneDestinatarioEspecifico ? $destinatarioEspecificoNombre : null;
                    if (!$asignarAPedido && !empty($s['referencia_id'])) {
                        $qSolPed = null;
                        if (($s['tipo'] ?? '') === 'solicitud') {
                            $qSolPed = $pdo->prepare("SELECT solicitado_por FROM solicitudes WHERE id = ?");
                        } elseif (($s['tipo'] ?? '') === 'pedido') {
                            $qSolPed = $pdo->prepare("SELECT solicitado_por FROM pedidos_municipio WHERE id = ?");
                        }
                        if ($qSolPed) {
                            $qSolPed->execute([$s['referencia_id']]);
                            $asignarAPedido = $qSolPed->fetchColumn() ?: null;
                        }
                    }
                    if (!$asignarAPedido) { $asignarAPedido = $_SESSION['usuario'] ?? null; }
                    $ph = implode(',', array_fill(0, count($idsEq), '?'));
                    try {
                        $pdo->prepare("UPDATE $tablaEq SET sede=?, asignado_a=? WHERE id IN ($ph)")
                            ->execute(array_merge([$s['destino'], $asignarAPedido], $idsEq));
                    } catch (\Throwable $e) {
                        error_log('[seguimiento/recibido equipo-solicitud] ' . $e->getMessage());
                    }
                }
            }
        }
    } else {
        // Sumar stock al USUARIO que lo solicitó (ya no a la sede destino)
        $prod = $pdo->prepare("SELECT id, metros_por_unidad FROM productos WHERE ref = ?");
        $prod->execute([$s['ref_producto']]);
        $p = $prod->fetch();

        if ($p) {
            // Averiguar quién es el dueño real de este stock: el solicitante
            // original, sea que haya venido de una solicitud (individual o
            // parte de un pedido múltiple) o de un pedido directo de municipio.
            $usuarioReceptor = null;
            if (($s['tipo'] ?? '') === 'solicitud' && !empty($s['referencia_id'])) {
                $q = $pdo->prepare("SELECT solicitado_por FROM solicitudes WHERE id = ?");
                $q->execute([$s['referencia_id']]);
                $usuarioReceptor = $q->fetchColumn() ?: null;
            } elseif (($s['tipo'] ?? '') === 'pedido' && !empty($s['referencia_id'])) {
                $q = $pdo->prepare("SELECT solicitado_por FROM pedidos_municipio WHERE id = ?");
                $q->execute([$s['referencia_id']]);
                $usuarioReceptor = $q->fetchColumn() ?: null;
            }
            // Respaldo: si no se pudo identificar al solicitante, O si quien
            // "solicitó" resultó ser superadmin/distribuidor (así se guarda
            // un "Enviar directo" — el creador queda como solicitante, a
            // propósito, pero ninguno de los 2 tiene stock personal), se le
            // acredita a quien está confirmando la recepción ahora mismo.
            // Respaldo: si no se pudo identificar al solicitante, O si quien
            // "solicitó" resultó ser superadmin/distribuidor (así se guarda
            // un "Enviar directo" — el creador queda como solicitante, a
            // propósito, pero ninguno de los 2 tiene stock personal), se
            // busca primero si se eligió un destinatario específico al
            // crear el envío ("Recoge en persona: X" en las notas) — solo
            // si tampoco hay eso, se le acredita a quien confirma ahora
            // (ej: el transportador, si nadie más fue elegido).
            if ($usuarioReceptor) {
                $rolReceptor = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?");
                $rolReceptor->execute([$usuarioReceptor]);
                if (in_array($rolReceptor->fetchColumn(), ['superadmin', 'distribuidor'])) {
                    $usuarioReceptor = null;
                }
            }
            if (!$usuarioReceptor && preg_match('/Recoge en persona:\s*(.+)$/m', $s['notas'] ?? '', $mDest)) {
                $usuarioReceptor = trim($mDest[1]);
            }
            if (!$usuarioReceptor) $usuarioReceptor = $_SESSION['usuario'] ?? null;

            $cantidadDanada = min($cantidadDanada, $cant); // nunca más de lo que venía
            $cantidadUsable = $cant - $cantidadDanada;

            if ($usuarioReceptor && $cantidadUsable > 0) {
                stockUsuarioAjustar($pdo, $p['id'], $usuarioReceptor, $cantidadUsable);
                // Si es un producto "por rollo": si se eligió un rollo
                // ESPECÍFICO al enviar ("Rollo elegido: X" en notas), se
                // transfiere ESA MISMA fila (conserva su identidad/código,
                // igual que "enviar_carrete_completo" en fibra) — si no se
                // eligió ninguno en particular, se crea uno genérico nuevo
                // a nombre de quien recibe, como antes.
                if (!empty($p['metros_por_unidad'])) {
                    $rolloTransferido = false;
                    // Asignación directa persona-a-persona: se eligieron uno o
                    // varios rollos COMPLETOS específicos ("Rollos elegidos:
                    // 5,7" en notas, ver "asignar_a_persona") — quedaron
                    // "en_transito" al enviarse; aquí se les cambia de dueño
                    // y sede, conservando su identidad (mismo registro).
                    if (preg_match('/Rollos elegidos:\s*([\d,]+)/', $s['notas'] ?? '', $mRollosAsig)) {
                        $idsRollosAsig = array_values(array_filter(array_map('intval', explode(',', $mRollosAsig[1]))));
                        if ($idsRollosAsig) {
                            try {
                                $phA = implode(',', array_fill(0, count($idsRollosAsig), '?'));
                                $okUpdA = $pdo->prepare("
                                    UPDATE producto_rollos
                                    SET sede_nombre = ?, usuario_actual = ?, estado = 'disponible'
                                    WHERE id IN ($phA) AND estado = 'en_transito'
                                ")->execute([$s['destino'], $usuarioReceptor, ...$idsRollosAsig]);
                                $rolloTransferido = $okUpdA;
                            } catch (\Throwable $e) { error_log('[seguimiento/recibido rollos-asignados] ' . $e->getMessage()); }
                        }
                    }
                    if (!$rolloTransferido && preg_match('/Rollo elegido:\s*(\d+)/', $s['notas'] ?? '', $mRollo)) {
                        try {
                            $okUpd = $pdo->prepare("
                                UPDATE producto_rollos
                                SET sede_nombre = ?, usuario_actual = ?, estado = 'disponible'
                                WHERE id = ? AND sede_nombre = 'Almacen Central' AND usuario_actual IS NULL
                            ")->execute([$s['destino'], $usuarioReceptor, (int)$mRollo[1]]);
                            $rolloTransferido = $okUpd;
                        } catch (\Throwable $e) { error_log('[seguimiento/recibido rollo transferir] ' . $e->getMessage()); }
                    }
                    if (!$rolloTransferido) {
                        // Si se recibió más de un rollo de una vez (ej: pidió
                        // "2 unidades"), se crea UN ROLLO POR CADA UNO, no uno
                        // solo con el total combinado — así cada rollo se
                        // puede gastar/rastrear por separado, incluso si
                        // llegaron juntos en el mismo envío.
                        $metrosPorRollo = (float)$p['metros_por_unidad'];
                        $numRollos = $metrosPorRollo > 0 ? (int)round($cantidadUsable / $metrosPorRollo) : 1;
                        if ($numRollos < 1) $numRollos = 1;
                        try {
                            for ($i = 0; $i < $numRollos; $i++) {
                                $pdo->prepare("
                                    INSERT INTO producto_rollos (producto_id, metros, metros_usados, sede_nombre, usuario_actual, estado, registrado_por)
                                    VALUES (?, ?, 0, ?, ?, 'disponible', ?)
                                ")->execute([$p['id'], $metrosPorRollo, $s['destino'], $usuarioReceptor, $_SESSION['usuario'] ?? '']);
                            }
                        } catch (\Throwable $e) { error_log('[seguimiento/recibido rollo] ' . $e->getMessage()); }
                    }
                }
            }

            // Lo dañado NO se suma al inventario usable — queda su propio
            // registro separado, distinto de "gasto normal" o "recibido bien".
            if ($cantidadDanada > 0 && $usuarioReceptor) {
                try {
                    $pdo->prepare("
                        INSERT INTO historial (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha, usuario_destino)
                        VALUES (?, ?, ?, ?, 'unidad', ?, ?, 'aprobado', 0, 'dañado_recibido', NOW(), ?)
                    ")->execute([
                        $s['ref_producto'], $s['nombre_producto'], $usuarioReceptor, $cantidadDanada,
                        $usuarioReceptor, "Llegó dañado al recibir el pedido" . ($notas ? " — $notas" : ''), $usuarioReceptor,
                    ]);
                } catch (\Throwable $e) { error_log('[seguimiento/recibido dañado] '.$e->getMessage()); }
            }
        }
    }

    // Registrar en historial
    // Buscar quién aprobó la solicitud original (solo aplica a solicitudes reales)
    $aprobadoPor = $s['enviado_por'] ?? ''; // quien despachó
    if (!$esFibra && $s['tipo'] === 'solicitud' && !empty($s['referencia_id'])) {
        $stmtAprob = $pdo->prepare("SELECT aprobado_por FROM solicitudes WHERE id = ? LIMIT 1");
        $stmtAprob->execute([$s['referencia_id']]);
        $rowAprob = $stmtAprob->fetch();
        if ($rowAprob && !empty($rowAprob['aprobado_por'])) {
            $aprobadoPor = $rowAprob['aprobado_por'];
        }
    }
    // Transportador como enviado_por
    $transportadorNombre = str_starts_with($s['transportador']??'','EXT:')
        ? '🚛 '.substr($s['transportador'],4)
        : ($s['transportador'] ?? $s['enviado_por']);

    try {
        // INSERT tolerante: solo columnas que existan en la tabla historial.
        $hcolsInfo = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_ASSOC);
        $hcols = array_column($hcolsInfo, 'Field');
        // Detectar tipo de solicitud_id para no romper si es INT y el ref es texto.
        $solIdTipo = '';
        foreach ($hcolsInfo as $ci) { if ($ci['Field']==='solicitud_id') $solIdTipo = strtolower($ci['Type']); }
        $solIdVal = ($esFibra || $esOlt || $esMk || $s['tipo'] !== 'solicitud') ? null : $s['referencia_id'];
        // Si la columna es entera y el valor no es numérico (id tipo 'sol_...'), omitir.
        if ($solIdVal !== null && strpos($solIdTipo, 'int') !== false && !is_numeric($solIdVal)) {
            $solIdVal = null;
        }

        // pedido_agrupado_id real — para agrupar en el historial los ítems que
        // llegaron juntos en un mismo "Pedido múltiple" (igual que en Seguimiento),
        // sin depender de heurísticas de fecha/texto que pueden fallar.
        $pedidoAgrupadoIdVal = null;
        if ($s['tipo'] === 'solicitud' && !empty($s['referencia_id'])) {
            $stmtPag = $pdo->prepare("SELECT pedido_agrupado_id FROM solicitudes WHERE id = ? LIMIT 1");
            $stmtPag->execute([$s['referencia_id']]);
            $pedidoAgrupadoIdVal = $stmtPag->fetchColumn() ?: null;
        }
        if ($pedidoAgrupadoIdVal && !in_array('pedido_agrupado_id', $hcols)) {
            try {
                $pdo->exec("ALTER TABLE historial ADD COLUMN pedido_agrupado_id VARCHAR(64) NULL");
                $hcols[] = 'pedido_agrupado_id';
            } catch (\Throwable $e) { /* sin permiso de ALTER: seguimos sin agrupar este caso */ }
        }
        // Asegurar columna 'aprobado_por' para que la tabla del historial
        // pueda mostrar quién aprobó (antes solo quedaba en la descripción).
        if ($aprobadoPor && !in_array('aprobado_por', $hcols)) {
            try {
                $pdo->exec("ALTER TABLE historial ADD COLUMN aprobado_por VARCHAR(60) NULL");
                $hcols[] = 'aprobado_por';
            } catch (\Throwable $e) { /* sin permiso de ALTER */ }
        }

        // A quién corresponde este historial de verdad — el que solicitó
        // originalmente (si vino de una solicitud/pedido individual), no
        // solo la sede. Sin esto, el historial de alguien nuevo mostraría
        // lo de toda la oficina, no solo lo suyo.
        $usuarioDestinoHist = null;
        if ($s['tipo'] === 'solicitud' && !empty($s['referencia_id'])) {
            $stmtUD = $pdo->prepare("SELECT solicitado_por FROM solicitudes WHERE id = ? LIMIT 1");
            $stmtUD->execute([$s['referencia_id']]);
            $usuarioDestinoHist = $stmtUD->fetchColumn() ?: null;
        } elseif ($s['tipo'] === 'pedido' && !empty($s['referencia_id'])) {
            $stmtUD = $pdo->prepare("SELECT solicitado_por FROM pedidos_municipio WHERE id = ? LIMIT 1");
            $stmtUD->execute([$s['referencia_id']]);
            $usuarioDestinoHist = $stmtUD->fetchColumn() ?: null;
        }
        // Si quien "solicitó" resultó ser superadmin/distribuidor, es
        // porque así se guarda un "Enviar directo" (el creador queda como
        // solicitante a propósito) — ninguno de los 2 tiene stock
        // personal, así que NO cuenta como destinatario real; se anula
        // para que caiga al respaldo de abajo ("Recoge en persona").
        if ($usuarioDestinoHist) {
            $rolDestHist = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?");
            $rolDestHist->execute([$usuarioDestinoHist]);
            if (in_array($rolDestHist->fetchColumn(), ['superadmin', 'distribuidor'])) {
                $usuarioDestinoHist = null;
            }
        }
        // Envío directo sin solicitud de por medio (ej: fibra enviada
        // directo a una persona) — revisa si se eligió un destinatario
        // específico al crear el envío ("Recoge en persona: X" en notas).
        if (!$usuarioDestinoHist && preg_match('/Recoge en persona:\s*(.+)$/m', $s['notas'] ?? '', $mHistGen)) {
            $usuarioDestinoHist = trim($mHistGen[1]);
        }
        if ($usuarioDestinoHist && !in_array('usuario_destino', $hcols)) {
            try {
                $pdo->exec("ALTER TABLE historial ADD COLUMN usuario_destino VARCHAR(60) NULL");
                $hcols[] = 'usuario_destino';
            } catch (\Throwable $e) {}
        }

        // Devoluciones (stock, ONT, material recogido, fibra): el historial debe verlo
        // quien la recibe (usuario_destino = quien confirma) y quien la devolvió (enviado_por).
        $esDevHist = in_array(($s['tipo'] ?? ''), ['devolucion_stock','ont_devolucion','recogido'], true)
            || (($s['tipo'] ?? '') === 'fibra' && preg_match('/Devoluci[oó]n:\s*s[ií]/u', $s['notas'] ?? ''));
        // Material recogido: etiqueta (reutilizable / dañado) y proveedor, para el historial y el PDF.
        $recogidoTxt = '';
        if (($s['tipo'] ?? '') === 'recogido' && isset($cantR, $cantD)) {
            if ($cantR > 0 && $cantD > 0) $recogidoTxt = "Recogido reutilizable ($cantR) + dañado ($cantD)";
            elseif ($cantR > 0)           $recogidoTxt = "Recogido reutilizable";
            elseif ($cantD > 0)           $recogidoTxt = "Recogido dañado";
            else                          $recogidoTxt = "Recogido";
            $provRec = '';
            if (!empty($mrOrigen['es_nuevo'])) $provRec = trim((string)($mrOrigen['proveedor_nuevo'] ?? ''));
            if ($provRec === '') {
                try { $qpv = $pdo->prepare("SELECT proveedor FROM productos WHERE ref = ?"); $qpv->execute([$s['ref_producto']]); $provRec = trim((string)$qpv->fetchColumn()); } catch (\Throwable $e) {}
            }
            if ($provRec !== '') $recogidoTxt .= " · Proveedor: " . $provRec;
        }
        if ($esDevHist) {
            if (!$usuarioDestinoHist) $usuarioDestinoHist = $_SESSION['usuario'] ?? null;
            if (!in_array('usuario_destino', $hcols)) {
                try { $pdo->exec("ALTER TABLE historial ADD COLUMN usuario_destino VARCHAR(60) NULL"); $hcols[] = 'usuario_destino'; } catch (\Throwable $e) {}
            }
        }
        $hvals = [
            'ref'                => $s['ref_producto'],
            'nombre'             => $s['nombre_producto'],
            'destino'            => $s['destino'],
            'cantidad'           => $cant,
            'unidad_envio'       => $s['unidad'] ?? 'unidad',
            'enviado_por'        => ($esDevHist && !empty($s['enviado_por'])) ? $s['enviado_por'] : $transportadorNombre,
            'aprobado_por'       => $aprobadoPor ?: null,
            'descripcion'        => ($esDevHist ? "↩️ Devolución — " : "") . ($recogidoTxt !== '' ? explode(' · Proveedor: ', $recogidoTxt)[0] . " — " : "") . "Recibido en " . $s['destino'] . " · Entregado por: " . $transportadorNombre . ($aprobadoPor ? " · Aprobó: " . $aprobadoPor : "") . (strpos($s['notas'] ?? '', '[STOCK:recuperado]') !== false ? " · Stock: ♻️ Recuperado" : "") . (strpos($recogidoTxt, ' · Proveedor: ') !== false ? " · Proveedor: " . explode(' · Proveedor: ', $recogidoTxt, 2)[1] : ""),
            'estado'             => 'recibido',
            'es_gasto'           => 0,
            'origen'             => 'recibido',
            'solicitud_id'       => $solIdVal,
            'pedido_agrupado_id' => $pedidoAgrupadoIdVal,
            'usuario_destino'    => $usuarioDestinoHist,
        ];
        $hc = []; $hp = []; $hpar = [];
        foreach ($hvals as $col => $val) {
            if (in_array($col, $hcols)) { $hc[] = $col; $hp[] = '?'; $hpar[] = $val; }
        }
        if (in_array('fecha', $hcols)) { $hc[] = 'fecha'; $hp[] = 'NOW()'; }
        if ($hc) {
            $pdo->prepare("INSERT INTO historial (" . implode(',', $hc) . ") VALUES (" . implode(',', $hp) . ")")
                ->execute($hpar);
        }
    } catch (\Throwable $e) {
        error_log('[seguimiento/recibido historial] ' . $e->getMessage());
        // El historial no debe impedir confirmar la recepción.
    }

    // Actualizar seguimiento
    // Acumular notas
    $notaActual2 = $pdo->prepare("SELECT notas FROM envios_seguimiento WHERE id=?");
    $notaActual2->execute([$id]);
    $notaPrevia2 = trim($notaActual2->fetchColumn() ?? '');
    $notaFinal   = $notaPrevia2;
    if (!empty($notas)) $notaFinal = $notaPrevia2 ? $notaPrevia2 . "
[Recibido] " . $notas : "[Recibido] " . $notas;

    $pdo->prepare("UPDATE envios_seguimiento SET estado='recibido', recibido_por=?, notas=?, fecha_recibido=NOW() WHERE id=?")
        ->execute([$_SESSION['usuario'], $notaFinal, $id]);

    // Actualizar estado en tabla origen (solo solicitudes/pedidos reales)
    // OJO: aquí NO se toca aprobado_por — ese campo ya quedó bien guardado
    // desde el momento de la aprobación real; este paso es solo "llegó".
    if ($s['tipo'] === 'solicitud') {
        $pdo->prepare("UPDATE solicitudes SET estado='recibida' WHERE id=?")
            ->execute([$s['referencia_id']]);
    } elseif ($s['tipo'] === 'pedido') {
        $pdo->prepare("UPDATE pedidos_municipio SET estado='atendido' WHERE id=?")
            ->execute([$s['referencia_id']]);
    }

    try { auditar($pdo, 'recibido', 'seguimiento', "Envío recibido: {$s['nombre_producto']} en {$s['destino']}", $s['ref_producto']); }
    catch (\Throwable $e) { error_log('[seguimiento/recibido auditar] ' . $e->getMessage()); }
    try { notificarRecibido($pdo, $id); }
    catch (\Throwable $e) { error_log('[seguimiento/recibido notificar] ' . $e->getMessage()); }
    responder(['ok' => true]);
}

responder(['error' => 'Acción no reconocida'], 400);
