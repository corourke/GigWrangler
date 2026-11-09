import { useEffect, useState } from 'react';

const ZOOM = 3;
export const MAG_R = 90;

type Magnifier = { show: boolean; pageX: number; pageY: number; src: string; bgX: number; bgY: number; bgW: number; bgH: number };

/**
 * The document beside the purchase form: the local file (an image, or a PDF drawn page by
 * page), with a magnifier and a full-screen view. The pane and its overlays render apart
 * (the overlays sit above the dialog), so they share this state.
 */
export function useDocumentPreview(file: File | null) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [pdfPageImages, setPdfPageImages] = useState<string[]>([]);
  const [magnifierEnabled, setMagnifierEnabled] = useState(false);
  const [magnifier, setMagnifier] = useState<Magnifier>({ show: false, pageX: 0, pageY: 0, src: '', bgX: 0, bgY: 0, bgW: 0, bgH: 0 });

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      if (file.type === 'application/pdf') {
        renderPdfToImages(file);
      }
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);

  async function renderPdfToImages(pdfFile: File) {
    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url
      ).toString();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const images: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        images.push(canvas.toDataURL('image/png'));
      }
      setPdfPageImages(images);
    } catch (err) {
      console.error('PDF render error:', err);
      setPdfPageImages([]);
    }
  }

  const handleImgMouseMove = (src: string) => (e: React.MouseEvent<HTMLImageElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const bgW = rect.width * ZOOM;
    const bgH = rect.height * ZOOM;
    // To show the point (relX, relY) in the center (MAG_R, MAG_R) of the container:
    // bgX = center_of_container - (relX_on_original * ZOOM)
    const bgX = MAG_R - relX * ZOOM;
    const bgY = MAG_R - relY * ZOOM;
    setMagnifier({ show: true, pageX: e.clientX, pageY: e.clientY, src, bgX, bgY, bgW, bgH });
  };

  return {
    file, previewUrl, pdfPageImages, magnifier, magnifierEnabled, showFullPreview,
    isImage: file?.type.startsWith('image/'),
    isPdf: file?.type === 'application/pdf',
    setShowFullPreview,
    hideMagnifier: () => setMagnifier(prev => ({ ...prev, show: false })),
    toggleMagnifier: () => { setMagnifierEnabled(v => !v); setMagnifier(prev => ({ ...prev, show: false })); },
    handleImgMouseMove,
  };
}

