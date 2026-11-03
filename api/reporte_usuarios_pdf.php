<?php
/* ══════════════════════════════════════════════════════
   reporte_usuarios_pdf.php — Integrados S&S
   Reporte de usuarios agrupados por sede, con el inventario
   que corresponde a cada sede (lo que "deben tener").
══════════════════════════════════════════════════════ */
error_reporting(0);
ini_set('display_errors', 0);
require_once 'config.php';

// Verificar sesión y rol manualmente (no usar responder() porque devuelve JSON)
if (empty($_SESSION['usuario'])) {
    header('Location: ../index.html');
    exit;
}
if (!in_array($_SESSION['rol'] ?? '', ['superadmin', 'distribuidor'])) {
    http_response_code(403);
    echo '<h2 style="font-family:Arial;color:#B91C1C;padding:40px;">❌ Sin permisos para ver este reporte.</h2>';
    exit;
}

$fecha = date('d/m/Y H:i');

/* ── Colores / etiquetas por tipo de usuario ─────────────────── */
$tipoInfo = [
    'superadmin'  => ['label' => 'Superadmin',  'color' => '#0A1F5C', 'bg' => '#E2E8F0'],
    'distribuidor'=> ['label' => 'Distribuidor','color' => '#166534', 'bg' => '#DCFCE7'],
    'municipio'   => ['label' => 'Municipio',   'color' => '#0C6EDE', 'bg' => '#DBEAFE'],
    'tecnico'     => ['label' => 'Técnico',     'color' => '#6D28D9', 'bg' => '#EDE9FE'],
    'persona'     => ['label' => 'Persona',     'color' => '#0D9488', 'bg' => '#CCFBF1'],
];
$ordenRoles = ['distribuidor', 'municipio', 'tecnico', 'persona', 'superadmin'];

/* ── Sedes (excluyendo pseudo-sedes internas) ────────────────── */
$sedes = $pdo->query("
    SELECT id, nombre, tipo
    FROM sedes
    WHERE nombre NOT IN ('Sistema')
    ORDER BY (nombre IN ('Almacen Central','Almacén Central')) DESC, nombre ASC
")->fetchAll();

/* ── Usuarios con su sede principal ──────────────────────────── */
$usuarios = $pdo->query("
    SELECT u.id, u.usuario, u.nombre, u.apellido, u.rol, u.cargo, u.estado,
           u.correo, u.telefono, u.sede_id
    FROM usuarios u
    WHERE u.rol <> 'superadmin'
    ORDER BY u.nombre ASC, u.usuario ASC
")->fetchAll();

/* ── Sedes adicionales de técnicos multi-sede ────────────────── */
$extra = $pdo->query("
    SELECT ts.usuario_id, ts.sede_id
    FROM tecnico_sedes ts
")->fetchAll();
$extraPorUsuario = [];
foreach ($extra as $e) {
    $extraPorUsuario[$e['usuario_id']][] = $e['sede_id'];
}

/* ── Agrupar usuarios por sede (principal + adicionales) ─────── */
$usuariosPorSede = [];
foreach ($usuarios as $u) {
    $sedesDelUsuario = [];
    if ($u['sede_id']) $sedesDelUsuario[] = $u['sede_id'];
    foreach ($extraPorUsuario[$u['id']] ?? [] as $sid) $sedesDelUsuario[] = $sid;
    $sedesDelUsuario = array_unique($sedesDelUsuario);

    foreach ($sedesDelUsuario as $sid) {
        $usuariosPorSede[$sid][] = $u;
    }
}

/* ── Stock por sede (suma del stock personal de cada quien pertenece
       a esa sede — ya no hay un "pozo compartido" de sede) ─────── */
$stockRows = $pdo->query("
    SELECT u.sede_id, SUM(su.cantidad) as cantidad, p.ref, p.nombre, p.unidad,
           COALESCE(p.stock_minimo, 0) as minimo
    FROM stock_usuarios su
    JOIN usuarios u ON u.usuario = su.usuario
    JOIN productos p ON p.id = su.producto_id
    WHERE su.cantidad > 0
    GROUP BY u.sede_id, su.producto_id
    ORDER BY p.ref ASC
")->fetchAll();
$stockPorSede = [];
foreach ($stockRows as $s) {
    $stockPorSede[$s['sede_id']][] = $s;
}

// El Almacén Central no usa la tabla stock_sedes: su cantidad vive
// directamente en productos.stock_neiva. La calculamos aparte y la
// asignamos SOLO a la sede "Almacen Central" (Neiva es una sede
// municipal distinta y usa su propio stock, como cualquier otra).
$stockAlmacen = $pdo->query("
    SELECT ref, nombre, unidad, stock_neiva as cantidad, COALESCE(stock_minimo, 0) as minimo
    FROM productos
    ORDER BY ref ASC
")->fetchAll();
foreach ($sedes as $sede) {
    if (in_array($sede['nombre'], ['Almacen Central', 'Almacén Central'])) {
        $stockPorSede[$sede['id']] = $stockAlmacen;
    }
}

/* ── Stats generales ──────────────────────────────────────────── */
$totalUsuarios = count($usuarios);
$totalActivos  = count(array_filter($usuarios, fn($u) => $u['estado'] === 'activo'));
$totalPendientes = count(array_filter($usuarios, fn($u) => $u['estado'] === 'pendiente'));
$totalSedes    = count($sedes);

/* ── Logo en base64 ───────────────────────────────────────────── */
$logoPath = __DIR__ . '/../logo.png';
if (file_exists($logoPath)) {
    $logoB64 = 'data:image/png;base64,' . base64_encode(file_get_contents($logoPath));
} else {
    require_once __DIR__ . '/logo_base64.php';
    $logoB64 = $LOGO_INTEGRADOS_BASE64;
}

/* ── Construir secciones por sede ─────────────────────────────── */
// Sedes con usuarios primero (en el orden ya definido); sedes sin
// ningún usuario asignado se muestran al final del reporte.
$sedesConUsuarios = [];
$sedesSinUsuarios = [];
foreach ($sedes as $sede) {
    if (!empty($usuariosPorSede[$sede['id']])) {
        $sedesConUsuarios[] = $sede;
    } else {
        $sedesSinUsuarios[] = $sede;
    }
}
$sedesOrdenadas = array_merge($sedesConUsuarios, $sedesSinUsuarios);

$secciones = '';
$indiceSede = 0;
foreach ($sedesOrdenadas as $sede) {
    $usDeLaSede = $usuariosPorSede[$sede['id']] ?? [];
    // Ordenar usuarios de esta sede según el orden de roles definido
    usort($usDeLaSede, function($a, $b) use ($ordenRoles) {
        $pa = array_search($a['rol'], $ordenRoles); $pa = $pa === false ? 99 : $pa;
        $pb = array_search($b['rol'], $ordenRoles); $pb = $pb === false ? 99 : $pb;
        if ($pa !== $pb) return $pa <=> $pb;
        return strcmp($a['nombre'] ?? '', $b['nombre'] ?? '');
    });

    // Si la sede no tiene usuarios ni stock, se omite del reporte
    $stockDeLaSede = $stockPorSede[$sede['id']] ?? [];
    if (!$usDeLaSede && !$stockDeLaSede) continue;
    $indiceSede++;

    // Ordenar el inventario por urgencia: sin stock primero, luego bajo
    // mínimo, luego el resto — así lo más importante se ve de inmediato.
    $sinStockCount = 0; $bajoMinCount = 0;
    usort($stockDeLaSede, function($a, $b) {
        $sev = function($s) {
            $cant = (int)$s['cantidad']; $min = (int)$s['minimo'];
            if ($cant == 0) return 0;
            if ($min > 0 && $cant <= $min) return 1;
            return 2;
        };
        return $sev($a) <=> $sev($b);
    });
    foreach ($stockDeLaSede as $s) {
        $cant = (int)$s['cantidad']; $min = (int)$s['minimo'];
        if ($cant == 0) $sinStockCount++;
        elseif ($min > 0 && $cant <= $min) $bajoMinCount++;
    }

    // Filas de usuarios
    $filasUsuarios = '';
    if ($usDeLaSede) {
        $i = 0;
        foreach ($usDeLaSede as $u) {
            $info = $tipoInfo[$u['rol']] ?? ['label' => ucfirst($u['rol']), 'color' => '#334155', 'bg' => '#F1F5F9'];
            $nombreCompleto = trim(($u['nombre'] ?? '') . ' ' . ($u['apellido'] ?? ''));
            $estadoColor = $u['estado'] === 'activo' ? '#166534' : ($u['estado'] === 'pendiente' ? '#B45309' : '#B91C1C');
            $estadoLbl   = ucfirst($u['estado']);
            $zebra = (++$i % 2 === 0) ? 'background:#FAFBFC;' : '';
            $filasUsuarios .= "
            <tr style='{$zebra}'>
                <td style='padding:6px 10px;font-weight:600;color:#0F172A;border-bottom:1px solid #F1F5F9;'>{$u['usuario']}</td>
                <td style='padding:6px 10px;border-bottom:1px solid #F1F5F9;'>" . htmlspecialchars($nombreCompleto ?: '—') . "</td>
                <td style='padding:6px 10px;border-bottom:1px solid #F1F5F9;'><span style='background:{$info['bg']};color:{$info['color']};padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;text-transform:uppercase;'>{$info['label']}</span></td>
                <td style='padding:6px 10px;font-size:11px;color:#64748B;border-bottom:1px solid #F1F5F9;'>" . htmlspecialchars($u['correo'] ?: '—') . "</td>
                <td style='padding:6px 10px;font-size:11px;color:{$estadoColor};font-weight:600;border-bottom:1px solid #F1F5F9;'>{$estadoLbl}</td>
            </tr>";
        }
    } else {
        $filasUsuarios = "<tr><td colspan='5' style='padding:12px 10px;color:#94A3B8;font-style:italic;'>Sin usuarios asignados a esta sede.</td></tr>";
    }

    // Filas de stock (lo que debe tener esta sede)
    $filasStock = '';
    if ($stockDeLaSede) {
        $j = 0;
        foreach ($stockDeLaSede as $s) {
            $cant = (int)$s['cantidad'];
            $min  = (int)$s['minimo'];
            $rowBg = ''; $color = '#0F172A';
            if ($cant == 0) { $rowBg = 'background:#FEF2F2;'; $color = '#B91C1C'; }
            elseif ($min > 0 && $cant <= $min) { $rowBg = 'background:#FFFBEB;'; $color = '#B45309'; }
            elseif (++$j % 2 === 0) { $rowBg = 'background:#FAFBFC;'; }
            $filasStock .= "
            <tr style='{$rowBg}'>
                <td style='padding:6px 10px;font-family:monospace;font-size:11px;color:#64748B;border-bottom:1px solid #F1F5F9;'>" . htmlspecialchars($s['ref']) . "</td>
                <td style='padding:6px 10px;font-weight:600;border-bottom:1px solid #F1F5F9;'>" . htmlspecialchars($s['nombre']) . "</td>
                <td style='padding:6px 10px;text-align:center;border-bottom:1px solid #F1F5F9;'><span style='background:#F1F5F9;padding:2px 7px;border-radius:5px;font-size:11px;'>" . htmlspecialchars($s['unidad'] ?: 'unidad') . "</span></td>
                <td style='padding:6px 10px;text-align:center;font-weight:800;color:{$color};border-bottom:1px solid #F1F5F9;'>{$cant}</td>
                <td style='padding:6px 10px;text-align:center;color:#94A3B8;border-bottom:1px solid #F1F5F9;'>" . ($min > 0 ? $min : '—') . "</td>
            </tr>";
        }
    } else {
        $filasStock = "<tr><td colspan='5' style='padding:12px 10px;color:#94A3B8;font-style:italic;'>Sin inventario registrado para esta sede.</td></tr>";
    }

    $tipoSedeLbl = in_array($sede['nombre'], ['Almacen Central','Almacén Central']) ? 'Sede central' : 'Sede municipal';
    $iconoSede   = in_array($sede['nombre'], ['Almacen Central','Almacén Central']) ? '🏢' : '📍';

    $alertas = '';
    if ($sinStockCount > 0) $alertas .= "<span style='color:#B91C1C;font-weight:700;'>{$sinStockCount} sin stock</span>";
    if ($bajoMinCount > 0) {
        if ($alertas) $alertas .= " <span style='color:#CBD5E1;'>·</span> ";
        $alertas .= "<span style='color:#B45309;font-weight:700;'>{$bajoMinCount} bajo mínimo</span>";
    }
    $numSede = str_pad((string)$indiceSede, 2, '0', STR_PAD_LEFT);

    $secciones .= "
    <div style='margin-bottom:26px;page-break-inside:avoid;'>
        <div style='display:flex;align-items:center;gap:10px;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #0A1F5C;'>
            <span style='font-size:11px;font-weight:800;color:#CBD5E1;'>{$numSede}</span>
            <span style='font-size:16px;'>{$iconoSede}</span>
            <div style='font-size:15px;font-weight:800;color:#0A1F5C;'>" . htmlspecialchars($sede['nombre']) . "</div>
            <span style='font-size:10px;color:#94A3B8;text-transform:uppercase;letter-spacing:.5px;'>{$tipoSedeLbl} · " . count($usDeLaSede) . " usuario(s)</span>
            " . ($alertas ? "<span style='margin-left:auto;font-size:11px;'>{$alertas}</span>" : "") . "
        </div>

        <div style='font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;'>Usuarios</div>
        <table style='width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px;'>
            <thead><tr style='background:#F1F5F9;'>
                <th style='padding:6px 10px;text-align:left;font-size:10px;color:#475569;text-transform:uppercase;'>Usuario</th>
                <th style='padding:6px 10px;text-align:left;font-size:10px;color:#475569;text-transform:uppercase;'>Nombre</th>
                <th style='padding:6px 10px;text-align:left;font-size:10px;color:#475569;text-transform:uppercase;'>Tipo</th>
                <th style='padding:6px 10px;text-align:left;font-size:10px;color:#475569;text-transform:uppercase;'>Correo</th>
                <th style='padding:6px 10px;text-align:left;font-size:10px;color:#475569;text-transform:uppercase;'>Estado</th>
            </tr></thead>
            <tbody>{$filasUsuarios}</tbody>
        </table>

        <div style='font-size:11px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;'>Inventario que corresponde a esta sede</div>
        <table style='width:100%;border-collapse:collapse;font-size:12px;'>
            <thead><tr style='background:#0A1F5C;color:white;'>
                <th style='padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase;'>Ref.</th>
                <th style='padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase;'>Producto</th>
                <th style='padding:6px 10px;text-align:center;font-size:10px;text-transform:uppercase;'>Unidad</th>
                <th style='padding:6px 10px;text-align:center;font-size:10px;text-transform:uppercase;'>Cantidad</th>
                <th style='padding:6px 10px;text-align:center;font-size:10px;text-transform:uppercase;'>Mínimo</th>
            </tr></thead>
            <tbody>{$filasStock}</tbody>
        </table>
    </div>";
}

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Reporte de Usuarios por Sede — Integrados S&S</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1E293B; background: white; padding: 24px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid #0C6EDE; margin-bottom: 20px; }
  .logo-area { display: flex; align-items: center; gap: 12px; }
  .logo-area img { height: 48px; }
  .empresa { font-size: 20px; font-weight: 900; color: #0A1F5C; font-family: Arial, sans-serif; }
  .sub { font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
  .doc-info { text-align: right; }
  .doc-titulo { font-size: 13px; font-weight: 700; color: #0C6EDE; text-transform: uppercase; letter-spacing: 1px; }
  .doc-fecha { font-size: 11px; color: #64748B; margin-top: 4px; }
  .stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 24px; }
  .stat { background: #F8FAFC; border: 1.5px solid #E2E8F0; border-radius: 10px; padding: 10px 14px; text-align: center; }
  .stat-num { font-size: 22px; font-weight: 800; }
  .stat-lbl { font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: .5px; margin-top: 2px; }
  .leyenda { display: flex; gap: 16px; margin-top: 6px; margin-bottom: 20px; font-size: 11px; color: #64748B; }
  .leyenda span { display: flex; align-items: center; gap: 5px; }
  .dot { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #E2E8F0; display: flex; justify-content: space-between; font-size: 10px; color: #94A3B8; }
  @media print {
    body { padding: 12px; }
    .no-print { display: none; }
    @page { margin: 1cm; }
  }
</style>
</head>
<body>
<!-- Botón imprimir -->
<div class="no-print" style="margin-bottom:16px;display:flex;gap:10px;">
  <button onclick="window.print()" style="background:#0C6EDE;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">🖨 Imprimir / Guardar PDF</button>
  <button onclick="window.close()" style="background:#F1F5F9;color:#475569;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;">✕ Cerrar</button>
</div>

<!-- Header -->
<div class="header">
  <div class="logo-area">
    <?= $logoB64 ? "<img src='{$logoB64}' alt='Logo'>" : '' ?>
    <div>
      <div class="empresa">Integrados S&S</div>
      <div class="sub">Sistema de Inventario — Huila, Colombia</div>
    </div>
  </div>
  <div class="doc-info">
    <div class="doc-titulo">Reporte de Usuarios por Sede</div>
    <div class="doc-fecha">Generado el <?= $fecha ?></div>
  </div>
</div>

<!-- Stats -->
<div class="stats">
  <div class="stat">
    <div class="stat-num" style="color:#0C6EDE;"><?= $totalUsuarios ?></div>
    <div class="stat-lbl">Usuarios</div>
  </div>
  <div class="stat">
    <div class="stat-num" style="color:#166534;"><?= $totalActivos ?></div>
    <div class="stat-lbl">Activos</div>
  </div>
  <div class="stat">
    <div class="stat-num" style="color:#B45309;"><?= $totalPendientes ?></div>
    <div class="stat-lbl">Pendientes</div>
  </div>
  <div class="stat">
    <div class="stat-num" style="color:#0A1F5C;"><?= $totalSedes ?></div>
    <div class="stat-lbl">Sedes</div>
  </div>
</div>

<!-- Leyenda de stock -->
<div class="leyenda">
  <span><span class="dot" style="background:#FEF2F2;border:1px solid #FECACA;"></span> Sin stock</span>
  <span><span class="dot" style="background:#FFFBEB;border:1px solid #FDE68A;"></span> Bajo mínimo</span>
  <span><span class="dot" style="background:white;border:1px solid #E2E8F0;"></span> Normal</span>
</div>

<!-- Secciones por sede -->
<?= $secciones ?>

<!-- Footer -->
<div class="footer">
  <span>Integrados S&S — Sistema de Inventario</span>
  <span>Reporte generado el <?= $fecha ?> · Total: <?= $totalUsuarios ?> usuarios en <?= $totalSedes ?> sedes</span>
</div>

<script>
  if(window.location.search.includes('autoprint=1')) window.onload = () => window.print();
</script>
</body>
</html>