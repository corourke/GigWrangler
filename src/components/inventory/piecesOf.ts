import type { LocationItem } from '../../services/inventoryManagement.service';

/** Pieces at a place (#186): a unit is 1, a lot line its N. */
export const piecesOf = (item: LocationItem) => Math.max(1, Number(item.quantity ?? 1) || 1);
