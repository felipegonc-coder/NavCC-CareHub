import type { SurveySummary } from '@carehub/learning';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SurveyResults, type SurveyResultsProps } from './SurveyResults';

// Fictional data only: answer counts, never names.
const summary: SurveySummary = {
  lessonId: 'lesson-feedback',
  submissions: 12,
  questions: [
    {
      questionId: 'q-useful',
      type: 'single_choice',
      prompt: 'Was the escalation course useful?',
      answered: 12,
      answers: [
        { optionId: 'yes', text: 'Yes', count: 9, percent: 75 },
        { optionId: 'no', text: 'No', count: 3, percent: 25 },
      ],
    },
    {
      questionId: 'q-longer',
      type: 'multiple_choice',
      prompt: 'Which parts should be longer?',
      answered: 8,
      answers: [
        { optionId: 'calls', text: 'Practice calls', count: 6, percent: 75 },
        { optionId: 'policy', text: 'Policy', count: 1, percent: 13 },
      ],
    },
  ],
};

const nobody: SurveySummary = {
  ...summary,
  submissions: 0,
  questions: summary.questions.map((question) => ({
    ...question,
    answered: 0,
    answers: question.answers.map((answer) => ({ ...answer, count: 0, percent: null })),
  })),
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function renderSurvey(props: Partial<SurveyResultsProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SurveyResults courseId="course-escalations" lessonId="lesson-feedback" {...props} />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('SurveyResults', () => {
  it('shows how often each answer was picked, without names', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(200, summary));
    renderSurvey({ title: 'Course feedback' });
    expect(await screen.findByText('12 responses')).toBeInTheDocument();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      '/api/learning/reports/courses/course-escalations/surveys/lesson-feedback',
    );
    expect(screen.getByRole('region', { name: 'Course feedback' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: 'Was the escalation course useful?' }),
    ).toBeInTheDocument();
    expect(screen.getByText('12 of 12 answered')).toBeInTheDocument();
    expect(screen.getByText('9 people · 75%')).toBeInTheDocument();
    expect(screen.getByText('3 people · 25%')).toBeInTheDocument();
    expect(
      screen.getByText(
        '8 of 12 answered. People could pick more than one answer, so the percents can add up to more than 100.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('6 people · 75%')).toBeInTheDocument();
    expect(screen.getByText('1 person · 13%')).toBeInTheDocument();
  });

  it('is a section of the report page, with its heading while the answers load', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>(() => undefined));
    renderSurvey();
    expect(screen.getByRole('heading', { level: 2, name: 'Survey answers' })).toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Loading the survey answers');
  });

  it('says so when nobody has answered yet', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(200, nobody));
    renderSurvey();
    expect(await screen.findByText('No answers yet.')).toBeInTheDocument();
    expect(screen.queryByText(/answered$/)).not.toBeInTheDocument();
  });

  it("shows the server's words when the answers can't load, and tries again", async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () =>
        json(404, { error: { code: 'not_found', message: "This survey isn't in the course." } }),
      )
      .mockImplementation(async () => json(200, summary));
    renderSurvey();
    expect(await screen.findByRole('alert')).toHaveTextContent("This survey isn't in the course.");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('12 responses')).toBeInTheDocument();
  });
});
