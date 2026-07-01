/**
 * Cloudflare Worker — Contact form handler
 *
 * Flow: your Angular app POSTs JSON { name, email, message, website }
 *  -> this Worker validates it, blocks basic spam, and emails it to you via Resend.
 *
 * Secrets / vars to set (see deployment notes at the bottom):
 *   RESEND_API_KEY   (secret)  – from resend.com
 *   TO_EMAIL         (var)     – where you want to receive messages, e.g. muka.grei@gmail.com
 *   FROM_EMAIL       (var)     – a verified sender on your Resend domain, e.g. contact@yourdomain.com
 *   ALLOWED_ORIGIN   (var)     – your site's origin, e.g. https://yourdomain.com
 */

interface ContactFormPayload {
	name?: unknown;
	email?: unknown;
	message?: unknown;
	website?: unknown;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const origin = request.headers.get("Origin") || "";
		const allowed = env.ALLOWED_ORIGIN || "";

		// --- CORS preflight ---------------------------------------------------
		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: corsHeaders(origin, allowed) });
		}

		// Only POST is accepted.
		if (request.method !== "POST") {
			return json({ error: "Method not allowed" }, 405, origin, allowed);
		}

		// Reject anything not coming from your site.
		if (allowed && origin !== allowed) {
			return json({ error: "Forbidden" }, 403, origin, allowed);
		}

		// --- Parse body -------------------------------------------------------
		let data: ContactFormPayload;
		try {
			data = await request.json();
		} catch {
			return json({ error: "Invalid JSON" }, 400, origin, allowed);
		}

		const name = (data.name || "").toString().trim();
		const email = (data.email || "").toString().trim();
		const message = (data.message || "").toString().trim();
		const honeypot = (data.website || "").toString().trim(); // hidden field, must stay empty

		// --- Spam check (honeypot) -------------------------------------------
		// Real users never fill the hidden "website" field; bots usually do.
		// We pretend success so the bot doesn't retry.
		if (honeypot) {
			return json({ ok: true }, 200, origin, allowed);
		}

		// --- Validation -------------------------------------------------------
		const errors: string[] = [];
		if (name.length < 2 || name.length > 100) errors.push("name");
		if (!isValidEmail(email)) errors.push("email");
		if (message.length < 5 || message.length > 5000) errors.push("message");
		if (errors.length) {
			return json({ error: "Validation failed", fields: errors }, 422, origin, allowed);
		}

		// --- Send via Resend --------------------------------------------------
		try {
			const res = await fetch("https://api.resend.com/emails", {
				method: "POST",
				headers: {
					Authorization: `Bearer ${env.RESEND_API_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					from: `Contact form <${env.FROM_EMAIL}>`,
					to: [env.TO_EMAIL],
					reply_to: email, // so you can reply straight to the client
					subject: `New message from ${name}`,
					text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
				}),
			});

			if (!res.ok) {
				const detail = await res.text();
				console.error("Resend error:", res.status, detail);
				return json({ error: "Failed to send" }, 502, origin, allowed);
			}

			return json({ ok: true }, 200, origin, allowed);
		} catch (err) {
			console.error("Worker error:", err);
			return json({ error: "Server error" }, 500, origin, allowed);
		}
	},
} satisfies ExportedHandler<Env>;

// --- helpers ------------------------------------------------------------

function isValidEmail(value: string): boolean {
	// Pragmatic check — not RFC-perfect, but rejects obvious junk.
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function corsHeaders(origin: string, allowed: string): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": allowed && origin === allowed ? origin : "null",
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
	};
}

function json(body: unknown, status: number, origin: string, allowed: string): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			...corsHeaders(origin, allowed),
		},
	});
}