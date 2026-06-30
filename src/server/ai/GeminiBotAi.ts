import { GoogleGenAI } from '@google/genai';
import type { UUID } from '../../shared/types';
import type { BotAiPort } from '../bot/ports';

export type GeminiBotAiOptions = {
  apiKey: string;
  model: string;
  embeddingModel: string;
};

export class GeminiBotAi implements BotAiPort {
  private readonly client: GoogleGenAI;
  private readonly model: string;
  private readonly embeddingModel: string;

  constructor(options: GeminiBotAiOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model;
    this.embeddingModel = options.embeddingModel;
  }

  async embedText(text: string): Promise<number[]> {
    const response = await this.client.models.embedContent({
      model: this.embeddingModel,
      contents: [text],
      config: {
        outputDimensionality: 768,
      },
    });
    const embedding = response.embeddings?.[0]?.values;
    if (!embedding?.length) throw new Error('empty_embedding');
    return embedding;
  }

  async answerFromContext(input: {
    companyId: UUID;
    question: string;
    context: string;
    phone: string;
  }): Promise<string> {
    const prompt = [
      'Eres el chatbot de WhatsApp de una empresa.',
      'Responde en espanol claro, breve y profesional.',
      'Usa unicamente los fragmentos de documentos incluidos abajo.',
      'Si el dato no esta en los fragmentos, di que no lo encuentras en la documentacion disponible.',
      'No menciones Gemini, tokens, APIs, embeddings ni detalles tecnicos.',
      'Maximo 90 palabras.',
      '',
      `companyId validado en servidor: ${input.companyId}`,
      `Telefono cliente: ${input.phone}`,
      '',
      'Fragmentos relevantes:',
      input.context,
      '',
      `Pregunta: ${input.question}`,
    ].join('\n');

    const response = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        temperature: 0.2,
        topP: 0.8,
        maxOutputTokens: 500,
      },
    });
    const answer = response.text?.trim();
    if (!answer) throw new Error('empty_gemini_answer');
    return answer;
  }
}
