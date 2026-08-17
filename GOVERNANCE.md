# Hordepin Governance

Hordepin currently uses a maintainer-led governance model.

## Roles

- **Contributors** submit Issues, documentation, tests, code, translations, or reviews.
- **Reviewers** are trusted contributors who regularly review a defined area.
- **Maintainers** triage reports, merge changes, manage releases, moderate the community, and protect project secrets and signing infrastructure.
- **Lead maintainer** resolves decisions that cannot reach consensus and appoints or removes maintainers. The current lead maintainer is the repository owner, [@lyretain](https://github.com/lyretain).

## Decisions

Routine fixes use normal pull-request review. Significant protocol, security, storage, licensing, governance, or compatibility changes require a public design Issue and reasonable time for feedback. Maintainers seek rough consensus; the lead maintainer makes the final decision when consensus is not possible.

Security-sensitive details may be discussed privately until a coordinated fix is available. Commercial deployments do not receive authority over the community project merely by funding work.

## Maintainer expectations

Maintainers must follow the Code of Conduct, disclose relevant conflicts of interest, use least-privilege access, require review for sensitive changes where practical, and document user-visible release decisions. Sustained, constructive contribution and sound judgment are the basis for adding reviewers or maintainers.

## Releases

Only maintainers with release access may publish official artifacts. A release must pass required CI, use the versions in `project-versions.json`, include human-readable notes, and identify compatibility or migration impact. Emergency security releases may use an abbreviated private review followed by public disclosure.

This document will be updated as the maintainer group grows.
