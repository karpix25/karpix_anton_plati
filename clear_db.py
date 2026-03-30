import os
from dotenv import load_dotenv
load_dotenv()

from services.v1.database.db_service import init_db
init_db()
print("init_db completed")
