/** Explicit spoken separators only: silence, numbers and durations stay as content. */
export function formatTaskDictation(text: string, lang: string) {
  const command = lang.startsWith("en") ? "next\\s+task" : "siguiente\\s+tarea";
  return text
    .replace(new RegExp(`[,.;:!?]*[ \\t]*\\b${command}\\b[ \\t]*[,.;:!?]*[ \\t]*`, "gi"), "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n+/g, "\n");
}
