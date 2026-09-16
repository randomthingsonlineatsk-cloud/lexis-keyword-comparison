import { describe, it, expect } from 'vitest'
import {
  findSpans,
  countSpans,
  buildPattern,
  invalidRegexKeywords,
  levenshtein,
  highlightWithKeywords,
  snippetForKeyword,
  zeroMatchKeywords,
  topWordFrequencies,
  keywordCooccurrence,
  parseKeywords,
  parseJsonl,
  type MatchOptions,
} from './lexis-core'

const base: MatchOptions = { caseSensitive: false, wholeWord: true, regexMode: false, fuzzy: false }

describe('exact / whole-word / case-sensitive matching', () => {
  it('counts whole-word matches correctly', () => {
    const text = 'Exclusion Criteria: prior treatment with any investigational agent. No prior treatment allowed elsewhere.'
    expect(countSpans(text, 'prior treatment', base)).toBe(2)
  })

  it('is case-insensitive by default', () => {
    const text = 'PRIOR TREATMENT and prior treatment'
    expect(countSpans(text, 'prior treatment', base)).toBe(2)
  })

  it('respects case-sensitive flag', () => {
    const text = 'Prior Treatment only, no lowercase version here'
    expect(countSpans(text, 'prior treatment', { ...base, caseSensitive: true })).toBe(0)
  })

  it('whole-word mode does not match inside a longer word', () => {
    const text = 'This has priority scheduling, not prior treatment.'
    expect(countSpans(text, 'prior', base)).toBe(1)
  })

  it('escapes special regex characters when not in regex mode', () => {
    const text = 'Cost is $500 (approx.) per visit.'
    expect(countSpans(text, '$500 (approx.)', { ...base, wholeWord: false })).toBe(1)
  })
})

describe('regex mode', () => {
  it('treats the keyword as a real regex pattern', () => {
    const text = 'Ages 65, 70, and 85 were enrolled; age 12 was excluded.'
    // matches any 2-digit number
    expect(countSpans(text, '\\b\\d{2}\\b', { ...base, regexMode: true })).toBe(4)
  })

  it('returns zero spans (not a crash) for an invalid regex pattern', () => {
    const text = 'anything'
    // unbalanced parenthesis is invalid regex syntax
    expect(() => findSpans(text, '(unclosed', { ...base, regexMode: true })).not.toThrow()
    expect(countSpans(text, '(unclosed', { ...base, regexMode: true })).toBe(0)
  })

  it('buildPattern returns null for an invalid pattern so callers can detect it', () => {
    expect(buildPattern('(unclosed', { ...base, regexMode: true })).toBeNull()
  })

  it('buildPattern returns a working RegExp for a valid pattern', () => {
    const re = buildPattern('\\d+', { ...base, regexMode: true })
    expect(re).not.toBeNull()
    expect('abc123'.match(re!)?.[0]).toBe('123')
  })

  it('invalidRegexKeywords flags only the broken patterns, in regex mode', () => {
    const keywords = ['\\d+', '(unclosed', 'valid.*pattern', '[unclosed']
    const bad = invalidRegexKeywords(keywords, { ...base, regexMode: true })
    expect(bad).toEqual(['(unclosed', '[unclosed'])
  })

  it('invalidRegexKeywords returns empty outside regex mode, even for "invalid" patterns', () => {
    const keywords = ['(unclosed', '[unclosed']
    expect(invalidRegexKeywords(keywords, { ...base, regexMode: false })).toEqual([])
  })
})

describe('fuzzy matching', () => {
  it('finds an exact match as a fuzzy match too', () => {
    const text = 'History of uncontrolled hypertension'
    expect(countSpans(text, 'uncontrolled', { ...base, fuzzy: true })).toBeGreaterThan(0)
  })

  it('finds a close misspelling within edit-distance threshold', () => {
    const text = 'Patient has uncontroled hypertension' // missing one "l" -- distance 1
    expect(countSpans(text, 'uncontrolled', { ...base, fuzzy: true })).toBeGreaterThan(0)
  })

  it('does not match a completely unrelated word', () => {
    const text = 'Patient reports mild headache only'
    expect(countSpans(text, 'uncontrolled', { ...base, fuzzy: true })).toBe(0)
  })

  it('levenshtein distance is computed correctly for known pairs', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(levenshtein('flaw', 'lawn')).toBe(2)
    expect(levenshtein('same', 'same')).toBe(0)
  })
})

describe('highlighting', () => {
  it('wraps matches in mark tags without literal backslash-u sequences', () => {
    const html = highlightWithKeywords('No prior treatment allowed.', ['prior treatment'], base)
    expect(html).toContain('<mark class="hit">prior treatment</mark>')
    expect(html).not.toMatch(/\\u[0-9a-f]{4}/i)
  })

  it('escapes HTML-unsafe characters correctly alongside highlighting', () => {
    const html = highlightWithKeywords('Value <5 mg/kg prior treatment required', ['prior treatment'], base)
    expect(html).toContain('&lt;5')
    expect(html).toContain('<mark class="hit">prior treatment</mark>')
  })

  it('prefers the longest overlapping match', () => {
    const html = highlightWithKeywords('prior treatment history', ['prior', 'prior treatment'], base)
    expect(html).toContain('<mark class="hit">prior treatment</mark>')
    expect(html).not.toContain('<mark class="hit">prior</mark> treatment')
  })
})

describe('snippet extraction', () => {
  it('returns a windowed snippet around the first match', () => {
    const text = 'filler text '.repeat(20) + 'PRIOR TREATMENT' + ' more filler text'.repeat(20)
    const snippet = snippetForKeyword(text, 'prior treatment', base, 10)
    expect(snippet).not.toBeNull()
    expect(snippet).toContain('PRIOR TREATMENT')
    expect(snippet!.length).toBeLessThan(text.length)
  })

  it('returns null when the keyword does not occur', () => {
    expect(snippetForKeyword('nothing relevant here', 'prior treatment', base)).toBeNull()
  })
})

describe('zero-match keyword detection', () => {
  it('flags only keywords with a count of exactly zero', () => {
    const counts = { found: 3, missing: 0, alsoFound: 1 }
    expect(zeroMatchKeywords(counts)).toEqual(['missing'])
  })
})

describe('word frequency', () => {
  it('excludes stopwords and counts real words', () => {
    const text = 'the patient and the doctor and the nurse discussed treatment treatment treatment'
    const freqs = topWordFrequencies(text, 5)
    const words = freqs.map((f) => f.word)
    expect(words).not.toContain('the')
    expect(words).not.toContain('and')
    expect(freqs.find((f) => f.word === 'treatment')?.count).toBe(3)
  })
})

describe('keyword co-occurrence', () => {
  it('counts pairs that appear in the same row', () => {
    const rows = [
      { terms: ['a', 'b'] },
      { terms: ['a', 'b'] },
      { terms: ['a', 'c'] },
      { terms: ['a'] },
    ]
    const result = keywordCooccurrence(rows)
    const ab = result.find((r) => r.pair === 'a + b')
    const ac = result.find((r) => r.pair === 'a + c')
    expect(ab?.count).toBe(2)
    expect(ac?.count).toBe(1)
  })
})

describe('keyword list parsing', () => {
  it('trims and drops empty lines', () => {
    expect(parseKeywords('  prior treatment  \n\nrenal impairment\n')).toEqual(['prior treatment', 'renal impairment'])
  })
})

describe('JSONL parsing', () => {
  it('parses valid lines and skips invalid ones', () => {
    const input = '{"nct_id":"NCT001","note":"severe"}\nnot valid json\n{"nct_id":"NCT002","note":"mild"}'
    const { rows, fields } = parseJsonl(input)
    expect(rows.length).toBe(2)
    expect(fields).toContain('nct_id')
    expect(rows[0].nct_id).toBe('NCT001')
  })

  it('fills missing keys with empty string when rows have different shapes', () => {
    const input = '{"a":"1","b":"2"}\n{"a":"3"}'
    const { rows } = parseJsonl(input)
    expect(rows[1].b).toBe('')
  })
})
