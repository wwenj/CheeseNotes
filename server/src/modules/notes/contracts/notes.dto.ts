import { IsOptional, IsString } from 'class-validator';

export class SaveNoteDto {
  @IsString()
  path!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  revision?: string;
}

export class DeleteNoteDto {
  @IsString()
  path!: string;

  @IsString()
  revision!: string;
}
