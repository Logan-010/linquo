use crate::{db::Error, generation::ExerciseOutput};
use sqlx::SqlitePool;
use uuid::Uuid;

pub async fn insert_lesson(pool: &SqlitePool, lesson: &ExerciseOutput) -> Result<Uuid, Error> {
    let lesson_id = Uuid::now_v7();
    let lesson_id_str = lesson_id.to_string();

    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        INSERT INTO lessons (
            id,
            source_language,
            learning_language,
            learning_level,
            include_romanization,
            total_exercises
        )
        VALUES (?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&lesson_id_str)
    .bind(
        serde_json::to_value(lesson.source_language)?
            .as_str()
            .unwrap(),
    )
    .bind(
        serde_json::to_value(lesson.learning_language)?
            .as_str()
            .unwrap(),
    )
    .bind(
        serde_json::to_value(lesson.learning_level)?
            .as_str()
            .unwrap(),
    )
    .bind(lesson.include_romanization)
    .bind(lesson.exercises.len() as i64)
    .execute(&mut *tx)
    .await?;

    for (position, exercise) in lesson.exercises.iter().enumerate() {
        sqlx::query(
            r#"
            INSERT INTO exercises (
                id,
                lesson_id,
                kind,
                direction,
                instruction,
                prompt,
                hint,
                explanation,
                grammar_focus,
                vocabulary_focus,
                position
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&exercise.id)
        .bind(&lesson_id_str)
        .bind(serde_json::to_string(&exercise.kind)?)
        .bind(serde_json::to_value(exercise.direction)?.as_str().unwrap())
        .bind(&exercise.instruction)
        .bind(
            exercise
                .prompt
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
        )
        .bind(&exercise.hint)
        .bind(&exercise.explanation)
        .bind(serde_json::to_string(&exercise.grammar_focus)?)
        .bind(serde_json::to_string(&exercise.vocabulary_focus)?)
        .bind(position as i64)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    Ok(lesson_id)
}
