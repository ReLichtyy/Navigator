from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes_chat import router as chat_router
from app.api.routes_graph import router as graph_router
from app.api.routes_upload import router as upload_router
from app.core.config import settings


app = FastAPI(title=settings.app_name)
import os

cors_origins_str = os.environ.get("CORS_ALLOW_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
cors_origins = [o.strip() for o in cors_origins_str.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(upload_router, prefix="/upload", tags=["upload"])
app.include_router(chat_router, prefix="/chat", tags=["chat"])
app.include_router(graph_router, prefix="/graph", tags=["graph"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
