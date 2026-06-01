import uuid
from datetime import datetime, timezone
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.core.database import get_db
from app.models.syllabus_upload import SyllabusUpload
from app.models.graph import Topic, TopicDependency
from main import app


def test_get_graph_processing_state() -> None:
    syllabus_id = uuid.uuid4()
    
    # Mock database session and return a mock upload record with "processing" graph status
    mock_db = MagicMock()
    mock_upload = SyllabusUpload(
        id=syllabus_id,
        user_id="user_123",
        original_filename="syllabus.pdf",
        source_hash="sha_abc",
        status="ready",
        graph_status="processing",
        graph_error=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    
    mock_db.scalar.return_value = mock_upload

    def _fake_db():
        yield mock_db

    app.dependency_overrides[get_db] = _fake_db
    try:
        client = TestClient(app)
        response = client.get(
            f"/graph/{syllabus_id}",
            headers={"X-User-Id": "user_123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["syllabus_id"] == str(syllabus_id)
        assert data["graph_status"] == "processing"
        assert data["graph_error"] is None
        assert data["nodes"] == []
        assert data["edges"] == []
    finally:
        app.dependency_overrides.clear()


def test_get_graph_failed_state() -> None:
    syllabus_id = uuid.uuid4()
    
    # Mock database session and return a mock upload record with "failed" graph status
    mock_db = MagicMock()
    mock_upload = SyllabusUpload(
        id=syllabus_id,
        user_id="user_123",
        original_filename="syllabus.pdf",
        source_hash="sha_abc",
        status="ready",
        graph_status="failed",
        graph_error="OpenAI Rate limit exceeded",
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    
    mock_db.scalar.return_value = mock_upload

    def _fake_db():
        yield mock_db

    app.dependency_overrides[get_db] = _fake_db
    try:
        client = TestClient(app)
        response = client.get(
            f"/graph/{syllabus_id}",
            headers={"X-User-Id": "user_123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["syllabus_id"] == str(syllabus_id)
        assert data["graph_status"] == "failed"
        assert data["graph_error"] == "OpenAI Rate limit exceeded"
        assert data["nodes"] == []
        assert data["edges"] == []
    finally:
        app.dependency_overrides.clear()


def test_get_graph_ready_state() -> None:
    syllabus_id = uuid.uuid4()
    
    # Mock database session and return a mock upload record with "ready" graph status
    mock_db = MagicMock()
    mock_upload = SyllabusUpload(
        id=syllabus_id,
        user_id="user_123",
        original_filename="syllabus.pdf",
        source_hash="sha_abc",
        status="ready",
        graph_status="ready",
        graph_error=None,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc)
    )
    
    # Mock topics and dependencies query results
    topic_a = Topic(id=uuid.uuid4(), syllabus_id=syllabus_id, label="Topic A", weight_percent=40.0)
    topic_b = Topic(id=uuid.uuid4(), syllabus_id=syllabus_id, label="Topic B", weight_percent=60.0)
    dep = TopicDependency(
        id=uuid.uuid4(),
        syllabus_id=syllabus_id,
        prerequisite_topic_id=topic_a.id,
        target_topic_id=topic_b.id
    )

    mock_db.scalar.return_value = mock_upload
    mock_db.scalars.side_effect = [
        MagicMock(all=lambda: [topic_a, topic_b]),  # First query for topics
        MagicMock(all=lambda: [dep])                # Second query for dependencies
    ]

    def _fake_db():
        yield mock_db

    app.dependency_overrides[get_db] = _fake_db
    try:
        client = TestClient(app)
        response = client.get(
            f"/graph/{syllabus_id}",
            headers={"X-User-Id": "user_123"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["syllabus_id"] == str(syllabus_id)
        assert data["graph_status"] == "ready"
        assert data["graph_error"] is None
        
        # Check returned nodes
        nodes = data["nodes"]
        assert len(nodes) == 2
        labels = [node["label"] for node in nodes]
        assert "Topic A" in labels
        assert "Topic B" in labels

        # Check returned edges
        edges = data["edges"]
        assert len(edges) == 1
        assert edges[0]["source"] == str(topic_a.id)
        assert edges[0]["target"] == str(topic_b.id)
    finally:
        app.dependency_overrides.clear()
