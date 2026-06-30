import crypto from 'node:crypto';
import mammoth from 'mammoth';
import { readSheet } from 'read-excel-file/node';
import { PDFParse } from 'pdf-parse';

export type ExtractTextInput = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
};

export type TextChunk = {
  chunkIndex: number;
  content: string;
  tokenEstimate: number;
};

export type ChunkOptions = {
  maxChars: number;
  overlapChars: number;
};

const defaultChunkOptions: ChunkOptions = {
  maxChars: 1200,
  overlapChars: 180,
};

export function hashBuffer(buffer: Buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizeText(text: string) {
  return text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function isPdf(input: ExtractTextInput) {
  return input.mimeType === 'application/pdf' || input.fileName.toLowerCase().endsWith('.pdf');
}

function isDocx(input: ExtractTextInput) {
  return input.mimeType.includes('wordprocessingml') || input.fileName.toLowerCase().endsWith('.docx');
}

function isSpreadsheet(input: ExtractTextInput) {
  const name = input.fileName.toLowerCase();
  return input.mimeType.includes('spreadsheet') || name.endsWith('.xlsx');
}

function isCsv(input: ExtractTextInput) {
  return input.mimeType === 'text/csv' || input.fileName.toLowerCase().endsWith('.csv');
}

export async function extractTextFromBuffer(input: ExtractTextInput) {
  if (isPdf(input)) {
    const parser = new PDFParse({ data: input.buffer });
    const result = await parser.getText();
    await parser.destroy();
    return normalizeText(result.text);
  }

  if (isDocx(input)) {
    const result = await mammoth.extractRawText({ buffer: input.buffer });
    return normalizeText(result.value);
  }

  if (isCsv(input)) {
    return normalizeText(input.buffer.toString('utf8'));
  }

  if (isSpreadsheet(input)) {
    const rows = await readSheet(input.buffer);
    return normalizeText(rows.map((row) => row.map((value) => String(value ?? '')).join(',')).join('\n'));
  }

  return normalizeText(input.buffer.toString('utf8'));
}

export function chunkText(text: string, options: Partial<ChunkOptions> = {}): TextChunk[] {
  const settings = { ...defaultChunkOptions, ...options };
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const chunks: TextChunk[] = [];
  let start = 0;
  while (start < normalized.length) {
    const hardEnd = Math.min(normalized.length, start + settings.maxChars);
    const slice = normalized.slice(start, hardEnd);
    const naturalBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf('\n'));
    const end = hardEnd < normalized.length && naturalBreak > settings.maxChars * 0.55
      ? start + naturalBreak + 1
      : hardEnd;
    const content = normalized.slice(start, end).trim();
    if (content) {
      chunks.push({
        chunkIndex: chunks.length,
        content,
        tokenEstimate: Math.ceil(content.length / 4),
      });
    }
    if (end >= normalized.length) break;
    start = Math.max(0, end - settings.overlapChars);
  }

  return chunks;
}
