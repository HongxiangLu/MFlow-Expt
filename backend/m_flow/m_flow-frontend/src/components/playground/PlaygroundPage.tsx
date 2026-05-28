"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { config, STORAGE_KEYS } from "@/lib/config";
import { Video, Send, User, Loader2, Wifi, WifiOff, Camera, Settings2, Sliders, Play, Square, Mic, MicOff } from "lucide-react";
import { MemoryIndicator } from "./MemoryIndicator";
import { DatasetLinker } from "./DatasetLinker";
import { PlaygroundSettings } from "./PlaygroundSettings";
import { VisionSettings } from "./VisionSettings";
import { CorefDebugPanel, type CorefDebugData } from "./CorefDebugPanel";
import type { Message, PersonInFrame, MemoryStatus, NewFaceLink, CorefResolution } from "./types";

const API = config.API_BASE_URL;

export function PlaygroundPage() {
  const token = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) : null;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [faceRecStatus, setFaceRecStatus] = useState<string>("offline");
  const [faceRecUrl] = useState("http://localhost:5001");
  const [videoFeedUrl, setVideoFeedUrl] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [persons, setPersons] = useState<PersonInFrame[]>([]);
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatus | null>(null);
  const [speakerFaceId, setSpeakerFaceId] = useState<number | null>(null);

  const [linkerTarget, setLinkerTarget] = useState<PersonInFrame | null>(null);
  const [showVisionSettings, setShowVisionSettings] = useState(false);
  const [showChatSettings, setShowChatSettings] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineToggling, setPipelineToggling] = useState(false);
  const [hasAnyLinkedDataset, setHasAnyLinkedDataset] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const speakersDetectedRef = useRef<Set<string>>(new Set());
  const speakerIdsDetectedRef = useRef<Set<number>>(new Set());
  const [corefDebug, setCorefDebug] = useState<CorefDebugData | null>(null);
  const [corefHistory, setCorefHistory] = useState<CorefDebugData[]>([]);
  const [pgConfig, setPgConfig] = useState({
    flush_token_threshold: 2000, flush_turn_threshold: 10, face_recognition_url: "http://localhost:5001",
    llm_preset: "default", llm_model: "", llm_endpoint: "", llm_api_key: "",
  });

  const chatEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  // Create session on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/v1/playground/session`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ face_recognition_url: faceRecUrl }),
        });
        if (res.ok) {
          const data = await res.json();
          setSessionId(data.session_id);
          setFaceRecStatus(data.face_recognition_status);
          if (data.config?.video_feed_url) setVideoFeedUrl(data.config.video_feed_url);
          if (data.config) setPgConfig(prev => ({ ...prev, ...data.config }));
        }
      } catch {
        setFaceRecStatus("offline");
      }
    })();
  }, [faceRecUrl, headers]);

  // Poll persons + detect face recognition service health
  const failCountRef = useRef(0);
  useEffect(() => {
    if (!sessionId) return;
    const poll = async () => {
      try {
        const res = await fetch(
          `${API}/api/v1/playground/persons?session_id=${sessionId}`,
          { headers: headers() }
        );
        if (res.ok) {
          const raw = await res.json();
          // Backend returns {persons: [...], _face_rec_status: "..."}
          const rawList = raw.persons ?? (Array.isArray(raw) ? raw : []);
          // Deduplicate by registered_id — keep the first (most recent) entry per identity
          const seen = new Set<number>();
          const personsList = rawList
            .map((p: any) => ({ ...p, name: p.display_name || p.name || "" }))
            .filter((p: any) => {
              if (p.face_registered_id == null) return true;
              if (seen.has(p.face_registered_id)) return false;
              seen.add(p.face_registered_id);
              return true;
            });
          const status = raw._face_rec_status;

          setPersons(personsList);
          if (personsList.length === 1 && personsList[0].face_registered_id) {
            setSpeakerFaceId(personsList[0].face_registered_id);
          }
          // During recording, track who is speaking
          if (mediaRecorderRef.current?.state === "recording") {
            for (const p of personsList) {
              if (p.mouth === "speaking" && p.face_registered_id) {
                speakerIdsDetectedRef.current.add(p.face_registered_id);
                speakersDetectedRef.current.add(p.name || `User#${p.face_registered_id}`);
              }
            }
          }
          failCountRef.current = 0;
          if (raw._has_any_mapping || personsList.some((p: any) => p.dataset_ids?.length)) {
            setHasAnyLinkedDataset(true);
          }
          if (status) {
            setFaceRecStatus(status);
            setPipelineRunning(status === "connected" || status === "pipeline_started");
            if (status === "offline") setVideoFeedUrl(null);
          }
        } else {
          failCountRef.current++;
        }
      } catch {
        failCountRef.current++;
      }
      // After 3 consecutive failures, mark as offline
      if (failCountRef.current >= 3) {
        setFaceRecStatus("offline");
        setVideoFeedUrl(null);
      }
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [sessionId, headers]);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || !sessionId || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(prev => [...prev, { role: "user", content: userMsg, speakerName: getSpeakerName() }]);
    setLoading(true);

    setMessages(prev => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch(`${API}/api/v1/playground/chat`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          session_id: sessionId,
          message: userMsg,
          speaker_face_id: speakerFaceId,
        }),
      });

      if (!res.ok || !res.body) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: "Connection failed, please retry." };
          return updated;
        });
        setLoading(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedText = "";
      let currentEvent = "token";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6);

          try {
            const payload = JSON.parse(raw);

            if (currentEvent === "token" && payload.text) {
              streamedText += payload.text;
              const text = streamedText;
              setMessages(prev => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (updated[lastIdx]?.role === "assistant") {
                  updated[lastIdx] = { ...updated[lastIdx], content: text };
                }
                return updated;
              });
            }

            if (currentEvent === "done") {
              const data = payload;

              const corefRes = data.coref_resolutions as CorefResolution[] | null;
              if (corefRes && corefRes.length > 0) {
                setMessages(prev => {
                  const updated = [...prev];
                  for (let i = updated.length - 1; i >= 0; i--) {
                    if (updated[i].role === "user") {
                      updated[i] = { ...updated[i], corefResolutions: corefRes };
                      break;
                    }
                  }
                  return updated;
                });
              }

              const systemMsgs: Message[] = [];
              if (data.new_face_links) {
                for (const link of data.new_face_links as NewFaceLink[]) {
                  systemMsgs.push({ role: "system", content: `Auto-created memory dataset for ${link.display_name}` });
                }
              }
              if (data.memory_status?.flushed && data.memory_status?.flush_details) {
                const d = data.memory_status.flush_details;
                systemMsgs.push({ role: "system", content: `Memory saved — ${d.tokens_flushed} tokens, ${d.turns_flushed} turns` });
              }
              // Detect auto-flush failed due to no datasets
              const ms = data.memory_status;
              if (ms && !ms.flushed && (ms.buffer_tokens >= ms.threshold_tokens || ms.buffer_turns >= ms.threshold_turns)) {
                const hasAnyDataset = (data.persons_in_frame || []).some((p: any) => p.dataset_ids?.length);
                if (!hasAnyDataset) {
                  systemMsgs.push({ role: "system", content: "Memory buffer full but no dataset linked — use the Link button below to save" });
                }
              }
              if (systemMsgs.length > 0) {
                setMessages(prev => [...prev, ...systemMsgs]);
              }
              if (data.persons_in_frame) {
                setPersons(data.persons_in_frame);
                if (data.persons_in_frame.some((p: any) => p.dataset_ids?.length)) {
                  setHasAnyLinkedDataset(true);
                }
              }
              if (data.memory_status) setMemoryStatus(data.memory_status);
              if (data.coref_debug) {
                setCorefHistory(prev => [...prev, data.coref_debug]);
                setCorefDebug(data.coref_debug);
              }
            }

            currentEvent = "token";
          } catch { /* partial JSON, skip */ }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (updated[lastIdx]?.role === "assistant" && !updated[lastIdx].content) {
          updated[lastIdx] = { ...updated[lastIdx], content: "Connection failed, please retry." };
        }
        return updated;
      });
    }
    setLoading(false);
  };

  const handleManualFlush = async () => {
    if (!sessionId) return;
    const res = await fetch(`${API}/api/v1/playground/flush`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ session_id: sessionId }),
    });
    if (!res.ok) {
      throw new Error(`Flush request failed: ${res.status}`);
    }
    const data = await res.json();
    if (!data.ok) {
      const err = data.error || "Flush failed";
      if (err.includes("No datasets linked")) {
        throw new Error("no_datasets");
      }
      throw new Error(err);
    }
    setMemoryStatus(prev => prev ? {
      ...prev,
      buffer_tokens: 0,
      buffer_turns: 0,
      flushed: true,
      flush_details: {
        tokens_flushed: data.tokens_flushed,
        turns_flushed: data.turns_flushed,
        datasets_affected: data.datasets_affected,
      },
    } : prev);
    setMessages(prev => [...prev, {
      role: "system",
      content: `Manual save — ${data.tokens_flushed} tokens, ${data.turns_flushed} turns`,
    }]);
  };

  const togglePipeline = async () => {
    if (pipelineToggling || !sessionId) return;
    setPipelineToggling(true);
    try {
      const action = pipelineRunning ? "stop" : "start";
      const res = await fetch(`${API}/api/v1/playground/${action}-vision`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ session_id: sessionId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok !== false) {
          if (pipelineRunning) {
            // Stopping
            setPipelineRunning(false);
            setFaceRecStatus("idle");
            setVideoFeedUrl(null);
          } else {
            // Starting — re-create session to get fresh video URL
            setPipelineRunning(true);
            setFaceRecStatus("connected");
            try {
              const sessRes = await fetch(`${API}/api/v1/playground/session`, {
                method: "POST",
                headers: headers(),
                body: JSON.stringify({ face_recognition_url: faceRecUrl }),
              });
              if (sessRes.ok) {
                const sessData = await sessRes.json();
                setSessionId(sessData.session_id);
                if (sessData.config?.video_feed_url) setVideoFeedUrl(sessData.config.video_feed_url);
              }
            } catch { /* ignore */ }
          }
        }
      }
    } catch { /* ignore */ }
    setPipelineToggling(false);
  };

  const toggleRecording = async () => {
    if (recording) {
      mediaRecorderRef.current?.stop();
      return;
    }
    // Clear speaker tracking for this recording session
    speakersDetectedRef.current.clear();
    speakerIdsDetectedRef.current.clear();
    // Snapshot current speaking persons at the moment recording starts
    for (const p of persons) {
      if (p.mouth === "speaking" && p.face_registered_id) {
        speakerIdsDetectedRef.current.add(p.face_registered_id);
        speakersDetectedRef.current.add(p.name || `User#${p.face_registered_id}`);
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(false);
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        if (blob.size < 100) return;

        // Capture detected speakers before async transcription
        const detectedNames = [...speakersDetectedRef.current];
        const detectedIds = [...speakerIdsDetectedRef.current];

        setTranscribing(true);
        try {
          const form = new FormData();
          form.append("file", blob, "audio.webm");
          const h = { ...(token ? { Authorization: `Bearer ${token}` } : {}) };
          const res = await fetch(`${API}/api/v1/playground/asr`, { method: "POST", headers: h, body: form });
          if (res.ok) {
            const data = await res.json();
            if (data.ok && data.text) {
              const transcript = data.text;
              if (detectedNames.length > 0) {
                const prefix = detectedNames.length === 1
                  ? `[${detectedNames[0]}]: `
                  : `[${detectedNames.join(" + ")}]: `;
                setInput(prev => prev + (prev ? " " : "") + prefix + transcript);
              } else {
                setInput(prev => prev + (prev ? " " : "") + transcript);
              }
              // Auto-set speaker if exactly one person was detected speaking
              if (detectedIds.length === 1) {
                setSpeakerFaceId(detectedIds[0]);
              }
            }
          }
        } catch { /* ignore */ }
        setTranscribing(false);
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setRecording(true);
    } catch { /* mic permission denied */ }
  };

  const getSpeakerName = () => {
    if (!speakerFaceId) return undefined;
    const p = persons.find(p => p.face_registered_id === speakerFaceId);
    return p?.name || undefined;
  };

  const knownPersons = persons.filter(p => p.identity === "KNOWN_STRONG");
  const showSpeakerSelector = knownPersons.length > 1;

  return (
    <div className="flex flex-col lg:flex-row gap-3 lg:gap-4 h-[calc(100vh-6rem)]">
      {/* Left panel — Video + Persons */}
      <div className="w-full lg:w-[380px] flex-shrink-0 flex flex-col gap-3 max-h-[40vh] lg:max-h-full">
        {/* Video */}
        <div className="rounded-xl overflow-hidden bg-[#0a0a0a] border border-[#2a2a2a] relative aspect-[4/3]">
          {/* Vision controls */}
          <div className="absolute top-2 left-2 flex items-center gap-1 z-10">
            <button
              onClick={() => setShowVisionSettings(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 text-[#808080] hover:text-[#e0e0e0] text-xs transition-colors"
            >
              <Sliders size={11} />
            </button>
            <button
              onClick={togglePipeline}
              disabled={pipelineToggling || faceRecStatus === "offline"}
              className={`flex items-center gap-1 px-2 py-1 rounded-md bg-black/60 text-xs transition-colors disabled:opacity-30 ${
                pipelineRunning ? "text-amber-400/80 hover:text-amber-300" : "text-emerald-400/80 hover:text-emerald-300"
              }`}
            >
              {pipelineToggling ? <Loader2 size={11} className="animate-spin" /> : pipelineRunning ? <Square size={9} /> : <Play size={11} />}
              <span>{pipelineToggling ? "..." : pipelineRunning ? "Stop" : "Start"}</span>
            </button>
          </div>
          {faceRecStatus === "connected" && videoFeedUrl ? (
            <img
              src={videoFeedUrl}
              alt="Camera"
              className="w-full h-full object-cover"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-[#808080]">
              <Camera size={32} strokeWidth={1} className="mb-2" />
              <span className="text-sm">Vision service offline</span>
            </div>
          )}
          <div className="absolute top-2 right-2 flex items-center gap-1.5 px-2 py-1 rounded-md bg-black/60 text-xs">
            {faceRecStatus === "connected"
              ? <><Wifi size={12} className="text-emerald-400" /><span className="text-emerald-400">Connected</span></>
              : faceRecStatus === "idle"
                ? <><WifiOff size={12} className="text-amber-400/70" /><span className="text-amber-400/70">Stopped</span></>
                : <><WifiOff size={12} className="text-[#808080]" /><span className="text-[#808080]">Offline</span></>
            }
          </div>
        </div>

        {/* Persons list */}
        <div className="flex-1 overflow-y-auto rounded-xl bg-[#0a0a0a] border border-[#2a2a2a] p-3">
          <div className="text-xs text-[#808080] mb-2 uppercase tracking-wider">People in Frame</div>
          {persons.length === 0 ? (
            <div className="text-sm text-[#404040] text-center py-4">Waiting for people to appear</div>
          ) : (
            <div className="space-y-2">
              {persons.map((p, i) => (
                <div
                  key={p.face_registered_id ?? i}
                  className={`flex items-center gap-3 p-2.5 rounded-lg transition-colors ${
                    speakerFaceId === p.face_registered_id
                      ? "bg-[#1e1e1e] border border-[#6b8afd]/30"
                      : "bg-[#141414] border border-transparent hover:border-[#2a2a2a]"
                  }`}
                  onClick={() => p.face_registered_id && setSpeakerFaceId(p.face_registered_id)}
                  style={{ cursor: p.face_registered_id ? "pointer" : "default" }}
                >
                  <div className="w-9 h-9 rounded-full bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center text-[#808080] overflow-hidden flex-shrink-0">
                    {p.avatar ? (
                      <img src={`data:image/jpeg;base64,${p.avatar}`} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User size={16} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-[#e0e0e0] truncate">
                      {p.name || "Unknown"}
                    </div>
                    <div className="text-xs text-[#808080]">
                      {p.identity === "KNOWN_STRONG" ? "Identified" :
                       p.identity === "AMBIGUOUS" ? "Identifying..." :
                       p.identity === "UNKNOWN_STRONG" ? "New face" : "Detecting..."}
                      {" · "}
                      {p.mouth === "speaking"
                        ? <span className="text-emerald-400">Speaking</span>
                        : p.mouth === "not_speaking"
                          ? <span className="text-[#606060]">Silent</span>
                          : p.mouth === "occluded"
                            ? <span className="text-amber-400/60">Occluded</span>
                            : <span className="text-[#404040]">—</span>}
                    </div>
                    <div className={`text-[10px] mt-0.5 ${(p.dataset_ids?.length) ? "text-emerald-500/70" : "text-[#404040]"}`}>
                      {(p.dataset_ids?.length) ? `${p.dataset_ids.length} dataset(s) linked` : "No memory linked"}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {speakerFaceId === p.face_registered_id && (
                      <div className="text-[10px] text-[#6b8afd] font-medium">Speaker</div>
                    )}
                    {p.face_registered_id && (
                      <button
                        onClick={e => { e.stopPropagation(); setLinkerTarget(p); }}
                        className="text-[#808080] hover:text-[#e0e0e0] transition-colors"
                        title="Manage link"
                      >
                        <Settings2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right panel — Chat */}
      <div className="flex-1 flex flex-col rounded-xl bg-[#0a0a0a] border border-[#2a2a2a] overflow-hidden">
        {/* Chat settings button */}
        <div className="flex items-center justify-end px-3 py-1.5 border-b border-[#1e1e1e]">
          <button
            onClick={() => setShowChatSettings(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[#808080] hover:text-[#e0e0e0] hover:bg-[#1e1e1e] text-[10px] transition-colors"
          >
            <Sliders size={10} />
            <span>Settings</span>
          </button>
        </div>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-[#404040]">
              <Video size={32} strokeWidth={1} className="mb-3" />
              <p className="text-sm">Start chatting with AI</p>
              <p className="text-xs mt-1">AI can see people on camera and remember conversations</p>
            </div>
          )}
          {messages.map((msg, i) => (
            msg.role === "system" ? (
              <div key={i} className="flex justify-center">
                <div className="px-3 py-1 rounded-full bg-[#101a14] border border-[#1a2a20] text-[#709080] text-[11px]">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-xl px-4 py-2.5 ${
                  msg.role === "user"
                    ? "bg-[#1e2a1e] text-[#e0e0e0]"
                    : "bg-[#1a1d23] text-[#e0e0e0]"
                }`}>
                  {msg.speakerName && (
                    <div className="text-[10px] text-[#6b8afd] mb-1">{msg.speakerName}</div>
                  )}
                  <div className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</div>
                  {msg.corefResolutions && msg.corefResolutions.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-white/5">
                      <div className="text-[10px] text-[#808080]">
                        {msg.corefResolutions.map((cr, ci) => (
                          <span key={ci}>
                            <span className="text-amber-400/70">"{cr.original}"</span>
                            <span className="mx-1">→</span>
                            <span className="text-emerald-400/70">"{cr.resolved}"</span>
                            {ci < (msg.corefResolutions?.length ?? 0) - 1 && " · "}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-[#1a1d23] rounded-xl px-4 py-2.5">
                <Loader2 size={16} className="animate-spin text-[#808080]" />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Coreference debug panel */}
        <CorefDebugPanel data={corefDebug} history={corefHistory.slice(0, -1)} />

        {/* Memory indicator */}
        <MemoryIndicator
          memoryStatus={memoryStatus}
          onManualFlush={handleManualFlush}
          onLinkDataset={() => {
            const firstUnlinked = persons.find(p => p.face_registered_id && !p.dataset_ids?.length);
            if (firstUnlinked) {
              setLinkerTarget(firstUnlinked);
            } else if (persons.length > 0) {
              setLinkerTarget(persons[0]);
            } else {
              setLinkerTarget({ face_registered_id: -1, name: "Anonymous", mouth: "", identity: "", dataset_ids: [] });
            }
          }}
          sessionId={sessionId}
          hasLinkedDatasets={hasAnyLinkedDataset || persons.some(p => !!p.dataset_ids?.length)}
        />

        {/* Speaker selector + Input */}
        <div className="border-t border-[#2a2a2a] p-3">
          {showSpeakerSelector && (
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs text-[#808080]">Speaker:</span>
              <select
                value={speakerFaceId ?? ""}
                onChange={e => setSpeakerFaceId(e.target.value ? Number(e.target.value) : null)}
                className="bg-[#141414] border border-[#2a2a2a] rounded-md px-2 py-1 text-xs text-[#e0e0e0] focus:outline-none focus:border-[#6b8afd]"
              >
                <option value="">Auto</option>
                {knownPersons.map(p => (
                  <option key={p.face_registered_id} value={p.face_registered_id ?? ""}>
                    {p.name || `User#${p.face_registered_id}`}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
              placeholder={recording ? "Listening..." : transcribing ? "Transcribing..." : "Type a message..."}
              className="flex-1 bg-[#141414] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-[#e0e0e0] placeholder-[#404040] focus:outline-none focus:border-[#6b8afd] transition-colors"
            />
            <button
              onClick={toggleRecording}
              disabled={transcribing}
              className={`px-3 rounded-lg border transition-colors ${
                recording
                  ? "bg-red-500/20 border-red-500/30 text-red-400"
                  : "bg-[#141414] border-[#2a2a2a] text-[#808080] hover:text-[#e0e0e0] hover:border-[#6b8afd]"
              } disabled:opacity-30`}
              title={recording ? "Stop recording" : "Voice input (Whisper ASR)"}
            >
              {transcribing ? <Loader2 size={16} className="animate-spin" /> : recording ? <MicOff size={16} /> : <Mic size={16} />}
            </button>
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim()}
              className="px-4 rounded-lg bg-[#6b8afd] text-white text-sm font-medium hover:bg-[#5a7ae8] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* DatasetLinker dialog */}
      {linkerTarget && sessionId && (
        <DatasetLinker
          person={linkerTarget}
          sessionId={sessionId}
          apiBase={API}
          headers={headers}
          onClose={() => setLinkerTarget(null)}
          onLinked={() => setHasAnyLinkedDataset(true)}
        />
      )}

      {/* Vision settings dialog */}
      {showVisionSettings && (
        <VisionSettings
          currentConfig={pgConfig}
          headers={headers}
          apiBase={API}
          sessionId={sessionId}
          onClose={() => setShowVisionSettings(false)}
          onSaved={(config) => setPgConfig(prev => ({ ...prev, ...config }))}
        />
      )}

      {/* Chat & Memory settings dialog */}
      {showChatSettings && sessionId && (
        <PlaygroundSettings
          sessionId={sessionId}
          apiBase={API}
          headers={headers}
          currentConfig={pgConfig}
          onClose={() => setShowChatSettings(false)}
          onSaved={(config) => setPgConfig(prev => ({ ...prev, ...config }))}
        />
      )}
    </div>
  );
}
