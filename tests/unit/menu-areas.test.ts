import { describe, it, expect } from 'vitest';
import {
  isPromosCategory,
  areaForCategory,
  groupCategoriesByArea,
  getCategoriesForArea,
  PROMOS_CATEGORY_NAME,
} from '@/pwa/_shared/utils/menuAreas';
import type { MenuCategory, MenuItem } from '@/pwa/_shared/api/menuApi';

function cat(id: string, name: string, area?: 'bar' | 'cocina' | null): MenuCategory {
  return {
    id,
    name,
    description: '',
    emoji: '🍽',
    sort_order: 0,
    is_active: 1,
    area,
  };
}

function item(id: string, categoryId: string, area: 'bar' | 'cocina' | null): MenuItem {
  return {
    id,
    name: `Item ${id}`,
    subtitle: null,
    description: '',
    price: 10,
    currency: 'BOB',
    iva_percentage: 13,
    image_url: null,
    is_active: 1,
    is_available: 1,
    preparation_time: 5,
    sort_order: 0,
    area,
    category_id: categoryId,
    category_name: '',
  };
}

describe('isPromosCategory', () => {
  it('detecta "Promociones" sin importar mayúsculas/espacios', () => {
    expect(isPromosCategory('Promociones')).toBe(true);
    expect(isPromosCategory('  PROMOCIONES  ')).toBe(true);
    expect(isPromosCategory('Cerveza Artesanal')).toBe(false);
    expect(isPromosCategory('')).toBe(false);
  });
});

describe('areaForCategory', () => {
  const items: MenuItem[] = [
    item('m1', 'cat-bar', 'bar'),
    item('m2', 'cat-cocina', 'cocina'),
    item('m3', 'cat-promos', 'bar'),
  ];

  it('Promociones → promos (sin depender del área de sus items)', () => {
    expect(areaForCategory('cat-promos', 'Promociones', items)).toBe('promos');
  });

  it('primer item cocina → cocina', () => {
    expect(areaForCategory('cat-cocina', 'Ensaladas', items)).toBe('cocina');
  });

  it('primer item bar → barra', () => {
    expect(areaForCategory('cat-bar', 'Micheladas Especiales', items)).toBe('barra');
  });

  it('categoría sin items → barra (default)', () => {
    expect(areaForCategory('cat-vacia', 'Categoría Vacía', items)).toBe('barra');
  });
});

describe('areaForCategory — v17 con category.area (autoridad del GRUPO)', () => {
  const items: MenuItem[] = [
    item('m1', 'cat-bar', 'bar'),
    item('m2', 'cat-mix', 'cocina'),
  ];

  it('category.area gana sobre el primer item', () => {
    // La categoría dice 'cocina' pero su primer item es 'bar' → manda el grupo.
    expect(areaForCategory('cat-mix', 'Mixtos', items, 'cocina')).toBe('cocina');
    expect(areaForCategory('cat-mix', 'Mixtos', items, 'bar')).toBe('barra');
  });

  it('sin category.area → fallback al primer item (comportamiento legacy)', () => {
    expect(areaForCategory('cat-mix', 'Mixtos', items)).toBe('cocina');
    expect(areaForCategory('cat-bar', 'Bar', items)).toBe('barra');
  });

  it('category.area null → fallback al primer item', () => {
    expect(areaForCategory('cat-mix', 'Mixtos', items, null)).toBe('cocina');
  });

  it('Promociones → promos SIEMPRE (independiente de category.area)', () => {
    expect(areaForCategory('cat-p', 'Promociones', items, 'bar')).toBe('promos');
  });
});

describe('getCategoriesForArea — v17 usa category.area para agrupar', () => {
  const categories = [
    cat('c1', 'Micheladas', 'bar'),
    cat('c2', 'Ensaladas', 'cocina'),
    cat('c3', 'Promociones', 'bar'),
  ];
  const items: MenuItem[] = [
    item('m1', 'c1', 'bar'),
    // c2 NO tiene item con area cocina (para probar que manda el área del grupo)
    item('m2', 'c2', 'bar'),
    item('m3', 'c3', 'bar'),
  ];

  it('agrupa por el area del GRUPO, no del primer item', () => {
    expect(getCategoriesForArea(categories, items, 'barra').map(c => c.id)).toEqual(['c1']);
    expect(getCategoriesForArea(categories, items, 'cocina').map(c => c.id)).toEqual(['c2']);
    expect(getCategoriesForArea(categories, items, 'promos').map(c => c.id)).toEqual(['c3']);
  });
});

describe('groupCategoriesByArea', () => {
  const categories = [
    cat('c1', 'Micheladas Especiales'),
    cat('c2', 'Cheladas'),
    cat('c3', 'Ensaladas'),
    cat('c4', 'Pizzas'),
    cat('c5', 'Promociones'),
  ];
  const items: MenuItem[] = [
    item('m1', 'c1', 'bar'),
    item('m2', 'c2', 'bar'),
    item('m3', 'c3', 'cocina'),
    item('m4', 'c4', 'cocina'),
    item('m5', 'c5', 'bar'),
  ];

  it('agrupa por área correctamente', () => {
    const grouped = groupCategoriesByArea(categories, items);
    expect(grouped.barra.map(c => c.name)).toEqual(['Micheladas Especiales', 'Cheladas']);
    expect(grouped.cocina.map(c => c.name)).toEqual(['Ensaladas', 'Pizzas']);
    expect(grouped.promos.map(c => c.name)).toEqual(['Promociones']);
  });

  it('devuelve arrays vacíos para áreas sin categorías', () => {
    const grouped = groupCategoriesByArea([cat('c1', 'Ensaladas')], [item('m1', 'c1', 'cocina')]);
    expect(grouped.barra).toEqual([]);
    expect(grouped.promos).toEqual([]);
    expect(grouped.cocina).toHaveLength(1);
  });
});

describe('getCategoriesForArea', () => {
  const categories = [
    cat('c1', 'Micheladas Especiales'),
    cat('c2', 'Ensaladas'),
    cat('c3', 'Promociones'),
  ];
  const items: MenuItem[] = [
    item('m1', 'c1', 'bar'),
    item('m2', 'c2', 'cocina'),
    item('m3', 'c3', 'bar'),
  ];

  it('filtra solo las categorías del área pedida preservando orden', () => {
    expect(getCategoriesForArea(categories, items, 'barra').map(c => c.id)).toEqual(['c1']);
    expect(getCategoriesForArea(categories, items, 'cocina').map(c => c.id)).toEqual(['c2']);
    expect(getCategoriesForArea(categories, items, 'promos').map(c => c.id)).toEqual(['c3']);
  });
});
