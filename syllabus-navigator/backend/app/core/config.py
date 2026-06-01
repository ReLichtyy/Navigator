from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Syllabus Navigator"
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000

    postgres_user: str = "syllabus"
    postgres_password: str = "syllabus"
    postgres_db: str = "syllabus_navigator"
    postgres_host: str = "postgres"
    postgres_port: int = 5432

    chroma_host: str = "chroma"
    # Chroma container exposes 8000 internally; host machine uses published port 8001.
    chroma_port: int = 8000

    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    chat_model: str = "gpt-4o-mini"
    # Comma-separated allowlist for per-chat model switching.
    allowed_chat_models: str = "gpt-4o-mini,gpt-4o,gpt-4.1-mini"
    cors_allow_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def chat_models_list(self) -> list[str]:
        models = [m.strip() for m in self.allowed_chat_models.split(",") if m.strip()]
        return models or [self.chat_model]

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


settings = Settings()
