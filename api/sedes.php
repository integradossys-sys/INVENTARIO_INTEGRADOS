<?php
require 'config.php';
require_once 'auditoria.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

// LISTAR sedes — público (necesario para el registro)
if ($method === 'GET' && $action === 'listar') {
    $tipo    = $_GET['tipo'] ?? null;
    $todas   = $_GET['todas'] ?? null;

    $mostrarTodas = $todas && !empty($_SESSION['rol']) && $_SESSION['rol'] === 'superadmin';

    // Nunca mostrar la sede 'Sistema' en ninguna lista
    $sql    = "SELECT * FROM sedes WHERE nombre NOT IN ('Sistema','Administración')";
    $params = [];
    if ($tipo) {
        $sql .= " AND tipo = ?";
        $params[] = $tipo;
    }
    $sql .= " ORDER BY tipo DESC, nombre";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    // ¿Ya existe un usuario distribuidor activo en el sistema?
    // Si existe, su sede (normalmente "Almacen Central") ya está ocupada
    // y no debe ofrecerse en el registro público.
    $hayDistribuidor = false;
    try {
        $hayDistribuidor = (bool)$pdo->query(
            "SELECT COUNT(*) FROM usuarios WHERE rol='distribuidor' AND estado='activo'"
        )->fetchColumn();
    } catch (\Throwable $e) { error_log('[sedes/listar distrib] '.$e->getMessage()); }

    // Asegurar que activa sea booleano (NULL = activa por defecto)
    foreach ($rows as &$r) {
        $r['activa'] = isset($r['activa']) ? (bool)$r['activa'] : true;
        // Marcar si esta sede ya tiene distribuidor (para ocultarla del registro).
        $r['ocupada_por_distribuidor'] = ($hayDistribuidor && $r['tipo'] === 'central');
    }
    unset($r);
    responder($rows);
}

// CREAR sede (superadmin)
if ($method === 'POST' && $action === 'crear') {
    rolOPermiso(['superadmin'], 'crear_oficinas');
    $data   = json_decode(file_get_contents('php://input'), true);
    $nombre = trim($data['nombre'] ?? '');
    $tipo   = $data['tipo']        ?? 'municipio';
    if (!$nombre) responder(['error' => 'Nombre requerido'], 400);

    $check = $pdo->prepare("SELECT id FROM sedes WHERE nombre = ?");
    $check->execute([$nombre]);
    if ($check->fetch()) responder(['error' => 'Esa sede ya existe'], 400);

    // "Almacen Central" está reservado en TODO el sistema como sinónimo
    // del almacén central (en varios archivos del backend y del
    // frontend) — si una oficina normal usa exactamente ese nombre, el
    // sistema la confunde con el almacén y le muestra material que no es
    // suyo. Se bloquea, salvo que sea justo la sede central que se está
    // creando por primera vez.
    // NOTA: "Neiva" YA NO está reservado — la ciudad real de Neiva puede
    // tener varias oficinas normales con ese nombre sin problema.
    if ($tipo !== 'distribuidor' && $tipo !== 'central' && in_array(mb_strtolower(trim($nombre)), ['almacen central','almacén central','administración','administracion','sistema'])) {
        responder(['error' => '"' . $nombre . '" es un nombre reservado del sistema — usa otro nombre para esta sede.'], 400);
    }

    // Normalizar tipo: distribuidor → central (compatibilidad con el frontend)
    if ($tipo === 'distribuidor') $tipo = 'central';

    // Solo puede haber una sede central
    if ($tipo === 'central') {
        $checkDist = $pdo->query("SELECT COUNT(*) FROM sedes WHERE tipo = 'central' AND nombre != 'Sistema'");
        if ($checkDist->fetchColumn() > 0) {
            responder(['error' => 'Ya existe una sede central. Solo puede haber una.'], 400);
        }
    }

    // Insertar incluyendo descripción si la columna existe en la tabla.
    $descripcion = trim($data['descripcion'] ?? '');
    $sedeCols = $pdo->query("SHOW COLUMNS FROM sedes")->fetchAll(PDO::FETCH_COLUMN);
    if (in_array('descripcion', $sedeCols)) {
        $pdo->prepare("INSERT INTO sedes (nombre, tipo, descripcion) VALUES (?, ?, ?)")
            ->execute([$nombre, $tipo, $descripcion]);
    } else {
        $pdo->prepare("INSERT INTO sedes (nombre, tipo) VALUES (?, ?)")
            ->execute([$nombre, $tipo]);
    }
    $id = $pdo->lastInsertId();

    // Ya no se inicializan filas de stock en la sede — cada persona
    // arranca en 0 y va sumando su propio inventario a medida que recibe.

    auditar($pdo, 'crear', 'sedes', "Sede creada: $nombre ($tipo)", (string)$id);
    responder(['ok' => true, 'id' => $id, 'nombre' => $nombre, 'tipo' => $tipo]);
}

// RESUMEN DE EQUIPOS de una sede (solo cantidades): ONTs por estado y carretes de fibra.
// Lo usa "👁 Ver detalle" en Gestión de oficinas.
if ($method === 'GET' && $action === 'resumen_equipos') {
    rolRequerido('superadmin', 'distribuidor');
    $nombre = trim($_GET['sede'] ?? '');
    if ($nombre === '') responder(['error' => 'Indica la sede'], 400);
    $onts = [];
    try {
        $st = $pdo->prepare("SELECT estado, COUNT(*) AS n FROM ont_seriales WHERE sede_actual = ? GROUP BY estado");
        $st->execute([$nombre]);
        foreach ($st->fetchAll() as $r) $onts[$r['estado']] = (int)$r['n'];
    } catch (\Throwable $e) { error_log('[sedes/resumen_equipos ont] ' . $e->getMessage()); }
    $fibra = [];   // una fila por categoría: carretes y metros disponibles
    try {
        $st = $pdo->prepare("
            SELECT fcat.nombre AS categoria, COUNT(*) AS carretes,
                   COALESCE(SUM(fc.metros - fc.metros_usados),0) AS metros
            FROM fibra_carretes fc
            JOIN fibra_categorias fcat ON fcat.id = fc.categoria_id
            WHERE fc.sede_nombre = ? AND fc.estado = 'disponible'
            GROUP BY fcat.id, fcat.nombre
            ORDER BY fcat.nombre ASC");
        $st->execute([$nombre]);
        foreach ($st->fetchAll() as $r) {
            $fibra[] = ['categoria' => $r['categoria'], 'carretes' => (int)$r['carretes'], 'metros' => (float)$r['metros']];
        }
    } catch (\Throwable $e) { error_log('[sedes/resumen_equipos fibra] ' . $e->getMessage()); }
    responder(['onts' => $onts, 'fibra' => $fibra]);
}

// ACTIVAR/DESACTIVAR sede
if ($method === 'POST' && $action === 'toggle') {
    rolOPermiso(['superadmin'], 'desactivar_sedes');
    $data   = json_decode(file_get_contents('php://input'), true);
    $id     = intval($data['id']     ?? 0);
    $activa = intval($data['activa'] ?? 1);

    if (!$id) responder(['error' => 'ID requerido'], 400);

    // Obtener nombre de la sede
    $sede = $pdo->prepare("SELECT nombre, tipo FROM sedes WHERE id = ?");
    $sede->execute([$id]);
    $sedeRow = $sede->fetch();
    if (!$sedeRow) responder(['error' => 'Sede no encontrada'], 404);
    $sedeNombre = $sedeRow['nombre'];

    // Proteger sede Sistema — nunca se puede desactivar ni modificar
    if ($activa == 0 && ($sedeNombre === 'Sistema' || $sedeRow['tipo'] === 'sistema')) {
        responder(['error' => 'La sede Sistema no se puede desactivar.'], 400);
    }
    // Proteger la sede exclusiva de superadmin — desactivarla lo dejaría
    // sin sede y rompería su login.
    if ($activa == 0 && $sedeNombre === 'Administración') {
        responder(['error' => 'La sede de Administración no se puede desactivar — es la sede exclusiva del superadmin.'], 400);
    }
    // Proteger el almacén central — es donde vive superadmin, y donde
    // se maneja el stock_neiva/stock_recuperado de todo el sistema.
    // Desactivarla dejaría a superadmin sin sede y rompería el login.
    if ($activa == 0 && ($sedeRow['tipo'] === 'central' || $sedeNombre === 'Almacen Central')) {
        responder(['error' => 'El almacén central no se puede desactivar — es donde opera el administrador del sistema.'], 400);
    }

    // Actualizar estado de la sede
    $pdo->prepare("UPDATE sedes SET activa = ? WHERE id = ?")->execute([$activa, $id]);

    if ($activa == 0) {
        // DESACTIVAR — desactivar usuarios de rol municipio cuya sede_id sea esta
        // Los técnicos y personas multi-sede solo se desactivan si esta es su ÚNICA sede
        $usuariosSede = $pdo->prepare("
            SELECT u.id, u.usuario, u.rol FROM usuarios u
            WHERE u.sede_id = ? AND u.estado = 'activo'
            AND u.rol NOT IN ('superadmin', 'distribuidor')
        ");
        $usuariosSede->execute([$id]);
        $usuarios = $usuariosSede->fetchAll();

        $desactivar = $pdo->prepare("UPDATE usuarios SET estado = 'inactivo' WHERE id = ?");

        foreach ($usuarios as $u) {
            if ($u['rol'] === 'municipio') {
                // Municipio siempre se desactiva con la sede
                $desactivar->execute([$u['id']]);
            } else {
                // Técnico/persona: solo desactivar si no tiene otras sedes activas
                $otrasSedes = $pdo->prepare("
                    SELECT COUNT(*) FROM tecnico_sedes ts
                    JOIN sedes s ON s.id = ts.sede_id
                    WHERE ts.usuario_id = ? AND ts.sede_id != ? AND s.activa = 1
                ");
                $otrasSedes->execute([$u['id'], $id]);
                $tieneOtrasSedes = $otrasSedes->fetchColumn() > 0;
                if (!$tieneOtrasSedes) {
                    $desactivar->execute([$u['id']]);
                }
            }
        }
    } else {
        // REACTIVAR — reactivar usuarios inactivos cuya sede_id sea esta
        $pdo->prepare("
            UPDATE usuarios SET estado = 'activo'
            WHERE sede_id = ? AND estado = 'inactivo'
            AND rol NOT IN ('superadmin', 'distribuidor')
        ")->execute([$id]);
    }

    auditar($pdo, $activa==0?'desactivar':'activar', 'sedes', ($activa==0?"Sede desactivada: ":"Sede reactivada: ") . $sedeNombre, (string)$id);
    responder(['ok' => true, 'sede' => $sedeNombre, 'activa' => $activa]);
}

/* ══ ELIMINAR SEDE ══ */
if ($method === 'POST' && $action === 'eliminar') {
    rolOPermiso(['superadmin'], 'eliminar_sedes');
    $data = json_decode(file_get_contents('php://input'), true);
    $id   = intval($data['id'] ?? 0);
    if (!$id) responder(['error' => 'ID requerido'], 400);

    // No permitir eliminar la sede Sistema
    $sede = $pdo->prepare("SELECT * FROM sedes WHERE id = ?");
    $sede->execute([$id]);
    $s = $sede->fetch();
    if (!$s) responder(['error' => 'Sede no encontrada'], 404);
    if ($s['nombre'] === 'Sistema') responder(['error' => 'No se puede eliminar la sede del sistema'], 403);
    if ($s['nombre'] === 'Administración') responder(['error' => 'No se puede eliminar la sede exclusiva del superadmin.'], 403);
    if ($s['tipo'] === 'central' || $s['nombre'] === 'Almacen Central') responder(['error' => 'El almacén central no se puede eliminar — es donde opera el administrador del sistema.'], 403);

    // Verificar que no tenga usuarios activos asignados
    $users = $pdo->prepare("SELECT COUNT(*) FROM usuarios WHERE sede_id = ? AND estado != 'inactivo'");
    $users->execute([$id]);
    if ($users->fetchColumn() > 0) {
        responder(['error' => 'No se puede eliminar — la sede tiene usuarios activos. Desactívalos primero.'], 400);
    }

    // Eliminar stock, usuarios inactivos y la sede
    $pdo->prepare("DELETE FROM stock_sedes WHERE sede_id = ?")->execute([$id]);
    $pdo->prepare("DELETE FROM usuarios WHERE sede_id = ?")->execute([$id]);
    $pdo->prepare("DELETE FROM sedes WHERE id = ?")->execute([$id]);

    auditar($pdo, 'eliminar', 'sedes', "Sede eliminada: {$s['nombre']}", (string)$id);
    responder(['ok' => true]);
}

responder(['error' => 'Acción no reconocida'], 400);