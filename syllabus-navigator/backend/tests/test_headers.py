from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.core.database import get_db
from main import app


def test_upload_requires_x_user_id() -> None:
    def _fake_db():
        yield MagicMock()

    app.dependency_overrides[get_db] = _fake_db
    try:
        client = TestClient(app)
        res = client.post(
            "/upload/syllabus",
            files={"file": ("test.pdf", b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "application/pdf")},
        )
        assert res.status_code == 400
        assert "X-User-Id" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_chat_requires_x_user_id() -> None:
    def _fake_db():
        yield MagicMock()

    app.dependency_overrides[get_db] = _fake_db
    try:
        client = TestClient(app)
        res = client.post("/chat/query", json={"syllabus_id": "00000000-0000-4000-8000-000000000001", "question": "What?"})
        assert res.status_code == 400
        assert "X-User-Id" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()
