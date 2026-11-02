"""Batched ATS-score lookup for tracker cards (Database.get_ats_scores)."""

import pytest
from sqlalchemy import update

from app.database import Database
from app.models import Improvement


@pytest.fixture
async def db(tmp_path):
    database = Database(db_path=tmp_path / "scores.db")
    yield database
    await database.close()


def _record(overall: float, calculated_at: str) -> dict:
    return {
        "score": {"overall_score": overall, "sub_scores": {}},
        "calculated_at": calculated_at,
    }


async def _improvement(db: Database, tailored: str, score: dict | None) -> str:
    created = await db.create_improvement("master", tailored, "job", [])
    if score is not None:
        async with db._write_session() as session:
            await session.execute(
                update(Improvement)
                .where(Improvement.request_id == created["request_id"])
                .values(ats_score=score)
            )
            await session.commit()
    return created["request_id"]


async def test_empty_input_returns_empty(db):
    assert await db.get_ats_scores([]) == {}


async def test_returns_stored_record_per_resume(db):
    await _improvement(db, "r1", _record(82.0, "2026-01-01T00:00:00Z"))
    await _improvement(db, "r2", _record(40.0, "2026-01-02T00:00:00Z"))
    scores = await db.get_ats_scores(["r1", "r2", "unknown"])
    assert scores["r1"]["score"]["overall_score"] == 82.0
    assert scores["r2"]["score"]["overall_score"] == 40.0
    assert "unknown" not in scores


async def test_unscored_improvement_is_omitted(db):
    await _improvement(db, "r1", None)
    assert await db.get_ats_scores(["r1"]) == {}


async def test_newest_scored_row_wins_and_unscored_rows_are_ignored(db):
    await _improvement(db, "r1", _record(10.0, "2026-01-01T00:00:00Z"))
    await _improvement(db, "r1", _record(90.0, "2026-03-01T00:00:00Z"))
    await _improvement(db, "r1", None)
    await _improvement(db, "r1", _record(50.0, "2026-02-01T00:00:00Z"))
    scores = await db.get_ats_scores(["r1"])
    assert scores["r1"]["score"]["overall_score"] == 90.0
