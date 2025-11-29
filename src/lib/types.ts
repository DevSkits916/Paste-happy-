export type RowStatusKind = 'pending' | 'posted' | 'skipped' | 'failed';

export interface RowHistoryEntry {
  at: string;
  action: RowStatusKind;
  note?: string;
}
