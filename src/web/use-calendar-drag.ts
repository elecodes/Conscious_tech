import { useRef, useState, type DragEvent } from "react";

/** Only a drag started in this mounted calendar can change a task. */
export function useCalendarDrag(
  onMove: (id: string, sourceDay: string | null, day: string | null) => void
) {
  const drag = useRef<{ id: string; day: string | null } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const end = () => {
    drag.current = null;
    setOver(null);
  };
  return {
    over,
    start: (event: DragEvent, id: string, day: string | null) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", id);
      drag.current = { id, day };
    },
    end,
    target: (day: string | null) => ({
      onDragOver: (event: DragEvent) => {
        if (!drag.current) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(day ?? "undated");
      },
      onDrop: (event: DragEvent) => {
        if (!drag.current) return;
        event.preventDefault();
        if (drag.current.day !== day) onMove(drag.current.id, drag.current.day, day);
        end();
      },
    }),
  };
}
