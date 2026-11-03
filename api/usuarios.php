<?php
require 'config.php';
require_once 'auditoria.php';
sesionRequerida();

/* ── Permisos por defecto — se toman de PERMISOS_DEFAULT_POR_ROL
   (api/config.php), única fuente de esta lista, para que no se
   desincronice de las demás copias (auth.php, config.php). ── */
function _permisosPorRol(string $rol): array {
    return PERMISOS_DEFAULT_POR_ROL[$rol] ?? PERMISOS_DEFAULT_POR_ROL['persona'];
}

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ══════════════════════════════════════
   LISTAR usuarios DE MI SEDE (cualquier usuario logueado)
   Devuelve solo usuario, nombre y apellido — para selectores
   como "quién realiza el gasto". No expone datos sensibles.
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'usuarios_sede') {
    try {
        // Todos los usuarios activos del sistema (para escoger quién realiza el gasto).
        // Se excluye al superadmin del listado. Solo devuelve datos no sensibles.
        $stmt = $pdo->query("
            SELECT u.usuario, u.nombre, u.apellido, u.rol, s.nombre AS sede
            FROM usuarios u
            LEFT JOIN sedes s ON s.id = u.sede_id
            WHERE u.estado = 'activo' AND u.rol <> 'superadmin'
            ORDER BY u.nombre, u.usuario
        ");
        responder($stmt->fetchAll());
    } catch (\Throwable $e) {
        error_log('[usuarios_sede] ' . $e->getMessage());
        responder([]);
    }
}

/* ══════════════════════════════════════
   LISTAR usuarios (superadmin)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'listar') {
    // superadmin/distribuidor, o cualquiera con un permiso de gestión de usuarios
    // (ej. aprobar_registros): sin esto la pantalla Usuarios daba "no tienes permisos".
    sesionRequerida();
    if (!in_array($_SESSION['rol'] ?? '', ['superadmin','distribuidor'], true)) {
        $okListar = false;
        foreach (['aprobar_registros','gestionar_usuarios','editar_usuarios','asignar_permisos_usuarios','desactivar_usuarios','eliminar_usuarios'] as $pp) {
            if (usuarioTienePermiso($pp)) { $okListar = true; break; }
        }
        if (!$okListar) responder(['error' => 'Sin permisos para esta acción'], 403);
    }
    $incluirTodos = !empty($_GET['todos']) && $_GET['todos'] === '1';
    $filtroAdmin  = $incluirTodos ? '' : "WHERE u.usuario NOT IN ('superadmin')";
    $stmt = $pdo->query("
        SELECT u.id, u.usuario, u.nombre, u.apellido, u.rol, u.tipo, u.cargo,
               u.estado, u.permisos, u.creado_en, u.correo, u.telefono,
               s.nombre as sede, s.id as sede_id
        FROM usuarios u
        LEFT JOIN sedes s ON u.sede_id = s.id
        $filtroAdmin
        ORDER BY FIELD(u.estado,'pendiente','activo','inactivo'), u.creado_en DESC
    ");
    $rows = $stmt->fetchAll();

    $resultado = array_map(function($u) use ($pdo) {
        // Sedes del técnico
        $sedesStmt = $pdo->prepare("
            SELECT s.nombre FROM tecnico_sedes ts
            JOIN sedes s ON s.id = ts.sede_id WHERE ts.usuario_id = ?
        ");
        $sedesStmt->execute([$u['id']]);
        $sedesExtra = $sedesStmt->fetchAll(PDO::FETCH_COLUMN);
        // array_values() al final es clave: array_unique() quita duplicados
        // pero deja "huecos" en las llaves del array (ej: quedan las
        // posiciones 0 y 2, sin la 1) — si un técnico tiene su sede
        // principal repetida en tecnico_sedes (algo común), PHP manda ese
        // array como OBJETO JSON en vez de LISTA, y el frontend truena al
        // intentar hacer u.sedes.includes(...) porque ya no es un array.
        $todasSedes = array_values(array_unique(array_merge([$u['sede']], $sedesExtra)));

        $permisos = $u['permisos'] ? json_decode($u['permisos'], true) : [];

        return [
            'id'       => $u['id'],
            'usuario'  => $u['usuario'],
            'nombre'   => $u['nombre']   ?? '',
            'apellido' => $u['apellido'] ?? '',
            'rol'      => $u['rol'],
            'tipo'     => $u['tipo']     ?? $u['rol'],
            'cargo'    => $u['cargo']    ?? '',
            'sede'     => $u['sede'] ?? 'Sin sede',
            'sede_id'  => $u['sede_id'] ?? null,
            'sedes'    => $todasSedes,
            'estado'   => $u['estado'],
            'permisos' => $permisos,
            'correo'   => $u['correo']   ?? '',
            'telefono' => $u['telefono'] ?? '',
            'creado_en'=> $u['creado_en'],
        ];
    }, $rows);

    responder($resultado);
}

/* ══════════════════════════════════════
   LISTAR TÉCNICOS DE MI SEDE (para municipio, al asignar equipos —
   trae solo lo necesario: nombre y usuario, ni correo ni permisos)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'listar_tecnicos_sede') {
    sesionRequerida();
    $stmt = $pdo->query("
        SELECT usuario, nombre, apellido
        FROM usuarios
        WHERE rol = 'tecnico' AND estado = 'activo'
        ORDER BY nombre
    ");
    responder($stmt->fetchAll());
}

/* ══ LISTAR CUALQUIER USUARIO ACTIVO (para reasignar ONTs, etc.) ══
   Abierto a cualquier sesión — a diferencia de "listar" (superadmin/
   distribuidor), este solo trae usuario/nombre/rol, sin datos sensibles,
   así que no hace falta restringirlo por rol. */
/* Nombres completos de TODOS los usuarios (también inactivos), solo para mostrar "Nombre Apellido"
   en vez del nombre de usuario en pedidos, seguimiento e historial. No incluye rol ni datos de contacto. */
if ($method === 'GET' && $action === 'nombres_usuarios') {
    sesionRequerida();
    $out = [];
    foreach ($pdo->query("SELECT usuario, nombre, apellido FROM usuarios")->fetchAll() as $u) {
        $n = trim(($u['nombre'] ?? '') . ' ' . ($u['apellido'] ?? ''));
        if ($n !== '') $out[$u['usuario']] = $n;
    }
    responder($out);
}

if ($method === 'GET' && $action === 'listar_activos_basico') {
    sesionRequerida();
    $stmt = $pdo->query("
        SELECT usuario, nombre, apellido, rol
        FROM usuarios
        WHERE estado = 'activo'
        ORDER BY nombre
    ");
    responder($stmt->fetchAll());
}

/* ══ TELÉFONOS PARA EL BOTÓN DE WHATSAPP ══
   Solo para quien tiene el permiso usar_whatsapp (o superadmin/distribuidor).
   Devuelve usuario, nombre, apellido y teléfono de los usuarios activos. */
if ($method === 'GET' && $action === 'telefonos_whatsapp') {
    sesionRequerida();
    if (!in_array($_SESSION['rol'] ?? '', ['superadmin','distribuidor']) && !usuarioTienePermiso('usar_whatsapp')) {
        responder(['error' => 'Sin permiso'], 403);
    }
    $stmt = $pdo->query("
        SELECT usuario, nombre, apellido, telefono
        FROM usuarios
        WHERE estado = 'activo' AND telefono IS NOT NULL AND telefono <> ''
    ");
    responder($stmt->fetchAll());
}

/* ══════════════════════════════════════
   LISTAR SEDES (para formulario de registro)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'sedes') {
    $stmt = $pdo->query("SELECT * FROM sedes WHERE activa = 1 AND nombre NOT IN ('Sistema','Administración') ORDER BY tipo, nombre");
    responder($stmt->fetchAll());
}

/* ══════════════════════════════════════
   CAMBIAR ESTADO (aprobar / desactivar)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'estado') {
    rolOPermisoAlt(['superadmin'], ['desactivar_usuarios', 'gestionar_usuarios']);
    $data    = json_decode(file_get_contents('php://input'), true);
    $usuario = $data['usuario'] ?? '';
    $estado  = $data['estado']  ?? '';
    if (!in_array($estado, ['activo','inactivo'])) responder(['error' => 'Estado inválido'], 400);
    // Nadie puede desactivar una cuenta de superadmin desde aquí
    $chkRolT = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?");
    $chkRolT->execute([$usuario]);
    if ($chkRolT->fetchColumn() === 'superadmin') responder(['error' => 'No puedes modificar una cuenta de superadmin.'], 403);
    $pdo->prepare("UPDATE usuarios SET estado = ? WHERE usuario = ?")->execute([$estado, $usuario]);
    auditar($pdo, $estado === 'activo' ? 'aprobar' : 'desactivar', 'usuarios', "Usuario $usuario → estado: $estado", $usuario);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   ELIMINAR / RECHAZAR usuario
══════════════════════════════════════ */

/** Material que todavía tiene un usuario a su nombre (lista de textos; vacía = nada pendiente). */
function _usuarioMaterialPendiente(PDO $pdo, string $usuario): array {
    $p = [];
    $q = $pdo->prepare("SELECT COUNT(*) FROM ont_seriales WHERE tecnico_asignado = ? AND estado != 'comodato'");
    $q->execute([$usuario]); if ($q->fetchColumn() > 0) $p[] = 'ONTs';
    $q = $pdo->prepare("SELECT COUNT(*) FROM stock_usuarios WHERE usuario = ? AND cantidad > 0");
    $q->execute([$usuario]); if ($q->fetchColumn() > 0) $p[] = 'productos en su inventario';
    $q = $pdo->prepare("SELECT COUNT(*) FROM fibra_carretes WHERE usuario_actual = ? AND estado = 'disponible'");
    $q->execute([$usuario]); if ($q->fetchColumn() > 0) $p[] = 'carretes de fibra';
    $q = $pdo->prepare("SELECT COUNT(*) FROM material_recogido WHERE usuario = ? AND estado = 'en_poder'");
    $q->execute([$usuario]); if ($q->fetchColumn() > 0) $p[] = 'material recogido pendiente';
    return $p;
}

if ($method === 'GET' && $action === 'material_pendiente') {
    rolOPermisoAlt(['superadmin'], ['eliminar_usuarios', 'gestionar_usuarios']);
    $u = (string)($_GET['usuario'] ?? '');
    $pp = _usuarioMaterialPendiente($pdo, $u);
    responder(['tiene_material' => count($pp) > 0, 'pendientes' => $pp]);
}

/* RECHAZAR una solicitud de acceso pendiente: la cuenta aún no fue creada/aprobada, así que
   solo se descarta la solicitud (sin contraseña ni revisión de material). */
if ($method === 'POST' && $action === 'rechazar') {
    rolOPermisoAlt(['superadmin'], ['eliminar_usuarios', 'gestionar_usuarios', 'aprobar_registros']);
    $data    = json_decode(file_get_contents('php://input'), true);
    $usuario = (string)($data['usuario'] ?? '');
    if ($usuario === '') responder(['error' => 'Usuario requerido'], 400);
    $chk = $pdo->prepare("SELECT estado FROM usuarios WHERE usuario = ?");
    $chk->execute([$usuario]);
    $est = $chk->fetchColumn();
    if ($est === false) responder(['error' => 'La solicitud ya no existe.'], 404);
    if ($est !== 'pendiente') responder(['error' => 'Solo se pueden rechazar solicitudes pendientes. Esta cuenta ya está creada: usa Eliminar o Desactivar.'], 400);
    $pdo->prepare("DELETE FROM usuarios WHERE usuario = ? AND estado = 'pendiente'")->execute([$usuario]);
    auditar($pdo, 'rechazar', 'usuarios', "Solicitud de acceso rechazada: $usuario", $usuario);
    responder(['ok' => true]);
}

if ($method === 'POST' && $action === 'eliminar') {
    rolOPermisoAlt(['superadmin'], ['eliminar_usuarios', 'gestionar_usuarios']);
    $data    = json_decode(file_get_contents('php://input'), true);
    $usuario = $data['usuario'] ?? '';
    // Nadie puede eliminar una cuenta de superadmin desde aquí
    $chkRolE = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?");
    $chkRolE->execute([$usuario]);
    if ($chkRolE->fetchColumn() === 'superadmin') responder(['error' => 'No puedes eliminar una cuenta de superadmin.'], 403);

    // 1) Confirmación con la contraseña de quien elimina (se valida aquí, no solo en pantalla).
    $passAdmin = (string)($data['password'] ?? '');
    if ($passAdmin === '') responder(['error' => 'Debes confirmar tu contraseña para eliminar una cuenta.', 'requiere_password' => true], 400);
    $hAdmin = $pdo->prepare("SELECT password FROM usuarios WHERE usuario = ?");
    $hAdmin->execute([$_SESSION['usuario'] ?? '']);
    $hashAdmin = $hAdmin->fetchColumn();
    if (!$hashAdmin || !password_verify($passAdmin, $hashAdmin)) responder(['error' => 'Contraseña incorrecta.', 'password_incorrecta' => true], 401);

    // 2) No se puede eliminar si todavía tiene material a su nombre — quedaría
    //    huérfano sin poder rastrearse. Primero hay que devolverlo al almacén.
    $pendientes = _usuarioMaterialPendiente($pdo, $usuario);
    if ($pendientes) {
        responder(['error' => 'No se puede eliminar a "' . $usuario . '": todavía tiene ' . implode(', ', $pendientes) . ' a su nombre. Primero devuelve ese material al almacén (o reasígnalo) y después elimina la cuenta.', 'tiene_material' => true, 'pendientes' => $pendientes], 400);
    }

    // tecnico_sedes se elimina en cascada si configuraste FK ON DELETE CASCADE
    $pdo->prepare("DELETE FROM usuarios WHERE usuario = ?")->execute([$usuario]);
    auditar($pdo, 'eliminar', 'usuarios', "Usuario eliminado: $usuario", $usuario);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   ACTUALIZAR PERMISOS (superadmin delega)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'permisos') {
    rolOPermisoAlt(['superadmin'], ['asignar_permisos_usuarios', 'gestionar_usuarios']);
    $data     = json_decode(file_get_contents('php://input'), true);
    $usuario  = $data['usuario']  ?? '';
    $permisos = $data['permisos'] ?? [];
    if (!$usuario) responder(['error' => 'Usuario requerido'], 400);
    // Nadie puede editar los permisos de una cuenta de superadmin (ese rol
    // siempre tiene todo, no depende de esta tabla) ni, si quien edita no
    // es superadmin, otorgar alguno de los permisos de administración de
    // usuarios a alguien más (evita que, por ejemplo, alguien con
    // "asignar_permisos_usuarios" se auto-otorgue o le pase a otro la
    // capacidad de eliminar/desactivar cuentas, saliéndose de control).
    $permisosSensiblesUsuarios = ['gestionar_usuarios','editar_usuarios','asignar_permisos_usuarios','desactivar_usuarios','eliminar_usuarios'];
    $chkRolP = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario = ?");
    $chkRolP->execute([$usuario]);
    if ($chkRolP->fetchColumn() === 'superadmin') responder(['error' => 'No puedes modificar una cuenta de superadmin.'], 403);
    if (($_SESSION['rol'] ?? '') !== 'superadmin' && array_intersect($permisosSensiblesUsuarios, $permisos)) {
        responder(['error' => 'Solo el superadmin puede otorgar permisos de administración de usuarios.'], 403);
    }
    $pdo->prepare("UPDATE usuarios SET permisos = ? WHERE usuario = ?")
        ->execute([json_encode($permisos), $usuario]);
    auditar($pdo, 'editar_permisos', 'usuarios', "Permisos actualizados para: $usuario", $usuario);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   CREAR SEDE (superadmin)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'crear_sede') {
    rolOPermiso(['superadmin'], 'crear_oficinas');
    $data   = json_decode(file_get_contents('php://input'), true);
    $nombre = trim($data['nombre'] ?? '');
    $tipo   = $data['tipo'] ?? 'municipio';
    if (!$nombre) responder(['error' => 'Nombre requerido'], 400);

    $check = $pdo->prepare("SELECT id FROM sedes WHERE nombre = ?");
    $check->execute([$nombre]);
    if ($check->fetch()) responder(['error' => 'Esa sede ya existe'], 400);

    $pdo->prepare("INSERT INTO sedes (nombre, tipo) VALUES (?, ?)")->execute([$nombre, $tipo]);
    $id = $pdo->lastInsertId();

    // Crear usuario si se enviaron credenciales
    if (!empty($data['usuario']) && !empty($data['password'])) {
        $hash = password_hash($data['password'], PASSWORD_BCRYPT);
        $rol  = $tipo === 'central' ? 'distribuidor' : 'municipio';
        $pdo->prepare("INSERT INTO usuarios (usuario, password, sede_id, rol, tipo, estado) VALUES (?, ?, ?, ?, ?, 'activo')")
            ->execute([$data['usuario'], $hash, $id, $rol, $rol]);
    }
    auditar($pdo, 'crear_sede', 'sedes', "Creada sede: $nombre (tipo: $tipo)" . (!empty($data['usuario']) ? " — con usuario: {$data['usuario']}" : ''), (string)$id);
    responder(['ok' => true, 'sede_id' => $id]);
}

/* ══════════════════════════════════════
   CAMBIAR SEDE DE USUARIO
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'cambiar_sede') {
    rolRequerido('superadmin');
    $data    = json_decode(file_get_contents('php://input'), true);
    $usuario = trim($data['usuario'] ?? '');
    $sede_id = intval($data['sede_id'] ?? 0);
    if (!$usuario || !$sede_id) responder(['error' => 'Datos incompletos'], 400);
    $pdo->prepare("UPDATE usuarios SET sede_id = ? WHERE usuario = ?")
        ->execute([$sede_id, $usuario]);
    auditar($pdo, 'cambiar_sede', 'usuarios', "Sede cambiada para: $usuario", $usuario);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   CAMBIAR ROL DE USUARIO ACTIVO
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'cambiar_rol') {
    rolOPermiso(['superadmin'], 'cambiar_rol');
    $data    = json_decode(file_get_contents('php://input'), true);
    $usuario = trim($data['usuario'] ?? '');
    $rol     = trim($data['rol']     ?? '');

    $roles_validos = ['distribuidor','municipio','tecnico','persona'];
    if (!in_array($rol, $roles_validos)) responder(['error' => 'Rol no válido.'], 400);

    $permisos = _permisosPorRol($rol);

    $pdo->prepare("UPDATE usuarios SET rol = ?, tipo = ?, permisos = ? WHERE usuario = ?")
        ->execute([$rol, $rol, json_encode($permisos), $usuario]);

    auditar($pdo, 'cambiar_rol', 'usuarios', "Rol cambiado: $usuario → $rol", $usuario);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   APROBAR USUARIO CON ROL
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'aprobar_con_rol') {
    rolOPermiso(['superadmin'], 'aprobar_registros');
    $data    = json_decode(file_get_contents('php://input'), true);
    $usuario = trim($data['usuario'] ?? '');
    $rol     = trim($data['rol']     ?? 'municipio');

    $roles_validos = ['distribuidor','municipio','tecnico','persona'];
    if (!in_array($rol, $roles_validos)) $rol = 'municipio';

    $permisos = _permisosPorRol($rol);

    $pdo->prepare("UPDATE usuarios SET estado = 'activo', rol = ?, tipo = ?, permisos = ? WHERE usuario = ?")
        ->execute([$rol, $rol, json_encode($permisos), $usuario]);

    auditar($pdo, 'aprobar', 'usuarios', "Usuario aprobado: $usuario con rol: $rol", $usuario);
    // Correo de bienvenida
    require_once 'notificaciones.php';
    $uData = $pdo->prepare("SELECT nombre, apellido, correo, sede_id FROM usuarios WHERE usuario = ?");
    $uData->execute([$usuario]);
    $ud = $uData->fetch();
    if ($ud && !empty($ud['correo'])) {
        $sedeRow = $pdo->prepare("SELECT nombre FROM sedes WHERE id = ?");
        $sedeRow->execute([$ud['sede_id']]);
        $sedeName = $sedeRow->fetchColumn() ?: '';
        notificarBienvenida($pdo, $usuario, trim(($ud['nombre']??'').' '.($ud['apellido']??'')) ?: $usuario, $ud['correo'], $sedeName);
    }
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   CREAR USUARIO DIRECTAMENTE (superadmin)
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'crear_directo') {
    rolRequerido('superadmin');
    $data     = json_decode(file_get_contents('php://input'), true);
    $usuario  = trim($data['usuario']  ?? '');
    $password = trim($data['password'] ?? '');
    $nombre   = trim($data['nombre']   ?? '');
    $apellido = trim($data['apellido'] ?? '');
    $correo   = trim($data['correo']   ?? '');
    $telefono = preg_replace('/[^0-9]/', '', $data['telefono'] ?? '');
    $rol      = trim($data['rol']      ?? 'municipio');
    $cargo    = trim($data['cargo']    ?? '');
    $sede_id  = intval($data['sede_id'] ?? 0);

    if (!$usuario || !$password || !$sede_id) {
        responder(['error' => 'Usuario, contraseña y sede son obligatorios.'], 400);
    }
    if (strlen($password) < 6) {
        responder(['error' => 'La contraseña debe tener al menos 6 caracteres.'], 400);
    }

    // Verificar que el usuario no exista
    $check = $pdo->prepare("SELECT id FROM usuarios WHERE usuario = ?");
    $check->execute([$usuario]);
    if ($check->fetch()) {
        responder(['error' => 'Ese nombre de usuario ya existe.'], 400);
    }

    $roles_validos = ['distribuidor','municipio','tecnico','persona'];
    if (!in_array($rol, $roles_validos)) $rol = 'municipio';

    // El almacén central es exclusivo de superadmin/distribuidor — nunca
    // se le puede asignar a municipio/técnico/persona, ni siquiera a mano.
    if ($rol !== 'distribuidor') {
        $chkSede = $pdo->prepare("SELECT nombre, tipo FROM sedes WHERE id = ?");
        $chkSede->execute([$sede_id]);
        $sedeElegida = $chkSede->fetch();
        if ($sedeElegida && ($sedeElegida['tipo'] === 'central' || $sedeElegida['nombre'] === 'Almacen Central')) {
            responder(['error' => 'El almacén central es exclusivo de superadmin/distribuidor — elige otra sede para este rol.'], 400);
        }
    }

    $hash = password_hash($password, PASSWORD_BCRYPT);

    $permisos = _permisosPorRol($rol);

    $pdo->prepare("
        INSERT INTO usuarios (usuario, password, nombre, apellido, sede_id, rol, tipo, cargo, correo, telefono, estado, permisos)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activo', ?)
    ")->execute([$usuario, $hash, $nombre ?: $usuario, $apellido, $sede_id, $rol, $rol, $cargo, $correo, $telefono, json_encode($permisos)]);

    auditar($pdo, 'crear', 'usuarios', "Usuario creado directamente: $usuario (rol: $rol)", $usuario);
    // Correo de bienvenida
    if (!empty($correo)) {
        require_once 'notificaciones.php';
        $sedeName = '';
        $sedeRow = $pdo->prepare("SELECT nombre FROM sedes WHERE id = ?");
        $sedeRow->execute([$sede_id]);
        $sedeName = $sedeRow->fetchColumn() ?: '';
        notificarBienvenida($pdo, $usuario, trim("$nombre $apellido") ?: $usuario, $correo, $sedeName);
    }
    responder(['ok' => true]);
}

/* ══ ACTUALIZAR PERFIL PROPIO ══ */
if ($method === 'POST' && $action === 'actualizar_perfil') {
    sesionRequerida();
    $data          = json_decode(file_get_contents('php://input'), true);
    $nombre        = trim($data['nombre']        ?? '');
    $apellido      = trim($data['apellido']      ?? '');
    $cargo         = trim($data['cargo']         ?? '');
    $correo        = trim($data['correo']        ?? '');
    $telefono      = preg_replace('/[^0-9]/', '', $data['telefono'] ?? '');
    $usuarioNuevo  = trim($data['usuario_nuevo'] ?? '');
    $passActual    = $data['password_actual']    ?? '';
    $passNueva     = $data['password_nueva']     ?? '';

    if (!$nombre) responder(['error' => 'El nombre es obligatorio'], 400);
    if ($correo && !filter_var($correo, FILTER_VALIDATE_EMAIL))
        responder(['error' => 'El correo no tiene un formato válido'], 400);

    // Obtener usuario actual de la BD
    $actual = $pdo->prepare("SELECT id, usuario, password FROM usuarios WHERE usuario = ?");
    $actual->execute([$_SESSION['usuario']]);
    $u = $actual->fetch();
    if (!$u) responder(['error' => 'Usuario no encontrado'], 404);

    // Validar cambio de usuario
    $cambioUsuario = $usuarioNuevo && $usuarioNuevo !== $u['usuario'];
    if ($cambioUsuario) {
        if (strlen($usuarioNuevo) < 3)
            responder(['error' => 'El usuario debe tener al menos 3 caracteres'], 400);
        if (!preg_match('/^[a-zA-Z0-9_.\-]+$/', $usuarioNuevo))
            responder(['error' => 'El usuario solo puede tener letras, números, puntos, guiones y _'], 400);
        // Se excluye al propio usuario: así puede cambiar solo las
        // mayúsculas/minúsculas de su nombre (la BD las trata como iguales).
        $check = $pdo->prepare("SELECT id FROM usuarios WHERE usuario = ? AND id <> ?");
        $check->execute([$usuarioNuevo, $u['id']]);
        if ($check->fetch()) responder(['error' => 'Ese nombre de usuario ya está en uso'], 400);
    }

    // Validar cambio de contraseña
    $cambioPass = !empty($passNueva);
    if ($cambioPass) {
        if (empty($passActual))
            responder(['error' => 'Debes ingresar tu contraseña actual para cambiarla'], 400);
        if (!password_verify($passActual, $u['password']))
            responder(['error' => 'La contraseña actual es incorrecta'], 400);
        if (strlen($passNueva) < 6)
            responder(['error' => 'La nueva contraseña debe tener al menos 6 caracteres'], 400);
        if (password_verify($passNueva, $u['password']))
            responder(['error' => 'La nueva contraseña debe ser diferente a la actual'], 400);
    }

    $pdo->beginTransaction();
    try {
        // Actualizar datos del perfil
        $nuevoNombreUsuario = $cambioUsuario ? $usuarioNuevo : $u['usuario'];
        $pdo->prepare("UPDATE usuarios SET nombre=?, apellido=?, cargo=?, correo=?, telefono=?, usuario=? WHERE id=?")
            ->execute([$nombre, $apellido, $cargo, $correo, $telefono, $nuevoNombreUsuario, $u['id']]);

        // Cambiar contraseña si aplica
        if ($cambioPass) {
            $hash = password_hash($passNueva, PASSWORD_BCRYPT);
            $pdo->prepare("UPDATE usuarios SET password=? WHERE id=?")->execute([$hash, $u['id']]);
        }

        $pdo->commit();
    } catch (\Throwable $e) {
        $pdo->rollBack();
        error_log('[actualizar_perfil] ' . $e->getMessage());
        responder(['error' => 'Error al guardar. Intenta de nuevo.'], 500);
    }

    $log = "Perfil actualizado";
    if ($cambioUsuario) $log .= " (usuario: {$u['usuario']} → $usuarioNuevo)";
    if ($cambioPass)    $log .= " (contraseña cambiada)";
    auditar($pdo, 'editar_perfil', 'usuarios', $log, $u['usuario']);

    // Si cambió el usuario o la contraseña, indicar al cliente que debe re-loguearse
    responder(['ok' => true, 'relogin' => $cambioUsuario || $cambioPass]);
}


/* ══════════════════════════════════════
   EDITAR USUARIO (admin o quien tenga gestionar_usuarios)
   Permite cambiar: nombre, apellido, correo, telefono, cargo
   Opcionalmente cambia la contraseña si se envía
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'editar') {
    // Solo superadmin o quien tenga permiso editar_usuarios (o el antiguo
    // gestionar_usuarios, que seguía incluyendo todo)
    if ($_SESSION['rol'] !== 'superadmin') {
        $permsRow = $pdo->prepare("SELECT permisos FROM usuarios WHERE usuario = ?");
        $permsRow->execute([$_SESSION['usuario']]);
        $permsData = $permsRow->fetchColumn();
        $permsActual = $permsData ? json_decode($permsData, true) : [];
        if (!in_array('editar_usuarios', $permsActual) && !in_array('gestionar_usuarios', $permsActual)) {
            responder(['error' => 'Sin permisos para editar usuarios'], 403);
        }
    }

    $data     = json_decode(file_get_contents('php://input'), true);
    $usuario  = trim($data['usuario']  ?? '');
    $nombre   = trim($data['nombre']   ?? '');
    $apellido = trim($data['apellido'] ?? '');
    $correo   = trim($data['correo']   ?? '');
    $telefono = preg_replace('/[^0-9]/', '', $data['telefono'] ?? '');
    $cargo    = trim($data['cargo']    ?? '');
    $password = $data['password'] ?? null;

    if (!$usuario) responder(['error' => 'Usuario requerido'], 400);
    if (!$nombre)  responder(['error' => 'El nombre es obligatorio'], 400);
    if ($correo && !filter_var($correo, FILTER_VALIDATE_EMAIL))
        responder(['error' => 'El correo no tiene un formato válido'], 400);
    if ($password !== null && $password !== '' && strlen($password) < 6)
        responder(['error' => 'La contraseña debe tener al menos 6 caracteres'], 400);

    // Verificar que el usuario existe
    $check = $pdo->prepare("SELECT id FROM usuarios WHERE usuario = ?");
    $check->execute([$usuario]);
    if (!$check->fetch()) responder(['error' => 'Usuario no encontrado'], 404);

    // Actualizar datos básicos
    $pdo->prepare("
        UPDATE usuarios
        SET nombre=?, apellido=?, correo=?, telefono=?, cargo=?
        WHERE usuario=?
    ")->execute([$nombre, $apellido, $correo, $telefono, $cargo, $usuario]);

    // Nota: el admin no cambia contraseñas — cada usuario lo hace desde su perfil
    auditar($pdo, 'editar', 'usuarios', "Usuario editado: $usuario (por {$_SESSION['usuario']})", $usuario);
    responder(['ok' => true]);
}


/* ══════════════════════════════════════
   EDITAR SEDES DE TÉCNICO
   Permite cambiar las sedes asignadas a un técnico
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'editar_sedes_tecnico') {
    rolOPermisoAlt(['superadmin'], ['editar_usuarios', 'gestionar_usuarios']);
    $data      = json_decode(file_get_contents('php://input'), true);
    $usuario   = trim($data['usuario']   ?? '');
    $sede_id   = intval($data['sede_id'] ?? 0);
    $sedes_ids = $data['sedes_ids']      ?? [];

    if (!$usuario || !$sede_id) responder(['error' => 'Datos incompletos'], 400);
    if (empty($sedes_ids))      responder(['error' => 'Selecciona al menos una sede'], 400);

    // Verificar que el usuario existe y es técnico
    $check = $pdo->prepare("SELECT id, rol FROM usuarios WHERE usuario = ?");
    $check->execute([$usuario]);
    $u = $check->fetch();
    if (!$u) responder(['error' => 'Usuario no encontrado'], 404);
    if ($u['rol'] !== 'tecnico') responder(['error' => 'Solo se pueden editar sedes de técnicos'], 400);

    $pdo->beginTransaction();
    try {
        // Actualizar sede principal
        $pdo->prepare("UPDATE usuarios SET sede_id = ? WHERE id = ?")
            ->execute([$sede_id, $u['id']]);

        // Reemplazar sedes asignadas
        $pdo->prepare("DELETE FROM tecnico_sedes WHERE usuario_id = ?")
            ->execute([$u['id']]);

        $ins = $pdo->prepare("INSERT IGNORE INTO tecnico_sedes (usuario_id, sede_id) VALUES (?, ?)");
        foreach ($sedes_ids as $sid) {
            $ins->execute([$u['id'], intval($sid)]);
        }

        $pdo->commit();
    } catch (\Throwable $e) {
        $pdo->rollBack();
        error_log('[editar_sedes_tecnico] ' . $e->getMessage());
        responder(['error' => 'Error al guardar las sedes. Intenta de nuevo.'], 500);
    }

    auditar($pdo, 'editar_sedes', 'usuarios', "Sedes actualizadas para técnico: $usuario", $usuario);
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   BUSCAR USUARIOS ACTIVOS
   Para modales de transportador, entrega, etc.
   Cualquier usuario autenticado puede usarlo.
   Solo devuelve nombre, usuario, sede, rol (sin datos sensibles)
══════════════════════════════════════ */
if ($method === 'GET' && $action === 'buscar_activos') {
    sesionRequerida();
    $stmt = $pdo->query("
        SELECT u.id, u.usuario, u.nombre, u.apellido, u.rol, u.cargo,
               s.nombre as sede
        FROM usuarios u
        JOIN sedes s ON u.sede_id = s.id
        WHERE u.estado = 'activo'
        ORDER BY u.nombre ASC
    ");
    responder($stmt->fetchAll());
}

responder(['error' => 'Acción no reconocida'], 400);