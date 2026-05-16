import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

type SessionState = 'awaiting_name' | 'active' | 'awaiting_cancel_confirm';

interface Business {
  id: string;
  name: string;
  wa_phone_number_id: string;
  wa_access_token: string;
  avg_minutes_per_patient: number;
}

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async handleMessage(phoneNumberId: string, from: string, text: string): Promise<void> {
    const business = await this.getBusinessByPhoneNumberId(phoneNumberId);
    if (!business) {
      this.logger.warn(`No business found for phone_number_id: ${phoneNumberId}`);
      return;
    }

    const session = await this.getOrCreateSession(business.id, from);
    const normalizedText = text.trim().toLowerCase();

    if (session.state === 'awaiting_name') {
      await this.handleNameRegistration(business, from, text.trim());
      return;
    }

    if (session.state === 'awaiting_cancel_confirm') {
      await this.handleCancelConfirm(business, from, normalizedText);
      return;
    }

    // Active state — route by command
    switch (normalizedText) {
      case 'book':
        await this.handleBook(business, from);
        break;
      case 'status':
        await this.handleStatus(business, from);
        break;
      case 'cancel':
        await this.handleCancelRequest(business, from);
        break;
      default:
        await this.handleUnknownOrNew(business, from);
    }
  }

  // ─── Business lookup ───────────────────────────────────────────────────────

  private async getBusinessByPhoneNumberId(phoneNumberId: string): Promise<Business | null> {
    const { data, error } = await this.supabase.db
      .from('businesses')
      .select('id, name, wa_phone_number_id, wa_access_token, avg_minutes_per_patient')
      .eq('wa_phone_number_id', phoneNumberId)
      .limit(1)
      .maybeSingle();
    if (error) this.logger.error(`Business lookup error: ${JSON.stringify(error)}`);
    return data ?? null;
  }

  // ─── Session management ────────────────────────────────────────────────────

  private async getOrCreateSession(businessId: string, phone: string): Promise<{ state: SessionState }> {
    const { data } = await this.supabase.db
      .from('sessions')
      .select('state')
      .eq('business_id', businessId)
      .eq('phone', phone)
      .maybeSingle();

    if (data) return data;

    // New visitor — check if patient exists
    const { data: patient } = await this.supabase.db
      .from('patients')
      .select('id')
      .eq('business_id', businessId)
      .eq('phone', phone)
      .maybeSingle();

    const state: SessionState = patient ? 'active' : 'awaiting_name';
    await this.supabase.db.from('sessions').insert({ business_id: businessId, phone, state });
    return { state };
  }

  private async setSessionState(businessId: string, phone: string, state: SessionState): Promise<void> {
    await this.supabase.db
      .from('sessions')
      .upsert({ business_id: businessId, phone, state, updated_at: new Date().toISOString() });
  }

  private async clearSession(businessId: string, phone: string): Promise<void> {
    await this.setSessionState(businessId, phone, 'active');
  }

  // ─── Registration flow ─────────────────────────────────────────────────────

  private async handleUnknownOrNew(business: Business, from: string): Promise<void> {
    const { data: patient } = await this.supabase.db
      .from('patients')
      .select('id, name')
      .eq('business_id', business.id)
      .eq('phone', from)
      .maybeSingle();

    if (!patient) {
      await this.setSessionState(business.id, from, 'awaiting_name');
      await this.send(business, from,
        `👋 Welcome to *${business.name}*!\n\nI'm your queue assistant. To get started, please reply with your *full name*.`,
      );
    } else {
      await this.sendHelp(business, from, patient.name);
    }
  }

  private async handleNameRegistration(business: Business, from: string, name: string): Promise<void> {
    if (name.length < 2) {
      await this.send(business, from, `Please enter a valid name (at least 2 characters).`);
      return;
    }

    await this.supabase.db.from('patients').insert({
      business_id: business.id,
      phone: from,
      name,
    });

    await this.clearSession(business.id, from);

    await this.send(business, from,
      `✅ Welcome, *${name}*! You're now registered at *${business.name}*.\n\n` +
      `Here's what you can do:\n` +
      `📅 *book* — Join the queue\n` +
      `📊 *status* — Check your position\n` +
      `❌ *cancel* — Cancel your appointment`,
    );
  }

  // ─── Booking ───────────────────────────────────────────────────────────────

  private async handleBook(business: Business, from: string): Promise<void> {
    const patient = await this.getPatient(business.id, from);
    if (!patient) {
      await this.setSessionState(business.id, from, 'awaiting_name');
      await this.send(business, from, `Please reply with your *full name* to register first.`);
      return;
    }

    const today = this.todayDate();

    // Check for existing active appointment today
    const { data: existing } = await this.supabase.db
      .from('appointments')
      .select('token_number, status')
      .eq('business_id', business.id)
      .eq('patient_id', patient.id)
      .eq('date', today)
      .in('status', ['waiting', 'serving'])
      .maybeSingle();

    if (existing) {
      const wait = await this.calcWaitTime(business, existing.token_number);
      await this.send(business, from,
        `ℹ️ You already have an appointment today.\n\n` +
        `🎫 Token: *#${existing.token_number}*\n` +
        `⏱ Estimated wait: *${wait} minutes*`,
      );
      return;
    }

    // Get last token for this business today
    const { data: lastToken } = await this.supabase.db
      .from('appointments')
      .select('token_number')
      .eq('business_id', business.id)
      .eq('date', today)
      .order('token_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const tokenNumber = (lastToken?.token_number ?? 0) + 1;

    await this.supabase.db.from('appointments').insert({
      business_id: business.id,
      patient_id: patient.id,
      token_number: tokenNumber,
      status: 'waiting',
      date: today,
      reminder_sent: false,
    });

    const estimatedTime = tokenNumber * business.avg_minutes_per_patient;
    const eta = this.addMinutesToNow(estimatedTime);

    await this.send(business, from,
      `✅ *Appointment Booked!*\n\n` +
      `🎫 Your token: *#${tokenNumber}*\n` +
      `⏱ Estimated time: *${eta}*\n\n` +
      `Send *status* to check your position in the queue.`,
    );
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  private async handleStatus(business: Business, from: string): Promise<void> {
    const patient = await this.getPatient(business.id, from);
    if (!patient) {
      await this.send(business, from, `You're not registered yet. Please send any message to start.`);
      return;
    }

    const today = this.todayDate();

    const { data: appt } = await this.supabase.db
      .from('appointments')
      .select('token_number, status')
      .eq('business_id', business.id)
      .eq('patient_id', patient.id)
      .eq('date', today)
      .in('status', ['waiting', 'serving'])
      .maybeSingle();

    if (!appt) {
      await this.send(business, from,
        `📭 You don't have an active appointment today.\n\nSend *book* to join the queue.`,
      );
      return;
    }

    if (appt.status === 'serving') {
      await this.send(business, from, `🔔 *It's your turn!* Please proceed to the counter now.`);
      return;
    }

    // Find current serving token
    const { data: serving } = await this.supabase.db
      .from('appointments')
      .select('token_number')
      .eq('business_id', business.id)
      .eq('date', today)
      .eq('status', 'serving')
      .order('token_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentServing = serving?.token_number ?? 0;
    const ahead = Math.max(0, appt.token_number - currentServing - 1);
    const waitMins = ahead * business.avg_minutes_per_patient;

    await this.send(business, from,
      `📊 *Queue Status*\n\n` +
      `🎫 Your token: *#${appt.token_number}*\n` +
      `👥 People ahead: *${ahead}*\n` +
      `⏱ Estimated wait: *${waitMins} minutes*`,
    );
  }

  // ─── Cancel ────────────────────────────────────────────────────────────────

  private async handleCancelRequest(business: Business, from: string): Promise<void> {
    const patient = await this.getPatient(business.id, from);
    if (!patient) return;

    const { data: appt } = await this.supabase.db
      .from('appointments')
      .select('token_number')
      .eq('business_id', business.id)
      .eq('patient_id', patient.id)
      .eq('date', this.todayDate())
      .in('status', ['waiting', 'serving'])
      .maybeSingle();

    if (!appt) {
      await this.send(business, from, `📭 You have no active appointment to cancel.`);
      return;
    }

    await this.setSessionState(business.id, from, 'awaiting_cancel_confirm');
    await this.send(business, from,
      `⚠️ Are you sure you want to cancel token *#${appt.token_number}*?\n\nReply *yes* to confirm or *no* to keep it.`,
    );
  }

  private async handleCancelConfirm(business: Business, from: string, text: string): Promise<void> {
    if (text === 'yes') {
      const patient = await this.getPatient(business.id, from);
      if (patient) {
        await this.supabase.db
          .from('appointments')
          .update({ status: 'cancelled' })
          .eq('business_id', business.id)
          .eq('patient_id', patient.id)
          .eq('date', this.todayDate())
          .in('status', ['waiting', 'serving']);
      }
      await this.clearSession(business.id, from);
      await this.send(business, from, `✅ Your appointment has been cancelled.\n\nSend *book* anytime to rejoin the queue.`);
    } else {
      await this.clearSession(business.id, from);
      await this.send(business, from, `👍 No worries, your appointment is still active.\n\nSend *status* to check your position.`);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async getPatient(businessId: string, phone: string) {
    const { data } = await this.supabase.db
      .from('patients')
      .select('id, name')
      .eq('business_id', businessId)
      .eq('phone', phone)
      .maybeSingle();
    return data ?? null;
  }

  private async calcWaitTime(business: Business, tokenNumber: number): Promise<number> {
    const { data: serving } = await this.supabase.db
      .from('appointments')
      .select('token_number')
      .eq('business_id', business.id)
      .eq('date', this.todayDate())
      .eq('status', 'serving')
      .order('token_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const current = serving?.token_number ?? 0;
    const ahead = Math.max(0, tokenNumber - current - 1);
    return ahead * business.avg_minutes_per_patient;
  }

  private async sendHelp(business: Business, from: string, name: string): Promise<void> {
    await this.send(business, from,
      `👋 Hi *${name}*! Here's what you can do:\n\n` +
      `📅 *book* — Join today's queue\n` +
      `📊 *status* — Check your queue position\n` +
      `❌ *cancel* — Cancel your appointment`,
    );
  }

  private async send(business: Business, to: string, text: string): Promise<void> {
    await this.whatsapp.sendMessage(to, text, business.wa_phone_number_id, business.wa_access_token);
  }

  private todayDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  private addMinutesToNow(minutes: number): string {
    const d = new Date(Date.now() + minutes * 60000);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  }
}
