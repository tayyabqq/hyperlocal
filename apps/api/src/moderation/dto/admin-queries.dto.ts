import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ReportStatus } from '@hl/shared';

export class ListReportsQueryDto {
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;
}

export class ListUsersQueryDto {
  @IsOptional()
  @IsString()
  @Length(1, 60)
  search?: string;
}

export class ModerationNoteDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  note?: string;
}

export class AddKeywordDto {
  @IsString()
  @Length(2, 100)
  term!: string;
}
