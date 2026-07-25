import type {
  LiteratureSummary,
  PaperMeta,
  Pico,
  StudyDesign,
  SummariseOptions,
} from '../types'
import { guessTitleFromText } from './pubmed'

const SECTION_PATTERNS: Array<{
  key: 'background' | 'methods' | 'results' | 'conclusions'
  re: RegExp
}> = [
  {
    key: 'background',
    re: /(?:^|[.\n]\s*)(background|introduction|objective[s]?|aim[s]?|purpose)\s*[:.\-–]\s*/i,
  },
  {
    key: 'methods',
    re: /(?:^|[.\n]\s*)(methods?|materials and methods|study design|participants)\s*[:.\-–]\s*/i,
  },
  {
    key: 'results',
    re: /(?:^|[.\n]\s*)(results?|findings)\s*[:.\-–]\s*/i,
  },
  {
    key: 'conclusions',
    re: /(?:^|[.\n]\s*)(conclusions?|conclusion and relevance|interpretation|implications)\s*[:.\-–]\s*/i,
  },
]

const DESIGN_RULES: Array<{ design: StudyDesign; re: RegExp }> = [
  {
    design: 'Systematic review / meta-analysis',
    re: /\b(systematic review|meta[- ]analysis|network meta[- ]analysis)\b/i,
  },
  {
    design: 'Randomised controlled trial',
    re: /\brandomi[sz]ed(?:[\s-][\w-]+){0,5}\s+trial\b|\bRCT\b|\brandomi[sz]ed,?\s+double[- ]blind\b/i,
  },
  {
    design: 'Cohort study',
    re: /\b(cohort study|prospective cohort|retrospective cohort|longitudinal cohort)\b/i,
  },
  {
    design: 'Case-control study',
    re: /\b(case[- ]control)\b/i,
  },
  {
    design: 'Cross-sectional study',
    re: /\b(cross[- ]sectional)\b/i,
  },
  {
    design: 'Case report / series',
    re: /\b(case report|case series)\b/i,
  },
  {
    design: 'Guideline / consensus',
    re: /\b(clinical practice guideline|consensus statement|practice guideline)\b/i,
  },
  {
    design: 'Narrative review',
    re: /\b(narrative review|literature review|scoping review)\b/i,
  },
  {
    design: 'Basic / translational',
    re: /\b(in vitro|in vivo|murine|knockout|cell line|mouse model)\b/i,
  },
]

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 35)
}

function splitSections(
  text: string,
): Partial<Record<'background' | 'methods' | 'results' | 'conclusions', string>> {
  const markers: Array<{ key: (typeof SECTION_PATTERNS)[number]['key']; index: number }> =
    []

  for (const { key, re } of SECTION_PATTERNS) {
    const match = re.exec(text)
    if (match?.index != null) {
      markers.push({ key, index: match.index })
    }
  }

  markers.sort((a, b) => a.index - b.index)
  if (markers.length === 0) return {}

  const sections: Partial<
    Record<'background' | 'methods' | 'results' | 'conclusions', string>
  > = {}

  for (let i = 0; i < markers.length; i += 1) {
    const start = markers[i].index
    const end = i + 1 < markers.length ? markers[i + 1].index : text.length
    const chunk = text
      .slice(start, end)
      .replace(/^[\s.]*[A-Za-z][A-Za-z /-]{0,40}:\s*/i, '')
      .trim()
    if (chunk) sections[markers[i].key] = chunk
  }

  return sections
}

function detectStudyDesign(text: string): StudyDesign {
  for (const rule of DESIGN_RULES) {
    if (rule.re.test(text)) return rule.design
  }
  return 'Other / unclear'
}

function extractPico(text: string, sections: ReturnType<typeof splitSections>): Pico {
  const pool = [
    sections.background,
    sections.methods,
    sections.results,
    text.slice(0, 1200),
  ]
    .filter(Boolean)
    .join(' ')

  const population =
    pool.match(
      /\b(?:adults|patients?|children|people|individuals|participants?)\s+with\s+([^.;]{8,90})/i,
    )?.[0] ||
    pool.match(
      /\b(?:in|among)\s+([^.;]{12,90}?(?:patients?|participants?|adults|children)[^.;]{0,40})/i,
    )?.[0] ||
    pool.match(/\b\d[\d,]+\s+(?:patients?|participants?|subjects?|adults|children)\b[^.;]{0,60}/i)?.[0] ||
    'Not clearly stated in the provided text'

  const intervention =
    pool.match(/\b(?:assigned to|treated with|received|underwent)\s+([^.;,]{6,70})/i)?.[1] ||
    pool.match(/\befficacy of\s+([^.;,]{6,70})/i)?.[1] ||
    pool.match(/\b(?:effect|impact|safety) of\s+([^.;,]{6,70})/i)?.[1] ||
    'Not clearly stated'

  const comparator =
    pool.match(/\b(?:compared with|versus|vs\.?)\s+([^.;,]{4,60})/i)?.[0] ||
    pool.match(/\bor (?:a )?sham(?: procedure| treatment| control)?\b/i)?.[0] ||
    pool.match(/\bcontrol(?: group)?(?: receiving| of|:)?\s*([^.;,]{0,50})/i)?.[0] ||
    'Not clearly stated / none reported'

  const outcome =
    pool.match(
      /\b(?:primary (?:outcome|endpoint)|main outcome)\s*(?:was|were|:)?\s*([^.;]{8,100})/i,
    )?.[1] ||
    pool.match(/\b(?:change in|reduction in|improvement in)\s+([^.;]{8,80})/i)?.[0] ||
    sections.results?.split(/(?<=[.!?])\s+/)[0] ||
    'See key findings'

  return {
    population: tidy(population),
    intervention: tidy(intervention),
    comparator: tidy(comparator),
    outcome: tidy(outcome),
  }
}

function tidy(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/^[:\-–\s]+/, '').trim()
}

function pickFindings(sections: ReturnType<typeof splitSections>, text: string): string[] {
  const source = sections.results || sections.conclusions || text
  return sentences(source).slice(0, 5)
}

function pickMethods(sections: ReturnType<typeof splitSections>, text: string): string[] {
  const source = sections.methods || text
  const found = sentences(source).slice(0, 4)
  if (found.length) return found
  return ['Methods were not clearly sectioned in the provided text.']
}

function pickLimitations(text: string, sections: ReturnType<typeof splitSections>): string[] {
  const lim = text.match(/limitations?[^.]*\.[^.]{0,200}\./i)?.[0]
  if (lim) return [tidy(lim)]

  const notes: string[] = []
  if (!sections.methods) {
    notes.push('Methods detail may be incomplete if only an abstract was provided.')
  }
  if (!/\b\d+\s*(patients?|participants?|subjects?)\b/i.test(text)) {
    notes.push('Sample size was not clearly identified in the text.')
  }
  if (!/\b(randomi[sz]ed|blinding|placebo|sham)\b/i.test(text)) {
    notes.push('Randomisation / blinding status was not clearly described.')
  }
  notes.push(
    'This is an automated reading aid — verify claims against the full paper before clinical use.',
  )
  return notes.slice(0, 4)
}

function pickTakeaways(
  sections: ReturnType<typeof splitSections>,
  findings: string[],
): string[] {
  const conclusions = sections.conclusions
    ? sentences(sections.conclusions).slice(0, 3)
    : findings.slice(0, 2)
  if (conclusions.length) return conclusions
  return ['Insufficient conclusion text to extract clinical takeaways.']
}

function evidenceNotes(design: StudyDesign, text: string): string[] {
  const notes: string[] = [`Apparent study design: ${design}.`]
  if (design === 'Systematic review / meta-analysis') {
    notes.push('Highest in the traditional evidence hierarchy for therapy questions when well conducted.')
  } else if (design === 'Randomised controlled trial') {
    notes.push('RCTs reduce confounding for intervention effects, but check allocation concealment and blinding.')
  } else if (design === 'Cohort study' || design === 'Case-control study') {
    notes.push('Observational design — residual confounding and selection bias remain possible.')
  }
  if (/\b(primary endpoint|primary outcome)\b/i.test(text)) {
    notes.push('A primary outcome appears to be named — prefer that over secondary endpoints when appraising.')
  }
  if (/\bp\s*[<≤]\s*0\.0?5\b|\b95%\s*CI\b|\bodds ratio\b|\bhazard ratio\b|\brisk ratio\b/i.test(text)) {
    notes.push('Effect estimates / uncertainty intervals are mentioned — extract exact numbers from the source.')
  }
  return notes
}

function buildOneLiner(
  design: StudyDesign,
  pico: Pico,
  conclusions: string | undefined,
): string {
  if (conclusions) {
    const first = sentences(conclusions)[0]
    if (first) return first
  }
  return `${design} examining ${pico.intervention} in ${pico.population}.`
}

export function summariseLocally(
  text: string,
  meta?: Partial<PaperMeta>,
): LiteratureSummary {
  const cleaned = text.replace(/\u0000/g, '').trim()
  if (cleaned.length < 80) {
    throw new Error('Please provide a longer abstract or article excerpt (at least a few sentences).')
  }

  const sections = splitSections(cleaned)
  const studyDesign = detectStudyDesign(cleaned)
  const pico = extractPico(cleaned, sections)
  const keyFindings = pickFindings(sections, cleaned)
  const methods = pickMethods(sections, cleaned)
  const limitations = pickLimitations(cleaned, sections)
  const clinicalTakeaways = pickTakeaways(sections, keyFindings)

  return {
    meta: {
      title: meta?.title || guessTitleFromText(cleaned),
      authors: meta?.authors,
      journal: meta?.journal,
      year: meta?.year,
      pmid: meta?.pmid,
      doi: meta?.doi,
      source: meta?.source || 'paste',
    },
    studyDesign,
    oneLiner: buildOneLiner(studyDesign, pico, sections.conclusions),
    pico,
    keyFindings,
    methods,
    limitations,
    clinicalTakeaways,
    evidenceNotes: evidenceNotes(studyDesign, cleaned),
    sections,
    mode: 'local',
  }
}

const AI_SYSTEM = `You are LitScope, a careful medical literature assistant for clinicians, students, and researchers.
Summarise ONLY from the provided text. Do not invent data, statistics, or citations.
If something is unclear or missing, say so explicitly.
Return strict JSON with this shape:
{
  "studyDesign": string,
  "oneLiner": string,
  "pico": { "population": string, "intervention": string, "comparator": string, "outcome": string },
  "keyFindings": string[],
  "methods": string[],
  "limitations": string[],
  "clinicalTakeaways": string[],
  "evidenceNotes": string[]
}
Keep arrays to 3-6 concise bullets. clinicalTakeaways must not give personalised medical advice; frame as literature implications.
Always include a caution that this is not a substitute for reading the full paper or clinical judgement.`

export async function summariseWithAi(
  text: string,
  meta: Partial<PaperMeta> | undefined,
  options: SummariseOptions,
): Promise<LiteratureSummary> {
  const apiKey = options.apiKey?.trim()
  if (!apiKey) {
    return summariseLocally(text, meta)
  }

  const local = summariseLocally(text, meta)

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model || 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: AI_SYSTEM },
        {
          role: 'user',
          content: `Paper metadata:\n${JSON.stringify(local.meta, null, 2)}\n\nText to summarise:\n${text.slice(0, 24000)}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(
      `OpenAI request failed (${response.status}). ${errText.slice(0, 180) || 'Check your API key and try again.'}`,
    )
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) {
    throw new Error('OpenAI returned an empty response.')
  }

  const parsed = JSON.parse(content) as Partial<LiteratureSummary>

  return {
    ...local,
    studyDesign: (parsed.studyDesign as LiteratureSummary['studyDesign']) || local.studyDesign,
    oneLiner: parsed.oneLiner || local.oneLiner,
    pico: {
      population: parsed.pico?.population || local.pico.population,
      intervention: parsed.pico?.intervention || local.pico.intervention,
      comparator: parsed.pico?.comparator || local.pico.comparator,
      outcome: parsed.pico?.outcome || local.pico.outcome,
    },
    keyFindings: parsed.keyFindings?.length ? parsed.keyFindings : local.keyFindings,
    methods: parsed.methods?.length ? parsed.methods : local.methods,
    limitations: parsed.limitations?.length ? parsed.limitations : local.limitations,
    clinicalTakeaways: parsed.clinicalTakeaways?.length
      ? parsed.clinicalTakeaways
      : local.clinicalTakeaways,
    evidenceNotes: parsed.evidenceNotes?.length ? parsed.evidenceNotes : local.evidenceNotes,
    mode: 'ai',
  }
}

export function summaryToMarkdown(summary: LiteratureSummary): string {
  const { meta, pico } = summary
  return [
    `# ${meta.title}`,
    '',
    meta.authors ? `**Authors:** ${meta.authors}` : null,
    meta.journal ? `**Journal:** ${meta.journal}${meta.year ? ` (${meta.year})` : ''}` : null,
    meta.pmid ? `**PMID:** ${meta.pmid}` : null,
    meta.doi ? `**DOI:** ${meta.doi}` : null,
    `**Study design:** ${summary.studyDesign}`,
    `**Mode:** ${summary.mode === 'ai' ? 'AI-assisted' : 'Local extractive'}`,
    '',
    '## One-line summary',
    summary.oneLiner,
    '',
    '## PICO',
    `- **Population:** ${pico.population}`,
    `- **Intervention:** ${pico.intervention}`,
    `- **Comparator:** ${pico.comparator}`,
    `- **Outcome:** ${pico.outcome}`,
    '',
    '## Key findings',
    ...summary.keyFindings.map((f) => `- ${f}`),
    '',
    '## Methods',
    ...summary.methods.map((f) => `- ${f}`),
    '',
    '## Limitations',
    ...summary.limitations.map((f) => `- ${f}`),
    '',
    '## Clinical takeaways',
    ...summary.clinicalTakeaways.map((f) => `- ${f}`),
    '',
    '## Evidence notes',
    ...summary.evidenceNotes.map((f) => `- ${f}`),
    '',
    '_Generated by LitScope. Not medical advice. Verify against the full paper._',
  ]
    .filter((line) => line !== null)
    .join('\n')
}
