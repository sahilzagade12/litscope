import type {
  CompareRow,
  LiteratureReview,
  LiteratureSummary,
  StudyDesign,
  SummariseOptions,
} from '../types'

const DESIGN_RANK: Record<StudyDesign, number> = {
  'Systematic review / meta-analysis': 1,
  'Guideline / consensus': 2,
  'Randomised controlled trial': 3,
  'Cohort study': 4,
  'Case-control study': 5,
  'Cross-sectional study': 6,
  'Narrative review': 7,
  'Case report / series': 8,
  'Basic / translational': 9,
  'Other / unclear': 10,
}

const POSITIVE =
  /\b(effective|efficacy|improvement|reduced|reduction|benefit|superior|significant(?:ly)? (?:lower|higher|improved|reduced)|favourable|favorable|safe and effective)\b/i
const NEGATIVE =
  /\b(no (?:significant )?difference|not (?:superior|effective)|ineffective|null|failed to|no benefit|worsen|increased risk|harm)\b/i
const UNCERTAIN =
  /\b(may|might|unclear|inconclusive|further (?:trials|studies|research)|limited evidence|insufficient)\b/i

function direction(text: string): 'positive' | 'negative' | 'uncertain' | 'mixed' {
  const pos = POSITIVE.test(text)
  const neg = NEGATIVE.test(text)
  const unc = UNCERTAIN.test(text)
  if (pos && neg) return 'mixed'
  if (pos) return 'positive'
  if (neg) return 'negative'
  if (unc) return 'uncertain'
  return 'mixed'
}

function shortLabel(summary: LiteratureSummary, index: number): string {
  const year = summary.meta.year ? ` (${summary.meta.year})` : ''
  const title = summary.meta.title.length > 72
    ? `${summary.meta.title.slice(0, 69)}…`
    : summary.meta.title
  return `Paper ${index + 1}${year}: ${title}`
}

function countByDesign(papers: LiteratureSummary[]): string[] {
  const counts = new Map<StudyDesign, number>()
  for (const p of papers) {
    counts.set(p.studyDesign, (counts.get(p.studyDesign) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => DESIGN_RANK[a[0]] - DESIGN_RANK[b[0]])
    .map(([design, n]) => `${n}× ${design}`)
}

function toRow(summary: LiteratureSummary): CompareRow {
  return {
    pmid: summary.meta.pmid,
    title: summary.meta.title,
    year: summary.meta.year,
    journal: summary.meta.journal,
    studyDesign: summary.studyDesign,
    oneLiner: summary.oneLiner,
    population: summary.pico.population,
    intervention: summary.pico.intervention,
    outcome: summary.pico.outcome,
    keyFinding: summary.keyFindings[0] || summary.oneLiner,
    pubmedUrl: summary.meta.pmid
      ? `https://pubmed.ncbi.nlm.nih.gov/${summary.meta.pmid}/`
      : undefined,
  }
}

export function compareLocally(
  topic: string,
  queryUsed: string,
  totalFound: number,
  papers: LiteratureSummary[],
): LiteratureReview {
  if (!papers.length) {
    throw new Error('No papers with abstracts were available to compare.')
  }

  const ranked = [...papers].sort(
    (a, b) => DESIGN_RANK[a.studyDesign] - DESIGN_RANK[b.studyDesign],
  )
  const directions = ranked.map((p) => ({
    paper: p,
    dir: direction(`${p.oneLiner} ${p.keyFindings.join(' ')} ${p.clinicalTakeaways.join(' ')}`),
  }))

  const positive = directions.filter((d) => d.dir === 'positive')
  const negative = directions.filter((d) => d.dir === 'negative')
  const uncertain = directions.filter((d) => d.dir === 'uncertain' || d.dir === 'mixed')

  const agreements: string[] = []
  if (positive.length >= 2) {
    agreements.push(
      `${positive.length} papers lean toward a beneficial / favourable signal on outcomes related to “${topic}”.`,
    )
  }
  if (negative.length >= 2) {
    agreements.push(
      `${negative.length} papers suggest limited benefit, null findings, or caution.`,
    )
  }

  const sharedPop = commonSnippet(ranked.map((p) => p.pico.population))
  const sharedInt = commonSnippet(ranked.map((p) => p.pico.intervention))
  if (sharedPop) {
    agreements.push(`Several abstracts focus on overlapping populations involving “${sharedPop}”.`)
  }
  if (sharedInt) {
    agreements.push(`Intervention language clusters around “${sharedInt}”.`)
  }
  if (!agreements.length) {
    agreements.push(
      'Abstracts address the topic from different angles; no single shared conclusion dominates.',
    )
  }

  const tensions: string[] = []
  if (positive.length && negative.length) {
    tensions.push(
      'Signal conflict: some abstracts read as supportive while others report null / limited effects — check endpoints, timing, and populations before synthesising.',
    )
  }
  const designs = new Set(ranked.map((p) => p.studyDesign))
  if (designs.size >= 3) {
    tensions.push(
      'Study designs are heterogeneous; avoid pooling conclusions across evidence levels without reading methods carefully.',
    )
  }
  if (uncertain.length >= 2) {
    tensions.push(
      'Multiple papers hedge with uncertainty or call for further research — treat claims as provisional.',
    )
  }
  if (!tensions.length) {
    tensions.push('No sharp directional conflict was obvious from abstracts alone.')
  }

  const evidenceMap = [
    `PubMed returned ~${totalFound.toLocaleString()} hits; summarised ${papers.length} with available abstracts.`,
    `Evidence mix: ${countByDesign(ranked).join('; ')}.`,
    `Highest-ranked design in this set: ${ranked[0].studyDesign}.`,
  ]

  const years = ranked
    .map((p) => Number(p.meta.year))
    .filter((y) => Number.isFinite(y))
  if (years.length) {
    evidenceMap.push(`Publication years span ${Math.min(...years)}–${Math.max(...years)}.`)
  }

  const gaps: string[] = [
    'Abstract-only synthesis can miss important methods, bias risks, and exact effect sizes.',
  ]
  if (!ranked.some((p) => p.studyDesign === 'Systematic review / meta-analysis')) {
    gaps.push('No systematic review / meta-analysis appeared in this retrieved set.')
  }
  if (!ranked.some((p) => p.studyDesign === 'Randomised controlled trial')) {
    gaps.push('No clear RCT abstract was identified in this set.')
  }
  if (papers.length < 3) {
    gaps.push('Few papers were summarised — broaden the topic or raise the paper count.')
  }

  const bottomLine = [
    `For “${topic}”, start with the highest-design papers in the comparison table, then check whether lower-level studies agree on direction.`,
    positive.length > negative.length
      ? 'Directional reading of abstracts is more often favourable than null — still verify statistics and clinical importance in the full texts.'
      : negative.length > positive.length
        ? 'Directional reading of abstracts is cautious / null more often than clearly favourable.'
        : 'Abstracts do not converge on a single clear directional signal.',
    'This is a literature scouting aid, not a systematic review or clinical recommendation.',
  ]

  const overview = [
    `LitScope searched PubMed for “${topic}” and summarised ${papers.length} abstract${papers.length === 1 ? '' : 's'}.`,
    `The set is led by ${ranked[0].studyDesign.toLowerCase()} evidence${ranked[0].meta.year ? ` (${ranked[0].meta.year})` : ''}: ${ranked[0].oneLiner}`,
  ].join(' ')

  return {
    topic,
    queryUsed,
    totalFound,
    papersSummarised: papers.length,
    overview,
    agreements,
    tensions,
    evidenceMap,
    gaps,
    bottomLine,
    rows: ranked.map(toRow),
    papers: ranked,
    mode: papers.every((p) => p.mode === 'ai') ? 'ai' : 'local',
    searchedAt: new Date().toISOString(),
  }
}

function commonSnippet(values: string[]): string | null {
  const tokens = values
    .map((v) =>
      v
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 4 && !STOP.has(t)),
    )
    .filter((t) => t.length)

  if (tokens.length < 2) return null

  const freq = new Map<string, number>()
  for (const list of tokens) {
    for (const t of new Set(list)) {
      freq.set(t, (freq.get(t) ?? 0) + 1)
    }
  }

  const shared = [...freq.entries()]
    .filter(([, n]) => n >= Math.ceil(tokens.length * 0.5))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t)

  return shared.length ? shared.join(' ') : null
}

const STOP = new Set([
  'about', 'after', 'among', 'these', 'those', 'their', 'there', 'where', 'which',
  'while', 'with', 'from', 'into', 'using', 'based', 'study', 'studies', 'patient',
  'patients', 'group', 'groups', 'versus', 'compared', 'between', 'within', 'other',
  'such', 'than', 'that', 'this', 'were', 'been', 'have', 'has', 'not', 'clearly',
  'stated', 'provided', 'text', 'outcome', 'outcomes', 'primary', 'secondary',
])

const COMPARE_SYSTEM = `You are LitScope, synthesising multiple medical paper abstracts for a literature scout.
Use ONLY the provided paper summaries. Do not invent trials, statistics, or citations.
Return strict JSON:
{
  "overview": string,
  "agreements": string[],
  "tensions": string[],
  "evidenceMap": string[],
  "gaps": string[],
  "bottomLine": string[]
}
Be concise, cautious, and appraisal-focused. No personalised medical advice.`

export async function compareWithAi(
  topic: string,
  queryUsed: string,
  totalFound: number,
  papers: LiteratureSummary[],
  options: SummariseOptions,
): Promise<LiteratureReview> {
  const local = compareLocally(topic, queryUsed, totalFound, papers)
  const apiKey = options.apiKey?.trim()
  if (!apiKey) return local

  const payload = papers.map((p, i) => ({
    label: shortLabel(p, i),
    pmid: p.meta.pmid,
    year: p.meta.year,
    design: p.studyDesign,
    oneLiner: p.oneLiner,
    pico: p.pico,
    keyFindings: p.keyFindings.slice(0, 3),
    takeaways: p.clinicalTakeaways.slice(0, 2),
  }))

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
        { role: 'system', content: COMPARE_SYSTEM },
        {
          role: 'user',
          content: `Topic: ${topic}\nPubMed query: ${queryUsed}\nTotal hits: ${totalFound}\n\nPapers:\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    return local
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) return local

  try {
    const parsed = JSON.parse(content) as Partial<LiteratureReview>
    return {
      ...local,
      overview: parsed.overview || local.overview,
      agreements: parsed.agreements?.length ? parsed.agreements : local.agreements,
      tensions: parsed.tensions?.length ? parsed.tensions : local.tensions,
      evidenceMap: parsed.evidenceMap?.length ? parsed.evidenceMap : local.evidenceMap,
      gaps: parsed.gaps?.length ? parsed.gaps : local.gaps,
      bottomLine: parsed.bottomLine?.length ? parsed.bottomLine : local.bottomLine,
      mode: 'ai',
    }
  } catch {
    return local
  }
}

export function reviewToMarkdown(review: LiteratureReview): string {
  return [
    `# Literature scout: ${review.topic}`,
    '',
    `**Query:** \`${review.queryUsed}\``,
    `**PubMed hits:** ~${review.totalFound} · **Summarised:** ${review.papersSummarised}`,
    `**Mode:** ${review.mode === 'ai' ? 'AI-assisted' : 'Local extractive'}`,
    '',
    '## Overview',
    review.overview,
    '',
    '## Where papers agree',
    ...review.agreements.map((x) => `- ${x}`),
    '',
    '## Tensions / heterogeneity',
    ...review.tensions.map((x) => `- ${x}`),
    '',
    '## Evidence map',
    ...review.evidenceMap.map((x) => `- ${x}`),
    '',
    '## Gaps',
    ...review.gaps.map((x) => `- ${x}`),
    '',
    '## Bottom line',
    ...review.bottomLine.map((x) => `- ${x}`),
    '',
    '## Comparison table',
    '| Year | Design | Title | Key finding |',
    '| --- | --- | --- | --- |',
    ...review.rows.map(
      (r) =>
        `| ${r.year || '—'} | ${r.studyDesign} | ${r.pmid ? `[${r.title}](https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/)` : r.title} | ${r.keyFinding.replace(/\|/g, '/')} |`,
    ),
    '',
    ...review.papers.flatMap((p, i) => [
      '',
      `## Paper ${i + 1}. ${p.meta.title}`,
      p.meta.pmid ? `PMID: ${p.meta.pmid}` : '',
      `Design: ${p.studyDesign}`,
      '',
      p.oneLiner,
      '',
      'Findings:',
      ...p.keyFindings.map((f) => `- ${f}`),
    ]),
    '',
    '_Generated by LitScope. Not a systematic review or medical advice._',
  ]
    .filter((line) => line !== null)
    .join('\n')
}
