<?php
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
require_once 'notificaciones.php';
sesionRequerida();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ── Asegurar que la tabla fibra_categorias tenga todas las columnas
      que el código necesita (por si se creó manualmente, incompleta). ── */
try {
    $pdo->exec("CREATE TABLE IF NOT EXISTS fibra_categorias (
        id          INT AUTO_INCREMENT PRIMARY KEY,
        nombre      VARCHAR(150) NOT NULL,
        tipo        VARCHAR(50) DEFAULT 'general',
        descripcion VARCHAR(250) DEFAULT '',
        proveedor   VARCHAR(150) DEFAULT '',
        color       VARCHAR(20) DEFAULT '#2DB82D',
        creado_por  VARCHAR(60),
        creado_en   DATETIME DEFAULT NOW()
    )");
    $columnasNecesarias = [
        'tipo'        => "VARCHAR(50) DEFAULT 'general'",
        'descripcion' => "VARCHAR(250) DEFAULT ''",
        'proveedor'   => "VARCHAR(150) DEFAULT ''",
        'color'       => "VARCHAR(20) DEFAULT '#2DB82D'",
        'creado_por'  => "VARCHAR(60)",
        'creado_en'   => "DATETIME DEFAULT NOW()",
    ];
    foreach ($columnasNecesarias as $col => $definicion) {
        $existe = $pdo->query("SHOW COLUMNS FROM fibra_categorias LIKE '$col'")->fetch();
        if (!$existe) {
            $pdo->exec("ALTER TABLE fibra_categorias ADD COLUMN $col $definicion");
        }
    }
    // Las categorías ya existentes sin 'tipo' quedan como 'general'.
    $pdo->exec("UPDATE fibra_categorias SET tipo = 'general' WHERE tipo IS NULL OR tipo = ''");
} catch (\Throwable $e) { error_log('[fibra/columnas fibra_categorias] '.$e->getMessage()); }

/* El proveedor se registra en cada CARRETE (no en la categoría). */
$tieneProvCarrete = false;
try {
    if (!$pdo->query("SHOW COLUMNS FROM fibra_carretes LIKE 'proveedor'")->fetch()) {
        $pdo->exec("ALTER TABLE fibra_carretes ADD COLUMN proveedor VARCHAR(150) DEFAULT ''");
    }
    $tieneProvCarrete = (bool)$pdo->query("SHOW COLUMNS FROM fibra_carretes LIKE 'proveedor'")->fetch();
} catch (\Throwable $e) { error_log('[fibra/columna proveedor carretes] '.$e->getMessage()); }

/* ══ CATEGORÍAS ══════════════════════════════ */
if ($method === 'GET' && $action === 'categorias') {
    // Metros disponibles en el almacén central por categoría.
    // Los carretes del almacén se registran con sede_nombre 'Almacen Central'.
    $centrales = $pdo->query("SELECT nombre FROM sedes WHERE tipo IN ('central','distribuidor') AND nombre NOT IN ('Sistema','Administración')")->fetchAll(PDO::FETCH_COLUMN);
    $centrales = array_values(array_unique($centrales));
    $ph = implode(',', array_fill(0, count($centrales), '?'));

    $selProveedores = $tieneProvCarrete
        ? "(SELECT GROUP_CONCAT(DISTINCT c2.proveedor ORDER BY c2.proveedor SEPARATOR ', ')
                   FROM fibra_carretes c2
                   WHERE c2.categoria_id = cat.id AND c2.proveedor IS NOT NULL AND c2.proveedor <> '') AS proveedores"
        : "NULL AS proveedores";
    $stmt = $pdo->prepare("
        SELECT cat.*,
               COALESCE((
                   SELECT SUM(c.metros - c.metros_usados)
                   FROM fibra_carretes c
                   WHERE c.categoria_id = cat.id AND c.sede_nombre IN ($ph)
               ), 0) AS metros_disponibles,
               $selProveedores
        FROM fibra_categorias cat
        ORDER BY cat.tipo, cat.nombre
    ");
    $stmt->execute($centrales);
    responder($stmt->fetchAll());
}

if ($method === 'POST' && $action === 'crear_categoria') {
    rolOPermiso(['superadmin'], 'gestionar_fibra');
    $d = json_decode(file_get_contents('php://input'), true);
    $nombre    = trim($d['nombre'] ?? '');
    $desc      = trim($d['descripcion'] ?? '');
    $proveedor = trim($d['proveedor'] ?? '');
    $color     = $d['color']  ?? '#2DB82D';
    if (!$nombre) responder(['error' => 'Nombre requerido'], 400);
    try {
        $pdo->prepare("INSERT INTO fibra_categorias (nombre,tipo,descripcion,proveedor,color,creado_por) VALUES (?,?,?,?,?,?)")
            ->execute([$nombre,'general',$desc,$proveedor,$color,$_SESSION['usuario']]);
        $idNueva = $pdo->lastInsertId();
        auditar($pdo, 'crear_categoria_fibra', 'fibra_categorias', "Creada categoría de fibra: {$nombre}", (string)$idNueva);
        responder(['ok'=>true,'id'=>$idNueva]);
    } catch (\Throwable $e) {
        error_log('[fibra/crear_categoria] '.$e->getMessage());
        responder(['error' => 'No se pudo crear: ' . $e->getMessage()], 500);
    }
}

if ($method === 'POST' && $action === 'editar_categoria') {
    rolOPermiso(['superadmin'], 'gestionar_fibra');
    $d      = json_decode(file_get_contents('php://input'), true);
    $id        = intval($d['id'] ?? 0);
    $nombre    = trim($d['nombre'] ?? '');
    $desc      = trim($d['descripcion'] ?? '');
    $proveedor = array_key_exists('proveedor', $d) ? trim($d['proveedor'] ?? '') : null;
    $color     = $d['color'] ?? '#2DB82D';
    if (!$id) responder(['error' => 'ID requerido'], 400);
    if (!$nombre) responder(['error' => 'Nombre requerido'], 400);
    if ($proveedor === null) {
        $pdo->prepare("UPDATE fibra_categorias SET nombre=?, descripcion=?, color=? WHERE id=?")
            ->execute([$nombre, $desc, $color, $id]);
    } else {
        $pdo->prepare("UPDATE fibra_categorias SET nombre=?, descripcion=?, proveedor=?, color=? WHERE id=?")
            ->execute([$nombre, $desc, $proveedor, $color, $id]);
    }
    auditar($pdo, 'editar_categoria_fibra', 'fibra_categorias', "Editada categoría de fibra: {$nombre}", (string)$id);
    responder(['ok' => true]);
}

function _categoriaFibraBloqueo(PDO $pdo, int $id): ?string {
    $st = $pdo->prepare("SELECT COUNT(*) FROM fibra_carretes WHERE categoria_id=?");
    $st->execute([$id]);
    $n = (int)$st->fetchColumn();
    if ($n > 0) {
        return "Esta categoría todavía tiene $n carrete(s) registrado(s). Primero elimina los carretes y después podrás eliminar la categoría.";
    }
    return null;
}
if ($method === 'GET' && $action === 'puede_eliminar_categoria') {
    rolOPermisoAlt(['superadmin'], ['eliminar_fibra', 'gestionar_fibra']);
    $m = _categoriaFibraBloqueo($pdo, intval($_GET['id'] ?? 0));
    responder(['ok' => $m === null, 'motivo' => $m]);
}
if ($method === 'POST' && $action === 'eliminar_categoria') {
    rolOPermisoAlt(['superadmin'], ['eliminar_fibra', 'gestionar_fibra']);
    $d  = json_decode(file_get_contents('php://input'), true) ?: [];
    $id = intval($d['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);
    exigirPasswordSesion($d);
    $m = _categoriaFibraBloqueo($pdo, $id);
    if ($m) responder(['error' => $m, 'bloqueado' => true], 400);
    $nombreCat = $pdo->prepare("SELECT nombre FROM fibra_categorias WHERE id=?");
    $nombreCat->execute([$id]);
    $nomCat = $nombreCat->fetchColumn();
    $pdo->prepare("DELETE FROM fibra_categorias WHERE id=?")->execute([$id]);
    auditar($pdo, 'eliminar_categoria_fibra', 'fibra_categorias', "Eliminada categoría: {$nomCat}", (string)$id);
    responder(['ok'=>true]);
}

if ($method === 'POST' && $action === 'eliminar_carrete') {
    rolOPermisoAlt(['superadmin'], ['eliminar_fibra', 'gestionar_fibra']);
    $d  = json_decode(file_get_contents('php://input'), true) ?: [];
    $id = intval($d['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);
    exigirPasswordSesion($d);
    $infoCarrete = $pdo->prepare("SELECT codigo, metros FROM fibra_carretes WHERE id=?");
    $infoCarrete->execute([$id]);
    $carrRow = $infoCarrete->fetch();
    $pdo->prepare("DELETE FROM fibra_gastos WHERE carrete_id=?")->execute([$id]);
    $pdo->prepare("DELETE FROM fibra_carretes WHERE id=?")->execute([$id]);
    auditar($pdo, 'eliminar_carrete', 'fibra_carretes', "Eliminado carrete: " . ($carrRow['codigo'] ?? '') . " ({$carrRow['metros']} mts.)", (string)$id);
    responder(['ok'=>true]);
}

/* ══ CARRETES ════════════════════════════════ */
if ($method === 'GET' && $action === 'listar_carretes') {
    $catId   = intval($_GET['categoria_id'] ?? 0);
    $sedeNom = $_GET['sede'] ?? '';
    $soloCentrales = !empty($_GET['solo_centrales']);
    $where   = ['1=1']; $params = [];
    if ($catId)   { $where[] = 'c.categoria_id=?'; $params[] = $catId; }
    if ($sedeNom) { $where[] = 'c.sede_nombre=?';  $params[] = $sedeNom; }
    if ($soloCentrales) {
        // Solo carretes que siguen en el almacén central (bodega), no los ya
        // recibidos en un municipio/sede — esos se ven en Historial/Seguimiento.
        $centrales = $pdo->query("SELECT nombre FROM sedes WHERE tipo IN ('central','distribuidor') AND nombre NOT IN ('Sistema','Administración')")->fetchAll(PDO::FETCH_COLUMN);
        $centrales[] = 'Almacen Central';
        $centrales = array_values(array_unique($centrales));
        $ph = implode(',', array_fill(0, count($centrales), '?'));
        $where[] = "c.sede_nombre IN ($ph)";
        $params = array_merge($params, $centrales);
    }
    $sql = "SELECT c.*, cat.nombre as cat_nombre, cat.tipo as cat_tipo, cat.color as cat_color,
                   (c.metros - c.metros_usados) as metros_disponibles
            FROM fibra_carretes c
            JOIN fibra_categorias cat ON cat.id = c.categoria_id
            WHERE " . implode(' AND ', $where) . " ORDER BY c.fecha DESC";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    responder($stmt->fetchAll());
}

if ($method === 'POST' && $action === 'registrar_carrete') {
    rolOPermiso(['superadmin'], 'gestionar_fibra');
    $d      = json_decode(file_get_contents('php://input'), true);
    $catId  = intval($d['categoria_id'] ?? 0);
    $metros = floatval($d['metros']     ?? 0);
    $sede   = $d['sede']                ?? 'Almacen Central';
    $nombreManual = trim($d['nombre']   ?? '');
    $provCarrete  = mb_substr(trim($d['proveedor'] ?? ''), 0, 150);
    if (!$catId || $metros <= 0) responder(['error' => 'Categoria y metros requeridos'], 400);

    if ($nombreManual !== '') {
        // El usuario le puso un nombre propio — se usa tal cual, sin generar
        // el código automático. Debe ser único, pero solo DENTRO de la misma
        // categoría — el mismo nombre sí puede repetirse en categorías distintas.
        $chkNombre = $pdo->prepare("SELECT id FROM fibra_carretes WHERE codigo = ? AND categoria_id = ?");
        $chkNombre->execute([$nombreManual, $catId]);
        if ($chkNombre->fetch()) responder(['error' => "Ya existe un carrete con el nombre \"$nombreManual\" en esta categoría"], 400);
        $codigo = $nombreManual;
    } else {
        // Generar código único automático: CAR-001, CAR-002...
        $pdo->exec("INSERT INTO orden_consecutivo (tipo, ultimo) VALUES ('carrete', 0)
                    ON DUPLICATE KEY UPDATE tipo=tipo");
        $pdo->exec("UPDATE orden_consecutivo SET ultimo = ultimo + 1 WHERE tipo = 'carrete'");
        $consec = $pdo->query("SELECT ultimo FROM orden_consecutivo WHERE tipo = 'carrete'")->fetchColumn();
        $codigo = 'CAR-' . str_pad($consec, 3, '0', STR_PAD_LEFT);
    }

    $sedeRow = $pdo->prepare("SELECT id FROM sedes WHERE nombre=?");
    $sedeRow->execute([$sede]);
    $sedeId = $sedeRow->fetchColumn() ?: null;

    if ($tieneProvCarrete) {
        $pdo->prepare("INSERT INTO fibra_carretes (categoria_id,codigo,metros,sede_id,sede_nombre,registrado_por,proveedor) VALUES (?,?,?,?,?,?,?)")
            ->execute([$catId,$codigo,$metros,$sedeId,$sede,$_SESSION['usuario'],$provCarrete]);
    } else {
        $pdo->prepare("INSERT INTO fibra_carretes (categoria_id,codigo,metros,sede_id,sede_nombre,registrado_por) VALUES (?,?,?,?,?,?)")
            ->execute([$catId,$codigo,$metros,$sedeId,$sede,$_SESSION['usuario']]);
    }
    $newId = $pdo->lastInsertId();

    // El alta de un carrete es una CREACIÓN de inventario, no un envío:
    // se registra en auditoría, no en el historial de envíos.
    try {
        $cat = $pdo->prepare("SELECT nombre FROM fibra_categorias WHERE id=?");
        $cat->execute([$catId]);
        $catNom = $cat->fetchColumn();
        auditar($pdo, 'crear', 'fibra', "Ingreso carrete $codigo: $catNom ($metros m) en $sede", $codigo);
        $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,fecha)
            VALUES ('FIBRA',?,?,?,'metros',?,?,'aprobado',0,'ingreso',NOW())")
            ->execute(["Carrete $codigo — $catNom", $sede, (int)round($metros), $_SESSION['usuario'],
                "Registro de carrete $codigo: $catNom · $metros m" . ($provCarrete !== '' ? " · Proveedor: $provCarrete" : '')]);
    } catch (\Exception $e) {}

    responder(['ok'=>true,'id'=>$newId,'codigo'=>$codigo]);
}

/* ══ SALDOS — metros por sede ════════════════ */

// Listar saldos de una sede específica
if ($method === 'GET' && $action === 'saldos_sede') {
    $sedeNom = $_GET['sede'] ?? $_SESSION['sede'];
    $sql = "SELECT s.*, cat.nombre as cat_nombre, cat.color as cat_color, cat.tipo as cat_tipo,
                   (s.metros_total - s.metros_usados) as metros_disponibles
            FROM fibra_saldos s
            JOIN fibra_categorias cat ON cat.id = s.categoria_id
            WHERE s.sede_nombre = ? AND s.metros_total > 0
            ORDER BY cat.nombre";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$sedeNom]);
    responder($stmt->fetchAll());
}

// Enviar metros a municipio (crea carrete en sede destino)
// Devolver metros al almacén central (el técnico regresa fibra que no usó)
if ($method === 'POST' && $action === 'devolver_metros') {
    sesionRequerida();
    $d         = json_decode(file_get_contents('php://input'), true);
    $carreteId = intval($d['carrete_id'] ?? 0);
    $metros    = floatval($d['metros']    ?? 0);
    $desc      = trim($d['descripcion']   ?? '');
    $transportadorF = trim($d['transportador'] ?? '');
    $loteF     = trim($d['lote_id'] ?? '');
    if (!$carreteId || $metros <= 0)
        responder(['error' => 'carrete_id y metros requeridos'], 400);

    $carrete = $pdo->prepare("SELECT c.*, cat.nombre as cat_nombre FROM fibra_carretes c JOIN fibra_categorias cat ON cat.id=c.categoria_id WHERE c.id=?");
    $carrete->execute([$carreteId]);
    $c = $carrete->fetch();
    if (!$c) responder(['error' => 'Carrete no encontrado'], 404);

    // Solo puede devolver quien está en la misma sede donde vive ese carrete (o es su dueño directo)
    $esDuenioF = ($c['usuario_actual'] ?? '') === ($_SESSION['usuario'] ?? '');
    if (!$esDuenioF && strtolower(trim($c['sede_nombre'] ?? '')) !== strtolower(trim($_SESSION['sede'] ?? ''))) {
        responder(['error' => 'Este carrete no pertenece a tu sede'], 403);
    }

    // Destino: Almacén Central, o (técnico/persona) el MUNICIPIO que elija.
    $destinoF = 'Almacen Central';
    if (in_array($_SESSION['rol'] ?? '', ['tecnico', 'persona'], true) && ($d['destino_tipo'] ?? 'almacen') === 'oficina') {
        $sedeEl = trim($d['destino_sede'] ?? '');
        if ($sedeEl === '') responder(['error' => 'Elige a qué municipio devuelves'], 400);
        $chkS = $pdo->prepare("SELECT 1 FROM sedes WHERE nombre = ? AND tipo = 'municipio' LIMIT 1");
        $chkS->execute([$sedeEl]);
        if (!$chkS->fetchColumn()) responder(['error' => 'Elige un municipio válido'], 400);
        $chkM = $pdo->prepare("SELECT 1 FROM usuarios u JOIN sedes s ON s.id = u.sede_id WHERE u.rol = 'municipio' AND u.estado = 'activo' AND s.nombre = ? LIMIT 1");
        $chkM->execute([$sedeEl]);
        if (!$chkM->fetchColumn()) responder(['error' => "En $sedeEl no hay una oficina activa que pueda recibirlo. Elige otro municipio o devuélvelo al Almacén Central."], 400);
        $destinoF = $sedeEl;
    }

    $disponibles = floatval($c['metros']) - floatval($c['metros_usados']);
    if ($metros > $disponibles) responder(['error' => "Solo tienes $disponibles m disponibles"], 400);

    // Restar de la sede origen (igual que un envío normal, solo que en sentido contrario)
    $pdo->prepare("UPDATE fibra_carretes SET metros_usados=metros_usados+?, estado=IF(metros-metros_usados-?<=0,'agotado','disponible') WHERE id=?")
        ->execute([$metros, $metros, $carreteId]);

    // Crear registro de seguimiento hacia el almacén central. Igual que con enviar_metros,
    // el carrete en destino se crea cuando el almacén confirma RECIBIDO.
    $metrosInt = (int)round($metros);
    $pdo->prepare("
        INSERT INTO envios_seguimiento
          (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, transportador, estado, notas, fecha_aprobado, fecha_envio)
        VALUES ('fibra', ?, 'FIBRA', ?, ?, 'metros', ?, ?, ?, ?, 'en_camino', ?, NOW(), NOW())
    ")->execute([
        $c['categoria_id'], $c['cat_nombre'], $metrosInt, $_SESSION['sede'], $destinoF, $_SESSION['usuario'], $transportadorF ?: null,
        ($desc ?: "Devolución desde {$_SESSION['sede']}: {$c['cat_nombre']} ($metros m)") . ($loteF ? "\nLote: $loteF" : '') . "\nDevolución: sí"
    ]);

    try {
        // Por si a la base le falta la columna (antes el error se tragaba y el registro nunca aparecía en el historial)
        try { if (!$pdo->query("SHOW COLUMNS FROM historial LIKE 'usuario_destino'")->fetch()) $pdo->exec("ALTER TABLE historial ADD COLUMN usuario_destino VARCHAR(60) NULL"); } catch (\Throwable $e0) {}
        $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,fecha,usuario_destino)
            VALUES ('FIBRA',?,?,?,'metros',?,?,'aprobado',0,'devolucion',NOW(),?)")
            ->execute([$c['cat_nombre'], $destinoF, $metrosInt, $_SESSION['usuario'],
                       "↩️ Devolución — " . ($desc ?: "Devuelto desde {$_SESSION['sede']}: {$c['cat_nombre']} ($metros m)"), $_SESSION['usuario']]);
    } catch (\Throwable $e) { error_log('[fibra/devolver_metros historial] ' . $e->getMessage()); }

    auditar($pdo, 'devolver_metros_fibra', 'fibra_carretes', "Devolvió {$metros} m de {$c['cat_nombre']} al almacén", (string)$carreteId);
    responder(['ok' => true]);
}

if ($method === 'POST' && $action === 'enviar_metros') {
    rolOPermiso(['superadmin'], 'gestionar_fibra');
    $d         = json_decode(file_get_contents('php://input'), true);
    $carreteId = intval($d['carrete_id']  ?? 0);
    $metros    = floatval($d['metros']    ?? 0);
    $destino   = trim($d['destino']       ?? '');
    $desc      = trim($d['descripcion']   ?? '');
    if (!$carreteId || $metros <= 0 || !$destino)
        responder(['error' => 'carrete_id, metros y destino requeridos'], 400);

    $carrete = $pdo->prepare("SELECT c.*, cat.nombre as cat_nombre FROM fibra_carretes c JOIN fibra_categorias cat ON cat.id=c.categoria_id WHERE c.id=?");
    $carrete->execute([$carreteId]);
    $c = $carrete->fetch();
    if (!$c) responder(['error' => 'Carrete no encontrado'], 404);

    $disponibles = floatval($c['metros']) - floatval($c['metros_usados']);
    if ($metros > $disponibles) responder(['error' => "Solo hay $disponibles m disponibles en el almacén"], 400);

    // Restar de Neiva (el carrete origen se descuenta al despachar)
    $pdo->prepare("UPDATE fibra_carretes SET metros_usados=metros_usados+?, estado=IF(metros-metros_usados-?<=0,'agotado','disponible') WHERE id=?")
        ->execute([$metros, $metros, $carreteId]);

    // Crear registro de seguimiento (igual que los productos).
    // El carrete en la sede destino se crea cuando el envío se marca como RECIBIDO.
    // Para fibra guardamos la categoría en referencia_id, para reconstruir el carrete al recibir.
    $metrosInt = (int)round($metros); // la columna cantidad de seguimiento es entera
    $pdo->prepare("
        INSERT INTO envios_seguimiento
          (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, estado, notas, fecha_aprobado)
        VALUES ('fibra', ?, 'FIBRA', ?, ?, 'metros', 'Almacen Central', ?, ?, 'aprobado', ?, NOW())
    ")->execute([
        $c['categoria_id'], $c['cat_nombre'], $metrosInt, $destino, $_SESSION['usuario'],
        $desc ?: "Fibra para $destino: {$c['cat_nombre']} ($metros m)"
    ]);

    // Historial general (queda como 'en gestión'/aprobado; el recibido genera el ingreso final)
    try {
        $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,fecha)
            VALUES ('FIBRA',?,?,?,'metros',?,?,'aprobado',0,'directo',NOW())")
            ->execute([$c['cat_nombre'], $destino, $metrosInt, $_SESSION['usuario'],
                       $desc ?: "Fibra enviada a $destino: {$c['cat_nombre']} ($metros m)"]);
    } catch (\Exception $e) {}

    auditar($pdo, 'enviar_metros_fibra', 'fibra_carretes', "Envió {$metros} m de {$c['cat_nombre']} a {$destino}", (string)$carreteId);
    responder(['ok' => true]);
}

/* ══ ENVIAR CARRETE COMPLETO (mismo código, no se crea uno nuevo) ══
   A diferencia de "enviar_metros" (que reparte parte de un carrete y crea
   uno distinto en el destino), esto mueve el carrete físico entero — el
   mismo código sigue existiendo, solo cambia de sede/dueño al confirmarse
   recibido. Así siempre se sabe exactamente de dónde salió cada carrete. */
if ($method === 'POST' && $action === 'enviar_carrete_completo') {
    rolOPermiso(['superadmin'], 'gestionar_fibra');
    $d         = json_decode(file_get_contents('php://input'), true);
    $carreteId = intval($d['carrete_id'] ?? 0);
    $destino   = trim($d['destino']      ?? '');
    $desc      = trim($d['descripcion']  ?? '');
    if (!$carreteId || !$destino) responder(['error' => 'carrete_id y destino requeridos'], 400);

    $carrete = $pdo->prepare("SELECT c.*, cat.nombre as cat_nombre FROM fibra_carretes c JOIN fibra_categorias cat ON cat.id=c.categoria_id WHERE c.id=?");
    $carrete->execute([$carreteId]);
    $c = $carrete->fetch();
    if (!$c) responder(['error' => 'Carrete no encontrado'], 404);

    $disponibles = floatval($c['metros']) - floatval($c['metros_usados']);
    if ($disponibles <= 0) responder(['error' => 'Este carrete ya no tiene metros disponibles'], 400);

    // Se marca como "agotado aquí" — no porque se haya gastado, sino porque
    // ya no está en esta sede. Al confirmarse recibido, este MISMO registro
    // se actualiza con la sede nueva (no se crea uno distinto).
    $pdo->prepare("UPDATE fibra_carretes SET metros_usados = metros, estado='en_transito' WHERE id=?")
        ->execute([$carreteId]);

    $metrosInt = (int)round($disponibles);
    $pdo->prepare("
        INSERT INTO envios_seguimiento
          (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, estado, notas, fecha_aprobado)
        VALUES ('fibra_carrete', ?, 'FIBRA', ?, ?, 'metros', ?, ?, ?, 'aprobado', ?, NOW())
    ")->execute([
        $carreteId, $c['cat_nombre'] . ' — ' . $c['codigo'], $metrosInt, $c['sede_nombre'], $destino, $_SESSION['usuario'],
        $desc ?: "Carrete completo {$c['codigo']} ({$c['cat_nombre']}, $metrosInt m) para $destino"
    ]);

    try {
        auditar($pdo, 'enviar', 'fibra', "Carrete {$c['codigo']} enviado completo ($metrosInt m) de {$c['sede_nombre']} a $destino", $c['codigo']);
    } catch (\Throwable $e) {}

    responder(['ok' => true]);
}

/* ══ ASIGNAR CARRETE A PERSONA (directo, desde "Asignar Multiple") ══
   A diferencia de "enviar_carrete_completo"/"enviar_metros" (exclusivo de
   quien administra el almacén, y siempre hacia una SEDE), esto lo puede
   usar cualquiera que ya tenga un carrete a su nombre (mis_carretes) para
   pasárselo a otra persona — igual que "asignar_a_persona" con productos.
   Si se manda "metros" y es MENOR a lo disponible, se reparte solo esa
   parte (se crea un carrete nuevo en destino, el original se queda con el
   resto) — si no se manda o es >= lo disponible, se entrega el ROLLO
   COMPLETO (mismo carrete, cambia de dueño). Cualquiera de los dos casos
   queda "en camino" hasta que la otra persona confirme que lo recibió. */
if ($method === 'POST' && $action === 'asignar_carrete_a_persona') {
    sesionRequerida(); noAsignaDistribuidor();
    // Mismo permiso que "Enviar material" para productos — antes no se
    // validaba nada aquí. Municipio/Técnico/Persona siempre pueden asignar,
    // sin depender de permisos guardados.
    rolOPermiso(['superadmin','municipio','tecnico','persona'], 'enviar_material');
    $d         = json_decode(file_get_contents('php://input'), true);
    $carreteId = intval($d['carrete_id'] ?? 0);
    $aQuien    = trim($d['a_quien']      ?? '');
    $nota      = trim($d['nota']         ?? '');
    $metrosPedidos = isset($d['metros']) ? floatval($d['metros']) : null;
    $usuario   = $_SESSION['usuario'];
    // Igual que en productos/asignar_a_persona: si viene de "Asignar
    // Multiple", comparte el mismo id de lote para que en Seguimiento
    // aparezca agrupado junto a los demás productos de ese lote.
    $loteIdAsigF = trim($d['lote_id'] ?? '');
    // En "Asignar Multiple" el correo sale una sola vez con todo el lote.
    $silenciarCorreoF = !empty($d['silenciar_correo']);
    $idEnvioAsigF = 0;

    if (!$carreteId) responder(['error' => 'carrete_id requerido'], 400);
    if (!$aQuien) responder(['error' => 'Elige a quién se lo asignas'], 400);
    if (!destinoAsignablePorMi($pdo, $aQuien)) responder(['error' => 'No puedes asignarle material al distribuidor ni al administrador; para enviárselo usa "Devolver".'], 403);
    if ($aQuien === $usuario) responder(['error' => 'No puedes asignarte algo a ti mismo'], 400);

    $carrete = $pdo->prepare("SELECT c.*, cat.nombre as cat_nombre FROM fibra_carretes c JOIN fibra_categorias cat ON cat.id=c.categoria_id WHERE c.id=?");
    $carrete->execute([$carreteId]);
    $c = $carrete->fetch();
    if (!$c) responder(['error' => 'Carrete no encontrado'], 404);

    // Solo quien lo tiene a su nombre puede pasarlo a otra persona.
    if ((string)($c['usuario_actual'] ?? '') !== $usuario) {
        responder(['error' => 'Ese carrete no está a tu nombre'], 403);
    }

    $disponibles = floatval($c['metros']) - floatval($c['metros_usados']);
    if ($disponibles <= 0) responder(['error' => 'Este carrete ya no tiene metros disponibles'], 400);

    $destU = $pdo->prepare("SELECT s.nombre AS sede FROM usuarios u LEFT JOIN sedes s ON u.sede_id = s.id WHERE u.usuario = ?");
    $destU->execute([$aQuien]);
    $sedeDestino = $destU->fetchColumn();
    if (!$sedeDestino) responder(['error' => 'Ese usuario no existe o no tiene sede'], 404);

    // ¿Completo o parcial? Si no mandan metros, o piden todo (o más) lo
    // disponible, se toma como el rollo completo. Un margen de 0.01 m
    // evita que un redondeo del frontend deje "casi completo" como parcial.
    $esCompleto = ($metrosPedidos === null || $metrosPedidos <= 0 || $metrosPedidos >= ($disponibles - 0.01));

    if ($esCompleto) {
        // Sale de tu inventario AHORA — el MISMO carrete queda "en tránsito"
        // hasta que la otra persona confirme que lo recibió (igual que
        // productos/ONT) — conserva su código/identidad.
        $pdo->prepare("UPDATE fibra_carretes SET metros_usados = metros, estado='en_transito' WHERE id=?")
            ->execute([$carreteId]);

        $metrosInt = (int)round($disponibles);
        try {
            $pdo->prepare("
                INSERT INTO envios_seguimiento
                  (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, transportador, estado, notas, fecha_aprobado, fecha_envio)
                VALUES ('fibra_carrete', ?, 'FIBRA', ?, ?, 'metros', ?, ?, ?, ?, 'en_camino', ?, NOW(), NOW())
            ")->execute([
                $carreteId, $c['cat_nombre'] . ' — ' . $c['codigo'], $metrosInt, $c['sede_nombre'], $sedeDestino, $usuario, $usuario,
                "Asignación directa a $aQuien" . ($nota ? " — $nota" : '') . "\nRecoge en persona: $aQuien" . ($loteIdAsigF ? "\nLote: $loteIdAsigF" : ''),
            ]);
            $idEnvioAsigF = (int)$pdo->lastInsertId();
        } catch (\Throwable $e) {
            error_log('[fibra/asignar_carrete_a_persona] ' . $e->getMessage());
            // Revertir si no se pudo registrar el envío.
            $pdo->prepare("UPDATE fibra_carretes SET metros_usados = ?, estado='disponible' WHERE id=?")
                ->execute([$c['metros_usados'], $carreteId]);
            responder(['error' => 'No se pudo iniciar la asignación'], 500);
        }
    } else {
        // Parcial: se descuentan solo esos metros del carrete de origen
        // (que se queda con el resto, disponible para seguir repartiendo o
        // usando) — el carrete en destino se crea nuevo cuando la otra
        // persona confirme que lo recibió (igual que "enviar_metros").
        $metrosInt = (int)round($metrosPedidos);
        if ($metrosInt <= 0) responder(['error' => 'Metros inválidos'], 400);

        $pdo->prepare("UPDATE fibra_carretes SET metros_usados=metros_usados+?, estado=IF(metros-metros_usados-?<=0,'agotado','disponible') WHERE id=?")
            ->execute([$metrosInt, $metrosInt, $carreteId]);

        try {
            $pdo->prepare("
                INSERT INTO envios_seguimiento
                  (tipo, referencia_id, ref_producto, nombre_producto, cantidad, unidad, origen, destino, enviado_por, transportador, estado, notas, fecha_aprobado, fecha_envio)
                VALUES ('fibra', ?, 'FIBRA', ?, ?, 'metros', ?, ?, ?, ?, 'en_camino', ?, NOW(), NOW())
            ")->execute([
                $c['categoria_id'], $c['cat_nombre'], $metrosInt, $c['sede_nombre'], $sedeDestino, $usuario, $usuario,
                "Asignación directa a $aQuien" . ($nota ? " — $nota" : '') . " — {$c['codigo']} ($metrosInt m)\nRecoge en persona: $aQuien" . ($loteIdAsigF ? "\nLote: $loteIdAsigF" : ''),
            ]);
            $idEnvioAsigF = (int)$pdo->lastInsertId();
        } catch (\Throwable $e) {
            error_log('[fibra/asignar_carrete_a_persona parcial] ' . $e->getMessage());
            // Revertir si no se pudo registrar el envío.
            $pdo->prepare("UPDATE fibra_carretes SET metros_usados=metros_usados-?, estado='disponible' WHERE id=?")
                ->execute([$metrosInt, $carreteId]);
            responder(['error' => 'No se pudo iniciar la asignación'], 500);
        }
    }

    auditar($pdo, 'asignar_a_persona', 'fibra_carretes', "Asignó {$c['codigo']} ({$c['cat_nombre']}, {$metrosInt} m" . ($esCompleto ? ', completo' : ', parcial') . ") a $aQuien", $c['codigo']);
    // Correo al destinatario avisando que le asignaron la fibra (antes esta
    // acción nunca enviaba ninguno).
    if (!$silenciarCorreoF && $idEnvioAsigF) {
        try { notificarAsignacionDirecta($pdo, $idEnvioAsigF); }
        catch (\Throwable $e) { error_log('[fibra/asignar_carrete_a_persona notificar] ' . $e->getMessage()); }
    }
    responder(['ok' => true, 'envio_id' => $idEnvioAsigF]);
}

// Registrar gasto/envío de metros
if ($method === 'POST' && $action === 'registrar_gasto_fibra') {
    sesionRequerida();
    $d          = json_decode(file_get_contents('php://input'), true);
    $carreteId  = intval($d['carrete_id'] ?? $d['saldo_id'] ?? 0);
    $metros     = floatval($d['metros']   ?? 0);
    $desc       = trim($d['descripcion'] ?? '');
    $destino    = trim($d['sede_destino'] ?? '');
    $proyectoClienteFibra = trim($d['proyecto_cliente'] ?? '') ?: null;
    if (!$carreteId || $metros <= 0)
        responder(['error' => 'carrete_id y metros requeridos'], 400);

    $row = $pdo->prepare("
        SELECT fc.*, fcat.nombre as cat_nombre
        FROM fibra_carretes fc
        JOIN fibra_categorias fcat ON fcat.id = fc.categoria_id
        WHERE fc.id = ?
    ");
    $row->execute([$carreteId]);
    $c = $row->fetch();
    if (!$c) responder(['error' => 'Carrete no encontrado'], 404);

    // Cualquiera puede gastar de SU PROPIO carrete (igual que con un
    // producto normal) — el permiso "gestionar_fibra" solo hace falta
    // para tocar el de alguien más (ej: admin corrigiendo algo ajeno).
    $esDuenio = ($c['usuario_actual'] === ($_SESSION['usuario'] ?? ''));
    if (!$esDuenio) {
        rolOPermiso(['superadmin'], 'gestionar_fibra');
    }

    $disponibles = floatval($c['metros']) - floatval($c['metros_usados']);
    if ($metros > $disponibles)
        responder(['error' => "Solo hay $disponibles m disponibles"], 400);

    $pdo->prepare("UPDATE fibra_carretes SET metros_usados = metros_usados + ? WHERE id = ?")
        ->execute([$metros, $carreteId]);

    // Marcar agotado si no quedan metros
    if (($disponibles - $metros) <= 0) {
        $pdo->prepare("UPDATE fibra_carretes SET estado='agotado' WHERE id=?")->execute([$carreteId]);
    }

    // Registrar en fibra_gastos
    try {
        $pdo->prepare("INSERT INTO fibra_gastos (carrete_id, metros, sede_nombre, registrado_por, descripcion)
            VALUES (?, ?, ?, ?, ?)")
            ->execute([$carreteId, $metros, $destino ?: $c['sede_nombre'],
                       $_SESSION['usuario'], $desc]);
    } catch (\Exception $e) {}

    // Registrar en historial
    $lat = isset($d['lat']) && $d['lat'] !== '' ? floatval($d['lat']) : null;
    $lng = isset($d['lng']) && $d['lng'] !== '' ? floatval($d['lng']) : null;
    $loteIdFibra = trim($d['lote_id'] ?? '') ?: null;
    $historialIdFibra = null;
    try {
        $pdo->prepare("INSERT INTO historial (ref, nombre, destino, cantidad, unidad_envio, enviado_por, descripcion, estado, es_gasto, origen, fecha, usuario_destino, gps_lat, gps_lng, pedido_agrupado_id, proyecto_cliente)
            VALUES ('FIBRA', ?, ?, ?, 'metros', ?, ?, 'aprobado', 1, 'gasto', NOW(), ?, ?, ?, ?, ?)")
            ->execute([$c['cat_nombre'], $destino ?: $c['sede_nombre'],
                       $metros, $_SESSION['usuario'],
                       $desc ?: "Gasto de fibra en " . ($destino ?: $c['sede_nombre']), $_SESSION['usuario'], $lat, $lng, $loteIdFibra, $proyectoClienteFibra]);
        $historialIdFibra = $pdo->lastInsertId();
    } catch (\Exception $e) { error_log('[fibra/registrar_gasto_fibra historial] '.$e->getMessage()); }

    auditar($pdo, 'gastar_fibra', 'fibra_carretes', "Gastó {$metros} m de {$c['cat_nombre']} en " . ($destino ?: $c['sede_nombre']), (string)$carreteId);
    responder(['ok' => true, 'historial_id' => $historialIdFibra]);
}

/* ══ ONT — CAMBIAR ESTADO ════════════════════ */
if ($method === 'POST' && $action === 'cambiar_estado_ont') {
    $d      = json_decode(file_get_contents('php://input'), true);
    $ontId  = intval($d['ont_id'] ?? 0);
    $estado = $d['estado'] ?? '';
    if (!$ontId || !in_array($estado, ['disponible','ocupado','dañado']))
        responder(['error' => 'Datos invalidos'], 400);

    // Solo superadmin/distribuidor, o el técnico al que esta ONT le fue
    // asignada, pueden cambiarle el estado — antes esto estaba abierto a
    // cualquier cuenta logueada, sin importar de quién fuera la ONT.
    $rol = $_SESSION['rol'] ?? '';
    if (!in_array($rol, ['superadmin','distribuidor'])) {
        $chk = $pdo->prepare("SELECT tecnico_asignado FROM ont_seriales WHERE id = ?");
        $chk->execute([$ontId]);
        $tecnicoAsig = $chk->fetchColumn();
        if ($tecnicoAsig !== ($_SESSION['usuario'] ?? null)) {
            responder(['error' => 'Esta ONT no está asignada a ti'], 403);
        }
    }

    $pdo->prepare("UPDATE ont_seriales SET estado=? WHERE id=?")->execute([$estado,$ontId]);

    try {
        $ont = $pdo->prepare("SELECT o.mac_fmt,o.sn,p.nombre,p.ref FROM ont_seriales o JOIN productos p ON p.id=o.producto_id WHERE o.id=?");
        $ont->execute([$ontId]);
        $o = $ont->fetch();
        if ($o) {
            $esGasto = ($estado === 'ocupado') ? 1 : 0;
            $detalle = "ONT estado:$estado MAC:{$o['mac_fmt']} SN:{$o['sn']}";
            $pdo->prepare("INSERT INTO historial (ref,nombre,destino,cantidad,unidad_envio,enviado_por,descripcion,estado,es_gasto,origen,fecha) VALUES (?,?,?,1,'unidad',?,?,'aprobado',?,'gasto',NOW())")
                ->execute([$o['ref'],$o['nombre'],$_SESSION['sede'],$_SESSION['usuario'],$detalle,$esGasto]);
        }
    } catch (\Exception $e) {}

    if (isset($o)) auditar($pdo, 'cambiar_estado_ont', 'ont_seriales', "Cambió estado a \"$estado\" — SN {$o['sn']}", (string)$ontId);
    responder(['ok'=>true]);
}
if ($method === 'GET' && $action === 'carretes_sede') {
    $sede = $_GET['sede'] ?? $_SESSION['sede'] ?? '';
    if (!$sede) responder(['error' => 'Sede requerida'], 400);

    $stmt = $pdo->prepare("
        SELECT fc.*, fcat.nombre as cat_nombre, fcat.tipo as cat_tipo, fcat.color as cat_color,
               (fc.metros - fc.metros_usados) as metros_disponibles
        FROM fibra_carretes fc
        JOIN fibra_categorias fcat ON fcat.id = fc.categoria_id
        WHERE fc.sede_nombre = ?
        ORDER BY fcat.nombre, fc.fecha DESC
    ");
    $stmt->execute([$sede]);
    responder($stmt->fetchAll());
}

/* ══ MIS CARRETES (por persona, ya no por sede) ══ */
if ($method === 'GET' && $action === 'mis_carretes') {
    sesionRequerida();
    $usuario = $_SESSION['usuario'] ?? '';
    $stmt = $pdo->prepare("
        SELECT fc.*, fcat.nombre as cat_nombre, fcat.tipo as cat_tipo, fcat.color as cat_color,
               (fc.metros - fc.metros_usados) as metros_disponibles
        FROM fibra_carretes fc
        JOIN fibra_categorias fcat ON fcat.id = fc.categoria_id
        WHERE fc.usuario_actual = ?
        ORDER BY fcat.nombre, fc.fecha DESC
    ");
    $stmt->execute([$usuario]);
    responder($stmt->fetchAll());
}

/* ══ HISTORIAL FIBRA POR SEDE ═══════════════════ */
if ($method === 'GET' && $action === 'historial_fibra_sede') {
    $sede = $_GET['sede'] ?? $_SESSION['sede'] ?? '';
    if (!$sede) responder(['error' => 'Sede requerida'], 400);

    // Movimientos de uso (registrar_gasto_fibra) en la sede
    $stmt = $pdo->prepare("
        SELECT fg.metros, fg.descripcion, fg.registrado_por, fg.fecha,
               fcat.nombre as cat_nombre, fcat.color as cat_color,
               fc.codigo, 'uso' as tipo
        FROM fibra_gastos fg
        JOIN fibra_carretes fc ON fc.id = fg.carrete_id
        JOIN fibra_categorias fcat ON fcat.id = fc.categoria_id
        WHERE fc.sede_nombre = ? AND fg.metros > 0
        ORDER BY fg.fecha DESC
        LIMIT 100
    ");
    $stmt->execute([$sede]);
    $gastos = $stmt->fetchAll();

    // Envíos recibidos (carretes creados para esta sede)
    $stmt2 = $pdo->prepare("
        SELECT fc.metros as metros, fc.registrado_por, fc.fecha,
               CONCAT('Carrete recibido: ', fc.metros, ' m') as descripcion,
               fcat.nombre as cat_nombre, fcat.color as cat_color,
               fc.codigo, 'recibido' as tipo
        FROM fibra_carretes fc
        JOIN fibra_categorias fcat ON fcat.id = fc.categoria_id
        WHERE fc.sede_nombre = ?
        ORDER BY fc.fecha DESC
        LIMIT 50
    ");
    $stmt2->execute([$sede]);
    $recibidos = $stmt2->fetchAll();

    $todos = array_merge($recibidos, $gastos);
    usort($todos, fn($a,$b) => strtotime($b['fecha']) - strtotime($a['fecha']));
    responder($todos);
}

/* ══ MI HISTORIAL DE FIBRA (por persona, ya no por sede) ══ */
if ($method === 'GET' && $action === 'mi_historial_fibra') {
    sesionRequerida();
    $usuario = $_SESSION['usuario'] ?? '';

    $stmt = $pdo->prepare("
        SELECT fg.metros, fg.descripcion, fg.registrado_por, fg.fecha,
               fcat.nombre as cat_nombre, fcat.color as cat_color,
               fc.codigo, 'uso' as tipo
        FROM fibra_gastos fg
        JOIN fibra_carretes fc ON fc.id = fg.carrete_id
        JOIN fibra_categorias fcat ON fcat.id = fc.categoria_id
        WHERE fc.usuario_actual = ? AND fg.metros > 0
        ORDER BY fg.fecha DESC
        LIMIT 100
    ");
    $stmt->execute([$usuario]);
    $gastos = $stmt->fetchAll();

    $stmt2 = $pdo->prepare("
        SELECT fc.metros as metros, fc.registrado_por, fc.fecha,
               CONCAT('Carrete recibido: ', fc.metros, ' m') as descripcion,
               fcat.nombre as cat_nombre, fcat.color as cat_color,
               fc.codigo, 'recibido' as tipo
        FROM fibra_carretes fc
        JOIN fibra_categorias fcat ON fcat.id = fc.categoria_id
        WHERE fc.usuario_actual = ?
        ORDER BY fc.fecha DESC
        LIMIT 50
    ");
    $stmt2->execute([$usuario]);
    $recibidos = $stmt2->fetchAll();

    $todos = array_merge($recibidos, $gastos);
    usort($todos, fn($a,$b) => strtotime($b['fecha']) - strtotime($a['fecha']));
    responder($todos);
}

/* ══ HISTORIAL COMPLETO DE FIBRA (envíos + gastos + ingresos) ══
   - admin/distribuidor: ven TODOS los movimientos.
   - municipio/técnico/persona: solo los de SU sede.
   Clasificación:
   - envío  = fibra despachada desde la bodega (carrete) hacia OTRA sede.
   - gasto   = fibra consumida en la misma sede donde está el carrete.
   - ingreso = alta de carrete nuevo. */
if ($method === 'GET' && $action === 'historial_fibra_completo') {
    sesionRequerida();
    $rol     = $_SESSION['rol']  ?? '';
    $miSede  = $_SESSION['sede'] ?? '';
    $verTodo = in_array($rol, ['superadmin','distribuidor']);
    $movs = [];

    // 1) Envíos entre sedes (envios_seguimiento, tipo fibra)
    try {
        $st = $pdo->query("SELECT nombre_producto, cantidad, origen, destino, estado,
                                  enviado_por, fecha_aprobado
                           FROM envios_seguimiento WHERE tipo='fibra' ORDER BY fecha_aprobado DESC");
        foreach ($st->fetchAll() as $r) {
            if (!$verTodo && $r['destino'] !== $miSede && $r['origen'] !== $miSede) continue;
            $movs[] = [
                'clase'=>'envio', 'fibra'=>$r['nombre_producto'], 'metros'=>(int)$r['cantidad'],
                'origen'=>$r['origen'], 'destino'=>$r['destino'], 'estado'=>$r['estado'],
                'usuario'=>$r['enviado_por'], 'fecha'=>$r['fecha_aprobado'],
            ];
        }
    } catch (\Exception $e) {}

    // 2) Movimientos de fibra_gastos: pueden ser ENVÍO (carrete en otra sede que el gasto)
    //    o GASTO (mismo lugar). Comparamos la sede del carrete con la sede del gasto.
    try {
        $st = $pdo->query("SELECT fg.metros, fg.descripcion, fg.registrado_por, fg.fecha,
                                  fg.sede_nombre as sede_gasto, fc.sede_nombre as sede_carrete,
                                  fcat.nombre as cat_nombre, fc.codigo
                           FROM fibra_gastos fg
                           JOIN fibra_carretes fc ON fc.id = fg.carrete_id
                           JOIN fibra_categorias fcat ON fcat.id = fc.categoria_id
                           WHERE fg.metros > 0 ORDER BY fg.fecha DESC");
        foreach ($st->fetchAll() as $r) {
            $origen  = $r['sede_carrete'];
            $destino = $r['sede_gasto'] ?: $r['sede_carrete'];
            $esEnvio = ($destino !== $origen); // distinto lugar = despacho
            $clase   = $esEnvio ? 'envio' : 'gasto';
            // Filtrado por sede para roles no-admin
            if (!$verTodo && $destino !== $miSede && $origen !== $miSede) continue;
            $movs[] = [
                'clase'=>$clase, 'fibra'=>$r['cat_nombre'], 'metros'=>(int)$r['metros'],
                'origen'=>$origen, 'destino'=>$destino,
                'estado'=>$clase, 'usuario'=>$r['registrado_por'], 'fecha'=>$r['fecha'],
            ];
        }
    } catch (\Exception $e) {}

    // 3) Ingresos de carrete (fibra_carretes)
    try {
        $st = $pdo->query("SELECT fc.metros, fc.registrado_por, fc.fecha, fc.sede_nombre,
                                  fc.codigo, fcat.nombre as cat_nombre
                           FROM fibra_carretes fc
                           JOIN fibra_categorias fcat ON fcat.id = fc.categoria_id
                           ORDER BY fc.fecha DESC");
        foreach ($st->fetchAll() as $r) {
            if (!$verTodo && $r['sede_nombre'] !== $miSede) continue;
            $movs[] = [
                'clase'=>'ingreso', 'fibra'=>$r['cat_nombre'], 'metros'=>(int)$r['metros'],
                'origen'=>$r['sede_nombre'], 'destino'=>$r['sede_nombre'],
                'estado'=>'ingreso', 'usuario'=>$r['registrado_por'], 'fecha'=>$r['fecha'],
            ];
        }
    } catch (\Exception $e) {}

    usort($movs, fn($a,$b) => strtotime($b['fecha'] ?? '0') - strtotime($a['fecha'] ?? '0'));
    responder($movs);
}

if ($method === 'GET' && $action === 'saldo_total') {
    $total = $pdo->query("SELECT COALESCE(SUM(metros - metros_usados),0) FROM fibra_carretes WHERE estado='disponible'")->fetchColumn();
    responder(['total' => (int)$total]);
}

responder(['error'=>'Accion no reconocida'],400);