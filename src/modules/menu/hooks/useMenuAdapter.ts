/**
 * useMenuAdapter — Import menu from CSV/JSON into the engine
 *
 * Handles:
 * - CSV/JSON import
 * - Auto-categorization
 * - Price processing with IVA
 * - Modifier group linking
 */

import { useState, useCallback } from 'react';
import { menuEngine } from '@/core/engine';
import { appConfig } from '@/core/config';
import type { MenuCategory, MenuItem, ModifierGroup, ModifierOption, ModifierType } from '@/core/types';

export interface ImportResult {
  success: boolean;
  categoriesImported: number;
  itemsImported: number;
  errors: string[];
}

export interface MenuImportRow {
  /** Category name (will be auto-created if not exists) */
  category?: string;
  /** Product name */
  name: string;
  /** Description */
  description?: string;
  /** Price with IVA included (BOB) */
  price: number;
  /** Comma-separated tags */
  tags?: string;
  /** Modifier groups as JSON string or pipe-separated */
  modifiers?: string;
  /** Preparation time in minutes */
  preparationTime?: number;
}

/** Forma de un grupo de modificadores importado (JSON parseado del row) */
interface ImportedModifierGroup {
  name?: string;
  type?: string;
  required?: boolean;
  min?: number;
  max?: number;
  options?: ImportedModifierOption[];
}

/** Forma de una opción de modificador importada (JSON parseado del row) */
interface ImportedModifierOption {
  name?: string;
  priceAdjustment?: number;
  isDefault?: boolean;
}

/**
 * Hook to import menu data into the engine
 */
export function useMenuAdapter() {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  /**
   * Import menu items from an array of rows
   */
  const importFromArray = useCallback((rows: MenuImportRow[]): ImportResult => {
    setImporting(true);
    const errors: string[] = [];
    let catCount = 0;
    let itemCount = 0;

    try {
      // Process categories first
      const categoryNames = [...new Set(rows.filter(r => r.category).map(r => r.category as string))];
      categoryNames.forEach((name, index) => {
        const catId = `cat-import-${index}-${Date.now()}`;
        const category: MenuCategory = {
          id: catId,
          name,
          description: '',
          emoji: '🍽',
          sortOrder: index,
          isActive: true,
        };
        menuEngine.setCategory(category);
        catCount++;
      });

      // Process items
      rows.forEach((row, index) => {
        try {
          if (!row.name) {
            errors.push(`Row ${index + 1}: missing name`);
            return;
          }

          // Find category
          const cats = menuEngine.getCategories();
          const category = row.category
            ? cats.find(c => c.name === row.category)
            : null;

          // Parse tags
          const tags = row.tags
            ? row.tags.split(',').map(t => t.trim()).filter(Boolean)
            : [];

          // Parse modifiers (JSON string or simple pipe format)
          const modifierGroups: ModifierGroup[] = [];
          if (row.modifiers) {
            try {
              // Try JSON first
              const parsed = JSON.parse(row.modifiers);
              if (Array.isArray(parsed)) {
                (parsed as ImportedModifierGroup[]).forEach((g, gi) => {
                  modifierGroups.push({
                    id: `mod-group-${index}-${gi}`,
                    name: g.name || `Grupo ${gi + 1}`,
                    type: (g.type as ModifierType) || 'select',
                    required: g.required || false,
                    min: g.min || (g.required ? 1 : 0),
                    max: g.max || 1,
                    options: (g.options ?? []).map((o, oi) => ({
                      id: `mod-opt-${index}-${gi}-${oi}`,
                      name: o.name || `Opción ${oi + 1}`,
                      priceAdjustment: o.priceAdjustment || 0,
                      isDefault: o.isDefault || false,
                      sortOrder: oi,
                    })),
                    sortOrder: gi,
                  });
                });
              }
            } catch {
              // Pipe format: "Tamaño: Grande+5|Chica-3"
              row.modifiers.split('|').forEach((groupStr, gi) => {
                const [groupName, ...optionsStr] = groupStr.split(':');
                if (groupName && optionsStr.length > 0) {
                  const options: ModifierOption[] = optionsStr[0].split(',').map((optStr, oi) => {
                    const [optName, priceStr] = optStr.split('+').length > 1
                      ? optStr.split('+')
                      : optStr.split('-').length > 1
                        ? [optStr.split('-')[0], `-${optStr.split('-')[1]}`]
                        : [optStr, '0'];
                    return {
                      id: `mod-opt-${index}-${gi}-${oi}`,
                      name: optName.trim(),
                      priceAdjustment: parseFloat(priceStr) || 0,
                      isDefault: oi === 0,
                      sortOrder: oi,
                    };
                  });

                  modifierGroups.push({
                    id: `mod-group-${index}-${gi}`,
                    name: groupName.trim(),
                    type: 'select',
                    required: true,
                    min: 1,
                    max: 1,
                    options,
                    sortOrder: gi,
                  });
                }
              });
            }
          }

          // Calculate IVA
          const ivaPct = appConfig.all.taxes.iva.percentage;

          const item: MenuItem = {
            id: `item-import-${index}-${Date.now()}`,
            categoryId: category?.id || '',
            name: row.name,
            description: row.description || '',
            price: Math.round(row.price * 100) / 100,
            currency: appConfig.all.currency.code,
            ivaPercentage: ivaPct,
            imageUrl: null,
            isActive: true,
            isAvailable: true,
            modifierGroups,
            tags,
            preparationTime: row.preparationTime || 10,
            sortOrder: index,
          };

          menuEngine.setItem(item);
          itemCount++;
        } catch (err) {
          errors.push(`Row ${index + 1} ("${row.name}"): ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      });

      const res: ImportResult = {
        success: errors.length === 0,
        categoriesImported: catCount,
        itemsImported: itemCount,
        errors,
      };
      setResult(res);
      return res;
    } finally {
      setImporting(false);
    }
  }, []);

  /**
   * Parse CSV text into rows (simple parser for menu CSV)
   */
  const importFromCSV = useCallback((csvText: string): ImportResult => {
    const lines = csvText.split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      const err: ImportResult = { success: false, categoriesImported: 0, itemsImported: 0, errors: ['CSV must have header + data rows'] };
      setResult(err);
      return err;
    }

    // Parse header
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const rows: MenuImportRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row: MenuImportRow = {
        name: values[header.indexOf('name')] || `Item ${i}`,
        category: header.includes('category') ? values[header.indexOf('category')] : undefined,
        description: header.includes('description') ? values[header.indexOf('description')] : undefined,
        price: header.includes('price') ? parseFloat(values[header.indexOf('price')]) || 0 : 0,
        tags: header.includes('tags') ? values[header.indexOf('tags')] : undefined,
        modifiers: header.includes('modifiers') ? values[header.indexOf('modifiers')] : undefined,
        preparationTime: header.includes('preparation_time') ? parseInt(values[header.indexOf('preparation_time')]) || 10 : 10,
      };
      rows.push(row);
    }

    return importFromArray(rows);
  }, [importFromArray]);

  /**
   * Reset and clear all menu data
   */
  const resetMenu = useCallback(() => {
    // Through the engine, clear all items
    menuEngine.getItems().forEach(item => menuEngine.removeItem(item.id));
    menuEngine.getCategories().forEach(cat => menuEngine.removeCategory(cat.id));
    setResult(null);
  }, []);

  return {
    importFromArray,
    importFromCSV,
    importFromJSON: importFromArray, // Alias
    resetMenu,
    importing,
    result,
  };
}

export default useMenuAdapter;
