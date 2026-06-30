import { describe, expect, it } from 'vitest';
import { chunkText, extractTextFromBuffer } from '../src/server/documents/documentProcessor';

describe('documentProcessor', () => {
  it('chunks long text with stable indexes and bounded size', () => {
    const text = Array.from({ length: 180 }, (_, index) => `Linea ${index} dato importante de taller`).join('. ');

    const chunks = chunkText(text, { maxChars: 360, overlapChars: 60 });

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.chunkIndex).toBe(0);
    expect(chunks.every((chunk) => chunk.content.length <= 420)).toBe(true);
    expect(chunks.at(-1)?.content).toContain('Linea 179');
  });

  it('extracts plain text buffers without losing content', async () => {
    const text = await extractTextFromBuffer({
      buffer: Buffer.from('Horario: lunes a viernes de 9 a 18', 'utf8'),
      mimeType: 'text/plain',
      fileName: 'horario.txt',
    });

    expect(text).toBe('Horario: lunes a viernes de 9 a 18');
  });
});
