import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsInt, Max, Min } from 'class-validator';

export class BrowseListingsDto {
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @Type(() => Number)
  @IsLongitude()
  longitude!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(20_000)
  radiusMeters?: number;
}
