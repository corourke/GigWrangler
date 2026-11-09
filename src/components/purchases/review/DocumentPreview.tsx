import { FileIcon, Loader2, Maximize2, Search, X as CloseIcon } from 'lucide-react';
import type { ExistingDoc } from './useReviewScannedData';
import { MAG_R, type useDocumentPreview } from './useDocumentPreview';

type Preview = ReturnType<typeof useDocumentPreview>;

/** The preview pane: the local file, else the purchase's saved document (edit mode). */
export function DocumentPreviewPane({ preview, existingDoc, isEditMode }: { preview: Preview; existingDoc: ExistingDoc | null; isEditMode: boolean }) {
  const { previewUrl, isImage, isPdf, pdfPageImages, magnifierEnabled, setShowFullPreview } = preview;

  const renderMagnifiableImage = (src: string, alt: string) => (
    // A mouse-only magnifier, a visual aid on top of the picture; Full preview is the keyboard way to see it larger.
    <img
      src={src}
      alt={alt}
      style={{ maxWidth: '100%', display: 'block', borderRadius: 4, cursor: magnifierEnabled ? 'crosshair' : 'default', pointerEvents: magnifierEnabled ? 'auto' : 'none' }}
      onMouseMove={magnifierEnabled ? preview.handleImgMouseMove(src) : undefined}
      onMouseLeave={magnifierEnabled ? preview.hideMagnifier : undefined}
    />
  );

  return (
    <div style={{ width: '45%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f3f4f6', borderRight: '1px solid #e5e7eb', position: 'relative' }}>
      <button
        onClick={() => setShowFullPreview(true)}
        style={{ position: 'absolute', top: 8, right: 8, zIndex: 20, background: 'rgba(255,255,255,0.9)', border: 'none', borderRadius: 4, padding: 6, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.15)' }}
        title="Full screen preview"
      >
        <Maximize2 className="w-4 h-4" />
      </button>

      <div style={{ flex: 1, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        {previewUrl && isImage && renderMagnifiableImage(previewUrl, 'Document Preview')}
        {isPdf && pdfPageImages.length > 0 && pdfPageImages.map((src, i) => (
          <div key={i}>{renderMagnifiableImage(src, `Page ${i + 1}`)}</div>
        ))}
        {isPdf && pdfPageImages.length === 0 && previewUrl && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 14 }}>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Rendering PDF...
          </div>
        )}
        {/* Edit mode: render the already-attached document (no local file). */}
        {!previewUrl && existingDoc && existingDoc.kind === 'image' && (
          <img src={existingDoc.url} alt={existingDoc.name} style={{ maxWidth: '100%', display: 'block', borderRadius: 4 }} />
        )}
        {!previewUrl && existingDoc && existingDoc.kind === 'pdf' && (
          <iframe src={existingDoc.url} title={existingDoc.name} style={{ width: '100%', height: '100%', border: 0, borderRadius: 4 }} />
        )}
        {!previewUrl && existingDoc && existingDoc.kind === 'other' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
            <FileIcon className="w-12 h-12 mb-2 opacity-30" />
            <a href={existingDoc.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: '#0284c7' }}>{existingDoc.name}</a>
          </div>
        )}
        {!previewUrl && !existingDoc && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>
            <FileIcon className="w-12 h-12 mb-2 opacity-20" />
            <p style={{ fontSize: 13 }}>{isEditMode ? 'No document attached' : 'No preview available'}</p>
          </div>
        )}
      </div>

      <div style={{ padding: '3px 12px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', display: 'flex', justifyContent: 'center', gap: 12, fontSize: 10, color: '#9ca3af', flexShrink: 0 }}>
        <button
          onClick={preview.toggleMagnifier}
          style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: magnifierEnabled ? '#dbeafe' : 'transparent', color: magnifierEnabled ? '#2563eb' : '#9ca3af', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 10, fontWeight: magnifierEnabled ? 600 : 400 }}
        >
          <Search className="w-3 h-3" /> {magnifierEnabled ? 'Magnifier ON' : 'Magnifier'}
        </button>
        <button
          onClick={() => setShowFullPreview(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'transparent', color: '#9ca3af', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 10 }}
        >
          <Maximize2 className="w-3 h-3" /> Full preview
        </button>
      </div>
    </div>
  );
}

/** The magnifier lens and the full-screen view, above everything else. */
export function DocumentPreviewOverlays({ preview }: { preview: Preview }) {
  const { magnifier, showFullPreview, previewUrl, isImage, isPdf, pdfPageImages, setShowFullPreview } = preview;
  return (
    <>
    {magnifier.show && magnifier.src && (
      <div
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          zIndex: 200,
          border: '2px solid white',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          borderRadius: '50%',
          overflow: 'hidden',
          background: 'white',
          width: MAG_R * 2,
          height: MAG_R * 2,
          left: magnifier.pageX - MAG_R,
          top: magnifier.pageY - MAG_R,
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            backgroundImage: `url(${magnifier.src})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${magnifier.bgW}px ${magnifier.bgH}px`,
            backgroundPosition: `${magnifier.bgX}px ${magnifier.bgY}px`,
          }}
        />
      </div>
    )}

    {showFullPreview && previewUrl && (
      // The backdrop closes on a click; the Close button does the same from the keyboard.
      <div
        role="presentation"
        style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.95)', display: 'flex', flexDirection: 'column', padding: 16 }}
        onClick={() => setShowFullPreview(false)}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, padding: '4px 12px', borderRadius: 4 }}
            onClick={() => setShowFullPreview(false)}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <CloseIcon style={{ width: 18, height: 18 }} /> Close
          </button>
        </div>
        <div role="presentation" style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }} onClick={e => e.stopPropagation()}>
          {isImage && <img src={previewUrl} alt="Full Preview" style={{ maxWidth: '100%', objectFit: 'contain', borderRadius: 4 }} />}
          {isPdf && pdfPageImages.map((src, i) => (
            <img key={i} src={src} alt={`Page ${i + 1}`} style={{ maxWidth: '100%', objectFit: 'contain', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }} />
          ))}
        </div>
      </div>
    )}
    </>
  );
}
