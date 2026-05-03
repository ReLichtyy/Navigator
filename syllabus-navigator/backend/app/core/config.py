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
    chroma_port: int = 8001

    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    chat_model: str = "gpt-4o-mini"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


settings = Settings()
