export type UUID = string;

export type BotMessageInput = {
  empresaId: UUID;
  mensajeTexto: string;
  telefonoCliente: string;
};

export type BotMessageResult = {
  textoRespuesta: string;
  source: 'cache' | 'database' | 'documents' | 'fallback';
  debug: {
    cacheHit: boolean;
    geminiCalled: boolean;
    usedChunks: RetrievedChunk[];
    route: string[];
  };
};

export type RetrievedChunk = {
  id: UUID;
  companyId: UUID;
  documentId: UUID;
  documentName: string;
  chunkIndex: number;
  content: string;
  similarity: number;
};

export type BotCompany = {
  id: UUID;
  name: string;
  botActive: boolean;
  whatsappStatus: 'disconnected' | 'qr' | 'connecting' | 'connected' | 'error';
  lastQr?: string | null;
  updatedAt?: string;
};

export type BotDocument = {
  id: UUID;
  companyId: UUID;
  name: string;
  mimeType: string;
  status: 'processing' | 'ready' | 'error';
  chunkCount: number;
  error?: string | null;
  createdAt: string;
};

export type WhatsAppConnectorMessage = {
  companyId: UUID;
  phone: string;
  text: string;
  messageId?: string;
};

export type WhatsAppConnector = {
  kind: 'baileys' | 'whatsapp-cloud';
  start(): Promise<void>;
  stop(): Promise<void>;
  connectCompany(companyId: UUID): Promise<void>;
  disconnectCompany(companyId: UUID): Promise<void>;
  sendMessage(companyId: UUID, phone: string, text: string): Promise<void>;
};
