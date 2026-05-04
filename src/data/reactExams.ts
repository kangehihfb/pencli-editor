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
  {
    id: 'exam_2',
    title: '문자 배열',
    questionNumber: 'Q1_2005학년도 6월 평가원 나형 30번',
    categoryLabel: '수학 문제',
    difficultyLabel: '발전',
    required: true,
    body: [
      {
        type: 'text',
        text: '7개의 문자 𝑎, 𝑎, 𝑏, 𝑏, 𝑐, 𝑑, 𝑒 를 일렬로 나열할 때,\n𝑎 끼리 또는 𝑏 끼리 이웃하게 되는 모든 경우의 수를\n구하시오. [4점]',
      },
    ],
    subQuestions: [
      {
        id: 'exam_2_short_1',
        type: 'shortAnswer',
        answerCount: 1,
        placeholder: '내용 입력...',
      },
    ],
  },
];
