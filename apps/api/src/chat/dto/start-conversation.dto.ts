import { IsUUID } from 'class-validator';

export class StartConversationDto {
  @IsUUID()
  listingId!: string;
}
