import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../supabase/supabase.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly whatsapp: WhatsappService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async sendReminders(): Promise<void> {
    const today = new Date().toISOString().split('T')[0];

    // Get current serving token per business
    const { data: servingList } = await this.supabase.db
      .from('appointments')
      .select('business_id, token_number')
      .eq('date', today)
      .eq('status', 'serving');

    if (!servingList || servingList.length === 0) return;

    for (const serving of servingList) {
      const upcomingToken = serving.token_number + 2; // 2 positions ahead

      // Find appointments that are 2-3 tokens away and reminder not sent
      const { data: upcoming } = await this.supabase.db
        .from('appointments')
        .select('id, patient_id, token_number')
        .eq('business_id', serving.business_id)
        .eq('date', today)
        .eq('status', 'waiting')
        .eq('reminder_sent', false)
        .gte('token_number', serving.token_number + 2)
        .lte('token_number', serving.token_number + 3);

      if (!upcoming || upcoming.length === 0) continue;

      // Get business credentials
      const { data: business } = await this.supabase.db
        .from('businesses')
        .select('wa_phone_number_id, wa_access_token, name')
        .eq('id', serving.business_id)
        .single();

      if (!business) continue;

      for (const appt of upcoming) {
        const { data: patient } = await this.supabase.db
          .from('patients')
          .select('phone, name')
          .eq('id', appt.patient_id)
          .single();

        if (!patient) continue;

        await this.whatsapp.sendMessage(
          patient.phone,
          `⏰ *Heads up, ${patient.name}!*\n\nYou're almost next at *${business.name}*.\n🎫 Token *#${appt.token_number}* — please make your way now!`,
          business.wa_phone_number_id,
          business.wa_access_token,
        );

        // Mark reminder sent
        await this.supabase.db
          .from('appointments')
          .update({ reminder_sent: true })
          .eq('id', appt.id);

        this.logger.log(`Reminder sent to ${patient.phone} for token #${appt.token_number}`);
      }
    }
  }
}
