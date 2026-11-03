<?php
/* ══════════════════════════════════════════════════════
   ont_sync.php — Integrados S&S

   NOTA IMPORTANTE: el sistema real de pedir/despachar ONTs
   específicas YA EXISTE y vive aparte del catálogo normal de
   productos, usando refs con formato "ONT::<modelo>" (ver
   api/pedidos.php, api/pedidos_agrupados.php, api/seguimiento.php
   y el carrito "Pedido múltiple al almacén" en dashboard.html).
   Las ONTs se manejan a propósito SIN una fila real en la tabla
   'productos', para no duplicar/confundir el conteo de stock con
   el sistema de series individuales (ont_seriales).

   Estas dos funciones se dejan definidas (sin efecto) solo para
   no romper llamadas ya existentes en el código.
══════════════════════════════════════════════════════ */

function ontAsegurarProducto($pdo, $modeloId, $nombreModelo) {
    return null;
}

function ontSincronizarStock($pdo, $nombreModelo) {
    // no-op intencional — ver nota arriba
}