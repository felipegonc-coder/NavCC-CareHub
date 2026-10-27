import { describe, expect, it } from 'vitest';
import type { CourseStatus } from '../format/index';
import { pathProgress } from './index';

const sequential = {
  courseIds: ['welcome', 'tools', 'calls', 'wrap-up'],
  order: 'sequential' as const,
};
const free = { ...sequential, order: 'free' as const };

describe('pathProgress', () => {
  it('starts not started, with everything after the first course locked on a sequential path', () => {
    expect(pathProgress(sequential, {})).toEqual({
      completed: 0,
      total: 4,
      percent: 0,
      nextCourseId: 'welcome',
      status: 'not_started',
      lockedCourseIds: ['tools', 'calls', 'wrap-up'],
    });
  });

  it('counts completed and passed courses and unlocks up to the first unfinished one', () => {
    const statuses: Record<string, CourseStatus> = {
      welcome: 'completed',
      tools: 'passed',
      calls: 'in_progress',
    };
    expect(pathProgress(sequential, statuses)).toEqual({
      completed: 2,
      total: 4,
      percent: 50,
      nextCourseId: 'calls',
      status: 'in_progress',
      lockedCourseIds: ['wrap-up'],
    });
  });

  it('rounds the percentage down', () => {
    const path = { courseIds: ['a', 'b', 'c'], order: 'free' as const };
    expect(pathProgress(path, { a: 'passed' }).percent).toBe(33);
    expect(pathProgress(path, { a: 'passed', b: 'completed' }).percent).toBe(66);
  });

  it('keeps a failed course as the next course', () => {
    const progress = pathProgress(sequential, { welcome: 'passed', tools: 'failed' });
    expect(progress.nextCourseId).toBe('tools');
    expect(progress.completed).toBe(1);
    expect(progress.status).toBe('in_progress');
    expect(progress.lockedCourseIds).toEqual(['calls', 'wrap-up']);
  });

  it('locks later courses on a sequential path even if they were finished elsewhere', () => {
    const progress = pathProgress(sequential, { calls: 'completed' });
    expect(progress.nextCourseId).toBe('welcome');
    expect(progress.completed).toBe(1);
    expect(progress.status).toBe('in_progress');
    expect(progress.lockedCourseIds).toEqual(['tools', 'calls', 'wrap-up']);
  });

  it('never locks courses on a free path', () => {
    const progress = pathProgress(free, { tools: 'in_progress' });
    expect(progress.lockedCourseIds).toEqual([]);
    expect(progress.nextCourseId).toBe('welcome');
    expect(progress.status).toBe('in_progress');
  });

  it('is completed when every course is completed or passed', () => {
    const done = new Map<string, CourseStatus>([
      ['welcome', 'completed'],
      ['tools', 'passed'],
      ['calls', 'passed'],
      ['wrap-up', 'completed'],
    ]);
    expect(pathProgress(sequential, done)).toEqual({
      completed: 4,
      total: 4,
      percent: 100,
      nextCourseId: null,
      status: 'completed',
      lockedCourseIds: [],
    });
  });

  it('ignores statuses of courses outside the path and inherited object keys', () => {
    const path = { courseIds: ['constructor', 'toString'], order: 'sequential' as const };
    const progress = pathProgress(path, { other: 'passed' });
    expect(progress.status).toBe('not_started');
    expect(progress.nextCourseId).toBe('constructor');
    expect(progress.lockedCourseIds).toEqual(['toString']);
  });

  it('handles an empty path', () => {
    expect(pathProgress({ courseIds: [], order: 'sequential' }, {})).toEqual({
      completed: 0,
      total: 0,
      percent: 0,
      nextCourseId: null,
      status: 'not_started',
      lockedCourseIds: [],
    });
  });
});
