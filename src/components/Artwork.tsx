import { useEffect, useState } from 'react';
export function Artwork({blob, className = ''}: {blob?: Blob; className?: string}) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) { setUrl(''); return; }
    const next = URL.createObjectURL(blob); setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return <img className={`artwork ${className}`} src={url || '/artwork.svg'} alt="专辑封面" draggable={false}/>;
}
