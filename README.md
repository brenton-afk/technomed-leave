# TechnoMed Leave Portal

A mobile-first Progressive Web App for staff leave and TOIL applications, integrating with Xero Payroll, Google Calendar and SendGrid email.

---

## Tech Stack

- **Frontend:** React + Vite (PWA — installable on iOS & Android)
- **Backend:** Vercel Serverless Functions (Node.js 18)
- **Hosting:** Vercel (auto-deploys from GitHub)
- **Integrations:** Xero Payroll API, Google Calendar API, SendGrid

---

## Step 1 — Push to GitHub

1. Create a new repository at github.com (e.g. `technomed-leave`)
2. In your terminal:

```bash
cd technomed-leave
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/technomed-leave.git
git push -u origin main
```

---

## Step 2 — Deploy to Vercel

1. Go to vercel.com and sign in with GitHub
2. Click **"Add New Project"**
3. Import your `technomed-leave` repository
4. Vercel will auto-detect it as a Vite project
5. Click **Deploy** — your app will be live at a `.vercel.app` URL within 60 seconds

---

## Step 3 — Set Environment Variables in Vercel

In your Vercel project dashboard → **Settings → Environment Variables**, add each of these:

| Variable | Value |
|---|---|
| `XERO_CLIENT_ID` | Your Xero Client ID |
| `XERO_CLIENT_SECRET` | Your Xero Client Secret |
| `XERO_REDIRECT_URI` | `https://leave.technomed.com.au/api/xero/callback` |
| `XERO_TENANT_ID` | (Get this after connecting — see Step 5) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Full JSON content of service account key (one line) |
| `GOOGLE_CALENDAR_ID` | `bookings@technomed.com.au` |
| `SENDGRID_API_KEY` | Your SendGrid API key |
| `EMAIL_FROM` | `noreply@technomed.com.au` |
| `EMAIL_TO_1` | `Erin@technomed.com.au` |
| `EMAIL_TO_2` | `Brenton@technomed.com.au` |
| `EMAIL_TO_3` | `Bookings@technomed.com.au` |

After adding variables, click **Redeploy** in Vercel.

---

## Step 4 — Custom Domain

1. In Vercel → **Settings → Domains**, add `leave.technomed.com.au`
2. Vercel will show you a DNS record to add
3. Log in to your domain registrar (wherever technomed.com.au is registered)
4. Add the CNAME record Vercel specifies
5. SSL certificate is automatically provisioned — usually live within 10 minutes

---

## Step 5 — Connect Xero (First-Time Setup)

1. Visit `https://leave.technomed.com.au/api/xero/connect` in your browser
2. Log in to Xero when prompted
3. Authorise the TechnoMed Leave Portal app
4. You'll be redirected back to the app
5. Check your Vercel function logs (Vercel dashboard → Functions) — copy the **Tenant ID** from the log output
6. Add `XERO_TENANT_ID` as an environment variable in Vercel and redeploy

---

## Step 6 — Set Up Google Calendar Service Account

This allows the app to write events to bookings@technomed.com.au automatically.

1. Go to console.cloud.google.com
2. Create a new project called "TechnoMed Leave"
3. Enable the **Google Calendar API** (APIs & Services → Enable APIs)
4. Go to **IAM & Admin → Service Accounts → Create Service Account**
   - Name: `technomed-leave-calendar`
   - Click Create
5. On the service account, click **Keys → Add Key → Create new key → JSON**
   - Download the JSON file
6. Open the JSON file in a text editor, copy ALL the content
7. In Vercel environment variables, paste it as `GOOGLE_SERVICE_ACCOUNT_JSON` (one line — remove any line breaks)
8. **Share your Google Calendar with the service account:**
   - Open Google Calendar → bookings@technomed.com.au calendar settings
   - Under "Share with specific people", add the service account email (looks like `technomed-leave-calendar@technomed-leave-xxxxx.iam.gserviceaccount.com`)
   - Set permission to **"Make changes to events"**
9. Redeploy Vercel

---

## Step 7 — Set Up SendGrid

1. Go to sendgrid.com and create a free account
2. Go to **Settings → API Keys → Create API Key**
   - Name: "TechnoMed Leave Portal"
   - Permission: Full Access (or Restricted → Mail Send only)
3. Copy the API key and add as `SENDGRID_API_KEY` in Vercel
4. **Verify your sender domain:**
   - SendGrid → Settings → Sender Authentication
   - Authenticate `technomed.com.au`
   - Add the DNS records SendGrid provides to your domain registrar

---

## Install on Staff Phones (PWA)

### iPhone (Safari):
1. Open `https://leave.technomed.com.au` in Safari
2. Tap the Share button (box with arrow)
3. Tap **"Add to Home Screen"**
4. Tap **Add** — the app icon appears on the home screen

### Android (Chrome):
1. Open `https://leave.technomed.com.au` in Chrome
2. Tap the three-dot menu
3. Tap **"Add to Home screen"** or **"Install app"**
4. Tap **Install**

---

## Xero Leave Type Mapping

The app maps to these Xero leave type names. Check your Xero payroll settings match:

| App selection | Expected Xero leave type name |
|---|---|
| Annual Leave | `Annual Leave` |
| Personal / Sick Leave | `Personal/Carer's Leave` |
| TOIL | `Time Off In Lieu` |

If your Xero leave type names differ, update `LEAVE_TYPE_MAP` in `api/_xeroClient.js`.

---

## Xero Me Compatibility

Yes — since this app writes directly to Xero's Payroll API, all submitted leave applications appear automatically in the **Xero Me** mobile app for each employee. Staff can:
- View their leave balances in Xero Me
- See pending leave applications
- Track approval status

Recommend staff download Xero Me as a companion to this portal.

---

## Folder Structure

```
technomed-leave/
├── api/
│   ├── submit.js              # Main submission orchestrator
│   ├── _xeroClient.js         # Xero API helpers
│   ├── _googleCalendar.js     # Google Calendar helpers
│   ├── _email.js              # SendGrid email helpers
│   └── xero/
│       ├── connect.js         # OAuth login redirect
│       ├── callback.js        # OAuth token exchange
│       ├── status.js          # Connection status check
│       └── balances.js        # Employee leave balances
├── src/
│   ├── pages/
│   │   ├── LeaveForm.jsx      # Main multi-step form
│   │   ├── LeaveForm.module.css
│   │   ├── Success.jsx        # Post-submission screen
│   │   └── XeroCallback.jsx   # OAuth redirect handler
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css
├── public/
│   └── manifest.json          # PWA manifest
├── index.html
├── vite.config.js
├── vercel.json
├── package.json
└── .env.example               # Template — never commit .env
```

---

## Support

For technical issues contact your app developer or raise a GitHub issue.
