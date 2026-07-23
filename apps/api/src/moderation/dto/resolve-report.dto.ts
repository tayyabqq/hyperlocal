import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ModerationAction } from '@hl/shared';

export class ResolveReportDto {
  @IsEnum(ModerationAction)
  action!: ModerationAction;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}
