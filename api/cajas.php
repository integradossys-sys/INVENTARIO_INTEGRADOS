<?php
// Registrar errores en el log de PHP, nunca imprimirlos (rompen el JSON de respuesta).
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);
require 'config.php';
require_once 'auditoria.php';

/* Municipio/técnico/persona no pueden asignarle material al distribuidor ni al administrador: a ellos solo se les devuelve. */
if (!function_exists('destinoAsignablePorMi')) {
    function destinoAsignablePorMi($pdo, $aQuien) {
        if (!in_array($_SESSION['rol'] ?? '', ['municipio','tecnico','persona'], true)) return true;
        $st = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?");
        $st->execute([$aQuien]);
        return !in_array($st->fetchColumn(), ['superadmin','distribuidor'], true);
    }
}

/* Municipio/técnico/persona no pueden asignarle material al distribuidor ni al administrador: a ellos solo se les devuelve. */
if (!function_exists('destinoAsignablePorMi')) {
    function destinoAsignablePorMi($pdo, $aQuien) {
        if (!in_array($_SESSION['rol'] ?? '', ['municipio','tecnico','persona'], true)) return true;
        $st = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?");
        $st->execute([$aQuien]);
        return !in_array($st->fetchColumn(), ['superadmin','distribuidor'], true);
    }
}
require_once 'ont_sync.php';
require_once 'notificaciones.php';

$method   = $_SERVER['REQUEST_METHOD'];
$action   = $_GET['action'] ?? '';

/* ── Asegurar columnas necesarias en 'cajas' (la tabla se creó con
      nombres distintos a los que usa este código: 'nombre' en vez de
      'nombre_caja', 'sede' en vez de 'sede_nombre', y sin 'producto_id'
      en absoluto). Se agregan las que falten y se copian los datos
      existentes para no perder lo que ya había. ── */
try {
    $colsCajas = $pdo->query("SHOW COLUMNS FROM cajas")->fetchAll(PDO::FETCH_COLUMN);
    $faltantes = [
        'producto_id'  => "INT DEFAULT NULL",
        'producto_ref' => "VARCHAR(20) DEFAULT NULL",
        'nombre_caja'  => "VARCHAR(150) DEFAULT NULL",
        'pn'           => "VARCHAR(100) DEFAULT NULL",
        'descripcion'  => "TEXT",
        'sede_nombre'  => "VARCHAR(100) DEFAULT NULL",
        'total_onts'   => "INT DEFAULT 0",
    ];
    $agregadas = [];
    foreach ($faltantes as $col => $def) {
        if (!in_array($col, $colsCajas)) {
            $pdo->exec("ALTER TABLE cajas ADD COLUMN $col $def");
            $agregadas[] = $col;
        }
    }
    // Copiar datos viejos a las columnas nuevas, para las cajas que ya existían.
    if (in_array('nombre_caja', $agregadas) && in_array('nombre', $colsCajas)) {
        $pdo->exec("UPDATE cajas SET nombre_caja = nombre WHERE nombre_caja IS NULL");
    }
    if (in_array('sede_nombre', $agregadas) && in_array('sede', $colsCajas)) {
        $pdo->exec("UPDATE cajas SET sede_nombre = sede WHERE sede_nombre IS NULL");
    }
    // La tabla pudo tener columnas heredadas de otro uso (ej. 'codigo'),
    // marcadas obligatorias sin valor por defecto — se relajan todas las
    // que no sean 'id' ni las que ya llenamos nosotros, para que el
    // INSERT no truene por columnas que no nos interesan.
    $propiasCajas = ['id','nombre_caja','sede_id','sede_nombre','registrado_por','fecha','producto_id','producto_ref','pn','descripcion','total_onts','nombre','sede'];
    $infoCajas = $pdo->query("
        SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cajas'
    ")->fetchAll();
    foreach ($infoCajas as $c) {
        if (in_array($c['COLUMN_NAME'], $propiasCajas)) continue;
        if ($c['IS_NULLABLE'] === 'NO' && $c['COLUMN_DEFAULT'] === null) {
            try { $pdo->exec("ALTER TABLE cajas MODIFY `{$c['COLUMN_NAME']}` {$c['COLUMN_TYPE']} NULL DEFAULT NULL"); }
            catch (\Throwable $e) { error_log('[cajas/relajar columna] '.$e->getMessage()); }
        }
    }
} catch (\Throwable $e) { error_log('[cajas/columnas] '.$e->getMessage()); }

/* ── Asegurar columnas necesarias en 'ont_seriales' — le faltan casi
      todas las que usa el flujo de envío/instalación de ONTs, más las
      dos nuevas para el paso de "oficina asigna a técnico". ── */
try {
    $colsOnt = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
    $faltantesOnt = [
        'mac'                 => "VARCHAR(100) DEFAULT NULL",
        'mac_fmt'             => "VARCHAR(100) DEFAULT NULL",
        'sn'                  => "VARCHAR(100) DEFAULT NULL",
        'enviado_a'           => "VARCHAR(100) DEFAULT NULL",
        'enviado_por'         => "VARCHAR(60) DEFAULT NULL",
        'fecha_envio'         => "DATETIME DEFAULT NULL",
        'tecnico_asignado'    => "VARCHAR(60) DEFAULT NULL",
        'fecha_asignacion'    => "DATETIME DEFAULT NULL",
        'cliente_nombre'      => "VARCHAR(150) DEFAULT NULL",
        'cliente_direccion'   => "VARCHAR(250) DEFAULT NULL",
        'tecnico_instalacion' => "VARCHAR(60) DEFAULT NULL",
        'fecha_instalacion'   => "DATETIME DEFAULT NULL",
        'fecha_salida'        => "DATETIME DEFAULT NULL",
        'costo'               => "DECIMAL(12,2) DEFAULT NULL",
        'id_cliente_ext'      => "VARCHAR(30) DEFAULT NULL",
        'id_proveedor_ext'    => "VARCHAR(30) DEFAULT NULL",
        'fecha_ingreso'       => "DATE DEFAULT NULL",
        'motivo_dano'         => "VARCHAR(300) DEFAULT NULL",
    ];
    foreach ($faltantesOnt as $col => $def) {
        if (!in_array($col, $colsOnt)) {
            $pdo->exec("ALTER TABLE ont_seriales ADD COLUMN $col $def");
        }
    }
    // sn/serial: si el sistema ya usaba 'serial' como nombre original, se
    // copia a 'sn' para que el código nuevo (que usa 'sn') no vea todo vacío.
    if (in_array('serial', $colsOnt)) {
        $pdo->exec("UPDATE ont_seriales SET sn = serial WHERE (sn IS NULL OR sn = '') AND serial IS NOT NULL");
    }
    if (in_array('cliente', $colsOnt)) {
        $pdo->exec("UPDATE ont_seriales SET cliente_nombre = cliente WHERE (cliente_nombre IS NULL OR cliente_nombre='') AND cliente IS NOT NULL AND cliente != ''");
    }
    // La MAC ya no exige exactamente 12 caracteres — si estas columnas ya
    // existían con el tamaño viejo (VARCHAR 20/60), se agrandan.
    foreach (['mac' => 100, 'mac_fmt' => 100, 'sn' => 100] as $colAncho => $anchoMin) {
        if (in_array($colAncho, $colsOnt)) {
            try {
                $tipoActual = $pdo->query("SHOW COLUMNS FROM ont_seriales LIKE '$colAncho'")->fetch();
                if ($tipoActual && preg_match('/varchar\((\d+)\)/i', $tipoActual['Type'], $m) && (int)$m[1] < $anchoMin) {
                    $pdo->exec("ALTER TABLE ont_seriales MODIFY `$colAncho` VARCHAR($anchoMin) DEFAULT NULL");
                }
            } catch (\Throwable $e) { error_log("[ont_seriales/ensanchar $colAncho] " . $e->getMessage()); }
        }
    }
    // La tabla pudo tener columnas heredadas (ej. 'serial', 'estado' viejo,
    // etc.) marcadas obligatorias sin valor por defecto — se relajan todas
    // las que no sean 'id' ni las que ya llenamos nosotros.
    $propiasOnt = ['id','mac','mac_fmt','sn','estado','sede_actual','sede_id','registrado_por','modelo','marca',
        'caja_id','notas','fecha_registro','fecha_estado','enviado_a','enviado_por','fecha_envio',
        'tecnico_asignado','fecha_asignacion','cliente_nombre','cliente_direccion','tecnico_instalacion',
        'fecha_instalacion','fecha_salida','costo','id_cliente_ext','id_proveedor_ext','fecha_ingreso','motivo_dano','cliente'];
    $infoOnt = $pdo->query("
        SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ont_seriales'
    ")->fetchAll();
    foreach ($infoOnt as $c) {
        if (in_array($c['COLUMN_NAME'], $propiasOnt)) continue;
        if ($c['IS_NULLABLE'] === 'NO' && $c['COLUMN_DEFAULT'] === null) {
            try { $pdo->exec("ALTER TABLE ont_seriales MODIFY `{$c['COLUMN_NAME']}` {$c['COLUMN_TYPE']} NULL DEFAULT NULL"); }
            catch (\Throwable $e) { error_log('[ont_seriales/relajar columna] '.$e->getMessage()); }
        }
    }
    // Si 'estado' quedó como ENUM con una lista fija de valores viejos,
    // se convierte a texto libre para que acepte cualquier estado nuevo
    // (disponible, despachada, asignado, comodato, dañado, etc.).
    $colEstadoOnt = $pdo->query("SHOW COLUMNS FROM ont_seriales LIKE 'estado'")->fetch();
    if ($colEstadoOnt && stripos($colEstadoOnt['Type'], 'enum') === 0) {
        try { $pdo->exec("ALTER TABLE ont_seriales MODIFY estado VARCHAR(30) NOT NULL DEFAULT 'disponible'"); }
        catch (\Throwable $e) { error_log('[ont_seriales/estado enum] '.$e->getMessage()); }
    }
} catch (\Throwable $e) { error_log('[cajas/columnas ont_seriales] '.$e->getMessage()); }

/* ── Tabla de trazabilidad: cada paso importante de una ONT queda
      registrado aquí (enviada, recibida en oficina, asignada a técnico,
      instalada) para poder ver su historia completa por serial. ── */
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS ont_historial (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        ont_id      INT NOT NULL,
        evento      VARCHAR(40) NOT NULL,
        detalle     VARCHAR(300) DEFAULT '',
        usuario     VARCHAR(60) DEFAULT '',
        fecha       DATETIME DEFAULT NOW()
    )");
} catch (\Throwable $e) { error_log('[cajas/crear ont_historial] '.$e->getMessage()); }

/* Un SOLO renglón en el historial general por cada registro masivo de ONT
   ("Llegada de 200 ONT…"), en vez de nada (importaciones) o 200 renglones. */
function _historialLlegadaOnt($pdo, int $cantidad, string $modelo, string $origenTxt, string $nota = '', string $destino = 'Almacen Central') {
    if ($cantidad < 1) return;
    try {
        $nota = mb_substr(trim($nota), 0, 500);
        $desc = "Llegada de {$cantidad} ONT" . ($modelo !== '' ? " — modelo {$modelo}" : '') . " · {$origenTxt}" . ($nota !== '' ? " · Notas: {$nota}" : '');
        $pdo->prepare("INSERT INTO historial (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha)
            VALUES (?, ?, ?, ?, 'unidad', ?, ?, 'aprobado', 0, 'ingreso', NOW())")
            ->execute(['ONT', $modelo !== '' ? "ONT {$modelo}" : 'ONT', $destino, $cantidad, $_SESSION['usuario'] ?? '', $desc]);
    } catch (\Throwable $e) { error_log('[historialLlegadaOnt] ' . $e->getMessage()); }
}

function _logOntHistorial($pdo, $ontId, $evento, $detalle, $usuario) {
    try {
        $pdo->prepare("INSERT INTO ont_historial (ont_id, evento, detalle, usuario) VALUES (?,?,?,?)")
            ->execute([$ontId, $evento, $detalle, $usuario]);
    } catch (\Throwable $e) { error_log('[ont_historial/log] '.$e->getMessage()); }
}

// Descargar plantilla — embebida en base64, sin depender de archivos externos
if ($method === 'GET' && $action === 'plantilla_ont') {
    $b64 = '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';
    $data = base64_decode($b64);
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="ont_plantilla_importacion.xlsx"');
    header('Content-Length: ' . strlen($data));
    header('Cache-Control: no-cache');
    ob_clean();
    flush();
    echo $data;
    exit;
}

// Resto de endpoints requieren sesión
sesionRequerida();

$rawInput = file_get_contents('php://input');
$bodyData = json_decode($rawInput, true) ?? [];

/* ══════════════════════════════════════
   LISTAR cajas de un producto
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'listar_cajas') {
    $producto_id = intval($_GET['producto_id'] ?? 0);
    $params = [];
    $where  = ['1=1'];

    if ($producto_id) { $where[] = "c.producto_id = ?"; $params[] = $producto_id; }
    if (!empty($_GET['sede'])) { $where[] = "c.sede_nombre = ?"; $params[] = $_GET['sede']; }
    // Excluir cajas genéricas (importación, en uso, bodega)
    $where[] = "c.nombre_caja NOT LIKE 'ONTs en uso —%' AND c.nombre_caja NOT LIKE 'ONTs bodega —%' AND c.nombre_caja != 'ONTs importadas'";

    $sql = "SELECT c.*,
                COUNT(o.id) as total_registradas,
                SUM(o.estado='disponible') as disponibles,
                SUM(o.estado='despachada') as despachadas,
                SUM(o.estado='comodato')   as en_comodato,
                SUM(o.estado='ocupado')    as ocupados
            FROM cajas c
            LEFT JOIN ont_seriales o ON o.caja_id = c.id
            WHERE " . implode(' AND ', $where) . "
            GROUP BY c.id ORDER BY c.fecha DESC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    responder($stmt->fetchAll());
}

/* ══════════════════════════════════════
   LISTAR ONTs de una caja
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'listar_onts') {
    $caja_id = intval($_GET['caja_id'] ?? 0);
    if (!$caja_id) responder(['error' => 'caja_id requerido'], 400);

    $stmt = $pdo->prepare("SELECT * FROM ont_seriales WHERE caja_id = ? ORDER BY fecha ASC");
    $stmt->execute([$caja_id]);
    responder($stmt->fetchAll());
}

/* ══════════════════════════════════════
   CREAR caja nueva
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'crear_caja') {
    rolOPermiso(['superadmin'], 'registrar_ont');
    $data = $bodyData;

    $producto_id = intval($data['producto_id'] ?? 0);
    $nombre_caja = trim($data['nombre_caja'] ?? '');
    $pn          = trim($data['pn']          ?? '');
    $descripcion = trim($data['descripcion'] ?? '');
    $sede_nombre = $data['sede']             ?? 'Almacen Central';

    if (!$producto_id) responder(['error' => 'producto_id requerido'], 400);

    // Generar código único automático: CAJ-001, CAJ-002, etc.
    $pdo->beginTransaction();
    try {
        // Obtener y actualizar consecutivo de cajas
        $pdo->exec("INSERT INTO orden_consecutivo (tipo, ultimo) VALUES ('caja', 0)
                    ON DUPLICATE KEY UPDATE tipo=tipo");
        $pdo->exec("UPDATE orden_consecutivo SET ultimo = ultimo + 1 WHERE tipo = 'caja'");
        $consec = $pdo->query("SELECT ultimo FROM orden_consecutivo WHERE tipo = 'caja'")->fetchColumn();
        $codigo_caja = 'CAJ-' . str_pad($consec, 3, '0', STR_PAD_LEFT);

        // Auto-nombre si no se dio
        if (!$nombre_caja) {
            $prod = $pdo->prepare("SELECT nombre FROM productos WHERE id = ?");
            $prod->execute([$producto_id]);
            $p = $prod->fetch();
            $nombre_caja = ($p['nombre'] ?? 'Caja') . ' — Lote ' . $consec;
        }

        $sedeRow = $pdo->prepare("SELECT id FROM sedes WHERE nombre = ?");
        $sedeRow->execute([$sede_nombre]);
        $sede = $sedeRow->fetch();

        $stmt = $pdo->prepare("INSERT INTO cajas (producto_id, producto_ref, nombre_caja, pn, descripcion, sede_id, sede_nombre, registrado_por, codigo)
            SELECT id, ref, ?, ?, ?, ?, ?, ?, ? FROM productos WHERE id = ?");
        $stmt->execute([$nombre_caja, $pn, $descripcion, $sede['id'] ?? null, $sede_nombre, $_SESSION['usuario'], $codigo_caja, $producto_id]);

        $caja_id = $pdo->lastInsertId();
        $pdo->commit();
    } catch (\Throwable $e) {
        $pdo->rollBack();
        // Si falla por columna codigo inexistente, insertar sin ella
        $sedeRow2 = $pdo->prepare("SELECT id FROM sedes WHERE nombre = ?");
        $sedeRow2->execute([$sede_nombre]);
        $sede2 = $sedeRow2->fetch();
        $stmt2 = $pdo->prepare("INSERT INTO cajas (producto_id, producto_ref, nombre_caja, pn, descripcion, sede_id, sede_nombre, registrado_por)
            SELECT id, ref, ?, ?, ?, ?, ?, ? FROM productos WHERE id = ?");
        $stmt2->execute([$nombre_caja, $pn, $descripcion, $sede2['id'] ?? null, $sede_nombre, $_SESSION['usuario'], $producto_id]);
        $caja_id  = $pdo->lastInsertId();
        $codigo_caja = 'CAJ-' . str_pad($caja_id, 3, '0', STR_PAD_LEFT);
    }

    auditar($pdo, 'crear_caja', 'cajas', "Creada caja: $nombre_caja ($codigo_caja)", (string)$caja_id);
    responder(['ok' => true, 'caja_id' => $caja_id, 'nombre_caja' => $nombre_caja, 'codigo' => $codigo_caja]);
}

/* ══════════════════════════════════════
   AGREGAR ONT a una caja
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'agregar_ont') {
    // Municipio/técnico/persona pueden registrar ONT nuevas sin permiso aparte.
    rolOPermiso(['superadmin','municipio','tecnico','persona'], 'registrar_ont');
    $data = $bodyData;

    $caja_id = intval($data['caja_id'] ?? 0);
    $mac     = strtoupper(preg_replace('/[^A-Fa-f0-9]/', '', $data['mac'] ?? ''));
    $sn      = strtoupper(trim($data['sn'] ?? ''));

    // Ya no se exige elegir/crear una caja a mano: si no viene una, se usa
    // una caja interna genérica de registro (no aparece en los listados normales).
    if (!$caja_id) {
        $cRow = $pdo->query("SELECT id FROM cajas WHERE nombre_caja='ONTs importadas' LIMIT 1")->fetch();
        if ($cRow) {
            $caja_id = $cRow['id'];
        } else {
            $primeraSedeId = $pdo->query("SELECT id FROM sedes LIMIT 1")->fetchColumn() ?: null;
            $pdo->prepare("INSERT INTO cajas (nombre_caja, sede_id, sede_nombre, registrado_por) VALUES ('ONTs importadas',?,?,?)")
                ->execute([$primeraSedeId, 'Almacen Central', $_SESSION['usuario']]);
            $caja_id = $pdo->lastInsertId();
        }
    }

    if (strlen($mac) === 0) responder(['error' => 'MAC requerida'], 400);
    if (!$sn)           responder(['error' => 'SN requerido'], 400);
    if (empty(trim($data['fecha_ingreso'] ?? ''))) responder(['error' => 'La fecha de ingreso es obligatoria'], 400);

    // Formato MAC legible
    $mac_fmt = $mac; // sin separadores, solo dígitos

    // Verificar duplicado SN
    $dup = $pdo->prepare("SELECT id FROM ont_seriales WHERE sn = ?");
    $dup->execute([$sn]);
    if ($dup->fetch()) responder(['error' => "El SN $sn ya está registrado en el sistema"], 400);

    // Verificar duplicado MAC
    $dup2 = $pdo->prepare("SELECT id FROM ont_seriales WHERE mac = ?");
    $dup2->execute([$mac]);
    if ($dup2->fetch()) responder(['error' => "La MAC $mac_fmt ya está registrada"], 400);

    // Obtener producto_id de la caja
    $caja = $pdo->prepare("SELECT producto_id, sede_nombre FROM cajas WHERE id = ?");
    $caja->execute([$caja_id]);
    $c = $caja->fetch();
    if (!$c) responder(['error' => 'Caja no encontrada'], 404);

    $yaInstalada = !empty($data['ya_instalada']);

    // Campos nuevos
    $modelo       = trim($data['modelo'] ?? '');
    // Solo se aceptan modelos ya creados (módulo Modelos de ONT).
    if ($modelo === '') responder(['error' => 'Selecciona el modelo de la ONT'], 400);
    $stMod = $pdo->prepare("SELECT 1 FROM modelos_ont WHERE nombre = ? LIMIT 1");
    $stMod->execute([$modelo]);
    if (!$stMod->fetchColumn()) responder(['error' => 'Ese modelo no existe. Elige uno de la lista de modelos creados.'], 400);
    $estadoSel    = trim($data['estado'] ?? '');
    $fechaIngreso = trim($data['fecha_ingreso'] ?? '');
    $fechaSalida  = trim($data['fecha_salida'] ?? '');

    // Determinar el estado final: si está instalada → comodato; si no, el que eligió el usuario.
    $estadosOk = ['disponible', 'no_disponible', 'comodato', 'instalado', 'dañado', 'devuelto', 'recuperado', 'de_baja'];
    if ($yaInstalada) {
        $estadoFinal = 'comodato';
    } else {
        $estadoFinal = in_array($estadoSel, $estadosOk) ? $estadoSel : 'disponible';
    }

    // INSERT tolerante: solo columnas que existan en la tabla.
    $cols = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
    $vals = [
        'caja_id'             => $caja_id,
        'mac'                 => $mac,
        'mac_fmt'             => $mac_fmt,
        'sn'                  => $sn,
        'estado'              => $estadoFinal,
        'sede_actual'         => $c['sede_nombre'],
        'registrado_por'      => $_SESSION['usuario'] ?? '',
        'modelo'              => $modelo ?: null,
        'cliente_nombre'      => $yaInstalada ? ($data['cliente_nombre'] ?? null) : null,
        'cliente_direccion'   => $yaInstalada ? ($data['cliente_direccion'] ?? null) : null,
        'tecnico_instalacion' => $yaInstalada ? ($data['tecnico_instalacion'] ?? null) : null,
        'fecha_instalacion'   => $yaInstalada ? ($data['fecha_instalacion'] ?? null) : null,
        'fecha_ingreso'       => $fechaIngreso ?: null,
        'fecha_salida'        => $fechaSalida ?: null,
        'motivo_dano'         => trim($data['motivo_dano'] ?? '') ?: null,
        // Si la registra un municipio/técnico/persona, queda a su nombre (la ve en "Mis equipos").
        'tecnico_asignado'    => in_array($_SESSION['rol'] ?? '', ['municipio','tecnico','persona'], true) ? ($_SESSION['usuario'] ?? null) : null,
    ];
    $cc = []; $pp = []; $par = [];
    foreach ($vals as $col => $val) {
        if (in_array($col, $cols)) { $cc[] = $col; $pp[] = '?'; $par[] = $val; }
    }
    $pdo->prepare("INSERT INTO ont_seriales (" . implode(',', $cc) . ") VALUES (" . implode(',', $pp) . ")")
        ->execute($par);

    $ont_id = $pdo->lastInsertId();

    // Actualizar contador de la caja (no crítico — si falla, no debe tumbar el registro)
    try {
        $pdo->prepare("UPDATE cajas SET total_onts = (SELECT COUNT(*) FROM ont_seriales WHERE caja_id = ?) WHERE id = ?")
            ->execute([$caja_id, $caja_id]);
    } catch (\Throwable $e) { error_log('[agregar_ont/total_onts] '.$e->getMessage()); }

    // No modificar stock de productos al registrar ONT individual

    // Registrar en historial (no crítico — la caja genérica no tiene producto asociado)
    try {
        $refHist = $modelo ?: 'ONT';
        $nombreHist = $modelo ?: 'ONT sin modelo';
        if (!empty($c['producto_id'])) {
            $prod = $pdo->prepare("SELECT ref, nombre FROM productos WHERE id = ?");
            $prod->execute([$c['producto_id']]);
            $p = $prod->fetch();
            if ($p) { $refHist = $p['ref']; $nombreHist = $p['nombre']; }
        }
        $pdo->prepare("INSERT INTO historial (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha)
            VALUES (?, ?, 'Almacen Central', 1, 'unidad', ?, ?, 'aprobado', 0, 'ingreso', NOW())")
            ->execute([$refHist, $nombreHist, $_SESSION['usuario'],
                       "Ingreso ONT — MAC: $mac_fmt · SN: $sn"]);
    } catch (\Throwable $e) { error_log('[agregar_ont/historial] '.$e->getMessage()); }

    ontSincronizarStock($pdo, $modelo);

    _logOntHistorial($pdo, $ont_id, 'registrada', "Ingresó al sistema — Estado: $estadoSel" . ($yaInstalada?" · Cliente: " . ($data['cliente_nombre'] ?? ''):''), $_SESSION['usuario'] ?? '');

    auditar($pdo, 'agregar_ont', 'ont_seriales', "Registrada ONT: {$modelo} — SN {$sn}", (string)$ont_id);
    responder(['ok' => true, 'id' => $ont_id, 'mac' => $mac, 'mac_fmt' => $mac_fmt, 'caja_id' => $caja_id]);
}

/* ══════════════════════════════════════
   ENVIAR ONT a un municipio
   Cambia estado a 'despachada'
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'enviar_ont') {
    rolOPermiso(['superadmin'], 'despachar');
    $data    = $bodyData;
    $ont_id  = intval($data['ont_id']  ?? 0);
    $destino = trim($data['destino']   ?? '');

    if (!$ont_id || !$destino) responder(['error' => 'ont_id y destino requeridos'], 400);

    try {
        // LEFT JOIN para no fallar si la ONT no tiene caja/producto asociado.
        $ont = $pdo->prepare("SELECT o.*, c.producto_id, p.ref, p.nombre
            FROM ont_seriales o
            LEFT JOIN cajas c ON c.id = o.caja_id
            LEFT JOIN productos p ON p.id = c.producto_id
            WHERE o.id = ?");
        $ont->execute([$ont_id]);
        $o = $ont->fetch();

        if (!$o)                            responder(['error' => 'ONT no encontrada'], 404);
        if (strtolower(trim($o['estado'] ?? '')) !== 'disponible') responder(['error' => 'Esta ONT no está disponible (estado: '.($o['estado'] ?? '').')'], 400);

        // Cambiar estado — 'fecha_salida' se pone sola aquí, es cuando de verdad sale del almacén.
        $pdo->prepare("UPDATE ont_seriales SET estado='despachada', enviado_a=?, enviado_por=?, fecha_envio=NOW(), fecha_salida=COALESCE(fecha_salida, NOW()), sede_actual=? WHERE id=?")
            ->execute([$destino, $_SESSION['usuario'], $destino, $ont_id]);

        // Sumar stock en la sede destino (solo si hay producto y sede)
        $sedeRow = $pdo->prepare("SELECT id FROM sedes WHERE nombre=?");
        $sedeRow->execute([$destino]);
        $sede = $sedeRow->fetch();
        if ($sede && !empty($o['producto_id'])) {
            $pdo->prepare("INSERT INTO stock_sedes (producto_id, sede_id, cantidad) VALUES (?,?,1)
                ON DUPLICATE KEY UPDATE cantidad=cantidad+1")
                ->execute([$o['producto_id'], $sede['id']]);
        }

        // Historial
        $pdo->prepare("INSERT INTO historial (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha)
            VALUES (?,?,?,1,'unidad',?,?,'aprobado',0,'directo',NOW())")
            ->execute([
                $o['ref'] ?? 'ONT',
                $o['nombre'] ?? 'ONT',
                $destino, $_SESSION['usuario'],
                "ONT enviada — MAC: {$o['mac']} · SN: {$o['sn']}"
            ]);

        // Seguimiento (en camino → entregado → recibido)
        try {
            $origen = $_SESSION['sede'] ?? 'Almacen Central';
            $pdo->prepare("INSERT INTO envios_seguimiento
                (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, estado, notas, fecha_aprobado)
                VALUES ('ont', ?, ?, ?, 1, 'unidad', ?, ?, ?, 'aprobado', ?, NOW())")
                ->execute([
                    $ont_id, $o['ref'] ?? 'ONT', ($o['nombre'] ?? 'ONT')." — SN: {$o['sn']}",
                    $origen, $destino, $_SESSION['usuario'] ?? '',
                    "ONT enviada a $destino — MAC: {$o['mac']} · SN: {$o['sn']}"
                ]);
        } catch (\Throwable $e) { error_log('[enviar_ont/seguimiento] '.$e->getMessage()); }

        _logOntHistorial($pdo, $ont_id, 'enviada', "Enviada a $destino", $_SESSION['usuario'] ?? '');
        ontSincronizarStock($pdo, $o['modelo'] ?? '');

        auditar($pdo, 'enviar_ont', 'ont_seriales', "Enviada ONT SN {$o['sn']} a $destino", (string)$ont_id);
        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[enviar_ont] '.$e->getMessage());
        responder(['error' => 'No se pudo enviar: '.$e->getMessage()], 500);
    }
}

/* ══════════════════════════════════════
   ENVIAR VARIAS ONTs EN LOTE
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'enviar_onts_lote') {
    rolOPermiso(['superadmin'], 'despachar');
    $data    = $bodyData;
    $ont_ids = $data['ont_ids'] ?? [];
    $destino = trim($data['destino'] ?? '');

    if (!is_array($ont_ids) || !count($ont_ids)) responder(['error' => 'No se recibieron ONTs para enviar'], 400);
    if (!$destino) responder(['error' => 'Selecciona un municipio destino'], 400);

    // Sanear a enteros
    $ids = array_values(array_filter(array_map('intval', $ont_ids)));
    if (!count($ids)) responder(['error' => 'IDs de ONT inválidos'], 400);

    // Resolver la sede destino una sola vez
    $sedeRow = $pdo->prepare("SELECT id FROM sedes WHERE nombre = ?");
    $sedeRow->execute([$destino]);
    $sede = $sedeRow->fetch();

    $enviadas = 0; $omitidas = 0; $errores = [];
    $enviadasInfo = []; // datos de las ONTs enviadas (para agrupar)
    $colMod = in_array('modelo', $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN));

    foreach ($ids as $ont_id) {
        try {
            // Traer la ONT (con modelo propio si existe)
            $ont = $pdo->prepare("SELECT o.*, c.producto_id FROM ont_seriales o
                LEFT JOIN cajas c ON c.id = o.caja_id WHERE o.id = ?");
            $ont->execute([$ont_id]);
            $o = $ont->fetch();

            if (!$o) { $omitidas++; $errores[] = "ONT #$ont_id no encontrada"; continue; }
            $estadoNorm = strtolower(trim($o['estado'] ?? ''));
            if ($estadoNorm !== 'disponible') {
                $omitidas++;
                $errores[] = "ONT #$ont_id (SN {$o['sn']}): estado actual \"" . ($o['estado'] ?? '') . "\", solo se pueden enviar las disponibles";
                continue;
            }

            // Cambiar estado a despachada (solo columnas que existan)
            $colsOnt = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
            $setParts = ["estado='despachada'"]; $setParams = [];
            if (in_array('enviado_a', $colsOnt))   { $setParts[] = "enviado_a=?";   $setParams[] = $destino; }
            if (in_array('enviado_por', $colsOnt)) { $setParts[] = "enviado_por=?"; $setParams[] = $_SESSION['usuario'] ?? ''; }
            if (in_array('fecha_envio', $colsOnt)) { $setParts[] = "fecha_envio=NOW()"; }
            if (in_array('sede_actual', $colsOnt)) { $setParts[] = "sede_actual=?"; $setParams[] = $destino; }
            $setParams[] = $ont_id;
            $pdo->prepare("UPDATE ont_seriales SET " . implode(', ', $setParts) . " WHERE id=?")->execute($setParams);

            // Sumar stock en la sede destino (solo si hay producto y sede)
            if ($sede && !empty($o['producto_id'])) {
                try {
                    $pdo->prepare("INSERT INTO stock_sedes (producto_id, sede_id, cantidad) VALUES (?,?,1)
                        ON DUPLICATE KEY UPDATE cantidad=cantidad+1")
                        ->execute([$o['producto_id'], $sede['id']]);
                } catch (\Throwable $e) { error_log('[enviar_onts_lote/stock] '.$e->getMessage()); }
            }

            // Guardar info para el registro agrupado
            $modeloOnt = ($colMod && trim($o['modelo'] ?? '') !== '') ? trim($o['modelo']) : 'ONT';
            $enviadasInfo[] = ['id'=>$ont_id, 'sn'=>$o['sn'], 'mac'=>$o['mac'], 'modelo'=>$modeloOnt];
            $enviadas++;
        } catch (\Throwable $e) {
            $omitidas++;
            $errores[] = "ONT #$ont_id: " . $e->getMessage();
            error_log('[enviar_onts_lote/ont] '.$e->getMessage());
        }
    }

    // ── Crear UN solo registro agrupado en seguimiento e historial ──
    if ($enviadas > 0) {
        // Determinar el nombre: si todas son del mismo modelo → "ONT Modelo (xN)"; si no → "ONTs varias (xN)"
        $modelosUnicos = array_values(array_unique(array_map(fn($x)=>$x['modelo'], $enviadasInfo)));
        $nombreGrupo = (count($modelosUnicos) === 1)
            ? "ONT {$modelosUnicos[0]} (x$enviadas)"
            : "ONTs varias (x$enviadas)";
        // Detalle de seriales para las notas
        $listaSn = implode(', ', array_map(fn($x)=>$x['sn'], $enviadasInfo));
        $origen  = $_SESSION['sede'] ?? 'Almacen Central';
        $refGrupo = 'lote_'.uniqid();

        // Seguimiento (un registro, cantidad = total)
        try {
            $pdo->prepare("INSERT INTO envios_seguimiento
                (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, estado, notas, fecha_aprobado)
                VALUES ('ont', ?, 'ONT', ?, ?, 'unidad', ?, ?, ?, 'aprobado', ?, NOW())")
                ->execute([
                    $refGrupo, $nombreGrupo, $enviadas, $origen, $destino,
                    $_SESSION['usuario'] ?? '',
                    "$enviadas ONT(s) enviadas a $destino. Seriales: $listaSn"
                ]);
        } catch (\Throwable $e) { error_log('[enviar_onts_lote/seguimiento] '.$e->getMessage()); }

        // Historial (un registro, cantidad = total)
        try {
            $colsHist = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN);
            $hVals = [
                'ref'          => 'ONT',
                'nombre'       => $nombreGrupo,
                'destino'      => $destino,
                'cantidad'     => $enviadas,
                'unidad_envio' => 'unidad',
                'enviado_por'  => $_SESSION['usuario'] ?? '',
                'descripcion'  => "$enviadas ONT(s) enviadas a $destino. Seriales: $listaSn",
                'estado'       => 'aprobado',
                'es_gasto'     => 0,
                'origen'       => 'directo',
            ];
            $hc = []; $hp = []; $hpar = [];
            foreach ($hVals as $col => $val) {
                if (in_array($col, $colsHist)) { $hc[] = $col; $hp[] = '?'; $hpar[] = $val; }
            }
            if (in_array('fecha', $colsHist)) { $hc[] = 'fecha'; $hp[] = 'NOW()'; }
            if ($hc) {
                $pdo->prepare("INSERT INTO historial (" . implode(',', $hc) . ") VALUES (" . implode(',', $hp) . ")")
                    ->execute($hpar);
            }
        } catch (\Throwable $e) { error_log('[enviar_onts_lote/hist] '.$e->getMessage()); }
    }

    try { auditar($pdo, 'enviar', 'ont_seriales', "Envío en lote de $enviadas ONT(s) a $destino", ''); }
    catch (\Throwable $e) { error_log('[enviar_onts_lote/auditar] '.$e->getMessage()); }

    foreach (array_unique(array_map(fn($x)=>$x['modelo'], $enviadasInfo)) as $m) { ontSincronizarStock($pdo, $m); }

    responder([
        'ok' => true,
        'enviadas' => $enviadas,
        'omitidas' => $omitidas,
        'errores' => array_slice($errores, 0, 5)
    ]);
}
if ($method === 'POST' && $action === 'marcar_danada') {
    rolRequerido('superadmin');
    $data   = $bodyData;
    $ont_id = intval($data['ont_id'] ?? 0);
    if (!$ont_id) responder(['error' => 'ont_id requerido'], 400);

    $ont = $pdo->prepare("SELECT o.*, c.producto_id FROM ont_seriales o JOIN cajas c ON c.id=o.caja_id WHERE o.id=?");
    $ont->execute([$ont_id]);
    $o = $ont->fetch();
    if (!$o) responder(['error' => 'ONT no encontrada'], 404);

    $pdo->prepare("UPDATE ont_seriales SET estado='dañado' WHERE id=?")->execute([$ont_id]);
    ontSincronizarStock($pdo, $o['modelo'] ?? '');
    _logOntHistorial($pdo, $ont_id, 'dañada', "Se marcó como dañada (estaba: {$o['estado']})", $_SESSION['usuario'] ?? '');

    if ($o['estado'] === 'disponible') {
    // (desactivado intencionalmente: no se resta de Neiva)
    // $pdo->prepare("UPDATE productos SET stock_neiva=GREATEST(0,stock_neiva-1) WHERE id=?")
    //     ->execute([$o['producto_id']]);
    }

    auditar($pdo, 'marcar_danada', 'ont_seriales', "Marcada ONT como dañada — SN {$o['sn']} (estaba: {$o['estado']})", (string)$ont_id);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   ELIMINAR caja completa
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'eliminar_caja') {
    rolOPermiso(['superadmin'], 'eliminar_ont_masivo');
    $data    = $bodyData;
    $caja_id = intval($data['caja_id'] ?? 0);
    if (!$caja_id) responder(['error' => 'caja_id requerido'], 400);

    // Restar del stock las unidades disponibles
    $disp = $pdo->prepare("SELECT COUNT(*) FROM ont_seriales WHERE caja_id=? AND estado='disponible'");
    $disp->execute([$caja_id]);
    $n = $disp->fetchColumn();

    $prod = $pdo->prepare("SELECT producto_id, nombre_caja, codigo FROM cajas WHERE id=?");
    $prod->execute([$caja_id]);
    $c = $prod->fetch();
    if ($c && $n > 0) {
    // (desactivado intencionalmente: no se resta de Neiva)
    // $pdo->prepare("UPDATE productos SET stock_neiva=GREATEST(0,stock_neiva-?) WHERE id=?")
    //     ->execute([$n, $c['producto_id']]);
    }

    // Borrar primero las ONTs de la caja (no depender de ON DELETE CASCADE,
    // que puede no estar definido en la BD y dejaría ONTs huérfanas).
    $pdo->prepare("DELETE FROM ont_seriales WHERE caja_id=?")->execute([$caja_id]);
    $pdo->prepare("DELETE FROM cajas WHERE id=?")->execute([$caja_id]);
    auditar($pdo, 'eliminar_caja', 'cajas', "Eliminada caja: " . ($c['nombre_caja'] ?? '') . " (" . ($c['codigo'] ?? '') . ") — {$n} ONT disponibles perdidas", (string)$caja_id);
    responder(['ok' => true]);
}

/* ══ EDITAR ONT EN USO ══ */
if ($method === 'POST' && $action === 'editar_ont_en_uso') {
    sesionRequerida();
    $data    = $bodyData;
    $id      = intval($data['id'] ?? 0);
    if(!$id) responder(['error'=>'ID requerido'],400);
    $modeloAntes = $pdo->prepare("SELECT modelo, estado, tecnico_asignado, tecnico_instalador FROM ont_seriales WHERE id = ?");
    $modeloAntes->execute([$id]);
    $rowAntes  = $modeloAntes->fetch();
    if (!$rowAntes) responder(['error' => 'ONT no encontrada'], 404);

    // ¿Quién puede editarla? Una vez instalada (comodato), solo la oficina que
    // se la asignó al técnico/persona (y el admin). Antes de instalar, también
    // quien la tiene o la va a instalar.
    $miUsuarioEd = $_SESSION['usuario'] ?? '';
    if (!in_array($_SESSION['rol'] ?? '', ['superadmin','distribuidor'], true)) {
        // ¿Esta ONT la asignó alguien (oficina)? ¿Fui yo?
        $qa = $pdo->prepare("SELECT DISTINCT usuario FROM ont_historial WHERE ont_id = ? AND (evento = 'asignada' OR (evento = 'reasignada' AND detalle LIKE 'Propuesta como instalador%'))");
        $qa->execute([$id]);
        $asignadores = $qa->fetchAll(PDO::FETCH_COLUMN);
        // También cuenta quien la despachó desde Seguimiento (asignaciones que no dejaron evento en la trazabilidad)
        $qs = $pdo->prepare("SELECT DISTINCT enviado_por FROM envios_seguimiento WHERE tipo = 'asignacion' AND referencia_id = ? AND ref_producto LIKE 'ONT::%'");
        $qs->execute([$id]);
        $asignadores = array_values(array_unique(array_merge($asignadores, array_filter($qs->fetchAll(PDO::FETCH_COLUMN)))));
        $yoLaAsigne  = in_array($miUsuarioEd, $asignadores, true);
        if (($rowAntes['estado'] ?? '') === 'comodato' && $asignadores) {
            $puedeEd = $yoLaAsigne;
            $msgEd = 'Esta ONT ya está instalada: solo la oficina que se la asignó al técnico puede editarla';
        } else {
            $puedeEd = $yoLaAsigne
                || ($rowAntes['tecnico_asignado'] === $miUsuarioEd)
                || ($rowAntes['tecnico_instalador'] === $miUsuarioEd);
            $msgEd = 'No tienes permiso para editar esta ONT';
        }
        if (!$puedeEd) responder(['error' => $msgEd], 403);
    }
    $modeloOnt = $rowAntes['modelo'] ?? null;
    $estadoAntes = $rowAntes['estado'] ?? null;

    // MAC/SN nuevos (si vienen) — se limpian y se valida que no choquen con otra ONT.
    $macNueva = isset($data['mac']) ? strtoupper(preg_replace('/[^A-Fa-f0-9]/', '', $data['mac'])) : null;
    $snNuevo  = isset($data['sn']) ? strtoupper(trim($data['sn'])) : null;
    if ($macNueva !== null && $macNueva !== '') {
        $chkMac = $pdo->prepare("SELECT id FROM ont_seriales WHERE mac = ? AND id != ?");
        $chkMac->execute([$macNueva, $id]);
        if ($chkMac->fetch()) responder(['error' => 'Esa MAC ya está registrada en otra ONT'], 400);
    }
    if ($snNuevo !== null && $snNuevo !== '') {
        $chkSn = $pdo->prepare("SELECT id FROM ont_seriales WHERE sn = ? AND id != ?");
        $chkSn->execute([$snNuevo, $id]);
        if ($chkSn->fetch()) responder(['error' => 'Ese SN ya está registrado en otra ONT'], 400);
    }
    $modeloNuevo = isset($data['modelo']) ? trim($data['modelo']) : null;

    $fecha  = !empty($data['fecha_instalacion']) ? $data['fecha_instalacion'] : null;
    $motivoDano = trim($data['motivo_dano'] ?? '') ?: null;
    $permitidos = ['disponible','despachada','asignado','comodato','ocupado','dañado','no_disponible','vendido','sin_asignar'];
    $estado = in_array($data['estado']??'', $permitidos) ? $data['estado'] : null;

    $sets = ['cliente_nombre=?', 'cliente_direccion=?', 'tecnico_instalacion=?', 'proveedor=?', 'fecha_instalacion=?', 'motivo_dano=?'];
    $params = [$data['cliente_nombre']??null, $data['cliente_direccion']??null, $data['tecnico_instalacion']??null, trim($data['proveedor']??'') ?: null, $fecha, $motivoDano];
    // Si se está cambiando quién instaló, aplica la misma regla que
    // "Instalar": si es otra persona (no quien edita), queda pendiente de
    // que ella lo confirme — no se puede simplemente escribir un nombre.
    // Quien instaló es fijo: si la ONT ya tiene instalador registrado no se cambia
    // (ni se vuelve a pedir confirmación) al editar los demás datos.
    $instaloAntes = trim((string)$pdo->query("SELECT tecnico_instalacion FROM ont_seriales WHERE id = " . intval($id))->fetchColumn());
    if ($instaloAntes !== '') {
        $params[2] = $instaloAntes;
    } elseif (array_key_exists('tecnico_instalacion', $data)) {
        $tecInstNuevo = trim($data['tecnico_instalacion'] ?? '');
        if ($tecInstNuevo !== '') {
            $sets[] = 'instalacion_confirmada=?';
            $params[] = ($tecInstNuevo === ($_SESSION['usuario'] ?? '')) ? 'confirmada' : 'pendiente';
        }
    }
    if (!empty(trim($data['sede_actual'] ?? ''))) { $sets[] = 'sede_actual=?'; $params[] = trim($data['sede_actual']); }
    if ($estado !== null)              { $sets[] = 'estado=?';  $params[] = $estado; }
    if ($modeloNuevo !== null)         { $sets[] = 'modelo=?';  $params[] = $modeloNuevo ?: null; }
    if ($macNueva !== null && $macNueva !== '') {
        $macFmtNueva = $macNueva; // sin separadores
        $sets[] = 'mac=?'; $params[] = $macNueva;
        $sets[] = 'mac_fmt=?'; $params[] = $macFmtNueva;
    }
    if ($snNuevo !== null && $snNuevo !== '') { $sets[] = 'sn=?'; $params[] = $snNuevo; }
    $params[] = $id;

    require_once __DIR__ . '/retiro_proyecto_lib.php';
    retirarOntDeCliente($pdo, $id, $estadoAntes, $estado, $_SESSION['usuario'] ?? '');
    $pdo->prepare("UPDATE ont_seriales SET " . implode(', ', $sets) . " WHERE id=?")->execute($params);

    // Dejar rastro en la trazabilidad si el estado cambió de verdad (ej:
    // disponible → comodato hecho a mano desde "Editar", sin pasar por el
    // flujo formal de "Instalar").
    if ($estado !== null && $estado !== $estadoAntes) {
        $etiquetas = [
            'disponible'    => 'Disponible', 'despachada' => 'Despachada',
            'asignado'      => 'Asignada',   'comodato'   => 'Comodato',
            'ocupado'       => 'Ocupada',    'dañado'     => 'Dañada',
            'no_disponible' => 'No disponible', 'vendido' => 'Vendida',
            'sin_asignar'   => 'Sin asignar',
        ];
        $labelAntes = $etiquetas[$estadoAntes] ?? ($estadoAntes ?: '—');
        $labelNuevo = $etiquetas[$estado] ?? $estado;
        $detalleCambio = "Estado cambiado de \"$labelAntes\" a \"$labelNuevo\" (editado a mano)";
        if ($estado === 'comodato' && !empty($data['cliente_nombre'])) {
            $detalleCambio .= " — Cliente: " . trim($data['cliente_nombre']);
        }
        if ($estado === 'dañado' || $estado === 'no_disponible') {
            if ($motivoDano) $detalleCambio .= " — Motivo: $motivoDano";
        }
        try { _logOntHistorial($pdo, $id, 'editado', $detalleCambio, $_SESSION['usuario'] ?? ''); }
        catch (\Throwable $e) { error_log('[editar_ont_en_uso/trazabilidad] '.$e->getMessage()); }
    }

    ontSincronizarStock($pdo, $modeloOnt);
    if ($modeloNuevo !== null && $modeloNuevo !== $modeloOnt) ontSincronizarStock($pdo, $modeloNuevo);
    auditar($pdo, 'editar_ont_en_uso', 'ont_seriales', "Editada ONT (id {$id})" . ($estado !== null && $estado !== $estadoAntes ? " — estado: {$estadoAntes} → {$estado}" : ''), (string)$id);
    responder(['ok'=>true]);
}

/* Motivo por el que una ONT NO se puede eliminar todavía (null = se puede). */
function _ontBloqueoEliminar(array $r): ?string {
    $fin = ' Primero déjala DISPONIBLE (devuélvela al almacén y que la reciban) y después podrás eliminarla.';
    if ($r['estado'] === 'comodato') return 'Está en comodato, instalada en "' . ($r['cliente_nombre'] ?: 'un cliente') . '".' . $fin;
    if (!empty($r['tecnico_asignado'])) return 'Está en poder de "' . $r['tecnico_asignado'] . '".' . $fin;
    if ($r['estado'] === 'en_venta') return 'Tiene una venta pendiente de aprobación.';
    if (!in_array($r['estado'], ['disponible','dañado','no_disponible'], true)) return 'Su estado actual es "' . $r['estado'] . '" (en envío, instalada o vendida).' . $fin;
    return null;
}

if ($method === 'GET' && $action === 'puede_eliminar_ont') {
    sesionRequerida();
    $q = $pdo->prepare("SELECT modelo, estado, tecnico_asignado, cliente_nombre FROM ont_seriales WHERE id = ?");
    $q->execute([intval($_GET['id'] ?? 0)]); $r = $q->fetch();
    $mot = $r ? _ontBloqueoEliminar($r) : 'La ONT ya no existe.';
    responder(['ok' => $mot === null, 'motivo' => $mot]);
}

/* ══ ELIMINAR ONT ══ */
if ($method === 'POST' && $action === 'eliminar_ont') {
    sesionRequerida();
    rolOPermiso(['superadmin'], 'eliminar_ont_masivo');
    $data = $bodyData;
    $id   = intval($data['id'] ?? 0);
    if(!$id) responder(['error'=>'ID requerido'],400);
    exigirPasswordSesion($data, 'Debes confirmar tu contraseña para eliminar la ONT.');
    $modeloAntes = $pdo->prepare("SELECT modelo, estado, tecnico_asignado, cliente_nombre FROM ont_seriales WHERE id = ?");
    $modeloAntes->execute([$id]);
    $rowAntes = $modeloAntes->fetch();
    if (!$rowAntes) responder(['error' => 'ONT no encontrada'], 404);
    $motOnt = _ontBloqueoEliminar($rowAntes);
    if ($motOnt) responder(['error' => 'No se puede eliminar esta ONT. ' . $motOnt, 'bloqueado' => true], 400);
    $modeloOnt = $rowAntes['modelo'];
    $pdo->prepare("DELETE FROM ont_seriales WHERE id=?")->execute([$id]);
    ontSincronizarStock($pdo, $modeloOnt);
    auditar($pdo, 'eliminar_ont', 'ont_seriales', "Eliminada ONT: {$modeloOnt} (id {$id})", (string)$id);
    responder(['ok'=>true]);
}

/* ══════════════════════════════════════
   ELIMINAR VARIAS ONTs (admin o con permiso eliminar_ont_masivo)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'eliminar_onts') {
    sesionRequerida();
    // Solo superadmin pasa directo. El distribuidor necesita el permiso
    // eliminar_ont_masivo guardado de verdad (antes cualquier distribuidor
    // pasaba igual, sin importar si se lo habían quitado).
    $rol = $_SESSION['rol'] ?? '';
    $autorizado = ($rol === 'superadmin');
    if (!$autorizado) {
        try {
            $uq = $pdo->prepare("SELECT permisos FROM usuarios WHERE id = ?");
            $uq->execute([$_SESSION['usuario_id'] ?? 0]);
            $permRaw = $uq->fetchColumn();
            $perms = $permRaw ? json_decode($permRaw, true) : [];
            if (is_array($perms) && in_array('eliminar_ont_masivo', $perms)) $autorizado = true;
        } catch (\Throwable $e) { error_log('[eliminar_onts permisos] '.$e->getMessage()); }
    }
    if (!$autorizado) responder(['error' => 'No tienes permiso para eliminar ONTs'], 403);

    $data = $bodyData;
    $ids  = $data['ids'] ?? [];
    if (!is_array($ids) || !count($ids)) responder(['error' => 'No se recibieron ONTs para eliminar'], 400);

    // Sanear a enteros.
    $idsInt = array_values(array_filter(array_map('intval', $ids)));
    if (!count($idsInt)) responder(['error' => 'IDs inválidos'], 400);

    try {
        $ph = implode(',', array_fill(0, count($idsInt), '?'));

        // No borrar las que ya tienen dueño (fueron enviadas a alguien) —
        // esas hay que devolverlas al almacén primero, no eliminarlas
        // directo, aunque todavía no estén instaladas.
        $chkConDueño = $pdo->prepare("SELECT id FROM ont_seriales WHERE id IN ($ph) AND tecnico_asignado IS NOT NULL");
        $chkConDueño->execute($idsInt);
        $idsComodato = $chkConDueño->fetchAll(PDO::FETCH_COLUMN);
        $idsBorrar = array_values(array_diff($idsInt, $idsComodato));

        if (!count($idsBorrar)) {
            responder(['error' => 'Todas las seleccionadas ya tienen dueño — ninguna se puede eliminar así.'], 400);
        }
        $phBorrar = implode(',', array_fill(0, count($idsBorrar), '?'));

        $modelosAfectados = $pdo->prepare("SELECT DISTINCT modelo FROM ont_seriales WHERE id IN ($phBorrar) AND modelo IS NOT NULL");
        $modelosAfectados->execute($idsBorrar);
        $modelosLista = $modelosAfectados->fetchAll(PDO::FETCH_COLUMN);

        $stmt = $pdo->prepare("DELETE FROM ont_seriales WHERE id IN ($phBorrar)");
        $stmt->execute($idsBorrar);
        $n = $stmt->rowCount();
        foreach ($modelosLista as $m) { ontSincronizarStock($pdo, $m); }
        try { auditar($pdo, 'eliminar', 'ont_seriales', "Eliminó $n ONT(s) por selección" . (count($idsComodato)?" — se saltaron ".count($idsComodato)." que ya tenían dueño":''), implode(',', $idsBorrar)); } catch (\Throwable $e) {}
        responder(['ok' => true, 'eliminadas' => $n, 'saltadas_comodato' => count($idsComodato)]);
    } catch (\Throwable $e) {
        error_log('[eliminar_onts] '.$e->getMessage());
        responder(['error' => 'No se pudo eliminar: ' . $e->getMessage()], 500);
    }
}

/* ══ DESCARGAR PLANTILLA ONT ══ */

/* ══ IMPORTAR ONTs DESDE EXCEL ══ */
/* ══════════════════════════════════════
   IMPORTAR ONTs A UNA CAJA ESPECÍFICA
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'importar_ont_caja') {
    rolOPermiso(['superadmin'], 'registrar_ont');
    $data     = $bodyData;
    $cajaId   = intval($data['caja_id'] ?? 0);
    $registros= $data['registros'] ?? [];

    if (!$cajaId) responder(['error' => 'Caja no especificada'], 400);
    if (empty($registros)) responder(['error' => 'No hay registros para importar'], 400);

    // Verificar que la caja existe
    $caja = $pdo->prepare("SELECT * FROM cajas WHERE id = ?");
    $caja->execute([$cajaId]);
    $cajaRow = $caja->fetch();
    if (!$cajaRow) responder(['error' => 'Caja no encontrada'], 404);

    $importados = 0;
    $omitidos   = 0;

    $estadosOk = ['disponible','no_disponible','comodato','instalado','dañado','devuelto','recuperado','de_baja'];

    $pdo->beginTransaction();
    try {
        // Columnas disponibles (INSERT tolerante).
        $cols = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($registros as $r) {
            $mac = strtoupper(trim($r['mac'] ?? ''));
            $sn  = strtoupper(trim($r['sn']  ?? ''));
            if (!$sn) { $omitidos++; continue; }

            $mac = preg_replace('/[^A-F0-9]/', '', $mac);
            if ($mac !== '' && !preg_match('/^[A-F0-9]{12}$/', $mac)) { $omitidos++; continue; }

            // Verificar duplicado por SN o MAC
            $check = $pdo->prepare("SELECT id FROM ont_seriales WHERE sn = ? OR (mac = ? AND mac != '' AND mac IS NOT NULL)");
            $check->execute([$sn, $mac]);
            if ($check->fetch()) { $omitidos++; continue; }

            $mac_fmt_imp = $mac ?: ''; // sin separadores, solo dígitos

            // Campos nuevos
            $modelo  = trim($r['modelo'] ?? '');
            $estado  = trim($r['estado'] ?? 'disponible');
            if (!in_array($estado, $estadosOk)) $estado = 'disponible';
            $fIng    = trim($r['fecha_ingreso'] ?? '');
            $fSal    = trim($r['fecha_salida'] ?? '');

            $vals = [
                'caja_id'           => $cajaId,
                'mac'               => $mac ?: null,
                'mac_fmt'           => $mac_fmt_imp,
                'sn'                => $sn,
                'estado'            => $estado,
                'sede_actual'       => $cajaRow['sede_nombre'] ?? null,
                'registrado_por'    => $_SESSION['usuario'] ?? '',
                'modelo'            => $modelo ?: null,
                'fecha_instalacion' => $fIng ?: null,
                'fecha_salida'      => $fSal ?: null,
            ];
            $cc = []; $pp = []; $par = [];
            foreach ($vals as $col => $val) {
                if (in_array($col, $cols)) { $cc[] = $col; $pp[] = '?'; $par[] = $val; }
            }
            if (in_array('fecha', $cols)) { $cc[] = 'fecha'; $pp[] = 'NOW()'; }
            $pdo->prepare("INSERT INTO ont_seriales (" . implode(',', $cc) . ") VALUES (" . implode(',', $pp) . ")")
                ->execute($par);
            $importados++;
        }

        // Actualizar total_onts de la caja
        $pdo->prepare("UPDATE cajas SET total_onts = (SELECT COUNT(*) FROM ont_seriales WHERE caja_id = ?) WHERE id = ?")
            ->execute([$cajaId, $cajaId]);

        // Actualizar stock del producto si tiene producto_id
        if (!empty($cajaRow['producto_id']) && !empty($cajaRow['producto_ref'])) {
            // No actualizar stock automáticamente — las ONTs tienen su propio conteo
            // $pdo->prepare("UPDATE productos SET stock_neiva = stock_neiva + ? WHERE ref = ?")->execute([$importados, $cajaRow['producto_ref']]);
        }

        $pdo->commit();
        try {
            auditar($pdo, 'importar', 'ont_seriales', "Importadas {$importados} ONTs a caja #{$cajaId} ({$cajaRow['nombre_caja']})", '');
            _historialLlegadaOnt($pdo, (int)$importados, (string)($cajaRow['modelo'] ?? ''), "importadas a la caja \"{$cajaRow['nombre_caja']}\"" . ($omitidos ? " ({$omitidos} omitidas)" : ''), (string)($data['nota'] ?? ''));
        } catch (\Throwable $e) {
            error_log('[importar_ont_caja/auditar] ' . $e->getMessage());
        }
        responder(['ok' => true, 'importados' => $importados, 'omitidos' => $omitidos, 'omitidas' => $omitidos]);
    } catch (\Throwable $e) {
        $pdo->rollBack();
        error_log('[importar_ont_caja] ' . $e->getMessage());
        responder(['error' => 'Error al importar: ' . $e->getMessage()], 500);
    }
}

/* ══ IMPORTAR ONTs DIRECTO POR MODELO (sin caja) ══
   Reemplaza el flujo viejo de "crear caja → importar" — ahora se importa
   directo contra un modelo que ya exista en Categorías, sin ningún paso
   intermedio. */
if ($method === 'POST' && $action === 'importar_ont_modelo') {
    rolOPermiso(['superadmin'], 'registrar_ont');
    $data      = $bodyData;
    $modeloReq = trim($data['modelo'] ?? '');
    $registros = $data['registros'] ?? [];

    if (!$modeloReq) responder(['error' => 'Indica el modelo'], 400);
    if (empty($registros)) responder(['error' => 'No hay registros para importar'], 400);

    // El modelo debe existir ya en el catálogo (Categorías) — coincidencia
    // exacta por nombre, sin importar mayúsculas/espacios sobrantes.
    $chkModelo = $pdo->prepare("SELECT nombre FROM modelos_ont WHERE LOWER(TRIM(nombre)) = LOWER(TRIM(?))");
    $chkModelo->execute([$modeloReq]);
    $modeloReal = $chkModelo->fetchColumn();
    if (!$modeloReal) {
        responder(['error' => "El modelo \"$modeloReq\" no existe en Categorías. Créalo primero con ese nombre exacto."], 400);
    }

    $importados = 0;
    $omitidos   = 0;
    $estadosOk = ['disponible','no_disponible','comodato','instalado','dañado','devuelto','recuperado','de_baja'];

    $pdo->beginTransaction();
    try {
        $cols = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($registros as $r) {
            $mac = strtoupper(trim($r['mac'] ?? ''));
            $sn  = strtoupper(trim($r['sn']  ?? ''));
            if (!$sn) { $omitidos++; continue; }

            $mac = preg_replace('/[^A-F0-9]/', '', $mac);
            if ($mac !== '' && !preg_match('/^[A-F0-9]{12}$/', $mac)) { $omitidos++; continue; }

            $check = $pdo->prepare("SELECT id FROM ont_seriales WHERE sn = ? OR (mac = ? AND mac != '' AND mac IS NOT NULL)");
            $check->execute([$sn, $mac]);
            if ($check->fetch()) { $omitidos++; continue; }

            $estado = trim($r['estado'] ?? 'disponible');
            if (!in_array($estado, $estadosOk)) $estado = 'disponible';
            $fIng = trim($r['fecha_ingreso'] ?? '');
            $fSal = trim($r['fecha_salida']  ?? '');

            $vals = [
                'mac'               => $mac ?: null,
                'mac_fmt'           => $mac ?: '',
                'sn'                => $sn,
                'estado'            => $estado,
                'registrado_por'    => $_SESSION['usuario'] ?? '',
                'modelo'            => $modeloReal,
                'fecha_ingreso'     => $fIng ?: null,
                'fecha_salida'      => $fSal ?: null,
            ];
            $cc = []; $pp = []; $par = [];
            foreach ($vals as $col => $val) {
                if (in_array($col, $cols)) { $cc[] = $col; $pp[] = '?'; $par[] = $val; }
            }
            if (in_array('fecha', $cols)) { $cc[] = 'fecha'; $pp[] = 'NOW()'; }
            $pdo->prepare("INSERT INTO ont_seriales (" . implode(',', $cc) . ") VALUES (" . implode(',', $pp) . ")")
                ->execute($par);
            $importados++;
        }
        $pdo->commit();
        try {
            auditar($pdo, 'importar', 'ont_seriales', "Importadas {$importados} ONTs del modelo \"$modeloReal\"", '');
            _historialLlegadaOnt($pdo, (int)$importados, (string)$modeloReal, 'importadas por lote' . ($omitidos ? " ({$omitidos} omitidas)" : ''), (string)($data['nota'] ?? ''));
        } catch (\Throwable $e) { error_log('[importar_ont_modelo/auditar] ' . $e->getMessage()); }
        responder(['ok' => true, 'importados' => $importados, 'omitidos' => $omitidos]);
    } catch (\Throwable $e) {
        $pdo->rollBack();
        error_log('[importar_ont_modelo] ' . $e->getMessage());
        responder(['error' => 'Error al importar: ' . $e->getMessage()], 500);
    }
}

if ($method === 'POST' && $action === 'importar_ont_excel') {
    sesionRequerida();
    rolOPermiso(['superadmin'], 'registrar_ont');
    $data      = $bodyData;
    $registros = $data['registros'] ?? [];
    if(empty($registros)) responder(['error' => 'Sin registros para importar'], 400);

    $importados = 0;
    $omitidas   = 0;

    foreach($registros as $r) {
        $mac    = strtoupper(preg_replace('/[^A-Fa-f0-9]/', '', $r['mac'] ?? ''));
        $sn     = strtoupper(trim($r['sn'] ?? ''));
        $sede   = trim($r['sede'] ?? '');           // vacío si no viene
        $cliente= trim($r['cliente_nombre'] ?? ''); // vacío si no viene
        $dir    = trim($r['cliente_direccion'] ?? '');
        $tec    = trim($r['tecnico_instalacion'] ?? '');
        $fecha  = trim($r['fecha_instalacion'] ?? '');

        if(strlen($mac)===0||!$sn) continue;

        // Estado: usar exactamente lo que viene; si no viene dejar null
        $estadoArchivo = strtolower(trim($r['estado'] ?? ''));
        $estadosValidos = ['disponible','comodato','dañado','vendido','despachada','ocupado'];
        $estadoOnt = in_array($estadoArchivo, $estadosValidos) ? $estadoArchivo : null;

        // Sede: usar la del archivo; si no viene dejar null (sin sede)
        $sedeUsar = !empty($sede) ? $sede : null;

        // Convertir fecha DD/MM/AAAA a YYYY-MM-DD
        if(preg_match('/(\d{2})\/(\d{2})\/(\d{4})/', $fecha, $m))
            $fecha = "{$m[3]}-{$m[2]}-{$m[1]}";
        if(empty($fecha)) $fecha = null;

        // Verificar duplicados
        $dup = $pdo->prepare("SELECT id FROM ont_seriales WHERE sn=? OR mac=?");
        $dup->execute([$sn, $mac]);
        if($dup->fetch()){ $omitidas++; continue; }

        // Caja genérica de importación
        $cajaNombre = 'ONTs importadas';
        $cajaStmt = $pdo->query("SELECT id FROM cajas WHERE nombre_caja='ONTs importadas' LIMIT 1");
        $cajaRow  = $cajaStmt ? $cajaStmt->fetch() : null;
        if(!$cajaRow){
            // Usar primera sede disponible para satisfacer FK si la hay
            $primeraSedeId = $pdo->query("SELECT id FROM sedes LIMIT 1")->fetchColumn() ?: null;
            $pdo->prepare("INSERT INTO cajas (nombre_caja, sede_id, sede_nombre, registrado_por) VALUES (?,?,?,?)")
                ->execute([$cajaNombre, $primeraSedeId, 'Importación', $_SESSION['usuario']]);
            $cajaId = $pdo->lastInsertId();
        } else {
            $cajaId = $cajaRow['id'];
        }

        $mac_fmt   = $mac; // sin separadores, solo dígitos
        $estadoFin = $estadoOnt ?: 'sin_asignar';
        $sedeFin   = $sedeUsar  ?: '';           // sede puede quedar vacía
        $pdo->prepare("INSERT INTO ont_seriales (caja_id, mac, sn, estado, sede_actual, registrado_por, cliente_nombre, cliente_direccion, tecnico_instalacion, fecha_instalacion) VALUES (?,?,?,?,?,?,?,?,?,?)")
            ->execute([$cajaId, $mac, $sn, $estadoFin, $sedeFin ?: null, $_SESSION['usuario'], $cliente?:null, $dir?:null, $tec?:null, $fecha?:null]);
        $importados++;
    }

    auditar($pdo, 'importar_ont_excel', 'ont_seriales', "Importó {$importados} ONT desde Excel ({$omitidas} omitidas)", '');
    _historialLlegadaOnt($pdo, (int)$importados, '', 'importadas desde Excel' . ($omitidas ? " ({$omitidas} omitidas por duplicadas)" : ''), (string)($data['nota'] ?? ''));
    responder(['ok'=>true, 'importados'=>$importados, 'omitidas'=>$omitidas]);
}

/* ══════════════════════════════════════════════════════
   IMPORTAR ONTs — formato MikroWisp
   Columnas: ID Categoría, Nº serie, Nº Mac, Costo, Estado (1/2/3),
   ID cliente, Fecha Ingreso, Fecha Salida, ID Proveedor
══════════════════════════════════════════════════════ */
if ($method === 'POST' && $action === 'importar_ont_mikrowisp') {
    sesionRequerida();
    rolOPermiso(['superadmin'], 'registrar_ont');
    $data      = $bodyData;
    $registros = $data['registros'] ?? [];
    $sede      = 'Almacen Central'; // todas llegan primero aquí; el destino se define al despachar cada una
    $mapaModelos = $data['mapa_modelos'] ?? []; // { "ID Categoría": "Nombre del modelo" }
    if (empty($registros)) responder(['error' => 'Sin registros para importar'], 400);

    // Estado MikroWisp -> estado interno
    $mapaEstado = ['1' => 'dañado', '2' => 'disponible', '3' => 'comodato'];

    // Traer todos los proveedores que ya tienen un ID de MikroWisp asignado,
    // para resolver el "ID Proveedor" del Excel a un proveedor real —
    // así queda el nombre guardado, no solo el número suelto.
    $mapaProveedores = [];
    $stmtProv = $pdo->query("SELECT id_mikrowisp, nombre FROM proveedores WHERE id_mikrowisp IS NOT NULL AND id_mikrowisp != '' AND activo = 1");
    foreach ($stmtProv->fetchAll() as $p) { $mapaProveedores[$p['id_mikrowisp']] = $p['nombre']; }

    $cols = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
    $importados = 0; $omitidos = 0; $modelosImportados = [];

    $pdo->beginTransaction();
    try {
        foreach ($registros as $r) {
            $idCategoria = trim((string)($r['id_categoria'] ?? ''));
            $sn          = strtoupper(trim($r['sn'] ?? ''));
            $mac         = strtoupper(preg_replace('/[^A-Fa-f0-9]/', '', $r['mac'] ?? ''));
            $costo       = is_numeric($r['costo'] ?? null) ? floatval($r['costo']) : null;
            $estadoCod   = trim((string)($r['estado'] ?? '2'));
            $idCliente   = trim((string)($r['id_cliente'] ?? ''));
            $fechaIng    = trim($r['fecha_ingreso'] ?? '');
            $fechaSal    = trim($r['fecha_salida'] ?? '');
            $idProveedor = trim((string)($r['id_proveedor'] ?? ''));

            if (!$sn && !$mac) { $omitidos++; continue; }

            // Evitar duplicados por SN o MAC.
            if ($sn || $mac) {
                $dup = $pdo->prepare("SELECT id FROM ont_seriales WHERE (sn = ? AND sn != '') OR (mac = ? AND mac != '')");
                $dup->execute([$sn, $mac]);
                if ($dup->fetch()) { $omitidos++; continue; }
            }

            $macFmt = $mac ?: ''; // sin separadores, solo dígitos
            $estado = $mapaEstado[$estadoCod] ?? 'disponible';
            $modelo = $mapaModelos[$idCategoria] ?? ("Categoría $idCategoria");
            $nombreProveedor = $mapaProveedores[$idProveedor] ?? null;

            $vals = [
                'mac'              => $mac ?: null,
                'mac_fmt'          => $macFmt ?: null,
                'sn'               => $sn ?: null,
                'estado'           => $estado,
                'sede_actual'      => $sede,
                'registrado_por'   => $_SESSION['usuario'] ?? '',
                'modelo'           => $modelo,
                'costo'            => $costo,
                'id_cliente_ext'   => $idCliente ?: null,
                'id_proveedor_ext' => $idProveedor ?: null,
                'proveedor'        => $nombreProveedor,
                'fecha_ingreso'    => $fechaIng ?: null,
                'fecha_salida'     => $fechaSal ?: null,
            ];
            $cc = []; $pp = []; $par = [];
            foreach ($vals as $col => $val) {
                if (in_array($col, $cols)) { $cc[] = $col; $pp[] = '?'; $par[] = $val; }
            }
            $pdo->prepare("INSERT INTO ont_seriales (" . implode(',', $cc) . ") VALUES (" . implode(',', $pp) . ")")
                ->execute($par);

            $ontId = $pdo->lastInsertId();
            _logOntHistorial($pdo, $ontId, 'importada', "Importada desde MikroWisp — estado: $estado" . ($idCliente ? " · ID cliente MikroWisp: $idCliente" : ''), $_SESSION['usuario'] ?? '');
            $modelosImportados[$modelo] = true;

            $importados++;
        }
        $pdo->commit();
        foreach (array_keys($modelosImportados) as $m) { ontSincronizarStock($pdo, $m); }
        try { auditar($pdo, 'importar_mikrowisp', 'ont_seriales', "Importadas $importados ONTs desde MikroWisp a $sede", ''); } catch (\Throwable $e) {}
        responder(['ok' => true, 'importados' => $importados, 'omitidos' => $omitidos]);
    } catch (\Throwable $e) {
        $pdo->rollBack();
        error_log('[importar_ont_mikrowisp] ' . $e->getMessage());
        responder(['error' => 'Error al importar: ' . $e->getMessage()], 500);
    }
}
if ($method === 'POST' && $action === 'registrar_ont_en_uso') {
    // Esto crea una ONT directamente marcada como "ya instalada en un
    // cliente", sin pasar por el flujo normal de asignación/instalación
    // (y por lo tanto sin control de stock). En pantalla el botón que
    // abre este formulario ya estaba oculto para todos menos
    // superadmin/distribuidor — pero el servidor no lo exigía, así que
    // cualquier usuario logueado podía llamarlo directamente. Se agrega
    // aquí el mismo control que ya tenía la interfaz.
    rolRequerido('superadmin', 'distribuidor');
    $data     = $bodyData;
    $mac      = strtoupper(preg_replace('/[^A-Fa-f0-9]/', '', $data['mac'] ?? ''));
    $sn       = strtoupper(trim($data['sn'] ?? ''));
    $sede     = trim($data['sede'] ?? '');
    $cliente  = trim($data['cliente_nombre'] ?? '');
    $dir      = trim($data['cliente_direccion'] ?? '');
    $tecnico  = trim($data['tecnico_instalacion'] ?? '');
    $fecha    = trim($data['fecha_instalacion'] ?? '');

    if(strlen($mac)===0||!$sn||!$sede||!$cliente||!$tecnico||!$fecha)
        responder(['error'=>'Datos incompletos'],400);

    // Verificar duplicados
    $dup = $pdo->prepare("SELECT id FROM ont_seriales WHERE sn=?");
    $dup->execute([$sn]);
    if($dup->fetch()) responder(['error'=>"El SN $sn ya está registrado"],400);
    $dup2 = $pdo->prepare("SELECT id FROM ont_seriales WHERE mac=?");
    $dup2->execute([$mac]);
    if($dup2->fetch()) responder(['error'=>"La MAC ya está registrada"],400);

    // Buscar o crear caja genérica para ONTs en uso en esa sede
    $sedeData = $pdo->prepare("SELECT id FROM sedes WHERE UPPER(nombre)=UPPER(?)");
    $sedeData->execute([$sede]);
    $sedeRow = $sedeData->fetch();
    if(!$sedeRow){
        $pdo->prepare("INSERT INTO sedes (nombre, tipo, activa) VALUES (?, 'municipio', 1)")
            ->execute([$sede]);
        $sedeId = $pdo->lastInsertId();
        $prods = $pdo->query("SELECT id FROM productos")->fetchAll();
        $insStock = $pdo->prepare("INSERT IGNORE INTO stock_sedes (producto_id, sede_id, cantidad) VALUES (?,?,0)");
        foreach($prods as $p) $insStock->execute([$p['id'], $sedeId]);
        $sedeRow = ['id' => $sedeId];
    }

    $cajaNombre = "ONTs en uso — $sede";
    $caja = $pdo->prepare("SELECT id FROM cajas WHERE nombre_caja=? AND sede_id=?");
    $caja->execute([$cajaNombre, $sedeRow['id']]);
    $cajaRow = $caja->fetch();
    if(!$cajaRow){
        $pdo->prepare("INSERT INTO cajas (nombre_caja, sede_id, sede_nombre, registrado_por) VALUES (?,?,?,?)")
            ->execute([$cajaNombre, $sedeRow['id'], $sede, $_SESSION['usuario']]);
        $cajaId = $pdo->lastInsertId();
    } else {
        $cajaId = $cajaRow['id'];
    }

    // Formatear MAC
    $mac_fmt = $mac; // sin separadores, solo dígitos

    $pdo->prepare("INSERT INTO ont_seriales (caja_id, mac, sn, estado, sede_actual, registrado_por, cliente_nombre, cliente_direccion, tecnico_instalacion, fecha_instalacion) VALUES (?,?,?,'comodato',?,?,?,?,?,?)")
        ->execute([$cajaId, $mac, $sn, $sede, $_SESSION['usuario'], $cliente, $dir, $tecnico, $fecha]);

    auditar($pdo, 'registrar_ont_en_uso', 'ont_seriales', "Registrada ONT ya instalada — SN {$sn} — Cliente: {$cliente}", (string)$pdo->lastInsertId());
    responder(['ok'=>true, 'mac_fmt'=>$mac_fmt]);
}

/* ══ DETALLE DE UNA ONT ══ */
if ($method === 'GET' && $action === 'listar_ont_detalle') {
    sesionRequerida();
    $id = intval($_GET['id'] ?? 0);
    if(!$id) responder(['error'=>'ID requerido'],400);
    $stmt = $pdo->prepare("SELECT o.*, c.nombre_caja FROM ont_seriales o LEFT JOIN cajas c ON c.id=o.caja_id WHERE o.id=?");
    $stmt->execute([$id]);
    $row = $stmt->fetch();
    if(!$row) responder(['error'=>'No encontrada'],404);
    responder($row);
}

/* ══ LISTAR ONTs DE UNA SEDE ══ */
/* ══ LISTAR ONTs DISPONIBLES DE UN MODELO (para que el distribuidor seleccione) ══ */
if ($method === 'GET' && $action === 'onts_disponibles_de_modelo') {
    sesionRequerida();
    try {
        $modelo = trim($_GET['modelo'] ?? '');
        // Quitar prefijos comunes del nombre del ítem del pedido ("ONT — ", "📡 ", etc.)
        $modelo = trim(preg_replace('/^.*?ONT\s*[—\-:]\s*/iu', '', $modelo));
        $modelo = trim(str_replace(['📡','ONT —','ONT -','ONT:'], '', $modelo));
        // todos=1: el admin quiere ver ONT de OTROS modelos (porque del pedido ya no quedan).
        if (($_GET['todos'] ?? '') === '1') {
            $stT = $pdo->query("SELECT id, mac, sn, caja_id, COALESCE(modelo,'') AS modelo
                FROM ont_seriales WHERE estado='disponible' AND tecnico_asignado IS NULL ORDER BY modelo, caja_id, id");
            responder($stT->fetchAll(PDO::FETCH_ASSOC));
        }

        $cols = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
        $tieneModelo = in_array('modelo', $cols);

        if ($tieneModelo && $modelo !== '' && stripos($modelo, 'sin modelo') === false) {
            // Coincidencia flexible: exacta, o que una contenga a la otra (ignora may/espacios).
            $like = '%' . $modelo . '%';
            $st = $pdo->prepare("SELECT id, mac, sn, caja_id, COALESCE(modelo,'') AS modelo
                FROM ont_seriales
                WHERE estado='disponible' AND tecnico_asignado IS NULL
                  AND (
                    LOWER(TRIM(COALESCE(modelo,''))) = LOWER(?)
                    OR LOWER(COALESCE(modelo,'')) LIKE LOWER(?)
                    OR (TRIM(COALESCE(modelo,''))<>'' AND LOWER(?) LIKE CONCAT('%', LOWER(TRIM(COALESCE(modelo,''))), '%'))
                  )
                ORDER BY caja_id, id");
            $st->execute([$modelo, $like, $modelo]);
            $rows = $st->fetchAll(PDO::FETCH_ASSOC);
            // Si no hay de ese modelo, se devuelve vacío: ANTES se listaban ONT de
            // TODOS los modelos y se podía despachar una ONT equivocada.
            responder($rows);
        } else {
            // Sin modelo especificado: todas las disponibles.
            $st = $pdo->query("SELECT id, mac, sn, caja_id, " . ($tieneModelo ? "COALESCE(modelo,'')" : "''") . " AS modelo
                FROM ont_seriales WHERE estado='disponible' AND tecnico_asignado IS NULL ORDER BY caja_id, id");
            responder($st->fetchAll(PDO::FETCH_ASSOC));
        }
    } catch (\Throwable $e) {
        error_log('[onts_disponibles_de_modelo] '.$e->getMessage());
        responder(['error' => $e->getMessage()], 500);
    }
}

/* ══ ONTs DISPONIBLES AGRUPADAS POR MODELO (para el carrito de pedidos) ══ */
if ($method === 'GET' && $action === 'onts_disponibles_modelo') {
    sesionRequerida();
    try {
        $cols = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
        $tieneModelo = in_array('modelo', $cols);
        $campoModelo = $tieneModelo ? "COALESCE(NULLIF(TRIM(modelo),''),'ONT (sin modelo)')" : "'ONT'";

        // Solo ONTs disponibles en el almacén central de verdad — que ya
        // tengan dueño asignado NO cuentan aquí, aunque su estado siga
        // diciendo "disponible" (son de esa persona, no del almacén).
        $sqlAlmacen = "SELECT $campoModelo AS modelo, COUNT(*) AS cantidad
                FROM ont_seriales
                WHERE estado = 'disponible' AND tecnico_asignado IS NULL
                GROUP BY modelo
                ORDER BY modelo";
        $rows = $pdo->query($sqlAlmacen)->fetchAll(PDO::FETCH_ASSOC);

        // Además, el stock PERSONAL de quien consulta (lo que ya es suyo,
        // listo para instalar) — para que en "Productos en stock" cada
        // quien vea lo que de verdad tiene, no el total del almacén.
        $usuario = $_SESSION['usuario'] ?? '';
        $sqlPersonal = "SELECT $campoModelo AS modelo, COUNT(*) AS cantidad
                FROM ont_seriales
                WHERE tecnico_asignado = ? AND estado IN ('disponible','despachada','asignado')
                GROUP BY modelo
                ORDER BY modelo";
        $stmtP = $pdo->prepare($sqlPersonal);
        $stmtP->execute([$usuario]);
        $rowsPersonal = $stmtP->fetchAll(PDO::FETCH_ASSOC);

        responder(['almacen' => $rows, 'personal' => $rowsPersonal]);
    } catch (\Throwable $e) {
        error_log('[onts_disponibles_modelo] '.$e->getMessage());
        responder(['error' => $e->getMessage()], 500);
    }
}

if ($method === 'GET' && $action === 'listar_onts_sede') {
    sesionRequerida();
    $sedesStr = trim($_GET['sedes'] ?? '');
    if(!$sedesStr) responder([]);
    $sedes = array_filter(array_map('trim', explode(',', $sedesStr)));
    if(empty($sedes)) responder([]);
    $sedesUpper = array_map('strtoupper', $sedes);
    $placeholders = implode(',', array_fill(0, count($sedesUpper), '?'));
    $stmt = $pdo->prepare("SELECT o.*, c.nombre_caja FROM ont_seriales o 
        LEFT JOIN cajas c ON c.id=o.caja_id 
        WHERE UPPER(o.sede_actual) IN ($placeholders)
        ORDER BY COALESCE(o.fecha_envio, o.fecha_registro) DESC");
    $stmt->execute($sedesUpper);
    responder($stmt->fetchAll());
}

/* ══ LISTAR ONTs EN USO ══ */
if ($method === 'GET' && $action === 'listar_ont_en_uso') {
    sesionRequerida();
    try {
        $rol  = $_SESSION['rol']  ?? '';
        $sede = $_SESSION['sede'] ?? '';
        $verTodo = in_array($rol, ['superadmin','distribuidor']);

        // "ONTs en uso" = ONTs HISTÓRICAS (cargadas en "ONTs Históricas"),
        // que se marcan con el sufijo "(histórico)" en registrado_por.
        // INNER JOIN para excluir huérfanas (cuya caja ya fue eliminada).
        $base = "SELECT o.*, c.nombre_caja
                 FROM ont_seriales o JOIN cajas c ON c.id=o.caja_id
                 WHERE o.registrado_por LIKE '%(histórico)%'";
        if ($verTodo) {
            $stmt = $pdo->query($base . " ORDER BY o.id DESC");
            $rows = $stmt->fetchAll();
        } else {
            // Municipio/técnico/persona: solo las históricas de SU sede.
            $stmt = $pdo->prepare($base . " AND COALESCE(NULLIF(o.sede_actual,''), c.sede_nombre) = ? ORDER BY o.id DESC");
            $stmt->execute([$sede]);
            $rows = $stmt->fetchAll();
        }
        responder($rows);
    } catch(Exception $e) {
        responder(['error' => $e->getMessage(), 'sql_error' => true]);
    }
}

/* ══ CAMBIAR ESTADO ONT ══ */
if ($method === 'POST' && $action === 'cambiar_estado_ont') {
    sesionRequerida();
    $data   = $bodyData;
    $ont_id = intval($data['ont_id'] ?? 0);
    $estado = trim($data['estado'] ?? '');
    $permitidos = ['disponible','despachada','asignado','comodato','ocupado','dañado','no_disponible','vendido','sin_asignar'];
    if (!$ont_id || !in_array($estado, $permitidos))
        responder(['error' => 'Datos inválidos'], 400);
    $modeloAntes = $pdo->prepare("SELECT modelo, estado FROM ont_seriales WHERE id = ?");
    $modeloAntes->execute([$ont_id]);
    $rowAntes = $modeloAntes->fetch();
    $modeloOnt = $rowAntes['modelo'] ?? null;
    $estadoAntes = $rowAntes['estado'] ?? null;

    require_once __DIR__ . '/retiro_proyecto_lib.php';
    retirarOntDeCliente($pdo, $ont_id, $estadoAntes, $estado, $_SESSION['usuario'] ?? '');
    // El estado (disponible/dañado/etc.) y el dueño (tecnico_asignado) son
    // cosas independientes. Cambiar el estado NUNCA debe quitar el dueño —
    // la ONT sigue siendo de la misma persona hasta que se devuelva de
    // verdad (por Devolver → Seguimiento), no solo con cambiar un estado.
    $pdo->prepare("UPDATE ont_seriales SET estado=? WHERE id=?")
        ->execute([$estado, $ont_id]);

    if ($estado !== $estadoAntes) {
        $etiquetas = [
            'disponible'    => 'Disponible', 'despachada' => 'Despachada',
            'asignado'      => 'Asignada',   'comodato'   => 'Comodato',
            'ocupado'       => 'Ocupada',    'dañado'     => 'Dañada',
            'no_disponible' => 'No disponible', 'vendido' => 'Vendida',
            'sin_asignar'   => 'Sin asignar',
        ];
        $labelAntes = $etiquetas[$estadoAntes] ?? ($estadoAntes ?: '—');
        $labelNuevo = $etiquetas[$estado] ?? $estado;
        try { _logOntHistorial($pdo, $ont_id, 'editado', "Estado cambiado de \"$labelAntes\" a \"$labelNuevo\"", $_SESSION['usuario'] ?? ''); }
        catch (\Throwable $e) { error_log('[cambiar_estado_ont/trazabilidad] '.$e->getMessage()); }
    }

    ontSincronizarStock($pdo, $modeloOnt);
    auditar($pdo, 'cambiar_estado_ont', 'ont_seriales', "ONT (id {$ont_id}) — estado: {$estadoAntes} → {$estado}", (string)$ont_id);
    responder(['ok' => true]);
}

/* ══ INSTALAR ONT (comodato) ══ */
if ($method === 'POST' && $action === 'instalar_ont') {
    sesionRequerida();
    $data     = $bodyData;
    $ont_id   = intval($data['ont_id'] ?? 0);
    $cliente  = trim($data['cliente_nombre'] ?? '');
    $direccion= trim($data['cliente_direccion'] ?? '');
    $tecnicoElegido = trim($data['tecnico_instalador'] ?? '');
    $lat = isset($data['lat']) && $data['lat'] !== '' ? floatval($data['lat']) : null;
    $lng = isset($data['lng']) && $data['lng'] !== '' ? floatval($data['lng']) : null;
    // Si esta instalación viene de "Gasto múltiple", trae un lote_id
    // compartido con los demás productos del mismo lote — así, en
    // Historial, el botón "PDF" abre el comprobante COMBINADO con todo lo
    // del lote (antes esto se quedaba fuera y salía en un PDF aparte).
    $loteId = trim($data['lote_id'] ?? '') ?: null;

    if (!$ont_id || !$cliente)
        responder(['error' => 'Datos incompletos'], 400);

    $ont = $pdo->prepare("SELECT * FROM ont_seriales WHERE id = ?");
    $ont->execute([$ont_id]);
    $o = $ont->fetch();
    if (!$o) responder(['error' => 'ONT no encontrada'], 404);
    if ($o['estado'] === 'dañado' || $o['estado'] === 'no_disponible') responder(['error' => 'Esta ONT está marcada como dañada, no se puede instalar'], 400);
    if ($o['estado'] === 'comodato') responder(['error' => 'Esta ONT ya está instalada'], 400);

    $usuario = $_SESSION['usuario'] ?? '';
    $rol     = $_SESSION['rol'] ?? '';
    // Instalar una ONT es, en el fondo, un gasto de material — y el
    // municipio reparte material, no lo consume él mismo (igual que con
    // cualquier otro producto: ver api/pedidos.php acción "gastar"). El
    // gasto real en campo lo hace el técnico/persona a quien se le
    // asignó, así que el municipio debe asignarla primero.
    if ($rol === 'municipio') {
        responder(['error' => 'Municipio no instala ONT directamente — asígnala a un técnico primero'], 403);
    }
    // Puede instalar quien sea dueño (la oficina) o quien esté asignado
    // como instalador de esta ONT específica. Superadmin/distribuidor
    // pueden instalar cualquiera (por si toca a mano).
    if (!in_array($rol, ['superadmin','distribuidor'])
        && $o['tecnico_asignado'] !== $usuario
        && $o['tecnico_instalador'] !== $usuario) {
        responder(['error' => 'Esta ONT no está asignada a ti'], 403);
    }
    // Si el que instala es el instalador propuesto (no el dueño), debe
    // haber aceptado la asignación primero — no se puede instalar algo
    // que todavía no aceptó, aunque técnicamente esté "asignada" a él.
    if (!in_array($rol, ['superadmin','distribuidor'])
        && $o['tecnico_asignado'] !== $usuario
        && $o['tecnico_instalador'] === $usuario
        && $o['asignacion_confirmada'] !== 'aceptada') {
        responder(['error' => 'Todavía no has aceptado esta asignación — acéptala primero en "Mis equipos"'], 403);
    }

    // El registro histórico de "quién instaló" es lo que se eligió en el
    // modal (por defecto es quien confirma, pero se puede cambiar).
    // Quien instala NO se puede elegir: es quien tiene la ONT (quien confirma).
    // Un administrador que la marca a mano queda a nombre de quien la tiene asignada.
    $tecnico = in_array($rol, ['superadmin','distribuidor'])
        ? ($o['tecnico_instalador'] ?: ($o['tecnico_asignado'] ?: $usuario))
        : $usuario;
    // Si dijiste que instaló OTRA persona (no tú mismo), queda pendiente
    // hasta que esa persona lo confirme ella misma — así no se puede
    // simplemente inventar que alguien más hizo el trabajo.
    $confirmacion = ($tecnico === $usuario) ? 'confirmada' : 'pendiente';
    $pdo->prepare("UPDATE ont_seriales SET 
        estado='comodato',
        cliente_nombre=?,
        cliente_direccion=?,
        tecnico_instalacion=?,
        instalacion_confirmada=?,
        fecha_instalacion=NOW(),
        fecha_salida=COALESCE(fecha_salida, NOW()),
        gps_lat=?,
        gps_lng=?
        WHERE id=?")
        ->execute([$cliente, $direccion, $tecnico, $confirmacion, $lat, $lng, $ont_id]);

    _logOntHistorial($pdo, $ont_id, 'instalada', "Instalada en \"$cliente\"" . ($direccion?" — $direccion":''), $usuario);
    ontSincronizarStock($pdo, $o['modelo'] ?? '');

    // También queda en el Historial general (junto con gastos, ingresos,
    // etc.), para que se pueda ver todo en un solo lugar.
    try {
        $refOnt = 'ONT::' . ($o['modelo'] ?: '');
        $descInst = "Instalada en \"$cliente\"" . ($direccion ? " — $direccion" : '') . " · Instaló: $tecnico";
        $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,fecha,gps_lat,gps_lng,usuario_destino,pedido_agrupado_id,proyecto_cliente)
            VALUES (?,?,?,1,'unidad',?,?,'aprobado',1,'instalacion',NOW(),?,?,?,?,?)")
            ->execute([$refOnt, 'ONT ' . ($o['modelo'] ?: '') . ' — SN ' . ($o['sn'] ?: ''), $cliente, $usuario, $descInst, $lat, $lng, $tecnico, $loteId, $cliente]);
    } catch (\Throwable $e) { error_log('[cajas/instalar_ont historial] ' . $e->getMessage()); }

    auditar($pdo, 'instalar_ont', 'ont_seriales', "Instalada en \"$cliente\"" . ($direccion ? " — $direccion" : ''), (string)$ont_id);
    responder(['ok' => true]);

/* ══ INSTALACIONES PENDIENTES DE CONFIRMAR (a mi nombre) ══ */
} elseif ($method === 'GET' && $action === 'mis_instalaciones_pendientes') {
    sesionRequerida();
    $usuario = $_SESSION['usuario'] ?? '';
    $stmt = $pdo->prepare("
        SELECT id, mac, sn, modelo, cliente_nombre, cliente_direccion, tecnico_asignado, fecha_instalacion,
               registrado_por
        FROM ont_seriales
        WHERE tecnico_instalacion = ? AND instalacion_confirmada = 'pendiente'
        ORDER BY fecha_instalacion DESC
    ");
    $stmt->execute([$usuario]);
    responder($stmt->fetchAll());

/* ══ CONFIRMAR/DISPUTAR una instalación a mi nombre ══ */
} elseif ($method === 'POST' && $action === 'confirmar_instalacion') {
    sesionRequerida();
    $data = json_decode(file_get_contents('php://input'), true);
    $ontId = intval($data['ont_id'] ?? 0);
    $respuesta = trim($data['respuesta'] ?? ''); // 'confirmada' o 'disputada'
    $motivo = trim($data['motivo'] ?? '');
    $usuario = $_SESSION['usuario'] ?? '';
    if (!$ontId || !in_array($respuesta, ['confirmada','disputada'])) responder(['error' => 'Datos inválidos'], 400);

    $chk = $pdo->prepare("SELECT tecnico_instalacion, sn, cliente_nombre FROM ont_seriales WHERE id = ?");
    $chk->execute([$ontId]);
    $ont = $chk->fetch();
    if (!$ont) responder(['error' => 'ONT no encontrada'], 404);
    if ($ont['tecnico_instalacion'] !== $usuario) responder(['error' => 'Esta instalación no está a tu nombre'], 403);

    if ($respuesta === 'disputada') {
        // Si dice que no fue él, se deshace la instalación por completo —
        // vuelve a "disponible", limpiando los datos del cliente, porque
        // no hay certeza real de que se haya instalado bien (o siquiera
        // ahí). El motivo queda guardado para que el admin lo revise.
        $pdo->prepare("UPDATE ont_seriales SET
                estado = 'disponible',
                instalacion_confirmada = 'disputada',
                motivo_disputa_instalacion = ?,
                cliente_nombre = NULL, cliente_direccion = NULL,
                tecnico_instalacion = NULL, fecha_instalacion = NULL
            WHERE id = ?")
            ->execute([$motivo ?: null, $ontId]);
    } else {
        $pdo->prepare("UPDATE ont_seriales SET instalacion_confirmada = ?, motivo_disputa_instalacion = NULL WHERE id = ?")
            ->execute([$respuesta, $ontId]);
    }

    $msg = $respuesta === 'confirmada'
        ? "$usuario confirmó que instaló esta ONT en \"{$ont['cliente_nombre']}\""
        : "$usuario dice que NO instaló esta ONT en \"{$ont['cliente_nombre']}\" — revisar" . ($motivo ? " — motivo: $motivo" : '');
    try { _logOntHistorial($pdo, $ontId, 'instalada', $msg, $usuario); } catch (\Throwable $e) {}
    auditar($pdo, $respuesta==='confirmada'?'confirmar':'disputar', 'ont_seriales', "ONT ({$ont['sn']}): $msg", (string)$ontId);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   ASIGNAR ONT A UN TÉCNICO (la hace la oficina/municipio)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'asignar_tecnico_ont') {
    sesionRequerida(); noAsignaDistribuidor();
    sesionRequerida();
    $data    = $bodyData;
    $ont_id  = intval($data['ont_id'] ?? 0);
    $tecnico = trim($data['tecnico'] ?? '');
    // Igual que en productos/asignar_a_persona: si viene de "Asignar
    // Multiple", comparte el mismo id de lote para que en Seguimiento
    // aparezca agrupada junto a los demás productos de ese lote.
    $loteIdAsigO = trim($data['lote_id'] ?? '');
    // En "Asignar Multiple" el correo sale una sola vez con todo el lote.
    $silenciarCorreoO = !empty($data['silenciar_correo']);
    $idEnvioAsigO = 0;
    if (!$ont_id || !$tecnico) responder(['error' => 'Datos incompletos'], 400);
    { // Las ONT no se asignan a distribuidor ni a administrador (a ellos se les devuelve), sin importar quién asigna.
        $stRolDest = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?"); $stRolDest->execute([$tecnico]);
        if (in_array($stRolDest->fetchColumn(), ['superadmin','distribuidor'], true)) responder(['error' => 'No puedes asignar una ONT al distribuidor ni al administrador; para enviársela usa "Devolver".'], 403);
    }

    $ont = $pdo->prepare("SELECT * FROM ont_seriales WHERE id = ?");
    $ont->execute([$ont_id]);
    $o = $ont->fetch();
    if (!$o) responder(['error' => 'ONT no encontrada'], 404);

    $rol  = $_SESSION['rol'] ?? '';
    $sede = $_SESSION['sede'] ?? '';
    // Solo municipio (o admin/distribuidor) puede asignar/reasignar una
    // ONT a un técnico — un técnico nunca puede repartir ONT entre sus
    // compañeros, aunque comparta la misma sede que otro. Los productos
    // normales sí se pueden asignar entre técnicos ("Asignar a alguien"),
    // pero las ONT quedan reservadas a nivel de oficina para que el
    // control quede siempre centralizado ahí.
    if (!in_array($rol, ['superadmin','distribuidor','municipio'])) {
        responder(['error' => 'Solo el municipio puede asignar ONT a un técnico'], 403);
    }
    // La oficina (municipio) solo puede asignar ONTs que llegaron a SU sede.
    // También puede asignarla quien la tiene registrada como suya en "Mis equipos" (tecnico_asignado),
    // aunque la sede escrita en la ONT no coincida exacto con la de su cuenta.
    $esSuyaOnt = (($o['tecnico_asignado'] ?? '') !== '' && ($o['tecnico_asignado'] ?? '') === ($_SESSION['usuario'] ?? ''));
    $mismaSedeOnt = strtolower(trim($o['sede_actual'] ?? '')) === strtolower(trim($sede));
    if (!in_array($rol, ['superadmin','distribuidor']) && !$mismaSedeOnt && !$esSuyaOnt) {
        responder(['error' => 'Esta ONT no pertenece a tu sede'], 403);
    }

    // Verificar que el destinatario exista — igual que con cualquier otro
    // material (productos normales, fibra), una ONT se puede asignar tanto
    // a un técnico como a una "persona" (el otro rol que también recibe y
    // gasta material en campo) — antes esto exigía rol='tecnico' exacto, así
    // que asignarla a alguien con rol "persona" fallaba con "Técnico no
    // encontrado" aunque ese usuario sí existiera.
    $tec = $pdo->prepare("SELECT usuario, sede FROM usuarios WHERE usuario = ? AND rol IN ('tecnico','persona')");
    $tec->execute([$tecnico]);
    $t = $tec->fetch();
    if (!$t) responder(['error' => 'Destinatario no encontrado'], 404);

    // Igual que con cualquier otro material del sistema, no se le acredita
    // al técnico de una vez: queda "en camino" en Seguimiento hasta que él
    // mismo confirme que la recibió — antes esta acción asignaba la ONT
    // instantáneamente sin pasar por Seguimiento, así que nunca aparecía
    // nada para "aceptar".
    $pdo->beginTransaction();
    try {
        $pdo->prepare("UPDATE ont_seriales SET estado='despachada' WHERE id=?")->execute([$ont_id]);

        $pdo->prepare("
            INSERT INTO envios_seguimiento
              (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, transportador, estado, notas, fecha_aprobado, fecha_envio)
            VALUES ('asignacion', ?, ?, ?, 1, 'unidad', ?, ?, ?, ?, 'en_camino', ?, NOW(), NOW())
        ")->execute([
            $ont_id,
            'ONT::' . ($o['modelo'] ?? ''),
            trim('ONT ' . ($o['modelo'] ?? '') . ' SN ' . $o['sn']),
            $sede,
            $t['sede'] ?: $sede,
            $_SESSION['usuario'],
            $_SESSION['usuario'],
            // "Destinatario ONT:" y "Seriales:" van en renglones separados
            // (ver nota en seguimiento.php sobre por qué no deben ir unidos).
            "Asignación directa a $tecnico\nRecoge en persona: $tecnico\nDestinatario ONT: $tecnico\nSeriales: {$o['sn']}" . ($loteIdAsigO ? "\nLote: $loteIdAsigO" : ''),
        ]);
        $idEnvioAsigO = (int)$pdo->lastInsertId();

        _logOntHistorial($pdo, $ont_id, 'asignada', "Despachada al técnico $tecnico — pendiente que confirme recibido en Seguimiento", $_SESSION['usuario'] ?? '');

        $pdo->commit();
    } catch (\Throwable $e) {
        $pdo->rollBack();
        error_log('[cajas/asignar_tecnico_ont] ' . $e->getMessage());
        responder(['error' => 'No se pudo asignar la ONT: ' . $e->getMessage()], 500);
    }

    auditar($pdo, 'asignar_tecnico_ont', 'ont_seriales', "ONT SN {$o['sn']} despachada a $tecnico (pendiente de confirmar recibido)", (string)$ont_id);
    // Correo al destinatario avisando que le asignaron la ONT (antes esta
    // acción nunca enviaba ninguno).
    $estadoCorreoO = 'silenciado';
    if (!$silenciarCorreoO && $idEnvioAsigO) {
        try { $estadoCorreoO = notificarAsignacionDirecta($pdo, $idEnvioAsigO); }
        catch (\Throwable $e) { error_log('[cajas/asignar_tecnico_ont notificar] ' . $e->getMessage()); $estadoCorreoO = 'fallo'; }
    }
    responder(['ok' => true, 'envio_id' => $idEnvioAsigO, 'correo' => $estadoCorreoO]);
}

/* ══════════════════════════════════════
   ONTs QUE LLEGARON A MI OFICINA (para asignar a un técnico)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'onts_en_oficina') {
    sesionRequerida();
    // Ya no depende de sede — esto ahora solo muestra "huérfanas" (casos
    // raros: importaciones históricas u otros flujos que no dejaron un
    // dueño asignado). Con el modelo por persona, lo normal es que casi
    // no haya nada aquí, porque lo que se pide llega directo a quien lo pidió.
    $stmt = $pdo->query("SELECT o.*, c.nombre_caja FROM ont_seriales o LEFT JOIN cajas c ON c.id=o.caja_id WHERE o.tecnico_asignado IS NULL AND o.estado='despachada' ORDER BY o.fecha_envio DESC");
    responder($stmt->fetchAll());
}

/* ══════════════════════════════════════
   MIS ONTs ASIGNADAS (para el técnico, pendientes de instalar)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'mis_onts_asignadas') {
    sesionRequerida();
    $usuario = $_SESSION['usuario'] ?? '';
    // Lo que es de esta persona/oficina como dueña (tecnico_asignado), lo
    // que está instalando aunque sea de otra oficina (tecnico_instalador),
    // lo que ya instaló de verdad en algún momento (tecnico_instalacion)
    // — para que le quede su propio registro, aunque hoy ya no sea el
    // dueño ni el instalador asignado de esa ONT — Y TAMBIÉN cualquier
    // ONT que en algún momento pasó por sus manos según ont_historial
    // (ej: un municipio que la asignó a un técnico y, al confirmarla
    // este, dejó de ser el "dueño"). Sin este último OR, en cuanto se
    // reasigna una ONT, quien la entregó la pierde de vista por completo
    // y no puede saber qué pasó con ella.
    $stmt = $pdo->prepare("
        SELECT o.*, c.nombre_caja,
               (o.tecnico_asignado = ?) AS es_dueño,
               (o.tecnico_instalador = ?) AS es_instalador,
               (o.tecnico_instalacion = ?) AS yo_la_instale,
               (EXISTS(SELECT 1 FROM ont_historial h WHERE h.ont_id = o.id AND (h.evento = 'asignada' OR (h.evento = 'reasignada' AND h.detalle LIKE 'Propuesta como instalador%')) AND h.usuario = ?)
                OR EXISTS(SELECT 1 FROM envios_seguimiento sg WHERE sg.tipo = 'asignacion' AND sg.referencia_id = o.id AND sg.ref_producto LIKE 'ONT::%' AND sg.enviado_por = ?)) AS yo_la_asigne,
               COALESCE((SELECT h2.usuario FROM ont_historial h2 WHERE h2.ont_id = o.id AND (h2.evento = 'asignada' OR (h2.evento = 'reasignada' AND h2.detalle LIKE 'Propuesta como instalador%')) ORDER BY h2.id DESC LIMIT 1), (SELECT sg2.enviado_por FROM envios_seguimiento sg2 WHERE sg2.tipo = 'asignacion' AND sg2.referencia_id = o.id AND sg2.ref_producto LIKE 'ONT::%' ORDER BY sg2.id DESC LIMIT 1)) AS asignador_actual
        FROM ont_seriales o
        LEFT JOIN cajas c ON c.id=o.caja_id
        WHERE o.tecnico_asignado = ? OR o.tecnico_instalador = ? OR o.tecnico_instalacion = ?
           OR o.id IN (SELECT DISTINCT ont_id FROM ont_historial WHERE usuario = ?)
        ORDER BY COALESCE(o.fecha_asignacion, o.fecha_envio) DESC
    ");
    $stmt->execute([$usuario, $usuario, $usuario, $usuario, $usuario, $usuario, $usuario, $usuario, $usuario]);
    responder($stmt->fetchAll());
}

/* ══ DEVOLVER ONT (destino según quién la devuelve) ══
   A diferencia de "devolver_ont" (que la deja disponible en la misma
   oficina, para el mismo dueño), esto libera la ONT hacia OTRA persona
   — pasa por Seguimiento, y solo al confirmarse recibida se libera de
   verdad. El destino depende del rol de quien devuelve:
     - Técnico   → su propio municipio (quien se la asignó), NUNCA
                   directo al almacén central — un técnico no le
                   reporta al almacén central, le reporta a su oficina.
     - Municipio/superadmin/distribuidor → almacén central directo. */
if ($method === 'POST' && $action === 'devolver_ont_almacen') {
    sesionRequerida();
    $data  = json_decode(file_get_contents('php://input'), true);
    $ontId = intval($data['ont_id'] ?? 0);
    $motivo = trim($data['motivo'] ?? '');
    $transportador = trim($data['transportador'] ?? '');
    if (!$ontId) responder(['error' => 'ID requerido'], 400);
    if (!$transportador) responder(['error' => 'Indica quién lo transporta'], 400);

    $chkOnt = $pdo->prepare("SELECT tecnico_asignado, estado, sn, mac_fmt, modelo, sede_actual FROM ont_seriales WHERE id = ?");
    $chkOnt->execute([$ontId]);
    $ont = $chkOnt->fetch();
    if (!$ont) responder(['error' => 'ONT no encontrada'], 404);

    $rol = $_SESSION['rol'] ?? '';
    $miUsuario = $_SESSION['usuario'] ?? '';
    if (!in_array($rol, ['superadmin','distribuidor']) && $ont['tecnico_asignado'] !== $miUsuario) {
        responder(['error' => 'Esta ONT no es de tu oficina, no la puedes devolver'], 403);
    }
    if (!in_array($ont['estado'], ['disponible', 'dañado', 'no_disponible'])) {
        responder(['error' => 'Solo se puede devolver una ONT disponible, dañada o no disponible (no instalada)'], 400);
    }

    // Técnico y persona devuelven a SU municipio (quien se la asignó),
    // nunca directo al almacén central — solo municipio/admin/distribuidor
    // pueden mandarla directo al almacén.
    //
    // El destino se calcula por SEDE (así funciona la confirmación en
    // Seguimiento: "recibido" exige que $_SESSION['sede'] coincida con el
    // destino). Antes se usaba la sede del propio técnico, pero si esa
    // sede ya no tiene ninguna cuenta de municipio creada, la ONT queda
    // en camino sin que nadie la pueda recibir nunca. Por eso ahora se
    // busca primero la sede del municipio que REALMENTE le asignó esta
    // ONT al técnico (queda registrado en ont_historial al asignarla), y
    // solo si no se puede determinar se usa la sede del técnico como antes.
    $destino = 'Almacen Central';
    $receptorMunicipio = null;
    if (in_array($rol, ['tecnico', 'persona'])) {
        $destino = '';
        try {
            $asig = $pdo->prepare("SELECT usuario FROM ont_historial WHERE ont_id = ? AND evento = 'asignada' AND usuario <> ? ORDER BY id DESC LIMIT 1");
            $asig->execute([$ontId, $miUsuario]);
            $municipioAsigno = $asig->fetchColumn();
            if (!$municipioAsigno) {
                // Asignación registrada solo en Seguimiento (tipo 'asignacion')
                $asig2 = $pdo->prepare("SELECT enviado_por FROM envios_seguimiento WHERE tipo = 'asignacion' AND referencia_id = ? AND ref_producto LIKE 'ONT::%' AND enviado_por <> ? ORDER BY id DESC LIMIT 1");
                $asig2->execute([$ontId, $miUsuario]);
                $municipioAsigno = $asig2->fetchColumn();
            }
            if ($municipioAsigno) {
                $sedeMun = $pdo->prepare("SELECT sede, rol FROM usuarios WHERE usuario = ?");
                $sedeMun->execute([$municipioAsigno]);
                $rowMun = $sedeMun->fetch();
                $sedeEncontrada = trim($rowMun['sede'] ?? '');
                if ($sedeEncontrada) $destino = $sedeEncontrada;
                if (($rowMun['rol'] ?? '') === 'municipio') $receptorMunicipio = $municipioAsigno;
            }
        } catch (\Throwable $e) { error_log('[devolver_ont_almacen buscar municipio] ' . $e->getMessage()); }
        if (!$destino) $destino = $_SESSION['sede'] ?? '';
    }
    if (in_array($rol, ['tecnico', 'persona']) && !$destino) responder(['error' => 'No se pudo determinar tu municipio'], 400);

    $pdo->prepare("UPDATE ont_seriales SET estado = 'en_transito_almacen', tecnico_instalador = NULL, asignacion_confirmada = NULL WHERE id = ?")->execute([$ontId]);

    try {
        $pdo->prepare("
            INSERT INTO envios_seguimiento
              (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, transportador, estado, notas, fecha_aprobado, fecha_envio)
            VALUES ('ont_devolucion', ?, ?, ?, 1, 'unidad', ?, ?, ?, ?, 'en_camino', ?, NOW(), NOW())
        ")->execute([
            $ontId, 'ONT::' . ($ont['modelo'] ?: ''), 'ONT ' . ($ont['modelo'] ?: '') . ' — SN ' . ($ont['sn'] ?: ''),
            $ont['sede_actual'] ?: $_SESSION['sede'], $destino, $miUsuario, $transportador,
            "Devolución de ONT SN {$ont['sn']}" . ($motivo ? " — $motivo" : '')
              . "\nSeriales: {$ont['sn']}"
              . (in_array($ont['estado'], ['dañado', 'no_disponible']) ? "\nEstado previo: no_disponible" : '')
              . ($receptorMunicipio ? "\nRecoge en persona: {$receptorMunicipio}" : ''),
        ]);
    } catch (\Throwable $e) {
        error_log('[devolver_ont_almacen seguimiento] ' . $e->getMessage());
        responder(['error' => 'No se pudo iniciar la devolución'], 500);
    }

    try {
        _logOntHistorial($pdo, $ontId, 'en_transito_almacen', "En camino de vuelta al almacén central" . ($motivo ? " — $motivo" : ''), $miUsuario);
    } catch (\Throwable $e) {}

    auditar($pdo, 'devolver_ont_almacen', 'ont_seriales', "Inició devolución al almacén de ONT SN {$ont['sn']}", (string)$ontId);
    responder(['ok' => true]);
}

if ($method === 'POST' && $action === 'devolver_ont') {
    sesionRequerida();
    $data   = json_decode(file_get_contents('php://input'), true);
    $ontId  = intval($data['ont_id'] ?? 0);
    $tipo   = trim($data['tipo'] ?? ''); // 'reutilizable' o 'dañado'
    $motivo = trim($data['motivo'] ?? '');
    if (!$ontId) responder(['error' => 'ID requerido'], 400);
    if (!in_array($tipo, ['reutilizable','dañado'])) responder(['error' => 'Indica si es reutilizable o si llega dañada'], 400);

    $chkOnt = $pdo->prepare("SELECT tecnico_asignado, tecnico_instalador, estado, sn, mac FROM ont_seriales WHERE id = ?");
    $chkOnt->execute([$ontId]);
    $ont = $chkOnt->fetch();
    if (!$ont) responder(['error' => 'ONT no encontrada'], 404);

    $rol = $_SESSION['rol'] ?? '';
    $miUsuario = $_SESSION['usuario'] ?? '';
    // Solo el dueño real (a quien se le envió) puede recoger/devolver — el
    // técnico instalador puede variar con el tiempo, no siempre es la
    // misma persona.
    if (!in_array($rol, ['superadmin','distribuidor']) && $ont['tecnico_asignado'] !== $miUsuario) {
        responder(['error' => 'Esta ONT no es de tu oficina, no la puedes recoger'], 403);
    }

    // Nunca se le quita el dueño real (la oficina) — sea reutilizable o
    // dañada, sigue apareciendo bajo esa oficina, solo cambia el estado.
    // Lo único que se limpia es a quién estaba instalada (ya no aplica) y
    // los datos del cliente anterior.
    if ($tipo === 'reutilizable') {
        $pdo->prepare("UPDATE ont_seriales SET estado='disponible', tecnico_instalador=NULL, cliente_nombre=NULL, cliente_direccion=NULL, tecnico_instalacion=NULL, fecha_instalacion=NULL WHERE id = ?")
            ->execute([$ontId]);
        $msg = 'Devuelta a disponible (sigue siendo de la misma oficina)';
    } else {
        $pdo->prepare("UPDATE ont_seriales SET estado='dañado', tecnico_instalador=NULL WHERE id = ?")
            ->execute([$ontId]);
        $msg = 'Marcada como dañada (sigue registrada en la misma oficina)';
    }

    try {
        _logOntHistorial($pdo, $ontId, 'devuelta', $msg . ($motivo ? " — $motivo" : ''), $_SESSION['usuario'] ?? '');
    } catch (\Throwable $e) { error_log('[devolver_ont trazabilidad] '.$e->getMessage()); }

    auditar($pdo, 'devolver', 'ont_seriales', "ONT ({$ont['sn']}) $msg — sigue siendo de {$ont['tecnico_asignado']}", (string)$ontId);
    responder(['ok' => true]);
}

/* ══ ASIGNAR TÉCNICO INSTALADOR (no cambia el dueño real) ══
   La oficina/municipio sigue siendo la dueña de la ONT — esto solo marca
   quién la va a instalar. Para devolverla al almacén de verdad, existe
   el flujo aparte "Devolver ONT". */
if ($method === 'POST' && $action === 'reasignar_ont') {
    sesionRequerida();
    $data   = json_decode(file_get_contents('php://input'), true);
    $ontId  = intval($data['ont_id'] ?? 0);
    $nuevo  = trim($data['nuevo_usuario'] ?? '');
    if (!$ontId || !$nuevo) responder(['error' => 'Datos requeridos'], 400);
    if ($nuevo === ($_SESSION['usuario'] ?? '')) responder(['error' => 'No puedes asignártela a ti mismo'], 400);
    { // Las ONT no se asignan a distribuidor ni a administrador (a ellos se les devuelve), sin importar quién asigna.
        $stRolDest = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?"); $stRolDest->execute([$nuevo]);
        if (in_array($stRolDest->fetchColumn(), ['superadmin','distribuidor'], true)) responder(['error' => 'No puedes asignar una ONT al distribuidor ni al administrador; para enviársela usa "Devolver".'], 403);
    }

    $chkOnt = $pdo->prepare("SELECT tecnico_asignado, tecnico_instalador, estado, sn, mac FROM ont_seriales WHERE id = ?");
    $chkOnt->execute([$ontId]);
    $ont = $chkOnt->fetch();
    if (!$ont) responder(['error' => 'ONT no encontrada'], 404);
    if ($ont['estado'] === 'comodato') responder(['error' => 'Esta ONT ya está instalada, no se puede reasignar'], 400);
    if ($ont['estado'] === 'dañado' || $ont['estado'] === 'no_disponible') responder(['error' => 'Esta ONT está dañada, no se puede reasignar'], 400);

    $rol = $_SESSION['rol'] ?? '';
    if (!in_array($rol, ['superadmin','distribuidor']) && $ont['tecnico_asignado'] !== ($_SESSION['usuario'] ?? '')) {
        responder(['error' => 'Esta ONT no es de tu oficina, no la puedes asignar'], 403);
    }

    $chkDestino = $pdo->prepare("SELECT usuario FROM usuarios WHERE usuario = ? AND estado = 'activo'");
    $chkDestino->execute([$nuevo]);
    if (!$chkDestino->fetch()) responder(['error' => 'Esa persona no existe o está inactiva'], 404);

    $pdo->prepare("UPDATE ont_seriales SET tecnico_instalador = ?, asignacion_confirmada = 'pendiente', motivo_rechazo_asignacion = NULL WHERE id = ?")
        ->execute([$nuevo, $ontId]);

    try {
        _logOntHistorial($pdo, $ontId, 'reasignada', "Propuesta como instalador a $nuevo (pendiente de que él acepte) — sigue siendo de {$ont['tecnico_asignado']}", $_SESSION['usuario'] ?? '');
    } catch (\Throwable $e) { error_log('[reasignar_ont trazabilidad] '.$e->getMessage()); }

    auditar($pdo, 'reasignar', 'ont_seriales', "ONT ({$ont['sn']}) propuesta como instalador a $nuevo, pendiente de aceptar (dueña sigue: {$ont['tecnico_asignado']})", (string)$ontId);
    responder(['ok' => true]);
}

/* ══ ACEPTAR / RECHAZAR una asignación de instalador propuesta a mí ══ */
if ($method === 'POST' && $action === 'responder_asignacion_ont') {
    sesionRequerida();
    $data = json_decode(file_get_contents('php://input'), true);
    $ontId = intval($data['ont_id'] ?? 0);
    $respuesta = trim($data['respuesta'] ?? ''); // 'aceptada' o 'rechazada'
    $motivo = trim($data['motivo'] ?? '');
    $usuario = $_SESSION['usuario'] ?? '';
    if (!$ontId || !in_array($respuesta, ['aceptada','rechazada'])) responder(['error' => 'Datos inválidos'], 400);

    $chk = $pdo->prepare("SELECT tecnico_instalador, tecnico_asignado, sn FROM ont_seriales WHERE id = ?");
    $chk->execute([$ontId]);
    $ont = $chk->fetch();
    if (!$ont) responder(['error' => 'ONT no encontrada'], 404);
    if ($ont['tecnico_instalador'] !== $usuario) responder(['error' => 'Esta asignación no es tuya'], 403);

    if ($respuesta === 'aceptada') {
        // Al aceptar, "tecnico_instalador" (el propuesto) se convierte en
        // el dueño real — se actualiza también "tecnico_asignado", que es
        // el campo que usa el resto del sistema (Mis equipos, devolver,
        // etc.) para saber de quién es esta ONT. Sin esto, quedaba
        // "aceptada" pero seguía apareciendo a nombre de quien la asignó.
        $pdo->prepare("UPDATE ont_seriales SET asignacion_confirmada = 'aceptada', motivo_rechazo_asignacion = NULL, tecnico_asignado = ? WHERE id = ?")->execute([$usuario, $ontId]);
        $msg = "$usuario aceptó la asignación como instalador";
    } else {
        // Se deja VISIBLE como rechazada (con el motivo si lo dio), en vez
        // de borrarla — así la oficina se entera de qué pasó. Si la oficina
        // quiere ofrecérsela a alguien más, usa "Asignar" de nuevo, lo que
        // sobreescribe este rechazo con una propuesta nueva.
        $pdo->prepare("UPDATE ont_seriales SET asignacion_confirmada = 'rechazada', motivo_rechazo_asignacion = ? WHERE id = ?")->execute([$motivo ?: null, $ontId]);
        $msg = "$usuario rechazó la asignación como instalador" . ($motivo ? " — motivo: $motivo" : '');
    }
    try { _logOntHistorial($pdo, $ontId, 'reasignada', $msg, $usuario); } catch (\Throwable $e) {}
    auditar($pdo, $respuesta==='aceptada'?'aceptar':'rechazar', 'ont_seriales', "ONT ({$ont['sn']}): $msg", (string)$ontId);
    responder(['ok' => true]);
}

/* ══ MIS ASIGNACIONES PENDIENTES DE ACEPTAR ══ */
if ($method === 'GET' && $action === 'mis_asignaciones_pendientes') {
    sesionRequerida();
    $usuario = $_SESSION['usuario'] ?? '';
    $stmt = $pdo->prepare("
        SELECT id, mac, sn, modelo, tecnico_asignado
        FROM ont_seriales
        WHERE tecnico_instalador = ? AND asignacion_confirmada = 'pendiente'
        ORDER BY fecha_asignacion DESC
    ");
    $stmt->execute([$usuario]);
    responder($stmt->fetchAll());
}

/* ══════════════════════════════════════
   TRAZABILIDAD DE UNA ONT (buscar por serial/MAC)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'trazabilidad_ont') {
    sesionRequerida();
    $buscar = trim($_GET['serial'] ?? '');
    if (!$buscar) responder(['error' => 'Serial requerido'], 400);

    $ont = $pdo->prepare("SELECT * FROM ont_seriales WHERE sn LIKE ? OR mac LIKE ? OR mac_fmt LIKE ? LIMIT 1");
    $like = "%$buscar%";
    $ont->execute([$like, $like, $like]);
    $o = $ont->fetch();
    if (!$o) responder(['error' => 'No se encontró ninguna ONT con ese serial'], 404);

    // Quién puede ver la trazabilidad de ESTA ont puntual:
    // - superadmin/distribuidor, o cualquiera con el permiso general
    //   'registrar_ont' (como antes: puede buscar cualquier ONT).
    // - cualquier otro usuario (municipio, técnico, persona) SOLO si está
    //   o estuvo relacionado con ella — dueño actual, instalador actual,
    //   quien la instaló, o aparece en su ont_historial por cualquier
    //   motivo (por ejemplo, la asignó en su momento aunque ya no sea
    //   suya). Así el municipio puede ver qué pasó con una ONT que ya
    //   entregó, sin poder curiosear las de los demás.
    $rol = $_SESSION['rol'] ?? '';
    $usuario = $_SESSION['usuario'] ?? '';
    $accesoAmplio = in_array($rol, ['superadmin', 'distribuidor']);
    if (!$accesoAmplio) {
        try {
            $stP = $pdo->prepare("SELECT permisos FROM usuarios WHERE id = ?");
            $stP->execute([$_SESSION['usuario_id'] ?? 0]);
            $perms = json_decode($stP->fetchColumn() ?: '[]', true) ?: [];
            if (empty($perms)) $perms = PERMISOS_DEFAULT_POR_ROL[$rol] ?? [];
            $accesoAmplio = in_array('registrar_ont', $perms);
        } catch (\Throwable $e) { /* sin permiso amplio si algo falla */ }
    }
    if (!$accesoAmplio) {
        $involucrado = in_array($usuario, [$o['tecnico_asignado'], $o['tecnico_instalador'], $o['tecnico_instalacion']], true);
        if (!$involucrado) {
            $chkInv = $pdo->prepare("SELECT 1 FROM ont_historial WHERE ont_id = ? AND usuario = ? LIMIT 1");
            $chkInv->execute([$o['id'], $usuario]);
            $involucrado = (bool)$chkInv->fetchColumn();
        }
        if (!$involucrado) responder(['error' => 'No tienes permiso para ver esta ONT'], 403);
    }

    $hist = $pdo->prepare("SELECT * FROM ont_historial WHERE ont_id = ? ORDER BY fecha ASC");
    $hist->execute([$o['id']]);

    responder(['ont' => $o, 'historial' => $hist->fetchAll()]);
}


/* ══ ELIMINAR ONTs MASIVAMENTE ══ */
if ($method === 'POST' && $action === 'eliminar_ont_masivo') {
    sesionRequerida();
    $rol = $_SESSION['rol'] ?? '';
    if ($rol !== 'superadmin' && $rol !== 'distribuidor')
        responder(['error' => 'Sin permiso para esta accion'], 403);
    $eliminadas = $pdo->exec("DELETE FROM ont_seriales");
    auditar($pdo, 'eliminar_ont_masivo', 'ont_seriales', "⚠ ELIMINÓ TODAS LAS ONT DEL SISTEMA ({$eliminadas} registros)", '');
    responder(['ok'=>true, 'eliminadas'=>(int)$eliminadas]);
}



/* ══ LISTADO PLANO DE TODAS LAS ONTs (tabla estilo MikroWisp) ══ */
if ($method === 'GET' && $action === 'listar_onts_todas') {
    sesionRequerida();
    rolOPermiso(['superadmin'], 'registrar_ont');

    $estado  = trim($_GET['estado']  ?? '');
    $modelo  = trim($_GET['modelo']  ?? '');
    $q       = trim($_GET['q']       ?? '');
    $usuario = trim($_GET['usuario'] ?? '');
    $propiedad = trim($_GET['propiedad'] ?? '');
    $sedeF   = trim($_GET['sede']    ?? '');
    $desde   = trim($_GET['desde']   ?? '');
    $hasta   = trim($_GET['hasta']   ?? '');

    $where = []; $params = [];
    if ($estado === 'no_disponible') {
        // Según cómo se creó el registro, la ONT dañada puede quedar guardada
        // como 'no_disponible' (registro manual) o 'dañado' (importación) —
        // se buscan las dos para no dejar ninguna fuera del filtro.
        $where[] = "estado IN ('no_disponible','dañado')";
    } elseif ($estado !== '') {
        $where[] = "estado = ?"; $params[] = $estado;
    }
    if ($modelo !== '') { $where[] = "modelo = ?"; $params[] = $modelo; }
    if ($usuario !== '') {
        $where[] = "(tecnico_asignado LIKE ? OR tecnico_instalacion LIKE ?)";
        $likeU = "%$usuario%";
        array_push($params, $likeU, $likeU);
    }
    if ($sedeF !== '') { $where[] = "sede_actual LIKE ?"; $params[] = "%$sedeF%"; }
    if ($propiedad === 'bodega') {
        $where[] = "tecnico_asignado IS NULL";
    } elseif ($propiedad === 'asignada') {
        $where[] = "tecnico_asignado IS NOT NULL";
    }
    if ($desde !== '') { $where[] = "DATE(fecha_ingreso) >= ?"; $params[] = $desde; }
    if ($hasta !== '') { $where[] = "DATE(fecha_ingreso) <= ?"; $params[] = $hasta; }
    if ($q !== '') {
        $where[] = "(sn LIKE ? OR mac LIKE ? OR mac_fmt LIKE ? OR modelo LIKE ? OR cliente_nombre LIKE ?)";
        $like = "%$q%";
        array_push($params, $like, $like, $like, $like, $like);
    }
    $sqlWhere = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

    $stmt = $pdo->prepare("SELECT * FROM ont_seriales $sqlWhere ORDER BY id ASC LIMIT 500");
    $stmt->execute($params);
    responder($stmt->fetchAll());
}

/* ══ ESTADÍSTICAS ONTs (para gráfica del resumen) ══ */
if ($method === 'GET' && $action === 'stats_onts') {
    rolRequerido('superadmin','distribuidor');

    // Total por estado global
    $stmt = $pdo->query("
        SELECT estado, COUNT(*) as total
        FROM ont_seriales
        GROUP BY estado
        ORDER BY total DESC
    ");
    $porEstado = $stmt->fetchAll();

    // Total por municipio/sede — ya no se guarda "sede_actual" directo en la
    // ONT, así que se calcula mirando la sede de la persona dueña de cada
    // una (tecnico_asignado → usuarios.sede). Las que todavía no tienen
    // dueño (recién llegadas, sin asignar) se cuentan aparte.
    $stmt2 = $pdo->query("
        SELECT COALESCE(u.sede, 'Sin asignar') as sede_actual, COUNT(*) as total
        FROM ont_seriales o
        LEFT JOIN usuarios u ON u.usuario = o.tecnico_asignado
        WHERE o.estado NOT IN ('vendido')
        GROUP BY COALESCE(u.sede, 'Sin asignar')
        ORDER BY total DESC
        LIMIT 15
    ");
    $porSede = $stmt2->fetchAll();

    // Detalle: dentro de cada municipio, cuánto tiene cada persona.
    $stmt2b = $pdo->query("
        SELECT COALESCE(u.sede, 'Sin asignar') as sede, o.tecnico_asignado as usuario,
               COALESCE(TRIM(CONCAT(u.nombre,' ',u.apellido)), o.tecnico_asignado) as nombre,
               COUNT(*) as total
        FROM ont_seriales o
        LEFT JOIN usuarios u ON u.usuario = o.tecnico_asignado
        WHERE o.tecnico_asignado IS NOT NULL AND o.estado NOT IN ('vendido')
        GROUP BY sede, o.tecnico_asignado
        ORDER BY sede, total DESC
    ");
    $porSedeYPersona = $stmt2b->fetchAll();

    // Total general y disponibles (lo que de verdad está libre en almacén
    // central — si ya tiene tecnico_asignado, es de alguien, no cuenta aquí
    // aunque por algún motivo su estado siga diciendo "disponible")
    $total       = $pdo->query("SELECT COUNT(*) FROM ont_seriales")->fetchColumn();
    $disponibles = $pdo->query("SELECT COUNT(*) FROM ont_seriales WHERE estado='disponible' AND tecnico_asignado IS NULL")->fetchColumn();
    $en_uso      = $pdo->query("SELECT COUNT(*) FROM ont_seriales WHERE estado IN ('comodato','ocupado')")->fetchColumn();

    responder([
        'por_estado'        => $porEstado,
        'por_sede'          => $porSede,
        'por_sede_persona'  => $porSedeYPersona,
        'total'             => (int)$total,
        'disponibles'       => (int)$disponibles,
        'en_uso'            => (int)$en_uso,
    ]);
}

/* ══ CARGA HISTÓRICA DE ONTs (inventario preexistente, NO pasa por seguimiento) ══ */
if ($method === 'POST' && $action === 'registrar_ont_historica') {
    rolOPermiso(['superadmin'], 'registrar_ont');
    $data    = $bodyData;
    $modelo  = trim($data['modelo'] ?? '');
    $mac     = strtoupper(preg_replace('/[^A-Fa-f0-9]/', '', $data['mac'] ?? ''));
    $sn      = strtoupper(trim($data['sn'] ?? ''));
    $estado  = trim($data['estado'] ?? 'disponible');
    $fecha   = trim($data['fecha_ingreso'] ?? '');
    $fechaSalida = trim($data['fecha_salida'] ?? '');
    $llevado = trim($data['llevado_por'] ?? '');
    $destino = trim($data['destino'] ?? '');
    $tecnico = trim($data['tecnico_instalacion'] ?? '');

    $estadosOk = ['disponible','instalado','comodato','recuperado','dañado','de_baja'];
    if (strlen($mac) === 0)             responder(['error' => 'MAC requerida'], 400);
    if (strlen($sn) < 3)               responder(['error' => 'SN inválido'], 400);
    if (!in_array($estado, $estadosOk)) responder(['error' => 'Estado no permitido'], 400);

    // Evitar duplicados por SN
    $dup = $pdo->prepare("SELECT id FROM ont_seriales WHERE sn = ? LIMIT 1");
    $dup->execute([$sn]);
    if ($dup->fetch()) responder(['error' => "El SN $sn ya existe en el sistema"], 409);

    $mac_fmt = $mac; // sin separadores, solo dígitos

    try {
        // INSERT tolerante: solo columnas que existan en ont_seriales.
        $cols = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
        $vals = [
            'mac'                 => $mac,
            'mac_fmt'             => $mac_fmt,
            'sn'                  => $sn,
            'estado'              => $estado,
            'sede_actual'         => $destino ?: null,          // destino → sede_actual
            'destino'             => $destino ?: null,          // si existe la columna destino
            'modelo'              => $modelo ?: null,           // si existe la columna modelo
            'llevado_por'         => $llevado ?: null,          // si existe la columna llevado_por
            'tecnico_instalacion' => $tecnico ?: null,
            'registrado_por'      => ($_SESSION['usuario'] ?? '') . ' (histórico)',
            'fecha_instalacion'   => $fecha ?: null,            // fecha de ingreso
            'fecha_salida'        => $fechaSalida ?: null,      // fecha de salida (si existe la columna)
        ];
        $cc = []; $pp = []; $par = [];
        foreach ($vals as $col => $val) {
            if (in_array($col, $cols)) { $cc[] = $col; $pp[] = '?'; $par[] = $val; }
        }
        if (in_array('fecha', $cols)) { $cc[] = 'fecha'; $pp[] = 'NOW()'; }
        $pdo->prepare("INSERT INTO ont_seriales (" . implode(',', $cc) . ") VALUES (" . implode(',', $pp) . ")")
            ->execute($par);
        $nuevoId = $pdo->lastInsertId();

        try { auditar($pdo, 'carga_historica', 'ont_seriales', "ONT histórica: SN $sn ($estado) → " . ($destino ?: 'sin destino'), $mac); }
        catch (\Throwable $e) { error_log('[ont_historica/auditar] '.$e->getMessage()); }
        responder(['ok' => true, 'sn' => $sn, 'estado' => $estado, 'id' => $nuevoId]);
    } catch (\Throwable $e) {
        error_log('[registrar_ont_historica] '.$e->getMessage());
        responder(['error' => 'No se pudo registrar: '.$e->getMessage()], 500);
    }
}

/* ══ CARGA DE ONTs HISTÓRICAS (preexistentes, NO pasan por seguimiento) ══ */
if ($method === 'POST' && $action === 'cargar_ont_historica') {
    rolOPermiso(['superadmin'], 'registrar_ont');
    $d = json_decode(file_get_contents('php://input'), true) ?? [];
    // Acepta una sola ONT o un lote en 'registros'
    $registros = isset($d['registros']) && is_array($d['registros']) ? $d['registros'] : [ $d ];

    $estadosOk = ['disponible','instalado','recuperado','dañado','de_baja','comodato'];
    $insertadas = 0; $omitidas = 0; $errores = [];

    $pdo->beginTransaction();
    try {
        // Columnas disponibles en la tabla (INSERT tolerante).
        $cols = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
        foreach ($registros as $i => $r) {
            $modelo = trim($r['modelo'] ?? '');
            $mac = strtoupper(preg_replace('/[^A-Fa-f0-9]/', '', $r['mac'] ?? ''));
            $sn  = trim($r['sn'] ?? '');
            $estado = trim($r['estado'] ?? 'disponible');
            $destino = trim($r['destino'] ?? '');
            $llevado = trim($r['llevado_por'] ?? '');
            $tecnico = trim($r['tecnico_instalacion'] ?? '');
            $fecha   = trim($r['fecha_ingreso'] ?? '');
            $fechaSalida = trim($r['fecha_salida'] ?? '');
            if (!in_array($estado, $estadosOk)) $estado = 'disponible';
            if (strlen($mac) === 0 || $sn === '') { $omitidas++; $errores[] = "Fila ".($i+1).": MAC o SN inválido"; continue; }

            // Evitar duplicados por MAC o SN
            $dup = $pdo->prepare("SELECT id FROM ont_seriales WHERE mac=? OR sn=? LIMIT 1");
            $dup->execute([$mac, $sn]);
            if ($dup->fetch()) { $omitidas++; $errores[] = "Fila ".($i+1).": MAC/SN ya existe ($mac)"; continue; }

            $macFmt = $mac; // sin separadores, solo dígitos
            $vals = [
                'mac'                 => $mac,
                'mac_fmt'             => $macFmt,
                'sn'                  => $sn,
                'estado'              => $estado,
                'sede_actual'         => $destino ?: null,
                'destino'             => $destino ?: null,
                'modelo'              => $modelo ?: null,
                'llevado_por'         => $llevado ?: null,
                'tecnico_instalacion' => $tecnico ?: null,
                'registrado_por'      => ($_SESSION['usuario'] ?? '') . ' (histórico)',
                'fecha_instalacion'   => $fecha ?: null,
                'fecha_salida'        => $fechaSalida ?: null,
            ];
            $cc = []; $pp = []; $par = [];
            foreach ($vals as $col => $val) {
                if (in_array($col, $cols)) { $cc[] = $col; $pp[] = '?'; $par[] = $val; }
            }
            if (in_array('fecha', $cols)) { $cc[] = 'fecha'; $pp[] = 'NOW()'; }
            $pdo->prepare("INSERT INTO ont_seriales (" . implode(',', $cc) . ") VALUES (" . implode(',', $pp) . ")")
                ->execute($par);
            $insertadas++;
        }
        $pdo->commit();
        try { auditar($pdo, 'carga_historica', 'ont_seriales', "Carga histórica: $insertadas ONTs, $omitidas omitidas", ''); }
        catch (\Throwable $e) { error_log('[carga_historica/auditar] '.$e->getMessage()); }
        responder(['ok' => true, 'insertadas' => $insertadas, 'omitidas' => $omitidas, 'errores' => array_slice($errores, 0, 10)]);
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('[cargar_ont_historica] '.$e->getMessage());
        responder(['error' => 'No se pudo cargar: '.$e->getMessage()], 500);
    }
}

/* ══ REGISTRAR ONT RECOGIDA — para equipo que un técnico recogió en campo
   (cambio de equipo instalado) y que NUNCA había estado en el sistema.
   La registra el municipio (la oficina), no el técnico directamente —
   el técnico solo la trae físicamente de vuelta. Queda asignada a quien
   la registra, lista para usar el flujo normal de "Devolver". ══ */
if ($method === 'POST' && $action === 'registrar_ont_recogida') {
    sesionRequerida();
    $rol = $_SESSION['rol'] ?? '';
    if (!in_array($rol, ['superadmin', 'distribuidor', 'municipio'])) {
        responder(['error' => 'Solo el municipio puede registrar equipo recogido'], 403);
    }
    $data   = json_decode(file_get_contents('php://input'), true);
    $modelo = trim($data['modelo'] ?? '');
    $serial = trim($data['serial'] ?? '');
    $mac    = trim($data['mac'] ?? '');
    $nota   = trim($data['nota'] ?? '');
    $estadoElegido = trim($data['estado'] ?? 'reutilizable'); // 'reutilizable' | 'dañado'

    if (!$modelo) responder(['error' => 'Falta el modelo'], 400);
    if (!$serial && !$mac) responder(['error' => 'Falta el serial o la MAC'], 400);

    // Evitar duplicados — si ese serial ya existe, no se crea de nuevo.
    if ($serial) {
        $chk = $pdo->prepare("SELECT id FROM ont_seriales WHERE serial = ? OR sn = ?");
        $chk->execute([$serial, $serial]);
        if ($chk->fetch()) responder(['error' => 'Ya existe una ONT registrada con ese serial'], 400);
    }

    $estadoFinal = ($estadoElegido === 'dañado') ? 'dañado' : 'disponible';
    $miUsuario = $_SESSION['usuario'] ?? '';
    $miSede = $_SESSION['sede'] ?? '';
    $notaFinal = "Equipo recogido en campo (cambio de equipo)" . ($nota ? " — $nota" : '');

    try {
        $stmt = $pdo->prepare("
            INSERT INTO ont_seriales
              (serial, modelo, marca, estado, sede_actual, cliente, notas, registrado_por,
               fecha_registro, mac, mac_fmt, sn, tecnico_asignado, fecha_asignacion, motivo_dano)
            VALUES (?, ?, '', ?, ?, '', ?, ?, NOW(), ?, ?, ?, ?, NOW(), ?)
        ");
        $stmt->execute([
            $serial ?: $mac, $modelo, $estadoFinal, $miSede, $notaFinal, $miUsuario,
            $mac, $mac, $serial, $miUsuario,
            $estadoElegido === 'dañado' ? $nota : null,
        ]);
        $nuevoId = $pdo->lastInsertId();
        auditar($pdo, 'registrar_ont_recogida', 'ont_seriales', "Registrada ONT recogida en campo: $modelo — SN {$serial} ({$estadoFinal})", (string)$nuevoId);
        responder(['ok' => true, 'id' => $nuevoId]);
    } catch (\Throwable $e) {
        error_log('[registrar_ont_recogida] ' . $e->getMessage());
        responder(['error' => 'No se pudo registrar la ONT'], 500);
    }
}

responder(['error' => 'Acción no reconocida'], 400);