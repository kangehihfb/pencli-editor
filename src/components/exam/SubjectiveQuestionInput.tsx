import type { ShortAnswerSubQuestion } from '../../types/exam';

type SubjectiveQuestionInputProps = {
  subQuestion: ShortAnswerSubQuestion;
  value: string[];
  onChange: (value: string[]) => void;
};

export function SubjectiveQuestionInput({
  subQuestion,
  value,
  onChange,
}: SubjectiveQuestionInputProps) {
  const answerValues = Array.from(
    { length: subQuestion.answerCount },
    (_, index) => value[index] ?? '',
  );

  const updateAnswer = (index: number, nextAnswer: string) => {
    const nextValue = [...answerValues];
    nextValue[index] = nextAnswer;
    onChange(nextValue);
  };

  return (
    <section className="exam-sub-question">
      {subQuestion.prompt ? (
        <label className="exam-sub-question-label">{subQuestion.prompt}</label>
      ) : null}

      <div className="exam-answer-list">
        {answerValues.map((answer, index) => (
          <input
            key={index}
            className="exam-answer-input"
            value={answer}
            placeholder={`답안 ${index + 1}`}
            onChange={(event) => updateAnswer(index, event.target.value)}
          />
        ))}
      </div>
    </section>
  );
}
