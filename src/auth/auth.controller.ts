import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('admin/login')
  @HttpCode(200)
  adminLogin(@Body('username') username: string, @Body('password') password: string) {
    return this.auth.adminLogin(username, password);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body('whatsapp_number') number: string, @Body('password') password: string) {
    return this.auth.businessLogin(number, password);
  }

  @Post('register')
  @HttpCode(200)
  register(@Body() body: {
    name: string;
    whatsapp_number: string;
    otp: string;
    wa_phone_number_id: string;
    wa_access_token: string;
    password: string;
  }) {
    return this.auth.register(body);
  }
}
