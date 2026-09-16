"""
Lexis CLI — command-line companion to the Lexis web tool, for files too
large to comfortably load into a browser tab.

Two modes, mirroring the web tool exactly:

  compare   Count and highlight keyword/phrase matches across two documents.
  scan      Scan a CSV for rows containing any of a list of keywords/phrases,
            streaming row by row rather than loading the whole file into memory.

Usage:
  python lexis_cli.py compare docA.txt docB.txt --keywords keywords.txt [--case-sensitive] [--no-whole-word]
  python lexis_cli.py scan data.csv --keywords keywords.txt --columns col1,col2 [--case-sensitive] [--output matches.csv]

keywords.txt: one keyword or phrase per line.
--columns: comma-separated column names to search. Omit to search all columns.

Requires only the Python standard library -- no installation needed.
"""

import argparse
import csv
import re
import sys


def load_keywords(path):
    with open(path, encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]


def build_pattern(keyword, case_sensitive, whole_word):
    pat = re.escape(keyword)
    if whole_word:
        pat = r"\b" + pat + r"\b"
    flags = 0 if case_sensitive else re.IGNORECASE
    return re.compile(pat, flags)


def cmd_compare(args):
    keywords = load_keywords(args.keywords)
    if not keywords:
        print("No keywords found in keyword file.", file=sys.stderr)
        sys.exit(1)

    with open(args.doc_a, encoding="utf-8", errors="replace") as f:
        text_a = f.read()
    with open(args.doc_b, encoding="utf-8", errors="replace") as f:
        text_b = f.read()

    whole_word = not args.no_whole_word
    print(f"{'keyword':<40}{'doc A':>10}{'doc B':>10}{'A - B':>10}")
    print("-" * 70)
    for kw in keywords:
        pat = build_pattern(kw, args.case_sensitive, whole_word)
        count_a = len(pat.findall(text_a))
        count_b = len(pat.findall(text_b))
        diff = count_a - count_b
        diff_str = f"+{diff}" if diff > 0 else str(diff)
        print(f"{kw:<40}{count_a:>10}{count_b:>10}{diff_str:>10}")


def cmd_scan(args):
    keywords = load_keywords(args.keywords)
    if not keywords:
        print("No keywords found in keyword file.", file=sys.stderr)
        sys.exit(1)

    whole_word = False  # dataset scan matches substrings, same as the web tool
    patterns = [(kw, build_pattern(kw, args.case_sensitive, whole_word)) for kw in keywords]

    selected_columns = None
    if args.columns:
        selected_columns = [c.strip() for c in args.columns.split(",") if c.strip()]

    match_count_total = 0
    per_keyword_counts = {kw: 0 for kw in keywords}
    out_rows = []

    with open(args.csv_path, encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        cols_to_search = selected_columns if selected_columns else fieldnames

        row_count = 0
        for row in reader:
            row_count += 1
            row_text = " \u2022 ".join(str(row.get(c, "") or "") for c in cols_to_search)
            matched_terms = []
            for kw, pat in patterns:
                if pat.search(row_text):
                    matched_terms.append(kw)
                    per_keyword_counts[kw] += 1
            if matched_terms:
                match_count_total += 1
                if args.output:
                    out_row = dict(row)
                    out_row["matched_keywords"] = "; ".join(matched_terms)
                    out_rows.append(out_row)

            if row_count % 50000 == 0:
                print(f"  ...processed {row_count:,} rows", file=sys.stderr)

    print(f"\nRows scanned: {row_count:,}")
    print(f"Rows matched: {match_count_total:,}\n")
    print(f"{'keyword':<40}{'rows matched':>14}")
    print("-" * 54)
    for kw in keywords:
        print(f"{kw:<40}{per_keyword_counts[kw]:>14}")

    if args.output and out_rows:
        out_fieldnames = fieldnames + ["matched_keywords"]
        with open(args.output, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=out_fieldnames)
            writer.writeheader()
            writer.writerows(out_rows)
        print(f"\nWrote {len(out_rows):,} matching rows to {args.output}")
    elif args.output:
        print(f"\nNo matching rows -- {args.output} not written.")


def main():
    parser = argparse.ArgumentParser(description="Lexis CLI -- keyword comparison for large files.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_compare = sub.add_parser("compare", help="Compare keyword counts across two documents.")
    p_compare.add_argument("doc_a")
    p_compare.add_argument("doc_b")
    p_compare.add_argument("--keywords", required=True, help="Path to a text file, one keyword/phrase per line.")
    p_compare.add_argument("--case-sensitive", action="store_true")
    p_compare.add_argument("--no-whole-word", action="store_true", help="Match substrings instead of whole words/phrases.")
    p_compare.set_defaults(func=cmd_compare)

    p_scan = sub.add_parser("scan", help="Scan a CSV for rows matching any keyword.")
    p_scan.add_argument("csv_path")
    p_scan.add_argument("--keywords", required=True, help="Path to a text file, one keyword/phrase per line.")
    p_scan.add_argument("--columns", default=None, help="Comma-separated column names to search. Default: all columns.")
    p_scan.add_argument("--case-sensitive", action="store_true")
    p_scan.add_argument("--output", default=None, help="Path to write matching rows as a new CSV.")
    p_scan.set_defaults(func=cmd_scan)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
