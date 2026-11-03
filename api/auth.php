<?php
/* ═══════════════════════════════════════════════════════════
   auth.php — Integrados S&S
   Acciones: login | registro | sesion | logout | actualizar_perfil
═══════════════════════════════════════════════════════════ */

require 'config.php';
require_once 'auditoria.php';

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ══════════════════════════════════════
   SESIÓN
══════════════════════════════════════ */
if ($action === 'sesion') {
    if (empty($_SESSION['usuario'])) {
        responder(['ok' => false, 'error' => 'No autenticado'], 401);
    }
    $stmt = $pdo->prepare("
        SELECT u.id, u.usuario, u.nombre, u.apellido, u.rol, u.cargo,
               u.estado, u.permisos, u.correo, u.telefono,
               s.nombre as sede, s.id as sede_id
        FROM usuarios u
        JOIN sedes s ON u.sede_id = s.id
        WHERE u.usuario = ?
    ");
    $stmt->execute([$_SESSION['usuario']]);
    $u = $stmt->fetch();

    if (!$u || $u['estado'] !== 'activo') {
        session_destroy();
        responder(['ok' => false, 'error' => 'Cuenta inactiva'], 401);
    }

    $sedesStmt = $pdo->prepare("
        SELECT s.nombre FROM tecnico_sedes ts
        JOIN sedes s ON s.id = ts.sede_id WHERE ts.usuario_id = ?
    ");
    $sedesStmt->execute([$u['id']]);
    $sedesExtra = $sedesStmt->fetchAll(PDO::FETCH_COLUMN);
    $todasSedes = array_values(array_unique(array_merge([$u['sede']], $sedesExtra))); // array_values evita que se mande como objeto JSON
    $permisos = $u['permisos'] ? json_decode($u['permisos'], true) : [];

    // Completar permisos base del distribuidor: si le falta alguno de la
    // base mínima (por una cuenta vieja creada antes de agregarse un
    // permiso nuevo al sistema), se lo agrega. YA NO se le quita nada —
    // si el superadmin le dio un permiso adicional a mano, se queda.
    // Se toma de PERMISOS_DEFAULT_POR_ROL (api/config.php) — única fuente
    // de esta lista, para que no se desincronice de las demás copias.
    if ($u['rol'] === 'distribuidor' && is_array($permisos)) {
        $permisosDistribuidorBase = PERMISOS_DEFAULT_POR_ROL['distribuidor'];
        $faltantes = array_diff($permisosDistribuidorBase, $permisos);
        if ($faltantes) {
            $permisosNuevos = array_values(array_unique(array_merge($permisos, $permisosDistribuidorBase)));
            try {
                $pdo->prepare("UPDATE usuarios SET permisos = ? WHERE id = ?")
                    ->execute([json_encode($permisosNuevos), $u['id']]);
                $permisos = $permisosNuevos;
            } catch (\Throwable $e) { error_log('[auth/sesion completar permisos] ' . $e->getMessage()); }
        }
    }

    responder([
        'ok' => true,
        'usuario'  => $u['usuario'],
        'nombre'   => $u['nombre']   ?? '',
        'apellido' => $u['apellido'] ?? '',
        'rol'      => $u['rol'],
        'cargo'    => $u['cargo']    ?? '',
        'sede'     => $u['sede'],
        'sede_id'  => $u['sede_id'],
        'sedes'    => $todasSedes,
        'estado'   => $u['estado'],
        'permisos' => $permisos,
        'correo'   => $u['correo']   ?? '',
        'telefono' => $u['telefono'] ?? '',
    ]);
}

/* ══════════════════════════════════════
   LOGIN
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'login') {
    $body     = json_decode(file_get_contents('php://input'), true) ?? [];
    $usuario  = trim($body['usuario']  ?? '');
    $password = $body['password'] ?? '';

    if (!$usuario || !$password) {
        responder(['ok' => false, 'error' => 'Usuario y contraseña son obligatorios'], 400);
    }

    // Freno de fuerza bruta: máx. 8 fallos por usuario o 30 por IP en 15 minutos.
    try {
        $esc = fn($t) => str_replace(['\\','%','_'], ['\\\\','\\%','\\_'], $t);
        $q = $pdo->prepare("SELECT COUNT(*) FROM auditoria WHERE accion='login_fallido' AND fecha > (NOW() - INTERVAL 15 MINUTE) AND (detalle LIKE ? OR detalle LIKE ?)");
        $q->execute(['% para: ' . $esc($usuario), '%inexistente: ' . $esc($usuario)]);
        $fallosUsuario = (int)$q->fetchColumn();
        $fallosIp = 0;
        if (function_exists('_ipReal')) {
            $q = $pdo->prepare("SELECT COUNT(*) FROM auditoria WHERE accion='login_fallido' AND fecha > (NOW() - INTERVAL 15 MINUTE) AND ip = ?");
            $q->execute([_ipReal()]);
            $fallosIp = (int)$q->fetchColumn();
        }
        if ($fallosUsuario >= 8 || $fallosIp >= 30) {
            responder(['ok' => false, 'error' => 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo.'], 429);
        }
    } catch (PDOException $e) { /* si falla la consulta no se bloquea el login */ }

    $stmt = $pdo->prepare("
        SELECT u.id, u.usuario, u.nombre, u.apellido, u.rol, u.cargo,
               u.password, u.estado, u.permisos, u.correo, u.telefono,
               s.nombre as sede, s.id as sede_id
        FROM usuarios u
        JOIN sedes s ON u.sede_id = s.id
        WHERE u.usuario = ?
    ");
    $stmt->execute([$usuario]);
    $u = $stmt->fetch();

    // La base de datos compara sin distinguir mayúsculas/minúsculas, así que
    // "SUPERADMIN" encontraría a "superadmin". Se exige coincidencia exacta.
    if ($u && $u['usuario'] !== $usuario) {
        $u = false;
    }

    if (!$u) {
        auditar($pdo, 'login_fallido', 'auth', "Intento de login con usuario inexistente: $usuario");
        responder(['ok' => false, 'error' => 'Usuario o contraseña incorrectos'], 401);
    }
    if ($u['estado'] === 'pendiente') {
        responder(['ok' => false, 'error' => 'Tu cuenta está pendiente de aprobación.'], 403);
    }
    if ($u['estado'] !== 'activo') {
        responder(['ok' => false, 'error' => 'Cuenta desactivada. Contacta al administrador.'], 403);
    }
    if (!password_verify($password, $u['password'])) {
        auditar($pdo, 'login_fallido', 'auth', "Contraseña incorrecta para: $usuario");
        responder(['ok' => false, 'error' => 'Usuario o contraseña incorrectos'], 401);
    }

    $sedesStmt = $pdo->prepare("
        SELECT s.nombre FROM tecnico_sedes ts
        JOIN sedes s ON s.id = ts.sede_id WHERE ts.usuario_id = ?
    ");
    $sedesStmt->execute([$u['id']]);
    $sedesExtra = $sedesStmt->fetchAll(PDO::FETCH_COLUMN);
    $todasSedes = array_values(array_unique(array_merge([$u['sede']], $sedesExtra))); // array_values evita que se mande como objeto JSON
    $permisos = $u['permisos'] ? json_decode($u['permisos'], true) : [];

    // Completar permisos base del distribuidor (ver misma nota en el
    // bloque de verificar sesión, más abajo en este archivo) — solo
    // agrega lo que falte, nunca quita permisos adicionales ya dados.
    if ($u['rol'] === 'distribuidor' && is_array($permisos)) {
        $permisosDistribuidorBase = [
            'ver_inventario','editar_productos','enviar_material','enviar_multiple',
            'registrar_gastos','registrar_ingresos','gestionar_pedidos',
            'despachar','elegir_material_despacho',
            'crear_proveedores','editar_proveedores',
            'ver_historial','ver_reportes',
            'registrar_ont','gestionar_fibra','ver_mis_equipos','gestionar_equipos',
        ];
        $faltantes = array_diff($permisosDistribuidorBase, $permisos);
        if ($faltantes) {
            $permisosNuevos = array_values(array_unique(array_merge($permisos, $permisosDistribuidorBase)));
            try {
                $pdo->prepare("UPDATE usuarios SET permisos = ? WHERE id = ?")
                    ->execute([json_encode($permisosNuevos), $u['id']]);
                $permisos = $permisosNuevos;
            } catch (\Throwable $e) { error_log('[auth/login completar permisos] ' . $e->getMessage()); }
        }
    }

    $_SESSION['usuario']    = $u['usuario'];
    $_SESSION['rol']        = $u['rol'];
    $_SESSION['sede']       = $u['sede'];
    $_SESSION['sede_id']    = $u['sede_id'];
    $_SESSION['usuario_id'] = $u['id'];

    try {
        $pdo->prepare("
            INSERT INTO auditoria (usuario, rol, sede, modulo, tabla, accion, detalle, ip)
            VALUES (?, ?, ?, 'sesion', 'sesion', 'login', 'Inicio de sesión', ?)
        ")->execute([$u['usuario'], $u['rol'], $u['sede'], $_SERVER['REMOTE_ADDR'] ?? '']);
    } catch (Exception $e) {}

    responder([
        'ok'       => true,
        'usuario'  => $u['usuario'],
        'nombre'   => $u['nombre']   ?? '',
        'apellido' => $u['apellido'] ?? '',
        'rol'      => $u['rol'],
        'cargo'    => $u['cargo']    ?? '',
        'sede'     => $u['sede'],
        'sede_id'  => $u['sede_id'],
        'sedes'    => $todasSedes,
        'estado'   => $u['estado'],
        'permisos' => $permisos,
        'correo'   => $u['correo']   ?? '',
        'telefono' => $u['telefono'] ?? '',
    ]);
}

/* ══════════════════════════════════════
   REGISTRO
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'registro') {
    $body      = json_decode(file_get_contents('php://input'), true) ?? [];
    $usuario   = trim($body['usuario']  ?? '');
    $password  = $body['password']      ?? '';
    $nombre    = trim($body['nombre']   ?? '');
    $apellido  = trim($body['apellido'] ?? '');
    $cargo     = trim($body['cargo']    ?? '');
    // Log para debug
    error_log('[Registro] usuario='.$body['usuario'].' nombre='.$nombre.' tipo='.($body['tipo']??''));
    // Si no viene nombre, usar el usuario como nombre visible
    if (empty($nombre)) $nombre = trim($body['usuario'] ?? '');
    $correo    = trim($body['correo']   ?? '');
    $telefono  = trim($body['telefono'] ?? '');
    $tipo      = $body['tipo']          ?? 'municipio';
    $sede_id   = (int)($body['sede_id'] ?? 0);
    $sedes_ids = $body['sedes_ids']     ?? ($sede_id ? [$sede_id] : []);

    if (!$usuario || !$password || !$sede_id) {
        responder(['ok' => false, 'error' => 'Faltan campos obligatorios'], 400);
    }
    if (strlen($password) < 6) {
        responder(['ok' => false, 'error' => 'La contraseña debe tener al menos 6 caracteres'], 400);
    }

    $check = $pdo->prepare("SELECT id FROM usuarios WHERE usuario = ?");
    $check->execute([$usuario]);
    if ($check->fetch()) {
        responder(['ok' => false, 'error' => 'El nombre de usuario ya está en uso'], 409);
    }

    $sedeCheck = $pdo->prepare("SELECT id FROM sedes WHERE id = ?");
    $sedeCheck->execute([$sede_id]);
    if (!$sedeCheck->fetch()) {
        responder(['ok' => false, 'error' => 'Sede no válida'], 400);
    }

    $esSuperAdmin = !empty($_SESSION['rol']) && $_SESSION['rol'] === 'superadmin';

    $roles_validos = $esSuperAdmin
        ? ['municipio', 'tecnico', 'persona', 'distribuidor']
        : ['municipio', 'tecnico', 'persona'];
    // "distribuidor" es un rol con permisos amplios — solo un superadmin ya
    // autenticado puede crear una cuenta de ese tipo. Antes cualquiera (ni
    // siquiera con sesión) podía mandar tipo=distribuidor y crearla.
    if ($tipo === 'distribuidor' && !$esSuperAdmin) {
        responder(['ok' => false, 'error' => 'No tienes permiso para crear una cuenta de distribuidor.'], 403);
    }
    $rol = in_array($tipo, $roles_validos) ? $tipo : 'municipio';

    // Si quien llama YA tiene sesión (viene del botón "Crear técnico"/"Crear
    // persona" del panel, no del auto-registro público), se exige el
    // permiso específico — salvo que sea superadmin, que siempre puede.
    // El auto-registro público (sin sesión) sigue abierto, tal como estaba.
    if (!empty($_SESSION['usuario']) && !$esSuperAdmin) {
        $permRawR = $pdo->prepare("SELECT permisos FROM usuarios WHERE usuario = ?");
        $permRawR->execute([$_SESSION['usuario']]);
        $permsR = json_decode($permRawR->fetchColumn() ?: '[]', true) ?: [];
        if ($rol === 'tecnico' && !in_array('crear_tecnicos', $permsR)) {
            responder(['ok' => false, 'error' => 'No tienes permiso para crear cuentas de técnico.'], 403);
        }
        if ($rol === 'persona' && !in_array('crear_personas', $permsR)) {
            responder(['ok' => false, 'error' => 'No tienes permiso para crear cuentas de persona.'], 403);
        }
    }

    // Se toma de PERMISOS_DEFAULT_POR_ROL (api/config.php) — única fuente
    // de esta lista, para que no se desincronice de las demás copias.
    $permisos = PERMISOS_DEFAULT_POR_ROL[$rol] ?? ['ver_inventario'];
    $estado = $esSuperAdmin ? 'activo' : 'pendiente';
    $hash   = password_hash($password, PASSWORD_DEFAULT);

    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("
            INSERT INTO usuarios (usuario, nombre, apellido, cargo, correo, telefono,
                                  password, rol, tipo, sede_id, estado, permisos)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $stmt->execute([
            $usuario, $nombre, $apellido, $cargo, $correo, $telefono,
            $hash, $rol, $rol, $sede_id, $estado,
            json_encode($permisos)
        ]);
        $nuevo_id = (int)$pdo->lastInsertId();

        if ($rol === 'tecnico' && !empty($sedes_ids)) {
            $insSede = $pdo->prepare("INSERT IGNORE INTO tecnico_sedes (usuario_id, sede_id) VALUES (?, ?)");
            foreach ($sedes_ids as $sid) {
                $insSede->execute([$nuevo_id, (int)$sid]);
            }
        }

        $pdo->commit();
        auditar($pdo, 'registro', 'usuarios', "Cuenta nueva registrada: $usuario ($rol) — estado: $estado", $usuario);
    } catch (Exception $e) {
        $pdo->rollBack();
        responder(['ok' => false, 'error' => 'Error al registrar: ' . $e->getMessage()], 500);
    }

    responder([
        'ok'     => true,
        'id'     => $nuevo_id,
        'estado' => $estado,
        'mensaje'=> $estado === 'activo' ? 'Usuario creado correctamente.' : 'Registro exitoso. Pendiente de aprobación.',
    ]);
}

/* ══════════════════════════════════════
   LOGOUT
══════════════════════════════════════ */
/* ── VERIFICAR CONTRASEÑA ── */
if ($method === 'POST' && $action === 'verificar_password') {
    sesionRequerida();
    $data = json_decode(file_get_contents('php://input'), true) ?? [];
    $pass = $data['password'] ?? '';
    if (empty($pass)) responder(['error' => 'Contraseña requerida'], 400);
    $stmt = $pdo->prepare("SELECT password FROM usuarios WHERE usuario = ?");
    $stmt->execute([$_SESSION['usuario']]);
    $row = $stmt->fetch();
    if (!$row) responder(['error' => 'Usuario no encontrado'], 404);
    if (password_verify($pass, $row['password'])) {
        responder(['ok' => true]);
    } else {
        responder(['error' => 'Contraseña incorrecta', 'ok' => false], 401);
    }
}

if ($action === 'logout') {
    $usuario = $_SESSION['usuario'] ?? '';
    $rol     = $_SESSION['rol']     ?? '';
    $sede    = $_SESSION['sede']    ?? '';
    if ($usuario) {
        try {
            $pdo->prepare("
                INSERT INTO auditoria (usuario, rol, sede, tabla, accion, detalle, ip)
                VALUES (?, ?, ?, 'sesion', 'sesion', 'logout', 'Cierre de sesión', ?)
            ")->execute([$usuario, $rol, $sede, $_SERVER['REMOTE_ADDR'] ?? '']);
        } catch (Exception $e) {}
    }
    session_destroy();
    responder(['ok' => true]);
}

/* ══════════════════════════════════════
   ACTUALIZAR PERFIL
══════════════════════════════════════ */
if ($method === 'POST' && $action === 'actualizar_perfil') {
    if (empty($_SESSION['usuario'])) {
        responder(['ok' => false, 'error' => 'No autenticado'], 401);
    }
    $body          = json_decode(file_get_contents('php://input'), true) ?? [];
    $nombre        = trim($body['nombre']        ?? '');
    $apellido      = trim($body['apellido']      ?? '');
    $cargo         = trim($body['cargo']         ?? '');
    $correo        = trim($body['correo']        ?? '');
    $telefono      = trim($body['telefono']      ?? '');
    $usuario_nuevo = trim($body['usuario_nuevo'] ?? $_SESSION['usuario']);

    if (!$nombre) {
        responder(['ok' => false, 'error' => 'El nombre es obligatorio'], 400);
    }
    if ($usuario_nuevo !== $_SESSION['usuario']) {
        // Se excluye al propio usuario para permitir cambiar solo mayúsculas/minúsculas.
        $check = $pdo->prepare("SELECT id FROM usuarios WHERE usuario = ? AND id <> ?");
        $check->execute([$usuario_nuevo, (int)($_SESSION['usuario_id'] ?? 0)]);
        if ($check->fetch()) {
            responder(['ok' => false, 'error' => 'Ese nombre de usuario ya está en uso'], 409);
        }
    }

    $usuarioAntes = $_SESSION['usuario'];
    $pdo->prepare("
        UPDATE usuarios
        SET nombre = ?, apellido = ?, cargo = ?, correo = ?, telefono = ?, usuario = ?
        WHERE usuario = ?
    ")->execute([$nombre, $apellido, $cargo, $correo, $telefono, $usuario_nuevo, $_SESSION['usuario']]);

    $_SESSION['usuario'] = $usuario_nuevo;
    $cambioUsuario = ($usuario_nuevo !== $usuarioAntes) ? " (cambió su usuario de \"$usuarioAntes\" a \"$usuario_nuevo\")" : '';
    auditar($pdo, 'actualizar_perfil', 'usuarios', "Actualizó su perfil$cambioUsuario", $usuario_nuevo);
    responder(['ok' => true, 'usuario' => $usuario_nuevo]);
}

responder(['error' => 'Acción no válida: ' . htmlspecialchars($action)], 400);