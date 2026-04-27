import { useState } from 'react';
import type { ReactExam } from '../../types/exam';
import { MultipleChoiceQuestionInput } from './MultipleChoiceQuestionInput';
import { SubjectiveQuestionInput } from './SubjectiveQuestionInput';

type ExamPresentationProps = {
  exam: ReactExam;
};

export function ExamPresentation({ exam }: ExamPresentationProps) {
  const [shortAnswers, setShortAnswers] = useState<Record<string, string[]>>({});
  const [multipleChoiceAnswers, setMultipleChoiceAnswers] = useState<
    Record<string, number | null>
  >(() =>
    Object.fromEntries(
      exam.subQuestions
        .filter((subQuestion) => subQuestion.type === 'multipleChoice')
        .map((subQuestion) => [subQuestion.id, subQuestion.selectedIndex ?? null]),
    ),
  );
  const submitted = Boolean(exam.submittedAt);

  return (
    <article className="react-exam">
      <header className="react-exam-header">
        <div className="react-exam-heading">
          <div className="react-exam-title-group">
            {exam.categoryLabel ? (
              <span className="react-exam-category">{exam.categoryLabel}</span>
            ) : null}
            {exam.required ? <strong className="react-exam-required">필수</strong> : null}
            {exam.questionNumber ? (
              <strong className="react-exam-question-number">{exam.questionNumber}</strong>
            ) : null}
          </div>
     
        </div>
      </header>

      <section className="react-exam-body">
        {exam.body.map((block, index) => {
          if (block.type === 'text') {
            return <p key={index}>{block.text}</p>;
          }

          if (block.type === 'math') {
            return (
              <p key={index} className="react-exam-math">
                {block.tex}
              </p>
            );
          }

          return (
            <img
              key={index}
              className="react-exam-image"
              src={block.src}
              alt={block.alt ?? ''}
            />
          );
        })}
      </section>

      <section className="react-exam-questions">
        {exam.subQuestions.map((subQuestion) => {
          if (subQuestion.type === 'shortAnswer') {
            return (
              <SubjectiveQuestionInput
                key={subQuestion.id}
                subQuestion={subQuestion}
                value={shortAnswers[subQuestion.id] ?? []}
                onChange={(value) => {
                  setShortAnswers((prev) => ({
                    ...prev,
                    [subQuestion.id]: value,
                  }));
                }}
              />
            );
          }

          return (
            <MultipleChoiceQuestionInput
              key={subQuestion.id}
              subQuestion={subQuestion}
              selectedIndex={multipleChoiceAnswers[subQuestion.id] ?? null}
              submitted={submitted}
              onSelect={(selectedIndex) => {
                setMultipleChoiceAnswers((prev) => ({
                  ...prev,
                  [subQuestion.id]: selectedIndex,
                }));
              }}
            />
          );
        })}
      </section>

      {exam.submittedAt ? (
        <footer className="react-exam-submit-status">
        </footer>
      ) : null}
    </article>
  );
}
