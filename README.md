# Lexis

A browser-based tool for comparing keywords or phrases across documents, and
scanning tabular datasets for matching rows. Built for research requiring
large-scale keyword comparison; everything runs client-side, so files never
leave the browser.

**Live app:** https://macaly-cumrqk2asnom26x13s972t12-prod.macaly-app.com

## What it does

- **Compare documents** — count and highlight keyword/phrase matches across
  two or more documents (.txt, .md, .csv, .pdf with OCR fallback for
  scanned pages, .docx), with word-frequency breakdowns and downloadable
  reports.
- **Scan a dataset** — flag rows in a CSV, Excel (multi-sheet), or JSONL
  file that match a keyword list, with match snippets, inline highlighting,
  keyword co-occurrence analysis, and a batch mode for scanning several
  files at once.
- **Matching modes**: exact, whole-word, regular expression (with live
  validation of malformed patterns), and fuzzy (edit-distance-based)
  matching for catching near-miss variants like misspellings.
- Saved keyword lists (browser storage), light/dark theme toggle, CSV and
  plain-text report exports.

## Repository contents

- `src/lib/lexis-core.ts` — the matching, highlighting, and file-parsing
  engine. This is the code that actually does the work; everything else is
  UI around it.
- `src/lib/lexis-core.test.ts` — a Vitest suite (26 tests) covering exact,
  whole-word, regex, and fuzzy matching; HTML-safe highlighting; snippet
  extraction; word frequency; keyword co-occurrence; and CSV/JSONL parsing.
- `src/routes/index.tsx` — the application UI (React, TanStack Router).
- `lexis_cli.py` — a command-line companion for files too large for a
  browser tab, using the same matching logic (compare and scan modes).

## Setup

This app is built on [TanStack Start](https://tanstack.com/start) with
[shadcn/ui](https://ui.shadcn.com) components and Tailwind CSS v4.

```bash
npm install
npm run dev
```

Run the test suite:

```bash
npm run test
```

Build for production:

```bash
npm run build
```

## License

MIT — see LICENSE.

## Citation

If you use Lexis in research, please cite:

Khan, G. S. F. A. (2026). *Lexis: A Browser-Based Tool for Keyword and
Phrase Comparison Across Documents and Datasets* (Version v1.0) [Computer
software]. Zenodo. https://doi.org/10.5281/zenodo.22804446

Where relevant, please also cite the dataset and monograph it was
originally developed to support:

Khan, G. S. F. A. (2026). *Global Equity in Alzheimer's Disease and Cancer
Clinical Research: Trial Representation Dataset, TREI-AC Scoring Code, and
Supporting Documentation* [Data set]. Zenodo.
https://doi.org/10.5281/zenodo.22799082
