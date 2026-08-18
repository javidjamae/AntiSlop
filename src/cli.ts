#!/usr/bin/env node
// antislop CLI — lint files or stdin for the mechanical tells of AI prose.
//
//   antislop file.md [more.md ...] [--strict] [--json] [--config=path]
//   cat draft.md | antislop [--strict]
//
// Per-repo voice: an `antislop.config.json` discovered upward from each
// file's directory (or from cwd for stdin) sets the profile, rule overrides,
// site banned-phrase edits, and custom rules — so linting a file in any repo
// picks up that repo's voice no matter where the CLI was invoked from.
// `--strict` overrides the config's profile. `--config=` pins one explicitly.
//
// Markdown frontmatter title/description are linted as their own surfaces —
// AI tells leak into metadata more often than anyone checks. Exit 1 when
// anything fires (pre-commit-hook ready), 0 clean, 2 usage error.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve, parse as parsePath } from 'node:path'
import { lint, format, type Violation } from './index.js'
import { resolveConfig, type AntislopConfig, type ResolvedConfig } from './config.js'

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const asJson = args.includes('--json')
const explicitConfig = args.find((a) => a.startsWith('--config='))?.slice('--config='.length)
const paths = args.filter((a) => !a.startsWith('--'))

function discoverConfig(startDir: string): string | null {
  let dir = resolve(startDir)
  const { root } = parsePath(dir)
  for (;;) {
    const candidate = join(dir, 'antislop.config.json')
    if (existsSync(candidate)) return candidate
    if (dir === root) return null
    dir = dirname(dir)
  }
}

function loadConfig(forDir: string): ResolvedConfig {
  const path = explicitConfig ?? discoverConfig(forDir)
  let cfg: AntislopConfig = {}
  if (path) {
    try {
      cfg = JSON.parse(readFileSync(path, 'utf8')) as AntislopConfig
    } catch (e) {
      console.error(`antislop: bad config ${path}: ${(e as Error).message}`)
      process.exit(2)
    }
  }
  if (strict) cfg = { ...cfg, profile: 'strict' }
  return resolveConfig(cfg)
}

interface FileReport {
  file: string
  violations: Violation[]
}

function lintDocument(name: string, raw: string, rc: ResolvedConfig): FileReport {
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/)
  const front = fm ? fm[1] : ''
  const body = fm ? raw.slice(fm[0].length) : raw
  const bodyOffset = fm ? fm[0].split('\n').length - 1 : 0
  const field = (k: string) => front.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''

  const extras = { openers: rc.openers, customRules: rc.customRules, arrows: rc.arrows }
  const violations: Violation[] = [
    ...lint(field('title'), rc.rules, rc.banned, extras).map((v) => ({ ...v, rule: `title: ${v.rule}` })),
    ...lint(field('description'), rc.rules, rc.banned, extras).map((v) => ({ ...v, rule: `description: ${v.rule}` })),
    ...lint(body, rc.rules, rc.banned, extras).map((v) => ({ ...v, line: v.line + bodyOffset })),
  ]
  return { file: name, violations }
}

const reports: FileReport[] = []
if (paths.length) {
  for (const p of paths) {
    try {
      reports.push(lintDocument(p, readFileSync(p, 'utf8'), loadConfig(dirname(resolve(p)))))
    } catch (e) {
      console.error(`antislop: cannot read ${p}: ${(e as Error).message}`)
      process.exit(2)
    }
  }
} else {
  const stdin = readFileSync(0, 'utf8')
  if (!stdin.trim()) {
    console.error('usage: antislop <file.md> [...] [--strict] [--json] [--config=path], or pipe text on stdin')
    process.exit(2)
  }
  reports.push(lintDocument('<stdin>', stdin, loadConfig(process.cwd())))
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
