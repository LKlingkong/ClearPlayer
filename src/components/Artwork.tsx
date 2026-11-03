import {useArtworkDisplay} from '../hooks/useArtworkDisplay';
import type {ArtworkFit} from '../lib/artworkGeometry';

export function Artwork({blob, className = '', autoTrim = false, fit}: {
  blob?: Blob;
  className?: string;
  autoTrim?: boolean;
  fit?: ArtworkFit;
}) {
  const url = useArtworkDisplay(blob, autoTrim && fit?.trim !== false);
  const finite = (value: number | undefined, fallback: number) => Number.isFinite(value) ? value! : fallback;
  const x = Math.min(100, Math.max(0, finite(fit?.x, 50)));
  const y = Math.min(100, Math.max(0, finite(fit?.y, 50)));
  const zoom = Math.max(1, finite(fit?.zoom, 1));
  const position = `${x}% ${y}%`;
  return <img className={`artwork ${className}`} src={url || '/artwork.svg'} alt="专辑封面" draggable={false}
    style={fit ? {objectPosition: position, transformOrigin: position, transform: `scale(${zoom})`} : undefined}/>;
}
