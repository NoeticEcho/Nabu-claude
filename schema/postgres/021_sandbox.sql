-- 021_sandbox.sql — песочницы проектов (OlimpOS P5). Аддитивно. Одна рабочая папка на проектный
-- space; выполнение кода — в эфемерном docker-контейнере (монтируется только эта папка).

create table if not exists sandbox (
  namespace   uuid primary key references mem_namespace(id) on delete cascade,  -- проектный space
  workdir     text not null,                    -- путь рабочей папки на хосте
  image       text not null default 'node:20-alpine',
  git_remote  text,                             -- привязанный репозиторий (GitHub/GitLab)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
