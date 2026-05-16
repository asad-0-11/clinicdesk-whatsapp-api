import { Controller, Get, Post, Put, Query, Body, UseGuards, Request } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtGuard } from '../auth/jwt.guard';

@Controller('dashboard')
@UseGuards(JwtGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('queue')
  queue(@Request() req) {
    return this.dashboard.getTodayQueue(req.user.sub);
  }

  @Get('stats')
  stats(@Request() req) {
    return this.dashboard.getStats(req.user.sub);
  }

  @Post('call-next')
  callNext(@Request() req) {
    return this.dashboard.callNext(req.user.sub);
  }

  @Post('mark-done')
  markDone(@Request() req) {
    return this.dashboard.markDone(req.user.sub);
  }

  @Get('patients')
  patients(@Request() req, @Query('search') search?: string) {
    return this.dashboard.getPatients(req.user.sub, search);
  }

  @Get('settings')
  settings(@Request() req) {
    return this.dashboard.getBusiness(req.user.sub);
  }

  @Put('settings')
  updateSettings(@Request() req, @Body() body: { name?: string; avg_minutes_per_patient?: number; wa_phone_number_id?: string; wa_access_token?: string }) {
    return this.dashboard.updateSettings(req.user.sub, body);
  }

  // Admin only
  @Get('admin/businesses')
  allBusinesses(@Request() req) {
    if (req.user.role !== 'admin') return { error: 'Forbidden' };
    return this.dashboard.getAllBusinesses();
  }
}
