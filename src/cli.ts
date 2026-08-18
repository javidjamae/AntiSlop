#!/usr/bin/env node
// antislop CLI — lint files or stdin for the mechanical tells of AI prose.
//
//   antislop file.md [more.md ...] [--strict] [--json]
//   cat draft.md | antislop [--strict]
//
// Markdown frontmatter title/description are linted as their own surfaces —
// AI tells leak into metadata more often than anyone checks. Exit 1 when
// anything fires (pre-commit-hook ready), 0 clean, 2 usage error.
import { readFileSync } from 'node:fs'
import { lint, format, NEUTRAL, STRICT, type Violation } from './index.js'

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const asJson = args.includes('--json')
const paths = args.filter((a) => !a.startsWith('--'))
const rules = strict ? STRICT : NEUTRAL

interface FileReport {
  file: string
  violations: Violation[]
}

function lintDocument(name: string, raw: string): FileReport {
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/)
  const front = fm ? fm[1] : ''
  const body = fm ? raw.slice(fm[0].length) : raw
  const bodyOffset = fm ? fm[0].split('\n').length - 1 : 0
  const field = (k: string) => front.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''

  const violations: Violation[] = [
    ...lint(field('title'), rules).map((v) => ({ ...v, rule: `title: ${v.rule}` })),
    ...lint(field('description'), rules).map((v) => ({ ...v, rule: `description: ${v.rule}` })),
    ...lint(body, rules).map((v) => ({ ...v, line: v.line + bodyOffset })),
  ]
  return { file: name, violations }
}

const reports: FileReport[] = []
if (paths.length) {
  for (const p of paths) {
    try {
      reports.push(lintDocument(p, readFileSync(p, 'utf8')))
    } catch (e) {
      console.error(`antislop: cannot read ${p}: ${(e as Error).message}`)
      process.exit(2)
    }
  }
} else {
  const stdin = readFileSync(0, 'utf8')
  if (!stdin.trim()) {
    console.error('usage: antislop <file.md> [...] [--strict] [--json], or pipe text on stdin')
    process.exit(2)
  }
  reports.push(lintDocument('<stdin>', stdin))
}

const total = reports.reduce((n, r) => n + r.violations.length, 0)
if (asJson) {
  console.log(JSON.stringify({ total, strict, reports }, null, 2))
} else {
  for (const r of reports) {
    console.log(`\n${r.file}: ${r.violations.length} finding(s)`)
    if (r.violations.length) console.log(format(r.violations))
  }
  console.log(`\n${total} finding(s) total${strict ? ' [strict]' : ''}`)
}
process.exit(total ? 1 : 0)
