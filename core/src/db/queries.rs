use crate::{
    db::Error,
    generation::{CefrLevel, Exercise, Language, Lesson},
};
use sqlx::{Row, SqlitePool, sqlite::SqliteRow};
use uuid::Uuid;

pub async fn insert_lesson(pool: &SqlitePool, lesson: &Lesson) -> Result<Uuid, Error> {
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

pub async fn fetch_exercises(
    pool: &SqlitePool,
    source_language: Language,
    learning_language: Language,
    learning_level: CefrLevel,
    n: u32,
) -> Result<Vec<Exercise>, Error> {
    let rows = sqlx::query(
        r#"
        SELECT exercises.*
        FROM exercises
        JOIN lessons ON lessons.id = exercises.lesson_id
        WHERE lessons.source_language = ?
          AND lessons.learning_language = ?
          AND lessons.learning_level = ?
        ORDER BY lessons.id, exercises.position
        LIMIT ?
        "#,
    )
    .bind(serde_json::to_value(source_language)?.as_str().unwrap())
    .bind(serde_json::to_value(learning_language)?.as_str().unwrap())
    .bind(serde_json::to_value(learning_level)?.as_str().unwrap())
    .bind(i64::from(n))
    .fetch_all(pool)
    .await?;

    rows.iter().map(exercise_from_row).collect()
}

pub async fn fetch_lesson(
    pool: &SqlitePool,
    source_language: Language,
    learning_language: Language,
    learning_level: CefrLevel,
) -> Result<Option<Lesson>, Error> {
    let row = sqlx::query(
        r#"
        SELECT * FROM lessons
        WHERE source_language = ?
          AND learning_language = ?
          AND learning_level = ?
        ORDER BY RANDOM()
        LIMIT 1
        "#,
    )
    .bind(serde_json::to_value(source_language)?.as_str().unwrap())
    .bind(serde_json::to_value(learning_language)?.as_str().unwrap())
    .bind(serde_json::to_value(learning_level)?.as_str().unwrap())
    .fetch_optional(pool)
    .await?;

    match row {
        Some(row) => lesson_from_row(pool, &row).await.map(Some),
        None => Ok(None),
    }
}

pub async fn fetch_lesson_id(pool: &SqlitePool, lesson_id: Uuid) -> Result<Option<Lesson>, Error> {
    let row = sqlx::query("SELECT * FROM lessons WHERE id = ?")
        .bind(lesson_id.to_string())
        .fetch_optional(pool)
        .await?;

    match row {
        Some(row) => lesson_from_row(pool, &row).await.map(Some),
        None => Ok(None),
    }
}

async fn lesson_from_row(pool: &SqlitePool, row: &SqliteRow) -> Result<Lesson, Error> {
    let exercises = sqlx::query("SELECT * FROM exercises WHERE lesson_id = ? ORDER BY position")
        .bind(row.try_get::<String, _>("id")?)
        .fetch_all(pool)
        .await?
        .iter()
        .map(exercise_from_row)
        .collect::<Result<Vec<_>, _>>()?;

    let total_exercises =
        usize::try_from(row.try_get::<i64, _>("total_exercises")?).map_err(|error| {
            sqlx::Error::ColumnDecode {
                index: "total_exercises".into(),
                source: Box::new(error),
            }
        })?;

    Ok(Lesson {
        source_language: serde_json::from_value(
            row.try_get::<String, _>("source_language")?.into(),
        )?,
        learning_language: serde_json::from_value(
            row.try_get::<String, _>("learning_language")?.into(),
        )?,
        learning_level: serde_json::from_value(row.try_get::<String, _>("learning_level")?.into())?,
        include_romanization: row.try_get("include_romanization")?,
        total_exercises,
        exercises,
    })
}

fn exercise_from_row(row: &SqliteRow) -> Result<Exercise, Error> {
    Ok(Exercise {
        id: row.try_get("id")?,
        kind: serde_json::from_str(row.try_get("kind")?)?,
        direction: serde_json::from_value(row.try_get::<String, _>("direction")?.into())?,
        instruction: row.try_get("instruction")?,
        prompt: row
            .try_get::<Option<&str>, _>("prompt")?
            .map(serde_json::from_str)
            .transpose()?,
        hint: row.try_get("hint")?,
        explanation: row.try_get("explanation")?,
        grammar_focus: serde_json::from_str(row.try_get("grammar_focus")?)?,
        vocabulary_focus: serde_json::from_str(row.try_get("vocabulary_focus")?)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn lesson() -> Lesson {
        serde_json::from_value(json!({
            "source_language": "English",
            "learning_language": "Korean",
            "learning_level": "A1",
            "include_romanization": true,
            "total_exercises": 2,
            "exercises": [
                {
                    "id": "z-first",
                    "type": "fill_blank",
                    "data": {
                        "options": [{"id": "a", "text": "안녕", "romanization": "annyeong"}],
                        "correct_option_id": "a",
                        "solution": {"text": "안녕", "romanization": "annyeong"}
                    },
                    "direction": "source_to_target",
                    "instruction": "Choose the greeting",
                    "prompt": {"text": "Hello", "romanization": null},
                    "hint": "An informal greeting",
                    "explanation": "Used with friends",
                    "grammar_focus": ["greetings"],
                    "vocabulary_focus": ["안녕"]
                },
                {
                    "id": "a-second",
                    "type": "match_pairs",
                    "data": {"pairs": []},
                    "direction": "bidirectional",
                    "instruction": "Match the pairs",
                    "prompt": null,
                    "hint": "",
                    "explanation": "",
                    "grammar_focus": [],
                    "vocabulary_focus": []
                }
            ]
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn lessons_round_trip_and_missing_lessons_return_none() {
        let pool = pool().await;
        let expected = lesson();
        let id = insert_lesson(&pool, &expected).await.unwrap();

        let actual = fetch_lesson_id(&pool, id).await.unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(actual).unwrap(),
            serde_json::to_value(&expected).unwrap()
        );

        let random = fetch_lesson(&pool, Language::English, Language::Korean, CefrLevel::A1)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::to_value(random).unwrap(),
            serde_json::to_value(expected).unwrap()
        );
        assert!(
            fetch_lesson_id(&pool, Uuid::now_v7())
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            fetch_lesson(&pool, Language::English, Language::Korean, CefrLevel::B1)
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            fetch_lesson(&pool, Language::Korean, Language::English, CefrLevel::A1)
                .await
                .unwrap()
                .is_none()
        );
    }

    #[tokio::test]
    async fn exercises_are_filtered_and_limited() {
        let pool = pool().await;
        let expected = lesson();
        insert_lesson(&pool, &expected).await.unwrap();

        for (index, source, learning, level) in [
            (0, Language::English, Language::Korean, CefrLevel::B1),
            (1, Language::Korean, Language::Korean, CefrLevel::A1),
            (2, Language::English, Language::English, CefrLevel::A1),
        ] {
            let mut other = lesson();
            other.source_language = source;
            other.learning_language = learning;
            other.learning_level = level;
            for exercise in &mut other.exercises {
                exercise.id = format!("{index}-{}", exercise.id);
            }
            insert_lesson(&pool, &other).await.unwrap();
        }

        for n in [0, 1, 2, 10] {
            let actual =
                fetch_exercises(&pool, Language::English, Language::Korean, CefrLevel::A1, n)
                    .await
                    .unwrap();
            let count = (n as usize).min(expected.exercises.len());
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                serde_json::to_value(&expected.exercises[..count]).unwrap()
            );
        }
        assert!(
            fetch_exercises(&pool, Language::English, Language::Korean, CefrLevel::C2, 5)
                .await
                .unwrap()
                .is_empty()
        );
    }
}
