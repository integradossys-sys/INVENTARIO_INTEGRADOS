<?php
require 'config.php';
require_once 'auditoria.php';
require_once 'ont_sync.php';
sesionRequerida();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ══════════════════════════════════════
   Asegurar que la tabla exista (autocreación).
══════════════════════════════════════ */
try {
    $pdo->query("
        CREATE TABLE IF NOT EXISTS modelos_ont (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            nombre      VARCHAR(150) NOT NULL,
            marca       VARCHAR(100),
            descripcion VARCHAR(250),
            activo      TINYINT(1) DEFAULT 1,
            creado_por  VARCHAR(60),
            creado_en   DATETIME DEFAULT NOW()
        )
    ");
    // La tabla pudo haber existido antes con otros nombres de columna —
    // se agregan las que falten y se recupera el dato si venía guardado
    // bajo un nombre distinto (ej. 'modelo' en vez de 'nombre').
    $colsModelo = $pdo->query("SHOW COLUMNS FROM modelos_ont")->fetchAll(PDO::FETCH_COLUMN);
    $faltantesModelo = [
        'nombre'        => "VARCHAR(150) NOT NULL DEFAULT ''",
        'marca'         => "VARCHAR(100) DEFAULT NULL",
        'descripcion'   => "VARCHAR(250) DEFAULT NULL",
        'id_mikrowisp'  => "VARCHAR(20) DEFAULT NULL",
        'activo'        => "TINYINT(1) DEFAULT 1",
        'creado_por'    => "VARCHAR(60) DEFAULT NULL",
        'creado_en'     => "DATETIME DEFAULT NOW()",
    ];
    foreach ($faltantesModelo as $col => $def) {
        if (!in_array($col, $colsModelo)) {
            $pdo->exec("ALTER TABLE modelos_ont ADD COLUMN $col $def");
        }
    }
    if (!in_array('nombre', $colsModelo)) {
        foreach (['modelo', 'nombre_modelo'] as $alt) {
            if (in_array($alt, $colsModelo)) {
                $pdo->exec("UPDATE modelos_ont SET nombre = $alt WHERE nombre = '' OR nombre IS NULL");
                break;
            }
        }
    }
    if (!in_array('activo', $colsModelo)) {
        $pdo->exec("UPDATE modelos_ont SET activo = 1 WHERE activo IS NULL");
    }
    // La tabla pudo haber existido antes con columnas heredadas de otro uso
    // (ej. 'ref'), marcadas como obligatorias sin valor por defecto — eso
    // rompe el INSERT aunque esas columnas no nos interesen. Se relajan
    // todas las que no sean 'id' ni las que ya llenamos nosotros.
    $propias = ['id','nombre','marca','descripcion','id_mikrowisp','activo','creado_por','creado_en'];
    $infoCols = $pdo->query("
        SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'modelos_ont'
    ")->fetchAll();
    foreach ($infoCols as $c) {
        if (in_array($c['COLUMN_NAME'], $propias)) continue;
        if ($c['IS_NULLABLE'] === 'NO' && $c['COLUMN_DEFAULT'] === null) {
            try { $pdo->exec("ALTER TABLE modelos_ont MODIFY `{$c['COLUMN_NAME']}` {$c['COLUMN_TYPE']} NULL DEFAULT NULL"); }
            catch (\Throwable $e) { error_log('[modelos_ont/relajar columna] '.$e->getMessage()); }
        }
    }
} catch (\Throwable $e) { error_log('[modelos_ont/crear tabla] '.$e->getMessage()); }

/* ══════════════════════════════════════
   LISTAR modelos (cualquier usuario logueado)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'listar') {
    try {
        $stmt = $pdo->query("SELECT * FROM modelos_ont WHERE activo = 1 ORDER BY nombre");
        responder($stmt->fetchAll());
    } catch (\Throwable $e) {
        error_log('[modelos_ont/listar] '.$e->getMessage());
        responder([]);
    }
}

/* ══════════════════════════════════════
   CREAR modelo (superadmin + distribuidor)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'crear') {
    rolRequerido('superadmin', 'distribuidor');
    $data   = json_decode(file_get_contents('php://input'), true) ?? [];
    $nombre = trim($data['nombre'] ?? '');
    $marca  = trim($data['marca'] ?? '');
    $desc   = trim($data['descripcion'] ?? '');
    $idMkw  = trim($data['id_mikrowisp'] ?? '');

    if ($nombre === '') responder(['error' => 'El nombre del modelo es obligatorio'], 400);

    try {
        // Evitar duplicados por nombre
        $dup = $pdo->prepare("SELECT id FROM modelos_ont WHERE nombre = ? AND activo = 1");
        $dup->execute([$nombre]);
        if ($dup->fetch()) responder(['error' => "El modelo \"$nombre\" ya existe"], 409);

        $stmt = $pdo->prepare("INSERT INTO modelos_ont (nombre, marca, descripcion, id_mikrowisp, creado_por)
            VALUES (?,?,?,?,?)");
        $stmt->execute([$nombre, $marca ?: null, $desc ?: null, $idMkw ?: null, $_SESSION['usuario'] ?? '']);
        $id = $pdo->lastInsertId();
        try { auditar($pdo, 'crear', 'modelos_ont', "Modelo de ONT creado: $nombre", $id); } catch (\Throwable $e) {}
        responder(['ok' => true, 'id' => $id]);
    } catch (\Throwable $e) {
        error_log('[modelos_ont/crear] '.$e->getMessage());
        responder(['error' => 'No se pudo crear: ' . $e->getMessage()], 500);
    }
}

/* ══════════════════════════════════════
   ACTUALIZAR modelo (superadmin + distribuidor)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'actualizar') {
    rolRequerido('superadmin', 'distribuidor');
    $data   = json_decode(file_get_contents('php://input'), true) ?? [];
    $id     = intval($data['id'] ?? 0);
    $nombre = trim($data['nombre'] ?? '');
    $marca  = trim($data['marca'] ?? '');
    $desc   = trim($data['descripcion'] ?? '');
    $idMkw  = trim($data['id_mikrowisp'] ?? '');

    if (!$id)           responder(['error' => 'ID requerido'], 400);
    if ($nombre === '') responder(['error' => 'El nombre es obligatorio'], 400);

    try {
        $pdo->prepare("UPDATE modelos_ont SET nombre=?, marca=?, descripcion=?, id_mikrowisp=? WHERE id=?")
            ->execute([$nombre, $marca ?: null, $desc ?: null, $idMkw ?: null, $id]);
        $pdo->prepare("UPDATE productos SET nombre = ? WHERE modelo_ont_id = ?")->execute(["ONT " . $nombre, $id]);
        try { auditar($pdo, 'actualizar', 'modelos_ont', "Modelo de ONT actualizado: $nombre", $id); } catch (\Throwable $e) {}
        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[modelos_ont/actualizar] '.$e->getMessage());
        responder(['error' => 'No se pudo actualizar: ' . $e->getMessage()], 500);
    }
}

/* ══════════════════════════════════════
   ELIMINAR modelo (soft delete) (superadmin + distribuidor)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'eliminar') {
    rolRequerido('superadmin', 'distribuidor');
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $id   = intval($data['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);

    try {
        $pdo->prepare("UPDATE modelos_ont SET activo = 0 WHERE id = ?")->execute([$id]);
        try { auditar($pdo, 'eliminar', 'modelos_ont', "Modelo de ONT eliminado", $id); } catch (\Throwable $e) {}
        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[modelos_ont/eliminar] '.$e->getMessage());
        responder(['error' => 'No se pudo eliminar: ' . $e->getMessage()], 500);
    }
}

responder(['error' => 'Acción no válida'], 400);