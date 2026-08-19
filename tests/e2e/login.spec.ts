import { test, expect } from '@playwright/test';

/**
 * Login por PIN en cada PWA de staff (meseros, caja, admin, cocina, bar).
 * Valida que cada rol entra a su pantalla y que el PIN incorrecto es rechazado.
 */

async function login(page: import('@playwright/test').Page, pin: string) {
  for (const digit of pin) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

const STAFF: Array<{ module: string; pin: string; heading: string }> = [
  { module: 'meseros', pin: '1111', heading: 'Mesas' },
  { module: 'caja', pin: '3333', heading: 'Caja' },
  { module: 'admin', pin: '0000', heading: 'Dashboard' },
  { module: 'cocina', pin: '2222', heading: 'Cocina' },
  { module: 'bar', pin: '2222', heading: 'Barra' },
];

for (const staff of STAFF) {
  test(`login ${staff.module} con PIN ${staff.pin}`, async ({ page }) => {
    await page.goto(`/${staff.module}/`);
    await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible();
    await login(page, staff.pin);
    await expect(page.getByRole('heading', { name: staff.heading, level: 1 })).toBeVisible();
  });
}

test('PIN incorrecto muestra error y no entra', async ({ page }) => {
  await page.goto('/meseros/');
  await login(page, '9999');
  await expect(page.getByText('PIN incorrecto')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mesas', level: 1 })).toBeHidden();
});
