import { IsEnum, IsString, IsUUID, Length } from 'class-validator';
import { REPORT_REASON_MAX_LENGTH, ReportTargetType } from '@hl/shared';

export class CreateReportDto {
  @IsEnum(ReportTargetType)
  targetType!: ReportTargetType;

  @IsUUID()
  targetId!: string;

  @IsString()
  @Length(3, REPORT_REASON_MAX_LENGTH)
  reason!: string;
}
