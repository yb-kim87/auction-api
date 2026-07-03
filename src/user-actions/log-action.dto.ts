export interface LogActionDto {
  itemId?: string;
  actionType?: string;
  durationSeconds?: number;
  metadata?: Record<string, unknown> | null;
}
