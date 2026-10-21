import { z } from "zod";
import {
  StoredWeeklyPlanSchema,
  WeeklyPlanRepository,
  WeeklyScheduleRepository,
  WeeklyCloseRepository,
  MemoryRepository,
  StoredCloseWeekReportSchema,
} from "../../../domain/repositories/types";
import { WeeklyScheduleSchema } from "../../../domain/schedule";
import { MemoryItemSchema } from "../../../domain/memory";

export const UserDataBackupSchema = z
  .object({
    version: z.literal(1),
    app: z.literal("conscious_tech"),
    exportedAt: z.string(),
    data: z
      .object({
        plans: z.array(StoredWeeklyPlanSchema),
        schedules: z.array(WeeklyScheduleSchema),
        closeReports: z.array(StoredCloseWeekReportSchema),
        memories: z.array(MemoryItemSchema),
      })
      .strict(),
  })
  .strict();

export type UserDataBackup = z.infer<typeof UserDataBackupSchema>;

export interface BackupRepositories {
  plans: WeeklyPlanRepository;
  schedules: WeeklyScheduleRepository;
  closeReports: WeeklyCloseRepository;
  memories: MemoryRepository;
}

export interface ImportBackupOptions {
  mode?: "merge" | "replace";
}

export interface ImportBackupResult {
  importedCounts: {
    plans: number;
    schedules: number;
    closeReports: number;
    memories: number;
  };
  exportedAt: string;
}

export async function exportUserData(
  repositories: BackupRepositories
): Promise<UserDataBackup> {
  const [plans, schedules, closeReports, memories] = await Promise.all([
    repositories.plans.getAll(),
    repositories.schedules.getAll(),
    repositories.closeReports.getAll(),
    repositories.memories.getAll(),
  ]);

  const backup: UserDataBackup = {
    version: 1,
    app: "conscious_tech",
    exportedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    data: {
      plans,
      schedules,
      closeReports,
      memories,
    },
  };

  return UserDataBackupSchema.parse(backup);
}

export async function importUserData(
  jsonString: string,
  repositories: BackupRepositories,
  options: ImportBackupOptions = { mode: "replace" }
): Promise<ImportBackupResult> {
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(jsonString);
  } catch (err) {
    throw new Error(`JSON no válido: ${err instanceof Error ? err.message : String(err)}`);
  }

  const parseResult = UserDataBackupSchema.safeParse(parsedRaw);
  if (!parseResult.success) {
    const errorDetails = parseResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`El archivo de respaldo no es válido para Conscious Tech: ${errorDetails}`);
  }

  const backup = parseResult.data;

  if (options.mode === "replace") {
    const [existingPlans, existingSchedules, existingReports, existingMemories] =
      await Promise.all([
        repositories.plans.getAll(),
        repositories.schedules.getAll(),
        repositories.closeReports.getAll(),
        repositories.memories.getAll(),
      ]);

    for (const p of existingPlans) {
      await repositories.plans.delete(p.planId);
    }
    for (const s of existingSchedules) {
      await repositories.schedules.delete(s.scheduleId);
    }
    for (const r of existingReports) {
      await repositories.closeReports.delete(r.reportId);
    }
    for (const m of existingMemories) {
      await repositories.memories.delete(m.id);
    }
  }

  for (const plan of backup.data.plans) {
    await repositories.plans.save(plan);
  }

  for (const schedule of backup.data.schedules) {
    await repositories.schedules.save(schedule, undefined, { force: true });
  }

  for (const report of backup.data.closeReports) {
    await repositories.closeReports.save(report);
  }

  if (backup.data.memories.length > 0) {
    await repositories.memories.saveBatch(backup.data.memories);
  }

  return {
    importedCounts: {
      plans: backup.data.plans.length,
      schedules: backup.data.schedules.length,
      closeReports: backup.data.closeReports.length,
      memories: backup.data.memories.length,
    },
    exportedAt: backup.exportedAt,
  };
}
