# iu-praxisbericht

Fills the weekly **Praxisberichte** of the IU dual study programme on myCampus from a task list,
with randomised but plausible working times, task mixes, vacation, sick days and holidays.

## How it works

- Logs in through the normal myCampus Auth0 login with Playwright (headless), then talks to the
  Praxisberichte Moodle plugin (`mycampus-classic.iu.org/local/praxisberichte/`) through the same
  JSON endpoint its own UI uses (`ajax_student_view.php?calid=<semester>`).
- The **Studienjahresablaufplan is taken from the portal**: each semester's `workDays` already
  contain only practice days, so theory and exam weeks are never touched.
- Only weeks whose practice days are over are filled; weeks already submitted are skipped.
- Per week: start times jittered around `workday.start` with net hours kept near `workday.hours`, 5 to 7 bullet points
  drawn from your task list by weight, a 3 to 5 rating. Weekly tasks appear in every report,
  monthly ones in the first report of each month.
- Vacation and sick days are placed on practice days (vacation in 1 to 5 day blocks, sick in 1 to
  2 day blocks), never taking the last working day of a week. Both become "Abwesenheit", the
  only absence type the portal has. Bavarian public holidays become "Feiertag".
- Everything is seeded, so the same config and portal data give the same plan.

## Setup

```sh
pnpm install
pnpm exec playwright install chromium
cp config.example.yaml config.yaml   # tasks, vacation/sick days, see comments inside
printf 'IU_USER=\nIU_PASSWORD=\n' > .env && chmod 600 .env   # fill in
```

The login session is cached in `.auth/state.json` (gitignored).

## Usage

```sh
pnpm plan                        # dry run: print every week that would be entered
pnpm plan --semester 651         # one semester (calid, shown in the output)
pnpm fill --limit 3              # save the first 3 open weeks as drafts
pnpm fill                        # save all open weeks as drafts
pnpm fill --submit               # submit (drafts are overwritten and submitted)
```

`--headed` shows the browser, `--config` picks another config file.

## Development

```sh
pnpm test    # vitest: dates, holidays, payload encoding, planner
pnpm build   # typecheck
```
