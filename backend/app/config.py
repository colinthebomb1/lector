from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    app_name: str = "Lector"
    debug: bool = True

    mongo_url: str = "mongodb://localhost:27017"
    mongo_db: str = "lector"

    gemma_api_key: str = ""
    gemma_model: str = "gemma-3-27b-it"

    docker_base_url: str = "unix:///var/run/docker.sock"
    container_timeout: int = 25
    container_pool_size: int = 4

    session_secret: str = "change-me-in-production"
    session_max_age: int = 86400  # 24 hours

    challenges_dir: str = "challenges"

    model_config = {"env_file": ".env", "env_prefix": "LECTOR_"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
