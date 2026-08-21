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
// TWO HALVES.
//
// PRECISION. Human sources pinned before the cutoff, where a finding is by
// definition a false positive. The rate decides which profile a rule belongs
// in: quiet enough to default on, or loud enough that it ships off with the
// number attached.
//
// RECALL. Generated text PAIRED with a human treatment of the same prompt.
// Pairing is what makes the comparison mean anything: both sides cover the
// same topics, so a rate difference is the rule responding to how the text
// was written rather than to what it is about. An unpaired slop corpus would
// mostly measure subject matter.
//
// The recall number is a FLOOR, and the report says so in its own body. The
// public paired corpora are 2022-2023 generators writing essays, news, and
// answers. They are not 2026 models writing landing copy, which is the
// register where slop is thickest and where this linter is aimed.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs'
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

/**
 * Fetch with backoff.
 *
 * Added after a run silently dropped an entire domain: one GitHub secondary
 * rate-limit response, one warning that scrolled past, and a report built on
 * two thirds of the sources it claimed. A corpus harness that quietly
 * measures less than it says it does is worse than one that fails, because
 * the output still looks like a finished number.
 */
async function get(url, headers = UA, tries = 4) {
  let lastErr
  for (let i = 0; i < tries; i++) {
    // `fatal` rather than a throw: throwing the not-retryable error from
    // inside the try lands in this function's own catch, which recorded it as
    // lastErr and retried anyway. A 404 then cost the full backoff ladder —
    // and fetchGutenberg deliberately probes a mirror path that 404s for most
    // books, so every book paid seven seconds before its fallback was tried.
    let fatal = false
    try {
      const r = await fetch(url, { headers })
      if (r.ok) return r
      lastErr = new Error(`${r.status} ${r.statusText} for ${url}`)
      // 403/429 from GitHub is usually a secondary rate limit; 5xx is
      // transient. Everything else is the caller's mistake and will not fix
      // itself by waiting.
      fatal = r.status !== 403 && r.status !== 429 && r.status < 500
    } catch (e) {
      lastErr = e
    }
    if (fatal) break
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 1000 * 2 ** i))
  }
  throw lastErr
}
const getJson = async (url, headers = UA) => (await get(url, headers)).json()
const getText = async (url, headers = UA) => (await get(url, headers)).text()

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

/**
 * Paired human/machine text held as plain files in a GitHub repo, fetched at
 * a pinned SHA through the same path as the human sources. Preferred over a
 * dataset host when the data exists both ways: one fetch mechanism, one
 * pinning story, one thing that can break.
 *
 * Each domain/variant pair becomes its own cache dir so the report can score
 * `gpt` against `human` on the same prompts.
 */
async function fetchGithubPaired(src) {
  const dirs = []
  const missing = []
  let files = 0
  for (const domain of src.domains) {
    for (const [variant, role] of Object.entries(src.variants)) {
      // Scoped to the domain/variant subtree, because the whole-repo
      // recursive tree truncates before reaching every domain. Recursive
      // within that scope because layout differs per domain: essay and wp
      // hold files directly, while reuter nests them under one directory per
      // journalist. A non-recursive walk found zero blobs there and dropped
      // the entire news domain without a word.
      let tree
      try {
        tree = await getJson(
          `https://api.github.com/repos/${src.repo}/git/trees/${src.ref}:${domain}/${variant}?recursive=1`,
          GH
        )
      } catch (e) {
        missing.push(`${domain}/${variant}: ${e.message}`)
        continue
      }
      const blobs = tree.tree.filter((t) => t.type === 'blob' && t.path.endsWith('.txt')).map((t) => t.path)
      if (!blobs.length) {
        missing.push(`${domain}/${variant}: no .txt blobs in subtree`)
        continue
      }
      const paths = sample(blobs, src.sample)
      const dir = `${src.id}-${domain}-${variant}`
      for (const p of paths) {
        cacheWrite(
          dir,
          p,
          await getText(`https://raw.githubusercontent.com/${src.repo}/${src.ref}/${domain}/${variant}/${p}`, UA)
        )
        files++
      }
      if (paths.length) dirs.push({ dir, role, label: `${domain}/${variant}`, pair: domain })
    }
  }
  const expected = src.domains.length * Object.keys(src.variants).length
  return {
    resolved: src.ref,
    files,
    detail: `${dirs.length}/${expected} domain/variant sets`,
    dirs,
    ...(missing.length ? { missing } : {}),
  }
}

/**
 * Paired human/machine text from the Hugging Face datasets-server, which
 * serves rows as plain JSON over HTTP with no auth and no client library, so
 * a zero-dependency harness can read it.
 *
 * PAIRING IS THE POINT. Each row holds a human and a generated treatment of
 * the SAME prompt, so a rate difference between the two sides is the rule
 * responding to how the text was written rather than to what it is about.
 * Comparing two unrelated corpora cannot separate those.
 *
 * Writes two cache dirs per source so the report can score them separately.
 */
async function fetchHfPaired(src) {
  const dirs = { human: `${src.id}-human`, machine: `${src.id}-machine` }
  const PAGE = 100
  let got = 0
  let offset = 0
  while (got < src.pairs) {
    // Advance by what was REQUESTED, not by a fixed page size. Rows can be
    // skipped by the blank-field guard below, so a short final request used to
    // leave `offset` past rows that were never asked for, quietly biasing a
    // sample the docstring calls deterministic.
    const length = Math.min(PAGE, src.pairs - got)
    const url =
      `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(src.dataset)}` +
      `&config=${encodeURIComponent(src.config)}&split=${encodeURIComponent(src.split)}` +
      `&offset=${offset}&length=${length}`
    offset += length
    const page = await getJson(url, UA)
    if (!page.rows?.length) break
    for (const { row } of page.rows) {
      // Some columns hold a list of answers; take the first.
      const pick = (f) => (Array.isArray(row[f]) ? row[f][0] : row[f])
      const h = pick(src.humanField)
      const m = pick(src.machineField)
      if (!h?.trim() || !m?.trim()) continue
      const n = String(got).padStart(4, '0')
      cacheWrite(dirs.human, `${n}.txt`, h.trim())
      cacheWrite(dirs.machine, `${n}.txt`, m.trim())
      if (++got >= src.pairs) break
    }
  }
  return {
    files: got * 2,
    pairs: got,
    detail: `${got} pairs from ${src.dataset}/${src.config}`,
    dirs: [
      { dir: dirs.human, role: 'paired-human', label: `${src.id} (human)` },
      { dir: dirs.machine, role: 'slop', label: `${src.id} (machine)` },
    ],
  }
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
  // Wipe first. Nothing pruned per-source, so lowering a `sample`, renaming a
  // Wikipedia title, or getting fewer rows on a re-run left the previous run's
  // files behind to be counted by the next report — which breaks the "same pin
  // gives the same files on every machine" guarantee `sample()` claims.
  rmSync(CACHE, { recursive: true, force: true })
  const lock = { cutoff: MANIFEST.cutoff, generated: null, sources: {} }
  for (const src of MANIFEST.sources) {
    process.stdout.write(`fetching ${src.id} ... `)
    try {
      const FETCHERS = {
        github: () => fetchGithub(src, MANIFEST.cutoff),
        wikipedia: () => fetchWikipedia(src, MANIFEST.cutoff),
        gutenberg: () => fetchGutenberg(src),
        'github-paired': () => fetchGithubPaired(src),
        'hf-paired': () => fetchHfPaired(src),
      }
      const r = await FETCHERS[src.kind]()
      // Single-dir sources cache under their own id; paired sources declare
      // their dirs. Normalizing here keeps the report from re-deriving layout.
      const dirs = r.dirs ?? [{ dir: src.id, role: src.role ?? 'target', label: src.id }]
      lock.sources[src.id] = { kind: src.kind, license: src.license, ...r, dirs }
      console.log(`${r.files} files (${r.detail})`)
    } catch (e) {
      console.log(`FAILED: ${e.message}`)
      lock.sources[src.id] = { kind: src.kind, error: e.message, files: 0 }
    }
  }
  writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + '\n')

  // Loud, last, and in the lock. A partial corpus still produces a report
  // that looks finished, so the shortfall has to be visible in the artifact
  // rather than in scrollback.
  const broken = Object.entries(lock.sources).filter(([, s]) => s.error || s.missing?.length)
  if (broken.length) {
    console.log('\n' + '='.repeat(60))
    console.log('INCOMPLETE FETCH: the report will understate coverage')
    for (const [id, s] of broken) {
      if (s.error) console.log(`  ${id}: ${s.error}`)
      for (const m of s.missing ?? []) console.log(`  ${id}: ${m}`)
    }
    console.log('='.repeat(60))
  }
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
  // The lock is REQUIRED, not best-effort. Paired sources cache under
  // `<id>-human`/`<id>-machine`/`<id>-<domain>-<variant>`, none of which is
  // `<id>`, and their manifest role is the bare "paired" that no scoring group
  // matches. So without the lock every paired unit silently vanished and the
  // script still exited 0, publishing a headline detection table reading
  // `0.0% | 0.0% | 0.0 points`. That is precisely the failure this file's
  // header calls worse than crashing.
  if (!existsSync(LOCK_PATH)) {
    console.error('corpus.lock.json is missing — run: node scripts/corpus.mjs fetch')
    process.exit(2)
  }
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf8'))

  // A "unit" is one cache directory with a role. Human sources contribute one
  // each; a paired source contributes a human dir and a machine dir per
  // domain, which is what makes the machine-versus-human comparison possible
  // on matched prompts.
  const units = []
  const absent = []
  for (const src of MANIFEST.sources) {
    const dirs = lock.sources?.[src.id]?.dirs
    if (!dirs) {
      absent.push(`${src.id}: not in the lock`)
      continue
    }
    for (const d of dirs) {
      if (existsSync(join(CACHE, d.dir))) units.push({ ...d, src })
      else absent.push(`${d.label}: cached files missing`)
    }
  }
  if (absent.length) {
    console.error('INCOMPLETE CORPUS — the report below understates coverage:')
    for (const a of absent) console.error(`  ${a}`)
  }

  const offenders = {}
  const samples = {}
  const slopSamples = {}
  for (const u of units) {
    const files = readdirSync(join(CACHE, u.dir))
    u.files = files.length
    u.lines = 0
    u.counts = { NEUTRAL: {}, STRICT: {} }
    u.docsWithFinding = { NEUTRAL: 0, STRICT: 0 }

    for (const f of files) {
      const text = readFileSync(join(CACHE, u.dir, f), 'utf8')
      u.lines += text.split('\n').length
      for (const [profile, rules] of Object.entries(PROFILES)) {
        const hits = lintDocument(text, rules)
        if (hits.length) u.docsWithFinding[profile]++
        for (const v of hits) {
          const fam = familyOf(v.rule)
          u.counts[profile][fam] = (u.counts[profile][fam] ?? 0) + 1
          if (profile !== 'STRICT') continue
          if (fam !== v.rule && u.role !== 'slop') offenders[v.rule] = (offenders[v.rule] ?? 0) + 1
          const bag = u.role === 'slop' ? slopSamples : samples
          ;(bag[fam] ??= []).length < 3 && bag[fam].push(`${u.label}: ${v.excerpt}`)
        }
      }
    }
  }

  const per1k = (n, lines) => (lines ? (n * 1000) / lines : 0)
  const byRole = (...roles) => units.filter((u) => roles.includes(u.role))
  const linesOf = (us) => us.reduce((n, u) => n + u.lines, 0)
  const hitsOf = (us, rule, p = 'STRICT') => us.reduce((n, u) => n + (u.counts[p][rule] ?? 0), 0)
  const docsOf = (us) => us.reduce((n, u) => n + u.files, 0)
  const flaggedOf = (us, p) => us.reduce((n, u) => n + u.docsWithFinding[p], 0)

  const human = byRole('target')
  const control = byRole('control')
  const pairedHuman = byRole('paired-human')
  const slop = byRole('slop')
  const allRules = [...new Set(units.flatMap((u) => Object.keys(u.counts.STRICT)))].sort()
  const totalLines = linesOf(units)

  const md = []
  md.push('# Corpus report')
  md.push('')
  md.push(
    'Generated by `npm run corpus`. Two halves. The **human** half is prose written before the ' +
      `generated web, pinned to revisions predating \`${MANIFEST.cutoff}\`, where any finding is a ` +
      'false positive. The **machine** half is generated text paired with a human treatment of the ' +
      'same prompt, where a finding is a hit.'
  )
  md.push('')
  md.push('## Sources')
  md.push('')
  md.push('| Set | Role | Docs | Lines | Register | License |')
  md.push('|---|---|--:|--:|---|---|')
  for (const u of units) {
    md.push(
      `| ${u.label} | ${u.role} | ${u.files} | ${u.lines.toLocaleString()} | ${u.src.register} | ${u.src.license} |`
    )
  }
  md.push(`| **total** | | **${docsOf(units)}** | **${totalLines.toLocaleString()}** | | |`)
  md.push('')

  // ---- the headline: does running the linter on generated text say anything?
  md.push('## Detection: machine against its own human pair')
  md.push('')
  md.push(
    'Both sides answer the same prompts, so topic is held constant and a difference is the rule ' +
      'responding to how the text was written. Percentages are documents with at least one finding.'
  )
  md.push('')
  md.push('| Profile | Human pair | Machine | Separation |')
  md.push('|---|--:|--:|--:|')
  for (const p of ['NEUTRAL', 'STRICT']) {
    const h = (flaggedOf(pairedHuman, p) / Math.max(1, docsOf(pairedHuman))) * 100
    const m = (flaggedOf(slop, p) / Math.max(1, docsOf(slop))) * 100
    md.push(`| ${p} | ${h.toFixed(1)}% | ${m.toFixed(1)}% | ${(m - h).toFixed(1)} points |`)
  }
  md.push('')
  md.push('### Per-rule lift, STRICT')
  md.push('')
  md.push(
    'Findings per 1,000 lines on each side, and the ratio. Lift above 1 means the rule fires more ' +
      'on generated text than on human text about the same thing, which is the only evidence that a ' +
      'rule detects authorship rather than subject matter.'
  )
  md.push('')
  md.push('| Rule | Human pair | Machine | Lift |')
  md.push('|---|--:|--:|--:|')
  // Four distinct cases, and collapsing any two of them hides a real result.
  // `h>0, m=0` — fires ONLY on human text — used to render as `neither`,
  // grouped with the rules that had nothing to match. That label is what let a
  // reveal-shape false-positive bug sit in a published report looking inert
  // when it was the worst row in the table.
  const label = (h, m) =>
    h === 0 && m === 0 ? 'neither fires' : h === 0 ? 'human 0' : m === 0 ? 'MACHINE 0' : `${(m / h).toFixed(1)}x`
  const lifted = allRules
    .map((rule) => {
      const h = per1k(hitsOf(pairedHuman, rule), linesOf(pairedHuman))
      const m = per1k(hitsOf(slop, rule), linesOf(slop))
      return { rule, h, m, lift: h > 0 ? m / h : m > 0 ? Infinity : -1 }
    })
    .sort((a, b) => b.lift - a.lift || b.m - a.m)
  for (const { rule, h, m } of lifted) {
    md.push(`| \`${rule}\` | ${h.toFixed(2)} | ${m.toFixed(2)} | **${label(h, m)}** |`)
  }
  md.push('')
  md.push(
    'A rule reading `neither` mostly cannot fire on this data rather than failing to. The paired ' +
      'corpora are plain prose with no markdown, no headings, and no emoji, so the structural rules ' +
      '(`inline-header-bullet`, `bold-overuse`, `emoji-decoration`, `heading-dependent-opener`, ' +
      '`demonstrative-heading`, `horizontal-rule`) and the glyph rules have nothing to match. Judge ' +
      'those on the false-positive table below and on the unit fixtures, not here.'
  )
  md.push('')
  // DERIVED, never hardcoded. An earlier draft named the below-1 rules in a
  // literal sentence inside a report whose numbers are recomputed on every
  // monthly run, so the prose was already contradicting its own table.
  // invisible-unicode is excluded by name: it is a provenance rule, not an
  // authorship rule, so "narrow it or turn it off" is the wrong prescription
  // for it. The paragraph below states its case on its own terms.
  const below = lifted.filter((r) => r.h > 0 && r.m < r.h && r.rule !== 'invisible-unicode')
  if (below.length) {
    const worst = below
      .map((r) => `\`${r.rule}\`${r.m === 0 ? ' (never fires on machine text at all)' : ''}`)
      .join(', ')
    md.push(
      `${below.length === 1 ? 'One rule scores' : `${below.length} rules score`} BELOW 1, meaning ` +
        `${below.length === 1 ? 'it fires' : 'they fire'} more on the human side: ${worst}. A rule ` +
        'that fires more on human writing than on generated writing is not detecting authorship, ' +
        'and either belongs off by default or needs its pattern narrowed.'
    )
    md.push('')
  }
  md.push(
    '`invisible-unicode` is near zero on generated text because model output is typographically ' +
      'clean. It catches a provenance problem (watermarks, fingerprints, injection) rather than an ' +
      'authorship tell, which is why it is always on and read separately from this table.'
  )
  md.push('')
  md.push('Caveats that travel with every number above:')
  md.push('')
  for (const c of MANIFEST.slopCaveats ?? []) md.push(`- ${c}`)
  md.push('')

  // ---- precision half
  md.push('## False positives: target against control')
  md.push('')
  md.push(
    `Target is the register this linter is pointed at (${linesOf(human).toLocaleString()} lines of ` +
      `technical and encyclopedic prose). Control is pre-1930 literary prose ` +
      `(${linesOf(control).toLocaleString()} lines), included because nobody would run a slop linter on ` +
      'Moby Dick. A rule quiet on target and loud on control is matching English rather than machine ' +
      'authorship, and belongs off by default.'
  )
  md.push('')
  md.push('| Rule | Target | Control | Default |')
  md.push('|---|--:|--:|---|')
  for (const rule of allRules) {
    md.push(
      `| \`${rule}\` | ${per1k(hitsOf(human, rule), linesOf(human)).toFixed(2)} | ` +
        `${per1k(hitsOf(control, rule), linesOf(control)).toFixed(2)} | ${defaultOf(rule)} |`
    )
  }
  md.push('')
  md.push('### Per source, STRICT')
  md.push('')
  const cols = units.filter((u) => u.role === 'target' || u.role === 'control')
  md.push(`| Rule | ${cols.map((u) => u.label).join(' | ')} |`)
  md.push(`|---|${cols.map(() => '--:').join('|')}|`)
  for (const rule of allRules) {
    md.push(
      `| \`${rule}\` | ${cols.map((u) => per1k(u.counts.STRICT[rule] ?? 0, u.lines).toFixed(2)).join(' | ')} |`
    )
  }
  md.push('')

  const top = Object.entries(offenders).sort((a, b) => b[1] - a[1]).slice(0, 20)
  if (top.length) {
    md.push('## Which vocabulary entries fire on HUMAN prose')
    md.push('')
    md.push('An entry firing often here is a candidate for demotion to the opt-in pack.')
    md.push('')
    md.push('| Entry | Hits |')
    md.push('|---|--:|')
    for (const [rule, n] of top) md.push(`| ${rule.replace(/\|/g, '\\|')} | ${n} |`)
    md.push('')
  }

  for (const [title, bag] of [['Sample hits, machine text', slopSamples], ['Sample hits, human text', samples]]) {
    md.push(`## ${title}`)
    md.push('')
    for (const rule of allRules) {
      if (!bag[rule]?.length) continue
      md.push(`**\`${rule}\`**`)
      md.push('')
      for (const s of bag[rule]) md.push(`- ${s.replace(/\|/g, '\\|').slice(0, 160)}`)
      md.push('')
    }
  }

  writeFileSync(join(CORPUS, 'REPORT.md'), md.join('\n'))
  writeFileSync(
    join(CORPUS, 'report.json'),
    JSON.stringify(
      {
        cutoff: MANIFEST.cutoff,
        totalLines,
        units: units.map(({ src, ...u }) => ({ ...u, sourceId: src.id })),
      },
      null,
      2
    ) + '\n'
  )
  console.log(
    `human ${linesOf([...human, ...control]).toLocaleString()} lines | ` +
      `paired ${docsOf(pairedHuman)} human vs ${docsOf(slop)} machine docs`
  )
  console.log('wrote corpus/REPORT.md and corpus/report.json')
}

const cmd = process.argv[2] ?? 'all'
if (cmd === 'fetch') await cmdFetch()
else if (cmd === 'report') cmdReport()
else {
  await cmdFetch()
  cmdReport()
}
