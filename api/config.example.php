<?php
/* ═══════════════════════════════════════════════════════════
   config.php — Integrados
   Conexión a BD + helpers globales
═══════════════════════════════════════════════════════════ */

header('Content-Type: application/json; charset=utf-8');

// ─── Evitar que el navegador guarde en caché las respuestas de la API.
// Sin esto, algunas peticiones GET (notificaciones, pendientes, listados)
// pueden quedar "congeladas" en el navegador del usuario mostrando datos
// viejos (ej: una confirmación vacía) aunque el servidor ya tenga datos
// nuevos. ───
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');

// ─── CORS — permite el mismo origen que abre el dashboard ───
// Como el dashboard y la API están en el mismo servidor XAMPP,
// las peticiones son del mismo origen y no necesitan CORS estricto.
if (isset($_SERVER['HTTP_ORIGIN'])) {
    $origen = $_SERVER['HTTP_ORIGIN'];
    // Permitir localhost en cualquier puerto (XAMPP, Live Server, etc.)
    if (preg_match('#^https?://(localhost|127\.0\.0\.1)(:\d+)?$#', $origen)) {
        header('Access-Control-Allow-Origin: ' . $origen);
        header('Access-Control-Allow-Credentials: true');
    }
}
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Preflight CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }

// ─── Sesión segura ──────────────────────────────────────────
ini_set('session.cookie_httponly', 1);
ini_set('session.cookie_samesite', 'Lax'); // Lax funciona bien en local y producción
session_start();

// ─── Cargar .env si existe ───────────────────────────────────
$envFile = __DIR__ . '/.env';
if (file_exists($envFile)) {
    foreach (file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
        if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) continue;
        [$key, $val] = explode('=', $line, 2);
        $_ENV[trim($key)] = trim($val);
    }
}

// ─── Credenciales de BD ──────────────────────────────────────
$host = 'localhost';
$db   = 'NOMBRE_DE_LA_BASE';
$user = 'USUARIO_BD';
$pass = 'CONTRASENA_BD';
$port = '3306';

// ─── Conexión ────────────────────────────────────────────────
try {
    $pdo = new PDO(
        "mysql:host=$host;port=$port;dbname=$db;charset=utf8mb4",
        $user, $pass,
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );
} catch (PDOException $e) {
    $esProd = ($_ENV['APP_ENV'] ?? 'local') === 'production';
    http_response_code(500);
    die(json_encode([
        'error'   => 'Error de conexión a la base de datos',
        'detalle' => $esProd ? 'Contacta al administrador del sistema' : $e->getMessage(),
    ]));
}

// ─── Columna "descripcion" en sedes (se le olvidó a esta migración
// en su momento — el backend la usaba pero la columna nunca se creó) ───
try {
    $colDescSede = $pdo->query("SHOW COLUMNS FROM sedes LIKE 'descripcion'")->fetch();
    if (!$colDescSede) {
        $pdo->exec("ALTER TABLE sedes ADD COLUMN descripcion VARCHAR(255) DEFAULT NULL");
    }
} catch (\Throwable $e) { error_log('[config/sedes descripcion] ' . $e->getMessage()); }

// ─── Stock por USUARIO (reemplaza el modelo por sede) ─────────
// Cada persona tiene su propio inventario, sin importar la sede a la
// que esté asignada. Se crea sola la primera vez que hace falta.
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS stock_usuarios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            producto_id INT NOT NULL,
            usuario VARCHAR(60) NOT NULL,
            cantidad INT NOT NULL DEFAULT 0,
            UNIQUE KEY uniq_producto_usuario (producto_id, usuario),
            KEY idx_usuario (usuario)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
} catch (\Throwable $e) { error_log('[config/stock_usuarios] ' . $e->getMessage()); }

// Migrar cantidad de INT a DECIMAL — los productos por metros (ej: fibra
// suelta) necesitan poder tener stock personal con decimales (12.5 mts),
// no solo enteros.
try {
    $colCant = $pdo->query("SHOW COLUMNS FROM stock_usuarios LIKE 'cantidad'")->fetch();
    if ($colCant && stripos($colCant['Type'], 'decimal') === false) {
        $pdo->exec("ALTER TABLE stock_usuarios MODIFY cantidad DECIMAL(10,2) NOT NULL DEFAULT 0");
    }
} catch (\Throwable $e) { error_log('[config/stock_usuarios decimal] ' . $e->getMessage()); }

// Fibra por persona: cada carrete ahora es de alguien específico (el
// técnico que lo carga en su carro), no de una sede. Se agrega la
// columna si todavía no existe (proyectos ya creados antes de esto).
try {
    $colsCarretes = $pdo->query("SHOW COLUMNS FROM fibra_carretes")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('usuario_actual', $colsCarretes)) {
        $pdo->exec("ALTER TABLE fibra_carretes ADD COLUMN usuario_actual VARCHAR(60) DEFAULT NULL");
    }
} catch (\Throwable $e) { error_log('[config/fibra_carretes usuario] ' . $e->getMessage()); }

// ONT: separar "dueño real" (la oficina que la recibió, tecnico_asignado —
// nunca cambia mientras esté en uso) de "quién la instaló/maneja" (el
// técnico específico, tecnico_instalador — sí puede cambiar).
try {
    $colsOntInst = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('tecnico_instalador', $colsOntInst)) {
        $colUsr = $pdo->query("
            SELECT COLLATION_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'usuario'
        ")->fetchColumn();
        $collate = $colUsr ? "COLLATE $colUsr" : '';
        $pdo->exec("ALTER TABLE ont_seriales ADD COLUMN tecnico_instalador VARCHAR(60) $collate DEFAULT NULL");
    }
    if (!in_array('proveedor', $colsOntInst)) {
        $pdo->exec("ALTER TABLE ont_seriales ADD COLUMN proveedor VARCHAR(150) DEFAULT NULL");
    }
} catch (\Throwable $e) { error_log('[config/ont tecnico_instalador] ' . $e->getMessage()); }

// historial: coordenadas GPS opcionales (capturadas al registrar un gasto
// desde el celular, para saber exactamente dónde se usó el material).
try {
    $colsHistGps = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN);
    foreach (['gps_lat' => "DECIMAL(10,6) DEFAULT NULL", 'gps_lng' => "DECIMAL(10,6) DEFAULT NULL"] as $col => $def) {
        if (!in_array($col, $colsHistGps)) {
            $pdo->exec("ALTER TABLE historial ADD COLUMN `$col` $def");
        }
    }
} catch (\Throwable $e) { error_log('[config/historial gps] ' . $e->getMessage()); }

// historial: campos de venta — cuando algo se marca como VENDIDO (no
// solo gastado/usado), se guarda a quién, por cuánto, y cómo se pagó.
try {
    $colsHistVenta = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN);
    $nuevasVenta = [
        'es_venta'         => "TINYINT(1) DEFAULT 0",
        'cliente_venta'    => "VARCHAR(150) DEFAULT NULL",
        'precio_unitario'  => "DECIMAL(12,2) DEFAULT NULL",
        'precio_total'     => "DECIMAL(12,2) DEFAULT NULL",
        'forma_pago'       => "VARCHAR(30) DEFAULT NULL",
    ];
    foreach ($nuevasVenta as $col => $def) {
        if (!in_array($col, $colsHistVenta)) {
            $pdo->exec("ALTER TABLE historial ADD COLUMN `$col` $def");
        }
    }
} catch (\Throwable $e) { error_log('[config/historial venta] ' . $e->getMessage()); }

// productos.stock_recuperado: pool separado del stock normal, para el
// material recuperado (recogido de clientes) que vuelve al almacén
// central — se elige manualmente de cuál sacar al vender/enviar.
try {
    $colsProdRec = $pdo->query("SHOW COLUMNS FROM productos")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('stock_recuperado', $colsProdRec)) {
        $pdo->exec("ALTER TABLE productos ADD COLUMN stock_recuperado INT DEFAULT 0");
    }
} catch (\Throwable $e) { error_log('[config/stock_recuperado] ' . $e->getMessage()); }

// productos.metros_por_unidad: para productos por metros que vienen
// empacados en rollos/unidades iguales (ej: "drop" de 300m cada rollo).
// El stock real se sigue guardando en metros (para que gastar/enviar sea
// exacto), pero esto permite MOSTRAR "Productos en stock" como cantidad
// de rollos en vez de metros sueltos.
try {
    $colsProdMxu = $pdo->query("SHOW COLUMNS FROM productos")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('metros_por_unidad', $colsProdMxu)) {
        $pdo->exec("ALTER TABLE productos ADD COLUMN metros_por_unidad DECIMAL(10,2) DEFAULT NULL");
    }
} catch (\Throwable $e) { error_log('[config/metros_por_unidad] ' . $e->getMessage()); }

// Auditorías de inventario guardadas — para poder buscar después "qué
// tenía fulano el día X", no solo ver la foto del momento actual.
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS auditorias_inventario (
            id INT AUTO_INCREMENT PRIMARY KEY,
            usuario_auditado VARCHAR(60) NOT NULL,
            realizado_por VARCHAR(60) NOT NULL,
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
            datos JSON NOT NULL,
            KEY idx_usuario_auditado (usuario_auditado)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
} catch (\Throwable $e) { error_log('[config/auditorias_inventario] ' . $e->getMessage()); }

// historial.retirado: para marcar que algo instalado (mufla, caja, etc.)
// ya no está ahí (se dañó, se lo robaron, se cambió) — SIN borrar el
// registro histórico. Distinto de "anulado" (que es "esto se registró
// mal"): "retirado" es "esto sí pasó, pero ya no sigue vigente".
try {
    $colsHistRet = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('retirado', $colsHistRet)) {
        $pdo->exec("ALTER TABLE historial ADD COLUMN retirado TINYINT(1) DEFAULT 0");
        $pdo->exec("ALTER TABLE historial ADD COLUMN retirado_motivo VARCHAR(300) DEFAULT NULL");
        $pdo->exec("ALTER TABLE historial ADD COLUMN retirado_por VARCHAR(60) DEFAULT NULL");
        $pdo->exec("ALTER TABLE historial ADD COLUMN retirado_en DATETIME DEFAULT NULL");
    }
} catch (\Throwable $e) { error_log('[config/historial retirado] ' . $e->getMessage()); }

// Colación unificada: stock_usuarios y material_recogido se crearon en
// algún momento con utf8mb4_0900_ai_ci (el default de instalaciones MySQL
// 8+) en vez de utf8mb4_unicode_ci (lo que usa el resto del sistema). No
// causaba error hoy porque las columnas que sí se comparan entre tablas
// (usuario) ya tenían su propia colación correcta puesta a mano, pero
// dejarlo mezclado es un riesgo latente — cualquier consulta nueva que
// compare mr.ref/nombre contra productos.ref/nombre fallaría con
// "Illegal mix of collations". Se unifica una sola vez.
try {
    $colTabla = $pdo->query("
        SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN ('stock_usuarios','material_recogido')
          AND TABLE_COLLATION != 'utf8mb4_unicode_ci'
    ")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($colTabla as $tabla) {
        $pdo->exec("ALTER TABLE `$tabla` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    }
} catch (\Throwable $e) { error_log('[config/colacion unificada] ' . $e->getMessage()); }

// producto_rollos: rastreo INDIVIDUAL de cada rollo físico, para
// cualquier producto que se registre "por rollos" (metros_por_unidad
// definido) — no solo fibra, cualquiera (Drop, etc.). Antes, un producto
// con 3 rollos de 300m solo se veía como "900m / 3 = 3 rollos" en un
// solo número — no se sabía cuál rollo específico tenía cuánto restante,
// ni se podía elegir de cuál sacar al gastar. Ahora cada rollo es su
// propia fila, igual que ya funcionaba fibra_carretes.
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS producto_rollos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            producto_id INT NOT NULL,
            codigo VARCHAR(50) DEFAULT NULL,
            metros DECIMAL(10,2) NOT NULL DEFAULT 0,
            metros_usados DECIMAL(10,2) NOT NULL DEFAULT 0,
            sede_id INT DEFAULT NULL,
            sede_nombre VARCHAR(100) DEFAULT '',
            usuario_actual VARCHAR(60) DEFAULT NULL,
            estado ENUM('disponible','agotado','en_transito') DEFAULT 'disponible',
            registrado_por VARCHAR(60) DEFAULT '',
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
            KEY idx_producto (producto_id),
            KEY idx_usuario (usuario_actual),
            KEY idx_sede (sede_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
} catch (\Throwable $e) { error_log('[config/producto_rollos] ' . $e->getMessage()); }

// historial.proyecto_cliente: cuando alguien gasta material, además de
// "Lugar" (dirección libre), puede escribir a qué CLIENTE/PROYECTO
// pertenece (ej: "Entrepinos") — en su propia columna, con
// autocompletado de nombres ya usados, para que varios técnicos que
// trabajan en el mismo proyecto en fechas distintas usen SIEMPRE el
// mismo nombre exacto, y así se pueda ver todo el gasto de ese proyecto
// junto, sin importar quién lo hizo ni cuándo.
try {
    $colsHistProy = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('proyecto_cliente', $colsHistProy)) {
        $pdo->exec("ALTER TABLE historial ADD COLUMN proyecto_cliente VARCHAR(150) DEFAULT NULL, ADD INDEX idx_proyecto_cliente (proyecto_cliente)");
    }
} catch (\Throwable $e) { error_log('[config/historial proyecto_cliente] ' . $e->getMessage()); }

// proyectos: catálogo propio de proyectos/clientes — se CREAN primero
// (como un registro formal), y al gastar solo se ELIGE de esta lista, no
// se escribe libre. Así se evita que "Pepe" y "Pepa" (un error de
// tipeo) terminen contados como 2 proyectos distintos sin querer.
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS proyectos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(150) NOT NULL,
            descripcion VARCHAR(300) DEFAULT NULL,
            creado_por VARCHAR(60) DEFAULT '',
            fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
            activo TINYINT(1) DEFAULT 1,
            UNIQUE KEY uq_nombre (nombre)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ");
} catch (\Throwable $e) { error_log('[config/proyectos] ' . $e->getMessage()); }

// historial.proveedor: antes el proveedor de un ingreso solo quedaba
// enterrado como texto dentro de la descripción — con esto queda en su
// propia columna, para poder agrupar/sumar por proveedor de forma
// confiable (reporte de "Proveedores" en Informes).
try {
    $colsHistProv = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('proveedor', $colsHistProv)) {
        $pdo->exec("ALTER TABLE historial ADD COLUMN proveedor VARCHAR(150) DEFAULT NULL");
    }
} catch (\Throwable $e) { error_log('[config/historial proveedor] ' . $e->getMessage()); }

// historial.cliente_proyecto: para gastos (no ventas) — permite agrupar
// todo lo gastado en un mismo trabajo/proyecto (ej: "Entrepinos"), sin
// importar cuál técnico lo gastó ni en qué fecha. Separado de
// "cliente_venta" a propósito — son conceptos distintos (uno es quién
// compró, el otro es en qué proyecto se usó el material).
try {
    $colsHistCliProy = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('cliente_proyecto', $colsHistCliProy)) {
        $pdo->exec("ALTER TABLE historial ADD COLUMN cliente_proyecto VARCHAR(150) DEFAULT NULL");
        $pdo->exec("ALTER TABLE historial ADD INDEX idx_cliente_proyecto (cliente_proyecto)");
    }
} catch (\Throwable $e) { error_log('[config/historial cliente_proyecto] ' . $e->getMessage()); }

// productos: costo unitario más reciente, para saber cuánto valió la
// última compra registrada (se llena al "Registrar llegada" si se indica).
try {
    $colsProd = $pdo->query("SHOW COLUMNS FROM productos")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('costo_unitario', $colsProd)) {
        $pdo->exec("ALTER TABLE productos ADD COLUMN costo_unitario DECIMAL(12,2) DEFAULT NULL");
    }
} catch (\Throwable $e) { error_log('[config/productos costo_unitario] ' . $e->getMessage()); }

// pedidos_municipio: el ENUM de "estado" venía corto (error real detectado:
// "Data truncated for column 'estado'" al despachar) — se amplía para
// cubrir todos los valores que el código realmente usa.
try {
    $estadoPM = $pdo->query("
        SELECT COLUMN_TYPE FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pedidos_municipio' AND COLUMN_NAME = 'estado'
    ")->fetchColumn();
    if ($estadoPM && stripos($estadoPM, 'en_camino') === false) {
        $pdo->exec("ALTER TABLE pedidos_municipio MODIFY estado ENUM('pendiente','en_gestion','atendido','rechazado','escalado','en_camino') DEFAULT 'pendiente'");
    }
} catch (\Throwable $e) { error_log('[config/pedidos_municipio estado enum] ' . $e->getMessage()); }

// pedidos_municipio: varias partes del sistema asumen que existen estas
// columnas (error real detectado: "Unknown column 'fecha_respuesta'").
try {
    $colsPM = $pdo->query("SHOW COLUMNS FROM pedidos_municipio")->fetchAll(PDO::FETCH_COLUMN);
    $faltantesPM = [
        'fecha_respuesta' => "DATETIME DEFAULT NULL",
        'rechazado_por'   => "VARCHAR(60) DEFAULT NULL",
        'motivo'          => "VARCHAR(300) DEFAULT NULL",
    ];
    foreach ($faltantesPM as $col => $definicion) {
        if (!in_array($col, $colsPM)) {
            $pdo->exec("ALTER TABLE pedidos_municipio ADD COLUMN `$col` $definicion");
        }
    }
} catch (\Throwable $e) { error_log('[config/pedidos_municipio columnas] ' . $e->getMessage()); }

// Varias tablas quedaron con la columna 'id' sin auto-incremento (error
// real detectado: "Field 'id' doesn't have a default value" al insertar)
// — se revisan y corrigen automáticamente las más usadas.
function _asegurarAutoIncrementId(PDO $pdo, string $tabla): void {
    try {
        $colInfo = $pdo->query("
            SELECT COLUMN_TYPE, EXTRA, COLUMN_KEY FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = " . $pdo->quote($tabla) . " AND COLUMN_NAME = 'id'
        ")->fetch();
        if ($colInfo && stripos($colInfo['EXTRA'], 'auto_increment') === false) {
            $tipo = $colInfo['COLUMN_TYPE'] ?: 'INT';
            if (empty($colInfo['COLUMN_KEY'])) {
                try { $pdo->exec("ALTER TABLE `$tabla` ADD PRIMARY KEY (id)"); } catch (\Throwable $e2) {}
            }
            $pdo->exec("ALTER TABLE `$tabla` MODIFY id $tipo NOT NULL AUTO_INCREMENT");
        }
    } catch (\Throwable $e) { error_log("[config/auto_increment $tabla] " . $e->getMessage()); }
}
foreach (['envios_seguimiento','productos','historial','fibra_carretes','fibra_categorias','proveedores','sedes'] as $_tabla) {
    _asegurarAutoIncrementId($pdo, $_tabla);
}

// Confirmación de quién instaló de verdad — si alguien marca a OTRA
// persona como instaladora, esa persona debe confirmarlo ella misma
// (o decir que no fue ella), para que no se pueda inventar sin más.
try {
    $colsOntConf = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
    if (!in_array('instalacion_confirmada', $colsOntConf)) {
        $pdo->exec("ALTER TABLE ont_seriales ADD COLUMN instalacion_confirmada ENUM('confirmada','pendiente','disputada') DEFAULT NULL");
    }
    if (!in_array('motivo_disputa_instalacion', $colsOntConf)) {
        $pdo->exec("ALTER TABLE ont_seriales ADD COLUMN motivo_disputa_instalacion VARCHAR(255) DEFAULT NULL");
    }
    // Cuando la oficina asigna una ONT a un técnico como instalador, el
    // técnico debe ACEPTAR esa asignación antes de poder instalarla — así
    // no le "cae" trabajo sin que él lo sepa/acepte.
    if (!in_array('asignacion_confirmada', $colsOntConf)) {
        $pdo->exec("ALTER TABLE ont_seriales ADD COLUMN asignacion_confirmada ENUM('aceptada','pendiente','rechazada') DEFAULT NULL");
    }
    if (!in_array('motivo_rechazo_asignacion', $colsOntConf)) {
        $pdo->exec("ALTER TABLE ont_seriales ADD COLUMN motivo_rechazo_asignacion VARCHAR(255) DEFAULT NULL");
    }
    // Coordenadas GPS de la instalación (capturadas desde el celular al
    // marcar la ONT como instalada), para poder ver el punto exacto en mapa.
    foreach (['gps_lat' => "DECIMAL(10,6) DEFAULT NULL", 'gps_lng' => "DECIMAL(10,6) DEFAULT NULL"] as $col => $def) {
        if (!in_array($col, $colsOntConf)) {
            $pdo->exec("ALTER TABLE ont_seriales ADD COLUMN `$col` $def");
        }
    }
} catch (\Throwable $e) { error_log('[config/ont instalacion_confirmada] ' . $e->getMessage()); }

// Material recogido en campo (ej: un cambio en casa del cliente) — vive
// APARTE del inventario normal de cada persona, no se mezcla con lo que
// ya tenía. Lo reutilizable se puede devolver al almacén central desde ahí.
try {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS material_recogido (
            id INT AUTO_INCREMENT PRIMARY KEY,
            producto_id INT NOT NULL,
            ref VARCHAR(20) NOT NULL,
            nombre VARCHAR(255) NOT NULL,
            usuario VARCHAR(60) NOT NULL,
            cantidad INT NOT NULL,
            tipo ENUM('reutilizable','dañado') NOT NULL,
            motivo VARCHAR(255) DEFAULT NULL,
            estado ENUM('en_poder','devuelto','gastado') NOT NULL DEFAULT 'en_poder',
            fecha DATETIME NOT NULL,
            fecha_devolucion DATETIME DEFAULT NULL,
            KEY idx_usuario (usuario),
            KEY idx_estado (estado)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    ");
    // Por si la tabla ya existía de una versión anterior sin 'gastado'
    $colEstado = $pdo->query("SHOW COLUMNS FROM material_recogido LIKE 'estado'")->fetch();
    if ($colEstado && stripos($colEstado['Type'], "'gastado'") === false) {
        $pdo->exec("ALTER TABLE material_recogido MODIFY estado ENUM('en_poder','devuelto','gastado') NOT NULL DEFAULT 'en_poder'");
    }
    // 'en_transito': la devolución ahora pasa por Seguimiento (alguien en el
    // almacén debe confirmar que de verdad lo recibió) — ya no se auto-confirma.
    $colEstado2 = $pdo->query("SHOW COLUMNS FROM material_recogido LIKE 'estado'")->fetch();
    if ($colEstado2 && stripos($colEstado2['Type'], "'en_transito'") === false) {
        $pdo->exec("ALTER TABLE material_recogido MODIFY estado ENUM('en_poder','en_transito','devuelto','gastado') NOT NULL DEFAULT 'en_poder'");
    }
    // 'dado_de_baja': para material DAÑADO — antes no tenía ninguna acción
    // posible y se quedaba "en poder" para siempre. Solo un admin puede
    // marcarlo así, desde la vista general de material recogido.
    $colEstado3 = $pdo->query("SHOW COLUMNS FROM material_recogido LIKE 'estado'")->fetch();
    if ($colEstado3 && stripos($colEstado3['Type'], "'dado_de_baja'") === false) {
        $pdo->exec("ALTER TABLE material_recogido MODIFY estado ENUM('en_poder','en_transito','devuelto','gastado','dado_de_baja') NOT NULL DEFAULT 'en_poder'");
    }
    // Material "nuevo / otro proveedor": no está en el catálogo; lo escribe quien lo recoge
    // y el admin/distribuidor lo acepta (suma a uno existente o crea el producto).
    $colsMR = array_column($pdo->query("SHOW COLUMNS FROM material_recogido")->fetchAll(), 'Field');
    if (!in_array('es_nuevo', $colsMR))        $pdo->exec("ALTER TABLE material_recogido ADD COLUMN es_nuevo TINYINT(1) NOT NULL DEFAULT 0");
    if (!in_array('proveedor_nuevo', $colsMR)) $pdo->exec("ALTER TABLE material_recogido ADD COLUMN proveedor_nuevo VARCHAR(150) DEFAULT NULL");
    // stock_acreditado: 1 si las unidades de este registro YA están sumadas al stock recuperado
    // del producto (evita sumar dos veces o corregir stock que no se sumó).
    if (!in_array('stock_acreditado', $colsMR)) {
        $pdo->exec("ALTER TABLE material_recogido ADD COLUMN stock_acreditado TINYINT(1) NOT NULL DEFAULT 0");
        // Lo reutilizable ya recibido se sumaba solo: marcarlo como acreditado
        $pdo->exec("UPDATE material_recogido SET stock_acreditado = 1 WHERE estado = 'devuelto' AND tipo = 'reutilizable' AND es_nuevo = 0");
    }
} catch (\Throwable $e) { error_log('[config/material_recogido] ' . $e->getMessage()); }

// Reparar codificación: las columnas nuevas de arriba (stock_usuarios,
// fibra_carretes.usuario_actual, material_recogido.usuario) se crearon con
// la codificación por defecto del servidor, que puede no coincidir con la
// de la tabla "usuarios" original — eso rompe cualquier comparación entre
// ellas (error "Illegal mix of collations"). Se detecta la codificación
// real de usuarios.usuario y se iguala en las 3 columnas nuevas.
try {
    $colUsr = $pdo->query("
        SELECT COLLATION_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'usuario'
    ")->fetchColumn();
    // Revisar si stock_usuarios.usuario ya coincide — si sí, no hay nada
    // que hacer (evita repetir el ALTER en cada carga de página).
    $colActual = $pdo->query("
        SELECT COLLATION_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'stock_usuarios' AND COLUMN_NAME = 'usuario'
    ")->fetchColumn();
    if ($colUsr && $colActual && $colUsr !== $colActual) {
        $fixes = [
            "ALTER TABLE stock_usuarios MODIFY usuario VARCHAR(60) NOT NULL COLLATE $colUsr",
            "ALTER TABLE fibra_carretes MODIFY usuario_actual VARCHAR(60) DEFAULT NULL COLLATE $colUsr",
            "ALTER TABLE material_recogido MODIFY usuario VARCHAR(60) NOT NULL COLLATE $colUsr",
        ];
        foreach ($fixes as $sql) {
            try { $pdo->exec($sql); } catch (\Throwable $e) { error_log('[config/fix collation] ' . $e->getMessage()); }
        }
    }
} catch (\Throwable $e) { error_log('[config/detectar collation] ' . $e->getMessage()); }

/* Suma (o resta, con número negativo) cantidad al stock personal de un
   usuario para un producto. Crea la fila si no existía. Nunca deja el
   resultado en negativo (se topa en 0). */
function stockUsuarioAjustar($pdo, $productoId, $usuario, $delta) {
    if (!$usuario || !$productoId || $delta == 0) return;
    $existe = $pdo->prepare("SELECT cantidad FROM stock_usuarios WHERE producto_id=? AND usuario=?");
    $existe->execute([$productoId, $usuario]);
    $actual = $existe->fetchColumn();
    if ($actual === false) {
        $pdo->prepare("INSERT INTO stock_usuarios (producto_id, usuario, cantidad) VALUES (?, ?, ?)")
            ->execute([$productoId, $usuario, max(0, $delta)]);
    } else {
        // Sin (int) — un producto por metros necesita decimales (ej: 12.5).
        $nuevo = max(0, (float)$actual + $delta);
        $pdo->prepare("UPDATE stock_usuarios SET cantidad=? WHERE producto_id=? AND usuario=?")
            ->execute([$nuevo, $productoId, $usuario]);
    }
}
function stockUsuarioObtener($pdo, $productoId, $usuario) {
    $st = $pdo->prepare("SELECT cantidad FROM stock_usuarios WHERE producto_id=? AND usuario=?");
    $st->execute([$productoId, $usuario]);
    $v = $st->fetchColumn();
    return $v === false ? 0 : (float)$v;
}

// ─── Helpers ─────────────────────────────────────────────────
// Candado por producto: evita que dos aprobaciones simultáneas lean el mismo
// "disponible" y aprueben la misma última unidad. Se toma ANTES de revisar el
// disponible y se suelta solo cuando termina la petición (la conexión se cierra),
// o sea después de guardar la aprobación. Si otra persona lo tiene, espera hasta 5 s.
function bloquearStockProducto($pdo, $ref) {
    try {
        $st = $pdo->prepare("SELECT GET_LOCK(?, 5)");
        $st->execute(['stock_aprob_' . substr(md5((string)$ref), 0, 16)]);
        if ((int)$st->fetchColumn() !== 1) {
            responder(['error' => 'Otra persona está aprobando este producto en este momento. Intenta de nuevo en unos segundos.'], 409);
        }
    } catch (\Throwable $e) { error_log('[bloquearStockProducto] ' . $e->getMessage()); }
}
// Stock del almacén central ya COMPROMETIDO: lo aprobado que todavía no se
// despacha. El stock físico (stock_neiva) solo baja al despachar, así que sin
// esto dos usuarios podían aprobar la misma última unidad.
// disponible = stock_neiva - stockReservadoCentral(ref)
// $excluirRefId: referencia_id del envío que se está aprobando ahora (no se cuenta contra sí mismo).
function stockReservadoCentral($pdo, $ref, $excluirRefId = null) {
    $sql = "SELECT COALESCE(SUM(cantidad),0) FROM envios_seguimiento
            WHERE ref_producto = ? AND estado = 'aprobado'
              AND tipo IN ('solicitud','pedido') AND origen = 'Almacen Central'
              AND (notas IS NULL OR notas NOT LIKE '%[STOCK:recuperado]%')";
    $par = [$ref];
    if ($excluirRefId !== null && $excluirRefId !== '') { $sql .= " AND referencia_id <> ?"; $par[] = (string)$excluirRefId; }
    // Dentro de una transacción (pedidos agrupados) la lectura normal vería una foto vieja;
    // FOR UPDATE lee lo último ya confirmado por otras aprobaciones.
    if ($pdo->inTransaction()) $sql .= ' FOR UPDATE';
    try { $st = $pdo->prepare($sql); $st->execute($par); return (float)$st->fetchColumn(); }
    catch (\Throwable $e) { error_log('[stockReservadoCentral] ' . $e->getMessage()); return 0.0; }
}

function responder($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

// ─── Manejo global de errores: garantiza respuesta JSON (no HTML) ───
// Evita que un warning/fatal de PHP rompa el JSON que espera el frontend.
$__esProd = ($_ENV['APP_ENV'] ?? 'local') === 'production';
ini_set('display_errors', '0');
error_reporting(E_ALL);
set_exception_handler(function ($e) use ($__esProd) {
    error_log('[uncaught] ' . $e->getMessage());
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode([
        'error'   => 'Error interno del servidor',
        'detalle' => $__esProd ? 'Contacta al administrador del sistema' : $e->getMessage(),
    ], JSON_UNESCAPED_UNICODE);
    exit;
});
register_shutdown_function(function () use ($__esProd) {
    $err = error_get_last();
    if ($err && in_array($err['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
        if (!headers_sent()) {
            http_response_code(500);
            header('Content-Type: application/json; charset=utf-8');
        }
        echo json_encode([
            'error'   => 'Error interno del servidor',
            'detalle' => $__esProd ? 'Contacta al administrador del sistema' : $err['message'],
        ], JSON_UNESCAPED_UNICODE);
    }
});

function sesionRequerida() {
    if (empty($_SESSION['usuario'])) {
        responder(['error' => 'No autenticado', 'redirect' => 'index.html'], 401);
    }
}

function rolRequerido(...$roles) {
    sesionRequerida();
    if (!in_array($_SESSION['rol'], $roles)) {
        responder(['error' => 'Sin permisos para esta acción'], 403);
    }
}

/* Autoriza si el rol de la sesión está en $roles, O si el usuario tiene
   el permiso granular $permiso asignado en su columna `permisos` —
   así el superadmin puede otorgar esta capacidad a cualquier rol. */
// Permisos por defecto por rol — respaldo para cuando una cuenta nunca tuvo
// permisos personalizados asignados a mano (permisos=NULL/vacío en la BD).
// Debe reflejar exactamente la misma lista que PERMISOS_DEFAULT en
// dashboard.html — si se cambia uno, hay que cambiar el otro también.
const PERMISOS_DEFAULT_POR_ROL = [
    'distribuidor' => [
        'ver_inventario','editar_productos','enviar_material','enviar_multiple',
        'registrar_gastos','registrar_ingresos','gestionar_pedidos',
        'despachar','elegir_material_despacho',
        'crear_proveedores','editar_proveedores','solicitar_compras',
        'ver_historial','ver_reportes',
        'registrar_ont','gestionar_fibra','eliminar_fibra','ver_mis_equipos',
        'gestionar_equipos','gestionar_olt',
    ],
    // "enviar_material" (Asignar a alguien / Asignar Multiple) SÍ viene
    // predeterminado para estos tres roles, igual que Pedir Multiple,
    // Gastar Multiple y Devolver Multiple — no hay que ir a dar el permiso
    // a mano para que lo vean. Queda como permiso normal (no como chequeo
    // de solo-rol) para que el superadmin pueda, si alguna vez lo necesita,
    // quitárselo a una cuenta puntual sin tocar el resto.
    // Municipio (oficina que supervisa a sus técnicos/personas) tiene lo de
    // Persona/Técnico más registrar la llegada de stock a su sede y ver sus
    // propios reportes. "ver_mapa_actividad" quedó descartado para los tres
    // a pedido explícito del dueño del sistema.
    'municipio' => [
        'ver_inventario','ver_historial','crear_solicitudes','enviar_material',
        'registrar_gastos','ver_mis_equipos','registrar_ont',
        'registrar_ingresos','ver_reportes',
    ],
    'tecnico' => [
        'ver_inventario','ver_historial','crear_solicitudes','enviar_material',
        'registrar_gastos','ver_mis_equipos','registrar_ont',
    ],
    'persona' => [
        'ver_inventario','ver_historial','crear_solicitudes','enviar_material',
        'registrar_gastos','ver_mis_equipos','registrar_ont',
    ],
];

/* Igual que rolOPermiso pero sin cortar la ejecución — devuelve true/false.
   Se usa cuando el permiso decide QUÉ datos traer (ej: ver pedidos de todos
   vs. solo los propios), no si la acción se bloquea por completo. */
function usuarioTienePermiso(string $permiso): bool {
    global $pdo;
    if (empty($_SESSION['usuario'])) return false;
    if (($_SESSION['rol'] ?? '') === 'superadmin') return true;
    try {
        $st = $pdo->prepare("SELECT permisos FROM usuarios WHERE id = ?");
        $st->execute([$_SESSION['usuario_id'] ?? 0]);
        $perms = json_decode($st->fetchColumn() ?: '[]', true) ?: [];
    } catch (\Throwable $e) { $perms = []; }
    if (empty($perms)) {
        $perms = PERMISOS_DEFAULT_POR_ROL[$_SESSION['rol']] ?? [];
    }
    return in_array($permiso, $perms);
}

/** Exige que el cuerpo traiga la contraseña de la sesión actual (acciones destructivas). Responde 400/401 si falta o es incorrecta. */
/* El distribuidor NO asigna material a técnicos/personas: solo ENTREGA (envíos a oficinas y despachos). */
function noAsignaDistribuidor(): void {
    if (($_SESSION['rol'] ?? '') === 'distribuidor') {
        responder(['error' => 'El distribuidor no asigna material directamente: solo entrega (envío a una oficina). La asignación a técnicos o personas la hace el municipio.'], 403);
    }
}

function exigirPasswordSesion(array $d, string $msgFalta = 'Debes confirmar tu contraseña para continuar.'): void {
    global $pdo;
    $p = (string)($d['password'] ?? '');
    if ($p === '') responder(['error' => $msgFalta, 'requiere_password' => true], 400);
    $q = $pdo->prepare("SELECT password FROM usuarios WHERE usuario = ?");
    $q->execute([$_SESSION['usuario'] ?? '']);
    $h = $q->fetchColumn();
    if (!$h || !password_verify($p, $h)) responder(['error' => 'Contraseña incorrecta.', 'password_incorrecta' => true], 401);
}

function rolOPermiso(array $roles, string $permiso) {
    global $pdo;
    sesionRequerida();
    if (in_array($_SESSION['rol'], $roles)) return;
    try {
        $st = $pdo->prepare("SELECT permisos FROM usuarios WHERE id = ?");
        $st->execute([$_SESSION['usuario_id'] ?? 0]);
        $perms = json_decode($st->fetchColumn() ?: '[]', true) ?: [];
    } catch (\Throwable $e) { $perms = []; }
    // Si la cuenta nunca tuvo permisos personalizados guardados, se usan
    // los permisos por defecto de su rol — antes esto simplemente
    // rechazaba TODO, sin importar el rol, si $perms venía vacío.
    if (empty($perms)) {
        $perms = PERMISOS_DEFAULT_POR_ROL[$_SESSION['rol']] ?? [];
    }
    if (!in_array($permiso, $perms)) {
        responder(['error' => 'Sin permisos para esta acción'], 403);
    }
}

/* Igual que rolOPermiso, pero acepta VARIOS permisos alternativos (basta con
   tener UNO de ellos). Se usa cuando un permiso "general" se dividió en
   varios más finos, para que quien ya tenía el general siga funcionando
   igual mientras se delega el fino a otras cuentas. */
function rolOPermisoAlt(array $roles, array $permisosAlt) {
    global $pdo;
    sesionRequerida();
    if (in_array($_SESSION['rol'], $roles)) return;
    try {
        $st = $pdo->prepare("SELECT permisos FROM usuarios WHERE id = ?");
        $st->execute([$_SESSION['usuario_id'] ?? 0]);
        $perms = json_decode($st->fetchColumn() ?: '[]', true) ?: [];
    } catch (\Throwable $e) { $perms = []; }
    if (empty($perms)) {
        $perms = PERMISOS_DEFAULT_POR_ROL[$_SESSION['rol']] ?? [];
    }
    foreach ($permisosAlt as $p) {
        if (in_array($p, $perms)) return;
    }
    responder(['error' => 'Sin permisos para esta acción'], 403);
}