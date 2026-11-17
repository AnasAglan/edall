# ED-ALL Operations: Backups, Restore, Monitoring

This document is an operational runbook, not evidence that a backup service or monitoring vendor has already been configured.

## Database backups
1. Use the Supabase project's supported backup/PITR settings for the production plan and confirm the retention window in the Supabase dashboard.
2. Keep an additional encrypted logical export outside the Supabase project for critical releases. Restrict access to designated administrators; never commit dump files, service-role keys, or backup encryption keys.
3. Export schema and data separately when practical. Record the exact migration revision and application commit alongside every backup.
4. Before a risky schema release, capture a fresh backup and record its timestamp and restore point.
5. Do not use an unencrypted local download as the only recovery copy.

## Restore drill
1. Restore into a separate staging Supabase project, never over production during a test.
2. Apply the recorded application release and migrations to the restored staging database.
3. Verify login, user roles, course enrollment, free and paid access, lesson videos/PDF signed URLs, exams, assignment submissions, attendance, certificates, payment order state, and teacher/admin scopes.
4. Verify Storage objects and bucket privacy separately; a PostgreSQL dump alone is not a complete Storage backup.
5. Record restore duration, missing objects, errors, and the person who approved the drill.
6. Only promote a recovery plan after a successful staging drill.

## Monitoring and abuse controls
- Alert on repeated failed login, MFA challenges, admin account creation failures, unusual Storage upload volume, repeated payment callback failures, payment/order amount mismatches, Worker 5xx rates, and unusual extractor bandwidth.
- Keep request IDs, event IDs, status codes, timestamps and redacted error codes. Do not log bearer tokens, passwords, signed URLs, payment secrets, raw card data, or raw webhook payloads.
- Apply rate limits at the edge/server for account creation, payment-intent creation, webhook retry traffic, assignment attachments, discussion posting, and video extraction.
- Use provider-side alerting for payment settlement and failed webhooks; reconcile paid orders against provider reports before manual correction.
- Review administrator MFA enrollment, course-scoped staff assignments, and audit events periodically.
- Define an escalation owner and an incident response contact before enabling payment processing.

## Release gate
- A migration must first pass staging apply, RLS role-matrix tests, and backup/restore verification.
- Production migration, code merge, and deploy are separate operations. Do not treat a successful preview build as a production release.
- Verify PWA service-worker caches after each release. Only the explicit public shell allowlist may be cached; authentication, REST, Storage, Functions, private lesson objects, signed URLs and media must always bypass caches.

## External providers
Paymob, live meeting rooms, and automated recordings require merchant/provider credentials and account setup. Their UI/DB adapter may remain present but disabled until the responsible provider configuration is complete.
