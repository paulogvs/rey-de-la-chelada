# Motor financiero SSOT: pagos mixed

## Contrato

Todos los importes financieros del servidor son `INTEGER` en centavos de Bs.
`amount` es el importe aplicado al saldo. Solo existen `cash` y `qr`.

`POST /api/payments` conserva el contrato legacy. Acepta `idempotency_key` opcional
y delega sus invariantes a `server/services/financial/payment-service.js`.

`POST /api/payments/mixed` requiere:

```json
{
  "order_id": "order-uuid",
  "idempotency_key": "client-operation-uuid",
  "allocations": [
    { "method": "cash", "amount": 4000, "received": 5000 },
    { "method": "qr", "amount": 6000, "reference": "bank-reference" }
  ]
}
```

La transacción crea una fila en `payment_operations` y un pago por allocation.
La clave de idempotencia es única. Repetirla para la misma orden devuelve el
resultado original sin crear pagos; reutilizarla para otra orden es conflicto.
El servidor calcula `change = received - amount`, rechaza negativos, fracciones
de centavo, `received` en QR, y cualquier allocation que exceda el saldo.

La respuesta mixed incluye `order_total`, `paid_amount`, `remaining`,
`is_fully_paid`, `by_method` y `payments`. Los pagos completados son los únicos
que cuentan para saldo, reportes y estado `paid`.

## Comprobantes

`POST /api/payments/:id/proof` sigue aceptando temporalmente data URLs JSON para
compatibilidad. Valida MIME, magic bytes, base64, nombre derivado de UUID y
límite de 8 MiB. Registra metadata en `payment_proofs`, incluyendo SHA-256 y
`payment_id`.

`GET /api/payments/:id/proof` devuelve metadata y
`GET /api/payments/:id/proof/content` devuelve el contenido. Ambos requieren
autenticación y roles `admin`, `mesero` o `caja`. El directorio de comprobantes
no se expone como static público.

## Migración

Schema v12 agrega `payment_operations`, `payment_proofs`, índices por orden/pago
y `payments.payment_operation_id`. La aplicación usa `IF NOT EXISTS` y `ALTER`
defensivo para poder reparar una base parcialmente actualizada sin borrar datos.

El push offline reutiliza `payment-service`; sus precios, centavos, saldo,
