import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SupabaseModule } from './supabase/supabase.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { BotModule } from './bot/bot.module';
import { WebhookModule } from './webhook/webhook.module';
import { ReminderModule } from './reminder/reminder.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    SupabaseModule,
    WhatsappModule,
    BotModule,
    WebhookModule,
    ReminderModule,
  ],
})
export class AppModule {}
