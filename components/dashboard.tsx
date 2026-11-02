"use client";

import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};

// Pure class-name helpers (module scope — no per-render recreation)
const pillClass = (state: string, role: "you" | "them") => {
    if (state === "active") return role === "you"
        ? "border-primary/45 bg-primary/10 text-primary"
        : "border-sky-400/45 bg-sky-400/10 text-sky-300";
    if (state === "muted") return "border-amber-400/45 bg-amber-400/10 text-amber-300";
    if (state === "offline") return "border-destructive/40 bg-destructive/10 text-destructive/85";
    if (state === "no-device") return "border-border/80 bg-muted/20 text-muted-foreground/55";
    return "border-border/90 bg-background text-muted-foreground/75";
};
const dotClass = (state: string) => {
    if (state === "active") return "bg-emerald-400 status-pulse";
    if (state === "muted") return "bg-amber-400";
    if (state === "no-device") return "bg-zinc-500";
    if (state === "offline") return "bg-destructive/80";
    return "bg-muted-foreground/60";
};
const shortState = (state: string) =>
    state === "no-device" ? "no dev" : state;

const EQ_BAR_COUNT = 22;

/**
 * Live per-channel waveform that fills the pill. Bars are not a looping CSS
 * pulse — each bar's height comes from a rolling history of the actual live
 * level, so the shape genuinely follows the audio as it arrives (spiky and
 * moving while speaking, settling to a faint baseline when idle, flat when
 * muted). Newest sample is the rightmost bar; older samples trail left.
 */
function ChannelWaveform({ level, active, muted }: { level: number; active: boolean; muted: boolean }) {
    // Rolling buffer of the last `EQ_BAR_COUNT` level samples (0..1), newest last.
    const [history, setHistory] = useState<number[]>(() => Array(EQ_BAR_COUNT).fill(0));
    const levelRef = useRef(0);
    const activeRef = useRef(false);
    const mutedRef = useRef(false);
    // Always render a thin baseline even when silent/muted so the strip reads
    // as an active control area rather than empty space.
    const BASELINE = 0.05;

    useEffect(() => {
        levelRef.current = muted ? 0 : active ? Math.max(0, Math.min(1, level)) : 0;
        activeRef.current = active;
        mutedRef.current = muted;
    }, [level, active, muted]);

    // Push a new sample into the buffer whenever the live level changes (it is
    // pushed roughly every 120ms from the backend, interpolated here via a
    // fast interval for a smoother visual). Lightweight: only mutates a ref
    // and flush-steps state so React doesn't re-render on every micro-step.
    useEffect(() => {
        const id = window.setInterval(() => {
            setHistory((prev) => {
                const next = prev.slice(1);
                next.push(Math.max(levelRef.current, activeRef.current && !mutedRef.current ? 0 : BASELINE));
                return next;
            });
        }, 60);
        return () => window.clearInterval(id);
    }, []);

    return (
        <span className="flex h-[calc(100%-8px)] flex-1 items-end gap-[1.5px]" aria-hidden="true">
            {history.map((h, i) => (
                <span
                    key={i}
                    className={cn("flex-1 rounded-[1px] transition-[height] duration-100 ease-out")}
                    style={{
                        height: `${Math.max(h, BASELINE) * 100}%`,
                        background: muted
                            ? "oklch(0.55 0.02 80 / 0.5)"
                            : active
                                ? `oklch(${0.72 + h * 0.14} ${0.14 + h * 0.05} 65 / ${0.55 + h * 0.45})`
                                : "oklch(0.5 0.02 80 / 0.35)",
                        boxShadow: active && !muted ? `0 0 6px oklch(0.8 0.16 65 / ${h * 0.5})` : undefined,
                    }}
                />
            ))}
        </span>
    );
}


import { usePanelRef } from "react-resizable-panels";
import type { Layout } from "react-resizable-panels";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { glossaryLines } from "@/lib/glossary";
import { useLocalAiModels } from "@/lib/use-local-ai-models";
import { migrateSessionConfig } from "@/lib/model-migration";
import type { LLMProvider } from "@/lib/types";
import { useSessionStore } from "@/lib/stores/session-store";
import { useSessionHistory } from "@/hooks/use-session-history";
import {
    isTauri,
    listSystemAudioDevices,
    startLocalTranscription,
    stopLocalTranscription,
    startDirectDeepgramTranscription,
    stopDirectDeepgramTranscription,
    updateDirectDeepgramTranscription,
    onLocalTranscriptionStatus,
    setLocalMute,
    onLocalTranscriptionActivity,
    setDeepgramMute,
} from "@/lib/tauri";
import { useLocalTranscription } from "@/hooks/use-local-transcription";
import type { FeedItem } from "@/lib/types";
import { useShortcutManager } from "@/hooks/use-shortcut-manager";
import { GearSix, X, CircleNotch, CaretLeft, CaretRight, SpeakerSlash } from "@phosphor-icons/react";
import type { ResponseEntry, SessionConfig } from "@/lib/types";
import LiveFeed from "./live-feed";
import AiResponse from "./ai-response";
import SessionConfigPanel from "./session-config";
import SettingsPanel from "./settings-panel";
import { Button } from "@/components/ui/button";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogClose,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LOCAL_SHERPA_TTS_ENDPOINT, playTtsUrl, synthesizeTts, toRealtimeSpeakText } from "@/lib/tts-client";

/** Logo mark — Phosphor Ear icon flipped horizontally */
function LogoMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 32 32" width="1em" height="1em" className={cn("text-yellow-400", className)} aria-hidden="true">
            <path fill="currentColor" d="m5 13q0 0.4 0.3 0.7 0.3 0.3 0.7 0.3 0.4 0 0.7-0.3 0.3-0.3 0.3-0.7c0-2.4 0.9-4.7 2.6-6.4 1.7-1.7 4-2.6 6.4-2.6 2.4 0 4.7 0.9 6.4 2.6 1.7 1.7 2.6 4 2.6 6.4 0 3.3-1.1 4.4-2.2 5.5-1.1 1-2.3 2.2-2.3 5q0 0.9-0.3 1.7-0.4 0.8-1 1.5-0.7 0.6-1.5 1-0.8 0.3-1.7 0.3c-1.3 0-2.3-0.5-3.2-1.6q-0.3-0.4-0.7-0.4-0.4 0-0.7 0.2-0.4 0.3-0.4 0.7 0 0.4 0.2 0.7 2 2.4 4.8 2.4 1.3 0 2.5-0.5 1.2-0.5 2.1-1.4 0.9-0.9 1.4-2.1 0.5-1.2 0.5-2.5c0-2 0.7-2.7 1.7-3.6 1.2-1.2 2.8-2.7 2.8-6.9 0-2.9-1.2-5.7-3.2-7.8-2.1-2-4.9-3.2-7.8-3.2-2.9 0-5.7 1.2-7.8 3.2-2 2.1-3.2 4.9-3.2 7.8zm4.8 7.1q0.1-0.1 0.3-0.1 0.2 0 0.4 0 0.2 0.1 0.4 0.2 0.1 0.1 0.2 0.3 0.2 0.3 0.5 0.4 0.3 0.2 0.7 0.1 0.3-0.1 0.5-0.4 0.2-0.3 0.2-0.6c0-1.2-0.6-2-1.3-2.9-0.8-1.1-1.7-2.3-1.7-4.1 0-1.6 0.6-3.1 1.8-4.2 1.1-1.2 2.6-1.8 4.2-1.8 1.6 0 3.1 0.6 4.2 1.8 1.2 1.1 1.8 2.6 1.8 4.2q0 0.4-0.3 0.7-0.3 0.3-0.7 0.3-0.4 0-0.7-0.3-0.3-0.3-0.3-0.7c0-1.1-0.4-2.1-1.2-2.8-0.7-0.8-1.7-1.2-2.8-1.2-1.1 0-2.1 0.4-2.8 1.2-0.8 0.7-1.2 1.7-1.2 2.8 0 1.2 0.6 2 1.3 2.9 0.8 1.1 1.7 2.3 1.7 4.1 0 0.7-0.2 1.3-0.6 1.8-0.4 0.5-1 0.9-1.6 1.1-0.7 0.2-1.3 0.1-1.9-0.1-0.7-0.3-1.2-0.7-1.5-1.3q-0.1-0.2-0.1-0.4 0-0.2 0-0.4 0.1-0.1 0.2-0.3 0.1-0.2 0.3-0.3zm10-11.7c1.2 1 2 2.4 2.2 4 0.1 1.6-0.3 3.2-1.3 4.4-1 1.2-2.5 2-4.1 2.2-1.5 0.2-3.1-0.3-4.4-1.3q-0.3-0.3-0.3-0.7-0.1-0.4 0.2-0.7 0.2-0.3 0.7-0.4c0.2 0 0.5 0 0.7 0.2 0.4 0.5 1.9 1 2.9 0.9 1.1-0.1 2-0.6 2.7-1.4 0.7-0.9 1-1.9 0.9-3-0.1-1-0.7-2-1.5-2.7-0.9-0.7-1.3-0.9-2.4-0.9"/>
        </svg>
    );
}

function sourceMatchesDevice(source: string, device?: string): boolean {
    if (!device) return false;
    if (source === device) return true;
    const stripSuffix = (s: string) => s.replace(/\s*\((input|output)\)\s*$/, "");
    return stripSuffix(source) === stripSuffix(device);
}

export default function Dashboard() {
    const { settings, setSettings, configuredProviders } = useSettingsStore();
    // Never scans on its own; reflects a scan the picker or Settings ran.
    const localAiQuery = useLocalAiModels(false);
    const {
        config: sessionConfig,
        setConfig: setSessionConfig,
        currentSessionId,
        setCurrentSessionId,
        setResponses,
        clearResponses,
    } = useSessionStore();
    const {
        sessions,
        createSession,
        loadSession,
        saveResponse,
        saveFeedSnapshot,
        updateSessionConfig,
        deleteSession,
        starSession,
        renameSession,
    } = useSessionHistory();

    const [settingsOpen, setSettingsOpen] = useState(false);
    const [triggerCount, setTriggerCount] = useState(0);
    const [clearCount, setClearCount] = useState(0);
    const [sessionFeedItems, setSessionFeedItems] = useState<FeedItem[]>([]);
    const [isLiveFeed, setIsLiveFeed] = useState(true);
    // Which transition the Start/Stop button is in, for the header label.
    const [pendingAction, setPendingAction] = useState<"starting" | "stopping" | null>(null);
    const [localWhisperRunning, setLocalWhisperRunning] = useState(false);
    const [localWhisperLoading, setLocalWhisperLoading] = useState(false);
    const [directDeepgramRunning, setDirectDeepgramRunning] = useState(false);
    const [directDeepgramLoading, setDirectDeepgramLoading] = useState(false);
    const activeTtsAudioRef = useRef<HTMLAudioElement | null>(null);
    const activeTtsUrlRef = useRef<string | null>(null);
    const [isAiVoiceSpeaking, setIsAiVoiceSpeaking] = useState(false);

    // Resizable panel refs + collapse state
    const leftPanelRef = usePanelRef();
    const rightPanelRef = usePanelRef();
    const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
    const [isRightCollapsed, setIsRightCollapsed] = useState(false);
    const [panelAnimating, setPanelAnimating] = useState(false);

    // Layout persistence (SSR-safe — only access localStorage after mount)
    // Key is versioned so layout-shape changes can migrate cleanly.
    const LAYOUT_KEY = "prmptr-panel-layout.v1";
    const [savedLayout, setSavedLayout] = useState<Layout | undefined>(undefined);
    useEffect(() => {
        try {
            const raw = localStorage.getItem(LAYOUT_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as Layout;
                const timer = setTimeout(() => setSavedLayout(parsed), 0);
                return () => clearTimeout(timer);
            }
        } catch {}
    }, []);
    const handleLayoutChanged = useCallback((layout: Layout) => {
        try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
    }, []);

    // Hydration-safe: defer connection status until after mount to avoid server/client mismatch
    const mounted = useSyncExternalStore(
        subscribeNoop,
        () => true,
        () => false
    );

    // Restore responses from DB on mount if a session is active
    const hasRestoredRef = useRef(false);
    useEffect(() => {
        if (!mounted || hasRestoredRef.current) return;
        hasRestoredRef.current = true;
        const id = useSessionStore.getState().currentSessionId;
        if (id) {
            loadSession(id).then((result) => {
                if (result) {
                    setResponses(result.responses);
                    if (result.feedItems.length > 0) {
                        setSessionFeedItems(result.feedItems);
                        setIsLiveFeed(false);
                    }
                } else {
                    // Session no longer exists in DB
                    setCurrentSessionId(null);
                }
            });
        }
    }, [mounted, loadSession, setResponses, setCurrentSessionId]);

    // A WebView refresh/reload keeps the Tauri process (and its Rust-side
    // transcription `running` flags) alive, so the frontend can come back up
    // into a stale "Local transcription already running" state. On a fresh
    // page load (mounted + Tauri), defensively stop any lingering session so
    // the user always starts clean. Both stop commands are idempotent — the
    // Rust side no-ops when nothing is running.
    const didStaleCleanup = useRef(false);
    useEffect(() => {
        if (!mounted || !isTauri() || didStaleCleanup.current) return;
        didStaleCleanup.current = true;
        const cleanup = async () => {
            try {
                await stopLocalTranscription();
            } catch {}
            try {
                await stopDirectDeepgramTranscription();
            } catch {}
            setLocalWhisperRunning(false);
            setDirectDeepgramRunning(false);
        };
        void cleanup();
    }, [mounted]);


    // Auto-select default audio device on first launch
    useEffect(() => {
        if (!mounted || !isTauri()) return;
        if (!settings.audioDevice) {
            listSystemAudioDevices().then((devices) => {
                if (devices.length > 0) {
                    const inputDevices = devices.filter((d) => d.name.endsWith(" (input)"));
                    const defaultDevice = inputDevices.find((d) => d.is_default) || inputDevices[0];
                    if (!defaultDevice) return;
                    // Merge into current state: secrets may have hydrated since mount.
                    useSettingsStore.getState().patchSettings({ audioDevice: defaultDevice.name });
                }
            }).catch(() => {});
        }
    }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

    // Session history handlers
    const currentSessionIdRef = useRef(currentSessionId);
    useEffect(() => {
        currentSessionIdRef.current = currentSessionId;
    }, [currentSessionId]);
    const sessionConfigRef = useRef(sessionConfig);
    useEffect(() => {
        sessionConfigRef.current = sessionConfig;
    }, [sessionConfig]);
    const feedItemsRef = useRef<FeedItem[]>([]); // updated below with displayFeedItems for persistence

    const stopActiveTtsPlayback = useCallback(() => {
        if (activeTtsAudioRef.current) {
            activeTtsAudioRef.current.pause();
            activeTtsAudioRef.current.currentTime = 0;
            activeTtsAudioRef.current = null;
        }
        if (activeTtsUrlRef.current?.startsWith("blob:")) {
            URL.revokeObjectURL(activeTtsUrlRef.current);
        }
        activeTtsUrlRef.current = null;
        setIsAiVoiceSpeaking(false);
    }, []);

    const handleResponseComplete = useCallback(
        async (entry: ResponseEntry) => {
            let sid = currentSessionIdRef.current;
            if (!sid) {
                sid = await createSession(sessionConfigRef.current);
                setCurrentSessionId(sid);
            }

            const persistPromise = Promise.all([
                saveResponse(sid, entry),
                saveFeedSnapshot(sid, feedItemsRef.current),
            ]);

            const s = useSettingsStore.getState().settings;
            if (s.voiceReplyEnabled && entry.type !== "chat") {
                const ttsEndpoint = s.ttsProvider === "local-sherpa"
                    ? LOCAL_SHERPA_TTS_ENDPOINT
                    : (s.ttsEndpoint?.trim() || "");
                const speakText = toRealtimeSpeakText(entry.content);
                if (ttsEndpoint && speakText) {
                    (async () => {
                        try {
                            const active = activeTtsAudioRef.current;
                            if (active && !active.paused && !active.ended) {
                                return;
                            }
                            stopActiveTtsPlayback();
                            const ttsUrl = await synthesizeTts(
                                ttsEndpoint,
                                speakText,
                                s.ttsVoice,
                                s.ttsModel,
                                s.ttsRate,
                                s.ttsApiKey
                            );
                            activeTtsUrlRef.current = ttsUrl;
                            const audio = await playTtsUrl(ttsUrl, {
                                volume: s.ttsVolume,
                                playbackRate: s.ttsRate,
                            });
                            activeTtsAudioRef.current = audio;
                            setIsAiVoiceSpeaking(true);
                            audio.onplay = () => setIsAiVoiceSpeaking(true);
                            audio.onpause = () => {
                                if (!audio.ended) setIsAiVoiceSpeaking(false);
                            };
                            audio.onended = () => {
                                if (activeTtsUrlRef.current?.startsWith("blob:")) {
                                    URL.revokeObjectURL(activeTtsUrlRef.current);
                                }
                                activeTtsAudioRef.current = null;
                                activeTtsUrlRef.current = null;
                                setIsAiVoiceSpeaking(false);
                            };
                            audio.onerror = () => setIsAiVoiceSpeaking(false);
                        } catch (err) {
                            setIsAiVoiceSpeaking(false);
                            console.error("AI voice reply failed:", err);
                        }
                    })();
                }
            }

            await persistPromise;
        },
        [createSession, saveResponse, saveFeedSnapshot, setCurrentSessionId, stopActiveTtsPlayback]
    );

    const handleSwitchSession = useCallback(
        async (id: string) => {
            const result = await loadSession(id);
            if (result) {
                setSessionConfig(migrateSessionConfig(result.config));
                setResponses(result.responses);
                setSessionFeedItems(result.feedItems);
                setIsLiveFeed(false);
                setCurrentSessionId(id);
            }
        },
        [loadSession, setSessionConfig, setResponses, setCurrentSessionId]
    );

    const handleDeleteSession = useCallback(
        async (id: string) => {
            await deleteSession(id);
            if (currentSessionIdRef.current === id) {
                setCurrentSessionId(null);
                clearResponses();
            }
        },
        [deleteSession, setCurrentSessionId, clearResponses]
    );

    const handleRenameSession = useCallback(
        async (id: string, title: string) => {
            await renameSession(id, title);
        },
        [renameSession]
    );

    const handleStarSession = useCallback(
        async (id: string, starred: boolean) => {
            await starSession(id, starred);
        },
        [starSession]
    );

    const handleConfigChange = useCallback(
        (config: SessionConfig) => {
            setSessionConfig(config);
            const sid = currentSessionIdRef.current;
            if (sid) {
                updateSessionConfig(sid, config);
            }
        },
        [setSessionConfig, updateSessionConfig]
    );

    useEffect(() => {
        if (settings.voiceReplyEnabled) return;
        if (sessionConfig.responseStyle !== "ai-voice") return;
        handleConfigChange({ ...sessionConfig, responseStyle: "concise" });
    }, [settings.voiceReplyEnabled, sessionConfig, handleConfigChange]);

    // Sticky capture error: persists until the user clicks Start again
    const [captureError, setCaptureError] = useState<string | null>(null);

    // Surface transcription-worker death instead of staying stuck in "running"
    useEffect(() => {
        if (!isTauri()) return;
        let unlisten: (() => void) | null = null;
        onLocalTranscriptionStatus((status) => {
            if (!status.running) {
                if (status.mode === "local-whisper") {
                    setLocalWhisperRunning(false);
                } else {
                    setDirectDeepgramRunning(false);
                }
                setCaptureError(status.error ?? "Transcription stopped unexpectedly");
            }
        }).then((fn) => (unlisten = fn));
        return () => unlisten?.();
    }, []);

    const localFeed = useLocalTranscription();
    const isLocalWhisper = (settings.transcriptionMode ?? "local-whisper") === "local-whisper";
    const isDirectDeepgram = (settings.transcriptionMode ?? "local-whisper") === "direct-deepgram";

    // Stop local whisper when switching away from local-whisper mode
    useEffect(() => {
        if (!isLocalWhisper && localWhisperRunning) {
            let alive = true;
            stopLocalTranscription()
                .catch(() => {})
                .finally(() => {
                    if (alive) setLocalWhisperRunning(false);
                });
            return () => {
                alive = false;
            };
        }
    }, [isLocalWhisper, localWhisperRunning]);

    // Stop direct deepgram when switching away from direct-deepgram mode
    useEffect(() => {
        if (!isDirectDeepgram && directDeepgramRunning) {
            let alive = true;
            stopDirectDeepgramTranscription()
                .catch(() => {})
                .finally(() => {
                    if (alive) setDirectDeepgramRunning(false);
                });
            return () => {
                alive = false;
            };
        }
    }, [isDirectDeepgram, directDeepgramRunning]);

    // Cleanup local whisper on unmount
    useEffect(() => {
        return () => {
            if (localWhisperRunning) {
                stopLocalTranscription().catch(() => {});
            }
            if (directDeepgramRunning) {
                stopDirectDeepgramTranscription().catch(() => {});
            }
            stopActiveTtsPlayback();
        };
    }, [localWhisperRunning, directDeepgramRunning, stopActiveTtsPlayback]);

    // Apply Direct Deepgram capture changes live (mute/device) without requiring manual restart.
    useEffect(() => {
        if (!isTauri() || !isDirectDeepgram) return;
        const deepgramKey = settings.deepgramApiKey;
        if (!deepgramKey) return;
        const shouldCapture =
            !settings.muteInput || (!!settings.outputDevice && !settings.muteOutput);
        const timer = setTimeout(() => {
            updateDirectDeepgramTranscription({ apiKey: deepgramKey, inputDeviceName: settings.audioDevice, outputDeviceName: settings.outputDevice, muteInput: settings.muteInput, muteOutput: settings.muteOutput })
                .then(() => {
                    setDirectDeepgramRunning(shouldCapture);
                })
                .catch((err) => {
                    console.error("Failed to live-update direct transcription config:", err);
                });
        }, 120);
        return () => clearTimeout(timer);
    }, [
        isDirectDeepgram,
        settings.deepgramApiKey,
        settings.audioDevice,
        settings.outputDevice,
        settings.muteInput,
        settings.muteOutput,
    ]);
    // Auto-switch to live feed when new events arrive (e.g., after session restore)
    useEffect(() => {
        if (!isLiveFeed && (
            localFeed.items.length > 0 && (localWhisperRunning || directDeepgramRunning)
        )) {
            const timer = setTimeout(() => setIsLiveFeed(true), 0);
            return () => clearTimeout(timer);
        }
    }, [isLiveFeed, localFeed.items.length, localWhisperRunning, directDeepgramRunning]);

    // Both local and Deepgram capture emit `local-transcription` events.
    const visibleLiveItems = localFeed.items;

    // Feed UI should preserve archived session items when live activity resumes.
    const displayFeedItems = (() => {
        if (!isLiveFeed) return sessionFeedItems;
        const seen = new Set(visibleLiveItems.map((i) => i.id));
        const archivedRemainder = sessionFeedItems.filter((i) => !seen.has(i.id));
        return [...visibleLiveItems, ...archivedRemainder];
    })();

    // AI analysis uses only current live capture while in live mode.
    const analysisFeedItems = (() => {
        if (!isLiveFeed) return sessionFeedItems;
        return [...visibleLiveItems].sort(
            (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
    })();
    useEffect(() => {
        feedItemsRef.current = displayFeedItems;
    }, [displayFeedItems]);

    const handleNewSession = useCallback(() => {
        setCurrentSessionId(null);
        clearResponses();
        setSessionFeedItems([]);
        localFeed.clear();
        setIsLiveFeed(true);
    }, [setCurrentSessionId, clearResponses, localFeed]);

    const captureRunning = isLocalWhisper ? localWhisperRunning : isDirectDeepgram && directDeepgramRunning;
    const captureLoading = isLocalWhisper ? localWhisperLoading : isDirectDeepgram && directDeepgramLoading;
    const connectionStatus: "connected" | "disconnected" | "checking" = !mounted
        ? "checking"
        : !isTauri()
            ? "disconnected"
            : captureLoading
                ? "checking"
                : captureRunning
                    ? "connected"
                    : "disconnected";

    // Start/stop handler (used in header button) — mode-aware
    const handleToggle = useCallback(async () => {
        if (!isTauri()) return;

        if (isLocalWhisper) {
            if (localWhisperRunning) {
                setPendingAction("stopping");
                setLocalWhisperLoading(true);
                try {
                    await stopLocalTranscription();
                    setLocalWhisperRunning(false);
                } catch (err) {
                    console.error("Failed to stop local transcription:", err);
                } finally {
                    setPendingAction(null);
                    setLocalWhisperLoading(false);
                }
            } else {
                setPendingAction("starting");
                setLocalWhisperLoading(true);
                setCaptureError(null);
                try {
                    await startLocalTranscription({
                        inputDeviceName: settings.audioDevice,
                        outputDeviceName: settings.outputDevice,
                        preferGpu: settings.localPreferGpu,
                        muteInput: settings.muteInput,
                        muteOutput: settings.muteOutput,
                        glossary: glossaryLines(useSettingsStore.getState().settings.glossary),
                    });
                    setLocalWhisperRunning(true);
                    setIsLiveFeed(true);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    setCaptureError(message);
                } finally {
                    setPendingAction(null);
                    setLocalWhisperLoading(false);
                }
            }
        } else if (isDirectDeepgram) {
            if (directDeepgramRunning) {
                setPendingAction("stopping");
                setDirectDeepgramLoading(true);
                try {
                    await stopDirectDeepgramTranscription();
                    setDirectDeepgramRunning(false);
                } catch (err) {
                    console.error("Failed to stop direct deepgram transcription:", err);
                } finally {
                    setPendingAction(null);
                    setDirectDeepgramLoading(false);
                }
            } else {
                if (!settings.deepgramApiKey) {
                    setCaptureError("Deepgram API key is required for Direct Deepgram mode.");
                    return;
                }
                setPendingAction("starting");
                setDirectDeepgramLoading(true);
                setCaptureError(null);
                try {
                    await startDirectDeepgramTranscription({ apiKey: settings.deepgramApiKey, inputDeviceName: settings.audioDevice, outputDeviceName: settings.outputDevice, muteInput: settings.muteInput, muteOutput: settings.muteOutput });
                    setDirectDeepgramRunning(true);
                    setIsLiveFeed(true);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    setCaptureError(message);
                } finally {
                    setPendingAction(null);
                    setDirectDeepgramLoading(false);
                }
            }
        }
    }, [isLocalWhisper, isDirectDeepgram, localWhisperRunning, directDeepgramRunning, settings.deepgramApiKey, settings.audioDevice, settings.outputDevice, settings.muteInput, settings.muteOutput, settings.localPreferGpu]);

    // Live audio-activity: the backend emits per-channel levels while capturing,
    // independent of transcription finality, so "You"/"Them" show ACTIVE during
    // real audio and IDLE otherwise. Muting a channel drops its level too, so the
    // indicator clearly reflects the mute state.
    const [inputLevel, setInputLevel] = useState(0);
    const [outputLevel, setOutputLevel] = useState(0);
    useEffect(() => {
        if (!isTauri()) return;
        let unlisten: (() => void) | null = null;
        onLocalTranscriptionActivity((a) => {
            setInputLevel(a.input_level);
            setOutputLevel(a.output_level);
        }).then((fn) => (unlisten = fn));
        return () => unlisten?.();
    }, []);

    // Live soft-mute: toggling "You"/"Them" flips the backend flag so the muted
    // channel stops feeding the transcript — no stop/restart of the engine.
    const handleMaskMute = useCallback(
        (channel: "input" | "output", muted: boolean) => {
            useSettingsStore.getState().patchSettings(channel === "input" ? { muteInput: muted } : { muteOutput: muted });
            if (isLocalWhisper && localWhisperRunning) {
                void setLocalMute(channel, muted);
            } else if (isDirectDeepgram && directDeepgramRunning) {
                void setDeepgramMute(channel, muted);
            }
        },
        [isLocalWhisper, isDirectDeepgram, localWhisperRunning, directDeepgramRunning]
    );

    // Unified keyboard shortcuts (browser keydown + Tauri OS-level)
    useShortcutManager({
        onAnalyze: useCallback(() => setTriggerCount((c) => c + 1), []),
        onClear: useCallback(() => setClearCount((c) => c + 1), []),
        onSettingsPanel: useCallback(() => setSettingsOpen((o) => !o), []),
    });

    const providers = useMemo(() => {
        const base = configuredProviders();
        // Your AI apps counts as configured once a scan found at least one model.
        const localAi: LLMProvider[] = (localAiQuery.data?.length ?? 0) > 0 ? ["local-ai"] : [];
        return Array.from(new Set<LLMProvider>([...base, ...localAi]));
        // configuredProviders() reads the store, so the key map must be a dep
        // for the list to refresh when a key is added or removed.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [configuredProviders, settings.apiKeys, localAiQuery.data]);

    const isLoading = captureLoading;

    // Status indicator dot color
    const statusDotClass = isLoading
        ? "bg-primary status-pulse"
        : connectionStatus === "connected"
            ? "bg-emerald-400"
            : connectionStatus === "checking"
                ? "bg-primary status-pulse"
                : "bg-muted-foreground/50";

    // Status label
    const statusLabel = isLoading
        ? pendingAction === "stopping" ? "Stopping" : "Starting"
        : connectionStatus === "connected"
            ? "Recording"
            : connectionStatus === "checking"
                ? "Loading"
                : "Idle";

    const livePolling = isLiveFeed && captureRunning;

    const [activityNowMs, setActivityNowMs] = useState(() => Date.now());
    useEffect(() => {
        if (!livePolling) return;
        const id = window.setInterval(() => setActivityNowMs(Date.now()), 180);
        return () => window.clearInterval(id);
    }, [livePolling]);

    const audioActivity = useMemo(() => {
        let lastInputMs = 0;
        let lastOutputMs = 0;
        for (const item of visibleLiveItems) {
            if (item.type !== "audio") continue;
            const ts = new Date(item.timestamp).getTime();
            if (!Number.isFinite(ts)) continue;
            const isInput = item.deviceType === "input" || sourceMatchesDevice(item.source, settings.audioDevice);
            const isOutput = item.deviceType === "output" || sourceMatchesDevice(item.source, settings.outputDevice);
            if (isInput && ts > lastInputMs) lastInputMs = ts;
            if (isOutput && ts > lastOutputMs) lastOutputMs = ts;
        }
        return { lastInputMs, lastOutputMs };
    }, [visibleLiveItems, settings.audioDevice, settings.outputDevice]);

    // Live per-channel activity from the backend (Whisper/Moonshine). When a
    // channel is muted its level is forced to 0 by the backend, so the indicator
    // clearly shows muted vs actively-receiving audio.
    const levelActive = isLocalWhisper && localWhisperRunning;
    const inputActive =
        (levelActive ? inputLevel > 0.003 : activityNowMs - audioActivity.lastInputMs < 1200) &&
        livePolling;
    const outputActive =
        (levelActive ? outputLevel > 0.003 : activityNowMs - audioActivity.lastOutputMs < 1200) &&
        livePolling;
    const inputState = connectionStatus !== "connected"
        ? "offline"
        : settings.muteInput
            ? "muted"
            : !settings.audioDevice
                ? "no-device"
                : inputActive
                    ? "active"
                    : "idle";
    const outputState = connectionStatus !== "connected"
        ? "offline"
        : settings.muteOutput
            ? "muted"
            : !settings.outputDevice
                ? "no-device"
                : outputActive
                    ? "active"
                    : "idle";

    return (
        <div className="flex flex-col h-screen bg-background text-foreground noise-bg">
            {/* Header */}
            <header className="flex items-center justify-between px-4 h-11 border-b border-border shrink-0">
                {/* Logo + Status */}
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <LogoMark className="size-4 text-primary" />
                        <span className="text-xs font-semibold tracking-[0.08em] text-foreground/90">
                            PRMPTR
                        </span>
                    </div>

                    <div className="w-px h-4 bg-border" />

                    {/* Status indicator */}
                    <div className="flex items-center gap-1.5 min-w-0">
                        <span className={cn("size-1.5 rounded-full transition-colors shrink-0", statusDotClass)} />
                        <span className="text-[10px] text-muted-foreground tracking-wide uppercase shrink-0">
                            {statusLabel}
                        </span>
                        {connectionStatus === "disconnected" && captureError && (
                            <span className="text-[10px] text-destructive truncate max-w-[280px]" title={captureError}>
                                {captureError}
                            </span>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                    {mounted && isTauri() && (
                        <div className="flex items-center gap-1.5 mr-1">
                            <button
                                type="button"
                                onClick={() => handleMaskMute("input", !settings.muteInput)}
                                className={cn(
                                    "inline-flex h-[26px] w-[168px] items-center justify-between gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-[0.08em] transition-colors",
                                    pillClass(inputState, "you")
                                )}
                                title={`You ${shortState(inputState)} • click to ${settings.muteInput ? "unmute" : "mute"}`}
                            >
                                <span className="flex shrink-0 items-center gap-1.5">
                                    <span className={cn("size-1.5 shrink-0 rounded-full", dotClass(inputState))} />
                                    <span className="font-medium shrink-0">You</span>
                                </span>
                                <ChannelWaveform
                                    level={inputLevel}
                                    active={inputActive}
                                    muted={!!settings.muteInput}
                                />
                            </button>
                            <button
                                type="button"
                                onClick={() => handleMaskMute("output", !settings.muteOutput)}
                                className={cn(
                                    "inline-flex h-[26px] w-[168px] items-center justify-between gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-[0.08em] transition-colors",
                                    pillClass(outputState, "them")
                                )}
                                title={`Them ${shortState(outputState)} • click to ${settings.muteOutput ? "unmute" : "mute"}`}
                            >
                                <span className="flex shrink-0 items-center gap-1.5">
                                    <span className={cn("size-1.5 shrink-0 rounded-full", dotClass(outputState))} />
                                    <span className="font-medium shrink-0">Them</span>
                                </span>
                                <ChannelWaveform
                                    level={outputLevel}
                                    active={outputActive}
                                    muted={!!settings.muteOutput}
                                />
                            </button>
                        </div>
                    )}

                    {isAiVoiceSpeaking && (
                        <Button
                            variant="outline"
                            size="xs"
                            onClick={stopActiveTtsPlayback}
                            className="gap-1"
                        >
                            <SpeakerSlash weight="bold" className="size-3" />
                            Stop Voice
                        </Button>
                    )}

                    {/* Action button */}
                    {mounted && isTauri() && (
                        <Button
                            variant={connectionStatus === "connected" ? "ghost" : "outline"}
                            size="xs"
                            disabled={isLoading}
                            onClick={handleToggle}
                            className="min-w-[52px]"
                        >
                            {isLoading ? (
                                <CircleNotch weight="bold" className="size-3 animate-spin" />
                            ) : connectionStatus === "connected" ? "Stop" : "Start"}
                        </Button>
                    )}

                    <div className="w-px h-4 bg-border" />

                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setSettingsOpen((o) => !o)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Settings"
                        title="Settings"
                    >
                        <GearSix weight="bold" className="size-3.5" />
                    </Button>
                </div>
            </header>

            {/* Main Content — defer ResizablePanelGroup until mount to avoid hydration mismatch (react-resizable-panels uses useId) */}
            <main className="flex-1 min-h-0">
                {!mounted ? (
                    <div className="flex h-full w-full" aria-hidden="true" />
                ) : (
                <ResizablePanelGroup
                    orientation="horizontal"
                    defaultLayout={savedLayout}
                    onLayoutChanged={handleLayoutChanged}
                    className={panelAnimating ? "panel-animating" : undefined}
                >
                    {/* Left: Live Feed */}
                    <ResizablePanel
                        id="left"
                        panelRef={leftPanelRef}
                        defaultSize="25%"
                        minSize="15%"
                        collapsible
                        collapsedSize="0%"
                        onResize={(size) => setIsLeftCollapsed(size.asPercentage === 0)}
                        className="flex flex-col min-h-0"
                    >
                        <LiveFeed
                            items={displayFeedItems}
                            isPolling={livePolling}
                            isConnected={connectionStatus === "connected"}
                            inputDevice={settings.audioDevice}
                            outputDevice={settings.outputDevice}
                            onCollapse={() => {
                                setPanelAnimating(true);
                                setTimeout(() => setPanelAnimating(false), 300);
                                leftPanelRef.current?.collapse();
                            }}
                        />
                    </ResizablePanel>

                    <ResizableHandle />

                    {/* Center: AI Response — padding when side panels collapsed for visual spacing */}
                    <ResizablePanel
                        id="center"
                        defaultSize="50%"
                        minSize="30%"
                        className={cn(
                            "flex flex-col min-h-0 relative z-10 transition-[padding] duration-200",
                            isLeftCollapsed && "pl-8",
                            isRightCollapsed && "pr-8"
                        )}
                    >
                        {/* Expand tabs when side panels collapsed */}
                        {isLeftCollapsed && (
                            <button
                                type="button"
                                onClick={() => {
                                    setPanelAnimating(true);
                                    setTimeout(() => setPanelAnimating(false), 300);
                                    leftPanelRef.current?.expand();
                                }}
                                className="absolute left-0 top-0 bottom-0 w-8 z-10 flex items-center justify-center bg-muted/30 hover:bg-muted border-r border-border text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                                title="Expand feed"
                            >
                                <CaretRight weight="bold" className="size-3.5" />
                            </button>
                        )}
                        {isRightCollapsed && (
                            <button
                                type="button"
                                onClick={() => {
                                    setPanelAnimating(true);
                                    setTimeout(() => setPanelAnimating(false), 300);
                                    rightPanelRef.current?.expand();
                                }}
                                className="absolute right-0 top-0 bottom-0 w-8 z-10 flex items-center justify-center bg-muted/30 hover:bg-muted border-l border-border text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                                title="Expand config"
                            >
                                <CaretLeft weight="bold" className="size-3.5" />
                            </button>
                        )}
                        <AiResponse
                            feedItems={analysisFeedItems}
                            sessionConfig={sessionConfig}
                            apiKeys={settings.apiKeys}
                            lmstudioUrl={settings.lmstudioUrl}
                            triggerCount={triggerCount}
                            clearCount={clearCount}
                            onResponseComplete={handleResponseComplete}
                            devices={{ inputDevice: settings.audioDevice, outputDevice: settings.outputDevice }}
                        />
                    </ResizablePanel>

                    <ResizableHandle />

                    {/* Right: Session Config */}
                    <ResizablePanel
                        id="right"
                        panelRef={rightPanelRef}
                        defaultSize="25%"
                        minSize="15%"
                        collapsible
                        collapsedSize="0%"
                        onResize={(size) => setIsRightCollapsed(size.asPercentage === 0)}
                        className="flex flex-col min-h-0"
                    >
                        <SessionConfigPanel
                            config={sessionConfig}
                            onChange={handleConfigChange}
                            configuredProviders={providers}
                            sessions={sessions}
                            currentSessionId={currentSessionId}
                            onSwitchSession={handleSwitchSession}
                            onNewSession={handleNewSession}
                            onDeleteSession={handleDeleteSession}
                            onRenameSession={handleRenameSession}
                            onStarSession={handleStarSession}
                            onCollapse={() => {
                                setPanelAnimating(true);
                                setTimeout(() => setPanelAnimating(false), 300);
                                rightPanelRef.current?.collapse();
                            }}
                        />
                    </ResizablePanel>
                </ResizablePanelGroup>
                )}
            </main>

            {/* Settings Dialog */}
            <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                <DialogContent className="top-[2vh] left-1/2 -translate-x-1/2 translate-y-0 h-[96vh] w-[96vw] max-w-[1600px] overflow-hidden flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Settings</DialogTitle>
                        <DialogClose
                            render={
                                <button className="text-muted-foreground hover:text-foreground transition-colors">
                                    <X weight="bold" className="size-4" />
                                </button>
                            }
                        />
                    </DialogHeader>
                    <SettingsPanel
                        settings={settings}
                        onChange={setSettings}
                        connectionStatus={connectionStatus}
                        statusMessage={captureError ?? undefined}
                    />
                </DialogContent>
            </Dialog>

            {/* Footer — shortcut hints */}
            <footer className="flex items-center gap-5 px-4 h-7 border-t border-border text-[10px] text-muted-foreground/70 shrink-0 select-none">
                {[
                    { key: settings.shortcuts.analyze.label, action: "Analyze" },
                    { key: settings.shortcuts.clear.label, action: "Clear" },
                    { key: settings.shortcuts.settingsPanel.label, action: "Settings" },
                ].map(({ key, action }) => (
                    <span key={action} className="flex items-center gap-1.5">
                        <kbd className="px-1 py-px border border-border bg-muted/50 text-[9px] font-medium tracking-tight">
                            {key}
                        </kbd>
                        <span>{action}</span>
                    </span>
                ))}
            </footer>
        </div>
    );
}

