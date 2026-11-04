import sqlite3

import pytest
from offers_dashboard.db import init_db


@pytest.fixture
def db_path(tmp_path):
    return tmp_path / "offers.db"


@pytest.fixture
def conn(db_path) -> sqlite3.Connection:
    connection = init_db(db_path)
    yield connection
    connection.close()
