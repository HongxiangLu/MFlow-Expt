"use client";

import React, { useState, useEffect, useRef } from "react";
import { Database, Upload, CheckCircle, AlertCircle, Loader2, Link2 } from "lucide-react";
import type { MemoryStatus } from "./types";

interface FlushNotification {
  id: number;
  type: "success" | "error" | "info" | "action";
  message: string;
  actionLabel?: string;
  timestamp: number;
}

interface MemoryIndicatorProps {
  memoryStatus: MemoryStatus | null;
  onManualFlush: () => Promise<void>;
  onLinkDataset?: () => void;
  sessionId: string | null;
  hasLinkedDatasets: boolean;
}

export function MemoryIndicator({ memoryStatus, onManualFlush, onLinkDataset, sessionId, hasLinkedDatasets }: MemoryIndicatorProps) {
  const [flushing, setFlushing] = useState(false);
  const [notifications, setNotifications] = useState<FlushNotification[]>([]);
  const notifIdRef = useRef(0);
  const prevFlushedRef = useRef(false);

  useEffect(() => {
    if (memoryStatus?.flushed && !prevFlushedRef.current) {
      const details = memoryStatus.flush_details;
      const msg = details
        ? `Saved ${details.tokens_flushed} tokens (${details.turns_flushed} turns)`
        : "Memory saved to long-term storage";
      addNotification("success", msg);
    }
    prevFlushedRef.current = memoryStatus?.flushed ?? false;
  }, [memoryStatus?.flushed]);

  useEffect(() => {
    if (notifications.length === 0) return;
    const timer = setTimeout(() => {
      setNotifications(prev => prev.slice(1));
    }, 8000);
    return () => clearTimeout(timer);
  }, [notifications]);

  function addNotification(type: FlushNotification["type"], message: string, actionLabel?: string) {
    const id = ++notifIdRef.current;
    setNotifications(prev => [...prev, { id, type, message, actionLabel, timestamp: Date.now() }]);
  }

  async function handleManualFlush() {
    if (flushing || !sessionId) return;
    setFlushing(true);
    try {
      await onManualFlush();
      addNotification("info", "Manual save completed");
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg === "no_datasets") {
        addNotification("action", "No linked datasets — link a person to save memories", "Link Dataset");
      } else {
        addNotification("error", "Memory save failed, please retry later");
      }
    } finally {
      setFlushing(false);
    }
  }

  if (!memoryStatus) return null;

  const tokenPct = Math.min(100, (memoryStatus.buffer_tokens / memoryStatus.threshold_tokens) * 100);
  const turnPct = Math.min(100, (memoryStatus.buffer_turns / memoryStatus.threshold_turns) * 100);
  const activePct = Math.max(tokenPct, turnPct);
  const isNearThreshold = activePct >= 75;
  const hasBuffer = memoryStatus.buffer_tokens > 0 || memoryStatus.buffer_turns > 0;

  return (
    <div className="px-4 py-2 border-t border-[#1e1e1e]">
      {/* No-dataset hint when buffer is building but nothing is linked */}
      {hasBuffer && !hasLinkedDatasets && notifications.every(n => n.type !== "action") && (
        <div className="flex items-center justify-between mb-1.5 px-3 py-1.5 rounded-lg text-xs bg-[#1a1710] text-[#a09070] border border-[#2a2518]">
          <div className="flex items-center gap-2">
            <AlertCircle size={12} className="text-[#807060]" />
            <span>Memory buffer growing but no dataset linked — conversations won't be saved</span>
          </div>
          {onLinkDataset && (
            <button
              onClick={onLinkDataset}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-[#201c14] hover:bg-[#2a2418] text-[#a09070] border border-[#302818] transition-colors ml-2 flex-shrink-0"
            >
              <Link2 size={9} />
              Link
            </button>
          )}
        </div>
      )}

      {/* Notifications */}
      {notifications.map(n => (
        <div
          key={n.id}
          className={`flex items-center gap-2 mb-1.5 px-3 py-1.5 rounded-lg text-xs ${
            n.type === "success"
              ? "bg-[#101a14] text-[#709080] border border-[#1a2a20]"
              : n.type === "error"
                ? "bg-[#1a1010] text-[#a07070] border border-[#2a1818]"
                : n.type === "action"
                  ? "bg-[#1a1710] text-[#a09070] border border-[#2a2518]"
                  : "bg-[#12141a] text-[#7080a0] border border-[#1a2030]"
          }`}
        >
          {n.type === "success" && <CheckCircle size={12} />}
          {n.type === "error" && <AlertCircle size={12} />}
          {n.type === "info" && <Database size={12} />}
          {n.type === "action" && <Link2 size={12} />}
          <span className="flex-1">{n.message}</span>
          {n.type === "action" && onLinkDataset && (
            <button
              onClick={onLinkDataset}
              className="px-2 py-0.5 rounded text-[10px] bg-[#201c14] hover:bg-[#2a2418] text-[#a09070] border border-[#302818] transition-colors flex-shrink-0"
            >
              {n.actionLabel || "Link"}
            </button>
          )}
        </div>
      ))}

      {/* Progress bar + stats */}
      <div className="flex items-center gap-3">
        <Database size={12} className="text-[#808080] flex-shrink-0" />

        <div className="flex-1 h-1.5 bg-[#1e1e1e] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              isNearThreshold ? "bg-amber-400" : "bg-[#6b8afd]"
            }`}
            style={{ width: `${activePct}%` }}
          />
        </div>

        <div className="flex items-center gap-2 text-[10px] text-[#808080] flex-shrink-0 tabular-nums">
          <span>{memoryStatus.buffer_tokens}/{memoryStatus.threshold_tokens} tok</span>
          <span className="text-[#2a2a2a]">|</span>
          <span>{memoryStatus.buffer_turns}/{memoryStatus.threshold_turns} turns</span>
        </div>

        {hasBuffer && (
          <button
            onClick={handleManualFlush}
            disabled={flushing}
            title="Save memory manually"
            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] text-[#808080] hover:text-[#e0e0e0] hover:bg-[#1e1e1e] transition-colors disabled:opacity-30 flex-shrink-0"
          >
            {flushing ? (
              <Loader2 size={10} className="animate-spin" />
            ) : (
              <Upload size={10} />
            )}
            <span>Save</span>
          </button>
        )}
      </div>
    </div>
  );
}
