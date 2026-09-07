# Changelog

Releases are cut with `npm run release -- patch|minor|major`, which promotes
the Unreleased section, syncs `package.json` and `src/version.ts`, and tags,
all from one commit. The tag is the version consumers pin.

## Unreleased

### Added

- Rule severity: `error`, `warn`, `info`. Findings carry a `severity`, and the
  CLI gains `--fail-on=error|warn|info|never` to choose which levels decide the
  exit code. Set per rule through a new `severities` map in
  `antislop.config.json`, which takes either spelling of a rule name and also
  applies to the always-on rules (they still cannot be disabled).
- `--json` output gains `failing`, `failOn`, and a `counts` breakdown by level,
  so a host scoring findings reads the weight off the finding instead of
  maintaining its own table. ([#22](https://github.com/javidjamae/AntiSlop/issues/22))
- An unrecognized `--flag` is now a usage error (exit 2) naming the valid
  options, and an unknown top-level key in `antislop.config.json` throws
  naming the valid keys. Both used to be ignored in silence. The typos this
  feature invites are `--failon=never` and `severity` for `severities`, and
  either one would otherwise leave the run gating while the author believed
  gating was off.
- `Object.keys(DEFAULT_SEVERITY)` is the rule-ID list, which lets a consumer
  drift-test the always-on rules that no `RuleSet` toggle can reach.
  `DEFAULT_SEVERITY` has a null prototype, so an inherited member name misses
  instead of returning a function that would silently never gate. Every normal
  access still works, including `Object.keys`, `in`, spread, `JSON.stringify`
  and `Object.hasOwn`. Calling `DEFAULT_SEVERITY.hasOwnProperty(...)` on it
  does not; use `Object.hasOwn(DEFAULT_SEVERITY, id)`.

### Changed

- Human-readable output prints the level per finding, as `[error]` before the
  rule name. The summary line gains a breakdown only when a run is not
  all-`error`, so an ordinary run reads as it did before. `--json` is the stable surface for
  anything parsing output.

**Exit codes are unchanged for every existing config.** Every rule that ships
declares `error` and the default threshold is `error`, so the same runs pass and
the same runs fail. Severity itself is opt-in.

Note one consequence once a rule IS moved below the threshold: exit 0 stops
meaning "no findings" and starts meaning "nothing at or above the threshold".
Printed output stays honest, since every finding is reported whatever its level
and the summary breaks down the counts, but anything reading only the exit code
cannot tell the two apart. Report a clean run with the threshold it ran at.

What else changes for everyone is the human-readable output above: each finding
now carries a `[level]` prefix. Anything parsing stdout will see it. `--json`
is the surface to parse, and it gained fields rather than changing any.

## 0.4.0 (2026-08-21)

Upgrading from 0.3.1 will surface MORE findings on prose that previously
passed, for three reasons: a new rule that defaults on, about fifteen new
vocabulary entries, and apostrophe handling that lets the existing rules see
text they were blind to. None of that is a false-positive increase; the
measured rate on human prose is in RULES.md.

### Added

- New rule `reveal-shape` (config key `revealShape`, on in NEUTRAL). The tease
  framing that withholds its point and sells the withholding, and casts the
  reader as the one getting it wrong.
  Examples: `what nobody tells you`, `the part everyone skips`,
  `this is the thing everyone gets wrong`.
  It survives rewording, so a phrase list does not reach it. Generalized from
  [Slopster](https://github.com/t0ddharris/slopster)'s `Openers.yml` (MIT).
- Default vocabulary gains the social-post and puffery tier:
  `let that sink in`, `read that again`, `imagine a world where`,
  `in the realm of`, `paradigm shift`, `unleash the power of`,
  `at the end of the day`, `best-in-class`, `world-class`,
  `next-generation`, and the `in today's` variants.
- Opt-in vocabulary packs. `"phrasePacks": ["aggressive"]` in config, or
  `--pack=aggressive` on the CLI, appends a second tier (`leverage`,
  `utilize`, `comprehensive`, `foster`, `nuanced`). Those are ordinary
  professional English that models overuse, so banning them grades writing
  QUALITY rather than flagging machine authorship. That is a per-repo voice
  choice, which is why it stays out of the defaults. An unknown pack name
  exits 2. Pack entries honor `bannedPhrases.remove`.
- `PHRASE_PACKS` and `AGGRESSIVE_PHRASES` are exported from the entrypoint.
- A corpus harness, `npm run corpus`. It measures how often each rule fires on
  101,000 lines of human prose pinned to revisions predating the generated
  web, and on generated prose paired with a human treatment of the same
  prompt. RULES.md previously claimed its rules had been swept over "a real
  published corpus" with no corpus in the repo; that claim is now a
  reproducible command and a table of measured rates. Corpus content is
  fetched at run time and never committed. The report publishes to GitHub
  Pages, to each release as an asset, and to a monthly draft PR that refreshes
  the copy in the repo. Report only, with no threshold: a gate would turn a
  judgment call into a merge blocker without improving the judgment.

### Changed

- `contrast-slop` was retuned against that corpus rather than by eye. It now
  catches modal negations (`can't`, `won't`, `cannot`) and past-copula
  reassertions (`It was a rename`), which it previously missed. It deliberately
  does NOT accept lexical-auxiliary negations (`you do not need to set this
  field. It is automatically populated` negates an action and then opens a new
  statement), because accepting them tripled the rate on human technical prose.
- Apostrophes are straightened before matching. Every contraction-bearing rule
  was blind to U+2019, so `It isn't a rewrite. It's a rename.` was a finding
  while the smart-quoted form was clean. Generated prose is smart-quoted far
  more often than plaintext corpora are, so the rules that most need to read
  model output were the ones that could not. The transformation is
  index-preserving, so reported offsets are unchanged.
- Nested banned-phrase entries report once per span. The `aggressive` pack
  bans bare `unleash` while the defaults ban `unleash the power of`, so six
  words used to produce two findings. The longer entry wins.
- Published tarballs no longer contain `dist/index.test.js`. `files: ['dist']`
  had been taking the whole directory.

### Fixed

- An unrecognized key in the config's `rules` map was silently ignored, so a
  config written from the printed rule IDs (`reversed-antithesis` rather than
  `reversedAntithesis`) looked applied, changed no exit code, and left the rule
  on. Rule IDs are now accepted as aliases for their config keys, and a name
  that is neither exits 2 listing the valid ones. Several keys are not a
  mechanical conversion of their ID (`arrow-symbol` is `arrows`,
  `horizontal-rule` is `hrDivider`), so RULES.md now carries a config-key
  column beside each rule ID.
- `contrast-slop` counted a semicolon as a sentence end, so the discourse
  marker `; that is,` read as a reassertion. The boundary is now
  sentence-final punctuation only.
- `npm run release` never updated the two install pins in the README, so
  cutting a version left both snippets pointing at the previous one. Nothing
  caught it, because the old tag resolves and installs fine.

## 0.3.1 (2026-08-18)

- Fix: the `exports` map declared only an `import` condition, so resolvers
  that take the CJS path (bundlers, ts runners) failed with
  ERR_PACKAGE_PATH_NOT_EXPORTED even though the package loads fine as ESM.
  Now declares `default`.
- Export `VERSION` from the package entrypoint so consumers can read the
  linter version they are pinned to. It was reachable only from the CLI.

- Fix: `arrow-symbol` no longer flags unrelated emoji. The rule's character
  class held the pointing-hand emoji without the `u` flag, so it matched
  either half of that astral character's surrogate pair, silently reporting
  every emoji sharing the U+D83D high surrogate (roughly U+1F400-U+1F6FF,
  including the rocket, link, skull, camera and grin emoji) as an arrow, and
  double-reporting the hand itself. The
  class is now `u`-flagged and BMP-only; the pointing hand is an emoji and
  belongs to `emoji-decoration`, which already caught it.

## 0.3.0 (2026-08-18)

- `contrast-slop` catches all four forward shapes: negation reasserted across
  a sentence boundary, the comma form ("it's not X, it's Y"),
  "not just X, but Y", and negation + dramatic consequence. Overlapping
  patterns report once per span.
- `arrow-symbol` exempts universal documentation conventions: breadcrumb/menu
  paths and pipeline notation (Capitalized tokens on both sides of a `→`) and
  leading `←` back-links. The trailing-`→` link CTA is per-site: opt in via
  `arrowExemptions.trailingCta`.
- CI workflow (tests on Node 20/22 + the docs' own strict lint) and the README
  badge row.
- `--version` flag on the CLI.
- Release tooling: `npm run release`, this changelog, and a release workflow
  that attaches an install-anywhere tarball to each GitHub Release.

## 0.2.0 (2026-08-18)

- `invisible-unicode` rule (always on): zero-width characters, soft hyphens,
  directional marks, nonstandard spaces, variation-selector runs, and the
  Unicode tag block. Ignores code/quote exemptions on purpose; carve-outs for
  emoji ZWJ sequences, emoji presentation selectors, joiner-script
  orthography, and a file-initial BOM.
- Per-project voice config (`antislop.config.json`, auto-discovered): profile,
  per-rule overrides, banned-phrase add/remove or replace, opener edits, and
  custom regex rules.

## 0.1.0 (2026-08-18)

- Initial release: 15 deterministic rules, NEUTRAL/STRICT profiles, char-level
  skip mask (code, quotes, link URLs), frontmatter title/description linted as
  separate surfaces, CLI with file/stdin input, `--json`, and hook-ready exit
  codes.
