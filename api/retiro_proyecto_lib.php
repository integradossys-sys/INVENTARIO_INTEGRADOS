<?php
/* Marca como "retirado" lo que quedó registrado en un Cliente/Proyecto cuando el
   equipo (OLT / equipo / ONT) se recoge o sale de ese cliente. Así en la vista del
   cliente se ve qué hay HOY y qué ya se retiró. Nunca rompe el flujo principal. */

function marcarRetiradoEnProyecto(PDO $pdo, string $ref, string $nombreLike, ?string $snLike, string $cliente, string $usuario, string $motivo): void {
    $cliente = trim($cliente);
    if ($cliente === '') return;
    try {
        $sql = "SELECT id FROM historial
                WHERE proyecto_cliente = ? AND ref = ? AND es_gasto = 1 AND origen = 'instalacion'
                  AND (retirado IS NULL OR retirado = 0) AND (anulado IS NULL OR anulado = 0)
                  AND nombre LIKE ?";
        $par = [$cliente, $ref, $nombreLike . '%'];
        if ($snLike !== null && $snLike !== '') { $sql .= " AND (nombre LIKE ? OR descripcion LIKE ?)"; $par[] = '%SN ' . $snLike . '%'; $par[] = '%SN ' . $snLike . '%'; }
        $sql .= " ORDER BY id DESC LIMIT 1";
        $st = $pdo->prepare($sql); $st->execute($par);
        $id = $st->fetchColumn();
        if ($id) {
            $pdo->prepare("UPDATE historial SET retirado = 1, retirado_motivo = ?, retirado_por = ?, retirado_en = NOW() WHERE id = ?")
                ->execute([mb_substr($motivo, 0, 300), $usuario, $id]);
        }
    } catch (\Throwable $e) { error_log('[marcarRetiradoEnProyecto] ' . $e->getMessage()); }
}

/* ONT: se llama ANTES de actualizar la fila (todavía tiene el cliente). */
function retirarOntDeCliente(PDO $pdo, int $ontId, ?string $estadoAntes, ?string $estadoNuevo, string $usuario): void {
    if ($estadoAntes !== 'comodato' || $estadoNuevo === null || in_array($estadoNuevo, ['comodato','ocupado'], true)) return;
    try {
        $st = $pdo->prepare("SELECT modelo, sn, cliente_nombre FROM ont_seriales WHERE id = ?");
        $st->execute([$ontId]); $o = $st->fetch();
        if (!$o || empty($o['cliente_nombre'])) return;
        marcarRetiradoEnProyecto($pdo, 'ONT::' . ($o['modelo'] ?: ''), 'ONT ' . ($o['modelo'] ?: ''), $o['sn'] ?: null, $o['cliente_nombre'], $usuario,
            'Retirada del cliente (estado: ' . $estadoNuevo . ')');
    } catch (\Throwable $e) { error_log('[retirarOntDeCliente] ' . $e->getMessage()); }
}