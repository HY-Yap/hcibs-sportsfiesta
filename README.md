# Sports Fiesta — Website‑Only Operations README

> **What is this?** A step‑by‑step guide for **future years** to run the Sports Fiesta website with minimal coding. You’ll import schedules from the site and only run a few maintenance scripts when needed:
>
> - `scripts/makeAdmin.mjs`
> - `scripts/seedUsersFromCsv.mjs` (supports `--reset-players`, `--invite`, `--dry`)
> - `scripts/reset-matches.mjs` *(same effect as the website’s ****Reset Matches + Awards****)*
> - `scripts/finish-quals.mjs` *(optional; force‑close qualifiers)*

---

## Quick Start (TL;DR)

1. **Set up your laptop** (Git + Node + Firebase CLI).
2. **Clone and link** the Firebase project.
3. **Open the Admin Controls page** and:
   - Upload **Matches CSV** (all events) ➜ *validate ➜ import*.
   - Upload **Players CSV** and **Teams CSV** ➜ *validate ➜ import*.
   - (If needed) use **Danger Zone → Reset Matches + Awards** to wipe a sport.
4. Scorekeepers run matches from their pages; Cloud Functions progress brackets & awards automatically.

> **Order matters:** **Import Matches first, then Teams.** Teams rely on qualifier placeholders emitted by the schedule.

---

## Workstation Setup (first‑time only)

1. **Install Git** ([https://git-scm.com/downloads](https://git-scm.com/downloads))
2. **Install Node.js LTS** ([https://nodejs.org/](https://nodejs.org/)) (v18+ recommended)
3. **Install Firebase CLI**
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
4. **Clone the repo**
   ```bash
   git clone https://github.com/HY-Yap/hcibs-sportsfiesta
   cd hcibs-sportsfiesta
   ```
5. **Link to your Firebase project**
   ```bash
   firebase use --add
   # choose the correct project and give it an alias, e.g. "prod"
   ```
6. *(Optional — for running scripts)* **Service Account key**
   - In Firebase console ➜ Project settings ➜ **Service accounts** ➜ **Generate new private key**.
   - Save as `scripts/serviceAccountKey.json` (git‑ignored).
   - Scripts look for that file by default.

---

## Admin Controls — What lives in the website

- **CSV Data Upload (Players & Teams)**

  - Validates roster sizes against `events/{event_id}` docs.
  - Proposes team→slot mapping based on qualifier placeholders already present in your matches.
  - Writes team docs as **namespaced IDs**: `teams/{event_id}__{slot}`.

- **Matches CSV Import (ALL events in one file)**

  - Headers: `id,event_id,match_type,venue,scheduled_at,pool,competitor_a,competitor_b,scorekeeper_email`
  - Uses ISO times in UTC, e.g. `2025-08-23T09:05:00Z`.
  - Allowed `match_type`: `qualifier | redemption | qf | semi | final | bronze | bonus`.
  - Option **Replace existing matches for affected events** will delete & recreate those matches.
  - Import automatically creates placeholder `teams` docs for any IDs seen in the CSV (e.g., `A1`, `BW1`, `SFW1`).

- **Danger Zone**

  - **Reset Teams** — deletes `teams` docs for selected events.
  - **Reset Matches + Awards** — clears scores, returns elim matches to default placeholders, and deletes `awards/{event}` so the Awards page goes back to “not published”.

> **Recommended flow each year**
>
> 1. Upload **Matches CSV** ➜ check times/venues/pools.
> 2. Upload **Players** then **Teams** ➜ map teams to slots.
> 3. Test: open a qualifier, set `status=live` then `final` ➜ watch brackets/awards progress.

---

## CSV Formats

### Matches (`matches.csv`)

Required columns:

```
id,event_id,match_type,venue,scheduled_at,pool,competitor_a,competitor_b,scorekeeper_email
```

Notes:

- `pool` is required for `qualifier`, ignored otherwise.
- `competitor_a/b` hold placeholder **slot IDs** (e.g., `A1`, `B4`, `SFW1`) until teams are mapped.
- Import is **idempotent** — re‑uploading the same `id` updates the match.

### Players (`players.csv`)

```
full_name,email,phone,accommodation,meals,is_guest
```

- Emails must be unique.
- `is_guest`: `true/false` (accepts yes/y/1 as true).

### Teams (`teams.csv`)

```
event_id,team_name,member_emails
```

- `member_emails` is a `;`-separated list.
- Roster validation uses `events/{event_id}`:
  - `roster_max` is enforced.
  - If `roster_min` is missing, the UI currently assumes `roster_min = roster_max`.

---

## Scorekeeper Details

- **Editing Matches**

  - Unlike admins, scorekeepers can only edit matches allocated to them
  - Hence, except for those editing the website, everyone else helping should be using scorekeeper

- **How To Allocate Scorekeepers**

  1. Create a **Scorekeeprs CSV** containg the following: `full_name,email`
  2. Put the following command: `node seedScorekeepers.mjs --csv scorekeepers.csv` (Put `--invite` at the end to generate passwords as well)
  3. According to the credentials file, insert the scorekeepers' email at the end of the **Matches CSV** file, you may choose to put an admin email if you wish
  4. Uploaod the **Matches CSV** file as normal, and the scorekeepers are successfully allocated to their matches

## Cloud Functions you might need to touch

Located in `functions/index.js`.

- **EVENT\_FORMATS** (top of file) — add/edit when you change a sport’s format:
  - `type`: `single | bo3 | bo5`
  - `prefix`: match ID prefix used in finals/bronze (e.g., `S`, `D`, `B`, `F`)
  - `finals` / `bronze`: the list of match suffixes that make up the series (e.g., `F1,F2,F3`)
- **Bracket revealers** (`revealSemis`, `revealBasketballElims`, `revealFrisbeeElims`) — only needed if your new sport has different seeding logic.
- **Series watcher** (`seriesWatcher`) — handles BO3/BO5 progression and voids unused game 3.
- **Awards**: `autoFillAwards` + `publishAwards` — award slots are auto‑filled when finals/bronze are decided and auto‑published when all three are present.

> After editing `functions/index.js`:
>
> ```bash
> cd functions
> npm i   # first time or if deps changed
> firebase deploy --only functions
> ```

Also update `defaultParticipantsFor()` in `/public/js/admin-csv.js` if your elim placeholders (e.g., `BW1`, `FSF1W`) change naming.

---

## Scripts you *may* run (optional)

> These scripts require a private key at `scripts/serviceAccountKey.json` (Firebase ➜ Project settings ➜ **Service accounts** ➜ **Generate new private key**). **Do not commit this file.**

### 1) `makeAdmin.mjs`

Create (if needed) and mark a user as admin via custom claims; also ensures a Firestore `users/{uid}` doc exists.

```bash
node scripts/makeAdmin.mjs <email>
# example
node scripts/makeAdmin.mjs yaphanyang09@gmail.com
```

*Notes:* If the Auth user doesn’t exist, the script creates one with a temporary password `TempPassword123!` — change it immediately.

---

### 2) `seedUsersFromCsv.mjs`

Create/update players from CSVs and attach them to team docs (fills `member_uids`).

```bash
# normal import
node scripts/seedUsersFromCsv.mjs --players ./players.csv --teams ./teams.csv

# dry run (parses & logs; no writes)
node scripts/seedUsersFromCsv.mjs --players ./players.csv --teams ./teams.csv --dry

# also set random passwords and export a credentials CSV
node scripts/seedUsersFromCsv.mjs --players ./players.csv --teams ./teams.csv --invite

# DANGER: delete all player Auth users + Firestore user docs (keeps admins/scorekeepers)
node scripts/seedUsersFromCsv.mjs --reset-players
```

*What it does:* ensures Auth users (role=`player`), upserts `users/{uid}` docs, writes `member_uids` onto matching `teams/{event_id}__{slotOrName}` docs, optionally generates default passwords, and cleans up orphaned player users not in the current CSV.

---

### 3) `reset-matches.mjs`

Server-side reset of **all matches** and **awards**. Mirrors the website’s *Reset Matches + Awards*.

```bash
node scripts/reset-matches.mjs
```

*Effect:* sets `status` back to `scheduled`, clears `score_a/score_b/actual_start`, restores elimination placeholders (e.g., `BW1`, `FSF1W`) where known, and deletes `awards/*`.

---

### 4) `finish-quals.mjs`

Force-completes every unfinished **qualifier** (`scheduled`/`live → final`) with sport-flavoured scores.

```bash
# all events with unfinished qualifiers
node scripts/finish-quals.mjs

# only selected events
node scripts/finish-quals.mjs badminton_doubles badminton_singles
```

*Scoring model:* badminton winners to 15; basketball winners 12–21; frisbee winners 4–9; always non‑tied.

---

## Operational Runbook

- **Pre‑event**

  - Create Scorekeepers
  - Import Matches (once).
  - Import Players & Teams; confirm slotting proposal looks right.
  - Sanity‑check times on `/schedule` and placeholders on elim matches.

- **During event**

  - Scorekeepers change `status`: `scheduled → live → final` and enter scores.
  - If a match starts late, **propagateDelay** shifts later matches on the same venue.
  - BO3 series auto‑progress and hide G3 when decided.
  - Brackets auto‑reveal when all qualifiers are final.

- **If you need to reset a sport**

  - **Admin Controls → Reset Matches + Awards** for the chosen events.
  - Optionally **Reset Teams** for those events.
  - Re‑import Matches, then re‑import Teams.

---

## FAQ

**Q: Import order?**\
A: **Matches first, then Teams** (and Players anytime). Team→slot mapping depends on qualifier placeholders from the schedule.

**Q: Awards still showing after a reset?**\
A: Use **Reset Matches + Awards** in Admin Controls. It clears scores, restores elim placeholders, and deletes `awards/{event}`.

**Q: We’re adding a new sport. What must we update?**\
A: (1) Add it to **EVENT\_FORMATS** in `functions/index.js`.\
(2) If its bracket logic differs, extend the relevant revealer function.\
(3) Add default placeholders to `defaultParticipantsFor()` in `/public/js/admin-csv.js`.\
(4) Create an `events/{event_id}` doc (name, scoring\_mode, roster\_max, etc.).\
(5) Deploy functions.

**Q: Can teams and placeholder IDs be reused across events?**\
A: Yes. Team docs are namespaced (`{event_id}__{slot}`), so `A1` in two sports is fine.

---

## Handover Checklist (yearly)

- Duplicate last year’s Firebase project (or clean the existing one):
  - **Admin Controls → Reset Matches + Awards** for all events.
  - **Reset Teams** if you’re changing entrants.
  - Optionally run `--reset-players` to wipe players.
- Update/confirm `events/{event_id}` docs (name, `scoring_mode`, `roster_max`, `default_duration_s`, `status`).
- Update `functions/index.js` if formats changed:
  - `EVENT_FORMATS`, bracket revealers, series watcher.
  - `admin-csv.js → defaultParticipantsFor()` if placeholder IDs changed.
  - `firebase deploy --only functions`.
- Prepare the **Matches CSV** and import it on the website. **Import Matches first.**
- Prepare **Players** and **Teams** CSVs; import and confirm the slotting proposal. **Then Teams.**
- Create admins/scorekeepers (`makeAdmin.mjs` or Firebase Console) and sanity‑check permissions.
- Do a dry end‑to‑end rehearsal: mark a qualifier `live → final`, verify bracket reveal and Awards auto‑fill.

*Last updated: 2025‑08‑18 — website‑only import workflow.*

