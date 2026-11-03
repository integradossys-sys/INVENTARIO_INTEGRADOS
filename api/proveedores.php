<?php
require 'config.php';
require_once 'auditoria.php';
sesionRequerida();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ══════════════════════════════════════
   Asegurar que la tabla exista (autocreación).
══════════════════════════════════════ */
try {
    $pdo->query("
        CREATE TABLE IF NOT EXISTS proveedores (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            nombre      VARCHAR(150) NOT NULL,
            contacto    VARCHAR(150),
            telefono    VARCHAR(50),
            correo      VARCHAR(150),
            direccion   VARCHAR(250),
            nit         VARCHAR(30),
            nota        TEXT,
            activo      TINYINT(1) DEFAULT 1,
            creado_por  VARCHAR(60),
            creado_en   DATETIME DEFAULT NOW()
        )
    ");
} catch (\Throwable $e) { error_log('[proveedores/crear tabla] '.$e->getMessage()); }

// Si la tabla ya existía de antes con una versión más antigua (le faltan
// columnas que el código actual necesita), se agregan aquí una por una.
try {
    $columnasNecesarias = [
        'contacto'   => "VARCHAR(150)",
        'telefono'   => "VARCHAR(50)",
        'correo'     => "VARCHAR(150)",
        'direccion'  => "VARCHAR(250)",
        'nota'       => "TEXT",
        'activo'     => "TINYINT(1) DEFAULT 1",
        'creado_por' => "VARCHAR(60)",
        'creado_en'  => "DATETIME DEFAULT NOW()",
        'id_mikrowisp' => "VARCHAR(30) DEFAULT NULL",
        'nit'        => "VARCHAR(30) DEFAULT NULL",
    ];
    foreach ($columnasNecesarias as $col => $definicion) {
        $existe = $pdo->query("SHOW COLUMNS FROM proveedores LIKE '$col'")->fetch();
        if (!$existe) {
            $pdo->query("ALTER TABLE proveedores ADD COLUMN $col $definicion");
        }
    }
    // Los proveedores ya existentes se marcan activos por defecto.
    $pdo->query("UPDATE proveedores SET activo = 1 WHERE activo IS NULL");
} catch (\Throwable $e) { error_log('[proveedores/agregar columnas] '.$e->getMessage()); }

/* NIT/RUT: obligatorio. Solo números, puntos y guion (ej: 901593819-1). Se guarda limpio, sin espacios. */
function _provNitLimpio($v): string {
    $v = trim((string)$v);
    $v = preg_replace('/\s+/', '', $v);
    if ($v === '') responder(['error' => 'El NIT/RUT de la empresa es obligatorio'], 400);
    if (!preg_match('/^[0-9][0-9.\-]*$/', $v) || strlen(preg_replace('/\D/', '', $v)) < 6 || strlen($v) > 20) {
        responder(['error' => 'El NIT/RUT no es válido — usa solo números (ej: 901593819-1)'], 400);
    }
    return $v;
}
function _provNitDuplicado($pdo, string $nit, int $exceptoId = 0): ?string {
    // Compara solo los dígitos, para que 901.593.819-1 y 9015938191 cuenten como el mismo NIT
    $dig = preg_replace('/\D/', '', $nit);
    $q = $pdo->prepare("SELECT id, nombre, nit FROM proveedores WHERE activo = 1 AND id <> ? AND nit IS NOT NULL AND nit <> ''");
    $q->execute([$exceptoId]);
    foreach ($q->fetchAll() as $r) {
        if (preg_replace('/\D/', '', $r['nit']) === $dig) return $r['nombre'];
    }
    return null;
}

/* ══════════════════════════════════════
   LISTAR proveedores (cualquier usuario logueado)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'listar') {
    try {
        $stmt = $pdo->query("SELECT * FROM proveedores WHERE activo = 1 ORDER BY nombre");
        responder($stmt->fetchAll());
    } catch (\Throwable $e) {
        error_log('[proveedores/listar] '.$e->getMessage());
        responder([]);
    }
}

/* ══════════════════════════════════════
   CREAR proveedor (requiere permiso de edición de productos)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'crear') {
    rolOPermiso(['superadmin'], 'crear_proveedores');
    $d        = json_decode(file_get_contents('php://input'), true);
    $nombre   = trim($d['nombre']    ?? '');
    $contacto = trim($d['contacto']  ?? '');
    $telefono = trim($d['telefono']  ?? '');
    $correo   = trim($d['correo']    ?? '');
    $direccion= trim($d['direccion'] ?? '');
    $nota     = trim($d['nota']      ?? '');
    $idMkw    = trim($d['id_mikrowisp'] ?? '');
    $nit      = _provNitLimpio($d['nit'] ?? '');

    if ($nombre === '') responder(['error' => 'La razón social del proveedor es obligatoria'], 400);
    if ($contacto === '') responder(['error' => 'La persona de contacto es obligatoria'], 400);
    if (!preg_match('/^[\p{L}][\p{L}\s.\'’-]*$/u', $contacto)) responder(['error' => 'La persona de contacto solo puede llevar letras (sin números)'], 400);
    if ($telefono === '') responder(['error' => 'El teléfono es obligatorio'], 400);

    try {
        // Si ya existe uno ACTIVO con ese nombre, no se permite duplicar.
        $chk = $pdo->prepare("SELECT id FROM proveedores WHERE nombre = ? AND activo = 1");
        $chk->execute([$nombre]);
        if ($chk->fetchColumn()) responder(['error' => 'Ya existe un proveedor con esa razón social'], 409);

        // Si existe uno OCULTO (eliminado antes) con ese mismo nombre, se
        // reactiva con los datos nuevos en vez de intentar crear uno nuevo
        // (la base de datos no permite dos filas con el mismo nombre).
        $dupNit = _provNitDuplicado($pdo, $nit);
        if ($dupNit) responder(['error' => "Ya existe el proveedor \"$dupNit\" con ese mismo NIT/RUT"], 409);

        $chkOculto = $pdo->prepare("SELECT id FROM proveedores WHERE nombre = ? AND activo = 0");
        $chkOculto->execute([$nombre]);
        $idOculto = $chkOculto->fetchColumn();

        if ($idOculto) {
            $pdo->prepare("
                UPDATE proveedores
                SET contacto=?, telefono=?, correo=?, direccion=?, nota=?, activo=1, creado_por=?, id_mikrowisp=?, nit=?
                WHERE id=?
            ")->execute([$contacto, $telefono, $correo, $direccion, $nota, $_SESSION['usuario'] ?? '', $idMkw ?: null, $nit, $idOculto]);
            $id = $idOculto;
        } else {
            $stmt = $pdo->prepare("
                INSERT INTO proveedores (nombre, contacto, telefono, correo, direccion, nota, creado_por, id_mikrowisp, nit)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([$nombre, $contacto, $telefono, $correo, $direccion, $nota, $_SESSION['usuario'] ?? '', $idMkw ?: null, $nit]);
            $id = $pdo->lastInsertId();
        }

        try { auditar($pdo, 'crear', 'proveedores', "Proveedor creado: $nombre", $nombre); } catch (\Throwable $e) {}
        responder(['ok' => true, 'id' => $id]);
    } catch (\Throwable $e) {
        error_log('[proveedores/crear] '.$e->getMessage());
        responder(['error' => 'No se pudo crear: ' . $e->getMessage()], 500);
    }
}

/* ══════════════════════════════════════
   ELIMINAR proveedor (lo marca inactivo, no borra el histórico)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'eliminar') {
    rolOPermiso(['superadmin'], 'eliminar_proveedores');
    $d  = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);

    try {
        $nombre = $pdo->prepare("SELECT nombre FROM proveedores WHERE id = ?");
        $nombre->execute([$id]);
        $nom = $nombre->fetchColumn();
        if (!$nom) responder(['error' => 'Proveedor no encontrado'], 404);

        // No se puede eliminar si todavía hay productos con este proveedor
        // asignado — primero hay que cambiarles el proveedor (o eliminar
        // esos productos) desde "Productos en stock".
        $chkProd = $pdo->prepare("SELECT COUNT(*) FROM productos WHERE proveedor = ?");
        $chkProd->execute([$nom]);
        $totalProd = (int)$chkProd->fetchColumn();
        if ($totalProd > 0) {
            responder(['error' => "No se puede eliminar \"$nom\" — todavía hay $totalProd producto(s) con este proveedor asignado. Cámbialos de proveedor o elimínalos primero desde \"Productos en stock\"."], 400);
        }

        $pdo->prepare("UPDATE proveedores SET activo = 0 WHERE id = ?")->execute([$id]);

        try { auditar($pdo, 'eliminar', 'proveedores', "Proveedor eliminado: $nom", (string)$id); } catch (\Throwable $e) {}
        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[proveedores/eliminar] '.$e->getMessage());
        responder(['error' => 'No se pudo eliminar: ' . $e->getMessage()], 500);
    }
}

/* ══════════════════════════════════════
   ACTUALIZAR proveedor
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'actualizar') {
    rolOPermiso(['superadmin'], 'editar_proveedores');
    $d  = json_decode(file_get_contents('php://input'), true);
    $id = intval($d['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);
    $nombre = trim($d['nombre'] ?? '');
    if ($nombre === '') responder(['error' => 'La razón social es obligatoria'], 400);
    if (trim($d['contacto'] ?? '') === '') responder(['error' => 'La persona de contacto es obligatoria'], 400);
    if (!preg_match('/^[\p{L}][\p{L}\s.\'’-]*$/u', trim($d['contacto']))) responder(['error' => 'La persona de contacto solo puede llevar letras (sin números)'], 400);
    if (trim($d['telefono'] ?? '') === '') responder(['error' => 'El teléfono es obligatorio'], 400);
    $nit = _provNitLimpio($d['nit'] ?? '');

    try {
        $dupNit = _provNitDuplicado($pdo, $nit, $id);
        if ($dupNit) responder(['error' => "Ya existe el proveedor \"$dupNit\" con ese mismo NIT/RUT"], 409);
        $pdo->prepare("
            UPDATE proveedores
            SET nombre = ?, contacto = ?, telefono = ?, correo = ?, direccion = ?, nota = ?, id_mikrowisp = ?, nit = ?
            WHERE id = ?
        ")->execute([
            $nombre,
            trim($d['contacto']  ?? ''),
            trim($d['telefono']  ?? ''),
            trim($d['correo']    ?? ''),
            trim($d['direccion'] ?? ''),
            trim($d['nota']      ?? ''),
            trim($d['id_mikrowisp'] ?? '') ?: null,
            $nit,
            $id
        ]);
        auditar($pdo, 'actualizar_proveedor', 'proveedores', "Actualizado proveedor: $nombre", (string)$id);
        responder(['ok' => true]);
    } catch (\Throwable $e) {
        error_log('[proveedores/actualizar] '.$e->getMessage());
        responder(['error' => 'No se pudo actualizar: ' . $e->getMessage()], 500);
    }
}

responder(['error' => 'Acción no reconocida'], 404);