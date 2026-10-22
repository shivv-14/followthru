import { detectSignals, type Signal } from './signals'

/** Turns message text into signals. Rules are the default; an AI extractor can plug in later. */
export interface Extractor {
  name: 'rules' | 'ai'
  detect(text: string): Signal[]
}

export const rulesExtractor: Extractor = { name: 'rules', detect: detectSignals }
