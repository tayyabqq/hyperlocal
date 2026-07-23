import { IsISO8601, IsOptional } from 'class-validator';

export class HistoryQueryDto {
  /** ISO timestamp cursor from a previous page's `nextCursor`. */
  @IsOptional()
  @IsISO8601()
  before?: string;
}
