import type { ActivityUpdate } from "../shared/run-log";
import { toolDetail, toolOutput } from "../shared/run-log";

export interface ActivityEvent {
  type: string;
  text?: string;
  name?: string;
  status?: string;
  callId?: string;
  args?: unknown;
  result?: unknown;
  message?: { content?: Array<{ type?: string; text?: string }> };
}

export type ActivityPiece =
  | { kind: "thinking" | "text"; text: string }
  | {
      kind: "tool";
      callId: string;
      name: string;
      status: "running" | "completed" | "error";
      detail: string;
      output: string;
    };

export function describeSdkEvent(event: ActivityEvent): ActivityPiece | null {
  if (event.type === "thinking") {
    return event.text ? { kind: "thinking", text: event.text } : null;
  }
  if (event.type === "assistant") {
    const text = (event.message?.content ?? [])
      .filter((block) => block.type === "text" && block.text)
      .map((block) => block.text ?? "")
      .join("");
    return text ? { kind: "text", text } : null;
  }
  if (event.type === "tool_call") {
    const status = event.status === "completed" || event.status === "error" ? event.status : "running";
    const callId = (event.callId ?? event.name ?? "tool").split("\n")[0] || "tool";
    return {
      kind: "tool",
      callId,
      name: event.name ?? "tool",
      status,
      detail: toolDetail(event.args),
      output: status === "running" ? "" : toolOutput(event.result),
    };
  }
  return null;
}

export function createActivitySink(onActivity?: (update: ActivityUpdate) => void) {
  let kind: "thinking" | "text" | null = null;
  let pending = "";
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!kind || pending.length === 0) {
      kind = null;
      pending = "";
      return;
    }
    onActivity?.({ op: "append", kind, text: pending });
    kind = null;
    pending = "";
  };

  const push = (next: "thinking" | "text", delta: string) => {
    if (!delta) return;
    if (kind && kind !== next) flush();
    kind = next;
    pending += delta;
    if (pending.length >= 180) flush();
    else if (!timer) timer = setTimeout(flush, 250);
  };

  return {
    thinking(delta: string) {
      push("thinking", delta);
    },
    text(delta: string) {
      push("text", delta);
    },
    tool(info: Omit<Extract<ActivityUpdate, { op: "tool" }>, "op">) {
      flush();
      onActivity?.({ op: "tool", ...info });
    },
    note(text: string) {
      const trimmed = text.trim();
      if (!trimmed) return;
      flush();
      onActivity?.({ op: "note", text: trimmed });
    },
    end() {
      flush();
    },
  };
}
