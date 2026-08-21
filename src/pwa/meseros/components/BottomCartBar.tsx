import { formatMoney } from '../../_shared/utils/format';
import './BottomCartBar.css';

export interface BottomCartBarProps {
  quantity: number;
  total: number;
  onOpen: () => void;
}

export function BottomCartBar({ quantity, total, onOpen }: BottomCartBarProps) {
  return (
    <div className="bottom-cart-bar" role="status" aria-live="polite">
      <div className="bottom-cart-bar__info">
        <span className="bottom-cart-bar__qty">{quantity} unidades</span>
        <span className="bottom-cart-bar__sep" aria-hidden="true">|</span>
        <span className="bottom-cart-bar__total">Total {formatMoney(total)}</span>
      </div>
      <button
        type="button"
        className="bottom-cart-bar__cta"
        onClick={onOpen}
        aria-label="Ver pedido actual"
      >
        Ver pedido
      </button>
    </div>
  );
}

export default BottomCartBar;
