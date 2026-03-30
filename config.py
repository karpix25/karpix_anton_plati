import os
from dotenv import load_dotenv

load_dotenv()

# Path for temporary files (audio/video)
LOCAL_STORAGE_PATH = "/tmp"

# Ensure the path exists
if not os.path.exists(LOCAL_STORAGE_PATH):
    os.makedirs(LOCAL_STORAGE_PATH)

def validate_env_vars(provider):
    # Basic validation for now
    pass

# Database Configuration
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASS = os.getenv("DB_PASS", "")
DB_PORT = os.getenv("DB_PORT", "5432")
