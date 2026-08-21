"use client";

import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};

import { usePanelRef } from "react-resizable-panels";
import type { Layout } from "react-resizable-panels";
import { useSettingsStore } from "@/lib/stores/settings-store";
import { useSessionStore } from "@/lib/stores/session-store";
import { useSessionHistory } from "@/hooks/use-session-history";
import { useScreenpipeFeed, useScreenpipeHealth } from "@/hooks/use-screenpipe";
import {
    isTauri,
    onScreenpipeStatus,
    startScreenpipe,
    stopScreenpipe,
    updateScreenpipeConfig,
    checkScreenpipeInstalled,
    installScreenpipe,
    onInstallProgress,
    listSystemAudioDevices,
    startLocalTranscription,
    stopLocalTranscription,
    startDirectDeepgramTranscription,
    stopDirectDeepgramTranscription,
    updateDirectDeepgramTranscription,
    onLocalTranscriptionStatus,
} from "@/lib/tauri";
import { useLocalTranscription } from "@/hooks/use-local-transcription";
import type { FeedItem } from "@/lib/types";
import { useShortcutManager } from "@/hooks/use-shortcut-manager";
import { GearSix, X, CircleNotch, Download, ArrowSquareOut, Ear, CaretLeft, CaretRight, SpeakerSlash, Microphone, MicrophoneSlash, SpeakerHigh } from "@phosphor-icons/react";
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
    return <Ear weight="regular" className={cn("-scale-x-100 text-yellow-400", className)} aria-hidden="true" />;
}

function sourceMatchesDevice(source: string, device?: string): boolean {
    if (!device) return false;
    if (source === device) return true;
    const stripSuffix = (s: string) => s.replace(/\s*\((input|output)\)\s*$/, "");
    return stripSuffix(source) === stripSuffix(device);
}

export default function Dashboard() {
    const { settings, setSettings, configuredProviders } = useSettingsStore();
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
    const [screenpipeLoading, setScreenpipeLoading] = useState(false);
    // Tracks what we're waiting for: "starting" means we invoked start and are waiting for "connected",
    // "stopping" means we invoked stop and are waiting for "disconnected".
    const pendingActionRef = useRef<"starting" | "stopping" | null>(null);
    const [pendingAction, setPendingAction] = useState<"starting" | "stopping" | null>(null);
    const [screenpipeInstalled, setScreenpipeInstalled] = useState<boolean | null>(null); // null = checking
    const [localWhisperRunning, setLocalWhisperRunning] = useState(false);
    const [localWhisperLoading, setLocalWhisperLoading] = useState(false);
    const [directDeepgramRunning, setDirectDeepgramRunning] = useState(false);
    const [directDeepgramLoading, setDirectDeepgramLoading] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [installProgress, setInstallProgress] = useState<{ stage: string; percent: number } | null>(null);
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

    // Auto-select default audio device on first launch
    useEffect(() => {
        if (!mounted || !isTauri()) return;
        if (!settings.audioDevice) {
            listSystemAudioDevices().then((devices) => {
                if (devices.length > 0) {
                    const inputDevices = devices.filter((d) => d.name.endsWith(" (input)"));
                    const defaultDevice = inputDevices.find((d) => d.is_default) || inputDevices[0];
                    if (!defaultDevice) return;
                    setSettings({ ...settings, audioDevice: defaultDevice.name });
                }
            }).catch(() => {});
        }
    }, [mounted]); // eslint-disable-line react-hooks/exhaustive-deps

    // Check if screenpipe is installed (Tauri only)
    useEffect(() => {
        if (!mounted || !isTauri()) return;
        checkScreenpipeInstalled().then((result) => {
            setScreenpipeInstalled(result.installed);
        }).catch(() => {
            setScreenpipeInstalled(false);
        });
    }, [mounted]);

    // Listen for install progress events (Tauri only)
    useEffect(() => {
        if (!isTauri()) return;
        let unlisten: (() => void) | null = null;
        onInstallProgress((progress) => setInstallProgress(progress)).then(
            (fn) => (unlisten = fn)
        );
        return () => unlisten?.();
    }, []);

    // Install handler
    const handleInstallScreenpipe = useCallback(async () => {
        setInstalling(true);
        setInstallProgress({ stage: "Starting...", percent: 0 });
        try {
            await installScreenpipe();
            setScreenpipeInstalled(true);
        } catch (err) {
            console.error("Install failed:", err);
            setInstallProgress({ stage: `Error: ${err}`, percent: 0 });
        } finally {
            setInstalling(false);
        }
    }, []);

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
                setSessionConfig(result.config);
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

    // Screenpipe status — Tauri events or web polling
    const [tauriScreenpipeStatus, setTauriScreenpipeStatus] = useState<{
        running: boolean;
        healthy: boolean;
        message: string;
    } | null>(null);
    // Sticky error: persists until the user clicks Start again
    const [screenpipeError, setScreenpipeError] = useState<string | null>(null);

    useEffect(() => {
        if (!isTauri()) return;
        let unlisten: (() => void) | null = null;
        onScreenpipeStatus((status) => setTauriScreenpipeStatus(status)).then(
            (fn) => (unlisten = fn)
        );
        return () => unlisten?.();
    }, []);

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
                setScreenpipeError(status.error ?? "Transcription stopped unexpectedly");
            }
        }).then((fn) => (unlisten = fn));
        return () => unlisten?.();
    }, []);

    // Web-mode health polling (only when not in Tauri)
    const health = useScreenpipeHealth(settings.screenpipeUrl);
    const tauriRunning = tauriScreenpipeStatus?.running ?? false;
    const isConnected = isTauri()
        ? tauriScreenpipeStatus?.healthy ?? false
        : health.data?.connected ?? false;

    const feed = useScreenpipeFeed({
        screenpipeUrl: settings.screenpipeUrl,
        enabled: isConnected,
        enableVision: !!settings.enableVision,
    });
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
            updateDirectDeepgramTranscription(
                deepgramKey,
                settings.audioDevice,
                settings.outputDevice,
                settings.muteInput,
                settings.muteOutput
            )
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
            (feed.items.length > 0 && feed.isPolling) ||
            ((isLocalWhisper || isDirectDeepgram) && localFeed.items.length > 0 && (localWhisperRunning || directDeepgramRunning))
        )) {
            const timer = setTimeout(() => setIsLiveFeed(true), 0);
            return () => clearTimeout(timer);
        }
    }, [feed.items.length, feed.isPolling, isLiveFeed, isLocalWhisper, isDirectDeepgram, localFeed.items.length, localWhisperRunning, directDeepgramRunning]);

    const visibleLiveItems = (isLocalWhisper || isDirectDeepgram) ? localFeed.items : feed.items;

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
        feed.clearFeed();
        localFeed.clear();
        setIsLiveFeed(true);
    }, [setCurrentSessionId, clearResponses, feed, localFeed]);

    const connectionStatus: "connected" | "disconnected" | "checking" = !mounted
        ? "checking"
        : isTauri() && isLocalWhisper
            ? localWhisperLoading
                ? "checking"
                : localWhisperRunning
                    ? "connected"
                    : "disconnected"
            : isTauri() && isDirectDeepgram
                ? directDeepgramLoading
                    ? "checking"
                    : directDeepgramRunning
                        ? "connected"
                        : "disconnected"
            : isTauri()
                ? tauriScreenpipeStatus?.healthy
                    ? "connected"
                    : tauriScreenpipeStatus?.running
                        ? "checking"
                        : "disconnected"
                : health.isFetching && !health.data
                    ? "checking"
                    : isConnected
                        ? "connected"
                        : "disconnected";

    // Clear loading once the connection status reaches the expected state (or timeout)
    useEffect(() => {
        if (!screenpipeLoading || !pendingActionRef.current) return;
        const action = pendingActionRef.current;
        if (
            (action === "starting" && connectionStatus === "connected") ||
            (action === "stopping" && connectionStatus === "disconnected")
        ) {
            pendingActionRef.current = null;
            setPendingAction(null);
            setScreenpipeLoading(false);
        }
    }, [connectionStatus, screenpipeLoading]);

    // Safety timeout — don't stay in loading state forever (30s)
    useEffect(() => {
        if (!screenpipeLoading) return;
        const timer = setTimeout(() => {
            pendingActionRef.current = null;
            setPendingAction(null);
            setScreenpipeLoading(false);
        }, 30_000);
        return () => clearTimeout(timer);
    }, [screenpipeLoading]);

    // Build screenpipe config from latest settings store
    const buildScreenpipeConfig = useCallback(() => {
        const s = useSettingsStore.getState().settings;
        const hasDeepgram = !!s.deepgramApiKey;
        const inputEnabled = !s.muteInput;
        const outputEnabled = !s.muteOutput;
        const hasRealtimeAudio = hasDeepgram && ((!!s.audioDevice && inputEnabled) || (!!s.outputDevice && outputEnabled));
        return {
            ...(s.audioDevice && inputEnabled && { audio_device: s.audioDevice }),
            ...(s.outputDevice && outputEnabled && { output_device: s.outputDevice }),
            enable_realtime: hasRealtimeAudio,
            ...(hasRealtimeAudio && s.audioDevice && inputEnabled && { realtime_audio_device: s.audioDevice }),
            ...(s.deepgramApiKey && { deepgram_api_key: s.deepgramApiKey }),
            disable_vision: !s.enableVision,
            audio_chunk_duration: 3,
            vad_sensitivity: "high",
        };
    }, []);

    // Start/stop handler (used in header button) — mode-aware
    const handleToggle = useCallback(async () => {
        if (!isTauri()) return;

        if (isLocalWhisper) {
            if (localWhisperRunning) {
                setLocalWhisperLoading(true);
                try {
                    await stopLocalTranscription();
                    setLocalWhisperRunning(false);
                } catch (err) {
                    console.error("Failed to stop local transcription:", err);
                } finally {
                    setLocalWhisperLoading(false);
                }
            } else {
                setLocalWhisperLoading(true);
                setScreenpipeError(null);
                try {
                    if (tauriRunning) {
                        await stopScreenpipe();
                    }
                    await startLocalTranscription(
                        settings.audioDevice,
                        settings.outputDevice,
                        undefined,
                        settings.localPreferGpu
                    );
                    setLocalWhisperRunning(true);
                    setIsLiveFeed(true);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    setScreenpipeError(message);
                } finally {
                    setLocalWhisperLoading(false);
                }
            }
        } else if (isDirectDeepgram) {
            if (directDeepgramRunning) {
                setDirectDeepgramLoading(true);
                try {
                    await stopDirectDeepgramTranscription();
                    setDirectDeepgramRunning(false);
                } catch (err) {
                    console.error("Failed to stop direct deepgram transcription:", err);
                } finally {
                    setDirectDeepgramLoading(false);
                }
            } else {
                if (!settings.deepgramApiKey) {
                    setScreenpipeError("Deepgram API key is required for Direct Deepgram mode.");
                    return;
                }
                setDirectDeepgramLoading(true);
                setScreenpipeError(null);
                try {
                    if (tauriRunning) {
                        await stopScreenpipe();
                    }
                    await startDirectDeepgramTranscription(
                        settings.deepgramApiKey,
                        settings.audioDevice,
                        settings.outputDevice,
                        settings.muteInput,
                        settings.muteOutput
                    );
                    setDirectDeepgramRunning(true);
                    setIsLiveFeed(true);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    setScreenpipeError(message);
                } finally {
                    setDirectDeepgramLoading(false);
                }
            }
        } else {
            const isStopping = connectionStatus === "connected";
            pendingActionRef.current = isStopping ? "stopping" : "starting";
            setPendingAction(isStopping ? "stopping" : "starting");
            setScreenpipeLoading(true);
            if (!isStopping) setScreenpipeError(null);
            try {
                if (isStopping) {
                    await stopScreenpipe();
                } else {
                    await startScreenpipe(buildScreenpipeConfig());
                }
            } catch (err) {
                pendingActionRef.current = null;
                setPendingAction(null);
                setScreenpipeLoading(false);
                const message = err instanceof Error ? err.message : String(err);
                setScreenpipeError(message);
            }
        }
    }, [isLocalWhisper, isDirectDeepgram, localWhisperRunning, directDeepgramRunning, connectionStatus, tauriRunning, buildScreenpipeConfig, settings.deepgramApiKey, settings.audioDevice, settings.outputDevice, settings.muteInput, settings.muteOutput, settings.localPreferGpu]);

    // Apply Screenpipe capture changes live (mute/device) without manual stop/start.
    useEffect(() => {
        if (!isTauri()) return;
        if (isLocalWhisper || isDirectDeepgram) return;
        if (!tauriRunning) return;
        const timer = setTimeout(() => {
            updateScreenpipeConfig(buildScreenpipeConfig()).catch((err) => {
                console.error("Failed to live-update screenpipe config:", err);
            });
        }, 120);
        return () => clearTimeout(timer);
    }, [
        isLocalWhisper,
        isDirectDeepgram,
        tauriRunning,
        buildScreenpipeConfig,
        settings.audioDevice,
        settings.outputDevice,
        settings.muteInput,
        settings.muteOutput,
        settings.deepgramApiKey,
        settings.enableVision,
    ]);

    // Unified keyboard shortcuts (browser keydown + Tauri OS-level)
    useShortcutManager({
        onAnalyze: useCallback(() => setTriggerCount((c) => c + 1), []),
        onClear: useCallback(() => setClearCount((c) => c + 1), []),
        onSettingsPanel: useCallback(() => setSettingsOpen((o) => !o), []),
    });

    const providers = useMemo(
        () => configuredProviders(),
        [configuredProviders, settings.apiKeys]
    );

    const isLoading = isLocalWhisper
        ? localWhisperLoading
        : isDirectDeepgram
            ? directDeepgramLoading
            : screenpipeLoading;

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
                ? "Connecting"
                : "Offline";

    const livePolling = isLiveFeed && (
        (isLocalWhisper && localWhisperRunning) ||
        (isDirectDeepgram && directDeepgramRunning) ||
        (!isLocalWhisper && !isDirectDeepgram && feed.isPolling)
    );

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

    const inputActive = livePolling && activityNowMs - audioActivity.lastInputMs < 1200;
    const outputActive = livePolling && activityNowMs - audioActivity.lastOutputMs < 1200;
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
                    {mounted && isTauri() && !isLocalWhisper && !isDirectDeepgram && screenpipeInstalled === false && !installing ? (
                        <div className="flex items-center gap-1.5">
                            <span className="size-1.5 rounded-full bg-destructive" />
                            <span className="text-[10px] text-muted-foreground tracking-wide uppercase">
                                Not Installed
                            </span>
                        </div>
                    ) : mounted && isTauri() && installing ? (
                        <div className="flex items-center gap-1.5">
                            <CircleNotch weight="bold" className="size-3 text-primary animate-spin" />
                            <span className="text-[10px] text-muted-foreground tracking-wide uppercase">
                                Installing
                            </span>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 min-w-0">
                            <span className={cn("size-1.5 rounded-full transition-colors shrink-0", statusDotClass)} />
                            <span className="text-[10px] text-muted-foreground tracking-wide uppercase shrink-0">
                                {statusLabel}
                            </span>
                            {connectionStatus === "disconnected" && screenpipeError && (
                                <span className="text-[10px] text-destructive truncate max-w-[280px]" title={screenpipeError}>
                                    {screenpipeError}
                                </span>
                            )}
                        </div>
                    )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5">
                    {mounted && isTauri() && (
                        <div className="flex items-center gap-1.5 mr-1">
                            <button
                                type="button"
                                onClick={() => setSettings({ ...settings, muteInput: !settings.muteInput })}
                                className={cn(
                                    "inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-[0.08em] transition-colors",
                                    pillClass(inputState, "you")
                                )}
                                title={`You ${shortState(inputState)} • click to ${settings.muteInput ? "unmute" : "mute"}`}
                            >
                                <span className={cn("size-1.5 rounded-full", dotClass(inputState))} />
                                <span className="font-medium">You</span>
                                <span className="text-[9px] opacity-80">{shortState(inputState)}</span>
                                {settings.muteInput ? (
                                    <MicrophoneSlash weight="fill" className="size-3" />
                                ) : (
                                    <Microphone weight="fill" className="size-3" />
                                )}
                            </button>
                            <button
                                type="button"
                                onClick={() => setSettings({ ...settings, muteOutput: !settings.muteOutput })}
                                className={cn(
                                    "inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] uppercase tracking-[0.08em] transition-colors",
                                    pillClass(outputState, "them")
                                )}
                                title={`Them ${shortState(outputState)} • click to ${settings.muteOutput ? "unmute" : "mute"}`}
                            >
                                <span className={cn("size-1.5 rounded-full", dotClass(outputState))} />
                                <span className="font-medium">Them</span>
                                <span className="text-[9px] opacity-80">{shortState(outputState)}</span>
                                {settings.muteOutput ? (
                                    <SpeakerSlash weight="fill" className="size-3" />
                                ) : (
                                    <SpeakerHigh weight="fill" className="size-3" />
                                )}
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
                    {!mounted ? null : isTauri() && !isLocalWhisper && !isDirectDeepgram && screenpipeInstalled === false && !installing ? (
                        <Button
                            variant="outline"
                            size="xs"
                            onClick={handleInstallScreenpipe}
                            className="gap-1"
                        >
                            <Download weight="bold" className="size-3" />
                            Install
                        </Button>
                    ) : isTauri() && !isLocalWhisper && !isDirectDeepgram && installing ? (
                        <div className="flex items-center gap-2 px-2">
                            {installProgress && (
                                <>
                                    <div className="w-20 h-1 bg-muted overflow-hidden">
                                        <div
                                            className="h-full bg-primary transition-all duration-300"
                                            style={{ width: `${installProgress.percent}%` }}
                                        />
                                    </div>
                                    <span className="text-[10px] text-muted-foreground tabular-nums">
                                        {installProgress.percent}%
                                    </span>
                                </>
                            )}
                        </div>
                    ) : isTauri() ? (
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
                    ) : (
                        <>
                            <Button
                                variant="outline"
                                size="xs"
                                onClick={() => health.refetch()}
                                disabled={connectionStatus === "checking"}
                            >
                                {connectionStatus === "checking" ? (
                                    <CircleNotch weight="bold" className="size-3 animate-spin" />
                                ) : "Test"}
                            </Button>
                            {connectionStatus === "disconnected" && (
                                <a
                                    href="https://docs.screenpi.pe/getting-started"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
                                >
                                    Setup
                                    <ArrowSquareOut weight="bold" className="size-2.5" />
                                </a>
                            )}
                        </>
                    )}

                    <div className="w-px h-4 bg-border" />

                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => setSettingsOpen((o) => !o)}
                        className="text-muted-foreground hover:text-foreground"
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
                        statusMessage={screenpipeError || tauriScreenpipeStatus?.message}
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
