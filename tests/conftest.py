import os
import pytest
from pymongo import MongoClient
from fastapi.testclient import TestClient

# Configure environment before loading app
os.environ["MONGO_URI"] = os.getenv("MONGO_URI", "mongodb://localhost:27017")
os.environ["MONGO_DB"] = os.getenv("MONGO_DB", "test_attendance_db")

import app.main as app_module
from app.main import app

try:
    from mongomock import MongoClient as MockMongoClient
except ImportError:
    MockMongoClient = None

@pytest.fixture(autouse=True)
def setup_test_db(monkeypatch):
    """
    Sets up an isolated test database.
    Attempts to connect to a real MongoDB instance first for true database-side pipeline verification.
    If real MongoDB is unavailable, gracefully falls back to MockMongoClient.
    """
    uri = os.environ["MONGO_URI"]
    db_name = os.environ["MONGO_DB"]
    
    selected_client = None
    selected_db = None
    
    try:
        real_client = MongoClient(uri, serverSelectionTimeoutMS=600)
        real_client.admin.command('ping')
        selected_client = real_client
        selected_db = real_client[db_name]
    except Exception:
        if MockMongoClient is not None:
            mock_client = MockMongoClient()
            selected_client = mock_client
            selected_db = mock_client[db_name]
        else:
            pytest.skip("Neither live MongoDB nor mongomock is available.")
            
    selected_db.employees.delete_many({})
    selected_db.attendance_logs.delete_many({})
    monkeypatch.setattr(app_module, "client", selected_client)
    monkeypatch.setattr(app_module, "db", selected_db)
    monkeypatch.setattr(app_module, "is_db_ready", True)
    monkeypatch.setattr(app_module, "db_init_error", None)
    app_module.init_db_indexes(selected_db)
    
    yield selected_db
    
    try:
        selected_db.employees.delete_many({})
        selected_db.attendance_logs.delete_many({})
        if selected_client:
            selected_client.close()
    except Exception:
        pass

@pytest.fixture
def client(setup_test_db):
    with TestClient(app) as test_client:
        yield test_client
