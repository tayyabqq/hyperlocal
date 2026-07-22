import { IsString, IsUUID, Length, Matches } from 'class-validator';
import { IsE164Phone } from '../../common/validators/is-e164-phone.validator';

export class VerifyOtpDto {
  @IsUUID()
  challengeId!: string;

  @IsE164Phone()
  phoneE164!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;
}
