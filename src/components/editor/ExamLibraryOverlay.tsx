import type { ExamPreset } from "../../data/examPresets";

type ExamLibraryOverlayProperties = {
  presets: ExamPreset[];
  activePresetId: string | undefined;
  onSelectPreset: (presetId: string) => void;
};

export function ExamLibraryOverlay({
  presets,
  activePresetId,
  onSelectPreset,
}: ExamLibraryOverlayProperties) {
  return (
    <aside className="exam-library-panel" aria-label="시험지 라이브러리">
      <div className="exam-library-list">
        {presets.map((preset, index) => (
          <button
            key={preset.id}
            type="button"
            className={
              activePresetId === preset.id
                ? "exam-library-item active"
                : "exam-library-item"
            }
            onClick={() => onSelectPreset(preset.id)}
            aria-pressed={activePresetId === preset.id}
          >
            <span className="exam-status-dot" aria-hidden="true" />
            <span className="exam-library-meta">{index + 1}번 수학 문제</span>
          </button>
        ))}
      </div>
    </aside>
  );
}
