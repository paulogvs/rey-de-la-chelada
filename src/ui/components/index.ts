/**
 * UI Components — Barrel Export
 *
 * Import from this barrel, never from individual files:
 *   import { Button, Card, Badge } from '@/ui/components';
 */

export { Button } from './Button/Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button/Button';

export { Card, CardSkeleton } from './Card/Card';
export type { CardProps, CardStatus } from './Card/Card';

export { Badge, BadgeSkeleton } from './Badge/Badge';
export type { BadgeProps, BadgeVariant } from './Badge/Badge';

export { PriceDisplay } from './PriceDisplay/PriceDisplay';
export type { PriceDisplayProps } from './PriceDisplay/PriceDisplay';

export { KDSOrderCard, KDSOrderCardSkeleton } from './KDSOrderCard/KDSOrderCard';
export type { KDSOrderCardProps } from './KDSOrderCard/KDSOrderCard';

export { TableStatusIcon } from './TableStatusIcon/TableStatusIcon';
export type { TableStatusIconProps, IconShape } from './TableStatusIcon/TableStatusIcon';

export { ToastProvider, useToast, ToastInline } from './Toast/Toast';
export type { ToastItem, ToastType } from './Toast/Toast';

export { Modal } from './Modal/Modal';
export type { ModalProps } from './Modal/Modal';

export { QuantityStepper } from './QuantityStepper/QuantityStepper';
export type { QuantityStepperProps } from './QuantityStepper/QuantityStepper';

export { QRDisplay } from './QRDisplay/QRDisplay';
export type { QRDisplayProps } from './QRDisplay/QRDisplay';

export { MenuItemCard, MenuItemCardSkeleton, MenuItemCardEmpty } from './MenuItemCard/MenuItemCard';
export type { MenuItemCardProps } from './MenuItemCard/MenuItemCard';

export { KDSBoard } from './KDSBoard/KDSBoard';
export type { KDSBoardProps } from './KDSBoard/KDSBoard';
export { filterItemsByModule } from './KDSBoard/filter';
export type { KDSModule } from './KDSBoard/filter';

export { NavBar } from './NavBar/NavBar';
export type { NavBarProps } from './NavBar/NavBar';

export { AppHeader } from './AppHeader/AppHeader';
export type { AppHeaderProps } from './AppHeader/AppHeader';

export { StatCard } from './StatCard/StatCard';
export type { StatCardProps } from './StatCard/StatCard';

export { SegmentedControl } from './SegmentedControl/SegmentedControl';
export type { SegmentedControlProps, SegmentedOption } from './SegmentedControl/SegmentedControl';

export { IconButton } from './IconButton/IconButton';
export type { IconButtonProps } from './IconButton/IconButton';

export { AppIcon } from './AppIcon/AppIcon';
export type { AppIconProps, AppIconName, AppIconSize } from './AppIcon/AppIcon';

export { MoneyInput } from './MoneyInput/MoneyInput';
export type { MoneyInputProps } from './MoneyInput/MoneyInput';
