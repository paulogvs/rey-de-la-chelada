import { describe, it, expect } from 'vitest';
import { normalizeSearchText, filterMenuItems } from '@/pwa/_shared/utils/filterMenuItems';

interface FakeItem {
  id: string;
  name: string;
  subtitle?: string | null;
  description?: string;
  categoryName?: string;
}

const items: FakeItem[] = [
  { id: '1', name: 'Negra Ahumada', subtitle: 'Cerveza artesanal oscura', description: 'Notas a café y cacao', categoryName: 'Cervezas Artesanales' },
  { id: '2', name: 'Chelada Clásica', description: 'Clásica con limón', categoryName: 'Micheladas de la Casa' },
  { id: '3', name: 'Michelada de la Casa', description: 'La firma de la casa', categoryName: 'Micheladas de la Casa' },
  { id: '4', name: 'Pizza Negra', description: 'Masa negra con hongos', categoryName: 'Pizzas' },
  { id: '5', name: 'Agua Mineral', categoryName: 'Bebidas' },
];

describe('normalizeSearchText', () => {
  it('minúsculas + sin acentos + trim', () => {
    expect(normalizeSearchText('  Micheláda  ')).toBe('michelada');
    expect(normalizeSearchText('CHELADA')).toBe('chelada');
  });
});

describe('filterMenuItems', () => {
  it('query vacía → devuelve todos', () => {
    expect(filterMenuItems(items, '')).toHaveLength(5);
    expect(filterMenuItems(items, '   ')).toHaveLength(5);
  });

  it('match parcial case-insensitive sin acentos', () => {
    const r = filterMenuItems(items, 'NEGRA');
    expect(r.map(i => i.id)).toEqual(['1', '4']); // Negra Ahumada + Pizza Negra
  });

  it('prefijo de nombre gana (orden: empieza por nombre > contiene > resto)', () => {
    const r = filterMenuItems(items, 'michelada');
    // "Michelada de la Casa" (empieza) antes que "Chelada Clásica" (contiene "chelada" pero no prefijo de michelada)
    expect(r[0].id).toBe('3');
    expect(r.map(i => i.id)).toEqual(['3', '2']);
  });

  it('busca en subtítulo y descripción', () => {
    const r = filterMenuItems(items, 'artesanal');
    expect(r.map(i => i.id)).toEqual(['1']); // vía subtitle
    const r2 = filterMenuItems(items, 'hongos');
    expect(r2.map(i => i.id)).toEqual(['4']); // vía description
  });

  it('busca por nombre de categoría', () => {
    const r = filterMenuItems(items, 'pizzas');
    expect(r.map(i => i.id)).toEqual(['4']);
  });

  it('sin matches → array vacío', () => {
    expect(filterMenuItems(items, 'zzzzz')).toHaveLength(0);
  });
});
