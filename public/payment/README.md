# QR de Pago del Restobar

Coloca aquí la imagen **estática** del QR de pago (banco / billetera digital)
que el cliente escaneará para pagar con método QR.

**Nombre esperado:** `qr.png` (o actualiza `src/core/config/app.config.ts` → `payments.qrImageUrl`)

**Pasos para activar el QR:**
1. Copia tu imagen de QR aquí como `qr.png`
2. En `src/core/config/app.config.ts` → `payments` → pon `qrEnabled: true`
3. Rebuild + deploy (`npm run build` + reiniciar el server)

**Nota:** El QR es una imagen ESTÁTICA fija (no varía por monto). El cliente
escanee, transfiere el monto mostrado, y el mesero toma foto del comprobante
(📷) que se guarda en el servidor enlazada a la transacción.
