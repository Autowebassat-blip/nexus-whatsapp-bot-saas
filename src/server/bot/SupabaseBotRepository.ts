import type { BotMessageInput, RetrievedChunk, UUID } from '../../shared/types';
import type { BotRepository, StructuredAnswer } from './ports';
import type { SupabaseAdminClient } from '../infra/supabase';

function estimateTokens(prompt: string, answer: string) {
  return Math.max(1, Math.ceil(`${prompt}\n${answer}`.length / 4));
}

export class SupabaseBotRepository implements BotRepository {
  private readonly admin: SupabaseAdminClient;

  constructor(admin: SupabaseAdminClient) {
    this.admin = admin;
  }

  async findCachedAnswer(companyId: UUID, normalizedQuestion: string): Promise<string | null> {
    const { data } = await this.admin
      .from('bot_response_cache')
      .select('answer')
      .eq('company_id', companyId)
      .eq('normalized_question', normalizedQuestion)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    return (data as { answer?: string } | null)?.answer ?? null;
  }

  async saveCachedAnswer(companyId: UUID, normalizedQuestion: string, answer: string): Promise<void> {
    await this.admin.from('bot_response_cache').upsert({
      company_id: companyId,
      normalized_question: normalizedQuestion,
      answer,
      source: 'documents',
      expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    }, { onConflict: 'company_id,normalized_question' });
  }

  async findStructuredAnswer(companyId: UUID, messageText: string): Promise<StructuredAnswer | null> {
    const { data } = await this.admin
      .from('bot_structured_answers')
      .select('company_id, match_text, answer')
      .eq('company_id', companyId)
      .limit(100);
    const normalized = messageText.toLowerCase();
    const found = ((data ?? []) as Array<{ company_id: string; match_text: string; answer: string }>)
      .find((row) => normalized.includes(row.match_text.toLowerCase()));
    if (!found) return null;
    return {
      companyId: found.company_id,
      match: found.match_text,
      answer: found.answer,
    };
  }

  async searchRelevantChunks(companyId: UUID, queryEmbedding: number[], queryText: string): Promise<RetrievedChunk[]> {
    void queryText;
    const { data, error } = await this.admin.rpc('bot_match_document_chunks', {
      query_embedding: queryEmbedding,
      match_company_id: companyId,
      match_threshold: 0.72,
      match_count: 5,
    });
    if (error) throw new Error(`chunk_search_failed: ${error.message}`);
    return ((data ?? []) as Array<{
      id: string;
      company_id: string;
      document_id: string;
      document_name: string;
      chunk_index: number;
      content: string;
      similarity: number;
    }>).map((row) => ({
      id: row.id,
      companyId: row.company_id,
      documentId: row.document_id,
      documentName: row.document_name,
      chunkIndex: row.chunk_index,
      content: row.content,
      similarity: row.similarity,
    }));
  }

  async recordGeminiUsage(companyId: UUID, phone: string, prompt: string, answer: string): Promise<void> {
    await this.admin.from('ai_usage').insert({
      company_id: companyId,
      provider: 'gemini',
      model: process.env.GEMINI_MODEL ?? 'gemini-2.0-flash-lite',
      request_type: 'whatsapp_bot',
      prompt_chars: prompt.length,
      response_chars: answer.length,
      approx_tokens: estimateTokens(prompt, answer),
      metadata: { phone },
    });
  }

  async logIncomingMessage(message: BotMessageInput, answer: string, route: string[]): Promise<void> {
    await this.admin.from('bot_messages').insert({
      company_id: message.empresaId,
      customer_phone: message.telefonoCliente,
      incoming_text: message.mensajeTexto,
      response_text: answer,
      route,
      connector: 'baileys',
    });
  }
}
