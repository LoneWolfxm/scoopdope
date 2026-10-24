/**
 * Common utility types shared across the platform.
 * @module common.types
 */

/**
 * Standard paginated API response wrapper.
 */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Standard API success response wrapper.
 */
export interface ApiResponse<T = void> {
  success: true;
  data: T;
  message?: string;
}

/**
 * Standard API error response.
 */
export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
}

/**
 * Generic sort direction.
 */
export type SortOrder = 'ASC' | 'DESC';

/**
 * Common pagination query parameters.
 */
export interface PaginationQuery {
  page?: number;
  limit?: number;
}

/**
 * UUID string type alias for clarity.
 */
export type UUID = string;

/**
 * ISO 8601 datetime string type alias.
 */
export type ISODateString = string;

/**
 * Course difficulty level.
 */
export type CourseLevel = 'beginner' | 'intermediate' | 'advanced';

/**
 * All valid course levels, useful for validation and iteration.
 */
export const COURSE_LEVELS: readonly CourseLevel[] = [
  'beginner',
  'intermediate',
  'advanced',
] as const;

/**
 * Summary representation of a course.
 */
export interface CourseSummary {
  id: UUID;
  title: string;
  level: CourseLevel;
  createdAt: ISODateString;
}

/**
 * Legacy shape of a course summary prior to the introduction of `level`.
 * Consumers should migrate these values using {@link migrateCourseSummary}.
 */
export interface LegacyCourseSummary {
  id: UUID;
  title: string;
  level?: string;
  createdAt: ISODateString;
}

/**
 * Type guard for {@link CourseLevel}.
 */
export function isCourseLevel(value: unknown): value is CourseLevel {
  return (
    typeof value === 'string' &&
    (COURSE_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * Type guard for {@link CourseSummary}.
 */
export function isCourseSummary(value: unknown): value is CourseSummary {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    isCourseLevel(candidate.level) &&
    typeof candidate.createdAt === 'string'
  );
}

/**
 * Migration helper that upgrades a legacy course summary to the current
 * {@link CourseSummary} shape. Missing or invalid `level` values default to
 * `'beginner'`.
 */
export function migrateCourseSummary(
  legacy: LegacyCourseSummary,
): CourseSummary {
  return {
    id: legacy.id,
    title: legacy.title,
    level: isCourseLevel(legacy.level) ? legacy.level : 'beginner',
    createdAt: legacy.createdAt,
  };
}