<?php
/* gastos_informe_pdf.php — Vista imprimible (Guardar como PDF) del informe de gastos.
   Recibe los mismos filtros que la pantalla. */
error_reporting(0);
ini_set('display_errors', 0);
require_once 'config.php';
require_once 'auditoria.php';
require_once 'gastos_informe_lib.php';
if (empty($_SESSION['usuario'])) { header('Location: ../index.html'); exit; }
if (!in_array($_SESSION['rol'] ?? '', ['superadmin', 'distribuidor'], true)) {
    http_response_code(403);
    echo '<h2 style="font-family:Arial;color:#B91C1C;padding:40px;">❌ Sin permisos para ver este informe.</h2>'; exit;
}
function _gi_h($t) { return htmlspecialchars((string)$t); }
function _gi_n($n) { $n = (float)$n; return floor($n) == $n ? (string)(int)$n : rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.'); }
$f = gastosInformeFiltrosDeGet($_GET);
$d = gastosInformeDatos($pdo, $f, 2000);
auditar($pdo, 'generar_pdf', 'informes', 'PDF ' . gastosInformeResumenFiltros($f, $d['total']), '');
$logoPath = __DIR__ . '/../logo.png';
if (file_exists($logoPath)) $logoB64 = 'data:image/png;base64,' . base64_encode(file_get_contents($logoPath));
else { require_once __DIR__ . '/logo_base64.php'; $logoB64 = $LOGO_INTEGRADOS_BASE64 ?? ''; }
$fd = fn($x) => $x ? date('d/m/Y', strtotime($x)) : '';
$filtros = [];
$filtros[] = ($f['desde'] || $f['hasta']) ? 'Fechas: ' . ($f['desde'] ? $fd($f['desde']) : 'inicio') . ' a ' . ($f['hasta'] ? $fd($f['hasta']) : 'hoy') : 'Todas las fechas';
$filtros[] = 'Producto: ' . ($f['producto'] ?: 'todos');
$filtros[] = 'Persona: ' . ($f['usuario'] ?: 'todas');
$filtros[] = 'Sede: ' . ($f['sede'] ?: 'todas');
$filtros[] = 'Cliente/proyecto: ' . ($f['cliente'] ?: 'todos');
$th = 'padding:7px 8px;background:#0B1F3A;color:#fff;font-size:11px;text-align:left;';
$td = 'padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:12px;';
?>
<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Informe de gastos</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; color: #0F172A; margin: 0; padding: 28px 34px; font-size: 12px; }
  .top { display:flex; justify-content:space-between; align-items:center; border-bottom:3px solid #0C6EDE; padding-bottom:12px; margin-bottom:14px; }
  .top img { height: 48px; } h1 { font-size: 20px; margin: 0; } h2 { font-size: 14px; margin: 22px 0 8px; color:#0B1F3A; }
  table { width:100%; border-collapse:collapse; }
  .noprint { margin-top:18px; text-align:center; }
  @media print { .noprint { display:none; } body { padding: 10px 14px; } @page { margin: 12mm; } tr { page-break-inside: avoid; } thead { display: table-header-group; } }
</style></head><body>
<div class="top">
  <div><h1>Informe de gastos</h1><div style="color:#64748B;margin-top:4px;">Generado el <?= date('d/m/Y H:i') ?> por <?= _gi_h($_SESSION['usuario']) ?></div></div>
  <?php if ($logoB64): ?><img src="<?= $logoB64 ?>" alt="Integrados S&amp;S"><?php endif; ?>
</div>
<div style="background:#F4F7FB;border-radius:8px;padding:8px 12px;color:#334155;"><b>Filtros:</b> <?= _gi_h(implode('  ·  ', $filtros)) ?></div>
<p style="margin:12px 0;"><b><?= (int)$d['total'] ?></b> gasto(s) registrados.</p>
<?php if (!$d['total']): ?>
  <p style="padding:30px;text-align:center;color:#64748B;">No hay gastos con esos filtros.</p>
<?php else: ?>
<h2>Total por producto</h2>
<table><thead><tr><th style="<?= $th ?>">Ref</th><th style="<?= $th ?>">Producto</th><th style="<?= $th ?>text-align:right;">Total gastado</th><th style="<?= $th ?>text-align:right;"># Gastos</th></tr></thead><tbody>
<?php foreach ($d['por_producto'] as $r): ?>
<tr><td style="<?= $td ?>font-family:monospace;"><?= _gi_h($r['ref']) ?></td><td style="<?= $td ?>font-weight:600;"><?= _gi_h($r['nombre']) ?></td>
<td style="<?= $td ?>text-align:right;font-weight:700;"><?= _gi_n($r['total']) ?> <?= _gi_h($r['unidad']) ?></td><td style="<?= $td ?>text-align:right;"><?= (int)$r['veces'] ?></td></tr>
<?php endforeach; ?></tbody></table>
<h2>Por persona</h2>
<table><thead><tr><th style="<?= $th ?>">Persona</th><th style="<?= $th ?>">Sede</th><th style="<?= $th ?>text-align:right;"># Gastos</th><th style="<?= $th ?>">Qué gastó</th></tr></thead><tbody>
<?php foreach ($d['por_persona'] as $r): ?>
<tr><td style="<?= $td ?>font-weight:600;"><?= _gi_h($r['nombre']) ?></td><td style="<?= $td ?>"><?= _gi_h($r['sede'] ?: '—') ?></td>
<td style="<?= $td ?>text-align:right;"><?= (int)$r['num_gastos'] ?></td><td style="<?= $td ?>"><?= _gi_h($r['detalle']) ?></td></tr>
<?php endforeach; ?></tbody></table>
<h2>Detalle de gastos<?= $d['truncado'] ? ' (primeros ' . count($d['filas']) . ' — el Excel trae todos)' : '' ?></h2>
<table><thead><tr><th style="<?= $th ?>">Fecha</th><th style="<?= $th ?>">Producto</th><th style="<?= $th ?>text-align:right;">Cantidad</th><th style="<?= $th ?>">Persona</th><th style="<?= $th ?>">Cliente / proyecto</th><th style="<?= $th ?>">Descripción</th></tr></thead><tbody>
<?php foreach ($d['filas'] as $r): ?>
<tr><td style="<?= $td ?>white-space:nowrap;"><?= _gi_h(date('d/m/Y', strtotime($r['fecha']))) ?></td><td style="<?= $td ?>"><?= _gi_h($r['nombre']) ?></td>
<td style="<?= $td ?>text-align:right;font-weight:700;"><?= _gi_n($r['cantidad']) ?> <?= _gi_h($r['unidad']) ?></td><td style="<?= $td ?>"><?= _gi_h($r['persona_nombre']) ?></td>
<td style="<?= $td ?>"><?= _gi_h($r['cliente'] ?: '—') ?></td><td style="<?= $td ?>font-size:11px;color:#475569;"><?= _gi_h(mb_substr((string)$r['descripcion'], 0, 120)) ?></td></tr>
<?php endforeach; ?></tbody></table>
<?php endif; ?>
<div class="noprint"><button onclick="window.print()" style="background:#0C6EDE;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">🖨 Imprimir / Guardar PDF</button></div>
<script>if (window.location.search.includes('autoprint=1')) window.onload = () => window.print();</script>
</body></html>