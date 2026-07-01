// RESEND_API_KEY is a secret (set via `wrangler secret put`), so it isn't
// captured by `wrangler types`/wrangler.jsonc like the plain `vars` are.
interface Env {
	RESEND_API_KEY: string;
}