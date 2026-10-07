import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadConfig } from './config.ts';
import { localToday } from './dates.ts';
import { planSemester, type WeekPlan } from './planner.ts';
import { openPortal } from './portal.ts';

const USAGE = `Usage:
  pnpm plan [--semester ID]... [--limit N] [--config FILE]   show what would be entered (no writes)
  pnpm fill [--semester ID]... [--limit N] [--submit]         save drafts, or submit with --submit
Options: --headed (visible browser), --config (default config.yaml)`;

const DAY = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const LABEL: Record<string, string> = { vacation: 'Urlaub', sick: 'krank', holiday: 'Feiertag' };

const hours = (min: number): string => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}h`;

const describe = (w: WeekPlan): string => {
  const days = w.days
    .map((d, i) => (d.workday ? `${DAY[i]} ${d.reason ? LABEL[d.reason] : `${d.from}-${d.to}`}` : null))
    .filter(Boolean)
    .join(', ');
  return `  KW ${String(w.week).padStart(2)} (${w.monday})  ${hours(w.totalMinutes).padStart(7)}  ${'*'.repeat(w.happiness)}\n    ${days}\n    ${w.doings.replaceAll('\n', ' ')}`;
};

const main = async (): Promise<void> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      semester: { type: 'string', multiple: true },
      limit: { type: 'string' },
      submit: { type: 'boolean', default: false },
      headed: { type: 'boolean', default: false },
      config: { type: 'string', default: 'config.yaml' },
    },
  });
  const command = positionals[0];
  if (command !== 'plan' && command !== 'fill') throw new Error(USAGE);
  if (values.submit && command !== 'fill') throw new Error('--submit only works with fill');
  const limit = values.limit === undefined ? Infinity : z.coerce.number().int().positive().parse(values.limit);

  process.loadEnvFile('.env');
  const env = z.object({ IU_USER: z.string().min(1), IU_PASSWORD: z.string().min(1) }).parse(process.env);
  const config = loadConfig(values.config);
  const today = localToday();

  const portal = await openPortal({ user: env.IU_USER, password: env.IU_PASSWORD, statePath: '.auth/state.json', headed: values.headed });
  try {
    const wanted = values.semester ?? config.semesters;
    const semesters = (await portal.semesters()).filter((s) => !wanted || wanted.includes(s.id));
    if (semesters.length === 0) throw new Error(`No matching semesters (wanted ${wanted?.join(', ')})`);

    let remaining = limit;
    for (const sem of semesters) {
      const weeks = planSemester(await portal.calendar(sem.id), config, today).slice(0, remaining);
      remaining -= weeks.length;
      console.log(`\n${sem.label} (calid ${sem.id}): ${weeks.length} open week(s)`);
      for (const w of weeks) {
        console.log(describe(w));
        if (command === 'fill') {
          await portal.saveWeek(w, values.submit);
          console.log(`    -> ${values.submit ? 'submitted' : 'saved as draft'}`);
          // Be gentle with the portal; a human needs longer than this per week anyway.
          await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));
        }
      }
      if (remaining <= 0) break;
    }
    if (command === 'plan') console.log('\nDry run only. Use `pnpm fill` to save drafts, `pnpm fill --submit` to submit.');
  } finally {
    await portal.close();
  }
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
