import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';
import { OtpService } from '../otp/otp.service';

const ADMIN = {
  username: 'Asadmehar311',
  // bcrypt hash of 'Heaven@007'
  passwordHash: bcrypt.hashSync('Heaven@007', 10),
  role: 'admin',
};

@Injectable()
export class AuthService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly jwt: JwtService,
    private readonly otp: OtpService,
  ) {}

  // ─── Admin login ──────────────────────────────────────────────────────────

  async adminLogin(username: string, password: string) {
    if (username !== ADMIN.username || !bcrypt.compareSync(password, ADMIN.passwordHash)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const token = this.jwt.sign({ sub: 'admin', role: 'admin' });
    return { access_token: token, role: 'admin' };
  }

  // ─── Business register ────────────────────────────────────────────────────

  async register(body: {
    name: string;
    whatsapp_number: string;
    otp: string;
    wa_phone_number_id: string;
    wa_access_token: string;
    password: string;
  }) {
    const valid = await this.otp.verifyOtp(body.whatsapp_number, body.otp);
    if (!valid) throw new UnauthorizedException('Invalid or expired OTP');

    const passwordHash = bcrypt.hashSync(body.password, 10);

    const { data, error } = await this.supabase.db
      .from('businesses')
      .insert({
        name: body.name,
        whatsapp_number: body.whatsapp_number,
        wa_phone_number_id: body.wa_phone_number_id,
        wa_access_token: body.wa_access_token,
        password_hash: passwordHash,
        avg_minutes_per_patient: 10,
      })
      .select('id, name')
      .single();

    if (error) throw new Error(error.message);

    const token = this.jwt.sign({ sub: data.id, role: 'business' });
    return { access_token: token, business: data };
  }

  // ─── Business login ───────────────────────────────────────────────────────

  async businessLogin(whatsappNumber: string, password: string) {
    const { data } = await this.supabase.db
      .from('businesses')
      .select('id, name, password_hash')
      .eq('whatsapp_number', whatsappNumber)
      .maybeSingle();

    if (!data || !bcrypt.compareSync(password, data.password_hash)) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = this.jwt.sign({ sub: data.id, role: 'business' });
    return { access_token: token, business: { id: data.id, name: data.name } };
  }
}
