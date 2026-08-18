# Changelog

Releases are cut with `npm run release -- patch|minor|major`, which promotes
the Unreleased section, syncs `package.json` and `src/version.ts`, and tags,
all from one commit. The tag is the version consumers pin.

## Unreleased

_Nothing yet._

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
