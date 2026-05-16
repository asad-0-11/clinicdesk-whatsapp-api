import { Controller, Get, Post, Body, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { BotService } from '../bot/bot.service';

@Controller('webhook')
export class WebhookController {
  constructor(private readonly bot: BotService) {}

  @Get()
  verify(@Query() query, @Res() res: Response) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  @Post()
  async receive(@Body() body, @Res() res: Response) {
    res.sendStatus(200); // Respond to Meta immediately

    try {
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0]?.value;
      const phoneNumberId = change?.metadata?.phone_number_id;
      const message = change?.messages?.[0];

      if (!message || message.type !== 'text' || !phoneNumberId) return;

      const from = message.from;
      const text = message.text.body;

      await this.bot.handleMessage(phoneNumberId, from, text);
    } catch (err) {
      // Already responded 200 to Meta — just log
      console.error('Webhook processing error:', err);
    }
  }
}
