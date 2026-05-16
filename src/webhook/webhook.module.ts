import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { BotModule } from '../bot/bot.module';

@Module({
  imports: [BotModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
