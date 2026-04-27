import type { ReactExam } from '../types/exam';

export const reactExams: ReactExam[] = [
  {
    id: 'exam_1',
    title: '사각형의 넓이',
    questionNumber: 'Q2',
    categoryLabel: '수학 문제',
    difficultyLabel: '',
    required: true,
    submittedAt: '2026-04-20 21:48',
    body: [
      {
        type: 'text',
        text: '네 점 A(−2, 4), B(−2, −1), C(4, −1), D(4, 4)를 꼭짓점으로 하는 사각형 ABCD의 넓이는?',
      },
    ],
    subQuestions: [
      {
        id: 'exam_1_multiple_1',
        type: 'multipleChoice',
        choices: ['24', '25', '30', '32', '36'],
        selectedIndex: 2,
      },
    ],
  },
];