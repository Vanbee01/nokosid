# NokosID

NokosID account login/registration using WhatsApp OTP through Message.co.id.

## Deploy to Vercel

1. Import the GitHub repository `Vanbee01/nokosid` at https://vercel.com/new.
2. Select the `main` branch and keep the project root as `./`.
3. In Project Settings → Environment Variables, add:
   - `MESSAGE_CO_ID_API_KEY`: API key from Message.co.id WhatsApp OTP
   - `SESSION_SECRET`: a random secret of at least 32 characters
   - `NODE_ENV`: `production`
4. Apply the variables to Production (and Preview if needed), save, then redeploy.

Do not put provider credentials in frontend files or commit them to GitHub.

## WhatsApp OTP flow

1. User enters an Indonesian WhatsApp number.
2. Backend normalizes it to international digits (for example, `628123456789`).
3. Backend generates a cryptographically random six-digit OTP and sends it using `POST https://message.co.id/api/v1/whatsapp/otp/send`, with `X-API-Key`, `Content-Type: application/json`, and a unique `Idempotency-Key`.
4. The API accepts `{ "to": "628...", "message": "123456" }`; the message field contains digits only.
5. The backend stores an HMAC hash of the OTP for five minutes. It permits at most five verification attempts.
6. A correct OTP creates an HttpOnly signed session cookie. Message.co.id's documented endpoint sends the OTP; verification is performed by NokosID itself.

The provider's `accepted` response means the request was accepted by the provider, not necessarily that the user has already received or read the WhatsApp message.

## Run locally

Requires Node.js 20+.

```bash
npm install
MESSAGE_CO_ID_API_KEY="your-api-key" SESSION_SECRET="replace-with-a-long-random-secret-value" npm start
```

Open http://localhost:3000.

## Production notes

- Pending OTPs and rate-limit counters are currently stored in process memory. Vercel serverless instances can restart or differ between requests, so a shared persistent store (for example Redis/KV) is required before relying on verification in production.
- The signed session is stateless. Add persistent user profiles/database tables before storing user-specific data.
- Confirm WhatsApp OTP credit and destination support in the Message.co.id dashboard before live use.
- This flow is for verifying a user's own NokosID account. It does not rent numbers or receive third-party verification codes.
