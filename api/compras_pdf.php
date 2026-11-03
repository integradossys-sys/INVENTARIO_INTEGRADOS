<?php
/* ══════════════════════════════════════════════════════
   compras_pdf.php — Integrados S&S
   Vista imprimible (Guardar como PDF) de una solicitud de compra.
   Se usa al aprobar/rechazar y desde el botón "PDF" de cada solicitud.
══════════════════════════════════════════════════════ */
error_reporting(0);
ini_set('display_errors', 0);
require_once 'config.php';
require_once 'auditoria.php';

if (empty($_SESSION['usuario'])) {
    header('Location: ../index.html');
    exit;
}

$id = intval($_GET['id'] ?? 0);
if (!$id) { echo '<h2 style="font-family:Arial;padding:40px;">Falta el número de la solicitud.</h2>'; exit; }

$stmt = $pdo->prepare("SELECT * FROM compras_solicitudes WHERE id = ?");
$stmt->execute([$id]);
$sol = $stmt->fetch();
if (!$sol) { echo '<h2 style="font-family:Arial;padding:40px;">Solicitud no encontrada.</h2>'; exit; }

// Solo quien la creó o quien gestiona las compras
if ($sol['solicitado_por'] !== $_SESSION['usuario'] && !usuarioTienePermiso('gestionar_compras')) {
    http_response_code(403);
    echo '<h2 style="font-family:Arial;color:#B91C1C;padding:40px;">❌ Sin permisos para ver esta solicitud.</h2>';
    exit;
}

auditar($pdo, 'generar_pdf', 'compras', 'PDF de la solicitud de compra SC-' . str_pad((string)$id, 4, '0', STR_PAD_LEFT) . ' (' . $sol['estado'] . ')', (string)$id);

$q = $pdo->prepare("SELECT * FROM compras_items WHERE solicitud_id = ? ORDER BY id");
$q->execute([$id]);
$items = $q->fetchAll();

function _cp_nombreUsuario($pdo, $usuario) {
    if (!$usuario) return '—';
    try {
        $s = $pdo->prepare("SELECT nombre, apellido FROM usuarios WHERE usuario = ?");
        $s->execute([$usuario]);
        $u = $s->fetch();
        $n = trim(($u['nombre'] ?? '') . ' ' . ($u['apellido'] ?? ''));
        return $n !== '' ? $n : $usuario;
    } catch (\Throwable $e) { return $usuario; }
}
function _cp_num($n) {
    $n = floatval($n);
    return (floor($n) == $n) ? (string)intval($n) : rtrim(rtrim(number_format($n, 2, '.', ''), '0'), '.');
}
function _cp_fecha($f) { return $f ? date('d/m/Y H:i', strtotime($f)) : '—'; }
function _cp_h($t) { return htmlspecialchars((string)$t); }

$logoPath = __DIR__ . '/../logo.png';
if (file_exists($logoPath)) {
    $logoB64 = 'data:image/png;base64,' . base64_encode(file_get_contents($logoPath));
} else {
    require_once __DIR__ . '/logo_base64.php';
    $logoB64 = $LOGO_INTEGRADOS_BASE64 ?? '';
}

$codigo = 'SC-' . str_pad((string)$id, 4, '0', STR_PAD_LEFT);
$estados = [
    'pendiente' => ['PENDIENTE',  '#92400E', '#FAEEDA'],
    'aprobada'  => ['APROBADA',   '#166534', '#DCFCE7'],
    'rechazada' => ['RECHAZADA',  '#B91C1C', '#FEE2E2'],
    'cancelada' => ['CANCELADA',  '#475569', '#F1F5F9'],
];
[$estTxt, $estColor, $estBg] = $estados[$sol['estado']] ?? [strtoupper($sol['estado']), '#475569', '#F1F5F9'];

$solicitante = $sol['solicitante_nombre'] ?: _cp_nombreUsuario($pdo, $sol['solicitado_por']);
$gestor      = _cp_nombreUsuario($pdo, $sol['gestionado_por']);

$hayAjuste = false;
$filas = '';
foreach ($items as $i => $it) {
    $orig = $it['cantidad_original'] !== null ? floatval($it['cantidad_original']) : null;
    $cant = floatval($it['cantidad']);
    $ajustada = $orig !== null && abs($orig - $cant) > 0.0001;
    if ($ajustada) $hayAjuste = true;
    $nuevo = $it['es_nuevo'] ? " <span style='background:#FAEEDA;color:#7A4300;border-radius:8px;padding:1px 7px;font-size:9px;font-weight:700;'>PRODUCTO NUEVO</span>" : '';
    $nota = $it['nota'] ? "<br><span style='font-size:10px;color:#64748B;font-weight:400;'>" . _cp_h($it['nota']) . "</span>" : '';
    $pedido = $ajustada ? _cp_num($orig) : _cp_num($cant);
    $aprobado = $sol['estado'] === 'aprobada'
        ? "<strong style='color:" . ($ajustada ? '#B45309' : '#166534') . ";'>" . _cp_num($cant) . "</strong>"
        : '—';
    $filas .= "<tr>
        <td style='padding:8px 10px;border-bottom:1px solid #F1F5F9;text-align:center;color:#94A3B8;'>" . ($i + 1) . "</td>
        <td style='padding:8px 10px;border-bottom:1px solid #F1F5F9;font-weight:600;color:#0F172A;'>" . _cp_h($it['nombre']) . $nuevo . $nota . "</td>
        <td style='padding:8px 10px;border-bottom:1px solid #F1F5F9;text-align:center;'>" . _cp_h($it['unidad']) . "</td>
        <td style='padding:8px 10px;border-bottom:1px solid #F1F5F9;text-align:center;'>{$pedido}</td>
        <td style='padding:8px 10px;border-bottom:1px solid #F1F5F9;text-align:center;'>{$aprobado}</td>
    </tr>";
}

$ahora = date('d/m/Y H:i');
header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>Solicitud de compra <?= _cp_h($codigo) ?></title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 12px; color: #1E293B; background: white; padding: 24px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 3px solid #0C6EDE; margin-bottom: 20px; }
  .logo-area { display: flex; align-items: center; gap: 12px; }
  .logo-area img { height: 48px; }
  .empresa { font-size: 20px; font-weight: 900; color: #0A1F5C; }
  .sub { font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; }
  .doc-info { text-align: right; }
  .doc-titulo { font-size: 13px; font-weight: 700; color: #0C6EDE; text-transform: uppercase; letter-spacing: 1px; }
  .doc-codigo { font-size: 22px; font-weight: 900; color: #0F172A; margin-top: 2px; }
  .estado { display:inline-block; margin-top:6px; padding:4px 14px; border-radius:20px; font-size:12px; font-weight:800; letter-spacing:1px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 18px; }
  .caja { background: #F8FAFC; border: 1.5px solid #E2E8F0; border-radius: 10px; padding: 10px 14px; }
  .caja .lbl { font-size: 10px; color: #64748B; text-transform: uppercase; letter-spacing: .5px; }
  .caja .val { font-size: 13px; font-weight: 700; color: #0F172A; margin-top: 2px; }
  h2.seccion { font-size: 14px; color:#0F172A; margin: 18px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  thead tr { background: #0A1F5C; color: white; }
  thead th { padding: 8px 10px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
  .obs { border-radius: 10px; padding: 12px 16px; margin-top: 14px; font-size: 12px; line-height: 1.5; }
  .firmas { display:grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 56px; }
  .firma { border-top: 1.5px solid #334155; padding-top: 6px; text-align: center; font-size: 11px; color: #475569; }
  .firma strong { display:block; color:#0F172A; font-size: 12px; }
  .footer { margin-top: 28px; padding-top: 12px; border-top: 1px solid #E2E8F0; display: flex; justify-content: space-between; font-size: 10px; color: #94A3B8; }
  @media print {
    body { padding: 12px; }
    .no-print { display: none !important; }
    @page { margin: 1cm; }
  }
</style>
</head>
<body>
<div class="no-print" id="barraPdf" style="margin-bottom:16px;display:flex;gap:10px;">
  <button onclick="window.print()" style="background:#0C6EDE;color:white;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600;">🖨 Imprimir / Guardar PDF</button>
  <button onclick="window.close()" style="background:#F1F5F9;color:#475569;border:none;padding:10px 20px;border-radius:8px;cursor:pointer;font-size:13px;">✕ Cerrar</button>
</div>

<div class="header">
  <div class="logo-area">
    <?= $logoB64 ? "<img src='{$logoB64}' alt='Logo'>" : '' ?>
    <div>
      <div class="empresa">Integrados S&amp;S</div>
      <div class="sub">Sistema de Inventario — Huila, Colombia</div>
    </div>
  </div>
  <div class="doc-info">
    <div class="doc-titulo">Solicitud de compra</div>
    <div class="doc-codigo"><?= _cp_h($codigo) ?></div>
    <div class="estado" style="background:<?= $estBg ?>;color:<?= $estColor ?>;"><?= $estTxt ?></div>
  </div>
</div>

<div class="grid">
  <div class="caja"><div class="lbl">Solicitada por</div><div class="val"><?= _cp_h($solicitante) ?></div></div>
  <div class="caja"><div class="lbl">Fecha de solicitud</div><div class="val"><?= _cp_fecha($sol['creado_en']) ?></div></div>
  <div class="caja"><div class="lbl">Prioridad</div><div class="val"><?= $sol['prioridad'] === 'urgente' ? '🔴 Urgente' : 'Normal' ?></div></div>
  <div class="caja"><div class="lbl">Proveedor</div><div class="val"><?= _cp_h($sol['proveedor'] ?: '—') ?></div></div>
  <?php if ($sol['estado'] !== 'pendiente'): ?>
  <div class="caja"><div class="lbl"><?= $sol['estado'] === 'aprobada' ? 'Aprobada por' : ($sol['estado'] === 'rechazada' ? 'Rechazada por' : 'Gestionada por') ?></div><div class="val"><?= _cp_h($gestor) ?></div></div>
  <div class="caja"><div class="lbl">Fecha de decisión</div><div class="val"><?= _cp_fecha($sol['gestionado_en']) ?></div></div>
  <?php endif; ?>
</div>

<?php if (trim((string)$sol['motivo']) !== ''): ?>
<div class="caja" style="margin-bottom:6px;"><div class="lbl">Motivo de la solicitud</div><div class="val" style="font-weight:500;"><?= nl2br(_cp_h($sol['motivo'])) ?></div></div>
<?php endif; ?>

<h2 class="seccion">🛒 Productos solicitados</h2>
<table>
  <thead><tr>
    <th style="width:36px;text-align:center;">#</th>
    <th>Producto</th>
    <th style="text-align:center;">Unidad</th>
    <th style="text-align:center;">Cant. pedida</th>
    <th style="text-align:center;">Cant. aprobada</th>
  </tr></thead>
  <tbody><?= $filas ?></tbody>
</table>
<?php if ($hayAjuste): ?>
<div class="obs" style="background:#FFFBEB;border:1.5px solid #FDE68A;color:#92400E;">⚠ El administrador ajustó algunas cantidades respecto a lo que se pidió (marcadas en naranja en la columna “Cant. aprobada”).</div>
<?php endif; ?>

<?php if ($sol['estado'] === 'rechazada' && trim((string)$sol['motivo_rechazo']) !== ''): ?>
<div class="obs" style="background:#FEF2F2;border:1.5px solid #FECACA;color:#991B1B;"><strong>Motivo del rechazo:</strong> <?= nl2br(_cp_h($sol['motivo_rechazo'])) ?></div>
<?php endif; ?>
<?php if (trim((string)($sol['observacion_admin'] ?? '')) !== ''): ?>
<div class="obs" style="background:#EFF6FF;border:1.5px solid #BFDBFE;color:#1E3A8A;"><strong>Observación del administrador:</strong> <?= nl2br(_cp_h($sol['observacion_admin'])) ?></div>
<?php endif; ?>

<div class="firmas">
  <div class="firma"><strong><?= _cp_h($solicitante) ?></strong>Solicitó</div>
  <div class="firma"><strong><?= $sol['estado'] === 'pendiente' ? '&nbsp;' : _cp_h($gestor) ?></strong><?= $sol['estado'] === 'rechazada' ? 'Rechazó' : 'Aprobó' ?></div>
</div>

<div class="footer">
  <span>Integrados S&amp;S — Sistema de Inventario</span>
  <span><?= _cp_h($codigo) ?> · Generado el <?= $ahora ?></span>
</div>

<script>
  // Dentro del visor del sistema (iframe) no se muestra la barra de botones
  try{ if(window.self!==window.top || window.location.search.includes('autoprint=1')){ var b=document.getElementById('barraPdf'); if(b) b.style.display='none'; } }catch(e){}
  if(window.location.search.includes('autoprint=1')) window.onload = () => window.print();
</script>
</body>
</html>