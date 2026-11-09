import { AlertCircle, Layers, Package, Plus, X } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import { recordKind, type ItemRecord } from '../../utils/equipmentItems';
import type { KitComponentRow } from './kitTypes';
import { availability, componentUnitValue, formatCurrency, type KitLineLookups } from './kitLineValues';

/** The kit editor's Kit Contents card: each line with its kind, quantity, availability and value. */
export function KitContentsCard({
  kitComponents, lookups, error, onAddComponents, onUpdateQuantity, onRemove,
}: {
  kitComponents: KitComponentRow[];
  lookups: KitLineLookups;
  error?: string;
  onAddComponents: () => void;
  onUpdateQuantity: (clientKey: string, quantity: number) => void;
  onRemove: (clientKey: string) => void;
}) {
  const { items } = lookups;
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-gray-900">Kit Contents</h3>
          {error && (
            <p className="text-sm text-red-600 flex items-center gap-1 mt-1">
              <AlertCircle className="w-4 h-4" />
              {error}
            </p>
          )}
        </div>
        <Button
          type="button"
          onClick={onAddComponents}
          variant="outline"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Components
        </Button>
      </div>

      {kitComponents.length === 0 ? (
        <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
          <Package className="w-12 h-12 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-600 mb-4">No assets or kits added yet</p>
          <Button
            type="button"
            onClick={onAddComponents}
            variant="outline"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Your First Component
          </Button>
        </div>
      ) : (
        // Cells are nowrap by default: Component and Availability wrap so Total Value and
        // the remove X fit the card (#279); a narrow screen still scrolls it sideways.
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead>Availability</TableHead>
                <TableHead className="text-right">Unit Value</TableHead>
                <TableHead className="text-right">Total Value</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {kitComponents.map((row) => {
                const rowId = row.clientKey;
                const isKit = !!row.child_kit_id;
                const isAny = !!row.equipment_item_id;
                const unitValue = componentUnitValue(row, lookups);
                const avail = availability(row, lookups);
                const kind = isKit ? 'Kit' : isAny ? 'Any' : row.asset && recordKind(row.asset as ItemRecord) === 'lot' ? 'Lot' : 'Unit';
                const lineName = isKit ? (row.childKit?.name || 'Unknown Kit')
                  : isAny ? (row.item?.manufacturer_model || items.get(row.equipment_item_id!)?.manufacturer_model || 'Unknown item')
                  : (row.asset?.manufacturer_model || 'Unknown Asset');
                return (
                  <TableRow key={rowId}>
                    <TableCell className="whitespace-normal break-words min-w-[8rem]">
                      <div>
                        <div className="text-sm text-gray-900">{lineName}</div>
                        {isAny && <div className="text-xs text-gray-500">any unit</div>}
                        {!isKit && !isAny && row.asset?.tag_number && (
                          <div className="text-xs text-gray-500 font-mono">{row.asset.tag_number}</div>
                        )}
                        {!isKit && row.asset?.serial_number && (
                          <div className="text-xs text-gray-500">
                            SN: {row.asset.serial_number}
                          </div>
                        )}
                        {isKit && row.childKit?.category && (
                          <div className="text-xs text-gray-500">{row.childKit.category}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`gap-1 ${isAny ? 'border-sky-300 bg-sky-50 text-sky-800' : ''}`}>
                        {isKit ? <Layers className="w-3 h-3" /> : <Package className="w-3 h-3" />}
                        {kind}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {isKit ? (
                        // A kit is a singular entity — it's either in the
                        // parent kit or it isn't, never "N of" itself.
                        <span className="text-sm text-gray-500 pr-3">1</span>
                      ) : (
                        <Input
                          type="number"
                          min="1"
                          max={isAny ? undefined : row.asset?.quantity ?? undefined}
                          value={row.quantity}
                          onChange={(e) =>
                            onUpdateQuantity(rowId, parseInt(e.target.value) || 1)
                          }
                          className="w-20 ml-auto"
                        />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {avail && (
                        <div className={`text-xs ${avail.tone === 'red' ? 'text-red-700' : avail.tone === 'amber' ? 'text-amber-700' : 'text-gray-500'}`}>
                          <div className={avail.tone === 'amber' && isAny ? 'font-medium' : ''}>{avail.text}</div>
                          {avail.note && <div>{avail.note}</div>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {unitValue ? formatCurrency(unitValue) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(unitValue * row.quantity)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onRemove(rowId)}
                        className="text-red-600 hover:text-red-700"
                        aria-label={`Remove ${lineName} from kit`}
                      >
                        <X className="w-4 h-4" aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
