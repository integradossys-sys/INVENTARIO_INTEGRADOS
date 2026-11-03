<?php
/* ══════════════════════════════════════════════════════
   auditoria_pdf.php — Integrados S&S
   Vista imprimible de una auditoría de inventario guardada
══════════════════════════════════════════════════════ */
error_reporting(0);
ini_set('display_errors', 0);
require_once 'config.php';

if (empty($_SESSION['usuario'])) {
    header('Location: ../index.html');
    exit;
}
$rolActual = $_SESSION['rol'] ?? '';
// Chequeo de permiso simple (igual patrón que rolOPermiso, pero esta página no devuelve JSON)
$tienePermisoAud = $rolActual === 'superadmin';
if (!$tienePermisoAud) {
    $chk = $pdo->prepare("SELECT permisos FROM usuarios WHERE usuario = ?");
    $chk->execute([$_SESSION['usuario']]);
    $perms = json_decode($chk->fetchColumn() ?: '[]', true) ?: [];
    $tienePermisoAud = in_array('auditar_inventario', $perms);
}
if (!$tienePermisoAud) {
    http_response_code(403);
    echo '<h2 style="font-family:Arial;color:#B91C1C;padding:40px;">❌ Sin permisos para ver este reporte.</h2>';
    exit;
}

$id = intval($_GET['id'] ?? 0);
if (!$id) { echo '<h2 style="font-family:Arial;padding:40px;">Falta el ID de la auditoría.</h2>'; exit; }

$stmt = $pdo->prepare("SELECT * FROM auditorias_inventario WHERE id = ?");
$stmt->execute([$id]);
$aud = $stmt->fetch();
if (!$aud) { echo '<h2 style="font-family:Arial;padding:40px;">Auditoría no encontrada.</h2>'; exit; }

$datos = json_decode($aud['datos'], true) ?: [];
$persona = $datos['persona'] ?? ['nombre' => $aud['usuario_auditado'], 'usuario' => $aud['usuario_auditado']];
$nombrePersona = trim(($persona['nombre'] ?? '') . ' ' . ($persona['apellido'] ?? '')) ?: ($persona['usuario'] ?? $aud['usuario_auditado']);

$realizadoPor = $pdo->prepare("SELECT nombre, apellido FROM usuarios WHERE usuario = ?");
$realizadoPor->execute([$aud['realizado_por']]);
$rp = $realizadoPor->fetch();
$nombreRealizador = $rp ? trim($rp['nombre'] . ' ' . $rp['apellido']) : $aud['realizado_por'];
if (!$nombreRealizador) $nombreRealizador = $aud['realizado_por'];

$fecha = date('d/m/Y H:i', strtotime($aud['fecha']));

// Logo en base64
// Logo: usa tu archivo local (api/../logo.png) si lo subes ahí; si no,
// usa el logo embebido que ya tenías en remisión (siempre funciona, no
// depende de ningún enlace externo).
$logoPath = __DIR__ . '/../logo.png';
if (file_exists($logoPath)) {
    $logoB64 = 'data:image/png;base64,' . base64_encode(file_get_contents($logoPath));
} else {
    require_once __DIR__ . '/logo_base64.php';
    $logoB64 = $LOGO_INTEGRADOS_BASE64;
}

function fmtNumPdf($n) {
    $n = floatval($n);
    return (floor($n) == $n) ? (string)intval($n) : rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.');
}

// Filas de productos (con cantidad real y diferencia)
$filasProductos = '';
$totalCoinciden = 0; $totalDiferencia = 0; $totalSinContar = 0;
foreach (($datos['items']['productos'] ?? []) as $it) {
    $esperado = floatval($it['esperado']);
    $real = $it['real'];
    $suf = ($it['unidad'] ?? '') === 'metros' ? 'mts.' : 'uds.';
    if ($real === null || $real === '') {
        $totalSinContar++;
        $estadoTxt = 'Sin contar';
        $estadoColor = '#94A3B8';
        $realTxt = '—';
    } else {
        $realNum = floatval($real);
        $dif = $realNum - $esperado;
        $realTxt = fmtNumPdf($realNum) . ' ' . $suf;
        if ($dif == 0) {
            $totalCoinciden++;
            $estadoTxt = '✔ Coincide';
            $estadoColor = '#166534';
        } elseif ($dif < 0) {
            $totalDiferencia++;
            $estadoTxt = 'Faltan ' . fmtNumPdf(abs($dif)) . ' ' . $suf;
            $estadoColor = '#B91C1C';
        } else {
            $totalDiferencia++;
            $estadoTxt = 'Sobran ' . fmtNumPdf($dif) . ' ' . $suf;
            $estadoColor = '#B45309';
        }
    }
    $filasProductos .= "
    <tr>
        <td style='padding:7px 10px;font-weight:600;color:#0F172A;border-bottom:1px solid #F1F5F9;'>" . htmlspecialchars($it['nombre']) . "<br><span style='font-size:10px;color:#94A3B8;font-weight:400;'>Ref. " . htmlspecialchars($it['ref']) . "</span></td>
        <td style='padding:7px 10px;text-align:center;border-bottom:1px solid #F1F5F9;'>" . fmtNumPdf($esperado) . " {$suf}</td>
        <td style='padding:7px 10px;text-align:center;font-weight:700;border-bottom:1px solid #F1F5F9;'>{$realTxt}</td>
        <td style='padding:7px 10px;text-align:center;font-weight:700;color:{$estadoColor};border-bottom:1px solid #F1F5F9;'>{$estadoTxt}</td>
    </tr>";
}

// Filas de verificación simple (ONT, fibra, recogido) — checkbox
function filasVerificacionPdf($items, $cols) {
    $out = '';
    foreach ($items as $it) {
        $verificado = !empty($it['verificado']);
        $chip = $verificado
            ? "<span style='color:#166534;font-weight:700;'>✔ Verificado</span>"
            : "<span style='color:#94A3B8;'>Pendiente</span>";
        $out .= "<tr>";
        foreach ($cols as $c) {
            $out .= "<td style='padding:7px 10px;border-bottom:1px solid #F1F5F9;'>" . htmlspecialchars($it[$c] ?? '—') . "</td>";
        }
        $out .= "<td style='padding:7px 10px;text-align:center;border-bottom:1px solid #F1F5F9;'>{$chip}</td></tr>";
    }
    return $out;
}

$filasOnt = filasVerificacionPdf($datos['items']['onts'] ?? [], ['modelo','sn','estado']);
$filasFibra = filasVerificacionPdf($datos['items']['fibra'] ?? [], ['categoria','codigo','disponible']);

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Auditoría de Inventario — <?= htmlspecialchars($nombrePersona) ?></title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1E293B; background: white; padding: 24px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid #7C3AED; margin-bottom: 20px; }
  .logo-area { display: flex; align-items: center; gap: 12px; }
  .logo-area img { height: 48px; }
  .empresa { font-size: 20px; font-weight: 900; color: #0A1F5C; }
  .sub { font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
  .doc-info { text-align: right; }
  .doc-titulo { font-size: 13px; font-weight: 700; color: #7C3AED; text-transform: uppercase; letter-spacing: 1px; }
  .doc-fecha { font-size: 11px; color: #64748B; margin-top: 4px; }
  .persona-box { background: #F8FAFC; border: 1.5px solid #E2E8F0; border-radius: 10px; padding: 14px 18px; margin-bottom: 18px; display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px; }
  .persona-nombre { font-size: 16px; font-weight: 800; color:#0F172A; }
  .persona-sub { font-size: 11px; color:#64748B; margin-top:2px; }
  .stats { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-bottom: 20px; }
  .stat { background: #F8FAFC; border: 1.5px solid #E2E8F0; border-radius: 10px; padding: 10px 14px; text-align: center; }
  .stat-num { font-size: 22px; font-weight: 800; }
  .stat-lbl { font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: .5px; margin-top: 2px; }
  h2.seccion { font-size: 14px; color:#0F172A; margin-top:22px; margin-bottom:8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 6px; }
  thead tr { background: #0A1F5C; color: white; }
  thead th { padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  .footer { margin-top: 24px; padding-top: 12px; border-top: 1px solid #E2E8F0; display: flex; justify-content: space-between; font-size: 10px; color: #94A3B8; }
  @media print {
    body { padding: 12px; }
    .no-print { display: none; }
    @page { margin: 1cm; }
  }
</style>
</head>
<body>
<div class="no-print" style="margin-bottom:16px;display:flex;gap:10px;">
  <button onclick="window.print()" style="background:#7C3AED;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">🖨 Imprimir / Guardar PDF</button>
  <button onclick="window.close()" style="background:#F1F5F9;color:#475569;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;">✕ Cerrar</button>
</div>

<div class="header">
  <div class="logo-area">
    <?= $logoB64 ? "<img src='{$logoB64}' alt='Logo'>" : '' ?>
    <div>
      <div class="empresa">Integrados S&S</div>
      <div class="sub">Sistema de Inventario — Huila, Colombia</div>
    </div>
  </div>
  <div class="doc-info">
    <div class="doc-titulo">Auditoría de Inventario</div>
    <div class="doc-fecha">Generado el <?= $fecha ?></div>
  </div>
</div>

<div class="persona-box">
  <div>
    <div class="persona-nombre"><?= htmlspecialchars($nombrePersona) ?></div>
    <div class="persona-sub"><?= htmlspecialchars($persona['rol'] ?? '') ?> · <?= htmlspecialchars($persona['sede'] ?? '—') ?></div>
  </div>
  <div style="text-align:right;">
    <div class="persona-sub">Realizado por</div>
    <div style="font-weight:700;color:#0F172A;"><?= htmlspecialchars($nombreRealizador) ?></div>
  </div>
</div>

<div class="stats">
  <div class="stat">
    <div class="stat-num" style="color:#166534;"><?= $totalCoinciden ?></div>
    <div class="stat-lbl">Coinciden</div>
  </div>
  <div class="stat">
    <div class="stat-num" style="color:#B91C1C;"><?= $totalDiferencia ?></div>
    <div class="stat-lbl">Con diferencia</div>
  </div>
  <div class="stat">
    <div class="stat-num" style="color:#94A3B8;"><?= $totalSinContar ?></div>
    <div class="stat-lbl">Sin contar</div>
  </div>
</div>

<?php if ($filasProductos): ?>
<h2 class="seccion">📦 Productos</h2>
<table>
  <thead><tr><th>Producto</th><th style="text-align:center;">Sistema dice</th><th style="text-align:center;">Cantidad real</th><th style="text-align:center;">Estado</th></tr></thead>
  <tbody><?= $filasProductos ?></tbody>
</table>
<?php endif; ?>

<?php if ($filasOnt): ?>
<h2 class="seccion">📡 ONTs</h2>
<table>
  <thead><tr><th>Modelo</th><th>Serial</th><th>Estado</th><th style="text-align:center;">Verificación</th></tr></thead>
  <tbody><?= $filasOnt ?></tbody>
</table>
<?php endif; ?>

<?php if ($filasFibra): ?>
<h2 class="seccion">🧵 Fibra</h2>
<table>
  <thead><tr><th>Categoría</th><th>Carrete</th><th>Disponible</th><th style="text-align:center;">Verificación</th></tr></thead>
  <tbody><?= $filasFibra ?></tbody>
</table>
<?php endif; ?>

<div class="footer">
  <span>Integrados S&S — Sistema de Inventario</span>
  <span>Auditoría #<?= $aud['id'] ?> · Generado el <?= $fecha ?></span>
</div>

<script>
  if(window.location.search.includes('autoprint=1')) window.onload = () => window.print();
</script>
</body>
</html>