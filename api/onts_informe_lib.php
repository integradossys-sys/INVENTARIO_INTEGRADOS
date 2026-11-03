<?php
/* ══════════════════════════════════════════════════════
   onts_informe_lib.php — Integrados S&S
   Datos del "Informe de ONT por oficina". Lo usan informes.php
   (pantalla) y onts_informe_pdf.php (PDF) para que ambos den
   exactamente los mismos números.

   Filtros ($f): fecha_tipo (despacho|ingreso|instalacion), desde, hasta,
                 modelo, estado, oficina
══════════════════════════════════════════════════════ */
function ontsInformeDatos(PDO $pdo, array $f, int $limiteDetalle = 5000): array {
    $vacio = ['total'=>0,'por_estado'=>[],'por_oficina'=>[],'por_modelo'=>[],'filas'=>[],
              'truncado'=>false,'opciones'=>['modelos'=>[],'estados'=>[],'oficinas'=>[]]];
    try {
        $cols = $pdo->query("SHOW COLUMNS FROM ont_seriales")->fetchAll(PDO::FETCH_COLUMN);
    } catch (\Throwable $e) { return $vacio; }
    $has = fn($c) => in_array($c, $cols, true);
    $ref = function(array $cands, string $alias) use ($has) {   // primera columna existente, con COALESCE
        $ok = array_values(array_filter($cands, $has));
        return $ok ? 'COALESCE(' . implode(',', array_map(fn($c)=>"o.`$c`", $ok)) . ')' : 'NULL';
    };

    $oficinaExpr = $ref(['sede_actual','enviado_a'], 'of');
    $oficinaExpr = "COALESCE(NULLIF(TRIM($oficinaExpr),''), '(Sin oficina / almacén)')";
    $fDespacho   = $ref(['fecha_salida','fecha_envio'], 'fd');
    $fIngreso    = $ref(['fecha_ingreso','fecha_registro'], 'fi');
    $fInstal     = $ref(['fecha_instalacion'], 'fn');
    $macExpr     = $ref(['mac_fmt','mac'], 'mac');
    $snExpr      = $ref(['sn','serial'], 'sn');
    $cliExpr     = $ref(['cliente_nombre','cliente'], 'cli');
    $tecExpr     = $has('tecnico_asignado') ? 'o.tecnico_asignado' : 'NULL';
    $modExpr     = $has('modelo') ? "COALESCE(NULLIF(TRIM(o.modelo),''),'(Sin modelo)')" : "'(Sin modelo)'";
    $estExpr     = "LOWER(TRIM(COALESCE(o.estado,'')))";

    $tipo = $f['fecha_tipo'] ?? 'despacho';
    $campoFecha = $tipo === 'ingreso' ? $fIngreso : ($tipo === 'instalacion' ? $fInstal : $fDespacho);

    $where = ['1=1']; $p = [];
    if (!empty($f['desde'])) { $where[] = "DATE($campoFecha) >= ?"; $p[] = $f['desde']; }
    if (!empty($f['hasta'])) { $where[] = "DATE($campoFecha) <= ?"; $p[] = $f['hasta']; }
    if (!empty($f['modelo']))  { $where[] = "$modExpr = ?";   $p[] = $f['modelo']; }
    if (!empty($f['estado']))  { $where[] = "$estExpr = ?";   $p[] = mb_strtolower(trim($f["estado"]), "UTF-8"); }
    if (!empty($f['oficina'])) { $where[] = "$oficinaExpr = ?"; $p[] = $f['oficina']; }
    $W = implode(' AND ', $where);

    $out = $vacio;
    try {
        // Resumen por oficina × estado
        $st = $pdo->prepare("SELECT $oficinaExpr AS oficina, $estExpr AS estado, COUNT(*) AS n
                             FROM ont_seriales o WHERE $W GROUP BY oficina, estado");
        $st->execute($p);
        $ofi = []; $est = [];
        foreach ($st->fetchAll() as $r) {
            $e = $r['estado'] === '' ? 'sin_estado' : $r['estado'];
            $n = (int)$r['n'];
            if (!isset($ofi[$r['oficina']])) $ofi[$r['oficina']] = ['oficina'=>$r['oficina'],'total'=>0,'estados'=>[]];
            $ofi[$r['oficina']]['total'] += $n;
            $ofi[$r['oficina']]['estados'][$e] = ($ofi[$r['oficina']]['estados'][$e] ?? 0) + $n;
            $est[$e] = ($est[$e] ?? 0) + $n;
            $out['total'] += $n;
        }
        uasort($ofi, fn($a,$b)=>$b['total'] <=> $a['total']);
        arsort($est);
        $out['por_oficina'] = array_values($ofi);
        $out['por_estado']  = $est;

        // Por modelo × estado
        $st = $pdo->prepare("SELECT $modExpr AS modelo, $estExpr AS estado, COUNT(*) AS n
                             FROM ont_seriales o WHERE $W GROUP BY modelo, estado");
        $st->execute($p);
        $mod = [];
        foreach ($st->fetchAll() as $r) {
            $e = $r['estado'] === '' ? 'sin_estado' : $r['estado'];
            if (!isset($mod[$r['modelo']])) $mod[$r['modelo']] = ['modelo'=>$r['modelo'],'total'=>0,'estados'=>[]];
            $mod[$r['modelo']]['total'] += (int)$r['n'];
            $mod[$r['modelo']]['estados'][$e] = ($mod[$r['modelo']]['estados'][$e] ?? 0) + (int)$r['n'];
        }
        uasort($mod, fn($a,$b)=>$b['total'] <=> $a['total']);
        $out['por_modelo'] = array_values($mod);

        // Detalle (con tope para no colgar el navegador)
        $lim = max(1, $limiteDetalle);
        $st = $pdo->prepare("SELECT o.id, $macExpr AS mac, $snExpr AS sn, $modExpr AS modelo, $estExpr AS estado,
                                    $oficinaExpr AS oficina, $tecExpr AS tecnico, $cliExpr AS cliente,
                                    $fDespacho AS f_despacho, $fIngreso AS f_ingreso, $fInstal AS f_instalacion
                             FROM ont_seriales o WHERE $W
                             ORDER BY oficina ASC, modelo ASC, o.id ASC LIMIT " . ($lim + 1));
        $st->execute($p);
        $filas = $st->fetchAll();
        if (count($filas) > $lim) { $out['truncado'] = true; $filas = array_slice($filas, 0, $lim); }
        $out['filas'] = $filas;

        // Opciones de los filtros (sobre toda la tabla, no sobre el filtro actual)
        $out['opciones']['modelos']  = $pdo->query("SELECT DISTINCT $modExpr AS v FROM ont_seriales o ORDER BY v")->fetchAll(PDO::FETCH_COLUMN);
        $out['opciones']['estados']  = array_values(array_filter($pdo->query("SELECT DISTINCT $estExpr AS v FROM ont_seriales o ORDER BY v")->fetchAll(PDO::FETCH_COLUMN), fn($x)=>$x!==''));
        $out['opciones']['oficinas'] = $pdo->query("SELECT DISTINCT $oficinaExpr AS v FROM ont_seriales o ORDER BY v")->fetchAll(PDO::FETCH_COLUMN);
    } catch (\Throwable $e) {
        error_log('[onts_informe] ' . $e->getMessage());
    }
    return $out;
}

function ontsInformeFiltrosDeGet(array $g): array {
    $fecha = fn($v) => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$v) ? $v : '';
    $tipo = in_array($g['fecha_tipo'] ?? '', ['despacho','ingreso','instalacion'], true) ? $g['fecha_tipo'] : 'despacho';
    return [
        'fecha_tipo' => $tipo,
        'desde'   => $fecha($g['desde'] ?? ''),
        'hasta'   => $fecha($g['hasta'] ?? ''),
        'modelo'  => trim((string)($g['modelo']  ?? '')),
        'estado'  => trim((string)($g['estado']  ?? '')),
        'oficina' => trim((string)($g['oficina'] ?? '')),
    ];
}

// Texto corto con los filtros usados, para el Registro de actividad
function _ontInformeResumenFiltros(array $f, int $total): string {
    $t = "Informe ONT por oficina — $total ONT";
    if ($f['desde'] || $f['hasta']) $t .= " ({$f['fecha_tipo']}: " . ($f['desde'] ?: '…') . ' a ' . ($f['hasta'] ?: '…') . ')';
    if ($f['modelo'])  $t .= " · modelo {$f['modelo']}";
    if ($f['estado'])  $t .= " · estado {$f['estado']}";
    if ($f['oficina']) $t .= " · oficina {$f['oficina']}";
    return $t;
}