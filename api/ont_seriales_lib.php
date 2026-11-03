<?php
/* ont_seriales_lib.php — Seriales (SN) de las ONT de un movimiento del historial.
   Si la descripción o el nombre ya traen el SN, no devuelve nada (para no
   repetirlo). Si no, los busca en las notas del envío de Seguimiento
   ("Seriales: SN1, SN2"), enlazado por solicitud_id / pedido_agrupado_id. */
if (!function_exists('ontSerialesDeRegistro')) {
function ontSerialesDeRegistro(PDO $pdo, array $h): string {
    $ref  = (string)($h['ref'] ?? '');
    $nom  = (string)($h['nombre'] ?? '');
    $desc = (string)($h['descripcion'] ?? '');
    if (!preg_match('/^ONT/i', $ref) && !preg_match('/^ONT/i', $nom)) return '';
    if (preg_match('/\bSN\b|Seriales\s*:/iu', $desc . ' ' . $nom)) return '';
    $ids = [];
    foreach (['solicitud_id', 'pedido_agrupado_id'] as $k) {
        $v = $h[$k] ?? ($h['_' . $k] ?? null);
        if ($v !== null && $v !== '') $ids[] = (string)$v;
    }
    if (!empty($h['_solicitudId'])) $ids[] = (string)$h['_solicitudId'];
    if (!empty($h['pedidoAgrupadoId'])) $ids[] = (string)$h['pedidoAgrupadoId'];
    $ids = array_values(array_unique($ids));
    if (!$ids) return '';
    try {
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $st = $pdo->prepare("SELECT notas, ref_producto, nombre_producto FROM envios_seguimiento
                             WHERE (referencia_id IN ($ph) OR solicitud_id IN ($ph)) AND notas LIKE '%Seriales%' ORDER BY id");
        $st->execute(array_merge($ids, $ids));
        $filas = $st->fetchAll();
    } catch (\Throwable $e) { return ''; }
    if (!$filas) return '';
    // Si hay varios modelos de ONT en el mismo pedido, quedarse con el del renglón.
    $exactas = array_values(array_filter($filas, fn($f) => ($f['ref_producto'] ?? '') === $ref || ($f['nombre_producto'] ?? '') === $nom));
    if ($exactas) $filas = $exactas;
    $sns = [];
    foreach ($filas as $f) {
        if (preg_match_all('/Seriales(?: preseleccionados)?:\s*(.+)$/m', (string)$f['notas'], $m)) {
            foreach ($m[1] as $linea) {
                $linea = preg_replace('/\s*·.*$/u', '', $linea);
                foreach (explode(',', $linea) as $sn) { $sn = trim($sn); if ($sn !== '') $sns[$sn] = true; }
            }
        }
    }
    return implode(', ', array_keys($sns));
}
}