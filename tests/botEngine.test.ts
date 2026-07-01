import { describe, expect, it } from 'vitest';
import { BotEngine } from '../src/server/bot/BotEngine';
import { createInMemoryBotRepository } from './helpers/inMemoryBotRepository';
import type { RetrievedChunk } from '../src/shared/types';

function chunk(input: Partial<RetrievedChunk> & Pick<RetrievedChunk, 'companyId' | 'content'>): RetrievedChunk {
  return {
    id: input.id ?? `chunk-${Math.random()}`,
    companyId: input.companyId,
    documentId: input.documentId ?? `doc-${input.companyId}`,
    documentName: input.documentName ?? `doc-${input.companyId}.txt`,
    chunkIndex: input.chunkIndex ?? 0,
    content: input.content,
    similarity: input.similarity ?? 0.91,
  };
}

describe('BotEngine', () => {
  it('answers simple greetings without using documents or Gemini', async () => {
    const repo = createInMemoryBotRepository({
      chunks: [
        chunk({ companyId: 'company-a', content: 'El casco AGV cuesta 389 EUR.' }),
      ],
    });
    const engine = new BotEngine({ repository: repo.repository, ai: repo.ai });

    const answer = await engine.answerBotMessage({
      empresaId: 'company-a',
      telefonoCliente: '+34600111222',
      mensajeTexto: 'hola',
    });

    expect(answer.textoRespuesta).toContain('Hola');
    expect(answer.debug.route).toEqual(['greeting']);
    expect(answer.debug.usedChunks).toHaveLength(0);
    expect(repo.aiCalls).toBe(0);
  });

  it('keeps document retrieval isolated by company', async () => {
    const repo = createInMemoryBotRepository({
      chunks: [
        chunk({ companyId: 'company-a', content: 'La garantia de motos es de 24 meses.' }),
        chunk({ companyId: 'company-b', content: 'La garantia de patinetes es de 6 meses.' }),
      ],
    });
    const engine = new BotEngine({ repository: repo.repository, ai: repo.ai });

    const answer = await engine.answerBotMessage({
      empresaId: 'company-a',
      telefonoCliente: '+34600111222',
      mensajeTexto: 'Que garantia tienen?',
    });

    expect(answer.textoRespuesta).toContain('24 meses');
    expect(answer.textoRespuesta).not.toContain('6 meses');
    expect(answer.debug.usedChunks).toHaveLength(1);
    expect(answer.debug.usedChunks[0]?.companyId).toBe('company-a');
  });

  it('uses cached answer before creating a second Gemini usage row', async () => {
    const repo = createInMemoryBotRepository({
      chunks: [
        chunk({ companyId: 'company-a', content: 'El horario del taller es de 9:00 a 18:00.' }),
      ],
    });
    const engine = new BotEngine({ repository: repo.repository, ai: repo.ai });
    const input = {
      empresaId: 'company-a',
      telefonoCliente: '+34600111222',
      mensajeTexto: 'Cual es el horario del taller?',
    };

    const first = await engine.answerBotMessage(input);
    const second = await engine.answerBotMessage(input);

    expect(first.source).toBe('documents');
    expect(first.debug.geminiCalled).toBe(true);
    expect(second.source).toBe('cache');
    expect(second.debug.geminiCalled).toBe(false);
    expect(repo.aiCalls).toBe(1);
    expect(repo.usageRows).toHaveLength(1);
  });

  it('returns structured database answers before documents or Gemini', async () => {
    const repo = createInMemoryBotRepository({
      structuredAnswers: [{
        companyId: 'company-a',
        match: 'telefono',
        answer: 'Nuestro telefono es 928 000 111.',
      }],
      chunks: [
        chunk({ companyId: 'company-a', content: 'Este fragmento no debe usarse.' }),
      ],
    });
    const engine = new BotEngine({ repository: repo.repository, ai: repo.ai });

    const answer = await engine.answerBotMessage({
      empresaId: 'company-a',
      telefonoCliente: '+34600111222',
      mensajeTexto: 'telefono de contacto',
    });

    expect(answer.source).toBe('database');
    expect(answer.textoRespuesta).toBe('Nuestro telefono es 928 000 111.');
    expect(answer.debug.usedChunks).toHaveLength(0);
    expect(repo.aiCalls).toBe(0);
  });
});
