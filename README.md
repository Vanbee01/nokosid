# NokosID

NokosID account login/registration using SMS OTP through OTP.ID API.

## Requirements

- Node.js 20+
- OTP.ID merchant account and API key
- A long random session secret (at least 32 characters)

## Environment variables

Copy `.env.example` values into your hosting provider's environment settings:

- `OTP_ID_API_KEY`: secret API key from OTP.ID
- `OTP_ID_BASE_URL`: optional, defaults to `https://api.otp.id`
- `OTP_ID_BRAND`: optional, defaults to `NokosID`
- `SESSION_SECRET`: random secret, minimum 32 characters
- `NODE_ENV`: set to `production` when deployed
- `PORT`: provided by hosting platform

Never put API keys in frontend files or commit them to GitHub.

## Run locally

```bash
npm install
SESSION_SECRET="replace-with-a-long-random-secret-value" OTP_ID_API_KEY="your-key" npm start
```

Open http://localhost:3000.

## SMS flow

1. User enters an Indonesian mobile number.
2. Backend calls OTP.ID `POST /v3/request` with channel `sms`.
3. Backend stores the provider's `otp_id` temporarily.
4. User enters the SMS code.
5. Backend calls OTP.ID `POST /v3/verify`.
6. Only a verified response creates an HttpOnly signed session cookie.

OTP values are generated and checked by OTP.ID; this app never invents or exposes OTP values.

## Important production notes

- OTP pending requests and rate-limit counters are held in process memory and reset on server restart. Use a shared store (for example Redis) before running multiple instances.
- The signed session is stateless. Add persistent user profiles/database tables before storing user-specific data.
- Configure a persistent production host and monitor provider delivery, costs, and abuse limits.
- Do not use this account verification flow to rent numbers or receive third-party WhatsApp verification codes.
