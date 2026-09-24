"use client";

/**
 * Shared interview context (notes, resume, JD) for the full Copilot and
 * CompactCopilot surfaces. Lifting this above the compact ↔ full boundary
 * keeps draft fields intact when toggling modes without re-fetching.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { authClient } from "@/lib/auth-client";
import { humanizeError } from "@/lib/api-errors";
import {
  APP_SESSION_KEYS,
  readAppSession,
  writeAppSession,
} from "@/lib/app-session-storage";
import { ricFetch } from "@/lib/ric-fetch";
import type { UserInterviewContext } from "@/lib/types";
import {
  DEFAULT_RESPONSE_PREFERENCES,
  type EnglishLevel,
  type ResponseLength,
} from "@/lib/interview";

export interface InterviewContextFields {
  interviewNotes?: string | null;
  resumeText?: string | null;
  resumeFileName?: string | null;
  jobDescription?: string | null;
  englishLevel?: EnglishLevel | null;
  responseLength?: ResponseLength | null;
  naturalEnglish?: boolean | null;
}

const EMPTY: UserInterviewContext = {
  interviewNotes: null,
  resumeText: null,
  resumeFileName: null,
  jobDescription: null,
  englishLevel: DEFAULT_RESPONSE_PREFERENCES.englishLevel,
  responseLength: DEFAULT_RESPONSE_PREFERENCES.responseLength,
  naturalEnglish: DEFAULT_RESPONSE_PREFERENCES.naturalEnglish,
  updatedAt: null,
};

type InterviewContextValue = {
  context: UserInterviewContext;
  interviewNotes: string;
  resumeText: string | null;
  resumeFileName: string | null;
  jobDescription: string;
  englishLevel: EnglishLevel;
  responseLength: ResponseLength;
  naturalEnglish: boolean;
  setInterviewNotes: (value: string) => void;
  setJobDescription: (value: string) => void;
  setEnglishLevel: (value: EnglishLevel) => void;
  setResponseLength: (value: ResponseLength) => void;
  setNaturalEnglish: (value: boolean) => void;
  setResumeParsed: (text: string, fileName: string) => void;
  clearResume: () => void;
  isLoading: boolean;
  isSaving: boolean;
  isHydrated: boolean;
  error: string | null;
  fetchContext: () => Promise<void>;
  saveContext: () => Promise<boolean>;
  updateContext: (fields: InterviewContextFields) => Promise<boolean>;
};

const InterviewContext = createContext<InterviewContextValue | null>(null);

function applyServerContext(
  server: UserInterviewContext,
  setters: {
    setContext: (c: UserInterviewContext) => void;
    setInterviewNotes: (v: string) => void;
    setResumeText: (v: string | null) => void;
    setResumeFileName: (v: string | null) => void;
    setJobDescription: (v: string) => void;
    setEnglishLevel: (v: EnglishLevel) => void;
    setResponseLength: (v: ResponseLength) => void;
    setNaturalEnglish: (v: boolean) => void;
  },
) {
  setters.setContext(server);
  setters.setInterviewNotes(server.interviewNotes ?? "");
  setters.setResumeText(server.resumeText);
  setters.setResumeFileName(server.resumeFileName);
  setters.setJobDescription(server.jobDescription ?? "");
  setters.setEnglishLevel(
    server.englishLevel ?? DEFAULT_RESPONSE_PREFERENCES.englishLevel,
  );
  setters.setResponseLength(
    server.responseLength ?? DEFAULT_RESPONSE_PREFERENCES.responseLength,
  );
  setters.setNaturalEnglish(
    server.naturalEnglish ?? DEFAULT_RESPONSE_PREFERENCES.naturalEnglish,
  );
}

export function InterviewContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { data: session } = authClient.useSession();
  const [context, setContext] = useState<UserInterviewContext>(EMPTY);
  const [interviewNotes, setInterviewNotes] = useState("");
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [resumeFileName, setResumeFileName] = useState<string | null>(null);
  const [jobDescription, setJobDescription] = useState("");
  const [englishLevel, setEnglishLevel] = useState<EnglishLevel>(
    DEFAULT_RESPONSE_PREFERENCES.englishLevel,
  );
  const [responseLength, setResponseLength] = useState<ResponseLength>(
    DEFAULT_RESPONSE_PREFERENCES.responseLength,
  );
  const [naturalEnglish, setNaturalEnglish] = useState(
    DEFAULT_RESPONSE_PREFERENCES.naturalEnglish,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);

  const fieldsSnapshot = useCallback(
    () =>
      JSON.stringify({
        interviewNotes: interviewNotes.trim(),
        resumeText,
        resumeFileName,
        jobDescription: jobDescription.trim(),
        englishLevel,
        responseLength,
        naturalEnglish,
      }),
    [
      interviewNotes,
      resumeText,
      resumeFileName,
      jobDescription,
      englishLevel,
      responseLength,
      naturalEnglish,
    ],
  );

  const markFieldsSaved = useCallback(() => {
    lastSavedSnapshotRef.current = fieldsSnapshot();
  }, [fieldsSnapshot]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const syncDraftFromServer = useCallback((server: UserInterviewContext) => {
    applyServerContext(server, {
      setContext,
      setInterviewNotes,
      setResumeText,
      setResumeFileName,
      setJobDescription,
      setEnglishLevel,
      setResponseLength,
      setNaturalEnglish,
    });
  }, []);

  const fetchContext = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsLoading(true);
    setError(null);
    try {
      const res = await ricFetch("/api/interview-context", {
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { context: UserInterviewContext };
      syncDraftFromServer(data.context ?? EMPTY);
      setIsHydrated(true);
      lastSavedSnapshotRef.current = JSON.stringify({
        interviewNotes: (data.context?.interviewNotes ?? "").trim(),
        resumeText: data.context?.resumeText ?? null,
        resumeFileName: data.context?.resumeFileName ?? null,
        jobDescription: (data.context?.jobDescription ?? "").trim(),
        englishLevel:
          data.context?.englishLevel ??
          DEFAULT_RESPONSE_PREFERENCES.englishLevel,
        responseLength:
          data.context?.responseLength ??
          DEFAULT_RESPONSE_PREFERENCES.responseLength,
        naturalEnglish:
          data.context?.naturalEnglish ??
          DEFAULT_RESPONSE_PREFERENCES.naturalEnglish,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(humanizeError(err));
    } finally {
      setIsLoading(false);
    }
  }, [syncDraftFromServer]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      writeAppSession(
        APP_SESSION_KEYS.interviewDraft,
        JSON.stringify({
          interviewNotes,
          resumeText,
        resumeFileName,
        jobDescription,
        englishLevel,
        responseLength,
        naturalEnglish,
        }),
      );
    } catch {
      /* non-fatal */
    }
  }, [
    interviewNotes,
    resumeText,
    resumeFileName,
    jobDescription,
    englishLevel,
    responseLength,
    naturalEnglish,
    isHydrated,
  ]);

  useEffect(() => {
    if (session?.user) {
      const raw = readAppSession(APP_SESSION_KEYS.interviewDraft);
      if (raw) {
        try {
          const draft = JSON.parse(raw) as InterviewContextFields;
          if (typeof draft.interviewNotes === "string") {
            setInterviewNotes(draft.interviewNotes);
          }
          if (draft.resumeText !== undefined) setResumeText(draft.resumeText);
          if (draft.resumeFileName !== undefined) {
            setResumeFileName(draft.resumeFileName);
          }
          if (typeof draft.jobDescription === "string") {
            setJobDescription(draft.jobDescription);
          }
          if (
            ["B1", "B2", "C1", "C2"].includes(draft.englishLevel ?? "")
          ) {
            setEnglishLevel(draft.englishLevel as EnglishLevel);
          }
          if (
            ["brief", "standard", "detailed"].includes(
              draft.responseLength ?? "",
            )
          ) {
            setResponseLength(draft.responseLength as ResponseLength);
          }
          if (typeof draft.naturalEnglish === "boolean") {
            setNaturalEnglish(draft.naturalEnglish);
          }
        } catch {
          /* ignore corrupt draft */
        }
      }
      setIsHydrated(false);
      void fetchContext();
    } else {
      abortRef.current?.abort();
      setContext(EMPTY);
      setInterviewNotes("");
      setResumeText(null);
      setResumeFileName(null);
      setJobDescription("");
      setEnglishLevel(DEFAULT_RESPONSE_PREFERENCES.englishLevel);
      setResponseLength(DEFAULT_RESPONSE_PREFERENCES.responseLength);
      setNaturalEnglish(DEFAULT_RESPONSE_PREFERENCES.naturalEnglish);
      setIsHydrated(false);
      setError(null);
      writeAppSession(APP_SESSION_KEYS.interviewDraft, "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-hydrate when user id changes
  }, [session?.user?.id, fetchContext]);

  const updateContext = useCallback(
    async (fields: InterviewContextFields): Promise<boolean> => {
      setIsSaving(true);
      setError(null);
      try {
        const res = await ricFetch("/api/interview-context", {
          method: "PATCH",
          body: JSON.stringify(fields),
        });
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const data = (await res.json()) as { error?: string };
            if (data?.error) msg = data.error;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        const data = (await res.json()) as { context: UserInterviewContext };
        if (data.context) {
          syncDraftFromServer(data.context);
          lastSavedSnapshotRef.current = JSON.stringify({
            interviewNotes: (data.context.interviewNotes ?? "").trim(),
            resumeText: data.context.resumeText,
            resumeFileName: data.context.resumeFileName,
            jobDescription: (data.context.jobDescription ?? "").trim(),
            englishLevel:
              data.context.englishLevel ??
              DEFAULT_RESPONSE_PREFERENCES.englishLevel,
            responseLength:
              data.context.responseLength ??
              DEFAULT_RESPONSE_PREFERENCES.responseLength,
            naturalEnglish:
              data.context.naturalEnglish ??
              DEFAULT_RESPONSE_PREFERENCES.naturalEnglish,
          });
        } else {
          await fetchContext();
        }
        setIsHydrated(true);
        return true;
      } catch (err: unknown) {
        setError(humanizeError(err));
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [fetchContext, syncDraftFromServer],
  );

  const saveContext = useCallback(async () => {
    return updateContext({
      interviewNotes: interviewNotes.trim() || null,
      resumeText,
      resumeFileName,
      jobDescription: jobDescription.trim() || null,
      englishLevel,
      responseLength,
      naturalEnglish,
    });
  }, [
    updateContext,
    interviewNotes,
    resumeText,
    resumeFileName,
    jobDescription,
    englishLevel,
    responseLength,
    naturalEnglish,
  ]);

  // Debounced server sync — drafts already persist to sessionStorage on change.
  useEffect(() => {
    if (!session?.user || !isHydrated || isLoading) return;

    const snapshot = fieldsSnapshot();
    if (snapshot === lastSavedSnapshotRef.current) return;

    const timer = window.setTimeout(() => {
      void saveContext().then((ok) => {
        if (ok) markFieldsSaved();
      });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [
    fieldsSnapshot,
    isHydrated,
    isLoading,
    markFieldsSaved,
    saveContext,
    session?.user,
  ]);

  const setResumeParsed = useCallback((text: string, fileName: string) => {
    setResumeText(text);
    setResumeFileName(fileName);
  }, []);

  const clearResume = useCallback(() => {
    setResumeText(null);
    setResumeFileName(null);
  }, []);

  const value: InterviewContextValue = {
    context,
    interviewNotes,
    resumeText,
    resumeFileName,
    jobDescription,
    englishLevel,
    responseLength,
    naturalEnglish,
    setInterviewNotes,
    setJobDescription,
    setEnglishLevel,
    setResponseLength,
    setNaturalEnglish,
    setResumeParsed,
    clearResume,
    isLoading,
    isSaving,
    isHydrated,
    error,
    fetchContext,
    saveContext,
    updateContext,
  };

  return (
    <InterviewContext.Provider value={value}>
      {children}
    </InterviewContext.Provider>
  );
}

export function useInterviewContext() {
  const ctx = useContext(InterviewContext);
  if (!ctx) {
    throw new Error(
      "useInterviewContext must be used within InterviewContextProvider",
    );
  }
  return ctx;
}
