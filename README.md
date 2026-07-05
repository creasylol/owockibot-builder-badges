# owockibot Builder Badges — GitHub Pages edition

This is the **static** version of the badge generator, built to run entirely on GitHub (Pages + Actions), no Cloudflare account needed.

**How it works:** a GitHub Actions workflow runs every 30 minutes, fetches the live [owockibot bounty board API](https://www.owockibot.xyz/api/bounty-board), regenerates one SVG badge per builder into `docs/badges/`, and commits the result. GitHub Pages then serves `docs/` as a static site. Badges are "live" up to a 30-minute lag (or however often you set the cron), not truly real-time like the Cloudflare Worker version — that's the fundamental tradeoff of static hosting vs. a server that runs code per-request.

## Step-by-step setup

### 1. Create the repo
On GitHub: **New repository** → name it whatever you like (e.g. `owockibot-badges`) → public → create.

### 2. Add these files
Put these files in the repo, preserving the folder structure exactly:

```
your-repo/
├── .github/
│   └── workflows/
│       └── update-badges.yml
├── docs/
│   └── badges/            (starts empty — the workflow fills it)
└── scripts/
    └── generate-badges.mjs
```

Easiest way from your machine:
```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git
cd YOUR-REPO
mkdir -p docs/badges scripts .github/workflows
# copy the 3 files from this delivery into the matching folders above
git add .
git commit -m "initial commit: badge generator"
git push
```

### 3. Run the generator once, manually, to seed the badges
You don't have to wait for the first scheduled run. Go to your repo on GitHub → **Actions** tab → click **"Update owockibot badges"** in the left sidebar → **"Run workflow"** button → **Run workflow**. Wait ~20 seconds, refresh — you should see a new commit "chore: refresh badges" with SVG files added under `docs/badges/`.

(If the Actions tab says workflows are disabled, go to **Settings → Actions → General** and allow workflows to run for this repo.)

### 4. Turn on GitHub Pages
**Settings → Pages** (left sidebar) →
- **Source:** "Deploy from a branch"
- **Branch:** `main`, folder `/docs`
- **Save**

GitHub will give you a URL like:
```
https://YOUR-USERNAME.github.io/YOUR-REPO/
```
It can take 1-2 minutes to go live the first time.

### 5. Find your badge
Visit `https://YOUR-USERNAME.github.io/YOUR-REPO/` — there's an auto-generated table listing every wallet that's completed at least one bounty, with a live preview of their badge. Find your wallet address in the list (or just guess the URL directly, see below).

### 6. Embed it

**In a GitHub README:**
```markdown
![owockibot builder badge](https://YOUR-USERNAME.github.io/YOUR-REPO/badges/0xYOURADDRESS.svg)
```

**In HTML (X/Farcaster bio site, portfolio, etc.):**
```html
<img src="https://YOUR-USERNAME.github.io/YOUR-REPO/badges/0xYOURADDRESS.svg" alt="owockibot builder badge" />
```

Use lowercase for the address in the URL — the generator writes filenames in lowercase. Add `-light` before `.svg` for the light theme variant (e.g. `0xYOURADDRESS-light.svg`).

### 7. Let it run
From here it's hands-off — the workflow re-fetches the bounty board and re-commits updated SVGs every 30 minutes automatically. Nothing to maintain.

## Adjusting the refresh interval

Edit the `cron` line in `.github/workflows/update-badges.yml`:
```yaml
- cron: "*/30 * * * *"   # every 30 min (default)
- cron: "0 * * * *"      # every hour
- cron: "0 */6 * * *"    # every 6 hours
```
GitHub Actions free tier gives public repos unlimited minutes for scheduled workflows, so `*/30` is fine to leave running indefinitely. Note GitHub's scheduler can lag a few minutes during high load — treat cron timing as approximate, not exact.

## If you'd rather have true real-time badges

This static approach trades real-time accuracy for zero-infrastructure simplicity. If you want the badge to reflect a completion the instant it happens (rather than up to 30 min later), that's what the **Cloudflare Worker version** (`worker.js` from the original delivery) is for — it computes the SVG fresh on every request. Cloudflare's free tier easily covers this workload; deploying it is a 2-minute `wrangler deploy` and doesn't conflict with also running this GitHub Pages version if you want both.

## Files in this delivery

```
scripts/generate-badges.mjs        # fetches bounty board, writes SVGs + docs/index.html
.github/workflows/update-badges.yml # cron job that runs the script and commits the result
docs/badges/                        # output folder (empty until first run)
```
