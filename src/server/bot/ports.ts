import type { BotMessageInput, RetrievedChunk, UUID } from '../../shared/types';

export type StructuredAnswer = {
  companyId: UUID;
  match: string;
  answer: string;
};

export type BotRepository = {
  findCachedAnswer(companyId: UUID, normalizedQuestion: string): Promise<string | null>;
  saveCachedAnswer(companyId: UUID, normalizedQuestion: string, answer: string): Promise<void>;
  findStructuredAnswer(companyId: UUID, messageText: string): Promise<StructuredAnswer | null>;
  searchRelevantChunks(companyId: UUID, queryEmbedding: number[], queryText: string): Promise<RetrievedChunk[]>;
  recordGeminiUsage(companyId: UUID, phone: string, prompt: string, answer: string): Promise<void>;
  logIncomingMessage(message: BotMessageInput, answer: string, route: string[]): Promise<void>;
};

export type BotAiPort = {
  embedText(text: string): Promise<number[]>;
  answerFromContext(input: {
    companyId: UUID;
    question: string;
    context: string;
    phone: string;
  }): Promise<string>;
};
