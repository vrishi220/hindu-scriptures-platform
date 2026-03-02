import { X } from "lucide-react";

type InlineClearButtonProps = {
  visible: boolean;
  onClear: () => void;
  ariaLabel: string;
  position?: "center" | "top";
};

export default function InlineClearButton({
  visible,
  onClear,
  ariaLabel,
  position = "center",
}: InlineClearButtonProps) {
  const positionClass =
    position === "top" ? "right-2 top-2" : "right-2 top-1/2 -translate-y-1/2";

  return (
    <button
      type="button"
      onClick={onClear}
      disabled={!visible}
      aria-label={ariaLabel}
      className={`absolute ${positionClass} flex h-7 w-7 items-center justify-center rounded p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-700 ${
        visible
          ? "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100"
          : "pointer-events-none opacity-0"
      }`}
    >
      <X size={14} />
    </button>
  );
}
