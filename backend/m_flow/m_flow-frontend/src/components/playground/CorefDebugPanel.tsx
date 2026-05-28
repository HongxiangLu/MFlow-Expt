"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight, Users, MapPin, Clock, Box, Zap, ArrowRight, MessageSquare } from "lucide-react";

interface EntityInfo {
  text: string;
  type: string;
  sentence_id: number;
}

export interface CorefDebugData {
  turn_count: number;
  original_query: string;
  resolved_query: string;
  replacements: Array<{ pronoun?: string; replacement?: string; position?: number }>;
  entity_stacks: {
    persons: EntityInfo[];
    objects: EntityInfo[];
    locations: EntityInfo[];
    times: EntityInfo[];
    events: EntityInfo[];
  };
  sentence_count: number;
  last_speaker: string | null;
  last_listener: string | null;
}

interface CorefDebugPanelProps {
  data: CorefDebugData | null;
  history: CorefDebugData[];
}

function EntityStack({ label, icon, entities, color }: {
  label: string;
  icon: React.ReactNode;
  entities: EntityInfo[];
  color: string;
}) {
  if (entities.length === 0) return null;
  return (
    <div className="flex items-start gap-2">
      <div className={`mt-0.5 ${color}`}>{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-[#686868] mb-0.5">{label}</div>
        <div className="flex flex-wrap gap-1">
          {entities.map((e, i) => (
            <span
              key={i}
              className="inline-block px-1.5 py-0.5 rounded text-[10px] border border-[#303030] bg-[#161616] text-[#909090]"
            >
              {e.text}
              <span className="text-[#505050] ml-0.5">s{e.sentence_id}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CorefDebugPanel({ data, history }: CorefDebugPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  if (!data && history.length === 0) return null;

  const allEntries = [...history, ...(data ? [data] : [])];

  return (
    <div className="border-t border-[#222222]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2 text-[11px] text-[#686868] hover:text-[#909090] transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <MessageSquare size={11} />
        <span>Coreference Resolution</span>
        {data && (
          <span className="ml-auto text-[10px] tabular-nums text-[#686868]">
            Turn {data.turn_count} &middot; {data.sentence_count} sentences tracked
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2.5">
          {/* Current resolution */}
          {data && data.original_query !== data.resolved_query && (
            <div className="p-2.5 rounded-lg bg-[#121212] border border-[#252525]">
              <div className="text-[10px] text-[#585858] mb-1.5">Current Resolution</div>
              <div className="flex items-start gap-2 text-xs">
                <div className="flex-1 p-1.5 rounded bg-[#0e0e0e] border border-[#222222] text-[#b09070] break-all">
                  {data.original_query}
                </div>
                <ArrowRight size={14} className="text-[#444444] mt-1 flex-shrink-0" />
                <div className="flex-1 p-1.5 rounded bg-[#0e0e0e] border border-[#222222] text-[#70a088] break-all">
                  {data.resolved_query}
                </div>
              </div>
              {data.replacements.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {data.replacements.map((r, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-[#181818] text-[#808080] border border-[#2a2a2a]">
                      {r.pronoun || "?"} → {r.replacement || "?"}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {data && data.original_query === data.resolved_query && (
            <div className="p-2 rounded-lg bg-[#121212] border border-[#252525] text-[10px] text-[#585858]">
              No resolutions needed — input: <span className="text-[#909090]">{data.original_query}</span>
            </div>
          )}

          {/* Entity tracker state */}
          {data && (
            <div className="p-2.5 rounded-lg bg-[#121212] border border-[#252525] space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[10px] text-[#585858]">Entity Tracker State</div>
                <div className="flex gap-2 text-[10px] text-[#585858]">
                  {data.last_speaker && (
                    <span>Speaker: <span className="text-[#808080]">{data.last_speaker}</span></span>
                  )}
                  {data.last_listener && (
                    <span>Listener: <span className="text-[#808080]">{data.last_listener}</span></span>
                  )}
                </div>
              </div>
              <EntityStack label="Persons" icon={<Users size={10} />} entities={data.entity_stacks.persons} color="text-[#687080]" />
              <EntityStack label="Objects" icon={<Box size={10} />} entities={data.entity_stacks.objects} color="text-[#806858]" />
              <EntityStack label="Locations" icon={<MapPin size={10} />} entities={data.entity_stacks.locations} color="text-[#608070]" />
              <EntityStack label="Times" icon={<Clock size={10} />} entities={data.entity_stacks.times} color="text-[#706880]" />
              <EntityStack label="Events" icon={<Zap size={10} />} entities={data.entity_stacks.events} color="text-[#806068]" />
            </div>
          )}

          {/* Accumulated history */}
          {allEntries.length > 1 && (
            <div>
              <button
                onClick={() => setShowHistory(!showHistory)}
                className="flex items-center gap-1.5 text-[10px] text-[#585858] hover:text-[#808080] transition-colors"
              >
                {showHistory ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                Accumulated Context ({allEntries.length} turns)
              </button>
              {showHistory && (
                <div className="mt-1.5 space-y-1 max-h-[200px] overflow-y-auto">
                  {allEntries.map((entry, i) => (
                    <div
                      key={i}
                      className={`flex items-start gap-2 p-1.5 rounded text-[10px] ${
                        i === allEntries.length - 1
                          ? "bg-[#161616] border border-[#2a2a2a]"
                          : "bg-[#0e0e0e]"
                      }`}
                    >
                      <span className="text-[#484848] tabular-nums flex-shrink-0 w-4 text-right">
                        {i + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[#808080] break-all">{entry.original_query}</div>
                        {entry.original_query !== entry.resolved_query && (
                          <div className="text-[#70a088] break-all mt-0.5">
                            → {entry.resolved_query}
                            {entry.replacements.map((r, ri) => (
                              <span key={ri} className="ml-1 text-[#687080]">
                                [{r.pronoun}→{r.replacement}]
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
