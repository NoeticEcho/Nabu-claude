-- 022_agile.sql — agile-слой поверх projects/tasks (OlimpOS P7). Аддитивно, идемпотентно.
-- Эпики, спринты (итерации), доска (kanban-колонка), оценка (story points), назначение на участника.

create table if not exists epic (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,  -- скоуп проекта/личный
  project_id  uuid references projects(id) on delete set null,
  title       text not null,
  description text,
  status      text not null default 'open' check (status in ('open','done','archived')),
  created_at  timestamptz not null default now()
);
create index if not exists ix_epic_project on epic(project_id);
create index if not exists ix_epic_user on epic(user_id);

create table if not exists sprint (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  project_id  uuid references projects(id) on delete set null,
  name        text not null,
  goal        text,
  starts_on   date,
  ends_on     date,
  status      text not null default 'planned' check (status in ('planned','active','closed')),
  created_at  timestamptz not null default now()
);
create index if not exists ix_sprint_project on sprint(project_id);
create index if not exists ix_sprint_user on sprint(user_id);

-- задачи: связь с эпиком/спринтом + доска + оценка + исполнитель
alter table tasks add column if not exists epic_id       uuid references epic(id) on delete set null;
alter table tasks add column if not exists sprint_id     uuid references sprint(id) on delete set null;
alter table tasks add column if not exists estimate      integer;                          -- story points
alter table tasks add column if not exists assignee_user uuid references users(id) on delete set null;
alter table tasks add column if not exists board_column  text not null default 'todo'
  check (board_column in ('todo','doing','review','done'));
create index if not exists ix_tasks_sprint on tasks(sprint_id);
create index if not exists ix_tasks_epic on tasks(epic_id);
create index if not exists ix_tasks_assignee on tasks(assignee_user);
