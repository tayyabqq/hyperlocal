import { IsString, Length } from 'class-validator';
import { MESSAGE_MAX_LENGTH } from '@hl/shared';

export class SendMessageDto {
  @IsString()
  @Length(1, MESSAGE_MAX_LENGTH)
  body!: string;
}
