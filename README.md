# NokosID

NokosID account login/registration using SMS OTP through OTP.ID API.

## Deploy to Vercel

1. Import the GitHub repository `Vanbee01/nokosid` at https://vercel.com/new.
2. Select the `main` branch.
3. Keep the project root directory as `./` and let Vercel detect the Node.js project.
4. In Project Settings → Environment Variables, add:
   - `OTP_ID_API_KEY`: secret API key from OTP.ID
   - `OTP_ID_BASE_URL`: `https://api.otp.id`
   - `OTP_ID_BRAND`: `NokosID`
   - `SESSION_SECRET`: a random secret of at least 32 characters
   - `NODE_ENV`: `production`
5. Deploy, then redeploy after changing environment variables.

Do not put API keys in frontend files or commit them to GitHub.

## Run locally

Requires Node.js 20+.

```bash
npm install
SESSION_SECRET="replace-with-a-long-random-secret-value" OTP_ID_API_KEY="your-key" npm start
```

Open http://localhost:3000.

## SMS flow

1. User enters an Indonesian mobile number.
2. Backend calls OTP.ID `POST /v3/request` with channel `sms`.
3. Backend temporarily stores the provider's `otp_id`.
4. User enters the SMS code.
5. Backend calls OTP.ID `POST /v3/verify`.
6. Only a verified response creates an HttpOnly signed session cookie.

OTP values are generated and checked by OTP.ID; this app never invents or exposes OTP values.

## Production notes

- The current OTP request state and rate-limit counters are stored in process memory. Serverless instances can restart or differ between requests, so a shared persistent store (for example Redis) is needed before relying on OTP verification in production.
- The signed session is stateless. Add persistent user profiles/database tables before storing user-specific data.
- Configure a persistent production host and monitor provider delivery, costs, and abuse limits.
- Do not use this account verification flow to rent numbers or receive third-party WhatsApp verification codes.
