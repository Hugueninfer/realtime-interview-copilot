/** Zod schemas for per-user interview context (resume/JD/notes). */

import { z } from "zod";

const MAX_RESUME_TEXT_CHARS = 6000;
const MAX_JD_TEXT_CHARS = 4000;
const MAX_INTERVIEW_NOTES_CHARS = 4000;

export const interviewContextPatchSchema = z.object({
  interviewNotes: z.string().max(MAX_INTERVIEW_NOTES_CHARS).nullable().optional(),
  resumeText: z.string().max(MAX_RESUME_TEXT_CHARS).nullable().optional(),
  resumeFileName: z.string().max(255).nullable().optional(),
  jobDescription: z.string().max(MAX_JD_TEXT_CHARS).nullable().optional(),
  englishLevel: z.enum(["B1", "B2", "C1", "C2"]).nullable().optional(),
  responseLength: z.enum(["brief", "standard", "detailed"]).nullable().optional(),
  naturalEnglish: z.boolean().nullable().optional(),
});

export type InterviewContextPatch = z.infer<typeof interviewContextPatchSchema>;
