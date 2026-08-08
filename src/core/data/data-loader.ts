/**
 * DATA LOADER — Importa datos semilla al SSOT Engine
 *
 * Lee menu-seed.json y lo convierte al formato interno (MenuItem[])
 * para cargarlo en el MenuEngine al iniciar la app.
 *
 * Artículo I: SSOT — El JSON semilla es la fuente, el engine es el runtime.
 * Artículo IV: Simplicidad — Carga plana, sin transformaciones complejas.
 *
 * Escalable:
 *   - Agregar un nuevo item al JSON → se carga automáticamente
 *   - Editar desde Admin → se persiste en DB y se sincroniza
 *   - El JSON semilla SOLO se usa para primera carga
 */

import type { MenuItem, MenuCategory } from '../types';
import seedData from './menu-seed.json';

interface SeedItem {
  id: string;
  nombre: string;
  subtitulo?: string;
  descripcion?: string;
  ingredientes?: string[];
  decoracion_garnish?: string[];
  receta_tecnica?: {
    base?: string;
    mezcla?: string[];
  };
  precio?: number | null;
  precios?: Record<string, number | null>;
  area?: string;
  tiene_ice?: boolean;
  imagen?: string;
}

interface SeedCategory {
  nombre_categoria: string;
  variantes_tamanos?: string[];
  items: SeedItem[];
}

// ============================================================
// CONFIG — Moneda
// ============================================================

const CURRENCY = 'BOB';
const IVA_PERCENTAGE = 13;

// ============================================================
// LOADER
// ============================================================

let _loaded = false;

export function loadSeedData(): { categories: MenuCategory[]; items: MenuItem[] } {
  if (_loaded) {
    console.warn('[DataLoader] Seed data already loaded, skipping');
  }

  const categories: MenuCategory[] = [];
  const items: MenuItem[] = [];

  const areas = ['BAR', 'COCINA'] as const;
  let sortOrder = 0;
  let categorySort = 0;

  for (const areaKey of areas) {
    // El JSON semilla tiene formas heterogéneas (con/sin subtitulo, precio vs precios…):
    // se tipa contra SeedCategory/SeedItem (todos los campos opcionales) para poder
    // acceder a cualquier campo sin romper la carga.
    const area = seedData.restobar.menu[areaKey] as { categorias: SeedCategory[] } | undefined;
    if (!area) continue;

    for (const cat of area.categorias) {
      const categoryId = `cat-${areaKey.toLowerCase()}-${cat.nombre_categoria
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '')}`;

      // Crear categoría
      categories.push({
        id: categoryId,
        name: cat.nombre_categoria,
        description: cat.nombre_categoria,
        emoji: areaKey === 'BAR' ? '🍺' : '🍽️',
        sortOrder: categorySort++,
        isActive: true,
      });

      // Crear items
      for (const seedItem of cat.items) {
        const item: MenuItem = {
          id: seedItem.id,
          categoryId,
          name: seedItem.nombre,
          subtitle: seedItem.subtitulo,
          description: seedItem.descripcion || seedItem.nombre,
          price: seedItem.precio ?? null,
          currency: CURRENCY,
          ivaPercentage: IVA_PERCENTAGE,
          imageUrl: seedItem.imagen
            ? (areaKey === 'BAR'
                ? `/menu-photos/micheladas/${seedItem.imagen}`
                : `/menu-photos/categorias/${seedItem.imagen}`)
            : null,
          isActive: true,
          isAvailable: true,
          modifierGroups: [],
          tags: [],
          preparationTime: areaKey === 'BAR' ? 5 : 15,
          sortOrder: sortOrder++,
          area: (seedItem.area as 'bar' | 'cocina') || (areaKey === 'BAR' ? 'bar' : 'cocina'),
          ingredientes: seedItem.ingredientes,
          garnish: seedItem.decoracion_garnish,
          receta_tecnica: seedItem.receta_tecnica,
          sizeVariants: seedItem.precios || undefined,
          hasIce: seedItem.tiene_ice ?? false,
        };

        // Si tiene variantes de tamaño, crear modificadores
        if (cat.variantes_tamanos && cat.variantes_tamanos.length > 0) {
          item.modifierGroups.push({
            id: `${seedItem.id}-size`,
            name: 'Tamaño',
            type: 'select',
            required: true,
            min: 1,
            max: 1,
            options: cat.variantes_tamanos.map((size, idx) => {
              const sizeKey = size.toLowerCase();
              const priceAdjust = seedItem.precios?.[sizeKey] || 0;
              return {
                id: `${seedItem.id}-size-${idx}`,
                name: size,
                priceAdjustment: typeof priceAdjust === 'number' ? priceAdjust : 0,
                isDefault: idx === 0,
                sortOrder: idx,
              };
            }),
            sortOrder: 0,
          });
        }

        items.push(item);
      }
    }
  }

  _loaded = true;
  console.log(`[DataLoader] Loaded ${categories.length} categories, ${items.length} items`);
  return { categories, items };
}

/**
 * Carga los datos semilla en el MenuEngine
 * Se llama desde bootstrap o desde la primera carga de la app
 */
export function loadSeedToEngine(): void {
  const { categories, items } = loadSeedData();

  // Dynamic import de engine para evitar circular deps
  import('../engine/MenuEngine').then(({ default: menuEngine }) => {
    menuEngine.importCategories(categories);
    menuEngine.importItems(items);
    console.log(`[DataLoader] Seed data loaded into MenuEngine: ${items.length} items`);
  });
}

export default loadSeedData;
