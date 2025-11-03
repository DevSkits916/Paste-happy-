export type RowStatusKind = 'pending' | 'copied' | 'opened' | 'posted' | 'verified' | 'failed';

export interface RowHistoryEntry {
  at: string;
  action: RowStatusKind | 'skip' | 'retry' | 'note';
  note?: string;
}
