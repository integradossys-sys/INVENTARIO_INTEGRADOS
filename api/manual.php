<?php
/* manual.php — Integrados S&S
   Entrega el manual de usuario (PDF con imágenes) que le corresponde al rol de la sesión.
   Los PDF están en /manuales con nombres no adivinables (y con .htaccess si el servidor lo aplica); la forma normal de abrirlos es este archivo, que revisa sesión y rol.
     GET ?action=lista          → manuales disponibles para este usuario
     GET ?action=ver&id=...     → el PDF (inline). `&descargar=1` lo baja como archivo.
   Cada perfil ve solo su manual, sin cambiarlo. */
error_reporting(0);
ini_set('display_errors', 0);
require_once 'config.php';
sesionRequerida();

$MANUALES = [
    'superadmin'      => ['titulo' => 'Manual del Superadmin',          'archivo' => 'superadmin_cbba23252227.pdf'],
    'distribuidor'    => ['titulo' => 'Manual del Distribuidor',        'archivo' => 'distribuidor_cbba23252227.pdf'],
    'municipio'       => ['titulo' => 'Manual de la Oficina (Municipio)', 'archivo' => 'municipio_cbba23252227.pdf'],
    'tecnico_persona' => ['titulo' => 'Manual del Técnico / Persona',   'archivo' => 'tecnico_persona_cbba23252227.pdf'],
];
$rol = $_SESSION['rol'] ?? '';
$propio = ['superadmin' => 'superadmin', 'distribuidor' => 'distribuidor', 'municipio' => 'municipio',
           'tecnico' => 'tecnico_persona', 'persona' => 'tecnico_persona'][$rol] ?? null;
if (!$propio) responder(['error' => 'Tu rol no tiene manual asignado'], 403);
$permitidos = [$propio];   // manual fijo: cada perfil ve solo el suyo (también el superadmin)

$accion = $_GET['action'] ?? 'ver';
if ($accion === 'lista') {
    $lista = [];
    foreach ($permitidos as $id) $lista[] = ['id' => $id, 'titulo' => $MANUALES[$id]['titulo']];
    responder(['ok' => true, 'propio' => $propio, 'manuales' => $lista]);
}

$id = $_GET['id'] ?? $propio;
if (!in_array($id, $permitidos, true)) $id = $propio;   // nunca entrega el manual de otro rol
$ruta = __DIR__ . '/../manuales/' . $MANUALES[$id]['archivo'];
if (!is_file($ruta)) responder(['error' => 'El manual todavía no está instalado en el servidor'], 404);

$nombre = 'Manual_' . $id . '_Integrados_SS.pdf';
header('Content-Type: application/pdf');
header('Content-Disposition: ' . (!empty($_GET['descargar']) ? 'attachment' : 'inline') . '; filename="' . $nombre . '"');
header('Content-Length: ' . filesize($ruta));
header('Cache-Control: private, max-age=600');
header('X-Content-Type-Options: nosniff');
readfile($ruta);
exit;