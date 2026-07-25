import type { EvidenceFocus, PaperMeta, TopicSearchOptions } from '../types'

const NCBI = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const TOOL = 'LitScope'
const EMAIL = 'litscope@local.dev'

function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) {
    const value = decodeXml(m[1])
    if (value) out.push(value)
  }
  return out
}

function extractTag(xml: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(re)
  return match ? decodeXml(match[1]) : undefined
}

function ncbiUrl(path: string, params: Record<string, string | number>): string {
  const q = new URLSearchParams({
    tool: TOOL,
    email: EMAIL,
    ...Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ),
  })
  return `${NCBI}/${path}?${q.toString()}`
}

export function normalisePmid(input: string): string {
  const trimmed = input.trim()
  const fromUrl = trimmed.match(/(?:pubmed\.ncbi\.nlm\.nih\.gov\/|pmid[=:]?\s*)(\d{5,9})/i)
  if (fromUrl) return fromUrl[1]
  const digits = trimmed.match(/\b(\d{5,9})\b/)
  if (digits) return digits[1]
  throw new Error('Enter a valid PubMed ID or PubMed URL.')
}

function focusClause(focus: EvidenceFocus = 'any'): string {
  if (focus === 'rct') {
    return ' AND Randomized Controlled Trial[Publication Type]'
  }
  if (focus === 'high') {
    return ' AND (Systematic Review[Publication Type] OR Meta-Analysis[Publication Type] OR Randomized Controlled Trial[Publication Type] OR Practice Guideline[Publication Type])'
  }
  return ''
}

function yearClause(years: number | null | undefined): string {
  if (!years) return ''
  const end = new Date().getFullYear()
  const start = end - years + 1
  return ` AND (${start}:${end}[dp])`
}

export function buildPubmedQuery(
  topic: string,
  options: TopicSearchOptions = {},
): string {
  const cleaned = topic.trim().replace(/\s+/g, ' ')
  if (cleaned.length < 3) {
    throw new Error('Enter a research topic (at least a few words).')
  }
  return `(${cleaned})${focusClause(options.focus)}${yearClause(options.years)}`
}

export interface PubmedSearchResult {
  queryUsed: string
  totalFound: number
  pmids: string[]
}

export async function searchPubmed(
  topic: string,
  options: TopicSearchOptions = {},
): Promise<PubmedSearchResult> {
  const retmax = Math.min(Math.max(options.retmax ?? 5, 1), 12)
  const queryUsed = buildPubmedQuery(topic, options)

  const res = await fetch(
    ncbiUrl('esearch.fcgi', {
      db: 'pubmed',
      term: queryUsed,
      retmax,
      retmode: 'json',
      sort: 'relevance',
    }),
  )

  if (!res.ok) {
    throw new Error('PubMed search failed. Check your connection and try again.')
  }

  const json = (await res.json()) as {
    esearchresult?: {
      count?: string
      idlist?: string[]
    }
  }

  const pmids = json.esearchresult?.idlist ?? []
  const totalFound = Number(json.esearchresult?.count ?? pmids.length)

  if (pmids.length === 0) {
    throw new Error(
      'No PubMed hits for that topic. Try broader terms, fewer filters, or a longer year window.',
    )
  }

  return { queryUsed, totalFound, pmids }
}

type EsummaryRecord = {
  title?: string
  fulljournalname?: string
  source?: string
  pubdate?: string
  authors?: Array<{ name?: string }>
  elocationid?: string
  articleids?: Array<{ idtype?: string; value?: string }>
}

function metaFromSummary(pmid: string, result: EsummaryRecord, source: PaperMeta['source']): PaperMeta {
  const doi =
    result.articleids?.find((a) => a.idtype === 'doi')?.value ||
    result.elocationid?.replace(/^doi:\s*/i, '')

  const authors = (result.authors ?? [])
    .map((a) => a.name)
    .filter(Boolean)
    .slice(0, 8)
    .join(', ')

  const year = result.pubdate?.match(/\d{4}/)?.[0]

  return {
    title: result.title?.replace(/\.$/, '') || `PMID ${pmid}`,
    authors: authors || undefined,
    journal: result.fulljournalname || result.source,
    year,
    pmid,
    doi,
    source,
  }
}

async function fetchSummaries(pmids: string[]): Promise<Record<string, EsummaryRecord>> {
  const res = await fetch(
    ncbiUrl('esummary.fcgi', {
      db: 'pubmed',
      id: pmids.join(','),
      retmode: 'json',
    }),
  )
  if (!res.ok) throw new Error('Could not load PubMed article metadata.')
  const json = (await res.json()) as { result?: Record<string, unknown> }
  const out: Record<string, EsummaryRecord> = {}
  for (const pmid of pmids) {
    const row = json.result?.[pmid]
    if (row && typeof row === 'object' && 'title' in row) {
      out[pmid] = row as EsummaryRecord
    }
  }
  return out
}

function parseArticlesXml(
  xml: string,
  summaries: Record<string, EsummaryRecord>,
  source: PaperMeta['source'],
): Array<{ meta: PaperMeta; abstract: string }> {
  const articles = xml.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/gi) ?? []
  const out: Array<{ meta: PaperMeta; abstract: string }> = []

  for (const article of articles) {
    const pmid =
      extractTag(article, 'PMID') ||
      article.match(/<ArticleId IdType="pubmed">(\d+)<\/ArticleId>/i)?.[1]
    if (!pmid) continue

    const abstractTexts = extractAll(article, 'AbstractText')
    const abstract = abstractTexts.join('\n\n').trim()
    if (!abstract) continue

    const summary = summaries[pmid]
    const titleFromXml = extractTag(article, 'ArticleTitle')
    const meta = summary
      ? metaFromSummary(pmid, summary, source)
      : {
          title: titleFromXml?.replace(/\.$/, '') || `PMID ${pmid}`,
          pmid,
          source,
        }

    out.push({ meta, abstract })
  }

  return out
}

export async function fetchPubmedArticle(pmidOrUrl: string): Promise<{
  meta: PaperMeta
  abstract: string
}> {
  const pmid = normalisePmid(pmidOrUrl)
  const articles = await fetchPubmedArticles([pmid], 'pubmed')
  if (!articles.length) {
    throw new Error(`No abstract available for PMID ${pmid}.`)
  }
  return articles[0]
}

export async function fetchPubmedArticles(
  pmids: string[],
  source: PaperMeta['source'] = 'pubmed',
): Promise<Array<{ meta: PaperMeta; abstract: string }>> {
  if (!pmids.length) return []

  const summaries = await fetchSummaries(pmids)
  const res = await fetch(
    ncbiUrl('efetch.fcgi', {
      db: 'pubmed',
      id: pmids.join(','),
      retmode: 'xml',
      rettype: 'abstract',
    }),
  )
  if (!res.ok) throw new Error('Failed to fetch PubMed abstracts.')

  const xml = await res.text()
  const parsed = parseArticlesXml(xml, summaries, source)

  // Preserve PubMed relevance order; skip records without abstracts
  const byPmid = new Map(parsed.map((p) => [p.meta.pmid, p]))
  return pmids
    .map((id) => byPmid.get(id))
    .filter((p): p is { meta: PaperMeta; abstract: string } => Boolean(p))
}

export function guessTitleFromText(text: string): string {
  const firstLine = text
    .split(/\n+/)
    .map((l) => l.trim())
    .find(
      (l) =>
        l.length > 20 &&
        l.length < 220 &&
        !/^(abstract|background|introduction|methods?|results?|conclusions?|objective)\b/i.test(l),
    )
  return firstLine?.replace(/\s+/g, ' ') || 'Pasted abstract'
}
