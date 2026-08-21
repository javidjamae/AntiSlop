# Corpus harness

RULES.md used to say its rules had been swept over "a real published corpus."
No corpus was in the repo. This directory is that claim, made checkable.

```bash
npm run corpus          # fetch, then measure, then write the report
npm run corpus:fetch    # download to corpus/cache (gitignored)
npm run corpus:report   # measure whatever is already cached
```

## What gets measured

Every source is human-written and pinned to its last revision before
`2021-12-31`. ChatGPT shipped in November 2022 and the model-written web grew
from there, so a corpus scraped at HEAD is partly machine-written. Measuring a
false-positive rate against contaminated text flatters the linter: generated
prose sitting in the negative set makes real tells look like acceptable human
variation.

So a rule that fires here is firing on human prose. The rate IS the
false-positive tail, and it decides which profile a rule belongs in.

## Recall, and why it is a floor

The second half of the corpus is generated text **paired** with a human
treatment of the same prompt. Pairing is what makes the comparison mean
anything: both sides cover the same topics, so a rate difference is the rule
responding to how the text was written rather than to what it is about. An
unpaired slop corpus would mostly measure subject matter.

Three paired sources, listed in `manifest.json`. Ghostbuster (NAACL 2024) is
plain files in a GitHub repo, so it uses the same pinned-SHA fetch as the human
sources; GPT-wiki-intro and HC3 come from the Hugging Face datasets-server,
which serves rows as plain JSON over HTTP with no auth and no client library.

Every recall number is a **floor**, for reasons that are worth stating rather
than burying:

- The generators are GPT-3, ChatGPT 3.5, and Claude, from 2022 and 2023.
  Several tells in this linter postdate them.
- The registers are essays, news, creative writing, encyclopedia intros, and
  forum answers. None of them is the landing copy and launch-post writing where
  slop is thickest and where this linter is actually pointed.
- The text was produced by plain completion prompts rather than by someone
  asking for an engaging blog post, so the social-post tells have little chance
  to appear at all.
- The paired corpora are plain prose, so the markdown-structural rules cannot
  fire in either direction. Judge those on the false-positive table and the
  unit fixtures instead.

### What was evaluated and rejected

- **RAID** (`liamdugan/raid`): rows are grouped by adversarial attack, one of
  which is a `zero_width_space` perturbation that would corrupt the
  `invisible-unicode` measurement outright. Its filter index was also
  unavailable across repeated attempts, which is disqualifying for a job that
  has to run unattended.
- **RoFT** (`liamdugan/human-detection`): the closest thing that exists to
  human-graded slop, with 21,000 annotations of where readers think machine
  text begins. Rejected on vintage and on subject. Its generators are GPT-2,
  GPT-2-XL, and CTRL, and its annotation reasons are coherence failures
  (ungrammatical, contradicts previous text, mixes up names) rather than the
  tells this linter checks. It measures whether humans can spot an incoherent
  2020 model, which is a different question.

No public corpus records what humans *perceive* as slop in modern text. That
gap is real and this harness does not close it.

## Sources

Listed in `manifest.json` with a license and a reason for each. Four are the
target register (technical documentation and encyclopedic writing). Gutenberg
is a deliberate **control** rather than a target: pre-1930 literary prose is
definitely human and definitely not generated, so a rule that fires heavily
there is matching English rather than machine authorship. The em-dash rate on
Gutenberg is enormous. That is a fact about Victorian typography and the
reason em-dash defaults off, rather than evidence the rule is broken.

## Reproducibility

`manifest.json` holds intent (which source, which cutoff). `corpus.lock.json`
holds the resolved pins: commit SHAs for the GitHub sources, revision ids for
Wikipedia. Both are committed. Corpus content never is, which is what keeps
the repo small and the licenses somebody else's problem to grant rather than
this repo's to redistribute.

File selection is a deterministic stride over a sorted path list, so the same
pin yields the same sample on every machine.

## Reading the report

`REPORT.md` and `report.json` are written locally and published by the
`corpus` workflow: on every release (attached to the release as an asset),
monthly, and on demand.

The workflow never fails on a rate change. A threshold would convert a
judgment call into a merge blocker without improving the judgment. The report
informs a human deciding whether a rule earns its default, which is the same
decision RULES.md documents.

## What it has already caught

- `contrast-slop`, widened to accept lexical-auxiliary negations, tripled its
  rate on human technical prose. `you do not need to set this field. It is
  automatically populated` negates an action and then starts a new statement,
  which is not a reassertion. The negation side was pulled back to copulas and
  modals, cutting the added rate by more than half while keeping every true
  positive in the test fixtures.
- The boundary class `[.;:!?]` treated a semicolon as a sentence end, so the
  discourse marker `; that is,` read as a reassertion.
- The harness itself scored 245 `horizontal-rule` hits, 240 of which were the
  `---` delimiters of YAML frontmatter, because it fed raw text to `lint()`
  while the CLI splits frontmatter first. Worth knowing as a library consumer:
  `lint()` expects a body, and splitting a document is the CLI's job.
