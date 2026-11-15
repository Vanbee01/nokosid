# NokosID

NokosID combines WhatsApp account verification and virtual-number ordering through VirtuSIM.

## Stack
- Node.js 20 + Express (Vercel Node Function)
- Neon PostgreSQL for durable OTP, user, wallet, ledger, deposit and order data
- Message.co.id for sending the user's own WhatsApp sign-in OTP
- VirtuSIM for purchasing virtual numbers and retrieving provider SMS status

## Vercel setup
1. Import repository Vanbee01/nokosid from GitHub into Vercel.
2. Set Root Directory to the repository root and Node.js runtime to 20.x.
3. Add environment variables:
   - MESSAGE_CO_ID_API_KEY: Message.co.id key used only for account sign-in WhatsApp OTP.
   - SESSION_SECRET: random secret with at least 32 characters.
   - DATABASE_URL: Neon pooled PostgreSQL connection string.
   - VIRTUSIM_API_KEY: API key from your VirtuSIM account.
   - ADMIN_PHONE: your own WhatsApp number in international digits (example 62812...).
   - PRICE_MARKUP_PERCENT: default 20.
   - NODE_ENV=production.
4. Deploy. The database schema is created automatically when the API initializes. SQL is also provided in database/schema.sql.
5. Verify /api/health and test with one small order before inviting users.

## Important
- Never put provider keys in frontend code or commit them to GitHub.
- The WhatsApp OTP flow verifies the user's own NokosID account. VirtuSIM OTP messages belong to the virtual-number order and are shown only to the authenticated order owner.
- VirtuSIM balance and number stock are separate from the user's NokosID wallet.
- Deposits are manual requests: admin must verify payment outside the app before approving. Do not approve an unverified deposit.
- Order purchases debit the local wallet. If the provider rejects a purchase, the API attempts an automatic refund. Reconcile provider and wallet records before live operations.
- Use only for lawful, authorized account testing and services that permit virtual numbers. Do not use this service to bypass another service's security, age, identity, or anti-abuse checks.
- Vercel Hobby is for personal/non-commercial use only. A paid service or revenue-generating operation requires an eligible commercial plan.
- The current frontend is a compact starter dashboard. Payment gateway, full admin UI, automated reconciliation jobs, provider failover, and operational monitoring are not included yet.
