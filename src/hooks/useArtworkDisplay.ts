import {useEffect, useState} from 'react';
import {findArtworkBounds} from '../lib/artworkGeometry';

// Cache image bytes, never object URLs: each mounted view owns and releases its URLs.
const displayCache = new WeakMap<Blob, Promise<Blob>>();

async function cropDisplayArtwork(blob: Blob): Promise<Blob> {
  let bitmap: ImageBitmap | undefined;
  const sample = document.createElement('canvas');
  let output: HTMLCanvasElement | undefined;
  try {
    bitmap = await createImageBitmap(blob);
    const {width, height} = bitmap;
    if (width * height > 40_000_000) return blob;
    const ratio = Math.min(1, 192 / Math.max(width, height));
    sample.width = Math.max(1, Math.round(width * ratio));
    sample.height = Math.max(1, Math.round(height * ratio));
    const context = sample.getContext('2d', {willReadFrequently: true});
    if (!context) return blob;
    context.imageSmoothingEnabled = false;
    context.drawImage(bitmap, 0, 0, sample.width, sample.height);
    const bounds = findArtworkBounds(context.getImageData(0, 0, sample.width, sample.height).data, sample.width, sample.height);
    if (!bounds.x && !bounds.y && bounds.width === sample.width && bounds.height === sample.height) return blob;
    const left = Math.round(bounds.x * width / sample.width);
    const top = Math.round(bounds.y * height / sample.height);
    const right = Math.round((bounds.x + bounds.width) * width / sample.width);
    const bottom = Math.round((bounds.y + bounds.height) * height / sample.height);
    output = document.createElement('canvas');
    output.width = right - left;
    output.height = bottom - top;
    const destination = output.getContext('2d');
    if (!destination) return blob;
    destination.drawImage(bitmap, left, top, output.width, output.height, 0, 0, output.width, output.height);
    return await new Promise<Blob>(resolve => output!.toBlob(result => resolve(result || blob), 'image/png'));
  } catch {
    return blob;
  } finally {
    bitmap?.close();
    sample.width = sample.height = 0;
    if (output) output.width = output.height = 0;
  }
}

function displayArtwork(blob: Blob): Promise<Blob> {
  let pending = displayCache.get(blob);
  if (!pending) {
    pending = cropDisplayArtwork(blob);
    displayCache.set(blob, pending);
  }
  return pending;
}

export function useArtworkDisplay(blob: Blob | undefined, trim: boolean): string {
  const [display, setDisplay] = useState<{blob: Blob; trim: boolean; url: string}>();
  useEffect(() => {
    if (!blob) {setDisplay(undefined); return;}
    let active = true;
    const urls: string[] = [];
    const show = (source: Blob) => {
      if (!active) return;
      const url = URL.createObjectURL(source);
      urls.push(url);
      setDisplay({blob, trim, url});
    };
    show(blob);
    if (trim) void displayArtwork(blob).then(source => {if (source !== blob) show(source);});
    return () => {
      active = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [blob, trim]);
  return display?.blob === blob && display?.trim === trim ? display.url : '';
}
