import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ThemeProvider, useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import {
  type MatchOptions,
  type Row,
  parseKeywords,
  countSpans,
  invalidRegexKeywords,
  highlightWithKeywords,
  snippetForKeyword,
  zeroMatchKeywords,
  topWordFrequencies,
  keywordCooccurrence,
  extractTextFromFile,
  parseTabularFile,
  sheetToRows,
  getSavedLists,
  saveKeywordList,
  deleteKeywordList,
  downloadText,
  downloadCsvRows,
} from '@/lib/lexis-core'
import * as XLSX from 'xlsx'

export const Route = createFileRoute('/')({ component: App })

function App() {
  const [mode, setMode] = useState<'docs' | 'scan'>('docs')

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <div className="min-h-screen bg-background text-foreground font-sans">
        <div className="mx-auto max-w-5xl px-5 py-10 md:py-14">
          <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="font-mono text-xl font-semibold tracking-tight md:text-2xl">
                Lexis <span className="font-normal text-muted-foreground">/ keyword comparison</span>
              </h1>
              <p className="mt-2 max-w-[50ch] text-sm text-muted-foreground">
                Find and count keywords or phrases across documents, or scan a dataset
                for rows that match — everything runs in this browser tab, nothing
                uploads anywhere.
              </p>
            </div>
            <ThemeToggle />
          </header>

          <Tabs value={mode} onValueChange={(v) => setMode(v as 'docs' | 'scan')}>
            <TabsList className="mb-6">
              <TabsTrigger value="docs">Compare documents</TabsTrigger>
              <TabsTrigger value="scan">Scan a dataset</TabsTrigger>
            </TabsList>

            <TabsContent value="docs">
              <DocsCompare />
            </TabsContent>
            <TabsContent value="scan">
              <DatasetScan />
            </TabsContent>
          </Tabs>

          <footer className="mt-14 border-t border-border pt-5">
            <p className="max-w-[70ch] text-xs text-muted-foreground">
              Runs entirely client-side: files are read and searched in your browser and
              are never sent to a server. For files too large for a browser tab to hold
              comfortably, use the companion command-line script distributed alongside
              this tool.
            </p>
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              Made by Khan Gulrez Shagufa Fazal Ahmed
            </p>
          </footer>
        </div>
      </div>
    </ThemeProvider>
  )
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return <div className="h-8 w-24" />
  const isDark = resolvedTheme === 'dark'
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className="shrink-0 rounded-sm border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
    >
      {isDark ? 'Light mode' : 'Dark mode'}
    </button>
  )
}

// ============================================================
// Shared small components
// ============================================================

function MatchOptionsRow({
  opts,
  setOpts,
  showWholeWord = true,
}: {
  opts: MatchOptions
  setOpts: (o: MatchOptions) => void
  showWholeWord?: boolean
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-5 text-xs text-muted-foreground">
      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox checked={opts.caseSensitive} onCheckedChange={(v) => setOpts({ ...opts, caseSensitive: Boolean(v) })} />
        Case-sensitive
      </label>
      {showWholeWord && !opts.regexMode && (
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={opts.wholeWord} onCheckedChange={(v) => setOpts({ ...opts, wholeWord: Boolean(v) })} />
          Whole word / phrase only
        </label>
      )}
      <label className="flex cursor-pointer items-center gap-2">
        <Checkbox
          checked={opts.regexMode}
          onCheckedChange={(v) => setOpts({ ...opts, regexMode: Boolean(v), fuzzy: v ? false : opts.fuzzy })}
        />
        Regex mode
      </label>
      {!opts.regexMode && (
        <label className="flex cursor-pointer items-center gap-2">
          <Checkbox checked={opts.fuzzy} onCheckedChange={(v) => setOpts({ ...opts, fuzzy: Boolean(v) })} />
          Fuzzy matching (slower)
        </label>
      )}
    </div>
  )
}

/** Warns, live, about any keyword that fails to compile as a regex when regex mode is on. */
function InvalidRegexNote({ keywordsRaw, opts }: { keywordsRaw: string; opts: MatchOptions }) {
  if (!opts.regexMode) return null
  const bad = invalidRegexKeywords(parseKeywords(keywordsRaw), opts)
  if (!bad.length) return null
  return (
    <p className="mt-2 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      Not valid regular expressions, so they will match nothing: {bad.join(', ')}
    </p>
  )
}

function KeywordListManager({ keywords, setKeywords }: { keywords: string; setKeywords: (v: string) => void }) {
  const [lists, setLists] = useState(() => (typeof window !== 'undefined' ? getSavedLists() : []))
  const [selected, setSelected] = useState('')
  const [saveName, setSaveName] = useState('')

  function refresh() {
    setLists(getSavedLists())
  }
  function handleLoad() {
    const found = lists.find((l) => l.name === selected)
    if (found) setKeywords(found.keywords)
  }
  function handleSave() {
    if (!saveName.trim()) return
    saveKeywordList(saveName.trim(), keywords)
    setSaveName('')
    refresh()
  }
  function handleDelete() {
    if (!selected) return
    deleteKeywordList(selected)
    setSelected('')
    refresh()
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="rounded-sm border border-border bg-background px-2 py-1.5 font-mono text-xs text-muted-foreground"
      >
        <option value="">Saved lists…</option>
        {lists.map((l) => (
          <option key={l.name} value={l.name}>
            {l.name}
          </option>
        ))}
      </select>
      <Button type="button" variant="outline" size="sm" onClick={handleLoad} disabled={!selected}>
        Load
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={handleDelete} disabled={!selected}>
        Delete
      </Button>
      <span className="mx-1 text-muted-foreground">|</span>
      <Input
        value={saveName}
        onChange={(e) => setSaveName(e.target.value)}
        placeholder="Name this list..."
        className="h-7 w-40 text-xs"
      />
      <Button type="button" variant="outline" size="sm" onClick={handleSave} disabled={!saveName.trim() || !keywords.trim()}>
        Save current
      </Button>
    </div>
  )
}

function ZeroMatchNote({ keywords }: { keywords: string[] }) {
  if (!keywords.length) return null
  return (
    <p className="mb-4 rounded-sm border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
      No matches found for: {keywords.join(', ')} — worth checking these for typos or overly narrow phrasing.
    </p>
  )
}

// ============================================================
// Compare documents (N documents)
// ============================================================

interface DocEntry {
  id: string
  label: string
  text: string
  status: string
}

function newDoc(n: number): DocEntry {
  return { id: `doc-${Date.now()}-${n}`, label: `Document ${n}`, text: '', status: '' }
}

function DocsCompare() {
  const [docs, setDocs] = useState<DocEntry[]>([newDoc(1), newDoc(2)])
  const [keywordsRaw, setKeywordsRaw] = useState('')
  const [opts, setOpts] = useState<MatchOptions>({ caseSensitive: false, wholeWord: true, regexMode: false, fuzzy: false })
  const [result, setResult] = useState<null | {
    table: { kw: string; counts: number[] }[]
    zeroMatch: string[]
  }>(null)

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  function updateDoc(id: string, patch: Partial<DocEntry>) {
    setDocs((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  async function handleFile(id: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await extractTextFromFile(file, (status) => updateDoc(id, { status }))
      updateDoc(id, { text, status: '', label: file.name })
    } catch {
      updateDoc(id, { status: 'Could not read that file.' })
    }
  }

  function addDoc() {
    setDocs((prev) => [...prev, newDoc(prev.length + 1)])
  }
  function removeDoc(id: string) {
    setDocs((prev) => (prev.length > 2 ? prev.filter((d) => d.id !== id) : prev))
  }
  function clearAll() {
    setDocs([newDoc(1), newDoc(2)])
    setKeywordsRaw('')
    setResult(null)
  }

  function runCompare() {
    const keywords = parseKeywords(keywordsRaw)
    if (docs.some((d) => !d.text.trim()) || !keywords.length) {
      setResult(null)
      return
    }
    const table = keywords.map((kw) => ({ kw, counts: docs.map((d) => countSpans(d.text, kw, opts)) }))
    const totals: Record<string, number> = {}
    table.forEach((r) => (totals[r.kw] = r.counts.reduce((a, b) => a + b, 0)))
    setResult({ table, zeroMatch: zeroMatchKeywords(totals) })
  }

  function downloadResultsCsv() {
    if (!result) return
    downloadCsvRows(
      'comparison_results.csv',
      result.table.map((r) => {
        const row: Record<string, unknown> = { keyword: r.kw }
        docs.forEach((d, i) => (row[d.label] = r.counts[i]))
        return row
      }),
    )
  }

  function downloadReport() {
    if (!result) return
    const lines: string[] = []
    lines.push(`Lexis comparison report — ${new Date().toISOString()}`)
    lines.push('')
    lines.push(
      `Options: case-sensitive=${opts.caseSensitive}, whole-word=${opts.wholeWord}, regex=${opts.regexMode}, fuzzy=${opts.fuzzy}`,
    )
    lines.push(`Documents: ${docs.map((d) => d.label).join(', ')}`)
    lines.push(`Keywords: ${parseKeywords(keywordsRaw).join(', ')}`)
    lines.push('')
    lines.push('Keyword'.padEnd(30) + docs.map((d) => d.label.padStart(14)).join(''))
    for (const r of result.table) {
      lines.push(r.kw.padEnd(30) + r.counts.map((c) => String(c).padStart(14)).join(''))
    }
    if (result.zeroMatch.length) {
      lines.push('')
      lines.push('Zero-match keywords: ' + result.zeroMatch.join(', '))
    }
    lines.push('')
    docs.forEach((d) => {
      lines.push(`Top words in ${d.label}:`)
      topWordFrequencies(d.text, 15).forEach((w) => lines.push(`  ${w.word} — ${w.count}`))
      lines.push('')
    })
    downloadText('comparison_report.txt', lines.join('\n'))
  }

  const canRun = docs.every((d) => d.text.trim()) && parseKeywords(keywordsRaw).length > 0

  return (
    <div>
      <div className="grid gap-5 md:grid-cols-2">
        {docs.map((d) => (
          <div key={d.id} className="rounded-sm border border-border bg-card p-4">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{d.label}</h2>
              {docs.length > 2 && (
                <button type="button" onClick={() => removeDoc(d.id)} className="text-xs text-muted-foreground hover:text-destructive">
                  Remove
                </button>
              )}
            </div>
            <p className="mb-3 text-xs text-muted-foreground">Paste text, or load a .txt, .md, .csv, .pdf, or .docx file.</p>
            <button
              type="button"
              className="mb-2 text-xs font-medium text-accent hover:underline disabled:opacity-50"
              onClick={() => fileRefs.current[d.id]?.click()}
              disabled={!!d.status}
            >
              Load file&hellip;
            </button>
            {d.status && <p className="mb-2 text-xs text-muted-foreground">{d.status}</p>}
            <input
              ref={(el) => {
                fileRefs.current[d.id] = el
              }}
              type="file"
              accept=".txt,.md,.csv,.pdf,.docx"
              className="hidden"
              onChange={(e) => handleFile(d.id, e)}
            />
            <Textarea
              value={d.text}
              onChange={(e) => updateDoc(d.id, { text: e.target.value })}
              placeholder={`Paste ${d.label.toLowerCase()} here`}
              className="min-h-[200px] font-mono text-xs"
            />
          </div>
        ))}
      </div>

      <div className="mt-3">
        <Button type="button" variant="outline" size="sm" onClick={addDoc}>
          + Add document
        </Button>
      </div>

      <div className="mt-5 rounded-sm border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Keywords or phrases</h2>
        <p className="mb-3 text-xs text-muted-foreground">One per line. Phrases of several words work the same as single words.</p>
        <KeywordListManager keywords={keywordsRaw} setKeywords={setKeywordsRaw} />
        <Textarea
          value={keywordsRaw}
          onChange={(e) => setKeywordsRaw(e.target.value)}
          placeholder={'e.g.\nprior treatment\ninvestigational agent\nconcurrent enrollment'}
          className="min-h-[100px] font-mono text-xs"
        />
        <MatchOptionsRow opts={opts} setOpts={setOpts} />
        <InvalidRegexNote keywordsRaw={keywordsRaw} opts={opts} />
        <div className="mt-3 flex gap-2">
          <Button onClick={runCompare} disabled={!canRun}>
            Compare
          </Button>
          <Button type="button" variant="ghost" onClick={clearAll}>
            Clear all
          </Button>
        </div>
      </div>

      <div className="mt-7">
        {!result ? (
          <div className="rounded-sm border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            Results will appear here once you compare your documents.
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Results</h3>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={downloadResultsCsv}>
                  Download CSV
                </Button>
                <Button variant="outline" size="sm" onClick={downloadReport}>
                  Download full report
                </Button>
              </div>
            </div>

            <ZeroMatchNote keywords={result.zeroMatch} />

            <table className="mb-5 w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border-b border-border py-2 text-left text-xs font-semibold text-muted-foreground">Keyword / phrase</th>
                  {docs.map((d) => (
                    <th key={d.id} className="border-b border-border py-2 text-right text-xs font-semibold text-muted-foreground">
                      {d.label}
                    </th>
                  ))}
                  {docs.length === 2 && (
                    <th className="border-b border-border py-2 text-right text-xs font-semibold text-muted-foreground">A &minus; B</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {result.table.map((r) => (
                  <tr key={r.kw}>
                    <td className="border-b border-border py-2">{r.kw}</td>
                    {r.counts.map((c, i) => (
                      <td key={i} className="border-b border-border py-2 text-right font-mono">
                        {c}
                      </td>
                    ))}
                    {docs.length === 2 && (
                      <td
                        className="border-b border-border py-2 text-right font-mono"
                        style={{
                          color:
                            r.counts[0] - r.counts[1] === 0
                              ? undefined
                              : r.counts[0] - r.counts[1] > 0
                                ? 'hsl(var(--diff-a))'
                                : 'hsl(var(--diff-b))',
                        }}
                      >
                        {r.counts[0] - r.counts[1] > 0 ? '+' : ''}
                        {r.counts[0] - r.counts[1]}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {docs.map((d) => {
              const keywords = parseKeywords(keywordsRaw)
              return (
                <div key={d.id} className="mb-5">
                  <p className="mb-1.5 font-mono text-xs text-muted-foreground">{d.label}, matches highlighted</p>
                  <div
                    className="max-h-[360px] overflow-y-auto rounded-sm border border-border bg-secondary/40 p-3.5 font-mono text-xs whitespace-pre-wrap break-words"
                    dangerouslySetInnerHTML={{ __html: highlightWithKeywords(d.text, keywords, opts) }}
                  />
                  <Collapsible className="mt-1.5">
                    <CollapsibleTrigger className="text-xs text-accent hover:underline">Word frequency ▾</CollapsibleTrigger>
                    <CollapsibleContent>
                      <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-xs text-muted-foreground sm:grid-cols-3">
                        {topWordFrequencies(d.text, 15).map((w) => (
                          <li key={w.word}>
                            {w.word} — {w.count}
                          </li>
                        ))}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Scan a dataset (single file + batch)
// ============================================================

interface MatchedRow {
  idx: number
  row: Row
  terms: string[]
  sourceFile?: string
}

function DatasetScan() {
  const [batchMode, setBatchMode] = useState(false)
  const [keywordsRaw, setKeywordsRaw] = useState('')
  const [opts, setOpts] = useState<MatchOptions>({ caseSensitive: false, wholeWord: false, regexMode: false, fuzzy: false })

  // single-file state
  const [rows, setRows] = useState<Row[]>([])
  const [fields, setFields] = useState<string[]>([])
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set())
  const [fileName, setFileName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState(false)
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [sheetNames, setSheetNames] = useState<string[]>([])
  const [activeSheet, setActiveSheet] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const [scanResult, setScanResult] = useState<null | { matched: MatchedRow[]; perKeyword: Record<string, number> }>(null)

  // batch state
  const [batchFiles, setBatchFiles] = useState<{ name: string; rows: Row[]; fields: string[] }[]>([])
  const [batchParsing, setBatchParsing] = useState(false)
  const batchFileRef = useRef<HTMLInputElement>(null)
  const [batchResult, setBatchResult] = useState<null | {
    matched: MatchedRow[]
    perKeyword: Record<string, number>
    perFile: { name: string; totalRows: number; matchedRows: number }[]
  }>(null)

  function handleDatasetFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParsing(true)
    setParseError(false)
    setScanResult(null)
    setWorkbook(null)
    setSheetNames([])
    parseTabularFile(
      file,
      (result) => {
        setRows(result.rows)
        setFields(result.fields)
        setSelectedCols(new Set(result.fields))
        if (result.workbook && result.sheetNames && result.activeSheet) {
          setWorkbook(result.workbook)
          setSheetNames(result.sheetNames)
          setActiveSheet(result.activeSheet)
        }
        setParsing(false)
      },
      () => {
        setParsing(false)
        setParseError(true)
      },
    )
  }

  function switchSheet(sheetName: string) {
    if (!workbook) return
    setActiveSheet(sheetName)
    const { rows: newRows, fields: newFields } = sheetToRows(workbook, sheetName)
    setRows(newRows)
    setFields(newFields)
    setSelectedCols(new Set(newFields))
    setScanResult(null)
  }

  function toggleCol(col: string) {
    setSelectedCols((prev) => {
      const next = new Set(prev)
      if (next.has(col)) next.delete(col)
      else next.add(col)
      return next
    })
  }

  function clearSingle() {
    setRows([])
    setFields([])
    setSelectedCols(new Set())
    setFileName('')
    setWorkbook(null)
    setSheetNames([])
    setScanResult(null)
    setKeywordsRaw('')
  }

  function runScan() {
    const keywords = parseKeywords(keywordsRaw)
    const cols = [...selectedCols]
    if (!rows.length || !keywords.length || !cols.length) {
      setScanResult(null)
      return
    }
    const perKeyword: Record<string, number> = {}
    keywords.forEach((k) => (perKeyword[k] = 0))
    const matched: MatchedRow[] = []

    rows.forEach((row, idx) => {
      const rowText = cols.map((c) => row[c] ?? '').join(' \u2022 ')
      const terms: string[] = []
      for (const kw of keywords) {
        if (countSpans(rowText, kw, opts) > 0) {
          terms.push(kw)
          perKeyword[kw]++
        }
      }
      if (terms.length) matched.push({ idx, row, terms })
    })

    setScanResult({ matched, perKeyword })
  }

  function downloadResults() {
    if (!scanResult) return
    downloadCsvRows(
      'matching_rows.csv',
      scanResult.matched.map((m) => ({ ...m.row, matched_keywords: m.terms.join('; ') })),
    )
  }

  function downloadReport() {
    if (!scanResult) return
    const keywords = parseKeywords(keywordsRaw)
    const lines: string[] = []
    lines.push(`Lexis scan report — ${new Date().toISOString()}`)
    lines.push('')
    lines.push(`File: ${fileName}${activeSheet ? ` (sheet: ${activeSheet})` : ''}`)
    lines.push(`Columns searched: ${[...selectedCols].join(', ')}`)
    lines.push(`Options: case-sensitive=${opts.caseSensitive}, whole-word=${opts.wholeWord}, regex=${opts.regexMode}, fuzzy=${opts.fuzzy}`)
    lines.push(`Keywords: ${keywords.join(', ')}`)
    lines.push('')
    lines.push(`Rows matched: ${scanResult.matched.length} / ${rows.length}`)
    lines.push('')
    Object.entries(scanResult.perKeyword).forEach(([k, c]) => lines.push(`  ${k}: ${c} rows`))
    const zero = zeroMatchKeywords(scanResult.perKeyword)
    if (zero.length) {
      lines.push('')
      lines.push('Zero-match keywords: ' + zero.join(', '))
    }
    const cooc = keywordCooccurrence(scanResult.matched)
    if (cooc.length) {
      lines.push('')
      lines.push('Keyword co-occurrence (same row):')
      cooc.forEach((c) => lines.push(`  ${c.pair}: ${c.count}`))
    }
    downloadText('scan_report.txt', lines.join('\n'))
  }

  // ---- batch mode ----
  function handleBatchFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return
    setBatchParsing(true)
    setBatchResult(null)
    const collected: { name: string; rows: Row[]; fields: string[] }[] = []
    let remaining = files.length
    files.forEach((file) => {
      parseTabularFile(
        file,
        (result) => {
          collected.push({ name: file.name, rows: result.rows, fields: result.fields })
          remaining--
          if (remaining === 0) {
            setBatchFiles(collected)
            setBatchParsing(false)
          }
        },
        () => {
          remaining--
          if (remaining === 0) {
            setBatchFiles(collected)
            setBatchParsing(false)
          }
        },
      )
    })
  }

  function runBatchScan() {
    const keywords = parseKeywords(keywordsRaw)
    if (!batchFiles.length || !keywords.length) {
      setBatchResult(null)
      return
    }
    const perKeyword: Record<string, number> = {}
    keywords.forEach((k) => (perKeyword[k] = 0))
    const matched: MatchedRow[] = []
    const perFile: { name: string; totalRows: number; matchedRows: number }[] = []

    for (const f of batchFiles) {
      let fileMatched = 0
      f.rows.forEach((row, idx) => {
        const rowText = f.fields.map((c) => row[c] ?? '').join(' \u2022 ')
        const terms: string[] = []
        for (const kw of keywords) {
          if (countSpans(rowText, kw, opts) > 0) {
            terms.push(kw)
            perKeyword[kw]++
          }
        }
        if (terms.length) {
          matched.push({ idx, row, terms, sourceFile: f.name })
          fileMatched++
        }
      })
      perFile.push({ name: f.name, totalRows: f.rows.length, matchedRows: fileMatched })
    }
    setBatchResult({ matched, perKeyword, perFile })
  }

  function downloadBatchResults() {
    if (!batchResult) return
    downloadCsvRows(
      'batch_matching_rows.csv',
      batchResult.matched.map((m) => ({ source_file: m.sourceFile, ...m.row, matched_keywords: m.terms.join('; ') })),
    )
  }

  function clearBatch() {
    setBatchFiles([])
    setBatchResult(null)
    setKeywordsRaw('')
  }

  const canRunSingle = rows.length > 0 && parseKeywords(keywordsRaw).length > 0 && selectedCols.size > 0
  const canRunBatch = batchFiles.length > 0 && parseKeywords(keywordsRaw).length > 0
  const displayLimit = 300
  const tableCols = [...selectedCols].slice(0, 6)

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-xs">
        <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
          <Checkbox checked={batchMode} onCheckedChange={(v) => setBatchMode(Boolean(v))} />
          Batch mode (scan multiple files at once)
        </label>
      </div>

      {!batchMode ? (
        <>
          <div className="rounded-sm border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Dataset</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Load a .csv, .xlsx, .xls, or .jsonl file. Large files are parsed in chunks so the tab stays responsive.
            </p>
            <button
              type="button"
              className="mb-2 text-xs font-medium text-accent hover:underline disabled:opacity-50"
              onClick={() => fileRef.current?.click()}
              disabled={parsing}
            >
              {parsing ? 'Parsing...' : 'Load dataset...'}
            </button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.jsonl,.ndjson" className="hidden" onChange={handleDatasetFile} />
            {parseError && <p className="mb-2 text-xs text-destructive">Could not read that file. Check the format.</p>}
            {fileName && !parsing && !parseError && (
              <p className="mb-2 text-xs text-muted-foreground">
                {rows.length.toLocaleString()} rows, {fields.length} columns loaded from {fileName}
                {activeSheet ? ` (sheet: ${activeSheet})` : ''}.
              </p>
            )}
            {sheetNames.length > 1 && (
              <div className="mb-3">
                <label className="mb-1 block text-xs text-muted-foreground">Sheet</label>
                <select
                  value={activeSheet}
                  onChange={(e) => switchSheet(e.target.value)}
                  className="rounded-sm border border-border bg-background px-2 py-1.5 font-mono text-xs"
                >
                  {sheetNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {fields.length > 0 && (
              <div className="flex max-h-[120px] flex-wrap gap-x-3.5 gap-y-1.5 overflow-y-auto py-1 text-xs">
                {fields.map((f) => (
                  <label key={f} className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                    <Checkbox checked={selectedCols.has(f)} onCheckedChange={() => toggleCol(f)} />
                    {f}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 rounded-sm border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Keywords or phrases</h2>
            <p className="mb-3 text-xs text-muted-foreground">One per line. Rows are flagged if any selected column contains any of these terms.</p>
            <KeywordListManager keywords={keywordsRaw} setKeywords={setKeywordsRaw} />
            <Textarea
              value={keywordsRaw}
              onChange={(e) => setKeywordsRaw(e.target.value)}
              placeholder={'e.g.\nuncontrolled\nsevere\nunstable'}
              className="min-h-[100px] font-mono text-xs"
            />
            <MatchOptionsRow opts={opts} setOpts={setOpts} />
            <InvalidRegexNote keywordsRaw={keywordsRaw} opts={opts} />
            <div className="mt-3 flex gap-2">
              <Button onClick={runScan} disabled={!canRunSingle}>
                Scan dataset
              </Button>
              <Button type="button" variant="ghost" onClick={clearSingle}>
                Clear
              </Button>
            </div>
          </div>

          <div className="mt-7">
            {!scanResult ? (
              <div className="rounded-sm border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                Load a dataset and run a scan to see matching rows here.
              </div>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap gap-6 font-mono">
                  <div>
                    <span className="block text-xl font-semibold">{scanResult.matched.length.toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground">matching rows / {rows.length.toLocaleString()} total</span>
                  </div>
                  <div>
                    <span className="block text-xl font-semibold">{Object.keys(scanResult.perKeyword).length}</span>
                    <span className="text-xs text-muted-foreground">keywords searched</span>
                  </div>
                </div>

                <ZeroMatchNote keywords={zeroMatchKeywords(scanResult.perKeyword)} />

                <table className="mb-4 w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-border py-2 text-left text-xs font-semibold text-muted-foreground">Keyword / phrase</th>
                      <th className="border-b border-border py-2 text-right text-xs font-semibold text-muted-foreground">Rows matched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(scanResult.perKeyword).map(([kw, count]) => (
                      <tr key={kw}>
                        <td className="border-b border-border py-2">{kw}</td>
                        <td className="border-b border-border py-2 text-right font-mono">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <Collapsible className="mb-4">
                  <CollapsibleTrigger className="text-xs text-accent hover:underline">Keyword co-occurrence ▾</CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="mt-2 space-y-1 font-mono text-xs text-muted-foreground">
                      {keywordCooccurrence(scanResult.matched).map((c) => (
                        <li key={c.pair}>
                          {c.pair}: {c.count} rows
                        </li>
                      ))}
                      {keywordCooccurrence(scanResult.matched).length === 0 && <li>No rows matched more than one keyword.</li>}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>

                <div className="mb-3 flex gap-2">
                  <Button variant="outline" size="sm" onClick={downloadResults}>
                    Download matching rows as CSV
                  </Button>
                  <Button variant="outline" size="sm" onClick={downloadReport}>
                    Download full report
                  </Button>
                </div>

                {scanResult.matched.length > displayLimit && (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Showing first {displayLimit} of {scanResult.matched.length.toLocaleString()} matches. Download the full results above.
                  </p>
                )}

                <div className="max-h-[460px] overflow-auto rounded-sm border border-border">
                  <table className="w-full border-collapse font-mono text-xs">
                    <thead>
                      <tr>
                        <th className="sticky top-0 bg-card px-2.5 py-1.5 text-left font-sans text-[11px] font-semibold text-muted-foreground">#</th>
                        <th className="sticky top-0 bg-card px-2.5 py-1.5 text-left font-sans text-[11px] font-semibold text-muted-foreground">
                          matched
                        </th>
                        {tableCols.map((c) => (
                          <th
                            key={c}
                            className="sticky top-0 bg-card px-2.5 py-1.5 text-left font-sans text-[11px] font-semibold text-muted-foreground"
                          >
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {scanResult.matched.slice(0, displayLimit).map((m) => (
                        <tr key={m.idx}>
                          <td className="border-b border-border px-2.5 py-1.5">{m.idx + 1}</td>
                          <td className="border-b border-border px-2.5 py-1.5">{m.terms.join(', ')}</td>
                          {tableCols.map((c) => {
                            const cellVal = String(m.row[c] ?? '')
                            const snippet = snippetForKeyword(cellVal, m.terms[0], opts, 30)
                            const display = snippet ?? cellVal.slice(0, 80)
                            return (
                              <td
                                key={c}
                                title={cellVal}
                                className="max-w-[320px] overflow-hidden border-b border-border px-2.5 py-1.5 text-ellipsis whitespace-nowrap"
                                dangerouslySetInnerHTML={{ __html: highlightWithKeywords(display, m.terms, opts) }}
                              />
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="rounded-sm border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Datasets</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Load several .csv, .xlsx, or .jsonl files at once. Every column in each file is searched (no per-column
              selection in batch mode); Excel files use their first sheet only.
            </p>
            <button
              type="button"
              className="mb-2 text-xs font-medium text-accent hover:underline disabled:opacity-50"
              onClick={() => batchFileRef.current?.click()}
              disabled={batchParsing}
            >
              {batchParsing ? 'Parsing...' : 'Load files...'}
            </button>
            <input
              ref={batchFileRef}
              type="file"
              accept=".csv,.xlsx,.xls,.jsonl,.ndjson"
              multiple
              className="hidden"
              onChange={handleBatchFiles}
            />
            {batchFiles.length > 0 && !batchParsing && (
              <p className="text-xs text-muted-foreground">
                {batchFiles.length} file{batchFiles.length > 1 ? 's' : ''} loaded (
                {batchFiles.reduce((a, f) => a + f.rows.length, 0).toLocaleString()} rows total).
              </p>
            )}
          </div>

          <div className="mt-4 rounded-sm border border-border bg-card p-4">
            <h2 className="text-sm font-semibold">Keywords or phrases</h2>
            <p className="mb-3 text-xs text-muted-foreground">One per line. Rows are flagged if any column contains any of these terms.</p>
            <KeywordListManager keywords={keywordsRaw} setKeywords={setKeywordsRaw} />
            <Textarea
              value={keywordsRaw}
              onChange={(e) => setKeywordsRaw(e.target.value)}
              placeholder={'e.g.\nuncontrolled\nsevere\nunstable'}
              className="min-h-[100px] font-mono text-xs"
            />
            <MatchOptionsRow opts={opts} setOpts={setOpts} />
            <InvalidRegexNote keywordsRaw={keywordsRaw} opts={opts} />
            <div className="mt-3 flex gap-2">
              <Button onClick={runBatchScan} disabled={!canRunBatch}>
                Scan all files
              </Button>
              <Button type="button" variant="ghost" onClick={clearBatch}>
                Clear
              </Button>
            </div>
          </div>

          <div className="mt-7">
            {!batchResult ? (
              <div className="rounded-sm border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                Load files and run a scan to see combined results here.
              </div>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap gap-6 font-mono">
                  <div>
                    <span className="block text-xl font-semibold">{batchResult.matched.length.toLocaleString()}</span>
                    <span className="text-xs text-muted-foreground">matching rows across all files</span>
                  </div>
                </div>

                <ZeroMatchNote keywords={zeroMatchKeywords(batchResult.perKeyword)} />

                <table className="mb-4 w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-border py-2 text-left text-xs font-semibold text-muted-foreground">File</th>
                      <th className="border-b border-border py-2 text-right text-xs font-semibold text-muted-foreground">Rows</th>
                      <th className="border-b border-border py-2 text-right text-xs font-semibold text-muted-foreground">Matched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchResult.perFile.map((f) => (
                      <tr key={f.name}>
                        <td className="border-b border-border py-2 font-mono text-xs">{f.name}</td>
                        <td className="border-b border-border py-2 text-right font-mono">{f.totalRows}</td>
                        <td className="border-b border-border py-2 text-right font-mono">{f.matchedRows}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <table className="mb-4 w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border-b border-border py-2 text-left text-xs font-semibold text-muted-foreground">Keyword / phrase</th>
                      <th className="border-b border-border py-2 text-right text-xs font-semibold text-muted-foreground">Rows matched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(batchResult.perKeyword).map(([kw, count]) => (
                      <tr key={kw}>
                        <td className="border-b border-border py-2">{kw}</td>
                        <td className="border-b border-border py-2 text-right font-mono">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <Button variant="outline" size="sm" onClick={downloadBatchResults}>
                  Download all matching rows as CSV
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
