import { useState } from 'react';
import { Loader2, FileText, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../../ui/button';
import { usePurchaseDocuments } from './usePanelData';

function getKind(fileName: string): 'image' | 'pdf' | 'other' {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  return 'other';
}

interface DocumentDetailViewProps {
  headerId: string;
}

export default function DocumentDetailView({ headerId }: DocumentDetailViewProps) {
  // The document shown, by position; back to the first for another purchase.
  const [shown, setShown] = useState({ headerId, index: 0 });
  const index = shown.headerId === headerId ? shown.index : 0;
  const setIndex = (next: number | ((i: number) => number)) =>
    setShown({ headerId, index: typeof next === 'function' ? next(index) : next });
  const { attachments, isLoading, url, isResolvingUrl } = usePurchaseDocuments(headerId, (docs) => docs[index]);
  const current = attachments[index];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
      </div>
    );
  }

  if (attachments.length === 0) {
    return (
      <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-lg">
        <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No document attached</p>
      </div>
    );
  }

  const kind = current ? getKind(current.file_name) : 'other';

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          {attachments.length > 1 && (
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button aria-label="Previous document"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                disabled={index === 0}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {index + 1} / {attachments.length}
              </span>
              <Button aria-label="Next document"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                disabled={index === attachments.length - 1}
                onClick={() => setIndex((i) => Math.min(attachments.length - 1, i + 1))}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          <span className="text-xs font-medium text-gray-700 truncate" title={current?.file_name}>
            {current?.file_name}
          </span>
        </div>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-sky-600">
              <ExternalLink className="w-3.5 h-3.5 mr-1" />
              Open
            </Button>
          </a>
        )}
      </div>

      <div className="flex-1 min-h-0 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
        {isResolvingUrl || !url ? (
          <div className="flex items-center justify-center h-full p-8">
            <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
          </div>
        ) : kind === 'image' ? (
          <div className="h-full overflow-auto flex items-start justify-center">
            <img src={url} alt={current?.file_name} className="max-w-full h-auto" />
          </div>
        ) : kind === 'pdf' ? (
          <iframe src={url} title={current?.file_name} className="w-full h-full border-0" />
        ) : (
          <div className="flex flex-col items-center justify-center h-full p-8 text-center">
            <FileText className="w-10 h-10 text-gray-300 mb-3" />
            <p className="text-sm text-gray-500 mb-3">
              This file type can't be previewed inline.
            </p>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                <ExternalLink className="w-4 h-4 mr-2" />
                Open in new tab
              </Button>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
