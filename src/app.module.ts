import { Module } from '@nestjs/common';
import { SupabaseModule } from './supabase/supabase.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { BotModule } from './bot/bot.module';
import { WebhookModule } from './webhook/webhook.module';
import { AuthModule } from './auth/auth.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { OtpModule } from './otp/otp.module';

@Module({
  imports: [
    SupabaseModule,
    WhatsappModule,
    BotModule,
    WebhookModule,
    AuthModule,
    DashboardModule,
    OtpModule,
  ],
})
export class AppModule {}
