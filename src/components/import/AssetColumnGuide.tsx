import type React from 'react';
import { ChevronRight, Package, Tag, Layers, Receipt } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { cn } from '../ui/utils';
import { ASSET_COLUMN_GUIDE, type AssetColumnGuideGroup } from '../../utils/csvImport';

const GUIDE_GROUP_STYLE: Record<AssetColumnGuideGroup['group'], { box: string; icons: React.ComponentType<{ className?: string }>[] }> = {
  item: { box: 'border-gray-200 bg-gray-50', icons: [Package] },
  unit: { box: 'border-sky-200 bg-sky-50/50', icons: [Tag, Layers] },
  line: { box: 'border-green-200 bg-green-50/50', icons: [Receipt] },
};

/** The assets template's columns, grouped as in the template, with a word on each (mockup 11, #183 D2). */
export default function AssetColumnGuide() {
  return (
    <Collapsible className="border-t pt-4">
      <CollapsibleTrigger asChild>
        <button type="button" className="group flex items-center gap-2 text-sm font-medium text-gray-900 hover:text-sky-700">
          <ChevronRight className="w-4 h-4 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
          Template columns: one row per unit or lot
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {ASSET_COLUMN_GUIDE.map((g) => {
            const style = GUIDE_GROUP_STYLE[g.group];
            const headingId = `import-columns-${g.group}`;
            return (
              <section key={g.group} aria-labelledby={headingId} className={cn('rounded-lg border p-3', style.box)}>
                <h3 id={headingId} className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                  {style.icons.map((Icon, i) => <Icon key={i} className="w-3.5 h-3.5 text-gray-600" aria-hidden />)}
                  {g.title}
                </h3>
                <p className="text-xs text-gray-600 mb-2">{g.summary}</p>
                <dl className="space-y-1.5">
                  {g.columns.map((c) => (
                    <div key={c.name}>
                      <dt>
                        <code className={cn(
                          'inline-flex items-center rounded border bg-white px-1.5 py-0.5 font-mono text-[11.5px]',
                          c.required ? 'border-gray-400 font-semibold text-gray-900' : 'border-gray-200 text-gray-700',
                        )}>
                          {c.name}
                        </code>
                        {c.required && <span className="sr-only"> (required)</span>}
                      </dt>
                      <dd className="text-xs text-gray-600 mt-0.5">{c.description}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Columns in bold are needed: a model and category on every equipment row, and a date on every purchase. Files are read by column name, so the order doesn’t matter.
          Not imported: <span className="font-mono">status</span> (imported equipment is Active), and{' '}
          <span className="font-mono">retired_on</span> and <span className="font-mono">liquidation_amt</span> (record sales and retirements on the equipment page).
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
