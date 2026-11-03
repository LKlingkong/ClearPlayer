export interface ArtworkFit {
  zoom: number;
  x: number;
  y: number;
  trim: boolean;
}

export interface ArtworkBounds {x: number; y: number; width: number; height: number}

/** Only removes convincing symmetric black, white or transparent letterboxing.
 * Gradients, lettering, asymmetric/colored borders and weak transitions stay intact.
 * An artistic frame indistinguishable from letterboxing can still be detected;
 * callers must retain the original image and provide a way to disable trimming.
 */
export function findArtworkBounds(pixels: ArrayLike<number>, width: number, height: number): ArtworkBounds {
  const full = {x: 0, y: 0, width, height};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || pixels.length < width * height * 4) return full;
  // Transparent RGB is immaterial; opaque borders must be nearly neutral.
  const kind = (offset: number) => {
    if (pixels[offset + 3] <= 8) return 0;
    if (pixels[offset + 3] < 247) return -1;
    const low = Math.min(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    const high = Math.max(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    // JPEG chroma subsampling can tint an otherwise black edge by 10–18 levels.
    // The absolute ceiling remains low; colorful/bright marks are never noise.
    if (high <= 18) return 1;
    if (low >= 237 && high - low <= 8) return 2;
    return -1;
  };
  const axis = (horizontal: boolean): [number, number] => {
    const length = horizontal ? width : height, cross = horizontal ? height : width;
    const offset = (position: number, line: number) => (horizontal ? line * width + position : position * width + line) * 4;
    const side = (reverse: boolean) => {
      const edge = reverse ? length - 1 : 0;
      const borderKind = kind(offset(edge, Math.floor(cross / 2)));
      if (borderKind < 0) return null;
      const edgeOffset = offset(edge, Math.floor(cross / 2));
      const isBorder = (index: number) => kind(index) === borderKind && (borderKind === 0 ||
        Math.max(...[0, 1, 2].map(channel => Math.abs(pixels[index + channel] - pixels[edgeOffset + channel]))) <= (borderKind === 1 ? 18 : 10));
      const limit = Math.floor(length / 4);
      let margin = 0;
      for (; margin <= limit; margin++) {
        const position = reverse ? length - 1 - margin : margin;
        let matches = 0;
        for (let line = 0; line < cross; line++) if (isBorder(offset(position, line))) matches++;
        // Even small text in a margin is content: tolerate only isolated noise.
        if (matches / cross < 0.995) break;
      }
      if (margin < Math.max(2, Math.ceil(length * 0.025)) || margin > limit) return null;
      const inner = reverse ? length - 1 - margin : margin;
      const outer = reverse ? inner + 1 : inner - 1;
      let transitions = 0, departures = 0;
      for (let line = 0; line < cross; line++) {
        const a = offset(outer, line), b = offset(inner, line);
        const contrast = borderKind === 0 ? pixels[b + 3] - pixels[a + 3] :
          Math.max(...[0, 1, 2].map(channel => Math.abs(pixels[b + channel] - pixels[a + channel])));
        if (!isBorder(b)) {
          departures++;
          if (contrast >= 24) transitions++;
        }
      }
      // A dark subject can continue the padding color across many rows. Require
      // a clear jump on a majority of rows, plus flatness/symmetry on both sides.
      const strong = transitions / cross >= (borderKind === 1 ? 0.55 : 0.65);
      // A shadowed building/clothing edge may leave the black range without a
      // bright jump. It can only be accepted when the opposite side is strong.
      const shadowed = borderKind === 1 && departures / cross >= 0.55 && transitions / cross >= 0.2;
      return strong || shadowed ? {margin, borderKind, strong} : null;
    };
    const first = side(false), last = side(true);
    if (!first || !last || (!first.strong && !last.strong) || first.borderKind !== last.borderKind ||
      Math.abs(first.margin - last.margin) > Math.max(2, Math.floor(length * 0.005))) return [0, 0];
    return [first.margin, last.margin];
  };
  const [left, right] = axis(true), [top, bottom] = axis(false);
  return {x: left, y: top, width: width - left - right, height: height - top - bottom};
}
