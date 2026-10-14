declare module 'bidi-js' {
  interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }
  interface Bidi {
    getEmbeddingLevels(text: string, explicitDirection?: 'ltr' | 'rtl'): EmbeddingLevels;
    getReorderedIndices(text: string, levels: EmbeddingLevels, start?: number, end?: number): number[];
  }
  export default function bidiFactory(): Bidi;
}
