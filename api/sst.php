<?php
require 'config.php';
require_once 'auditoria.php';
sesionRequerida();

$method = $_SERVER['REQUEST_METHOD'];
$action = $_GET['action'] ?? '';

/* ══════════════════════════════════════
   SST — Seguridad y Salud en el Trabajo
   (cascos, escaleras, eslingas, arneses, herramientas…)
   Gestiona: superadmin, distribuidor o quien tenga "gestionar_sst".
   Cualquier usuario puede ver/confirmar LO QUE LE ENTREGARON.
══════════════════════════════════════ */
try {
    $pdo->query("CREATE TABLE IF NOT EXISTS sst_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        codigo VARCHAR(30) NOT NULL,
        nombre VARCHAR(150) NOT NULL,
        categoria VARCHAR(40) NOT NULL DEFAULT 'otro',
        marca VARCHAR(100) NULL,
        serial VARCHAR(100) NULL,
        descripcion VARCHAR(300) NULL,
        cantidad INT NOT NULL DEFAULT 1,
        estado VARCHAR(20) NOT NULL DEFAULT 'disponible',
        fecha_compra DATE NULL,
        fecha_vencimiento DATE NULL,
        periodicidad_dias INT NULL,
        prox_inspeccion DATE NULL,
        motivo_baja VARCHAR(300) NULL,
        activo TINYINT(1) NOT NULL DEFAULT 1,
        creado_por VARCHAR(60) NULL,
        creado_en DATETIME DEFAULT NOW(),
        UNIQUE KEY uq_codigo (codigo)
    )");
    $pdo->query("CREATE TABLE IF NOT EXISTS sst_categorias (
        clave VARCHAR(40) NOT NULL PRIMARY KEY,
        nombre VARCHAR(60) NOT NULL,
        icono VARCHAR(16) NOT NULL DEFAULT '📦',
        creado_en DATETIME DEFAULT NOW()
    )");
    foreach ([['sst_categorias','campos','TEXT NULL'],['sst_items','datos','TEXT NULL'],['sst_items','fecha_fabricacion','DATE NULL'],['sst_items','fecha_inspeccion','DATE NULL']] as [$t,$c,$def]) {
        $ex = $pdo->prepare("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?");
        $ex->execute([$t,$c]);
        if (!(int)$ex->fetchColumn()) $pdo->query("ALTER TABLE $t ADD COLUMN $c $def");
    }
    // Limpieza única: una versión anterior creaba categorías de ejemplo. Se quitan las que nadie usa.
    $pdo->query("CREATE TABLE IF NOT EXISTS sst_meta (clave VARCHAR(40) PRIMARY KEY, valor VARCHAR(100))");
    if (!$pdo->query("SELECT 1 FROM sst_meta WHERE clave='limpieza_cats_v1'")->fetchColumn()) {
        $pdo->query("DELETE FROM sst_categorias WHERE clave IN ('casco','escalera','eslinga','arnes','herramienta','guantes','gafas','botas','otro')
                     AND clave NOT IN (SELECT DISTINCT categoria FROM sst_items WHERE activo=1)");
        $pdo->query("INSERT INTO sst_meta (clave,valor) VALUES ('limpieza_cats_v1','1')");
    }
    $pdo->query("CREATE TABLE IF NOT EXISTS sst_entregas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_id INT NOT NULL,
        usuario VARCHAR(60) NOT NULL,
        cantidad INT NOT NULL DEFAULT 1,
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        entregado_por VARCHAR(60) NULL,
        fecha_entrega DATETIME DEFAULT NOW(),
        confirmado_en DATETIME NULL,
        devuelta_en DATETIME NULL,
        estado_devolucion VARCHAR(20) NULL,
        nota VARCHAR(300) NULL,
        INDEX (item_id), INDEX (usuario), INDEX (estado)
    )");
    $pdo->query("CREATE TABLE IF NOT EXISTS sst_inspecciones (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_id INT NOT NULL,
        fecha DATE NOT NULL,
        inspector VARCHAR(60) NULL,
        resultado VARCHAR(20) NOT NULL DEFAULT 'aprobado',
        notas VARCHAR(400) NULL,
        creado_en DATETIME DEFAULT NOW(),
        INDEX (item_id)
    )");
} catch (\Throwable $e) { error_log('[sst/tablas] '.$e->getMessage()); }

function sstGestiona(): void { rolOPermiso(['superadmin', 'distribuidor'], 'gestionar_sst'); }
function sstFecha($v) {
    $v = trim((string)$v);
    if ($v === '') return null;
    $t = date_create($v);
    return $t ? $t->format('Y-m-d') : null;
}
function sstBody(): array { return json_decode(file_get_contents('php://input'), true) ?: []; }
function sstSlug(string $t): string {
    $t = mb_strtolower(trim($t), 'UTF-8');
    $t = strtr($t, ['á'=>'a','é'=>'e','í'=>'i','ó'=>'o','ú'=>'u','ü'=>'u','ñ'=>'n']);
    return trim(preg_replace('/[^a-z0-9]+/', '-', $t), '-');
}
function sstCategoria(PDO $pdo, $c): string {
    $c = trim((string)$c);
    $q = $pdo->prepare("SELECT clave FROM sst_categorias WHERE clave=?");
    $q->execute([$c]);
    $k = $q->fetchColumn();
    if (!$k) responder(['error'=>'Elige una categoría válida (o crea una nueva)'], 400);
    return $k;
}
/* Campos propios de cada categoría: [{clave,nombre,tipo:texto|numero|fecha|lista,opciones:[],obligatorio:bool}] */
function sstLimpiarCampos($campos): array {
    if (!is_array($campos)) return [];
    $out = []; $usadas = [];
    foreach ($campos as $c) {
        if (!is_array($c)) continue;
        $nombre = trim((string)($c['nombre'] ?? ''));
        if ($nombre === '') continue;
        $nombre = mb_substr($nombre, 0, 40);
        $clave = substr(sstSlug($nombre), 0, 40) ?: 'campo';
        $base = $clave; $n = 2;
        while (isset($usadas[$clave])) $clave = $base . '-' . $n++;
        $usadas[$clave] = 1;
        $tipo = in_array($c['tipo'] ?? '', ['texto','numero','fecha','lista'], true) ? $c['tipo'] : 'texto';
        $ops = [];
        if ($tipo === 'lista') {
            $raw = $c['opciones'] ?? [];
            if (is_string($raw)) $raw = explode(',', $raw);
            foreach ((array)$raw as $o) { $o = mb_substr(trim((string)$o), 0, 40); if ($o !== '' && !in_array($o, $ops, true)) $ops[] = $o; }
            if (count($ops) < 2) responder(['error'=>"El campo \"$nombre\" es una lista: escribe al menos 2 opciones separadas por coma"], 400);
        }
        $out[] = ['clave'=>$clave,'nombre'=>$nombre,'tipo'=>$tipo,'opciones'=>$ops,'obligatorio'=>!empty($c['obligatorio'])];
        if (count($out) >= 12) break;
    }
    return $out;
}
function sstCamposDe(PDO $pdo, string $cat): array {
    $q = $pdo->prepare("SELECT campos FROM sst_categorias WHERE clave=?");
    $q->execute([$cat]);
    return json_decode((string)$q->fetchColumn() ?: '[]', true) ?: [];
}
/* Valida y limpia los valores del artículo contra los campos de su categoría → JSON o null */
function sstLimpiarDatos(PDO $pdo, string $cat, $datos): ?string {
    $campos = sstCamposDe($pdo, $cat);
    $datos = is_array($datos) ? $datos : [];
    $out = [];
    foreach ($campos as $c) {
        $v = trim((string)($datos[$c['clave']] ?? ''));
        if ($v === '') {
            if (!empty($c['obligatorio'])) responder(['error'=>"Falta el campo \"{$c['nombre']}\""], 400);
            continue;
        }
        if ($c['tipo'] === 'numero') {
            $v = str_replace(',', '.', $v);
            if (!is_numeric($v)) responder(['error'=>"\"{$c['nombre']}\" debe ser un número"], 400);
        } elseif ($c['tipo'] === 'fecha') {
            $f = sstFecha($v);
            if (!$f) responder(['error'=>"\"{$c['nombre']}\" no es una fecha válida"], 400);
            $v = $f;
        } elseif ($c['tipo'] === 'lista') {
            if (!in_array($v, $c['opciones'], true)) responder(['error'=>"Elige una opción válida en \"{$c['nombre']}\""], 400);
        } else $v = mb_substr($v, 0, 150);
        $out[$c['clave']] = $v;
    }
    return $out ? json_encode($out, JSON_UNESCAPED_UNICODE) : null;
}
function sstProx($insp, $prox, int $per) {
    if ($prox) return $prox;
    if ($per > 0) return date('Y-m-d', strtotime(($insp ?: date('Y-m-d')) . " +$per days"));
    return null;
}
function sstEnEntrega(PDO $pdo, int $itemId): int {
    $q = $pdo->prepare("SELECT COALESCE(SUM(cantidad),0) FROM sst_entregas WHERE item_id=? AND estado IN ('pendiente','activa')");
    $q->execute([$itemId]);
    return (int)$q->fetchColumn();
}
function sstCodigo(PDO $pdo, string $cat): string {
    $letras = strtoupper(substr(preg_replace('/[^a-z]/', '', sstSlug($cat)), 0, 3));
    $pref = strlen($letras) >= 2 ? $letras : 'SST';
    $n = (int)$pdo->query("SELECT COALESCE(MAX(id),0)+1 FROM sst_items")->fetchColumn();
    do {
        $cod = $pref . '-' . str_pad((string)$n, 4, '0', STR_PAD_LEFT);
        $q = $pdo->prepare("SELECT 1 FROM sst_items WHERE codigo=?");
        $q->execute([$cod]);
        $n++;
    } while ($q->fetchColumn());
    return $cod;
}
function sstUsuarioValido(PDO $pdo, string $u): bool {
    $q = $pdo->prepare("SELECT 1 FROM usuarios WHERE usuario=?");
    $q->execute([$u]);
    return (bool)$q->fetchColumn();
}

/* ── Items con disponibilidad calculada y alerta ── */
function sstListarItems(PDO $pdo): array {
    $rows = $pdo->query("
        SELECT i.*,
          COALESCE((SELECT SUM(e.cantidad) FROM sst_entregas e WHERE e.item_id=i.id AND e.estado IN ('pendiente','activa')),0) AS en_uso,
          (SELECT MAX(n.fecha) FROM sst_inspecciones n WHERE n.item_id=i.id) AS ultima_inspeccion
        FROM sst_items i WHERE i.activo=1 ORDER BY i.nombre, i.id
    ")->fetchAll(PDO::FETCH_ASSOC);
    $hoy = date('Y-m-d');
    $en30 = date('Y-m-d', strtotime('+30 days'));
    foreach ($rows as &$r) {
        $r['datos'] = json_decode((string)($r['datos'] ?? ''), true) ?: new stdClass();
        $r['cantidad'] = (int)$r['cantidad'];
        $r['en_uso'] = (int)$r['en_uso'];
        $r['disponible'] = $r['estado'] === 'disponible' ? max(0, $r['cantidad'] - $r['en_uso']) : 0;
        $alerta = '';
        if ($r['estado'] !== 'baja') {
            $p = $r['prox_inspeccion'];
            if ($p && $p < $hoy) $alerta = 'inspeccion_vencida';
            elseif ($p && $p <= $en30) $alerta = 'inspeccion_proxima';
        }
        $r['alerta'] = $alerta;
    }
    return $rows;
}

/* ══ RESUMEN ══ */
if ($method === 'GET' && $action === 'resumen') {
    sstGestiona();
    $items = sstListarItems($pdo);
    $r = ['total'=>0,'disponibles'=>0,'en_uso'=>0,'mantenimiento'=>0,'bajas'=>0,'alertas'=>0,'vencidos'=>0,'por_vencer'=>0,'pendientes_confirmar'=>0];
    $alertas = [];
    foreach ($items as $i) {
        if ($i['estado'] === 'baja') { $r['bajas'] += $i['cantidad']; continue; }
        $r['total'] += $i['cantidad'];
        $r['disponibles'] += $i['disponible'];
        $r['en_uso'] += $i['en_uso'];
        if ($i['estado'] === 'mantenimiento') $r['mantenimiento'] += $i['cantidad'];
        if ($i['alerta']) {
            $r['alertas']++;
            if ($i['alerta'] === 'inspeccion_vencida') $r['vencidos']++; else $r['por_vencer']++;
            $alertas[] = $i;
        }
    }
    $r['pendientes_confirmar'] = (int)$pdo->query("SELECT COUNT(*) FROM sst_entregas WHERE estado='pendiente'")->fetchColumn();
    responder(['resumen'=>$r, 'alertas'=>$alertas]);
}

/* Solo el número de alertas (para el puntito del menú) */
if ($method === 'GET' && $action === 'badge') {
    sstGestiona();
    $n = 0;
    foreach (sstListarItems($pdo) as $i) if ($i['alerta'] && $i['estado'] !== 'baja') $n++;
    responder(['alertas'=>$n]);
}

/* ══ CATEGORÍAS (las crea el usuario) ══ */
if ($method === 'GET' && $action === 'categorias') {
    sstGestiona();
    $rows = $pdo->query("SELECT clave, nombre, icono, campos, (SELECT COUNT(*) FROM sst_items i WHERE i.categoria=c.clave AND i.activo=1) AS usados FROM sst_categorias c ORDER BY nombre")->fetchAll(PDO::FETCH_ASSOC);
    foreach ($rows as &$r) $r['campos'] = json_decode((string)($r['campos'] ?? ''), true) ?: [];
    responder($rows);
}
if ($method === 'POST' && $action === 'crear_categoria') {
    sstGestiona();
    $d = sstBody();
    $nombre = trim($d['nombre'] ?? '');
    $icono = trim($d['icono'] ?? '') ?: '📦';
    if ($nombre === '' || mb_strlen($nombre) > 60) responder(['error'=>'Escribe el nombre de la categoría (máx. 60 letras)'], 400);
    $clave = substr(sstSlug($nombre), 0, 40);
    if ($clave === '') responder(['error'=>'Usa letras o números en el nombre'], 400);
    $q = $pdo->prepare("SELECT nombre FROM sst_categorias WHERE clave=? OR LOWER(nombre)=LOWER(?)");
    $q->execute([$clave, $nombre]);
    if ($ex = $q->fetchColumn()) responder(['error'=>"Ya existe la categoría \"$ex\""], 409);
    $campos = sstLimpiarCampos($d['campos'] ?? []);
    $pdo->prepare("INSERT INTO sst_categorias (clave,nombre,icono,campos) VALUES (?,?,?,?)")->execute([$clave, $nombre, mb_substr($icono, 0, 8), json_encode($campos, JSON_UNESCAPED_UNICODE)]);
    try { auditar($pdo,'crear_categoria','sst',"Categoría SST creada: $nombre",$clave); } catch (\Throwable $e) {}
    responder(['ok'=>true,'clave'=>$clave,'nombre'=>$nombre,'icono'=>mb_substr($icono, 0, 8)]);
}
if ($method === 'POST' && $action === 'editar_categoria') {
    sstGestiona();
    $d = sstBody();
    $clave = trim($d['clave'] ?? '');
    $q = $pdo->prepare("SELECT * FROM sst_categorias WHERE clave=?");
    $q->execute([$clave]);
    $cat = $q->fetch(PDO::FETCH_ASSOC);
    if (!$cat) responder(['error'=>'Categoría no encontrada'], 404);
    $nombre = trim($d['nombre'] ?? '');
    if ($nombre === '' || mb_strlen($nombre) > 60) responder(['error'=>'Escribe el nombre de la categoría (máx. 60 letras)'], 400);
    $q = $pdo->prepare("SELECT 1 FROM sst_categorias WHERE LOWER(nombre)=LOWER(?) AND clave<>?");
    $q->execute([$nombre, $clave]);
    if ($q->fetchColumn()) responder(['error'=>'Ya existe otra categoría con ese nombre'], 409);
    $icono = mb_substr(trim($d['icono'] ?? '') ?: '📦', 0, 8);
    $campos = sstLimpiarCampos($d['campos'] ?? []);
    $pdo->prepare("UPDATE sst_categorias SET nombre=?, icono=?, campos=? WHERE clave=?")->execute([$nombre, $icono, json_encode($campos, JSON_UNESCAPED_UNICODE), $clave]);
    try { auditar($pdo,'editar_categoria','sst',"Categoría SST editada: $nombre",$clave); } catch (\Throwable $e) {}
    responder(['ok'=>true]);
}
if ($method === 'POST' && $action === 'eliminar_categoria') {
    sstGestiona();
    $d = sstBody();
    $clave = trim($d['clave'] ?? '');
    $q = $pdo->prepare("SELECT COUNT(*) FROM sst_items WHERE categoria=? AND activo=1");
    $q->execute([$clave]);
    if ((int)$q->fetchColumn() > 0) responder(['error'=>'Hay artículos con esa categoría. Elimínalos o cámbialos de categoría primero.'], 409);
    $pdo->prepare("DELETE FROM sst_categorias WHERE clave=?")->execute([$clave]);
    try { auditar($pdo,'eliminar_categoria','sst',"Categoría SST eliminada: $clave",$clave); } catch (\Throwable $e) {}
    responder(['ok'=>true]);
}

/* ══ LISTAR ══ */
if ($method === 'GET' && $action === 'listar') {
    sstGestiona();
    responder(sstListarItems($pdo));
}

/* ══ CREAR ══ */
if ($method === 'POST' && $action === 'crear') {
    sstGestiona();
    $d = sstBody();
    $nombre = trim($d['nombre'] ?? '');
    if ($nombre === '') responder(['error'=>'El nombre es obligatorio'], 400);
    $cat = sstCategoria($pdo, $d['categoria'] ?? '');
    $cant = max(1, (int)($d['cantidad'] ?? 1));
    $datosJson = sstLimpiarDatos($pdo, $cat, $d['datos'] ?? []);
    $per = (int)($d['periodicidad_dias'] ?? 0);
    $fab = sstFecha($d['fecha_fabricacion'] ?? '');
    $insp = sstFecha($d['fecha_inspeccion'] ?? '');
    $prox = sstProx($insp, null, $per);
    $serial = trim($d['serial'] ?? '');
    if ($serial !== '') {
        $q = $pdo->prepare("SELECT nombre FROM sst_items WHERE serial=? AND activo=1 LIMIT 1");
        $q->execute([$serial]);
        if ($dup = $q->fetchColumn()) responder(['error'=>"Ya existe \"$dup\" con ese serial"], 409);
        if ($cant > 1) responder(['error'=>'Un artículo con serial es una sola unidad (cantidad 1)'], 400);
    }
    // Varias unidades, cada una con su propio código (y serial opcional): se crean N artículos de cantidad 1
    if (!empty($d['individual']) && $cant > 1) {
        if ($cant > 300) responder(['error'=>'Máximo 300 unidades por vez'], 400);
        $lista = [];
        foreach (preg_split('/[\s,;]+/', (string)($d['seriales'] ?? '')) as $sx) { $sx = trim($sx); if ($sx !== '') $lista[] = $sx; }
        if (count($lista) !== $cant) responder(['error'=>'Escribe un identificador por cada unidad: pusiste '.count($lista).' y la cantidad es '.$cant], 400);
        if (count($lista) !== count(array_unique($lista))) responder(['error'=>'Hay seriales repetidos en la lista'], 400);
        $chk = $pdo->prepare("SELECT nombre FROM sst_items WHERE serial=? AND activo=1 LIMIT 1");
        foreach ($lista as $sx) { $chk->execute([$sx]); if ($dup = $chk->fetchColumn()) responder(['error'=>"El serial $sx ya existe en \"$dup\""], 409); }
        try {
            $pdo->beginTransaction();
            $ins = $pdo->prepare("INSERT INTO sst_items (codigo,nombre,categoria,marca,serial,descripcion,cantidad,fecha_fabricacion,fecha_inspeccion,periodicidad_dias,prox_inspeccion,creado_por,datos)
                           VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?)");
            $codigos = [];
            for ($i = 0; $i < $cant; $i++) {
                $cod = sstCodigo($pdo, $cat);
                $ins->execute([$cod,$nombre,$cat,trim($d['marca']??'')?:null,($lista[$i] ?? null),trim($d['descripcion']??'')?:null,$fab,$insp,$per>0?$per:null,$prox,$_SESSION['usuario']??'',$datosJson]);
                $codigos[] = $cod;
            }
            $pdo->commit();
            try { auditar($pdo,'crear','sst',"SST creado: $nombre x$cant unidades individuales (".$codigos[0]." … ".end($codigos).")",$codigos[0]); } catch (\Throwable $e) {}
            responder(['ok'=>true,'codigo'=>$codigos[0],'creados'=>$cant,'aviso'=>"Se crearon $cant unidades ({$codigos[0]} a ".end($codigos).")"]);
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            error_log('[sst/crear individual] '.$e->getMessage());
            responder(['error'=>'No se pudieron crear las unidades'], 500);
        }
    }
    try {
        $cod = sstCodigo($pdo, $cat);
        $pdo->prepare("INSERT INTO sst_items (codigo,nombre,categoria,marca,serial,descripcion,cantidad,fecha_fabricacion,fecha_inspeccion,periodicidad_dias,prox_inspeccion,creado_por,datos)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
            ->execute([$cod,$nombre,$cat,trim($d['marca']??'')?:null,$serial?:null,trim($d['descripcion']??'')?:null,$cant,$fab,$insp,$per>0?$per:null,$prox,$_SESSION['usuario']??'',$datosJson]);
        $id = (int)$pdo->lastInsertId();
        try { auditar($pdo,'crear','sst',"SST creado: $nombre ($cod) x$cant",$cod); } catch (\Throwable $e) {}
        responder(['ok'=>true,'id'=>$id,'codigo'=>$cod]);
    } catch (\Throwable $e) {
        error_log('[sst/crear] '.$e->getMessage());
        responder(['error'=>'No se pudo crear el artículo'], 500);
    }
}

/* ══ EDITAR ══ */
if ($method === 'POST' && $action === 'editar') {
    sstGestiona();
    $d = sstBody();
    $id = (int)($d['id'] ?? 0);
    $q = $pdo->prepare("SELECT * FROM sst_items WHERE id=? AND activo=1");
    $q->execute([$id]);
    $it = $q->fetch(PDO::FETCH_ASSOC);
    if (!$it) responder(['error'=>'Artículo no encontrado'], 404);
    $nombre = trim($d['nombre'] ?? '');
    if ($nombre === '') responder(['error'=>'El nombre es obligatorio'], 400);
    $cant = max(1, (int)($d['cantidad'] ?? $it['cantidad']));
    if ($cant < sstEnEntrega($pdo, $id)) responder(['error'=>'La cantidad no puede ser menor a lo que está entregado ('.sstEnEntrega($pdo,$id).')'], 400);
    $serial = trim($d['serial'] ?? '');
    if ($serial !== '') {
        $c = $pdo->prepare("SELECT nombre FROM sst_items WHERE serial=? AND activo=1 AND id<>? LIMIT 1");
        $c->execute([$serial, $id]);
        if ($dup = $c->fetchColumn()) responder(['error'=>"Ya existe \"$dup\" con ese serial"], 409);
        if ($cant > 1) responder(['error'=>'Un artículo con serial es una sola unidad (cantidad 1)'], 400);
    }
    $per = (int)($d['periodicidad_dias'] ?? 0);
    $catN = sstCategoria($pdo,$d['categoria']??$it['categoria']);
    $datosJson = sstLimpiarDatos($pdo, $catN, $d['datos'] ?? []);
    $fabE = sstFecha($d['fecha_fabricacion'] ?? ''); $inspE = sstFecha($d['fecha_inspeccion'] ?? '');
    $pdo->prepare("UPDATE sst_items SET nombre=?,categoria=?,marca=?,serial=?,descripcion=?,cantidad=?,fecha_fabricacion=?,fecha_inspeccion=?,periodicidad_dias=?,prox_inspeccion=?,datos=? WHERE id=?")
        ->execute([$nombre,$catN,trim($d['marca']??'')?:null,$serial?:null,trim($d['descripcion']??'')?:null,$cant,
                   $fabE,$inspE,$per>0?$per:null,sstProx($inspE,null,$per),$datosJson,$id]);
    try { auditar($pdo,'editar','sst',"SST editado: $nombre ({$it['codigo']})",$it['codigo']); } catch (\Throwable $e) {}
    responder(['ok'=>true]);
}

/* ══ CAMBIAR ESTADO: mantenimiento / baja / disponible ══ */
if ($method === 'POST' && $action === 'estado') {
    sstGestiona();
    $d = sstBody();
    $id = (int)($d['id'] ?? 0);
    $nuevo = $d['estado'] ?? '';
    if (!in_array($nuevo, ['disponible','mantenimiento','baja'], true)) responder(['error'=>'Estado no válido'], 400);
    $q = $pdo->prepare("SELECT * FROM sst_items WHERE id=? AND activo=1");
    $q->execute([$id]);
    $it = $q->fetch(PDO::FETCH_ASSOC);
    if (!$it) responder(['error'=>'Artículo no encontrado'], 404);
    $motivo = trim($d['motivo'] ?? '');
    if (in_array($nuevo, ['mantenimiento','baja'], true)) {
        $enUso = sstEnEntrega($pdo, $id);
        if ($enUso > 0) responder(['error'=>"Hay $enUso unidad(es) entregadas a personas. Primero deben devolverse."], 409);
        if ($motivo === '') responder(['error'=>'Escribe el motivo'], 400);
    }
    $pdo->prepare("UPDATE sst_items SET estado=?, motivo_baja=? WHERE id=?")
        ->execute([$nuevo, $nuevo==='disponible' ? null : $motivo, $id]);
    try { auditar($pdo,'estado','sst',"SST {$it['codigo']} → $nuevo".($motivo?": $motivo":''),$it['codigo']); } catch (\Throwable $e) {}
    responder(['ok'=>true]);
}

/* ══ ELIMINAR (creados por error): solo si nunca se entregaron ══ */
if ($method === 'POST' && $action === 'eliminar') {
    sstGestiona();
    $d = sstBody();
    $ids = array_values(array_filter(array_map('intval', (array)($d['ids'] ?? [$d['id'] ?? 0]))));
    if (!$ids) responder(['error'=>'Elige qué eliminar'], 400);
    $ok = 0; $no = [];
    $selI = $pdo->prepare("SELECT * FROM sst_items WHERE id=? AND activo=1");
    $selE = $pdo->prepare("SELECT COUNT(*) FROM sst_entregas WHERE item_id=?");
    foreach ($ids as $id) {
        $selI->execute([$id]); $it = $selI->fetch(PDO::FETCH_ASSOC);
        if (!$it) continue;
        $selE->execute([$id]);
        if ((int)$selE->fetchColumn() > 0) { $no[] = ($it['serial'] ?: $it['codigo']); continue; }
        $pdo->prepare("UPDATE sst_items SET activo=0 WHERE id=?")->execute([$id]);
        try { auditar($pdo,'eliminar','sst',"SST eliminado: {$it['nombre']} ({$it['codigo']}".($it['serial']?" · S/N {$it['serial']}":'').")",$it['codigo']); } catch (\Throwable $e) {}
        $ok++;
    }
    if (!$ok && $no) responder(['error'=>'No se puede eliminar porque ya tuvo entregas ('.implode(', ', $no).'). Dalo de baja en su lugar.'], 409);
    responder(['ok'=>true,'eliminados'=>$ok,'aviso'=>$no ? 'No se eliminaron (ya tuvieron entregas, usa Baja): '.implode(', ', $no) : '']);
}

/* ══ ENTREGAR a una persona ══ */
if ($method === 'POST' && $action === 'entregar') {
    sstGestiona();
    $d = sstBody();
    $id = (int)($d['item_id'] ?? 0);
    $usr = trim($d['usuario'] ?? '');
    $cant = max(1, (int)($d['cantidad'] ?? 1));
    if ($usr === '' || !sstUsuarioValido($pdo, $usr)) responder(['error'=>'Elige la persona que recibe'], 400);
    $rolRec = $pdo->prepare("SELECT rol FROM usuarios WHERE usuario=?"); $rolRec->execute([$usr]);
    if (in_array($rolRec->fetchColumn(), ['superadmin','distribuidor'], true)) responder(['error'=>'No se entregan artículos SST a administradores ni al distribuidor'], 400);
    try {
        $pdo->beginTransaction();
        $q = $pdo->prepare("SELECT * FROM sst_items WHERE id=? AND activo=1 FOR UPDATE");
        $q->execute([$id]);
        $it = $q->fetch(PDO::FETCH_ASSOC);
        if (!$it) { $pdo->rollBack(); responder(['error'=>'Artículo no encontrado'], 404); }
        if ($it['estado'] !== 'disponible') { $pdo->rollBack(); responder(['error'=>'Este artículo está en '.$it['estado'].' y no se puede entregar'], 409); }
        if ($it['prox_inspeccion'] && $it['prox_inspeccion'] < date('Y-m-d')) { $pdo->rollBack(); responder(['error'=>'Este artículo tiene la inspección vencida: inspecciónalo antes de entregarlo'], 409); }
        $libre = (int)$it['cantidad'] - sstEnEntrega($pdo, $id);
        if ($cant > $libre) { $pdo->rollBack(); responder(['error'=>"Solo hay $libre disponible(s)"], 409); }
        $pdo->prepare("INSERT INTO sst_entregas (item_id,usuario,cantidad,estado,entregado_por,nota) VALUES (?,?,?,'pendiente',?,?)")
            ->execute([$id,$usr,$cant,$_SESSION['usuario']??'',trim($d['nota']??'')?:null]);
        $pdo->commit();
        try { auditar($pdo,'entregar','sst',"SST {$it['codigo']} x$cant entregado a $usr",$it['codigo']); } catch (\Throwable $e) {}
        responder(['ok'=>true]);
    } catch (\Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        error_log('[sst/entregar] '.$e->getMessage());
        responder(['error'=>'No se pudo registrar la entrega'], 500);
    }
}

/* ══ DEVOLVER (el HS recibe de vuelta) ══ */
if ($method === 'POST' && $action === 'devolver') {
    sstGestiona();
    $d = sstBody();
    $id = (int)($d['entrega_id'] ?? 0);
    $est = $d['estado_devolucion'] ?? 'bueno';
    if (!in_array($est, ['bueno','danado','perdido'], true)) responder(['error'=>'Indica en qué estado vuelve'], 400);
    $q = $pdo->prepare("SELECT e.*, i.codigo, i.nombre FROM sst_entregas e JOIN sst_items i ON i.id=e.item_id WHERE e.id=?");
    $q->execute([$id]);
    $e = $q->fetch(PDO::FETCH_ASSOC);
    if (!$e || !in_array($e['estado'], ['pendiente','activa'], true)) responder(['error'=>'Esa entrega ya no está abierta'], 409);
    $pdo->prepare("UPDATE sst_entregas SET estado='devuelta', devuelta_en=NOW(), estado_devolucion=?, nota=CONCAT(COALESCE(nota,''), ?) WHERE id=?")
        ->execute([$est, trim($d['nota']??'') !== '' ? ' | Devolución: '.trim($d['nota']) : '', $id]);
    // Dañado → mantenimiento; perdido → baja de esa cantidad (si era todo el artículo, baja total)
    if ($est === 'danado') {
        $q2 = $pdo->prepare("SELECT * FROM sst_items WHERE id=?");
        $q2->execute([$e['item_id']]);
        $it = $q2->fetch(PDO::FETCH_ASSOC);
        if ($it && (int)$it['cantidad'] === (int)$e['cantidad']) {
            $pdo->prepare("UPDATE sst_items SET estado='mantenimiento', motivo_baja='Devuelto dañado' WHERE id=?")->execute([$e['item_id']]);
        } elseif ($it) {
            // Devolvió dañadas solo unas unidades: se separan en su propio registro en mantenimiento
            $pdo->prepare("UPDATE sst_items SET cantidad=cantidad-? WHERE id=?")->execute([$e['cantidad'], $e['item_id']]);
            $cod = sstCodigo($pdo, $it['categoria']);
            $pdo->prepare("INSERT INTO sst_items (codigo,nombre,categoria,marca,descripcion,cantidad,estado,fecha_fabricacion,fecha_inspeccion,periodicidad_dias,prox_inspeccion,motivo_baja,creado_por,datos)
                           VALUES (?,?,?,?,?,?, 'mantenimiento', ?,?,?,?, 'Devuelto dañado', ?, ?)")
                ->execute([$cod,$it['nombre'],$it['categoria'],$it['marca'],$it['descripcion'],$e['cantidad'],$it['fecha_fabricacion'],$it['fecha_inspeccion'],$it['periodicidad_dias'],$it['prox_inspeccion'],$_SESSION['usuario']??'',$it['datos']]);
        }
    } elseif ($est === 'perdido') {
        $pdo->prepare("UPDATE sst_items SET cantidad=GREATEST(cantidad-?,0) WHERE id=?")->execute([$e['cantidad'], $e['item_id']]);
        $pdo->prepare("UPDATE sst_items SET estado='baja', motivo_baja='Perdido' WHERE id=? AND cantidad=0")->execute([$e['item_id']]);
    }
    try { auditar($pdo,'devolver','sst',"SST {$e['codigo']} devuelto por {$e['usuario']} ($est)",$e['codigo']); } catch (\Throwable $ex) {}
    responder(['ok'=>true]);
}

/* ══ ENTREGAS (listado) ══ */
if ($method === 'GET' && $action === 'entregas') {
    sstGestiona();
    $f = $_GET['estado'] ?? 'abiertas';
    $where = $f === 'todas' ? '1=1' : ($f === 'devueltas' ? "e.estado='devuelta'" : "e.estado IN ('pendiente','activa')");
    $rows = $pdo->query("
        SELECT e.*, i.codigo, i.nombre AS item_nombre, i.categoria, i.serial, i.prox_inspeccion,
               TRIM(CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,''))) AS receptor_nombre
        FROM sst_entregas e
        JOIN sst_items i ON i.id=e.item_id
        LEFT JOIN usuarios u ON u.usuario=e.usuario
        WHERE $where ORDER BY e.fecha_entrega DESC, e.id DESC LIMIT 500
    ")->fetchAll(PDO::FETCH_ASSOC);
    responder($rows);
}

/* ══ INSPECCIONAR ══ */
if ($method === 'POST' && $action === 'inspeccionar') {
    sstGestiona();
    $d = sstBody();
    $id = (int)($d['item_id'] ?? 0);
    $res = $d['resultado'] ?? 'aprobado';
    if (!in_array($res, ['aprobado','observacion','rechazado'], true)) responder(['error'=>'Resultado no válido'], 400);
    $q = $pdo->prepare("SELECT * FROM sst_items WHERE id=? AND activo=1");
    $q->execute([$id]);
    $it = $q->fetch(PDO::FETCH_ASSOC);
    if (!$it) responder(['error'=>'Artículo no encontrado'], 404);
    $fecha = sstFecha($d['fecha'] ?? '') ?: date('Y-m-d');
    $notas = trim($d['notas'] ?? '');
    if ($res !== 'aprobado' && $notas === '') responder(['error'=>'Describe qué se encontró'], 400);
    $pdo->prepare("INSERT INTO sst_inspecciones (item_id,fecha,inspector,resultado,notas) VALUES (?,?,?,?,?)")
        ->execute([$id,$fecha,$_SESSION['usuario']??'',$res,$notas?:null]);
    $prox = null;
    if (!$prox && (int)$it['periodicidad_dias'] > 0) $prox = date('Y-m-d', strtotime($fecha.' +'.(int)$it['periodicidad_dias'].' days'));
    $pdo->prepare("UPDATE sst_items SET prox_inspeccion=?, fecha_inspeccion=? WHERE id=?")->execute([$prox, $fecha, $id]);
    $aviso = '';
    if ($res === 'rechazado' && $it['estado'] === 'disponible' && sstEnEntrega($pdo, $id) === 0) {
        $pdo->prepare("UPDATE sst_items SET estado='mantenimiento', motivo_baja=? WHERE id=?")->execute(['Inspección rechazada: '.$notas, $id]);
        $aviso = 'El artículo pasó a mantenimiento.';
    } elseif ($res === 'rechazado' && sstEnEntrega($pdo, $id) > 0) {
        $aviso = 'Hay unidades entregadas: pide la devolución para sacarlo de uso.';
    }
    try { auditar($pdo,'inspeccionar','sst',"SST {$it['codigo']} inspección: $res",$it['codigo']); } catch (\Throwable $e) {}
    responder(['ok'=>true,'aviso'=>$aviso]);
}

if ($method === 'GET' && $action === 'inspecciones') {
    sstGestiona();
    $id = (int)($_GET['item_id'] ?? 0);
    $q = $pdo->prepare("SELECT n.*, TRIM(CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,''))) AS inspector_nombre
                        FROM sst_inspecciones n LEFT JOIN usuarios u ON u.usuario=n.inspector
                        WHERE n.item_id=? ORDER BY n.fecha DESC, n.id DESC LIMIT 100");
    $q->execute([$id]);
    $ent = $pdo->prepare("SELECT e.*, TRIM(CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,''))) AS receptor_nombre
                          FROM sst_entregas e LEFT JOIN usuarios u ON u.usuario=e.usuario
                          WHERE e.item_id=? ORDER BY e.id DESC LIMIT 100");
    $ent->execute([$id]);
    responder(['inspecciones'=>$q->fetchAll(PDO::FETCH_ASSOC), 'entregas'=>$ent->fetchAll(PDO::FETCH_ASSOC)]);
}

/* ══ MIS SST (cualquier usuario: lo que tiene a su nombre) ══ */
if ($method === 'GET' && $action === 'mis_sst') {
    $q = $pdo->prepare("
        SELECT e.id, e.cantidad, e.estado, e.fecha_entrega, e.confirmado_en, e.nota,
               i.codigo, i.nombre, i.categoria, i.marca, i.serial, i.fecha_fabricacion, i.prox_inspeccion,
               c.icono AS cat_icono, c.nombre AS cat_nombre, c.campos AS cat_campos, i.datos,
               TRIM(CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,''))) AS entregado_por_nombre
        FROM sst_entregas e
        JOIN sst_items i ON i.id=e.item_id
        LEFT JOIN sst_categorias c ON c.clave=i.categoria
        LEFT JOIN usuarios u ON u.usuario=e.entregado_por
        WHERE e.usuario=? AND e.estado IN ('pendiente','activa')
        ORDER BY e.fecha_entrega DESC");
    $q->execute([$_SESSION['usuario'] ?? '']);
    responder($q->fetchAll(PDO::FETCH_ASSOC));
}

if ($method === 'POST' && $action === 'confirmar_recibido') {
    $d = sstBody();
    $id = (int)($d['entrega_id'] ?? 0);
    $q = $pdo->prepare("SELECT e.*, i.codigo FROM sst_entregas e JOIN sst_items i ON i.id=e.item_id WHERE e.id=? AND e.usuario=?");
    $q->execute([$id, $_SESSION['usuario'] ?? '']);
    $e = $q->fetch(PDO::FETCH_ASSOC);
    if (!$e) responder(['error'=>'Entrega no encontrada'], 404);
    if ($e['estado'] !== 'pendiente') responder(['error'=>'Ya estaba confirmada'], 409);
    $pdo->prepare("UPDATE sst_entregas SET estado='activa', confirmado_en=NOW() WHERE id=?")->execute([$id]);
    try { auditar($pdo,'confirmar','sst',"SST {$e['codigo']} recibido por ".($_SESSION['usuario']??''),$e['codigo']); } catch (\Throwable $ex) {}
    responder(['ok'=>true]);
}

/* ══ Personas a quienes se puede entregar ══ */
if ($method === 'GET' && $action === 'personas') {
    sstGestiona();
    responder($pdo->query("SELECT usuario, TRIM(CONCAT(COALESCE(nombre,''),' ',COALESCE(apellido,''))) AS nombre, rol
                           FROM usuarios WHERE estado='activo' AND rol NOT IN ('superadmin','distribuidor') ORDER BY nombre")->fetchAll(PDO::FETCH_ASSOC));
}

responder(['error'=>'Acción no válida'], 400);