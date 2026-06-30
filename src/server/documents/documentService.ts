import path from 'node:path';
import { extractTextFromBuffer, chunkText, hashBuffer } from './documentProcessor';
import type { BotAiPort } from '../bot/ports';
import type { SupabaseAdminClient } from '../infra/supabase';

export type ProcessDocumentInput = {
  companyId: string;
  userId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
};

function safeFileName(fileName: string) {
  const parsed = path.parse(fileName);
  const base = parsed.name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'documento';
  const ext = parsed.ext.toLowerCase().replace(/[^a-z0-9.]/g, '');
  return `${base}${ext}`;
}

export async function processCompanyDocument(
  admin: SupabaseAdminClient,
  ai: BotAiPort,
  input: ProcessDocumentInput,
) {
  const contentHash = hashBuffer(input.buffer);
  const storagePath = `${input.companyId}/${Date.now()}-${safeFileName(input.fileName)}`;
  const { error: uploadError } = await admin.storage
    .from('bot-documents')
    .upload(storagePath, input.buffer, {
      contentType: input.mimeType || 'application/octet-stream',
      upsert: false,
    });
  if (uploadError) throw new Error(`document_upload_failed: ${uploadError.message}`);

  const { data: documentRow, error: insertError } = await admin.from('bot_documents').insert({
    company_id: input.companyId,
    name: input.fileName,
    mime_type: input.mimeType || 'application/octet-stream',
    storage_path: storagePath,
    size_bytes: input.buffer.byteLength,
    content_hash: contentHash,
    status: 'processing',
    created_by: input.userId,
  }).select('id').single();
  if (insertError) throw new Error(`document_insert_failed: ${insertError.message}`);

  const documentId = (documentRow as { id: string }).id;
  try {
    const text = await extractTextFromBuffer({
      buffer: input.buffer,
      mimeType: input.mimeType,
      fileName: input.fileName,
    });
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      const embedding = await ai.embedText(chunk.content);
      await admin.from('bot_document_chunks').insert({
        company_id: input.companyId,
        document_id: documentId,
        chunk_index: chunk.chunkIndex,
        content: chunk.content,
        token_estimate: chunk.tokenEstimate,
        embedding,
      });
    }
    await admin.from('bot_documents').update({
      status: 'ready',
      chunk_count: chunks.length,
      updated_at: new Date().toISOString(),
    }).eq('id', documentId);
    return { documentId, chunkCount: chunks.length, storagePath };
  } catch (error) {
    await admin.from('bot_documents').update({
      status: 'error',
      error: error instanceof Error ? error.message : 'unknown_document_error',
      updated_at: new Date().toISOString(),
    }).eq('id', documentId);
    throw error;
  }
}
