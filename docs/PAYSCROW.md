# PayScrow escrow for property purchases

When `PAYSCROW_API_KEY` is set, **escrow** on the site runs through PayScrow (https://payscrow.net). The buyer's money is held
by PayScrow, not in our bank account. Every other payment (inspection, request fee, plans, SPV units) stays on bank transfer.

## Set up
1. PayScrow dashboard: complete business (KYB) verification, then **Access & API** → generate your **API key**.
2. Same page → **Webhook Signing Secret** → **Generate Secret** (starts with `whsec_`).
3. Same page → **Marketplace Customer Review Period**: choose how many days a buyer has to approve or dispute after delivery
   (1–30; default 7). Optionally set the merchant action period and what happens if the seller never delivers.
4. Put both values in the server's `.env` (never in the repository), then restart:
   ```
   PAYSCROW_API_KEY=...
   PAYSCROW_WEBHOOK_SECRET=whsec_...
   ```
   Sandbox: ask PayScrow for the sandbox base URL and set `PAYSCROW_BASE_URL` to it while testing.
5. The site tells PayScrow to send notifications to `https://YOUR-DOMAIN/api/payscrow/webhook` on every transaction
   (needs `BASE_URL` to start with `https://`). Nothing to enter in the PayScrow dashboard for this.
6. Admin → Settings → "PayScrow charge borne by seller (%)": the share of PayScrow's charge the seller pays (the buyer pays the rest).

## How a purchase works
1. Buyer opens escrow on a listing and presses **Pay**. The site creates the PayScrow transaction and sends the buyer to PayScrow's payment page.
   Both buyer and seller need a **confirmed email address** on their account, and the buyer a Nigerian phone number. For listings
   owned by the company, the contact email in Admin → Settings is used.
2. PayScrow confirms payment by webhook; the escrow shows **Funded**.
3. After handover, either:
   - the **buyer** presses **Release with escrow code** and enters the code PayScrow showed them, or
   - the **seller** presses **Submit delivery details**; PayScrow emails the buyer to approve or dispute, and funds can be released
     automatically when the review period ends.
4. Release marks the property **sold** (all media except the cover is deleted). A dispute is handled by PayScrow's arbiter; its
   ruling (refund, close or split) is applied to the escrow automatically.

## Notes
- The inspection fee credit still reduces the price the buyer pays through escrow. The company holds that fee, so settle the
  difference with the seller yourself.
- Our own escrow fee (%) is not charged on PayScrow escrows; PayScrow's charge applies instead.
- Released funds go to the seller's PayScrow wallet (they withdraw to their bank from PayScrow).
- Admin cannot release or refund PayScrow-held money from this site; use PayScrow's dispute process.
- Treat the integration as untested against the live API until you run a small real transaction end to end.
