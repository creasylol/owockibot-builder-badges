/**
 * owockibot Builder Reputation Badge Generator
 * ---------------------------------------------
 * Dynamic SVG badge showing a builder's bounty completion history,
 * pulled live from the owockibot bounty board API.
 *
 * Usage:
 *   GET /badge/:address                -> dark themed badge (default)
 *   GET /badge/:address?theme=light    -> light themed badge
 *   GET /badge/:address?style=flat     -> compact single-line badge
 *   GET /json/:address                 -> raw computed stats as JSON (for debugging / custom UIs)
 *
 * :address is the builder's wallet (claimer_address), case-insensitive.
 */

const BOUNTY_API = "https://www.owockibot.xyz/api/bounty-board";
const CACHE_TTL_SECONDS = 300; // 5 minutes — keeps embeds fresh without hammering the source API

// ---------------------------------------------------------------------------
// Tier thresholds. Rank is primarily driven by completed-bounty count, with an
// earnings-based bump so high-value / fewer-but-bigger bounties still rank up.
// ---------------------------------------------------------------------------
const TIERS = [
  { name: "Unranked", min: 0, color: "#6b7280", glow: "#6b7280" },
  { name: "Bronze", min: 1, color: "#cd7f32", glow: "#e8a15c" },
  { name: "Silver", min: 3, color: "#c0c0c0", glow: "#e5e5e5" },
  { name: "Gold", min: 6, color: "#ffd700", glow: "#ffec80" },
  { name: "Diamond", min: 11, color: "#5ce1e6", glow: "#9ff2f5" },
  { name: "Legendary", min: 21, color: "#a855f7", glow: "#e0aaff" },
];

// Keyword -> specialization bucket. Order matters: first match wins per bounty.
const SPECIALIZATIONS = [
  { key: "Security", words: ["bug", "vulnerab", "audit", "security", "exploit", "auth bypass", "xss", "penetration"] },
  { key: "Smart Contracts", words: ["solidity", "vyper", "smart contract", "escrow", "on-chain", "onchain contract", "gnosis safe"] },
  { key: "Analytics/Dashboards", words: ["dashboard", "analytics", "tracker", "monitor", "leaderboard", "heatmap", "visualiz", "report"] },
  { key: "AI Agents", words: ["agent", "bot", "langgraph", "crewai", "autogen", "multi-agent"] },
  { key: "Content", words: ["thread", "content", "blog", "article", "video", "meme", "animation", "infographic"] },
  { key: "Governance", words: ["governance", "proposal", "treasury", "dao"] },
  { key: "Docs/Guides", words: ["guide", "tutorial", "documentation", "starter kit", "onboarding"] },
  { key: "Integrations", words: ["api", "integration", "webhook", "github action", "rss"] },
];

function getTier(completedCount, totalEarned) {
  // effective rank score nudges tier up for high earners with fewer, bigger bounties
  const earningsBoost = totalEarned >= 500 ? 3 : totalEarned >= 250 ? 2 : totalEarned >= 100 ? 1 : 0;
  const score = completedCount + earningsBoost;
  let tier = TIERS[0];
  for (const t of TIERS) {
    if (score >= t.min) tier = t;
  }
  return tier;
}

function categorize(title = "", description = "") {
  const text = `${title} ${description}`.toLowerCase();
  for (const spec of SPECIALIZATIONS) {
    if (spec.words.some((w) => text.includes(w))) return spec.key;
  }
  return "General";
}

function isoWeekKey(date) {
  // Returns a "YYYY-Www" style key for grouping by ISO week (Mon-Sun).
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function computeStreak(completionDates) {
  if (completionDates.length === 0) return 0;
  const weeks = new Set(completionDates.map((d) => isoWeekKey(d)));
  const now = new Date();
  let streak = 0;
  let cursor = new Date(now);
  // Allow the current week to be "in progress" (no completion yet this week
  // shouldn't zero out an active streak) — start checking from this week,
  // but only count it if it actually has a completion; otherwise start from last week.
  if (!weeks.has(isoWeekKey(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  while (weeks.has(isoWeekKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  return streak;
}

async function fetchBounties(env) {
  const cache = caches.default;
  const cacheKey = new Request(BOUNTY_API);
  let res = await cache.match(cacheKey);
  if (res) return res.json();

  const upstream = await fetch(BOUNTY_API, {
    headers: { accept: "application/json" },
  });
  if (!upstream.ok) {
    throw new Error(`Upstream bounty board API returned ${upstream.status}`);
  }
  const data = await upstream.json();

  const cacheRes = new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", "cache-control": `max-age=${CACHE_TTL_SECONDS}` },
  });
  // Fire and forget cache write
  await cache.put(cacheKey, cacheRes.clone());
  return data;
}

function computeBuilderStats(bounties, address) {
  const addr = address.toLowerCase();
  const mine = bounties.filter((b) => (b.claimer_address || "").toLowerCase() === addr);
  const completed = mine.filter((b) => b.status === "completed");

  const totalCompleted = completed.length;
  const totalEarned = completed.reduce((sum, b) => sum + (Number(b.reward_usdc) || 0), 0);
  const inProgress = mine.filter((b) => b.status === "claimed" || b.status === "submitted").length;
  const cancelled = mine.filter((b) => b.status === "cancelled").length;

  const specCounts = {};
  for (const b of completed) {
    const cat = categorize(b.title, b.description);
    specCounts[cat] = (specCounts[cat] || 0) + 1;
  }
  const specializations = Object.entries(specCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  const completionDates = completed
    .map((b) => new Date(b.updated_at || b.created_at))
    .filter((d) => !isNaN(d));
  const streak = computeStreak(completionDates);

  const tier = getTier(totalCompleted, totalEarned);

  const lastCompletion = completionDates.length
    ? new Date(Math.max(...completionDates.map((d) => d.getTime())))
    : null;

  return {
    address,
    totalCompleted,
    totalEarned,
    inProgress,
    cancelled,
    streak,
    specializations: specializations.length ? specializations : ["—"],
    tier,
    lastCompletion,
  };
}

// ---------------------------------------------------------------------------
// SVG rendering
// ---------------------------------------------------------------------------

function esc(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function renderCardBadge(stats, opts) {
  const dark = opts.theme !== "light";
  const bg = dark ? "#0d1117" : "#ffffff";
  const bgGrad = dark ? "#161b22" : "#f6f8fa";
  const border = dark ? "#30363d" : "#d0d7de";
  const textPrimary = dark ? "#e6edf3" : "#1f2328";
  const textSecondary = dark ? "#8b949e" : "#57606a";
  const tier = stats.tier;
  const W = 460;
  const H = 200;

  const specText = stats.specializations.join("  •  ");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="'Segoe UI', Helvetica, Arial, sans-serif">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg}"/>
      <stop offset="100%" stop-color="${bgGrad}"/>
    </linearGradient>
    <linearGradient id="tierGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${tier.color}"/>
      <stop offset="100%" stop-color="${tier.glow}"/>
    </linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="url(#bgGrad)" stroke="${border}"/>
  <rect x="0.5" y="0.5" width="6" height="${H - 1}" rx="3" fill="url(#tierGrad)"/>

  <!-- Header -->
  <text x="26" y="34" fill="${textPrimary}" font-size="16" font-weight="700">owockibot Builder</text>
  <text x="26" y="52" fill="${textSecondary}" font-size="11" font-family="monospace">${esc(shortAddr(stats.address))}</text>

  <!-- Tier badge -->
  <g transform="translate(${W - 130}, 18)" filter="url(#glow)">
    <rect x="0" y="0" width="108" height="26" rx="13" fill="none" stroke="url(#tierGrad)" stroke-width="1.5"/>
    <text x="54" y="17.5" fill="${tier.color}" font-size="12" font-weight="700" text-anchor="middle" letter-spacing="0.5">${esc(tier.name.toUpperCase())}</text>
  </g>

  <line x1="26" y1="66" x2="${W - 26}" y2="66" stroke="${border}" stroke-width="1"/>

  <!-- Stats row -->
  <g font-size="22" font-weight="700" fill="${textPrimary}">
    <text x="26" y="102">${stats.totalCompleted}</text>
    <text x="140" y="102">$${stats.totalEarned.toLocaleString()}</text>
    <text x="278" y="102">${stats.streak}${stats.streak > 0 ? " 🔥" : ""}</text>
  </g>
  <g font-size="10.5" fill="${textSecondary}" letter-spacing="0.4">
    <text x="26" y="118">COMPLETED</text>
    <text x="140" y="118">USDC EARNED</text>
    <text x="278" y="118">WEEK STREAK</text>
  </g>

  <line x1="26" y1="138" x2="${W - 26}" y2="138" stroke="${border}" stroke-width="1"/>

  <!-- Specializations -->
  <text x="26" y="158" fill="${textSecondary}" font-size="10.5" letter-spacing="0.4">SPECIALIZATION</text>
  <text x="26" y="176" fill="${textPrimary}" font-size="13" font-weight="600">${esc(specText)}</text>

  <text x="${W - 26}" y="${H - 12}" fill="${textSecondary}" font-size="9.5" text-anchor="end">via owockibot bounty board · ${new Date().toISOString().slice(0, 10)}</text>
</svg>`;
}

function renderFlatBadge(stats, opts) {
  const tier = stats.tier;
  const dark = opts.theme !== "light";
  const bg = dark ? "#0d1117" : "#f6f8fa";
  const textColor = dark ? "#e6edf3" : "#1f2328";
  const label = `${tier.name} · ${stats.totalCompleted} done · $${stats.totalEarned}`;
  const labelWidth = 60;
  const valueWidth = Math.max(140, label.length * 6.5);
  const W = labelWidth + valueWidth;
  const H = 20;

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Verdana, sans-serif" font-size="11">
  <linearGradient id="tg" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${tier.color}"/>
    <stop offset="100%" stop-color="${tier.glow}"/>
  </linearGradient>
  <rect rx="3" width="${W}" height="${H}" fill="${bg}"/>
  <rect rx="3" x="0" width="${labelWidth}" height="${H}" fill="#21262d"/>
  <rect rx="3" x="${labelWidth}" width="${valueWidth}" height="${H}" fill="url(#tg)"/>
  <rect x="${labelWidth - 3}" width="3" height="${H}" fill="url(#tg)"/>
  <text x="${labelWidth / 2}" y="14" fill="#e6edf3" text-anchor="middle">builder</text>
  <text x="${labelWidth + valueWidth / 2}" y="14" fill="#0d1117" text-anchor="middle" font-weight="bold">${esc(label)}</text>
</svg>`;
}

function renderErrorBadge(message) {
  const W = 420;
  const H = 70;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="'Segoe UI', Helvetica, Arial, sans-serif">
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" fill="#161b22" stroke="#f85149"/>
  <text x="20" y="30" fill="#f85149" font-size="13" font-weight="700">owockibot Builder Badge</text>
  <text x="20" y="50" fill="#8b949e" font-size="12">${esc(message)}</text>
</svg>`;
}

function svgResponse(svg, cacheable = true) {
  return new Response(svg, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": cacheable ? `public, max-age=${CACHE_TTL_SECONDS}` : "no-store",
      "access-control-allow-origin": "*",
    },
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean); // e.g. ["badge", "0xabc..."]

    if (parts.length === 0) {
      return new Response(HOMEPAGE_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    const [route, rawAddress] = parts;

    if ((route === "badge" || route === "json") && rawAddress) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(rawAddress)) {
        return route === "json"
          ? new Response(JSON.stringify({ error: "invalid address" }), { status: 400 })
          : svgResponse(renderErrorBadge("Invalid wallet address"), false);
      }

      try {
        const bounties = await fetchBounties(env);
        const stats = computeBuilderStats(bounties, rawAddress);

        if (route === "json") {
          return new Response(
            JSON.stringify(
              {
                ...stats,
                tier: stats.tier.name,
              },
              null,
              2
            ),
            { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } }
          );
        }

        const style = url.searchParams.get("style");
        const theme = url.searchParams.get("theme") || "dark";
        const svg = style === "flat" ? renderFlatBadge(stats, { theme }) : renderCardBadge(stats, { theme });
        return svgResponse(svg);
      } catch (err) {
        return route === "json"
          ? new Response(JSON.stringify({ error: String(err) }), { status: 502 })
          : svgResponse(renderErrorBadge("Could not reach bounty board API"), false);
      }
    }

    return new Response("Not found", { status: 404 });
  },
};

const HOMEPAGE_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>owockibot Builder Reputation Badges</title>
<style>
  body { background:#0d1117; color:#e6edf3; font-family: 'Segoe UI', sans-serif; max-width: 720px; margin: 60px auto; padding: 0 20px; }
  code { background:#161b22; padding: 2px 6px; border-radius: 4px; color:#79c0ff; }
  pre { background:#161b22; padding: 14px; border-radius: 8px; overflow-x:auto; }
  a { color: #58a6ff; }
</style></head>
<body>
  <h1>🛡️ owockibot Builder Reputation Badges</h1>
  <p>Dynamic SVG badges showing a builder's bounty completion history on the owockibot bounty board.</p>
  <h3>Usage</h3>
  <pre>GET /badge/&lt;wallet_address&gt;
GET /badge/&lt;wallet_address&gt;?theme=light
GET /badge/&lt;wallet_address&gt;?style=flat
GET /json/&lt;wallet_address&gt;   (raw stats)</pre>
  <h3>Embed in a GitHub README</h3>
  <pre>![owockibot builder badge](https://YOUR-WORKER-URL/badge/0xYOURADDRESS)</pre>
  <h3>Embed anywhere else (HTML)</h3>
  <pre>&lt;img src="https://YOUR-WORKER-URL/badge/0xYOURADDRESS" alt="owockibot builder badge" /&gt;</pre>
</body></html>`;
