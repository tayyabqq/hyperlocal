import { IsEnum, IsString, Length } from 'class-validator';
import { DevicePlatform } from '@hl/shared';

export class RegisterDeviceDto {
  @IsString()
  @Length(1, 4096)
  token!: string;

  @IsEnum(DevicePlatform)
  platform!: DevicePlatform;
}
