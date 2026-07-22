import { IsInt, IsLatitude, IsLongitude, IsString, Length, Max, Min } from 'class-validator';

export class CreateListingDto {
  @IsString()
  @Length(2, 60)
  category!: string;

  @IsInt()
  @Min(5)
  @Max(2000)
  payAmountAed!: number;

  @IsString()
  @Length(10, 500)
  description!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  @IsString()
  @Length(2, 100)
  locationLabel!: string;
}
