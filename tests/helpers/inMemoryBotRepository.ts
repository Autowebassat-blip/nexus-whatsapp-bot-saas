import type { BotMessageInput, RetrievedChunk, UUID } from '../../src/shared/types';
import type { BotAiPort, BotRepository, StructuredAnswer } from '../../src/server/bot/ports';

type CacheRow = {
  companyId: UUID;
  normalizedQuestion: string;
  answer: string;
};

export function createInMemoryBotRepository(input: {
  chunks?: RetrievedChunk[];
  structuredAnswers?: StructuredAnswer[];
} = {}) {
  const cacheRows: CacheRow[] = [];
  const usageRows: Array<{ companyId: UUID; prompt: string; answer: string }> = [];
  let aiCalls = 0;

  const repository: BotRepository = {
    async findCachedAnswer(companyId, normalizedQuestion) {
      return cacheRows.find((row) => row.companyId === companyId && row.normalizedQuestion === normalizedQuestion)?.answer ?? null;
    },
    async saveCachedAnswer(companyId, normalizedQuestion, answer) {
      cacheRows.push({ companyId, normalizedQuestion, answer });
    },
    async findStructuredAnswer(companyId, messageText) {
      return input.structuredAnswers?.find((row) =>
        row.companyId === companyId && messageText.toLowerCase().includes(row.match.toLowerCase()),
      ) ?? null;
    },
    async searchRelevantChunks(companyId) {
      return (input.chunks ?? []).filter((candidate) => candidate.companyId === companyId).slice(0, 5);
    },
    async recordGeminiUsage(companyId, _phone, prompt, answer) {
      usageRows.push({ companyId, prompt, answer });
    },
    async logIncomingMessage(message: BotMessageInput, answer: string, route: string[]) {
      void message;
      void answer;
      void route;
      return;
    },
  };

  const ai: BotAiPort = {
    async embedText(text) {
      return text.split('').slice(0, 8).map((char) => char.charCodeAt(0) / 255);
    },
    async answerFromContext({ context }) {
      aiCalls += 1;
      const firstContextLine = context.split('\n').find(Boolean) ?? '';
      return `Respuesta basada en documentos: ${firstContextLine}`;
    },
  };

  return {
    repository,
    ai,
    get aiCalls() {
      return aiCalls;
    },
    usageRows,
  };
}
