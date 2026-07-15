import { IsOptional, IsString } from 'class-validator';

export class SaveNoteDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  path!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  revision?: string;
}

export class DeleteNoteDto {
  @IsOptional()
  @IsString()
  id?: string;
  @IsString()
  path!: string;

  @IsString()
  revision!: string;
}

export class CreateFolderDto {
  @IsString()
  path!: string;
}
