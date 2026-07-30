/**
 * SALON MODULE — Table Management
 * 
 * Tables are LOGICAL ENTITIES (number-based), not visual positions.
 * Layout can be reconfigured via admin panel at any time.
 * 
 * Artículo IV: Simplicity — No visual map, no drag-and-drop, no canvas.
 * If layout changes → admin updates grid config → UI adjusts.
 */

export { TableGrid, TableList } from './components/TableGrid';
export type { TableGridProps, TableListProps } from './components/TableGrid';
