import { test, expect, type Page } from '@playwright/test';

/**
 * Flujo crítico de Meseros: login → seleccionar mesa → agregar item →
 * revisar carrito (desglose) → confirmar pedido → volver a mesas.
 *
 * Se ejecuta solo en desktop para no competir por la mesa de test entre
 * proyectos (el estado de la DB es compartido por el webServer).
 */

async function login(page: Page, pin: string) {
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

test('mesero arma un pedido, lo revisa y lo confirma', async ({ page, isMobile }) => {
  test.skip(isMobile, 'flujo de pedido validado en desktop (DB compartida entre proyectos)');

  await page.goto('/meseros/');
  await login(page, '1111');

  // Seleccionar la primera mesa libre.
  await page.locator('.table-card').first().click();
  await expect(page.getByRole('heading', { name: /Mesa \d+/, level: 1 })).toBeVisible();

  // Elegir un item con precio conocido (barra).
  await page.getByRole('button', { name: /Isla Dorada/ }).click();
  await page.getByRole('button', { name: /^Agregar/ }).click();

  // El carrito debe mostrar 1 unidad.
  await expect(page.getByText('1 unidades')).toBeVisible();

  // Confirmar y enviar (en móvil el carrito está colapsado; en desktop siempre visible).
  await page.getByRole('button', { name: 'Confirmar y enviar' }).click();

  // Al confirmar, vuelve a la vista de mesas.
  await expect(page.getByRole('heading', { name: 'Mesas', level: 1 })).toBeVisible();
});
