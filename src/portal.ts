import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { type BrowserContext, chromium, type Page } from 'playwright';
import type { WeekPlan } from './planner.ts';
import { toForm } from './payload.ts';
import { calendarSchema, type CalendarData } from './portal-types.ts';

const MYCAMPUS = 'https://mycampus.iu.org';
const PLUGIN = 'https://mycampus-classic.iu.org/local/praxisberichte/';
const OVERVIEW = `${PLUGIN}stats/student.php?lang=de`;
const AJAX = `${PLUGIN}ajax_student_view.php`;

export interface Semester {
  id: string;
  label: string;
}

export interface Portal {
  semesters(): Promise<Semester[]>;
  calendar(id: string): Promise<CalendarData>;
  saveWeek(plan: WeekPlan, submit: boolean): Promise<void>;
  close(): Promise<void>;
}

const onOverview = async (page: Page): Promise<boolean> => {
  await page.goto(OVERVIEW, { waitUntil: 'networkidle' });
  return page.url().startsWith(PLUGIN) && (await page.locator('#semesterswitcher').count()) > 0;
};

// Auth0 universal login at auth.iu.org; the classic Moodle then signs in via SSO on first visit.
const login = async (page: Page, user: string, password: string): Promise<void> => {
  await page.goto(`${MYCAMPUS}/login?redirect=/home`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await page.locator('input#username').waitFor();
  await page.locator('input#username').fill(user);
  await page.locator('input#password').fill(password);
  await page.locator('button[type=submit][name=action]').click();
  await page.waitForURL((u) => u.hostname === 'mycampus.iu.org' && u.pathname.startsWith('/home'), { timeout: 60_000 }).catch(() => {
    throw new Error(`Login did not reach myCampus (stuck at ${page.url()}). Wrong credentials or a new MFA prompt?`);
  });
};

const parseJson = async (res: { ok(): boolean; status(): number; text(): Promise<string> }, what: string): Promise<unknown> => {
  const body = await res.text();
  if (!res.ok()) throw new Error(`${what}: HTTP ${res.status()}`);
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`${what}: expected JSON, got ${body.slice(0, 120).replace(/\s+/g, ' ')} (session expired?)`);
  }
};

const weekPayload = (plan: WeekPlan, submit: boolean) =>
  toForm({
    week: { weeknumber: plan.week, doings: plan.doings, totalworktime: plan.totalMinutes },
    // Mirrors studentView.js saveData(): unticked rows carry no date and no minutes.
    days: plan.days.map((d) => ({
      date: d.workday ? d.date : '',
      from: d.from,
      to: d.to,
      break: d.break,
      special: d.special,
      workday: d.workday,
      totalworktime: d.workday ? d.minutes : '',
    })),
    weekResubmitted: false,
    happiness: plan.happiness,
    submit,
  });

export const openPortal = async (opts: { user: string; password: string; statePath: string; headed?: boolean }): Promise<Portal> => {
  const browser = await chromium.launch({ headless: !opts.headed });
  let context: BrowserContext;
  try {
    context = await browser.newContext({ locale: 'de-DE', storageState: existsSync(opts.statePath) ? opts.statePath : undefined });
    const page = await context.newPage();
    if (!(await onOverview(page))) {
      await login(page, opts.user, opts.password);
      if (!(await onOverview(page))) throw new Error(`Logged in, but the Praxisberichte page did not load (at ${page.url()})`);
    }
    mkdirSync(dirname(opts.statePath), { recursive: true });
    await context.storageState({ path: opts.statePath });
    chmodSync(opts.statePath, 0o600);

    const semesters = await page.$$eval('#semesterswitcher option', (os) => os.map((o) => ({ id: (o as HTMLOptionElement).value, label: o.textContent?.trim() ?? '' })));

    return {
      semesters: async () => semesters,
      calendar: async (id) => calendarSchema.parse(await parseJson(await context.request.get(`${AJAX}?calid=${id}`), `calendar ${id}`)),
      saveWeek: async (plan, submit) => {
        const res = await context.request.post(`${AJAX}?calid=${plan.semesterId}`, {
          form: weekPayload(plan, submit),
          headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: `${OVERVIEW}&calid=${plan.semesterId}` },
        });
        const cal = calendarSchema.parse(await parseJson(res, `save week ${plan.week}`));
        const stored = cal.calendarWeekInfo?.find((w) => Number(w.calendar_week) === plan.week);
        if (!stored) throw new Error(`Portal accepted the request but week ${plan.week} is not in the calendar afterwards`);
        if (stored.is_submitted !== (submit ? '1' : '0')) throw new Error(`Week ${plan.week}: expected is_submitted=${submit ? 1 : 0}, portal says ${stored.is_submitted}`);
      },
      close: () => browser.close(),
    };
  } catch (err) {
    await browser.close();
    throw err;
  }
};
