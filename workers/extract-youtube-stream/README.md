# ED-ALL Invidious extractor on Cloudflare Workers

This Worker is a Cloudflare-compatible port of the Invidious extractor. It does not use Lovable Cloud or a Supabase project.

## Free plan

Cloudflare Workers currently has a Free plan with 100,000 requests per day. CPU time is limited to 10 ms per request. The Worker mostly waits for remote Invidious APIs, so network wait time does not count as CPU time. Cloudflare may change these limits.

## One-time setup

1. Create or sign in to a Cloudflare account: https://dash.cloudflare.com/
2. In Cloudflare, create an API token using the **Edit Cloudflare Workers** template. Keep the token private.
3. Copy the Account ID from the Workers & Pages overview page.
4. In GitHub, open this repository's **Settings → Secrets and variables → Actions**.
5. Add these two repository secrets:
   - `CLOUDFLARE_API_TOKEN`: the API token created above.
   - `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare Account ID.
6. Open **Actions → Deploy Invidious extractor to Cloudflare Workers → Run workflow**.
7. After deployment, Cloudflare displays the Worker URL. With the configured name it will usually look like `https://edall-invidious-extractor.<your-account-subdomain>.workers.dev`.

## Smoke test

Send a POST request to the Worker URL with JSON:
```json
{"videoId":"dQw4w9WgXcQ","excludeInstances":[]}
```

Expected successful responses contain `success: true`, `instance`, and stream data. An error response is JSON with `success: false`.

The website is intentionally not pointed at this Worker until its deployed URL is known and a successful smoke test has been performed.
