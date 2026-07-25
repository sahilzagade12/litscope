# LitScope

Medical literature agent — search a topic, summarise papers, compare the evidence.

## What it does

1. **Topic search (default)** — enter a clinical / research question
2. Searches **PubMed** for relevant abstracts
3. Summarises each paper (PICO, findings, methods, limitations)
4. Builds a **comparison brief**: agreements, tensions, evidence map, gaps, bottom line

You can also paste text, fetch a single PMID, or upload a PDF.

## Run locally

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

## Modes

| Mode | Needs |
| --- | --- |
| Topic search | Internet (PubMed). No API key required. |
| Paste / PDF | Works offline with local extractive summaries |
| Optional AI | OpenAI API key in the header for richer briefs |

## Topic controls

- **Papers:** 3 / 5 / 8 abstracts to summarise
- **Evidence focus:** reviews+RCTs+guidelines, RCTs only, or any study type
- **Years:** last 5, last 10, or any year

## Notes

- PubMed via NCBI E-utilities
- Abstract-only scouting — not a systematic review
- Not medical advice; verify against full texts
