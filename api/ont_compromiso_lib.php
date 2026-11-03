<?php
/* ont_compromiso_lib.php — Aviso al APROBAR un pedido/solicitud de ONT.
   Aprobar no aparta ONT (se apartan al despachar). Si ya hay más ONT de un
   modelo aprobadas-sin-despachar que ONT libres, la última en despachar se
   quedaría esperando. Esto lo detecta y devuelve un texto de aviso ('' si
   todo alcanza). No bloquea nada. */
if (!function_exists('ontAvisoCompromiso')) {
function ontAvisoCompromiso(PDO $pdo, string $ref): string {
    try {
        if (stripos($ref, 'ONT::') !== 0) return '';
        $modelo = trim(substr($ref, 5));
        if ($modelo === '' || stripos($modelo, 'sin modelo') !== false) return '';
        $like = '%' . $modelo . '%';
        $st = $pdo->prepare("SELECT COUNT(*) FROM ont_seriales
            WHERE estado='disponible' AND tecnico_asignado IS NULL
              AND (LOWER(TRIM(COALESCE(modelo,''))) = LOWER(?)
                   OR LOWER(COALESCE(modelo,'')) LIKE LOWER(?)
                   OR (TRIM(COALESCE(modelo,''))<>'' AND LOWER(?) LIKE CONCAT('%', LOWER(TRIM(COALESCE(modelo,''))), '%')))");
        $st->execute([$modelo, $like, $modelo]);
        $libres = (int)$st->fetchColumn();

        $sg = $pdo->prepare("SELECT COALESCE(SUM(cantidad),0) FROM envios_seguimiento WHERE ref_producto = ? AND estado = 'aprobado'");
        $sg->execute([$ref]);
        $aprobadas = (int)$sg->fetchColumn();

        if ($aprobadas <= $libres) return '';
        $faltan = $aprobadas - $libres;
        return "⚠️ ONT {$modelo}: hay {$libres} libre(s) y {$aprobadas} aprobadas esperando despacho (incluida esta). "
             . "Faltan {$faltan}: el último envío quedará esperando hasta que lleguen más ONT.";
    } catch (\Throwable $e) { error_log('[ontAvisoCompromiso] ' . $e->getMessage()); return ''; }
}}