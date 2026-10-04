# Maknazul 'Irfan Academy — Attendance Portal (self-hosted)

This is a standalone, installable version of the attendance portal. Unlike
the version inside Claude, this one runs on your own web hosting and its
own database, so it's not limited to people signed into any particular
organization — anyone with the link (administrators, teachers, and
parents/guardians) can open it and, once installed, it behaves like a real
app: its own icon, no browser address bar, works offline for the app
shell.

It keeps the same features: role-based sign-in (Administrator / Teacher
with an access code, Parent/Guardian with student ID + surname), daily
attendance marking, dashboard with a 14-day trend and chronic-absence
alerts, roster + CSV import, reports with CSV export, and staff notes.

## What you need

- A free [Supabase](https://supabase.com) account (this is the database).
- Somewhere to host static files — the easiest free options are
  [Netlify](https://netlify.com), [Vercel](https://vercel.com), [Cloudflare
  Pages](https://pages.cloudflare.com), or GitHub Pages. Any of them works;
  the steps below use Netlify because it has a drag-and-drop option that
  needs no command line.

## 1. Create the database (Supabase)

1. Go to [supabase.com](https://supabase.com), sign up, and create a new
   project (pick any name/region; the free tier is enough for a school).
2. Once it's ready, open **SQL Editor** in the left sidebar → **New query**.
3. Open `supabase-schema.sql` from this folder, copy its entire contents,
   paste into the SQL editor, and click **Run**. This creates all the
   tables, security rules, and starter access codes.
4. Go to **Settings → API**. You'll need two values from this page:
   - **Project URL**
   - **anon public** key (a long string under "Project API keys")

## 2. Connect the app to your database

1. Open `config.js` in this folder.
2. Replace the two placeholder values with the Project URL and anon key
   from step 1.4, then save.

```js
window.MIA_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxxxxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi...",
};
```

That's the only file you need to edit before deploying.

## 3. Deploy the files

**Easiest option — Netlify Drop (no account needed to try it, free account
to keep the link permanently):**

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop).
2. Drag the whole `mia-portal` folder (this folder) onto the page.
3. Netlify gives you a live `https://your-site-name.netlify.app` link
   within seconds. Create a free Netlify account to keep it live long-term
   and optionally rename it or attach your own domain.

**Alternatives**, if you'd rather use something else:
- **Vercel**: `npx vercel` from inside this folder (needs Node.js
  installed), or drag-and-drop deploy from vercel.com.
- **Cloudflare Pages**: connect a GitHub repo containing this folder, or
  use their dashboard's direct upload.
- **GitHub Pages**: push this folder to a GitHub repo, then enable Pages
  in the repo's Settings → Pages, pointing at the branch/folder.

Whichever you use, the result should be a real `https://` URL. That's
required both for installing it as an app and for the "Add to Home
Screen"/service worker to work at all.

## 4. Try it and install it

1. Open your new `https://...` link on your phone.
2. **iPhone (Safari):** tap Share → **Add to Home Screen**.
3. **Android (Chrome):** tap **⋮** → **Install app** (or "Add to Home
   screen" if that's what shows). Because this is now a real hosted site
   with a proper service worker, Chrome's automatic install banner should
   also appear on its own after a visit or two.
4. Open it from the new home-screen icon — it should launch full-screen,
   no address bar.

## 5. First-time setup inside the app

1. Sign in as **Administrator** using the default code `MIA-ADMIN-2026`
   (from `supabase-schema.sql`).
2. Go to **Access Codes** and change both the admin and staff codes
   immediately — don't leave the defaults in place.
3. Add your sections and students (one at a time, or **Import roster**
   for a CSV/pasted spreadsheet).
4. Share the site link with your teaching staff (with the new staff code)
   and with parents/guardians (no code needed — they use their child's
   student ID + surname).

## Updating the app later

If you (or I, in a future chat) change `app.js`, `styles.css`, or any
other file, just re-upload the changed files to your host (e.g. drag the
folder onto Netlify Drop again). Existing data in Supabase is untouched —
only the app's files change.

If you edit `service-worker.js`'s `CACHE_VERSION` line to a new value on
each deploy, installed devices will pick up the new files automatically
the next time they open the app.

## Security notes — please read

- **Staff sign-in codes and parent ID+surname checks are app-level, not
  database-level.** The database itself is reachable by anyone who has
  your Supabase anon key, which is visible in this app's source code once
  deployed. This is a normal trade-off for a small internal tool, but it
  means a technically determined person could bypass the login screens
  and query the database directly.
- If that's not an acceptable risk for your school (e.g. you're storing
  sensitive guardian contact details you want strongly protected), the
  next step up is adding **Supabase Auth** (real logins per staff member)
  and rewriting the Row Level Security policies in `supabase-schema.sql`
  to check the logged-in user instead of allowing anyone with the key.
  That's a bigger change — let me know if you'd like help building it.
- Change the default access codes (step 5.2) before sharing the link
  with anyone.

## Files in this folder

| File | Purpose |
|---|---|
| `index.html` | Page shell, loads fonts, Chart.js, Supabase client, styles, app |
| `styles.css` | All visual styling |
| `app.js` | All app logic and Supabase data calls |
| `config.js` | **Edit this** — your Supabase URL + anon key |
| `manifest.webmanifest` | Makes the app installable, sets its icon/name |
| `service-worker.js` | Caches the app shell so it opens instantly and works offline |
| `supabase-schema.sql` | **Run this** in Supabase's SQL Editor once |
| `icons/` | App icons generated from the academy crest |
