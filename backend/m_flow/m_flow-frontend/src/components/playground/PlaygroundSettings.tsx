"use client";

import React, { useState } from "react";
import { X, MessageSquare, Save, Loader2 } from "lucide-react";

const LLM_PRESETS: Record<string, { label: string; model: string; endpoint: string; api_key: string }> = {
  default:    { label: "Default (server config)", model: "", endpoint: "", api_key: "" },
  hermes:     { label: "Hermes Agent (localhost:3001)", model: "hermes", endpoint: "http://localhost:3001/v1", api_key: "local" },
  openclaw:   { label: "OpenClaw (localhost:3100)", model: "openclaw", endpoint: "http://localhost:3100/v1", api_key: "local" },
  clawcode:   { label: "Claw Code (localhost:3003)", model: "claw-code", endpoint: "http://localhost:3003/v1", api_key: "local" },
  claudecode: { label: "Claude Code Gateway (localhost:3002)", model: "claude-opus-4-6", endpoint: "http://localhost:3002/v1", api_key: "local" },
  ollama:     { label: "Ollama (localhost:11434)", model: "llama3", endpoint: "http://localhost:11434/v1", api_key: "ollama" },
  custom:     { label: "Custom endpoint", model: "", endpoint: "", api_key: "" },
};

interface PlaygroundSettingsProps {
  sessionId: string;
  apiBase: string;
  headers: () => Record<string, string>;
  currentConfig: {
    flush_token_threshold: number;
    flush_turn_threshold: number;
    llm_preset?: string;
    llm_model?: string;
    llm_endpoint?: string;
    llm_api_key?: string;
  };
  onClose: () => void;
  onSaved: (config: Record<string, any>) => void;
}

export function PlaygroundSettings({ sessionId, apiBase, headers, currentConfig, onClose, onSaved }: PlaygroundSettingsProps) {
  const [tokenThreshold, setTokenThreshold] = useState(currentConfig.flush_token_threshold);
  const [turnThreshold, setTurnThreshold] = useState(currentConfig.flush_turn_threshold);

  const [llmPreset, setLlmPreset] = useState(currentConfig.llm_preset || "default");
  const [llmModel, setLlmModel] = useState(currentConfig.llm_model || "");
  const [llmEndpoint, setLlmEndpoint] = useState(currentConfig.llm_endpoint || "");
  const [llmApiKey, setLlmApiKey] = useState(currentConfig.llm_api_key || "");
  const [saving, setSaving] = useState(false);

  function handlePresetChange(preset: string) {
    setLlmPreset(preset);
    const p = LLM_PRESETS[preset];
    if (p && preset !== "custom") {
      setLlmModel(p.model);
      setLlmEndpoint(p.endpoint);
      setLlmApiKey(p.api_key);
    }
  }

  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/v1/playground/set-llm`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          session_id: sessionId,
          model: llmModel,
          endpoint: llmEndpoint,
          api_key: llmApiKey,
        }),
      });
      if (!res.ok) {
        setError(`Failed to update LLM settings (${res.status})`);
        setSaving(false);
        return;
      }
      const data = await res.json();
      if (data.ok === false) {
        setError(data.error || "Failed to update LLM settings");
        setSaving(false);
        return;
      }
    } catch {
      setError("Network error — settings not saved");
      setSaving(false);
      return;
    }
    setSaving(false);

    onSaved({
      flush_token_threshold: tokenThreshold,
      flush_turn_threshold: turnThreshold,
      llm_preset: llmPreset,
      llm_model: llmModel,
      llm_endpoint: llmEndpoint,
      llm_api_key: llmApiKey,
    });
    onClose();
  }

  const isCustom = llmPreset === "custom";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-[#141414] border border-[#2a2a2a] rounded-xl w-[420px] max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2a2a2a]">
          <div className="flex items-center gap-2">
            <MessageSquare size={16} className="text-[#6b8afd]" />
            <span className="text-sm font-medium text-[#e0e0e0]">Chat & Memory Settings</span>
          </div>
          <button onClick={onClose} className="text-[#808080] hover:text-[#e0e0e0] transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* LLM Provider */}
          <div>
            <div className="text-xs text-[#808080] mb-2">LLM Provider</div>
            <select
              value={llmPreset}
              onChange={e => handlePresetChange(e.target.value)}
              className="w-full bg-[#0a0a0a] border border-[#2a2a2a] rounded-lg px-3 py-2 text-sm text-[#e0e0e0] focus:outline-none focus:border-[#6b8afd]"
            >
              {Object.entries(LLM_PRESETS).map(([key, p]) => (
                <option key={key} value={key}>{p.label}</option>
              ))}
            </select>
          </div>

          {/* Model + Endpoint (shown for non-default) */}
          {llmPreset !== "default" && (
            <div className="space-y-3 p-3 rounded-lg bg-[#0a0a0a] border border-[#2a2a2a]">
              <div>
                <label className="block text-[10px] text-[#686868] mb-1">Model</label>
                <input
                  value={llmModel}
                  onChange={e => setLlmModel(e.target.value)}
                  disabled={!isCustom}
                  placeholder="e.g. hermes, llama3, gpt-4o"
                  className="w-full bg-[#141414] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-xs text-[#e0e0e0] placeholder-[#404040] focus:outline-none focus:border-[#6b8afd] disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[#686868] mb-1">Endpoint URL</label>
                <input
                  value={llmEndpoint}
                  onChange={e => setLlmEndpoint(e.target.value)}
                  disabled={!isCustom}
                  placeholder="e.g. http://localhost:3001/v1"
                  className="w-full bg-[#141414] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-xs text-[#e0e0e0] placeholder-[#404040] focus:outline-none focus:border-[#6b8afd] disabled:opacity-50"
                />
              </div>
              {isCustom && (
                <div>
                  <label className="block text-[10px] text-[#686868] mb-1">API Key</label>
                  <input
                    type="password"
                    value={llmApiKey}
                    onChange={e => setLlmApiKey(e.target.value)}
                    placeholder="Optional for local models"
                    className="w-full bg-[#141414] border border-[#2a2a2a] rounded px-2.5 py-1.5 text-xs text-[#e0e0e0] placeholder-[#404040] focus:outline-none focus:border-[#6b8afd]"
                  />
                </div>
              )}
            </div>
          )}

          {/* Memory thresholds */}
          <div>
            <div className="text-xs text-[#808080] mb-2">Memory Flush Token Threshold</div>
            <div className="relative">
              <input
                type="range" min={500} max={5000} step={100} value={tokenThreshold}
                onChange={e => setTokenThreshold(Number(e.target.value))}
                className="w-full accent-[#6b8afd]"
              />
            </div>
            <div className="relative mt-1">
              <div className="flex justify-between text-[10px] text-[#505050]">
                <span>500</span>
                <span>5000</span>
              </div>
              <div className="absolute top-0 text-[10px] text-[#e0e0e0] font-medium tabular-nums pointer-events-none" style={{ left: `calc(${(tokenThreshold - 500) / 4500 * 100}%)`, transform: "translateX(-50%)" }}>
                {tokenThreshold}
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs text-[#808080] mb-2">Memory Flush Turn Threshold</div>
            <div className="relative">
              <input
                type="range" min={3} max={30} step={1} value={turnThreshold}
                onChange={e => setTurnThreshold(Number(e.target.value))}
                className="w-full accent-[#6b8afd]"
              />
            </div>
            <div className="relative mt-1">
              <div className="flex justify-between text-[10px] text-[#505050]">
                <span>3</span>
                <span>30</span>
              </div>
              <div className="absolute top-0 text-[10px] text-[#e0e0e0] font-medium tabular-nums pointer-events-none" style={{ left: `calc(${(turnThreshold - 3) / 27 * 100}%)`, transform: "translateX(-50%)" }}>
                {turnThreshold}
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mx-5 mb-0 px-3 py-2 rounded-lg bg-[#1a1010] border border-[#2a1818] text-[#a07070] text-xs">
            {error}
          </div>
        )}
        <div className="px-5 py-4 border-t border-[#2a2a2a] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs text-[#808080] hover:text-[#e0e0e0]">Cancel</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#6b8afd] text-white text-xs font-medium hover:bg-[#5a7ae8] disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            <span>Save</span>
          </button>
        </div>
      </div>
    </div>
  );
}
