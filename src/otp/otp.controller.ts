import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { OtpService } from './otp.service';

@Controller('otp')
export class OtpController {
  constructor(private readonly otp: OtpService) {}

  @Post('send')
  @HttpCode(200)
  async send(@Body('whatsapp_number') number: string) {
    if (!number) return { success: false, message: 'whatsapp_number required' };
    await this.otp.sendOtp(number);
    return { success: true, message: 'OTP sent' };
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Body('whatsapp_number') number: string, @Body('otp') otp: string) {
    if (!number || !otp) return { success: false, message: 'whatsapp_number and otp required' };
    const valid = await this.otp.verifyOtp(number, otp);
    return { success: valid, message: valid ? 'Verified' : 'Invalid or expired OTP' };
  }
}
