import { IsArray, IsString } from 'class-validator';

export class TreeChangesDto {
  @IsString()
  baseTreeVersion!: string;

  @IsArray()
  operations!: unknown[];
}
