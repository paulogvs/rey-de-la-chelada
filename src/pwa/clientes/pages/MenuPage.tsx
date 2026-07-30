/**
 * PWA CLIENTES — Página de Menú Digital
 *
 * Siempre visible, incluso sin conexión (offline-first).
 * Muestra categorías y productos del menú.
 * Sin pedido activo: solo lectura.
 * Con pedido activo: botones de llamar mesero y pedir cuenta.
 */

import React, { useEffect, useState } from 'react';
import { menuEngine } from '@/core/engine';
import type { MenuCategory, MenuItem } from '@/core/types';
import { useTableSession } from '../hooks/useTableSession';
import './MenuPage.css';

export function MenuPage() {
  const session = useTableSession();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // Cargar menú
  useEffect(() => {
    function loadMenu() {
      setCategories(menuEngine.getCategories());
      setItems(menuEngine.getItems());
    }
    loadMenu();
    return menuEngine.onChange(loadMenu);
  }, []);

  // Categorías disponibles
  const cats = selectedCategory
    ? categories.filter(c => c.id === selectedCategory)
    : categories;

  const filteredItems = selectedCategory
    ? items.filter(i => i.categoryId === selectedCategory && i.isActive && i.isAvailable)
    : items.filter(i => i.isActive && i.isAvailable);

  return (
    <div className="clientes-page">
      {/* Header */}
      <header className="clientes-header">
        <div className="clientes-header__brand">
          <h1>Rey de la Chelada</h1>
          {session.tableNumber > 0 && (
            <span className="clientes-header__mesa">Mesa {session.tableNumber}</span>
          )}
        </div>
        {!session.isValid && session.error && (
          <div className="clientes-alert clientes-alert--error">
            {session.error}
          </div>
        )}
      </header>

      {/* Categorías */}
      <nav className="clientes-categories">
        <button
          className={`clientes-categories__btn ${!selectedCategory ? 'active' : ''}`}
          onClick={() => setSelectedCategory(null)}
        >
          Todo el Menú
        </button>
        {categories.filter(c => c.isActive).map(cat => (
          <button
            key={cat.id}
            className={`clientes-categories__btn ${selectedCategory === cat.id ? 'active' : ''}`}
            onClick={() => setSelectedCategory(cat.id)}
          >
            {cat.emoji} {cat.name}
          </button>
        ))}
      </nav>

      {/* Productos */}
      <section className="clientes-items">
        {cats.map(cat => {
          const catItems = filteredItems.filter(i => i.categoryId === cat.id);
          if (catItems.length === 0) return null;

          return (
            <div key={cat.id} className="clientes-category-group">
              {selectedCategory && (
                <h2 className="clientes-category-title">{cat.emoji} {cat.name}</h2>
              )}
              <div className="clientes-items__grid">
                {catItems.map(item => (
                  <div key={item.id} className="clientes-item-card">
                    <div className="clientes-item-card__info">
                      <h3>{item.name}</h3>
                      <p>{item.description}</p>
                      {item.tags.length > 0 && (
                        <div className="clientes-item-card__tags">
                          {item.tags.map(tag => (
                            <span key={tag} className="clientes-tag">{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="clientes-item-card__price">
                      <span className="clientes-price">
                        Bs. {item.price.toFixed(2)}
                      </span>
                      {item.modifierGroups.length > 0 && (
                        <span className="clientes-modifiers-hint">
                          + variantes
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* Acciones de cliente (solo si hay pedido activo) */}
      {session.canCallWaiter && (
        <footer className="clientes-actions">
          <button
            className="clientes-actions__btn clientes-actions__btn--call"
            onClick={() => session.callWaiter()}
          >
            Llamar Mesero
          </button>
          <button
            className="clientes-actions__btn clientes-actions__btn--bill"
            onClick={() => session.requestBill()}
          >
            Pedir Cuenta
          </button>
        </footer>
      )}

      {/* Modo solo lectura sin pedido */}
      {session.isReadOnly && !session.canCallWaiter && session.isValid && (
        <footer className="clientes-actions clientes-actions--readonly">
          <p>Escanea el QR cuando tengas un pedido activo para llamar al mesero.</p>
        </footer>
      )}
    </div>
  );
}
