<?php
/* ══════════════════════════════════════════════════════
   onts_informe_pdf.php — Integrados S&S
   Vista imprimible (Guardar como PDF) del informe de ONT por oficina.
   Recibe los mismos filtros que la pantalla.
══════════════════════════════════════════════════════ */
error_reporting(0);
ini_set('display_errors', 0);
require_once 'config.php';
require_once 'auditoria.php';
require_once 'onts_informe_lib.php';

if (empty($_SESSION['usuario'])) { header('Location: ../index.html'); exit; }
if (!in_array($_SESSION['rol'] ?? '', ['superadmin', 'distribuidor'], true)) {
    http_response_code(403);
    echo '<h2 style="font-family:Arial;color:#B91C1C;padding:40px;">❌ Sin permisos para ver este informe.</h2>';
    exit;
}

function _oi_h($t) { return htmlspecialchars((string)$t); }
function _oi_est($e) { return $e === 'sin_estado' ? 'Sin estado' : ucfirst(str_replace('_', ' ', (string)$e)); }
function _oi_f($f) { return $f ? date('d/m/Y', strtotime($f)) : '—'; }

$f = ontsInformeFiltrosDeGet($_GET);
$d = ontsInformeDatos($pdo, $f, 2000);

auditar($pdo, 'generar_pdf', 'informes',
    'PDF informe ONT por oficina — ' . $d['total'] . ' ONT'
    . ($f['desde'] || $f['hasta'] ? " ({$f['fecha_tipo']}: " . ($f['desde'] ?: '…') . ' a ' . ($f['hasta'] ?: '…') . ')' : '')
    . ($f['modelo'] ? " · modelo {$f['modelo']}" : '') . ($f['estado'] ? " · estado {$f['estado']}" : '')
    . ($f['oficina'] ? " · oficina {$f['oficina']}" : ''), '');

$logoPath = __DIR__ . '/../logo.png';
if (file_exists($logoPath)) {
    $logoB64 = 'data:image/png;base64,' . base64_encode(file_get_contents($logoPath));
} else {
    require_once __DIR__ . '/logo_base64.php';
    $logoB64 = $LOGO_INTEGRADOS_BASE64 ?? '';
}

$tipoTxt = ['despacho' => 'despacho', 'ingreso' => 'ingreso', 'instalacion' => 'instalación'][$f['fecha_tipo']];
$filtros = [];
$filtros[] = ($f['desde'] || $f['hasta'])
    ? "Fecha de $tipoTxt: " . ($f['desde'] ? _oi_f($f['desde']) : 'inicio') . ' a ' . ($f['hasta'] ? _oi_f($f['hasta']) : 'hoy')
    : 'Todas las fechas';
$filtros[] = 'Modelo: '  . ($f['modelo']  ?: 'todos');
$filtros[] = 'Estado: '  . ($f['estado']  ? _oi_est($f['estado']) : 'todos');
$filtros[] = 'Oficina: ' . ($f['oficina'] ?: 'todas');

$estados = array_keys($d['por_estado']);
$th = 'padding:7px 8px;background:#0B1F3A;color:#fff;font-size:11px;text-align:center;';
$td = 'padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;';
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Informe de ONT por oficina</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #0F172A; margin: 0; padding: 28px 34px; font-size: 12px; }
  .top { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #0C6EDE; padding-bottom:12px; margin-bottom:14px; }
  .top img { height: 48px; }
  h1 { font-size: 20px; margin: 0; } h2 { font-size: 14px; margin: 22px 0 8px; color:#0B1F3A; }
  table { width:100%; border-collapse:collapse; }
  .kpis { display:flex; gap:10px; flex-wrap:wrap; margin:10px 0; }
  .kpi { border:1px solid #DCE4EF; border-radius:8px; padding:8px 14px; text-align:center; min-width:90px; }
  .kpi b { display:block; font-size:20px; color:#0C6EDE; }
  .noprint { margin-top:18px; text-align:center; }
  @media print { .noprint { display:none; } body { padding: 10px 14px; } @page { margin: 12mm; } tr { page-break-inside: avoid; } thead { display: table-header-group; } }
</style>
</head>
<body>
<div class="top">
  <div><h1>Informe de ONT por oficina</h1>
  <div style="color:#64748B;margin-top:4px;">Generado el <?= date('d/m/Y H:i') ?> por <?= _oi_h($_SESSION['usuario']) ?></div></div>
  <?php if ($logoB64): ?><img src="<?= $logoB64 ?>" alt="Integrados S&amp;S"><?php endif; ?>
</div>

<div style="background:#F4F7FB;border-radius:8px;padding:8px 12px;color:#334155;">
  <b>Filtros:</b> <?= _oi_h(implode('  ·  ', $filtros)) ?>
</div>

<div class="kpis">
  <div class="kpi"><b><?= (int)$d['total'] ?></b>Total ONT</div>
  <?php foreach ($d['por_estado'] as $e => $n): ?>
    <div class="kpi"><b><?= (int)$n ?></b><?= _oi_h(_oi_est($e)) ?></div>
  <?php endforeach; ?>
</div>

<?php if (!$d['total']): ?>
  <p style="padding:30px;text-align:center;color:#64748B;">No hay ONT con esos filtros.</p>
<?php else: ?>

<h2>Por oficina</h2>
<table>
  <thead><tr><th style="<?= $th ?>text-align:left;">Oficina</th>
    <?php foreach ($estados as $e): ?><th style="<?= $th ?>"><?= _oi_h(_oi_est($e)) ?></th><?php endforeach; ?>
    <th style="<?= $th ?>">Total</th></tr></thead>
  <tbody>
  <?php foreach ($d['por_oficina'] as $o): ?>
    <tr><td style="<?= $td ?>font-weight:600;"><?= _oi_h($o['oficina']) ?></td>
      <?php foreach ($estados as $e): ?><td style="<?= $td ?>text-align:center;"><?= (int)($o['estados'][$e] ?? 0) ?: '·' ?></td><?php endforeach; ?>
      <td style="<?= $td ?>text-align:center;font-weight:700;"><?= (int)$o['total'] ?></td></tr>
  <?php endforeach; ?>
  </tbody>
</table>

<h2>Por modelo</h2>
<table>
  <thead><tr><th style="<?= $th ?>text-align:left;">Modelo</th>
    <?php foreach ($estados as $e): ?><th style="<?= $th ?>"><?= _oi_h(_oi_est($e)) ?></th><?php endforeach; ?>
    <th style="<?= $th ?>">Total</th></tr></thead>
  <tbody>
  <?php foreach ($d['por_modelo'] as $m): ?>
    <tr><td style="<?= $td ?>font-weight:600;"><?= _oi_h($m['modelo']) ?></td>
      <?php foreach ($estados as $e): ?><td style="<?= $td ?>text-align:center;"><?= (int)($m['estados'][$e] ?? 0) ?: '·' ?></td><?php endforeach; ?>
      <td style="<?= $td ?>text-align:center;font-weight:700;"><?= (int)$m['total'] ?></td></tr>
  <?php endforeach; ?>
  </tbody>
</table>

<h2>Detalle de ONT<?= $d['truncado'] ? ' (primeras ' . count($d['filas']) . ' — el Excel trae todas)' : '' ?></h2>
<table>
  <thead><tr>
    <th style="<?= $th ?>text-align:left;">MAC</th><th style="<?= $th ?>text-align:left;">Serie</th>
    <th style="<?= $th ?>text-align:left;">Modelo</th><th style="<?= $th ?>">Estado</th>
    <th style="<?= $th ?>text-align:left;">Oficina</th><th style="<?= $th ?>text-align:left;">Técnico</th>
    <th style="<?= $th ?>">Despacho</th><th style="<?= $th ?>">Instalación</th>
  </tr></thead>
  <tbody>
  <?php foreach ($d['filas'] as $r): ?>
    <tr>
      <td style="<?= $td ?>font-family:monospace;font-size:11px;"><?= _oi_h($r['mac'] ?: '—') ?></td>
      <td style="<?= $td ?>font-family:monospace;font-size:11px;"><?= _oi_h($r['sn'] ?: '—') ?></td>
      <td style="<?= $td ?>"><?= _oi_h($r['modelo']) ?></td>
      <td style="<?= $td ?>text-align:center;"><?= _oi_h(_oi_est($r['estado'] ?: 'sin_estado')) ?></td>
      <td style="<?= $td ?>"><?= _oi_h($r['oficina']) ?></td>
      <td style="<?= $td ?>"><?= _oi_h($r['tecnico'] ?: '—') ?></td>
      <td style="<?= $td ?>text-align:center;"><?= _oi_f($r['f_despacho']) ?></td>
      <td style="<?= $td ?>text-align:center;"><?= _oi_f($r['f_instalacion']) ?></td>
    </tr>
  <?php endforeach; ?>
  </tbody>
</table>
<?php endif; ?>

<div class="noprint">
  <button onclick="window.print()" style="background:#0C6EDE;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">🖨 Imprimir / Guardar PDF</button>
</div>
<script>
  if (window.location.search.includes('autoprint=1')) window.onload = () => window.print();
</script>
</body>
</html>