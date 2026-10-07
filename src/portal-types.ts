import { z } from 'zod';

const templateDay = z.object({ from: z.string(), to: z.string(), break: z.string(), workday: z.string() });

/** Response of GET/POST local/praxisberichte/ajax_student_view.php?calid=<id>. Only the fields we use. */
export const calendarSchema = z.object({
  id: z.string(),
  semester: z.string(),
  workDays: z.array(z.string()),
  examDays: z.array(z.string()),
  calendarWeekInfo: z.array(z.object({ calendar_week: z.string(), is_submitted: z.string() })).nullable().transform((v) => v ?? []),
  template: z.object({ active: z.string(), days: z.array(templateDay) }).nullable(),
});

export type CalendarData = z.input<typeof calendarSchema>;
