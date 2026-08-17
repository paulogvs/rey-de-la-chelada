/**
 * ItemDetailModal — Item detail with modifier (size) selection.
 *
 * Extracted from MenuPage so both stay under the 300-line rule.
 */

import React from 'react';
import type { MenuItem } from '@/core/types';
import { Badge } from '@/ui/components/Badge';
import { AppIcon } from '@/ui/components/AppIcon/AppIcon';
import { formatMoney } from '@/pwa/_shared/utils/format';
import './ItemDetailModal.css';

interface ItemDetailModalProps {
  item: MenuItem;
  onClose: () => void;
  onAdd: (item: MenuItem, modifierOptionIds: string[]) => void;
}

export function ItemDetailModal({ item, onClose, onAdd }: ItemDetailModalProps) {
  // Photo fallback: hide image and show a colored placeholder if it 404s
  const [imgError, setImgError] = React.useState(false);
  // Selected modifier option ids per group
  const [selectedMods, setSelectedMods] = React.useState<string[]>(() =>
    item.modifierGroups
      .flatMap(g => g.options)
      .filter(o => o.isDefault)
      .map(o => o.id)
  );
  const showImage = item.imageUrl && !imgError;

  const toggleMod = (optionId: string) => {
    setSelectedMods(prev =>
      prev.includes(optionId)
        ? prev.filter(id => id !== optionId)
        : [...prev, optionId]
    );
  };

  // Sprint 1 (B): items de precio manual "Consultar precio" son SOLO meseros.
  // El server los rechaza en clientes (PRICE_REQUIRED_MANUAL) — mostramos en
  // modo lectura y bloqueamos "Agregar al pedido" (defensivo: ya se filtran).
  const readOnlyManual = item.priceVariable === true;
  const effectivePrice = item.modifierGroups
    .flatMap(g => g.options)
    .filter(o => selectedMods.includes(o.id))
    .reduce((sum, o) => sum + (o.priceAdjustment ?? 0), (item.price ?? 0));

  return (
    <div className="clientes-detail-overlay" onClick={onClose}>
      <div className="clientes-detail" onClick={e => e.stopPropagation()}>
        <button className="clientes-detail__close" onClick={onClose} aria-label="Cerrar"><AppIcon name="x" size="sm" /></button>

        {showImage ? (
          <img
            src={item.imageUrl ?? ''}
            alt={item.name}
            className="clientes-detail__image"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="clientes-detail__image clientes-detail__image--placeholder" aria-hidden="true">
            {item.name.charAt(0)}
          </div>
        )}

        <h2 className="clientes-detail__name">{item.name}</h2>
        <p className="clientes-detail__desc">{item.description}</p>

        <div className="clientes-detail__price">
          {readOnlyManual ? 'Consultar precio' : effectivePrice > 0 ? formatMoney(effectivePrice) : '—'}
        </div>

        {readOnlyManual && (
          <p className="clientes-detail__manual-hint">
            Item de precio variable — pregunta al mesero para pedirlo.
          </p>
        )}

        {item.tags.length > 0 && (
          <div className="clientes-detail__tags">
            {item.tags.map(tag => (
              <Badge key={tag} variant="info">{tag}</Badge>
            ))}
          </div>
        )}

        {item.modifierGroups.length > 0 && (
          <div className="clientes-detail__modifiers">
            <h4>Elige tu variante:</h4>
            {item.modifierGroups.map(g => (
              <div key={g.id} className="clientes-detail__mod-group">
                <strong>{g.name}</strong>
                <div className="clientes-detail__mod-options">
                  {g.options.map(o => (
                    <button
                      key={o.id}
                      type="button"
                      className={`clientes-detail__mod-option ${
                        selectedMods.includes(o.id) ? 'selected' : ''
                      }`}
                      onClick={() => toggleMod(o.id)}
                    >
                      {o.name}
                      {o.priceAdjustment !== 0 && (
                        <span className="clientes-detail__mod-price">
                          {o.priceAdjustment > 0 ? '+' : ''}{formatMoney(o.priceAdjustment)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <button
          className="clientes-detail__add-btn"
          onClick={() => { onAdd(item, selectedMods); onClose(); }}
          disabled={readOnlyManual}
        >
          {readOnlyManual ? 'Solicitar en barra' : 'Agregar al pedido'}
        </button>
      </div>
    </div>
  );
}

export default ItemDetailModal;
