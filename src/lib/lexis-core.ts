import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import mammoth from 'mammoth'
import * as pdfjsLib from 'pdfjs-dist'
// eslint-disable-next-line import/no-unresolved
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import { createWorker } from 'tesseract.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

// ============================================================
// Text escaping / keyword parsing
// ============================================================

export function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
export function parseKeywords(raw: string): string[] {
  return raw
    .split('\n')
    .map((k) => k.trim())
    .filter(Boolean)
}

// ============================================================
// Matching engine (exact / whole-word / regex / fuzzy), unified
// around a Span model so counting, highlighting, and snippet
// extraction all share one source of truth.
// ============================================================

export interface MatchOptions {
  caseSensitive: boolean
  wholeWord: boolean
  regexMode: boolean
  fuzzy: boolean
}
export interface Span {
  index: number
  length: number
}

export function buildPattern(keyword: string, opts: MatchOptions): RegExp | null {
  const flags = opts.caseSensitive ? 'g' : 'gi'
  try {
    if (opts.regexMode) return new RegExp(keyword, flags)
    let pat = escapeRegExp(keyword)
    if (opts.wholeWord) pat = '\\b' + pat + '\\b'
    return new RegExp(pat, flags)
  } catch {
    return null
  }
}

/**
 * In regex mode, returns the subset of keywords that fail to compile as a
 * valid regular expression, so the UI can warn about them explicitly rather
 * than silently returning zero matches. Outside regex mode, always empty --
 * a plain keyword can't be an "invalid pattern" since it's escaped literally.
 */
export function invalidRegexKeywords(keywords: string[], opts: MatchOptions): string[] {
  if (!opts.regexMode) return []
  return keywords.filter((k) => {
    try {
      new RegExp(k)
      return false
    } catch {
      return true
    }
  })
}

/** Classic Levenshtein edit distance, iterative DP. */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const prev = new Array(n + 1)
  const curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]
  }
  return prev[n]
}

/** Allowed edit distance scales with keyword length: short words get none, longer get more room. */
function fuzzyThreshold(keyword: string): number {
  const len = keyword.replace(/\s/g, '').length
  if (len <= 4) return 0
  if (len <= 8) return 1
  return 2
}

/** Fuzzy phrase matching via a sliding window of tokens, compared by edit distance. */
function fuzzyFindSpans(text: string, keyword: string, caseSensitive: boolean): Span[] {
  const cmpText = caseSensitive ? text : text.toLowerCase()
  const cmpKeyword = (caseSensitive ? keyword : keyword.toLowerCase()).trim()
  if (!cmpKeyword) return []
  const wordCount = cmpKeyword.split(/\s+/).length
  const maxDist = fuzzyThreshold(cmpKeyword)

  const tokens: { word: string; start: number; end: number }[] = []
  const tokenRe = /\S+/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(cmpText))) {
    tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length })
  }

  const spans: Span[] = []
  const stripPunct = (s: string) => s.replace(/[.,;:!?()[\]"']/g, '')
  const cleanKeyword = stripPunct(cmpKeyword)

  for (let i = 0; i <= tokens.length - wordCount; i++) {
    const windowTokens = tokens.slice(i, i + wordCount)
    const windowText = windowTokens.map((t) => t.word).join(' ')
    const cleanWindow = stripPunct(windowText)
    if (Math.abs(cleanWindow.length - cleanKeyword.length) > maxDist + 2) continue // cheap pre-filter
    const dist = levenshtein(cleanWindow, cleanKeyword)
    if (dist <= maxDist) {
      spans.push({ index: windowTokens[0].start, length: windowTokens[windowTokens.length - 1].end - windowTokens[0].start })
    }
  }
  return spans
}

export function findSpans(text: string, keyword: string, opts: MatchOptions): Span[] {
  if (opts.fuzzy) return fuzzyFindSpans(text, keyword, opts.caseSensitive)
  const re = buildPattern(keyword, opts)
  if (!re) return []
  const spans: Span[] = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    spans.push({ index: m.index, length: m[0].length })
    if (m[0].length === 0) re.lastIndex++
  }
  return spans
}

export function countSpans(text: string, keyword: string, opts: MatchOptions): number {
  return findSpans(text, keyword, opts).length
}

export function mergeAndSortSpans(allSpans: Span[]): Span[] {
  const sorted = [...allSpans].sort((a, b) => a.index - b.index || b.length - a.length)
  const result: Span[] = []
  let lastEnd = -1
  for (const s of sorted) {
    if (s.index >= lastEnd) {
      result.push(s)
      lastEnd = s.index + s.length
    }
  }
  return result
}

export function highlightWithKeywords(text: string, keywords: string[], opts: MatchOptions): string {
  if (!keywords.length) return escapeHtml(text)
  const allSpans = keywords.flatMap((k) => findSpans(text, k, opts))
  const merged = mergeAndSortSpans(allSpans)
  let html = ''
  let cursor = 0
  for (const s of merged) {
    html += escapeHtml(text.slice(cursor, s.index))
    html += '<mark class="hit">' + escapeHtml(text.slice(s.index, s.index + s.length)) + '</mark>'
    cursor = s.index + s.length
  }
  html += escapeHtml(text.slice(cursor))
  return html
}

/** First-match snippet with surrounding context, or null if the keyword doesn't occur. */
export function snippetForKeyword(text: string, keyword: string, opts: MatchOptions, context = 40): string | null {
  const spans = findSpans(text, keyword, opts)
  if (!spans.length) return null
  const s = spans[0]
  const start = Math.max(0, s.index - context)
  const end = Math.min(text.length, s.index + s.length + context)
  return (start > 0 ? '\u2026' : '') + text.slice(start, end) + (end < text.length ? '\u2026' : '')
}

export function zeroMatchKeywords(perKeywordCounts: Record<string, number>): string[] {
  return Object.entries(perKeywordCounts)
    .filter(([, c]) => c === 0)
    .map(([k]) => k)
}

// ============================================================
// Word frequency (Compare mode)
// ============================================================

const STOPWORDS = new Set(
  'a an the of and or but if then else for to in on at by with from as is are was were be been being this that these those it its it\'s not no do does did have has had will would shall should can could may might must i you he she we they them his her our your their'.split(
    ' ',
  ),
)

export function topWordFrequencies(text: string, topN = 20): { word: string; count: number }[] {
  const counts = new Map<string, number>()
  const words = text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []
  for (const w of words) {
    if (STOPWORDS.has(w)) continue
    counts.set(w, (counts.get(w) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }))
}

// ============================================================
// Keyword co-occurrence (Scan mode)
// ============================================================

export function keywordCooccurrence(matchedRows: { terms: string[] }[], topN = 15): { pair: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const row of matchedRows) {
    const uniq = [...new Set(row.terms)]
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const pair = [uniq[i], uniq[j]].sort().join(' + ')
        counts.set(pair, (counts.get(pair) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([pair, count]) => ({ pair, count }))
}

// ============================================================
// File reading / text extraction
// ============================================================

export function extOf(filename: string) {
  const parts = filename.toLowerCase().split('.')
  return parts.length > 1 ? parts[parts.length - 1] : ''
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(String(e.target?.result ?? ''))
    reader.onerror = reject
    reader.readAsText(file)
  })
}

export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target?.result as ArrayBuffer)
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

async function extractPdfTextLayer(pdf: pdfjsLib.PDFDocumentProxy): Promise<string[]> {
  const pageNumbers = Array.from({ length: pdf.numPages }, (_, i) => i + 1)
  return Promise.all(
    pageNumbers.map(async (n) => {
      const page = await pdf.getPage(n)
      const content = await page.getTextContent()
      return content.items.map((it) => ('str' in it ? it.str : '')).join(' ')
    }),
  )
}

async function extractPdfTextViaOCR(pdf: pdfjsLib.PDFDocumentProxy, onProgress: (s: string) => void): Promise<string> {
  const worker = await createWorker('eng')
  try {
    const pageTexts: string[] = []
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress(`Running OCR on page ${n} of ${pdf.numPages}\u2026`)
      const page = await pdf.getPage(n)
      const viewport = page.getViewport({ scale: 2 })
      const canvas = document.createElement('canvas')
      canvas.width = viewport.width
      canvas.height = viewport.height
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      await page.render({ canvasContext: ctx, viewport, canvas }).promise
      const { data } = await worker.recognize(canvas)
      pageTexts.push(data.text)
    }
    return pageTexts.join('\n\n')
  } finally {
    await worker.terminate()
  }
}

export async function extractPdfText(file: File, onProgress: (s: string) => void): Promise<string> {
  onProgress('Reading PDF\u2026')
  const buf = await readFileAsArrayBuffer(file)
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const pageTexts = await extractPdfTextLayer(pdf)
  const combined = pageTexts.join('\n\n')
  const avgCharsPerPage = combined.replace(/\s/g, '').length / pdf.numPages
  if (avgCharsPerPage < 15) {
    onProgress('No embedded text found \u2014 running OCR, this can take a while\u2026')
    return extractPdfTextViaOCR(pdf, onProgress)
  }
  return combined
}

export async function extractDocxText(file: File): Promise<string> {
  const buf = await readFileAsArrayBuffer(file)
  const result = await mammoth.extractRawText({ arrayBuffer: buf })
  return result.value
}

export async function extractTextFromFile(file: File, onProgress: (s: string) => void): Promise<string> {
  const ext = extOf(file.name)
  if (ext === 'pdf') return extractPdfText(file, onProgress)
  if (ext === 'docx') {
    onProgress('Reading document\u2026')
    return extractDocxText(file)
  }
  return readFileAsText(file)
}

// ============================================================
// Tabular parsing (CSV / Excel with sheets / JSONL)
// ============================================================

export type Row = Record<string, string>

export function sheetToRows(workbook: XLSX.WorkBook, sheetName: string): { rows: Row[]; fields: string[] } {
  const sheet = workbook.Sheets[sheetName]
  const json = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[]
  const fields = json.length ? Object.keys(json[0]) : []
  const rows: Row[] = json.map((r) => {
    const out: Row = {}
    for (const f of fields) out[f] = String(r[f] ?? '')
    return out
  })
  return { rows, fields }
}

function flattenValue(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function parseJsonl(text: string): { rows: Row[]; fields: string[] } {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const parsed: Record<string, unknown>[] = []
  for (const line of lines) {
    try {
      const obj = JSON.parse(line)
      if (obj && typeof obj === 'object') parsed.push(obj)
    } catch {
      // skip unparseable lines
    }
  }
  const fieldSet = new Set<string>()
  parsed.forEach((r) => Object.keys(r).forEach((k) => fieldSet.add(k)))
  const fields = [...fieldSet]
  const rows: Row[] = parsed.map((r) => {
    const out: Row = {}
    for (const f of fields) out[f] = flattenValue(r[f])
    return out
  })
  return { rows, fields }
}

export interface TabularResult {
  rows: Row[]
  fields: string[]
  workbook?: XLSX.WorkBook
  sheetNames?: string[]
  activeSheet?: string
}

export function parseTabularFile(file: File, onDone: (r: TabularResult) => void, onError: () => void) {
  const ext = extOf(file.name)
  if (ext === 'xlsx' || ext === 'xls') {
    readFileAsArrayBuffer(file)
      .then((buf) => {
        const workbook = XLSX.read(buf, { type: 'array' })
        const sheetNames = workbook.SheetNames
        const activeSheet = sheetNames[0]
        const { rows, fields } = sheetToRows(workbook, activeSheet)
        onDone({ rows, fields, workbook, sheetNames, activeSheet })
      })
      .catch(onError)
  } else if (ext === 'jsonl' || ext === 'ndjson') {
    readFileAsText(file)
      .then((text) => onDone(parseJsonl(text)))
      .catch(onError)
  } else {
    Papa.parse<Row>(file, {
      header: true,
      skipEmptyLines: true,
      worker: true,
      complete: (results) => onDone({ rows: results.data, fields: results.meta.fields ?? [] }),
      error: onError,
    })
  }
}

// ============================================================
// Saved keyword lists (localStorage)
// ============================================================

export interface SavedList {
  name: string
  keywords: string
}
const LISTS_KEY = 'lexis_saved_keyword_lists_v1'

export function getSavedLists(): SavedList[] {
  try {
    const raw = localStorage.getItem(LISTS_KEY)
    return raw ? (JSON.parse(raw) as SavedList[]) : []
  } catch {
    return []
  }
}
export function saveKeywordList(name: string, keywords: string) {
  const lists = getSavedLists().filter((l) => l.name !== name)
  lists.push({ name, keywords })
  localStorage.setItem(LISTS_KEY, JSON.stringify(lists))
}
export function deleteKeywordList(name: string) {
  const lists = getSavedLists().filter((l) => l.name !== name)
  localStorage.setItem(LISTS_KEY, JSON.stringify(lists))
}

// ============================================================
// Downloads
// ============================================================

export function downloadText(filename: string, content: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadCsvRows(filename: string, rows: Record<string, unknown>[]) {
  downloadText(filename, Papa.unparse(rows), 'text/csv')
}
