from unittest.mock import MagicMock, patch
from uuid import uuid4

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


def test_chat_query_requires_x_user_id() -> None:
    def _fake_db():
        yield MagicMock()

    app.dependency_overrides[get_db] = _fake_db
    try:
        client = TestClient(app)
        res = client.post(
            "/chat/query",
            json={
                "syllabus_id": "00000000-0000-4000-8000-000000000001",
                "question": "What?",
                "chat_id": "00000000-0000-4000-8000-000000000002",
            },
        )
        assert res.status_code == 400
        assert "X-User-Id" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_graph_requires_x_user_id() -> None:
    def _fake_db():
        yield MagicMock()

    app.dependency_overrides[get_db] = _fake_db
    try:
        client = TestClient(app)
        res = client.get("/graph/00000000-0000-4000-8000-000000000001")
        assert res.status_code == 400
        assert "X-User-Id" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_upload_list_requires_x_user_id() -> None:
    def _fake_db():
        yield MagicMock()

    app.dependency_overrides[get_db] = _fake_db
    try:
        client = TestClient(app)
        res = client.get("/upload/list")
        assert res.status_code == 400
        assert "X-User-Id" in res.json()["detail"]
    finally:
        app.dependency_overrides.clear()


def test_list_chat_models() -> None:
    client = TestClient(app)
    res = client.get("/chat/models")
    assert res.status_code == 200
    data = res.json()
    assert "models" in data
    assert "gpt-4o-mini" in data["models"]


@patch("app.api.routes_chat.answer_question")
def test_chat_query_passes_history_and_model(mock_answer) -> None:
    from app.models.chat import Chat, ChatMessage
    from app.models.syllabus_upload import SyllabusUpload
    from datetime import datetime

    mock_answer.return_value = ("Answer text", [])

    syllabus_id = uuid4()
    chat_id = uuid4()
    user_id = "test-user"

    upload = SyllabusUpload(
        id=syllabus_id,
        user_id=user_id,
        original_filename="s.pdf",
        source_hash="abc",
        status="ready",
        graph_status="ready",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    chat = Chat(
        id=chat_id,
        user_id=user_id,
        title="Test",
        active_model="gpt-4o",
        created_at=datetime.utcnow(),
    )
    prior_msg = ChatMessage(
        id=uuid4(),
        chat_id=chat_id,
        role="user",
        content="Prior question",
        created_at=datetime.utcnow(),
    )

    db = MagicMock()

    def _get(model, pk):
        if model is SyllabusUpload:
            return upload if pk == syllabus_id else None
        if model is Chat:
            return chat if pk == chat_id else None
        return None

    db.get.side_effect = _get
    db.scalar.return_value = 1  # existing message count
    db.scalars.return_value.all.return_value = [prior_msg]

    def _fake_db():
        yield db

    app.dependency_overrides[get_db] = _fake_db
    try:
        client = TestClient(app)
        res = client.post(
            "/chat/query",
            headers={"X-User-Id": user_id},
            json={
                "syllabus_id": str(syllabus_id),
                "question": "Follow up?",
                "chat_id": str(chat_id),
            },
        )
        assert res.status_code == 200
        mock_answer.assert_called_once()
        kwargs = mock_answer.call_args.kwargs
        assert kwargs["model"] == "gpt-4o"
        assert kwargs["history"] == [("user", "Prior question")]
    finally:
        app.dependency_overrides.clear()
