<?php
/* gastos_informe_lib.php — Integrados S&S
   Datos del "Informe de gastos" (Informes → 📉 Gastos). Lo usan informes.php
   (pantalla) y gastos_informe_pdf.php (PDF) para dar los mismos números.
   Filtros ($f): desde, hasta, producto (texto: nombre o ref), usuario (texto),
                 sede, cliente (texto: cliente o proyecto)
   Un "gasto" = fila del historial con es_gasto=1 que no sea venta ni esté anulada. */
function gastosInformeFiltrosDeGet(array $g): array {
    $t = fn($k) => trim((string)($g[$k] ?? ''));
    return ['desde'=>$t('desde'), 'hasta'=>$t('hasta'), 'producto'=>$t('producto'),
            'usuario'=>$t('usuario'), 'sede'=>$t('sede'), 'cliente'=>$t('cliente')];
}
function gastosInformeResumenFiltros(array $f, int $total): string {
    $p = [];
    if ($f['desde'] || $f['hasta']) $p[] = 'rango ' . ($f['desde'] ?: '…') . ' a ' . ($f['hasta'] ?: '…');
    if ($f['producto']) $p[] = 'producto ' . $f['producto'];
    if ($f['usuario'])  $p[] = 'persona ' . $f['usuario'];
    if ($f['sede'])     $p[] = 'sede ' . $f['sede'];
    if ($f['cliente'])  $p[] = 'cliente ' . $f['cliente'];
    return "Informe de gastos — $total gasto(s)" . ($p ? ' — ' . implode(' · ', $p) : '');
}
function gastosInformeDatos(PDO $pdo, array $f, int $limite = 5000): array {
    $vacio = ['total'=>0,'por_producto'=>[],'por_persona'=>[],'filas'=>[],'truncado'=>false,'opciones'=>['sedes'=>[],'productos'=>[],'personas'=>[],'clientes'=>[]]];
    try { $cols = $pdo->query("SHOW COLUMNS FROM historial")->fetchAll(PDO::FETCH_COLUMN); }
    catch (\Throwable $e) { return $vacio; }
    $has = fn($c) => in_array($c, $cols, true);
    $persona = $has('usuario_destino') ? "COALESCE(NULLIF(TRIM(h.usuario_destino),''), h.enviado_por)" : "h.enviado_por";
    $cliente = $has('proyecto_cliente') ? "COALESCE(NULLIF(TRIM(h.proyecto_cliente),''), h.destino)" : "h.destino";
    $where = ["h.es_gasto = 1"];
    if ($has('es_venta')) $where[] = "(h.es_venta IS NULL OR h.es_venta = 0)";
    if ($has('anulado'))  $where[] = "(h.anulado IS NULL OR h.anulado = 0)";
    $whereBase = $where; // sin ningún filtro: de aquí salen las listas desplegables
    $p = [];
    if ($f['desde']) { $where[] = "DATE(h.fecha) >= ?"; $p[] = $f['desde']; }
    if ($f['hasta']) { $where[] = "DATE(h.fecha) <= ?"; $p[] = $f['hasta']; }
    if ($f['producto']) { $where[] = "(h.ref = ? OR h.nombre = ?)"; $p[] = $f['producto']; $p[] = $f['producto']; }
    if ($f['usuario']) { $where[] = "$persona = ?"; $p[] = $f['usuario']; }
    if ($f['sede']) { $where[] = "COALESCE(u.sede,'') = ?"; $p[] = $f['sede']; }
    if ($f['cliente']) { $where[] = "$cliente = ?"; $p[] = $f['cliente']; }
    $gps = ($has('gps_lat') && $has('gps_lng')) ? "h.gps_lat, h.gps_lng" : "NULL AS gps_lat, NULL AS gps_lng";
    $sql = "SELECT h.id, h.fecha, h.ref, h.nombre, h.cantidad, h.unidad_envio, h.descripcion,
                   $persona AS persona, COALESCE(u.sede,'') AS sede,
                   TRIM(CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,''))) AS persona_nombre,
                   $cliente AS cliente, $gps
            FROM historial h
            LEFT JOIN usuarios u ON u.usuario = $persona
            WHERE " . implode(' AND ', $where) . "
            ORDER BY h.fecha DESC";
    $st = $pdo->prepare($sql); $st->execute($p);
    $todas = $st->fetchAll();
    $unid = function($r){ $u = strtolower((string)($r['unidad_envio'] ?? 'unidad')); return $u === 'metros' ? 'm' : ($u === 'rollo' ? 'rollos' : 'uds'); };
    $prod = []; $pers = [];
    foreach ($todas as $r) {
        $cant = (float)$r['cantidad']; $un = $unid($r);
        $k = $r['ref'] . '|' . $un;
        if (!isset($prod[$k])) $prod[$k] = ['ref'=>$r['ref'],'nombre'=>$r['nombre'],'unidad'=>$un,'total'=>0,'veces'=>0];
        $prod[$k]['total'] += $cant; $prod[$k]['veces']++;
        $pk = $r['persona'] ?: '(sin dato)';
        if (!isset($pers[$pk])) $pers[$pk] = ['usuario'=>$pk,'nombre'=>$r['persona_nombre'] ?: $pk,'sede'=>$r['sede'],'num_gastos'=>0,'prods'=>[]];
        $pers[$pk]['num_gastos']++;
        $pj = $r['nombre'] . '|' . $un;
        $pers[$pk]['prods'][$pj] = ($pers[$pk]['prods'][$pj] ?? 0) + $cant;
    }
    $fmt = fn($n) => (floor($n) == $n) ? (string)(int)$n : rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.');
    $porProd = array_values($prod);
    usort($porProd, fn($a,$b) => $b['veces'] <=> $a['veces'] ?: strcmp($a['nombre'], $b['nombre']));
    foreach ($porProd as &$x) { $x['total'] = (float)$x['total']; } unset($x);
    $porPers = array_values($pers);
    foreach ($porPers as &$x) {
        $partes = [];
        foreach ($x['prods'] as $k => $v) { [$n, $u] = explode('|', $k); $partes[] = "$n: " . $fmt($v) . " $u"; }
        $x['detalle'] = implode(' · ', $partes); unset($x['prods']);
    } unset($x);
    usort($porPers, fn($a,$b) => $b['num_gastos'] <=> $a['num_gastos']);
    $filas = array_map(function($r) use ($unid) {
        return ['id'=>$r['id'],'fecha'=>$r['fecha'],'ref'=>$r['ref'],'nombre'=>$r['nombre'],
                'cantidad'=>(float)$r['cantidad'],'unidad'=>$unid($r),'persona'=>$r['persona'],
                'persona_nombre'=>$r['persona_nombre'] ?: $r['persona'],'sede'=>$r['sede'],'cliente'=>$r['cliente'],
                'descripcion'=>$r['descripcion'],'gps_lat'=>$r['gps_lat'],'gps_lng'=>$r['gps_lng']];
    }, array_slice($todas, 0, $limite));
    $sedes = [];
    try { $sedes = $pdo->query("SELECT DISTINCT sede FROM usuarios WHERE sede IS NOT NULL AND sede <> '' ORDER BY sede")->fetchAll(PDO::FETCH_COLUMN); } catch (\Throwable $e) {}
    $productos = []; $personas = []; $clientes = [];
    try {
        $wb = implode(' AND ', $whereBase);
        foreach ($pdo->query("SELECT h.ref, MAX(h.nombre) AS nombre FROM historial h WHERE $wb GROUP BY h.ref ORDER BY nombre")->fetchAll() as $r) {
            $v = (string)($r['ref'] ?: $r['nombre']); if ($v === '') continue;
            $productos[] = ['valor'=>$v, 'texto'=>trim(($r['nombre'] ?: $v) . ($r['ref'] ? ' (' . $r['ref'] . ')' : ''))];
        }
        foreach ($pdo->query("SELECT $persona AS persona, MAX(TRIM(CONCAT(COALESCE(u.nombre,''),' ',COALESCE(u.apellido,'')))) AS nom
                              FROM historial h LEFT JOIN usuarios u ON u.usuario = $persona WHERE $wb AND $persona IS NOT NULL AND $persona <> ''
                              GROUP BY $persona ORDER BY nom, persona")->fetchAll() as $r) {
            $personas[] = ['valor'=>$r['persona'], 'texto'=>($r['nom'] ?: $r['persona']) . ($r['nom'] && $r['nom'] !== $r['persona'] ? ' (' . $r['persona'] . ')' : '')];
        }
        foreach ($pdo->query("SELECT DISTINCT $cliente AS c FROM historial h WHERE $wb AND $cliente IS NOT NULL AND TRIM($cliente) <> '' ORDER BY c")->fetchAll(PDO::FETCH_COLUMN) as $c) {
            $clientes[] = $c;
        }
    } catch (\Throwable $e) {}
    return ['total'=>count($todas),'por_producto'=>$porProd,'por_persona'=>$porPers,'filas'=>$filas,
            'truncado'=>count($todas) > $limite,'opciones'=>['sedes'=>$sedes,'productos'=>$productos,'personas'=>$personas,'clientes'=>$clientes]];
}