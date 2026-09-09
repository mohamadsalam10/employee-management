# Team Attendance Dashboard

A web dashboard for viewing your team's attendance (punch in/out) from a
Hikvision-style ISAPI access-control device. Built to run on [Render](https://render.com).

- **Login-protected** — nobody sees the board without the password you set.
- **No secrets in the code** — the device password lives in Render's settings, not in this repo.
- **Door control is off by default**, so a public link can't unlock anything.

---

## What you'll set (environment variables)

These go into **Render's settings**, never into the code:

| Variable | What it is | Example |
|---|---|---|
| `DEVICE_HOST` | Your device address | `800storage90.mynetgear.com` |
| `DEVICE_PORT` | Device port | `50443` |
| `DEVICE_USER` | Device username | `admin` |
| `DEVICE_PASS` | Device password | *(your device password)* |
| `DASHBOARD_PASSWORD` | The password **you pick** to log into this site | *(something strong)* |
| `SESSION_SECRET` | Random string for logins — let Render generate it | *(auto)* |
| `TZ_OFFSET` | Your timezone (Gulf = +04:00) | `+04:00` |
| `ENABLE_DOORS` | Leave `false` unless you want remote unlock | `false` |

---

## Deploy to Render (using the blueprint)

This repo includes a `render.yaml`, so Render can set most of it up for you.

1. **Put this project in a GitHub repo.** Create a free GitHub account if you
   don't have one, make a new repository, and upload all these files to it
   (GitHub's website lets you drag files straight into a repo).
2. Go to **render.com**, sign up (you can sign in with GitHub), and on the
   dashboard click **New → Blueprint**.
3. Pick your repository. Render reads `render.yaml` and shows the service.
4. It will **prompt you for the secret values**: `DEVICE_HOST`, `DEVICE_PASS`,
   and `DASHBOARD_PASSWORD`. Fill those in. (`SESSION_SECRET` is generated for
   you; the rest have defaults.)
5. Click **Apply / Create**. Render installs and starts it (takes a minute or two).
6. When it's live, Render gives you a URL like
   `https://team-attendance.onrender.com`. Open it — you'll get the login page.
   Enter the `DASHBOARD_PASSWORD` you chose.

### If you prefer to set it up by hand

Instead of the blueprint: **New → Web Service**, connect the repo, and set
- **Build command:** `npm install`
- **Start command:** `node server.js`

Then add each environment variable from the table above under **Environment**,
and deploy.

---

## Good to know

- **Free plan sleeps.** On Render's free tier the site goes to sleep after a
  while with no visitors, so the first load in the morning can take ~30–60
  seconds to wake up. A paid instance stays awake. Either works.
- **The device must stay reachable** at the address you set. If you can open
  `https://DEVICE_HOST:PORT` from a phone on mobile data, Render can reach it too.
- **Sessions last 12 hours**, then it asks for the password again.
- **Changing the password** later: edit `DASHBOARD_PASSWORD` in Render and it
  redeploys automatically.

## Cameras and doors (optional)

- To show camera snapshots, set a `CAMERAS` variable to a JSON list, e.g.
  `[{"label":"Entrance","channel":"101"}]`. The Cameras tab then shows stills.
- Door unlock stays hidden unless you set `ENABLE_DOORS=true` **and** provide a
  `DOORS` list. Only turn this on if you understand it lets logged-in users open
  a physical door from anywhere.

## How in/out is decided

If the device tags events with an attendance status, that's used. Otherwise the
first punch of a person's day is "in" and it alternates from there — correct in
the normal case, and you can expand any row to see the raw punch times and check.

## Running it locally (optional)

```bash
npm install        # nothing to install, but harmless
DEVICE_HOST=... DEVICE_PASS=... DASHBOARD_PASSWORD=test node server.js
```
Then open http://localhost:3000.
