import { compareLocally, compareWithAi } from './compare'
import { fetchPubmedArticles, searchPubmed } from './pubmed'
import { summariseLocally, summariseWithAi } from './summarise'
import type {
  AgentStatus,
  EvidenceFocus,
  LiteratureReview,
  SummariseOptions,
  TopicSearchOptions,
} from '../types'

export interface ResearchProgress {
  status: AgentStatus
  detail: string
}

export interface RunTopicResearchArgs {
  topic: string
  retmax?: number
  focus?: EvidenceFocus
  years?: number | null
  summariseOptions?: SummariseOptions
  onProgress?: (progress: ResearchProgress) => void
}

export async function runTopicResearch({
  topic,
  retmax = 5,
  focus = 'high',
  years = 10,
  summariseOptions = {},
  onProgress,
}: RunTopicResearchArgs): Promise<LiteratureReview> {
  const options: TopicSearchOptions = { retmax, focus, years }

  onProgress?.({ status: 'searching', detail: 'Searching PubMed…' })
  const search = await searchPubmed(topic, options)

  onProgress?.({
    status: 'fetching',
    detail: `Fetching ${search.pmids.length} abstracts (of ~${search.totalFound.toLocaleString()} hits)…`,
  })
  const articles = await fetchPubmedArticles(search.pmids, 'topic')

  if (!articles.length) {
    throw new Error(
      'PubMed returned hits, but none had usable abstracts. Try a different topic or broader filters.',
    )
  }

  onProgress?.({
    status: 'summarising',
    detail: `Summarising ${articles.length} paper${articles.length === 1 ? '' : 's'}…`,
  })

  const papers = []
  for (let i = 0; i < articles.length; i += 1) {
    const article = articles[i]
    onProgress?.({
      status: 'summarising',
      detail: `Summarising ${i + 1}/${articles.length}: ${article.meta.title.slice(0, 64)}…`,
    })
    const summary = summariseOptions.apiKey?.trim()
      ? await summariseWithAi(article.abstract, article.meta, summariseOptions)
      : summariseLocally(article.abstract, article.meta)
    papers.push(summary)
  }

  onProgress?.({ status: 'comparing', detail: 'Comparing papers and drafting a synthesis…' })

  const review = summariseOptions.apiKey?.trim()
    ? await compareWithAi(
        topic.trim(),
        search.queryUsed,
        search.totalFound,
        papers,
        summariseOptions,
      )
    : compareLocally(topic.trim(), search.queryUsed, search.totalFound, papers)

  onProgress?.({ status: 'done', detail: 'Done.' })
  return review
}
