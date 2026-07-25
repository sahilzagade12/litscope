import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { reviewToMarkdown } from './lib/compare'
import { fetchPubmedArticle } from './lib/pubmed'
import { runTopicResearch } from './lib/research'
import { summariseLocally, summariseWithAi, summaryToMarkdown } from './lib/summarise'
import type {
  AgentStatus,
  EvidenceFocus,
  InputMode,
  LiteratureReview,
  LiteratureSummary,
} from './types'
import './index.css'

const SAMPLE_ABSTRACT = `Background: Cryoneurolysis is an emerging intervention for chronic knee osteoarthritis pain, but high-quality evidence remains limited.
Methods: In this double-blind randomised sham-controlled trial, adults with symptomatic knee osteoarthritis were assigned to cryoneurolysis or a sham procedure. The primary outcome was change in pain intensity on a numeric rating scale at 12 weeks.
Results: Participants receiving cryoneurolysis reported greater reductions in pain scores than the sham group at 12 weeks, with a between-group difference that reached statistical significance. Secondary outcomes including function and quality of life showed mixed improvements.
Conclusions: Cryoneurolysis may reduce chronic knee osteoarthritis pain in the short term compared with sham treatment. Larger trials with longer follow-up are needed to confirm durability and safety.`

const SAMPLE_TOPIC = 'cryoneurolysis for knee osteoarthritis pain'
const API_KEY_STORAGE = 'litscope.openaiKey'

const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: '',
  searching: 'Searching PubMed',
  fetching: 'Fetching abstracts',
  summarising: 'Summarising papers',
  comparing: 'Comparing evidence',
  done: 'Complete',
  error: 'Error',
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="6" stroke="#7FD4C5" strokeWidth="2" />
        <circle cx="12" cy="12" r="2.2" fill="#F2F7F4" />
        <path d="M17 7L20.5 3.5" stroke="#7FD4C5" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
  )
}

function SummaryPanels({ summary }: { summary: LiteratureSummary }) {
  return (
    <>
      <div className="grid-2">
        <article className="panel section">
          <h3>PICO</h3>
          <div className="pico-list">
            <div className="pico-item">
              <strong>Population</strong>
              <span>{summary.pico.population}</span>
            </div>
            <div className="pico-item">
              <strong>Intervention</strong>
              <span>{summary.pico.intervention}</span>
            </div>
            <div className="pico-item">
              <strong>Comparator</strong>
              <span>{summary.pico.comparator}</span>
            </div>
            <div className="pico-item">
              <strong>Outcome</strong>
              <span>{summary.pico.outcome}</span>
            </div>
          </div>
        </article>

        <article className="panel section">
          <h3>Evidence notes</h3>
          <ul className="bullet-list">
            {summary.evidenceNotes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </div>

      <article className="panel section">
        <h3>Key findings</h3>
        <ul className="bullet-list">
          {summary.keyFindings.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </article>

      <div className="grid-2">
        <article className="panel section">
          <h3>Methods</h3>
          <ul className="bullet-list">
            {summary.methods.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article className="panel section">
          <h3>Limitations</h3>
          <ul className="bullet-list">
            {summary.limitations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </div>

      <article className="panel section">
        <h3>Clinical takeaways</h3>
        <ul className="bullet-list">
          {summary.clinicalTakeaways.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </article>
    </>
  )
}

export default function App() {
  const [mode, setMode] = useState<InputMode>('topic')
  const [topic, setTopic] = useState('')
  const [paperCount, setPaperCount] = useState(5)
  const [focus, setFocus] = useState<EvidenceFocus>('high')
  const [years, setYears] = useState<number | null>(10)
  const [pasteText, setPasteText] = useState('')
  const [pmid, setPmid] = useState('')
  const [pdfName, setPdfName] = useState<string | null>(null)
  const [pdfText, setPdfText] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<AgentStatus>('idle')
  const [statusDetail, setStatusDetail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<LiteratureSummary | null>(null)
  const [review, setReview] = useState<LiteratureReview | null>(null)
  const [expandedPmid, setExpandedPmid] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [copied, setCopied] = useState(false)
  const resultsRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem(API_KEY_STORAGE)
    if (saved) setApiKey(saved)
  }, [])

  const canSubmit = useMemo(() => {
    if (loading) return false
    if (mode === 'topic') return topic.trim().length > 2
    if (mode === 'paste') return pasteText.trim().length > 40
    if (mode === 'pubmed') return pmid.trim().length > 0
    return Boolean(pdfText)
  }, [loading, mode, topic, pasteText, pmid, pdfText])

  async function handlePdf(file: File) {
    setError(null)
    setPdfName(file.name)
    try {
      const { extractTextFromPdf } = await import('./lib/pdf')
      const text = await extractTextFromPdf(file)
      setPdfText(text)
    } catch (err) {
      setPdfText(null)
      setPdfName(null)
      setError(err instanceof Error ? err.message : 'Failed to read PDF.')
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file && file.type === 'application/pdf') {
      void handlePdf(file)
    } else {
      setError('Please drop a PDF file.')
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setLoading(true)
    setError(null)
    setCopied(false)
    setSummary(null)
    setReview(null)
    setExpandedPmid(null)

    try {
      if (mode === 'topic') {
        const result = await runTopicResearch({
          topic,
          retmax: paperCount,
          focus,
          years,
          summariseOptions: { apiKey },
          onProgress: ({ status: next, detail }) => {
            setStatus(next)
            setStatusDetail(detail)
          },
        })
        setReview(result)
        setStatus('done')
      } else {
        setStatus('summarising')
        setStatusDetail('Summarising…')

        let text = ''
        let meta: LiteratureSummary['meta'] | undefined

        if (mode === 'paste') {
          text = pasteText
          meta = { title: '', source: 'paste' }
        } else if (mode === 'pubmed') {
          const article = await fetchPubmedArticle(pmid)
          text = article.abstract
          meta = article.meta
        } else {
          if (!pdfText) throw new Error('Upload a PDF first.')
          text = pdfText
          meta = { title: pdfName?.replace(/\.pdf$/i, '') || 'Uploaded PDF', source: 'pdf' }
        }

        const result = apiKey.trim()
          ? await summariseWithAi(text, meta, { apiKey })
          : summariseLocally(text, meta)

        setSummary(result)
        setStatus('done')
      }

      requestAnimationFrame(() => {
        resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Something went wrong while researching.')
    } finally {
      setLoading(false)
    }
  }

  function saveApiKey() {
    const trimmed = apiKey.trim()
    if (trimmed) localStorage.setItem(API_KEY_STORAGE, trimmed)
    else localStorage.removeItem(API_KEY_STORAGE)
    setShowSettings(false)
  }

  async function copyMarkdown() {
    const text = review
      ? reviewToMarkdown(review)
      : summary
        ? summaryToMarkdown(summary)
        : ''
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const expandedPaper = review?.papers.find((p) => p.meta.pmid === expandedPmid) ?? null

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <BrandMark />
          <div>
            <div className="brand-name">LitScope</div>
            <p className="brand-tag">Medical literature agent</p>
          </div>
        </div>
        <button
          type="button"
          className="ghost-btn"
          onClick={() => setShowSettings((v) => !v)}
          aria-expanded={showSettings}
        >
          {apiKey ? 'AI connected' : 'Optional AI key'}
        </button>
      </header>

      <section className="hero">
        <h1>
          Ask a topic. <em>Get the papers.</em>
        </h1>
        <p>
          LitScope searches PubMed, summarises the strongest abstracts it finds, and
          compares them into one evidence brief — no paper upload required.
        </p>
      </section>

      <main className="workspace">
        {showSettings && (
          <div className="settings panel">
            <p>
              Topic search and local summaries work with no API key. Add an OpenAI key
              for richer paper briefs and synthesis. The key stays in your browser only.
            </p>
            <div className="settings-row">
              <input
                className="text-input"
                type="password"
                autoComplete="off"
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                aria-label="OpenAI API key"
              />
              <button type="button" className="primary-btn" onClick={saveApiKey}>
                Save
              </button>
            </div>
          </div>
        )}

        <form className="panel" onSubmit={onSubmit}>
          <div className="mode-tabs" role="tablist" aria-label="Input source">
            {(
              [
                ['topic', 'Topic search'],
                ['paste', 'Paste text'],
                ['pubmed', 'PubMed ID'],
                ['pdf', 'Upload PDF'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                className="mode-tab"
                aria-selected={mode === id}
                onClick={() => setMode(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'topic' && (
            <div>
              <label className="field-label" htmlFor="topic">
                Research topic
              </label>
              <input
                id="topic"
                className="text-input topic-input"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. GLP-1 agonists for heart failure with preserved ejection fraction"
              />
              <div className="controls-row">
                <label className="control">
                  <span>Papers</span>
                  <select
                    value={paperCount}
                    onChange={(e) => setPaperCount(Number(e.target.value))}
                  >
                    <option value={3}>3</option>
                    <option value={5}>5</option>
                    <option value={8}>8</option>
                  </select>
                </label>
                <label className="control">
                  <span>Evidence focus</span>
                  <select
                    value={focus}
                    onChange={(e) => setFocus(e.target.value as EvidenceFocus)}
                  >
                    <option value="high">Reviews, RCTs & guidelines</option>
                    <option value="rct">RCTs only</option>
                    <option value="any">Any study type</option>
                  </select>
                </label>
                <label className="control">
                  <span>Years</span>
                  <select
                    value={years ?? 'all'}
                    onChange={(e) =>
                      setYears(e.target.value === 'all' ? null : Number(e.target.value))
                    }
                  >
                    <option value={5}>Last 5 years</option>
                    <option value={10}>Last 10 years</option>
                    <option value="all">Any year</option>
                  </select>
                </label>
              </div>
              <p className="hint">
                Finds papers on PubMed, summarises each abstract, then compares them.{' '}
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setMode('topic')
                    setTopic(SAMPLE_TOPIC)
                    setError(null)
                  }}
                >
                  Try sample topic
                </button>
              </p>
            </div>
          )}

          {mode === 'paste' && (
            <div>
              <label className="field-label" htmlFor="paste">
                Abstract or article excerpt
              </label>
              <textarea
                id="paste"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste an abstract, discussion excerpt, or notes..."
              />
              <p className="hint">
                Tip: structured IMRaD abstracts summarise best.{' '}
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setMode('paste')
                    setPasteText(SAMPLE_ABSTRACT)
                    setError(null)
                  }}
                >
                  Load sample
                </button>
              </p>
            </div>
          )}

          {mode === 'pubmed' && (
            <div>
              <label className="field-label" htmlFor="pmid">
                PubMed ID or URL
              </label>
              <input
                id="pmid"
                className="text-input"
                value={pmid}
                onChange={(e) => setPmid(e.target.value)}
                placeholder="e.g. 38712345 or https://pubmed.ncbi.nlm.nih.gov/..."
              />
              <p className="hint">Fetches one abstract via NCBI E-utilities.</p>
            </div>
          )}

          {mode === 'pdf' && (
            <div>
              <span className="field-label">PDF manuscript</span>
              <div
                className={`file-drop${dragging ? ' dragging' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
              >
                <label>
                  Choose PDF
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) void handlePdf(file)
                    }}
                  />
                </label>
                <p className="hint">
                  {pdfName
                    ? `Loaded: ${pdfName} (${pdfText?.length.toLocaleString() ?? 0} characters)`
                    : 'Drop a PDF here — first ~12 pages are read in your browser.'}
                </p>
              </div>
            </div>
          )}

          <div className="actions">
            <button type="submit" className="primary-btn" disabled={!canSubmit}>
              {loading ? (
                <span className="loading">
                  <span className="spinner" />
                  {STATUS_LABEL[status] || 'Working…'}
                </span>
              ) : mode === 'topic' ? (
                'Find, summarise & compare'
              ) : (
                'Summarise literature'
              )}
            </button>
            <span className="hint" style={{ margin: 0 }}>
              {apiKey ? 'Using AI-assisted mode' : 'Using local extractive mode'}
            </span>
          </div>

          {loading && statusDetail && (
            <div className="progress" role="status" aria-live="polite">
              {mode === 'topic' && (
                <div className="progress-track">
                  {(['searching', 'fetching', 'summarising', 'comparing'] as const).map((step) => {
                    const order = ['searching', 'fetching', 'summarising', 'comparing'] as const
                    const currentIdx = order.indexOf(status as (typeof order)[number])
                    const current = status === 'done' ? order.length - 1 : currentIdx
                    const active = current >= order.indexOf(step)
                    return (
                      <span key={step} className={`progress-step${active ? ' on' : ''}`}>
                        {STATUS_LABEL[step]}
                      </span>
                    )
                  })}
                </div>
              )}
              <p>{statusDetail}</p>
            </div>
          )}

          {error && <div className="error" role="alert">{error}</div>}
        </form>

        {review && (
          <section className="results" ref={resultsRef} aria-live="polite">
            <article className="panel summary-head">
              <div className="meta-line">
                <span className="chip">Topic scout</span>
                <span className={`chip${review.mode === 'ai' ? ' amber' : ''}`}>
                  {review.mode === 'ai' ? 'AI-assisted' : 'Local extractive'}
                </span>
                <span className="chip">
                  {review.papersSummarised} papers · ~{review.totalFound.toLocaleString()} hits
                </span>
              </div>
              <h2>{review.topic}</h2>
              <p className="meta-details">Query: {review.queryUsed}</p>
              <p className="one-liner">{review.overview}</p>
              <div className="result-actions">
                <button type="button" className="ghost-btn" onClick={() => void copyMarkdown()}>
                  {copied ? 'Copied markdown' : 'Copy full brief'}
                </button>
              </div>
            </article>

            <div className="grid-2">
              <article className="panel section">
                <h3>Where papers agree</h3>
                <ul className="bullet-list">
                  {review.agreements.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
              <article className="panel section">
                <h3>Tensions / heterogeneity</h3>
                <ul className="bullet-list">
                  {review.tensions.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            </div>

            <div className="grid-2">
              <article className="panel section">
                <h3>Evidence map</h3>
                <ul className="bullet-list">
                  {review.evidenceMap.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
              <article className="panel section">
                <h3>Gaps</h3>
                <ul className="bullet-list">
                  {review.gaps.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            </div>

            <article className="panel section">
              <h3>Bottom line</h3>
              <ul className="bullet-list">
                {review.bottomLine.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>

            <article className="panel section">
              <h3>Comparison</h3>
              <div className="compare-scroll">
                <table className="compare-table">
                  <thead>
                    <tr>
                      <th>Year</th>
                      <th>Design</th>
                      <th>Paper</th>
                      <th>Key finding</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {review.rows.map((row) => (
                      <tr key={row.pmid || row.title}>
                        <td>{row.year || '—'}</td>
                        <td>
                          <span className="design-pill">{row.studyDesign}</span>
                        </td>
                        <td>
                          <div className="paper-title">{row.title}</div>
                          <div className="paper-sub">
                            {[row.journal, row.pmid ? `PMID ${row.pmid}` : null]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        </td>
                        <td>{row.keyFinding}</td>
                        <td>
                          <div className="row-actions">
                            {row.pmid && (
                              <button
                                type="button"
                                className="ghost-btn"
                                onClick={() =>
                                  setExpandedPmid((curr) => (curr === row.pmid ? null : row.pmid!))
                                }
                              >
                                {expandedPmid === row.pmid ? 'Hide' : 'Brief'}
                              </button>
                            )}
                            {row.pubmedUrl && (
                              <a
                                className="ghost-btn"
                                href={row.pubmedUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                PubMed
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            {expandedPaper && (
              <div className="expanded-paper">
                <article className="panel summary-head">
                  <div className="meta-line">
                    <span className="chip">{expandedPaper.studyDesign}</span>
                    {expandedPaper.meta.pmid && (
                      <span className="chip">PMID {expandedPaper.meta.pmid}</span>
                    )}
                  </div>
                  <h2>{expandedPaper.meta.title}</h2>
                  <p className="one-liner">{expandedPaper.oneLiner}</p>
                </article>
                <SummaryPanels summary={expandedPaper} />
              </div>
            )}
          </section>
        )}

        {summary && !review && (
          <section className="results" ref={resultsRef} aria-live="polite">
            <article className="panel summary-head">
              <div className="meta-line">
                <span className="chip">{summary.studyDesign}</span>
                <span className={`chip${summary.mode === 'ai' ? ' amber' : ''}`}>
                  {summary.mode === 'ai' ? 'AI-assisted' : 'Local extractive'}
                </span>
                {summary.meta.pmid && <span className="chip">PMID {summary.meta.pmid}</span>}
              </div>
              <h2>{summary.meta.title}</h2>
              {(summary.meta.authors || summary.meta.journal) && (
                <p className="meta-details">
                  {[summary.meta.authors, summary.meta.journal, summary.meta.year]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              <p className="one-liner">{summary.oneLiner}</p>
              <div className="result-actions">
                <button type="button" className="ghost-btn" onClick={() => void copyMarkdown()}>
                  {copied ? 'Copied markdown' : 'Copy as markdown'}
                </button>
                {summary.meta.pmid && (
                  <a
                    className="ghost-btn"
                    href={`https://pubmed.ncbi.nlm.nih.gov/${summary.meta.pmid}/`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in PubMed
                  </a>
                )}
              </div>
            </article>
            <SummaryPanels summary={summary} />
          </section>
        )}

        <p className="disclaimer">
          LitScope is a literature scouting aid for education and appraisal. It is not a
          systematic review, medical advice, or a substitute for reading full papers.
        </p>
      </main>
    </div>
  )
}
