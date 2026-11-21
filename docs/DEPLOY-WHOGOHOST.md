# Putting the site live on WhoGoHost (cPanel)

Domain: **dangaskerealestate.com.ng** · Plan: **Pro (15 GB)** or higher.

You will need about 30–45 minutes. Do the steps in order.

## 1. Point the domain and turn on HTTPS

1. In the WhoGoHost client area, attach `dangaskerealestate.com.ng` to the hosting plan (as the main domain).
2. In cPanel → **SSL/TLS Status**, run **AutoSSL** for the domain and wait until it shows a green padlock.

## 2. Upload the code

In cPanel → **Git™ Version Control** → **Create**:

- Clone URL: `https://github.com/AbuBkrrr/Dangaske.git`
- Repository path: `dangaske` (this creates `/home/YOUR_CPANEL_USER/dangaske`)

(If Git is not offered: download the repository as a ZIP from GitHub, upload it in **File Manager** and extract it into a folder named `dangaske` in your home directory — **not** inside `public_html`.)

## 3. Create the Node.js app

cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
| --- | --- |
| Node.js version | 20 or newer (22 if offered) |
| Application mode | Production |
| Application root | `dangaske` |
| Application URL | `dangaskerealestate.com.ng` |
| Application startup file | `app.js` |

Click **Create**. Then, on the same page, click **Run NPM Install** and wait for it to finish.

> If NPM Install reports an error about `better-sqlite3` or `sharp`, the Node version is too old or the plan blocks
> native modules — open a WhoGoHost support ticket asking them to "allow native Node modules (node-gyp prebuilt
> binaries) for my Node.js app", or move to their VPS.

## 4. Add the settings (environment variables)

On the same page, under **Environment variables**, add these. Start with the first block; the site runs in demo
mode for anything you leave out.

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `BASE_URL` | `https://dangaskerealestate.com.ng` |
| `SESSION_SECRET` | a long random phrase (40+ characters) — keep it private |
| `ADMIN_PHONES` | `2348037572052,2348161304050` |
| `CRON_KEY` | another random word, e.g. 24 letters and digits |

Email (step 5):

| `SMTP_HOST` | `mail.dangaskerealestate.com.ng` |
| --- | --- |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `no-reply@dangaskerealestate.com.ng` |
| `SMTP_PASS` | that mailbox's password |
| `MAIL_FROM` | `no-reply@dangaskerealestate.com.ng` |

WhatsApp and Paystack (steps 7 and 8): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_OTP_TEMPLATE`, `PAYSTACK_SECRET_KEY`.

Click **Save**, then **Restart**. Open `https://dangaskerealestate.com.ng` — the site should load.

## 5. Email

cPanel → **Email Accounts** → create `no-reply@dangaskerealestate.com.ng` (used by the site to send) and, if you
like, `info@dangaskerealestate.com.ng` (for people to write to). Put the `no-reply` details in the variables above,
then in the site go to **Admin → Settings** and enter `info@…` as the contact email.

## 6. Hourly reminders (important on shared hosting)

Shared hosting puts an app to sleep when nobody is visiting, so reminders must be triggered from outside.
cPanel → **Cron Jobs** → add a job that runs **once per hour** (`0 * * * *`):

```bash
curl -s "https://dangaskerealestate.com.ng/api/cron?key=YOUR_CRON_KEY" > /dev/null
```

This sends instalment and inspection reminders and also keeps the app awake.

## 7. WhatsApp (login codes, listing bot, notifications)

1. At developers.facebook.com create a Business app and add the **WhatsApp** product. Register the business
   number you will use (it cannot be a number that is active in the normal WhatsApp app at the same time).
2. Copy the **Phone number ID** and a **permanent access token** (System User token) into `WHATSAPP_PHONE_ID` and
   `WHATSAPP_TOKEN`. Copy the **App secret** into `WHATSAPP_APP_SECRET`.
3. Webhook: callback URL `https://dangaskerealestate.com.ng/api/whatsapp/webhook`, verify token = whatever you
   put in `WHATSAPP_VERIFY_TOKEN`; subscribe to the **messages** field.
4. Create a message template in the **Authentication** category and put its name in `WHATSAPP_OTP_TEMPLATE`.
5. Restart the app.

## 8. Paystack

Put the **live secret key** in `PAYSTACK_SECRET_KEY`, set the webhook URL in the Paystack dashboard to
`https://dangaskerealestate.com.ng/api/paystack/webhook`, and restart.

## 9. First sign-in

Sign in on the site with one of the admin phone numbers. You will see **Admin** in the menu. Check
**Admin → Settings → Integrations**: each item should say *Connected*.

## Updating the site later

cPanel → **Git Version Control** → **Manage** → **Pull or Deploy** → *Update from Remote*; then
**Setup Node.js App** → **Run NPM Install** (only if dependencies changed) → **Restart**.

## Backups

Everything that matters is in the `dangaske/data` folder (database, photos, ID documents, vault). Download it
regularly with cPanel → **Backup** or File Manager → Compress. Never delete it when updating.

## Known limits of shared hosting

- **Sleep:** the first visit after a quiet period can take a few seconds; the cron job above reduces this.
- **Video compression** uses a bundled copy of ffmpeg and is slow on shared CPUs; very large videos may time out.
  Ask agents to keep clips short (under a minute).
- **Storage:** 15 GB covers roughly 1,000–2,000 live listings with photos. Watch **Admin → Media storage**.
- When traffic grows, move to a VPS — the same code runs there with `npm start`.
