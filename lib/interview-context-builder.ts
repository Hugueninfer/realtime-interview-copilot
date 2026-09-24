import type { InterviewContext } from "@/lib/interview";

const LENGTH_GUIDANCE = {
  brief: "Keep it to about 20–30 seconds.",
  standard: "Keep it to about 45–60 seconds.",
  detailed: "Keep it to about 90 seconds, while staying focused.",
} as const;

/** Builds the stable, structured context sent alongside live input. */
export function buildInterviewContextBlock(context: InterviewContext): string {
  const { candidate, mode } = context;
  const parts = [
    "INTERVIEW SESSION CONTEXT",
    `MODE: ${mode}`,
    "CANDIDATE RESPONSE PREFERENCES:",
    `- English level: ${candidate.responsePreferences.englishLevel}`,
    `- Response length: ${candidate.responsePreferences.responseLength}`,
    `- ${LENGTH_GUIDANCE[candidate.responsePreferences.responseLength]}`,
  ];

  if (candidate.responsePreferences.naturalEnglish) {
    parts.push("- Use natural, spoken English rather than formal written prose.");
  }
  if (candidate.interviewNotes?.trim()) {
    parts.push(`INTERVIEW NOTES:\n${candidate.interviewNotes.trim()}`);
  }
  if (candidate.resumeText?.trim()) {
    parts.push(`RESUME:\n${candidate.resumeText.trim()}`);
  }
  if (candidate.jobDescription?.trim()) {
    parts.push(`JOB DESCRIPTION:\n${candidate.jobDescription.trim()}`);
  }

  return parts.join("\n\n");
}
