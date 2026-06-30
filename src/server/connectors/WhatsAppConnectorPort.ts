import type { WhatsAppConnector, WhatsAppConnectorMessage } from '../../shared/types';

export type InboundWhatsAppHandler = (message: WhatsAppConnectorMessage) => Promise<string>;

export type { WhatsAppConnector };
