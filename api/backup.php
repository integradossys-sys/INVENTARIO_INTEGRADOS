<?php
/* ═══════════════════════════════════════════════════════════
   backup.php — Respaldo de Integrados S&S
   Genera copia de la base de datos (.sql) y, opcionalmente,
   de los archivos del sistema (.zip). Funciona en XAMPP y
   en hosting compartido (no depende de mysqldump).

   Acciones:
     ?action=db       → descarga un .sql con toda la base de datos
     ?action=full     → descarga un .zip con la BD + los archivos
     ?action=info     → datos del último respaldo / estado (JSON)
═══════════════════════════════════════════════════════════ */

require __DIR__ . '/config.php';
require_once __DIR__ . '/auditoria.php';

// Solo superadmin puede generar respaldos (descargan toda la base de datos).
sesionRequerida();
rolRequerido('superadmin');

$action = $_GET['action'] ?? 'db';

/* ───────────────────────────────────────────────
   Generar el volcado SQL de toda la base de datos
   (estructura + datos) en PHP puro.
─────────────────────────────────────────────── */
function generarDumpSQL(PDO $pdo, string $db): string {
    $out  = "-- ═══════════════════════════════════════════════\n";
    $out .= "-- Respaldo Integrados S&S\n";
    $out .= "-- Base de datos: $db\n";
    $out .= "-- Fecha: " . date('Y-m-d H:i:s') . "\n";
    $out .= "-- ═══════════════════════════════════════════════\n\n";
    $out .= "SET FOREIGN_KEY_CHECKS=0;\n";
    $out .= "SET NAMES utf8mb4;\n\n";

    // Listar todas las tablas
    $tablas = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);

    foreach ($tablas as $tabla) {
        // Estructura
        $out .= "-- ───── Tabla: $tabla ─────\n";
        $out .= "DROP TABLE IF EXISTS `$tabla`;\n";
        $create = $pdo->query("SHOW CREATE TABLE `$tabla`")->fetch(PDO::FETCH_ASSOC);
        $out .= ($create['Create Table'] ?? '') . ";\n\n";

        // Datos
        $filas = $pdo->query("SELECT * FROM `$tabla`");
        $cols  = null;
        $buffer = [];
        while ($fila = $filas->fetch(PDO::FETCH_ASSOC)) {
            if ($cols === null) {
                $cols = array_map(fn($c) => "`$c`", array_keys($fila));
            }
            $vals = array_map(function ($v) use ($pdo) {
                if ($v === null) return 'NULL';
                return $pdo->quote($v);
            }, array_values($fila));
            $buffer[] = "(" . implode(',', $vals) . ")";
            // Insertar por lotes de 100 filas
            if (count($buffer) >= 100) {
                $out .= "INSERT INTO `$tabla` (" . implode(',', $cols) . ") VALUES\n" . implode(",\n", $buffer) . ";\n";
                $buffer = [];
            }
        }
        if (!empty($buffer)) {
            $out .= "INSERT INTO `$tabla` (" . implode(',', $cols) . ") VALUES\n" . implode(",\n", $buffer) . ";\n";
        }
        $out .= "\n";
    }

    $out .= "SET FOREIGN_KEY_CHECKS=1;\n";
    return $out;
}

/* ───────────────────────────────────────────────
   INFO: estado del respaldo (JSON)
─────────────────────────────────────────────── */
if ($action === 'info') {
    try {
        $tablas = $pdo->query("SHOW TABLES")->fetchAll(PDO::FETCH_COLUMN);
        $total = 0;
        foreach ($tablas as $t) {
            $total += (int)$pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
        }
        responder([
            'ok' => true,
            'tablas' => count($tablas),
            'registros' => $total,
            'fecha' => date('Y-m-d H:i:s'),
        ]);
    } catch (\Throwable $e) {
        responder(['error' => $e->getMessage()], 500);
    }
}

/* ───────────────────────────────────────────────
   DB: descargar solo la base de datos (.sql)
─────────────────────────────────────────────── */
if ($action === 'db') {
    try {
        $sql = generarDumpSQL($pdo, $db);
        $nombre = 'backup_integrados_' . date('Y-m-d_His') . '.sql';
        auditar($pdo, 'descargar', 'respaldo', "Respaldo de base de datos descargado: $nombre", '');
        // Limpiar cualquier salida previa (cabeceras JSON de config)
        if (ob_get_length()) ob_end_clean();
        header_remove('Content-Type');
        header('Content-Type: application/sql; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . $nombre . '"');
        header('Content-Length: ' . strlen($sql));
        echo $sql;
        exit;
    } catch (\Throwable $e) {
        responder(['error' => 'No se pudo generar el respaldo: ' . $e->getMessage()], 500);
    }
}

/* ───────────────────────────────────────────────
   FULL: descargar BD + archivos del sistema (.zip)
─────────────────────────────────────────────── */
if ($action === 'full') {
    try {
        $sql = generarDumpSQL($pdo, $db);
        auditar($pdo, 'descargar', 'respaldo', 'Respaldo completo (BD + archivos) descargado', '');

        // Carpeta raíz del sistema (un nivel arriba de /api)
        $raiz = realpath(__DIR__ . '/..');
        $excluir = ['/backups/', '/.git/', '/node_modules/', '/vendor/'];

        // Recopilar la lista de archivos a incluir.
        $archivos = []; // rutaAbsoluta => rutaRelativaDentroDelPaquete
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($raiz, FilesystemIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );
        foreach ($it as $archivo) {
            $ruta = $archivo->getPathname();
            $rel  = substr($ruta, strlen($raiz) + 1);
            $relUnix = '/' . str_replace('\\', '/', $rel);
            $saltar = false;
            foreach ($excluir as $ex) { if (strpos($relUnix, $ex) !== false) { $saltar = true; break; } }
            if ($saltar) continue;
            if ($archivo->getSize() > 20 * 1024 * 1024) continue;
            $archivos[$ruta] = 'sistema/' . str_replace('\\', '/', $rel);
        }

        // ── Opción A: ZIP (si la extensión está disponible) ──
        if (class_exists('ZipArchive')) {
            $tmpZip = tempnam(sys_get_temp_dir(), 'bkp') . '.zip';
            $zip = new ZipArchive();
            if ($zip->open($tmpZip, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
                responder(['error' => 'No se pudo crear el archivo ZIP'], 500);
            }
            $zip->addFromString('base_de_datos.sql', $sql);
            foreach ($archivos as $abs => $rel) { $zip->addFile($abs, $rel); }
            $zip->close();

            $nombre = 'backup_completo_integrados_' . date('Y-m-d_His') . '.zip';
            if (ob_get_length()) ob_end_clean();
            header_remove('Content-Type');
            header('Content-Type: application/zip');
            header('Content-Disposition: attachment; filename="' . $nombre . '"');
            header('Content-Length: ' . filesize($tmpZip));
            readfile($tmpZip);
            @unlink($tmpZip);
            exit;
        }

        // ── Opción B: TAR.GZ con PharData (nativo, no necesita la extensión ZIP) ──
        if (class_exists('PharData')) {
            $base = tempnam(sys_get_temp_dir(), 'bkp');
            @unlink($base);
            $tarPath = $base . '.tar';

            $phar = new PharData($tarPath);
            $phar->addFromString('base_de_datos.sql', $sql);
            foreach ($archivos as $abs => $rel) { $phar->addFile($abs, $rel); }

            if (function_exists('gzopen')) {
                $phar->compress(Phar::GZ);      // genera $tarPath.gz
                unset($phar);
                @unlink($tarPath);              // borrar el .tar sin comprimir
                $entrega = $tarPath . '.gz';
                $nombre  = 'backup_completo_integrados_' . date('Y-m-d_His') . '.tar.gz';
                $mime    = 'application/gzip';
            } else {
                unset($phar);
                $entrega = $tarPath;
                $nombre  = 'backup_completo_integrados_' . date('Y-m-d_His') . '.tar';
                $mime    = 'application/x-tar';
            }

            if (ob_get_length()) ob_end_clean();
            header_remove('Content-Type');
            header('Content-Type: ' . $mime);
            header('Content-Disposition: attachment; filename="' . $nombre . '"');
            header('Content-Length: ' . filesize($entrega));
            readfile($entrega);
            @unlink($entrega);
            exit;
        }

        responder(['error' => 'El servidor no puede empaquetar archivos. Usa el respaldo de solo base de datos (.sql).'], 500);

    } catch (\Throwable $e) {
        responder(['error' => 'No se pudo generar el respaldo completo: ' . $e->getMessage()], 500);
    }
}

/* ───────────────────────────────────────────────
   LISTAR_AUTO: ver los respaldos automáticos guardados en el servidor
─────────────────────────────────────────────── */
if ($action === 'listar_auto') {
    $carpetaBackups = realpath(__DIR__ . '/..') . '/backups';
    $lista = [];
    if (is_dir($carpetaBackups)) {
        foreach (glob($carpetaBackups . '/auto_*.sql') as $archivo) {
            $lista[] = [
                'nombre' => basename($archivo),
                'fecha'  => date('Y-m-d H:i:s', filemtime($archivo)),
                'tamano_mb' => round(filesize($archivo) / 1024 / 1024, 2),
            ];
        }
    }
    usort($lista, fn($a, $b) => strcmp($b['nombre'], $a['nombre']));
    responder(['ok' => true, 'respaldos' => $lista]);
}

/* ───────────────────────────────────────────────
   DESCARGAR_AUTO: bajar un respaldo automático específico
─────────────────────────────────────────────── */
if ($action === 'descargar_auto') {
    $nombre = basename($_GET['nombre'] ?? ''); // basename() evita salir de la carpeta
    if (!$nombre || !preg_match('/^auto_[0-9_-]+\.sql$/', $nombre)) {
        responder(['error' => 'Nombre de archivo inválido'], 400);
    }
    $ruta = realpath(__DIR__ . '/..') . '/backups/' . $nombre;
    if (!file_exists($ruta)) responder(['error' => 'Ese respaldo ya no existe'], 404);

    auditar($pdo, 'descargar', 'respaldo', "Respaldo automático descargado: $nombre", '');
    if (ob_get_length()) ob_end_clean();
    header_remove('Content-Type');
    header('Content-Type: application/sql; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $nombre . '"');
    header('Content-Length: ' . filesize($ruta));
    readfile($ruta);
    exit;
}

responder(['error' => 'Acción no válida'], 400); 