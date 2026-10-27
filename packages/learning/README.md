# @carehub/learning

Pure TypeScript for Care Hub Learning: the course format and the logic that the Learning screens
and server routes share. There is no I/O, React or database code here. The only runtime dependency
is zod.

## Modules

Each folder exports from its `index.ts`, and `src/index.ts` re-exports them all.

| Folder                                 | Owner | What it holds                                                                   |
| -------------------------------------- | ----- | ------------------------------------------------------------------------------- |
| `format/`                              | B1    | zod schemas for courses and learning paths, parsing, migrations, publish checks |
| `util/`                                | B1    | seeded random (`mulberry32`, `shuffle`, `sample`) and `YYYY-MM-DD` day helpers  |
| `fixtures/`                            | B1    | fictional sample courses, a learning path, learners and groups                  |
| `api/`, `reviews/`                     | B1    | request and response schemas, review links and comments                         |
| `questions/`, `quiz/`, `scenario/`     | B2    | scoring, quiz attempts, scenario branching                                      |
| `progress/`, `certificates/`, `paths/` | B3    | progress, completion, certificates, learning paths                              |
| `reports/`, `delivery/`                | B4    | report numbers, CSV, due dates, reminders, My learning                          |
| `player/`                              | B5    | player view logic                                                               |
| `authoring/`                           | B8    | editing logic for Studio                                                        |
| `banks/`                               | B9    | question banks and bank draws                                                   |
| `media/`                               | B10   | file kinds, size limits, captions, embeds                                       |

See `docs/learning/PLAN.md` for the full plan.

## The course format

`docs/learning/course-format.md` is the contract; `format/` follows it.

- `parseCourse(raw)`, `parseCourseFile(raw)` and `parseLearningPath(raw)` read untrusted JSON. They
  never throw: they return `{ ok: true, ... }` or `{ ok: false, issues }`, where each issue has a
  `path` such as `lessons[1].blocks[0].text` and a plain-language `message`.
- `checkPublishable(course)` lists what stops a valid course from being published. An empty list
  means it can be published.
- `createCourse`, `presetFor`, `newId`, `richText`, `plainText` and `allQuestions` help editors and
  tests build and read courses.

`docs/learning/course.schema.json` is a JSON Schema of the course file for outside tools. It is
generated from the zod schemas with `z.toJSONSchema`, and a test fails when it is out of date. To
update it, write the output of `courseFileJsonSchema()` to that file and run Prettier on it.

## Fixtures

`fixtures/` has one sample course for each course type, a showcase course that uses every block
and question type, a learning path, 8 learners and 2 groups. All of it is made up: the company,
the people, `example.org` addresses and `sample-...` file ids. Every value is frozen, so copy it
before changing it.

## Scripts

- `npm run typecheck -w @carehub/learning`
- `npm test -w @carehub/learning`
