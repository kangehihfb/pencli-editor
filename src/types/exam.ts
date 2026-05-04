export type QuestionBodyBlock =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'math';
      tex: string;
    }
  | {
      type: 'image';
      src: string;
      alt?: string;
    };

export type ShortAnswerSubQuestion = {
  id: string;
  type: 'shortAnswer';
  prompt?: string;
  placeholder?: string;
  answerCount: number;
};

export type MultipleChoiceSubQuestion = {
  id: string;
  type: 'multipleChoice';
  prompt?: string;
  choices: string[];
  selectedIndex?: number | null;
};

export type ExamSubQuestion = ShortAnswerSubQuestion | MultipleChoiceSubQuestion;

export type ReactExam = {
  id: string;
  title: string;
  questionNumber?: string;
  categoryLabel?: string;
  difficultyLabel?: string;
  required?: boolean;
  description?: string;
  body: QuestionBodyBlock[];
  subQuestions: ExamSubQuestion[];
  submittedAt?: string;
};
