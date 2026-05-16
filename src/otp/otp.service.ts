import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';

@Injectable()
export class OtpService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly whatsapp: WhatsappService,
  ) {}

  async sendOtp(whatsappNumber: string): Promise<void> {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Invalidate any existing OTPs for this number
    await this.supabase.db
      .from('otp_verifications')
      .delete()
      .eq('whatsapp_number', whatsappNumber);

    await this.supabase.db.from('otp_verifications').insert({
      whatsapp_number: whatsappNumber,
      otp,
      expires_at: expiresAt.toISOString(),
    });

    await this.whatsapp.sendMessage(
      whatsappNumber,
      `Your ClinicDesk verification code: *${otp}*\nExpires in 10 minutes.`,
      process.env.WA_PHONE_NUMBER_ID!,
      process.env.WA_ACCESS_TOKEN!,
    );
  }

  async verifyOtp(whatsappNumber: string, otp: string): Promise<boolean> {
    const { data } = await this.supabase.db
      .from('otp_verifications')
      .select('otp, expires_at, verified')
      .eq('whatsapp_number', whatsappNumber)
      .eq('verified', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return false;
    if (new Date(data.expires_at) < new Date()) return false;
    if (data.otp !== otp) return false;

    await this.supabase.db
      .from('otp_verifications')
      .update({ verified: true })
      .eq('whatsapp_number', whatsappNumber);

    return true;
  }
}
