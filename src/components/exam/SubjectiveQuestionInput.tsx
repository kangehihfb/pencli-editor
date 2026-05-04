import { useState } from "react";
import type { ShortAnswerSubQuestion } from "../../types/exam";

type SubjectiveQuestionInputProperties = {
  subQuestion: ShortAnswerSubQuestion;
  value: string[];
  onChange: (value: string[]) => void;
};

export function SubjectiveQuestionInput({
  subQuestion,
  value,
  onChange,
}: SubjectiveQuestionInputProperties) {
  const [submitted, setSubmitted] = useState(false);
  const answerValues = Array.from(
    { length: subQuestion.answerCount },
    (_, index) => value[index] ?? "",
  );
  const hasAnswer = answerValues.some((answer) => answer.trim().length > 0);

  const updateAnswer = (index: number, nextAnswer: string) => {
    const nextValue = [...answerValues];
    nextValue[index] = nextAnswer;
    setSubmitted(false);
    onChange(nextValue);
  };

  return (
    <section className="exam-sub-question">
      {subQuestion.prompt ? (
        <label className="exam-sub-question-label">{subQuestion.prompt}</label>
      ) : undefined}

      <div
        className={
          hasAnswer
            ? "exam-answer-list exam-short-answer-list has-submit-action"
            : "exam-answer-list exam-short-answer-list"
        }
      >
        {answerValues.map((answer, index) => (
          <input
            key={index}
            className="exam-answer-input"
            value={answer}
            placeholder={subQuestion.placeholder ?? `답안 ${index + 1}`}
            onChange={(event) => updateAnswer(index, event.target.value)}
          />
        ))}
      </div>

      {hasAnswer ? (
        <div className="exam-short-answer-actions">
          <button
            type="button"
            className="exam-submit-answer-button"
            disabled={submitted}
            onClick={() => setSubmitted(true)}
          >
            {submitted ? "제출 완료" : "제출하기"}
          </button>
        </div>
      ) : undefined}
    </section>
  );
}
