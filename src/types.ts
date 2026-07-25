export type InputMode = 'topic' | 'paste' | 'pubmed' | 'pdf'

export type StudyDesign =
  | 'Systematic review / meta-analysis'
  | 'Randomised controlled trial'
  | 'Cohort study'
  | 'Case-control study'
  | 'Cross-sectional study'
  | 'Case report / series'
  | 'Narrative review'
  | 'Guideline / consensus'
  | 'Basic / translational'
  | 'Other / unclear'

export type EvidenceFocus = 'any' | 'high' | 'rct'

export interface Pico {
  population: string
  intervention: string
  comparator: string
  outcome: string
}

export interface PaperMeta {
  title: string
  authors?: string
  journal?: string
  year?: string
  pmid?: string
  doi?: string
  source: 'paste' | 'pubmed' | 'pdf' | 'topic'
}

export interface LiteratureSummary {
  meta: PaperMeta
  studyDesign: StudyDesign
  oneLiner: string
  pico: Pico
  keyFindings: string[]
  methods: string[]
  limitations: string[]
  clinicalTakeaways: string[]
  evidenceNotes: string[]
  sections?: Partial<Record<'background' | 'methods' | 'results' | 'conclusions', string>>
  mode: 'local' | 'ai'
}

export interface CompareRow {
  pmid?: string
  title: string
  year?: string
  journal?: string
  studyDesign: StudyDesign
  oneLiner: string
  population: string
  intervention: string
  outcome: string
  keyFinding: string
  pubmedUrl?: string
}

export interface LiteratureReview {
  topic: string
  queryUsed: string
  totalFound: number
  papersSummarised: number
  overview: string
  agreements: string[]
  tensions: string[]
  evidenceMap: string[]
  gaps: string[]
  bottomLine: string[]
  rows: CompareRow[]
  papers: LiteratureSummary[]
  mode: 'local' | 'ai'
  searchedAt: string
}

export interface TopicSearchOptions {
  retmax?: number
  focus?: EvidenceFocus
  years?: number | null
}

export interface SummariseOptions {
  apiKey?: string
  model?: string
}

export type AgentStatus =
  | 'idle'
  | 'searching'
  | 'fetching'
  | 'summarising'
  | 'comparing'
  | 'done'
  | 'error'
