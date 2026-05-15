import { Controller, Get, Post, Body, Query, Res } from '@nestjs/common';
import express from 'express';
import axios from 'axios';

@Controller('webhook')
export class WebhookController {

  @Get()
  verify(@Query() query, @Res() res: express.Response) {
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
  }

  @Post()
  async receive(@Body() body, @Res() res: express.Response) {
    const message = body.entry?.[0]
      ?.changes?.[0]?.value
      ?.messages?.[0];

    if (message?.type === 'text') {
      const from = message.from;
      const text = message.text.body.toLowerCase().trim();

      console.log(`Message from ${from}: ${text}`);

      if (text === 'book') {
        await this.sendMessage(from, 'Your token is #1. Estimated time: 10:30 AM');
      } else {
        await this.sendMessage(from, 'Send "book" to get your appointment token.');
      }
    }

    return res.sendStatus(200);
  }

  async sendMessage(to: string, text: string) {
    await axios.post(
      `https://graph.facebook.com/v25.0/${process.env.WA_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`
        }
      }
    );
  }
}