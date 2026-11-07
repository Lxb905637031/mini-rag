"""pytest 公共夹具：应用实例 + TestClient。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture(scope="session")
def app():
    return create_app()


@pytest.fixture(scope="session")
def client(app) -> TestClient:
    return TestClient(app)
