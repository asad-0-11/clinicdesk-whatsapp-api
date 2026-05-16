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

const GREETINGS = ['hi', 'hello', 'hey', 'helo', 'salam', 'salaam', 'assalam', 'assalamualaikum', 'yo', 'start', 'menu', '0', 'help'];

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

    const normalizedText = text.trim().toLowerCase();

    // Check if patient is already registered (source of truth)
    const patient = await this.getPatient(business.id, from);

    // ─── Not registered yet ───────────────────────────────────────────────────
    if (!patient) {
      const session = await this.getOrCreateSession(business.id, from, 'awaiting_name');

      if (session.state === 'awaiting_name' && !GREETINGS.includes(normalizedText)) {
        // Their reply is their name
        await this.handleNameRegistration(business, from, text.trim());
      } else {
        // First contact or greeting — ask for name
        await this.setSessionState(business.id, from, 'awaiting_name');
        await this.send(business, from,
          `👋 Welcome to *${business.name}*!\n\n` +
          `I'm your smart queue assistant. I'll help you book and track your appointment here.\n\n` +
          `To get started, please reply with your *full name* 👇`,
        );
      }
      return;
    }

    // ─── Registered patient ───────────────────────────────────────────────────
    const session = await this.getOrCreateSession(business.id, from, 'active');

    // Fix stuck state: if patient exists but session says awaiting_name, reset it
    if (session.state === 'awaiting_name') {
      await this.setSessionState(business.id, from, 'active');
      await this.sendMenu(business, from, patient.name);
      return;
    }

    if (session.state === 'awaiting_cancel_confirm') {
      await this.handleCancelConfirm(business, from, normalizedText, patient);
      return;
    }

    // ─── Route command ────────────────────────────────────────────────────────
    if (GREETINGS.includes(normalizedText)) {
      await this.sendMenu(business, from, patient.name);
      return;
    }

    switch (normalizedText) {
      case '1':
      case 'book':
      case 'book appointment':
        await this.handleBook(business, from, patient);
        break;
      case '2':
      case 'status':
      case 'my status':
        await this.handleStatus(business, from, patient);
        break;
      case '3':
      case 'cancel':
      case 'cancel appointment':
        await this.handleCancelRequest(business, from, patient);
        break;
      default:
        await this.sendMenu(business, from, patient.name);
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

  private async getOrCreateSession(businessId: string, phone: string, defaultState: SessionState): Promise<{ state: SessionState }> {
    const { data } = await this.supabase.db
      .from('sessions')
      .select('state')
      .eq('business_id', businessId)
      .eq('phone', phone)
      .maybeSingle();

    if (data) return data;

    await this.supabase.db.from('sessions').insert({ business_id: businessId, phone, state: defaultState });
    return { state: defaultState };
  }

  private async setSessionState(businessId: string, phone: string, state: SessionState): Promise<void> {
    await this.supabase.db
      .from('sessions')
      .upsert({ business_id: businessId, phone, state, updated_at: new Date().toISOString() },
        { onConflict: 'business_id,phone' });
  }

  // ─── Registration ──────────────────────────────────────────────────────────

  private async handleNameRegistration(business: Business, from: string, name: string): Promise<void> {
    if (name.length < 2 || name.length > 60) {
      await this.send(business, from,
        `⚠️ Please enter a valid full name (2–60 characters).\n\nReply with your *full name* 👇`,
      );
      return;
    }

    const { error } = await this.supabase.db.from('patients').insert({
      business_id: business.id,
      phone: from,
      name,
    });

    if (error) {
      this.logger.error(`Patient insert error: ${JSON.stringify(error)}`);
      await this.send(business, from, `Something went wrong. Please try again.`);
      return;
    }

    await this.setSessionState(business.id, from, 'active');

    await this.send(business, from,
      `✅ *Welcome, ${name}!*\n\n` +
      `You're now registered at *${business.name}*. Here's what you can do:\n\n` +
      `*1* — 📅 Book appointment\n` +
      `*2* — 📊 Check queue status\n` +
      `*3* — ❌ Cancel appointment\n\n` +
      `Reply with a number to continue 👇`,
    );
  }

  // ─── Menu ──────────────────────────────────────────────────────────────────

  private async sendMenu(business: Business, from: string, name: string): Promise<void> {
    const today = this.todayDate();
    const patient = await this.getPatient(business.id, from);
    const hasAppt = patient ? await this.getTodayAppointment(business.id, patient.id, today) : null;

    let apptLine = '';
    if (hasAppt) {
      apptLine = `\n🎫 *Your token today: #${hasAppt.token_number}* (${hasAppt.status})\n`;
    }

    await this.send(business, from,
      `👋 Hi *${name}*!${apptLine}\n` +
      `What would you like to do?\n\n` +
      `*1* — 📅 Book appointment\n` +
      `*2* — 📊 Check queue status\n` +
      `*3* — ❌ Cancel appointment\n\n` +
      `Reply with *1*, *2*, or *3* 👇`,
    );
  }

  // ─── Booking ───────────────────────────────────────────────────────────────

  private async handleBook(business: Business, from: string, patient: { id: string; name: string }): Promise<void> {
    const today = this.todayDate();

    const existing = await this.getTodayAppointment(business.id, patient.id, today);

    if (existing) {
      const wait = await this.calcWaitTime(business, existing.token_number);
      await this.send(business, from,
        `ℹ️ *You already have an appointment today!*\n\n` +
        `🎫 Token: *#${existing.token_number}*\n` +
        `📍 Status: *${existing.status}*\n` +
        `⏱ Estimated wait: *~${wait} min*\n\n` +
        `Reply *2* to check your queue position.`,
      );
      return;
    }

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

    const waitMins = await this.calcWaitTime(business, tokenNumber);
    const eta = this.addMinutesToNow(waitMins + business.avg_minutes_per_patient);

    await this.send(business, from,
      `✅ *Appointment Booked Successfully!*\n\n` +
      `👤 Name: *${patient.name}*\n` +
      `🎫 Token: *#${tokenNumber}*\n` +
      `⏱ Estimated time: *${eta}*\n` +
      `👥 People ahead: *${Math.max(0, tokenNumber - 1)}*\n\n` +
      `Please wait at the clinic. We'll call your number when it's your turn.\n\n` +
      `Reply *2* anytime to check your position 👇`,
    );
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  private async handleStatus(business: Business, from: string, patient: { id: string; name: string }): Promise<void> {
    const today = this.todayDate();
    const appt = await this.getTodayAppointment(business.id, patient.id, today);

    if (!appt) {
      await this.send(business, from,
        `📭 *No active appointment today.*\n\n` +
        `Reply *1* to book an appointment 👇`,
      );
      return;
    }

    if (appt.status === 'serving') {
      await this.send(business, from,
        `🔔 *It's your turn, ${patient.name}!*\n\n` +
        `Please proceed to the counter now.\n` +
        `🎫 Token: *#${appt.token_number}*`,
      );
      return;
    }

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

    const statusEmoji = ahead === 0 ? '🟢' : ahead <= 2 ? '🟡' : '🔴';

    await this.send(business, from,
      `📊 *Queue Status*\n\n` +
      `👤 Name: *${patient.name}*\n` +
      `🎫 Your token: *#${appt.token_number}*\n` +
      `🔢 Now serving: *#${currentServing || '—'}*\n` +
      `${statusEmoji} People ahead: *${ahead}*\n` +
      `⏱ Estimated wait: *~${waitMins} minutes*\n\n` +
      `${ahead === 0 ? '⚡ You are next! Please be ready.' : 'Please stay close to the clinic.'}`,
    );
  }

  // ─── Cancel ────────────────────────────────────────────────────────────────

  private async handleCancelRequest(business: Business, from: string, patient: { id: string; name: string }): Promise<void> {
    const appt = await this.getTodayAppointment(business.id, patient.id, this.todayDate());

    if (!appt) {
      await this.send(business, from,
        `📭 *No active appointment to cancel.*\n\n` +
        `Reply *1* to book an appointment 👇`,
      );
      return;
    }

    await this.setSessionState(business.id, from, 'awaiting_cancel_confirm');
    await this.send(business, from,
      `⚠️ *Cancel Appointment?*\n\n` +
      `🎫 Token: *#${appt.token_number}*\n\n` +
      `Are you sure you want to cancel?\n` +
      `Reply *yes* to confirm or *no* to keep it 👇`,
    );
  }

  private async handleCancelConfirm(business: Business, from: string, text: string, patient: { id: string; name: string }): Promise<void> {
    if (text === 'yes' || text === 'y') {
      await this.supabase.db
        .from('appointments')
        .update({ status: 'cancelled' })
        .eq('business_id', business.id)
        .eq('patient_id', patient.id)
        .eq('date', this.todayDate())
        .in('status', ['waiting', 'serving']);

      await this.setSessionState(business.id, from, 'active');
      await this.send(business, from,
        `✅ *Appointment cancelled.*\n\n` +
        `No worries, ${patient.name}! Reply *1* anytime to book again 👇`,
      );
    } else {
      await this.setSessionState(business.id, from, 'active');
      await this.send(business, from,
        `👍 *Appointment kept!*\n\n` +
        `Your appointment is still active.\n` +
        `Reply *2* to check your position in the queue 👇`,
      );
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

  private async getTodayAppointment(businessId: string, patientId: string, date: string) {
    const { data } = await this.supabase.db
      .from('appointments')
      .select('token_number, status')
      .eq('business_id', businessId)
      .eq('patient_id', patientId)
      .eq('date', date)
      .in('status', ['waiting', 'serving'])
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
