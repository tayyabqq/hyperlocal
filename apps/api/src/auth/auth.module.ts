import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { OTP_PROVIDER } from './otp/otp-provider.interface';
import { ConsoleOtpProvider } from './otp/console-otp.provider';
import { WhatsAppOtpProvider } from './otp/whatsapp-otp.provider';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        privateKey: config.getOrThrow<string>('JWT_PRIVATE_KEY'),
        publicKey: config.getOrThrow<string>('JWT_PUBLIC_KEY'),
        signOptions: { algorithm: 'RS256' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    ConsoleOtpProvider,
    WhatsAppOtpProvider,
    {
      provide: OTP_PROVIDER,
      inject: [ConfigService, ConsoleOtpProvider, WhatsAppOtpProvider],
      useFactory: (
        config: ConfigService,
        consoleProvider: ConsoleOtpProvider,
        whatsAppProvider: WhatsAppOtpProvider,
      ) =>
        config.getOrThrow<string>('OTP_PROVIDER') === 'console'
          ? consoleProvider
          : whatsAppProvider,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
