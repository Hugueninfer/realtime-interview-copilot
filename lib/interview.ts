/**
 * Interview domain primitives shared by the profile UI and prompt builder.
 * Keep these values independent from a particular model/provider so later
 * Technical, Coding and Debug modes can use the same candidate context.
 */

export const INTERVIEW_MODES = [
  "interview",
  "technical",
  "coding",
  "debug",
] as const;

export type InterviewMode = (typeof INTERVIEW_MODES)[number];

export const ENGLISH_LEVELS = ["B1", "B2", "C1", "C2"] as const;
export type EnglishLevel = (typeof ENGLISH_LEVELS)[number];

export const RESPONSE_LENGTHS = ["brief", "standard", "detailed"] as const;
export type ResponseLength = (typeof RESPONSE_LENGTHS)[number];

export interface ResponsePreferences {
  englishLevel: EnglishLevel;
  responseLength: ResponseLength;
  naturalEnglish: boolean;
}

export interface CandidateProfile {
  resumeText: string | null;
  resumeFileName: string | null;
  jobDescription: string | null;
  interviewNotes: string | null;
  responsePreferences: ResponsePreferences;
}

export interface InterviewContext {
  candidate: CandidateProfile;
  mode: InterviewMode;
  transcript: string;
}

export const DEFAULT_RESPONSE_PREFERENCES: ResponsePreferences = {
  englishLevel: "C1",
  responseLength: "standard",
  naturalEnglish: true,
};
