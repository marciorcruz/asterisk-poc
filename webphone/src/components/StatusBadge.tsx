type Tone = "idle" | "connecting" | "registered" | "error";

const toneLabel: Record<Tone, string> = {
  idle: "tone-idle",
  connecting: "tone-connecting",
  registered: "tone-registered",
  error: "tone-error",
};

export function StatusBadge({ tone, text }: { tone: Tone; text: string }) {
  return <span className={`status-badge ${toneLabel[tone]}`}>{text}</span>;
}

