# DanGida

Property marketplace for **Dangaske Real Estate & Property Services Ltd**.
The site name is set with `SITE_NAME` in `.env`, so it can be changed in one place.

## Features

| Feature | How it works |
| --- | --- |
| Phone sign-up, WhatsApp verification | Members enter a phone number and receive a 6-digit code on WhatsApp (WhatsApp Cloud API). |
| Easy-buy plans | Deposit + monthly instalments. Plans are edited in Admin → Easy-buy; each listing opts in. |
| Manage listings from WhatsApp | Admins/agents message the business number: `NEW`, send photos/videos, `PUBLISH`, `SOLD 12`, `PRICE 12 …`, `EDIT`, `DELETE`, `LIST`. Send `HELP` for the menu. |
| Escrow | Buyer pays in, funds are held, buyer confirms handover to release; disputes are settled by an admin (release or refund). |
| Automatic compression | Photos become WebP (max 1600px) plus a thumbnail; videos become 720p H.264 (needs `ffmpeg`). Originals are deleted. |
| Sold clean-up | Marking a listing sold deletes all its media except the cover photo. |
| Push notifications | Members get web push + in-app alerts for new listings, sales, escrow and request matches. |
| Pay to view | Address, full description, gallery, documents and contact are locked until a one-time fee is paid (default in Admin → Settings, override per listing, 0 = free). |
| Social sharing | Share buttons on every listing with rich link previews; optional auto-post of new listings to a Facebook page and Telegram channel. |
| Translation | Language menu (English, Hausa, Yorùbá, Igbo, Arabic, French) powered by Google Translate. |
| Property requests | Buyers/agents submit a specification; agents and admins are alerted and requesters are notified when a matching listing goes live. |

### Trust, discovery and investment

| Feature | How it works |
| --- | --- |
| Verified listings and professionals | Admin marks listings verified/featured; agents, agencies and developers submit an ID (KYC) and get a badge once approved. ID files are stored privately in `data/kyc`. |
| SPV property investment | Admin creates an offer (unit price, units, term, projected return). KYC-verified members buy units, see a portfolio, and receive recorded payouts per unit. |
| Directory and services | Public profiles for agents, agencies, developers and service providers, with their live listings. |
| Markets and new developments | City pages with live counts; off-plan / development projects section. |
| Trust centre | Explains checks and badges; anyone can report a listing or security issue. Reports land in Admin → Reports with risk counters. |
| Audit trail and suspension | Sign-ins, listing/escrow actions and every admin action are logged; admins can suspend an account, which signs it out and hides its listings. |
| Multi-currency display | Visitors can view prices in USD/GBP/AED using rates set in Admin → Settings (payments stay in naira). |
| Articles | Insights, guides, newsroom and careers are written in Admin → Articles. |
| Extras | Ctrl/⌘K search, floating WhatsApp chat button, installable app (PWA), read-only public API (`/developers`), About / Contact / Terms / Privacy pages. |

> **Before opening an SPV offer to the public**, have the structure and offer documents reviewed by a lawyer; public investment offers are regulated (SEC Nigeria). The Terms and Privacy pages are starting templates and also need legal review.

## Run it

Requires Node.js 20.12+ (and `ffmpeg` for video compression).

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run seed
```

```bash
npm start
```

`npm run seed` adds sample listings for exploring; skip it on the live site. `npm test` runs the end-to-end checks.

Without WhatsApp/Paystack keys the site runs in **demo mode**: login codes are shown on screen and a simulated checkout stands in for Paystack. Demo mode is switched off when `NODE_ENV=production`.

## Going live

1. Set `NODE_ENV=production`, `BASE_URL` (https), a long random `SESSION_SECRET`, and `ADMIN_PHONES` (your number, e.g. `2348012345678`).
2. **WhatsApp** (Meta for Developers → WhatsApp → API setup): set `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
   - Webhook URL: `https://your-domain/api/whatsapp/webhook`, subscribe to the `messages` field.
   - Create an *authentication* message template and put its name in `WHATSAPP_OTP_TEMPLATE` (Meta requires a template to message users first).
3. **Paystack**: set `PAYSTACK_SECRET_KEY`; webhook URL `https://your-domain/api/paystack/webhook`.
4. Keep the `data/` folder (database + media) on persistent storage and back it up.
5. Optional: `FB_PAGE_ID` + `FB_PAGE_TOKEN`, `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` for auto-posting.

Escrow payouts and refunds are recorded on the site; the actual transfer to the seller (or refund to the buyer) is made by an admin from Paystack or the bank.

## Layout

- `server/` – Express API, SQLite database, WhatsApp bot, payments, media compression, push
- `public/` – the web app (no build step) and service worker
- `test/` – end-to-end flow tests
