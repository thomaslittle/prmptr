"use client";

import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { LLMProvider, AppSettings, ShortcutAction, DEFAULT_SHORTCUTS } from "@/lib/types";
import { LOCAL_SHERPA_TTS_ENDPOINT, playTtsUrl, synthesizeTts } from "@/lib/tts-client";
import {
    validateApiKey,
    fetchLmstudioModels,
    isTauri,
    listSystemAudioDevices,
    listTtsVoicesViaTauri,
    getLocalTranscriptionGpuStatus,
    LocalGpuStatus,
    openExternalUrl,
    isMoonshineModelInstalled,
    downloadMoonshineModel,
    onWhisperModelDownloadProgress,
} from "@/lib/tauri";
import type { WhisperModelDownloadProgress } from "@/lib/tauri";
import {
    Eye,
    EyeSlash,
    Info,
    SpeakerHigh,
    SpeakerSlash,
    Microphone,
    MicrophoneSlash,
    Waveform,
    Key,
    Keyboard,
    CircleNotch,
    CheckCircle,
    XCircle,
    ArrowCounterClockwise,
    Plug,
    Globe,
    MicrophoneStage,
    Monitor,
} from "@phosphor-icons/react";
import ShortcutRecorder from "@/components/shortcut-recorder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { db, getPreference, setPreference } from "@/lib/db";
import { useCliSubscriptions } from "@/lib/use-cli-subscriptions";
import { CLI_SUBSCRIPTIONS } from "@/lib/cli-providers";

const SETTINGS_TAB_KEY = "settings-tab";
const SETTINGS_TABS = ["capture", "providers", "voice", "shortcuts"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];

type CloudProvider = Exclude<LLMProvider, "lmstudio">;

const cloudProviders: { key: CloudProvider; label: string }[] = [
    { key: "anthropic", label: "Anthropic" },
    { key: "openai", label: "OpenAI" },
    { key: "groq", label: "Groq" },
    { key: "cerebras", label: "Cerebras" },
    { key: "zen", label: "OpenCode Zen" },
];
const ttsModels = [
    { value: "model", label: "model (fp32)" },
    { value: "model_q4", label: "model_q4 (4-bit matmul)" },
    { value: "model_uint8", label: "model_uint8 (8-bit mixed precision)" },
    { value: "model_fp16", label: "model_fp16 (fp16)" },
    { value: "model_q4f16", label: "model_q4f16 (4-bit matmul + fp16)" },
    { value: "model_uint8f16", label: "model_uint8f16 (mixed precision)" },
    { value: "model_quantized", label: "model_quantized (8-bit)" },
    { value: "model_q8f16", label: "model_q8f16 (mixed precision)" },
];

function titleCaseLabel(s: string): string {
    return s
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function regionFromVoiceId(id: string): string {
    const m = id.match(/^([a-z])[fm]_/i);
    const tier = m?.[1]?.toLowerCase();
    if (tier === "a") return "en-US";
    if (tier === "b") return "en-GB";
    return "other";
}

function regionLabel(id: string): string {
    if (id === "en-US") return "English (US)";
    if (id === "en-GB") return "English (UK)";
    return "Other";
}

function formatVoiceLabel(id: string): string {
    const m = id.match(/^([a-z])([fm])_(.+)$/i);
    if (!m) return titleCaseLabel(id);
    const tier = m[1].toUpperCase();
    const sign = m[2].toLowerCase() === "f" ? "-" : "+";
    const name = titleCaseLabel(m[3]);
    return `${name} (${tier}${sign})`;
}

function normalizeTtsModelValue(model?: string): string {
    const value = (model || "").trim();
    if (!value) return "model";
    if (value === "kokoro" || value === "kokoro-82m") return "model";
    if (value === "kokoro-tts") return "model_q4";
    return value;
}

interface SettingsPanelProps {
    settings: AppSettings;
    onChange: (settings: AppSettings) => void;
    connectionStatus: "connected" | "disconnected" | "checking";
    statusMessage?: string;
}

function SectionLabel({
    icon: Icon,
    label,
}: {
    icon: React.ComponentType<{ className?: string; weight?: "bold" | "regular" | "fill" }>;
    label: string;
}) {
    return (
        <div className="flex items-center gap-2 mb-3">
            <div className="size-6 rounded-sm bg-muted/60 flex items-center justify-center shrink-0">
                <Icon weight="bold" className="size-3.5 text-muted-foreground" />
            </div>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground/80">
                {label}
            </span>
        </div>
    );
}

function SectionCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
    return (
        <div className={`rounded-sm border border-border bg-muted/20 p-4 ${className}`}>
            {children}
        </div>
    );
}

export default memo(function SettingsPanel({
    settings,
    onChange,
    connectionStatus,
    statusMessage,
}: SettingsPanelProps) {
    const [activeTab, setActiveTab] = useState<SettingsTab>("capture");
    const cliSubsQuery = useCliSubscriptions();
    const cliDetected = (cliSubsQuery.data ?? []).filter((s) => s.detected);

    useEffect(() => {
        getPreference(SETTINGS_TAB_KEY).then((saved) => {
            if (saved && SETTINGS_TABS.includes(saved as SettingsTab)) {
                setActiveTab(saved as SettingsTab);
            }
        });
    }, []);

    const handleTabChange = useCallback((value: string | null) => {
        if (value && SETTINGS_TABS.includes(value as SettingsTab)) {
            setActiveTab(value as SettingsTab);
            setPreference(SETTINGS_TAB_KEY, value);
        }
    }, []);

    const [apiKeyTest, setApiKeyTest] = useState<{
        provider: CloudProvider;
        status: "idle" | "testing" | "success" | "error";
        message?: string;
    } | null>(null);

    const [showKeys, setShowKeys] = useState<Record<string, boolean>>({
        anthropic: false,
        openai: false,
        groq: false,
        cerebras: false,
        zen: false,
    });

    const [showDeepgramKey, setShowDeepgramKey] = useState(false);
    const [showTtsKey, setShowTtsKey] = useState(false);
    const [localGpuStatus, setLocalGpuStatus] = useState<LocalGpuStatus | null>(null);
    const [checkingGpuStatus, setCheckingGpuStatus] = useState(false);
    const [moonshineInstalled, setMoonshineInstalled] = useState(false);
    const [moonshineDownloading, setMoonshineDownloading] = useState(false);
    const [moonshineProgress, setMoonshineProgress] = useState<WhisperModelDownloadProgress | null>(null);

    const [lmStudioStatus, setLmStudioStatus] = useState<"idle" | "testing" | "connected" | "error">("idle");
    const [testingVoice, setTestingVoice] = useState(false);
    const [voiceTestError, setVoiceTestError] = useState<string | null>(null);
    const [availableTtsVoices, setAvailableTtsVoices] = useState<string[]>([]);
    const audioDevicesQuery = useQuery({
        queryKey: ["system-audio-devices"],
        queryFn: async () => listSystemAudioDevices(),
        enabled: isTauri(),
        staleTime: 60_000,
        gcTime: 10 * 60_000,
        refetchOnWindowFocus: false,
    });
    const audioDevices = audioDevicesQuery.data ?? [];
    const audioDevicesLoading = audioDevicesQuery.isLoading || audioDevicesQuery.isFetching;
    const inputDevices = audioDevices
        .filter((d) => d.name.endsWith(" (input)"))
        .filter((d, i, arr) => arr.findIndex((x) => x.name === d.name) === i);
    const outputDevices = audioDevices
        .filter((d, i, arr) => arr.findIndex((x) => x.name === d.name) === i);

    // Auto-select default audio input once devices are loaded.
    useEffect(() => {
        if (!isTauri()) return;
        if (settings.audioDevice) return;
        if (audioDevices.length === 0) return;
        const inputOnly = audioDevices.filter((d) => d.name.endsWith(" (input)"));
        const defaultDevice = inputOnly.find((d) => d.is_default) || inputOnly[0];
        if (!defaultDevice) return;
        onChange({ ...settings, audioDevice: defaultDevice.name });
    }, [audioDevices, settings, onChange]);

    // Always use listSystemAudioDevices to stay aligned with Screenpipe device names.

    const testApiKey = useCallback(
        async (provider: CloudProvider) => {
            const key = settings.apiKeys[provider];
            if (!key) return;

            setApiKeyTest({ provider, status: "testing" });

            try {
                const valid = await validateApiKey(provider, key);
                setApiKeyTest({
                    provider,
                    status: valid ? "success" : "error",
                    message: valid ? "Valid" : "Invalid key",
                });
            } catch {
                setApiKeyTest({
                    provider,
                    status: "error",
                    message: "Connection failed",
                });
            }
        },
        [settings.apiKeys]
    );

    const testLmStudio = useCallback(async () => {
        setLmStudioStatus("testing");
        try {
            const models = await fetchLmstudioModels(settings.lmstudioUrl);
            setLmStudioStatus(models.length > 0 ? "connected" : "error");
        } catch {
            setLmStudioStatus("error");
        }
    }, [settings.lmstudioUrl]);

    const refreshGpuStatus = useCallback(async () => {
        if (!isTauri()) return;
        setCheckingGpuStatus(true);
        try {
            const status = await getLocalTranscriptionGpuStatus();
            setLocalGpuStatus(status);
        } catch {
            setLocalGpuStatus(null);
        } finally {
            setCheckingGpuStatus(false);
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            refreshGpuStatus().catch(() => {});
        }, 0);
        return () => clearTimeout(timer);
    }, [refreshGpuStatus]);

    // Moonshine model install state + download progress subscription
    useEffect(() => {
        if (!isTauri()) return;
        let alive = true;
        isMoonshineModelInstalled()
            .then((installed) => {
                if (alive) setMoonshineInstalled(installed);
            })
            .catch(() => {});
        let unlisten: (() => void) | null = null;
        onWhisperModelDownloadProgress((progress) => {
            if (progress.model_id !== "moonshine-base") return;
            setMoonshineProgress(progress);
            if (progress.percent >= 100 || progress.stage === "Done") {
                setMoonshineInstalled(true);
                setMoonshineDownloading(false);
            }
        }).then((fn) => (unlisten = fn));
        return () => {
            alive = false;
            unlisten?.();
        };
    }, []);

    const fallbackVoiceIds = useMemo(
        () => ["af_heart", "af_bella", "af_nova", "am_adam", "am_michael", "bf_emma", "bm_george"],
        []
    );
    const effectiveVoiceIds = availableTtsVoices.length > 0 ? availableTtsVoices : fallbackVoiceIds;

    const ttsRegionCatalog = useMemo(() => {
        const grouped: Record<string, { label: string; voices: Array<{ id: string; label: string }> }> = {};
        for (const id of effectiveVoiceIds) {
            const region = regionFromVoiceId(id);
            if (!grouped[region]) {
                grouped[region] = { label: regionLabel(region), voices: [] };
            }
            grouped[region].voices.push({ id, label: formatVoiceLabel(id) });
        }
        for (const key of Object.keys(grouped)) {
            grouped[key].voices.sort((a, b) => a.label.localeCompare(b.label));
        }
        if (!grouped["en-US"]) grouped["en-US"] = { label: "English (US)", voices: [] };
        return grouped;
    }, [effectiveVoiceIds]);

    const regionOptions = Object.entries(ttsRegionCatalog);
    const selectedRegion = settings.ttsRegion && ttsRegionCatalog[settings.ttsRegion]
        ? settings.ttsRegion
        : regionOptions[0]?.[0] ?? "en-US";
    const voicesForRegion = useMemo(
        () => ttsRegionCatalog[selectedRegion]?.voices ?? [],
        [ttsRegionCatalog, selectedRegion]
    );
    const selectedTtsModel = normalizeTtsModelValue(settings.ttsModel);
    const effectiveTtsEndpoint =
        settings.ttsProvider === "local-sherpa"
            ? LOCAL_SHERPA_TTS_ENDPOINT
            : (settings.ttsEndpoint?.trim() || "");
    const activeTestAudioRef = useRef<HTMLAudioElement | null>(null);
    const activeTestUrlRef = useRef<string | null>(null);

    const handleTestVoice = useCallback(async () => {
        if (!effectiveTtsEndpoint) {
            setVoiceTestError("Set a TTS endpoint first.");
            return;
        }
        setTestingVoice(true);
        setVoiceTestError(null);
        try {
            if (activeTestAudioRef.current) {
                activeTestAudioRef.current.pause();
                activeTestAudioRef.current = null;
            }
            if (activeTestUrlRef.current?.startsWith("blob:")) {
                URL.revokeObjectURL(activeTestUrlRef.current);
                activeTestUrlRef.current = null;
            }

            const url = await synthesizeTts(
                effectiveTtsEndpoint,
                "Radio check, voice test successful. This is your AI character speaking.",
                settings.ttsVoice,
                selectedTtsModel,
                settings.ttsRate,
                settings.ttsApiKey
            );
            activeTestUrlRef.current = url;
            const audio = await playTtsUrl(url, {
                volume: settings.ttsVolume,
                playbackRate: settings.ttsRate,
            });
            activeTestAudioRef.current = audio;
            audio.onended = () => {
                if (activeTestUrlRef.current?.startsWith("blob:")) {
                    URL.revokeObjectURL(activeTestUrlRef.current);
                }
                activeTestAudioRef.current = null;
                activeTestUrlRef.current = null;
            };
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            setVoiceTestError(msg);
        } finally {
            setTestingVoice(false);
        }
    }, [effectiveTtsEndpoint, settings.ttsVoice, selectedTtsModel, settings.ttsRate, settings.ttsVolume, settings.ttsApiKey]);

    useEffect(() => {
        return () => {
            if (activeTestAudioRef.current) {
                activeTestAudioRef.current.pause();
                activeTestAudioRef.current = null;
            }
            if (activeTestUrlRef.current?.startsWith("blob:")) {
                URL.revokeObjectURL(activeTestUrlRef.current);
                activeTestUrlRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!isTauri()) return;
        if (!effectiveTtsEndpoint) return;
        listTtsVoicesViaTauri(effectiveTtsEndpoint, settings.ttsApiKey)
            .then((voices) => {
                if (voices.length > 0) {
                    setAvailableTtsVoices(voices);
                }
            })
            .catch(() => {
                setAvailableTtsVoices([]);
            });
    }, [effectiveTtsEndpoint, settings.ttsApiKey]);

    useEffect(() => {
        if (!settings.voiceReplyEnabled) return;
        const inRegion = voicesForRegion.some((v) => v.id === settings.ttsVoice);
        if (!inRegion) {
            onChange({
                ...settings,
                ttsRegion: selectedRegion,
                ttsVoice: voicesForRegion[0]?.id ?? "af_heart",
            });
        }
    }, [settings, onChange, voicesForRegion, selectedRegion]);

    return (
        <div className="flex-1 overflow-y-auto min-h-0 p-5">
            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="w-full justify-start rounded-none border-0 bg-transparent p-0 h-auto gap-0">
                    <TabsTrigger value="capture" className="rounded-none border-b-2 border-transparent data-active:border-primary">
                        Capture & Voice
                    </TabsTrigger>
                    <TabsTrigger value="providers" className="rounded-none border-b-2 border-transparent data-active:border-primary">
                        Providers & Models
                    </TabsTrigger>
                    <TabsTrigger value="voice" className="rounded-none border-b-2 border-transparent data-active:border-primary">
                        TTS
                    </TabsTrigger>
                    <TabsTrigger value="shortcuts" className="rounded-none border-b-2 border-transparent data-active:border-primary">
                        Shortcuts
                    </TabsTrigger>
                </TabsList>
                <TabsContent value="capture" className="mt-4 space-y-5 overflow-y-auto min-h-0">
                    {/* Audio Devices (Tauri only) */}
                    {isTauri() && (
                        <SectionCard>
                            <div className="flex items-center justify-between mb-3">
                                <SectionLabel icon={SpeakerHigh} label="Audio Devices" />
                                <Button
                                    variant="outline"
                                    size="xs"
                                    className="h-6 px-2 text-[10px]"
                                    onClick={() => audioDevicesQuery.refetch()}
                                    disabled={audioDevicesLoading}
                                >
                                    {audioDevicesLoading ? (
                                        <CircleNotch weight="bold" className="size-3 animate-spin" />
                                    ) : (
                                        <ArrowCounterClockwise weight="bold" className="size-3" />
                                    )}
                                </Button>
                            </div>
                            {audioDevices.length > 0 ? (
                                <div className="space-y-2.5">
                                    {/* Input device (You) */}
                                    <div>
                                        <span className="text-[10px] text-foreground/60 font-medium mb-1 block">
                                            Input — You
                                        </span>
                                        <div className="flex gap-1.5 items-center">
                                            <Select
                                                value={settings.audioDevice ?? ""}
                                                onValueChange={(value) =>
                                                    onChange({ ...settings, audioDevice: value as string })
                                                }
                                            >
                                                <SelectTrigger size="sm" className="flex-1 text-xs min-w-0">
                                                    <SelectValue placeholder="Select input device" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {inputDevices.map((device) => (
                                                        <SelectItem key={device.name} value={device.name}>
                                                            {device.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Tooltip>
                                                <TooltipTrigger
                                                    render={
                                                        <Button
                                                            size="icon-xs"
                                                            variant={settings.muteInput ? "destructive" : "outline"}
                                                            onClick={() =>
                                                                onChange({ ...settings, muteInput: !settings.muteInput })
                                                            }
                                                            aria-label={settings.muteInput ? "Unmute input" : "Mute input"}
                                                        >
                                                            {settings.muteInput ? (
                                                                <MicrophoneSlash weight="bold" className="size-3.5" />
                                                            ) : (
                                                                <Microphone weight="bold" className="size-3.5" />
                                                            )}
                                                        </Button>
                                                    }
                                                />
                                                <TooltipContent>
                                                    {settings.muteInput ? "Unmute input" : "Mute input"}
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                    </div>

                                    {/* Output device (Them) */}
                                    <div>
                                        <span className="text-[10px] text-foreground/60 font-medium mb-1 block">
                                            Output — Them
                                        </span>
                                        <div className="flex gap-1.5 items-center">
                                            <Select
                                                value={settings.outputDevice ?? ""}
                                                onValueChange={(value) =>
                                                    onChange({ ...settings, outputDevice: value as string })
                                                }
                                            >
                                                <SelectTrigger size="sm" className="flex-1 text-xs min-w-0">
                                                    <SelectValue placeholder="Select output device" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {outputDevices.map((device) => (
                                                        <SelectItem key={device.name} value={device.name}>
                                                            {device.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Tooltip>
                                                <TooltipTrigger
                                                    render={
                                                        <Button
                                                            size="icon-xs"
                                                            variant={settings.muteOutput ? "destructive" : "outline"}
                                                            onClick={() =>
                                                                onChange({ ...settings, muteOutput: !settings.muteOutput })
                                                            }
                                                            aria-label={settings.muteOutput ? "Unmute output" : "Mute output"}
                                                        >
                                                            {settings.muteOutput ? (
                                                                <SpeakerSlash weight="bold" className="size-3.5" />
                                                            ) : (
                                                                <SpeakerHigh weight="bold" className="size-3.5" />
                                                            )}
                                                        </Button>
                                                    }
                                                />
                                                <TooltipContent>
                                                    {settings.muteOutput ? "Unmute output" : "Mute output"}
                                                </TooltipContent>
                                            </Tooltip>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div className="h-8 border border-border bg-muted/30 animate-pulse" />
                                    <div className="h-8 border border-border bg-muted/30 animate-pulse" />
                                    <p className="text-[10px] text-muted-foreground/60">
                                        {audioDevicesLoading ? "Loading system audio devices..." : "No audio devices found"}
                                    </p>
                                </div>
                            )}
                            {statusMessage && connectionStatus === "disconnected" && !statusMessage.startsWith("Connection failed") && (
                                <p className="text-[10px] text-destructive mt-1.5">
                                    {statusMessage}
                                </p>
                            )}
                        </SectionCard>
                    )}

                    {/* Transcription (Tauri only) */}
                    {isTauri() && (
                        <SectionCard>
                            <SectionLabel icon={Waveform} label="Transcription" />
                            <div className="space-y-3">
                                <div>
                                    <span className="text-[10px] text-foreground/60 font-medium mb-1.5 block">
                                        Mode
                                    </span>
                                    <div className="flex gap-1">
                                        <Button
                                            variant={(settings.transcriptionMode ?? "local-whisper") === "local-whisper" ? "default" : "outline"}
                                            size="xs"
                                            className="flex-1 text-[10px]"
                                            onClick={() => onChange({ ...settings, transcriptionMode: "local-whisper" })}
                                        >
                                            Local (Free)
                                        </Button>
                                        <Button
                                            variant={(settings.transcriptionMode ?? "local-whisper") === "direct-deepgram" ? "default" : "outline"}
                                            size="xs"
                                            className="flex-1 text-[10px]"
                                            onClick={() => onChange({ ...settings, transcriptionMode: "direct-deepgram" })}
                                        >
                                            Direct Deepgram
                                        </Button>
                                        <Button
                                            variant={(settings.transcriptionMode ?? "local-whisper") === "screenpipe" ? "default" : "outline"}
                                            size="xs"
                                            className="flex-1 text-[10px]"
                                            onClick={() => onChange({ ...settings, transcriptionMode: "screenpipe" })}
                                        >
                                            Screenpipe + Deepgram
                                        </Button>
                                    </div>
                                </div>

                                {(settings.transcriptionMode ?? "direct-deepgram") !== "local-whisper" ? (
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-[11px] text-foreground/70 font-medium">
                                                Deepgram API Key
                                                <span className="text-destructive ml-0.5">*</span>
                                            </span>
                                        </div>
                                        <InputGroup className="h-8 text-xs">
                                            <InputGroupInput
                                                type={showDeepgramKey ? "text" : "password"}
                                                placeholder="Deepgram API key (required for realtime)..."
                                                className="pr-8"
                                                value={settings.deepgramApiKey || ""}
                                                onChange={(e) =>
                                                    onChange({ ...settings, deepgramApiKey: e.target.value })
                                                }
                                            />
                                            <InputGroupAddon align="inline-end">
                                                <InputGroupButton
                                                    size="icon-xs"
                                                    variant="ghost"
                                                    onClick={() => setShowDeepgramKey((prev) => !prev)}
                                                    className="text-muted-foreground hover:text-foreground"
                                                    aria-label={showDeepgramKey ? "Hide key" : "Show key"}
                                                >
                                                    {showDeepgramKey ? <EyeSlash weight="bold" className="size-3" /> : <Eye weight="bold" className="size-3" />}
                                                </InputGroupButton>
                                            </InputGroupAddon>
                                        </InputGroup>
                                        {!settings.deepgramApiKey && (
                                            <p className="text-[10px] text-destructive/80">
                                                Deepgram API key is required.
                                            </p>
                                        )}
                                        <p className="text-[9px] text-muted-foreground/50 mt-0.5">
                                            {(settings.transcriptionMode ?? "direct-deepgram") === "screenpipe"
                                                ? "Uses Screenpipe realtime routing with Deepgram."
                                                : "Uses app-native dual capture routed directly to Deepgram."}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="space-y-1.5">
                                        <p className="text-[9px] text-muted-foreground/50">
                                            On-device transcription — free and private. Nothing leaves your machine.
                                        </p>

                                        {/* Engine picker: Whisper vs Moonshine */}
                                        <div>
                                            <span className="text-[10px] text-foreground/60 font-medium mb-1 block">
                                                Engine
                                            </span>
                                            <div className="flex gap-1">
                                                <Button
                                                    variant={(settings.localSttEngine ?? "whisper") === "whisper" ? "default" : "outline"}
                                                    size="xs"
                                                    className="flex-1 text-[10px]"
                                                    onClick={() => onChange({ ...settings, localSttEngine: "whisper" })}
                                                >
                                                    Whisper
                                                </Button>
                                                <Button
                                                    variant={settings.localSttEngine === "moonshine" ? "default" : "outline"}
                                                    size="xs"
                                                    className="flex-1 text-[10px]"
                                                    disabled={!moonshineInstalled && !moonshineDownloading}
                                                    onClick={() =>
                                                        onChange({
                                                            ...settings,
                                                            localSttEngine: moonshineInstalled ? "moonshine" : settings.localSttEngine,
                                                        })
                                                    }
                                                >
                                                    {settings.localSttEngine === "moonshine" ? "Moonshine ✓" : "Moonshine"}
                                                </Button>
                                            </div>
                                            {settings.localSttEngine === "moonshine" ? (
                                                <p className="text-[9px] text-muted-foreground/50 mt-1">
                                                    Moonshine base (int8): ~6× lower latency than Whisper, MIT licensed.
                                                </p>
                                            ) : null}
                                            {!moonshineInstalled && (
                                                <div className="mt-1.5 rounded-sm border border-border bg-background/40 p-2 space-y-1.5">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="text-[10px] text-foreground/70">
                                                            Moonshine model (~240 MB, one-time download)
                                                        </span>
                                                        <Button
                                                            size="xs"
                                                            variant={moonshineInstalled ? "outline" : "default"}
                                                            disabled={moonshineDownloading}
                                                            onClick={() => {
                                                                setMoonshineDownloading(true);
                                                                setMoonshineProgress(null);
                                                                downloadMoonshineModel()
                                                                    .then(() => {
                                                                        setMoonshineInstalled(true);
                                                                        onChange({ ...settings, localSttEngine: "moonshine" });
                                                                    })
                                                                    .catch((err) =>
                                                                        console.error("Moonshine download failed:", err)
                                                                    )
                                                                    .finally(() => setMoonshineDownloading(false));
                                                            }}
                                                        >
                                                            {moonshineInstalled
                                                                ? "Re-download"
                                                                : moonshineDownloading
                                                                    ? `${moonshineProgress?.stage ?? "Working"}${moonshineProgress?.percent ? ` ${moonshineProgress.percent}%` : "..."}`
                                                                    : "Download"}
                                                        </Button>
                                                    </div>
                                                    {moonshineDownloading && moonshineProgress?.total_bytes ? (
                                                        <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                                                            <div
                                                                className="h-full bg-primary transition-[width]"
                                                                style={{ width: `${Math.min(100, moonshineProgress.percent)}%` }}
                                                            />
                                                        </div>
                                                    ) : null}
                                                </div>
                                            )}
                                        </div>

                                        <div className="rounded-sm border border-border bg-background/40 p-2">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="flex items-center gap-1.5">
                                                    <span className="text-[10px] text-foreground/70">Use GPU for local transcription</span>
                                                    {!localGpuStatus?.can_use_gpu && (
                                                        <Tooltip>
                                                            <TooltipTrigger
                                                                render={
                                                                    <button
                                                                        type="button"
                                                                        className="inline-flex size-4.5 items-center justify-center rounded-full border border-border/70 bg-background/60 text-muted-foreground transition-colors hover:border-sky-400/40 hover:bg-background hover:text-sky-300"
                                                                        aria-label="Why GPU is disabled"
                                                                    >
                                                                        <Info weight="bold" className="size-3" />
                                                                    </button>
                                                                }
                                                            />
                                                            <TooltipContent
                                                                variant="popover"
                                                                side="top"
                                                                align="start"
                                                                sideOffset={8}
                                                                className="max-w-[340px] rounded-md border border-border bg-popover/98 text-popover-foreground shadow-[0_14px_34px_-18px_rgba(56,189,248,0.55)] backdrop-blur-sm p-0"
                                                            >
                                                                <div className="px-3 py-2.5 border-b border-sky-300/10">
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className="size-1.5 rounded-full bg-amber-400" />
                                                                        <p className="text-[10px] font-semibold tracking-wide text-sky-200/95">
                                                                            GPU acceleration unavailable
                                                                        </p>
                                                                    </div>
                                                                    <p className="mt-1 text-[10px] leading-relaxed text-foreground/85">
                                                                        {localGpuStatus?.message ?? "Checking GPU/CUDA status..."}
                                                                    </p>
                                                                    {localGpuStatus?.cuda_toolkit_version && (
                                                                        <p className="mt-1 text-[9px] text-sky-300/70">
                                                                            Toolkit: {localGpuStatus.cuda_toolkit_version}
                                                                        </p>
                                                                    )}
                                                                    {localGpuStatus && (
                                                                        <div className="mt-2 grid grid-cols-3 gap-1 text-[9px]">
                                                                            <span className={`rounded px-1.5 py-0.5 border ${localGpuStatus.nvidia_gpu_detected ? "border-emerald-400/40 text-emerald-300" : "border-destructive/40 text-destructive/90"}`}>
                                                                                GPU: {localGpuStatus.nvidia_gpu_detected ? "yes" : "no"}
                                                                            </span>
                                                                            <span className={`rounded px-1.5 py-0.5 border ${localGpuStatus.cuda_toolkit_installed ? "border-emerald-400/40 text-emerald-300" : "border-amber-400/40 text-amber-300"}`}>
                                                                                Toolkit: {localGpuStatus.cuda_toolkit_installed ? "yes" : "no"}
                                                                            </span>
                                                                            <span className={`rounded px-1.5 py-0.5 border ${localGpuStatus.cuda_backend_available ? "border-emerald-400/40 text-emerald-300" : "border-destructive/40 text-destructive/90"}`}>
                                                                                Backend: {localGpuStatus.cuda_backend_available ? "yes" : "no"}
                                                                            </span>
                                                                        </div>
                                                                    )}
                                                                    {/* Actionable setup hints from the detector */}
                                                                    {!!localGpuStatus?.hints?.length && (
                                                                        <ul className="mt-2 space-y-1 list-disc pl-3.5">
                                                                            {localGpuStatus.hints.map((hint, i) => (
                                                                                <li key={hint.slice(0, 40) + i} className="text-[9px] leading-relaxed text-foreground/75">
                                                                                    {hint}
                                                                                </li>
                                                                            ))}
                                                                        </ul>
                                                                    )}
                                                                    <p className="mt-2 text-[9px] text-foreground/55">
                                                                        After installing the CUDA Toolkit or changing environment variables, fully close and reopen the app — env vars are only read at launch.
                                                                    </p>
                                                                </div>
                                                                <div className="px-3 py-2 flex items-center gap-2">
                                                                    <button
                                                                        type="button"
                                                                        className="inline-flex items-center rounded-sm border border-sky-300/40 bg-sky-400/10 px-2 py-1 text-[10px] font-medium text-sky-200 transition-colors hover:bg-sky-400/20 hover:text-sky-100"
                                                                        onClick={() =>
                                                                            openExternalUrl("https://developer.nvidia.com/cuda-downloads").catch((err) =>
                                                                                console.error("Failed to open CUDA link:", err)
                                                                            )
                                                                        }
                                                                    >
                                                                        Install CUDA Toolkit
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        className="inline-flex items-center rounded-sm border border-border bg-background/70 px-2 py-1 text-[10px] font-medium text-foreground/85 transition-colors hover:bg-background disabled:opacity-60"
                                                                        onClick={() => refreshGpuStatus().catch(() => {})}
                                                                        disabled={checkingGpuStatus}
                                                                    >
                                                                        {checkingGpuStatus ? "Checking..." : "Recheck detection"}
                                                                    </button>
                                                                </div>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    )}
                                                </div>
                                                <Button
                                                    size="xs"
                                                    variant={settings.localPreferGpu ? "default" : "outline"}
                                                    disabled={!localGpuStatus?.can_use_gpu}
                                                    onClick={() =>
                                                        onChange({
                                                            ...settings,
                                                            localPreferGpu: !settings.localPreferGpu,
                                                        })
                                                    }
                                                >
                                                    {settings.localPreferGpu ? "On" : "Off"}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </SectionCard>
                    )}

                    <SectionCard>
                        <SectionLabel icon={Monitor} label="Analyze Context" />
                        <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                                <p className="text-[11px] text-foreground/70 font-medium">Include screenshot on Analyze</p>
                                <p className="text-[9px] text-muted-foreground/60">
                                    Sends the latest screen frame with analysis requests for extra visual context.
                                </p>
                            </div>
                            <Button
                                size="xs"
                                variant={settings.includeScreenshotOnAnalyze ? "default" : "outline"}
                                onClick={() =>
                                    onChange({
                                        ...settings,
                                        includeScreenshotOnAnalyze: !settings.includeScreenshotOnAnalyze,
                                    })
                                }
                            >
                                {settings.includeScreenshotOnAnalyze ? "On" : "Off"}
                            </Button>
                        </div>
                    </SectionCard>

                    {/* Screenpipe URL (web mode only) */}
                    {!isTauri() && (
                        <SectionCard>
                            <SectionLabel icon={Globe} label="Activity Monitor URL" />
                            <Input
                                placeholder="http://localhost:3030"
                                className="text-xs"
                                value={settings.screenpipeUrl}
                                onChange={(e) =>
                                    onChange({ ...settings, screenpipeUrl: e.target.value })
                                }
                            />
                        </SectionCard>
                    )}
                </TabsContent>

                <TabsContent value="providers" className="mt-4 space-y-5 overflow-y-auto min-h-0">
                    {/* CLI Subscriptions (Claude Code / Codex / OpenCode) */}
                    <SectionCard>
                        <SectionLabel icon={Plug} label="CLI Subscriptions" />
                        {cliSubsQuery.isLoading ? (
                            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                <CircleNotch weight="bold" className="size-3 animate-spin" />
                                Detecting installed CLIs...
                            </div>
                        ) : cliDetected.length === 0 ? (
                            <div className="space-y-1.5">
                                <p className="text-[11px] text-muted-foreground/60">
                                    No AI coding CLIs detected. Install and log in to reuse your
                                    subscription here — no API key needed:
                                </p>
                                {CLI_SUBSCRIPTIONS.map((sub) => (
                                    <p key={sub.id} className="text-[10px] text-muted-foreground/50 font-mono pl-2">
                                        {sub.loginHint}
                                    </p>
                                ))}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {CLI_SUBSCRIPTIONS.map((meta) => {
                                    const status = cliSubsQuery.data?.find((s) => s.id === meta.id);
                                    const usable = !!status?.detected && !!status?.loggedIn;
                                    return (
                                        <div key={meta.id} className="flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                {usable ? (
                                                    <CheckCircle weight="fill" className="size-3 text-emerald-400 shrink-0" />
                                                ) : (
                                                    <XCircle weight="fill" className="size-3 text-muted-foreground/40 shrink-0" />
                                                )}
                                                <div className="min-w-0">
                                                    <span className={`text-[11px] font-medium block truncate ${usable ? "text-foreground/80" : "text-muted-foreground/60"}`}>
                                                        {status?.name ?? meta.name}
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground/50 block truncate">
                                                        {!status?.detected
                                                            ? "Not installed"
                                                            : !status?.loggedIn
                                                                ? (status.hint || "Not logged in")
                                                                : status.account || "Logged in"}
                                                    </span>
                                                </div>
                                            </div>
                                            {usable && (
                                                <Button
                                                    size="xs"
                                                    variant={(settings.cliSubscriptions?.[meta.id] ?? true) ? "default" : "outline"}
                                                    onClick={() =>
                                                        onChange({
                                                            ...settings,
                                                            cliSubscriptions: {
                                                                ...settings.cliSubscriptions,
                                                                [meta.id]: !(settings.cliSubscriptions?.[meta.id] ?? true),
                                                            },
                                                        })
                                                    }
                                                >
                                                    {(settings.cliSubscriptions?.[meta.id] ?? true) ? "On" : "Off"}
                                                </Button>
                                            )}
                                        </div>
                                    );
                                })}
                                <p className="text-[10px] text-muted-foreground/50">
                                    Detected subscriptions appear as model options. Credentials stay in each
                                    tool&apos;s own config — prmptr never stores them.
                                </p>
                            </div>
                        )}
                    </SectionCard>

                    {/* API Keys (cloud + Deepgram) */}
                    <SectionCard>
                        <SectionLabel icon={Key} label="API Keys" />
                        <div className="space-y-3">
                            {cloudProviders.map(({ key, label }) => (
                                <div key={key} className="space-y-1">
                                    <span className="text-[11px] text-foreground/70 font-medium">{label}</span>
                                    <InputGroup className="h-8 text-xs">
                                        <InputGroupInput
                                            type={showKeys[key] ? "text" : "password"}
                                            placeholder={`${label} key...`}
                                            className="pr-8"
                                            value={settings.apiKeys[key] || ""}
                                            onChange={(e) =>
                                                onChange({
                                                    ...settings,
                                                    apiKeys: { ...settings.apiKeys, [key]: e.target.value },
                                                })
                                            }
                                        />
                                        <InputGroupAddon align="inline-end">
                                            <InputGroupButton
                                                size="icon-xs"
                                                variant="ghost"
                                                onClick={() =>
                                                    setShowKeys((prev) => ({ ...prev, [key]: !prev[key] }))
                                                }
                                                className="text-muted-foreground hover:text-foreground"
                                                aria-label={showKeys[key] ? "Hide key" : "Show key"}
                                            >
                                                {showKeys[key] ? <EyeSlash weight="bold" className="size-3" /> : <Eye weight="bold" className="size-3" />}
                                            </InputGroupButton>
                                        </InputGroupAddon>
                                    </InputGroup>
                                    {settings.apiKeys[key] && (
                                        <div className="flex items-center justify-end gap-1.5 mt-0.5">
                                            {apiKeyTest?.provider === key &&
                                                apiKeyTest.status !== "idle" &&
                                                apiKeyTest.status !== "testing" && (
                                                    <div className="flex items-center gap-1">
                                                        {apiKeyTest.status === "success" ? (
                                                            <CheckCircle weight="fill" className="size-3 text-emerald-400" />
                                                        ) : (
                                                            <XCircle weight="fill" className="size-3 text-destructive" />
                                                        )}
                                                        <span className={`text-[10px] ${apiKeyTest.status === "success" ? "text-emerald-400" : "text-destructive"}`}>
                                                            {apiKeyTest.message}
                                                        </span>
                                                    </div>
                                                )}
                                            <Button
                                                variant="outline"
                                                size="xs"
                                                className="h-6 px-2.5 text-[10px] shrink-0"
                                                onClick={() => testApiKey(key)}
                                                disabled={
                                                    apiKeyTest?.provider === key &&
                                                    apiKeyTest.status === "testing"
                                                }
                                            >
                                                {apiKeyTest?.provider === key && apiKeyTest.status === "testing" ? (
                                                    <CircleNotch weight="bold" className="size-3 animate-spin" />
                                                ) : "Verify"}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </SectionCard>

                    {/* LM Studio (Local) */}
                    <SectionCard>
                        <SectionLabel icon={Plug} label="LM Studio" />
                        <InputGroup className="h-8 text-xs">
                            <InputGroupInput
                                placeholder="http://localhost:1234"
                                className="pr-16"
                                value={settings.lmstudioUrl}
                                onChange={(e) =>
                                    onChange({ ...settings, lmstudioUrl: e.target.value })
                                }
                            />
                            <InputGroupAddon align="inline-end">
                                <InputGroupButton
                                    variant="secondary"
                                    size="xs"
                                    onClick={testLmStudio}
                                    disabled={lmStudioStatus === "testing"}
                                >
                                    {lmStudioStatus === "testing" ? (
                                        <CircleNotch weight="bold" className="size-3 animate-spin" />
                                    ) : (
                                        "Test"
                                    )}
                                </InputGroupButton>
                            </InputGroupAddon>
                        </InputGroup>
                        {lmStudioStatus === "connected" && (
                            <div className="flex items-center gap-1 mt-1.5">
                                <CheckCircle weight="fill" className="size-3 text-emerald-400" />
                                <span className="text-[10px] text-emerald-400">Connected</span>
                            </div>
                        )}
                        {lmStudioStatus === "error" && (
                            <div className="flex items-center gap-1 mt-1.5">
                                <XCircle weight="fill" className="size-3 text-destructive" />
                                <span className="text-[10px] text-destructive">Unreachable</span>
                            </div>
                        )}
                        <p className="text-[10px] text-muted-foreground/50 mt-1.5">
                            Start LM Studio &rarr; Load model &rarr; Enable server
                        </p>
                    </SectionCard>

                </TabsContent>

                <TabsContent value="voice" className="mt-4 space-y-5 overflow-y-auto min-h-0">
                    <SectionCard>
                        <SectionLabel icon={MicrophoneStage} label="AI Voice Reply" />
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-[11px] text-foreground/70 font-medium">Enable voice output</span>
                                <Button
                                    size="xs"
                                    variant={settings.voiceReplyEnabled ? "default" : "outline"}
                                    onClick={() => onChange({ ...settings, voiceReplyEnabled: !settings.voiceReplyEnabled })}
                                >
                                    {settings.voiceReplyEnabled ? "On" : "Off"}
                                </Button>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-foreground/60 font-medium">Engine</span>
                                <Select
                                    value={settings.ttsProvider || "local-sherpa"}
                                    onValueChange={(value) =>
                                        onChange({
                                            ...settings,
                                            ttsProvider: (value as "local-sherpa" | "remote-http") ?? "local-sherpa",
                                        })
                                    }
                                >
                                    <SelectTrigger size="sm" className="w-full text-xs">
                                        <SelectValue placeholder="Select TTS engine" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="local-sherpa">Local Sherpa (Kokoro)</SelectItem>
                                        <SelectItem value="remote-http">Remote HTTP Endpoint</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            {settings.ttsProvider !== "local-sherpa" && (
                                <>
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-foreground/60 font-medium">TTS Endpoint</span>
                                        <Input
                                            placeholder="https://kokoro.zomlit.com"
                                            className="text-xs"
                                            value={settings.ttsEndpoint || ""}
                                            onChange={(e) => onChange({ ...settings, ttsEndpoint: e.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        <span className="text-[10px] text-foreground/60 font-medium">TTS API Key (optional)</span>
                                        <InputGroup className="h-8 text-xs">
                                            <InputGroupInput
                                                type={showTtsKey ? "text" : "password"}
                                                placeholder="Bearer / x-api-key"
                                                className="pr-8"
                                                value={settings.ttsApiKey || ""}
                                                onChange={(e) => onChange({ ...settings, ttsApiKey: e.target.value })}
                                            />
                                            <InputGroupAddon align="inline-end">
                                                <InputGroupButton
                                                    size="icon-xs"
                                                    variant="ghost"
                                                    onClick={() => setShowTtsKey((prev) => !prev)}
                                                    className="text-muted-foreground hover:text-foreground"
                                                    aria-label={showTtsKey ? "Hide key" : "Show key"}
                                                >
                                                    {showTtsKey ? <EyeSlash weight="bold" className="size-3" /> : <Eye weight="bold" className="size-3" />}
                                                </InputGroupButton>
                                            </InputGroupAddon>
                                        </InputGroup>
                                    </div>
                                </>
                            )}
                            {settings.ttsProvider === "local-sherpa" && (
                                <p className="text-[10px] text-muted-foreground/60">
                                    Uses bundled local Sherpa/Kokoro. First use downloads model files once.
                                </p>
                            )}
                            <div className="flex items-center justify-end">
                                <Button
                                    size="xs"
                                    variant="outline"
                                    onClick={() => handleTestVoice().catch(() => {})}
                                    disabled={testingVoice || !effectiveTtsEndpoint}
                                    className="gap-1.5"
                                >
                                    {testingVoice ? (
                                        <>
                                            <CircleNotch weight="bold" className="size-3 animate-spin" />
                                            Testing
                                        </>
                                    ) : (
                                        "Test Voice"
                                    )}
                                </Button>
                            </div>
                            {voiceTestError && (
                                <p className="text-[10px] text-destructive/90">{voiceTestError}</p>
                            )}
                            <div className="space-y-1">
                                <span className="text-[10px] text-foreground/60 font-medium">Language accent (region)</span>
                                <Select
                                    value={selectedRegion}
                                    onValueChange={(value) =>
                                        onChange({
                                            ...settings,
                                            ttsRegion: value ?? selectedRegion,
                                            ttsVoice: ttsRegionCatalog[(value ?? selectedRegion) as keyof typeof ttsRegionCatalog]?.voices[0]?.id ?? "af_heart",
                                        })
                                    }
                                >
                                    <SelectTrigger size="sm" className="w-full text-xs">
                                        <SelectValue placeholder="Select accent" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {regionOptions.map(([id, region]) => (
                                            <SelectItem key={id} value={id}>
                                                {region.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-foreground/60 font-medium">Voice</span>
                                <Select
                                    value={settings.ttsVoice || voicesForRegion[0]?.id || "af_heart"}
                                    onValueChange={(value) => onChange({ ...settings, ttsVoice: value ?? voicesForRegion[0]?.id ?? "af_heart" })}
                                >
                                    <SelectTrigger size="sm" className="w-full text-xs">
                                        <SelectValue placeholder="Select voice" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {voicesForRegion.map((voice) => (
                                            <SelectItem key={voice.id} value={voice.id}>
                                                {voice.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <span className="text-[10px] text-foreground/60 font-medium">Model</span>
                                <Select
                                    value={selectedTtsModel}
                                    onValueChange={(value) => onChange({ ...settings, ttsModel: value ?? "model" })}
                                >
                                    <SelectTrigger size="sm" className="w-full text-xs">
                                        <SelectValue placeholder="Select model" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {ttsModels.map((model) => (
                                            <SelectItem key={model.value} value={model.value}>
                                                {model.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-foreground/60 font-medium">Playback rate</span>
                                    <span className="text-[10px] text-foreground/70 tabular-nums">
                                        {(settings.ttsRate ?? 1).toFixed(2)}x
                                    </span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        aria-label="TTS playback rate"
                                        className="flex-1 accent-primary h-0.5"
                                        min={0.5}
                                        max={2}
                                        step={0.05}
                                        value={settings.ttsRate ?? 1}
                                        onChange={(e) =>
                                            onChange({
                                                ...settings,
                                                ttsRate: Number(e.target.value),
                                            })
                                        }
                                    />
                                    <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                                        {(settings.ttsRate ?? 1).toFixed(2)}x
                                    </span>
                                </div>
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-foreground/60 font-medium">Volume</span>
                                    <span className="text-[10px] text-foreground/70 tabular-nums">
                                        {Math.round((settings.ttsVolume ?? 1) * 100)}%
                                    </span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        aria-label="TTS volume"
                                        className="flex-1 accent-primary h-0.5"
                                        min={0}
                                        max={1}
                                        step={0.01}
                                        value={settings.ttsVolume ?? 1}
                                        onChange={(e) =>
                                            onChange({
                                                ...settings,
                                                ttsVolume: Number(e.target.value),
                                            })
                                        }
                                    />
                                    <span className="text-[10px] text-muted-foreground tabular-nums w-10 text-right">
                                        {Math.round((settings.ttsVolume ?? 1) * 100)}%
                                    </span>
                                </div>
                            </div>
                            <p className="text-[9px] text-muted-foreground/55">
                                Speaks each completed AI reply through your system output.
                            </p>
                        </div>
                    </SectionCard>
                </TabsContent>

                <TabsContent value="shortcuts" className="mt-4 space-y-5 overflow-y-auto min-h-0">
                    <SectionCard>
                        <SectionLabel icon={Keyboard} label="Shortcuts" />
                        <p className="text-[10px] text-muted-foreground/60 mb-3 -mt-1">
                            Click a binding, then press new keys to reassign
                        </p>
                        <div className="space-y-3">
                            {(
                                [
                                    { action: "analyze" as ShortcutAction, name: "Analyze" },
                                    { action: "clear" as ShortcutAction, name: "Clear" },
                                    { action: "settingsPanel" as ShortcutAction, name: "Settings" },
                                ] as const
                            ).map(({ action, name }) => (
                                <div key={action} className="flex items-center justify-between gap-4 py-1.5 border-b border-border/60 last:border-0 last:pb-0">
                                    <span className="text-[11px] font-medium text-foreground/80">{name}</span>
                                    <ShortcutRecorder
                                        value={settings.shortcuts[action].keys}
                                        label={settings.shortcuts[action].label}
                                        onChange={(keys, label) =>
                                            onChange({
                                                ...settings,
                                                shortcuts: {
                                                    ...settings.shortcuts,
                                                    [action]: { keys, label },
                                                },
                                            })
                                        }
                                    />
                                </div>
                            ))}
                        </div>
                        <Button
                            variant="ghost"
                            size="xs"
                            className="mt-3 gap-1.5 text-[10px] text-muted-foreground hover:text-foreground"
                            onClick={() =>
                                onChange({
                                    ...settings,
                                    shortcuts: DEFAULT_SHORTCUTS,
                                })
                            }
                        >
                            <ArrowCounterClockwise weight="bold" className="size-3" />
                            Reset defaults
                        </Button>
                    </SectionCard>
                </TabsContent>
            </Tabs>
        </div>
    );
});

