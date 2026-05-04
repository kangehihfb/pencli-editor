import type { MultipleChoiceSubQuestion } from "../../types/exam";

const circledNumbers = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

type MultipleChoiceQuestionInputProperties = {
  subQuestion: MultipleChoiceSubQuestion;
  selectedIndex: number | undefined;
  onSelect: (index: number) => void;
  submitted?: boolean;
};

export function MultipleChoiceQuestionInput({
  subQuestion,
  selectedIndex,
  onSelect,
  submitted = false,
}: MultipleChoiceQuestionInputProperties) {
  const handlePointerSelect = (
    event: React.PointerEvent<HTMLButtonElement>,
    index: number,
  ) => {
    event.stopPropagation();
    onSelect(index);
  };

  return (
    <section className="exam-sub-question exam-multiple-choice-question">
      {subQuestion.prompt ? (
        <p className="exam-sub-question-label">{subQuestion.prompt}</p>
      ) : undefined}

      <div className="exam-choice-list">
        {subQuestion.choices.map((choice, index) => (
          <button
            key={choice}
            className={
              selectedIndex === index
                ? "exam-choice-button active"
                : "exam-choice-button"
            }
            type="button"
            onPointerDown={(event) => handlePointerSelect(event, index)}
            onClick={() => onSelect(index)}
          >
            <span>{circledNumbers[index] ?? index + 1}</span>
            {choice}
          </button>
        ))}
      </div>

      {submitted ? (
        <div className="exam-answer-review-list" aria-label="제출한 답안">
          {subQuestion.choices.map((_, index) => (
            <button
              key={index}
              className={
                selectedIndex === index
                  ? "exam-answer-review-row active"
                  : "exam-answer-review-row"
              }
              type="button"
              onPointerDown={(event) => handlePointerSelect(event, index)}
              onClick={() => onSelect(index)}
            >
              <span className="exam-answer-review-number">
                {circledNumbers[index] ?? index + 1}
              </span>
              {selectedIndex === index ? (
                <strong className="exam-answer-review-label">내 답변</strong>
              ) : undefined}
            </button>
          ))}
        </div>
      ) : undefined}
    </section>
  );
}
