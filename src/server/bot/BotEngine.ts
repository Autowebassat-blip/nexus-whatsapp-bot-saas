import type { BotMessageInput, BotMessageResult, RetrievedChunk } from '../../shared/types';
import type { BotAiPort, BotRepository } from './ports';

export type BotEngineDependencies = {
  repository: BotRepository;
  ai: BotAiPort;
};

function normalizeQuestion(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function contextFromChunks(chunks: RetrievedChunk[]) {
  return chunks
    .map((chunk) => `[${chunk.documentName}#${chunk.chunkIndex}] ${chunk.content}`)
    .join('\n');
}

function greetingAnswer(normalizedQuestion: string) {
  const simpleGreetings = new Set([
    'hola',
    'buenas',
    'buenos dias',
    'buenas tardes',
    'buenas noches',
    'hey',
    'ola',
  ]);
  if (!simpleGreetings.has(normalizedQuestion)) return null;
  return 'Hola. Soy el asistente de la tienda. Puedes preguntarme por precios, horarios, servicios o productos disponibles.';
}

export class BotEngine {
  private readonly repository: BotRepository;
  private readonly ai: BotAiPort;

  constructor(dependencies: BotEngineDependencies) {
    this.repository = dependencies.repository;
    this.ai = dependencies.ai;
  }

  async answerBotMessage(message: BotMessageInput): Promise<BotMessageResult> {
    const normalizedQuestion = normalizeQuestion(message.mensajeTexto);
    const route: string[] = [];

    const greeting = greetingAnswer(normalizedQuestion);
    if (greeting) {
      route.push('greeting');
      await this.repository.logIncomingMessage(message, greeting, route);
      return {
        textoRespuesta: greeting,
        source: 'database',
        debug: {
          cacheHit: false,
          geminiCalled: false,
          usedChunks: [],
          route,
        },
      };
    }

    route.push('cache');
    const cached = await this.repository.findCachedAnswer(message.empresaId, normalizedQuestion);
    if (cached) {
      await this.repository.logIncomingMessage(message, cached, route);
      return {
        textoRespuesta: cached,
        source: 'cache',
        debug: {
          cacheHit: true,
          geminiCalled: false,
          usedChunks: [],
          route,
        },
      };
    }

    route.push('database');
    const structured = await this.repository.findStructuredAnswer(message.empresaId, message.mensajeTexto);
    if (structured) {
      await this.repository.saveCachedAnswer(message.empresaId, normalizedQuestion, structured.answer);
      await this.repository.logIncomingMessage(message, structured.answer, route);
      return {
        textoRespuesta: structured.answer,
        source: 'database',
        debug: {
          cacheHit: false,
          geminiCalled: false,
          usedChunks: [],
          route,
        },
      };
    }

    route.push('documents');
    const queryEmbedding = await this.ai.embedText(message.mensajeTexto);
    const chunks = await this.repository.searchRelevantChunks(message.empresaId, queryEmbedding, message.mensajeTexto);
    if (!chunks.length) {
      const fallback = 'No encuentro esa informacion en los documentos de la empresa. Puedes reformular la pregunta o subir un documento con ese dato.';
      await this.repository.logIncomingMessage(message, fallback, route);
      return {
        textoRespuesta: fallback,
        source: 'fallback',
        debug: {
          cacheHit: false,
          geminiCalled: false,
          usedChunks: [],
          route,
        },
      };
    }

    route.push('gemini');
    const context = contextFromChunks(chunks);
    const answer = await this.ai.answerFromContext({
      companyId: message.empresaId,
      question: message.mensajeTexto,
      context,
      phone: message.telefonoCliente,
    });
    await this.repository.recordGeminiUsage(message.empresaId, message.telefonoCliente, message.mensajeTexto, answer);
    await this.repository.saveCachedAnswer(message.empresaId, normalizedQuestion, answer);
    await this.repository.logIncomingMessage(message, answer, route);

    return {
      textoRespuesta: answer,
      source: 'documents',
      debug: {
        cacheHit: false,
        geminiCalled: true,
        usedChunks: chunks,
        route,
      },
    };
  }
}
