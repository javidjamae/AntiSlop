#!/usr/bin/env node
// antislop CLI — lint files or stdin for the mechanical tells of AI prose.
//
//   antislop file.md [more.md ...] [--strict] [--json] [--config=path]
//                     [--pack=name] [--fail-on=error|warn|info|never]
//   cat draft.md | antislop [--strict]
//
// Per-repo voice: an `antislop.config.json` discovered upward from each
// file's directory (or from cwd for stdin) sets the profile, rule overrides,
// site banned-phrase edits, and custom rules — so linting a file in any repo
// picks up that repo's voice no matter where the CLI was invoked from.
// `--strict` overrides the config's profile. `--config=` pins one explicitly.
//
// Markdown frontmatter title/description are linted as their own surfaces —
// AI tells leak into metadata more often than anyone checks.
//
// Exit 1 when anything AT OR ABOVE --fail-on fires (default `error`, which is
// every rule that ships today, so the pre-commit contract is unchanged), 0
// clean, 2 usage error. `--fail-on=never` reports without ever failing.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve, parse as parsePath } from 'node:path'
import { lint, format, SEVERITY_RANK, type Violation, type Severity } from './index.js'
import { resolveConfig, toLintExtras, type AntislopConfig, type ResolvedConfig } from './config.js'
import { VERSION } from './version.js'

const args = process.argv.slice(2)
if (args.includes('--version')) {
  console.log(VERSION)
  process.exit(0)
}
const strict = args.includes('--strict')
const asJson = args.includes('--json')
const explicitConfig = args.find((a) => a.startsWith('--config='))?.slice('--config='.length)
// Repeatable and comma-separated both work: --pack=aggressive --pack=x, or --pack=a,b
const packs = args
  .filter((a) => a.startsWith('--pack='))
  .flatMap((a) => a.slice('--pack='.length).split(',').map((s) => s.trim()).filter(Boolean))
const paths = args.filter((a) => !a.startsWith('--'))

// Every flag the CLI understands. An unrecognized `--flag` is a usage error,
// not a file and not silence. Dropping it on the floor is the same failure the
// bare `--fail-on` guard below refuses: `--failon=never` or `--fail_on=never`
// would report the finding and still exit 1, while the author believes gating
// is off. A typo in a flag must be louder than a typo in a filename.
const KNOWN_FLAGS = ['--strict', '--json', '--version'] as const
const KNOWN_FLAG_PREFIXES = ['--config=', '--pack=', '--fail-on='] as const
const unknownFlag = args.find(
  (a) =>
    a.startsWith('--') &&
    a !== '--fail-on' && // handled below, with a message about the missing value
    !(KNOWN_FLAGS as readonly string[]).includes(a) &&
    !KNOWN_FLAG_PREFIXES.some((p) => a.startsWith(p))
)
if (unknownFlag) {
  console.error(
    `antislop: unknown option "${unknownFlag}". Valid options: --strict, --json, --version, ` +
      '--config=path, --pack=name, --fail-on=error|warn|info|never'
  )
  process.exit(2)
}

// --fail-on sets which findings decide the EXIT CODE. It never changes which
// rules run or what is reported: a warn-level finding is printed either way.
const FAIL_ON_LEVELS = ['error', 'warn', 'info', 'never'] as const
// A bare `--fail-on` (or `--fail-on never`, with a space) must NOT fall through
// to the default. Silently ignoring it means the run gates while the author
// believes they turned gating off — the same failure the config layer refuses
// for an unknown rule name.
if (args.includes('--fail-on')) {
  console.error('antislop: --fail-on takes a value, as --fail-on=error|warn|info|never')
  process.exit(2)
}
const failOnRaw = args.find((a) => a.startsWith('--fail-on='))?.slice('--fail-on='.length) ?? 'error'
if (!(FAIL_ON_LEVELS as readonly string[]).includes(failOnRaw)) {
  console.error(`antislop: --fail-on must be one of ${FAIL_ON_LEVELS.join(', ')} (got "${failOnRaw}")`)
  process.exit(2)
}
const failOn = failOnRaw as (typeof FAIL_ON_LEVELS)[number]

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
  // CLI packs ADD to whatever the config already opted into, rather than
  // replacing them: --pack is a one-off widening, not a redefinition of voice.
  if (packs.length) cfg = { ...cfg, phrasePacks: [...(cfg.phrasePacks ?? []), ...packs] }
  try {
    return resolveConfig(cfg)
  } catch (e) {
    // A bad rule name is a config error, not a lint finding: exit 2 with the
    // message, never a stack trace, and never a silently-ignored override.
    console.error(`${(e as Error).message}${path ? `\n  in ${path}` : ''}`)
    process.exit(2)
  }
}

interface FileReport {
  file: string
  violations: Violation[]
}

function lintDocument(name: string, raw: string, rc: ResolvedConfig): FileReport {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n/)
  const front = frontmatterMatch ? frontmatterMatch[1] : ''
  const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw
  const bodyOffset = frontmatterMatch ? frontmatterMatch[0].split('\n').length - 1 : 0
  const field = (k: string) => front.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''

  const extras = toLintExtras(rc)
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
    console.error(
      'usage: antislop <file.md> [...] [--strict] [--json] [--config=path] [--pack=name] ' +
        '[--fail-on=error|warn|info|never], or pipe text on stdin'
    )
    process.exit(2)
  }
  reports.push(lintDocument('<stdin>', stdin, loadConfig(process.cwd())))
}

const all = reports.flatMap((r) => r.violations)
const total = all.length
const severityOfViolation = (v: Violation): Severity => v.severity ?? 'error'
const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 }
for (const v of all) counts[severityOfViolation(v)]++
// Only findings at or above the threshold decide the exit code. Everything is
// still printed: a rule set to `info` is advice, not a secret.
const failing =
  failOn === 'never' ? 0 : all.filter((v) => SEVERITY_RANK[severityOfViolation(v)] >= SEVERITY_RANK[failOn]).length

if (asJson) {
  console.log(JSON.stringify({ total, failing, failOn, counts, strict, reports }, null, 2))
} else {
  for (const r of reports) {
    console.log(`\n${r.file}: ${r.violations.length} finding(s)`)
    if (r.violations.length) console.log(format(r.violations))
  }
  // The breakdown appears only when there is something to break down, so the
  // common all-error run reads exactly as it did before.
  const mixed = counts.error !== total
  const breakdown = mixed ? ` (${counts.error} error, ${counts.warn} warn, ${counts.info} info)` : ''
  const gate = failOn === 'error' ? '' : ` [fail-on=${failOn}]`
  console.log(`\n${total} finding(s) total${breakdown}${strict ? ' [strict]' : ''}${gate}`)
}
process.exit(failing ? 1 : 0)
