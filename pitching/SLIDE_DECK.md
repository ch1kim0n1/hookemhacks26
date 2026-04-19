# Slide Deck Outline — 7 slides

Build this in Keynote, Google Slides, or Figma. Aim for **60 minutes to
draft, 30 minutes to polish**. Don't over-design — judges look at your
face and your demo, not your typography.

**Global rules:**
- One idea per slide.
- Max 15 words per slide. If you need more, you're reading the slide
  instead of telling the story.
- Dark background. ClawGuard accent color (pick one — suggested: a hot
  red `#FF3B30` or a claw-yellow `#FFC21A`).
- 28pt minimum font.
- No stock photos of hooded hackers. Ever.

---

## Slide 1 — Title

**Visible text:**

```
CLAWGUARD
A shared immune system for AI agents.

[team names] · [hackathon + date]
```

**You say:** *Nothing — wait for the judge to nod, then start with the
Bloomberg hook on slide 2.*

---

## Slide 2 — The Problem

**Visible text:**

```
Your AI trading agent
just read a fake Bloomberg email
and sold everything you own.

Prompt injection — OWASP LLM #01.
```

**You say:** The 30-second Bloomberg hook from `PITCH_SCRIPT.md`.

**Visual:** A redacted screenshot of a fake Bloomberg earnings email on
the left, the trading agent's "order placed: SELL AAPL x1000" response
on the right. Red arrow between them.

---

## Slide 3 — Why it's urgent

**Visible text:**

```
Every AI agent being deployed this year
has this exact weakness.

And no one shares what they learn.
```

**You say:** "Every company defends alone. Every attack is learned once
and forgotten. There is no CrowdStrike for agents."

**Visual:** 6 small logos — Claude Computer Use, GPT Operators, LangChain,
CrewAI, Replit Agent, a generic trading bot — arranged in a grid with
lock icons between them all broken.

---

## Slide 4 — The Solution (the flowchart)

**Visible text:**

```
Content → Extract → Detect → Publish on-chain → Every node learns
```

**You say:** The solution description from `PITCH_SCRIPT.md#solution--flowchart`.

**Visual:** The flowchart from `STORY.md#3-the-flowchart`. Use the
top-to-bottom version; highlight the feedback loop from the registry
back to the cache in the accent color.

**This is the slide they'll remember. Make it look good.**

---

## Slide 5 — Live demo (transition)

**Visible text:**

```
Let me show you.

3 attacks. 2 nodes. 1 shared defense.
```

**You say:** "Let me show you." Then switch to the dashboard.

**Visual:** Either just the text above at huge size, or a screenshot of
the dashboard dimmed, with "LIVE DEMO" overlaid. The point is the slide
is a placeholder; your dashboard is the real content.

---

## Slide 6 — The moat

**Visible text:**

```
Every customer attacked
makes every other customer safer.

Network effect. Data moat. Drop-in integration.
```

**You say:** The moat section from `PITCH_SCRIPT.md`.

**Visual:** Three icons across the bottom — a network graph (network
effect), an append-only log (data moat), a code snippet with three lines
(drop-in integration). Use the accent color.

---

## Slide 7 — Close + ask

**Visible text:**

```
Every AI agent deployed this year
is one injection away from a headline.

ClawGuard is how you make sure it isn't yours.

github.com/[org]/clawguard · [contact email]
```

**You say:** The closing line verbatim. Then: "Happy to take questions."

**Visual:** Big logo, tagline, repo URL as a QR code in the corner so
judges can scan it without having to type.

---

## Optional appendix slides (have ready but don't show unless asked)

### A1 — Architecture detail

Full system diagram showing extractor → detector → judge → chain →
network poller. For the technical judge who drills in.

### A2 — Business model

Per-request pricing tiers, named acquirers list (see `STORY.md#5`).
For the business judge who asks "how do you make money?"

### A3 — Roadmap

Next 30 days: finish adversarial feature extraction, swap in RISC Zero
prover, ship LangChain SDK. For the investor-type judge.

### A4 — Project honesty

Screenshot of the `README.md#project-honesty` table. Use this if a judge
asks "what's real vs. prototype?" Let the screenshot answer — shows
self-awareness without being defensive.

### A5 — Team

One line per person + role. Include this only if the hackathon requires
it.

---

## Design reference

If you want a template to copy the vibe of:

- **Stripe Atlas**, **Vercel**, **Linear** — clean dark aesthetic,
  single accent color, lots of whitespace.
- **Cloudflare blog posts** — direct, uses numbered lists, strong
  typography.

Avoid:

- **Gradient everything** — looks like a 2023 crypto deck.
- **Stock abstract imagery** — mesh networks, glowing orbs, etc.
- **Generic AI chipsets on the title slide** — it's everywhere.

---

## Export checklist

- [ ] PDF export saved to `pitching/assets/clawguard-deck.pdf`.
- [ ] Keynote / source file committed so teammates can edit.
- [ ] QR code on slide 7 tested on a phone camera (easy to forget — test
      it).
- [ ] All links in the deck are clickable in presenter mode.
- [ ] Fonts embedded (Keynote: File → Advanced → Reduce File Size; Slides:
      use Google Fonts only).
