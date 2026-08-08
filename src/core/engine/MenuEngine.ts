/**
 * MENU ENGINE — SSOT for menu operations
 * 
 * Artículo I: SSOT — All menu data passes through here
 * Artículo II: ZERO HARDCODED — Prices include IVA dynamically
 * 
 * Menú items, categories, modifiers, pricing with IVA.
 */

import type { MenuItem, MenuCategory, ModifierOption } from '../types';

class MenuEngine {
  private categories: Map<string, MenuCategory> = new Map();
  private items: Map<string, MenuItem> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor() {
    // Start empty — menu data comes from DB/sync
  }

  // ============================================================
  // CATEGORIES
  // ============================================================

  /** Get all active categories sorted */
  getCategories(): MenuCategory[] {
    return Array.from(this.categories.values())
      .filter(c => c.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /** Get category by ID */
  getCategory(id: string): MenuCategory | undefined {
    return this.categories.get(id);
  }

  /** Add or update category */
  setCategory(category: MenuCategory): void {
    this.categories.set(category.id, category);
    this._notify();
  }

  /** Remove category */
  removeCategory(id: string): void {
    this.categories.delete(id);
    this._notify();
  }

  // ============================================================
  // MENU ITEMS
  // ============================================================

  /** Get all active menu items sorted */
  getItems(): MenuItem[] {
    return Array.from(this.items.values())
      .filter(i => i.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /** Get items by category */
  getItemsByCategory(categoryId: string): MenuItem[] {
    return this.getItems().filter(i => i.categoryId === categoryId);
  }

  /** Get single menu item */
  getItem(id: string): MenuItem | undefined {
    return this.items.get(id);
  }

  /** Add or update menu item */
  setItem(item: MenuItem): void {
    this.items.set(item.id, item);
    this._notify();
  }

  /** Remove item */
  removeItem(id: string): void {
    this.items.delete(id);
    this._notify();
  }

  /** Toggle availability */
  toggleAvailability(id: string): void {
    const item = this.items.get(id);
    if (item) {
      item.isAvailable = !item.isAvailable;
      this._notify();
    }
  }

  // ============================================================
  // PRICING
  // ============================================================

  /** Calculate price breakdown for an item */
  getPriceBreakdown(itemId: string, modifierIds: string[] = []) {
    const item = this.items.get(itemId);
    if (!item) return null;

    let modifierAdjustment = 0;
    for (const group of item.modifierGroups) {
      for (const opt of group.options) {
        if (modifierIds.includes(opt.id) && opt.isDefault === false) {
          modifierAdjustment += opt.priceAdjustment;
        }
      }
    }

    const baseWithModifiers = item.price + modifierAdjustment;
    const ivaAmount = baseWithModifiers - (baseWithModifiers / (1 + item.ivaPercentage / 100));
    const priceWithoutIva = baseWithModifiers - ivaAmount;

    return {
      basePrice: item.price,
      modifierAdjustment,
      totalWithIva: baseWithModifiers,
      ivaAmount: Math.round(ivaAmount * 100) / 100,
      ivaPercentage: item.ivaPercentage,
      priceWithoutIva: Math.round(priceWithoutIva * 100) / 100,
    };
  }

  /** Calculate total for a list of item quantities */
  calculateSubtotal(items: { itemId: string; quantity: number; modifierIds: string[] }[]) {
    let subtotal = 0;
    let totalIva = 0;

    for (const entry of items) {
      const breakdown = this.getPriceBreakdown(entry.itemId, entry.modifierIds);
      if (breakdown) {
        subtotal += breakdown.totalWithIva * entry.quantity;
        totalIva += breakdown.ivaAmount * entry.quantity;
      }
    }

    return {
      subtotal: Math.round(subtotal * 100) / 100,
      ivaAmount: Math.round(totalIva * 100) / 100,
      total: Math.round(subtotal * 100) / 100, // With IVA already included
    };
  }

  // ============================================================
  // MODIFIERS
  // ============================================================

  /** Get default modifiers for an item */
  getDefaultModifiers(itemId: string): ModifierOption[] {
    const item = this.items.get(itemId);
    if (!item) return [];

    return item.modifierGroups.flatMap(g => g.options.filter(o => o.isDefault));
  }

  /** Validate modifier selection for an item */
  validateModifiers(itemId: string, selectedModifierIds: string[]): {
    valid: boolean;
    errors: string[];
  } {
    const item = this.items.get(itemId);
    if (!item) return { valid: false, errors: ['Item not found'] };

    const errors: string[] = [];

    for (const group of item.modifierGroups) {
      const selected = selectedModifierIds.filter(id =>
        group.options.some(o => o.id === id)
      );

      if (group.required && selected.length < group.min) {
        errors.push(`"${group.name}" requires at least ${group.min} option(s)`);
      }

      if (selected.length > group.max) {
        errors.push(`"${group.name}" allows maximum ${group.max} option(s)`);
      }

      if (group.type === 'select' && selected.length > 1) {
        errors.push(`"${group.name}" allows only one option`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // ============================================================
  // DATA MANAGEMENT
  // ============================================================

  /** Bulk import items (from sync/DB) */
  importItems(items: MenuItem[]): void {
    items.forEach(item => this.items.set(item.id, item));
    this._notify();
  }

  /** Bulk import categories */
  importCategories(categories: MenuCategory[]): void {
    categories.forEach(cat => this.categories.set(cat.id, cat));
    this._notify();
  }

  /** Export all data for sync */
  exportState() {
    return {
      categories: Array.from(this.categories.values()),
      items: Array.from(this.items.values()),
    };
  }

  onChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private _notify(): void {
    this.listeners.forEach(cb => cb());
  }
}

const menuEngine = new MenuEngine();
export default menuEngine;
export { MenuEngine };
