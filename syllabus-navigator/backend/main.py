from fastapi import FastAPI

from app.api.routes_chat import router as chat_router
from app.api.routes_graph import router as graph_router
from app.api.routes_upload import router as upload_router
from app.core.config import settings


app = FastAPI(title=settings.app_name)
app.include_router(upload_router, prefix="/upload", tags=["upload"])
app.include_router(chat_router, prefix="/chat", tags=["chat"])
app.include_router(graph_router, prefix="/graph", tags=["graph"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
