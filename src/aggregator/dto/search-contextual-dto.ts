import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class SearchContextualDto {
  @IsNotEmpty({ message: 'From location must not be empty' })
  @IsString()
  from: string;

  @IsNotEmpty({ message: 'To location must not be empty' })
  @IsString()
  to: string;

  @IsNotEmpty({ message: 'Date must not be empty' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date must be in YYYY-MM-DD format',
  })
  date: string;
}
