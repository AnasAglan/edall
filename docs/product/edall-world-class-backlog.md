# ED-ALL roadmap: 100 proposed features + 100 platform improvements

**Status:** Proposal-only backlog; not implemented or approved for release.  
**Prepared:** 2026-11-23  
**Scope:** ED-ALL web platform and its connected services. Windows desktop (yt-dlp) and Android (NewPipe) remain separate applications and release tracks.

## How to use this backlog

This catalogue contains exactly 100 distinct feature proposals and 100 operational/engineering improvement proposals. It is not a commitment to implement 200 changes at once. First re-check the live application to avoid duplicates; then rank each proposal, create a bounded PR, add measurable tests, and release only after the security and staging gates pass.

The pilot measures below are targets, not current performance claims. Dependency and risk notes are planning constraints, not quotes or current spend. Admin operations assume server-side authorization and AAL2 where sensitive. Optional AI, payments, messaging, analytics and integrations require separate cost, consent and security approval.

## Part A — 100 proposed features


### Learning paths and mastery

| # | Proposal | Primary role | Pilot acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 1 | Personalized learning pathways | Student/Teacher | ≥70% of pilot learners complete their selected path | Requires course objectives and teacher-reviewed skill tags; medium authoring effort. |
| 2 | Prerequisite dependency graph | Student/Teacher | ≥70% of pilot learners complete their selected path | Requires course objectives and teacher-reviewed skill tags; medium authoring effort. |
| 3 | Weekly learning goals | Student/Teacher | ≥70% of pilot learners complete their selected path | Requires course objectives and teacher-reviewed skill tags; medium authoring effort. |
| 4 | Flexible study streak recovery | Student/Teacher | ≥70% of pilot learners complete their selected path | Requires course objectives and teacher-reviewed skill tags; medium authoring effort. |
| 5 | Spaced-repetition review queue | Student/Teacher | ≥70% of pilot learners complete their selected path | Requires course objectives and teacher-reviewed skill tags; medium authoring effort. |
| 6 | Private flashcard decks | Student/Teacher | ≥70% of pilot learners complete their selected path | Requires course objectives and teacher-reviewed skill tags; medium authoring effort. |
| 7 | Teacher-shared flashcard packs | Student/Teacher | ≥70% of pilot learners complete their selected path | Requires course objectives and teacher-reviewed skill tags; medium authoring effort. |
| 8 | Concept mastery map | Student/Teacher | ≥70% of pilot learners complete their selected path | Requires course objectives and teacher-reviewed skill tags; medium authoring effort. |
| 9 | Knowledge-gap diagnostics | Student/Teacher | ≥70% of pilot learners complete their selected path | Requires course objectives and teacher-reviewed skill tags; medium authoring effort. |
| 10 | Recommended next lesson | Student/Teacher | ≥70% of pilot learners complete their selected path | Requires course objectives and teacher-reviewed skill tags; medium authoring effort. |

### Lesson media and study artefacts

| # | Proposal | Primary role | Pilot acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 11 | Timestamped video bookmarks | Student/Teacher | ≥25% of active learners use at least one study tool monthly | Keep lesson files private; media processing and storage quotas apply. |
| 12 | Private lesson notes | Student/Teacher | ≥25% of active learners use at least one study tool monthly | Keep lesson files private; media processing and storage quotas apply. |
| 13 | PDF highlights and annotations | Student/Teacher | ≥25% of active learners use at least one study tool monthly | Keep lesson files private; media processing and storage quotas apply. |
| 14 | Searchable lesson transcripts | Student/Teacher | ≥25% of active learners use at least one study tool monthly | Keep lesson files private; media processing and storage quotas apply. |
| 15 | Multi-language subtitles | Student/Teacher | ≥25% of active learners use at least one study tool monthly | Keep lesson files private; media processing and storage quotas apply. |
| 16 | Audio-only lesson playback | Student/Teacher | ≥25% of active learners use at least one study tool monthly | Keep lesson files private; media processing and storage quotas apply. |
| 17 | Picture-in-picture lessons | Student/Teacher | ≥25% of active learners use at least one study tool monthly | Keep lesson files private; media processing and storage quotas apply. |
| 18 | Synchronized notes across devices | Student/Teacher | ≥25% of active learners use at least one study tool monthly | Keep lesson files private; media processing and storage quotas apply. |
| 19 | Downloadable teacher handouts | Student/Teacher | ≥25% of active learners use at least one study tool monthly | Keep lesson files private; media processing and storage quotas apply. |
| 20 | Interactive diagrams and labelling | Student/Teacher | ≥25% of active learners use at least one study tool monthly | Keep lesson files private; media processing and storage quotas apply. |

### Assessment and exam design

| # | Proposal | Primary role | Pilot acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 21 | Reusable exam blueprints | Teacher/Student | ≥90% of assessment states and feedback transitions pass acceptance tests | Answer-key confidentiality and exam fairness are release blockers. |
| 22 | Topic and difficulty question bank | Teacher/Student | ≥90% of assessment states and feedback transitions pass acceptance tests | Answer-key confidentiality and exam fairness are release blockers. |
| 23 | Adaptive practice sets | Teacher/Student | ≥90% of assessment states and feedback transitions pass acceptance tests | Answer-key confidentiality and exam fairness are release blockers. |
| 24 | Scenario-based assessments | Teacher/Student | ≥90% of assessment states and feedback transitions pass acceptance tests | Answer-key confidentiality and exam fairness are release blockers. |
| 25 | Oral response questions | Teacher/Student | ≥90% of assessment states and feedback transitions pass acceptance tests | Answer-key confidentiality and exam fairness are release blockers. |
| 26 | Structured question rubrics | Teacher/Student | ≥90% of assessment states and feedback transitions pass acceptance tests | Answer-key confidentiality and exam fairness are release blockers. |
| 27 | Post-release answer explanations | Teacher/Student | ≥90% of assessment states and feedback transitions pass acceptance tests | Answer-key confidentiality and exam fairness are release blockers. |
| 28 | Student exam review windows | Teacher/Student | ≥90% of assessment states and feedback transitions pass acceptance tests | Answer-key confidentiality and exam fairness are release blockers. |
| 29 | Exam appeal workflow | Teacher/Student | ≥90% of assessment states and feedback transitions pass acceptance tests | Answer-key confidentiality and exam fairness are release blockers. |
| 30 | Teacher-authored practice simulations | Teacher/Student | ≥90% of assessment states and feedback transitions pass acceptance tests | Answer-key confidentiality and exam fairness are release blockers. |

### Assignments and projects

| # | Proposal | Primary role | Pilot acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 31 | Submission draft autosave | Teacher/Student | ≥80% of assignment submissions retain a complete, reviewable version history | Private uploads, grading audit, malware scanning and storage retention required. |
| 32 | Versioned resubmissions | Teacher/Student | ≥80% of assignment submissions retain a complete, reviewable version history | Private uploads, grading audit, malware scanning and storage retention required. |
| 33 | Group project submissions | Teacher/Student | ≥80% of assignment submissions retain a complete, reviewable version history | Private uploads, grading audit, malware scanning and storage retention required. |
| 34 | Peer review assignments | Teacher/Student | ≥80% of assignment submissions retain a complete, reviewable version history | Private uploads, grading audit, malware scanning and storage retention required. |
| 35 | Rubric-based grading panels | Teacher/Student | ≥80% of assignment submissions retain a complete, reviewable version history | Private uploads, grading audit, malware scanning and storage retention required. |
| 36 | Audio/video assignment responses | Teacher/Student | ≥80% of assignment submissions retain a complete, reviewable version history | Private uploads, grading audit, malware scanning and storage retention required. |
| 37 | Spreadsheet assignment preview | Teacher/Student | ≥80% of assignment submissions retain a complete, reviewable version history | Private uploads, grading audit, malware scanning and storage retention required. |
| 38 | Project milestone boards | Teacher/Student | ≥80% of assignment submissions retain a complete, reviewable version history | Private uploads, grading audit, malware scanning and storage retention required. |
| 39 | Submission originality declaration | Teacher/Student | ≥80% of assignment submissions retain a complete, reviewable version history | Private uploads, grading audit, malware scanning and storage retention required. |
| 40 | Assignment extension request workflow | Teacher/Student | ≥80% of assignment submissions retain a complete, reviewable version history | Private uploads, grading audit, malware scanning and storage retention required. |

### Community and live learning

| # | Proposal | Primary role | Pilot acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 41 | Study circles | Student/Teacher | ≥50% of pilot courses have monthly learner participation | Moderation, reporting, notification preferences and anti-abuse controls required. |
| 42 | Live class Q&A queue | Student/Teacher | ≥50% of pilot courses have monthly learner participation | Moderation, reporting, notification preferences and anti-abuse controls required. |
| 43 | Teacher office-hour booking | Student/Teacher | ≥50% of pilot courses have monthly learner participation | Moderation, reporting, notification preferences and anti-abuse controls required. |
| 44 | Accepted-answer Q&A | Student/Teacher | ≥50% of pilot courses have monthly learner participation | Moderation, reporting, notification preferences and anti-abuse controls required. |
| 45 | Anonymous course feedback | Student/Teacher | ≥50% of pilot courses have monthly learner participation | Moderation, reporting, notification preferences and anti-abuse controls required. |
| 46 | Course announcement acknowledgements | Student/Teacher | ≥50% of pilot courses have monthly learner participation | Moderation, reporting, notification preferences and anti-abuse controls required. |
| 47 | Mentor matching by topic | Student/Teacher | ≥50% of pilot courses have monthly learner participation | Moderation, reporting, notification preferences and anti-abuse controls required. |
| 48 | Study group shared goals | Student/Teacher | ≥50% of pilot courses have monthly learner participation | Moderation, reporting, notification preferences and anti-abuse controls required. |
| 49 | Community event calendar | Student/Teacher | ≥50% of pilot courses have monthly learner participation | Moderation, reporting, notification preferences and anti-abuse controls required. |
| 50 | Learner-submitted topic proposals | Student/Teacher | ≥50% of pilot courses have monthly learner participation | Moderation, reporting, notification preferences and anti-abuse controls required. |

### Teacher productivity

| # | Proposal | Primary role | Pilot acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 51 | Reusable lesson templates | Teacher/Admin | Reduce selected repetitive teacher workflows by ≥30% in a measured pilot | Delegation and course-scoped capabilities must be enforced server-side. |
| 52 | Scheduled lesson publishing | Teacher/Admin | Reduce selected repetitive teacher workflows by ≥30% in a measured pilot | Delegation and course-scoped capabilities must be enforced server-side. |
| 53 | Co-instructor workspace | Teacher/Admin | Reduce selected repetitive teacher workflows by ≥30% in a measured pilot | Delegation and course-scoped capabilities must be enforced server-side. |
| 54 | Teaching assistant task queue | Teacher/Admin | Reduce selected repetitive teacher workflows by ≥30% in a measured pilot | Delegation and course-scoped capabilities must be enforced server-side. |
| 55 | Teacher workload calendar | Teacher/Admin | Reduce selected repetitive teacher workflows by ≥30% in a measured pilot | Delegation and course-scoped capabilities must be enforced server-side. |
| 56 | Bulk roster preview actions | Teacher/Admin | Reduce selected repetitive teacher workflows by ≥30% in a measured pilot | Delegation and course-scoped capabilities must be enforced server-side. |
| 57 | Course clone with selective assets | Teacher/Admin | Reduce selected repetitive teacher workflows by ≥30% in a measured pilot | Delegation and course-scoped capabilities must be enforced server-side. |
| 58 | Course archive and restore | Teacher/Admin | Reduce selected repetitive teacher workflows by ≥30% in a measured pilot | Delegation and course-scoped capabilities must be enforced server-side. |
| 59 | Grading workload queue | Teacher/Admin | Reduce selected repetitive teacher workflows by ≥30% in a measured pilot | Delegation and course-scoped capabilities must be enforced server-side. |
| 60 | Course feedback action tracker | Teacher/Admin | Reduce selected repetitive teacher workflows by ≥30% in a measured pilot | Delegation and course-scoped capabilities must be enforced server-side. |

### Accessibility and learner services

| # | Proposal | Primary role | Pilot acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 61 | Personal accessibility preferences | Student/All users | 100% of critical new flows pass keyboard and screen-reader acceptance tests | Sensitive accommodations data is restricted; WCAG review required. |
| 62 | Dyslexia-friendly reading mode | Student/All users | 100% of critical new flows pass keyboard and screen-reader acceptance tests | Sensitive accommodations data is restricted; WCAG review required. |
| 63 | Low-bandwidth course mode | Student/All users | 100% of critical new flows pass keyboard and screen-reader acceptance tests | Sensitive accommodations data is restricted; WCAG review required. |
| 64 | Screen-reader exam mode | Student/All users | 100% of critical new flows pass keyboard and screen-reader acceptance tests | Sensitive accommodations data is restricted; WCAG review required. |
| 65 | Keyboard-first lesson navigation | Student/All users | 100% of critical new flows pass keyboard and screen-reader acceptance tests | Sensitive accommodations data is restricted; WCAG review required. |
| 66 | Guardian progress view with consent | Student/All users | 100% of critical new flows pass keyboard and screen-reader acceptance tests | Sensitive accommodations data is restricted; WCAG review required. |
| 67 | Parent progress digest with consent | Student/All users | 100% of critical new flows pass keyboard and screen-reader acceptance tests | Sensitive accommodations data is restricted; WCAG review required. |
| 68 | Student support ticket center | Student/All users | 100% of critical new flows pass keyboard and screen-reader acceptance tests | Sensitive accommodations data is restricted; WCAG review required. |
| 69 | Personal data export center | Student/All users | 100% of critical new flows pass keyboard and screen-reader acceptance tests | Sensitive accommodations data is restricted; WCAG review required. |
| 70 | Account deletion request center | Student/All users | 100% of critical new flows pass keyboard and screen-reader acceptance tests | Sensitive accommodations data is restricted; WCAG review required. |

### Payments and commerce

| # | Proposal | Primary role | Pilot acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 71 | Course bundle offers | Admin/Student | ≥99% of pilot orders reconcile to one auditable payment state | Requires legal/provider review; new methods remain disabled until separate approval. |
| 72 | Discount and coupon campaigns | Admin/Student | ≥99% of pilot orders reconcile to one auditable payment state | Requires legal/provider review; new methods remain disabled until separate approval. |
| 73 | Scholarship application portal | Admin/Student | ≥99% of pilot orders reconcile to one auditable payment state | Requires legal/provider review; new methods remain disabled until separate approval. |
| 74 | Installment plan schedules | Admin/Student | ≥99% of pilot orders reconcile to one auditable payment state | Requires legal/provider review; new methods remain disabled until separate approval. |
| 75 | Refund request portal | Admin/Student | ≥99% of pilot orders reconcile to one auditable payment state | Requires legal/provider review; new methods remain disabled until separate approval. |
| 76 | Invoice and receipt downloads | Admin/Student | ≥99% of pilot orders reconcile to one auditable payment state | Requires legal/provider review; new methods remain disabled until separate approval. |
| 77 | Payment reconciliation dashboard | Admin/Student | ≥99% of pilot orders reconcile to one auditable payment state | Requires legal/provider review; new methods remain disabled until separate approval. |
| 78 | Gift course enrollment | Admin/Student | ≥99% of pilot orders reconcile to one auditable payment state | Requires legal/provider review; new methods remain disabled until separate approval. |
| 79 | Referral attribution program | Admin/Student | ≥99% of pilot orders reconcile to one auditable payment state | Requires legal/provider review; new methods remain disabled until separate approval. |
| 80 | Payment provider health dashboard | Admin/Student | ≥99% of pilot orders reconcile to one auditable payment state | Requires legal/provider review; new methods remain disabled until separate approval. |

### Analytics and learner insight

| # | Proposal | Primary role | Pilot acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 81 | Study-time insight cards | Student/Teacher/Admin | Every published metric has a definition, role scope and test fixture | Suppress small cohorts; avoid sensitive or unsupported causal claims. |
| 82 | Student achievement timeline | Student/Teacher/Admin | Every published metric has a definition, role scope and test fixture | Suppress small cohorts; avoid sensitive or unsupported causal claims. |
| 83 | Cohort progress comparisons | Student/Teacher/Admin | Every published metric has a definition, role scope and test fixture | Suppress small cohorts; avoid sensitive or unsupported causal claims. |
| 84 | Teacher content effectiveness view | Student/Teacher/Admin | Every published metric has a definition, role scope and test fixture | Suppress small cohorts; avoid sensitive or unsupported causal claims. |
| 85 | Learning outcome completion map | Student/Teacher/Admin | Every published metric has a definition, role scope and test fixture | Suppress small cohorts; avoid sensitive or unsupported causal claims. |
| 86 | Course engagement funnel | Student/Teacher/Admin | Every published metric has a definition, role scope and test fixture | Suppress small cohorts; avoid sensitive or unsupported causal claims. |
| 87 | Early-support referral queue | Student/Teacher/Admin | Every published metric has a definition, role scope and test fixture | Suppress small cohorts; avoid sensitive or unsupported causal claims. |
| 88 | Outcome-based course feedback | Student/Teacher/Admin | Every published metric has a definition, role scope and test fixture | Suppress small cohorts; avoid sensitive or unsupported causal claims. |
| 89 | Course attendance trend explorer | Student/Teacher/Admin | Every published metric has a definition, role scope and test fixture | Suppress small cohorts; avoid sensitive or unsupported causal claims. |
| 90 | Student goal progress forecast | Student/Teacher/Admin | Every published metric has a definition, role scope and test fixture | Suppress small cohorts; avoid sensitive or unsupported causal claims. |

### Portfolios and integrations

| # | Proposal | Primary role | Pilot acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 91 | Student learning portfolio | Student/Teacher/Admin | ≥95% of pilot sync and verification operations complete with an auditable result | Third-party services need contracts, scope review, consent and cost approval. |
| 92 | Portfolio evidence attachments | Student/Teacher/Admin | ≥95% of pilot sync and verification operations complete with an auditable result | Third-party services need contracts, scope review, consent and cost approval. |
| 93 | Revocable achievement sharing links | Student/Teacher/Admin | ≥95% of pilot sync and verification operations complete with an auditable result | Third-party services need contracts, scope review, consent and cost approval. |
| 94 | QR certificate verification | Student/Teacher/Admin | ≥95% of pilot sync and verification operations complete with an auditable result | Third-party services need contracts, scope review, consent and cost approval. |
| 95 | Micro-credential badges | Student/Teacher/Admin | ≥95% of pilot sync and verification operations complete with an auditable result | Third-party services need contracts, scope review, consent and cost approval. |
| 96 | Course content localization workflow | Student/Teacher/Admin | ≥95% of pilot sync and verification operations complete with an auditable result | Third-party services need contracts, scope review, consent and cost approval. |
| 97 | Translation review queue | Student/Teacher/Admin | ≥95% of pilot sync and verification operations complete with an auditable result | Third-party services need contracts, scope review, consent and cost approval. |
| 98 | SCORM package support | Student/Teacher/Admin | ≥95% of pilot sync and verification operations complete with an auditable result | Third-party services need contracts, scope review, consent and cost approval. |
| 99 | LTI learning-tool integration | Student/Teacher/Admin | ≥95% of pilot sync and verification operations complete with an auditable result | Third-party services need contracts, scope review, consent and cost approval. |
| 100 | Organization single sign-on | Student/Teacher/Admin | ≥95% of pilot sync and verification operations complete with an auditable result | Third-party services need contracts, scope review, consent and cost approval. |

## Part B — 100 proposed engineering and operational improvements


### Security and identity

| # | Improvement | Primary role | Acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 1 | Complete SECURITY DEFINER inventory | Developer/Admin | 100% of sensitive flows pass negative authorization tests | Security review, least privilege and explicit AAL2 gates; no UI-only authorization. |
| 2 | Require empty search_path for privileged SQL | Developer/Admin | 100% of sensitive flows pass negative authorization tests | Security review, least privilege and explicit AAL2 gates; no UI-only authorization. |
| 3 | Add role and AAL2 permission matrix tests | Developer/Admin | 100% of sensitive flows pass negative authorization tests | Security review, least privilege and explicit AAL2 gates; no UI-only authorization. |
| 4 | Enforce least-privilege function grants | Developer/Admin | 100% of sensitive flows pass negative authorization tests | Security review, least privilege and explicit AAL2 gates; no UI-only authorization. |
| 5 | Revoke stale privileges in migration tests | Developer/Admin | 100% of sensitive flows pass negative authorization tests | Security review, least privilege and explicit AAL2 gates; no UI-only authorization. |
| 6 | Harden session revocation after role changes | Developer/Admin | 100% of sensitive flows pass negative authorization tests | Security review, least privilege and explicit AAL2 gates; no UI-only authorization. |
| 7 | Add administrator MFA recovery runbook | Developer/Admin | 100% of sensitive flows pass negative authorization tests | Security review, least privilege and explicit AAL2 gates; no UI-only authorization. |
| 8 | Add endpoint rate-limit regression tests | Developer/Admin | 100% of sensitive flows pass negative authorization tests | Security review, least privilege and explicit AAL2 gates; no UI-only authorization. |
| 9 | Add bot protection to public forms | Developer/Admin | 100% of sensitive flows pass negative authorization tests | Security review, least privilege and explicit AAL2 gates; no UI-only authorization. |
| 10 | Add CSRF and origin checks to mutation endpoints | Developer/Admin | 100% of sensitive flows pass negative authorization tests | Security review, least privilege and explicit AAL2 gates; no UI-only authorization. |

### Data integrity and schema

| # | Improvement | Primary role | Acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 11 | Add source-to-ledger migration reconciler | Developer | Zero ambiguous migration states before a remote write | Reconcile schema and migration ledger; never infer application status. |
| 12 | Capture schema snapshots in CI | Developer | Zero ambiguous migration states before a remote write | Reconcile schema and migration ledger; never infer application status. |
| 13 | Detect unexpected schema drift | Developer | Zero ambiguous migration states before a remote write | Reconcile schema and migration ledger; never infer application status. |
| 14 | Add RPC contract and signature tests | Developer | Zero ambiguous migration states before a remote write | Reconcile schema and migration ledger; never infer application status. |
| 15 | Add generated DB type drift check | Developer | Zero ambiguous migration states before a remote write | Reconcile schema and migration ledger; never infer application status. |
| 16 | Add constraints for cross-course references | Developer | Zero ambiguous migration states before a remote write | Reconcile schema and migration ledger; never infer application status. |
| 17 | Add measured query-plan regression tests | Developer | Zero ambiguous migration states before a remote write | Reconcile schema and migration ledger; never infer application status. |
| 18 | Require pagination caps on every list RPC | Developer | Zero ambiguous migration states before a remote write | Reconcile schema and migration ledger; never infer application status. |
| 19 | Use stable cursor pagination for large histories | Developer | Zero ambiguous migration states before a remote write | Reconcile schema and migration ledger; never infer application status. |
| 20 | Add safe data-retention and purge policies | Developer | Zero ambiguous migration states before a remote write | Reconcile schema and migration ledger; never infer application status. |

### Payments and financial audit

| # | Improvement | Primary role | Acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 21 | Add payment provider contract test suite | Admin/Developer | Every provider event and balance change is traceable and idempotent | No live credentials in source; require provider sandbox and financial review. |
| 22 | Add callback replay and tamper tests | Admin/Developer | Every provider event and balance change is traceable and idempotent | No live credentials in source; require provider sandbox and financial review. |
| 23 | Add daily unmatched-payment reconciliation | Admin/Developer | Every provider event and balance change is traceable and idempotent | No live credentials in source; require provider sandbox and financial review. |
| 24 | Audit wallet transaction mutations | Admin/Developer | Every provider event and balance change is traceable and idempotent | No live credentials in source; require provider sandbox and financial review. |
| 25 | Audit wallet balance before/after changes | Admin/Developer | Every provider event and balance change is traceable and idempotent | No live credentials in source; require provider sandbox and financial review. |
| 26 | Audit provider activation and configuration | Admin/Developer | Every provider event and balance change is traceable and idempotent | No live credentials in source; require provider sandbox and financial review. |
| 27 | Redact financial free text from audit records | Admin/Developer | Every provider event and balance change is traceable and idempotent | No live credentials in source; require provider sandbox and financial review. |
| 28 | Add payment state-transition allowlist | Admin/Developer | Every provider event and balance change is traceable and idempotent | No live credentials in source; require provider sandbox and financial review. |
| 29 | Add ambiguous-charge reconciliation queue | Admin/Developer | Every provider event and balance change is traceable and idempotent | No live credentials in source; require provider sandbox and financial review. |
| 30 | Add provider credential rotation runbook | Admin/Developer | Every provider event and balance change is traceable and idempotent | No live credentials in source; require provider sandbox and financial review. |

### Performance and frontend

| # | Improvement | Primary role | Acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 31 | Set initial JavaScript bundle budgets | Developer/Student | Improve key route p95 and initial payload against measured baseline | Do not cache private course/student/payment data in shared caches. |
| 32 | Lazy-load administrator-only modules | Developer/Student | Improve key route p95 and initial payload against measured baseline | Do not cache private course/student/payment data in shared caches. |
| 33 | Add responsive image variants | Developer/Student | Improve key route p95 and initial payload against measured baseline | Do not cache private course/student/payment data in shared caches. |
| 34 | Compress safe static assets | Developer/Student | Improve key route p95 and initial payload against measured baseline | Do not cache private course/student/payment data in shared caches. |
| 35 | Add Core Web Vitals by route | Developer/Student | Improve key route p95 and initial payload against measured baseline | Do not cache private course/student/payment data in shared caches. |
| 36 | Add private-response cache-control tests | Developer/Student | Improve key route p95 and initial payload against measured baseline | Do not cache private course/student/payment data in shared caches. |
| 37 | Cache only public catalog data | Developer/Student | Improve key route p95 and initial payload against measured baseline | Do not cache private course/student/payment data in shared caches. |
| 38 | Add query performance budgets for critical pages | Developer/Student | Improve key route p95 and initial payload against measured baseline | Do not cache private course/student/payment data in shared caches. |
| 39 | Remove duplicate frontend data fetches | Developer/Student | Improve key route p95 and initial payload against measured baseline | Do not cache private course/student/payment data in shared caches. |
| 40 | Add offline-friendly low-bandwidth rendering tests | Developer/Student | Improve key route p95 and initial payload against measured baseline | Do not cache private course/student/payment data in shared caches. |

### Cloudflare and video reliability

| # | Improvement | Primary role | Acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 41 | Verify query-string redaction on every Worker | Developer/Student | Detect provider failure and registry staleness within one scheduled cycle | Do not mix Web Piped/Invidious with desktop yt-dlp or Android NewPipe. |
| 42 | Keep trace sampling explicitly cost-gated | Developer/Student | Detect provider failure and registry staleness within one scheduled cycle | Do not mix Web Piped/Invidious with desktop yt-dlp or Android NewPipe. |
| 43 | Add Worker 5xx and latency SLOs | Developer/Student | Detect provider failure and registry staleness within one scheduled cycle | Do not mix Web Piped/Invidious with desktop yt-dlp or Android NewPipe. |
| 44 | Add extractor success-ratio alerting | Developer/Student | Detect provider failure and registry staleness within one scheduled cycle | Do not mix Web Piped/Invidious with desktop yt-dlp or Android NewPipe. |
| 45 | Add video registry freshness alarms | Developer/Student | Detect provider failure and registry staleness within one scheduled cycle | Do not mix Web Piped/Invidious with desktop yt-dlp or Android NewPipe. |
| 46 | Add provider health evidence and expiry rules | Developer/Student | Detect provider failure and registry staleness within one scheduled cycle | Do not mix Web Piped/Invidious with desktop yt-dlp or Android NewPipe. |
| 47 | Add browser playback compatibility matrix | Developer/Student | Detect provider failure and registry staleness within one scheduled cycle | Do not mix Web Piped/Invidious with desktop yt-dlp or Android NewPipe. |
| 48 | Add transient upstream retry budget | Developer/Student | Detect provider failure and registry staleness within one scheduled cycle | Do not mix Web Piped/Invidious with desktop yt-dlp or Android NewPipe. |
| 49 | Add media proxy range-request regression tests | Developer/Student | Detect provider failure and registry staleness within one scheduled cycle | Do not mix Web Piped/Invidious with desktop yt-dlp or Android NewPipe. |
| 50 | Add staging/production Worker binding diff checks | Developer/Student | Detect provider failure and registry staleness within one scheduled cycle | Do not mix Web Piped/Invidious with desktop yt-dlp or Android NewPipe. |

### Backup and recovery

| # | Improvement | Primary role | Acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 51 | Automate encrypted database backups | Admin/Developer | Meet documented RPO/RTO in a repeated isolated restore drill | Provider retention, private Storage coverage and restore capacity may incur cost. |
| 52 | Inventory private Storage backup scope | Admin/Developer | Meet documented RPO/RTO in a repeated isolated restore drill | Provider retention, private Storage coverage and restore capacity may incur cost. |
| 53 | Verify backup checksums before restore | Admin/Developer | Meet documented RPO/RTO in a repeated isolated restore drill | Provider retention, private Storage coverage and restore capacity may incur cost. |
| 54 | Run quarterly restore drills | Admin/Developer | Meet documented RPO/RTO in a repeated isolated restore drill | Provider retention, private Storage coverage and restore capacity may incur cost. |
| 55 | Document point-in-time recovery sequence | Admin/Developer | Meet documented RPO/RTO in a repeated isolated restore drill | Provider retention, private Storage coverage and restore capacity may incur cost. |
| 56 | Measure and publish achieved RPO/RTO | Admin/Developer | Meet documented RPO/RTO in a repeated isolated restore drill | Provider retention, private Storage coverage and restore capacity may incur cost. |
| 57 | Add object-storage restore reconciliation | Admin/Developer | Meet documented RPO/RTO in a repeated isolated restore drill | Provider retention, private Storage coverage and restore capacity may incur cost. |
| 58 | Create forward-fix and rollback guidance per migration | Admin/Developer | Meet documented RPO/RTO in a repeated isolated restore drill | Provider retention, private Storage coverage and restore capacity may incur cost. |
| 59 | Add recovery contact and ownership matrix | Admin/Developer | Meet documented RPO/RTO in a repeated isolated restore drill | Provider retention, private Storage coverage and restore capacity may incur cost. |
| 60 | Alert on missed backup jobs | Admin/Developer | Meet documented RPO/RTO in a repeated isolated restore drill | Provider retention, private Storage coverage and restore capacity may incur cost. |

### CI/CD and release safety

| # | Improvement | Primary role | Acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 61 | Require branch protection and independent review | Developer/Admin | Every production-bound change has reproducible test and rollback evidence | Production merge, DB migration and deployment stay separate gates. |
| 62 | Run clean local Supabase migration reset in CI | Developer/Admin | Every production-bound change has reproducible test and rollback evidence | Production merge, DB migration and deployment stay separate gates. |
| 63 | Run role matrix for guest/student/teacher/admin | Developer/Admin | Every production-bound change has reproducible test and rollback evidence | Production merge, DB migration and deployment stay separate gates. |
| 64 | Require SQL test evidence for migrations | Developer/Admin | Every production-bound change has reproducible test and rollback evidence | Production merge, DB migration and deployment stay separate gates. |
| 65 | Add Wrangler dry-run for changed scripts | Developer/Admin | Every production-bound change has reproducible test and rollback evidence | Production merge, DB migration and deployment stay separate gates. |
| 66 | Add release manifest with source hashes | Developer/Admin | Every production-bound change has reproducible test and rollback evidence | Production merge, DB migration and deployment stay separate gates. |
| 67 | Add staged deployment smoke tests | Developer/Admin | Every production-bound change has reproducible test and rollback evidence | Production merge, DB migration and deployment stay separate gates. |
| 68 | Add visual regression snapshots for core screens | Developer/Admin | Every production-bound change has reproducible test and rollback evidence | Production merge, DB migration and deployment stay separate gates. |
| 69 | Add feature-flag expiry inventory | Developer/Admin | Every production-bound change has reproducible test and rollback evidence | Production merge, DB migration and deployment stay separate gates. |
| 70 | Add release changelog in Arabic and English | Developer/Admin | Every production-bound change has reproducible test and rollback evidence | Production merge, DB migration and deployment stay separate gates. |

### Observability and support

| # | Improvement | Primary role | Acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 71 | Add request correlation IDs to safe logs | Admin/Developer | Reduce undiagnosed incidents and duplicate alerts against baseline | Minimize personal data; telemetry retention and tracing costs need approval. |
| 72 | Add user-safe error taxonomy | Admin/Developer | Reduce undiagnosed incidents and duplicate alerts against baseline | Minimize personal data; telemetry retention and tracing costs need approval. |
| 73 | Add synthetic student journey monitors | Admin/Developer | Reduce undiagnosed incidents and duplicate alerts against baseline | Minimize personal data; telemetry retention and tracing costs need approval. |
| 74 | Add incident response playbooks | Admin/Developer | Reduce undiagnosed incidents and duplicate alerts against baseline | Minimize personal data; telemetry retention and tracing costs need approval. |
| 75 | Deduplicate repeated alerts | Admin/Developer | Reduce undiagnosed incidents and duplicate alerts against baseline | Minimize personal data; telemetry retention and tracing costs need approval. |
| 76 | Add notification dead-letter monitoring | Admin/Developer | Reduce undiagnosed incidents and duplicate alerts against baseline | Minimize personal data; telemetry retention and tracing costs need approval. |
| 77 | Add scheduled job idempotency checks | Admin/Developer | Reduce undiagnosed incidents and duplicate alerts against baseline | Minimize personal data; telemetry retention and tracing costs need approval. |
| 78 | Add support diagnostic export with redaction | Admin/Developer | Reduce undiagnosed incidents and duplicate alerts against baseline | Minimize personal data; telemetry retention and tracing costs need approval. |
| 79 | Add public service-status communications workflow | Admin/Developer | Reduce undiagnosed incidents and duplicate alerts against baseline | Minimize personal data; telemetry retention and tracing costs need approval. |
| 80 | Define service SLOs and error budgets | Admin/Developer | Reduce undiagnosed incidents and duplicate alerts against baseline | Minimize personal data; telemetry retention and tracing costs need approval. |

### Accessibility and localization

| # | Improvement | Primary role | Acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 81 | Add keyboard navigation release gate | Developer/All users | All critical flows pass Arabic RTL and assistive-technology checks | Automated checks need manual screen-reader and keyboard verification. |
| 82 | Add screen-reader smoke tests | Developer/All users | All critical flows pass Arabic RTL and assistive-technology checks | Automated checks need manual screen-reader and keyboard verification. |
| 83 | Add RTL screenshot regression tests | Developer/All users | All critical flows pass Arabic RTL and assistive-technology checks | Automated checks need manual screen-reader and keyboard verification. |
| 84 | Add localization completeness CI | Developer/All users | All critical flows pass Arabic RTL and assistive-technology checks | Automated checks need manual screen-reader and keyboard verification. |
| 85 | Add accessible form validation checks | Developer/All users | All critical flows pass Arabic RTL and assistive-technology checks | Automated checks need manual screen-reader and keyboard verification. |
| 86 | Add reduced-motion preference tests | Developer/All users | All critical flows pass Arabic RTL and assistive-technology checks | Automated checks need manual screen-reader and keyboard verification. |
| 87 | Add caption/subtitle accessibility checks | Developer/All users | All critical flows pass Arabic RTL and assistive-technology checks | Automated checks need manual screen-reader and keyboard verification. |
| 88 | Add contrast and focus-visible checks | Developer/All users | All critical flows pass Arabic RTL and assistive-technology checks | Automated checks need manual screen-reader and keyboard verification. |
| 89 | Test zoom and narrow viewport layouts | Developer/All users | All critical flows pass Arabic RTL and assistive-technology checks | Automated checks need manual screen-reader and keyboard verification. |
| 90 | Add Arabic date/number formatting consistency checks | Developer/All users | All critical flows pass Arabic RTL and assistive-technology checks | Automated checks need manual screen-reader and keyboard verification. |

### AI governance and cost

| # | Improvement | Primary role | Acceptance measure | Dependency / risk gate |
|---:|---|---|---|---|
| 91 | Add per-role AI usage quotas | Admin/Developer | AI features remain within quotas and expose no unauthorized data | Provider cost, user consent, prompt-injection and content quality require review. |
| 92 | Add monthly AI cost budgets | Admin/Developer | AI features remain within quotas and expose no unauthorized data | Provider cost, user consent, prompt-injection and content quality require review. |
| 93 | Add prompt-injection regression suite | Admin/Developer | AI features remain within quotas and expose no unauthorized data | Provider cost, user consent, prompt-injection and content quality require review. |
| 94 | Test tool authorization per capability | Admin/Developer | AI features remain within quotas and expose no unauthorized data | Provider cost, user consent, prompt-injection and content quality require review. |
| 95 | Add image upload size/type safety tests | Admin/Developer | AI features remain within quotas and expose no unauthorized data | Provider cost, user consent, prompt-injection and content quality require review. |
| 96 | Add model timeout and cancellation tests | Admin/Developer | AI features remain within quotas and expose no unauthorized data | Provider cost, user consent, prompt-injection and content quality require review. |
| 97 | Label generated educational content | Admin/Developer | AI features remain within quotas and expose no unauthorized data | Provider cost, user consent, prompt-injection and content quality require review. |
| 98 | Add human review workflow for generated materials | Admin/Developer | AI features remain within quotas and expose no unauthorized data | Provider cost, user consent, prompt-injection and content quality require review. |
| 99 | Add AI data-retention controls | Admin/Developer | AI features remain within quotas and expose no unauthorized data | Provider cost, user consent, prompt-injection and content quality require review. |
| 100 | Test statistics with populated and zero-value fixtures | Admin/Developer | AI features remain within quotas and expose no unauthorized data | Provider cost, user consent, prompt-injection and content quality require review. |

## Mandatory gates for every accepted proposal

1. Confirm that the capability does not already exist; improve existing functionality instead of duplicating it.
2. Enforce authorization in RLS, scoped RPCs or the trusted server. Never rely on hiding a button.
3. Add role-specific positive and negative tests, plus browser tests where users interact with the feature.
4. Batch related database changes in one reviewed migration set. Never infer remote migration status.
5. Validate on a restored isolated Staging database, including private Storage objects and backup/restore evidence.
6. Estimate recurring AI, email, storage, video, telemetry and third-party costs before enabling dependencies.
7. Keep new payment methods, sampled traces, offline protection and public sharing disabled until separately approved.
8. Preserve the current ED-ALL visual language; implement only targeted responsive design changes.
9. Maintain extractor isolation: Web uses Piped/Invidious + Plyr; Windows uses yt-dlp; Android uses NewPipe.
10. Ship a metric, test evidence, release note and rollback/forward-fix plan for each approved item.

## Suggested order

**First:** complete core security, MFA, audit, student history, attendance, certificates, analytics and payment-provider verification on restored Staging.  
**Second:** improve accessibility, reliability, low-bandwidth delivery, support and teacher productivity.  
**Third:** pilot adaptive learning, advanced assessment, organization integrations and optional AI only where outcomes justify cost.

This document changes no application code, database data, payment configuration, Cloudflare Worker setting or Production deployment.
