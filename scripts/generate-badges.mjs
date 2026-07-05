#!/usr/bin/env node
/**
 * Static badge generator for GitHub Pages.
 *
 * GitHub Pages can only serve static files — it can't run the Cloudflare
 * Worker on request. So instead of generating the SVG live per-request,
 * this script runs on a schedule (via GitHub Actions), fetches the current
 * bounty board, regenerates one SVG per builder into docs/badges/, and the
 * workflow commits + pushes the result. Badges are then "live" up to
 * whatever your cron interval is (default: every 30 minutes).
 *
 * Usage: node scripts/generate-badges.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import path from "path";

const BOUNTY_API = "https://www.owockibot.xyz/api/bounty-board";
const OUT_DIR = path.resolve("docs/badges");

// ---------------------------------------------------------------------------
// Same tier / specialization / streak logic as the Cloudflare Worker version.
// Kept in sync manually — if you tune worker.js, mirror the change here too.
// ---------------------------------------------------------------------------
const TIERS = [
  { name: "Unranked", min: 0, color: "#6b7280", glow: "#6b7280" },
  { name: "Bronze", min: 1, color: "#cd7f32", glow: "#e8a15c" },
  { name: "Silver", min: 3, color: "#c0c0c0", glow: "#e5e5e5" },
  { name: "Gold", min: 6, color: "#ffd700", glow: "#ffec80" },
  { name: "Diamond", min: 11, color: "#5ce1e6", glow: "#9ff2f5" },
  { name: "Legendary", min: 21, color: "#a855f7", glow: "#e0aaff" },
];

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
  const earningsBoost = totalEarned >= 500 ? 3 : totalEarned >= 250 ? 2 : totalEarned >= 100 ? 1 : 0;
  const score = completedCount + earningsBoost;
  let tier = TIERS[0];
  for (const t of TIERS) if (score >= t.min) tier = t;
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
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function computeStreak(completionDates) {
  if (completionDates.length === 0) return 0;
  const weeks = new Set(completionDates.map((d) => isoWeekKey(d)));
  let cursor = new Date();
  let streak = 0;
  if (!weeks.has(isoWeekKey(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 7);
  while (weeks.has(isoWeekKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  return streak;
}

function computeBuilderStats(bounties, address) {
  const addr = address.toLowerCase();
  const mine = bounties.filter((b) => (b.claimer_address || "").toLowerCase() === addr);
  const completed = mine.filter((b) => b.status === "completed");
  const totalCompleted = completed.length;
  const totalEarned = completed.reduce((sum, b) => sum + (Number(b.reward_usdc) || 0), 0);

  const specCounts = {};
  for (const b of completed) {
    const cat = categorize(b.title, b.description);
    specCounts[cat] = (specCounts[cat] || 0) + 1;
  }
  const specializations = Object.entries(specCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);

  const completionDates = completed.map((b) => new Date(b.updated_at || b.created_at)).filter((d) => !isNaN(d));
  const streak = computeStreak(completionDates);
  const tier = getTier(totalCompleted, totalEarned);

  return {
    address,
    totalCompleted,
    totalEarned,
    streak,
    specializations: specializations.length ? specializations : ["—"],
    tier,
  };
}

function esc(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shortAddr(addr) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function renderCardBadge(stats, theme = "dark") {
  const dark = theme !== "light";
  const bg = dark ? "#0d1117" : "#ffffff";
  const bgGrad = dark ? "#161b22" : "#f6f8fa";
  const border = dark ? "#30363d" : "#d0d7de";
  const textPrimary = dark ? "#e6edf3" : "#1f2328";
  const textSecondary = dark ? "#8b949e" : "#57606a";
  const tier = stats.tier;
  const W = 460;
  const H = 200;
  const specText = stats.specializations.join("  •  ");
  const today = new Date().toISOString().slice(0, 10);

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
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="url(#bgGrad)" stroke="${border}"/>
  <rect x="0.5" y="0.5" width="6" height="${H - 1}" rx="3" fill="url(#tierGrad)"/>
  <text x="26" y="34" fill="${textPrimary}" font-size="16" font-weight="700">owockibot Builder</text>
  <text x="26" y="52" fill="${textSecondary}" font-size="11" font-family="monospace">${esc(shortAddr(stats.address))}</text>
  <g transform="translate(${W - 130}, 18)" filter="url(#glow)">
    <rect x="0" y="0" width="108" height="26" rx="13" fill="none" stroke="url(#tierGrad)" stroke-width="1.5"/>
    <text x="54" y="17.5" fill="${tier.color}" font-size="12" font-weight="700" text-anchor="middle" letter-spacing="0.5">${esc(tier.name.toUpperCase())}</text>
  </g>
  <line x1="26" y1="66" x2="${W - 26}" y2="66" stroke="${border}" stroke-width="1"/>
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
  <text x="26" y="158" fill="${textSecondary}" font-size="10.5" letter-spacing="0.4">SPECIALIZATION</text>
  <text x="26" y="176" fill="${textPrimary}" font-size="13" font-weight="600">${esc(specText)}</text>
  <text x="${W - 26}" y="${H - 12}" fill="${textSecondary}" font-size="9.5" text-anchor="end">via owockibot bounty board · ${today}</text>
</svg>`;
}

async function main() {
  console.log(`Fetching ${BOUNTY_API} ...`);
  const res = await fetch(BOUNTY_API, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Bounty board API returned ${res.status}`);
  const bounties = await res.json();
  console.log(`Fetched ${bounties.length} bounties.`);

  // Auto-discover every wallet that has completed at least one bounty —
  // no manual builder list to maintain.
  const addresses = [
    ...new Set(
      bounties
        .filter((b) => b.status === "completed" && b.claimer_address)
        .map((b) => b.claimer_address.toLowerCase())
    ),
  ];
  console.log(`Found ${addresses.length} builders with at least one completed bounty.`);

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const allStats = [];
  for (const addr of addresses) {
    const stats = computeBuilderStats(bounties, addr);
    allStats.push(stats);
    writeFileSync(path.join(OUT_DIR, `${addr}.svg`), renderCardBadge(stats, "dark"));
    writeFileSync(path.join(OUT_DIR, `${addr}-light.svg`), renderCardBadge(stats, "light"));
  }

  // Simple gallery index so you can browse all generated badges.
  allStats.sort((a, b) => b.totalCompleted - a.totalCompleted || b.totalEarned - a.totalEarned);
  const rows = allStats
    .map(
      (s) => `<tr>
        <td><code>${s.address}</code></td>
        <td>${s.tier.name}</td>
        <td>${s.totalCompleted}</td>
        <td>$${s.totalEarned}</td>
        <td>${s.streak}</td>
        <td><img src="badges/${s.address}.svg" height="60" alt="badge"/></td>
      </tr>`
    )
    .join("\n");

  const indexHtml = `<!doctype html>
<html><head><meta charset="utf-8"><title>owockibot Builder Badges</title>
<style>
  body { background:#0d1117; color:#e6edf3; font-family: 'Segoe UI', sans-serif; max-width: 960px; margin: 40px auto; padding: 0 20px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 8px 10px; border-bottom: 1px solid #30363d; text-align:left; font-size: 13px; }
  code { color:#79c0ff; }
  a { color:#58a6ff; }
</style></head>
<body>
  <h1>🛡️ owockibot Builder Badges</h1>
  <p>Auto-regenerated every 30 minutes by GitHub Actions from the <a href="https://www.owockibot.xyz/api/bounty-board">bounty board API</a>. Last updated: ${new Date().toISOString()}</p>
  <h3>Embed yours</h3>
  <pre>![owockibot builder badge](https://YOUR-USERNAME.github.io/YOUR-REPO/badges/0xYOURADDRESS.svg)</pre>
  <table>
    <tr><th>Address</th><th>Tier</th><th>Completed</th><th>Earned</th><th>Streak</th><th>Badge</th></tr>
    ${rows}
  </table>
</body></html>`;

  writeFileSync(path.resolve("docs/index.html"), indexHtml);

  console.log(`Wrote ${addresses.length * 2} badge SVGs + index.html to docs/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
