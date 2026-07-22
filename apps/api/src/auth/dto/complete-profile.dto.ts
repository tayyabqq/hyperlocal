import { IsEnum, IsString, Length } from 'class-validator';
import { UserRole } from '@hl/shared';

export class CompleteProfileDto {
  @IsString()
  @Length(2, 60)
  displayName!: string;

  @IsEnum(UserRole)
  role!: UserRole;
}
