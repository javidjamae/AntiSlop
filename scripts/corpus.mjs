#!/usr/bin/env node
// Corpus harness: measure how often each rule fires on prose that predates
// the generated web, so RULES.md can cite a number instead of a claim.
//
//   node scripts/corpus.mjs fetch     # resolve pins, download to corpus/cache
//   node scripts/corpus.mjs report    # lint the cache, write REPORT.md + .json
//   node scripts/corpus.mjs           # fetch then report
//
// Deliberately dependency-free, like the linter it measures. Node 20 has
// global fetch; nothing else is needed.
//
// WHAT THIS MEASURES. Every source is human-written and pinned before the
// cutoff, so ideally a rule fires zero times. It never does, and that is the
// point: the rate IS the false-positive tail, and it decides which profile a
// rule belongs in. A rule quiet here can default on; a rule that fires all
// over Moby Dick defaults off and ships with the number attached.
//
// WHAT THIS DOES NOT MEASURE. Recall. There is no trustworthy public corpus
// of known-generated prose, and building one by generating it would measure
// one model's habits on one day. Recall stays in the unit tests as fixtures.
// A low rate here is evidence of precision alone, and the report says so.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lint, NEUTRAL, STRICT, RULE_ID_TO_KEY } from '../dist/index.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS = join(ROOT, 'corpus')
const CACHE = join(CORPUS, 'cache')
const MANIFEST = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8'))
const LOCK_PATH = join(CORPUS, 'corpus.lock.json')

const UA = { 'user-agent': 'antislop-corpus-harness (+https://github.com/javidjamae/AntiSlop)' }
const GH = process.env.GITHUB_TOKEN ? { ...UA, authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : UA

async function getJson(url, headers = UA) {
  const r = await fetch(url, { headers })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`)
  return r.json()
}
async function getText(url, headers = UA) {
  const r = await fetch(url, { headers })
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`)
  return r.text()
}

/** Deterministic even sample: sort, then stride. Same pin gives the same
 *  files on every machine, so two reports are comparable. */
function sample(list, n) {
  const sorted = [...list].sort()
  if (sorted.length <= n) return sorted
  const stride = sorted.length / n
  return Array.from({ length: n }, (_, i) => sorted[Math.floor(i * stride)])
}

function cacheWrite(sourceId, name, text) {
  const dir = join(CACHE, sourceId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name.replace(/[^\w.-]/g, '_')), text)
}

// ---------- fetchers, one per source kind ----------

async function fetchGithub(src, cutoff) {
  const commits = await getJson(
    `https://api.github.com/repos/${src.repo}/commits?until=${encodeURIComponent(cutoff)}&per_page=1`,
    GH
  )
  const sha = commits[0].sha
  const date = commits[0].commit.committer.date
  const tree = await getJson(`https://api.github.com/repos/${src.repo}/git/trees/${sha}?recursive=1`, GH)
  if (tree.truncated) console.warn(`  ! ${src.id}: git tree truncated; sample drawn from the returned prefix`)
  const re = new RegExp(src.include)
  const paths = sample(tree.tree.filter((t) => t.type === 'blob' && re.test(t.path)).map((t) => t.path), src.sample)

  let files = 0
  for (const p of paths) {
    cacheWrite(src.id, p, await getText(`https://raw.githubusercontent.com/${src.repo}/${sha}/${p}`, UA))
    files++
  }
  return { resolved: sha, resolvedDate: date, files, detail: `${src.repo}@${sha.slice(0, 10)}` }
}

async function fetchWikipedia(src, cutoff) {
  const revisions = {}
  let files = 0
  for (const title of src.titles) {
    // Resolve the last revision BEFORE the cutoff, then fetch that exact
    // revision id. Fetching the live article would silently pull in whatever
    // has been edited into it since, which is the contamination this avoids.
    const q = await getJson(
      `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&titles=${encodeURIComponent(title)}` +
        `&rvlimit=1&rvstart=${encodeURIComponent(cutoff)}&rvdir=older&rvprop=ids%7Ctimestamp&format=json&formatversion=2`,
      UA
    )
    const rev = q.query.pages[0]?.revisions?.[0]
    if (!rev) {
      console.warn(`  ! wikipedia: no pre-cutoff revision for "${title}"`)
      continue
    }
    const raw = await getText(`https://en.wikipedia.org/w/index.php?oldid=${rev.revid}&action=raw`, UA)
    cacheWrite(src.id, `${title}.wiki`, stripWikitext(raw))
    revisions[title] = { revid: rev.revid, timestamp: rev.timestamp }
    files++
  }
  return { resolved: revisions, files, detail: `${files} articles at pinned oldids` }
}

async function fetchGutenberg(src) {
  let files = 0
  for (const book of src.books) {
    let text = null
    for (const url of [
      `https://www.gutenberg.org/files/${book.id}/${book.id}-0.txt`,
      `https://www.gutenberg.org/cache/epub/${book.id}/pg${book.id}.txt`,
    ]) {
      try {
        text = await getText(url, UA)
        break
      } catch {
        /* try the next mirror path */
      }
    }
    if (!text) {
      console.warn(`  ! gutenberg: could not fetch ${book.id} (${book.title})`)
      continue
    }
    cacheWrite(src.id, `${book.id}-${book.title}.txt`, stripGutenbergBoilerplate(text))
    files++
  }
  return { resolved: src.books.map((b) => b.id), files, detail: `${files} books` }
}

/** Gutenberg wraps each work in license boilerplate. Linting that would
 *  measure Project Gutenberg's legal text, not the author's prose. */
function stripGutenbergBoilerplate(text) {
  const start = text.search(/\*\*\*\s*START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^*]*\*\*\*/i)
  const end = text.search(/\*\*\*\s*END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK/i)
  const from = start === -1 ? 0 : text.indexOf('\n', start) + 1
  const to = end === -1 ? text.length : end
  return text.slice(from, to).trim()
}

/** Drop the markup that is machinery rather than prose: templates, refs,
 *  tables, and file links. What survives is the running text a reader sees. */
function stripWikitext(text) {
  return text
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\{\|[\s\S]*?\|\}/g, '')
    .replace(/\{\{[^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*\}\}/g, '')
    .replace(/\[\[(?:File|Image|Category):[^\]]*\]\]/gi, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '')
    .replace(/\n{3,}/g, '\n\n')
}

// ---------- commands ----------

async function cmdFetch() {
  const lock = { cutoff: MANIFEST.cutoff, generated: null, sources: {} }
  for (const src of MANIFEST.sources) {
    process.stdout.write(`fetching ${src.id} ... `)
    try {
      const r =
        src.kind === 'github'
          ? await fetchGithub(src, MANIFEST.cutoff)
          : src.kind === 'wikipedia'
            ? await fetchWikipedia(src, MANIFEST.cutoff)
            : await fetchGutenberg(src)
      lock.sources[src.id] = { kind: src.kind, license: src.license, ...r }
      console.log(`${r.files} files (${r.detail})`)
    } catch (e) {
      console.log(`FAILED: ${e.message}`)
      lock.sources[src.id] = { kind: src.kind, error: e.message, files: 0 }
    }
  }
  // Written by `report`, which knows the run timestamp; keep the pins here.
  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n')
  console.log(`\npins written to corpus/corpus.lock.json`)
}

const PROFILES = { NEUTRAL, STRICT }

/**
 * Mirror the CLI's document handling: split frontmatter off the body and lint
 * `title`/`description` as their own surfaces.
 *
 * Measured the hard way. Feeding raw text to `lint()` scored 245
 * `horizontal-rule` hits across the docs sources, and 240 of them were the
 * `---` delimiters of YAML frontmatter. That is the harness misreading a
 * document, not the linter misreading prose, and leaving it in would have put
 * a fabricated 2.52-per-1,000 rate into a report whose whole job is to be
 * trusted.
 */
function lintDocument(raw, rules) {
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/)
  const front = fm ? fm[1] : ''
  const body = fm ? raw.slice(fm[0].length) : raw
  const field = (k) => front.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim() ?? ''
  return [
    ...lint(field('title'), rules),
    ...lint(field('description'), rules),
    ...lint(body, rules),
  ]
}

/** `banned phrase: "delve"` and `banned opener: "here's why"` carry their
 *  match in the rule name. Aggregate to the family for the rate table, and
 *  keep the specific entries for the offenders list. */
function familyOf(rule) {
  const m = rule.match(/^(banned (?:phrase|opener)):/)
  return m ? m[1] : rule
}

/** Rules with no toggle at all. Mirrors ALWAYS_ON in config.ts. */
const ALWAYS_ON = new Set(['unicode-bold', 'engagement-bait', 'invisible-unicode', 'banned phrase'])

/**
 * Report a rule's NEUTRAL default by ASKING the profile rather than guessing
 * from the name. The first version of this compared `NEUTRAL[key］!== undefined`,
 * which is true for a rule set to `false`, so every off-by-default rule was
 * printed as "on" in a table whose entire job is to justify the defaults.
 */
function defaultOf(rule) {
  if (ALWAYS_ON.has(rule)) return 'always'
  const key = RULE_ID_TO_KEY[rule.replace(/ /g, '-')] ?? RULE_ID_TO_KEY[rule] ?? rule
  return NEUTRAL[key] ? 'on' : 'off'
}

function cmdReport() {
  if (!existsSync(CACHE)) {
    console.error('no corpus cache. run: node scripts/corpus.mjs fetch')
    process.exit(2)
  }
  const lock = existsSync(LOCK_PATH) ? JSON.parse(readFileSync(LOCK_PATH, 'utf8')) : { sources: {} }
  const results = {}
  const offenders = {}
  const samples = {}

  for (const src of MANIFEST.sources) {
    const dir = join(CACHE, src.id)
    if (!existsSync(dir)) continue
    const files = readdirSync(dir)
    let lines = 0
    let words = 0
    const counts = { NEUTRAL: {}, STRICT: {} }

    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8')
      lines += text.split('\n').length
      words += text.split(/\s+/).filter(Boolean).length
      for (const [profile, rules] of Object.entries(PROFILES)) {
        for (const v of lintDocument(text, rules)) {
          const fam = familyOf(v.rule)
          counts[profile][fam] = (counts[profile][fam] ?? 0) + 1
          if (profile === 'STRICT') {
            if (fam !== v.rule) offenders[v.rule] = (offenders[v.rule] ?? 0) + 1
            // Keep a few real excerpts per rule: a rate says a rule is noisy,
            // an excerpt says whether the noise is the rule's fault.
            ;(samples[fam] ??= []).length < 3 && samples[fam].push(`${src.id}: ${v.excerpt}`)
          }
        }
      }
    }
    results[src.id] = { files: files.length, lines, words, counts, register: src.register, role: src.role }
  }

  const per1k = (n, lines) => (lines ? (n * 1000) / lines : 0)
  const allRules = [...new Set(Object.values(results).flatMap((r) => Object.keys(r.counts.STRICT)))].sort()
  const totalLines = Object.values(results).reduce((n, r) => n + r.lines, 0)

  const md = []
  md.push('# Corpus report')
  md.push('')
  md.push(
    'Generated by `npm run corpus`. Every source is human-written and pinned to a revision before ' +
      `\`${MANIFEST.cutoff}\`, so a rule that fires here is firing on human prose. The rate IS the ` +
      'false-positive tail, and it is what decides whether a rule defaults on.'
  )
  md.push('')
  md.push(
    'This measures precision only. There is no trustworthy public corpus of known-generated prose, ' +
      'so recall lives in the unit tests as fixtures. A quiet rule below is evidence that it is safe ' +
      'to default on, and evidence of nothing else.'
  )
  md.push('')
  md.push('## Sources')
  md.push('')
  md.push('| Source | Files | Lines | Register | License | Pin |')
  md.push('|---|--:|--:|---|---|---|')
  for (const src of MANIFEST.sources) {
    const r = results[src.id]
    const l = lock.sources?.[src.id]
    if (!r) continue
    const pin =
      typeof l?.resolved === 'string'
        ? `\`${l.resolved.slice(0, 10)}\``
        : l?.resolvedDate
          ? l.resolvedDate
          : 'pinned ids'
    md.push(`| ${src.id} | ${r.files} | ${r.lines.toLocaleString()} | ${r.register} | ${src.license} | ${pin} |`)
  }
  md.push(`| **total** | | **${totalLines.toLocaleString()}** | | | |`)
  md.push('')
  md.push('## Findings per 1,000 lines, STRICT')
  md.push('')
  md.push('Every rule on. NEUTRAL rates follow.')
  md.push('')
  const head = MANIFEST.sources.filter((s) => results[s.id]).map((s) => s.id)
  md.push(`| Rule | ${head.join(' | ')} | all |`)
  md.push(`|---|${head.map(() => '--:').join('|')}|--:|`)
  for (const rule of allRules) {
    const cells = head.map((id) => per1k(results[id].counts.STRICT[rule] ?? 0, results[id].lines).toFixed(2))
    const total = allRules.length
      ? per1k(
          Object.values(results).reduce((n, r) => n + (r.counts.STRICT[rule] ?? 0), 0),
          totalLines
        ).toFixed(2)
      : '0'
    md.push(`| \`${rule}\` | ${cells.join(' | ')} | **${total}** |`)
  }
  md.push('')
  md.push('## Findings per 1,000 lines, NEUTRAL')
  md.push('')
  md.push('The default profile. These are the rates a user sees without `--strict`.')
  md.push('')
  const neutralRules = [...new Set(Object.values(results).flatMap((r) => Object.keys(r.counts.NEUTRAL)))].sort()
  md.push(`| Rule | ${head.join(' | ')} | all |`)
  md.push(`|---|${head.map(() => '--:').join('|')}|--:|`)
  for (const rule of neutralRules) {
    const cells = head.map((id) => per1k(results[id].counts.NEUTRAL[rule] ?? 0, results[id].lines).toFixed(2))
    const total = per1k(
      Object.values(results).reduce((n, r) => n + (r.counts.NEUTRAL[rule] ?? 0), 0),
      totalLines
    ).toFixed(2)
    md.push(`| \`${rule}\` | ${cells.join(' | ')} | **${total}** |`)
  }
  md.push('')
  // The comparison that actually decides a default. Target is the register
  // this linter is pointed at; control is prose nobody would ever lint. Loud
  // on control and quiet on target means the rule is matching English.
  const roleOf = (role) => Object.entries(results).filter(([, r]) => r.role === role)
  const roleLines = (role) => roleOf(role).reduce((n, [, r]) => n + r.lines, 0)
  const roleHits = (role, rule) => roleOf(role).reduce((n, [, r]) => n + (r.counts.STRICT[rule] ?? 0), 0)
  const tLines = roleLines('target')
  const cLines = roleLines('control')
  md.push('## Target against control, STRICT')
  md.push('')
  md.push(
    `Target is the register this linter is pointed at (${tLines.toLocaleString()} lines of technical and ` +
      `encyclopedic prose). Control is pre-1930 literary prose (${cLines.toLocaleString()} lines), included ` +
      'because nobody would run a slop linter on Moby Dick. A rule quiet on target and loud on control is ' +
      'matching English rather than machine authorship, and belongs off by default.'
  )
  md.push('')
  md.push('| Rule | Target | Control | Default |')
  md.push('|---|--:|--:|---|')
  for (const rule of allRules) {
    const dflt = defaultOf(rule)
    md.push(
      `| \`${rule}\` | ${per1k(roleHits('target', rule), tLines).toFixed(2)} | ` +
        `${per1k(roleHits('control', rule), cLines).toFixed(2)} | ${dflt} |`
    )
  }
  md.push('')
  const top = Object.entries(offenders).sort((a, b) => b[1] - a[1]).slice(0, 20)
  if (top.length) {
    md.push('## Which vocabulary entries actually fire')
    md.push('')
    md.push('An entry firing often on this corpus is a candidate for demotion to the opt-in pack.')
    md.push('')
    md.push('| Entry | Hits |')
    md.push('|---|--:|')
    for (const [rule, n] of top) md.push(`| ${rule.replace(/\|/g, '\\|')} | ${n} |`)
    md.push('')
  }
  md.push('## Sample hits')
  md.push('')
  md.push('Three real excerpts per rule. A rate says a rule is noisy; an excerpt says whose fault that is.')
  md.push('')
  for (const rule of allRules) {
    if (!samples[rule]?.length) continue
    md.push(`**\`${rule}\`**`)
    md.push('')
    for (const s of samples[rule]) md.push(`- ${s.replace(/\|/g, '\\|').slice(0, 160)}`)
    md.push('')
  }

  writeFileSync(join(CORPUS, 'REPORT.md'), md.join('\n'))
  writeFileSync(
    join(CORPUS, 'report.json'),
    JSON.stringify({ cutoff: MANIFEST.cutoff, totalLines, results }, null, 2) + '\n'
  )
  console.log(`corpus: ${totalLines.toLocaleString()} lines across ${Object.keys(results).length} sources`)
  console.log('wrote corpus/REPORT.md and corpus/report.json')
}

const cmd = process.argv[2] ?? 'all'
if (cmd === 'fetch') await cmdFetch()
else if (cmd === 'report') cmdReport()
else {
  await cmdFetch()
  cmdReport()
}
