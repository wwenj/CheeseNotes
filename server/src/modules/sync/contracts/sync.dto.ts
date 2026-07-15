import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export const conflictActions = ['keep-both', 'keep-local', 'use-remote', 'manual'] as const;
export type ConflictAction = (typeof conflictActions)[number];

export class SaveConflictDecisionDto {
  @IsIn(conflictActions)
  @IsOptional()
  action?: ConflictAction;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsBoolean()
  clear?: boolean;
}
