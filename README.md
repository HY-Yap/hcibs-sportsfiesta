# Sports Fiesta - Website Operations README

_What is this? A step‑by‑step guide for future years to run the Sports Fiesta website with minimal coding._

> **Rough idea of the system**
>
> -   Static website hosted on Firebase Hosting
> -   Firebase Authentication (players, scorekeepers, admins)
> -   Firestore holds events, teams, users, matches, awards
> -   You manage **data** (players/teams/matches) with the **Admin Controls** page in the website, and use a few **Node scripts** for admin-only tasks (creating users, setting roles, etc.)

---

## 0) Prerequisites (one-time per laptop)

1. **Install Git** – [https://git-scm.com/downloads](https://git-scm.com/downloads)
2. **Install Node.js LTS** (≥ 18.x) – [https://nodejs.org](https://nodejs.org)
3. **Install Firebase CLI**
    ```bash
    npm install -g firebase-tools
    firebase login
    ```
4. **Get access to the Firebase project** (Firestore + Auth enabled).
5. **Download a service account key** (JSON) for admin scripts:
    - In the Firebase/Google Cloud console → _Service Accounts_ → generate a key for the same project.
    - Save it as `scripts/serviceAccountKey.json`.
    - **Never commit this file to Git.**

---

## 1) Get the code & connect to your project

```bash
# clone once
git clone https://github.com/HY-Yap/hcibs-sportsfiesta

# cd your local folder
cd hcibs-sportsfiesta # or whatever your folder name is

# connect the local repo to the right Firebase project
firebase use --add   # pick your project and name the alias e.g. "prod"
```

> Deployment note: the website uses CDN scripts and doesn’t require a build step. Deploys are via `firebase deploy` (if you need to publish changes).

---

## 2) What to update each year

-   **Dates and labels shown on the public pages.** These live in the site’s HTML and JS files (under `public/`). Update only what’s obviously year‑specific (titles, date strings, banner text). If unsure, ping the previous maintainer before touching logic.
-   **Event records** in Firestore (collection `events`) – e.g. status, roster sizes, scoring mode. You can create/edit these via the Firebase Console.
-   You might need to touch some Cloud Functions

    -   Located in `functions/index.js`
    -   **EVENT_FORMATS** (top of file) — add/edit when you change a sport’s format, or add a new sport:
        -   `type`: `single | bo3 | bo5`
        -   `prefix`: match ID prefix used in finals/bronze (e.g., `S`, `D`, `B`, `F`)
        -   `finals` / `bronze`: the list of match suffixes that make up the series (e.g., `F1`, `F2`, `F3`)
    -   **Bracket revealers** (`revealSemis`, `revealBasketballElims`, `revealFrisbeeElims`) — only needed if the sport has different seeding logic.
    -   **Series watcher** (seriesWatcher) — handles BO3/BO5 progression and voids unused game 3.
    -   **Awards**: `autoFillAwards` + `publishAwards` — award slots are auto‑filled when finals/bronze are decided and auto‑published when all three are present.

    > After editing `functions/index.js`:
    >
    > ```bash
    > cd functions
    > ```

    -   Also update `defaultParticipantsFor()` in `/public/js/admin-csv.js` if your elim placeholders (e.g., `BW1`, `FSF1W`) change naming.

-   **Do not** run any of the archived seeding script for matches. For schedules we now upload CSV via the website (see next section).

---

## 3) Data import — full workflow

> **Import order matters:** 1) _Scorekeepers_ → 2) _Matches_ → 3) _Players & Teams_ → 4) _Create player accounts_.

### 3.1 Set up scorekeepers accounts

-   Create a CSV of scorekeepers with headers: `full_name,email` and save it as `data/scorekeepers.csv`

    > Run
    >
    > ```bash
    > node scripts/seedScorekeepers.mjs --csv data/scorekeepers.csv --invite
    > ```

-   The script sets `role=scorekeeper` for each account.
-   According to the credentials file, insert the scorekeepers' email at the end of the **Matches CSV** file, you may choose to put an admin email if you wish

### 3.2 Import Matches (CSV)

Open **Admin Controls → Matches CSV Import** and upload your single `matches.csv`.

-   **Expected columns**: `match_id, event_id, match_type, venue, scheduled_at, pool, competitor_a, competitor_b, scorekeeper_email`
-   **Time format**: ISO, e.g. `2025-08-23T09:05:00Z`
-   `match_id` should follow the format [Event]-[Match Type][Number] (e.g. `F-Q1` - frisbee qualifier 1, `S-SF1-1` - badminton singles semifinals 1-1)
-   `competitor_a` and `competitor_b` should follow placeholder IDs (e.g.,`A1`, `BQF1W`, etc.).
-   Use **Validate CSV** first; then **Import Matches**. Tick **Replace existing matches** to fully overwrite a day’s schedule for those events.

> Importing matches first ensures the qualifier placeholders exist. The team import can then map real team names into those slots safely.

### 3.3 Import Players & Teams (CSV)

Open **Admin Controls → CSV Data Upload** and upload two files:

-   `players.csv` minimal headers: `full_name,email`\
    Optional columns can be added where necessary: `phone,accommodation, meals,is_guest` etc.

-   `teams.csv` headers: `event_id,team_name,member_emails`\
    `member_emails` is a semicolon‑separated list, e.g. `alice@x.com;bob@y.com`. No space betwen the ';'.

Click **Validate Data**. The page will check:

-   Players have unique emails
-   Emails in the players and teams sheet tally
-   Team sizes meet each event’s roster rules
-   Team counts do not exceed qualifier capacity (from your matches)
-   A **proposal table** will appear that slots teams into qualifier placeholders (you can tweak via dropdowns). Click **Commit Import** to write team docs.

> Tip: If you need to start over for an event, use **Danger Zone** on the same page:\
> **Reset Teams** removes `teams` docs for the selected events.\
> **Reset Matches** clears scores, restores elimination placeholders **and also deletes any awards** so you return to a clean slate. Any seeded teams stay where they are.

### 3.4 Create user accounts from the CSVs

After players/teams are in Firestore, generate login accounts and (optionally) default passwords.

Run from the repo root:

```bash
# Create/ensure users for everyone in your CSVs
# Save the CSVs as data/players.csv and data/teams.csv
# (uses scripts/serviceAccountKey.json)
node scripts/seedUsers.mjs --players ./data/players.csv --teams ./data/teams.csv --invite
```

-   This script creates Firebase Auth users (role=`player`) and ensures `users/{uid}` docs.
-   With `--invite`, it sets a generated password and writes a credentials file like `user-credentials-YYYY-MM-DDTHH-MM-SS.csv`.
-   If you want to dry run the script without creating the actual accounts first (i.e. test whether it would work), use `--dry` in replacement of `--invite`
-   **Security:** add that generated CSV to your local `.gitignore` and distribute it securely (do not commit!).

Example `.gitignore` lines:

```gitignore
scripts/serviceAccountKey.json
user-credentials-*.csv
```

> **DANGER**: Need to wipe players during testing?\
> `node scripts/seedUsers.mjs --reset-players`\
> (Prompts before deleting all non‑admin/non‑scorekeeper Auth users and their `users` docs.)

---

## 4) Admin scripts you _may_ run

All scripts read `scripts/serviceAccountKey.json` and operate on the project you linked.

### 4.1 Make admin account (works for existing and new accounts)

```bash
node scripts/makeAdmin.mjs <email> [name]
# example usage: node scripts/makeAdmin.mjs yaphanyan09@gmail.com "Yap Han Yang"
```

-   Sets custom claim `role=admin` and ensures a `users/{uid}` doc with role `admin`.

### 4.2 Create a single player account (manual)

```bash
node scripts/createUser.mjs <email> <password> [name]
# example usage: node scripts/createUser.mjs 01@player.com P@ssw0rd "Test Player"
```

-   Creates an Auth user with role `player` and a matching Firestore doc. Useful for one‑off testing.

### 4.3 Reset user password manually

```bash
node scripts/setPassword.mjs <email> <newPassword>
# example usage: node scripts/setPassword.mjs 01@player.com newP@ssw0rd
```

-   Useful if login email does not actually exist (e.g. scorekeeper1@test.com).
-   Regular users can reset password through the website which will email them a password reset link.

### 4.4 Reset all matches to a clean state (also clears awards)

```bash
node scripts/reset-matches.mjs
```

-   Sets matches back to `scheduled`, clears scores and restores known elimination placeholders in every document in `matches`.
-   The Admin page’s **Reset Matches** does the same thing from the UI for selected events.

### 4.5 Fill qualifier results with realistic test scores (testing only)

```bash
# processes unfinished qualifiers across all events
node scripts/finish-quals.mjs

# or only specific events
node scripts/finish-quals.mjs badminton_doubles badminton_singles
```

-   **For testing only.** Generates sport‑appropriate scores and flips `scheduled/live → final` for qualifier matches so you can test standings and brackets quickly.

> **Do not** use any legacy `seedAllMatches.mjs` or similar. Scheduling is now done **only** through the website’s CSV import.

---

## 5) Tournament‑day tips

-   Keep an admin account signed in on one laptop.
-   Monitor **Admin Controls → System Status**. If Auth/DB looks off, refresh once; if still red, check network and Firebase status.
-   Scorekeepers use the scorekeeper UI to set matches `live` and submit scores. If a scorekeeper forgets a password, reset it via the `setPassword` script.
-   If a participant withdraws:
    -   Find the document under `users` and replace the credentials with a new player accordingly.
        -   Edit the `teams` too, if necessary.
    -   Alternatively, scorekeepers can conduct a 'walkover' - participant 'no show' at the match and the other side wins.
    -   If participant pulls out just before elims begin, you may edit just the affected elimination match docs in Firestore (swap `competitor_a/b.id` to the replacement) and leave earlier qualifier history intact.

---

## 6) CSV quick reference

### matches.csv

| column              | meaning                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `match_id`          | unique match ID (e.g., `F-Q1`, `B-SF1`)                                                        |
| `event_id`          | event document ID (`frisbee5v5`, `basketball3v3`, `badminton_singles`, `badminton_doubles`, …) |
| `match_type`        | `qualifier`, `redemption`, `qf`, `semi`, `final`, `bronze`, `bonus`                            |
| `venue`             | free text (e.g., `Field 1`, `Court 2`)                                                         |
| `scheduled_at`      | ISO UTC time, e.g. `2025-08-23T09:05:00Z`                                                      |
| `pool`              | pool letter for qualifiers (A/B/C/…)                                                           |
| `competitor_a`      | placeholder/team ID (e.g., `A1`)                                                               |
| `competitor_b`      | placeholder/team ID (e.g., `A2`)                                                               |
| `scorekeeper_email` | the assigned scorekeeper for the match                                                         |

### players.csv (minimal)

| column      | meaning                |
| ----------- | ---------------------- |
| `full_name` | player name            |
| `email`     | email (must be unique) |

### teams.csv

| column          | meaning                                          |
| --------------- | ------------------------------------------------ |
| `event_id`      | event doc ID                                     |
| `team_name`     | display name (what players see)                  |
| `member_emails` | `;` separated emails (must exist in players.csv) |

---

## 7) Common issues

-   **Validation errors on import** – read the error list; fix the CSV line(s) and re‑upload. You can safely re‑import with **Replace** when you intend to overwrite a schedule for an event.
-   **Awards show old winners after a reset** – use **Reset Matches** (UI or script). It also wipes `awards`.
-   **A team appears twice or wrong pool** – use **Reset Teams** for that event in **Danger Zone**, then re‑import teams and Commit.
-   **Credentials CSV leaked into Git** – reset users, re‑run `seedUsers.mjs --invite` for fresh passwords and add the filename to `.gitignore`.

---

## 8) Safety & housekeeping

-   Keep `serviceAccountKey.json` outside version control. Treat it like a password.
-   Share credentials CSVs only with the organizing committee, over secure channels.
-   After the event, consider deactivating unused accounts or running the reset options to clean the environment for next year.

---

## 9) Final Operational Runbook

-   **Pre‑event**

    -   Create Scorekeepers
    -   Import Matches (once).
    -   Import Players & Teams; confirm slotting proposal looks right.
    -   Sanity‑check times on `/schedule` and placeholders on elim matches.

-   **During event**

    -   Through the scorekeeper UI, match `status` changes from `scheduled → live → final`.
    -   If a match starts late, **propagateDelay** shifts later matches on the same venue.
    -   BO3 series auto‑progress and hide G3 when decided.
    -   Brackets auto‑reveal when all qualifiers are final.
    -   Awards publish automatically when finals are over and the winners are determined.

-   **If you need to reset a sport**

    -   **Admin Controls → Reset Matches + Awards** for the chosen events.
    -   Optionally **Reset Teams** for those events.
    -   Re‑import Matches, then re‑import Teams.

---

**That’s it.** Follow the order: _Scorekeeper_ → _Matches → Players & Teams → seedUsers_ and you’re set. If something here feels unclear for a future maintainer, annotate this doc with specifics for your year (dates, event IDs) so it gets easier over time.

_Last updated: 2025‑08‑18_
