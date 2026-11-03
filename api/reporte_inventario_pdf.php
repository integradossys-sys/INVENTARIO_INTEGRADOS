<?php
/* ══════════════════════════════════════════════════════
   reporte_inventario_pdf.php — Integrados S&S
   Reporte completo del inventario en formato imprimible
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

$fecha    = date('d/m/Y H:i');
$fechaDia = date('d/m/Y');

// Obtener productos con stock
$prods = $pdo->query("
    SELECT p.*,
           COALESCE(p.stock_neiva, 0) as almacen,
           COALESCE(p.stock_minimo, 0) as minimo
    FROM productos p
    ORDER BY p.ref ASC
")->fetchAll();

// Stock personal de cada persona, agrupado por producto
$stockUsuarios = $pdo->query("
    SELECT su.producto_id, su.cantidad, su.usuario,
           COALESCE(TRIM(CONCAT(u.nombre,' ',u.apellido)), su.usuario) as nombre_usuario
    FROM stock_usuarios su
    LEFT JOIN usuarios u ON u.usuario = su.usuario
    WHERE su.cantidad > 0
    ORDER BY nombre_usuario ASC
")->fetchAll();

// Agrupar por producto (para el total en la tabla principal)
$stockPorProd = [];
foreach ($stockUsuarios as $su) {
    $stockPorProd[$su['producto_id']][] = $su;
}

// Stats generales
$totalProds   = count($prods);
$totalAlmacen = array_sum(array_column($prods, 'almacen'));
$bajoMinimo   = count(array_filter($prods, fn($p) => $p['minimo'] > 0 && $p['almacen'] <= $p['minimo']));
$sinStock     = count(array_filter($prods, fn($p) => $p['almacen'] == 0));

// Logo en base64
$logoPath = __DIR__ . '/../logo.png';
if (file_exists($logoPath)) {
    $logoB64 = 'data:image/png;base64,' . base64_encode(file_get_contents($logoPath));
} else {
    require_once __DIR__ . '/logo_base64.php';
    $logoB64 = $LOGO_INTEGRADOS_BASE64;
}

// Construir encabezado (ya no una columna por sede, sino un total en técnicos)
$theadSedes = "<th style='padding:8px 6px;text-align:center;white-space:nowrap;'>En técnicos</th>";

// Construir filas
$filas = '';
foreach ($prods as $p) {
    $almacen = (int)$p['almacen'];
    $minimo  = (int)$p['minimo'];
    $ref     = htmlspecialchars($p['ref']);
    $nombre  = htmlspecialchars($p['nombre']);
    $unidad  = htmlspecialchars($p['unidad'] ?? 'unidad');
    $prov    = htmlspecialchars($p['proveedor'] ?? '—');

    // Color de fila según stock
    $rowBg = '';
    $almColor = '#0F172A';
    if ($almacen == 0) {
        $rowBg = 'background:#FEF2F2;';
        $almColor = '#B91C1C';
    } elseif ($minimo > 0 && $almacen <= $minimo) {
        $rowBg = 'background:#FFFBEB;';
        $almColor = '#B45309';
    }

    // Total en manos de técnicos (suma de todas las personas)
    $totalTecnicos = 0;
    if (isset($stockPorProd[$p['id']])) {
        foreach ($stockPorProd[$p['id']] as $su) { $totalTecnicos += (int)$su['cantidad']; }
    }
    $colorTec = $totalTecnicos > 0 ? '#166534' : '#94A3B8';
    $celdasSede = "<td style='padding:7px 6px;text-align:center;font-weight:600;color:{$colorTec};border-bottom:1px solid #F1F5F9;'>{$totalTecnicos}</td>";

    $minimoCell = $minimo > 0
        ? "<td style='padding:7px 10px;text-align:center;border-bottom:1px solid #F1F5F9;color:#64748B;'>{$minimo}</td>"
        : "<td style='padding:7px 10px;text-align:center;border-bottom:1px solid #F1F5F9;color:#CBD5E1;'>—</td>";

    $filas .= "
    <tr style='{$rowBg}'>
        <td style='padding:7px 10px;font-family:monospace;font-size:11px;color:#64748B;border-bottom:1px solid #F1F5F9;'>{$ref}</td>
        <td style='padding:7px 10px;font-weight:600;color:#0F172A;border-bottom:1px solid #F1F5F9;'>{$nombre}</td>
        <td style='padding:7px 10px;text-align:center;border-bottom:1px solid #F1F5F9;'><span style='background:#F1F5F9;padding:2px 7px;border-radius:5px;font-size:11px;'>{$unidad}</span></td>
        <td style='padding:7px 10px;text-align:center;font-weight:800;color:{$almColor};border-bottom:1px solid #F1F5F9;font-size:13px;'>{$almacen}</td>
        {$celdasSede}
        {$minimoCell}
        <td style='padding:7px 10px;font-size:11px;color:#64748B;border-bottom:1px solid #F1F5F9;'>{$prov}</td>
    </tr>";
}

header('Content-Type: text/html; charset=utf-8');

// Detalle por persona: agrupar por usuario, uno por fila, con el listado
// de qué productos tiene cada quien.
$porUsuario = [];
foreach ($stockUsuarios as $su) {
    $porUsuario[$su['usuario']]['nombre'] = $su['nombre_usuario'];
    $porUsuario[$su['usuario']]['items'][] = $su;
}
$filasPersonas = '';
foreach ($porUsuario as $usr => $info) {
    $detalleItems = [];
    foreach ($info['items'] as $it) {
        $prodNombre = '';
        foreach ($prods as $p) { if ($p['id'] == $it['producto_id']) { $prodNombre = $p['nombre']; break; } }
        $detalleItems[] = htmlspecialchars($prodNombre) . ' (' . (int)$it['cantidad'] . ')';
    }
    $totalPersona = array_sum(array_column($info['items'], 'cantidad'));
    $filasPersonas .= "
    <tr>
        <td style='padding:7px 10px;font-weight:600;color:#0F172A;border-bottom:1px solid #F1F5F9;'>" . htmlspecialchars($info['nombre']) . "</td>
        <td style='padding:7px 10px;text-align:center;font-weight:700;color:#166534;border-bottom:1px solid #F1F5F9;'>{$totalPersona}</td>
        <td style='padding:7px 10px;font-size:11px;color:#64748B;border-bottom:1px solid #F1F5F9;'>" . implode(', ', $detalleItems) . "</td>
    </tr>";
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Inventario General — Integrados S&S</title>
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
  .stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 20px; }
  .stat { background: #F8FAFC; border: 1.5px solid #E2E8F0; border-radius: 10px; padding: 10px 14px; text-align: center; }
  .stat-num { font-size: 22px; font-weight: 800; }
  .stat-lbl { font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: .5px; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead tr { background: #0A1F5C; color: white; }
  thead th { padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  tbody tr:hover { background: #F8FAFC; }
  .leyenda { display: flex; gap: 16px; margin-top: 14px; font-size: 11px; color: #64748B; }
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
    <div class="doc-titulo">Reporte de Inventario General</div>
    <div class="doc-fecha">Generado el <?= $fecha ?></div>
  </div>
</div>

<!-- Stats -->
<div class="stats">
  <div class="stat">
    <div class="stat-num" style="color:#0C6EDE;"><?= $totalProds ?></div>
    <div class="stat-lbl">Productos</div>
  </div>
  <div class="stat">
    <div class="stat-num" style="color:#166534;"><?= $totalAlmacen ?></div>
    <div class="stat-lbl">Uds. en almacén</div>
  </div>
  <div class="stat">
    <div class="stat-num" style="color:#B45309;"><?= $bajoMinimo ?></div>
    <div class="stat-lbl">Bajo mínimo</div>
  </div>
  <div class="stat">
    <div class="stat-num" style="color:#B91C1C;"><?= $sinStock ?></div>
    <div class="stat-lbl">Sin stock</div>
  </div>
</div>

<!-- Tabla -->
<table>
  <thead>
    <tr>
      <th>Ref.</th>
      <th>Producto</th>
      <th style="text-align:center;">Unidad</th>
      <th style="text-align:center;">Almacén</th>
      <?= $theadSedes ?>
      <th style="text-align:center;">Mínimo</th>
      <th>Proveedor</th>
    </tr>
  </thead>
  <tbody>
    <?= $filas ?>
  </tbody>
</table>

<!-- Leyenda -->
<div class="leyenda">
  <span><span class="dot" style="background:#FEF2F2;border:1px solid #FECACA;"></span> Sin stock</span>
  <span><span class="dot" style="background:#FFFBEB;border:1px solid #FDE68A;"></span> Bajo mínimo</span>
  <span><span class="dot" style="background:white;border:1px solid #E2E8F0;"></span> Normal</span>
</div>

<!-- Detalle por persona -->
<h2 style="font-family:Arial;font-size:15px;color:#0F172A;margin-top:28px;">👤 Detalle — qué tiene cada persona</h2>
<table>
  <thead>
    <tr>
      <th>Persona</th>
      <th style="text-align:center;">Total</th>
      <th>Detalle</th>
    </tr>
  </thead>
  <tbody>
    <?= $filasPersonas ?: '<tr><td colspan="3" style="padding:16px;text-align:center;color:#94A3B8;">Nadie tiene material personal registrado todavía.</td></tr>' ?>
  </tbody>
</table>

<!-- Footer -->
<div class="footer">
  <span>Integrados S&S — Sistema de Inventario</span>
  <span>Reporte generado el <?= $fecha ?> · Total: <?= $totalProds ?> productos</span>
</div>

<script>
  // Auto-print cuando se abre directamente
  if(window.location.search.includes('autoprint=1')) window.onload = () => window.print();
</script>
</body>
</html>