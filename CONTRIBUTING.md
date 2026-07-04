# Contributing

Thanks for helping improve this Kujo ecosystem project.

This guide is intended for standalone Kujo tools and primitives. It does not
cover the core Kujo language repo, Kujo Skills, or Kujo Workflows when those
projects have their own contribution rules.

## Development Principles

- Keep changes focused, reviewable, and tied to one user-visible concern.
- Prefer deterministic, local-first behavior.
- Do not add network calls, provider calls, timestamps, or machine-specific
  output to core command paths unless the feature explicitly requires it.
- Preserve redaction, path safety, guarded cleanup, and stable output ordering.
- Add tests for behavior changes. Bug fixes should include regression coverage.
- Avoid speculative refactors unless they directly simplify the change at hand.

## Local Setup

Use the Kujo runtime expected by this repository. Most repos support one of
these environment variables:

```bash
export KUJO_BIN=/path/to/kujo
export KUJO=/path/to/kujo
```

If `kujo` is already on your `PATH`, no extra setup may be needed.

Check the repo README, `Makefile`, `tests/`, and `scripts/` directory for the
authoritative local commands.

## Agent And Example Hygiene

Start with `README.md`, `CONTRIBUTING.md`, relevant docs, and examples before
broad source sweeps.

Treat user-facing examples as canonical copyable surfaces. Examples should be
short, runnable, and representative of the idioms humans and agents should copy.

Treat tests, fixtures, generated reports, snapshots, benchmark output, and
expected-fail demos as contract evidence, not as the first source for tutorial
examples. Keep explicit fixtures when they make failures easier to diagnose.

Exclude generated and bulk paths from broad searches unless the task explicitly
targets them. A good default sweep is:

```bash
rg --files \
  -g '!.git/**' \
  -g '!target/**' \
  -g '!dist/**' \
  -g '!build/**' \
  -g '!coverage/**' \
  -g '!node_modules/**' \
  -g '!.venv/**' \
  -g '!vendor/**'
```

Document any important search exclusions in larger cleanup or audit PRs.

## Code Standards

- Match the surrounding code style before introducing a new abstraction.
- Keep command output readable and stable.
- Prefer small local helpers for repeated output, error, section, or key/value
  formatting once repetition distracts from the behavior.
- Keep CLI contracts explicit: flags, exit codes, JSON fields, artifact paths,
  and documented examples should agree with parser behavior.
- Keep config honest. A config key should either change observable behavior or
  be clearly documented as reserved.
- Preserve compatibility entrypoints and wrappers when a repo provides them.

## Kujo Runtime Notes

Kujo ecosystem tools often follow these defensive patterns:

- Prefer `while` loops in complex functions.
- Avoid duplicate local names across branches in the same function.
- Keep imports at the top of the file.
- Export functions that are imported by another module.
- Guard dictionary access with `has_key()` or local helper wrappers.
- Remember that some builtins return int-like `1`/`0` instead of booleans.
- Guard parsing operations such as JSON or TOML parsing and validate the result.
- Keep deep tree walks iterative where recursion risks VM stack limits.
- Be careful with byte-based string indexes versus character-based substring
  operations; use existing repo helpers when available.

Follow stricter runtime notes in the local repo when they exist.

## Validation

Before opening a pull request, run the strongest local validation available for
the repo.

Prefer repo-owned commands, for example:

```bash
make test
bash tests/run.sh
bash scripts/release_quality_gates.sh
```

At minimum, validate touched Kujo files and run the repo test harness:

```bash
kujo check path/to/file.kujo
kujo test
```

If the repo includes frontend, bridge, Rust, Python, shell, performance, or
security checks, run the relevant commands documented in that repo.

Tests should stay offline and deterministic unless the repo explicitly marks a
live-provider or network test as opt-in.

## Documentation And Changelog

Update docs when behavior, configuration, command output, flags, schemas,
examples, or security expectations change.

Common docs to check:

- `README.md`
- `docs/`
- command reference or flags docs
- schema or report format docs
- examples
- `CHANGELOG.md`

User-visible behavior changes should include a changelog entry when the repo has
a changelog.

## Pull Requests

A good PR includes:

- Problem statement
- Change summary
- User-visible impact
- Test evidence with commands and outcomes
- Documentation or changelog updates
- Known risks or follow-up work, if any

Keep generated artifacts out of commits unless the artifact is the reviewed
output of the change.
