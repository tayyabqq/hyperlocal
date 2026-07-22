import { IsE164Phone } from '../../common/validators/is-e164-phone.validator';

export class RequestOtpDto {
  @IsE164Phone()
  phoneE164!: string;
}
