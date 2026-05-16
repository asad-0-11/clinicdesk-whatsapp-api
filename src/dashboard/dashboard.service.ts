import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

@Injectable()
export class DashboardService {
  constructor(private readonly supabase: SupabaseService) {}

  private today() {
    return new Date().toISOString().split('T')[0];
  }

  async getTodayQueue(businessId: string) {
    const { data } = await this.supabase.db
      .from('appointments')
      .select('id, token_number, status, created_at, patients(name, phone)')
      .eq('business_id', businessId)
      .eq('date', this.today())
      .order('token_number', { ascending: true });

    return data ?? [];
  }

  async getStats(businessId: string) {
    const { data } = await this.supabase.db
      .from('appointments')
      .select('status')
      .eq('business_id', businessId)
      .eq('date', this.today());

    const stats = { waiting: 0, serving: 0, done: 0, cancelled: 0, total: 0 };
    for (const row of data ?? []) {
      stats[row.status] = (stats[row.status] ?? 0) + 1;
      stats.total++;
    }
    return stats;
  }

  async callNext(businessId: string) {
    // Mark current serving as done
    await this.supabase.db
      .from('appointments')
      .update({ status: 'done' })
      .eq('business_id', businessId)
      .eq('date', this.today())
      .eq('status', 'serving');

    // Get next waiting token
    const { data: next } = await this.supabase.db
      .from('appointments')
      .select('id, token_number')
      .eq('business_id', businessId)
      .eq('date', this.today())
      .eq('status', 'waiting')
      .order('token_number', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!next) return { message: 'Queue empty', token: null };

    await this.supabase.db
      .from('appointments')
      .update({ status: 'serving' })
      .eq('id', next.id);

    return { message: 'Called', token: next.token_number };
  }

  async markDone(businessId: string) {
    await this.supabase.db
      .from('appointments')
      .update({ status: 'done' })
      .eq('business_id', businessId)
      .eq('date', this.today())
      .eq('status', 'serving');

    return { message: 'Marked done' };
  }

  async getPatients(businessId: string, search?: string) {
    let query = this.supabase.db
      .from('patients')
      .select('id, name, phone, created_at')
      .eq('business_id', businessId)
      .order('created_at', { ascending: false });

    if (search) query = query.ilike('name', `%${search}%`);

    const { data } = await query;
    return data ?? [];
  }

  async getBusiness(businessId: string) {
    const { data } = await this.supabase.db
      .from('businesses')
      .select('id, name, wa_phone_number_id, avg_minutes_per_patient, whatsapp_number')
      .eq('id', businessId)
      .maybeSingle();
    return data;
  }

  async updateSettings(businessId: string, updates: { name?: string; avg_minutes_per_patient?: number; wa_phone_number_id?: string; wa_access_token?: string }) {
    const { data } = await this.supabase.db
      .from('businesses')
      .update(updates)
      .eq('id', businessId)
      .select('id, name')
      .single();
    return data;
  }

  // Admin — all businesses
  async getAllBusinesses() {
    const { data } = await this.supabase.db
      .from('businesses')
      .select('id, name, wa_phone_number_id, whatsapp_number, created_at, avg_minutes_per_patient')
      .order('created_at', { ascending: false });
    return data ?? [];
  }
}
