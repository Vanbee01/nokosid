# NokosID

NokosID account login/registration using SMS OTP through Vonage Verify API v2.

## Deploy to Vercel

1. Import the GitHub repository `Vanbee01/nokosid` at https://vercel.com/new.
2. Select the `main` branch and keep the project root as `./`.
3. In Project Settings → Environment Variables, add:
   - `VONAGE_API_KEY`: API key from Vonage API Settings
   - `VONAGE_API_SECRET`: API secret from Vonage API Settings
   - `VONAGE_BRAND`: `NokosID`
   - `SESSION_SECRET`: a random secret of at least 32 characters
   - `NODE_ENV`: `production`
4. Apply the variables to Production (and Preview if needed), save, then redeploy.

Do not put Vonage credentials in frontend files or commit them to GitHub. This integration uses Verify API v2 Basic Authentication for a straightforward initial setup. Vonage also supports JWT authentication for production features such as callbacks.

## SMS verification flow

1. User enters an Indonesian mobile number.
2. Backend normalizes it to E.164 and calls Vonage `POST /v2/verify` with an SMS workflow and six-digit code.
3. Backend temporarily stores Vonage's `request_id`.
4. User enters the SMS code.
5. Backend calls Vonage `POST /v2/verify/{request_id}` and accepts only `status: completed`.
6. Only a verified response creates an HttpOnly signed session cookie.

## Run locally

Requires Node.js 20+.

```bash
npm install
VONAGE_API_KEY="your-key" VONAGE_API_SECRET="your-secret" SESSION_SECRET="replace-with-a-long-random-secret-value" npm start
```

Open http://localhost:3000.

## Production notes

- The current verification request state and rate-limit counters are stored in process memory. Vercel serverless instances can restart or differ between requests, so a shared persistent store (for example Redis/KV) is required before relying on verification in production.
- The signed session is stateless. Add persistent user profiles/database tables before storing user-specific data.
- Confirm Vonage account credit, Verify API availability, and destination-country support in the Vonage dashboard before live use.
- Do not use this account verification flow to rent numbers or receive third-party WhatsApp verification codes.
