# Security Policy

RVLT Flow handles production customer data (inventory, crew, clients). We take
security reports seriously. This file satisfies POLICY.md R-2.1 (required root
file) and supports §7 / §8.11.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Report privately via one of:

- **GitHub Security Advisories** — [Report a vulnerability](https://github.com/RVLT-Labs/rvlt-flow/security/advisories/new)
  (preferred; keeps the report and fix coordination private).
- **Email** — security@rvlt.app with a description, reproduction steps, and impact.

Please include:

- The affected area (URL, endpoint, Convex function, or file).
- Steps to reproduce, or a proof-of-concept.
- The impact you believe it has (data exposure, privilege escalation, etc.).

## What to expect

- **Acknowledgement** within 1 business day.
- An initial assessment and severity rating (Critical / High / Medium / Low).
- Coordinated disclosure: we will agree a timeline with you before any public
  write-up. Please give us a reasonable window to ship a fix before disclosing.

## Scope

In scope: the RVLT Flow application (`flow.rvlt.app`), its API (`/api/v1/*`), the
Convex backend, and authentication/authorization flows.

Out of scope: third-party services we depend on (report those to the vendor),
social engineering, and physical attacks.

## Handling of secrets & data

Per POLICY.md §7 and R-14.2, **never include real secret values, credentials, or
personal data in a report** — reference the location (file, endpoint, commit), not
the contents. If you believe a secret has been exposed, say so and we will rotate it.
