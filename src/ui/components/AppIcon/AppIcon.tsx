/**
 * AppIcon — SSOT de iconos (lucide-react)
 *
 * Deep module: mapa tipado `name → componente lucide`, interfaz chica.
 * - strokeWidth 1.75 (trazo fino, estética editorial premium)
 * - color `currentColor` (hereda del contexto, zero hardcoded colors)
 * - tamaño vía tokens `--icon-*` (tokens.json `icons` / tokens.css)
 *
 * Los callers quedan TIPADOS con `AppIconName` (unión de nombres válidos).
 */

import {
  Flame,
  Beer,
  Check,
  X,
  Plus,
  Bell,
  Receipt,
  Camera,
  Wallet,
  UtensilsCrossed,
  Play,
  Trash2,
  Printer,
  Save,
  RefreshCw,
  User,
  Crown,
  LayoutDashboard,
  CircleDollarSign,
  Package,
  SlidersHorizontal,
  Users,
  Armchair,
  Banknote,
  Smartphone,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Download,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Tag,
  Clock,
  Info,
  LogOut,
  Delete,
  ChefHat,
} from 'lucide-react';
import './AppIcon.css';

/** Mapa tipado nombre → componente. Agregar aquí TODO icono nuevo de la app. */
const ICONS = {
  flame: Flame,             // Cocina
  'chef-hat': ChefHat,      // Cocina (alternativo)
  beer: Beer,               // Barra / bebidas
  check: Check,
  x: X,
  plus: Plus,
  bell: Bell,
  receipt: Receipt,
  camera: Camera,
  wallet: Wallet,
  utensils: UtensilsCrossed,
  play: Play,
  trash: Trash2,
  printer: Printer,
  save: Save,
  refresh: RefreshCw,
  user: User,
  crown: Crown,
  dashboard: LayoutDashboard,
  cash: CircleDollarSign,
  package: Package,
  sliders: SlidersHorizontal,
  users: Users,
  armchair: Armchair,
  banknote: Banknote,
  smartphone: Smartphone,
  alert: AlertTriangle,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'chevron-up': ChevronUp,
  'chevron-down': ChevronDown,
  download: Download,
  volume: Volume2,
  'volume-off': VolumeX,
  maximize: Maximize2,
  minimize: Minimize2,
  tag: Tag,
  clock: Clock,
  info: Info,
  logout: LogOut,
  delete: Delete,
} as const;

export type AppIconName = keyof typeof ICONS;

export type AppIconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export interface AppIconProps {
  /** Nombre del icono (unión tipada) */
  name: AppIconName;
  /** Tamaño vía tokens `--icon-*` (default `md` = 20px) */
  size?: AppIconSize;
  className?: string;
}

export function AppIcon({ name, size = 'md', className }: AppIconProps) {
  const Icon = ICONS[name];
  const cls = ['app-icon', `app-icon--${size}`, className].filter(Boolean).join(' ');
  return <Icon className={cls} strokeWidth={1.75} aria-hidden="true" />;
}

export default AppIcon;
