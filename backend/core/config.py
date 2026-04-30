from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # --- 后端 LLM ---
    MINIMAX_API_KEY: str
    MINIMAX_BASE_URL: str = "https://api.minimax.chat/v1"
    MINIMAX_MODEL: str = "MiniMax-M2.7"

    # --- 后端 DB ---
    BACKEND_DB_PATH: str = "./.runtime/backend.db"

    # --- Uvicorn ---
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000

    model_config = {"env_file": ".env", "extra": "ignore"}

settings = Settings()
