import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const time = z.string().regex(/^\d{2}:\d{2}$/, 'expected HH:MM');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

const task = z.union([
  z.string().min(1).transform((name) => ({ name, weight: 1, variants: [name], cadence: 'random' as const })),
  z
    .object({
      name: z.string().min(1),
      weight: z.number().positive().default(1),
      variants: z.array(z.string().min(1)).optional(),
      cadence: z.enum(['random', 'weekly', 'monthly']).default('random'),
    })
    .transform((t) => ({ ...t, variants: t.variants?.length ? t.variants : [t.name] })),
]);

const absences = {
  vacationDays: z.number().int().min(0).optional(),
  sickDays: z.number().int().min(0).optional(),
};

export const configSchema = z
  .object({
    seed: z.string().default('praxisbericht'),
    semesters: z.array(z.union([z.string(), z.number()]).transform(String)).optional(),
    vacationDays: z.number().int().min(0).default(0),
    sickDays: z.number().int().min(0).default(0),
    vacationDates: z.array(isoDate).default([]),
    sickDates: z.array(isoDate).default([]),
    overrides: z.record(z.string(), z.object(absences)).default({}),
    tasksPerWeek: z.object({ min: z.number().int().min(5), max: z.number().int() }).default({ min: 5, max: 7 }),
    defaultDay: z.object({ from: time, to: time, break: z.number().int().min(0) }).default({ from: '08:30', to: '16:30', break: 30 }),
    holidays: z.boolean().default(true),
    tasks: z.array(task),
  })
  .superRefine((c, ctx) => {
    if (c.tasksPerWeek.max < c.tasksPerWeek.min) ctx.addIssue({ code: 'custom', message: 'tasksPerWeek.max must be >= min' });
    const weekly = c.tasks.filter((t) => t.cadence === 'weekly').length;
    const random = c.tasks.filter((t) => t.cadence === 'random').length;
    if (weekly + random < c.tasksPerWeek.max) {
      ctx.addIssue({ code: 'custom', message: `need at least ${c.tasksPerWeek.max} weekly/random tasks to fill tasksPerWeek.max bullet points, got ${weekly + random}` });
    }
    if (weekly >= c.tasksPerWeek.min) ctx.addIssue({ code: 'custom', message: 'too many weekly tasks: every week would look identical' });
  });

export type Config = z.output<typeof configSchema>;

export const parseConfig = (raw: unknown): Config => {
  const result = configSchema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid config:\n${z.prettifyError(result.error)}`);
  return result.data;
};

export const loadConfig = (path: string): Config => parseConfig(parseYaml(readFileSync(path, 'utf8')));

export const absencesFor = (config: Config, semesterId: string): { vacationDays: number; sickDays: number } => ({
  vacationDays: config.overrides[semesterId]?.vacationDays ?? config.vacationDays,
  sickDays: config.overrides[semesterId]?.sickDays ?? config.sickDays,
});
