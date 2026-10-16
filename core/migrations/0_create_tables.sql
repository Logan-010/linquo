PRAGMA foreign_keys = ON;

CREATE TABLE lessons (
    id TEXT PRIMARY KEY NOT NULL,

    source_language TEXT NOT NULL,
    learning_language TEXT NOT NULL,
    learning_level TEXT NOT NULL,

    include_romanization INTEGER NOT NULL DEFAULT 0
        CHECK (include_romanization IN (0, 1)),

    total_exercises INTEGER NOT NULL DEFAULT 0
        CHECK (total_exercises >= 0),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE exercises (
    id TEXT PRIMARY KEY NOT NULL,

    lesson_id TEXT NOT NULL
        REFERENCES lessons(id)
        ON DELETE CASCADE,

    kind TEXT NOT NULL
        CHECK (json_valid(kind)),

    direction TEXT NOT NULL,
    instruction TEXT NOT NULL,

    prompt TEXT
        CHECK (prompt IS NULL OR json_valid(prompt)),

    hint TEXT NOT NULL,
    explanation TEXT NOT NULL,

    grammar_focus TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(grammar_focus)),

    vocabulary_focus TEXT NOT NULL DEFAULT '[]'
        CHECK (json_valid(vocabulary_focus)),

    position INTEGER NOT NULL DEFAULT 0
        CHECK (position >= 0),

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (lesson_id, position)
);

CREATE INDEX idx_exercises_lesson_id
    ON exercises(lesson_id);

