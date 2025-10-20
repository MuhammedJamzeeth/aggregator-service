import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CheapestRouteDto {
  @IsNotEmpty({
    message: 'From location must be provided',
  })
  @IsString()
  from: string;

  @IsNotEmpty({
    message: 'To location must be provided',
  })
  @IsString()
  to: string;

  @IsNotEmpty({
    message: 'Date must be provided',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date must be in YYYY-MM-DD format',
  })
  date: string;
}
