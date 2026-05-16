import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger(WhatsappService.name);

  async sendMessage(to: string, text: string, phoneNumberId: string, accessToken: string): Promise<void> {
    try {
      await axios.post(
        `https://graph.facebook.com/v25.0/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: text },
        },
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );
    } catch (err) {
      this.logger.error(`Failed to send message to ${to}: ${err?.response?.data?.error?.message ?? err.message}`);
    }
  }
}
