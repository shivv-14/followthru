import type { AppSettings, StoredDataset } from './db'

/** Evaluation clock: the dataset's reference time, the live clock, or a chosen time. Shared by the browser and the server API. */
export function evaluationTime(settings: Pick<AppSettings, 'clockMode' | 'customNow'>, dataset: Pick<StoredDataset, 'data'> | null, live: string): string {
  if (settings.clockMode === 'custom' && settings.customNow) return settings.customNow
  if (settings.clockMode === 'dataset' && dataset) {
    return dataset.data.referenceTime ?? dataset.data.messages.at(-1)?.sentAt ?? live
  }
  return live
}
