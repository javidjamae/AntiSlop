Scheduled monthly re-measurement. Data only, no source changes.

Every source is pinned to a pre-cutoff revision, so a change in these numbers
means one of two things, and both are worth a look:

- a pinned upstream moved (a Wikipedia oldid resolving differently, a source
  repo rewriting history), or
- a rule's behaviour changed since the last run

If only the generation date moved, the measurement is unchanged and this is a
freshness stamp.

CI does not run on this PR: it was opened with the default `GITHUB_TOKEN`,
which by design does not trigger workflows. The absence of a green check here
is not a failure.
