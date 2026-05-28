"use client";

import React, { useState, useEffect } from "react";
import { X, Camera, Save, RefreshCw, Loader2, Power } from "lucide-react";

interface VisionSettingsProps {
  currentConfig: { face_recognition_url: string };
  headers: () => Record<string, string>;
  apiBase: string;
  sessionId: string | null;
  onClose: () => void;
  onSaved: (config: Record<string, any>) => void;
}

interface PipelineStatus {
  running: boolean;
  mode: string;
  fps: number;
  speaking_enabled?: boolean;
  embed_enabled?: boolean;
  align_enabled?: boolean;
  m5_enabled?: boolean;
}

export function VisionSettings({ currentConfig, headers, apiBase, sessionId, onClose, onSaved }: VisionSettingsProps) {
  const [faceRecUrl, setFaceRecUrl] = useState(currentConfig.face_recognition_url);
  const [status, setStatus] = useState<PipelineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);

  const [speakingEnabled, setSpeakingEnabled] = useState(true);
  const [embedEnabled, setEmbedEnabled] = useState(true);
  const [alignEnabled, setAlignEnabled] = useState(true);
  const [m5Enabled, setM5Enabled] = useState(true);

  useEffect(() => {
    fetchStatus();
  }, []);

  async function fetchStatus() {
    setLoading(true);
    try {
      const res = await fetch(
        `${apiBase}/api/v1/playground/vision-status?session_id=${sessionId || ""}`,
        { headers: headers() }
      );
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.speaking_enabled !== undefined) setSpeakingEnabled(data.speaking_enabled);
        if (data.embed_enabled !== undefined) setEmbedEnabled(data.embed_enabled);
        if (data.align_enabled !== undefined) setAlignEnabled(data.align_enabled);
        if (data.m5_enabled !== undefined) setM5Enabled(data.m5_enabled);
      }
    } catch { /* offline */ }
    setLoading(false);
  }

  async function handleRestart() {
    setRestarting(true);
    try {
      // Stop first
      await fetch(`${apiBase}/api/v1/playground/restart-vision`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          session_id: sessionId,
          speaking_enabled: speakingEnabled,
          embed_enabled: embedEnabled,
          align_enabled: alignEnabled,
          m5_enabled: m5Enabled,
        }),
      });
      await new Promise(r => setTimeout(r, 2000));
      await fetchStatus();
    } catch { /* ignore */ }
    setRestarting(false);
  }

  function handleSave() {
    onSaved({ face_recognition_url: faceRecUrl });
    onClose();
  }

  function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs text-[#a0a0a0]">{label}</span>
        <button
          onClick={() => onChange(!value)}
          className={`w-8 h-4 rounded-full transition-colors relative ${value ? "bg-[#6b8afd]" : "bg-[#2a2a2a]"}`}
        >
          <div className={`w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all ${value ? "left-4" : "left-0.5"}`} />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl w-[400px] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a]">
          <div className="flex items-center gap-2">
            <Camera size={16} className="text-[#6b8afd]" />
            <span className="text-sm font-medium text-[#e0e0e0]">Vision Settings</span>
          </div>
          <button onClick={onClose} className="text-[#808080] hover:text-[#e0e0e0] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Service URL */}
          <div>
            <label className="block text-xs text-[#808080] mb-2">Service URL</label>
            <input
              value={faceRecUrl}
              onChange={e => setFaceRecUrl(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-[#e0e0e0] focus:outline-none focus:border-[#6b8afd]"
            />
          </div>

          {/* Pipeline status */}
          <div className="p-3 rounded-lg bg-[#0a0a0a] border border-[#2a2a2a]">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-[#808080]">Pipeline Status</div>
              <button onClick={fetchStatus} className="text-[#808080] hover:text-[#e0e0e0] transition-colors">
                <RefreshCw size={11} />
              </button>
            </div>
            {loading ? (
              <div className="text-[10px] text-[#505050]">Loading...</div>
            ) : status ? (
              <div className="space-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-[#808080]">Status</span>
                  <span className={status.running ? "text-emerald-400" : "text-[#808080]"}>
                    {status.running ? "Running" : "Stopped"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">FPS</span>
                  <span className="text-[#a0a0a0]">{status.fps?.toFixed(1) || "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#808080]">Mode</span>
                  <span className="text-[#a0a0a0]">{status.mode || "—"}</span>
                </div>
              </div>
            ) : (
              <div className="text-[10px] text-red-400/70">Service unreachable</div>
            )}
          </div>

          {/* Pipeline features */}
          <div>
            <div className="text-xs text-[#808080] mb-2">Pipeline Features</div>
            <div className="p-3 rounded-lg bg-[#0a0a0a] border border-[#2a2a2a]">
              <Toggle label="Speaking Detection" value={speakingEnabled} onChange={setSpeakingEnabled} />
              <Toggle label="Face Embedding" value={embedEnabled} onChange={setEmbedEnabled} />
              <Toggle label="Face Alignment" value={alignEnabled} onChange={setAlignEnabled} />
              <Toggle label="M5 Identity" value={m5Enabled} onChange={setM5Enabled} />
            </div>
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="mt-2 w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#1e1e1e] border border-[#2a2a2a] text-xs text-[#a0a0a0] hover:text-[#e0e0e0] hover:border-[#6b8afd] transition-colors disabled:opacity-40"
            >
              {restarting ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
              <span>{restarting ? "Restarting..." : "Restart Pipeline with Settings"}</span>
            </button>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[#2a2a2a] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-[#808080] hover:text-[#e0e0e0]">Cancel</button>
          <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6b8afd] text-white text-xs font-medium hover:bg-[#5a7ae8] transition-colors">
            <Save size={12} />
            <span>Save URL</span>
          </button>
        </div>
      </div>
    </div>
  );
}
